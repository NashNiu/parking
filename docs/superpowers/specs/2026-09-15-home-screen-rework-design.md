# 大厅界面重做设计文档

> 状态:六节设计已口头确认,待用户书面审阅。
> 日期:2026-09-15
> 前置:`dev` @ `0920a10`(棋盘扩到 8x12 / 89 车,车身明暗按亮度取箭头色)。

## 目标

大厅从"一张写实照片 + 一条直路 + 一列胶囊"改成"纯代码绘制的扁平街道 + 一条真正穿过节点的蜿蜒路径 + 圆形关卡徽章",并补上一条常驻顶部栏。

两个 P0 是**风格统一**和**顶部栏**,其余是节点重做、四条修复和两条打磨。

## 需求(用户原话)

> 【P0 风格统一】删掉当前写实厚涂背景图(风格与游戏内不符,且有版权风险)。改为纯代码绘制的扁平场景:正交俯视视角的街道,配色和材质与游戏内棋盘一致(同一套 6 色常量表、同样的描边和投影参数)。元素只要:路面 + 路缘 + 几棵树 + 路灯,不要写实建筑。
>
> 【P0 顶部栏】新增常驻顶部栏:左侧金币数(与游戏内同一组件)、右侧设置按钮。预留两个位置给签到和免费金币(激励视频入口)。注意避开右上角胶囊按钮,预留安全区。
>
> 【P1 关卡节点】1. 节点改为圆形徽章,直径约屏宽 16% 2. 已通关:亮色 + 下方三星(星星尺寸放大到节点直径的 25%) 3. 当前关卡:放大 1.2 倍 + 缓慢呼吸缩放动效 4. 未解锁:灰色 + 锁图标 5. 节点沿一条蜿蜒路径交替左右分布,路径要真的穿过节点中心
>
> 【P1 修复】6. "共10关"与第 8 关节点重叠 7. 关卡状态有误:第 4 关是当前关,但第 5 关显示三星、第 6 关可点击。检查解锁逻辑 8. 打开大厅时自动滚动到当前关卡并居中
>
> 【P2】9. "开始 第4关" 按钮加图标和按下反馈 10. 如果蒙层保留,边缘改为左右渐隐 60~80px,现在两条硬边色差很明显

## 三处与原描述的出入

写进文档是因为它们改变了做法,不是措辞问题。

1. **游戏里没有金币。** 全仓搜索 `金币|coin|钱包` 只命中无关的英文词(`coincidence` 之类的注释)。[2026-07-22 设计文档](2026-07-22-parking-passenger-game-design.md) 第 62 行把金币列进过 HUD 规划,从未实现。"与游戏内同一组件"目前没有组件可复用 —— 金币是本次**新建**的子系统,见第六节。

2. **第 10 条的"蒙层"是路面本身。** `home-view.ts` 的 `ROAD` 是一条 620 宽、`rgba(24,30,50,150)` 的竖条,压在照片上,左右两条硬边就是用户看到的色差。照片一删它就不该再是半透明蒙层,而该是场景里的路。所以本次不是给它加渐隐补丁,而是连带重做;`SCRIM`(顶部那道为标题压暗天空的渐变)随照片一起删除。

3. **第 7 条从源码复现不出来。** 见第二节末尾。

## 硬约束

- **core 不认识 Cocos**:`core/` 下任何文件不许 `import ... from 'cc'`。三个新增 core 文件全是纯 TS。
- **双闸必须绿**:`cd logic && npm test` 和 `npm run typecheck:view`。
- **HUD 不动**:`hud-view.ts` 的关卡名牌 / 乘客计数 / 齿轮那一排位置不变,`topReserve()` 的返回值不变。本次只往它的设置卡上加一个 `lobby` 开关。
- **棋盘不动**:`scene-stage.ts` 只做常量搬家(值一个不改),不改几何。
- **零图片资源**:删掉 `home-bg.jpg` 之后,`resources/` 回到只有音频和关卡 JSON。

