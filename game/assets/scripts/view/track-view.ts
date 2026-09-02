import { Node, Color, Quat, Vec3, MeshRenderer, primitives, tween, Tween } from 'cc';
import { BOARD_TILT } from './board-layout';
import { colorOf } from './colors';
import { flatMaterial, alphaMaterial } from './materials';
import { makeSlab, makeShadowSlab, mergeParts, MeshPart } from './slabs';
import { buildPaxDot, buildPaxFigure, recolorPaxFigure } from './pax-figure';
import {
    BLOCK, blockOffset, blockRanks, blockSpan, Channel, FeedSide, GAP_ARC, GROUP_SIZE, LANE,
    PaxGroup, TrackPath,
} from '../core/index';

/**
 * Half-width of the white band the rows ride on. Comes from core because validateTrack
 * measures a level's channels against the same number (see LANE in core/track-path.ts).
 */
const BAND_HALF = LANE.bandHalf;
const LANE_STEP = LANE.step;
const LANE_START = LANE.start;

/**
 * How far a waiting figure turns, in degrees, out of a FULL turn of 90 -- from facing the
 * camera toward facing the track it is queueing for.
 *
 * A FRACTION of the full turn, and that is what makes it a knob rather than a hand-picked
 * pair of signs: `faceYaw` interpolates between camera-facing and the real direction, so 90
 * would be the honest orientation and 45 is the compromise. At the honest 90 a lane figure is
 * in pure profile -- the camera looks down world -Z and a lane runs along board X, so its face
 * points straight across the screen and is not visible at all. At 45 the face still reads
 * while the body is plainly angled toward the track.
 *
 * The ring does NOT use this: its figures take the full turn (see `layoutRow`). A ring figure
 * faces the way its row is travelling, which sweeps through every direction as it goes round,
 * so there is no fixed "camera side" to hold it back toward -- and scaling a yaw toward zero
 * is not even continuous once it passes 180.
 */
const FACE_TURN = 45;

/**
 * The yaw, in degrees, that turns a figure's face onto (fx, fy) in the board plane.
 *
 * A figure stands along the board's normal and faces board -Y at rest (`buildPaxFigure`), so
 * a yaw of `y` about the board normal puts its face on (sin y, -cos y) -- hence the atan2
 * below, with the arguments in that order and that sign.
 *
 * DERIVED, and that matters: the lane figures' turn used to be a hand-chosen `out.x > 0 ?
 * -FACE_TURN : FACE_TURN`, carrying a note saying the sign had been checked on screen rather
 * than worked out, that an earlier paper derivation had been wrong, and that the frame under
 * it had since moved three times. Computing it from the direction the figure should face
 * removes the choice: get the direction right and the sign follows. (For the record the old
 * pair was correct -- `faceYaw(-out.x, -out.y) * 0.5` reproduces both of its values exactly
 * on a lane running along X.)
 */
function faceYaw(fx: number, fy: number): number {
    return Math.atan2(fx, -fy) * 180 / Math.PI;
}

/** Scratch for the row-wide facing quaternion, so `layoutRow` allocates nothing per frame. */
const FACING_SCRATCH = new Quat();

/**
 * The track surface, how far behind the board plane it sits, and the soft shadow that
 * lifts it off the ground. White on a light ground is a weak edge on its own; the shadow
 * is what actually makes the ribbon and the two channels read as raised.
 */
const BAND = new Color(255, 255, 255);
const BAND_Z = -0.09;
const BAND_SHADOW = new Color(24, 34, 56, 34);
const BAND_DROP = 0.07;

/**
 * Height of a passenger figure on the board. Calibrated against LANE_STEP (0.45): the
 * figure (arms included) is roughly as wide as it is tall, so this keeps waiting
 * passengers in adjacent lane slots clear of each other. Feeds back into which ring
 * lengths are legal (see validateTrack), so this does not change independently of
 * the track's geometry budget.
 */
/**
 * EXPERIMENT: draw each group as ONE dot instead of four figures.
 *
 * A measurement, not a proposal. It has already been settled that a group has to read as
 * FOUR -- that is what retired the stand-them-up experiment -- so this is not a candidate to
 * ship. What it buys is the answer to "how much of the frame is the crowd?": it takes the
 * ring and the channels from 256 figures at 268 triangles each down to 54 dots at 72, about
 * 69k triangles to 3.9k, and the per-frame node writes in `repositionAll` from 220 to 55.
 *
 * If the frame rate barely moves, the crowd is not what is costing the frame and the search
 * moves elsewhere. If it jumps, the honest options are fewer GROUPS (a shorter ring) rather
 * than fewer people per group.
 *
 * The dot is BLOCK.figure across, which is also blockLength -- so at seam 0 the dots just
 * touch, and a ring of dots is exactly as long as the ring of rows it replaces.
 *
 * Set to true to price the crowd again. Boarding always flies real figures: `spawnPassenger`
 * is untouched, both because the flight has to read and because it was not on the measurement.
 *
 * ANSWERED, on device, level 1 with a filled ring. Splitting the two speeds' frame times into
 * a per-frame part and a per-tick part (frame = P + tickWork/fps, and 2x doubles the tick
 * rate) gives:
 *
 *     256 figures   per-frame 14.93ms   tick work 254 ms/s
 *      54 dots      per-frame 14.71ms   tick work 147 ms/s
 *
 * So DRAWING the crowd costs 0.2ms a frame -- nothing. Deleting 79% of the passenger
 * geometry did not buy a frame; what it bought was PER-TICK work, 107 ms/s of it. Two
 * consequences: simplifying the figures further is pointless, and there is a floor of about
 * 14.8ms (~68fps) underneath all of this that is the rest of the scene, not the passengers.
 * The tick is where the remaining work is, which is why the tag now prints it (`tickFps`).
 */
const ROW_AS_DOT = false;
const OFFSET_SCRATCH_ZERO = { across: 0, along: 0 };

const PAX_HEIGHT = 0.55;

