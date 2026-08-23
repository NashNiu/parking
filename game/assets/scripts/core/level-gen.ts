import { CAP_SIZE, Cap, CarSpec, Dir, Feed, LevelData, QueueGroup } from './types';
import { isSolvable, estimateDifficulty } from './solvability';
import { footprint, pathClear } from './move-solver';
import { TRACK_SHAPES, TrackShape } from './track-shapes';
import { capacityOptions, entryIndex } from './track-path';

/**
 * The one grid shape every level uses. Nine columns at the pitch six rows allow is what
 * fills the lot the camera frames, so the cell size — and with it the size a car is drawn
 * at — is the same on every level instead of shrinking as levels get taller. The car COUNT
 * is fixed too (see CARS_PER_LEVEL), so difficulty comes from how many colours there are
 * and how tangled the cars they are on, not from how many.
 *
 * If the camera framing changes, these change with it: see LOT_HALF_W in GameController.
 */
export const GRID_COLS = 9;
export const GRID_ROWS = 6;

/**
 * Fixed across levels: seven parking stalls, four unlocked at the start. The circuit
 * itself is the opposite of fixed now -- its shape, ring length and feeder channels are
 * a per-level property (see `trackParams`), which is the whole point of this milestone.
 */
const SLOTS = 7;
const UNLOCKED = 4;

/** Colour keys, matching the view's palette (see view/colors.ts). */
const PALETTE = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan'];

const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

/** Share of each capacity in a level's car mix. Small cars dominate; they read fastest. */
const CAP_MIX: { cap: Cap; weight: number }[] = [
    { cap: 'small', weight: 0.55 },
    { cap: 'medium', weight: 0.25 },
    { cap: 'big', weight: 0.2 },
];

/** How many placements to try for one car before giving up on it. */
const PLACE_TRIES = 40;
/** How many whole-level attempts before settling for the best one found. */
const ATTEMPTS = 200;

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
 * (level 1 once placed 6 cars in 54 cells -- 8 cells occupied, 15% of the grid). At 36
 * cars, averaging 1.3 cells each, the ten shipped levels sit at 88% of the grid: full, with
 * the handful of loose cells a player needs to see a way into it.
 *
 * 36 rather than more because the last few cells cost the most: 42 asks for 97%, and at
 * that density `pack` cannot always place them all (two of the ten seeds come up short),
 * so the level count stops being flat. Denser than that is also a worse-looking lot -- with
 * no gaps left, nothing reads as a route.
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

/**
 * A car's cells before it has an exit direction. Packing comes first and directions are
 * handed out afterwards (see `pack` and `peel`), so this is what the lot holds in between.
 */
interface Piece { x: number; y: number; w: number; h: number; cap: Cap }

/** The cells a piece covers, in `footprint`'s "col,row" form. */
function pieceCells(p: Piece): string[] {
    const cells: string[] = [];
    for (let c = p.x; c < p.x + p.w; c++) {
        for (let r = p.y; r < p.y + p.h; r++) cells.push(`${c},${r}`);
    }
    return cells;
}

/**
 * Which ways a piece is allowed to leave. A small car takes one cell and may go any way;
 * anything bigger takes two cells, and those two must run ALONG the way it leaves, so its
 * SHAPE decides its direction rather than the other way round.
 *
 * That coupling is not cosmetic. The view lays a car's model down the longer axis of its
 * footprint and cannot turn it across (it would overflow the cell), so a 2x1 car told to
 * exit upwards gets drawn pointing sideways and its roof arrow then contradicts where it
 * actually goes — a player reads the arrow, taps, and nothing happens. Longer than two
 * cells is no good either: buildCar scales models uniformly, bounded by the SHORT axis, so
 * a three-cell footprint just leaves the car rattling around inside it.
 */
