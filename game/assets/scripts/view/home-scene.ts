import { Color, Layers, Node, UITransform } from 'cc';
import { legSamples, nodeCenter, PathPoint, ZIG_X } from '../core/home-path';
import { dotSprite, rampSprite, roundedSprite } from './ui-shapes';
import { COLORS } from './colors';
import { GROUND, KERB, ROAD } from './palette';
import { SHADOW_ALPHA, SHADOW_INK } from './shadow';

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
 * FOUR ELEMENTS, and the list is closed: road surface, kerb, trees, street lamps. NO BUILDINGS
 * -- from directly above a building is a rectangle, and a rectangle that is trying to be a
 * building invites the eye to work out what it is when the answer is "nothing". No cars
 * either: the cars belong on the board.
 *
 * THE COLOURS ARE THE BOARD'S OWN. `GROUND`, `ROAD` and `KERB` come from `palette.ts`, which
 * is the same file the parking board reads, so the lobby cannot drift away from the game the
 * way the photograph had already drifted. The living things -- tree crowns, lamp heads -- come
 * from `colors.ts`, the six colours the cars and passengers are painted in.
 *
 * THE GEOMETRY IS NOT HERE. Where the stops sit and how the road travels between them lives in
 * `core/home-path`, engine-free and under test, because "the road really passes through the
 * stop centres" is a claim worth asserting rather than eyeballing. This file only strokes it.
 */

/**
 * The road surface's width.
 *
 * Wide enough to read as a road rather than as a line: the stars under a stop are 26 across
 * and sit on a 30 pitch, so 96 is about three of them side by side. It is deliberately much
 * narrower than the strip it replaces (620) -- that one was a lane the whole rail sat inside,
 * this one is a road the rail's stops sit ON.
 */
const ROAD_W = 96;
/** How much wider the kerb is than the road -- 10 of pavement lip showing down either side. */
const KERB_PAD = 20;
const KERB_W = ROAD_W + KERB_PAD;

/**
 * The fade down the far left and right of the screen.
 *
 * SAME TOOL AS THE OLD STRIP, OPPOSITE JOB, and the distinction is the whole reason it is safe
 * to reach for a translucent overlay again here. The old one was a see-through slab laid over
 * a photograph, and its two HARD EDGES were the complaint. This one has no hard edge anywhere:
 * it is a `rampSprite`, opaque at one side and fully gone at the other, tinted `GROUND` -- the
 * exact colour of the pavement it is lying on -- so over plain pavement it is a no-op and over
 * anything standing in it (a tree, a lamp) it is a dissolve. The street stops having an outer
 * boundary instead of being cut off at one.
 *
 * 70, from the 60-80 the requirement asked for.
 */
const FADE_W = 70;

/**
 * A tree from directly above is two circles: the crown, and the crown's shadow beside it.
 *
 * `TREE_SHADOW_OFF` throws the shadow UP the screen. That is the sign convention `shadow.ts`
 * spends a page arriving at for the board, where it falls out of the key light and the board's
 * tilt. Neither of those exists on this canvas -- `shadow.ts` says as much about the HUD -- so
 * the direction here is a free choice, and matching the board is the only choice that leaves
 * one light in the product.
 */
const TREE_D = 88;
const TREE_SHADOW_OFF = 8;
/** How far the crown is walked back from `COLORS.green`. A lit car is not a tree. */
const TREE_DIM = 0.7;
/** The sizes a crown is allowed to come out at. See `dress` for why they vary at all. */
const TREE_MIN = 0.85;
const TREE_MAX = 1.15;

/**
 * A street lamp from above: the pool of light it throws, the arm reaching out over the road,
 * and the head at the end of the arm.
 *
 * The pool is wide and very faint, and it is allowed to REACH THE ROAD: a lamp standing at the
 * inner end of the verge puts its pool's near edge at 354 - 54 - 60 = 240, inside the kerb's
 * 268. That is what a street lamp is for; a pool of light that stops politely at the pavement's
 * edge is a decal. A lamp further out keeps its light on the pavement, which is the same lamp
 * at a different distance rather than a different rule.
 */
