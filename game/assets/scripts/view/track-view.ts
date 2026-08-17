import { Node, Color, Vec3, Mesh, MeshRenderer, utils, primitives, tween, Tween } from 'cc';
import { colorOf } from './colors';
import { litMaterial } from './materials';
import { makeLitBox } from './placeholder';
import { buildPassenger, recolorPassenger } from './passenger-builder';
import { GROUP_SIZE, PaxGroup } from '../core/index';

const W = 2.6;   // half width of the circuit centerline
const H = 1.3;   // half height
const R = 0.8;   // corner radius

/** Half-offset of the two curb rails from the path centerline. */
const CURB_OFFSET = 0.35;

/** Waiting passengers drawn per channel; the rest of the queue is implied. */
const LANE_VISIBLE = 3;
const LANE_STEP = 0.45;      // spacing between waiting clusters
const LANE_START = 0.55;    // gap between the track edge and the first waiting cluster

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

/** Merge several primitive geometries into one mesh (one draw call). */
function mergeParts(parts: { positions: number[]; normals?: number[]; uvs?: number[]; indices?: number[] }[]): Mesh {
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    let base = 0;
    for (const g of parts) {
        const vc = g.positions.length / 3;
        for (let i = 0; i < vc; i++) {
            positions.push(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
            if (g.normals) normals.push(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]);
            if (g.uvs) uvs.push(g.uvs[i * 2], g.uvs[i * 2 + 1]);
        }
        for (const ii of (g.indices || [])) indices.push(ii + base);
        base += vc;
    }
    return utils.createMesh({ positions, normals, uvs, indices });
}

interface Seg { len: number; at: (u: number, out: Vec3) => void }

/**
 * The circuit as nine arc-length segments walked CLOCKWISE from the top centre,
 * so t=0 is top centre, t=0.25 the right midpoint, t=0.5 the bottom centre (the
 * boarding gap) and t=0.75 the left midpoint. The top straight is split in two so
 * the walk can start at its middle; by symmetry the quarter marks then land
 * exactly on the side midpoints.
 */
function buildSegments(cy: number): Seg[] {
    const sx = W - R, sy = H - R;
    const line = (x0: number, y0: number, x1: number, y1: number): Seg => ({
        len: Math.hypot(x1 - x0, y1 - y0),
        at: (u, out) => out.set(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 0),
    });
    // a0 is the start angle; the sweep is -90 degrees (clockwise).
    const corner = (cx: number, ccy: number, a0: number): Seg => ({
        len: (Math.PI / 2) * R,
        at: (u, out) => {
            const a = a0 - (Math.PI / 2) * u;
            out.set(cx + R * Math.cos(a), ccy + R * Math.sin(a), 0);
        },
    });
    const HP = Math.PI / 2;
    return [
        line(0, cy + H, sx, cy + H),
        corner(sx, cy + sy, HP),
        line(W, cy + sy, W, cy - sy),
        corner(sx, cy - sy, 0),
        line(sx, cy - H, -sx, cy - H),
        corner(-sx, cy - sy, -HP),
        line(-W, cy - sy, -W, cy + sy),
        corner(-sx, cy + sy, Math.PI),
        line(-sx, cy + H, 0, cy + H),
    ];
}

let SEGS: Seg[] | null = null;
let SEG_CY = NaN;
let PERIMETER = 0;

/** Scratch output for `repositionAll`'s per-cluster, per-frame `pathPoint` calls
 *  (12 clusters * ~60fps), so that hot path doesn't allocate a `Vec3` per call. */
const REPOSITION_SCRATCH = new Vec3();
/** Scratch for the per-row path normal, same hot path as REPOSITION_SCRATCH. */
const NORMAL_SCRATCH = new Vec3();

function segments(cy: number): Seg[] {
    if (SEGS && SEG_CY === cy) return SEGS;
    SEGS = buildSegments(cy);
    SEG_CY = cy;
    PERIMETER = SEGS.reduce((a, s) => a + s.len, 0);
    return SEGS;
}

/** Desaturated/darkened tint for the channel that is not feeding yet. */
function dim(c: Color): Color {
    return new Color(
        Math.round(c.r * 0.35 + 120 * 0.65),
        Math.round(c.g * 0.35 + 120 * 0.65),
        Math.round(c.b * 0.35 + 120 * 0.65),
        255,
    );
}

