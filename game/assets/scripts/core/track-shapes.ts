/**
 * The five track outlines, as arc-length segment lists.
 *
 * Pure math on purpose: nothing here imports `cc`, so the whole geometry model is
 * jest-testable and the view is left with mesh building only. It used to live inside
 * view/track-view.ts as module-level state, which stopped working the moment a second
 * shape existed — the cache there keys on the track's y, not on the shape.
 *
 * Every outline is walked CLOCKWISE from the top centre. That is what puts the boarding
 * gap at t=0.5 (bottom centre, facing the parking bay) and the two channel entrances at
 * t=0.25 / 0.75, which is the mapping the ring's index arithmetic assumes.
 */

/** A point in board-local coordinates (the track's own frame, origin at its centre). */
export interface Pt { x: number; y: number }

/** One arc-length-parameterised piece of an outline. */
export interface Seg {
    /** Arc length in board units. */
    len: number;
    /** Point at arc-length fraction u in [0,1], written into `out`. */
    at(u: number, out: Pt): void;
}

export type TrackShape = 'rect' | 'hex' | 'trap' | 'oval' | 'circle';

export const TRACK_SHAPES: TrackShape[] = ['rect', 'hex', 'trap', 'oval', 'circle'];

/**
 * The box every shape fits, in board units — an UPPER bound from the camera and the
 * track's neighbours, and inside that bound a matter of composition.
 *
 * The ceilings: the visible half-width at the track's depth minus what a feeder channel
 * needs beside it (LANE, track-path.ts) caps halfW at 2.60, and the parking bay panel,
 * whose top edge is at y = 2.05 against a track centre at 3.8, caps halfH at 1.30. The
 * ring used to sit exactly on both, which left a feeder channel 0.02 of clearance to the
 * screen edge at its longest legal length — visually the channels were crushed against
 * the frame while the ring dominated the board. Pulling halfW in to 2.15 hands that
 * 0.45 to the channels, and it shortens the lap, so the rows on it also close up
 * (a 20-slot ring goes from 0.73 between rows to 0.62).
 *
 * halfH is the one that cannot simply follow: the oval's tightest curvature is
 * halfH^2/halfW, and MIN_CURVE_RADIUS (0.6) is a hard floor on it, so a 2.15 half-width
 * needs halfH >= 1.14. 1.20 keeps a real margin there (0.67) and still lifts the band's
 * drop shadow clear of the parking panel, which it used to land exactly on.
 */
export const TRACK_BOX = { halfW: 2.15, halfH: 1.20 };

/**
 * Corner radius, the same for all three polygons: 0.60 is the SMALLEST value that clears
 * MIN_CURVE_RADIUS (0.6), and a fillet is what sets a rounded polygon's tightest curve.
 * Smaller reads as a crisper quadrilateral next to the oval, and was the first choice —
 * but a row of four figures stands 0.78 ACROSS the path, so on a 0.40 corner the innermost
 * figure lands within 0.01 of the arc's own centre and the row visibly folds.
 */
const RECT_R = 0.60;
const HEX_R = 0.60;
const TRAP_R = 0.60;

/**
 * Where the hexagon's flat top ends and where the trapezoid's short edge does, each as a
 * FRACTION of halfW rather than an absolute x. Both used to be absolute (1.7 and 1.9
 * against a 2.6 half-width, which is where these two ratios come from), and both would
 * have silently misdrawn the moment the box moved: at halfW 2.15 a literal 1.9 leaves the
 * trapezoid's slant 0.25 wide instead of 0.58, which flattens it toward a rectangle and
 * takes the 15-degree channel tilt -- the whole point of that shape -- with it.
 */
const HEX_FLAT = 1.7 / 2.6;
const TRAP_TOP = 1.9 / 2.6;

/** Straight pieces the ellipse is cut into; see `ellipsePoly`. */
const OVAL_SEGMENTS = 120;

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

function unit(x: number, y: number): Pt {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
}

function line(x0: number, y0: number, x1: number, y1: number): Seg {
    const dx = x1 - x0, dy = y1 - y0;
    return {
        len: Math.hypot(dx, dy),
        at: (u, out) => { out.x = x0 + dx * u; out.y = y0 + dy * u; },
    };
}

function arc(cx: number, cy: number, r: number, a0: number, sweep: number): Seg {
    return {
        len: Math.abs(sweep) * r,
        at: (u, out) => {
            const a = a0 + sweep * u;
            out.x = cx + r * Math.cos(a);
            out.y = cy + r * Math.sin(a);
        },
    };
}

