import { footprint, pathClear } from '../../game/assets/scripts/core/move-solver';
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
