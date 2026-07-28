import { Node, Color } from 'cc';
import { makeLitBox } from './placeholder';

/**
 * Warm sky backdrop + a few soft cloud slabs, parented under `root` (the
 * tilted boardRoot) so the whole scene reads as sitting in an outdoor stage
 * instead of floating on a flat color. Replaces the old flat BackFar/BackNear
 * slabs from environment.ts — this is the dedicated background layer.
 */
export function setupBackground(root: Node): void {
    const sky = makeLitBox('Sky', 40, 26, 0.4, new Color(255, 226, 190));
    sky.setPosition(0, 5, -7);
    root.addChild(sky);

    // Clouds: rounded light slabs scattered across the upper sky.
    for (const [x, y, s] of [[-6, 8, 1.6], [5, 9, 2.0], [8, 5, 1.3]] as const) {
        const c = makeLitBox('cloud', 2.4 * s, 0.9 * s, 0.3, new Color(255, 252, 248));
        c.setPosition(x, y, -6.4);
        root.addChild(c);
    }
}
