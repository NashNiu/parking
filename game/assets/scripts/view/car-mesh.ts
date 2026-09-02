import { Color, Mesh, primitives, utils } from 'cc';
import { Cap, CAP_BOX } from '../core/index';

/**
 * The car, DRAWN rather than modelled: one flat vertex-coloured mesh per body colour.
 *
 * WHY IT IS DRAWN. The camera is orthographic, so a car is its ROOF plus however much of its
 * side the board's tilt reveals -- and nothing else. That was measured on the GLB models this
 * replaces, back when the board was flat: eight of the nine primitives in the first set were
 * invisible, and in the second set the windscreen, the rear window and the hubcaps were all 0%.
 * A model authored for a 3/4 view cannot be rescued by recolouring, and a model authored for
 * THIS view is a plan with a wall round it.
 *
 * THE WALL IS REAL GEOMETRY NOW, and that is the whole point of the board being tilted. Four
 * rounds went into faking it -- a dark copy of the silhouette offset down the screen -- and it
 * could not be made to work: the offset had to be in BOARD space, because it stood for the
 * light's direction, while the wheels and everything else on the car are in the CAR's space, so
 * their relation changed with the heading. A car lying across the screen looked right; one
 * pointing up it wore the wall on its tail with the wheels stuck to the back bumper. A real wall
 * turns with the car, so every part is where it belongs at every heading, and the engine lights
 * the four sides differently for free.
 *
 * WHAT READS AS A CAR FROM DIRECTLY ABOVE, in the order the cues matter:
 *
 *   1. A ROUNDED ROOF THE REAL LIGHT CAN FIND. See DOME_PROFILE -- not baked, unlike the rest.
 *   2. ONE hue. The paint, and whatever the light does to it. A second hue anywhere reads as a
 *      decal, not as form.
 *   3. A CRISP silhouette: straight sides and ends, with only enough corner radius to take the
 *      hard point off. See the note on BODY_CORNER.
 *   4. Glass ON THE WALL, as a band round the car at window height, not panels on the roof. On
 *      a flat board the roof was the only surface there was, so the windows had to go there and
 *      read as dark holes punched in it; with a wall to put them on they read as windows. The
 *      band runs right round rather than stopping at the ends, which is what a vehicle looks
 *      like from up here and is a great deal simpler than partial rings.
 *   5. Wheels that only just show. Drawn UNDER the body, so all that appears is the sliver
 *      past its silhouette -- which is all a wheel is from above. HOW MANY of them is what
 *      tells a bus from a car; see `axles`.
 *
 * WHY THE DEPTH HAS TO COME FROM THE LIGHT AND NOT FROM BAKED SHADING. A highlight on one side
 * is a claim about where the light is, and the mesh ROTATES WITH THE CAR -- so anything baked
 * asymmetrically puts the highlight on the left of a car heading one way and on the right of a
 * car heading back. Bake it symmetrically instead and you get a centred ridge, which survives
 * being turned but reads as a bar with a stripe down it rather than as a solid. That was the
 * first version of this file, and "still not enough depth" was exactly right about it.
 *
 * A NORMAL, unlike a colour, is transformed by the node. So tilting the roof's normals buys the
 * highlight from the engine, on the correct side, for every heading, for nothing. The plates
 * stay flat to within a few hundredths of a unit -- under this camera height buys no pixels --
 * but their NORMALS sweep from tilted-outward at the rim to straight-up at the crown, and the
 * light sees a dome where there is barely one.
 *
 * The key light is at euler (-55, 0, 0) -- see `setupEnvironment` -- so it travels
 * (0, -0.82, -0.57): mostly down the screen, partly into the board. That screen-vertical
 * component is what makes this work at all. Level the key light out toward the board normal and
 * the car goes flat, with nothing in the console to say why.
 *
 * EVERY NUMBER HERE IS A FRACTION of the car's length and width, never a world size. The three
 * caps differ in length by more than 2x, and one mesh is shared across all of them: `carMesh`
 * builds in a unit box and `buildCar` scales the node to the size core says the car has. That
 * is what keeps the whole lot down to one draw call per colour.
 *
 * To judge a change to these numbers, run `python tools/car-plan.py` -- it reads the constants
 * out of this file and renders the three caps at their real aspect ratios. It APPROXIMATES the
 * lighting (Lambert against the key light's real direction, normalised so a flat plate reads as
 * authored), so trust it on direction and layout, not on exact colour. Do not tune these from a
 * phone screenshot alone; four rounds of that got the car wrong four times.
 */

