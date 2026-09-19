import { skeletonShape, skeletonLanes, LANE_W, SkeletonShape } from '../../game/assets/scripts/core/lot-skeleton';

const W = 8, H = 12;

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
