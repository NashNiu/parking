import { bestStars, Progress } from './progress';
import { STAR_MAX } from './types';

/**
 * The player's coins, as a LEDGER the balance is derived from rather than as a stored number.
 *
 * WHY THE BALANCE IS NOT STORED. Coins can now be spent (a parking stall costs some), and the
 * moment there are two ways for the number to move there are two ways for a stored number and
 * a list of reasons to disagree. Nothing in a single-player game reconciles them: a wrong
 * balance shows up only as a player looking at a list of rows that does not add up to the
 * figure above it, and only if they look. Deriving the figure makes that state unreachable.
 *
 * A SEPARATE SAVE from `Progress`, under its own key, that does NOT outlive it -- wiping
 * progress wipes this too. `storage.clearWalletText` owns that argument.
 *
 * Failure policy is copied from `progress.ts`: this is read off the device on the boot path,
 * so anything unexpected comes back as an empty wallet and nothing throws. Losing a balance
 * costs the player their coins; throwing on the boot path costs them the game.
 */
export interface Wallet {
    version: number;
    /** What the balance was before the oldest surviving row. See `LEDGER_MAX`. */
    opening: number;
    /** Oldest first, newest last. At most `LEDGER_MAX` long. */
    log: LedgerEntry[];
}

export interface LedgerEntry {
    /** Unix ms, from the caller's clock -- core never reads one. */
    t: number;
    why: CoinReason;
    /** Signed: income positive, spending negative. NEVER 0 -- a zero row is not a movement. */
    n: number;
    /** `clear`/`unlock`: the level. `checkin`: which day of the month's run. `carryover`: 0. */
    ref: number;
    /**
     * `clear` only: the star rating this payout was for.
     *
     * It cannot be recovered from `n`, because the payout is a DIFFERENCE -- a `+15` is two
     * stars becoming three on one level and something else on another -- and the ledger panel
     * prints the rating. Kept as its own optional field rather than encoded into `ref`, which
     * already means a different thing per `why`; a second meaning stacked on top would force
     * every reader to branch on `why` to decode it, and every branch is somewhere to be wrong.
     */
    extra?: number;
}

export type CoinReason = 'clear' | 'checkin' | 'unlock' | 'carryover';

export const WALLET_VERSION = 2;

/**
 * How many rows the ledger keeps. Older ones are folded into `opening` and dropped -- the
 * DETAIL is lost, never the money, which is what keeps `balance` exact for the life of a save.
 *
 * A cap at all, because writing is a synchronous call on the device and the whole array is
 * re-serialised on every write; an uncapped log makes each save slower than the last.
 */
export const LEDGER_MAX = 100;

/**
 * What the Nth unlock IN A LEVEL costs. Index is `ParkingSystem.unlocksUsed()`, which resets
 * with each level because the bay is rebuilt.
 *
 * Rising, not flat: the first rescue has to be cheap enough that a player with almost nothing
 * can still take it (otherwise the prompt is greyed out for everyone who needs it most), and
 * the third has to be dear enough to be a real decision. One price cannot do both.
 */
export const UNLOCK_PRICES: readonly number[] = [20, 40, 80];

export function emptyWallet(): Wallet {
    return { version: WALLET_VERSION, opening: 0, log: [] };
}

/** The one true balance. See the interface docblock for why it is computed, not stored. */
export function balance(w: Wallet): number {
    let total = w.opening;
    for (const e of w.log) total += e.n;
    return total;
}

/**
 * The price of opening one more stall, given how many this level has already opened.
 *
 * Clamps past BOTH ends of the table rather than returning `undefined`: an undefined price
 * becomes `NaN` coins, which compares false against every balance check and would hand the
 * stall over for free, silently. The level data ships three stalls for sale, so the high end
 * is unreachable today -- and that is exactly why it must not depend on staying unreachable.
 */
export function unlockPrice(unlocksUsed: number): number {
    const last = UNLOCK_PRICES[UNLOCK_PRICES.length - 1];
    if (!Number.isFinite(unlocksUsed)) return last;
    const i = Math.max(0, Math.floor(unlocksUsed));
    return i >= UNLOCK_PRICES.length ? last : UNLOCK_PRICES[i];
}

/**
 * A usable amount, or 0 for anything that is not one.
 *
 * Both `earn` and `spend` take a POSITIVE count and apply their own sign, so a negative input
 * is a caller with its sign backwards -- refused rather than quietly turned into its opposite.
 */
