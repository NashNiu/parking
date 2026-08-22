import { LoopSystem } from '../../game/assets/scripts/core/loop-system';
import { DEFAULT_FEEDS, Feed, GROUP_SIZE, PaxGroup } from '../../game/assets/scripts/core/types';

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

/** People per colour across the whole system, for the shuffle invariants. */
function counts(loop: LoopSystem): Record<string, number> {
  const out: Record<string, number> = {};
  for (const grp of [...loop.ring, ...loop.channels.flatMap((c) => c.queue)]) {
    if (grp) out[grp.color] = (out[grp.color] || 0) + grp.count;
  }
  return out;
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

test('without a seed the queue keeps its authored order', () => {
  const loop = new LoopSystem(4, 0, [{ color: 'a', count: 4 * G }, { color: 'b', count: 4 * G }]);
  expect(loop.ring).toEqual([g('a', G), g('a', G), g('a', G), g('a', G)]);
});

test('a seed mixes the colors without changing how many of each there are', () => {
  const loop = new LoopSystem(12, 6, [{ color: 'a', count: 12 * G }, { color: 'b', count: 12 * G }], DEFAULT_FEEDS, 7);
  expect(counts(loop)).toEqual({ a: 12 * G, b: 12 * G });
  const onTrack = new Set(loop.ring.filter((x) => x !== null).map((x) => x!.color));
  expect(onTrack.size).toBe(2); // both colors on the track
});

test('shuffling keeps every group single-coloured', () => {
  // The shuffle reorders whole groups, never individual passengers -- a row that mixed
  // colours would break the whole point of drawing a group as one row.
  // Counts that are NOT multiples of G on purpose, so every colour ends in a remainder
  // group and the shuffle has ragged blocks to move around.
  const odd = 3 * G + 3;
  const loop = new LoopSystem(12, 6, [
    { color: 'a', count: odd }, { color: 'b', count: odd }, { color: 'c', count: odd },
  ], DEFAULT_FEEDS, 3);
  for (const grp of [...loop.ring, ...loop.channels.flatMap((c) => c.queue)]) {
    if (!grp) continue;
    expect(grp.count).toBeGreaterThan(0);
    expect(grp.count).toBeLessThanOrEqual(G);
  }
  expect(counts(loop)).toEqual({ a: odd, b: odd, c: odd });
});

test('the same seed always shuffles the same way', () => {
  const build = () => new LoopSystem(12, 6, [{ color: 'a', count: 12 * G }, { color: 'b', count: 12 * G }], DEFAULT_FEEDS, 7);
  expect(build().ring).toEqual(build().ring);
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
