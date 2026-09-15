# 大厅界面重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把大厅从"写实照片 + 直路 + 胶囊列表"改成"纯代码扁平街道 + 蜿蜒路径 + 圆形关卡徽章 + 常驻顶部栏",并补上金币子系统和四条修复。

**Architecture:** 三块新几何/数值逻辑进 `core/`(纯 TS,jest 可测),三块新绘制进 `view/`(import `cc`,只能过类型闸门)。棋盘配色提到 `view/palette.ts` 供两边共用。手势层(`rail-math.ts` + `home-view` 的 drag)不重写,只改一个常量的来源。

**Tech Stack:** TypeScript 5.4,Cocos Creator 3.8.7,jest 29 + ts-jest。无第三方 UI 库,所有图元由 `view/ui-shapes.ts` 在运行时画进纹理。

**Spec:** [docs/superpowers/specs/2026-09-15-home-screen-rework-design.md](../specs/2026-09-15-home-screen-rework-design.md)

## Global Constraints

- **`core/` 下任何文件不许 `import ... from 'cc'`。** 一旦引入,jest 就再也加载不了那个文件。三个新增 core 文件全是纯 TS。
- **两道闸门每个任务都要过:** `cd logic && npm test` 和 `cd logic && npm run typecheck:view`。
- **`typecheck:view` 依赖 `game/temp/declarations/cc.d.ts`**,那是 Cocos Creator 生成的、被 gitignore 的文件。跑之前必须用 Creator 打开过一次 `game/` 工程。
- **`view/` 没有测试环境。** 它 import `cc`,jest 加载不了。view 任务的自动闸门只有类型检查;画面正确性靠 `node tools/preview.mjs` 在真机上看,那一步**需要人**(要 Creator GUI 和微信开发者工具),不能由 agent 声称完成。
- **画布宽固定 1280 设计单位**(`designResolution 1280x720, policy 4` FIXED_WIDTH)。高随宽高比变化,约 1707(4:3)到 2770(19.5:9)。**x 可以写绝对设计单位,y 必须从 `canvasSize(canvas).h` 推。**
- **子节点一律按名字查找,不许 `children[数字]`。** `logic/tests/view-source.test.ts` 会扫源码拦截。
- **`makeLabel` 建出来的 Label 初始 `string` 是空的**,忘了赋值就是屏幕上一个洞,不是引擎占位符"label"。
- **`game/assets/` 下每新建一个 `.ts`,必须把同名 `.ts.meta` 一起提交。** Cocos Creator 打开着工程时会自动生成它;没开着就照同目录兄弟(如 `progress.ts.meta`)的格式手写一份,换一个新的 uuid。`.meta` 没有被 gitignore。漏掉它,别人 clone 之后 Creator 会重新导入并生成不同的 uuid,场景里对这个脚本的引用就断了。`logic/tests/` 不在 Cocos 资源目录里,不需要 `.meta`。
- **代码注释一律用英文。** 这份计划的正文是中文(写给人读的),但它代码块里的中文注释是**意图草稿,不是要照抄进代码的成品** —— 落到 `.ts` 文件里必须译成英文,并保持同样的论证密度(解释 WHY、点名促成这个决定的具体故障)。`core/` 下现有 15 个文件的注释全是英文,用户的长期约定也是"代码、注释、commit message、文件名保持英文"。照抄计划里的中文注释会让新文件在一堆英文兄弟里格外扎眼。
- 提交信息标题和正文都用英文,标题遵循仓库现有的 `type(scope): 说明` 风格。每个任务单独提交。

---

## File Structure

新建:

| 文件 | 职责 |
|---|---|
| `game/assets/scripts/core/level-state.ts` | 关卡三态判定与该画几颗星 |
| `game/assets/scripts/core/wallet.ts` | 金币余额的解析/序列化/结算 |
| `game/assets/scripts/core/home-path.ts` | 节点中心坐标、腿间曲线采样、`RAIL_PITCH` |
| `game/assets/scripts/view/palette.ts` | 棋盘与大厅共用的材质配色 |
| `game/assets/scripts/view/home-scene.ts` | 扁平街道:路径描边、树、路灯 |
| `game/assets/scripts/view/top-bar.ts` | 常驻顶部栏 |
| `logic/tests/level-state.test.ts` | |
| `logic/tests/wallet.test.ts` | |
| `logic/tests/home-path.test.ts` | |

修改:`core/index.ts`、`view/rail-math.ts`、`view/ui-shapes.ts`、`view/ui-layout.ts`、`view/storage.ts`、`view/scene-stage.ts`、`view/hud-view.ts`、`view/home-view.ts`、`view/GameController.ts`、`logic/tests/rail-math.test.ts`、`logic/tests/view-source.test.ts`。

删除:`game/assets/resources/home-bg.jpg` 及 `home-bg.jpg.meta`。

---

### Task 1: core/level-state.ts — 关卡三态

**Files:**
- Create: `game/assets/scripts/core/level-state.ts`
- Create: `logic/tests/level-state.test.ts`
- Modify: `game/assets/scripts/core/index.ts`(末尾加一行 export)

**Interfaces:**
- Consumes: `Progress`、`bestStars`、`unlockedThrough`,都来自 `./progress`
- Produces:
  - `type LevelState = 'done' | 'current' | 'locked'`
  - `levelState(p: Progress, level: number): LevelState`
  - `starsFor(p: Progress, level: number): number`

- [ ] **Step 1: 写会失败的测试**

创建 `logic/tests/level-state.test.ts`:

```ts
import { levelState, starsFor } from '../../game/assets/scripts/core/level-state';
import { emptyProgress, Progress } from '../../game/assets/scripts/core/progress';

/** 造一个只有指定关卡有星的存档。星数一律 3,除非另行指定。 */
function save(cleared: number[], stars: Record<number, number> = {}): Progress {
  const p = emptyProgress();
  for (const n of cleared) p.stars[n] = stars[n] ?? 3;
  return p;
}

test('空存档:第 1 关是当前关,后面全锁', () => {
  const p = emptyProgress();
  expect(levelState(p, 1)).toBe('current');
  expect(levelState(p, 2)).toBe('locked');
  expect(levelState(p, 10)).toBe('locked');
});

test('通了 1 2 3:第 4 关当前,第 5 关锁', () => {
  const p = save([1, 2, 3]);
  expect(levelState(p, 3)).toBe('done');
  expect(levelState(p, 4)).toBe('current');
  expect(levelState(p, 5)).toBe('locked');
  expect(starsFor(p, 5)).toBe(0);
});

/**
 * 这一条是整个文件存在的理由。存档里第 5 关有三星,但第 4 关没通 —— 于是"锁着"和
 * "有星"同时为真。旧代码把这两件事分别算出来,再靠调用点记得 `&&` 起来;这里要求
 * 锁赢,而且星数从状态派生,view 拿不到自相矛盾的组合。
 */
test('缺口存档:第 5 关有三星但第 4 关没通,第 5 关仍然是锁着的且不画星', () => {
  const p = save([1, 2, 3, 5]);
  expect(levelState(p, 4)).toBe('current');
  expect(levelState(p, 5)).toBe('locked');
  expect(starsFor(p, 5)).toBe(0);
});

test('starsFor 只在 done 时给真实星数', () => {
  const p = save([1, 2], { 1: 3, 2: 1 });
  expect(starsFor(p, 1)).toBe(3);
  expect(starsFor(p, 2)).toBe(1);
  expect(starsFor(p, 3)).toBe(0); // current
  expect(starsFor(p, 9)).toBe(0); // locked
});

test('全通之后最后一关是 done,越界的关号不崩', () => {
  const p = save([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(levelState(p, 10)).toBe('done');
  expect(levelState(p, 11)).toBe('current');
  expect(levelState(p, 99)).toBe('locked');
});

test.each([0, -1, 1.5, NaN])('不合法的关号 %p 不抛', (level) => {
  const p = save([1, 2]);
  expect(() => levelState(p, level)).not.toThrow();
  expect(() => starsFor(p, level)).not.toThrow();
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd logic && npx jest tests/level-state.test.ts`
Expected: FAIL — `Cannot find module '../../game/assets/scripts/core/level-state'`

- [ ] **Step 3: 写实现**

创建 `game/assets/scripts/core/level-state.ts`:

```ts
import { bestStars, Progress, unlockedThrough } from './progress';

/**
 * 一关在大厅里的样子,三选一。
 *
 * 一个函数而不是三个谓词,而且**顺序即优先级** —— 这是这个文件唯一的设计内容。
 *
 * 在这之前 `home-view` 自己算三件事:`open = isUnlocked(...)`、`best = bestStars(...)`、
 * `done = best > 0`,然后把星星画成 `active = open && done`。"锁着"和"有星"是两个可以
 * 同时为真的独立事实(存档有缺口时就会:通了 1235,第 4 关空着,于是第 5 关既锁着又有
 * 三星),靠每个调用点都记得把它们 `&&` 起来。少写一次就是一个自相矛盾的节点。
 *
 * 收成一个返回联合类型的函数之后,三态由类型互斥,调用点不可能同时拿到两个。
 */
export type LevelState = 'done' | 'current' | 'locked';

export function levelState(p: Progress, level: number): LevelState {
    // 锁先判,锁赢。缺口存档里第 5 关有星也照锁不误。
    if (!(level <= unlockedThrough(p))) return 'locked';
    if (bestStars(p, level) > 0) return 'done';
    return 'current';
}

/**
 * 该画几颗星。非 `done` 一律 0。
 *
 * view 只该问这个,不该自己去调 `bestStars` —— 那样就又有了第二个真值来源,
 * 而"锁着却画了三星"正是第二个真值来源造出来的那类画面。
 */
export function starsFor(p: Progress, level: number): number {
    return levelState(p, level) === 'done' ? bestStars(p, level) : 0;
}
```

