import { generateLevel, levelParams, LOT, BLOCKED_TOLERANCE } from '../../game/assets/scripts/core/level-gen';
import { validateLevel } from '../../game/assets/scripts/core/level-data';
import { isSolvable, estimateDifficulty } from '../../game/assets/scripts/core/solvability';
import { isHardButFair } from '../../game/assets/scripts/core/play-sim';
import { CAP_BOX, CAP_SIZE, CAR_SCALE, LevelData } from '../../game/assets/scripts/core/types';

const IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * `generateLevel` for an id, computed once per run.
 *
 * Not an optimisation for its own sake: packing a lot takes about a second now that
 * placement is a relaxation over oriented boxes rather than a scan of integer cells, and
 * the tests below ask for a level about 170 times between them. Uncached, the suite ran
 * past ten minutes and never finished. `generateLevel` is seeded from the id alone and
 * has no other input, so serving the same object twice is what it means for it to be
 * deterministic -- which the very first test proves independently, by calling the real
 * thing twice and comparing. Every other test wants "the level for id N", not a fresh
 * computation of it.
 */
const cache = new Map<number, LevelData>();
function levelFor(id: number): LevelData {
  const hit = cache.get(id);
  if (hit) return hit;
  const made = generateLevel(id);
  cache.set(id, made);
  return made;
}

test('the same id generates the same level every time', () => {
  // Deliberately NOT through `levelFor()` -- the cache would make this pass for free, so
  // this is the one test that pays for a real second generation.
  //
  // ONE id, not all ten. What is under test is that `generateLevel` draws every random
  // number from a generator seeded by the id alone, with no other input and no shared
  // mutable state -- a property of the seeding, which one id witnesses as well as ten.
  // Ten ids meant twenty uncached packs, about half this suite's runtime, to prove the
  // same single thing. That the id actually REACHES the seed is a different claim, and
  // the next test is the one that makes it.
  expect(generateLevel(4)).toEqual(generateLevel(4));
});

test('different ids generate different levels', () => {
  const seen = new Set(IDS.map((id) => JSON.stringify(levelFor(id).lot.cars)));
  expect(seen.size).toBe(IDS.length);
});

test('generated levels are solvable', () => {
  for (const id of IDS) {
    expect(isSolvable(levelFor(id))).toBe(true);
  }
});

test('every generated level passes every rule validateLevel has', () => {
  // One assertion for both halves of the check, because they ARE one call: colour balance
  // and slot counts, which the grid era already enforced, plus the three geometry rules
  // free placement made necessary -- every car inside the lot, no two closer than
  // CLEARANCE, and a finite angle. This is the guard that makes the relaxation packer's
  // output trustworthy: it does not promise to settle, and this is what says whether it
  // did.
  for (const id of IDS) {
    expect(validateLevel(levelFor(id))).toEqual([]);
  }
});

test('every level uses the one lot shape the camera frames', () => {
  for (const id of IDS) {
    const level = levelFor(id);
    expect(level.lot.w).toBe(LOT.w);
    expect(level.lot.h).toBe(LOT.h);
  }
});

test('car ids are unique and the level carries the id it was asked for', () => {
  for (const id of IDS) {
    const level = levelFor(id);
    expect(level.id).toBe(id);
    const ids = level.lot.cars.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  }
});

test('the curve never asks a later level for less than an earlier one', () => {
  for (let id = 2; id <= 12; id++) {
    const prev = levelParams(id - 1), cur = levelParams(id);
    expect(cur.cars).toBeGreaterThanOrEqual(prev.cars);
    expect(cur.colors).toBeGreaterThanOrEqual(prev.colors);
    expect(cur.blockedRatio).toBeGreaterThanOrEqual(prev.blockedRatio);
  }
});

test('every level fills the lot, and fills it equally', () => {
  // The lot is meant to read as a full car park on level 1 as much as on level 10, so the
  // car count is flat. Before this it ramped with the level id and level 1 took 8 of the 54
  // cells -- 15%, an empty car park.
  const counts = new Set(IDS.map((id) => levelParams(id).cars));
  expect(counts.size).toBe(1);
  for (const id of IDS) {
    const level = levelFor(id);
    // Every car asked for is actually placed: a pack that quietly came up short is the
    // failure `pack`/`generateLevel` guard against, and this is that guard's assertion.
    expect(level.lot.cars.length).toBe(levelParams(id).cars);
  }
});

