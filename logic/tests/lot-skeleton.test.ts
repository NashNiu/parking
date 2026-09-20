import { skeletonShape, inShape, SkeletonShape, latticeSeats, contourSeats, seatsFor, shuffled, Body } from '../../game/assets/scripts/core/lot-skeleton';
import { OBB, overlapMTV, insideRect } from '../../game/assets/scripts/core/geometry';
import { GAP, CROSS, mulberry32 } from '../../game/assets/scripts/core/level-gen';
import { CAP_BOX, CAR_SCALE, Cap } from '../../game/assets/scripts/core/types';

const W = 8, H = 12;

/** 曲线上的五种形状,按 `SHAPE_CURVE` 的顺序(座位数从多到少)。 */
const SHAPES: SkeletonShape[] = ['full', 'ellipse', 'donut', 'plus', 'diamond'];

function seedRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('骨架曲线是每关一行,并且向两端钳制', () => {
  const got = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(skeletonShape);
  // 坡度是 满 → 椭圆 → 回字 → 十字 → 菱形,每种两关。前两关不加形状:第 1 关是手写
  // 教学关,第 2 关是颜色刚够咬人的那一关。
  expect(got).toEqual([
    'full', 'full', 'ellipse', 'ellipse', 'donut',
    'donut', 'plus', 'plus', 'diamond', 'diamond',
  ]);
  // 钳制:表外的 id 落在两端,而不是抛错或给 undefined
  expect(skeletonShape(0)).toBe('full');
  expect(skeletonShape(-5)).toBe('full');
  expect(skeletonShape(11)).toBe('diamond');
  expect(skeletonShape(200)).toBe('diamond');
  expect(skeletonShape(4.5)).toBe('ellipse');   // 截断到 4
});

test('判据认得场地的四角和正中,而且五种形状的答案各不相同', () => {
  // 归一化之后场地的角就是 (±1, ±1),正中是 (0, 0) —— 两个点就能把五种形状分开。
  const corner = SHAPES.map((s) => inShape(s, W / 2, H / 2, W, H));
  expect(corner).toEqual([true, false, false, false, false]);
  const middle = SHAPES.map((s) => inShape(s, 0, 0, W, H));
  // 回字的正中是空的,这就是它的洞。
  expect(middle).toEqual([true, true, false, true, true]);
  // 十字的两条臂:x 上的半宽 0.38 收 1.4(nx = 0.35)不收 1.6(nx = 0.4);y 上的
  // 半宽 0.30 收 1.7(ny = 0.283)不收 1.9(ny = 0.317)。两条臂各自成立,所以
  // 判据里的 `||` 不能写成 `&&`。
  expect(inShape('plus', 1.4, H / 2, W, H)).toBe(true);
  expect(inShape('plus', 1.6, H / 2, W, H)).toBe(false);
  expect(inShape('plus', W / 2, 1.7, W, H)).toBe(true);
  expect(inShape('plus', W / 2, 1.9, W, H)).toBe(false);
  // 归一化真的跟着场地走:同一个点在一个瘦场地里落在椭圆外,在宽场地里落在里面。
  expect(inShape('ellipse', 3.9, 0, W, H)).toBe(true);
  expect(inShape('ellipse', 3.9, 0, 4, H)).toBe(false);
});

/**
 * 三种车身,已经乘过 `CAR_SCALE`(见 `types.ts` 的 `CAP_BOX` 与 `CAR_SCALE`)。
 *
 * 这两个数就是点阵存在的理由:一个均匀点阵没法同时服务 0.887 和 1.650 两种车长。
 */
const SMALL: Body = { len: 0.887, wid: 0.433 };
const BIG: Body = { len: 1.650, wid: 0.524 };

function same(n: number, b: Body): Body[] {
  return Array.from({ length: n }, () => b);
}

function boxOf(s: { x: number; y: number; angle: number }, b: Body): OBB {
  return { x: s.x, y: s.y, angle: s.angle, len: b.len, wid: b.wid };
}

