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
    const box = inflate(carBox(car), CLEARANCE);
    const { dx, dy } = heading(car);
    const range = Math.hypot(lot.w, lot.h) + CAP_BOX.big.len * CAR_SCALE;
    let best: Blockage | null = null;
    for (const other of cars) {
        if (other.id === car.id) continue;
        const t = sweepHit(box, carBox(other), dx, dy);
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
