import { inflate, insideRect, obbCorners, overlapMTV, OBB } from './geometry';
import {
    CAP_BOX, CAP_SIZE, CAR_SCALE, Cap, CarSpec, CLEARANCE, Feed, LevelData, Lot, QueueGroup,
    TunnelSpec,
} from './types';
import { isSolvable, estimateDifficulty } from './solvability';
import { isHardButFair } from './play-sim';
import { pathClear } from './move-solver';
import { TRACK_SHAPES, TrackShape } from './track-shapes';
import { capacityOptions, entryIndex } from './track-path';
import { mouthCar, tunnelBox, tunnelReservation } from './tunnel';
import { LotSystem } from './lot-system';

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
 * 8 x 8. Square, and the width is a MEASURED fit rather than a round number: the view sizes
 * one board unit from whichever budget is tighter, and on a phone that is the HEIGHT (1.032
 * against 1.0325 across), so widening the lot costs the cars nothing. At 8 the car area comes
 * out 8.416 wide against a slab of 8.720 -- the difference is exactly the slab's own 0.3
 * border. At 7 the cars filled 7.364 of that same slab and left 0.37 of bare asphalt down
 * each side, which is what "the lot is not full" looked like.
 *
 * It was 7 x 8, PORTRAIT, and the shape was the whole point: it is what the cars are drawn at.
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
 * Both dimensions have to clear the longest body (CAP_BOX.big at 1.793) with room for it
 * to turn, which 8 does with 4.5x over.
 *
 * 8 x 10 AS OF THIS REVISION, up from 8 x 8, and the two rows came out of vertical budget that
 * was already going spare -- so the cars did NOT get smaller to pay for them. Two separate
 * slacks, both measured:
 *
 *  - THE CELL. The view sizes one board unit from whichever budget is tighter, and those were
 *    tied at 1.032 by construction on a phone. Tilting the board broke the tie: board units up
 *    the screen foreshorten by cos(38), so the same frame holds 27% more board HEIGHT and the
 *    vertical budget went to 1.3725 while the width budget stayed at 1.0325. At h = 10 the
 *    vertical budget is 1.094, still the looser of the two, so the cell is still 1.0325 and a
 *    car draws exactly the size it did. At 11 it would fall to 0.993 and start shrinking them,
 *    which is the wall -- clearing it means moving the upper half of the board up (ROAD_Y),
 *    which is a bigger change than two rows is worth.
 *  - THE FRAME. `fitCamera` centres the content and splits whatever is left over top and
 *    bottom, and that surplus measured about 3.8 board units on a 1170x2532 phone -- the blank
 *    bands above the ring and below the lot. Two rows spend 2.1 of it, so the camera does not
 *    step back and, because the lot grows DOWNWARD while the ring stays where it is, the whole
 *    board re-centres and the ring moves UP the screen. Which is what was asked for; it is the
 *    lot growing that does it, not the ring being moved.
 */
export const LOT: Lot = { w: 8, h: 10 };

/** Share of each capacity in a level's car mix. Small cars dominate; they read fastest. */
const CAP_MIX: { cap: Cap; weight: number }[] = [
    { cap: 'small', weight: 0.55 },
    { cap: 'medium', weight: 0.25 },
    { cap: 'big', weight: 0.2 },
];

/** How many whole-level attempts before settling for the best one found. */
const ATTEMPTS = 200;

/**
 * Attempts a level WITH tunnels gets instead, and why it needs its own number.
 *
 * A tunnel level throws attempts away that a plain one never had to: the packer has to
 * settle around an immovable reservation (about one attempt in four does, against four in
 * five on an empty lot), and on top of that both mouths have to come out unwelded, which is
 * roughly the same coin toss an ordinary car's exit lane is. Measured on level 9 at 200
 * attempts the search found NO packing inside the blocked tolerance and shipped a nearest
 * miss that the one-line rule then won; at 400 it found two and the painting search bit on
 * the first. The extra attempts are only spent where they are needed -- levels 1 to 3 stop
 * at PACKINGS long before either number binds, so nothing about them changes.
 */
