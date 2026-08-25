# 自由角度驶出方向 实现计划 (M8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把停车场的碰撞模型从「格子 + 四方向」换成「有向矩形 + 任意朝向角」,车可以斜着停、斜着开出去。

**Architecture:** core 新增一个纯几何模块(OBB、扫掠分离轴测试、最小平移向量),`CarSpec` 从 `{x,y,w,h,dir}` 整数格改成 `{x,y,angle}` 连续坐标,车身尺寸由 `CAP_BOX` 一张表决定。生成器从「整数格撒点」改成「随机撒有向矩形 + 分离松弛」,剥离时每辆车只有沿车身轴的两个朝向可选,所以「剥离顺序就是解」这条不变式原样保留。view 侧格子布局退化成一个纯缩放,`orientAngle` 那套四方向映射删掉。

**Tech Stack:** TypeScript 5.4,jest 29 + ts-jest(只测 `core/`),Cocos Creator 3.8.7(view 只做 `tsc` 类型检查,没有测试框架)。

**Spec:** `docs/superpowers/specs/2026-08-25-free-angle-exits-design.md`

## Global Constraints

以下每一条对每个任务都生效:

- **core 不认识 Cocos**:`game/assets/scripts/core/` 下任何文件都不许 `import ... from 'cc'`。jest 加载不了带 `cc` 的模块,加了就是整个测试套件挂掉。
- **两道闸**:`cd logic && npm test`(jest,只覆盖 core)与 `cd logic && npm run typecheck:view`(`tsc -p tsconfig.view.json`)。
- **Task 3、4、5 期间 `typecheck:view` 是红的**,这是预期的:core 换了型而 view 还没跟上。Task 6 收尾时两道闸必须同时绿。除此之外的每个任务结束时两道闸都必须绿。
- **可解性由构造保证**:`peel` 产出的剥离顺序必须仍然是一个合法解。
- **圆环 / 通道 / 乘客 / 停车位一律不动**:`loop-system.ts`、`boarding-system.ts`、`parking-system.ts`、`track-path.ts`、`track-shapes.ts` 零改动;`loop-system.test.ts`、`boarding-system.test.ts`、`parking-system.test.ts`、`track-path.test.ts`、`track-shapes.test.ts` 零改动。
- **面向用户的文字用中文,代码 / 注释 / commit message 用英文。**
- **分支**:在 `dev` 上提交。合并到 `master` 是用户的决定,不要自己合。
- **commit message 结尾必须带**:`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **常量的确切值**(spec 第一节,一个字都不要改):
  - `CAP_BOX.small = { len: 0.964, wid: 0.471 }`
  - `CAP_BOX.medium = { len: 1.772, wid: 0.567 }`
  - `CAP_BOX.big = { len: 1.949, wid: 0.620 }`
  - `CAR_SCALE = 1.0`
  - `CLEARANCE = 0.04`
  - `LOT = { w: 9, h: 6 }`
  - `RELAX_ITERS = 60`
  - `SNAP_SHARE = 0.25`
  - 角度:度,`0° = +X`,逆时针为正,写进关卡数据前归一化到 `[0, 360)`。
  - 板坐标:原点在场地中心,**+Y 朝上**,1 板单位 = 今天的格距。
- **不要在 core 里用 `Math.random()`**:生成器全部走已有的 `mulberry32` 种子,同一个关卡 id 必须永远产出同一个关卡。

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `game/assets/scripts/core/geometry.ts` | **新建**。纯几何:`OBB`、投影、`overlapMTV`、`insideRect`、`sweepHit`。不认识 `CarSpec`,不认识关卡 | 1, 2 |
| `logic/tests/geometry.test.ts` | **新建**。几何的全部测试 | 1, 2 |
| `game/assets/scripts/core/types.ts` | `CarSpec` 改型、`Box`/`Lot`、`CAP_BOX`/`CAR_SCALE`/`CLEARANCE`、`LevelData.lot`;删 `Dir` | 3 |
| `game/assets/scripts/core/move-solver.ts` | `carBox`/`heading`、`pathClear`/`firstBlocker` 重写;删 `footprint`、`STEP` | 3 |
| `game/assets/scripts/core/grid-system.ts` | 构造函数收 `Lot`;删 `occupiedExcluding` | 3 |
| `game/assets/scripts/core/game-core.ts` | 构造 `GridSystem` 的那一行 | 3 |
| `game/assets/scripts/core/solvability.ts` | 删 `occupancy`,直接传车表 | 3 |
| `game/assets/scripts/core/level-data.ts` | `validateLevel` 三条新规则 | 4 |
| `game/assets/scripts/core/level-gen.ts` | 松弛打包、双朝向剥离、`LOT` 取代 `GRID_COLS`/`GRID_ROWS` | 5 |
| `tools/gen-levels.ts` | 读 `level.lot.cars` | 5 |
| `game/assets/resources/levels/level-*.json` | 重新生成(Task 5 一次,Task 7 一次) | 5, 7 |
| `game/assets/scripts/view/board-layout.ts` | **新建**,取代 `grid-layout.ts`:板坐标 → 世界坐标的纯缩放 + `carSize(cap)` | 6 |
| `game/assets/scripts/view/grid-layout.ts` | **删除** | 6 |
| `game/assets/scripts/view/grid-view.ts` | 按 `angle` 摆放旋转;`pickCar` 改成 OBB 命中 | 6 |
| `game/assets/scripts/view/car-builder.ts` | 删 `orientAngle`/`sharedCarScale`/`measureModels`/`FILL`;`buildCar` 收 `angle` | 6 |
| `game/assets/scripts/view/scene-stage.ts` | `lotHeight`/`lotWidth` 的参数改名 | 6 |
| `game/assets/scripts/view/GameController.ts` | 删 `DIR_VEC`,加 `headingVec`;`routeToSlot` 泛化;`lotRect` | 6 |
| `tools/check-car-models.mjs` | 新增 `CAP_BOX` 一致性校验 | 8 |
| `README.md` | 更新不变量清单 | 8 |

---

### Task 1: 几何基础 —— OBB、最小平移向量、场地内判定

**Files:**
- Create: `game/assets/scripts/core/geometry.ts`
- Test: `logic/tests/geometry.test.ts`

**Interfaces:**
- Consumes: 无(这是第一个任务)
- Produces:
  - `export interface OBB { x: number; y: number; angle: number; len: number; wid: number }`
  - `export function obbAxes(o: OBB): { ux: number; uy: number; vx: number; vy: number }`
  - `export function obbCorners(o: OBB): Array<[number, number]>`
  - `export function inflate(o: OBB, d: number): OBB`
  - `export function overlapMTV(a: OBB, b: OBB): { x: number; y: number } | null`
  - `export function insideRect(o: OBB, w: number, h: number): boolean`

**背景**(实现者需要知道的):这个文件是纯几何,**不许** import `types.ts` 或任何别的 core 模块。`len` 沿 `angle` 方向,`wid` 垂直于它。矩形在 180° 旋转下和自己重合,后面的剥离逻辑依赖这一点。

- [ ] **Step 1: 写失败的测试**

创建 `logic/tests/geometry.test.ts`:

```ts
import {
  OBB, obbCorners, inflate, overlapMTV, insideRect,
} from '../../game/assets/scripts/core/geometry';

const box = (over: Partial<OBB>): OBB => ({ x: 0, y: 0, angle: 0, len: 2, wid: 1, ...over });

test('a box lists its four corners around its heading', () => {
  const cs = obbCorners(box({}));
  expect(cs).toHaveLength(4);
  const xs = cs.map((c) => c[0]).sort((a, b) => a - b);
  const ys = cs.map((c) => c[1]).sort((a, b) => a - b);
  expect(xs[0]).toBeCloseTo(-1, 6);
  expect(xs[3]).toBeCloseTo(1, 6);
  expect(ys[0]).toBeCloseTo(-0.5, 6);
  expect(ys[3]).toBeCloseTo(0.5, 6);
});

test('turning a box 90 degrees swaps which axis its length runs along', () => {
  const cs = obbCorners(box({ angle: 90 }));
  const xs = cs.map((c) => c[0]);
  const ys = cs.map((c) => c[1]);
  expect(Math.max(...xs)).toBeCloseTo(0.5, 6);
  expect(Math.max(...ys)).toBeCloseTo(1, 6);
});

test('inflate grows a box on every side, not just one', () => {
  const o = inflate(box({}), 0.25);
  expect(o.len).toBeCloseTo(2.5, 6);
  expect(o.wid).toBeCloseTo(1.5, 6);
});

test('two boxes that only touch are not overlapping', () => {
  // Half-lengths 1 and 1, so centres 2 apart leaves their faces flush.
  expect(overlapMTV(box({}), box({ x: 2 }))).toBeNull();
});

test('boxes clear of each other report no overlap', () => {
  expect(overlapMTV(box({}), box({ x: 2.5 }))).toBeNull();
  expect(overlapMTV(box({}), box({ y: 1.5 }))).toBeNull();
});

test('the push comes out along the axis that needs the least of it', () => {
  // Overlapping 0.5 along the length axis and 1.0 across, so it pushes along length.
  const mtv = overlapMTV(box({}), box({ x: 1.5 }));
  expect(mtv).not.toBeNull();
  expect(mtv!.x).toBeCloseTo(-0.5, 6);
  expect(mtv!.y).toBeCloseTo(0, 6);
});

test('two boxes in the same place are pushed apart across their width', () => {
  // Fully coincident: the length axis overlaps by 2, the width axis by 1. Width wins.
  const mtv = overlapMTV(box({}), box({}));
  expect(mtv).not.toBeNull();
  expect(Math.hypot(mtv!.x, mtv!.y)).toBeCloseTo(1, 6);
});

test('applying the push actually separates them', () => {
  const pairs: Array<[OBB, OBB]> = [
    [box({}), box({ x: 1.5 })],
    [box({}), box({ x: 1.2, y: 0.4, angle: 37 })],
    [box({ angle: 20 }), box({ x: 0.9, y: -0.6, angle: 115 })],
    [box({ angle: 45, len: 3, wid: 0.6 }), box({ x: 1.0, y: 1.0, angle: 45 })],
  ];
  for (const [a, b] of pairs) {
    const mtv = overlapMTV(a, b);
    expect(mtv).not.toBeNull();
    // Nudged a hair past the push so the result is strictly apart, not flush.
    const moved = { ...a, x: a.x + mtv!.x * 1.001, y: a.y + mtv!.y * 1.001 };
    expect(overlapMTV(moved, b)).toBeNull();
  }
});

test('a box well inside the lot is inside it', () => {
  expect(insideRect(box({ x: 3.4 }), 9, 6)).toBe(true);
});

test('a box hanging over the edge is not inside', () => {
  expect(insideRect(box({ x: 3.6 }), 9, 6)).toBe(false);
});

test('turning a box can push it out of a lot it fitted in', () => {
  // Along the lot: half-width 0.5 clears y = 3. Turned 45 degrees it reaches 1.06.
  expect(insideRect(box({ y: 2.4 }), 9, 6)).toBe(true);
  expect(insideRect(box({ y: 2.4, angle: 45 }), 9, 6)).toBe(false);
});
```

- [ ] **Step 2: 跑测试,确认它失败**

Run: `cd logic && npx jest tests/geometry.test.ts`
Expected: FAIL —— `Cannot find module '../../game/assets/scripts/core/geometry'`

- [ ] **Step 3: 写实现**

创建 `game/assets/scripts/core/geometry.ts`:

```ts
/**
 * Oriented boxes in 2D, and the two questions the lot asks of them: are these two
 * overlapping (and which way do I push them apart), and how far can this one travel
 * before it hits that one.
 *
 * Deliberately ignorant of cars, levels and capacities -- it takes boxes and numbers.
 * That is what makes it testable without building a level, and it is the only file in
 * core with no domain knowledge at all.
 */

/**
 * A box that knows which way it is facing. `len` runs ALONG `angle`, `wid` across it.
 *
 * Note a rectangle is symmetric under a half turn: `angle` and `angle + 180` describe
 * the same region. The packer relies on that -- flipping which way a car drives out
 * does not move the space it occupies.
 */
export interface OBB {
    x: number;
    y: number;
    /** Degrees. 0 = +X, counter-clockwise. */
    angle: number;
    len: number;
    wid: number;
}

const DEG = Math.PI / 180;