type Pt = readonly [number, number];

/** The body outline, as a fraction of the car. */
const BODY_ALONG = 0.94;
const BODY_ACROSS = 0.90;

/**
 * How much the body's four corners are rounded -- and the one number here that was settled
 * ON A DEVICE rather than by the offline render.
 *
 * The body used to be an OCTAGON, its nose and tail narrower than its waist, and the reasoning
 * for it was sound as far as it went: a rounded rectangle has parallel sides, and at the size
 * the plan renderer draws it a taper is what stops the car reading as a bar. Three earlier
 * rounds of tuning a rounded-rectangle body had failed on exactly that.
 *
 * It does not survive being shrunk to a phone. A car is about forty pixels long on screen, so
 * the taper's slants are two or three pixels of diagonal on each corner -- too few to read as a
 * shape, enough to make the outline mushy. Straight sides and ends with a small radius read
 * crisper at that size, which is the size that counts. What actually carries the form at forty
 * pixels turned out to be the shading and the glass, not the silhouette.
 *
 * So: do not "restore the taper" from the offline render alone. The render is still the only
 * way to judge the shading, the glass and the arrow, but on the OUTLINE it disagreed with the
 * device and the device won. If the corners are ever revisited, look at both.
 */
const BODY_CORNER = 0.10;

/**
 * The car's real silhouette: the body outline grown a little, more across than along. It is the
 * wall's footprint, and the roof's shoulder now starts on it exactly.
 *
 * IT USED TO BE A DARK RIM -- a flat lip of paint at EDGE_SHADE 0.52, filling the gap between
 * this outline and the roof's outermost ring. That gap existed because the ring sat on the
 * ungrown body outline, so something had to cap the top of the wall. Growing the ring onto this
 * outline instead closes the gap, and the lip goes away rather than being recoloured: paint it
 * the body colour and it would have become a BRIGHT halo instead of a dark one, because it
 * faces straight up while the shoulder just inside it is tilted away.
 *
 * What it cost: two cars of the same colour parked side by side no longer have a dark line
 * between them. What separates them now is one car's wall against the other's roof, which the
 * tilt makes about a fifth of a world unit tall -- see WALL_LIFT and CAR_HEIGHT.
 */
const EDGE_GROW_ALONG = 1.015;
const EDGE_GROW_ACROSS = 1.075;

/**
 * The roof, as concentric rings of the body outline whose NORMALS tilt outward.
 *
 * `at` is how far in from the rim a ring sits, as a fraction of the total inset; `tilt` is how
 * far its normal leans away from straight up, in degrees. Consecutive rings are stitched into
 * bands and the normal is interpolated across each one, so four rings read as a single
 * continuous shoulder rather than four steps.
 *
 * THE TILTS LOOK TOO SMALL, AND THEY ARE NOT. The node's scale is non-uniform -- (len, wid, 1)
 * -- and Cocos transforms normals by the inverse transpose (`CCGetWorldMatrixFull`, which gets
 * this right under instancing too). Dividing the across component by the car's width, about
 * 0.57, AMPLIFIES the tilt by roughly 1.8x on the way to world space: 20 degrees in mesh space
 * arrives as about 33, and past 35 it saturates. Judge these by the render, never by the number.
 *
 * NOTHING IS LIGHTENED HERE, and that is deliberate. The crown is EXACTLY the colour handed in,
 * so a car and a passenger of the same colour resolve to the same albedo -- verified rather than
 * assumed: both go through builtin-standard with the same PBR parameters, and both convert sRGB
 * with the same `x * x` (Cocos uses gamma 2.0 on the CPU for a `linear: true` property and the
 * identical curve in the shader's `SRGBToLinear`). An earlier version lightened the crown a
 * little as insurance against the lighting under-delivering; the side wall covers that now, and
 * it is worth more to have the car's own colour be the palette's colour and nothing else.
 */
