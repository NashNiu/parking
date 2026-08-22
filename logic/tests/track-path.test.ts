import {
  TrackPath, entryIndex, maxLookahead, capacityOptions,
  LANE, ROW_SPACING_MIN, ROW_SPACING_MAX, CAPACITY_OPTIONS, ENTRY_NORMAL_MAX,
  MIN_CURVE_RADIUS, GAP_ARC,
} from '../../game/assets/scripts/core/track-path';
import { TRACK_SHAPES, TrackShape } from '../../game/assets/scripts/core/track-shapes';

test('the outward normal at a straight side points straight out', () => {
  const p = new TrackPath('rect');
  const n = p.normalAt(0.25);
  expect(n.x).toBeCloseTo(1, 6);
  expect(n.y).toBeCloseTo(0, 6);
});

test('the normal is a unit vector everywhere', () => {
  for (const shape of TRACK_SHAPES) {
    const p = new TrackPath(shape);
    for (let i = 0; i < 500; i++) {
      const n = p.normalAt(i / 500);
      expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 6);
    }
  }
});

test('the normal points AWAY from the track centre', () => {
  // A channel is placed along this vector, so a sign error would bury it inside the ring.
  // `dot(point, normal) > 0` is only a valid outward test because all five shapes are
  // star-shaped about the origin (verified by inspection when this test was written); a
  // future concave shape could have a point/normal pair with a negative dot product and
  // still be facing outward, which would make THIS TEST wrong rather than the shape.
  for (const shape of TRACK_SHAPES) {
    const p = new TrackPath(shape);
    for (let i = 0; i < 200; i++) {
      const t = i / 200;
      const pt = p.pointAt(t), n = p.normalAt(t);
      expect(pt.x * n.x + pt.y * n.y).toBeGreaterThan(0);
    }
  }
});

test('row spacing is the perimeter split evenly', () => {
  const p = new TrackPath('rect');
  expect(p.rowSpacing(20)).toBeCloseTo(p.perimeter / 20, 9);
});

test('entry indices sit a quarter lap either side of the boarding gap', () => {
  for (const capacity of CAPACITY_OPTIONS) {
    const board = capacity / 2;
    expect(entryIndex(capacity, board, 'near')).toBe(board - capacity / 4);
    expect(entryIndex(capacity, board, 'far')).toBe(board + capacity / 4);
  }
});

test('the near entry is a quarter lap from the gap and the far one three quarters', () => {
  // The ring steps index+1 per tick, so a row at index e reaches the gap in
  // (board - e) mod capacity ticks. This is the difficulty knob, so pin it.
  for (const capacity of CAPACITY_OPTIONS) {
    const board = capacity / 2;
    const near = entryIndex(capacity, board, 'near');
    const far = entryIndex(capacity, board, 'far');
    expect((board - near + capacity) % capacity).toBe(capacity / 4);
    expect((board - far + capacity) % capacity).toBe((capacity * 3) / 4);
  }
});

test('each shape allows only the capacities whose row spacing reads', () => {
  // One or two lengths each: the spacing band is narrow on purpose (a cell has to look
  // occupied), so a shape's perimeter almost picks its ring length for it. The circle,
  // at 60% of the quadrilaterals' perimeter, is the only one that can go as low as 12.
  const EXPECTED: Record<TrackShape, number[]> = {
    rect: [20, 24],
    hex: [16, 20],
    trap: [16, 20],
    oval: [16, 20],
    circle: [12],
  };
  for (const shape of TRACK_SHAPES) {
    expect(capacityOptions(shape)).toEqual(EXPECTED[shape]);
  }
});

test('every allowed capacity really is inside the spacing bounds, and every rejected one is not', () => {
  for (const shape of TRACK_SHAPES) {
    const p = new TrackPath(shape);
    const allowed = capacityOptions(shape);
    for (const c of CAPACITY_OPTIONS) {
      const spacing = p.rowSpacing(c);
      const inside = spacing >= ROW_SPACING_MIN && spacing <= ROW_SPACING_MAX;
      expect(allowed.includes(c)).toBe(inside);
    }
  }
});

test('the boarding gap never swallows a neighbouring row', () => {
  // The gap is an absolute arc length now, so the tightest legal spacing has to clear it.
  expect(GAP_ARC).toBeLessThan(ROW_SPACING_MIN);
});

test('lookahead tops out where the channel would leave the visible width', () => {
  const EXPECTED: Record<TrackShape, number> = {
    rect: 4, hex: 4, trap: 4, oval: 4, circle: 6,
  };
  for (const shape of TRACK_SHAPES) {
    expect(maxLookahead(shape)).toBe(EXPECTED[shape]);
  }
});

test('a channel at its lookahead limit stays on screen, and one batch more does not', () => {
  for (const shape of TRACK_SHAPES) {
    const dockX = Math.abs(new TrackPath(shape).pointAt(0.25).x);
    const edge = (look: number) =>
      dockX + LANE.bandHalf + LANE.start + (look - 1) * LANE.step + LANE.margin;
    expect(edge(maxLookahead(shape))).toBeLessThanOrEqual(LANE.edgeLimit);
    expect(edge(maxLookahead(shape) + 1)).toBeGreaterThan(LANE.edgeLimit);
  }
});

test('every shape docks its channels close to horizontal', () => {
  // A steep normal would shove the channel into the HUD or down onto the parking bay.
  for (const shape of TRACK_SHAPES) {
    const p = new TrackPath(shape);
    for (const capacity of capacityOptions(shape)) {
      const board = capacity / 2;
      for (const side of ['far', 'near'] as const) {
        const t = entryIndex(capacity, board, side) / capacity;
        expect(Math.abs(p.normalAt(t).y)).toBeLessThanOrEqual(ENTRY_NORMAL_MAX);
      }
    }
  }
});

test('a non-multiple-of-four capacity is exactly what the normal rule catches', () => {
  // This is not hypothetical: hex-at-18 and oval-at-14 were in the first draft curve,
  // and their entry cells land on curved edges with normals tilted about 30 degrees.
  const hex = new TrackPath('hex');
  expect(Math.abs(hex.normalAt(entryIndex(18, 9, 'near') / 18).y)).toBeGreaterThan(ENTRY_NORMAL_MAX);
  const oval = new TrackPath('oval');
  expect(Math.abs(oval.normalAt(entryIndex(14, 7, 'near') / 14).y)).toBeGreaterThan(ENTRY_NORMAL_MAX);
});

test('every shape clears the curvature floor', () => {
  for (const shape of TRACK_SHAPES) {
    expect(new TrackPath(shape).minRadius).toBeGreaterThanOrEqual(MIN_CURVE_RADIUS);
  }
});

test('pointAt writes into a caller-supplied point and allocates nothing', () => {
  // repositionAll calls this once per row per frame, so it must be allocation-free.
  const p = new TrackPath('oval');
  const out = { x: 0, y: 0 };
  expect(p.pointAt(0.3, out)).toBe(out);
  expect(out.x).not.toBe(0);
});
