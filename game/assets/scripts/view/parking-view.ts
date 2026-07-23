import { Node, Color } from 'cc';
import { makeBox } from './placeholder';

/**
 * Renders the parking slots as a horizontal row: the first `unlocked` slots are
 * light (usable), the rest are dark (locked). Static placeholder for M2.1.
 */
export class ParkingView {
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
            const color = locked ? new Color(80, 80, 90) : new Color(210, 210, 215);
            const box = makeBox(`slot-${i}`, 0.95, 0.95, 0.2, color);
            box.setPosition(startX + i * gap, this.y, 0);
            this.parent.addChild(box);
        }
    }
}
