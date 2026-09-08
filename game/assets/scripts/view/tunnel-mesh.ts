import { Color, MeshRenderer, Node, primitives, utils } from 'cc';
import { vertexColorMaterial } from './materials';

/**
 * The underground garage exit, drawn: a solid VAULT on a D-shaped footprint. No opening, no
 * dark interior -- the arch itself is the whole element.
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
 *  - The FRONT FACE, the vault's cross-section: an arch, and the one place in this model where
 *    an arch is drawn as an arch rather than implied. It is not decoration but closure -- the
 *    vault's level lines stop at the front edge, and without this the shell would be open from
 *    the springing line up to the crown.
 *
 * THE DOORWAY IS GONE, and with it every dark surface this file used to have. It was a slot cut
 * through the front and out through the roof, floored with a shade gradient and backed by a
 * dark wall, and the report on it was that the dark patch looked wrong -- the element reads as
 * a piece of architecture, and a black rectangle in the middle of it reads as a hole in the
 * render. So the arch is now unbroken and everything that is not the roof carries ONE pale
 * shade (RIM_SHADE). At this camera that pale band is only ever visible on the down-screen
 * side, so what it draws is a single semicircular shadow under the rim, whatever the heading.
 *
 * What the slot was FOR was showing where the cars come out, and that read is not lost with
 * it: the mouth car stands one clearance off the front face (core's `mouthCar`), against the
 * flat edge of a shape whose whole silhouette points the way its cars go.
 *
 * The count that goes on top is drawn by the HUD, not by this mesh (`HudView.setTunnelCount`),
 * so nothing here has to leave room for it.
 *
 * Knows nothing about core: `GameController` passes `len`/`wid` in world units, having taken
 * them from `TUNNEL_BOX` the same way it takes a car's size from `CAP_BOX`.
 */

/**
 * Crown height as a share of the width. TALLER THAN A CAR, which is what buys the depth: a car
 * stands 0.34 world units and this lands near 0.44, so the vault is comfortably the tallest
 * thing on the lot. At 0.28 of the width it was two thirds of a car and the reports were
 * "扁" -- a plate.
 *
 * 0.60, up from 0.52, asked for as "a bit taller, and read as more solid".
 *
 * AND IT IS PAST THE LIMIT THE PREVIOUS REVISION SET ITSELF, deliberately, so the number is
 * worth writing down rather than quietly moving. The ceiling on this is occlusion, not taste:
 * height shifts the silhouette up-screen by h * tan(38deg), so this covers 0.35 board units of
 * board behind it where 0.52 covered 0.30 and a car covers 0.27. The old comment called 0.30
 * "the most it can take before it starts hiding arrows"; this is 0.05 board units past that,
 * which is a sixteenth of a small car's length. What makes it affordable is where the risk
 * lands: a tunnel carries a reservation a whole car length deep along its own axis
 * (`tunnelReservation`), so there is nothing immediately behind it to hide unless the heading
 * happens to point the up-screen direction across that axis. If an arrow does go missing
 * behind one of these, this constant is the first thing to look at.
 */
const CROWN = 0.60;

/**
 * The vertical skirt the vault springs from, as a share of the width.
 *
 * Not decoration. A semicircular vault meets the board TANGENTIALLY -- its surface is vertical
 * where it lands, so its silhouette fades out instead of ending, and the whole thing reads as a
 * blister rather than as a building. Lifting the springing line clear of the board gives the
 * outline one hard edge all the way round, at the cost of that share of the height being a
 * plain wall.
 *
 * 0.18, up from 0.13, and this is the OTHER half of "read as more solid" -- the half that is
 * free. The skirt is the only surface RIM_SHADE is ever seen on, so its height is the width of
 * the pale band under the rim, and widening that band by 39% costs no occlusion at all: the
 * total height is CROWN's to set, and raising SPRING inside it only trades vault curvature for
 * wall. The trade has a floor -- take too much and the arch's lighting gradient, which is the
 * whole read of the arch from most headings, flattens out. At 0.18 of 0.60 the bow still owns
 * 70% of the height.
 */
const SPRING = 0.18;

