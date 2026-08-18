import { Node, Color } from 'cc';
import { makeSlab, makeMerged, makeShadowSlab, boxPart, MeshPart } from './slabs';

/**
 * The scene's flat graphic layer: ground, grid, lot, roads. Every colour here is the
 * colour that reaches the screen — these panels are unlit (see `makeSlab`) — and every
 * panel is rounded, which is most of what separates this from a pile of boxes.
 */
const GROUND = new Color(228, 234, 246);
/** Grid line: white at ~55% over GROUND, resolved to an opaque colour. */
const GRID_LINE = new Color(243, 246, 251);
const LOT = new Color(198, 207, 230);
const LOT_DASH = new Color(255, 255, 255);
const ROAD = new Color(174, 184, 208);
const ROAD_LINE = new Color(244, 247, 253);

const GRID_PITCH = 0.66;
const GRID_THICK = 0.03;

/** Corner radii, and the drop-shadow offset every panel shares. */
const LOT_R = 0.24;
const DROP = 0.11;

/**
 * The depth stack, front to back. Cars stand ON the board plane (wheels at z = 0) with a
 * contact shadow at z = -0.06, so nothing may have a face in front of that or the shadows
 * get buried. Every panel is thin (0.06) for one reason: a drop shadow has to fit BEHIND
 * the panel that casts it and still be in FRONT of the road below, or it gets depth-
 * rejected exactly where it is meant to show. Faces, in order:
 *
 *   -0.06  car contact shadows
 *   -0.08  stall pads          -0.09  stall rims (parking-view)
 *   -0.08  lot dashed border
 *   -0.10  lot                 -0.11  parking bay panel (parking-view)
 *   -0.17  panel drop shadows
 *   -0.23  ring road
 *   -0.30  grid lines          -0.325 ground
 *
 * Neighbouring faces stay at least 0.01 apart and never coplanar, so the ordering holds
 * without depth-bias tricks.
 */
const GROUND_Z = -0.5;
const GRID_Z = -0.32;
const LOT_Z = -0.13;
const DASH_Z = -0.11;
const ROAD_Z = -0.28;
export const SHADOW_Z = -0.18;

/**
 * Size of the lot slab for a grid, from the same pitch the cars are laid out on. The
 * caller chooses the pitch — a tall grid uses a smaller one so its lot still fits the
 * camera — and must pass the same value here and to GridLayout, or the slab and the
 * cars it is meant to sit under drift apart.
 */
export function lotHeight(rows: number, step: number): number {
    return rows * step + 0.3;
}

/** Width of the lot slab for a grid of `cols` at pitch `step`. */
export function lotWidth(cols: number, step: number): number {
    return cols * step + 0.3;
}