const DOME_NARROW = 0.36;
const DOME_RISE = 0.03;
const DOME_PROFILE: readonly { at: number; tilt: number }[] = [
    { at: 0.00, tilt: 32 },
    { at: 0.34, tilt: 22 },
    { at: 0.66, tilt: 11 },
    { at: 1.00, tilt: 0 },
];

/**
 * Wheels, low on the wall so only the overhang past the body shows.
 *
 * WHEEL_Y is what decides how much that is: at 0.40 they reached 0.51 against a rim at 0.484,
 * which was plenty while the car was a flat plan on a pale floor and almost nothing once that
 * rim became the top of a wall. 0.45 reaches 0.56 and clears it by 0.076 of the car's width.
 *
 * IN THE CAR'S OWN FRAME, which is the only frame they can be in. A version of this file put
 * them in a screen-space side wall so they would sit at the car's foot; that works for a car
 * lying across the screen and falls apart for one pointing up it, where the wall lands on the
 * car's TAIL and takes the wheels with it -- two dark blobs stuck to the back bumper. The
 * parking bay made it obvious, every stall holding a car pointing up. See the README.
 *
 * HOW MANY, and why it is per capacity. Only ONE side of a car is ever visible: the camera
 * looks at the board from up-screen, so a car lying across the screen shows the two wheels on
 * its near side and nothing of the far pair, while a car pointing up the screen shows both
 * sides in profile. That is why every vehicle read as a two-wheeler however long it was, and
 * why "the coach should have four wheels" was a request for four along ONE side -- so the big
 * cap gets four per side, at the two mirrored offsets below, and its wheels are narrower so
 * the four read as four rather than as a smear. Small and medium keep one axle at each end.
 *
 * The count is now a SIZE CUE, which is worth more than it cost: medium and big are within
 * 11% of each other in length (1.611 against 1.793, see CAP_BOX) and were hard to tell apart.
 */
const WHEEL_X = 0.30;
const BUS_WHEEL_X_OUTER = 0.37;
const BUS_WHEEL_X_INNER = 0.13;
const WHEEL_Y = 0.45;
const WHEEL_W = 0.15;
const BUS_WHEEL_W = 0.10;
const WHEEL_H = 0.22;
const WHEEL_R = 0.35;
const TYRE = new Color(25, 28, 34);

/**
 * Where this capacity's wheels sit along the body, as fractions of its length from the centre,
 * and how wide each one is. Mirrored across the centreline already, so the list IS one side.
 */
function axles(cap: Cap): { xs: readonly number[]; w: number } {
    return cap === 'big'
        ? {
            xs: [BUS_WHEEL_X_OUTER, BUS_WHEEL_X_INNER, -BUS_WHEEL_X_INNER, -BUS_WHEEL_X_OUTER],
            w: BUS_WHEEL_W,
        }
        : { xs: [WHEEL_X, -WHEEL_X], w: WHEEL_W };
}

/**
 * Glass: a band round the side wall, between GLASS_LOW and GLASS_HIGH of the car's height.
 *
 * GROWN A HAIR OUTWARD (GLASS_OUT) so it sits just proud of the wall instead of coplanar with
 * it, which would z-fight the whole way round. It reaches past the car's silhouette by about
 * 0.0014 world units, which is nothing.
 *
 * The shade is deeper than anything else on the car on purpose: the wall it sits on is already
 * the car's darkest lit surface, so the glass has to be darker still to read as glass rather
 * than as a slightly different panel. But only just -- the first version at 0.52 across 46% of
 * the wall's height came out at 30% of the roof's brightness over most of the visible side, so
 * the WALL got reported as too dark when the wall itself was fine at 58% and the glass was
 * covering it. Measured with `tools/car-plan.py`, which prints these percentages.
 */
const GLASS_LOW = 0.40;
const GLASS_HIGH = 0.74;
const GLASS_OUT = 1.006;
const GLASS_SHADE = 0.66;

