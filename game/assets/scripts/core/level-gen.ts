import { inflate, obbCorners, overlapMTV, OBB } from './geometry';
import {
    CAP_BOX, CAP_SIZE, CAR_SCALE, Cap, CarSpec, CLEARANCE, Feed, LevelData, Lot, QueueGroup,
} from './types';
import { isSolvable, estimateDifficulty } from './solvability';
import { pathClear } from './move-solver';
import { TRACK_SHAPES, TrackShape } from './track-shapes';
import { capacityOptions, entryIndex } from './track-path';

/**
 * Fixed across levels: seven parking stalls, four unlocked at the start. The circuit
 * itself is the opposite of fixed now -- its shape, ring length and feeder channels are
 * a per-level property (see `trackParams`), which is the whole point of this milestone.
 */
const SLOTS = 7;
const UNLOCKED = 4;

/** Colour keys, matching the view's palette (see view/colors.ts). */
const PALETTE = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan'];

/**
 * The lot, in board units.
 *
 * 7 x 8, PORTRAIT, and the shape is the whole point: it is what the cars are drawn at.
 * The board is framed by its WIDTH (see `viewFrame` in GameController), so a phone's
 * spare height is only worth anything to a lot that is willing to use it. Measured on a
 * 1170x2532 phone, against the 9 x 6 this replaces: the cars draw 31% bigger and the
 * blank band above and below the board falls from 42% of the screen to 23%. The area is
 * all but identical (56 square units against 54), so the density the numbers below were
 * tuned against carries over -- this is a re-proportioning, not a bigger car park.
 *
 * The cost lands on the editor preview window, whose 0.79 aspect makes this lot
 * HEIGHT-bound: cars draw 25% smaller there than they did, and the slab is widened past
 * what they need. Set the preview to a phone resolution and the two agree again. A squat
 * window is no longer a fair picture of the game.
 *
 * 36 cars drawn from CAP_MIX would cover 26.7 of these 56 square units on paper; the
 * shipped levels carry rather less, because the packer's own success filter reshapes the
 * mix -- an attempt heavy in big bodies is likelier to fail to settle, so what survives
 * skews small. Either number is a comfortable target for random rotated rectangles. The
 * old grid's "88% occupied" counted CELLS CLAIMED, and the difference between that and
 * this is exactly the ring of side air a square cell left around an oblong car.
 *
 * Both dimensions have to clear the longest body (CAP_BOX.big at 1.949) with room for it
 * to turn, which 7 does with 3.6x over.
 */
export const LOT: Lot = { w: 7, h: 8 };

/** Share of each capacity in a level's car mix. Small cars dominate; they read fastest. */
const CAP_MIX: { cap: Cap; weight: number }[] = [
    { cap: 'small', weight: 0.55 },
    { cap: 'medium', weight: 0.25 },
    { cap: 'big', weight: 0.2 },
];

/** How many whole-level attempts before settling for the best one found. */
const ATTEMPTS = 200;
/** Relaxation passes before an attempt is written off. */
const RELAX_ITERS = 60;
/** Share of cars whose angle is snapped to a right angle. See `pack`. */
const SNAP_SHARE = 0.25;

/**
 * Below this, a residual `overlapMTV` reading is floating-point noise from a pair the
 * relaxation already settled, not a real overlap still to resolve.
 *
 * Without this floor, no attempt can ever settle: a pair that has converged to within a
 * few ULPs of touching keeps reporting a non-null MTV
 * (SAT's `<=` test almost never lands on an exact tie), and the push it computes --
 * half that residual -- is smaller than the position's own floating-point precision at
 * board-unit magnitudes, so `+=` silently does nothing. `moved` then never goes false,
 * so the loop runs out its RELAX_ITERS and the attempt is written off -- it cannot hang,
 * it just burns every iteration on a pair that was, physically, already done.
 * 1e-9 sits far above the noise this is built to catch (observed around 1e-15) and far
 * below CLEARANCE (0.04), so it cannot paper over an overlap the game would show.
 */
const SETTLED_GAP = 1e-9;

