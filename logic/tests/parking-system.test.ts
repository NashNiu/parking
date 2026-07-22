import { ParkingSystem } from '../src/parking-system';
import { CarSpec } from '../src/types';

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small', ...over,
});

test('parks a car into a free slot and reports occupancy', () => {
  const p = new ParkingSystem(4, 2);
  expect(p.hasFreeSlot()).toBe(true);
  const idx = p.park(car({ id: 7, color: 'blue', cap: 'small' }));
  expect(p.parked[idx]?.carId).toBe(7);
  expect(p.parked[idx]?.capacity).toBe(16);
});

test('findMatchingSlot finds a same-color not-full car', () => {
  const p = new ParkingSystem(4, 2);
  p.park(car({ id: 1, color: 'red', cap: 'small' }));
  expect(p.findMatchingSlot('red')).toBe(0);
  expect(p.findMatchingSlot('green')).toBe(-1);
});

test('boarding fills a car and reports full at capacity', () => {
  const p = new ParkingSystem(4, 1);
  p.park(car({ id: 1, color: 'red', cap: 'small' })); // capacity 16
  for (let i = 0; i < 15; i++) expect(p.board(0)).toBe('boarded');
  expect(p.board(0)).toBe('full');
});

test('removeFull clears full cars and frees the slot', () => {
  const p = new ParkingSystem(4, 1);
  p.park(car({ id: 9, color: 'red', cap: 'small' }));
  for (let i = 0; i < 16; i++) p.board(0);
  expect(p.removeFull()).toEqual([9]);
  expect(p.parked[0]).toBeNull();
  expect(p.isEmpty()).toBe(true);
});

test('park throws when no free slot', () => {
  const p = new ParkingSystem(4, 1);
  p.park(car({ id: 1 }));
  expect(p.hasFreeSlot()).toBe(false);
  expect(() => p.park(car({ id: 2 }))).toThrow();
});