注意 `!(level <= unlockedThrough(p))` 而不是 `level > unlockedThrough(p)`:`NaN` 参与任何比较都是 false,写成 `>` 会让 `levelState(p, NaN)` 落进 `bestStars` 查表(返回 0)再落进 `'current'`,等于说"第 NaN 关是当前关"。取反之后 `NaN` 归 `'locked'`,这是唯一说得通的答案。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd logic && npx jest tests/level-state.test.ts`
Expected: PASS,9 个 test(5 个顶层 `test` + `test.each` 展开的 4 个)

- [ ] **Step 5: 接进 core 的桶文件**

在 `game/assets/scripts/core/index.ts` 的 `export * from './progress';` 下面加一行:

```ts
export * from './level-state';
```

- [ ] **Step 6: 过两道闸门**

Run: `cd logic && npm test`
Expected: 全绿,新增 6 个 test

Run: `cd logic && npm run typecheck:view`
Expected: 无输出(tsc 成功)

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/core/level-state.ts game/assets/scripts/core/level-state.ts.meta game/assets/scripts/core/index.ts logic/tests/level-state.test.ts
git commit -m "feat(core): a level is in one of three states, and the lock wins"
```

---

### Task 2: core/wallet.ts — 金币

**Files:**
- Create: `game/assets/scripts/core/wallet.ts`
- Create: `logic/tests/wallet.test.ts`
- Modify: `game/assets/scripts/core/index.ts`

**Interfaces:**
- Consumes: `STAR_MAX` from `./types`(值是 3)
- Produces:
  - `interface Wallet { version: number; coins: number }`
  - `WALLET_VERSION: number`(值 1)
  - `emptyWallet(): Wallet`
  - `parseWallet(raw: string | null): Wallet`
  - `serializeWallet(w: Wallet): string`
  - `addCoins(w: Wallet, n: number): Wallet`
  - `coinsForClear(prevBest: number, newStars: number): number`

- [ ] **Step 1: 写会失败的测试**

创建 `logic/tests/wallet.test.ts`:

```ts
import {
  addCoins, coinsForClear, emptyWallet, parseWallet, serializeWallet, WALLET_VERSION,
} from '../../game/assets/scripts/core/wallet';

/**
 * 和 progress 一样,这东西在启动路径上读设备存储,所以任何意外输入都必须回落成空钱包
 * 而不是抛 —— 抛了就是开不了游戏。`''` 在列表里,因为微信 `getStorageSync` 对不存在的
 * key 返回空串,浏览器 `getItem` 返回 null,两者必须无法区分。
 */
test.each([
  ['缺失的 key(null)', null],
  ['微信上缺失的 key(空串)', ''],
  ['空白', '   '],
  ['根本不是 JSON', '{oops'],
  ['截断的对象', '{"version":1,"coins":12'],
  ['不是对象的 JSON', '42'],
  ['JSON null', 'null'],
  ['数组', '[1,2,3]'],
  ['将来的版本', '{"version":2,"coins":100}'],
  ['没有 version', '{"coins":100}'],
  ['coins 缺失', '{"version":1}'],
  ['coins 是字符串', '{"version":1,"coins":"100"}'],
  ['coins 是负数', '{"version":1,"coins":-5}'],
  ['coins 是 NaN(JSON 里写成 null)', '{"version":1,"coins":null}'],
  ['coins 是小数', '{"version":1,"coins":12.5}'],
])('%s 回落成空钱包', (_label, raw) => {
  expect(parseWallet(raw as string | null)).toEqual(emptyWallet());
});

test('读得回自己写出去的', () => {
  const w = addCoins(emptyWallet(), 135);
  expect(parseWallet(serializeWallet(w))).toEqual(w);
});

test('空钱包是 0 币', () => {
  expect(emptyWallet()).toEqual({ version: WALLET_VERSION, coins: 0 });
});

test('addCoins 不改入参', () => {
  const before = emptyWallet();
  const after = addCoins(before, 40);
  expect(before.coins).toBe(0);
  expect(after.coins).toBe(40);
});

test.each([
  [0, 1, 25],
  [0, 2, 40],
  [0, 3, 60],
  [1, 3, 35],   // 涨星补差额
  [2, 3, 20],
  [3, 1, 0],    // 重玩打得更差,不倒扣
  [2, 2, 0],    // 重玩打平,不重复发
  [3, 3, 0],
])('coinsForClear(%i, %i) === %i', (prev, now, want) => {
  expect(coinsForClear(prev, now)).toBe(want);
});

test.each([
  [-1, 3],
  [0, 4],
  [99, 99],
  [NaN, 3],
  [1.5, 2.5],
])('越界的星数 (%p, %p) 不抛,且结果非负', (prev, now) => {
  expect(() => coinsForClear(prev, now)).not.toThrow();
  expect(coinsForClear(prev, now)).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd logic && npx jest tests/wallet.test.ts`
Expected: FAIL — `Cannot find module '../../game/assets/scripts/core/wallet'`

- [ ] **Step 3: 写实现**

创建 `game/assets/scripts/core/wallet.ts`:

```ts
import { STAR_MAX } from './types';

/**
 * 玩家的金币余额。
 *
 * 和 `Progress` 分开存(自己的 key),但和它**同生共死** —— 清档会把钱包一起清掉。
 * 这一条和 `settings` 的处理相反,理由写在 `storage.ts` 的 `clearWalletText` 上:
 * 金币是从进度派生出来的,分开就等于给"通关 → 清档 → 再通关"开了一条无限刷币的路。
 *
 * 失败策略照抄 `progress.ts`:这东西在启动路径上读设备存储,任何意外输入回落成空钱包,
 * 什么都不抛。丢一次余额是可以补的,启动路径上抛一次是开不了游戏。
 */
export interface Wallet {
    version: number;
    coins: number;
}

export const WALLET_VERSION = 1;

export function emptyWallet(): Wallet {
    return { version: WALLET_VERSION, coins: 0 };
}

export function parseWallet(raw: string | null): Wallet {
    if (!raw || !raw.trim()) return emptyWallet();
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return emptyWallet();
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return emptyWallet();
    const obj = data as { version?: unknown; coins?: unknown };
    if (obj.version !== WALLET_VERSION) return emptyWallet();
    const coins = obj.coins;
    // 整数、有限、非负。小数不是币数,负数不是余额,NaN/Infinity 两者都不是。
    // 整条不满足就回落成 0 而不是钳到 0 —— 一个读不懂的余额和没有余额是同一件事。
    if (typeof coins !== 'number' || !Number.isInteger(coins) || coins < 0) return emptyWallet();
    return { version: WALLET_VERSION, coins };
}

export function serializeWallet(w: Wallet): string {
    return JSON.stringify(w);
}

/** 加币,返回新对象。入参不动 —— 调用方拿它当"当前状态"。 */
export function addCoins(w: Wallet, n: number): Wallet {
    const add = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    return { version: WALLET_VERSION, coins: w.coins + add };
}

/**
 * 每档星数**累计**值多少币。下标即星数,所以 0 星是 0。
 *
 * 累计而不是增量,是为了让"重玩打得更好"能补差额:通关的收益只跟最好成绩有关,
 * 跟打了几遍无关。两者的差就是这次该发的数。
 */
const COIN_FOR_STARS = [0, 25, 40, 60];

/**
 * 这次通关该发多少币:涨星补差额,打平或变差发 0。
 *
 * 调用方必须在 `recordClear` **之前**算这个 —— `recordClear` 会把最好成绩更新掉,
 * 之后再问就永远是 0。
 */
export function coinsForClear(prevBest: number, newStars: number): number {
    return Math.max(0, tier(newStars) - tier(prevBest));
}

/** 把任意输入夹进 0..STAR_MAX 的整数档位。NaN 归 0。 */
function tier(stars: number): number {
    if (!Number.isFinite(stars)) return COIN_FOR_STARS[0];
    const i = Math.max(0, Math.min(STAR_MAX, Math.floor(stars)));
    return COIN_FOR_STARS[i];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd logic && npx jest tests/wallet.test.ts`
Expected: PASS

- [ ] **Step 5: 接进桶文件**

`game/assets/scripts/core/index.ts` 加:

```ts
export * from './wallet';
```

- [ ] **Step 6: 过两道闸门**

Run: `cd logic && npm test` → 全绿
Run: `cd logic && npm run typecheck:view` → 无输出

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/core/wallet.ts game/assets/scripts/core/wallet.ts.meta game/assets/scripts/core/index.ts logic/tests/wallet.test.ts
git commit -m "feat(core): coins, and a clear pays only for the stars it beat"
```

---

### Task 3: core/home-path.ts — 节点坐标与路径

`RAIL_PITCH` 从 `view/rail-math.ts` **搬到**这里。两边都要用它(`home-path` 算节点中心 `y = i * RAIL_PITCH`,`rail-math` 算滚动偏移 `railOffset(i) = i * RAIL_PITCH`),两边都要用的东西只能放在共同的地板上。`rail-math.ts` 改成从 core import,**不 re-export**;它的测试跟着改一行 import。

**Files:**
- Create: `game/assets/scripts/core/home-path.ts`
- Create: `logic/tests/home-path.test.ts`
- Modify: `game/assets/scripts/view/rail-math.ts`(删掉 `RAIL_PITCH` 的定义,改成 import)
- Modify: `logic/tests/rail-math.test.ts:1-4`(import 拆成两行)
- Modify: `game/assets/scripts/core/index.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `RAIL_PITCH: number`(值 340)
  - `ZIG_X: number`(值 210)
  - `SAMPLES_PER_LEG: number`(值 6)
  - `interface PathPoint { x: number; y: number }`
  - `nodeCenter(i: number): PathPoint`
  - `legSamples(i: number): PathPoint[]`(长度 `SAMPLES_PER_LEG + 1`)

- [ ] **Step 1: 写会失败的测试**

创建 `logic/tests/home-path.test.ts`:

