import { Node, Color, Vec3, Mesh, MeshRenderer, primitives, tween, Tween } from 'cc';
import { colorOf } from './colors';
import { litMaterial, flatMaterial, alphaMaterial } from './materials';
import { makeSlab, makeShadowSlab, mergeParts, MeshPart } from './slabs';
import { buildPassenger, recolorPassenger } from './passenger-builder';
import { Channel, FeedSide, GAP_ARC, GROUP_SIZE, LANE, PaxGroup, TrackPath } from '../core/index';

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

/** Balls per passenger cluster and their layout offsets (small clump). */
const BALL_OFFSETS: [number, number][] = [
    [0, 0.06],
    [-0.09, -0.05],
    [0.09, -0.05],
    [0, -0.13],
];
const BALL_RADIUS = 0.12;

/**
 * One merged mesh for a whole passenger cluster (all four balls baked in at their
 * offsets), built once and shared by every cluster node. Collapses 4 draw calls per
 * cluster to 1 — the balls never move relative to each other, so merging is safe.
 */
let CLUSTER_MESH: Mesh | null = null;
function clusterMesh(): Mesh {
    if (CLUSTER_MESH) return CLUSTER_MESH;
    const parts = BALL_OFFSETS.map(([ox, oy]) => {
        const g = primitives.sphere(BALL_RADIUS, { segments: 8 });
        const positions = g.positions.slice();
        for (let v = 0; v < positions.length; v += 3) {
            positions[v] += ox;
            positions[v + 1] += oy;
        }
        return { positions, normals: g.normals, uvs: g.uvs, indices: g.indices };
    });
    CLUSTER_MESH = mergeParts(parts);
    return CLUSTER_MESH;
}

/**
 * Height of a passenger figure on the board. Calibrated against LANE_STEP (0.45):
 * the model is roughly 0.45 as wide as it is tall, so this keeps waiting passengers
 * clear of each other while reading larger than the ball clump it replaced.
 */
const PAX_HEIGHT = 0.55;

/** Identity shade — the active/undimmed case for `paintPassenger`. */
const NO_SHADE = (c: Color): Color => c;

/**
 * Spacing between the figures of one row. A row holds GROUP_SIZE passengers laid out
 * ACROSS its direction of travel, so this is measured along the path normal (or along
 * the board's y for the lanes, which feed inward along x).
 */
const ROW_STEP = 0.26;

/**
 * Lay a row's figures along the unit direction (dx, dy), centred on the row's origin.
 * Called every frame for ring rows, because the direction is the path normal and turns
 * as the row travels; once at build time for the lanes, whose feed direction is fixed.
 */
function layoutRow(figures: Node[], dx: number, dy: number): void {
    const mid = (figures.length - 1) / 2;
    for (let i = 0; i < figures.length; i++) {
        const off = (i - mid) * ROW_STEP;
        figures[i].setPosition(off * dx, off * dy, 0);
    }
}

/**
 * One passenger node: the real 3D figure when the model loaded, else the original
 * four-ball clump. Both forms answer the same contract — a root node whose own
 * transform is free for the caller to set and tween — so every position, tween and
 * `active` toggle in this file is identical either way.
 */
function makePassenger(name: string, color: Color): Node {
    const model = buildPassenger(name, color, PAX_HEIGHT);
    if (model) return model;
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    mr.mesh = clusterMesh();
    mr.material = litMaterial(color);
    return n;
}

/**
 * Recolor a node from `makePassenger`, whichever form it took. The ball clump wears
 * its color on its own renderer; the model carries it on the `paint` role only, and
 * keeps skin/eyes/shoes as authored.
 */