test('the car mix keeps the bodies covering about half the lot', () => {
  // Averaged over all ten levels rather than checked on level 1 alone. Each car's
  // capacity is an independent draw from CAP_MIX, and 36 draws leave enough variance
  // in the resulting mix of small/medium/big bodies that a single level's area share
  // can swing a few points either side of the mean by pure luck (measured: level 5
  // alone came in at 0.396, level 10 at 0.523) -- that is the packer's job on ONE
  // seed, not the property this test is after. Summed over ten levels' worth of
  // draws the mean settles down, and it is that steadier number this checks.
  let area = 0;
  for (const id of IDS) {
    const level = levelFor(id);
    area += level.lot.cars.reduce(
      (sum, c) => sum + CAP_BOX[c.cap].len * CAP_BOX[c.cap].wid * CAR_SCALE * CAR_SCALE, 0,
    );
  }
  // Bodies cover just under half the lot -- the old 0.8 counted cells claimed, which
  // included the ring of air a square cell left around an oblong car.
  //
  // Note what this can and cannot catch. The sum depends only on WHICH capacities were
  // drawn, not on where they ended up, so a packer that piled all 36 cars in one corner
  // would score identically -- the guard against that is the car-count assertion in the
  // test above, and this one is really about the capacity mix. It fails if CAP_MIX shifts
  // toward small bodies, or if CAR_SCALE comes down.
  //
  // The floor is 0.38, not the 0.452 the ten shipped levels measure, so that the plan's
  // sanctioned density escalation has somewhere to land: CAR_SCALE 0.95 scales area by
  // 0.9025 and would put this at 0.408. A 0.42 floor would have failed a change the plan
  // permits, and a 0.40 floor would have left it eight thousandths of headroom.
  expect(area / (IDS.length * LOT.w * LOT.h)).toBeGreaterThan(0.38);
});

test('a later level is measurably harder than the first, at the same size', () => {
  // Car count is flat now (CARS_PER_LEVEL): the lot is full on every level, so a later
  // level cannot be harder by being bigger, and this test asserts exactly that -- the same
  // number of cars, more colours, and a higher score out of rounds and blocked cars.
  const first = estimateDifficulty(levelFor(1));
  const last = estimateDifficulty(levelFor(10));
  expect(last.cars).toBe(first.cars);
  expect(last.colors).toBeGreaterThan(first.colors);
  expect(last.score).toBeGreaterThan(first.score);
});

test('every level above the colour floor beats the one-line rule, and stays winnable', () => {
  // The contract of the painting search, and the reason it exists. "Keep the four stalls
  // all different colours" used to win all ten shipped levels -- a rule a player states in
  // one sentence, against a generator that was painting colours round-robin over the
  // leaving order and so handing that rule over by construction.
  //
  // Both halves are needed. Hard without fair is a level with no way through; fair without
  // hard is the level that plays itself. Below the floor neither is assertable: a bay that
  // covers every colour cannot jam, so at UNLOCKED open stalls a level of that many colours
  // or fewer is won by the one-line rule whatever the generator does. Those ids are teaching
  // levels and this asserts nothing about them -- see levelParams.
  for (const id of IDS) {
    if (levelParams(id).colors <= 4) continue;
    const verdict = isHardButFair(levelFor(id));
    expect({ id, ...verdict, carelessLoss: undefined })
      .toEqual({ id, hard: true, fair: true, carelessLoss: undefined });
  }
});