```ts
import {
  legSamples, nodeCenter, RAIL_PITCH, SAMPLES_PER_LEG, ZIG_X,
} from '../../game/assets/scripts/core/home-path';

/**
 * 需求原话:"路径要真的穿过节点中心"。这一条就是那句话的可执行版本 —— 旧大厅的虚线
 * 中心线从来没穿过任何一个节点,节点在它左右 ±158 处摆动,路和站点是两回事。
 */
test('每条腿的两端恰好落在两个节点的中心上', () => {
  for (let i = 0; i < 9; i++) {
    const pts = legSamples(i);
    expect(pts[0]).toEqual(nodeCenter(i));
    expect(pts[pts.length - 1]).toEqual(nodeCenter(i + 1));
  }
});

test('采样点数是 SAMPLES_PER_LEG + 1', () => {
  expect(legSamples(0)).toHaveLength(SAMPLES_PER_LEG + 1);
});

test('节点左右交替,第 0 个在左', () => {
  expect(nodeCenter(0).x).toBe(-ZIG_X);
  expect(nodeCenter(1).x).toBe(ZIG_X);
  expect(nodeCenter(2).x).toBe(-ZIG_X);
  expect(nodeCenter(7).x).toBe(ZIG_X);
});

test('节点间距恰好是 RAIL_PITCH,且随 i 增大而升高', () => {
  for (let i = 0; i < 9; i++) {
    expect(nodeCenter(i + 1).y - nodeCenter(i).y).toBeCloseTo(RAIL_PITCH, 9);
  }
});

test('采样点的 y 严格单调上升 —— 路不回折', () => {
  for (let i = 0; i < 9; i++) {
    const pts = legSamples(i);
    for (let k = 1; k < pts.length; k++) {
      expect(pts[k].y).toBeGreaterThan(pts[k - 1].y);
    }
  }
});

/**
 * 曲线不许甩到节点列外面去。三次贝塞尔落在控制点的凸包里,而四个控制点的 x 都是
 * ±ZIG_X,所以这条由构造成立 —— 测试在这里是为了防止有人把控制点改到别处。
 */
test('采样点全部落在 |x| <= ZIG_X 之内', () => {
  for (let i = 0; i < 9; i++) {
    for (const p of legSamples(i)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(ZIG_X + 1e-9);
    }
  }
});

test('每个节点处的切线是竖直的 —— 相邻两条腿接得上', () => {
  // 一条腿的第二个采样点与起点的 x 差,应该远小于 y 差:曲线从节点垂直离开。
  const pts = legSamples(3);
  const dx = Math.abs(pts[1].x - pts[0].x);
  const dy = Math.abs(pts[1].y - pts[0].y);
  expect(dx).toBeLessThan(dy);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd logic && npx jest tests/home-path.test.ts`
Expected: FAIL — `Cannot find module '../../game/assets/scripts/core/home-path'`

- [ ] **Step 3: 写实现**

创建 `game/assets/scripts/core/home-path.ts`:

```ts
/**
 * 大厅那条路的几何:节点落在哪,路怎么从一个节点走到下一个。
 *
 * 在 core 而不是 view,理由和 `track-shapes.ts` / `track-path.ts` 一样 —— 几何约束本身
 * 住在 core,因为它要能在没有引擎的情况下被断言。这里要断言的那句话是"路径真的穿过
 * 节点中心":旧大厅的路是一条直条加一列虚线,节点在它左右摆动,路和站点是两回事,而
 * 那正是要修的东西。`legSamples(i)[0] === nodeCenter(i)` 是一行测试,画面上要看出来
 * 得盯着看。
 *
 * 坐标系是滑轨自己的:y 随 i 增大而增大(第 1 关在最下面,关号往上爬),和
 * `rail-math` 的 `railOffset` 同向。view 负责把它搬到屏幕上。
 */

/**
 * 相邻两个节点中心的距离。
 *
 * 340,从 272 涨上来的,这是圆徽章的直接后果而不是口味:节点直径 205(屏宽的 16%),
 * 当前关放大 1.2 倍画出来 246,星星在节点下方 —— 单个节点纵向占位是上沿 +148 到星星
 * 底 -162。两个挨着要不打架就是 162 + 148 + 30(间隙) = 340。旧的胶囊只有 148 高,
 * 272 才勉强够。
 *
 * 代价是一屏看见的关数:高屏(h≈2770)约 7 关,4:3 平板(h≈1707)只有 3 关多。
 * 竖版滑轨的固有代价,不为平板做第二套布局。
 *
 * `rail-math.ts` 也用它。两边都要,所以它在这。
 */
export const RAIL_PITCH = 340;

/**
 * 节点离中线多远,左右交替。
 *
 * 210:两列中心相距 420,节点外沿到屏边还剩 1280/2 - 210 - 102 = 328。一条腿
 * dx=420 / dy=340,约 51° 斜度 —— 够得上"蜿蜒",而不是一条抖了两下的直线。
 */
export const ZIG_X = 210;

/**
 * 一条腿切成几段。
 *
 * 6。曲线很浅,6 段的折线误差在一个像素以内,而每一段在 view 那边是两个 sprite
 * (路面 + 路缘)加一个补角圆点。往上加是线性的画面开销换看不出来的平滑度。
 */
export const SAMPLES_PER_LEG = 6;

export interface PathPoint {
    x: number;
    y: number;
}

/** 节点 i 的中心。i 从 0 起,对应第 i+1 关。 */
export function nodeCenter(i: number): PathPoint {
    return { x: i % 2 === 0 ? -ZIG_X : ZIG_X, y: i * RAIL_PITCH };
}

/**
 * 从节点 i 走到节点 i+1 的采样点,含两端。
 *
 * 三次贝塞尔,两个控制点各自**垂直**地从两端伸出半个 pitch:
 *
 *     P0 = 节点 i
 *     P1 = (P0.x, P0.y + RAIL_PITCH/2)
 *     P2 = (P3.x, P3.y - RAIL_PITCH/2)
 *     P3 = 节点 i+1
 *
 * 垂直伸出是关键,它买到三件事。一,每个节点处的切线都是竖直的,所以相邻两条腿在
 * 节点处**接得上**(C1 连续),路不会在每个站点拐一个尖角。二,四个控制点的 x 只有
 * ±ZIG_X 两个值,而贝塞尔落在控制点的凸包里,所以曲线不可能甩到节点列外面去。
 * 三,y 分量的导数是 3[(h/2)(1-t)² + (h/2)t²],恒大于零 —— 路严格向上,不回折。
 *
 * t=0 和 t=1 处的求值是精确的(Bernstein 基的其余三项都乘了 0),所以两端**恰好**
 * 等于节点中心,不是"约等于"。那条测试可以用 toEqual 而不是 toBeCloseTo。
 */
export function legSamples(i: number): PathPoint[] {
    const p0 = nodeCenter(i);
    const p3 = nodeCenter(i + 1);
    const p1 = { x: p0.x, y: p0.y + RAIL_PITCH / 2 };
    const p2 = { x: p3.x, y: p3.y - RAIL_PITCH / 2 };
    const out: PathPoint[] = [];
    for (let k = 0; k <= SAMPLES_PER_LEG; k++) {
        const t = k / SAMPLES_PER_LEG;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        out.push({
            x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
            y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
        });
    }
    return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd logic && npx jest tests/home-path.test.ts`
Expected: PASS,7 个 test

- [ ] **Step 5: 把 RAIL_PITCH 从 rail-math 搬走**

在 `game/assets/scripts/view/rail-math.ts` 里,删掉 `export const RAIL_PITCH = 272;` 连同它上面那整段 docblock(那段讲的是 272 怎么量出来的,已经搬进 `home-path.ts` 的新 docblock 了,留着就是两份会打架的说明),在文件顶部改成:

```ts
import { RAIL_PITCH } from '../core/home-path';
```

**不要 re-export。** 留一条转发就等于留了两个入口,下一个人还是会从旧的那个进来。

文件顶部那段总 docblock 里"Only this number did, because a number is the one thing here that has to be measured against a screen"那句要跟着改 —— 现在这个数不在这个文件里了。改成说明:pitch 住在 `core/home-path`,因为节点几何和滚动算术都要用它。

- [ ] **Step 6: 改 rail-math 的测试 import**

`logic/tests/rail-math.test.ts` 的第 1-4 行改成:

```ts
import {
  RAIL_FLICK_MAX, RAIL_FLICK_UNIT, railFlick, railNearest, railOffset, railRubber,
  railStopT,
} from '../../game/assets/scripts/view/rail-math';
import { RAIL_PITCH } from '../../game/assets/scripts/core/home-path';
```

测试正文一行都不用改:它通篇用 `RAIL_PITCH` 这个符号表达期望值(`railOffset(9)` 期望 `9 * RAIL_PITCH`),没有写死 272。

- [ ] **Step 7: 接进桶文件**

`game/assets/scripts/core/index.ts` 加:

```ts
export * from './home-path';
```

- [ ] **Step 8: 过两道闸门**

Run: `cd logic && npm test`
Expected: 全绿。特别确认 `rail-math.test.ts` 仍然全过 —— 它现在跑在 340 的 pitch 上。

Run: `cd logic && npm run typecheck:view`
Expected: 无输出

- [ ] **Step 9: 提交**

```bash
git add game/assets/scripts/core/home-path.ts game/assets/scripts/core/home-path.ts.meta game/assets/scripts/core/index.ts game/assets/scripts/view/rail-math.ts logic/tests/home-path.test.ts logic/tests/rail-math.test.ts
git commit -m "feat(core): the lobby path is geometry, and it goes through the stops"
```

---

### Task 4: 复现并修第 7 条(关卡状态有误)

**这个任务不是"应用 Task 1 的修复"。** Task 1 消除的是一整类问题(两个独立真值要调用点手动 `&&`),但用户报告的具体现象——第 4 关是当前关而第 5 关显示三星——**在现有源码里推不出来**:旧代码的星星是 `active = open && done`,第 5 关锁着时 `open` 为 false,星星本来就是隐藏的。

所以这一步按 systematic-debugging 走:**先拿到证据,再动手**。

**Files:**
- 取决于复现结果。可能是 `view/home-view.ts`,可能是 `view/GameController.ts` 的存档写入时机,可能一行都不用改。

- [ ] **Step 1: 取证**

向用户要下面任一样:
- 出问题那台设备上 `parking.progress` 这个 key 的原始值(微信开发者工具 → Storage 面板)
- 能看清 4/5/6 三关状态的大厅截图
- 一段能重现的操作步骤

**拿不到证据就停在这里问,不要猜着改。** 这一步的产出是"知道是什么",不是"改了点什么"。

- [ ] **Step 2: 把存档喂进 core,看 core 怎么说**

