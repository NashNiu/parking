import { Color, Mesh, primitives, utils } from 'cc';

/**
 * The car, DRAWN rather than modelled: one flat vertex-coloured mesh per body colour.
 *
 * WHY IT IS DRAWN. The camera is orthographic and looks at the board straight on, so a car IS
 * its top-down plan and nothing else -- every part hidden behind a higher one contributes
 * exactly zero pixels. That was measured on the GLB models this replaces: eight of the nine
 * primitives in the first set were invisible from here, and in the second set the windscreen,
 * the rear window and the hubcaps were all 0%. A model authored for a 3/4 view cannot be
 * rescued by recolouring, and a model authored for THIS view is a plan with extra steps.
 *
 * WHAT READS AS A CAR FROM DIRECTLY ABOVE, in the order the cues matter:
 *
 *   1. A TAPERED silhouette. A rounded rectangle has parallel sides and reads as a bar however
 *      it is shaded; an octagon whose nose is narrower than its waist reads as a vehicle. Three
 *      rounds of tuning a rounded-rectangle body failed on exactly this and no amount of
 *      shading fixed it.
 *   2. ONE hue. Dark rim, main colour, and a few progressively lighter steps -- all shades of
 *      the same paint. A second hue anywhere reads as a decal, not as form.
 *   3. Asymmetric glass. A wide windscreen and a narrow rear window say which end is the front
 *      before the arrow does.
 *   4. Wheels that only just show. Drawn UNDER the body, so all that appears is the sliver
 *      past its silhouette -- which is all a wheel is from above.
 *
 * The dome is FAKE and has to be: the plates are coplanar to within a hundredth of a unit, so
 * the depth steps below exist only to order the draw, not to catch light. Under a head-on
 * camera with the key light travelling almost straight into the board there is no lateral
 * shading to be had, so the "curve" is four narrowing plates, each a little lighter. Four steps
 * read as a curve; two read as stacked plates.
 *
 * The dome is also SYMMETRIC across the car, and that is not a stylistic choice. A highlight
 * offset to one side is a claim about where the light is, and the mesh rotates with the car --
 * so an offset baked in here would put the highlight on the left of a car heading one way and
 * on the right of a car heading back. A centred ridge is the only version that survives being
 * turned.
 *
 * EVERY NUMBER HERE IS A FRACTION of the car's length and width, never a world size. The three
 * caps differ in length by more than 2x, and one mesh is shared across all of them: `carMesh`
 * builds in a unit box and `buildCar` scales the node to the size core says the car has. That
 * is what keeps the whole lot down to one draw call per colour.
 *
 * To judge a change to these numbers, run `python tools/car-plan.py` -- it reads the constants
 * out of this file and renders the three caps at their real aspect ratios. Do not tune them
 * from a phone screenshot; four rounds of that got the car wrong four times.
 */

type Pt = readonly [number, number];

/** The body outline: nose narrower than the waist, tail narrower again. Counter-clockwise. */
const TAPER: readonly Pt[] = [
    [-0.47, -0.37], [-0.36, -0.45], [0.29, -0.45], [0.47, -0.33],
    [0.47, 0.33], [0.29, 0.45], [-0.36, 0.45], [-0.47, 0.37],
];

/** The dark rim: the body outline grown a little, more across than along. */
const EDGE_GROW_ALONG = 1.015;
const EDGE_GROW_ACROSS = 1.075;
const EDGE_SHADE = 0.52;

/** The fake dome: BEVEL plates, each narrowed and lightened by one more step. */
const BEVEL = 4;
const BEVEL_LIFT = 0.055;
const BEVEL_NARROW = 0.30;
const BEVEL_SHORTEN = 0.09;

/** Wheels, at (±x, ±y), drawn under the body so only the overhang shows. */
const WHEEL_X = 0.30;
const WHEEL_Y = 0.40;
const WHEEL_W = 0.15;
const WHEEL_H = 0.22;
const WHEEL_R = 0.35;
const TYRE = new Color(25, 28, 34);

/**
 * Glass: black at 42% over the plate beneath it, which is the topmost dome step. Composited
 * here rather than blended by the GPU -- the result is identical for a flat opaque stack, and
 * it keeps the whole car on one opaque instanced material.
 */
const GLASS_KEEP = 0.58;
const WINDSCREEN_X = 0.225;
const WINDSCREEN_W = 0.115;
const WINDSCREEN_H = 0.52;
const REAR_WINDOW_X = -0.285;
const REAR_WINDOW_W = 0.070;
const REAR_WINDOW_H = 0.40;
const WINDOW_R = 0.30;

/** The exit arrow, pointing +X (the body's own forward). */
const ARROW_X = -0.02;
const ARROW_W = 0.34;
const ARROW_H = 0.54;
const ARROW_SHAFT = 0.42;
const ARROW_HEAD = 0.52;