const TUNNEL_ATTEMPTS = 400;
/** Relaxation passes before an attempt is written off. */
const RELAX_ITERS = 60;
/** Share of cars whose angle is snapped to a right angle. See `pack`. */
const SNAP_SHARE = 0.25;
/** Draws a piece gets at finding a seat clear of the tunnel reservations. See `pack`. */
const SEED_TRIES = 8;

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
 * 46, up from 36, and the lot grew from 56 square units to 64 at the same time -- so this is
 * a real densening (0.72 cars per unit against 0.64), not just a bigger lot carrying the same
 * traffic. Both halves were asked for together, and one without the other is worse than
 * neither: more cars in the old lot stops packing, a wider lot at the old count reads emptier
 * than before.
 *
 * The count is still bounded by the packer, not by taste. The last few cars cost the most --
 * random rotated rectangles stop separating reliably somewhere past this, and an attempt that
 * cannot separate them is a wasted attempt (see `pack`). The gate is the generator's own test
 * that every car asked for is actually placed; if this number is raised until that fails, it
 * has been raised too far.
 *
 * Passengers are the other ceiling, and it moved: 46 cars run around 900 of them, which at
 * GROUP_SIZE a tick is about 225 ticks. That used to be 76 seconds of boarding and is now 38,
 * because TICK halved when the carousel sped up. The test's budget was raised to match.
 *
 * 60, up from 46, and it is the same pair of changes as last time rather than a lone dial: the
 * lot went from 64 square units to 80 and medium and big bodies came down 8-9% (see LOT and
 * CAP_BOX). Together those move the average body from 0.743 square units to 0.665, so 60 cars
 * cover 39.9 of 80 -- 49.9%, against the 53.4% that 46 covered of 64. So this is slightly
 * LOOSER packing than shipped, on a lot half again as roomy, which is the safe direction: the
 * count is bounded by whether the packer can still separate everything, and the gate is the
 * generator's own test that every car asked for is placed.
 */
export const CARS_PER_LEVEL = 60;

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
        // 4, 4, 5, 5, then 6 from level 5 on. The floor of 4 and the early climb are both
        // forced, and by the same rule: a level is only capable of difficulty when it has
        // MORE colours than the bay has open stalls.
        //
        // Why -- a bay covering every colour in play cannot jam. Every row reaching the gap
        // boards, every boarding frees a ring cell, so the track never seals, and a sealed
        // track is the only way to lose (LoopSystem.reachableColors, GameCore.isDeadlocked).
        // So at 4 open stalls, a level of 4 colours or fewer is won by a player who does
        // nothing but keep the four stalls all different, WHATEVER the lot looks like. The
        // old ramp opened 2, 3, 3, 4, 4 -- five levels that were free by construction, which
        // is what "the first four levels have no difficulty" was.
        //
        // Measured, over 66 colour paintings per packing on four different packings: the
        // count that beat that one-line rule was 0 of 66 at four colours (every packing),
        // 0 to 2 at five, and 4 to 7 at six. Four colours is not a hard band the search
        // missed; it is provably empty.
        //
        // Levels 1 and 2 therefore stay teaching levels, deliberately and unavoidably. They
        // are where the colour match is learnt, and no painting can make them bite.
        //
        // 6 is the ceiling because PALETTE has six entries and the view has exactly those six
        // in `colors.ts`. A seventh would draw grey (see `colorOf`).
        colors: Math.min(6, 4 + Math.floor((id - 1) / 2)),
        blockedRatio: BLOCKED_FIRST + (BLOCKED_LAST - BLOCKED_FIRST) * t,
        minRounds: Math.min(9, 2 + Math.floor((id - 1) / 3)),
    };
}

/** How many tunnels a level has, and how many cars each of them holds. */
export interface TunnelParams { count: number; cars: number }

/**
 * The tunnel curve, one row per level, alongside TRACK_CURVE and read the same way.
 *
 * Nothing before level 4: a tunnel is a colour you cannot see coming, and the first three
 * levels are where the player learns what the colours are FOR. It arrives one at a time
 * (levels 4-6), then doubles, then deepens -- count first and depth second, because a second
 * tunnel adds a second place to watch while a deeper one only adds more of the same gamble.
 *
 * The cars in these tunnels come OUT of CARS_PER_LEVEL, not on top of it: `generateLevel`
 * packs the lot with the remainder. A level's passenger total and its difficulty curve were
 * both tuned against 60 cars and neither wants to move for this.
 */
const TUNNEL_CURVE: TunnelParams[] = [
    { count: 0, cars: 0 },   // 1
    { count: 0, cars: 0 },   // 2
    { count: 0, cars: 0 },   // 3
    { count: 1, cars: 4 },   // 4
    { count: 1, cars: 4 },   // 5
    { count: 1, cars: 4 },   // 6
    { count: 2, cars: 5 },   // 7
    { count: 2, cars: 5 },   // 8
    { count: 2, cars: 6 },   // 9
    { count: 2, cars: 6 },   // 10
];

export function tunnelParams(id: number): TunnelParams {
    // Floor before the clamp, same idiom `trackParams` uses just below and for the same
    // reason: a fractional id is a fractional array index, and `TUNNEL_CURVE[3.5]` is
    // `undefined`, not row 3 or row 4. `trackParams` stops there because a non-finite id
    // falls into its OWN "past the authored table" branch, which happens to rebuild
    // something drawable regardless. TUNNEL_CURVE has no such branch -- past its end the
    // clamp is the whole story -- so a NaN id (Math.max(1, NaN) is NaN, and every compare
    // against NaN is false) would sail straight through the clamp and come out as
    // `TUNNEL_CURVE[NaN]`, `undefined`, which a caller would read as "this level's tunnel
    // count" rather than a crash. `Number.isFinite` catches that case before it can reach
    // the arithmetic at all.
    const n = Number.isFinite(id) ? Math.floor(id) : 1;
    const i = Math.min(Math.max(1, n), TUNNEL_CURVE.length) - 1;
    return TUNNEL_CURVE[i];
}

