/**
 * The daily check-in: which days of THE CURRENT MONTH have been claimed.
 *
 * A CALENDAR, NOT A STREAK, and the difference is what the save shape is for. The old model
 * stored "which day of a 7-day cycle was last claimed" plus the date of that claim, and a
 * missed day reset it to day 1. A calendar has no notion of "day 3, but late": a miss is just a
 * day that was not claimed, the run continues from wherever it got to, and the month is the
 * only thing that resets it.
 *
 * The reward still walks the same seven figures, now indexed by the RUNNING COUNT within the
 * month rather than by a streak position -- so the 7th, 14th, 21st and 28th day a player turns
 * up in a month each pay the jackpot, whichever dates those happen to be.
 *
 * A SEPARATE KEY from `Progress` and `Wallet`, sharing the WALLET'S LIFETIME. Its own key
 * because a check-in record is not a level result; the wallet's lifetime because it is a record
 * of turning up to play and it pays out in coins, and coins go in the wipe.
 * `storage.clearCheckinText` argues that end of it.
 *
 * Same failure policy as `wallet.ts`: this is read off the device on the boot path, so anything
 * unexpected comes back as `emptyCheckin()` and nothing throws.
 */
export interface Checkin {
    version: number;
    /** `'YYYY-MM'` of the days below, or `''` when nothing has ever been claimed. */
    month: string;
    /** Days of `month` already claimed. ASCENDING and without duplicates -- the card draws them. */
    days: number[];
}

export const CHECKIN_VERSION = 2;

/**
 * What the Nth check-in OF A MONTH pays, indexed by `(N - 1) % 7`.
 *
 * Two short days, two medium, two more short-ish, then a jackpot -- front-loaded-then-a-payoff
 * rather than a smooth ramp, so a player who misses a day early has not given up much and the
 * one who reaches the seventh gets something worth the week. The figures are a design call, not
 * a derived one; they live here, in the one place the state machine and its tests both read.
 */
export const CHECKIN_REWARDS: readonly number[] = [20, 20, 30, 30, 40, 40, 100];

export function emptyCheckin(): Checkin {
    return { version: CHECKIN_VERSION, month: '', days: [] };
}

/**
 * `now` as a `'YYYY-MM-DD'` key, in the DEVICE'S LOCAL time zone -- deliberately not UTC.
 *
 * A single-player game with no server has no clock more authoritative than the device it runs
 * on, so there is no "correct" time zone to convert to; UTC would just be a different wrong one,
 * and for a player in China it would flip the day at 08:00 local, in the middle of a normal
 * session. Local time is the only choice that makes "a new day" mean what a player standing in
 * front of the device would call a new day.
 *
 * The cost is accepted, not overlooked: a player who winds their system clock forward claims
 * early, and one who winds it back can claim the same day twice. Both grant a few extra coins in
 * a game with no economy to protect and no other player to affect -- cheap enough that any
 * defense would cost more than the exploit is worth.
 */
export function todayKey(now: Date): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** The `'YYYY-MM'` half of a day key. */
export function monthOf(today: string): string {
    return today.slice(0, 7);
}

/** The day-of-month half of a day key, as a number. */
export function dayOf(today: string): number {
    return Number(today.slice(8, 10));
}

/**
 * How many days `month` has. Built by asking `Date` for "day 0 of the NEXT month", which is the
 * last day of this one -- rather than by a table with a leap-year rule beside it, which would be
 * a worse copy of something `Date` already gets right.
 */
export function daysInMonth(month: string): number {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    return new Date(y, m, 0).getDate();
}

/** Which weekday `month` starts on, 0 = Sunday. The calendar grid's left offset. */
export function firstWeekday(month: string): number {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    return new Date(y, m - 1, 1).getDay();
}

/** Whether `today`'s reward has not already been claimed. */
export function canClaim(c: Checkin, today: string): boolean {
    if (monthOf(today) !== c.month) return true;
    return !c.days.includes(dayOf(today));
}

/**
 * Which check-in of the month a claim made `today` would be -- 1 for the first.
 *
 * ON A DAY ALREADY CLAIMED it reports the count AS IT STANDS, not a day that does not exist.
 * The card needs that: after claiming it still has to say which day was paid, and inventing
 * `days.length + 1` there would show a reward nobody received.
 *
 * Exported because `claim`, `nextReward` and the card all need it and all have to agree. A view
 * that worked it out for itself would be a second copy of this rule, free to drift from the one
 * that pays out.
 */
export function nextCount(c: Checkin, today: string): number {
    if (monthOf(today) !== c.month) return 1;
    if (c.days.includes(dayOf(today))) return c.days.length;
    return c.days.length + 1;
}

/** What `claim(c, today)` would pay right now, for showing the reward before it is claimed. */
export function nextReward(c: Checkin, today: string): number {
    return CHECKIN_REWARDS[(nextCount(c, today) - 1) % CHECKIN_REWARDS.length];
}

