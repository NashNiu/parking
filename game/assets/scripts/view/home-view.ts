import {
    Color, Label, Layers, Node, Sprite, tween, Tween, UIOpacity, UITransform, Vec3,
} from 'cc';
import { burstSprite, dotSprite, rampSprite, roundedSprite, starSprite } from './ui-shapes';
import { canvasSize, makeLabel, safeInsets } from './ui-layout';
import { bestStars, isUnlocked, Progress, STAR_MAX, unlockedThrough } from '../core/index';
import {
    RAIL_PITCH, railFlick, railNearest, railOffset, railRubber, railStopT,
} from './rail-math';

/**
 * The home screen: the game's name, a rail of levels you drag through, and one button that
 * plays the one in the middle.
 *
 * It is a UI screen in the SAME canvas as the HUD, not a Cocos scene of its own. A second
 * scene would mean a second copy of the camera rig and the preload chain that `start()`
 * spends its first frames on, and a scene load between the menu and the board -- for a
 * screen that is a few dozen sprites. `GameController.screen` decides which of the two is
 * up, and the board simply is not built while this one is.
 *
 * A RAIL RATHER THAN A GRID, and the difference is not decoration: a grid has to be
 * re-laid-out when the game grows past ten levels, while a rail just gets longer. It also
 * puts one level in the middle at a size worth looking at, which is what lets the button say
 * WHICH level it starts.
 *
 * THE BUTTON IS THE ONLY WAY IN. Dragging and tapping select; the green button plays. Two
 * jobs on one control -- tap to select, tap again to play -- is how a stray tap starts a
 * level nobody asked for, and on a rail a stray tap is exactly what a slightly-too-still
 * drag looks like.
 *
 * It draws the save, and it is the only place the level gate is enforced: a locked level can
 * be brought to the middle and read, but the button goes quiet and says what would unlock
 * it. One place, because this screen owns what the player can see.
 */

/**
 * A placeholder, and named so it is easy to find: the game has no title yet. One constant,
 * one string.
 */
const GAME_TITLE = '停车场';

const BG = new Color(24, 30, 50, 255);
const TITLE_INK = new Color(255, 255, 255, 255);
const SUB_INK = new Color(150, 163, 196, 255);
/**
 * The three type sizes on this screen, on a canvas 1280 design units wide (see `canvasSize`
 * -- NOT 720, which is what the first pass at every panel in this game was built on).
 *
 * 「左右滑动选择关卡」 was 28, asked for as 这几个字大一点: that is 2.2% of the screen's width for
 * the one line telling a new player that the rail moves, which is the only instruction on the
 * screen. At 52 it is 4%, and it sits on the same step as the subtitle rather than below it.
 */
const TITLE_SIZE = 124;
const SUB_SIZE = 46;
const CAP_SIZE = 52;

/**
 * The background: the board's own grid, at the strength a background can carry.
 *
 * The lines are `scene-stage.ts`'s GRID_LINE -- the same paint the board's floor wears --
 * knocked back to a few percent. That is the whole idea of this decoration: the menu is not
 * a screen in front of the game, it is a corner of the same lot, so its floor is that floor.
 * Inventing a pattern here would have said the opposite.
 *
 * The ticks along the bottom are stall mouths: short marks hanging off a kerb line, which is
 * what a car park looks like from above.
 */
const DECO_LINE = new Color(224, 232, 247, 14);
const DECO_KERB = new Color(224, 232, 247, 22);
const DECO_COLS = 6;
const DECO_ROWS = 5;
const DECO_LINE_W = 4;
const DECO_BAYS = 7;
const DECO_BAY_H = 220;

/**
 * The sky and the floor: a light wash down from the top and a darker one up from the bottom.
 *
 * This is what 有点单调 was about, and it is the one thing a screen painted from flat tinted
 * sprites cannot have -- every sprite here is a single colour, so before `rampSprite` there
 * was no way to put LIGHT anywhere. The wash costs two draw calls and does more for the
 * screen than everything else in this function.
 *
 * Both are sized as fractions of the canvas HEIGHT, which varies by device (see `canvasSize`:
 * the width is pinned at 1280 and the height is whatever the aspect ratio gives). A wash
 * measured in absolute units would be a third of a tall phone and all of a short one.
 */
const SKY = new Color(86, 128, 208, 30);
const SKY_SPAN = 0.5;
const FLOOR = new Color(6, 8, 16, 130);
const FLOOR_SPAN = 0.34;

/**
 * Cars parked in the bays along the bottom, at background strength.
 *
 * Four of the seven bays, not all of them: a car park with a space in it reads as a car park,
 * and a full row reads as a wall. They carry the four car colours, which is the only place
 * on this screen -- other than the rail's stops -- that any colour appears at all.
 *
 * Drawn as one rounded body with a lighter roof band, and nothing else. At this alpha the
 * detail would not survive anyway, and the shape's job is to be recognisable as a car from
 * the arrangement rather than from its windows.
 */