/**
 * `pack()` 交给 `latticeSeats` 的那一批车身,照搬它的做法:按 CAP_MIX 抽,按车长排序,
 * 再洗牌(见 `pack` 里为什么要洗)。
 *
 * 200 辆而不是一关的 89 辆:量的是**座位供给**,一关的车数会把 `full` 截在 89 上,
 * 五种形状里最满的那一种就再也分不出高低了。
 */
const MIX: { cap: Cap; weight: number }[] = [
  { cap: 'small', weight: 0.55 }, { cap: 'medium', weight: 0.25 }, { cap: 'big', weight: 0.2 },
];

function mixBodies(rng: () => number, n: number): Body[] {
  const caps: Cap[] = [];
  for (let i = 0; i < n; i++) {
    let r = rng();
    let pick: Cap = 'big';
    for (const { cap, weight } of MIX) { if (r < weight) { pick = cap; break; } r -= weight; }
    caps.push(pick);
  }
  caps.sort((a, b) => CAP_BOX[b].len - CAP_BOX[a].len);
  return shuffled(caps, rng).map((c) => ({
    len: CAP_BOX[c].len * CAR_SCALE, wid: CAP_BOX[c].wid * CAR_SCALE,
  }));
}

/** 一种形状在出货参数下的座位数,8 个种子的平均。 */
function seatSupply(shape: SkeletonShape): number {
  let total = 0;
  for (let s = 0; s < 8; s++) {
    const rng = mulberry32(s * 7919);
    total += latticeSeats(shape, [], W, H, GAP, rng, CROSS, mixBodies(rng, 200)).length;
  }
  return total / 8;
}

test('每种形状坐得下的车数落在实测的带子里', () => {
  // 锚是人类伙伴量的那一组(出货的 `GAP` 0.20,8 个种子,按 CAP_MIX 抽的车身):
  //
  //     full 93   ellipse 79   donut 62   plus 58   diamond 51
  //
  // 本文件重量了一遍,逐格吻合到一两辆之内(均值 92.4 / 79.8 / 62.4 / 59.9 / 52.6,
  // 单个种子的跨度 89-100 / 75-86 / 60-66 / 56-63 / 49-56)。
  //
  // **钉的是带子不是值**,因为这是一个随机布局的输出:座位数随种子在十辆车的范围内
  // 晃,钉死任何一个数都会在下一次改种子、改抽签顺序时无故变红。±20% 是观测到的最
  // 大偏离(full 的 100 对 93,+7.5%)的两倍还多,而它仍然咬得住这条带子该咬的东西:
  // 五种形状的带子两两不交的那几对(见下面的次序链),以及"形状被忽略了"——任何一种
  // 形状退化成 `full` 都会把它自己的上界顶穿。
  const ANCHOR: Record<SkeletonShape, number> = {
    full: 93, ellipse: 79, donut: 62, plus: 58, diamond: 51,
  };
  const got: Record<string, number> = {};
  for (const shape of SHAPES) {
    const n = seatSupply(shape);
    got[shape] = n;
    expect({ shape, n, low: n >= ANCHOR[shape] * 0.8, high: n <= ANCHOR[shape] * 1.2 })
      .toEqual({ shape, n, low: true, high: true });
  }
  // 次序链。带子彼此有重叠(donut 62 与 plus 58 只差 6%,任何有用的带子都会盖住这
  // 一对),所以形状之间"越瘦坐得越少"这件事要单独钉一次。`donut` 与 `plus` 故意不
  // 互相比较:它们的均值只差 2.5 辆,那是种子的噪声量级。
  expect(got.full).toBeGreaterThan(got.ellipse);
  expect(got.ellipse).toBeGreaterThan(got.donut);
  expect(got.ellipse).toBeGreaterThan(got.plus);
  expect(got.donut).toBeGreaterThan(got.diamond);
  expect(got.plus).toBeGreaterThan(got.diamond);
});

