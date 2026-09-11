import { BoardingSystem } from '../../game/assets/scripts/core/boarding-system';
import { LoopSystem } from '../../game/assets/scripts/core/loop-system';
import { ParkingSystem } from '../../game/assets/scripts/core/parking-system';
import { BOARD_CELLS, CarSpec, GROUP_SIZE } from '../../game/assets/scripts/core/types';

/**
 * One full block of passengers. A small car seats 16, so it takes two of these -- the
 * counts below are written against G rather than against the 4 a block held when these
 * tests were first written.
 */
const G = GROUP_SIZE;

/** The stalls each of this tick's boarded passengers went into, in boarding order. */
const slotsOf = (res: { flights: { slot: number }[] }): number[] => res.flights.map((f) => f.slot);

/** The one colour that boarded this tick, or null. Fails loudly if the tick mixed colours. */
function colorOf(res: { flights: { color: string }[] }): string | null {
  const colors = new Set(res.flights.map((f) => f.color));
  expect(colors.size).toBeLessThanOrEqual(1);
  return colors.size === 1 ? [...colors][0] : null;
}

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 90, color: 'red', cap: 'small', ...over,
});

test('a whole block boards in one tick when the car has room for it', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 * G }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  expect(colorOf(res)).toBe('red');
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
  expect(colorOf(res)).toBe('red');
  expect(res.boardedCount).toBe(2);
  expect(slotsOf(res)).toEqual([0, 0]); // both boarded passengers went into slot 0
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
  expect(colorOf(res)).toBeNull();
  expect(loop.remainingCount()).toBe(before); // nobody boarded
});

test('a car that fills and departs in the same tick still names its slot in flights', () => {
  // The block that fills a car is the block that makes it depart -- flights has to
  // report the slot BEFORE removeFull() clears it, or the view has nothing to fly to.
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 * G }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 7, color: 'red', cap: 'small' }));
  parking.parked[0]!.filled = 15;        // one seat left, this row fills and departs it

  const boarding = new BoardingSystem(loop, parking);
  const res = boarding.tick();

  expect(slotsOf(res)).toEqual([0]);
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
  expect(slotsOf(res)).toEqual([0, ...new Array(G - 1).fill(1)]);
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

/**
 * A ring big enough for the full BOARD_CELLS doorway: `boardHalf` is clamped to
 * `capacity / 4 - 1`, so the four-cell rings above keep a single-cell door and only a ring
 * of 8 or more opens the window these tests are about.
 */
const WIDE_CAP = 12;
const WIDE_BOARD = 6;

/** The doorway's cells on a WIDE_CAP ring, leaving edge first. */
const WINDOW = [WIDE_BOARD + 1, WIDE_BOARD, WIDE_BOARD - 1];

test('every row inside the doorway boards on the same tick', () => {
  // The point of a doorway BOARD_CELLS wide: a band of one colour pays out in one burst
  // instead of one row per lap.
  const loop = new LoopSystem(WIDE_CAP, WIDE_BOARD, [{ color: 'red', count: WIDE_CAP * G }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));   // 16 seats, room for all 3 rows
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  expect(res.boardedCount).toBe(BOARD_CELLS * G);
  expect(new Set(res.flights.map((f) => f.cell))).toEqual(new Set(WINDOW));
  for (const cell of WINDOW) expect(loop.ring[(cell + 1) % WIDE_CAP]).toBeNull();
});

test('the doorway boards its cells leaving-edge first', () => {
  // Contents travel from index i to i + 1, so the cell at boardIndex + boardHalf is on its
  // last tick inside the door. A scarce run of seats has to go there, not to a cell that
  // would still have been in the doorway two ticks later.
  const loop = new LoopSystem(WIDE_CAP, WIDE_BOARD, [{ color: 'red', count: WIDE_CAP * G }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  parking.parked[0]!.filled = 14;                            // two seats left in the level
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  expect(res.flights.map((f) => f.cell)).toEqual([WINDOW[0], WINDOW[0]]);
});

test('two colours inside the doorway both board on the one tick', () => {
  // What killed the old `boardedColor`: a wide door can serve two colours at once, and a
  // single colour per tick could not describe it.
  const loop = new LoopSystem(WIDE_CAP, WIDE_BOARD, [{ color: 'red', count: WIDE_CAP * G }]);
  loop.ring[WINDOW[0]] = { color: 'blue', count: G };
  const parking = new ParkingSystem(4, 2);
  parking.park(car({ id: 1, color: 'blue', cap: 'small' }));
  parking.park(car({ id: 2, color: 'red', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  // Blue leaves first because its cell is the one leaving the doorway.
  expect(res.flights.slice(0, G).map((f) => f.color)).toEqual(new Array(G).fill('blue'));
  expect(new Set(res.flights.map((f) => f.color))).toEqual(new Set(['blue', 'red']));
});

test('a flight leaves the seat the row was actually drawing, from the top down', () => {
  // A row of `count` is drawn as figures 0..count-1, so the figure that stands up is the
  // last of those. Flying seat 0 first would lift a passenger off a spot where one is still
  // standing, and leave the vacated spot occupied.
  const loop = new LoopSystem(WIDE_CAP, WIDE_BOARD, [{ color: 'red', count: WIDE_CAP * G }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  const perCell = res.flights.filter((f) => f.cell === WINDOW[0]).map((f) => f.seat);
  expect(perCell).toEqual([G - 1, G - 2, G - 3, G - 4]);
});

test('a partly boarded row picks up where its seats left off', () => {
  // The row rides round with `count` figures drawn, so next time it is served the top seat
  // is count - 1, not G - 1.
  const loop = new LoopSystem(WIDE_CAP, WIDE_BOARD, [{ color: 'red', count: WIDE_CAP * G }]);
  loop.ring[WINDOW[0]] = { color: 'red', count: 2 };
  loop.ring[WINDOW[1]] = null;
  loop.ring[WINDOW[2]] = null;
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  expect(boarding.tick().flights.map((f) => f.seat)).toEqual([1, 0]);
});

test('a ring too small for the full doorway keeps a single-cell one', () => {
  // The window must never reach an entry cell (boardIndex +- capacity / 4), and on a
  // four-cell ring the entries ARE its neighbours. Clamping is what lets the toy rings in
  // the tests above go on describing the shipped single-cell behaviour.
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 4 * G }]);
  expect(loop.boardIndices()).toEqual([2]);
});
