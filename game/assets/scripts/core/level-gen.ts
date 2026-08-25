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
 * The lot, in board units -- one unit is the pitch the old 9x6 grid used, so the
 * camera framing and the view's board scale are untouched by this milestone.
 *
 * 36 cars at CAP_BOX cover 26.7 of these 54 square units, just under half. That is a
 * comfortable target for random rotated rectangles; the old grid's "88% occupied"
 * counted CELLS CLAIMED, and the difference between the two numbers is exactly the
 * ring of side air a square cell left around an oblong car.
 *
 * If the camera framing changes, this changes with it: see LOT_HALF_W in GameController.
 */
export const LOT: Lot = { w: 9, h: 6 };

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
 * Without this floor, `pack` can get stuck forever regardless of RELAX_ITERS: a pair
 * that has converged to within a few ULPs of touching keeps reporting a non-null MTV
 * (SAT's `<=` test almost never lands on an exact tie), and the push it computes --
 * half that residual -- is smaller than the position's own floating-point precision at
 * board-unit magnitudes, so `+=` silently does nothing. `moved` then never goes false
 * and the loop burns every iteration on a pair that was, physically, already done.
 * 1e-9 sits far above the noise this is built to catch (observed around 1e-15) and far
 * below CLEARANCE (0.04), so it cannot paper over an overlap the game would show.
 */
const SETTLED_GAP = 1e-9;

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
 * the bodies cover just under half the lot's 54 square units, and with the clearance band
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
 * Wider than the 1 it used to be, because a full lot takes this knob away: at 24 cars
 * 11-20 of them start blocked no matter what, so the level-to-level bands overlap and
 * `blockedRatio` can only pick the more or less tangled of the few solvable candidates it
 * gets, not set the number. Kept as one constant so the generator and the offline tool's
 * "on target" column cannot disagree about what on target means.
 */
export const BLOCKED_TOLERANCE = 3;

/**
 * The difficulty curve. Car count is flat (see CARS_PER_LEVEL), so a later level is harder
 * by being more tangled and more colourful, never by being bigger. blockedRatio starts at
 * 0.5 because that is roughly where a solvable 24-car scatter already sits -- asking for
 * the old 0.1 would have made every level a nearest miss.
 */
export function levelParams(id: number): GenParams {
    return {
        cars: CARS_PER_LEVEL,
        colors: Math.min(5, 2 + Math.floor((id - 1) / 3)),
        blockedRatio: Math.min(0.75, 0.5 + (id - 1) * 0.025),
        minRounds: Math.min(5, 2 + Math.floor((id - 1) / 3)),
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
    return inflate(pieceBox(p), CLEARANCE / 2);
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
 * Big bodies are placed first, so the hardest ones get the emptiest board.
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
        angle: round4(((angle % 360) + 360) % 360),
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
