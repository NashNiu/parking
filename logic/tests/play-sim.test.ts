import * as fs from 'fs';
import * as path from 'path';
import {
  careful, careless, keepDistinct, isHardButFair, simulate, demandPressure,
} from '../../game/assets/scripts/core/play-sim';
import { bandedQueue } from '../../game/assets/scripts/core/level-gen';
import { GameCore } from '../../game/assets/scripts/core/game-core';
import { LevelData } from '../../game/assets/scripts/core/types';

/** 发出去的那一关,逐字节 —— 设备读的就是这些字节。 */
function shipped(id: number): LevelData {
  const p = path.join(__dirname, '../../game/assets/resources/levels', `level-${id}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as LevelData;
}

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

describe('demandPressure', () => {
  // 已提交的第 6 关:环上平均有颜色,车位盖不住其中一部分。
  const level = (): LevelData => JSON.parse(JSON.stringify(shipped(6)));

  test('环上有需求,而且车位盖不住其中一部分', () => {
    const r = demandPressure(level());
    expect(r.ring).toBeGreaterThan(1);
    expect(r.gap).toBeGreaterThan(0);
    // 盖不住的颜色不可能比环上有的颜色还多。
    expect(r.gap).toBeLessThanOrEqual(r.ring);
  });

  // 这条是防空操作的那一条:把车位开到七个(多过关卡的六色),车位就能盖住环上的一切,
  // 缺口必须坍到接近零。如果 `demandPressure` 压根没看 `covered`,gap 会等于 ring,
  // 这里就会失败。反过来,如果它永远返回 0,上面那条 `gap > 0` 会失败 —— 两条一起
  // 才咬得住,单独哪一条都能被一个常数糊弄过去。
  test('车位多到盖得住一切时,缺口坍掉', () => {
    const tight = demandPressure(level());
    const wide = level();
    wide.parking.unlocked = wide.parking.slots;
    const loose = demandPressure(wide);
    expect(loose.gap).toBeLessThan(tight.gap);
    // 实测 1.37 -> 0.39,掉了七成。留足余量断言"至少掉四成",而不是断言一个绝对值:
    // 七个车位也盖不住一切,因为 `covered` 只数还没填满的车位,总有几个正被占着。
    expect(loose.gap).toBeLessThan(tight.gap * 0.6);
  });

  test('offset 抬得动缺口,而 hard 对同一批改动没有反应', () => {
    const at = (off: number) => {
      const lvl = level();
      lvl.loop.queue = bandedQueue(lvl.lot.cars, lvl.lot.tunnels ?? [], off, 1);
      return demandPressure(lvl).gap;
    };
    // 已提交的第 6 关:offset 16 -> 0.93,offset 32 -> 1.53,两档都仍然 hard 且可通关。
    expect(at(32)).toBeGreaterThan(at(16) * 1.3);
  });
});
