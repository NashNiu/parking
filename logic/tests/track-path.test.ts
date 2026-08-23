import {
  TrackPath, entryIndex, maxLookahead, capacityOptions,
  LANE, ROW_SPACING_MIN, SEAM_MIN, SEAM_MAX, CAPACITY_OPTIONS, ENTRY_NORMAL_MAX,
  MIN_CURVE_RADIUS, GAP_ARC, BLOCK, blockOffset, blockRanks, blockLength, blockSpan,
  minFigureGap,
} from '../../game/assets/scripts/core/track-path';
import { TRACK_SHAPES, TrackShape } from '../../game/assets/scripts/core/track-shapes';
import { GROUP_SIZE } from '../../game/assets/scripts/core/types';

/**
 * The closest pair of figures on a full ring, split by whether the two come from the SAME
 * cell or from neighbouring ones. `minFigureGap` returns the smaller of the two; keeping
 * them apart is what lets a test say which KIND of pair is the closest.
 */
function figurePairs(shape: TrackShape, capacity: number): { intra: number; cross: number } {
  const path = new TrackPath(shape);
  const ranks = blockRanks(GROUP_SIZE);
  const cells = Array.from({ length: capacity }, (_, i) => {
    const t = i / capacity;
    const pt = path.pointAt(t, { x: 0, y: 0 });
    const nm = path.normalAt(t, { x: 0, y: 0 });
    return Array.from({ length: GROUP_SIZE }, (_, j) => {
      const o = blockOffset(j, ranks, BLOCK.rankStep, { across: 0, along: 0 });
      return {
        x: pt.x + o.across * nm.x + o.along * nm.y,
        y: pt.y + o.across * nm.y - o.along * nm.x,
      };
    });
  });
  const d = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y);
  let intra = Infinity, cross = Infinity;
  for (let i = 0; i < capacity; i++) {
    const here = cells[i], next = cells[(i + 1) % capacity];
    for (let a = 0; a < here.length; a++) {
      for (let b = a + 1; b < here.length; b++) intra = Math.min(intra, d(here[a], here[b]));
      for (let b = 0; b < next.length; b++) cross = Math.min(cross, d(here[a], next[b]));
    }
  }
  return { intra, cross };
}

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

test('each shape allows only the capacities whose seam reads', () => {
  // Exactly one length each: a block is one row, 0.22 long, and the seam band leaves each
  // perimeter one place to put its cells. The circle's perimeter is 60% of the
  // quadrilaterals', so it lands one step lower.
  const EXPECTED: Record<TrackShape, number[]> = {
    rect: [28],
    hex: [28],
    trap: [28],
    oval: [28],
    circle: [20],
  };
  for (const shape of TRACK_SHAPES) {
    expect(capacityOptions(shape)).toEqual(EXPECTED[shape]);
  }
});

test('a capacity is allowed exactly when it clears every rule', () => {
  for (const shape of TRACK_SHAPES) {
    const p = new TrackPath(shape);
    const allowed = capacityOptions(shape);
    for (const c of CAPACITY_OPTIONS) {
      const spacing = p.rowSpacing(c);
      const seam = spacing - blockLength(GROUP_SIZE);
      const roomForDoorway = spacing >= ROW_SPACING_MIN;
      const reads = seam >= SEAM_MIN && seam <= SEAM_MAX;
      const fits = minFigureGap(shape, c, GROUP_SIZE) >= BLOCK.clearance;
      expect(allowed.includes(c)).toBe(roomForDoorway && reads && fits);
    }
  }
});

test('a block is the same length on every ring it can stand on', () => {
  // The bug this rules out: an earlier version spaced a cell's ranks at spacing/ranks, so a
  // block stretched to fill whatever cell it was given and the seam between two groups came
  // out identically zero at every capacity -- one unbroken belt of figures, with no way to
  // see where a group ended. A block's length has to be a property of the block, so that
  // what a longer cell buys is seam.
  const len = blockLength(GROUP_SIZE);
  expect(len).toBeCloseTo(BLOCK.rankStep * (blockRanks(GROUP_SIZE) - 1) + BLOCK.figure, 10);
  for (const shape of TRACK_SHAPES) {
    for (const c of capacityOptions(shape)) {
      expect(new TrackPath(shape).rowSpacing(c) - len).toBeGreaterThanOrEqual(SEAM_MIN);
    }
  }
});

