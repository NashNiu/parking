import { Color, MeshRenderer, Node, primitives, utils } from 'cc';
import { vertexColorMaterial } from './materials';

/**
 * The underground garage exit, drawn: a VAULT on a D-shaped footprint, with a slot cut through
 * its front and out through its roof for the cars to leave by.
 *
 * WHAT IT IS. A fixed-heading queue of cars lives inside; the head car stands just outside the
 * mouth and is an ordinary car in every other respect. Core still calls it a TUNNEL
 * (`TunnelSpec`, `lot.tunnels`) and that name is not changing -- no player-facing text uses
 * either word, and renaming would churn the level schema and all ten level files for nothing.
 * This file is the only place the two vocabularies meet.
 *
 * WHY AN ARCH CAN ONLY BE DRAWN IN PLAN, which is the whole of this shape's design.
 *
 * The camera is orthographic and the BOARD carries the tilt, so a face's visibility follows
 * from its normal alone, the same for every element on the lot:
 *
 *   n = +Z (roof)          brightest, and visible at EVERY heading.
 *   n = -Y (down-screen)   visible. The only source of apparent height.
 *   n = +-X (sideways)     PROJECTED AREA EXACTLY ZERO. The tilt is about world X, so a
 *                          board-plane +X vector is unmoved by it and its dot with the view
 *                          direction is 0.
 *   n = +Y (up-screen)     hidden behind the thing it belongs to.
 *
 * Headings are FREE, not multiples of 90: the shipped levels use 72, 234, 269 and 291 degrees.
 * So an arch standing on a wall is invisible for about half of them -- level 4's mouth faces
 * the camera, level 7's first tunnel faces directly away. An arch on this board can therefore
 * only be the PLAN SILHOUETTE, which is what this footprint is: flat across the front, a
 * half-round back. The same finding turned the cars from models into drawn geometry (README:
 * of the first car model's nine parts, eight were invisible at this camera), and it is why the
 * reference game draws this element as a flat plate rather than as a tunnel.
 *
 * WHAT EACH PIECE IS FOR:
 *
 *  - The VAULT. Height as a function of distance from the spine, semicircular in profile. Its
 *    normals sweep from vertical at the springing to straight up at the crown, so the engine
 *    lights it as a gradient across the width -- and THAT gradient is the arch, readable from
 *    every heading because it lives on the roof. A flat top face could not carry it.
 *  - The SPRINGING BAND, a short vertical skirt the vault rises from. A vault that met the
 *    board tangentially had no silhouette edge at all and came back as a soft blob (see the
 *    domed hood in the history). This is what gives it a hard outline again.
 *  - The SLOT, cut through the front face AND through the roof, as one cut. The front half
 *    reads when the mouth faces the camera; the roof half is a gap in the always-visible face,
 *    so the two rails flanking it read as piers from any heading. A recess in the top face was
 *    tried and is hidden by its own lip at this camera's 52 degrees of elevation; a dark patch
 *    painted on the top face was tried and read as a sticker. A slot open to both sky and front
 *    is neither.
 *  - The slot's BACK WALL follows the vault profile, so what you see through the mouth is an
 *    arch -- the only place in this model where an arch is drawn as an arch rather than implied.
 *
 * The count that goes on top is drawn by the HUD, not by this mesh (`HudView.setTunnelCount`),
 * so nothing here has to leave room for it.
 *
 * Knows nothing about core: `GameController` passes `len`/`wid` in world units, having taken
 * them from `TUNNEL_BOX` the same way it takes a car's size from `CAP_BOX`.
 */

/**
 * Crown height as a share of the width. TALLER THAN A CAR, which is what buys the depth: a car
 * stands 0.34 world units and this lands near 0.38, so the vault is the tallest thing on the lot.
 * At 0.28 of the width it was two thirds of a car and the reports were "扁" -- a plate.
 *
 * The ceiling on this is occlusion, not taste: height shifts up-screen by h * tan(38deg), so
 * this covers 0.30 of board behind it against a car's own 0.27. One notch more than the things
 * it stands among, which is the most it can take before it starts hiding arrows.
 */
const CROWN = 0.52;

/**
 * The vertical skirt the vault springs from, as a share of the width.
 *
 * Not decoration. A semicircular vault meets the board TANGENTIALLY -- its surface is vertical
 * where it lands, so its silhouette fades out instead of ending, and the whole thing reads as a
 * blister rather than as a building. Lifting the springing line clear of the board gives the
 * outline one hard edge all the way round, at the cost of 0.13 of the height being a plain wall.
 */
