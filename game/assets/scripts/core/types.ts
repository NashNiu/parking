import { TrackShape } from './track-shapes';

/**
 * Which end of the ring a feeder channel joins, named by PIPELINE LENGTH rather than by
 * screen side. The ring steps one index per tick in one direction, so the two sides are
 * not interchangeable: a row entering at `near` reaches the boarding gap in capacity/4
 * ticks, one entering at `far` takes three times that. That difference is the difficulty
 * knob this milestone turns, and `left`/`right` hid it. The view draws no left/right
 * mapping at all: both position and heading come from the entry cell's own path point
 * and outward normal (see `entryIndex` in track-path.ts and `TrackView.buildLanes`),
 * which is what makes a tilted shape's channels tilt correctly with no special-casing.
 */
export type FeedSide = 'far' | 'near';

export type Cap = 'small' | 'medium' | 'big';

export const CAP_SIZE: Record<Cap, number> = {
  small: 16,
  medium: 24,
  big: 32,
};

/**
 * One car in the lot. Continuous coordinates, not grid cells: `x`/`y` is the centre of
 * the body and `angle` is the direction it drives out, in degrees, 0 = +X,
 * counter-clockwise, normalised to [0, 360).
 *
 * There is no width or height field. A car's footprint is its MODEL's size (see
 * CAP_BOX) at that angle, which is what lets three vehicle sizes read as three sizes
 * instead of as one-cell and two-cell.
 */
export interface CarSpec {
  id: number;
  x: number;
  y: number;
  angle: number;
  color: string;
  cap: Cap;
}

/** A body's own dimensions: `len` along its heading, `wid` across it. Board units. */
export interface Box { len: number; wid: number }

/** The lot's extent in board units. Origin is its centre, +Y up. */
export interface Lot { w: number; h: number }

/**
 * Each capacity's body size in board units, where one board unit is the pitch the old
 * grid used (0.7533 world units). The numbers are the three glb models' measured AABBs
 * divided by that pitch. `tools/check-car-models.mjs` is what guards them: it parses the
 * glb files and fails if a model's proportions leave any of these rows unfilled. Run it
 * after any model swap -- core cannot read a .glb, so nothing else can notice this table
 * going stale, and the failure is backwards: a model that GREW makes the car smaller.
 *
 * This table is the SOURCE of the drawn size, which is the opposite of how it used to
 * work: a model AABB was fitted to a grid cell and the size fell out of the fit. Do
 * not re-derive CAP_BOX from a model at runtime -- core cannot see models, and the two
 * directions together would be a circle.
 *
 * THE MODELS ARE GONE, so these are simply the authored sizes now: a car is drawn from
 * `car-mesh.ts` into whatever box this table gives it, and the guard tool that used to check
 * them against the glb files went with the models.
 *
 * medium and big came DOWN in this revision, asked for as "a bit smaller": medium by 9.1% and
 * big by 8%, both UNIFORMLY, so each keeps its proportions. Medium's aspect ratio being
 * unchanged is load-bearing rather than tidy -- `REFERENCE_ASPECT` in car-mesh.ts is that
 * ratio, and the drawn body's corner radius is worked out at it, so a medium car that changed
 * shape would silently move every car's corners.
 *
 * It pairs with the lot growing to 8 x 10 (see LOT): smaller bodies and more board are the two
 * halves of "park more cars", and CARS_PER_LEVEL is what spends them.
 */
export const CAP_BOX: Record<Cap, Box> = {
  small: { len: 0.964, wid: 0.471 },
  medium: { len: 1.611, wid: 0.515 },
  big: { len: 1.793, wid: 0.570 },
};

/**
 * One factor on every car's size. The release valve for packing density: 36 cars drawn from
 * CAP_MIX would cover 47.7% of the 7x8 lot on paper, and the ten shipped levels come out at
 * 45.8% (38.1% to 53.5% level by level, since each car's capacity is an independent draw).
 * Random rotated rectangles handle that with room to spare, so it starts at 1. Turn it down
 * only if `pack` cannot seat all 36.
 */
export const CAR_SCALE = 1.0;

