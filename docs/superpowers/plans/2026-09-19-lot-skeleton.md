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
  // 半展长而不是外接半径。外接半径版本两边同时含 r,化简后是 |lane.x| <= W/2,
  // 而所有车道中心都在 {0, ±w/4} 上,恒成立——那个断言看起来像包含性检查,其实
  // 什么都没查。
  //
  // `<=` 而不是 `<`:spine 与 cross 的车道长度就等于场地边长,它们正好贴边,这是
  // 对的。
  const EPS = 1e-9;
  for (const shape of ['spine', 'cross', 'ring', 'star'] as SkeletonShape[]) {
    for (const lane of skeletonLanes(shape, W, H)) {
      expect(lane.wid).toBe(LANE_W);
      const rad = (lane.angle * Math.PI) / 180;
      const ex = (lane.len * Math.abs(Math.cos(rad)) + lane.wid * Math.abs(Math.sin(rad))) / 2;
      const ey = (lane.len * Math.abs(Math.sin(rad)) + lane.wid * Math.abs(Math.cos(rad))) / 2;
      expect(Math.abs(lane.x) + ex).toBeLessThanOrEqual(W / 2 + EPS);
      expect(Math.abs(lane.y) + ey).toBeLessThanOrEqual(H / 2 + EPS);
    }
  }
});

