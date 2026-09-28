import * as fs from 'fs';
import * as path from 'path';
import { validateLevel, validateTrack } from '../../game/assets/scripts/core/level-data';
import { LevelData, Feed, CarSpec, CLEARANCE } from '../../game/assets/scripts/core/types';
import { TrackShape } from '../../game/assets/scripts/core/track-shapes';
import { bandedQueue, bandParams } from '../../game/assets/scripts/core/level-gen';

function baseLevel(): LevelData {
  return {
    id: 1,
    lot: { w: 2, h: 2, cars: [
      { id: 1, x: 0, y: 0, angle: 90, color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('valid level returns no errors', () => {
  expect(validateLevel(baseLevel())).toEqual([]);
});

test('color imbalance is reported', () => {
  const lvl = baseLevel();
  lvl.loop.queue = [{ color: 'red', count: 8 }]; // 8 != 16
  const errors = validateLevel(lvl);
  expect(errors.length).toBe(1);
  expect(errors[0]).toContain('red');
});

test('a queue written as one total per colour is rejected as an oversized band', () => {
  // The old collapsed form. Under the order-respecting ring it is one band per colour, which
  // is the failure the banding exists to avoid, so it has to be an error and not a warning.
  const lvl = baseLevel();
  lvl.loop.queue = [{ color: 'red', count: 160 }];
  lvl.lot.cars = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1, x: 0.5 + i, y: 0.5, angle: 90, color: 'red', cap: 'small' as const,
  }));
  expect(validateLevel(lvl).some((e) => e.includes('bigger than the biggest car'))).toBe(true);
});

test('unlocked greater than slots is reported', () => {
  const lvl = baseLevel();
  lvl.parking.unlocked = 5; // > slots 4
  expect(validateLevel(lvl)).toContain('unlocked > slots');
});

const okLevel = (cars: CarSpec[]): LevelData => ({
  id: 1,
  lot: { w: 9, h: 6, cars },
  parking: { slots: 2, unlocked: 1 },
  loop: {
    capacity: 28,
    boardIndex: 14,
    queue: [{ color: 'red', count: cars.length * 16 }],
  },
  powerups: { refresh: 0, hardClear: 0, magnet: 0 },
});
const c = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 0, color: 'red', cap: 'small', ...over,
});

test('a level whose cars sit apart and inside the lot has no geometry errors', () => {
  const errs = validateLevel(okLevel([c({ id: 1, x: -2 }), c({ id: 2, x: 2 })]));
  expect(errs.filter((e) => /lot|clearance|angle/.test(e))).toEqual([]);
});

test('a car hanging over the lot edge is an error', () => {
  const errs = validateLevel(okLevel([c({ id: 1, x: 4.4 })]));
  expect(errs.some((e) => e.includes('car 1') && e.includes('lot'))).toBe(true);
});

test('a car turned until it pokes out of the lot is an error', () => {
  // Lengthways it clears the top edge; broadside it does not.
  expect(validateLevel(okLevel([c({ id: 1, cap: 'big', y: 2.6, angle: 0 })]))
    .some((e) => e.includes('lot'))).toBe(false);
  expect(validateLevel(okLevel([c({ id: 1, cap: 'big', y: 2.6, angle: 90 })]))
    .some((e) => e.includes('lot'))).toBe(true);
});

test('two cars closer than the clearance is an error', () => {
  // Centres 0.98 apart: bodies 0.964 long, so 0.016 of gap -- under CLEARANCE.
  const errs = validateLevel(okLevel([c({ id: 1, x: -0.49 }), c({ id: 2, x: 0.49 })]));
  expect(errs.some((e) => e.includes('cars 1 and 2'))).toBe(true);
});

test('two cars exactly the clearance apart is not an error', () => {
  // Derived from CLEARANCE, not written out: this test is about the boundary being INCLUSIVE,
  // so a literal here would stop testing that the moment the constant moved -- which is
  // exactly what happened when it went from 0.04 to 0.08.
  const d = (0.964 + CLEARANCE) / 2;
  const errs = validateLevel(okLevel([c({ id: 1, x: -d }), c({ id: 2, x: d })]));
  expect(errs.some((e) => e.includes('clearance'))).toBe(false);
});

