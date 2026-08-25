import { Node, Vec3 } from 'cc';
import { CLEARANCE, GridSystem } from '../core/index';
import { BoardLayout } from './board-layout';
import { colorOf } from './colors';
import { buildCar, Cap } from './car-builder';

interface CarEntry {
    id: number;
    node: Node;
    body: Node;
    /** Fitted body length and width (world), and the heading they are drawn at. */
    len: number;
    wid: number;
    angle: number;
}

/**
 * Renders the parking lot: one car node per car in the core, positioned and turned by
 * BoardLayout. Supports world-space picking and removal.
 */
export class GridView {
    private carNodes = new Map<number, Node>();
    private entries: CarEntry[] = [];

    /** Half a clearance, in world units. See `pickCar`. */
    private readonly slop: number;

    constructor(
        private parent: Node,
        private grid: GridSystem,
        private layout: BoardLayout,
    ) {
        this.slop = (CLEARANCE / 2) * layout.scale;
    }

    render(): void {
        for (const [id, car] of this.grid.cars) {
            const { len, wid } = this.layout.carSize(car.cap as Cap);
            const built = buildCar(
                `car-${id}`, len, wid, colorOf(car.color), car.angle, car.cap as Cap,
            );
            built.root.setPosition(this.layout.toWorld(car.x, car.y));
            this.parent.addChild(built.root);
            this.carNodes.set(id, built.root);
            this.entries.push({
                id, node: built.root, body: built.body,
                len: built.len, wid: built.wid, angle: car.angle,
            });
        }
    }

    /**
     * The id of the car whose body contains `local` (in gridRoot-local space), or null.
     *
     * The box test runs in the CAR's own frame, not the board's: a car parked at an angle
     * has no axis-aligned box worth testing against. The version this replaces compared
     * against half-extents on the board axes, which for a diagonal car is a box up to 40%
     * wider than the car -- a tap on the empty corner beside it picked it up, and with a
     * lot this dense that corner belongs to a different car.
     *
     * Cars are iterated in insertion order and the first hit wins. Two cars cannot overlap
     * (validateLevel enforces a clearance between every pair), so at most one can contain
     * any point and the order does not matter.
     *
     * The box is grown by SLOP, because an exact body is a small target: a small car is
     * 0.355 world units across in a frame about 9.8 wide, which is a finger's width and no
     * more. Half a clearance on each side is the most that is provably safe -- core keeps
     * every pair of bodies a full clearance apart, so two grown boxes still cannot both
     * contain a point, and first-hit stays unambiguous. Wanting a bigger target than that
     * would mean picking the NEAREST car rather than the first one that contains the tap.
     */
    pickCar(local: Vec3): number | null {
        for (const e of this.entries) {
            const p = e.node.position; // gridRoot-local, stable under board tilt
            // Rotate the offset by -angle to land in the car's frame, where its body is
            // axis-aligned and a plain half-extent test is exact.
            const r = -e.angle * Math.PI / 180;
            const c = Math.cos(r);
            const s = Math.sin(r);
            const dx = local.x - p.x;
            const dy = local.y - p.y;
            const along = dx * c - dy * s;
            const across = dx * s + dy * c;
            if (Math.abs(along) <= e.len / 2 + this.slop
                && Math.abs(across) <= e.wid / 2 + this.slop) return e.id;
        }
        return null;
    }

    getCarNode(id: number): Node | undefined {
        return this.carNodes.get(id);
    }

    /** Returns the animatable body node (chassis/cabin/wheels/windows/arrow) for a car, if tracked. */
    getCarBody(id: number): Node | undefined {
        return this.entries.find((e) => e.id === id)?.body;
    }

    /**
     * The size the car's model was fitted to, so a caller moving it off the lot can refit
     * it. Read it BEFORE `detachCar`, which drops the entry it comes from.
     */
    getCarSize(id: number): { len: number; wid: number } | null {
        const e = this.entries.find((x) => x.id === id);
        return e ? { len: e.len, wid: e.wid } : null;
    }

    /** Stop tracking a car and return its node WITHOUT destroying it (for park animation). */
    detachCar(id: number): Node | null {
        const node = this.carNodes.get(id) ?? null;
        this.carNodes.delete(id);
        this.entries = this.entries.filter((e) => e.id !== id);
        return node;
    }

    removeCar(id: number): void {
        const node = this.carNodes.get(id);
        if (node) node.destroy();
        this.carNodes.delete(id);
        this.entries = this.entries.filter((e) => e.id !== id);
    }
}
