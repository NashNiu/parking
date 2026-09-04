import { Color, MeshRenderer, Node, primitives, utils } from 'cc';
import { vertexColorMaterial } from './materials';

/**
 * The underground garage exit, drawn: a soft rounded hood with a domed back, and a dark ramp
 * running out from under it.
 *
 * WHAT IT IS. A fixed-heading queue of cars lives inside; the head car stands just outside the
 * mouth and is an ordinary car in every other respect. Core still calls the whole thing a
 * TUNNEL (`TunnelSpec`, `lot.tunnels`) and that name is not changing -- no player-facing text
 * uses either word, and renaming it would churn the level schema and all ten level files for
 * nothing. This file is the only place the two vocabularies meet.
 *
 * THREE THINGS THIS IS A REWRITE OF, in order of how badly they hurt.
 *
 * IT WAS UNLIT. The first version went through `slabs.makeMerged`, whose `flatMaterial` is the
 * UNLIT material meant for ground dashes and flat panels. It computed per-facet normals and
 * handed them to a material that does not read normals, so the whole thing drew as one uniform
 * silhouette. `car-builder` does not work that way -- it uses `vertexColorMaterial` (lit
 * `builtin-standard` with USE_VERTEX_COLOR), where normals shade and the vertex colour tints.
 * That is how a solid is drawn in this project, and it is what this uses.
 *
 * ITS OPENING FACED SIDEWAYS. The mouth was a disc facing local +X. For a heading along the
 * board's +X that is EXACTLY edge-on: the camera looks down world -Z, the board tilts about
 * world X, so a board-plane +X vector is untouched by the tilt and its dot with the view
 * direction is zero. Level 8 ships two horizontally-aimed tunnels and neither showed any
 * opening at all. Everything in this game is read from ABOVE -- a car by its roof and arrow --
 * so what says "you can drive out of this" has to be readable from above too. Here that is the
 * RAMP: a dark ground-plane wedge running out from under the hood, face-on to the camera at
 * every heading, plus the bore you see into under the hood's front lip.
 *
 * IT WAS ALL HARD EDGES. Reported as "太丑了" against a reference whose tunnel is a soft,
 * inflated, rounded form. So the hood's back is a DOME rather than a flat wall, the crown is
 * lifted toward white, and nothing on it is a sharp box corner.
 *
 * Knows nothing about core: `GameController` passes `len`/`wid` in world units, having taken
 * them from `TUNNEL_BOX` the same way it takes a car's size from `CAP_BOX`.
 */

/**
 * Segments around the arch, and rings along the dome. 16 around: with real lighting the facets
 * are visible as facets, and a coarse bore reads as a polygon rather than a tube. 5 along the
 * dome is enough for its silhouette, which is only a quarter turn.
 */
const ARCH_SEG = 16;
const DOME_SEG = 5;

/** Arch height as a share of the width. Under a half circle, so the hood sits squat. */
const RISE = 0.62;

/**
 * How much of the footprint the hood covers, and how much of the hood is its domed back. The
 * rest of the footprint is open ramp -- the part that has to stay legible from above, so the
 * hood deliberately does not reach the mouth.
 */
const HOOD_SHARE = 0.54;
const DOME_SHARE = 0.34;

/** Wall thickness of the hood, as a share of the smaller arch radius. */
const WALL = 0.2;

/** Kerb height along the ramp, in shares of the arch height. Low: it only has to say "solid". */
const KERB = 0.26;

/**
 * The colours, read off the reference art: a periwinkle hood lifting to near-white along the
 * crown, and a near-black bore.
 *
 * Declared here rather than in `colors.ts` on purpose -- that file is the palette keyed by
 * core's colour STRINGS, and this element has no colour in core.
 */
export const TUNNEL_SHELL = new Color(138, 172, 240);
export const TUNNEL_MOUTH = new Color(26, 34, 62);

/** Crown lift, and how much darker the flanks sit than the body. */
const CROWN_LIFT = 0.42;
const FLANK_SHADE = 0.82;

function lighten(c: Color, t: number): Color {
    return new Color(
        Math.round(c.r + (255 - c.r) * t),
        Math.round(c.g + (255 - c.g) * t),
        Math.round(c.b + (255 - c.b) * t),
        255,
    );
}

function shade(c: Color, f: number): Color {
    return new Color(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f), 255);
}

/** Vertex accumulator. Positions, normals and colours -- no uvs; nothing here samples a map. */
class Hull {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly colors: number[] = [];
    readonly indices: number[] = [];

    vertex(p: readonly [number, number, number], n: readonly [number, number, number], c: Color): number {
        const i = this.positions.length / 3;
        this.positions.push(p[0], p[1], p[2]);
        this.normals.push(n[0], n[1], n[2]);
        this.colors.push(c.r / 255, c.g / 255, c.b / 255, 1);
        return i;
    }

    tri(a: number, b: number, c: number): void {
        this.indices.push(a, b, c);
    }

