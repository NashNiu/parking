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
 *   1. A SIDE WALL. See SKIRT_DROP -- a dark band along the down-screen edge is the only
 *      thing that says the car has THICKNESS, as opposed to being a rounded flat sticker.
 *      Shading alone does not do it; that was tried and reported back as "still too flat".
 *   2. A ROUNDED ROOF THE REAL LIGHT CAN FIND. See DOME_PROFILE -- not baked, unlike the rest.
 *   3. ONE hue. Side wall, dark rim, main colour, and whatever the light does to it. A second
 *      hue anywhere reads as a decal, not as form.
 *   4. A CRISP silhouette: straight sides and ends, with only enough corner radius to take the
 *      hard point off. See the note on BODY_CORNER.
 *   5. Asymmetric glass. A wide windscreen and a narrow rear window say which end is the front
 *      before the arrow does. It wants to be SMALL and PALE: a dark panel at real size reads as
 *      a hole punched in the roof, not as a window.
 *   6. Wheels that only just show. Drawn UNDER the body, so all that appears is the sliver
 *      past its silhouette -- which is all a wheel is from above.
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

/** The dark rim: the body outline grown a little, more across than along. */
const EDGE_GROW_ALONG = 1.015;
const EDGE_GROW_ACROSS = 1.075;
const EDGE_SHADE = 0.55;

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
 * THE SIDE WALL: the one cue that says the car has height, and the reason it is built the way
 * it is.
 *
 * Under an orthographic camera pointed straight at the board, a wall parallel to the view has
 * exactly zero screen area -- height is not merely hard to see here, it is geometrically absent.
 * So the wall is a FAKE, in the flat-illustration sense: the body's silhouette drawn again in a
 * dark shade of its own colour and offset down the screen, so a band of it shows below the car.
 * That reads as thickness in a way shading never will, which is what "still too flat" was about
 * after the roof was already being lit.
 *
 * IT CANNOT BE BAKED INTO THE MESH, for the same reason the highlight cannot: down-the-screen is
 * a board direction, and the mesh rotates with the car. So it is a second node, offset in board
 * space (see `boardToLocal` in car-builder.ts), sharing this colour's material.
 *
 * THE ROOF STAYS EXACTLY ON THE FOOTPRINT and the whole wall hangs BELOW it. An earlier version
 * split the offset half each way to keep the drawn car centred on core's box; that was the right
 * trade at a wall thin enough to be a bevel and the wrong one now. What the player aims at is the
 * roof -- it is most of the car and all of its colour -- so putting the roof on the footprint
 * makes tap picking EXACT rather than merely close, and leaves the whole error in the wall, which
 * is a band nobody aims at.
 *
 * The wall does then reach 0.19 world units, about 0.26 board units, past the footprint on the
 * down-screen side, and it will overlap whatever is parked behind. That is the 2.5D convention
 * working as intended -- the near car occludes the far one -- and it costs none of the three
 * things a lying picture usually costs. Under an orthographic camera every car shifts by the
 * SAME vector, so relative gaps are exact (blocked/clear reads true), nothing is scaled (the
 * size hierarchy is exact), and the roof is on the box (picking is exact). Those three are what
 * a PERSPECTIVE camera broke, and it broke them because its error was position-dependent; a
 * uniform translation is a different animal. See the camera note in the README.
 *
 * IT HAS TO READ AS THE CAR, NOT AS A SHADOW, and that is what SKIRT_SHADE is for. The first
 * version at 0.44 was too dark by half: against a pale lot floor a band that dark reads as a
 * hole under the car, and with the blob shadow immediately below it the two merged into one dark
 * smear -- reported back as "the shadow makes the car look strange", which was the right
 * diagnosis. A side face in shade is still plainly the same paint, so 0.72. The roof's own rim
 * (EDGE_SHADE) is left DARKER than the wall on purpose: it then reads as the fold between the
 * two rather than as an outline around both.
 *
 * SHORTER, TOO. 0.34 of the car's width was tall enough that the wall competed with the roof for
 * the eye instead of supporting it. Height in a flat illustration is carried by the wall being
 * unmistakably a wall, not by it being big.
 *
 * A FRACTION OF THE CAR'S WIDTH, not a world distance, so the three caps stay proportional and
 * go on sharing one mesh.
 */
const SKIRT_DROP = 0.18;
const SKIRT_SHADE = 0.72;

/**
 * Wheels, at (±x, ±y). They belong to the SIDE WALL, not to the roof: a wheel meets the ground,
 * and the ground here is the wall's lower edge. Being in the wall's mesh puts the down-screen
 * pair low on the wall where a wheel looks like a wheel, and hides the up-screen pair behind
 * the roof, which is exactly what a box seen from above does with its far wheels.
 */