/**
 * Slack the packer keeps on top of its half-clearance, to survive `round4`.
 *
 * The relaxation's fixed point is pairs at almost exactly touching -- push a pair apart,
 * its neighbours push it back, and a dense lot settles with several pairs flush to within
 * floating-point noise. `scatter` then rounds every centre to four places, moving each by
 * up to 5e-5 per axis, so a flush pair can drift up to ~1.4e-4 closer. Without this
 * margin those pairs land just under the clearance and `validateLevel` throws the whole
 * attempt away: measured, 30 of the 35 fully-packed attempts for level 1 and 41 of 43 for
 * level 2, leaving the difficulty search an effective pool of 5 and 2 out of ATTEMPTS.
 *
 * The wall rule never had this problem because `clampInside` clamps the INFLATED box, so
 * it already leaves half a clearance of margin against the lot edge. This gives the
 * pairwise rule the equivalent. 1.5e-4 covers the worst rounding drift with room to spare
 * and is three hundred times smaller than CLEARANCE, so it cannot hide a real gap.
 */
const ROUND_MARGIN = 1.5e-4;

/** What the curve asks of a level. Every field is non-decreasing in the level id. */
export interface GenParams {
    /** Cars to place. Flat across levels; see CARS_PER_LEVEL. */
    cars: number;
    colors: number;
    /** Share of cars that should start with their exit blocked — the puzzle itself. */
    blockedRatio: number;
    /** Rounds the greedy solver should need; more rounds means more layered blocking. */
    minRounds: number;
}

/**
 * Cars per level, the same on EVERY level: the lot is meant to read as a full car park, and
 * a count that ramped with the level id left the early ones looking like an empty one
 * (level 1 once placed 6 cars, covering 15% of the lot -- an empty car park). At 36 cars
 * the bodies cover just under half the lot's 56 square units, and with the clearance band
 * each one owes its neighbours the packer is working at about 55%: full, with the loose
 * board a player needs to see a way into it.
 *
 * 36 rather than more because the last few cars cost the most. Random rotated rectangles
 * stop separating reliably somewhere past this, and an attempt that cannot separate them
 * is a wasted attempt (see `pack`), so the count stops being flat. Denser is also a
 * worse-looking lot -- with no gaps left, nothing reads as a route.
 *
 * Passengers are the other ceiling: 36 cars run 670-770 of them, which at GROUP_SIZE (8) a
 * tick is about 90 ticks of boarding, half a minute. The generator's tests hold it to 900.
 */
const CARS_PER_LEVEL = 36;

/**
 * How far off the blocked-car target a level may land and still count as on target.
 *
 * Back to 1, re-measured for free-angle exits. It was widened to 3 in the grid era because
 * a full 24-car lot left 11-20 cars blocked no matter what, so the level-to-level bands
 * overlapped and the target could not actually set the number. With the band re-measured
 * onto the range the geometry produces (see levelParams), all ten levels hit within 1 --
 * and tightening it visibly straightens the ramp: at 3 the difficulty score rose on 3 of
 * its 9 steps, at 1 it rises on 6, and level 5 stops coming out easier than level 1.
 *
 * Kept as one constant so the generator and the offline tool's "on target" column cannot
 * disagree about what on target means.
 */
export const BLOCKED_TOLERANCE = 1;

