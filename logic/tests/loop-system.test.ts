import { LoopSystem } from '../../game/assets/scripts/core/loop-system';
import {
  BOARD_CELLS, DEFAULT_FEEDS, Feed, GROUP_SIZE, PaxGroup,
} from '../../game/assets/scripts/core/types';

/**
 * A full group, as a number. Every passenger count below is written as a multiple of it
 * plus a deliberate remainder, so these tests keep testing the SPLIT rather than the
 * particular size a group happened to be when they were written (it has been 4 and is
 * now 8; only the remainder cases care about the exact value).
 */
const G = GROUP_SIZE;

/** Terse group literal, so the expectations below stay readable. */
function g(color: string, count: number): PaxGroup {
  return { color, count };
}

test('the queue splits into same-colour groups of GROUP_SIZE', () => {
  // G + 2 reds -> a full group and a remainder group of 2. A group is one visual block,
  // so it must never mix colours.
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: G + 2 }]);
  expect(loop.ring).toEqual([g('red', G), g('red', 2), null, null]);
  expect(loop.remainingCount()).toBe(G + 2);
});

test('a colour change starts a new group even mid-block', () => {
  // 2 reds then 2 blues are NOT packed into one group.
  const loop = new LoopSystem(4, 2, [
    { color: 'red', count: 2 }, { color: 'blue', count: 2 },
  ]);
  expect(loop.ring).toEqual([g('red', 2), g('blue', 2), null, null]);
});

test('ring takes the head groups and the remainder splits in half', () => {
  // 6 groups of reds; the ring takes 4, leaving one group per channel.
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 6 * G }]);
  expect(loop.ring).toEqual([g('red', G), g('red', G), g('red', G), g('red', G)]);
  expect(loop.channels[0].queue).toEqual([g('red', G)]);
  expect(loop.channels[1].queue).toEqual([g('red', G)]);
  expect(loop.remainingCount()).toBe(6 * G);
});

test('remainingCount counts people, not groups', () => {
  const loop = new LoopSystem(2, 0, [{ color: 'red', count: 2 * G + 2 }]);
  // 3 groups (G, G, 2); the ring holds 2 of them, one channel holds the third.
  expect(loop.ring.length).toBe(2);
  expect(loop.remainingCount()).toBe(2 * G + 2);
});

test('boarding takes one passenger at a time and empties the group on the last one', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 6 * G }]);
  expect(loop.passengerAtBoard()).toBe('red');
  for (let i = 0; i < G - 1; i++) loop.boardPassenger();
  // All but one are gone; the block is still there, holding its last passenger.
  expect(loop.ring[2]).toEqual(g('red', 1));
  expect(loop.passengerAtBoard()).toBe('red');
  loop.boardPassenger();
  expect(loop.ring[2]).toBeNull();
  expect(loop.passengerAtBoard()).toBeNull();
  expect(loop.remainingCount()).toBe(5 * G);
});

test('step rotates the groups forward by one', () => {
  const loop = new LoopSystem(4, 2, [
    { color: 'a', count: 1 }, { color: 'b', count: 1 },
    { color: 'c', count: 1 }, { color: 'd', count: 1 },
  ]);
  // ring = [a,b,c,d] as one-passenger groups; index i moves to i+1 => [d,a,b,c]
  loop.step();
  expect(loop.ring).toEqual([g('d', 1), g('a', 1), g('b', 1), g('c', 1)]);
});

test('an emptied cell refills from the far channel when it reaches the entrance', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 3 * G }]);
  // ring=[{x,G},{x,G}], far=[{x,G}], near=[]. capacity 2 => both entrances are index 0.
  for (let i = 0; i < G; i++) loop.boardPassenger();
  expect(loop.ring).toEqual([g('x', G), null]);
  loop.step(); // rotate -> [null, {x,G}]; the hole is now at the entrance
  expect(loop.ring).toEqual([g('x', G), g('x', G)]);
  expect(loop.channels[0].queue).toEqual([]);
});

test('isDrained true only when both channels are empty and the ring is cleared', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 2 }]);
  expect(loop.isDrained()).toBe(false);
  loop.ring = [null, null];
  loop.channels[0].queue = [];
  loop.channels[1].queue = [];
  expect(loop.isDrained()).toBe(true);
});

