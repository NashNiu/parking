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
 * The current level's badge breathes up to 1.26x, topping out at 102.5 x 1.26 = 129.2. The
 * binding case is a CLEARED stop sitting above a CURRENT one: the cleared stop's star row
 * reaches down to -161.5 and the current stop's badge reaches up to +129.2, so the two need
 * 161.5 + 129.2 + 30 (gap) = 320.7 to clear each other. 340 is that figure with about 19 units
 * of headroom, not a number measured to the millimetre. The old pill was only 148 tall, which
 * is why 272 was enough for it.
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