/** Unit vectors along the box's own length (u) and width (v) axes. */
export function obbAxes(o: OBB): { ux: number; uy: number; vx: number; vy: number } {
    const c = Math.cos(o.angle * DEG);
    const s = Math.sin(o.angle * DEG);
    return { ux: c, uy: s, vx: -s, vy: c };
}

/** The four corners, in order around the box. */
export function obbCorners(o: OBB): Array<[number, number]> {
    const { ux, uy, vx, vy } = obbAxes(o);
    const hl = o.len / 2;
    const hw = o.wid / 2;
    return [
        [o.x + ux * hl + vx * hw, o.y + uy * hl + vy * hw],
        [o.x - ux * hl + vx * hw, o.y - uy * hl + vy * hw],
        [o.x - ux * hl - vx * hw, o.y - uy * hl - vy * hw],
        [o.x + ux * hl - vx * hw, o.y + uy * hl - vy * hw],
    ];
}

/** `o` grown by `d` on every side. How a required clearance is expressed. */
export function inflate(o: OBB, d: number): OBB {
    return { ...o, len: o.len + 2 * d, wid: o.wid + 2 * d };
}

/** `o`'s shadow on a unit axis, as [min, max]. */
function project(o: OBB, ax: number, ay: number): [number, number] {
    const centre = o.x * ax + o.y * ay;
    const { ux, uy, vx, vy } = obbAxes(o);
    const radius = Math.abs((ux * ax + uy * ay) * o.len / 2)
        + Math.abs((vx * ax + vy * ay) * o.wid / 2);
    return [centre - radius, centre + radius];
}

/**
 * The axes worth testing for a pair of boxes: each box's own two. In 2D with pure
 * translation that is the complete set -- no cross-product axes, unlike 3D.
 */
function axesOf(a: OBB, b: OBB): Array<[number, number]> {
    const A = obbAxes(a);
    const B = obbAxes(b);
    return [[A.ux, A.uy], [A.vx, A.vy], [B.ux, B.uy], [B.vx, B.vy]];
}

/**
 * The shortest shove that gets `a` clear of `b`, pointing away from `b`; null when
 * they are already apart. Boxes whose faces are exactly flush count as apart, which
 * is what lets a clearance of exactly CLEARANCE be legal rather than a rounding coin
 * flip.
 */
export function overlapMTV(a: OBB, b: OBB): { x: number; y: number } | null {
    let least = Infinity;
    let px = 0;
    let py = 0;
    for (const [ax, ay] of axesOf(a, b)) {
        const [alo, ahi] = project(a, ax, ay);
        const [blo, bhi] = project(b, ax, ay);
        if (ahi <= blo || bhi <= alo) return null;
        // Two ways off this axis; take the nearer edge.
        const forward = bhi - alo;
        const backward = ahi - blo;
        const push = forward < backward ? forward : -backward;
        if (Math.abs(push) < least) {
            least = Math.abs(push);
            px = ax * push;
            py = ay * push;
        }
    }
    return { x: px, y: py };
}

/** Whether `o` lies wholly inside the `w` x `h` rectangle centred on the origin. */
export function insideRect(o: OBB, w: number, h: number): boolean {
    const hw = w / 2 + 1e-9;
    const hh = h / 2 + 1e-9;
    for (const [x, y] of obbCorners(o)) {
        if (Math.abs(x) > hw || Math.abs(y) > hh) return false;
    }
    return true;
}
```

- [ ] **Step 4: 跑测试,确认全绿**

Run: `cd logic && npx jest tests/geometry.test.ts`
Expected: PASS,11 个用例

- [ ] **Step 5: 跑两道闸**

Run: `cd logic && npm test`
Expected: PASS,152 + 11 = 163 个用例(新文件是纯新增,老的一个都不该动)

Run: `cd logic && npm run typecheck:view`
Expected: 无输出,退出码 0

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/core/geometry.ts logic/tests/geometry.test.ts
git commit -m "$(cat <<'EOF'
feat(core): oriented boxes, and which way to push two of them apart

First half of the geometry the lot needs before a car can be parked at an
angle. Deliberately knows nothing about cars: it takes boxes and numbers,
so it can be tested without building a level.

Flush faces count as apart, not overlapping. That is what makes a
clearance of exactly the required distance legal instead of a rounding
coin flip.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 几何 —— 扫掠分离轴测试

**Files:**
- Modify: `game/assets/scripts/core/geometry.ts`(追加 `sweepHit`)
- Test: `logic/tests/geometry.test.ts`(追加用例)

**Interfaces:**
- Consumes: Task 1 的 `OBB`、`project`、`axesOf`、`overlapMTV`
- Produces: `export function sweepHit(a: OBB, b: OBB, dx: number, dy: number): number | null`

**背景**:这是整个里程碑最该认真测的一块。语义:`a` 沿单位向量 `(dx, dy)` 平移,走多远会碰到 `b`;碰不到返回 `null`;出发时就重叠返回 `0`;**反方向的碰撞不算**(车不会倒着撞上身后的车)。

算法:对每条候选轴,两个盒子的投影是两个区间,相对速度在该轴上的分量决定这两个区间「从多远开始重叠、到多远结束重叠」。四条轴的窗口取交集,交集的下界就是首次接触距离。

- [ ] **Step 1: 写失败的测试**

在 `logic/tests/geometry.test.ts` 末尾追加(并把 `sweepHit` 加进顶部的 import):

```ts
test('a box head-on into another stops at the gap between them', () => {
  // Half-lengths 1 and 1, centres 3 apart: 1 of clear board between the faces.
  expect(sweepHit(box({}), box({ x: 3 }), 1, 0)).toBeCloseTo(1, 6);
});

test('a box passing beside another never touches it', () => {
  // Half-widths 0.5 and 0.5, centres 1.2 apart across: 0.2 of daylight.
  expect(sweepHit(box({}), box({ x: 3, y: 1.2 }), 1, 0)).toBeNull();
});

test('a blocker behind the mover is not a blocker', () => {
  expect(sweepHit(box({}), box({ x: -3 }), 1, 0)).toBeNull();
});

test('boxes already overlapping report zero distance', () => {
  expect(sweepHit(box({}), box({ x: 1 }), 1, 0)).toBe(0);
});

test('a long box parallel alongside is never hit', () => {
  expect(sweepHit(box({}), box({ y: 1.2, len: 8 }), 1, 0)).toBeNull();
});

test('a gap one hair too narrow blocks, and one hair wider does not', () => {
  // Mover half-width 0.5; blocker half-width 0.5. Inner face at y - 0.5.
  expect(sweepHit(box({}), box({ x: 3, y: 0.9 }), 1, 0)).toBeCloseTo(1, 6);
  expect(sweepHit(box({}), box({ x: 3, y: 1.1 }), 1, 0)).toBeNull();
});

test('a box driving on the diagonal stops at the gap measured along its heading', () => {
  const d = Math.SQRT1_2;
  // Both facing 45 degrees; centres 2 * sqrt(2) apart along that same line,
  // minus the two half-lengths of 1.
  const hit = sweepHit(box({ angle: 45 }), box({ x: 2, y: 2, angle: 45 }), d, d);
  expect(hit).toBeCloseTo(2 * Math.SQRT2 - 2, 6);
});

test('the hit distance is exactly where the two boxes start to overlap', () => {
  // Ties sweepHit to overlapMTV: a hair short of the hit they are apart, a hair
  // past it they are not. Covers the rotated cases no hand-computed number does.
  const cases: Array<[OBB, OBB, number, number]> = [
    [box({}), box({ x: 3, angle: 45 }), 1, 0],
    [box({ angle: 30 }), box({ x: 2.5, y: 0.8, angle: 100 }), 1, 0],
    [box({ angle: 0, len: 3, wid: 0.6 }), box({ x: 2, y: 1.4, angle: 65 }), 0.6, 0.8],
    [box({ angle: 200 }), box({ x: -2.2, y: -1.1, angle: 15 }), -0.8, -0.6],
  ];
  for (const [a, b, dx, dy] of cases) {
    const t = sweepHit(a, b, dx, dy);
    expect(t).not.toBeNull();
    const at = (k: number): OBB => ({ ...a, x: a.x + dx * k, y: a.y + dy * k });
    expect(overlapMTV(at(t! - 0.01), b)).toBeNull();
    expect(overlapMTV(at(t! + 0.01), b)).not.toBeNull();
  }
});

test('a box moving away from one it overlaps still reports zero, not null', () => {
  // The mover is told how far it may go before contact, and it is already in contact.
  expect(sweepHit(box({}), box({ x: 1 }), -1, 0)).toBe(0);
});
```

- [ ] **Step 2: 跑测试,确认它失败**

Run: `cd logic && npx jest tests/geometry.test.ts`
Expected: FAIL —— TS2305 `Module '.../geometry' has no exported member 'sweepHit'`

- [ ] **Step 3: 写实现**

在 `geometry.ts` 末尾追加:

```ts
/**
 * How far `a` may travel along the unit vector (dx, dy) before it touches `b`; null
 * when it never does, 0 when they are already in contact.
 *
 * Swept separating-axis test. On each candidate axis the two boxes project to
 * intervals, and the mover's speed along that axis says at what DISTANCE those
 * intervals start and stop overlapping. The boxes are in contact exactly over the
 * intersection of the four windows, so the answer is the largest window start --
 * provided it is not past the smallest window end.
 *
 * Two behaviours worth naming, because callers depend on both:
 *  - contact strictly behind the mover reports null, not a negative distance. A car
 *    does not reverse into the car behind it, so a blocker back there is not a
 *    blocker. This falls out of clamping the window start at 0.
 *  - boxes that already overlap report 0 regardless of heading. The caller asked how
 *    far it may go before contact, and the answer is nowhere.
 */
export function sweepHit(a: OBB, b: OBB, dx: number, dy: number): number | null {
    let enter = 0;
    let exit = Infinity;
    for (const [ax, ay] of axesOf(a, b)) {
        const [alo, ahi] = project(a, ax, ay);
        const [blo, bhi] = project(b, ax, ay);
        const speed = dx * ax + dy * ay;
        if (Math.abs(speed) < 1e-12) {
            // Nothing closes on this axis. Apart here means apart forever.
            if (ahi <= blo || bhi <= alo) return null;
            continue;
        }
        const t1 = (blo - ahi) / speed;
        const t2 = (bhi - alo) / speed;
        if (t1 < t2) {
            if (t1 > enter) enter = t1;
            if (t2 < exit) exit = t2;
        } else {
            if (t2 > enter) enter = t2;
            if (t1 < exit) exit = t1;
        }
        if (enter > exit) return null;
    }
    return enter <= exit ? enter : null;
}
```

- [ ] **Step 4: 跑测试,确认全绿**

Run: `cd logic && npx jest tests/geometry.test.ts`
Expected: PASS,20 个用例

- [ ] **Step 5: 跑两道闸**

Run: `cd logic && npm test`
Expected: PASS,172 个用例

Run: `cd logic && npm run typecheck:view`
Expected: 无输出,退出码 0

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/core/geometry.ts logic/tests/geometry.test.ts
git commit -m "$(cat <<'EOF'
feat(core): how far a box can travel before it hits another

Swept separating-axis test: on each candidate axis the two projections
say at what distance they start and stop overlapping, and contact is the
intersection of those windows.

Contact behind the mover reports null rather than a negative distance --
a car does not reverse into whatever is behind it, so a blocker back
there is not a blocker.

The last test ties this to overlapMTV rather than to hand-computed
numbers: a hair short of the reported distance the boxes are apart, a
hair past it they are not. That is the only assertion that covers the
rotated cases, where the first contact is corner-to-face and no
axis-aligned arithmetic gives the right answer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: core 换型 —— 连续坐标、朝向角、新的挡路判定

**Files:**
- Modify: `game/assets/scripts/core/types.ts`
- Modify: `game/assets/scripts/core/move-solver.ts`
- Modify: `game/assets/scripts/core/grid-system.ts`
- Modify: `game/assets/scripts/core/game-core.ts:36`
- Modify: `game/assets/scripts/core/solvability.ts`
- Modify: `game/assets/scripts/core/level-data.ts:11`(只改 `level.grid.cars` → `level.lot.cars`)
- Test: `logic/tests/move-solver.test.ts`(重写)
- Test: `logic/tests/grid-system.test.ts`(重写)
- Test: `logic/tests/solvability.test.ts`、`logic/tests/integration.test.ts`、`logic/tests/level-data.test.ts`、`logic/tests/coverage-m2.test.ts`、`logic/tests/game-core.test.ts`(改 fixture)

**Interfaces:**
- Consumes: `OBB`、`inflate`、`insideRect`、`sweepHit`、`overlapMTV`(Task 1/2)
- Produces:
  - `export interface CarSpec { id: number; x: number; y: number; angle: number; color: string; cap: Cap }`
  - `export interface Box { len: number; wid: number }`
  - `export interface Lot { w: number; h: number }`
  - `export const CAP_BOX: Record<Cap, Box>`、`export const CAR_SCALE: number`、`export const CLEARANCE: number`
  - `LevelData.lot: { w: number; h: number; cars: CarSpec[] }`(原 `grid` 字段)
  - `export function carBox(car: CarSpec): OBB`
  - `export function heading(car: CarSpec): { dx: number; dy: number }`
  - `export function pathClear(car: CarSpec, cars: CarSpec[], lot: Lot): boolean`
  - `export function firstBlocker(car: CarSpec, cars: CarSpec[], lot: Lot): Blockage | null`
  - `export interface Blockage { carId: number; gap: number }`(`gap` 单位从「格」变成「板单位」)
  - `new GridSystem(lot: Lot, cars: CarSpec[])`
- 删除:`Dir` 类型、`footprint()`、`move-solver` 里的 `STEP`、`GridSystem.occupiedExcluding`、`solvability` 里的 `occupancy()`

**注意两件事:**

1. `pathClear` 从此**由 `firstBlocker` 推导**,不再是第二份实现。今天两个函数各自实现同一条规则,它们能不一致;合并掉这个可能性。
2. `pathClear` / `firstBlocker` 现在收**完整车表**(可以包含自己,按 `id` 跳过),不再收 `Set<string>`。调用方因此不必再自己算「除了我以外的占用」。

- [ ] **Step 1: 改 `types.ts`**

- 删掉 `export type Dir = 'up' | 'down' | 'left' | 'right';`
- `CarSpec` 换成:

```ts
/**
 * One car in the lot. Continuous coordinates, not grid cells: `x`/`y` is the centre of
 * the body and `angle` is the direction it drives out, in degrees, 0 = +X,
 * counter-clockwise, normalised to [0, 360).
 *
 * There is no width or height field. A car's footprint is its MODEL's size (see
 * CAP_BOX) at that angle, which is what lets three vehicle sizes read as three sizes
 * instead of as one-cell and two-cell.
 */
