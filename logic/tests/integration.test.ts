import { GameCore, validateLevel, LevelData } from '../../game/assets/scripts/core/index';

// Two colors, two cars; blue car is initially blocked by the red car above it,
// so the player must move red first. Conservation: red 16, blue 24.
function level(): LevelData {
  return {
    id: 10,
    lot: { w: 4, h: 4, cars: [
      { id: 1, x: 0, y: 1, angle: 90, color: 'red',  cap: 'small'  }, // above, exits up
      { id: 2, x: 0, y: -1, angle: 90, color: 'blue', cap: 'medium' }, // blocked by car 1
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 5, boardIndex: 3, queue: [
      { color: 'red', count: 16 },
      { color: 'blue', count: 24 },
    ] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('level passes conservation validation', () => {
  expect(validateLevel(level())).toEqual([]);
});

test('blocked car cannot be tapped until blocker is removed', () => {
  const game = new GameCore(level());
  expect(game.tapCar(2).ok).toBe(false); // blue blocked by red
  expect(game.tapCar(1).ok).toBe(true);  // red exits
  expect(game.tapCar(2).ok).toBe(true);  // blue now free
});

test('full playthrough reaches won', () => {
  const game = new GameCore(level());
  game.tapCar(1);
  game.tapCar(2);
  for (let i = 0; i < 500 && game.getState() === 'playing'; i++) {
    game.stepLoop();
  }
  expect(game.getState()).toBe('won');
});
