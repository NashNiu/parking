import { GameCore } from './game-core';
import { LevelData } from './types';

/**
 * Playing a level without a player, so the generator can ask how hard a level actually is
 * instead of inferring it from car counts.
 *
 * This exists because the difficulty curve was measuring the wrong thing. It scored a level
 * by how tangled the LOT was -- blocked cars, solver rounds -- which is a real puzzle, but
 * not the one that decides a game. What decides it is which colours you park against the
 * colours coming round the track, and on that the shipped levels were free: a one-line
 * rule, "keep the four stalls all different colours", won all ten. The generator was in
 * fact handing that rule over, painting colours round-robin along the order the cars can
 * leave in, so the outermost layer of the lot always held one car of every colour.
 *
 * THE LAW THIS IS UP AGAINST. A bay that covers every colour in play cannot jam: every row
 * that reaches the gap boards, so every tick frees a ring cell, so the track never seals --
 * and a sealed track is the only way to lose (see `LoopSystem.reachableColors` and
 * `GameCore.isDeadlocked`). So a level with no more colours than open stalls is winnable by
 * a player who does nothing but keep the stalls distinct, WHATEVER the lot looks like.
 * Difficulty needs `colors > unlocked`, and no amount of packing or painting substitutes.
 * Measured: over 66 colour paintings per packing, on four different packings, the count of
 * paintings that beat the one-line rule was 0 at four colours, 0-2 at five, and 4-7 at six.
 */

/** Deterministic PRNG (mulberry32), so a simulated game replays identically. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Which car to bring out, or -1 to bring out nothing this tick.
 *
 * `movable` is the tick's exitable ids, computed ONCE and reused for every tap in the tick.
 * That is not just a saving: removing a car only ever unblocks others, so a car that was
 * exitable at the top of the tick is still exitable after any number of removals. The
 * simulation drops each id it uses from the list, and `tapCar` re-checks anyway.
 */
export type Policy = (core: GameCore, movable: number[], rand: () => number) => number;

/** Colours the bay is currently able to take passengers for. */
function covered(core: GameCore): Set<string> {
  const colors = new Set<string>();
  for (const p of core.parking.parked) {
    if (p && p.filled < p.capacity) colors.add(p.color);
  }
  return colors;
}

/**
 * The one-line rule this whole module exists to defeat: bring out anything whose colour the
 * bay is not already covering, and never double up.
 *
 * It is deliberately the DUMBEST winning strategy, not a good one -- it never looks at the
 * track, never counts, never waits. A level it beats is a level that plays itself.
 */
export const keepDistinct: Policy = (core, movable) => {
  const have = covered(core);
  for (const id of movable) {
    const car = core.lot.cars.get(id);
    if (car && !have.has(car.color)) return id;
  }
  return -1;
};

/** Tap whatever can move. The floor: a level this loses to is luck, not a puzzle. */
export const careless: Policy = (core, movable, rand) => (
  movable.length > 0 ? movable[Math.floor(rand() * movable.length)] : -1
);

/**
 * What the player can SEE of the demand ahead: every row on the track, plus the first
 * `lookahead` rows of each channel -- which is exactly what `TrackView` draws.
 *
 * The restriction is the point. An earlier version of `careful` summed each channel's whole
 * queue, and a level certified winnable by that policy is only winnable by someone who can
 * read the rows that have not been drawn yet. Certifying fairness with information the
 * player does not have is worse than not checking at all: it ships levels that look unfair
 * for a reason the player can never discover.
 */
function visibleDemand(core: GameCore): Map<string, number> {
  const want = new Map<string, number>();
  const add = (color: string, n: number) => want.set(color, (want.get(color) ?? 0) + n);
  for (const group of core.loop.ring) if (group) add(group.color, group.count);
  for (const channel of core.loop.channels) {
    for (let i = 0; i < channel.lookahead && i < channel.queue.length; i++) {
      add(channel.queue[i].color, channel.queue[i].count);
    }
  }
  return want;
}

