import { Node, Color } from 'cc';
import { makeSlab, makeMerged, makeShadowSlab, boxPart, MeshPart } from './slabs';
import { LIFT, shadowThrow } from './shadow';

/**
 * The scene's flat graphic layer: ground, grid, lot, roads. Every colour here is the
 * colour that reaches the screen — these panels are unlit (see `makeSlab`) — and every
 * panel is rounded, which is most of what separates this from a pile of boxes.
 *
 * They read light to dark in that order: ground, lot, road. The ground carries the whole
 * palette's floor, so it cannot go much lighter than this — the passenger track is white,
 * and against the first version's near-white ground it disappeared.
 *
 * TWO THINGS MOVED, and it was the second that mattered. The saturation came down from about
 * 45% to 11%: the floor used to be a blue surface and six saturated car colours had to fight it
 * for the eye. That was worth about 7 dE on its own -- a change you can see side by side and
 * cannot see from memory. It shipped once by itself and came back as "looks like nothing
 * changed", which was a fair reading.
 *
 * What actually held the cars back was LUMINANCE, and measuring it needs the car's WALL colour
 * rather than anything in colors.ts: the wall is `lighten(c, 0.24)` (see car-mesh) and so a good
 * deal brighter than the base hue. Those six walls sit at 141 red, 157 blue, 158 purple, 191
 * green, 196 cyan, 217 yellow. The ground was 214. A YELLOW CAR STOOD 3 LUMINANCE UNITS OFF THE
 * FLOOR IT WAS PARKED ON -- same brightness, told apart by hue alone -- with green at 23 and
 * cyan at 18 not far behind. No amount of draining the blue out fixes that; only moving the
 * floor does.
 *
 * It is 177 now, which puts the nearest car 15 units away instead of 3. The number is not free
 * to choose: six car luminances leave only two gaps wide enough to sit in, 170-180 and 120-130,
 * and anything between them lands on a colour (190 hits green, 160 hits blue and purple). This
 * is the light end of that pair, because a pale floor is what was asked for.
 *
 * DOWN is also the safe direction for the note above -- a darker floor gives the white passenger
 * track MORE to sit against, not less. The one thing it costs is the contact shadows, which are
 * a flat black alpha and so fall from 38 units of separation to 31; still read, not re-tuned.
 *
 * ---
 *
 * THE FLOOR IS TWO FLOORS NOW, and the paragraph above is why it had to become two rather than
 * move again. Everything it says is still true and still binding -- it is just that ONE surface
 * cannot satisfy it twice, because the two halves of this screen hold different things:
 *
 *   - The lower half holds CARS. Its contrast problem is the one measured above, and the answer
 *     is the dark end of the range rather than the light one.
 *   - The upper half holds the PASSENGER TRACK, which is white, and the crowd standing on it.
 *     Its contrast problem is the opposite one -- it wants the floor dark, but only relative to
 *     white, and it has no cars on it at all to collide with.
 *
 * So the rule the whole palette now follows is: DARK IS WHERE CARS GO, LIGHT IS WHERE PEOPLE GO.
 * Lot and roads take the dark end; ground and grid go lighter and cooler than they were. The
 * parking bay already worked this way before anything here changed -- its stall pads are
 * (76, 87, 115) and the cars park INSIDE those, not on the pale tray around them -- so this is
 * the rest of the scene catching up with a rule one component already followed.
 *
 * MEASURE IT OFF THE ROOF, NOT THE WALL, and this correction matters more than the repaint it
 * was found during. The paragraph above measures WALLS because the wall is the brighter surface
 * and so looked like the conservative choice. It is the wrong surface: this camera is
 * ORTHOGRAPHIC and the board is tilted well back (BOARD_TILT), so what fills a car's area is
 * its ROOF, with only a sliver of wall showing under it (car-mesh's header opens by saying
 * exactly this). And the roof is not lightened at all -- DOME_PROFILE's note is explicit that
 * the crown is the palette colour and nothing else -- so the numbers to clear are colors.ts's
 * own, which at the time of this repaint were 120.5 red, 125.1 blue, 139.5 purple, 155.1 green,
 * 165.9 cyan, 203.4 yellow.
 *
 * Those sat LOWER and CLOSER TOGETHER than the walls, which moves the safe floor down and makes
 * the wall-based reading optimistic rather than conservative -- the opposite of what it was
 * picked for. Read the old lot (170.5) that way and its nearest car was CYAN at 4.6 units, not
 * purple at 12.5: a cyan bus was all but the same brightness as the tarmac it stood on, and the
 * wall measurement could not see it.
 *
 * WHAT IT BOUGHT, measured off those roofs: the worst car-against-floor contrast went from 4.6
 * (cyan) to 18.7 (red), with blue next at 23.3 and everything else far clear. The floor moved
 * AWAY from the car palette instead of trying to find a gap inside it, which is the only move
 * that helps all six at once.
 *
 * THE PALETTE HAS SINCE MOVED TOO, and it moved the same way, so the two are not in tension.
 * colors.ts was rebuilt in HCL shortly after this (its header has the reasoning) and the roofs
 * now clear this floor by: red 24.1, blue 29.2, purple 44.1, green 54.7, cyan 71.1, yellow
 * 94.3. Red is tightest again at 24 -- the rebuild spent its budget on CHROMA rather than on
 * luminance headroom, deliberately, because an intermediate version that maximised headroom
 * for all six shipped and was reported as foggy (colors.ts's header has that story). A
 * saturated car at 24 reads better on this floor than a pale one at 40. Kept because the
 * METHOD is the durable part: measure roofs, not walls.
 *
 * 101.8 IS NOT THE DARKEST AVAILABLE, and whichever car is nearest is the number to watch.
 * Below about 100 the gain slows while the lower half of the screen keeps getting heavier, and
 * the roofs are LIT where this panel is not, so they render brighter than their base figures --
 * the true margin is wider than anything quoted here. If a car reads flat on a device, this is
 * the constant to move, and down is the direction.
 *
 * WHAT IT COST, and these are the two to look at on a device first, in this order:
 *
 *   1. The white track now stands 56 luminance units off the ground instead of 78. That is the
 *      "first version's near-white ground" failure from the top of this comment, spent down
 *      deliberately rather than stumbled into -- 56 is still a clear read, but it is the least
 *      headroom in this file and it is what any further lightening of GROUND spends next.
 *      BAND_SHADOW went from 34 to 46 alpha to hold the ribbon up; see its note in track-view.
 *   2. The cars' CONTACT SHADOWS. The paragraph above already flagged these once as falling
 *      from 38 units of separation to 31 -- halving the floor took them to 18, because a flat
 *      alpha scales with what it lands on. FIXED SINCE, by raising CONTACT_ALPHA to 112, which
 *      puts them back at 30 on this floor.
 *
 *      It stayed broken for a while on a constraint that did not exist: blob-shadow's header
 *      claimed the crowd wore the same shadows, so raising the alpha looked like it would
 *      dirty 256 figures on the white track. `blobShadow` has one caller and it is cars. The
 *      lesson is the ordinary one -- a comment is not a call graph.
 *
 * Both were edges going quiet, and both were found by arithmetic rather than by looking.
 */
