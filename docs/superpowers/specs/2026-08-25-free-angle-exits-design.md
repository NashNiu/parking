# 自由角度驶出方向设计文档 (M8)

> 状态:方向已口头确认(三个决策见下),待用户书面审阅。
> 日期:2026-08-25
> 前置:M7(每关轨道形状、车辆模型替换与减面)已完成并推送到 `dev`(`c681908`)。

## 目标

停车场里的车不再只能朝**上/下/左/右**四个方向驶出。每辆车有自己的**朝向角**,车身按那个角度摆放,箭头指向那个角度,驶出时也沿那个角度走——参考图里那种放射状的乱停车场。

这要求把 core 的碰撞模型从**格子**换成**有向矩形(OBB)**。格子是四方向假设的载体,它在的时候自由角度就无从谈起。

## 需求(用户原话)

> 现在停车场的汽车,方向都是前后左右,能不能支持各种角度的驶出方向,如图所示

参考图特征:车身自由倾斜(约 20°、45°、60° 都有),车顶箭头沿车身长轴,外圈车辆偏轴向、内圈偏放射状,整体密度接近铺满。

## 已确认的三个决策

- **生成器随机撒**:沿用现在的离线生成,不做手工编排,也不做放射状模板。姿态随机,靠一个吸附常数保留少量轴向车做视觉落点。
- **保车数**:仍是 36 辆。缩放系数从 1.0 起步(见下面的密度核算),缩小只作为泄压阀。
- **拆成三个里程碑**:几何 core → 生成器 → view。每一步单独过双闸、单独提交。

### 一处更正

口头讨论时我估计过「整体缩 8~10%」。那个数算错了(把三档车等权平均,又用了 cell 而不是 pitch 做换算单位)。实测:

| 档位 | 今天画出的尺寸(板单位) | 面积 | 占比 |
|---|---|---|---|
| small | 0.964 × 0.471 | 0.454 | 0.55 |
| medium | 1.772 × 0.567 | 1.004 | 0.25 |
| big | 1.949 × 0.620 | 1.208 | 0.20 |

加权平均面积 0.742,36 辆 = **26.7**,对 54 的场地是 **49.5%**。`level-gen.ts:59` 注释里的「88% of the grid」说的是**占了多少格**,不是车身盖住多少面积;两者的差额就是之前记录成结构性限制的那圈侧向空气。自由角度把它收回来,所以缩放不是必需的。

## 硬约束

- **core 不认识 Cocos**:`core/` 下任何文件都不许 `import ... from 'cc'`,否则 jest 加载不了。几何全部是纯 TS。
- **双闸必须绿**:`cd logic && npm test` 和 `npm run typecheck:view`。
- **可解性由构造保证**:`peel` 产出的剥离顺序就是一个合法解,这条不变式在整个改动中必须活着。
- **圆环、通道、乘客、停车位一律不动**:`loop-system` / `boarding-system` / `parking-system` / `track-path` / `track-shapes` 零改动。
- 关卡是生成的不是手写的,**不需要向后兼容**;十关全部重新生成并提交 JSON。
- 目标微信小游戏。draw call 当前 749(预算 450),本次不碰这个数。

## 一、坐标系与数据模型

### 板坐标

**1 板单位 = 今天的一个格距 0.7533 世界单位**。这样 view 那边 cell→world 的缩放一行都不用改,新老关卡在同一个刻度上。

- 原点在场地中心,**+Y 朝上**(不是今天 grid 的 row 0 在顶上;view 的 `cellCenter` 现在要取负,改完就不用了)。
- 场地 `LOT = { w: 9, h: 6 }`,即 x ∈ [-4.5, 4.5],y ∈ [-3, 3]。
- 角度单位为度,**0° = +X(向右),逆时针为正**,归一化到 `[0, 360)` 后写进关卡数据。

### 类型

`game/assets/scripts/core/types.ts`:

```ts
/** 一辆车。x/y 是车身中心,angle 是它开出去的方向。 */
export interface CarSpec {
  id: number;
  x: number;
  y: number;
  /** 朝向,度。0 = +X,逆时针。车沿这个方向直线驶出场地。 */
  angle: number;
  color: string;
  cap: Cap;
}

/** 车身尺寸,板单位。 */
export interface Box { len: number; wid: number }

/** 场地范围,板单位,原点在中心。 */
export interface Lot { w: number; h: number }

/**
 * 每档车的车身长宽,板单位。数值来自三个 glb 的实测 AABB 除以格距 0.7533
 * (见 tools/check-car-models.mjs 打出的 drawn 尺寸)。
 *
 * 注意这里发生了一次**主从倒置**:今天是模型 AABB 经 `sharedCarScale` 去适配
 * 格子,尺寸是算出来的;以后 CAP_BOX 是唯一事实,view 反过来按它缩放模型。
 * 实现时不要再从模型反推 CAP_BOX,那会绕成一个圈。
 *
 * core 读不到模型,所以这是一份手抄,换模型时必须同步更新。
 * `tools/check-car-models.mjs` 增加一条校验:实测 AABB / 0.7533 与 CAP_BOX
 * 相差超过 0.02 就退出码 1。
 */
export const CAP_BOX: Record<Cap, Box> = {
  small:  { len: 0.964, wid: 0.471 },
  medium: { len: 1.772, wid: 0.567 },
  big:    { len: 1.949, wid: 0.620 },
};

/** 全局缩放,乘在 CAP_BOX 上。密度泄压阀,起步 1.0。 */
export const CAR_SCALE = 1.0;

/** 车与车之间必须留的最小间隙,板单位。见「二、间隙」。 */
export const CLEARANCE = 0.04;
```

`Dir` 类型**删除**。`CarSpec` 的 `w` / `h` / `dir` 三个字段一起消失。

`LevelData.grid` 改名:

```ts
lot: { w: number; h: number; cars: CarSpec[] };
```

`grid` 这个名字在没有格子之后是谎话,留着会误导后面读代码的人。

### 顺带解除的两个限制

这两条我之前在 README 里记录成「结构性、engineering 消不掉」,格子一走就没了:

- **车与车的侧向空隙**——成因是方形单元格里塞长条模型。现在车身就是碰撞体,没有空隙可言。
- **medium 和 big 共用 2 格 footprint、长度比被卡在 2.03**——现在两档可以是任意长度。

但要说清楚:**当前三个模型自身的长度比是 1 : 1.84 : 2.02**,阶梯本来就窄。解除限制只是让「重新做一套拉得更开的模型」变成可能,本次不做。

## 二、碰撞:扫掠 SAT

新建 `game/assets/scripts/core/geometry.ts`,纯几何,不认识 `CarSpec` 之外的任何东西。

### 间隙

只有一个常数 `CLEARANCE = 0.04` 板单位(≈ 0.03 世界单位),两处都用:

- **摆放时**:两辆车的 OBB 必须至少隔开这么多。
- **判路时**:被移动的车的 OBB 向外膨胀这么多再做扫掠。

两处用同一个值,规则才读得懂:**看着过不去的缝,就是真的过不去**。0.04 取自今天最紧的那个间隙(小车头尾 `pitch − len = 0.036` 板单位),不是平均值——用户在 M7 里反复要求收紧间隙,不能借这次改动松回去。

### API

```ts
export interface OBB { x: number; y: number; angle: number; len: number; wid: number }

/**
 * `a` 沿 `dir`(单位向量)平移时,走多远会碰到 `b`;碰不到返回 null。
 * 已经重叠时返回 0。反方向的碰撞不算。
 */
export function sweepHit(a: OBB, b: OBB, dx: number, dy: number): number | null;

/** OBB 是否整个落在以原点为中心、w × h 的矩形内。 */
export function insideRect(o: OBB, w: number, h: number): boolean;

/** 两个 OBB 的最小平移向量;不重叠返回 null。松弛用。 */
export function overlapMTV(a: OBB, b: OBB): { x: number; y: number } | null;
```

### 算法

标准 2D 扫掠分离轴测试。两个矩形一共 4 条候选轴(各自两条法线;2D 纯平移不需要叉积轴,重复轴去掉后通常是 2~4 条)。对每条轴:

1. 把两个矩形投影成区间;
2. 用相对速度在该轴上的分量,算出「这条轴上两区间重叠」的时间区间 `[enter, exit]`;
3. 分量为 0 时,若当前已分离则整体永不相交,直接返回 null。

全局 `enter = max(所有 enter)`,`exit = min(所有 exit)`。若 `enter <= exit` 且 `enter >= 0`,命中距离就是 `enter`。约 50 行,纯函数,**这是最该 TDD 的一块**。

### core 的两个入口

`move-solver.ts` 保留文件名和两个导出名,签名改掉:

```ts
/** 车能不能一路开出场地。 */
export function pathClear(car: CarSpec, others: CarSpec[], lot: Lot): boolean;

/** 挡路的第一辆车,以及碰上之前还能走多远(板单位)。 */
export function firstBlocker(car: CarSpec, cars: CarSpec[], lot: Lot): Blockage | null;
```

`Blockage.gap` 的语义从「还能走几格」变成「还能走多远,板单位」。因为 1 板单位就是今天的格距,`GameController` 里那句 `block.gap * this.gridStep + BUMP` **算出来是同一个数,原样保留**;同一个函数里要改的只有它上面那行 `DIR_VEC[car.dir]`(换成角度向量)。

`footprint()` 删除。`occupancy()`(solvability.ts)从 `Set<string>` 改成 `CarSpec[]`。

### 复杂度

36 辆车,`pathClear` 一次 O(35) 次扫掠,`clearGrid` 最坏 O(36² ) 次 `pathClear` = 4.5 万次扫掠,每次几十次浮点运算。生成器跑 200 attempts × 10 关仍在秒级。不做空间索引——**YAGNI**,测出来慢了再说。

## 三、生成器

### pack:随机撒 + 分离松弛

```
pack(rng, want):
  1. 按 CAP_MIX 抽 want 个档位,大车优先排序
  2. 每个车随机中心 + 随机角度;每辆车独立抽一次 rng,命中 SNAP_SHARE 的把
     角度吸附到最近的 90° 整数倍
  3. 松弛 RELAX_ITERS 轮:
       对每一对重叠的车(overlapMTV != null),各自沿 MTV 推开一半 + CLEARANCE/2
       每辆车夹回场地内(insideRect)
  4. 仍有重叠 → 这次 attempt 失败
```

**为什么要松弛**:纯拒绝采样在密度上来之后后段几乎全被拒——今天的 `PLACE_TRIES = 40` 在格子上够用,是因为格子天然不重叠。自由角度下,松弛是 36 辆能不能站住的分水岭,约 30 行代码。

`RELAX_ITERS = 60`,`SNAP_SHARE = 0.25`。两个都是**看效果调的常数**,不是推导出来的。

25% 吸附的理由:参考图外圈其实是整齐的。全随机会糊成一片,眼睛没有落点。

**边界代价**:轴对齐的车贴着边摆能正好压到边界,斜着的车不行——一辆 45° 的 big 车的 AABB 半对角约 1.3 板单位,靠边就浪费掉一圈。49.5% 的目标密度有这个余量,但如果实测塞不下 36 辆,泄压阀的顺序是:先降 `CAR_SCALE`,再考虑放大 `LOT`。

### peel:每辆车只有两个朝向

`peel` 的**结构一行不改**。唯一改动是「一个 piece 有哪些合法朝向」:

```ts
// 今天:dirsFor(2×1 的 piece) → ['left', 'right']
// 以后:
function headingsFor(p: Piece): number[] {
    return [p.angle, p.angle + 180];   // 车头出去,或者倒车出去
}
```

这是今天那条规则的严格类比:摆位就是车身轴,能选的只有沿轴的两个方向。`dirsFor` 的那段注释(车身只能画在长轴上,否则箭头会撒谎)现在**由几何本身保证**,不再需要一条规则去维持。

**自由度下降**:今天的小车是方形 footprint,`dirsFor` 给它四选;以后小车也是长条,只有两选。剥离更容易卡住,`generateLevel` 的 200 次 attempt 和 `repair` 兜底仍在,但可能要提高 `ATTEMPTS`。这条要实测。

