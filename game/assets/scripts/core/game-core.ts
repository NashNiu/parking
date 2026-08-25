import { DEFAULT_FEEDS, LevelData } from './types';
import { GridSystem } from './grid-system';
import { ParkingSystem } from './parking-system';
import { LoopSystem } from './loop-system';
import { BoardingSystem, BoardResult } from './boarding-system';

export type GameState = 'playing' | 'won' | 'deadlock';

/**
 * Why a tap did nothing. The view needs this because the two real refusals look identical
 * on the board -- the car simply stays put -- and want opposite things said about them: a
 * blocked lane points at the car in the way, a full lot points at the parking row. The
 * alternative was re-deriving it in the view from `canExit` and `hasFreeSlot`, i.e. two
 * copies of the rule.
 *
 * 'over' is the game already being won or deadlocked, which the view normally intercepts
 * before it gets this far.
 */
export type TapRefusal = 'blocked' | 'full' | 'over';

export interface TapResult {
  ok: boolean;
  slotIndex: number;
  /** Null when the tap succeeded. */
  reason: TapRefusal | null;
}

export class GameCore {
  readonly grid: GridSystem;
  readonly parking: ParkingSystem;
  readonly loop: LoopSystem;
  readonly boarding: BoardingSystem;
  private state: GameState = 'playing';

  constructor(level: LevelData) {
    this.grid = new GridSystem({ w: level.lot.w, h: level.lot.h }, level.lot.cars);
    this.parking = new ParkingSystem(level.parking.slots, level.parking.unlocked);
    this.loop = new LoopSystem(
      level.loop.capacity,
      level.loop.boardIndex,
      level.loop.queue,
      level.loop.feeds ?? DEFAULT_FEEDS,
      // Seeded by level id: mixed colours, but the same mix on every replay. `?? 0`
      // guards against a level JSON missing `id` (validateLevel doesn't check it) --
      // a level must never silently fall back to the unshuffled authored order.
      level.id ?? 0,
    );
    this.boarding = new BoardingSystem(this.loop, this.parking);
    this.updateState();
  }

  tapCar(carId: number): TapResult {
    if (this.state !== 'playing') return { ok: false, slotIndex: -1, reason: 'over' };
    // A full lot is checked FIRST, and the order is the point: when both refusals apply,
    // saying "blocked" would send the player to clear a car that no stall could take
    // anyway. The condition that stops every tap on the board is the one to report.
    if (!this.parking.hasFreeSlot()) return { ok: false, slotIndex: -1, reason: 'full' };
    if (!this.grid.canExit(carId)) return { ok: false, slotIndex: -1, reason: 'blocked' };
    const car = this.grid.cars.get(carId)!;
    const slotIndex = this.parking.park(car);
    this.grid.removeCar(carId);
    this.updateState();
    return { ok: true, slotIndex, reason: null };
  }

  stepLoop(): BoardResult {
    if (this.state !== 'playing') return { boardedColor: null, boardedCount: 0, departedCarIds: [], boardedSlots: [] };
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
   * "does one still exist": a queued passenger behind a ring that never empties can
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