const SPRING = 0.13;

/**
 * The doorway: how far back into the block it cuts, as a share of the length, and how wide it
 * opens, as a share of the half-width.
 *
 * The width is bounded on BOTH sides and there is not much room between them:
 *
 *  - Wider than a car, or the mouth car looks wedged in a slot it could not have come through.
 *    A small car is 0.471 board units across against this block's 0.74 -- 0.636 of it, so the
 *    door has to be at least 0.636 of the width and the two rails share what is left.
 *  - Narrow enough to leave rails worth drawing. `MIN_RAIL` is the floor on each one; at 0.68
 *    of the half-width the door clears the car by 0.03 board units and each rail is 0.16 of the
 *    half-width, which at the size this is drawn is about a car's own wall thickness.
 */
const DOOR_LEN = 0.42;
const DOOR_HALF_WID = 0.68;
const MIN_RAIL = 0.14;

/** How much darker the outer wall sits than the roof, and its foot against its top. */
const WALL_SHADE = 0.72;
const FOOT_SHADE = 0.86;

/**
 * Inside the doorway, from the mouth inwards. The floor is graded along its length rather than
 * flat: one colour reads as a painted patch, two ends of a gradient read as somewhere that
 * continues past what can be seen.
 */
const JAMB_SHADE = 0.50;
const FLOOR_NEAR_SHADE = 0.44;
const FLOOR_FAR_SHADE = 0.24;
const BACK_SHADE = 0.28;

/** Lifts the doorway floor clear of the board so the lot's grid does not z-fight through it. */
const FLOOR_LIFT = 0.004;

/** Arc segments around the half-round back, and profile steps from springing to crown. */
const ARC_SEG = 14;
const PROFILE_SEG = 7;

/**
 * The tile's paint, sampled off the reference game's own board. PALER than any car in the
 * palette, on purpose: shape says "not a car" at a glance and colour says it again a moment
 * later. Not in `colors.ts` -- that palette is keyed by core's colour STRINGS, and this element
 * has none.
 */
export const TUNNEL_SHELL = new Color(150, 190, 245);

/**
 * How high this thing's crown stands, given the width it was built at. `GameController` hangs
 * the count chip off it, and asking here is what keeps the two from drifting apart -- the same
 * direction `CAP_BOX` runs, one owner per number.
 */
export function tunnelCrown(wid: number): number {
    return wid * CROWN;
}

function shade(c: Color, f: number): Color {
    return new Color(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f), 255);
}

type Pt = [number, number];

/** Vertex accumulator. Positions, normals and colours per vertex; triangles by index. */
class Shell {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly colors: number[] = [];
    readonly indices: number[] = [];

    vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: Color): number {
        const i = this.positions.length / 3;
        this.positions.push(x, y, z);
        this.normals.push(nx, ny, nz);
        this.colors.push(c.r / 255, c.g / 255, c.b / 255, 1);
        return i;
    }

    /** Two triangles over four indices given in winding order. */
    quad(a: number, b: number, c: number, d: number): void {
        this.indices.push(a, b, c, a, c, d);
    }

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
     * the side facing the viewer always be the side facing the viewer as the block turns.
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

/**
 * One level line of the vault, at plan distance `rho` from the spine.
 *
 * The vault's height depends only on that distance, so its level sets are these: a straight run
 * down each side at y = +-rho, joined round the back by an arc of radius rho. `xFront` is where
 * the run stops -- the front edge for a line outside the doorway, the back of the doorway for
 * one inside it, which is how the slot gets cut without a second surface.
 *
 * Counter-clockwise seen from above (starts on the +Y side, runs back, comes out on -Y), so the
 * quads woven between two consecutive lines face up. `ux`/`uy` is the outward plan direction at
 * each point, which is what turns the profile's slope into a normal.
 *
 * At rho = 0 the arc collapses onto one point and the line degenerates to the spine segment.
 * The quads there collapse with it and draw nothing, which is what we want and why no special
 * case is needed for the crown.
 */
interface RingPt { x: number; y: number; ux: number; uy: number }

