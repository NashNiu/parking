# 停车场骨架布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让停车场的车按骨架排布——间距均匀、没有撞出来的大块空白、每关走不同的车道形状——同时保住十关的 hard ∧ fair。

**Architecture:** 车道是一组 `OBB` 保留区,喂给 `pack()` 的 `reserved`(隧道已经走通这条路);播种从均匀随机改为沿车道方向的松散行列,`GAP` 是唯一的密度旋钮;骨架形状按每关一行的曲线轮换,与 `TRACK_CURVE` 同构。

**Tech Stack:** TypeScript,纯 `core/` 层(不 import `cc`),jest + ts-jest。离线工具 `npm run gen` / `npm run sweep`。

**Spec:** `docs/superpowers/specs/2026-09-19-lot-skeleton-design.md`

## Global Constraints

- `core/` 是纯 TS,**不得 import `cc`**;新模块必须可被 `logic/tests` 直接测试
- 第 1 关是手写教学关(`authoredLevel` / `TEACH_CARS`),**本计划不得改动它**,验收时 `level-1.json` 必须逐字节不变
- `LANE_W = 0.8`;车道宽度不由 `fillableHoles` 决定(见 spec §4.1),由观感决定
- `GAP` 初值 `0.25`,由 Task 4 标定后写死
- 一切"洞"的判据在**骨架之外**量:`fillableHoles(level, exclude)` 的 `exclude` 传车道
- 验收判据 4 项(spec §4.5)全部验**已提交的 JSON**,不验重新生成的产物
- 每关生成耗时:无隧道 2m0s,有隧道 4m30s;扫 1 关 2m50s。**不要在前台跑全量生成**
- 提交信息用英文;面向用户的说明用中文
- `minRounds` / `UNLOCKED` / 颜色上限 / 隧道曲线 **范围外**,不得顺手改动

---

## File Structure

| 文件 | 职责 |
|---|---|
| `game/assets/scripts/core/lot-skeleton.ts`(新建) | 骨架:形状枚举、每关曲线、车道几何、点阵座位。纯函数,无副作用 |
| `logic/tests/lot-skeleton.test.ts`(新建) | 上面那个模块的单元测试 |
| `game/assets/scripts/core/level-gen.ts`(修改) | `pack()` 接受车道;播种改点阵;`generateLevel` 取骨架 |
| `game/assets/scripts/core/geometry.ts`(修改) | `fillableHoles` 的排除区参数所需的既有几何工具(只读,大概率不改) |
| `game/assets/scripts/core/index.ts`(修改) | 导出新模块 |
| `logic/tests/level-gen.test.ts`(修改) | 骨架相关的验收断言,验已提交的 JSON |

---

### Task 1: 骨架形状与每关曲线

**Files:**
- Create: `game/assets/scripts/core/lot-skeleton.ts`
- Create: `logic/tests/lot-skeleton.test.ts`
- Modify: `game/assets/scripts/core/index.ts`

**Interfaces:**
- Consumes: `OBB` from `./geometry`;`LOT` from `./level-gen` 会造成循环依赖,**所以 lot 尺寸作为参数传入**,不要 import
- Produces:
  - `export type SkeletonShape = 'none' | 'spine' | 'cross' | 'ring' | 'star'`
  - `export const LANE_W = 0.8`
  - `export function skeletonShape(id: number): SkeletonShape`
  - `export function skeletonLanes(shape: SkeletonShape, w: number, h: number): OBB[]`

- [ ] **Step 1: 写失败的测试**

