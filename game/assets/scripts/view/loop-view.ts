import { Node, Color } from 'cc';
import { colorOf } from './colors';
import { makeBox, setBoxColor } from './placeholder';

/**
 * Renders the loop ring as a fixed row of `capacity` dots. Each tick, update()
 * reflects the current ring contents: a filled slot shows its color, an empty
 * slot (boarded / not yet refilled) is hidden. As the ring rotates and refills,
 * the colors visibly move along the row (a conveyor feel).
 */
export class LoopView {
    private dots: Node[] = [];

    constructor(parent: Node, capacity: number, y: number) {
        const gap = 0.55;
        const startX = -((capacity - 1) * gap) / 2;
        for (let i = 0; i < capacity; i++) {
            const dot = makeBox(`pax-${i}`, 0.38, 0.38, 0.38, Color.WHITE.clone());
            dot.setPosition(startX + i * gap, y, 0);
            dot.active = false;
            parent.addChild(dot);
            this.dots.push(dot);
        }
    }

    update(ring: (string | null)[]): void {
        for (let i = 0; i < this.dots.length; i++) {
            const c = ring[i];
            if (c) {
                this.dots[i].active = true;
                setBoxColor(this.dots[i], colorOf(c));
            } else {
                this.dots[i].active = false;
            }
        }
    }
}
