import { Color, Layers, Node, UITransform } from 'cc';
import { legSamples, nodeCenter, PathPoint, ZIG_X } from '../core/home-path';
import { dotSprite, roundedSprite } from './ui-shapes';
import { COLORS } from './colors';
import { LAWN, PAVING, ROAD, ROAD_LINE, shade } from './palette';
import { SHADOW_INK } from './shadow';

/**
 * The lobby's street: flat, orthographic, top-down, and drawn entirely at runtime by
 * `ui-shapes`.
 *
 * WHAT IT REPLACES is a photograph -- one painted 1440x3360 street, `home-bg.jpg`, with a
 * translucent strip laid up the middle of it for the stops to ride on. Two things were wrong
 * with that, and neither was fixable by retouching. STYLE: the board is a flat blue-grey
 * diagram and the lobby was a picture with depth of field in it, so the game's first screen
 * and its second screen did not look like the same product. RIGHTS: it was a realistic painted
 * image and there was no clean provenance for shipping it. The strip on top had a defect of
 * its own -- it had to stay translucent for the photograph to read through, and at that
 * opacity its two straight edges showed as a pair of hard colour steps running the height of
 * the screen, which was the thing people actually reported.
 *
 * IT USED TO BE FOUR: road surface, kerb, trees, street lamps -- then two, when the kerb, the
 * trees and the lamps were all deleted in one pass. The KERB is gone for good: a 10-unit band
 * at an 8% lightness step off `GROUND` reads as a soft blurred ring, not as a lip, and that
 * ring, not any actual blur, is what a player photographed and reported as the whole street
 * being out of focus (see `roads`, below, for what replaced it). TREES AND LAMPS WENT FOR A
 * DIFFERENT REASON -- neither carried an outline or a shadow strong enough to read as an object
 * at this scale, so from directly above a tree crown and a lamp head were both just a colour
 * dot -- and THAT IS THE ONLY REASON THEY WERE GONE: they are back now, in `scenery`, below,
 * because every one of them carries both (see `buildTree`/`buildLamp`). NO BUILDINGS -- from
 * directly above a building is a rectangle, and a rectangle that is trying to be a building
 * invites the eye to work out what it is when the answer is "nothing". No cars either: the
 * cars belong on the board.
 *
 * THAT COUNT HAS SINCE GROWN AGAIN, to four ground layers plus a line, and for a different
 * reason than the kerb's. `LAWN` (the oversized backdrop, recoloured), `PAVING` (a band along
 * the road's own polyline, wider than the road) and a dashed centre line answer a later
 * requirement for a three-layer ground -- grass, pavement, road -- with a lane marking on top.
 * This is not the kerb's own failure returning: `PAVING`'s margins against its neighbours are
 * measured, not assumed (see its docblock in `palette.ts`, which opens by naming the exact 8%
 * step that failed here once already), and it is drawn through the same per-layer discipline
 * `shadows`/`roads` already used rather than folded into either one's per-leg loop. See
 * `HomeScene`'s field docblocks below for why that discipline still matters with two more
 * layers in it.
 *
 * TREES AND LAMPS CAME BACK AS A FIFTH LAYER, `scenery`, for the reason given above: every one
 * now carries `shade(colour, -0.2)` as a darker, slightly larger disc behind it (`OUTLINE_PAD`)
 * and the SAME hard shadow the road casts -- `ROAD_SHADOW`, `SHADOW_OFFSET_X/Y`, imported once
 * and not redefined. They stand on `LAWN`, clear of both `PAVING`'s own band and every badge on
 * the rail, by a bound derived from `PAVING_W`, `ZIG_X` and the badge's own maximum drawn
 * radius rather than typed -- see `vergeIn`.
 *
 * THE COLOURS ARE MOSTLY THE BOARD'S OWN. `ROAD` comes from `palette.ts`, which is the same
 * file the parking board reads, so the road cannot drift away from the game the way the
 * photograph had already drifted. The shadow's ink, `SHADOW_INK`, is also read from there -- its
 * colour only, not its geometry. `shadowThrow` derives an offset from the scene's key light and
 * the board's tilt, and this canvas has neither: it is flat and orthographic, so the offset here
 * is a fixed, chosen constant instead of a derived one. See `build`. The tree crown and the lamp
 * head are `colors.ts`'s own green and yellow -- the same six colours the cars and passengers
 * wear -- so the scenery cannot drift from the play palette either.
 *
 * `LAWN` AND `PAVING` ARE THE DELIBERATE EXCEPTION to "the colours are the board's own", and
 * that exception was made in `palette.ts`, not here: its own header explains that no surface a
 * car ever stands on is grass, so there is no board colour for this file to inherit for the
 * ground under the road. A reader who finds a green in an otherwise blue-grey scene should read
 * `palette.ts` before "fixing" it.
 *
 * THE GEOMETRY IS NOT HERE. Where the stops sit and how the road travels between them lives in
 * `core/home-path`, engine-free and under test, because "the road really passes through the
 * stop centres" is a claim worth asserting rather than eyeballing. This file only strokes it.
 */

