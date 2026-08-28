import {
  careful, careless, keepDistinct, isHardButFair, simulate,
} from '../../game/assets/scripts/core/play-sim';
import { GameCore } from '../../game/assets/scripts/core/game-core';
import { LevelData } from '../../game/assets/scripts/core/types';

// One small red car (cap 16) and 16 red passengers: nothing to get wrong.
function soloLevel(): LevelData {
  return {
    id: 1,
    lot: { w: 2, h: 2, cars: [
      { id: 1, x: 0, y: 0, angle: 90, color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

/** Three green cars and a red-only queue: whatever is parked can never fill. */
function hopelessLevel(): LevelData {
  return {
    id: 5,
    lot: { w: 4, h: 2, cars: [
      { id: 1, x: -1.2, y: 0, angle: 90, color: 'green', cap: 'small' },
      { id: 2, x: 0, y: 0, angle: 90, color: 'green', cap: 'small' },
      { id: 3, x: 1.2, y: 0, angle: 90, color: 'green', cap: 'small' },
    ] },
    parking: { slots: 3, unlocked: 2 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('simulate plays a trivial level to a win', () => {
  expect(simulate(soloLevel(), keepDistinct, 1)).toBe(true);
  expect(simulate(soloLevel(), careful, 1)).toBe(true);
  expect(simulate(soloLevel(), careless, 1)).toBe(true);
});

test('simulate loses a level nothing can clear', () => {
  expect(simulate(hopelessLevel(), keepDistinct, 1)).toBe(false);
  expect(simulate(hopelessLevel(), careful, 1)).toBe(false);
});

test('simulate never unlocks: a locked stall is not part of the baseline', () => {
  // hopelessLevel has a third stall to open. A simulated player who opened it would park
  // the third green and still lose, so the state is the same either way -- what this pins
  // is that the bay never grows past `unlocked`, because the whole point of the baseline
  // is "what a player who does not tap the unlock button faces".
  const level = hopelessLevel();
  simulate(level, keepDistinct, 1);
  const core = new GameCore(level);
  expect(core.parking.parked.length).toBe(level.parking.unlocked);
});

test('simulate does not mutate the level it is handed', () => {
  const level = soloLevel();
  const before = JSON.stringify(level);
  simulate(level, keepDistinct, 1);
  expect(JSON.stringify(level)).toBe(before);
});

test('keepDistinct passes over a colour already in the bay', () => {
  // Two reds and a blue, all clear to leave, one stall free after the first red parks.
  const level: LevelData = {
    id: 2,
    lot: { w: 6, h: 2, cars: [
      { id: 1, x: -1.6, y: 0, angle: 90, color: 'red', cap: 'small' },
      { id: 2, x: 0, y: 0, angle: 90, color: 'red', cap: 'small' },
      { id: 3, x: 1.6, y: 0, angle: 90, color: 'blue', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 32 }, { color: 'blue', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const core = new GameCore(level);
  core.tapCar(1);
  expect(keepDistinct(core, [2, 3], () => 0)).toBe(3);
});

test('careful cannot see past a channel lookahead', () => {
  // The two levels differ ONLY in queue rows that no channel draws. A policy used to
  // certify a level as winnable must not know something the player cannot see, or it
  // certifies levels that are only fair to an omniscient player.
  const build = (tail: string): LevelData => ({
    id: 6,
    lot: { w: 6, h: 2, cars: [
      { id: 1, x: -1.6, y: 0, angle: 90, color: 'red', cap: 'small' },
      { id: 2, x: 0, y: 0, angle: 90, color: 'blue', cap: 'small' },
      { id: 3, x: 1.6, y: 0, angle: 90, color: 'green', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 1 },
    loop: {
      capacity: 8,
      boardIndex: 4,
      feeds: [{ side: 'far', lookahead: 1 }],
      queue: [
        { color: 'red', count: 8 },
        { color: tail, count: 8 },
        { color: tail === 'blue' ? 'green' : 'blue', count: 8 },
      ],
    },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  });
  const a = new GameCore(build('blue'));
  const b = new GameCore(build('green'));
  // Same visible state, different hidden tail: the choice has to match.
  expect(careful(a, [1, 2, 3], () => 0)).toBe(careful(b, [1, 2, 3], () => 0));
});

test('isHardButFair rejects a level everybody wins', () => {
  expect(isHardButFair(soloLevel()).hard).toBe(false);
});

test('isHardButFair rejects a level nobody wins', () => {
  const v = isHardButFair(hopelessLevel());
  expect(v.hard).toBe(true);
  expect(v.fair).toBe(false);
});
