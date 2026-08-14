# 乘客转盘重做(双通道候车轨道)实现计划 (M6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把椭圆转盘换成圆角矩形轨道:底部缺口是上车口,左右两条候车通道补充乘客,左通道抽空后右通道才供应,且只有空位转到入口时候补乘客才能进入。

**Architecture:** 核心只改 `loop-system.ts`(单 pool + 单 channelIndex → 双队列 + 双入口,入口索引由 `boardIndex` 推出);视图重做 `track-view.ts`(圆角矩形按弧长参数化、ring 索引↔轨道位置固定绑定、出口/入口缺口、左右通道渲染),并修掉现有的双倍步进 bug。乘客到达顺序与今天完全一致,所以关卡数据、校验、编辑器、死局判定都不动。

**Tech Stack:** TypeScript、Cocos Creator 3.8.7(内置 primitives + `builtin-standard`/`builtin-unlit` 代码材质、`tween`)、jest(仅覆盖 `core/`)。

**Spec:** `docs/superpowers/specs/2026-08-14-passenger-track-redesign-design.md`

## Global Constraints

- 关卡数据格式、`validateLevel`、`solvability`、关卡编辑器**一行不改**。
- `logic/tests/game-core.test.ts` 的两个死局用例**不改且必须绿**;每个任务结束 `cd logic && npx jest` 必须全绿(当前 46 个)。
- 零外部素材:仅 Cocos 内置基元 + 代码材质。
- 保留 `BOARD_TILT=52`、相机 pos(0,5,12) lookAt(0,-0.3,0)、射线→gridRoot 局部→`pickCar` 流程。
- 视图层无单元测试。视图任务的验收 = jest 全绿 + **用户预览截图确认**;实现者**不得声称已渲染验证**。
- draw call 预算:第 2 关当前 244,本次新增控制在 +15 以内。
- 轨道几何常量:`W=3.4`(中心线半宽)、`H=1.5`(半高)、`R=0.9`(圆角半径)、`CURB_OFFSET=0.35`。
- 参数化约定:`t∈[0,1)` 按**弧长**、顺时针、`t=0` 在顶部正中;于是 `t=0.25` 右侧中点、`t=0.5` 底部正中、`t=0.75` 左侧中点。
- ring 索引 `i` 恒定画在 `t = i/capacity`;`phase` 只做 tick 之间的补间,静止时为 0。

---

## Task 1: 核心双通道(TDD)

**Files:**
- Modify: `game/assets/scripts/core/loop-system.ts`
- Test: `logic/tests/loop-system.test.ts`(全量改写)

**Interfaces:**
- Consumes: `QueueGroup` from `./types`(不变)。
- Produces:
  - `LoopSystem.left: string[]`、`LoopSystem.right: string[]`(取代 `pool`)
  - `LoopSystem.entryLeft: number`、`LoopSystem.entryRight: number`(只读,构造时算好)
  - 签名不变:`passengerAtBoard()`、`boardPassenger()`、`step()`、`remainingCount()`、`isDrained()`、`reachableColors(): Set<string>`
  - Task 2/3 会读 `left`/`right`/`entryLeft`/`entryRight`/`boardIndex`。

- [ ] **Step 1: 改写测试文件(第一轮:构造与补位)**

把 `logic/tests/loop-system.test.ts` 整个替换成:

```ts
import { LoopSystem } from '../../game/assets/scripts/core/loop-system';

test('ring takes the head of the queue and the remainder splits in half', () => {
  const loop = new LoopSystem(4, 2, [{ color: 'red', count: 6 }]);
  expect(loop.ring).toEqual(['red', 'red', 'red', 'red']);
  expect(loop.left).toEqual(['red']);
  expect(loop.right).toEqual(['red']);
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
  // ring = [a,b,c,d], both channels empty; index i moves to i+1 => [d,a,b,c]
  loop.step();
  expect(loop.ring).toEqual(['d', 'a', 'b', 'c']);
});

test('an emptied cell refills from the left channel when it reaches the entrance', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 3 }]);
  // ring=[x,x], left=[x], right=[]. capacity 2 => both entrances collapse to index 0.
  loop.boardPassenger();
  expect(loop.ring).toEqual(['x', null]);
  loop.step(); // rotate -> [null, x]; the hole is now at the entrance
  expect(loop.ring).toEqual(['x', 'x']);
  expect(loop.left).toEqual([]);
});

test('isDrained true only when both channels are empty and the ring is cleared', () => {
  const loop = new LoopSystem(2, 1, [{ color: 'x', count: 2 }]);
  expect(loop.isDrained()).toBe(false);
  loop.ring = [null, null];
  loop.left = [];
  loop.right = [];
  expect(loop.isDrained()).toBe(true);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd logic && npx jest tests/loop-system.test.ts`
Expected: FAIL —— ts-jest 编译错误 `Property 'left' does not exist on type 'LoopSystem'`。这是 TypeScript 里"接口还不存在"的正常红灯。

- [ ] **Step 3: 实现构造与单入口补位**

`game/assets/scripts/core/loop-system.ts`,替换 `pool` 字段、构造函数与 `step()` 的补位那几行:

```ts
export class LoopSystem {
  capacity: number;
  boardIndex: number;
  ring: (string | null)[];
  /** Waiting passengers in the left channel; drains before `right`. */
  left: string[];
  /** Waiting passengers in the right channel; only feeds once `left` is empty. */
  right: string[];
  /** Ring indices where each channel joins the track (a quarter lap either side of the exit). */
  readonly entryLeft: number;
  readonly entryRight: number;

  constructor(capacity: number, boardIndex: number, queue: QueueGroup[]) {
    this.capacity = capacity;
    this.boardIndex = boardIndex;
    const all: string[] = [];
    for (const g of queue) {
      for (let i = 0; i < g.count; i++) all.push(g.color);
    }
    // The track is filled from the head of the queue exactly as before; only what
    // is left over gets split, so the order passengers arrive in never changes.
    this.ring = new Array(capacity).fill(null);
    for (let i = 0; i < capacity && all.length > 0; i++) this.ring[i] = all.shift()!;
    const half = Math.ceil(all.length / 2);
    this.left = all.slice(0, half);
    this.right = all.slice(half);
    const quarter = Math.round(capacity / 4);
    this.entryLeft = (boardIndex + quarter) % capacity;
    this.entryRight = (boardIndex - quarter + capacity) % capacity;
  }
```

`step()` 暂时只用左入口(第二轮再加优先级):

```ts
  step(): void {
    const rotated: (string | null)[] = new Array(this.capacity).fill(null);
    for (let i = 0; i < this.capacity; i++) {
      rotated[(i + 1) % this.capacity] = this.ring[i];
    }
    this.ring = rotated;
    if (this.ring[this.entryLeft] === null && this.left.length > 0) {
      this.ring[this.entryLeft] = this.left.shift()!;
    }
  }
```

`remainingCount()` 与 `reachableColors()` 里的 `pool` 全部换成两条队列:

```ts
  remainingCount(): number {
    return this.left.length + this.right.length + this.ring.filter((x) => x !== null).length;
  }
```

`reachableColors()` 里原来的 `this.pool[i]` 改成:

```ts
      const c = i < this.left.length ? this.left[i] : this.right[i - this.left.length];
      if (c === undefined) break;
      reachable.add(c);
```

- [ ] **Step 4: 运行,确认通过**

Run: `cd logic && npx jest`
Expected: PASS,46 个测试全绿(`game-core.test.ts` 的两个死局用例不许改也不许红)。

- [ ] **Step 5: 写第二轮失败测试(双入口 + 左优先 + 空位放行)**

追加到 `logic/tests/loop-system.test.ts`:

```ts
// capacity 8 / boardIndex 0 => quarter = 2, entryLeft = 2, entryRight = 6.
function twoLane(): LoopSystem {
  return new LoopSystem(8, 0, [{ color: 'a', count: 8 }, { color: 'b', count: 4 }]);
}

test('entrances sit a quarter lap either side of the boarding index', () => {
  const loop = twoLane();
  expect(loop.entryLeft).toBe(2);
  expect(loop.entryRight).toBe(6);
  expect(loop.left).toEqual(['b', 'b']);
  expect(loop.right).toEqual(['b', 'b']);
});

test('the right entrance stays shut while the left channel still has passengers', () => {
  const loop = twoLane();
  loop.ring[5] = null;           // after the rotate this hole lands on entryRight
  loop.step();
  expect(loop.ring[6]).toBeNull();
  expect(loop.right).toEqual(['b', 'b']); // untouched
  expect(loop.left).toEqual(['b', 'b']);  // the hole never passed the left entrance
});

test('the right channel starts feeding once the left one is empty', () => {
  const loop = twoLane();
  loop.left = [];
  loop.ring[5] = null;
  loop.step();
  expect(loop.ring[6]).toBe('b');
  expect(loop.right).toEqual(['b']);
});

test('a hole that is not at an entrance is not refilled', () => {
  const loop = twoLane();
  loop.ring[0] = null;           // after the rotate this hole lands on index 1, no entrance
  loop.step();
  expect(loop.ring[1]).toBeNull();
  expect(loop.left).toEqual(['b', 'b']);
});
```

- [ ] **Step 6: 运行,确认失败**

Run: `cd logic && npx jest tests/loop-system.test.ts`
Expected: FAIL —— `the right channel starts feeding once the left one is empty` 报 `Expected: "b", Received: null`(此时 `step()` 只认左入口)。

- [ ] **Step 7: 实现左优先双入口**

把 `step()` 的补位部分改成:

```ts
    // One entrance is live at a time: the left channel drains first, and only then
    // does the right one open. That keeps the arrival order identical to a single
    // FIFO pool, which is what `reachableColors` (and the deadlock check) rely on.
    const useLeft = this.left.length > 0;
    const queue = useLeft ? this.left : this.right;
    const entry = useLeft ? this.entryLeft : this.entryRight;
    if (queue.length > 0 && this.ring[entry] === null) {
      this.ring[entry] = queue.shift()!;
    }
```

- [ ] **Step 8: 运行,确认通过**

Run: `cd logic && npx jest`
Expected: PASS,50 个测试全绿。

- [ ] **Step 9: 写第三轮失败测试(reachableColors 跨通道边界)**

追加:

```ts
test('reachable colors span the left-to-right channel boundary', () => {
  const loop = new LoopSystem(4, 0, [
    { color: 'a', count: 4 }, { color: 'b', count: 1 }, { color: 'c', count: 1 },
  ]);
  // ring = [a,a,a,a], left = ['b'], right = ['c']
  expect(loop.reachableColors()).toEqual(new Set(['a'])); // full ring: nothing new can enter
  loop.ring[0] = null;
  loop.ring[1] = null;
  // two holes -> the next two of (left ++ right) can get in
  expect(loop.reachableColors()).toEqual(new Set(['a', 'b', 'c']));
});
```

- [ ] **Step 10: 运行,确认通过或失败并修到通过**

Run: `cd logic && npx jest tests/loop-system.test.ts`
Expected: PASS(Step 3 已按 `left ++ right` 写好索引;若失败,说明越界处理写错,修 `reachableColors` 而不是改测试)。

- [ ] **Step 11: 全量回归**

Run: `cd logic && npx jest`
Expected: PASS,51 个测试全绿。

- [ ] **Step 12: 提交**

