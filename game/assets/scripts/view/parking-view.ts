import { Node, Color, Vec3, MeshRenderer, utils, primitives, tween, Tween } from 'cc';
import { flatMaterial } from './materials';
import { makeSlab, makeShadowSlab, makeMerged, roundedSlabPart, boxPart, MeshPart } from './slabs';
import { SHADOW_Z } from './scene-stage';
import { CAP_BOX, CAR_SCALE } from '../core/index';

/**
 * Stall footprint and pitch, as AIR AROUND THE LONGEST CAR BODY -- so the bay is sized by
 * the same board scale as everything else, rather than fixed in world units.
 *
 * It used to be fixed (0.78 x 1.06 x 0.98), sized to a parking band 1.4 units tall, and
 * that broke the size hierarchy: a stall shallower than a bus is long forced `stallScale`
 * to shrink the bus to fit, while a small car -- already short enough -- kept its full
 * size. The bus parked NARROWER THAN THE SMALL CAR beside it (0.344 against 0.464 world
 * units across, 26% thinner). The inversion was always there; the portrait lot made it
 * obvious by making the lot's cars 31% bigger without making the stall any deeper.
 *
 * Sizing the stall off `CAP_BOX.big` fixes it at the root: the deepest stall a level can
 * need is the longest body it can hold, so every capacity now parks at scale 1 and keeps
 * EXACTLY the size it had in the lot. The car you tapped is the car that parks.
 *
 * The three multipliers are chosen so a big car fills 90% of the stall's depth and 75% of
 * its width, which leaves `STALL_FILL_W`/`STALL_FILL_H` in GameController with 7% and 13%
 * of headroom respectively -- enough that a re-exported model drifting slightly does not
 * silently start shrinking cars again. `STALL_PITCH_AIR` is the gap between neighbours:
 * 15% of a stall's width.
 */
const STALL_AIR_LEN = 1.11;
const STALL_AIR_WID = 1.33;
const STALL_PITCH_AIR = 1.15;

/**
 * The stall width every piece of trim below was drawn against -- rim thickness, corner
 * radii, panel padding, the whole padlock glyph. Those are shapes, not sizes, so they are
 * scaled by `slotW / GLYPH_REF_W` rather than re-derived: the bay then looks identical at
 * any board scale instead of growing coarse trim on a phone and clumsy trim in a preview
 * window.
 */
const GLYPH_REF_W = 0.78;

/** A stall's box and the row's pitch, at a given board scale. */
export interface StallBox {
    w: number;
    h: number;
    pitch: number;
}

/** The stall a lot at `scale` world units per board unit needs. */
export function stallFootprint(scale: number): StallBox {
    const w = CAP_BOX.big.wid * CAR_SCALE * STALL_AIR_WID * scale;
    const h = CAP_BOX.big.len * CAR_SCALE * STALL_AIR_LEN * scale;
    return { w, h, pitch: w * STALL_PITCH_AIR };
}

/**
 * Outer size of the bay panel behind a row of `slots` stalls. Exported because the caller
 * has to know how tall the band is BEFORE it can decide where the loop track goes -- see
 * `buildBoard`.
 */
export function bayPanelSize(slots: number, box: StallBox): { w: number; h: number } {
    const g = box.w / GLYPH_REF_W;
    return {
        w: (slots - 1) * box.pitch + box.w + 2 * PANEL_PAD_X * g,
        h: box.h + 2 * PANEL_PAD_Y * g,
    };
}

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
const DROP = 0.11;

/**
 * The padlock, front to back: the shackle sits FURTHEST BACK on purpose. It is drawn as a
 * whole torus and the body, in front of it, hides its lower half -- which is what leaves a
 * clean U arching over the body. Doing it that way rather than with a half-torus means not
 * depending on which way `primitives.torus` winds its arc.
 */
const LOCK_SHACKLE_Z = 0.02;
const LOCK_BODY_Z = 0.08;
const LOCK_KEY_Z = 0.15;

/**
 * Padlock proportions in board units, and the arithmetic that centres the whole glyph on
 * its stall.
 *
 * The shackle's centre sits exactly ON the body's top edge, which is what makes the body
 * hide precisely its lower half and leave a clean U. So the composite runs from
 * `bodyY - H/2` up to `bodyY + H/2 + (R + TUBE)` -- the OUTER edge of the torus, not its
 * centreline radius -- putting its midpoint at `bodyY + (R + TUBE)/2`. Setting that to zero
 * is what fixes `LOCK_BODY_Y`. The old lock placed body and shackle at fixed offsets and
 * came out sitting high on the pad.
 *
 * The shackle's outer diameter (2 * (R + TUBE) = 0.35) is kept clearly narrower than the
 * body's 0.44, or the arch springs from the body's very corners and stops reading as a
 * shackle.
 */
const LOCK_BODY_W = 0.44;
const LOCK_BODY_H = 0.36;
const LOCK_BODY_R = 0.10;
const LOCK_SHACKLE_R = 0.135;
const LOCK_SHACKLE_TUBE = 0.04;
const LOCK_BODY_Y = -(LOCK_SHACKLE_R + LOCK_SHACKLE_TUBE) / 2;
const LOCK_SHACKLE_Y = LOCK_BODY_Y + LOCK_BODY_H / 2;

const PANEL = new Color(220, 227, 245);
const PAD = new Color(76, 87, 115);
const PAD_LOCKED = new Color(57, 66, 90);
const PAD_RIM = new Color(147, 160, 192);
/**
 * A dimmed `PAD_RIM`. A locked stall used to have no rim at all, which made the three of
 * them read as dark holes punched in the bay rather than as stalls of the same row -- the
 * row is seven slots, four open and three shut, and it should look like seven.
 */
