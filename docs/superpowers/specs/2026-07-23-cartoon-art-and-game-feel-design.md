# 卡通美术 + 手感升级 设计文档 (M4)

> 状态:已通过口头设计评审,待用户书面审阅。
> 日期:2026-07-23

## 目标

把当前"代码生成的占位方块"升级为**明亮卡通/休闲风**的可辨识视觉(车、乘客、停车位、场景),并加入一整套**手感反馈(juice)**:操作反馈、上车/发车反馈、音效+震动、胜利/失败演出。全程**不依赖任何外部美术/音频素材**——所有资源由代码生成(几何体拼装 + 代码合成的 WAV)。

## 硬约束

- **纯视图层改动**:`game/assets/scripts/core/` 一行不改;`logic/tests/` 44 个测试保持全绿。
- **零外部素材**:不引入 .fbx/.gltf/.png/.mp3 等第三方文件。车/人/场景用 Cocos 内置基元(box/cylinder/sphere/capsule)+ 代码材质拼装;音效用 Node 脚本合成 WAV,提交到仓库(视为"代码产物",非外部素材)。
- **风格统一**:明亮卡通/休闲风——鲜艳饱和色块、圆润造型、柔和光照、暖色渐变背景。
- **保留现有布局与交互**:2.5D 倾斜板(`BOARD_TILT=52`)、固定相机(pos (0,5,12) lookAt (0,-0.3,0))、射线拾取入库流程不变。
- **平台安全**:震动等微信 API 必须带平台守卫,在非微信(浏览器预览/编辑器)环境静默降级,不报错。
- **性能**:目标微信小游戏,单车由少量子节点组成(≤ ~8 mesh/车),伪粒子有对象上限/自动回收,避免节点泄漏。

## 现状(基线)

视图层文件 `game/assets/scripts/view/`:

- `placeholder.ts` — `makeBox`(builtin-unlit 纯色盒)、`makeCar`(盒身+白条箭头)、`setBoxColor`。**所有物体无光照。**
- `colors.ts` — 6 色调色板(red/blue/green/yellow/purple/cyan)。
- `grid-layout.ts` — 网格坐标↔世界坐标(XY 平面,行 0 在上)。
- `grid-view.ts` — 每辆车一个 `makeCar` 节点;`pickCar`(局部空间 AABB 命中)、`detachCar`、`removeCar`。
- `parking-view.ts` — 停车位一排盒子(解锁=浅色,锁定=深色);`getSlotPosition`。
- `loop-view.ts` — 环形轨道:椭圆上 `capacity` 个盒点,`update(ring)` 按颜色显隐(传送带感)。
- `hud-view.ts` — 运行时在 Canvas 下建 Label:关卡号、剩余乘客、中央 banner、`newSeatLabel`(车上座位数浮标)。
- `GameController.ts` — 主组件:加载关卡、`buildBoard`、相机、帧驱动 `stepLoop`、tap→射线→`pickCar`→`tapCar`、入库/抖动补间、填充条、发车飞出、win/lose banner、重玩(`loading` 守卫)。

## 架构:新增/改动文件

新增(视图层):

- `view/materials.ts` — **材质工厂**。缓存按颜色索引的 `builtin-standard` 卡通材质(高粗糙、无金属、微高光);提供发光(emissive)控制接口用于红闪/高亮;保留 unlit 工厂给 UI 条/箭头等需要恒亮的元素。
- `view/car-builder.ts` — `buildCar(spec)`:用基元组合卡通车(圆润车身 = 底盘+车厢两段、4 深色轮子、浅色车窗、车顶亮色方向箭头)。按 `w×h` 占地与 `cap`(small/medium/big)缩放,三种容量外观可区分(如车厢高度/车窗数/顶灯)。暴露车身主节点句柄以便 squash/flash。
- `view/passenger-builder.ts` — `buildPassenger(color)`:小人剪影(头球 + 身体胶囊,染色)。
- `view/environment.ts` — 场景装点:方向光 + 提升环境光、圆润舞台地面、背景暖色渐变与远景装饰(billboard 色块/云,无贴图)。
- `view/effects.ts` — 伪粒子与补间助手:`dustBurst`(起步尘土)、`stars`(发车/胜利星星)、`confetti`(胜利彩带),均为"小球/彩色四边形 + 缓动 + 自动销毁";补间助手 `squash`、`overshoot`、`flash`(emissive 脉冲)。带全局活动粒子上限。
- `view/sfx.ts` — `SfxManager`:命名事件 `play('tap'|'drive'|'park'|'board'|'depart'|'win'|'lose')`,加载 `resources/audio/` 下 WAV,用 AudioSource 播放;缺文件时静默。
- `view/haptics.ts` — `vibrate('light'|'medium')`:封装 `wx.vibrateShort`,带平台守卫。
- `tools/gen-sfx.js` — Node 脚本,**合成**上述 7 个短 WAV(方波/正弦 blip、上扬/下降音),输出到 `game/assets/resources/audio/`。一次性运行,产物提交仓库。