// capacity 8 / boardIndex 0 => quarter = 2, entry far = 2, entry near = 6.
function twoLane(): LoopSystem {
  // 8 groups of a (fills the ring) and 4 groups of b (2 per channel).
  return new LoopSystem(8, 0, [{ color: 'a', count: 8 * G }, { color: 'b', count: 4 * G }]);
}

test('entrances sit a quarter lap either side of the boarding index', () => {
  const loop = twoLane();
  expect(loop.channels[0].entry).toBe(2);
  expect(loop.channels[1].entry).toBe(6);
  expect(loop.channels[0].queue).toEqual([g('b', G), g('b', G)]);
  expect(loop.channels[1].queue).toEqual([g('b', G), g('b', G)]);
});

test('the near entrance stays shut while the far channel still has passengers', () => {
  const loop = twoLane();
  loop.ring[5] = null;           // after the rotate this hole lands on the near entry
  loop.step();
  expect(loop.ring[6]).toBeNull();
  expect(loop.channels[1].queue).toEqual([g('b', G), g('b', G)]); // untouched
  expect(loop.channels[0].queue).toEqual([g('b', G), g('b', G)]); // the hole never passed the far entrance
});

test('the near channel starts feeding once the far one is empty', () => {
  const loop = twoLane();
  loop.channels[0].queue = [];
  loop.ring[5] = null;
  loop.step();
  expect(loop.ring[6]).toEqual(g('b', G));
  expect(loop.channels[1].queue).toEqual([g('b', G)]);
});

test('a hole that is not at an entrance is not refilled', () => {
  const loop = twoLane();
  loop.ring[0] = null;           // after the rotate this hole lands on index 1, no entrance
  loop.step();
  expect(loop.ring[1]).toBeNull();
  expect(loop.channels[0].queue).toEqual([g('b', G), g('b', G)]);
});

test('reachable colors span the far-to-near channel boundary', () => {
  const loop = new LoopSystem(4, 0, [
    { color: 'a', count: 4 * G }, { color: 'b', count: 1 }, { color: 'c', count: 1 },
  ]);
  // ring = 4 groups of a, far = [{b,1}], near = [{c,1}]
  expect(loop.reachableColors()).toEqual(new Set(['a'])); // full ring: nothing new can enter
  loop.ring[0] = null;
  loop.ring[1] = null;
  // two holes -> the next two groups of (far ++ near) can get in
  expect(loop.reachableColors()).toEqual(new Set(['a', 'b', 'c']));
});

test('the queue is consumed in the order it was authored', () => {
  // The queue's ORDER is level data now. There is no shuffle and no seed: ring cell i holds
  // authored row i, so a band the generator put at the front of the queue is a band the
  // player sees at the front of the track.
  const loop = new LoopSystem(4, 0, [{ color: 'a', count: 4 * G }, { color: 'b', count: 4 * G }]);
  expect(loop.ring).toEqual([g('a', G), g('a', G), g('a', G), g('a', G)]);
  expect(loop.channels.flatMap((c) => c.queue)).toEqual([
    g('b', G), g('b', G), g('b', G), g('b', G),
  ]);
});

test('a band of one colour lands on neighbouring ring cells', () => {
  // What the whole design is for: an authored band of six rows occupies six adjacent cells,
  // so the BOARD_CELLS doorway can take three of them in one burst.
  const loop = new LoopSystem(12, 6, [
    { color: 'a', count: 6 * G }, { color: 'b', count: 6 * G },
  ]);
  expect(loop.ring.map((x) => x!.color)).toEqual([
    'a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'b', 'b',
  ]);
});

test('the default feeds reproduce two channels split down the middle', () => {
  const loop = new LoopSystem(8, 0, [g('a', 8 * G), g('b', 8 * G)]);
  expect(loop.channels.map((c) => c.side)).toEqual(['far', 'near']);
  expect(loop.channels[0].queue.length).toBe(4);
  expect(loop.channels[1].queue.length).toBe(4);
});