test('每个座位的中心都在它的形状里,而 full 的座位确实落在别的形状之外', () => {
  const bodies = same(200, SMALL);
  const seated: Record<string, number> = {};
  for (const shape of SHAPES) {
    const seats = latticeSeats(shape, [], W, H, 0.25, seedRng(7), 0, bodies);
    seated[shape] = seats.length;
    expect(seats.length).toBeGreaterThan(20);   // 不能靠一个座位都不铺来通过
    for (const s of seats) {
      expect({ shape, inside: inShape(shape, s.x, s.y, W, H) }).toEqual({ shape, inside: true });
    }
  }
  // 对照组:把判据 stub 成 `return true`,上面那一圈照样全绿 —— 所以这里再问一次
  // 反面。同一个种子、同一批车身,`full` 铺出来的座位里必须有一批落在菱形之外;
  // 菱形只盖住场地的一半,所以这个数应当是**一大批**,不是个别几个。
  const full = latticeSeats('full', [], W, H, 0.25, seedRng(7), 0, bodies);
  const outside = full.filter((s) => !inShape('diamond', s.x, s.y, W, H)).length;
  expect(outside).toBeGreaterThan(full.length * 0.2);
  // 同一件事的另一面:形状确实把座位挡掉了,不是"挡是挡了但一个没挡住"。
  expect(seated.diamond).toBeLessThan(seated.full * 0.8);
});

test('回字中间真的是空的,而同一个种子的 full 会往那里停车', () => {
  const bodies = same(200, SMALL);
  // 归一化半径的平方,与 `inShape` 的 `donut` 分支用的是同一个量。
  const r2 = (s: { x: number; y: number }) => (s.x / (W / 2)) ** 2 + (s.y / (H / 2)) ** 2;
  const donut = latticeSeats('donut', [], W, H, 0.25, seedRng(13), 0, bodies);
  expect(donut.length).toBeGreaterThan(20);
  expect(donut.filter((s) => r2(s) < 0.20)).toEqual([]);
  // 洞里本来是**坐得下**车的 —— 不问这一句,一个把内圈铺得满满当当却恰好没有座位
  // 落进去的实现也能过,而洞是不是真的空着就没人看了。
  const full = latticeSeats('full', [], W, H, 0.25, seedRng(13), 0, bodies);
  expect(full.filter((s) => r2(s) < 0.20).length).toBeGreaterThan(5);
});

test('座位落在场地内,并且是确定的', () => {
  const bodies = same(200, SMALL);
  const a = latticeSeats('full', [], W, H, 0.25, seedRng(7), 0, bodies);
  const b = latticeSeats('full', [], W, H, 0.25, seedRng(7), 0, bodies);
  expect(a).toEqual(b);
  expect(a.length).toBeGreaterThan(20);
  for (const s of a) {
    expect(Math.abs(s.x)).toBeLessThanOrEqual(W / 2);
    expect(Math.abs(s.y)).toBeLessThanOrEqual(H / 2);
  }
});

test('整片点阵只有一个基准朝向', () => {
  // 钉的是"一个",不是"90"。车道没有了之后 90 是个常数(见 `latticeSeats` 里那段
  // 注释:行距和行内步长都按同一个方向算,座位各取各的角度就没有自洽的度量了),
  // 所以这条断言故意不去验证那个常数是多少 —— 它验证的是不会冒出第二个。横过来的
  // 那一档是 `cross` 在它之上混的,这里把 `cross` 钉在 0。
  const bodies = same(200, SMALL);
  for (const shape of SHAPES) {
    const seats = latticeSeats(shape, [], W, H, 0.25, seedRng(2), 0, bodies);
    expect({ shape, angles: new Set(seats.map((s) => s.angle)).size }).toEqual({ shape, angles: 1 });
  }
});

