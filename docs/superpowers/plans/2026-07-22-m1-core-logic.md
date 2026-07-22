# M1 核心逻辑层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用纯 TypeScript + Jest 实现"挪车接客"游戏的核心逻辑内核,可脱离 Cocos 引擎跑通一整关并全测试覆盖。

**Architecture:** 逻辑与表现彻底分离。本包 `logic/` 是一个独立的 TS 库,不依赖任何 Cocos API,以后由 Cocos 项目 import。顶部循环用离散 `stepLoop()` 建模(表现层每帧调用一次),使全部规则可单元测试。所有状态变更经 `GameCore` 统一入口。

**Tech Stack:** TypeScript 5.x, Jest 29 + ts-jest, Node 环境(无浏览器/引擎依赖)。

## Global Constraints

- 逻辑层不得 import 任何 Cocos(`cc`)API —— 保持纯 TS、可 Node 单测。
- 坐标系:网格原点在左上角,`x`=列(col)、`y`=行(row),向右为 +x、向下为 +y。
- 车容量固定映射:`small=16 / medium=24 / big=32`,集中定义在 `CAP_SIZE`,不得在别处硬编码数字。
- 守恒不变量:每种颜色乘客总数 == 该颜色所有车容量之和(关卡有解的必要条件)。
- 所有测试文件放在 `logic/tests/`,源码放在 `logic/src/`。
- 每个 Task 结束必须提交一次 git。

---

### Task 1: 项目脚手架 + 核心类型

**Files:**
- Create: `logic/package.json`
- Create: `logic/tsconfig.json`
- Create: `logic/jest.config.js`
- Create: `logic/src/types.ts`
- Test: `logic/tests/types.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type Dir = 'up' | 'down' | 'left' | 'right'`
  - `type Cap = 'small' | 'medium' | 'big'`
  - `const CAP_SIZE: Record<Cap, number>` = `{ small: 16, medium: 24, big: 32 }`
  - `interface CarSpec { id: number; x: number; y: number; w: number; h: number; dir: Dir; color: string; cap: Cap }`
  - `interface QueueGroup { color: string; count: number }`
  - `interface LevelData { id: number; grid: { cols: number; rows: number; cars: CarSpec[] }; parking: { slots: number; unlocked: number }; loop: { capacity: number; boardIndex: number; queue: QueueGroup[] }; powerups: { refresh: number; hardClear: number; magnet: number } }`

- [ ] **Step 1: 创建包配置文件**

`logic/package.json`:
```json
{
  "name": "parking-logic",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "test": "jest"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.4.0"
  }
}
```

`logic/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2019",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`logic/jest.config.js`:
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
};
```

- [ ] **Step 2: 安装依赖并初始化 git**

Run(在 `logic/` 目录):
```bash
cd logic && npm install
```
Expected: 生成 `node_modules/` 与 `package-lock.json`,无报错。

Run(在仓库根 `parking/` 目录,若尚未初始化 git):
```bash
git init && printf "node_modules/\ndist/\n" > logic/.gitignore
```
Expected: `Initialized empty Git repository`。

- [ ] **Step 3: 写失败测试**

`logic/tests/types.test.ts`:
```ts
import { CAP_SIZE } from '../src/types';

test('CAP_SIZE maps car sizes to capacities', () => {
  expect(CAP_SIZE.small).toBe(16);
  expect(CAP_SIZE.medium).toBe(24);
  expect(CAP_SIZE.big).toBe(32);
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `cd logic && npx jest tests/types.test.ts`
Expected: FAIL,报 `Cannot find module '../src/types'`。

- [ ] **Step 5: 实现 types.ts**

`logic/src/types.ts`:
```ts
export type Dir = 'up' | 'down' | 'left' | 'right';
export type Cap = 'small' | 'medium' | 'big';

export const CAP_SIZE: Record<Cap, number> = {
  small: 16,
  medium: 24,
  big: 32,
};

export interface CarSpec {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dir: Dir;
  color: string;
  cap: Cap;
}

export interface QueueGroup {
  color: string;
  count: number;
}

