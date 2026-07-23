import {
    _decorator, Component, JsonAsset, resources, Node, Camera, find, Vec3,
    math, input, Input, EventTouch, EventMouse, geometry, tween,
} from 'cc';
import { GameCore, validateLevel, LevelData, Dir } from '../core/index';
import { GridLayout } from './grid-layout';
import { GridView } from './grid-view';
import { ParkingView } from './parking-view';
import { LoopView } from './loop-view';

const { ccclass, property } = _decorator;

function dirVec(d: Dir): Vec3 {
    switch (d) {
        case 'up': return new Vec3(0, 1, 0);
        case 'down': return new Vec3(0, -1, 0);
        case 'left': return new Vec3(-1, 0, 0);
        case 'right': return new Vec3(1, 0, 0);
    }
}

/**
 * M2.2a: loads/renders a level and wires tap input — screen tap → ray to the
 * z=0 board plane → pick a car → GameCore.tapCar. On success the car node is
 * removed (drive-out animation comes in M2.2b).
 */
@ccclass('GameController')
export class GameController extends Component {
    @property
    levelName: string = 'level-1';

    private core: GameCore | null = null;
    private gridView: GridView | null = null;
    private parkingView: ParkingView | null = null;
    private loopView: LoopView | null = null;
    private cam: Camera | null = null;
    private busy = false;

    /** Parked cars awaiting departure, keyed by carId. */
    private parked = new Map<number, Node>();
    private tickAcc = 0;
    private readonly TICK = 0.12;
    private ended = false;

    start() {
        resources.load(`levels/${this.levelName}`, JsonAsset, (err, asset) => {
            if (err) {
                console.error('[Game] failed to load level', this.levelName, err);
                return;
            }
            const level = asset.json as unknown as LevelData;
            const errors = validateLevel(level);
            if (errors.length > 0) {
                console.error('[Game] invalid level:', errors);
                return;
            }
            this.core = new GameCore(level);
            console.log(
                `[Game] level '${this.levelName}' loaded: ` +
                    `${level.grid.cars.length} cars, ` +
                    `parking ${level.parking.unlocked}/${level.parking.slots} unlocked, ` +
                    `${level.loop.queue.length} passenger groups, ` +
                    `state=${this.core.getState()}`,
            );
            this.renderBoard(level);
            this.registerInput();
        });
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    }

    update(dt: number): void {
        if (!this.core || this.ended || this.core.getState() !== 'playing') return;
        this.tickAcc += dt;
        while (this.tickAcc >= this.TICK) {
            this.tickAcc -= this.TICK;
            const res = this.core.stepLoop();
            this.loopView?.update(this.core.loop.ring);
            if (res.departedCarIds.length > 0) this.onDeparted(res.departedCarIds);
            if (this.core.getState() !== 'playing') {
                this.onEnd(this.core.getState());
                break;
            }
        }
    }

    private onDeparted(ids: number[]): void {
        for (const id of ids) {
            const node = this.parked.get(id);
            if (!node) continue;
            this.parked.delete(id);
            tween(node)
                .by(0.4, { position: new Vec3(0, 9, 0) })
                .call(() => node.destroy())
                .start();
        }
    }

    private onEnd(state: string): void {
        this.ended = true;
        console.log(`[Game] level ended: ${state}`);
    }

    private renderBoard(level: LevelData): void {
        // Vertical stack (XY plane, facing camera): loop on top, parking in the
        // middle, grid at the bottom.
        const LOOP_Y = 3.4;
        const PARKING_Y = 1.2;
        const GRID_Y = -3.2;

        const loopRoot = new Node('LoopRoot');
        this.node.addChild(loopRoot);
        this.loopView = new LoopView(loopRoot, level.loop.capacity, LOOP_Y);
        this.loopView.update(this.core!.loop.ring);

        const parkingRoot = new Node('ParkingRoot');
        this.node.addChild(parkingRoot);
        this.parkingView = new ParkingView(
            parkingRoot,
            level.parking.slots,
            level.parking.unlocked,
            PARKING_Y,
        );
        this.parkingView.render();

        const gridRoot = new Node('GridRoot');
        gridRoot.setPosition(0, GRID_Y, 0);
        this.node.addChild(gridRoot);
        const layout = new GridLayout(level.grid.cols, level.grid.rows);
        this.gridView = new GridView(gridRoot, this.core!.grid, layout);
        this.gridView.render();

        this.setupCamera(0, 11);
    }