const RIM_LOCKED = new Color(100, 111, 141);
/**
 * LIGHT, where this used to be (32, 38, 54) -- DARKER than the pad it sits on. That is why
 * the lock read as nothing: the body vanished into the pad and left only the pale shackle
 * floating, which scans as a keyhole or a stray ring rather than as a padlock. The body is
 * the mass that makes the silhouette, so it needs the contrast.
 */
const LOCK_BODY = new Color(208, 216, 234);
const LOCK_SHACKLE = new Color(150, 162, 194);

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
    /** This board's stall box, and the trim scale that goes with it. */
    private readonly box: StallBox;
    private readonly g: number;

    constructor(
        private parent: Node,
        private slots: number,
        private unlocked: number,
        private y: number,
        scale: number,
    ) {
        this.box = stallFootprint(scale);
        this.g = this.box.w / GLYPH_REF_W;
    }

    render(): void {
        const { w: slotW, h: slotH, pitch } = this.box;
        const g = this.g;
        const startX = -((this.slots - 1) * pitch) / 2;
        const { w: panelW, h: panelH } = bayPanelSize(this.slots, this.box);

        // The bay panel: a light band behind the whole row, with a drop shadow onto the
        // road below. It separates the stalls from the ground and gives the dark pads
        // something to read against.
        const shadow = makeShadowSlab('ParkingShadow', panelW, panelH, PANEL_R * g);
        shadow.setPosition(0, this.y - DROP * g, SHADOW_Z);
        this.parent.addChild(shadow);

        const panel = makeSlab('ParkingPanel', panelW, panelH, 0.06, PANEL, PANEL_R * g);
        panel.setPosition(0, this.y, PANEL_Z);
        this.parent.addChild(panel);
        this.panel = panel;

        for (let i = 0; i < this.slots; i++) {
            const locked = i >= this.unlocked;
            const pos = new Vec3(startX + i * pitch, this.y, 0);

            if (locked) {
                // Same rim-and-pad build as an open stall, just dimmer, so the row reads as
                // seven slots rather than four slots and three holes.
                const rim = makeSlab(
                    `slot-rim-${i}`, slotW, slotH, 0.06, RIM_LOCKED, PAD_R * g,
                );
                rim.setPosition(pos.x, pos.y, RIM_Z);
                this.parent.addChild(rim);

                const pad = makeSlab(
                    `slot-${i}`, slotW - 2 * RIM * g, slotH - 2 * RIM * g, 0.06,
                    PAD_LOCKED, (PAD_R - RIM) * g,
                );
                pad.setPosition(pos.x, pos.y, PAD_Z);
                this.parent.addChild(pad);

                // The whole glyph goes under one node scaled by `g`, so the four pieces
                // keep their measured relationship to each other (see LOCK_BODY_Y) at any
                // board scale, and their z order with it.
                const lock = new Node(`lock-${i}`);
                lock.setPosition(pos.x, pos.y, 0);
                lock.setScale(g, g, g);
                this.parent.addChild(lock);

                const sh = new Node('shackle');
                const smr = sh.addComponent(MeshRenderer);
                smr.mesh = utils.createMesh(primitives.torus(
                    LOCK_SHACKLE_R, LOCK_SHACKLE_TUBE, { radialSegments: 16, tubularSegments: 8 },
                ));
                smr.material = flatMaterial(LOCK_SHACKLE);
                smr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
                sh.setPosition(0, LOCK_SHACKLE_Y, LOCK_SHACKLE_Z);
                sh.setRotationFromEuler(90, 0, 0);
                lock.addChild(sh);

                const body = makeSlab(
                    'lockbody', LOCK_BODY_W, LOCK_BODY_H, 0.1, LOCK_BODY, LOCK_BODY_R,
                );
                body.setPosition(0, LOCK_BODY_Y, LOCK_BODY_Z);
                lock.addChild(body);

                // Keyhole: a disc over a tapering slot, in the PAD's own colour so it reads
                // as punched through the body rather than painted on it. One merged mesh --
                // the two parts share a colour and a depth, so they share a draw call.
                const key: MeshPart[] = [
                    roundedSlabPart(0.09, 0.09, 0.06, 0.045, 0, 0.015),
                    boxPart(0.035, 0.075, 0.06, 0, -0.045),
                ];
                const keyhole = makeMerged('lockkey', key, PAD_LOCKED);
                keyhole.setPosition(0, LOCK_BODY_Y, LOCK_KEY_Z);
                lock.addChild(keyhole);
            } else {
                // An open stall is two nested slabs: the light rim shows as a border
                // because the dark pad on top of it is inset by RIM on every side. Two
                // draw calls instead of the four edge strips this replaces.
                const rim = makeSlab(
                    `slot-rim-${i}`, slotW, slotH, 0.06, PAD_RIM, PAD_R * g,
                );
                rim.setPosition(pos.x, pos.y, RIM_Z);
                this.parent.addChild(rim);

                const pad = makeSlab(
                    `slot-${i}`, slotW - 2 * RIM * g, slotH - 2 * RIM * g, 0.06, PAD,
                    (PAD_R - RIM) * g,
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

    /**
     * The box a parked car has to fit inside, in world units. An INSTANCE getter now: the
     * stall is sized from this board's scale, so there is no board-independent answer.
     */
    get slotSize(): { w: number; h: number } {
        return { w: this.box.w, h: this.box.h };
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
        return new Vec3(pos.x, pos.y - this.box.h / 2, 0);
    }
}
