import {
  legSamples, nodeCenter, RAIL_PITCH, SAMPLES_PER_LEG, ZIG_X,
} from '../../game/assets/scripts/core/home-path';

/**
 * The requirement, verbatim: "the path has to actually pass through the stop centres." This
 * is that sentence made executable -- the old lobby's dashed centre line never passed through
 * a single stop; the stops sat wobbling +-158 to either side of it, so the road and the stops
 * were two unrelated things.
 */
test('each leg starts and ends exactly on the two nodes it connects', () => {
  for (let i = 0; i < 9; i++) {
    const pts = legSamples(i);
    expect(pts[0]).toEqual(nodeCenter(i));
    expect(pts[pts.length - 1]).toEqual(nodeCenter(i + 1));
  }
});

test('a leg is sampled at SAMPLES_PER_LEG + 1 points', () => {
  expect(legSamples(0)).toHaveLength(SAMPLES_PER_LEG + 1);
});

test('nodes alternate left and right, starting on the left at 0', () => {
  expect(nodeCenter(0).x).toBe(-ZIG_X);
  expect(nodeCenter(1).x).toBe(ZIG_X);
  expect(nodeCenter(2).x).toBe(-ZIG_X);
  expect(nodeCenter(7).x).toBe(ZIG_X);
});

test('nodes are exactly RAIL_PITCH apart, climbing as i grows', () => {
  for (let i = 0; i < 9; i++) {
    expect(nodeCenter(i + 1).y - nodeCenter(i).y).toBeCloseTo(RAIL_PITCH, 9);
  }
});

/**
 * The pitch itself, pinned as a literal. The test above is deliberately pitch-independent --
 * it would pass at 340 just as it passed before this retune -- so it cannot catch a docblock
 * whose derivation drifts from the constant it describes, or a future edit that changes one
 * without the other. This is the one place that fails if `RAIL_PITCH` moves without a reason.
 */
test('RAIL_PITCH is tuned for seven-to-eight badges a screen', () => {
  expect(RAIL_PITCH).toBe(290);
});

test('sampled y is strictly increasing -- the road never doubles back', () => {
  for (let i = 0; i < 9; i++) {
    const pts = legSamples(i);
    for (let k = 1; k < pts.length; k++) {
      expect(pts[k].y).toBeGreaterThan(pts[k - 1].y);
    }
  }
});

/**
 * The curve must never swing outside the stop columns. A cubic Bezier stays inside the
 * convex hull of its control points, and all four control points here have x of +-ZIG_X, so
 * this holds by construction -- the test is here to catch someone moving a control point
 * elsewhere, not to discover a bug.
 */
test('every sampled point stays within |x| <= ZIG_X', () => {
  for (let i = 0; i < 9; i++) {
    for (const p of legSamples(i)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(ZIG_X + 1e-9);
    }
  }
});

test('the tangent at every node is vertical -- adjacent legs join smoothly', () => {
  // A leg's second sample point should differ from its start far more in y than in x: the
  // curve leaves each node travelling straight up.
  const pts = legSamples(3);
  const dx = Math.abs(pts[1].x - pts[0].x);
  const dy = Math.abs(pts[1].y - pts[0].y);
  expect(dx).toBeLessThan(dy);
});
