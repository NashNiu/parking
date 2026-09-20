import { insideRect, OBB, overlapMTV } from './geometry';

/**
 * 骨架的形状。**这是一张正掩码**:车只停在形状**里面**,形状外面是空着的沥青。
 *
 * 从前它是负掩码 —— 场地铺满车,再挖掉几条车道当"结构"。人类伙伴看着第 7 关说十字
 * 挖掉的中间那块太空,于是整套设计翻了个面:形状由**车**来画,不由空地来画。挖洞的
 * 版本要同时承担两件事(图案要看得出来,场地还要显得满),而这两件事在 8 x 12 上是
 * 打架的;正掩码只要承担一件。
 *
 * 形状外面读成"停车场边上的空地",不是"满场里被抠掉的一块",这是同一片空白的两种
 * 读法,而读法正是这次改动买到的东西。
 *
 * **命名陷阱:`level-gen.ts` 里的 `CROSS` 与 `plus` 无关。** `CROSS` 是横过来 90 度的
 * 车所占的比例(一个难度旋钮),`plus` 是十字形的掩码(一个观感形状)。形状之所以叫
 * `plus` 而不叫 `cross`,就是为了这两个词不撞车;要在同一句话里提到它们,必须点明哪个
 * 是哪个。
 */
export type SkeletonShape = 'full' | 'plus' | 'diamond' | 'ellipse' | 'donut';

/**
 * 每关一行,与 `TRACK_CURVE` / `TUNNEL_CURVE` / `BAND_CURVE` 同构,向两端钳制。
 *
 * 前两关不加形状:第 1 关是手写教学关,第 2 关是颜色刚够咬人的那一关,两关都不该再
 * 多一层结构要读。
 *
 * 排序按实测座位数从多到少 —— 形状越"瘦",场上车越少、空地越多,所以形状本身也是
 * 一条坡度。实测(`GAP` 0.20,8 个种子):
 *
 *     full 93   ellipse 79   donut 62   plus 58   diamond 51
 *
 * 这五个数全都落在已发出去的十关车数区间(43-89)之内,所以换形状不需要动 `GAP`,
 * 也不需要动 `CARS_PER_LEVEL` —— 车数本来就是结果不是目标(spec §2.3)。
 */
const SHAPE_CURVE: readonly SkeletonShape[] = [
    'full',      // 1  手写教学关,根本不走打包器
    'full',      // 2  第一关有难度的,先不加形状
    'ellipse',   // 3
    'ellipse',   // 4
    'donut',     // 5
    'donut',     // 6
    'plus',      // 7
    'plus',      // 8
    'diamond',   // 9
    'diamond',   // 10
];

export function skeletonShape(id: number): SkeletonShape {
    const i = Math.min(Math.max(1, Math.trunc(id)), SHAPE_CURVE.length) - 1;
    return SHAPE_CURVE[i];
}

/**
 * 这个点在不在形状里面。
 *
 * 坐标先归一化到 [-1, 1] x [-1, 1],所以下面每个判据都跟场地尺寸无关 —— 场地从
 * 8 x 12 变成别的,形状跟着变形而不是跑出界。
 *
 * 场地尺寸是参数而不是 import:`LOT` 住在 `level-gen.ts` 里,而 `level-gen.ts` 要
 * import 本模块,反向 import 会成环。
 *
 * 每个阈值都是量出来的(见 `SHAPE_CURVE` 上那一行座位数),不是画出来的。`plus` 的
 * 两个半宽不相等(0.38 对 0.30),因为归一化把 8 和 12 拉成了同一个 1:横臂在 y 上的
 * 0.30 是 3.6 个单位高,竖臂在 x 上的 0.38 是 3.04 个单位宽,两条臂的**实际宽度**这才
 * 差不多。`donut` 的内半径 0.20 是半径的平方,不是半径。
 *
 * 判据只问**中心点**,车身可以探出边界,而且那是要的:一圈对得齐齐的保险杠会读成
 * 一堵墙,而不是一个形状。边缘参差才像"车停成了这个样子"。
 */
