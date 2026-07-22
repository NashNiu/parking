import { GameCore, LevelData } from '../../game/assets/scripts/core/index';

test('a wide (multi-cell) car exits and parks via GameCore', () => {
  const level: LevelData = {
    id: 20,
    grid: { cols: 2, rows: 2, cars: [
      { id: 1, x: 0, y: 1, w: 2, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 2, unlocked: 2 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  const res = game.tapCar(1);
  expect(res.ok).toBe(true);
  expect(game.grid.isEmpty()).toBe(true);
  expect(game.parking.parked[res.slotIndex]?.carId).toBe(1);
});

test('a wide car blocked in one lane cannot be tapped', () => {
  const level: LevelData = {
    id: 21,
    grid: { cols: 2, rows: 2, cars: [
      { id: 1, x: 0, y: 1, w: 2, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 1, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 2, unlocked: 2 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 32 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.tapCar(1).ok).toBe(false); // column 1 blocked by car 2
  expect(game.tapCar(2).ok).toBe(true);  // car 2 exits up (already at top row)
  expect(game.tapCar(1).ok).toBe(true);  // lane now clear
});

test('a big car (cap 32) fills and departs, level won', () => {
  const level: LevelData = {
    id: 22,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'green', cap: 'big' },
    ] },
    parking: { slots: 2, unlocked: 2 },
    loop: { capacity: 6, boardIndex: 3, queue: [{ color: 'green', count: 32 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.tapCar(1).ok).toBe(true);
  let departed: number[] = [];
  for (let i = 0; i < 500 && game.getState() === 'playing'; i++) {
    departed = departed.concat(game.stepLoop().departedCarIds);
  }
  expect(departed).toContain(1);
  expect(game.getState()).toBe('won');
});

test('a medium car (cap 24) fills and departs, level won', () => {
  const level: LevelData = {
    id: 24,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'yellow', cap: 'medium' },
    ] },
    parking: { slots: 2, unlocked: 2 },
    loop: { capacity: 6, boardIndex: 3, queue: [{ color: 'yellow', count: 24 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.tapCar(1).ok).toBe(true);
  for (let i = 0; i < 500 && game.getState() === 'playing'; i++) game.stepLoop();
  expect(game.getState()).toBe('won');
});

test('locked slots are not usable: unlocked<slots can deadlock', () => {
  const level: LevelData = {
    id: 23,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'blue', cap: 'small' },
    ] },
    parking: { slots: 3, unlocked: 1 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.parking.parked.length).toBe(1); // only unlocked slots exist
  expect(game.tapCar(1).ok).toBe(true);
  expect(game.getState()).toBe('deadlock'); // 2 locked slots don't count as free
});