test('a non-finite angle is an error and does not crash the rest of the check', () => {
  const errs = validateLevel(okLevel([c({ id: 1, angle: NaN }), c({ id: 2, x: 3 })]));
  expect(errs.some((e) => e.includes('car 1') && e.includes('angle'))).toBe(true);
});

test('the clearance rule does not depend on the order the cars are listed in', () => {
  // A pair is a pair: the verdict must not change with the order the level lists them.
  // This is what pins the padding to HALF on EACH of the two rather than all of it on
  // one -- the arithmetic Task 5's packer has to match exactly, or it settles on
  // layouts this check then rejects and generation never converges. The pair is
  // deliberately rotated: on a collinear pair the separating axis depends only on the
  // SUM of the two paddings, so an uneven split is invisible there.
  for (const d of [1.0, 1.016, 1.032, 1.048, 1.064, 1.08]) {
    const a = c({ id: 1, x: 0, angle: 0 });
    const b = c({ id: 2, x: d, angle: 45 });
    const forward = validateLevel(okLevel([a, b])).some((e) => e.includes('clearance'));
    const reversed = validateLevel(okLevel([b, a])).some((e) => e.includes('clearance'));
    expect(reversed).toBe(forward);
  }
});

/** A level that validates clean, so each test can break exactly one thing. */
function trackLevel(over: Partial<LevelData['loop']> = {}): LevelData {
  return {
    id: 1,
    lot: { w: 4, h: 4, cars: [{ id: 1, x: 0, y: 0, angle: 90, color: 'red', cap: 'small' }] },
    parking: { slots: 7, unlocked: 4 },
    loop: {
      capacity: 28,
      boardIndex: 14,
      track: 'rect',
      feeds: [{ side: 'far', lookahead: 3 }, { side: 'near', lookahead: 3 }],
      queue: [{ color: 'red', count: 16 }],
      ...over,
    },
    powerups: { refresh: 3, hardClear: 1, magnet: 1 },
  };
}

test('the baseline track validates clean', () => {
  expect(validateTrack(trackLevel())).toEqual([]);
});

test('validateLevel still says nothing about geometry', () => {
  // The split is the point: `isSolvable` runs validateLevel, and the synthetic levels in
  // the game-core / solvability / coverage tests use rings of 2, 4, 5 and 6 slots on
  // purpose -- game-core's deadlock cases need capacity 2 so both entrances collapse onto
  // index 1. They test boarding and deadlock and are never drawn, so geometry must not
  // start calling them unsolvable.
  const tiny = trackLevel({ capacity: 4, boardIndex: 2, track: undefined, feeds: undefined });
  expect(validateLevel(tiny)).toEqual([]);
  expect(validateTrack(tiny).length).toBeGreaterThan(0);
});

test('a level with no track or feeds fields validates clean', () => {
  const level = trackLevel();
  delete level.loop.track;
  delete level.loop.feeds;
  expect(validateTrack(level)).toEqual([]);
});

test('an unknown track shape is rejected', () => {
  const level = trackLevel({ track: 'octagon' as TrackShape });
  expect(validateTrack(level).join(' ')).toContain('track shape');
});

test('a capacity that is not a multiple of four is rejected', () => {
  const level = trackLevel({ capacity: 14, boardIndex: 7 });
  expect(validateTrack(level).join(' ')).toContain('multiple of 4');
});

test('a capacity the shape cannot carry legibly is rejected', () => {
  // The circle's perimeter is 7.85, so 32 slots is a row spacing of 0.245 -- under the floor,
  // a seam of 0.025 under ITS floor, and rows overlapping on the curve at 0.186. It used to be
  // 28 here, which `clearance` coming down to 0.20 made legal (it is what the circle ships at
  // now). The example has to be a ring that fails, so it moved up a step with the rule.
  const level = trackLevel({ track: 'circle', capacity: 32, boardIndex: 16 });
  expect(validateTrack(level).join(' ')).toContain('row spacing');
});