拿到原始存档串之后,在 `logic/tests/level-state.test.ts` 里加一条用它当输入的测试:

```ts
test('线上那个出问题的存档', () => {
  const p = parseProgress('<把原始串粘在这里>');
  expect(levelState(p, 4)).toBe('current');
  expect(levelState(p, 5)).toBe('locked');
  expect(starsFor(p, 5)).toBe(0);
});
```

Run: `cd logic && npx jest tests/level-state.test.ts`

- **如果这条测试通过**:core 的判定是对的,问题在 view 或者在存档的写入路径。往 Step 3 走。
- **如果这条测试失败**:core 的判定是错的,证据就在眼前。修 `level-state.ts`,这条测试就是回归测试。

- [ ] **Step 3: core 说对的话,顺着写入路径查**

按顺序排除,每一条都真的去看,不要跳:

1. `GameController.ts:2156` 的 `recordClear` —— 传进去的 `this.levelIdNum` 是不是当前关。`enterLevel('level-5')` 解析出来的数和大厅上第 5 个节点是不是同一个。
2. `home-view.ts` 的 `setLevels` 有 `if (this.stops.length > 0) return;`,`setProgress` 有 `if (this.stops.length === 0) return;`。在 `showHome()`(第一帧就跑)和 `levelsReady()`(preload 之后)之间,确认 `setProgress` 至少被有效执行过一次。在两个早退分支上各加一行 `console.log` 跑一遍预览就能看出来。
3. `countLevels()` 报的关数和 `resources/levels/` 里实际的 JSON 数是否一致 —— `stops` 数组比实际关数长的话,多出来的节点读的是越界的关号。

- [ ] **Step 4: 写一条会失败的测试,再修**

不管根因在哪,**先写会失败的测试**。如果根因在 view(没有测试环境),就往 `logic/tests/view-source.test.ts` 加一条源码级断言,和那个文件现有的 `children[数字]` 守卫同一路数 —— 那是这一层唯一可用的自动检查。

- [ ] **Step 5: 过两道闸门并提交**

Run: `cd logic && npm test` → 全绿
Run: `cd logic && npm run typecheck:view` → 无输出

提交信息要写清楚**根因是什么**,不是"修了关卡状态"。如果结论是"现有代码没问题,是那台设备的存档脏了",那就不提交代码,把结论回报给用户 —— 这也是一个合法的结束。

---

### Task 5: view/palette.ts — 配色搬家

纯搬家,**画面必须零变化**。值一个不改。

**Files:**
- Create: `game/assets/scripts/view/palette.ts`
- Modify: `game/assets/scripts/view/scene-stage.ts`(删 7 个常量定义,改成 import)
- Modify: `game/assets/scripts/view/GameController.ts:27-29`(`GROUND` 的来源换成 `palette`)

**Interfaces:**
- Produces(全部 `export`):`GROUND`、`GRID_LINE`、`LOT`、`LOT_DASH`、`ROAD`、`ROAD_LINE`、`KERB`(`Color`);`SHADOW_ALPHA`(`number`)

- [ ] **Step 1: 建 palette.ts**

创建 `game/assets/scripts/view/palette.ts`。**把 `scene-stage.ts` 里每个常量上面那段 docblock 原样搬过来** —— 那些注释记录的是这些数字怎么定出来的(`GROUND` 那段记着一次"跟着地面调亮"的联动),丢了它们这次搬家就是净损失。

```ts
import { Color } from 'cc';

/**
 * 棋盘和大厅共用的一套材质配色。
 *
 * 提出来是因为大厅这次要画一条"配色和材质与游戏内棋盘一致"的街道。另一条路是大厅自己
 * 抄一份值 —— 那两边迟早漂移,而且不是假想:`GROUND` 原来的注释里已经记着一次联动
 * (停车场的托盘要跟着地面的亮度走),`environment.ts:84` 那条注释更直白地写着环境光的
 * 冷暖该跟着 `GROUND`,但"nothing here reads scene-stage to keep them in step"。
 * 有了这个文件它就读得到了。
 *
 * 搬家时值一个没改。`KERB` 是本次唯一的新增。
 */

// ... 把 scene-stage.ts:110 / 127 / 179 / 201 / 210 / 212 / 240 这七处的 docblock 和值
// 原样搬来,GROUND 已经是 export,其余六个加上 export。

/**
 * 路缘。棋盘上没有对应物 —— 停车场是一整块板,没有人行道。
 *
 * 落在 GROUND(189,200,218)和 ROAD(86,93,108)之间,偏 GROUND 一侧:路缘是人行道
 * 的边而不是路的边,它该看着像地面抬起来了一道,不像路面浅了一块。
 */
export const KERB = new Color(150, 161, 180);

// LOT_SHADOW_ALPHA 改名为 SHADOW_ALPHA 搬过来:它现在也要给大厅的树用,而树的影子
// 不是停车场的影子。两处使用点(scene-stage 一处、home-scene 一处)。
export const SHADOW_ALPHA = 30;
```

- [ ] **Step 2: 改 scene-stage.ts**

删掉 `scene-stage.ts` 第 110、127、179、201、210、212、240 行这七个常量的定义(连同已经搬走的 docblock),在文件顶部加:

```ts
import { GRID_LINE, GROUND, LOT, LOT_DASH, ROAD, ROAD_LINE, SHADOW_ALPHA } from './palette';
```

`scene-stage.ts` 里 `LOT_SHADOW_ALPHA` 的使用点改成 `SHADOW_ALPHA`。

**不要 re-export `GROUND`。** 留一条转发就是留了两个入口。

- [ ] **Step 3: 改 GameController 的 import**

`GameController.ts:27-29` 现在是:

```ts
import {
    setupBackground, setupStage, setupRoads, lotHeight, lotWidth, RingRoad, GROUND,
} from './scene-stage';
```

改成:

```ts
import {
    setupBackground, setupStage, setupRoads, lotHeight, lotWidth, RingRoad,
} from './scene-stage';
import { GROUND } from './palette';
```

- [ ] **Step 4: 过类型闸门**

Run: `cd logic && npm run typecheck:view`
Expected: 无输出。有 `Cannot find name 'LOT_SHADOW_ALPHA'` 之类就是漏改了使用点。

Run: `cd logic && npm test`
Expected: 全绿(core 没被碰,这一步只是确认没误伤)

- [ ] **Step 5: 确认是纯搬家**

Run: `git diff --stat`
Expected: 只有三个文件。`scene-stage.ts` 的增删行数应该大致相抵(删掉的常量 + 加的 import)。

用眼睛过一遍 `git diff`,确认**没有任何一个 RGB 值被改动**。这一步是搬家,画面上应该一个像素都不动。

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/view/palette.ts game/assets/scripts/view/palette.ts.meta game/assets/scripts/view/scene-stage.ts game/assets/scripts/view/GameController.ts
git commit -m "refactor(view): the board's colours move out to where the lobby can read them"
```

---

### Task 6: view/ui-shapes.ts — 三角图元

Task 10 的开始按钮图标要用它。单独一个任务是因为它在一个被所有屏幕共用的文件里,值得单独一个审阅关口。

**Files:**
- Modify: `game/assets/scripts/view/ui-shapes.ts`

**Interfaces:**
- Produces: `triSprite(name: string, d: number, color: Color): Node`

- [ ] **Step 1: 加 TRI_SIZE 常量和缓存槽**

在 `ui-shapes.ts` 靠近 `BURST_SIZE` 的地方加:

```ts
/**
 * 播放头三角,画在 64 见方的纹理里。
 *
 * 比 star 的 128 小一半:这东西最大也就画到 48 设计单位(开始按钮上的图标),而
 * 三角只有三条直边,放大时唯一会糊的是边缘的那一个像素。star 要 128 是因为它有
 * 五个尖。
 */
const TRI_SIZE = 64;
```

在文件上方那组 `let ...Frame: SpriteFrame | null = null;` 里加一行:

```ts
let triFrame: SpriteFrame | null = null;
```

- [ ] **Step 2: 加 coverage 函数**

在 `burstCoverage` 后面加:

```ts
/**
 * 等边三角形的 coverage,尖朝右 —— 一个播放头。
 *
 * 三角是凸的,所以可以用最朴素的办法:到三条边的有符号距离取最小值。这和
 * `roundedCoverage` 的夹取技巧、`starCoverage` 的射线求交是三种不同的形状对应
 * 三种不同的做法,凸多边形是其中最省事的那种。
 *
 * 同样留出 1.5 的内缩给边缘渐变,和 star 一个道理:贴着纹理边的尖没地方淡出去。
 */
