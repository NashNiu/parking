# M2 Cocos 视图层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the M2.0 tasks below. Steps use checkbox (`- [ ]`) syntax. The M2.1–M2.4 view milestones are executed interactively (code + editor + preview), NOT via autonomous subagents — see that section.

**Goal:** 把 M1 纯逻辑内核接入 Cocos Creator 3.8.7,用占位图形做出能完整玩通一关的可玩 Demo。

**Architecture:** 逻辑内核迁入 `game/assets/scripts/core/` 成为唯一源码,由 Cocos 编译、由 `logic/` 的 Jest 测试;视图层薄,只喂输入 + 按逻辑返回值/状态播动画。

**Tech Stack:** Cocos Creator 3.8.7(3D 场景 + Canvas UI),TypeScript;测试仍用 Jest + ts-jest(在 `logic/`)。

## Global Constraints

- 核心逻辑(`game/assets/scripts/core/*.ts`)不得 import 任何 Cocos(`cc`)API —— 保持纯 TS、Node 可测。
- 视图脚本(`game/assets/scripts/view/*.ts`)可以 import `cc`,但不得重复实现任何游戏规则判断——一切规则问 `GameCore`。
- 车容量固定:`small=16 / medium=24 / big=32`,只在 `CAP_SIZE` 定义。
- 守恒不变量:每色乘客总数 == 该色车容量之和(`validateLevel` 校验)。
- 单一数据源:核心只有一份,位于 `game/assets/scripts/core/`;测试位于 `logic/tests/`(在 assets 外,Cocos 不编译)。
- 竖屏,设计分辨率 720×1280。
- 逻辑网格坐标 `(x,y)` 左上原点;世界坐标换算集中在 `GridLayout`,视图不散落魔法数。

---

## 阶段 M2.0 — 接线准备(纯 TS,子代理可执行)

### Task 1: 迁移核心到 assets + retarget Jest + game/.gitignore

**Files:**
- Move: `logic/src/` → `game/assets/scripts/core/`(git mv 整个目录)
- Modify: 所有 `logic/tests/*.ts` 的 import 路径
- Modify: `logic/jest.config.js`
- Modify: `logic/tsconfig.json`
- Create: `game/.gitignore`

**Interfaces:**
- Consumes: 无(纯迁移)
- Produces: 核心模块位于 `game/assets/scripts/core/`,对外 API 与迁移前完全一致(types/level-data/move-solver/grid-system/parking-system/loop-system/boarding-system/game-core/index)。

- [ ] **Step 1: 迁移核心目录**

Run(仓库根 `d:/code/weGame/parking`,用 Bash/Git Bash):
```bash
mkdir -p game/assets/scripts && git mv logic/src game/assets/scripts/core
```
Expected: `logic/src` 消失,`game/assets/scripts/core/` 下出现 9 个 .ts 文件。

- [ ] **Step 2: 改测试 import 路径**

把 `logic/tests/` 下所有测试文件中的 `'../src/` 前缀改为 `'../../game/assets/scripts/core/`。
Run:
```bash
cd logic/tests && sed -i "s#'\.\./src/#'../../game/assets/scripts/core/#g" *.ts && cd ../..
```
Expected: 8 个测试文件的 import 全部指向新路径(如 `import { GameCore } from '../../game/assets/scripts/core/index';`)。

- [ ] **Step 3: 更新 jest.config.js**

