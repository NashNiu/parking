import { GridSystem } from '../../game/assets/scripts/core/grid-system';
import { CarSpec } from '../../game/assets/scripts/core/types';

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small', ...over,
});

test('a car with a clear path can exit', () => {
  const g = new GridSystem(3, 3, [car({ id: 1, x: 1, y: 2, dir: 'up' })]);
  expect(g.canExit(1)).toBe(true);
});

test('a car blocked by another cannot exit', () => {
  const g = new GridSystem(3, 3, [
    car({ id: 1, x: 1, y: 2, dir: 'up' }),
    car({ id: 2, x: 1, y: 0, dir: 'up' }),
  ]);
  expect(g.canExit(1)).toBe(false);
});

test('removing the blocker frees the blocked car', () => {
  const g = new GridSystem(3, 3, [
    car({ id: 1, x: 1, y: 2, dir: 'up' }),
    car({ id: 2, x: 1, y: 0, dir: 'up' }),
  ]);
  g.removeCar(2);
  expect(g.canExit(1)).toBe(true);
});

test('isEmpty is true only after all cars removed', () => {
  const g = new GridSystem(3, 3, [car({ id: 1 })]);
  expect(g.isEmpty()).toBe(false);
  g.removeCar(1);
  expect(g.isEmpty()).toBe(true);
});

test('movableCarIds lists only currently exitable cars', () => {
  const g = new GridSystem(3, 3, [
    car({ id: 1, x: 1, y: 2, dir: 'up' }),
    car({ id: 2, x: 1, y: 0, dir: 'up' }),
  ]);
  expect(g.movableCarIds()).toEqual([2]);
});
