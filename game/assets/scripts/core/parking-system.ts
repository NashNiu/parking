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
  /**
   * Arrival order, ascending. Assigned by `park` from a counter that never resets while
   * the bay lives, so it is a total order over every car that has ever parked -- unlike
   * the slot index, which is REUSED the moment a car departs.
   *
   * `findMatchingSlot` picks by this, and the difference is not cosmetic. See the note
   * there for the state it fixes.
   */
  seq: number;
}

export class ParkingSystem {
  slots: number;
  unlocked: number;
  parked: (ParkedCar | null)[];

  /** Next arrival number. Monotonic for the life of the bay; see ParkedCar.seq. */
  private nextSeq = 1;

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
      seq: this.nextSeq++,
    };
    return idx;
  }

  /**
   * The car a `color` passenger should board: the one that ARRIVED FIRST among those
   * that can take them, or -1 if none can.
   *
   * By arrival, not by slot index, and the distinction is the whole point. Slots are
   * reused: `park` always takes the lowest free index, so once a few cars have departed
   * the oldest car on the bay can be sitting in the highest slot. Picking by index then
   * ABANDONS it -- it keeps the passengers it already has and waits forever while newer
   * cars in lower slots take everything. Level 1 showed exactly that: two red cars on
   * the bay, the older one stranded 12 seats short while the newer one, in slot 0, was
   * already 12 passengers in. Two half-full cars of the same colour is also a worse
   * puzzle, because neither one is close to leaving.
   *
   * A car still driving in (`ready` false) is skipped rather than waited for -- it has
   * not arrived yet, so it has no claim on being first. It regains its place, ahead of
   * anything newer, the moment the view lands it.
   */
  findMatchingSlot(color: string): number {
    let best = -1;
    for (let i = 0; i < this.parked.length; i++) {
      const p = this.parked[i];
      if (!p || !p.ready || p.color !== color || p.filled >= p.capacity) continue;
      const b = best === -1 ? null : this.parked[best];
      if (!b || p.seq < b.seq) best = i;
    }
    return best;
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
