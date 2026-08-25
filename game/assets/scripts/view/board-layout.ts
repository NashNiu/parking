import { Vec3 } from 'cc';
import { Cap, CAP_BOX, CAR_SCALE } from '../core/index';

/**
 * Board coordinates to world positions for the parking lot.
 *
 * Replaces GridLayout, and is a good deal less work than it was: the board's origin IS the
 * lot's centre and its +Y is world +Y, so this is a pure scale. GridLayout had to negate Y
 * because core numbered its rows from the top, and had to turn a footprint in cells into a
 * size in world units. Neither exists any more -- a car's size is its body, and its
 * position is already a position.
 *
 * `scale` is world units per board unit. One board unit is the pitch the old 9x6 grid used,
 * which is why the camera framing and the lot slab survive this milestone untouched --
 * `toWorld` lands a car on the same world point `cellCenter` gave its equivalent cell.
 * `carSize` is the part that deliberately does NOT agree: it answers with the body's size
 * rather than the cell's, which is the whole reason this class exists.
 */
export class BoardLayout {
    constructor(public readonly scale: number) {}

    toWorld(x: number, y: number): Vec3 {
        return new Vec3(x * this.scale, y * this.scale, 0);
    }

    /**
     * World length (along the body) and width (across it) of a car of this capacity.
     *
     * Read off CAP_BOX rather than measured from the model. That is the direction the
     * dependency runs now: core's table is what a car's size IS, and the model is scaled to
     * match it. It used to run the other way -- the model's AABB was fitted into a grid cell
     * and the size fell out of the fit, which is how three vehicles ended up reading as two.
     */
    carSize(cap: Cap): { len: number; wid: number } {
        const b = CAP_BOX[cap];
        return { len: b.len * CAR_SCALE * this.scale, wid: b.wid * CAR_SCALE * this.scale };
    }
}
