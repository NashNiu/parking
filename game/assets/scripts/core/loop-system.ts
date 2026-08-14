import { QueueGroup } from './types';

export class LoopSystem {
  capacity: number;
  boardIndex: number;
  ring: (string | null)[];
  /** Waiting passengers in the left channel; drains before `right`. */
  left: string[];
  /** Waiting passengers in the right channel; only feeds once `left` is empty. */
  right: string[];
  /** Ring indices where each channel joins the track (a quarter lap either side of the exit). */
  readonly entryLeft: number;
  readonly entryRight: number;

  constructor(capacity: number, boardIndex: number, queue: QueueGroup[]) {
    this.capacity = capacity;
    this.boardIndex = boardIndex;
    const all: string[] = [];
    for (const g of queue) {
      for (let i = 0; i < g.count; i++) all.push(g.color);
    }
    // The track is filled from the head of the queue exactly as before; only what
    // is left over gets split, so the order passengers arrive in never changes.
    this.ring = new Array(capacity).fill(null);
    for (let i = 0; i < capacity && all.length > 0; i++) this.ring[i] = all.shift()!;
    const half = Math.ceil(all.length / 2);
    this.left = all.slice(0, half);
    this.right = all.slice(half);
    const quarter = Math.round(capacity / 4);
    this.entryLeft = (boardIndex + quarter) % capacity;
    this.entryRight = (boardIndex - quarter + capacity) % capacity;
  }

  passengerAtBoard(): string | null {
    return this.ring[this.boardIndex];
  }

  boardPassenger(): void {
    this.ring[this.boardIndex] = null;
  }

  step(): void {
    const rotated: (string | null)[] = new Array(this.capacity).fill(null);
    for (let i = 0; i < this.capacity; i++) {
      rotated[(i + 1) % this.capacity] = this.ring[i];
    }
    this.ring = rotated;
    // One entrance is live at a time: the left channel drains first, and only then
    // does the right one open. That keeps the arrival order identical to a single
    // FIFO pool, which is what `reachableColors` (and the deadlock check) rely on.
    const useLeft = this.left.length > 0;
    const queue = useLeft ? this.left : this.right;
    const entry = useLeft ? this.entryLeft : this.entryRight;
    if (queue.length > 0 && this.ring[entry] === null) {
      this.ring[entry] = queue.shift()!;
    }
  }

  /**
   * Colors that can still reach the boarding index.
   *
   * Passengers only enter the ring through the channel cell, and only while it is
   * empty — and cells are only emptied by boarding. So a full ring is sealed: the
   * pool behind it can never get in. Reachable = whatever the ring holds now, plus
   * (for each empty cell) the next pool entries in FIFO order, since every cell
   * rotates past the channel and takes the pool's head.
   *
   * This under-counts once boarding resumes (each boarding opens another cell and
   * lets more of the pool in), but it is exact in the only case that matters: if
   * nothing reachable can board, no cell is ever emptied, so the ring's contents
   * are frozen and this set can never grow.
   */
  reachableColors(): Set<string> {
    const reachable = new Set<string>();
    let empty = 0;
    for (const c of this.ring) {
      if (c === null) empty++;
      else reachable.add(c);
    }
    for (let i = 0; i < empty; i++) {
      const c = i < this.left.length ? this.left[i] : this.right[i - this.left.length];
      if (c === undefined) break;
      reachable.add(c);
    }
    return reachable;
  }

  remainingCount(): number {
    return this.left.length + this.right.length + this.ring.filter((x) => x !== null).length;
  }

  isDrained(): boolean {
    return this.remainingCount() === 0;
  }
}