export interface CarSpec {
  id: number;
  x: number;
  y: number;
  angle: number;
  color: string;
  cap: Cap;
}

/** A body's own dimensions: `len` along its heading, `wid` across it. Board units. */
export interface Box { len: number; wid: number }

/** The lot's extent in board units. Origin is its centre, +Y up. */
export interface Lot { w: number; h: number }

/**
 * Each capacity's body size in board units, where one board unit is the pitch the old
 * grid used (0.7533 world units). The numbers are the three glb models' measured AABBs
 * divided by that pitch -- see `tools/check-car-models.mjs`, which prints them and now
 * fails the build if they drift from this table.
 *
 * This table is the SOURCE of the drawn size, which is the opposite of how it used to
 * work: a model AABB was fitted to a grid cell and the size fell out of the fit. Do
 * not re-derive CAP_BOX from a model at runtime -- core cannot see models, and the two
 * directions together would be a circle.
 */
export const CAP_BOX: Record<Cap, Box> = {
  small: { len: 0.964, wid: 0.471 },
  medium: { len: 1.772, wid: 0.567 },
  big: { len: 1.949, wid: 0.620 },
};

/**
 * One factor on every car's size. The release valve for packing density: 36 cars at
 * CAP_BOX cover 49.5% of a 9x6 lot, which random rotated rectangles handle with room
 * to spare, so it starts at 1. Turn it down only if `pack` cannot seat all 36.
 */
export const CAR_SCALE = 1.0;

/**
 * The least board a car must have around it, in board units. Used in TWO places on
 * purpose -- the packer keeps cars this far apart, and the lane check grows the moving
 * car by it -- so that the rule reads: a gap you can see is closed IS closed.
 *
 * 0.04 is today's TIGHTEST gap (a small car nose to tail: pitch 1 minus body 0.964),
 * not the average. M7 spent several rounds tightening these gaps and this must not
 * quietly give that back.
 */
export const CLEARANCE = 0.04;
```

- `LevelData` 的 `grid` 字段换成 `lot`:

```ts
  lot: { w: number; h: number; cars: CarSpec[] };
```

- [ ] **Step 2: 改 `move-solver.ts`**

整个文件换成:

```ts
import { inflate, OBB, sweepHit } from './geometry';
import { CAP_BOX, CarSpec, CAR_SCALE, CLEARANCE, Lot } from './types';

/** The oriented box a car occupies: its model's size at its own heading. */
export function carBox(car: CarSpec): OBB {
    const b = CAP_BOX[car.cap];
    return {
        x: car.x,
        y: car.y,
        angle: car.angle,
        len: b.len * CAR_SCALE,
        wid: b.wid * CAR_SCALE,
    };
}

/** Unit vector a car drives along. */
export function heading(car: CarSpec): { dx: number; dy: number } {
    const r = car.angle * Math.PI / 180;
    return { dx: Math.cos(r), dy: Math.sin(r) };
}

/** The car in `car`'s way, and how far it can go before touching it. */
export interface Blockage {
    carId: number;
    /** Board units of clear board ahead; 0 when they are already touching. */
    gap: number;
}

/**
 * The nearest car blocking `car`'s exit, or null when it can drive out.
 *
 * The mover is grown by CLEARANCE before the sweep, so a lane too narrow to be worth
 * calling a lane is not one. `cars` may include `car` itself; it is skipped by id.
 *
 * There is no need to work out where the car leaves the lot. Every car is INSIDE the
 * lot, so any contact happens before the mover has covered the lot's diagonal plus one
 * car length; anything the sweep reports past that is arithmetic noise, not a car.
 */
export function firstBlocker(car: CarSpec, cars: CarSpec[], lot: Lot): Blockage | null {
    const box = inflate(carBox(car), CLEARANCE);
    const { dx, dy } = heading(car);
    const range = Math.hypot(lot.w, lot.h) + CAP_BOX.big.len * CAR_SCALE;
    let best: Blockage | null = null;
    for (const other of cars) {
        if (other.id === car.id) continue;
        const t = sweepHit(box, carBox(other), dx, dy);
        if (t === null || t > range) continue;
        if (!best || t < best.gap) best = { carId: other.id, gap: t };
    }
    return best;
}

/**
 * Whether the car can drive out. Derived from `firstBlocker` rather than implemented a
 * second time: the two used to be separate walks of the same rule, which is one rule
 * too many to keep in agreement.
 */
export function pathClear(car: CarSpec, cars: CarSpec[], lot: Lot): boolean {
    return firstBlocker(car, cars, lot) === null;
}
```

- [ ] **Step 3: 改 `grid-system.ts`**

```ts
import { CarSpec, Lot } from './types';
import { pathClear } from './move-solver';

export class GridSystem {
  lot: Lot;
  cars: Map<number, CarSpec>;

  constructor(lot: Lot, cars: CarSpec[]) {
    this.lot = { w: lot.w, h: lot.h };
    this.cars = new Map(cars.map((c) => [c.id, { ...c }]));
  }

