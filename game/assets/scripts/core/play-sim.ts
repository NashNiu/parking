import { GameCore } from './game-core';
import { LotSystem } from './lot-system';
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

/**
 * `careful`, but it will not sit on an empty stall once nothing is coming to relieve it.
 *
 * `careful` declines when no visible row matches anything it could bring out, and that is
 * right as far as it goes -- an empty stall beats a car that cannot fill. Held FOREVER it
 * stops being a policy and becomes a way of not finishing: measured on level 10 repainted in
 * runs of six or more, `careful` neither won nor jammed, it circled to the tick cap. That
 * matters because a level is now graded on what a jam COSTS (see `playOut`), and a jam is
 * detected by the bay being full. A reference player who never fills the bay never triggers
 * the prompt, so a narrow painting reads as "never finishes" rather than "expensive" -- and
 * gets thrown out for the opposite of its actual defect.
 *
 * The condition is the honest one: hold while any ring cell is free, because a free cell is
 * a row still to come and therefore a reason to wait. With the ring solid, nothing will
 * change by waiting, and a player would park something.
 */
export const decisive: Policy = (core, movable, rand) => {
  const pick = careful(core, movable, rand);
  if (pick >= 0) return pick;
  for (const grp of core.loop.ring) if (grp === null || grp.count === 0) return -1;
  return movable.length > 0 ? movable[0] : -1;
};

/**
 * `policy`, except that a share `eps` of its taps are random instead -- a player who knows
 * what to do and occasionally does something else.
 *
 * This is the only policy here that is not a description of a kind of player. It is a dial,
 * and what it dials is the one thing the other three cannot see. `careless` loses every
 * level and `careful` wins every level, so between them they report the same two numbers on
 * a level that plays itself and on a level that is brutal. Every real player is somewhere in
 * the band between, and until this existed nothing in the pipeline had ever looked there.
 */
export function slip(policy: Policy, eps: number): Policy {
  return (core, movable, rand) => (
    rand() < eps ? careless(core, movable, rand) : policy(core, movable, rand)
  );
}

/**
 * The slip rate difficulty is reported at: one tap in ten goes astray.
 *
 * Measured over the nine packed levels at 0.05, 0.1, 0.2 and 0.4, this is the smallest rate
 * that separates them. At 0.05 six of the nine still win 89% or more; at 0.4 the noise
 * swamps the level and two of them win 0% regardless of design. At 0.1 the same nine spread
 * from 11% to 100% -- the levels are told apart by their own structure, not by the dial.
 */
export const SLIP_RATE = 0.1;

/**
 * Playthroughs per forgiveness measurement. Odd and small: each one is a full game, and this
 * runs inside the painting search, which is the generator's hot loop.
 */
const SLIP_SEEDS = 9;

/**
 * Share of slightly-clumsy playthroughs won: HOW MANY MISTAKES THIS LEVEL FORGIVES.
 *
 * The difficulty number. `hard` and `fair` are single bits, and once a level is through the
 * painting search both are saturated on it: `fair` because it was REQUIRED to be true, and
 * `hard` because a chosen level reads hard at nearly every offset the band sweep tries (see
 * `BAND_CURVE`, where that is what made `interleave` look inert). So the pair reported the
 * same two values on a level that barely holds together and one that cannot be lost.
 * `demandPressure().gap` was the first attempt at a graded replacement and it is only
 * weakly predictive: level 7 carries the largest gap of the ten (2.04) and is the most
 * forgiving level in the game (100% at this slip rate), while level 3 carries nearly the
 * smallest (1.09) and forgives 44%. The gap measures a structural property of the bay; this
 * measures whether a person loses.
 *
 * Read it as a win rate, so it runs the same direction as "easy": 1.0 forgives everything,
 * 0.0 forgives nothing.
 */
export function forgiveness(
  level: LevelData, eps: number = SLIP_RATE, seeds: number = SLIP_SEEDS,
): number {
  const policy = slip(careful, eps);
  let won = 0;
  for (let s = 0; s < seeds; s++) if (simulate(level, policy, s * 977 + 1)) won++;
  return won / seeds;
}

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

