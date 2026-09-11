import { OBB } from './geometry';
import { CAP_BOX, CAR_SCALE, CarSpec, CLEARANCE, TunnelSpec, TUNNEL_BOX } from './types';

/**
 * The three boxes a tunnel puts on the board. Deliberately ignorant of `LotSystem` and of
 * levels: it takes a `TunnelSpec` and answers with geometry, which is what lets the packer,
 * the validator and the solver all ask the same questions and get the same answers.
 */

/** The tunnel BODY: the part that blocks. */
export function tunnelBox(t: TunnelSpec): OBB {
    return { x: t.x, y: t.y, angle: t.angle, len: TUNNEL_BOX.len, wid: TUNNEL_BOX.wid };
}

/**
 * The car currently standing at the mouth, or null when the tunnel is drained.
 *
 * It sits one CLEARANCE in front of the body's front face, and that gap is what keeps the
 * tunnel from blocking its own car. `sweepHit` reports null for contact strictly behind the
 * mover, so a car driving along `angle` never sees the body it just came out of -- but only
 * as long as the two do not OVERLAP, because overlapping boxes report 0 whatever the
 * heading. The clearance is what guarantees they do not.
 */
export function mouthCar(t: TunnelSpec, id: number): CarSpec | null {
    const head = t.cars[0];
    if (!head) return null;
    const r = t.angle * Math.PI / 180;
    const d = TUNNEL_BOX.len / 2 + CLEARANCE + CAP_BOX[head.cap].len * CAR_SCALE / 2;
    return {
        id,
        x: t.x + Math.cos(r) * d,
        y: t.y + Math.sin(r) * d,
        angle: t.angle,
        color: head.color,
        cap: head.cap,
    };
}

/**
 * The footprint the packer must keep clear: the body with a mouth car's worth of room at
 * BOTH ends, so it stays valid whichever of the two headings the tunnel is later aimed
 * down.
 *
 * Symmetric on purpose, and it costs about 1.7 small cars of board per tunnel. The saving
 * -- reserving only the end the mouth is on -- would force the heading to be chosen BEFORE
 * the lot is packed, and whether a mouth has a clear lane is not knowable until after. A
 * tunnel welded shut from the first frame shows a count the player cannot spend, which
 * reads as a bug. Reserving both ends buys the same two-headings-per-placement freedom
 * `headingsFor` gives every car, and for the same reason: a rectangle turned a half turn
 * covers the same board.
 *
 * Sized by the LONGEST car in the queue rather than by `small`. The generator only ever
 * loads small cars today; this is what stops that assumption from being silently baked into
 * the geometry.
 */
export function tunnelReservation(t: TunnelSpec): OBB {
    let longest = 0;
    for (const c of t.cars) longest = Math.max(longest, CAP_BOX[c.cap].len * CAR_SCALE);
    return {
        x: t.x,
        y: t.y,
        angle: t.angle,
        len: TUNNEL_BOX.len + 2 * (CLEARANCE + longest),
        wid: TUNNEL_BOX.wid,
    };
}