  canExit(carId: number): boolean {
    const car = this.cars.get(carId);
    if (!car) return false;
    // pathClear skips the mover by id, so the whole list goes in as it stands.
    return pathClear(car, [...this.cars.values()], this.lot);
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

- [ ] **Step 4: 改 `game-core.ts` 和 `solvability.ts`**

`game-core.ts:36`:

```ts
    this.grid = new GridSystem({ w: level.lot.w, h: level.lot.h }, level.lot.cars);
```

`solvability.ts` —— 删掉 `occupancy()` 和它的 `footprint` import,`clearGrid` 换成:

```ts
function clearGrid(level: LevelData): { cleared: boolean; rounds: number; blocked: number } {
    const lot = { w: level.lot.w, h: level.lot.h };
    let remaining = level.lot.cars.slice();
    const blocked = remaining.filter((c) => !pathClear(c, remaining, lot)).length;

    let rounds = 0;
    while (remaining.length > 0) {
        const exitable = remaining.filter((c) => pathClear(c, remaining, lot));
        if (exitable.length === 0) return { cleared: false, rounds, blocked };
        const ids = new Set(exitable.map((c) => c.id));
        remaining = remaining.filter((c) => !ids.has(c.id));
        rounds++;
    }
    return { cleared: true, rounds, blocked };
}
```

`estimateDifficulty` 里两处 `level.grid.cars` → `level.lot.cars`。

`level-data.ts:11` 的 `level.grid.cars` → `level.lot.cars`。

- [ ] **Step 5: 重写 `move-solver.test.ts`**

```ts
import { carBox, heading, pathClear, firstBlocker } from '../../game/assets/scripts/core/move-solver';
import { CarSpec, CAP_BOX, CLEARANCE } from '../../game/assets/scripts/core/types';

const LOT = { w: 9, h: 6 };
const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 0, color: 'red', cap: 'small', ...over,
});

/** Where two nose-to-tail cars first touch, clearance included. */
const contact = (gapBetweenCentres: number): number =>
  gapBetweenCentres - (CAP_BOX.small.len + 2 * CLEARANCE) / 2 - CAP_BOX.small.len / 2;

test('a car box is its model size at its own heading', () => {
  const b = carBox(car({ x: 1, y: 2, angle: 90 }));
  expect(b.x).toBe(1);
  expect(b.y).toBe(2);
  expect(b.angle).toBe(90);
  expect(b.len).toBeCloseTo(CAP_BOX.small.len, 6);
  expect(b.wid).toBeCloseTo(CAP_BOX.small.wid, 6);
});

test('a big car has a bigger box than a small one', () => {
  expect(carBox(car({ cap: 'big' })).len).toBeGreaterThan(carBox(car({ cap: 'small' })).len);
});

test('heading points the way the angle says', () => {
  expect(heading(car({ angle: 0 })).dx).toBeCloseTo(1, 6);
  expect(heading(car({ angle: 90 })).dy).toBeCloseTo(1, 6);
  expect(heading(car({ angle: 180 })).dx).toBeCloseTo(-1, 6);
});

test('an empty lot lets a car out whatever way it points', () => {
  for (const angle of [0, 37, 90, 180, 254, 359]) {
    expect(pathClear(car({ angle }), [car({ angle })], LOT)).toBe(true);
  }
});

test('a car in the way blocks the lane', () => {
  const a = car({ id: 1, x: -2, y: 0, angle: 0 });
  const b = car({ id: 2, x: 1, y: 0, angle: 0 });
  expect(pathClear(a, [a, b], LOT)).toBe(false);
});

test('the same car pointing the other way is not blocked', () => {
  const a = car({ id: 1, x: -2, y: 0, angle: 180 });
  const b = car({ id: 2, x: 1, y: 0, angle: 0 });
  expect(pathClear(a, [a, b], LOT)).toBe(true);
});

test('a car far enough to the side does not block', () => {
  const a = car({ id: 1, x: -2, y: 0, angle: 0 });
  const b = car({ id: 2, x: 1, y: 1, angle: 0 });
  expect(pathClear(a, [a, b], LOT)).toBe(true);
});

test('the blocker report says which car and how much room is left', () => {
  const a = car({ id: 1, x: -2, y: 0, angle: 0 });
  const b = car({ id: 2, x: 1, y: 0, angle: 0 });
  const block = firstBlocker(a, [a, b], LOT);
  expect(block).not.toBeNull();
  expect(block!.carId).toBe(2);
  expect(block!.gap).toBeCloseTo(contact(3), 4);
});

test('the nearest blocker is the one reported', () => {
  const a = car({ id: 1, x: -3, y: 0, angle: 0 });
  const near = car({ id: 2, x: 0, y: 0, angle: 0 });
  const far = car({ id: 3, x: 2, y: 0, angle: 0 });
  expect(firstBlocker(a, [a, near, far], LOT)!.carId).toBe(2);
});

test('a lane narrower than the clearance is not a lane', () => {
  // Two cars leaving a slot exactly one small-car width wide: without the clearance
  // the mover would fit, with it it does not.
  const w = CAP_BOX.small.wid;
  const a = car({ id: 1, x: -3, y: 0, angle: 0 });
  const up = car({ id: 2, x: 0, y: w, angle: 0 });
  const down = car({ id: 3, x: 0, y: -w, angle: 0 });
  expect(pathClear(a, [a, up, down], LOT)).toBe(false);
});

test('a lane with the clearance to spare is a lane', () => {
  const w = CAP_BOX.small.wid + CLEARANCE + 0.02;
  const a = car({ id: 1, x: -3, y: 0, angle: 0 });
  const up = car({ id: 2, x: 0, y: w, angle: 0 });
  const down = car({ id: 3, x: 0, y: -w, angle: 0 });
  expect(pathClear(a, [a, up, down], LOT)).toBe(true);
});

test('a car does not block itself', () => {
  const a = car({ id: 1, x: 0, y: 0, angle: 0 });
  expect(firstBlocker(a, [a], LOT)).toBeNull();
});

test('a diagonal lane is checked along the diagonal, not along the axes', () => {
  // A blocker due east does not stand in a north-east lane.
  const a = car({ id: 1, x: -2, y: -2, angle: 45 });
  const east = car({ id: 2, x: 1, y: -2, angle: 0 });
  expect(pathClear(a, [a, east], LOT)).toBe(true);
  // One on the diagonal does.
  const ne = car({ id: 3, x: 0, y: 0, angle: 45 });
  expect(pathClear(a, [a, ne], LOT)).toBe(false);
});
```

- [ ] **Step 6: 重写 `grid-system.test.ts`**

```ts
import { GridSystem } from '../../game/assets/scripts/core/grid-system';
import { CarSpec } from '../../game/assets/scripts/core/types';

const LOT = { w: 9, h: 6 };
const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 0, color: 'red', cap: 'small', ...over,
});

test('a car with a clear path can exit', () => {
  const g = new GridSystem(LOT, [car({ id: 1, x: -2, y: 0, angle: 0 })]);
  expect(g.canExit(1)).toBe(true);
});

test('a car blocked by another cannot exit', () => {
  const g = new GridSystem(LOT, [
    car({ id: 1, x: -2, y: 0, angle: 0 }),
    car({ id: 2, x: 1, y: 0, angle: 0 }),
  ]);
  expect(g.canExit(1)).toBe(false);
});

test('removing the blocker frees the blocked car', () => {
  const g = new GridSystem(LOT, [
    car({ id: 1, x: -2, y: 0, angle: 0 }),
    car({ id: 2, x: 1, y: 0, angle: 0 }),
  ]);
  g.removeCar(2);
  expect(g.canExit(1)).toBe(true);
});

test('an unknown car cannot exit', () => {
  const g = new GridSystem(LOT, [car({ id: 1 })]);
  expect(g.canExit(99)).toBe(false);
});

test('isEmpty is true only after all cars removed', () => {
  const g = new GridSystem(LOT, [car({ id: 1 }), car({ id: 2, x: 2 })]);
  expect(g.isEmpty()).toBe(false);
  g.removeCar(1);
  g.removeCar(2);
  expect(g.isEmpty()).toBe(true);
});

test('movableCarIds lists only the cars that can get out', () => {
  const g = new GridSystem(LOT, [
    car({ id: 1, x: -2, y: 0, angle: 0 }),
    car({ id: 2, x: 1, y: 0, angle: 0 }),
    car({ id: 3, x: -2, y: 2, angle: 0 }),
  ]);
  expect(g.movableCarIds().sort()).toEqual([2, 3]);
});

test('the constructor copies its cars so the caller cannot mutate the lot', () => {
  const cars = [car({ id: 1, x: -2 })];
  const g = new GridSystem(LOT, cars);
  cars[0].x = 99;
  expect(g.cars.get(1)!.x).toBe(-2);
});
```

- [ ] **Step 7: 改其余测试的 fixture**

以下文件里的 `grid: { cols, rows, cars: [...] }` 全部换成 `lot: { w, h, cars: [...] }`,车条目从 `{ id, x, y, w, h, dir, color, cap }` 换成 `{ id, x, y, angle, color, cap }`:

- `logic/tests/integration.test.ts` —— 原来「车 1 在上、车 2 在下被挡」。新写法:`lot: { w: 4, h: 4, cars: [{ id: 1, x: 0, y: 1, angle: 90, color: 'red', cap: 'small' }, { id: 2, x: 0, y: -1, angle: 90, color: 'blue', cap: 'medium' }] }`。车 2 朝上(90°)被车 1 挡住。
- `logic/tests/solvability.test.ts` —— 三个 fixture:
  - 「可解」:同上的一上一下,`angle: 90` 两辆。
  - 「互锁不可解」:`cars: [{ id: 1, x: -0.6, y: 0, angle: 0, ... }, { id: 2, x: 0.6, y: 0, angle: 180, ... }]`,两辆都朝对方开,场地 `{ w: 4, h: 4 }`。**验证这个 fixture 真的互锁**:车 1 朝 +X 撞车 2,车 2 朝 −X 撞车 1。
  - 「两辆都能出」:`cars: [{ id: 1, x: -1, y: 0, angle: 90 }, { id: 2, x: 1, y: 0, angle: 90 }]`,并排朝上。
- `logic/tests/level-data.test.ts`、`logic/tests/coverage-m2.test.ts`、`logic/tests/game-core.test.ts` —— 同样机械替换。这些用例断言的是颜色配平、死局判定、上车流程,**不是几何**,所以只要 fixture 合法(车在场内、互不重叠)、被挡关系与原来一致,断言一个字都不用改。
- `logic/tests/level-gen.test.ts` 本任务**整个停用**:

```bash
git mv logic/tests/level-gen.test.ts logic/tests/level-gen.test.ts.disabled
```

  理由要说清楚:生成器的打包模型正处在被替换的中途,它此刻既不该按格子的标准判、也还没有新标准可判。**用改名而不是 `test.skip`**,因为一个被 skip 的文件可以静静地留在那里几个月,一个 `.disabled` 的文件在 diff 里赖不掉。Task 5 第一步就把它改回来。

> **本任务对 `level-gen.ts` 的改动,到「能编译且 `isSolvable` 仍然成立」为止。** `pack` / `peel` 的格子逻辑原样保留(`Piece` 保留 `w`/`h`,`Dir` 在 `types.ts` 删掉了所以在 `level-gen.ts` 里本地声明一个),只把它们与新碰撞模型的接缝补上:
>
> ```ts
> /** Local to the generator until Task 5 removes it: core no longer has a Dir type. */
> type Dir = 'up' | 'down' | 'left' | 'right';
> const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
>
> export const LOT: Lot = { w: 9, h: 6 };
>
> /** Grid cell (col, row, row 0 at the top) to board coordinates (centre origin, +Y up). */
> function toBoard(p: Piece): { x: number; y: number } {
>     return { x: p.x + p.w / 2 - LOT.w / 2, y: LOT.h / 2 - (p.y + p.h / 2) };
> }
>
> function dirAngle(dir: Dir): number {
>     return dir === 'up' ? 90 : dir === 'down' ? 270 : dir === 'left' ? 180 : 0;
> }
>
> // TEMPORARY (Task 5 replaces pack/peel/scatter wholesale): the grid packer feeding the
> // new collision model. Cars land on cell centres at right angles -- the old game in new
> // coordinates -- which is exactly what this task should produce: it changes how
> // blocking is COMPUTED and nothing about how the lot is filled.
> function peel(rng: () => number, pieces: Piece[]): { piece: Piece; dir: Dir }[] {
>     const remaining = pieces.slice();
>     const order: { piece: Piece; dir: Dir }[] = [];
>     while (remaining.length > 0) {
>         const probes: CarSpec[] = remaining.map((p, i) => ({
>             id: i + 1, ...toBoard(p), angle: 0, color: '', cap: p.cap,
>         }));
>         const moves: { i: number; dir: Dir }[] = [];
>         for (let i = 0; i < remaining.length; i++) {
>             for (const dir of dirsFor(remaining[i])) {
>                 if (pathClear({ ...probes[i], angle: dirAngle(dir) }, probes, LOT)) {
>                     moves.push({ i, dir });
>                 }
>             }
>         }
>         if (moves.length === 0) break;
>         const move = pick(rng, moves);
>         order.push({ piece: remaining.splice(move.i, 1)[0], dir: move.dir });
>     }
>     return order;
> }
>
> function scatter(rng: () => number, p: GenParams): CarSpec[] {
>     return peel(rng, pack(rng, p.cars)).map(({ piece, dir }, i) => ({
>         id: i + 1, ...toBoard(piece), angle: dirAngle(dir),
>         color: PALETTE[i % p.colors], cap: piece.cap,
>     }));
> }
> ```
>
> `assemble` 里 `grid: { cols: GRID_COLS, rows: GRID_ROWS, cars }` → `lot: { w: LOT.w, h: LOT.h, cars }`。`GRID_COLS`/`GRID_ROWS` 保留(`pack` 还在用),Task 5 删。
>
> **一个已知的、刻意接受的后果**:格心摆放的小车头尾间距是 1 板单位减去 0.964 的车身 = **0.036,比 `CLEARANCE = 0.04` 小一点点**。所以 Task 4 加上间隙校验之后,这个中间态生成器的输出会被判不合法 —— 这正是 `level-gen.test.ts` 必须停用到 Task 5 的第二个理由。**不要**为了迁就它去调小 `CLEARANCE`;`game/assets/resources/levels/` 下的十个 JSON 本任务也一个都不重新生成(它们此刻是旧格式,游戏跑不起来 —— 这是 M8-2 原子性的代价,spec 第八节写明了)。

- [ ] **Step 8: 跑 jest,确认全绿**

Run: `cd logic && npm test`
Expected: PASS。`move-solver.test.ts` 从 8 条变成 13 条,`grid-system.test.ts` 从 4 条变成 7 条,`level-gen.test.ts` 的全部用例本任务缺席。**把跑出来的总数记进 commit message** —— Task 5 把生成器测试改回来之后,总数必须重新盖过这个数。

任何测试挂了都不要用放宽断言的方式解决:这些用例断言的是颜色配平、死局判定、上车流程,几何换型不该动它们中的任何一条。挂了就是 fixture 转换错了(车跑到场外、两辆车叠在一起、或者被挡关系与原来相反)。

- [ ] **Step 9: 确认 `typecheck:view` 是红的,并记下错误**

Run: `cd logic && npm run typecheck:view`
Expected: **FAIL**。预期错误集中在四处:`grid-view.ts` / `car-builder.ts` 找不到 `Dir`,`GameController.ts` 的 `DIR_VEC` 与 `level.grid`,`grid-layout.ts` 无错。把错误条数记进 commit message,Task 6 结束时必须归零。

- [ ] **Step 10: 提交**

```bash
git add game/assets/scripts/core logic/tests
git commit -m "$(cat <<'EOF'
feat(core)!: cars carry a heading, not one of four directions

CarSpec loses w/h/dir and gains angle; positions become continuous board
units with the lot's centre at the origin and +Y up. A car's footprint is
now its model's size (CAP_BOX) at its own heading, which is why three
vehicle sizes can read as three sizes rather than as one-cell and
two-cell.

pathClear is derived from firstBlocker instead of walking the same rule a
second time -- two implementations of one rule is one too many to keep in
agreement. Both now take the whole car list and skip the mover by id, so
callers no longer compute "everyone but me" themselves.

CLEARANCE is used by the lane check as well as (in Task 5) the packer, so
that the rule reads: a gap you can see is closed IS closed. 0.04 is
today's tightest gap, not its average -- M7 spent several rounds
tightening these and this must not quietly give it back.

typecheck:view is RED after this commit and stays red until the view
catches up. jest is green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `validateLevel` —— 三条几何规则

**Files:**
- Modify: `game/assets/scripts/core/level-data.ts`
- Test: `logic/tests/level-data.test.ts`

**Interfaces:**
- Consumes: `carBox`(Task 3)、`insideRect`/`overlapMTV`/`inflate`(Task 1)、`CLEARANCE`(Task 3)
- Produces: `validateLevel` 的返回值多三类错误字符串;签名不变

**为什么先做校验、后做生成器**:格子天然保证不重叠、天然在界内,这两条约束以前不需要检查。松弛算法**不保证**收敛,它的输出可信不可信只有校验说了算。所以先把裁判立起来。

- [ ] **Step 1: 写失败的测试**

在 `logic/tests/level-data.test.ts` 里加(顶部按需补 import):

```ts
const okLevel = (cars: CarSpec[]): LevelData => ({
  id: 1,
  lot: { w: 9, h: 6, cars },
  parking: { slots: 2, unlocked: 1 },
  loop: {
    capacity: 28,
    boardIndex: 14,
    queue: [{ color: 'red', count: cars.length * 16 }],
  },
  powerups: { refresh: 0, hardClear: 0, magnet: 0 },
});
const c = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 0, color: 'red', cap: 'small', ...over,
});