```bash
git add game/assets/scripts/core/loop-system.ts logic/tests/loop-system.test.ts
git commit -m "feat(core): M6.A twin feeder channels with left priority

Splits the hidden pool into left/right queues joined to the ring a quarter lap
either side of the boarding index. One entrance is live at a time -- left drains
first -- so the arrival order is identical to the single FIFO pool and both the
deadlock detection and the level data stay untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 圆角矩形轨道 + 运动模型修正

**Files:**
- Modify: `game/assets/scripts/view/track-view.ts`
- Modify: `game/assets/scripts/view/GameController.ts:180`(TrackView 构造参数)

**Interfaces:**
- Consumes: Task 1 的 `loop.boardIndex`、`loop.entryLeft`、`loop.entryRight`。
- Produces:
  - `new TrackView(parent, capacity, y, tick, entries: { board: number; left: number; right: number })`
  - `pathPoint(t, cy, out?)` 内部函数改成圆角矩形按弧长。
  - `mergeParts(parts): Mesh` 模块级工具(Task 3 可复用)。
  - **`update()` 保持单参 `update(ring)` 不动**;改三参签名和两处调用点(`GameController.ts:181`、`:230`)整体属于 Task 3,本任务不要动,否则调用点参数个数对不上编译不过。

- [ ] **Step 1: 换掉路径函数**

`track-view.ts` 顶部常量 `RX`/`RY` 换成:

```ts
const W = 3.4;   // half width of the circuit centerline
const H = 1.5;   // half height
const R = 0.9;   // corner radius
```

替换 `pathPoint`:

```ts
interface Seg { len: number; at: (u: number, out: Vec3) => void }

/**
 * The circuit as nine arc-length segments walked CLOCKWISE from the top centre,
 * so t=0 is top centre, t=0.25 the right midpoint, t=0.5 the bottom centre (the
 * boarding gap) and t=0.75 the left midpoint. The top straight is split in two so
 * the walk can start at its middle; by symmetry the quarter marks then land
 * exactly on the side midpoints.
 */
function buildSegments(cy: number): Seg[] {
    const sx = W - R, sy = H - R;
    const line = (x0: number, y0: number, x1: number, y1: number): Seg => ({
        len: Math.hypot(x1 - x0, y1 - y0),
        at: (u, out) => out.set(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 0),
    });
    // a0 is the start angle; the sweep is -90 degrees (clockwise).
    const corner = (cx: number, ccy: number, a0: number): Seg => ({
        len: (Math.PI / 2) * R,
        at: (u, out) => {
            const a = a0 - (Math.PI / 2) * u;
            out.set(cx + R * Math.cos(a), ccy + R * Math.sin(a), 0);
        },
    });
    const HP = Math.PI / 2;
    return [
        line(0, cy + H, sx, cy + H),
        corner(sx, cy + sy, HP),
        line(W, cy + sy, W, cy - sy),
        corner(sx, cy - sy, 0),
        line(sx, cy - H, -sx, cy - H),
        corner(-sx, cy - sy, -HP),
        line(-W, cy - sy, -W, cy + sy),
        corner(-sx, cy + sy, Math.PI),
        line(-sx, cy + H, 0, cy + H),
    ];
}

let SEGS: Seg[] | null = null;
let SEG_CY = NaN;
let PERIMETER = 0;

function segments(cy: number): Seg[] {
    if (SEGS && SEG_CY === cy) return SEGS;
    SEGS = buildSegments(cy);
    SEG_CY = cy;
    PERIMETER = SEGS.reduce((a, s) => a + s.len, 0);
    return SEGS;
}

