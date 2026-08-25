import { CarSpec, Lot } from './types';
import { pathClear } from './move-solver';

export class GridSystem {
  lot: Lot;
  cars: Map<number, CarSpec>;

  constructor(lot: Lot, cars: CarSpec[]) {
    this.lot = { w: lot.w, h: lot.h };
    this.cars = new Map(cars.map((c) => [c.id, { ...c }]));
  }

  canExit(carId: number): boolean {
    const car = this.cars.get(carId);
    if (!car) return false;
    // pathClear skips the mover by id, so the whole list goes in as it stands.
    return pathClear(car, [...this.cars.values()], this.lot);
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