/** A playthrough of the level the way the shipped game plays it. See `playOut`. */
export interface Playout {
  /** The level was cleared. */
  won: boolean;
  /** Stalls the player had to open. This is what the star rating is spent from. */
  bought: number;
  /** Every stall open and the board still frozen: the level is genuinely unwinnable. */
  dead: boolean;
}

/**
 * Play the level THE WAY THE SHIPPED GAME PLAYS IT, and report what it cost.
 *
 * `simulate` clamps the bay to `unlocked` and calls a jam a loss. That baseline described a
 * game nobody plays. `GameCore.declineUnlock` is never called by anything (its own docblock
 * says so), so on a device a jam is not a loss: the game offers a stall, the player takes it,
 * and the level goes on. A level only truly ends when all `slots` are open and the board is
 * still frozen. Measured on the ten levels shipped 2026-09-21, played this way, `careful`
 * cleared every one of them having bought NOTHING -- full marks on all ten, including the
 * last. The pipeline had been grading a difficulty the player never meets.
 *
 * So this counts stalls instead of wins. Stalls are the only resource the game meters
 * (`GameCore.stars` is full marks minus stalls opened), which makes them the only honest
 * unit difficulty can be stated in -- and it is the unit my human partner reached for
 * unprompted: 只需要 2 个车位就能过关.
 */
