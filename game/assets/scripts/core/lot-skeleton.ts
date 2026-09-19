import { OBB, overlapMTV } from './geometry';

/**
 * 车道宽度。
 *
 * 不由 `fillableHoles` 决定,由观感决定,而这一点是反直觉的:任何能开车的车道都
 * 能停车。`fillableHoles` 试 0/45/90/135 四个角度,所以车是顺着车道停进去的,绑定
 * 的是车宽不是车长——大车含留白 0.624 宽,车道只要宽过 0.624 就会被整条数成一串
 * `big` 洞,而 0.624 比一辆车还窄,那是条缝不是路。
 *
 * 所以洞在骨架之外量(`fillableHoles` 的 exclude 参数),车道宽度取能读成一条路的
 * 最小值:0.8,约 1.5 倍车宽,3 倍于 `GAP` 的 0.25。
 */
export const LANE_W = 0.8;

export type SkeletonShape = 'none' | 'spine' | 'cross' | 'ring' | 'star';

/**
 * 每关一行,与 `TRACK_CURVE` / `TUNNEL_CURVE` / `BAND_CURVE` 同构,向两端钳制。
 *
 * 前两关无骨架:第 1 关是手写教学关,第 2 关是颜色刚够咬人的那一关,两关都不该再
 * 多一层结构要读。
 */
const SHAPE_CURVE: readonly SkeletonShape[] = [
    'none',   // 1  手写教学关,根本不走打包器
    'none',   // 2  第一关有难度的,先不加结构
    'spine',  // 3
    'spine',  // 4
    'cross',  // 5
    'ring',   // 6
    'ring',   // 7
    'ring',   // 8
    'star',   // 9  斜向车道从这里开始
    'star',   // 10
];

export function skeletonShape(id: number): SkeletonShape {
    const i = Math.min(Math.max(1, Math.trunc(id)), SHAPE_CURVE.length) - 1;
    return SHAPE_CURVE[i];
}

/** 一条车道:沿 `angle` 方向长 `len`,宽 `LANE_W`,中心在 (x, y)。 */
function lane(x: number, y: number, angle: number, len: number): OBB {
    return { x, y, angle, len, wid: LANE_W };
}

/**
 * 这个形状的车道,在一个 w x h 的场地里。
 *
 * 场地尺寸是参数而不是 import:`LOT` 住在 `level-gen.ts` 里,而 `level-gen.ts` 要
 * import 本模块,反向 import 会成环。
 */
export function skeletonLanes(shape: SkeletonShape, w: number, h: number): OBB[] {
    switch (shape) {
        case 'none':
            return [];
        // 一条纵贯车道,居中。
        case 'spine':
            return [lane(0, 0, 90, h)];
        // 纵横各一,十字。
        case 'cross':
            return [lane(0, 0, 90, h), lane(0, 0, 0, w)];
        // 回字:一圈矩形环,离边 1/4 处。上下两条横的,左右两条竖的。
        case 'ring': {
            const dx = w / 4;
            const dy = h / 4;
            return [
                lane(0, dy, 0, w / 2),
                lane(0, -dy, 0, w / 2),
                lane(-dx, 0, 90, h / 2),
                lane(dx, 0, 90, h / 2),
            ];
        }
        // 米字:纵横各一,再加两条对角。对角长度取场地对角线的一半,免得伸出去。
        case 'star': {
            const diag = Math.hypot(w, h) / 2;
            return [
                lane(0, 0, 90, h),
                lane(0, 0, 0, w),
                lane(0, 0, 45, diag),
                lane(0, 0, 135, diag),
            ];
        }
    }
}

/**
 * 座位抖动占 `gap` 的比例。
 *
 * 本设计选定的结构强度是"弱"(松散格子 + 主车道):要的是有秩序但不刻板,不是几何
 * 图案。抖动是刻意的,不是噪声。半个 gap 是上限——再大就会吃掉行距,让"间距均匀"
 * 这条要求失效。
 */
const JITTER_F = 0.5;

/**
 * 把车摆成沿车道方向的松散行列,返回每个座位的位置和朝向。
 *
 * 这是本设计的要害。`pack()` 原本均匀随机撒点,所以**空隙尺寸也是随机的**——大多
 * 数缝很窄,偶尔留下一块车形空地,而排名只能在候选里挑最不烂的一个,造不出一个从
 * 未出现过的整齐打包。点阵的空隙是设计出来的尺寸。
 *
 * 点阵的基准方向只有一个,取自骨架的第一条车道,没有车道时朝上——见 `latticeAngle`,
 * 那里写了为什么不能按座位各取最近的车道。自由角度没有作废,只是从随机取八向之一
 * 变成跟着骨架取向。
 *
 * `cross` 是在这个基准方向之上横过来的座位比例:0 全场同向,1 全场转 90 度,中间
 * 是比例。它调的是难度不是观感,理由写在 `level-gen.ts` 的 `CROSS` 上。
 */