export function inShape(shape: SkeletonShape, x: number, y: number, w: number, h: number): boolean {
    const nx = x / (w / 2);
    const ny = y / (h / 2);
    switch (shape) {
        case 'full':    return true;
        case 'plus':    return Math.abs(nx) <= 0.38 || Math.abs(ny) <= 0.30;
        case 'diamond': return Math.abs(nx) + Math.abs(ny) <= 1.0;
        case 'ellipse': return nx * nx + ny * ny <= 1.0;
        case 'donut': { const r = nx * nx + ny * ny; return r <= 1.0 && r >= 0.20; }
    }
}

/**
 * 座位抖动占 `gap` 的比例。
 *
 * 本设计选定的结构强度是"弱"(松散格子):要的是有秩序但不刻板,不是几何图案。抖动
 * 是刻意的,不是噪声。半个 gap 是上限——再大就会吃掉行距,让"间距均匀"这条要求失效。
 */
const JITTER_F = 0.5;

/** 车身尺寸,已经乘过 `CAR_SCALE`。`len` 沿车身,`wid` 垂直于它,与 OBB 一致。 */
export interface Body { len: number; wid: number }

/** 一辆车的落点:位置加朝向。 */
export interface Seat { x: number; y: number; angle: number }

/**
 * 把 `bodies` 按顺序铺成松散行列,只铺在 `shape` 里面。
 *
 * 这是本设计的要害。`pack()` 原本均匀随机撒点,所以**空隙尺寸也是随机的**——大多
 * 数缝很窄,偶尔留下一块车形空地,而排名只能在候选里挑最不烂的一个,造不出一个从
 * 未出现过的整齐打包。点阵的空隙是设计出来的尺寸。
 *
 * 返回的第 i 个座位就是 `bodies[i]` 的位置,所以**返回数组与入参逐位对应**;铺不下的
 * 车不返回,数组因此可能比 `bodies` 短,由调用方决定怎么安置它们。
 *
 * 这与"先撒一片座位、再把车填进去"的差别是本模块存在的理由:座位要多长,取决于坐
 * 它的那辆车有多长,而一个均匀点阵没法同时服务 0.887 和 1.650 两种车身——按小的定
 * 就压住大的,按大的定就浪费三分之一的地。这一点不是推论,是实测:行内步长曾经写
 * 死成 1.0 + gap = 1.250,而大车含留白 1.758,同一行里两辆大车一出生就重叠 0.508,
 * 压掉近三成车身,全部丢给关系放松去救。后果是第 2 关收敛率 4/20,任何一种骨架下
 * 0/60——`generateLevel(3)` 生成出零辆车。spec §2.2 从一开始写的就是"行内车距 =
 * 该车 len * CAR_SCALE + GAP",这里补上的是那半句。
 *
 * `shape` 决定一个座位收不收,`blocked` 是不能压的地方(隧道保留区加它的出口走廊,
 * 由调用方膨胀好再传进来)。两者分开,因为它们的判据本来就不一样:形状问的是中心点
 * (见 `inShape`,车身可以探出去,那是要的),隧道问的是整个车身。
 *
 * `cross` 是在基准方向之上横过来的座位比例:0 全场同向,1 全场转 90 度,中间是比例。
 * 它调的是难度不是观感,理由写在 `level-gen.ts` 的 `CROSS` 上 —— 注意它跟 `plus` 这个
 * 形状没有任何关系,见 `SkeletonShape` 顶上的命名陷阱。
 */
