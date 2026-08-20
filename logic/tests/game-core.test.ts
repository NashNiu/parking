import { GameCore } from '../../game/assets/scripts/core/game-core';
import { LevelData, PaxGroup } from '../../game/assets/scripts/core/types';

/** `n` full rows of red, each its own object so boarding one never touches another. */
function reds(n: number): PaxGroup[] {
  return Array.from({ length: n }, () => ({ color: 'red', count: 4 }));
}

// Minimal solvable level: one small red car (cap 16), 16 red passengers.
function soloLevel(): LevelData {
  return {
    id: 1,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('tapCar parks an exitable car and removes it from the grid', () => {
  const game = new GameCore(soloLevel());
  expect(game.tapCar(1)).toEqual({ ok: true, slotIndex: 0 });
  expect(game.grid.isEmpty()).toBe(true);
  expect(game.parking.parked[0]?.carId).toBe(1);
});

test('tapCar fails when no free slot', () => {
  const level: LevelData = {
    id: 3,
    grid: { cols: 2, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 1, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 1 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 32 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.tapCar(1).ok).toBe(true);
  expect(game.tapCar(2)).toEqual({ ok: false, slotIndex: -1 });
});

test('playing a full level reaches won state', () => {
  const game = new GameCore(soloLevel());
  game.tapCar(1);
  for (let i = 0; i < 200 && game.getState() === 'playing'; i++) {
    game.stepLoop();
  }
  expect(game.getState()).toBe('won');
});

test('deadlock is detected when the ring is jammed with an unboardable color', () => {
  // The ring fills up with green, but no green car is ever parked. Passengers only
  // leave the ring by boarding, and the pool only feeds a ring cell that boarding
  // emptied — so the 16 red passengers behind the green ones can never reach the
  // boarding index, and the parked red car can never fill or free its slot.
  const level: LevelData = {
    id: 4,
    grid: { cols: 1, rows: 2, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 0, y: 1, w: 1, h: 1, dir: 'up', color: 'blue', cap: 'small' },
    ] },
    parking: { slots: 1, unlocked: 1 },
    loop: { capacity: 2, boardIndex: 0, queue: [
      { color: 'green', count: 2 }, { color: 'red', count: 16 },
    ] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  // Seal the ring by hand instead of relying on the authored queue order (the loop
  // shuffles now): green fills the track, the reds behind it can never get in.
  // Each cell is a row of passengers, so build distinct objects — a shared literal
  // would have every row decrement together once one of them boards.
  game.loop.ring = [{ color: 'green', count: 4 }, { color: 'green', count: 4 }];
  game.loop.channels[0].queue = reds(8);
  game.loop.channels[1].queue = reds(8);
  expect(game.tapCar(1).ok).toBe(true); // red car takes the only slot
  expect(game.getState()).toBe('deadlock');
});

test('a color still reachable through an emptied ring cell is not a deadlock', () => {
  // Same shape, but the ring holds a red passenger: it can board the parked red car,
  // which empties a cell and lets the pool feed the rest in. Play must continue.
  const level: LevelData = {
    id: 5,
    grid: { cols: 1, rows: 2, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 0, y: 1, w: 1, h: 1, dir: 'up', color: 'blue', cap: 'small' },
    ] },
    parking: { slots: 1, unlocked: 1 },
    loop: { capacity: 2, boardIndex: 0, queue: [
      { color: 'green', count: 1 }, { color: 'red', count: 16 },
    ] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  // Same shape, set by hand: a red row is on the track, so the parked red car can
  // still fill and free its slot.
  game.loop.ring = [{ color: 'green', count: 4 }, { color: 'red', count: 4 }];
  game.loop.channels[0].queue = reds(8);
  game.loop.channels[1].queue = reds(7);
  expect(game.tapCar(1).ok).toBe(true);
  expect(game.getState()).toBe('playing');
});

test('deadlock is detected when no progress is possible', () => {
  // Grid car is blue but the only passengers are red -> blue car can never fill,
  // and once parked there is no other car to move.
  const level: LevelData = {
    id: 2,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'blue', cap: 'small' },
    ] },
    parking: { slots: 1, unlocked: 1 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.getState()).toBe('playing');
  expect(game.tapCar(1).ok).toBe(true); // blue car occupies the only slot
  // No red passenger can ever board a blue car and no other car can move,
  // so the game is unrecoverable — deadlock is detected immediately.
  expect(game.getState()).toBe('deadlock');
  game.stepLoop(); // guarded no-op once state is no longer 'playing'
  expect(game.getState()).toBe('deadlock');
});
