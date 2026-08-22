import { buildShape, Pt, Seg, TrackShape } from './track-shapes';
import { FeedSide } from './types';

/**
 * Lane geometry, in board units. These were view constants; they live here because
 * validateTrack has to check a level's lookahead against them, and one copy of a number
 * beats two. `edgeLimit` is the visible half-width at the track's depth.
 *
 * Frozen: a caller that reached in and changed one of these would silently move a bound
 * `validateTrack` and the view both rely on staying fixed.
 */
export const LANE = Object.freeze({
    bandHalf: 0.38,
    start: 0.52,
    step: 0.45,
    margin: 0.25,
    edgeLimit: 4.67,
});

/**
 * Legal ring lengths. Multiples of four, because the entry cells are board +- capacity/4
 * and anything else makes that division round -- which lands the entry off the quarter
 * point, on a curved or slanted stretch whose normal is nowhere near horizontal.
 */
export const CAPACITY_OPTIONS = [8, 12, 16, 20] as const;

/**
 * Row spacing bounds, in board units. Above the ceiling the ring looks empty. The floor
 * is set by GAP_ARC (0.55) rather than by the figures, which are only about 0.22 deep
 * along the path: a spacing at or below the doorway's own length would let the boarding
 * gap swallow the rows either side of it, so the floor has to sit above GAP_ARC with a
 * little to spare (the test in track-path.test.ts pins that ordering).
 *
 * 0.58, down from 0.70 with the ring itself (see TRACK_BOX): the tightest length the
 * difficulty curve actually asks for is rect at 20 slots, which used to space its rows
 * 0.73 apart and now spaces them 0.62.
 */
export const ROW_SPACING_MIN = 0.58;
export const ROW_SPACING_MAX = 1.90;

/**
 * Boarding and entry gaps, as an ABSOLUTE arc length. It used to be half a ring slot,
 * which shrank with the ring: at 20 slots the doorway was 0.37 long and stopped reading
 * as a doorway. Must stay under ROW_SPACING_MIN so a gap never eats its neighbours.
 */
export const GAP_ARC = 0.55;

/** A row of four stands 0.78 across the path; a tighter arc than this crushes its inside. */
export const MIN_CURVE_RADIUS = 0.6;

/** How far off horizontal an entry's outward normal may sit (about 20 degrees). */
export const ENTRY_NORMAL_MAX = 0.35;

/**
 * One track's geometry: an arc-length walk over a shape's segments. Instance state, not
 * module state — the previous version cached its segments in a module-level variable
 * keyed on the track's y, which silently hands level 2 level 1's shape.
 */
export class TrackPath {
    readonly shape: TrackShape;
    readonly perimeter: number;
    readonly minRadius: number;
    private readonly segs: Seg[];
    /** Scratch for the finite-difference normal, so a per-frame call allocates nothing. */
    private readonly _a: Pt = { x: 0, y: 0 };
    private readonly _b: Pt = { x: 0, y: 0 };

    constructor(shape: TrackShape) {
        const def = buildShape(shape);
        this.shape = shape;
        this.segs = def.segs;
        this.minRadius = def.minRadius;
        this.perimeter = def.segs.reduce((a, s) => a + s.len, 0);
    }

    /**
     * Point at arc-length fraction t (wrapped into [0,1)), written into `out` (and
     * returned) rather than a fresh object. A caller that holds the returned reference
     * across a SECOND call with the same `out` gets that first point overwritten in
     * place — pass separate scratch objects (as `normalAt` does with `_a`/`_b`) if two
     * live results are needed at once.
     */
    pointAt(t: number, out: Pt = { x: 0, y: 0 }): Pt {
        let s = (((t % 1) + 1) % 1) * this.perimeter;
        for (const seg of this.segs) {
            if (s <= seg.len) {
                seg.at(seg.len > 0 ? s / seg.len : 0, out);
                return out;
            }
            s -= seg.len;
        }
        this.segs[this.segs.length - 1].at(1, out);
        return out;
    }

    /**
     * Outward unit normal at t. Taken as a finite difference of the path rather than
     * analytically per segment: the segments only answer positions, and a 1/2000-lap
     * difference reads as smooth straight through the corners. For a clockwise walk the
     * outward normal of a tangent (dx, dy) is (-dy, dx).
     *
     * Like `pointAt`, writes into (and returns) `out` rather than a fresh object, so
     * reusing one buffer for both a point and a normal clobbers whichever was written
     * first — this method's own `_a`/`_b` scratch pair is what lets it call `pointAt`
     * twice internally without that problem.
     */
    normalAt(t: number, out: Pt = { x: 0, y: 0 }): Pt {
        const d = 1 / 4000;
        this.pointAt(t + d, this._a);
        this.pointAt(t - d, this._b);
        const dx = this._a.x - this._b.x, dy = this._a.y - this._b.y;
        const l = Math.hypot(dx, dy) || 1;
        out.x = -dy / l;
        out.y = dx / l;
        return out;
    }

    /** Arc length between two neighbouring ring rows. */
    rowSpacing(capacity: number): number {
        return this.perimeter / capacity;
    }
}

/**
 * Ring index where `side`'s channel joins. Math.round is defensive only: validateTrack
 * requires capacity to be a multiple of four, so the division is exact for every level
 * that ships, and a fractional index would index the ring array with a float.
 */
export function entryIndex(capacity: number, boardIndex: number, side: FeedSide): number {
    const q = Math.round(capacity / 4);
    return side === 'near'
        ? (boardIndex - q + capacity) % capacity
        : (boardIndex + q) % capacity;
}

/**
 * How many waiting batches a channel on this shape may draw before its outer edge leaves
 * the visible width. Independent of capacity: with capacity a multiple of four the entry
 * always lands at t=0.25, so the dock's x is a property of the shape alone.
 */
export function maxLookahead(shape: TrackShape): number {
    const dockX = Math.abs(new TrackPath(shape).pointAt(0.25).x);
    const room = LANE.edgeLimit - dockX - LANE.bandHalf - LANE.start - LANE.margin;
    return 1 + Math.floor(room / LANE.step);
}

/** Ring lengths this shape's perimeter can carry at a legible row spacing. */
export function capacityOptions(shape: TrackShape): number[] {
    const path = new TrackPath(shape);
    return CAPACITY_OPTIONS.filter((c) => {
        const spacing = path.rowSpacing(c);
        return spacing >= ROW_SPACING_MIN && spacing <= ROW_SPACING_MAX;
    });
}
