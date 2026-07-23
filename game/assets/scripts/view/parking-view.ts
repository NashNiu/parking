import { Node, Color, Vec3, MeshRenderer, utils, primitives } from 'cc';
import { makeLitBox } from './placeholder';
import { litMaterial } from './materials';

/**
 * Renders the parking slots as a horizontal row: the first `unlocked` slots are
 * painted stalls (light pad + border stripes), the rest are locked (dark pad +
 * lock body/shackle). Exposes slot world positions so the controller can
 * animate cars into them.
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
        const gap = 1.15;
        const startX = -((this.slots - 1) * gap) / 2;
        for (let i = 0; i < this.slots; i++) {
            const locked = i >= this.unlocked;
            const pos = new Vec3(startX + i * gap, this.y, 0);
            const pad = makeLitBox(
                `slot-${i}`, 0.98, 0.98, 0.14,
                locked ? new Color(96, 100, 116) : new Color(236, 238, 244),
            );
            pad.setPosition(pos);
            this.parent.addChild(pad);

            if (locked) {
                // Lock body + shackle over the pad.
                const body = makeLitBox('lockbody', 0.34, 0.28, 0.16, new Color(60, 64, 78));
                body.setPosition(pos.x, pos.y - 0.02, 0.2);
                this.parent.addChild(body);
                const sh = new Node('shackle');
                const smr = sh.addComponent(MeshRenderer);
                smr.mesh = utils.createMesh(primitives.torus(0.12, 0.03, { radialSegments: 12, tubularSegments: 8 }));
                smr.material = litMaterial(new Color(180, 184, 196));
                sh.setPosition(pos.x, pos.y + 0.2, 0.2);
                sh.setRotationFromEuler(90, 0, 0);
                this.parent.addChild(sh);
            } else {
                // Four thin border strips to read as a painted stall.
                const line = new Color(120, 170, 240);
                const t = 0.06, L = 0.98;
                for (const [dx, dy, w, h] of [
                    [0, L / 2, L, t], [0, -L / 2, L, t], [-L / 2, 0, t, L], [L / 2, 0, t, L],
                ] as const) {
                    const s = makeLitBox('edge', w, h, 0.16, line);
                    s.setPosition(pos.x + dx, pos.y + dy, 0.09);
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
}