## 一、层次划分

新增:

| 文件 | 层 | 职责 |
|---|---|---|
| `core/home-path.ts` | core | 节点中心坐标、路径采样点 |
| `core/wallet.ts` | core | 金币余额的解析/序列化/结算 |
| `core/level-state.ts` | core | 关卡三态判定 |
| `view/palette.ts` | view | 棋盘与大厅共用的材质配色 |
| `view/home-scene.ts` | view | 扁平街道:路面、路缘、树、路灯 |
| `view/top-bar.ts` | view | 常驻顶部栏 |

改动:`view/home-view.ts`(重写组装,保留手势)、`view/ui-shapes.ts`(加 `triSprite`)、`view/ui-layout.ts`(加 `capsuleInset`)、`view/storage.ts`(加钱包读写)、`view/scene-stage.ts`(常量搬家)、`view/hud-view.ts`(设置卡 `lobby` 开关)、`view/GameController.ts`(钱包装配、结算发币、大厅态的输入路由)、`view/rail-math.ts`(`RAIL_PITCH` 272 → 340)。

删除:`game/assets/resources/home-bg.jpg` 及其 `.meta`。

几何进 core 遵循 README 那条既有约定("几何约束本身住在 core",`track-shapes.ts` / `track-path.ts` 是先例):`validateTrack` 要在关卡落盘前判断环画不画得下,同理"路径穿过节点中心"要能在没有引擎的情况下断言。

## 二、关卡三态(第 7 条)

### 现状

三处独立计算,三个真值来源:

```ts
// home-view.ts setProgress
const open = isUnlocked(p, level);      // level <= unlockedThrough(p)
const best = bestStars(p, level);
const done = best > 0;
...
stop.stars[s].active = open && done;
```

"锁着"和"有星"是两个可以同时为真的独立事实,靠调用点每次都记得 `&&` 起来。

### 目标

`core/level-state.ts`,一个纯函数,**顺序即优先级**:

```ts
export type LevelState = 'done' | 'current' | 'locked';

export function levelState(p: Progress, level: number): LevelState {
    if (level > unlockedThrough(p)) return 'locked';   // 锁赢
    if (bestStars(p, level) > 0) return 'done';
    return 'current';
}

/** 该画几颗星。非 done 一律 0 —— view 拿不到"锁着却有三星"这种组合。 */
export function starsFor(p: Progress, level: number): number {
    return levelState(p, level) === 'done' ? bestStars(p, level) : 0;
}
```

view 只读 `levelState` 和 `starsFor`,不再自己拼 `open && done`。三态由返回类型互斥,不可能同时成立。

`isUnlocked` 保留(`hitsStart` 的闸门还用它),但 `home-view` 不再直接调。

### 测试(`logic/tests/level-state.test.ts`)

覆盖**带缺口的存档**这一类,因为那是唯一能让"锁着"和"有星"同时为真的输入:

- 空存档:第 1 关 `current`,第 2 关起 `locked`
- 通了 1、2、3:第 4 关 `current`,第 5 关 `locked`,`starsFor(5) === 0`
- 通了 1、2、3、5(第 4 关缺口):第 4 关 `current`,**第 5 关 `locked` 且 `starsFor(5) === 0`** —— 尽管存档里第 5 关有三星
- 全通:最后一关 `done`,`unlockedThrough` 越界不崩
- `level` 为 0 / 负数 / 非整数:不抛

### 关于复现

**这一节的重构不等于第 7 条已修复。**

按现有代码,第 5 关锁着时 `open` 为 false,星星的 `active = open && done` 就是 false,星星是隐藏的。也就是说用户描述的现象(第 4 关是当前关、第 5 关显示三星)在现有源码里推不出来。可能的解释有几种,源码读不出是哪一种:存档本身脏、`stops` 数组与 `levelCount` 不同步、`setProgress` 的调用时机、或者用户看到的是别的构建。

