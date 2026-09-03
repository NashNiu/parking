# 隧道元素 (M9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 停车场里多一种元素「隧道」—— 一个固定朝向的车队列,队首那辆停在洞口可以被点走,走后下一辆自动补位,隧道身上的数字写着里面还剩几辆。

**Architecture:** 隧道在 core 里只是 `LotSystem` 的一份数据 —— **洞口那辆车是一辆真正的 `CarSpec`**,所以点击、判挡、停车、上客、死局判定全部复用现有链路,一行不改。隧道本体只做两件事:往 `firstBlocker` 的扫掠里塞一个静止盒子,以及在 `removeCar` 里补位。生成器把隧道当成不动的刚体先落位,车再绕着它 pack/peel,可解性由「网格车总能被剥光,剥光后隧道出口射线必然通畅」白送。

**Tech Stack:** TypeScript 5.4,jest 29(core),tsc(view 类型检查),Cocos Creator 3.8.7(表现层,无测试环境)。

**Spec:** `docs/superpowers/specs/2026-09-03-tunnel-element-design.md`

## Global Constraints

- **core 不认识 Cocos**:`game/assets/scripts/core/` 下任何文件都不许 `import ... from 'cc'`。违反了 jest 就再也加载不了那个文件。
- **双闸必须绿**,每个 task 结束前都要跑:
  ```bash
  cd logic && npm test
  cd logic && npm run typecheck:view
  ```
- **`peel` 产出的剥离顺序就是一个合法解** —— 这条不变式在整个改动中必须活着。
- **圆环、通道、乘客、停车位零改动**:`loop-system.ts` / `boarding-system.ts` / `parking-system.ts` / `track-path.ts` / `track-shapes.ts` 一个字不动。
- **关卡不需要向后兼容**,十关全部重新生成并提交 JSON。
- 车型固定 `small`(`TunnelCar.cap` 字段留着,但生成器只发 small)。
- 常量值,逐字照抄:`TUNNEL_BOX = { len: 1.2, wid: 0.76 }`;`CLEARANCE = 0.04`;`CAP_BOX.small = { len: 0.964, wid: 0.471 }`;`CAR_SCALE = 1.0`;`CARS_PER_LEVEL = 60`。
- 隧道曲线:第 1~3 关 0 条;第 4~6 关 1 条 × 4 辆;第 7~8 关 2 条 × 5 辆;第 9~10 关 2 条 × 6 辆。**每关总车数恒为 60**(网格车 + 隧道车)。
- 提交信息用祈使句、小写 type,和现有 git log 一致(`feat(core): ...` / `feat(view): ...` / `chore(assets): ...`)。

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `game/assets/scripts/core/tunnel.ts` | 隧道的纯几何:本体盒、洞口车、保留盒。不认识 `LotSystem`,不认识关卡。 |
| `logic/tests/tunnel.test.ts` | 上面三个函数的单测。 |
| `game/assets/scripts/view/tunnel-mesh.ts` | 隧道的程序化网格。只画,不知道 core。 |

**修改**

| 文件 | 改什么 |
|---|---|
| `core/types.ts` | `TunnelCar` / `TunnelSpec` / `TUNNEL_BOX`,`LevelData.lot.tunnels?` |
| `core/move-solver.ts` | `firstBlocker` / `pathClear` 多收一组静止 `OBB`;`Blockage.carId` 可为 -1 |
| `core/lot-system.ts` | 持有隧道、发洞口车、`removeCar` 补位、`mouthCarId`、`remainingIn` |
| `core/level-data.ts` | `validateLevel` 六条新校验 + 车容量把隧道车算进去 |
| `core/solvability.ts` | `clearGrid` 改跑 `LotSystem`;`estimateDifficulty` 计入隧道车 |
| `core/level-gen.ts` | `TUNNEL_CURVE` / `tunnelParams` / `placeTunnels` / `aimTunnels`,pack/peel/scatter/assemble/generateLevel 接上隧道 |
| `core/index.ts` | 导出 `./tunnel` |
| `tools/gen-levels.ts` | 乘客数计入隧道车,表格加一列 |
| `view/grid-view.ts` | `addCar` / `activateCar`(补位用) |
| `view/GameController.ts` | 建隧道节点、数字牌、补位动画 |
| `view/hud-view.ts` | 隧道数字牌的创建与摆位 |
| `view/debug-overlay.ts` | 把隧道本体的盒子也画出来 |

`core/tunnel.ts` 单独成文件而不是塞进 `move-solver.ts`:move-solver 回答的是「谁挡住谁」,隧道的三个盒子回答的是「隧道占哪儿」。两件事,两个文件,`move-solver` 因此完全不必 import `TunnelSpec`。

---

## Task 1: 隧道的类型与几何,以及会认静止障碍的 solver

**Files:**
- Modify: `game/assets/scripts/core/types.ts`
- Create: `game/assets/scripts/core/tunnel.ts`
- Modify: `game/assets/scripts/core/move-solver.ts:20-40`(`Blockage`)、`:47-100`(`firstBlocker`、`pathClear`)
- Modify: `game/assets/scripts/core/index.ts`
- Test: `logic/tests/tunnel.test.ts`(新建)、`logic/tests/move-solver.test.ts`(追加)

**Interfaces:**
- Consumes: `OBB`、`sweepHit`(`core/geometry.ts`);`CAP_BOX`、`CAR_SCALE`、`CLEARANCE`、`Box`、`Cap`、`CarSpec`(`core/types.ts`)
- Produces:
  - `interface TunnelCar { color: string; cap: Cap }`
  - `interface TunnelSpec { id: number; x: number; y: number; angle: number; cars: TunnelCar[] }`
  - `const TUNNEL_BOX: Box`
  - `LevelData.lot.tunnels?: TunnelSpec[]`
  - `tunnelBox(t: TunnelSpec): OBB`
  - `mouthCar(t: TunnelSpec, id: number): CarSpec | null`
  - `tunnelReservation(t: TunnelSpec): OBB`
  - `firstBlocker(car: CarSpec, cars: CarSpec[], lot: Lot, blockers?: OBB[]): Blockage | null`
  - `pathClear(car: CarSpec, cars: CarSpec[], lot: Lot, blockers?: OBB[]): boolean`

- [ ] **Step 1: 写失败的测试 —— 隧道的三个盒子**

新建 `logic/tests/tunnel.test.ts`:

```ts
import { tunnelBox, mouthCar, tunnelReservation } from '../../game/assets/scripts/core/tunnel';
import { CAP_BOX, CLEARANCE, TunnelSpec, TUNNEL_BOX } from '../../game/assets/scripts/core/types';

const tunnel = (over: Partial<TunnelSpec> = {}): TunnelSpec => ({
  id: 1, x: 1, y: 0, angle: 0,
  cars: [{ color: 'red', cap: 'small' }, { color: 'blue', cap: 'small' }],
  ...over,
});

test('a tunnel body is TUNNEL_BOX at the tunnel own centre and angle', () => {
  const b = tunnelBox(tunnel({ x: 2, y: -1, angle: 90 }));
  expect(b.x).toBe(2);
  expect(b.y).toBe(-1);
  expect(b.angle).toBe(90);
  expect(b.len).toBeCloseTo(TUNNEL_BOX.len, 6);
  expect(b.wid).toBeCloseTo(TUNNEL_BOX.wid, 6);
});

// 0.6 (半个本体) + 0.04 (clearance) + 0.482 (半辆小车) = 1.122
const MOUTH_OFFSET = TUNNEL_BOX.len / 2 + CLEARANCE + CAP_BOX.small.len / 2;

test('the mouth car stands one clearance in front of the body', () => {
  const car = mouthCar(tunnel(), 7);
  expect(car).not.toBeNull();
  expect(car!.id).toBe(7);
  expect(car!.x).toBeCloseTo(1 + MOUTH_OFFSET, 6);
  expect(car!.y).toBeCloseTo(0, 6);
  expect(car!.angle).toBe(0);
  expect(car!.color).toBe('red');   // cars[0], not cars[1]
  expect(car!.cap).toBe('small');
});

test('the mouth car follows the tunnel angle', () => {
  const car = mouthCar(tunnel({ x: 0, y: 0, angle: 90 }), 1);
  expect(car!.x).toBeCloseTo(0, 6);
  expect(car!.y).toBeCloseTo(MOUTH_OFFSET, 6);
});

test('a drained tunnel has no mouth car', () => {
  expect(mouthCar(tunnel({ cars: [] }), 1)).toBeNull();
});

test('the reservation is symmetric: a mouth car space at BOTH ends', () => {
  const r = tunnelReservation(tunnel());
  // Symmetric, so it stays centred on the tunnel however the tunnel is later aimed.
  expect(r.x).toBe(1);
  expect(r.y).toBe(0);
  expect(r.len).toBeCloseTo(TUNNEL_BOX.len + 2 * (CLEARANCE + CAP_BOX.small.len), 6);
  expect(r.wid).toBeCloseTo(TUNNEL_BOX.wid, 6);
});

test('the reservation is sized by the LONGEST car the tunnel holds', () => {
  const r = tunnelReservation(tunnel({ cars: [
    { color: 'red', cap: 'small' }, { color: 'blue', cap: 'big' },
  ] }));
  expect(r.len).toBeCloseTo(TUNNEL_BOX.len + 2 * (CLEARANCE + CAP_BOX.big.len), 6);
});
```

- [ ] **Step 2: 跑一遍确认它失败**

Run: `cd logic && npx jest tests/tunnel.test.ts`
Expected: FAIL —— `Cannot find module '../../game/assets/scripts/core/tunnel'`

- [ ] **Step 3: 加类型**

`game/assets/scripts/core/types.ts`,接在 `CLEARANCE` 之后:

