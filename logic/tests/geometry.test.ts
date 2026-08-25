import {
  OBB, obbCorners, inflate, overlapMTV, insideRect, sweepHit,
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

test('a box head-on into another stops at the gap between them', () => {
  // Half-lengths 1 and 1, centres 3 apart: 1 of clear board between the faces.
  expect(sweepHit(box({}), box({ x: 3 }), 1, 0)).toBeCloseTo(1, 6);
});

test('a box passing beside another never touches it', () => {
  // Half-widths 0.5 and 0.5, centres 1.2 apart across: 0.2 of daylight.
  expect(sweepHit(box({}), box({ x: 3, y: 1.2 }), 1, 0)).toBeNull();
});

test('a blocker behind the mover is not a blocker', () => {
  expect(sweepHit(box({}), box({ x: -3 }), 1, 0)).toBeNull();
});

test('boxes already overlapping report zero distance', () => {
  expect(sweepHit(box({}), box({ x: 1 }), 1, 0)).toBe(0);
});

test('a long box parallel alongside is never hit', () => {
  expect(sweepHit(box({}), box({ y: 1.2, len: 8 }), 1, 0)).toBeNull();
});

test('a gap one hair too narrow blocks, and one hair wider does not', () => {
  // Mover half-width 0.5; blocker half-width 0.5. Inner face at y - 0.5.
  expect(sweepHit(box({}), box({ x: 3, y: 0.9 }), 1, 0)).toBeCloseTo(1, 6);
  expect(sweepHit(box({}), box({ x: 3, y: 1.1 }), 1, 0)).toBeNull();
});

test('a box driving on the diagonal stops at the gap measured along its heading', () => {
  const d = Math.SQRT1_2;
  // Both facing 45 degrees; centres 2 * sqrt(2) apart along that same line,
  // minus the two half-lengths of 1.
  const hit = sweepHit(box({ angle: 45 }), box({ x: 2, y: 2, angle: 45 }), d, d);
  expect(hit).toBeCloseTo(2 * Math.SQRT2 - 2, 6);
});

test('the hit distance is exactly where the two boxes start to overlap', () => {
  // Ties sweepHit to overlapMTV: a hair short of the hit they are apart, a hair
  // past it they are not. Covers the rotated cases no hand-computed number does.
  const cases: Array<[OBB, OBB, number, number]> = [
    [box({}), box({ x: 3, angle: 45 }), 1, 0],
    [box({ angle: 30 }), box({ x: 2.5, y: 0.8, angle: 100 }), 1, 0],
    [box({ angle: 0, len: 3, wid: 0.6 }), box({ x: 2, y: 1.4, angle: 65 }), 0.6, 0.8],
    [box({ angle: 200 }), box({ x: -2.2, y: -1.1, angle: 15 }), -0.8, -0.6],
  ];
  for (const [a, b, dx, dy] of cases) {
    const t = sweepHit(a, b, dx, dy);
    expect(t).not.toBeNull();
    const at = (k: number): OBB => ({ ...a, x: a.x + dx * k, y: a.y + dy * k });
    expect(overlapMTV(at(t! - 0.01), b)).toBeNull();
    expect(overlapMTV(at(t! + 0.01), b)).not.toBeNull();
  }
});

test('a box moving away from one it overlaps still reports zero, not null', () => {
  // The mover is told how far it may go before contact, and it is already in contact.
  expect(sweepHit(box({}), box({ x: 1 }), -1, 0)).toBe(0);
});