export interface LevelData {
  id: number;
  grid: { cols: number; rows: number; cars: CarSpec[] };
  parking: { slots: number; unlocked: number };
  loop: { capacity: number; boardIndex: number; queue: QueueGroup[] };
  powerups: { refresh: number; hardClear: number; magnet: number };
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd logic && npx jest tests/types.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add logic/package.json logic/tsconfig.json logic/jest.config.js logic/.gitignore logic/src/types.ts logic/tests/types.test.ts logic/package-lock.json
git commit -m "chore: scaffold logic package and core types"
```

---

### Task 2: 关卡守恒校验

**Files:**
- Create: `logic/src/level-data.ts`
- Test: `logic/tests/level-data.test.ts`

**Interfaces:**
- Consumes: `LevelData`, `CAP_SIZE` from `./types`
- Produces: `function validateLevel(level: LevelData): string[]` —— 返回错误信息数组,空数组表示合法。

- [ ] **Step 1: 写失败测试**

`logic/tests/level-data.test.ts`:
```ts
import { validateLevel } from '../src/level-data';
import { LevelData } from '../src/types';

function baseLevel(): LevelData {
  return {
    id: 1,
    grid: { cols: 2, rows: 2, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('valid level returns no errors', () => {
  expect(validateLevel(baseLevel())).toEqual([]);
});

test('color imbalance is reported', () => {
  const lvl = baseLevel();
  lvl.loop.queue = [{ color: 'red', count: 8 }]; // 8 != 16
  const errors = validateLevel(lvl);
  expect(errors.length).toBe(1);
  expect(errors[0]).toContain('red');
});

test('unlocked greater than slots is reported', () => {
  const lvl = baseLevel();
  lvl.parking.unlocked = 5; // > slots 4
  expect(validateLevel(lvl)).toContain('unlocked > slots');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/level-data.test.ts`
Expected: FAIL,报找不到模块 `../src/level-data`。

- [ ] **Step 3: 实现 level-data.ts**

`logic/src/level-data.ts`:
```ts
import { LevelData, CAP_SIZE } from './types';

export function validateLevel(level: LevelData): string[] {
  const errors: string[] = [];

  const carCap: Record<string, number> = {};
  for (const c of level.grid.cars) {
    carCap[c.color] = (carCap[c.color] || 0) + CAP_SIZE[c.cap];
  }
  const paxCount: Record<string, number> = {};
  for (const g of level.loop.queue) {
    paxCount[g.color] = (paxCount[g.color] || 0) + g.count;
  }
  const colors = new Set([...Object.keys(carCap), ...Object.keys(paxCount)]);
  for (const color of colors) {
    const cap = carCap[color] || 0;
    const pax = paxCount[color] || 0;
    if (cap !== pax) {
      errors.push(`color ${color}: car capacity ${cap} != passengers ${pax}`);
    }
  }

  if (level.parking.unlocked > level.parking.slots) {
    errors.push('unlocked > slots');
  }
  return errors;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd logic && npx jest tests/level-data.test.ts`
Expected: PASS(3 个用例)。

- [ ] **Step 5: 提交**

```bash
git add logic/src/level-data.ts logic/tests/level-data.test.ts
git commit -m "feat: level conservation validation"
```

---

### Task 3: 挪车判定(MoveSolver)

**Files:**
- Create: `logic/src/move-solver.ts`
- Test: `logic/tests/move-solver.test.ts`

**Interfaces:**
- Consumes: `CarSpec` from `./types`
- Produces:
  - `function footprint(car: CarSpec): string[]` —— 返回车占据的所有格子坐标字符串 `"x,y"`。
  - `function pathClear(car: CarSpec, occupied: Set<string>, cols: number, rows: number): boolean` —— 车沿 `dir` 方向到边界的路径上所有格子都空时返回 true。`occupied` 是**其他**车占据的格子集合。

- [ ] **Step 1: 写失败测试**

`logic/tests/move-solver.test.ts`:
```ts
import { footprint, pathClear } from '../src/move-solver';
import { CarSpec } from '../src/types';

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small', ...over,
});

test('footprint lists all occupied cells of a 2x1 car', () => {
  expect(footprint(car({ x: 1, y: 1, w: 2, h: 1 })).sort())
    .toEqual(['1,1', '2,1'].sort());
});

test('path is clear when nothing blocks the exit direction', () => {
  const c = car({ x: 1, y: 2, dir: 'up' });
  expect(pathClear(c, new Set(), 4, 4)).toBe(true);
});

test('path is blocked by a car ahead in the exit direction', () => {
  const c = car({ x: 1, y: 2, dir: 'up' });
  const occupied = new Set(['1,0']); // blocks the upward column
  expect(pathClear(c, occupied, 4, 4)).toBe(false);
});

test('occupancy outside the exit path does not block', () => {
  const c = car({ x: 1, y: 2, dir: 'up' });
  const occupied = new Set(['0,0', '2,1']); // not in column x=1 above y=2
  expect(pathClear(c, occupied, 4, 4)).toBe(true);
});

test('wide car needs every column of its width clear', () => {
  const c = car({ x: 0, y: 1, w: 2, h: 1, dir: 'up' });
  expect(pathClear(c, new Set(['1,0']), 4, 4)).toBe(false);
  expect(pathClear(c, new Set(['3,0']), 4, 4)).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/move-solver.test.ts`
Expected: FAIL,找不到模块 `../src/move-solver`。

- [ ] **Step 3: 实现 move-solver.ts**

`logic/src/move-solver.ts`:
```ts
import { CarSpec } from './types';

export function footprint(car: CarSpec): string[] {
  const cells: string[] = [];
  for (let c = car.x; c < car.x + car.w; c++) {
    for (let r = car.y; r < car.y + car.h; r++) {
      cells.push(`${c},${r}`);
    }
  }
  return cells;
}

export function pathClear(
  car: CarSpec,
  occupied: Set<string>,
  cols: number,
  rows: number,
): boolean {
  const path: Array<[number, number]> = [];
  if (car.dir === 'up') {
    for (let c = car.x; c < car.x + car.w; c++)
      for (let r = 0; r < car.y; r++) path.push([c, r]);
  } else if (car.dir === 'down') {
    for (let c = car.x; c < car.x + car.w; c++)
      for (let r = car.y + car.h; r < rows; r++) path.push([c, r]);
  } else if (car.dir === 'left') {
    for (let r = car.y; r < car.y + car.h; r++)
      for (let c = 0; c < car.x; c++) path.push([c, r]);
  } else {
    // right
    for (let r = car.y; r < car.y + car.h; r++)
      for (let c = car.x + car.w; c < cols; c++) path.push([c, r]);
  }
  return path.every(([c, r]) => !occupied.has(`${c},${r}`));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd logic && npx jest tests/move-solver.test.ts`
Expected: PASS(5 个用例)。

- [ ] **Step 5: 提交**

```bash
git add logic/src/move-solver.ts logic/tests/move-solver.test.ts
git commit -m "feat: car exit path solver"
```

---

### Task 4: 网格系统(GridSystem)

**Files:**
- Create: `logic/src/grid-system.ts`
- Test: `logic/tests/grid-system.test.ts`

**Interfaces:**
- Consumes: `CarSpec` from `./types`; `footprint`, `pathClear` from `./move-solver`
- Produces: `class GridSystem`
  - `constructor(cols: number, rows: number, cars: CarSpec[])`
  - `cars: Map<number, CarSpec>`(内部持有副本)
  - `canExit(carId: number): boolean`
  - `removeCar(carId: number): void`
  - `isEmpty(): boolean`
  - `movableCarIds(): number[]`

- [ ] **Step 1: 写失败测试**

`logic/tests/grid-system.test.ts`:
```ts
import { GridSystem } from '../src/grid-system';
import { CarSpec } from '../src/types';

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small', ...over,
});

test('a car with a clear path can exit', () => {
  const g = new GridSystem(3, 3, [car({ id: 1, x: 1, y: 2, dir: 'up' })]);
  expect(g.canExit(1)).toBe(true);
});

test('a car blocked by another cannot exit', () => {
  const g = new GridSystem(3, 3, [
    car({ id: 1, x: 1, y: 2, dir: 'up' }),
    car({ id: 2, x: 1, y: 0, dir: 'up' }),
  ]);
  expect(g.canExit(1)).toBe(false);
});

test('removing the blocker frees the blocked car', () => {
  const g = new GridSystem(3, 3, [
    car({ id: 1, x: 1, y: 2, dir: 'up' }),
    car({ id: 2, x: 1, y: 0, dir: 'up' }),
  ]);
  g.removeCar(2);
  expect(g.canExit(1)).toBe(true);
});

test('isEmpty is true only after all cars removed', () => {
  const g = new GridSystem(3, 3, [car({ id: 1 })]);
  expect(g.isEmpty()).toBe(false);
  g.removeCar(1);
  expect(g.isEmpty()).toBe(true);
});

test('movableCarIds lists only currently exitable cars', () => {
  const g = new GridSystem(3, 3, [
    car({ id: 1, x: 1, y: 2, dir: 'up' }),
    car({ id: 2, x: 1, y: 0, dir: 'up' }),
  ]);
  expect(g.movableCarIds()).toEqual([2]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/grid-system.test.ts`
Expected: FAIL,找不到模块 `../src/grid-system`。

- [ ] **Step 3: 实现 grid-system.ts**

`logic/src/grid-system.ts`:
```ts
import { CarSpec } from './types';
import { footprint, pathClear } from './move-solver';

export class GridSystem {
  cols: number;
  rows: number;
  cars: Map<number, CarSpec>;

  constructor(cols: number, rows: number, cars: CarSpec[]) {
    this.cols = cols;
    this.rows = rows;
    this.cars = new Map(cars.map((c) => [c.id, { ...c }]));
  }

  private occupiedExcluding(carId: number): Set<string> {
    const set = new Set<string>();
    for (const [id, car] of this.cars) {
      if (id === carId) continue;
      for (const cell of footprint(car)) set.add(cell);
    }
    return set;
  }

  canExit(carId: number): boolean {
    const car = this.cars.get(carId);
    if (!car) return false;
    return pathClear(car, this.occupiedExcluding(carId), this.cols, this.rows);
  }

  removeCar(carId: number): void {
    this.cars.delete(carId);
  }

  isEmpty(): boolean {
    return this.cars.size === 0;
  }

  movableCarIds(): number[] {
    return [...this.cars.keys()].filter((id) => this.canExit(id));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd logic && npx jest tests/grid-system.test.ts`
Expected: PASS(5 个用例)。

- [ ] **Step 5: 提交**

```bash
git add logic/src/grid-system.ts logic/tests/grid-system.test.ts
git commit -m "feat: grid system with exit checks"
```

---

### Task 5: 停车位系统(ParkingSystem)

**Files:**
- Create: `logic/src/parking-system.ts`
- Test: `logic/tests/parking-system.test.ts`

**Interfaces:**
- Consumes: `CarSpec`, `CAP_SIZE` from `./types`
- Produces:
  - `interface ParkedCar { carId: number; color: string; capacity: number; filled: number }`
  - `class ParkingSystem`
    - `constructor(slots: number, unlocked: number)`
    - `parked: (ParkedCar | null)[]`(长度 = `unlocked`)
    - `hasFreeSlot(): boolean`
    - `park(car: CarSpec): number`(返回车位下标;满则抛错)
    - `findMatchingSlot(color: string): number`(同色且未满车位下标,无则 -1)
    - `board(slotIndex: number): 'boarded' | 'full'`
    - `removeFull(): number[]`(移除已满车,返回其 carId)
    - `allSlotsOccupied(): boolean`
    - `isEmpty(): boolean`

- [ ] **Step 1: 写失败测试**

`logic/tests/parking-system.test.ts`:
```ts
import { ParkingSystem } from '../src/parking-system';
import { CarSpec } from '../src/types';

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small', ...over,
});

test('parks a car into a free slot and reports occupancy', () => {
  const p = new ParkingSystem(4, 2);
  expect(p.hasFreeSlot()).toBe(true);
  const idx = p.park(car({ id: 7, color: 'blue', cap: 'small' }));
  expect(p.parked[idx]?.carId).toBe(7);
  expect(p.parked[idx]?.capacity).toBe(16);
});

test('findMatchingSlot finds a same-color not-full car', () => {
  const p = new ParkingSystem(4, 2);
  p.park(car({ id: 1, color: 'red', cap: 'small' }));
  expect(p.findMatchingSlot('red')).toBe(0);
  expect(p.findMatchingSlot('green')).toBe(-1);
});

test('boarding fills a car and reports full at capacity', () => {
  const p = new ParkingSystem(4, 1);
  p.park(car({ id: 1, color: 'red', cap: 'small' })); // capacity 16
  for (let i = 0; i < 15; i++) expect(p.board(0)).toBe('boarded');
  expect(p.board(0)).toBe('full');
});

test('removeFull clears full cars and frees the slot', () => {
  const p = new ParkingSystem(4, 1);
  p.park(car({ id: 9, color: 'red', cap: 'small' }));
  for (let i = 0; i < 16; i++) p.board(0);
  expect(p.removeFull()).toEqual([9]);
  expect(p.parked[0]).toBeNull();
  expect(p.isEmpty()).toBe(true);
});

test('park throws when no free slot', () => {
  const p = new ParkingSystem(4, 1);
  p.park(car({ id: 1 }));
  expect(p.hasFreeSlot()).toBe(false);
  expect(() => p.park(car({ id: 2 }))).toThrow();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/parking-system.test.ts`
Expected: FAIL,找不到模块 `../src/parking-system`。

- [ ] **Step 3: 实现 parking-system.ts**

`logic/src/parking-system.ts`:
```ts
import { CarSpec, CAP_SIZE } from './types';

export interface ParkedCar {
  carId: number;
  color: string;
  capacity: number;
  filled: number;
}

export class ParkingSystem {
  slots: number;
  unlocked: number;
  parked: (ParkedCar | null)[];

  constructor(slots: number, unlocked: number) {
    this.slots = slots;
    this.unlocked = unlocked;
    this.parked = new Array(unlocked).fill(null);
  }

  hasFreeSlot(): boolean {
    return this.parked.some((p) => p === null);
  }

  park(car: CarSpec): number {
    const idx = this.parked.findIndex((p) => p === null);
    if (idx === -1) throw new Error('no free parking slot');
    this.parked[idx] = {
      carId: car.id,
      color: car.color,
      capacity: CAP_SIZE[car.cap],
      filled: 0,
    };
    return idx;
  }

  findMatchingSlot(color: string): number {
    return this.parked.findIndex(
      (p) => p !== null && p.color === color && p.filled < p.capacity,
    );
  }

  board(slotIndex: number): 'boarded' | 'full' {
    const p = this.parked[slotIndex];
    if (!p) throw new Error('empty slot');
    p.filled++;
    return p.filled >= p.capacity ? 'full' : 'boarded';
  }

  removeFull(): number[] {
    const removed: number[] = [];
    this.parked.forEach((p, i) => {
      if (p && p.filled >= p.capacity) {
        removed.push(p.carId);
        this.parked[i] = null;
      }
    });
    return removed;
  }

  allSlotsOccupied(): boolean {
    return this.parked.every((p) => p !== null);
  }

  isEmpty(): boolean {
    return this.parked.every((p) => p === null);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd logic && npx jest tests/parking-system.test.ts`
Expected: PASS(5 个用例)。

- [ ] **Step 5: 提交**

```bash
git add logic/src/parking-system.ts logic/tests/parking-system.test.ts
git commit -m "feat: parking system with boarding and departure"
```

---

### Task 6: 循环乘客系统(LoopSystem)

**Files:**
- Create: `logic/src/loop-system.ts`
- Test: `logic/tests/loop-system.test.ts`

**Interfaces:**
- Consumes: `QueueGroup` from `./types`
- Produces: `class LoopSystem`
  - `constructor(capacity: number, boardIndex: number, queue: QueueGroup[])`
  - `ring: (string | null)[]`(长度 = `capacity`,存颜色或空位)
  - `pool: string[]`(尚未上环的乘客,按顺序;由 `queue` 展开)
  - `passengerAtBoard(): string | null`
  - `boardPassenger(): void`(把上车位设为空)
  - `step(): void`(整环 +1 旋转;通道位(index 0)若空则从 pool 补一个)
  - `remainingCount(): number`(pool + 环上非空)
  - `isDrained(): boolean`

说明:通道补位点固定为 index 0;`boardIndex` 不要设为 0,以免上车位与补位点重合。

- [ ] **Step 1: 写失败测试**

`logic/tests/loop-system.test.ts`:
```ts
import { LoopSystem } from '../src/loop-system';

test('ring fills from pool on construction, rest stays in pool', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 6 }]);
  expect(loop.ring).toEqual(['red', 'red', 'red', 'red']);
  expect(loop.pool.length).toBe(2);
  expect(loop.remainingCount()).toBe(6);
});

test('passengerAtBoard reads the board position', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 6 }]);
  expect(loop.passengerAtBoard()).toBe('red');
  loop.boardPassenger();
  expect(loop.passengerAtBoard()).toBeNull();
});

test('step rotates ring forward by one', () => {
  const loop = new LoopSystem(4, 2, [
    { color: 'a', count: 1 }, { color: 'b', count: 1 },
    { color: 'c', count: 1 }, { color: 'd', count: 1 },
  ]);
  // ring = [a,b,c,d]; after step -> index i moves to i+1 => [d,a,b,c]
  loop.step();
  expect(loop.ring).toEqual(['d', 'a', 'b', 'c']);
});

test('empty channel slot refills from pool after step', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 3 }]);
  // ring=[x,x], pool=[x]. board index1, then boardPassenger -> ring=[x,null]
  loop.boardPassenger();
  expect(loop.ring).toEqual(['x', null]);
  // step: rotate -> [null, x]; channel index0 is null -> refill from pool
  loop.step();
  expect(loop.ring).toEqual(['x', 'x']);
  expect(loop.pool.length).toBe(0);
});

test('isDrained true only when pool empty and ring cleared', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 2 }]);
  expect(loop.isDrained()).toBe(false);
  loop.ring = [null, null];
  loop.pool = [];
  expect(loop.isDrained()).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/loop-system.test.ts`
Expected: FAIL,找不到模块 `../src/loop-system`。

- [ ] **Step 3: 实现 loop-system.ts**

`logic/src/loop-system.ts`:
```ts
import { QueueGroup } from './types';

