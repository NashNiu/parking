import { CarSpec, CAP_SIZE } from './types';

export interface ParkedCar {
  carId: number;
  color: string;
  capacity: number;
  filled: number;
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
    };
    return idx;
  }

  findMatchingSlot(color: string): number {
    return this.parked.findIndex(
      (p) => p !== null && p.color === color && p.filled < p.capacity,
    );
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