test('a group is one row of four, and the row is as wide as the band lets it be', () => {
  // What GROUP_SIZE 4 and BLOCK.across 4 mean together, asserted rather than assumed,
  // because the rest of this file's numbers follow from it: one rank, so a block is exactly
  // a figure deep and every cell's spare arc is seam.
  expect(blockRanks(GROUP_SIZE)).toBe(1);
  expect(BLOCK.across).toBe(GROUP_SIZE);
  expect(blockLength(GROUP_SIZE)).toBeCloseTo(BLOCK.figure, 10);
  // The row is packed a shade tighter than the figures are wide, so their heads overlap by
  // about a tenth. That is deliberate and it is what pays for the seam: what decides whether
  // rows read as rows is the ratio between the nearest figure in the next row and the nearest
  // one beside you, so a narrower row lets a narrower seam still read. `clearance` is the
  // floor -- past it a row stops being a crowd and becomes one clipped blob.
  expect(BLOCK.acrossStep).toBeLessThan(BLOCK.figure);
  expect(BLOCK.acrossStep).toBeGreaterThanOrEqual(BLOCK.clearance);
});

test('two groups stand further apart than the members of one group', () => {
  // What "you can see where one row ends" means as a measurement, and the check that the
  // centreline seam survives the corners: an arc-length seam compresses on the inside of a
  // bend, so a seam that reads on the straights can still close up on a corner. Every
  // legal ring has to keep its closest CROSS-CELL pair further apart than its closest pair
  // inside one cell -- otherwise the eye groups the figures by proximity and puts the
  // group boundary somewhere the game does not.
  for (const shape of TRACK_SHAPES) {
    for (const capacity of capacityOptions(shape)) {
      const { intra, cross } = figurePairs(shape, capacity);
      expect(cross).toBeGreaterThan(intra);
    }
  }
});

test('no two figures overlap anywhere on any legal ring', () => {
  // The rule that was missing. Cells are spaced evenly by ARC LENGTH, but on a corner the
  // inside of the track is shorter than the centreline, so the figures on the inside of a
  // bend close up. Before this rule existed, level 1's ring (a rounded rectangle at 24
  // cells) drew two figures 0.005 apart at its bottom-left corner -- on top of each other.
  for (const shape of TRACK_SHAPES) {
    for (const capacity of capacityOptions(shape)) {
      expect(minFigureGap(shape, capacity, GROUP_SIZE)).toBeGreaterThanOrEqual(BLOCK.clearance);
    }
  }
});

test('a ring one step too short is rejected for seam alone', () => {
  // The seam ceiling has to be separable from every other rule, or it could be quietly
  // deleted and the others would seem to cover for it. Twenty-four cells on a rounded
  // rectangle is the next ring up from the legal one: it clears the doorway floor with room
  // to spare, and it holds every figure a clean 0.31 from the next row -- and it still leaves
  // 0.27 of bare band between one row of four and the next, which is what makes a ring of
  // single rows read as empty track with people on it.
  const spacing = new TrackPath('rect').rowSpacing(24);
  expect(spacing).toBeGreaterThanOrEqual(ROW_SPACING_MIN);
  expect(minFigureGap('rect', 24, GROUP_SIZE)).toBeGreaterThanOrEqual(BLOCK.clearance);
  expect(spacing - blockLength(GROUP_SIZE)).toBeGreaterThan(SEAM_MAX);
  expect(capacityOptions('rect')).not.toContain(24);
});

test('the doorway is what stops the ring packing tighter still', () => {
  // Why the seam bottoms out where it does, recorded because it is not obvious from either
  // constant on its own. The seam is a cell minus a row, so the only route to a smaller seam
  // is a shorter cell -- and the cell cannot go below the boarding doorway without the
  // doorway swallowing its neighbour. Every legal ring therefore sits within a figure's
  // width of that floor, and the rings rejected at the tight end are rejected for it.
  for (const shape of TRACK_SHAPES) {
    for (const c of capacityOptions(shape)) {
      const spacing = new TrackPath(shape).rowSpacing(c);
      expect(spacing).toBeGreaterThanOrEqual(ROW_SPACING_MIN);
      expect(spacing - ROW_SPACING_MIN).toBeLessThan(BLOCK.figure);
    }
  }
  const circle = new TrackPath('circle');
  for (const c of [24, 28]) {
    expect(circle.rowSpacing(c)).toBeLessThan(ROW_SPACING_MIN);
    expect(capacityOptions('circle')).not.toContain(c);
  }
});

