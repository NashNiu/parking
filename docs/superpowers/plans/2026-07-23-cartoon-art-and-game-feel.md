# 卡通美术 + 手感升级 实现计划 (M4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把占位方块升级为明亮卡通风的车/乘客/场景,并加入操作反馈、上车/发车演出、音效+震动、胜利/失败演出——全部由代码生成,零外部素材。

**Architecture:** 纯视图层改造。新增 `materials/car-builder/passenger-builder/environment/effects/sfx/haptics` 模块与 `tools/gen-sfx.js`;改动现有 `grid-view/loop-view/parking-view/hud-view/colors/GameController`。核心逻辑 `core/` 一行不改。

**Tech Stack:** Cocos Creator 3.8.7 (TypeScript, `cc` 模块)、内置 `primitives`、`builtin-standard`/`builtin-unlit` 材质、`AudioSource`/`AudioClip`、Node(WAV 合成脚本)。

## Global Constraints

- 核心 `game/assets/scripts/core/` 一行不改;`logic/tests/` 44 个测试每个任务结束必须全绿(`cd logic && npx jest`)。
- 零外部素材:仅用 Cocos 内置基元 + 代码材质 + 代码合成的 WAV。
- 风格:明亮卡通/休闲——鲜艳饱和、圆润、柔和光照、暖色渐变背景。
- 保留布局与交互:`BOARD_TILT=52`、相机 pos (0,5,12) lookAt (0,-0.3,0)、射线→板平面→gridRoot 局部→`pickCar` 流程不变。
- 平台安全:`wx.*` 必须带守卫(`typeof wx !== 'undefined'`),非微信环境静默。
- `builtin-standard` 颜色 uniform 是 `albedo`(Color,0–255,引擎自动归一化),另有 `metallic`/`roughness`/`emissive`;`builtin-unlit` 颜色 uniform 是 `mainColor`。实现者若在预览中发现 uniform 名不符,以 3.8.7 实际为准并在报告中记录。
- 视图层无单元测试(沿用现有约定);每个任务的验收 = jest 绿 + 用户在 Cocos 预览截图确认。

## 关于"测试"的说明(重要)

本计划改的是 Cocos 运行时渲染代码,**无法在 subagent 环境里编译或渲染**(`cc` 模块只有 Cocos 编辑器构建时才解析)。因此每个任务的"测试"步骤统一为:

1. `cd logic && npx jest` —— 证明核心未被破坏(必须 44 绿)。
2. 实现者对照本计划的 Cocos API 事实做自审(uniform 名、primitive 签名、节点父子关系、无节点泄漏)。
3. 提交后由**用户**在 Cocos 预览截图确认视觉/手感符合该任务"交付"描述。

实现者**不要**声称"已在 Cocos 中验证渲染"——你无法运行 Cocos。只报告 jest 结果 + 代码自审。

---

## Task 1: 渲染基础 — 材质工厂 + 环境(灯光/地面/背景)

**Files:**
- Create: `game/assets/scripts/view/materials.ts`
- Create: `game/assets/scripts/view/environment.ts`
- Modify: `game/assets/scripts/view/placeholder.ts`(改用材质工厂;`makeBox` 保持 unlit,新增 `makeLitBox`)
- Modify: `game/assets/scripts/view/GameController.ts`(`buildBoard` 里加环境;背景色/相机保留)

**Interfaces:**
- Produces:
  - `materials.ts`: `litMaterial(color: Color): Material`(缓存,`builtin-standard`,`roughness≈0.85`,`metallic=0`)、`unlitMaterial(color: Color): Material`、`setLitColor(node: Node, color: Color): void`、`setEmissive(node: Node, color: Color): void`(设 `builtin-standard` 的 `emissive`;unlit 节点则退化为 `mainColor` 提亮)。
  - `placeholder.ts`: 保留 `makeBox`(unlit)、新增 `makeLitBox(name,w,h,d,color): Node`(用 `litMaterial`);`setBoxColor` 保持不变。
  - `environment.ts`: `setupEnvironment(sceneRootForLights: Node): void`(建方向光 + 提升环境光 + 圆润地面 + 背景装饰;地面/装饰作为 `sceneRootForLights` 的子节点,灯光加到场景)。
- Consumes:`colors.ts` 的 `colorOf`(装饰用色)。

- [ ] **Step 1: 写 `materials.ts`**

```ts
import { Node, MeshRenderer, Material, Color } from 'cc';

const litCache = new Map<string, Material>();

function key(c: Color): string {
    return `${c.r},${c.g},${c.b}`;
}

/** Cartoon-ish lit material (builtin-standard, matte with a faint sheen). Cached per color. */
export function litMaterial(color: Color): Material {
    const k = key(color);
    const hit = litCache.get(k);
    if (hit) return hit;
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-standard' });
    mat.setProperty('albedo', color);
    mat.setProperty('roughness', 0.85);
    mat.setProperty('metallic', 0.0);
    litCache.set(k, mat);
    return mat;
}

/** Unlit solid color (for UI-ish bits that must stay bright regardless of lighting). */
export function unlitMaterial(color: Color): Material {
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-unlit' });
    mat.setProperty('mainColor', color);
    return mat;
}

/** Recolor a lit node (its material is shared from cache, so give it a fresh instance first). */
export function setLitColor(node: Node, color: Color): void {
    const mr = node.getComponent(MeshRenderer);
    if (!mr) return;
    mr.material = litMaterial(color);
}

/** Set emissive glow on a lit node; falls back to brightening mainColor on unlit nodes. */
export function setEmissive(node: Node, color: Color): void {
    const mr = node.getComponent(MeshRenderer);
    if (!mr || !mr.material) return;
    const mat = mr.material;
    // builtin-standard exposes 'emissive'; builtin-unlit does not — guard by trying standard first.
    try {
        mat.setProperty('emissive', color);
    } catch {
        mat.setProperty('mainColor', color);
    }
}
```