/**
 * The road surface's width.
 *
 * Wide enough to read as a road rather than as a line, and narrow enough that the badges
 * standing on it read as sitting ON a road rather than as filling a lane: 96 is what that takes
 * in absolute terms, not a fraction of the badge -- the badge has been retuned more than once
 * since this number was chosen, and the road has to keep reading as a road at any of its sizes.
 * It is deliberately much narrower than the strip it replaces (620) -- that one was a lane the
 * whole rail sat inside, this one is a road the rail's stops sit ON.
 */
const ROAD_W = 96;

/**
 * The paving band's width: the road's own width plus a quarter of it on either side, which is
 * what "a pavement about 25% of the road's width on each side" actually asks for -- the band is
 * the road PLUS TWO quarters of it, not the road plus one.
 *
 *     ROAD_W + 0.25 * ROAD_W + 0.25 * ROAD_W  =  ROAD_W * 1.5
 *
 * Stroked with the same `strokePath` the road and its shadow already use, at the road's own
 * polyline (`legSamples`) -- a second, wider pass over the identical points, not a separate
 * shape with its own idea of where the road runs.
 */
const PAVING_W = ROAD_W * 1.5;

/**
 * NO GRADIENT ANYWHERE, AND THAT IS SATISFIED BY NOT DOING ANYTHING. Every layer here --
 * `LAWN`, `PAVING`, the shadow, `ROAD`, the dashes -- is a flat-tinted `roundedSprite`, and two
 * flat sprites meeting at their edges is a hard edge BY CONSTRUCTION, not a property that needs
 * enforcing. Written down so a later reader does not reach for `rampSprite` (this file's own
 * vertical fade, used elsewhere for a vignette) to "soften the join" between two of these bands
 * -- doing that would be adding the one thing this requirement explicitly ruled out.
 */

/**
 * The road's shadow: the same polyline as the road, the same width, drawn first and nudged
 * down-right by (`SHADOW_OFFSET_X`, `SHADOW_OFFSET_Y`) in canvas units -- x right, y DOWN, which
 * is negative canvas y.
 *
 * `SHADOW_INK` AT ALPHA 64, NOT `SHADOW_ALPHA` (44) OR `CONTACT_ALPHA` (112). The requirement
 * asked for "the same shadow constants the board's cars use" and also asked for alpha 0.25 (64
 * of 255), and those two halves conflict -- neither of the board's two alphas is 64. Ruling: the
 * explicit alpha wins, and `SHADOW_INK` is the shared constant that is honoured. This is a
 * deliberate departure from `shadow.ts`, not drift, for a reader who goes looking for 64 there
 * and does not find it.
 *
 * `shadowThrow` IS NOT USED HERE, DELIBERATELY. It throws a shadow's offset from the scene's key
 * light across a board that tilts under it (`BOARD_TILT`), and neither of those exists on this
 * canvas: the lobby is flat and orthographic. Importing it here would apply a 3D board's light
 * geometry to a 2D street that has none, which is exactly the kind of thing that looks like a
 * fix later and is not one.
 *
 * "blur <= 4" has no engine counterpart to satisfy: these are flat sprites with an antialiased
 * edge and nothing more, so the requirement is satisfied by construction.
 */
const SHADOW_OFFSET_X = 2;
const SHADOW_OFFSET_Y = -3;
const ROAD_SHADOW = new Color(SHADOW_INK.r, SHADOW_INK.g, SHADOW_INK.b, 64);

/**
 * The centre dashes: the board's own dashed lot border, carried over by RATIO rather than by
 * value. `scene-stage.ts`'s lot border uses `dash = 0.18, gap = 0.13, thick = 0.05` in board
 * units, painted in `LOT_DASH` -- `gap / dash` = 0.722 and `thick / dash` = 0.278 are what
 * travel here, not the board-unit figures themselves, which have no meaning against a 96-wide
 * road measured in canvas units.
 *
 * Against `ROAD_W` (96) these are a dash about 34 long, a gap about 25 and a thickness about 9:
 * `DASH_GAP / DASH_LEN` = 0.735 and `DASH_THICK / DASH_LEN` = 0.265, both close to the board's
 * own ratios above.
 *
 * PAINTED IN `ROAD_LINE`, NOT `LOT_DASH`. `ROAD_LINE`'s own docblock in `palette.ts` says it is
 * held "at the +69 it had over ROAD, for the reason spelled out on LOT_DASH" -- it is already
 * the board's answer to "a dash on ROAD", the same relationship `LOT_DASH` has to `LOT`, so it
 * is the colour that belongs here rather than a second copy of `LOT_DASH`'s own figure.
 */