/** Centreline of each lane of the ring road, in board space. */
export interface RingRoad {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/**
 * The ground: one big panel in the base colour with a white grid over it, both parented
 * under `root` (the tilted boardRoot) and sized to cover the frame at their depth. The
 * grid is a single merged mesh — 52 separate line nodes would be 52 draw calls for
 * something the eye reads as one texture.
 */
export function setupBackground(root: Node): void {
    const W = 13, H = 21, cy = -1;
    const ground = makeSlab('Ground', W, H, 0.35, GROUND);
    ground.setPosition(0, cy, GROUND_Z);
    root.addChild(ground);

    const lines: MeshPart[] = [];
    for (let x = -W / 2; x <= W / 2; x += GRID_PITCH) {
        lines.push(boxPart(GRID_THICK, H, 0.04, x, cy));
    }
    for (let y = -H / 2; y <= H / 2; y += GRID_PITCH) {
        lines.push(boxPart(W, GRID_THICK, 0.04, 0, cy + y));
    }
    const grid = makeMerged('Grid', lines, GRID_LINE);
    grid.setPosition(0, 0, GRID_Z);
    root.addChild(grid);
}

/**
 * The parking lot: a rounded panel under the grid cars with a white dashed border, and a
 * soft drop shadow. No lane lines — cars face varying directions, so column lanes don't
 * fit the gameplay (the reference art uses a plain lot plus a dashed border too).
 */
export function setupStage(root: Node, cols: number, rows: number, gridY: number, step: number): void {
    const bw = lotWidth(cols, step), bh = lotHeight(rows, step);

    const shadow = makeShadowSlab('LotShadow', bw, bh, LOT_R);
    shadow.setPosition(0, gridY - DROP, SHADOW_Z);
    root.addChild(shadow);

    const lot = makeSlab('Lot', bw, bh, 0.06, LOT, LOT_R);
    lot.setPosition(0, gridY, LOT_Z);
    root.addChild(lot);

    // Dashed border, inset from the lot's edge, as one merged mesh.
    const inset = 0.1, dash = 0.18, gap = 0.13, thick = 0.05;
    const iw = bw - 2 * inset, ih = bh - 2 * inset;
    const parts: MeshPart[] = [];
    const run = (len: number, horizontal: boolean, offset: number): void => {
        const span = dash + gap;
        const n = Math.max(1, Math.floor(len / span));
        const start = -len / 2 + (len - (n - 1) * span) / 2;
        for (let i = 0; i < n; i++) {
            const p = start + i * span;
            parts.push(horizontal
                ? boxPart(dash, thick, 0.06, p, offset)
                : boxPart(thick, dash, 0.06, offset, p));
        }
    };
    run(iw, true, ih / 2);
    run(iw, true, -ih / 2);
    run(ih, false, -iw / 2);
    run(ih, false, iw / 2);
    const border = makeMerged('LotBorder', parts, LOT_DASH);
    border.setPosition(0, gridY, DASH_Z);
    root.addChild(border);
}

/**
 * The ring road around the lot. Cars drive out of the lot the way they point, join the
 * lane on that side, follow it round to the lane above the lot, and turn up into a
 * parking stall; a full car leaves along that same top lane, to the right.
 *
 * It exists because both journeys used to be straight lines drawn between two points
 * that ignored everything in between — an arriving car slid diagonally across the lot
 * over whatever sat there, and a departing one drove along a hard-coded y that cut
 * through the lot entirely on a 6-row grid. A drawn road makes those routes legible as
 * well as clear.
 *
 * The top lane spans the whole ground, since departing cars carry on along it and off
 * screen; the other three hug the lot. All of it sits behind the lot in z, so where they
 * meet the lot covers the road rather than z-fighting with it, and contact shadows still
 * land on top.
 */
export function setupRoads(root: Node, ring: RingRoad, width: number): void {
    const half = width / 2;
    const add = (name: string, w: number, h: number, x: number, y: number): void => {
        const n = makeSlab(name, w, h, 0.1, ROAD);
        n.setPosition(x, y, ROAD_Z);
        root.addChild(n);
    };
    const midY = (ring.top + ring.bottom) / 2;
    const spanY = ring.top - ring.bottom + width;
    add('RoadTop', 13, width, 0, ring.top);
    add('RoadBottom', ring.right - ring.left + width, width, (ring.left + ring.right) / 2, ring.bottom);
    add('RoadLeft', width, spanY, ring.left, midY);
    add('RoadRight', width, spanY, ring.right, midY);

    // Dashed centre line on the top lane only, merged into one mesh. The corners would
    // need the dashes to turn with them, and the side lanes read fine plain — they are
    // short and always have the lot on one shoulder.
    const dash = 0.33, gap = 0.31, span = dash + gap;
    const n = Math.floor(13 / span);
    const start = -6.5 + (13 - (n - 1) * span) / 2;
    const parts: MeshPart[] = [];
    for (let i = 0; i < n; i++) {
        const x = start + i * span;
        // Skip the stretch the side lanes cross, where a centre line would run into the
        // corner instead of down the middle of anything.
        if (x > ring.left - half && x < ring.left + half) continue;
        if (x > ring.right - half && x < ring.right + half) continue;
        parts.push(boxPart(dash, 0.055, 0.06, x, ring.top));
    }
    const line = makeMerged('RoadLine', parts, ROAD_LINE);
    line.setPosition(0, 0, ROAD_Z + 0.01);
    root.addChild(line);
}
