import {
    _decorator, Component, JsonAsset, resources, Node, Camera, find, Vec3, Color, Label,
    input, Input, EventTouch, EventMouse, geometry, tween, Mat4, assetManager, EffectAsset,
} from 'cc';
import {
    GameCore, validateLevel, LevelData, firstBlocker,
    DEFAULT_TRACK, TrackPath, TrackShape, TRACK_SHAPES, validateTrack,
} from '../core/index';
import { BoardLayout } from './board-layout';
import { colorOf } from './colors';
import { GridView } from './grid-view';
import { ParkingView } from './parking-view';
import { TrackView } from './track-view';
import { HudView } from './hud-view';
import { setupEnvironment } from './environment';
import { setupBackground, setupStage, setupRoads, lotHeight, lotWidth, RingRoad } from './scene-stage';
import { squash, flash, dustBurst, resetParticleBudget, stars, confetti } from './effects';
import { preloadCarModels } from './car-builder';
import { SfxManager } from './sfx';
import { vibrate } from './haptics';

const { ccclass, property } = _decorator;

/**
 * Delay between the boarding flights of one block. Small enough that the block is clearly
 * one event, large enough that eight people read as eight rather than one blob.
 *
 * 0.04 rather than the 0.07 it was at four-to-a-block: the whole flight takes
 * boardingDuration(), and the departure of the car that just filled waits for it (see the
 * tick loop). At 0.07 a block of eight would hold the car in its stall for 0.89s — nearly
 * three ticks, long enough for the core to hand that same stall to another car.
 */
const BOARD_STAGGER = 0.04;

/** How long one boarding figure's flight arc takes — shared with `playBoarding`'s tween. */
const BOARD_FLIGHT_TIME = 0.4;

/**
 * How long a row of `count` boarding flights takes from the first figure leaving to the
 * last one landing: the last flight starts after `count - 1` staggers and then takes
 * `BOARD_FLIGHT_TIME` itself. Shared by `playBoarding` (which starts the flights) and the
 * tick loop (which must not tear a car down before its own boarding flights land), so the
 * two can't drift apart.
 */
function boardingDuration(count: number): number {
    return (count - 1) * BOARD_STAGGER + BOARD_FLIGHT_TIME;
}

/**
 * The ring road around the lot and the routes cars drive on it. Its top lane is fixed
 * at ROAD_Y, just under the parking stalls (whose pads reach down to y = 0.87, and a
 * car on the lane spans about 0.025..0.575), and the LOT hangs one lane-width below
 * it — so a taller grid pushes the lot DOWN and the road never moves. A fixed lane
 * with a fixed lot was the bug this replaces: it cleared a 4-row lot and ran straight
 * through a 6-row one.
 *
 * RING_OFF is the gap from the lot's edge out to a lane centreline.
 *
 * Departures read as four beats — turn, pull out, turn, accelerate away — because a car that
 * simply translates off screen reads as flying, not driving. The car HOLDS STILL for
 * each turn (hence the delays matching TURN_TIME) so the change of heading is visible,
 * pulls out of the stall slowly enough to see, and leaves on `quadIn` so it speeds up
 * as it goes. An earlier attempt overlapped the turns with the movement and left on
 * `quadOut`, which meant it hit top speed the instant it cleared the stall and then
 * decelerated — indistinguishable from the slide it replaced.
 *
 * Every stall shares the parking row's y, so the pull-out is always the same distance
 * and a fixed duration is exactly consistent. The run across is 4 units from the
 * rightmost stall and 11 from the leftmost, so that leg goes at a fixed speed instead;
 * a fixed duration would read as two cars of very different power.
 */
const ROAD_Y = 0.3;
const ROAD_H = 0.9;
const RING_OFF = 0.62;

/**
 * The box the lot and its ring road have to live in, straight off the camera frame
 * (±4.90 across, ±6.21 down — see CAMERA_DIST). RING_LOW is the lowest a lane centreline
 * can sit with its outer edge still on screen, and LOT_HALF_W is what is left across once
 * a lane and its offset are taken off each side. A taller grid therefore takes a SMALLER
 * cell rather than hanging off the bottom, which is what a 6-row level used to do: its
 * ring reached y = -7.96.
 *
 * The lot slab is then drawn LOT_HALF_W wide whatever the grid needs, so it reaches the
 * edge of the view on both sides and the cars sit centred on it. The cell can't grow to
 * match: 6 rows in a 4.5-unit-tall budget is what fixes it, and only a taller view (a real
 * phone, rather than this squat preview window) changes that.
 */