/** Point at arc-length fraction t in [0,1) along the circuit. */
function pathPoint(t: number, cy: number, out: Vec3 = new Vec3()): Vec3 {
    const segs = segments(cy);
    let s = ((t % 1) + 1) % 1 * PERIMETER;
    for (const seg of segs) {
        if (s <= seg.len) { seg.at(seg.len > 0 ? s / seg.len : 0, out); return out; }
        s -= seg.len;
    }
    segs[segs.length - 1].at(1, out);
    return out;
}

// Scratch for the finite-difference normal (two path samples per call).
const _nA = new Vec3();
const _nB = new Vec3();

/**
 * Unit normal to the path at t, in the board plane — the direction a row of passengers
 * runs, since a row stands ACROSS the track rather than along it. Taken as a finite
 * difference of the path rather than analytically per segment: the segments only answer
 * positions, and a 1/2000-lap difference reads as smooth straight through the corners.
 */
function pathNormal(t: number, cy: number, out: Vec3 = new Vec3()): Vec3 {
    const d = 1 / 2000;
    pathPoint(t + d, cy, _nA);
    pathPoint(t - d, cy, _nB);
    const dx = _nA.x - _nB.x, dy = _nA.y - _nB.y;
    const len = Math.hypot(dx, dy) || 1;
    out.set(-dy / len, dx / len, 0);
    return out;
}

/**
 * Renders the passenger loop as a closed race-track: a white-curbed rounded rectangle
 * that rows of same-coloured passengers flow around smoothly, with a boarding gap at
 * the bottom centre (nearest the parking area below) fed by two waiting lanes, one on
 * either side of the gap. One ring cell carries one row of up to GROUP_SIZE figures,
 * laid out across the direction of travel.
 */
export class TrackView {
    private readonly capacity: number;
    /** loopRoot; needed to turn board-local path points into world positions. */
    private readonly root: Node;
    private readonly cy: number;
    private readonly tick: number;
    private readonly entries: { board: number; left: number; right: number };
    /** Path parameters where the curb opens up; filled before buildCurbs runs. */
    private gapTs: number[] = [];
    /** One row node per ring slot, positioned on the path centreline. */
    private clusters: Node[] = [];
    /** The GROUP_SIZE figures inside each ring row; `count` of them are shown. */
    private rowFigures: Node[][] = [];

    /** Head-of-channel waiting rows drawn beside the track, one array per side. */
    private laneClusters: { left: Node[]; right: Node[] } = { left: [], right: [] };
    /** The figures inside each waiting row, same shape as `laneClusters`. */
    private laneFigures: { left: Node[][]; right: Node[][] } = { left: [], right: [] };
    /** Resting position of every waiting slot, captured in buildLanes. */
    private laneHome: { left: Vec3[]; right: Vec3[] } = { left: [], right: [] };
    private lastLen = { left: -1, right: -1 };

    private phaseHolder = { p: 0 };
    private phaseTween: Tween<{ p: number }> | null = null;

    /** The in-flight entry flier for each side, if any (see `playEntry`). */
    private pendingFlier: { left: Node | null; right: Node | null } = { left: null, right: null };