// 这条是点阵存在的理由:旧实现步长写死 1.25,两辆大车中心只隔 1.25,必然重叠。
test('同一行里相邻两辆车不重叠,大车也不重叠', () => {
  const bodies = same(60, BIG);
  const seats = latticeSeats('full', [], W, H, 0.25, seedRng(3), 0, bodies);
  expect(seats.length).toBeGreaterThan(20);
  const boxes = seats.map((s, i) => boxOf(s, bodies[i]));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(overlapMTV(boxes[i], boxes[j])).toBeFalsy();
    }
  }
});

// 步长真的跟着车走:同样的场地,全小车能铺下的数量必须明显多于全大车。
test('步长按车长,所以小车铺得比大车多', () => {
  const small = latticeSeats('full', [], W, H, 0.25, seedRng(3), 0, same(200, SMALL)).length;
  const big = latticeSeats('full', [], W, H, 0.25, seedRng(3), 0, same(200, BIG)).length;
  expect(small).toBeGreaterThan(big * 1.4);
});

// 车身整个在场地内,不只是中心点在。形状的判据只问中心点(车身可以探出形状),场地
// 边界不是 —— 两者不同,而这条守的是后者。
test('车身不许探出场地', () => {
  const bodies = Array.from({ length: 200 }, (_, i) => (i % 2 ? SMALL : BIG));
  const seats = latticeSeats('diamond', [], W, H, 0.25, seedRng(5), 0.3, bodies);
  expect(seats.length).toBeGreaterThan(20);
  seats.forEach((s, i) => {
    expect(insideRect(boxOf(s, bodies[i]), W, H)).toBe(true);
  });
});

// 车身不许压进 `blocked` —— 中心点避开是不够的,这正是 Task 4 那个 Critical 的形状。
// 真实调用方传进来的是隧道保留区加它的出口走廊,这里拿两块等价的矩形代替。
test('车身不许压进不能压的地方', () => {
  const blocked: OBB[] = [
    { x: -1.5, y: 2, angle: 0, len: 3, wid: 1.2 },
    { x: 2, y: -3, angle: 90, len: 4, wid: 1.0 },
  ];
  const bodies = same(200, BIG);
  const seats = latticeSeats('full', blocked, W, H, 0.25, seedRng(7), 0, bodies);
  expect(seats.length).toBeGreaterThan(20);      // 不能靠一个都不铺来通过
  seats.forEach((s, i) => {
    for (const r of blocked) {
      expect(overlapMTV(boxOf(s, bodies[i]), r)).toBeFalsy();
    }
  });
  // `blocked` 真的挡掉了东西 —— 否则上面那一圈只是在空转。
  const bare = latticeSeats('full', [], W, H, 0.25, seedRng(7), 0, bodies);
  expect(seats.length).toBeLessThan(bare.length);
  expect(bare.some((s, i) => blocked.some((r) => overlapMTV(boxOf(s, bodies[i]), r)))).toBe(true);
});

// 铺不下的车不返回,而且返回的是前缀对应关系:第 i 个座位属于第 i 辆车。
test('返回数组与入参逐位对应,铺不下的不返回', () => {
  const bodies = same(400, BIG);   // 远多于场地能放的
  const seats = latticeSeats('full', [], W, H, 0.25, seedRng(9), 0, bodies);
  expect(seats.length).toBeLessThan(bodies.length);
  expect(seats.length).toBeGreaterThan(20);
});

test('间距越大,座位越少——这是密度旋钮', () => {
  const bodies = same(300, SMALL);
  const tight = latticeSeats('full', [], W, H, 0.15, seedRng(3), 0, bodies).length;
  const loose = latticeSeats('full', [], W, H, 0.45, seedRng(3), 0, bodies).length;
  expect(loose).toBeLessThan(tight);
});

test('cross = 1 时每个座位都横过来,cross = 0 时一个都不横', () => {
  const bodies = same(200, SMALL);
  const up = latticeSeats('full', [], W, H, 0.25, seedRng(9), 0, bodies);
  const across = latticeSeats('full', [], W, H, 0.25, seedRng(9), 1, bodies);
  expect(up.length).toBeGreaterThan(20);
  expect(across.length).toBeGreaterThan(20);
  expect(new Set(up.map((s) => s.angle))).toEqual(new Set([90]));
  expect(new Set(across.map((s) => s.angle))).toEqual(new Set([180]));
});