export class LoopSystem {
  capacity: number;
  boardIndex: number;
  ring: (string | null)[];
  pool: string[];
  private channelIndex = 0;

  constructor(capacity: number, boardIndex: number, queue: QueueGroup[]) {
    this.capacity = capacity;
    this.boardIndex = boardIndex;
    this.pool = [];
    for (const g of queue) {
      for (let i = 0; i < g.count; i++) this.pool.push(g.color);
    }
    this.ring = new Array(capacity).fill(null);
    for (let i = 0; i < capacity && this.pool.length > 0; i++) {
      this.ring[i] = this.pool.shift()!;
    }
  }

  passengerAtBoard(): string | null {
    return this.ring[this.boardIndex];
  }

  boardPassenger(): void {
    this.ring[this.boardIndex] = null;
  }

  step(): void {
    const rotated: (string | null)[] = new Array(this.capacity).fill(null);
    for (let i = 0; i < this.capacity; i++) {
      rotated[(i + 1) % this.capacity] = this.ring[i];
    }
    this.ring = rotated;
    if (this.ring[this.channelIndex] === null && this.pool.length > 0) {
      this.ring[this.channelIndex] = this.pool.shift()!;
    }
  }

  remainingCount(): number {
    return this.pool.length + this.ring.filter((x) => x !== null).length;
  }