/**
 * Two thin lines across the roof, at +-RAIL_X, which is clear of the arrow (it spans -0.19 to
 * +0.15). They read as panel seams, and their job is to give the roof something for the eye to
 * measure its curve against -- a single flat expanse of colour reads flatter than it is however
 * well it is shaded.
 */
const RAIL_X = 0.34;
const RAIL_W = 0.020;
const RAIL_H = 0.50;
const RAIL_SHADE = 0.84;

/** The exit arrow, pointing +X (the body's own forward). */
const ARROW_X = -0.02;
const ARROW_W = 0.34;
const ARROW_H = 0.54;
const ARROW_SHAFT = 0.42;
const ARROW_HEAD = 0.52;

/**
 * How tall the car stands off the board, in WORLD units.
 *
 * WORLD, not a fraction: the node's scale is (len, wid, 1), so Z is the one axis the three caps
 * share, and all three should stand about the same height anyway -- a small car is not a third
 * as tall as a truck.
 *
 * What it buys on screen is CAR_HEIGHT * sin(BOARD_TILT), so the two have to be judged together.
 * At the tilt of 38 degrees this ships with, 0.34 shows about 0.21 world units of wall, a bit
 * over a third of a medium car's width.
 *
 * It is also the amount by which the drawn car sits up-screen of the footprint core reasons
 * about, so `onTap` subtracts it back out; see ROOF_RISE in GameController.
 */
export const CAR_HEIGHT = 0.34;

/**
 * The side wall's paint: lifted toward white, then graded a little darker at the foot.
 *
 * WHY IT IS LIFTED AND NOT JUST LEFT AS THE BODY COLOUR. The wall receives 58% of the light the
 * roof does (measured -- `tools/car-plan.py` prints it), and 58% of the light on a SATURATED
 * colour is darker than it sounds: red (244,67,72) carries only 41% of white's luminance to
 * begin with, so the lit wall lands at 24% and reads nearly black. Multiplying is not what a
 * painter does to a shaded face; they shift it toward the light that is actually falling on it,
 * which here is a grey-blue sky ambient. WALL_LIFT is that shift, and it is why the side can read
 * as "the same car, in shade" rather than as a hole -- which is what it was reported as.
 */
const WALL_LIFT = 0.24;
const WALL_FOOT = 0.90;

/** How high up the wall the wheels sit. Low, so they read as touching the ground. */
const WHEEL_Z = 0.03;

/**
 * Depth steps, in WORLD units and deliberately tiny: they order the plates and nothing else.
 * The node carries no Z scale, so these stay the same however long the car is. Coplanar
 * plates would z-fight, which is the only reason they are not all at zero.
 */
const Z_STEP = 0.008;

/**
 * Arc segments per rounded corner. 5, not 3: on the body's rings a corner is where the outward
 * normal swings through ninety degrees, and too few segments show up as facets in the highlight.
 * The wheels and windows would be fine with 3 and share this only for simplicity.
 */
const CORNER_SEGMENTS = 5;

/**
 * Length-to-width ratio the rounded corners are shaped for -- the medium car's, which is the
 * commonest on a board. READ OFF CAP_BOX rather than written down: it was a literal 3.126, and
 * a revision that resized medium would have left it describing the wrong car in silence.
 *
 * A corner radius is only a circle in WORLD space, and the mesh is built in a unit box that
 * then gets stretched by (len, wid). Take the radius as a plain fraction of the normalized
 * shape and the stretch turns it into an ellipse three times wider than tall: the windows come
 * out rounded on their short sides and square on their long ones, which is a brick, not glass.
 * So the radius is worked out at this aspect and divided back out along X, which makes the
 * corners true circles on a medium car and near enough on big (3.15 against 3.13) -- small, at
 * 2.05, is the one carrying real error, its corners about half again as rounded along X as
 * across.
 *
 * That could now be made exact: the mesh is keyed by CAPACITY as well as colour (see
 * `carMesh`), so each cap could be shaped at its own aspect. It would mean threading the
 * aspect through `bodyOutline` and `roundRect` instead of reading a module constant, and the
 * error it removes has never been reported, so it is recorded here rather than done.
 */
