import { Node, Color, Vec3, MeshRenderer, primitives, tween, Tween } from 'cc';
import { colorOf } from './colors';
import { flatMaterial, alphaMaterial } from './materials';
import { makeSlab, makeShadowSlab, mergeParts, MeshPart } from './slabs';
import { buildPaxFigure, recolorPaxFigure, setArmSwing } from './pax-figure';
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
 * How far a waiting figure turns, in degrees, from facing straight along the lane
 * toward facing the track. Measured against the running game (see `buildLanes`):
 * the geometrically "full" turn is 90, but at 90 the figure is in pure profile, its
 * face isn't visible, and the two channels' profiles are nearly indistinguishable at
 * this zoom. 45 keeps the face visible while the body still reads as angled toward
 * the track.
 */
const FACE_TURN = 45;

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
const PAX_HEIGHT = 0.55;

/**
 * Ring-figure arm swing, driven by the ring's own phase (`repositionAll`) rather than
 * a separate accumulator, so it advances with the ring's motion and stops when the
 * ring stops. `phaseHolder.p` sweeps a narrow range every tick (from -1/capacity up to
 * 0, see `update()`), so SWING_PHASE_SCALE blows that back up into a useful sweep of
 * the sine argument. SWING_STAGGER offsets each figure by its own mixed row/seat
 * index so a whole ring doesn't swing in lockstep like a marching toy.
 */
const SWING_AMPLITUDE_DEG = 22;
const SWING_PHASE_SCALE = 40;
const SWING_STAGGER = 0.7;

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
 * Lay a cell's figures out around its origin, given the unit ACROSS direction (dx, dy) and
 * the along-path step between its ranks. The along-path direction is (dy, -dx): for the
 * ring that is the way the cells travel (the outward normal of a clockwise walk is the
 * tangent turned a quarter left), and for a channel, whose across is the lane turned a
 * quarter, it is the outward direction -- so the rearmost rank of a waiting block is the
 * one further from the track, which is what a queue looks like.
 *
 * Called every frame for ring cells, because their across direction is the path normal and
 * turns as they travel; once at build time for the lanes, whose direction is fixed.
 */