test('a level whose cars sit apart and inside the lot has no geometry errors', () => {
  const errs = validateLevel(okLevel([c({ id: 1, x: -2 }), c({ id: 2, x: 2 })]));
  expect(errs.filter((e) => /lot|clearance|angle/.test(e))).toEqual([]);
});

test('a car hanging over the lot edge is an error', () => {
  const errs = validateLevel(okLevel([c({ id: 1, x: 4.4 })]));
  expect(errs.some((e) => e.includes('car 1') && e.includes('lot'))).toBe(true);
});

test('a car turned until it pokes out of the lot is an error', () => {
  // Lengthways it clears the top edge; broadside it does not.
  expect(validateLevel(okLevel([c({ id: 1, cap: 'big', y: 2.6, angle: 0 })]))
    .some((e) => e.includes('lot'))).toBe(false);
  expect(validateLevel(okLevel([c({ id: 1, cap: 'big', y: 2.6, angle: 90 })]))
    .some((e) => e.includes('lot'))).toBe(true);
});

test('two cars closer than the clearance is an error', () => {
  // Centres 0.98 apart: bodies 0.964 long, so 0.016 of gap -- under CLEARANCE.
  const errs = validateLevel(okLevel([c({ id: 1, x: -0.49 }), c({ id: 2, x: 0.49 })]));
  expect(errs.some((e) => e.includes('cars 1 and 2'))).toBe(true);
});

test('two cars exactly the clearance apart is not an error', () => {
  const d = (0.964 + 0.04) / 2;
  const errs = validateLevel(okLevel([c({ id: 1, x: -d }), c({ id: 2, x: d })]));
  expect(errs.some((e) => e.includes('clearance'))).toBe(false);
});

test('a non-finite angle is an error and does not crash the rest of the check', () => {
  const errs = validateLevel(okLevel([c({ id: 1, angle: NaN }), c({ id: 2, x: 3 })]));
  expect(errs.some((e) => e.includes('car 1') && e.includes('angle'))).toBe(true);
});
```

- [ ] **Step 2: 跑测试,确认它失败**

Run: `cd logic && npx jest tests/level-data.test.ts`
Expected: FAIL —— 「a car hanging over the lot edge」等用例得到空错误表

- [ ] **Step 3: 写实现**

在 `level-data.ts` 的 `validateLevel` 里,`unlocked > slots` 那段**之前**插入:

```ts
  // Geometry. The old grid made both of these true by construction -- an integer cell
  // is inside the lot and two cars cannot share one. Free placement makes them things
  // that have to be checked, and the relaxation packer's output is only trustworthy
  // because this runs over it.
  const cars = level.lot.cars;
  for (const car of cars) {
    if (!Number.isFinite(car.angle)) {
      errors.push(`car ${car.id}: angle ${car.angle} is not a finite number`);
      continue;
    }
    if (!insideRect(carBox(car), level.lot.w, level.lot.h)) {
      errors.push(`car ${car.id} does not fit inside the lot`);
    }
  }
  // Half the clearance on each of a pair, so the two together owe the full CLEARANCE.
  const pad = CLEARANCE / 2;
  for (let i = 0; i < cars.length; i++) {
    if (!Number.isFinite(cars[i].angle)) continue;
    for (let j = i + 1; j < cars.length; j++) {
      if (!Number.isFinite(cars[j].angle)) continue;
      const hit = overlapMTV(inflate(carBox(cars[i]), pad), inflate(carBox(cars[j]), pad));
      if (hit) {
        errors.push(`cars ${cars[i].id} and ${cars[j].id} are closer than the clearance`);
      }
    }
  }
```

并在文件顶部补 import:

```ts
import { inflate, insideRect, overlapMTV } from './geometry';
import { carBox } from './move-solver';
import { CLEARANCE } from './types';
```

(`CLEARANCE` 加进现有那行 `types` 的 import。检查过没有循环依赖:`move-solver` 只 import `geometry` 和 `types`。)

- [ ] **Step 4: 跑测试,确认全绿**

Run: `cd logic && npx jest tests/level-data.test.ts`
Expected: PASS

Run: `cd logic && npm test`
Expected: PASS。若 `solvability.test.ts` 的「互锁」fixture 因为两辆车贴太近而被新规则报错,把它们的中心距拉到 `(0.964 + 0.04) / 2 * 2 = 1.004` 以上再重跑 —— fixture 要合法,断言不改。

- [ ] **Step 5: 确认 `typecheck:view` 仍是红的(错误条数应与 Task 3 相同)**

Run: `cd logic && npm run typecheck:view`
Expected: FAIL,与 Task 3 记录的同一批错误

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/core/level-data.ts logic/tests
git commit -m "$(cat <<'EOF'
feat(core): the level check now looks at where the cars actually are

Three rules the grid used to make true for free: every car inside the
lot, no two closer than the clearance, and a finite angle. An integer
cell could not hang over an edge and two cars could not share one, so
neither was ever worth checking.

The packer that arrives next does not guarantee it settles. This is the
only thing that decides whether its output can be trusted, which is why
it lands before the packer rather than after.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 生成器 —— 松弛打包、双朝向剥离、重新生成十关

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts`
- Modify: `tools/gen-levels.ts:40`
- Test: `logic/tests/level-gen.test.ts`
- Regenerate: `game/assets/resources/levels/level-1.json` … `level-10.json`

**Interfaces:**
- Consumes: `OBB`/`obbCorners`/`inflate`/`overlapMTV`(Task 1)、`carBox`/`pathClear`(Task 3)、`validateLevel`(Task 4)
- Produces: `export const LOT: Lot`;删除 `GRID_COLS`、`GRID_ROWS`、`DIRS`、`dirsFor`、`pieceCells`

**关键点(实现者容易踩的):**

1. **四舍五入必须发生在 `scatter` 里**,也就是在 `isSolvable`/`validateLevel` 看到这些车**之前**。若在写 JSON 时才舍入,校验通过的坐标和落盘的坐标就不是同一组数,而 0.0001 的差在 0.04 的间隙上是真的会翻盘的。
2. **`peel` 里 probe 的角度翻 180° 不改变它占的地方**——矩形在半周旋转下与自身重合。这就是「摆位定了、朝向还能二选一」成立的原因。
3. **`pack` 失败要返回空数组**,`generateLevel` 已有的 `if (cars.length < p.cars) continue;` 就是它的接收端。

- [ ] **Step 1: 改 `level-gen.ts`**

删掉 `GRID_COLS`、`GRID_ROWS`、`DIRS`、`dirsFor`、`pieceCells`,以及 Task 3 里那段临时的 `scatter`。加上:

```ts
/**
 * The lot, in board units -- one unit is the pitch the old 9x6 grid used, so the
 * camera framing and the view's board scale are untouched by this milestone.
 *
 * 36 cars at CAP_BOX cover 26.7 of these 54 square units, just under half. That is a
 * comfortable target for random rotated rectangles; the old grid's "88% occupied"
 * counted CELLS CLAIMED, and the difference between the two numbers is exactly the
 * ring of side air a square cell left around an oblong car.
 */
export const LOT: Lot = { w: 9, h: 6 };

/** Relaxation passes before an attempt is written off. */
const RELAX_ITERS = 60;
/** Share of cars whose angle is snapped to a right angle. See `pack`. */
const SNAP_SHARE = 0.25;

/** A car's placement before it has been told which way along its body it leaves. */
interface Piece { x: number; y: number; angle: number; cap: Cap }

/** The body a piece occupies. */
function pieceBox(p: Piece): OBB {
    const b = CAP_BOX[p.cap];
    return { x: p.x, y: p.y, angle: p.angle, len: b.len * CAR_SCALE, wid: b.wid * CAR_SCALE };
}

/**
 * The box the packer keeps clear. Half the clearance on each of a pair, so two
 * settled pieces owe each other the full CLEARANCE -- the same arithmetic
 * `validateLevel` uses, so the packer cannot settle on something the check rejects.
 */
function packBox(p: Piece): OBB {
    return inflate(pieceBox(p), CLEARANCE / 2);
}

/** Slide a piece until its box is back inside the lot. Mutates it. */
function clampInside(p: Piece): void {
    const hw = LOT.w / 2;
    const hh = LOT.h / 2;
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const [x, y] of obbCorners(packBox(p))) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    if (minX < -hw) p.x += -hw - minX;
    if (maxX > hw) p.x -= maxX - hw;
    if (minY < -hh) p.y += -hh - minY;
    if (maxY > hh) p.y -= maxY - hh;
}

/**
 * Fill the lot with `want` pieces, or return nothing at all.
 *
 * Scatter first and separate afterwards, rather than rejecting overlapping
 * placements. Reject-sampling is what the grid version did and it worked there only
 * because integer cells never overlap; with free angles the late placements are
 * rejected almost every time and the lot comes up six or eight cars short. Pushing
 * overlapping pairs apart along their minimum translation vector is about thirty
 * lines and is the difference between seating 36 and seating 28.
 *
 * Big bodies are placed first, so the hardest ones get the emptiest board.
 *
 * A quarter of the angles snap to a right angle. Uniformly random angles read as
 * uniform noise -- the reference the design came from has a tidy outer band, and
 * without some axis-aligned cars the eye has nothing to hold on to.
 */
function pack(rng: () => number, want: number): Piece[] {
    const caps: Cap[] = [];
    for (let i = 0; i < want; i++) caps.push(pickCap(rng));
    caps.sort((a, b) => CAP_BOX[b].len - CAP_BOX[a].len);

    const pieces: Piece[] = caps.map((cap) => {
        let angle = rng() * 360;
        if (rng() < SNAP_SHARE) angle = Math.round(angle / 90) * 90;
        const p: Piece = { x: (rng() - 0.5) * LOT.w, y: (rng() - 0.5) * LOT.h, angle, cap };
        clampInside(p);
        return p;
    });

    for (let iter = 0; iter < RELAX_ITERS; iter++) {
        let moved = false;
        for (let i = 0; i < pieces.length; i++) {
            for (let j = i + 1; j < pieces.length; j++) {
                const mtv = overlapMTV(packBox(pieces[i]), packBox(pieces[j]));
                if (!mtv) continue;
                moved = true;
                pieces[i].x += mtv.x / 2;
                pieces[i].y += mtv.y / 2;
                pieces[j].x -= mtv.x / 2;
                pieces[j].y -= mtv.y / 2;
                clampInside(pieces[i]);
                clampInside(pieces[j]);
            }
        }
        if (!moved) return pieces;
    }
    // Never settled. Better a failed attempt than a lot with cars inside each other.
    return [];
}

/**
 * The two ways a piece may leave: nose first, or backing out. Its placement IS its
 * body axis, so there is nothing else on offer -- the direct analogue of the old
 * `dirsFor`, which gave a 2x1 piece left and right for the same reason.
 *
 * Flipping the heading does not move the piece: a rectangle turned a half turn covers
 * the same board. That is what lets the packer commit to a placement and still leave
 * the peel a choice.
 */
function headingsFor(p: Piece): number[] {
    return [p.angle, p.angle + 180];
}

/**
 * Hand every piece a heading, in the order the cars will LEAVE. Unchanged in shape
 * from the grid version: a piece may be taken when some legal heading gives it a clear
 * lane past the pieces still down, and whichever is taken frees its space for the next
 * step -- so the returned order is a valid solution by construction.
 */
function peel(rng: () => number, pieces: Piece[]): { piece: Piece; angle: number }[] {
    const remaining = pieces.slice();
    const order: { piece: Piece; angle: number }[] = [];
    while (remaining.length > 0) {
        // Probe cars, one per remaining piece, with ids so pathClear can skip the mover.
        const probes: CarSpec[] = remaining.map((p, i) => ({
            id: i + 1, x: p.x, y: p.y, angle: p.angle, color: '', cap: p.cap,
        }));
        const moves: { i: number; angle: number }[] = [];
        for (let i = 0; i < remaining.length; i++) {
            for (const angle of headingsFor(remaining[i])) {
                if (pathClear({ ...probes[i], angle }, probes, LOT)) moves.push({ i, angle });
            }
        }
        if (moves.length === 0) break;
        const move = pick(rng, moves);
        order.push({ piece: remaining.splice(move.i, 1)[0], angle: move.angle });
    }
    return order;
}

/** Board coordinates and angles, at the precision the level files carry. */
function round4(n: number): number {
    return Math.round(n * 1e4) / 1e4;
}

/**
 * One attempt at a level's cars. Rounding happens HERE, before anything validates or
 * solves these cars, so the numbers checked are the numbers written -- a ten-thousandth
 * is small, but the clearance it is measured against is only 0.04.
 */
function scatter(rng: () => number, p: GenParams): CarSpec[] {
    return peel(rng, pack(rng, p.cars)).map(({ piece, angle }, i) => ({
        id: i + 1,
        x: round4(piece.x),
        y: round4(piece.y),
        angle: round4(((angle % 360) + 360) % 360),
        color: PALETTE[i % p.colors],
        cap: piece.cap,
    }));
}
```