```ts
// logic/tests/lot-skeleton.test.ts
import { skeletonShape, skeletonLanes, LANE_W, SkeletonShape } from '../../game/assets/scripts/core/lot-skeleton';

const W = 8, H = 12;

test('第 1 关没有骨架,它是手写的教学关', () => {
  expect(skeletonShape(1)).toBe('none');
  expect(skeletonLanes('none', W, H)).toEqual([]);
});

test('骨架曲线是每关一行,并且向两端钳制', () => {
  const got = [1,2,3,4,5,6,7,8,9,10].map(skeletonShape);
  expect(got).toEqual([
    'none', 'none', 'spine', 'spine', 'cross',
    'ring', 'ring', 'ring', 'star', 'star',
  ]);
  // 钳制:表外的 id 落在两端,而不是抛错或给 undefined
  expect(skeletonShape(0)).toBe('none');
  expect(skeletonShape(-5)).toBe('none');
  expect(skeletonShape(11)).toBe('star');
  expect(skeletonShape(200)).toBe('star');
  expect(skeletonShape(4.5)).toBe('spine');   // 截断到 4
});

test('每种形状的车道数是它的名字所说的那个数', () => {
  const count: Record<SkeletonShape, number> = {
    none: 0, spine: 1, cross: 2, ring: 4, star: 4,
  };
  for (const shape of Object.keys(count) as SkeletonShape[]) {
    expect(skeletonLanes(shape, W, H)).toHaveLength(count[shape]);
  }
});

test('每条车道都在场地内,宽度都是 LANE_W', () => {
  for (const shape of ['spine', 'cross', 'ring', 'star'] as SkeletonShape[]) {
    for (const lane of skeletonLanes(shape, W, H)) {
      expect(lane.wid).toBe(LANE_W);
      // 车道的四个角都在场地内:用外接半径做保守判断
      const r = Math.hypot(lane.len, lane.wid) / 2;
      expect(Math.abs(lane.x) + r).toBeLessThanOrEqual(W / 2 + r);
      expect(Math.abs(lane.y) + r).toBeLessThanOrEqual(H / 2 + r);
    }
  }
});

test('米字带斜向车道,回字不带', () => {
  const star = skeletonLanes('star', W, H).map((l) => l.angle).sort((a, b) => a - b);
  expect(star).toContain(45);
  expect(star).toContain(135);
  const ring = skeletonLanes('ring', W, H).map((l) => l.angle);
  for (const a of ring) expect([0, 90]).toContain(a);
});
```

- [ ] **Step 2: 跑测试,确认它因为模块不存在而失败**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts`
Expected: FAIL — `Cannot find module '.../lot-skeleton'`

- [ ] **Step 3: 写实现**

```ts
// game/assets/scripts/core/lot-skeleton.ts
import { OBB } from './geometry';

/**
 * 车道宽度。
 *
 * 不由 `fillableHoles` 决定,由观感决定,而这一点是反直觉的:任何能开车的车道都
 * 能停车。`fillableHoles` 试 0/45/90/135 四个角度,所以车是顺着车道停进去的,绑定
 * 的是车宽不是车长——大车含留白 0.624 宽,车道只要宽过 0.624 就会被整条数成一串
 * `big` 洞,而 0.624 比一辆车还窄,那是条缝不是路。
 *
 * 所以洞在骨架之外量(`fillableHoles` 的 exclude 参数),车道宽度取能读成一条路的
 * 最小值:0.8,约 1.5 倍车宽,3 倍于 `GAP` 的 0.25。
 */
export const LANE_W = 0.8;

export type SkeletonShape = 'none' | 'spine' | 'cross' | 'ring' | 'star';

/**
 * 每关一行,与 `TRACK_CURVE` / `TUNNEL_CURVE` / `BAND_CURVE` 同构,向两端钳制。
 *
 * 前两关无骨架:第 1 关是手写教学关,第 2 关是颜色刚够咬人的那一关,两关都不该再
 * 多一层结构要读。
 */
const SHAPE_CURVE: readonly SkeletonShape[] = [
    'none',   // 1  手写教学关,根本不走打包器
    'none',   // 2  第一关有难度的,先不加结构
    'spine',  // 3
    'spine',  // 4
    'cross',  // 5
    'ring',   // 6
    'ring',   // 7
    'ring',   // 8
    'star',   // 9  斜向车道从这里开始
    'star',   // 10
];

export function skeletonShape(id: number): SkeletonShape {
    const i = Math.min(Math.max(1, Math.trunc(id)), SHAPE_CURVE.length) - 1;
    return SHAPE_CURVE[i];
}

/** 一条车道:沿 `angle` 方向长 `len`,宽 `LANE_W`,中心在 (x, y)。 */
function lane(x: number, y: number, angle: number, len: number): OBB {
    return { x, y, angle, len, wid: LANE_W };
}

/**
 * 这个形状的车道,在一个 w x h 的场地里。
 *
 * 场地尺寸是参数而不是 import:`LOT` 住在 `level-gen.ts` 里,而 `level-gen.ts` 要
 * import 本模块,反向 import 会成环。
 */