/** Whether the cell for `day` of `month` should be drawn as claimed. */
export function isClaimed(c: Checkin, month: string, day: number): boolean {
    return c.month === month && c.days.includes(day);
}

/**
 * Record a claim for `today`, returning the new save and the coins it pays.
 *
 * The save passed in is never mutated -- the caller holds it as the current state, same as
 * `earn` in `wallet.ts`. This does not check `canClaim` itself: the caller already has to, to
 * decide whether to show a claimable button at all, and a second silent check here would be a
 * second place that rule could drift.
 *
 * PRICED THROUGH `nextCount`, not from `days.length` after appending. `nextCount` is the one
 * function that decides which check-in of the month this is -- the card highlights that same
 * count -- so pricing any other way would be a second, silently different answer to "which day
 * is this" free to drift from the one the card shows.
 *
 * A day already in `days` is KEPT AS-IS rather than appended again. The caller is supposed to
 * gate on `canClaim` first, but this has no way to enforce that, and `parseCheckin` rejects a
 * duplicate day outright -- so appending one here would write a save that reads back as
 * corrupt on the next boot, costing the player the whole month's record over a call that
 * should have been a no-op.
 *
 * And a no-op PAYS NOTHING. `nextCount` reports `days.length` for a day already claimed --
 * correct for the card, which needs to say which day was paid after the fact -- but `claim`
 * itself must not treat that as a fresh reward: with the save unchanged, a caller that skipped
 * `canClaim` and called this in a loop would mint coins for free, forever. There is exactly one
 * caller today (`GameController.claimCheckinToday`) and it does gate on `canClaim`, but that is
 * exactly the kind of rule this file has learned not to lean on a single caller for -- see
 * `canClaim`'s own callers for the same argument made about the duplicate-day check above.
 *
 * The days are kept SORTED rather than appended in claim order. The calendar draws from this
 * array, and a clock wound backwards or a hand-edited save can otherwise leave it out of order.
 */
export function claim(c: Checkin, today: string): { checkin: Checkin; coins: number } {
    const month = monthOf(today);
    const d = dayOf(today);
    const kept = month === c.month ? c.days : [];
    if (kept.includes(d)) {
        return { checkin: { version: CHECKIN_VERSION, month, days: kept.slice() }, coins: 0 };
    }
    const days = kept.concat(d).sort((a, b) => a - b);
    return {
        checkin: { version: CHECKIN_VERSION, month, days },
        coins: CHECKIN_REWARDS[(nextCount(c, today) - 1) % CHECKIN_REWARDS.length],
    };
}

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Read a save. ANY unexpected input yields a fresh one, and nothing here throws.
 *
 * Same contract as `parseWallet`: `''` is a missing key rather than a corrupt one, because that
 * is what WeChat's `getStorageSync` returns for a key never written, where a browser's `getItem`
 * returns null.
 *
 * `days` must be ascending, unique, and within 1..31. That is stricter than it needs to be to
 * avoid a crash, and deliberately so: those are properties `claim` always produces, so a save
 * without them has been edited, and the calendar it would draw is not one this card owes a
 * correct picture of.
 */
export function parseCheckin(raw: string | null): Checkin {
    if (!raw || !raw.trim()) return emptyCheckin();
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return emptyCheckin();
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return emptyCheckin();
    const obj = data as { version?: unknown; month?: unknown; days?: unknown; last?: unknown };

    if (obj.version === 1) return fromV1(obj.last);
    if (obj.version !== CHECKIN_VERSION) return emptyCheckin();

    const month = obj.month;
    if (typeof month !== 'string' || !MONTH_RE.test(month)) return emptyCheckin();
    if (!Array.isArray(obj.days)) return emptyCheckin();
    const days: number[] = [];
    let prev = 0;
    for (const d of obj.days) {
        if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 31) return emptyCheckin();
        if (d <= prev) return emptyCheckin();
        prev = d;
        days.push(d);
    }
    return { version: CHECKIN_VERSION, month, days };
}

/**
 * Carry a v1 save forward. Only `last` survives.
 *
 * `day` was a position in a 7-day streak, and a calendar has nowhere to put it -- there is no
 * "the run is at 5" independent of which days were actually claimed. Seeding the one day it does
 * know about buys the only thing worth keeping across the update: a player who already claimed
 * today cannot claim it again after installing this build.
 *
 * Seeded UNCONDITIONALLY, without asking whether `last` is in the current month, because this
 * function has no clock and should not need one. If `last` turns out to be last month's, the
 * stored month simply differs from today's and `canClaim` lets the claim through -- which is
 * exactly what an empty save would have done.
 */
function fromV1(last: unknown): Checkin {
    if (typeof last !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(last)) return emptyCheckin();
    const d = dayOf(last);
    if (!Number.isInteger(d) || d < 1 || d > 31) return emptyCheckin();
    return { version: CHECKIN_VERSION, month: monthOf(last), days: [d] };
}

export function serializeCheckin(c: Checkin): string {
    return JSON.stringify(c);
}