/**
 * The difficulty curve. Car count is flat (see CARS_PER_LEVEL), so a later level is harder
 * by being more tangled and more colourful, never by being bigger.
 *
 * The blocked band is MEASURED, and re-measured for free-angle exits. A diagonal lane is a
 * diagonal swath and clips more cars than a straight column, so the whole distribution sits
 * higher than it did on the grid. The grid-era band asked for 18 rising to 26, which spent
 * its bottom third on targets the geometry cannot reach -- levels 1 to 3 landed one to three
 * cars ABOVE their target and counted as on-target only because BLOCKED_TOLERANCE was 3. The
 * curve was not setting the number; it was being overruled by whatever the packer produced.
 *
 * Be careful what the measurement can and cannot say, because the obvious reading of it is
 * circular. Sampling sixty levels gives blocked counts of 21 to 30 with median 27 -- but the
 * generator ACCEPTS a candidate only inside the window the old band already defined, so for
 * ids 11 and up (old target 27, old tolerance 3) the observed 24..30 is exactly that window's
 * edges, not the geometry's. What survives the censoring is the SHAPE inside the window (the
 * generator takes the first hit, so it does not bias within it) and the floor of 21, which
 * came from ids 1-10 whose old windows reached down to 15 and so was not clipped.
 *
 * 0.78 is the measured upper quartile. 0.61 is NOT a quartile -- the quartiles are about 0.70
 * to 0.78, and a band that narrow is barely a ramp, so the low end is set at the observed
 * floor instead. The cost is real and named: level 1's target of 22 sits at the very edge of
 * what the packer produces, eight of the ten levels land at or above their target, and a
 * future geometry change that lifts the floor by two cars breaks ids 1 to 3. What makes that
 * acceptable is that it breaks LOUDLY -- `the curve actually sets the blocked-car count`
 * fails the moment it happens.
 *
 * `minRounds` IS re-measured, because its trigger fired: the ten levels' solver rounds run 6
 * to 12, median 9, all of them at or above the old cap of 5. That cap binds from id 13
 * (`2 + floor(12/3)` is 6), not from id 10 where the raw formula already gives 5 -- so
 * raising it to the measured median changes nothing for the shipped ten and only stops the
 * endless tail asking for fewer rounds than the geometry comfortably supports.
 *
 * BLOCKED_FIRST and BLOCKED_LAST below are the level-1 and level-10 targets as a share of
 * the lot; everything above is why they are those numbers.
 */
const BLOCKED_FIRST = 0.61;
const BLOCKED_LAST = 0.78;

export function levelParams(id: number): GenParams {
    // Linear from first to last across the authored ten, then held. The old curve stepped by
    // a flat 0.025 per level and capped, which put the same value on ids 11 and 111; this
    // says the same thing without pretending the ramp continues.
    const t = Math.min(1, Math.max(0, (id - 1) / 9));
    return {
        cars: CARS_PER_LEVEL,
        // The colour count IS the difficulty, and it is the only knob here that is. Measured
        // by playing every shipped level with a careless policy -- fill every free stall with
        // whatever can move, every tick -- at 4 open stalls, 8 seeds, with the cars recoloured
        // and the queue rebuilt from their capacities so the level stays winnable in
        // principle. Loss rate against colour count:
        //
        //     colours   2      3      4      5      6
        //     level 1   0%     0%     0%    38%    13%
        //     level 3   0%    50%    50%   100%   100%
        //     level 6   0%     0%    38%    75%    75%
        //     level 9  50%    63%    75%   100%   100%
        //
        // At 2 and 3 colours a careless player simply cannot lose most levels, which is what
        // "there is no difficulty" meant. The old ramp spent ids 1-3 on 2 colours and never
        // passed 5, so seven of the ten levels sat in the flat part of that table.
        //
        // What makes the steeper ramp FAIR rather than just harsher: a careful policy --
        // bring a car out only when the ring is carrying a lot of its colour and it is not
        // already parked, and keep one stall spare -- wins all ten levels at every count from
        // 2 to 6, at 4 open stalls, with nothing unlocked. The difficulty is in the choosing,
        // not in the dice.
        //
        // Level 1 stays at 2 colours deliberately: it is the level that teaches what a colour
        // match is, and the table says it is the one level where 2 colours costs nothing.
        // Level 2 is already at 3.
        //
        // 6 is the ceiling because PALETTE has six entries and the view has exactly those six
        // in `colors.ts`. A seventh would draw grey (see `colorOf`).
        colors: Math.min(6, 2 + Math.floor(id / 2)),
        blockedRatio: BLOCKED_FIRST + (BLOCKED_LAST - BLOCKED_FIRST) * t,
        minRounds: Math.min(9, 2 + Math.floor((id - 1) / 3)),
    };
}

/** The track knobs for one level: shape, ring length, and its feeder channels. */
export interface TrackParams {
    track: TrackShape;
    capacity: number;
    feeds: Feed[];
}

const TWIN: Feed[] = [{ side: 'far', lookahead: 5 }, { side: 'near', lookahead: 5 }];

