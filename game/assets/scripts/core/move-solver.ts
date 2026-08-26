import { inflate, OBB, sweepHit } from './geometry';
import { CAP_BOX, CarSpec, CAR_SCALE, CLEARANCE, Lot } from './types';

/** The oriented box a car occupies: its model's size at its own heading. */
export function carBox(car: CarSpec): OBB {
    const b = CAP_BOX[car.cap];
    return {
        x: car.x,
        y: car.y,
        angle: car.angle,
        len: b.len * CAR_SCALE,
        wid: b.wid * CAR_SCALE,
    };
}

/** Unit vector a car drives along. */
export function heading(car: CarSpec): { dx: number; dy: number } {
    const r = car.angle * Math.PI / 180;
    return { dx: Math.cos(r), dy: Math.sin(r) };
}

/** The car in `car`'s way, and how far it can go before touching it. */
export interface Blockage {
    carId: number;
    /**
     * Board units of clear board ahead. 0 means "nowhere to go", which covers more than
     * touching: `sweepHit` returns 0 whenever the two boxes ALREADY OVERLAP, and it does
     * so regardless of heading. So a gap of 0 can name a blocker that is BEHIND the
     * mover, and in a column packed tighter than CLEARANCE every car reports blocked --
     * the frontmost one included, with nothing at all in front of it.
     *
     * On a lot that satisfies the clearance rule this can no longer happen, because the
     * sweep below now inflates the pair the way `validateLevel` inflates it -- half each --
     * so boxes that passed validation cannot be overlapping when the sweep starts. Splitting
     * the clearance unevenly is what used to break that: see `firstBlocker`.
     *
     * `firstBlocker` is therefore only MEANINGFUL on a lot where every pair of cars is at
     * least CLEARANCE apart. That is not something this function can check; it is an
     * invariant the lot has to arrive with, and Task 4's gap validation is what makes it
     * sound. A lot that violates it gets answers that are arithmetically correct and
     * gameplay nonsense.
     */
    gap: number;
}

/**
 * The nearest car blocking `car`'s exit, or null when it can drive out.
 *
 * The mover is grown by CLEARANCE before the sweep, so a lane too narrow to be worth
 * calling a lane is not one. `cars` may include `car` itself; it is skipped by id.
 *
 * There is no need to work out where the car leaves the lot. Every car is INSIDE the
 * lot, so any contact happens before the mover has covered the lot's diagonal plus one
 * car length; anything the sweep reports past that is arithmetic noise, not a car.
 */
export function firstBlocker(car: CarSpec, cars: CarSpec[], lot: Lot): Blockage | null {
    // HALF a clearance on the mover and half on each candidate, which is the SAME predicate
    // validateLevel enforces pairwise -- not the whole clearance piled onto the mover.
    //
    // For axis-aligned boxes the two are identical: either way CLEARANCE is added to the sum
    // of the projected radii, which is why the grid era could write it whichever way it liked.
    // For ROTATED boxes they part company. Growing a box by d adds d * (|n.u| + |n.v|) to its
    // radius on axis n -- d when the box is square-on to n, d * sqrt(2) at 45 degrees. So the
    // whole clearance on one box reaches as much as sqrt(2) * CLEARANCE where splitting it
    // between the pair reaches as little as CLEARANCE, and a pair the level rule had passed
    // could still overlap here. `sweepHit` answers 0 for boxes that already overlap WHATEVER
    // the heading, so the mover came back blocked by a car it was driving away from: 15 of
    // the 360 cars across the ten shipped levels, every one of them with a gap of exactly 0
    // and a "blocker" between 128 and 159 degrees off its own nose.
    const box = inflate(carBox(car), CLEARANCE / 2);
    const { dx, dy } = heading(car);
    const range = Math.hypot(lot.w, lot.h) + CAP_BOX.big.len * CAR_SCALE;
    // Circumscribed radius: no corner of a box sits farther than this from its own centre,
    // whichever way the box is facing.
    const halfDiag = (o: OBB) => Math.hypot(o.len / 2, o.wid / 2);
    const boxHalfDiag = halfDiag(box);
    let best: Blockage | null = null;
    for (const other of cars) {
        if (other.id === car.id) continue;
        // Broad-phase reject before the swept SAT test below, which is the expensive part
        // (four projected-axis checks) called O(n) times per mover, O(n) movers per round,
        // O(n) rounds per peel. `perp` is the perpendicular distance from `other`'s centre
        // to the infinite line through `car`'s centre along (dx, dy) -- the lane the swept
        // box's centre travels along. That distance does not change as the mover slides
        // along the lane, and along the lane the SWEPT box never carries any of its own
        // corners farther than `boxHalfDiag` off that line, whatever `t` is. So if `other`'s
        // centre is already farther off the lane than the two boxes' circumscribed radii add
        // up to, neither box's corners can reach the other's at any point of the sweep, and
        // `sweepHit` would have to say so too -- this cannot discard a genuine blocker, only
        // skip the arithmetic that would have proven the same negative.
        // Grown by the other half of the clearance, so the pair of inflated boxes is exactly
        // the pair validateLevel checked. The broad-phase bound below must measure THIS box
        // and not the bare one, or it would be reading a smaller radius than the narrow phase
        // goes on to use and could reject a genuine blocker.
        const otherBox = inflate(carBox(other), CLEARANCE / 2);
        const perp = Math.abs((other.x - car.x) * dy - (other.y - car.y) * dx);
        if (perp > boxHalfDiag + halfDiag(otherBox)) continue;
        const t = sweepHit(box, otherBox, dx, dy);
        if (t === null || t > range) continue;
        if (!best || t < best.gap) best = { carId: other.id, gap: t };
    }
    return best;
}

/**
 * Whether the car can drive out. Derived from `firstBlocker` rather than implemented a
 * second time: the two used to be separate walks of the same rule, which is one rule
 * too many to keep in agreement.
 */
export function pathClear(car: CarSpec, cars: CarSpec[], lot: Lot): boolean {
    return firstBlocker(car, cars, lot) === null;
}