/**
 * A player who thinks: take the colour the visible track is carrying most of, avoid
 * doubling a colour the bay already covers, and take nothing at all when nothing visible
 * matches -- an empty stall is worth more than a car that cannot fill.
 *
 * This is the FAIRNESS side of the gate. It is not meant to be optimal; it is meant to be
 * reachable, a policy a player could describe in a sentence after a few levels. A level it
 * cannot win is a level being certified on the strength of a plan nobody would find.
 */
export const careful: Policy = (core, movable) => {
  const have = covered(core);
  const want = visibleDemand(core);
  let best = -1;
  let bestScore = 0;
  for (const id of movable) {
    const car = core.lot.cars.get(id);
    if (!car) continue;
    let score = want.get(car.color) ?? 0;
    // A colour already in the bay is worth taking only when nothing else offers anything;
    // the tenth keeps it as a tie-breaker rather than a preference.
    if (have.has(car.color)) score *= 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
};

/** Ticks before a simulated game is called a loss. Ten times the longest real playthrough. */
const TICK_CAP = 4000;

/**
 * Play `level` with `policy` and report whether it was won.
 *
 * The level is deep-copied, and its `slots` is clamped to `unlocked`: this simulates the
 * player who never taps the unlock button. That is the baseline the difficulty has to hold
 * up on, because unlocking is relief the player buys -- and it also makes the answer exact.
 * With a locked stall still available, `isDeadlocked` correctly refuses to call the game
 * over (there IS a legal move), so a simulated player who never unlocks would spin to the
 * tick cap instead of losing, and "lost" would become indistinguishable from "slow".
 */
export function simulate(level: LevelData, policy: Policy, seed: number): boolean {
  return play(level, policy, seed).getState() === 'won';
}

/**
 * One playthrough, returned as the finished `GameCore` so a caller can ask it anything.
 *
 * `watch` runs once per tick, AFTER that tick's taps and BEFORE the loop steps -- the
 * moment the board is in the state the player would be looking at.
 *
 * `simulate` and `demandPressure` share this rather than each keeping a tap loop of their
 * own; the two had already drifted apart once in a throwaway probe, and the tap loop is
 * exactly the part where a copy goes quietly wrong (the `unlocked` clamp, the one-tap-per-
 * stall cap, the `movable` filter that stops a policy taking the same car twice).
 */
function play(
  level: LevelData, policy: Policy, seed: number, watch?: (core: GameCore) => void,
): GameCore {
  const copy: LevelData = JSON.parse(JSON.stringify(level));
  copy.parking.slots = copy.parking.unlocked;
  const core = new GameCore(copy);
  const rand = rng(seed);
  for (let tick = 0; tick < TICK_CAP && core.getState() === 'playing'; tick++) {
    let movable: number[] | null = null;
    // At most one tap per stall: the bay cannot take more than that in a tick anyway.
    for (let k = 0; k < copy.parking.unlocked; k++) {
      if (!core.parking.hasFreeSlot()) break;
      if (movable === null) movable = core.lot.movableCarIds();
      const id = policy(core, movable, rand);
      if (id < 0) break;
      if (!core.tapCar(id).ok) break;
      movable = movable.filter((m) => m !== id);
    }
    if (watch) watch(core);
    core.stepLoop();
  }
  return core;
}

/** 环上的需求和车位能盖住的部分之间的差。见 `demandPressure`。 */
export interface Pressure {
  /** 环上平均有几种颜色是车位一个都没在接的。这就是"卡不卡得住"。 */
  gap: number;
  /** 环上平均同时有几种颜色。 */
  ring: number;
  /** 环上有人、而车位一种颜色都接不上的 tick 占比 —— 真的动不了的时刻。 */
  starved: number;
}

/**
 * 一局里"环上要的"和"车位能给的"差多少,平均每 tick 几种颜色。
 *
 * 这个指标存在的理由是 `hard` 已经饱和了。`hard` 只问一行策略输不输,而四个车位下十关
 * 全部满分、`carelessLoss` 也全是 100%,于是"勉强及格"和"死死卡住"在判据上一模一样 ——
 * `interleave` 这个真实有效的旋钮就是这么被判成"无效"并钉死在 1 的(见 `BAND_CURVE`)。
 *
 * 量的是人类伙伴自己指出来的那件事:能开出去的车颜色可选得多、同时环上颜色也多,于是
 * 车位几乎总能盖住环上的全部需求,永远不缺"有人要的颜色"。缺口越大,越容易卡住。
 *
 * 它对 `BAND_CURVE` 的 offset 有明显响应,而 `hard` 对同一批改动毫无反应 —— 在已提交
 * 的两关上各重建一次队列量到(H = 一行策略输,F = 细心策略赢):
 *
 *     第 2 关   off 0 缺0.40 HF   off 24 缺0.96 HF   off 32 缺1.15 -F
 *     第 6 关   off 16 缺0.93 HF  off 24 缺3.57 H-   off 32 缺1.53 HF
 *
 * 两关都能在**保持 hard 且可通关**的前提下把缺口翻一倍以上。旧的扫描只看 H/F,所以
 * 在"刚好 H"的那一档就收手了,把这段余量整个留在了桌上。
 *
 * 用 `careful` 跑一局,因为要量的是"一个会玩的人也会被卡住"。`keepDistinct` 太蠢,它
 * 量的是关卡有多容易被套路;`careless` 太随机,量的是运气。
 */
export function demandPressure(level: LevelData): Pressure {
  let ticks = 0;
  let gap = 0;
  let ring = 0;
  let starved = 0;
  play(level, careful, 1, (core) => {
    // 只数**环上此刻真有人**的颜色,不用 `reachableColors` —— 后者还算上"空格能让队列
    // 里挤进来的那几行",那是给死局判定用的预测,对本指标会把还没到场的需求也算成
    // 压力,把每一 tick 的瞬时紧张度抹平。人类伙伴的原话是"同一时间圆环上的乘客颜色
    // 种类",指的就是环上。
    const want = new Set<string>();
    for (const grp of core.loop.ring) if (grp && grp.count > 0) want.add(grp.color);
    const have = covered(core);
    let missing = 0;
    for (const c of want) if (!have.has(c)) missing++;
    ticks++;
    ring += want.size;
    gap += missing;
    if (want.size > 0 && missing === want.size) starved++;
  });
  if (ticks === 0) return { gap: 0, ring: 0, starved: 0 };
  return { gap: gap / ticks, ring: ring / ticks, starved: starved / ticks };
}

/** How many careless seeds to run. Odd, so "most of them" is unambiguous. */
const CARELESS_SEEDS = 5;

export interface Verdict {
  /** The one-line rule loses. */
  hard: boolean;
  /** A policy the player could actually arrive at wins. */
  fair: boolean;
  /** Share of careless playthroughs lost, 0 to 1. Reported, not gated on. */
  carelessLoss: number;
}

/**
 * The generator's acceptance test: hard means `keepDistinct` loses, fair means `careful`
 * wins. Both are needed and neither is enough -- a level that only the first rejects is
 * free, and one that only the second rejects is a level with no way through.
 *
 * `carelessLoss` is measured but NOT gated on, because it is the wrong shape for a gate:
 * random play failing is what an unforgiving level and a fair one have in common, and
 * requiring it would push the curve towards levels that punish speed rather than choice.
 * It is here so the generation log can show the spread.
 */
export function isHardButFair(level: LevelData): Verdict {
  const hard = !simulate(level, keepDistinct, 1);
  // `careful` is deterministic, so one run settles it -- but only run it when it can
  // change the answer, since it is the expensive half of the gate.
  const fair = hard ? simulate(level, careful, 1) : true;
  let lost = 0;
  if (hard && fair) {
    for (let s = 1; s <= CARELESS_SEEDS; s++) {
      if (!simulate(level, careless, s * 977)) lost++;
    }
  }
  return { hard, fair, carelessLoss: lost / CARELESS_SEEDS };
}
