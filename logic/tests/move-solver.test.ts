import { carBox, heading, pathClear, firstBlocker } from '../../game/assets/scripts/core/move-solver';
import { CarSpec, CAP_BOX, CLEARANCE } from '../../game/assets/scripts/core/types';
import { inflate, overlapMTV } from '../../game/assets/scripts/core/geometry';

const LOT = { w: 9, h: 6 };
const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 0, color: 'red', cap: 'small', ...over,
});

/**
 * Where two nose-to-tail cars' BODIES first touch. No clearance term: the lane test asks
 * only whether the bodies would collide. CLEARANCE governs how a parked lot is laid out
 * (`validateLevel`, `packBox`) and how forgiving a tap is (`pickCar`), not how much daylight
 * a moving car needs.
 */
const contact = (gapBetweenCentres: number): number =>
  gapBetweenCentres - CAP_BOX.small.len;

test('a car box is its model size at its own heading', () => {
  const b = carBox(car({ x: 1, y: 2, angle: 90 }));
  expect(b.x).toBe(1);
  expect(b.y).toBe(2);
  expect(b.angle).toBe(90);
  expect(b.len).toBeCloseTo(CAP_BOX.small.len, 6);
  expect(b.wid).toBeCloseTo(CAP_BOX.small.wid, 6);
});

test('a big car has a bigger box than a small one', () => {
  expect(carBox(car({ cap: 'big' })).len).toBeGreaterThan(carBox(car({ cap: 'small' })).len);
});

test('heading points the way the angle says', () => {
  expect(heading(car({ angle: 0 })).dx).toBeCloseTo(1, 6);
  expect(heading(car({ angle: 90 })).dy).toBeCloseTo(1, 6);
  expect(heading(car({ angle: 180 })).dx).toBeCloseTo(-1, 6);
});

test('an empty lot lets a car out whatever way it points', () => {
  for (const angle of [0, 37, 90, 180, 254, 359]) {
    expect(pathClear(car({ angle }), [car({ angle })], LOT)).toBe(true);
  }
});

test('a car in the way blocks the lane', () => {
  const a = car({ id: 1, x: -2, y: 0, angle: 0 });
  const b = car({ id: 2, x: 1, y: 0, angle: 0 });
  expect(pathClear(a, [a, b], LOT)).toBe(false);
});

test('the same car pointing the other way is not blocked', () => {
  const a = car({ id: 1, x: -2, y: 0, angle: 180 });
  const b = car({ id: 2, x: 1, y: 0, angle: 0 });
  expect(pathClear(a, [a, b], LOT)).toBe(true);
});

test('a car far enough to the side does not block', () => {
  const a = car({ id: 1, x: -2, y: 0, angle: 0 });
  const b = car({ id: 2, x: 1, y: 1, angle: 0 });
  expect(pathClear(a, [a, b], LOT)).toBe(true);
});

test('the blocker report says which car and how much room is left', () => {
  const a = car({ id: 1, x: -2, y: 0, angle: 0 });
  const b = car({ id: 2, x: 1, y: 0, angle: 0 });
  const block = firstBlocker(a, [a, b], LOT);
  expect(block).not.toBeNull();
  expect(block!.carId).toBe(2);
  expect(block!.gap).toBeCloseTo(contact(3), 4);
});

test('the nearest blocker is the one reported', () => {
  const a = car({ id: 1, x: -3, y: 0, angle: 0 });
  const near = car({ id: 2, x: 0, y: 0, angle: 0 });
  const far = car({ id: 3, x: 2, y: 0, angle: 0 });
  expect(firstBlocker(a, [a, near, far], LOT)!.carId).toBe(2);
});

/** A channel between two cars parked either side of the lane, `w` off the centreline. */
const channel = (w: number): CarSpec[] => [
  car({ id: 2, x: 0, y: w, angle: 0 }),
  car({ id: 3, x: 0, y: -w, angle: 0 }),
];