/**
 * How much depth (+Z, toward the camera) a figure gains for every board unit it stands
 * BELOW the top of the crowd -- so the lower a figure's feet, the nearer it is drawn, the
 * way a crowd standing on a floor reads.
 *
 * Without it the figures are all at z = 0 and INTERPENETRATE, which is what a player sees
 * as two groups smeared into each other. The cause is a mismatch core cannot see: a figure
 * lies IN the board plane and is 0.55 tall (see `trackReach`), but `minRowGap` -- the check
 * `capacityOptions` gates a ring length on -- models it as a 0.22 DOT at its feet. Rows are
 * 0.33-0.38 apart, so a body reaches a row and a half past the point that was checked.
 * Measured across the five shapes at their shipped capacities, 96-134 pairs of figures from
 * DIFFERENT cells overlap on screen, the worst by 40-53% of a whole figure's area, and the
 * checked gap (0.226-0.272) clears its 0.22 floor in every one of those cases. The check is
 * not wrong about what it measures; it measures the wrong solid.
 *
 * Spacing cannot fix it: clearing a 0.55 body needs rows 0.55 apart, which is a ring of ~16
 * instead of 24-28. Depth can, and it is free -- the camera is ORTHOGRAPHIC and the board is
 * untilted (BOARD_TILT 0), so z moves nothing on screen. It only decides who is in front.
 *
 * 2.1 is the smallest value that separates every overlapping cross-cell pair on all five
 * shapes THROUGH A WHOLE ROTATION. Sizing it at one phase is not enough and cost a round:
 * 1.6 clears every pair in a still frame, but the ring turns, and swept over a full cell
 * pitch the closest overlapping pair closes to 0.106 of board in y rather than the 0.14 a
 * still frame shows -- so 714 of 98690 overlapping pairs still had less than a head (0.22)
 * of depth between them at some point in the turn. That is a defect you can only see while
 * it MOVES, which is exactly how it was reported. At 2.1 the count is zero.
 *
 * A second slope for the four figures WITHIN a row was measured and rejected. On the ring's
 * flanks a row lies across the screen and its four heads overlap by design, all at the same
 * depth; a per-seat ladder would separate them. But it trades against this one: at 2.1 with
 * a seat ladder of 0.8, cross-cell interpenetration goes from 0 back up to 283, while
 * same-row overlaps only fall from 19458 to 17481. Different colours smearing is the defect;
 * one colour merging into its own silhouette is the design (see BLOCK in core). Do not
 * spend the first to buy the second.
 *
 * The ring ends up 6.5 units deep, against a camera 15 away.
 *
 * STANDING THE FIGURES UP would have made this whole constant unnecessary, and it was tried
 * and rejected -- do not propose it again without reading why. A quarter turn on the `fit`
 * node sends the figure's own axis at the camera; the head is the widest part, so it hides
 * the rest and each passenger draws as a ball. Geometrically it wins outright: cross-cell
 * overlaps 98690 -> 5836, worst case 60% of a body -> a 5% graze, and `minRowGap` becomes
 * TRUE rather than merely satisfied, since a ball seen end-on really is the 0.22 dot it
 * measures. It was rejected on gameplay: a row of four balls does not read as FOUR, and how
 * many a group holds is a number the player has to judge to know which car it can fill.
 */
/**
 * Fake depth for the crowd: how much board z a row gets per board unit it sits UP the board, so
 * that a near row draws in front of a far one.
 *
 * ZERO ONCE THE BOARD IS TILTED, and not as a compromise -- the tilt does this job properly. A
 * row further up a board tipped away from the camera IS further from the camera, so the depth
 * buffer orders the crowd on its own. Keeping the fake as well would be actively wrong: at 2.1
 * per board unit over a ring about two units deep, it is more than four world units of z, which
 * a tilt turns into over two units of SHEAR up the screen. That is the one value in the scene
 * big enough to have wrecked the tilt, and it was only ever free because the board was flat.
 *
 * The 2.1 is kept for the flat case so BOARD_TILT 0 still reproduces the old board exactly.
 */
const PAX_DEPTH = BOARD_TILT === 0 ? 2.1 : 0;

/**
 * There is no arm swing any more, and the arms are baked into the figure's one mesh (see
 * ARM_POSE_DEG in pax-figure). It was the most expensive thing on the frame -- two node
 * rotations per shown figure, so 224 writes on leaf renderer nodes at 28 cells and 384 at
 * 48 -- and it needed its own node per arm, which is what kept a passenger at four
 * renderers instead of one. The device was measured at 8fps against the simulator's 49.
 *
 * It had also been strobing rather than swinging, which is a separate bug worth not
 * repeating: it was driven by `phaseHolder.p`, a SAWTOOTH reset every tick, so every arm
 * swept and then snapped back 5.9 times a second -- a mean of 18 degrees and up to 29, on
 * every figure at once. That fix (drive it from monotonic travel, not from the phase) is
 * recorded in the README, and it is the fix to start from if the swing ever comes back.
 */

/** Identity shade — the active/undimmed case for `paintPassenger`. */
const NO_SHADE = (c: Color): Color => c;

/**
 * Ranks in one cell's block -- ONE, at GROUP_SIZE 4: a group is a single row of four across
 * the track. The block's shape (how many abreast, how far apart) is core's `BLOCK`, because
 * `minRowGap` has to be able to check it before a ring length is declared legal.
 *
 * The rank machinery below is kept for a deeper block, which GROUP_SIZE can ask for. Rank
 * order is back to front: the LOWEST indices are the rearmost rank, and `paintRow` shows the
 * first `count` figures of a partly boarded block, so a block empties from its leading edge
 * -- the passengers nearest the doorway are the ones already gone.
 */
const RANKS = blockRanks(GROUP_SIZE);

/**
 * Along-lane step between the ranks of a WAITING block, for the same reason a ring cell has
 * its own: a lane slot is LANE.step (0.45) long and has to hold a whole block plus a gap
 * before the batch behind it, which a block at the ring's own rank pitch would not leave.
 * Inert while a block is a single row -- a row is 0.22 deep in a 0.45 slot, so the channels
 * get their gap for nothing.
 */
const LANE_RANK_STEP = (LANE.step - BLOCK.figure) / Math.max(1, RANKS - 1);

/** Scratch for `layoutRow`'s per-figure offset, so a per-frame call allocates nothing. */
const OFFSET_SCRATCH = { across: 0, along: 0 };

/**
 * Corner radius of a lane slab. Only its INNER end is ever seen now -- the outer end is
 * drawn past the edge of the screen (see `buildLanes`) -- but the radius still has to be
 * counted into how far past, or the rounding lands just inside the frame.
 */
const LANE_SLAB_R = 0.2;

/**
 * How far the drawn ring reaches above and below its own origin, in board units.
 *
 * The camera frames the board off this (see `buildBoard`), so it has to be MEASURED rather
 * than taken as the path's own extent. Two things stick out past the path:
 *
 *  - half a block across the centreline (`blockSpan / 2` = 0.46 at GROUP_SIZE 8), which is
 *    already a shade wider than the white band it rides on -- see BLOCK in core.
 *  - a whole `PAX_HEIGHT` above that, and this is the one that surprises: the figures lie
 *    IN the board plane along +Y (`pax-figure.ts` builds body and head up the local Y),
 *    they do not stand up out of it. Under the orthographic camera a passenger's head is
 *    therefore a full 0.55 above the row its feet are in -- the tallest thing on the board
 *    by a wide margin, and 0.55 of framing budget that reading the path alone misses.
 *
 * Only the top gets the figure height; the bottom edge of a row is its feet.
 */