- [ ] **Step 2: 写 `environment.ts`**

```ts
import { Node, DirectionalLight, Vec3, Color, director } from 'cc';
import { makeLitBox } from './placeholder';

/**
 * Adds cartoon lighting + a soft stage floor + warm background decor.
 * Lights are attached to the scene; floor/decor become children of `root`.
 */
export function setupEnvironment(root: Node): void {
    // Key directional light, angled from upper-front for soft cartoon shading.
    const lightNode = new Node('KeyLight');
    const dl = lightNode.addComponent(DirectionalLight);
    dl.illuminance = 80000;
    dl.color = new Color(255, 250, 235);
    lightNode.setRotationFromEuler(-50, -30, 0);
    director.getScene()!.addChild(lightNode);

    // Lift ambient so shadows read as soft, not black (warm sky / warm ground bounce).
    const globals = director.getScene()!.globals;
    if (globals && globals.ambient) {
        globals.ambient.skyColor = new Color(180, 200, 235, 255) as unknown as any;
        globals.ambient.groundAlbedo = new Color(150, 130, 110, 255) as unknown as any;
    }

    // Soft rounded stage floor sitting behind/under the board.
    const floor = makeLitBox('Floor', 16, 10, 0.4, new Color(250, 236, 210));
    floor.setPosition(0, -0.5, -2.2);
    root.addChild(floor);

    // A couple of far background slabs for depth (warm gradient feel, no textures).
    const back1 = makeLitBox('BackFar', 30, 18, 0.4, new Color(255, 214, 170));
    back1.setPosition(0, 4, -6);
    root.addChild(back1);
    const back2 = makeLitBox('BackNear', 26, 14, 0.4, new Color(255, 232, 196));
    back2.setPosition(0, 2, -4.5);
    root.addChild(back2);
}
```

- [ ] **Step 3: 改 `placeholder.ts` 用材质工厂 + 新增 `makeLitBox`**

在 `placeholder.ts` 顶部 `import { litMaterial, unlitMaterial } from './materials';`,把 `makeBox` 内联建材质改为 `mr.material = unlitMaterial(color);`,并新增:

```ts
export function makeLitBox(name: string, w: number, h: number, d: number, color: Color): Node {
    const node = new Node(name);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: w, height: h, length: d }));
    mr.material = litMaterial(color);
    return node;
}
```
(保留 `makeBox`/`makeCar`/`setBoxColor` 现有签名不变,`Material` import 若不再直接用可移除。)

- [ ] **Step 4: 改 `GameController.buildBoard` 加环境**

在 `buildBoard` 开头(建 `boardRoot` 后)调用:
```ts
import { setupEnvironment } from './environment';
// ...
this.boardRoot = new Node('Board');
this.boardRoot.setRotationFromEuler(-this.BOARD_TILT, 0, 0);
this.node.addChild(this.boardRoot);
setupEnvironment(this.boardRoot);
```
并把 `setupCamera` 的 `clearColor` 从灰蓝改为暖色 `new Color(255, 224, 186, 255)`,让背板与清屏色协调。

- [ ] **Step 5: jest 绿**

Run: `cd logic && npx jest`
Expected: 11 suites / 44 tests PASS(核心未动)。

- [ ] **Step 6: Commit**

```bash
git add game/assets/scripts/view/materials.ts game/assets/scripts/view/environment.ts \
  game/assets/scripts/view/placeholder.ts game/assets/scripts/view/GameController.ts
git commit -m "feat(view): M4.A cartoon lighting + materials + stage environment"
```

**交付(用户截图确认):** 场景有方向光明暗与暖色背景/地面;原有方块变成有光照的实体(不再是平涂灰块)。

---

## Task 2: 车 — 组合式卡通车

**Files:**
- Create: `game/assets/scripts/view/car-builder.ts`
- Modify: `game/assets/scripts/view/grid-view.ts`(改用 `buildCar`)
- Modify: `game/assets/scripts/view/colors.ts`(更鲜艳饱和)

**Interfaces:**
- Consumes:`materials.ts`(`litMaterial`/`unlitMaterial`)、`placeholder.Dir`。
- Produces:`car-builder.ts`: `buildCar(name, sizeX, sizeY, color, dir, cap): { root: Node; body: Node }`,其中 `cap: 'small'|'medium'|'big'`。`root` 用于定位/移动;`body` 用于 squash/flash(Task 5)。`grid-view` 需保存 `body` 句柄以备后用(存在 `CarEntry` 里)。

- [ ] **Step 1: 写 `car-builder.ts`**