const RING_LOW = -5.76;
const LOT_HALF_W = 3.83;
const CELL_MAX = 1.4;
/**
 * Bare board between one grid cell and the next. The visible gap between two cars nose to
 * tail is this PLUS the air a car leaves inside its own cell (see `fill` in car-builder), and
 * the pair have come down 0.22 -> 0.10 -> 0.03 on a cell of about 1.1. At 0.03 the cars very
 * nearly touch, which is what a full car park looks like.
 *
 * The cell's pitch is fixed by the height the lot has to fill, so what comes off the gap goes
 * to the cars: they are about a fifth longer than they were at 0.12. That is the trade this
 * knob makes -- a denser lot at the same size, not a smaller one.
 *
 * The gap SIDEWAYS between two cars is a separate thing and much bigger: a small car has a
 * one-cell square footprint, its model is about twice as long as it is wide, and it is scaled
 * uniformly to fit -- so it fills the cell along its length and leaves nearly half of it
 * across. Neither this nor `fill` reaches that; only a stubbier model or a non-uniform
 * stretch would.
 */
const CELL_GAP = 0.02;
const EXIT_X = 7.5;
const EXIT_TURN_TIME = 0.16;
const EXIT_SPEED = 8;

/** Speed a car drives from the lot to its stall, a touch brisker than a departure. */
const DRIVE_SPEED = 9;

/**
 * How much of its stall a parked car fills, across and along. A car is built to fit its
 * GRID cell, which is a different size - and on a tall level a much smaller one - so it is
 * refitted to the stall on arrival rather than scaled by a fixed factor, which is what left
 * level 2's parked cars half the size of level 1's. Along the stall it may overhang a
 * little: a long bus held strictly inside would be scaled down until it read as a toy.
 */
const STALL_FILL_W = 0.8;
const STALL_FILL_H = 1.02;

/**
 * Where the camera sits, in board units. CAMERA_Y is the midpoint of everything drawn
 * (circuit top to bottom ring lane) so the margins come out even.
 */
const CAMERA_Y = 0;
const CAMERA_DIST = 15;

/**
 * The blocked-tap nudge: the car drives at the thing in its way, both cars jolt, and it
 * reverses. A car that only shuddered in place said "no" without saying WHY — this points
 * at the obstacle, which is the one piece of information the player is missing.
 *
 * BUMP is how far past contact it presses, and it has to stay under the bare board between
 * two cars nose to tail (CELL_GAP plus what `fill` leaves, about 0.03 now). It was 0.06 back
 * when cars were drawn at 90% of their footprint and that slack was 0.22; at today's spacing
 * the same number would drive one car a clear 0.03 INTO the other. The jolt is what sells the
 * impact anyway -- see JOLT.
 *
 * The forward leg is capped: with a three-cell run-up, honest speed would make a refused tap
 * feel like a slow round trip.
 */
const NUDGE_SPEED = 5.5;
const NUDGE_MIN = 0.12;
const NUDGE_MAX = 0.35;
const BUMP = 0.02;
const JOLT = 0.07;

/**
 * Board-space unit vector a car with this heading drives along. Degrees, 0 = +X,
 * counter-clockwise -- core's convention, and the board's +Y is world +Y, so there is no
 * flip to apply. This replaces a four-entry lookup table that could only name four
 * directions.
 */