export function trackReach(
    path: TrackPath,
): { top: number; bottom: number; left: number; right: number } {
    const SAMPLES = 240;
    const p = { x: 0, y: 0 };
    let top = -Infinity;
    let bottom = Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < SAMPLES; i++) {
        path.pointAt(i / SAMPLES, p);
        if (p.y > top) top = p.y;
        if (p.y < bottom) bottom = p.y;
        if (p.x < left) left = p.x;
        if (p.x > right) right = p.x;
    }
    const across = blockSpan(GROUP_SIZE) / 2;
    // `across` on all four sides -- a row straddles the centreline wherever it sits on the
    // path. PAX_HEIGHT only on top, because a figure stands UP the board plane from its feet
    // (see pax-figure), so it reaches further up than the row's own half-width but no further
    // to either side.
    return {
        top: top + across + PAX_HEIGHT,
        bottom: bottom - across,
        left: left - across,
        right: right + across,
    };
}

/**
 * How low the LEFT-hand feeder channel's rows hang, path-relative -- the floor of the empty
 * band down the left of the carousel, which is where the speed button lives.
 *
 * Channels enter at the track's vertical middle (measured: y 0 on rect/hex/oval, -0.027 on
 * trap), and their rows straddle that by half a block, so this comes out near -0.41 and the
 * band below it is 1.25 units tall on every shipped level -- ample for a button 0.68 across.
 *
 * Capped at 0 so the band can never reach above the track's own centreline. Without the cap,
 * a level fed only from the right has no left channel at all, the band becomes the whole left
 * side, and a button centred in it climbs to the carousel's MIDDLE left -- not the bottom-left
 * corner that was asked for.
 */
export function leftLaneFloor(path: TrackPath, capacity: number, channels: Channel[]): number {
    const p = { x: 0, y: 0 };
    let floor = 0;
    for (const channel of channels) {
        path.pointAt(channel.entry / capacity, p);
        if (p.x < 0) floor = Math.min(floor, p.y - blockSpan(GROUP_SIZE) / 2);
    }
    return floor;
}

/**
 * Lay a cell's figures out around its origin, given the unit ACROSS direction (dx, dy) and
 * the along-path step between its ranks. The along-path direction is (dy, -dx): for the
 * ring that is the way the cells travel (the outward normal of a clockwise walk is the
 * tangent turned a quarter left), and for a channel, whose across is the lane turned a
 * quarter, it is the outward direction -- so the rearmost rank of a waiting block is the
 * one further from the track, which is what a queue looks like.
 *
 * Called every frame for ring cells, because their across direction is the path normal and
 * turns as they travel; once at build time for the lanes, whose direction is fixed.
 *
 * IT ALSO SETS THE FACING, onto the along-path direction -- a queue faces the way it is
 * moving. One quaternion for the whole row (they all face the same way) assigned to each
 * figure, so the per-frame cost over the old version is `figures.length` calls to
 * `setRotation` and no allocation. The lanes overwrite it immediately afterwards with their
 * own held-back turn; see `buildLanes`.
 *
 * A row drawn as ONE ball is left at identity: a ball has no front.
 */
function layoutRow(figures: Node[], dx: number, dy: number, rankStep: number): void {
    // A row drawn as one thing sits on its own centre -- there is no block to spread out.
    if (figures.length === 1) { figures[0].setPosition(0, 0, 0); return; }
    const ax = dy, ay = -dx;
    Quat.fromEuler(FACING_SCRATCH, 0, 0, faceYaw(ax, ay));
    for (let i = 0; i < figures.length; i++) {
        const o = blockOffset(i, RANKS, rankStep, OFFSET_SCRATCH);
        const oy = o.across * dy + o.along * ay;
        // Depth from the figure's own y within the row, so the ramp holds INSIDE a row too.
        // It has to: where the path runs horizontally the four abreast stack up the screen
        // 0.20 apart, each 0.55 tall, and the same overlap appears within one group as
        // between two. The row node carries the depth of its own y (see `depthAt`), and
        // these compose because a row is never rotated.
        figures[i].setPosition(o.across * dx + o.along * ax, oy, -oy * PAX_DEPTH);
        figures[i].setRotation(FACING_SCRATCH);
    }
}

/**
 * One passenger node: the procedural figure (see pax-figure.ts). It cannot fail to
 * build — no asset load, no async — so there is no fallback path any more.
 */
function makePassenger(name: string, color: Color): Node {
    return buildPaxFigure(name, color, PAX_HEIGHT);
}

/** Recolor a node from `makePassenger`. A straight pass-through to pax-figure.ts. */
function paintPassenger(node: Node, color: Color, shade: (c: Color) => Color): void {
    recolorPaxFigure(node, color, shade);
}

/**
 * A row node holding GROUP_SIZE passenger figures as children. The row's own transform is
 * the group's position on the track; the children carry the across-the-track offsets AND the
 * facing, which `layoutRow` sets.
 *
 * The row is never rotated, but the reason it used to give for that is no longer true and
 * should not be trusted if this is revisited: it said the figures "stand along the board's +Y
 * and face +Z, and spinning the row about the board normal would tip them over". They stand
 * along the board's normal now (`buildPaxFigure`), so rotating the row about it would spin
 * them on the spot -- and would let the children's offsets be computed ONCE instead of every
 * frame. Left alone because the per-frame layout is not what costs anything here, and moving
 * it would touch the boarding flights, which read a figure's world position.
 */
function makeRow(name: string): Node {
    const row = new Node(name);
    if (ROW_AS_DOT) {
        row.addChild(buildPaxDot(`${name}-0`, Color.WHITE, BLOCK.figure));
        return row;
    }
    for (let i = 0; i < GROUP_SIZE; i++) {
        row.addChild(makePassenger(`${name}-${i}`, Color.WHITE));
    }
    return row;
}

/** Show the first `count` figures of a row in `color`, hide the rest. */
function paintRow(figures: Node[], color: Color, count: number, shade: (c: Color) => Color): void {
    for (let i = 0; i < figures.length; i++) {
        const on = i < count;
        figures[i].active = on;
        if (on) paintPassenger(figures[i], color, shade);
    }
}