const LAMP_POST_W = 10;
const LAMP_REACH = 54;
const LAMP_HEAD_D = 26;
const LAMP_POOL_D = 120;
const LAMP_POOL_ALPHA = 26;
/** One lamp every other leg. One per leg is a row of lamps; this is a street. */
const LAMP_EVERY = 2;

/**
 * Where the verge starts: the nearest a tree or a lamp's foot may stand to the centreline.
 *
 * Derived rather than typed, because it has to survive a change to any of its three terms. A
 * leg is a Bezier whose four control points all have x of +-`ZIG_X`, and a Bezier stays inside
 * its control hull, so NO part of the road surface is ever further out than
 * `ZIG_X + ROAD_W / 2`. One more road-width of clear pavement past that is the gap, which puts
 * the verge at 354 against a kerb reaching at most 268.
 */
const VERGE_IN = ZIG_X + ROAD_W / 2 + ROAD_W;
/** The narrowest the verge band may collapse to, for a viewport narrower than the design one. */
const VERGE_MIN_BAND = 60;

/**
 * An integer hash: the same `i` always gives back the same number in [0, 1).
 *
 * `Math.random` would be a BUG here rather than a shortcut. `layout()` runs on every frame of
 * a drag, and a position computed from a random source moves a few units per frame -- which
 * reads as the trees vibrating. A position has to be a pure function of the thing it belongs
 * to, and then it does not matter how often anything is recomputed.
 *
 * Checked before being relied on, over i = 0..2000: range [0.000266, 0.999883], the ten
 * deciles hold 177-217 of 2000 against an expected 200, and the mean absolute step between
 * consecutive i is 0.3303 against the 0.3333 an independent uniform sequence gives -- so
 * neighbouring legs are uncorrelated, which is the property that actually matters when the
 * numbers are used to scatter scenery.
 */
function hash01(i: number): number {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/**
 * Independent streams from the one hash.
 *
 * A tree's x and its y both want a number for the same leg, and `hash01(i)` has only one to
 * give. Striding by `HASH_STREAMS` gives each question its own sequence that no other
 * question's `i` can ever land on. Each stream was checked separately over 4000 legs: every
 * decile within 357-454 of an expected 400, and no agreement between streams at small `i`.
 */
const HASH_STREAMS = 8;
const S_TREE_X = 0;
const S_TREE_Y = 1;
const S_TREE_D = 2;
const S_LAMP_X = 3;
const S_LAMP_Y = 4;

function pick(i: number, stream: number): number {
    return hash01(i * HASH_STREAMS + stream);
}

/** A bare node that can hold UI children -- four call sites want the same three lines. */
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
 * Stroke a polyline as rotated rounded rectangles, with a dot at every sample.
 *
 * `ui-shapes` has no line drawer and is not getting one: a straight run of road IS a rounded
 * rectangle, and `Node.angle` is free.
 *
 * THE DOTS ARE THE JOIN, and they are not optional. Two rectangles meeting at an angle leave a
 * wedge of bare ground open on the outside of the turn, and a circle of the stroke's own width
 * centred on the shared sample fills it exactly -- a round join, done by hand. The turns here
 * are real: a leg's own interior corners reach 32 degrees, and the corner AT a stop, where one
 * leg hands over to the next, reaches 46.5 -- the sharpest on the screen, and the reason the
 * seam cannot simply be left to the two legs' tangents agreeing (they do agree, but a CHORD is
 * not a tangent, and the first chord out of a stop is already 23 degrees off it).
 *
 * A DOT AT BOTH ENDS AS WELL, which costs one sprite per leg per pass and buys that seam. Each
 * segment is drawn `len + width` long -- half a width of overhang at either end -- so its end
 * cap is a semicircle of radius `width / 2` centred exactly on the endpoint, which is
 * precisely the dot the NEXT leg puts there. Neighbouring legs therefore overlap rather than
 * gap, and culling one cannot leave a notch in the other, because each carries its own copy.
 */
