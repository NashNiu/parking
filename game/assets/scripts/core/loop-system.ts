import {
  BOARD_CELLS, CLUSTER_ROWS, DEFAULT_FEEDS, Feed, FeedSide, GROUP_SIZE, PaxGroup, QueueGroup,
} from './types';
import { entryIndex } from './track-path';

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
 * Chop a colour-ordered row list into CLUSTERS: runs of at most CLUSTER_ROWS consecutive
 * rows of ONE colour. A colour change always ends a cluster, so a cluster is never mixed.
 *
 * `toGroups` hands over the rows grouped by colour already (the queue is authored one entry
 * per colour), so this walks that order and cuts it up rather than sorting anything.
 *
 * Exported for its test: CLUSTER_ROWS is 1 at the moment, which makes the clustering
 * invisible in the dealt order (one row per cluster is just a per-row shuffle), so testing
 * it through `LoopSystem` alone would assert nothing about the mechanism.
 */
export function toClusters(rows: PaxGroup[]): PaxGroup[][] {
  const clusters: PaxGroup[][] = [];
  let open: PaxGroup[] | null = null;
  for (const row of rows) {
    if (open === null || open[0].color !== row.color || open.length >= CLUSTER_ROWS) {
      open = [];
      clusters.push(open);
    }
    open.push(row);
  }
  return clusters;
}

/**
 * Shuffle CLUSTERS of same-coloured rows rather than rows, and flatten the result.
 *
 * At CLUSTER_ROWS 1 -- where it stands, and see that constant for the measurements that put
 * it there -- a cluster is one row and this is exactly the per-row Fisher-Yates the game
 * shipped with. Above 1 each colour arrives as a band of up to CLUSTER_ROWS rows, which pays
 * out through the doorway in one burst instead of several; it also collapses the ring's
 * colour mix, which is why the knob is at 1.
 *
 * Two clusters of the same colour can land next to each other, giving a band longer than
 * CLUSTER_ROWS. That is left alone deliberately: it is rare, it is not wrong, and rejecting
 * it would mean a shuffle that is no longer uniform over the clusters -- and no longer
 * reproducible from the seed alone by anything as simple as this.
 */