`logic/jest.config.js` 改为(移除已不存在的 `src` root):
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
};
```

- [ ] **Step 4: 更新 tsconfig.json**

`logic/tsconfig.json` 改为(移除 src 专属的 rootDir/outDir/declaration,加 skipLibCheck):
```json
{
  "compilerOptions": {
    "target": "ES2019",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["tests"]
}
```

- [ ] **Step 5: 创建 game/.gitignore**

`game/.gitignore`:
```
library/
temp/
local/
build/
node_modules/
```

- [ ] **Step 6: 跑全套测试确认仍全绿**

Run: `cd logic && npx jest`
Expected: PASS —— 9 个测试套件、34 个测试全部通过(与迁移前一致,证明只是换了位置)。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "refactor: move logic core into game/assets/scripts/core; retarget jest; add game gitignore"
```

- [ ] **Step 8(人工验证,非子代理):** 用户在 Cocos 编辑器打开 `game/` 项目,确认 `assets/scripts/core` 下脚本无编译报错(编辑器控制台无红色 error)。若有报错记录下来反馈。

---

### Task 2: GameCore API 增强(tapCar/stepLoop 返回值 + 子系统 readonly)

**Files:**
- Modify: `game/assets/scripts/core/game-core.ts`
- Modify: `logic/tests/game-core.test.ts`
- Modify: `logic/tests/integration.test.ts`

**Interfaces:**
- Consumes: `BoardResult` from `./boarding-system`
- Produces:
  - `interface TapResult { ok: boolean; slotIndex: number }`(export from game-core）
  - `GameCore.tapCar(carId: number): TapResult`(成功时 `{ok:true, slotIndex}`;失败 `{ok:false, slotIndex:-1}`)
  - `GameCore.stepLoop(): BoardResult`(非 playing 时返回 `{boardedColor:null, departedCarIds:[]}`)
  - `GameCore` 字段 `grid/parking/loop/boarding` 改为 `readonly`

- [ ] **Step 1: 改测试以匹配新返回值(先让测试反映新契约)**

`logic/tests/game-core.test.ts` —— 替换第一个测试与"no free slot"测试与 deadlock 测试中对 tapCar 返回值的断言:

第 17-22 行的测试改为:
```ts
test('tapCar parks an exitable car and removes it from the grid', () => {
  const game = new GameCore(soloLevel());
  expect(game.tapCar(1)).toEqual({ ok: true, slotIndex: 0 });
  expect(game.grid.isEmpty()).toBe(true);
  expect(game.parking.parked[0]?.carId).toBe(1);
});
```

第 24-30 行的 "tapCar fails when no free slot" 测试整体替换为(改用公共 API 构造,不再直接改内部数组):
```ts
test('tapCar fails when no free slot', () => {
  const level: LevelData = {
    id: 3,
    grid: { cols: 2, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 1, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 1 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 32 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.tapCar(1).ok).toBe(true);
  expect(game.tapCar(2)).toEqual({ ok: false, slotIndex: -1 });
});
```

第 55 行 `expect(game.tapCar(1)).toBe(true);` 改为:
```ts
  expect(game.tapCar(1).ok).toBe(true); // blue car occupies the only slot
```

`logic/tests/integration.test.ts` —— 第 25-30 行的测试改为:
```ts
test('blocked car cannot be tapped until blocker is removed', () => {
  const game = new GameCore(level());
  expect(game.tapCar(2).ok).toBe(false); // blue blocked by red
  expect(game.tapCar(1).ok).toBe(true);  // red exits
  expect(game.tapCar(2).ok).toBe(true);  // blue now free
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/game-core.test.ts tests/integration.test.ts`
Expected: FAIL —— 因为 `tapCar` 还返回 boolean,`.toEqual({ok:...})` 与 `.ok` 断言不匹配。

- [ ] **Step 3: 实现 API 增强**

`game/assets/scripts/core/game-core.ts` —— 顶部 import 增加 BoardResult,新增 TapResult,字段加 readonly,改两个方法。完整文件:
```ts
import { LevelData } from './types';
import { GridSystem } from './grid-system';
import { ParkingSystem } from './parking-system';
import { LoopSystem } from './loop-system';
import { BoardingSystem, BoardResult } from './boarding-system';

export type GameState = 'playing' | 'won' | 'deadlock';

export interface TapResult {
  ok: boolean;
  slotIndex: number;
}

export class GameCore {
  readonly grid: GridSystem;
  readonly parking: ParkingSystem;
  readonly loop: LoopSystem;
  readonly boarding: BoardingSystem;
  private state: GameState = 'playing';

  constructor(level: LevelData) {
    this.grid = new GridSystem(level.grid.cols, level.grid.rows, level.grid.cars);
    this.parking = new ParkingSystem(level.parking.slots, level.parking.unlocked);
    this.loop = new LoopSystem(
      level.loop.capacity,
      level.loop.boardIndex,
      level.loop.queue,
    );
    this.boarding = new BoardingSystem(this.loop, this.parking);
    this.updateState();
  }

  tapCar(carId: number): TapResult {
    if (this.state !== 'playing') return { ok: false, slotIndex: -1 };
    if (!this.grid.canExit(carId)) return { ok: false, slotIndex: -1 };
    if (!this.parking.hasFreeSlot()) return { ok: false, slotIndex: -1 };
    const car = this.grid.cars.get(carId)!;
    const slotIndex = this.parking.park(car);
    this.grid.removeCar(carId);
    this.updateState();
    return { ok: true, slotIndex };
  }

  stepLoop(): BoardResult {
    if (this.state !== 'playing') return { boardedColor: null, departedCarIds: [] };
    const res = this.boarding.tick();
    this.updateState();
    return res;
  }

  getState(): GameState {
    return this.state;
  }

  private updateState(): void {
    if (
      this.grid.isEmpty() &&
      this.parking.isEmpty() &&
      this.loop.isDrained()
    ) {
      this.state = 'won';
      return;
    }
    if (this.isDeadlocked()) this.state = 'deadlock';
  }

  private hasRemainingColor(color: string): boolean {
    return this.loop.pool.includes(color) || this.loop.ring.includes(color);
  }

  private isDeadlocked(): boolean {
    const canBringOut =
      this.parking.hasFreeSlot() && this.grid.movableCarIds().length > 0;
    if (canBringOut) return false;
    const canFillSomething = this.parking.parked.some(
      (p) => p !== null && p.filled < p.capacity && this.hasRemainingColor(p.color),
    );
    if (canFillSomething) return false;
    return true;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd logic && npx jest`
Expected: PASS —— 9 套件 / 34 测试全绿(改动的断言现在匹配新返回值,其余不受影响)。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: tapCar/stepLoop return results; readonly subsystems"
```

---

### Task 3: 补齐 M1 终审指出的覆盖缺口

**Files:**
- Create: `logic/tests/coverage-m2.test.ts`

**Interfaces:**
- Consumes: `GameCore`, `LevelData` from `../../game/assets/scripts/core/index`
- Produces: 无新代码,仅新增测试。

- [ ] **Step 1: 写测试**

`logic/tests/coverage-m2.test.ts`:
```ts
import { GameCore, LevelData } from '../../game/assets/scripts/core/index';

test('a wide (multi-cell) car exits and parks via GameCore', () => {
  const level: LevelData = {
    id: 20,
    grid: { cols: 2, rows: 2, cars: [
      { id: 1, x: 0, y: 1, w: 2, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 2, unlocked: 2 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  const res = game.tapCar(1);
  expect(res.ok).toBe(true);
  expect(game.grid.isEmpty()).toBe(true);
  expect(game.parking.parked[res.slotIndex]?.carId).toBe(1);
});

test('a wide car blocked in one lane cannot be tapped', () => {
  const level: LevelData = {
    id: 21,
    grid: { cols: 2, rows: 2, cars: [
      { id: 1, x: 0, y: 1, w: 2, h: 1, dir: 'up', color: 'red', cap: 'small' },
      { id: 2, x: 1, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 2, unlocked: 2 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 32 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.tapCar(1).ok).toBe(false); // column 1 blocked by car 2
  expect(game.tapCar(2).ok).toBe(true);  // car 2 exits up (already at top row)
  expect(game.tapCar(1).ok).toBe(true);  // lane now clear
});

test('a big car (cap 32) fills and departs, level won', () => {
  const level: LevelData = {
    id: 22,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'green', cap: 'big' },
    ] },
    parking: { slots: 2, unlocked: 2 },
    loop: { capacity: 6, boardIndex: 3, queue: [{ color: 'green', count: 32 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.tapCar(1).ok).toBe(true);
  let departed: number[] = [];
  for (let i = 0; i < 500 && game.getState() === 'playing'; i++) {
    departed = departed.concat(game.stepLoop().departedCarIds);
  }
  expect(departed).toContain(1);
  expect(game.getState()).toBe('won');
});

test('a medium car (cap 24) fills and departs, level won', () => {
  const level: LevelData = {
    id: 24,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'yellow', cap: 'medium' },
    ] },
    parking: { slots: 2, unlocked: 2 },
    loop: { capacity: 6, boardIndex: 3, queue: [{ color: 'yellow', count: 24 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.tapCar(1).ok).toBe(true);
  for (let i = 0; i < 500 && game.getState() === 'playing'; i++) game.stepLoop();
  expect(game.getState()).toBe('won');
});

test('locked slots are not usable: unlocked<slots can deadlock', () => {
  const level: LevelData = {
    id: 23,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'blue', cap: 'small' },
    ] },
    parking: { slots: 3, unlocked: 1 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  expect(game.parking.parked.length).toBe(1); // only unlocked slots exist
  expect(game.tapCar(1).ok).toBe(true);
  expect(game.getState()).toBe('deadlock'); // 2 locked slots don't count as free
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd logic && npx jest tests/coverage-m2.test.ts`
Expected: PASS(5 个新测试)。

- [ ] **Step 3: 跑全套确认整体绿**

Run: `cd logic && npx jest`
Expected: PASS —— 10 套件 / 39 测试。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "test: backfill multi-cell car, medium/big departure, locked-slot coverage"
```

---

## 阶段 M2.1–M2.4 — Cocos 视图层(交互式执行,非自动子代理)

**为什么交互式**:这些里程碑涉及 Cocos 场景/节点/相机的编辑器 GUI 操作,以及需要对着 3.8.7 实际运行时 API 现场验证的代码(创建占位网格、材质上色、射线拾取、缓动动画)。这些无法由自动子代理跑闭环验证,必须"写脚本 → 编辑器里挂载/预览 → 截图核对 → 调整"。因此本阶段由主控与用户交互执行,每个里程碑一个验证关卡(gate),通过后再进下一个。

**共同约定**
- 视图脚本放 `game/assets/scripts/view/`,可 import `cc`,但只调用 `core` 的公共 API,不重复规则。
- 占位图形优先用运行时程序化生成(代码建节点/网格/材质),把编辑器手工操作压到最少。
- 关卡 JSON 放 `game/assets/resources/levels/`,`resources.load` 读取,先 `validateLevel` 再建 `GameCore`。
- 颜色常量集中在 `game/assets/scripts/view/colors.ts`,与逻辑颜色字符串一一对应。

### M2.1 静态渲染(gate:场景能显示一关布局)
- 交付:`GridLayout`(坐标映射工具)、`GridView`(按关卡 JSON 摆占位车 + 箭头)、车位/锁定位/乘客队列静态显示;一个场景 `main.scene`,含透视相机 + 平行光 + Canvas。
- 编辑器步骤:新建场景、加相机/光/Canvas、建一个空节点挂 `GameController`、项目设为竖屏 720×1280。
- 验证:用户运行预览,截图核对布局与参考图分区一致(顶部轨道区/车位区、底部网格、底部按钮占位)。

### M2.2 挪车交互(gate:能点车、车开进车位)
- 交付:点击射线拾取 carId → `core.tapCar` → 按 `TapResult` 播开出+停靠动画;失败播抖动。
- 验证:用户运行预览,点可开出的车→开进空位;点被挡的车→抖动;车位满→提示。

### M2.3 循环与上车(gate:能完整玩通一关)
- 交付:`GameController.update` 帧循环(tick 间隔约 0.15s)驱动 `core.stepLoop`,按 `BoardResult` 播乘客上车/车坐满开走;`LoopView` 乘客循环移动 + 补位;`ParkingView` 计数与驶离。
- 验证:用户运行预览,完整玩通预置关卡到"过关";观察乘客循环、上车、坐满开走表现正确。

### M2.4 HUD 与状态(gate:有头有尾的可玩 Demo)
- 交付:TopHUD(关卡号/完成度)、BottomBar(道具按钮占位可点)、过关/失败弹窗;手搓 2~3 关 JSON,支持切换/重玩。
- 验证:用户运行预览,走通"进入关卡→玩→过关/失败弹窗→下一关/重玩"完整闭环。

---

## Self-Review

**1. Spec coverage(对照 M2 设计文档):**
- 逻辑内核接入(核心迁 assets、retarget Jest、game/.gitignore)→ Task 1。
- API 增强(tapCar/stepLoop 返回值、readonly)→ Task 2。
- 补测(多格车、中/大车坐满、锁定位)→ Task 3。
- 场景/相机/视图组件/帧循环/关卡加载 → M2.1–M2.4 交互式里程碑,逐 gate 验证。
- 验证策略(逻辑 Jest + 视图真机截图)→ 各阶段验证步骤已写明。

**2. Placeholder scan:** M2.0 三个任务均为完整代码/命令 + 预期输出,无 TBD。M2.1–M2.4 有意不写臆测 Cocos 代码——明确标注为交互式现场编写,这是深思后的范围决策而非遗漏。

**3. Type consistency:** `TapResult`(game-core 定义)、`BoardResult`(boarding-system 定义,index 已 re-export)在测试与实现间一致;测试 import 路径统一为 `../../game/assets/scripts/core/`。

**范围切分说明**:M2.0 是可自动化、可闭环验证的部分,现在完整计划并按 M1 同样的子代理流程执行。M2.1–M2.4 是引擎/编辑器交互工作,通过后进入 M3(关卡编辑器)/M4(上线)。
