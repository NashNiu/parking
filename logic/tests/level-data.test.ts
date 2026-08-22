import { validateLevel, validateTrack } from '../../game/assets/scripts/core/level-data';
import { LevelData, Feed } from '../../game/assets/scripts/core/types';
import { TrackShape } from '../../game/assets/scripts/core/track-shapes';

function baseLevel(): LevelData {
  return {
    id: 1,
    grid: { cols: 2, rows: 2, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
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

/** A level that validates clean, so each test can break exactly one thing. */
function trackLevel(over: Partial<LevelData['loop']> = {}): LevelData {
  return {
    id: 1,
    grid: { cols: 4, rows: 4, cars: [{ id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' }] },
    parking: { slots: 7, unlocked: 4 },
    loop: {
      capacity: 16,
      boardIndex: 8,
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
  // The circle's perimeter is 7.54, so 16 slots is a row spacing of 0.47 -- under the
  // floor, where the boarding gap stops reading as a hole.
  const level = trackLevel({ track: 'circle', capacity: 16, boardIndex: 8 });
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
  // rect docks its channel at x=2.15, which leaves room for four batches, not five.
  const feeds = [{ side: 'near', lookahead: 5 }] as Feed[];
  expect(validateTrack(trackLevel({ feeds })).join(' ')).toContain('lookahead');
});

test('the circle takes a longer lookahead than the quadrilateral', () => {
  // Its dock is at x=1.2, so the horizontal budget stretches to six batches.
  const feeds = [{ side: 'near', lookahead: 6 }] as Feed[];
  expect(validateTrack(trackLevel({ track: 'circle', capacity: 12, boardIndex: 6, feeds }))).toEqual([]);
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
