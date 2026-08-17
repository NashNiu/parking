import { LoopSystem } from '../../game/assets/scripts/core/loop-system';
import { PaxGroup } from '../../game/assets/scripts/core/types';

/** Terse group literal, so the expectations below stay readable. */
function g(color: string, count: number): PaxGroup {
  return { color, count };
}

/** People per colour across the whole system, for the shuffle invariants. */
function counts(loop: LoopSystem): Record<string, number> {
  const out: Record<string, number> = {};
  for (const grp of [...loop.ring, ...loop.left, ...loop.right]) {
    if (grp) out[grp.color] = (out[grp.color] || 0) + grp.count;
  }
  return out;
}

test('the queue splits into same-colour groups of four', () => {
  // 6 reds -> a full group of 4 and a remainder group of 2. A group is one visual row,
  // so it must never mix colours.
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 6 }]);
  expect(loop.ring).toEqual([g('red', 4), g('red', 2), null, null]);
  expect(loop.remainingCount()).toBe(6);
});

test('a colour change starts a new group even mid-four', () => {
  // 2 reds then 2 blues are NOT packed into one group of 4.
  const loop = new LoopSystem(4, 2, [
    { color: 'red', count: 2 }, { color: 'blue', count: 2 },
  ]);
  expect(loop.ring).toEqual([g('red', 2), g('blue', 2), null, null]);
});

test('ring takes the head groups and the remainder splits in half', () => {
  // 24 reds -> 6 groups; the ring takes 4, leaving one group per channel.
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 24 }]);
  expect(loop.ring).toEqual([g('red', 4), g('red', 4), g('red', 4), g('red', 4)]);
  expect(loop.left).toEqual([g('red', 4)]);
  expect(loop.right).toEqual([g('red', 4)]);
  expect(loop.remainingCount()).toBe(24);
});

test('remainingCount counts people, not groups', () => {
  const loop = new LoopSystem(2, 0, [{ color: 'red', count: 10 }]);
  // 3 groups (4,4,2); the ring holds 2 of them, one channel holds the third.
  expect(loop.ring.length).toBe(2);
  expect(loop.remainingCount()).toBe(10);
});

test('boarding takes one passenger at a time and empties the group on the fourth', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 24 }]);
  expect(loop.passengerAtBoard()).toBe('red');
  for (let i = 0; i < 3; i++) loop.boardPassenger();
  // Three of the four are gone; the row is still there, one passenger short.
  expect(loop.ring[2]).toEqual(g('red', 1));
  expect(loop.passengerAtBoard()).toBe('red');
  loop.boardPassenger();
  expect(loop.ring[2]).toBeNull();
  expect(loop.passengerAtBoard()).toBeNull();
  expect(loop.remainingCount()).toBe(20);
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

test('an emptied cell refills from the left channel when it reaches the entrance', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 12 }]);
  // ring=[{x,4},{x,4}], left=[{x,4}], right=[]. capacity 2 => both entrances are index 0.
  for (let i = 0; i < 4; i++) loop.boardPassenger();
  expect(loop.ring).toEqual([g('x', 4), null]);
  loop.step(); // rotate -> [null, {x,4}]; the hole is now at the entrance
  expect(loop.ring).toEqual([g('x', 4), g('x', 4)]);
  expect(loop.left).toEqual([]);
});

test('isDrained true only when both channels are empty and the ring is cleared', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 2 }]);
  expect(loop.isDrained()).toBe(false);
  loop.ring = [null, null];
  loop.left = [];
  loop.right = [];
  expect(loop.isDrained()).toBe(true);
});

// capacity 8 / boardIndex 0 => quarter = 2, entryLeft = 2, entryRight = 6.
function twoLane(): LoopSystem {
  // 32 a + 16 b -> 8 groups of a (fills the ring) and 4 groups of b (2 per channel).
  return new LoopSystem(8, 0, [{ color: 'a', count: 32 }, { color: 'b', count: 16 }]);
}

test('entrances sit a quarter lap either side of the boarding index', () => {
  const loop = twoLane();
  expect(loop.entryLeft).toBe(2);
  expect(loop.entryRight).toBe(6);
  expect(loop.left).toEqual([g('b', 4), g('b', 4)]);
  expect(loop.right).toEqual([g('b', 4), g('b', 4)]);
});

test('the right entrance stays shut while the left channel still has passengers', () => {
  const loop = twoLane();
  loop.ring[5] = null;           // after the rotate this hole lands on entryRight
  loop.step();
  expect(loop.ring[6]).toBeNull();
  expect(loop.right).toEqual([g('b', 4), g('b', 4)]); // untouched
  expect(loop.left).toEqual([g('b', 4), g('b', 4)]);  // the hole never passed the left entrance
});

test('the right channel starts feeding once the left one is empty', () => {
  const loop = twoLane();
  loop.left = [];
  loop.ring[5] = null;
  loop.step();
  expect(loop.ring[6]).toEqual(g('b', 4));
  expect(loop.right).toEqual([g('b', 4)]);
});

test('a hole that is not at an entrance is not refilled', () => {
  const loop = twoLane();
  loop.ring[0] = null;           // after the rotate this hole lands on index 1, no entrance
  loop.step();
  expect(loop.ring[1]).toBeNull();
  expect(loop.left).toEqual([g('b', 4), g('b', 4)]);
});

test('reachable colors span the left-to-right channel boundary', () => {
  const loop = new LoopSystem(4, 0, [
    { color: 'a', count: 16 }, { color: 'b', count: 1 }, { color: 'c', count: 1 },
  ]);
  // ring = 4 groups of a, left = [{b,1}], right = [{c,1}]
  expect(loop.reachableColors()).toEqual(new Set(['a'])); // full ring: nothing new can enter
  loop.ring[0] = null;
  loop.ring[1] = null;
  // two holes -> the next two groups of (left ++ right) can get in
  expect(loop.reachableColors()).toEqual(new Set(['a', 'b', 'c']));
});

test('without a seed the queue keeps its authored order', () => {
  const loop = new LoopSystem(4, 0, [{ color: 'a', count: 16 }, { color: 'b', count: 16 }]);
  expect(loop.ring).toEqual([g('a', 4), g('a', 4), g('a', 4), g('a', 4)]);
});

test('a seed mixes the colors without changing how many of each there are', () => {
  const loop = new LoopSystem(12, 6, [{ color: 'a', count: 48 }, { color: 'b', count: 48 }], 7);
  expect(counts(loop)).toEqual({ a: 48, b: 48 });
  const onTrack = new Set(loop.ring.filter((x) => x !== null).map((x) => x!.color));
  expect(onTrack.size).toBe(2); // both colors on the track
});

test('shuffling keeps every group single-coloured', () => {
  // The shuffle reorders whole groups, never individual passengers -- a row that mixed
  // colours would break the whole point of drawing a group as one row.
  const loop = new LoopSystem(12, 6, [
    { color: 'a', count: 30 }, { color: 'b', count: 30 }, { color: 'c', count: 30 },
  ], 3);
  for (const grp of [...loop.ring, ...loop.left, ...loop.right]) {
    if (!grp) continue;
    expect(grp.count).toBeGreaterThan(0);
    expect(grp.count).toBeLessThanOrEqual(4);
  }
  expect(counts(loop)).toEqual({ a: 30, b: 30, c: 30 });
});

test('the same seed always shuffles the same way', () => {
  const build = () => new LoopSystem(12, 6, [{ color: 'a', count: 48 }, { color: 'b', count: 48 }], 7);
  expect(build().ring).toEqual(build().ring);
});