const CAR_COLORS = [
    new Color(232, 78, 74, 78),
    new Color(74, 150, 232, 78),
    new Color(112, 200, 92, 78),
    new Color(240, 196, 64, 78),
];
const CAR_ROOF = new Color(255, 255, 255, 30);
const CAR_BAYS = [0, 1, 3, 5];
const CAR_W = 96;
const CAR_H = 176;
const CAR_R = 26;

/**
 * Passengers standing at the bays that have no car in them: three to a bay, at the kerb.
 *
 * 78 on the cars and 96 here, not the 34 the first pass used. A mock of this composition put
 * the cars at 34 over the floor wash and they did not register at all -- background strength
 * is measured against what is BEHIND it, and the bottom of this screen is the darkest part of
 * it. Faint enough to stay background, strong enough to be a thing.
 *
 * They are also the only reason the empty bays read as empty rather than as unfinished: three
 * dots waiting in a gap says a car is coming to it.
 */
const PAX_D = 34;
const PAX_GAP = 44;
const PAX_PER_BAY = 3;
const PAX_COLORS = [
    new Color(240, 196, 64, 96),
    new Color(112, 200, 92, 96),
    new Color(74, 150, 232, 96),
];

/**
 * The sunburst behind the rail: the same `burstSprite` the win card wears, at background
 * strength, turning once every 46 seconds.
 *
 * It is the only thing on this screen that MOVES once the entrance is over, and that is its
 * whole job -- a menu that is perfectly still reads as a screenshot of a menu. 46 rather
 * than the win card's 40 because a player sits here longer, and fast enough to notice is
 * fast enough to become an animation you watch.
 */
const DECO_BURST = new Color(255, 255, 255, 9);
const DECO_BURST_D = 1500;
const DECO_BURST_TURN = 46;

/** The lane the stops ride on: a full-bleed band with a dashed centre line. */
const LANE = new Color(33, 42, 68, 255);
const LANE_H = 236;
const LANE_DASH = new Color(60, 71, 102, 255);
const LANE_DASH_W = 26;
const LANE_DASH_GAP = 22;
const LANE_DASH_H = 5;

const START_W = 400;
const START_H = 116;
const START_R = 40;
const START = new Color(86, 199, 104, 255);
const START_BASE = new Color(56, 156, 76, 255);
/** The button with nothing to play: the same slab, drained, and it answers no taps. */
const START_SHUT = new Color(60, 71, 102, 255);
const START_SHUT_BASE = new Color(45, 54, 78, 255);
/** How far the base peeks out below the face. Same lip the HUD's buttons wear. */
const BTN_LIFT = 8;

/**
 * A stop is built at its FOCUSED size and scaled down as it leaves the middle, so one node
 * covers both states and the size is continuous while a finger is moving.
 */
const STOP_D = 104;
const STOP_R = 26;
const STOP_REST = 0.58;
const STOP_ALPHA_REST = 140;
const STOP = new Color(74, 144, 226, 255);
const STOP_BASE = new Color(44, 96, 165, 255);
/** Cleared: the same blue, walked back, so a finished level reads as finished. */
const STOP_DONE = new Color(59, 108, 168, 255);
const STOP_DONE_BASE = new Color(42, 79, 124, 255);
const STOP_SHUT = new Color(52, 62, 90, 255);
const STOP_SHUT_BASE = new Color(38, 46, 70, 255);
const STOP_INK = new Color(255, 255, 255, 240);
/** The halo on the middle stop. It fades out as that stop leaves the middle. */
const STOP_RING = new Color(86, 199, 104, 90);
const STOP_RING_PAD = 15;

const STOP_STAR_D = 24;
const STOP_STAR_PITCH = 27;
const STOP_STAR_Y = -72;
const STAR_ON = new Color(255, 201, 52, 255);
const STAR_OFF = new Color(70, 82, 116, 255);

/**
 * The padlock on a locked stop, drawn from the primitives that exist: a round shackle with a
 * stop-coloured rounded sprite over its middle to cut it hollow, and the body over the join.
 * `ui-shapes` has no ring, and an emoji lock is one font substitution away from a hollow box
 * -- the same reason the HUD's home button says 主页 rather than wearing a glyph.
 */
const LOCK_INK = new Color(150, 163, 196, 255);

/**
 * The barrier arm, which IS the loading screen.
 *
 * It is the one object that says "car park" with no caption, and it is nine rounded sprites.
 * IT DOES NOT SHOW A FRACTION, and that is deliberate: this game has no fractional progress
 * to show -- the preload is one material load behind an eight-second deadline -- so an arm
 * creeping toward vertical would be a progress bar reporting a number nobody measured.
 *
 * What it reports instead is the real milestone. It bobs a few degrees while the preload is
 * outstanding, which says "working" rather than "nearly there", and sweeps open once, when
 * the preload actually answers. A preload that hangs therefore leaves the arm DOWN and
 * bobbing for the full eight seconds -- which is the right thing to be looking at, and more
 * honest than a bar that fills to 90% and stops.
 */
