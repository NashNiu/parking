import {
    _decorator, Component, JsonAsset, resources, Node, Camera, find, Vec3, Color, Label,
    input, Input, EventTouch, EventMouse, geometry, tween, Mat4,
} from 'cc';
import { GameCore, validateLevel, LevelData, Dir } from '../core/index';
import { GridLayout } from './grid-layout';
import { GridView } from './grid-view';
import { ParkingView } from './parking-view';
import { LoopView } from './loop-view';
import { HudView } from './hud-view';
import { makeBox } from './placeholder';
import { setupEnvironment } from './environment';

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
    private uiCam: Camera | null = null;
    private boardRoot: Node | null = null;
    private gridRoot: Node | null = null;
    private readonly BOARD_TILT = 52; // degrees, tilt the board back for a 2.5D look

    private busy = false;
    private ended = false;
    private loading = false;
    private tickAcc = 0;
    private readonly TICK = 0.12;
    private parked = new Map<number, { node: Node; bar: Node; slot: number; label: Label | null }>();

    start() {
        this.setupCamera();
        const canvas = find('Canvas');
        if (canvas) {
            this.hud = new HudView(canvas);
            this.uiCam = canvas.getComponentInChildren(Camera);
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
        this.loading = true;
        resources.load(`levels/${name}`, JsonAsset, (err, asset) => {
            if (err) {
                console.error('[Game] failed to load level', name, err);
                this.loading = false;
                return;
            }
            const level = asset.json as unknown as LevelData;
            const errors = validateLevel(level);
            if (errors.length > 0) {
                console.error('[Game] invalid level:', errors);
                this.loading = false;
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
            this.loading = false;
            console.log(`[Game] level '${name}' started, state=${this.core.getState()}`);
        });
    }

    private restart(): void {
        if (this.boardRoot) {
            this.boardRoot.destroy();
            this.boardRoot = null;
        }
        for (const [, e] of this.parked) {
            if (e.label) e.label.node.destroy();
        }
        this.parked.clear();
        this.loadLevel(this.levelName);
    }

    private buildBoard(level: LevelData): void {
        const LOOP_Y = 3.4;
        const PARKING_Y = 1.2;
        const GRID_Y = -3.2;

        this.boardRoot = new Node('Board');
        this.boardRoot.setRotationFromEuler(-this.BOARD_TILT, 0, 0);
        this.node.addChild(this.boardRoot);
        setupEnvironment(this.boardRoot);

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
        this.gridRoot = gridRoot;
        const layout = new GridLayout(level.grid.cols, level.grid.rows);
        this.gridView = new GridView(gridRoot, this.core!.grid, layout);
        this.gridView.render();
    }

    private setupCamera(): void {
        const camNode = find('Main Camera');
        if (!camNode) {
            console.warn('[Game] Main Camera not found — cannot frame the board');
            return;
        }
        this.cam = camNode.getComponent(Camera);
        // Elevated, looking down at the board center for a 2.5D three-quarter view.
        camNode.setPosition(new Vec3(0, 5, 12));
        camNode.lookAt(new Vec3(0, -0.3, 0));
        if (this.cam) {
            this.cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            this.cam.clearColor = new Color(255, 224, 186, 255);
        }
    }

    update(dt: number): void {
        if (!this.core || this.ended || this.core.getState() !== 'playing') return;
        this.tickAcc += dt;
        while (this.tickAcc >= this.TICK) {
            this.tickAcc -= this.TICK;
            const res = this.core.stepLoop();
            this.loopView?.update(this.core.loop.ring);
            this.hud?.setProgress(this.core.loop.remainingCount());
            this.updateFillBars();
            if (res.departedCarIds.length > 0) this.onDeparted(res.departedCarIds);
            if (this.core.getState() !== 'playing') {
                this.onEnd(this.core.getState());
                break;
            }
        }
    }

    private onDeparted(ids: number[]): void {
        for (const id of ids) {
            const e = this.parked.get(id);
            if (!e) continue;
            this.parked.delete(id);
            if (e.label) e.label.node.destroy();
            tween(e.node).by(0.4, { position: new Vec3(0, 9, 0) }).call(() => e.node.destroy()).start();
        }
    }

    /** Project a car's world position to the UI layer and place a label there. */
    private positionLabelOverCar(label: Label, carNode: Node): void {
        if (!this.cam || !this.uiCam) return;
        const screen = this.cam.worldToScreen(carNode.worldPosition, new Vec3());
        const uiWorld = this.uiCam.screenToWorld(screen, new Vec3());
        label.node.setWorldPosition(uiWorld);
    }

    /** A thin bar under each parked car showing filled / capacity. */
    private attachFillBar(car: Node): Node {
        const bg = makeBox('fillbg', 0.9, 0.18, 0.08, new Color(30, 30, 35));
        bg.setPosition(0, -0.5, 0.42);
        car.addChild(bg);
        const bar = makeBox('fill', 0.9, 0.18, 0.12, new Color(255, 215, 70));
        bar.setPosition(-0.45, -0.5, 0.44);
        bar.setScale(0.001, 1, 1);
        car.addChild(bar);
        return bar;
    }

    private updateFillBars(): void {
        for (const [id, e] of this.parked) {
            const pc = this.core!.parking.parked[e.slot];
            if (!pc || pc.carId !== id) continue;
            const r = pc.capacity > 0 ? pc.filled / pc.capacity : 0;
            e.bar.setScale(Math.max(0.001, r), 1, 1);
            e.bar.setPosition(-0.45 + 0.45 * r, -0.5, 0.44);
            if (e.label) e.label.string = `${pc.capacity - pc.filled}`;
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
        if (this.loading) return; // ignore taps while a level is (re)loading
        if (this.ended) {
            this.restart();
            return;
        }
        if (!this.core || !this.gridView || !this.parkingView || !this.cam || !this.gridRoot) return;
        if (this.busy) return;

        // Ray from the tap, intersected with the (possibly tilted) board plane, then
        // converted into gridRoot-local space where car footprints are defined.
        const ray = new geometry.Ray();
        this.cam.screenPointToRay(screenX, screenY, ray);
        const gr = this.gridRoot;
        const normal = new Vec3();
        Vec3.transformQuat(normal, Vec3.UNIT_Z, gr.worldRotation);
        const denom = Vec3.dot(normal, ray.d);
        if (Math.abs(denom) < 1e-6) return;
        const p = gr.worldPosition;
        const diff = new Vec3(p.x - ray.o.x, p.y - ray.o.y, p.z - ray.o.z);
        const tHit = Vec3.dot(normal, diff) / denom;
        if (tHit < 0) return;
        const worldHit = new Vec3(
            ray.o.x + ray.d.x * tHit,
            ray.o.y + ray.d.y * tHit,
            ray.o.z + ray.d.z * tHit,
        );
        const inv = new Mat4();
        Mat4.invert(inv, gr.worldMatrix);
        const localHit = new Vec3();
        Vec3.transformMat4(localHit, worldHit, inv);

        const id = this.gridView.pickCar(localHit);
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
                const bar = this.attachFillBar(node);
                const label = this.hud ? this.hud.newSeatLabel() : null;
                this.parked.set(id, { node, bar, slot: slotIndex, label });
                if (label) this.positionLabelOverCar(label, node);
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
