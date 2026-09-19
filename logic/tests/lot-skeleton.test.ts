import { skeletonShape, skeletonLanes, LANE_W, SkeletonShape, latticeSeats, shuffled, Body } from '../../game/assets/scripts/core/lot-skeleton';
import { OBB, overlapMTV, insideRect } from '../../game/assets/scripts/core/geometry';

const W = 8, H = 12;

function seedRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('第 1 关没有骨架,它是手写的教学关', () => {
  expect(skeletonShape(1)).toBe('none');
  expect(skeletonLanes('none', W, H)).toEqual([]);
});

test('骨架曲线是每关一行,并且向两端钳制', () => {
  const got = [1,2,3,4,5,6,7,8,9,10].map(skeletonShape);
  // 坡度是 无 → 一条主道 → 十字 → 米字。`ring` 不在曲线上,理由写在 SHAPE_CURVE
  // 下面:它在 8 x 12 上只坐得下三十几辆车,排除车道后仍留 14 个大洞,而不留大块
  // 空白正是这套设计要解决的要求。它的几何没删,随时可以回来。
  expect(got).toEqual([
    'none', 'none', 'spine', 'spine', 'cross',
    'cross', 'cross', 'star', 'star', 'star',
  ]);
  expect(got).not.toContain('ring');
  // 钳制:表外的 id 落在两端,而不是抛错或给 undefined
  expect(skeletonShape(0)).toBe('none');
  expect(skeletonShape(-5)).toBe('none');
  expect(skeletonShape(11)).toBe('star');
  expect(skeletonShape(200)).toBe('star');
  expect(skeletonShape(4.5)).toBe('spine');   // 截断到 4
});

test('每种形状的车道数是它的名字所说的那个数', () => {
  const count: Record<SkeletonShape, number> = {
    none: 0, spine: 1, cross: 2, ring: 4, star: 4,
  };
  for (const shape of Object.keys(count) as SkeletonShape[]) {
    expect(skeletonLanes(shape, W, H)).toHaveLength(count[shape]);
  }
});

test('每条车道都在场地内,宽度都是 LANE_W', () => {
  // 半展长而不是外接半径。外接半径版本两边同时含 r,化简后是 |lane.x| <= W/2,
  // 而所有车道中心都在 {0, ±w/4} 上,恒成立——那个断言看起来像包含性检查,其实
  // 什么都没查。
  //
  // `<=` 而不是 `<`:spine 与 cross 的车道长度就等于场地边长,它们正好贴边,这是
  // 对的。
  const EPS = 1e-9;
  for (const shape of ['spine', 'cross', 'ring', 'star'] as SkeletonShape[]) {
    for (const lane of skeletonLanes(shape, W, H)) {
      expect(lane.wid).toBe(LANE_W);
      const rad = (lane.angle * Math.PI) / 180;
      const ex = (lane.len * Math.abs(Math.cos(rad)) + lane.wid * Math.abs(Math.sin(rad))) / 2;
      const ey = (lane.len * Math.abs(Math.sin(rad)) + lane.wid * Math.abs(Math.cos(rad))) / 2;
      expect(Math.abs(lane.x) + ex).toBeLessThanOrEqual(W / 2 + EPS);
      expect(Math.abs(lane.y) + ey).toBeLessThanOrEqual(H / 2 + EPS);
    }
  }
});

test('包含性断言真的会对一条伸出场地的车道失败', () => {
  // 上面那条断言化简后恒真过一次,所以它需要自证还看得见缺陷。
  const rogue = { x: 0, y: 0, angle: 0, len: W * 2, wid: LANE_W };
  const ex = rogue.len / 2;
  expect(Math.abs(rogue.x) + ex).toBeGreaterThan(W / 2);
});

test('米字带斜向车道,回字不带', () => {
  const star = skeletonLanes('star', W, H).map((l) => l.angle).sort((a, b) => a - b);
  expect(star).toContain(45);
  expect(star).toContain(135);
  const ring = skeletonLanes('ring', W, H).map((l) => l.angle);
  for (const a of ring) expect([0, 90]).toContain(a);
});

/**
 * 三种车身,已经乘过 `CAR_SCALE`(见 `types.ts` 的 `CAP_BOX` 与 `CAR_SCALE`)。
 *
 * 这两个数就是本任务存在的理由:一个均匀点阵没法同时服务 0.887 和 1.650 两种车长。
 */
const SMALL: Body = { len: 0.887, wid: 0.433 };
const BIG: Body = { len: 1.650, wid: 0.524 };

function same(n: number, b: Body): Body[] {
  return Array.from({ length: n }, () => b);
}

function boxOf(s: { x: number; y: number; angle: number }, b: Body): OBB {
  return { x: s.x, y: s.y, angle: s.angle, len: b.len, wid: b.wid };
}

