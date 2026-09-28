import {
    canClaim, CHECKIN_REWARDS, CHECKIN_VERSION, Checkin, claim, dayOf, daysInMonth,
    emptyCheckin, firstWeekday, isClaimed, monthOf, nextCount, nextReward, parseCheckin,
    serializeCheckin, todayKey,
} from '../../game/assets/scripts/core/checkin';

const at = (month: string, days: number[]): Checkin =>
    ({ version: CHECKIN_VERSION, month, days });

/**
 * 表本身,写成 LITERAL —— 本文件其余断言都读 CHECKIN_REWARDS,那对"第几天取第几项"是合适的,
 * 但会让数字本身完全不设防。产品定的是 20/20/30/30/40/40/100,改它必须是对这一行的蓄意编辑。
 */
test('the reward table pays the agreed figures', () => {
    expect(CHECKIN_REWARDS).toEqual([20, 20, 30, 30, 40, 40, 100]);
    expect(CHECKIN_VERSION).toBe(2);
});

// ---------- 日期拆解 ----------

test('a day key splits into a month and a day', () => {
    expect(monthOf('2026-09-22')).toBe('2026-09');
    expect(dayOf('2026-09-22')).toBe(22);
    expect(dayOf('2026-09-01')).toBe(1);
});

test('todayKey is local time, zero-padded', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
});

/**
 * 月历网格要知道这个月有几格、第一天从星期几起排。闰年是唯一容易写错的一条,所以钉住 2028-02。
 */
test('daysInMonth knows the short months and leap years', () => {
    expect(daysInMonth('2026-09')).toBe(30);
    expect(daysInMonth('2026-01')).toBe(31);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
});

test('firstWeekday is Sunday-based', () => {
    // 2026-09-01 是周二
    expect(firstWeekday('2026-09')).toBe(2);
});

// ---------- 领取判定 ----------

test('a fresh save can claim', () => {
    expect(canClaim(emptyCheckin(), '2026-09-22')).toBe(true);
});

test('the same day cannot be claimed twice', () => {
    expect(canClaim(at('2026-09', [22]), '2026-09-22')).toBe(false);
});

test('another day in the same month can', () => {
    expect(canClaim(at('2026-09', [22]), '2026-09-23')).toBe(true);
});

test('a new month can, whatever last month held', () => {
    expect(canClaim(at('2026-09', [1, 2, 3]), '2026-10-01')).toBe(true);
});

// ---------- 发放 ----------

/**
 * 奖励按"本月累计第几天"取,不是按日期 —— 这是月历模型和连签模型的全部差别。
 * 本月签了 1、2 号,5 号来签,拿的是第 3 天的钱,不是第 5 天的。
 */
test('a gap pays by the running count, not by the date', () => {
    const r = claim(at('2026-09', [1, 2]), '2026-09-05');
    expect(r.checkin.days).toEqual([1, 2, 5]);
    expect(r.coins).toBe(CHECKIN_REWARDS[2]);   // 第 3 天 = 30
});

test('the seventh day of the month pays the jackpot, the eighth starts over', () => {
    const six = at('2026-09', [1, 2, 3, 4, 5, 6]);
    expect(claim(six, '2026-09-07').coins).toBe(100);
    const seven = at('2026-09', [1, 2, 3, 4, 5, 6, 7]);
    expect(claim(seven, '2026-09-08').coins).toBe(20);
});

test('the fourteenth day of the month pays the jackpot again', () => {
    const thirteen = at('2026-09', Array.from({ length: 13 }, (_, i) => i + 1));
    expect(claim(thirteen, '2026-09-14').coins).toBe(100);
});

test('a new month resets the run outright', () => {
    const r = claim(at('2026-09', [1, 2, 3, 4, 5, 6, 7]), '2026-10-01');
    expect(r.checkin).toEqual(at('2026-10', [1]));
    expect(r.coins).toBe(CHECKIN_REWARDS[0]);
});

test('days stay ascending even when claimed out of order', () => {
    // 手改存档或时钟回拨都能造出这个;排序是画月历的前提。
    const r = claim(at('2026-09', [5, 9]), '2026-09-07');
    expect(r.checkin.days).toEqual([5, 7, 9]);
});

test('claim does not mutate the save it is given', () => {
    const before = at('2026-09', [1]);
    claim(before, '2026-09-02');
    expect(before).toEqual(at('2026-09', [1]));
});

/**
 * 已经签过的这天再 claim 一次,付的是 0,存档也原样退回。nextCount 在这天上报的是
 * days.length(供卡片说"刚领的是第几天"用),但 claim 本身绝不能把它当新奖励发——
 * 存档不变而硬币照付,循环调用就是一台不设防的印钞机。canClaim 是今天唯一挡在
 * 这条路前面的检查,这个用例钉住的是 claim 自己在被绕过时也不会漏钱。
 */
