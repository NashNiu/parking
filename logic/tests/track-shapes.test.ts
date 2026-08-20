import {
  buildShape, TRACK_SHAPES, TRACK_BOX, TrackShape, Pt, Seg,
} from '../../game/assets/scripts/core/track-shapes';

/** Measured from the shapes themselves; a change here is a change to the artwork. */
const PERIMETER: Record<TrackShape, number> = {
  rect: 14.9133, hex: 12.8874, trap: 13.7847, oval: 12.5935, circle: 8.1681,
};

/** Walk a segment list by arc length, the way TrackPath will. */
function walk(segs: Seg[], t: number): Pt {
  const total = segs.reduce((a, s) => a + s.len, 0);
  let s = (((t % 1) + 1) % 1) * total;
  const out: Pt = { x: 0, y: 0 };
  for (const seg of segs) {
    if (s <= seg.len) { seg.at(seg.len > 0 ? s / seg.len : 0, out); return out; }
    s -= seg.len;
  }
  segs[segs.length - 1].at(1, out);
  return out;
}

test('every shape has the perimeter it was drawn to have', () => {
  for (const shape of TRACK_SHAPES) {
    const { segs } = buildShape(shape);
    const total = segs.reduce((a, s) => a + s.len, 0);
    expect(total).toBeCloseTo(PERIMETER[shape], 3);
  }
});

test('every shape starts at the top centre', () => {
  // t=0 at the top centre is what puts the boarding gap at t=0.5 and the two channel
  // entrances at t=0.25/0.75 -- the whole index-to-geometry mapping rests on it.
  for (const shape of TRACK_SHAPES) {
    const p = walk(buildShape(shape).segs, 0);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(TRACK_BOX.halfH, 9);
  }
});

test('every shape is closed', () => {
  for (const shape of TRACK_SHAPES) {
    const { segs } = buildShape(shape);
    const a = walk(segs, 0), b = walk(segs, 1 - 1e-12);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
  }
});

test('every shape is mirror-symmetric about x = 0', () => {
  // Left-right symmetry is what makes t=0.5 the bottom CENTRE. The builders anchor the
  // walk analytically (they split the top edge at x=0), so this holds to float noise --
  // a numeric search for the start point would only manage 1e-3.
  for (const shape of TRACK_SHAPES) {
    const { segs } = buildShape(shape);
    for (let i = 1; i < 500; i++) {
      const u = i / 1000;
      const a = walk(segs, 0.5 - u), b = walk(segs, 0.5 + u);
      expect(a.x + b.x).toBeCloseTo(0, 9);
      expect(a.y - b.y).toBeCloseTo(0, 9);
    }
  }
});

test('the boarding gap sits at the bottom centre', () => {
  for (const shape of TRACK_SHAPES) {
    const p = walk(buildShape(shape).segs, 0.5);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(-TRACK_BOX.halfH, 9);
  }
});

test('the quarter point is where each shape docks its channel', () => {
  const DOCK: Record<TrackShape, [number, number]> = {
    rect: [2.6000, 0.0000],
    hex: [2.5243, 0.0000],
    trap: [2.3195, -0.2582],
    oval: [2.6000, 0.0000],
    circle: [1.3000, 0.0000],
  };
  for (const shape of TRACK_SHAPES) {
    const p = walk(buildShape(shape).segs, 0.25);
    expect(p.x).toBeCloseTo(DOCK[shape][0], 3);
    expect(p.y).toBeCloseTo(DOCK[shape][1], 3);
  }
});

test('no shape leaves the box the camera frames', () => {
  for (const shape of TRACK_SHAPES) {
    const { segs } = buildShape(shape);
    for (let i = 0; i < 2000; i++) {
      const p = walk(segs, i / 2000);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(TRACK_BOX.halfW + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(TRACK_BOX.halfH + 1e-9);
    }
  }
});

test('every shape declares a curvature radius a row of four can take', () => {
  // A row stands ACROSS the path, 0.78 wide, so a tight arc squeezes the inner figures.
  for (const shape of TRACK_SHAPES) {
    expect(buildShape(shape).minRadius).toBeGreaterThanOrEqual(0.6);
  }
});

test('the polyline ellipse tracks the true ellipse closely', () => {
  // The parametric form is not arc-length uniform, so the ellipse is a fine polyline;
  // this is the price of that choice, and it has to stay small.
  const { segs } = buildShape('oval');
  const a = TRACK_BOX.halfW, b = TRACK_BOX.halfH;
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const p = walk(segs, i / 2000);
    // Implicit form: 1 means on the curve. Convert the residual to a radial distance.
    const f = (p.x * p.x) / (a * a) + (p.y * p.y) / (b * b);
    worst = Math.max(worst, Math.abs(Math.sqrt(f) - 1) * Math.max(a, b));
  }
  expect(worst).toBeLessThan(0.001);
});
