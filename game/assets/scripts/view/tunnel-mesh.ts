import { Color, MeshRenderer, Node, primitives, utils } from 'cc';
import { vertexColorMaterial } from './materials';

/**
 * The tunnel, drawn: a shaded half-tube you can see INTO from the game's viewing angle.
 *
 * TWO THINGS THIS IS A REWRITE OF, both reported as "完全看不出来是隧道".
 *
 * IT WAS UNLIT. The first version went through `slabs.makeMerged`, which uses `flatMaterial`
 * -- the UNLIT material `slabs.ts` provides for ground dashes, grid lines and flat panels. It
 * computed per-facet normals and then handed them to a material that does not read normals, so
 * a nine-facet arch rendered as one uniform silhouette with no depth cue at all. A car is not
 * drawn that way: `car-builder` uses `vertexColorMaterial` (lit `builtin-standard` with
 * USE_VERTEX_COLOR), normals do the shading and the vertex colour only tints. That is the
 * project's way to draw a solid, and this now follows it.
 *
 * ITS ONLY OPENING FACED SIDEWAYS. The mouth was a disc facing local +X, and for a tunnel
 * aimed along the board's +X that is EXACTLY edge-on: the camera looks down world -Z, the
 * board tilts about world X, so a board-plane +X vector is unmoved by the tilt and its dot
 * with the view direction is zero. Level 8 ships two horizontally-aimed tunnels and neither
 * showed any opening at all -- the one feature that says "tunnel" was invisible on exactly the
 * headings that needed it. Everything else in this game is read from ABOVE (a car by its roof
 * and arrow), so the opening has to be too.
 *
 * WHAT MAKES IT READ FROM ABOVE: the tube is a real shell with a modelled DARK INTERIOR, open
 * at the mouth end. The board sits about 52 degrees from the view direction, so the eye reaches
 * `height / tan(52°)` into the bore -- 0.37 board units against a 1.2-unit tunnel, near a third
 * of its length. That is plenty of dark hole to read, and it works at every heading, unlike a
 * flat disc.
 *
 * Knows nothing about core: `GameController` passes `len`/`wid` in world units, having taken
 * them from `TUNNEL_BOX` the same way it takes a car's size from `CAP_BOX`.
 */

/**
 * Segments around the arch. 14, not the 9 the flat version used: with real lighting the facets
 * are now visible as facets, and a nine-sided bore reads as a polygon rather than a tube.
 */
const ARCH_SEG = 14;

/** Arch height as a share of the width. Slightly under a half circle, so it sits squat. */
const RISE = 0.62;

/**
 * Wall thickness, as a share of the smaller of the two arch radii. Thick enough that the rim
 * around the mouth is a visible band at phone size rather than a hairline -- that band is what
 * separates "a hole" from "a dark patch painted on a hump".
 */
const WALL = 0.22;

/**
 * The tunnel's colours. A periwinkle shell, a brighter rim around the mouth to catch the eye,
 * and a near-black bore.
 *
 * Declared here rather than in `colors.ts` on purpose -- that file is the palette keyed by
 * core's colour STRINGS, and a tunnel has no colour in core.
 */
export const TUNNEL_SHELL = new Color(120, 156, 232);
export const TUNNEL_RIM = new Color(176, 202, 255);
export const TUNNEL_MOUTH = new Color(26, 34, 62);

/** Crown lift: the top of the tube is painted lighter as well as lit brighter. */
const CROWN_LIFT = 0.16;

function lighten(c: Color, t: number): Color {
    return new Color(
        Math.round(c.r + (255 - c.r) * t),
        Math.round(c.g + (255 - c.g) * t),
        Math.round(c.b + (255 - c.b) * t),
        255,
    );
}

/**
 * Vertex accumulator. Positions, normals and colours only -- no uvs, because
 * `builtin-standard` with USE_VERTEX_COLOR never samples a texture here, and `utils.createMesh`
 * is happy without them (unlike `slabs.mergeParts`, whose all-or-nothing rule this no longer
 * goes through).
 */
class Shell {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly colors: number[] = [];
    readonly indices: number[] = [];