/** Point at arc-length fraction t in [0,1) along the circuit. */
function pathPoint(t: number, cy: number, out: Vec3 = new Vec3()): Vec3 {
    const segs = segments(cy);
    let s = ((t % 1) + 1) % 1 * PERIMETER;
    for (const seg of segs) {
        if (s <= seg.len) { seg.at(seg.len > 0 ? s / seg.len : 0, out); return out; }
        s -= seg.len;
    }
    segs[segs.length - 1].at(1, out);
    return out;
}
```

- [ ] **Step 2: 用节点脚本自查参数化对不对**

Run:

```bash
node -e "
const W=3.4,H=1.5,R=0.9,sx=W-R,sy=H-R,arc=Math.PI/2*R;
const P=4*sx+4*sy+4*arc;
console.log('quarter', (sx+arc+sy).toFixed(4), 'vs P/4', (P/4).toFixed(4));
"
```

Expected: 两个数字相等(证明 t=0.25 正好落在右侧中点,入口/出口位置才对得上)。

- [ ] **Step 3: 路沿改成合并的盒子带,并在出口/入口开缺口**

现在的两个 torus 只能画椭圆,换成沿路径铺小盒子再合并成一个 mesh(沿用 `clusterMesh` 的合并手法,内外圈各 1 个 draw call):

(`gapTs` 字段在 Step 4 里声明,这里直接用。)

```ts
private buildCurbs(parent: Node): void {
    const SAMPLES = 96;
    const half = 0.5 / this.capacity; // half a slot wide gap
    for (const [off, name] of [[CURB_OFFSET, 'curb-outer'], [-CURB_OFFSET, 'curb-inner']] as const) {
        const parts: { positions: number[]; normals?: number[]; uvs?: number[]; indices?: number[] }[] = [];
        const p = new Vec3(), q = new Vec3();
        for (let i = 0; i < SAMPLES; i++) {
            const t = i / SAMPLES;
            // Skip the samples that fall inside a gap.
            if (this.gapTs.some((g) => Math.abs(((t - g + 1.5) % 1) - 0.5) < half)) continue;
            pathPoint(t, this.cy, p);
            pathPoint(t + 1 / SAMPLES, this.cy, q);
            const dx = q.x - p.x, dy = q.y - p.y;
            const len = Math.hypot(dx, dy) || 1e-4;
            const nx = -dy / len, ny = dx / len;      // outward normal in the board plane
            const box = primitives.box({ width: len * 1.2, height: 0.12, length: 0.12 });
            // rotate the box about +Z so its width follows the path direction
            const ang = Math.atan2(dy, dx), ca = Math.cos(ang), sa = Math.sin(ang);
            const cx = p.x + nx * off, cyy = p.y + ny * off;
            const pos = box.positions.slice();
            for (let v = 0; v < pos.length; v += 3) {
                const x = pos[v], y = pos[v + 1];
                pos[v] = cx + x * ca - y * sa;
                pos[v + 1] = cyy + x * sa + y * ca;
            }
            parts.push({ positions: pos, normals: box.normals, uvs: box.uvs, indices: box.indices });
        }
        const n = new Node(name);
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = mergeParts(parts);
        mr.material = litMaterial(Color.WHITE.clone());
        parent.addChild(n);
    }
}
```

把 `clusterMesh` 里的合并循环抽成模块级工具函数复用:

```ts
/** Merge several primitive geometries into one mesh (one draw call). */
function mergeParts(parts: { positions: number[]; normals?: number[]; uvs?: number[]; indices?: number[] }[]): Mesh {
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    let base = 0;
    for (const g of parts) {
        const vc = g.positions.length / 3;
        for (let i = 0; i < vc; i++) {
            positions.push(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
            if (g.normals) normals.push(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]);
            if (g.uvs) uvs.push(g.uvs[i * 2], g.uvs[i * 2 + 1]);
        }
        for (const ii of (g.indices || [])) indices.push(ii + base);
        base += vc;
    }
    return utils.createMesh({ positions, normals, uvs, indices });
}
```

`clusterMesh()` 改成用 `mergeParts` 拼四个球(行为不变,去掉重复代码)。

- [ ] **Step 4: 构造函数接入口索引,算出缺口位置**

先加两个字段(和 `capacity`/`cy`/`tick` 放一起):

```ts
private readonly entries: { board: number; left: number; right: number };
/** Path parameters where the curb opens up; filled before buildCurbs runs. */
private gapTs: number[] = [];
```

```ts
constructor(
    parent: Node, capacity: number, y: number, tick = 0.12,
    entries: { board: number; left: number; right: number },
) {
    this.capacity = capacity;
    this.cy = y;
    this.tick = tick;
    this.entries = entries;
    this.gapTs = [entries.board / capacity, entries.left / capacity, entries.right / capacity];
    this.buildCurbs(parent);
    this.buildClusters(parent);
}
```

`GameController.ts` 的构造调用同步改:

```ts
const loop = this.core!.loop;
this.loopView = new TrackView(loopRoot, level.loop.capacity, LOOP_Y, this.TICK, {
    board: loop.boardIndex, left: loop.entryLeft, right: loop.entryRight,
});
```

- [ ] **Step 5: 修双倍步进**

`update()` 里补间那段改成:

```ts
    // The ring's CONTENTS already advanced one index, which alone moves a passenger
    // one slot. Pull the phase back a slot so the new index renders where the
    // passenger visually was, then tween it forward: net motion is exactly one slot
    // per tick and the resting phase stays 0, which is what keeps the boarding gap
    // pinned to a fixed point on the track.
    this.phaseTween?.stop();
    this.phaseHolder.p -= 1 / this.capacity;
    const target = this.phaseHolder.p + 1 / this.capacity;
```

同时把 `nearestVisibleWorldPos` 里的 `T_BOARD` 换成 `this.entries.board / this.capacity`,并删掉 `T_BOARD` 常量。

- [ ] **Step 6: 跑测试确认核心没被带坏**

Run: `cd logic && npx jest`
Expected: PASS,51 个全绿(本任务不该碰核心)。

- [ ] **Step 7: 请用户预览确认**

请用户在 Cocos 预览里跑第 1、2 关并截图,确认:轨道是圆角矩形、乘客匀速平滑绕行**没有跳格**、底部正中有缺口且上车时乘客从缺口飞出、左右中点各有一个缺口。**实现者不得声称自己已渲染验证。**

- [ ] **Step 8: 提交**

```bash
git add game/assets/scripts/view/track-view.ts game/assets/scripts/view/GameController.ts
git commit -m "feat(view): M6.B rounded-rect track with a fixed boarding gap

Replaces the ellipse with an arc-length parameterised rounded rectangle so ring
index i is pinned to t = i/capacity, which is what lets the boarding gap and the
two entrances sit at fixed points. Curbs become one merged box strip per rail
(two draw calls) so the gaps can be cut out.

Also fixes the double-stepping: step() rotated the contents AND the view advanced
the phase a full slot, so passengers jumped a slot then slid a slot. The phase now
only interpolates within the tick.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 左右候车通道

**Files:**
- Modify: `game/assets/scripts/view/track-view.ts`
- Modify: `game/assets/scripts/view/GameController.ts:206`(update 调用传两条队列)

**Interfaces:**
- Consumes: Task 1 的 `loop.left`/`loop.right`,Task 2 的 `pathPoint`/`mergeParts`/`entries`。
- Produces: `TrackView.update(ring, left, right)` 三参版本正式生效。

- [ ] **Step 1: 建通道底板与候车位**

`track-view.ts` 加常量与构建:

```ts
/** Waiting passengers drawn per channel; the rest of the queue is implied. */
const LANE_VISIBLE = 4;
const LANE_STEP = 0.5;      // spacing between waiting clusters
const LANE_START = 0.75;    // gap between the track edge and the first waiting cluster

private laneClusters: { left: Node[]; right: Node[] } = { left: [], right: [] };

private buildLanes(parent: Node): void {
    const mesh = clusterMesh();
    for (const side of ['left', 'right'] as const) {
        const dir = side === 'left' ? -1 : 1;         // left lane runs out to -x
        const x0 = dir * (W + CURB_OFFSET + LANE_START);
        // Lane floor: a light slab the waiting passengers stand on.
        const slabW = LANE_STEP * LANE_VISIBLE + 0.3;
        const slab = makeLitBox(`lane-${side}`, slabW, 0.55, 0.1, new Color(238, 236, 230));
        slab.setPosition(x0 + dir * (slabW / 2 - LANE_STEP / 2), this.cy, -0.06);
        parent.addChild(slab);
        for (let i = 0; i < LANE_VISIBLE; i++) {
            const n = new Node(`wait-${side}-${i}`);
            const mr = n.addComponent(MeshRenderer);
            mr.mesh = mesh;
            mr.material = litMaterial(Color.WHITE.clone());
            n.setPosition(x0 + dir * i * LANE_STEP, this.cy, 0);
            n.active = false;
            parent.addChild(n);
            this.laneClusters[side].push(n);
        }
    }
}
```

在构造函数里 `this.buildClusters(parent)` 之后调用 `this.buildLanes(parent)`。`makeLitBox` 从 `./placeholder` import。

- [ ] **Step 2: 每 tick 反映两条队列**

`update()` 签名改成 `update(ring: (string|null)[], left: string[], right: string[])`,末尾加:

```ts
    this.updateLanes(left, right);
```

```ts
/**
 * Draw the head of each channel. The inactive channel (the right one while the
 * left still has passengers) is dimmed, so "left goes first" is readable without
 * a tutorial. Only the head `LANE_VISIBLE` are drawn; the rest are implied.
 */
private updateLanes(left: string[], right: string[]): void {
    const leftActive = left.length > 0;
    for (const [side, queue] of [['left', left], ['right', right]] as const) {
        const active = side === 'left' ? leftActive : !leftActive;
        const nodes = this.laneClusters[side];
        for (let i = 0; i < nodes.length; i++) {
            const color = queue[i];
            const n = nodes[i];
            if (!color) { n.active = false; continue; }
            n.active = true;
            const mr = n.getComponent(MeshRenderer);
            if (mr) mr.material = litMaterial(active ? colorOf(color) : dim(colorOf(color)));
        }
    }
    this.animateLaneShift(leftActive ? 'left' : 'right', left, right);
}
```

(`dim` 是模块级函数,写在 class 外面,和 `pathPoint`/`mergeParts` 放一起。)

```ts
/** Desaturated/darkened tint for the channel that is not feeding yet. */
function dim(c: Color): Color {
    return new Color(
        Math.round(c.r * 0.35 + 120 * 0.65),
        Math.round(c.g * 0.35 + 120 * 0.65),
        Math.round(c.b * 0.35 + 120 * 0.65),
        255,
    );
}
```

- [ ] **Step 3: 队列前滑动画**

```ts
private lastLen = { left: -1, right: -1 };
/** Resting position of every waiting slot, captured in buildLanes. */
private laneHome: { left: Vec3[]; right: Vec3[] } = { left: [], right: [] };

/**
 * When the active channel loses its head, slide the whole lane one step toward the
 * entrance: the colours are already the post-shift ones, so start the nodes one
 * step out and tween them back to their resting slot. Purely cosmetic -- no core
 * state involved. Homes come from `laneHome`, never from the node's current
 * position, which may be mid-tween from the previous tick.
 */
private animateLaneShift(active: 'left' | 'right', left: string[], right: string[]): void {
    const len = active === 'left' ? left.length : right.length;
    const prev = this.lastLen[active];
    this.lastLen.left = left.length;
    this.lastLen.right = right.length;
    if (prev < 0 || len >= prev) return;   // nothing left the lane this tick
    const dir = active === 'left' ? -1 : 1;
    const nodes = this.laneClusters[active];
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!n.isValid || !n.active) continue;
        const home = this.laneHome[active][i];
        Tween.stopAllByTarget(n);          // a tick can land before the last slide ends
        n.setPosition(home.x + dir * LANE_STEP, home.y, home.z);
        tween(n).to(this.tick, { position: home.clone() }).start();
    }
}
```

`buildLanes` 里创建节点时同步记录 home(紧跟 `n.setPosition(...)` 之后):

```ts
            this.laneHome[side].push(n.position.clone());
```

- [ ] **Step 4: 调用点传参**

`GameController.ts` 里两处 `this.loopView?.update(this.core!.loop.ring)` 改成:

```ts
const lp = this.core!.loop;
this.loopView?.update(lp.ring, lp.left, lp.right);
```

(一处在 `buildBoard`,一处在 `update` 的 tick 循环里。)

- [ ] **Step 5: 跑测试**

Run: `cd logic && npx jest`
Expected: PASS,51 个全绿。

- [ ] **Step 6: 请用户预览确认**

截图确认:左右各有一条候车通道;第 1、2 关开局时右通道是灰的、左通道彩色;左通道抽空后右通道点亮并开始供人;有人进轨道时队列平滑前滑一格。**实现者不得声称已渲染验证。**

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/view/track-view.ts game/assets/scripts/view/GameController.ts
git commit -m "feat(view): M6.C draw the two feeder channels

The waiting queues that used to be a hidden pool are now visible beside the
track: the head of each channel is drawn, the one that is not feeding yet is
dimmed, and the lane slides forward when a passenger steps onto the track.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 收尾(开销核对 + 回归)

**Files:**
- Modify: `game/assets/scripts/view/track-view.ts`(仅在超预算时调参)

**Interfaces:** 无新接口。

- [ ] **Step 1: 记录 draw call 与帧率**

请用户在预览里打开 FPS 面板,分别截第 1、2 关的开局画面。基线:第 2 关 244 draw call / 60 FPS。