function headingVec(angle: number): Vec3 {
    const r = angle * Math.PI / 180;
    return new Vec3(Math.cos(r), Math.sin(r), 0);
}

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
    /** Seat chip on the UI layer; the label is its child, so destroying it takes both. */
    chip: Node | null;
    label: Label | null;
    /** Seats this car has. Captured on park, so reusing its slot can't confuse the display. */
    capacity: number;
    /**
     * Seat count the chip currently SHOWS, which lags the core on purpose. A
     * whole row boards in one tick, and jumping the number down by four while four
     * passengers are still in the air reads as the car emptying before anyone arrives.
     * `seatBoarded` walks this down one seat per landing flight instead.
     */
    shown: number;
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
    /** Lane centrelines of the ring road, rebuilt with the board (see buildBoard). */
    private ring: RingRoad = { left: -3, right: 3, top: ROAD_Y, bottom: -6 };
    /**
     * World units per board unit, so a blocked nudge can turn core's distance into a
     * screen distance. One board unit is the pitch the old grid used, so this is the same
     * number `gridStep` held and the arithmetic that reads it is unchanged.
     */
    private boardScale = 1;

    /**
     * Cars still driving to a stall. `busy` only locks taps for the first leg, so the
     * player can keep tapping while a car finishes its lap of the ring road; this keeps
     * the end-of-level banner from cutting an arrival short, which is what `busy` used
     * to cover when a drive was one short hop.
     */
    private arriving = 0;
    /**
     * Degrees the board leans back. Zero means the camera looks straight down the board's
     * normal — a flat, straight-on view, which is what the art is designed for. It was 52
     * for a 2.5D three-quarter look; the trade is that at zero the cars only ever show
     * their roofs, since the models stand along the board's +Z toward the camera.
     */
    private readonly BOARD_TILT = 0;

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
        // Then preload the car GLB models (buildCar is synchronous and needs the
        // prefab resident) before loading the level. Passengers are procedural
        // (pax-figure.ts) and need no preload of their own.
        this.preloadLitEffect(() => preloadCarModels(() => this.loadLevel(this.levelName)));
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
            if (e.chip) e.chip.destroy();
        }
        this.parked.clear();
        this.loadLevel(name);
    }

    private buildBoard(level: LevelData): void {
        const LOOP_Y = 3.8;
        // The parking band sits between the ring road's top lane (which ends at y = 0.75)
        // and the loop track's curb (whose shadow hangs down to y ~ 2.15); a stall 1.06 deep
        // centred here fills that band with a little margin at each end.
        const PARKING_Y = 1.4;

        // The lot hangs exactly one lane below the top road, so the road stays put and the
        // lot moves with the grid's size. The cell takes whichever budget is tighter — the
        // rows against the height left under the stalls, or the columns against the width —
        // and the slab is then widened to the full frame.
        const cell = Math.min(
            CELL_MAX,
            (ROAD_Y - 2 * RING_OFF - RING_LOW - 0.3) / level.lot.h - CELL_GAP,
            (2 * LOT_HALF_W - 0.3) / level.lot.w - CELL_GAP,
        );
        const scale = cell + CELL_GAP;
        this.boardScale = scale;
        const lotH = lotHeight(level.lot.h, scale);
        const lotW = Math.max(lotWidth(level.lot.w, scale), 2 * LOT_HALF_W);
        const GRID_Y = ROAD_Y - RING_OFF - lotH / 2;
        this.ring = {
            top: ROAD_Y,
            bottom: GRID_Y - lotH / 2 - RING_OFF,
            left: -lotW / 2 - RING_OFF,
            right: lotW / 2 + RING_OFF,
        };

        this.boardRoot = new Node('Board');
        this.boardRoot.setRotationFromEuler(-this.BOARD_TILT, 0, 0);
        this.node.addChild(this.boardRoot);
        setupEnvironment(this.boardRoot);
        setupBackground(this.boardRoot);
        setupStage(this.boardRoot, lotW, lotH, GRID_Y);
        setupRoads(this.boardRoot, this.ring, ROAD_H);

        const loopRoot = new Node('LoopRoot');
        this.boardRoot.addChild(loopRoot);
        const loop = this.core!.loop;
        // validateTrack is the drawability gate; the offline tool already fails the build
        // on it, so anything reaching here is either hand-edited or from an older file.
        for (const problem of validateTrack(level)) console.warn(`[track] ${problem}`);
        // buildShape's switch is exhaustive with no default, so an unrecognised shape would
        // crash rather than draw. The warn loop above has already said which field is wrong.
        const rawTrack = level.loop.track as TrackShape;
        const shape = TRACK_SHAPES.includes(rawTrack) ? rawTrack : DEFAULT_TRACK;
        this.loopView = new TrackView(
            loopRoot,
            new TrackPath(shape),
            // capacity and boardIndex are the same values on `level.loop` and on `loop`
            // (LoopSystem copies both at construction) -- read off whichever is already
            // in hand on each side of the comma.
            level.loop.capacity, loop.boardIndex,
            // The view gets core's already-normalised channel list, not the level's raw
            // `feeds`, so the two layers can't disagree about how many channels there
            // are or where each one joins (see Channel in core/loop-system.ts).
            loop.channels,
            LOOP_Y, this.TICK,
        );
        this.loopView.update(loop.ring, loop.channels);

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
        // Same pitch the lot was sized from, or the slab and its cars drift apart.
        const layout = new BoardLayout(scale);
        this.gridView = new GridView(gridRoot, this.core!.lot, layout);
        this.gridView.render();
    }

    private setupCamera(): void {
        const camNode = find('Main Camera');
        if (!camNode) {
            console.warn('[Game] Main Camera not found — cannot frame the board');
            return;
        }
        this.cam = camNode.getComponent(Camera);
        // Straight on, down the board's normal. At a 45-degree VERTICAL fov the visible
        // half-height is 0.414 * d, so 15 shows 6.21 above and below the board centre,
        // which takes the circuit's top edge (5.48) and the bottom ring lane (-6.15) and
        // still leaves 0.7 at the top for the HUD. Across, it shows 4.90 — the outermost
        // waiting rows sit at 4.65.
        //
        // (The tilted 2.5D framing this replaces was pos (0, 5, 12), lookAt (0, -0.3, 0),
        // and needs BOARD_TILT back at 52 to make sense.)
        camNode.setPosition(new Vec3(0, CAMERA_Y, CAMERA_DIST));
        camNode.lookAt(new Vec3(0, CAMERA_Y, 0));
        if (this.cam) {
            this.cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            // Matches the ground panel, so any sliver outside it doesn't flash a
            // different colour.
            this.cam.clearColor = new Color(205, 215, 236, 255);
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
            if (!this.busy && this.arriving === 0) this.onEnd(this.core.getState());
            return;
        }
        this.tickAcc += dt;
        while (this.tickAcc >= this.TICK) {
            this.tickAcc -= this.TICK;
            const res = this.core.stepLoop();
            const lp = this.core.loop;
            this.loopView?.update(lp.ring, lp.channels);
            this.hud?.setProgress(this.core.loop.remainingCount());
            this.syncSeatCounts();
            if (res.boardedColor) this.playBoarding(res.boardedColor, res.boardedSlots);
            if (res.departedCarIds.length > 0) {
                if (res.boardedColor) {
                    // This tick both boarded and departed: the departing car is exactly
                    // the one that just filled, so its passengers are still mid-flight
                    // (see playBoarding). Tearing it down now would destroy the seat
                    // chip they are about to land on and drive the car out from under
                    // them. Wait for the flights this tick actually started to land.
                    const ids = res.departedCarIds;
                    this.scheduleOnce(() => this.onDeparted(ids), boardingDuration(res.boardedSlots.length));
                } else {
                    // No boarding this tick (e.g. a zero-capacity car parked already
                    // full), so there is no flight to wait for — depart at once.
                    this.onDeparted(res.departedCarIds);
                }
            }
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
            if (e.chip) e.chip.destroy();
            // The departure this fires for can be deferred past a boarding flight (see
            // the tick loop), and by the time it runs the human may have tapped through
            // the win banner and switchTo rebuilt the board — which destroys this car's
            // node out from under the deferred call. Bail rather than touch it.
            if (!e.node.isValid) continue;
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
    /**
     * Turn a car's body to `to` over `dur`, taking the short way round, and answer the
     * angle it ends on so a caller chaining turns can carry the heading forward. The
     * angle is tweened as a plain number and written through `setRotationFromEuler`
     * (the same shape as the boarding arcs) rather than tweening the node's rotation.
     */
    private turnBody(body: Node | null, from: number, to: number, dur: number): number {
        const end = shortestAngle(from, to);
        if (body) {
            tween({ a: from })
                .to(dur, { a: end }, {
                    onUpdate: (t?: { a: number }) => {
                        // The tween targets a plain object, so it outlives the node on a
                        // restart mid-drive - bail once the body is gone.
                        if (!body.isValid) return;
                        body.setRotationFromEuler(0, 0, t ? t.a : end);
                    },
                })
                .start();
        }
        return end;
    }

    /**
     * Drive a car through `waypoints` at a constant speed, stopping to turn onto each leg
     * before driving it. Constant speed rather than a duration per leg: the legs of a lap
     * round the ring road differ by a factor of ten, and a fixed duration would read as
     * the car changing power at every corner.
     *
     * Turning in place at each corner is what makes the route read as driving rather than
     * sliding. The headings are worked out here at build time, because the whole route is
     * known up front - each `call` closes over the angles for its own corner.
     *
     * Legs shorter than a millimetre are dropped: a car leaving the lot already lined up
     * with its stall would otherwise get a zero-length leg, and facing a zero-length
     * direction snaps the body to a meaningless angle.
     */
    private driveRoute(
        node: Node, waypoints: Vec3[], speed: number,
        opts: {
            firstLegDone?: () => void;
            /** Fires as the car starts its last turn, i.e. once, on the final approach. */
            finalApproach?: () => void;
            done?: () => void;
        } = {},
    ): void {
        const body = node.getChildByName('body');
        let heading = body ? body.eulerAngles.z : 0;
        let prev = node.position.clone();
        const seq = tween(node);
        let legs = 0;
        for (let i = 0; i < waypoints.length; i++) {
            const wp = waypoints[i];
            const dx = wp.x - prev.x, dy = wp.y - prev.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 1e-3) continue;
            const face = Math.atan2(dy, dx) * 180 / Math.PI;
            const from = heading;
            heading = shortestAngle(from, face);
            const to = heading;
            const target = wp.clone();
            const last = i === waypoints.length - 1;
            if (last && opts.finalApproach) seq.call(opts.finalApproach);
            seq.call(() => this.turnBody(body, from, to, EXIT_TURN_TIME))
                .delay(EXIT_TURN_TIME)
                .to(dist / speed, { position: target }, { easing: last ? 'sineOut' : 'sineInOut' });
            if (legs === 0 && opts.firstLegDone) seq.call(opts.firstLegDone);
            prev = target;
            legs++;
        }
        // A route with nothing to drive still owes its caller the completion callback,
        // which is what hands the car over to the parked bookkeeping.
        if (legs === 0 && opts.firstLegDone) seq.call(opts.firstLegDone);
        if (opts.done) seq.call(opts.done);
        seq.start();
    }

    /**
     * Waypoints from a car's place in the lot to a parking stall: straight out along its own
     * heading until it meets a lane of the ring road, then round the ring to the top lane,
     * along that to the stall, then up into it.
     *
     * The target always sits on the top lane, since every stall is above it. So a car that
     * left by a side needs one corner and one that left by the bottom needs two, taking
     * whichever side it is already nearer.
     *
     * A diagonal heading needs no case of its own. Whichever RING LANE the car reaches
     * FIRST decides the lane it joins, and everything past that is the same corner-turning
     * the four-direction version did -- so what used to be four branches is now one
     * comparison feeding the same three.
     *
     * Note the first leg runs all the way to the LANE, not to the lot's edge. Stopping at
     * the edge is what the centre of the car crossing it means, so the body would still be
     * half inside the lot when the next leg turns it -- and in a lot packed to a clearance
     * of 0.04 board units, that pivot sweeps the car's rear through whoever is still parked
     * beside it. Measured over the ten shipped levels, 218 of 360 cars clipped a neighbour
     * that way; routing to the lane instead makes it none of them.
     *
     * Driving to the lane also makes the axis-aligned cars behave as they always did. Their
     * `out` lands ON the lane, so the corner waypoint that follows is the same point and
     * `driveRoute` drops the zero-length leg -- where stopping at the lot edge gave a
     * quarter of the cars a full braking stop and a 0.16s turn through zero degrees, a
     * pause you could see inside an exit that only lasts a third of a second.
     */
    private routeToSlot(from: Vec3, angle: number, slotX: number, parkY: number): Vec3[] {
        const r = this.ring;
        const z = from.z;
        const d = headingVec(angle);
        // Distance to each lane it is actually heading toward; Infinity when it is not
        // travelling that way at all, so `Math.min` ignores it.
        const tx = Math.abs(d.x) < 1e-6
            ? Infinity : ((d.x > 0 ? r.right : r.left) - from.x) / d.x;
        const ty = Math.abs(d.y) < 1e-6
            ? Infinity : ((d.y > 0 ? r.top : r.bottom) - from.y) / d.y;
        // Clamped at zero: a car somehow already past a lane would otherwise be sent back.
        const t = Math.max(0, Math.min(tx, ty));
        const out = new Vec3(from.x + d.x * t, from.y + d.y * t, z);
        const wp: Vec3[] = [out];
        if (ty <= tx) {
            if (d.y > 0) {
                wp.push(new Vec3(out.x, r.top, z));
            } else {
                const side = out.x < 0 ? r.left : r.right;
                wp.push(new Vec3(out.x, r.bottom, z));
                wp.push(new Vec3(side, r.bottom, z));
                wp.push(new Vec3(side, r.top, z));
            }
        } else {
            const side = d.x < 0 ? r.left : r.right;
            wp.push(new Vec3(side, out.y, z));
            wp.push(new Vec3(side, r.top, z));
        }
        wp.push(new Vec3(slotX, r.top, z));
        wp.push(new Vec3(slotX, parkY, z));
        return wp;
    }

    /**
     * Drive a full car out of its stall and away: down onto the top lane, then right
     * along it and off screen. Same primitive as the arrival, so both journeys turn and
     * accelerate the same way.
     */
    private playDriveOut(node: Node): void {
        const from = node.position.clone();
        this.driveRoute(node, [
            new Vec3(from.x, ROAD_Y, from.z),
            new Vec3(EXIT_X, ROAD_Y, from.z),
        ], EXIT_SPEED, { done: () => { if (node.isValid) node.destroy(); } });
    }

    /**
     * Fly the passengers that just boarded from the gap to their matching parked car,
     * one arc each, staggered so a row of four reads as four people getting on rather
     * than one thing moving. `slots` comes from the core (`BoardResult.boardedSlots`):
     * one parking slot per boarded passenger, in boarding order. A row can be partly
     * boarded when a car runs out of seats mid-row, and can legitimately split across
     * two cars of the same colour, so each figure flies to the car it actually boarded
     * rather than all of them flying to one shared match — and a car that fills (and
     * departs) on this very tick is still resolvable, because we read it from the
     * view's own `this.parked`, which core's departure this tick has not touched yet.
     */
    private playBoarding(color: string, slots: number[]): void {
        // Slot -> the view's own parked entry. Built once per call: `this.parked` is
        // keyed by car id, not slot, and several figures can resolve to the same car.
        const bySlot = new Map<number, ParkedCar>();
        for (const [, e] of this.parked) bySlot.set(e.slot, e);

        this.sfx?.play('board');
        // Without a track to fly from, nothing will land to walk the count down, so
        // apply the whole row at once rather than leaving the number stale.
        if (!this.loopView || !this.boardRoot) {
            for (const slot of slots) {
                const e = bySlot.get(slot);
                if (e) this.seatBoarded(e);
            }
            return;
        }

        const count = slots.length;
        for (let i = 0; i < count; i++) {
            // A slot with no view entry means the view already lost track of that car
            // (shouldn't happen) — skip that one figure rather than abandon the row, but
            // warn, since a silently dropped figure is otherwise the only symptom of a
            // view/core desync.
            const e = bySlot.get(slots[i]);
            if (!e) { console.warn(`[GameController] playBoarding: no view entry for slot ${slots[i]}`); continue; }
            const end = e.node.worldPosition.clone();
            // Leave from where this figure actually stood in the row, not the row centre.
            const start = this.loopView.boardingFigureWorldPos(i);
            const p = this.loopView.spawnPassenger(color);
            p.setWorldPosition(start);
            const ctrl = new Vec3(
                (start.x + end.x) / 2, Math.max(start.y, end.y) + 1.2, (start.z + end.z) / 2,
            );
            tween({ t: 0 })
                .delay(i * BOARD_STAGGER)
                .to(BOARD_FLIGHT_TIME, { t: 1 }, {
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

    /** Quick scale bump on a parked car's remaining-seats chip. */
    private bumpSeat(e: { chip: Node | null }): void {
        // The car may have departed while a boarding tween was still in flight, in
        // which case its chip is already destroyed.
        const chip = e.chip;
        if (!chip || !chip.isValid) return;
        tween(chip)
            .to(0.08, { scale: new Vec3(1.4, 1.4, 1.4) })
            .to(0.1, { scale: Vec3.ONE }, { easing: 'backOut' })
            .start();
    }

    /**
     * Hang a seat chip off the bottom edge of its stall: the anchor is a point on the
     * board, projected through the game camera into the UI camera's space. Anchoring to
     * the stall rather than to the car keeps every chip on one line - cars differ in
     * length, so hanging them off the car would leave the row of chips ragged.
     */
    private positionChip(chip: Node, slotIndex: number): void {
        if (!this.cam || !this.uiCam || !this.boardRoot || !this.parkingView || !this.hud) return;
        const local = this.parkingView.getChipAnchor(slotIndex);
        const world = Vec3.transformMat4(new Vec3(), local, this.boardRoot.worldMatrix);
        const screen = this.cam.worldToScreen(world, new Vec3());
        const ui = this.uiCam.screenToWorld(screen, new Vec3());
        chip.setWorldPosition(ui.x, ui.y - this.hud.seatChipHalfHeight, ui.z);
    }

    /**
     * Uniform scale that fits car `id`'s model into a parking stall. Read it BEFORE
     * `detachCar`, which drops the entry holding the car's fitted size.
     *
     * Never larger than 1: a stall (0.78 x 1.06) is deeper than a grid cell, so fitting a
     * SMALL car to it worked out at 1.9 -- the car nearly doubled as it drove up, which
     * reads as the wrong car arriving rather than as parking. This makes the refit a
     * shrink-only affair: a car that already fits keeps exactly the size it had in the
     * lot, and only the ones too big for the stall (a bus, whose two-cell footprint is
     * longer than the stall is deep) come down to fit.
     */
    private stallScale(id: number): number {
        const size = this.gridView!.getCarSize(id);
        if (!size || size.len <= 0 || size.wid <= 0) return 1;
        const slot = ParkingView.slotSize;
        return Math.min(
            1,
            (slot.w * STALL_FILL_W) / size.wid,
            (slot.h * STALL_FILL_H) / size.len,
        );
    }

    /**
     * Sync every parked car's seat chip with the core. The chip under the stall is the
     * only readout of how full a car is (the fill bar this used to drive is long gone).
     */
    private syncSeatCounts(): void {
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
            for (const [id] of this.core!.lot.cars) {
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

        const angle = this.core.lot.cars.get(id)?.angle ?? 0;
        const res = this.core.tapCar(id);
        if (res.ok) {
            this.playDriveToSlot(id, angle, res.slotIndex);
        } else if (res.reason === 'full') {
            this.playLotFull(id);
        } else {
            this.playShake(id);
        }
    }

    private playDriveToSlot(id: number, angle: number, slotIndex: number): void {
        const parkScale = this.stallScale(id); // before detachCar drops the car's size
        const node = this.gridView!.detachCar(id);
        if (!node) return;
        node.setParent(this.boardRoot!, true); // keep world position

        const start = node.position.clone();
        const slot = this.parkingView!.getSlotPosition(slotIndex);
        const route = this.routeToSlot(start, angle, slot.x, slot.y);

        this.busy = true;
        this.arriving++;
        // No passengers until it is actually in the stall. The core parked it on tap, so
        // without this the loop boards — and can fill and depart — a car still out on the
        // road, which stranded it in the stall showing Label's default text because its
        // slot had been freed (or reassigned) by the time it arrived.
        this.core!.parking.setReady(slotIndex, false);
        this.sfx?.play('drive');
        dustBurst(this.boardRoot!, start.clone());
        this.driveRoute(node, route, DRIVE_SPEED, {
            // Release the tap lock once the car is out of the lot rather than when it
            // parks: a lap of the ring road takes over a second, and locking taps for all
            // of it makes the board feel dead. The core parked the car on tap already, so
            // a second tap mid-drive is safe.
            firstLegDone: () => { this.busy = false; },
            // Refit to the stall on the final approach - the turn plus the hop up off the
            // lane, which is about as long as this tween. Doing it on the way OUT of the
            // lot (as an earlier version did) changes the car's size right beside its
            // siblings, which reads as a glitch rather than as parking.
            finalApproach: () => {
                tween(node)
                    .to(0.28, { scale: new Vec3(parkScale, parkScale, parkScale) },
                        { easing: 'sineOut' })
                    .start();
            },
            done: () => {
                this.arriving--;
                this.core!.parking.setReady(slotIndex, true);
                this.sfx?.play('park');
                const pc = this.core!.parking.parked[slotIndex];
                const capacity = pc ? pc.capacity : 0;
                const seat = this.hud && pc ? this.hud.newSeatChip(colorOf(pc.color)) : null;
                this.parked.set(id, {
                    node, slot: slotIndex, chip: seat ? seat.chip : null,
                    label: seat ? seat.label : null, capacity,
                    // Starts empty: a car is only ever parked with no passengers on it.
                    shown: capacity,
                });
                if (seat) this.positionChip(seat.chip, slotIndex);
                // Fill the seat count now instead of waiting for the next loop tick: a
                // tap that ends the game (deadlock) stops the ticks, which would leave
                // the chip showing Label's default 'label' text.
                this.syncSeatCounts();
            },
        });
    }

    /**
     * Two quick hops across `axis` and back, which is the visible half of a collision. The
     * three offsets sum to zero, so the node lands exactly where it started.
     */
    private jolt(node: Node, axis: Vec3): void {
        const out = new Vec3(axis.x * JOLT, axis.y * JOLT, 0);
        const back = new Vec3(-out.x * 2, -out.y * 2, 0);
        tween(node)
            .by(0.045, { position: out })
            .by(0.06, { position: back })
            .by(0.045, { position: out })
            .start();
    }

    /**
     * A tap refused because every stall is taken. The car cannot be the subject here: it
     * may have a perfectly clear lane, and driving it at a blocker that does not exist
     * would say the wrong thing. So the car only shudders in place, to answer the tap, and
     * the answer itself is three things pointing at the bay — its panel blinks, the cars
     * holding the stalls bob, and a toast says what to wait for.
     *
     * The parked cars bobbing is the part that carries the reasoning: they are why the bay
     * is full, and their seat chips already show how many passengers each still needs. The
     * toast names the way out for a player who has not yet worked out that a car leaves on
     * its own once it fills.
     */
    private playLotFull(id: number): void {
        const node = this.gridView!.getCarNode(id);
        if (!node) return;

        this.busy = true;
        vibrate('medium');
        this.jolt(node, new Vec3(1, 0, 0));

        // No `flash` on the tapped car, unlike playShake: emissive lives on the material
        // and litMaterial hands out one per COLOUR, so flashing this car glows every car
        // sharing its paint, the parked ones included. On a blocked tap that is cosmetic
        // noise; here it would light up a dozen cars that have nothing to do with why the
        // tap was refused.
        this.parkingView!.pulse();
        for (const e of this.parked.values()) {
            const body = e.node.getChildByName('body');
            if (body) squash(body);
        }
        this.hud?.showToast('车位已满', '等车坐满后会自动开走');
        this.scheduleOnce(() => { this.busy = false; }, 0.2);
    }

    /**
     * A refused tap. The car drives at whatever is in its way, both cars jolt on contact,
     * and it reverses into its slot.
     *
     * Only reached for a BLOCKED lane now — a full bay has its own answer, see
     * `playLotFull`. The no-blocker branch stays as a guard: core has said the lane is
     * blocked, and if the view cannot work out what by, a shudder still answers the tap.
     */
    private playShake(id: number): void {
        const node = this.gridView!.getCarNode(id);
        const body = this.gridView!.getCarBody(id);
        if (!node) return;

        const car = this.core!.lot.cars.get(id);
        const lot = this.core!.lot;
        const block = car
            ? firstBlocker(car, Array.from(lot.cars.values()), lot.bounds)
            : null;

        this.busy = true;
        const hit = new Color(255, 96, 96);

        if (!block || !car) {
            if (body) flash(body, hit);
            vibrate('medium');
            this.jolt(node, new Vec3(1, 0, 0));
            this.scheduleOnce(() => { this.busy = false; }, 0.2);
            return;
        }

        const dir = headingVec(car.angle);
        // `block.gap` is board units and `boardScale` is world units per board unit, which
        // is the same arithmetic this line always did -- one board unit is one old cell
        // pitch, so only the names changed.
        const dist = block.gap * this.boardScale + BUMP;
        const time = Math.min(NUDGE_MAX, Math.max(NUDGE_MIN, dist / NUDGE_SPEED));
        const start = node.position.clone();
        const target = new Vec3(start.x + dir.x * dist, start.y + dir.y * dist, start.z);
        // Jolt across the direction of travel: a head-on bump shoves cars sideways.
        const across = new Vec3(-dir.y, dir.x, 0);
        const other = this.gridView!.getCarNode(block.carId);
        const otherBody = this.gridView!.getCarBody(block.carId);

        // The mover's own jolt is inlined into its chain rather than calling jolt(): a
        // second tween on the same node would fight the drive-and-reverse tween.
        const out = new Vec3(across.x * JOLT, across.y * JOLT, 0);
        const back = new Vec3(-out.x * 2, -out.y * 2, 0);
        tween(node)
            .to(time, { position: target }, { easing: 'quadIn' })
            .call(() => {
                vibrate('medium');
                if (body) { squash(body); flash(body, hit); }
                if (otherBody) { squash(otherBody); flash(otherBody, hit); }
                if (other) this.jolt(other, across);
            })
            .by(0.045, { position: out })
            .by(0.06, { position: back })
            .by(0.045, { position: out })
            .to(time * 0.9, { position: start }, { easing: 'sineOut' })
            .call(() => { this.busy = false; })
            .start();
    }
}