因此实施顺序是:**先复现,再改**。按 systematic-debugging 走 —— 先拿到能重现的存档或截图,定位真实成因,写一条会失败的测试,再修。上面的三态重构消除的是这**一类**问题(两个独立真值需要调用点手动 `&&`),它该做,但它不是对第 7 条的答复。

第 7 条后半句"第 6 关可点击"是**现有设计的有意行为**:`hitsStop` 对锁着的节点也返回命中,把它滚到中间让玩家看到它是哪一关,只有开始按钮拒绝(`hitsStart` 读 `focusOpen`)。这条保留 —— 拒绝滚动比拒绝开始更难理解。但新的锁态视觉(灰 + 锁)会比现在明显,"可点击"就不会再读成"可进入"。

## 三、节点与路径几何

### 尺寸

`w` 是画布设计宽度,固定 1280(`designResolution 1280x720, policy 4` FIXED_WIDTH,见 `ui-layout.ts` 的 `canvasSize` 注释)。`h` 随宽高比变化,约 1707(4:3)到 2770(19.5:9)。

```
D          = round(w * 0.16) = 205    节点直径
STAR_D     = round(D * 0.25) = 51     星星直径(需求点名的 25%)
STAR_PITCH = 56                       三颗共 2*56 + 51 = 163 < 205 ✓
CUR_SCALE  = 1.2                      当前关,画出来 246
BREATHE    = 1.20 ↔ 1.26, 1.6s, sineInOut, repeatForever
```

星星在节点**下方**(需求原话"下方三星"),星心 y = -(D/2 + 8 + STAR_D/2) = -136。

### RAIL_PITCH:272 → 340

单个节点的纵向占位:上沿 +123(当前关 +148),下沿 -162(星星底)。相邻两个要不打架:

```
162 (上面那个的星星底) + 148 (下面那个的顶) + 30 (间隙) = 340
```

这同时是第 6 条重叠的成因之一 —— 272 的间距装不下 205 的徽章加下方星星,现在的胶囊只有 148 高才勉强够。

`RAIL_PITCH` 在 `view/rail-math.ts`,有 `logic/tests/rail-math.test.ts` 覆盖 —— 那份测试通篇用 `RAIL_PITCH` 这个符号表达期望值(`railOffset(9)` 期望 `9 * RAIL_PITCH`),没有写死 272,所以改这个数不需要动测试。这正是那份测试该有的样子。

一屏可见关数:高屏(h≈2770)约 7 关,4:3 平板(h≈1707)约 3 关。平板上稀疏,这是竖版滑轨的固有代价,不为它做第二套布局。

### 蜿蜒

`ZIG_X = 210`,节点交替落在 ±210。两列中心相距 420,外沿到屏边还剩 1280/2 - 210 - 102 = 328。

一条腿 dx=420 / dy=340,约 51° 斜度。直接连成折线是折角,所以用二次曲线平滑:每个节点处取一个控制点,腿的两端各留一段直,中间走曲线。

`core/home-path.ts`:

```ts
export const ZIG_X = 210;

/** 节点 i 的中心,在滑轨自己的坐标系里(y 随 i 增大而增大,和 railOffset 同向)。 */
export function nodeCenter(i: number): { x: number; y: number };

/**
 * 从节点 i 到节点 i+1 的路径采样点,含两端。
 * SAMPLES_PER_LEG 段 —— 6 足够,二次曲线很浅。
 */
export function legSamples(i: number): { x: number; y: number }[];
```

### 测试(`logic/tests/home-path.test.ts`)

- **每个节点中心到路径的距离为 0** —— 第 5 条那句话的可执行版本。对每个 i,`legSamples(i)[0]` 恰等于 `nodeCenter(i)`,末元素恰等于 `nodeCenter(i+1)`。
- 节点左右交替:`nodeCenter(i).x` 的符号随 i 翻转
- `nodeCenter(i+1).y - nodeCenter(i).y === RAIL_PITCH`
- 采样点 y 单调上升,不回折
- 采样点全部落在 `|x| <= ZIG_X` 之内(曲线不外甩出节点列)