```ts
/** One car waiting in a tunnel. Everything else about it -- where it stands, which way
 * it leaves, what id it gets -- belongs to the tunnel, not to the car. */
export interface TunnelCar { color: string; cap: Cap }

/**
 * A queue of cars behind a fixed mouth. The car at the head stands OUTSIDE, in front of
 * the body, and is a `CarSpec` like any other: it is tapped, blocked, parked and boarded
 * by exactly the code every other car goes through. When it leaves, the next one takes
 * its place (see `LotSystem.removeCar`).
 *
 * `x`/`y`/`angle` describe the BODY. The mouth car's position is derived from them by
 * `mouthCar` rather than stored, because two stored copies is two chances to disagree.
 * `angle` is the direction cars LEAVE in: 0 = +X, counter-clockwise, [0, 360), the same
 * convention `CarSpec.angle` uses.
 *
 * `cars[0]` is whoever is at the mouth right now; the array is consumed from the head.
 * Its LENGTH is the number the player sees on the tunnel -- the mouth car included,
 * because it has not left yet.
 */
export interface TunnelSpec {
  id: number;
  x: number;
  y: number;
  angle: number;
  cars: TunnelCar[];
}

/**
 * The tunnel body's own size in board units, the same units and the same role as CAP_BOX.
 *
 * `wid` 0.76 is a small car's 0.471 plus a 0.145 wall each side, so a car emerging has
 * visible wall beside it rather than appearing to squeeze out of a slot. `len` 1.2 is a
 * little over one car length: enough that the roof reads as a solid thing under the count
 * badge instead of a wafer.
 *
 * core owns this number and the view reads it, the same direction CAP_BOX runs. Do not
 * re-derive it from whatever `tunnel-mesh.ts` draws.
 */
export const TUNNEL_BOX: Box = { len: 1.2, wid: 0.76 };
```

同一文件的 `LevelData`,`lot` 加一个可选字段:

```ts
export interface LevelData {
  id: number;
  lot: { w: number; h: number; cars: CarSpec[]; tunnels?: TunnelSpec[] };
  // ...其余不动
}
```

**可选**是有意的:core 的测试里那些合成关卡一个字都不用改。

- [ ] **Step 4: 写 `core/tunnel.ts`**

```ts
import { OBB } from './geometry';
import { CAP_BOX, CAR_SCALE, CarSpec, CLEARANCE, TunnelSpec, TUNNEL_BOX } from './types';

/**
 * The three boxes a tunnel puts on the board. Deliberately ignorant of `LotSystem` and of
 * levels: it takes a `TunnelSpec` and answers with geometry, which is what lets the packer,
 * the validator and the solver all ask the same questions and get the same answers.
 */

/** The tunnel BODY: the part that blocks. */
export function tunnelBox(t: TunnelSpec): OBB {
    return { x: t.x, y: t.y, angle: t.angle, len: TUNNEL_BOX.len, wid: TUNNEL_BOX.wid };
}

/**
 * The car currently standing at the mouth, or null when the tunnel is drained.
 *
 * It sits one CLEARANCE in front of the body's front face, and that gap is what keeps the
 * tunnel from blocking its own car. `sweepHit` reports null for contact strictly behind the
 * mover, so a car driving along `angle` never sees the body it just came out of -- but only
 * as long as the two do not OVERLAP, because overlapping boxes report 0 whatever the
 * heading. The clearance is what guarantees they do not.
 */
export function mouthCar(t: TunnelSpec, id: number): CarSpec | null {
    const head = t.cars[0];
    if (!head) return null;
    const r = t.angle * Math.PI / 180;
    const d = TUNNEL_BOX.len / 2 + CLEARANCE + CAP_BOX[head.cap].len * CAR_SCALE / 2;
    return {
        id,
        x: t.x + Math.cos(r) * d,
        y: t.y + Math.sin(r) * d,
        angle: t.angle,
        color: head.color,
        cap: head.cap,
    };
}

/**
 * The footprint the packer must keep clear: the body with a mouth car's worth of room at
 * BOTH ends, so it stays valid whichever of the two headings the tunnel is later aimed
 * down.
 *
 * Symmetric on purpose, and it costs about 1.7 small cars of board per tunnel. The saving
 * -- reserving only the end the mouth is on -- would force the heading to be chosen BEFORE
 * the lot is packed, and whether a mouth has a clear lane is not knowable until after. A
 * tunnel welded shut from the first frame shows a count the player cannot spend, which
 * reads as a bug. Reserving both ends buys the same two-headings-per-placement freedom
 * `headingsFor` gives every car, and for the same reason: a rectangle turned a half turn
 * covers the same board.
 *
 * Sized by the LONGEST car in the queue rather than by `small`. The generator only ever
 * loads small cars today; this is what stops that assumption from being silently baked into
 * the geometry.
 */
export function tunnelReservation(t: TunnelSpec): OBB {
    let longest = 0;
    for (const c of t.cars) longest = Math.max(longest, CAP_BOX[c.cap].len * CAR_SCALE);
    return {
        x: t.x,
        y: t.y,
        angle: t.angle,
        len: TUNNEL_BOX.len + 2 * (CLEARANCE + longest),
        wid: TUNNEL_BOX.wid,
    };
}
```

`core/index.ts` 加一行,放在 `./move-solver` 之前(tunnel 只依赖 geometry 和 types):

```ts
export * from './tunnel';
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd logic && npx jest tests/tunnel.test.ts`
Expected: PASS,6 个用例全绿

- [ ] **Step 6: 写失败的测试 —— solver 认静止障碍**

追加到 `logic/tests/move-solver.test.ts` 末尾:

```ts
test('a static blocker stops a car, and reports carId -1', () => {
  // Tunnel body at x=1 spans x 0.4..1.6. The car nose sits at -1.518.
  const body = { x: 1, y: 0, angle: 0, len: 1.2, wid: 0.76 };
  const mover = car({ id: 1, x: -2, y: 0, angle: 0 });
  const hit = firstBlocker(mover, [mover], LOT, [body]);
  expect(hit).not.toBeNull();
  expect(hit!.carId).toBe(-1);
  expect(hit!.gap).toBeCloseTo(0.4 - (-2 + CAP_BOX.small.len / 2), 6);
});

test('a static blocker behind the mover is not a blocker', () => {
  const body = { x: 1, y: 0, angle: 0, len: 1.2, wid: 0.76 };
  // Same body, but the car is past it and driving away.
  const mover = car({ id: 1, x: 2.122, y: 0, angle: 0 });
  expect(firstBlocker(mover, [mover], LOT, [body])).toBeNull();
  expect(pathClear(mover, [mover], LOT, [body])).toBe(true);
});

test('the nearest of a car and a static blocker wins', () => {
  const body = { x: 3, y: 0, angle: 0, len: 1.2, wid: 0.76 };
  const mover = car({ id: 1, x: -3, y: 0, angle: 0 });
  const near = car({ id: 2, x: 0, y: 0, angle: 0 });
  expect(firstBlocker(mover, [mover, near], LOT, [body])!.carId).toBe(2);
});

test('no blockers argument behaves exactly as before', () => {
  const mover = car({ id: 1, x: -2, y: 0, angle: 0 });
  expect(firstBlocker(mover, [mover], LOT)).toBeNull();
});
```

- [ ] **Step 7: 跑一遍确认它失败**

Run: `cd logic && npx jest tests/move-solver.test.ts`
Expected: FAIL —— 前三个用例挂在「`firstBlocker` 只接受 3 个参数」的类型错误上(ts-jest 会直接报编译失败)

- [ ] **Step 8: 改 `move-solver.ts`**

先把 `Blockage` 的文档补上 -1 这一档:

```ts
export interface Blockage {
    /**
     * The car in the way -- or **-1** when what is in the way is not a car but a static
     * blocker (today: a tunnel body, passed in as an OBB).
     *
     * Only the view's refusal message cares about the difference; `pathClear` does not
     * look at this field at all. It is -1 rather than a fabricated id because a tunnel body
     * has no id in the car space and inventing one would put a thing that cannot be tapped
     * into a number that means "tappable car".
     */
    carId: number;
    gap: number;
}
```

`firstBlocker` 签名加第四个参数,并在车的循环之后加静止盒子的循环 —— 广相剔除照抄,`halfDiag` 对任何 OBB 都成立:

```ts
export function firstBlocker(
    car: CarSpec, cars: CarSpec[], lot: Lot, blockers?: OBB[],
): Blockage | null {
    // ...(已有的 box / dx,dy / range / halfDiag / boxHalfDiag / cars 循环全部不动)

    // Static blockers, after the cars and by the same rule. They never move, never leave,
    // and cannot be tapped -- so they take no id and get -1. The broad-phase test above is
    // reused verbatim: it is a statement about two boxes and a lane, not about cars.
    for (const b of blockers ?? []) {
        const perp = Math.abs((b.x - car.x) * dy - (b.y - car.y) * dx);
        if (perp > boxHalfDiag + halfDiag(b)) continue;
        const t = sweepHit(box, b, dx, dy);
        if (t === null || t > range) continue;
        if (!best || t < best.gap) best = { carId: -1, gap: t };
    }
    return best;
}

export function pathClear(
    car: CarSpec, cars: CarSpec[], lot: Lot, blockers?: OBB[],
): boolean {
    return firstBlocker(car, cars, lot, blockers) === null;
}
```

- [ ] **Step 9: 跑双闸**

Run: `cd logic && npm test`
Expected: PASS,全部既有用例 + 新增 10 个

Run: `cd logic && npm run typecheck:view`
Expected: PASS(`blockers` 是可选参数,所有既有调用点原样通过)

- [ ] **Step 10: 提交**

```bash
git add game/assets/scripts/core/types.ts game/assets/scripts/core/tunnel.ts \
        game/assets/scripts/core/move-solver.ts game/assets/scripts/core/index.ts \
        logic/tests/tunnel.test.ts logic/tests/move-solver.test.ts
git commit -m "feat(core): a tunnel's three boxes, and a solver that can be handed one"
```

---

## Task 2: `LotSystem` 持有隧道并补位

**Files:**
- Modify: `game/assets/scripts/core/lot-system.ts`
- Test: `logic/tests/lot-system.test.ts`(追加)

**Interfaces:**
- Consumes: `tunnelBox`、`mouthCar`(Task 1);`TunnelSpec`、`OBB`
- Produces:
  - `new LotSystem(lot: Lot, cars: CarSpec[], tunnels?: TunnelSpec[])`
  - `LotSystem.tunnels: TunnelSpec[]`(实例自己的副本,可变)
  - `LotSystem.mouthCarId(tunnelId: number): number | null`
  - `LotSystem.remainingIn(tunnelId: number): number`

- [ ] **Step 1: 写失败的测试**

