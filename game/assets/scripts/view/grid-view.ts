import { Node, Vec3 } from 'cc';
import { GridSystem } from '../core/index';
import { GridLayout } from './grid-layout';
import { colorOf } from './colors';
import { makeCar, Dir } from './placeholder';

interface CarEntry {
    id: number;
    node: Node;
    hw: number; // half width (world)
    hh: number; // half height (world)
}

/**
 * Renders the bottom grid: one placeholder car node per car in the GridSystem,
 * positioned by GridLayout. Supports world-space picking and removal.
 */
export class GridView {
    private carNodes = new Map<number, Node>();
    private entries: CarEntry[] = [];

    constructor(
        private parent: Node,
        private grid: GridSystem,
        private layout: GridLayout,
    ) {}

    render(): void {
        for (const [id, car] of this.grid.cars) {
            const size = this.layout.footprintSize(car.w, car.h);
            const node = makeCar(`car-${id}`, size.x, size.y, colorOf(car.color), car.dir as Dir);
            node.setPosition(this.layout.cellCenter(car.x, car.y, car.w, car.h));
            this.parent.addChild(node);
            this.carNodes.set(id, node);
            this.entries.push({ id, node, hw: size.x / 2, hh: size.y / 2 });
        }
    }

    /** Returns the id of the car whose footprint contains `world` (XY), or null. */
    pickCar(world: Vec3): number | null {
        for (const e of this.entries) {
            const p = e.node.worldPosition;
            if (Math.abs(world.x - p.x) <= e.hw && Math.abs(world.y - p.y) <= e.hh) {
                return e.id;
            }
        }
        return null;
    }

    getCarNode(id: number): Node | undefined {
        return this.carNodes.get(id);
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
