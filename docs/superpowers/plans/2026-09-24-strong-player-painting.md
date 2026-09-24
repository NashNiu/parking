# 用会往前看的玩家挑配色 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `choosePainting` 第二遍的难度判官从三个只看颜色的机器人换成一个会往前推演的玩家,让生成器选出真正吃车位的配色。

**Architecture:** 新增纯逻辑模块 `core/search-player.ts`(状态分叉 + 推演式玩家 + 三星认证 + 车位需求);`level-gen.ts` 的配色第二遍改为按 width 从窄到宽用它认证与打分,选择逻辑抽成一个可注入判官的纯函数以便快速单测;出货文件上的难度断言从 jest 搬到新的慢检查 `npm run check`。

**Tech Stack:** TypeScript,jest(ts-jest),Node(`npm run gen` 用 tsc 编到 `.tmp/gen` 后直接跑),Cocos Creator 3.8.7 工程但 core 不 import `cc`。

**Spec:** `docs/superpowers/specs/2026-09-24-strong-player-painting-design.md`

## Global Constraints

- `core/` 下任何文件不得 `import ... from 'cc'`。
- 生成器必须可复现:`level-gen.ts` 和 `search-player.ts` 里不得出现 `Math.random(`、`Date.now(`、`new Date(`;所有随机数由种子派生。
- 配色第二遍的上限按**对局数**计,不按时间:`ACCEPT = 16`,`GAME_BUDGET = 120`。
- 三星认证:`unlocked` 个车位、不买,最多 3 个种子,任一局赢即通过。
- 车位需求:从 `unlocked − 1` 往下试到 1,每档最多 3 个种子,某档全输即停,返回上一档。
- 推演线 8 条:`decisive`、`careful`、`keepDistinct`,加 `slip(decisive, 0.15)`、`slip(decisive, 0.20)`、`slip(decisive, 0.25)`、`slip(decisive, 0.15)`、`slip(decisive, 0.20)`。
- 推演打分:赢 = `1000 − 50 × 买的车位数`;卡死 = `−剩余乘客`;到 tick 上限仍在进行 = `−剩余乘客 − 500`。选项分数取最好一条线,平均值 × 1e-3 作平手判据;打平优先点车;"不再点"只在环上有空格时提供,且须严格更好。
- `TICK_CAP = 4000`,与 `play-sim.ts` 相同。
- `DEMAND_CURVE` 数值不变(`[1, 4, 4, 4, 4, 4, 4, 4, 4, 4]`),含义改为强玩家车位需求目标。
- 不改:棋盘打包、隧道、轨道、颜色数、开局车位数、关卡 JSON 格式。
- 注释与代码保持英文风格为主、与周边一致(这个文件里中英混写的地方沿用中文);对用户的说明用中文。
- 两道闸门:`cd logic && npm test`、`cd logic && npm run typecheck:view`。
- 分支:在 `dev` 上直接提交,每个任务一个提交,提交信息结尾带 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。

## Review Focus

1. **预算在候选中途用完**:认证/需求测到一半没局了,结果必须确定(同 id 同结果),认证返回 false、需求返回当前上界,不得抛错或返回 NaN。→ Task 2 的 budget 测试。
2. **分叉漏掉隧道状态**:隧道关里分叉后,隧道口车辆与出场顺序必须一起被复制。→ Task 1 的分叉精确测试用有两条隧道的第 10 关。
3. **强玩家在无解关上不终止**:无解/空转的关卡必须在 `TICK_CAP` 内结束并判负。→ Task 2 用 `hopelessLevel` 断言返回 `won: false`。
4. **新模块偷偷引入环境随机数**:源码检查只扫 `level-gen.ts`,新模块不在其内。→ Task 1 给 `search-player.ts` 加同款源码检查。
5. **选择函数在"一个都没通过"时静默返回某个配色**:必须返回 null,让生成器换下一个打包。→ Task 3 的 `selectPainting` 测试。

---

### Task 1: 状态分叉 `forkCore`

**Files:**
- Create: `game/assets/scripts/core/search-player.ts`
- Test: `logic/tests/search-player.test.ts`

**Interfaces:**
- Consumes: `GameCore`(`core/game-core.ts`),`careful`(`core/play-sim.ts`)
- Produces: `export function forkCore(core: GameCore): GameCore`

- [ ] **Step 1: Write the failing tests**

Create `logic/tests/search-player.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { forkCore } from '../../game/assets/scripts/core/search-player';
import { careful } from '../../game/assets/scripts/core/play-sim';
import { GameCore } from '../../game/assets/scripts/core/game-core';
import { LevelData } from '../../game/assets/scripts/core/types';

/** 发出去的那一关,逐字节。 */
function shipped(id: number): LevelData {
  const p = path.join(__dirname, '../../game/assets/resources/levels', `level-${id}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as LevelData;
}

