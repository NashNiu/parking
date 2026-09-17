import {
  addCoins, coinsForClear, coinsFromProgress, emptyWallet, parseWallet, serializeWallet,
  WALLET_VERSION,
} from '../../game/assets/scripts/core/wallet';
import { emptyProgress, recordClear } from '../../game/assets/scripts/core/progress';

/**
 * Same as `progress`: this reads off the device on the boot path, so any unexpected input has
 * to come back as an empty wallet rather than an exception. `''` is in the list because that
 * is what WeChat's `getStorageSync` returns for a missing key, where a browser's `getItem`
 * returns null -- the two must be indistinguishable here.
 */
test.each([
  ['a missing key (null)', null],
  ['a missing key on WeChat (empty string)', ''],
  ['whitespace', '   '],
  ['not JSON at all', '{oops'],
  ['a truncated object', '{"version":1,"coins":12'],
  ['JSON that is not an object', '42'],
  ['JSON null', 'null'],
  ['an array', '[1,2,3]'],
  ['a future version', '{"version":2,"coins":100}'],
  ['no version', '{"coins":100}'],
  ['coins missing', '{"version":1}'],
  ['coins as a string', '{"version":1,"coins":"100"}'],
  ['coins negative', '{"version":1,"coins":-5}'],
  ['coins is NaN (written as JSON null)', '{"version":1,"coins":null}'],
  ['coins is a fraction', '{"version":1,"coins":12.5}'],
])('%s parses as an empty wallet', (_what, raw) => {
  expect(parseWallet(raw as string | null)).toEqual(emptyWallet());
});

test('a valid wallet round-trips', () => {
  const w = addCoins(emptyWallet(), 135);
  expect(parseWallet(serializeWallet(w))).toEqual(w);
});

test('an empty wallet holds 0 coins', () => {
  expect(emptyWallet()).toEqual({ version: WALLET_VERSION, coins: 0 });
});

test('addCoins does not mutate the wallet it was given', () => {
  const before = emptyWallet();
  const after = addCoins(before, 40);
  expect(before.coins).toBe(0);
  expect(after.coins).toBe(40);
});

test.each([
  [0, 1, 25],
  [0, 2, 40],
  [0, 3, 60],
  [1, 3, 35],   // rising rating pays the difference
  [2, 3, 20],
  [3, 1, 0],    // a worse replay never claws coins back
  [2, 2, 0],    // a replay at the same rating pays nothing again
  [3, 3, 0],
])('coinsForClear(%i, %i) === %i', (prev, now, want) => {
  expect(coinsForClear(prev, now)).toBe(want);
});

test.each([
  [-1, 3],
  [0, 4],
  [99, 99],
  [NaN, 3],
  [1.5, 2.5],
])('out-of-range star counts (%p, %p) do not throw, and the result is never negative', (prev, now) => {
  expect(() => coinsForClear(prev, now)).not.toThrow();
  expect(coinsForClear(prev, now)).toBeGreaterThanOrEqual(0);
});

/**
 * `coinsFromProgress` is the backfill's derivation: the total a player would have been paid,
 * across every level, had the wallet always existed. It reads the CUMULATIVE table directly
 * (one lookup per level's best rating), not `coinsForClear` per level, because there is no
 * clear history left to replay -- only the final ratings.
 */
test('an empty save derives 0 coins', () => {
  expect(coinsFromProgress(emptyProgress(), 10)).toBe(0);
});

test('a single 3-star level derives its cumulative payout, not a per-star rate', () => {
  const { progress } = recordClear(emptyProgress(), 1, 3);
  expect(coinsFromProgress(progress, 10)).toBe(60);
});

test('mixed ratings sum the cumulative payout of every level, including unrated ones', () => {
  let p = emptyProgress();
  p = recordClear(p, 1, 3).progress; // 60
  p = recordClear(p, 2, 1).progress; // 25
  p = recordClear(p, 3, 2).progress; // 40
  // level 4 was never cleared -- worth 0, not skipped
  expect(coinsFromProgress(p, 4)).toBe(60 + 25 + 40);
});

test('levels beyond levelCount are not counted', () => {
  const { progress } = recordClear(emptyProgress(), 5, 3);
  expect(coinsFromProgress(progress, 4)).toBe(0);
});