function triCoverage(size: number): (x: number, y: number) => number {
    const c = size / 2;
    const r = c - 1.5;
    // 三个顶点,第一个朝右(角度 0),逆时针。纹理 y 朝下,但三角左右对称上下也对称,
    // 所以这里不用管朝向的符号。
    const pts: [number, number][] = [0, 1, 2].map((k) => {
        const a = (k * 2 * Math.PI) / 3;
        return [c + r * Math.cos(a), c + r * Math.sin(a)] as [number, number];
    });
    return (x, y) => {
        let min = Infinity;
        for (let k = 0; k < 3; k++) {
            const [ax, ay] = pts[k];
            const [bx, by] = pts[(k + 1) % 3];
            const ex = bx - ax, ey = by - ay;
            const len = Math.hypot(ex, ey);
            // 叉积除以边长 = 点到这条边所在直线的距离,符号表示在哪一侧。
            // 三个顶点是逆时针排的,所以内部的点对三条边都是同一个符号。
            const d = ((x - ax) * ey - (y - ay) * ex) / len;
            min = Math.min(min, -d);
        }
        return min + 0.5;
    };
}
```

- [ ] **Step 3: 加导出函数**

在 `burstSprite` 后面加:

```ts
/** 一个 `d` 单位宽的三角形播放头,尖朝右,着 `color` 色。 */
export function triSprite(name: string, d: number, color: Color): Node {
    if (!triFrame) triFrame = frameFrom(paint(TRI_SIZE, triCoverage(TRI_SIZE)), TRI_SIZE);
    return spriteNode(name, d, d, color, triFrame, Sprite.Type.SIMPLE);
}
```

- [ ] **Step 4: 过闸门**

Run: `cd logic && npm run typecheck:view`
Expected: 无输出

Run: `cd logic && npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/view/ui-shapes.ts
git commit -m "feat(view): a triangle, for the button that starts a level"
```

---

### Task 7: view/home-scene.ts — 扁平街道,并删掉照片

**Files:**
- Create: `game/assets/scripts/view/home-scene.ts`
- Modify: `game/assets/scripts/view/home-view.ts`(删背景相关的常量和 `buildBackdrop`/`buildRoad`,改成调 `home-scene`)
- Modify: `logic/tests/view-source.test.ts:9`(`FILES` 加 `'home-scene.ts'`)
- Delete: `game/assets/resources/home-bg.jpg`、`game/assets/resources/home-bg.jpg.meta`

**Interfaces:**
- Consumes: `nodeCenter`、`legSamples`、`SAMPLES_PER_LEG` from `core/home-path`;`GROUND`、`KERB`、`ROAD`、`SHADOW_ALPHA` from `./palette`;`COLORS` from `./colors`;`roundedSprite`、`dotSprite`、`rampSprite` from `./ui-shapes`
- Produces:
  - `class HomeScene`
  - `constructor(parent: Node, w: number, h: number, levelCount: number)`
  - `layout(offset: number, visibleHalfHeight: number): void` —— 按当前滚动位置摆放并剔除屏外的腿

- [ ] **Step 1: 删照片资源**

```bash
git rm game/assets/resources/home-bg.jpg game/assets/resources/home-bg.jpg.meta
```

这让 `resources/` 回到只有音频和关卡 JSON —— 零图片资源,和"所有东西都在运行时画出来"这条项目约定一致。

- [ ] **Step 2: 从 home-view.ts 删掉照片相关的一切**

删掉这些常量连同它们的 docblock:`HOME_BG`、`SCRIM`、`SCRIM_SPAN`、`ROAD`、`ROAD_W`、`ROAD_DASH`、`ROAD_DASH_W`、`ROAD_DASH_H`、`ROAD_DASH_GAP`、`ZIG_X`(`ZIG_X` 现在来自 core)。

删掉 `buildBackdrop()` 和 `buildRoad()` 两个方法整体。

从 `import { ... } from 'cc'` 里删掉 `resources`、`Sprite`、`SpriteFrame`、`Texture2D`(确认没有别处在用之后)。

`HOME_BG` 那段关于"非 2 次幂纹理在 WebGL1 上要 CLAMP_TO_EDGE 否则采样成黑"的注释一起删。那是关于那张图片的知识,图片没了,注释跟着走,不留孤儿 —— 项目里别处再也没有 `resources.load` 图片的路径了。

- [ ] **Step 3: 写 home-scene.ts**

创建 `game/assets/scripts/view/home-scene.ts`。结构:

```ts
import { Color, Layers, Node, UITransform } from 'cc';
import { legSamples, nodeCenter, PathPoint, ZIG_X } from '../core/home-path';
import { dotSprite, rampSprite, roundedSprite } from './ui-shapes';
import { COLORS } from './colors';
import { GROUND, KERB, ROAD, SHADOW_ALPHA } from './palette';

/**
 * 大厅的街道,正交俯视,全部由 `ui-shapes` 在运行时画出来。
 *
 * 取代的是一张写实厚涂照片加一条压在它上面的半透明直条。那套东西有两个毛病,风格和
 * 版权:游戏内是一块扁平的蓝灰色棋盘,大厅是一张有景深的街景照,中间没有过渡;而那条
 * 半透明直条为了让照片透出来只能压低不透明度,于是它的左右两条硬边在照片上留下两道
 * 很明显的色差。
 *
 * 这里画的东西只有四样:路面、路缘、树、路灯。不画建筑 —— 俯视视角下的建筑就是一堆
 * 矩形,画出来只会让人想看清楚它是什么,而它什么也不是。
 *
 * 配色全部从 `palette` 来,也就是棋盘用的同一组值;六色的树冠和灯头从 `colors` 来,
 * 也就是车和乘客用的同一组值。
 */

/** 路面宽度。够两个 51 的星星并排,也就是看得出是条路而不是一条线。 */
const ROAD_W = 96;
/** 路缘比路面宽多少 —— 两侧各露 10。 */
const KERB_PAD = 20;
/** 每一段的圆角:半个宽度,让段与段之间自然接上。 */
const SEG_R = ROAD_W / 2;

/**
 * 路面左右两侧的渐隐宽度。
 *
 * 需求给的是 60~80,取 70。这是原来那条直条留下的问题:一块不透明度不足的色块压在
 * 背景上,两条边就是两道硬色差。现在路面是不透明的,渐隐是让它融进人行道而不是
 * 让背景透出来 —— 同样的视觉手段,完全不同的目的。
 */
const FADE_W = 70;

/** 树冠直径,和它的影子偏移。俯视下一棵树就是两个圆。 */
const TREE_D = 88;
const TREE_SHADOW_OFF = 8;

/** 路灯:灯杆、灯头、地上的光斑。 */
const LAMP_POST_W = 10;
const LAMP_POST_H = 54;
const LAMP_HEAD_D = 26;
const LAMP_POOL_D = 120;
const LAMP_POOL_ALPHA = 26;

export class HomeScene {
    /** 整条街道的根,由调用方决定它落在哪(和滑轨同一个 y,否则路和节点会错开)。 */
    private root: Node;
    /** 每条腿一个节点,`layout` 按它整条开关 —— 不是遍历里面上百个 sprite。 */
    private legs: Node[] = [];

    /** 只建地面。路和树要等关卡数,见 `build`。 */
    constructor(parent: Node, w: number, h: number) { /* Step 3 的「地面」 */ }

    /** 关卡数知道之后建路、树和路灯。和 `HomeView.setLevels` 同一个时机。 */
    build(levelCount: number): void { /* Step 3 的「路径」「渐隐」「树和路灯」 */ }

    /**
     * 按当前滚动位置摆街道,并关掉屏外的腿。
     *
     * `offset` 和 `HomeView.layout()` 用的是同一个数 —— 路和节点必须走同一个滚动量,
     * 差一点点就是路从节点旁边擦过去。`visibleHalfHeight` 是剔除的门限,`HomeView`
     * 那边用的是 `h * 0.75`,这里用同一个值。
     */
    layout(offset: number, visibleHalfHeight: number): void {
        this.root.setPosition(0, -offset, 0);
        for (let i = 0; i < this.legs.length; i++) {
            // 一条腿跨 nodeCenter(i).y 到 nodeCenter(i+1).y。两端都出屏就整条关掉。
            const a = nodeCenter(i).y - offset;
            const b = nodeCenter(i + 1).y - offset;
            const near = Math.min(Math.abs(a), Math.abs(b));
            this.legs[i].active = near <= visibleHalfHeight;
        }
    }

    private stroke(/* 见下 */): void {}
}
```

实现要点,逐条:

**地面**:一个 `roundedSprite('Ground', w * 2, h * 2, GROUND, 2)`,双倍画布尺寸 —— 视口比设计分辨率宽的时候,不这样两侧会露出空的 3D 场景。这条是从原来 `buildBackdrop` 里保留下来的,原因不变。

**路径**:对每条腿 `i`(0 到 `levelCount - 2`),取 `legSamples(i)`,相邻两点之间画两个 sprite:

```ts
/**
 * 把一段路画成一个**旋转过的圆角矩形**。
 *
 * `ui-shapes` 没有描线器,但一段直路就是一个长条,而 `Node.angle` 是免费的。接缝处
 * 补一个圆点填角:两段之间有夹角时,两个矩形的端头之间会留一个楔形缺口,一个直径等于
 * 路宽的圆正好把它盖住 —— 这是圆角连接(round join)的手工版本。
 */
private stroke(parent: Node, a: PathPoint, b: PathPoint, w: number, color: Color, name: string): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const seg = roundedSprite(name, len + w, w, color, w / 2);
    parent.addChild(seg);
    seg.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
    // Cocos 的 angle 是度,逆时针为正,0 度指向 +x。
    seg.angle = Math.atan2(dy, dx) * 180 / Math.PI;
}
```

段长取 `len + w` 而不是 `len`:两端各多伸出半个宽度,让相邻段自然重叠,配合接缝的圆点就看不出拼接。

先画整条路缘(宽 `ROAD_W + KERB_PAD`,色 `KERB`),再画整条路面(宽 `ROAD_W`,色 `ROAD`)。两遍,不要交替 —— 交替的话后画的路面会盖住前一段的路缘。

**每条腿装在自己的 `Node` 里**(`Leg0`、`Leg1`……),这样 `layout()` 剔除屏外的腿是一个 `active` 赋值,不是遍历上百个 sprite。

**渐隐**:两个 `rampSprite`,各 `FADE_W` 宽、整条路高,`angle` 分别 90 和 -90,色 `GROUND`,贴在路面左右两侧。`rampSprite` 是"顶端不透明、底端全透",转 90° 之后就是"外侧不透明、内侧全透"——正好把路面的硬边融进地面。

**树和路灯**:位置按序号确定性生成,**不要用 `Math.random`**:

```ts
/**
 * 一个整数哈希。同一个 i 永远给同一个 0..1 的数。
 *
 * `Math.random` 在这里是个 bug 而不是捷径:`layout()` 每帧都跑,树的位置每帧重算
 * 就是每帧乱跳。位置必须是 i 的纯函数。
 */