用基元拼车:底盘(扁 box)+ 车厢(略窄 box,顶部)+ 4 轮(cylinder,横放)+ 车窗(深色薄 box)+ 车顶方向箭头(亮色 box,复用现有箭头朝向逻辑)。按 `sizeX/sizeY` 缩放,`cap` 影响车厢高度与车窗数(small=1 窗矮厢,medium=2 窗,big=3 窗高厢)。完整代码:

```ts
import { Node, Vec3, Color, MeshRenderer, utils, primitives } from 'cc';
import { litMaterial, unlitMaterial } from './materials';
import { Dir } from './placeholder';

export type Cap = 'small' | 'medium' | 'big';

function litBox(name: string, w: number, h: number, d: number, color: Color): Node {
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: w, height: h, length: d }));
    mr.material = litMaterial(color);
    return n;
}

function wheel(name: string, r: number, color: Color): Node {
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    // cylinder axis is Y by default; rotate so it lies like a wheel (axis along X).
    mr.mesh = utils.createMesh(primitives.cylinder(r, r, r * 0.5, { radialSegments: 16 }));
    mr.material = litMaterial(color);
    n.setRotationFromEuler(0, 0, 90);
    return n;
}

/** Build a cartoon car sized to its footprint. Returns root (move this) and body (animate this). */
export function buildCar(
    name: string, sizeX: number, sizeY: number, color: Color, dir: Dir, cap: Cap,
): { root: Node; body: Node } {
    const root = new Node(name);
    const depth = 0.55;
    const dark = new Color(40, 44, 52);
    const glass = new Color(150, 205, 235);

    // Body = chassis + cabin. Cabin height/window count vary by capacity.
    const body = new Node('body');
    root.addChild(body);
    const chassis = litBox('chassis', sizeX * 0.92, sizeY * 0.62, depth, color);
    chassis.setPosition(0, -sizeY * 0.12, 0);
    body.addChild(chassis);
    const cabinH = cap === 'small' ? 0.34 : cap === 'medium' ? 0.42 : 0.5;
    const cabin = litBox('cabin', sizeX * 0.7, sizeY * cabinH, depth * 0.9, color);
    cabin.setPosition(0, sizeY * 0.22, 0);
    body.addChild(cabin);

    // Windows on the cabin front face.
    const winCount = cap === 'small' ? 1 : cap === 'medium' ? 2 : 3;
    const winW = (sizeX * 0.6) / winCount;
    for (let i = 0; i < winCount; i++) {
        const win = litBox(`win${i}`, winW * 0.8, sizeY * cabinH * 0.6, 0.06, glass);
        const startX = -((winCount - 1) * winW) / 2;
        win.setPosition(startX + i * winW, sizeY * 0.22, depth * 0.46);
        body.addChild(win);
    }

    // Four wheels near the corners (slightly below the chassis, in front of the body plane).
    const wr = Math.min(sizeX, sizeY) * 0.16;
    const wx = sizeX * 0.34, wy = -sizeY * 0.3, wz = depth * 0.35;
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
        const w = wheel('wheel', wr, dark);
        w.setPosition(sx * wx, sy < 0 ? wy : wy, sy > 0 ? wz : -wz);
        body.addChild(w);
    }

    // Roof direction arrow (bright, unlit so it always pops), reusing dir orientation.
    const arrow = new Node('arrow');
    const amr = arrow.addComponent(MeshRenderer);
    amr.mesh = utils.createMesh(primitives.box({ width: 0.16, height: 0.5, length: 0.12 }));
    amr.material = unlitMaterial(new Color(255, 255, 255));
    const off = 0.3 * Math.min(sizeX, sizeY);
    const z = depth / 2 + 0.12;
    switch (dir) {
        case 'up': arrow.setPosition(0, off, z); arrow.setRotationFromEuler(0, 0, 0); break;
        case 'down': arrow.setPosition(0, -off, z); arrow.setRotationFromEuler(0, 0, 180); break;
        case 'left': arrow.setPosition(-off, 0, z); arrow.setRotationFromEuler(0, 0, 90); break;
        case 'right': arrow.setPosition(off, 0, z); arrow.setRotationFromEuler(0, 0, -90); break;
    }
    body.addChild(arrow);

    return { root, body };
}
```

- [ ] **Step 2: 改 `grid-view.ts` 用 `buildCar`**

`CarEntry` 增加 `body: Node`。`render()` 里把 `makeCar(...)` 换成:
```ts
import { buildCar, Cap } from './car-builder';
// ...
const { root, body } = buildCar(`car-${id}`, size.x, size.y, colorOf(car.color), car.dir as Dir, car.cap as Cap);
root.setPosition(this.layout.cellCenter(car.x, car.y, car.w, car.h));
this.parent.addChild(root);
this.carNodes.set(id, root);
this.entries.push({ id, node: root, body, hw: size.x / 2, hh: size.y / 2 });
```
新增 getter `getCarBody(id: number): Node | undefined`(供 Task 5 用)。`pickCar`/`detachCar`/`removeCar` 逻辑不变(仍按 root 的 position 命中)。`car.cap` 来自 `GridSystem` 的车数据——确认 `grid.cars` 的 value 带 `cap` 字段(核心 `CarSpec` 有 `cap`)。