  isDrained(): boolean {
    return this.remainingCount() === 0;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd logic && npx jest tests/loop-system.test.ts`
Expected: PASS(5 个用例)。

- [ ] **Step 5: 提交**

```bash
git add logic/src/loop-system.ts logic/tests/loop-system.test.ts
git commit -m "feat: rotating passenger loop system"
```

---

### Task 7: 上车结算(BoardingSystem)

**Files:**
- Create: `logic/src/boarding-system.ts`
- Test: `logic/tests/boarding-system.test.ts`

**Interfaces:**
- Consumes: `LoopSystem` from `./loop-system`; `ParkingSystem` from `./parking-system`
- Produces:
  - `interface BoardResult { boardedColor: string | null; departedCarIds: number[] }`
  - `class BoardingSystem`
    - `constructor(loop: LoopSystem, parking: ParkingSystem)`
    - `tick(): BoardResult` —— 一个 tick:尝试让上车位的乘客上同色车 → 移除已满车 → 推进循环一步。

- [ ] **Step 1: 写失败测试**

`logic/tests/boarding-system.test.ts`:
```ts
import { BoardingSystem } from '../src/boarding-system';
import { LoopSystem } from '../src/loop-system';
import { ParkingSystem } from '../src/parking-system';
import { CarSpec } from '../src/types';

const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small', ...over,
});