test('claim on an already-claimed day pays nothing and leaves the save unchanged', () => {
    const before = at('2026-09', [1, 2, 3]);
    const r = claim(before, '2026-09-03');
    expect(r.coins).toBe(0);
    expect(r.checkin).toEqual(before);
});

test('the month rolls over on the 31st without overflowing', () => {
    const r = claim(at('2026-01', [30]), '2026-01-31');
    expect(r.checkin.days).toEqual([30, 31]);
});

// ---------- 预告与网格 ----------

test('nextReward is what claim would pay', () => {
    const c = at('2026-09', [1, 2]);
    expect(nextReward(c, '2026-09-05')).toBe(claim(c, '2026-09-05').coins);
});

/**
 * 今天已经领过时,nextCount 报的是"已经领到第几天",让卡片能说"今天领的是第 N 天"而不是
 * 预告一个不存在的下一天。
 */
test('nextCount on an already-claimed day reports the day just paid', () => {
    expect(nextCount(at('2026-09', [1, 2, 3]), '2026-09-03')).toBe(3);
    expect(nextCount(at('2026-09', [1, 2, 3]), '2026-09-04')).toBe(4);
    expect(nextCount(emptyCheckin(), '2026-09-04')).toBe(1);
});

test('isClaimed answers per cell, and only for the stored month', () => {
    const c = at('2026-09', [1, 5]);
    expect(isClaimed(c, '2026-09', 1)).toBe(true);
    expect(isClaimed(c, '2026-09', 2)).toBe(false);
    expect(isClaimed(c, '2026-10', 1)).toBe(false);
});

// ---------- 解析 ----------

test.each([
    ['a missing key (null)', null],
    ['a missing key on WeChat (empty string)', ''],
    ['whitespace', '   '],
    ['not JSON at all', '{oops'],
    ['a truncated object', '{"version":2,"month":"2026-09"'],
    ['JSON that is not an object', '42'],
    ['JSON null', 'null'],
    ['an array', '[1,2,3]'],
    ['a future version', '{"version":3,"month":"2026-09","days":[1]}'],
    ['no version', '{"month":"2026-09","days":[1]}'],
    ['month missing', '{"version":2,"days":[1]}'],
    ['month malformed', '{"version":2,"month":"26-9","days":[1]}'],
    ['days missing', '{"version":2,"month":"2026-09"}'],
    ['days not an array', '{"version":2,"month":"2026-09","days":{}}'],
    ['a day of 0', '{"version":2,"month":"2026-09","days":[0]}'],
    ['a day of 32', '{"version":2,"month":"2026-09","days":[32]}'],
    ['a fractional day', '{"version":2,"month":"2026-09","days":[1.5]}'],
    ['a duplicated day', '{"version":2,"month":"2026-09","days":[3,3]}'],
    ['days out of order', '{"version":2,"month":"2026-09","days":[3,1]}'],
])('%s parses as an empty checkin', (_what, raw) => {
    expect(parseCheckin(raw as string | null)).toEqual(emptyCheckin());
});

test('a valid checkin round-trips', () => {
    const c = claim(emptyCheckin(), '2026-09-22').checkin;
    expect(parseCheckin(serializeCheckin(c))).toEqual(c);
});

test('an empty checkin holds no month and no days', () => {
    expect(emptyCheckin()).toEqual({ version: CHECKIN_VERSION, month: '', days: [] });
});

// ---------- v1 迁移 ----------

/**
 * v1 的 `day`(连签位置)在月历模型里无处可去,也不该再有。只搬 `last`,唯一的作用是
 * 防止"更新当天再领一次"。
 *
 * 无条件种下,不判断 last 是不是当月:若它其实是上个月的,canClaim 会因为月份不等直接放行,
 * 行为与空存档完全一致。这样解析函数就不需要一个时钟。
 */
test('a v1 checkin keeps only the day it last claimed', () => {
    expect(parseCheckin('{"version":1,"day":5,"last":"2026-09-20"}'))
        .toEqual(at('2026-09', [20]));
    expect(canClaim(parseCheckin('{"version":1,"day":5,"last":"2026-09-20"}'), '2026-09-20'))
        .toBe(false);
});

test('a v1 checkin that never claimed is simply empty', () => {
    expect(parseCheckin('{"version":1,"day":0,"last":""}')).toEqual(emptyCheckin());
});

test('a v1 checkin with an unusable last is empty, not a crash', () => {
    expect(parseCheckin('{"version":1,"day":3,"last":"nonsense"}')).toEqual(emptyCheckin());
    expect(parseCheckin('{"version":1,"day":3,"last":42}')).toEqual(emptyCheckin());
});