/**
 * The track curve, one row per level.
 *
 * The three knobs collapse into one number — the PLANNING WINDOW, in ticks: how long a
 * player has between first seeing a batch of colours and that batch reaching the boarding
 * gap. It is the drawn waiting batches plus the ticks from the channel's entry to the
 * gap, and `planningWindow` computes it. Twin-channel levels have two values: the far
 * channel drains first, so they open wide and tighten when the near one takes over.
 *
 * Level 7 dips on purpose — a single far channel, constant and roomy. It is a breather,
 * and the first level where the player sees a track fed from one side only.
 *
 * Ring length is NOT one of the knobs any more. A shape's perimeter decides what it can
 * carry (see capacityOptions, and the seam rule behind it), and that comes out at exactly
 * one length per shape: 28 for the four quadrilaterals, 24 for the circle, whose perimeter
 * is 75% of theirs. So the curve turns the two knobs it still has -- how many batches a
 * channel shows, and whether there are two channels or one.
 */
const TRACK_CURVE: TrackParams[] = [
    { track: 'rect',   capacity: 28, feeds: TWIN },
    { track: 'hex',    capacity: 28, feeds: TWIN },
    { track: 'trap',   capacity: 28, feeds: [{ side: 'far', lookahead: 5 }, { side: 'near', lookahead: 4 }] },
    { track: 'oval',   capacity: 28, feeds: [{ side: 'far', lookahead: 5 }, { side: 'near', lookahead: 4 }] },
    { track: 'rect',   capacity: 28, feeds: [{ side: 'far', lookahead: 4 }, { side: 'near', lookahead: 4 }] },
    { track: 'hex',    capacity: 28, feeds: [{ side: 'far', lookahead: 4 }, { side: 'near', lookahead: 3 }] },
    { track: 'trap',   capacity: 28, feeds: [{ side: 'far', lookahead: 4 }] },
    { track: 'oval',   capacity: 28, feeds: [{ side: 'far', lookahead: 3 }, { side: 'near', lookahead: 3 }] },
    { track: 'circle', capacity: 24, feeds: [{ side: 'near', lookahead: 4 }] },
    { track: 'circle', capacity: 24, feeds: [{ side: 'near', lookahead: 3 }] },
];

/**
 * Ticks of warning each channel gives, in drain order. The ring steps one index per
 * tick, so a row entering at index e reaches the gap in (board - e) mod capacity ticks.
 */
export function planningWindow(p: TrackParams): number[] {
    const board = p.capacity / 2;
    return p.feeds.map((f) => {
        const entry = entryIndex(p.capacity, board, f.side);
        return f.lookahead + ((board - entry + p.capacity) % p.capacity);
    });
}

/**
 * Track knobs for `id`. Past the authored table the difficulty holds at the last row's
 * and only the shape rotates, among those that can carry that ring length — endless
 * levels stay legal and stay visually varied without inventing a curve nobody tuned.
 */
export function trackParams(id: number): TrackParams {
    // Normalise first: the id reaches here from callers that only promise "a level number",
    // and both a fractional id (fractional array index -> undefined) and a non-positive one
    // (JS % keeps the sign, so fits[-1] is undefined) would otherwise hand back a row with
    // no track at all -- which buildShape, having no default branch, cannot draw.
    const n = Math.max(1, Math.floor(id));
    if (n <= TRACK_CURVE.length) return TRACK_CURVE[n - 1];
    const tail = TRACK_CURVE[TRACK_CURVE.length - 1];
    const track = TRACK_SHAPES[(n - 1) % TRACK_SHAPES.length];
    // The tail's ring length is the shortest there is, and only the circle can carry it,
    // so a shape cannot simply inherit it -- filtering the shapes down to the ones that
    // can would leave every endless level a circle. Each shape takes the shortest ring IT
    // can carry instead, which keeps the tail's intent (a tight ring) and keeps the look
    // rotating. `options` is never empty for the five shapes that exist; the fallback is
    // for a future shape whose perimeter fits no legal length at all.
    const options = capacityOptions(track);
    if (options.length === 0) return { ...tail };
    const capacity = options.includes(tail.capacity) ? tail.capacity : Math.min(...options);
    return { ...tail, track, capacity };
}