    /** Two triangles over four already-added corners, in the order given. */
    quad(a: number, b: number, c: number, d: number): void {
        this.indices.push(a, b, c, a, c, d);
    }
}

/** One point of the arch cross-section, in the local (y, z) plane, with its outward normal. */
interface Rib { y: number; z: number; ny: number; nz: number }

/**
 * The arch, from the right rim over the crown to the left rim, at radii (`hw`, `h`).
 *
 * The normal comes from the ellipse's own gradient, not from the facet, so the shading sweeps
 * smoothly round the hood instead of stepping. Each component is scaled by the OTHER radius,
 * which is what makes it the true ellipse normal rather than a circle's -- a squat arch lit as
 * if it were round reads as a half pipe with a flat top.
 */
function ribs(hw: number, h: number): Rib[] {
    const out: Rib[] = [];
    for (let i = 0; i <= ARCH_SEG; i++) {
        const th = (i / ARCH_SEG) * Math.PI;
        const cy = Math.cos(th);
        const sz = Math.sin(th);
        const ny = cy * h;
        const nz = sz * hw;
        const nl = Math.hypot(ny, nz) || 1;
        out.push({ y: cy * hw, z: sz * h, ny: ny / nl, nz: nz / nl });
    }
    return out;
}

/** The hood's paint at a given height fraction: lifted along the crown, darker down the flanks. */
function hoodPaint(shell: Color, up: number): Color {
    return lighten(shade(shell, FLANK_SHADE + (1 - FLANK_SHADE) * up), CROWN_LIFT * up * up);
}

/**
 * `len` runs along +X, the direction cars leave; `wid` across it; the hood rises in +Z. The
 * node's own z-rotation puts it on the heading, exactly as a car's does.
 */
