import { LevelData } from './types';
import { GridSystem } from './grid-system';
import { ParkingSystem } from './parking-system';
import { LoopSystem } from './loop-system';
import { BoardingSystem } from './boarding-system';

export type GameState = 'playing' | 'won' | 'deadlock';

export class GameCore {
  grid: GridSystem;
  parking: ParkingSystem;
  loop: LoopSystem;
  boarding: BoardingSystem;
  private state: GameState = 'playing';

  constructor(level: LevelData) {
    this.grid = new GridSystem(level.grid.cols, level.grid.rows, level.grid.cars);
    this.parking = new ParkingSystem(level.parking.slots, level.parking.unlocked);
    this.loop = new LoopSystem(
      level.loop.capacity,
      level.loop.boardIndex,
      level.loop.queue,
    );
    this.boarding = new BoardingSystem(this.loop, this.parking);
    this.updateState();
  }

  tapCar(carId: number): boolean {
    if (this.state !== 'playing') return false;
    if (!this.grid.canExit(carId)) return false;
    if (!this.parking.hasFreeSlot()) return false;
    const car = this.grid.cars.get(carId)!;
    this.parking.park(car);
    this.grid.removeCar(carId);
    this.updateState();
    return true;
  }

  stepLoop(): void {
    if (this.state !== 'playing') return;
    this.boarding.tick();
    this.updateState();
  }

  getState(): GameState {
    return this.state;
  }

  private updateState(): void {
    if (
      this.grid.isEmpty() &&
      this.parking.isEmpty() &&
      this.loop.isDrained()
    ) {
      this.state = 'won';
      return;
    }
    if (this.isDeadlocked()) this.state = 'deadlock';
  }

  private hasRemainingColor(color: string): boolean {
    return this.loop.pool.includes(color) || this.loop.ring.includes(color);
  }

  private isDeadlocked(): boolean {
    const canBringOut =
      this.parking.hasFreeSlot() && this.grid.movableCarIds().length > 0;
    if (canBringOut) return false;
    const canFillSomething = this.parking.parked.some(
      (p) => p !== null && p.filled < p.capacity && this.hasRemainingColor(p.color),
    );
    if (canFillSomething) return false;
    return true;
  }
}
