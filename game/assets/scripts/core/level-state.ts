import { bestStars, Progress, unlockedThrough } from './progress';

/**
 * What a level looks like on the lobby screen, one of three.
 *
 * One function returning a union instead of three predicates, and the ORDER is the
 * priority -- that is the only design content in this file.
 *
 * Before this, `home-view` computed three things itself: `open = isUnlocked(...)`,
 * `best = bestStars(...)`, `done = best > 0`, then drew stars as `active = open && done`.
 * "Locked" and "has stars" are two independent facts that can both be true at once (a save
 * with a gap does exactly this: levels 1, 2, 3, 5 cleared, level 4 empty, so level 5 is both
 * locked AND holds three stars) -- relying on every call site to remember to `&&` them
 * together. Miss it once and that is a self-contradicting frame on screen.
 *
 * Collapsed into one function that returns a union, the three states are mutually exclusive
 * by construction -- a call site cannot come away holding both.
 */
export type LevelState = 'done' | 'current' | 'locked';

export function levelState(p: Progress, level: number): LevelState {
    // Lock is checked first, and lock wins. A gapped save where level 5 already has stars
    // still gets locked.
    //
    // Written as `!(level <= unlockedThrough(p))`, not `level > unlockedThrough(p)`: NaN
    // compares false against everything, so the `>` form would send `levelState(p, NaN)`
    // straight past the lock check, into `bestStars` (which returns 0 for a key that is not
    // there), and out as `'current'` -- "level NaN is the current level". Negated, NaN fails
    // the `<=` and lands on `'locked'`, which is the only answer that makes sense here.
    if (!(level <= unlockedThrough(p))) return 'locked';
    if (bestStars(p, level) > 0) return 'done';
    return 'current';
}

/**
 * How many stars to draw. Anything that is not `done` is 0, unconditionally.
 *
 * `view` should ask this and never call `bestStars` itself -- doing so would reintroduce a
 * second source of truth, and "locked but drawn with three stars" is exactly the kind of
 * picture a second source of truth produces.
 */
export function starsFor(p: Progress, level: number): number {
    return levelState(p, level) === 'done' ? bestStars(p, level) : 0;
}
