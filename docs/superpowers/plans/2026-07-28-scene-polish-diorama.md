# 场景美术升级(立体停车场 diorama)实现计划 (M5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 M4 的"漂浮元素"升级为统一的立体停车场场景:阴影落地、圆角平台、停车场地面、候车厅旋转转盘(乘客平滑 riding)、更可爱的车/乘客造型。

**Architecture:** 纯视图层。新增 `scene-stage.ts`(平台+地面+背景)、`turntable-view.ts`(转盘)。改动 `environment.ts`(阴影+光)、`car-builder.ts`(车重做)、`passenger-builder.ts`(乘客重做)、`parking-view.ts`(嵌入)、`GameController.ts`(接线)。核心 `core/` 不动。

**Tech Stack:** Cocos 3.8.7、内置 primitives、builtin-standard/unlit、tween;阴影用 `scene.globals.shadows` + `DirectionalLight.shadowEnabled` + MeshRenderer cast/receive。

## Global Constraints

- `game/assets/scripts/core/` 与 `logic/` 一行不改;每任务结束 `cd logic && npx jest` 必须 44 绿。
- 零外部素材:仅内置基元 + 代码材质。
- 保留 `BOARD_TILT=52`、相机 pos(0,5,12) lookAt(0,-0.3,0)、射线→gridRoot 局部→`pickCar` 流程。重做车造型**只改 car root 内部子节点,不改 root 的 position/footprint**,确保拾取不受影响。
- 视图层无单元测试;每任务验收 = jest 绿 + 用户 Cocos 预览截图确认。视图代码无法在 subagent 里编译/渲染——实现者不得声称已渲染验证。
- 已验证 API:`builtin-standard` 颜色属性名 `mainColor`;`litMaterial(color)`/`unlitMaterial(color)`(materials.ts,自愈到 unlit);`setEmissive` 只作用于 builtin-standard;primitives:`box({width,height,length})`、`cylinder(rt,rb,h,opts)`、`sphere(r,opts)`、`capsule(rt,rb,h,opts)`、`torus(r,tube,opts)`;`tween(t).to(dur,props,{onUpdate:(target,ratio)=>{}})` ratio 0→1;`Math.random()` 运行时可用。
- 阴影 API(引擎源码已核实):`scene.globals.shadows`:`enabled:boolean`、`type`(`ShadowType.Planar=0`/`ShadowType.ShadowMap=1`,从 `cc` 导入)、`shadowMapSize`、`maxReceived`、`planeDirection`、`planeHeight`。`DirectionalLight`:`shadowEnabled`、`shadowDistance`、`shadowPcf`、`shadowBias`。MeshRenderer 投/收影:`shadowCastingMode = MeshRenderer.ShadowCastingMode.ON`、`receiveShadow = MeshRenderer.ShadowReceivingMode.ON`(实现者核对枚举名)。

## 视图工作说明(同 M4)

每任务"测试"= ① `cd logic && npx jest` 证明核心未破坏(44 绿)② 实现者对照引擎源码自审 API ③ 用户预览截图确认交付描述。视觉尺寸/颜色/位置是**预览驱动微调**:实现者写出结构正确、API 正确的首版,由用户截图后我们再调参。实现者不要声称已渲染。

---

## Task A: 阴影 + 光照 + 背景

**Files:**
- Modify: `game/assets/scripts/view/environment.ts`
- Create: `game/assets/scripts/view/scene-stage.ts`(本任务先放背景;平台/地面在 Task B)
- Modify: `game/assets/scripts/view/GameController.ts`(buildBoard 里调用 stage 背景;给车/人/地面设投收影——投影设置可在各 builder 里做,见下)
- Modify: `game/assets/scripts/view/car-builder.ts` / `passenger-builder.ts`(其 MeshRenderer 设 `shadowCastingMode=ON`)

**Interfaces:**
- Produces:`environment.ts` 导出 `setupEnvironment(root)` 保持;内部新增阴影开启(ShadowMap 首选)。新增 `scene-stage.ts` 导出 `setupBackground(root): void`(天空色板 + 云 + 暗角)。
- Consumes:`makeLitBox`、`litMaterial`。

