import { validateLevel, validateTrack } from '../../game/assets/scripts/core/level-data';
import { LevelData, Feed, CarSpec } from '../../game/assets/scripts/core/types';
import { TrackShape } from '../../game/assets/scripts/core/track-shapes';

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
  const d = (0.964 + 0.04) / 2;
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