/** The shipped game's tick, driven by a deterministic policy, for `ticks` ticks. */
function drive(g: GameCore, ticks: number): void {
  for (let t = 0; t < ticks && g.getState() === 'playing'; t++) {
    let movable = g.lot.movableCarIds();
    for (let k = 0; k < g.parking.parked.length; k++) {
      if (!g.parking.hasFreeSlot() || movable.length === 0) break;
      const id = careful(g, movable, () => 0);
      if (id < 0 || !g.tapCar(id).ok) break;
      movable = movable.filter((m) => m !== id);
    }
    g.stepLoop();
    if (g.needsUnlock()) g.unlockSlot();
  }
}

function signature(g: GameCore): string {
  return JSON.stringify([
    g.getState(), g.parking.unlocksUsed(), g.loop.remainingCount(), g.lot.cars.size,
  ]);
}

test('a fork played on is the same game as the one it was forked from', () => {
  // Level 10 on purpose: two tunnels, so a fork that dropped tunnel state (the mouth car,
  // the cars queued behind it) would diverge the first time a mouth empties.
  const a = new GameCore(shipped(10));
  drive(a, 60);
  const b = forkCore(a);
  drive(a, 4000);
  drive(b, 4000);
  expect(signature(b)).toBe(signature(a));
});

test('a fork shares no state with its source', () => {
  const a = new GameCore(shipped(10));
  const b = forkCore(a);
  const before = a.lot.cars.size;
  const id = b.lot.movableCarIds()[0];
  expect(b.tapCar(id).ok).toBe(true);
  expect(a.lot.cars.size).toBe(before);
  expect(b.lot.cars.size).toBe(before - 1);
  // And the shared references INSIDE the fork still point at the fork's own systems.
  expect((b as any).boarding.loop).toBe(b.loop);
  expect((b as any).boarding.parking).toBe(b.parking);
});