test('a boarding index that is not half a lap is rejected', () => {
  const level = trackLevel({ boardIndex: 5 });
  expect(validateTrack(level).join(' ')).toContain('boardIndex');
});

test('three channels are rejected', () => {
  const feeds = [
    { side: 'far', lookahead: 1 }, { side: 'near', lookahead: 1 }, { side: 'far', lookahead: 1 },
  ] as Feed[];
  expect(validateTrack(trackLevel({ feeds })).join(' ')).toContain('1 or 2');
});

test('no channel at all is rejected', () => {
  expect(validateTrack(trackLevel({ feeds: [] })).join(' ')).toContain('1 or 2');
});

test('two channels on the same side are rejected', () => {
  const feeds = [{ side: 'near', lookahead: 1 }, { side: 'near', lookahead: 2 }] as Feed[];
  expect(validateTrack(trackLevel({ feeds })).join(' ')).toContain('same side');
});

test('a lookahead of zero is rejected', () => {
  const feeds = [{ side: 'near', lookahead: 0 }] as Feed[];
  expect(validateTrack(trackLevel({ feeds })).join(' ')).toContain('lookahead');
});

test('a lookahead past the visible width is rejected', () => {
  // rect docks its channel at x=1.85, which leaves room for seven batches at LANE.step 0.27,
  // not eight. (It was five batches while the step was 0.34.)
  const feeds = [{ side: 'near', lookahead: 8 }] as Feed[];
  expect(validateTrack(trackLevel({ feeds })).join(' ')).toContain('lookahead');
});

test('the circle takes a longer lookahead than the quadrilateral', () => {
  // Its dock is at x=1.25, so the horizontal budget stretches to seven batches.
  const feeds = [{ side: 'near', lookahead: 7 }] as Feed[];
  expect(validateTrack(trackLevel({ track: 'circle', capacity: 24, boardIndex: 12, feeds }))).toEqual([]);
});

test('every complaint names what is wrong', () => {
  // The old version of this test only checked `e.length > 10`, which a message as vague
  // as "bad track!!!!!!!!!!!!" would satisfy. Each complaint must actually name the field
  // and the offending value, not just be long.
  const level = trackLevel({ capacity: 14, boardIndex: 6, track: 'circle' });
  const errors = validateTrack(level);
  expect(errors).toHaveLength(3);
  expect(errors[0]).toBe('capacity 14 is not a multiple of 4');
  expect(errors[1]).toContain('capacity 14 does not fit circle');
  expect(errors[1]).toContain('row spacing');
  expect(errors[2]).toBe('boardIndex 6 must be half the capacity (7)');
});