const REFERENCE_ASPECT = CAP_BOX.medium.len / CAP_BOX.medium.wid;

/**
 * Convert an ACROSS shrink into the ALONG shrink that removes the same distance in world units.
 * Without it the roof's shoulder would be three times wider at the nose than along the flank,
 * because a fraction of the length is three times a fraction of the width.
 */
const ACROSS_TO_ALONG = (BODY_ACROSS / BODY_ALONG) / REFERENCE_ASPECT;

function lighten(c: Color, t: number): Color {
    const up = (v: number): number => Math.round(v + (255 - v) * t);
    return new Color(up(c.r), up(c.g), up(c.b), 255);
}

function shade(c: Color, f: number): Color {
    return new Color(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f), 255);
}

/**
 * A rounded rectangle as a counter-clockwise polygon. `r` is a fraction of the shape's shorter
 * side MEASURED AT REFERENCE_ASPECT, so the corner comes out circular once the node's stretch
 * is applied; see that constant.
 */
function roundRect(cx: number, cy: number, w: number, h: number, r: number): Pt[] {
    const hw = w / 2, hh = h / 2;
    // In world terms the shape is (w * aspect) by h; take the radius there, then bring it back.
    const world = r * Math.min(w * REFERENCE_ASPECT, h);
    const rx = Math.min(world / REFERENCE_ASPECT, hw), ry = Math.min(world, hh);
    const ix = hw - rx, iy = hh - ry;
    const pts: Pt[] = [];
    // Corner centres in counter-clockwise order, each swept a quarter turn.
    const corners: readonly Pt[] = [[ix, -iy], [ix, iy], [-ix, iy], [-ix, -iy]];
    for (let c = 0; c < 4; c++) {
        const [ox, oy] = corners[c];
        const start = -Math.PI / 2 + c * (Math.PI / 2);
        for (let s = 0; s <= CORNER_SEGMENTS; s++) {
            const a = start + (s / CORNER_SEGMENTS) * (Math.PI / 2);
            pts.push([cx + ox + Math.cos(a) * rx, cy + oy + Math.sin(a) * ry]);
        }
    }
    return pts;
}

/**
 * The body outline at a fraction of full size. The corner radius shrinks with it, because
 * `roundRect` takes it as a fraction of the shape's own shorter side -- which is what keeps the
 * dome steps looking like one curved roof rather than a stack of differently-rounded plates.
 */
function bodyOutline(along: number, across: number): Pt[] {
    return roundRect(0, 0, BODY_ALONG * along, BODY_ACROSS * across, BODY_CORNER);
}

/** The arrow, as the two convex pieces it is made of: a shaft rectangle and a head triangle. */
function arrowPieces(): Pt[][] {
    const hw = ARROW_W / 2, hh = ARROW_H / 2;
    const shaft = hh * ARROW_SHAFT;
    const base = ARROW_X + hw - ARROW_W * ARROW_HEAD;
    return [
        [[ARROW_X - hw, -shaft], [base, -shaft], [base, shaft], [ARROW_X - hw, shaft]],
        [[base, -hh], [ARROW_X + hw, 0], [base, hh]],
    ];
}

/**
 * The outward direction of a counter-clockwise polygon at each of its vertices, in the plan.
 *
 * Taken from the neighbours rather than from the centre: measured from the centre, a point
 * halfway along a long flank would point diagonally instead of squarely out of that flank.
 * These are MESH-space directions -- the node's inverse transpose turns them into the correct
 * world normals for the stretched shape, which is exactly what that transform is for.
 */
function outwards(pts: readonly Pt[]): Pt[] {
    const n = pts.length;
    return pts.map((_, i) => {
        const [ax, ay] = pts[(i + 1) % n];
        const [bx, by] = pts[(i - 1 + n) % n];
        const dx = ax - bx, dy = ay - by;
        const len = Math.hypot(dx, dy) || 1;
        return [dy / len, -dx / len] as Pt;         // CCW winding, so this points outward
    });
}

/** One ring of the roof: an outline, the height it sits at, its colour, and its normal tilt. */
interface Ring { pts: readonly Pt[]; z: number; c: Color; tilt: number }