function layoutRow(figures: Node[], dx: number, dy: number, rankStep: number): void {
    const ax = dy, ay = -dx;
    for (let i = 0; i < figures.length; i++) {
        const o = blockOffset(i, RANKS, rankStep, OFFSET_SCRATCH);
        figures[i].setPosition(o.across * dx + o.along * ax, o.across * dy + o.along * ay, 0);
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
 * A row node holding GROUP_SIZE passenger figures as children. The row's own transform
 * is the group's position on the track; the children carry the across-the-track offsets,
 * which `layoutRow` sets. The row is never rotated — the figures stand along the board's
 * +Y and face +Z, and spinning the row about the board normal would tip them over.
 */
function makeRow(name: string): Node {
    const row = new Node(name);
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

    /** The in-flight entry flier for each side, if any (see `playEntry`). */
    private pendingFlier: Record<FeedSide, Node | null> = { far: null, near: null };

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
            cluster.setPosition(p.x, p.y, 0);
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
                // Face the track, not the camera: yaw is per figure (not on the row node,
                // whose children carry the across-the-lane offsets `layoutRow` just set,
                // and rotating the parent would swing those out of the board plane) and
                // about Y only (about Z would tip them over, per makeRow's docstring).
                //
                // Base orientation is camera-facing: a figure with no yaw of its own —
                // like every ring figure — faces +Z, out of the board toward the
                // camera (pax-figure.ts derives this from the geometry it places, not
                // from an authored convention). This yaw turns a figure away from that
                // base, toward the track, following the standard convention
                // +Z = (sin(yaw), 0, cos(yaw)); facing inward means the yaw's sign is
                // opposite to `out.x`'s, which is what the expression below does. The
                // magnitude is FACE_TURN (45), not a full 90, because 90 puts the
                // figure in pure profile — with no face on the new figure either, that
                // still means the shoulders/arms, and the two channels' silhouettes
                // are nearly indistinguishable at this zoom.
                //
                // This sign was previously justified by comparing a lane figure against
                // a ring figure "known" to face the camera — but under the old GLB
                // model that ring figure did NOT face the camera; every ring passenger
                // was in profile for the whole project (see git history on this file
                // predating pax-figure.ts). That the sign below still came out right
                // was luck, not a validated derivation. If this ever needs to change,
                // measure it again on screen — do not re-derive it on paper; multiple
                // paper derivations before this one were wrong.
                const yaw = out.x > 0 ? -FACE_TURN : FACE_TURN;
                for (const figure of figures) figure.setRotationFromEuler(0, yaw, 0);
                this.laneFigures[channel.side].push(figures);
                n.setPosition(first.x + out.x * LANE_STEP * i, first.y + out.y * LANE_STEP * i, 0);
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

    update(ring: (PaxGroup | null)[], channels: Channel[]): void {
        for (let i = 0; i < this.clusters.length; i++) {
            const group = ring[i];
            const cluster = this.clusters[i];
            if (group) {
                cluster.active = true;
                paintRow(this.rowFigures[i], colorOf(group.color), group.count, NO_SHADE);
            } else {
                cluster.active = false;
            }
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
            n.setPosition(home.x + out.x * LANE_STEP, home.y + out.y * LANE_STEP, home.z);
            tween(n).to(this.tick, { position: home.clone() }).start();
        }
    }

    private repositionAll(): void {
        const phase = this.phaseHolder.p % 1;
        for (let i = 0; i < this.clusters.length; i++) {
            const cluster = this.clusters[i];
            // Guard against a tween tick landing after the board was destroyed on restart.
            if (!cluster || !cluster.isValid) continue;
            const t = (i / this.capacity + phase) % 1;
            const p = this.point(t, REPOSITION_SCRATCH);
            cluster.setPosition(p.x, p.y, 0);
            // The row runs across the track, so its spread turns with the path. Rows
            // that are hidden this tick are skipped — nothing to lay out, and it keeps
            // the per-frame cost at the rows actually on screen.
            if (!cluster.active) continue;
            const n = this.normal(t, NORMAL_SCRATCH);
            const figures = this.rowFigures[i];
            layoutRow(figures, n.x, n.y, BLOCK.rankStep);
            // The ring is moving and the channels are not — that contrast is what
            // tells a player which one is which — so only ring figures swing, driven
            // by the same phase that already moves them, and only the ones actually
            // shown this tick (paintRow toggles `active` per seat).
            for (let j = 0; j < figures.length; j++) {
                if (!figures[j].active) continue;
                const mixed = i * GROUP_SIZE + j;
                const swing = Math.sin(phase * SWING_PHASE_SCALE + mixed * SWING_STAGGER) * SWING_AMPLITUDE_DEG;
                setArmSwing(figures[j], swing);
            }
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
        // was standing on rather than a point on the centreline.
        const o = blockOffset(i % GROUP_SIZE, RANKS, BLOCK.rankStep, OFFSET_SCRATCH);
        local.set(
            local.x + o.across * n.x + o.along * n.y,
            local.y + o.across * n.y - o.along * n.x,
            0,
        );
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
        const slot = this.clusters[index];
        const from = this.laneHome[side][0];
        if (!slot || !slot.isValid || !from) return;

        // The flier's tween and the tick are both exactly `this.tick` long, and
        // `tickAcc`'s leftover usually fires the next tick a frame before this one
        // lands -- so a second hole can reach this entrance while the previous
        // flier is still in flight. Stop and drop it now so its completion callback
        // (below) can't re-show `slot` after this cycle has already hidden it again.
        const stale = this.pendingFlier[side];
        if (stale) {
            Tween.stopAllByTarget(stale);
            if (stale.isValid) stale.destroy();
            this.pendingFlier[side] = null;
        }

        slot.active = false;
        // A whole row walks in, laid out the way it will rest once it joins the track,
        // so the hand-off to the real row at the end is invisible.
        const flier = makeRow('pax-enter');
        const figures = flier.children.slice();
        const entryT = index / this.capacity;
        const n = this.normal(entryT);
        layoutRow(figures, n.x, n.y, BLOCK.rankStep);
        paintRow(figures, colorOf(group.color), group.count, NO_SHADE);
        flier.setPosition(from);
        this.root.addChild(flier);
        this.pendingFlier[side] = flier;
        tween(flier)
            .to(this.tick, { position: this.point(index / this.capacity) })
            .call(() => {
                // Only re-activate the slot if this flier is still the pending one
                // for this side -- if not, a newer playEntry already stopped and
                // destroyed it (see above), and that newer cycle owns `slot` now.
                if (this.pendingFlier[side] === flier) {
                    this.pendingFlier[side] = null;
                    if (slot.isValid) slot.active = true;
                }
                if (flier.isValid) flier.destroy();
            })
            .start();
    }
}