/** A rounded corner at `v`, plus the two tangent points the straights must meet. */
function cornerArc(v: Pt, prev: Pt, next: Pt, r: number): { seg: Seg; from: Pt; to: Pt } {
    const u = unit(prev.x - v.x, prev.y - v.y);
    const w = unit(next.x - v.x, next.y - v.y);
    const half = Math.acos(clamp(u.x * w.x + u.y * w.y, -1, 1)) / 2;
    const trim = r / Math.tan(half);
    const from = { x: v.x + u.x * trim, y: v.y + u.y * trim };
    const to = { x: v.x + w.x * trim, y: v.y + w.y * trim };
    const bis = unit(u.x + w.x, u.y + w.y);
    const c = { x: v.x + bis.x * (r / Math.sin(half)), y: v.y + bis.y * (r / Math.sin(half)) };
    const a0 = Math.atan2(from.y - c.y, from.x - c.x);
    const a1 = Math.atan2(to.y - c.y, to.x - c.x);
    // Shortest signed sweep: a corner arc never exceeds half a turn either way.
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    return { seg: arc(c.x, c.y, r, a0, sweep), from, to };
}

/**
 * Rounded polygon. `verts` runs CLOCKWISE and must start with the two ends of a
 * horizontal top edge straddling x=0 (verts[0] its left end, verts[1] its right end):
 * the walk starts at the MIDDLE of that edge, which is what makes t=0 the top centre.
 * Splitting the top edge in two is the same trick the old buildSegments used.
 */
function roundedPoly(verts: Pt[], r: number): Seg[] {
    const n = verts.length;
    const corners = verts.map((v, i) => cornerArc(v, verts[(i - 1 + n) % n], verts[(i + 1) % n], r));
    const topY = verts[0].y;
    const segs: Seg[] = [];
    segs.push(line(0, topY, corners[1].from.x, corners[1].from.y));
    for (let i = 1; i < n; i++) {
        segs.push(corners[i].seg);
        const next = corners[(i + 1) % n];
        segs.push(line(corners[i].to.x, corners[i].to.y, next.from.x, next.from.y));
    }
    segs.push(corners[0].seg);
    segs.push(line(corners[0].to.x, corners[0].to.y, 0, topY));
    return segs;
}

/**
 * The ellipse as a fine polyline. Its parametric form is NOT arc-length uniform — walking
 * it by angle bunches the rows at the two ends — and a 120-segment polyline is within
 * 0.001 of the true curve while making the arc-length walk exact.
 */
function ellipsePoly(a: number, b: number, n: number): Seg[] {
    const segs: Seg[] = [];
    const at = (i: number): Pt => {
        const th = Math.PI / 2 - (2 * Math.PI * i) / n;   // start at the top, run clockwise
        return { x: a * Math.cos(th), y: b * Math.sin(th) };
    };
    for (let i = 0; i < n; i++) {
        const p = at(i), q = at(i + 1);
        segs.push(line(p.x, p.y, q.x, q.y));
    }
    return segs;
}

export interface ShapeDef {
    segs: Seg[];
    /**
     * Smallest radius of curvature anywhere on the outline. A row of four figures stands
     * ACROSS the path (0.78 wide), so a tight arc squeezes the inner ones together;
     * validateTrack rejects anything under 0.6. Declared rather than measured because
     * the ellipse is a polyline, whose segments each claim infinite radius.
     */
    minRadius: number;
}

export function buildShape(shape: TrackShape): ShapeDef {
    const { halfW, halfH } = TRACK_BOX;
    const hexFlat = HEX_FLAT * halfW;
    const trapTop = TRAP_TOP * halfW;
    switch (shape) {
        case 'rect':
            return {
                segs: roundedPoly([
                    { x: -halfW, y: halfH }, { x: halfW, y: halfH },
                    { x: halfW, y: -halfH }, { x: -halfW, y: -halfH },
                ], RECT_R),
                minRadius: RECT_R,
            };
        case 'hex':
            return {
                segs: roundedPoly([
                    { x: -hexFlat, y: halfH }, { x: hexFlat, y: halfH }, { x: halfW, y: 0 },
                    { x: hexFlat, y: -halfH }, { x: -hexFlat, y: -halfH }, { x: -halfW, y: 0 },
                ], HEX_R),
                minRadius: HEX_R,
            };
        case 'trap':
            // Up-down asymmetric on purpose, which is why its quarter point lands on a
            // slanted edge rather than at the widest point — the channel then leaves at
            // 15 degrees, and everything downstream reads that from the path normal.
            return {
                segs: roundedPoly([
                    { x: -trapTop, y: halfH }, { x: trapTop, y: halfH },
                    { x: halfW, y: -halfH }, { x: -halfW, y: -halfH },
                ], TRAP_R),
                minRadius: TRAP_R,
            };
        case 'oval':
            // b^2/a, at the two ends, is the tightest this curve ever gets.
            return {
                segs: ellipsePoly(halfW, halfH, OVAL_SEGMENTS),
                minRadius: (halfH * halfH) / halfW,
            };
        case 'circle':
            // Bounded by the VERTICAL budget, so its radius is halfH and its perimeter is
            // barely 60% of the quadrilateral's. That makes it the one genuinely short
            // ring: 8 and 12 slots are the only lengths it can carry, and the curve only
            // ever uses 8.
            return {
                segs: [arc(0, 0, halfH, Math.PI / 2, -2 * Math.PI)],
                minRadius: halfH,
            };
    }
}
