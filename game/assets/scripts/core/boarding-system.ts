import { LoopSystem } from './loop-system';
import { ParkingSystem } from './parking-system';

export interface BoardResult {
  boardedColor: string | null;
  /** How many of the row got on this tick — the view flies exactly this many figures. */
  boardedCount: number;
  departedCarIds: number[];
  /**
   * The parking slot each boarded passenger went into, in boarding order (so its length
   * equals `boardedCount`). The view needs this because a car that fills on this tick is
   * already gone from `parking.parked` by the time the view runs -- and because a row can
   * legitimately split across two cars of the same colour.
   */
  boardedSlots: number[];
}

export class BoardingSystem {
  constructor(
    private loop: LoopSystem,
    private parking: ParkingSystem,
  ) {}

  tick(): BoardResult {
    const color = this.loop.passengerAtBoard();
    let boardedCount = 0;
    const boardedSlots: number[] = [];
    if (color) {
      // Drain the whole row this tick, as far as the matching cars can take it: the
      // row is at the gap for one tick only, and holding it there for four ticks would
      // stall the loop. Seats can run out mid-row (and can span two cars of the same
      // colour) — whoever is left stays in the row and rides round again.
      while (this.loop.passengerAtBoard() === color) {
        const slot = this.parking.findMatchingSlot(color);
        if (slot === -1) break;
        this.parking.board(slot);
        boardedSlots.push(slot);
        this.loop.boardPassenger();
        boardedCount++;
      }
    }
    const departedCarIds = this.parking.removeFull();
    this.loop.step();
    return { boardedColor: boardedCount > 0 ? color : null, boardedCount, departedCarIds, boardedSlots };
  }
}
