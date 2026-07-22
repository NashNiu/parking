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

  remainingCount(): number {
    return this.pool.length + this.ring.filter((x) => x !== null).length;
  }

  isDrained(): boolean {
    return this.remainingCount() === 0;
  }
}