test('a channel the body exactly fits is a lane', () => {
  // The channel's clear width is 2w - small.wid, and the mover needs small.wid of it, so
  // w = small.wid is exactly flush. Flush counts as apart (see `sweepHit`), so it goes --
  // and it goes with NO daylight, which is the deliberate trade: the lane demands no
  // clearance margin, only that the bodies miss. Room to spare naturally also goes.
  const a = car({ id: 1, x: -3, y: 0, angle: 0 });
  expect(pathClear(a, [a, ...channel(CAP_BOX.small.wid)], LOT)).toBe(true);
  expect(pathClear(a, [a, ...channel(CAP_BOX.small.wid + CLEARANCE)], LOT)).toBe(true);
});

test('a channel narrower than the body is not a lane', () => {
  const a = car({ id: 1, x: -3, y: 0, angle: 0 });
  expect(pathClear(a, [a, ...channel(CAP_BOX.small.wid - 0.01)], LOT)).toBe(false);
});

test('a car does not block itself', () => {
  const a = car({ id: 1, x: 0, y: 0, angle: 0 });
  expect(firstBlocker(a, [a], LOT)).toBeNull();
});

test('a blocker is never missed, whatever angle it sits at or how far off the lane', () => {
  // firstBlocker skips a candidate whose centre sits farther off the mover's lane than the
  // two bodies' circumscribed radii add up to -- cheap arithmetic that spares the four
  // projected-axis checks of a swept SAT test, which is the hot path when a level is
  // generated. The bound is deliberately loose: it never fires anywhere near a real
  // contact, so no single case can pin its exact value, and a test that tried would be
  // asserting an implementation detail.
  //
  // What CAN be pinned is the guarantee the bound must not break: a null answer has to
  // mean the bodies genuinely never meet. So for a spread of blocker angles and lane
  // offsets, whenever firstBlocker reports nothing, walk the mover down its own lane and
  // check that nothing was there to hit. Dropping the blocker's own radius from the bound
  // -- the obvious way to get this wrong -- makes 29 of these 40 cases report a blocker
  // that is really there as absent, and every one of them fails here.
  const mover = car({ id: 1, x: -4, y: 0, angle: 0 });
  for (const angle of [0, 23, 45, 67, 90, 134, 200, 300]) {
    for (const offset of [0, 0.2, 0.4, 0.6, 0.75, 0.8, 1.0, 1.2]) {
      const blocker = car({ id: 2, x: 0, y: offset, angle, cap: 'big' });
      if (firstBlocker(mover, [mover, blocker], LOT)) continue;
      const body = inflate(carBox(mover), CLEARANCE);
      for (let t = 0; t <= 9; t += 0.25) {
        expect(overlapMTV({ ...body, x: body.x + t }, carBox(blocker))).toBeNull();
      }
    }
  }
});

test('a diagonal lane is checked along the diagonal, not along the axes', () => {
  // A blocker due east does not stand in a north-east lane.
  const a = car({ id: 1, x: -2, y: -2, angle: 45 });
  const east = car({ id: 2, x: 1, y: -2, angle: 0 });
  expect(pathClear(a, [a, east], LOT)).toBe(true);
  // One on the diagonal does.
  const ne = car({ id: 3, x: 0, y: 0, angle: 45 });
  expect(pathClear(a, [a, ne], LOT)).toBe(false);
});

test('a car goes if its BODY would clear the neighbour, however fine the margin', () => {
  // The rule is bodies-only: driving through a gap requires no clearance at all, so the
  // boundary sits exactly where the two bodies would touch. CLEARANCE is about how a PARKED
  // lot is laid out and how forgiving a tap is -- not about how much daylight a moving car
  // needs. This is the deliberate trade named in the README: a car may now squeeze past with
  // a margin too fine to see, in exchange for never refusing a gap that is genuinely open.
  const touch = (CAP_BOX.small.wid + CAP_BOX.big.wid) / 2;
  const a = car({ id: 1, x: 0, y: 0, angle: 0, cap: 'small' });
  // Placed well along the lane, so the PAIR is a legal parked pair (the level rule looks at
  // where cars stand, and these stand 3 units apart); the squeeze happens only once the
  // mover draws level with it.
  const clears = car({ id: 2, x: 3, y: touch + 0.005, angle: 0, cap: 'big' });
  const collides = car({ id: 3, x: 3, y: touch - 0.005, angle: 0, cap: 'big' });
  expect(pathClear(a, [a, clears], LOT)).toBe(true);
  expect(pathClear(a, [a, collides], LOT)).toBe(false);
});