const DASH_LEN = 34;
const DASH_GAP = 25;
const DASH_THICK = 9;

/**
 * A tree from directly above is a crown; a lamp is a post and a head. Both stand on `LAWN`,
 * behind their own outline and hard shadow -- see `buildTree` and `buildLamp`.
 */
const TREE_D = 88;
/** How far the crown is walked back from `COLORS.green`. A lit car is not a tree. */
const TREE_DIM = 0.7;
const LAMP_POST_D = 20;
const LAMP_HEAD_D = 40;
/**
 * How far the head sits above the foot, straight up-canvas -- no sideways reach. That keeps the
 * whole lamp's x-extent equal to its own outline radius, which is exactly what `vergeIn` bounds;
 * an arm reaching toward the road (the old lamp had one, for its light pool) would need a second
 * term this bound does not have.
 */
const LAMP_ARM_LEN = 26;
/** One lamp every other leg. One per leg is a row of lamps; this is a street. */
const LAMP_EVERY = 2;

/**
 * How much larger the outline disc is than the shape it rims, in diameter.
 *
 * Shared by the tree crown and the lamp head -- "the screen's one outline idiom" the badge
 * takes too, in a later task. `shade(colour, -0.2)` (from `palette.ts`) supplies the darker
 * half of the outline; this supplies the "slightly larger" half.
 */
const OUTLINE_PAD = 8;

/**
 * A flat safety margin added on top of the exact PAVING/badge bound `vergeIn` computes, so the
 * clearance it leaves is comfortably positive rather than a number that only just clears by
 * construction. 20, in the same spirit as `OUTLINE_PAD` (8) and `TAP_PAD` (10) elsewhere in this
 * project's UI -- a deliberate constant, not the residue of however the other two terms happen
 * to round.
 */
const BADGE_CLEARANCE = 20;

/** The narrowest the verge band may collapse to, for a viewport narrower than the design one. */
const VERGE_MIN_BAND = 60;

/**
 * An integer hash: the same `i` always gives back the same number in [0, 1).
 *
 * `Math.random` would be a BUG here rather than a shortcut. `layout()` runs on every frame of
 * a drag, and a position computed from a random source moves a few units per frame -- which
 * reads as the trees vibrating. A position has to be a pure function of the thing it belongs
 * to, and then it does not matter how often anything is recomputed.
 */
function hash01(i: number): number {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/**
 * Independent streams from the one hash: a tree's x, a tree's y, a lamp's x, a lamp's y.
 *
 * ONLY A POSITION HASH -- there is no size stream any more. 尺寸统一 (uniform size) is a
 * reversal of the per-tree size jitter this file used to draw; dropping the stream along with
 * the jitter is what keeps the hash honestly about scatter and nothing else.
 */
const HASH_STREAMS = 4;
const S_TREE_X = 0;
const S_TREE_Y = 1;
const S_LAMP_X = 2;
const S_LAMP_Y = 3;

function pick(i: number, stream: number): number {
    return hash01(i * HASH_STREAMS + stream);
}

/** A bare node that can hold UI children -- many call sites want the same three lines. */
function container(name: string, parent: Node): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    parent.addChild(node);
    return node;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * Stroke a polyline as rotated rounded rectangles, one per chord.
 *
 * `ui-shapes` has no line drawer and is not getting one: a straight run of road IS a rounded
 * rectangle, and `Node.angle` is free.
 *
 * THE SEGMENTS' OWN CAPS ARE THE ROUND JOIN, and there is one condition for it that is worth
 * stating precisely because it is invisible and the next person will not re-derive it:
 *
 *      the corner radius must equal HALF THE STROKE WIDTH.
 *
 * At that radius -- and only at that radius -- `roundedSprite`'s 9-slice inner box collapses to
 * zero height, so what is painted is not a rectangle with rounded ends but the set of points
 * within `width / 2` of the CHORD ITSELF: a capsule. A capsule therefore contains the whole
 * disc of radius `width / 2` at each endpoint, not merely an outward semicircle, because for
 * any q within that distance of the endpoint P, dist(q, chord) <= |q - P| <= width / 2. Two
 * consecutive capsules sharing P already cover that disc twice over, which is exactly what a
 * round join is.
 *
 * Drop the radius below `width / 2` and the caps become flat, the union of two chords leaves a
 * wedge of bare ground open on the outside of every turn, and this needs a dot at each sample
 * to fill it again. The turns are real, so that would be visible: a leg's interior corners
 * reach 32 degrees and the corner AT a stop reaches 46.5 -- the two legs' TANGENTS are vertical
 * and continuous there, but a chord is not a tangent, and the first chord out of a stop is
 * already 23 degrees off it.
 *
 * This file used to draw that dot at all seven samples of both passes -- 126 sprites of 270,
 * every one of them inside a shape already drawn, and each breaking the UI batch because it
 * came from a different frame. Checked before removing them, by rasterising two adjacent legs
 * at 0.4 units: of 571,541 cells inside some joint dot, the number NOT inside a segment capsule
 * was zero.
 *
 * The `width` of overhang (`len + width`, half a width at either end) stays, and is now doing
 * the whole of the work at the leg-to-leg seam: it puts each leg's end cap exactly on the stop
 * the next leg starts from, so neighbours overlap rather than gap, and culling one cannot leave
 * a notch in the other.
 */
function strokePath(
    parent: Node, pts: PathPoint[], width: number, color: Color, tag: string,
): void {
    for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        // The radius is `width / 2` and must stay there -- see above.
        const seg = roundedSprite(
            `${tag}-seg${k}`, Math.hypot(dx, dy) + width, width, color, width / 2,
        );
        parent.addChild(seg);
        seg.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
        // Cocos angles are DEGREES, anticlockwise positive, with 0 along +x -- which is the
        // direction the rectangle's length already runs in.
        seg.angle = Math.atan2(dy, dx) * 180 / Math.PI;
    }
}

