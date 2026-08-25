import {
  OBB, obbCorners, inflate, overlapMTV, insideRect,
} from '../../game/assets/scripts/core/geometry';

const box = (over: Partial<OBB>): OBB => ({ x: 0, y: 0, angle: 0, len: 2, wid: 1, ...over });

test('a box lists its four corners around its heading', () => {
  const cs = obbCorners(box({}));
  expect(cs).toHaveLength(4);
  const xs = cs.map((c) => c[0]).sort((a, b) => a - b);
  const ys = cs.map((c) => c[1]).sort((a, b) => a - b);
  expect(xs[0]).toBeCloseTo(-1, 6);
  expect(xs[3]).toBeCloseTo(1, 6);
  expect(ys[0]).toBeCloseTo(-0.5, 6);
  expect(ys[3]).toBeCloseTo(0.5, 6);
});

test('turning a box 90 degrees swaps which axis its length runs along', () => {
  const cs = obbCorners(box({ angle: 90 }));
  const xs = cs.map((c) => c[0]);
  const ys = cs.map((c) => c[1]);
  expect(Math.max(...xs)).toBeCloseTo(0.5, 6);
  expect(Math.max(...ys)).toBeCloseTo(1, 6);
});

test('inflate grows a box on every side, not just one', () => {
  const o = inflate(box({}), 0.25);
  expect(o.len).toBeCloseTo(2.5, 6);
  expect(o.wid).toBeCloseTo(1.5, 6);
});

test('two boxes that only touch are not overlapping', () => {
  // Half-lengths 1 and 1, so centres 2 apart leaves their faces flush.
  expect(overlapMTV(box({}), box({ x: 2 }))).toBeNull();
});

test('boxes clear of each other report no overlap', () => {
  expect(overlapMTV(box({}), box({ x: 2.5 }))).toBeNull();
  expect(overlapMTV(box({}), box({ y: 1.5 }))).toBeNull();
});

test('the push comes out along the axis that needs the least of it', () => {
  // Overlapping 0.5 along the length axis and 1.0 across, so it pushes along length.
  const mtv = overlapMTV(box({}), box({ x: 1.5 }));
  expect(mtv).not.toBeNull();
  expect(mtv!.x).toBeCloseTo(-0.5, 6);
  expect(mtv!.y).toBeCloseTo(0, 6);
});

test('two boxes in the same place are pushed apart across their width', () => {
  // Fully coincident: the length axis overlaps by 2, the width axis by 1. Width wins.
  const mtv = overlapMTV(box({}), box({}));
  expect(mtv).not.toBeNull();
  expect(Math.hypot(mtv!.x, mtv!.y)).toBeCloseTo(1, 6);
});

test('applying the push actually separates them', () => {
  const pairs: Array<[OBB, OBB]> = [
    [box({}), box({ x: 1.5 })],
    [box({}), box({ x: 1.2, y: 0.4, angle: 37 })],
    [box({ angle: 20 }), box({ x: 0.9, y: -0.6, angle: 115 })],
    [box({ angle: 45, len: 3, wid: 0.6 }), box({ x: 1.0, y: 1.0, angle: 45 })],
  ];
  for (const [a, b] of pairs) {
    const mtv = overlapMTV(a, b);
    expect(mtv).not.toBeNull();
    // Nudged a hair past the push so the result is strictly apart, not flush.
    const moved = { ...a, x: a.x + mtv!.x * 1.001, y: a.y + mtv!.y * 1.001 };
    expect(overlapMTV(moved, b)).toBeNull();
  }
});

test('a box well inside the lot is inside it', () => {
  expect(insideRect(box({ x: 3.4 }), 9, 6)).toBe(true);
});

test('a box hanging over the edge is not inside', () => {
  expect(insideRect(box({ x: 3.6 }), 9, 6)).toBe(false);
});

test('turning a box can push it out of a lot it fitted in', () => {
  // Along the lot: half-width 0.5 clears y = 3. Turned 45 degrees it reaches 1.06.
  expect(insideRect(box({ y: 2.4 }), 9, 6)).toBe(true);
  expect(insideRect(box({ y: 2.4, angle: 45 }), 9, 6)).toBe(false);
});