export function latticeSeats(
    shape: SkeletonShape, blocked: OBB[], w: number, h: number, gap: number,
    rng: () => number, cross: number, bodies: Body[],
): Seat[] {
    const seats: Seat[] = [];
    /**
     * 整片点阵只有一个方向,而且是常数 90(朝上)。
     *
     * 从前这个数取自骨架的第一条车道。车道没有了,也就没有东西可取,所以它是 90。
     *
     * **一个角度**而不是每个座位各自取一个,这一条与车道无关,是本模块最容易写错的
     * 地方,所以留在这里:行距垂直于车身、行内步长平行于车身,两者都是按"车朝哪边"
     * 算出来的。座位各取各的角度,整片点阵就没有一套自洽的度量了 —— 一个座位的车身
     * 长边(大车 1.650)会落在邻座按车宽(0.524)算出来的行距上,成片重叠,全部丢给
     * 关系放松去救,点阵播种的意义当场归零。
     *
     * "全场车身平行"这个代价是实测证伪过的:第 2 关量到 `rounds` 从 17 塌到 10,一行
     * 策略就能赢 —— 它不是观感问题,是难度问题。所以 `cross` 在这一个方向之上再混入
     * 垂直的一档。这跟上一段不是一回事:度量还是这一个方向算出来的,只有少数座位转
     * 90 度,它们挤开邻座是有数的局部代价,关系放松吃得下,而那正是难度要的不规则。
     */
    const angle = 90;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // 行距按**最宽**的那辆车,spec §2.2 原文。行距是全行共用的一个数,按别的车定都
    // 会让最宽的那辆压住隔壁行——这跟行内步长不能是常数是同一件事的另一半。
    let widest = 0;
    for (const b of bodies) if (b.wid > widest) widest = b.wid;
    const pitch = widest + gap;
    const jitter = gap * JITTER_F;

    // `u` 沿车身方向,`v` 垂直于它。点阵在 (u, v) 里是规整的,再旋到场地坐标系 ——
    // 直接在 x/y 上排而让车斜着或竖着躺,就是把车长放在按车宽算出的间距上。
    //
    // 扫描范围取场地对角线的一半:场地四角到原点正是这个距离,所以旋到任何角度都还
    // 够得着。落在场地外或者形状外的座位在下面逐个剔除,多扫一些只是浪费几次循环。
    //
    // 这是余量,不是保证,差别在整行错位——它把一行的起点最多右移 `pitch / 2`,负 u
    // 那一端就少扫这么多。算过:reach = 7.2111,角度 90 下需要覆盖 h/2 = 6,余量
    // 1.2111;错位最多吃掉半个 pitch,而 pitch 在本设计的标定范围里不到 0.8。
    const reach = Math.hypot(w, h) / 2;
    let k = 0;                        // 下一辆还没安置的车
    for (let v = -reach; v <= reach && k < bodies.length; v += pitch) {
        // 整行错位,让相邻两行不是一把梳子。按 `pitch` 错位:行内步长不再是常数,
        // 拿它的一半去错位已经没有意义了。
        const stagger = rng() < 0.5 ? 0 : pitch / 2;
        for (let u = -reach + stagger; u <= reach && k < bodies.length; ) {
            const b = bodies[k];
            // 这一抽必须**无条件**抽,而且抽在剔除之前:`extent` 要用它,而 `u` 不论
            // 这个座位收不收都要按 `extent` 推进。写成 `cross > 0 && rng() < cross`
            // 会短路掉 cross = 0 那一抽,rng 流随 cross 错位——车身是正方形时两档点阵
            // 本该逐点重合,那样改就对不上了,测试里有一条专门咬这个。
            const turn = rng() < cross;
            // 横过来的车沿行方向占的是车宽,不是车长。
            const extent = turn ? b.wid : b.len;
            const cu = u + extent / 2 + (rng() - 0.5) * jitter;
            const cv = v + (rng() - 0.5) * jitter;
            const box: OBB = {
                x: cu * cos - cv * sin,
                y: cu * sin + cv * cos,
                angle: turn ? (angle + 90) % 360 : angle,
                len: b.len,
                wid: b.wid,
            };
            // 三条剔除,两种判据,而这个差别正是形状能被看出来的原因。
            //
            // 场地边界和 `blocked` 拿**车身**量:中心点避开隧道是不够的,Task 4 的
            // Critical 就是这个形状 —— 车身压进保留区,关系放松在 RELAX_ITERS 内收敛
            // 不了,`pack` 返回 [],整关生成出零辆车。
            //
            // 形状只拿**中心点**量,车身可以探出形状的边界 —— 见 `inShape`:边缘参差
            // 才读成一个由车摆出来的形状,对得齐齐的一圈保险杠读成一堵墙。
            if (insideRect(box, w, h)
                && inShape(shape, box.x, box.y, w, h)
                && !blocked.some((r) => overlapMTV(box, r))) {
                seats.push({ x: box.x, y: box.y, angle: box.angle });
                k++;                  // 收下了才换下一辆
                u += extent + gap;
                continue;
            }
            // 放不下就跳过一整个车位,让这辆车到下一个位置去试 —— 而不是"贴着障碍往前
            // 蹭一小步再试"。后者看起来明显更好(每穿过一块不能停的地方就少白扔一个车
            // 身长的位置),实测却相反:贴着蹭铺得更密,密到关系放松在 RELAX_ITERS 内
            // 收不了,`pack` 返回 [],关卡一辆车都生成不出来。抖动减半不能救它,所以
            // 原因不是抖动吃掉了余量 —— 那是试过并被推翻的两个猜想之一。
            u += extent + gap;
        }
    }
    return seats;
}

