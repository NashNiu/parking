import { CarSpec, Lot } from './types';
import { pathClear } from './move-solver';

/**
 * The cars in the parking lot, and whether any given one can drive out.
 *
 * Named for the lot rather than for a grid because there is no grid: a car is a body at a
 * position and a heading, and "can it get out" is a swept-box question, not a walk down a
 * column of cells.
 */
export class LotSystem {
  /** The lot's extent in board units, for the exit check to measure against. */
  bounds: Lot;
  cars: Map<number, CarSpec>;

  constructor(lot: Lot, cars: CarSpec[]) {
    this.bounds = { w: lot.w, h: lot.h };
    this.cars = new Map(cars.map((c) => [c.id, { ...c }]));
  }

  canExit(carId: number): boolean {
    const car = this.cars.get(carId);
    if (!car) return false;
    // pathClear skips the mover by id, so the whole list goes in as it stands.
    return pathClear(car, [...this.cars.values()], this.bounds);
  }

  removeCar(carId: number): void {
    this.cars.delete(carId);
  }

  isEmpty(): boolean {
    return this.cars.size === 0;
  }

  movableCarIds(): number[] {
    return [...this.cars.keys()].filter((id) => this.canExit(id));
  }
}