    constructor(
        parent: Node, capacity: number, y: number, tick: number,
        entries: { board: number; left: number; right: number },
    ) {
        this.capacity = capacity;
        this.root = parent;
        this.cy = y;
        this.tick = tick;
        this.entries = entries;
        this.gapTs = [entries.board / capacity, entries.left / capacity, entries.right / capacity];
        this.buildCurbs(parent);
        this.buildClusters(parent);
        this.buildLanes(parent);
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

    // Two white rails (outer + inner edge), each a merged strip of small boxes laid
    // along the rounded-rect path — replaces the ellipse's scaled tori, since a
    // rounded rect isn't a torus, and lets the boarding/entry gaps be cut out by
    // skipping the samples that fall inside them. One draw call per rail (2 total).
    private buildCurbs(parent: Node): void {
        const SAMPLES = 96;
        const half = 0.5 / this.capacity; // half a slot wide gap
        for (const [off, name] of [[CURB_OFFSET, 'curb-outer'], [-CURB_OFFSET, 'curb-inner']] as const) {
            const parts: { positions: number[]; normals?: number[]; uvs?: number[]; indices?: number[] }[] = [];
            const p = new Vec3(), q = new Vec3();
            for (let i = 0; i < SAMPLES; i++) {
                const t = i / SAMPLES;
                // Skip the samples that fall inside a gap.
                if (this.gapTs.some((g) => Math.abs(((t - g + 1.5) % 1) - 0.5) < half)) continue;
                pathPoint(t, this.cy, p);
                pathPoint(t + 1 / SAMPLES, this.cy, q);
                const dx = q.x - p.x, dy = q.y - p.y;
                const len = Math.hypot(dx, dy) || 1e-4;
                const nx = -dy / len, ny = dx / len;      // outward normal in the board plane
                const box = primitives.box({ width: len * 1.2, height: 0.12, length: 0.12 });
                // rotate the box about +Z so its width follows the path direction
                const ang = Math.atan2(dy, dx), ca = Math.cos(ang), sa = Math.sin(ang);
                const cx = p.x + nx * off, cyy = p.y + ny * off;
                const pos = box.positions.slice();
                for (let v = 0; v < pos.length; v += 3) {
                    const x = pos[v], y = pos[v + 1];
                    pos[v] = cx + x * ca - y * sa;
                    pos[v + 1] = cyy + x * sa + y * ca;
                }
                parts.push({ positions: pos, normals: box.normals, uvs: box.uvs, indices: box.indices });
            }
            const n = new Node(name);
            const mr = n.addComponent(MeshRenderer);
            mr.mesh = mergeParts(parts);
            mr.material = litMaterial(Color.WHITE.clone());
            parent.addChild(n);
        }
    }

    private buildClusters(parent: Node): void {
        for (let i = 0; i < this.capacity; i++) {
            const cluster = makeRow(`pax-row-${i}`);
            this.rowFigures.push(cluster.children.slice());
            const t = i / this.capacity;
            const p = pathPoint(t, this.cy);
            cluster.setPosition(p.x, p.y, 0);
            cluster.active = false;
            parent.addChild(cluster);
            this.clusters.push(cluster);
        }
    }

    /** Builds the two feeder-channel lanes: a floor slab and the head waiting slots. */
    private buildLanes(parent: Node): void {
        for (const side of ['left', 'right'] as const) {
            const dir = side === 'left' ? -1 : 1;         // left lane runs out to -x
            const x0 = dir * (W + CURB_OFFSET + LANE_START);
            // Lane floor: a light slab the waiting passengers stand on. Sized to the
            // clusters it carries (outermost cluster centre at x0 + dir*(LANE_VISIBLE-1)*LANE_STEP,
            // half-extent ~0.21) rather than a fixed margin. Because slabW and its centre
            // offset both scale with (LANE_VISIBLE-1)*LANE_STEP, the halves cancel and the
            // slab's outer edge reduces to:
            //   |x0| + (LANE_VISIBLE - 1) * LANE_STEP + 0.25
            // which must stay within the ~4.67-unit visible half-width at the track's depth
            // whenever these constants change. That one bound covers the passengers too:
            // the outermost cluster's tip sits at |x0| + (LANE_VISIBLE-1)*LANE_STEP + 0.21,
            // inside the slab's edge by construction (0.21 < 0.25). With the shipped
            // constants those work out to 4.65 and 4.61, against the 4.67 limit.
            const slabW = LANE_STEP * (LANE_VISIBLE - 1) + 0.5;
            const slab = makeLitBox(`lane-${side}`, slabW, 0.55, 0.1, new Color(238, 236, 230));
            slab.setPosition(x0 + dir * (LANE_STEP * (LANE_VISIBLE - 1)) / 2, this.cy, -0.06);
            parent.addChild(slab);
            for (let i = 0; i < LANE_VISIBLE; i++) {
                const n = makeRow(`wait-${side}-${i}`);
                // A lane feeds inward along x, so its rows run across that: along y.
                // Fixed, unlike the ring's rows, because a lane never turns.
                const figures = n.children.slice();
                layoutRow(figures, 0, 1);
                this.laneFigures[side].push(figures);
                n.setPosition(x0 + dir * i * LANE_STEP, this.cy, 0);
                n.active = false;
                parent.addChild(n);
                this.laneClusters[side].push(n);
                this.laneHome[side].push(n.position.clone());
            }
        }
    }

    /** Reflects ring contents (color/visibility) and advances the flow phase one step. */
    update(ring: (PaxGroup | null)[], left: PaxGroup[], right: PaxGroup[]): void {
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

        this.updateLanes(ring, left, right);
    }

    /**
     * Draw the head of each channel. The inactive channel (the right one while the
     * left still has passengers) is dimmed, so "left goes first" is readable without
     * a tutorial. Only the head `LANE_VISIBLE` are drawn; the rest are implied.
     */
    private updateLanes(ring: (PaxGroup | null)[], left: PaxGroup[], right: PaxGroup[]): void {
        const leftActive = left.length > 0;
        for (const [side, queue] of [['left', left], ['right', right]] as const) {
            const active = side === 'left' ? leftActive : !leftActive;
            const nodes = this.laneClusters[side];
            for (let i = 0; i < nodes.length; i++) {
                const group = queue[i];
                const n = nodes[i];
                if (!group) { n.active = false; continue; }
                n.active = true;
                paintRow(this.laneFigures[side][i], colorOf(group.color), group.count,
                    active ? NO_SHADE : dim);
            }
        }
        // Which channel actually lost its head this tick? NOT necessarily the one that is
        // active now: the tick that drains the left channel flips `leftActive` to false,
        // so keying off the active side would miss that entrant — and its lane slide —
        // exactly once per level, at the hand-over. Compare both sides instead.
        const dropped: 'left' | 'right' | null =
            this.lastLen.left >= 0 && left.length < this.lastLen.left ? 'left'
            : this.lastLen.right >= 0 && right.length < this.lastLen.right ? 'right'
            : null;
        // Always call animateLaneShift: it is what keeps `lastLen` up to date, and it
        // early-returns on its own when nothing moved.
        this.animateLaneShift(dropped ?? (leftActive ? 'left' : 'right'), left, right);
        if (dropped) {
            const index = dropped === 'left' ? this.entries.left : this.entries.right;
            const group = ring[index];
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
    private animateLaneShift(active: 'left' | 'right', left: PaxGroup[], right: PaxGroup[]): void {
        const len = active === 'left' ? left.length : right.length;
        const prev = this.lastLen[active];
        this.lastLen.left = left.length;
        this.lastLen.right = right.length;
        if (prev < 0 || len >= prev) return;   // nothing left the lane this tick
        const dir = active === 'left' ? -1 : 1;
        const nodes = this.laneClusters[active];
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!n.isValid || !n.active) continue;
            const home = this.laneHome[active][i];
            Tween.stopAllByTarget(n);          // a tick can land before the last slide ends
            n.setPosition(home.x + dir * LANE_STEP, home.y, home.z);
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
            const p = pathPoint(t, this.cy, REPOSITION_SCRATCH);
            cluster.setPosition(p.x, p.y, 0);
            // The row runs across the track, so its spread turns with the path. Rows
            // that are hidden this tick are skipped — nothing to lay out, and it keeps
            // the per-frame cost at the rows actually on screen.
            if (!cluster.active) continue;
            const n = pathNormal(t, this.cy, NORMAL_SCRATCH);
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
        const t = this.entries.board / this.capacity;
        const local = pathPoint(t, this.cy, new Vec3());
        const n = pathNormal(t, this.cy);
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
    private playEntry(side: 'left' | 'right', group: PaxGroup): void {
        const index = side === 'left' ? this.entries.left : this.entries.right;
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
        const n = pathNormal(entryT, this.cy);
        layoutRow(figures, n.x, n.y);
        paintRow(figures, colorOf(group.color), group.count, NO_SHADE);
        flier.setPosition(from);
        this.root.addChild(flier);
        this.pendingFlier[side] = flier;
        tween(flier)
            .to(this.tick, { position: pathPoint(index / this.capacity, this.cy) })
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
