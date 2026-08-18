import { CarSpec, CAP_SIZE } from './types';

export interface ParkedCar {
  carId: number;
  color: string;
  capacity: number;
  filled: number;
  /**
   * Whether this car is in place and can take passengers. A car is parked in the core
   * the instant it is tapped, but the view spends a second or two driving it to the
   * stall; boarding it during that time let the loop fill and even depart a car that
   * had not arrived yet. Parking yields a READY car so core-only callers (the
   * solvability checker, the tests) behave exactly as before, and the view clears the
   * flag for as long as its drive animation runs.
   */
  ready: boolean;
}

export class ParkingSystem {
  slots: number;
  unlocked: number;
  parked: (ParkedCar | null)[];

  constructor(slots: number, unlocked: number) {
    this.slots = slots;
    this.unlocked = unlocked;
    this.parked = new Array(unlocked).fill(null);
  }

  hasFreeSlot(): boolean {
    return this.parked.some((p) => p === null);
  }

  park(car: CarSpec): number {
    const idx = this.parked.findIndex((p) => p === null);
    if (idx === -1) throw new Error('no free parking slot');
    this.parked[idx] = {
      carId: car.id,
      color: car.color,
      capacity: CAP_SIZE[car.cap],
      filled: 0,
      ready: true,
    };
    return idx;
  }

  findMatchingSlot(color: string): number {
    return this.parked.findIndex(
      (p) => p !== null && p.ready && p.color === color && p.filled < p.capacity,
    );
  }

  /**
   * Mark whether the car in `slotIndex` can take passengers yet (see ParkedCar.ready).
   * Silently ignores an empty or out-of-range slot: an arrival animation can land after
   * its car has gone, and that is not the view's mistake to crash on.
   */
  setReady(slotIndex: number, ready: boolean): void {
    const p = this.parked[slotIndex];
    if (p) p.ready = ready;
  }

  board(slotIndex: number): 'boarded' | 'full' {
    const p = this.parked[slotIndex];
    if (!p) throw new Error('empty slot');
    p.filled++;
    return p.filled >= p.capacity ? 'full' : 'boarded';
  }

  removeFull(): number[] {
    const removed: number[] = [];
    this.parked.forEach((p, i) => {
      if (p && p.filled >= p.capacity) {
        removed.push(p.carId);
        this.parked[i] = null;
      }
    });
    return removed;
  }

  allSlotsOccupied(): boolean {
    return this.parked.every((p) => p !== null);
  }

  isEmpty(): boolean {
    return this.parked.every((p) => p === null);
  }
}