test('passenger boards a matching parked car and loop advances', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 16 }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'red', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  const res = boarding.tick();
  expect(res.boardedColor).toBe('red');
  expect(parking.parked[0]?.filled).toBe(1);
});

test('no matching car means no boarding, loop still advances', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 16 }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 1, color: 'blue', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  const before = loop.remainingCount();
  const res = boarding.tick();
  expect(res.boardedColor).toBeNull();
  expect(loop.remainingCount()).toBe(before); // nobody boarded
});

test('a car that fills up departs and its id is reported', () => {
  // small car cap 16, exactly 16 red passengers
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 16 }]);
  const parking = new ParkingSystem(4, 1);
  parking.park(car({ id: 42, color: 'red', cap: 'small' }));
  const boarding = new BoardingSystem(loop, parking);

  let departed: number[] = [];
  for (let i = 0; i < 200 && parking.parked[0] !== null; i++) {
    departed = departed.concat(boarding.tick().departedCarIds);
  }
  expect(departed).toContain(42);
  expect(parking.isEmpty()).toBe(true);
  expect(loop.isDrained()).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/boarding-system.test.ts`
Expected: FAIL,找不到模块 `../src/boarding-system`。

- [ ] **Step 3: 实现 boarding-system.ts**

`logic/src/boarding-system.ts`:
```ts
import { LoopSystem } from './loop-system';
import { ParkingSystem } from './parking-system';

