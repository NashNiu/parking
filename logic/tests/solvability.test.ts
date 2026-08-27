import { isSolvable, estimateDifficulty } from '../../game/assets/scripts/core/index';
import { LevelData } from '../../game/assets/scripts/core/index';

// One column, both cars exiting upward: red above, blue below it and blocked until red
// leaves. Red's body spans y 0.52..1.48 and blue's -1.89..-0.11, so the two are 0.63
// apart -- well over CLEARANCE, and blue is still squarely behind red.
function solvableLevel(): LevelData {
  return {
    id: 1,
    lot: { w: 4, h: 4, cars: [
      { id: 1, x: 0, y: 1, angle: 90, color: 'red', cap: 'small' },
      { id: 2, x: 0, y: -1, angle: 90, color: 'blue', cap: 'medium' },
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
  // Nose to nose: car 1 drives +X into car 2, car 2 drives -X into car 1. Their bodies
  // span x -1.08..-0.12 and 0.12..1.08, so each still has 0.20 of clear board ahead of
  // it once the clearance is added -- a real gap, and still a mutual block.
  const level: LevelData = {
    id: 2,
    lot: { w: 4, h: 4, cars: [
      { id: 1, x: -0.6, y: 0, angle: 0, color: 'red', cap: 'small' },
      { id: 2, x: 0.6, y: 0, angle: 180, color: 'red', cap: 'small' },
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
    // Side by side, both exiting upward: neither is ever in the other's lane.
    lot: { w: 4, h: 4, cars: [
      { id: 1, x: -1, y: 0, angle: 90, color: 'red', cap: 'small' },
      { id: 2, x: 1, y: 0, angle: 90, color: 'red', cap: 'small' },
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