/**
 * The one shade anything that is not the roof is painted in -- the springing band and the
 * front face alike.
 *
 * ONE value, deliberately. This file used to carry five (an outer wall at 0.72 and its foot at
 * 0.86 of that, jambs at 0.50, a floor graded 0.44 to 0.24, a back wall at 0.28) and four of
 * them existed to make the inside of a doorway read as an inside. With the doorway gone the
 * only job left is to separate the vertical surfaces from the roof they rise to, and a second
 * value would just be a second band for the eye to wonder about.
 *
 * 0.84, which is PALE -- a step of 16%, against the 28% the old outer wall took and the 72%
 * the old back wall took. That is the whole of "keep only one light shadow": at this camera
 * the +-X faces have no projected area and the +Y side is hidden, so the only part of this
 * band ever on screen is the down-screen arc of it, and what that draws is one soft
 * semicircular shadow tucked under the rim.
 */
const RIM_SHADE = 0.84;

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
 * the runs stop, which is the front edge for every line -- it stays a parameter rather than
 * being read off `hl` here because it is what the doorway used to vary to cut its slot, and a
 * future opening would vary it again.
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
    // Every line now runs the full way out to the front edge. They used to split around the
    // doorway -- an outer set reaching the front and an inner set stopping at the back of the
    // slot, with a zero-width seam between them where the roof was cut -- and removing the
    // doorway is exactly this list becoming uniform.
    const rhos: number[] = [];
    for (let s = 0; s <= PROFILE_SEG; s++) {
        rhos.push(hw * Math.sin((1 - s / PROFILE_SEG) * (Math.PI / 2)));
    }

    let prevRow: number[] | null = null;
    for (const rho of rhos) {
        const { z, ns, nz } = profile(rho);
        const row = levelLine(rho, hl, xc).map((q) => {
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

    const rim = shade(shell, RIM_SHADE);

    // ---- the springing band ----------------------------------------------------------------
    // The footprint as one closed counter-clockwise loop: flat front, half-round back. The
    // doorway used to be bitten out of the front edge here, which is what gave `outwards` a
    // stretch of inward-facing normals to light as the inside of an opening; with the bite gone
    // every normal points out and the band is the plain skirt it looks like.
    //
    // Both ends of the wall take the same colour. A gradient down the skirt was tried while it
    // was dark and read as a second, lower band; at RIM_SHADE the whole thing is one step off
    // the roof and gradients inside it are invisible.
    const outline: Pt[] = [[hl, hw]];
    for (let s = 0; s <= ARC_SEG; s++) {
        const a = Math.PI / 2 + (s / ARC_SEG) * Math.PI;
        outline.push([xc + Math.cos(a) * hw, Math.sin(a) * hw]);
    }
    outline.push([hl, -hw]);
    p.addWall(outline, 0, spring, rim, rim);

    // ---- the front face --------------------------------------------------------------------
    // The vault's cross-section, closing the shell from the springing line up to the profile.
    // This is the arch drawn AS an arch -- and it is structural, not decorative: the level
    // lines above stop at x = hl, so without this the roof would end in mid-air and the model
    // would be see-through from the front.
    //
    // Sampled off the same `rhos` the vault is, mirrored to both sides, so its top edge meets
    // the roof's front edge vertex for vertex and no seam can open between them. It runs
    // ascending in y (-hw through 0 to +hw), which is the winding that leaves the +X normal
    // facing out.
    const span: { y: number; z: number }[] = [];
    for (const rho of rhos) span.push({ y: -rho, z: profile(rho).z });
    for (let i = rhos.length - 1; i >= 0; i--) {
        if (rhos[i] > 0) span.push({ y: rhos[i], z: profile(rhos[i]).z });
    }
    for (let i = 0; i < span.length - 1; i++) {
        const s0 = span[i];
        const s1 = span[i + 1];
        p.quad(
            p.vertex(hl, s0.y, spring, 1, 0, 0, rim),
            p.vertex(hl, s1.y, spring, 1, 0, 0, rim),
            p.vertex(hl, s1.y, s1.z, 1, 0, 0, rim),
            p.vertex(hl, s0.y, s0.z, 1, 0, 0, rim),
        );
    }

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