`assemble` 里:

```ts
        lot: { w: LOT.w, h: LOT.h, cars },
```

顶部 import 补上:

```ts
import { inflate, obbCorners, overlapMTV, OBB } from './geometry';
import { CAP_BOX, CAR_SCALE, Cap, CarSpec, CLEARANCE, Feed, LevelData, Lot, QueueGroup } from './types';
import { pathClear } from './move-solver';
```

(删掉 `Dir` 与 `footprint` 的 import。)

- [ ] **Step 2: 改 `tools/gen-levels.ts`**

第 40 行 `level.grid.cars` → `level.lot.cars`。同文件里若有别的 `grid` 引用一并改。

- [ ] **Step 3: 把生成器测试改回来并更新它**

先恢复 Task 3 停用的那个文件:

```bash
git mv logic/tests/level-gen.test.ts.disabled logic/tests/level-gen.test.ts
```

然后:

- 顶部 import:`GRID_COLS, GRID_ROWS` → `LOT`;补 `CAP_BOX, CAR_SCALE` 与 `validateLevel`。
- 原来断言「车在格内」的两行(`car.x + car.w <= level.grid.cols`)换成校验器:

```ts
test('every generated level is geometrically legal', () => {
  for (let id = 1; id <= 10; id++) {
    expect(validateLevel(generateLevel(id))).toEqual([]);
  }
});
```

- 原来 `expect(level.grid.cols).toBe(GRID_COLS)` 换成 `expect(level.lot.w).toBe(LOT.w); expect(level.lot.h).toBe(LOT.h);`
- 原来的占用率断言 `cells / (GRID_COLS * GRID_ROWS) > 0.8` 换成**面积**占用率:

```ts
test('the lot reads as a full car park', () => {
  const level = generateLevel(1);
  const area = level.lot.cars.reduce(
    (sum, c) => sum + CAP_BOX[c.cap].len * CAP_BOX[c.cap].wid * CAR_SCALE * CAR_SCALE, 0,
  );
  // Bodies cover just under half the lot -- the old 0.8 counted cells claimed, which
  // included the ring of air a square cell left around an oblong car.
  expect(area / (LOT.w * LOT.h)).toBeGreaterThan(0.42);
});
```

- 若 Task 3 里 `test.skip` 过某条,现在恢复它。
- 「planning window」那条(`[12, 12, 11, 11, 11, 10, 25, 10, 10, 9]`)与场地无关,**不要动**。
- 「乘客总数在预算内」那条不要动。

- [ ] **Step 4: 跑测试**

Run: `cd logic && npm test`
Expected: PASS。

**如果「every generated level places all 36 cars」类的断言挂了**(车数不足),按顺序试,每试一步重跑:
1. `RELAX_ITERS` 从 60 提到 120;
2. `ATTEMPTS` 从 200 提到 400;
3. `CAR_SCALE`(在 `types.ts`)从 1.0 降到 0.95。
在 commit message 里写清最后落在哪一档、以及测出来平均能坐多少辆。**不要**放宽车数断言。

**如果「every generated level is geometrically legal」挂了**,说明 `pack` 的 `packBox` 与 `validateLevel` 的膨胀量不一致 —— 两边都必须是 `CLEARANCE / 2`。先核对这个,别去调 `RELAX_ITERS`。

- [ ] **Step 5: 重新生成十关**

Run: `cd logic && npm run gen`
Expected: 十个 JSON 重写,工具打印每关的车数 / 乘客数 / blocked / on-target 列

检查:`git diff --stat game/assets/resources/levels/` 应显示 10 个文件都变了;随手打开 `level-1.json` 确认 `lot` 字段在、`cars[0]` 有 `angle` 且没有 `w`/`h`/`dir`。

- [ ] **Step 6: 跑两道闸**

Run: `cd logic && npm test`
Expected: PASS

Run: `cd logic && npm run typecheck:view`
Expected: 仍 FAIL,与 Task 3 同一批错误

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/core/level-gen.ts tools/gen-levels.ts logic/tests/level-gen.test.ts game/assets/resources/levels
git commit -m "$(cat <<'EOF'
feat(core): pack the lot by scattering boxes and pushing them apart

Reject-sampling worked on the grid because integer cells never overlap.
With free angles the late placements are rejected almost every time and
the lot comes up six or eight cars short, so this scatters all of them
and then separates overlapping pairs along their minimum translation
vector. Thirty lines, and the difference between seating 36 and 28.

The packer inflates by half the clearance on each of a pair, which is the
same arithmetic validateLevel uses -- it cannot settle on something the
check would reject.

The peel is unchanged in shape. A piece's placement IS its body axis, so
its two candidate headings are nose-first and backing out, which is the
direct analogue of dirsFor handing a 2x1 piece left and right. Flipping a
heading does not move the piece, because a rectangle turned a half turn
covers the same board -- that is what lets the packer commit to a
placement and still leave the peel a choice.

Rounding moved into scatter, ahead of validation and solving, so the
numbers checked are the numbers written. A ten-thousandth is small; the
clearance it is measured against is 0.04.

The occupancy test now measures AREA. The old 0.8 counted cells claimed,
which included the ring of air a square cell left around an oblong car.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: view 跟上 —— 布局、车身朝向、拾取、出场路线

**Files:**
- Create: `game/assets/scripts/view/board-layout.ts`
- Delete: `game/assets/scripts/view/grid-layout.ts`(及其 `.meta`)
- Modify: `game/assets/scripts/view/grid-view.ts`
- Modify: `game/assets/scripts/view/car-builder.ts`
- Modify: `game/assets/scripts/view/scene-stage.ts:57-64`
- Modify: `game/assets/scripts/view/GameController.ts`

**Interfaces:**
- Consumes: `CarSpec`/`CAP_BOX`/`CAR_SCALE`/`Cap`/`Lot`(Task 3)、`firstBlocker`(Task 3)、`LevelData.lot`(Task 3)
- Produces:
  - `export class BoardLayout { constructor(scale: number); toWorld(x, y): Vec3; carSize(cap: Cap): { len: number; wid: number }; readonly scale: number }`
  - `buildCar(name: string, len: number, wid: number, color: Color, angle: number, cap: Cap): BuiltCar`
  - `GridView.pickCar(local: Vec3): number | null`(语义不变,实现换成 OBB)
- 删除:`GridLayout`、`car-builder` 的 `orientAngle`/`sharedCarScale`/`measureModels`/`modelSize`/`FILL`/`CAPS`/`CAP_FOOTPRINT`、`GameController` 的 `DIR_VEC`

**本任务结束时两道闸必须同时绿,游戏也必须真的跑起来。** 前三个任务里 `typecheck:view` 一直是红的,到这里归零。

- [ ] **Step 1: 建 `board-layout.ts`**

```ts
import { Vec3 } from 'cc';
import { Cap, CAP_BOX, CAR_SCALE } from '../core/index';

/**
 * Board coordinates to world positions. The board's origin is the lot's centre and its
 * +Y is world +Y, so this is a pure scale -- no row-zero-at-the-top flip like the grid
 * layout it replaces.
 *
 * `scale` is world units per board unit. One board unit is the pitch the old 9x6 grid
 * used, which is why the camera framing survives this milestone untouched.
 */
export class BoardLayout {
    constructor(public readonly scale: number) {}

    toWorld(x: number, y: number): Vec3 {
        return new Vec3(x * this.scale, y * this.scale, 0);
    }

    /** World length (along the body) and width (across it) of a car of this capacity. */
    carSize(cap: Cap): { len: number; wid: number } {
        const b = CAP_BOX[cap];
        return { len: b.len * CAR_SCALE * this.scale, wid: b.wid * CAR_SCALE * this.scale };
    }
}
```

删掉 `grid-layout.ts` 和 `grid-layout.ts.meta`。

- [ ] **Step 2: 改 `car-builder.ts`**

- 删掉 `orientAngle`、`sharedCarScale`、`measureModels`、`modelSize`、`FILL`、`CAPS`、`CAP_FOOTPRINT`,以及 `Dir` 和 `GridLayout` 的 import。
- `preloadCarModels` 里 `finish` 恢复成 `const finish = (): void => { if (--remaining === 0) done(); };`,`const caps: Cap[] = ['small', 'medium', 'big'];`。
- `buildCar` 签名与拟合段换成:

```ts
/**
 * Build a car at the size and heading core says it has. `len` and `wid` come from
 * `BoardLayout.carSize`, which reads CAP_BOX -- the model is scaled to match the table,
 * not the other way round. There is no footprint to fit inside any more, and no shared
 * factor to negotiate: three sizes in the table are three sizes on the board.
 */
export function buildCar(
    name: string, len: number, wid: number, color: Color, angle: number, cap: Cap,
): BuiltCar {
    const root = new Node(name);
    const body = new Node('body');
    root.addChild(body);

    const prefab = prefabs[cap];
    if (!prefab) {
        fallbackBox(body, len, wid, color);
        body.setRotationFromEuler(0, 0, angle);
        return { root, body, len, wid };
    }

    const model = instantiate(prefab) as unknown as Node;
    const { center, size } = localAABB(model);

    // One uniform scale. CAP_BOX was measured FROM this model, so the two ratios agree
    // to within rounding; taking the smaller keeps a re-exported model from spilling
    // past the size core believes it has.
    const s = Math.min(len / size.x, wid / size.z);
    const hgt = size.y * s;

    const lay = new Node('lay');
    lay.setRotationFromEuler(90, 0, 0);
    lay.setScale(s, s, s);
    lay.setPosition(0, 0, hgt / 2);
    model.setPosition(-center.x, -center.y, -center.z);
    lay.addChild(model);
    body.addChild(lay);

    recolorCar(model, color);
    addShadow(body, size.x * s, size.z * s);

    body.setRotationFromEuler(0, 0, angle);
    return { root, body, len: size.x * s, wid: size.z * s };
}
```

`fallbackBox(body, sizeX, sizeY, color)` 的两个参数名改成 `len`/`wid`,内部 `primitives.box({ width: len * 0.9, height: wid * 0.9, length: 0.5 })`,`addShadow(body, len * 0.9, wid * 0.9)`。

- [ ] **Step 3: 改 `grid-view.ts`**

```ts
import { Node, Vec3 } from 'cc';
import { GridSystem } from '../core/index';
import { BoardLayout } from './board-layout';
import { colorOf } from './colors';
import { buildCar, Cap } from './car-builder';

interface CarEntry {
    id: number;
    node: Node;
    body: Node;
    /** Fitted body length and width (world), and the heading they are drawn at. */
    len: number;
    wid: number;
    angle: number;
}
```

`render`:

```ts
    render(): void {
        for (const [id, car] of this.grid.cars) {
            const { len, wid } = this.layout.carSize(car.cap as Cap);
            const built = buildCar(
                `car-${id}`, len, wid, colorOf(car.color), car.angle, car.cap as Cap,
            );
            built.root.setPosition(this.layout.toWorld(car.x, car.y));
            this.parent.addChild(built.root);
            this.carNodes.set(id, built.root);
            this.entries.push({
                id, node: built.root, body: built.body,
                len: built.len, wid: built.wid, angle: car.angle,
            });
        }
    }
```

`pickCar` —— 把点转进车体自己的坐标系,再做一次普通的盒子判定:

```ts
    /**
     * The id of the car whose body contains `local` (gridRoot-local), or null.
     *
     * The box test is done in the CAR's frame rather than the board's: a car parked at
     * an angle has no axis-aligned box worth testing against, and the version that
     * tested one picked up taps on the empty corners beside a diagonal car.
     */
    pickCar(local: Vec3): number | null {
        for (const e of this.entries) {
            const p = e.node.position;
            const r = -e.angle * Math.PI / 180;
            const c = Math.cos(r);
            const s = Math.sin(r);
            const dx = local.x - p.x;
            const dy = local.y - p.y;
            const bx = dx * c - dy * s;
            const by = dx * s + dy * c;
            if (Math.abs(bx) <= e.len / 2 && Math.abs(by) <= e.wid / 2) return e.id;
        }
        return null;
    }
```