### 描边

`ui-shapes` 只有圆角矩形和圆点,没有描线器。一段路 = 一个**旋转过的圆角矩形**(`node.angle` 即可,不需要新图元),接缝处补一个圆点填角。

两层:

```
路缘  宽 116,palette 的 KERB   在下
路面  宽 96, palette 的 ROAD   在上
```

10 关 9 条腿 × 6 段 × 2 层 = 108 个矩形 + 108 个圆点。和棋盘上 89 辆车同量级。按**腿**剔除屏外部分(两端点都在屏外就整条 deactivate),关卡数涨到 100 也只有可见的 8 条腿是活的。

## 四、扁平街道(P0 风格统一)

### 配色搬家

`scene-stage.ts` 里这几个常量提到 `view/palette.ts`,**值一个不改**:

```
GROUND      189,200,218    地面
GRID_LINE   176,188,208    铺装缝
LOT          95,102,118    停车场面
LOT_DASH    206,212,224    车位虚线
ROAD         86, 93,108    路面
ROAD_LINE   156,162,176    路面标线
LOT_SHADOW_ALPHA  30       投影
```

`scene-stage.ts` 改为从 `palette` import。这是"同一套常量表"落到实处的唯一方式 —— 大厅自己抄一份,两边迟早漂移(棋盘的 `GROUND` 注释里已经记录过一次"跟着地面调亮"的联动)。

`KERB` 是本次新增的一个值(路缘),棋盘上没有对应物,定在 `GROUND` 和 `ROAD` 之间。

搬家会碰到一个现有的 import:`GameController.ts:28` 从 `scene-stage` 取 `GROUND` 当相机清屏色,改成从 `palette` 取。`scene-stage` 不做 re-export —— 留一条转发就等于留了两个入口,下一个人还是会从旧的那个进来。

顺带解掉一处已知耦合:`environment.ts:84` 的注释写着"nothing here reads scene-stage to keep them in step"(环境光的冷暖要跟着 `GROUND` 走,但它读不到)。有了 `palette` 它就读得到了。本次不改环境光的值,只是让那条注释不再成立。

树冠、路灯灯头用 `colors.ts` 的六色 —— 需求点名的"同一套 6 色常量表"指的是这个。

### 元素

正交俯视,只有四种东西:

- **路面**:第三节的路径描边本身就是路面。左右边缘 70 单位横向渐隐(第 10 条,需求给的是 60~80),用 `rampSprite` 旋转 90°,融进人行道。
- **路缘**:路面下面那层,两侧各露出 10 单位。
- **树**:俯视是两个圆 —— 投影圆(`LOT_SHADOW_ALPHA`,偏移几个单位)+ 树冠圆(`COLORS.green` 压暗)。
- **路灯**:灯杆短条 + 灯头圆 + 低透明度光斑圆。

位置按序号**确定性生成**(`i` 喂一个整数哈希),不是 `Math.random` —— 滚动时重新 layout 不能让树跳位置。

不画建筑(需求明确排除),不画车(需求没列)。

### 删除

`home-bg.jpg` + `.meta` 删除。`home-view.ts` 里的 `HOME_BG` 常量、`resources.load` 回调、`Texture2D` 的 `setWrapMode`/`SpriteFrame` 包装、`SCRIM` / `SCRIM_SPAN` 全部删掉。那段 wrap-mode 的注释(非 2 次幂纹理在 WebGL1 上采样成黑)是有价值的知识,但它属于那张图片 —— 图片没了,注释跟着走,不留孤儿。

## 五、顶部栏(P0)

### 位置

