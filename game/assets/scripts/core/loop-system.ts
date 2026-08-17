import { GROUP_SIZE, PaxGroup, QueueGroup } from './types';

/**
 * Deterministic PRNG (mulberry32). The shuffle must be reproducible: a level has to
 * look the same every time it is replayed, and the tests need a fixed answer.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher-Yates driven by `next`. */
function shuffleInPlace<T>(arr: T[], next: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

/**
 * Chop the authored queue into rows of at most GROUP_SIZE. A colour change always
 * starts a new row — a row is drawn as one block of same-coloured figures, so mixing
 * colours inside one would defeat the point — which means a run of 6 reds becomes
 * a row of 4 and a row of 2 rather than being packed with whatever follows.
 */
function toGroups(queue: QueueGroup[]): PaxGroup[] {
  const groups: PaxGroup[] = [];
  for (const q of queue) {
    for (let left = q.count; left > 0; left -= GROUP_SIZE) {
      groups.push({ color: q.color, count: Math.min(GROUP_SIZE, left) });
    }
  }
  return groups;
}

export class LoopSystem {
  /** Number of ring cells, i.e. ROWS on the track — not the number of passengers. */
  capacity: number;
  boardIndex: number;
  ring: (PaxGroup | null)[];
  /** Waiting rows in the left channel; drains before `right`. */
  left: PaxGroup[];
  /** Waiting rows in the right channel; only feeds once `left` is empty. */
  right: PaxGroup[];
  /** Ring indices where each channel joins the track (a quarter lap either side of the exit). */
  readonly entryLeft: number;
  readonly entryRight: number;

  constructor(capacity: number, boardIndex: number, queue: QueueGroup[], shuffleSeed?: number) {
    this.capacity = capacity;
    this.boardIndex = boardIndex;
    const all = toGroups(queue);
    // Shuffle before the ring is filled so the track shows a mix instead of one
    // solid colour block per queue group. Optional and seeded: callers that pass
    // no seed (the unit tests) keep the authored order. Whole ROWS move, never
    // individual passengers, so every row stays one colour.
    if (shuffleSeed !== undefined) shuffleInPlace(all, rng(shuffleSeed));
    // The split itself never reorders anything: the ring takes the head and the
    // remainder is halved into `left`/`right` in the order it arrives in. A seed,
    // when one is given, is what changes the order (via the shuffle above).
    this.ring = new Array(capacity).fill(null);
    for (let i = 0; i < capacity && all.length > 0; i++) this.ring[i] = all.shift()!;
    const half = Math.ceil(all.length / 2);
    this.left = all.slice(0, half);
    this.right = all.slice(half);
    const quarter = Math.round(capacity / 4);
    this.entryLeft = (boardIndex + quarter) % capacity;
    this.entryRight = (boardIndex - quarter + capacity) % capacity;
  }

  /** Colour of the row sitting at the boarding gap, or null when the cell is empty. */
  passengerAtBoard(): string | null {
    return this.ring[this.boardIndex]?.color ?? null;
  }

  /**
   * Board ONE passenger out of the row at the gap. The row stays put, one figure
   * shorter, until its last passenger leaves and the cell opens up — so a row only
   * frees its cell (and lets a waiting row in) once it is fully aboard.
   */
  boardPassenger(): void {
    const group = this.ring[this.boardIndex];
    if (!group) return;
    group.count--;
    if (group.count <= 0) this.ring[this.boardIndex] = null;
  }

  step(): void {
    const rotated: (PaxGroup | null)[] = new Array(this.capacity).fill(null);
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
   * Passengers only enter the ring through the live entrance (left drains before
   * right opens), and only while its cell is empty — and cells are only emptied
   * by boarding. So a full ring is sealed: the queues behind it can never get in.
   * Reachable = whatever the ring holds now, plus (for each empty cell) the next
   * entries of `left ++ right` in order, since every cell rotates past an entrance
   * and takes the head of whichever queue is live.
   *
   * This under-counts once boarding resumes (each boarding opens another cell and
   * lets more of the queues in), but it is exact in the only case that matters: if
   * nothing reachable can board, no cell is ever emptied, so the ring's contents
   * are frozen and this set can never grow.
   */
  reachableColors(): Set<string> {
    const reachable = new Set<string>();
    let empty = 0;
    for (const grp of this.ring) {
      if (grp === null) empty++;
      else reachable.add(grp.color);
    }
    for (let i = 0; i < empty; i++) {
      const grp = i < this.left.length ? this.left[i] : this.right[i - this.left.length];
      if (grp === undefined) break;
      reachable.add(grp.color);
    }
    return reachable;
  }

  /** PEOPLE still in play (the HUD's "passengers left"), not rows. */
  remainingCount(): number {
    let total = 0;
    for (const grp of this.left) total += grp.count;
    for (const grp of this.right) total += grp.count;
    for (const grp of this.ring) if (grp) total += grp.count;
    return total;
  }

  isDrained(): boolean {
    return this.remainingCount() === 0;
  }
}