/**
 * Stroke the centre dashes along `pts`, by ARC LENGTH.
 *
 * STEPPING BY THE SAMPLE PARAMETER `t` INSTEAD OF DISTANCE IS THE BUG THIS AVOIDS. `legSamples`
 * places its points along a Bezier at even steps of `t`, not at even steps of distance -- the
 * curve is tightest near a stop (see `home-path.ts`'s note on the leg's interior corners), so
 * consecutive samples sit CLOSER TOGETHER there than in the middle of a leg. A dash pass keyed
 * to the sample index rather than to travelled distance would bunch at exactly those tight
 * corners and stretch out in between -- invisible on the road's own stroke, because a stroke's
 * width does not care how far apart its samples are, but a dash's LENGTH does. So this walks the
 * polyline's own arc length instead, one chord at a time, carrying a running `dist` that never
 * resets across chords (it does reset per leg -- each call starts a fresh dash phase at the
 * stop the leg begins from, which is a natural seam, unlike the middle of a curve).
 *
 * A DASH CAN SPAN A JOINT BETWEEN TWO CHORDS. A dash is short next to a typical chord here, but
 * nothing guarantees a dash boundary falls exactly on a sample point, so a dash that starts near
 * a chord's end is cut into one capsule per chord it crosses, each at that chord's own angle --
 * the curve bends only a few degrees per chord (see `home-path.ts`), so the seam between two
 * such pieces is not visible.
 *
 * Each whole or partial dash is a `roundedSprite` at `radius = thickness / 2` -- the same
 * capsule identity `strokePath`'s own docblock sets out.
 *
 * A CUT END OVERHANGS; A REAL END DOES NOT. That distinction is the whole of `cutStart`/`cutEnd`
 * below, and leaving it out is a defect that shipped here once. At `radius = thickness / 2` a
 * capsule's extreme ends are single POINTS at mid-height, not flat edges -- so where a dash was
 * cut across a chord joint, piece A tapered to a point on the joint and piece B tapered away
 * from it, and the dash necked from its full thickness to nothing and back. Worse for a short
 * remainder: `roundedSprite` clamps its corner radius to `min(len, thick) / 2`, so a 2.8-long
 * fragment of a 9-thick dash came out as a 2.8 x 9 blob -- WIDER ACROSS the road than along it,
 * a tick at right angles to the line it belongs to.
 *
 * So a piece extends half a thickness past each end that was CUT, and not past an end that is
 * the dash's own -- which makes the two halves overlap exactly the way `strokePath`'s segments
 * do at a shared stop, and leaves whole dashes at exactly `dash` long. The docblock above argues
 * the seam is invisible because the chords barely bend, and that was true and beside the point:
 * the angle was never the problem, the cap geometry was.
 */
function strokeDashes(
    parent: Node, pts: PathPoint[], dash: number, gap: number, thick: number, color: Color,
): void {
    const cycle = dash + gap;
    let dist = 0;
    let n = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const ux = len > 0 ? dx / len : 0;
        const uy = len > 0 ? dy / len : 0;
        let segStart = 0;
        while (segStart < len) {
            const phase = dist % cycle;
            const inDash = phase < dash;
            // Floored so a `dist` that ever lands exactly on a cycle boundary (not observed,
            // but not provably impossible in floating point) cannot leave `step` at zero and
            // spin without making progress.
            const phaseLeft = Math.max((inDash ? dash : cycle) - phase, 1e-6);
            const step = Math.min(phaseLeft, len - segStart);
            if (inDash) {
                // A start at a non-zero phase can only mean the previous chord ran out mid-dash;
                // within one chord the loop always steps exactly onto a phase boundary. An end
                // short of `phaseLeft` means this chord ran out before the dash did.
                // The same 1e-6 `phaseLeft` is floored with, and for the mirror reason: a
                // `dist` that drifts a hair past a cycle boundary would otherwise read as
                // "resumed mid-dash" and hang a 4.5-unit overhang off a dash nothing cut.
                const cutStart = phase > 1e-6 ? thick / 2 : 0;
                const cutEnd = step < phaseLeft ? thick / 2 : 0;
                const mid = segStart + step / 2 + (cutEnd - cutStart) / 2;
                const seg = roundedSprite(
                    `dash${n++}`, step + cutStart + cutEnd, thick, color, thick / 2,
                );
                parent.addChild(seg);
                seg.setPosition(a.x + ux * mid, a.y + uy * mid, 0);
                seg.angle = angle;
            }
            segStart += step;
            dist += step;
        }
    }
}

