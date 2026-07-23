# M3 关卡编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for the M3.0 task below. The M3.1–M3.4 editor milestones are executed interactively (code + local server + browser screenshots), NOT via autonomous subagents — see that section.

**Goal:** 一个独立网页关卡编辑器,复用真核心做实时守恒/可解/难度校验,读写仓库里的关卡 JSON;判解/难度做成 core 纯函数(可测)。

**Architecture:** core 新增纯函数 `solvability.ts`(TDD);editor/ 是 Node 服务 + esbuild 打包的网页,import 真核心。

**Tech Stack:** TypeScript;core 测试用 Jest;editor 用 esbuild 打包 + 极简 Node http 服务;浏览器 DOM/Canvas UI。

## Global Constraints

- `core/solvability.ts` 不得 import 任何 Cocos(`cc`)API —— 纯 TS、Node 可测。
- 判解基于移车单调性(移走一辆车只腾格子);贪心清空网格完备,无需搜索。复用已有 `pathClear`/`footprint`/`validateLevel`,不重复实现规则。
- 车容量固定 `small=16 / medium=24 / big=32`(来自 `CAP_SIZE`)。
- 编辑器读写目录固定为 `game/assets/resources/levels/`。
- 关卡 JSON 结构与 M2 一致(`LevelData`)。

---

## 阶段 M3.0 — core 判解/难度(纯 TS,子代理 + TDD)

### Task 1: solvability.ts(isSolvable + estimateDifficulty)+ 导出

**Files:**
- Create: `game/assets/scripts/core/solvability.ts`
- Modify: `game/assets/scripts/core/index.ts`(re-export)
- Test: `logic/tests/solvability.test.ts`

**Interfaces:**
- Consumes: `LevelData`, `CarSpec` from `./types`；`validateLevel` from `./level-data`；`footprint`, `pathClear` from `./move-solver`
- Produces:
  - `function isSolvable(level: LevelData): boolean`
  - `interface Difficulty { rounds: number; cars: number; colors: number; blocked: number; score: number }`
  - `function estimateDifficulty(level: LevelData): Difficulty`

- [ ] **Step 1: 写失败测试**

`logic/tests/solvability.test.ts`:
```ts
import { isSolvable, estimateDifficulty } from '../../game/assets/scripts/core/index';
import { LevelData } from '../../game/assets/scripts/core/index';

// A 1x2 column: red on top (exits up), blue below it (blocked until red leaves).
function solvableLevel(): LevelData {
  return {
    id: 1,
    grid: { cols: 1, rows: 2, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 0, y: 1, w: 1, h: 1, dir: 'up', color: 'blue', cap: 'medium' },
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
  // 2x1 row: car A at (0,0) exits right but B blocks; B at (1,0) exits left but A blocks.
  const level: LevelData = {
    id: 2,
    grid: { cols: 2, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'right', color: 'red', cap: 'small' },
      { id: 2, x: 1, y: 0, w: 1, h: 1, dir: 'left', color: 'red', cap: 'small' },
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
    grid: { cols: 2, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 1, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/solvability.test.ts`
Expected: FAIL —— 找不到模块 `solvability` 的导出(index 尚未 re-export)。

- [ ] **Step 3: 实现 solvability.ts**

`game/assets/scripts/core/solvability.ts`:
```ts
import { LevelData, CarSpec } from './types';
import { validateLevel } from './level-data';
import { footprint, pathClear } from './move-solver';

/** Union of all cars' occupied cells. A car's exit path never includes its own
 * footprint, so passing the full occupancy (self included) is harmless. */
function occupancy(cars: CarSpec[]): Set<string> {
    const s = new Set<string>();
    for (const c of cars) for (const cell of footprint(c)) s.add(cell);
    return s;
}

/** Greedily remove every currently-exitable car, round by round. Because
 * exitability is monotone under removals, this is complete: if it stalls with
 * cars remaining, they are a mutual-block cycle and the grid is unclearable. */
function clearGrid(level: LevelData): { cleared: boolean; rounds: number; blocked: number } {
    const { cols, rows } = level.grid;
    let remaining = level.grid.cars.slice();
    const initialOcc = occupancy(remaining);
    const blocked = remaining.filter((c) => !pathClear(c, initialOcc, cols, rows)).length;

    let rounds = 0;
    while (remaining.length > 0) {
        const occ = occupancy(remaining);
        const exitable = remaining.filter((c) => pathClear(c, occ, cols, rows));
        if (exitable.length === 0) return { cleared: false, rounds, blocked };
        const ids = new Set(exitable.map((c) => c.id));
        remaining = remaining.filter((c) => !ids.has(c.id));
        rounds++;
    }
    return { cleared: true, rounds, blocked };
}

export function isSolvable(level: LevelData): boolean {
    if (validateLevel(level).length > 0) return false;
    return clearGrid(level).cleared;
}

export interface Difficulty {
    rounds: number;
    cars: number;
    colors: number;
    blocked: number;
    score: number;
}

export function estimateDifficulty(level: LevelData): Difficulty {
    const r = clearGrid(level);
    const cars = level.grid.cars.length;
    const colors = new Set(level.grid.cars.map((c) => c.color)).size;
    const score = r.rounds * 3 + r.blocked * 2 + cars + colors;
    return { rounds: r.rounds, cars, colors, blocked: r.blocked, score };
}
```