test('座位落在场地内,并且是确定的', () => {
  const bodies = same(200, SMALL);
  const a = latticeSeats([], [], W, H, 0.25, seedRng(7), 0, bodies, false);
  const b = latticeSeats([], [], W, H, 0.25, seedRng(7), 0, bodies, false);
  expect(a).toEqual(b);
  expect(a.length).toBeGreaterThan(20);
  for (const s of a) {
    expect(Math.abs(s.x)).toBeLessThanOrEqual(W / 2);
    expect(Math.abs(s.y)).toBeLessThanOrEqual(H / 2);
  }
});

test('所有座位同一个朝向,而且那个朝向来自骨架', () => {
  // 点阵只有一个基准方向,取自骨架;横过来的那一档是 `cross` 在它之上混的。
  // 这几条断言把 `cross` 钉在 0,量的就是基准方向本身。
  const bodies = same(200, SMALL);
  const spine = latticeSeats(skeletonLanes('spine', W, H), [], W, H, 0.25, seedRng(2), 0, bodies, false);
  expect(new Set(spine.map((s) => s.angle)).size).toBe(1);
  expect(spine[0].angle).toBe(90);            // spine 的车道是 90 度

  const cross = latticeSeats(skeletonLanes('cross', W, H), [], W, H, 0.25, seedRng(2), 0, bodies, false);
  expect(new Set(cross.map((s) => s.angle)).size).toBe(1);
  expect(cross[0].angle).toBe(90);            // cross 的第一条车道是 90 度

  const bare = latticeSeats([], [], W, H, 0.25, seedRng(2), 0, bodies, false);
  expect(new Set(bare.map((s) => s.angle)).size).toBe(1);
  expect(bare[0].angle).toBe(90);             // 无车道时朝上

  // ring 的第一条车道是 0 度,是唯一能区分"读了 lanes"和"写死 90"的形状——没有它,
  // latticeAngle 直接 return 90 也能让这些测试全过。
  const ring = latticeSeats(skeletonLanes('ring', W, H), [], W, H, 0.25, seedRng(2), 0, bodies, false);
  expect(new Set(ring.map((s) => s.angle)).size).toBe(1);
  expect(ring[0].angle).toBe(0);
});

// 这条是本任务存在的理由:旧实现步长写死 1.25,两辆大车中心只隔 1.25,必然重叠。
test('同一行里相邻两辆车不重叠,大车也不重叠', () => {
  const bodies = same(60, BIG);
  const seats = latticeSeats([], [], W, H, 0.25, seedRng(3), 0, bodies, false);
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
  const small = latticeSeats([], [], W, H, 0.25, seedRng(3), 0, same(200, SMALL), false).length;
  const big = latticeSeats([], [], W, H, 0.25, seedRng(3), 0, same(200, BIG), false).length;
  expect(small).toBeGreaterThan(big * 1.4);
});

// 车身整个在场地内,不只是中心点在。
test('车身不许探出场地', () => {
  const bodies = Array.from({ length: 200 }, (_, i) => (i % 2 ? SMALL : BIG));
  const seats = latticeSeats([], [], W, H, 0.25, seedRng(5), 0.3, bodies, false);
  expect(seats.length).toBeGreaterThan(20);
  seats.forEach((s, i) => {
    expect(insideRect(boxOf(s, bodies[i]), W, H)).toBe(true);
  });
});

// 车身不许压车道 —— 中心点避开是不够的,这正是 Task 4 那个 Critical 的形状。
test('车身不许压进不能压的地方', () => {
  const lanes = skeletonLanes('ring', W, H);
  const bodies = same(200, BIG);
  const seats = latticeSeats(lanes, lanes, W, H, 0.25, seedRng(7), 0, bodies, false);
  expect(seats.length).toBeGreaterThan(20);      // 不能靠一个都不铺来通过
  seats.forEach((s, i) => {
    for (const l of lanes) {
      expect(overlapMTV(boxOf(s, bodies[i]), l)).toBeFalsy();
    }
  });
});

// 铺不下的车不返回,而且返回的是前缀对应关系:第 i 个座位属于第 i 辆车。
test('返回数组与入参逐位对应,铺不下的不返回', () => {
  const bodies = same(400, BIG);   // 远多于场地能放的
  const seats = latticeSeats([], [], W, H, 0.25, seedRng(9), 0, bodies, false);
  expect(seats.length).toBeLessThan(bodies.length);
  expect(seats.length).toBeGreaterThan(20);
});

