import { Node, Color, MeshRenderer } from 'cc';
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

/**
 * Grounds the floating loop/parking/grid elements onto one physical stage:
 * a big rounded-ish platform tray under everything, a darker parking-lot
 * ground sized to the grid footprint, and light lane separator lines
 * between columns. Parented under `root` (the tilted boardRoot), placed
 * behind the cars/passengers (more negative z) so it never occludes them.
 */
export function setupStage(root: Node, cols: number, rows: number, gridY: number): void {
    const step = 1.12;
    // Depth ordering note: cars/passengers straddle the board plane — their geometry
    // spans roughly z ∈ [-0.35, +0.28] and their blob shadows sit at z ≈ -0.06. Any
    // opaque slab with a near face in front of that would bury shadows/rear wheels.
    // So the lot sits just BEHIND the shadows (near face ≈ -0.10): shadows render on
    // top of it (grounded look) and cars read as sitting IN the lot. The platform
    // sits further back as the overall tray.

    // Rounded-ish platform tray behind everything.
    const platform = makeLitBox('Platform', 12, 15, 0.35, new Color(247, 238, 222));
    platform.setPosition(0, 0, -0.5);
    root.addChild(platform);

    // Parking-lot ground under the grid cars (near face ≈ -0.10, behind the shadows).
    // No lane lines: cars face varying directions, so column lanes don't fit the
    // gameplay (matches the reference art, which uses a plain lot + dashed border).
    const lotW = cols * step, lotH = rows * step;
    const lot = makeLitBox('Lot', lotW + 0.3, lotH + 0.3, 0.12, new Color(84, 90, 104));
    lot.setPosition(0, gridY, -0.16);
    root.addChild(lot);
}