    vertex(p: [number, number, number], n: [number, number, number], c: Color): number {
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

/** One point of the arch cross-section, in the local (y, z) plane. */
interface Rib { y: number; z: number; ny: number; nz: number }

/**
 * The arch, from the right rim over the crown to the left rim, at radii (`hw`, `h`).
 *
 * `ny`/`nz` is the OUTWARD normal, taken from the ellipse's own gradient rather than from the
 * facet, so the shading sweeps smoothly round the tube instead of stepping. Both components are
 * scaled by the other radius, which is what makes it the true ellipse normal and not the
 * circle's -- a squat arch lit as if it were round reads as a half pipe with a flat top.
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

/**
 * `len` runs along +X, the direction cars leave; `wid` across it; the arch rises in +Z. The
 * node's own z-rotation puts it on the tunnel's heading, exactly as a car's does.
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
    const rim = lighten(shell, 0.34);

    const s = new Shell();

    // OUTER SKIN. Wound (front-rib0, back-rib0, back-rib1, front-rib1): the order that makes
    // (b-a)x(c-a) parallel to the outward normal rather than opposite it. The other obvious
    // order faces the triangles inward and backface-culls the whole tube away -- that was a
    // real bug in the first version, caught before it shipped, and it is silent when it
    // happens because an inside-out solid simply is not there.
    for (let i = 0; i < ARCH_SEG; i++) {
        const r0 = outer[i];
        const r1 = outer[i + 1];
        // Crown lighter than the flanks, on top of what the light already does.
        const c0 = lighten(shell, CROWN_LIFT * r0.z / h);
        const c1 = lighten(shell, CROWN_LIFT * r1.z / h);
        const a = s.vertex([hl, r0.y, r0.z], [0, r0.ny, r0.nz], c0);
        const b = s.vertex([-hl, r0.y, r0.z], [0, r0.ny, r0.nz], c0);
        const c = s.vertex([-hl, r1.y, r1.z], [0, r1.ny, r1.nz], c1);
        const d = s.vertex([hl, r1.y, r1.z], [0, r1.ny, r1.nz], c1);
        s.quad(a, b, c, d);
    }

    // THE BORE. Same sweep, inset by the wall, wound the OTHER way and normalled inward, so it
    // is the face you see when you look into the mouth from above. This is the piece the old
    // version had no equivalent of, and the reason it read as a hump rather than a tunnel.
    for (let i = 0; i < ARCH_SEG; i++) {
        const r0 = inner[i];
        const r1 = inner[i + 1];
        const a = s.vertex([hl, r0.y, r0.z], [0, -r0.ny, -r0.nz], mouth);
        const b = s.vertex([hl, r1.y, r1.z], [0, -r1.ny, -r1.nz], mouth);
        const c = s.vertex([-hl, r1.y, r1.z], [0, -r1.ny, -r1.nz], mouth);
        const d = s.vertex([-hl, r0.y, r0.z], [0, -r0.ny, -r0.nz], mouth);
        s.quad(a, b, c, d);
    }

    // THE RIM around the mouth: the annulus between the two skins at x = +hl, facing +X. It is
    // edge-on at some headings (see the note at the top) and that is fine -- it is the trim, not
    // the tell. Painted lighter than the shell so the opening has a lip.
    for (let i = 0; i < ARCH_SEG; i++) {
        const o0 = outer[i];
        const o1 = outer[i + 1];
        const i0 = inner[i];
        const i1 = inner[i + 1];
        const a = s.vertex([hl, o0.y, o0.z], [1, 0, 0], rim);
        const b = s.vertex([hl, o1.y, o1.z], [1, 0, 0], rim);
        const c = s.vertex([hl, i1.y, i1.z], [1, 0, 0], rim);
        const d = s.vertex([hl, i0.y, i0.z], [1, 0, 0], rim);
        s.quad(a, b, c, d);
    }

    // THE BACK WALL, closing the far end so the bore reads as depth rather than as a see-through
    // slot. Faces +X -- into the hollow, the side the camera looks in from -- not the solid's own
    // outward -X, where nothing ever looks from. Darker still than the bore, so the tube has a
    // gradient running away from the opening.
    const back = new Color(
        Math.round(mouth.r * 0.55), Math.round(mouth.g * 0.55), Math.round(mouth.b * 0.55), 255,
    );
    const hub = s.vertex([-hl, 0, 0], [1, 0, 0], back);
    for (let i = 0; i < ARCH_SEG; i++) {
        const r0 = inner[i];
        const r1 = inner[i + 1];
        const a = s.vertex([-hl, r0.y, r0.z], [1, 0, 0], back);
        const b = s.vertex([-hl, r1.y, r1.z], [1, 0, 0], back);
        s.tri(hub, a, b);
    }

    const geometry: primitives.IGeometry = {
        positions: s.positions,
        normals: s.normals,
        colors: s.colors,
        indices: s.indices,
        minPos: { x: -hl, y: -hw, z: 0 },
        maxPos: { x: hl, y: hw, z: h },
        boundingRadius: Math.hypot(hl, hw, h),
    };

    const node = new Node(name);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(geometry);
    // WHITE, because the vertex colours ARE the paint here: `vertexColorMaterial` sets
    // `mainColor` to white and multiplies, so passing the shell colour again would square it.
    mr.material = vertexColorMaterial(Color.WHITE);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    return node;
}
