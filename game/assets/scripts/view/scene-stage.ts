import { Node, Color } from 'cc';
import { makeSlab, makeMerged, boxPart, MeshPart } from './slabs';

/**
 * The scene's flat graphic layer: ground, grid, lot, roads. Every colour here is the
 * colour that reaches the screen — these panels are unlit (see `makeSlab`) — and every
 * panel is rounded, which is most of what separates this from a pile of boxes.
 *
 * They read light to dark in that order: ground, lot, road. The ground carries the whole
 * palette's floor, so it cannot go much lighter than this — the passenger track is white,
 * and against the first version's near-white ground it disappeared.
 */
export const GROUND = new Color(205, 215, 236);
/** Grid line: a lighter tint of GROUND, opaque. */
const GRID_LINE = new Color(224, 232, 247);
/**
 * The lot, six units under the ground and BEHIND the grid, which is a change of kind rather
 * than of shade. It was 190,200,226 -- fifteen units under -- and it sat in FRONT of the grid,
 * so the lower half of the screen was a large flat panel of a different colour with no grid on
 * it while the upper half was gridded. Reported, twice, as the background not carrying on: once
 * about the top of the screen (which was the ground panel falling short; see `setupBackground`)
 * and once about the bottom, which was this.
 *
 * Now the grid runs unbroken from the top of the frame to the bottom and the lot is a faint
 * tint under it, still bounded by its dashed border. Six units is enough to see when you look
 * for the play area and not enough to read as a second background.
 *
 * ITS DROP SHADOW WENT WITH IT. A panel you can barely see cannot be lifted off anything, and
 * a shadow under an invisible edge reads as dirt. The parking bay above still has one, and
 * should -- that panel is genuinely a raised tray.
 */
const LOT = new Color(199, 209, 231);
const LOT_DASH = new Color(255, 255, 255);
const ROAD = new Color(166, 177, 204);
const ROAD_LINE = new Color(242, 246, 253);

const GRID_PITCH = 0.66;
const GRID_THICK = 0.03;

/**
 * The lot's corner radius. The drop-shadow offset that used to live beside it went with the
 * lot's shadow (see LOT); the parking bay keeps its own copy, which is where it is used.
 */
const LOT_R = 0.24;

/**
 * The depth stack, front to back. Cars stand ON the board plane (wheels at z = 0) with a
 * contact shadow at z = -0.06, so nothing may have a face in front of that or the shadows
 * get buried. Every panel is thin (0.06) for one reason: a drop shadow has to fit BEHIND
 * the panel that casts it and still be in FRONT of the road below, or it gets depth-
 * rejected exactly where it is meant to show. Faces, in order:
 *
 *   -0.06  car contact shadows
 *   -0.08  stall pads          -0.09  stall rims (parking-view)
 *   -0.11  lot dashed border    -0.11  parking bay panel (parking-view)
 *   -0.18  panel drop shadows
 *   -0.28  ring road
 *   -0.32  grid lines
 *   -0.35  lot                  -0.5   ground
 *
 * Neighbouring faces stay at least 0.01 apart and never coplanar, so the ordering holds
 * without depth-bias tricks.
 */
const GROUND_Z = -0.5;
const GRID_Z = -0.32;
/**
 * BEHIND the grid, not in front of it, which is what lets the grid cross the lot -- see LOT.
 * The dashed border stays where it was, well in front of both, because the border is the thing
 * that has to be read.
 */
const LOT_Z = -0.35;
const DASH_Z = -0.11;
const ROAD_Z = -0.28;
/** Exported for the parking bay's shadow, which is the only panel that still casts one. */
export const SHADOW_Z = -0.18;

/**
 * Size the lot slab needs to cover a board `h` units tall at `scale` world units per board
 * unit, plus a small apron. The caller may draw it larger (it does, to fill the view) but
 * never smaller.
 */
export function lotHeight(h: number, scale: number): number {
    return h * scale + 0.3;
}

/** Width of the lot slab for a board `w` units across. */
export function lotWidth(w: number, scale: number): number {
    return w * scale + 0.3;
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
 * under `root` (the tilted boardRoot). The grid is a single merged mesh — 60-odd separate
 * line nodes would be 60 draw calls for something the eye reads as one texture.
 *
 * SIZED AND CENTRED FROM THE FRAME, where it used to be a hard-coded 13 x 21 centred on
 * board y = -1. Both halves of that were wrong once the board tilted and the lot grew:
 *
 *  - The frame is about 25.7 board units tall on a phone (2 * orthoHeight / cos(tilt) --
 *    board units up the screen foreshorten, so the camera holds MORE of them than of world
 *    units), against a panel 21 tall. Nearly five units short.
 *  - The camera centres on the CONTENT's midpoint, not on board y = 0, and that midpoint
 *    moves down whenever the lot grows. So the panel's own centre has to follow it or the
 *    shortfall all lands at the top.
 *
 * Both together left a band across the top of the screen with NO GRID on it. The ground
 * COLOUR was never missing there -- `setupCamera`'s clear colour is exactly GROUND, which is
 * why this went unnoticed for so long -- what was missing was the grid over it, and the
 * report was "extend the background at the top of the screen up to the edge".
 *
 * MARGIN, not an exact fit: a viewport resize re-runs `fitCamera` and can only ever zoom
 * FURTHER out, and it does not rebuild the board -- so the panel has to be bigger than the
 * frame it was built for, by more than a plausible resize.
 */
const BG_MARGIN = 2;

export function setupBackground(root: Node, halfW: number, halfH: number, cy: number): void {
    const W = 2 * (halfW + BG_MARGIN), H = 2 * (halfH + BG_MARGIN);
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
 * The parking lot: a rounded panel `bw` x `bh` centred on `gridY`, with a white dashed
 * border and a soft drop shadow. No lane lines — cars face varying directions, so column
 * lanes don't fit the gameplay (the reference art uses a plain lot plus a dashed border).
 *
 * The size arrives from the caller rather than being re-derived from the grid: the lot is
 * widened past what the columns need so it reaches the edge of the view, and only the
 * caller knows how wide that is.
 */
export function setupStage(root: Node, bw: number, bh: number, gridY: number): void {
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