function strokePath(
    parent: Node, pts: PathPoint[], width: number, color: Color, tag: string,
): void {
    for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const seg = roundedSprite(
            `${tag}-seg${k}`, Math.hypot(dx, dy) + width, width, color, width / 2,
        );
        parent.addChild(seg);
        seg.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
        // Cocos angles are DEGREES, anticlockwise positive, with 0 along +x -- which is the
        // direction the rectangle's length already runs in.
        seg.angle = Math.atan2(dy, dx) * 180 / Math.PI;
    }
    for (let k = 0; k < pts.length; k++) {
        const joint = dotSprite(`${tag}-joint${k}`, width, color);
        parent.addChild(joint);
        joint.setPosition(pts[k].x, pts[k].y, 0);
    }
}

export class HomeScene {
    /**
     * Everything the street draws, and it does NOT move. The ground and the two fades are
     * screen furniture; only `street` scrolls.
     */
    private root: Node;
    /**
     * The scrolling half. `layout` slides this by the rail's own offset, which is what keeps
     * the road registered against the stops -- see `layout`.
     */
    private street: Node;
    /** One node per leg, so culling is an `active` assignment and not a walk over sprites. */
    private legs: Node[] = [];

    private w: number;
    private h: number;

    /**
     * Builds the ground and nothing else.
     *
     * The road cannot be built yet: its length is the level count, and that is a fact about
     * the `resources/levels` folder which nothing has read at the time this screen is
     * constructed. See `build`.
     */
    constructor(parent: Node, w: number, h: number) {
        this.w = w;
        this.h = h;
        this.root = container('HomeStreet', parent);

        // TWICE THE CANVAS, which is the one thing kept from the backdrop this replaces: a
        // viewport wider than the design resolution otherwise shows a strip of empty 3D scene
        // down either side, and the camera's clear colour is not a pavement. Radius 2 because
        // `roundedSprite` insists on one and this shape has no corner anybody will see.
        const ground = roundedSprite('Ground', w * 2, h * 2, GROUND, 2);
        this.root.addChild(ground);

        this.street = container('StreetScroll', this.root);
    }

    /**
     * Build the road, the kerb, the trees and the lamps, now that the level count is known.
     *
     * Called from `HomeView.setLevels`, the same moment the stops themselves are built -- so
     * the road and the things riding on it come into existence together or not at all.
     */
    build(levelCount: number): void {
        if (this.legs.length > 0) return;
        for (let i = 0; i < levelCount - 1; i++) {
            const leg = container(`Leg${i}`, this.street);
            this.legs.push(leg);
            const pts = legSamples(i);
            // THE KERB IN FULL, THEN THE ROAD IN FULL. Alternating them segment by segment
            // would let each road segment paint over the kerb the previous segment had just
            // laid down, and the kerb would survive only where the road happened not to reach.
            strokePath(leg, pts, KERB_W, KERB, 'kerb');
            strokePath(leg, pts, ROAD_W, ROAD, 'road');
            this.dress(leg, i);
        }
        this.buildFades();
    }

    /**
     * Place the street for the current scroll, and switch off the legs nobody can see.
     *
     * BOTH ARGUMENTS COME FROM `HomeView.layout()`, which calls this as
     * `scene.layout(this.offset, this.h * 0.75)` once it has settled `this.offset` for the
     * frame -- the same offset it is about to place the stops with, and the same 0.75 of the
     * height it culls the stops against. That is not tidiness. `home-path` exists so the road
     * passes exactly through the stop centres; if the road and the stops scrolled on two
     * different numbers the road would drift off the stops by the difference and the whole of
     * that guarantee would be spent. One number, read once, passed in.
     */
    layout(offset: number, visibleHalfHeight: number): void {
        this.street.setPosition(0, -offset, 0);
        for (let i = 0; i < this.legs.length; i++) {
            // A leg spans stop i to stop i + 1. It is worth drawing unless BOTH of its ends are
            // past the threshold -- a leg with one end on screen is the one running off the
            // edge, which is what says the route continues.
            const a = nodeCenter(i).y - offset;
            const b = nodeCenter(i + 1).y - offset;
            this.legs[i].active = Math.min(Math.abs(a), Math.abs(b)) <= visibleHalfHeight;
        }
    }