test('a car parked behind you is not your blocker, on a lot the level rule accepts', () => {
  // Real geometry, straight out of level 1: the pair that made a tapped car refuse to move
  // while naming a blocker 175 degrees off its own nose.
  //
  // validateLevel's rule is that each of a pair, grown by CLEARANCE/2, stays clear of the
  // other. firstBlocker used to grow the MOVER by a WHOLE clearance and sweep it against a
  // BARE neighbour. For axis-aligned boxes those are the same rule -- each adds CLEARANCE to
  // the sum of the projected radii -- which is why the grid era never saw this. For ROTATED
  // boxes they are not: growing a box by d adds d * (|n.u| + |n.v|) to its radius on axis n,
  // anywhere between d and d * sqrt(2). Piling the whole clearance onto one box can reach
  // sqrt(2) * CLEARANCE where splitting it between the two reaches as little as CLEARANCE.
  // So a pair the level rule calls legal could still overlap under the lane test -- and
  // sweepHit answers 0 for boxes that already overlap WHATEVER the heading, which is how a
  // car behind you ends up named as the thing in your way.
  const mover = car({ id: 27, x: 0.7237, y: 2.4712, angle: 29.7888, cap: 'small' });
  const behind = car({ id: 26, x: -0.5793, y: 1.8721, angle: 58.3434, cap: 'big' });

  // The pair is legal -- this line is exactly what validateLevel enforces.
  expect(overlapMTV(
    inflate(carBox(mover), CLEARANCE / 2), inflate(carBox(behind), CLEARANCE / 2),
  )).toBeNull();

  expect(firstBlocker(mover, [mover, behind], LOT)).toBeNull();
});

test('nothing parked astern is ever a blocker, at every pair of headings', () => {
  // The pathology is specific: two boxes that overlap make sweepHit answer 0 on EVERY
  // heading, so the mover reports blocked by something it is driving away from. Putting the
  // neighbour directly astern makes that unmistakable -- there is nothing ahead to find, so
  // any answer at all is the bug. Only configurations the level rule accepts are asserted
  // on; the rest are not this function's problem.
  //
  // Rotated pairs are the whole point, so both headings sweep. This failed on 84 of these
  // cases when the mover carried a whole CLEARANCE into the sweep against bare neighbours --
  // an inflation the level rule never guaranteed room for, since growing one box by d can
  // cost up to d * sqrt(2) on a diagonal axis where splitting d between the pair costs as
  // little as d. The lane sweeps BARE bodies now, so it asks for less room than the level
  // rule already reserved and the overlap cannot arise at all.
  for (const moverAngle of [0, 17, 31, 45, 62, 78, 90]) {
    const astern = (moverAngle + 180) * Math.PI / 180;
    for (const otherAngle of [0, 23, 45, 67, 90, 113, 135]) {
      const mover = car({ id: 1, x: 0, y: 0, angle: moverAngle, cap: 'small' });
      for (let d = 1.0; d <= 2.0; d += 0.02) {
        const other = car({
          id: 2, x: Math.cos(astern) * d, y: Math.sin(astern) * d, angle: otherAngle, cap: 'big',
        });
        const legal = overlapMTV(
          inflate(carBox(mover), CLEARANCE / 2), inflate(carBox(other), CLEARANCE / 2),
        ) === null;
        if (!legal) continue;
        expect(firstBlocker(mover, [mover, other], LOT)).toBeNull();
      }
    }
  }
});
