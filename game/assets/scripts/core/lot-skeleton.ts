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
 * 行的方向取自**最近的那条车道**,所以回字的四个区块各自沿着自己那条边排,米字的
 * 斜向区块跟着 45 度走——自由角度没有作废,只是从随机取八向之一变成跟着骨架取向。
 * 没有车道时(前两关)全场一个方向。
 */
export function latticeSeats(
    lanes: OBB[], w: number, h: number, gap: number, rowPitch: number, rng: () => number,
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
    // 扫描范围取场地对角线的一半,保证旋转后仍覆盖整块场地;落在场地外的座位在下面
    // 逐个剔除,所以多扫一些只是浪费几次循环。
    const reach = Math.hypot(w, h) / 2;
    for (let v = -reach; v <= reach; v += pitch) {
        // 整行错位,让相邻两行不是一把梳子。
        const stagger = rng() < 0.5 ? 0 : along / 2;
        for (let u = -reach + stagger; u <= reach; u += along) {
            const ju = u + (rng() - 0.5) * jitter;
            const jv = v + (rng() - 0.5) * jitter;
            const sx = ju * cos - jv * sin;
            const sy = ju * sin + jv * cos;
            if (Math.abs(sx) > w / 2 || Math.abs(sy) > h / 2) continue;
            const dot: OBB = { x: sx, y: sy, angle: 0, len: 1e-6, wid: 1e-6 };
            if (lanes.some((l) => overlapMTV(dot, l))) continue;
            seats.push({ x: sx, y: sy, angle });
        }
    }
    return seats;
}

/**
 * 整片点阵的方向:骨架第一条车道的角度,没有车道就朝上。
 *
 * 一个角度而不是每个座位各自取最近的车道,而这一条是本模块最容易写错的地方。行距
 * 垂直于车身、行内步长平行于车身——两者都是按"车朝哪边"算出来的。让一部分座位横
 * 过来,它们的车身长边(大车 1.650)就会落在按车宽(0.524)算出来的行距上,重叠一大
 * 片,然后全部丢给关系放松去救,点阵播种的意义当场归零。
 *
 * 代价是全场车身平行。参考图 2 里大部分车本来就是同向的,所以这大概率不是问题;
 * 真觉得太规整时,要改的是给每个区块各建一套点阵,而不是在这里放宽。
 */
function latticeAngle(lanes: OBB[]): number {
    return lanes.length === 0 ? 90 : lanes[0].angle;
}