function amount(n: number): number {
    return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Append a row, folding as many of the oldest as necessary into `opening`.
 *
 * A LOOP, not "drop the first one". Only one row is ever appended at a time, so one pass is
 * all this normally does -- but a save that arrives already over the cap (hand-edited, or
 * written by a build with a larger cap) is brought back inside it by the same code, instead of
 * staying one over forever.
 */
function append(w: Wallet, e: LedgerEntry): Wallet {
    const log = w.log.concat(e);
    let opening = w.opening;
    while (log.length > LEDGER_MAX) opening += log.shift()!.n;
    return { version: WALLET_VERSION, opening, log };
}

/**
 * Take coins in. Returns a new wallet -- or THE SAME ONE when `n` is not a usable amount.
 *
 * The identity is load-bearing, not an optimisation: the caller writes to the device only when
 * something actually moved, and the payout for re-clearing a level at a rating already held is
 * legitimately 0. `===` is how it tells "nothing happened" from "0 coins were added", without
 * re-deriving the judgement this function just made.
 */
export function earn(
    w: Wallet, why: CoinReason, n: number, ref: number, now: number, extra?: number,
): Wallet {
    const add = amount(n);
    if (add === 0) return w;
    const e: LedgerEntry = { t: now, why, n: add, ref };
    if (extra !== undefined) e.extra = extra;
    return append(w, e);
}

/**
 * Pay coins out, or REFUSE with `null` when the balance will not cover it.
 *
 * `null`, not a thrown error and not the wallet unchanged. Unchanged is the dangerous one: a
 * caller that ignored it would open the stall anyway and never find out, which is the exact
 * failure this whole subsystem exists to make impossible. `null` cannot be used as a wallet,
 * so the compiler makes the caller answer for it.
 *
 * `n` is POSITIVE -- this function applies the sign. See `amount`.
 */
export function spend(
    w: Wallet, why: CoinReason, n: number, ref: number, now: number,
): Wallet | null {
    const cost = amount(n);
    if (cost === 0) return w;
    if (balance(w) < cost) return null;
    return append(w, { t: now, why, n: -cost, ref });
}

/** What a load off the device yielded, and whether it came from a v1 save. See `parseWallet`. */
export interface WalletLoad {
    wallet: Wallet;
    /**
     * True ONLY for a readable v1 save. It is what gates the one-time star backfill, so it must
     * not be true for a corrupt save -- see `parseWallet`.
     */
    fromLegacy: boolean;
}

const REASONS: readonly string[] = ['clear', 'checkin', 'unlock', 'carryover'];

/**
 * Read a save. ANY unexpected input yields an empty wallet, and nothing here throws.
 *
 * Three paths, and the difference between the last two is the whole point of `fromLegacy`:
 *
 *   version 2, valid  -> as written. NEVER backfilled again.
 *   version 1         -> its balance becomes `opening`. Backfilled once.
 *   anything else     -> empty. NOT backfilled.
 *
 * A CORRUPT SAVE IS NOT A MIGRATION, and that asymmetry is deliberate. The backfill pays out
 * what the player's stars say they should have been paid; run it on a corrupt save and editing
 * the wallet key to garbage becomes a refund button for every coin ever spent. A player whose
 * save is genuinely corrupt loses the balance instead, which is what `parseWallet` has always
 * done with an unreadable one.
 */
export function parseWallet(raw: string | null): WalletLoad {
    const empty: WalletLoad = { wallet: emptyWallet(), fromLegacy: false };
    if (!raw || !raw.trim()) return empty;
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return empty;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return empty;
    const obj = data as { version?: unknown; coins?: unknown; opening?: unknown; log?: unknown };

    if (obj.version === 1) {
        const coins = obj.coins;
        if (typeof coins !== 'number' || !Number.isInteger(coins) || coins < 0) return empty;
        return { wallet: { version: WALLET_VERSION, opening: coins, log: [] }, fromLegacy: true };
    }
    if (obj.version !== WALLET_VERSION) return empty;

    const opening = obj.opening;
    if (typeof opening !== 'number' || !Number.isInteger(opening) || opening < 0) return empty;
    if (!Array.isArray(obj.log)) return empty;

    // One bad row condemns the whole save, UNLIKE `parseProgress`, which drops bad entries and
    // keeps the rest. The difference is that progress rows are independent records while these
    // rows ARE the balance: drop one and every figure below it is quietly wrong, with no sign
    // that anything was discarded. A wallet that cannot be read exactly is not worth reading.
    const log: LedgerEntry[] = [];
    for (const row of obj.log) {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) return empty;
        const r = row as { t?: unknown; why?: unknown; n?: unknown; ref?: unknown; extra?: unknown };
        if (typeof r.t !== 'number' || !Number.isFinite(r.t)) return empty;
        if (typeof r.why !== 'string' || !REASONS.includes(r.why)) return empty;
        if (typeof r.n !== 'number' || !Number.isInteger(r.n) || r.n === 0) return empty;
        if (typeof r.ref !== 'number' || !Number.isInteger(r.ref) || r.ref < 0) return empty;
        const e: LedgerEntry = { t: r.t, why: r.why as CoinReason, n: r.n, ref: r.ref };
        if (r.extra !== undefined) {
            if (typeof r.extra !== 'number' || !Number.isInteger(r.extra)) return empty;
            e.extra = r.extra;
        }
        log.push(e);
    }

    // Replayed through `append` itself, so the cap has exactly one implementation -- not a
    // second copy of the eviction rule that could drift from the one `earn`/`spend` use.
    let w: Wallet = { version: WALLET_VERSION, opening, log: [] };
    for (const e of log) w = append(w, e);

    // A negative balance cannot have come from `spend`, which refuses to create one, so a save
    // showing it has been edited and is not trustworthy enough to keep any part of.
    if (balance(w) < 0) return empty;
    return { wallet: w, fromLegacy: false };
}

