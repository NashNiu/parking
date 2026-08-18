import { Node, Color, MeshRenderer } from 'cc';
import { makeLitBox } from './placeholder';

/** Grid pitch used to size the parking lot; the lot is `rows * LOT_STEP + 0.3` tall. */
export const LOT_STEP = 1.12;

/** Height of the lot slab for a grid of `rows`, so callers can place things clear of it. */
export function lotHeight(rows: number): number {
    return rows * LOT_STEP + 0.3;
}

/** Width of the lot slab for a grid of `cols`. */
export function lotWidth(cols: number): number {
    return cols * LOT_STEP + 0.3;
}

/** Centreline of each lane of the ring road, in board space. */
export interface RingRoad {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

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
    const step = LOT_STEP;
    // Depth ordering note: cars stand ON the board plane (wheels at z = 0, body
    // extending out to +z) and their blob shadows sit at z ≈ -0.06. Any opaque slab
    // with a near face in front of that would bury the shadows. So the lot sits just
    // BEHIND them (near face ≈ -0.10): shadows render on top of it (grounded look)
    // and cars read as sitting IN the lot. The platform sits further back as the
    // overall tray. Passengers still straddle the plane (z ∈ [-0.1, +0.1]).

    // Rounded-ish platform tray behind everything. Tall enough to stay under the ring
    // road's bottom lane on the deepest grid we ship: a 6-row lot hangs to y = -7.3 and
    // its lane to -7.8, which the old 15-tall tray centred on the origin stopped short
    // of, leaving the road floating over the backdrop.
    const platform = makeLitBox('Platform', 12, 19, 0.35, new Color(247, 238, 222));
    platform.setPosition(0, -1, -0.5);
    root.addChild(platform);

    // Parking-lot ground under the grid cars (near face ≈ -0.10, behind the shadows).
    // No lane lines: cars face varying directions, so column lanes don't fit the
    // gameplay (matches the reference art, which uses a plain lot + dashed border).
    const lotW = cols * step, lotH = rows * step;
    const bw = lotW + 0.3, bh = lotH + 0.3;
    const lot = makeLitBox('Lot', bw, bh, 0.12, new Color(84, 90, 104));
    lot.setPosition(0, gridY, -0.16);
    root.addChild(lot);

    // White dashed border around the lot (matches the reference art). Short dash
    // boxes laid along each edge, on the lot surface (just in front, behind shadows).
    const white = new Color(240, 243, 250);
    const dash = 0.28, gap = 0.16, zBorder = -0.1;
    // horizontal edge: dashes run along X at a fixed Y-offset from the lot center.
    // vertical edge: dashes run along Y at a fixed X.
    const addDashes = (len: number, horizontal: boolean, offset: number) => {
        const span = dash + gap;
        const n = Math.max(1, Math.floor(len / span));
        const start = -len / 2 + (len - (n - 1) * span) / 2;
        for (let i = 0; i < n; i++) {
            const p = start + i * span;
            const w = horizontal ? dash : 0.05;
            const h = horizontal ? 0.05 : dash;
            const s = makeLitBox('dash', w, h, 0.06, white);
            const x = horizontal ? p : offset;
            const y = gridY + (horizontal ? offset : p);
            s.setPosition(x, y, zBorder);
            root.addChild(s);
        }
    };
    addDashes(bw, true, bh / 2);   // top edge
    addDashes(bw, true, -bh / 2);  // bottom edge
    addDashes(bh, false, -bw / 2); // left edge
    addDashes(bh, false, bw / 2);  // right edge
}

/**
 * The ring road around the lot. Cars drive out of the lot the way they point, join
 * the lane on that side, follow it round to the lane above the lot, and turn up into
 * a parking stall; a full car leaves along that same top lane, to the right.
 *
 * It exists because both journeys used to be straight lines drawn between two points
 * that ignored everything in between — an arriving car slid diagonally across the lot
 * over whatever sat there, and a departing one drove along a hard-coded y that cut
 * through the lot entirely on a 6-row grid. A drawn road makes those routes legible
 * as well as clear.
 *
 * The top lane spans the whole platform, since departing cars carry on along it and
 * off screen; the other three hug the lot. All of it sits behind the lot in z, so
 * where they meet the lot covers the road rather than z-fighting with it, and blob
 * shadows still land on top.
 */
export function setupRoads(root: Node, ring: RingRoad, width: number): void {
    const grey = new Color(150, 154, 168);
    const half = width / 2;
    const add = (name: string, w: number, h: number, x: number, y: number) => {
        const n = makeLitBox(name, w, h, 0.1, grey);
        n.setPosition(x, y, -0.2);
        root.addChild(n);
    };
    const midY = (ring.top + ring.bottom) / 2;
    const spanY = ring.top - ring.bottom + width;
    add('RoadTop', 12, width, 0, ring.top);
    add('RoadBottom', ring.right - ring.left + width, width, (ring.left + ring.right) / 2, ring.bottom);
    add('RoadLeft', width, spanY, ring.left, midY);
    add('RoadRight', width, spanY, ring.right, midY);

    // Dashed centre line on the top lane only. The corners would need the dashes to
    // turn with them, and the side lanes read fine plain — they are short and always
    // have the lot on one shoulder.
    const line = new Color(238, 240, 246);
    const dash = 0.34, gap = 0.3, span = dash + gap;
    const n = Math.floor(12 / span);
    const start = -6 + (12 - (n - 1) * span) / 2;
    for (let i = 0; i < n; i++) {
        const x = start + i * span;
        // Skip the stretch the side lanes cross, where a centre line would run into
        // the corner instead of down the middle of anything.
        if (x > ring.left - half && x < ring.left + half) continue;
        if (x > ring.right - half && x < ring.right + half) continue;
        const d = makeLitBox('roaddash', dash, 0.05, 0.06, line);
        d.setPosition(x, ring.top, -0.19);
        root.addChild(d);
    }
}
