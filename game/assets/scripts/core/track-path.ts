import { buildShape, Pt, Seg, TrackShape } from './track-shapes';
import { FeedSide, GROUP_SIZE } from './types';

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
    step: 0.40,
    margin: 0.25,
    edgeLimit: 4.67,
});

/**
 * Legal ring lengths. Multiples of four, because the entry cells are board +- capacity/4
 * and anything else makes that division round -- which lands the entry off the quarter
 * point, on a curved or slanted stretch whose normal is nowhere near horizontal.
 *
 * Which of them a given shape may actually use is decided by `capacityOptions`, from the
 * shape's own perimeter -- not from this list. The list stops at 24 because 28 is where the
 * rows stop reading as rows: on an oval at 28 the nearest figure in the NEXT row is exactly
 * as far away as the one standing beside you (0.220 either way), and the eye then has
 * nothing to group by.
 */
export const CAPACITY_OPTIONS = [8, 12, 16, 20, 24] as const;

/**
 * How the GROUP_SIZE figures of one ring cell stand: `across` of them side by side across
 * the path, and -- if there are more than `across` of them -- the rest in ranks behind,
 * every other rank shifted sideways by half a step so the ranks interlock like brickwork
 * instead of lining up in columns.
 *
 * At GROUP_SIZE 4 a block is ONE row of four and the rank machinery is inert. It is kept
 * because GROUP_SIZE is a knob (see types.ts) and the shift is not optional once a second
 * rank exists: a two-rank block whose ranks line up in columns closes to a rank step at the
 * corners, where a cell's ranks swing together. `minFigureGap` is what checks whatever
 * shape this describes, so a change here is caught rather than discovered on screen.
 *
 * `acrossStep` is 0.22 -- exactly a figure's width, so a row of four is people shoulder to
 * shoulder rather than a picket fence with air between them, and the heads touch without
 * overlapping. The row spans 0.88, which does overhang the 0.76 band slightly; a crowd
 * spilling to the kerb reads better than a row narrow enough to fit.
 *
 * `figure` is how wide one figure is (its head, the widest part -- see pax-figure.ts), and
 * `clearance` is how close two of them may come before they read as one clipped blob
 * rather than as a crowd. The view reads all of this: one source of truth for a layout
 * that core has to be able to check.
 */
export const BLOCK = Object.freeze({
    across: 4,
    acrossStep: 0.22,
    rankStep: 0.15,
    figure: 0.22,
    clearance: 0.18,
});

/** Ranks in a block of `groupSize`, `BLOCK.across` of them abreast. */
export function blockRanks(groupSize: number): number {
    return Math.max(1, Math.round(groupSize / BLOCK.across));
}

/** Along-the-path extent of a whole block: the ranks, plus the width of a figure. */
export function blockLength(groupSize: number): number {
    return BLOCK.rankStep * (blockRanks(groupSize) - 1) + BLOCK.figure;
}

/**
 * Across-the-path extent of a whole block: the abreast figures, plus the brickwork shift if
 * a second rank exists to carry one. Half of this is how far a block reaches from the
 * centreline, which is what MIN_CURVE_RADIUS has to clear.
 */
export function blockSpan(groupSize: number): number {
    const shift = blockRanks(groupSize) > 1 ? BLOCK.acrossStep / 2 : 0;
    return BLOCK.acrossStep * (BLOCK.across - 1) + shift + BLOCK.figure;
}

/**
 * Floor on a ring cell's arc length: it keeps the boarding doorway (GAP_ARC) from swallowing
 * a whole neighbouring cell. The test in track-path.test.ts pins that ordering. There is no
 * matching ceiling -- how the ring READS is the seam's job, below.
 *
 * This floor, and GAP_ARC under it, are what cap how tightly the ring can be packed: the
 * seam is the cell minus a row, so a shorter cell is the only way to a smaller seam, and
 * the doorway is what stops the cell getting shorter.
 */
export const ROW_SPACING_MIN = 0.42;

/**
 * The bare band between one cell's block and the next, in board units: a cell's arc length
 * minus the block that stands in it.
 *
 * This is what makes the ring legible. A group is the unit the player acts on -- it is what
 * boards, all at once, when its colour matches the car at the gap -- so a group the eye
 * cannot pick out is a game the player cannot read. An earlier version had no such rule and
 * spaced a cell's ranks at spacing/ranks, which made a block fill its cell exactly and left
 * a seam of identically zero at every capacity: one unbroken belt of figures.
 *
 * Both ends are read in figures, because a figure is the only length on screen the player
 * has to compare against:
 *
 * - the FLOOR is about one figure, so the break reads as a break even between two cells
 *   that happen to hold the same colour;
 * - the CEILING is a bit over one, past which the ring reads as bare track with rows on it.
 *   It replaces an old bound on cell SPACING, which said this far less directly, since what
 *   shows as emptiness is the band between rows and not the pitch of the cells.
 *
 * The ceiling is the one that does the work: it is what carries the ring to 24 cells (16 on
 * the circle), which is as tight as the boarding doorway lets the cells get. Every shape's
 * seam lands in 0.22-0.27, and the channels sit at 0.18 -- see LANE.step, which has to be
 * moved with this or the two halves of the track stop matching.
 */
export const SEAM_MIN = 0.20;
export const SEAM_MAX = 0.29;

