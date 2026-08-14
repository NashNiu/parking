# 乘客转盘重做(双通道候车轨道)设计文档 (M6)

> 状态:方向已口头确认(通道模型/乘客分配/密度三问已定),待用户书面审阅。
> 日期:2026-08-14
> 前置:M5(立体停车场 diorama)已完成;2026-08-14 的死局判定修复(`reachableColors`)已合入工作区。

## 目标

把顶部的**椭圆转盘**改成参考图那种**带左右候车通道的闭合轨道**:底部正中一个缺口是**乘客出口**(上车口),轨道左右各接一条**候车通道**补充乘客,左通道抽空之后右通道才开始供应,并且**只有当轨道上的空位转到入口时**,候补乘客才能进入轨道。

现在被隐藏在 `pool` 数组里的"还没上场的乘客"因此变成**看得见的队列**——玩家能提前看到接下来来的是什么颜色,也能亲眼看到轨道被某个颜色塞满(即 2026-08-14 修复的那种死局)。

## 需求(用户原话拆解)

1. 转盘做成参考图样式(圆角矩形回路,不是椭圆)。
2. 转盘下面的空位是乘客出口。
3. 左右两边的通道是补充乘客的地方。
4. 左边通道没有乘客之后,右边通道的乘客再开始进入转盘。
5. 只有在空白位置转到通道入口的时候,候补的乘客才能进入。

## 已确认的三个决策

- **两个真入口(左优先)**:轨道上有左右两个入口位置,核心 `LoopSystem` 从「单 channelIndex + 隐藏 pool」改成「双入口 + 两条队列」。
- **现有 queue 对半分**:关卡 json 一字不改。引擎展开 `queue` 后,先给轨道装满,**剩下的对半分**给左右通道。
- **密度保持 capacity=12**:只换形状,不做参考图那种铺满一圈。密度/难度调优另开任务。

## 硬约束

- 关卡数据格式、`validateLevel`、`solvability`、关卡编辑器**不动**。
- 乘客**到达顺序与今天完全一致**(见下),因此 `game-core.test.ts` 的死局用例一行不改、必须保持绿。
- 零外部素材:仍只用 Cocos 内置基元 + 代码材质。
- 保留 `BOARD_TILT=52`、固定相机、拾取流程。
- 目标微信小游戏,注意 draw call(当前第 2 关约 244)。

## 架构:改动文件

核心 `game/assets/scripts/core/`:
- `loop-system.ts` — 双队列 + 双入口(本次唯一的核心改动)。
- `game-core.ts` — 不改。它只用 `loop.reachableColors()` / `isDrained()` / `ring`,这三个接口语义不变。

视图 `game/assets/scripts/view/`:
- `track-view.ts` — 重做:圆角矩形路径、索引↔位置绑定、出口缺口、左右通道渲染、运动模型修正。
- `GameController.ts` — 把 `loop.left` / `loop.right` 一并传给 `TrackView.update()`。

测试 `logic/tests/`:
- `loop-system.test.ts` — 按新 API 重写(`pool` → `left`/`right`),新增左优先与空位放行两条规则的用例。

## 核心设计:LoopSystem 双通道

```ts
ring: (string | null)[]   // capacity 格,内容每 tick 前移一格
left: string[]            // 左通道候补队列
right: string[]           // 右通道候补队列
entryLeft: number         // 左入口的 ring 索引
entryRight: number        // 右入口的 ring 索引

step():
  ring 内容 +1 旋转
  active = left.length > 0 ? (left, entryLeft) : (right, entryRight)
  if (ring[active.entry] === null) ring[active.entry] = active.queue.shift()
```

**构造时的分配**(顺序即语义,必须照此实现):

```ts
const all = expand(queue);                 // 展开成一维颜色数组
ring = all.splice(0, capacity);            // 先装满轨道(与今天完全一致),不足处补 null
const half = Math.ceil(all.length / 2);
left = all.slice(0, half);
right = all.slice(half);
```

**入口索引**由 `boardIndex` 推出,不进关卡数据:

```
entryRight = (boardIndex - round(capacity / 4) + capacity) % capacity
entryLeft  = (boardIndex + round(capacity / 4)) % capacity
```

capacity=12、boardIndex=6 时 → 出口 6、右入口 3、左入口 9。

**同一时刻只有一个入口是活的**(左通道非空时只走左入口,右入口的空位原样转过去)。因此乘客的到达顺序恒等于 `left ++ right`,也就是今天 `pool` 的顺序——这是"46 个测试语义不变"的根据。

**受影响的两个查询:**