test('the search player takes no input but its seed', () => {
  // Same guard as level-gen.test.ts's source check, for the module the generator now calls.
  const src = fs.readFileSync(
    path.join(__dirname, '../../game/assets/scripts/core/search-player.ts'), 'utf8',
  );
  const code = src.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');
  expect(code).not.toMatch(/Math\.random\s*\(/);
  expect(code).not.toMatch(/Date\.now\s*\(/);
  expect(code).not.toMatch(/new Date\s*\(/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd logic && npx jest search-player`
Expected: FAIL — `Cannot find module '../../game/assets/scripts/core/search-player'`.

- [ ] **Step 3: Write minimal implementation**

Before writing, confirm the field names the isolation test reads: `grep -n "constructor" game/assets/scripts/core/boarding-system.ts` — the two constructor parameters must be stored as `loop` and `parking`. If they are named differently, change the two `expect((b as any).boarding.…)` lines to those names; do not rename production fields.

Create `game/assets/scripts/core/search-player.ts`:

```ts
import { GameCore } from './game-core';

/**
 * A player that looks ahead, so the generator can ask how hard a painting is of something
 * closer to a person than the three bots in play-sim.ts.
 *
 * WHY IT EXISTS. The bots read colours and never the lot -- none of them considers that
 * bringing out car A frees car B behind it, which is most of what a person plans in this
 * game. Measured 2026-09-24 on the nine shipped packed levels, clamped to three stalls and
 * nothing bought, the bots cleared none of them and this player cleared eight; on two
 * stalls it cleared six. The generator had been certifying every level as "needs four
 * stalls" on the bots' word. See docs/superpowers/specs/2026-09-24-strong-player-painting-design.md.
 */

/**
 * The whole state of a game, copied, so a decision can be tried without committing to it.
 *
 * A structural deep copy: prototypes are kept (`Object.create`), and a memo keeps shared
 * references shared -- `BoardingSystem` points at the same `LoopSystem` and `ParkingSystem`
 * the core owns, and a copy that duplicated them would board passengers onto a bay nothing
 * else can see. The core's systems hold only Maps, Sets, arrays and plain values (no
 * closures, no typed arrays), which is what makes this complete; a field that broke that
 * would show up as the fork-equivalence test in search-player.test.ts failing.
 */
export function forkCore(core: GameCore): GameCore {
  return fork(core, new Map()) as GameCore;
}

function fork(obj: unknown, memo: Map<object, unknown>): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  const hit = memo.get(obj as object);
  if (hit !== undefined) return hit;
  if (obj instanceof Map) {
    const out = new Map();
    memo.set(obj, out);
    for (const [k, v] of obj) out.set(fork(k, memo), fork(v, memo));
    return out;
  }
  if (obj instanceof Set) {
    const out = new Set();
    memo.set(obj, out);
    for (const v of obj) out.add(fork(v, memo));
    return out;
  }
  if (Array.isArray(obj)) {
    const out: unknown[] = new Array(obj.length);
    memo.set(obj, out);
    for (let i = 0; i < obj.length; i++) out[i] = fork(obj[i], memo);
    return out;
  }
  const out = Object.create(Object.getPrototypeOf(obj)) as Record<string, unknown>;
  memo.set(obj as object, out);
  for (const k of Object.keys(obj as object)) out[k] = fork((obj as Record<string, unknown>)[k], memo);
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd logic && npx jest search-player`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add game/assets/scripts/core/search-player.ts logic/tests/search-player.test.ts
git commit -m "feat(core): fork a game so a decision can be tried without committing to it"
```

(Cocos Creator writes `search-player.ts.meta` the next time the editor opens the project; commit it then. Nothing in `view/` imports this module, so the game runs without it.)

---

### Task 2: 推演玩家、三星认证、车位需求

**Files:**
- Modify: `game/assets/scripts/core/search-player.ts`
- Test: `logic/tests/search-player.test.ts`

**Interfaces:**
- Consumes: `forkCore`(Task 1);`Policy`、`Playout`、`decisive`、`careful`、`keepDistinct`、`slip`、`simulate`(`core/play-sim.ts`);`LevelData`(`core/types.ts`)
- Produces:
  - `export interface Budget { games: number }` — 剩余可用对局数,每打一局 `searchPlay` 减 1
  - `export function searchPlay(level: LevelData, opts: { buy: boolean; seed: number }): Playout`
  - `export function certifyThreeStar(level: LevelData, salt: number, budget?: Budget): boolean`
  - `export function strongDemand(level: LevelData, salt: number, budget?: Budget): number`

- [ ] **Step 1: Write the failing tests**

Append to `logic/tests/search-player.test.ts`:

```ts
import { searchPlay, certifyThreeStar, strongDemand } from '../../game/assets/scripts/core/search-player';
import { decisive, keepDistinct, simulate } from '../../game/assets/scripts/core/play-sim';

// Copied from play-sim.test.ts, where they are local: one red car and 16 red passengers.
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

test('a trivial level is certified and needs one stall', () => {
  expect(certifyThreeStar(soloLevel(), 1)).toBe(true);
  expect(strongDemand(soloLevel(), 1)).toBe(1);
});

test('a level nothing can fill is not certified, and the player stops', () => {
  // Also the termination guard: this must come back as a loss inside TICK_CAP, not spin.
  expect(certifyThreeStar(hopelessLevel(), 1)).toBe(false);
  expect(searchPlay(hopelessLevel(), { buy: true, seed: 1 }).won).toBe(false);
});

test('it clears a shipped level on fewer stalls than every bot can, and does it the same way twice', () => {
  // Level 4 on three stalls, nothing bought: measured 2026-09-24, the bots lose it with 624
  // passengers still on the ring and this player clears it. About 30 s.
  const lvl = shipped(4);
  lvl.parking.unlocked = 3;
  lvl.parking.slots = 3;
  for (const pol of [decisive, careful, keepDistinct]) expect(simulate(lvl, pol, 1)).toBe(false);
  const first = searchPlay(lvl, { buy: false, seed: 7 });
  expect(first.won).toBe(true);
  expect(searchPlay(lvl, { buy: false, seed: 7 })).toEqual(first);
}, 600000);

test('a budget that runs out stops the measuring deterministically', () => {
  // Nothing left: no game is played, certification cannot be claimed.
  const none = { games: 0 };
  expect(certifyThreeStar(soloLevel(), 1, none)).toBe(false);
  expect(none.games).toBe(0);
  // One game: it certifies, then has nothing left to try lower tiers with, so the demand it
  // reports is the upper bound it already has -- the full bay -- not a guess.
  const one = { games: 1 };
  expect(certifyThreeStar(soloLevel(), 1, one)).toBe(true);
  expect(one.games).toBe(0);
  expect(strongDemand(soloLevel(), 1, one)).toBe(soloLevel().parking.unlocked);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd logic && npx jest search-player`
Expected: FAIL — TypeScript error `Module ... has no exported member 'searchPlay'`.

- [ ] **Step 3: Write minimal implementation**

In `game/assets/scripts/core/search-player.ts`, change the import line to:

```ts
import { GameCore } from './game-core';
import { LevelData } from './types';
import { Playout, Policy, careful, decisive, keepDistinct, slip } from './play-sim';
```

and append:

```ts
/** Ticks before a game is called. Same as play-sim.ts's TICK_CAP. */
const TICK_CAP = 4000;

/** mulberry32, local: level-gen.ts exports one, but level-gen imports this module. */
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
 * The lines each option is played out along. The three bots as they are, plus noisy
 * `decisive`. An option is valued by its BEST line -- a player only needs one way through --
 * so a varied set is what finds it.
 */
const ROLLOUTS: Policy[] = [
  decisive, careful, keepDistinct,
  slip(decisive, 0.15), slip(decisive, 0.20), slip(decisive, 0.25),
  slip(decisive, 0.15), slip(decisive, 0.20),
];

/** One tick's taps, the way play-sim.ts's `play` makes them: at most one per open stall. */
function tapPhase(g: GameCore, choose: (g: GameCore, movable: number[]) => number): void {
  let movable: number[] | null = null;
  for (let k = 0; k < g.parking.parked.length; k++) {
    if (g.getState() !== 'playing' || !g.parking.hasFreeSlot()) break;
    if (movable === null) movable = g.lot.movableCarIds();
    if (movable.length === 0) break;
    const id = choose(g, movable);
    if (id < 0 || !g.tapCar(id).ok) break;
    movable = movable.filter((m) => m !== id);
  }
}

function step(g: GameCore, buy: boolean): void {
  g.stepLoop();
  if (buy && g.needsUnlock()) g.unlockSlot();
}

/**
 * A finished line, scored. A win outranks everything, cheaper wins first. A line still
 * PLAYING at the cap is a spin -- a policy waiting on an empty stall forever -- and scores
 * below any real deadlock, or the search would prefer standing still to losing honestly.
 */
function score(g: GameCore): number {
  if (g.getState() === 'won') return 1000 - 50 * g.parking.unlocksUsed();
  if (g.getState() === 'playing') return -g.loop.remainingCount() - 500;
  return -g.loop.remainingCount();
}

/** Waiting only means something while a ring cell is free; with the ring solid nothing changes. */
function canWait(g: GameCore): boolean {
  for (const grp of g.loop.ring) if (grp === null || grp.count === 0) return true;
  return false;
}

/** `action` is a car id to tap now, or -1 for "no more taps this tick". */
function evaluate(g: GameCore, action: number, buy: boolean, salt: number): number {
  let best = -Infinity;
  let total = 0;
  for (let i = 0; i < ROLLOUTS.length; i++) {
    const pol = ROLLOUTS[i];
    const rand = rng((i + 1) * 7919 + salt);
    const h = forkCore(g);
    if (action >= 0) {
      h.tapCar(action);
      tapPhase(h, (c, mv) => pol(c, mv, rand));
    }
    step(h, buy);
    for (let t = 0; t < TICK_CAP && h.getState() === 'playing'; t++) {
      tapPhase(h, (c, mv) => pol(c, mv, rand));
      step(h, buy);
    }
    const s = score(h);
    total += s;
    if (s > best) best = s;
  }
  return best + (total / ROLLOUTS.length) * 1e-3;
}

/**
 * Play `level` looking ahead at every decision. Same rules as play-sim.ts's `play`: without
 * `buy` the bay is clamped to `unlocked`; with it, a jam buys a stall the way the device's
 * prompt does. Deterministic in `seed`.
 *
 * A TIE GOES TO THE TAP, and "no more taps" is only offered while a ring cell is free. The
 * first version of this took the first option on a tie, which was "wait", and every level
 * spun to the tick cap -- the same failure play-sim.ts documents for `careful`.
 */
export function searchPlay(level: LevelData, opts: { buy: boolean; seed: number }): Playout {
  const copy: LevelData = JSON.parse(JSON.stringify(level));
  if (!opts.buy) copy.parking.slots = copy.parking.unlocked;
  const g = new GameCore(copy);
  for (let tick = 0; tick < TICK_CAP && g.getState() === 'playing'; tick++) {
    let k = 0;
    tapPhase(g, (c, movable) => {
      const salt = (opts.seed * 1000003 + tick * 31 + k++) >>> 0;
      let bestA = movable[0];
      let bestV = evaluate(c, bestA, opts.buy, salt);
      for (const id of movable.slice(1)) {
        const v = evaluate(c, id, opts.buy, salt);
        if (v > bestV) { bestV = v; bestA = id; }
      }
      if (canWait(c) && evaluate(c, -1, opts.buy, salt) > bestV) return -1;
      return bestA;
    });
    step(g, opts.buy);
  }
  return {
    won: g.getState() === 'won',
    bought: g.parking.unlocksUsed(),
    dead: g.getState() === 'deadlock',
  };
}

/** Games still allowed. Every `searchPlay` a measurement makes takes one. */
export interface Budget { games: number }

const TRIES = 3;

function tryWin(level: LevelData, salt: number, budget: Budget | undefined): boolean {
  for (let s = 0; s < TRIES; s++) {
    if (budget) {
      if (budget.games <= 0) return false;
      budget.games--;
    }
    if (searchPlay(level, { buy: false, seed: salt * TRIES + s }).won) return true;
  }
  return false;
}

/**
 * Cleared on the bay the level ships with, nothing bought, on any of three seeds.
 *
 * A WIN IS PROOF -- the player walked a real line to the end. A loss is not: this is a
 * search, not an enumeration, and it has lost a painting on four stalls that it then won on
 * the same four stalls by another seed. So `true` is certain and `false` means "not shown".
 */
export function certifyThreeStar(level: LevelData, salt: number, budget?: Budget): boolean {
  return tryWin(level, salt, budget);
}

/**
 * Fewest opening stalls this player clears `level` on, nothing bought. Call it only on a
 * level `certifyThreeStar` passed: it starts from `unlocked` as already shown.
 *
 * An UPPER BOUND on the true figure, for the reason `certifyThreeStar` gives: a tier is
 * given up after three losses, and a cleverer player may find what three seeds did not.
 * When the budget runs out the bound it has is what it returns.
 */
export function strongDemand(level: LevelData, salt: number, budget?: Budget): number {
  let need = level.parking.unlocked;
  for (let k = need - 1; k >= 1; k--) {
    const probe: LevelData = JSON.parse(JSON.stringify(level));
    probe.parking.unlocked = k;
    if (!tryWin(probe, salt * 7 + k, budget)) break;
    need = k;
  }
  return need;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd logic && npx jest search-player`
Expected: 7 passed (the level-4 test takes about a minute).

If the level-4 test fails ONLY on `expect(first.won).toBe(true)`, the seed is the problem, not the code: the 2026-09-24 calibration won this level on three stalls with a different salt, and a loss by one seed proves nothing (see `certifyThreeStar`). Try seeds 1 to 6 with a throwaway script, pin the first that wins in both `searchPlay` calls, and add a one-line comment saying which seeds were tried. If none of 1–6 wins, stop and report — that contradicts the calibration.

If `strongDemand(soloLevel(), 1)` comes back 4 rather than 1, check `tryWin` passes `probe` (with the lowered `unlocked`), not `level`.

- [ ] **Step 5: Run the typecheck**

Run: `cd logic && npm run typecheck:view`
Expected: no errors. (`search-player.ts` lives under `game/assets`, so it is compiled into the game too.)

- [ ] **Step 6: Commit**

```bash
git add game/assets/scripts/core/search-player.ts logic/tests/search-player.test.ts
git commit -m "feat(core): a player that looks ahead, and three-star and stall measures made of it"
```

---

### Task 3: 配色第二遍改由强玩家判

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts` — import line 7;`DEMAND_CURVE` 注释(约 787–806 行);`SIM_BUDGET` 及其注释(约 1744–1757 行);`choosePainting` 第二遍(约 1814–1862 行)
- Modify: `logic/tests/level-gen.test.ts` — 删除 `three stars are reachable on the bay every level ships with` 与 `every packed level asks for the whole bay`(约 486–520 行)
- Modify: `tools/gen-levels.ts` — 表头 `stalls` 改为 `bot`
- Test: `logic/tests/level-gen.test.ts`(新增 `selectPainting` 测试)

**Interfaces:**
- Consumes: `certifyThreeStar`、`strongDemand`、`Budget`(Task 2)
- Produces:
  - `export interface PaintingCandidate { painted: CarSpec[]; width: number }`
  - `export interface PaintingJudge { certify(painted: CarSpec[], index: number, budget: Budget): boolean; demand(painted: CarSpec[], index: number, budget: Budget): number }`
  - `export function selectPainting(sorted: PaintingCandidate[], target: number, judge: PaintingJudge): CarSpec[] | null`
  - `export const ACCEPT = 16; export const GAME_BUDGET = 120;`

- [ ] **Step 1: Write the failing tests**

Append to `logic/tests/level-gen.test.ts`:

```ts
import { selectPainting, ACCEPT, GAME_BUDGET, PaintingCandidate } from '../../game/assets/scripts/core/level-gen';

/** Candidates whose only identity is their index, so a fake judge can script each one. */
function fakes(widths: number[]): PaintingCandidate[] {
  return widths.map((width, i) => ({ painted: [{ id: i, x: 0, y: 0, angle: 0, color: 'red', cap: 'small' }], width }));
}
const idOf = (p: CarSpec[] | null) => (p === null ? null : p[0].id);

test('selectPainting stops at the first candidate that meets the target, narrow end first', () => {
  const played: number[] = [];
  const pick = selectPainting(fakes([1.0, 1.1, 1.2, 1.3]), 4, {
    certify: (_p, i, b) => { b.games--; played.push(i); return true; },
    demand: (_p, i) => [2, 4, 4, 1][i],
  });
  expect(idOf(pick)).toBe(1);
  expect(played).toEqual([0, 1]);   // nothing past the winner is played
});

test('selectPainting takes the nearest demand, then the narrowest, and skips what it cannot certify', () => {
  const pick = selectPainting(fakes([1.0, 1.1, 1.2, 1.3]), 4, {
    certify: (_p, i) => i !== 0,          // the narrowest cannot be shown three-star
    demand: (_p, i) => [4, 2, 3, 3][i],
  });
  expect(idOf(pick)).toBe(2);           // 3 beats 2; of the two 3s, 1.2 is narrower
});

test('selectPainting returns null when nothing is certified, so the generator tries another packing', () => {
  const pick = selectPainting(fakes([1.0, 1.1]), 4, { certify: () => false, demand: () => 4 });
  expect(pick).toBeNull();
});

test('selectPainting spends at most GAME_BUDGET games and keeps at most ACCEPT candidates', () => {
  let certified = 0;
  let spent = 0;
  selectPainting(fakes(Array.from({ length: 400 }, (_, i) => 1 + i / 1000)), 4, {
    certify: (_p, _i, b) => { b.games -= 1; spent++; certified++; return true; },
    demand: () => 2,
  });
  expect(certified).toBeLessThanOrEqual(ACCEPT);
  expect(spent).toBeLessThanOrEqual(GAME_BUDGET);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd logic && npx jest level-gen -t selectPainting`
Expected: FAIL — `Module ... has no exported member 'selectPainting'`.

- [ ] **Step 3: Write the selection function and wire it in**

In `game/assets/scripts/core/level-gen.ts`:

(a) Replace line 7:

```ts
import { judge, mistakeCost, exitFrontiers, frontierWidth, exitCars } from './play-sim';
```

with:

```ts
import { exitFrontiers, frontierWidth, exitCars } from './play-sim';
import { Budget, certifyThreeStar, strongDemand } from './search-player';
```

(If `tsc` then reports `judge` or `mistakeCost` still used elsewhere in the file, put the name back in the import; do not change that other use.)

(b) Replace the `SIM_BUDGET` doc comment and constant (the block that starts `/**\n * 真正下场跑模拟的配色个数。` and ends `const SIM_BUDGET = 40;`) with:

```ts
/**
 * 第二遍的上限,按局数计,不按时间计。
 *
 * 第二遍现在由 `search-player.ts` 的强玩家来判,一局 5 秒到 5 分钟不等,所以必须有上限;
 * 而上限只能是计数:同一个 id 必须永远生成同一关(`the generator takes no input but its
 * id`),按秒截断会让结果跟着机器快慢变。
 *
 * 一个候选最多要 12 局(三星认证 3 局,三档车位需求各 3 局),所以难的关上通常是
 * GAME_BUDGET 先用完、攒不满 ACCEPT 个;简单的候选赢得早,只花一两局。
 */
export const ACCEPT = 16;
export const GAME_BUDGET = 120;

export interface PaintingCandidate { painted: CarSpec[]; width: number }

/** The two measures `selectPainting` asks of a candidate. Injected so it can be tested fast. */
export interface PaintingJudge {
    certify(painted: CarSpec[], index: number, budget: Budget): boolean;
    demand(painted: CarSpec[], index: number, budget: Budget): number;
}

/**
 * Walk `sorted` from the narrow end and keep what a player that looks ahead can clear on the
 * bay the level ships with, buying nothing. The first one whose stall demand meets `target`
 * wins outright -- it is as hungry as the curve asks and narrower than anything after it.
 * Otherwise the kept one nearest the target wins, the narrowest on a tie.
 *
 * WHY NOT THE BOTS ANY MORE. Measured 2026-09-24: of 400 candidates on level 10, the bots
 * called 180 dead, and every one of the six narrowest re-played by the lookahead player was
 * clearable. On level 3 all six were three-star. The bots were throwing away exactly the
 * narrow paintings this search exists to find, and their stall figure agreed with the
 * lookahead player's on almost nothing. See the 2026-09-24 spec.
 *
 * Returns null when nothing is certified, so `generateLevel` moves on to its next packing.
 */
export function selectPainting(
    sorted: PaintingCandidate[], target: number, judge: PaintingJudge,
): CarSpec[] | null {
    const budget: Budget = { games: GAME_BUDGET };
    const kept: { painted: CarSpec[]; width: number; demand: number }[] = [];
    for (let i = 0; i < sorted.length && budget.games > 0 && kept.length < ACCEPT; i++) {
        const c = sorted[i];
        if (!judge.certify(c.painted, i, budget)) continue;
        const demand = judge.demand(c.painted, i, budget);
        if (demand === target) return c.painted;
        kept.push({ painted: c.painted, width: c.width, demand });
    }
    if (kept.length === 0) return null;
    kept.sort((a, b) => (Math.abs(a.demand - target) - Math.abs(b.demand - target)) || (a.width - b.width));
    return kept[0].painted;
}
```

(c) In `choosePainting`, keep everything up to and including `seen.sort((x, y) => x.width - y.width);`. Replace everything after it, down to and including the function's closing `return best;\n}`, with:

```ts
    // Pass two: the lookahead player, narrow end first. Seeds come from the id and the
    // candidate's place in the sorted list, so the same id always walks the same games.
    return selectPainting(seen, target, {
        certify: (painted, i, budget) =>
            certifyThreeStar(assemble(id, painted, tunnels), id * 104729 + i * 17, budget),
        demand: (painted, i, budget) =>
            strongDemand(assemble(id, painted, tunnels), id * 104729 + i * 17, budget),
    });
}
```

`seen` already has the `{ painted, width }` shape `PaintingCandidate` wants. The `if (p.colors <= UNLOCKED) return null;`, `const target = demandTarget(id);` and pass one stay as they are.

(d) Update the `DEMAND_CURVE` doc comment. Replace its last paragraph (the one beginning `4 就是这个设计的天花板`) with:

```ts
 * 4 就是这个设计的天花板,而且是算出来的不是调出来的:开局给 `UNLOCKED` 个车位,又要求
 * 三星拿得到(也就是不买车位就能通关),那么"最少需要几个"最多只能等于 `UNLOCKED`。
 *
 * 2026-09-24 起,这个数由 `search-player.ts` 的强玩家来量,不再由 play-sim 的三个机器人。
 * 机器人只看颜色、不看停车场结构,在出货的九关上一律报"要 4 个",而强玩家在其中六关只用
 * 2 个就过 —— 人类伙伴报的正是这个。强玩家的数是真实需求的**上界**(见 `strongDemand`)。
```

(e) In `tools/gen-levels.ts`, in the header `console.log`, replace the substring

```
exits stalls    slip
```

with

```
exits    bot    slip
```

(same width, six characters for six). Then, directly above `const stalls = want.colors <= 4 ? '  -  '`, replace the existing comment block (the one beginning `// 开局给四个车位,这一关最少用几个就能过`) with:

```ts
    // 开局给四个车位,**机器人**最少用几个就能过。表头叫 bot 而不是 stalls:它是 play-sim
    // 那三个只看颜色的机器人的数,2026-09-24 起已经不是生成器挑配色的依据(见
    // `selectPainting`)。强玩家的数由 `npm run check` 报告。
```

- [ ] **Step 4: Remove the two shipped-file demand tests**

In `logic/tests/level-gen.test.ts`, delete the whole `test('three stars are reachable on the bay every level ships with', ...)` and `test('every packed level asks for the whole bay', ...)` blocks (they move to `npm run check` in Task 4). If `judge` is now unused in that file, remove it from the `play-sim` import.

- [ ] **Step 5: Run the new tests**

Run: `cd logic && npx jest level-gen -t selectPainting`
Expected: 4 passed.

- [ ] **Step 6: Run both gates**

Run: `cd logic && npm test && npm run typecheck:view`
Expected: all suites pass. The shipped level files are unchanged in this task, so every shipped-file assertion still holds; `the generator takes no input but its id` must still pass.

- [ ] **Step 7: Commit**

```bash
git add game/assets/scripts/core/level-gen.ts logic/tests/level-gen.test.ts tools/gen-levels.ts
git commit -m "feat(gen): choose paintings by a player that looks ahead, not by the bots"
```

---

### Task 4: 慢检查 `npm run check`

**Files:**
- Create: `tools/check-difficulty.ts`
- Modify: `logic/tsconfig.gen.json` — `include` 加 `"../tools/check-difficulty.ts"`
- Modify: `logic/package.json` — `scripts` 加 `"check"`

**Interfaces:**
- Consumes: `certifyThreeStar`、`strongDemand`(Task 2);`judge`、`exitWidth`(`core/play-sim.ts`);`LevelData`
- Produces: `npm run check [-- --only N]`,任一打包关未通过三星认证时退出码 1

- [ ] **Step 1: Write the script**

Create `tools/check-difficulty.ts`:

```ts
/**
 * The difficulty of the SHIPPED levels, measured by the player that looks ahead.
 *
 *   cd logic && npm run check              -> levels 2..10
 *   cd logic && npm run check -- --only 4  -> level 4 alone
 *
 * Slow on purpose and outside jest for that reason: a level is minutes of lookahead play.
 * It replaces two jest tests that asked the bots the same questions ("three stars are
 * reachable", "every level asks for the whole bay") -- the bots' answers turned out to say
 * little about a player who reads the lot. Exits 1 if any packed level cannot be shown
 * three-star on the bay it ships with.
 */
import * as fs from 'fs';
import * as path from 'path';
import { certifyThreeStar, strongDemand } from '../game/assets/scripts/core/search-player';
import { judge, exitWidth } from '../game/assets/scripts/core/play-sim';
import { LevelData } from '../game/assets/scripts/core/types';

const dir = path.resolve(process.cwd(), '..', 'game', 'assets', 'resources', 'levels');
const flag = process.argv.indexOf('--only');
const ids = flag >= 0 ? [Number(process.argv[flag + 1])] : [2, 3, 4, 5, 6, 7, 8, 9, 10];

let failed = 0;
console.log(' id  三星认证  强玩家车位  机器人车位  width   用时');
for (const id of ids) {
  const level = JSON.parse(fs.readFileSync(path.join(dir, `level-${id}.json`), 'utf8')) as LevelData;
  const colors = new Set(level.lot.cars.map((c) => c.color)).size;
  if (colors <= level.parking.unlocked) {
    console.log(`${String(id).padStart(3)}  (教学关,颜色不多于车位,跳过)`);
    continue;
  }
  const t0 = process.hrtime.bigint();
  const ok = certifyThreeStar(level, id);
  const strong = ok ? String(strongDemand(level, id)) : '-';
  const bot = judge(level).demand;
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  if (!ok) failed++;
  console.log(
    `${String(id).padStart(3)}  ${(ok ? '通过' : '未通过').padStart(6)}  ${strong.padStart(8)}  ${String(bot).padStart(8)}`
    + `  ${exitWidth(level).toFixed(2).padStart(5)}  ${secs.toFixed(0).padStart(4)}s`,
  );
}
if (failed > 0) {
  console.error(`\n[check] ${failed} 个关卡证明不了三星(开局车位、不买车位)`);
  process.exit(1);
}
```

(`process.hrtime` is only for the printed timing column. This file is a tool, not the generator, so the determinism rule does not apply to it; do not import it from core.)

- [ ] **Step 2: Register it**

In `logic/tsconfig.gen.json`, change the `include` array to:

```json
  "include": ["../tools/gen-levels.ts", "../tools/band-sweep.ts", "../tools/patch-splash.ts",
              "../tools/check-difficulty.ts",
              "../game/assets/scripts/core/**/*.ts"]
```

In `logic/package.json` `scripts`, add after `"sweep"`:

```json
    "check": "tsc -p tsconfig.gen.json && node ../.tmp/gen/tools/check-difficulty.js",
```

- [ ] **Step 3: Run it on one level**

Run: `cd logic && npm run check -- --only 4`
Expected: one row for level 4, `三星认证` = `通过`, `强玩家车位` = `2` (measured 2026-09-24; `3` is acceptable, it is an upper bound), `机器人车位` = `4`, exit code 0.

- [ ] **Step 4: Run it on all nine**

Run: `cd logic && npm run check` (about 10–20 minutes)
Expected: all nine `通过`, exit code 0. Save the printed table — it is the "before" column for Task 5. Expected strong figures from the 2026-09-24 calibration: levels 3, 4, 5, 6, 8, 10 → 2; levels 2, 9 → 3; level 7 → 4. Small differences are fine; a level that is `未通过` here is a finding to report, not something to fix in this task.

- [ ] **Step 5: Commit**

```bash
git add tools/check-difficulty.ts logic/tsconfig.gen.json logic/package.json
git commit -m "feat(tools): measure the shipped levels with the lookahead player"
```

---

### Task 5: 重生成与对照

**Files:**
- Modify: `game/assets/resources/levels/level-2.json` … `level-10.json`(生成器输出)

**Interfaces:**
- Consumes: Tasks 1–4
- Produces: 新的九关与一张新旧对照表

- [ ] **Step 1: Regenerate one level first**

Run: `cd logic && npm run gen -- --only 2`
Expected: the gen table prints one row with `play` not `BROKEN`; typical wall time 30–90 minutes. If it takes more than three hours, stop and report the time — the budget assumption in the spec is wrong.

- [ ] **Step 2: Check it**

Run: `cd logic && npm run check -- --only 2`
Expected: `通过`. Compare its `强玩家车位` and `width` with the "before" row from Task 4.

- [ ] **Step 3: Regenerate the rest (overnight)**

Run: `cd logic && npm run gen -- --only 3-10` in the background.
Expected: nine files rewritten; no `BROKEN` row.

- [ ] **Step 4: Gates and check**

Run: `cd logic && npm test && npm run typecheck:view && npm run check`
Expected: all pass. If a shipped-file test in `level-gen.test.ts` now fails (the most likely are `the second half of the curve is harder than the first, by what the curve steers` and `no level puts more than a handful of cars on the table at once`), **stop and report it with the failing numbers** — do not loosen the assertion. Those tests encode decisions the human partner made.

- [ ] **Step 5: Report the comparison**

Produce this table for the human partner, "before" from Task 4 Step 4, "after" from Step 4 above:

```
 id   强玩家车位(前→后)   width(前→后)   机器人车位(前→后)
```

State plainly how many levels' strong demand rose, how many only narrowed, and whether any got easier.

- [ ] **Step 6: Commit**

```bash
git add game/assets/resources/levels/
git commit -m "feat(levels): regenerate 2-10 with paintings chosen by the lookahead player"
```