// `cross` 那一抽是**无条件**的,而这条不变式还剩一个看得见的地方:车身是正方形时,
// 横过来既不改变它沿行方向占的长度,也不改变它盖住的那块地,于是位置逐点重合。写成
// `cross > 0 && rng() < cross` 会短路掉 cross = 0 那一抽,rng 流整体错位,这条立刻红。
test('cross 那一抽是无条件的:方形车身下两档位置逐点重合', () => {
  const square = same(300, { len: 0.6, wid: 0.6 });
  const up = latticeSeats('full', [], W, H, 0.25, seedRng(9), 0, square);
  const across = latticeSeats('full', [], W, H, 0.25, seedRng(9), 1, square);
  expect(up.length).toBeGreaterThan(20);
  expect(across.map((s) => ({ x: s.x, y: s.y }))).toEqual(up.map((s) => ({ x: s.x, y: s.y })));
  expect(new Set(up.map((s) => s.angle))).toEqual(new Set([90]));
  expect(new Set(across.map((s) => s.angle))).toEqual(new Set([180]));
});

// 上面那条的反面,免得后人把"位置逐点重合"推广回去:车身不是方的,横过来就真的挪动
// 了它后面的车。它咬住的是"`turn` 真的进了 `extent`"。
test('车身不是方的时候,横过来会挪动它后面的车', () => {
  const bodies = same(200, BIG);
  const up = latticeSeats('full', [], W, H, 0.25, seedRng(9), 0, bodies);
  const across = latticeSeats('full', [], W, H, 0.25, seedRng(9), 1, bodies);
  expect(across.map((s) => ({ x: s.x, y: s.y }))).not.toEqual(up.map((s) => ({ x: s.x, y: s.y })));
});

test('中间档位是个比例,不是开关', () => {
  const bodies = same(300, SMALL);
  const some = latticeSeats('full', [], W, H, 0.25, seedRng(9), 0.3, bodies);
  const turned = some.filter((s) => s.angle === 180).length / some.length;
  expect(turned).toBeGreaterThan(0.15);
  expect(turned).toBeLessThan(0.45);
});

// 三条断言各挡一种坏实现:不是排列(漏元素/改元素)、原样返回(洗了个寂寞)、
// 不确定(同种子两次不一样,关卡生成就不可复现了)。
test('洗牌是同一批元素换个顺序,而且确实换了', () => {
  const items = Array.from({ length: 200 }, (_, i) => i);
  const a = shuffled(items, seedRng(4));
  expect([...a].sort((x, y) => x - y)).toEqual(items);
  expect(a).not.toEqual(items);
  expect(shuffled(items, seedRng(4))).toEqual(a);
});