- [ ] **Step 1: environment.ts 开阴影 + 调光**

在 `setupEnvironment` 的 KeyLight 幂等块内:
```ts
import { ..., ShadowType, DirectionalLight, Color, Vec3, director } from 'cc';
// 灯:更强主光 + 明确角度
dl.illuminance = 150000;
dl.color = new Color(255, 248, 230);
dl.shadowEnabled = true;
dl.shadowDistance = 40;
dl.shadowPcf = 2; // soft
lightNode.setRotationFromEuler(-55, -35, 0);
// 场景阴影(ShadowMap)
const g = scene.globals;
if (g && g.shadows) {
    g.shadows.enabled = true;
    g.shadows.type = ShadowType.ShadowMap;
    g.shadows.shadowMapSize = 2048;
    g.shadows.maxReceived = 4;
}
// ambient 保持较低对比(M4 已调),微调更暖
```

- [ ] **Step 2: 投影/收影助手**

在 car-builder/passenger-builder 的每个 MeshRenderer 创建后设 `mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;`(实现者核对枚举:Cocos 3.8.7 `MeshRenderer.ShadowCastingMode.ON`)。地面/平台(Task B 的 makeLitBox)设 `mr.receiveShadow = MeshRenderer.ShadowReceivingMode.ON;`——本任务可先给现有 environment 的 Floor 设收影,验证出影。

- [ ] **Step 3: 背景 scene-stage.ts**

```ts
import { Node, Color } from 'cc';
import { makeLitBox } from './placeholder';
/** Warm sky backdrop + a few soft cloud slabs + subtle darker vignette frame. */
export function setupBackground(root: Node): void {
    const sky = makeLitBox('Sky', 40, 26, 0.4, new Color(255, 226, 190));
    sky.setPosition(0, 5, -7);
    root.addChild(sky);
    // clouds: rounded light slabs
    for (const [x, y, s] of [[-6, 8, 1.6], [5, 9, 2.0], [8, 5, 1.3]] as const) {
        const c = makeLitBox('cloud', 2.4 * s, 0.9 * s, 0.3, new Color(255, 252, 248));
        c.setPosition(x, y, -6.4);
        root.addChild(c);
    }
}
```

- [ ] **Step 4: GameController 接背景**

`buildBoard` 里 `setupEnvironment(this.boardRoot)` 之后调用 `setupBackground(this.boardRoot)`(import from scene-stage)。移除 environment.ts 里旧的 BackFar/BackNear slab(交给 scene-stage;保留 Floor 直到 Task B,或本任务先留)。

- [ ] **Step 5: jest 绿** → `cd logic && npx jest` → 44 PASS。

- [ ] **Step 6: Commit**

```bash
git add game/assets/scripts/view/environment.ts game/assets/scripts/view/scene-stage.ts \
  game/assets/scripts/view/GameController.ts game/assets/scripts/view/car-builder.ts \
  game/assets/scripts/view/passenger-builder.ts
git commit -m "feat(view): M5.A shadows + stronger lighting + sky/cloud background"
```

**交付(用户截图确认):** 车/人在地面投下阴影(有落地感);光更通透;背景有天空色+云。
**若 ShadowMap 不出影(Builtin 管线不兼容):** 走兜底——见 Task A-fallback。用户截图反馈"没有阴影"时,实现者/控制器改走假阴影:每辆车/每个乘客挂一片贴地深色椭圆(`makeLitBox` 扁圆或 `cylinder` 扁片,深灰色,略高于地面),随物体移动。控制器据预览结果决定。

---

## Task B: 圆角平台 + 停车场地面 + 车道线

**Files:**
- Modify: `game/assets/scripts/view/scene-stage.ts`(加 `setupStage(root)`:平台托盘 + 停车场地面 + 车道线)
- Modify: `game/assets/scripts/view/environment.ts`(移除旧 Floor,由 stage 提供)
- Modify: `game/assets/scripts/view/GameController.ts`(buildBoard 调 setupStage;网格区地面尺寸按 level.grid 尺寸)

