import { Node, Color, Vec3, Mesh, MeshRenderer, utils, primitives, tween, Tween } from 'cc';
import { colorOf } from './colors';
import { litMaterial } from './materials';
import { makeLitBox } from './placeholder';

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

/**
 * Renders the passenger loop as a closed race-track: a white-curbed oval that
 * dense little colored ball-clusters flow around smoothly, boarding at the
 * lowest point (nearest the parking area below). Started as a drop-in
 * replacement for LoopView; its public surface has since diverged
 * (`boardingWorldPos()` instead of a colour search, no `nearestVisibleWorldPos`)
 * to fix bugs LoopView's shape couldn't express.
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
    /** One cluster root node per ring slot; each holds a few small colored spheres. */
    private clusters: Node[] = [];

    /** Head-of-channel waiting clusters drawn beside the track, one array per side. */
    private laneClusters: { left: Node[]; right: Node[] } = { left: [], right: [] };
    /** Resting position of every waiting slot, captured in buildLanes. */
    private laneHome: { left: Vec3[]; right: Vec3[] } = { left: [], right: [] };
    private lastLen = { left: -1, right: -1 };

    /** Current/target flow phase (0..1), advanced by 1/capacity each tick and tweened smoothly. */
    private phase = 0;
    private phaseHolder = { p: 0 };
    private phaseTween: Tween<{ p: number }> | null = null;

    constructor(
        parent: Node, capacity: number, y: number, tick = 0.12,
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
        const mesh = clusterMesh();
        for (let i = 0; i < this.capacity; i++) {
            const cluster = new Node(`pax-cluster-${i}`);
            const mr = cluster.addComponent(MeshRenderer);
            mr.mesh = mesh; // shared merged 4-ball mesh
            mr.material = litMaterial(Color.WHITE.clone());
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
        const mesh = clusterMesh();
        for (const side of ['left', 'right'] as const) {
            const dir = side === 'left' ? -1 : 1;         // left lane runs out to -x
            const x0 = dir * (W + CURB_OFFSET + LANE_START);
            // Lane floor: a light slab the waiting passengers stand on.
            const slabW = LANE_STEP * LANE_VISIBLE + 0.3;
            const slab = makeLitBox(`lane-${side}`, slabW, 0.55, 0.1, new Color(238, 236, 230));
            slab.setPosition(x0 + dir * (slabW / 2 - LANE_STEP / 2), this.cy, -0.06);
            parent.addChild(slab);
            for (let i = 0; i < LANE_VISIBLE; i++) {
                const n = new Node(`wait-${side}-${i}`);
                const mr = n.addComponent(MeshRenderer);
                mr.mesh = mesh;
                mr.material = litMaterial(Color.WHITE.clone());
                n.setPosition(x0 + dir * i * LANE_STEP, this.cy, 0);
                n.active = false;
                parent.addChild(n);
                this.laneClusters[side].push(n);
                this.laneHome[side].push(n.position.clone());
            }
        }
    }

    /** Reflects ring contents (color/visibility) and advances the flow phase one step. */
    update(ring: (string | null)[], left: string[], right: string[]): void {
        for (let i = 0; i < this.clusters.length; i++) {
            const c = ring[i];
            const cluster = this.clusters[i];
            if (c) {
                cluster.active = true;
                const mr = cluster.getComponent(MeshRenderer);
                if (mr) mr.material = litMaterial(colorOf(c));
            } else {
                cluster.active = false;
            }
        }

        // Stop any in-flight phase tween first: tick cadence and tween duration are
        // both ~0.12s, so without this a new tween would overlap the previous one
        // and the two would fight over `phaseHolder.p`, producing visible jitter.
        //
        // The ring's CONTENTS already advanced one index, which alone moves a passenger
        // one slot. Pull the phase back a slot so the new index renders where the
        // passenger visually was, then tween it forward: net motion is exactly one slot
        // per tick and the resting phase stays 0, which is what keeps the boarding gap
        // pinned to a fixed point on the track.
        this.phaseTween?.stop();
        this.phaseHolder.p -= 1 / this.capacity;
        const target = this.phaseHolder.p + 1 / this.capacity;
        this.phaseTween = tween(this.phaseHolder)
            .to(this.tick, { p: target }, {
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
    private updateLanes(ring: (string | null)[], left: string[], right: string[]): void {
        const leftActive = left.length > 0;
        for (const [side, queue] of [['left', left], ['right', right]] as const) {
            const active = side === 'left' ? leftActive : !leftActive;
            const nodes = this.laneClusters[side];
            for (let i = 0; i < nodes.length; i++) {
                const color = queue[i];
                const n = nodes[i];
                if (!color) { n.active = false; continue; }
                n.active = true;
                const mr = n.getComponent(MeshRenderer);
                if (mr) mr.material = litMaterial(active ? colorOf(color) : dim(colorOf(color)));
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
            const color = ring[index];
            if (color) this.playEntry(dropped, color);
        }
    }

    /**
     * When the active channel loses its head, slide the whole lane one step toward the
     * entrance: the colours are already the post-shift ones, so start the nodes one
     * step out and tween them back to their resting slot. Purely cosmetic -- no core
     * state involved. Homes come from `laneHome`, never from the node's current
     * position, which may be mid-tween from the previous tick.
     */
    private animateLaneShift(active: 'left' | 'right', left: string[], right: string[]): void {
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
        this.phase = this.phaseHolder.p % 1;
        for (let i = 0; i < this.clusters.length; i++) {
            const cluster = this.clusters[i];
            // Guard against a tween tick landing after the board was destroyed on restart.
            if (!cluster || !cluster.isValid) continue;
            const t = (i / this.capacity + this.phase) % 1;
            const p = pathPoint(t, this.cy);
            cluster.setPosition(p.x, p.y, 0);
        }
    }

    /**
     * World position of the boarding gap. Fixed, not searched: ring index `board` rests
     * at t = board/capacity, which is the bottom-centre gap. The passenger that boards
     * is by definition the one standing there, and by the time the controller animates
     * it the core has already cleared it from the ring — so looking for it by colour
     * finds a different passenger (or none at all, late in a level, and then nothing
     * animated at all). That was the bug this replaces.
     */
    boardingWorldPos(): Vec3 {
        const local = pathPoint(this.entries.board / this.capacity, this.cy);
        const out = new Vec3();
        Vec3.transformMat4(out, local, this.root.worldMatrix);
        return out;
    }

    /**
     * Walk the channel's head into the track through its entrance gap: the real ring
     * slot is hidden for this one tick while a temporary cluster tweens from the lane
     * head to the slot's resting spot, so "the hole came round to the entrance and the
     * next passenger stepped in" is legible instead of a colour appearing from nowhere.
     */
    private playEntry(side: 'left' | 'right', color: string): void {
        const index = side === 'left' ? this.entries.left : this.entries.right;
        const slot = this.clusters[index];
        const from = this.laneHome[side][0];
        if (!slot || !slot.isValid || !from) return;
        slot.active = false;
        const flier = new Node('pax-enter');
        const mr = flier.addComponent(MeshRenderer);
        mr.mesh = clusterMesh();
        mr.material = litMaterial(colorOf(color));
        flier.setPosition(from);
        this.root.addChild(flier);
        tween(flier)
            .to(this.tick, { position: pathPoint(index / this.capacity, this.cy) })
            .call(() => {
                if (slot.isValid) slot.active = true;
                if (flier.isValid) flier.destroy();
            })
            .start();
    }
}