test('包含性断言真的会对一条伸出场地的车道失败', () => {
  // 上面那条断言化简后恒真过一次,所以它需要自证还看得见缺陷。
  const rogue = { x: 0, y: 0, angle: 0, len: W * 2, wid: LANE_W };
  const ex = rogue.len / 2;
  expect(Math.abs(rogue.x) + ex).toBeGreaterThan(W / 2);
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

test('所有座位同一个朝向,而且那个朝向来自骨架', () => {
  // 点阵的行距垂直于车身、行内步长平行于车身,所以整片点阵只能有一个方向:
  // 让某些座位横过来会让车身长边落在按车宽算出来的行距上,大面积重叠。
  const spine = latticeSeats(skeletonLanes('spine', W, H), W, H, 0.25, 0.8, seedRng(2));
  expect(new Set(spine.map((s) => s.angle)).size).toBe(1);
  expect(spine[0].angle).toBe(90);            // spine 的车道是 90 度

  const cross = latticeSeats(skeletonLanes('cross', W, H), W, H, 0.25, 0.8, seedRng(2));
  expect(new Set(cross.map((s) => s.angle)).size).toBe(1);
  expect(cross[0].angle).toBe(90);            // cross 的第一条车道是 90 度

  const bare = latticeSeats([], W, H, 0.25, 0.8, seedRng(2));
  expect(new Set(bare.map((s) => s.angle)).size).toBe(1);
  expect(bare[0].angle).toBe(90);             // 无车道时朝上

  // ring 的第一条车道是 0 度,是唯一能区分"读了 lanes"和"写死 90"的形状——没有它,
  // latticeAngle 直接 return 90 也能让 11 个测试全过。
  const ring = latticeSeats(skeletonLanes('ring', W, H), W, H, 0.25, 0.8, seedRng(2));
  expect(new Set(ring.map((s) => s.angle)).size).toBe(1);
  expect(ring[0].angle).toBe(0);
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
 * 整片点阵只有一个方向,取自骨架的第一条车道,没有车道时朝上——见 `latticeAngle`,
 * 那里写了为什么不能按座位各取最近的车道。自由角度没有作废,只是从随机取八向之一
 * 变成跟着骨架取向。
 */
export function latticeSeats(
    lanes: OBB[], w: number, h: number, gap: number, rowPitch: number, rng: () => number,
): { x: number; y: number; angle: number }[] {
    const seats: { x: number; y: number; angle: number }[] = [];
    const angle = latticeAngle(lanes);
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const pitch = rowPitch + gap;     // 垂直于车身:按车宽
    const along = 1.0 + gap;          // 平行于车身:按最常见的小车身长 0.887 向上取整到 1.0
    const jitter = gap * JITTER_F;

    // `u` 沿车身方向,`v` 垂直于它。点阵在 (u, v) 里是规整的,再旋到场地坐标系 ——
    // 直接在 x/y 上排而让车斜着或竖着躺,就是把车长放在按车宽算出的间距上。
    //
    // 扫描范围取场地对角线的一半:场地四角到原点正是这个距离,所以旋到任何角度都还
    // 够得着。落在场地外的座位在下面逐个剔除,多扫一些只是浪费几次循环。
    //
    // 这是余量,不是保证,差别在整行错位——它把一行的起点最多右移 `along / 2`,负 u
    // 那一端就少扫这么多。算过:reach = 7.2111,角度 90 下需要覆盖 h/2 = 6,余量
    // 1.2111;测试扫到的最大 gap 0.45 只吃掉 0.725。gap 大到 1.4222 才会真的漏一条,
    // 远在本设计的标定范围之外。
    const reach = Math.hypot(w, h) / 2;
    for (let v = -reach; v <= reach; v += pitch) {
        // 整行错位,让相邻两行不是一把梳子。
        const stagger = rng() < 0.5 ? 0 : along / 2;
        for (let u = -reach + stagger; u <= reach; u += along) {
            const ju = u + (rng() - 0.5) * jitter;
            const jv = v + (rng() - 0.5) * jitter;
            const sx = ju * cos - jv * sin;
            const sy = ju * sin + jv * cos;
            if (Math.abs(sx) > w / 2 || Math.abs(sy) > h / 2) continue;
            const dot: OBB = { x: sx, y: sy, angle: 0, len: 1e-6, wid: 1e-6 };
            if (lanes.some((l) => overlapMTV(dot, l))) continue;
            seats.push({ x: sx, y: sy, angle });
        }
    }
    return seats;
}

/**
 * 整片点阵的方向:骨架第一条车道的角度,没有车道就朝上。
 *
 * 一个角度而不是每个座位各自取最近的车道,而这一条是本模块最容易写错的地方。行距
 * 垂直于车身、行内步长平行于车身——两者都是按"车朝哪边"算出来的。让一部分座位横
 * 过来,它们的车身长边(大车 1.650)就会落在按车宽(0.524)算出来的行距上,重叠一大
 * 片,然后全部丢给关系放松去救,点阵播种的意义当场归零。
 *
 * 代价是全场车身平行。参考图 2 里大部分车本来就是同向的,所以这大概率不是问题;
 * 真觉得太规整时,要改的是给每个区块各建一套点阵,而不是在这里放宽。
 */
function latticeAngle(lanes: OBB[]): number {
    return lanes.length === 0 ? 90 : lanes[0].angle;
}
```

- [ ] **Step 4: 跑测试,确认全过**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts`
Expected: PASS,11 个测试(Task 1 的 6 个 + 本任务 5 个)

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
test('排除整块场地之后一个洞都不剩,所以排除区真的被算进去了', () => {
  const level = shipped(2);
  // 先证明这一关本来就有洞可数,否则下面那条断言会空过。
  const bare = fillableHoles(level);
  expect(bare.big + bare.medium + bare.small).toBeGreaterThan(0);

  // 一块盖住整个场地的排除区。若 `exclude` 被收下却没算进 `taken`,这里会原样返回
  // `bare`,断言当场失败。
  //
  // 上一版写的是 `masked <= bare`,那是个空壳:"多加障碍只会让洞变少"是算法的构造
  // 性质,参数被忽略时两者恰好相等,`<=` 照样通过——它分不出"实现了"和"收下就扔"。
  // 这是本计划里第三个同样形状的断言(另两个:Task 1 的包含性检查、Task 2 的 ring
  // 角度),所以写测试时要问的那句话是:如果这个功能是个空操作,它还会通过吗。
  //
  // OBB 的 `len` 沿 `angle`、`wid` 垂直于它,所以角度 0 时这块盒子横跨 x 方向
  // `LOT.w`、纵跨 y 方向 `LOT.h`,正好是整个场地。
  const whole = [{ x: 0, y: 0, angle: 0, len: LOT.w, wid: LOT.h }];
  expect(fillableHoles(level, whole)).toEqual({ big: 0, medium: 0, small: 0 });
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
- Modify: `game/assets/scripts/core/lot-skeleton.ts`(`latticeSeats` 加 `cross` 参数,新增 `shuffled`)
- Modify: `logic/tests/lot-skeleton.test.ts`
- Modify: `game/assets/scripts/core/level-gen.ts`(`pack` 的签名与播种段、`scatter` 与 `generateLevel` 的调用点)
- Modify: `logic/tests/level-gen.test.ts`

**Interfaces:**
- Consumes: `skeletonShape`、`skeletonLanes`、`latticeSeats`、`LANE_W` from Tasks 1–2
- Produces: `pack(rng, want, tunnels, lanes)` 多一个参数;`export const GAP = 0.25` 与
  `export const CROSS = 0.2`(Task 5 标定后改值);`latticeSeats` 多一个 `cross` 参数;
  `export function shuffled<T>(items: T[], rng: () => number): T[]`(在 `lot-skeleton.ts`)

**本任务同时修订 Task 2 的 F2 裁定**(见 spec §2.5):点阵只定位置,朝向按 `CROSS` 混入
一部分转 90° 的车,且座位顺序要打散。Task 2 那条"全场一个朝向"的裁定是实测证伪的——它
不是观感问题,是难度问题。

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
 * 0.25 是初值,由 Task 5 的标定扫描定下最终值(Task 4 扫的是 `CROSS`)。
 */
export const GAP = 0.25;
```

- [ ] **Step 4: 写 `lot-skeleton.ts` 的失败测试**

追加到 `logic/tests/lot-skeleton.test.ts`,并把文件里**已有的每一处** `latticeSeats(...)`
调用末尾补上 `, 0`(保持原有断言的语义不变:那些测试测的是"不横过来"的点阵):

```ts
test('cross = 1 时每个座位都横过来,cross = 0 时一个都不横', () => {
  const up = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 0);
  const across = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 1);
  expect(new Set(up.map((s) => s.angle))).toEqual(new Set([90]));
  expect(new Set(across.map((s) => s.angle))).toEqual(new Set([180]));
});

// 位置与朝向解耦,是 Task 5 能把 CROSS 当单变量标定的前提:两档跑出来的点阵逐点
// 重合,分数的差别才只能来自朝向。这条也顺带咬住"cross 抽签必须无条件抽、抽在剔除
// 之前"——少抽一次,rng 流就错位,位置全都对不上。
test('横过来的只是朝向,位置一个都没动', () => {
  const up = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 0);
  const across = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 1);
  expect(across.map((s) => ({ x: s.x, y: s.y }))).toEqual(up.map((s) => ({ x: s.x, y: s.y })));
});

test('中间档位是个比例,不是开关', () => {
  const some = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 0.3);
  const turned = some.filter((s) => s.angle === 180).length / some.length;
  expect(turned).toBeGreaterThan(0.15);
  expect(turned).toBeLessThan(0.45);
});

// 三条断言各挡一种坏实现:不是排列(漏元素/改元素)、原样返回(洗了个寂寞)、
// 不确定(同种子两次不一样,关卡生成就不可复现了)。
test('洗牌是同一批元素换个顺序,而且确实换了', () => {
  const items = Array.from({ length: 200 }, (_, i) => i);
  const a = shuffled(items, seedRng(4));
  expect([...a].sort((x, y) => x - y)).toEqual(items);
  expect(a).not.toEqual(items);
  expect(shuffled(items, seedRng(4))).toEqual(a);
});
```

- [ ] **Step 5: 跑测试,确认新的四条失败**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts`
Expected: FAIL —— `shuffled` 未定义,`cross` 参数被忽略

- [ ] **Step 6: 实现 `cross` 与 `shuffled`**

`latticeSeats` 加末位参数,内循环里加一次**无条件**抽签:

```ts
export function latticeSeats(
    lanes: OBB[], w: number, h: number, gap: number, rowPitch: number, rng: () => number,
    cross: number,
): { x: number; y: number; angle: number }[] {
```

```ts
            const ju = u + (rng() - 0.5) * jitter;
            const jv = v + (rng() - 0.5) * jitter;
            // 这一抽无条件抽,且抽在两条剔除之前:座位位置因此与 `cross` 完全无关,
            // 两个 cross 值跑出来的点阵逐点重合,标定时才是单变量比较。挪到剔除之后、
            // 或者用 `cross > 0 &&` 短路掉,都会让 rng 流随 cross 变化而错位。
            const turn = rng() < cross;
            const sx = ju * cos - jv * sin;
            const sy = ju * sin + jv * cos;
            if (Math.abs(sx) > w / 2 || Math.abs(sy) > h / 2) continue;
            const dot: OBB = { x: sx, y: sy, angle: 0, len: 1e-6, wid: 1e-6 };
            if (lanes.some((l) => overlapMTV(dot, l))) continue;
            seats.push({ x: sx, y: sy, angle: turn ? (angle + 90) % 360 : angle });
```

`latticeAngle` 上方那段"代价是全场车身平行"的注释必须改写——它现在描述的是一个被实测
推翻的设计,留着会误导下一个人把 `CROSS` 当噪声删掉。改成:方向仍然只有一个,`cross`
在它之上混入垂直的一档,而不是让座位各取最近的车道(那条路仍然是错的,理由不变)。

文件末尾加 `shuffled`:

```ts
/**
 * 同一批元素,顺序打散。用传入的 `rng`,所以同一个种子出同一个顺序。
 *
 * 存在的理由在 `pack()` 的调用点:那里的车按车长从大到小排过序,而点阵是一行一行
 * 生成的,顺次取用会把大车全堆在场地的一头——一个随机播种从来没有的尺寸分层。
 */
export function shuffled<T>(items: T[], rng: () => number): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
    }
    return out;
}
```

`CROSS` 加在 `level-gen.ts` 里 `GAP` 的紧后面:

```ts
/**
 * 点阵里横过来的车所占的比例,本设计的第二个旋钮。
 *
 * 难度来自车互相挡道,而互相挡道需要朝向不一致。全场同向的停车场整齐,但它没有谜题
 * ——第一次真实生成量到:第 2 关没有车道,唯一的变量就是点阵加统一朝向,`blocked`
 * 只从 72 掉到 68,`rounds` 却从 17 塌到 10(89 辆车 10 个回合约等于每轮走九辆,一整
 * 排一起离场),`play` 从 hard 变成 FREE——一行策略就能赢。
 *
 * 横过来的车会把邻座挤开,局部破坏点阵的均匀间距,那正是难度要的不规则。0 到 1 之间
 * 连续地从"整齐"走到"混乱"。0.2 是初值,由 Task 5 与 `GAP` 一起标定。
 */
export const CROSS = 0.2;
```

`pack()` 的播种段里,座位一行改成:

```ts
    const rowPitch = CAP_BOX.big.wid * CAR_SCALE;
    // 座位要打散:上面的 caps 按车长从大到小排过序,而点阵一行一行生成,顺次取用会
    // 把大车全堆在场地的一头,分层到可以一层一层剥掉。
    const seats = shuffled(latticeSeats(lanes, LOT.w, LOT.h, GAP, rowPitch, rng, CROSS), rng);
```

- [ ] **Step 7: 跑测试**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts && npx jest tests/level-gen.test.ts`
Run: `cd logic && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.gen.json --noEmit`
(`logic/package.json` 里**没有** `typecheck` 这个脚本,只有 `typecheck:view`。)
Expected: `lot-skeleton` 全过;`level-gen` 除了那条 `test.skip` 之外全过

- [ ] **Step 8: 四档探针,确认难度回来了**

第 2 关的骨架是 `none`,所以这四跑与车道无关,量的纯粹是播种。每跑约 2 分钟,**放后台**:

| # | 设置 | 怎么改 |
|---|---|---|
| P1 | `CROSS = 0`,不洗牌 | 把 `shuffled(...)` 那层临时去掉 |
| P2 | `CROSS = 0`,洗牌 | 恢复 `shuffled`,`CROSS = 0` |
| P3 | `CROSS = 0.2`,洗牌 | |
| P4 | `CROSS = 0.35`,洗牌 | |

Run: `cd logic && npm run gen -- --only 2`
每跑记下 `cars / blocked / rounds / score / holes / packing / play` 七列,连同基线一起列表:

```
        cars  colors  blocked/want  rounds/min  score   pax   holes  inward  packing       play
旧打包器  89       5       72/71       17/2      289  1896  2/0/0    39%   on target     hard (careless 100%)
```

P1 是上一轮那次跑动的复现(rounds 10、FREE),它在这里的作用是**对照组**:没有它,后面
三档的差值不知道该跟谁比。

- [ ] **Step 9: 定档**

取**最小的、能让 `play` 回到 `hard` 的 `CROSS`**,洗牌保留。把 `CROSS` 的值和 Step 8 那
张表写进它的注释里——下一个人要动这个数时需要看到其他档是什么样子。

**止损点:若 P2/P3/P4 三档全都打不出 `hard`**,停下,不要继续 Task 5。把整张表和
`git diff` 带回给人类伙伴。这是 spec §7.1 的止损点,不是可选的。

- [ ] **Step 10: 用定下来的档位再跑一次,把关卡文件留在工作区**

```bash
cd logic && npm run gen -- --only 2
```

这次**不**还原 `game/assets/resources/levels/level-2.json`——留着未提交,人类伙伴要在
编辑器里看这一关长什么样。下面的 `git add` 逐个点名,所以它不会被带进提交。

- [ ] **Step 11: 提交**

```bash
git add game/assets/scripts/core/lot-skeleton.ts game/assets/scripts/core/level-gen.ts \
        logic/tests/lot-skeleton.test.ts logic/tests/level-gen.test.ts
git commit -m "feat(core): the packer seeds on a lattice and packs around lanes"
```

---

### Task 4b: 行内步长按车长 —— `latticeSeats` 从"撒座位"改成"铺车"

**Files:**
- Modify: `game/assets/scripts/core/lot-skeleton.ts`(`latticeSeats` 换契约)
- Modify: `logic/tests/lot-skeleton.test.ts`
- Modify: `game/assets/scripts/core/level-gen.ts`(`pack` 的播种段)
- Modify: `logic/tests/level-gen.test.ts`(Task 4 留下的两条 `test.skip`)

**Interfaces:**
- Consumes: `skeletonLanes`、`skeletonShape`、`shuffled`、`GAP`、`CROSS`
- Produces: `latticeSeats(lanes, blocked, w, h, gap, rng, cross, bodies)`,`Body`、`Seat` 两个导出类型。`rowPitch` 参数消失(改为从 `bodies` 推导)

#### 为什么要改:这是 spec §2.2 与实现之间的分歧,不是调参

spec §2.2 写的是:

> - **行**垂直于该区块的主车道方向,行距 = `CAP_BOX.big.wid * CAR_SCALE + GAP`
> - **行内**沿车道方向排布,车距 = `该车 len * CAR_SCALE + GAP`

行距照做了(按最宽的车),**行内没有**:实现写死了 `along = 1.0 + gap` = 1.25。实测三种车的 `packBox` 长度:

| | 车身长 | `packBox` 长 | 与步长 1.250 |
|---|---|---|---|
| 小 | 0.887 | 0.995 | 放得下 |
| 中 | 1.482 | 1.590 | **重叠 0.340** |
| 大 | 1.650 | 1.758 | **重叠 0.508** |

也就是说**同一行里两辆大车一出生就压在一起**,压掉近三成车身,然后全部丢给关系放松去救。这解释了三件本来各自孤立的事:

1. 第 2 关(无车道)的收敛率只有 **4/20** —— 点阵本该让播种几乎不重叠,结果比随机撒点好不了多少
2. 加上车道后收敛率变 **0/60**,`generateLevel(3)` 生成出零辆车 —— 车道吃掉腾挪空间,放松再也化解不了这些内生重叠
3. 座位供给对不上:`GAP = 0.25` 时 star 只有 69 个原始座位,而它要 81 辆车

**一个均匀点阵同时服务三种车长是做不到的**:按小车定步长必然压住大车,按大车定步长要浪费三分之一的地。所以按 spec 的原意改——行内**逐辆按这辆车自己的长度往前走**。

#### 新契约

```ts
/** 车身尺寸,已经乘过 `CAR_SCALE`。`len` 沿车身,`wid` 垂直于它,与 OBB 一致。 */
export interface Body { len: number; wid: number }

export interface Seat { x: number; y: number; angle: number }
```

```ts
/**
 * 把 `bodies` 按顺序铺成沿骨架方向的松散行列。
 *
 * 返回的第 i 个座位就是 `bodies[i]` 的位置,所以**返回数组与入参逐位对应**;铺不下的
 * 车不返回,数组因此可能比 `bodies` 短,由调用方决定怎么安置它们。
 *
 * 这与"先撒一片座位、再把车填进去"的差别是本模块存在的理由:座位要多长,取决于坐
 * 它的那辆车有多长,而一个均匀点阵没法同时服务 0.887 和 1.650 两种车身——按小的定
 * 就压住大的(实测同行两辆大车重叠 0.508),按大的定就浪费三分之一的地。
 *
 * `lanes` 只用来定方向(见 `latticeAngle`),`blocked` 是不能压的地方(车道和隧道,
 * 由调用方膨胀好再传进来)——两者分开,是因为无车道而有隧道的关卡不能拿隧道定方向。
 */
export function latticeSeats(
    lanes: OBB[], blocked: OBB[], w: number, h: number, gap: number,
    rng: () => number, cross: number, bodies: Body[],
): Seat[]
```

算法,逐条都要照做:

1. `angle = latticeAngle(lanes)`,`pitch = max(bodies.map(b => b.wid)) + gap`,`reach = hypot(w, h) / 2`
2. 在 `(u, v)` 旋转坐标系里,`v` 从 `-reach` 每次走 `pitch`,直到 `> reach` 或车用完
3. 每行开头照旧掷一次整行错位:`rng() < 0.5 ? 0 : pitch / 2`(**改成按 `pitch` 错位**,因为行内步长不再是常数,拿它的一半错位没有意义)
4. 行内:`u` 从 `-reach + stagger` 起。取还没安置的那辆车 `bodies[k]`:
   - 掷 `turn = rng() < cross`(**无条件掷、掷在所有剔除之前**,理由见 `cross` 的注释:位置必须与 `cross` 无关)
   - 沿行方向占的长度 `extent = turn ? b.wid : b.len`,座位中心在 `u + extent / 2`
   - 抖动 `gap * JITTER_F` 照旧,加在中心上
   - 旋到场地坐标得到 `(sx, sy)`,车的 OBB 是 `{ x: sx, y: sy, angle: turn ? (angle + 90) % 360 : angle, len: b.len, wid: b.wid }`
   - **用车身而不是中心点做两项剔除**:`insideRect(box, w, h)` 必须为真;`blocked.some((r) => overlapMTV(box, r))` 必须为假
   - 通过就 `push` 这个座位、`k++`;不通过**不要 `k++`**——同一辆车去试这一行的下一个位置
   - 无论通过与否,`u += extent + gap`
5. 车用完就返回

第 4 步那个"不通过不推进 `k`"是要害:它让一辆车绕过车道继续往前找,而不是把这辆车丢掉。

#### `pack()` 怎么接

```ts
    // 尺寸要打散:`caps` 按车长排过序,而行是一行一行铺的,顺着铺会把大车全堆在场
    // 地的一头,分层到可以一层一层剥掉。打散的是**铺车的顺序**,不是座位——新契约
    // 下座位和车是绑定的,再去洗座位就把这个对应关系洗掉了。
    const order = shuffled(caps, rng);
    const bodies = order.map((c) => ({
        len: CAP_BOX[c].len * CAR_SCALE, wid: CAP_BOX[c].wid * CAR_SCALE,
    }));
    const seats = latticeSeats(lanes, reserved, LOT.w, LOT.h, GAP, rng, CROSS, bodies);
    const pieces: Piece[] = order.map((cap, i) => {
        const seat = seats[i];
        if (seat) return { x: seat.x, y: seat.y, angle: seat.angle, cap };
        // 这一辆没铺下:退回随机播种,和从前一样。
        ...原样保留 SEED_TRIES 那段,连同 Task 4 修复轮恢复的注释...
    });
```

`pieces` 因此按 `order` 而不是按车长排列,这改变了关系放松扫描车对的顺序。**在 `pack` 的
文档注释里写明这件事**,并说清为什么可以接受:新播种几乎不自带重叠,放松不再是"把一
大堆互相压着的车推开",扫描顺序的偏置也就不再是那段注释所描述的那件事。

Task 4 加的那层 `taken` 首次适配**整个删掉**——座位与车一一对应之后,它没有意义了。
`reserved` 的检查也不必在这里重做一遍:`latticeSeats` 已经拿车身对着 `blocked` 剔过。

- [ ] **Step 1: 改写 `lot-skeleton.test.ts` 里所有 `latticeSeats` 调用,并加新断言**

已有的调用全部要改签名。把"座位数随 gap 变化"这类还成立的断言留着,改掉参数即可;
断言"所有座位同一朝向"的那几条在 `cross = 0` 下仍然成立。

新增,每条都要经得起"功能变成空操作还会不会过"这一问:

```ts
const SMALL: Body = { len: 0.887, wid: 0.433 };
const BIG: Body = { len: 1.650, wid: 0.524 };

// 这条是本任务存在的理由:旧实现步长写死 1.25,两辆大车中心只隔 1.25,必然重叠。
test('同一行里相邻两辆车不重叠,大车也不重叠', () => {
  const bodies = Array.from({ length: 60 }, () => BIG);
  const seats = latticeSeats([], [], W, H, 0.25, seedRng(3), 0, bodies);
  const boxes = seats.map((s, i) => ({ ...s, len: bodies[i].len, wid: bodies[i].wid }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(overlapMTV(boxes[i], boxes[j])).toBeFalsy();
    }
  }
});

// 步长真的跟着车走:同样的场地,全小车能铺下的数量必须明显多于全大车。
test('步长按车长,所以小车铺得比大车多', () => {
  const small = latticeSeats([], [], W, H, 0.25, seedRng(3), 0,
    Array.from({ length: 200 }, () => SMALL)).length;
  const big = latticeSeats([], [], W, H, 0.25, seedRng(3), 0,
    Array.from({ length: 200 }, () => BIG)).length;
  expect(small).toBeGreaterThan(big * 1.4);
});

// 车身整个在场地内,不只是中心点在。
test('车身不许探出场地', () => {
  const bodies = Array.from({ length: 200 }, (_, i) => (i % 2 ? SMALL : BIG));
  const seats = latticeSeats([], [], W, H, 0.25, seedRng(5), 0.3, bodies);
  seats.forEach((s, i) => {
    expect(insideRect({ ...s, len: bodies[i].len, wid: bodies[i].wid }, W, H)).toBe(true);
  });
});

// 车身不许压车道 —— 中心点避开是不够的,这正是 Task 4 那个 Critical 的形状。
test('车身不许压进不能压的地方', () => {
  const lanes = skeletonLanes('ring', W, H);
  const bodies = Array.from({ length: 200 }, () => BIG);
  const seats = latticeSeats(lanes, lanes, W, H, 0.25, seedRng(7), 0, bodies);
  expect(seats.length).toBeGreaterThan(20);      // 不能靠一个都不铺来通过
  seats.forEach((s, i) => {
    for (const l of lanes) {
      expect(overlapMTV({ ...s, len: bodies[i].len, wid: bodies[i].wid }, l)).toBeFalsy();
    }
  });
});

// 铺不下的车不返回,而且返回的是前缀对应关系:第 i 个座位属于第 i 辆车。
test('返回数组与入参逐位对应,铺不下的不返回', () => {
  const bodies = Array.from({ length: 400 }, () => BIG);   // 远多于场地能放的
  const seats = latticeSeats([], [], W, H, 0.25, seedRng(9), 0, bodies);
  expect(seats.length).toBeLessThan(bodies.length);
  expect(seats.length).toBeGreaterThan(20);
});
```

`cross` 的两条老断言(全横 / 位置与 cross 无关)要保留并改签名。**位置那一条在新契约
下会变**:横过来的车沿行方向占 `wid` 而不是 `len`,后面的车位置因此不同。所以那条改成
只断言**朝向**的比例,并在注释里写明为什么位置不再相同——这是新设计的必然结果,不是
退化。单变量标定的前提因此换成"同一组 bodies、同一个种子、只改 cross",Task 5 照此执行。

- [ ] **Step 2: 跑测试,确认新的几条失败**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts`
Expected: FAIL —— 签名不符 / 大车重叠

- [ ] **Step 3: 实现**

按上面的算法改写 `latticeSeats`,删掉 `rowPitch` 参数,导出 `Body` / `Seat`。
`latticeAngle` 与它的注释**不动**。`JITTER_F` 不动。

- [ ] **Step 4: 跑测试**

Run: `cd logic && npx jest tests/lot-skeleton.test.ts`
Expected: 全过

- [ ] **Step 5: 接进 `pack()`,跑全量测试**

Run: `cd logic && npx jest tests/level-gen.test.ts`
Expected: 通过(约 190 秒)。Task 4 留下的两条 `test.skip` 里,`出货用的车数下,每种
骨架也打得出包` 那条**现在要打开**——它正是本任务的验收。打开后必须真的过;若过不了,
那就是 Step 7 的止损点。

Run: `cd logic && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.gen.json --noEmit`

- [ ] **Step 6: 四关真实生成**

各约 2 / 2 / 4.5 / 2 分钟,**放后台**,逐个跑不要并发:

```bash
cd logic && npm run gen -- --only 2      # 无骨架,对照
cd logic && npm run gen -- --only 3      # spine
cd logic && npm run gen -- --only 6      # ring + 隧道
cd logic && npm run gen -- --only 9      # star,座位最紧的一档
```

记下四行完整表格。判据:**四关的 `cars` 都要接近它的 `want`,不许是 0 或个位数。**

- [ ] **Step 7: 止损点**

若第 3、6、9 三关里**任何一关**仍然生成出零辆车或个位数车,**停下**,把四行表格、
`latticeSeats` 在四种骨架下的返回长度、以及各关的 `want` 一起带回。不要自己去改 `GAP`,
不要去改 `CROSS`,不要去动 spec §2.3 的溢出策略——那三条都是别的任务的,且已经有人
按不同判据选过值。

- [ ] **Step 8: 重新确认 `CROSS`(最多两跑)**

布局变了,Task 4 在旧点阵上定的 `CROSS = 0.35` 不一定还成立。看 Step 6 里第 2 关那一行:

- `play` 是 `hard` → 保持 0.35,记下新的一行数
- 是 `FREE` → 把 `CROSS` 提到 0.5 再跑一次第 2 关。仍是 `FREE` 就停下回报,**不要试第三档**

把结论和新的表格写进 `CROSS` 的注释,并注明旧表是在旧点阵上测的、已作废。

- [ ] **Step 9: 还原试跑改写的关卡文件,留下第 2 关**

```bash
git checkout -- game/assets/resources/levels/level-3.json \
                game/assets/resources/levels/level-6.json \
                game/assets/resources/levels/level-9.json
```

第 2 关留在工作区不提交,人类伙伴要看观感。

- [ ] **Step 10: 提交**

```bash
git add game/assets/scripts/core/lot-skeleton.ts game/assets/scripts/core/level-gen.ts \
        logic/tests/lot-skeleton.test.ts logic/tests/level-gen.test.ts
git commit -F <message file>
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

取**满足 `big === 0`(排除车道后量)的最大 `GAP`**。

不是"最小"——那是 spec 初稿的错,已改。缝越小洞越少,所以 `big === 0` 的集合是个从 0 起的区间,取其中最小的就是取 0。这条判据给的是上界:取不触发大洞的最大缝,难度另有旋钮管。

`CROSS` 保持 Task 4 定下的档位不动。若选中的 `GAP` 把 `play` 打回 `FREE`,把 `CROSS`
调高一档(+0.1)再确认一次——分工是 `GAP` 管空、`CROSS` 管难,不要用放宽 `big === 0`
来换难度。

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
