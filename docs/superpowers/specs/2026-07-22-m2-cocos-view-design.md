# M2 Cocos 视图层 — 设计文档

- 日期:2026-07-22
- 引擎:Cocos Creator 3.8.7(项目在 `game/`)
- 依赖:M1 纯逻辑内核(`logic/`,已完成、测试全绿)
- 状态:设计已确认,待编写实现计划

## 1. 目标

把 M1 的纯逻辑内核接到 Cocos 画面上,用**占位图形**做出一个**能完整玩通一关**的可玩 Demo。美术、音效、道具真实逻辑、编辑器、上线配置均不在 M2。

核心原则(延续 M1):逻辑层是唯一真相,视图层只负责(a)把输入喂给 `GameCore`,(b)按 `GameCore` 的返回值/状态播动画。视图不重复实现任何规则判断。

## 2. 逻辑内核接入方式

**约束**:Cocos 只编译 `game/assets/` 下的 TS,assets 外的 `logic/src` 无法被 Cocos import。

**方案:单一数据源,核心迁入 assets**
- 将 `logic/src/*.ts` 迁移到 `game/assets/scripts/core/`,成为唯一源码,由 Cocos 编译。核心是零 `cc` 依赖的纯 TS,Jest 与 Cocos 共用同一份。
- 测试保留在 `logic/tests/`(位于 assets 外,Cocos 不编译),import 路径改指向 `game/assets/scripts/core/`。`logic/` 退化为测试壳(package.json + jest 配置 + tsconfig)。
- 效果:一份核心,Cocos 运行、Jest 测试,无双份不同步风险。

**否决备选**:保留 `logic/` 原地并在构建时拷贝到 assets —— 产生两份源码,易不同步。

**Housekeeping**:为 `game/` 添加 `.gitignore`,忽略 Cocos 生成物 `library/ temp/ local/ build/`。

## 3. M1 遗留 API 增强(M2.0 内完成)

均为附加式改动,不改变既有行为;同时补齐 M1 终审指出的测试缺口。

- `GameCore.tapCar(carId)` 返回 `{ ok: boolean; slotIndex: number }`(停入的车位下标,供停靠动画;失败时 ok=false)。
- `GameCore.stepLoop()` 返回 `BoardResult`(本 tick `boardedColor` 与 `departedCarIds`),供上车/开走动画。
- `GameCore` 的子系统字段(grid/parking/loop/boarding)及 `ParkingSystem.parked`、`LoopSystem.ring/pool` 设为 `readonly`(视图只读)。
- 补测:多格车(w>1 或 h>1)经 `GameCore` 真实过闸;中(24)/大(32)车坐满开走;锁定车位(unlocked < slots)参与的玩法/死局。

## 4. 场景结构与相机

竖屏,设计分辨率 720×1280。单一 3D 场景,严格对照参考图分区。

```
Scene
├── Main Camera (Perspective)   俯视带倾角(约 45°~55°)
├── Directional Light
├── Table (3D 世界根节点)
│   ├── LoopTrack    顶部循环轨道 + 乘客(占位小球/方块)
│   ├── ParkingArea  7 个车位(4 可用 / 3 锁),停靠的车
│   └── Grid         底部网格 + 带箭头的车(占位长方体)
└── Canvas (2D UI, 最上层)
    ├── TopHUD       关卡号、金币、完成度
    ├── BottomBar    刷新 / 硬消 / 磁铁 按钮(M2 仅占位可点)
    └── Popups       过关 / 失败 弹窗
```

- 一个透视相机拍整个桌面:顶部轨道有纵深、底部网格接近平铺。UI 走 Canvas 正交层,不受相机影响。
- 占位美术约定:车=带色长方体(尺寸按 small/medium/big 的格数),顶面贴箭头示朝向;乘客=彩色小球/方块;车位=地面方框,锁定位灰色带锁标。
- 颜色为固定枚举(red/blue/green/yellow/purple/cyan),车与乘客共用同一套色值常量。
- 坐标映射集中在 `GridLayout` 工具:逻辑网格 `(x,y)`(左上原点)→ 世界坐标,格子尺寸/间距一处配置,表现层不散落魔法数。

## 5. 视图组件与逻辑绑定

| 组件 | 绑定 | 职责 |
|------|------|------|
| `GameController` | 持有 `GameCore` | 加载关卡 JSON、每帧驱动 `stepLoop`、分发结果、管状态与弹窗 |
| `GridView` | 读 `grid` | 生成车节点、收点击 → `tapCar` → 播开出/抖动 |
| `CarView` | 单辆车 | 开出、停靠、坐满开走动画 |
| `LoopView` | 读 `loop` | 乘客沿轨道循环移动、上车消失、补位 |
| `ParkingView` | 读 `parking` | 车停入、乘客计数、坐满驶离 |
| `HUD` | 读状态 | 关卡号/完成度、道具按钮、过关/失败弹窗 |

**帧循环(GameController.update)**
```
每帧:
  若 state == playing 且累计时间达到一个 tick 间隔:
    res = core.stepLoop()
    若 res.boardedColor: LoopView/ParkingView 播上车动画
    若 res.departedCarIds: ParkingView 播开走动画
  轮询 core.getState():
    won → 过关弹窗;deadlock → 失败弹窗
```
- 逻辑 tick 频率可配(如每 0.15s 一 tick),与渲染帧率解耦;动画时长独立配置,保证手感。
- 输入:点击车节点 → 射线取 carId → `core.tapCar` → 按返回播动画;失败(被挡/车位满)播抖动 + 提示。

**关卡数据**:手搓关卡 JSON 放 `game/assets/resources/levels/`,运行时用 `resources.load` 读取,交 `validateLevel` 校验后建 `GameCore`。

## 6. 里程碑

- **M2.0 接线准备**:核心迁入 `game/assets/scripts/core/`,retarget Jest,补 API 增强与遗留测试。产出:测试仍全绿 + Cocos 能 import 核心。
- **M2.1 静态渲染**:`GridLayout` + `GridView` 按关卡 JSON 摆出车/车位/锁定位/乘客队列(静态)。产出:场景能看到一关布局。
- **M2.2 挪车交互**:点击 → `tapCar` → 开出/停靠动画;被挡抖动。产出:能点车、车开进车位。
- **M2.3 循环与上车**:帧循环驱动 `stepLoop`,`LoopView`/`ParkingView` 播循环、上车、坐满开走。产出:能完整玩通一关。
- **M2.4 HUD 与状态**:关卡号/完成度、道具按钮(占位)、过关/失败弹窗、手搓 2~3 关切换。产出:有头有尾的可玩 Demo。

## 7. 验证策略

- **逻辑**:M1 的 Jest 测试继续跑,是正确性地基;M2.0 的 API 增强与补测同样走 TDD。
- **视图**:每个里程碑用 Cocos 预览(浏览器/模拟器)真机运行 + 截图核对,关键交互(点车开出、坐满开走、过关)逐个肉眼验证,不以"看起来对"替代运行。
- 视图层代码尽量薄:规则在逻辑层已测,视图 bug 主要靠运行观察。

## 8. 非目标(YAGNI)

M2 不做:关卡编辑器(M3)、正式 3D 美术、音效/震动、道具真实逻辑(按钮仅占位)、本地存档、微信发布与合规、性能优化。均留待 M3/M4。