- [ ] **Step 3: 改 `colors.ts` 更鲜艳**

```ts
export const COLORS: Record<string, Color> = {
    red: new Color(244, 67, 72),
    blue: new Color(58, 134, 255),
    green: new Color(76, 205, 106),
    yellow: new Color(255, 205, 60),
    purple: new Color(178, 102, 232),
    cyan: new Color(64, 208, 216),
};
```

- [ ] **Step 4: jest 绿**

Run: `cd logic && npx jest` → 44 PASS。

- [ ] **Step 5: Commit**

```bash
git add game/assets/scripts/view/car-builder.ts game/assets/scripts/view/grid-view.ts game/assets/scripts/view/colors.ts
git commit -m "feat(view): M4.B cartoon composed cars (body/cabin/wheels/windows) by capacity"
```

**交付:** 网格里是圆润卡通车,有车窗/轮子/车顶箭头;大/中/小车外观可区分。

---

## Task 3: 乘客 + 环形轨道

**Files:**
- Create: `game/assets/scripts/view/passenger-builder.ts`
- Modify: `game/assets/scripts/view/loop-view.ts`

**Interfaces:**
- Produces:`passenger-builder.ts`: `buildPassenger(name, color): Node`(头球 + 身体胶囊,染色);`recolorPassenger(node, color): void`。
- Consumes:`materials.litMaterial`/`setLitColor`。

- [ ] **Step 1: 写 `passenger-builder.ts`**

```ts
import { Node, Color, MeshRenderer, utils, primitives } from 'cc';
import { litMaterial } from './materials';

/** A tiny person silhouette: capsule body + sphere head, tinted to `color`. */
export function buildPassenger(name: string, color: Color): Node {
    const root = new Node(name);
    const body = new Node('body');
    const bmr = body.addComponent(MeshRenderer);
    bmr.mesh = utils.createMesh(primitives.capsule(0.14, 0.14, 0.36, { sides: 12 }));
    bmr.material = litMaterial(color);
    body.setPosition(0, 0, 0);
    root.addChild(body);

    const head = new Node('head');
    const hmr = head.addComponent(MeshRenderer);
    hmr.mesh = utils.createMesh(primitives.sphere(0.13, { segments: 12 }));
    hmr.material = litMaterial(new Color(255, 224, 189)); // skin-ish head
    head.setPosition(0, 0.32, 0);
    root.addChild(head);

    return root;
}

/** Retint a passenger's body (head stays skin-colored). */
export function recolorPassenger(node: Node, color: Color): void {
    const body = node.getChildByName('body');
    if (!body) return;
    const mr = body.getComponent(MeshRenderer);
    if (mr) mr.material = litMaterial(color);
}
```
(`primitives.capsule` 签名以 3.8.7 为准:`capsule(radiusTop, radiusBottom, height, opts?)`;若参数不符,实现者据实调整并记录。)

- [ ] **Step 2: 改 `loop-view.ts` 用小人**

保留椭圆布局(`rx=3.3 ry=1.4`)与 `update(ring)` 显隐/染色逻辑,把 `makeBox` 换成 `buildPassenger`,`setBoxColor` 换成 `recolorPassenger`:
```ts
import { buildPassenger, recolorPassenger } from './passenger-builder';
// 构造循环内:
const pax = buildPassenger(`pax-${i}`, Color.WHITE.clone());
pax.setPosition(px, py, 0);
pax.active = false;
parent.addChild(pax);
this.dots.push(pax);
// update 内:active=true 时 recolorPassenger(this.dots[i], colorOf(c));
```

- [ ] **Step 3: jest 绿** → `cd logic && npx jest` → 44 PASS。

- [ ] **Step 4: Commit**

```bash
git add game/assets/scripts/view/passenger-builder.ts game/assets/scripts/view/loop-view.ts
git commit -m "feat(view): M4.C passenger figures on the loop track"
```

**交付:** 环形轨道上是走动的彩色小人(头+身),循环/补位视觉不变。

---

## Task 4: 环境细化 — 停车位框 + 锁定位

**Files:**
- Modify: `game/assets/scripts/view/parking-view.ts`

**Interfaces:**
- Consumes:`placeholder.makeLitBox`、`materials`。
- Produces:`parking-view.ts` 保持 `render()`/`getSlotPosition(index)` 签名不变。

- [ ] **Step 1: 升级 `parking-view.ts`**

解锁位:浅色车位底板 + 四角/边框线(用细 litBox 拼框)。锁定位:深色底板 + 一个锁造型(小 box 锁体 + 半环 torus 锁梁,或两根竖 box 近似铁链)。完整代码:

```ts
import { Node, Color, Vec3, MeshRenderer, utils, primitives } from 'cc';
import { makeLitBox } from './placeholder';
import { litMaterial } from './materials';

export class ParkingView {
    private positions: Vec3[] = [];
    constructor(
        private parent: Node,
        private slots: number,
        private unlocked: number,
        private y: number,
    ) {}

    render(): void {
        const gap = 1.15;
        const startX = -((this.slots - 1) * gap) / 2;
        for (let i = 0; i < this.slots; i++) {
            const locked = i >= this.unlocked;
            const pos = new Vec3(startX + i * gap, this.y, 0);
            const pad = makeLitBox(
                `slot-${i}`, 0.98, 0.98, 0.14,
                locked ? new Color(96, 100, 116) : new Color(236, 238, 244),
            );
            pad.setPosition(pos);
            this.parent.addChild(pad);

            if (locked) {
                // Lock body + shackle over the pad.
                const body = makeLitBox('lockbody', 0.34, 0.28, 0.16, new Color(60, 64, 78));
                body.setPosition(pos.x, pos.y - 0.02, 0.2);
                this.parent.addChild(body);
                const sh = new Node('shackle');
                const smr = sh.addComponent(MeshRenderer);
                smr.mesh = utils.createMesh(primitives.torus(0.12, 0.03, { radialSegments: 12, tubularSegments: 8 }));
                smr.material = litMaterial(new Color(180, 184, 196));
                sh.setPosition(pos.x, pos.y + 0.2, 0.2);
                sh.setRotationFromEuler(90, 0, 0);
                this.parent.addChild(sh);
            } else {
                // Four thin border strips to read as a painted stall.
                const line = new Color(120, 170, 240);
                const t = 0.06, L = 0.98;
                for (const [dx, dy, w, h] of [
                    [0, L / 2, L, t], [0, -L / 2, L, t], [-L / 2, 0, t, L], [L / 2, 0, t, L],
                ] as const) {
                    const s = makeLitBox('edge', w, h, 0.16, line);
                    s.setPosition(pos.x + dx, pos.y + dy, 0.09);
                    this.parent.addChild(s);
                }
            }
            this.positions.push(pos);
        }
    }

    getSlotPosition(index: number): Vec3 {
        return this.positions[index].clone();
    }
}
```
(`primitives.torus(radius, tube, opts?)` 签名以 3.8.7 为准。)

- [ ] **Step 2: jest 绿** → 44 PASS。

- [ ] **Step 3: Commit**

```bash
git add game/assets/scripts/view/parking-view.ts
git commit -m "feat(view): M4.D painted parking stalls + locked-slot lock art"
```

**交付:** 解锁车位有车位框线,锁定车位有锁造型,一眼可辨。

---

## Task 5: 手感 · 操作反馈(effects + 接线)

**Files:**
- Create: `game/assets/scripts/view/effects.ts`
- Modify: `game/assets/scripts/view/GameController.ts`

**Interfaces:**
- Produces:`effects.ts`:
  - `squash(body: Node): void`(点击弹性:快速压扁再回弹,用 scale tween)。
  - `overshoot(node: Node, target: Vec3, dur: number, onDone?: () => void): void`(入库到位小回弹)。
  - `flash(node: Node, color?: Color): void`(emissive 红闪脉冲,用 `setEmissive` 上色再退回黑)。
  - `dustBurst(parent: Node, at: Vec3): void`(起步尘土:几粒小球淡出上飘,自动销毁;受全局 `MAX_PARTICLES` 限制)。
- Consumes:`materials.setEmissive`、`materials.litMaterial`/`unlitMaterial`、`grid-view.getCarBody`。

- [ ] **Step 1: 写 `effects.ts`**

```ts
import { Node, Vec3, Color, tween, MeshRenderer, utils, primitives } from 'cc';
import { unlitMaterial, setEmissive } from './materials';

let activeParticles = 0;
const MAX_PARTICLES = 80;

/** Tap feedback: quick squash then spring back. */
export function squash(body: Node): void {
    const s = body.scale.clone();
    tween(body)
        .to(0.06, { scale: new Vec3(s.x * 1.15, s.y * 0.8, s.z) })
        .to(0.12, { scale: s }, { easing: 'backOut' })
        .start();
}

/** Move to target with a slight overshoot landing. */
export function overshoot(node: Node, target: Vec3, dur: number, onDone?: () => void): void {
    tween(node)
        .to(dur, { position: target }, { easing: 'backOut' })
        .call(() => onDone && onDone())
        .start();
}

/** Red emissive pulse (used when a car can't exit). */
export function flash(node: Node, color: Color = new Color(255, 60, 60)): void {
    setEmissive(node, color);
    tween({ t: 1 })
        .to(0.3, { t: 0 }, {
            onUpdate: (_, r) => {
                const k = r as number;
                setEmissive(node, new Color(color.r * k, color.g * k, color.b * k));
            },
        })
        .call(() => setEmissive(node, new Color(0, 0, 0)))
        .start();
}

function spawnParticle(parent: Node, at: Vec3, color: Color, size: number): Node | null {
    if (activeParticles >= MAX_PARTICLES) return null;
    activeParticles++;
    const n = new Node('fx');
    const mr = n.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.sphere(size, { segments: 8 }));
    mr.material = unlitMaterial(color);
    n.setPosition(at);
    parent.addChild(n);
    return n;
}

function killParticle(n: Node): void {
    activeParticles--;
    n.destroy();
}

/** A small puff of dust that drifts up and fades (scales to zero) then self-destructs. */
export function dustBurst(parent: Node, at: Vec3): void {
    for (let i = 0; i < 5; i++) {
        const p = spawnParticle(parent, at, new Color(210, 200, 180), 0.12);
        if (!p) break;
        const dx = (i - 2) * 0.12;
        tween(p)
            .to(0.5, { position: new Vec3(at.x + dx, at.y + 0.5, at.z), scale: new Vec3(0.01, 0.01, 0.01) })
            .call(() => killParticle(p))
            .start();
    }
}

/** Rising stars burst (used on depart / win). */
export function stars(parent: Node, at: Vec3, colors: Color[]): void {
    for (let i = 0; i < 8; i++) {
        const c = colors[i % colors.length];
        const p = spawnParticle(parent, at, c, 0.14);
        if (!p) break;
        const ang = (i / 8) * Math.PI * 2;
        const tx = at.x + Math.cos(ang) * 1.2;
        const ty = at.y + 0.8 + Math.sin(ang) * 0.6;
        tween(p)
            .to(0.6, { position: new Vec3(tx, ty, at.z), scale: new Vec3(0.01, 0.01, 0.01) })
            .call(() => killParticle(p))
            .start();
    }
}
```
(`tween(...).to(dur, props, { onUpdate })` 的 `onUpdate(target, ratio)` 签名以 3.8.7 为准;若 ratio 不可得,实现者改用一个插值对象 `{t}` 并读 `target.t`。)