const GATE_POST_W = 22;
const GATE_POST_H = 96;
const GATE_ARM_W = 300;
const GATE_ARM_H = 22;
const GATE_ARM_SEGS = 6;
const GATE_KERB_W = 340;
const GATE_KERB_H = 8;
const GATE_INK = new Color(107, 119, 150, 255);
const GATE_RED = new Color(232, 72, 60, 255);
const GATE_PALE = new Color(246, 247, 251, 255);
const GATE_OPEN_ANGLE = 78;
const GATE_OPEN_TIME = 0.42;
const GATE_BOB = 4;
const GATE_BOB_TIME = 0.9;
const GATE_DROP = 74;

const LOADING_SIZE = 34;
const LOADING_INK = new Color(150, 163, 196, 255);

/** Slack around a tap, in design units: the same padding the HUD's own hit tests use. */
const TAP_PAD = 10;

/**
 * How far a finger may travel and still count as a tap.
 *
 * 14 design units. Below it, a press that wobbles is a tap -- a rail that refused to be
 * tapped because the thumb moved two units would be maddening. Above it the gesture is a
 * drag, and the release must NOT also be treated as a tap, or every swipe would end by
 * selecting whatever it happened to stop over.
 */
const DRAG_SLOP = 14;

/**
 * How fast the rail closes on its target, per second, as a fraction of the distance left.
 * 12 lands a one-stop move in about a fifth of a second and cannot overshoot, which a spring
 * can -- and an overshooting level rail reads as broken rather than lively.
 */
const RAIL_EASE = 12;

/**
 * The title's hit box, for the press-and-hold that clears the save. Much larger than the
 * three characters it covers, because it is a hidden control: a player who has been told
 * where it is should not also have to find it precisely.
 */
const TITLE_HIT_W = 400;
const TITLE_HIT_H = 140;

/** Everything drawn for one level. Kept so `setProgress` can repaint without rebuilding. */
interface Stop {
    node: Node;
    fade: UIOpacity;
    ringFade: UIOpacity;
    face: Node;
    base: Node;
    num: Label;
    lock: Node;
    stars: Node[];
    open: boolean;
}

export class HomeView {
    /** Everything this screen draws, under one node, so `show`/`hide` is one flag. */
    private root: Node;
    private titleNode: Node;
    private sub: Label;
    private cap: Label;
    private startBtn: Node;
    private startFace: Node;
    private startBase: Node;
    private startLabel: Label;
    /** The stops' parent, parked on the lane. Stops are positioned within it. */
    private railRoot: Node;
    private stops: Stop[] = [];

    private loadingLayer: Node;
    private loadingFade: UIOpacity;
    private gateArm: Node;

    /** 0 until `setLevels`, which is also what "the rail exists" means. */
    private levelCount = 0;
    /** Whether the screen is still waiting. Every hit test refuses while it is true. */
    private waiting = true;

    /** The rail's drawn scroll position, and where it is heading. See `rail-math`. */
    private offset = 0;
    private target = 0;
    private focused = 0;
    /** Whether the level in the middle can be played -- what the button reflects. */
    private focusOpen = false;

    private dragging = false;
    private dragFromX = 0;
    private dragBase = 0;
    private lastX = 0;
    private lastT = 0;
    private travelled = 0;
    /** Offset units per second, positive when later levels are coming to the middle. */
    private vel = 0;

    private w = 720;
    private h = 1280;