export function buildTunnel(
    name: string, len: number, wid: number, shell: Color, mouth: Color,
): Node {
    const hl = len / 2;
    const hw = wid / 2;
    const h = wid * RISE;
    const wall = Math.min(hw, h) * WALL;

    const outer = ribs(hw, h);
    const inner = ribs(hw - wall, h - wall);

    // The hood runs from the back of the footprint to `lip`; the ramp runs from there to the
    // mouth. The dome is the back slice of the hood.
    const hood = len * HOOD_SHARE;
    const lip = -hl + hood;
    const domeEnd = -hl + hood * DOME_SHARE;

    const g = new Hull();

    // THE DOMED BACK. A quarter ellipsoid: the arch cross-section scaled from a point at the
    // very back out to full size at `domeEnd`, along a quarter circle so the silhouette rounds
    // over instead of meeting the ground at a corner. This is the single biggest difference
    // from the boxy version the reference art was held up against.
    for (let s = 0; s < DOME_SEG; s++) {
        const u0 = s / DOME_SEG;
        const u1 = (s + 1) / DOME_SEG;
        const k0 = Math.sin(u0 * Math.PI / 2);
        const k1 = Math.sin(u1 * Math.PI / 2);
        // Along-axis component of the normal, so the dome is lit as a dome and not as a ring of
        // vertical walls: it swings from -X at the tip to 0 where the dome meets the tube.
        const nx0 = -Math.cos(u0 * Math.PI / 2);
        const nx1 = -Math.cos(u1 * Math.PI / 2);
        const x0 = -hl + hood * DOME_SHARE * u0;
        const x1 = -hl + hood * DOME_SHARE * u1;
        for (let i = 0; i < ARCH_SEG; i++) {
            const r0 = outer[i];
            const r1 = outer[i + 1];
            const c0 = hoodPaint(shell, r0.z / h);
            const c1 = hoodPaint(shell, r1.z / h);
            const a = g.vertex([x1, r0.y * k1, r0.z * k1], [nx1, r0.ny, r0.nz], c0);
            const b = g.vertex([x0, r0.y * k0, r0.z * k0], [nx0, r0.ny, r0.nz], c0);
            const c = g.vertex([x0, r1.y * k0, r1.z * k0], [nx0, r1.ny, r1.nz], c1);
            const d = g.vertex([x1, r1.y * k1, r1.z * k1], [nx1, r1.ny, r1.nz], c1);
            g.quad(a, b, c, d);
        }
    }

    // THE HOOD'S BARREL, from the dome out to the lip. Wound (front-rib0, back-rib0, back-rib1,
    // front-rib1): the order whose (b-a)x(c-a) runs PARALLEL to the outward normal. The other
    // obvious order faces every triangle inward and backface-culls the whole solid away, which
    // is silent when it happens -- an inside-out solid simply is not there.
    for (let i = 0; i < ARCH_SEG; i++) {
        const r0 = outer[i];
        const r1 = outer[i + 1];
        const c0 = hoodPaint(shell, r0.z / h);
        const c1 = hoodPaint(shell, r1.z / h);
        const a = g.vertex([lip, r0.y, r0.z], [0, r0.ny, r0.nz], c0);
        const b = g.vertex([domeEnd, r0.y, r0.z], [0, r0.ny, r0.nz], c0);
        const c = g.vertex([domeEnd, r1.y, r1.z], [0, r1.ny, r1.nz], c1);
        const d = g.vertex([lip, r1.y, r1.z], [0, r1.ny, r1.nz], c1);
        g.quad(a, b, c, d);
    }

    // THE BORE under the hood, inset by the wall, wound the other way and normalled inward: the
    // dark you see through the lip. The eye reaches `h / tan(52°)` in past the lip, about a
    // third of the hood, which is what makes the opening read as a hole rather than as paint.
    for (let i = 0; i < ARCH_SEG; i++) {
        const r0 = inner[i];
        const r1 = inner[i + 1];
        const a = g.vertex([lip, r0.y, r0.z], [0, -r0.ny, -r0.nz], mouth);
        const b = g.vertex([lip, r1.y, r1.z], [0, -r1.ny, -r1.nz], mouth);
        const c = g.vertex([-hl, r1.y, r1.z], [0, -r1.ny, -r1.nz], mouth);
        const d = g.vertex([-hl, r0.y, r0.z], [0, -r0.ny, -r0.nz], mouth);
        g.quad(a, b, c, d);
    }

    // THE LIP: the annulus between the two skins at the hood's open end, painted brightest on
    // the whole piece so the opening has a rim to read against the dark behind it.
    const lipPaint = lighten(shell, 0.55);
    for (let i = 0; i < ARCH_SEG; i++) {
        const o0 = outer[i];
        const o1 = outer[i + 1];
        const i0 = inner[i];
        const i1 = inner[i + 1];
        const a = g.vertex([lip, o0.y, o0.z], [1, 0, 0], lipPaint);
        const b = g.vertex([lip, o1.y, o1.z], [1, 0, 0], lipPaint);
        const c = g.vertex([lip, i1.y, i1.z], [1, 0, 0], lipPaint);
        const d = g.vertex([lip, i0.y, i0.z], [1, 0, 0], lipPaint);
        g.quad(a, b, c, d);
    }

    // THE RAMP: a dark wedge on the board from under the lip out to the mouth, narrowing and
    // darkening backwards so it reads as running DOWN under the hood. This is the piece that is
    // face-on to the camera at every heading, and the reason the element is legible at all on a
    // horizontal tunnel -- see the note at the top.
    //
    // Drawn a hair above the board rather than cut into it: the ground is an opaque solid panel
    // and there is no hole to make. The kerbs either side carry the actual depth cue.
    const RAMP_Z = 0.004;
    const rampBackHalf = (hw - wall) * 0.82;
    const deep = shade(mouth, 0.55);
    const rBackR = g.vertex([lip, rampBackHalf, RAMP_Z], [0, 0, 1], deep);
    const rBackL = g.vertex([lip, -rampBackHalf, RAMP_Z], [0, 0, 1], deep);
    const rFrontL = g.vertex([hl, -hw + wall * 0.5, RAMP_Z], [0, 0, 1], mouth);
    const rFrontR = g.vertex([hl, hw - wall * 0.5, RAMP_Z], [0, 0, 1], mouth);
    g.quad(rBackR, rBackL, rFrontL, rFrontR);

    // THE KERBS: a low rounded wall down each side of the ramp. They are what says "solid, not
    // a painted marking" -- a flat graphic on this board reads as drivable ground, and this is a
    // hard obstacle, so the mistake would cost a tap.
    const kerbH = h * KERB;
    const kerbTop = lighten(shell, 0.3);
    const kerbSide = shade(shell, 0.72);
    for (const side of [1, -1]) {
        const yOut = side * hw;
        const yIn = side * (hw - wall);
        // Outer face, standing up from the board.
        const a = g.vertex([lip, yOut, 0], [0, side, 0], kerbSide);
        const b = g.vertex([hl, yOut, 0], [0, side, 0], kerbSide);
        const c = g.vertex([hl, yOut, kerbH], [0, side, 0], kerbTop);
        const d = g.vertex([lip, yOut, kerbH], [0, side, 0], kerbTop);
        if (side > 0) g.quad(a, b, c, d); else g.quad(d, c, b, a);
        // Top face.
        const e = g.vertex([lip, yOut, kerbH], [0, 0, 1], kerbTop);
        const f = g.vertex([hl, yOut, kerbH], [0, 0, 1], kerbTop);
        const gg = g.vertex([hl, yIn, kerbH], [0, 0, 1], kerbTop);
        const hh = g.vertex([lip, yIn, kerbH], [0, 0, 1], kerbTop);
        if (side > 0) g.quad(e, f, gg, hh); else g.quad(hh, gg, f, e);
    }

    const geometry: primitives.IGeometry = {
        positions: g.positions,
        normals: g.normals,
        colors: g.colors,
        indices: g.indices,
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
