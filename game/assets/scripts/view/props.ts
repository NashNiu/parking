import { Node, Color, Material, MeshRenderer, primitives } from 'cc';
import { litMaterial, alphaMaterial, flatMaterial } from './materials';
import { mergeParts, placed, roundedSlabPart, MeshPart } from './slabs';
import { LIFT, shadowThrow, SHADOW_INK, SHADOW_ALPHA } from './shadow';
import { TREE_CROWN, TREE_TRUNK } from './palette';

/**
 * Static scene dressing: the trees and street lamps that stand beside the parking bay.
 *
 * THEY GO WHERE THE ONLY GAP IS, and the gap is small. The screen's vertical budget is SOLVED
 * rather than spent (see `cell` in GameController: everything above the lot is added up and the
 * remainder divides by the row count), so there is no slack up or down -- and a band of unused
 * screen under the lot was once treated as a bug and removed. Across, the lot's slab is widened
 * to the frame. What is left is the strip either side of the PARKING BAY, which is narrower than
 * the lot: about 1.2 board units per side on a portrait phone, or roughly two car widths.
 *
 * So this is four to six objects, not a streetscape. The reference art has room for more because
 * it runs about forty cars to a level against this game's eighty-nine; the board eats the space
 * that dressing would live in, and no amount of modelling here changes that.
 *
 * EVERYTHING IS MERGED BY COLOUR, which is the whole reason this file collects spots and builds
 * once instead of exporting a `buildTree`. A tree is two colours (trunk, crown) and a lamp is
 * two (metalwork, glass), so the four shipped props would be eight draw calls built one at a
 * time. Grouped, the set is FOUR no matter how many props are placed -- and a tree is now
 * three spheres rather than one, so the saving grows with the detail.
 *
 * NOTHING HERE MOVES. Not a performance limit -- a few rotating nodes would be free next to the
 * crowd -- but the eye should be on the cars and the ring, and the one thing scenery must never
 * do is pull attention off the board.
 */

/**
 * THE CROWN IS THREE BALLS, NOT ONE, and one was the whole of what was wrong with it. A single
 * sphere on a stick is a lollipop -- there is no silhouette in it that says tree. Three
 * overlapping spheres of different sizes, nudged off-centre and off-depth from each other, give
 * the lumpy outline a cartoon tree has, for 216 triangles instead of 72.
 *
 * THE EFFECTIVE RADIUS IS HELD AT 0.30 exactly, which is why the offsets and radii look fussy:
 * the strip beside the bay clears its contents by 0.09 board units (see `baySideProps`), so a
 * crown that got wider would not read as a better tree -- it would return no props at all.
 * Spread: -0.300 .. +0.280. `CROWN_SPAN` below is what the fit test uses, and it is the number
 * to keep honest if these are ever retuned.
 */
const TRUNK_R_TOP = 0.060;
const TRUNK_R_BOTTOM = 0.075;
const TRUNK_H = 0.30;
/** Ball radius, and its offset across and in depth from the trunk. */
const CROWN_BALLS: readonly { r: number; x: number; y: number; z: number }[] = [
    { r: 0.240, x: 0.000, y: 0.500, z: 0.000 },
    { r: 0.155, x: -0.145, y: 0.415, z: 0.040 },
    { r: 0.145, x: 0.135, y: 0.435, z: -0.035 },
];
/** The crown's half-width, which is what has to fit. See the note above. */
const CROWN_SPAN = 0.30;

/**
 * THE LAMP WAS INVISIBLE AND IT WAS TWO FAULTS AT ONCE, both of them about size rather than
 * shape. A post of radius 0.035 is 0.07 board units across, which on a portrait phone is about
 * three pixels -- thin enough to alias away entirely on some frames. And the head was a pale
 * warm white sitting on pavement at 199 luminance, a difference of 31, on an object seven
 * pixels wide.
 *
 * So the post is half again as thick, and the whole lamp is now DARK against the pavement
 * (104 apart) with the warm colour kept for the glass alone, where it is a highlight on a dark
 * shade rather than the whole object. A street lamp reads by its silhouette.
 */
const BASE_R = 0.085;
const BASE_H = 0.05;
const POLE_R = 0.050;
const POLE_H = 1.00;
const ARM_R = 0.035;
const ARM_LEN = 0.18;
/** A truncated cone, wide end down: the shade. `SHADE_R` is the wide end and sets the reach. */
const SHADE_R = 0.115;
const SHADE_R_TOP = 0.050;
const SHADE_H = 0.10;
const GLASS_R = 0.070;

const TREE_SEGMENTS = 8;
const POLE_SIDES = 6;