    /**
     * Builds everything that does NOT depend on knowing the levels: the background, the
     * title, the lane, the button, and the barrier that stands in for all of it while the
     * game loads.
     *
     * Split that way so this screen can be on the canvas from the first frame the engine
     * draws. The Cocos first screen ends BEFORE the app starts -- `game.js` has it as
     * `firstScreen.end().then(() => application.start())` -- so between that logo and this
     * menu there is a stretch with nothing drawn in it but the camera's clear colour. The
     * stops arrive with `setLevels`, once the level count can be read.
     */
    constructor(canvas: Node) {
        const { w, h } = canvasSize(canvas);
        this.w = w;
        this.h = h;

        this.root = new Node('Home');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        canvas.addChild(this.root);

        // Twice the canvas, like the modal scrims: a viewport wider than the design
        // resolution would otherwise show a strip of empty 3D scene down either side.
        const bg = roundedSprite('HomeBg', w * 2, h * 2, BG, 2);
        this.root.addChild(bg);

        this.buildDeco();

        // Under the notch, not under the top edge -- the same reservation the HUD's title
        // plate makes, for the same reason.
        const titleY = h / 2 - safeInsets().top * h - h * 0.15;
        const title = makeLabel(this.root, 'HomeTitle', TITLE_SIZE, titleY);
        title.color = TITLE_INK;
        title.isBold = true;
        title.string = GAME_TITLE;
        this.titleNode = title.node;

        this.sub = makeLabel(this.root, 'HomeSub', SUB_SIZE, titleY - TITLE_SIZE - 22);
        this.sub.color = SUB_INK;
        this.sub.node.active = false;

        this.railRoot = this.buildLane(h * 0.03);

        this.cap = makeLabel(this.root, 'HomeCap', CAP_SIZE, h * 0.03 - LANE_H / 2 - 62);
        this.cap.color = SUB_INK;
        this.cap.string = '左右滑动选择关卡';
        this.cap.node.active = false;

        const start = this.buildStart(-h * 0.25);
        this.startBtn = start.node;
        this.startFace = start.face;
        this.startBase = start.base;
        this.startLabel = start.label;

        this.loadingLayer = new Node('Loading');
        this.loadingLayer.layer = Layers.Enum.UI_2D;
        this.loadingLayer.addComponent(UITransform);
        this.root.addChild(this.loadingLayer);
        this.loadingFade = this.loadingLayer.addComponent(UIOpacity);
        this.gateArm = this.buildGate(h * 0.03);

        this.setLoading(true);
        this.root.active = false;
    }

    /** See DECO_LINE and DECO_BURST for what this draws and why it is those things. */
    private buildDeco(): void {
        const deco = new Node('Deco');
        deco.layer = Layers.Enum.UI_2D;
        deco.addComponent(UITransform);
        this.root.addChild(deco);

        const { w, h } = this;

        // The wash first of all, under everything including the light: it IS the ground.
        // Twice the canvas across, like the flat colour under it, so a wide viewport cannot
        // show a strip of unpainted scene down either side.
        const sky = rampSprite('Sky', w * 2, h * SKY_SPAN, SKY);
        deco.addChild(sky);
        sky.setPosition(0, h / 2 - h * SKY_SPAN / 2, 0);
        const floor = rampSprite('Floor', w * 2, h * FLOOR_SPAN, FLOOR);
        deco.addChild(floor);
        floor.setPosition(0, -h / 2 + h * FLOOR_SPAN / 2, 0);
        // Rotated, so the opaque end is at the BOTTOM. `rampSprite` paints one direction and
        // the caller turns it; the alternative was two frames of the same gradient.
        floor.angle = 180;

        // Then the light, so the grid lies over it rather than under it -- the floor is
        // nearer than the light.
        const burst = burstSprite('DecoBurst', DECO_BURST_D, DECO_BURST);
        deco.addChild(burst);
        burst.setPosition(0, this.h * 0.03, 0);
        tween(burst).by(DECO_BURST_TURN, { angle: 360 }).repeatForever().start();
        for (let i = 1; i < DECO_COLS; i++) {
            const line = roundedSprite(`col-${i}`, DECO_LINE_W, h, DECO_LINE, 1);
            deco.addChild(line);
            line.setPosition((i / DECO_COLS - 0.5) * w, 0, 0);
        }
        for (let i = 1; i < DECO_ROWS; i++) {
            const line = roundedSprite(`row-${i}`, w, DECO_LINE_W, DECO_LINE, 1);
            deco.addChild(line);
            line.setPosition(0, (i / DECO_ROWS - 0.5) * h, 0);
        }

        // The stall mouths: a kerb across the bottom with ticks hanging off it, and cars in
        // some of them. The bays are deep enough to park in now -- at 74 they were marks on
        // the floor, and a mark is not a bay.
        const span = w * 1.1;
        const bayY = -h / 2 + safeInsets().bottom * h + h * 0.115;
        const kerb = roundedSprite('kerb', span, DECO_LINE_W, DECO_KERB, 1);
        deco.addChild(kerb);
        kerb.setPosition(0, bayY, 0);
        for (let i = 0; i <= DECO_BAYS; i++) {
            const tick = roundedSprite(`bay-${i}`, DECO_LINE_W, DECO_BAY_H, DECO_KERB, 1);
            deco.addChild(tick);
            tick.setPosition((i / DECO_BAYS - 0.5) * span, bayY - DECO_BAY_H / 2, 0);
        }
        // Centred in the bay, which is the gap BETWEEN two ticks -- half a pitch over from
        // the tick's own x. See CAR_COLORS for why only four of the seven are taken.
        const bayX = (bay: number): number => ((bay + 0.5) / DECO_BAYS - 0.5) * span;
        for (let i = 0; i < CAR_BAYS.length; i++) {
            const bay = CAR_BAYS[i];
            const car = roundedSprite(`car-${bay}`, CAR_W, CAR_H, CAR_COLORS[i], CAR_R);
            deco.addChild(car);
            car.setPosition(bayX(bay), bayY - DECO_BAY_H / 2 - 6, 0);
            const roof = roundedSprite('roof', CAR_W - 30, CAR_H * 0.34, CAR_ROOF, 14);
            car.addChild(roof);
            roof.setPosition(0, CAR_H * 0.1, 0);
        }
        // And people in the bays that have none. See PAX_D.
        let waiting = 0;
        for (let bay = 0; bay < DECO_BAYS; bay++) {
            if (CAR_BAYS.indexOf(bay) >= 0) continue;
            for (let k = 0; k < PAX_PER_BAY; k++) {
                const dot = dotSprite(
                    `pax-${bay}-${k}`, PAX_D, PAX_COLORS[(waiting + k) % PAX_COLORS.length],
                );
                deco.addChild(dot);
                dot.setPosition(
                    bayX(bay) + (k - (PAX_PER_BAY - 1) / 2) * PAX_GAP, bayY + PAX_D, 0,
                );
            }
            waiting++;
        }
    }