function levelLine(rho: number, xFront: number, xc: number): RingPt[] {
    const pts: RingPt[] = [{ x: xFront, y: rho, ux: 0, uy: 1 }];
    for (let s = 0; s <= ARC_SEG; s++) {
        const a = Math.PI / 2 + (s / ARC_SEG) * Math.PI;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        pts.push({ x: xc + ux * rho, y: uy * rho, ux, uy });
    }
    pts.push({ x: xFront, y: -rho, ux: 0, uy: -1 });
    return pts;
}

/**
 * `len` runs along +X, the direction cars leave; `wid` across it; the block rises in +Z. The
 * node's own z-rotation puts it on the heading, and the shape SHOWS that heading -- the flat
 * edge and the doorway both face the way its cars go.
 */
export function buildTunnel(name: string, len: number, wid: number, shell: Color): Node {
    const hl = len / 2;
    const hw = wid / 2;
    const crown = wid * CROWN;
    const spring = wid * SPRING;
    const bow = crown - spring;
    // Centre of the half-round back, and therefore the near end of the spine the vault rises
    // over. On a square footprint this lands on the origin.
    const xc = -hl + hw;
    const doorHalf = Math.min(hw * DOOR_HALF_WID, hw * (1 - MIN_RAIL));
    const xm = hl - len * DOOR_LEN;

    /** The vault's height and normal tilt at a plan distance from the spine. */
    const profile = (rho: number) => {
        const phi = Math.asin(Math.max(0, Math.min(1, rho / hw)));
        return { z: spring + bow * Math.cos(phi), ns: Math.sin(phi) / hw, nz: Math.cos(phi) / bow };
    };

    const p = new Shell();

    // ---- the vault -------------------------------------------------------------------------
    // Level lines from the springing inwards, sampled by ANGLE rather than by distance: the
    // height changes fastest near the springing, and uniform steps in rho would put all the
    // detail at the crown where the surface is flattest.
    //
    // The pair at exactly `doorHalf` is what cuts the slot. Both lines sit at the same height;
    // the outer one still runs out to the front edge and the inner one stops at the back of the
    // doorway, so the quads between them have zero width and draw nothing, leaving a clean seam
    // where the roof ends and the jamb takes over.
    const lines: { rho: number; xFront: number }[] = [];
    let prev = hw;
    for (let s = 0; s <= PROFILE_SEG; s++) {
        const rho = hw * Math.sin((1 - s / PROFILE_SEG) * (Math.PI / 2));
        if (prev > doorHalf && rho < doorHalf) {
            lines.push({ rho: doorHalf, xFront: hl }, { rho: doorHalf, xFront: xm });
        }
        lines.push({ rho, xFront: rho > doorHalf ? hl : xm });
        prev = rho;
    }

    let prevRow: number[] | null = null;
    for (const line of lines) {
        const { z, ns, nz } = profile(line.rho);
        const row = levelLine(line.rho, line.xFront, xc).map((q) => {
            const l = Math.hypot(ns * q.ux, ns * q.uy, nz) || 1;
            return p.vertex(q.x, q.y, z, (ns * q.ux) / l, (ns * q.uy) / l, nz / l, shell);
        });
        if (prevRow) {
            for (let i = 0; i < row.length - 1; i++) {
                p.quad(prevRow[i], prevRow[i + 1], row[i + 1], row[i]);
            }
        }
        prevRow = row;
    }

    // ---- the springing band ----------------------------------------------------------------
    // The footprint as one closed counter-clockwise loop: flat front, half-round back, with the
    // doorway bitten out of the front edge. The bite is traversed the other way round from the
    // rest, which is exactly what makes `outwards` hand the jambs normals pointing INTO the
    // doorway -- so the engine lights them as the inside of an opening rather than as more
    // outer wall.
    const outline: Pt[] = [[hl, hw]];
    for (let s = 0; s <= ARC_SEG; s++) {
        const a = Math.PI / 2 + (s / ARC_SEG) * Math.PI;
        outline.push([xc + Math.cos(a) * hw, Math.sin(a) * hw]);
    }
    outline.push([hl, -hw], [hl, -doorHalf], [xm, -doorHalf], [xm, doorHalf], [hl, doorHalf]);
    p.addWall(outline, 0, spring, shade(shell, WALL_SHADE * FOOT_SHADE), shade(shell, WALL_SHADE));

    // ---- the doorway -----------------------------------------------------------------------
    const doorTop = profile(doorHalf).z;
    const jamb = shade(shell, JAMB_SHADE);
    // Both jambs, from the top of the springing band up to where the roof was cut away. Wound
    // so each faces across the slot at the other.
    const jambWall = (y: number, sign: number) => {
        const n = -sign;
        const a = p.vertex(sign > 0 ? xm : hl, y, spring, 0, n, 0, jamb);
        const b = p.vertex(sign > 0 ? hl : xm, y, spring, 0, n, 0, jamb);
        const c = p.vertex(sign > 0 ? hl : xm, y, doorTop, 0, n, 0, jamb);
        const d = p.vertex(sign > 0 ? xm : hl, y, doorTop, 0, n, 0, jamb);
        p.quad(a, b, c, d);
    };
    jambWall(doorHalf, 1);
    jambWall(-doorHalf, -1);

    // The back of the slot, its top edge following the vault profile -- so what the player sees
    // through the mouth is an arch, and it meets the cut roof exactly, because both are sampled
    // off the same level lines.
    const inner = lines.filter((l) => l.rho <= doorHalf && l.xFront === xm);
    const back = shade(shell, BACK_SHADE);
    // Left jamb to right jamb in one ascending run. `inner` is ordered crown-wards, so its own
    // order mirrors to the -Y half and its reverse gives the +Y half; the spine line (rho 0)
    // belongs to both and is taken once.
    const backSpan: { y: number; z: number }[] = [];
    for (const l of inner) backSpan.push({ y: -l.rho, z: profile(l.rho).z });
    for (let i = inner.length - 1; i >= 0; i--) {
        if (inner[i].rho > 0) backSpan.push({ y: inner[i].rho, z: profile(inner[i].rho).z });
    }
    for (let i = 0; i < backSpan.length - 1; i++) {
        const s0 = backSpan[i];
        const s1 = backSpan[i + 1];
        p.quad(
            p.vertex(xm, s0.y, spring, 1, 0, 0, back),
            p.vertex(xm, s1.y, spring, 1, 0, 0, back),
            p.vertex(xm, s1.y, s1.z, 1, 0, 0, back),
            p.vertex(xm, s0.y, s0.z, 1, 0, 0, back),
        );
    }

    // The front face of each rail, its top edge the same profile: seen head-on these are the
    // two piers the arch springs from, and seen from any other heading they are what keeps the
    // slot from looking like a groove scratched in the roof.
    const outer = lines.filter((l) => l.rho >= doorHalf && l.xFront === hl);
    const face = shade(shell, WALL_SHADE);
    for (let i = 0; i < outer.length - 1; i++) {
        const a0 = profile(outer[i].rho);
        const a1 = profile(outer[i + 1].rho);
        for (const sign of [1, -1]) {
            const y0 = outer[i].rho * sign;
            const y1 = outer[i + 1].rho * sign;
            const q = [
                p.vertex(hl, y0, spring, 1, 0, 0, face),
                p.vertex(hl, y1, spring, 1, 0, 0, face),
                p.vertex(hl, y1, a1.z, 1, 0, 0, face),
                p.vertex(hl, y0, a0.z, 1, 0, 0, face),
            ];
            if (sign > 0) p.quad(q[3], q[2], q[1], q[0]);
            else p.quad(q[0], q[1], q[2], q[3]);
        }
    }

    // The doorway's floor, just clear of the board and graded from mouth to back. Without it the
    // lot's grid shows through the slot and the opening reads as a gap between two rails rather
    // than as somewhere that has an inside.
    const near = shade(shell, FLOOR_NEAR_SHADE);
    const far = shade(shell, FLOOR_FAR_SHADE);
    p.quad(
        p.vertex(hl, -doorHalf, FLOOR_LIFT, 0, 0, 1, near),
        p.vertex(hl, doorHalf, FLOOR_LIFT, 0, 0, 1, near),
        p.vertex(xm, doorHalf, FLOOR_LIFT, 0, 0, 1, far),
        p.vertex(xm, -doorHalf, FLOOR_LIFT, 0, 0, 1, far),
    );

    const geometry: primitives.IGeometry = {
        positions: p.positions,
        normals: p.normals,
        colors: p.colors,
        indices: p.indices,
        minPos: { x: -hl, y: -hw, z: 0 },
        maxPos: { x: hl, y: hw, z: crown },
        boundingRadius: Math.hypot(hl, hw, crown),
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
