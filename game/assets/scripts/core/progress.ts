import { STAR_MAX } from './types';

/**
 * The player's saved progress: the best star rating each level has been cleared with.
 *
 * That one record is the whole save, and it is also the gate -- which levels are open is
 * derived from it (`unlockedThrough`) rather than stored beside it, because two copies of one
 * fact eventually disagree.
 *
 * String keys, because that is what `JSON.parse` yields for an object. Typing them as numbers
 * would read better and be a lie the compiler cannot catch.
 */
export interface Progress {
    version: number;
    stars: { [level: string]: number };
}

/**
 * The version this build writes, stored INSIDE the JSON rather than in the storage key.
 *
 * A versioned key name would leave old data addressable only by a key the new code no longer
 * looks at -- readable in principle, invisible in practice. In the payload, a later build can
 * still open what this one wrote and decide what to do with it.
 */
export const PROGRESS_VERSION = 1;

export function emptyProgress(): Progress {
    return { version: PROGRESS_VERSION, stars: {} };
}

/**
 * Read a save. ANY unexpected input yields a fresh one, and nothing here throws.
 *
 * What comes back from the device is untrusted input: written by an older build, hand-edited,
 * truncated, or never there. Losing a save costs the player their stars; throwing on the boot
 * path costs them the game, because this runs before the first screen.
 *
 * `''` is a missing key, not a corrupt one: that is what WeChat's `getStorageSync` returns
 * where a browser's `getItem` returns null. The two must be indistinguishable here.
 *
 * Within a READABLE save, one bad entry does not condemn the rest -- ratings are clamped into
 * the scale and keys that are not level numbers are dropped. Rejecting the whole file for one
 * bad row would throw away every good record with it.
 */
export function parseProgress(raw: string | null): Progress {
    if (!raw || !raw.trim()) return emptyProgress();
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return emptyProgress();
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return emptyProgress();
    const obj = data as { version?: unknown; stars?: unknown };
    if (obj.version !== PROGRESS_VERSION) return emptyProgress();
    const stars = obj.stars;
    if (typeof stars !== 'object' || stars === null || Array.isArray(stars)) {
        return emptyProgress();
    }

    const out = emptyProgress();
    for (const key of Object.keys(stars as object)) {
        // `Number(key)` and not `parseInt`: parseInt('1e3') is 1, and parseInt('12abc') is 12,
        // so a junk key would be silently accepted as a level. The round-trip comparison also
        // rejects '01' and ' 1', which are not keys this ever writes.
        const level = Number(key);
        if (!Number.isInteger(level) || level < 1 || String(level) !== key) continue;
        const value = (stars as Record<string, unknown>)[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        // Zero and below mean "not cleared", which is not a record worth keeping; a fraction
        // is not a number of stars. Rounding up rather than down so a 2.7 is not demoted to a
        // rating the player never earned.
        const stars_ = Math.min(STAR_MAX, Math.ceil(value));
        if (stars_ < 1) continue;
        out.stars[level] = stars_;
    }
    return out;
}

export function serializeProgress(p: Progress): string {
    return JSON.stringify(p);
}

/** The best rating `level` has been cleared with, or 0 if it never has. */
export function bestStars(p: Progress, level: number): number {
    return p.stars[level] ?? 0;
}

/**
 * Record a clear, keeping the better result, and say whether anything changed.
 *
 * `changed` is what decides whether the caller writes, and writing here is a SYNCHRONOUS call
 * on the device -- so a re-clear that beats nothing has to report false rather than leaving
 * every caller to compare two saves for itself.
 *
 * The save passed in is never mutated: the caller holds it as the current state, and a
 * function that edited it in place would make `changed: false` a lie about what it just did.
 */
export function recordClear(
    p: Progress, level: number, stars: number,
): { progress: Progress; changed: boolean } {
    const rating = Math.max(1, Math.min(STAR_MAX, Math.ceil(stars)));
    if (rating <= bestStars(p, level)) return { progress: p, changed: false };
    return {
        progress: { version: PROGRESS_VERSION, stars: { ...p.stars, [level]: rating } },
        changed: true,
    };
}

/**
 * One past the longest RUN of cleared levels starting at level 1.
 *
 * A RUN, not a count, and that distinction is the whole gate. A player who reaches level 3
 * through the developer picker and clears it holds a record at 3 with nothing at 2 -- and
 * that must not open level 4. Counting cleared levels would open it.
 *
 * On a fully cleared save this reports one PAST the series (11 for ten levels). The caller
 * caps it against however many levels there are; this function cannot, because it has no idea
 * how many exist.
 */
export function unlockedThrough(p: Progress): number {
    let n = 1;
    while (bestStars(p, n) > 0) n++;
    return n;
}

/** Whether `level` can be played. Level 1 always can, including on a save that never was. */
export function isUnlocked(p: Progress, level: number): boolean {
    return level <= unlockedThrough(p);
}