    /** The band the stops ride on, and the node they live in. */
    private buildLane(y: number): Node {
        const band = roundedSprite('Lane', this.w * 1.2, LANE_H, LANE, 2);
        this.root.addChild(band);
        band.setPosition(0, y, 0);

        const span = this.w * 1.2;
        const step = LANE_DASH_W + LANE_DASH_GAP;
        const n = Math.ceil(span / step);
        for (let i = 0; i < n; i++) {
            const dash = roundedSprite(`dash-${i}`, LANE_DASH_W, LANE_DASH_H, LANE_DASH, 2);
            band.addChild(dash);
            dash.setPosition(-span / 2 + step / 2 + i * step, 0, 0);
        }

        const rail = new Node('RailStops');
        rail.layer = Layers.Enum.UI_2D;
        rail.addComponent(UITransform);
        this.root.addChild(rail);
        rail.setPosition(0, y, 0);
        return rail;
    }

    /**
     * The primary button. Its LABEL says which level it opens, and `setFocus` keeps that in
     * step with whatever is in the middle of the rail -- the two cannot disagree, because
     * one function writes both.
     */
    private buildStart(y: number): { node: Node; face: Node; base: Node; label: Label } {
        const btn = new Node('HomeStart');
        btn.layer = Layers.Enum.UI_2D;
        btn.addComponent(UITransform).setContentSize(START_W, START_H);
        this.root.addChild(btn);
        btn.setPosition(0, y, 0);
        const base = roundedSprite('base', START_W, START_H, START_BASE, START_R);
        btn.addChild(base);
        base.setPosition(0, -BTN_LIFT, 0);
        const face = roundedSprite('face', START_W, START_H, START, START_R);
        btn.addChild(face);
        const label = makeLabel(face, 'HomeStartLabel', 46, 0);
        label.isBold = true;
        label.string = '开始游戏';
        return { node: btn, face, base, label };
    }

    /** See GATE_POST_W for what this is and why its arm does not report a fraction. */
    private buildGate(y: number): Node {
        const kerb = roundedSprite('gateKerb', GATE_KERB_W, GATE_KERB_H, GATE_INK, 4);
        this.loadingLayer.addChild(kerb);
        kerb.setPosition(0, y - GATE_DROP, 0);

        const postX = -GATE_KERB_W / 2 + GATE_POST_W;
        const post = roundedSprite('gatePost', GATE_POST_W, GATE_POST_H, GATE_INK, 8);
        this.loadingLayer.addChild(post);
        post.setPosition(postX, y - GATE_DROP + GATE_POST_H / 2, 0);

        // The arm pivots at its LEFT end, on top of the post, so its own node sits there and
        // the stripes hang off to the right of the origin -- rotating the node then rotates
        // the whole arm about the post, which is what a barrier does.
        const arm = new Node('gateArm');
        arm.layer = Layers.Enum.UI_2D;
        arm.addComponent(UITransform);
        this.loadingLayer.addChild(arm);
        arm.setPosition(postX, y - GATE_DROP + GATE_POST_H, 0);
        const seg = GATE_ARM_W / GATE_ARM_SEGS;
        for (let i = 0; i < GATE_ARM_SEGS; i++) {
            const bar = roundedSprite(
                `seg-${i}`, seg, GATE_ARM_H, i % 2 === 0 ? GATE_RED : GATE_PALE, 3,
            );
            arm.addChild(bar);
            bar.setPosition(seg / 2 + i * seg, 0, 0);
        }

        const label = makeLabel(this.loadingLayer, 'HomeLoading', LOADING_SIZE, y - 200);
        label.color = LOADING_INK;
        label.string = '正在放行…';
        return arm;
    }

