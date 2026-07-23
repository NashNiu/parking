import { Vec3 } from 'cc';

/**
 * Maps logical grid coordinates (x=col, y=row, top-left origin) to world
 * positions on the XY plane, board centered at (0,0). Row 0 is at the top
 * (positive Y). Cars sit slightly in front (+Z) so they face the camera.
 */
export class GridLayout {
    constructor(
        public cols: number,
        public rows: number,
        public cell: number = 1,
        public gap: number = 0.12,
    ) {}

    private step(): number {
        return this.cell + this.gap;
    }

    /** World-space center of a footprint rect (x,y,w,h). */
    cellCenter(x: number, y: number, w: number = 1, h: number = 1): Vec3 {
        const s = this.step();
        const totalW = this.cols * s;
        const totalH = this.rows * s;
        const wx = (x + w / 2) * s - totalW / 2;
        const wy = -((y + h / 2) * s - totalH / 2);
        return new Vec3(wx, wy, 0);
    }

    /** World size (X,Y) of a footprint rect, minus a small inset gap. */
    footprintSize(w: number, h: number): { x: number; y: number } {
        return {
            x: w * this.cell + (w - 1) * this.gap,
            y: h * this.cell + (h - 1) * this.gap,
        };
    }
}
