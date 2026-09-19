import { skeletonShape, skeletonLanes, LANE_W, SkeletonShape, latticeSeats, shuffled } from '../../game/assets/scripts/core/lot-skeleton';
import { OBB, overlapMTV } from '../../game/assets/scripts/core/geometry';

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
  expect(got).toEqual([
    'none', 'none', 'spine', 'spine', 'cross',
    'ring', 'ring', 'ring', 'star', 'star',
  ]);
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

test('座位落在场地内,并且是确定的', () => {
  const a = latticeSeats([], W, H, 0.25, 0.8, seedRng(7), 0);
  const b = latticeSeats([], W, H, 0.25, 0.8, seedRng(7), 0);
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
  const spine = latticeSeats(skeletonLanes('spine', W, H), W, H, 0.25, 0.8, seedRng(2), 0);
  expect(new Set(spine.map((s) => s.angle)).size).toBe(1);
  expect(spine[0].angle).toBe(90);            // spine 的车道是 90 度

  const cross = latticeSeats(skeletonLanes('cross', W, H), W, H, 0.25, 0.8, seedRng(2), 0);
  expect(new Set(cross.map((s) => s.angle)).size).toBe(1);
  expect(cross[0].angle).toBe(90);            // cross 的第一条车道是 90 度

  const bare = latticeSeats([], W, H, 0.25, 0.8, seedRng(2), 0);
  expect(new Set(bare.map((s) => s.angle)).size).toBe(1);
  expect(bare[0].angle).toBe(90);             // 无车道时朝上

  // ring 的第一条车道是 0 度,是唯一能区分"读了 lanes"和"写死 90"的形状——没有它,
  // latticeAngle 直接 return 90 也能让 11 个测试全过。
  const ring = latticeSeats(skeletonLanes('ring', W, H), W, H, 0.25, 0.8, seedRng(2), 0);
  expect(new Set(ring.map((s) => s.angle)).size).toBe(1);
  expect(ring[0].angle).toBe(0);
});

test('没有座位落在车道里', () => {
  const lanes = skeletonLanes('cross', W, H);
  const seats = latticeSeats(lanes, W, H, 0.25, 0.8, seedRng(11), 0);
  // 座位是点,用一个极小的盒子代表它
  for (const s of seats) {
    const dot: OBB = { x: s.x, y: s.y, angle: 0, len: 1e-6, wid: 1e-6 };
    for (const l of lanes) expect(overlapMTV(dot, l)).toBeFalsy();
  }
});

test('间距越大,座位越少——这是密度旋钮', () => {
  const tight = latticeSeats([], W, H, 0.15, 0.8, seedRng(3), 0).length;
  const loose = latticeSeats([], W, H, 0.45, 0.8, seedRng(3), 0).length;
  expect(loose).toBeLessThan(tight);
});

test('车道占掉的地方不再有座位', () => {
  const bare = latticeSeats([], W, H, 0.25, 0.8, seedRng(5), 0).length;
  const withLanes = latticeSeats(skeletonLanes('ring', W, H), W, H, 0.25, 0.8, seedRng(5), 0).length;
  expect(withLanes).toBeLessThan(bare);
});

test('cross = 1 时每个座位都横过来,cross = 0 时一个都不横', () => {
  const up = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 0);
  const across = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 1);
  expect(new Set(up.map((s) => s.angle))).toEqual(new Set([90]));
  expect(new Set(across.map((s) => s.angle))).toEqual(new Set([180]));
});

// 位置与朝向解耦,是 Task 5 能把 CROSS 当单变量标定的前提:两档跑出来的点阵逐点
// 重合,分数的差别才只能来自朝向。这条也顺带咬住"cross 抽签必须无条件抽、抽在剔除
// 之前"——少抽一次,rng 流就错位,位置全都对不上。
test('横过来的只是朝向,位置一个都没动', () => {
  const up = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 0);
  const across = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 1);
  expect(across.map((s) => ({ x: s.x, y: s.y }))).toEqual(up.map((s) => ({ x: s.x, y: s.y })));
});

test('中间档位是个比例,不是开关', () => {
  const some = latticeSeats([], W, H, 0.25, 0.8, seedRng(9), 0.3);
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