/**
 * Depth steps, in WORLD units and deliberately tiny: they order the plates and nothing else.
 * The node carries no Z scale, so these stay the same however long the car is. Coplanar
 * plates would z-fight, which is the only reason they are not all at zero.
 */
const Z_STEP = 0.008;

/** Arc segments per rounded corner. Wheels and windows are small; 3 is already smooth. */
const CORNER_SEGMENTS = 3;

/**
 * Length-to-width ratio the rounded corners are shaped for -- the medium car's, which is the
 * commonest on a board.
 *
 * A corner radius is only a circle in WORLD space, and the mesh is built in a unit box that
 * then gets stretched by (len, wid). Take the radius as a plain fraction of the normalized
 * shape and the stretch turns it into an ellipse three times wider than tall: the windows come
 * out rounded on their short sides and square on their long ones, which is a brick, not glass.
 * So the radius is worked out at this aspect and divided back out along X, which makes the
 * corners true circles on a medium car and near enough on the other two (2.05 and 3.14 against
 * 3.13). One shared mesh is worth that much error; a mesh per cap would not be.
 */
const REFERENCE_ASPECT = 3.126;

function lighten(c: Color, t: number): Color {
    const up = (v: number): number => Math.round(v + (255 - v) * t);
    return new Color(up(c.r), up(c.g), up(c.b), 255);
}

function shade(c: Color, f: number): Color {
    return new Color(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f), 255);
}

/** `TAPER` scaled about its own centre. */
function shrunk(along: number, across: number): Pt[] {
    return TAPER.map(([x, y]) => [x * along, y * across] as Pt);
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

/** Vertex/index accumulator for a plan built out of flat, +Z-facing convex polygons. */
class Plan {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly colors: number[] = [];
    readonly indices: number[] = [];

    /** Add one convex polygon at height `z`, fanned from its first point. */
    add(pts: readonly Pt[], z: number, c: Color): void {
        const base = this.positions.length / 3;
        const r = c.r / 255, g = c.g / 255, b = c.b / 255;
        for (const [x, y] of pts) {
            this.positions.push(x, y, z);
            this.normals.push(0, 0, 1);
            this.colors.push(r, g, b, 1);
        }
        for (let i = 1; i < pts.length - 1; i++) {
            this.indices.push(base, base + i, base + i + 1);
        }
    }
}

/**
 * Every plate of the car, bottom to top, with its colour derived from `color`.
 *
 * Split out from `carMesh` so `tools/car-plan.py` has one list to mirror and the ordering
 * cannot drift between the mesh and the picture used to judge it.
 */
function plates(color: Color): { pts: readonly Pt[]; c: Color }[] {
    const out: { pts: readonly Pt[]; c: Color }[] = [];
    out.push({ pts: shrunk(EDGE_GROW_ALONG, EDGE_GROW_ACROSS), c: shade(color, EDGE_SHADE) });
    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            out.push({
                pts: roundRect(sx * WHEEL_X, sy * WHEEL_Y, WHEEL_W, WHEEL_H, WHEEL_R),
                c: TYRE,
            });
        }
    }
    out.push({ pts: TAPER, c: color });
    let top = color;
    for (let i = 1; i <= BEVEL; i++) {
        const t = i / BEVEL;
        top = lighten(color, BEVEL_LIFT * i);
        out.push({ pts: shrunk(1 - BEVEL_SHORTEN * t, 1 - BEVEL_NARROW * t), c: top });
    }
    const glass = shade(top, GLASS_KEEP);
    out.push({
        pts: roundRect(WINDSCREEN_X, 0, WINDSCREEN_W, WINDSCREEN_H, WINDOW_R), c: glass,
    });
    out.push({
        pts: roundRect(REAR_WINDOW_X, 0, REAR_WINDOW_W, REAR_WINDOW_H, WINDOW_R), c: glass,
    });
    for (const piece of arrowPieces()) out.push({ pts: piece, c: Color.WHITE });
    return out;
}

const meshCache = new Map<string, Mesh>();

/**
 * The whole car as ONE mesh, in a unit box (length along X, width along Y, -0.5..0.5), with
 * every plate's colour baked into its vertices. Cached per colour -- there are six car colours
 * in the palette, so six meshes serve a whole lot.
 *
 * Vertex colours, not materials, are what collapse the draw calls. The car needs a white
 * arrow, near-black tyres and eight shades of its own paint; as materials that is eleven
 * renderers per car and no two cars batching. Baked into the mesh it is one renderer per car,
 * and every car of a colour shares mesh AND material, so the lot costs one instanced draw per
 * colour. See `vertexColorMaterial`.
 */
export function carMesh(color: Color): Mesh {
    const key = `${color.r},${color.g},${color.b}`;
    const hit = meshCache.get(key);
    if (hit) return hit;

    const plan = new Plan();
    const stack = plates(color);
    for (let i = 0; i < stack.length; i++) {
        plan.add(stack[i].pts, i * Z_STEP, stack[i].c);
    }
    const top = (stack.length - 1) * Z_STEP;
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