export function playOut(level: LevelData, policy: Policy, seed: number): Playout {
  const core = play(level, policy, seed, undefined, true);
  return {
    won: core.getState() === 'won',
    bought: core.parking.unlocksUsed(),
    dead: core.getState() === 'deadlock',
  };
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
  buy: boolean = false,
): GameCore {
  const copy: LevelData = JSON.parse(JSON.stringify(level));
  // Without `buy` the bay can never grow, which is the never-unlocking baseline `simulate`
  // describes above. With it, the level is played the way a device plays it.
  if (!buy) copy.parking.slots = copy.parking.unlocked;
  const core = new GameCore(copy);
  const rand = rng(seed);
  for (let tick = 0; tick < TICK_CAP && core.getState() === 'playing'; tick++) {
    let movable: number[] | null = null;
    // At most one tap per stall: the bay cannot take more than that in a tick anyway.
    // Read off the bay rather than off `unlocked`, because with `buy` the bay grows.
    for (let k = 0; k < core.parking.parked.length; k++) {
      if (!core.parking.hasFreeSlot()) break;
      if (movable === null) movable = core.lot.movableCarIds();
      const id = policy(core, movable, rand);
      if (id < 0) break;
      if (!core.tapCar(id).ok) break;
      movable = movable.filter((m) => m !== id);
    }
    if (watch) watch(core);
    core.stepLoop();
    // Exactly what the shipped prompt offers, and the player takes it: a jam is a bill,
    // not an ending. `needsUnlock` is false while the ring is still filling, so this
    // cannot fire on an opening position that merely looks tight.
    if (buy && core.needsUnlock()) core.unlockSlot();
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
 *
 * 它**不再是配色搜索的目标**,`forgiveness` 是。把 ε-careful 跑在发出去的九关上之后,
 * 这两个数几乎不相关:第 7 关缺口 2.04 全场最高,却在 slip 0.1 下一次都没输过;第 3 关
 * 缺口 1.09 接近最低,只赢了 44%。缺口量的是车位盖不盖得住环上的需求 —— 一个结构属性,
 * 也正是我当初从人类伙伴的诊断里直接翻译过来的那一个。它没量错,但它不是难度:难度是
 * 人会不会输。留着它做汇报列,因为"为什么难"仍然要靠它来读。
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

/**
 * The exitable set at every step of the lot's own unwinding, as car ids.
 *
 * Policy-free on purpose, and that is the whole reason this exists. Every other measure here
 * plays the level, so every one of them is a statement about `careful` as much as about the
 * level -- and `careful` turned out to be far weaker than a person (it needs four stalls on
 * level 4, where my human partner passed with two). This asks the board a question the board
 * can answer by itself: at each moment, WHICH CARS COULD LEAVE. Peeling always takes the
 * first exitable id, so the sequence is a property of the packing alone.
 */
export function exitFrontiers(level: LevelData): number[][] {
  const lot = new LotSystem(
    { w: level.lot.w, h: level.lot.h },
    JSON.parse(JSON.stringify(level.lot.cars)),
    // The tunnels are BUILT, not dropped: they stand on the board and block, so a frontier
    // computed without them is wider than the one the player meets -- and seven of the ten
    // levels have them. Their mouth cars are not part of the grid and carry no id in the
    // level file, so they are filtered out below rather than counted or peeled.
    JSON.parse(JSON.stringify(level.lot.tunnels ?? [])),
  );
  const grid = new Set(level.lot.cars.map((c) => c.id));
  const frontiers: number[][] = [];
  for (let step = 0; step < level.lot.cars.length; step++) {
    const ids = lot.movableCarIds().filter((id) => grid.has(id));
    if (ids.length === 0) break;
    frontiers.push(ids);
    lot.removeCar(ids[0]);
  }
  return frontiers;
}

/**
 * HOW MANY DIFFERENT COLOURS CAN LEAVE AT ONCE, averaged over the lot's unwinding.
 *
 * My human partner named this as the dial: 同一时间，能驶出停车场的不同颜色的车辆数量越少，
 * 难度越大. It is the width of the player's choice. When four colours are always available
 * against four stalls, there is no choice to get wrong -- something useful always fits, and
 * the level plays itself however it is packed or ordered.
 *
 * Measured on the levels shipped 2026-09-21: 3.1 to 4.3, with the LAST level among the
 * widest. Repainting level 10's cars in runs of five along the leaving order takes it to
 * 2.90, and that is the painting where a clean run still earns full marks while a tenth of
 * taps going astray costs one or two stalls.
 *
 * Reads off `exitFrontiers`, so it costs no simulation at all -- which is what lets the
 * painting search use it as a filter before spending playthroughs on a candidate.
 */
export function exitWidth(level: LevelData): number {
  return frontierWidth(
    exitFrontiers(level), new Map(level.lot.cars.map((c) => [c.id, c.color])),
  );
}

/**
 * `exitWidth` over frontiers computed once, for a caller that is about to ask it of many
 * paintings of the SAME packing.
 *
 * The frontiers depend only on where the cars are, never on what colour they are, so the
 * painting search computes them once per packing and then scores four hundred paintings by
 * counting over this -- no lot rebuilt, no game played. That is what makes it affordable to
 * look at every candidate and play only the narrowest.
 */
export function frontierWidth(frontiers: number[][], color: Map<number, string>): number {
  if (frontiers.length === 0) return 0;
  let total = 0;
  for (const ids of frontiers) {
    const seen = new Set<string>();
    for (const id of ids) {
      const c = color.get(id);
      if (c !== undefined) seen.add(c);
    }
    total += seen.size;
  }
  return total / frontiers.length;
}

/**
 * HOW MANY CARS CAN LEAVE AT ONCE, averaged over the lot's unwinding.
 *
 * `exitWidth`'s sibling, and the blunter of the two: that one counts colours on the frontier,
 * this counts cars. Both are policy-free, and this one is the one that does not saturate --
 * `stallDemand` tops out at the four stalls the bay opens with, and every level was already
 * there while my human partner was still clearing them on two.
 *
 * Measured on the levels shipped 2026-09-21: 8.6, 10.7, 8.3, 6.2, 5.8, 4.4, 4.9, 4.2, 4.3
 * across ids 2-10. Level 3 put ten cars on the table at a time, eighteen at the opening
 * position, against four stalls -- and the blocked-car share was a flat 0.80 to 0.86
 * throughout, so the share is not what this is. A bigger board yields more exits at the same
 * share.
 */
export function exitCars(level: LevelData): number {
  const frontiers = exitFrontiers(level);
  if (frontiers.length === 0) return 0;
  return frontiers.reduce((n, ids) => n + ids.length, 0) / frontiers.length;
}

/** Playthroughs behind `mistakeCost`. Odd and small; each one is a full game. */
const COST_SEEDS = 5;

/**
 * The policies a level is asked about, best line kept.
 *
 * Every question here is an EXISTENCE claim -- can the level be cleared with two stalls, can
 * three stars be taken -- and none of these bots is a good player, so asking one of them is
 * asking the wrong question. Asking several and keeping the best line is the closest cheap
 * approximation to "is there a way", which is what the claims are actually about.
 */
const PANEL: Policy[] = [decisive, careful, keepDistinct];

export interface Verdict {
  /** Distinct colours that can leave at once. See `exitWidth`. */
  width: number;
  /**
   * FEWEST OPENING STALLS THE LEVEL STILL CLEARS WITH, buying nothing. `unlocked + 1` means
   * it cannot be cleared on the bay it ships with at all.
   *
   * This is the number my human partner has been reporting all along, in their own words:
   * 只用了三个车位，感觉甚至两个车位都可以. A level that ships four stalls and needs two is
   * half decoration -- nothing is ever tight, and no amount of colour ordering changes that.
   * Measured on the levels shipped 2026-09-21 it ran 1, 2, 2, 2, 4, 4, 2, 4, 4 across ids
   * 2-10: five of the nine never needed more than half the bay, and level 2 cleared its
   * eighty-nine cars on ONE stall.
   *
   * It is what `cost` could not see. Narrowing level 4's painting moves this from 1 to 3
   * while `cost` stays at 0.0 to 0.4 throughout -- noise -- so a search ranked on `cost`
   * picked the slack level and called it done.
   */
  demand: number;
  /** Every stall open and the board still frozen. The level is unwinnable; reject it. */
  dead: boolean;
}

/**
 * What the generator needs to know about a candidate, in the units the game already meters.
 *
 * `demand` is the difficulty. `dead` is the floor under it: narrowing the choice is what
 * raises demand, and taken too far it stops being a puzzle, which is a thing to reject
 * rather than a thing to score.
 *
 * Neither is measured against a bay clamped to `unlocked` in the old sense. `demand` asks
 * about a SMALLER bay on purpose -- what the level would still yield to -- while `dead` asks
 * the opposite question with every stall bought, the way a device would.
 */
export function judge(level: LevelData): Verdict {
  const demand = stallDemand(level);
  // A level that clears on SOME bay having bought nothing cannot be dead, so the expensive
  // question is only worth asking of the levels that failed the cheap one.
  let dead = false;
  if (demand > level.parking.unlocked) {
    dead = true;
    for (const pol of PANEL) if (playOut(level, pol, 1).won) { dead = false; break; }
  }
  return { width: exitWidth(level), demand, dead };
}

/**
 * Fewest opening stalls that still clear `level` with nothing bought.
 *
 * Counts up from one and stops at the first bay that works, so a slack level is cheap to
 * spot and only a tight one pays for the whole scan. Reported as `unlocked + 1` when even
 * the full bay is not enough -- such a level needs a stall bought and cannot be three-starred.
 */
export function stallDemand(level: LevelData): number {
  for (let n = 1; n <= level.parking.unlocked; n++) {
    const probe: LevelData = JSON.parse(JSON.stringify(level));
    probe.parking.unlocked = n;
    // `simulate` clamps `slots` to `unlocked`, which is exactly the no-buying rule here.
    for (const pol of PANEL) if (simulate(probe, pol, 1)) return n;
  }
  return level.parking.unlocked + 1;
}

/**
 * Mean stalls bought at `SLIP_RATE`: what a mistake costs once the bay is tight.
 *
 * Secondary to `demand`, and only ever a tie-break between candidates that demand the same
 * bay. On its own it is far too flat to steer by -- across level 4's paintings it reads 0.0
 * to 0.4 while the bay the level needs goes from one stall to three.
 */
export function mistakeCost(level: LevelData): number {
  const forSale = level.parking.slots - level.parking.unlocked;
  let total = 0;
  for (let s = 1; s <= COST_SEEDS; s++) {
    const r = playOut(level, slip(decisive, SLIP_RATE), s * 977);
    total += r.won ? r.bought : forSale;
  }
  return total / COST_SEEDS;
}
