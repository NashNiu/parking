import { Node, Color } from 'cc';
import { CAP_BOX, CAR_SCALE, CarSpec, firstBlocker, Lot } from '../core/index';
import { boxPart, makeMerged, MeshPart } from './slabs';
import { BoardLayout } from './board-layout';

/**
 * Ground truth, drawn on the board: the exact box `core` reasons about for each car, and
 * which cars core currently calls blocked.
 *
 * This exists because the same class of bug has bitten twice -- the VIEW drifting away
 * from the footprint core is deciding against, while core's own arithmetic stayed correct
 * (a perspective camera projecting roofs rather than footprints; a squash tween leaving
 * bodies permanently mis-scaled). Neither was visible by reading the code, and neither was
 * reproducible from a screenshot of the cars alone, because a car IS its own drawing --
 * there was nothing on screen to compare it against. This puts the comparison on screen.
 *
 * Read it like this:
 *  - a car that does not sit centred inside its outline is drawn somewhere core is not
 *    looking. That is a view bug, and core's verdict for it will look wrong.
 *  - two cars of the same capacity always get IDENTICAL outlines. If their bodies differ
 *    while their outlines match, the bodies are wrong, not the table.
 *  - the outline sits ABOVE the cars (z = OVERLAY_Z, clear of the tallest model at 0.39).
 *    Under the orthographic camera that costs nothing -- height does not move anything
 *    sideways -- so an outline that has slid off its car is itself the proof that the
 *    projection is not orthographic.
 */

/** Clear of the tallest car (0.39) and far short of the camera's near plane (14). */
const OVERLAY_Z = 1.2;

/** Bar thickness of an outline, in world units. */
const BAR = 0.018;

/** A car core says can leave, and one it says is blocked. */
const CLEAR = new Color(0, 235, 120, 255);
const BLOCKED = new Color(255, 40, 200, 255);

function outlineParts(len: number, wid: number): MeshPart[] {
    return [
        boxPart(len, BAR, 0.02, 0, wid / 2),
        boxPart(len, BAR, 0.02, 0, -wid / 2),
        boxPart(BAR, wid, 0.02, -len / 2, 0),
        boxPart(BAR, wid, 0.02, len / 2, 0),
    ];
}

/**
 * One node holding an outline per car, ready to parent under `gridRoot` (the same frame
 * the cars live in, so the two are directly comparable).
 *
 * `cars` goes in as core holds it, and `firstBlocker` is asked the same question `canExit`
 * asks -- this reports what core actually believes, not a second opinion computed here.
 */
export function buildFootprintOverlay(
    cars: CarSpec[], lot: Lot, layout: BoardLayout,
): Node {
    const root = new Node('DebugFootprints');
    for (const car of cars) {
        const b = CAP_BOX[car.cap];
        const len = b.len * CAR_SCALE * layout.scale;
        const wid = b.wid * CAR_SCALE * layout.scale;
        const blocked = firstBlocker(car, cars, lot) !== null;
        const n = makeMerged(
            `fp-${car.id}-${car.cap}`, outlineParts(len, wid), blocked ? BLOCKED : CLEAR,
        );
        const p = layout.toWorld(car.x, car.y);
        n.setPosition(p.x, p.y, OVERLAY_Z);
        n.setRotationFromEuler(0, 0, car.angle);
        root.addChild(n);
    }
    return root;
}