export class HomeScene {
    /**
     * Everything the street draws, and it does NOT move. The ground is screen furniture;
     * only `street` scrolls.
     */
    private root: Node;
    /**
     * The scrolling half. `layout` slides this by the rail's own offset, which is what keeps
     * the road registered against the stops -- see `layout`.
     */
    private street: Node;
    /**
     * ONE PASS PER LAYER, NOT ONE PASS PER LEG: every leg's paving is drawn before any leg's
     * shadow, every leg's shadow before any leg's road, and every leg's road before any leg's
     * dash, across the whole street -- rather than each leg drawing its own paving-shadow-road-
     * dash stack, because legs are siblings that overlap at the stop they share, and a leg
     * drawing all of its layers before its neighbour would let that neighbour's later layer
     * paint over this leg's already-drawn one at the shared seam. (This split used to separate
     * the kerb from the road for exactly that reason; the kerb is gone, the ordering rule that
     * protected it is not.)
     *
     * `PAVING`, WIDER THAN `ROAD` THE SAME WAY THE KERB WAS, is the layer that would actually
     * repeat that old bug if it were folded into the road's own per-leg loop: a later leg's
     * wider paving would repaint an earlier leg's already-drawn, narrower road right where they
     * share a stop, leaving the same crescent of wrong colour the kerb used to.
     *
     * `DASH` IS NARROWER THAN `ROAD`, but the risk is not only "wider eats narrower" -- every
     * stroked segment already overhangs its own half-width at each end to bridge a shared stop
     * (see `strokePath`), so a later leg's road reaching back over that stop would still paint
     * over an earlier leg's already-drawn dash if the dash lived inside the road's own per-leg
     * container instead of a container of its own, appended after `roads`.
     *
     * `SCENERY` IS APPENDED LAST, above all four ground layers, rather than folded under
     * `paving` the way an early draft of this file had it. The trees and lamps stand on `LAWN`
     * clear of `PAVING`'s own band BY CONSTRUCTION (`vergeIn`), so nothing here ever overlaps a
     * ground layer and the ordering risk the other four containers guard against does not apply
     * to it -- appending it last only has to be true once, not re-argued per layer. `vergeIn`
     * ALSO keeps scenery clear of the badges drawn in `RailStops`, a sibling tree entirely, so
     * there is no draw-order relationship to argue there either -- see `vergeIn`'s own docblock.
     */
    private paving: Node;
    private shadows: Node;
    private roads: Node;
    private dashes: Node;
    private scenery: Node;
    /**
     * One node per leg in each container, so culling a leg is five `active` assignments rather
     * than a walk over its sprites. All five arrays are the same length and index together.
     */
    private pavingLegs: Node[] = [];
    private shadowLegs: Node[] = [];
    private roadLegs: Node[] = [];
    private dashLegs: Node[] = [];
    private sceneryLegs: Node[] = [];
    /**
     * Set unconditionally by `build`, which `roadLegs.length` is not: a one-level game has no
     * legs at all, so the re-entry guard cannot be a count of them without letting a second
     * call append a second road on top of the first.
     */
    private built = false;
    /**
     * The canvas y that rail offset 0 sits at. See `setRailCenter`.
     *
     * Zero until told otherwise, which is the canvas centre -- the behaviour this had before
     * the rail was recentred, so a caller that never calls `setRailCenter` gets the old street
     * rather than a broken one.
     */
    private centreY = 0;
    /**
     * The canvas width, kept as a field because `vergeX` measures a tree or lamp's outer
     * bound against it on every leg `build()` constructs -- the same way the deleted
     * `dress()` used to. `h` is NOT a field: the oversized ground plate is the only thing
     * on this layer sized by the screen's height, and it is built in the constructor that
     * receives it.
     */
    private w: number;
    /**
     * The largest distance any pixel of a badge can ever land from that badge's own centre, in
     * whichever state and breathing phase draws it furthest -- `home-view`'s `BADGE_MAX_R`,
     * HANDED IN rather than imported. `home-view.ts` already imports `HomeScene`, so importing
     * a value the other way would be a straight cycle; passing it down the way `setRailCenter`
     * already hands this class a y it did not compute keeps the two files' actual dependency
     * (view depends on scene, not the other way round) honest. See `vergeIn`, the only reader.
     */
    private badgeMaxR: number;