function dirsFor(p: Piece): Dir[] {
    if (p.w === p.h) return DIRS;
    return p.w > p.h ? ['left', 'right'] : ['up', 'down'];
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
        grid: { cols: GRID_COLS, rows: GRID_ROWS, cars },
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
 * Fill the lot with `want` pieces, or with as many as fit. Shapes only -- no directions,
 * no colours: those are `peel`'s and `scatter`'s business.
 *
 * Packing first is what lets the lot be FULL. The generator used to place a whole car,
 * direction and all, and require its exit path be clear of the cars already down, which
 * kept every layout solvable but could not pack past about three quarters of the grid: the
 * clear-path rule rejects most of the remaining room once the lot is dense.
 */
function pack(rng: () => number, want: number): Piece[] {
    const pieces: Piece[] = [];
    const taken = new Set<string>();
    for (let i = 0; i < want; i++) {
        const cap = pickCap(rng);
        // Orientation, not direction: `dirsFor` reads it back out when the peel hands this
        // piece a way to leave, so choosing it here is choosing between up/down and
        // left/right later.
        const upright = rng() < 0.5;
        const w = cap === 'small' ? 1 : (upright ? 1 : 2);
        const h = cap === 'small' ? 1 : (upright ? 2 : 1);
        for (let t = 0; t < PLACE_TRIES; t++) {
            const piece: Piece = {
                x: Math.floor(rng() * (GRID_COLS - w + 1)),
                y: Math.floor(rng() * (GRID_ROWS - h + 1)),
                w, h, cap,
            };
            const cells = pieceCells(piece);
            if (cells.some((c) => taken.has(c))) continue;
            for (const c of cells) taken.add(c);
            pieces.push(piece);
            break;
        }
    }
    return pieces;
}

/**
 * Hand every piece an exit direction, in the order the cars will LEAVE.
 *
 * At each step a piece may be taken if some legal direction gives it a clear lane to the
 * edge past the pieces still on the grid. Whichever is taken is removed, which frees its
 * cells for the next step. So the returned order is, by construction, a valid solution to
 * the level: at the moment car k leaves, the cars still parked are exactly the ones that
 * were still on the grid when its lane was checked.
 *
 * What it does NOT do is make the level easy. Only the first car out is guaranteed to have
 * a clear lane at the start; everything after it is typically blocked by cars that were
 * peeled earlier, which is where the tangle comes from. `estimateDifficulty` measures how
 * much of it a given attempt got.
 *
 * A stuck peel drops the pieces it could not take. That leaves holes in the lot rather
 * than an unsolvable level, and it is why `generateLevel` still checks the car count.
 */
function peel(rng: () => number, pieces: Piece[]): { piece: Piece; dir: Dir }[] {
    const remaining = pieces.slice();
    const occupied = new Set<string>(pieces.flatMap(pieceCells));
    const order: { piece: Piece; dir: Dir }[] = [];
    while (remaining.length > 0) {
        const moves: { i: number; dir: Dir }[] = [];
        for (let i = 0; i < remaining.length; i++) {
            const piece = remaining[i];
            for (const dir of dirsFor(piece)) {
                // pathClear never looks at a car's own cells, so the id and colour here
                // are placeholders it cannot read.
                const probe: CarSpec = { ...piece, id: 0, dir, color: '' };
                if (pathClear(probe, occupied, GRID_COLS, GRID_ROWS)) moves.push({ i, dir });
            }
        }
        if (moves.length === 0) break;
        const move = pick(rng, moves);
        const piece = remaining.splice(move.i, 1)[0];
        for (const c of pieceCells(piece)) occupied.delete(c);
        order.push({ piece, dir: move.dir });
    }
    return order;
}

/**
 * One attempt at a level's cars: pack the lot, work out an order they can leave in, then
 * paint them. Colours go round-robin over the leaving order so no colour dominates and no
 * colour is confined to one corner.
 */
function scatter(rng: () => number, p: GenParams): CarSpec[] {
    return peel(rng, pack(rng, p.cars)).map(({ piece, dir }, i) => ({
        id: i + 1,
        x: piece.x, y: piece.y, w: piece.w, h: piece.h,
        dir,
        color: PALETTE[i % p.colors],
        cap: piece.cap,
    }));
}

/**
 * Drop cars until the grid clears. Exitability only ever improves as cars leave, so this
 * terminates — an empty grid is trivially solvable. It is the safety net for a seed whose
 * every attempt tangled: better a level one car short than an unsolvable one.
 */
function repair(id: number, cars: CarSpec[]): CarSpec[] {
    const kept = cars.slice();
    while (kept.length > 0 && !isSolvable(assemble(id, kept))) kept.pop();
    return kept;
}

/**
 * A level for `id`: deterministic, colour-balanced by construction (the passenger queue is
 * derived from the cars, so `validateLevel` cannot fail), grid-solvable, and as close to
 * the curve's blocking target as 200 attempts get.
 *
 * Note the guarantee is about the GRID: every car can be driven out in some order. Whether
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