/**
 * The least board a PARKED car must have around it, in board units. It governs how a lot is
 * laid out (`packBox`, `validateLevel`) and how forgiving a tap is (`pickCar`'s slop). It
 * does NOT govern driving: `firstBlocker` sweeps bare bodies, so a car goes whenever its
 * body would clear whatever is beside its lane, however fine the margin.
 *
 * That split is deliberate and was measured. Demanding this margin of the LANE too refused
 * 18 of 250 blocked cars that would genuinely have squeezed past, the widest real daylight
 * refused being 2.7 screen px -- a boundary far too fine to see, so cars sitting near it
 * looked passable and were not. Dropping it costs little in the other direction precisely
 * BECAUSE the packer still enforces it: parked pairs are a whole clearance apart, so most
 * channels are already at least this wide and only 4 of 114 passable cars now shave past
 * with under 1.3 px, the tightest at 0.5 px.
 *
 * Every reader that does apply it splits it HALF ON EACH of a pair. That is not a detail:
 * growing one box by the whole clearance and leaving the other bare is a DIFFERENT rule once
 * boxes can rotate, because inflating a box by d adds d * (|n.u| + |n.v|) to its radius on
 * axis n -- d square-on, d * sqrt(2) at 45 degrees. The two agreed while every car was
 * axis-aligned and parted company the moment angles became free. Add a reader, split it in
 * half.
 *
 * 0.08, and this is the TIGHTEST gap a parked pair may have, not their average -- the
 * measured mean nearest-neighbour gap that comes out of it is 0.103.
 *
 * Doubled from 0.04, asked for as "a bit more room between the cars". At 0.04 (about 2.6
 * screen px) adjacent bodies read as touching; 0.08 is about 5.2 px, which is a seam the eye
 * actually resolves. It costs nothing anywhere it was feared it might:
 *
 *  - THE PACKER still seats all 60 cars, and the body coverage is unchanged (0.494 against
 *    0.491). The gap is bought out of air the lot already had, not out of cars.
 *  - THE LOT GETS MORE EVEN, NOT PATCHIER, which is the opposite of the obvious worry.
 *    `pack` settles by pushing overlapping pairs apart, so a larger demanded gap is a
 *    stronger mutual repulsion and the arrangement spreads out instead of clumping.
 *    Measured on level 2 as the radius of the largest empty disc that fits between the
 *    cars: 0.847 board units at 0.04, 0.720 at 0.08. The old tight lot was the one with a
 *    blank patch in it.
 *  - THE DIFFICULTY does not move: level 2 comes out at 38 blocked cars either way, which
 *    is its target. That follows from the split above -- this margin never governed driving,
 *    so widening it cannot hand a car a lane it did not have.
 *
 * It does not go further than 0.08 for one measured reason: at 0.10 the blocked count starts
 * to drift (level 2 falls to 37), and levels 7 to 10 are already asking for every blocked car
 * their geometry can produce (see BLOCKED_LAST in level-gen.ts), so a drift of one would take
 * them off target and flatten the back of the curve.
 *
 * This does give back some of what M7 spent several rounds tightening. That was deliberate
 * then and this is deliberate now; what must not happen is it moving again by accident.
 */
export const CLEARANCE = 0.08;

/** One car waiting in a tunnel. Everything else about it -- where it stands, which way
 * it leaves, what id it gets -- belongs to the tunnel, not to the car. */
export interface TunnelCar { color: string; cap: Cap }

/**
 * A queue of cars behind a fixed mouth. The car at the head stands OUTSIDE, in front of
 * the body, and is a `CarSpec` like any other: it is tapped, blocked, parked and boarded
 * by exactly the code every other car goes through. When it leaves, the next one takes
 * its place (see `LotSystem.removeCar`).
 *
 * `x`/`y`/`angle` describe the BODY. The mouth car's position is derived from them by
 * `mouthCar` rather than stored, because two stored copies is two chances to disagree.
 * `angle` is the direction cars LEAVE in: 0 = +X, counter-clockwise, [0, 360), the same
 * convention `CarSpec.angle` uses.
 *
 * `cars[0]` is whoever is at the mouth right now; the array is consumed from the head.
 * Its LENGTH is the number the player sees on the tunnel -- the mouth car included,
 * because it has not left yet.
 */
