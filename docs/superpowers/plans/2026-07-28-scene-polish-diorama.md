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

## Task C: 候车厅赛道(蜿蜒轨道 + 密集彩色小球串)—— 对齐参考图

> 设计改版:原"转盘"改为参考图的**环形赛道 + 密集小球串**(用户 2026-07-28 拍板)。乘客用抽象彩色小球(能表现大数量),沿带白边的椭圆/stadium 赛道平滑流动,底部为上车口。

**Files:**
- Create: `game/assets/scripts/view/track-view.ts`
- Modify: `game/assets/scripts/view/GameController.ts`(用 TrackView 替换 loop-view 接线)
- Delete/retire: `game/assets/scripts/view/loop-view.ts`(被取代)

**Interfaces:**
- Produces:`track-view.ts` `class TrackView { constructor(parent, capacity, y); update(ring: (string|null)[]): void; nearestVisibleWorldPos(color): Vec3 | null }`——与 LoopView 同签名,便于替换。
- Consumes:`colorOf`、`makeLitBox`(赛道白边)、`litMaterial`(小球)、`tween`。

- [ ] **Step 1: track-view.ts**

结构(首版,预览调参):
- **赛道路径**:一个 stadium/椭圆闭合路径(参数化),参数 `t∈[0,1)` → 世界局部坐标 `pathPoint(t)`。用椭圆近似即可:`x=rx*cos(θ), y=cy+ry*sin(θ)`,`θ=2π*t`,`rx≈3.4, ry≈1.5`,中心在 `y`。**上车口** = 路径最下点(最靠近停车场),对应 `t0`(使 y 最小的 t)。
- **白边**:沿路径外/内侧各铺一圈短白 box(`makeLitBox`,白色,细长,沿切线方向朝向),形成赛道两侧路肩(参考图的白色轨道边)。数量适中(如每侧 40 段)。
- **乘客小球串**:`capacity` 个 ring 槽 → 沿路径均匀分布的 `capacity` 个"槽位"(槽 i 在 `t = i/capacity`)。每个**非空**槽渲染一个**小球簇**(如 3~4 个小 `sphere`,半径 ~0.12,该色,紧挨成一小团),读作密集乘客;空槽不显示。
- **平滑流动**:维护一个相位 `phase`(0..1),每 tick 目标相位前移 `1/capacity`,用 `tween` 平滑到目标(时长≈TICK)。每帧根据 `phase` 把槽 i 的球簇放到 `pathPoint((i/capacity + phase) mod 1)`。这样球簇沿赛道平滑绕行。`update(ring)` 只更新每个槽的颜色/显隐(按 ring 内容);相位推进在内部按 tick 计数。
  - 简化保底:若相位补间不顺,退化为"每 tick 把每个球簇 tween 到下一槽位"。
- `nearestVisibleWorldPos(color)`:返回当前**最靠近上车口**(路径最下点)的该色可见球簇的世界坐标(遍历槽,按到上车口的路径距离排序取该色第一个);供飞人动画起点。
- 性能:capacity(~12)× 每簇 3~4 球 ≈ 40 球 + 白边 ~80 段,注意基元分段克制、材质走 litMaterial 缓存。

(完整首版代码由实现者按结构写出;椭圆/相位/球簇均为预览驱动微调。)

- [ ] **Step 2: GameController 接线**

`buildBoard`:`new LoopView(...)` → `new TrackView(loopRoot, level.loop.capacity, LOOP_Y)`;字段/类型改为 TrackView。`update()` 的 `this.loopView.update(ring)` 与 `playBoarding` 的 `nearestVisibleWorldPos` 调用不变(同签名)。移除 loop-view 实例化。

- [ ] **Step 3: jest 绿** → 44 PASS。

- [ ] **Step 4: Commit**
```bash
git commit -am "feat(view): M5.C waiting-hall race-track with dense passenger ball clusters"
```

**交付:** 顶部是带白边的环形赛道,彩色小球串沿轨道平滑流动,底部上车口处上车(飞人生效)。

---

## Task D: 车造型重做(挡风/车灯/侧窗 + 美化车顶箭头)—— 保留箭头

> 设计修正:参考图**保留**车顶白箭头(方向可读性招牌),原计划"去箭头"作废。本任务做**漂亮的扁平白箭头** + 更精致车身。

**Files:**
- Modify: `game/assets/scripts/view/car-builder.ts`

**Interfaces:**
- Produces:`buildCar(name, sizeX, sizeY, color, dir, cap): { root, body }` 签名不变。内部:更圆润车身 + 斜挡风玻璃 + 侧窗 + 前后车灯 + **车顶扁平白箭头指向 `dir`**。root 定位/尺寸不变(拾取不受影响)。
- Consumes:`litMaterial`/`unlitMaterial`。

- [ ] **Step 1: 重做 buildCar**

- 车身:底盘 + 略缩车厢,边角缩放更圆润;`cap` 仍区分(车厢高矮/长度/侧窗数)。
- 挡风玻璃 + 侧窗:深色/浅蓝薄 box。
- 车灯:车头两个暖白小 box(`unlitMaterial` 恒亮)在 `dir` 侧,车尾两个红色小 box。
- **车顶箭头(保留、美化)**:一个**扁平**白色箭头贴在车顶(不再是凸起白方块),用一段箭身 box + 一个三角/两段斜 box 组成箭头,平躺在车顶(法线朝相机侧),按 `dir` 旋转(up=0/left=90/down=180/right=-90)。`unlitMaterial` 恒亮白,醒目。
- 车头朝向可选跟随 `dir`(若与箭头一起显得冗余,则以箭头为主、车身对称即可)。
- 每个 MeshRenderer 设 `shadowCastingMode=ON`。
- (完整代码实现者写出,保留 cap 区分,重点是扁平箭头 + 侧窗/车灯。)

- [ ] **Step 2: jest 绿** → 44 PASS。

- [ ] **Step 3: Commit**
```bash
git commit -am "feat(view): M5.D restyle cars — flat roof arrow, windshield/side windows/headlights"
```

**交付:** 车更精致(侧窗/车灯),车顶是干净的扁平白箭头指示方向;点击拾取正常。

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
