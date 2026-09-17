/**
 * The lobby road's geometry: where the stops sit, and how the road travels from one to the
 * next.
 *
 * This lives in core rather than view for the same reason `track-shapes.ts` / `track-path.ts`
 * do -- a geometric constraint has to be assertable without an engine. The constraint being
 * asserted here is "the path really passes through the stop centres": the old lobby's road was
 * a straight strip with a dashed centre line, and the stops sat off to either side of it, so
 * the road and the stops were two unrelated things. `legSamples(i)[0] === nodeCenter(i)` is one
 * line of test; seeing the same fact on screen takes staring.
 *
 * The coordinate system is the rail's own: y grows with i (level 1 is at the bottom, level
 * numbers climb upward), matching `rail-math`'s `railOffset`. The view is what maps this to
 * the screen.
 */

/**
 * Centre-to-centre distance between adjacent stops.
 *
 * DERIVED FROM THE USABLE BAND, not chosen by eye. On a 19.5:9 phone (h ~ 2770):
 *
 *     barBottom       = h/2 - top*h - w*0.03 - BAR_H     ~ +1099
 *     button top      = -h/2 + bottom*h + 90 + 116       ~ -1124
 *     usable band                                         ~ 2223
 *     2223 / 7.5 badges                                  ~ 296
 *
 * 290, close to that 296 and rounder, giving 7.7 badges on the band above -- the seven-or-eight
 * a screen the requirement asks for. Badge diameter is now 170 (see `NODE_D` in `home-view`),
 * radius 85, and the stars sit BELOW the badge, bottoming out at -136 (star centre at
 * -(85 + 8 + 21.5) = -114.5, star radius 21.5). The old 340/205 pair, and the 272/148-tall pill
 * before that, are both gone.
 *
 * CHECK WHICH ADJACENCIES ARE REACHABLE BEFORE SIZING AGAINST THEM. This is the trap, and
 * three revisions of this paragraph have now fallen into it -- twice by arithmetic, once by
 * sizing the pitch against a pair of badges no save can produce. `levelState` is MONOTONIC up
 * the rail: `unlockedThrough` is the first level with no stars, so the states always read
 * done...done, current, locked...locked, and the only adjacent pairs that exist are
 * (done, done), (done, current), (current, locked) and (locked, locked). A `done` badge
 * directly ABOVE a `current` one is not one of them -- a `done` at i+1 forces i <= k-2, which
 * makes i `done` as well -- so the breathing badge's 1.26x top edge never has to clear a star
 * row at all. Enumerated over all 1024 reachable ten-level saves: eleven distinct state
 * strings, none of them with that pair in it.
 *
 * THE BINDING CASE is therefore a CLEARED badge's star row hanging over the CLEARED badge below
 * it -- (done, done) is the only reachable pair whose UPPER badge is `done` at all, since stars
 * only ever hang off a `done` badge's own row:
 *
 *     290 - 136 (star row reaches -136) - 85 (badge below, scale 1.0, no glow -- `done` never
 *     wears the glow either) = 69
 *
 * Every other reachable pair has more room. THE CURRENT BADGE'S EXTENT IS ITS GLOW, 126 at full
 * breath -- `(85 + CUR_GLOW_PAD) x 1.26`, and the glow is a concentric disc, so that is its
 * reach in EVERY direction, above as well as below. Writing 107 for its top edge and 126 for
 * its bottom in the same paragraph is the arithmetic slip this docblock has already been
 * rewritten four times to avoid, and it was in here once more:
 *
 *     (current, locked)  290 - 126 (glow, above) - 68 (locked, 85 x 0.8) =  96
 *     (done, current)    290 - 126 (glow, below) - 85 (done below it)    =  79
 *     (locked, locked)   290 -  68 -  68                                 = 154
 *
 * 69 is the tightest of the four and is comfortably clear of the two shapes ever touching. 290 is not stretched to chase a bigger
 * margin here -- a pitch that is too large only shows fewer levels, while one that is too small
 * collides.
 *
 * The cost: about 7.7 levels visible on a tall phone (h ~ 2770), a little under 4 on a 4:3
 * tablet (h ~ 1707). That is an accepted cost of a vertical rail, not something a second layout
 * is meant to fix.
 *
 * Both `home-path` (stop geometry) and `rail-math` (scroll arithmetic) need this value, so it
 * lives here, on the floor they share.
 */
export const RAIL_PITCH = 290;

/**
 * How far a stop sits from the centreline, alternating left and right.
 *
 * 210: two columns 420 apart, leaving the badge's outer edge 1280/2 - 210 - 85 = 345 from the
 * screen edge. A leg of dx=420 / dy=290 works out to about 55 degrees of slope -- enough to
 * read as winding, rather than as a line that wobbled twice.
 */
export const ZIG_X = 210;

/**
 * How many segments a leg is cut into.
 *
 * 6: the curve is shallow, so 6 segments keep the polyline's error under a pixel, and each
 * segment costs exactly two sprites in the view layer -- one of road surface, one of kerb.
 * There used to be a joint dot at every sample as well, and there is not any more: `home-scene`
 * strokes each chord as a capsule (corner radius exactly half the stroke width), which already
 * contains the whole disc at either end, so the dots were 126 sprites drawn inside shapes that
 * were already there. Sampling more buys invisible smoothness at a linear drawing cost.
 */
export const SAMPLES_PER_LEG = 6;

export interface PathPoint {
    x: number;
    y: number;
}

/** The centre of stop `i`. i starts at 0, corresponding to level i + 1. */
export function nodeCenter(i: number): PathPoint {
    return { x: i % 2 === 0 ? -ZIG_X : ZIG_X, y: i * RAIL_PITCH };
}

/**
 * Sample points walking from stop `i` to stop `i + 1`, endpoints included.
 *
 * A cubic Bezier whose two control points reach out VERTICALLY, half a pitch from each end:
 *
 *     P0 = nodeCenter(i)
 *     P1 = (P0.x, P0.y + RAIL_PITCH / 2)
 *     P2 = (P3.x, P3.y - RAIL_PITCH / 2)
 *     P3 = nodeCenter(i + 1)
 *
 * Reaching out vertically is the whole trick -- it buys three specific things. One, the
 * tangent at every stop is vertical, so consecutive legs join smoothly (C1 continuous) and the
 * road never kinks at a stop. Two, all four control points have x of +-ZIG_X, and a Bezier
 * always stays inside its control points' convex hull, so the curve can never swing outside
 * the stop columns. Three, the y derivative is 3[(h/2)(1-t)^2 + (h/2)t^2], strictly positive,
 * so the road never doubles back.
 *
 * Evaluating at t = 0 and t = 1 is exact -- the other three Bernstein terms are multiplied by
 * zero -- so the endpoints EQUAL the stop centres rather than merely approximating them, which
 * is why the test can use `toEqual` instead of `toBeCloseTo`.
 */
export function legSamples(i: number): PathPoint[] {
    const p0 = nodeCenter(i);
    const p3 = nodeCenter(i + 1);
    const p1 = { x: p0.x, y: p0.y + RAIL_PITCH / 2 };
    const p2 = { x: p3.x, y: p3.y - RAIL_PITCH / 2 };
    const out: PathPoint[] = [];
    for (let k = 0; k <= SAMPLES_PER_LEG; k++) {
        const t = k / SAMPLES_PER_LEG;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        out.push({
            x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
            y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
        });
    }
    return out;
}
