import { bestStars, Progress } from './progress';
import { STAR_MAX } from './types';

/**
 * The player's coin balance.
 *
 * A SEPARATE save from `Progress`, under its own key, but unlike `settings` it does NOT
 * outlive progress -- wiping progress wipes the wallet with it. That is the opposite call
 * from settings for a reason specific to coins: they are DERIVED from progress (clearing a
 * level is the only way to earn one), so keeping the two saves apart would turn "clear ->
 * wipe -> clear again" into an unlimited coin mint. Wiping both costs the same one action
 * either way, so nothing is lost by tying their lifetimes together.
 *
 * Failure policy is copied from `progress.ts`, for the same reason: this is read off the
 * device on the boot path, so anything unexpected comes back as an empty wallet and nothing
 * throws. Losing a balance costs the player their coins; throwing on the boot path costs them
 * the game.
 */
export interface Wallet {
    version: number;
    coins: number;
}

export const WALLET_VERSION = 1;

export function emptyWallet(): Wallet {
    return { version: WALLET_VERSION, coins: 0 };
}

export function parseWallet(raw: string | null): Wallet {
    if (!raw || !raw.trim()) return emptyWallet();
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return emptyWallet();
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return emptyWallet();
    const obj = data as { version?: unknown; coins?: unknown };
    if (obj.version !== WALLET_VERSION) return emptyWallet();
    const coins = obj.coins;
    // Integer, finite, non-negative: a fraction is not a number of coins, a negative one is
    // not a balance, and NaN/Infinity are neither. Falling back to an empty wallet rather than
    // clamping to 0 is deliberate -- a balance that fails this check is not trustworthy enough
    // to keep any part of, so an unreadable balance and no balance are the same outcome here.
    if (typeof coins !== 'number' || !Number.isInteger(coins) || coins < 0) return emptyWallet();
    return { version: WALLET_VERSION, coins };
}

export function serializeWallet(w: Wallet): string {
    return JSON.stringify(w);
}

/** Add coins, returning a new wallet. The one passed in is left untouched, because the
 * caller holds it as the current state. */
export function addCoins(w: Wallet, n: number): Wallet {
    const add = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    return { version: WALLET_VERSION, coins: w.coins + add };
}

/**
 * What each star rating is worth, CUMULATIVELY -- the index is the star count, so 0 stars is
 * worth nothing.
 *
 * Cumulative, not an increment, is what lets a replay that earns a better rating pay only the
 * difference: the payout depends on the best result a level has ever earned, not on how many
 * times it has been played. Without that, clearing the same level twice at the same rating
 * would pay out twice for one result.
 */
const COIN_FOR_STARS = [0, 25, 40, 60];

/**
 * How many coins this clear is worth: the difference between what the new rating is worth and
 * what the previous best was worth. A rating that matches or falls short of the previous best
 * pays 0 -- it never pays negative, so a worse replay cannot claw coins back.
 *
 * The caller MUST call this BEFORE `recordClear`, not after: `recordClear` updates the best
 * rating in place of the old one, so asking afterwards compares the new best against itself
 * and always yields 0.
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
 * existed for every clear that is now sitting in `p`.
 *
 * This is the backfill's derivation, for a save whose stars predate the wallet subsystem: the
 * balance such a save shows is stuck at whatever it happened to be when the wallet was
 * introduced (often 0), even though the stars already earned it more. `coinsForClear` cannot
 * retroactively pay that out -- it pays the DIFFERENCE between an old best and a new one at
 * the moment of a clear, and there is no "moment" left to attach a past clear to.
 *
 * Reads `COIN_FOR_STARS` (via `tier`) directly per level rather than replaying `coinsForClear`
 * level by level: `tier` already IS the cumulative figure for a rating, so the per-level
 * clear history that `coinsForClear` would need to walk is not required, and is not even
 * available here -- `Progress` keeps only each level's best rating, not how it was reached.
 * Getting this backwards -- treating `COIN_FOR_STARS` as a per-star increment and multiplying
 * it up -- is the one way to make this silently wrong, since the table is cumulative already.
 *
 * `levelCount` is a parameter rather than a constant this module reads, so the function stays
 * pure and does not need to know how many levels the game ships with; the caller (`Progress`
 * has no idea either) is the one place that counts the bundle.
 *
 * This function only computes a figure -- it does not read or write a `Wallet`, so it cannot
 * itself lower a balance or reopen the "clear -> wipe -> clear again" farm the wallet's own
 * docblock describes. Both of those are properties of how the CALLER uses the result (see
 * `GameController`'s load-path wiring), not of this derivation.
 */
export function coinsFromProgress(p: Progress, levelCount: number): number {
    let total = 0;
    for (let level = 1; level <= levelCount; level++) {
        total += tier(bestStars(p, level));
    }
    return total;
}