/** A flat, straight-up-facing piece: the rim, the wheels, the glass, the arrow. */
interface Flat { pts: readonly Pt[]; c: Color }

/** Vertex/index accumulator. Flat convex polygons, plus rings stitched into shaded bands. */
class Plan {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly colors: number[] = [];
    readonly indices: number[] = [];

    /** One ring of vertices, normals tilted `tilt` degrees outward. Returns its first index. */
    private ring(pts: readonly Pt[], z: number, c: Color, tilt: number): number {
        const base = this.positions.length / 3;
        const r = c.r / 255, g = c.g / 255, b = c.b / 255;
        const out = outwards(pts);
        const lean = Math.sin(tilt * Math.PI / 180), up = Math.cos(tilt * Math.PI / 180);
        for (let i = 0; i < pts.length; i++) {
            this.positions.push(pts[i][0], pts[i][1], z);
            this.normals.push(out[i][0] * lean, out[i][1] * lean, up);
            this.colors.push(r, g, b, 1);
        }
        return base;
    }

    /** Add one convex polygon at height `z`, fanned from its first point, facing straight up. */
    addFlat(pts: readonly Pt[], z: number, c: Color): void {
        const base = this.ring(pts, z, c, 0);
        for (let i = 1; i < pts.length - 1; i++) {
            this.indices.push(base, base + i, base + i + 1);
        }
    }

    /**
     * Add the band between two rings of EQUAL vertex count, corresponding index for index.
     * Every outline here comes from `roundRect` with the same segment count, so they do -- but
     * a silently mismatched pair would stitch the roof to itself diagonally, so it is checked.
     */
    addBand(outer: Ring, inner: Ring): void {
        if (outer.pts.length !== inner.pts.length) {
            throw new Error('car-mesh: band rings differ in vertex count');
        }
        const a = this.ring(outer.pts, outer.z, outer.c, outer.tilt);
        const b = this.ring(inner.pts, inner.z, inner.c, inner.tilt);
        const n = outer.pts.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            this.indices.push(a + i, a + j, b + i);
            this.indices.push(a + j, b + j, b + i);
        }
    }
}

/**
 * The whole car, described rather than built: the flat pieces under the roof, the roof's rings,
 * and the flat pieces on top of it.
 *
 * Split out from `carMesh` so `tools/car-plan.py` has one description to mirror and the ordering
 * cannot drift between the mesh and the picture used to judge it.
 */
function design(
    color: Color, cap: Cap,
): { rim: readonly Pt[]; wheels: Flat[]; rings: Ring[]; over: Flat[] } {
    const rim = bodyOutline(EDGE_GROW_ALONG, EDGE_GROW_ACROSS);
    const wheels: Flat[] = [];
    const axle = axles(cap);
    for (const x of axle.xs) {
        for (const sy of [-1, 1]) {
            wheels.push({
                pts: roundRect(x, sy * WHEEL_Y, axle.w, WHEEL_H, WHEEL_R),
                c: TYRE,
            });
        }
    }

    // The outermost ring sits ON the silhouette, at exactly the wall's top edge, so the wall
    // and the roof meet with nothing between them. DOME_NARROW's inset is unchanged: it is
    // subtracted from the grown outline rather than from the body's.
    const rings: Ring[] = DOME_PROFILE.map(({ at, tilt }) => ({
        pts: bodyOutline(EDGE_GROW_ALONG - DOME_NARROW * ACROSS_TO_ALONG * at,
            EDGE_GROW_ACROSS - DOME_NARROW * at),
        z: CAR_HEIGHT + DOME_RISE * at,
        c: color,
        tilt,
    }));

    const rail = shade(color, RAIL_SHADE);
    const over: Flat[] = [
        { pts: roundRect(RAIL_X, 0, RAIL_W, RAIL_H, 0.5), c: rail },
        { pts: roundRect(-RAIL_X, 0, RAIL_W, RAIL_H, 0.5), c: rail },
        ...arrowPieces().map((pts) => ({ pts, c: Color.WHITE }) as Flat),
    ];
    return { rim, wheels, rings, over };
}

