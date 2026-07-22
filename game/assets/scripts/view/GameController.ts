import { _decorator, Component, JsonAsset, resources } from 'cc';
import { GameCore, validateLevel, LevelData } from '../core/index';

const { ccclass, property } = _decorator;

/**
 * M2.1 checkpoint 1: loads a level JSON from resources, validates it, builds a
 * GameCore, and logs a summary. Rendering is added in later M2.1 steps.
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
        });
    }
}
