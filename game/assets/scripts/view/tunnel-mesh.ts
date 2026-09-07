import { Color, MeshRenderer, Node, primitives, utils } from 'cc';
import { vertexColorMaterial } from './materials';

/**
 * The underground garage exit, drawn: a low SQUARE tile in pale blue. That is the whole model.
 *
 * WHAT IT IS. A fixed-heading queue of cars lives inside; the head car stands just outside the
 * mouth and is an ordinary car in every other respect. Core still calls it a TUNNEL
 * (`TunnelSpec`, `lot.tunnels`) and that name is not changing -- no player-facing text uses
 * either word, and renaming would churn the level schema and all ten level files for nothing.
 * This file is the only place the two vocabularies meet.
 *
 * WHY IT IS A BARE TILE, after three goes at making it look like a tunnel.
 *
 * An arch, then a domed hood, then a plate with a dark opening and a white arrow -- all three
 * came back as "看不出来". The reason they failed is not that they were not detailed enough. It
 * is that the reference game DOES NOT DRAW A TUNNEL ON ITS BOARD EITHER: the chunky 3D tunnel
 * everyone was picturing lives in its tutorial popup, an illustration drawn at three-quarters.
 * On its actual board the element is a pale rounded square with a big number on it, and
 * measured against a small car in the same screenshot it is 0.73 x 0.71 board units -- SQUARE,
 * and SHORTER than a small car.
 *
 * That is also what this camera has been saying all along. It is orthographic and square onto
 * the board, so an object here IS its plan view -- the same finding that turned the cars from
 * models into drawn geometry (README: of the first car model's nine parts, eight were invisible
 * at this camera; of the second's, the windscreen, rear window and all four hubs were each 0%).
 * Every earlier attempt spent its effort on form the camera cannot see, on a body shaped like
 * the sixty other rounded boxes it had to be told apart from.
 *
 * So the read is carried by SHAPE and COLOUR, not by modelling: nothing else on this board is
 * square, and nothing else is this pale. An opening and an arrow were both tried on the tile's
 * face and both made it worse -- they are the cars' own vocabulary, and wearing it is what made
 * it look like a car with a sticker on it.
 *
 * Knows nothing about core: `GameController` passes `len`/`wid` in world units, having taken
 * them from `TUNNEL_BOX` the same way it takes a car's size from `CAP_BOX`.
 */

/**
 * Height as a share of the width. TALLER THAN A CAR, which is what buys the depth: a car stands
 * 0.34 world units and this lands near 0.40, so the block's side walls are the tallest thing on
 * the lot and read as walls rather than as a bevel on a sticker. At 0.28 it was two thirds of a
 * car and the reports were "扁" -- a plate, not a building.
 *
 * The ceiling on this is occlusion, not taste: height shifts up-screen by h * tan(38deg), so
 * 0.40 covers 0.31 of board behind it, against a car's own 0.27. One notch more than the things
 * it stands among, which is the most it can take before it starts hiding arrows.
 *
 * The number that goes on top is drawn by the HUD, not by this mesh (`HudView.setTunnelCount`),
 * so nothing here has to leave room for it.
 */
const RISE = 0.52;

/**
 * Corner rounding, as a share of the shorter side.
 *
 * 0.14, down from 0.34, and the doorway is why. On a SQUARE block 0.34 of the side is 0.68 of
 * the half-width, which leaves each edge's straight run only 0.24 long -- narrower than the
 * doorway has to be, so the bite would have eaten into both front corners and the outline would
 * have crossed itself. `doorHalfWidth` clamps against exactly that; this keeps the clamp from
 * ever having to bite.
 */
const CORNER = 0.14;

/** Arc segments per rounded corner. Four is plenty at the size this is drawn. */
const CORNER_SEG = 4;

/** How much darker the side wall sits than the top face. */
const WALL_SHADE = 0.72;

/**
 * The doorway, as shares of the block's own length and half-width.
 *
 * It is cut RIGHT THROUGH to the board, not recessed into the top face -- a recess would be
 * hidden by its own lip at this camera's 52-degree elevation, and a dark patch painted on the
 * top face was tried and read as a sticker. A slot open to the ground has its two jambs lit as
 * real walls, and the mouth car stands one CLEARANCE outside it, so the car genuinely reads as
 * having come out of the hole rather than as parked next to a decorated box.
 *
 * It opens on +X, the heading cars leave along, so it also says which way this thing faces --
 * which the square tile on its own could not.
 */
