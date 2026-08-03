import { Node, Color, Vec3, MeshRenderer, utils, primitives, tween, Tween } from 'cc';
import { colorOf } from './colors';
import { makeLitBox } from './placeholder';
import { litMaterial } from './materials';

/** Path parameter (t in [0,1)) of the boarding point: the lowest point on the
 *  ellipse (nearest the parking area below), i.e. where sin(2*pi*t) = -1. */
const T_BOARD = 0.75;

const RX = 3.4;
const RY = 1.5;

/** Number of curb segments laid along each side (inner/outer) of the track. */
const CURB_SEGMENTS = 48;
/** Half-offset of the curb from the path centerline, along the local normal. */
const CURB_OFFSET = 0.35;

/** Balls per passenger cluster and their layout offsets (small clump). */
const BALL_OFFSETS: [number, number][] = [
    [0, 0.06],
    [-0.09, -0.05],
    [0.09, -0.05],
    [0, -0.13],
];
const BALL_RADIUS = 0.12;

/** Point on the closed ellipse path at parameter t in [0,1). */
function pathPoint(t: number, cy: number, out: Vec3 = new Vec3()): Vec3 {
    const theta = t * Math.PI * 2;
    out.x = RX * Math.cos(theta);
    out.y = cy + RY * Math.sin(theta);
    out.z = 0;
    return out;
}

/** Tangent direction angle (degrees) at path parameter t, for orienting curb segments. */
function tangentAngleDeg(t: number): number {
    const theta = t * Math.PI * 2;
    // d/dtheta [rx*cos, ry*sin] = [-rx*sin, ry*cos]
    const dx = -RX * Math.sin(theta);
    const dy = RY * Math.cos(theta);
    return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Outward normal direction (unit-ish, ellipse-aware) at path parameter t. */
function normalDir(t: number): { nx: number; ny: number } {
    const theta = t * Math.PI * 2;
    // Gradient of x^2/rx^2 + y^2/ry^2 (ignoring the cy offset, which doesn't affect direction).
    const nx = Math.cos(theta) / RX;
    const ny = Math.sin(theta) / RY;
    const len = Math.hypot(nx, ny) || 1;
    return { nx: nx / len, ny: ny / len };
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
        for (const side of [1, -1]) {
            for (let i = 0; i < CURB_SEGMENTS; i++) {
                const t = i / CURB_SEGMENTS;
                const p = pathPoint(t, this.cy);
                const { nx, ny } = normalDir(t);
                const seg = makeLitBox(`curb-${side}-${i}`, 0.5, 0.1, 0.05, white);
                seg.setPosition(p.x + nx * CURB_OFFSET * side, p.y + ny * CURB_OFFSET * side, 0);
                seg.setRotationFromEuler(0, 0, tangentAngleDeg(t));
                parent.addChild(seg);
            }
        }
    }

    private buildClusters(parent: Node): void {
        for (let i = 0; i < this.capacity; i++) {
            const cluster = new Node(`pax-cluster-${i}`);
            for (let b = 0; b < BALL_OFFSETS.length; b++) {
                const ball = new Node(`ball-${b}`);
                const mr = ball.addComponent(MeshRenderer);
                mr.mesh = utils.createMesh(primitives.sphere(BALL_RADIUS, { segments: 8 }));
                mr.material = litMaterial(Color.WHITE.clone());
                const [ox, oy] = BALL_OFFSETS[b];
                ball.setPosition(ox, oy, 0);
                cluster.addChild(ball);
            }
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
                const mat = litMaterial(colorOf(c));
                for (const ball of cluster.children) {
                    const mr = ball.getComponent(MeshRenderer);
                    if (mr) mr.material = mat;
                }
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
