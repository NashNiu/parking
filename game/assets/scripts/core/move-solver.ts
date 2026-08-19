import { CarSpec } from './types';

export function footprint(car: CarSpec): string[] {
  const cells: string[] = [];
  for (let c = car.x; c < car.x + car.w; c++) {
    for (let r = car.y; r < car.y + car.h; r++) {
      cells.push(`${c},${r}`);
    }
  }
  return cells;
}

export function pathClear(
  car: CarSpec,
  occupied: Set<string>,
  cols: number,
  rows: number,
): boolean {
  const path: Array<[number, number]> = [];
  if (car.dir === 'up') {
    for (let c = car.x; c < car.x + car.w; c++)
      for (let r = 0; r < car.y; r++) path.push([c, r]);
  } else if (car.dir === 'down') {
    for (let c = car.x; c < car.x + car.w; c++)
      for (let r = car.y + car.h; r < rows; r++) path.push([c, r]);
  } else if (car.dir === 'left') {
    for (let r = car.y; r < car.y + car.h; r++)
      for (let c = 0; c < car.x; c++) path.push([c, r]);
  } else {
    // right
    for (let r = car.y; r < car.y + car.h; r++)
      for (let c = car.x + car.w; c < cols; c++) path.push([c, r]);
  }
  return path.every(([c, r]) => !occupied.has(`${c},${r}`));
}

/** Which way a cell index moves for each exit direction. Row 0 is the top row. */
const STEP: Record<CarSpec['dir'], [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** The car in `car`'s way, and how many cells it can advance before touching it. */
export interface Blockage {
  carId: number;
  /** Free cells ahead: 0 when the two are already touching. */
  gap: number;
}

/**
 * The first car blocking `car`'s exit, or null when it can drive out. Answers what
 * `pathClear` only implies, because the view needs to SHOW the refusal: it drives the car
 * up to the obstacle, shakes both, and reverses — for which it needs the distance and the
 * other car's identity, not just a boolean.
 *
 * Walks the footprint forward a cell at a time and stops at the first cell another car
 * holds, so the nearest blocker always wins. `cars` may include `car` itself; a long car
 * sliding over its own cells is not a collision.
 */
export function firstBlocker(
  car: CarSpec,
  cars: CarSpec[],
  cols: number,
  rows: number,
): Blockage | null {
  const [dx, dy] = STEP[car.dir];
  const occupied = new Map<string, number>();
  for (const other of cars) {
    if (other.id === car.id) continue;
    for (const cell of footprint(other)) occupied.set(cell, other.id);
  }
  // Steps until the car has left the board entirely — past that there is nothing to hit.
  const room = car.dir === 'up' ? car.y
    : car.dir === 'down' ? rows - (car.y + car.h)
      : car.dir === 'left' ? car.x
        : cols - (car.x + car.w);

  for (let k = 1; k <= room; k++) {
    const moved: CarSpec = { ...car, x: car.x + dx * k, y: car.y + dy * k };
    for (const cell of footprint(moved)) {
      const hit = occupied.get(cell);
      if (hit !== undefined) return { carId: hit, gap: k - 1 };
    }
  }
  return null;
}
