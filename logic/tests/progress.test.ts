import {
  bestStars, emptyProgress, isUnlocked, parseProgress, recordClear, serializeProgress,
  unlockedThrough,
} from '../../game/assets/scripts/core/progress';
import { STAR_MAX } from '../../game/assets/scripts/core/types';

/**
 * WHAT COMES BACK FROM THE DEVICE IS UNTRUSTED INPUT. It may have been written by an older
 * build, hand-edited, truncated, or never written at all. Every one of these has to yield a
 * fresh save rather than an exception: losing a save costs the player their stars, and
 * throwing on the boot path costs them the game.
 *
 * `''` is in the list because that is what WeChat's `getStorageSync` returns for a missing
 * key, where a browser's `localStorage.getItem` returns null. Both mean the same thing and
 * the parser must not be able to tell them apart.
 */
test.each([
  ['a missing key (null)', null],
  ['a missing key on WeChat (empty string)', ''],
  ['whitespace', '   '],
  ['not JSON at all', '{oops'],
  ['a truncated object', '{"version":1,"stars":{"1":3'],
  ['JSON that is not an object', '42'],
  ['JSON null', 'null'],
  ['an array', '[1,2,3]'],
  ['a future version', '{"version":2,"stars":{"1":3}}'],
  ['no version', '{"stars":{"1":3}}'],
  ['a version that is not a number', '{"version":"1","stars":{"1":3}}'],
  ['stars missing', '{"version":1}'],
  ['stars as an array', '{"version":1,"stars":[3,2]}'],
  ['stars as a string', '{"version":1,"stars":"3"}'],
])('%s parses as a fresh save', (_what, raw) => {
  expect(parseProgress(raw as string | null)).toEqual(emptyProgress());
});

test('a valid save round-trips', () => {
  const { progress } = recordClear(recordClear(emptyProgress(), 1, 3).progress, 2, 2);
  expect(parseProgress(serializeProgress(progress))).toEqual(progress);
});

/**
 * One bad entry does not condemn the save. A rating out of range is clamped and a key that
 * is not a level number is dropped, because the alternative -- rejecting the whole file --
 * throws away every good record for the sake of one bad one.
 */
test('bad entries are repaired or dropped, and the rest of the save survives', () => {
  const p = parseProgress(JSON.stringify({
    version: 1,
    stars: {
      1: 3,
      2: 99,          // above the scale
      3: 0,           // below it: zero means "not cleared", which is not a record
      4: -2,
      5: 2.7,         // not a whole number of stars
      6: 'three',
      7: null,
      abc: 3,         // not a level
      '-1': 3,
      '0': 3,         // levels are 1-based
      '1e3': 3,
    },
  }));
  expect(p.stars).toEqual({ 1: 3, 2: STAR_MAX, 5: 3 });
});

test('bestStars is 0 for a level never cleared', () => {
  const p = recordClear(emptyProgress(), 4, 2).progress;
  expect(bestStars(p, 4)).toBe(2);
  expect(bestStars(p, 5)).toBe(0);
  expect(bestStars(emptyProgress(), 1)).toBe(0);
});

/**
 * `changed` is what decides whether anything is written, and storage here is a SYNCHRONOUS
 * call on the device -- so a re-clear that beats nothing must report false rather than
 * leaving the caller to compare saves.
 */
test('recordClear keeps the best result and reports whether anything changed', () => {
  const first = recordClear(emptyProgress(), 3, 2);
  expect(first.changed).toBe(true);
  expect(bestStars(first.progress, 3)).toBe(2);

  const worse = recordClear(first.progress, 3, 1);
  expect(worse.changed).toBe(false);
  expect(bestStars(worse.progress, 3)).toBe(2);

  const same = recordClear(first.progress, 3, 2);
  expect(same.changed).toBe(false);

  const better = recordClear(first.progress, 3, 3);
  expect(better.changed).toBe(true);
  expect(bestStars(better.progress, 3)).toBe(3);
});

test('recordClear does not mutate the save it was given', () => {
  const before = recordClear(emptyProgress(), 1, 1).progress;
  const snapshot = serializeProgress(before);
  recordClear(before, 2, 3);
  expect(serializeProgress(before)).toBe(snapshot);
});

/**
 * The gate, and the one rule here that is easy to get wrong: a run, not a count.
 *
 * A player who reaches level 3 through the developer picker and clears it has a record at 3
 * with nothing at 2 -- and that must not open level 4. Counting cleared levels instead of
 * measuring the run from level 1 would.
 */
test('unlockedThrough measures the run from level 1, not the number of levels cleared', () => {
  const at = (...pairs: [number, number][]) =>
    pairs.reduce((p, [lvl, st]) => recordClear(p, lvl, st).progress, emptyProgress());

  expect(unlockedThrough(emptyProgress())).toBe(1);
  expect(unlockedThrough(at([1, 3]))).toBe(2);
  expect(unlockedThrough(at([1, 3], [2, 1]))).toBe(3);
  // A result across a gap does not extend the run.
  expect(unlockedThrough(at([1, 3], [3, 3]))).toBe(2);
  expect(unlockedThrough(at([3, 3]))).toBe(1);
  // Ten cleared reports one PAST the series, which the caller caps against the level count.
  const all = at(...Array.from({ length: 10 }, (_, i) => [i + 1, 3] as [number, number]));
  expect(unlockedThrough(all)).toBe(11);
});

test('isUnlocked opens the next level and nothing beyond it', () => {
  const p = recordClear(emptyProgress(), 1, 3).progress;
  expect(isUnlocked(p, 1)).toBe(true);
  expect(isUnlocked(p, 2)).toBe(true);
  expect(isUnlocked(p, 3)).toBe(false);
  // Level 1 is always playable, including on a save that does not exist.
  expect(isUnlocked(emptyProgress(), 1)).toBe(true);
  expect(isUnlocked(emptyProgress(), 2)).toBe(false);
});