const WHEEL_X = 0.30;
const WHEEL_Y = 0.40;
const WHEEL_W = 0.15;
const WHEEL_H = 0.22;
const WHEEL_R = 0.35;
const TYRE = new Color(25, 28, 34);

/**
 * Glass: black at 30% over the plate beneath it, which is the topmost dome step. Composited
 * here rather than blended by the GPU -- the result is identical for a flat opaque stack, and
 * it keeps the whole car on one opaque instanced material.
 *
 * Both the tint and the panel sizes came DOWN after seeing them on a device (42% black over
 * panels a third larger). Scaled to a forty-pixel car, a dark panel that size stops reading as
 * a window and starts reading as a hole punched through the roof -- and it was competing with
 * the arrow, which is the one thing on the car that has to be read instantly.
 */
const GLASS_KEEP = 0.70;
const WINDSCREEN_X = 0.230;
const WINDSCREEN_W = 0.095;
const WINDSCREEN_H = 0.42;
const REAR_WINDOW_X = -0.288;
const REAR_WINDOW_W = 0.058;
const REAR_WINDOW_H = 0.32;
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

/**
 * Arc segments per rounded corner. 5, not 3: on the body's rings a corner is where the outward
 * normal swings through ninety degrees, and too few segments show up as facets in the highlight.
 * The wheels and windows would be fine with 3 and share this only for simplicity.
 */
const CORNER_SEGMENTS = 5;

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
interface Ring { pts: Pt[]; z: number; c: Color; tilt: number }

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
function design(color: Color): { under: Flat[]; rings: Ring[]; over: Flat[] } {
    const under: Flat[] = [
        { pts: bodyOutline(EDGE_GROW_ALONG, EDGE_GROW_ACROSS), c: shade(color, EDGE_SHADE) },
    ];

    const base = under.length * Z_STEP;
    const rings: Ring[] = DOME_PROFILE.map(({ at, tilt }) => ({
        pts: bodyOutline(1 - DOME_NARROW * ACROSS_TO_ALONG * at, 1 - DOME_NARROW * at),
        z: base + DOME_RISE * at,
        c: color,
        tilt,
    }));

    const roof = rings[rings.length - 1];
    const glass = shade(roof.c, GLASS_KEEP);
    const over: Flat[] = [
        { pts: roundRect(WINDSCREEN_X, 0, WINDSCREEN_W, WINDSCREEN_H, WINDOW_R), c: glass },
        { pts: roundRect(REAR_WINDOW_X, 0, REAR_WINDOW_W, REAR_WINDOW_H, WINDOW_R), c: glass },
        ...arrowPieces().map((pts) => ({ pts, c: Color.WHITE }) as Flat),
    ];
    return { under, rings, over };
}

/** How far down-screen the side wall sits, as a fraction of the car's width. */
export function skirtDrop(): number {
    return SKIRT_DROP;
}

const skirtCache = new Map<string, Mesh>();

/**
 * The car's side wall, as its own mesh: the body silhouette in a dark shade of the body colour,
 * facing straight up so it is lit the same however the car is turned. See SKIRT_DROP for why it
 * is a separate mesh on a separate node rather than another plate in `carMesh`.
 *
 * Same unit box and the same material as the body, so it costs one more instanced draw per
 * colour and nothing else.
 */
export function carSkirtMesh(color: Color): Mesh {
    const key = colourKey(color);
    const hit = skirtCache.get(key);
    if (hit) return hit;
    const plan = new Plan();
    plan.addFlat(bodyOutline(EDGE_GROW_ALONG, EDGE_GROW_ACROSS), 0, shade(color, SKIRT_SHADE));
    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            plan.addFlat(roundRect(sx * WHEEL_X, sy * WHEEL_Y, WHEEL_W, WHEEL_H, WHEEL_R),
                Z_STEP, TYRE);
        }
    }
    const mesh = utils.createMesh({
        positions: plan.positions,
        normals: plan.normals,
        colors: plan.colors,
        indices: plan.indices,
        minPos: { x: -0.5, y: -0.5, z: 0 },
        maxPos: { x: 0.5, y: 0.5, z: 0 },
        boundingRadius: Math.sqrt(0.5),
    });
    skirtCache.set(key, mesh);
    return mesh;
}

function colourKey(c: Color): string {
    return `${c.r},${c.g},${c.b}`;
}

const meshCache = new Map<string, Mesh>();

/**
 * The whole car as ONE mesh, in a unit box (length along X, width along Y, -0.5..0.5), with
 * every plate's colour baked into its vertices. Cached per colour -- there are six car colours
 * in the palette, so six meshes serve a whole lot.
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
export function carMesh(color: Color): Mesh {
    const key = colourKey(color);
    const hit = meshCache.get(key);
    if (hit) return hit;

    const plan = new Plan();
    const { under, rings, over } = design(color);
    for (let i = 0; i < under.length; i++) plan.addFlat(under[i].pts, i * Z_STEP, under[i].c);
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
