import * as fs from 'fs';
import * as path from 'path';
import {
  careful, careless, keepDistinct, isHardButFair, judge, simulate, demandPressure,
  slip, forgiveness, SLIP_RATE, Policy,
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

describe('forgiveness', () => {
  test('the dial really is the share of taps the policy does not make', () => {
    // 两端都钉死,而且钉的是"有没有问过策略",不是最终胜负 —— 胜负在简单关卡上两边
    // 都一样,测不出实现是否真的在两支之间切换。
    const never: Policy = () => { throw new Error('policy consulted'); };
    expect(() => simulate(soloLevel(), slip(never, 1), 1)).not.toThrow();
    expect(() => simulate(soloLevel(), slip(never, 0), 1)).toThrow('policy consulted');
  });

  test('at zero slip it is the policy, on a level where that decides the game', () => {
    for (const seed of [1, 977, 1954]) {
      expect(simulate(shipped(6), slip(careful, 0), seed))
        .toBe(simulate(shipped(6), careful, seed));
    }
  });

  test('a level with no way through forgives nothing', () => {
    expect(forgiveness(hopelessLevel())).toBe(0);
  });

  test('a level that plays itself forgives everything', () => {
    expect(forgiveness(soloLevel())).toBe(1);
  });

  test('it is a rate, and it is measured at the documented slip', () => {
    expect(SLIP_RATE).toBeGreaterThan(0);
    expect(SLIP_RATE).toBeLessThan(1);
    const f = forgiveness(shipped(6));
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(1);
    expect(forgiveness(shipped(6), SLIP_RATE)).toBe(f);
  });

  test('it tells the shipped levels apart, which hard and fair do not', () => {
    // 这条测的是**判据本身有没有分辨力**,不是某一关的具体数值。旧判据 hard/fair 是两
    // 个 bit,在发出去的九关上全部相同 —— 于是"勉强能过"和"闭着眼也能过"读数一样,
    // 难度曲线就是这么被压平的。新判据必须至少把这九关分成三档以上,否则换它没有意义。
    const seen = new Set<number>();
    for (let id = 2; id <= 10; id++) seen.add(forgiveness(shipped(id)));
    expect(seen.size).toBeGreaterThanOrEqual(3);
  }, 300000);
});

describe('judge', () => {
  test('it agrees with isHardButFair on the bits, minus the careless sample', () => {
    const level = hopelessLevel();
    const j = judge(level);
    const v = isHardButFair(level);
    expect(j.hard).toBe(v.hard);
    expect(j.fair).toBe(v.fair);
    expect(j.forgive).toBe(v.forgive);
    expect(j).not.toHaveProperty('carelessLoss');
  });

  test('forgiveness is not measured on a level the one-line rule wins', () => {
    // soloLevel 不 hard,`forgive` 报 1 是个哨兵而不是测量值 —— 这一关在任何人问它
    // 宽不宽容之前就已经被 `choosePainting` 丢掉了。钉住它是为了防止有人把这个 1
    // 当成"最宽容"读进排序里。
    const v = judge(soloLevel());
    expect(v.hard).toBe(false);
    expect(v.forgive).toBe(1);
  });
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
    // 断言的是**整条 offset 轴上的落差**,不是某两档的比值。哪一档最高取决于这一关的
    // 打包,而打包会变:上一版钉死 offset 16 与 32,第 6 关一改成沿轮廓铺就红了,红得
    // 毫无道理 —— 那不是 offset 失效,是我把一个随打包漂移的量当成了常数。
    //
    // 实测已提交的第 6 关(2026-09-20,沿轮廓铺):
    //     off0 0.57   off8 1.33   off16 1.67   off24 1.43   off32 1.14   off40 1.39
    // 最高 1.67 是最低 0.57 的 2.9 倍。断言 1.8 倍,留足余量;而 offset 若真的不起作用,
    // 这六档会挤在一起,比值奔向 1.0。
    const spread = [0, 8, 16, 24, 32, 40].map(at);
    expect(Math.max(...spread)).toBeGreaterThan(Math.min(...spread) * 1.8);
  });
});
