import { Node, Color, Vec3, MeshRenderer, utils, primitives, tween, Tween } from 'cc';
import { flatMaterial } from './materials';
import { makeSlab, makeShadowSlab } from './slabs';
import { SHADOW_Z } from './scene-stage';

/**
 * Stall footprint and pitch, in board units. A car parks nose-up, so the stall is deeper
 * than it is wide, like the reference art's.
 *
 * How deep is capped from both sides: the ring road's top lane ends at y = 0.75 and the
 * loop track's curb hangs down to y ≈ 2.22 (its drop shadow to 2.15), which leaves the
 * parking band about 1.4 units to live in — hence a stall shallower than the reference's,
 * which has a much taller screen to spend.
 *
 * How WIDE follows from that: a car scaled to a 1.06-deep stall is only about
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

/** Corner radii and the light rim around an open stall. */
const PANEL_R = 0.29;
const PAD_R = 0.15;
const RIM = 0.045;

/** Depths; see the stack documented in scene-stage. */
const PAD_Z = -0.11;
const RIM_Z = -0.12;
const PANEL_Z = -0.14;
const LOCK_Z = 0.02;
const DROP = 0.11;

const PANEL = new Color(220, 227, 245);
const PAD = new Color(76, 87, 115);
const PAD_LOCKED = new Color(57, 66, 90);
const PAD_RIM = new Color(147, 160, 192);
const LOCK_BODY = new Color(32, 38, 54);
const LOCK_SHACKLE = new Color(170, 178, 198);

/**
 * Renders the parking stalls as a row on a light bay panel: the first `unlocked` slots
 * are open stalls (dark pad inside a light rim), the rest are locked (darker pad + lock
 * body/shackle). Exposes slot positions so the controller can drive cars into them, and
 * the point under each stall where its seat chip hangs.
 */
/** Warning tint for `pulse`: amber, not red -- a full bay is a wait, not a mistake. */
const PULSE = new Color(255, 176, 64);

export class ParkingView {
    private positions: Vec3[] = [];
    /** The bay panel, kept so `pulse` can draw the eye to it. */
    private panel: Node | null = null;
    constructor(
        private parent: Node,
        private slots: number,
        private unlocked: number,
        private y: number,
    ) {}

    render(): void {
        const startX = -((this.slots - 1) * PITCH) / 2;
        const panelW = (this.slots - 1) * PITCH + SLOT_W + 2 * PANEL_PAD_X;
        const panelH = SLOT_H + 2 * PANEL_PAD_Y;

        // The bay panel: a light band behind the whole row, with a drop shadow onto the
        // road below. It separates the stalls from the ground and gives the dark pads
        // something to read against.
        const shadow = makeShadowSlab('ParkingShadow', panelW, panelH, PANEL_R);
        shadow.setPosition(0, this.y - DROP, SHADOW_Z);
        this.parent.addChild(shadow);

        const panel = makeSlab('ParkingPanel', panelW, panelH, 0.06, PANEL, PANEL_R);
        panel.setPosition(0, this.y, PANEL_Z);
        this.parent.addChild(panel);
        this.panel = panel;

        for (let i = 0; i < this.slots; i++) {
            const locked = i >= this.unlocked;
            const pos = new Vec3(startX + i * PITCH, this.y, 0);

            if (locked) {
                const pad = makeSlab(`slot-${i}`, SLOT_W, SLOT_H, 0.06, PAD_LOCKED, PAD_R);
                pad.setPosition(pos.x, pos.y, PAD_Z);
                this.parent.addChild(pad);

                const body = makeSlab('lockbody', 0.34, 0.28, 0.1, LOCK_BODY, 0.07);
                body.setPosition(pos.x, pos.y - 0.02, LOCK_Z);
                this.parent.addChild(body);
                const sh = new Node('shackle');
                const smr = sh.addComponent(MeshRenderer);
                smr.mesh = utils.createMesh(primitives.torus(0.12, 0.03, { radialSegments: 12, tubularSegments: 8 }));
                smr.material = flatMaterial(LOCK_SHACKLE);
                sh.setPosition(pos.x, pos.y + 0.2, LOCK_Z);
                sh.setRotationFromEuler(90, 0, 0);
                this.parent.addChild(sh);
            } else {
                // An open stall is two nested slabs: the light rim shows as a border
                // because the dark pad on top of it is inset by RIM on every side. Two
                // draw calls instead of the four edge strips this replaces.
                const rim = makeSlab(`slot-rim-${i}`, SLOT_W, SLOT_H, 0.06, PAD_RIM, PAD_R);
                rim.setPosition(pos.x, pos.y, RIM_Z);
                this.parent.addChild(rim);

                const pad = makeSlab(
                    `slot-${i}`, SLOT_W - 2 * RIM, SLOT_H - 2 * RIM, 0.06, PAD, PAD_R - RIM,
                );
                pad.setPosition(pos.x, pos.y, PAD_Z);
                this.parent.addChild(pad);
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

    /**
     * Blink the bay, so a tap refused for a full lot points HERE rather than at the car
     * that was tapped.
     *
     * A blink and not a bounce, because the parked cars are siblings of this panel rather
     * than children -- moving it would slide the row out from under them. And a material
     * SWAP rather than `flash`, because flash drives the `emissive` property and a slab's
     * material is builtin-unlit, which has none: flash on this node is a silent no-op.
     * `flatMaterial` hands out one shared material per colour, so this is two objects being
     * exchanged, not a material built per call.
     */
    pulse(): void {
        const panel = this.panel;
        if (!panel || !panel.isValid) return;
        const mr = panel.getComponent(MeshRenderer);
        if (!mr) return;
        const on = flatMaterial(PULSE), off = flatMaterial(PANEL);
        // Stop first and restore the resting colour by hand: a second tap landing mid-blink
        // would otherwise cancel the tween that was going to put the panel back, and leave
        // the bay amber for the rest of the level.
        Tween.stopAllByTarget(panel);
        mr.material = off;
        tween(panel)
            .call(() => { mr.material = on; })
            .delay(0.11)
            .call(() => { mr.material = off; })
            .delay(0.09)
            .call(() => { mr.material = on; })
            .delay(0.11)
            .call(() => { mr.material = off; })
            .start();
    }

    /** Point on a stall's bottom edge, where its seat chip hangs. */
    getChipAnchor(index: number): Vec3 {
        const pos = this.positions[index];
        return new Vec3(pos.x, pos.y - SLOT_H / 2, 0);
    }
}
