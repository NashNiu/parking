import { QueueGroup } from './types';

export class LoopSystem {
  capacity: number;
  boardIndex: number;
  ring: (string | null)[];
  pool: string[];
  private channelIndex = 0;

  constructor(capacity: number, boardIndex: number, queue: QueueGroup[]) {
    this.capacity = capacity;
    this.boardIndex = boardIndex;
    this.pool = [];
    for (const g of queue) {
      for (let i = 0; i < g.count; i++) this.pool.push(g.color);
    }
    this.ring = new Array(capacity).fill(null);
    for (let i = 0; i < capacity && this.pool.length > 0; i++) {
      this.ring[i] = this.pool.shift()!;
    }
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
    if (this.ring[this.channelIndex] === null && this.pool.length > 0) {
      this.ring[this.channelIndex] = this.pool.shift()!;
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
    for (let i = 0; i < empty && i < this.pool.length; i++) reachable.add(this.pool[i]);
    return reachable;
  }

  remainingCount(): number {
    return this.pool.length + this.ring.filter((x) => x !== null).length;
  }

  isDrained(): boolean {
    return this.remainingCount() === 0;
  }
}