- [ ] **Step 2: 超预算就降可见数量**

若新增超过 +15:把 `LANE_VISIBLE` 从 4 降到 3,或把 `SAMPLES` 从 96 降到 72,重新截图。若在预算内,跳过本步。

- [ ] **Step 3: 通关回归**

请用户完整打一遍第 1 关(确认过关后能跳到第 2 关),再故意在第 2 关走成死局(把 4 个车位停满非紫色车),确认「游戏失败/点击重试」照常弹出——Task 1 改了补位入口,死局判定必须依旧生效。

- [ ] **Step 4: 全量测试 + 提交**

Run: `cd logic && npx jest`
Expected: PASS,51 个全绿。

```bash
git add -A
git commit -m "chore(view): M6.D track redesign perf pass

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 预览反馈修正(版面 + 节奏 + 颜色打乱)

来源:用户第一轮预览(第 2 关 254 draw call / 60 FPS,在 +15 预算内)提出四条:转盘转太快、停车位挡住转盘、通道几乎在画面外(计划算错了余量)、乘客颜色要打乱。

**Files:**
- Modify: `game/assets/scripts/view/track-view.ts`(几何与通道常量)
- Modify: `game/assets/scripts/view/GameController.ts`(`LOOP_Y`、`TICK`、给 LoopSystem 传种子)
- Modify: `game/assets/scripts/core/loop-system.ts`(可选种子 + 打乱)
- Test: `logic/tests/loop-system.test.ts`(新增 3 个用例)
- Test: `logic/tests/game-core.test.ts`(两个死局用例改为显式摆出卡死态)

**Interfaces:**
- Consumes: Task 1 的 `LoopSystem` 构造签名、Task 2/3 的几何与通道常量。
- Produces:`new LoopSystem(capacity, boardIndex, queue, shuffleSeed?: number)` —— 不传种子时顺序与今天完全一致(保护现有用例),传种子时确定性打乱。

### Part 1:版面与节奏(纯常量)

- [ ] **Step 1: 改几何与通道常量**

`track-view.ts`:

```ts
const W = 2.6;   // half width of the circuit centerline
const H = 1.3;   // half height
const R = 0.8;   // corner radius
```

```ts
const LANE_VISIBLE = 3;
const LANE_STEP = 0.45;
const LANE_START = 0.55;
```

依据(不要改这些数之前先读):轨道那一层的**可视半宽约 4.67 单位**,由截图两个参照反推——停车位 7 格跨 ±3.94 单位量得 684px,轨道外圈跨 ±3.75 单位量得 580px。候车位最外一个落在 `W + CURB_OFFSET + LANE_START + (LANE_VISIBLE-1)*LANE_STEP` = 2.6+0.35+0.55+0.9 = **4.4 < 4.67**,三个候车位全部在画面内并留了余量。改动 W 或通道常量时必须重算这条不等式。

- [ ] **Step 2: 抬高转盘、放慢节奏**

`GameController.ts` 的 `buildBoard`:

```ts
        const LOOP_Y = 3.8;
```

`TICK` 字段:

```ts
    private readonly TICK = 0.26;
```

依据:轨道底边 = `LOOP_Y - H` = 3.8-1.3 = **2.5**,车位那一行的上沿 = `PARKING_Y + 0.49` = 1.69,净空 0.81(改动前是 1.9 vs 1.69,只有 0.21,底排乘客压在车位上)。轨道顶边 = 3.8+1.3+0.35 = 5.45,仍低于 HUD。`TICK` 是每格时间,同时也是每 tick 最多一人上车的节拍:0.18→0.26 意味着第 2 关 128 人的下限时长从约 23s 变成约 33s。

### Part 2:颜色打乱(TDD)

- [ ] **Step 3: 写失败测试**

追加到 `logic/tests/loop-system.test.ts`:

```ts
function counts(loop: LoopSystem): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of [...loop.ring, ...loop.left, ...loop.right]) {
    if (c) out[c] = (out[c] || 0) + 1;
  }
  return out;
}

test('without a seed the queue keeps its authored order', () => {
  const loop = new LoopSystem(4, 0, [{ color: 'a', count: 4 }, { color: 'b', count: 4 }]);
  expect(loop.ring).toEqual(['a', 'a', 'a', 'a']);
});

test('a seed mixes the colors without changing how many of each there are', () => {
  const loop = new LoopSystem(12, 6, [{ color: 'a', count: 12 }, { color: 'b', count: 12 }], 7);
  expect(counts(loop)).toEqual({ a: 12, b: 12 });
  expect(new Set(loop.ring.filter((c) => c !== null)).size).toBe(2); // both colors on the track
});

test('the same seed always shuffles the same way', () => {
  const build = () => new LoopSystem(12, 6, [{ color: 'a', count: 12 }, { color: 'b', count: 12 }], 7);
  expect(build().ring).toEqual(build().ring);
});
```

- [ ] **Step 4: 运行,确认失败**

Run: `cd logic && npx jest tests/loop-system.test.ts`
Expected: FAIL —— ts-jest 报第 4 个构造参数不存在(`Expected 3 arguments, but got 4`)。

- [ ] **Step 5: 实现确定性打乱**

`loop-system.ts` 模块级加两个纯函数:

```ts
/**
 * Deterministic PRNG (mulberry32). The shuffle must be reproducible: a level has to
 * look the same every time it is replayed, and the tests need a fixed answer.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher-Yates driven by `next`. */