function paintPassenger(node: Node, color: Color, shade: (c: Color) => Color): void {
    const own = node.getComponent(MeshRenderer);
    if (own) { own.material = litMaterial(shade(color)); return; }
    recolorPassenger(node, color, shade);
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

/** Desaturated/darkened tint for the channel that is not feeding yet. */
function dim(c: Color): Color {
    return new Color(
        Math.round(c.r * 0.35 + 120 * 0.65),
        Math.round(c.g * 0.35 + 120 * 0.65),
        Math.round(c.b * 0.35 + 120 * 0.65),
        255,
    );
}

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
    private readonly tick: number;
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
     * The outward reach is bounded: `dockX + BAND_HALF + LANE_START +
     * (lookahead - 1) * LANE_STEP + LANE.margin` must stay inside the visible
     * half-width (LANE.edgeLimit, 4.67). validateTrack enforces exactly that, against
     * the same constants (LANE.margin included, not a restated literal), so a level
     * that gets here already fits.
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
            const slabW = span + LANE.margin * 2;
            // Floor centred on the slots it carries, and turned to follow the lane so a
            // tilted channel's slab tilts with it rather than sticking out square.
            const mid = new Vec3(first.x + out.x * span / 2, first.y + out.y * span / 2, 0);
            const angle = Math.atan2(out.y, out.x) * 180 / Math.PI;

            const shadow = makeShadowSlab(`lane-shadow-${channel.side}`, slabW, BAND_HALF * 2, 0.2, 34);
            shadow.setPosition(mid.x, mid.y - BAND_DROP, BAND_Z - 0.06);
            shadow.setRotationFromEuler(0, 0, angle);
            parent.addChild(shadow);

            // Same white as the ring and as deep, so a channel reads as the track running
            // off to the side.
            const slab = makeSlab(`lane-${channel.side}`, slabW, BAND_HALF * 2, 0.06, BAND, 0.2);
            slab.setPosition(mid.x, mid.y, BAND_Z);
            slab.setRotationFromEuler(0, 0, angle);
            parent.addChild(slab);

            this.laneClusters[channel.side] = [];
            this.laneFigures[channel.side] = [];
            this.laneHome[channel.side] = [];
            for (let i = 0; i < channel.lookahead; i++) {
                const n = makeRow(`wait-${channel.side}-${i}`);
                const figures = n.children.slice();
                // Fixed, unlike the ring's rows: a lane never turns, so its rows are laid
                // out once, across the lane's own direction.
                layoutRow(figures, across.x, across.y);
                // Face the track, not the camera: yaw is per figure (not on the row node,
                // whose children carry the across-the-lane offsets `layoutRow` just set,
                // and rotating the parent would swing those out of the board plane) and
                // about Y only (about Z would tip them over, per makeRow's docstring).
                //
                // Base orientation is camera-facing: with `fit`'s rotation fixed
                // (passenger-builder.ts), a figure with no yaw of its own — like every
                // ring figure — faces +Z, out of the board toward the camera. This yaw
                // turns a figure away from that base, toward the track, following the
                // standard convention +Z = (sin(yaw), 0, cos(yaw)); facing inward means
                // the yaw's sign is opposite to `out.x`'s, which is what the expression
                // below does. The magnitude is FACE_TURN (45), not a full 90, because 90
                // puts the figure in pure profile — its face isn't visible, and the two
                // channels' profiles are nearly indistinguishable at this zoom.
                //
                // This sign was previously justified by comparing a lane figure against
                // a ring figure "known" to face the camera — but the ring figure did NOT
                // face the camera at the time (see passenger-builder.ts); every ring
                // passenger was in profile for the whole project. That the sign below
                // still came out right was luck, not a validated derivation. If this
                // ever needs to change, measure it again on screen — do not re-derive it
                // on paper; multiple paper derivations before this one were wrong.
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
     * Draw the head of each channel. The inactive channels (every one but the channel
     * still holding rows) are dimmed, so "this one feeds next" is readable without a
     * tutorial. Only the head `channel.lookahead` are drawn; the rest are implied.
     */
    private updateLanes(ring: (PaxGroup | null)[], channels: Channel[]): void {
        // The live channel is the first one still holding rows: drain order, not screen
        // order. The rest are dimmed, so "this one feeds next" reads without a tutorial.
        const live = channels.find((c) => c.queue.length > 0);
        for (const channel of channels) {
            const active = channel === live;
            const nodes = this.laneClusters[channel.side];
            for (let i = 0; i < nodes.length; i++) {
                const group = channel.queue[i];
                const n = nodes[i];
                if (!group) { n.active = false; continue; }
                n.active = true;
                paintRow(this.laneFigures[channel.side][i], colorOf(group.color), group.count,
                    active ? NO_SHADE : dim);
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
            layoutRow(this.rowFigures[i], n.x, n.y);
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
     * Where the `i`th of `count` figures stands within the row at the boarding gap, in
     * world space. The boarding flight has to start from the figure that actually left,
     * not from the row's centre — with four abreast, a flight from the middle reads as
     * the wrong passenger lifting off.
     */
    boardingFigureWorldPos(i: number, count: number): Vec3 {
        const t = this.boardIndex / this.capacity;
        const local = this.point(t, new Vec3());
        const n = this.normal(t);
        const off = (i - (count - 1) / 2) * ROW_STEP;
        local.set(local.x + off * n.x, local.y + off * n.y, 0);
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
        layoutRow(figures, n.x, n.y);
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
