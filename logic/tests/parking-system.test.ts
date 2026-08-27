import { ParkingSystem } from '../../game/assets/scripts/core/parking-system';
import { CarSpec } from '../../game/assets/scripts/core/types';

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 90, color: 'red', cap: 'small', ...over,
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

test('a slot marked not-ready is skipped by findMatchingSlot', () => {
  // The view parks a car over one to two seconds of driving, while the core has it in
  // the slot from the moment of the tap. Without this gate the loop fills — and can
  // even depart — a car the view still has in transit.
  const p = new ParkingSystem(4, 2);
  const slot = p.park(car({ id: 1, color: 'red', cap: 'small' }));
  expect(p.findMatchingSlot('red')).toBe(slot);   // ready by default
  p.setReady(slot, false);
  expect(p.findMatchingSlot('red')).toBe(-1);
  p.setReady(slot, true);
  expect(p.findMatchingSlot('red')).toBe(slot);
});

test('setReady on an empty slot is a no-op rather than a throw', () => {
  // An arrival can land after its car already departed on a restart, so the view can
  // legitimately mark a slot that is no longer occupied.
  const p = new ParkingSystem(4, 2);
  expect(() => p.setReady(0, true)).not.toThrow();
  expect(() => p.setReady(99, true)).not.toThrow();
});

test('the car that arrived FIRST fills first, whatever slot it landed in', () => {
  // Slot index is not arrival order. Cars depart and their slots are reused, so the
  // lowest free index goes to whoever taps next -- and once that has happened a few
  // times, the oldest car on the bay can be sitting in the HIGHEST slot.
  //
  // Picking by index then abandons it: a partly filled car keeps its passengers and
  // waits forever while newer cars in lower slots take everything. Level 1 showed
  // exactly that -- two red cars on the bay, the older one stranded at 12 seats short
  // while the newer one, in slot 0, was 12 passengers in.
  const p = new ParkingSystem(4, 4);
  // Fill every slot, then free the two low ones so a later car can land there.
  for (let i = 0; i < 4; i++) p.park(car({ id: 10 + i, color: 'blue', cap: 'small' }));
  p.parked[0] = null;
  p.parked[1] = null;
  // The red car in slot 3 is a leftover from the first wave: park it by hand so its
  // arrival predates the two below it.
  p.parked[3] = {
    carId: 99, color: 'red', capacity: 16, filled: 4, ready: true, seq: 1,
  };
  const later = p.park(car({ id: 1, color: 'red', cap: 'small' }));
  expect(later).toBe(0);                       // lowest free index, as before
  expect(p.findMatchingSlot('red')).toBe(3);   // but the OLDER car is served
  // Only when the older one is full does the newer one start.
  for (let i = 0; i < 12; i++) p.board(3);
  expect(p.findMatchingSlot('red')).toBe(0);
});

test('two cars parked in order fill in that order', () => {
  const p = new ParkingSystem(4, 3);
  const first = p.park(car({ id: 1, color: 'red', cap: 'small' }));
  const second = p.park(car({ id: 2, color: 'red', cap: 'small' }));
  expect(p.findMatchingSlot('red')).toBe(first);
  for (let i = 0; i < 16; i++) p.board(first);
  expect(p.findMatchingSlot('red')).toBe(second);
});
