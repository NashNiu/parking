# M3 关卡编辑器 — 设计文档

- 日期:2026-07-23
- 依赖:M1 核心逻辑(`game/assets/scripts/core`)、M2 关卡 JSON 格式
- 形态:独立网页工具(Node 服务 + 浏览器页面)
- 状态:设计已确认,待编写实现计划

## 1. 目标

做一个高效的配关工具,批量产出**守恒、可解、难度可控**的关卡 JSON,直接写入 `game/assets/resources/levels/`,游戏端即可加载。判解/难度做成 core 纯函数(可测、可复用)。

## 2. 整体架构

复用**真正的核心逻辑**,不重写,避免与游戏行为漂移。

```
core 新增(纯 TS,可单测)
└── solvability.ts   isSolvable(level) + estimateDifficulty(level)

editor/ (独立网页工具)
├── server.js        极简 Node 服务:托管页面 + 读写 game/assets/resources/levels/*.json
├── src/main.ts      编辑器 UI(DOM),import 真正的 core 做校验/试玩
└── index.html       容器;用 esbuild 打包 main.ts(直接 import ../../game/assets/scripts/core)
```

- 判解/难度是 **core 纯函数**:编辑器与(未来)程序化生成都能用,且能写 Jest 测试。
- 编辑器是 **Node 服务 + 网页**:网页不能写磁盘,故用极简 Node 服务读写仓库里的 `resources/levels/`,实现真正的库管理。
- 用 **esbuild** 把编辑器 TS 与 core 打包在一起,校验逻辑与游戏同一份代码。

**开发方式**:core 新增 = 纯 TS,子代理 + TDD;编辑器 App = 交互式(起服务、浏览器操作、截图核对)。

## 3. 判解与难度算法(core/solvability.ts)

### isSolvable(level): boolean
基于移车单调性(移走一辆车只腾格子、不新增阻挡 → "现在能开出的车永远能开出"):
1. 守恒:`validateLevel(level)` 无错误。
2. 网格可清空(贪心,完备,无需搜索):反复移走所有当前 `pathClear` 能开出的车,直到无车可动;若网格空 → 可解,若仍有车 → 死锁环 → 不可解。
- 因单调性,贪心完备;O(n²)。复用已有 `pathClear`/`footprint`。
- `unlocked ≥ 1` 即可赢(一辆一辆停、坐满再停下一辆;守恒保证每辆车终会坐满),故可解性只取决于网格能否清空,与车位数无关。

### estimateDifficulty(level): { rounds, cars, colors, blocked, score }
启发式,仅用于排难度曲线,不求精确:
- `rounds`:贪心清空网格的轮数(依赖层数);
- `cars`:车辆总数;`colors`:颜色种类数;
- `blocked`:初始被挡(第一轮开不出)的车数;
- `score`:综合分,如 `rounds*3 + blocked*2 + cars + colors`(权重可调)。

两函数配 Jest 测试:可解、死锁环、守恒失败、多轮依赖、多格车。

## 4. 编辑器 App

### Node 服务(editor/server.js)
极简无框架:
- 托管 `index.html` 与 esbuild 打包产物。
- API:
  - `GET /api/levels` → 列出 `resources/levels/*.json`(名字 + 内容)。
  - `PUT /api/levels/:name` → 保存/覆盖(服务端也跑一次校验,双保险)。
  - `DELETE /api/levels/:name` → 删除。
- 起法:`node editor/server.js`,浏览器开 `localhost:<port>`(端口固定,如 3000)。

### 界面(单页三栏)
- 左:关卡库列表 + 新建/复制/删除/排序。
- 中:编辑画布——网格(点击摆车/改朝向)、车位行(设可用/锁定)、乘客队列(彩色块);底部 [▶试玩][💾保存]。
- 右:选中车属性(颜色/尺寸/朝向)、车位 slots/unlocked、乘客队列编辑、实时校验红绿灯(守恒/可解)+ 难度分 + 错误提示。

### 核心交互
- 摆车:点格子放/删车;选中车改颜色、尺寸(小16/中24/大32)、朝向;可挪位。
- 配乘客:加"颜色×数量"段组成队列;"按车容量自动配平"一键补足守恒。
- 实时校验:每次改动即时跑 `validateLevel` + `isSolvable` + `estimateDifficulty`,右栏实时更新。
- 试玩:用当前关建 `GameCore`,画布内点车试玩(复用核心 + 轻量 2D 渲染),验证手感;可停止回编辑。
- 保存:写回 `resources/levels/`,游戏端直接加载。

### 渲染
编辑器用轻量 2D(HTML canvas 或 DOM 方块)俯视网格,编辑效率优先,不用 3D。颜色沿用同一套色值。

## 5. 里程碑
- **M3.0 core 判解/难度**:`solvability.ts` + Jest 测试全绿。
- **M3.1 编辑器骨架**:esbuild 打包 + Node 服务 + 三栏空界面 + 加载显示一关。
- **M3.2 编辑核心**:摆车/配乘客/实时校验(守恒+可解+难度)。
- **M3.3 库管理 + 保存**:列表/新建/复制/删除/排序 + 写回 resources。
- **M3.4 内置试玩**:画布内点车试玩到过关/死锁。

## 6. 验证策略
- 判解/难度:Jest 单测。
- 编辑器:交互式(起服务、浏览器操作、截图核对)。关键:改动后红绿灯/难度实时准确;保存后游戏端能加载。
- 闭环:用编辑器新建 1~2 关 → 保存 → Cocos 里加载玩通。

## 7. 非目标(YAGNI)
程序化批量生成(判解函数已铺路,未来可选)、云端关卡库、协作编辑、撤销/重做(M3 不做,留后续)。防误删靠保存前确认即可。
