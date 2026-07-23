import { Node } from 'cc';
import { GridSystem } from '../core/index';
import { GridLayout } from './grid-layout';
import { colorOf } from './colors';
import { makeCar, Dir } from './placeholder';

/**
 * Renders the bottom grid: one placeholder car node per car in the GridSystem,
 * positioned by GridLayout. Static for M2.1 (no interaction yet).
 */
export class GridView {
    private carNodes = new Map<number, Node>();

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
        }
    }
}
