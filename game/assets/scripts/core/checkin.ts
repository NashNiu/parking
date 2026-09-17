/**
 * The daily check-in streak: a save that tracks which day of a 7-day reward cycle the player
 * last claimed, and when.
 *
 * A SEPARATE save from `Progress` and `Wallet`, under its own key, because its lifetime
 * matches neither of theirs. It must not be wiped by a progress reset (a streak is not a level
 * result), and it must not be wiped by anything that clears the wallet either -- a coin reset
 * should not also hand the player a free re-roll of day 1's reward.
 *
 * Same failure policy as `wallet.ts` and for the same reason: this is read off the device on
 * the boot path, so anything unexpected comes back as `emptyCheckin()` and nothing throws.
 * Losing a streak costs the player a bonus; throwing on the boot path costs them the game.
 */
export interface Checkin {
    version: number;
    /** 0 before anything is ever claimed; 1..7 is the day of the cycle already claimed. */
    day: number;
    /** The `todayKey` of the most recent claim, or '' if there has never been one. */
    last: string;
}

export const CHECKIN_VERSION = 1;

/**
 * What each day of the 7-day cycle pays, indexed by day-1 (so index 0 is day 1's reward).
 *
 * Two short days, two medium days, two more short-ish days, then a jackpot on day 7 -- the
 * shape is deliberately front-loaded-then-a-payoff rather than a smooth ramp, so a player who
 * breaks the streak on day 2 or 3 has not given up much, and the one who makes it to day 7 gets
 * something worth the six days it took. The exact numbers are a design call, not a derived one;
 * they live here, in the one place both the state machine and its tests read them from.
 */
export const CHECKIN_REWARDS: readonly number[] = [20, 20, 30, 30, 40, 40, 100];

export function emptyCheckin(): Checkin {
    return { version: CHECKIN_VERSION, day: 0, last: '' };
}

/**
 * Read a save. ANY unexpected input yields a fresh one, and nothing here throws.
 *
 * Same contract as `parseWallet`: `''` is treated as a missing key rather than a corrupt one,
 * because that is what WeChat's `getStorageSync` returns for a key that was never written,
 * where a browser's `getItem` returns null. `day` is bounds-checked to 0..7 -- anything outside
 * that range cannot have come from `claim`, so it is not trusted enough to keep any part of.
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
    const obj = data as { version?: unknown; day?: unknown; last?: unknown };
    if (obj.version !== CHECKIN_VERSION) return emptyCheckin();
    const day = obj.day;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 7) return emptyCheckin();
    const last = obj.last;
    if (typeof last !== 'string') return emptyCheckin();
    return { version: CHECKIN_VERSION, day, last };
}

export function serializeCheckin(c: Checkin): string {
    return JSON.stringify(c);
}

/**
 * `now` as a `'YYYY-MM-DD'` key, in the DEVICE'S LOCAL time zone -- deliberately not UTC.
 *
 * A single-player game with no server has no clock more authoritative than the device it is
 * running on, so there is no "correct" time zone to convert to; UTC would just be a different
 * wrong one, and for a player in China it would flip the day at 08:00 local, in the middle of a
 * normal play session. Local time is the only choice that makes "a new day" mean what a player
 * standing in front of the device would call a new day.
 *
 * The cost is accepted, not overlooked: a player who winds their system clock forward claims
 * early, and one who winds it back can claim the same day twice. Both grant a few extra coins
 * in a game with no economy to protect and no other player to affect. That is cheap enough that
 * building any defense against it -- a server clock, a monotonic counter -- would spend more
 * effort than the exploit is worth.
 */
export function todayKey(now: Date): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Whether today's reward has not already been claimed. */
export function canClaim(c: Checkin, today: string): boolean {
    return c.last !== today;
}

/**
 * The day of the cycle a claim made `today` would land on, WITHOUT recording it.
 *
 * `claim` and `nextReward` both need this, and they need to agree, so it is computed once here
 * rather than duplicated: a streak continues (day + 1, wrapping 7 back to 1) only when `last`
 * is literally the calendar day before `today`; anything else -- never claimed, or a gap of any
 * size -- restarts at day 1. A missed day is not a partial streak; the cycle does not have a
 * notion of "day 3, but late," so there is nothing to preserve.
 */
function landingDay(c: Checkin, today: string): number {
    if (c.last === yesterdayOf(today)) {
        return c.day === 7 ? 1 : c.day + 1;
    }
    return 1;
}

/**
 * The `todayKey` of the calendar day before `today`.
 *
 * Built by constructing a local `Date` at midnight on `today` and stepping it back one day,
 * rather than by string arithmetic on the `'YYYY-MM-DD'` text -- `Date` already knows that
 * January 1st is preceded by December 31st of the PREVIOUS year, and that the last day of a
 * month varies. Re-deriving that with substring math would just be a worse copy of what `Date`
 * already does correctly, with none of the edge cases actually removed.
 */
function yesterdayOf(today: string): string {
    const [y, m, d] = today.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() - 1);
    return todayKey(date);
}

/**
 * Record a claim for `today`, returning the new save and the coins it pays.
 *
 * The save passed in is never mutated: the caller holds it as the current state, same as
 * `addCoins` in `wallet.ts`. This does not check `canClaim` itself -- the caller already has to,
 * to decide whether to show a claimable button at all, and a second silent check here would
 * just be a second place that rule could drift out of sync with the first.
 */
export function claim(c: Checkin, today: string): { checkin: Checkin; coins: number } {
    const day = landingDay(c, today);
    return {
        checkin: { version: CHECKIN_VERSION, day, last: today },
        coins: CHECKIN_REWARDS[day - 1],
    };
}

/** What `claim(c, today)` would pay right now, for showing the reward before it is claimed. */
export function nextReward(c: Checkin, today: string): number {
    return CHECKIN_REWARDS[landingDay(c, today) - 1];
}