微信胶囊在 375pt 宽的机器上约 87pt,换算到 1280 设计宽约 330 单位 —— 四分之一屏宽。横向避让会吃掉一个槽位,而且胶囊宽度随机型和微信版本变化,那个留白是个会漂移的数。

所以**整条栏排在胶囊下面一行**。位置低一截是确定的损失,横向避让的风险是不确定的。

`ui-layout.ts` 新增:

```ts
/** 胶囊按钮下沿,占屏高的比例。非微信环境返回 0。 */
export function capsuleInset(): number;
```

读 `wx.getMenuButtonBoundingClientRect()`,除以 `screenHeight` 得比例 —— 和 `safeInsets()` 同一套做法和同一套降级策略(try/catch,失败返回 0,读一次缓存)。浏览器和编辑器预览里返回 0,栏就贴着 `safeInsets().top` 排,这是对的:那里没有胶囊。

### 布局

```
BAR_H = 96,  margin = w * 0.03 = 38
y = h/2 - max(safeInsets().top, capsuleInset()) * h - margin - BAR_H/2

[金币 240x88]      [共 N 关]        [槽1 76] [槽2 76] [齿轮 76]
 左沿 -602          居中 0            418      510      602
```

金币右沿 -362,槽 1 左沿 380,中间 742 单位留给"共 N 关"(36px 约 110 宽)。两个槽位启用后仍然装得下。

### "共 N 关"搬家(第 6 条另一半)

现在它在一块 **320x88** 的浮动铭牌上,而滑过它背后的胶囊是 **236x148** —— 宽度上铭牌盖得住,**高度上盖不住**:胶囊的上下沿各有 30 单位从铭牌外露出来,看着就是穿模。换成 205 的圆徽章加下方星星之后纵向占位涨到约 285,只会更糟。

铭牌本身的理由是成立的(那条注释说得很清楚:滚动的节点必然会穿过任何固定文字,不透明铭牌是唯一解),错的是它和滑轨在同一层。

搬进顶部栏就在滑轨之外了。滑轨顶端加一道渐隐,避免节点在栏下沿硬切。

### 两个预留槽

只定义槽位常量和接口,**不画灰按钮**:

```ts
/** 预留槽。i 为 0(签到)或 1(免费金币)。传 null 收起。 */
setSlot(i: 0 | 1, slot: { icon: Node; onTap: () => void } | null): void;
```

上线一个点不动的死按钮比留白更糟 —— 玩家会点,点了没反应就是 bug。

### 大厅的设置面板

复用 `hud-view` 的设置卡,加一个 `lobby` 开关隐掉「主页」「重玩」两行(在大厅里这两个按钮没有意义)。`GameController.handleTap` 在 `screen === 'home'` 分支里,把设置面板的命中判定排在滑轨之前 —— 面板打开时它是最上层的东西,和游戏内同样的优先级。

清档手势从"长按共 N 关"改为设置面板里一个明确按钮 + 二次确认。隐藏手势没人找得到,而承载它的那块铭牌这次本来就要挪位置。

## 六、金币与结算

### core/wallet.ts

```ts
export interface Wallet { version: number; coins: number }
export const WALLET_VERSION = 1;

export function emptyWallet(): Wallet;
export function parseWallet(raw: string | null): Wallet;
export function serializeWallet(w: Wallet): string;
export function addCoins(w: Wallet, n: number): Wallet;   // 不可变,返回新对象

/** 每档星数累计值得多少币。下标即星数。 */
const COIN_FOR_STARS = [0, 25, 40, 60];

/** 涨星补差额,重玩不重复发。 */
export function coinsForClear(prevBest: number, newStars: number): number;
```

失败策略照抄 `progress.ts`:任何意外输入回落成空钱包,不抛 —— 这东西在启动路径上读,抛了就是开不了游戏。`coins` 非有限数、负数、小数一律回落。

### 存储

`storage.ts` 加 `parking.wallet` 这个 key 的一对读写 + 一个 `clearWalletText`。