- [ ] **Step 2: 接线 `GameController.handleTap`**

- tap 命中车后、调用 `tapCar` 前:`const body = this.gridView.getCarBody(id); if (body) squash(body);`
- `res.ok` 分支:进入 `playDriveToSlot`(下一步改造)。
- `else`(开不出):在 `playShake` 内对车身 `flash(body)`(保留现有位移抖动)。

- [ ] **Step 3: 改造 `playDriveToSlot` 加加速缓动 + 尘土**

把两段 `tween` 改为:起步 `dustBurst(this.boardRoot!, node.worldPosition在boardRoot局部的位置)`(用 `node.position.clone()` 作近似 at),行驶段用 `easing: 'quadIn'`(加速感),入库用 `overshoot`(或保留 `.to` 带 `backOut`)。到位回调逻辑(attachFillBar/label/parked.set)不变。

- [ ] **Step 4: jest 绿** → 44 PASS。

- [ ] **Step 5: Commit**

```bash
git add game/assets/scripts/view/effects.ts game/assets/scripts/view/GameController.ts
git commit -m "feat(view): M4.E tap squash / drive dust+accel / park overshoot / cant-exit flash"
```

**交付:** 点车弹一下;开出加速+起尘;入库回弹;开不出去红闪+抖动。

---

## Task 6: 手感 · 上车 / 发车演出

**Files:**
- Modify: `game/assets/scripts/view/GameController.ts`
- Modify: `game/assets/scripts/view/loop-view.ts`(暴露"某色最近上车口的可见点世界坐标"辅助)

**Interfaces:**
- Consumes:`BoardResult { boardedColor, departedCarIds }`(已有,不改核心)、`effects.stars`、`parked` map(车节点/座位)。
- Produces:`loop-view.ts` 新增 `nearestVisibleWorldPos(color: string): Vec3 | null`(返回该色某可见点的世界坐标,取 index 最小者近似"最靠上车口")。

- [ ] **Step 1: `loop-view.ts` 暴露源点**

记录每个 dot 当前颜色(在 `update` 时存 `this.ringColors = ring.slice()`),新增:
```ts
nearestVisibleWorldPos(color: string): Vec3 | null {
    for (let i = 0; i < this.dots.length; i++) {
        if (this.ringColors[i] === color && this.dots[i].active) {
            return this.dots[i].worldPosition.clone();
        }
    }
    return null;
}
```

- [ ] **Step 2: `GameController.update` 处理上车弧线**

在 `stepLoop()` 得到 `res` 后,若 `res.boardedColor`:找到该色**已停的车**(遍历 `this.parked`,用 `this.core.parking.parked[slot].color === boardedColor` 匹配),取 `loopView.nearestVisibleWorldPos(boardedColor)` 作起点,生成一个临时 `buildPassenger` 节点(挂 boardRoot,setWorldPosition 起点),用**贝塞尔弧线**(中点抬高)tween 到车的世界位置,到达后销毁并对该车 `座位数跳动`(seat label 一次放大回弹)。若找不到起点/车则跳过动画(纯降级,不影响数值)。贝塞尔用 `tween({t:0}).to(0.4,{t:1},{onUpdate})` 手动求 `(1-t)²P0 + 2(1-t)t C + t²P1`。

- [ ] **Step 3: 车满高亮 + 发车星星**

- `updateFillBars` 里当 `filled === capacity` 时对该车 body 做一次 `flash(body, 绿色)` 高亮(加个 `highlighted` 集合防重复触发)。
- `onDeparted`:飞出前在车世界位置 `stars(this.boardRoot!, 局部位置, [多色])`,再执行现有飞出销毁。

- [ ] **Step 4: jest 绿** → 44 PASS。

- [ ] **Step 5: Commit**

```bash
git add game/assets/scripts/view/GameController.ts game/assets/scripts/view/loop-view.ts
git commit -m "feat(view): M4.F boarding arc + seat bump + full-car highlight + depart stars"
```

**交付:** 上车时小人沿弧线飞向对应车、座位数跳动;车满高亮;发车迸发星星。

---