/** mulberry32: a small deterministic PRNG, so a level id always yields the same level. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(rng: () => number, items: T[]): T {
    return items[Math.floor(rng() * items.length) % items.length];
}

/** Capacity for one car, drawn from CAP_MIX. */
function pickCap(rng: () => number): Cap {
    let r = rng();
    for (const { cap, weight } of CAP_MIX) {
        if (r < weight) return cap;
        r -= weight;
    }
    return CAP_MIX[CAP_MIX.length - 1].cap;
}

/** A car's placement before it has been told which way along its body it leaves. */
interface Piece { x: number; y: number; angle: number; cap: Cap }

/** The body a piece occupies. */
function pieceBox(p: Piece): OBB {
    const b = CAP_BOX[p.cap];
    return { x: p.x, y: p.y, angle: p.angle, len: b.len * CAR_SCALE, wid: b.wid * CAR_SCALE };
}

/**
 * The box the packer keeps clear. Half the clearance on each of a pair, so two
 * settled pieces owe each other the full CLEARANCE -- the same arithmetic
 * `validateLevel` uses, so the packer cannot settle on something the check rejects.
 */
function packBox(p: Piece): OBB {
    return inflate(pieceBox(p), CLEARANCE / 2 + ROUND_MARGIN);
}

/** Slide a piece until its box is back inside the lot. Mutates it. */
function clampInside(p: Piece): void {
    const hw = LOT.w / 2;
    const hh = LOT.h / 2;
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const [x, y] of obbCorners(packBox(p))) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    if (minX < -hw) p.x += -hw - minX;
    if (maxX > hw) p.x -= maxX - hw;
    if (minY < -hh) p.y += -hh - minY;
    if (maxY > hh) p.y -= maxY - hh;
}

/** Passenger queue implied by the cars: per colour, exactly the seats that colour offers. */
function queueFor(cars: CarSpec[]): QueueGroup[] {
    const seats = new Map<string, number>();
    for (const car of cars) {
        seats.set(car.color, (seats.get(car.color) ?? 0) + CAP_SIZE[car.cap]);
    }
    // Palette order, so the file reads consistently; the loop shuffles the ring anyway.
    return PALETTE.filter((c) => seats.has(c)).map((color) => ({
        color, count: seats.get(color) as number,
    }));
}

function assemble(id: number, cars: CarSpec[]): LevelData {
    const track = trackParams(id);
    return {
        id,
        lot: { w: LOT.w, h: LOT.h, cars },
        parking: { slots: SLOTS, unlocked: UNLOCKED },
        loop: {
            capacity: track.capacity,
            boardIndex: track.capacity / 2,
            track: track.track,
            feeds: track.feeds,
            queue: queueFor(cars),
        },
        powerups: { refresh: 3, hardClear: 1, magnet: 1 },
    };
}

/**
 * Fill the lot with `want` pieces, or return nothing at all.
 *
 * Scatter first and separate afterwards, rather than rejecting overlapping
 * placements. Reject-sampling is what the grid version did and it worked there only
 * because integer cells never overlap; with free angles the late placements are
 * rejected almost every time and the lot comes up six or eight cars short. Pushing
 * overlapping pairs apart along their minimum translation vector is about thirty
 * lines and is the difference between seating 36 and seating 28.
 *
 * Big bodies come first in the list, which is NOT the head start it looks like: every
 * piece is scattered before any relaxation runs, so nobody gets an emptier board than
 * anybody else. What the sort actually decides is which rng draws map to which capacity,
 * and the `i < j` order the separation sweep walks pairs in -- which biases who gets
 * clamped against a wall when a chain of pushes reaches one. The head-start reading is a
 * leftover from the reject-sampling version this replaced, where placement order was
 * load-bearing.
 *
 * A quarter of the angles snap to a right angle. Uniformly random angles read as
 * uniform noise -- the reference the design came from has a tidy outer band, and
 * without some axis-aligned cars the eye has nothing to hold on to.
 *
 * Each overlapping pair is pushed apart by the FULL minimum translation vector on
 * EACH side, not split in half between them. `overlapMTV` already reports the least
 * shove that clears just one of the two, so moving both by that much is a two-times
 * over-correction for an isolated pair -- deliberate, because no pair here is
 * isolated. With 36 bodies started from a uniform scatter almost every pair overlaps
 * something at iteration zero, and a single push only ever nets out a fraction of
 * its intended distance once the other overlaps sharing that piece pull it back the
 * other way in the same sweep. Under-correcting by half compounds that into a
 * relaxation so slow it does not finish within any RELAX_ITERS this generator can
 * afford -- measured at needing thousands of passes, not sixty, to seat all 36.
 * Over-correcting instead converges in tens of passes AND leaves fewer residual
 * pairs for the next sweep to chase, which is why it is also faster, not just
 * capable: measured success at RELAX_ITERS=60 went from 0/30 to 20/30.
 */