**清档连钱包一起清。** 这和 `storage.ts:50` 那段注释的理由相反(设置刻意不被清档带走,因为"两种不同的生命周期"),所以要在代码里写明白为什么相反:金币是从进度**派生**出来的,两者分开会让"通关 → 清档 → 再通关"变成无限刷币。设置不是派生的,所以它留着。

### 结算接线

`GameController` 在写进度的同一处:先算 `coinsForClear(旧的 bestStars, 本次星数)`,再 `recordClear`。顺序不能反 —— `recordClear` 会把 `bestStars` 更新掉,反了就永远算出 0。

发币为 0 时不写盘(和 `recordClear` 的 `changed` 同一个道理:写盘在设备上是同步调用)。

### 测试(`logic/tests/wallet.test.ts`)

- 空 / 空白 / 非 JSON / 数组 / 版本不符 → 空钱包
- `coins` 为负 / NaN / Infinity / 字符串 / 小数 → 回落
- `coinsForClear(0, 3) === 60`;`coinsForClear(1, 3) === 35`;`coinsForClear(3, 1) === 0`;`coinsForClear(2, 2) === 0`
- 星数越界(0、4、-1)不抛
- `addCoins` 不改入参

## 七、余下三条

### 第 8 条:打开大厅滚到当前关并居中

现在 `setProgress` 已经 `setFocus(unlockedThrough)` 并且直接落位(`this.offset = this.target`)。问题在**居中的基准**:滑轨对准的是画布中心 y=0,而画面上下各被顶部栏和开始按钮啃掉一块,所以看起来偏下。

改成对准**空带的中心**:

```
bandTop     = 顶部栏下沿
bandBottom  = 开始按钮上沿
railCenterY = (bandTop + bandBottom) / 2
```

`railRoot` 的 y 设成 `railCenterY`,`layout()` 里的 y 计算不变。

### 第 9 条:开始按钮加图标和按下反馈

`ui-shapes` 新增 `triSprite`(一个三角播放头,和 `starSprite` 同样的画法:一次性画进小纹理,白色可着色)。图标放在文字左边。

按下反馈复用 HUD 已有的手法:面下沉 `BTN_LIFT`(8 单位)贴到底座上,松手弹回。需要 `GameController` 在 `onPressStart` / `onPressEnd` 里把大厅按钮的按下态转给 `HomeView` —— 现在大厅只有 `handleTap`,没有按下态。

### 第 10 条:路面左右渐隐

见第四节。70 单位,`rampSprite` 旋转 90°。

## 里程碑

每一步单独过双闸、单独提交。

1. **core 三件套**:`level-state.ts` / `wallet.ts` / `home-path.ts` + 三份测试。view 一行不动,双闸绿。
2. **复现并修第 7 条**:按 systematic-debugging,先拿到重现,写会失败的测试,再修。
3. **配色搬家**:`palette.ts` + `scene-stage.ts` 改 import。纯搬家,画面零变化。
4. **扁平街道**:`home-scene.ts`,删照片和 `SCRIM`,删 `home-bg.jpg`。
5. **节点与路径**:圆形徽章三态、`RAIL_PITCH` 340、路径描边、第 8 条居中。
6. **顶部栏**:`capsuleInset` / `top-bar.ts` / 金币接线 / 设置面板 `lobby` 开关 / 清档按钮。
7. **P2 打磨**:开始按钮图标与按下反馈。

## 风险

- **第 7 条可能不是三态逻辑的问题。** 里程碑 2 独立出来就是为了这个:如果复现指向别处,那一步的范围会变,但 1、3~7 不受影响。
- **4:3 平板上一屏只有 3 关多。** 已知代价,不做第二套布局。
- **draw call。** 路径描边加约 216 个 sprite 节点,但大厅上没有棋盘(`GameController.screen` 保证 board 不在大厅时构建),而且按腿剔除屏外。大厅不是 draw call 的紧张场景。
