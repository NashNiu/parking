import { BoardingSystem } from '../../game/assets/scripts/core/boarding-system';
import { LoopSystem } from '../../game/assets/scripts/core/loop-system';
import { ParkingSystem } from '../../game/assets/scripts/core/parking-system';
import { CarSpec, GROUP_SIZE } from '../../game/assets/scripts/core/types';

/**
 * One full block of passengers. A small car seats 16, so it takes two of these -- the
 * counts below are written against G rather than against the 4 a block held when these
 * tests were first written.
 */
const G = GROUP_SIZE;

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 90, color: 'red', cap: 'small', ...over,
});

test('a whole block boards in one tick when the car has room for it', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 * G }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  expect(res.boardedColor).toBe('red');
  expect(res.boardedCount).toBe(G);      // the block is G strong, the car seats 16
  expect(parking.parked[0]?.filled).toBe(G);
  expect(loop.remainingCount()).toBe(3 * G);
});

test('a block larger than the seats left boards what fits and keeps the rest', () => {
  // The block must not be lost or teleported: whoever could not get on stays on the
  // track and rides round again, which is the only way partial blocks stay honest.
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 * G }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  parking.parked[0]!.filled = 14;        // two seats left
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  expect(res.boardedColor).toBe('red');
  expect(res.boardedCount).toBe(2);
  expect(res.boardedSlots).toEqual([0, 0]); // both boarded passengers went into slot 0
  expect(res.departedCarIds).toContain(1); // it filled up and left
  expect(loop.ring[3]).toEqual({ color: 'red', count: G - 2 }); // rotated one cell on
  expect(loop.remainingCount()).toBe(4 * G - 2);
});

test('a block spread across two matching cars fills both', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 * G }]);
  const parking = new ParkingSystem(4, 2);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  parking.park(car({ id: 2, color: 'red', cap: 'small' }));
  parking.parked[0]!.filled = 15;        // one seat left here, the rest go next door
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  expect(res.boardedCount).toBe(G);
  expect(res.departedCarIds).toContain(1);
  expect(parking.parked[1]?.filled).toBe(G - 1);
});

test('no matching car means no boarding, loop still advances', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 * G }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'blue', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  const before = loop.remainingCount();
  const res = boarding.tick();
  expect(res.boardedColor).toBeNull();
  expect(loop.remainingCount()).toBe(before); // nobody boarded
});

test('a car that fills and departs in the same tick still names its slot in boardedSlots', () => {
  // The block that fills a car is the block that makes it depart -- boardedSlots has to
  // report the slot BEFORE removeFull() clears it, or the view has nothing to fly to.
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 * G }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 7, color: 'red', cap: 'small' }));
  parking.parked[0]!.filled = 15;        // one seat left, this row fills and departs it

  const boarding = new BoardingSystem(loop, parking);
  const res = boarding.tick();

  expect(res.boardedSlots).toEqual([0]);
  expect(res.departedCarIds).toContain(7);
  expect(parking.parked[0]).toBeNull();  // pins the ordering: slot reported, THEN cleared
});

test('a block split across two cars of the same colour reports both slots, in boarding order', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 * G }]);
  const parking = new ParkingSystem(4, 2);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  parking.park(car({ id: 2, color: 'red', cap: 'small' }));
  parking.parked[0]!.filled = 15;        // one seat left here, the rest go next door

  const boarding = new BoardingSystem(loop, parking);
  const res = boarding.tick();

  // One into the nearly-full car, then the rest of the block next door.
  expect(res.boardedSlots).toEqual([0, ...new Array(G - 1).fill(1)]);
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
