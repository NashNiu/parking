import { CAP_SIZE, Cap, CarSpec, Dir, Feed, LevelData, QueueGroup } from './types';
import { isSolvable, estimateDifficulty } from './solvability';
import { footprint } from './move-solver';
import { TRACK_SHAPES, TrackShape } from './track-shapes';
import { capacityOptions, entryIndex } from './track-path';

/**
 * The one grid shape every level uses. Nine columns at the pitch six rows allow is what
 * fills the lot the camera frames, so the cell size — and with it the size a car is drawn
 * at — is the same on every level instead of shrinking as levels get taller. Difficulty
 * comes from how many cars, how many colours and how tangled they are.
 *
 * If the camera framing changes, these change with it: see LOT_HALF_W in GameController.
 */
export const GRID_COLS = 9;
export const GRID_ROWS = 6;

/** Fixed across levels: the view draws seven stalls and a twelve-row circuit. */
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
    /** Cars to place. Capped because a car is 16-32 passengers and they board 4 a tick. */
    cars: number;
    colors: number;
    /** Share of cars that should start with their exit blocked — the puzzle itself. */
    blockedRatio: number;
    /** Rounds the greedy solver should need; more rounds means more layered blocking. */
    minRounds: number;
}

/**
 * The difficulty curve. Passenger count is the real ceiling on car count: 16 cars average
 * about 350 passengers, which at 4 boarding a tick is over a minute of play, so the car
 * count stops there and later levels get harder by tangling rather than by growing.
 */
export function levelParams(id: number): GenParams {
    return {
        cars: Math.min(16, 5 + Math.round(id * 1.1)),
        colors: Math.min(5, 2 + Math.floor((id - 1) / 3)),
        blockedRatio: Math.min(0.55, 0.1 + (id - 1) * 0.05),
        minRounds: Math.min(5, 2 + Math.floor((id - 1) / 3)),
    };
}

/** The track knobs for one level: shape, ring length, and its feeder channels. */
export interface TrackParams {
    track: TrackShape;
    capacity: number;
    feeds: Feed[];
}

const TWIN: Feed[] = [{ side: 'far', lookahead: 3 }, { side: 'near', lookahead: 3 }];

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
 * Shapes are not free choices: a shape's perimeter decides which ring lengths it can
 * carry at a legible row spacing (see capacityOptions), so the circle — half the
 * quadrilateral's perimeter, because it is bounded by the vertical budget — only ever
 * appears at 8 slots.
 */
const TRACK_CURVE: TrackParams[] = [
    { track: 'rect',   capacity: 20, feeds: TWIN },
    { track: 'hex',    capacity: 16, feeds: TWIN },
    { track: 'trap',   capacity: 16, feeds: TWIN },
    { track: 'oval',   capacity: 16, feeds: [{ side: 'far', lookahead: 2 }, { side: 'near', lookahead: 2 }] },
    { track: 'rect',   capacity: 16, feeds: [{ side: 'far', lookahead: 2 }, { side: 'near', lookahead: 2 }] },
    { track: 'hex',    capacity: 12, feeds: [{ side: 'far', lookahead: 2 }, { side: 'near', lookahead: 2 }] },
    { track: 'trap',   capacity: 12, feeds: [{ side: 'far', lookahead: 2 }] },
    { track: 'rect',   capacity: 12, feeds: [{ side: 'far', lookahead: 1 }, { side: 'near', lookahead: 1 }] },
    { track: 'circle', capacity: 8,  feeds: [{ side: 'near', lookahead: 2 }] },
    { track: 'oval',   capacity: 8,  feeds: [{ side: 'near', lookahead: 1 }] },
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
    const fits = TRACK_SHAPES.filter((s) => capacityOptions(s).includes(tail.capacity));
    return { ...tail, track: fits[(n - 1) % fits.length] };
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
 * Footprint for a capacity and an exit direction. A small car takes one cell; anything
 * bigger takes two, and the two run ALONG the way it leaves.
 *
 * That coupling is not cosmetic. The view lays a car's model down the longer axis of its
 * footprint and cannot turn it across (it would overflow the cell), so a 2x1 car told to
 * exit upwards gets drawn pointing sideways and its roof arrow then contradicts where it
 * actually goes — a player reads the arrow, taps, and nothing happens. Longer than two
 * cells is no good either: buildCar scales models uniformly, bounded by the SHORT axis, so
 * a three-cell footprint just leaves the car rattling around inside it.
 */
function pickFootprint(cap: Cap, dir: Dir): { w: number; h: number } {
    if (cap === 'small') return { w: 1, h: 1 };
    return dir === 'up' || dir === 'down' ? { w: 1, h: 2 } : { w: 2, h: 1 };
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

/** One attempt: scatter `p.cars` cars, colours round-robin so no colour dominates. */
function scatter(rng: () => number, p: GenParams): CarSpec[] {
    const cars: CarSpec[] = [];
    const taken = new Set<string>();
    for (let i = 0; i < p.cars; i++) {
        const cap = pickCap(rng);
        // Direction first: the footprint follows it, so the drawn arrow can't lie.
        const dir = pick(rng, DIRS);
        const { w, h } = pickFootprint(cap, dir);
        for (let t = 0; t < PLACE_TRIES; t++) {
            const x = Math.floor(rng() * (GRID_COLS - w + 1));
            const y = Math.floor(rng() * (GRID_ROWS - h + 1));
            const car: CarSpec = {
                id: cars.length + 1, x, y, w, h, dir,
                color: PALETTE[i % p.colors],
                cap,
            };
            const cells = footprint(car);
            if (cells.some((c) => taken.has(c))) continue;
            for (const c of cells) taken.add(c);
            cars.push(car);
            break;
        }
    }
    return cars;
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
        if (Math.abs(d.blocked - wantBlocked) <= 1 && d.rounds >= p.minRounds) {
            return level;
        }
        // Keep the nearest miss: distance in blocked cars, then in rounds.
        const miss = Math.abs(d.blocked - wantBlocked) + Math.max(0, p.minRounds - d.rounds);
        if (!best || miss < best.miss) best = { cars, miss };
    }
    return assemble(id, best ? best.cars : repair(id, scatter(mulberry32(id * 7919), p)));
}