const DOOR_LEN = 0.46;
const DOOR_HALF_WID = 0.66;

/** How dark the floor of the doorway sits against the block's own paint. */
const DOOR_FLOOR_SHADE = 0.34;

/** Lifts the doorway floor clear of the board so the lot's grid does not z-fight through it. */
const FLOOR_LIFT = 0.004;

/**
 * The doorway's half-width, in world units, given the block's own half-width and corner radius.
 *
 * Two things bound it and they pull opposite ways, so it is worked out rather than authored:
 *
 *  - It must be WIDER THAN A CAR, or the mouth car looks wedged in a slot it could not have come
 *    through. A small car is 0.471 board units across against this block's 0.74, so the car
 *    takes 0.636 of the block's width -- most of it.
 *  - It must be NARROWER THAN THE FRONT EDGE'S STRAIGHT RUN (`hw - r`), or the bite reaches into
 *    the rounded corners and the outline crosses itself. That failure is silent: the mesh still
 *    builds, and the jambs come out inside-out.
 *
 * The clamp is what makes the second one impossible to trip by tuning CORNER or DOOR_HALF_WID,
 * and `MIN_JAMB` keeps a sliver of straight edge outside it so the corner arc still has
 * somewhere to sit.
 */
const MIN_JAMB = 0.02;

function doorHalfWidth(hw: number, r: number): number {
    return Math.min(hw * DOOR_HALF_WID, Math.max(0, hw - r - hw * MIN_JAMB));
}

/**
 * The tile's paint, sampled off the reference game's own board. PALER than any car in the
 * palette, on purpose: shape says "not a car" at a glance and colour says it again a moment
 * later. Not in `colors.ts` -- that palette is keyed by core's colour STRINGS, and this element
 * has none.
 */
export const TUNNEL_SHELL = new Color(150, 190, 245);

function shade(c: Color, f: number): Color {
    return new Color(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f), 255);
}

type Pt = [number, number];

/** Vertex accumulator: flat convex polygons, plus one extruded band for the plate's wall. */
class Plate {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly colors: number[] = [];
    readonly indices: number[] = [];

    private ring(pts: readonly Pt[], z: number, c: Color, out: readonly Pt[] | null): number {
        const base = this.positions.length / 3;
        for (let i = 0; i < pts.length; i++) {
            this.positions.push(pts[i][0], pts[i][1], z);
            if (out) this.normals.push(out[i][0], out[i][1], 0);
            else this.normals.push(0, 0, 1);
            this.colors.push(c.r / 255, c.g / 255, c.b / 255, 1);
        }
        return base;
    }

    /** One convex polygon at height `z`, fanned from its first point, facing straight up. */
    addFlat(pts: readonly Pt[], z: number, c: Color): void {
        const base = this.ring(pts, z, c, null);
        for (let i = 1; i < pts.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
    }

    /**
     * The wall between the same outline at two heights, normals lying flat and pointing
     * outward -- which is what lets the engine light the four sides differently, and what makes
     * the side facing the viewer always be the side facing the viewer as the plate turns.
     */
    addWall(pts: readonly Pt[], zLow: number, zHigh: number, low: Color, high: Color): void {
        const out = outwards(pts);
        const a = this.ring(pts, zLow, low, out);
        const b = this.ring(pts, zHigh, high, out);
        const n = pts.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            this.indices.push(a + i, a + j, b + i);
            this.indices.push(a + j, b + j, b + i);
        }
    }
}

/** Outward unit normal at each point of a counter-clockwise outline, from its two edges. */
function outwards(pts: readonly Pt[]): Pt[] {
    const n = pts.length;
    return pts.map((_, i) => {
        const p = pts[(i - 1 + n) % n];
        const q = pts[(i + 1) % n];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const l = Math.hypot(dx, dy) || 1;
        return [dy / l, -dx / l] as Pt;
    });
}

/** One rounded corner's arc, centred on (`ox`,`oy`), swept a quarter turn from `a0`. */
function corner(ox: number, oy: number, a0: number, r: number): Pt[] {
    const pts: Pt[] = [];
    for (let s = 0; s <= CORNER_SEG; s++) {
        const a = a0 + (s / CORNER_SEG) * (Math.PI / 2);
        pts.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r]);
    }
    return pts;
}