function hash01(i: number): number {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}
```

每条腿旁边放 1 棵树 + 每两条腿放 1 盏路灯,x 落在路面外侧(`|x| > ZIG_X` 那一侧,离路面至少 `ROAD_W`),y 落在这条腿的 y 区间里。树冠色从 `COLORS.green` 取,压暗 30% 左右(`Color` 的分量乘 0.7)。影子用 `new Color(0, 0, 0, SHADOW_ALPHA)`,偏移 `TREE_SHADOW_OFF`,**先画影子再画树冠**。

- [ ] **Step 4: 在 home-view.ts 里接上**

`HomeView` 的构造里,原来调 `buildBackdrop()` 和 `buildRoad()` 的地方改成建 `HomeScene`。注意顺序:场景要在滑轨**之前**加进 `root`,这样节点画在路的上面。

`HomeScene` 需要知道关卡数才能画路,而关卡数是 `setLevels` 才知道的。所以构造时先只画地面,路和树留到 `setLevels` 里再建 —— 和 `stops` 同一个时机。

- [ ] **Step 5: 把新文件加进源码守卫**

`logic/tests/view-source.test.ts:9` 的 `FILES` 数组改成:

```ts
const FILES = ['hud-view.ts', 'home-view.ts', 'home-scene.ts'];
```

- [ ] **Step 6: 过闸门**

Run: `cd logic && npm test`
Expected: 全绿

Run: `cd logic && npm run typecheck:view`
Expected: 无输出。如果报 `resources` / `Texture2D` 之类"declared but never used",说明 Step 2 的 import 清理漏了。

- [ ] **Step 7: 确认照片真的没人引用了**

Run: `grep -rn "home-bg" game/assets/scripts/ game/assets/resources/`
Expected: 无输出

- [ ] **Step 8: 提交**

```bash
git add -A game/assets/scripts/view/ game/assets/resources/ logic/tests/view-source.test.ts
git commit -m "feat(view): the lobby's street is drawn, not photographed"
```

---

### Task 8: 圆形关卡徽章、路径对齐、自动居中

这是画面上变化最大的一步,而且没有自动化的正确性闸门 —— 类型检查只能证明它编得过。做完要在真机上看。

**Files:**
- Modify: `game/assets/scripts/view/home-view.ts`

**Interfaces:**
- Consumes: `levelState`、`starsFor` from `core/level-state`;`nodeCenter` from `core/home-path`
- Produces(给 Task 9 用):`ui-layout.ts` 的 `BAR_H: number`、`BAR_MARGIN_F: number`、`barBottomY(w: number, h: number): number`、`capsuleInset(): number`
- Modify 追加: `game/assets/scripts/view/ui-layout.ts`

- [ ] **Step 1: 换掉节点尺寸常量**

`home-view.ts` 里删掉 `STOP_W`、`STOP_H`、`STOP_R`、`STOP_STAR_D`、`STOP_STAR_PITCH`、`STOP_STAR_Y`、`STOP_NUM_Y`、`NUM_X_SHUT`、`LOCK_X_SHUT` 这些为胶囊量的数,换成:

```ts
/**
 * 关卡徽章的直径:屏宽的 16%,在 1280 的设计宽上是 205。
 *
 * 屏宽的比例而不是绝对值,因为这是需求给的形式("直径约屏宽 16%")。设计宽固定 1280,
 * 所以算出来是个常数 —— 但写成比例是在记录它的来历。
 */
const NODE_D = Math.round(1280 * 0.16);
/** 星星:节点直径的 25%,需求点名的比例。 */
const STAR_D = Math.round(NODE_D * 0.25);
const STAR_PITCH = 56;
/** 星星在节点下方,不在里面。三颗共 163 宽,窄于 205 的节点。 */
const STAR_Y = -(NODE_D / 2 + 8 + STAR_D / 2);
/** 当前关放大这么多,再在这个基础上呼吸。 */
const CUR_SCALE = 1.2;
const BREATHE_TO = 1.26;
const BREATHE_TIME = 1.6;
```

- [ ] **Step 2: 三态配色**

```ts
/** 已通关:亮。这一关是战果,该看着像战果。 */
const NODE_DONE = new Color(86, 199, 104, 255);
const NODE_DONE_BASE = new Color(56, 156, 76, 255);
/** 当前关:大厅上唯一在动的东西,用最主的那个蓝。 */
const NODE_CUR = new Color(74, 144, 226, 255);
const NODE_CUR_BASE = new Color(44, 96, 165, 255);
/** 未解锁:灰。 */
const NODE_LOCK = new Color(52, 62, 90, 255);
const NODE_LOCK_BASE = new Color(38, 46, 70, 255);
```

- [ ] **Step 3: 把 buildStop 改成画圆**

`roundedSprite(..., STOP_W, STOP_H, ..., STOP_R)` 全部换成 `dotSprite(name, NODE_D, color)`。底座仍然下沉 `BTN_LIFT` —— 面在上、底在下露一条边,这是全项目按钮的统一手法。

星星从 `face` 的子节点移到 `node` 的子节点(现在在徽章**外面**,下方),`star.setPosition((s - 1) * STAR_PITCH, STAR_Y, 0)`。

锁图标居中(`lock.setPosition(0, 0, 0)`),关号在锁态下**隐藏** —— 圆徽章里塞不下锁和数字两样东西,旧的胶囊是横的才塞得下。这和旧注释里"THE NUMBER STAYS ON WHEN IT IS LOCKED"的结论相反,把原因写进注释:形状变了,那个结论的前提(横向有富余空间)没了。

- [ ] **Step 4: setProgress 改读 core 的三态**

```ts
setProgress(p: Progress): void {
    if (this.stops.length === 0) return;
    for (let i = 0; i < this.stops.length; i++) {
        const level = i + 1;
        const stop = this.stops[i];
        // 一个真值来源。三态互斥由 core 的返回类型保证,这里不再自己拼
        // `open && done` —— 那正是"锁着却画了三星"那类画面的来路。
        const state = levelState(p, level);
        const best = starsFor(p, level);
        stop.state = state;
        stop.open = state !== 'locked';
        // ... 按 state 三选一刷 face/base 颜色
        // ... stop.lock.active = state === 'locked'
        // ... stop.num.node.active = state !== 'locked'
        for (let s = 0; s < stop.stars.length; s++) {
            stop.stars[s].active = state === 'done';
            stop.stars[s].getComponent(Sprite)!.color = s < best ? STAR_ON : STAR_OFF;
        }
    }
    // ...
}
```

`Stop` 接口加一个 `state: LevelState` 字段,`open: boolean` 保留(`setFocus` 和 `hitsStart` 在用)。

- [ ] **Step 5: 呼吸动效**

呼吸绑在**进度意义上的当前关**,不是滑到中间的那一关。所以它在 `setProgress` 里起停,不在 `layout()` 里:

```ts
/**
 * 当前关一直在轻轻缩放。
 *
 * 绑进度而不是绑滑动焦点:呼吸说的是"你打到这了",和已通关/未解锁是同一套语言。
 * 滑到中间的那一关另有一圈光环说"按钮会开这一关"。两件事,两种记号。
 *
 * `layout()` 每帧都写 `setScale`,所以呼吸不能也去写 scale —— 会打架。呼吸写的是
 * `breathe` 这个字段,`layout()` 把它乘进去。
 */
```

实现:`HomeView` 加一个 `private breathe = 1;`,在 `setProgress` 里对当前关起一个 tween 改这个数(tween 一个 `{ v: number }` 的持有对象),`layout()` 里当前关的 scale 乘上 `this.breathe`。

**不要**直接 tween 节点的 scale:`layout()` 每帧覆写它,tween 会被立刻抹掉。这一条是这个任务最容易踩的坑。

- [ ] **Step 6: 节点位置改读 core**

`layout()` 里的 `stop.node.setPosition(i % 2 === 0 ? -ZIG_X : ZIG_X, y, 0)` 改成:

```ts
const c = nodeCenter(i);
stop.node.setPosition(c.x, c.y - this.offset, 0);
```

这一行是"路径穿过节点中心"在 view 侧的另一半:节点的 x 和路的采样点来自**同一个函数**。分成两处各算各的,就是旧大厅那条虚线和那列胶囊的关系。

- [ ] **Step 7: 居中基准改成空带中心**

顶部栏的高度和上边距这一步就要用到(算空带的上沿),而 Task 9 的 `top-bar.ts` 也要用同一组数。两个文件都要的东西放 `ui-layout.ts`,**不要**各写一份:

```ts
// ui-layout.ts
/**
 * 顶部栏的高度和它与屏幕上沿的间距。
 *
 * 在这里而不是 `top-bar.ts`,因为 `home-view` 也要用:滑轨居中要算"栏下沿到按钮
 * 上沿"那条空带,而空带的上沿就是这两个数定出来的。各写一份就是两个会漂移的布局。
 *
 * 96 是 HUD 那两块读数盘的高度 —— 两个屏幕的顶部该是同一个刻度。
 */
export const BAR_H = 96;
export const BAR_MARGIN_F = 0.03;

/** 顶部栏下沿的 y,在画布坐标里。`h` 从 `canvasSize` 来。 */
export function barBottomY(w: number, h: number): number {
    const top = Math.max(safeInsets().top, capsuleInset());
    return h / 2 - top * h - w * BAR_MARGIN_F - BAR_H;
}
```

然后 `home-view.ts` 加:

```ts
/**
 * 滑轨该对准的 y:顶部栏下沿到开始按钮上沿之间那条空带的中心。
 *
 * 不是画布中心。画布中心上下各被顶部栏和开始按钮啃掉一块,对准它的结果就是当前关
 * 看着偏下 —— 这是"打开大厅没滚到当前关"这条反馈的真实成因:它**滚到**了,只是
 * 居中居的是一个错的中心。
 */