// The crown and the trunk are in `palette` now, because the lobby's flat tree wears them too --
// see `TREE_CROWN` there for the argument that used to live here.
/**
 * Lamp metalwork: DARK, where this used to take the scene's concrete at 145 luminance. A lamp
 * is a thin object on a pale floor, and thin objects read by contrast alone -- 104 units of it
 * here, against the 54 the concrete gave.
 */
const PROP_POLE = new Color(88, 95, 112);
/**
 * The glass, and the only warm thing in the set. It is small on purpose: a bright dot at the
 * end of a dark arm reads as a lamp, whereas the whole head in this colour read as nothing at
 * all. Not emissive -- the palette's yellow is (251, 200, 32), and a glowing head that bright
 * beside the bay would compete with the seat chips that hang there.
 */
const PROP_LAMP = new Color(255, 232, 150);

/**
 * A planted bed under each tree, and the contact shadows under everything.
 *
 * WITHOUT THESE THE PROPS READ AS STICKERS, which is what they were reported as. Every other
 * object on this board is grounded -- cars carry a contact shadow, the bay and the lot and the
 * track all sit on plinths or drop shadows -- and the props were the only things standing on
 * the pavement with nothing underneath them. A shape with no shadow on a flat pale floor does
 * not look like it is standing there; it looks like it was pasted on afterwards.
 *
 * The bed does the other half. A tree alone in an empty grey expanse has no reason to be at
 * that spot; a tree in a bed is street planting, which is a thing a street has. It is the same
 * move as the lot's dashed border -- a boundary that says this patch is FOR something.
 *
 * THE SHADOWS TAKE `SHADOW_ALPHA`, NOT `CONTACT_ALPHA`, and the difference is the floor. The
 * cars' 112 is set for asphalt at 102 luminance; these fall on pavement at 199, where 112 would
 * separate by 73 and read as a hole. 44 gives 28, which is what every other panel on this board
 * sits on.
 */
const PROP_BED = new Color(152, 174, 146);
const BED_D = 0.62;
const BED_Z = -0.07;
const TREE_SHADOW_D = 0.46;
const LAMP_SHADOW_D = 0.26;
const PROP_SHADOW_Z = -0.05;

/** What to place, and where, in board units. `x` and `y` are the object's FOOT. */
export interface PropSpot {
    kind: 'tree' | 'lamp';
    x: number;
    y: number;
    /** Uniform scale. 1 is the size the constants above describe. */
    scale?: number;
    /** Lamp only: +1 leans the arm to the right, -1 to the left. Ignored by trees. */
    face?: 1 | -1;
}

type Geo = { positions: number[]; normals?: number[]; uvs?: number[]; indices?: number[] };

/** Scale a primitive's positions about its own origin, leaving normals alone (uniform scale). */
function sized(g: Geo, s: number): Geo {
    if (s === 1) return g;
    const positions = new Array<number>(g.positions.length);
    for (let i = 0; i < g.positions.length; i++) positions[i] = g.positions[i] * s;
    return { ...g, positions };
}

/**
 * Build the props under `parent`, as one node per colour.
 *
 * The models are built along +Y with their feet at y = 0, exactly as `pax-figure` builds a
 * passenger, and the holder is then turned a quarter about X so they STAND on the tilted board
 * rather than lie flat on it. Doing the turn on one shared holder rather than per prop is what
 * keeps the merged meshes merged.
 */