function colourKey(c: Color, cap: Cap): string {
    return `${c.r},${c.g},${c.b},${cap}`;
}

const meshCache = new Map<string, Mesh>();

/**
 * The whole car as ONE mesh, in a unit box (length along X, width along Y, -0.5..0.5), with
 * every plate's colour baked into its vertices. Cached per (colour, CAPACITY) -- six colours
 * in the palette and three capacities, so at most eighteen meshes serve a whole lot.
 *
 * It was per colour alone until the wheels stopped being the same on every vehicle (see
 * `axles`). The cost is draw calls: one instanced draw per (mesh, material) pair, so a lot
 * went from six to at most eighteen. That is nothing here -- the frame-rate problem this
 * design solved was ~414 draws for 46 modelled cars, and the JS-side cost of walking a
 * thousand renderers, neither of which eighteen comes near.
 *
 * Vertex colours, not materials, are what collapse the draw calls. The car needs a white
 * arrow, near-black tyres and several shades of its own paint; as materials that is a dozen
 * renderers per car and no two cars batching. Baked into the mesh it is one renderer per car,
 * and every car of a colour shares mesh AND material, so the lot costs one instanced draw per
 * colour. See `vertexColorMaterial`.
 *
 * The roof's SHADING is not baked -- only its colour is. Its normals do that work, and the
 * engine's key light does the rest; see DOME_PROFILE.
 */
export function carMesh(color: Color, cap: Cap): Mesh {
    const key = colourKey(color, cap);
    const hit = meshCache.get(key);
    if (hit) return hit;

    const plan = new Plan();
    const { rim, wheels, rings, over } = design(color, cap);

    // The wheels first, low on the wall, so the wall's own band draws over whatever part of them
    // falls inside the body: what shows is the sliver past the silhouette, which is all a wheel
    // is from up here.
    for (const wheel of wheels) plan.addFlat(wheel.pts, WHEEL_Z, wheel.c);

    // THE WALL: the body's outline extruded from the board up to the roof, with the vertices'
    // normals lying flat and pointing outward (tilt 90). That is what makes the engine light the
    // four sides differently -- and, unlike everything the fake wall tried, it turns with the
    // car, so the side facing the viewer is always the side facing the viewer.
    const wall = lighten(color, WALL_LIFT);
    plan.addBand(
        { pts: rim, z: 0, c: shade(wall, WALL_FOOT), tilt: 90 },
        { pts: rim, z: CAR_HEIGHT, c: wall, tilt: 90 },
    );
    // The window band, on the same outline grown just enough not to z-fight the wall.
    const glassPts = bodyOutline(EDGE_GROW_ALONG * GLASS_OUT, EDGE_GROW_ACROSS * GLASS_OUT);
    const glass = shade(color, GLASS_SHADE);
    plan.addBand(
        { pts: glassPts, z: CAR_HEIGHT * GLASS_LOW, c: glass, tilt: 90 },
        { pts: glassPts, z: CAR_HEIGHT * GLASS_HIGH, c: glass, tilt: 90 },
    );
    for (let i = 0; i + 1 < rings.length; i++) plan.addBand(rings[i], rings[i + 1]);
    const roof = rings[rings.length - 1];
    plan.addFlat(roof.pts, roof.z, roof.c);            // the crown, inside the innermost ring
    for (let i = 0; i < over.length; i++) {
        plan.addFlat(over[i].pts, roof.z + (i + 1) * Z_STEP, over[i].c);
    }
    const top = roof.z + over.length * Z_STEP;
    const geometry: primitives.IGeometry = {
        positions: plan.positions,
        normals: plan.normals,
        colors: plan.colors,
        indices: plan.indices,
        // Given by hand: the plates all live inside the unit box by construction, and letting
        // createMesh derive the bounds from a vertex sweep would only rediscover that.
        minPos: { x: -0.5, y: -0.5, z: 0 },
        maxPos: { x: 0.5, y: 0.5, z: top },
        boundingRadius: Math.sqrt(0.5),
    };
    const mesh = utils.createMesh(geometry);
    meshCache.set(key, mesh);
    return mesh;
}