    /**
     * Show or hide the waiting state: the barrier stands in for the rail and the button, and
     * every hit test refuses while it is up.
     *
     * One flag drives the visibility AND the hit tests, the discipline SPEED_BUTTON and
     * PICK_ROW settled: a control that is invisible but still answering taps would start a
     * level out of a screen that has not finished loading one.
     *
     * Turning it OFF sweeps the arm open and brings the menu up as the sweep clears it, so
     * the two read as one movement rather than a wipe followed by a menu. That costs
     * GATE_OPEN_TIME, and it is the only reason the metaphor is worth having.
     */
    setLoading(on: boolean): void {
        this.waiting = on;
        Tween.stopAllByTarget(this.gateArm);
        Tween.stopAllByTarget(this.loadingFade);
        Tween.stopAllByTarget(this.root);
        if (on) {
            this.loadingLayer.active = true;
            this.loadingFade.opacity = 255;
            this.gateArm.angle = 0;
            this.revealMenu(false);
            // Bobbing, not creeping: it says "working", and it cannot be mistaken for a
            // measurement of how much is left.
            tween(this.gateArm)
                .to(GATE_BOB_TIME, { angle: -GATE_BOB }, { easing: 'sineInOut' })
                .to(GATE_BOB_TIME, { angle: 0 }, { easing: 'sineInOut' })
                .union()
                .repeatForever()
                .start();
            return;
        }
        tween(this.gateArm)
            .to(GATE_OPEN_TIME, { angle: GATE_OPEN_ANGLE }, { easing: 'cubicOut' })
            .start();
        tween(this.loadingFade)
            .delay(GATE_OPEN_TIME * 0.55)
            .to(0.2, { opacity: 0 })
            .call(() => { this.loadingLayer.active = false; })
            .start();
        tween(this.root)
            .delay(GATE_OPEN_TIME * 0.5)
            .call(() => this.revealMenu(true))
            .start();
    }

    private revealMenu(on: boolean): void {
        this.sub.node.active = on;
        this.cap.node.active = on;
        this.startBtn.active = on;
        this.railRoot.active = on;
    }

    /**
     * Tell the screen how many levels there are, and build the rail.
     *
     * `levelCount` comes from the caller rather than a constant here, because the number of
     * levels is a fact about the `resources/levels` folder and `GameController` is what can
     * see it. Adding a level-11.json then extends the rail with no change to this file --
     * and with a rail, not even a change of layout.
     *
     * Called once, after the preload: reading the bundle's index is the one thing on this
     * screen that cannot be done before the engine has finished starting.
     */
    setLevels(levelCount: number): void {
        if (this.stops.length > 0) return;
        this.levelCount = levelCount;
        this.sub.string = `共 ${levelCount} 关`;
        for (let i = 0; i < levelCount; i++) this.stops.push(this.buildStop(i));
        this.layout();
    }

