import { LoopSystem } from '../../game/assets/scripts/core/loop-system';

test('ring takes the head of the queue and the remainder splits in half', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 6 }]);
  expect(loop.ring).toEqual(['red', 'red', 'red', 'red']);
  expect(loop.left).toEqual(['red']);
  expect(loop.right).toEqual(['red']);
  expect(loop.remainingCount()).toBe(6);
});

test('passengerAtBoard reads the board position', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 6 }]);
  expect(loop.passengerAtBoard()).toBe('red');
  loop.boardPassenger();
  expect(loop.passengerAtBoard()).toBeNull();
});

test('step rotates ring forward by one', () => {
  const loop = new LoopSystem(4, 2, [
    { color: 'a', count: 1 }, { color: 'b', count: 1 },
    { color: 'c', count: 1 }, { color: 'd', count: 1 },
  ]);
  // ring = [a,b,c,d], both channels empty; index i moves to i+1 => [d,a,b,c]
  loop.step();
  expect(loop.ring).toEqual(['d', 'a', 'b', 'c']);
});

test('an emptied cell refills from the left channel when it reaches the entrance', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 3 }]);
  // ring=[x,x], left=[x], right=[]. capacity 2 => both entrances collapse to index 0.
  loop.boardPassenger();
  expect(loop.ring).toEqual(['x', null]);
  loop.step(); // rotate -> [null, x]; the hole is now at the entrance
  expect(loop.ring).toEqual(['x', 'x']);
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
  return new LoopSystem(8, 0, [{ color: 'a', count: 8 }, { color: 'b', count: 4 }]);
}

test('entrances sit a quarter lap either side of the boarding index', () => {
  const loop = twoLane();
  expect(loop.entryLeft).toBe(2);
  expect(loop.entryRight).toBe(6);
  expect(loop.left).toEqual(['b', 'b']);
  expect(loop.right).toEqual(['b', 'b']);
});

test('the right entrance stays shut while the left channel still has passengers', () => {
  const loop = twoLane();
  loop.ring[5] = null;           // after the rotate this hole lands on entryRight
  loop.step();
  expect(loop.ring[6]).toBeNull();
  expect(loop.right).toEqual(['b', 'b']); // untouched
  expect(loop.left).toEqual(['b', 'b']);  // the hole never passed the left entrance
});

test('the right channel starts feeding once the left one is empty', () => {
  const loop = twoLane();
  loop.left = [];
  loop.ring[5] = null;
  loop.step();
  expect(loop.ring[6]).toBe('b');
  expect(loop.right).toEqual(['b']);
});

test('a hole that is not at an entrance is not refilled', () => {
  const loop = twoLane();
  loop.ring[0] = null;           // after the rotate this hole lands on index 1, no entrance
  loop.step();
  expect(loop.ring[1]).toBeNull();
  expect(loop.left).toEqual(['b', 'b']);
});

test('reachable colors span the left-to-right channel boundary', () => {
  const loop = new LoopSystem(4, 0, [
    { color: 'a', count: 4 }, { color: 'b', count: 1 }, { color: 'c', count: 1 },
  ]);
  // ring = [a,a,a,a], left = ['b'], right = ['c']
  expect(loop.reachableColors()).toEqual(new Set(['a'])); // full ring: nothing new can enter
  loop.ring[0] = null;
  loop.ring[1] = null;
  // two holes -> the next two of (left ++ right) can get in
  expect(loop.reachableColors()).toEqual(new Set(['a', 'b', 'c']));
});

function counts(loop: LoopSystem): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of [...loop.ring, ...loop.left, ...loop.right]) {
    if (c) out[c] = (out[c] || 0) + 1;
  }
  return out;
}

test('without a seed the queue keeps its authored order', () => {
  const loop = new LoopSystem(4, 0, [{ color: 'a', count: 4 }, { color: 'b', count: 4 }]);
  expect(loop.ring).toEqual(['a', 'a', 'a', 'a']);
});

test('a seed mixes the colors without changing how many of each there are', () => {
  const loop = new LoopSystem(12, 6, [{ color: 'a', count: 12 }, { color: 'b', count: 12 }], 7);
  expect(counts(loop)).toEqual({ a: 12, b: 12 });
  expect(new Set(loop.ring.filter((c) => c !== null)).size).toBe(2); // both colors on the track
});

test('the same seed always shuffles the same way', () => {
  const build = () => new LoopSystem(12, 6, [{ color: 'a', count: 12 }, { color: 'b', count: 12 }], 7);
  expect(build().ring).toEqual(build().ring);
});