/** Scratch output for `repositionAll`'s per-cluster, per-frame `point` calls
 *  (12 clusters * ~60fps), so that hot path doesn't allocate a `Vec3` per call. */
const REPOSITION_SCRATCH = new Vec3();
/** Scratch for the per-row path normal, same hot path as REPOSITION_SCRATCH. */
const NORMAL_SCRATCH = new Vec3();

/**
 * Floor colour for a channel that is not feeding yet: the same white as the live one, gone
 * grey. The waiting channel used to be shown by washing out its PASSENGERS instead, and
 * that was the wrong thing to grey out -- a passenger's colour is the one piece of
 * information the player is reading off the channel (which car will these fit?), and a
 * dimmed red is a colour that no car anywhere has. The floor carries the signal now, so
 * "which channel feeds next" is still readable and the colours stay honest.
 */
const BAND_IDLE = new Color(211, 217, 231);

/**
 * Renders the passenger loop as whatever closed track `core` hands it: rows of
 * same-coloured passengers flow around a `TrackPath`'s shape, board through a gap at
 * `boardIndex` and are fed in from one or two waiting channels beside that gap. One ring
 * cell carries one row of up to GROUP_SIZE figures, laid out across the direction of
 * travel. The path itself, and where its gap and entries fall, all come from the
 * constructor — this file draws them, it does not decide them.
 */
export class TrackView {
    private readonly path: TrackPath;
    /**
     * One walking-in row per side, reused for every entry (see `flierRow`), together with
     * its four figure nodes so the layout does not re-walk `children` every tick.
     *
     * `flierCycleId` replaces the node-identity test the old per-tick row allowed: with a
     * pooled node, "is this still my flier?" has to be a number. `flierOwns` is the CLUSTER
     * (not the ring slot -- see `ringOffset`) a side has hidden, so an interrupted cycle can
     * put its own one back; the old code did not need it because the interrupting cycle
     * always hid the same node, which stops being true once two entries share one row.
     */
    /**
     * How far cluster indices have drifted from ring slots: cluster `c` draws ring slot
     * `(c + ringOffset) % capacity`.
     *
     * THIS IS THE FRAME-RATE FIX, and it is worth stating why the obvious mapping was the
     * expensive one. `LoopSystem.step` rotates the ring by exactly +1 and MOVES the groups
     * rather than rebuilding them, so with cluster c bound to slot c, every cluster holds a
     * different colour every tick -- and a repaint is `MeshRenderer.material = ...`, which
     * rebuilds the sub-model's passes and re-buckets it in the instancing buffer. Measured
     * on device: 44 cells x 4 figures, about three quarters of them changing colour, cost
     * 127 of the tick's 157 ms/s -- 21.5ms inside a single frame, six times a second.
     *
     * Advancing this offset with the ring instead means a cluster follows its own group, so
     * its colour does not change at all. What changes per tick is only where it is DRAWN,
     * and that was already recomputed every frame by `repositionAll`. Repaints drop to the
     * two slots core actually touches: the one that empties at the gap and the one an
     * entrance fills.
     *
     * Correctness does NOT rest on the +1 assumption -- `shownColor`/`shownCount` do. If the
     * offset were ever wrong the comparison repaints, exactly as before; only the saving
     * would be lost.
     */
    private ringOffset = 0;
    /**
     * What each cluster is currently showing, so a repaint only happens on a real change.
     * Colour AND count, because a row loses figures one at a time as it boards.
     */
    private shownColor: (string | null)[] = [];
    private shownCount: number[] = [];

    private readonly flierRows: Record<FeedSide, Node | null> = { far: null, near: null };
    private flierFigures: Record<FeedSide, Node[]> = { far: [], near: [] };
    private readonly flierCycleId: Record<FeedSide, number> = { far: 0, near: 0 };
    private readonly flierOwns: Record<FeedSide, number | null> = { far: null, near: null };

    private readonly capacity: number;
    private readonly boardIndex: number;
    /**
     * The level's feeder channels, already normalised by `LoopSystem` -- side, drain
     * order, entry cell and lookahead all resolved there. This is the only copy of that
     * information the view keeps; it does not recompute entries from a raw `Feed[]`, so
     * there is exactly one answer to "how many channels does this level have, and where
     * does each one join" and it comes from core.
     */
    private readonly channels: Channel[];
    /** loopRoot; needed to turn board-local path points into world positions. */
    private readonly root: Node;
    private readonly cy: number;
    /**
     * Board-local y of the HIGHEST feet on the track -- the zero of the depth ramp, so no
     * figure is ever pushed to a negative z and behind the band it stands on (BAND_Z).
     * `trackReach().top` adds a figure's height on top of the highest feet, which is exactly
     * what has to come back off.
     */
    private readonly feetTop: number;
    /**
     * Seconds a rotation takes, which is also the tick the controller steps the core on --
     * every animation in here is exactly one tick long so the drawing lands where the data
     * already is. NOT readonly: the speed button changes it (see `setTick`).
     */
    private tick: number;
    /** Path parameters where the band opens up: the boarding gap and each entry. */
    private gapTs: number[] = [];
    /** One row node per ring slot, positioned on the path centreline. */
    private clusters: Node[] = [];
    /** The GROUP_SIZE figures inside each ring row; `count` of them are shown. */
    private rowFigures: Node[][] = [];

    /** Head-of-channel waiting rows drawn beside the track, per feed side. */
    private laneClusters: Record<FeedSide, Node[]> = { far: [], near: [] };
    private laneFigures: Record<FeedSide, Node[][]> = { far: [], near: [] };
    private laneHome: Record<FeedSide, Vec3[]> = { far: [], near: [] };
    /** Each channel's floor, kept so `paintLaneFloor` can grey the one that is waiting. */
    private laneSlabs: Record<FeedSide, Node | null> = { far: null, near: null };
    private lastLen: Record<FeedSide, number> = { far: -1, near: -1 };

    private phaseHolder = { p: 0 };
    private phaseTween: Tween<{ p: number }> | null = null;

    /** Scratch for `point`/`normal`'s core-side sample; core's `Pt`, not a `Vec3`. */
    private readonly _pt = { x: 0, y: 0 };
    private readonly _nt = { x: 0, y: 0 };