追加到 `logic/tests/lot-system.test.ts`(文件顶部已有 `LOT` 和 `car` 两个 helper,直接用):

```ts
import { TunnelSpec } from '../../game/assets/scripts/core/types';

const tunnel = (over: Partial<TunnelSpec> = {}): TunnelSpec => ({
  id: 1, x: 1, y: 0, angle: 0,
  cars: [{ color: 'red', cap: 'small' }, { color: 'blue', cap: 'small' }],
  ...over,
});

// 1 + 1.2/2 + 0.04 + 0.964/2
const MOUTH_X = 2.122;

test('a tunnel puts its first car at the mouth', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  expect(g.cars.size).toBe(1);
  const [c] = Array.from(g.cars.values());
  expect(c.color).toBe('red');
  expect(c.x).toBeCloseTo(MOUTH_X, 3);
  expect(c.angle).toBe(0);
});

test('mouth car ids come after the grid cars', () => {
  const g = new LotSystem(LOT, [car({ id: 7, x: -3, y: 2, angle: 90 })], [tunnel()]);
  expect(g.mouthCarId(1)).toBe(8);
});

test('the next car takes the mouth when the mouth car leaves', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  const first = g.mouthCarId(1)!;
  g.removeCar(first);
  const second = g.mouthCarId(1)!;
  expect(second).not.toBe(first);
  expect(g.cars.get(second)!.color).toBe('blue');
  expect(g.cars.get(second)!.x).toBeCloseTo(MOUTH_X, 3);
});

test('the lot is empty only once the tunnel is drained', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  expect(g.isEmpty()).toBe(false);
  g.removeCar(g.mouthCarId(1)!);
  expect(g.isEmpty()).toBe(false);
  g.removeCar(g.mouthCarId(1)!);
  expect(g.mouthCarId(1)).toBeNull();
  expect(g.isEmpty()).toBe(true);
});

test('the count on the tunnel includes the car at the mouth', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  expect(g.remainingIn(1)).toBe(2);
  g.removeCar(g.mouthCarId(1)!);
  expect(g.remainingIn(1)).toBe(1);
  g.removeCar(g.mouthCarId(1)!);
  expect(g.remainingIn(1)).toBe(0);
});

test('a tunnel body blocks a car driving into its back', () => {
  // The car reaches the body (front face 0.4) long before the mouth car (1.64).
  const g = new LotSystem(LOT, [car({ id: 1, x: -2, y: 0, angle: 0 })], [tunnel()]);
  expect(g.canExit(1)).toBe(false);
});

test('a tunnel never blocks its own mouth car', () => {
  const g = new LotSystem(LOT, [], [tunnel()]);
  expect(g.movableCarIds()).toEqual([g.mouthCarId(1)]);
});

test('the level data is not mutated by draining a tunnel', () => {
  const level = [tunnel()];
  const g = new LotSystem(LOT, [], level);
  g.removeCar(g.mouthCarId(1)!);
  expect(level[0].cars.length).toBe(2);
});
```

- [ ] **Step 2: 跑一遍确认它失败**

Run: `cd logic && npx jest tests/lot-system.test.ts`
Expected: FAIL —— `LotSystem` 的构造函数只收 2 个参数

- [ ] **Step 3: 改 `lot-system.ts`**

```ts
import { CarSpec, Lot, TunnelSpec } from './types';
import { OBB } from './geometry';
import { pathClear } from './move-solver';
import { mouthCar, tunnelBox } from './tunnel';

export class LotSystem {
  bounds: Lot;
  cars: Map<number, CarSpec>;

  /**
   * This lot's OWN copy of the level's tunnels, consumed as cars leave. Copied rather than
   * referenced because a level object is replayed: a `LotSystem` that drained the array it
   * was handed would leave the second play of that level with empty tunnels.
   */
  readonly tunnels: TunnelSpec[];

  /** Tunnel bodies, computed once. Nothing ever moves them. */
  private readonly blockers: OBB[];

  /** Which tunnel a live mouth car belongs to, by car id. */
  private mouthOf = new Map<number, TunnelSpec>();

  /**
   * Next id for a car coming out of a tunnel. Starts past every id the level wrote, so a
   * tunnel car can never collide with a grid car's id -- which matters because the parking
   * bay, the view's node map and the debug log all key on that number and none of them knows
   * where a car came from.
   */
  private nextId: number;

  constructor(lot: Lot, cars: CarSpec[], tunnels: TunnelSpec[] = []) {
    this.bounds = { w: lot.w, h: lot.h };
    this.cars = new Map(cars.map((c) => [c.id, { ...c }]));
    this.tunnels = tunnels.map((t) => ({ ...t, cars: t.cars.slice() }));
    this.blockers = this.tunnels.map(tunnelBox);
    this.nextId = cars.reduce((m, c) => Math.max(m, c.id), 0) + 1;
    for (const t of this.tunnels) this.spawnMouth(t);
  }

  /** Put a tunnel's current head car on the board. No-op for a drained tunnel. */
  private spawnMouth(t: TunnelSpec): void {
    const car = mouthCar(t, this.nextId);
    if (!car) return;
    this.nextId++;
    this.cars.set(car.id, car);
    this.mouthOf.set(car.id, t);
  }

  canExit(carId: number): boolean {
    const car = this.cars.get(carId);
    if (!car) return false;
    return pathClear(car, Array.from(this.cars.values()), this.bounds, this.blockers);
  }

  /**
   * Take a car off the board, and -- if it was a tunnel's mouth car -- move the next one up
   * in the SAME call. There is no in-between state where a tunnel that still holds cars has
   * nothing at its mouth, and that is what makes `isEmpty` still mean "the level's lot is
   * clear" without a word being added to it: a tunnel with cars left always has one on the
   * board.
   *
   * The view's slide-out animation runs afterwards and changes nothing here; core has
   * already moved on. That is the same split `ParkedCar.ready` makes, minus the flag --
   * nothing about the new car's verdict differs during the slide, so core needs no notion
   * of it. The view swallows taps on a car still emerging on its own.
   */
  removeCar(carId: number): void {
    this.cars.delete(carId);
    const t = this.mouthOf.get(carId);
    if (!t) return;
    this.mouthOf.delete(carId);
    t.cars.shift();
    this.spawnMouth(t);
  }

  /** The id of the car at `tunnelId`'s mouth, or null once it is drained. */
  mouthCarId(tunnelId: number): number | null {
    for (const [id, t] of this.mouthOf) if (t.id === tunnelId) return id;
    return null;
  }

  /** How many cars `tunnelId` still holds, the one at the mouth included. */
  remainingIn(tunnelId: number): number {
    return this.tunnels.find((t) => t.id === tunnelId)?.cars.length ?? 0;
  }

  // isEmpty / movableCarIds 不动
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd logic && npx jest tests/lot-system.test.ts`
Expected: PASS

- [ ] **Step 5: 跑双闸**

Run: `cd logic && npm test`
Expected: PASS。`GameCore` 现在还没把 `level.lot.tunnels` 传下来,所以既有关卡的行为一个字没变。

Run: `cd logic && npm run typecheck:view`
Expected: PASS

- [ ] **Step 6: 把 `GameCore` 接上,再跑一次**

`game/assets/scripts/core/game-core.ts` 构造函数第一行:

```ts
    this.lot = new LotSystem(
      { w: level.lot.w, h: level.lot.h }, level.lot.cars, level.lot.tunnels ?? [],
    );
```

Run: `cd logic && npm test`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/core/lot-system.ts game/assets/scripts/core/game-core.ts \
        logic/tests/lot-system.test.ts