export function setupProps(parent: Node, spots: PropSpot[]): void {
    if (spots.length === 0) return;

    const crowns: MeshPart[] = [];
    const trunks: MeshPart[] = [];
    const poles: MeshPart[] = [];
    const heads: MeshPart[] = [];

    for (const spot of spots) {
        const s = spot.scale ?? 1;
        // THE DEPTH IS NEGATED, and leaving it out put the trees on the lot.
        //
        // The holder turns +90 about X so these stand up, which maps model +Y onto board +Z (the
        // height, which is the point) and model +Z onto board -Y (the position, which is not).
        // A prop's board position is baked into the mesh here rather than set on a node, because
        // baking is what lets every prop of one colour share one mesh -- so this function has to
        // undo the holder's turn itself. `pax-figure` never meets this: it turns a per-figure
        // `fit` node and positions the UNROTATED root above it.
        const bx = spot.x;
        const bz = -spot.y;
        if (spot.kind === 'tree') {
            const trunk = sized(primitives.cylinder(TRUNK_R_TOP, TRUNK_R_BOTTOM, TRUNK_H,
                { radialSegments: POLE_SIDES, heightSegments: 1 }), s);
            // `cylinder` centres on its own middle; lift it half its height to stand it up.
            trunks.push(placed(trunk, 0, bx, (TRUNK_H / 2) * s, bz));
            for (const ball of CROWN_BALLS) {
                const geo = sized(primitives.sphere(ball.r, { segments: TREE_SEGMENTS }), s);
                crowns.push(placed(geo, 0, bx + ball.x * s, ball.y * s, bz + ball.z * s));
            }
        } else {
            const face = spot.face ?? 1;
            const base = sized(primitives.cylinder(POLE_R, BASE_R, BASE_H,
                { radialSegments: POLE_SIDES, heightSegments: 1 }), s);
            const pole = sized(primitives.cylinder(POLE_R, POLE_R, POLE_H,
                { radialSegments: POLE_SIDES, heightSegments: 1 }), s);
            const arm = sized(primitives.cylinder(ARM_R, ARM_R, ARM_LEN,
                { radialSegments: POLE_SIDES, heightSegments: 1 }), s);
            const shade = sized(primitives.cylinder(SHADE_R_TOP, SHADE_R, SHADE_H,
                { radialSegments: POLE_SIDES, heightSegments: 1 }), s);
            const glass = sized(primitives.sphere(GLASS_R, { segments: POLE_SIDES }), s);
            const armX = bx + face * (ARM_LEN / 2) * s;
            const headX = bx + face * ARM_LEN * s;
            poles.push(placed(base, 0, bx, (BASE_H / 2) * s, bz));
            poles.push(placed(pole, 0, bx, (POLE_H / 2) * s, bz));
            // The arm is a cylinder laid on its side: rotating it about X puts its length along
            // board Z, which after the holder's turn is across the screen. It hangs at the top.
            poles.push(placed(arm, 90, armX, POLE_H * s, bz));
            poles.push(placed(shade, 0, headX, (POLE_H - SHADE_H / 2) * s, bz));
            // The glass tucks up INSIDE the shade's wide end, so only its lit underside shows.
            heads.push(placed(glass, 0, headX, (POLE_H - SHADE_H - GLASS_R * 0.35) * s, bz));
        }
    }

    // One holder carries the quarter turn for every prop, so each colour stays a single merged
    // mesh. Standing things up on the board is the same trick `buildPaxFigure` uses.
    const holder = new Node('Props');
    holder.setRotationFromEuler(90, 0, 0);
    parent.addChild(holder);

    const group = (name: string, parts: MeshPart[], color: Color): void => {
        if (parts.length === 0) return;
        const n = new Node(name);
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = mergeParts(parts);
        mr.material = litMaterial(color);
        // Same as every other renderer on this board: the shadow map is off and nothing here
        // should be pulled into a shadow pass a future pipeline change might switch back on.
        mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        holder.addChild(n);
    };
    group('prop-trunks', trunks, TREE_TRUNK);
    group('prop-crowns', crowns, TREE_CROWN);
    group('prop-poles', poles, PROP_POLE);
    group('prop-heads', heads, PROP_LAMP);

    // The flat pieces go on `parent`, NOT on the holder: they lie in the board plane already,
    // so they must not be turned upright with the models. That also means their positions are
    // plain board coordinates here -- no negated depth, because there is no rotation to cancel.
    const beds: MeshPart[] = [];
    const shadows: MeshPart[] = [];
    const drop = shadowThrow(LIFT.contact);
    for (const spot of spots) {
        const s = spot.scale ?? 1;
        if (spot.kind === 'tree') {
            const d = BED_D * s;
            beds.push(roundedSlabPart(d, d, 0.02, d / 2, spot.x, spot.y));
        }
        const sd = (spot.kind === 'tree' ? TREE_SHADOW_D : LAMP_SHADOW_D) * s;
        shadows.push(roundedSlabPart(sd, sd, 0.02, sd / 2, spot.x, spot.y + drop * s));
    }
    const flat = (name: string, parts: MeshPart[], z: number, material: Material): void => {
        if (parts.length === 0) return;
        const n = new Node(name);
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = mergeParts(parts);
        mr.material = material;
        mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        n.setPosition(0, 0, z);
        parent.addChild(n);
    };
    if (beds.length > 0) flat('prop-beds', beds, BED_Z, flatMaterial(PROP_BED));
    if (shadows.length > 0) {
        flat('prop-shadows', shadows, PROP_SHADOW_Z, alphaMaterial(
            new Color(SHADOW_INK.r, SHADOW_INK.g, SHADOW_INK.b, SHADOW_ALPHA),
        ));
    }
}

