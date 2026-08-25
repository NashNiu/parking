import { GridSystem } from '../../game/assets/scripts/core/grid-system';
import { CarSpec } from '../../game/assets/scripts/core/types';

const LOT = { w: 9, h: 6 };
const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 0, color: 'red', cap: 'small', ...over,
});

test('a car with a clear path can exit', () => {
  const g = new GridSystem(LOT, [car({ id: 1, x: -2, y: 0, angle: 0 })]);
  expect(g.canExit(1)).toBe(true);
});

test('a car blocked by another cannot exit', () => {
  const g = new GridSystem(LOT, [
    car({ id: 1, x: -2, y: 0, angle: 0 }),
    car({ id: 2, x: 1, y: 0, angle: 0 }),
  ]);
  expect(g.canExit(1)).toBe(false);
});

test('removing the blocker frees the blocked car', () => {
  const g = new GridSystem(LOT, [
    car({ id: 1, x: -2, y: 0, angle: 0 }),
    car({ id: 2, x: 1, y: 0, angle: 0 }),
  ]);
  g.removeCar(2);
  expect(g.canExit(1)).toBe(true);
});

test('an unknown car cannot exit', () => {
  const g = new GridSystem(LOT, [car({ id: 1 })]);
  expect(g.canExit(99)).toBe(false);
});

test('isEmpty is true only after all cars removed', () => {
  const g = new GridSystem(LOT, [car({ id: 1 }), car({ id: 2, x: 2 })]);
  expect(g.isEmpty()).toBe(false);
  g.removeCar(1);
  g.removeCar(2);
  expect(g.isEmpty()).toBe(true);
});

test('movableCarIds lists only the cars that can get out', () => {
  const g = new GridSystem(LOT, [
    car({ id: 1, x: -2, y: 0, angle: 0 }),
    car({ id: 2, x: 1, y: 0, angle: 0 }),
    car({ id: 3, x: -2, y: 2, angle: 0 }),
  ]);
  expect(g.movableCarIds().sort()).toEqual([2, 3]);
});

test('the constructor copies its cars so the caller cannot mutate the lot', () => {
  const cars = [car({ id: 1, x: -2 })];
  const g = new GridSystem(LOT, cars);
  cars[0].x = 99;
  expect(g.cars.get(1)!.x).toBe(-2);
});
