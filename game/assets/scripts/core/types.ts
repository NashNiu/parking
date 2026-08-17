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

export interface LevelData {
  id: number;
  grid: { cols: number; rows: number; cars: CarSpec[] };
  parking: { slots: number; unlocked: number };
  loop: { capacity: number; boardIndex: number; queue: QueueGroup[] };
  powerups: { refresh: number; hardClear: number; magnet: number };
}
