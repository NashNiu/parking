import { BoardingSystem } from '../../game/assets/scripts/core/boarding-system';
import { LoopSystem } from '../../game/assets/scripts/core/loop-system';
import { ParkingSystem } from '../../game/assets/scripts/core/parking-system';
import { CarSpec } from '../../game/assets/scripts/core/types';

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small', ...over,
});

test('passenger boards a matching parked car and loop advances', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 16 }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  expect(res.boardedColor).toBe('red');
  expect(parking.parked[0]?.filled).toBe(1);
});

test('no matching car means no boarding, loop still advances', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 16 }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'blue', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  const before = loop.remainingCount();
  const res = boarding.tick();
  expect(res.boardedColor).toBeNull();
  expect(loop.remainingCount()).toBe(before); // nobody boarded
});

test('a car that fills up departs and its id is reported', () => {
  // small car cap 16, exactly 16 red passengers
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 16 }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 42, color: 'red', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  let departed: number[] = [];
  for (let i = 0; i < 200 && parking.parked[0] !== null; i++) {
    departed = departed.concat(boarding.tick().departedCarIds);
  }
  expect(departed).toContain(42);
  expect(parking.isEmpty()).toBe(true);
  expect(loop.isDrained()).toBe(true);
});