/**
 * The block's outline: a rounded rectangle with a rectangular DOORWAY bitten out of its +X
 * edge, as one closed counter-clockwise loop.
 *
 * One loop, not an outline plus a hole, because that is what lets `addWall` raise the jambs and
 * the outer walls in a single band. The bite is traversed the other way round from the rest,
 * which is exactly what makes `outwards` hand the jambs normals pointing INTO the doorway --
 * so the engine lights them as the inside of an opening rather than as more outer wall. Nothing
 * here needs the loop to be convex; only the top-face pieces do, and those are cut separately.
 */
function notchedOutline(len: number, wid: number, r: number, doorLen: number, doorHalf: number): Pt[] {
    const hl = len / 2;
    const hw = wid / 2;
    const xm = hl - doorLen;
    return [
        // bottom edge, left to right, then round up the front-right corner
        [xm, -hw],
        ...corner(hl - r, -hw + r, -Math.PI / 2, r),
        // into the doorway: in along its right jamb, across its back, out along its left jamb
        [hl, -doorHalf],
        [xm, -doorHalf],
        [xm, doorHalf],
        [hl, doorHalf],
        // front-left corner, top edge right to left, then the two back corners
        ...corner(hl - r, hw - r, 0, r),
        [xm, hw],
        ...corner(-hl + r, hw - r, Math.PI / 2, r),
        ...corner(-hl + r, -hw + r, Math.PI, r),
    ];
}

/**
 * `len` runs along +X, the direction cars leave; `wid` across it; the block rises in +Z. The
 * node's own z-rotation puts it on the heading, and unlike the plain tile this shape SHOWS that
 * heading -- the doorway faces the way its cars go.
 */
export function buildTunnel(name: string, len: number, wid: number, shell: Color): Node {
    const h = wid * RISE;
    const hl = len / 2;
    const hw = wid / 2;
    const r = Math.min(len, wid) * CORNER;
    const doorLen = len * DOOR_LEN;
    const doorHalf = doorHalfWidth(hw, r);
    const xm = hl - doorLen;

    const p = new Plate();

    // The walls: outer faces and both jambs of the doorway in one band, graded darker at the
    // foot the way a car's side wall is. Normals lie flat and point outward (out of the material,
    // hence INTO the doorway on the jambs), which is what lets the engine light each face
    // differently and what makes the lit side turn with the block.
    const outline = notchedOutline(len, wid, r, doorLen, doorHalf);
    p.addWall(outline, 0, h, shade(shell, WALL_SHADE * 0.86), shade(shell, WALL_SHADE));

    // The roof, in three convex pieces around the doorway: the slab behind it and a rail down
    // each side of it. Three pieces rather than one, because a roof with a bite out of it is
    // concave and `addFlat` fans from its first point -- a fan of a concave outline folds over
    // itself. Same reason `car-mesh` splits its arrow.
    const back: Pt[] = [
        [xm, -hw],
        [xm, hw],
        ...corner(-hl + r, hw - r, Math.PI / 2, r),
        ...corner(-hl + r, -hw + r, Math.PI, r),
    ];
    const rail = (lo: number, hi: number): Pt[] => [
        [xm, lo], [hl, lo], [hl, hi], [xm, hi],
    ];
    p.addFlat(back, h, shell);
    p.addFlat(rail(-hw, -doorHalf), h, shell);
    p.addFlat(rail(doorHalf, hw), h, shell);

    // The doorway's floor, just clear of the board: without it the lot's grid shows through the
    // slot and the opening reads as a gap between two rails rather than as somewhere that has an
    // inside.
    p.addFlat(
        [[xm, -doorHalf], [hl, -doorHalf], [hl, doorHalf], [xm, doorHalf]],
        FLOOR_LIFT,
        shade(shell, DOOR_FLOOR_SHADE),
    );

    const geometry: primitives.IGeometry = {
        positions: p.positions,
        normals: p.normals,
        colors: p.colors,
        indices: p.indices,
        minPos: { x: -hl, y: -hw, z: 0 },
        maxPos: { x: hl, y: hw, z: h },
        boundingRadius: Math.hypot(hl, hw, h),
    };

    const node = new Node(name);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(geometry);
    // WHITE, because the vertex colours ARE the paint: `vertexColorMaterial` sets `mainColor`
    // to white and multiplies, so passing the shell colour again would square it.
    mr.material = vertexColorMaterial(Color.WHITE);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    return node;
}
