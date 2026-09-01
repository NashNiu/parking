import {
    _decorator, Component, JsonAsset, resources, Node, Camera, find, Vec3, Color, Label,
    input, Input, EventTouch, EventMouse, EventKeyboard, KeyCode, geometry, tween, Mat4,
    assetManager, EffectAsset, screen,
} from 'cc';
import {
    GameCore, validateLevel, LevelData, firstBlocker, LANE, carBox, CAP_BOX, CAR_SCALE,
    DEFAULT_TRACK, TrackPath, TrackShape, TRACK_SHAPES, validateTrack,
} from '../core/index';
import { BoardLayout } from './board-layout';
import { buildFootprintOverlay } from './debug-overlay';
import { colorOf } from './colors';
import { GridView } from './grid-view';
import { bayPanelSize, ParkingView, stallFootprint } from './parking-view';
import { TrackView, trackReach, leftLaneFloor } from './track-view';
import { HudView } from './hud-view';
import { setupEnvironment } from './environment';
import { setupBackground, setupStage, setupRoads, lotHeight, lotWidth, RingRoad } from './scene-stage';
import { squash, flash, dustBurst, resetParticleBudget, stars, confetti } from './effects';
import { preloadCarModels } from './car-builder';
import { SfxManager } from './sfx';
import { vibrate } from './haptics';

const { ccclass, property } = _decorator;

/**
 * Which build this is. Bumped by hand with every change worth checking on a device, and
 * printed both to the console and into the HUD's bottom-left corner.
 *
 * Hand-maintained because nothing in the pipeline can do it: the Cocos build stamps nothing
 * into the code, and every automatic candidate (level data, passenger counts) turned out to
 * be identical across the very builds that needed telling apart. A number that is wrong when
 * I forget to bump it is still worth more than no number at all -- it can only ever say a
 * package is OLDER than expected, never newer, so the failure is safe.
 */
/**
 * A millisecond clock for the on-screen tick timer.
 *
 * `performance.now()` where the runtime has it (sub-millisecond, and monotonic, so a clock
 * change cannot produce a negative duration) and `Date.now()` where it does not -- the
 * WeChat mini-game adapter usually provides `performance`, but not on every base library,
 * and a missing global here would take the whole controller down rather than one readout.
 */
const nowMs: () => number =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? () => performance.now()
        : () => Date.now();

const BUILD_TAG = 'build 0901-11';

/**
 * A one-line fingerprint of the level data that ACTUALLY arrived, stamped next to the build
 * tag. It answers a question two rounds of debugging could not: the phone showed a level 1
 * painted in two colours while the build tag said the code was current, and the two
 * explanations -- old JSON in the package, or new JSON drawn wrong -- look identical on
 * screen. They stop looking identical the moment the data says how many colours it holds.
 *
 * Level 1's two versions are otherwise indistinguishable: byte-for-byte the same 36 cars at
 * the same positions, angles and capacities, and the same 744 passengers. ONLY the colour
 * strings differ, which is exactly why nothing already on screen could tell them apart.
 */
function levelStamp(level: LevelData, uuid: string): string {
    const colors = new Set(level.lot.cars.map((c) => c.color));
    const pax = level.loop.queue.reduce((n, g) => n + g.count, 0);
    // The ring length is in here because it is currently the thing being experimented with:
    // level 1 is hand-set to 48 cells so the rows sit against each other with no seam, and
    // "did the device get that level" is otherwise not a question the screen can answer.
    return `L${level.id} ${colors.size}c ${pax}p ${level.loop.capacity}r `
        + `${Array.from(colors).join('/')} #${uuid.slice(0, 8)}`;
}

/**
 * Delay between the boarding flights of one block. Small enough that the block is clearly
 * one event, large enough that eight people read as eight rather than one blob.
 *
 * What actually pins it is a RATIO, not a duration. The whole flight takes
 * boardingDuration(), and the departure of the car that just filled waits for it (see the
 * tick loop) -- so what matters is how many ticks that wait spans. A row of four spans about
 * 1.5 of them; push it near three and the core has time to hand the same stall to another
 * car while the view still holds the old one, and two view entries share a slot.
 *
 * So when TICK halved, these halved with it: 0.04 -> 0.02 and 0.40 -> 0.20 keeps
 * boardingDuration(4)/TICK at 1.53, exactly what it was before the carousel sped up. The
 * speed button divides all three by the same number again, for the same reason.
 */
const BOARD_STAGGER = 0.02;

/** How long one boarding figure's flight arc takes — shared with `playBoarding`'s tween. */
const BOARD_FLIGHT_TIME = 0.2;

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
 * There used to be a second, much bigger gap SIDEWAYS between two cars, which neither this
 * nor the old `fill` could reach: a small car had a one-cell SQUARE footprint and a model
 * about twice as long as it was wide, so scaling it uniformly filled the cell along its
 * length and left nearly half of it across. That is gone -- a car's footprint is its body
 * now, at whatever angle it is parked, so there is no cell for it to rattle around in and
 * nothing here to reach.
 *
 * What this constant still does is set the board's scale: it is subtracted from the pitch
 * the lot's height allows, and the remainder is the world size of one board unit. Cars are
 * spaced by core's CLEARANCE, not by this.
 */
const CELL_GAP = 0.02;
const EXIT_X = 7.5;
const EXIT_TURN_TIME = 0.16;
const EXIT_SPEED = 8;

/**
 * Speed a car drives from the lot to its stall, a touch brisker than a departure.
 *
 * The FLOOR, not the whole story -- see `driveSpeedFor`. At a flat 9 the arrival took a
 * median of 2.14s and up to 3.93s across the ten shipped levels (1840 car/stall routes),
 * and 57% of them ran over two seconds. That is 12 to 23 carousel ticks of watching a car
 * drive, which is the wait the human reported.
 */
const DRIVE_SPEED = 14;

/**
 * The driving part of an arrival is squeezed toward this many seconds, and no car drives
 * more than `DRIVE_SPEED_MAX_MULT` times the base to get there.
 *
 * A route's length is set by where the car happened to be parked and which stall it drew,
 * so at a single speed the wait varies by a factor of five -- and the long ones are the ones
 * that read as broken. Scaling per ROUTE (not per leg -- see `driveRoute`) collapses that:
 * measured over the same 1840 routes, min 0.84->0.53s, median 2.14->1.30s, max 3.93->1.76s.
 * The multiplier cap is what keeps the far cars looking like cars: uncapped, the longest
 * route wants 28 units a second against a base of 14.
 */
const DRIVE_TIME_MAX = 0.9;
const DRIVE_SPEED_MAX_MULT = 1.6;

/**
 * The pause a car holds at each corner of an ARRIVAL, shorter than a departure's
 * EXIT_TURN_TIME. A departure is one turn the player is watching; an arrival can have five,
 * and five held beats is a third of a second of a car standing still on a route the player
 * is waiting out.
 */
const ARRIVE_TURN_TIME = 0.1;

/**
 * How far toward the camera a car rides while it is out on the ring road, in board units.
 *
 * The side lanes run at `driveSideX` = 4.28 while the outermost parked cars reach 4.19, so a
 * car driving down the side overlaps them by 0.23 of its 0.65 width -- and there is no lane
 * position that avoids it: the frame ends at 4.67, leaving 0.48 of room. (Backing the
 * lane out to the drawn 4.98 puts 0.016 of the car on screen; that was the previous state.)
 * Since the overlap is forced, this decides how it READS: at the same z the two bodies
 * intersect, which is the same interpenetration the crowd had; lifted clear of any roof, the
 * moving car passes cleanly IN FRONT, like a road nearer the viewer. Orthographic camera, so
 * this costs nothing on screen -- it only settles who occludes whom.
 *
 * Applied from the moment the car leaves the lot. The exit leg is clear ground by
 * construction (core only allows a tap whose corridor is empty), so nothing is being driven
 * over on the way out.
 */
