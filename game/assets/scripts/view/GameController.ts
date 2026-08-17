import {
    _decorator, Component, JsonAsset, resources, Node, Camera, find, Vec3, Color, Label,
    input, Input, EventTouch, EventMouse, geometry, tween, Mat4, assetManager, EffectAsset,
} from 'cc';
import { GameCore, validateLevel, LevelData, Dir } from '../core/index';
import { GridLayout } from './grid-layout';
import { GridView } from './grid-view';
import { ParkingView } from './parking-view';
import { TrackView } from './track-view';
import { HudView } from './hud-view';
import { setupEnvironment } from './environment';
import { setupBackground, setupStage } from './scene-stage';
import { squash, flash, dustBurst, overshoot, resetParticleBudget, stars, confetti } from './effects';
import { preloadCarModels } from './car-builder';
import { preloadPassengerModel } from './passenger-builder';
import { SfxManager } from './sfx';
import { vibrate } from './haptics';

const { ccclass, property } = _decorator;

/**
 * Delay between the boarding flights of one row. Small enough that a row of four is
 * clearly one event, large enough that four people read as four rather than one blob.
 */
const BOARD_STAGGER = 0.07;

/**
 * Route a full car takes out of its stall: straight down into the empty corridor
 * between the parking row (y = 1.2) and the lot (y = -3.2), then right and off screen.
 *
 * Read as four beats — turn, pull out, turn, accelerate away — because a car that
 * simply translates off screen reads as flying, not driving. The car HOLDS STILL for
 * each turn (hence the delays matching TURN_TIME) so the change of heading is visible,
 * pulls out of the stall slowly enough to see, and leaves on `quadIn` so it speeds up
 * as it goes. An earlier attempt overlapped the turns with the movement and left on
 * `quadOut`, which meant it hit top speed the instant it cleared the stall and then
 * decelerated — indistinguishable from the slide it replaced.
 *
 * Every stall shares the parking row's y, so the pull-out is always the same 1.3 units
 * and a fixed duration is exactly consistent. The run across is 4 units from the
 * rightmost stall and 11 from the leftmost, so that leg goes at a fixed speed instead;
 * a fixed duration would read as two cars of very different power.
 */
const EXIT_LANE_Y = -0.1;
const EXIT_X = 7.5;
const EXIT_TURN_TIME = 0.16;
const EXIT_DOWN_TIME = 0.4;
const EXIT_SPEED = 8;

/** Body angle (degrees about the board normal) for a car heading down / to the right. */
const FACE_DOWN = 270;
const FACE_RIGHT = 0;

/** `to`, rewritten as the nearest equivalent angle to `from`, so a turn takes the short way. */
function shortestAngle(from: number, to: number): number {
    return from + ((((to - from) % 360) + 540) % 360) - 180;
}

/** A car sitting in a parking stall, with everything the display needs. */
interface ParkedCar {
    node: Node;
    slot: number;
    label: Label | null;
    /** Seats this car has. Captured on park, so reusing its slot can't confuse the display. */
    capacity: number;
    /**
     * Seat count the label and bar currently SHOW, which lags the core on purpose. A
     * whole row boards in one tick, and jumping the number down by four while four
     * passengers are still in the air reads as the car emptying before anyone arrives.
     * `seatBoarded` walks this down one seat per landing flight instead.
     */
    shown: number;
}

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
 * on tap once a level ends either advances to the next level (on a win) or
 * replays the current one (on a deadlock, or at the end of the level series).
 */
@ccclass('GameController')
export class GameController extends Component {
    @property
    levelName: string = 'level-1';

    private core: GameCore | null = null;
    private gridView: GridView | null = null;
    private parkingView: ParkingView | null = null;
    private loopView: TrackView | null = null;
    private hud: HudView | null = null;
    private cam: Camera | null = null;
    private uiCam: Camera | null = null;
    private boardRoot: Node | null = null;
    private gridRoot: Node | null = null;
    private sfx: SfxManager | null = null;
    private readonly BOARD_TILT = 52; // degrees, tilt the board back for a 2.5D look