function shuffleInPlace(arr: string[], next: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
```

构造函数签名加第四个可选参数,并在展开之后、装轨道之前打乱:

```ts
  constructor(capacity: number, boardIndex: number, queue: QueueGroup[], shuffleSeed?: number) {
```

```ts
    // Shuffle before the ring is filled so the track shows a mix instead of one
    // solid colour block per queue group. Optional and seeded: callers that pass
    // no seed (the unit tests) keep the authored order.
    if (shuffleSeed !== undefined) shuffleInPlace(all, rng(shuffleSeed));
```

(插在 `for (const g of queue)` 展开循环之后、`this.ring = new Array(capacity).fill(null);` 之前。)

- [ ] **Step 6: 运行,确认通过**

Run: `cd logic && npx jest tests/loop-system.test.ts`
Expected: PASS,13 个用例全绿。

- [ ] **Step 7: 游戏里接上种子**

`game-core.ts` 的构造函数:

```ts
    this.loop = new LoopSystem(
      level.loop.capacity,
      level.loop.boardIndex,
      level.loop.queue,
      level.id, // seeded by level id: mixed colours, but the same mix on every replay
    );
```

- [ ] **Step 8: 两个死局用例改为显式摆出卡死态**

打乱之后,「紫色排在关卡最前」这个作者顺序不再成立,所以这两个用例不能再依赖构造出来的 ring 内容。改成直接摆状态——它们要验的是死局判定,不是关卡作者顺序。

`logic/tests/game-core.test.ts` 里,把 `deadlock is detected when the ring is jammed with an unboardable color` 的
```ts
  const game = new GameCore(level);
  expect(game.loop.ring).toEqual(['green', 'green']); // ring saturated, red stuck in the pool
```
替换成
```ts
  const game = new GameCore(level);
  // Seal the ring by hand instead of relying on the authored queue order (the loop
  // shuffles now): green fills the track, the reds behind it can never get in.
  game.loop.ring = ['green', 'green'];
  game.loop.left = new Array(8).fill('red');
  game.loop.right = new Array(8).fill('red');
```

把 `a color still reachable through an emptied ring cell is not a deadlock` 的
```ts
  const game = new GameCore(level);
  expect(game.loop.ring).toEqual(['green', 'red']);
```
替换成
```ts
  const game = new GameCore(level);
  // Same shape, set by hand: a red passenger is on the track, so the parked red car
  // can still fill and free its slot.
  game.loop.ring = ['green', 'red'];
  game.loop.left = new Array(8).fill('red');
  game.loop.right = new Array(7).fill('red');
```

两个用例的其余部分(包括最后的 `expect(game.getState())`)一行不改。

- [ ] **Step 9: 全量回归**

Run: `cd logic && npx jest`
Expected: PASS,54 个全绿(51 + 新增 3)。

- [ ] **Step 10: 提交**

```bash
git add game/assets/scripts/view/track-view.ts game/assets/scripts/view/GameController.ts game/assets/scripts/core/loop-system.ts game/assets/scripts/core/game-core.ts logic/tests/loop-system.test.ts logic/tests/game-core.test.ts
git commit -m "feat: M6.E fit the track on screen, slow the carousel, shuffle passengers

The lanes were drawn off screen: the plan sized them against the platform's
half-width of 6, but the camera only shows about 4.67 units either side at the
track's depth. Shrinks the circuit (W 3.4->2.6, H 1.5->1.3) and pulls the lanes
in so all three waiting slots are visible, and lifts the track (LOOP_Y 3.4->3.8)
so its bottom straight no longer collides with the parking row -- which was
hiding the boarding gap.

TICK 0.18->0.26 slows the carousel; it is also the boarding cadence, so level 2's
floor goes from ~23s to ~33s.

Passengers now enter in a shuffled order (seeded by level id, so a replay looks
the same) instead of solid colour blocks. The two deadlock tests set their jam
state by hand now rather than leaning on the authored queue order.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 让两条规则在动画里看得见

来源:用户第二轮预览。机制经截图自洽性核对是对的(剩余 6 = 轨道 4 + 右通道 2,左通道已空,三车各剩 2 座),但动画没表达出规则,其中上车起飞点是真 bug。

**Files:**
- Modify: `game/assets/scripts/view/track-view.ts`
- Modify: `game/assets/scripts/view/GameController.ts`(`playBoarding` 的起飞点)

**Interfaces:**
- Produces:`TrackView.boardingWorldPos(): Vec3` —— 上车口(底部缺口)的**固定**世界坐标。
- Removes:`TrackView.nearestVisibleWorldPos(color)` —— 它的语义就是错的(见下),删掉,`GameController` 是唯一调用者。

### Part 1:上车飞人必须从底部缺口起飞

根因:`GameController.update()` 的顺序是 `stepLoop()` → `loopView.update()` → `playBoarding()`。跑到 `playBoarding` 时,上车那名乘客早已被 `boardPassenger()` 置空并随 `step()` 转走,所以 `nearestVisibleWorldPos(color)` 找到的是**另一个**同色乘客;终局同色乘客不在轨道上时它返回 `null`,`playBoarding` 直接 `bumpSeat` 返回,一点动画都没有。上车口是固定的,起飞点不该去"找人"。

- [ ] **Step 1: 存下 loopRoot,加 boardingWorldPos()**

`track-view.ts`,构造函数里存一份 parent(字段和 `capacity` 放一起):

```ts
    /** loopRoot; needed to turn board-local path points into world positions. */
    private readonly root: Node;
```

构造函数体开头加 `this.root = parent;`。

然后加方法(放在 `nearestVisibleWorldPos` 原来的位置):

```ts
/**
 * World position of the boarding gap. Fixed, not searched: ring index `board` rests
 * at t = board/capacity, which is the bottom-centre gap. The passenger that boards
 * is by definition the one standing there, and by the time the controller animates
 * it the core has already cleared it from the ring — so looking for it by colour
 * finds a different passenger (or none at all, late in a level, and then nothing
 * animated at all). That was the bug this replaces.
 */
boardingWorldPos(): Vec3 {
    const local = pathPoint(this.entries.board / this.capacity, this.cy);
    const out = new Vec3();
    Vec3.transformMat4(out, local, this.root.worldMatrix);
    return out;
}
```

删除整个 `nearestVisibleWorldPos` 方法,以及只被它用到的 `ringColors` 字段和 `update()` 里 `this.ringColors = ring.slice();` 这一行(若删掉后 `ringColors` 再无引用)。

- [ ] **Step 2: 改调用点**

`GameController.playBoarding` 里:

```ts
        const start = this.loopView?.boardingWorldPos() ?? null;
```

`if (!start) { this.bumpSeat(e); return; }` 保留不动(`loopView` 为空时仍要兜底)。

### Part 2:进场要走进来

新乘客现在只是在左缺口"凭空点亮"。改成:通道队首那个团**走进缺口**,同时整条通道前滑一格(前滑已有)。

- [ ] **Step 3: 加进场动画**

`track-view.ts` 加方法:

```ts
/**
 * Walk the channel's head into the track through its entrance gap: the real ring
 * slot is hidden for this one tick while a temporary cluster tweens from the lane
 * head to the slot's resting spot, so "the hole came round to the entrance and the
 * next passenger stepped in" is legible instead of a colour appearing from nowhere.
 */
private playEntry(side: 'left' | 'right', color: string): void {
    const index = side === 'left' ? this.entries.left : this.entries.right;
    const slot = this.clusters[index];
    const from = this.laneHome[side][0];
    if (!slot || !slot.isValid || !from) return;
    slot.active = false;
    const flier = new Node('pax-enter');
    const mr = flier.addComponent(MeshRenderer);
    mr.mesh = clusterMesh();
    mr.material = litMaterial(colorOf(color));
    flier.setPosition(from);
    this.root.addChild(flier);
    tween(flier)
        .to(this.tick, { position: pathPoint(index / this.capacity, this.cy) })
        .call(() => {
            if (slot.isValid) slot.active = true;
            if (flier.isValid) flier.destroy();
        })
        .start();
}
```

- [ ] **Step 4: 在 updateLanes 里触发**

`updateLanes` 末尾现在是:

```ts
    this.animateLaneShift(leftActive ? 'left' : 'right', left, right);
```

改成先算出"这一 tick 有没有人进场",再把同一个信号同时给前滑和进场动画:

```ts
    // Which channel actually lost its head this tick? NOT necessarily the one that is
    // active now: the tick that drains the left channel flips `leftActive` to false,
    // so keying off the active side would miss that entrant — and its lane slide —
    // exactly once per level, at the hand-over. Compare both sides instead.
    const dropped: 'left' | 'right' | null =
        this.lastLen.left >= 0 && left.length < this.lastLen.left ? 'left'
        : this.lastLen.right >= 0 && right.length < this.lastLen.right ? 'right'
        : null;
    // Always call animateLaneShift: it is what keeps `lastLen` up to date, and it
    // early-returns on its own when nothing moved.
    this.animateLaneShift(dropped ?? (leftActive ? 'left' : 'right'), left, right);
    if (dropped) {
        const index = dropped === 'left' ? this.entries.left : this.entries.right;
        const color = ring[index];
        if (color) this.playEntry(dropped, color);
    }
```

`updateLanes` 的签名因此要多收一个 `ring`:改成 `private updateLanes(ring: (string | null)[], left: string[], right: string[])`,`update()` 里的调用改成 `this.updateLanes(ring, left, right);`。

`animateLaneShift` 内部对 `lastLen` 的读写一行不改 —— 它自己算 `prev`、自己更新,上面这段只是先读一次 `lastLen` 再让它照常跑。

- [ ] **Step 5: 编译与回归**

Run: `cd logic && npx jest`
Expected: PASS,54 个全绿(本任务不碰核心)。

按前几个任务的办法核对 view 文件类型:`npx tsc --noEmit` 对着 `C:\ProgramData\cocos\editors\Creator\3.8.7\resources\resources\3d\engine\bin\.declarations\cc.d.ts`,引擎声明本身有 59 个既有报错,比对改动前后是否一致。

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/view/track-view.ts game/assets/scripts/view/GameController.ts
git commit -m "fix(view): M6.F board from the gap, and walk passengers in

The boarding fly started from the wrong place. playBoarding runs after stepLoop,
by which point the core has already cleared the boarding passenger from the ring,
so nearestVisibleWorldPos(colour) found a DIFFERENT passenger of that colour --
or none at all late in a level, in which case nothing animated. The gap is a fixed
point, so boardingWorldPos() returns it directly and the search is deleted.

Entering the track was a colour switching on at the entrance slot. A temporary
cluster now walks in from the lane head while the real slot stays hidden for that
tick, so 'the hole came round to the entrance and the next passenger stepped in'
is something you can actually see.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 自查记录

- **Spec 覆盖**:双入口左优先→Task 1 Step 7;对半分→A Step 3;空位才放行→A Step 5 第四个用例;圆角矩形+弧长→B Step 1;索引↔位置绑定→B Step 4;运动模型修正→B Step 5;出口缺口→B Step 3;通道渲染/前滑/灰显→C Step 1-3;开销预算→D Step 1-2;死局不退化→A Step 4/11 + D Step 3。
- **命名一致性**:`left`/`right`/`entryLeft`/`entryRight`/`gapTs`/`laneClusters`/`mergeParts`/`dim` 在 A/B/C 中拼写一致;`TrackView.update` 三参签名在 B(接住)与 C(生效)一致。
- **已知取舍**:capacity=2 时 `entryLeft` 与 `entryRight` 会重合(`Math.round(2/4)=1`),对现有关卡(capacity=12)无影响,测试里已按重合行为断言。