export interface BoardResult {
  boardedColor: string | null;
  departedCarIds: number[];
}

export class BoardingSystem {
  constructor(
    private loop: LoopSystem,
    private parking: ParkingSystem,
  ) {}

  tick(): BoardResult {
    let boardedColor: string | null = null;
    const color = this.loop.passengerAtBoard();
    if (color) {
      const slot = this.parking.findMatchingSlot(color);
      if (slot !== -1) {
        this.parking.board(slot);
        this.loop.boardPassenger();
        boardedColor = color;
      }
    }
    const departedCarIds = this.parking.removeFull();
    this.loop.step();
    return { boardedColor, departedCarIds };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd logic && npx jest tests/boarding-system.test.ts`
Expected: PASS(3 个用例)。

- [ ] **Step 5: 提交**

```bash
git add logic/src/boarding-system.ts logic/tests/boarding-system.test.ts
git commit -m "feat: boarding coordinator between loop and parking"
```

---

### Task 8: 游戏核心与状态机(GameCore)

**Files:**
- Create: `logic/src/game-core.ts`
- Test: `logic/tests/game-core.test.ts`

**Interfaces:**
- Consumes: `LevelData` from `./types`; `GridSystem`, `ParkingSystem`, `LoopSystem`, `BoardingSystem` from各自模块。
- Produces:
  - `type GameState = 'playing' | 'won' | 'deadlock'`
  - `class GameCore`
    - `constructor(level: LevelData)`
    - `grid: GridSystem; parking: ParkingSystem; loop: LoopSystem; boarding: BoardingSystem`
    - `tapCar(carId: number): boolean`(可开出且有空位 → 停入并从网格移除,返回是否成功)
    - `stepLoop(): void`(推进一个 tick)
    - `getState(): GameState`

死局判定(启发式):既不能"把车开进空位"(有空位且有可动车),也没有"任一停着的车还能被剩余乘客坐满",且未过关 → `deadlock`。

- [ ] **Step 1: 写失败测试**

`logic/tests/game-core.test.ts`:
```ts
import { GameCore } from '../src/game-core';
import { LevelData } from '../src/types';

// Minimal solvable level: one small red car (cap 16), 16 red passengers.
function soloLevel(): LevelData {
  return {
    id: 1,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('tapCar parks an exitable car and removes it from the grid', () => {
  const game = new GameCore(soloLevel());
  expect(game.tapCar(1)).toBe(true);
  expect(game.grid.isEmpty()).toBe(true);
  expect(game.parking.parked[0]?.carId).toBe(1);
});

test('tapCar fails when no free slot', () => {
  const game = new GameCore(soloLevel());
  game.parking.parked = [
    { carId: 99, color: 'x', capacity: 16, filled: 0 },
  ]; // force all-occupied (unlocked collapsed to 1 for the test)
  expect(game.tapCar(1)).toBe(false);
});

test('playing a full level reaches won state', () => {
  const game = new GameCore(soloLevel());
  game.tapCar(1);
  for (let i = 0; i < 200 && game.getState() === 'playing'; i++) {
    game.stepLoop();
  }
  expect(game.getState()).toBe('won');
});

test('deadlock is detected when no progress is possible', () => {
  // Grid car is blue but the only passengers are red -> blue car can never fill,
  // and once parked there is no other car to move.
  const level: LevelData = {
    id: 2,
    grid: { cols: 1, rows: 1, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'blue', cap: 'small' },
    ] },
    parking: { slots: 1, unlocked: 1 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
  const game = new GameCore(level);
  game.tapCar(1);          // blue car now occupies the only slot
  game.stepLoop();         // red passengers cannot board a blue car
  expect(game.getState()).toBe('deadlock');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/game-core.test.ts`
Expected: FAIL,找不到模块 `../src/game-core`。

- [ ] **Step 3: 实现 game-core.ts**

`logic/src/game-core.ts`:
```ts
import { LevelData } from './types';
import { GridSystem } from './grid-system';
import { ParkingSystem } from './parking-system';
import { LoopSystem } from './loop-system';
import { BoardingSystem } from './boarding-system';

export type GameState = 'playing' | 'won' | 'deadlock';

export class GameCore {
  grid: GridSystem;
  parking: ParkingSystem;
  loop: LoopSystem;
  boarding: BoardingSystem;
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
  }

  tapCar(carId: number): boolean {
    if (this.state !== 'playing') return false;
    if (!this.grid.canExit(carId)) return false;
    if (!this.parking.hasFreeSlot()) return false;
    const car = this.grid.cars.get(carId)!;
    this.parking.park(car);
    this.grid.removeCar(carId);
    this.updateState();
    return true;
  }

  stepLoop(): void {
    if (this.state !== 'playing') return;
    this.boarding.tick();
    this.updateState();
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

Run: `cd logic && npx jest tests/game-core.test.ts`
Expected: PASS(4 个用例)。

- [ ] **Step 5: 提交**

```bash
git add logic/src/game-core.ts logic/tests/game-core.test.ts
git commit -m "feat: game core state machine with win and deadlock detection"
```

---

### Task 9: 整关回放集成测试 + 统一导出

**Files:**
- Create: `logic/src/index.ts`
- Test: `logic/tests/integration.test.ts`

**Interfaces:**
- Consumes: 所有已实现模块。
- Produces: `logic/src/index.ts` re-export 全部公共 API(供 Cocos 项目单点 import)。

- [ ] **Step 1: 写失败测试(多色多车整关)**

`logic/tests/integration.test.ts`:
```ts
import { GameCore, validateLevel, LevelData } from '../src/index';

// Two colors, two cars; blue car is initially blocked by the red car above it,
// so the player must move red first. Conservation: red 16, blue 24.
function level(): LevelData {
  return {
    id: 10,
    grid: { cols: 1, rows: 2, cars: [
      { id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red',  cap: 'small'  }, // top, exits up
      { id: 2, x: 0, y: 1, w: 1, h: 1, dir: 'up', color: 'blue', cap: 'medium' }, // blocked by car 1
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 5, boardIndex: 3, queue: [
      { color: 'red', count: 16 },
      { color: 'blue', count: 24 },
    ] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('level passes conservation validation', () => {
  expect(validateLevel(level())).toEqual([]);
});

test('blocked car cannot be tapped until blocker is removed', () => {
  const game = new GameCore(level());
  expect(game.tapCar(2)).toBe(false); // blue blocked by red
  expect(game.tapCar(1)).toBe(true);  // red exits
  expect(game.tapCar(2)).toBe(true);  // blue now free
});

test('full playthrough reaches won', () => {
  const game = new GameCore(level());
  game.tapCar(1);
  game.tapCar(2);
  for (let i = 0; i < 500 && game.getState() === 'playing'; i++) {
    game.stepLoop();
  }
  expect(game.getState()).toBe('won');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd logic && npx jest tests/integration.test.ts`
Expected: FAIL,找不到模块 `../src/index`。

- [ ] **Step 3: 实现 index.ts**

`logic/src/index.ts`:
```ts
export * from './types';
export * from './level-data';
export * from './move-solver';
export * from './grid-system';
export * from './parking-system';
export * from './loop-system';
export * from './boarding-system';
export * from './game-core';
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `cd logic && npx jest`
Expected: 所有测试文件 PASS(Task 1–9 全绿)。

- [ ] **Step 5: 提交**

```bash
git add logic/src/index.ts logic/tests/integration.test.ts
git commit -m "test: full-level playthrough integration + public exports"
```

---

## Self-Review

**1. Spec coverage(对照设计文档各节):**
- 核心规则(挪车判定/同色上车/容量/坐满开走/补位/胜负) → Task 3–8 覆盖。
- 逻辑与表现分离 → 全部为纯 TS,无 Cocos 依赖(Global Constraints 强制)。
- 关卡 JSON 格式 + 守恒校验 → `LevelData`(Task 1) + `validateLevel`(Task 2)。
- 车位锁定(unlocked < slots) → `ParkingSystem` 以 `unlocked` 长度建位;`validateLevel` 校验 `unlocked <= slots`。
- 死局检测 → Task 8。
- 道具(刷新/硬消/磁铁) → **不在 M1**,属 M4 系统层;M1 的 `LevelData.powerups` 已预留字段,逻辑接口在后续计划实现。此为有意的范围切分,非遗漏。
- 表现层(GridView/LoopView 等)、编辑器 → M2/M3 独立计划。

**2. Placeholder scan:** 无 TBD/TODO;每个 code step 均给出完整代码与预期输出。

**3. Type consistency:** `CarSpec`/`ParkedCar`/`GameState`/`BoardResult` 签名在定义 Task 与消费 Task 间一致;`findMatchingSlot`/`board`/`removeFull`/`stepLoop`/`tapCar` 命名跨 Task 统一。

范围切分说明:M1 交付"可跑通整关的纯逻辑内核 + 全测试",不含任何画面与道具行为。道具、Cocos 视图、编辑器、上线配置分别在 M2–M4 各自计划中。