    private buildStop(i: number): Stop {
        const node = new Node(`Stop${i + 1}`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(STOP_D, STOP_D);
        this.railRoot.addChild(node);
        const fade = node.addComponent(UIOpacity);

        // The halo first, so it sits behind the chip and reads as a glow rather than a frame.
        const ring = roundedSprite(
            'ring', STOP_D + STOP_RING_PAD * 2, STOP_D + STOP_RING_PAD * 2,
            STOP_RING, STOP_R + 8,
        );
        node.addChild(ring);
        const ringFade = ring.addComponent(UIOpacity);
        const base = roundedSprite('base', STOP_D, STOP_D, STOP_BASE, STOP_R);
        node.addChild(base);
        base.setPosition(0, -BTN_LIFT, 0);
        const face = roundedSprite('face', STOP_D, STOP_D, STOP, STOP_R);
        node.addChild(face);
        const num = makeLabel(face, 'n', 46, 0);
        num.color = STOP_INK;
        num.isBold = true;
        num.string = `${i + 1}`;

        const lock = this.buildLock(face);
        const stars: Node[] = [];
        for (let s = 0; s < STAR_MAX; s++) {
            const star = starSprite(`star${s}`, STOP_STAR_D, STAR_OFF);
            node.addChild(star);
            star.setPosition((s - (STAR_MAX - 1) / 2) * STOP_STAR_PITCH, STOP_STAR_Y, 0);
            star.active = false;
            stars.push(star);
        }
        return { node, fade, ringFade, face, base, num, lock, stars, open: false };
    }

    /** See LOCK_INK: a padlock out of three sprites, the middle one a hole. */
    private buildLock(face: Node): Node {
        const lock = new Node('lock');
        lock.layer = Layers.Enum.UI_2D;
        lock.addComponent(UITransform);
        face.addChild(lock);
        const shackle = dotSprite('shackle', 38, LOCK_INK);
        lock.addChild(shackle);
        shackle.setPosition(0, 13, 0);
        const hole = roundedSprite('hole', 18, 24, STOP_SHUT, 9);
        lock.addChild(hole);
        hole.setPosition(0, 15, 0);
        const body = roundedSprite('body', 46, 34, LOCK_INK, 8);
        lock.addChild(body);
        body.setPosition(0, -10, 0);
        lock.active = false;
        return lock;
    }

    /**
     * Draw the save: every stop's state and rating, and which level the rail opens on.
     *
     * Opening on the furthest unlocked level is what makes the rail land where the player
     * left off, and it is the same number the button offers -- `setFocus` writes both.
     */
    setProgress(p: Progress): void {
        if (this.stops.length === 0) return;
        for (let i = 0; i < this.stops.length; i++) {
            const level = i + 1;
            const stop = this.stops[i];
            const open = isUnlocked(p, level);
            const best = bestStars(p, level);
            const done = best > 0;
            stop.open = open;
            stop.face.getComponent(Sprite)!.color =
                !open ? STOP_SHUT : (done ? STOP_DONE : STOP);
            stop.base.getComponent(Sprite)!.color =
                !open ? STOP_SHUT_BASE : (done ? STOP_DONE_BASE : STOP_BASE);
            stop.num.node.active = open;
            stop.lock.active = !open;
            for (let s = 0; s < stop.stars.length; s++) {
                // Absent, not empty, on a level never cleared: three grey stars would say it
                // was cleared with none, which cannot happen (the rating floors at one).
                stop.stars[s].active = open && done;
                stop.stars[s].getComponent(Sprite)!.color = s < best ? STAR_ON : STAR_OFF;
            }
        }
        this.setFocus(Math.max(1, Math.min(this.levelCount, unlockedThrough(p))) - 1);
        // Land there rather than glide there: this runs as the screen appears, and a rail
        // that slides in from level 1 every time would be an animation of loading a save.
        this.offset = this.target;
        this.layout();
    }

    /** Which level the button plays, 1-based. */
    focusedLevel(): number {
        return this.focused + 1;
    }

    /**
     * Move the rail's aim to stop `i`, and write the button to match.
     *
     * The button is the ONLY place the gate shows as a refusal: a locked level can be brought
     * to the middle and looked at, and then the button says what would open it and
     * `hitsStart` stops answering. Friendlier than a rail that refuses to travel, and one
     * predicate rather than two.
     */
    private setFocus(i: number): void {
        this.focused = Math.max(0, Math.min(Math.max(0, this.levelCount - 1), i));
        this.target = railOffset(this.focused);
        const stop = this.stops[this.focused];
        this.focusOpen = !!stop && stop.open;
        this.startFace.getComponent(Sprite)!.color = this.focusOpen ? START : START_SHUT;
        this.startBase.getComponent(Sprite)!.color =
            this.focusOpen ? START_BASE : START_SHUT_BASE;
        this.startLabel.string = this.focusOpen
            ? `开始 第 ${this.focused + 1} 关`
            : `通过第 ${this.focused} 关解锁`;
    }

    /** Bring stop `i` to the middle, on a tap. */
    focusStop(i: number): void {
        this.setFocus(i);
    }

    /**
     * Ease the rail toward its target and lay the stops out. Driven from
     * `GameController.update`, which calls it BEFORE its own `core` guard -- there is no core
     * on this screen.
     *
     * Exponential smoothing rather than a tween: the target changes mid-flight (a tap during
     * a glide, a second flick) and a tween would have to be stopped and rebuilt every time,
     * while this just keeps closing on whatever the target is now.
     */
    tick(dt: number): void {
        if (!this.dragging && this.offset !== this.target) {
            this.offset += (this.target - this.offset) * Math.min(1, dt * RAIL_EASE);
            if (Math.abs(this.target - this.offset) < 0.5) this.offset = this.target;
        }
        this.layout();
    }

    /**
     * Place every stop for the current offset: x from the rail's coordinate, scale and
     * opacity from how far out of the middle it is.
     *
     * Everything here is continuous in `offset`, which is what makes a drag read as direct
     * manipulation -- chips grow as they arrive rather than snapping between two sizes.
     * Stops fully off screen are deactivated; ones at the edge are left to be clipped by the
     * screen itself, because a half-visible chip is what says there is more rail.
     */
    private layout(): void {
        const edge = this.w * 0.75;
        for (let i = 0; i < this.stops.length; i++) {
            const stop = this.stops[i];
            const x = railOffset(i) - this.offset;
            if (Math.abs(x) > edge) {
                stop.node.active = false;
                continue;
            }
            stop.node.active = true;
            const t = Math.min(1, railStopT(this.offset, i));
            const scale = 1 + (STOP_REST - 1) * t;
            stop.node.setPosition(x, 0, 0);
            stop.node.setScale(scale, scale, 1);
            stop.fade.opacity = Math.round(255 + (STOP_ALPHA_REST - 255) * t);
            // The halo belongs to the middle alone, and is gone by half a pitch out, so two
            // chips are never wearing it at once.
            stop.ringFade.opacity = Math.round(255 * Math.max(0, 1 - t * 2));
        }
    }

    show(): void {
        this.root.active = true;
        // To the front. Seat chips and tunnel badges are appended to the canvas as a level
        // runs, which makes them later -- and so higher-drawing -- siblings than anything
        // built at startup. The HUD's panels raise themselves for the same reason.
        this.root.setSiblingIndex(this.root.parent!.children.length - 1);
    }

    hide(): void {
        this.root.active = false;
    }

    open(): boolean {
        return this.root.active;
    }

    // --- the gesture -------------------------------------------------------------------

    /**
     * A press landed. `t` is a clock in seconds; only differences matter.
     *
     * The drag takes hold of the DRAWN offset rather than the target, so grabbing the rail
     * mid-glide catches it where it visibly is -- taking hold of a moving thing and having
     * it jump is the single thing that makes a drag feel broken.
     */
    beginDrag(uiX: number, t: number): void {
        if (this.waiting || this.levelCount === 0) return;
        this.dragging = true;
        this.dragFromX = uiX;
        this.dragBase = this.offset;
        this.lastX = uiX;
        this.lastT = t;
        this.travelled = 0;
        this.vel = 0;
    }

    /** Whether a finger is currently on the rail. Lets the caller skip work per mouse move. */
    isDragging(): boolean {
        return this.dragging;
    }

    moveDrag(uiX: number, t: number): void {
        if (!this.dragging) return;
        this.travelled += Math.abs(uiX - this.lastX);
        // Negated once, here: a finger moving LEFT brings later levels to the middle, which
        // is a RISING offset. Nothing downstream has to think about the sign again.
        this.offset = railRubber(this.dragBase - (uiX - this.dragFromX), this.levelCount);
        this.target = this.offset;
        const dt = t - this.lastT;
        if (dt > 0.001) this.vel = -(uiX - this.lastX) / dt;
        this.lastX = uiX;
        this.lastT = t;
    }

    /**
     * The press ended. Says whether it was a tap or a drag, and the caller uses that to
     * decide whether the release also counts as a click.
     *
     * A release that travelled more than DRAG_SLOP must NOT also be treated as a tap, or
     * every swipe would end by selecting whatever it stopped over.
     */
    endDrag(t: number): 'tap' | 'slid' {
        if (!this.dragging) return 'tap';
        this.dragging = false;
        if (this.travelled < DRAG_SLOP) {
            // A wobble, not a drag: put the rail back on the stop it was aiming at -- the
            // offset may have drifted a unit or two under the finger -- and let the tap out.
            this.setFocus(railNearest(this.offset, this.levelCount));
            return 'tap';
        }
        // Stale velocity is worse than none: a finger that slid, stopped, rested and then
        // lifted must not fling the rail on the speed it had a second ago.
        const fresh = t - this.lastT < 0.12 ? this.vel : 0;
        this.setFocus(railFlick(this.offset, fresh, this.levelCount));
        return 'slid';
    }

    /** Whether `ui` (UI-space) landed on the start button, and there is a level to start. */
    hitsStart(ui: Vec3): boolean {
        if (!this.open() || this.waiting || !this.focusOpen) return false;
        const p = this.startBtn.worldPosition;
        return Math.abs(ui.x - p.x) <= START_W / 2 + TAP_PAD
            && Math.abs(ui.y - p.y) <= START_H / 2 + TAP_PAD;
    }

    /** Whether `ui` landed on the title -- the press-and-hold that clears the save. */
    hitsTitle(ui: Vec3): boolean {
        if (!this.open() || this.waiting) return false;
        const p = this.titleNode.worldPosition;
        return Math.abs(ui.x - p.x) <= TITLE_HIT_W / 2
            && Math.abs(ui.y - p.y) <= TITLE_HIT_H / 2;
    }

    /**
     * Which stop `ui` landed on, 0-based, or -1 for none. A tap on a stop brings it to the
     * middle; it does NOT start the level, which is the button's job alone.
     *
     * Measured against the stop's DRAWN size, so a resting chip has a resting chip's target
     * -- a hit box left at the focused size would overlap its neighbours' and bring the
     * wrong level in.
     */
    hitsStop(ui: Vec3): number {
        if (!this.open() || this.waiting) return -1;
        for (let i = 0; i < this.stops.length; i++) {
            const stop = this.stops[i];
            if (!stop.node.active) continue;
            const p = stop.node.worldPosition;
            const half = (STOP_D * stop.node.scale.x) / 2 + TAP_PAD;
            if (Math.abs(ui.x - p.x) <= half && Math.abs(ui.y - p.y) <= half) return i;
        }
        return -1;
    }
}
