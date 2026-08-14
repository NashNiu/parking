import { LevelData } from './types';
import { GridSystem } from './grid-system';
import { ParkingSystem } from './parking-system';
import { LoopSystem } from './loop-system';
import { BoardingSystem, BoardResult } from './boarding-system';

export type GameState = 'playing' | 'won' | 'deadlock';

export interface TapResult {
  ok: boolean;
  slotIndex: number;
}

export class GameCore {
  readonly grid: GridSystem;
  readonly parking: ParkingSystem;
  readonly loop: LoopSystem;
  readonly boarding: BoardingSystem;
  private state: GameState = 'playing';

  constructor(level: LevelData) {
    this.grid = new GridSystem(level.grid.cols, level.grid.rows, level.grid.cars);
    this.parking = new ParkingSystem(level.parking.slots, level.parking.unlocked);
    this.loop = new LoopSystem(
      level.loop.capacity,
      level.loop.boardIndex,
      level.loop.queue,
      level.id, // seeded by level id: mixed colours, but the same mix on every replay
    );
    this.boarding = new BoardingSystem(this.loop, this.parking);
    this.updateState();
  }

  tapCar(carId: number): TapResult {
    if (this.state !== 'playing') return { ok: false, slotIndex: -1 };
    if (!this.grid.canExit(carId)) return { ok: false, slotIndex: -1 };
    if (!this.parking.hasFreeSlot()) return { ok: false, slotIndex: -1 };
    const car = this.grid.cars.get(carId)!;
    const slotIndex = this.parking.park(car);
    this.grid.removeCar(carId);
    this.updateState();
    return { ok: true, slotIndex };
  }

  stepLoop(): BoardResult {
    if (this.state !== 'playing') return { boardedColor: null, departedCarIds: [] };
    const res = this.boarding.tick();
    this.updateState();
    return res;
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

  /**
   * Can a passenger of `color` still get to the boarding index? Not the same as
   * "does one still exist": a pool passenger behind a ring that never empties can
   * never board, which is exactly how a level jams (see `reachableColors`).
   */
  private hasRemainingColor(color: string): boolean {
    return this.loop.reachableColors().has(color);
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