- [ ] **Step 4: 导出**

在 `game/assets/scripts/core/index.ts` 末尾加一行:
```ts
export * from './solvability';
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd logic && npx jest tests/solvability.test.ts`
Expected: PASS(5 个用例)。

- [ ] **Step 6: 跑全套确认整体绿**

Run: `cd logic && npx jest`
Expected: PASS —— 11 套件 / 44 测试。

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/core/solvability.ts game/assets/scripts/core/index.ts logic/tests/solvability.test.ts
git commit -m "feat(core): isSolvable + estimateDifficulty via monotone greedy grid-clear"
```

---

## 阶段 M3.1–M3.4 — 编辑器 App(交互式执行,非自动子代理)

**为什么交互式**:编辑器涉及 Node 服务、esbuild 打包、浏览器 DOM/Canvas 交互,需要"写代码 → 起服务 → 浏览器操作 → 截图核对 → 调整"。由主控与用户交互执行,每个里程碑一个验证 gate。

**共同约定**
- 目录 `editor/`:`server.js`(Node http)、`src/main.ts`(UI + import 真核心)、`index.html`。
- esbuild 作为 devDependency;`editor/package.json` 提供 `build`(打包 src/main.ts → dist)与 `dev`(watch)脚本;`server.js` 托管页面并提供关卡读写 API。
- 端口固定 3000。读写目录固定 `game/assets/resources/levels/`。
- 颜色沿用与游戏一致的色值枚举。
- editor 的生成物(dist/、node_modules/)加入 `.gitignore`。

### M3.1 编辑器骨架(gate:浏览器打开能看到一关数据)
- 交付:`editor/` 脚手架(package.json + esbuild)、`server.js`(托管页面 + `GET /api/levels`)、`index.html` + `src/main.ts` 打包链路、三栏空布局、加载并显示 `level-1` 的原始数据(网格尺寸、车数、乘客队列)。
- 验证:`node editor/server.js` → 浏览器 `localhost:3000` → 看到 level-1 的数据渲染出来。

### M3.2 编辑核心(gate:能改出一关并看到实时红绿灯)
- 交付:网格点击摆车/删车、选中车改颜色/尺寸/朝向、乘客队列编辑(加"颜色×数量"段、自动配平)、右栏实时 `validateLevel`+`isSolvable`+`estimateDifficulty` 红绿灯与难度分。
- 验证:改动网格/队列时,守恒/可解/难度实时正确更新(构造已知可解与死锁两种情况核对)。

### M3.3 库管理 + 保存(gate:能在仓库里增删改关卡)
- 交付:左栏关卡列表、新建/复制/删除/排序;`PUT /api/levels/:name` 保存(服务端二次校验)、`DELETE`;保存写回 `resources/levels/`。
- 验证:新建一关并保存 → 仓库 `resources/levels/` 出现该 JSON;删除 → 文件消失。

### M3.4 内置试玩(gate:配关时当场玩通)
- 交付:▶试玩用当前关建 `GameCore`,画布内点车试玩(复用核心 + 轻量 2D 渲染),显示车位/乘客状态、过关/死锁;可停止回编辑。
- 验证:对一个已知可解关试玩到"过关";对死锁关试玩到"卡住"。
- 闭环:用编辑器新建 1~2 关 → 保存 → 在 Cocos 游戏里加载玩通。

---

## Self-Review

**1. Spec coverage**:判解/难度(core 纯函数)→ Task 1;编辑器骨架/编辑/库管理/试玩 → M3.1–M3.4;实时校验复用 core;读写 resources/levels 由 server.js。均覆盖。

**2. Placeholder scan**:M3.0 完整代码 + 命令 + 预期。M3.1–M3.4 有意为交互式里程碑(明确交付物 + gate),编辑器代码执行时现场编写——深思后的范围决策。

**3. Type consistency**:`isSolvable`/`Difficulty`/`estimateDifficulty` 签名在测试与实现一致;测试从 index 导入,index 已 re-export solvability;复用 `pathClear`/`footprint`/`validateLevel` 现有签名。

**范围切分**:M3.0 可自动化 TDD,现在完整计划并按子代理流程执行;M3.1–M3.4 交互式,过后 M3 完成。