git commit -m "feat(core): a tunnel moves its next car up the moment the last one leaves"
```

---

## Task 3: `validateLevel` 认识隧道

**Files:**
- Modify: `game/assets/scripts/core/level-data.ts:9-58`(`validateLevel`)
- Test: `logic/tests/level-data.test.ts`(追加)

**Interfaces:**
- Consumes: `tunnelBox`、`mouthCar`、`tunnelReservation`(Task 1)
- Produces: 无新导出 —— `validateLevel` 的错误串多六种

- [ ] **Step 1: 写失败的测试**

追加到 `logic/tests/level-data.test.ts`。注意既有的 `baseLevel()` 场地只有 2×2,装不下一条隧道(保留盒 3.208 长),所以这里另起一个:

```ts
function tunnelLevel(): LevelData {
  return {
    id: 1,
    lot: {
      w: 9, h: 6,
      cars: [{ id: 1, x: -3, y: 2, angle: 90, color: 'red', cap: 'small' }],
      tunnels: [{
        id: 1, x: 1, y: 0, angle: 0,
        cars: [{ color: 'red', cap: 'small' }, { color: 'red', cap: 'small' }],
      }],
    },
    parking: { slots: 4, unlocked: 4 },
    // 1 grid car + 2 tunnel cars, all small = 3 * 16
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 48 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('a level with a tunnel validates', () => {
  expect(validateLevel(tunnelLevel())).toEqual([]);
});

test('tunnel cars count towards the colour balance', () => {
  const lvl = tunnelLevel();
  lvl.loop.queue = [{ color: 'red', count: 16 }];   // the grid car only
  expect(validateLevel(lvl).join(' ')).toContain('car capacity 48 != passengers 16');
});

test('a tunnel whose reservation leaves the lot is reported', () => {
  const lvl = tunnelLevel();
  lvl.lot.tunnels![0].x = 3.5;      // reservation reaches 5.104, past the 4.5 half-width
  expect(validateLevel(lvl).join(' ')).toContain('tunnel 1 does not fit inside the lot');
});

test('a car inside a tunnel body is reported', () => {
  const lvl = tunnelLevel();
  lvl.lot.cars[0] = { id: 1, x: 1, y: 0, angle: 0, color: 'red', cap: 'small' };
  expect(validateLevel(lvl).join(' ')).toContain('tunnel 1 and car 1');
});

test('a car standing where the mouth car stands is reported', () => {
  const lvl = tunnelLevel();
  lvl.lot.cars[0] = { id: 1, x: 2.122, y: 0, angle: 0, color: 'red', cap: 'small' };
  expect(validateLevel(lvl).join(' ')).toContain("tunnel 1's mouth car and car 1");
});

test('two tunnels closer than the clearance are reported', () => {
  const lvl = tunnelLevel();
  lvl.lot.w = 12;
  lvl.lot.tunnels = [
    { id: 1, x: -1, y: 0, angle: 0, cars: [{ color: 'red', cap: 'small' }] },
    { id: 2, x: 1, y: 0, angle: 0, cars: [{ color: 'red', cap: 'small' }] },
  ];
  lvl.loop.queue = [{ color: 'red', count: 48 }];
  expect(validateLevel(lvl).join(' ')).toContain('tunnels 1 and 2');
});

test('an empty tunnel is a data error, not a drained one', () => {
  const lvl = tunnelLevel();
  lvl.lot.tunnels![0].cars = [];
  lvl.loop.queue = [{ color: 'red', count: 16 }];
  expect(validateLevel(lvl).join(' ')).toContain('tunnel 1 holds no cars');
});
```

> 两条隧道那个用例的算术:保留盒各 3.208 长,中心相距 2,所以从 -2.604..0.604 和 -0.604..2.604 重叠 1.208 —— 远超 `CLEARANCE`。

- [ ] **Step 2: 跑一遍确认它失败**

Run: `cd logic && npx jest tests/level-data.test.ts`
Expected: FAIL —— 除了第一个用例(现在也 vacuously 通过),其余全挂

- [ ] **Step 3: 改 `validateLevel`**

顶部的容量统计加上隧道车:

```ts
  const carCap: Record<string, number> = {};
  for (const c of level.lot.cars) {
    carCap[c.color] = (carCap[c.color] || 0) + CAP_SIZE[c.cap];
  }
  // Tunnel cars are cars: they take passengers exactly like the ones on the board, and a
  // level whose queue does not cover them is unwinnable in a way nothing else notices.
  for (const t of level.lot.tunnels ?? []) {
    for (const c of t.cars) carCap[c.color] = (carCap[c.color] || 0) + CAP_SIZE[c.cap];
  }
```

几何检查那一段,在 `const pad = CLEARANCE / 2;` 与车-车两重循环**之后**,`parking.unlocked` 检查之前插入:

```ts
  // Tunnels. Three separate boxes get checked because they answer three questions: the
  // RESERVATION says the tunnel plus a car at either end fits on the board (it is symmetric,
  // so this holds whichever heading the tunnel is aimed down), the BODY is what blocks, and
  // the MOUTH CAR is an actual car standing on the lot from the first frame and owes every
  // other car the same clearance they owe each other.
  const tunnels = level.lot.tunnels ?? [];
  for (const t of tunnels) {
    if (t.cars.length === 0) {
      errors.push(`tunnel ${t.id} holds no cars`);
      continue;   // every box below is sized from the cars
    }
    if (!insideRect(tunnelReservation(t), level.lot.w, level.lot.h)) {
      errors.push(`tunnel ${t.id} does not fit inside the lot`);
    }
    const body = tunnelBox(t);
    const mouth = mouthCar(t, -1);
    for (const car of cars) {
      if (!Number.isFinite(car.angle)) continue;
      const grown = inflate(carBox(car), pad);
      if (overlapMTV(inflate(body, pad), grown)) {
        errors.push(`tunnel ${t.id} and car ${car.id} are closer than the clearance`);
      }
      if (mouth && overlapMTV(inflate(carBox(mouth), pad), grown)) {
        errors.push(`tunnel ${t.id}'s mouth car and car ${car.id} are closer than the clearance`);
      }
    }
  }
  for (let i = 0; i < tunnels.length; i++) {
    for (let j = i + 1; j < tunnels.length; j++) {
      const a = inflate(tunnelReservation(tunnels[i]), pad);
      const b = inflate(tunnelReservation(tunnels[j]), pad);
      if (overlapMTV(a, b)) {
        errors.push(`tunnels ${tunnels[i].id} and ${tunnels[j].id} are closer than the clearance`);
      }
    }
  }
```

import 一行:

```ts
import { mouthCar, tunnelBox, tunnelReservation } from './tunnel';
```

- [ ] **Step 4: 跑双闸**

Run: `cd logic && npm test`
Expected: PASS

Run: `cd logic && npm run typecheck:view`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/core/level-data.ts logic/tests/level-data.test.ts
git commit -m "feat(core): validateLevel checks a tunnel's reservation, body and mouth car"
```

---

## Task 4: 可解性判定认识隧道

**Files:**
- Modify: `game/assets/scripts/core/solvability.ts`
- Test: `logic/tests/solvability.test.ts`(追加)

**Interfaces:**
- Consumes: `LotSystem`(Task 2)
- Produces: `Difficulty.cars` / `.colors` 现在把隧道车算进去;`isSolvable` 对隧道正确作答

- [ ] **Step 1: 写失败的测试**

追加到 `logic/tests/solvability.test.ts`:

```ts
import { LevelData } from '../../game/assets/scripts/core/index';

/** One grid car out of the way, and a tunnel of two facing clear board. */
function drainableTunnel(): LevelData {
  return {
    id: 1,
    lot: {
      w: 9, h: 6,
      cars: [{ id: 1, x: -3, y: 2, angle: 90, color: 'red', cap: 'small' }],
      tunnels: [{
        id: 1, x: 1, y: 0, angle: 0,
        cars: [{ color: 'red', cap: 'small' }, { color: 'red', cap: 'small' }],
      }],
    },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 48 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

/**
 * Two tunnels nose to tail. The left one's mouth car drives straight into the right one's
 * BODY, which never moves and never leaves -- so it is welded shut forever, and no order of
 * play clears the lot. The right one drains normally, which is what makes this a test of
 * the tunnel and not of the lot.
 */
function weldedTunnel(): LevelData {
  return {
    id: 1,
    lot: {
      w: 12, h: 6,
      cars: [],
      tunnels: [
        { id: 1, x: -2, y: 0, angle: 0, cars: [{ color: 'red', cap: 'small' }] },
        { id: 2, x: 2, y: 0, angle: 0, cars: [{ color: 'red', cap: 'small' }] },
      ],
    },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 32 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('a level whose tunnel can drain is solvable', () => {
  expect(isSolvable(drainableTunnel())).toBe(true);
});

test('a tunnel welded shut by another tunnel makes the level unsolvable', () => {
  // Valid data -- the two reservations are 0.792 apart -- and still unclearable.
  expect(validateLevel(weldedTunnel())).toEqual([]);
  expect(isSolvable(weldedTunnel())).toBe(false);
});

test('draining a tunnel takes one round per car', () => {
  // Round 1 takes the grid car and the first tunnel car; round 2 takes the second, which
  // only reached the mouth when the first left.
  expect(estimateDifficulty(drainableTunnel()).rounds).toBe(2);
});

test('difficulty counts the cars still inside a tunnel', () => {
  expect(estimateDifficulty(drainableTunnel()).cars).toBe(3);
});
```

顶部补一个 import:

```ts
import { validateLevel } from '../../game/assets/scripts/core/index';
```

- [ ] **Step 2: 跑一遍确认它失败**

Run: `cd logic && npx jest tests/solvability.test.ts`
Expected: FAIL —— `rounds` 是 1 而不是 2(旧的 `clearGrid` 看不见补位),`cars` 是 1 而不是 3

- [ ] **Step 3: 改 `solvability.ts`**

```ts
import { LevelData } from './types';
import { validateLevel } from './level-data';
import { LotSystem } from './lot-system';

/**
 * Greedily remove every currently-exitable car, round by round. Because exitability is
 * monotone under removals, this is complete: if it stalls with cars remaining, they are a
 * mutual-block cycle and the lot is unclearable.
 *
 * Runs on a `LotSystem` rather than on the level's car array, and that is what makes it
 * right in the presence of tunnels: a removal can PUT A NEW CAR ON THE BOARD, and a walk
 * over a static array would clear the lot on paper while the tunnels were still full. The
 * new car deliberately does not get to leave in the round that produced it -- `movable` is
 * taken once at the top -- so `rounds` still counts "waves", and draining a tunnel of n
 * cars costs n of them.
 *
 * Termination is unchanged in substance: every round removes at least one car, and the total
 * number of cars (on the board plus inside every tunnel) is finite and never grows.
 */
function clearGrid(level: LevelData): { cleared: boolean; rounds: number; blocked: number } {
    const lot = new LotSystem(
        { w: level.lot.w, h: level.lot.h }, level.lot.cars, level.lot.tunnels ?? [],
    );
    const blocked = Array.from(lot.cars.keys()).filter((id) => !lot.canExit(id)).length;

    let rounds = 0;
    while (lot.cars.size > 0) {
        const movable = lot.movableCarIds();
        if (movable.length === 0) return { cleared: false, rounds, blocked };
        for (const id of movable) lot.removeCar(id);
        rounds++;
    }
    return { cleared: true, rounds, blocked };
}
```

`estimateDifficulty` 的 `cars` 和 `colors` 把隧道车算进去:

```ts
export function estimateDifficulty(level: LevelData): Difficulty {
    const r = clearGrid(level);
    const tunnelCars = (level.lot.tunnels ?? []).flatMap((t) => t.cars);
    const cars = level.lot.cars.length + tunnelCars.length;
    const colors = new Set([
        ...level.lot.cars.map((c) => c.color),
        ...tunnelCars.map((c) => c.color),
    ]).size;
    const score = r.rounds * 3 + r.blocked * 2 + cars + colors;
    return { rounds: r.rounds, cars, colors, blocked: r.blocked, score };
}
```

> `blocked` 现在也把洞口车算在内 —— 一条被堵死的隧道口就是一辆被堵死的车,这正是它该表达的意思。既有十关没有隧道,所以它们的数字一个都不变。

- [ ] **Step 4: 跑双闸**

Run: `cd logic && npm test`
Expected: PASS。既有的十关没有 `tunnels` 字段,`clearGrid` 走的是同一条路,`level-gen.test.ts` 里对难度的断言不动。

Run: `cd logic && npm run typecheck:view`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/core/solvability.ts logic/tests/solvability.test.ts
git commit -m "feat(core): the solver plays the lot instead of walking a list, so tunnels refill"
```

---

## Task 5: 生成器的曲线与落位

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts`
- Test: `logic/tests/level-gen.test.ts`(追加)

**Interfaces:**
- Consumes: `tunnelReservation`(Task 1)、`insideRect`/`overlapMTV`/`inflate`(`core/geometry.ts`)
- Produces:
  - `export interface TunnelParams { count: number; cars: number }`
  - `export function tunnelParams(id: number): TunnelParams`
  - `export const CARS_PER_LEVEL: number`(把既有的 `const` 加上 `export`)
  - `function placeTunnels(rng: () => number, colors: number, tp: TunnelParams): TunnelSpec[]`(模块内)

这一步**只做纯数据的部分**,不碰 `pack`/`peel`/`generateLevel` —— 那是 Task 6。做完这一步 `npm test` 依然全绿而生成的关卡一个字没变。

- [ ] **Step 1: 写失败的测试**

追加到 `logic/tests/level-gen.test.ts`:

```ts
import { tunnelParams, CARS_PER_LEVEL } from '../../game/assets/scripts/core/level-gen';

test('the tunnel curve: none before level 4, two from level 7', () => {
  expect(tunnelParams(1)).toEqual({ count: 0, cars: 0 });
  expect(tunnelParams(3)).toEqual({ count: 0, cars: 0 });
  expect(tunnelParams(4)).toEqual({ count: 1, cars: 4 });
  expect(tunnelParams(6)).toEqual({ count: 1, cars: 4 });
  expect(tunnelParams(7)).toEqual({ count: 2, cars: 5 });
  expect(tunnelParams(9)).toEqual({ count: 2, cars: 6 });
  expect(tunnelParams(10)).toEqual({ count: 2, cars: 6 });
});

test('the tunnel curve clamps past its ends, like levelParams does', () => {
  expect(tunnelParams(0)).toEqual(tunnelParams(1));
  expect(tunnelParams(99)).toEqual(tunnelParams(10));
});

test('no level ever asks for more tunnel cars than it has cars', () => {
  for (const id of IDS) {
    const tp = tunnelParams(id);
    expect(tp.count * tp.cars).toBeLessThan(CARS_PER_LEVEL);
  }
});
```

- [ ] **Step 2: 跑一遍确认它失败**

Run: `cd logic && npx jest tests/level-gen.test.ts -t 'tunnel curve'`
Expected: FAIL —— `tunnelParams` 不存在

- [ ] **Step 3: 加曲线和落位**

`level-gen.ts`,把 `const CARS_PER_LEVEL = 60;` 改成 `export const CARS_PER_LEVEL = 60;`,并在 `TRACK_CURVE` 那一段旁边加:

```ts
/** How many tunnels a level has, and how many cars each of them holds. */
export interface TunnelParams { count: number; cars: number }

/**
 * The tunnel curve, one row per level, alongside TRACK_CURVE and read the same way.
 *
 * Nothing before level 4: a tunnel is a colour you cannot see coming, and the first three
 * levels are where the player learns what the colours are FOR. It arrives one at a time
 * (levels 4-6), then doubles, then deepens -- count first and depth second, because a second
 * tunnel adds a second place to watch while a deeper one only adds more of the same gamble.
 *
 * The cars in these tunnels come OUT of CARS_PER_LEVEL, not on top of it: `generateLevel`
 * packs the lot with the remainder. A level's passenger total and its difficulty curve were
 * both tuned against 60 cars and neither wants to move for this.
 */
const TUNNEL_CURVE: TunnelParams[] = [
    { count: 0, cars: 0 },   // 1
    { count: 0, cars: 0 },   // 2
    { count: 0, cars: 0 },   // 3
    { count: 1, cars: 4 },   // 4
    { count: 1, cars: 4 },   // 5
    { count: 1, cars: 4 },   // 6
    { count: 2, cars: 5 },   // 7
    { count: 2, cars: 5 },   // 8
    { count: 2, cars: 6 },   // 9
    { count: 2, cars: 6 },   // 10
];

export function tunnelParams(id: number): TunnelParams {
    const i = Math.min(Math.max(1, id), TUNNEL_CURVE.length) - 1;
    return TUNNEL_CURVE[i];
}

/** Placement draws before a tunnel is written off and the whole attempt with it. */
const PLACE_TRIES = 200;

/**
 * Scatter `tp.count` tunnels over an EMPTY lot, or return nothing at all.
 *
 * Before the cars, deliberately: a tunnel cannot be nudged out of the way the packer nudges
 * a car (its mouth would move, and with it the car standing outside), so it has to be the
 * thing everything else is packed around. Each one takes a symmetric reservation -- see
 * `tunnelReservation` for why -- and must clear the lot's edge and every reservation already
 * placed.
 *
 * `angle` here is an AXIS, not yet a heading. Which of the two ends the mouth opens onto is
 * decided by `aimTunnels`, after the cars are down and there is something to aim against.
 *
 * Colours are drawn flat from the level's palette. There is no cleverness to add: the queue
 * is derived from the cars (`queueFor`), so any draw is colour-balanced by construction, and
 * "mixed, and you only see the one at the mouth" is the mechanic rather than a compromise.
 */
function placeTunnels(rng: () => number, colors: number, tp: TunnelParams): TunnelSpec[] {
    const pad = CLEARANCE / 2 + ROUND_MARGIN;
    const out: TunnelSpec[] = [];
    for (let i = 0; i < tp.count; i++) {
        let placed: TunnelSpec | null = null;
        for (let k = 0; k < PLACE_TRIES && !placed; k++) {
            const t: TunnelSpec = {
                id: i + 1,
                x: (rng() - 0.5) * LOT.w,
                y: (rng() - 0.5) * LOT.h,
                angle: rng() * 360,
                cars: Array.from({ length: tp.cars }, () => ({
                    color: PALETTE[Math.floor(rng() * colors)],
                    cap: 'small' as Cap,
                })),
            };
            const box = inflate(tunnelReservation(t), pad);
            if (!insideRect(box, LOT.w, LOT.h)) continue;
            if (out.some((o) => overlapMTV(box, inflate(tunnelReservation(o), pad)))) continue;
            placed = t;
        }
        if (!placed) return [];   // a lot this attempt cannot seat; the caller retries
        out.push(placed);
    }
    return out;
}
```

import 补上(`level-gen.ts` 顶部已经有 `inflate`/`overlapMTV`/`obbCorners`,按实际缺什么补):

```ts
import { insideRect } from './geometry';
import { tunnelReservation } from './tunnel';
import { CLEARANCE, TunnelSpec } from './types';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd logic && npx jest tests/level-gen.test.ts -t 'tunnel'`
Expected: PASS,3 个新用例全绿

- [ ] **Step 5: 跑双闸**

Run: `cd logic && npm test`
Expected: PASS。`placeTunnels` 还没有任何调用者,生成的关卡一个字没变 —— `level-gen.test.ts` 里所有既有断言原样通过。

Run: `cd logic && npm run typecheck:view`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/core/level-gen.ts logic/tests/level-gen.test.ts
git commit -m "feat(core): the tunnel curve, and a placer that lays tunnels down before the cars"
```

---

## Task 6: 生成器接上隧道,并重跑十关

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts`(`pack` / `peel` / `scatter` / `queueFor` / `assemble` / `repair` / `choosePainting` / `generateLevel`)
- Modify: `tools/gen-levels.ts`
- Modify: `game/assets/resources/levels/level-1.json` … `level-10.json`(重新生成)
- Test: `logic/tests/level-gen.test.ts`(追加)

**Interfaces:**
- Consumes: Task 1~5 的全部产出
- Produces: `generateLevel(id)` 的关卡自第 4 关起带 `lot.tunnels`

- [ ] **Step 1: 写失败的测试**

追加到 `logic/tests/level-gen.test.ts`:

```ts
import { LotSystem } from '../../game/assets/scripts/core/lot-system';

test('levels carry the tunnels their curve asks for', () => {
  for (const id of IDS) {
    const tp = tunnelParams(id);
    const got = levelFor(id).lot.tunnels ?? [];
    expect(got.length).toBe(tp.count);
    for (const t of got) expect(t.cars.length).toBe(tp.cars);
  }
});

test('every level still totals CARS_PER_LEVEL cars', () => {
  for (const id of IDS) {
    const lvl = levelFor(id);
    const inside = (lvl.lot.tunnels ?? []).reduce((n, t) => n + t.cars.length, 0);
    expect(lvl.lot.cars.length + inside).toBe(CARS_PER_LEVEL);
  }
});

test('no tunnel is welded shut at the start', () => {
  for (const id of IDS) {
    const lvl = levelFor(id);
    const lot = new LotSystem(
      { w: lvl.lot.w, h: lvl.lot.h }, lvl.lot.cars, lvl.lot.tunnels ?? [],
    );
    for (const t of lot.tunnels) {
      const mouth = lot.mouthCarId(t.id);
      expect(mouth).not.toBeNull();
      // Not a correctness requirement -- see the note on `WELDED_PENALTY`, a welded tunnel
      // is still drainable once the lot empties -- but a count the player cannot spend on
      // the first tap reads as a bug, so the search is asked to avoid it and this is what
      // says whether it did.
      expect(lot.canExit(mouth!)).toBe(true);
    }
  }
});

test('tunnel cars only ever use the level palette', () => {
  for (const id of IDS) {
    const lvl = levelFor(id);
    const onBoard = new Set(lvl.lot.cars.map((c) => c.color));
    for (const t of lvl.lot.tunnels ?? []) {
      for (const c of t.cars) expect(onBoard.has(c.color)).toBe(true);
    }
  }
});
```

既有的 `test('every level is solvable')`、`test('every level validates')`、颜色平衡那几个用例**一个字不改** —— 它们现在覆盖的是带隧道的关卡,这正是要的。

- [ ] **Step 2: 跑一遍确认它失败**

Run: `cd logic && npx jest tests/level-gen.test.ts`
Expected: FAIL —— 生成的关卡没有 `tunnels`,前三个新用例挂

- [ ] **Step 3: 让 `pack` 绕开隧道**

```ts
/**
 * Fill the lot with `want` pieces around `tunnels`, or return nothing at all.
 *
 * The tunnels are IMMOVABLE. Every other pair in this relaxation shoves both ways, but a
 * tunnel cannot be shoved: its mouth would move with it, and the car standing outside the
 * mouth would move with that. So a piece overlapping a reservation takes the whole MTV
 * itself -- which is also what the pair sweep does to each of its two, and for the reason
 * given there.
 */
function pack(rng: () => number, want: number, tunnels: TunnelSpec[]): Piece[] {
    const pad = CLEARANCE / 2 + ROUND_MARGIN;
    const reserved = tunnels.map((t) => inflate(tunnelReservation(t), pad));
    // ...(caps / pieces 的构造完全不动)

    for (let iter = 0; iter < RELAX_ITERS; iter++) {
        let moved = false;
        // ...(既有的 i<j 两重循环完全不动)
        for (const piece of pieces) {
            for (const r of reserved) {
                const mtv = overlapMTV(packBox(piece), r);
                if (!mtv || Math.hypot(mtv.x, mtv.y) < SETTLED_GAP) continue;
                moved = true;
                piece.x += mtv.x;
                piece.y += mtv.y;
                clampInside(piece);
            }
        }
        if (!moved) return pieces;
    }
    // Never settled. A piece pinned between a wall and a reservation can push back and forth
    // forever, and a failed attempt is much cheaper than a lot with a car inside a tunnel.
    return [];
}
```

- [ ] **Step 4: 让 `peel` 认隧道,并给隧道定朝向**

```ts
/**
 * Point each tunnel down whichever of its two axis headings leaves the mouth car a clear
 * lane; keep the axis when neither does.
 *
 * The direct analogue of `headingsFor`, and it works for the same reason: the reservation
 * is symmetric, so a tunnel turned a half turn covers the same board and the packing stays
 * valid either way. Probed against the pieces AT THEIR OWN ANGLES, which is the same
 * occupancy model `peel` and `isSolvable` use, so the three cannot disagree.
 */
function aimTunnels(tunnels: TunnelSpec[], pieces: Piece[]): TunnelSpec[] {
    const probes: CarSpec[] = pieces.map((p, i) => ({
        id: i + 1, x: p.x, y: p.y, angle: p.angle, color: '', cap: p.cap,
    }));
    // A tunnel body is unchanged by a half turn, so one set of bodies serves both headings.
    const bodies = tunnels.map(tunnelBox);
    return tunnels.map((t) => {
        for (const angle of [t.angle, (t.angle + 180) % 360]) {
            const aimed = { ...t, angle };
            const mouth = mouthCar(aimed, 0);
            if (mouth && pathClear(mouth, probes, LOT, bodies)) return aimed;
        }
        return t;
    });
}
```

`peel` 多收一组静止盒子,并把它传给 `pathClear`:

```ts
function peel(
    rng: () => number, pieces: Piece[], blockers: OBB[],
): { piece: Piece; angle: number }[] {
    // ...内层唯一的改动:
            if (pathClear({ ...probes[i], angle }, probes, LOT, blockers)) moves.push({ i, angle });
}
```

- [ ] **Step 5: `scatter` / `queueFor` / `assemble` / `repair` 一起带上隧道**

```ts
/** Passenger queue implied by every car in the level -- on the board AND inside a tunnel. */
function queueFor(cars: CarSpec[], tunnels: TunnelSpec[]): QueueGroup[] {
    const seats = new Map<string, number>();
    for (const car of cars) {
        seats.set(car.color, (seats.get(car.color) ?? 0) + CAP_SIZE[car.cap]);
    }
    for (const t of tunnels) {
        for (const c of t.cars) {
            seats.set(c.color, (seats.get(c.color) ?? 0) + CAP_SIZE[c.cap]);
        }
    }
    return PALETTE.filter((c) => seats.has(c)).map((color) => ({
        color, count: seats.get(color) as number,
    }));
}

function assemble(id: number, cars: CarSpec[], tunnels: TunnelSpec[] = []): LevelData {
    const track = trackParams(id);
    return {
        id,
        // Omitted entirely when there are none, so levels 1-3 keep the shape they had.
        lot: tunnels.length > 0
            ? { w: LOT.w, h: LOT.h, cars, tunnels }
            : { w: LOT.w, h: LOT.h, cars },
        parking: { slots: SLOTS, unlocked: UNLOCKED },
        loop: {
            capacity: track.capacity,
            boardIndex: track.capacity / 2,
            track: track.track,
            feeds: track.feeds,
            queue: queueFor(cars, tunnels),
        },
        powerups: { refresh: 3, hardClear: 1, magnet: 1 },
    };
}

function scatter(
    rng: () => number, p: GenParams, tp: TunnelParams,
): { cars: CarSpec[]; tunnels: TunnelSpec[] } {
    const tunnels = placeTunnels(rng, p.colors, tp);
    if (tunnels.length < tp.count) return { cars: [], tunnels: [] };
    const pieces = pack(rng, p.cars - tp.count * tp.cars, tunnels);
    const aimed = aimTunnels(tunnels, pieces);
    const order = peel(rng, pieces, aimed.map(tunnelBox));
    const cars = order.map(({ piece, angle }, i) => ({
        id: i + 1,
        x: round4(piece.x),
        y: round4(piece.y),
        angle: round4(((angle % 360) + 360) % 360) % 360,
        color: PALETTE[i % p.colors],
        cap: piece.cap,
    }));
    return { cars, tunnels: aimed };
}

/**
 * Drop GRID cars until the lot clears. The tunnels stay: they are not the safety valve, and
 * dropping one would change the level's passenger total by four to six cars at a stroke.
 */
function repair(id: number, cars: CarSpec[], tunnels: TunnelSpec[]): CarSpec[] {
    const kept = cars.slice();
    while (kept.length > 0 && !isSolvable(assemble(id, kept, tunnels))) kept.pop();
    return kept;
}
```

`repaint`/`paintings` 不动。`choosePainting` 多带一个 `tunnels` 参数,只是为了 `assemble` 得到完整的关卡去跑 `isHardButFair`:

```ts
function choosePainting(
    id: number, cars: CarSpec[], tunnels: TunnelSpec[], p: GenParams,
): CarSpec[] | null {
    // ...唯一的改动:
        const verdict = isHardButFair(assemble(id, painted, tunnels));
}
```

> 隧道车不参与重绘。它们不在剥离顺序里(出场时机由玩家点隧道决定,不由 `peel` 决定),而 `queueFor` 是从车推出乘客的,所以怎么绘都不会破坏平衡。

- [ ] **Step 6: `generateLevel` 把隧道纳入搜索**

```ts
/**
 * How much a welded-shut tunnel mouth costs an attempt. Large enough to lose to nothing
 * else: a level that is two blocked cars off target still plays, while one whose count
 * badge cannot be spent on the first tap looks broken.
 *
 * A PENALTY and not a rejection, because a welded tunnel is not actually unsolvable -- the
 * lot empties around it and it drains at the end (see the spec's solvability argument). If
 * no attempt in 200 finds a clear mouth, a playable level is still better than none.
 */
const WELDED_PENALTY = 100;

/** Tunnels whose mouth car cannot move on the opening position. */
function weldedMouths(level: LevelData): number {
    const lot = new LotSystem(
        { w: level.lot.w, h: level.lot.h }, level.lot.cars, level.lot.tunnels ?? [],
    );
    let n = 0;
    for (const t of lot.tunnels) {
        const id = lot.mouthCarId(t.id);
        if (id === null || !lot.canExit(id)) n++;
    }
    return n;
}

export function generateLevel(id: number): LevelData {
    const p = levelParams(id);
    const tp = tunnelParams(id);
    // The tunnels' cars come OUT of the level's budget, so the lot gets the remainder.
    const gridCars = p.cars - tp.count * tp.cars;
    // Measured against what is actually ON the board at the start: the grid cars plus one
    // mouth car per tunnel. `blockedRatio` was tuned as a share of that, not of the budget.
    const wantBlocked = Math.round(p.blockedRatio * (gridCars + tp.count));
    let best: { cars: CarSpec[]; tunnels: TunnelSpec[]; miss: number } | null = null;
    const onTarget: { cars: CarSpec[]; tunnels: TunnelSpec[] }[] = [];

    for (let attempt = 0; attempt < ATTEMPTS && onTarget.length < PACKINGS; attempt++) {
        const { cars, tunnels } = scatter(mulberry32(id * 7919 + attempt), p, tp);
        if (cars.length < gridCars || tunnels.length < tp.count) continue;
        const level = assemble(id, cars, tunnels);
        if (!isSolvable(level)) continue;
        const welded = weldedMouths(level);
        const d = estimateDifficulty(level);
        if (welded === 0
            && Math.abs(d.blocked - wantBlocked) <= BLOCKED_TOLERANCE
            && d.rounds >= p.minRounds) {
            onTarget.push({ cars, tunnels });
            continue;
        }
        const miss = Math.abs(d.blocked - wantBlocked)
            + Math.max(0, p.minRounds - d.rounds)
            + welded * WELDED_PENALTY;
        if (!best || miss < best.miss) best = { cars, tunnels, miss };
    }

    for (const { cars, tunnels } of onTarget) {
        const painted = choosePainting(id, cars, tunnels, p);
        if (painted) return assemble(id, painted, tunnels);
    }
    if (onTarget.length > 0) return assemble(id, onTarget[0].cars, onTarget[0].tunnels);
    if (best) return assemble(id, best.cars, best.tunnels);
    const fallback = scatter(mulberry32(id * 7919), p, tp);
    return assemble(id, repair(id, fallback.cars, fallback.tunnels), fallback.tunnels);
}
```

- [ ] **Step 7: 跑 core 测试**

Run: `cd logic && npm test`
Expected: PASS

若 `no tunnel is welded shut at the start` 挂了(某一关 200 次尝试都没找到通畅的洞口),**不要改测试**。按顺序试这两条:先把 `PLACE_TRIES` 提到 400 让落位本身更容易找到好位置;还不行就在 `placeTunnels` 里把中心点的抽样收进 `LOT` 的内侧八成(`(rng() - 0.5) * LOT.w * 0.8`),让隧道离墙远一点、两个朝向都有指望。

- [ ] **Step 8: 改 `tools/gen-levels.ts`**

乘客数现在只数了网格车,要把隧道车加上;顺便加一列,不然表格看不出隧道排没排出来:

```ts
    const tunnels = level.lot.tunnels ?? [];
    const pax = level.lot.cars.reduce((n, c) => n + CAP_SIZE[c.cap], 0)
        + tunnels.reduce((n, t) => n + t.cars.reduce((m, c) => m + CAP_SIZE[c.cap], 0), 0);
    const tun = tunnels.length === 0
        ? '-'
        : `${tunnels.length}x${tunnels[0].cars.length}`;
```

把 `tun` 加进 `rows.push(...)` 那一行的表格里,表头同步加一列 `tun`。

- [ ] **Step 9: 重跑十关**

Run: `cd logic && npm run gen`
Expected: 打印十行,无 `[gen] level N is invalid`,第 4~6 关 `tun` 列显示 `1x4`,第 7~8 关 `2x5`,第 9~10 关 `2x6`

**读一遍那张表再往下走** —— 它是唯一能看到难度曲线实际产出了什么的地方。若 `blocked` 列大面积偏离目标,回 Step 6 检查 `wantBlocked` 的算式。

- [ ] **Step 10: 跑双闸**

Run: `cd logic && npm test`
Expected: PASS

Run: `cd logic && npm run typecheck:view`
Expected: PASS

- [ ] **Step 11: 提交**

```bash
git add game/assets/scripts/core/level-gen.ts tools/gen-levels.ts \
        game/assets/resources/levels/ logic/tests/level-gen.test.ts
git commit -m "feat(core): the generator lays a tunnel down first and packs the lot around it"
```

---

## Task 7: 隧道的网格

**Files:**
- Create: `game/assets/scripts/view/tunnel-mesh.ts`
- Test: 无(view 没有测试环境;闸门是 `npm run typecheck:view` 与真机预览)

**Interfaces:**
- Consumes: `MeshPart`、`mergeParts`、`makeMerged`(`view/slabs.ts`);`TUNNEL_BOX`(`core/index.ts`)
- Produces:
  - `export const TUNNEL_HEIGHT_RATIO: number` —— 拱顶高度相对宽度的比例
  - `export const TUNNEL_SHELL: Color`、`export const TUNNEL_MOUTH: Color` —— 隧道的两个颜色
  - `export function buildTunnel(name: string, len: number, wid: number, shell: Color, mouth: Color): Node`

- [ ] **Step 1: 写 `tunnel-mesh.ts`**

`slabs.ts` 的 `boxPart` 只能在 X/Y 平面上偏移,拱是在「横向 × 高度」平面上弯的,所以这里要自己攒顶点 —— `MeshPart` 就是裸的 `positions/normals/uvs/indices`,`mergeParts` 收得下。

```ts
import { Color, Node } from 'cc';
import { makeMerged, MeshPart } from './slabs';

/**
 * The tunnel, drawn. A half-tube lying along +X with a wall across its far end, plus a dark
 * disc set into the near end so the opening reads as a hole rather than as a painted stripe.
 *
 * Built here rather than loaded: there are no models left in this project, and a tunnel is a
 * simpler surface than a car. It knows nothing about core -- `GameController` hands it the
 * size, having taken that from TUNNEL_BOX like every other body size.
 */

/** Segments around the arch. Nine reads as a curve and still merges into one draw call. */
const ARCH_SEG = 9;

/** Arch height as a share of the width. Slightly under a half circle, so it sits squat. */
const RISE = 0.62;

/** How far the dark mouth disc is set back from the opening. */
const MOUTH_INSET = 0.04;

export const TUNNEL_HEIGHT_RATIO = RISE;

/**
 * The tunnel's two colours, from the reference art: a periwinkle shell and a near-black
 * navy opening. Declared here rather than in `colors.ts` on purpose -- that file is the
 * palette keyed by core's colour STRINGS, and a tunnel has no colour in core.
 */
export const TUNNEL_SHELL = new Color(120, 156, 232);
export const TUNNEL_MOUTH = new Color(38, 52, 96);

/** A quad from four corners, with one flat normal. Wound counter-clockwise as listed. */
function quad(
    a: [number, number, number], b: [number, number, number],
    c: [number, number, number], d: [number, number, number],
    n: [number, number, number],
): MeshPart {
    return {
        positions: [...a, ...b, ...c, ...d],
        normals: [...n, ...n, ...n, ...n],
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        indices: [0, 1, 2, 0, 2, 3],
    };
}

/**
 * `len` runs along +X (the direction cars leave), `wid` across it, and the arch rises in +Z.
 * The node's own rotation puts it on the tunnel's heading, exactly as a car's does.
 */
export function buildTunnel(
    name: string, len: number, wid: number, shell: Color, mouth: Color,
): Node {
    const hl = len / 2;
    const hw = wid / 2;
    const h = wid * RISE;
    // Points around the arch, from the right rim over the top to the left rim.
    const ring: [number, number][] = [];
    for (let i = 0; i <= ARCH_SEG; i++) {
        const th = (i / ARCH_SEG) * Math.PI;
        ring.push([Math.cos(th) * hw, Math.sin(th) * h]);
    }

    const parts: MeshPart[] = [];
    for (let i = 0; i < ARCH_SEG; i++) {
        const [y0, z0] = ring[i];
        const [y1, z1] = ring[i + 1];
        // Outward normal of this facet, in the cross-section plane.
        const ny = (z1 - z0);
        const nz = -(y1 - y0);
        const nl = Math.hypot(ny, nz) || 1;
        parts.push(quad(
            [hl, y0, z0], [hl, y1, z1], [-hl, y1, z1], [-hl, y0, z0],
            [0, ny / nl, nz / nl],
        ));
    }
    // The back wall, one fan of quads from the floor centre out to the ring.
    for (let i = 0; i < ARCH_SEG; i++) {
        const [y0, z0] = ring[i];
        const [y1, z1] = ring[i + 1];
        parts.push(quad(
            [-hl, 0, 0], [-hl, y0, z0], [-hl, y1, z1], [-hl, 0, 0], [-1, 0, 0],
        ));
    }
    const node = makeMerged(name, parts, shell);

    // The opening: the same fan at the near end, in the dark colour, pushed just inside.
    const inner: MeshPart[] = [];
    for (let i = 0; i < ARCH_SEG; i++) {
        const [y0, z0] = ring[i];
        const [y1, z1] = ring[i + 1];
        const x = hl - MOUTH_INSET;
        inner.push(quad([x, 0, 0], [x, y1, z1], [x, y0, z0], [x, 0, 0], [1, 0, 0]));
    }
    node.addChild(makeMerged(`${name}-mouth`, inner, mouth));
    return node;
}
```

- [ ] **Step 2: 类型检查**

Run: `cd logic && npm run typecheck:view`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add game/assets/scripts/view/tunnel-mesh.ts
git commit -m "feat(view): a tunnel drawn as a half-tube with a dark mouth"
```

---

## Task 8: `GridView` 能给补位的车加节点

**Files:**
- Modify: `game/assets/scripts/view/grid-view.ts`
- Test: 无

**Interfaces:**
- Consumes: `LotSystem.cars`(Task 2 之后含洞口车)
- Produces:
  - `GridView.addCar(id: number): Node | null` —— 建节点、放好位置、开始跟踪,但**还不能被点**
  - `GridView.activateCar(id: number): void` —— 从此可被 `pickCar` 命中

- [ ] **Step 1: 把 `render()` 的循环体抽成一个私有方法**

```ts
    /** Build one car's node and its pick entry, from core's own numbers. */
    private build(id: number, car: CarSpec): { root: Node; entry: CarEntry } {
        const { len, wid } = this.layout.carSize(car.cap as Cap);
        const built = buildCar(
            `car-${id}`, len, wid, colorOf(car.color), car.angle, car.cap as Cap,
        );
        built.root.setPosition(this.layout.toWorld(car.x, car.y));
        this.parent.addChild(built.root);
        this.carNodes.set(id, built.root);
        return {
            root: built.root,
            entry: { id, node: built.root, body: built.body,
                     len: built.len, wid: built.wid, angle: car.angle },
        };
    }

    render(): void {
        for (const [id, car] of this.lot.cars) {
            this.entries.push(this.build(id, car).entry);
        }
    }
```

- [ ] **Step 2: 加 `addCar` / `activateCar`**

```ts
    /**
     * Draw a car that has just APPEARED rather than one the level started with -- today,
     * the next car out of a tunnel.
     *
     * It is deliberately not pickable yet. Core moved the new car up in the same call that
     * removed the last one, so it is already a legal tap the instant it exists; the view is
     * still sliding it out of the tunnel mouth, and letting it be tapped mid-slide would
     * either cut its own animation short or send a car that is visibly still inside. Holding
     * the pick entry back is the whole of the fix, and it costs core nothing -- see the note
     * on `LotSystem.removeCar`.
     *
     * Returns the node so the caller can animate it, or null if core has no such car.
     */
    addCar(id: number): Node | null {
        const car = this.lot.cars.get(id);
        if (!car) return null;
        const made = this.build(id, car);
        this.pending.set(id, made.entry);
        return made.root;
    }

    /** Let `pickCar` see a car that finished emerging. Ignores an unknown id. */
    activateCar(id: number): void {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        this.entries.push(entry);
    }
```

字段加一行,`detachCar` / `removeCar` 里同步清 `pending`(一辆还在滑出的车理论上不会被移走,但一个只清一半的表是下一个 bug 的温床):

```ts
    private pending = new Map<number, CarEntry>();
```

```ts
    detachCar(id: number): Node | null {
        const node = this.carNodes.get(id) ?? null;
        this.carNodes.delete(id);
        this.pending.delete(id);
        this.entries = this.entries.filter((e) => e.id !== id);
        return node;
    }
```

`removeCar` 同样补一行 `this.pending.delete(id);`。

- [ ] **Step 3: 类型检查**

Run: `cd logic && npm run typecheck:view`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add game/assets/scripts/view/grid-view.ts
git commit -m "feat(view): a car can join the lot after it is built, unpickable until it has arrived"
```

---

## Task 9: 场上的隧道 —— 建模、数字牌、补位动画

**Files:**
- Modify: `game/assets/scripts/view/GameController.ts`(`buildBoard`、`update`、`handleTap`)
- Modify: `game/assets/scripts/view/hud-view.ts`
- Test: 无

**Interfaces:**
- Consumes: `buildTunnel`(Task 7)、`GridView.addCar`/`activateCar`(Task 8)、`LotSystem.tunnels`/`mouthCarId`/`remainingIn`(Task 2)、`TUNNEL_BOX`(Task 1)
- Produces:
  - `HudView.setTunnelCount(tunnelId: number, n: number): void` —— n 为 0 时把牌子藏掉
  - `HudView.placeTunnelBadge(tunnelId: number, ui: Vec3): void`

- [ ] **Step 1: HUD 的数字牌**

`hud-view.ts` 里加一个按 id 索引的牌子表。牌子 = `roundedSprite` 的底 + `makeLabel` 的数字,和既有的 `liftedPill` 一个路数:

```ts
    private tunnelBadges = new Map<number, { holder: Node; label: Label }>();

    /**
     * The count on a tunnel: how many cars it still holds, the one at the mouth included.
     *
     * It lives in the HUD rather than on the board, and is placed each frame at the tunnel's
     * projected point -- the same route `placeSpeed` and the seat chips take. A Label on a
     * 3D node would need a second rendering path for the one piece of text outside the
     * Canvas; this needs none, and faces the camera for free. What it gives up is being
     * occluded by anything in the scene, which for a readout that must always be legible is
     * not a loss.
     */
    setTunnelCount(tunnelId: number, n: number): void {
        let badge = this.tunnelBadges.get(tunnelId);
        if (!badge) {
            const holder = roundedSprite(`tunnel-${tunnelId}`, 64, 64, TUNNEL_BADGE_BG, 16);
            this.canvas.addChild(holder);
            const label = makeLabel(holder, 'count', 34, 0);
            badge = { holder, label };
            this.tunnelBadges.set(tunnelId, badge);
        }
        badge.label.string = String(n);
        badge.holder.active = n > 0;
    }

    /** Put a tunnel's badge at a point already converted into UI space. */
    placeTunnelBadge(tunnelId: number, ui: Vec3): void {
        this.tunnelBadges.get(tunnelId)?.holder.setPosition(ui);
    }
```

牌子的底色写在 `hud-view.ts` 里,`const TUNNEL_BADGE_BG = new Color(92, 168, 250);` —— 参考图那块蓝方块的调子。不进 `colors.ts`:那份调色板是按 core 的颜色**字符串**索引的,而隧道在 core 里没有颜色。

- [ ] **Step 2: `buildBoard` 里建隧道**

`TUNNEL_SHELL` / `TUNNEL_MOUTH` 从 `./tunnel-mesh` import,`TUNNEL_BOX` 从 `../core/index` import。在 `gridView.render()` **之后**(这样隧道画在洞口车之后、层级关系确定),对 `core.lot.tunnels` 逐条:

```ts
        const layout = this.layout!;   // assigned earlier in buildBoard, like gridView
        for (const t of this.core.lot.tunnels) {
            const len = TUNNEL_BOX.len * layout.scale;
            const wid = TUNNEL_BOX.wid * layout.scale;
            const node = buildTunnel(`tunnel-${t.id}`, len, wid, TUNNEL_SHELL, TUNNEL_MOUTH);
            node.setPosition(layout.toWorld(t.x, t.y));
            node.setRotationFromEuler(0, 0, t.angle);
            this.gridRoot!.addChild(node);
            this.tunnelNodes.set(t.id, node);
            this.hud?.setTunnelCount(t.id, this.core.lot.remainingIn(t.id));
        }
```

字段:`private tunnelNodes = new Map<number, Node>();`,在 `buildBoard` 开头清空它(和其它每关重建的表一起)。

- [ ] **Step 3: `update` 里跟着摆位**

`update` 里 `this.placeSpeedButton();` 旁边加一行 `this.placeTunnelBadges();`:

```ts
    /** Tunnel counts hang off board points, so they move with the framing like the speed button. */
    private placeTunnelBadges(): void {
        if (!this.cam || !this.uiCam || !this.gridRoot || !this.hud || !this.core) return;
        for (const t of this.core.lot.tunnels) {
            const node = this.tunnelNodes.get(t.id);
            if (!node) continue;
            const world = node.worldPosition;
            const screen = this.cam.worldToScreen(world, new Vec3());
            this.hud.placeTunnelBadge(t.id, this.uiCam.screenToWorld(screen, new Vec3()));
        }
    }
```

- [ ] **Step 4: 补位动画**

`handleTap` 里 `this.playDriveToSlot(id, angle, res.slotIndex);` 之后加一行 `this.syncTunnels();`:

```ts
    /**
     * Bring every tunnel's view back in line with core: redraw the count, and slide out any
     * mouth car core has already put on the board but the lot has not drawn yet.
     *
     * Idempotent, and deliberately so -- it is called after every successful tap and does
     * nothing for the tunnels that tap did not touch. The alternative was working out which
     * tunnel the departing car came from, which means the view keeping its own copy of a
     * mapping core already has.
     *
     * The slide starts at the same moment the departing car pulls away, not after it. `busy`
     * is already holding taps off for the drive, and a mouth that stays visibly empty for a
     * second and a half reads as the tunnel having jammed.
     */
    private syncTunnels(): void {
        if (!this.core || !this.gridView) return;
        for (const t of this.core.lot.tunnels) {
            this.hud?.setTunnelCount(t.id, this.core.lot.remainingIn(t.id));
            const mouth = this.core.lot.mouthCarId(t.id);
            if (mouth === null || this.gridView.getCarNode(mouth)) continue;
            const node = this.gridView.addCar(mouth);
            if (!node) continue;
            const to = node.position.clone();
            // Start inside the tunnel and slide out to where core says the car stands.
            const from = this.tunnelNodes.get(t.id)?.position ?? to;
            node.setPosition(from);
            tween(node)
                .to(EMERGE_TIME / this.speed, { position: to }, { easing: 'quadOut' })
                .call(() => this.gridView?.activateCar(mouth))
                .start();
        }
    }
```

`EMERGE_TIME` 和别的动画常量放一起,值 0.28 秒 —— 比开车短得多,在 `busy` 放开之前就结束。

- [ ] **Step 5: 类型检查**

Run: `cd logic && npm run typecheck:view`
Expected: PASS

- [ ] **Step 6: 真机预览验一遍**

Run: `cd logic && npm run preview`

在第 4 关看四件事:
1. 隧道画在参考图那个位置感觉上对不对(拱的高矮、洞口的深浅);
2. 数字显示 **4**,点一次洞口车之后变 **3**;
3. 补位的车是**滑出来**的,不是瞬移;
4. 滑出过程中点它没有反应,滑完之后可以点。

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/view/GameController.ts game/assets/scripts/view/hud-view.ts
git commit -m "feat(view): the tunnel on the board, its count, and the next car sliding out"
```

---

## Task 10: 调试叠加层画出隧道的盒子

**Files:**
- Modify: `game/assets/scripts/view/debug-overlay.ts`
- Modify: `game/assets/scripts/view/GameController.ts:1721`(`toggleDebugOverlay` 的调用点)
- Test: 无

**Interfaces:**
- Consumes: `tunnelBox`(Task 1)、`firstBlocker` 的 `blockers` 参数(Task 1)
- Produces: `buildFootprintOverlay(cars, lot, layout, tunnels?)` 多收一个 `TunnelSpec[]`

- [ ] **Step 1: 改 `debug-overlay.ts`**

顶部加一个颜色,和「能出/被挡」区分开:

```ts
/** A static blocker: not a car, cannot be tapped, never leaves. */
const STATIC = new Color(255, 190, 40, 255);
```

签名和函数体:

```ts
export function buildFootprintOverlay(
    cars: CarSpec[], lot: Lot, layout: BoardLayout, tunnels: TunnelSpec[] = [],
): Node {
    const root = new Node('DebugFootprints');
    // Exactly what core is handed, so the bars report core's own verdict rather than a
    // second opinion computed here -- including, now, what the tunnels block.
    const blockers = tunnels.map(tunnelBox);
    for (const car of cars) {
        // ...
        const block = firstBlocker(car, cars, lot, blockers);
        // ...(其余不动)
    }
    // The tunnel bodies themselves, in a third colour. Without these the board has a region
    // core is reasoning about and the overlay says nothing at all -- and this overlay is the
    // project's one way to tell a view bug from a core one.
    for (const t of tunnels) {
        const b = tunnelBox(t);
        const n = makeMerged(
            `fp-tunnel-${t.id}`,
            outlineParts(b.len * layout.scale, b.wid * layout.scale),
            STATIC,
        );
        const p = layout.toWorld(b.x, b.y);
        n.setPosition(p.x, p.y, OVERLAY_Z);
        n.setRotationFromEuler(0, 0, b.angle);
        root.addChild(n);
    }
    return root;
}
```

- [ ] **Step 2: 调用点带上隧道**

`GameController.toggleDebugOverlay` 里那次 `buildFootprintOverlay(...)` 调用加第四个参数:

```ts
            this.debugOverlay = buildFootprintOverlay(
                Array.from(this.core.lot.cars.values()),
                this.core.lot.bounds,
                this.layout,
                this.core.lot.tunnels,
            );
```

- [ ] **Step 3: 类型检查**

Run: `cd logic && npm run typecheck:view`
Expected: PASS

- [ ] **Step 4: 真机预览验一遍**

Run: `cd logic && npm run preview:nobuild`

第 4 关按 **D**:隧道本体应该有一个橙色的框,洞口车的框应该是**绿色**(它没被自己的隧道挡住),而任何车头对着隧道的车,粉色的车道条应该**停在橙框上**。

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/view/debug-overlay.ts game/assets/scripts/view/GameController.ts
git commit -m "feat(view): the debug overlay draws what a tunnel blocks, in its own colour"
```

---

## 完工检查

全部十个 task 之后,按 spec 第五节逐条过:

```bash
cd logic && npm test                 # core 全绿,含隧道的新用例
cd logic && npm run typecheck:view   # view 全绿
cd logic && npm run gen              # 十关重生成,读一遍表
```

- 十关全部 `isSolvable`,第 4 关起每关带隧道,每关总车数 60。
- 真机第 4 关:隧道显示 4,点四次掏空,数字逐次递减,补位动画不瞬移。
- 按 D:隧道有橙框,洞口车绿框,朝隧道开的车的车道条停在橙框上。
- `editor/` 能打开带 `tunnels` 字段的关卡不崩(**只验不崩,编辑隧道本轮不做**)。若崩了,单开一个 fixup commit 让它忽略这个字段。
