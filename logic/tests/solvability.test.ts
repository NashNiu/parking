import { isSolvable, estimateDifficulty } from '../../game/assets/scripts/core/index';
import { LevelData } from '../../game/assets/scripts/core/index';

// A 1x2 column: red on top (exits up), blue below it (blocked until red leaves).
function solvableLevel(): LevelData {
  return {
    id: 1,
    grid: { cols: 1, rows: 2, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 0, y: 1, w: 1, h: 1, dir: 'up', color: 'blue', cap: 'medium' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 5, boardIndex: 3, queue: [
      { color: 'red', count: 16 }, { color: 'blue', count: 24 },
    ] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('a conservation-valid, clearable level is solvable', () => {
  expect(isSolvable(solvableLevel())).toBe(true);
});

test('a gridlocked level (mutual block) is not solvable', () => {
  // 2x1 row: car A at (0,0) exits right but B blocks; B at (1,0) exits left but A blocks.
  const level: LevelData = {
    id: 2,
    grid: { cols: 2, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'right', color: 'red', cap: 'small' },
      { id: 2, x: 1, y: 0, w: 1, h: 1, dir: 'left', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 5, boardIndex: 3, queue: [{ color: 'red', count: 32 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  expect(isSolvable(level)).toBe(false);
});

test('a conservation-invalid level is not solvable', () => {
  const lvl = solvableLevel();
  lvl.loop.queue = [{ color: 'red', count: 16 }]; // missing blue passengers
  expect(isSolvable(lvl)).toBe(false);
});

test('estimateDifficulty reports rounds, cars, colors, blocked', () => {
  const d = estimateDifficulty(solvableLevel());
  expect(d.cars).toBe(2);
  expect(d.colors).toBe(2);
  expect(d.rounds).toBe(2);   // red exits round 1, blue (unblocked) round 2
  expect(d.blocked).toBe(1);  // blue is initially blocked by red
  expect(d.score).toBe(d.rounds * 3 + d.blocked * 2 + d.cars + d.colors);
});

test('a fully unblocked level clears in one round', () => {
  const level: LevelData = {
    id: 3,
    grid: { cols: 2, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 1, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 5, boardIndex: 3, queue: [{ color: 'red', count: 32 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const d = estimateDifficulty(level);
  expect(d.rounds).toBe(1);
  expect(d.blocked).toBe(0);
  expect(isSolvable(level)).toBe(true);
});