const DRIVE_LIFT = 1.2;

/**
 * How much of its stall a parked car may fill, across and along -- the ceiling `stallScale`
 * enforces, not a target it aims for.
 *
 * With the stall now sized off `CAP_BOX.big` (see `stallFootprint`), no car reaches either
 * ceiling: the biggest one comes to 75% of the width against this 80%, and 90% of the depth
 * against this 102%. That headroom is the point. It is what makes `stallScale` come out at
 * exactly 1 for every capacity, so a parked car keeps the size it had in the lot -- and it
 * is the margin a re-exported model can drift into without silently shrinking cars again.
 *
 * Along the stall a car may overhang slightly (hence 1.02 rather than 1.00): a long bus
 * held strictly inside would be scaled down until it read as a toy.
 */
const STALL_FILL_W = 0.8;
const STALL_FILL_H = 1.02;

const CAMERA_DIST = 15;

/**
 * Aspect of the editor preview window, and the only thing every framing constant in this
 * file was ever chosen against. Used solely as the assumption when the real window has not
 * reported a size yet -- see `viewFrame`.
 */
const PREVIEW_ASPECT = 0.79;

/**
 * The LEAST the camera shows vertically: exactly what a 45-degree vertical fov showed at
 * CAMERA_DIST on the board plane, which is why every framing constant derived from that
 * perspective frame. It is the FLOOR the fit starts from, not the final value: on a
 * viewport too narrow to hold the board it is not enough, and on one much taller than the
 * board the layout spends the difference. See `viewFrame` and `fitCamera`.
 */
const VIEW_HALF_H = CAMERA_DIST * Math.tan((45 / 2) * Math.PI / 180);

/**
 * Draw core's footprints and lane bars from the moment a level loads, and log what core
 * decided on every tap. DIAGNOSTIC ONLY -- set back to false once the lot's verdicts have
 * been confirmed against it. `D` toggles it either way at runtime; this is only the state
 * it starts in, so that reading it never depends on the preview having keyboard focus.
 */
const DEBUG_FOOTPRINTS = false;

/**
 * Seconds a startup preload gets before the game goes on without it.
 *
 * Both preloads already degrade gracefully when an asset ERRORS -- litMaterial falls back
 * to flat shading, buildCar falls back to a plain coloured box. Neither degraded when a
 * load simply never called back, and a real device has failure modes the editor never
 * shows, so the whole game sat on the splash screen forever with nothing logged. A
 * deadline is what makes those existing fallbacks reachable.
 *
 * Generous on purpose: a phone on a slow connection fetching the package is doing real
 * work, and cutting it off early would trade a hang for a permanently ugly board.
 */
const PRELOAD_DEADLINE = 8;

