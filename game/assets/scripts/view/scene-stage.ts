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
    // Rounded-ish platform tray under everything (thin big box, receives shadow).
    const platform = makeLitBox('Platform', 12, 15, 0.5, new Color(247, 238, 222));
    platform.setPosition(0, 0, -0.35);
    const pmr = platform.getComponent(MeshRenderer);
    if (pmr) pmr.receiveShadow = MeshRenderer.ShadowReceivingMode.ON;
    root.addChild(platform);

    // Parking-lot ground under the grid cars.
    const lotW = cols * step, lotH = rows * step;
    const lot = makeLitBox('Lot', lotW + 0.3, lotH + 0.3, 0.12, new Color(84, 90, 104));
    lot.setPosition(0, gridY, 0.02);
    const lmr = lot.getComponent(MeshRenderer);
    if (lmr) lmr.receiveShadow = MeshRenderer.ShadowReceivingMode.ON;
    root.addChild(lot);

    // Lane separator lines (light dashed feel via thin boxes between columns).
    const line = new Color(210, 214, 224);
    for (let c = 1; c < cols; c++) {
        const x = c * step - lotW / 2;
        const s = makeLitBox('lane', 0.04, lotH, 0.14, line);
        s.setPosition(x, gridY, 0.06);
        root.addChild(s);
    }
}