export function latticeSeats(
    lanes: OBB[], w: number, h: number, gap: number, rowPitch: number, rng: () => number,
    cross: number,
): { x: number; y: number; angle: number }[] {
    const seats: { x: number; y: number; angle: number }[] = [];
    const angle = latticeAngle(lanes);
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const pitch = rowPitch + gap;     // 垂直于车身:按车宽
    const along = 1.0 + gap;          // 平行于车身:按最常见的小车身长 0.887 向上取整到 1.0
    const jitter = gap * JITTER_F;

    // `u` 沿车身方向,`v` 垂直于它。点阵在 (u, v) 里是规整的,再旋到场地坐标系 ——
    // 直接在 x/y 上排而让车斜着或竖着躺,就是把车长放在按车宽算出的间距上。
    //
    // 扫描范围取场地对角线的一半:场地四角到原点正是这个距离,所以旋到任何角度都还
    // 够得着。落在场地外的座位在下面逐个剔除,多扫一些只是浪费几次循环。
    //
    // 这是余量,不是保证,差别在整行错位——它把一行的起点最多右移 `along / 2`,负 u
    // 那一端就少扫这么多。算过:reach = 7.2111,角度 90 下需要覆盖 h/2 = 6,余量
    // 1.2111;测试扫到的最大 gap 0.45 只吃掉 0.725。gap 大到 1.4222 才会真的漏一条,
    // 远在本设计的标定范围之外。
    const reach = Math.hypot(w, h) / 2;
    for (let v = -reach; v <= reach; v += pitch) {
        // 整行错位,让相邻两行不是一把梳子。
        const stagger = rng() < 0.5 ? 0 : along / 2;
        for (let u = -reach + stagger; u <= reach; u += along) {
            const ju = u + (rng() - 0.5) * jitter;
            const jv = v + (rng() - 0.5) * jitter;
            // 这一抽无条件抽,且抽在两条剔除之前:座位位置因此与 `cross` 完全无关,
            // 两个 cross 值跑出来的点阵逐点重合,标定时才是单变量比较。挪到剔除之后、
            // 或者用 `cross > 0 &&` 短路掉,都会让 rng 流随 cross 变化而错位。
            const turn = rng() < cross;
            const sx = ju * cos - jv * sin;
            const sy = ju * sin + jv * cos;
            if (Math.abs(sx) > w / 2 || Math.abs(sy) > h / 2) continue;
            const dot: OBB = { x: sx, y: sy, angle: 0, len: 1e-6, wid: 1e-6 };
            if (lanes.some((l) => overlapMTV(dot, l))) continue;
            seats.push({ x: sx, y: sy, angle: turn ? (angle + 90) % 360 : angle });
        }
    }
    return seats;
}

/**
 * 整片点阵的方向:骨架第一条车道的角度,没有车道就朝上。
 *
 * 一个角度而不是每个座位各自取最近的车道,而这一条是本模块最容易写错的地方。行距
 * 垂直于车身、行内步长平行于车身——两者都是按"车朝哪边"算出来的。座位各取各的角度,
 * 整片点阵就没有一套自洽的度量了:一个座位的车身长边(大车 1.650)会落在邻座按车宽
 * (0.524)算出来的行距上,成片重叠,全部丢给关系放松去救,点阵播种的意义当场归零。
 *
 * 方向仍然只有一个,但"全场车身平行"这个代价是实测证伪的:第 2 关量到 `rounds` 从
 * 17 塌到 10,一行策略就能赢——它不是观感问题,是难度问题。所以 `latticeSeats` 的
 * `cross` 在这一个方向之上再混入垂直的一档。这跟上一段不是一回事:度量还是这一个
 * 方向算出来的,只有少数座位转 90 度,它们挤开邻座是有数的局部代价,关系放松吃得下,
 * 而那正是难度要的不规则。让每个座位各取最近的车道那条路仍然是错的,理由不变。
 */
function latticeAngle(lanes: OBB[]): number {
    return lanes.length === 0 ? 90 : lanes[0].angle;
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