    constructor(
        parent: Node, path: TrackPath, capacity: number, boardIndex: number,
        channels: Channel[], y: number, tick: number,
        /**
         * Visible half-width of the board, in board units -- what the camera actually
         * shows across at this screen's shape, NOT the LANE.edgeLimit bound. The lanes
         * are drawn out past it so they leave the screen rather than stopping short of
         * it; see `buildLanes`.
         */
        private edgeX: number,
    ) {
        this.path = path;
        this.capacity = capacity;
        this.boardIndex = boardIndex;
        this.channels = channels;
        this.root = parent;
        this.cy = y;
        this.feetTop = y + trackReach(path).top - PAX_HEIGHT;
        this.tick = tick;
        this.gapTs = [
            boardIndex / capacity,
            ...channels.map((c) => c.entry / capacity),
        ];
        this.buildBand(parent);
        this.buildClusters(parent);
        this.buildLanes(parent);
    }

    /** Board-local point at t: the core path, lifted to the track's y. */
    private point(t: number, out: Vec3 = new Vec3()): Vec3 {
        const p = this.path.pointAt(t, this._pt);
        out.set(p.x, this.cy + p.y, 0);
        return out;
    }

    /**
     * Depth for a row (or a lone figure) whose feet are at board-local `y`. See PAX_DEPTH:
     * lower on the board means nearer the camera, so the crowd occludes rather than
     * interpenetrates. Zero at the top of the track and positive everywhere else.
     */
    private depthAt(y: number): number {
        return (this.feetTop - y) * PAX_DEPTH;
    }

    /** Board-local outward normal at t: the core path's normal, unit length, in the x/y plane. */
    private normal(t: number, out: Vec3 = new Vec3()): Vec3 {
        const n = this.path.normalAt(t, this._nt);
        out.set(n.x, n.y, 0);
        return out;
    }

    /**
     * Stop the internal phase tween. MUST be called before the board (and this
     * view's cluster nodes) are destroyed on restart — the tween targets a plain
     * object, so it isn't auto-stopped by node destruction and would otherwise keep
     * calling repositionAll() on freed nodes.
     */
    destroy(): void {
        this.phaseTween?.stop();
        this.phaseTween = null;
        // The pooled entry rows are children of the board and die with it, but the
        // references would outlive them -- and `flierRow` hands back whatever it holds.
        // It re-checks isValid, so this is belt and braces; the cycle counters are not,
        // since a stale one would let a dead callback re-show a slot on the next level.
        for (const side of ['far', 'near'] as FeedSide[]) {
            const row = this.flierRows[side];
            if (row) Tween.stopAllByTarget(row);
            this.flierRows[side] = null;
            this.flierFigures[side] = [];
            this.flierCycleId[side]++;
            this.flierOwns[side] = null;
        }
    }

    /**
     * One white band along the rounded-rect path: a merged strip of boxes, each laid
     * across the direction of travel, with the samples inside a boarding or entry gap
     * skipped so the band opens up there. One draw call for the whole track.
     *
     * It replaces two thin curb rails, which drew the EDGES of a track whose middle was
     * whatever happened to be behind it — the reference art has a solid band the rows ride
     * on, and so does this now. Unlit, so it is exactly white.
     */
    private buildBand(parent: Node): void {
        const SAMPLES = 96;
        // The gap is an absolute arc length, not half a slot: as a fraction of the lap it
        // shrank with the ring, and at 20 slots the doorway was 0.37 long and stopped
        // reading as a doorway at all.
        const halfLap = GAP_ARC / 2 / this.path.perimeter;
        const parts: MeshPart[] = [];
        const p = new Vec3(), q = new Vec3();
        for (let i = 0; i < SAMPLES; i++) {
            const t = i / SAMPLES;
            // Skip the samples that fall inside a gap.
            if (this.gapTs.some((g) => Math.abs(((t - g + 1.5) % 1) - 0.5) < halfLap)) continue;
            this.point(t, p);
            this.point(t + 1 / SAMPLES, q);
            const dx = q.x - p.x, dy = q.y - p.y;
            const len = Math.hypot(dx, dy) || 1e-4;
            const box = primitives.box({ width: len * 1.2, height: BAND_HALF * 2, length: 0.06 });
            // rotate the box about +Z so its width follows the path direction
            const ang = Math.atan2(dy, dx), ca = Math.cos(ang), sa = Math.sin(ang);
            const pos = box.positions.slice();
            for (let v = 0; v < pos.length; v += 3) {
                const x = pos[v], y = pos[v + 1];
                pos[v] = p.x + x * ca - y * sa;
                pos[v + 1] = p.y + x * sa + y * ca;
            }
            parts.push({ positions: pos, normals: box.normals, uvs: box.uvs, indices: box.indices });
        }
        const mesh = mergeParts(parts);

        // Same mesh, offset down and behind, in translucent ink.
        const shadow = new Node('track-shadow');
        const smr = shadow.addComponent(MeshRenderer);
        smr.mesh = mesh;
        smr.material = alphaMaterial(BAND_SHADOW);
        smr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        shadow.setPosition(0, -BAND_DROP, BAND_Z - 0.06);
        parent.addChild(shadow);

        const n = new Node('track-band');
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = mesh;
        mr.material = flatMaterial(BAND);
        mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        // Fully behind the board plane, so the figures stand in front of it rather than
        // half-buried in it.
        n.setPosition(0, 0, BAND_Z);
        parent.addChild(n);
    }

    private buildClusters(parent: Node): void {
        for (let i = 0; i < this.capacity; i++) {
            const cluster = makeRow(`pax-row-${i}`);
            this.rowFigures.push(cluster.children.slice());
            const t = i / this.capacity;
            const p = this.point(t);
            cluster.setPosition(p.x, p.y, this.depthAt(p.y));
            cluster.active = false;
            parent.addChild(cluster);
            this.clusters.push(cluster);
        }
    }