export function skeletonLanes(shape: SkeletonShape, w: number, h: number): OBB[] {
    switch (shape) {
        case 'none':
            return [];
        // 一条纵贯车道,居中。
        case 'spine':
            return [lane(0, 0, 90, h)];
        // 纵横各一,十字。
        case 'cross':
            return [lane(0, 0, 90, h), lane(0, 0, 0, w)];
        // 回字:一圈矩形环,离边 1/4 处。上下两条横的,左右两条竖的。
        case 'ring': {
            const dx = w / 4;
            const dy = h / 4;
            return [
                lane(0, dy, 0, w / 2),
                lane(0, -dy, 0, w / 2),
                lane(-dx, 0, 90, h / 2),
                lane(dx, 0, 90, h / 2),
            ];
        }
        // 米字:纵横各一,再加两条对角。对角长度取场地对角线的一半,免得伸出去。
        case 'star': {
            const diag = Math.hypot(w, h) / 2;
            return [
                lane(0, 0, 90, h),
                lane(0, 0, 0, w),
                lane(0, 0, 45, diag),
                lane(0, 0, 135, diag),
            ];
        }
    }
}
```

同时在 `game/assets/scripts/core/index.ts` 的导出列表里加一行(紧挨着 `export * from './home-path';` 之类的既有行):

```ts
export * from './lot-skeleton';
```

- [ ] **Step 4: 跑测试,确认全过**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts`
Expected: PASS,5 个测试

注意 `star` 的车道数断言是 4,而"米"字有四笔——纵、横、两条斜。测试里 `count.star = 4` 与实现一致。

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/core/lot-skeleton.ts game/assets/scripts/core/lot-skeleton.ts.meta game/assets/scripts/core/index.ts logic/tests/lot-skeleton.test.ts
git commit -m "feat(core): a per-level lot skeleton, as lanes"
```

若 Cocos 尚未为新文件生成 `.meta`,先不提交 `.meta`,由编辑器下次打开时补上。

---

### Task 2: 点阵座位

**Files:**
- Modify: `game/assets/scripts/core/lot-skeleton.ts`
- Modify: `logic/tests/lot-skeleton.test.ts`

**Interfaces:**
- Consumes: `OBB`、`skeletonLanes` from Task 1
- Produces: `export function latticeSeats(lanes: OBB[], w: number, h: number, gap: number, rowPitch: number, rng: () => number): { x: number; y: number; angle: number }[]`

座位只给**位置和朝向**,不给车型——车型由 `pack()` 原有的 `pickCap` 决定,本任务不碰。

- [ ] **Step 1: 写失败的测试**

```ts
// 追加到 logic/tests/lot-skeleton.test.ts
import { latticeSeats } from '../../game/assets/scripts/core/lot-skeleton';
import { OBB, overlapMTV } from '../../game/assets/scripts/core/geometry';

function seedRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('座位落在场地内,并且是确定的', () => {
  const a = latticeSeats([], W, H, 0.25, 0.8, seedRng(7));
  const b = latticeSeats([], W, H, 0.25, 0.8, seedRng(7));
  expect(a).toEqual(b);
  expect(a.length).toBeGreaterThan(20);
  for (const s of a) {
    expect(Math.abs(s.x)).toBeLessThanOrEqual(W / 2);
    expect(Math.abs(s.y)).toBeLessThanOrEqual(H / 2);
  }
});

test('没有座位落在车道里', () => {
  const lanes = skeletonLanes('cross', W, H);
  const seats = latticeSeats(lanes, W, H, 0.25, 0.8, seedRng(11));
  // 座位是点,用一个极小的盒子代表它
  for (const s of seats) {
    const dot: OBB = { x: s.x, y: s.y, angle: 0, len: 1e-6, wid: 1e-6 };
    for (const l of lanes) expect(overlapMTV(dot, l)).toBeFalsy();
  }
});

test('间距越大,座位越少——这是密度旋钮', () => {
  const tight = latticeSeats([], W, H, 0.15, 0.8, seedRng(3)).length;
  const loose = latticeSeats([], W, H, 0.45, 0.8, seedRng(3)).length;
  expect(loose).toBeLessThan(tight);
});

test('车道占掉的地方不再有座位', () => {
  const bare = latticeSeats([], W, H, 0.25, 0.8, seedRng(5)).length;
  const withLanes = latticeSeats(skeletonLanes('ring', W, H), W, H, 0.25, 0.8, seedRng(5)).length;
  expect(withLanes).toBeLessThan(bare);
});
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts`
Expected: FAIL — `latticeSeats is not a function`

- [ ] **Step 3: 写实现**

追加到 `lot-skeleton.ts`:

```ts
import { OBB, overlapMTV } from './geometry';