test('the curve actually sets the blocked-car count, within its stated tolerance', () => {
  // The contract levelParams makes. Worth pinning because it was NOT true in the grid era
  // and is easy to lose again: the band has to sit on the range the packer produces, or the
  // generator quietly falls back to its nearest miss on every level and the ramp does
  // nothing. Measured across the ten: every level lands within 1 of its target.
  // Only the blocked count is asserted. A companion `rounds >= minRounds` check would be
  // vacuous: minRounds runs 2..5 over these ten while the rounds they actually come out with
  // run 6..12, so it could only fire in the case this line already catches -- the generator
  // giving up and returning a nearest miss.
  for (const id of IDS) {
    const want = Math.round(levelParams(id).blockedRatio * levelParams(id).cars);
    expect(Math.abs(estimateDifficulty(levelFor(id)).blocked - want))
      .toBeLessThanOrEqual(BLOCKED_TOLERANCE);
  }
});

test('the second half of the curve is harder than the first, by what the curve steers', () => {
  // Halves, not step-by-step: the generator takes the FIRST candidate inside the blocked
  // tolerance, so any single level's exact figures are partly luck.
  //
  // And measured on `blocked * 2 + colors` rather than on `score`. Score also carries solver
  // rounds at 3x, and rounds is the one input the curve does not steer at all -- it comes out
  // between 6 and 12 across these ten with no target of its own. Including it made half the
  // margin noise, which would let a genuinely inverted curve pass on a lucky draw. These two
  // terms are the ones levelParams actually sets, so this is the claim it can defend.
  const steered = IDS.map((id) => {
    const d = estimateDifficulty(levelFor(id));
    return d.blocked * 2 + d.colors;
  });
  const front = steered.slice(0, 5).reduce((a, b) => a + b, 0);
  const back = steered.slice(5).reduce((a, b) => a + b, 0);
  expect(back).toBeGreaterThan(front);
});

test('a level is short enough to finish: passengers stay within the budget', () => {
  for (const id of IDS) {
    const level = levelFor(id);
    const pax = level.loop.queue.reduce((n, g) => n + g.count, 0);
    const seats = level.lot.cars.reduce((n, c) => n + CAP_SIZE[c.cap], 0);
    expect(pax).toBe(seats);
    // A budget on TIME, expressed in passengers, so it has to be re-derived every time
    // either side of that conversion moves. Both have: GROUP_SIZE board per tick, and TICK
    // halved to 0.17 when the carousel sped up. At 1000 passengers that is 250 ticks, about
    // 42 seconds of boarding -- SHORTER than the 900 this replaces was at the old tick (76
    // seconds), so the ceiling went up and the levels got quicker at the same time.
    //
    // A full 46-car lot runs around 900 of them, so this leaves headroom rather than sitting
    // on the number the generator happens to produce.
    expect(pax).toBeLessThanOrEqual(1000);
  }
});

import { trackParams, planningWindow } from '../../game/assets/scripts/core/level-gen';
import { capacityOptions, maxLookahead, CAPACITY_OPTIONS } from '../../game/assets/scripts/core/track-path';
import { validateTrack } from '../../game/assets/scripts/core/level-data';
import { TRACK_SHAPES } from '../../game/assets/scripts/core/track-shapes';

test('the curve assigns every level a track its geometry can draw', () => {
  for (const id of IDS) {
    const p = trackParams(id);
    expect(capacityOptions(p.track)).toContain(p.capacity);
    for (const f of p.feeds) expect(f.lookahead).toBeLessThanOrEqual(maxLookahead(p.track));
  }
});

test('the generated levels carry their curve entry', () => {
  for (const id of IDS) {
    const level = levelFor(id);
    const p = trackParams(id);
    expect(level.loop.track).toBe(p.track);
    expect(level.loop.capacity).toBe(p.capacity);
    expect(level.loop.boardIndex).toBe(p.capacity / 2);
    expect(level.loop.feeds).toEqual(p.feeds);
  }
});