## Task 7: 音效 + 震动

**Files:**
- Create: `tools/gen-sfx.js`
- Create(脚本产物): `game/assets/resources/audio/{tap,drive,park,board,depart,win,lose}.wav`
- Create: `game/assets/scripts/view/sfx.ts`
- Create: `game/assets/scripts/view/haptics.ts`
- Modify: `game/assets/scripts/view/GameController.ts`(全触发点接线)

**Interfaces:**
- Produces:
  - `sfx.ts`: `class SfxManager { constructor(host: Node); play(name: SfxName, vol?: number): void }`,`type SfxName = 'tap'|'drive'|'park'|'board'|'depart'|'win'|'lose'`;内部对每个名字 `resources.load('audio/'+name, AudioClip)` 缓存,用挂在 host 上的 `AudioSource` `playOneShot`;未加载好/缺文件则静默。
  - `haptics.ts`: `vibrate(kind?: 'light'|'medium'|'heavy'): void`(守卫 `wx`)。
- Consumes:无(独立)。

- [ ] **Step 1: 写 `tools/gen-sfx.js`(纯 Node,合成 WAV)**

写一个最小 WAV(PCM 16-bit 单声道 22050Hz)编码器,合成 7 段短音:tap=短高 blip;drive=上滑;park=柔和"叮";board=清脆双音;depart=上扬三连;win=大调琶音;lose=下滑低音。完整代码:

```js
// Synthesize simple arcade SFX as WAV files — zero external assets.
const fs = require('fs');
const path = require('path');

const RATE = 22050;
const OUT = path.resolve(__dirname, '..', 'game', 'assets', 'resources', 'audio');

function encodeWav(samples) {
    const n = samples.length;
    const buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
    }
    return buf;
}

// tone: freq(t)->hz, dur seconds, envelope decay, optional wave type
function tone(freqFn, dur, { decay = 6, wave = 'sine', vol = 0.6 } = {}) {
    const n = Math.floor(RATE * dur);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const f = typeof freqFn === 'function' ? freqFn(t / dur) : freqFn;
        phase += (2 * Math.PI * f) / RATE;
        let v = wave === 'square' ? (Math.sin(phase) >= 0 ? 1 : -1) : Math.sin(phase);
        out[i] = v * vol * Math.exp(-decay * t);
    }
    return out;
}

function concat(...arrs) {
    const n = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(n);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
}

const sfx = {
    tap: tone(880, 0.08, { decay: 20, wave: 'square', vol: 0.4 }),
    drive: tone((p) => 300 + p * 500, 0.25, { decay: 5 }),
    park: tone(660, 0.18, { decay: 8 }),
    board: concat(tone(784, 0.06, { decay: 18 }), tone(1046, 0.08, { decay: 14 })),
    depart: concat(tone(523, 0.07, { decay: 12 }), tone(659, 0.07, { decay: 12 }), tone(784, 0.12, { decay: 8 })),
    win: concat(tone(523, 0.1, { decay: 6 }), tone(659, 0.1, { decay: 6 }), tone(784, 0.1, { decay: 6 }), tone(1046, 0.25, { decay: 4 })),
    lose: tone((p) => 440 - p * 240, 0.4, { decay: 4, wave: 'square', vol: 0.4 }),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, samples] of Object.entries(sfx)) {
    fs.writeFileSync(path.join(OUT, `${name}.wav`), encodeWav(samples));
    console.log('wrote', name + '.wav');
}
```

- [ ] **Step 2: 运行脚本生成 WAV**

Run: `node tools/gen-sfx.js`
Expected: 打印 7 行 `wrote *.wav`,`game/assets/resources/audio/` 下出现 7 个 wav。

- [ ] **Step 3: 写 `haptics.ts`**

```ts
declare const wx: any;

/** Short vibration on WeChat; silently no-op elsewhere (browser/editor preview). */
export function vibrate(kind: 'light' | 'medium' | 'heavy' = 'light'): void {
    try {
        if (typeof wx !== 'undefined' && wx.vibrateShort) {
            wx.vibrateShort({ type: kind });
        }
    } catch { /* ignore */ }
}
```

- [ ] **Step 4: 写 `sfx.ts`**

```ts
import { Node, AudioSource, AudioClip, resources } from 'cc';

export type SfxName = 'tap' | 'drive' | 'park' | 'board' | 'depart' | 'win' | 'lose';
const NAMES: SfxName[] = ['tap', 'drive', 'park', 'board', 'depart', 'win', 'lose'];

/** Loads code-generated WAVs from resources/audio and plays them as one-shots. Silent if a clip is missing. */
export class SfxManager {
    private src: AudioSource;
    private clips = new Map<SfxName, AudioClip>();

    constructor(host: Node) {
        this.src = host.addComponent(AudioSource);
        for (const name of NAMES) {
            resources.load(`audio/${name}`, AudioClip, (err, clip) => {
                if (!err && clip) this.clips.set(name, clip);
            });
        }
    }

    play(name: SfxName, vol = 1): void {
        const clip = this.clips.get(name);
        if (clip) this.src.playOneShot(clip, vol);
    }
}
```

- [ ] **Step 5: 接线 `GameController`**