/** Placement draws before a tunnel is written off and the whole attempt with it. */
const PLACE_TRIES = 200;

/**
 * Scatter `tp.count` tunnels over an EMPTY lot, or return nothing at all.
 *
 * Before the cars, deliberately: a tunnel cannot be nudged out of the way the packer nudges
 * a car (its mouth would move, and with it the car standing outside), so it has to be the
 * thing everything else is packed around. Each one takes a symmetric reservation -- see
 * `tunnelReservation` for why -- and must clear the lot's edge and every reservation already
 * placed.
 *
 * `angle` here is an AXIS, not yet a heading. Which of the two ends the mouth opens onto is
 * decided by `aimTunnels`, after the cars are down and there is something to aim against.
 *
 * Colours are drawn flat from the level's palette. There is no cleverness to add: the queue
 * is derived from the cars (`queueFor`), so any draw is colour-balanced by construction, and
 * "mixed, and you only see the one at the mouth" is the mechanic rather than a compromise.
 *
 * Unlike the cars, `x`/`y`/`angle` here never pass through `round4` -- verified harmless
 * (JSON round-trips a float bit-exactly, and angle stays inside [0, 360) unrounded), but
 * that safety depends on nothing rounding them EITHER, ever: rounding only at write time,
 * after `isSolvable`/`weldedMouths` have already validated the unrounded geometry, would
 * ship a level different from the one that was checked -- the same trap `scatter`'s
 * "Rounding happens HERE, before anything validates" comment warns about for the cars. So
 * this stays unrounded like the rest of this function, or every consumer downstream of
 * validation would need rounding too; it does not get added here alone.
 */
