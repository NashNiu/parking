import { LotSystem } from '../../game/assets/scripts/core/lot-system';
import { CarSpec, TunnelSpec } from '../../game/assets/scripts/core/types';

const LOT = { w: 9, h: 6 };
const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 0, color: 'red', cap: 'small', ...over,
});

test('a car with a clear path can exit', () => {
  const g = new LotSystem(LOT, [car({ id: 1, x: -2, y: 0, angle: 0 })]);
  expect(g.canExit(1)).toBe(true);
});

test('a car blocked by another cannot exit', () => {
  const g = new LotSystem(LOT, [
    car({ id: 1, x: -2, y: 0, angle: 0 }),
    car({ id: 2, x: 1, y: 0, angle: 0 }),
  ]);
  expect(g.canExit(1)).toBe(false);
});

test('removing the blocker frees the blocked car', () => {
  const g = new LotSystem(LOT, [
    car({ id: 1, x: -2, y: 0, angle: 0 }),
    car({ id: 2, x: 1, y: 0, angle: 0 }),
  ]);
  g.removeCar(2);
  expect(g.canExit(1)).toBe(true);
});

test('an unknown car cannot exit', () => {
  const g = new LotSystem(LOT, [car({ id: 1 })]);
  expect(g.canExit(99)).toBe(false);
});

test('isEmpty is true only after all cars removed', () => {
  const g = new LotSystem(LOT, [car({ id: 1 }), car({ id: 2, x: 2 })]);
  expect(g.isEmpty()).toBe(false);
  g.removeCar(1);
  g.removeCar(2);
  expect(g.isEmpty()).toBe(true);
});

test('movableCarIds lists only the cars that can get out', () => {
  const g = new LotSystem(LOT, [
    car({ id: 1, x: -2, y: 0, angle: 0 }),
    car({ id: 2, x: 1, y: 0, angle: 0 }),
    car({ id: 3, x: -2, y: 2, angle: 0 }),
  ]);
  expect(g.movableCarIds().sort()).toEqual([2, 3]);
});

test('the constructor copies its cars so the caller cannot mutate the lot', () => {
  const cars = [car({ id: 1, x: -2 })];
  const g = new LotSystem(LOT, cars);
  cars[0].x = 99;
  expect(g.cars.get(1)!.x).toBe(-2);
});

const tunnel = (over: Partial<TunnelSpec> = {}): TunnelSpec => ({
  id: 1, x: 1, y: 0, angle: 0,
  cars: [{ color: 'red', cap: 'small' }, { color: 'blue', cap: 'small' }],
  ...over,
});

// 1 + 1.2/2 + 0.04 + 0.964/2
const MOUTH_X = 2.122;

test('a tunnel puts its first car at the mouth', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  expect(g.cars.size).toBe(1);
  const [c] = Array.from(g.cars.values());
  expect(c.color).toBe('red');
  expect(c.x).toBeCloseTo(MOUTH_X, 3);
  expect(c.angle).toBe(0);
});

test('mouth car ids come after the grid cars', () => {
  const g = new LotSystem(LOT, [car({ id: 7, x: -3, y: 2, angle: 90 })], [tunnel()]);
  expect(g.mouthCarId(1)).toBe(8);
});

test('the next car takes the mouth when the mouth car leaves', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  const first = g.mouthCarId(1)!;
  g.removeCar(first);
  const second = g.mouthCarId(1)!;
  expect(second).not.toBe(first);
  expect(g.cars.get(second)!.color).toBe('blue');
  expect(g.cars.get(second)!.x).toBeCloseTo(MOUTH_X, 3);
});

test('the lot is empty only once the tunnel is drained', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  expect(g.isEmpty()).toBe(false);
  g.removeCar(g.mouthCarId(1)!);
  expect(g.isEmpty()).toBe(false);
  g.removeCar(g.mouthCarId(1)!);
  expect(g.mouthCarId(1)).toBeNull();
  expect(g.isEmpty()).toBe(true);
});

test('the count on the tunnel includes the car at the mouth', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  expect(g.remainingIn(1)).toBe(2);
  g.removeCar(g.mouthCarId(1)!);
  expect(g.remainingIn(1)).toBe(1);
  g.removeCar(g.mouthCarId(1)!);
  expect(g.remainingIn(1)).toBe(0);
});

test('a tunnel body blocks a car driving into its back', () => {
  // The car reaches the body (front face 0.4) long before the mouth car (1.64).
  const g = new LotSystem(LOT, [car({ id: 1, x: -2, y: 0, angle: 0 })], [tunnel()]);
  expect(g.canExit(1)).toBe(false);
});

test('a tunnel never blocks its own mouth car', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  expect(g.movableCarIds()).toEqual([g.mouthCarId(1)]);
});

test('the level data is not mutated by draining a tunnel', () => {
  const level = [tunnel()];
  const g = new LotSystem(LOT, [], level);
  g.removeCar(g.mouthCarId(1)!);
  expect(level[0].cars.length).toBe(2);
});
