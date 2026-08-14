import { Node, Color, Vec3, Mesh, MeshRenderer, utils, primitives, tween, Tween } from 'cc';
import { colorOf } from './colors';
import { litMaterial } from './materials';

const W = 3.4;   // half width of the circuit centerline
const H = 1.5;   // half height
const R = 0.9;   // corner radius

/** Half-offset of the two curb rails from the path centerline. */
const CURB_OFFSET = 0.35;

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
 * lowest point (nearest the parking area below). Same public interface as the
 * LoopView it replaces, so GameController can swap it in directly.
 */
export class TrackView {
    private readonly capacity: number;
    private readonly cy: number;
    private readonly tick: number;
    private readonly entries: { board: number; left: number; right: number };
    /** Path parameters where the curb opens up; filled before buildCurbs runs. */
    private gapTs: number[] = [];
    /** One cluster root node per ring slot; each holds a few small colored spheres. */
    private clusters: Node[] = [];
    private ringColors: (string | null)[] = [];

    /** Current/target flow phase (0..1), advanced by 1/capacity each tick and tweened smoothly. */
    private phase = 0;
    private phaseHolder = { p: 0 };
    private phaseTween: Tween<{ p: number }> | null = null;

    constructor(
        parent: Node, capacity: number, y: number, tick = 0.12,
        entries: { board: number; left: number; right: number },
    ) {
        this.capacity = capacity;
        this.cy = y;
        this.tick = tick;
        this.entries = entries;
        this.gapTs = [entries.board / capacity, entries.left / capacity, entries.right / capacity];
        this.buildCurbs(parent);
        this.buildClusters(parent);
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

    /** Reflects ring contents (color/visibility) and advances the flow phase one step. */
    update(ring: (string | null)[]): void {
        this.ringColors = ring.slice();
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

    /** World position of the visible cluster showing `color` closest ahead of the boarding point. */
    nearestVisibleWorldPos(color: string): Vec3 | null {
        let best: Node | null = null;
        let bestDist = Infinity;
        for (let i = 0; i < this.clusters.length; i++) {
            if (this.ringColors[i] !== color || !this.clusters[i].active) continue;
            const t = (i / this.capacity + this.phase) % 1;
            const dist = (this.entries.board / this.capacity - t + 1) % 1;
            if (dist < bestDist) {
                bestDist = dist;
                best = this.clusters[i];
            }
        }
        return best ? best.worldPosition.clone() : null;
    }
}