function placeTunnels(rng: () => number, colors: number, tp: TunnelParams): TunnelSpec[] {
    const pad = CLEARANCE / 2 + ROUND_MARGIN;
    const out: TunnelSpec[] = [];
    for (let i = 0; i < tp.count; i++) {
        let placed: TunnelSpec | null = null;
        for (let k = 0; k < PLACE_TRIES && !placed; k++) {
            const t: TunnelSpec = {
                id: i + 1,
                x: (rng() - 0.5) * LOT.w,
                y: (rng() - 0.5) * LOT.h,
                angle: rng() * 360,
                cars: Array.from({ length: tp.cars }, () => ({
                    color: PALETTE[Math.floor(rng() * colors)],
                    cap: 'small' as Cap,
                })),
            };
            const box = inflate(tunnelReservation(t), pad);
            if (!insideRect(box, LOT.w, LOT.h)) continue;
            if (out.some((o) => overlapMTV(box, inflate(tunnelReservation(o), pad)))) continue;
            placed = t;
        }
        if (!placed) return [];   // a lot this attempt cannot seat; the caller retries
        out.push(placed);
    }
    return out;
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
 * carry (see capacityOptions, and `clearance` behind it), and each shape is set to the LONGEST
 * ring it can carry: 36 for the rectangle, 32 for the hexagon, the trapezoid and the oval, 28
 * for the circle, whose perimeter is 75% of theirs. So the curve turns the two knobs it still
 * has -- how many batches a channel shows, and whether there are two channels or one.
 *
 * NOTE that raising a ring lengthens its planning window as a side effect: the far channel's
 * entry is three quarters of the way round, so its warning is 3 * capacity / 4 ticks, and the
 * near one's is capacity / 4. Every step up hands the far side three more ticks and the near
 * side one. That has now happened twice -- 28 -> 32, and this round's step -- and both times
 * it was accepted rather than overlooked, because the alternative is worse: the compensating
 * knob is `lookahead`, and cutting it is not free either. It is how many batches a channel
 * actually HOLDS, so paying for a longer ring with a shorter lookahead empties the channels on
 * screen, which is the opposite of what the longer ring was for.
 *
 * The curve is checked, not assumed: `planningWindow`'s tail across the ten levels has to stay
 * non-increasing, and this step leaves it strictly better behaved than it was -- 14, 13, 12,
 * 12, 12, 11, (28), 11, 11, 10, against 13, 13, 11, 11, 11, 11, (25), 10, 10, 9. The pin is in
 * level-gen.test.ts. The acceptance run in core/play-sim.ts is what says whether a level still
 * refuses to play itself.
 */
const TRACK_CURVE: TrackParams[] = [
    { track: 'rect',   capacity: 36, feeds: TWIN },
    { track: 'hex',    capacity: 32, feeds: TWIN },
    { track: 'trap',   capacity: 32, feeds: [{ side: 'far', lookahead: 5 }, { side: 'near', lookahead: 4 }] },
    { track: 'oval',   capacity: 32, feeds: [{ side: 'far', lookahead: 5 }, { side: 'near', lookahead: 4 }] },
    // near 3, not 4: this level's ring is the longest there is, so it already hands out more
    // warning than level 4's, and a level 5 that warns you EARLIER than level 4 walks the curve
    // backwards. The lookahead knob gives that tick back. See the note above the table.
    { track: 'rect',   capacity: 36, feeds: [{ side: 'far', lookahead: 4 }, { side: 'near', lookahead: 3 }] },
    { track: 'hex',    capacity: 32, feeds: [{ side: 'far', lookahead: 4 }, { side: 'near', lookahead: 3 }] },
    { track: 'trap',   capacity: 32, feeds: [{ side: 'far', lookahead: 4 }] },
    { track: 'oval',   capacity: 32, feeds: [{ side: 'far', lookahead: 3 }, { side: 'near', lookahead: 3 }] },
    { track: 'circle', capacity: 28, feeds: [{ side: 'near', lookahead: 4 }] },
    { track: 'circle', capacity: 28, feeds: [{ side: 'near', lookahead: 3 }] },
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

/**
 * Passes `settle` gives the lot edge and the reservations to agree with each other. Three,
 * because a piece squeezed out of a reservation can land outside the lot and come back in
 * on top of the reservation it just left; each pass halves what is left of that, and a
 * residue is harmless -- the relaxation's own reservation sweep is what actually decides
 * whether the attempt is accepted.
 */
const SETTLE_PASSES = 3;

/**
 * Slide a piece until it is inside the lot AND clear of every tunnel reservation. Mutates it.
 *
 * The two constraints are applied together because they are the same KIND of constraint: a
 * reservation is a wall, not a neighbour. That distinction is what this function is for.
 * `clampInside` has always been applied immediately after every push, so a piece never
 * spends a moment outside the lot, and doing the same for reservations is what stops the
 * relaxation oscillating: a piece shoved into a reservation by a neighbour is shoved back
 * out in the same breath, instead of sitting there until the end-of-sweep reservation pass
 * pushes it back into the neighbour that put it there. Measured on level 7 -- pushing
 * reservations only at the end of a sweep, the packer settled 7 attempts in 200 and the
 * level shipped with a welded tunnel; projecting them here, 19 in 82 and the search stopped
 * early with three on-target packings in hand.
 *
 * With no tunnels `reserved` is empty and this is exactly `clampInside`, one redundant call
 * later -- which is why levels 1 to 3 regenerate byte for byte.
 */
function settle(p: Piece, reserved: OBB[]): void {
    for (let k = 0; k < SETTLE_PASSES; k++) {
        let moved = false;
        for (const r of reserved) {
            const mtv = overlapMTV(packBox(p), r);
            if (!mtv || Math.hypot(mtv.x, mtv.y) < SETTLED_GAP) continue;
            // The whole MTV, not half: a reservation cannot take its share of the shove.
            p.x += mtv.x;
            p.y += mtv.y;
            moved = true;
        }
        clampInside(p);
        if (!moved) return;
    }
}

/**
 * Passenger queue implied by EVERY car in the level: per colour, exactly the seats that
 * colour offers -- on the board AND inside a tunnel.
 *
 * The tunnel cars are not an optional extra here. They reach the bay exactly as a grid car
 * does, one at a time as the player empties the mouth, so a queue that did not seat them
 * would leave the level a tunnel's worth of passengers short and `validateLevel`'s colour
 * balance would say so. That the player cannot see them yet is a fact about the VIEW.
 */
function queueFor(cars: CarSpec[], tunnels: TunnelSpec[]): QueueGroup[] {
    const seats = new Map<string, number>();
    for (const car of cars) {
        seats.set(car.color, (seats.get(car.color) ?? 0) + CAP_SIZE[car.cap]);
    }
    for (const t of tunnels) {
        for (const c of t.cars) {
            seats.set(c.color, (seats.get(c.color) ?? 0) + CAP_SIZE[c.cap]);
        }
    }
    // Palette order, so the file reads consistently; the loop shuffles the ring anyway.
    return PALETTE.filter((c) => seats.has(c)).map((color) => ({
        color, count: seats.get(color) as number,
    }));
}

function assemble(id: number, cars: CarSpec[], tunnels: TunnelSpec[] = []): LevelData {
    const track = trackParams(id);
    return {
        id,
        // The key is omitted entirely when there are none, rather than written as `[]`, so
        // levels 1-3 keep the exact shape they shipped with and their JSON does not churn.
        // `LevelData.lot.tunnels` is optional precisely so this is expressible.
        lot: tunnels.length > 0
            ? { w: LOT.w, h: LOT.h, cars, tunnels }
            : { w: LOT.w, h: LOT.h, cars },
        parking: { slots: SLOTS, unlocked: UNLOCKED },
        loop: {
            capacity: track.capacity,
            boardIndex: track.capacity / 2,
            track: track.track,
            feeds: track.feeds,
            queue: queueFor(cars, tunnels),
        },
        powerups: { refresh: 3, hardClear: 1, magnet: 1 },
    };
}

/**
 * Fill the lot with `want` pieces around `tunnels`, or return nothing at all.
 *
 * The tunnels are IMMOVABLE. Every other pair in this relaxation shoves both ways, but a
 * tunnel cannot be shoved: its mouth would move with it, and the car standing outside the
 * mouth would move with that -- so a tunnel has to be the thing everything else is packed
 * around, which is why `placeTunnels` runs first over an empty lot. A piece overlapping a
 * reservation therefore takes the whole MTV itself, which is also what the pair sweep does
 * to each of its two, and for the reason given there.
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
function pack(rng: () => number, want: number, tunnels: TunnelSpec[]): Piece[] {
    // The same half-clearance-plus-rounding-slack `packBox` gives a car, applied to the
    // reservation instead: a settled piece and a tunnel then owe each other the full
    // CLEARANCE, which is exactly what `validateLevel` measures between the two.
    const pad = CLEARANCE / 2 + ROUND_MARGIN;
    const reserved = tunnels.map((t) => inflate(tunnelReservation(t), pad));
    const caps: Cap[] = [];
    for (let i = 0; i < want; i++) caps.push(pickCap(rng));
    caps.sort((a, b) => CAP_BOX[b].len - CAP_BOX[a].len);

    // Seeded OFF the reservations where a draw or two can manage it. A piece dropped on top
    // of a tunnel starts the relaxation with a shove it cannot negotiate -- the tunnel will
    // not move, so the piece has to walk out through whatever is packed around it, dragging
    // the neighbours it displaces along. Measured on level 7: seeding blind, the packer
    // settled 7 attempts in 200; resampling here, 42. Eight draws is where it stops paying
    // (thirty gave the identical run), and a piece that never finds a clear seat is kept
    // anyway rather than dropped -- the relaxation is still allowed to solve it.
    //
    // With no tunnels the test is false on the first draw, so the rng sequence, and every
    // level before the fourth, is unchanged.
    const pieces: Piece[] = caps.map((cap) => {
        let p: Piece;
        for (let k = 0; ; k++) {
            let angle = rng() * 360;
            if (rng() < SNAP_SHARE) angle = Math.round(angle / 90) * 90;
            p = { x: (rng() - 0.5) * LOT.w, y: (rng() - 0.5) * LOT.h, angle, cap };
            clampInside(p);
            if (k + 1 >= SEED_TRIES) break;
            if (!reserved.some((r) => overlapMTV(packBox(p), r))) break;
        }
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
                settle(pieces[i], reserved);
                settle(pieces[j], reserved);
            }
        }
        // Every piece against every reservation, once a sweep. `settle` above has already
        // caught the ones a pair push displaced; this is what catches a piece no pair
        // touched, and -- because it sets `moved` -- it is also the convergence test. An
        // attempt is only settled when nothing is left inside a tunnel.
        for (const piece of pieces) {
            for (const r of reserved) {
                const mtv = overlapMTV(packBox(piece), r);
                if (!mtv || Math.hypot(mtv.x, mtv.y) < SETTLED_GAP) continue;
                moved = true;
                piece.x += mtv.x;
                piece.y += mtv.y;
                clampInside(piece);
            }
        }
        if (!moved) return pieces;
    }
    // Never settled. Better a failed attempt than a lot with cars inside each other -- or,
    // now, a car inside a tunnel. A piece pinned between a wall and a reservation can push
    // back and forth forever, and a failed attempt is much the cheaper of the two.
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
 * Point each tunnel down whichever of its two axis headings leaves the mouth car a clear
 * lane; keep the axis it was placed on when neither does.
 *
 * The direct analogue of `headingsFor`, and it works for the same reason: the reservation is
 * symmetric (see `tunnelReservation`), so a tunnel turned a half turn covers exactly the
 * board the packer packed around and the placement stays valid either way. That is the whole
 * point of paying for both ends -- whether a mouth has a clear lane is not knowable until the
 * cars are down, so the heading is the last thing decided, not the first.
 *
 * Probed against the pieces AT THEIR OWN ANGLES, which is the same occupancy model `peel`
 * and `isSolvable` use -- a rectangle is identical under a half turn, so the box a piece
 * presents does not depend on which of its two headings it is later handed. The three cannot
 * disagree about who blocks whom.
 *
 * The tunnel BODIES go in as static blockers, including the tunnel's own: a mouth car sits
 * one CLEARANCE clear of the body behind it and `sweepHit` reports nothing strictly behind
 * the mover, so a tunnel never blocks its own car (see `mouthCar`), but the OTHER tunnel on
 * a two-tunnel level very much can.
 */
function aimTunnels(tunnels: TunnelSpec[], pieces: Piece[]): TunnelSpec[] {
    const probes: CarSpec[] = pieces.map((p, i) => ({
        id: i + 1, x: p.x, y: p.y, angle: p.angle, color: '', cap: p.cap,
    }));
    // A tunnel body is unchanged by a half turn, so one set of bodies serves both headings.
    const bodies = tunnels.map(tunnelBox);
    return tunnels.map((t) => {
        for (const angle of [t.angle, (t.angle + 180) % 360]) {
            const aimed = { ...t, angle };
            // id 0, which no probe carries, so `pathClear` skips nothing it should not.
            const mouth = mouthCar(aimed, 0);
            if (mouth && pathClear(mouth, probes, LOT, bodies)) return aimed;
        }
        // Welded shut on both headings. Not a rejection -- see `WELDED_PENALTY` -- so the
        // attempt survives and the search scores it down.
        return t;
    });
}

/**
 * Hand every piece a heading, in the order the cars will LEAVE. Unchanged in shape
 * from the grid version: a piece may be taken when some legal heading gives it a clear
 * lane past the pieces still down, and whichever is taken frees its space for the next
 * step -- so the returned order is a valid leaving order for the GRID CARS ALONE, checked
 * only against the tunnel BODIES: at the moment car k leaves (in this order, against
 * these blockers), the cars still parked are exactly the ones that were still down when
 * its lane was checked. That is NOT the same claim as "this order plays out on the
 * finished level" -- see the note on `blockers` below for what it leaves out and why that
 * is not free.
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
 *
 * `blockers` are the tunnel bodies, which never leave: a lane that only clears once the
 * tunnel is gone is not a lane. Note what this order does NOT include -- the tunnel CARS.
 * Every mouth car stands on the board from frame 0, exactly like a grid car, but it is
 * never one of `pieces` and never one of `blockers` either: when it comes out is decided
 * by the player tapping it, not by this peel, so there is no fixed moment to slot it into
 * an order built around "leaves at step k". Skipping it is NOT free -- a mouth car can and
 * does block a grid car's turn in this order. Replaying the shipped levels found it doing
 * exactly that: level 7, 1 violation (car 1 blocked by tunnel 2's mouth car); level 8, 3
 * (cars 5, 16, 27); level 9, 1 (car 19). The alternative -- feeding mouth cars into
 * `blockers` as permanent obstacles -- would be strictly MORE conservative than the real
 * game, since the player can tap a mouth car whenever they like, and it would spend
 * attempts fighting a restriction the level does not actually have, on exactly the levels
 * (7-9) that already need close to all of `TUNNEL_ATTEMPTS`. So this order is a proposal,
 * not a guarantee: `isSolvable` -- run on every candidate, gating every level
 * `generateLevel` returns (see there, and `repair`'s loop) -- is what actually verifies a
 * level plays, and it does that by simulation, not by trusting this comment.
 */
function peel(
    rng: () => number, pieces: Piece[], blockers: OBB[],
): { piece: Piece; angle: number }[] {
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
                if (pathClear({ ...probes[i], angle }, probes, LOT, blockers)) {
                    moves.push({ i, angle });
                }
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
 * One attempt at a level's cars: lay the tunnels down, pack the lot around them, aim each
 * tunnel, work out an order the cars can leave in, then paint them round-robin over it.
 *
 * The tunnels go FIRST and on an empty lot, because they are the only thing here that cannot
 * be nudged (see `pack`). An attempt that cannot seat them all is abandoned whole rather than
 * shipped a tunnel short -- the count is the curve's, not the packer's to negotiate.
 *
 * Only the GRID cars are peeled and painted. The `want` handed to `pack` is already the
 * remainder after the tunnels take their share of the budget; the caller works that out, so
 * this can stay a function of the two curves it is given.
 *
 * The round-robin is a STARTING POINT ONLY, and on its own it is the easiest painting there
 * is: `i` is the leaving order, so red/blue/green/yellow/red/... puts one car of every
 * colour in the lot's outermost layer at all times, and hands the player the one-line rule
 * that beats the whole game ("keep the stalls all different"). `choosePainting` searches
 * past it; this is what that search starts from and falls back to.
 *
 * Rounding happens HERE, before anything validates or solves these cars, so the numbers
 * checked are the numbers written -- a ten-thousandth is small, but the clearance it is
 * measured against is only 0.04.
 */
function scatter(
    rng: () => number, p: GenParams, tp: TunnelParams,
): { cars: CarSpec[]; tunnels: TunnelSpec[] } {
    const tunnels = placeTunnels(rng, p.colors, tp);
    if (tunnels.length < tp.count) return { cars: [], tunnels: [] };
    const pieces = pack(rng, p.cars - tp.count * tp.cars, tunnels);
    const aimed = aimTunnels(tunnels, pieces);
    const order = peel(rng, pieces, aimed.map(tunnelBox));
    const cars = order.map(({ piece, angle }, i) => ({
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
    return { cars, tunnels: aimed };
}

/**
 * Drop GRID cars until the lot clears. Exitability only ever improves as cars leave, so this
 * terminates — an empty lot is trivially solvable. It is the safety net for a seed whose
 * every attempt tangled: better a level one car short than an unsolvable one.
 *
 * The tunnels stay. They are not the safety valve: dropping one would change the level's
 * passenger total by four to six cars at a stroke, and it cannot help anyway -- a tunnel
 * drains once the lot around it empties, so it is never what makes a level unclearable.
 */
function repair(id: number, cars: CarSpec[], tunnels: TunnelSpec[]): CarSpec[] {
    const kept = cars.slice();
    while (kept.length > 0 && !isSolvable(assemble(id, kept, tunnels))) kept.pop();
    return kept;
}

/** Same cars, same places, different colours. */
function repaint(cars: CarSpec[], assign: string[]): CarSpec[] {
    return cars.map((car, i) => ({ ...car, color: assign[i] }));
}

/**
 * Colour paintings to try, in order, forever. Index `i` is the car's place in the LEAVING
 * order, which is the only ordering that matters here -- what a painting decides is which
 * colours are within reach at each moment, not which corner they sit in.
 *
 * Runs first, shortest to longest: a run of `k` means the outermost layer holds one colour
 * for `k` cars at a time, and run 1 is exactly the round-robin. Runs alone are a cliff
 * rather than a dial (measured: at six colours a run of 4 beats the one-line rule and a
 * careful player still wins, while a run of 6 is unwinnable for every policy tried), which
 * is why they are only the opening moves and the rest are seeded shuffles. Every painting
 * uses each colour a near-equal number of times, so no colour can starve.
 */
function* paintings(n: number, colors: number, rand: () => number): Generator<string[]> {
    for (let run = 1; run <= 6; run++) {
        yield Array.from({ length: n }, (_, i) => PALETTE[Math.floor(i / run) % colors]);
    }
    for (;;) {
        const assign = Array.from({ length: n }, (_, i) => PALETTE[i % colors]);
        for (let i = assign.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = assign[i];
            assign[i] = assign[j];
            assign[j] = tmp;
        }
        yield assign;
    }
}

/** Paintings tried per packing, and packings tried, before the search gives up. */
const PAINTINGS = 400;
const PACKINGS = 3;

/**
 * Repaint `cars` until the level is hard but fair, or return null if the search runs out.
 *
 * Repainting is free in a way repacking is not: the passenger queue is DERIVED from the
 * cars (`queueFor`), so every painting is colour-balanced by construction and cannot fail
 * `validateLevel`. The lot's geometry -- the blocked count and solver rounds the curve was
 * tuned against -- is untouched.
 *
 * Skipped outright below `UNLOCKED` colours, and that is not an optimisation: at four open
 * stalls a four-colour level cannot be beaten by any painting (see `levelParams`), so the
 * search would burn 400 simulations to fail. Those levels take the round-robin and are
 * teaching levels.
 *
 * `tunnels` is carried through only so `assemble` builds the WHOLE level for `isHardButFair`
 * to play -- the tunnel cars are passengers on the ring and obstacles on the board, and a
 * verdict reached without them is a verdict about a different level. The tunnel cars are not
 * themselves repainted: they are not in the leaving order (when they come out is the player's
 * choice, not `peel`'s) and `queueFor` derives the queue from whatever colours they carry, so
 * no painting of the grid can unbalance them.
 */
function choosePainting(
    id: number, cars: CarSpec[], tunnels: TunnelSpec[], p: GenParams,
): CarSpec[] | null {
    if (p.colors <= UNLOCKED) return null;
    const rand = mulberry32(id * 104729 + 17);
    let tried = 0;
    for (const assign of paintings(cars.length, p.colors, rand)) {
        if (tried++ >= PAINTINGS) return null;
        const painted = repaint(cars, assign);
        const verdict = isHardButFair(assemble(id, painted, tunnels));
        if (verdict.hard && verdict.fair) return painted;
    }
    return null;
}

/**
 * How much a welded-shut tunnel mouth costs an attempt. Large enough to lose to nothing
 * else: a level that is two blocked cars off target still plays, while one whose count badge
 * cannot be spent on the first tap looks broken.
 *
 * A PENALTY and not a rejection, because a welded tunnel is not actually unsolvable -- the
 * lot empties around it and it drains at the end (see the spec's solvability argument). If no
 * attempt in TUNNEL_ATTEMPTS finds a clear mouth, a playable level is still better than none.
 * (Not ATTEMPTS: any level that can produce a welded mouth has `tp.count > 0`, and that is
 * exactly the condition `generateLevel` uses to pick TUNNEL_ATTEMPTS over ATTEMPTS.)
 */
const WELDED_PENALTY = 100;

/**
 * Tunnels whose mouth car cannot move on the opening position.
 *
 * Asked of a real `LotSystem` rather than computed from the spec, because the mouth car is
 * something the LotSystem SPAWNS -- it has no id in the level file and no existence outside a
 * played lot. This is the same object the game builds on load, so what it says here is what
 * the player's first tap will find.
 */
function weldedMouths(level: LevelData): number {
    const lot = new LotSystem(
        { w: level.lot.w, h: level.lot.h }, level.lot.cars, level.lot.tunnels ?? [],
    );
    let n = 0;
    for (const t of lot.tunnels) {
        const id = lot.mouthCarId(t.id);
        if (id === null || !lot.canExit(id)) n++;
    }
    return n;
}

/**
 * The blocked-car count the curve asks of `id`.
 *
 * Measured against what is actually ON THE BOARD at the opening position -- the grid cars
 * plus one mouth car per tunnel -- and NOT against CARS_PER_LEVEL. `blockedRatio` is a share
 * of the cars a player can see and tap; the cars still queued inside a tunnel have no exit
 * lane at all to be blocked on, and `estimateDifficulty.blocked` does not count them (it asks
 * the opening `LotSystem`, which holds one car per tunnel). Counting them here would ask
 * level 10 for 47 blocked cars out of the 50 that are on the board -- a target the geometry
 * cannot reach, so every late level would fall back to its nearest miss and the ramp would
 * stop doing anything.
 *
 * Exported because three places need the number and they must not drift apart: the search's
 * own miss metric, the offline tool's "on target" column, and the test that pins the curve.
 * They were three copies of one expression before tunnels existed, and the copies agreed only
 * because the denominator happened to be the same.
 */
export function blockedTarget(id: number): number {
    const p = levelParams(id);
    const tp = tunnelParams(id);
    return Math.round(p.blockedRatio * (p.cars - tp.count * tp.cars + tp.count));
}

/**
 * A level for `id`: deterministic, colour-balanced by construction (the passenger queue is
 * derived from the cars, so `validateLevel` cannot fail), solvable, as close to the curve's
 * blocking target as 200 attempts get, and -- where the colour count allows one at all --
 * painted so that the one-line rule loses and a careful player wins.
 *
 * Two searches, nested, because they answer different questions. The packing decides how
 * tangled the LOT is: every car can be driven out in some order, and how much digging that
 * takes is what `blockedRatio` and `minRounds` measure. The painting decides how tangled the
 * GAME is: which colours are in reach when, against the colours coming round the track. The
 * shipped levels used to be searched on the first alone, and were free on the second.
 *
 * On-target packings are collected rather than returned on sight, so a packing whose colours
 * cannot be made to bite can be abandoned for the next one. A level that exhausts all of
 * them keeps the first on-target packing, round-robin painted, exactly as before -- the
 * generation log is where that shows up (see the `hard`/`fair` columns in tools/gen-levels).
 *
 * A third condition joins the two from level 4 on: no tunnel welded shut. It is a preference
 * and not a filter -- see `WELDED_PENALTY` -- so an attempt with a welded mouth is still kept
 * as a nearest miss, it just loses to anything without one.
 */
export function generateLevel(id: number): LevelData {
    const p = levelParams(id);
    const tp = tunnelParams(id);
    // The tunnels' cars come OUT of the level's budget, so the lot gets the remainder.
    const gridCars = p.cars - tp.count * tp.cars;
    const attempts = tp.count > 0 ? TUNNEL_ATTEMPTS : ATTEMPTS;
    const wantBlocked = blockedTarget(id);
    let best: { cars: CarSpec[]; tunnels: TunnelSpec[]; miss: number } | null = null;
    const onTarget: { cars: CarSpec[]; tunnels: TunnelSpec[] }[] = [];

    for (let attempt = 0; attempt < attempts && onTarget.length < PACKINGS; attempt++) {
        // Seeded from the id, so the same id walks the same attempts in the same order.
        const { cars, tunnels } = scatter(mulberry32(id * 7919 + attempt), p, tp);
        // Short on either count is short: an attempt that seated the tunnels but not the
        // cars, or the cars but not the tunnels, is not this level.
        if (cars.length < gridCars || tunnels.length < tp.count) continue;
        const level = assemble(id, cars, tunnels);
        if (!isSolvable(level)) continue;
        const welded = weldedMouths(level);
        const d = estimateDifficulty(level);
        if (welded === 0
            && Math.abs(d.blocked - wantBlocked) <= BLOCKED_TOLERANCE
            && d.rounds >= p.minRounds) {
            onTarget.push({ cars, tunnels });
            continue;
        }
        // Keep the nearest miss: distance in blocked cars, then in rounds, then -- dwarfing
        // both -- a welded mouth.
        const miss = Math.abs(d.blocked - wantBlocked)
            + Math.max(0, p.minRounds - d.rounds)
            + welded * WELDED_PENALTY;
        if (!best || miss < best.miss) best = { cars, tunnels, miss };
    }

    for (const { cars, tunnels } of onTarget) {
        const painted = choosePainting(id, cars, tunnels, p);
        if (painted) return assemble(id, painted, tunnels);
    }
    if (onTarget.length > 0) return assemble(id, onTarget[0].cars, onTarget[0].tunnels);
    if (best) return assemble(id, best.cars, best.tunnels);
    const fallback = scatter(mulberry32(id * 7919), p, tp);
    return assemble(id, repair(id, fallback.cars, fallback.tunnels), fallback.tunnels);
}