/**
 * Boarding and entry gaps, as an ABSOLUTE arc length. It used to be half a ring slot, which
 * shrank with the ring: at 20 slots the doorway was 0.37 long and stopped reading as a
 * doorway. Must stay under ROW_SPACING_MIN so a gap never eats its neighbours, which is
 * what has walked it down from 0.55 to 0.45 to 0.38 as the cells have got shorter.
 *
 * 0.38 against a cell of 0.44-0.49 means the doorway is now most of a cell wide: about one
 * row of passengers, which is the right size for a door they leave through one row at a
 * time. It is also the thing standing between the ring and an even tighter pack -- see
 * ROW_SPACING_MIN.
 */
export const GAP_ARC = 0.38;

/**
 * A block stands `blockSpan` (0.88) across the path, so on an arc tighter than half of that
 * its inner edge would reach past the arc's own centre and turn inside out. It is a floor
 * on the shapes themselves, with margin; the seam band is the rule that actually decides
 * what a shape can carry, and it bites long before this does.
 */
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

/**
 * Where figure `i` of a ring cell's block stands, relative to the cell's own point on the
 * path: `across` along the outward normal, `along` in the direction of travel. `rankStep`
 * is fixed (BLOCK.rankStep), NOT derived from the cell's spacing: a block is the same
 * length whatever ring it stands on, and the arc left over is the seam that separates it
 * from its neighbour.
 *
 * Written into `out` rather than returned fresh: the view calls this for every visible
 * figure every frame.
 */
export function blockOffset(
    i: number, ranks: number, rankStep: number, out = { across: 0, along: 0 },
): { across: number; along: number } {
    const rank = Math.floor(i / BLOCK.across);
    // Brickwork: every other rank shifts half a step sideways, so a figure never sits
    // directly behind another. On a corner, where the ranks close up, that half step is
    // what keeps the pair apart.
    const shift = rank % 2 === 1 ? BLOCK.acrossStep / 2 : 0;
    out.across = ((i % BLOCK.across) - (BLOCK.across - 1) / 2) * BLOCK.acrossStep + shift;
    out.along = (rank - (ranks - 1) / 2) * rankStep;
    return out;
}

/**
 * The closest two figures come to each other anywhere on a full ring of `capacity` cells.
 *
 * This is the rule that decides how densely a shape may be packed. Cells are evenly spaced
 * by ARC LENGTH, but on a corner the inside of the track is shorter than the centreline,
 * so figures on the inside of a bend close up -- by a factor of (r - span/2)/r, which at
 * the tightest corner of a rounded quadrilateral is a big number. It is not something to
 * reason about in the abstract: the layout that shipped before this measured 0.005 board
 * units between two figures at the bottom-left corner of level 1, i.e. they were drawn on
 * top of each other, and no bound on cell spacing had noticed.
 *
 * Only neighbouring cells are compared. Two cells further apart than that cannot be the
 * closest pair -- their blocks would have to pass through the block between them.
 */
export function minFigureGap(shape: TrackShape, capacity: number, groupSize: number): number {
    const path = new TrackPath(shape);
    const ranks = blockRanks(groupSize);
    const rankStep = BLOCK.rankStep;
    const cells: { x: number; y: number }[][] = [];
    const pt = { x: 0, y: 0 }, nm = { x: 0, y: 0 }, off = { across: 0, along: 0 };
    for (let i = 0; i < capacity; i++) {
        const t = i / capacity;
        path.pointAt(t, pt);
        path.normalAt(t, nm);
        const block: { x: number; y: number }[] = [];
        for (let j = 0; j < groupSize; j++) {
            blockOffset(j, ranks, rankStep, off);
            block.push({
                x: pt.x + off.across * nm.x + off.along * nm.y,
                y: pt.y + off.across * nm.y - off.along * nm.x,
            });
        }
        cells.push(block);
    }
    let min = Infinity;
    for (let i = 0; i < capacity; i++) {
        const here = cells[i], next = cells[(i + 1) % capacity];
        for (let a = 0; a < here.length; a++) {
            for (let b = a + 1; b < here.length; b++) {
                min = Math.min(min, Math.hypot(here[a].x - here[b].x, here[a].y - here[b].y));
            }
            for (let b = 0; b < next.length; b++) {
                min = Math.min(min, Math.hypot(here[a].x - next[b].x, here[a].y - next[b].y));
            }
        }
    }
    return min;
}

/**
 * Ring lengths this shape can carry: long enough that the doorway does not swallow a cell,
 * leaving a seam inside the band that reads as a break but not as bare track, and -- the
 * backstop -- keeping every pair of figures apart on the tightest corner.
 *
 * The seam rule does most of the work, and it subsumes what the overlap rule used to
 * catch: once a block is shorter than its cell, the closest pair anywhere on the ring is
 * two figures INSIDE one block, at a distance the corners cannot squeeze. `minFigureGap`
 * stays because it is measured rather than argued -- a shape with a corner tighter than
 * today's would break that reasoning, and this is what would catch it.
 */
export function capacityOptions(shape: TrackShape): number[] {
    const path = new TrackPath(shape);
    const block = blockLength(GROUP_SIZE);
    return CAPACITY_OPTIONS.filter((c) => {
        const spacing = path.rowSpacing(c);
        if (spacing < ROW_SPACING_MIN) return false;
        const seam = spacing - block;
        if (seam < SEAM_MIN || seam > SEAM_MAX) return false;
        return minFigureGap(shape, c, GROUP_SIZE) >= BLOCK.clearance;
    });
}
