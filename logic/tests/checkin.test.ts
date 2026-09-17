import {
  CHECKIN_REWARDS, CHECKIN_VERSION, Checkin, canClaim, claim, emptyCheckin,
  nextReward, parseCheckin, serializeCheckin, todayKey,
} from '../../game/assets/scripts/core/checkin';

/**
 * Same boot-path contract as `parseWallet`: anything that is not exactly a valid, current-
 * version checkin comes back as `emptyCheckin()`, never an exception. `''` is in the list
 * because that is what WeChat's `getStorageSync` returns for a missing key, where a browser's
 * `getItem` returns null -- the two must be indistinguishable here.
 */
test.each([
  ['a missing key (null)', null],
  ['a missing key on WeChat (empty string)', ''],
  ['whitespace', '   '],
  ['not JSON at all', '{oops'],
  ['a truncated object', '{"version":1,"day":3'],
  ['JSON that is not an object', '42'],
  ['JSON null', 'null'],
  ['an array', '[1,2,3]'],
  ['a future version', '{"version":2,"day":3,"last":"2026-01-01"}'],
  ['no version', '{"day":3,"last":"2026-01-01"}'],
  ['day missing', '{"version":1,"last":"2026-01-01"}'],
  ['day as a string', '{"version":1,"day":"3","last":"2026-01-01"}'],
  ['day negative', '{"version":1,"day":-1,"last":"2026-01-01"}'],
  ['day above 7', '{"version":1,"day":8,"last":"2026-01-01"}'],
  ['day is a fraction', '{"version":1,"day":3.5,"last":"2026-01-01"}'],
  ['day is NaN (written as JSON null)', '{"version":1,"day":null,"last":"2026-01-01"}'],
  ['last missing', '{"version":1,"day":3}'],
  ['last is a number', '{"version":1,"day":3,"last":20260101}'],
])('%s parses as an empty checkin', (_what, raw) => {
  expect(parseCheckin(raw as string | null)).toEqual(emptyCheckin());
});

test('a valid checkin round-trips', () => {
  const c: Checkin = { version: CHECKIN_VERSION, day: 4, last: '2026-01-05' };
  expect(parseCheckin(serializeCheckin(c))).toEqual(c);
});

test('an empty checkin has claimed nothing', () => {
  expect(emptyCheckin()).toEqual({ version: CHECKIN_VERSION, day: 0, last: '' });
});

describe('canClaim', () => {
  test('is false the second time on the same day', () => {
    const c: Checkin = { version: CHECKIN_VERSION, day: 1, last: '2026-01-01' };
    expect(canClaim(c, '2026-01-01')).toBe(false);
  });

  test('is true once the day has changed', () => {
    const c: Checkin = { version: CHECKIN_VERSION, day: 1, last: '2026-01-01' };
    expect(canClaim(c, '2026-01-02')).toBe(true);
  });

  test('is true on a checkin that has never claimed', () => {
    expect(canClaim(emptyCheckin(), '2026-01-01')).toBe(true);
  });
});

describe('claim', () => {
  test('the very first claim lands on day 1', () => {
    const { checkin, coins } = claim(emptyCheckin(), '2026-01-01');
    expect(checkin).toEqual({ version: CHECKIN_VERSION, day: 1, last: '2026-01-01' });
    expect(coins).toBe(CHECKIN_REWARDS[0]);
  });

  test('consecutive days advance the streak through day 7, then wrap to day 1', () => {
    let c = emptyCheckin();
    let expectedDay = 0;
    for (let i = 0; i < 8; i++) {
      const today = todayKey(new Date(2026, 0, 1 + i));
      const result = claim(c, today);
      expectedDay = expectedDay === 7 ? 1 : expectedDay + 1;
      expect(result.checkin.day).toBe(expectedDay);
      expect(result.checkin.last).toBe(today);
      expect(result.coins).toBe(CHECKIN_REWARDS[expectedDay - 1]);
      c = result.checkin;
    }
  });

  test('a one-day gap breaks the streak and restarts it at day 1', () => {
    const c: Checkin = { version: CHECKIN_VERSION, day: 5, last: '2026-01-05' };
    // 2026-01-06 was never claimed, so 2026-01-07 is not "yesterday" from 01-05's point of view.
    const result = claim(c, '2026-01-07');
    expect(result.checkin).toEqual({ version: CHECKIN_VERSION, day: 1, last: '2026-01-07' });
    expect(result.coins).toBe(CHECKIN_REWARDS[0]);
  });

  test('a multi-day gap also restarts the streak at day 1', () => {
    const c: Checkin = { version: CHECKIN_VERSION, day: 6, last: '2026-01-05' };
    const result = claim(c, '2026-01-20');
    expect(result.checkin).toEqual({ version: CHECKIN_VERSION, day: 1, last: '2026-01-20' });
    expect(result.coins).toBe(CHECKIN_REWARDS[0]);
  });
});

describe('nextReward', () => {
  test('previews the fresh-streak payout', () => {
    expect(nextReward(emptyCheckin(), '2026-01-01')).toBe(CHECKIN_REWARDS[0]);
  });

  test('previews a mid-streak payout without mutating anything', () => {
    const c: Checkin = { version: CHECKIN_VERSION, day: 3, last: '2026-01-05' };
    expect(nextReward(c, '2026-01-06')).toBe(CHECKIN_REWARDS[3]);
  });

  test('previews the day-7-to-1 wrap', () => {
    const c: Checkin = { version: CHECKIN_VERSION, day: 7, last: '2026-01-05' };
    expect(nextReward(c, '2026-01-06')).toBe(CHECKIN_REWARDS[0]);
  });

  test('previews the reset a gap would cause', () => {
    const c: Checkin = { version: CHECKIN_VERSION, day: 5, last: '2026-01-01' };
    expect(nextReward(c, '2026-01-10')).toBe(CHECKIN_REWARDS[0]);
  });
});

describe('todayKey', () => {
  test('formats as YYYY-MM-DD, zero-padded', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('crosses a month boundary', () => {
    expect(todayKey(new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(todayKey(new Date(2026, 1, 1))).toBe('2026-02-01');
  });

  test('crosses a year boundary', () => {
    expect(todayKey(new Date(2025, 11, 31))).toBe('2025-12-31');
    expect(todayKey(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});
