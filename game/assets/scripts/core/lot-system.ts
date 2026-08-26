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
    //
    // Array.from, NOT [...map.values()] -- see `movableCarIds`.
    return pathClear(car, Array.from(this.cars.values()), this.bounds);
  }

  removeCar(carId: number): void {
    this.cars.delete(carId);
  }

  isEmpty(): boolean {
    return this.cars.size === 0;
  }

  /**
   * Array.from over the Map's iterator, NOT `[...this.cars.keys()]`.
   *
   * The spread form does not survive the WeChat mini-game build. Level 1 came up
   * `state=deadlock` there on data that node and the mobile browser both play: the lot held
   * its 36 cars, the geometry was exact (CAR_SCALE 1, CAP_BOX intact, no NaN, 22 cars
   * blocked and 14 clear when `firstBlocker` was handed a plain array), and yet this
   * returned nothing. An empty or garbage key list filters down to nothing and calls
   * `canExit` zero times, so it fails SILENTLY -- no exception, just a lot where nothing can
   * move, which `isDeadlocked` correctly reads as a dead level.
   *
   * These two lines were the only Map-iterator spreads in the whole project, and they were
   * exactly the two functions that broke; every other list built from a Map already went
   * through `Array.from` and every one of those worked in the same build. (The one other
   * spread in core, in level-data, is over `Object.keys` -- a plain array, and arrays
   * iterate fine here.)
   */
  movableCarIds(): number[] {
    return Array.from(this.cars.keys()).filter((id) => this.canExit(id));
  }
}
