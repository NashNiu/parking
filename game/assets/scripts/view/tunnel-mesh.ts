import { Color, Node } from 'cc';
import { makeMerged, MeshPart } from './slabs';

/**
 * The tunnel, drawn. A half-tube lying along +X with a wall across its far end, plus a dark
 * disc set into the near end so the opening reads as a hole rather than as a painted stripe.
 *
 * Built here rather than loaded: there are no models left in this project, and a tunnel is a
 * simpler surface than a car. It knows nothing about core -- `GameController` hands it the
 * size, having taken that from TUNNEL_BOX like every other body size.
 */

/** Segments around the arch. Nine reads as a curve and still merges into one draw call. */
const ARCH_SEG = 9;

/** Arch height as a share of the width. Slightly under a half circle, so it sits squat. */
const RISE = 0.62;

/** How far the dark mouth disc is set back from the opening. */
const MOUTH_INSET = 0.04;

export const TUNNEL_HEIGHT_RATIO = RISE;

/**
 * The tunnel's two colours, from the reference art: a periwinkle shell and a near-black
 * navy opening. Declared here rather than in `colors.ts` on purpose -- that file is the
 * palette keyed by core's colour STRINGS, and a tunnel has no colour in core.
 */
export const TUNNEL_SHELL = new Color(120, 156, 232);
export const TUNNEL_MOUTH = new Color(38, 52, 96);

/** A quad from four corners, with one flat normal. Wound counter-clockwise as listed. */
function quad(
    a: [number, number, number], b: [number, number, number],
    c: [number, number, number], d: [number, number, number],
    n: [number, number, number],
): MeshPart {
    return {
        positions: [...a, ...b, ...c, ...d],
        normals: [...n, ...n, ...n, ...n],
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        indices: [0, 1, 2, 0, 2, 3],
    };
}

/**
 * `len` runs along +X (the direction cars leave), `wid` across it, and the arch rises in +Z.
 * The node's own rotation puts it on the tunnel's heading, exactly as a car's does.
 */
export function buildTunnel(
    name: string, len: number, wid: number, shell: Color, mouth: Color,
): Node {
    const hl = len / 2;
    const hw = wid / 2;
    const h = wid * RISE;
    // Points around the arch, from the right rim over the top to the left rim.
    const ring: [number, number][] = [];
    for (let i = 0; i <= ARCH_SEG; i++) {
        const th = (i / ARCH_SEG) * Math.PI;
        ring.push([Math.cos(th) * hw, Math.sin(th) * h]);
    }

    const parts: MeshPart[] = [];
    for (let i = 0; i < ARCH_SEG; i++) {
        const [y0, z0] = ring[i];
        const [y1, z1] = ring[i + 1];
        // Outward normal of this facet, in the cross-section plane.
        const ny = (z1 - z0);
        const nz = -(y1 - y0);
        const nl = Math.hypot(ny, nz) || 1;
        // Corners in (near-rim0, far-rim0, far-rim1, near-rim1) order -- NOT the more obvious
        // (near-rim0, near-rim1, far-rim1, far-rim0), which was tried first. That order swings
        // (b-a)x(c-a) to point INWARD, opposite the outward normal above: correct by the
        // normal (so it still shades like a convex arch) but backface-culled from outside,
        // i.e. invisible from the only direction the camera ever sees it. Proved in general,
        // not just eyeballed: with that order the two are always anti-parallel, by
        // -2*hl*(dy^2+dz^2) <= 0 for every segment, hl and the segment length both being
        // positive.
        parts.push(quad(
            [hl, y0, z0], [-hl, y0, z0], [-hl, y1, z1], [hl, y1, z1],
            [0, ny / nl, nz / nl],
        ));
    }
    // The back wall, one fan of quads from the floor centre out to the ring. Faces +X -- into
    // the tunnel's hollow, the same side the mouth disc below faces -- because that is the
    // side the camera looks from, in through the mouth. It is NOT the solid's own outward -X:
    // that would put the visible face behind the wall, where nothing ever looks from.
    for (let i = 0; i < ARCH_SEG; i++) {
        const [y0, z0] = ring[i];
        const [y1, z1] = ring[i + 1];
        parts.push(quad(
            [-hl, 0, 0], [-hl, y0, z0], [-hl, y1, z1], [-hl, 0, 0], [1, 0, 0],
        ));
    }
    const node = makeMerged(name, parts, shell);

    // The opening: the same fan at the near end, in the dark colour, pushed just inside. Kept
    // to the SAME (centre, ring[i], ring[i+1]) order as the back wall above, on purpose --
    // swapping ring[i] and ring[i+1] here (as a first pass did, since it reads naturally as
    // "sweep the other way for the near end") flips this fan to face -X, away from the
    // camera, while the wall it is supposed to sit in front of still faces +X. The two must
    // agree: both are seen by the same camera, looking in through the same mouth.
    const inner: MeshPart[] = [];
    for (let i = 0; i < ARCH_SEG; i++) {
        const [y0, z0] = ring[i];
        const [y1, z1] = ring[i + 1];
        const x = hl - MOUTH_INSET;
        inner.push(quad([x, 0, 0], [x, y0, z0], [x, y1, z1], [x, 0, 0], [1, 0, 0]));
    }
    node.addChild(makeMerged(`${name}-mouth`, inner, mouth));
    return node;
}