    /**
     * Builds the ground and nothing else.
     *
     * The road cannot be built yet: its length is the level count, and that is a fact about
     * the `resources/levels` folder which nothing has read at the time this screen is
     * constructed. See `build`.
     */
    constructor(parent: Node, w: number, h: number, badgeMaxR: number) {
        // `h` is a constructor parameter and NOT a field: the oversized ground plate is the
        // only thing on this layer sized by the screen's height, and it is built right here.
        // A field nothing reads is an invitation to measure something new off it.
        this.w = w;
        this.badgeMaxR = badgeMaxR;
        this.root = container('HomeStreet', parent);

        // TWICE THE CANVAS, which is the one thing kept from the backdrop this replaces: a
        // viewport wider than the design resolution otherwise shows a strip of empty 3D scene
        // down either side, and the camera's clear colour is not a pavement. Radius 2 because
        // `roundedSprite` insists on one and this shape has no corner anybody will see.
        //
        // PAINTED IN `LAWN`, NOT `GROUND` -- the lowest of the street's ground layers, and the
        // only one that is not shaped by the road's own polyline: it is the whole oversized
        // plate this sprite always was, just recoloured for the grass a later requirement
        // asked for. See `LAWN`'s own docblock in `palette.ts` for why this is a real green
        // rather than a blue-grey kept inside the board's own family.
        const lawn = roundedSprite('Lawn', w * 2, h * 2, LAWN, 2);
        this.root.addChild(lawn);

        this.street = container('StreetScroll', this.root);
        // Appended in this order, which IS their draw order: paving under shadow under road
        // under the dashes, scenery last of all -- see the field docblocks above for why each
        // needs its own top-level container rather than a spot inside another layer's per-leg
        // loop.
        this.paving = container('Paving', this.street);
        this.shadows = container('Shadows', this.street);
        this.roads = container('Roads', this.street);
        this.dashes = container('Dashes', this.street);
        this.scenery = container('Scenery', this.street);
    }

    /**
     * Build the road and its shadow, now that the level count is known.
     *
     * Called from `HomeView.setLevels`, the same moment the stops themselves are built -- so
     * the road comes into existence together with the things riding on it or not at all.
     */
    build(levelCount: number): void {
        if (this.built) return;
        this.built = true;
        for (let i = 0; i < levelCount - 1; i++) {
            const pts = legSamples(i);

            const pavingLeg = container(`Leg${i}`, this.paving);
            strokePath(pavingLeg, pts, PAVING_W, PAVING, 'paving');
            this.pavingLegs.push(pavingLeg);

            const shadowLeg = container(`Leg${i}`, this.shadows);
            strokePath(shadowLeg, pts, ROAD_W, ROAD_SHADOW, 'shadow');
            shadowLeg.setPosition(SHADOW_OFFSET_X, SHADOW_OFFSET_Y, 0);
            this.shadowLegs.push(shadowLeg);

            const roadLeg = container(`Leg${i}`, this.roads);
            strokePath(roadLeg, pts, ROAD_W, ROAD, 'road');
            this.roadLegs.push(roadLeg);

            const dashLeg = container(`Leg${i}`, this.dashes);
            strokeDashes(dashLeg, pts, DASH_LEN, DASH_GAP, DASH_THICK, ROAD_LINE);
            this.dashLegs.push(dashLeg);

            const sceneryLeg = container(`Leg${i}`, this.scenery);
            this.dressLeg(sceneryLeg, i);
            this.sceneryLegs.push(sceneryLeg);
        }
    }

    /**
     * Place the street for the current scroll, and switch off the legs nobody can see.
     *
     * BOTH ARGUMENTS COME FROM `HomeView.layout()`, which calls this as
     * `scene.layout(this.offset, h * 0.75)` once it has settled `this.offset` for the
     * frame -- the same offset it is about to place the stops with, and the same 0.75 of the
     * height it culls the stops against. That is not tidiness. `home-path` exists so the road
     * passes exactly through the stop centres; if the road and the stops scrolled on two
     * different numbers the road would drift off the stops by the difference and the whole of
     * that guarantee would be spent. One number, read once, passed in.
     *
     * `setRailCenter` carries the OTHER half of that agreement: `HomeView` hangs its rail off
     * the middle of the free band between the top bar and the start button rather than off the
     * middle of the canvas, and the street has to hang off the same y. It is a separate call
     * rather than a third argument to `layout` because it changes about once, when the screen is
     * built, while `layout` runs on every frame of a drag.
     */
    setRailCenter(y: number): void {
        this.centreY = y;
    }

