import { LoopSystem } from '../src/loop-system';

test('ring fills from pool on construction, rest stays in pool', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 6 }]);
  expect(loop.ring).toEqual(['red', 'red', 'red', 'red']);
  expect(loop.pool.length).toBe(2);
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
  // ring = [a,b,c,d]; after step -> index i moves to i+1 => [d,a,b,c]
  loop.step();
  expect(loop.ring).toEqual(['d', 'a', 'b', 'c']);
});

test('empty channel slot refills from pool after step', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 3 }]);
  // ring=[x,x], pool=[x]. board index1, then boardPassenger -> ring=[x,null]
  loop.boardPassenger();
  expect(loop.ring).toEqual(['x', null]);
  // step: rotate -> [null, x]; channel index0 is null -> refill from pool
  loop.step();
  expect(loop.ring).toEqual(['x', 'x']);
  expect(loop.pool.length).toBe(0);
});

test('isDrained true only when pool empty and ring cleared', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 2 }]);
  expect(loop.isDrained()).toBe(false);
  loop.ring = [null, null];
  loop.pool = [];
  expect(loop.isDrained()).toBe(true);
});