/**
 * 在半轴 `(ra, rb)` 的椭圆上,从 `θ = from` 起走过弧长 `ds` 要转过多少弧度。
 *
 * 速度 |dP/dθ| = hypot(ra sinθ, rb cosθ) 在一格之内自己就在变(长短轴比 3:2,两端差
 * 50%),拿起点的速度直接除会系统性地走短,同一圈里前后两辆车因此压在一起 —— 实测
 * 过,8 个种子里有 4 个出现相邻两辆重叠。中点修正一次就够:先用起点速度估一个 dθ,
 * 再用这一格中点的速度重算。剩下的误差是二阶的,量级在千分之一弧度。
 */
function arcStep(from: number, ds: number, ra: number, rb: number): number {
    const v0 = Math.hypot(ra * Math.sin(from), rb * Math.cos(from));
    const mid = from + ds / v0 / 2;
    return ds / Math.hypot(ra * Math.sin(mid), rb * Math.cos(mid));
}

/**
 * 沿等高线铺座位:一圈套一圈的同心椭圆,每辆车与它所在的那一圈**相切** —— 环岛边上
 * 停的那一圈车就是这个样子。目前只有 `donut` 走这里,由 `seatsFor` 分派。
 *
 * 为什么需要第二个铺法。`latticeSeats` 铺的是矩形点阵:一个基准朝向,一排排平行的行。
 * 把这样一片点阵裁到一条**弯的**带子上,内外两道弧就各切出一串楔形的碎角 —— 每个碎角
 * 都窄得坐不下一辆车,又宽得不像"贴边的参差",于是沿着两道边沿各留下一串车形空地。
 * 实测第 5 关(donut 掩码)在**自己的掩码里面**数出 7 个大洞,同一批参数下 ellipse 是
 * 0。被退役的旧 `ring` 骨架栽的也是这一跤。
 *
 * 弯的带子只能按弯的方式铺。人类伙伴放掉的那条约束是"制作特殊形状的时候,车辆可以摆
 * 成各个角度,不只局限于 45 度,保持足够间距就行":座位的朝向不再是一个全场常数(以及
 * 它的 90 度档),而是**每个座位按自己站的位置**算出来的。下游早就吃得下任意角度 ——
 * `level-gen.ts` 的 `HEADING_STEP` 量化的只是随机兜底播种,`peel` 给一块的是它自己的
 * 轴或者轴加 180。
 *
 * 度量仍然是自洽的,而这正是它跟 `latticeSeats` 里被否掉的"座位各取各的角度"的区别:
 * 圈距垂直于车身(按车**宽**),圈内步长平行于车身(按车**长**),只不过"垂直"和
 * "平行"现在是对着等高线说的,不是对着一个全场常数说的。一个座位的邻居仍然只有"同一
 * 圈的前后两辆"和"里外两圈的对位",三者用的是同一套度量。
 *
 * 契约与 `latticeSeats` 完全一样:返回的第 i 个座位就是 `bodies[i]` 的位置,铺不下的车
 * 不返回,数组因此可能比 `bodies` 短。
 */