    layout(offset: number, visibleHalfHeight: number): void {
        this.street.setPosition(0, this.centreY - offset, 0);
        for (let i = 0; i < this.roadLegs.length; i++) {
            // A leg spans stop i to stop i + 1. It is worth drawing unless BOTH of its ends are
            // past the threshold -- a leg with one end on screen is the one running off the
            // edge, which is what says the route continues.
            const a = nodeCenter(i).y - offset;
            const b = nodeCenter(i + 1).y - offset;
            // The same verdict to all five layers of the leg. They are only in five containers
            // so that every leg's paving draws under every leg's shadow, under every leg's
            // road, under every leg's dash, under every leg's scenery (see the field docblocks
            // above); they are one leg for every other purpose, and any one of the five left on
            // with the rest culled would be a stray band, dash or tree running off the top of
            // the screen.
            const on = Math.min(Math.abs(a), Math.abs(b)) <= visibleHalfHeight;
            this.pavingLegs[i].active = on;
            this.shadowLegs[i].active = on;
            this.roadLegs[i].active = on;
            this.dashLegs[i].active = on;
            this.sceneryLegs[i].active = on;
        }
    }

    /**
     * Where the verge starts: the nearest a tree or lamp's own outline may stand to the
     * centreline.
     *
     * TWO SEPARATE THINGS HAVE TO BE CLEARED, and this used to know about only one of them.
     * `ZIG_X + PAVING_W / 2 + radius` keeps a `radius`-radius object off `PAVING`: a leg is a
     * Bezier whose four control points all have x of +-`ZIG_X` (`legSamples`'s own docblock),
     * and a Bezier stays inside its control points' convex hull, so no `PAVING` sample is ever
     * further out than `ZIG_X + PAVING_W / 2` -- `PAVING_W`'s own worst-case reach from the
     * canvas centre. That term alone says nothing about a BADGE, which stands at the same
     * `ZIG_X` columns and is not part of `PAVING` at all -- worked at today's numbers, a tree
     * could sit 120 units from a badge with only 58 units of vertical separation between them
     * (0.2 of a leg, the closest a tree ever comes to a stop), for an actual gap of about 133,
     * while the badge's own drawn edge already reached past that. A tree grew out of a badge,
     * and it was not a fluke: every leg's tree shares its verge with one of the leg's own two
     * endpoint stops (see `dressLeg`), so this happened on every other leg, not on an unlucky
     * one.
     *
     * `this.badgeMaxR + BADGE_CLEARANCE` is the second term this now clears: `badgeMaxR` is the
     * farthest any pixel of ANY badge, in ANY state, ever lands from that badge's own centre
     * (see `home-view.ts`'s `BADGE_MAX_R`, the only place that number is derived), and
     * `BADGE_CLEARANCE` is a flat safety margin on top of it, so the bound does not merely touch.
     * `Math.max` picks whichever of the two terms is actually larger -- at today's sizes that is
     * the badge, by a wide margin, but a future retune of either width should not have to
     * remember which one used to win.
     *
     * One more `radius` of clearance past the LARGER of the two -- the object's OWN outline
     * radius, not just its centre -- keeps the whole disc clear, not merely the point it is
     * anchored at.
     */
    private vergeIn(radius: number): number {
        return ZIG_X + Math.max(PAVING_W / 2, this.badgeMaxR + BADGE_CLEARANCE) + radius;
    }

    /**
     * How far out on the verge a `radius`-radius object stands, given a draw in [0, 1).
     *
     * The band runs from `vergeIn(radius)` out to wherever the canvas edge leaves room for the
     * object's own radius, floored at `VERGE_MIN_BAND` wide so a narrow viewport gives a
     * cramped street rather than an inverted one.
     */
    private vergeX(t: number, radius: number): number {
        const inner = this.vergeIn(radius);
        const out = Math.max(inner + VERGE_MIN_BAND, this.w / 2 - radius);
        return lerp(inner, out, t);
    }

    /**
     * One tree beside every leg, and one lamp beside every other one.
     *
     * They go inside the leg's own scenery node, which is what lets `layout`'s `active`
     * assignment cull them along with everything else the leg draws, at no extra cost.
     *
     * WHICH SIDE IS NOT A HASH, and that was the first attempt: drawing the side from `pick`
     * put six of nine trees in a row on the left verge and left the right one empty for a third
     * of the route, which is what an unbiased coin does over nine tosses and reads as a hedge
     * rather than as scenery.
     *
     * Pairs instead. `i % 4 < 2` swaps sides every SECOND leg, so the count comes out even over
     * any stretch without the strict left-right-left that makes a row of trees read as fence
     * posts. It also puts a lamp leg (every second one) on each side in turn, which strict
     * alternation would not: with lamps on even legs only, a side that flips every leg gives
     * every lamp the same verge. The lamp takes the OPPOSITE verge from the tree on its own leg,
     * so one leg never carries both on one side.
     */
    private dressLeg(leg: Node, i: number): void {
        const treeSide = i % 4 < 2 ? 1 : -1;
        const y0 = nodeCenter(i).y;
        const y1 = nodeCenter(i + 1).y;

        this.buildTree(leg, i, treeSide, y0, y1);
        if (i % LAMP_EVERY === 0) this.buildLamp(leg, i, -treeSide, y0, y1);
    }