export const GROUND = new Color(189, 200, 218);
/**
 * Paving seam: a shade DARKER than GROUND, not a lighter tint drawn over it. It was 224,232,247
 * -- white lines on top of the surface -- and an overlay in FRONT of the floor competes with the
 * cars in front of that, which is what "the grid is too hard" was about.
 *
 * Sinking it under the surface turns it into a joint between slabs, which is a thing a parking
 * lot actually has, and it costs half the contrast on the way: the old line stood 17 luminance
 * units off the ground, this one sits 12 under. With the wider pitch below, the plane keeps a
 * texture that catches the tilt and loses the pattern that read as graph paper.
 *
 * It tracked GROUND up and cooled with it (was 161,167,178 at 10 under). The seam is now the
 * only thing drawn on the upper half besides the track and the crowd, so it carries the whole
 * "this is a place" job up there on its own -- which is the argument for 12 rather than the
 * old 10, and the argument against any more than 12: a seam that reads as a GRID is the graph
 * paper this constant already failed into once.
 */
const GRID_LINE = new Color(176, 188, 208);
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
 *
 * ---
 *
 * ALL THREE OF THOSE DECISIONS ARE REVERSED, and the paragraphs above are kept because the
 * reversal only holds while the reason they gave has stopped applying. It is 97 units under the
 * ground rather than six, it sits IN FRONT of the grid again, and the drop shadow is back.
 *
 * The bug those paragraphs fixed was real: a panel FAINTLY different from the background, with
 * no grid on it, reads as the background failing to carry on. Note what actually made it read
 * that way -- not the difference, but the SIZE of the difference. Six units is too much to be
 * nothing and far too little to be something, so the eye files it as a rendering fault. The fix
 * available at the time was to push it toward nothing, and that is what "faint tint under the
 * grid" is.
 *
 * This pushes it the other way instead, to 97, which is the distance at which it stops being a
 * panel of slightly-wrong background and becomes a SURFACE: asphalt laid over the street. A
 * surface is allowed to interrupt the paving grid -- that is what laying something over
 * something means -- and it is allowed to cast a shadow, because you can see its edge now. The
 * earlier note is exactly right that an invisible edge's shadow reads as dirt; this edge is not
 * invisible.
 *
 * THE COLOUR IS NOT FREE TO CHOOSE. Every car on the board stands on THIS surface, so it is the
 * one constant in the file the car palette actually constrains, and the header's revised
 * measurement -- off ROOFS, which is what an orthographic camera on a tilted board mostly shows
 * -- is what sets it. The roofs run 125.9 red, 131.0 blue, 145.9 purple, 156.5 green, 172.9
 * cyan, 196.1 yellow (see colors.ts, which was rebuilt against this floor); at 101.8 the
 * nearest is red at 24.1.
 *
 * A FIRST PASS PUT IT AT 119 AND THAT WAS WRONG BY A LOT, which is worth leaving here because
 * the error was invisible from the wall numbers: 119 clears the nearest WALL (red, 141) by 22
 * and looks perfectly safe, while sitting 1.1 units off the red ROOF and 5.7 off the blue one
 * (those being the roofs of the palette in force at the time; colors.ts has since moved).
 * A red bus would have been the same brightness as the tarmac, told apart by hue alone, which
 * is precisely the failure the header opens by describing -- rediscovered from the other end of
 * the range, one surface later.
 */