test('the planning window narrows as the levels go on', () => {
  // Planning window = drawn waiting batches + ticks from the entry to the boarding gap.
  // It is the one number the three knobs collapse into, so the curve is checked on it.
  // Level 7 is a deliberate dip -- a single far channel, a breather -- so it is exempt.
  const tail = IDS.map((id) => {
    const w = planningWindow(trackParams(id));
    return w[w.length - 1];
  });
  expect(tail).toEqual([13, 13, 11, 11, 11, 11, 25, 10, 10, 9]);
  for (let i = 1; i < tail.length; i++) {
    // Level 7 is index 6; skip the comparison INTO it (i === 6) and the one OUT of it
    // (i === 7). Both disjuncts used to read `i === 6`, so the "out of" skip never
    // actually fired -- harmless here since tail[7] <= tail[6] (10 <= 25) holds anyway,
    // and the toEqual above already pins the whole sequence.
    if (i === 6 || i === 7) continue;
    expect(tail[i]).toBeLessThanOrEqual(tail[i - 1]);
  }
});

test('a twin-channel level starts wider than it ends', () => {
  for (const id of IDS) {
    const p = trackParams(id);
    const w = planningWindow(p);
    if (p.feeds.length === 2) expect(w[0]).toBeGreaterThan(w[w.length - 1]);
    else expect(w.length).toBe(1);
  }
});

test('all five shapes appear across the ten levels', () => {
  const used = new Set(IDS.map((id) => trackParams(id).track));
  expect(used.size).toBe(5);
});

test('at least one level runs on a single channel, each side', () => {
  const single = IDS.map((id) => trackParams(id)).filter((p) => p.feeds.length === 1);
  expect(single.length).toBeGreaterThanOrEqual(2);
  expect(new Set(single.map((p) => p.feeds[0].side)).size).toBe(2);
});

test('the curve keeps producing legal tracks past the authored table', () => {
  // Ids 11-15, not 11-25. Past the authored table `trackParams` rotates through
  // TRACK_SHAPES by `(n - 1) % TRACK_SHAPES.length`, so with five shapes any five
  // consecutive ids cover every one of them exactly once -- 11 rect, 12 hex, 13 trap,
  // 14 oval, 15 circle. Fifteen ids ran that same cycle three times over, at about a
  // second of packing each.
  //
  // Honest about what that cost: only the first two assertions are shape-determined. The
  // third is a spot check on the packer over ids no level file covers, and for that one
  // the shape period is beside the point -- it went from fifteen samples to five. Ids 1-10
  // are checked exhaustively by `every generated level passes every rule validateLevel
  // has`, and no id past 10 ships, so five is a deliberate trade of tail sampling for a
  // suite that finishes.
  for (let id = 11; id <= 15; id++) {
    const p = trackParams(id);
    expect(capacityOptions(p.track)).toContain(p.capacity);
    expect(validateLevel(levelFor(id))).toEqual([]);
    expect(validateTrack(levelFor(id))).toEqual([]);
  }
});

test('a degenerate level id still yields a drawable track', () => {
  // Not reachable from generateLevel today, but trackParams is exported and its contract is
  // "any level number": a fractional or non-positive id used to come back with no track.
  for (const id of [0, -1, -7, 1.5, 10.5]) {
    const p = trackParams(id);
    expect(TRACK_SHAPES).toContain(p.track);
    expect(capacityOptions(p.track)).toContain(p.capacity);
    expect(p.feeds.length).toBeGreaterThan(0);
  }
});

test('every generated level draws a legal track', () => {
  // validateTrack is the drawability gate, and the generator is its main customer.
  for (const id of IDS) {
    expect(validateTrack(levelFor(id))).toEqual([]);
  }
});

test('the shortest legal ring can hold a row of every colour the curve can ask for', () => {
  // Asserted over the CONSTANTS, not over generated output. The version of this that compared
  // a generated level's capacity against its own colour count could not fail: the floor of
  // CAPACITY_OPTIONS (8) already sits above the highest colour count levelParams can reach (5).
  // The relation between those two numbers is the part an edit can break -- a new, shorter
  // capacity option, or a raised colour cap -- so that is what this pins.
  const shortestRing = Math.min(...CAPACITY_OPTIONS);
  let mostColors = 0;
  for (let id = 1; id <= 200; id++) mostColors = Math.max(mostColors, levelParams(id).colors);
  expect(mostColors).toBeGreaterThan(0);          // never pass vacuously
  expect(shortestRing).toBeGreaterThanOrEqual(mostColors);
});
