import * as fs from 'fs';
import * as path from 'path';
import {
  careful, careless, keepDistinct, decisive, judge, simulate, demandPressure, playOut,
  exitWidth, exitFrontiers, frontierWidth,
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

describe('playOut', () => {
  test('a jam is a bill, not an ending', () => {
    // hopelessLevel 有一个锁着的车位。`simulate` 把它夹死,于是判为输;真机上卡住会
    // 提示开那个车位,关卡继续 —— 这一条钉的就是两者的区别,因为整条难度曲线量错了
    // 一年就是错在这里。开完仍然赢不了(三辆绿车对一队红乘客),但它是**买过之后**
    // 才结束的,而且账单记了下来。
    expect(simulate(hopelessLevel(), decisive, 1)).toBe(false);
    const r = playOut(hopelessLevel(), decisive, 1);
    expect(r.bought).toBe(hopelessLevel().parking.slots - hopelessLevel().parking.unlocked);
    expect(r.won).toBe(false);
    expect(r.dead).toBe(true);
  });

  test('a level that plays itself costs nothing', () => {
    expect(playOut(soloLevel(), decisive, 1)).toEqual({ won: true, bought: 0, dead: false });
  });

  test('the reference player does not sit on an empty stall for ever', () => {
    // `careful` 在没有匹配颜色时永远不点,于是车位永远不满,于是游戏那个"开个车位吧"
    // 的提示永远不触发 —— 一局既不赢也不卡死,空转到上限。判据要量的是"卡住值多少钱",
    // 而这种局在账面上是 0。`decisive` 只在环上还有空位时才等。
    const idle = playOut(hopelessLevel(), careful, 1);
    expect(idle).toEqual({ won: false, bought: 0, dead: false });
    expect(playOut(hopelessLevel(), decisive, 1).dead).toBe(true);
  });

  test('it does not mutate the level it is handed', () => {
    const level = shipped(6);
    const before = JSON.stringify(level);
    playOut(level, careful, 1);
    expect(JSON.stringify(level)).toBe(before);
  });
});

describe('exitWidth', () => {
  test('one colour everywhere is a width of one, however many cars can leave', () => {
    const level = shipped(6);
    const flat: LevelData = JSON.parse(JSON.stringify(level));
    for (const c of flat.lot.cars) c.color = 'red';
    expect(exitWidth(flat)).toBeCloseTo(1, 6);
    // 而真正发出去的那一关必须明显更宽 —— 否则这个指标根本没在看颜色。
    expect(exitWidth(level)).toBeGreaterThan(2);
  });

  test('it never claims more colours than the frontier holds cars', () => {
    const level = shipped(6);
    const frontiers = exitFrontiers(level);
    expect(frontiers.length).toBeGreaterThan(20);
    const color = new Map(level.lot.cars.map((c) => [c.id, c.color]));
    for (const ids of frontiers) {
      const seen = new Set(ids.map((id) => color.get(id)));
      expect(seen.size).toBeLessThanOrEqual(ids.length);
    }
    expect(frontierWidth(frontiers, color)).toBeCloseTo(exitWidth(level), 6);
  });

  test('the frontiers belong to the packing, not to the painting', () => {
    // 这是配色搜索省下四百次重建的那条性质:谁能开出去只跟车停在哪有关。它一旦不成立,
    // 第一遍筛出来的"最窄的候选"就是用别人的 frontier 算的,整个搜索静默地看错东西。
    const level = shipped(6);
    const repainted: LevelData = JSON.parse(JSON.stringify(level));
    repainted.lot.cars.forEach((c, i) => { c.color = i % 2 === 0 ? 'red' : 'blue'; });
    expect(exitFrontiers(repainted)).toEqual(exitFrontiers(level));
  });
});

describe('judge', () => {
  test('a level that plays itself is clean and costs nothing', () => {
    const v = judge(soloLevel());
    expect(v.perfect).toBe(0);
    expect(v.cost).toBe(0);
    expect(v.dead).toBe(false);
  });

  test('a level with no way through is dead, and dead is not the same as expensive', () => {
    // hopelessLevel 是三辆绿车对一队红乘客:车位全开也接不上。这必须读成 `dead`,
    // 因为 `choosePainting` 靠它把"窄过头"的配色挡回去 —— 而在账面上它同时也是最
    // 贵的,所以只看 `cost` 的搜索会把它当成最好的候选。
    const v = judge(hopelessLevel());
    expect(v.dead).toBe(true);
  });

  test('width comes straight off exitWidth', () => {
    const level = shipped(6);
    expect(judge(level).width).toBeCloseTo(exitWidth(level), 6);
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