const LOT = new Color(95, 102, 118);
/**
 * Off-white, HELD AT +47 LUMINANCE over the lot -- which is what it measured back when the floor
 * was pale and this was pure white. That +47 was never a designed number: the lot was at 208 and
 * white is where the channel stops, so it is simply what fell out. It is also the version nobody
 * ever complained about, which is what makes it worth keeping deliberately.
 *
 * Dropping the floor to 177 would have handed a white dash +76 for nothing, and a brighter
 * boundary drawn around the whole play area is the opposite of what "lower the background's
 * contrast" asked for. The border still has to be READ -- it is the one background element
 * carrying information -- and +47 is what reading it costs. Nothing is gained by spending more.
 *
 * THE +47 IS GONE AND WAS NOT REPLACED BY ANOTHER RULE. The lot dropped 51 units under it, so
 * the dash now stands +110 over it where it stood +47. It came down a little, to 211, and that
 * is the point: the dash barely moved, the floor did.
 *
 * What changed is what the dash IS. At +47 on a pale lot it was a boundary marker, and the
 * argument above -- buy only the contrast needed to read it -- was the right one for a marker.
 * On asphalt a white dashed line is not a marker, it is the thing car parks are painted with,
 * and the reason to keep it bright is that it is now carrying the "this is a car park" read
 * almost single-handed. So it is held near white and the ratio is a consequence, not a target.
 */
const LOT_DASH = new Color(206, 212, 224);
/**
 * Down with the lot, and kept just UNDER it (93 against 102) so the ring road reads as the same
 * asphalt, slightly shaded, rather than as a third surface. The two used to differ by 35, which
 * was a lot to spend on telling apart two things that are both "ground the cars drive on".
 *
 * Cars only cross this, never rest on it, so the roof clearances that bind LOT are slack here --
 * the nearest is red at 28.
 */
const ROAD = new Color(86, 93, 108);
/** Held at the +69 it had over ROAD, for the reason spelled out on LOT_DASH. */
const ROAD_LINE = new Color(156, 162, 176);

/**
 * Doubled from 0.66, and thinned with it. At the old pitch the seams fell about a car's width
 * apart, so the floor carried more lines than it carried cars and the eye read the ruling
 * before it read the board. Twice the spacing is slab-sized, lands on every second line the old
 * grid drew (so nothing shifts relative to the lot), and halves the merged mesh while it is
 * there.
 */
const GRID_PITCH = 1.32;
const GRID_THICK = 0.025;

/** The lot's corner radius. */
const LOT_R = 0.24;

/*
 * The lot's drop-shadow offset used to be a constant here (0.14). It is `LIFT.surface` in
 * shadow.ts now -- along with the argument that went with it, which turned out to apply to
 * every panel rather than just this one.
 */
/**
 * THE ONE DELIBERATE DEPARTURE FROM `SHADOW_ALPHA` (44), and the area is the whole argument.
 * This shadow is about fifteen times the bay's, spread across the one part of the screen that
 * is meant to read as open pavement, and at 44 that much translucent ink stops being an edge
 * and becomes a smudge the lot is sitting in. It separates by 19.4 against the pavement where
 * the baseline would give 28.5, and the edge still reads because it is against the lightest
 * surface in the scene.
 */
