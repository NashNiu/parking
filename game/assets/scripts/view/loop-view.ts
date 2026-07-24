import { Node, Color, Vec3 } from 'cc';
import { colorOf } from './colors';
import { buildPassenger, recolorPassenger } from './passenger-builder';

/**
 * Renders the loop ring as a fixed row of `capacity` dots. Each tick, update()
 * reflects the current ring contents: a filled slot shows its color, an empty
 * slot (boarded / not yet refilled) is hidden. As the ring rotates and refills,
 * the colors visibly move along the row (a conveyor feel).
 */
export class LoopView {
    private dots: Node[] = [];
    private ringColors: (string | null)[] = [];

    constructor(parent: Node, capacity: number, y: number) {
        // Lay passengers around an ellipse (a looping track). On the tilted board
        // this reads as a perspective loop receding into the distance.
        const cx = 0;
        const cy = y;
        const rx = 3.3;
        const ry = 1.4;
        for (let i = 0; i < capacity; i++) {
            // Start at the bottom of the ellipse (nearest the parking area) and go around.
            const ang = Math.PI / 2 + (i / capacity) * Math.PI * 2;
            const px = cx + rx * Math.cos(ang);
            const py = cy + ry * Math.sin(ang);
            const dot = buildPassenger(`pax-${i}`, Color.WHITE.clone());
            dot.setPosition(px, py, 0);
            dot.active = false;
            parent.addChild(dot);
            this.dots.push(dot);
        }
    }

    update(ring: (string | null)[]): void {
        this.ringColors = ring.slice();
        for (let i = 0; i < this.dots.length; i++) {
            const c = ring[i];
            if (c) {
                this.dots[i].active = true;
                recolorPassenger(this.dots[i], colorOf(c));
            } else {
                this.dots[i].active = false;
            }
        }
    }

    /** World position of the first visible dot currently showing `color` (best-effort "boarding source"). */
    nearestVisibleWorldPos(color: string): Vec3 | null {
        for (let i = 0; i < this.dots.length; i++) {
            if (this.ringColors[i] === color && this.dots[i].active) return this.dots[i].worldPosition.clone();
        }
        return null;
    }
}