    /**
     * The feeder channels: a floor slab and the head waiting slots, per feed.
     *
     * Position and heading both come from the ENTRY CELL's own path point and outward
     * normal, not from the shape's widest point — the two only coincide on a shape that
     * is symmetric top to bottom. The trapezoid's entry sits on a slanted edge, so its
     * channel leaves at 15 degrees and everything here follows that automatically.
     *
     * The WAITING SLOTS are bounded: `dockX + BAND_HALF + LANE_START +
     * (lookahead - 1) * LANE_STEP + LANE.margin` must stay inside the visible
     * half-width (LANE.edgeLimit, 4.67). validateTrack enforces exactly that, against
     * the same constants (LANE.margin included, not a restated literal), so a level
     * that gets here already fits.
     *
     * The SLAB is not, and deliberately: it runs from the ring out PAST the edge of the
     * screen. The shipped levels' slots stop 0.31 to 1.6 units short of the frame, which
     * drew each channel as a rounded white tray floating with a gap beside it -- the queue
     * looked like it ended there. A lane that leaves the screen reads as a queue that
     * continues off it, which is the truth: level 1 has 744 more passengers to come.
     *
     * THE ROWS GO WITH IT. The queue continues out along the lane at the same pitch until
     * a row's centre is past the frame edge, so the last one is cut off by the screen
     * rather than by an arbitrary count -- which is what a queue arriving from off screen
     * looks like. The colours are the real ones: `Channel.queue` already holds the whole
     * remaining list for that channel, and `updateLanes` walks whatever rows exist, so
     * this needs nothing from core.
     *
     * What it costs, and it is worth knowing rather than discovering: `lookahead` is a
     * PURE DISPLAY LIMIT -- core never reads it, `step()` shifts the queue regardless --
     * so it was the whole of the difficulty knob, and drawing to the edge maxes that knob
     * out on every level. The shipped levels go from 5 rows to 7 (level 1) and from 3 to 9
     * (level 10), and their authored 3/4/5 lookaheads stop being visible as a difference.
     * If the ramp is wanted back, the honest lever is to keep drawing the crowd but stop
     * committing its colours past `lookahead` -- desaturate those rows -- rather than to
     * shorten the lane again.
     */
    private buildLanes(parent: Node): void {
        for (const channel of this.channels) {
            const t = channel.entry / this.capacity;
            const dock = this.point(t);
            const out = this.normal(t);
            // Across the lane: the rows stand perpendicular to the way the lane runs.
            const across = new Vec3(-out.y, out.x, 0);
            const first = new Vec3(
                dock.x + out.x * (BAND_HALF + LANE_START),
                dock.y + out.y * (BAND_HALF + LANE_START),
                0,
            );
            const span = LANE_STEP * (channel.lookahead - 1);
            // Where the slab starts and ends, as distances along `out` from `first` (the
            // innermost waiting slot). The inner end keeps its margin; the outer end is
            // whichever is further, the slots' own margin or far enough out to be off
            // screen. `OFF_SCREEN` covers the band's half-width and the slab's corner
            // radius, so the rounded end is over the edge rather than just touching it.
            const OFF_SCREEN = BAND_HALF + LANE_SLAB_R;
            const inner = -LANE.margin;
            let outer = span + LANE.margin;
            // Distance along `out` at which the lane's centreline crosses the frame edge.
            // Guarded: a channel leaving straight up or down would never cross it, and a
            // side channel always does (its `out` is within 15 degrees of horizontal on
            // every shipped shape).
            if (Math.abs(out.x) > 1e-3) {
                const toEdge = (Math.sign(out.x) * this.edgeX - first.x) / out.x;
                outer = Math.max(outer, toEdge + OFF_SCREEN);
            }
            const slabW = outer - inner;
            // Turned to follow the lane, so a tilted channel's slab tilts with it rather
            // than sticking out square.
            const mid = new Vec3(
                first.x + out.x * (inner + outer) / 2,
                first.y + out.y * (inner + outer) / 2,
                0,
            );
            const angle = Math.atan2(out.y, out.x) * 180 / Math.PI;

            const shadow = makeShadowSlab(
                `lane-shadow-${channel.side}`, slabW, BAND_HALF * 2, LANE_SLAB_R, 34,
            );
            shadow.setPosition(mid.x, mid.y - BAND_DROP, BAND_Z - 0.06);
            shadow.setRotationFromEuler(0, 0, angle);
            parent.addChild(shadow);

            // Same white as the ring and as deep, so a channel reads as the track running
            // off to the side.
            const slab = makeSlab(
                `lane-${channel.side}`, slabW, BAND_HALF * 2, 0.06, BAND, LANE_SLAB_R,
            );
            slab.setPosition(mid.x, mid.y, BAND_Z);
            slab.setRotationFromEuler(0, 0, angle);
            parent.addChild(slab);
            this.laneSlabs[channel.side] = slab;

            this.laneClusters[channel.side] = [];
            this.laneFigures[channel.side] = [];
            this.laneHome[channel.side] = [];
            // As many rows as the lane can carry before it leaves the screen, never fewer
            // than the level asked for. `+ 2` so the run does not stop just short: one row
            // straddling the edge and one fully past it, which is what makes the queue read
            // as continuing rather than as ending in a neat last group.
            let rows = channel.lookahead;
            if (Math.abs(out.x) > 1e-3) {
                const atEdge = (Math.sign(out.x) * this.edgeX - first.x) / out.x / LANE_STEP;
                rows = Math.max(rows, Math.floor(atEdge) + 2);
            }
            for (let i = 0; i < rows; i++) {
                const n = makeRow(`wait-${channel.side}-${i}`);
                const figures = n.children.slice();
                // Fixed, unlike the ring's rows: a lane never turns, so its rows are laid
                // out once, across the lane's own direction.
                layoutRow(figures, across.x, across.y, LANE_RANK_STEP);
                // Face the track: INWARD along the lane, which is -out, held back toward the
                // camera by (1 - FACE_TURN/90) so the face stays visible. Overwrites the
                // along-path facing `layoutRow` just set -- a lane never turns, so this is
                // done once at build time rather than every frame.
                //
                // Per figure rather than on the row node, whose children carry the
                // across-the-lane offsets: rotating the parent would swing those round too.
                // About Z, the board's NORMAL -- a figure stands along it, so this spins it on
                // the spot; about Y it would tip over.
                //
                // The sign is no longer chosen, which retires a long-standing worry attached
                // to this line: it was `out.x > 0 ? -FACE_TURN : FACE_TURN`, justified by
                // having been eyeballed on screen, under a frame that then moved three times.
                // `faceYaw` computes it from the direction, so there is nothing left to get
                // backwards. See its note.
                const yaw = faceYaw(-out.x, -out.y) * (FACE_TURN / 90);
                for (const figure of figures) figure.setRotationFromEuler(0, 0, yaw);
                this.laneFigures[channel.side].push(figures);
                const ly = first.y + out.y * LANE_STEP * i;
                n.setPosition(first.x + out.x * LANE_STEP * i, ly, this.depthAt(ly));
                n.active = false;
                parent.addChild(n);
                this.laneClusters[channel.side].push(n);
                this.laneHome[channel.side].push(n.position.clone());
            }
        }
    }

    /** Reflects ring contents (color/visibility) and advances the flow phase one step. */
    /**
     * Retime every animation in here, for the speed button.
     *
     * Takes effect on the NEXT tick rather than reaching into the tweens already running.
     * A rotation cut short mid-flight would snap the ring forward, and one stretched would
     * still be moving when the core had already stepped past it -- and the whole reason
     * every duration here equals the tick is that the drawing must land where the data is.
     * One tick of the old timing after the tap is invisible; a snap is not.
     */
    setTick(tick: number): void {
        this.tick = tick;
    }