function shuffleClusters(rows: PaxGroup[], next: () => number): PaxGroup[] {
  const clusters = toClusters(rows);
  shuffleInPlace(clusters, next);
  return clusters.flat();
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

/**
 * A feeder channel: its ring entry, the rows waiting in it, and how many of them the
 * view draws. Channels are held in DRAIN ORDER — `channels[0]` empties before
 * `channels[1]` opens — because arrival order is what `reachableColors` (and with it
 * the deadlock check) reasons about.
 */
export interface Channel {
  side: FeedSide;
  lookahead: number;
  entry: number;
  queue: PaxGroup[];
}

/** Far drains before near, so that is the order channels are held in. */
const DRAIN_ORDER: FeedSide[] = ['far', 'near'];

export class LoopSystem {
  /** Number of ring cells, i.e. ROWS on the track — not the number of passengers. */
  capacity: number;
  boardIndex: number;
  ring: (PaxGroup | null)[];
  /** Feeder channels in drain order; 1 or 2 of them. */
  channels: Channel[];
  /**
   * Cells either side of `boardIndex` that are also inside the doorway, so the window is
   * `2 * boardHalf + 1` cells wide. See BOARD_CELLS for why it is clamped.
   */
  readonly boardHalf: number;

  constructor(
    capacity: number,
    boardIndex: number,
    queue: QueueGroup[],
    feeds: Feed[] = DEFAULT_FEEDS,
    shuffleSeed?: number,
  ) {
    this.capacity = capacity;
    this.boardIndex = boardIndex;
    // Never so wide that the window swallows an entry cell (boardIndex +- capacity/4);
    // see BOARD_CELLS. The floor of 0 is what leaves the toy rings in the tests with the
    // single-cell doorway they were written against.
    this.boardHalf = Math.max(0, Math.min(
      (BOARD_CELLS - 1) >> 1, Math.floor(capacity / 4) - 1,
    ));
    let all = toGroups(queue);
    // Shuffle before the ring is filled so the track shows a mix instead of one
    // solid colour block per queue group. Optional and seeded: callers that pass
    // no seed (the unit tests) keep the authored order. Whole CLUSTERS of same-coloured
    // rows move, never individual passengers and never the rows inside a cluster, so
    // every row stays one colour. At CLUSTER_ROWS 1, where the knob stands, a cluster is
    // one row and this is the per-row shuffle the game shipped with.
    if (shuffleSeed !== undefined) all = shuffleClusters(all, rng(shuffleSeed));
    this.ring = new Array(capacity).fill(null);
    for (let i = 0; i < capacity && all.length > 0; i++) this.ring[i] = all.shift()!;

    // Channels in drain order, then the remaining rows dealt out in that same order.
    // With two channels this is the even split M6 shipped; with one, everything goes
    // to it. The split never reorders anything — a seed, when given, is what changes
    // the order (via the shuffle above).
    let ordered = DRAIN_ORDER.filter((side) => feeds.some((f) => f.side === side))
      .map((side) => feeds.find((f) => f.side === side) as Feed);
    // A `feeds` with no recognised side (empty, or a hand-edited level JSON with a
    // typo'd side string) must not fall through to zero channels: with `ordered`
    // empty, `per` below would be Infinity and every waiting row would be silently
    // unreachable forever — `step()` never admits one, `remainingCount()` never
    // counts it, and `isDrained()` reports a win the player never earned. Falling
    // back to the two channels a level gets when it omits `feeds` entirely keeps a
    // misauthored level playable; flagging the mistake is the level validator's job,
    // not the constructor's.
    if (ordered.length === 0) ordered = DEFAULT_FEEDS;
    const per = Math.ceil(all.length / ordered.length);
    this.channels = ordered.map((feed, i) => ({
      side: feed.side,
      lookahead: feed.lookahead,
      entry: entryIndex(capacity, boardIndex, feed.side),
      queue: all.slice(i * per, (i + 1) * per),
    }));
  }

  /**
   * The ring cells inside the doorway, in the order they must be offered seats: the cell
   * about to LEAVE the window first, then upstream from it.
   *
   * Order is not cosmetic. Contents travel from index i to i + 1 (see `step`), so the cell
   * at `boardIndex + boardHalf` is on its last tick inside the door while the one at
   * `boardIndex - boardHalf` still has `2 * boardHalf` ticks to come. Serving the leaving
   * edge first means a scarce run of seats goes to the row that will not get another
   * chance, instead of to one that would have boarded two ticks later anyway. It also
   * reads the way a door reads: whoever is nearest the exit gets on first.
   */
  boardIndices(): number[] {
    const out: number[] = [];
    for (let d = this.boardHalf; d >= -this.boardHalf; d--) {
      out.push((this.boardIndex + d + this.capacity) % this.capacity);
    }
    return out;
  }

  /** Colour of the row in ring cell `cell`, or null when the cell is empty. */
  passengerAt(cell: number): string | null {
    return this.ring[cell]?.color ?? null;
  }

  /** How many are still standing in ring cell `cell`; 0 when it is empty. */
  countAt(cell: number): number {
    return this.ring[cell]?.count ?? 0;
  }

  /**
   * Board ONE passenger out of ring cell `cell`. The row stays put, one figure shorter,
   * until its last passenger leaves and the cell opens up — so a row only frees its cell
   * (and lets a waiting row in) once it is fully aboard.
   */
  boardPassengerAt(cell: number): void {
    const group = this.ring[cell];
    if (!group) return;
    group.count--;
    if (group.count <= 0) this.ring[cell] = null;
  }

  /**
   * Colour of the row at the MIDDLE of the doorway. Kept because the middle cell is still
   * the one the ring is indexed from, and reading it is how a caller asks "is anything at
   * the gap" without caring about the window's width.
   */
  passengerAtBoard(): string | null {
    return this.passengerAt(this.boardIndex);
  }

  /** Board one passenger out of the middle cell. See `boardPassengerAt`. */
  boardPassenger(): void {
    this.boardPassengerAt(this.boardIndex);
  }

  step(): void {
    const rotated: (PaxGroup | null)[] = new Array(this.capacity).fill(null);
    for (let i = 0; i < this.capacity; i++) {
      rotated[(i + 1) % this.capacity] = this.ring[i];
    }
    this.ring = rotated;
    // One entrance is live at a time, in drain order: the far channel empties before
    // the near one opens. That keeps arrival order identical to a single FIFO pool,
    // which is what `reachableColors` (and the deadlock check) rely on.
    const live = this.channels.find((c) => c.queue.length > 0);
    if (live && this.ring[live.entry] === null) {
      this.ring[live.entry] = live.queue.shift()!;
    }
  }

  /**
   * Colors that can still reach the boarding index.
   *
   * Passengers only enter the ring through the live entrance (channels drain in
   * order, far before near), and only while its cell is empty — and cells are only
   * emptied by boarding. So a full ring is sealed: the queues behind it can never
   * get in. Reachable = whatever the ring holds now, plus (for each empty cell) the
   * next entries of the channels' queues concatenated in drain order, since every
   * cell rotates past an entrance and takes the head of whichever queue is live.
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
    const waiting = this.channels.flatMap((c) => c.queue);
    for (let i = 0; i < empty; i++) {
      const grp = waiting[i];
      if (grp === undefined) break;
      reachable.add(grp.color);
    }
    return reachable;
  }

  /** PEOPLE still in play (the HUD's "passengers left"), not rows. */
  remainingCount(): number {
    let total = 0;
    for (const channel of this.channels) {
      for (const grp of channel.queue) total += grp.count;
    }
    for (const grp of this.ring) if (grp) total += grp.count;
    return total;
  }

  isDrained(): boolean {
    return this.remainingCount() === 0;
  }
}