`start()` 里 `this.sfx = new SfxManager(this.node);`。触发点:
- tap 命中 → `sfx.play('tap'); vibrate('light')`
- 开出 → `sfx.play('drive')`
- 入库到位 → `sfx.play('park')`
- 上车(res.boardedColor)→ `sfx.play('board')`
- 发车(onDeparted)→ `sfx.play('depart'); vibrate('medium')`
- 开不出去 → `vibrate('medium')`(可选加一个错误音,先复用无或 lose 低音的轻量版——本任务不新增音,复用现有 7 个)
- 胜利 → `sfx.play('win')`;失败 → `sfx.play('lose')`(在 `onEnd` 里按 state)

- [ ] **Step 6: jest 绿** → 44 PASS。

- [ ] **Step 7: Commit**

```bash
git add tools/gen-sfx.js game/assets/resources/audio game/assets/scripts/view/sfx.ts \
  game/assets/scripts/view/haptics.ts game/assets/scripts/view/GameController.ts
git commit -m "feat(view): M4.G synthesized SFX + WeChat haptics wired to all actions"
```

**交付:** 各操作有音效;微信端点击/发车有震动。(注:用户需在 Cocos 编辑器刷新一次以导入新 WAV → 生成 .meta,`resources.load` 才能找到。此步在交付说明里提示用户。)

---

## Task 8: 胜利 / 失败演出

**Files:**
- Modify: `game/assets/scripts/view/effects.ts`(新增 `confetti`)
- Modify: `game/assets/scripts/view/hud-view.ts`(过关面板 + 星级)
- Modify: `game/assets/scripts/view/GameController.ts`(`onEnd` 演出 + 失败死局高亮)

**Interfaces:**
- Produces:
  - `effects.confetti(parent: Node, at: Vec3): void`(彩色四边形/小方块带重力下落 + 旋转,自动销毁,受 MAX_PARTICLES 限制)。
  - `hud-view.ts`: `showWin(stars: number): void`(过关面板 + 1–3 星动画)、`showLose(): void`;保留 `hideBanner`。
- Consumes:`effects.stars/confetti`、`materials`。

- [ ] **Step 1: `effects.confetti`**

在 `effects.ts` 新增:生成 ~16 个彩色小 box,从 `at` 上方散开、带随机横向速度与重力下落 + 缩小,`tween` 结束销毁;复用 `activeParticles`/`MAX_PARTICLES`。颜色取鲜艳数组。

- [ ] **Step 2: `hud-view.ts` 过关面板 + 星级**

`showWin(stars)`:显示"过关!"大字 + 一排 3 个星 Label(★/☆),按 `stars` 数量逐个弹出(缩放回弹动画,用 tween on node scale via UITransform 节点)。`showLose()`:显示"卡住了 点击重试"。保留 `bannerLabel` 复用或新增子节点。星级规则先用占位:`stars = 3`(后续按剩余道具/步数细化,记为 deferred)。

- [ ] **Step 3: `GameController.onEnd` 演出**

```ts
private onEnd(state: string): void {
    this.ended = true;
    if (state === 'won') {
        confetti(this.boardRoot!, new Vec3(0, 1, 0));
        stars(this.boardRoot!, new Vec3(0, 1, 0), [/*鲜艳色*/]);
        this.sfx?.play('win');
        this.hud?.showWin(3);
    } else {
        // deadlock: highlight the stuck grid cars.
        for (const [id] of this.core!.grid.cars) {
            const body = this.gridView?.getCarBody(id);
            if (body) flash(body, new Color(255, 80, 80));
        }
        this.sfx?.play('lose');
        this.hud?.showLose();
    }
    console.log(`[Game] level ended: ${state}`);
}
```
`restart()` 里改调 `this.hud?.hideBanner()`(或新的隐藏方法)清理面板。

- [ ] **Step 4: jest 绿** → 44 PASS。

- [ ] **Step 5: Commit**

```bash
git add game/assets/scripts/view/effects.ts game/assets/scripts/view/hud-view.ts game/assets/scripts/view/GameController.ts
git commit -m "feat(view): M4.H win confetti + star rating + deadlock highlight"
```

**交付:** 胜利有彩带+星星+星级面板;失败死局车高亮+提示,替换纯文字 banner。

---

## Self-Review 记录

- **Spec 覆盖:** A→H 八阶段一一对应 Task 1–8;硬约束(核心不动/零素材/平台守卫/布局保留)在 Global Constraints 与各任务中体现。
- **占位符扫描:** 无 TODO/TBD;每个新文件给出完整代码,接线步骤给出具体触发点与代码片段。
- **类型一致:** `Cap` 在 car-builder 定义并被 grid-view 消费;`buildCar` 返回 `{root, body}` 与 grid-view/effects 用法一致;`SfxName`/`SfxManager` 签名跨 Task 7/8 一致;`nearestVisibleWorldPos` 在 Task 6 定义并使用。
- **已知延后项(记入 ledger,非本计划范围):** 星级评分真实规则(现占位 3 星);平滑环形位移动画;真实美术/音效替换;道具按钮与逻辑;下一关/关卡选择流程。
- **风险:** Cocos uniform 名 / primitive 签名 / tween onUpdate 签名需实现者在预览实测校正(已在相应步骤标注"以 3.8.7 为准")。
```