构造函数的 `private layout: GridLayout` → `private layout: BoardLayout`。`getCarSize` 保持返回 `{ len, wid }` 不变(`stallScale` 依赖它)。

- [ ] **Step 4: 改 `scene-stage.ts`**

```ts
/**
 * Size the lot needs to cover a board `h` units tall at `scale` world units per board
 * unit, plus a small apron. The caller may draw it larger (it does, to fill the view)
 * but never smaller.
 */
export function lotHeight(h: number, scale: number): number {
    return h * scale + 0.3;
}

/** Width of the lot slab for a board `w` units across. */
export function lotWidth(w: number, scale: number): number {
    return w * scale + 0.3;
}
```

- [ ] **Step 5: 改 `GameController.ts`**

改动清单:

1. import:`Dir` 去掉;`GridLayout` → `BoardLayout`。
2. `DIR_VEC` 整块删掉,换成:

```ts
/** Board-space unit vector a car with this heading drives along. */
function headingVec(angle: number): Vec3 {
    const r = angle * Math.PI / 180;
    return new Vec3(Math.cos(r), Math.sin(r), 0);
}
```

3. `private gridStep = 1;` 改名 `private boardScale = 1;`(全文件替换)。
4. 加一个字段,记住场地在 boardRoot 空间的四条边 —— `routeToSlot` 需要它:

```ts
    /** The lot's edges in board space. `routeToSlot` decides which lane a car joins by
     *  which of these it crosses first. */
    private lotRect = { left: 0, right: 0, top: 0, bottom: 0 };
```

5. `renderBoard` 里的尺寸段:

```ts
        const cell = Math.min(
            CELL_MAX,
            (ROAD_Y - 2 * RING_OFF - RING_LOW - 0.3) / level.lot.h - CELL_GAP,
            (2 * LOT_HALF_W - 0.3) / level.lot.w - CELL_GAP,
        );
        const scale = cell + CELL_GAP;
        this.boardScale = scale;
        const lotH = lotHeight(level.lot.h, scale);
        const lotW = Math.max(lotWidth(level.lot.w, scale), 2 * LOT_HALF_W);
        const GRID_Y = ROAD_Y - RING_OFF - lotH / 2;
        this.lotRect = {
            left: -level.lot.w * scale / 2,
            right: level.lot.w * scale / 2,
            top: GRID_Y + level.lot.h * scale / 2,
            bottom: GRID_Y - level.lot.h * scale / 2,
        };
```

(`lotRect` 用车真正能到的范围 `level.lot.* * scale`,不是加了 apron 的 `lotW`/`lotH`。)

6. 布局构造:`const layout = new BoardLayout(scale);`
7. `handleTap` 里:

```ts
        const angle = this.core.grid.cars.get(id)?.angle ?? 0;
        const res = this.core.tapCar(id);
        if (res.ok) {
            this.playDriveToSlot(id, angle, res.slotIndex);
        } else if (res.reason === 'full') {
```

8. `playDriveToSlot(id: number, dir: Dir, slotIndex: number)` → `playDriveToSlot(id: number, angle: number, slotIndex: number)`,里面 `this.routeToSlot(start, angle, slot.x, slot.y)`。
9. `routeToSlot` 整个换掉:

```ts
    /**
     * Waypoints from a car's place in the lot to a parking stall: straight out along its
     * own heading until it clears the lot, then round the ring road to the top lane,
     * along that to the stall, and up into it.
     *
     * A diagonal heading needs no special case. Whichever lot edge the car reaches
     * FIRST decides which lane it joins, and from there the corner-turning is the same
     * code the four-direction version used: every stall is above the top lane, so a car
     * off the side needs one corner and one off the bottom needs two, taking whichever
     * side it is already nearer.
     */
    private routeToSlot(from: Vec3, angle: number, slotX: number, parkY: number): Vec3[] {
        const r = this.ring;
        const L = this.lotRect;
        const z = from.z;
        const d = headingVec(angle);
        // Distance to each boundary it is actually heading toward; Infinity when it is
        // not travelling that way at all.
        const tx = Math.abs(d.x) < 1e-6
            ? Infinity : ((d.x > 0 ? L.right : L.left) - from.x) / d.x;
        const ty = Math.abs(d.y) < 1e-6
            ? Infinity : ((d.y > 0 ? L.top : L.bottom) - from.y) / d.y;
        const t = Math.max(0, Math.min(tx, ty));
        const wp: Vec3[] = [new Vec3(from.x + d.x * t, from.y + d.y * t, z)];
        const out = wp[0];
        if (ty <= tx) {
            if (d.y > 0) {
                wp.push(new Vec3(out.x, r.top, z));
            } else {
                const side = out.x < 0 ? r.left : r.right;
                wp.push(new Vec3(out.x, r.bottom, z));
                wp.push(new Vec3(side, r.bottom, z));
                wp.push(new Vec3(side, r.top, z));
            }
        } else {
            const side = d.x < 0 ? r.left : r.right;
            wp.push(new Vec3(side, out.y, z));
            wp.push(new Vec3(side, r.top, z));
        }
        wp.push(new Vec3(slotX, r.top, z));
        wp.push(new Vec3(slotX, parkY, z));
        return wp;
    }
```

10. `playShake` 里:

```ts
        const block = car
            ? firstBlocker(car, Array.from(grid.cars.values()), grid.lot)
            : null;
```
以及 `const dir = headingVec(car.angle);`、`const dist = block.gap * this.boardScale + BUMP;`

> `block.gap * this.boardScale` 与今天的 `block.gap * this.gridStep` 是**同一个算式**:一板单位就是一格距。改的只是变量名。

11. `playLotFull` 里若用了 `DIR_VEC[car.dir]`,同样换成 `headingVec(car.angle)`。

- [ ] **Step 6: 跑两道闸**

Run: `cd logic && npm run typecheck:view`
Expected: **无输出,退出码 0**。这是本任务的主要成果。

Run: `cd logic && npm test`
Expected: PASS,与 Task 5 相同的用例数

- [ ] **Step 7: 用户在 Cocos 编辑器里看一眼**

告诉用户:斜停的车、箭头方向、出场路线现在可以看了。**难度还没标定**(Task 7),所以别按难易度评价关卡,只看:
1. 车有没有互相穿模;
2. 箭头指的方向与车真正开出去的方向是否一致;
3. 点车的判定是否贴着车身(不是贴着一个正方形);
4. 停车场看起来满不满。

- [ ] **Step 8: 提交**

```bash
git add game/assets/scripts/view
git commit -m "$(cat <<'EOF'
feat(view): draw and drive cars at the heading core gives them

orientAngle's four-way mapping is gone, and with it the rule it existed
to keep: a model is laid along its footprint's longer axis, so a 2x1 car
told to exit upward drew its arrow across its own length. There is no
footprint to be laid along any more -- the body IS the collision box, so
the arrow points where the car goes by construction.

sharedCarScale is gone too. It negotiated one factor that let all three
capacities fit their own footprints, which threw the models' sizes away
twice over; CAP_BOX is the size now and the model is scaled to match it.

pickCar tests the box in the CAR's frame rather than the board's. The
axis-aligned version picked up taps on the empty corners beside a
diagonal car.

routeToSlot loses its four branches: whichever lot edge the car reaches
first decides the lane it joins, and the corner-turning past that is the
same code as before.

Both gates green again. The difficulty curve is still the grid-era one --
Task 7 recalibrates it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 难度曲线重新标定

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts:levelParams` 与 `BLOCKED_TOLERANCE`
- Regenerate: `game/assets/resources/levels/level-1.json` … `level-10.json`
- Test: `logic/tests/level-gen.test.ts`

**Interfaces:**
- Consumes: `generateLevel`、`estimateDifficulty`(不改签名)
- Produces: 无新接口,只改常量

**为什么要标定**:斜着开出去是一条斜的扫掠带,蹭到的车比正交多,所以 `blocked` 的分布整体上移。`blockedRatio` 现在的取值(0.5 起、每关 +0.025、上限 0.75)是在格子上量出来的,不重标的话 `generateLevel` 每关都只能退回「最接近的一次尝试」,曲线形同虚设。

**标定规则** —— 不是随手调数,照这个算:

设 Step 1 量到的十个 `blocked` 值升序排列为 `s[0..9]`。

1. `BLOCKED_FIRST = s[2] / CARS_PER_LEVEL`(第 3 个,约下四分位),`BLOCKED_LAST = s[7] / CARS_PER_LEVEL`(第 8 个,约上四分位),两个都四舍五入到两位小数。`levelParams` 写成:

```ts
/** Measured, not chosen. See the table in the commit that set them. */
const BLOCKED_FIRST = 0.00;   // <- Step 1 算出来的数
const BLOCKED_LAST = 0.00;    // <- Step 1 算出来的数

export function levelParams(id: number): GenParams {
    const t = Math.min(1, Math.max(0, (id - 1) / 9));
    return {
        cars: CARS_PER_LEVEL,
        colors: Math.min(5, 2 + Math.floor((id - 1) / 3)),
        blockedRatio: BLOCKED_FIRST + (BLOCKED_LAST - BLOCKED_FIRST) * t,
        minRounds: Math.min(5, 2 + Math.floor((id - 1) / 3)),
    };
}
```

2. `BLOCKED_TOLERANCE`:从 3 开始,`npm run gen` 看工具打印的 on-target 列;命中不足 7 关就 +1,重跑,**上限 5**。到 5 还不足 7 关,说明 `blocked` 的分布太窄 —— 这时改的是 `ATTEMPTS`(200 → 400),不是继续放宽容差。
3. `minRounds` 不动,除非 Step 1 量到十关的 `rounds` **全部** ≥ 5(说明上限 5 已经不构成约束);那时把 `Math.min(5, ...)` 的 5 换成实测 `rounds` 的中位数。

- [ ] **Step 1: 量出现在的分布**

写一个临时脚本(放在 scratchpad,不要提交):

```js
// measure-difficulty.js
const { generateLevel } = require('../../.tmp/gen/game/assets/scripts/core/level-gen');
const { estimateDifficulty } = require('../../.tmp/gen/game/assets/scripts/core/solvability');
for (let id = 1; id <= 10; id++) {
  const lv = generateLevel(id);
  const d = estimateDifficulty(lv);
  console.log(id, 'cars', lv.lot.cars.length, 'blocked', d.blocked,
              'rounds', d.rounds, 'score', d.score);
}
```

Run: `cd logic && npx tsc -p tsconfig.gen.json && node <scratchpad>/measure-difficulty.js`
Expected: 十行,每行给出 blocked / rounds / score

把这张表贴进 commit message —— 它是常量取值的唯一依据。

- [ ] **Step 2: 按上面三条规则改常量**

改 `levelParams` 的 `blockedRatio` 起止值和 `BLOCKED_TOLERANCE`。两处都要留注释说明这些数**是量出来的**,以及量的是哪一版几何:

```ts
/**
 * ... (保留现有注释,并在末尾追加)
 *
 * Re-measured for free-angle exits (M8). A diagonal lane is a diagonal SWATH and
 * clips more cars than a straight column, so the blocked-car distribution sits
 * higher than the grid-era 0.5-0.75 band this replaces.
 */
```

- [ ] **Step 3: 加一条曲线单调性测试**

```ts
test('the difficulty curve rises across the ten levels', () => {
  const scores = [];
  for (let id = 1; id <= 10; id++) scores.push(estimateDifficulty(generateLevel(id)).score);
  // Not strictly monotone -- the generator settles for a nearest miss when it must --
  // but the back half must be harder than the front half.
  const front = scores.slice(0, 5).reduce((a, b) => a + b, 0);
  const back = scores.slice(5).reduce((a, b) => a + b, 0);
  expect(back).toBeGreaterThan(front);
});
```

- [ ] **Step 4: 跑测试并重新生成**

Run: `cd logic && npm test`
Expected: PASS

Run: `cd logic && npm run gen`
Expected: 十个 JSON 重写;工具打印的 on-target 列应大部分是命中

Run: `cd logic && npm test && npm run typecheck:view`
Expected: 两个都 PASS