test('the channels are packed as tightly as the ring is', () => {
  // The two halves of the track have separate spacing rules -- a ring cell's comes from the
  // shape's perimeter, a channel slot's is LANE.step -- and nothing but this stops one being
  // tuned without the other. They hold the same thing, one row of four, so the bare band
  // between two waiting rows has to look like the bare band between two rows on the ring.
  const laneSeam = LANE.step - blockLength(GROUP_SIZE);
  expect(laneSeam).toBeGreaterThan(0);
  for (const shape of TRACK_SHAPES) {
    for (const c of capacityOptions(shape)) {
      const ringSeam = new TrackPath(shape).rowSpacing(c) - blockLength(GROUP_SIZE);
      expect(Math.abs(ringSeam - laneSeam)).toBeLessThan(BLOCK.figure / 2);
    }
  }
});

test('a second rank, if there ever is one, stands staggered and not in column', () => {
  // The shipped block is a single row (GROUP_SIZE 4), so this covers blockOffset's contract
  // rather than today's ring -- deliberately, because the stagger is not optional once a
  // second rank exists and GROUP_SIZE is a knob. Without it the along-path step alone
  // carries the clearance between the ranks, and on a corner, where a cell's ranks swing
  // together, that step is not enough: two figures in column end up closer than one is wide.
  const doubled = BLOCK.across * 2;
  const ranks = blockRanks(doubled);
  expect(ranks).toBe(2);
  const at = (i: number) => blockOffset(i, ranks, BLOCK.rankStep, { across: 0, along: 0 });
  const gap = (i: number, j: number): number => {
    const a = at(i), across = a.across, along = a.along;
    const b = at(j);
    return Math.hypot(across - b.across, along - b.along);
  };
  // Figure 0 leads its rank; figure BLOCK.across is the one directly behind it, and only
  // the half-step shift keeps the pair further apart than the rank step alone would.
  expect(at(0).across).not.toBeCloseTo(at(BLOCK.across).across, 10);
  expect(gap(0, BLOCK.across)).toBeGreaterThan(BLOCK.rankStep);
});

test('the boarding gap never swallows a neighbouring row', () => {
  // The gap is an absolute arc length now, so the tightest legal spacing has to clear it.
  expect(GAP_ARC).toBeLessThan(ROW_SPACING_MIN);
});

test('lookahead tops out where the channel would leave the visible width', () => {
  // Nothing to do with capacity: with a multiple-of-four ring the entry always lands at
  // t=0.25, so what a shape allows is decided by how far out its quarter point sits. The
  // hexagon and the trapezoid dock closest to the centre of the four quadrilaterals, so they
  // are the ones that pick up the extra batch each time LANE.step comes down.
  const EXPECTED: Record<TrackShape, number> = {
    rect: 4, hex: 5, trap: 5, oval: 4, circle: 7,
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
  // This is not hypothetical: oval-at-14 was in the first draft curve, and its entry cell
  // lands on a curved stretch with the normal tilted 28 degrees -- a channel shoved
  // diagonally off screen. Hex-at-18 was the other case, and it no longer trips the rule:
  // the corner radius went from 0.60 to 0.90 to let the ring pack tighter, and a rounder
  // hexagon has a flatter quarter point. One live case is enough to show the rule bites.
  const oval = new TrackPath('oval');
  expect(Math.abs(oval.normalAt(entryIndex(14, 7, 'near') / 14).y)).toBeGreaterThan(ENTRY_NORMAL_MAX);
  const hex = new TrackPath('hex');
  expect(Math.abs(hex.normalAt(entryIndex(18, 9, 'near') / 18).y)).toBeGreaterThan(0.3);
});

test('every shape clears the curvature floor, and the floor clears half a block', () => {
  // A block reaches blockSpan/2 either side of the centreline, so an arc tighter than that
  // turns its inner edge past the arc's own centre and inside out. MIN_CURVE_RADIUS has to
  // sit above that, and every shape's tightest corner above MIN_CURVE_RADIUS.
  expect(MIN_CURVE_RADIUS).toBeGreaterThan(blockSpan(GROUP_SIZE) / 2);
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