/**
 * 座位抖动占 `gap` 的比例。
 *
 * 本设计选定的结构强度是"弱"(松散格子 + 主车道):要的是有秩序但不刻板,不是几何
 * 图案。抖动是刻意的,不是噪声。半个 gap 是上限——再大就会吃掉行距,让"间距均匀"
 * 这条要求失效。
 */
const JITTER_F = 0.5;

/**
 * 把车摆成沿车道方向的松散行列,返回每个座位的位置和朝向。
 *
 * 这是本设计的要害。`pack()` 原本均匀随机撒点,所以**空隙尺寸也是随机的**——大多
 * 数缝很窄,偶尔留下一块车形空地,而排名只能在候选里挑最不烂的一个,造不出一个从
 * 未出现过的整齐打包。点阵的空隙是设计出来的尺寸。
 *
 * 行的方向取自**最近的那条车道**,所以回字的四个区块各自沿着自己那条边排,米字的
 * 斜向区块跟着 45 度走——自由角度没有作废,只是从随机取八向之一变成跟着骨架取向。
 * 没有车道时(前两关)全场一个方向。
 */
export function latticeSeats(
    lanes: OBB[], w: number, h: number, gap: number, rowPitch: number, rng: () => number,
): { x: number; y: number; angle: number }[] {
    const seats: { x: number; y: number; angle: number }[] = [];
    const pitch = rowPitch + gap;
    const along = 1.0 + gap;          // 行内步长:按最常见的小车身长 0.887 向上取整到 1.0
    const jitter = gap * JITTER_F;

    for (let y = -h / 2 + pitch / 2; y <= h / 2; y += pitch) {
        // 整行错位,让相邻两行不是一把梳子。
        const stagger = rng() < 0.5 ? 0 : along / 2;
        for (let x = -w / 2 + along / 2 + stagger; x <= w / 2; x += along) {
            const sx = x + (rng() - 0.5) * jitter;
            const sy = y + (rng() - 0.5) * jitter;
            if (Math.abs(sx) > w / 2 || Math.abs(sy) > h / 2) continue;
            const angle = seatAngle(sx, sy, lanes);
            const dot: OBB = { x: sx, y: sy, angle: 0, len: 1e-6, wid: 1e-6 };
            if (lanes.some((l) => overlapMTV(dot, l))) continue;
            seats.push({ x: sx, y: sy, angle });
        }
    }
    return seats;
}

/** 座位的朝向:跟着最近那条车道走;没有车道就朝上。 */
function seatAngle(x: number, y: number, lanes: OBB[]): number {
    if (lanes.length === 0) return 90;
    let best = lanes[0];
    let bestD = Infinity;
    for (const l of lanes) {
        const d = Math.hypot(l.x - x, l.y - y);
        if (d < bestD) { bestD = d; best = l; }
    }
    return best.angle;
}
```

- [ ] **Step 4: 跑测试,确认全过**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts`
Expected: PASS,9 个测试(Task 1 的 5 个 + 本任务 4 个)

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/core/lot-skeleton.ts logic/tests/lot-skeleton.test.ts
git commit -m "feat(core): lattice seats that follow the skeleton's lanes"
```

---

### Task 3: `fillableHoles` 接受排除区

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts`(`fillableHoles`)
- Modify: `logic/tests/level-gen.test.ts`

**Interfaces:**
- Produces: `export function fillableHoles(level: LevelData, exclude?: OBB[]): Holes`

**这一步必须先于 Task 4**,因为 `GAP` 的标定判据就是它。

- [ ] **Step 1: 写失败的测试**

`level-gen.test.ts` 目前**没有**导入下面这些符号,而 Tasks 3、4、8 的测试都要用到。
一次性加齐,注意 `carBox` 不在 `geometry.ts` 里而在 `move-solver.ts` 里:

```ts
// 追加到 logic/tests/level-gen.test.ts 的 import 区
import { fillableHoles } from '../../game/assets/scripts/core/level-gen';
import { carBox } from '../../game/assets/scripts/core/move-solver';
import { OBB, overlapMTV, inflate } from '../../game/assets/scripts/core/geometry';
import { CLEARANCE } from '../../game/assets/scripts/core/types';
import { skeletonShape, skeletonLanes, LANE_W } from '../../game/assets/scripts/core/lot-skeleton';
```

(该文件已有在中段追加 import 的先例——见 line 515、641——所以加在文件头或就近皆可。)

