import { footprint, pathClear, firstBlocker } from '../../game/assets/scripts/core/move-solver';
import { CarSpec } from '../../game/assets/scripts/core/types';

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small', ...over,
});

test('footprint lists all occupied cells of a 2x1 car', () => {
  expect(footprint(car({ x: 1, y: 1, w: 2, h: 1 })).sort())
    .toEqual(['1,1', '2,1'].sort());
});

test('path is clear when nothing blocks the exit direction', () => {
  const c = car({ x: 1, y: 2, dir: 'up' });
  expect(pathClear(c, new Set(), 4, 4)).toBe(true);
});

test('path is blocked by a car ahead in the exit direction', () => {
  const c = car({ x: 1, y: 2, dir: 'up' });
  const occupied = new Set(['1,0']); // blocks the upward column
  expect(pathClear(c, occupied, 4, 4)).toBe(false);
});

test('occupancy outside the exit path does not block', () => {
  const c = car({ x: 1, y: 2, dir: 'up' });
  const occupied = new Set(['0,0', '2,1']); // not in column x=1 above y=2
  expect(pathClear(c, occupied, 4, 4)).toBe(true);
});

test('wide car needs every column of its width clear', () => {
  const c = car({ x: 0, y: 1, w: 2, h: 1, dir: 'up' });
  expect(pathClear(c, new Set(['1,0']), 4, 4)).toBe(false);
  expect(pathClear(c, new Set(['3,0']), 4, 4)).toBe(true);
});

test('nothing ahead reports no blocker', () => {
  const c = car({ x: 1, y: 2, dir: 'up' });
  expect(firstBlocker(c, [c], 4, 4)).toBeNull();
});

test('a car right against a blocker has no room to move', () => {
  const c = car({ id: 1, x: 1, y: 2, dir: 'up' });
  const wall = car({ id: 2, x: 1, y: 1 });
  expect(firstBlocker(c, [c, wall], 4, 4)).toEqual({ carId: 2, gap: 0 });
});

test('gap counts the free cells before the blocker', () => {
  const c = car({ id: 1, x: 1, y: 3, dir: 'up' });
  const wall = car({ id: 2, x: 1, y: 1 });
  expect(firstBlocker(c, [c, wall], 4, 4)).toEqual({ carId: 2, gap: 1 });
});

test('the nearest blocker is the one reported', () => {
  const c = car({ id: 1, x: 0, y: 0, dir: 'right' });
  const near = car({ id: 2, x: 2, y: 0 });
  const far = car({ id: 3, x: 3, y: 0 });
  expect(firstBlocker(c, [c, near, far], 5, 4)).toEqual({ carId: 2, gap: 1 });
});

test('a long car does not block itself', () => {
  const c = car({ id: 1, x: 1, y: 2, w: 1, h: 2, dir: 'up' });
  expect(firstBlocker(c, [c], 4, 4)).toBeNull();
});

test('a blocker outside the exit lane is ignored', () => {
  const c = car({ id: 1, x: 1, y: 2, dir: 'up' });
  const beside = car({ id: 2, x: 2, y: 0 });
  expect(firstBlocker(c, [c, beside], 4, 4)).toBeNull();
});

test('firstBlocker and pathClear always agree', () => {
  const cases: CarSpec[][] = [
    [car({ id: 1, x: 1, y: 2, dir: 'up' }), car({ id: 2, x: 1, y: 0 })],
    [car({ id: 1, x: 1, y: 2, dir: 'up' }), car({ id: 2, x: 3, y: 0 })],
    [car({ id: 1, x: 0, y: 1, w: 2, h: 1, dir: 'right' }), car({ id: 2, x: 3, y: 1 })],
    [car({ id: 1, x: 2, y: 1, dir: 'down' }), car({ id: 2, x: 2, y: 3 })],
    [car({ id: 1, x: 2, y: 1, dir: 'left' }), car({ id: 2, x: 0, y: 1 })],
  ];
  for (const cars of cases) {
    const occupied = new Set(cars.flatMap((c) => footprint(c)));
    const clear = pathClear(cars[0], occupied, 4, 4);
    expect(firstBlocker(cars[0], cars, 4, 4) === null).toBe(clear);
  }
});
