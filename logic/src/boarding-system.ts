import { LoopSystem } from './loop-system';
import { ParkingSystem } from './parking-system';

export interface BoardResult {
  boardedColor: string | null;
  departedCarIds: number[];
}

export class BoardingSystem {
  constructor(
    private loop: LoopSystem,
    private parking: ParkingSystem,
  ) {}

  tick(): BoardResult {
    let boardedColor: string | null = null;
    const color = this.loop.passengerAtBoard();
    if (color) {
      const slot = this.parking.findMatchingSlot(color);
      if (slot !== -1) {
        this.parking.board(slot);
        this.loop.boardPassenger();
        boardedColor = color;
      }
    }
    const departedCarIds = this.parking.removeFull();
    this.loop.step();
    return { boardedColor, departedCarIds };
  }
}
