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
 * 340, up from 272, and that rise is a consequence of the round badges, not of taste: badge
 * diameter is 205 (16% of the 1280 design width), radius 102.5, and the stars sit BELOW the
 * badge, bottoming out at -161.5 (star centre at -(102.5 + 8 + 25.5) = -136, star radius 25.5).
 * The old pill was only 148 tall, which is why 272 was enough for it.
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
 * THE BINDING CASE is therefore a cleared badge's star row hanging over the badge below it,
 * and the badge below is at worst the one the rail is CENTRED on -- wearing its halo, which
 * reaches `102.5 + 15` = 117.5, and not scaled, because only the `current` badge breathes and
 * the `current` badge is never underneath a `done` one:
 *
 *     340 - 161.5 (star row) - 117.5 (halo) = 61.0
 *
 * against a 30 gap, so about 31 units of headroom. Every other reachable pair has more: the
 * loosest, two locked badges, has 112. 340 is pinned and generous, which costs nothing here --
 * a pitch that is too large only shows fewer levels, while one that is too small collides.
 *
 * The cost: about 7 levels visible on a tall phone (h ~ 2770), only a little over 3 on a 4:3
 * tablet (h ~ 1707). That is an accepted cost of a vertical rail, not something a second layout
 * is meant to fix.
 *
 * Both `home-path` (stop geometry) and `rail-math` (scroll arithmetic) need this value, so it
 * lives here, on the floor they share.
 */
export const RAIL_PITCH = 340;

/**
 * How far a stop sits from the centreline, alternating left and right.
 *
 * 210: two columns 420 apart, leaving the badge's outer edge 1280/2 - 210 - 102 = 328 from the
 * screen edge. A leg of dx=420 / dy=340 works out to about 51 degrees of slope -- enough to
 * read as winding, rather than as a line that wobbled twice.
 */
export const ZIG_X = 210;

/**
 * How many segments a leg is cut into.
 *
 * 6: the curve is shallow, so 6 segments keep the polyline's error under a pixel, and each
 * segment costs two sprites (road surface + kerb) plus a joint dot in the view layer. Sampling
 * more buys invisible smoothness at a linear drawing cost.
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
