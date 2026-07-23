import { Node } from 'cc';
import { colorOf } from './colors';
import { makeBox } from './placeholder';

/**
 * Renders the loop's current ring contents as a horizontal row of colored dots.
 * A real oval/looping track comes later; this is a static placeholder for M2.1.
 */
export class LoopView {
    constructor(
        private parent: Node,
        private ring: (string | null)[],
        private y: number,
    ) {}

    render(): void {
        const gap = 0.55;
        const n = this.ring.length;
        const startX = -((n - 1) * gap) / 2;
        this.ring.forEach((c, i) => {
            if (!c) return;
            const dot = makeBox(`pax-${i}`, 0.38, 0.38, 0.38, colorOf(c));
            dot.setPosition(startX + i * gap, this.y, 0);
            this.parent.addChild(dot);
        });
    }
}