private railCenterY(): number {
    const top = barBottomY(this.w, this.h);
    const bottom = -this.h / 2 + safeInsets().bottom * this.h + START_MARGIN + START_H;
    return (top + bottom) / 2;
}
```

`capsuleInset()` 是 Task 9 Step 1 才加的。**这一步先加它**(Task 9 Step 1 的代码原样搬来),`ui-layout.ts` 里 `barBottomY` 依赖它,这个任务就能独立跑通;Task 9 那一步相应改成"确认已存在"。

在构造和 `setLevels` 里 `this.railRoot.setPosition(0, this.railCenterY(), 0)`。`layout()` 里的 y 计算不变 —— 它算的是相对滑轨根节点的位置。

`HomeScene` 的父节点用同一个 y,否则路和节点会错开。

- [ ] **Step 8: 过闸门**

Run: `cd logic && npm run typecheck:view` → 无输出
Run: `cd logic && npm test` → 全绿

- [ ] **Step 9: 真机确认(需要人)**

Run: `node tools/preview.mjs`

在真机上确认五件事,任何一条不对都不要往下走:
1. 节点是圆的,直径大约占屏宽的六分之一
2. 路真的从每个节点的中心穿过去,不是从旁边擦过
3. 当前关明显更大,并且在轻轻缩放
4. 已通关的节点下方有三颗星,锁着的是灰的带锁
5. 打开大厅时当前关就在屏幕正中,不偏上也不偏下

- [ ] **Step 10: 提交**

```bash
git add game/assets/scripts/view/home-view.ts
git commit -m "feat(view): level stops become badges on a road that runs through them"
```

---

### Task 9: 顶部栏与胶囊安全区

**Files:**
- Modify: `game/assets/scripts/view/ui-layout.ts`(加 `capsuleInset`)
- Create: `game/assets/scripts/view/top-bar.ts`
- Modify: `game/assets/scripts/view/home-view.ts`(建顶部栏、删浮动铭牌)
- Modify: `logic/tests/view-source.test.ts:9`(`FILES` 加 `'top-bar.ts'`)

**Interfaces:**
- Produces:
  - `capsuleInset(): number`(屏高的比例,非微信环境 0)
  - `class TopBar`,`constructor(parent: Node, w: number, h: number)`
  - `TopBar.setCoins(n: number): void`
  - `TopBar.setCaption(text: string): void`
  - `TopBar.setSlot(i: 0 | 1, slot: { icon: Node; onTap: () => void } | null): void`
  - `TopBar.hitsGear(ui: Vec3): boolean`
  - `TopBar.hitsSlot(ui: Vec3): 0 | 1 | -1`

栏的高度、上边距和下沿(`BAR_H` / `BAR_MARGIN_F` / `barBottomY`)已经在 Task 8 Step 7 放进 `ui-layout.ts` 了,`TopBar` 从那里 import,不自己定义。

- [ ] **Step 1: 确认 capsuleInset 已存在**

Task 8 Step 7 应该已经把它加进 `ui-layout.ts` 了。确认一下;如果没有,照下面加(写法照 `safeInsets()`):

```ts
/**
 * 微信右上角胶囊按钮的**下沿**,占屏高的比例。非微信环境返回 0。
 *
 * 比例而不是像素,和 `safeInsets` 同一个理由:`getMenuButtonBoundingClientRect` 和
 * `screenHeight` 都是逻辑 px,画布量的是设计单位,两者的换算是这个文件读不到的项目
 * 设置 —— 但它们的**商**在两种单位下是同一个数。
 *
 * 为什么用下沿而不是左边界:胶囊在 375pt 宽的机器上约 87pt,换算到 1280 的设计宽是
 * 330 单位,四分之一个屏宽。横向避让要吃掉顶部栏四个位置里的一个,而且胶囊的宽度随
 * 机型和微信版本变化 —— 那个留白是个会漂移的数。整条栏排在它下面,横向 1280 全归
 * 自己,代价只是位置低一截,而那是个确定的、看得见的代价。
 *
 * 读一次缓存。和 `safeInsets` 一样,失败就返回 0:浏览器和编辑器预览里本来就没有
 * 胶囊,返回 0 是对的答案而不是降级。
 */
let capsule: number | null = null;

