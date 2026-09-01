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
   * Arrival order, ascending, from a counter that never resets while the bay lives -- so it
   * is a total order over every car that has ever parked, unlike the slot index, which is
   * REUSED the moment a car departs.
   *
   * Handed out by `park` and then AGAIN by `setReady` on every false-to-true edge, and the
   * second one is what counts wherever a view is driving cars in. Arrival is the event that
   * matters: a car cannot take a passenger before it is in the stall, so ordering the queue
   * by the tap instead lets a car that is still on the road outrank one that has already
   * landed and started filling. Core-only callers never touch `ready`, so for them `park`'s
   * number stands and nothing changes.
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

  /** Whether any of the bay's stalls is still locked. */
  canUnlock(): boolean {
    return this.parked.length < this.slots;
  }

  /**
   * Open the next locked stall and return its index, or -1 when they are all open.
   *
   * `parked.length` IS the unlocked count -- the array is built `unlocked` long, not
   * `slots` long -- so opening a stall is appending one empty slot. That also means every
   * existing index keeps its car and its `seq`, which the boarding order depends on.
   *
   * Deliberately not a throw on exhaustion, unlike `park`. A player double-tapping the
   * last locked stall is ordinary, and -1 is a thing the caller can render; `park`'s throw
   * guards an invariant the caller checked first (`hasFreeSlot`) and so cannot happen.
   */
  unlock(): number {
    if (!this.canUnlock()) return -1;
    this.parked.push(null);
    return this.parked.length - 1;
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
   * A car still driving in (`ready` false) is skipped rather than waited for -- it has not
   * arrived yet, so it has no claim on being first. And when it does land it joins the queue
   * at the BACK, not at the place its tap would have earnt it: `setReady` hands out a new
   * `seq` on arrival for exactly that reason. Letting it jump ahead of a car that had already
   * landed and started filling is how the abandoned-part-filled-car state came back after
   * this note was first written.
   *
   * Together those two rules give the invariant the bay is really judged on: AT MOST ONE
   * PART-FILLED CAR PER COLOUR. A row splitting across two cars is the one exception, and it
   * settles within the tick -- the car it fills departs in the same `removeFull`.
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
   *
   * BECOMING ready takes a fresh `seq`, so the queue is ordered by when cars ARRIVED. It
   * used to be ordered by when they were tapped, which is what `park` hands out -- and the
   * two orders disagree. The drive is a route walked at a constant speed, and its length
   * depends on where the car stood in the lot and which stall it is heading for, so tapping
   * A and then B routinely lands B first. B would then take a row, A would land and outrank
   * it on a number it earnt by being tapped first, and B was stranded part-filled: the
   * "two same-coloured cars, neither close to leaving" state, reached down a different road
   * than the slot-index bug this replaced but ending in exactly the same place.
   *
   * Only on the FALSE-to-TRUE edge. A second call on a car already ready must not move it
   * to the back of the queue -- that would abandon it mid-fill, which is the state all of
   * this exists to prevent.
   */
  setReady(slotIndex: number, ready: boolean): void {
    const p = this.parked[slotIndex];
    if (!p) return;
    if (ready && !p.ready) p.seq = this.nextSeq++;
    p.ready = ready;
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
