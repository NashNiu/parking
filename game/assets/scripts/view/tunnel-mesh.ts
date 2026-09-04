import { Color, MeshRenderer, Node, primitives, utils } from 'cc';
import { vertexColorMaterial } from './materials';

/**
 * The underground garage exit, drawn: a low blue plate whose TOP FACE carries the whole
 * identity -- a dark opening with a white arrow driving out of it.
 *
 * WHAT IT IS. A fixed-heading queue of cars lives inside; the head car stands just outside the
 * mouth and is an ordinary car in every other respect. Core still calls it a TUNNEL
 * (`TunnelSpec`, `lot.tunnels`) and that name is not changing -- no player-facing text uses
 * either word, and renaming would churn the level schema and all ten level files for nothing.
 * This file is the only place the two vocabularies meet.
 *
 * WHY IT IS FLAT, after two goes at making it a solid.
 *
 * The camera is ORTHOGRAPHIC and square onto the board, so an object here IS its plan view --
 * the same finding that turned the cars from models into drawn geometry (README: of the first
 * car model's nine parts, eight were invisible at this camera; of the second's, the
 * windscreen, rear window and all four hubs were each 0%). Two solid versions of this element
 * were built and both failed for reasons that are all the same reason:
 *
 *  - A HALF-TUBE with its opening facing local +X. For a heading along the board's +X that is
 *    exactly edge-on -- the board tilts about world X, so a board-plane +X vector is untouched
 *    by the tilt and its dot with the view direction is zero. Level 8's two horizontal tunnels
 *    showed no opening at all.
 *  - A DOMED HOOD over a ramp. From above you see almost entirely the crown, which was the part
 *    lifted hardest toward white, and an up-facing surface already takes 67% more key light on
 *    a tilted board -- so it washed out to grey. Worse, a 0.47-high hood shifts 0.29 up-screen
 *    under this projection, which is over half the footprint: on some headings the hood's own
 *    silhouette covered the ramp that was supposed to be the readable part.
 *
 * So the height came down to a plate and the identity moved to the top face, which is the one
 * surface this camera always sees square on. That is not a compromise, it is the same rule
 * every readable thing here already follows: a car is legible because of the white arrow on its
 * ROOF, not because of its geometry. This element had nothing on its roof at all.
 *
 * Knows nothing about core: `GameController` passes `len`/`wid` in world units, having taken
 * them from `TUNNEL_BOX` the same way it takes a car's size from `CAP_BOX`.
 */

/** Height as a share of the width. Low: under half a car, so it occludes nothing behind it. */
const RISE = 0.2;

/** Corner rounding of the plate, as a share of the width. */
const CORNER = 0.34;

/** Arc segments per rounded corner. Four is plenty at the size this is drawn. */
const CORNER_SEG = 4;

/**
 * How much of the plate the dark opening covers, measured from the mouth end, and how far it is
 * inset from the sides. The opening runs to the mouth edge itself: it has to read as something
 * cars come OUT of, not as a panel painted in the middle.
 */
const MOUTH_SHARE = 0.6;
const MOUTH_INSET = 0.16;

/** Arrow proportions inside the opening, as shares of the opening's own length and width. */
const ARROW_LEN = 0.72;
const ARROW_WID = 0.52;
const ARROW_HEAD = 0.46;
const ARROW_SHAFT = 0.42;

/**
 * Depth steps between the coplanar plates, in world units and deliberately tiny -- they order
 * the draw and nothing else. Same trick and same reason as `car-mesh.ts`'s Z_STEP: coplanar
 * faces z-fight.
 */
const Z_STEP = 0.006;

/** How much darker the side wall sits than the top face. */
const WALL_SHADE = 0.72;

/**
 * The colours, from the reference art: a periwinkle top, a near-black opening. Not in
 * `colors.ts` -- that palette is keyed by core's colour STRINGS, and this element has none.
 */
export const TUNNEL_SHELL = new Color(120, 168, 240);
export const TUNNEL_MOUTH = new Color(24, 32, 58);

