import {
  TrackPath, entryIndex, maxLookahead, capacityOptions,
  LANE, ROW_SPACING_MIN, SEAM_MIN, SEAM_MAX, CAPACITY_OPTIONS, ENTRY_NORMAL_MAX,
  MIN_CURVE_RADIUS, GAP_ARC, BLOCK, blockOffset, blockRanks, blockLength, blockSpan,
  minRowGap,
} from '../../game/assets/scripts/core/track-path';
import { TRACK_SHAPES, TrackShape } from '../../game/assets/scripts/core/track-shapes';
import { GROUP_SIZE } from '../../game/assets/scripts/core/types';

/**
 * The closest pair of figures on a full ring, split by whether the two come from the SAME
 * cell or from neighbouring ones. `minRowGap` answers only the second; measuring both here
 * is what lets a test compare them, which is the legibility rule.
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
  // A block is one row, 0.22 long, and between the seam ceiling and `clearance` each perimeter
  // is left with two or three places to put its cells. Where each one stops is its corners:
  // the rectangle carries 36 at minRowGap 0.212, the hexagon, the trapezoid and the oval carry
  // 32 (0.221, 0.214, 0.204) and miss 36, and the circle -- whose perimeter is 75% of theirs --
  // lands a step lower again at 28 (0.213). All against `clearance` 0.20. Levels take the
  // LONGEST option their shape allows; see TRACK_CURVE.
  const EXPECTED: Record<TrackShape, number[]> = {
    rect: [28, 32, 36],
    hex: [28, 32],
    trap: [28, 32],
    oval: [28, 32],
    circle: [24, 28],
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
      const fits = minRowGap(shape, c, GROUP_SIZE) >= BLOCK.clearance;
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
  // about a tenth -- deliberately, and it is what pays for the seam: a narrower row lets a
  // narrower seam still read as a break.
  expect(BLOCK.acrossStep).toBeLessThan(BLOCK.figure);
  // The floor is the ARM span, not the head, and the row sits exactly on it. Heads may
  // overlap because a head is a ball and two of them merge into a wider ball; arms are the
  // silhouette's edge, and two arms through each other read as one clipped body. This is why
  // the ring cannot simply be packed tighter still: the seam only comes down as far as the
  // row does, and the row stops here.
  expect(BLOCK.acrossStep).toBeGreaterThanOrEqual(BLOCK.arms);
  // THE TWO FLOORS HAVE CONVERGED, and that is the end state of "pack the rows as tight as
  // they go". `clearance` used to be a figure's WIDTH -- two rows may touch and no closer,
  // stricter than the rule row-mates get -- and it is now the arm span, exactly what a row
  // holds its own members to. So nothing anywhere on the track comes closer than arms
  // touching, one floor instead of two, and heads overlap by figure - arms (0.02 board units,
  // about 1.5px) wherever they meet. Pinned because it is the whole basis of the ring's
  // density: raise it and every shape loses a capacity step.
  expect(BLOCK.clearance).toBe(BLOCK.arms);
  expect(BLOCK.clearance).toBeLessThan(BLOCK.figure);
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

test('no two rows touch anywhere on any legal ring', () => {
  // Cells are spaced evenly by ARC LENGTH, but on a corner the inside of the track is
  // shorter than the centreline, so figures on the inside of a bend close up on the row
  // ahead. Before this rule existed, level 1's ring drew two figures 0.005 apart at its
  // bottom-left corner -- on top of each other.
  for (const shape of TRACK_SHAPES) {
    for (const capacity of capacityOptions(shape)) {
      expect(minRowGap(shape, capacity, GROUP_SIZE)).toBeGreaterThanOrEqual(BLOCK.clearance);
    }
  }
});

test('minRowGap measures the corners, not a constant', () => {
  // It used to take the minimum over same-row pairs as well, and a row is rigid -- so the
  // distance between two of its own figures is `acrossStep` whatever the shape and whatever
  // the capacity. Being the smaller of the two, it WAS the answer, every time: the corner
  // measurement was hidden behind a constant and `capacityOptions` was checking a tautology.
  // If this ever returns acrossStep again, that is the bug back.
  const seen = new Set<string>();
  for (const shape of TRACK_SHAPES) {
    for (const c of CAPACITY_OPTIONS) {
      const gap = minRowGap(shape, c, GROUP_SIZE);
      // Never the constant, on any ring -- legal or not. This is the actual regression guard:
      // returning acrossStep is what the bug did, and it did it everywhere.
      expect(gap).not.toBeCloseTo(BLOCK.acrossStep, 4);
      seen.add(gap.toFixed(4));
    }
    // There USED to be a second assertion here -- that a legal ring's corners clear
    // `acrossStep` outright -- and it has been removed rather than updated, because it became
    // a restatement of `capacityOptions` when `clearance` came down to equal `acrossStep`.
    // The `not.toBeCloseTo` above is the actual regression guard and always was; the other
    // one only ever passed by arithmetic, which is the tautology this test exists to avoid.
  }
  expect(seen.size).toBeGreaterThan(TRACK_SHAPES.length);
});

test('a ring one step too short is rejected for seam alone', () => {
  // The seam ceiling has to be separable from every other rule, or it could be quietly
  // deleted and the others would seem to cover for it. Twenty-four cells on a rounded
  // rectangle is the next ring up from the legal one: it clears the doorway floor with room
  // to spare, and it holds every row a clean 0.32 off the one ahead -- and it still leaves
  // 0.22 of bare band between one row of four and the next, which is what makes a ring of
  // single rows read as empty track with people on it.
  const spacing = new TrackPath('rect').rowSpacing(24);
  expect(spacing).toBeGreaterThanOrEqual(ROW_SPACING_MIN);
  expect(minRowGap('rect', 24, GROUP_SIZE)).toBeGreaterThanOrEqual(BLOCK.clearance);
  expect(spacing - blockLength(GROUP_SIZE)).toBeGreaterThan(SEAM_MAX);
  expect(capacityOptions('rect')).not.toContain(24);
});

test('row overlap is what stops the ring packing tighter still', () => {
  // Why the seam bottoms out where it does. It is not the boarding doorway and it is not the
  // seam floor -- both of those have been the binding limit at some point and both have been
  // moved off it -- it is the corners. Each shape stops in its own place, and no narrower row
  // can buy the next step back, because a row is already down to arms touching.
  for (const shape of ['hex', 'trap', 'oval'] as TrackShape[]) {
    expect(minRowGap(shape, 36, GROUP_SIZE)).toBeLessThan(BLOCK.clearance);
  }
  expect(minRowGap('circle', 32, GROUP_SIZE)).toBeLessThan(BLOCK.clearance);
  // 40 is where the ROOMIEST shape runs out, so no shape can use it. This is the measurement
  // behind "the ring cannot be packed to a zero seam": on a closed loop, shutting the
  // straights is the same act as overlapping the corners.
  for (const shape of TRACK_SHAPES) {
    expect(minRowGap(shape, 40, GROUP_SIZE)).toBeLessThan(BLOCK.clearance);
  }
  // The list runs PAST every reachable capacity on purpose, so that the ceiling is whatever
  // `capacityOptions` computes and never the length of an array. It has silently been the
  // binding limit twice.
  expect(Math.max(...CAPACITY_OPTIONS)).toBe(44);
  expect(Math.max(...TRACK_SHAPES.flatMap((s) => capacityOptions(s))))
    .toBeLessThan(Math.max(...CAPACITY_OPTIONS));
  // The doorway floor is no longer slack -- the tightest ring that ships (a 28-cell circle at
  // 0.280) clears it by 0.01, which is deliberate: ROW_SPACING_MIN came down to 0.27 to let it
  // through, and what it still has to protect is GAP_ARC below it.
  for (const shape of TRACK_SHAPES) {
    for (const c of capacityOptions(shape)) {
      expect(new TrackPath(shape).rowSpacing(c)).toBeGreaterThan(ROW_SPACING_MIN);
    }
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

test('every shape has room for the five batches the curve opens with', () => {
  // The curve's first two levels show five waiting batches a side, which is the most
  // information the game ever gives the player at once. It is affordable because the ring
  // narrowed to 1.85: at 2.15 a rounded rectangle had room for four.
  for (const shape of TRACK_SHAPES) {
    expect(maxLookahead(shape)).toBeGreaterThanOrEqual(5);
  }
});

test('lookahead tops out where the channel would leave the visible width', () => {
  // Nothing to do with capacity: with a multiple-of-four ring the entry always lands at
  // t=0.25, so what a shape allows is decided by how far out its quarter point sits. The
  // hexagon and the trapezoid dock closest to the centre of the four quadrilaterals, so they
  // are the ones that pick up the extra batch each time LANE.step comes down.
  const EXPECTED: Record<TrackShape, number> = {
    rect: 7, hex: 7, trap: 8, oval: 7, circle: 9,
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
  // lands on a curved stretch with the normal tilted 24 degrees -- a channel shoved
  // diagonally off screen. It is also the ONLY shape the rule still catches, and that is
  // worth stating rather than hiding: the polygons' corner radius has gone 0.60 -> 0.90 ->
  // 1.10 to let the ring pack tighter, and the rounder they get the flatter their quarter
  // points, so hex-at-18 -- the other original case -- now sits at 0.24 and passes. The oval
  // has no fillet to round, so it is the one that keeps the rule honest.
  const oval = new TrackPath('oval');
  expect(Math.abs(oval.normalAt(entryIndex(14, 7, 'near') / 14).y)).toBeGreaterThan(ENTRY_NORMAL_MAX);
  const hex = new TrackPath('hex');
  expect(Math.abs(hex.normalAt(entryIndex(18, 9, 'near') / 18).y)).toBeLessThan(ENTRY_NORMAL_MAX);
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