test('channels are ordered by drain order, far first', () => {
  // The far channel is three quarters of a lap from the gap, so draining it first is
  // what gives a twin-channel level its built-in escalation: a wide planning window
  // early, a narrow one once the near channel takes over.
  const loop = new LoopSystem(8, 0, [g('a', 16 * G)]);
  expect(loop.channels[0].side).toBe('far');
  expect(loop.channels[0].entry).toBe(2);
  expect(loop.channels[1].entry).toBe(6);
});

test('a single-channel level puts every waiting row in that one channel', () => {
  const feeds: Feed[] = [{ side: 'near', lookahead: 2 }];
  const loop = new LoopSystem(8, 0, [g('a', 16 * G)], feeds);
  expect(loop.channels.length).toBe(1);
  expect(loop.channels[0].side).toBe('near');
  expect(loop.channels[0].queue.length).toBe(8);   // 16 rows total, 8 on the ring
});

test('a single-channel level only ever admits rows at its own entry', () => {
  const feeds: Feed[] = [{ side: 'near', lookahead: 2 }];
  const loop = new LoopSystem(8, 0, [g('a', 16 * G)], feeds);
  const entry = loop.channels[0].entry;
  const before = loop.channels[0].queue.length;
  // Open a hole anywhere BUT the entry, and step: nothing may enter.
  loop.ring[(entry + 3) % 8] = null;
  loop.step();
  expect(loop.channels[0].queue.length).toBe(before);
  // Open a hole that lands ON the entry after the rotate, and one row enters.
  loop.ring[(entry - 1 + 8) % 8] = null;
  loop.step();
  expect(loop.channels[0].queue.length).toBe(before - 1);
});

test('reachable colors read the channels in drain order', () => {
  const loop = new LoopSystem(4, 0, [g('a', 4 * G)]);
  loop.ring[1] = null;
  loop.ring[2] = null;
  loop.channels[0].queue = [g('b', 1)];
  loop.channels[1].queue = [g('c', 1)];
  // Two holes -> the next two rows of (far ++ near) can still get in.
  expect(loop.reachableColors()).toEqual(new Set(['a', 'b', 'c']));
});

test('reachable colors read the far channel before the near one', () => {
  // Same setup as above but with only ONE hole, so only the HEAD of (far ++ near)
  // can get in. With one row per channel and the two rows different colours, that
  // head is unambiguous -- unlike the drain-order test above, where two holes let
  // both rows in regardless of which channel is read first, so reversing the
  // channel order there would not be caught. Reversing it here would swap which
  // colour shows up.
  const loop = new LoopSystem(4, 0, [g('a', 4 * G)]);
  loop.ring[1] = null;
  loop.channels[0].queue = [g('b', 1)];
  loop.channels[1].queue = [g('c', 1)];
  const reachable = loop.reachableColors();
  expect(reachable.has('b')).toBe(true);
  expect(reachable.has('c')).toBe(false);
});

test('reachable colors of a single channel match the same rows in a twin channel', () => {
  // The deadlock check rests entirely on this set, so the single-channel case must not
  // quietly become more (or less) optimistic than the case M6 shipped. The two waiting
  // rows are given different colours (b and c) rather than one shared colour, so an
  // order mismatch between the single channel's queue and the twin channels'
  // concatenation would show up as a different Set, not get masked by both sides
  // reading the same colour either way.
  const rows = [g('a', 4 * G), g('b', G), g('c', G)];
  const twin = new LoopSystem(4, 0, rows.slice());
  const single = new LoopSystem(4, 0, rows.slice(), [{ side: 'far', lookahead: 3 }]);
  twin.ring[1] = null;
  single.ring[1] = null;
  expect(single.reachableColors()).toEqual(twin.reachableColors());
});

test('a sealed ring admits nothing, whatever the channel layout', () => {
  for (const feeds of [DEFAULT_FEEDS, [{ side: 'near', lookahead: 1 }] as Feed[]]) {
    const loop = new LoopSystem(4, 0, [g('a', 16 * G)], feeds);
    const waiting = loop.channels.reduce((n, c) => n + c.queue.length, 0);
    loop.step();
    expect(loop.channels.reduce((n, c) => n + c.queue.length, 0)).toBe(waiting);
  }
});