function pack(rng: () => number, want: number): Piece[] {
    const caps: Cap[] = [];
    for (let i = 0; i < want; i++) caps.push(pickCap(rng));
    caps.sort((a, b) => CAP_BOX[b].len - CAP_BOX[a].len);

    const pieces: Piece[] = caps.map((cap) => {
        let angle = rng() * 360;
        if (rng() < SNAP_SHARE) angle = Math.round(angle / 90) * 90;
        const p: Piece = { x: (rng() - 0.5) * LOT.w, y: (rng() - 0.5) * LOT.h, angle, cap };
        clampInside(p);
        return p;
    });

    for (let iter = 0; iter < RELAX_ITERS; iter++) {
        let moved = false;
        for (let i = 0; i < pieces.length; i++) {
            for (let j = i + 1; j < pieces.length; j++) {
                const mtv = overlapMTV(packBox(pieces[i]), packBox(pieces[j]));
                if (!mtv || Math.hypot(mtv.x, mtv.y) < SETTLED_GAP) continue;
                moved = true;
                pieces[i].x += mtv.x;
                pieces[i].y += mtv.y;
                pieces[j].x -= mtv.x;
                pieces[j].y -= mtv.y;
                clampInside(pieces[i]);
                clampInside(pieces[j]);
            }
        }
        if (!moved) return pieces;
    }
    // Never settled. Better a failed attempt than a lot with cars inside each other.
    return [];
}

/**
 * The two ways a piece may leave: nose first, or backing out. Its placement IS its
 * body axis, so there is nothing else on offer -- the direct analogue of the old
 * `dirsFor`, which gave a 2x1 piece left and right for the same reason.
 *
 * Flipping the heading does not move the piece: a rectangle turned a half turn covers
 * the same board. That is what lets the packer commit to a placement and still leave
 * the peel a choice.
 */
function headingsFor(p: Piece): number[] {
    return [p.angle, p.angle + 180];
}

/**
 * Hand every piece a heading, in the order the cars will LEAVE. Unchanged in shape
 * from the grid version: a piece may be taken when some legal heading gives it a clear
 * lane past the pieces still down, and whichever is taken frees its space for the next
 * step -- so the returned order is a valid solution by construction: at the moment car
 * k leaves, the cars still parked are exactly the ones that were still down when its
 * lane was checked.
 *
 * Each blocker is probed at its OWN angle while the mover is probed at that angle or
 * that angle plus 180. Those two agree because a rectangle is identical under a half
 * turn, so the box a blocker presents is the same whichever of its two headings it is
 * eventually handed -- which is exactly what makes this occupancy model the same one
 * `isSolvable` will later apply to the finished level.
 *
 * What it does NOT do is make the level easy. Only the first car out is guaranteed to have
 * a clear lane at the start; everything after it is typically blocked by cars that were
 * peeled earlier, which is where the tangle comes from. `estimateDifficulty` measures how
 * much of it a given attempt got.
 *
 * A stuck peel drops the pieces it could not take. That leaves holes in the lot rather
 * than an unsolvable level, and it is why `generateLevel` still checks the car count.
 */
