import { carBox, heading, pathClear, firstBlocker } from '../../game/assets/scripts/core/move-solver';
import { CarSpec, CAP_BOX, CLEARANCE } from '../../game/assets/scripts/core/types';
import { inflate, overlapMTV } from '../../game/assets/scripts/core/geometry';

const LOT = { w: 9, h: 6 };
const car = (over: Partial<CarSpec>): CarSpec => ({
  id: 1, x: 0, y: 0, angle: 0, color: 'red', cap: 'small', ...over,
});

/** Where two nose-to-tail cars first touch, clearance included. */
const contact = (gapBetweenCentres: number): number =>
  gapBetweenCentres - (CAP_BOX.small.len + 2 * CLEARANCE) / 2 - CAP_BOX.small.len / 2;

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

test('a lane narrower than the clearance is not a lane', () => {
  // Two cars leaving a slot exactly one small-car width wide: without the clearance
  // the mover would fit, with it it does not.
  const w = CAP_BOX.small.wid;
  const a = car({ id: 1, x: -3, y: 0, angle: 0 });
  const up = car({ id: 2, x: 0, y: w, angle: 0 });
  const down = car({ id: 3, x: 0, y: -w, angle: 0 });
  expect(pathClear(a, [a, up, down], LOT)).toBe(false);
});

test('a lane with the clearance to spare is a lane', () => {
  const w = CAP_BOX.small.wid + CLEARANCE + 0.02;
  const a = car({ id: 1, x: -3, y: 0, angle: 0 });
  const up = car({ id: 2, x: 0, y: w, angle: 0 });
  const down = car({ id: 3, x: 0, y: -w, angle: 0 });
  expect(pathClear(a, [a, up, down], LOT)).toBe(true);
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