// `lanes` 只定方向,`blocked` 才是硬约束——两者分开,是因为无车道而有隧道的关卡不能
// 拿隧道去定方向。
test('lanes 只定方向,blocked 才挡车', () => {
  const lanes = skeletonLanes('cross', W, H);
  const bodies = same(200, SMALL);
  const dirOnly = latticeSeats(lanes, [], W, H, 0.25, seedRng(11), 0, bodies, false);
  const blocked = latticeSeats(lanes, lanes, W, H, 0.25, seedRng(11), 0, bodies, false);
  // 同一个方向、同一个种子,唯一的变量是 blocked。
  expect(new Set(dirOnly.map((s) => s.angle))).toEqual(new Set(blocked.map((s) => s.angle)));
  expect(blocked.length).toBeLessThan(dirOnly.length);
  // 只定方向时车确实压在车道上——否则上面那条"少了"什么都没证明。
  expect(dirOnly.some((s, i) => lanes.some((l) => overlapMTV(boxOf(s, bodies[i]), l)))).toBe(true);
  blocked.forEach((s, i) => {
    for (const l of lanes) expect(overlapMTV(boxOf(s, bodies[i]), l)).toBeFalsy();
  });
});

test('间距越大,座位越少——这是密度旋钮', () => {
  const bodies = same(300, SMALL);
  const tight = latticeSeats([], [], W, H, 0.15, seedRng(3), 0, bodies, false).length;
  const loose = latticeSeats([], [], W, H, 0.45, seedRng(3), 0, bodies, false).length;
  expect(loose).toBeLessThan(tight);
});

test('cross = 1 时每个座位都横过来,cross = 0 时一个都不横', () => {
  const bodies = same(200, SMALL);
  const up = latticeSeats([], [], W, H, 0.25, seedRng(9), 0, bodies, false);
  const across = latticeSeats([], [], W, H, 0.25, seedRng(9), 1, bodies, false);
  expect(up.length).toBeGreaterThan(20);
  expect(across.length).toBeGreaterThan(20);
  expect(new Set(up.map((s) => s.angle))).toEqual(new Set([90]));
  expect(new Set(across.map((s) => s.angle))).toEqual(new Set([180]));
});

// 旧契约下这条断言的是"位置与 cross 完全无关":两档点阵逐点重合,`CROSS` 才能当单
// 变量标定。新契约下**一般情况已经不成立**,而且这是新设计的必然结果,不是退化——
// 横过来的车沿行方向占的是 `wid` 不是 `len`,它后面那辆车的起点因此真的不同。单变量
// 标定的前提相应换成"同一组 bodies、同一个种子、只改 cross",Task 5 照此执行。
//
// 但那一抽仍然是**无条件**的,而这条不变式还剩一个看得见的地方:车身是正方形时,横
// 过来既不改变它沿行方向占的长度,也不改变它盖住的那块地,于是位置又逐点重合。写成
// `cross > 0 && rng() < cross` 会短路掉 cross = 0 那一抽,rng 流整体错位,这条立刻红。
test('cross 那一抽是无条件的:方形车身下两档位置逐点重合', () => {
  const square = same(300, { len: 0.6, wid: 0.6 });
  const up = latticeSeats([], [], W, H, 0.25, seedRng(9), 0, square, false);
  const across = latticeSeats([], [], W, H, 0.25, seedRng(9), 1, square, false);
  expect(up.length).toBeGreaterThan(20);
  expect(across.map((s) => ({ x: s.x, y: s.y }))).toEqual(up.map((s) => ({ x: s.x, y: s.y })));
  expect(new Set(up.map((s) => s.angle))).toEqual(new Set([90]));
  expect(new Set(across.map((s) => s.angle))).toEqual(new Set([180]));
});

// 上面那条的反面,免得后人把"位置逐点重合"推广回去:车身不是方的,横过来就真的挪动
// 了它后面的车。它咬住的是"`turn` 真的进了 `extent`";咬不住步长写死成常数——变异
// 测过,那种实现下两档的剔除结果仍然不同(车身转 90 度后探出场地的位置不一样),
// 位置数组照样不相等。步长那件事由上面"相邻两辆车不重叠"和"小车铺得比大车多"咬。
test('车身不是方的时候,横过来会挪动它后面的车', () => {
  const bodies = same(200, BIG);
  const up = latticeSeats([], [], W, H, 0.25, seedRng(9), 0, bodies, false);
  const across = latticeSeats([], [], W, H, 0.25, seedRng(9), 1, bodies, false);
  expect(across.map((s) => ({ x: s.x, y: s.y }))).not.toEqual(up.map((s) => ({ x: s.x, y: s.y })));
});

test('中间档位是个比例,不是开关', () => {
  const bodies = same(300, SMALL);
  const some = latticeSeats([], [], W, H, 0.25, seedRng(9), 0.3, bodies, false);
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