export function serializeWallet(w: Wallet): string {
    return JSON.stringify(w);
}

/**
 * What each star rating is worth, CUMULATIVELY -- the index is the star count, so 0 stars is
 * worth nothing.
 *
 * Cumulative, not an increment, is what lets a replay that earns a better rating pay only the
 * difference: the payout depends on the best result a level has ever earned, not on how many
 * times it has been played. Without that, clearing the same level twice at the same rating
 * would pay out twice for one result -- and that is the only farm this economy could have.
 */
const COIN_FOR_STARS = [0, 25, 40, 60];

/**
 * How many coins this clear is worth: the difference between what the new rating is worth and
 * what the previous best was worth. A rating that matches or falls short pays 0.
 *
 * The caller MUST call this BEFORE `recordClear`: `recordClear` replaces the best rating, so
 * asking afterwards compares the new best against itself and always yields 0.
 */
export function coinsForClear(prevBest: number, newStars: number): number {
    return Math.max(0, tier(newStars) - tier(prevBest));
}

/** Clamp any input into an integer 0..STAR_MAX tier and look up its payout. NaN clamps to 0. */
function tier(stars: number): number {
    if (!Number.isFinite(stars)) return COIN_FOR_STARS[0];
    const i = Math.max(0, Math.min(STAR_MAX, Math.floor(stars)));
    return COIN_FOR_STARS[i];
}

/**
 * The total a player WOULD have been paid, across levels 1..`levelCount`, had the wallet
 * existed for every clear now sitting in `p`.
 *
 * Reads the payout table per level rather than replaying `coinsForClear` level by level:
 * `tier` already IS the cumulative figure for a rating, and `Progress` keeps only each level's
 * best rating, not how it was reached. Treating the table as a per-star increment and
 * multiplying it up is the one way to make this silently wrong -- it is cumulative already.
 */
export function coinsFromProgress(p: Progress, levelCount: number): number {
    let total = 0;
    for (let level = 1; level <= levelCount; level++) {
        total += tier(bestStars(p, level));
    }
    return total;
}

/**
 * Top a save up to what its stars would have paid, as a `carryover` ROW.
 *
 * RAISES, NEVER LOWERS. That asymmetry used to be this function's whole justification and is
 * now only half of it, because THE OTHER HALF MOVED TO THE CALL SITE. When coins could only
 * come in, running this on every boot was harmless. Once they can be spent it is a refund: a
 * player who paid 80 for a stall boots with a balance below the derived figure and gets the 80
 * back. `parseWallet`'s `fromLegacy` is what stops that -- this runs ONCE, on a v1 save, and
 * never again. Read `parseWallet`'s docblock with this one; neither is safe alone.
 *
 * Writes a row rather than setting a balance, because the balance is not a field any more:
 * `balance` is `opening` plus the log, so a top-up that skipped the log would break the one
 * invariant the whole model rests on.
 *
 * RETURNS THE SAME OBJECT when nothing is owed, so a caller can tell "unchanged" from "raised"
 * with `===` and skip the device write.
 */
export function backfilledWallet(
    w: Wallet, p: Progress, levelCount: number, now: number,
): Wallet {
    const owed = coinsFromProgress(p, levelCount) - balance(w);
    if (owed <= 0) return w;
    return earn(w, 'carryover', owed, 0, now);
}
