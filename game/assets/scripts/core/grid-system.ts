import { CarSpec } from './types';
import { footprint, pathClear } from './move-solver';

export class GridSystem {
  cols: number;
  rows: number;
  cars: Map<number, CarSpec>;

  constructor(cols: number, rows: number, cars: CarSpec[]) {
    this.cols = cols;
    this.rows = rows;
    this.cars = new Map(cars.map((c) => [c.id, { ...c }]));
  }

  private occupiedExcluding(carId: number): Set<string> {
    const set = new Set<string>();
    for (const [id, car] of this.cars) {
      if (id === carId) continue;
      for (const cell of footprint(car)) set.add(cell);
    }
    return set;
  }

  canExit(carId: number): boolean {
    const car = this.cars.get(carId);
    if (!car) return false;
    return pathClear(car, this.occupiedExcluding(carId), this.cols, this.rows);
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
