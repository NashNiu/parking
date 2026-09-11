import {
  RAIL_FLICK_MAX, RAIL_FLICK_UNIT, RAIL_PITCH, railFlick, railNearest, railOffset, railRubber,
  railStopT,
} from '../../game/assets/scripts/view/rail-math';

/**
 * The level rail's arithmetic, which is the whole risky half of a drag gesture: the drawing
 * is forgiving and the indices are not. Every bug this kind of control ships is in here --
 * off by one at the ends, a flick that overshoots the last level, a snap that picks the stop
 * you just dragged away from.
 *
 * `offset` is how far the rail is scrolled, in design units, and `offset = i * PITCH` is
 * exactly the offset that puts stop `i` in the middle of the screen. Positive velocity means
 * "later levels are coming toward the centre", which is what dragging leftward produces.
 */

test('an index maps to the offset that centres it', () => {
  expect(railOffset(0)).toBe(0);
  expect(railOffset(1)).toBe(RAIL_PITCH);
  expect(railOffset(9)).toBe(9 * RAIL_PITCH);
});

test('the nearest stop is the one the rail is closest to, and never off the ends', () => {
  expect(railNearest(0, 10)).toBe(0);
  expect(railNearest(RAIL_PITCH * 3, 10)).toBe(3);
  // Just short of halfway still belongs to the stop behind it; just past it moves on.
  expect(railNearest(RAIL_PITCH * 3.49, 10)).toBe(3);
  expect(railNearest(RAIL_PITCH * 3.51, 10)).toBe(4);
  // Dragged past either end -- which rubber banding allows -- it clamps.
  expect(railNearest(-RAIL_PITCH * 2, 10)).toBe(0);
  expect(railNearest(RAIL_PITCH * 99, 10)).toBe(9);
  // A one-level game has exactly one answer.
  expect(railNearest(RAIL_PITCH * 5, 1)).toBe(0);
});

test('releasing without a flick snaps to the nearest stop', () => {
  expect(railFlick(RAIL_PITCH * 2.2, 0, 10)).toBe(2);
  expect(railFlick(RAIL_PITCH * 2.8, 0, 10)).toBe(3);
  // Slower than one step's worth of speed is not a flick.
  expect(railFlick(RAIL_PITCH * 2.1, RAIL_FLICK_UNIT * 0.4, 10)).toBe(2);
});

test('a flick carries on, faster carries further, and the cap holds', () => {
  const at2 = RAIL_PITCH * 2;
  expect(railFlick(at2, RAIL_FLICK_UNIT, 10)).toBe(3);
  expect(railFlick(at2, RAIL_FLICK_UNIT * 2, 10)).toBe(4);
  // However hard it is thrown, it advances at most RAIL_FLICK_MAX stops -- a rail that
  // shoots from level 2 to level 10 has lost the player's place.
  expect(railFlick(at2, RAIL_FLICK_UNIT * 40, 10)).toBe(2 + RAIL_FLICK_MAX);
  // Backwards.
  expect(railFlick(RAIL_PITCH * 5, -RAIL_FLICK_UNIT * 2, 10)).toBe(3);
});

test('a flick at either end stops at the end rather than off it', () => {
  expect(railFlick(RAIL_PITCH * 8, RAIL_FLICK_UNIT * 40, 10)).toBe(9);
  expect(railFlick(RAIL_PITCH * 1, -RAIL_FLICK_UNIT * 40, 10)).toBe(0);
  expect(railFlick(0, -RAIL_FLICK_UNIT * 5, 10)).toBe(0);
});

/**
 * Rubber banding is what makes the ends feel like ends. Inside the range the finger moves
 * the rail one-for-one; past it, the rail follows at a fraction of the finger, so it is
 * obvious there is nothing further without the drag simply jamming.
 */
test('the rail follows the finger exactly inside its range', () => {
  const mid = RAIL_PITCH * 4.37;
  expect(railRubber(mid, 10)).toBeCloseTo(mid, 6);
  expect(railRubber(0, 10)).toBe(0);
  expect(railRubber(RAIL_PITCH * 9, 10)).toBeCloseTo(RAIL_PITCH * 9, 6);
});

test('past either end the rail follows at a fraction, and never runs away', () => {
  const over = railRubber(-RAIL_PITCH, 10);
  expect(over).toBeLessThan(0);
  expect(over).toBeGreaterThan(-RAIL_PITCH);
  // Monotonic: pulling further always shows further, or the rail would feel stuck.
  expect(railRubber(-RAIL_PITCH * 2, 10)).toBeLessThan(over);
  const past = railRubber(RAIL_PITCH * 10, 10);
  expect(past).toBeGreaterThan(RAIL_PITCH * 9);
  expect(past).toBeLessThan(RAIL_PITCH * 10);
});

/**
 * `railStopT` is the distance from the centre in PITCHES, and it is what the view turns into
 * scale and opacity -- so it has to be continuous while a finger is moving, not stepped.
 */
test('the focused stop reads zero and its neighbours read one', () => {
  expect(railStopT(RAIL_PITCH * 3, 3)).toBe(0);
  expect(railStopT(RAIL_PITCH * 3, 4)).toBe(1);
  expect(railStopT(RAIL_PITCH * 3, 2)).toBe(1);
  expect(railStopT(RAIL_PITCH * 3, 6)).toBe(3);
  // Mid-drag, halfway between two stops, both read half.
  expect(railStopT(RAIL_PITCH * 3.5, 3)).toBeCloseTo(0.5, 6);
  expect(railStopT(RAIL_PITCH * 3.5, 4)).toBeCloseTo(0.5, 6);
});