改动:

- `loop-view.ts` — 用 `buildPassenger` 替换盒点(保留椭圆布局与 `update` 显隐逻辑)。
- `parking-view.ts` — 车位升级为卡通车位框;锁定位加锁/铁链造型。
- `hud-view.ts` — 胜利演出:星级评分(由本关表现/剩余道具等简单规则给 1–3 星,先用占位规则)、更有仪式感的过关面板;失败面板。
- `GameController.ts` — 接线:tap 时 `squash`+`sfx('tap')`+震动;开出加速缓动+`dustBurst`+`sfx('drive')`;入库 `overshoot`+`sfx('park')`;开不出 `flash`+抖动+`sfx('lose'?/error)`+震动;车满高亮;发车 `stars`+`sfx('depart')`;胜利 `confetti`+星级+`sfx('win')`;失败死局车高亮+`sfx('lose')`。上车反馈见下。
- `colors.ts` — 微调为更鲜艳饱和的卡通配色。

### 上车反馈(需要新数据通道吗?)

现状:`stepLoop()` 返回 `BoardResult { boardedColor, departedCarIds }`,视图只知道"某色上了一个人"和"哪些车发车",**不知道具体从环上哪个位置上到哪辆车**。为做"乘客沿弧线飞向车"的动画:

- **方案(推荐,零核心改动)**:视图侧近似——收到 `boardedColor` 时,从环形轨道上**该色最靠近上车口的可见点**取一个,生成一个临时乘客节点沿贝塞尔弧线飞向**该色已停的车**,到达后座位数跳动。核心不动,纯视图近似,视觉上足够。
- 备选(不采用):改 `BoardResult` 暴露源环位/目标车 id——会动核心与测试,违反硬约束,不做。

采用推荐方案。

## 分阶段(SDD 执行,每阶段用户截图确认)

- **A 渲染基础**:`materials.ts` + `environment.ts`(灯光/环境光/地面/背景),现有盒子切到卡通材质。交付:场景有光照与暖色背景,方块有明暗。
- **B 车**:`car-builder.ts`,`grid-view.ts` 改用它;三种容量外观区分。交付:网格里是卡通车。
- **C 乘客+轨道**:`passenger-builder.ts`,`loop-view.ts` 改用它。交付:环上是走动的小人。
- **D 环境细化**:停车位框 + 锁定位锁造型。交付:车位可辨识、锁定位有锁。
- **E 手感·操作**:`effects.ts`(squash/overshoot/flash/dust)+ GameController 接线(点击/开出/入库/开不出)。交付:操作有弹性与尘土/红闪反馈。
- **F 手感·上车/发车**:上车弧线飞人 + 座位跳动 + 车满高亮 + 发车星星。交付:上车/发车有演出。
- **G 音效+震动**:`tools/gen-sfx.js` 生成 WAV + `sfx.ts` + `haptics.ts` + 全触发点接线。交付:各操作有声音,微信端有震动。
- **H 胜利/失败演出**:`confetti` + 星级评分 + 失败死局高亮,替换纯文字 banner。交付:结算有仪式感。

## 测试策略

- 核心逻辑不变 → `logic/tests/` 44 测试必须保持绿(每阶段跑一次 `cd logic && npx jest`)。
- 视图层为 Cocos 运行时渲染,**无单元测试**(与现有视图层一致);验收靠用户在 Cocos 预览截图。
- `tools/gen-sfx.js` 产物:脚本运行后校验 7 个 WAV 文件存在且可被 Cocos 识别(用户预览时听声)。
- 每阶段交付后:①`jest` 绿 ②用户截图确认视觉/手感符合预期,再进下一阶段。

## 风险与权衡

- **看不到渲染结果**:我无法自渲染,依赖用户逐阶段截图——因此小步交付(8 阶段)。
- **内置基元拼车**:Cocos `primitives` 无圆角基元,圆润感靠缩放/组合近似(如扁平化 box + 独立轮子);可接受的卡通近似,非拟真。
- **合成音效简陋**:代码 WAV 是街机 blip 级别,非专业音效;设计为易替换(同名文件覆盖)。
- **材质属性名**:`builtin-standard` 颜色/发光 uniform 名(albedo/emissive 等)需在 3.8.7 实测确认,计划阶段落实。
- **伪粒子性能**:用对象上限 + 自动销毁,避免大量节点导致卡顿。
```
