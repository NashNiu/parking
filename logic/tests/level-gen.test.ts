import { generateLevel, levelParams, GRID_COLS, GRID_ROWS } from '../../game/assets/scripts/core/level-gen';
import { validateLevel } from '../../game/assets/scripts/core/level-data';
import { isSolvable, estimateDifficulty } from '../../game/assets/scripts/core/solvability';
import { footprint } from '../../game/assets/scripts/core/move-solver';
import { CAP_SIZE } from '../../game/assets/scripts/core/types';

const IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('the same id generates the same level every time', () => {
  for (const id of IDS) {
    expect(generateLevel(id)).toEqual(generateLevel(id));
  }
});

test('different ids generate different levels', () => {
  const seen = new Set(IDS.map((id) => JSON.stringify(generateLevel(id).grid.cars)));
  expect(seen.size).toBe(IDS.length);
});

test('generated levels balance passengers against car capacity', () => {
  for (const id of IDS) {
    expect(validateLevel(generateLevel(id))).toEqual([]);
  }
});

test('generated levels are solvable', () => {
  for (const id of IDS) {
    expect(isSolvable(generateLevel(id))).toBe(true);
  }
});

test('cars never overlap and never leave the grid', () => {
  for (const id of IDS) {
    const level = generateLevel(id);
    const taken = new Set<string>();
    for (const car of level.grid.cars) {
      expect(car.x).toBeGreaterThanOrEqual(0);
      expect(car.y).toBeGreaterThanOrEqual(0);
      expect(car.x + car.w).toBeLessThanOrEqual(level.grid.cols);
      expect(car.y + car.h).toBeLessThanOrEqual(level.grid.rows);
      for (const cell of footprint(car)) {
        expect(taken.has(cell)).toBe(false);
        taken.add(cell);
      }
    }
  }
});

test('every level uses the one grid shape the camera frames', () => {
  for (const id of IDS) {
    const level = generateLevel(id);
    expect(level.grid.cols).toBe(GRID_COLS);
    expect(level.grid.rows).toBe(GRID_ROWS);
  }
});

test('car ids are unique and the level carries the id it was asked for', () => {
  for (const id of IDS) {
    const level = generateLevel(id);
    expect(level.id).toBe(id);
    const ids = level.grid.cars.map((c) => c.id);
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
  // car count is flat and the occupied share of the grid has a floor. Before this it ramped
  // with the level id and level 1 took 8 of the 54 cells -- 15%, an empty car park.
  const counts = new Set(IDS.map((id) => levelParams(id).cars));
  expect(counts.size).toBe(1);
  for (const id of IDS) {
    const level = generateLevel(id);
    // Every car asked for is actually placed: the floor below is a share of the GRID, so a
    // pack that quietly came up short would still pass it on a lucky mix of long cars.
    expect(level.grid.cars.length).toBe(levelParams(id).cars);
    const cells = level.grid.cars.reduce((n, c) => n + c.w * c.h, 0);
    expect(cells / (GRID_COLS * GRID_ROWS)).toBeGreaterThan(0.8);
  }
});

test('a later level is measurably harder than the first, at the same size', () => {
  // Car count is flat now (CARS_PER_LEVEL): the lot is full on every level, so a later
  // level cannot be harder by being bigger, and this test asserts exactly that -- the same
  // number of cars, more colours, and a higher score out of rounds and blocked cars.
  const first = estimateDifficulty(generateLevel(1));
  const last = estimateDifficulty(generateLevel(10));
  expect(last.cars).toBe(first.cars);
  expect(last.colors).toBeGreaterThan(first.colors);
  expect(last.score).toBeGreaterThan(first.score);
});

test('a level is short enough to finish: passengers stay within the budget', () => {
  for (const id of IDS) {
    const level = generateLevel(id);
    const pax = level.loop.queue.reduce((n, g) => n + g.count, 0);
    const seats = level.grid.cars.reduce((n, c) => n + CAP_SIZE[c.cap], 0);
    expect(pax).toBe(seats);
    // GROUP_SIZE (8) board per tick at 0.34s (GameController's TICK): 900 passengers is
    // about 38 seconds of boarding, and a full 36-car lot runs 670-770 of them. The budget
    // doubled with GROUP_SIZE, which is what a tick's boarding is capped at -- it is a
    // budget on TIME, and the passengers now leave twice as fast.
    expect(pax).toBeLessThanOrEqual(900);
  }
});

test('a car longer than it is wide points that length at its exit', () => {
  // The view lays a car's model along the LONGER axis of its footprint and cannot rotate
  // it across (it would overflow the cell), so a 2x1 car told to exit upwards gets drawn
  // pointing sideways — its roof arrow then contradicts where it actually goes. The
  // generator must never author that contradiction: footprint follows direction.
  for (const id of IDS) {
    for (const car of generateLevel(id).grid.cars) {
      if (car.w === car.h) continue; // square: the arrow is free to point anywhere
      const vertical = car.dir === 'up' || car.dir === 'down';
      const along = vertical ? car.h : car.w;
      const across = vertical ? car.w : car.h;
      expect(`${car.w}x${car.h} dir=${car.dir}: along=${along} across=${across}`)
        .toBe(`${car.w}x${car.h} dir=${car.dir}: along=${Math.max(along, across)} across=${Math.min(along, across)}`);
    }
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
    const level = generateLevel(id);
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
  expect(tail).toEqual([8, 8, 7, 7, 7, 6, 17, 6, 5, 4]);
  for (let i = 1; i < tail.length; i++) {
    // Level 7 is index 6; skip the comparison INTO it (i === 6) and the one OUT of it
    // (i === 7). Both disjuncts used to read `i === 6`, so the "out of" skip never
    // actually fired -- harmless here since tail[7] <= tail[6] (6 <= 17) holds anyway,
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
  for (let id = 11; id <= 25; id++) {
    const p = trackParams(id);
    expect(capacityOptions(p.track)).toContain(p.capacity);
    expect(validateLevel(generateLevel(id))).toEqual([]);
    expect(validateTrack(generateLevel(id))).toEqual([]);
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
    expect(validateTrack(generateLevel(id))).toEqual([]);
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
