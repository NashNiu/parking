import {
    _decorator, Component, JsonAsset, resources, Node, Camera, find, Vec3,
    math, input, Input, EventTouch, EventMouse, geometry, tween,
} from 'cc';
import { GameCore, validateLevel, LevelData, Dir } from '../core/index';
import { GridLayout } from './grid-layout';
import { GridView } from './grid-view';
import { ParkingView } from './parking-view';
import { LoopView } from './loop-view';
import { HudView } from './hud-view';

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
 * M2.4: full playable demo loop. Loads/renders a level, handles tap-to-move,
 * drives the passenger loop each frame, shows a HUD + win/lose banner, and
 * restarts on tap once a level ends.
 */
@ccclass('GameController')
export class GameController extends Component {
    @property
    levelName: string = 'level-1';

    private core: GameCore | null = null;
    private gridView: GridView | null = null;
    private parkingView: ParkingView | null = null;
    private loopView: LoopView | null = null;
    private hud: HudView | null = null;
    private cam: Camera | null = null;
    private boardRoot: Node | null = null;

    private busy = false;
    private ended = false;
    private tickAcc = 0;
    private readonly TICK = 0.12;
    private parked = new Map<number, Node>();

    start() {
        this.setupCamera(0, 11);
        const canvas = find('Canvas');
        if (canvas) {
            this.hud = new HudView(canvas);
        } else {
            console.warn('[Game] Canvas not found — HUD disabled. Create a Canvas node named "Canvas".');
        }
        this.registerInput();
        this.loadLevel(this.levelName);
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    }

    private loadLevel(name: string): void {
        resources.load(`levels/${name}`, JsonAsset, (err, asset) => {
            if (err) {
                console.error('[Game] failed to load level', name, err);
                return;
            }
            const level = asset.json as unknown as LevelData;
            const errors = validateLevel(level);
            if (errors.length > 0) {
                console.error('[Game] invalid level:', errors);
                return;
            }
            this.core = new GameCore(level);
            this.buildBoard(level);
            this.hud?.setLevel(level.id);
            this.hud?.setProgress(this.core.loop.remainingCount());
            this.hud?.hideBanner();
            this.ended = false;
            this.busy = false;
            this.tickAcc = 0;
            console.log(`[Game] level '${name}' started, state=${this.core.getState()}`);
        });
    }

    private restart(): void {
        if (this.boardRoot) {
            this.boardRoot.destroy();
            this.boardRoot = null;
        }
        this.parked.clear();
        this.loadLevel(this.levelName);
    }

    private buildBoard(level: LevelData): void {
        const LOOP_Y = 3.4;
        const PARKING_Y = 1.2;
        const GRID_Y = -3.2;

        this.boardRoot = new Node('Board');
        this.node.addChild(this.boardRoot);

        const loopRoot = new Node('LoopRoot');
        this.boardRoot.addChild(loopRoot);
        this.loopView = new LoopView(loopRoot, level.loop.capacity, LOOP_Y);
        this.loopView.update(this.core!.loop.ring);

        const parkingRoot = new Node('ParkingRoot');
        this.boardRoot.addChild(parkingRoot);
        this.parkingView = new ParkingView(
            parkingRoot, level.parking.slots, level.parking.unlocked, PARKING_Y,
        );
        this.parkingView.render();

        const gridRoot = new Node('GridRoot');
        gridRoot.setPosition(0, GRID_Y, 0);
        this.boardRoot.addChild(gridRoot);
        const layout = new GridLayout(level.grid.cols, level.grid.rows);
        this.gridView = new GridView(gridRoot, this.core!.grid, layout);
        this.gridView.render();
    }

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

    update(dt: number): void {
        if (!this.core || this.ended || this.core.getState() !== 'playing') return;
        this.tickAcc += dt;
        while (this.tickAcc >= this.TICK) {
            this.tickAcc -= this.TICK;
            const res = this.core.stepLoop();
            this.loopView?.update(this.core.loop.ring);
            this.hud?.setProgress(this.core.loop.remainingCount());
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
            tween(node).by(0.4, { position: new Vec3(0, 9, 0) }).call(() => node.destroy()).start();
        }
    }

    private onEnd(state: string): void {
        this.ended = true;
        this.hud?.showBanner(state === 'won' ? '过关!\n点击重玩' : '卡住了\n点击重试');
        console.log(`[Game] level ended: ${state}`);
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
        if (this.ended) {
            this.restart();
            return;
        }
        if (!this.core || !this.gridView || !this.parkingView || !this.cam) return;
        if (this.busy) return;

        const ray = new geometry.Ray();
        this.cam.screenPointToRay(screenX, screenY, ray);
        if (Math.abs(ray.d.z) < 1e-6) return;
        const t = -ray.o.z / ray.d.z;
        const hit = new Vec3(ray.o.x + ray.d.x * t, ray.o.y + ray.d.y * t, 0);

        const id = this.gridView.pickCar(hit);
        if (id == null) return;

        const dir = this.core.grid.cars.get(id)?.dir as Dir | undefined;
        const res = this.core.tapCar(id);
        if (res.ok) {
            this.playDriveToSlot(id, dir ?? 'up', res.slotIndex);
        } else {
            this.playShake(id);
        }
    }

    private playDriveToSlot(id: number, dir: Dir, slotIndex: number): void {
        const node = this.gridView!.detachCar(id);
        if (!node) return;
        node.setParent(this.boardRoot!, true); // keep world position

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
