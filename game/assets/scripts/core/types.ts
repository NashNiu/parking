import { FeedSide } from './track-path';
import { TrackShape } from './track-shapes';

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Cap = 'small' | 'medium' | 'big';

export const CAP_SIZE: Record<Cap, number> = {
  small: 16,
  medium: 24,
  big: 32,
};

export interface CarSpec {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dir: Dir;
  color: string;
  cap: Cap;
}

export interface QueueGroup {
  color: string;
  count: number;
}

/**
 * Passengers occupy the loop in same-colour groups rather than one per cell: a ring
 * cell holds a group, and the view draws it as a row of up to `GROUP_SIZE` figures.
 * `capacity` therefore counts ROWS, so a capacity-12 track carries up to 48 people.
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
  grid: { cols: number; rows: number; cars: CarSpec[] };
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