```ts
test('排除区里的空地不算洞——一条刻意的车道不是撞出来的空白', () => {
  const level = shipped(2);
  const bare = fillableHoles(level);
  // 场地正中挖一条竖条当作排除区
  const strip = [{ x: 0, y: 0, angle: 90, len: LOT.h, wid: 2.0 }];
  const masked = fillableHoles(level, strip);
  expect(masked.big + masked.medium + masked.small)
    .toBeLessThanOrEqual(bare.big + bare.medium + bare.small);
});

test('不传排除区时行为与从前完全一致', () => {
  const level = shipped(2);
  expect(fillableHoles(level, [])).toEqual(fillableHoles(level));
});
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `cd logic && npx jest tests/level-gen.test.ts -t "排除区"`
Expected: FAIL — 第一个测试因为 `fillableHoles` 只接受一个参数而 `masked === bare`,或 TS 编译报参数过多

- [ ] **Step 3: 写实现**

在 `level-gen.ts` 的 `fillableHoles` 上改签名,并在 `taken` 初始化时把排除区一起放进去:

```ts
export function fillableHoles(level: LevelData, exclude: OBB[] = []): Holes {
    const pad = CLEARANCE / 2;
    const taken: OBB[] = level.lot.cars.map((c) => inflate(carBox(c), pad));
    for (const t of level.lot.tunnels ?? []) taken.push(inflate(tunnelReservation(t), pad));
    // 排除区原样放进 `taken`,不 inflate:它不是一个实体,是一块"这里的空白是刻意的"
    // 的声明。见 spec §4.1——任何能开车的车道都能顺着停下一辆车,所以不排除的话
    // 车道本身会被整条数成一串 `big` 洞,而这个指标本来是用来回答"这块空白是撞出
    // 来的吗"的。
    for (const e of exclude) taken.push(e);
    // ……以下不变
```

- [ ] **Step 4: 跑测试,确认全过**

Run: `cd logic && npx jest tests/level-gen.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/core/level-gen.ts logic/tests/level-gen.test.ts
git commit -m "feat(core): fillableHoles can be told which blank is deliberate"
```

---

### Task 4: 把骨架接进 `pack()`

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts`(`pack` 的签名与播种段、`generateLevel` 的调用点 line ~1327)
- Modify: `logic/tests/level-gen.test.ts`

**Interfaces:**
- Consumes: `skeletonShape`、`skeletonLanes`、`latticeSeats`、`LANE_W` from Tasks 1–2
- Produces: `pack(rng, want, tunnels, lanes)` 多一个参数;`export const GAP = 0.25`(Task 5 标定后改值)

- [ ] **Step 1: 写失败的测试**

```ts
// 追加到 logic/tests/level-gen.test.ts
test('车道里没有车,而且车与车道之间还留着 CLEARANCE', () => {
  for (const id of PACKED) {
    const level = shipped(id);
    const lanes = skeletonLanes(skeletonShape(id), LOT.w, LOT.h);
    for (const lane of lanes) {
      for (const car of level.lot.cars) {
        expect(overlapMTV(inflate(carBox(car), CLEARANCE / 2), lane)).toBeFalsy();
      }
    }
  }
});
```

**注意:这个测试在 Task 8 重新生成关卡之前会一直失败**,因为已提交的 JSON 还是旧打包器的产物。这是对的——它正是 Task 8 的验收条件之一。Task 4 结束时用 `test.skip` 标记它并写明原因,Task 8 再打开。

- [ ] **Step 2: 跑测试,确认它因为车道里有车而失败**

Run: `cd logic && npx jest tests/level-gen.test.ts -t "车道里没有车"`
Expected: FAIL,并且是在 `PACKED` 的头几个 id 上失败

- [ ] **Step 3: 写实现**

`pack()` 改签名并替换播种段。原播种段(`const pieces: Piece[] = caps.map(...)`)整段替换:

```ts
function pack(
    rng: () => number, want: number, tunnels: TunnelSpec[], lanes: OBB[],
): Piece[] {
    const pad = CLEARANCE / 2 + ROUND_MARGIN;
    // 车道和隧道在这里是同一种东西:一块车不能进的地方。隧道已经把这条路走通了。
    const reserved = [
        ...tunnels.map((t) => inflate(tunnelReservation(t), pad)),
        ...lanes.map((l) => inflate(l, pad)),
    ];
    const caps: Cap[] = [];
    for (let i = 0; i < want; i++) caps.push(pickCap(rng));
    caps.sort((a, b) => CAP_BOX[b].len - CAP_BOX[a].len);

    // 点阵播种,取代原本的均匀随机。见 `latticeSeats` 的注释:随机撒点的空隙尺寸也
    // 是随机的,所以必然留下车形大洞,而排名造不出一个从未出现过的整齐打包。
    //
    // 座位可能比车少(车道吃掉了地方),也可能比车多。少了就让剩下的车回到随机播种
    // ——关系放松仍会把它们安顿好,只是那几辆的间距不受点阵保证;多了就按顺序取用。
    const rowPitch = CAP_BOX.big.wid * CAR_SCALE;
    const seats = latticeSeats(lanes, LOT.w, LOT.h, GAP, rowPitch, rng);
    const pieces: Piece[] = caps.map((cap, i) => {
        const seat = seats[i];
        if (seat) return { x: seat.x, y: seat.y, angle: seat.angle, cap };
        let p: Piece;
        for (let k = 0; ; k++) {
            const angle = (Math.floor(rng() * HEADINGS) % HEADINGS) * HEADING_STEP;
            p = { x: (rng() - 0.5) * LOT.w, y: (rng() - 0.5) * LOT.h, angle, cap };
            clampInside(p);
            if (k + 1 >= SEED_TRIES) break;
            if (!reserved.some((r) => overlapMTV(packBox(p), r))) break;
        }
        return p;
    });

    // 关系放松以下完全不变。
```

并在 `generateLevel` 的调用点(约 line 1327)传入车道:

```ts
const lanes = skeletonLanes(skeletonShape(id), LOT.w, LOT.h);
const pieces = pack(rng, p.cars - tp.count * tp.cars, tunnels, lanes);
```

`GAP` 加在 `level-gen.ts` 的常量区,`CARS_PER_LEVEL` 附近:

```ts
/**
 * 点阵的缝宽,本设计唯一的密度旋钮。
 *
 * "间距再大一些"调的就是这个数。`CARS_PER_LEVEL` 因此从目标变成了结果——点阵间距
 * 和车道面积一起决定能坐下多少车,保留两个互相矛盾的旋钮只会让它们打架。它仍然是
 * 一个上限,以便乘客预算有硬边界。
 *
 * 0.25 是初值,由 Task 4 的标定扫描定下最终值。
 */
export const GAP = 0.25;
```

- [ ] **Step 4: 跑测试**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts && npx jest tests/level-gen.test.ts`
Expected: `lot-skeleton` 全过;`level-gen` 除了那条 `test.skip` 之外全过

- [ ] **Step 5: 跑一次真实生成,确认没有把生成器弄崩**

Run: `cd logic && npm run gen -- --only 2`(约 2 分钟,**放后台**)
Expected: 正常写出一关并打印表格。记下 `cars / blocked / rounds / holes / packing / play` 六个数,Task 5 要用。

**若这一步打出 `NO WAY THROUGH` 或生成失败**:停下,不要继续 Task 5。把打印的表格和 `git diff` 带回给人类伙伴——这是 spec §7.1 写明的止损点。

- [ ] **Step 6: 还原被这次试跑改写的关卡文件**

```bash
git checkout -- game/assets/resources/levels/
```

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/core/level-gen.ts logic/tests/level-gen.test.ts
git commit -m "feat(core): the packer seeds on a lattice and packs around lanes"
```

---

### Task 5: 标定 `GAP`

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts`(`GAP` 的值与它的注释)

这是一个**测量任务**,不是 TDD 任务。产出是一个定下来的常量和一张记录在注释里的表。

- [ ] **Step 1: 第一步——在第 2 关上扫点阵**

对 `GAP ∈ {0.15, 0.20, 0.25, 0.30, 0.35}` 逐个:改 `GAP` 的值,然后

```bash
cd logic && npm run gen -- --only 2      # 约 2 分钟,放后台
```

记录每档的 `cars`、`holes`(big/medium/small)、`blocked`、`play` 四列。
第 2 关的骨架是 `none`,所以这一步标定的是**点阵本身**,与车道无关。

- [ ] **Step 2: 选值**

取**满足 `big === 0` 的最小 `GAP`**。最小是因为间距越大难度越低。

**同时看 `blocked`**:如果选中那一档的 `blocked` 比基线(89 辆车时 72)掉了超过三成,停下,带着表格回报人类伙伴。这是 spec §7.1 的止损点,不是可选的。

- [ ] **Step 3: 第二步——在有车道的关上确认**

用选定的 `GAP` 生成第 6 关(`ring`,车道最多的一档):

```bash
cd logic && npm run gen -- --only 6      # 有隧道,约 4.5 分钟,放后台
```

用**排除车道**的方式量洞——写一个一次性脚本,读刚生成的 `level-6.json`,调
`fillableHoles(level, skeletonLanes('ring', LOT.w, LOT.h))`,确认 `big === 0`。

若不为 0,检查多出来的 `big` 洞位置是否落在车道上。落在车道上说明排除区没生效(回
Task 3 查);不在车道上说明 `GAP` 对有车道的关卡不够,回 Step 1 取下一档。

- [ ] **Step 4: 把表写进注释并提交**

```bash
git checkout -- game/assets/resources/levels/
git add game/assets/scripts/core/level-gen.ts
git commit -m "feat(core): GAP calibrated, with the sweep that chose it"
```

`GAP` 的注释里必须留下 Step 1 那张表——下一个人要改这个数时,需要知道其他档位是什么样子,而不是重扫一遍。

---

### Task 6: 重新测定 `blockedRatio`

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts`(`BLOCKED_FIRST` / `BLOCKED_LAST` 及其注释)

- [ ] **Step 1: 量三关**

```bash
cd logic && npm run gen -- --only 2      # 约 2 分钟
cd logic && npm run gen -- --only 5      # 约 4.5 分钟
cd logic && npm run gen -- --only 8      # 约 4.5 分钟
```

逐关记录实际的 `blocked / cars`。

- [ ] **Step 2: 重设两端**

`BLOCKED_FIRST` 取第 2 关的实测比例,`BLOCKED_LAST` 取第 8 关的实测比例,中间由
`levelParams` 原有的线性插值补齐。

判据:十关的 `packing` 列**全部为 `on target`**,不接受 `NEAREST MISS`。

- [ ] **Step 3: 更新注释**

`BLOCKED_FIRST` / `BLOCKED_LAST` 上方的注释详细写了旧值是怎么测出来的。**重写它**,
写明新值测自哪三关、在什么 `GAP` 和什么骨架曲线下——旧的测量过程对新几何不成立,
留着会误导。

- [ ] **Step 4: 提交**

```bash
git checkout -- game/assets/resources/levels/
git add game/assets/scripts/core/level-gen.ts
git commit -m "feat(core): the blocked band re-measured for the skeleton's geometry"
```

---

### Task 7: 全量重生成 + BAND_CURVE 两轮重扫

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts`(`BAND_CURVE`)
- Modify: `game/assets/resources/levels/level-2.json` … `level-10.json`

**这一步不可跳过,理由在 spec §4.4**:2026-09-18 实测,仅仅把车数从 89 降到 76,
第 2 关的通过 offset 集合就从 `{0, 4}` 变成 `{0, 24, 40}`;第 3、8、10 关是孤岛
(只有单独一个 offset 通过,两侧皆败)。同一次实测中 33 个组合有 20 个 `fair = n`,
即**不可通关**。

- [ ] **Step 1: 全量重生成(第一轮)**

```bash
cd logic && npm run gen        # 十关,约 35 分钟,放后台
```

`level-1.json` 必须逐字节不变(`git diff` 确认),它是手写关。

- [ ] **Step 2: 第一轮扫描**

```bash
cd logic && npm run sweep      # 十关,约 40 分钟,放后台
```

- [ ] **Step 3: 定 offset**

每关取一个 `hard=Y fair=Y` 且 `il=1` 的 offset。优先取**通过区间的中段**而不是孤岛
——旧曲线有三个孤岛是历史包袱,不是目标。若某关只有孤岛可选,在 `BAND_CURVE` 的行
末注释里写明它是孤岛以及两侧的失败情况。

旧曲线要求非递减(越后面的关错位越多)。**若新数据让非递减无法满足,以 hard ∧ fair
为准,并在注释里写明这条规则在哪一关破了、为什么**——可通关性优先于曲线的形状。

- [ ] **Step 4: 全量重生成(第二轮)**

```bash
cd logic && npm run gen        # 约 35 分钟,放后台
```

必要:第一轮的配色是在旧 offset 下搜出来的。

- [ ] **Step 5: 第二轮扫描确认**

```bash
cd logic && npm run sweep      # 约 40 分钟,放后台
```

确认每关 `<- curve` 标记的那一行是 `hard=Y fair=Y`。**这一轮才算数**——工具自己的
注释就是这么写的。

若有关卡在第二轮掉了,回 Step 3 给那一关换一个 offset,只重生成那一关
(`npm run gen -- --only N`),再单独扫它(`npm run sweep -- --only N`)。

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/core/level-gen.ts game/assets/resources/levels/
git commit -m "feat(core): BAND_CURVE re-swept for the skeleton, levels regenerated"
```

---

### Task 8: 验收断言

**Files:**
- Modify: `logic/tests/level-gen.test.ts`

把 spec §4.5 的判据固化成对**已提交 JSON** 的断言。Task 4 里标了 `test.skip` 的那条
在这里打开。

- [ ] **Step 1: 打开并补齐测试**

```ts
// 把 Task 4 的 test.skip 改回 test,并补上这三条

test('每关的洞都是刻意的:骨架之外没有大洞', () => {
  for (const id of PACKED) {
    const level = shipped(id);
    const lanes = skeletonLanes(skeletonShape(id), LOT.w, LOT.h);
    expect(fillableHoles(level, lanes).big).toBe(0);
  }
});

test('每关拿到了骨架曲线派给它的形状', () => {
  // 车道是空的,所以形状是从"哪里没有车"反推的:把该形状的车道叠上去,一辆车都不
  // 该压到。错误的形状会让某条车道压到车。
  for (const id of PACKED) {
    const level = shipped(id);
    const lanes = skeletonLanes(skeletonShape(id), LOT.w, LOT.h);
    for (const lane of lanes) {
      for (const car of level.lot.cars) {
        expect(overlapMTV(carBox(car), lane)).toBeFalsy();
      }
    }
  }
});

test('第 1 关仍然是那八辆手写的车', () => {
  const level = shipped(1);
  expect(level.lot.cars).toHaveLength(8);
  expect(skeletonShape(1)).toBe('none');
});
```

- [ ] **Step 2: 跑全量测试**

Run: `cd logic && npm test`
Expected: 26 套件全过,约 137 秒

- [ ] **Step 3: 人工确认那四张表**

`npm run gen` 最后打印的表格里逐关确认(用 Task 7 Step 4 那次的输出,不要重跑):

- `packing` 列全部 `on target`
- `play` 列全部 `hard (careless …)`
- `pax` 列全部 ≤ 2000
- `holes` 列的 big 全为 0(注意:工具打印的是**不排除车道**的洞数,所以有车道的关会
  有 big。以 Step 1 那条排除车道的测试为准,工具的表只用来看 packing/play/pax)

- [ ] **Step 4: 确认第 1 关没变**

```bash
git diff --stat HEAD~2 -- game/assets/resources/levels/level-1.json
```

Expected: 无输出

- [ ] **Step 5: 提交**

```bash
git add logic/tests/level-gen.test.ts
git commit -m "test(core): pin the skeleton's four acceptance criteria on the shipped levels"
```

---

## Self-Review

**Spec 覆盖检查:**

| spec 章节 | 对应任务 |
|---|---|
| §2.1 车道 = 保留区 | Task 4 |
| §2.2 点阵播种 | Task 2 + Task 4 |
| §2.3 车数成为推导量 | Task 4(`GAP` 常量的注释) |
| §2.4 骨架曲线 + 第 1 关豁免 | Task 1,Task 8 Step 4 |
| §3 难度风险与止损点 | Task 4 Step 5,Task 5 Step 2 |
| §4.1 `GAP` 两步标定 | Task 5 |
| §4.2 `blockedRatio` 重测 | Task 6 |
| §4.3 乘客预算 | Task 8 Step 3 |
| §4.4 BAND_CURVE 两轮重扫 | Task 7 |
| §4.5 验收 8 项 | Task 8(第 1–4 项 Step 3,第 5–6 项 Step 1,第 7 项 Step 4,第 8 项 Step 2) |
| §6 范围外 | Global Constraints 末行 |

**一处 spec 未覆盖而计划补上的:** spec 没说座位比车少怎么办。Task 4 的实现里写明
了——剩下的车回到随机播种,由关系放松安顿,并在注释里说清那几辆的间距不受点阵保证。

**类型一致性:** `skeletonShape` / `skeletonLanes` / `latticeSeats` / `LANE_W` / `GAP`
在 Task 1、2、4、8 中的拼写与签名一致;`fillableHoles(level, exclude?)` 在 Task 3
定义、Task 5 与 Task 8 使用,签名一致。