function peel(rng: () => number, pieces: Piece[]): { piece: Piece; angle: number }[] {
    const remaining = pieces.slice();
    const order: { piece: Piece; angle: number }[] = [];
    while (remaining.length > 0) {
        // Probe cars, one per remaining piece, with ids so pathClear can skip the mover.
        const probes: CarSpec[] = remaining.map((p, i) => ({
            id: i + 1, x: p.x, y: p.y, angle: p.angle, color: '', cap: p.cap,
        }));
        const moves: { i: number; angle: number }[] = [];
        for (let i = 0; i < remaining.length; i++) {
            for (const angle of headingsFor(remaining[i])) {
                if (pathClear({ ...probes[i], angle }, probes, LOT)) moves.push({ i, angle });
            }
        }
        if (moves.length === 0) break;
        const move = pick(rng, moves);
        order.push({ piece: remaining.splice(move.i, 1)[0], angle: move.angle });
    }
    return order;
}

/** Board coordinates and angles, at the precision the level files carry. */
function round4(n: number): number {
    return Math.round(n * 1e4) / 1e4;
}

/**
 * One attempt at a level's cars: pack the lot, work out an order they can leave in, then
 * paint them. Colours go round-robin over the leaving order so no colour dominates and no
 * colour is confined to one corner.
 *
 * Rounding happens HERE, before anything validates or solves these cars, so the numbers
 * checked are the numbers written -- a ten-thousandth is small, but the clearance it is
 * measured against is only 0.04.
 */
function scatter(rng: () => number, p: GenParams): CarSpec[] {
    return peel(rng, pack(rng, p.cars)).map(({ piece, angle }, i) => ({
        id: i + 1,
        x: round4(piece.x),
        y: round4(piece.y),
        // Normalise, round, then normalise ONCE more. The trailing modulo is what stops a
        // snapped 359.99996 rounding up to a flat 360, which is outside the [0, 360) the
        // level format promises -- and 360 % 360 is 0, so it lands where it should.
        //
        // The order matters both ways round. Rounding first and normalising after does fix
        // the 360, but the modulo arithmetic then runs ON the rounded value and floating
        // point does not preserve it: 51.3633 comes back as 51.36329999999998, and two
        // thirds of the shipped angles grew tails like that. A value already inside
        // [0, 360) is returned exactly by `% 360`, so doing it last costs nothing.
        angle: round4(((angle % 360) + 360) % 360) % 360,
        color: PALETTE[i % p.colors],
        cap: piece.cap,
    }));
}

/**
 * Drop cars until the lot clears. Exitability only ever improves as cars leave, so this
 * terminates — an empty lot is trivially solvable. It is the safety net for a seed whose
 * every attempt tangled: better a level one car short than an unsolvable one.
 */
function repair(id: number, cars: CarSpec[]): CarSpec[] {
    const kept = cars.slice();
    while (kept.length > 0 && !isSolvable(assemble(id, kept))) kept.pop();
    return kept;
}

/**
 * A level for `id`: deterministic, colour-balanced by construction (the passenger queue is
 * derived from the cars, so `validateLevel` cannot fail), solvable, and as close to the
 * curve's blocking target as 200 attempts get.
 *
 * Note the guarantee is about the LOT: every car can be driven out in some order. Whether
 * a player wins also depends on which colours they park against the incoming queue, which
 * is their decision and is what deadlock detection is for.
 */
export function generateLevel(id: number): LevelData {
    const p = levelParams(id);
    const wantBlocked = Math.round(p.blockedRatio * p.cars);
    let best: { cars: CarSpec[]; miss: number } | null = null;

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        // Seeded from the id, so the same id walks the same attempts in the same order.
        const cars = scatter(mulberry32(id * 7919 + attempt), p);
        if (cars.length < p.cars) continue;      // could not place them all
        const level = assemble(id, cars);
        if (!isSolvable(level)) continue;
        const d = estimateDifficulty(level);
        if (Math.abs(d.blocked - wantBlocked) <= BLOCKED_TOLERANCE && d.rounds >= p.minRounds) {
            return level;
        }
        // Keep the nearest miss: distance in blocked cars, then in rounds.
        const miss = Math.abs(d.blocked - wantBlocked) + Math.max(0, p.minRounds - d.rounds);
        if (!best || miss < best.miss) best = { cars, miss };
    }
    return assemble(id, best ? best.cars : repair(id, scatter(mulberry32(id * 7919), p)));
}