**Interfaces:**
- Produces:`scene-stage.ts` 新增 `setupStage(root, gridCols, gridRows, gridY): void`——一块圆角平台(大扁 box,收影),网格区一块深色停车场地面(带浅色车道分隔线),嵌在平台上。
- Consumes:`makeLitBox`、`litMaterial`、GridLayout 的尺寸约定(step=cell+gap=1.12)。

- [ ] **Step 1: setupStage**

平台:大扁 box(收影),暖中性色。停车场地面:深灰 box 覆盖网格区(尺寸 = cols*1.12 × rows*1.12,居中于 gridY),`receiveShadow=ON`。车道线:沿列/行的浅色细长 box。完整首版代码:
```ts
import { Node, Color, Vec3, MeshRenderer } from 'cc';
import { makeLitBox } from './placeholder';

export function setupStage(root: Node, cols: number, rows: number, gridY: number): void {
    const step = 1.12;
    // Rounded-ish platform tray under everything (thin big box, receives shadow).
    const platform = makeLitBox('Platform', 12, 15, 0.5, new Color(247, 238, 222));
    platform.setPosition(0, 0, -0.35);
    const pmr = platform.getComponent(MeshRenderer);
    if (pmr) pmr.receiveShadow = MeshRenderer.ShadowReceivingMode.ON;
    root.addChild(platform);

    // Parking-lot ground under the grid cars.
    const lotW = cols * step, lotH = rows * step;
    const lot = makeLitBox('Lot', lotW + 0.3, lotH + 0.3, 0.12, new Color(84, 90, 104));
    lot.setPosition(0, gridY, 0.02);
    const lmr = lot.getComponent(MeshRenderer);
    if (lmr) lmr.receiveShadow = MeshRenderer.ShadowReceivingMode.ON;
    root.addChild(lot);

    // Lane separator lines (light dashed feel via thin boxes between columns).
    const line = new Color(210, 214, 224);
    for (let c = 1; c < cols; c++) {
        const x = c * step - lotW / 2;
        const s = makeLitBox('lane', 0.04, lotH, 0.14, line);
        s.setPosition(x, gridY, 0.06);
        root.addChild(s);
    }
}
```

- [ ] **Step 2: environment.ts 去掉旧 Floor**(stage 已提供平台)。

- [ ] **Step 3: GameController** 在 buildBoard 里、建 gridRoot 前调用 `setupStage(this.boardRoot, level.grid.cols, level.grid.rows, GRID_Y)`(GRID_Y=-3.2,与现有一致)。

- [ ] **Step 4: jest 绿** → 44 PASS。

- [ ] **Step 5: Commit**
```bash
git commit -am "feat(view): M5.B rounded platform + parking-lot ground + lane lines"
```

**交付:** 所有元素落在一块圆角平台上,网格车坐在带车道线的停车场地面里,不再漂浮。

---

## Task C: 候车厅转盘(乘客平滑 riding)

**Files:**
- Create: `game/assets/scripts/view/turntable-view.ts`
- Modify: `game/assets/scripts/view/GameController.ts`(用 turntable 替换 loop-view 接线;飞人起点用转盘车站世界坐标)
- Delete/retire: `game/assets/scripts/view/loop-view.ts`(被取代;若保留则不再实例化)

**Interfaces:**
- Produces:`turntable-view.ts` `class TurntableView { constructor(parent, capacity, y); update(ring: (string|null)[]): void; nearestVisibleWorldPos(color): Vec3 | null }`——与 LoopView 同签名,便于替换。内部:装饰圆台 + `capacity` 个固定车站(圆周,车站 0 在最下=最靠近停车场);乘客节点每 tick 用补间平滑前移一站。
- Consumes:`buildPassenger`/`recolorPassenger`、`colorOf`、`makeLitBox`(圆台)。

- [ ] **Step 1: turntable-view.ts**