export function contourSeats(
    shape: SkeletonShape, blocked: OBB[], w: number, h: number, gap: number,
    rng: () => number, cross: number, bodies: Body[],
): Seat[] {
    const seats: Seat[] = [];
    // 已经坐下的车身,只为了下面第四条剔除。座位的位置由圈和弧长定死,不受它影响。
    const placed: OBB[] = [];

    // 圈距按**最宽**的那辆车,与 `latticeSeats` 的 `pitch` 是同一个量、同一条理由:圈是
    // 沿着车宽一层层摞起来的,按别的车定都会让最宽的那辆压住里外两圈。
    let widest = 0;
    for (const b of bodies) if (b.wid > widest) widest = b.wid;
    const pitch = widest + gap;
    const jitter = gap * JITTER_F;

    // **两个半轴各自减 `pitch`,而不是整圈按一个归一化半径缩。** 这一条是量出来的,记在
    // 这里免得后人把它"简化"回去:同心椭圆若按比例缩(半轴同乘一个 t),相邻两圈的法向
    // 间距在短轴两端是 t 的差乘 w/2、在长轴两端是乘 h/2,8 x 12 上整整差 50% —— 短轴那端
    // 按 `pitch` 摆好,长轴那端就宽出半个车位,内圈与掩码内沿之间还剩一条 0.49 宽的空带,
    // 而那正是这次要消掉的楔形碎角换了个地方长出来。半轴各减一个 `pitch` 的那一族,法向
    // 间距处处是 `pitch`(两端精确,中间实测差 2%),`pitch` 这才真的是"圈距"。
    //
    // 代价是这一族的圈彼此不相似,所以内圈会从掩码内沿的短轴那头先穿出去。那不需要特殊
    // 处理:穿出去的座位由下面的中心点判据逐个剔掉,留下的是贴着内沿的两段弧,而它们填
    // 的正是"按比例缩"留下的那条空带。
    //
    // 最外圈往里缩半个车宽:相切的车横跨的是自己的车宽,圈心离场地边界留这么多,侧面才
    // 不出界。这是让最外圈不至于整圈被 `insideRect` 剔掉,不是保证 —— 车身仍旧逐个量。
    let ra = w / 2 - widest / 2;
    let rb = h / 2 - widest / 2;

    let k = 0;                        // 下一辆还没安置的车
    // 由外向内。外圈是形状的**轮廓**,玩家看见的就是它;车不够用的时候先把外圈坐满,
    // 形状还立得住,反过来先铺内圈就只剩一个断了轮廓的环。
    //
    // 收圈的判据:这一圈还有没有一点落在掩码里。只问两个轴端就够,不是偷懒 —— 圈上一点
    // 的归一化半径平方是 A cos²θ + B sin²θ(A、B 是两个轴端的值),它是两端的凸组合,所以
    // 两端都不在掩码里的时候整圈都不在。
    for (; k < bodies.length && ra > 0 && rb > 0
        && (inShape(shape, ra, 0, w, h) || inShape(shape, 0, rb, w, h));
        ra -= pitch, rb -= pitch) {
        // 每圈的起点随机转一个相位,免得每圈收尾留下的那点余量对成一条放射状的缝。
        // 点阵那边的整行错位(`stagger`)是同一件事。
        const start = rng() * 2 * Math.PI;
        const end = start + 2 * Math.PI;
        for (let th = start; k < bodies.length; ) {
            const b = bodies[k];
            // 这一抽必须**无条件**抽,而且抽在任何剔除之前,理由与 `latticeSeats` 里那段
            // 一字不差:`extent` 要用它,而 `th` 不论这个座位收不收都要按 `extent` 推进,
            // 于是座位的位置与 `cross` 无关,`cross` 才能当一个独立变量去标定。
            const turn = rng() < cross;
            // 横过来的车沿弧占的是车宽,车身则伸向半径方向 —— 点阵上 `CROSS` 买到的那点
            // 不规则,在这里就是"一圈切向车里混几辆头朝外的"。
            const extent = turn ? b.wid : b.len;
            // **按弧长走,不是按等角度走**(见 `arcStep`)。把椭圆近似成圆也是同一类错:
            // 8 x 12 上长短轴比 3:2,误差 50%,不是可以忽略的量级。
            const dth = arcStep(th, extent + gap, ra, rb);
            // 一整格(车身加一个 gap)在这一圈上放不下就收圈 —— 让最后一辆压到第一辆身上
            // 才是"绕回起点"该避免的事。抽签在上面已经抽过了,所以这个 break 不影响"座位
            // 位置与 `cross` 无关"这条性质。
            if (th + dth > end) break;
            // 车心落在光标往前半个车身的地方,与 `latticeSeats` 的 `u + extent / 2` 同构。
            const tc = th + arcStep(th, extent / 2, ra, rb);
            const cos = Math.cos(tc);
            const sin = Math.sin(tc);
            // 切线方向:dP/dθ = (-ra sinθ, rb cosθ)。
            const tan = Math.atan2(rb * cos, -ra * sin);
            // 抖动沿切向和法向各一次,与点阵的 u / v 逐项对应,量也一样(`JITTER_F`)。
            const js = (rng() - 0.5) * jitter;
            const jn = (rng() - 0.5) * jitter;
            const box: OBB = {
                x: ra * cos + Math.cos(tan) * js - Math.sin(tan) * jn,
                y: rb * sin + Math.sin(tan) * js + Math.cos(tan) * jn,
                angle: ((((tan * 180) / Math.PI + (turn ? 90 : 0)) % 360) + 360) % 360,
                len: b.len,
                wid: b.wid,
            };
            // 前三条剔除与 `latticeSeats` 同一套(那里写了为什么形状只问中心点,而场地和
            // `blocked` 要问整个车身)。
            //
            // 第四条是点阵没有的,而它不是保险起见:**直的车身摆在弯的圈上,两头会拱出
            // 圈外**。拱出的量是矢高 (len/2)² κ / 2,内圈长轴两端的曲率 κ 量到 0.655,大车
            // 就是 0.223 —— 比 `gap` 的 0.2 还大,于是里外两圈明明留够了 `pitch`,车角还是
            // 压在一起。点阵上这一项恒等于零(直的车身摆在直的行上),所以那边不需要这条。
            //
            // 剔掉而不是把圈距加厚:`pitch` 是标定过的一个量,为了两端偶尔一辆大车去加厚
            // 它,整条带子都会松一圈。让那辆车跳过这一格,下一格换一辆车再试。
            if (insideRect(box, w, h)
                && inShape(shape, box.x, box.y, w, h)
                && !blocked.some((r) => overlapMTV(box, r))
                && !placed.some((q) => overlapMTV(box, q))) {
                seats.push({ x: box.x, y: box.y, angle: box.angle });
                placed.push(box);
                k++;                  // 收下了才换下一辆
            }
            // 收不收都往前走一整格:跳过去,不贴着障碍蹭 —— 点阵那边实测过贴着蹭会铺得密
            // 到关系放松收敛不了,`pack` 返回 [],整关一辆车都生成不出来。
            th += dth;
        }
    }
    return seats;
}