    /**
     * Reflect the ring's contents and start the tick's rotation.
     *
     * `rotated` says whether core stepped the loop since the last call -- true for a tick,
     * false for the initial paint, which shows a ring nobody has rotated yet. It only moves
     * `ringOffset`; getting it wrong would cost the saving described there, not correctness.
     */
    update(ring: (PaxGroup | null)[], channels: Channel[], rotated = true): void {
        if (rotated) this.ringOffset = (this.ringOffset + 1) % this.capacity;
        for (let c = 0; c < this.clusters.length; c++) {
            const group = ring[this.slotOf(c)];
            const cluster = this.clusters[c];
            if (!group) {
                cluster.active = false;
                this.shownColor[c] = null;
                continue;
            }
            cluster.active = true;
            // The whole point of `ringOffset`: with the cluster following its own group this
            // is false for all but the one or two cells core actually changed this tick.
            if (this.shownColor[c] === group.color && this.shownCount[c] === group.count) {
                continue;
            }
            this.shownColor[c] = group.color;
            this.shownCount[c] = group.count;
            paintRow(this.rowFigures[c], colorOf(group.color), group.count, NO_SHADE);
        }

        // Absolute, never relative. The resting phase is 0 by definition, so each tick
        // starts exactly one slot back and tweens to exactly 0. The previous form
        // (`p -= 1/capacity; target = p + 1/capacity`) inherited whatever the stopped
        // tween had not yet delivered, and that shortfall accumulated every tick —
        // dragging the whole ring backwards until the passenger the core boards was
        // drawn short of the boarding gap, toward the right side, while the fly still
        // departed from the gap. Resetting absolutely discards the shortfall instead.
        this.phaseTween?.stop();
        this.phaseHolder.p = -1 / this.capacity;
        this.phaseTween = tween(this.phaseHolder)
            .to(this.tick, { p: 0 }, {
                onUpdate: () => this.repositionAll(),
            })
            .start();

        this.updateLanes(ring, channels);
    }

    /**
     * Draw the head of each channel. The channel that is not feeding yet has a GREY FLOOR
     * (see BAND_IDLE), so "this one feeds next" is readable without a tutorial while every
     * waiting passenger still shows its true colour. How MANY are drawn is `buildLanes`'
     * business -- as many as fit before the lane leaves the screen -- and this walks
     * whatever rows it made, switching off the tail once the queue is shorter than the
     * lane is long. That is also what makes the end of a level look right: the crowd
     * thins from the back as the queue runs out.
     */
    private updateLanes(ring: (PaxGroup | null)[], channels: Channel[]): void {
        // The live channel is the first one still holding rows: drain order, not screen
        // order.
        const live = channels.find((c) => c.queue.length > 0);
        for (const channel of channels) {
            const active = channel === live;
            this.paintLaneFloor(channel.side, active);
            const nodes = this.laneClusters[channel.side];
            for (let i = 0; i < nodes.length; i++) {
                const group = channel.queue[i];
                const n = nodes[i];
                if (!group) { n.active = false; continue; }
                n.active = true;
                paintRow(this.laneFigures[channel.side][i], colorOf(group.color), group.count,
                    NO_SHADE);
            }
        }
        // Which channel actually lost its head this tick? NOT necessarily the live one:
        // the tick that empties a channel flips `live` to the next, so keying off the
        // live side would miss that entrant — and its lane slide — exactly once per
        // level, at the hand-over. Compare each channel against its own last length.
        let dropped: Channel | null = null;
        for (const channel of channels) {
            const prev = this.lastLen[channel.side];
            if (prev >= 0 && channel.queue.length < prev) { dropped = channel; break; }
        }
        this.animateLaneShift(dropped ?? live ?? channels[0], channels);
        if (dropped) {
            const group = ring[dropped.entry];
            if (group) this.playEntry(dropped, group);
        }
    }

    /**
     * White floor for the channel that is feeding, grey for the one that is waiting. Reads
     * the material back off the node rather than tracking the last colour: `flatMaterial`
     * hands out one shared material per colour, so this is two objects being swapped, not a
     * material built per call.
     */
    private paintLaneFloor(side: FeedSide, active: boolean): void {
        const slab = this.laneSlabs[side];
        if (!slab || !slab.isValid) return;
        const mr = slab.getComponent(MeshRenderer);
        if (mr) mr.material = flatMaterial(active ? BAND : BAND_IDLE);
    }