    /**
     * The two fades, added to `root` AFTER `street` so they sit over the scenery, and outside
     * `street` so they do not scroll away with it.
     *
     * `rampSprite` is opaque along its own TOP edge and gone by its bottom. Turned a quarter
     * circle it is opaque along one SIDE: the right-hand one (`angle = -90`, which carries
     * local +y onto screen +x) is solid at the screen's edge and clear by `FADE_W` inward, and
     * the left-hand one is its mirror. Sized (2h x FADE_W) because the rotation swaps those --
     * on screen each is `FADE_W` across and twice the canvas tall, the ground's own reasoning.
     *
     * WHAT IT DOES NOT DO, said plainly because the requirement was written for the old
     * straight strip and does not entirely survive the road becoming a curve: it cannot hug the
     * kerb. The kerb wanders 420 units across and this is a straight band. Over plain pavement
     * it is GROUND over GROUND and changes nothing; what it actually softens is the outer edge
     * of the SCENERY, so the furthest trees dissolve instead of being sliced by the viewport.
     */
    private buildFades(): void {
        const { w, h } = this;
        for (const side of [-1, 1]) {
            const fade = rampSprite(side < 0 ? 'FadeL' : 'FadeR', h * 2, FADE_W, GROUND);
            this.root.addChild(fade);
            fade.angle = side < 0 ? 90 : -90;
            fade.setPosition(side * (w / 2 - FADE_W / 2), 0, 0);
        }
    }

