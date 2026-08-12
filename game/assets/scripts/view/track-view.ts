import { Node, Color, Vec3, Mesh, MeshRenderer, utils, primitives, tween, Tween } from 'cc';
import { colorOf } from './colors';
import { litMaterial } from './materials';

/** Path parameter (t in [0,1)) of the boarding point: the lowest point on the
 *  ellipse (nearest the parking area below), i.e. where sin(2*pi*t) = -1. */
const T_BOARD = 0.75;

const RX = 3.4;
const RY = 1.5;

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
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    let base = 0;
    for (const [ox, oy] of BALL_OFFSETS) {
        const g = primitives.sphere(BALL_RADIUS, { segments: 8 });
        const vc = g.positions.length / 3;
        for (let i = 0; i < vc; i++) {
            positions.push(g.positions[i * 3] + ox, g.positions[i * 3 + 1] + oy, g.positions[i * 3 + 2]);
            if (g.normals) normals.push(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]);
            if (g.uvs) uvs.push(g.uvs[i * 2], g.uvs[i * 2 + 1]);
        }
        for (const ii of (g.indices || [])) indices.push(ii + base);
        base += vc;
    }
    CLUSTER_MESH = utils.createMesh({ positions, normals, uvs, indices });
    return CLUSTER_MESH;
}

/** Point on the closed ellipse path at parameter t in [0,1). */
function pathPoint(t: number, cy: number, out: Vec3 = new Vec3()): Vec3 {
    const theta = t * Math.PI * 2;
    out.x = RX * Math.cos(theta);
    out.y = cy + RY * Math.sin(theta);
    out.z = 0;
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
    /** One cluster root node per ring slot; each holds a few small colored spheres. */
    private clusters: Node[] = [];
    private ringColors: (string | null)[] = [];

    /** Current/target flow phase (0..1), advanced by 1/capacity each tick and tweened smoothly. */
    private phase = 0;
    private phaseHolder = { p: 0 };
    private phaseTween: Tween<{ p: number }> | null = null;

    constructor(parent: Node, capacity: number, y: number, tick = 0.12) {
        this.capacity = capacity;
        this.cy = y;
        this.tick = tick;

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

    private buildCurbs(parent: Node): void {
        const white = Color.WHITE.clone();
        // Two white rails (outer + inner edge) as scaled tori — a torus built at unit
        // radius, laid into the board plane (Rx 90) and scaled to the ellipse semi-axes,
        // gives the exact double-line oval the 96 curb boxes used to approximate, at 2
        // draw calls instead of 96. Tube ≈ 0.06 → ~0.12 rail thickness (matches the old).
        const off = CURB_OFFSET;
        const rails: [number, number, string][] = [
            [RX + off, RY + off, 'curb-outer'],
            [RX - off, RY - off, 'curb-inner'],
        ];
        for (const [rx, ry, name] of rails) {
            const n = new Node(name);
            const mr = n.addComponent(MeshRenderer);
            mr.mesh = utils.createMesh(primitives.torus(1, 0.06, { radialSegments: 6, tubularSegments: 56 }));
            mr.material = litMaterial(white);
            n.setPosition(0, this.cy, 0);
            n.setRotationFromEuler(90, 0, 0); // ring from XZ into the board's XY plane
            n.setScale(rx, 1, ry);            // unit ring → ellipse (semi-axes rx, ry)
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
        this.phaseTween?.stop();
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
            const dist = (T_BOARD - t + 1) % 1;
            if (dist < bestDist) {
                bestDist = dist;
                best = this.clusters[i];
            }
        }
        return best ? best.worldPosition.clone() : null;
    }
}
