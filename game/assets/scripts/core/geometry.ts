/**
 * Oriented boxes in 2D, and the two questions the lot asks of them: are these two
 * overlapping (and which way do I push them apart), and how far can this one travel
 * before it hits that one.
 *
 * Deliberately ignorant of cars, levels and capacities -- it takes boxes and numbers.
 * That is what makes it testable without building a level, and it is the only file in
 * core with no domain knowledge at all.
 */

/**
 * A box that knows which way it is facing. `len` runs ALONG `angle`, `wid` across it.
 *
 * Note a rectangle is symmetric under a half turn: `angle` and `angle + 180` describe
 * the same region. The packer relies on that -- flipping which way a car drives out
 * does not move the space it occupies.
 */
export interface OBB {
    x: number;
    y: number;
    /** Degrees. 0 = +X, counter-clockwise. */
    angle: number;
    len: number;
    wid: number;
}

const DEG = Math.PI / 180;

/** Unit vectors along the box's own length (u) and width (v) axes. */
function obbAxes(o: OBB): { ux: number; uy: number; vx: number; vy: number } {
    const c = Math.cos(o.angle * DEG);
    const s = Math.sin(o.angle * DEG);
    return { ux: c, uy: s, vx: -s, vy: c };
}

/** The four corners, in order around the box. */
export function obbCorners(o: OBB): Array<[number, number]> {
    const { ux, uy, vx, vy } = obbAxes(o);
    const hl = o.len / 2;
    const hw = o.wid / 2;
    return [
        [o.x + ux * hl + vx * hw, o.y + uy * hl + vy * hw],
        [o.x - ux * hl + vx * hw, o.y - uy * hl + vy * hw],
        [o.x - ux * hl - vx * hw, o.y - uy * hl - vy * hw],
        [o.x + ux * hl - vx * hw, o.y + uy * hl - vy * hw],
    ];
}

/** `o` grown by `d` on every side. How a required clearance is expressed. */
export function inflate(o: OBB, d: number): OBB {
    return { ...o, len: o.len + 2 * d, wid: o.wid + 2 * d };
}

/** `o`'s shadow on a unit axis, as [min, max]. */
function project(o: OBB, ax: number, ay: number): [number, number] {
    const centre = o.x * ax + o.y * ay;
    const { ux, uy, vx, vy } = obbAxes(o);
    const radius = Math.abs((ux * ax + uy * ay) * o.len / 2)
        + Math.abs((vx * ax + vy * ay) * o.wid / 2);
    return [centre - radius, centre + radius];
}

/**
 * The axes worth testing for a pair of boxes: each box's own two. In 2D with pure
 * translation that is the complete set -- no cross-product axes, unlike 3D.
 */
function axesOf(a: OBB, b: OBB): Array<[number, number]> {
    const A = obbAxes(a);
    const B = obbAxes(b);
    return [[A.ux, A.uy], [A.vx, A.vy], [B.ux, B.uy], [B.vx, B.vy]];
}

/**
 * The shortest shove that gets `a` clear of `b`, pointing away from `b`; null when
 * they are already apart. Boxes whose faces are exactly flush count as apart, which
 * is what lets a clearance of exactly CLEARANCE be legal rather than a rounding coin
 * flip.
 */
export function overlapMTV(a: OBB, b: OBB): { x: number; y: number } | null {
    let least = Infinity;
    let px = 0;
    let py = 0;
    for (const [ax, ay] of axesOf(a, b)) {
        const [alo, ahi] = project(a, ax, ay);
        const [blo, bhi] = project(b, ax, ay);
        if (ahi <= blo || bhi <= alo) return null;
        // Two ways off this axis; take the nearer edge.
        const forward = bhi - alo;
        const backward = ahi - blo;
        const push = forward < backward ? forward : -backward;
        if (Math.abs(push) < least) {
            least = Math.abs(push);
            px = ax * push;
            py = ay * push;
        }
    }
    return { x: px, y: py };
}

/** Whether `o` lies wholly inside the `w` x `h` rectangle centred on the origin. */
export function insideRect(o: OBB, w: number, h: number): boolean {
    const hw = w / 2 + 1e-9;
    const hh = h / 2 + 1e-9;
    for (const [x, y] of obbCorners(o)) {
        if (Math.abs(x) > hw || Math.abs(y) > hh) return false;
    }
    return true;
}