// baseLevel()'s 2x2 lot is too small for a tunnel (reservation is 3.208 long), so tunnel
// tests get their own level.
function tunnelLevel(): LevelData {
  return {
    id: 1,
    lot: {
      w: 9, h: 6,
      cars: [{ id: 1, x: -3, y: 2, angle: 90, color: 'red', cap: 'small' }],
      tunnels: [{
        id: 1, x: 1, y: 0, angle: 0,
        cars: [{ color: 'red', cap: 'small' }, { color: 'red', cap: 'small' }],
      }],
    },
    parking: { slots: 4, unlocked: 4 },
    // 1 grid car + 2 tunnel cars, all small = 3 * 16, written as one band per car so no
    // band exceeds the biggest car (see the oversized-band check in `validateLevel`).
    loop: {
      capacity: 4,
      boardIndex: 2,
      queue: [{ color: 'red', count: 16 }, { color: 'red', count: 16 }, { color: 'red', count: 16 }],
    },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('a level with a tunnel validates', () => {
  expect(validateLevel(tunnelLevel())).toEqual([]);
});

test('tunnel cars count towards the colour balance', () => {
  const lvl = tunnelLevel();
  lvl.loop.queue = [{ color: 'red', count: 16 }];   // the grid car only
  expect(validateLevel(lvl).join(' ')).toContain('car capacity 48 != passengers 16');
});

test('a tunnel whose reservation leaves the lot is reported', () => {
  const lvl = tunnelLevel();
  lvl.lot.tunnels![0].x = 3.5;      // reservation reaches 5.104, past the 4.5 half-width
  expect(validateLevel(lvl).join(' ')).toContain('tunnel 1 does not fit inside the lot');
});

test('a car inside a tunnel body is reported', () => {
  const lvl = tunnelLevel();
  lvl.lot.cars[0] = { id: 1, x: 1, y: 0, angle: 0, color: 'red', cap: 'small' };
  expect(validateLevel(lvl).join(' ')).toContain('tunnel 1 and car 1');
});

test('a car standing where the mouth car stands is reported', () => {
  const lvl = tunnelLevel();
  lvl.lot.cars[0] = { id: 1, x: 2.122, y: 0, angle: 0, color: 'red', cap: 'small' };
  expect(validateLevel(lvl).join(' ')).toContain("tunnel 1's mouth car and car 1");
});

test('two tunnels closer than the clearance are reported', () => {
  const lvl = tunnelLevel();
  lvl.lot.w = 12;
  lvl.lot.tunnels = [
    { id: 1, x: -1, y: 0, angle: 0, cars: [{ color: 'red', cap: 'small' }] },
    { id: 2, x: 1, y: 0, angle: 0, cars: [{ color: 'red', cap: 'small' }] },
  ];
  lvl.loop.queue = [{ color: 'red', count: 48 }];
  expect(validateLevel(lvl).join(' ')).toContain('tunnels 1 and 2');
});

test('an empty tunnel is a data error, not a drained one', () => {
  const lvl = tunnelLevel();
  lvl.lot.tunnels![0].cars = [];
  lvl.loop.queue = [{ color: 'red', count: 16 }];
  expect(validateLevel(lvl).join(' ')).toContain('tunnel 1 holds no cars');
});

test('the band curve ships only cells the sweep visited, and only level 1 at the free end', () => {
  // WHAT THIS USED TO SAY, AND WHY IT CANNOT SAY IT ANY MORE. It asserted two things about
  // BAND_CURVE -- that `offset` never goes down from one level to the next, and that
  // `interleave` is 1 on every row. Both were overruled on measurement in effbda3, in
  // writing, and the shipped table contradicts both:
  //
  //     offset      0  16  32  12  16  20  24   4  32  28
  //     interleave  1   1   1   1   1   1   1   2   1   3
  //
  //  - THE RAMP IS NOT IN `offset`. The old curve was ranked on hard/fair, one bit, and at
  //    four open stalls that bit is saturated -- many offsets read hard on every level, so
  //    the sweep stopped at the first passing cell and the ORDER of those cells carried no
  //    information. Ranked on `demandPressure` instead, id 8's best cell is offset 4 and id
  //    3's is offset 32: `offset` is a way of REACHING difficulty, not difficulty itself, and
  //    the relation is not monotone. A non-decreasing sequence was never the property; it was
  //    a proxy that happened to hold.
  //  - `interleave` IS SWEPT NOW. It was pinned at 1 because it flipped no hard/fair verdict,
  //    which was the saturated bit being read as "inert" when it meant "unmeasured". On the
  //    gap it takes the best cell on three of the ten ids, and the table ships 2 on id 8 and
  //    3 on id 10.
  //
  // THE RAMP ITSELF IS ASSERTED ON THE DEMAND GAP, over the halves of the ten shipped levels,
  // in level-gen.test.ts ('the second half of the curve is harder than the first'). It cannot
  // be asserted here and it is not a loss that it is not: the ramp stopped being a property of
  // this TABLE the moment `offset` stopped being difficulty, and reading it now means playing
  // a level rather than looking a row up.
  //
  // WHAT IS LEFT IS STILL A PROPERTY OF THE TABLE, and each half catches a real way of
  // breaking it by hand:
  //
  //  - EVERY CELL IS ONE THE SWEEP ACTUALLY VISITED. `tools/band-sweep.ts` scans offsets
  //    {0, 4, ... 40} against interleaves {1, 2, 3}, and every "the only passing cell of 33"
  //    claim in BAND_CURVE's docblock is a claim about that grid. A hand-typed 18, or a depth
  //    of 4, would ship a cell nothing has ever measured while reading exactly like a pick.
  //  - ONLY LEVEL 1 SITS AT THE FREE END. Offset 0 is perfect correspondence between the
  //    leaving order and the queue, where the level falls to `keepDistinct` -- the one-line
  //    rule this whole apparatus exists to defeat. Level 1 is the authored teaching level and
  //    no offset makes it hard anyway; level 2 used to sit here too and was moved off it
  //    deliberately (gap 1.08 at offset 16 against 0.03 at offset 0). Measured on the shipped
  //    lots with the queue rebuilt at offset 0, the four ids whose band is doing the most
  //    work read 0.25, 0.11, 0.42 and 0.72 there against 1.56, 1.32, 1.81 and 0.87 as
  //    shipped -- so zeroing a row is a real regression and this is what notices it.
  //
  // The drift the fast suite really has to catch -- a curve value edited without also running
  // `npm run gen` -- is caught by the shipped-queue test below, which compares the bytes on
  // disk against `bandedQueue` at the curve's own cell.
  const SWEPT_OFFSETS = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40];
  const SWEPT_DEPTHS = [1, 2, 3];
  for (let id = 1; id <= 10; id++) {
    const bp = bandParams(id);
    expect({
      id,
      offsetSwept: SWEPT_OFFSETS.includes(bp.offset),
      depthSwept: SWEPT_DEPTHS.includes(bp.interleave),
      freeEnd: bp.offset === 0,
    }).toEqual({ id, offsetSwept: true, depthSwept: true, freeEnd: id === 1 });
  }
});

/** Where `npm run gen` writes the shipped level files -- see tools/gen-levels.ts. */
const LEVELS_DIR = path.resolve(__dirname, '..', '..', 'game', 'assets', 'resources', 'levels');

test('the shipped level files carry the queue the curve currently produces', () => {
  // Nothing else reads game/assets/resources/levels/*.json at all. Every other test in this
  // suite calls `generateLevel`/`bandedQueue` directly and checks the result against
  // `bandParams` in memory -- which proves the FUNCTION is consistent with the curve, not
  // that the FILES on disk are. Those are two different claims: the balance gate regenerates
  // levels from BAND_CURVE and never opens a shipped JSON, so a curve value edited without
  // also running `npm run gen` would leave the gate green while the game ships a queue the
  // gate never measured.
  //
  // Ids 3, 6 and 10 legitimately carry one more band than they have cars: `bandedQueue`
  // rotates whole ROWS, not whole bands, so a rotation that lands inside a band cuts it into
  // two entries at the front and the back of the queue -- one extra QueueGroup, same
  // passenger totals, by design (see `bandedQueue`'s "rotates left by ROWS" test in
  // level-gen.test.ts).
  //
  // Lives here, not in level-gen.test.ts, because the drift this catches -- a curve edited
  // without also running `npm run gen` -- is exactly what the balance gate cannot see (it
  // regenerates levels from the curve and never reads the shipped files), so the only backstop
  // is a test that actually runs day to day. level-gen.test.ts is excluded from the routine
  // fast suite by filename, which would leave this pin firing only on the 89-minute run nobody
  // runs routinely.
  for (let id = 1; id <= 10; id++) {
    const raw = fs.readFileSync(path.join(LEVELS_DIR, `level-${id}.json`), 'utf8');
    const level = JSON.parse(raw) as LevelData;
    const bp = bandParams(id);
    const want = bandedQueue(level.lot.cars, level.lot.tunnels ?? [], bp.offset, bp.interleave);
    expect(level.loop.queue).toEqual(want);
  }
});