机制(首版,预览调参):
- 构造:一块装饰圆台(扁 cylinder,半径 rx≈3.4)在 y;`capacity` 个车站角度 `ang(i)=Math.PI/2 + (i/capacity)*2π`(车站 0 在底部,靠停车场);车站世界/局部坐标 `pos(i)=(rx*cos, ry-ish*sin)`(沿用椭圆 rx=3.3 ry=1.4 保持透视一致)。
- 维护 `capacity` 个乘客节点(池),`node[i]` 表示车站 i 的当前乘客。`update(ring)`:对每个 i,若 `ring[i]` 有色则显示并 `recolorPassenger`,否则隐藏;**平滑**:记录上一次 ring,若内容整体前移一位,用 `tween` 让每个乘客节点从"上一车站位置"补间到"当前车站位置"(时长≈0.12s TICK)。首版可先实现"每 tick tween node[i] 到 pos(i)"的软过渡;若视觉不顺,再改为按内容流动。
- `nearestVisibleWorldPos(color)`:遍历车站,返回第一个该色可见乘客的 `worldPosition.clone()`(车站 0 优先——即最靠近上车口)。
- 圆台可缓慢自转(纯装饰):在一个 update 里 `disc.setRotationFromEuler(0,0, t)` 递增——但注意板已倾斜,自转轴用局部 Z;若视觉怪则去掉自转,仅靠乘客补间体现"转"。

(完整首版代码由实现者按上述结构写出,复用 loop-view 的椭圆布局常量与 update 显隐逻辑;补间部分是新增。)

- [ ] **Step 2: GameController 接线**

`buildBoard`:把 `new LoopView(...)` 换成 `new TurntableView(loopRoot, level.loop.capacity, LOOP_Y)`;`this.loopView` 字段类型改为 TurntableView(或保留名字)。`update()` 里 `this.loopView.update(ring)` 不变。`playBoarding` 里 `nearestVisibleWorldPos` 调用不变(同签名)。

- [ ] **Step 3: jest 绿** → 44 PASS。

- [ ] **Step 4: Commit**
```bash
git commit -am "feat(view): M5.C waiting-hall turntable with smoothly riding passengers"
```

**交付:** 顶部是一个会转的候车厅圆台,乘客坐着平滑转圈,转到底部上车口时上车(飞人仍生效)。

---

## Task D: 车造型重做(挡风/车灯/朝向,去箭头)

**Files:**
- Modify: `game/assets/scripts/view/car-builder.ts`

**Interfaces:**
- Produces:`buildCar(name, sizeX, sizeY, color, dir, cap): { root, body }` 签名不变。内部重做:更圆润车身 + 斜挡风玻璃 + 前后车灯 + **车头朝向 `dir`**;去掉车顶白箭头。root 的定位/尺寸不变。
- Consumes:`litMaterial`/`unlitMaterial`。

- [ ] **Step 1: 重做 buildCar**

- 车身:底盘 + 略缩车厢,边角用额外小 box/缩放做出更圆润观感。
- 挡风玻璃:车头上方一块斜置深色玻璃(`setRotationFromEuler` 前倾)。
- 车灯:车头两个亮色小 box(`unlitMaterial` 暖白/黄,恒亮)在 `dir` 侧;车尾两个红色小 box。
- **朝向**:根据 `dir` 把"车头"朝向 dir(up/down/left/right)。实现:车身默认车头朝 +Y(up),按 dir 对 body 内部整体 `setRotationFromEuler(0,0,angle)`(up=0,left=90,down=180,right=-90)——注意 body 旋转不改 root footprint,拾取不受影响。宽车(w>h)与高车(h>w)朝向后视觉比例要对(实现者用 sizeX/sizeY 组织,旋转后长边沿行驶方向)。
- 每个 MeshRenderer 设 `shadowCastingMode=ON`(Task A 起沿用)。
- 三种 cap 仍有区分(车厢高矮/车窗数)。
- (完整代码由实现者写出,保留 Task 2 的 cap 区分逻辑,替换箭头为朝向+车灯。)

