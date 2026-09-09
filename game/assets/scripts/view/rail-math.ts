/**
 * The level rail's arithmetic: where a stop sits, which one a release lands on, and how far
 * from the centre each one is.
 *
 * A FILE OF ITS OWN, and pure, because this is the half of a drag gesture that actually
 * breaks. The drawing is forgiving -- a chip a few units off looks fine -- while the indices
 * are not: every bug a control like this ships is an off-by-one at the ends, a flick that
 * overshoots the last level, or a snap back to the stop you just dragged away from. Pure
 * functions mean `logic/tests/rail-math.test.ts` can pin all of that without an engine.
 *
 * It imports nothing. `home-view` owns the nodes and the touch handling; this owns the
 * numbers.
 *
 * THE COORDINATE. `offset` is how far the rail has scrolled, in canvas design units, and
 * `offset = i * RAIL_PITCH` is exactly the offset that puts stop `i` in the middle of the
 * screen. Positive velocity means "later levels are travelling toward the centre", which is
 * what a leftward drag produces -- so the view negates the finger's dx once, here at the
 * boundary, and nothing downstream has to think about it again.
 */

/**
 * Centre-to-centre spacing of the stops.
 *
 * 132 against a focused chip of 104 and a resting chip of 60: the focused one keeps 28 units
 * of daylight on each side, and two resting neighbours never touch. Tighter and the big chip
 * eats its neighbours; wider and the fifth stop falls off a 390-wide screen, which is the
 * narrowest phone this has to hold five on.
 */
export const RAIL_PITCH = 132;

/**
 * How much velocity is worth one extra stop, in offset units per second.
 *
 * 900 is about a fast thumb flick across a third of the screen. Below it a release is a
 * plain snap; every further 900 carries one more stop.
 */
export const RAIL_FLICK_UNIT = 900;

/**
 * The most stops one flick may travel.
 *
 * Three, because a rail that jumps from level 2 to level 10 on a hard swipe has thrown away
 * the player's place -- the thing they were looking at is gone and they have no idea how far
 * they went. Capping it keeps a flick legible as "a few along".
 */
export const RAIL_FLICK_MAX = 3;

/** How much of the finger's pull shows past either end. See `railRubber`. */
const RUBBER = 0.32;

/** The offset that centres stop `i`. */
export function railOffset(i: number): number {
    return i * RAIL_PITCH;
}

/** The stop `offset` is closest to, clamped into the levels that exist. */
export function railNearest(offset: number, count: number): number {
    const i = Math.round(offset / RAIL_PITCH);
    return Math.max(0, Math.min(count - 1, i));
}

/**
 * Which stop a release lands on: the nearest one, plus however many a flick carries.
 *
 * The step count comes from velocity rather than from integrating a friction curve, and that
 * is a deliberate simplification: a flick that advances a legible few stops and then eases
 * into place feels like momentum without a physics loop to keep stable. `RAIL_FLICK_MAX`
 * bounds it and the clamp keeps it on a level that exists.
 */
export function railFlick(offset: number, velocity: number, count: number): number {
    const steps = Math.max(
        -RAIL_FLICK_MAX,
        Math.min(RAIL_FLICK_MAX, Math.round(velocity / RAIL_FLICK_UNIT)),
    );
    return Math.max(0, Math.min(count - 1, railNearest(offset, count) + steps));
}

/**
 * The offset to actually DRAW, given the one the finger is asking for.
 *
 * Inside the rail's range they are the same: the rail tracks the finger one-for-one, which
 * is the only thing that reads as direct manipulation. Past either end it follows at
 * `RUBBER` of the pull -- so the end is obviously an end, while the rail still moves, which
 * a hard clamp does not. Monotonic in the overshoot, so pulling further always shows
 * further.
 */
export function railRubber(offset: number, count: number): number {
    const last = railOffset(count - 1);
    if (offset < 0) return offset * RUBBER;
    if (offset > last) return last + (offset - last) * RUBBER;
    return offset;
}

/**
 * How far stop `i` is from the centre, in PITCHES -- 0 for the focused one, 1 for its
 * neighbour, and fractional while a finger is moving.
 *
 * Continuous on purpose: the view turns this into scale and opacity, and a stepped value
 * would make the chips snap between sizes mid-drag instead of growing as they arrive.
 */
export function railStopT(offset: number, i: number): number {
    return Math.abs(railOffset(i) - offset) / RAIL_PITCH;
}