## 四、难度曲线要重新标定

`estimateDifficulty` 的两个指标(t=0 时被挡的车数、贪心解需要的轮数)**语义不变**,逻辑也不变——它只调 `pathClear`,跟着签名机械改一下调用点就行。

但斜着开出去是一条**斜的扫掠带**,蹭到的车比正交多,`blocked` 的分布会整体上移。`levelParams` 里的 `blockedRatio`(0.5 起、每关 +0.025、上限 0.75)和 `BLOCKED_TOLERANCE = 3` 要按实测重新取值。

**这是重新标定,不是重新设计。** 做法:改完生成器后跑十关,打印 blocked/rounds 分布,把曲线平移到新的区间。

另外一条要留意但本次不解决的:斜向遮挡**玩家一眼读不出来**。四方向时「这一列被堵了」是一目了然的;自由角度下要看懂谁挡谁需要顺着箭头扫一遍。如果实测发现太难读,后续的解法是给车加一条驶出方向的地面导引线,而不是退回四方向。本次不做。

## 五、View

停车位里的车、圆环、通道**完全不受影响**。

| 文件 | 改动 |
|---|---|
| `grid-layout.ts` | 改名 `board-layout.ts`。`cellCenter` → `toWorld(x, y)`(纯缩放,不再翻 Y);`footprintSize` 删除;`carSize(cap)` 新增,把 `CAP_BOX` 换算到世界单位 |
| `grid-view.ts` | `render` 用 `angle` 直接设旋转;`pickCar` 改成把点变换进车体局部再做 AABB(约 5 行);`CarEntry` 的 `hw`/`hh` 换成 `len`/`wid`/`angle` |
| `car-builder.ts` | `orientAngle` **删除**,`buildCar` 直接收 `angle`;footprint 夹取删除,车按 `CAP_BOX` 的尺寸画;`sharedCarScale` 从「求三档共同能塞进各自 footprint 的最大系数」退化成「让模型 AABB 等于 `CAP_BOX × 格距`」,每档各算各的,不再共享 |
| `GameController.ts` | `DIR_VEC` 删除,方向由 `angle` 算;`routeToSlot` 见下;`playShake` / `playLotFull` 里的 `DIR_VEC[car.dir]` 换成角度向量 |
| `scene-stage.ts` | 场地尺寸来源从 `grid.cols/rows` 换成 `lot.w/h`。传参形状不变 |

### routeToSlot

今天是四个 if 分支。改成两步:

1. **沿朝向开出场地**:算出车心越过哪条边(比较 `halfW/|dx|` 和 `halfH/|dy|` 谁先到),得到出场点。
2. **并入对应环道**:越过上边 → 上环道,下边 → 下环道,左右同理。之后**现有的环道拐弯逻辑照旧**(`r.top / r.left / r.right / r.bottom` 那套一行不改)。

也就是说四个分支变成「先算出是哪个分支,再走同一段老代码」。

### 车身朝向的连续性

`driveRoute` 已经在用 `shortestAngle` 让转向走近路,起始角度从 `body.eulerAngles.z` 读。自由角度下这条逻辑**原样可用**,只是起始值从四个离散值变成任意值。

## 六、关卡数据与校验

`level-N.json` 的 `grid` 段变成:

```json
"lot": {
  "w": 9, "h": 6,
  "cars": [
    { "id": 1, "x": -3.7412, "y": 2.1055, "angle": 118.4, "color": "red", "cap": "small" }
  ]
}
```

坐标和角度**保留 4 位小数**,文件才读得下去,diff 也稳定。

`validateLevel` 新增三条:

- 每辆车的 OBB 完整落在 `lot` 内;
- 任意两辆车的 OBB 间隔不小于 `CLEARANCE`;
- `angle` 是有限数。

前两条今天不需要——格子天然保证。松弛算法会不会留下残余重叠,只有校验说了算。

`tools/gen-levels.ts` 里读 `level.grid.cars` 的地方跟着改名。

## 七、测试

新建 `logic/tests/geometry.test.ts`,这是本次的重点:

- 正面对撞:命中距离等于两车间隙;
- 横向错开足够远:返回 null;
- 恰好擦着 `CLEARANCE`:边界两侧各一条;
- 目标在**身后**:返回 null(不能把反向的碰撞算进来);
- 出发时就重叠:返回 0;
- 长车贴着另一辆平行滑过:不算碰撞;
- 45° 斜穿两车之间的缝:缝宽刚够 → 通过,差一点 → 挡住;
- `overlapMTV` 推开后的两个 OBB 确实不再重叠。

改写:`move-solver.test.ts`、`grid-system.test.ts`、`solvability.test.ts`、`level-gen.test.ts`、`level-data.test.ts`、`coverage-m2.test.ts`(内联了 `grid: {cols:2, rows:2}`)、`integration.test.ts`。

**新增一条不变量测试**:十关每一关的车两两不重叠、且都在场地内。松弛算法的 bug 只有这条能抓住。

`game-core.test.ts`、`loop-system.test.ts`、`boarding-system.test.ts`、`parking-system.test.ts`、`track-*.test.ts` **不动**。

## 八、里程碑拆分

拆分原则:**每个里程碑结束时双闸都必须绿**。这一条决定了怎么切——不能把「core 改了型、view 还没跟上」的中间态留在里程碑边界上,那时 `typecheck:view` 是红的。

**M8-1 几何,纯新增** —— 只加 `core/geometry.ts`(OBB / 扫掠 SAT / MTV / `insideRect`)和 `logic/tests/geometry.test.ts`。其它文件**一个字不改**,老的格子代码原样跑着。双闸绿是白送的,这一步是把最该 TDD 的几何先钉死。

**M8-2 切换数据模型(最大的一步,必须原子)** —— `CarSpec` / `CAP_BOX` / `Lot` 改型、`Dir` 删除、`pathClear` / `firstBlocker` 重写、`grid-system` / `solvability` / `level-data` 跟改、松弛打包、双朝向剥离、`gen-levels.ts`、十关重新生成,**外加 view 的机械改动**——`board-layout`、`grid-view`、`car-builder`、`GameController` 里所有引用 `dir` / `w` / `h` / `cols` / `rows` 的地方。这一步只求**编译过、跑得起来、画得出斜车**,不求好看。

难度曲线**沿用今天的常数**,所以生成出来的十关大概率偏离目标——这是预期内的,`generateLevel` 会退回「最接近的一次尝试」,关卡仍然可解。

**M8-3 打磨与标定** —— `routeToSlot` 泛化、拾取精度、朝向连续性、难度曲线按实测重新标定并再次重生成十关。**到这一步才值得你在编辑器里看**;前两步没法判断好坏。

十关因此会被生成两次(M8-2 一次、M8-3 一次),这是刻意的:曲线要标定就得先能跑起来看。

## 九、不做的事

- **车辆转弯**:车只沿直线驶出。参考图里也是。
- **车与车推挤 / 物理**:摆放阶段的松弛是生成器的内部手段,运行时没有物理。
- **放射状构图模板**:已确认走随机撒。
- **重做车辆模型**:长度阶梯窄(1 : 1.84 : 2.02)是模型的问题,不是几何的问题。本次只是解除限制。
- **斜向遮挡的可读性辅助**(地面导引线):等实测确认真的读不懂再说。
- **draw call 优化**:749 vs 预算 450,与本次无关。

## 十、风险

| 风险 | 症状 | 处置 |
|---|---|---|
| 松弛收敛不了 36 辆 | `pack` 反复失败,关卡车数不足 | 依次:提高 `RELAX_ITERS` → 降 `CAR_SCALE` → 放大 `LOT` |
| 双朝向让 `peel` 频繁卡住 | 十关都靠 `repair` 兜底,车数掉到 30 出头 | 提高 `ATTEMPTS`;仍不行则允许小车四朝向(方形化小车的碰撞盒) |
| 难度曲线标不回来 | `blocked` 分布过窄,关与关之间读不出差别 | `blockedRatio` 换成按实测分位数取值,而不是固定比例 |
| 斜向遮挡读不懂 | 需要用户实机判断 | M8-3 完成后由用户在编辑器里判定,再决定要不要加导引线 |
