import { Node, Color } from 'cc';
import { CAP_BOX, CAR_SCALE, CarSpec, firstBlocker, Lot } from '../core/index';
import { boxPart, makeMerged, MeshPart } from './slabs';
import { BoardLayout } from './board-layout';
import { laneRunToEdge } from './lane-guides';

/**
 * Ground truth, drawn on the board: the exact box `core` reasons about for each car, and
 * exactly how far core thinks that car may drive.
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
 *  - the LANE BAR ahead of each car is how far core says it gets. A green bar runs off the
 *    lot: core says that car can leave. A pink bar stops dead against the car core has
 *    named as the blocker -- follow the bar and the answer is at the end of it.
 *  - the outline sits ABOVE the cars (z = OVERLAY_Z, clear of the tallest model at 0.39).
 *    Under the orthographic camera that costs nothing -- height does not move anything
 *    sideways -- so an outline that has slid off its car is itself the proof that the
 *    projection is not orthographic.
 */

/** Clear of the tallest car (0.39) and far short of the camera's near plane (14). */
const OVERLAY_Z = 1.2;

/** Bar thickness of an outline, in world units. */
const BAR = 0.018;

/** Thickness of the lane bar. Thinner than the outline so it reads as a line, not a box. */
const LANE = 0.035;

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
 * One node holding an outline plus a lane bar per car, ready to parent under `gridRoot`
 * (the same frame the cars live in, so the two are directly comparable).
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

        const block = firstBlocker(car, cars, lot);
        const r = car.angle * Math.PI / 180;
        // Board units of clear lane ahead: what core measured, or the run to the lot's edge
        // when core found nothing in the way at all.
        const run = block
            ? block.gap
            : laneRunToEdge(car.x, car.y, Math.cos(r), Math.sin(r), lot.w, lot.h);
        const laneLen = Math.max(0.02, run * layout.scale);

        const parts = outlineParts(len, wid);
        // The lane bar lives in the CAR's frame, so it is simply a bar along +X starting at
        // the nose -- the node's own rotation puts it on the heading.
        parts.push(boxPart(laneLen, LANE, 0.02, len / 2 + laneLen / 2, 0));

        const n = makeMerged(
            `fp-${car.id}-${car.cap}`, parts, block ? BLOCKED : CLEAR,
        );
        const p = layout.toWorld(car.x, car.y);
        n.setPosition(p.x, p.y, OVERLAY_Z);
        n.setRotationFromEuler(0, 0, car.angle);
        root.addChild(n);
    }
    return root;
}