export interface TunnelSpec {
  id: number;
  x: number;
  y: number;
  angle: number;
  cars: TunnelCar[];
}

/**
 * The tunnel body's own size in board units, the same units and the same role as CAP_BOX.
 *
 * SQUARE, and SHORTER THAN A SMALL CAR. Both of those are the point, and both were measured
 * off the reference game rather than chosen: with a small car (0.471 x 0.964) as the ruler in
 * the same screenshot, its count tile comes out 0.73 x 0.71 board units.
 *
 * This started at 1.2 x 0.76 -- longer than a small car and half as wide -- and the reports
 * were all the same: it reads as another car. It was a long rounded box among sixty long
 * rounded boxes, in a blue the cars also come in. What separates this element from a car is
 * not fidelity, it is SHAPE: nothing else on this board is square, so a square is legible at a
 * glance in a way no amount of modelling on a car-shaped body ever was.
 *
 * Being smaller also buys packing room back: the reservation is symmetric about the body (see
 * `tunnelReservation`), so this takes it from 3.208 board units long to 2.748.
 *
 * core owns this number and the view reads it, the same direction CAP_BOX runs. Do not
 * re-derive it from whatever `tunnel-mesh.ts` draws.
 */
export const TUNNEL_BOX: Box = { len: 0.74, wid: 0.74 };

export interface QueueGroup {
  color: string;
  count: number;
}

/**
 * Passengers occupy the loop in same-colour groups rather than one per cell: a ring cell
 * holds a group, and the view draws it as a BLOCK of up to `GROUP_SIZE` figures -- four
 * across the path, two deep along it. `capacity` therefore counts blocks, so a
 * capacity-20 track carries up to 160 people.
 *
 * 4, standing in ONE row across the track (see BLOCK). It was 8 for a while, in two ranks,
 * on the grounds that a ring of single rows read as mostly empty track -- a row is 0.22
 * long against a slot pitch of 0.5-0.7, so most of the ribbon was bare. That was true of
 * the ring as it then was, and what was actually missing was a bound on the bare band:
 * SEAM_MAX supplies one now, and it pushes the ring to 20 cells, where the band between
 * two rows is 0.31-0.37 rather than the 0.5 that made a single row look lost.
 *
 * It must DIVIDE every car capacity (CAP_SIZE: 16, 24, 32), or `toGroups` would chop a
 * colour's passengers into a full row plus a ragged remainder, and the ring would show
 * half-empty cells that no boarding produced. 4 divides all three; so does 8; 12 does not.
 *
 * It is no longer the ceiling on how many passengers board in one tick -- BOARD_CELLS rows
 * board together now -- but it is still the ceiling per ROW, so halving it doubles how many
 * rows a level's passengers take to clear.
 */
export const GROUP_SIZE = 4;

/**
 * How many CONSECUTIVE ring cells the boarding doorway covers: every row inside it boards on
 * the same tick, as far as the matching cars can take it.
 *
 * ODD, so the window is symmetric about `boardIndex` and the doorway's middle stays at the
 * bottom of the ring where the bay is. An even width would put the door's centre half a cell
 * off the lowest point of the track, which reads as a door hung crooked.
 *
 * 3, against rows that come in clusters of CLUSTER_ROWS. The pair is the whole point: one
 * cluster is four same-coloured rows, so a window of three takes eight to twelve people out
 * of it in one flight instead of four, and a colour the player set a car up for pays off in
 * one visible burst rather than four separate ones. That burst is what the width buys; it is
 * NOT extra throughput, because the ring is still fed one row per tick at the live entrance
 * (see `LoopSystem.step`), so what changes is how lumpy the boarding is, not how long a
 * level runs.
 *
 * The window must not reach an entry cell (`boardIndex +- capacity / 4`), or a row would be
 * boarded on the tick it entered and the entry animation would fly a figure that is already
 * gone. `LoopSystem` clamps the half-width to `capacity / 4 - 1` for exactly that, which is
 * how the toy four-cell rings in the tests keep the single-cell doorway they were written
 * against; every legal capacity (28 and up) has room for the full 3.
 */