    /** Position the Main Camera straight-on to frame `frameHeight` world units centered at y=centerY. */
    private setupCamera(centerY: number, frameHeight: number): void {
        const camNode = find('Main Camera');
        if (!camNode) {
            console.warn('[Game] Main Camera not found — cannot frame the board');
            return;
        }
        this.cam = camNode.getComponent(Camera);
        const fovDeg = this.cam ? this.cam.fov : 45;
        const dist = frameHeight / 2 / Math.tan(math.toRadian(fovDeg) / 2);
        camNode.setPosition(new Vec3(0, centerY, dist));
        camNode.setRotationFromEuler(0, 0, 0);
    }

    private registerInput(): void {
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    }

    private onTouchEnd(e: EventTouch): void {
        const p = e.getLocation();
        this.handleTap(p.x, p.y);
    }

    private onMouseUp(e: EventMouse): void {
        const p = e.getLocation();
        this.handleTap(p.x, p.y);
    }

    private handleTap(screenX: number, screenY: number): void {
        if (!this.core || !this.gridView || !this.parkingView || !this.cam) return;
        if (this.busy) return;

        const ray = new geometry.Ray();
        this.cam.screenPointToRay(screenX, screenY, ray);
        if (Math.abs(ray.d.z) < 1e-6) return;
        const t = -ray.o.z / ray.d.z;
        const hit = new Vec3(ray.o.x + ray.d.x * t, ray.o.y + ray.d.y * t, 0);

        const id = this.gridView.pickCar(hit);
        if (id == null) return;

        // Capture the car's exit direction before tapCar removes it from the grid.
        const dir = this.core.grid.cars.get(id)?.dir as Dir | undefined;
        const res = this.core.tapCar(id);
        console.log(`[Game] tap car ${id} ->`, JSON.stringify(res), 'state=', this.core.getState());

        if (res.ok) {
            this.playDriveToSlot(id, dir ?? 'up', res.slotIndex);
        } else {
            this.playShake(id);
        }
    }

    /** Animate a car driving out along its arrow then into its parking slot. */
    private playDriveToSlot(id: number, dir: Dir, slotIndex: number): void {
        const node = this.gridView!.detachCar(id);
        if (!node) return;
        node.setParent(this.node, true); // keep world position; board roots sit at origin

        const start = node.position.clone();
        const nudge = start.clone().add(dirVec(dir).multiplyScalar(0.8));
        const slot = this.parkingView!.getSlotPosition(slotIndex);

        this.busy = true;
        tween(node)
            .to(0.12, { position: nudge })
            .to(0.28, { position: slot, scale: new Vec3(0.55, 0.55, 0.55) })
            .call(() => {
                this.busy = false;
                this.parked.set(id, node);
            })
            .start();
    }

    /** Wobble a blocked / can't-park car in place. */
    private playShake(id: number): void {
        const node = this.gridView!.getCarNode(id);
        if (!node) return;
        this.busy = true;
        tween(node)
            .by(0.05, { position: new Vec3(0.12, 0, 0) })
            .by(0.05, { position: new Vec3(-0.24, 0, 0) })
            .by(0.05, { position: new Vec3(0.24, 0, 0) })
            .by(0.05, { position: new Vec3(-0.12, 0, 0) })
            .call(() => { this.busy = false; })
            .start();
    }
}
