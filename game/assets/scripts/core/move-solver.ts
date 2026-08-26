import { OBB, sweepHit } from './geometry';
import { CAP_BOX, CarSpec, CAR_SCALE, Lot } from './types';

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
     * Board units of clear board ahead. 0 would mean "nowhere to go", which covers more
     * than touching: `sweepHit` returns 0 whenever the two boxes ALREADY OVERLAP, and it
     * does so regardless of heading -- so a gap of 0 could name a blocker BEHIND the mover.
     *
     * That cannot arise now. The sweep uses BARE bodies, and `validateLevel` keeps every
     * parked pair a whole CLEARANCE apart, so nothing overlaps when the sweep starts and
     * every gap reported is strictly positive.
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
 * Bodies only -- see the note inside on why the lane demands no clearance margin. `cars`
 * may include `car` itself; it is skipped by id.
 *
 * There is no need to work out where the car leaves the lot. Every car is INSIDE the
 * lot, so any contact happens before the mover has covered the lot's diagonal plus one
 * car length; anything the sweep reports past that is arithmetic noise, not a car.
 */
export function firstBlocker(car: CarSpec, cars: CarSpec[], lot: Lot): Blockage | null {
    // BARE bodies, no clearance margin: a car goes if its body would clear whatever is
    // beside its lane, however fine the margin. Requiring a margin here was measured and
    // rejected -- with CLEARANCE (0.04 board units, about 2.6 screen px) demanded of the
    // lane, 18 of the 250 blocked cars across the ten levels would actually have squeezed
    // past, the widest real daylight refused being 2.7 px. A threshold that fine cannot be
    // seen, so every car sitting near it looked passable and was not.
    //
    // The trade is deliberate and runs the other way now: a car may thread a gap with a
    // margin too fine to see, which can read as scraping. What it will never do is refuse a
    // gap that is genuinely open. See CLEARANCE in types.ts for where the margin still
    // applies -- laying out a parked lot, and how forgiving a tap is.
    const box = carBox(car);
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
        const otherBox = carBox(other);
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