/** The arrow, matching the white the cars carry on their roofs. */
const ARROW_PAINT = new Color(255, 255, 255);

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

/** A rounded rectangle, counter-clockwise from the bottom-right corner. */
function roundRect(cx: number, cy: number, w: number, h: number, r: number): Pt[] {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    const hw = w / 2 - rr;
    const hh = h / 2 - rr;
    const pts: Pt[] = [];
    const corners: Array<[number, number, number]> = [
        [cx + hw, cy - hh, -Math.PI / 2],
        [cx + hw, cy + hh, 0],
        [cx - hw, cy + hh, Math.PI / 2],
        [cx - hw, cy - hh, Math.PI],
    ];
    for (const [ox, oy, a0] of corners) {
        for (let s = 0; s <= CORNER_SEG; s++) {
            const a = a0 + (s / CORNER_SEG) * (Math.PI / 2);
            pts.push([ox + Math.cos(a) * rr, oy + Math.sin(a) * rr]);
        }
    }
    return pts;
}

/**
 * The arrow, pointing +X: a shaft rectangle and a head triangle, as one convex-enough fan.
 *
 * Emitted as TWO polygons rather than one concave outline, because `addFlat` fans from the
 * first point and a fan of a concave shape folds over itself. Same reason `car-mesh` splits
 * its arrow into pieces.
 */
function arrowPieces(cx: number, cy: number, len: number, wid: number): Pt[][] {
    const half = len / 2;
    const headLen = len * ARROW_HEAD;
    const shaftHalf = (wid * ARROW_SHAFT) / 2;
    const shaftFront = cx + half - headLen;
    return [
        [
            [cx - half, cy - shaftHalf],
            [shaftFront, cy - shaftHalf],
            [shaftFront, cy + shaftHalf],
            [cx - half, cy + shaftHalf],
        ],
        [
            [shaftFront, cy - wid / 2],
            [cx + half, cy],
            [shaftFront, cy + wid / 2],
        ],
    ];
}

/**
 * `len` runs along +X, the direction cars leave; `wid` across it; the plate rises in +Z. The
 * node's own z-rotation puts it on the heading, exactly as a car's does.
 */
export function buildTunnel(
    name: string, len: number, wid: number, shell: Color, mouth: Color,
): Node {
    const h = wid * RISE;
    const body = roundRect(0, 0, len, wid, wid * CORNER);

    const p = new Plate();

    // The wall first, then the top over it: the same order and the same idiom as a car, whose
    // outline is extruded from the board to the roof and capped.
    p.addWall(body, 0, h, shade(shell, WALL_SHADE * 0.86), shade(shell, WALL_SHADE));
    p.addFlat(body, h, shell);

    // THE OPENING. Runs to the mouth edge, so it reads as something cars come out of rather
    // than a panel painted in the middle. Its far end is rounded and its near end square --
    // square because it is cut off by the plate's edge, which is exactly what a hole running
    // out of a wall looks like from above.
    const mouthLen = len * MOUTH_SHARE;
    const mouthWid = wid * (1 - MOUTH_INSET * 2);
    const mouthCx = len / 2 - mouthLen / 2;
    const opening = roundRect(mouthCx, 0, mouthLen, mouthWid, mouthWid * 0.42);
    p.addFlat(opening, h + Z_STEP, mouth);

    // THE ARROW, inside the opening and pointing out. This is the piece that makes the element
    // legible at a glance, and it is legible for exactly the reason a car is: a white mark on
    // the one face this camera always sees square on.
    for (const piece of arrowPieces(mouthCx, 0, mouthLen * ARROW_LEN, mouthWid * ARROW_WID)) {
        p.addFlat(piece, h + Z_STEP * 2, ARROW_PAINT);
    }

    const geometry: primitives.IGeometry = {
        positions: p.positions,
        normals: p.normals,
        colors: p.colors,
        indices: p.indices,
        minPos: { x: -len / 2, y: -wid / 2, z: 0 },
        maxPos: { x: len / 2, y: wid / 2, z: h + Z_STEP * 2 },
        boundingRadius: Math.hypot(len / 2, wid / 2, h),
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