test('feeds with no recognised side fall back to the default channels, not zero', () => {
  // An empty array, or a hand-edited level JSON with a typo'd side string, must not
  // produce zero channels: with nowhere to put the rows the ring didn't fit, they
  // would be silently uncountable -- remainingCount() would drop them and isDrained()
  // would report a win the player never earned.
  const noSides: Feed[] = [];
  const badSide = [{ side: 'sideways', lookahead: 1 }] as unknown as Feed[];
  for (const feeds of [noSides, badSide]) {
    const loop = new LoopSystem(8, 0, [g('a', 16 * G)], feeds);
    expect(loop.channels.map((c) => c.side)).toEqual(['far', 'near']);
    expect(loop.remainingCount()).toBe(16 * G);
  }
});

test('the doorway window is symmetric about boardIndex and wraps the ring', () => {
  const loop = new LoopSystem(28, 14, [{ color: 'a', count: 28 * G }]);
  expect(loop.boardHalf).toBe((BOARD_CELLS - 1) >> 1);
  expect(loop.boardIndices()).toEqual([15, 14, 13]);

  // boardIndex 0 puts the window across the seam, which must not produce a negative index.
  const wrapped = new LoopSystem(28, 0, [{ color: 'a', count: 28 * G }]);
  expect(wrapped.boardIndices()).toEqual([1, 0, 27]);
});

test('the doorway never reaches an entry cell', () => {
  // A row boarded on the tick it entered would have the entry animation flying a figure
  // that is already gone.
  for (const capacity of [4, 8, 12, 28, 32, 36]) {
    const boardIndex = capacity / 2;
    const loop = new LoopSystem(capacity, boardIndex, [{ color: 'a', count: capacity * G }]);
    const entries = new Set(loop.channels.map((c) => c.entry));
    for (const cell of loop.boardIndices()) expect(entries.has(cell)).toBe(false);
  }
});

/**
 * `stillFilling` is the gate the deadlock checks wait on, so its two false cases matter as
 * much as its true one: a ring that is full and a ring whose queues are spent are both
 * SETTLED, and holding off on either would be the board going quiet forever.
 */
test('stillFilling is true only while a row can still arrive on its own', () => {
  // Four rows of red into four cells: full on construction, queues spent. Settled twice over.
  const full = new LoopSystem(4, 2, [{ color: 'red', count: 16 }]);
  expect(full.ring.some((g) => g === null)).toBe(false);
  expect(full.stillFilling()).toBe(false);

  // Four rows into six cells: two gaps, and nothing left to put in them. Also settled --
  // those gaps are permanent, which is exactly when the prompt SHOULD be allowed to speak.
  const short = new LoopSystem(6, 2, [{ color: 'red', count: 4 }, { color: 'blue', count: 12 }]);
  expect(short.ring.filter((g) => g === null)).toHaveLength(2);
  expect(short.channels.every((c) => c.queue.length === 0)).toBe(true);
  expect(short.stillFilling()).toBe(false);

  // The reported shape: rows waiting behind a full ring, then a cell opens. Only boarding
  // can open one, which is why this is the only way the state arises in play.
  const live = new LoopSystem(4, 2, [{ color: 'red', count: 4 }, { color: 'blue', count: 20 }]);
  expect(live.stillFilling()).toBe(false);            // full ring, rows waiting: sealed
  for (let i = 0; i < 4; i++) live.boardPassengerAt(0);
  expect(live.ring[0]).toBeNull();
  expect(live.stillFilling()).toBe(true);             // a gap, and a row for it
});

/**
 * THE TERMINATION ARGUMENT, run rather than asserted in prose. If this could stay true the
 * gate would freeze the board -- the defect the unlock prompt was built to fix -- so the
 * bound is checked: every cell rotates past the live entrance within `capacity` steps.
 */
test('a ring that is still filling always settles, within capacity steps per gap', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 }, { color: 'blue', count: 20 }]);
  for (let i = 0; i < 4; i++) loop.boardPassengerAt(0);
  expect(loop.stillFilling()).toBe(true);
  let steps = 0;
  while (loop.stillFilling() && steps < 64) {
    loop.step();
    steps++;
  }
  expect(loop.stillFilling()).toBe(false);
  expect(steps).toBeLessThanOrEqual(loop.capacity);
});