- [ ] **Step 2: jest 绿** → 44 PASS。

- [ ] **Step 3: Commit**
```bash
git commit -am "feat(view): M5.D restyle cars — windshield/headlights, front faces exit dir, drop roof arrow"
```

**交付:** 车更圆润可爱,车头朝行驶方向、有车灯,无车顶箭头;点击拾取正常。

---

## Task E: 乘客造型重做(更可爱)

**Files:**
- Modify: `game/assets/scripts/view/passenger-builder.ts`

**Interfaces:**
- Produces:`buildPassenger(name,color)`/`recolorPassenger` 签名不变;造型更可爱(更圆的身体比例、可选小手臂/圆脚、头身比更 Q)。
- Consumes:`litMaterial`。

- [ ] **Step 1: 重做 buildPassenger**

- 更 Q 的头身比:大圆头(sphere)+ 矮胖身(capsule 或缩短)。可加两个小球做手/脚提示。肤色头保留,身体染 color。
- 每 MeshRenderer 设 `shadowCastingMode=ON`。
- `recolorPassenger` 仍只染身体。
- (完整代码实现者写出。)

- [ ] **Step 2: jest 绿** → 44 PASS。

- [ ] **Step 3: Commit**
```bash
git commit -am "feat(view): M5.E cuter passenger figures"
```

**交付:** 转盘上是更可爱的小人。

---

## Task F: 车位嵌入停车场 + 构图收尾

**Files:**
- Modify: `game/assets/scripts/view/parking-view.ts`
- Modify: `game/assets/scripts/view/GameController.ts`(必要时微调 LOOP_Y/PARKING_Y/GRID_Y 间距、相机)

**Interfaces:**
- Produces:`parking-view.ts` `render()`/`getSlotPosition` 签名不变;车位与停车场出口视觉衔接(车位底板嵌入平台、和 lot 对齐),解锁/锁定造型收尾。
- Consumes:同 Task 4。

- [ ] **Step 1: 车位嵌入 + 衔接**

车位排布在 lot 上边缘(出口)一线,底板与平台色调协调、边缘更精致;锁定位锁造型保留微调。必要时把 PARKING_Y 往 lot 靠拢,使"车从 lot 开进车位"的路径连贯。

- [ ] **Step 2: 构图/间距/相机微调**

按整体观感微调 LOOP_Y(转盘)/PARKING_Y(车位)/GRID_Y(停车场)三段间距,减少空白;必要时轻调相机 lookAt/pos(**若动相机,需与 handleTap 的射线拾取一致——相机改动后仍走同一 `screenPointToRay`,不影响逻辑**)。

- [ ] **Step 3: jest 绿** → 44 PASS。

- [ ] **Step 4: Commit**
```bash
git commit -am "feat(view): M5.F embed parking stalls into the lot + composition polish"
```

**交付:** 车位融入停车场、整体构图紧凑统一,一个完整的立体停车场场景。

---

## Self-Review 记录

- **Spec 覆盖:** A→F 对应 spec 六阶段;阴影(A+兜底)、平台/地面(B)、转盘(C)、车(D)、乘客(E)、车位嵌入+收尾(F)。硬约束(核心不动/零素材/拾取不变/平台守卫)贯穿。
- **占位符扫描:** 视觉尺寸/颜色为预览驱动微调(已在说明中声明);API 名给出且已核实(阴影/primitives/tween)。转盘与车重做的完整代码由实现者按给定结构写首版——这是 view 层惯例(M4 同样迭代)。
- **类型一致:** TurntableView 与 LoopView 同签名(update/nearestVisibleWorldPos)便于替换;buildCar/buildPassenger 签名不变。
- **风险:** ①阴影管线兼容(A 优先验证+假阴影兜底)②转盘平滑同步(补间时长匹配 TICK,预览调)③车朝向旋转不得影响 root/footprint(拾取)④性能(增面/draw call,材质缓存复用、基元分段克制)。
- **延后项(非本计划):** 真实星级规则;M4 记录的其余 cosmetic minor。