    private busy = false;
    private ended = false;
    private loading = false;
    private tickAcc = 0;
    // Seconds per loop step: one slot of ring rotation, and one row's worth of boarding
    // per TICK. Raised from 0.18 to slow the carousel further after the first preview.
    // The carousel runs continuous motion without a beat; what fixed boarding reading
    // (passengers not vanishing) was flying the same figure the track itself draws, one
    // per seat taken, staggered by BOARD_STAGGER.
    private readonly TICK = 0.34;
    private parked = new Map<number, ParkedCar>();

    start() {
        this.sfx = new SfxManager(this.node);
        this.setupCamera();
        const canvas = find('Canvas');
        if (canvas) {
            this.hud = new HudView(canvas);
            this.uiCam = canvas.getComponentInChildren(Camera);
        } else {
            console.warn('[Game] Canvas not found — HUD disabled. Create a Canvas node named "Canvas".');
        }
        this.registerInput();
        // Preload builtin-standard so lit materials get real lighting; it lives in
        // the `internal` bundle but isn't preloaded unless something already uses it.
        // litMaterial falls back to unlit if this doesn't register, so proceed regardless.
        // Then preload the car and passenger GLB models (buildCar/buildPassenger are
        // synchronous and need the prefabs resident) before loading the level.
        this.preloadLitEffect(() => preloadCarModels(
            () => preloadPassengerModel(() => this.loadLevel(this.levelName)),
        ));
    }

    /** Load the builtin-standard EffectAsset (internal bundle addresses it by uuid), then continue. */
    private preloadLitEffect(done: () => void): void {
        if (EffectAsset.get('builtin-standard')) { done(); return; }
        // Fixed engine uuid for effects/builtin-standard.effect.
        const uuid = 'c8f66d17-351a-48da-a12c-0212d28575c4';
        assetManager.loadAny({ uuid }, (err) => {
            if (err) console.warn('[Game] builtin-standard preload failed, using flat shading:', err);
            done();
        });
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    }

    /**
     * Name of the level after the current one, or null if there isn't one. Levels are
     * a numeric series in `resources/levels` (`level-1`, `level-2`, …), so the next one
     * is the same name with its trailing number bumped — existence is checked against
     * the bundle's index (`getInfoWithPath`, no load, no console error) so adding a
     * `level-3.json` extends the chain with no code change. A level name without a
     * trailing number (hand-set in the inspector) has no successor.
     */
    private nextLevelName(): string | null {
        const m = /^(.*?)(\d+)$/.exec(this.levelName);
        if (!m) return null;
        const next = `${m[1]}${parseInt(m[2], 10) + 1}`;
        return resources.getInfoWithPath(`levels/${next}`, JsonAsset) ? next : null;
    }