    /**
     * A tree: a hard shadow, an outline, then the crown on top of both -- the one outline idiom
     * this screen uses (`OUTLINE_PAD`, and `shade`'s own docblock in `palette.ts`), and the SAME
     * hard shadow the road casts, not a fresh one (`ROAD_SHADOW`, `SHADOW_OFFSET_X/Y`, both
     * declared once, above, for the road's own shadow).
     */
    private buildTree(leg: Node, i: number, side: number, y0: number, y1: number): void {
        const outlineD = TREE_D + OUTLINE_PAD;
        const x = side * this.vergeX(pick(i, S_TREE_X), outlineD / 2);
        // 0.2 TO 0.8 OF THE LEG, which keeps a tree clear of the stops at either end -- a crown
        // growing out of a level badge is a collision, not scenery.
        const y = lerp(y0, y1, 0.2 + 0.6 * pick(i, S_TREE_Y));

        const tree = container(`Tree${i}`, leg);
        tree.setPosition(x, y, 0);

        // SHADOW FIRST, so the crown sits on it rather than under it.
        const shadow = dotSprite('shadow', TREE_D, ROAD_SHADOW);
        tree.addChild(shadow);
        shadow.setPosition(SHADOW_OFFSET_X, SHADOW_OFFSET_Y, 0);

        const green = COLORS.green;
        const crownColour = new Color(
            Math.round(green.r * TREE_DIM),
            Math.round(green.g * TREE_DIM),
            Math.round(green.b * TREE_DIM),
            255,
        );
        // The outline: the crown's own colour, `shade`d darker and drawn slightly larger, behind
        // the crown.
        const outline = dotSprite('outline', outlineD, shade(crownColour, -0.2));
        tree.addChild(outline);

        const crown = dotSprite('crown', TREE_D, crownColour);
        tree.addChild(crown);
    }

    /**
     * A lamp: a post at the foot, then a head straight up-canvas from it -- no sideways arm, so
     * the whole object's x-extent is exactly its outline radius and `vergeIn` bounds it exactly.
     * NO LIGHT POOL: the old one sat at alpha 26 and read as an unloaded asset, and nothing here
     * brings it back in any form.
     */
    private buildLamp(leg: Node, i: number, side: number, y0: number, y1: number): void {
        const outlineD = LAMP_HEAD_D + OUTLINE_PAD;
        const x = side * this.vergeX(pick(i, S_LAMP_X), outlineD / 2);
        const y = lerp(y0, y1, 0.3 + 0.4 * pick(i, S_LAMP_Y));

        const lamp = container(`Lamp${i}`, leg);
        lamp.setPosition(x, y, 0);

        const headY = LAMP_ARM_LEN;
        const yellow = COLORS.yellow;

        // A LAMP IS ONE OBJECT, so its two discs are drawn in three passes rather than as two
        // finished lamps stacked. The first version gave the head an outline and a shadow and
        // left the post a bare `ROAD` disc, on the argument that a post is structure rather
        // than an object -- which is the same argument that got the old trees deleted. A bare
        // disc beside an outlined one does not read as the foot of the thing above it; it
        // reads as a second, unfinished thing. Both discs get both treatments.
        //
        // The passes also have to be in this order for a reason the per-object version hides:
        // the post and the head OVERLAP (post radius 10 at y 0, head radius 20 at y 26, so
        // they meet), and a head drawn before the post's outline would wear a dark crescent
        // across its lower edge.
        // ONE descriptor, read three times. Written out per pass it was the same two tuples
        // copied three times, which is two chances for the passes to disagree about where the
        // head is on a later edit -- and a shadow under a head that has moved reads as a
        // rendering fault rather than as the typo it would be.
        const parts = [
            { name: 'post', d: LAMP_POST_D, dy: 0, colour: ROAD },
            { name: 'head', d: LAMP_HEAD_D, dy: headY, colour: yellow },
        ] as const;
        for (const p of parts) {
            const shadow = dotSprite('shadow', p.d, ROAD_SHADOW);
            lamp.addChild(shadow);
            shadow.setPosition(SHADOW_OFFSET_X, p.dy + SHADOW_OFFSET_Y, 0);
        }
        for (const p of parts) {
            const outline = dotSprite('outline', p.d + OUTLINE_PAD, shade(p.colour, -0.2));
            lamp.addChild(outline);
            outline.setPosition(0, p.dy, 0);
        }
        for (const p of parts) {
            const face = dotSprite(p.name, p.d, p.colour);
            lamp.addChild(face);
            face.setPosition(0, p.dy, 0);
        }
    }
}