/**
 * 这一关要的那批座位。**哪种形状用哪种铺法,只有这里说了算。**
 *
 * 分派放在本模块而不是 `pack()` 里,也不是塞进 `latticeSeats`,两头各有一个理由:
 *
 * 塞进 `latticeSeats` 会让那个名字变成假话 —— 它整片只有一个基准朝向,而那不是实现
 * 细节,是它的度量赖以成立的前提(见那里的注释),测试里有一条专门钉着它。donut 走
 * 进去会让那条断言变成"看情况",而一条看情况的不变式等于没有。
 *
 * 放在 `pack()` 里则会让**分派本身**没法测:要问"donut 到底有没有改用等高线",就只能
 * 去生成一整关。摆在这里,`pack()` 与测试走的是同一扇门,于是"donut 悄悄退回矩形点阵"
 * 这个失败模式是一条断言能直接咬住的事 —— 它正是本次改动的空转形态。
 */
export function seatsFor(
    shape: SkeletonShape, blocked: OBB[], w: number, h: number, gap: number,
    rng: () => number, cross: number, bodies: Body[],
): Seat[] {
    // 只有 `donut` 是弯的带子。其余四种形状裁矩形点阵不留楔形碎角,点阵一个字都不用动。
    return shape === 'donut'
        ? contourSeats(shape, blocked, w, h, gap, rng, cross, bodies)
        : latticeSeats(shape, blocked, w, h, gap, rng, cross, bodies);
}

/**
 * 同一批元素,顺序打散。用传入的 `rng`,所以同一个种子出同一个顺序。
 *
 * 存在的理由在 `pack()` 的调用点:那里的车按车长从大到小排过序,而点阵是一行一行
 * 生成的,顺次取用会把大车全堆在场地的一头——一个随机播种从来没有的尺寸分层。
 */
export function shuffled<T>(items: T[], rng: () => number): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
    }
    return out;
}
