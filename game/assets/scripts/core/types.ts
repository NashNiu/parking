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
 * divided by that pitch -- see `tools/check-car-models.mjs`, which prints them and now
 * fails the build if they drift from this table.
 *
 * This table is the SOURCE of the drawn size, which is the opposite of how it used to
 * work: a model AABB was fitted to a grid cell and the size fell out of the fit. Do
 * not re-derive CAP_BOX from a model at runtime -- core cannot see models, and the two
 * directions together would be a circle.
 */
export const CAP_BOX: Record<Cap, Box> = {
  small: { len: 0.964, wid: 0.471 },
  medium: { len: 1.772, wid: 0.567 },
  big: { len: 1.949, wid: 0.620 },
};

/**
 * One factor on every car's size. The release valve for packing density: 36 cars at
 * CAP_BOX cover 49.5% of a 9x6 lot, which random rotated rectangles handle with room
 * to spare, so it starts at 1. Turn it down only if `pack` cannot seat all 36.
 */
export const CAR_SCALE = 1.0;

/**
 * The least board a car must have around it, in board units. Used in TWO places on
 * purpose -- the packer keeps cars this far apart, and the lane check grows the moving
 * car by it -- so that the rule reads: a gap you can see is closed IS closed.
 *
 * 0.04 is today's TIGHTEST gap (a small car nose to tail: pitch 1 minus body 0.964),
 * not the average. M7 spent several rounds tightening these gaps and this must not
 * quietly give that back.
 */
export const CLEARANCE = 0.04;

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
 * It is also the ceiling on how many passengers board in one tick, so halving it doubles
 * how many ticks a level's passengers take to clear.
 */
export const GROUP_SIZE = 4;

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
  lot: { w: number; h: number; cars: CarSpec[] };
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
