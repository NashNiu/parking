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
 * RE-DERIVED FROM SCRATCH FOR THE 128 BADGE, not scaled from the number this constant held
 * against the 170 one. That distinction matters here specifically: five earlier versions of
 * this docblock (three against 170, and one more written after the badge had already shrunk to
 * 128 without this constant being revisited -- see `home-view.ts`'s own note on `STAR_Y`) all
 * got the clearance table wrong, every time in the same place. So this re-reads what the badge
 * currently draws (`home-view.ts`) and what the save can currently produce
 * (`core/level-state.ts`) before writing a single number down.
 *
 * DERIVED FROM THE USABLE BAND FIRST, because that is what actually decides the pitch -- the
 * collision check below only has to CONFIRM the band's answer does not collide, and at these
 * sizes it does so with room to spare. On a 19.5:9 phone (h ~ 2770, w pinned at 1280):
 *
 *     barBottom       = h/2 - top*h - w*0.03 - BAR_H     ~ +1099
 *     button top      = -h/2 + bottom*h + 90 + 116       ~ -1124
 *     usable band                                         ~ 2223
 *     2223 / 7.5 badges                                  ~ 296
 *
 * 290, close to that 296 and rounder, gives 7.7 badges on the band above -- the seven-or-eight a
 * screen the requirement asks for. This is exactly the reasoning the 170-badge version of this
 * docblock used, and it lands on the same number for a reason worth stating rather than hiding:
 * the usable band is a fact about `barBottomY`, `START_MARGIN` and `START_H`, none of which moved
 * when the badge shrank, so nothing here forces the target pitch to move either. It is the
 * COLLISION side of the derivation that changes, not the band side.
 *
 * CHECK WHICH ADJACENCIES ARE REACHABLE BEFORE SIZING AGAINST THEM. This is the trap, and every
 * wrong revision of this paragraph has fallen into it. `levelState` is MONOTONIC up the rail:
 * `unlockedThrough` is the first level with no stars, so the states always read
 * done...done, current, locked...locked, and the only adjacent pairs that exist are
 * (done, done), (done, current), (current, locked) and (locked, locked). A `done` badge
 * directly ABOVE a `current` one is not one of them -- a `done` at i+1 forces i <= k-2, which
 * makes i `done` as well. Read straight off `level-state.ts`: lock is checked first and wins
 * (`!(level <= unlockedThrough(p))`), so nothing above the unlocked frontier is ever `done` and
 * nothing at or below it is ever `locked`. Enumerated over all 1024 reachable ten-level saves:
 * eleven distinct state strings, none of them with a `done` directly above a `current`.
 *
 * A BADGE IS NOT SYMMETRIC ABOUT ITS CENTRE. `NODE_D` is 128 (radius 64), and the badge reaches
 * `64 x scale` UP but `(64 + NODE_EDGE + NODE_LIFT) x scale` = `83 x scale` DOWN. That extra
 * reach is the EDGE DISC, not the base -- the base alone (radius 64, offset `NODE_LIFT` (15)
 * down) only reaches 79, but the edge disc drawn behind it is `NODE_D + 2 x NODE_EDGE` = 136
 * wide (radius 68) at that SAME offset, reaching `68 + 15` = 83, two units past the base's own
 * thickness. That is exactly the trap the heading names: the edge, not the base, is the badge's
 * true lower reach. The current badge also wears the bright outline (`NODE_HI_D`, radius 66,
 * concentric at the node's own centre -- no offset), reaching 66 in EVERY direction: past the
 * plain face's 64 on the way up, still short of the edge's 83 on the way down. Every one of
 * those discs -- face, base, edge, outline -- is a child of the same node `layout()` scales, so
 * EVERY LAYER OF THE CURRENT BADGE SCALES WITH THE BREATHE TWEEN, up to `BREATHE_TO` (1.26), not
 * merely the face.
 *
 * THE STAR ROW HANGS BELOW A `done` BADGE ONLY -- `starsFor` returns 0 for `current` and
 * `locked`, so a breathing or locked badge never has to clear a star row, and a `done` badge
 * never breathes or shrinks (its scale is fixed at 1.0). Three stars at `STAR_PITCH` (37) either
 * side of centre, radius `STAR_D / 2` (16), centred at `STAR_Y` = -95: the row's lowest point is
 * `-(95 + 16)` = -111, ten units past the plain badge's own -83.
 *
 * THE BINDING CASE is therefore a `done` badge's star row hanging over the `done` badge below
 * it -- (done, done) is the only reachable pair whose UPPER badge is `done` at all, since a star
 * row only ever hangs off a `done` badge's own row:
 *
 *     290 - 111 (star row reaches -111) - 64 (badge below, scale 1.0 -- the face's own 64 beats
 *     the edge's 53 on the way up) = 115
 *
 *     pair (lower, upper)                          upper reaches down       lower reaches up
 *     (done, done)     290 - 111 - 64    = 115     star row, -111           64
 *     (done, current)  290 - 104.6 - 64  = 121.4   edge x 1.26, 104.6       64
 *     (current, lock)  290 - 66.4 - 83.2 = 140.4   edge x 0.8, 66.4         outline x 1.26, 83.2
 *     (lock, lock)     290 - 66.4 - 51.2 = 172.4   edge x 0.8, 66.4         edge x 0.8, 51.2
 *
 * 115 is the tightest of the four -- comfortably positive, and far larger than the 170 badge's
 * own tightest figure (69) was against ITS pitch, because a smaller badge asks less of the same
 * 290. That is why this re-derivation lands on the pitch the earlier one did: the band target
 * (296, rounded to 290) was always the tighter of the two constraints, and shrinking the badge
 * only slackened the one that used to run second. 290 is not being kept because it used to be
 * the answer; it is being kept because re-solving both halves of the problem again, against the
 * smaller badge, still gives the same number.
 *
 * ALL OF THAT IS A VERTICAL PROJECTION, and therefore a conservative bound rather than the real
 * gap. Adjacent stops are `2 x ZIG_X` = 420 apart across the screen as well as 290 up it, so the
 * true centre-to-centre distance is about 510 (`sqrt(290^2 + 420^2)`), and the closest the
 * binding pair's shapes actually come is well past the 115 the vertical bound alone suggests.
 * The bound is still the right one to size against -- it stays correct however the badges move
 * horizontally -- but a reader straightening the rail toward a smaller `ZIG_X` should know that
 * 115 is the number that would start to bite, and that it is nowhere near biting today.
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
 * segment costs exactly two sprites in the view layer -- one of road surface, one of the hard
 * shadow under it. It used to be road and KERB; the kerb went (it read as a blurred ring, not
 * as a lip) and the shadow took its place, which leaves the count where it was.
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
