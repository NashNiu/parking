import { validateLevel } from '../src/level-data';
import { LevelData } from '../src/types';

function baseLevel(): LevelData {
  return {
    id: 1,
    grid: { cols: 2, rows: 2, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('valid level returns no errors', () => {
  expect(validateLevel(baseLevel())).toEqual([]);
});

test('color imbalance is reported', () => {
  const lvl = baseLevel();
  lvl.loop.queue = [{ color: 'red', count: 8 }]; // 8 != 16
  const errors = validateLevel(lvl);
  expect(errors.length).toBe(1);
  expect(errors[0]).toContain('red');
});

test('unlocked greater than slots is reported', () => {
  const lvl = baseLevel();
  lvl.parking.unlocked = 5; // > slots 4
  expect(validateLevel(lvl)).toContain('unlocked > slots');
});