    private loadLevel(name: string): void {
        this.loading = true;
        this.levelName = name; // tracks the level in play, so nextLevelName() advances from it
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
            // Old board (and any in-flight particles parented to it) is destroyed
            // on restart without running killParticle, so reset the budget here.
            resetParticleBudget();
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

    /** Tear the current board down and load `name` — used for both replay and advancing. */
    private switchTo(name: string): void {
        // Stop the track's phase tween before its cluster nodes are destroyed
        // (the tween targets a plain object, so node destruction won't stop it).
        this.loopView?.destroy();
        if (this.boardRoot) {
            this.boardRoot.destroy();
            this.boardRoot = null;
        }
        for (const [, e] of this.parked) {
            if (e.label) e.label.node.destroy();
        }
        this.parked.clear();
        this.loadLevel(name);
    }

    private buildBoard(level: LevelData): void {
        const LOOP_Y = 3.8;
        const PARKING_Y = 1.2;
        const GRID_Y = -3.2;

        this.boardRoot = new Node('Board');
        this.boardRoot.setRotationFromEuler(-this.BOARD_TILT, 0, 0);
        this.node.addChild(this.boardRoot);
        setupEnvironment(this.boardRoot);
        setupBackground(this.boardRoot);
        setupStage(this.boardRoot, level.grid.cols, level.grid.rows, GRID_Y);

        const loopRoot = new Node('LoopRoot');
        this.boardRoot.addChild(loopRoot);
        const loop = this.core!.loop;
        this.loopView = new TrackView(loopRoot, level.loop.capacity, LOOP_Y, this.TICK, {
            board: loop.boardIndex, left: loop.entryLeft, right: loop.entryRight,
        });
        this.loopView.update(loop.ring, loop.left, loop.right);

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
        if (!this.core || this.ended) return;
        // A tap can end the game too: parking into the last free slot can seal the
        // level (nothing left to fill the parked cars, nothing left that can move).
        // The old guard returned here without ever calling onEnd, so a tap-induced
        // deadlock left the game silently frozen with no banner. Wait for an
        // in-flight park animation to land first so the banner doesn't cut it off.
        if (this.core.getState() !== 'playing') {
            if (!this.busy) this.onEnd(this.core.getState());
            return;
        }
        this.tickAcc += dt;
        while (this.tickAcc >= this.TICK) {
            this.tickAcc -= this.TICK;
            const res = this.core.stepLoop();
            const lp = this.core.loop;
            this.loopView?.update(lp.ring, lp.left, lp.right);
            this.hud?.setProgress(this.core.loop.remainingCount());
            this.updateFillBars();
            if (res.boardedColor) this.playBoarding(res.boardedColor, res.boardedCount);
            if (res.departedCarIds.length > 0) this.onDeparted(res.departedCarIds);
            if (this.core.getState() !== 'playing') {
                this.onEnd(this.core.getState());
                break;
            }
        }
    }

    private onDeparted(ids: number[]): void {
        if (ids.length > 0) {
            this.sfx?.play('depart');
            vibrate('medium');
        }
        for (const id of ids) {
            const e = this.parked.get(id);
            if (!e) continue;
            this.parked.delete(id);
            if (e.label) e.label.node.destroy();
            // A departing car is exactly one that just filled up (the core boards +
            // removes a full car in the same tick), so the "full" highlight belongs
            // here: pulse the car green and burst stars as it drives off.
            flash(e.node, new Color(120, 255, 140));
            if (this.boardRoot) {
                stars(this.boardRoot, e.node.position.clone(), [
                    new Color(255, 210, 60), new Color(120, 255, 140), new Color(90, 170, 255),
                ]);
            }
            this.playDriveOut(e.node);
        }
    }

    /**
     * Drive a full car out of its stall instead of sliding it away: down into the
     * corridor below the parking row, then right and off screen, turning to face each
     * leg. It used to slide straight up by 9 units, which sent it back over the loop it
     * had just been loaded from and read as vanishing rather than leaving.
     *
     * The turns tween a plain angle and write it through `setRotationFromEuler`, the
     * same shape as the boarding arcs — the car's heading lives on its `body` child
     * (see car-builder), which is also what carries the roof arrow.
     */
    private playDriveOut(node: Node): void {
        const body = node.getChildByName('body');
        const turn = (from: number, to: number, dur: number): number => {
            const end = shortestAngle(from, to);
            if (body) {
                tween({ a: from })
                    .to(dur, { a: end }, {
                        onUpdate: (t?: { a: number }) => {
                            // The tween targets a plain object, so it outlives the node
                            // on a restart mid-drive — bail once the body is gone.
                            if (!body.isValid) return;
                            body.setRotationFromEuler(0, 0, t ? t.a : end);
                        },
                    })
                    .start();
            }
            return end;
        };

        const from = node.position.clone();
        const corner = new Vec3(from.x, EXIT_LANE_Y, from.z);
        const exit = new Vec3(EXIT_X, EXIT_LANE_Y, from.z);
        const across = Math.abs(exit.x - corner.x) / EXIT_SPEED;

        const heading = turn(body ? body.eulerAngles.z : 0, FACE_DOWN, EXIT_TURN_TIME);
        tween(node)
            .delay(EXIT_TURN_TIME)                                        // turn in place
            .to(EXIT_DOWN_TIME, { position: corner }, { easing: 'sineInOut' })  // pull out
            .call(() => turn(heading, FACE_RIGHT, EXIT_TURN_TIME))
            .delay(EXIT_TURN_TIME)                                        // turn in place
            .to(across, { position: exit }, { easing: 'quadIn' })         // accelerate off
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }

    /**
     * Fly the passengers that just boarded from the gap to their matching parked car,
     * one arc each, staggered so a row of four reads as four people getting on rather
     * than one thing moving. `count` comes from the core: a row can be partly boarded
     * when the car runs out of seats mid-row.
     *
     * All of them fly to the first matching car even in the rare case where the core
     * split the row across two cars of the same colour. Only the arcs would differ —
     * the seat numbers come from `updateFillBars`, which reads the core.
     */
    private playBoarding(color: string, count: number): void {
        let match: ParkedCar | null = null;
        for (const [, e] of this.parked) {
            if (this.core!.parking.parked[e.slot]?.color === color) { match = e; break; }
        }
        if (!match) return;
        const e = match;

        this.sfx?.play('board');
        // Without a track to fly from, nothing will land to walk the count down, so
        // apply the whole row at once rather than leaving the number stale.
        if (!this.loopView || !this.boardRoot) {
            for (let i = 0; i < count; i++) this.seatBoarded(e);
            return;
        }

        const end = e.node.worldPosition.clone();
        for (let i = 0; i < count; i++) {
            // Leave from where this figure actually stood in the row, not the row centre.
            const start = this.loopView.boardingFigureWorldPos(i, count);
            const p = this.loopView.spawnPassenger(color);
            p.setWorldPosition(start);
            const ctrl = new Vec3(
                (start.x + end.x) / 2, Math.max(start.y, end.y) + 1.2, (start.z + end.z) / 2,
            );
            tween({ t: 0 })
                .delay(i * BOARD_STAGGER)
                .to(0.4, { t: 1 }, {
                    onUpdate: (target?: { t: number }) => {
                        // The tween targets a plain object, so a restart mid-flight won't
                        // stop it — bail if the passenger node was already destroyed.
                        if (!p.isValid) return;
                        const t = target ? target.t : 1;
                        const u = 1 - t;
                        const x = u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x;
                        const y = u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y;
                        const z = u * u * start.z + 2 * u * t * ctrl.z + t * t * end.z;
                        p.setWorldPosition(new Vec3(x, y, z));
                    },
                })
                .call(() => { if (p.isValid) p.destroy(); this.seatBoarded(e); })
                .start();
        }
    }

    /** Quick scale bump on a parked car's remaining-seats label. */
    private bumpSeat(e: { label: Label | null }): void {
        // The car may have departed while a boarding tween was still in flight,
        // in which case its label component is destroyed and its `.node` is null.
        const label = e.label;
        if (!label || !label.isValid || !label.node || !label.node.isValid) return;
        tween(label.node)
            .to(0.08, { scale: new Vec3(1.4, 1.4, 1.4) })
            .to(0.1, { scale: Vec3.ONE }, { easing: 'backOut' })
            .start();
    }

    /** Project a car's world position to the UI layer and place a label there. */
    private positionLabelOverCar(label: Label, carNode: Node): void {
        if (!this.cam || !this.uiCam) return;
        const screen = this.cam.worldToScreen(carNode.worldPosition, new Vec3());
        const uiWorld = this.uiCam.screenToWorld(screen, new Vec3());
        label.node.setWorldPosition(uiWorld);
    }

    /** A thin bar under each parked car showing filled / capacity. */
    /**
     * Sync every parked car's seat readout with the core. Named for the fill bars it
     * used to drive: those are gone, and the outlined number over the car is now the
     * only readout of how full it is.
     */
    private updateFillBars(): void {
        for (const [id, e] of this.parked) {
            const pc = this.core!.parking.parked[e.slot];
            if (!pc || pc.carId !== id) continue;
            // The display lags the core on purpose (see ParkedCar.shown), so never pull
            // it DOWN to the truth here — the landing flights do that one seat at a
            // time. Only push it up, which self-heals a flight that never landed
            // (a restart mid-air) rather than leaving the car showing too few seats.
            const truth = pc.capacity - pc.filled;
            if (e.shown < truth) e.shown = truth;
            this.renderSeats(e);
        }
    }

    /** Paint one car's seat readout from the seat count it is showing. */
    private renderSeats(e: ParkedCar): void {
        if (e.label && e.label.isValid) e.label.string = `${e.shown}`;
    }

    /** One passenger just landed: tick the count down a single seat and pop the label. */
    private seatBoarded(e: ParkedCar): void {
        e.shown = Math.max(0, e.shown - 1);
        this.renderSeats(e);
        this.bumpSeat(e);
    }

    private onEnd(state: string): void {
        this.ended = true;
        if (state === 'won') {
            if (this.boardRoot) {
                confetti(this.boardRoot, new Vec3(0, 1, 0));
                stars(this.boardRoot, new Vec3(0, 1, 0), [
                    new Color(255, 210, 60), new Color(120, 255, 140), new Color(90, 170, 255),
                ]);
            }
            // Star rating is a placeholder (always 3): a real rule based on
            // moves/time/powerups is deferred — not computed by the core.
            // `hasNext` only picks the banner's call-to-action; the tap handler
            // re-resolves the next level, so the two can't disagree.
            this.hud?.showWin(3, this.nextLevelName() !== null);
        } else {
            // Deadlock: highlight every remaining stuck car on the grid.
            for (const [id] of this.core!.grid.cars) {
                const body = this.gridView?.getCarBody(id);
                if (body) flash(body, new Color(255, 80, 80));
            }
            this.hud?.showLose();
        }
        this.sfx?.play(state === 'won' ? 'win' : 'lose');
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
            // Won and another level exists → advance. Deadlocked, or the series has
            // run out → replay the same level.
            const next = this.core?.getState() === 'won' ? this.nextLevelName() : null;
            this.switchTo(next ?? this.levelName);
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

        this.sfx?.play('tap');
        vibrate('light');

        const body = this.gridView.getCarBody(id);
        if (body) squash(body);

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
        this.sfx?.play('drive');
        dustBurst(this.boardRoot!, start.clone());
        tween(node)
            .to(0.12, { position: nudge }, { easing: 'quadIn' })
            .call(() => {
                tween(node).to(0.28, { scale: new Vec3(0.55, 0.55, 0.55) }).start();
                overshoot(node, slot, 0.28, () => {
                    this.busy = false;
                    this.sfx?.play('park');
                    const label = this.hud ? this.hud.newSeatLabel() : null;
                    const pc = this.core!.parking.parked[slotIndex];
                    const capacity = pc ? pc.capacity : 0;
                    this.parked.set(id, {
                        node, slot: slotIndex, label, capacity,
                        // Starts empty: a car is only ever parked with no passengers on it.
                        shown: capacity,
                    });
                    if (label) this.positionLabelOverCar(label, node);
                    // Fill the seat count / bar now instead of waiting for the next
                    // loop tick: a tap that ends the game (deadlock) stops the ticks,
                    // which would leave this car showing Label's default 'label' text.
                    this.updateFillBars();
                });
            })
            .start();
    }

    private playShake(id: number): void {
        const node = this.gridView!.getCarNode(id);
        const body = this.gridView!.getCarBody(id);
        if (!node) return;
        if (body) flash(body);
        vibrate('medium');
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
