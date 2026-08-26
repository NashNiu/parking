import { Node, Color, MeshRenderer } from 'cc';
import { CAP_BOX, CAR_SCALE, CarSpec, Lot } from '../core/index';
import { boxPart, MeshPart, mergeParts } from './slabs';
import { alphaMaterial } from './materials';
import { BoardLayout } from './board-layout';

/**
 * The ground line running out in front of each car, along the direction it would drive.
 *
 * This is the answer the spec reserved for exactly this problem (section 4: if diagonal
 * occlusion turns out to be unreadable, the fix is a ground guide line per car, NOT a
 * retreat to four directions). It is here because the readability failure was measured
 * rather than guessed at: across the ten levels, 45 of the 250 blocked cars (18%) have more
 * than 20 screen px of genuinely empty lane ahead of them, 29 have more than 33 px, and the
 * worst has 120 px of clear road before it meets a bus 185 px away. "It looks like it can
 * get through" was an ACCURATE reading of the near space every time -- what the eye could
 * not do was follow a diagonal far enough to find what was actually in the way.
 *
 * The roof arrow already gives the heading, but an arrow one car long does not carry the eye
 * two or three car lengths down the board. This does.
 *
 * It deliberately runs to the EDGE of the lot rather than stopping at the blocker: where it
 * stops is the answer to the puzzle, and the player is meant to work that out by seeing what
 * the line crosses. (`blockerRing` names the blocker, but only after a tap has been refused.)
 *
 * Drawn as one tapering mesh per car in the car's own colour: tapering so a lot full of
 * these reads as directions rather than as a grid of wires, and coloured so a player can
 * pick out the line belonging to the car they are looking at. One node and one draw call
 * each -- the taper is segments of a single merged mesh, not stacked translucent quads.
 */

/** Between the car contact shadows (-0.06) and the lot's dashed border (-0.08). */
const GUIDE_Z = -0.07;

/** Board units. Past this the taper has thinned to nothing anyway. */
const MAX_RUN = 3.0;

/** Segment thicknesses in world units, nose outward. */
const TAPER = [0.075, 0.058, 0.042, 0.028, 0.016];

/** How visible a line is. Low on purpose: 36 of these share the lot. */
const GUIDE_ALPHA = 70;

/**
 * How far a ray from `(x, y)` along `(dx, dy)` runs before it leaves the `w` x `h` lot, in
 * board units. Exported because the debug overlay draws the same run for a clear car.
 */
export function laneRunToEdge(
    x: number, y: number, dx: number, dy: number, w: number, h: number,
): number {
    let t = Infinity;
    if (Math.abs(dx) > 1e-9) {
        t = Math.min(t, Math.max((w / 2 - x) / dx, (-w / 2 - x) / dx));
    }
    if (Math.abs(dy) > 1e-9) {
        t = Math.min(t, Math.max((h / 2 - y) / dy, (-h / 2 - y) / dy));
    }
    return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** Name the guide is parented under, so the owning car can drop it again. */
export const GUIDE_NODE = 'lane-guide';

/**
 * The guide for one car, to be parented to the car's ROOT -- which is unrotated and
 * unscaled, so the line neither inherits the body's heading twice nor gets stretched by the
 * squash tween. The node carries the heading itself.
 */
export function buildLaneGuide(car: CarSpec, lot: Lot, layout: BoardLayout): Node {
    const r = car.angle * Math.PI / 180;
    const run = Math.min(
        MAX_RUN, laneRunToEdge(car.x, car.y, Math.cos(r), Math.sin(r), lot.w, lot.h),
    );
    const nose = CAP_BOX[car.cap].len * CAR_SCALE * layout.scale / 2;
    const total = run * layout.scale;

    const parts: MeshPart[] = [];
    const seg = total / TAPER.length;
    for (let i = 0; i < TAPER.length; i++) {
        // Each segment overlaps the next by a hair, or the taper reads as dashes.
        parts.push(boxPart(seg * 1.02, TAPER[i], 0.02, nose + seg * (i + 0.5), 0));
    }

    const node = new Node(GUIDE_NODE);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = mergeParts(parts);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    node.setPosition(0, 0, GUIDE_Z);
    node.setRotationFromEuler(0, 0, car.angle);
    return node;
}

/** Paint a built guide. Separate so the caller owns the colour lookup. */
export function paintLaneGuide(guide: Node, color: Color): void {
    const mr = guide.getComponent(MeshRenderer);
    if (mr) mr.material = alphaMaterial(new Color(color.r, color.g, color.b, GUIDE_ALPHA));
}
