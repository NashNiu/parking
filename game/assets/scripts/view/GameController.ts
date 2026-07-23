import { _decorator, Component, JsonAsset, resources, Node, Camera, find, Vec3, math } from 'cc';
import { GameCore, validateLevel, LevelData } from '../core/index';
import { GridLayout } from './grid-layout';
import { GridView } from './grid-view';
import { ParkingView } from './parking-view';
import { LoopView } from './loop-view';

const { ccclass, property } = _decorator;

/**
 * M2.1: loads a level JSON, validates it, builds a GameCore, and renders the
 * static bottom grid with placeholder cars. Parking/loop rendering and
 * interaction come in later M2.1/M2.2 steps.
 */
@ccclass('GameController')
export class GameController extends Component {
    @property
    levelName: string = 'level-1';

    private core: GameCore | null = null;

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
        });
    }

    private renderBoard(level: LevelData): void {
        // Vertical stack (XY plane, facing camera): loop on top, parking in the
        // middle, grid at the bottom.
        const LOOP_Y = 3.4;
        const PARKING_Y = 1.2;
        const GRID_Y = -3.2;

        const loopRoot = new Node('LoopRoot');
        this.node.addChild(loopRoot);
        new LoopView(loopRoot, this.core!.loop.ring, LOOP_Y).render();

        const parkingRoot = new Node('ParkingRoot');
        this.node.addChild(parkingRoot);
        new ParkingView(
            parkingRoot,
            level.parking.slots,
            level.parking.unlocked,
            PARKING_Y,
        ).render();

        const gridRoot = new Node('GridRoot');
        gridRoot.setPosition(0, GRID_Y, 0);
        this.node.addChild(gridRoot);
        const layout = new GridLayout(level.grid.cols, level.grid.rows);
        new GridView(gridRoot, this.core!.grid, layout).render();

        this.setupCamera(0, 11);
    }

    /** Position the Main Camera straight-on to frame `frameHeight` world units centered at y=centerY. */
    private setupCamera(centerY: number, frameHeight: number): void {
        const camNode = find('Main Camera');
        if (!camNode) {
            console.warn('[Game] Main Camera not found — cannot frame the board');
            return;
        }
        const cam = camNode.getComponent(Camera);
        const fovDeg = cam ? cam.fov : 45;
        const dist = frameHeight / 2 / Math.tan(math.toRadian(fovDeg) / 2);
        camNode.setPosition(new Vec3(0, centerY, dist));
        camNode.setRotationFromEuler(0, 0, 0);
    }
}