describe('contourSeats —— 沿轮廓铺的那一族', () => {
  const bodies = (n: number) => mixBodies(seedRng(5), n);

  // 这条是本功能唯一值得担心的失败方式:甜甜圈悄悄退回用矩形点阵。那种失败在生成表格
  // 上几乎看不出来(洞只多一点),只有角度能出卖它 —— 点阵全场一个朝向(加上 CROSS
  // 混进来的垂直那一档,至多两种),而沿轮廓铺的车每辆都贴着自己那一点的切线。
  test('甜甜圈的车朝向各不相同,点阵形状至多两种', () => {
    // **走 `seatsFor`,不是直接叫 `contourSeats`。** 分派本身才是这次改动会空转的地方:
    // 直接调等高线函数只能证明"那个函数是对的",证不了"甜甜圈真的用了它"。第一版就是
    // 这么写的,于是把派发点改回点阵之后 22 条测试全绿 —— 门留好了,我绕过去了。
    const ring = seatsFor('donut', [], W, H, GAP, seedRng(7), 0, bodies(200));
    const grid = seatsFor('diamond', [], W, H, GAP, seedRng(7), 0, bodies(200));
    const round1 = (a: number) => Math.round(a);
    expect(new Set(grid.map((s) => round1(s.angle))).size).toBeLessThanOrEqual(2);
    // 实测 40 辆车取到 30 个不同的整度数。断言 10,留足余量:圈数、抖动和车长分布都会
    // 影响这个数,而"退回点阵"会把它打到 1 或 2,离 10 远得很。
    expect(new Set(ring.map((s) => round1(s.angle))).size).toBeGreaterThan(10);
  });

  // 角度对不对,不看"有多少种",看每辆车是不是真的贴着它所在那一点的切线。椭圆在
  // (x, y) 处的切线方向是 atan2(y / rb^2 * ... ) —— 这里直接用参数化:一个点若在
  // 半轴 (ra, rb) 的椭圆上,它的参数角 t 满足 cos t = x / ra、sin t = y / rb,切线
  // 方向就是 atan2(rb cos t, -ra sin t)。ra / rb 未知,但**比值**可由点本身定出来。
  test('每辆车贴着它自己那一点的切线,而不是某个写死的角度', () => {
    const seats = seatsFor('donut', [], W, H, GAP, seedRng(11), 0, bodies(200));
    expect(seats.length).toBeGreaterThan(20);
    let worst = 0;
    for (const s of seats) {
      // 该点所在等距圈的半轴:两个半轴各减同一个量 k,所以 k 由该点反解。
      // (x/(W/2-k))^2 + (y/(H/2-k))^2 = 1 —— 用二分法解 k,再取切线。
      let lo = 0, hi = W / 2 - 1e-6;
      for (let i = 0; i < 60; i++) {
        const k = (lo + hi) / 2;
        const ra = W / 2 - k, rb = H / 2 - k;
        const v = (s.x / ra) ** 2 + (s.y / rb) ** 2;
        // v(k) 随 k 单调增(半轴变小,同一个点相对越靠外),所以 v > 1 说明 k 取大了。
        if (v > 1) hi = k; else lo = k;
      }
      const k = (lo + hi) / 2;
      const ra = W / 2 - k, rb = H / 2 - k;
      const t = Math.atan2(s.y / rb, s.x / ra);
      const tan = (Math.atan2(rb * Math.cos(t), -ra * Math.sin(t)) * 180) / Math.PI;
      // 车身是条线段,掉头 180 度是同一个姿势,所以误差取模 180。
      let d = Math.abs(((s.angle - tan) % 180 + 180) % 180);
      if (d > 90) d = 180 - d;
      worst = Math.max(worst, d);
    }
    // 实测最差 3.69 度,来自抖动:抖动把车心挪出它下笔时那一圈,于是这里反解出来的
    // 圈和当时那一圈不完全是同一个,切线方向就差了一点。断言 15 度,四倍余量 —— 而
    // 退回点阵会让最差值跳到 83 度(我改坏之后量的),离 15 远得很。
    expect(worst).toBeLessThan(15);
  });

  test('圈与圈、车与车都不叠', () => {
    const bs = bodies(200);
    const seats = contourSeats('donut', [], W, H, GAP, seedRng(3), 0, bs);
    expect(seats.length).toBeGreaterThan(20);
    const boxes: OBB[] = seats.map((s, i) => ({ ...s, len: bs[i].len, wid: bs[i].wid }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlapMTV(boxes[i], boxes[j])).toBeFalsy();
      }
    }
  });

  test('中间那个洞是空的,而同一个种子的满场会往里坐', () => {
    const seats = contourSeats('donut', [], W, H, GAP, seedRng(9), 0, bodies(200));
    const inHole = (s: { x: number; y: number }) => (s.x / (W / 2)) ** 2 + (s.y / (H / 2)) ** 2 < 0.20;
    expect(seats.filter(inHole).length).toBe(0);
    const full = latticeSeats('full', [], W, H, GAP, seedRng(9), 0, bodies(200));
    expect(full.filter(inHole).length).toBeGreaterThan(5);
  });
});