- `remainingCount()` = `left.length + right.length + ring 非空数`(HUD 的"剩余乘客"数字不变)。
- `reachableColors()` = `ring 内的颜色 ∪ (left ++ right) 的前 k 个`,k = ring 内空位数。与今天同集合,死局判定不退化。

## 关键设计:轨道几何与索引绑定

圆角矩形闭合回路,**按弧长等距参数化** `t∈[0,1)`(现在的椭圆用等角参数化,直道弯道间距不均;换形状后必须按弧长算才整齐)。流向为顺时针,`t` 递增。

| 位置 | t | ring 索引(capacity=12) |
|---|---|---|
| 底部正中 = 出口缺口 | 0.50 | `boardIndex` = 6 |
| 右侧中点 = 右入口 | 0.25 | 3 |
| 左侧中点 = 左入口 | 0.75 | 9 |

**ring 索引 i 恒定画在 t = i/capacity**,phase 只做 tick 之间的补间。这是出口缺口能钉死在屏幕一点的前提。

## 关键设计:运动模型修正(必须做)

现状是**双倍步进**:`step()` 把 ring 内容 +1,`TrackView.update()` 又把 phase +1/capacity。实测(capacity=4):

```
t0:    A 在 0.000
tick1: A 跳到 0.250 -> 滑到 0.500
tick2: A 跳到 0.750 -> 滑到 0.000
```

即每 tick 瞬移一格再滑一格,共两格。今天看不出来是因为乘客团长得一样、上车口也没画出来。

修正:每次 `update()` 先把 `phaseHolder.p -= 1/capacity`(抵消索引位移)再补间回目标,净效果是每 tick 恰好平滑前进一格。

顺带修掉视图 `T_BOARD = 0.75` 与数据 `boardIndex = 6`(t=0.5)对不上的老问题——上车时飞出的乘客终于从缺口起飞。

## 关键设计:出口与左右通道

- **出口缺口**:外圈路沿在 t=0.5 处断开一段,正对下方停车位。上车逻辑不改,只是 `nearestVisibleWorldPos` 的起点变成真正的缺口位置。
- **通道**:轨道左右各接一条直通道,朝入口方向排 **4 个**候车乘客团(平台半宽 6、轨道半宽约 3.75,每侧余量约 2.25,按 0.5 间距正好 4 个;实现时按预览校准)。只画队首若干,后面的隐藏——第 2 关 128 人不可能全画。
- **前滑动画**:有人进轨道时,该通道整条队列 tween 前滑一格,队尾补上下一个颜色。**纯表现,不进核心。**
- **非活动通道**画成灰暗/半透明,让"左边先走"这条规则一眼看得见。

## 开销预算

当前第 2 关 244 draw call。新增:2 条通道路沿 + 最多 8 个候车团(每侧 4)+ 缺口装饰。乘客团复用已合并的共享 `CLUSTER_MESH`(每团 1 个 draw call),预计 **+12 左右**。预览里核对帧率;若超预算,先降通道可见数量。

## 测试策略

核心按 TDD 推进,每条规则先写红灯用例:

1. 构造:`ring` 取前 capacity,剩余对半分进 `left`/`right`。
2. 左通道非空时,只有左入口补位;转到右入口的空位保持空。
3. 左通道抽空后,右入口开始补位。
4. 空位不在入口位置时不补(转到入口才放行)。
5. `remainingCount()` = left + right + ring。
6. `reachableColors()` 跨 left→right 边界仍正确。

`game-core.test.ts` 的两个死局用例与其余 44 个测试**不改且必须绿**。视图层无单测,验收 = jest 全绿 + 用户预览截图。

## 非目标(YAGNI)

- 不提密度(capacity 仍 12),不改两关现有数据。
- 不做 `refresh` 道具(轨道被塞满时的解围手段),另议。
- 不做通道的多格传送带模型(乘客在通道里逐格挪),通道前滑只是补间。
- 不改上车规则:出口处没有同色车时乘客继续绕圈,与今天一致。

## 分阶段

- **Task A(核心)**:`loop-system.ts` 双队列 + 双入口,TDD 六条用例,全套 jest 绿。视图不动(此时轨道仍是椭圆,但补位入口位置会变——可接受的中间态)。
- **Task B(几何)**:圆角矩形路径 + 索引↔位置绑定 + 运动模型修正 + 出口缺口。预览确认流动平滑、缺口固定。
- **Task C(通道)**:左右通道渲染、前滑动画、非活动通道灰显。预览确认"左边先走"读得出来。
- **Task D(收尾)**:draw call / 帧率核对,飞人起点接到缺口,回归两关通关与死局提示。