- [ ] **Step 5: 用户试玩,判断难度和斜向遮挡的可读性**

问用户两件事:
1. 前几关是不是太难 / 后几关是不是太松;
2. **斜着的遮挡关系看不看得懂** —— spec 第四节说过,如果读不懂,后续解法是给车加一条驶出方向的地面导引线,而不是退回四方向。这一条要用户实机拍板,不要自己决定。

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/core/level-gen.ts logic/tests/level-gen.test.ts game/assets/resources/levels
git commit -m "$(cat <<'EOF'
tune(core): re-measure the difficulty curve for diagonal lanes

A diagonal lane is a diagonal swath, so it clips more cars than a
straight column does and the blocked-car distribution sits higher than
the band measured on the grid. Without re-measuring, every level falls
back to its nearest miss and the curve does nothing.

Measured distribution (blocked / rounds / score per level) is in the
commit body below rather than in a comment, because the constants are
only as good as the measurement they came from.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

(把 Step 1 那张表贴进 commit body。)

---

### Task 8: 收尾 —— 改名、模型尺寸校验、README

**Files:**
- Rename: `game/assets/scripts/core/grid-system.ts` → `lot-system.ts`(连 `.meta`)
- Modify: `game/assets/scripts/core/index.ts`、`game-core.ts`、`GameController.ts`、`grid-view.ts`
- Rename: `logic/tests/grid-system.test.ts` → `lot-system.test.ts`
- Modify: `tools/check-car-models.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: 全部前序任务
- Produces: `export class LotSystem`(原 `GridSystem`)、`GameCore.lot`(原 `GameCore.grid`)

**这是纯机械改动,零行为变化。** 单独成一个任务就是为了让它好审:一个 reviewer 应该能只看 diff 就确认没有逻辑被动过。

`GridSystem` / `GameCore.grid` / `GridView` 这些名字在格子消失之后是谎话。前面几个任务故意没碰它们,免得把改名的噪音混进真正的改动里。

- [ ] **Step 1: 改名**

```bash
git mv game/assets/scripts/core/grid-system.ts game/assets/scripts/core/lot-system.ts
git mv game/assets/scripts/core/grid-system.ts.meta game/assets/scripts/core/lot-system.ts.meta
git mv logic/tests/grid-system.test.ts logic/tests/lot-system.test.ts
```

- `lot-system.ts` 里 `export class GridSystem` → `export class LotSystem`
- `core/index.ts`:`export * from './grid-system';` → `export * from './lot-system';`
- `game-core.ts`:`readonly grid: GridSystem;` → `readonly lot: LotSystem;`,构造与全部 `this.grid.` → `this.lot.`
- `GameController.ts`:全部 `this.core.grid` / `this.core!.grid` → `.lot`(共 7 处,含 `grid.lot` → `lot.lot`;把那句写成 `const lot = this.core!.lot; ... firstBlocker(car, Array.from(lot.cars.values()), lot.lot)`)
- `grid-view.ts`:`private grid: GridSystem` → `private lot: LotSystem`,内部 `this.grid.cars` → `this.lot.cars`
- `lot-system.test.ts` 里 `GridSystem` → `LotSystem`

`GridView` / `grid-view.ts` 这两个名字**保留**:它渲染的是停车场那一块,`grid` 在这里指的是画面上的那一片区域而不是格子模型,改名会牵动 `GameController` 里 `this.gridView` 的十几处而没有对应收益。

- [ ] **Step 2: 跑两道闸**

Run: `cd logic && npm test`
Expected: PASS,用例数与 Task 7 完全相同

Run: `cd logic && npm run typecheck:view`
Expected: 无输出,退出码 0

- [ ] **Step 3: 给 `check-car-models.mjs` 加 `CAP_BOX` 校验**

这个工具现在从源码里抓 `GRID_COLS`/`GRID_ROWS`/`FILL`,这三个都不存在了,会在 `constant()` 里 `process.exit(2)`。改成:

- 抓的常量换成:`ROAD_Y`、`RING_OFF`、`RING_LOW`、`LOT_HALF_W`、`CELL_MAX`、`CELL_GAP`(仍从 `GameController.ts`,现成的 `constant()` 能抓)。删掉 `FILL`、`COLS`、`ROWS`。
- `LOT` 和 `CAP_BOX` 是对象字面量,现成的 `constant()` 抓不到,各加一个读取函数 —— 和 `constant()` 一样,抓不到就 `process.exit(2)`,**绝不给默认值**:一个会自己填默认值的校验工具是会撒谎的校验工具。

```js
const GEN = 'game/assets/scripts/core/level-gen.ts';
const TYPES = 'game/assets/scripts/core/types.ts';

function lotExtent(file) {
    const src = readFileSync(file, 'utf8');
    const m = /^export const LOT: Lot = \{ w: ([\d.]+), h: ([\d.]+) \};/m.exec(src);
    if (!m) {
        console.error(`cannot find LOT in ${file} — this tool is out of date with the code`);
        process.exit(2);
    }
    return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
}

function capBox(file, cap) {
    const src = readFileSync(file, 'utf8');
    const re = new RegExp(`${cap}:\\s*\\{ len: ([\\d.]+), wid: ([\\d.]+) \\}`);
    const m = re.exec(src);
    if (!m) {
        console.error(`cannot find CAP_BOX.${cap} in ${file} — this tool is out of date`);
        process.exit(2);
    }
    return { len: parseFloat(m[1]), wid: parseFloat(m[2]) };
}
```
- 板单位到世界的换算 `PITCH = min(CELL_MAX, (ROAD_Y - 2*RING_OFF - RING_LOW - 0.3)/LOT.h - CELL_GAP, (2*LOT_HALF_W - 0.3)/LOT.w - CELL_GAP) + CELL_GAP`。
- 新的报告与判定:对每个 cap,`实测 AABB.len / PITCH` 与 `CAP_BOX[cap].len` 相差超过 **0.02** 就记一条 problem;宽度同理。
- 删掉旧的 `MIN_FILL` 与 footprint 相关的判定(没有 footprint 了),保留「两个 cap 尺寸相同」那条。

```js
/** How far a measured model may drift from CAP_BOX before it is a problem, in board units. */
const BOX_TOLERANCE = 0.02;
```

新的输出示例(实现者照这个格式)::

```
board pitch 0.7533   (from game/assets/resources/models)

cap      model L x W x H          board L x W    CAP_BOX L x W    drift
small     0.726 x 0.355 x 0.294    0.964 x 0.471   0.964 x 0.471   0.000
```

- [ ] **Step 4: 跑它,确认绿**

Run: `node tools/check-car-models.mjs`
Expected: `looks good.`,退出码 0

**若报 drift 超差**:说明 `CAP_BOX` 抄错了或模型换过。此时不要去改 `BOX_TOLERANCE`,而是把 `types.ts` 的 `CAP_BOX` 按实测值更新,然后回去重跑 `npm run gen`(尺寸变了,关卡得重生成),再跑两道闸。

- [ ] **Step 5: 更新 `README.md`**

不变量清单里,以下几条已经不成立,删掉:

- 「停车场车与车的间隙 = CELL_GAP + fill 留下的空气」
- 「medium 和 big 共用 2 格 footprint,长度比上限 2.03」
- 「stallScale 上限为 1」以外那些关于 footprint 的表述

加上:

- 「停车场是**连续**坐标:车有 `angle`,碰撞体是有向矩形(`core/geometry.ts`),不是格子。」
- 「`CLEARANCE = 0.04` 板单位在**两处**使用 —— 打包时车与车的最小间距,判路时移动车的膨胀量。改一处就要改两处,否则『看着过不去的缝』会变成能过去。」
- 「`CAP_BOX`(`core/types.ts`)是车身尺寸的**唯一事实**,view 按它缩放模型。换模型后必须跑 `node tools/check-car-models.mjs`,它会比对实测 AABB 与这张表。」
- 「`pack` 用**分离松弛**而不是拒绝采样;它不保证收敛,收敛不了就返回空数组让 `generateLevel` 换下一次尝试。信不信它的输出由 `validateLevel` 的三条几何规则决定。」
- 「剥离时每辆车只有 `angle` 和 `angle + 180` 两个朝向可选 —— 矩形在半周旋转下与自身重合,所以摆位定了朝向还能二选一。」
- 「场地面积占用率约 50%(不是格子占用率 88%);差额是格子时代长条车周围那圈空气。」

- [ ] **Step 6: 跑两道闸,提交**

Run: `cd logic && npm test && npm run typecheck:view`
Expected: 两个都 PASS

```bash
git add -A game/assets/scripts logic/tests tools/check-car-models.mjs README.md
git commit -m "$(cat <<'EOF'
refactor: the lot is not a grid, so stop calling it one

Pure rename plus tooling and docs; no behaviour changes. Held back to its
own commit so the diff can be read as exactly that.

GridSystem becomes LotSystem and GameCore.grid becomes GameCore.lot.
GridView keeps its name -- there, "grid" names the region of the screen
the cars are drawn in, and renaming it would touch a dozen call sites for
nothing.

check-car-models.mjs was scraping GRID_COLS, GRID_ROWS and FILL, none of
which exist now. It reads LOT and CAP_BOX instead, and its job changes
from "does each car fill its footprint" to "does each model still match
the size core believes it has" -- CAP_BOX is a hand-copied table that
core cannot verify for itself, and this is what guards it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec 覆盖检查** —— spec 每一节对应的任务:

| Spec 章节 | 任务 |
|---|---|
| 一、坐标系与数据模型 | Task 3(`CarSpec`/`Box`/`Lot`/`CAP_BOX`/`CAR_SCALE`/`CLEARANCE`/`LevelData.lot`) |
| 一、主从倒置 + check-car-models 守护 | Task 3(注释)+ Task 8(校验) |
| 一、顺带解除的两个限制 | Task 3 实现,Task 8 写进 README |
| 二、间隙(一个常数两处用) | Task 3(判路)+ Task 5(打包)+ Task 8(README) |
| 二、`sweepHit`/`insideRect`/`overlapMTV` | Task 1、Task 2 |
| 二、`pathClear`/`firstBlocker` | Task 3 |
| 二、复杂度不做空间索引 | 不需要任务(YAGNI,不写就是不做) |
| 三、`pack` 松弛 | Task 5 |
| 三、`peel` 双朝向 | Task 5 |
| 三、尺寸缩放泄压阀 | Task 5 Step 4 的三级处置 |
| 四、难度重新标定 | Task 7 |
| 四、斜向遮挡可读性(留给用户判断) | Task 7 Step 5 |
| 五、View 五个文件 | Task 6 |
| 五、`routeToSlot` 两步 | Task 6 Step 5 第 9 项 |
| 五、车身朝向连续性(`shortestAngle` 原样可用) | 无需改动 —— Task 6 的 commit message 里说明 |
| 六、关卡数据 4 位小数 | Task 5(`round4`,且在校验之前) |
| 六、`validateLevel` 三条 | Task 4 |
| 六、`gen-levels.ts` 改名 | Task 5 Step 2 |
| 七、`geometry.test.ts` 八类用例 | Task 1(11 条)+ Task 2(9 条) |
| 七、其余测试改写 | Task 3 Step 5-7、Task 5 Step 3 |
| 七、不变量测试(不重叠 + 在场内) | Task 5 Step 3(`validateLevel` 覆盖两条) |
| 七、五个不动的测试文件 | Global Constraints |
| 八、三个里程碑 | Task 1-2 = M8-1,Task 3-6 = M8-2,Task 7-8 = M8-3 |
| 九、不做的事 | 不写就是不做;Task 7 Step 5 明确把导引线留给用户拍板 |
| 十、风险表四条 | Task 5 Step 4(前两条)、Task 7(第三条)、Task 7 Step 5(第四条) |

**没有覆盖的一处,以及为什么**:spec 第八节说 M8-2「只求编译过、跑得起来、画得出斜车,不求好看」,而本计划把 `routeToSlot` 的完整实现放进了 Task 6 而不是留到 M8-3。理由:一个「先按最近的轴向出场」的临时实现会让斜车的箭头当场撒谎——正是这套代码一直在防的那种 bug——而完整实现只有约 25 行。宁可 Task 6 大一点。

**改名的决定超出了 spec**:spec 只说 `LevelData.grid` 字段改名。`GridSystem` 类和 `GameCore.grid` 属性同样是谎话,所以 Task 8 一并改了,并且刻意排在最后、单独一个 commit,好让 reviewer 能确认它零行为变化。