    /**
     * One tree beside every leg, and one lamp beside every other one.
     *
     * They go INSIDE the leg's own node, which means `layout`'s single `active` assignment
     * culls the scenery along with the road it stands beside, at no extra cost.
     *
     * NOTHING IS MIRRORED AND NO TWO AGREE. The distance out, the distance along and the
     * crown's size are three independent draws from `pick`; only the SIDE is regular, for the
     * reason spelled out below. The lamp goes on the opposite verge from the tree, so one leg
     * never carries both on one side. `props.ts` learned this on the board the expensive way:
     * four props at one y, one size, mirrored exactly across the centreline, reported --
     * correctly -- as looking fake.
     */
    private dress(leg: Node, i: number): void {
        // WHICH SIDE IS NOT A HASH, and that was the first attempt: drawing the side from
        // `pick` put six of nine trees in a row on the left verge and left the right one empty
        // for a third of the route, which is what an unbiased coin does over nine tosses and
        // reads as a hedge rather than as scenery.
        //
        // Pairs instead. `i % 4 < 2` swaps sides every SECOND leg, so the count comes out even
        // over any stretch without the strict left-right-left that makes a row of trees read as
        // fence posts. It also puts a lamp leg (every second one) on each side in turn, which
        // strict alternation would not: with lamps on even legs only, a side that flips every
        // leg gives every lamp the same verge.
        const treeSide = i % 4 < 2 ? 1 : -1;
        const y0 = nodeCenter(i).y;
        const y1 = nodeCenter(i + 1).y;

        const crownD = TREE_D * lerp(TREE_MIN, TREE_MAX, pick(i, S_TREE_D));
        // The band is closed against the WIDEST crown rather than against TREE_D, so the size
        // drawn above can never push a tree off the edge of the canvas.
        const treeX = treeSide * this.vergeX(pick(i, S_TREE_X), TREE_D * TREE_MAX / 2);
        // 0.2 TO 0.8 OF THE LEG, which keeps a tree clear of the stops at either end -- a crown
        // growing out of a level badge is a collision, not scenery -- and, less obviously, keeps
        // two trees apart. Consecutive legs share a verge under the pairing above, and this
        // range leaves 0.4 of a pitch (136) between their nearest possible centres against the
        // 101 two of the widest crowns need. At 0.15-0.85 that margin was 102 against 101.
        const treeY = lerp(y0, y1, 0.2 + 0.6 * pick(i, S_TREE_Y));

        const tree = container(`Tree${i}`, leg);
        tree.setPosition(treeX, treeY, 0);

        // SHADOW FIRST, so the crown sits on it rather than under it.
        //
        // SHADOW_ALPHA (44), NOT palette's AREA_SHADOW_ALPHA (30). The 30 is documented in two
        // places as ONE deliberate departure, and the argument for it is AREA: the car park's
        // shadow is about fifteen times a parking bay's, and that much translucent ink stops
        // reading as an edge and becomes a smudge the lot sits in. A crown is 88 across. It has
        // no claim on that discount and takes the standard -- which is also what `props.ts`
        // gives the board's own trees.
        const shade = dotSprite('shadow', crownD, new Color(
            SHADOW_INK.r, SHADOW_INK.g, SHADOW_INK.b, SHADOW_ALPHA,
        ));
        tree.addChild(shade);
        shade.setPosition(0, TREE_SHADOW_OFF, 0);

        const green = COLORS.green;
        const crown = dotSprite('crown', crownD, new Color(
            Math.round(green.r * TREE_DIM),
            Math.round(green.g * TREE_DIM),
            Math.round(green.b * TREE_DIM),
            255,
        ));
        tree.addChild(crown);

        if (i % LAMP_EVERY !== 0) return;
        const lamp = container(`Lamp${i}`, leg);
        const lampSide = -treeSide;
        lamp.setPosition(
            lampSide * this.vergeX(pick(i, S_LAMP_X), LAMP_POOL_D / 2),
            lerp(y0, y1, 0.3 + 0.4 * pick(i, S_LAMP_Y)),
            0,
        );
        // The arm reaches INWARD, toward the centreline, which is where the road is from either
        // verge -- hence the minus. Everything the lamp actually does happens at the far end of
        // the arm, so the head and the pool share that one x.
        const over = -lampSide * LAMP_REACH;

        const yellow = COLORS.yellow;
        // The pool goes down first, under both the arm and the head.
        const pool = dotSprite('pool', LAMP_POOL_D, new Color(
            yellow.r, yellow.g, yellow.b, LAMP_POOL_ALPHA,
        ));
        lamp.addChild(pool);
        pool.setPosition(over, 0, 0);

        // A quarter turn lays the arm along x. Drawn in ROAD rather than in an ink of its own:
        // from above a lamp post is a dark stick, and the darkest thing this palette has is its
        // asphalt.
        const arm = roundedSprite('arm', LAMP_POST_W, LAMP_REACH, ROAD, LAMP_POST_W / 2);
        lamp.addChild(arm);
        arm.angle = 90;
        arm.setPosition(over / 2, 0, 0);

        const head = dotSprite('head', LAMP_HEAD_D, yellow);
        lamp.addChild(head);
        head.setPosition(over, 0, 0);
    }

    /**
     * How far out on the verge something of radius `radius` stands, given a draw in [0, 1).
     *
     * The band runs from `VERGE_IN` out to wherever the canvas edge leaves room for the thing's
     * own radius, and is floored at `VERGE_MIN_BAND` wide so a narrow viewport gives a cramped
     * street rather than an inverted one.
     */
    private vergeX(t: number, radius: number): number {
        const out = Math.max(VERGE_IN + VERGE_MIN_BAND, this.w / 2 - radius);
        return lerp(VERGE_IN, out, t);
    }
}