/**
 * THE SIX PROPS, as an offset DOWN from the bay's centre in board units of `scale`, and a size.
 *
 * THIS TABLE IS THE WHOLE OF THE "DON'T LINE THEM UP" FIX, and what it replaces was four props
 * at ONE `y` with ONE size, mirrored exactly across the centreline -- reported, correctly, as
 * looking fake. Scenery reads as scenery when no two pieces agree on anything.
 *
 * THE VERTICAL ROOM IS NOT SHARED EVENLY BETWEEN THE TWO KINDS, and that is why the trees do
 * almost all of the staggering. Measured in units of `scale`, against a bay whose half-height
 * is 1.023:
 *
 *   - A LAMP STANDS 1.15 TALL from its foot (BASE_H + POLE_H + SHADE_H). The single `y` this
 *     replaces was -0.35, and that number was never a design choice about composition: it is
 *     what puts a lamp's head at +0.80, just inside the bay's top edge at +1.023, with the loop
 *     track BAND_GAP above that. A lamp has about 0.2 of headroom and no more, so lamps move
 *     DOWN from -0.35 or not at all.
 *   - A TREE IS 0.74 TALL and so has roughly 0.6 of slack. The trees are what actually break
 *     the line.
 *
 * DOWNWARD, every prop's BED has to stay on the bay band rather than spill onto the ring road
 * below, so the deepest foot allows for its own bed radius (BED_D / 2, scaled): -0.78 with a
 * 0.58 tree leaves 0.06 of margin against the -1.023 edge. That is the tightest row here and
 * the one to check first if these are ever retuned.
 *
 * SIX, NOT FOUR, and the file's own note at the top caps this at "four to six objects, not a
 * streetscape". The two extra are small trees sharing their side's tree lane, which is what
 * turns a pair of specimens into something that reads as running ALONG the road. Their crowns
 * are checked clear of their lane-mates: the left pair sit 0.56 apart with radii summing to
 * 0.45, the right pair 0.60 apart against 0.47.
 */
const PROP_ROWS: readonly {
    kind: 'tree' | 'lamp'; side: -1 | 1; drop: number; size: number;
}[] = [
    { kind: 'lamp', side: -1, drop: 0.35, size: 1.00 },
    { kind: 'tree', side: -1, drop: 0.66, size: 0.86 },
    { kind: 'tree', side: -1, drop: 0.10, size: 0.62 },
    { kind: 'lamp', side: 1, drop: 0.48, size: 0.90 },
    { kind: 'tree', side: 1, drop: 0.18, size: 1.00 },
    { kind: 'tree', side: 1, drop: 0.78, size: 0.58 },
];

/**
 * Where the props go, given the parking bay's box: a LAMP outboard with its arm reaching inward,
 * and TREES inboard of it, on each side, scattered by PROP_ROWS.
 *
 * THE ORDER IS FORCED BY THE ARM. A lamp's head hangs `ARM_LEN + SHADE_R` to one side of its post,
 * and that overhang has to go somewhere that is not a tree and not the bay. Outboard post with
 * the arm reaching in is the only arrangement that works in a strip this narrow: put the lamp
 * inboard and its arm either crosses the tree or hangs over the stalls, where it would sit on
 * top of the seat chips.
 *
 * Returns nothing when the strip cannot hold both, which is not hypothetical -- the gap is the
 * lot's half-width minus the bay's, and a level with more stalls closes it. Dressing that
 * overlaps the bay is worse than no dressing, and this is the only place that can tell. The
 * clearance test is the real one: the tree's outer edge must stay clear of the lamp's head,
 * which is tighter than either object's own footprint.
 *
 * THE GATE IS TESTED AT THE BIGGEST TREE IN THE TABLE, not per tree, so the answer stays
 * all-or-nothing exactly as it was. Letting the small trees through a gap the big one failed
 * would dress the bay with the offcuts of a layout rather than the layout, and half a scattered
 * set is just a stray object.
 *
 * A SMALLER TREE SITS CLOSER TO THE BAY, because its x is built from its OWN crown span rather
 * than the largest. That is a second axis of scatter for free, and it is why the trees in one
 * lane do not line up vertically either.
 */
export function baySideProps(
    bayHalfW: number, bayY: number, lotHalfW: number, scale: number,
): PropSpot[] {
    const pole = POLE_R * scale;
    const reach = (ARM_LEN + SHADE_R) * scale;
    const MARGIN = 0.1 * scale;
    const lampX = lotHalfW - MARGIN - pole;

    // The biggest tree's outer edge against the lamp head's inner reach.
    const biggest = PROP_ROWS.reduce(
        (m, r) => (r.kind === 'tree' && r.size > m ? r.size : m), 0,
    ) * CROWN_SPAN * scale;
    if (bayHalfW + MARGIN + 2 * biggest >= lampX - reach) return [];

    return PROP_ROWS.map((row) => {
        const size = scale * row.size;
        const y = bayY - row.drop * scale;
        if (row.kind === 'lamp') {
            return {
                kind: 'lamp', x: row.side * lampX, y, scale: size,
                face: (row.side === -1 ? 1 : -1) as 1 | -1,
            };
        }
        return {
            kind: 'tree', x: row.side * (bayHalfW + MARGIN + CROWN_SPAN * size), y, scale: size,
        };
    });
}
