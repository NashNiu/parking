import { Node, Color, Vec3, MeshRenderer, utils, primitives } from 'cc';
import { makeLitBox } from './placeholder';
import { litMaterial } from './materials';

/**
 * Stall footprint and pitch, in board units. A car parks nose-up, so the stall is deeper
 * than it is wide, like the reference art's.
 *
 * How deep is capped from both sides: the ring road's top lane ends at y = 0.75 and the
 * loop track's curb hangs down to y ≈ 2.15, which leaves the parking band 1.3 units to
 * live in — hence a stall shallower than the reference's, which has a much taller screen
 * to spend. How WIDE follows from that: a car scaled to a 1.06-deep stall is only about
 * 0.5 across (the models run 2:1 to 3:1), so a stall much wider than that leaves the car
 * looking lost in it. The row ends up spanning ±3.33 against a view about ±3.94 wide,
 * which is the margin the reference art has too.
 */
const SLOT_W = 0.78;
const SLOT_H = 1.06;
const PITCH = 0.98;

/** Padding from the outermost stall to the edge of the bay panel behind the row. */
const PANEL_PAD_X = 0.22;
const PANEL_PAD_Y = 0.12;

/**
 * Depths. The pads sit BEHIND the board plane (near face at -0.08) so a parked car's
 * contact shadow, which lies at z = -0.06, lands on the pad instead of inside it. The bay
 * panel sits behind the pads again, and the whole stack stays in front of the platform
 * tray (near face -0.325) and clear of the ring road, which it never overlaps in y.
 */
const PAD_Z = -0.14;
const PANEL_Z = -0.22;
const EDGE_Z = -0.09;

const PANEL = new Color(226, 230, 244);
const PAD = new Color(96, 104, 126);
const PAD_LOCKED = new Color(66, 70, 84);
const EDGE = new Color(152, 164, 192);
const LOCK_BODY = new Color(38, 42, 54);
const LOCK_SHACKLE = new Color(172, 178, 194);

/**
 * Renders the parking stalls as a horizontal row on a light bay panel: the first
 * `unlocked` slots are open stalls (dark pad + light border), the rest are locked (darker
 * pad + lock body/shackle). Exposes slot positions so the controller can drive cars into
 * them, and the point under each stall where its seat chip hangs.
 */
export class ParkingView {
    private positions: Vec3[] = [];
    constructor(
        private parent: Node,
        private slots: number,
        private unlocked: number,
        private y: number,
    ) {}

    render(): void {
        const startX = -((this.slots - 1) * PITCH) / 2;

        // The bay panel: a light band behind the whole row. It separates the stalls from
        // the cream platform tray and gives the dark pads something to read against.
        const panel = makeLitBox(
            'ParkingPanel',
            (this.slots - 1) * PITCH + SLOT_W + 2 * PANEL_PAD_X,
            SLOT_H + 2 * PANEL_PAD_Y,
            0.08, PANEL,
        );
        panel.setPosition(0, this.y, PANEL_Z);
        this.parent.addChild(panel);

        for (let i = 0; i < this.slots; i++) {
            const locked = i >= this.unlocked;
            const pos = new Vec3(startX + i * PITCH, this.y, 0);
            const pad = makeLitBox(
                `slot-${i}`, SLOT_W, SLOT_H, 0.12, locked ? PAD_LOCKED : PAD,
            );
            pad.setPosition(pos.x, pos.y, PAD_Z);
            this.parent.addChild(pad);

            if (locked) {
                // Lock body + shackle over the pad.
                const body = makeLitBox('lockbody', 0.34, 0.28, 0.16, LOCK_BODY);
                body.setPosition(pos.x, pos.y - 0.02, 0.08);
                this.parent.addChild(body);
                const sh = new Node('shackle');
                const smr = sh.addComponent(MeshRenderer);
                smr.mesh = utils.createMesh(primitives.torus(0.12, 0.03, { radialSegments: 12, tubularSegments: 8 }));
                smr.material = litMaterial(LOCK_SHACKLE);
                sh.setPosition(pos.x, pos.y + 0.2, 0.08);
                sh.setRotationFromEuler(90, 0, 0);
                this.parent.addChild(sh);
            } else {
                // Four thin border strips to read as a painted stall.
                const t = 0.05;
                for (const [dx, dy, w, h] of [
                    [0, SLOT_H / 2, SLOT_W, t], [0, -SLOT_H / 2, SLOT_W, t],
                    [-SLOT_W / 2, 0, t, SLOT_H], [SLOT_W / 2, 0, t, SLOT_H],
                ] as const) {
                    const s = makeLitBox('edge', w, h, 0.1, EDGE);
                    s.setPosition(pos.x + dx, pos.y + dy, EDGE_Z);
                    this.parent.addChild(s);
                }
            }
            this.positions.push(pos);
        }
    }

    /** World position of a usable slot (parkingRoot sits at the origin). */
    getSlotPosition(index: number): Vec3 {
        return this.positions[index].clone();
    }

    /** The box a parked car has to fit inside, in board units. */
    static get slotSize(): { w: number; h: number } {
        return { w: SLOT_W, h: SLOT_H };
    }

    /** Point on a stall's bottom edge, where its seat chip hangs. */
    getChipAnchor(index: number): Vec3 {
        const pos = this.positions[index];
        return new Vec3(pos.x, pos.y - SLOT_H / 2, 0);
    }
}