/**
 * The blocked-tap nudge: the car drives at the thing in its way, both cars jolt, and it
 * reverses. A car that only shuddered in place said "no" without saying WHY — this points
 * at the obstacle, which is the one piece of information the player is missing.
 *
 * BUMP is how far past the reported stopping point it presses, and it has to stay under the
 * bare board between two cars nose to tail. That distance is core's CLEARANCE, 0.04 board
 * units or 0.030 world -- and `firstBlocker` measures its gap from a mover already inflated
 * by CLEARANCE, so the car stops a clearance short of touching and BUMP eats into that.
 * At 0.020 it still leaves 0.010 of daylight; anything over 0.030 would drive one car into
 * the other. It was 0.06 back when cars were drawn at 90% of a grid cell and the slack was
 * 0.22. The jolt is what sells the impact anyway -- see JOLT.
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
    /**
     * Half the world box that MUST be on screen, for the board AS BUILT -- not for the
     * level, and not from a constant. `buildBoard` measures it off what it actually laid
     * out, and `fitCamera` zooms to whichever of the two the screen's shape makes binding.
     *
     * Measured rather than assumed because the wrong direction is silent: a box too small
     * crops (which is what shipped to the first phone), and a box too large just pads.
     */
    private needHalfW: number = LANE.edgeLimit;
    private needHalfH = VIEW_HALF_H;
    /**
     * Board y the camera is centred on: the midpoint of everything drawn. Was a constant 0,
     * which is the midpoint of nothing in particular -- see `buildBoard`.
     */
    private camY = 0;
    /**
     * The board's own vertical extent, and the shares of the SCREEN reserved above and
     * below it for the HUD (see HudView.topReserve). `fitCamera` frames the first between
     * the other two, which is why they are fields rather than locals: the split has to be
     * redone whenever the aspect changes, not just when a level loads.
     */
    private contentTop = 0;
    private contentBottom = 0;
    private padTop = 0;
    private padBottom = 0;
    /** Aspect the camera was last fitted to, so `update` only refits when it changes. */
    private fitAspect = 0;
    private layout: BoardLayout | null = null;
    /** The footprint overlay while it is shown. See `toggleDebugOverlay`. */
    private debugOverlay: Node | null = null;
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
     * The x a car DRIVES at down the side of the lot, which is no longer the side lane's own
     * centreline.
     *
     * The ring road is drawn around the slab, and the slab now reaches 93% of the screen --
     * so the side lane's centreline sits at 4.98 against a frame half-width of 4.67, and a
     * car on it showed 0.016 of its 0.652-wide body. It was not "mostly hidden", it was gone.
     *
     * There is no corridor that satisfies everything: the parked cars reach 4.208 and the
     * frame ends at 4.67, which is 0.462 of room for a body 0.652 across. So the choice is
     * between a car that is partly off screen and one that passes over the outermost parked
     * cars, and a car driving OUT of a car park passing close to the parked ones is the
     * normal-looking half of that pair. Fully visible wins.
     *
     * Measured from the biggest body rather than each car's own, so every car takes the same
     * line -- cars of three sizes each on their own lane would read as three roads.
     */
    private driveSideX = 0;

    /**
     * Cars still driving to a stall. `busy` only locks taps for the first leg, so the
     * player can keep tapping while a car finishes its lap of the ring road; this keeps
     * the end-of-level banner from cutting an arrival short, which is what `busy` used
     * to cover when a drive was one short hop.
     */
    private arriving = 0;
    /**
     * The build tag without its frame-rate suffix, and a one-second frame counter.
     *
     * On screen because "it stutters on the phone and not in the simulator" is a claim about
     * a number nobody can read. Twice now the ring has been reported as choppy on a device
     * and the answer has had to be inferred from what the code does per frame rather than
     * from what the device manages -- and the last inference was right about one cause (a
     * strobing arm swing) while the frame rate itself stayed a guess. A dev aid, alongside
     * the tag and the level picker, and it goes when they go.
     */
    private tagText = '';
    private fpsFrames = 0;
    private fpsClock = 0;
    /**
     * Milliseconds spent inside the tick body since the last readout, the worst single tick,
     * and the same total split three ways.
     *
     * The split is the whole point now. The tick averages about 29ms against a 25ms frame
     * budget and fires 5.9 times a second, so it is not an occasional spike -- every tick is
     * a lump bigger than a frame. Knowing WHICH of the three costs it is decides what gets
     * worked on, and there is no way to tell them apart from the outside.
     */
    private tickMsSum = 0;
    private tickMsMax = 0;
    private tickMsCore = 0;
    private tickMsView = 0;
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
    /**
     * Seconds per loop step: one slot of ring rotation, and one row's worth of boarding.
     *
     * 0.17, down from 0.34 -- the carousel at its old x1 was half as fast as it wanted to be,
     * so the whole scale doubled rather than the button's multiplier growing. x1 is now what
     * used to take a tap to reach, and x2 is twice that again.
     *
     * It had been raised to 0.34 from 0.18 after the first preview, on the theory that the
     * carousel was hard to read. It was not the speed: what fixed boarding reading
     * (passengers appearing to vanish) was flying the same figure the track itself draws, one
     * per seat taken, staggered by BOARD_STAGGER. With that in, the slow tick was only slow.
     *
     * BOARD_STAGGER and BOARD_FLIGHT_TIME halved along with it -- see their note; the ratio
     * between a boarding flight and a tick is load-bearing and a bare speed-up would have
     * broken it.
     */
    private readonly TICK = 0.17;
    /**
     * What the speed button multiplies the carousel by: 1 or 2. It divides `TICK` rather
     * than multiplying anything, so one number moves and every duration derived from it
     * follows -- the ring's rotation, the lane slides, a new row's entry, and the boarding
     * flights.
     *
     * The boarding flights have to come along, and that is not decoration. A row of four
     * takes 0.52s to fly (see boardingDuration), already longer than one 0.34 tick, and the
     * departure of the car it fills is DEFERRED by that long so the flights are not torn
     * down mid-air. At half a tick and unscaled flights that deferral spans three ticks --
     * long enough for the core to hand the same stall to another car, which is exactly the
     * failure BOARD_STAGGER's docblock was written about.
     *
     * Kept across levels: it is a preference, not a property of a level, and a player who
     * chose x2 does not want to choose it again ten times.
     */
    private speed = 1;
    /**
     * The carousel's bottom-left corner in BOARD space -- where the speed button hangs.
     * Kept rather than recomputed because it is the same point every frame of a level, and
     * has to be re-projected whenever the camera reframes.
     */
    private speedAnchor: Vec3 | null = null;
    private parked = new Map<number, ParkedCar>();

    /** Seconds per loop step at the current speed. */
    private get tick(): number {
        return this.TICK / this.speed;
    }

    start() {
        console.log(`[Game] ${BUILD_TAG}`);
        this.sfx = new SfxManager(this.node);
        this.setupCamera();
        const canvas = find('Canvas');
        if (canvas) {
            this.hud = new HudView(canvas);
            this.tagText = BUILD_TAG;
            this.hud.setBuildTag(this.tagText);
            this.uiCam = canvas.getComponentInChildren(Camera);
        } else {
            console.warn('[Game] Canvas not found — HUD disabled. Create a Canvas node named "Canvas".');
        }
        this.registerInput();
        // First thing this component logs. If a device hangs on the splash and this line is
        // absent, the scene never got as far as running the controller and the problem is
        // below us, in the engine or the asset download; if it is present, the hang is in
        // the preload chain below and the deadline warnings will say which step.
        console.log('[Game] controller start');
        // Preload builtin-standard so lit materials get real lighting; it lives in
        // the `internal` bundle but isn't preloaded unless something already uses it.
        // litMaterial falls back to unlit if this doesn't register, so proceed regardless.
        // Then preload the car GLB models (buildCar is synchronous and needs the
        // prefab resident) before loading the level. Passengers are procedural
        // (pax-figure.ts) and need no preload of their own.
        //
        // Each step is on a deadline: see PRELOAD_DEADLINE for why a step that never calls
        // back used to strand the game on the splash screen with nothing logged.
        this.withDeadline('builtin-standard preload', (d) => this.preloadLitEffect(d), () => {
            this.withDeadline('car model preload', (d) => preloadCarModels(d), () => {
                this.loadLevel(this.levelName);
            });
        });
    }

    /**
     * Run `step`, and continue when it reports finished OR when PRELOAD_DEADLINE passes,
     * whichever comes first. `done` runs exactly once either way -- a step that calls back
     * late finds the latch already closed and is ignored, so nothing runs twice.
     */
    private withDeadline(label: string, step: (done: () => void) => void, done: () => void): void {
        let fired = false;
        const finish = (timedOut: boolean): void => {
            if (fired) return;
            fired = true;
            if (timedOut) {
                console.warn(`[Game] ${label} did not finish within ${PRELOAD_DEADLINE}s`
                    + ' — starting without it');
            }
            done();
        };
        this.scheduleOnce(() => finish(true), PRELOAD_DEADLINE);
        step(() => finish(false));
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
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
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
        // Same reasoning as the preloads: say so rather than sitting silent. There is no
        // useful fallback for a level that never arrives -- the board would be empty -- so
        // this only reports; it does not pretend to recover.
        let arrived = false;
        this.scheduleOnce(() => {
            if (!arrived) console.error(`[Game] level '${name}' has not loaded after ${PRELOAD_DEADLINE}s`);
        }, PRELOAD_DEADLINE);
        resources.load(`levels/${name}`, JsonAsset, (err, asset) => {
            arrived = true;
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
            this.hud?.hideUnlockPrompt();
            this.ended = false;
            this.busy = false;
            this.arriving = 0;
            this.tickAcc = 0;
            this.loading = false;
            // The asset's uuid, alongside what the asset CONTAINS. The build in this tree
            // holds level 1 as uuid 3ce84b91 with four colours and has no two-colour level in
            // it at all, yet a phone running this exact code bundle reported two. Those two
            // facts cannot both describe one package, and the uuid says which of them to
            // stop trusting: the same uuid with different contents means the bytes that
            // reached the device are not the bytes that were built, and no change to this
            // code can fix that. A different uuid means the package holds an asset this tree
            // does not, and the search moves back to the build.
            const stamp = levelStamp(level, asset.uuid);
            this.tagText = `${BUILD_TAG} · ${stamp}`;
            this.hud?.setBuildTag(this.tagText);
            console.log(`[Game] level '${name}' started, state=${this.core.getState()}, ${stamp}`);
            if (this.core.getState() !== 'playing') this.logStartupDiagnosis(level);
        });
    }

    /**
     * Why a level was not `playing` the moment it loaded.
     *
     * That should be impossible: all ten shipped levels come up with 8 to 14 movable cars
     * and four free stalls, verified against core directly. A WeChat mini-game build
     * reported `state=deadlock` for level 1 where node and the mobile browser both report
     * `playing` on the same JSON and the same core, so the difference is in the build, not
     * in the data -- and guessing which part of the build is exactly what this avoids.
     *
     * The values printed are the ones the verdict is made of. `isDeadlocked` is
     * `!(hasFreeSlot && movable > 0)` with no parked car left to fill, so on a fresh level
     * it can only mean `movable === 0` -- every car reporting blocked. The car's resolved BOX
     * is printed with them because that is the likeliest way to get there: a NaN in `len` or
     * `wid` makes every projection NaN, every comparison in `sweepHit` false, and the sweep
     * falls out returning 0 -- which reads as "in contact" for every pair, whatever the
     * heading. CAR_SCALE and CAP_BOX are printed for the same reason: they are the two
     * module-level constants `carBox` multiplies, and a bundler that left either undefined at
     * init would produce exactly this and nothing else.
     */
    private logStartupDiagnosis(level: LevelData): void {
        const core = this.core!;
        const cars = level.lot.cars;
        const first = cars[0];
        const box = first ? carBox(first) : null;
        // The discriminator. A gap of exactly 0 means the swept test found the pair already
        // in contact, and it is what a NaN anywhere in the geometry degenerates to -- every
        // comparison in `sweepHit` goes false and it falls out returning 0. So "every car
        // blocked, every gap 0" is arithmetic gone bad, while a spread of real positive gaps
        // means the geometry is fine and the lot genuinely is jammed.
        let blocked = 0, zeroGap = 0;
        for (const c of cars) {
            const b = firstBlocker(c, cars, core.lot.bounds);
            if (!b) continue;
            blocked++;
            if (b.gap === 0 || !Number.isFinite(b.gap)) zeroGap++;
        }
        console.warn('[Game] not playing at load: ' + JSON.stringify({
            jsonCars: cars.length,
            coreCars: core.lot.cars.size,
            movable: core.lot.movableCarIds().length,
            blocked,
            zeroOrNaNGap: zeroGap,
            freeSlot: core.parking.hasFreeSlot(),
            bounds: core.lot.bounds,
            carScale: CAR_SCALE,
            capBox: CAP_BOX,
            firstCar: first ? { id: first.id, cap: first.cap, angle: first.angle } : null,
            firstBox: box ? { len: box.len, wid: box.wid } : null,
            firstBlocker: first ? firstBlocker(first, cars, core.lot.bounds) : null,
        }));
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

        // The box the lot and its ring road have to live in. These were CONSTANTS
        // (RING_LOW -5.76, LOT_HALF_W 3.83), both derived from the +/-4.90 by +/-6.21 frame
        // of the editor preview window -- and a phone's frame is neither of those numbers.
        // It is +/-4.67 by +/-10.11, narrower AND much taller, so the pair were wrong in
        // both directions at once: the ring road's outer kerb landed at 4.90 in a 4.67-wide
        // view, while 4.5 units of vertical budget went unused because the lot was still
        // being sized against a 6.21 half-height. (The side lane IS over the edge again
        // now -- see the asymmetry below -- but by 0.21 and on purpose, where before it was
        // by 0.23 and by accident, on a lane the layout believed was fully visible.)
        //
        // `ringLow` is the lowest a ring lane's CENTRELINE can sit with its outer edge still
        // on screen; `lotHalfW` is what is left across once the lot's offset to the side
        // lane comes off each side.
        //
        // Note the asymmetry, which is deliberate. Downwards the whole lane has to fit,
        // because the bottom lane's outer kerb IS the bottom of the board and the lot sits
        // right above it. Sideways only the OFFSET is reserved, so the side lane's
        // centreline lands on the frame edge and its outer half is over it. The side lanes
        // carry no traffic -- a departing car drives the TOP lane, out to EXIT_X -- so they
        // are there to close the ring, and a road leaving the screen reads as a road, which
        // is what the top lane has always done at 13 units wide. Reserving their full width
        // instead spent 1.07 units a side on almost invisible asphalt and left the lot at
        // 76% of the screen; this puts it at 82%, and the cell that comes free makes the
        // cars 2.5% bigger on top of that.
        const frame = this.viewFrame();
        const ringLow = -(frame.halfH - ROAD_H / 2);
        // HALF the offset, not all of it. The side lanes carry no traffic (see the note
        // above), so what they owe the layout is a hint of kerb, not a whole lane: at
        // RING_OFF/2 their centreline sits 0.31 off screen and about 0.14 of inner kerb is
        // still drawn. That buys the lot 0.62 of world width -- 87% of the screen to 93% --
        // and it is width the CARS get, because `LOT` is widened to match (see level-gen).
        const lotHalfW = frame.halfW - RING_OFF / 2;
        // The lot hangs exactly one lane below the top road, so the road stays put and the
        // lot moves with the grid's size. The cell takes whichever budget is tighter — the
        // rows against the height left under the stalls, or the columns against the width —
        // and the slab is then widened to the full frame.
        const cell = Math.min(
            CELL_MAX,
            (ROAD_Y - 2 * RING_OFF - ringLow - 0.3) / level.lot.h - CELL_GAP,
            (2 * lotHalfW - 0.3) / level.lot.w - CELL_GAP,
        );
        const scale = cell + CELL_GAP;
        this.boardScale = scale;
        const lotH = lotHeight(level.lot.h, scale);
        const lotW = Math.max(lotWidth(level.lot.w, scale), 2 * lotHalfW);
        // Pulled in off the side lane by half the widest body plus a hair, so the whole car
        // is inside the frame while it drives. See `driveSideX`.
        const EDGE_PAD = 0.06;
        this.driveSideX = Math.min(
            lotW / 2 + RING_OFF,
            frame.halfW - (CAP_BOX.big.wid * CAR_SCALE * scale) / 2 - EDGE_PAD,
        );
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
        // NO `setupAntiAliasing(this.cam)`. It hangs a PostProcess component off the board
        // camera, and post-process is a FULL-SCREEN PASS -- on a phone at 1170x2532 that is
        // 3.0M pixels read and written again, every frame, on top of the scene. It went in to
        // answer a jagged-edges report and was flagged then as needing a device check it
        // never got; the device now measures 8fps against the simulator's 49, and this is the
        // most expensive thing in the frame that buys the least.
        //
        // One line to put back if the jaggies matter more than the frame rate. The engine
        // module (`custom-pipeline-post-process` in settings/v2/packages/engine.json) is
        // still compiled in, so restoring it needs nothing but this call.
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
        const path = new TrackPath(shape);

        // Where the parking bay and the loop track go, up the board.
        //
        // Both were constants (PARKING_Y 1.4, LOOP_Y 3.8), which meant the bay had to fit a
        // 1.4-unit band between the ring road's top lane and the track's curb -- and a stall
        // that has to fit a BUS is 2.13 deep, not 1.06. The dependency runs the other way
        // now: the stall is sized from the board (`stallFootprint`), the bay sits directly on
        // top of the road, and the track is pushed up to clear it. That is the whole reason a
        // bus can park at its full size.
        //
        // It also spends height that was going begging: the board reached y = 7.31 of the
        // 8.98 the phone's frame allows, so pushing the track up costs nothing and takes the
        // blank band from 23% of the screen to 16%.
        const reach = trackReach(path);
        const stall = stallFootprint(scale);
        const bay = bayPanelSize(level.parking.slots, stall);
        // Clear air between the road and the bay, and between the bay and the track's
        // outermost waiting figure. One constant for both, since both are the same job.
        const BAND_GAP = 0.16;
        const bandBottom = ROAD_Y + ROAD_H / 2 + BAND_GAP;
        const PARKING_Y = bandBottom + bay.h / 2;
        const LOOP_Y = bandBottom + bay.h + BAND_GAP - reach.bottom;
        // Where the speed button hangs: beside the carousel's lower-left flank, centred in
        // the empty band between the track's lowest row and the feeder channel that crosses
        // above it. Measured, not nudged -- 1.25 units tall on every shipped level, against a
        // button 0.68 across.
        //
        // The obvious anchor, the bounding box's bottom-left CORNER, is the one place on that
        // flank with no room: `LOOP_Y` is defined to put the track's lowest row exactly
        // BAND_GAP (0.16) above the parking bay, so that corner IS the bay's top edge. A
        // button hung off it crowds the bay however it is nudged, which is what shipped and
        // what the player reported.
        const laneFloor = leftLaneFloor(path, level.loop.capacity, loop.channels);
        this.speedAnchor = new Vec3(
            reach.left, LOOP_Y + (reach.bottom + laneFloor) / 2, 0,
        );

        // Frame the camera on what was actually drawn.
        //
        // ACROSS: LANE.edgeLimit, not this level's own measured channel reach. It is the
        // bound core states and `validateTrack` enforces -- every legal level's channels
        // stay inside it -- so it is the same number for every level, which is the point.
        // The shipped levels' own reaches run 3.08 to 4.36 (their lookaheads differ, that
        // being a difficulty knob), and fitting each exactly would zoom the board by a
        // different amount PER LEVEL. The lot is the same size in all ten, so watching it
        // change from one level to the next would read as a bug -- this repo has already had
        // that complaint once, about parked cars. The lot's own ring road is maxed in anyway,
        // so a wider lot zooms out rather than clipping.
        //
        // Counter-intuitive and measured, so it does not get re-litigated: fitting to the
        // real 2.51 rather than 4.67 makes the cars SMALLER, not bigger. The ring road costs
        // a fixed 1.07 of WORLD width per side, so zooming in makes it eat a larger share of
        // the screen -- the lot went from 82% of the width to 75%, and the cars with it.
        //
        // DOWN: the drawn ring's top -- its path, plus a block across the centreline, plus a
        // figure standing up the screen from its feet (see `trackReach`; the figures lie IN
        // the board plane, so that last 0.55 is real and easy to miss) -- down to the ring
        // road's outer kerb. The camera then centres on the MIDPOINT of that, where it used
        // to sit at a constant y = 0. The two are 1.3 units apart, which at phone zoom is
        // 130 px of margin taken off one end of the screen and handed to the other.
        this.contentTop = LOOP_Y + reach.top;
        this.contentBottom = this.ring.bottom - ROAD_H / 2;
        // The HUD's bands are part of the framing, not something to be overlapped. They
        // arrive as fractions of the SCREEN's height because that is what they are -- a
        // notch and a plate of fixed design units both scale with the viewport, and the
        // board does not. So the board gets what is left: with `f` reserved, the content
        // has to fit in (1 - f) of the frame, hence the divisor below rather than a plain
        // halving. On a screen with no notch this still reserves the plate's own band,
        // which is the difference between the title clearing the ring by arithmetic and
        // clearing it by luck.
        this.padTop = Math.max(0, Math.min(0.45, this.hud?.topReserve() ?? 0));
        this.padBottom = Math.max(0, Math.min(0.45, this.hud?.bottomReserve() ?? 0));
        const usable = Math.max(0.2, 1 - this.padTop - this.padBottom);
        // The SLAB has to be on screen; the ring road around it does not. Reserving
        // `lotW / 2 + RING_OFF` here would undo the widening above entirely: a wider slab
        // would push this past LANE.edgeLimit, the camera would zoom out to fit a side lane
        // that is deliberately half off screen, and every car would come out SMALLER -- the
        // exact trap the README records under "narrowing the fit makes cars smaller", run
        // backwards. The side lanes are decoration; the lot is the game.
        this.needHalfW = Math.max(LANE.edgeLimit, lotW / 2);
        this.needHalfH = Math.max(
            VIEW_HALF_H, (this.contentTop - this.contentBottom) / (2 * usable),
        );
        // Invalidate the cached aspect: `fitCamera` short-circuits on aspect alone, and the
        // board it has to hold -- and the y it has to look at -- have both just changed. Fit
        // straight away too, so a level's first frame is already framed rather than being
        // one frame late.
        this.fitAspect = 0;
        this.fitCamera();

        this.loopView = new TrackView(
            loopRoot,
            path,
            // capacity and boardIndex are the same values on `level.loop` and on `loop`
            // (LoopSystem copies both at construction) -- read off whichever is already
            // in hand on each side of the comma.
            level.loop.capacity, loop.boardIndex,
            // The view gets core's already-normalised channel list, not the level's raw
            // `feeds`, so the two layers can't disagree about how many channels there
            // are or where each one joins (see Channel in core/loop-system.ts).
            loop.channels,
            LOOP_Y, this.tick,
            // What the camera shows across, so the lanes can run off the edge of it
            // rather than stopping short. `frame.halfW`, not LANE.edgeLimit: on a
            // viewport wider than the board needs the two differ by a quarter of a unit,
            // and a lane that stopped at the bound would leave a visible gap.
            frame.halfW,
        );
        // `false`: nothing has stepped the loop yet, so the ring has not rotated and the
        // cluster/slot offset must stay put (see TrackView.update).
        this.loopView.update(loop.ring, loop.channels, false);

        const parkingRoot = new Node('ParkingRoot');
        this.boardRoot.addChild(parkingRoot);
        this.parkingView = new ParkingView(
            parkingRoot, level.parking.slots, level.parking.unlocked, PARKING_Y, scale,
        );
        this.parkingView.render();

        const gridRoot = new Node('GridRoot');
        gridRoot.setPosition(0, GRID_Y, 0);
        this.boardRoot.addChild(gridRoot);
        this.gridRoot = gridRoot;
        // Same pitch the lot was sized from, or the slab and its cars drift apart.
        const layout = new BoardLayout(scale);
        this.layout = layout;
        this.gridView = new GridView(gridRoot, this.core!.lot, layout);
        this.gridView.render();
        if (DEBUG_FOOTPRINTS) this.toggleDebugOverlay();
    }

    private setupCamera(): void {
        const camNode = find('Main Camera');
        if (!camNode) {
            console.warn('[Game] Main Camera not found — cannot frame the board');
            return;
        }
        this.cam = camNode.getComponent(Camera);
        // Straight on, down the board's normal. Where along y it looks is `buildBoard`'s
        // to say (see `camY`) and it has not run yet, so this is the placeholder framing the
        // first frame is drawn with.
        //
        // (The tilted 2.5D framing this replaces was pos (0, 5, 12), lookAt (0, -0.3, 0),
        // and needs BOARD_TILT back at 52 to make sense.)
        this.placeCamera(camNode);
        if (this.cam) {
            // ORTHOGRAPHIC, and this is load-bearing rather than a matter of taste: the
            // gameplay is strictly 2D and core reasons about each car's FOOTPRINT on the
            // board plane, but a car is drawn STANDING on that plane, its roof `hgt` closer
            // to the camera (see `buildCar`). A perspective camera scales that roof by
            // d/(d-hgt) about its own axis and shoves it radially outward -- and the lot is
            // centred at y = -2.73 while the axis is at y = 0, so the whole lot is off-axis
            // and the bottom of it is ~5 units out. Measured over the ten shipped levels the
            // roof landed a MEDIAN of 0.109 board units from the footprint core was reasoning
            // about, peaking at 0.187. CLEARANCE is 0.04, so the picture was lying by two to
            // five times the entire gap budget, and it broke three things at once:
            //
            //  - blocked/clear. Re-running core's own sweep on the projected boxes disagreed
            //    with core on 13 of 360 cars, 10 of them "core says you may go, the eye says
            //    that blue car is in the way".
            //  - the size hierarchy. What you see is the roof plus whatever side wall the
            //    perspective reveals, which grows with distance off-axis: two MEDIUM cars --
            //    same model, same CAP_BOX row -- drew up to 26% apart in width, and 34 of the
            //    73 medium cars drew wider than some big one.
            //  - picking. `onTap` intersects its ray with the board plane and `pickCar` tests
            //    the footprint, so the player aimed at a roof that was not over the box.
            //
            // Under ortho a car projects exactly onto its footprint whatever its height and
            // wherever it sits -- in the lot, driving the ring, parked in a stall. Do not put
            // the perspective projection back without also giving core the roof plane.
            //
            // The framing this starts at is the half-height the 45-degree fov already had AT
            // THE BOARD PLANE, so z = 0 came out pixel-identical to the perspective frame and
            // everything else shifted by at most the 2.4% it had been magnified by. It is a
            // FLOOR, not the final value: `fitCamera` raises it on a viewport too narrow to
            // hold the board, which is every portrait phone.
            this.cam.projection = Camera.ProjectionType.ORTHO;
            this.cam.orthoHeight = VIEW_HALF_H;
            this.cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            // Matches the ground panel, so any sliver outside it doesn't flash a
            // different colour.
            this.cam.clearColor = new Color(205, 215, 236, 255);
        }
    }

    /**
     * The visible box in board units at the CURRENT screen shape, half-width by half-height.
     *
     * An orthographic camera fixes its vertical half-view and lets the horizontal follow the
     * aspect (which is how the perspective camera before it worked too -- its fovAxis was
     * VERTICAL). So a narrow viewport shows LESS across: the 0.79-aspect editor preview
     * window is 4.90 across, a 0.46 portrait phone only 2.87, and the board needs 4.67.
     * `fitCamera` buys that back by raising orthoHeight, and the frame that comes out is
     * what the board then has to be laid out into -- hence this, rather than the constants
     * `buildBoard` used to use, which only ever described the preview window.
     *
     * Costs nothing on a viewport already wide enough: the preview keeps the framing it had
     * to within a rounding error, a 4:3 tablet gives up 0.3%.
     */
    private viewFrame(): { halfW: number; halfH: number } {
        const size = screen.windowSize;
        const raw = size.width / Math.max(1, size.height);
        // Zero or NaN only happens before the window has a size. Assume the preview's own
        // shape rather than dividing by it; `update` refits the moment a real one arrives.
        const aspect = Number.isFinite(raw) && raw > 0 ? raw : PREVIEW_ASPECT;
        const halfH = Math.max(VIEW_HALF_H, LANE.edgeLimit / aspect);
        return { halfW: halfH * aspect, halfH };
    }

    /**
     * Zoom out far enough that the whole board is on screen, whatever shape the screen is,
     * and look at the middle of it.
     *
     * Fits to `needHalfW`/`needHalfH` -- what the board as BUILT requires -- not to the
     * frame `viewFrame` offered. The two agree at the aspect the board was laid out for; a
     * later resize can only make the camera step further back, never crop what is drawn.
     */
    private fitCamera(): void {
        if (!this.cam) return;
        const size = screen.windowSize;
        const aspect = size.width / Math.max(1, size.height);
        if (!Number.isFinite(aspect) || aspect <= 0) return;
        if (Math.abs(aspect - this.fitAspect) < 1e-4) return;
        this.fitAspect = aspect;
        const oh = Math.max(this.needHalfH, this.needHalfW / aspect);
        this.cam.orthoHeight = oh;
        // Reserve the HUD's bands off the top and bottom, then centre the board in what is
        // left. `surplus` is the room a viewport wider than the board needs hands back, and
        // it splits evenly -- reserving a share of the screen is a floor on those bands,
        // not a claim on everything going spare.
        const view = 2 * oh;
        const surplus = view - (this.contentTop - this.contentBottom)
            - (this.padTop + this.padBottom) * view;
        const top = this.padTop * view + Math.max(0, surplus) / 2;
        this.camY = this.contentTop + top - oh;
        this.placeCamera(this.cam.node);
    }

    /**
     * Hang the speed button off the carousel's bottom-left corner: a board point, projected
     * through the game camera into the UI camera's space -- the same two-step the seat chips
     * take (see `positionChip`), because it is the same problem.
     *
     * EVERY FRAME, not once when the board is built, and that is the fix for a real bug: the
     * button landed on the parking bay on level 1 and in the right place on every level
     * after it. `worldToScreen` reads the camera's view-projection matrix, which the renderer
     * refreshes once a frame -- so a projection taken in the same frame `placeCamera` moved
     * the camera uses the matrix from BEFORE the move. On the first board that move is the
     * jump from the placeholder framing to the real one, which is large; on a level switch
     * the camera barely moves, which is why only level 1 looked wrong.
     *
     * Measured, and this is what ruled out the obvious suspect: the anchor is identical on
     * all four track shapes (y 3.671 on every one, x within 0.24 board units), so the shape
     * was never what differed. Only the projection was.
     *
     * Cheap enough to do unconditionally: one matrix transform and two camera projections,
     * against a tick loop that repositions the whole ring.
     */
    private placeSpeedButton(): void {
        if (!this.cam || !this.uiCam || !this.boardRoot || !this.hud || !this.speedAnchor) return;
        const world = Vec3.transformMat4(new Vec3(), this.speedAnchor, this.boardRoot.worldMatrix);
        const screen = this.cam.worldToScreen(world, new Vec3());
        this.hud.placeSpeed(this.uiCam.screenToWorld(screen, new Vec3()));
    }

    /** Point the camera straight down the board's normal at `camY`. */
    private placeCamera(camNode: Node): void {
        camNode.setPosition(new Vec3(0, this.camY, CAMERA_DIST));
        camNode.lookAt(new Vec3(0, this.camY, 0));
    }

    update(dt: number): void {
        // Before the guards: the window can be resized while the level is over, or between
        // levels, and a stale zoom would be visible either way. Same for the speed button,
        // which hangs off a board point and so moves with the framing.
        this.fitCamera();
        this.placeSpeedButton();
        this.tickFps(dt);
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
        while (this.tickAcc >= this.tick) {
            this.tickAcc -= this.tick;
            const tickStartedAt = nowMs();
            const res = this.core.stepLoop();
            const afterCore = nowMs();
            const lp = this.core.loop;
            this.loopView?.update(lp.ring, lp.channels);
            const afterView = nowMs();
            this.tickMsCore += afterCore - tickStartedAt;
            this.tickMsView += afterView - afterCore;
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
                    this.scheduleOnce(
                        () => this.onDeparted(ids),
                        boardingDuration(res.boardedSlots.length) / this.speed,
                    );
                } else {
                    // No boarding this tick (e.g. a zero-capacity car parked already
                    // full), so there is no flight to wait for — depart at once.
                    this.onDeparted(res.departedCarIds);
                }
            }
            // Before the early exits below, so a tick that ends the level is still counted.
            const tickMs = nowMs() - tickStartedAt;
            this.tickMsSum += tickMs;
            if (tickMs > this.tickMsMax) this.tickMsMax = tickMs;
            if (this.core.getState() !== 'playing') {
                this.onEnd(this.core.getState());
                break;
            }
            this.syncUnlockUrge();
        }
    }

    /**
     * Stamp the measured frame rate next to the build tag, once a second.
     *
     * On screen because "it stutters on the phone and not in the simulator" is a claim about
     * a number nobody can read. Twice now the ring has been reported as choppy on a device
     * and the answer had to be inferred from what the code does per frame rather than from
     * what the device manages -- and the last inference was right about one cause (an arm
     * swing that strobed) while the frame rate itself stayed a guess.
     *
     * Counted before `update`'s guards, so it keeps running while a level is over or between
     * levels: a frame rate that only reads during play cannot tell you what a load or a
     * banner costs. A dev aid, alongside the tag and the level picker, and it goes with them.
     */
    private tickFps(dt: number): void {
        this.fpsFrames++;
        this.fpsClock += dt;
        if (this.fpsClock < 1) return;
        const fps = Math.round(this.fpsFrames / this.fpsClock);
        // Milliseconds of tick work PER SECOND, which is the number that matters: the tick
        // body runs inside a frame, so this is how much of every second the frame budget
        // never gets. Reported next to the worst single tick, because a 20ms lump inside one
        // frame is a visible hitch even when the average looks affordable.
        const per = (ms: number): number => Math.round(ms / this.fpsClock);
        const tickLoad = per(this.tickMsSum);
        const core = per(this.tickMsCore);
        const view = per(this.tickMsView);
        // Whatever the tick body spends outside the two timed calls: the HUD, the seat
        // counts, boarding and departure, the unlock check.
        const rest = Math.max(0, tickLoad - core - view);
        const tickMax = Math.round(this.tickMsMax);
        this.fpsFrames = 0;
        this.fpsClock = 0;
        this.tickMsSum = 0;
        this.tickMsMax = 0;
        this.tickMsCore = 0;
        this.tickMsView = 0;
        if (this.tagText) {
            this.hud?.setBuildTag(`${this.tagText} · ${fps}fps · tick${tickLoad}`
                + ` c${core} v${view} r${rest} max${tickMax}`);
        }
    }

    /**
     * Put the "open a stall or lose" question to the player when the board reaches the one
     * state that needs it (`GameCore.needsUnlock`): every open stall taken, nothing on the
     * bay able to board, and a stall still lockable.
     *
     * The prompt is where the level's outcome is decided -- open one and play carries on,
     * close it and the level is over (`declineUnlock`, answered in `handleTap`). Before it
     * existed the board simply went quiet here: the carousel kept turning, `remainingCount`
     * never moved again, and nothing said why. Measured, a player who holds their unlocks
     * reaches this state in 59 of 80 runs over the ten levels.
     *
     * On the tick, not the frame: the answer only changes when the loop steps or a car
     * lands, and `reachableColors` walks the whole ring to work it out.
     *
     * Held off while a car is still driving in. Core parks on tap, so the bay is already
     * full during the drive, and that car may be the one that can board -- asking then puts
     * the question up and takes it straight back down.
     */
    private syncUnlockUrge(): void {
        if (!this.core?.needsUnlock() || this.busy || this.arriving > 0) return;
        this.hud?.showUnlockPrompt();
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
            /** Held beat at each corner. Departures use EXIT_TURN_TIME, arrivals less. */
            turnTime?: number;
        } = {},
    ): void {
        const turnTime = opts.turnTime ?? EXIT_TURN_TIME;
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
            seq.call(() => this.turnBody(body, from, to, turnTime))
                .delay(turnTime)
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
        // Every waypoint but the last rides at `z`, out in front of the parked cars (see
        // DRIVE_LIFT); the final one, into the stall, comes back down to the board so the
        // car parks among its neighbours rather than hovering over them. The lift and the
        // drop each happen along a leg, which is invisible under an orthographic camera.
        const z = from.z + DRIVE_LIFT;
        const parkZ = from.z;
        const d = headingVec(angle);
        // Distance to each lane it is actually heading toward; Infinity when it is not
        // travelling that way at all, so `Math.min` ignores it.
        // Against `driveSideX`, the line the car will actually take, not the drawn lane.
        // Measuring to the lane and then routing to the inset would drive the car out to
        // 4.98 and fold it back to 4.28 -- a visible jog, and half of it off screen.
        const tx = Math.abs(d.x) < 1e-6
            ? Infinity : ((d.x > 0 ? 1 : -1) * this.driveSideX - from.x) / d.x;
        const ty = Math.abs(d.y) < 1e-6
            ? Infinity : ((d.y > 0 ? r.top : r.bottom) - from.y) / d.y;
        // Clamped at zero: a car somehow already past a lane would otherwise be sent back.
        const t = Math.max(0, Math.min(tx, ty));
        const out = new Vec3(from.x + d.x * t, from.y + d.y * t, z);
        const wp: Vec3[] = [out];
        // `driveSideX`, not `r.left`/`r.right`: the drawn lane is off screen, the car must
        // not be. The bottom lane needs no such treatment -- it sits at -9.66 in a frame that
        // reaches -10.95, so a car on it is drawn whole.
        if (ty <= tx) {
            if (d.y > 0) {
                wp.push(new Vec3(out.x, r.top, z));
            } else {
                const side = (out.x < 0 ? -1 : 1) * this.driveSideX;
                wp.push(new Vec3(out.x, r.bottom, z));
                wp.push(new Vec3(side, r.bottom, z));
                wp.push(new Vec3(side, r.top, z));
            }
        } else {
            const side = (d.x < 0 ? -1 : 1) * this.driveSideX;
            wp.push(new Vec3(side, out.y, z));
            wp.push(new Vec3(side, r.top, z));
        }
        wp.push(new Vec3(slotX, r.top, z));
        wp.push(new Vec3(slotX, parkY, parkZ));
        return wp;
    }

    /**
     * How fast to drive `route`, and how long its last leg then takes.
     *
     * One speed for the WHOLE route, not one per leg -- `driveRoute`'s note explains why a
     * per-leg duration reads as the car changing power at every corner, and that still
     * holds. What changes here is that a LONG route is driven faster, so the wait does not
     * scale with how unlucky the car's position was. Ground distance only: the ride is
     * lifted (DRIVE_LIFT) and dropped again, and neither is visible under an ortho camera,
     * so neither should be paid for in time.
     *
     * The last leg's duration comes back with it because `finalApproach`'s stall-refit tween
     * has to last exactly that long -- at 0.28 flat it used to match, and at these speeds
     * the hop into the stall is a fraction of it, which would leave a car resizing after it
     * had parked.
     */
    private driveTiming(from: Vec3, route: Vec3[]): { speed: number; lastLeg: number } {
        let len = 0;
        let last = 0;
        let prev = from;
        for (const wp of route) {
            const d = Math.hypot(wp.x - prev.x, wp.y - prev.y);
            if (d >= 1e-3) last = d;
            len += d;
            prev = wp;
        }
        const speed = Math.min(
            DRIVE_SPEED * DRIVE_SPEED_MAX_MULT,
            Math.max(DRIVE_SPEED, len / DRIVE_TIME_MAX),
        );
        return { speed, lastLeg: last / speed };
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
                .delay(i * BOARD_STAGGER / this.speed)
                .to(BOARD_FLIGHT_TIME / this.speed, { t: 1 }, {
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
     * Never larger than 1: a stall is deeper than a small car is long, so fitting one to it
     * worked out at 1.9 -- the car nearly doubled as it drove up, which reads as the wrong
     * car arriving rather than as parking. So the refit is a shrink-only affair.
     *
     * As of the board-scaled stall it should now be a NO-OP: the stall is sized to hold the
     * longest body there is, so every capacity comes out at 1 and keeps exactly the size it
     * had in the lot. It is kept because it is the only thing standing between a drifted
     * CAP_BOX (or a re-exported model) and a car drawn straight over its neighbours -- and
     * because it is what used to fire. When the stall was fixed at 0.78 x 1.06 while the lot
     * grew, this shrank a bus to 0.563 and left it parking NARROWER than the small car next
     * to it, 0.344 against 0.464 across.
     */
    private stallScale(id: number): number {
        const size = this.gridView!.getCarSize(id);
        if (!size || size.len <= 0 || size.wid <= 0) return 1;
        const slot = this.parkingView!.slotSize;
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
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    /**
     * What core decided about this tap, as one line. The `blocked` case names the car core
     * picked as the blocker and how much room it measured, which is the pair of facts a
     * screenshot cannot show and the whole argument turns on.
     */
    private logTap(id: number, angle: number, verdict: string): void {
        const car = this.core?.lot.cars.get(id);
        if (!car) return;
        const lot = this.core!.lot;
        const b = firstBlocker(car, Array.from(lot.cars.values()), lot.bounds);
        const who = `car ${id} (${car.cap}) at (${car.x.toFixed(2)}, ${car.y.toFixed(2)}) heading ${angle.toFixed(1)}`;
        if (b) {
            const by = lot.cars.get(b.carId);
            console.log(`[tap] ${who} -> ${verdict}; core says BLOCKED by car ${b.carId}`
                + `${by ? ` (${by.cap}) at (${by.x.toFixed(2)}, ${by.y.toFixed(2)})` : ''}`
                + `, ${b.gap.toFixed(3)} board units of room`);
        } else {
            console.log(`[tap] ${who} -> ${verdict}; core says the lane is CLEAR`);
        }
    }

    /** D toggles the footprint overlay. Keyboard only, so it never fires on a phone. */
    private onKeyUp(e: EventKeyboard): void {
        if (e.keyCode === KeyCode.KEY_D) this.toggleDebugOverlay();
    }

    /**
     * Show or hide core's ground truth over the lot: see `debug-overlay.ts` for how to read
     * it. Rebuilt on every toggle rather than kept in sync, because a stale overlay would be
     * exactly the kind of lie it exists to catch.
     */
    private toggleDebugOverlay(): void {
        if (this.debugOverlay) {
            this.debugOverlay.destroy();
            this.debugOverlay = null;
            return;
        }
        if (!this.core || !this.gridRoot || !this.layout) return;
        const lot = this.core.lot;
        this.debugOverlay = buildFootprintOverlay(
            Array.from(lot.cars.values()), lot.bounds, this.layout,
        );
        this.gridRoot.addChild(this.debugOverlay);
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
        // The unlock prompt owns every tap while it is up -- see `showUnlockPrompt`. Before
        // the level picker too: this is a question with a losing answer, and being able to
        // duck it by tapping something else would make it optional, which it is not.
        if (this.uiCam && this.hud?.promptOpen()) {
            const ui = this.uiCam.screenToWorld(new Vec3(screenX, screenY, 0), new Vec3());
            const hit = this.hud.hitsUnlockPrompt(ui);
            if (hit === 'unlock') {
                this.hud.hideUnlockPrompt();
                this.unlockNextSlot();
            } else if (hit === 'close') {
                this.hud.hideUnlockPrompt();
                // Core decides, not the view: `declineUnlock` re-checks the position and
                // refuses if it has started moving again. `update` picks up the state
                // change and raises the banner.
                this.core?.declineUnlock();
            }
            return;   // anything else on this screen is swallowed
        }
        // The level picker, before anything else -- including the level-over branch, so a
        // finished level can be left for another one rather than only replayed or advanced.
        // A development aid; see PICK_LEVELS in hud-view.
        if (this.uiCam && this.hud) {
            const pick = this.hud.hitsLevel(
                this.uiCam.screenToWorld(new Vec3(screenX, screenY, 0), new Vec3()),
            );
            if (pick > 0) {
                // Tapping the level you are already on does nothing, rather than
                // restarting it: the row is under your thumb all game, and a stray tap that
                // wipes the board would be a worse bug than the one this is here to debug.
                const want = `level-${pick}`;
                if (want !== this.levelName) this.switchTo(want);
                return;
            }
        }
        if (this.ended) {
            // Won and another level exists → advance. Deadlocked, or the series has
            // run out → replay the same level.
            const next = this.core?.getState() === 'won' ? this.nextLevelName() : null;
            this.switchTo(next ?? this.levelName);
            return;
        }
        // The speed button, before the board is consulted at all -- and before the `busy`
        // guard, deliberately. `busy` exists to stop a second car being sent while one is
        // pulling out of the lot; it has nothing to say about how fast the carousel turns,
        // and a control that goes dead for a second every time you tap a car reads as
        // broken.
        //
        // AFTER the level-over branch, though, which returns before reaching this: once the
        // banner is up every tap advances or replays, and that is the more useful thing a tap
        // can do there. The button is inert on that screen by construction.
        if (this.uiCam && this.hud) {
            const ui = this.uiCam.screenToWorld(new Vec3(screenX, screenY, 0), new Vec3());
            if (this.hud.hitsSpeed(ui)) {
                this.toggleSpeed();
                return;
            }
        }
        if (!this.core || !this.gridView || !this.parkingView || !this.cam || !this.gridRoot) return;
        if (this.busy) return;

        // Ray from the tap, intersected with the (possibly tilted) board plane, then
        // converted into gridRoot-local space, where the cars' own positions live.
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

        // The parking bay comes first, and not just for tidiness: it sits ABOVE the lot, so
        // a tap that lands on a stall cannot be a tap on a car, and answering it here means
        // `pickCar` never sees it. The hit has to be re-expressed in the BOARD's frame --
        // `localHit` is gridRoot-local and gridRoot is offset down by the lot's half-height,
        // while the bay's stalls are positioned in parkingRoot, which sits at the board's
        // origin.
        if (this.boardRoot) {
            const bInv = new Mat4();
            Mat4.invert(bInv, this.boardRoot.worldMatrix);
            const boardHit = new Vec3();
            Vec3.transformMat4(boardHit, worldHit, bInv);
            if (this.parkingView.hitsNextLocked(boardHit)) {
                this.unlockNextSlot();
                return;
            }
        }

        const id = this.gridView.pickCar(localHit);
        if (id == null) return;

        this.sfx?.play('tap');
        vibrate('light');

        const body = this.gridView.getCarBody(id);
        if (body) squash(body);

        const angle = this.core.lot.cars.get(id)?.angle ?? 0;
        const res = this.core.tapCar(id);
        // Tied to the overlay BEING VISIBLE, not to the constant: D turns the overlay on at
        // runtime, and a diagnostic you switched on that stays silent is worse than none.
        if (this.debugOverlay) this.logTap(id, angle, res.ok ? 'ok' : (res.reason ?? 'refused'));
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
        const { speed, lastLeg } = this.driveTiming(start, route);
        this.driveRoute(node, route, speed, {
            turnTime: ARRIVE_TURN_TIME,
            // Release the tap lock once the car is out of the lot rather than when it
            // parks: a lap of the ring road takes over a second, and locking taps for all
            // of it makes the board feel dead. The core parked the car on tap already, so
            // a second tap mid-drive is safe.
            firstLegDone: () => { this.busy = false; },
            // Refit to the stall on the final approach - over exactly the turn plus the hop
            // up off the lane, which `driveTiming` hands back because the hop's length now
            // depends on the speed this route drew. Doing it on the way OUT of the lot (as
            // an earlier version did) changes the car's size right beside its siblings,
            // which reads as a glitch rather than as parking.
            finalApproach: () => {
                tween(node)
                    .to(ARRIVE_TURN_TIME + lastLeg,
                        { scale: new Vec3(parkScale, parkScale, parkScale) },
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
     * Flip the carousel between x1 and x2.
     *
     * `tickAcc` is deliberately left alone. It holds the fraction of a tick already elapsed,
     * and that fraction is just as valid against the new interval -- clearing it would swallow
     * up to a tick of progress, and at x2 the leftover can be larger than the new tick, in
     * which case the very next frame steps twice and catches up by itself. Which is right:
     * the player asked for faster.
     */
    private toggleSpeed(): void {
        this.speed = this.speed === 1 ? 2 : 1;
        this.hud?.setSpeed(this.speed);
        this.loopView?.setTick(this.tick);
        this.sfx?.play('tap');
        vibrate('light');
    }

    /**
     * Open the next locked stall, on a tap on it.
     *
     * Free, for now: the button says "tap me" with a play triangle because that is where a
     * rewarded video goes, but nothing is being asked for yet. When an ad is wired in, this
     * is the one place that changes -- everything below it already treats an unlock as a
     * thing that either happened or did not.
     *
     * Core decides WHICH stall opens (always the leftmost locked one, see
     * ParkingSystem.unlock) and the view is told the index, so the two counts cannot drift.
     * A refusal is silent: the only way to get one is to tap a stall that no longer exists,
     * which the hit test already rules out.
     */
    private unlockNextSlot(): void {
        const slot = this.core!.unlockSlot();
        if (slot < 0) return;
        this.sfx?.play('tap');
        vibrate('light');
        this.parkingView!.openSlot(slot);
        // A newly opened stall can end a deadlock -- which is the whole point of the
        // mechanic -- and it can also be the last thing a won level was waiting for.
        this.syncSeatCounts();
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
        this.hud?.showToast('车位已满');
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
