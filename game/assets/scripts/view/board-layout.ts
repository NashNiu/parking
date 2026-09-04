import { Vec3 } from 'cc';
import { Cap, CAP_BOX, CAR_SCALE } from '../core/index';

/**
 * How far the board is tipped back from the camera, in degrees. It lives here, in the module
 * about board geometry, because more than one part of the view has to know about it.
 *
 * ZERO REPRODUCES THE FLAT BOARD EXACTLY. Everything derived from it collapses to what it was,
 * so this is the single number to put back if the tilt has to go.
 *
 * WHY THE BOARD TILTS AND NOT THE CAMERA: the camera stays orthographic and pointed down world
 * -Z, and `boardRoot` carries the rotation. Same picture, and it keeps `placeCamera` and the
 * HUD's board-point projections as simple as they were.
 *
 * WHAT IT COSTS, all of it accounted for rather than discovered:
 *
 *  - The board FORESHORTENS by cos(tilt) up the screen, so `viewFrame` and `fitCamera` have to
 *    convert between board units and world units instead of treating them as the same thing. At
 *    38 degrees that is 21%.
 *  - EVERY UP-FACING SURFACE TURNS TOWARD THE KEY LIGHT, which is easy to miss because nothing
 *    in the scene moved relative to anything else. A roof's normal against the light goes from
 *    cos(light pitch) to cos(light pitch - tilt): 0.574 to 0.956 here, 67% more light on every
 *    roof in the game. The first build at this tilt came back as "the roofs look white", and the
 *    fix is in `setupEnvironment` -- the key light is simply too strong for a tilted board.
 *  - HEIGHT BECOMES VISIBLE, which is the point. It also means a car is drawn CAR_HEIGHT *
 *    tan(tilt) up-screen of the footprint core reasons about, so `onTap` subtracts that back
 *    out; see ROOF_RISE. It is EXACT rather than approximate, and only because the camera is
 *    orthographic: every car shifts by the same vector, so nothing is scaled and no two cars
 *    shift differently. A perspective camera's error was position-dependent, which is what made
 *    it unfixable; see the projection note in `buildBoard`.
 *  - ANY Z USED PURELY TO ORDER THE DRAW now moves on screen, by z * sin(tilt). Every value in
 *    the scene was swept for this. The layering ones are all inside +-0.5 (the ground panel at
 *    -0.5, the lot at -0.13, the track band at -0.09, a car's plates 0.008 apart), so they move
 *    at most 0.25 world units and mostly under 0.05. TWO were not: DRIVE_LIFT, which was 1.2
 *    because nothing bounded it, and PAX_DEPTH, which was 2.1 and would have sheared the whole
 *    ring up the screen. Both are dealt with where they are declared.
 */
// Typed as `number` rather than left to infer the literal 30: PAX_DEPTH compares against 0, and
// the inferred literal type makes TypeScript call that comparison impossible.
export const BOARD_TILT: number = 38;

/** cos of the tilt: board units up the screen per world unit, and the factor `fitCamera` needs. */
export const TILT_COS = Math.cos(BOARD_TILT * Math.PI / 180);

/** tan of the tilt: board units up the screen per world unit of HEIGHT. */
export const TILT_TAN = Math.tan(BOARD_TILT * Math.PI / 180);

/**
 * Board coordinates to world positions for the parking lot.
 *
 * Replaces GridLayout, and is a good deal less work than it was: the board's origin IS the
 * lot's centre and its +Y is world +Y, so this is a pure scale. GridLayout had to negate Y
 * because core numbered its rows from the top, and had to turn a footprint in cells into a
 * size in world units. Neither exists any more -- a car's size is its body, and its
 * position is already a position.
 *
 * `scale` is world units per board unit -- no longer a fixed number: `buildBoard` sizes it
 * from the lot's own dimensions against the frame the screen's shape leaves (see
 * `viewFrame`), so one board unit is worth 0.99 world units on a phone and 0.57 in a squat
 * editor preview window. It began life as the pitch of the old 9x6 grid, which is why
 * `toWorld` once landed a car on the same world point `cellCenter` gave its equivalent
 * cell; that coincidence is spent, and nothing depends on it.
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