export const BOARD_CELLS = 3;

/**
 * How many rows of ONE colour the shuffle keeps together on the track. 1 means no
 * clustering: every row is dealt on its own, which is what the game shipped with.
 *
 * OFF, AND THIS IS WHY. The intent was a satisfying payout: deal four same-coloured rows
 * side by side so a colour arrives as a band of 16 people and leaves through the BOARD_CELLS
 * doorway in one or two bursts instead of four separate ones. It works, and it makes the
 * game unwinnable.
 *
 * The ring drains SELECTIVELY. A colour the bay currently covers is boarded, so its cells
 * empty and refill from the channels; a colour no parked car wants cannot leave, so it stays.
 * With four stalls and up to six colours, two colours are homeless at any moment and their
 * rows pile up. Dealt one row at a time, a homeless colour adds ONE cell per lap and the
 * ring's colour mix decays slowly enough for the player to react -- that slack IS the game.
 * Dealt in clusters of four it adds FOUR, and the ring seals in a few laps: measured at the
 * deadlock on level 8, thirty of thirty-two cells held just cyan and yellow while the bay
 * sat on blue, green and red.
 *
 * Measured over the ten shipped levels, as (hard AND fair) verdicts from `isHardButFair`
 * (level 1 is a teaching level and cannot be hard, so 9 is the ceiling):
 *
 *   CLUSTER_ROWS 1, BOARD_CELLS 1   9/10   what shipped
 *   CLUSTER_ROWS 1, BOARD_CELLS 3   8/10   the wide doorway alone: level 10 turns easy
 *   CLUSTER_ROWS 2, BOARD_CELLS 3   4/10
 *   CLUSTER_ROWS 3, BOARD_CELLS 3   1/10
 *   CLUSTER_ROWS 4, BOARD_CELLS 3   2/10   five levels unwinnable by ANY policy tried
 *
 * Regenerating the levels does not rescue it, which is why the numbers above are the end of
 * the matter rather than the start of a search: what a painting decides is which colours the
 * player is forced to park, and the collapse is driven by which colours the bay is NOT
 * covering. Nor does opening more stalls -- at six unlocked instead of four, levels 2, 8 and
 * 9 are still unwinnable, because a blocked lot means the player cannot always reach the
 * colour the bay is missing.
 *
 * Kept as a knob, with `shuffleClusters` behind it, because the payout it buys is real and
 * the thing that would pay for it is a bigger bay or a longer ring -- a design change, not a
 * number. Raising this without one of those is how the ten levels above were lost.
 */
export const CLUSTER_ROWS = 1;

/** One row of same-coloured passengers. `count` falls as they board, 1..GROUP_SIZE. */
export interface PaxGroup {
  color: string;
  count: number;
}

/**
 * One feeder channel. `lookahead` is how many waiting batches the view draws, which is
 * how far ahead the player can read the incoming colours — a difficulty knob, not a
 * cosmetic length. The queue behind it is longer; the rest is implied off screen.
 *
 * Authored order does not matter: `LoopSystem` re-sorts a level's `feeds` into drain
 * order (far before near) before it looks at them, and `validateTrack` rejects two
 * feeds on the same side, so there is never a pair for order to matter between anyway.
 */
export interface Feed { side: FeedSide; lookahead: number }

/** What a level without a `track` field gets: the shape M6 shipped. */
export const DEFAULT_TRACK: TrackShape = 'rect';

/** What a level without a `feeds` field gets: M6's two channels, three batches each. */
export const DEFAULT_FEEDS: Feed[] = [
  { side: 'far', lookahead: 3 },
  { side: 'near', lookahead: 3 },
];

export interface LevelData {
  id: number;
  lot: { w: number; h: number; cars: CarSpec[]; tunnels?: TunnelSpec[] };
  parking: { slots: number; unlocked: number };
  loop: {
    capacity: number;
    boardIndex: number;
    track?: TrackShape;
    feeds?: Feed[];
    queue: QueueGroup[];
  };
  powerups: { refresh: number; hardClear: number; magnet: number };
}