    /**
     * When the active channel loses its head, slide the whole lane one step toward the
     * entrance: the colours are already the post-shift ones, so start the nodes one
     * step out and tween them back to their resting slot. Purely cosmetic -- no core
     * state involved. Homes come from `laneHome`, never from the node's current
     * position, which may be mid-tween from the previous tick.
     */
    private animateLaneShift(active: Channel, channels: Channel[]): void {
        const prev = this.lastLen[active.side];
        for (const c of channels) this.lastLen[c.side] = c.queue.length;
        if (prev < 0 || active.queue.length >= prev) return;
        // Slide along the lane's own direction, so a tilted channel slides along itself.
        const t = active.entry / this.capacity;
        const out = this.normal(t);
        const nodes = this.laneClusters[active.side];
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!n.isValid || !n.active) continue;
            const home = this.laneHome[active.side][i];
            Tween.stopAllByTarget(n);          // a tick can land before the last slide ends
            // Depth from the SLID y, not `home.z`: a tilted channel slides partly up the
            // board, and a row whose y moved has to take the depth that goes with it.
            const sy = home.y + out.y * LANE_STEP;
            n.setPosition(home.x + out.x * LANE_STEP, sy, this.depthAt(sy));
            tween(n).to(this.tick, { position: home.clone() }).start();
        }
    }

    /** Ring slot that cluster `c` currently draws. */
    private slotOf(c: number): number {
        return (c + this.ringOffset) % this.capacity;
    }

    /** The cluster drawing ring slot `slot` -- the inverse of `slotOf`. */
    private clusterOf(slot: number): number {
        return (slot - this.ringOffset + this.capacity) % this.capacity;
    }

    private repositionAll(): void {
        const phase = this.phaseHolder.p % 1;
        for (let i = 0; i < this.clusters.length; i++) {
            const cluster = this.clusters[i];
            // Guard against a tween tick landing after the board was destroyed on restart.
            if (!cluster || !cluster.isValid) continue;
            const t = (this.slotOf(i) / this.capacity + phase) % 1;
            const p = this.point(t, REPOSITION_SCRATCH);
            cluster.setPosition(p.x, p.y, this.depthAt(p.y));
            // The row runs across the track, so its spread turns with the path. Rows
            // that are hidden this tick are skipped — nothing to lay out, and it keeps
            // the per-frame cost at the rows actually on screen.
            if (!cluster.active) continue;
            const n = this.normal(t, NORMAL_SCRATCH);
            const figures = this.rowFigures[i];
            layoutRow(figures, n.x, n.y, BLOCK.rankStep);
        }
    }

    /**
     * A throwaway passenger figure, the same one the track itself draws, parented to the
     * track root. Boarding used to fly a single sphere while the track drew a four-ball
     * clump, so it read as one thing vanishing and a different thing appearing; flying
     * the real figure is what fixed that. Caller positions it, tweens it, destroys it.
     */
    spawnPassenger(color: string): Node {
        const n = makePassenger('pax-fly', colorOf(color));
        this.root.addChild(n);
        return n;
    }

    /**
     * Where figure `i` of the block at the boarding gap stands, in world space. A boarding
     * flight has to start from a spot a figure actually occupied, not from the cell's
     * centre — with four abreast in two ranks, a flight from the middle reads as the wrong
     * passenger lifting off.
     */
    boardingFigureWorldPos(i: number): Vec3 {
        const t = this.boardIndex / this.capacity;
        const local = this.point(t, new Vec3());
        const n = this.normal(t);
        // Same block layout the drawn figures use, so a flight leaves the spot one of them
        // was standing on rather than a point on the centreline -- unless the group is drawn
        // as one dot (ROW_AS_DOT), in which case the centreline IS where it stood.
        const o = ROW_AS_DOT
            ? OFFSET_SCRATCH_ZERO
            : blockOffset(i % GROUP_SIZE, RANKS, BLOCK.rankStep, OFFSET_SCRATCH);
        const fy = local.y + o.across * n.y - o.along * n.x;
        // Its depth too, or the flight starts at z = 0 while the figure it replaces was
        // several units nearer -- which reads as the passenger jumping backwards on takeoff.
        local.set(local.x + o.across * n.x + o.along * n.y, fy, this.depthAt(fy));
        const out = new Vec3();
        Vec3.transformMat4(out, local, this.root.worldMatrix);
        return out;
    }

    /**
     * Walk the channel's head into the track through its entrance gap: the real ring
     * slot is hidden for this tick while a temporary cluster tweens from the lane head
     * to the slot's resting spot, so "the hole came round to the entrance and the next
     * passenger stepped in" is legible instead of a colour appearing from nowhere.
     * The flier's tween duration must match the phase tween's: only if they finish at
     * the same moment will the real slot render at the same position where the flier
     * lands; unequal durations cause a visible backwards jump at hand-off.
     */
    private playEntry(channel: Channel, group: PaxGroup): void {
        const { side, entry: index } = channel;
        // `entry` is a RING slot; the node drawing it is found through the offset.
        const at = this.clusterOf(index);
        const slot = this.clusters[at];
        const from = this.laneHome[side][0];
        if (!slot || !slot.isValid || !from) return;

        // The flier's tween and the tick are both exactly `this.tick` long, and
        // `tickAcc`'s leftover usually fires the next tick a frame before this one
        // lands -- so a second hole can reach this entrance while the previous
        // flier is still in flight. Take it over rather than replace it: the row is
        // POOLED (see `flierRow`), so there is one node per side and the newer cycle
        // simply stops the tween on it and starts its own. `flierCycleId` is what tells
        // the two apart now that node identity cannot -- see the callback below.
        const flier = this.flierRow(side);
        Tween.stopAllByTarget(flier);
        const cycle = ++this.flierCycleId[side];
        const owned = this.flierOwns[side];
        if (owned !== null && owned !== at) {
            // The cycle we are interrupting had hidden a DIFFERENT slot. Put it back,
            // or it stays invisible for the rest of the level.
            const prev = this.clusters[owned];
            if (prev && prev.isValid) prev.active = true;
        }
        this.flierOwns[side] = at;

        slot.active = false;
        // A whole row walks in, laid out the way it will rest once it joins the track,
        // so the hand-off to the real row at the end is invisible.
        const figures = this.flierFigures[side];
        const entryT = index / this.capacity;
        const n = this.normal(entryT);
        layoutRow(figures, n.x, n.y, BLOCK.rankStep);
        paintRow(figures, colorOf(group.color), group.count, NO_SHADE);
        flier.setPosition(from);
        flier.active = true;
        // The resting spot AND its depth: the flier hands over to the real row at the end,
        // and a hand-off between two different depths shows as a pop in who occludes whom.
        const rest = this.point(index / this.capacity);
        rest.z = this.depthAt(rest.y);
        tween(flier)
            .to(this.tick, { position: rest })
            .call(() => {
                // Only hand `slot` back if this cycle is still the current one: a newer
                // playEntry may have taken the pooled row over (see above), and that
                // cycle owns the slot -- and the row -- now.
                if (this.flierCycleId[side] !== cycle) return;
                this.flierOwns[side] = null;
                if (slot.isValid) slot.active = true;
                if (flier.isValid) flier.active = false;
            })
            .start();
    }

    /**
     * The pooled walking-in row for one side, built on first use.
     *
     * It used to be a fresh `makeRow` every tick, destroyed when it landed: four Nodes and
     * four MeshRenderers created and torn down per tick per feeding channel. A MeshRenderer
     * is not a cheap object -- it brings up a scene Model, a sub-model and its descriptor
     * sets -- and the cost lands in one lump inside a single frame, which is the shape of a
     * stutter rather than a lower average.
     *
     * That is also why DOUBLE SPEED felt worse than half the frame rate would explain: the
     * per-frame work is unchanged by the speed button, but this ran once per TICK, so 2x
     * doubled it. Measured on device: 40fps at 1x, 30fps at 2x, on a filled ring.
     *
     * Two rows for the whole level now, hidden between entries. `playBoarding` in
     * GameController still spawns its fliers per boarding and could get the same treatment;
     * it is left alone because boarding needs a matching car at the gap, so unlike this it
     * does not fire every tick.
     */
    private flierRow(side: FeedSide): Node {
        let row = this.flierRows[side];
        if (row && row.isValid) return row;
        row = makeRow(`pax-enter-${side}`);
        row.active = false;
        this.root.addChild(row);
        this.flierRows[side] = row;
        this.flierFigures[side] = row.children.slice();
        return row;
    }
}