export function capsuleInset(): number {
    if (capsule !== null) return capsule;
    capsule = 0;
    try {
        const rect = typeof wx !== 'undefined' && wx.getMenuButtonBoundingClientRect
            ? wx.getMenuButtonBoundingClientRect() : null;
        const info = typeof wx !== 'undefined' && wx.getSystemInfoSync
            ? wx.getSystemInfoSync() : null;
        const h = info && info.screenHeight;
        if (h > 0 && rect && rect.bottom > 0) {
            capsule = Math.max(0, Math.min(0.3, rect.bottom / h));
        }
    } catch { /* 没有胶囊就是没有胶囊,不是错误 */ }
    return capsule;
}
```

- [ ] **Step 2: 写 top-bar.ts**

布局常量:

```ts
// BAR_H / BAR_MARGIN_F / barBottomY 从 './ui-layout' import,不在这里定义 ——
// home-view 的滑轨居中要用同一组数。
const COIN_W = 240;
const COIN_H = 88;
const GEAR_D = 76;
const SLOT_D = 76;
const SLOT_GAP = 16;
const CAPTION_SIZE = 36;
```

y 的算法 —— 用 `ui-layout` 的 `barBottomY`,不要自己再算一遍:

```ts
const y = barBottomY(w, h) + BAR_H / 2;
```

x 的算法(w = 1280 时的值写在注释里):

```
金币左沿  -w/2 + margin              = -602
齿轮中心   w/2 - margin - GEAR_D/2   =  602
槽 1 中心  齿轮 - GEAR_D/2 - GAP - SLOT_D/2 = 510
槽 0 中心  槽1 - SLOT_D - GAP        = 418
说明文字   居中 0,可用宽度 -362..380 共 742
```

金币组件:一个 `liftedPill`(面在上、底下沉 6,和 HUD 的读数盘同一个手法)+ 左端一个金色圆点当币 + 数字。`liftedPill` 现在是 `hud-view.ts` 的模块私有函数,**把它整段搬到 `ui-shapes.ts` 导出**,两边都 import —— 复制一份是两份会漂移的按钮样式。搬的时候 `PILL_BG`/`PILL_BASE` 两个颜色也跟着走。

两个预留槽:**只建一个空的 `Node` 占位并 `active = false`**,不画灰按钮。`setSlot(i, null)` 收起,传对象才显示。上线一个点不动的灰按钮比留白更糟 —— 玩家会点它。

齿轮:`dotSprite` + `gearSprite`,和 `hud-view.buildGear` 同样的画法。

- [ ] **Step 3: home-view 接上顶部栏,删浮动铭牌**

删掉 `PLATE`、`PLATE_W`、`PLATE_H`、`SUB_SIZE`、`SUB_INK`、`HOME_RIM`、`SUB_RIM_W`、`TITLE_HIT_W`、`TITLE_HIT_H` 和 `this.topPlate`、`this.sub`、`this.resetNode`、`hitsReset()`。

`setLevels` 里 `this.sub.string = ...` 改成 `this.topBar.setCaption(\`共 ${levelCount} 关\`)`。

`revealMenu` 里 `this.topPlate.active = on` 改成顶部栏 —— 但顶部栏是**常驻**的(需求原话),所以它不参与 `revealMenu`,加载期间就该在。确认加载遮罩不会盖住它。

新增转发方法给 `GameController` 用:`hitsGear(ui)`、`hitsSlot(ui)`、`setCoins(n)`。

- [ ] **Step 4: 源码守卫加文件**

`logic/tests/view-source.test.ts:9`:

```ts
const FILES = ['hud-view.ts', 'home-view.ts', 'home-scene.ts', 'top-bar.ts'];
```

- [ ] **Step 5: 过闸门**

Run: `cd logic && npm run typecheck:view` → 无输出
Run: `cd logic && npm test` → 全绿

- [ ] **Step 6: 真机确认(需要人)**

Run: `node tools/preview.mjs`

确认:顶部栏完整可见、不被胶囊压住、金币和齿轮不出屏、"共 N 关"不再被滚动的节点穿过。

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/view/ui-layout.ts game/assets/scripts/view/top-bar.ts game/assets/scripts/view/top-bar.ts.meta game/assets/scripts/view/home-view.ts game/assets/scripts/view/ui-shapes.ts logic/tests/view-source.test.ts
git commit -m "feat(view): the lobby gets a bar that clears the capsule"
```

---

### Task 10: 金币接线、大厅设置面板、清档按钮

**Files:**
- Modify: `game/assets/scripts/view/storage.ts`
- Modify: `game/assets/scripts/view/hud-view.ts`(设置卡加 `lobby` 开关和清档按钮)
- Modify: `game/assets/scripts/view/GameController.ts`

**Interfaces:**
- Consumes: `Wallet`、`parseWallet`、`serializeWallet`、`addCoins`、`coinsForClear` from core
- Produces: `loadWalletText()`、`saveWalletText(text)`、`clearWalletText()`;`HudView.showSettings(lobby: boolean)`

- [ ] **Step 1: storage.ts 加钱包三件套**

```ts
/** 钱包自己的 key,和进度分开存。生命周期见 `clearWalletText`。 */
const WALLET_KEY = 'parking.wallet';

export function loadWalletText(): string | null {
    try {
        return sys.localStorage.getItem(WALLET_KEY);
    } catch (e) {
        console.warn('[Game] wallet could not be read:', e);
        return null;
    }
}

export function saveWalletText(text: string): void {
    try {
        sys.localStorage.setItem(WALLET_KEY, text);
    } catch (e) {
        console.warn('[Game] wallet could not be saved:', e);
    }
}

/**
 * 清档时连钱包一起清。
 *
 * 这和这个文件顶上那段关于设置的说明**相反** —— 设置刻意不被清档带走,因为那是两种
 * 不同的生命周期。金币不是:它是从进度派生出来的,通关发币是它唯一的来源。两者分开,
 * "通关 → 清档 → 再通关"就是一条无限刷币的路,而清档是个点两下就能做完的动作。
 */
export function clearWalletText(): void {
    try {
        sys.localStorage.removeItem(WALLET_KEY);
    } catch (e) {
        console.warn('[Game] wallet could not be cleared:', e);
    }
}
```

- [ ] **Step 2: GameController 装配钱包**

在读 `progress` 的同一处读 `wallet`:

```ts
this.wallet = parseWallet(loadWalletText());
```

`showHome()` 里把余额交给大厅:`this.home?.setCoins(this.wallet.coins);`

- [ ] **Step 3: 结算发币**

`GameController.ts:9` 的 core import 加上 `bestStars`(现在只 import 了 `emptyProgress, parseProgress, Progress, recordClear, serializeProgress, unlockedThrough`),再加 `addCoins, coinsForClear, emptyWallet, parseWallet, serializeWallet, Wallet`。

`GameController.ts:2155` 附近,**在 `recordClear` 之前**算币:

```ts
const rating = this.core!.stars();
// 必须在 recordClear 之前:它会把最好成绩更新掉,之后再问就永远是 0。
const earned = coinsForClear(bestStars(this.progress, this.levelIdNum), rating);
const rec = recordClear(this.progress, this.levelIdNum, rating);
this.progress = rec.progress;
if (rec.changed) {
    saveProgressText(serializeProgress(this.progress));
    console.log(`[Game] level ${this.levelIdNum} cleared with ${rating} stars`);
}
if (earned > 0) {
    // 发 0 不写盘,和 recordClear 的 changed 同一个道理:设备上的写是同步调用。
    this.wallet = addCoins(this.wallet, earned);
    saveWalletText(serializeWallet(this.wallet));
}
```

- [ ] **Step 4: wipeProgress 连钱包一起清**

```ts
private wipeProgress(): void {
    this.holdArmed = false;
    clearProgressText();
    clearWalletText();
    this.progress = emptyProgress();
    this.wallet = emptyWallet();
    this.home?.setProgress(this.progress);
    this.home?.setCoins(0);
    // ...
}
```

- [ ] **Step 5: 设置面板的大厅模式**

`hud-view.ts:1655` 的 `showSettings(sfx, haptics)` 加第三个参数,签名变成 `showSettings(sfx: boolean, haptics: boolean, lobby: boolean)`。

`HudView` 加一个字段记住它:

```ts
/** 这张设置卡这次是从大厅打开的。见 `hitsSettings` —— 它必须知道,光隐藏节点不够。 */
private setLobby = false;
```

`showSettings` 里:

```ts
this.setLobby = lobby;
// 大厅上没有"这一关"可以回去或者重玩,两个按钮都是空指令。
// 注意 setHome / setReplay 的类型是 `Node | null`,不是带 `.node` 的包装对象。
this.setHome!.active = !lobby;
this.setReplay!.active = !lobby;
```

**然后必须同时改 `hitsSettings`**,这是这一步唯一会咬人的地方:

```ts
if (!this.setLobby && this.inBox(ui, this.setHome!, SET_SIDE_W, PROMPT_BTN_H)) return 'home';
if (!this.setLobby && this.inBox(ui, this.setReplay!, SET_SIDE_W, PROMPT_BTN_H)) return 'replay';
```

`inBox`(`hud-view.ts:1720`)只比较 `worldPosition`,**不看 `active`**。所以把节点隐藏掉之后,点它原来的位置照样会命中,返回 `'home'` —— 在大厅里那会触发一次 `showHome()`,把玩家正在看的滑轨重置掉。一个看不见的按钮还在答应点击,正是这个项目里 `setPlayVisible` / `hitsGear` 那套纪律要防的东西。

同一张卡上加清档按钮:

```ts
/** 清档。红的,在其余按钮下面一行,并且要点两次。 */
const SET_WIPE_W = 320;
const SET_WIPE_Y = SET_BTN_Y - PROMPT_BTN_H - 28;
const WIPE_FACE = new Color(230, 82, 78, 255);
const WIPE_BASE = new Color(168, 52, 49, 255);
```

用 `buildCardBtn` 建,`this.setWipe`。第一次点文字变成「确定清除?」,第二次才真的执行;面板关闭时复位成「清除进度」。二次确认的状态存在 `HudView` 里,因为它是这个控件自己的状态,不是游戏的。

`hitsSettings` 的返回联合类型加 `'wipe'`,并且 `setWipe` 只在 `setLobby` 为真时 `active`、只在为真时参与命中判定 —— 理由同上。

清档原来是长按"共 N 关"那块铭牌三秒。铭牌这次搬进顶部栏了,而且隐藏手势本来就没人找得到。`GameController` 那边的 `holdArmed` / `holdWipe` / `cancelHold` / `HOLD_SECONDS` / `HOLD_SLOP` 和 `HomeView.hitsReset` 一起删掉 —— 留着就是两条通向同一个不可逆动作的路,其中一条没有确认。

- [ ] **Step 6: GameController 路由大厅的设置点击**

`handleTap` 的 `screen === 'home'` 分支里,**在滑轨判定之前**先问设置面板 —— 面板打开时它是最上层的东西,和游戏内同样的优先级:

```ts
if (this.screen === 'home') {
    if (!this.uiCam || !this.home) return;
    const ui = this.uiCam.screenToWorld(new Vec3(screenX, screenY, 0), new Vec3());
    // 面板先问。它开着的时候是屏幕最上层,滑轨在它下面 —— 和游戏内同样的优先级。
    if (this.hud?.settingsOpen()) {
        const hit = this.hud.hitsSettings(ui);
        if (hit === 'close') this.hud.hideSettings();
        else if (hit === 'sfx') this.toggleSetting('sfx');
        else if (hit === 'haptics') this.toggleSetting('haptics');
        else if (hit === 'wipe') this.wipeProgress();
        return;
    }
    if (this.home.hitsGear(ui)) {
        this.hud?.showSettings(this.settings.sfx, this.settings.haptics, true);
        return;
    }
    // `slidHome` 留在齿轮之后:齿轮不在滑轨上,一次滑动结束不该吞掉它的点击。
    if (this.slidHome) return;
    // ... 原有的 hitsStart / hitsStop 不动
}
```

`hideSettings` 如果 `hud-view` 里不叫这个名字,照它现有的关闭路径调 —— 在 `hitsSettings` 返回 `'close'` 的那个分支里,游戏内那段已经这么做了,照抄。

游戏内那处 `showSettings` 的调用点要补上第三个参数 `false`。

注意 `slidHome` 的判定要留在设置相关之后 —— 齿轮不在滑轨上,一次滑动结束不该吞掉齿轮的点击。

- [ ] **Step 7: 过闸门**

Run: `cd logic && npm run typecheck:view` → 无输出
Run: `cd logic && npm test` → 全绿

- [ ] **Step 8: 真机确认(需要人)**

确认:通关后回大厅金币涨了、再打一遍同样星数不涨、打出更高星补差额、清档之后金币归零、大厅设置面板没有「主页」和「重玩」。

- [ ] **Step 9: 提交**

```bash
git add game/assets/scripts/view/storage.ts game/assets/scripts/view/hud-view.ts game/assets/scripts/view/GameController.ts
git commit -m "feat(view): a clear pays coins, and wiping the save takes them with it"
```

---

### Task 11: 开始按钮的图标与按下反馈

**Files:**
- Modify: `game/assets/scripts/view/home-view.ts`
- Modify: `game/assets/scripts/view/GameController.ts:2258`(`onPressStart`)、`:2295`(`onPressEnd`)

**Interfaces:**
- Consumes: `triSprite` from `./ui-shapes`(Task 6)
- Produces: `HomeView.setStartPressed(on: boolean): void`

- [ ] **Step 1: 按钮加图标**

`buildStart` 里,在 `face` 上加一个 `triSprite('play', 44, Color.WHITE)`,放在文字左边。文字节点相应右移,让"图标 + 文字"整体仍然在按钮中间。

锁态下(`focusOpen` 为 false)图标跟着变暗 —— 和文字同一个处理,在 `setFocus` 里刷。

- [ ] **Step 2: 按下反馈**

```ts
/**
 * 按下时面贴到底座上,松手弹回。
 *
 * 和 HUD 的按钮同一个手法:这个 UI 里所有能按的东西都是「面在上、底下沉 BTN_LIFT」
 * 的两层,按下就是把那个位移吃掉。不需要缩放也不需要变色 —— 位移本身就是反馈,
 * 而且它和静止状态用的是同一套形状语言。
 */
setStartPressed(on: boolean): void {
    this.startFace.setPosition(0, on ? -BTN_LIFT : 0, 0);
}
```

- [ ] **Step 3: GameController 转发按下态**

`onPressStart` 里,在 `beginDrag` 之后:

```ts
if (this.home.hitsStart(ui)) this.home.setStartPressed(true);
```

`onPressEnd` 里无条件复位:

```ts
this.home?.setStartPressed(false);
```

无条件而不是"如果之前按下了" —— 触摸取消(`TOUCH_CANCEL`)也走这里,一个卡在按下态的按钮比多一次赋值糟得多。

- [ ] **Step 4: 过闸门**

Run: `cd logic && npm run typecheck:view` → 无输出
Run: `cd logic && npm test` → 全绿

- [ ] **Step 5: 真机确认(需要人)**

确认:按钮上有三角图标、按下时明显下沉、手指移开后弹回、锁态下按下无反应。

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/view/home-view.ts game/assets/scripts/view/GameController.ts
git commit -m "feat(view): the start button says it was pressed"
```

---

## 收尾

全部做完之后:

- [ ] Run: `cd logic && npm test` —— 全绿,新增测试数约 20
- [ ] Run: `cd logic && npm run typecheck:view` —— 无输出
- [ ] Run: `grep -rn "home-bg" game/` —— 无输出
- [ ] Run: `node tools/preview.mjs` —— 在真机上把需求的十条逐条对一遍
- [ ] 第 7 条(Task 4)如果结论是"现有代码没问题",在收尾时明确回报这一条**没有改动**,以及为什么

## 需求对照

| 需求 | 任务 |
|---|---|
| P0 删写实背景、改扁平街道 | Task 5(配色)、Task 7(街道 + 删图) |
| P0 顶部栏、金币、设置、两个预留位、胶囊安全区 | Task 9(栏)、Task 10(金币接线) |
| 1 圆形徽章 16% 屏宽 | Task 8 |
| 2 已通关亮色 + 25% 三星 | Task 8 |
| 3 当前关 1.2 倍 + 呼吸 | Task 8 |
| 4 未解锁灰色 + 锁 | Task 8 |
| 5 蜿蜒路径穿过节点中心 | Task 3(几何 + 测试)、Task 7(描边)、Task 8(节点读同一个函数) |
| 6 "共 N 关"与节点重叠 | Task 9(搬进顶部栏) |
| 7 关卡状态有误 | Task 1(消除这一类)、Task 4(查真实成因) |
| 8 自动滚到当前关并居中 | Task 8 Step 7 |
| 9 开始按钮图标与按下反馈 | Task 6(三角图元)、Task 11 |
| 10 蒙层边缘左右渐隐 | Task 7(`FADE_W = 70`) |
