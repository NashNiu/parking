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

test('a car that lands SECOND cannot outrank one that landed first', () => {
  // The state the player reported twice: two cars of one colour on the bay, both part
  // filled, neither close to leaving. `seq` used to be handed out by `park`, i.e. at the
  // TAP -- but a car cannot take passengers until it has driven in, and the two orders
  // disagree. The drive is a route at a constant speed, and its length depends on where
  // the car started in the lot and which stall it is heading for, so tapping A then B can
  // easily land B first.
  //
  // What that cost: B lands, takes a row, then A lands and outranks it on a seq it earnt
  // by being TAPPED first -- stranding B exactly as picking by slot index used to. So the
  // number is handed out on arrival instead, and this is the test that says so.
  const p = new ParkingSystem(4, 2);
  const a = p.park(car({ id: 1, color: 'red', cap: 'small' }));
  p.setReady(a, false);
  const b = p.park(car({ id: 2, color: 'red', cap: 'small' }));
  p.setReady(b, false);

  p.setReady(b, true);                          // B's drive was shorter
  expect(p.findMatchingSlot('red')).toBe(b);
  p.board(b);

  p.setReady(a, true);                          // A lands afterwards
  expect(p.findMatchingSlot('red')).toBe(b);    // and does NOT take over
});

test('a part-filled car keeps its place through a redundant setReady', () => {
  // Arrival hands out the number, so it must happen ONCE. A second setReady(true) on a
  // car already ready would otherwise move it to the back of the queue -- and abandon it
  // mid-fill, which is the very state this is all guarding against.
  const p = new ParkingSystem(4, 2);
  const a = p.park(car({ id: 1, color: 'red', cap: 'small' }));
  const b = p.park(car({ id: 2, color: 'red', cap: 'small' }));
  p.board(a);
  p.setReady(a, true);
  expect(p.findMatchingSlot('red')).toBe(a);
  expect(b).toBe(1);
});

test('three cars of one colour fill strictly in landing order, never two at once', () => {
  // The invariant the player is actually reporting on: at most ONE part-filled car of a
  // colour on the bay at a time. Three cars tapped 0, 1, 2 and landing 2, 1, 0 -- the worst
  // case, and a plausible one, since a car heading for a near stall from near the lot's exit
  // beats one crossing the whole lot.
  const p = new ParkingSystem(4, 3);
  const slots = [0, 1, 2].map((i) => p.park(car({ id: i + 1, color: 'red', cap: 'small' })));
  for (const s of slots) p.setReady(s, false);
  const landing = [slots[2], slots[1], slots[0]];
  for (const s of landing) p.setReady(s, true);

  // 48 seats over three small cars, boarded one at a time. After every single passenger,
  // no more than one car may be part-filled.
  for (let n = 0; n < 48; n++) {
    const slot = p.findMatchingSlot('red');
    expect(slot).toBe(landing[Math.floor(n / 16)]);
    p.board(slot);
    const partial = p.parked.filter((c) => c && c.filled > 0 && c.filled < c.capacity);
    expect(partial.length).toBeLessThanOrEqual(1);
    p.removeFull();
  }
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

test('a locked slot can be unlocked, up to the bay total', () => {
  const p = new ParkingSystem(7, 4);
  expect(p.parked.length).toBe(4);
  expect(p.canUnlock()).toBe(true);
  expect(p.unlock()).toBe(4);   // the new slot's index
  expect(p.unlock()).toBe(5);
  expect(p.unlock()).toBe(6);
  expect(p.canUnlock()).toBe(false);
  expect(p.unlock()).toBe(-1);
  expect(p.parked.length).toBe(7);
});

test('an unlocked slot is immediately usable and starts empty', () => {
  const p = new ParkingSystem(7, 1);
  p.park(car({ id: 1, color: 'red', cap: 'small' }));
  expect(p.hasFreeSlot()).toBe(false);
  const slot = p.unlock();
  expect(p.hasFreeSlot()).toBe(true);
  expect(p.parked[slot]).toBeNull();
  expect(p.park(car({ id: 2, color: 'blue', cap: 'small' }))).toBe(slot);
});