const LOT_SHADOW_ALPHA = 30;

/**
 * The lot's shaded side, and how much of it shows.
 *
 * THE SAME TWO-PLATE TRICK THE HUD USES -- a lit face with a darker plate peeking out below it,
 * which is what PILL_BASE's note calls out as shared with the unlock button, the padlock rims
 * and the win panel's stars. Here it turns the lot from a coloured region into a slab of asphalt
 * with a thickness.
 *
 * IT SHOWS BELOW, not above, and that is the camera rather than the light. The board is tilted
 * back, so the side of a raised object that faces the viewer is the one toward board -Y -- the
 * same face car-mesh calls the near wall and spends WALL_LIFT on. The drop shadow goes the other
 * way (see shadow.ts) because that is set by the light, not by the viewing angle; a plinth and a
 * shadow on opposite sides is what a lit, tilted object actually looks like.
 *
 * 0.07 fits inside the 0.17 of pavement between the lot's top edge and the ring road's near
 * kerb, so the plinth never touches the road. That clearance is RING_OFF minus half ROAD_H and
 * lives in GameController; if the ring road ever moves in, this is what gives first.
 */
const LOT_PLINTH = new Color(70, 76, 90);
const LOT_PLINTH_DROP = 0.07;

/**
 * The depth stack, front to back. Cars stand ON the board plane (wheels at z = 0) with a
 * contact shadow at z = -0.06, so nothing may have a face in front of that or the shadows
 * get buried. Every panel is thin (0.06) for one reason: a drop shadow has to fit BEHIND
 * the panel that casts it and still be in FRONT of the road below, or it gets depth-
 * rejected exactly where it is meant to show. Faces, in order:
 *
 *   -0.06  car contact shadows
 *   -0.08  stall pads          -0.09  stall rims (parking-view)
 *   -0.11  lot dashed border    -0.14  parking bay panel (parking-view)
 *                               -0.15  parking bay plinth (parking-view)
 *   -0.18  panel drop shadows
 *   -0.28  ring road
 *   -0.29  lot
 *   -0.30  lot plinth
 *   -0.31  lot drop shadow
 *   -0.32  grid lines
 *   -0.5   ground
 *
 * Neighbouring faces stay at least 0.01 apart and never coplanar, so the ordering holds
 * without depth-bias tricks. THE BAND FROM -0.28 TO -0.32 IS NOW FULL: ring road, lot, lot
 * plinth, lot shadow and grid lines sit at exactly 0.01 apart all the way down, which is the
 * minimum this scheme allows. Anything else that needs to go in there requires the whole band
 * re-spaced, not squeezed -- there is no room left to borrow.
 */
const GROUND_Z = -0.5;
const GRID_Z = -0.32;
/**
 * IN FRONT of the grid, which is what stops the paving grid crossing the asphalt -- see LOT,
 * where the reversal of the old "behind" is argued. Still behind the ring road, so the road
 * covers the lot where the two meet, exactly as before.
 *
 * The dashed border stays where it was, well in front of both, because the border is the thing
 * that has to be read.
 */
const LOT_Z = -0.29;
/**
 * The lot's shaded side, one band behind the lot's face. It has to be BEHIND the face it belongs
 * to (so only the sliver past the edge shows) and IN FRONT of the shadow (a plinth is part of the
 * object; the shadow falls under the whole of it).
 */
const LOT_PLINTH_Z = -0.30;
/**
 * The lot's own drop shadow, between the lot and the grid: it has to fall ON the paved ground
 * and UNDER the asphalt that casts it. Same reasoning as the panel shadows at -0.18, one band
 * down. See LOT for why the lot casts a shadow again at all.
 */
const LOT_SHADOW_Z = -0.31;
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
    // Built before the lot so it is the earlier sibling, the same order the parking bay uses.
    // Depth orders these two regardless, but sibling order is what a reader checks first.
    const shadow = makeShadowSlab('LotShadow', bw, bh, LOT_R, LOT_SHADOW_ALPHA);
    shadow.setPosition(0, gridY + shadowThrow(LIFT.surface), LOT_SHADOW_Z);
    root.addChild(shadow);

    const plinth = makeSlab('LotPlinth', bw, bh, 0.06, LOT_PLINTH, LOT_R);
    plinth.setPosition(0, gridY - LOT_PLINTH_DROP, LOT_PLINTH_Z);
    root.addChild(plinth);

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
