import {
    Color, Label, Layers, Node, Sprite, tween, Tween, UIOpacity, UITransform, Vec3,
} from 'cc';
import { dotSprite, roundedSprite, starSprite } from './ui-shapes';
import { canvasSize, makeLabel, safeInsets } from './ui-layout';
import { bestStars, isUnlocked, Progress, STAR_MAX, unlockedThrough } from '../core/index';
import { railFlick, railNearest, railOffset, railRubber, railStopT } from './rail-math';
import { nodeCenter } from '../core/home-path';
import { HomeScene } from './home-scene';

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
 * The count on the plate, and it is near-white because the plate under it is a near-opaque
 * navy -- see PLATE. It has nowhere else to sit.
 *
 * IT USED TO BE A SLATE GREY, 150,163,196, chosen when this screen was a flat navy field and
 * raised to this when the field became a photograph and a grey word landed on a grey wall. The
 * photograph is gone and the street behind the plate is now a pale pavement, which would argue
 * for taking it back down -- except that the plate is what the type actually stands on, and the
 * plate has not changed. So the value stays and only the reason for it does.
 *
 * The OUTLINE that used to go with it has gone: `HOME_RIM` and `SUB_RIM_W` existed because a
 * photograph puts arbitrary colour behind arbitrary text, and neither they nor `rimLabel` had a
 * caller left once the title was removed. A drawn street has no such surprise in it.
 */
const SUB_INK = new Color(236, 242, 255, 255);
/**
 * The two type sizes left on this screen, on a canvas 1280 design units wide (see
 * `canvasSize` -- NOT 720, which is what the first pass at every panel here was built on).
 * There were three: the 124 title went with the rail's turn, see where `resetNode` is set.
 *
 * 「左右滑动选择关卡」 was 28, asked for as 这几个字大一点: that is 2.2% of the screen's width for
 * the one line telling a new player that the rail moves, which is the only instruction on the
 * screen. At 52 it is 4%, and it sits on the same step as the subtitle rather than below it.
 */
const SUB_SIZE = 46;

/**
 * The plate at the top: what level count you are looking at, and the press-and-hold target
 * that clears the save.
 *
 * OPAQUE, and that is the whole reason it is a plate and not a line of type. See where it is
 * built: on a route that fills the screen, every fixed label is eventually crossed by a
 * scrolling stop.
 */
const PLATE = new Color(36, 46, 74, 236);
const PLATE_W = 320;
const PLATE_H = 88;

/**
 * How much clear space the button keeps under it, past the home indicator's own reservation.
 *
 * 90 rather than nothing: flush against the inset the button looks like it fell off the
 * screen, and on a phone with no inset at all it would genuinely be on the edge.
 */
const START_MARGIN = 90;
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
/**
 * The stops, now pills rather than chips: 236 x 148, which is the mock's proportion read off
 * its own screen width.
 *
 * STOP_REST went from 0.58 to 0.86, and that is a consequence of the axis rather than a
 * preference. A horizontal rail showed five stops and used size to say which one the button
 * would play; a vertical one shows eight to eleven, and eight things at 58% read as a list
 * that has been shrunk rather than as a route with one stop chosen. The halo does most of
 * the pointing now, and the size difference only has to be noticeable.
 */
const STOP_W = 236;
const STOP_H = 148;
const STOP_R = 40;
const STOP_REST = 0.86;
const STOP_ALPHA_REST = 190;
const STOP = new Color(74, 144, 226, 255);
const STOP_BASE = new Color(44, 96, 165, 255);
/** Cleared: the same blue, walked back, so a finished level reads as finished. */
const STOP_DONE = new Color(59, 108, 168, 255);
const STOP_DONE_BASE = new Color(42, 79, 124, 255);
const STOP_SHUT = new Color(52, 62, 90, 255);
const STOP_SHUT_BASE = new Color(38, 46, 70, 255);
const STOP_INK = new Color(255, 255, 255, 240);
// Dimmer on a locked stop, and shifted right of the padlock beside it. See setProgress.
const STOP_INK_SHUT = new Color(190, 200, 224, 220);
const NUM_X_SHUT = 40;
const LOCK_X_SHUT = -50;
/** The halo on the middle stop. It fades out as that stop leaves the middle. */
const STOP_RING = new Color(86, 199, 104, 90);
const STOP_RING_PAD = 15;

// Inside the pill, under the number: below it they would land in the 124 units of gap the
// next stop needs, and two rows of stars between two stops reads as neither one's.
const STOP_STAR_D = 26;
const STOP_STAR_PITCH = 30;
const STOP_STAR_Y = -40;
const STOP_NUM_Y = 22;
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
    private resetNode: Node;
    private sub: Label;
    private topPlate: Node;
    private startBtn: Node;
    private startFace: Node;
    private startBase: Node;
    private startLabel: Label;
    /** The street the rail runs up. See `home-scene`. */
    private scene: HomeScene;
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
    private dragFromY = 0;
    private dragBase = 0;
    private lastY = 0;
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

        // THE STREET GOES IN FIRST, and that is the whole of its z-ordering: everything after
        // it -- the stops, the plate, the button -- draws over it. It builds only its ground
        // here; the road itself needs the level count, so it is finished in `setLevels`.
        this.scene = new HomeScene(this.root, w, h);

        // NO TITLE. The route fills the screen top to bottom now, and the game's name is
        // already the largest thing on the first screen this hands over from -- a second
        // copy of it over the road is a caption on a picture that has one.
        //
        // The count takes the place it used to sit under: under the notch, not under the top
        // edge, the same reservation the HUD's title plate makes.
        this.railRoot = new Node('RailStops');
        this.railRoot.layer = Layers.Enum.UI_2D;
        this.railRoot.addComponent(UITransform);
        this.root.addChild(this.railRoot);

        // The plate goes in AFTER the road, so the stops pass BEHIND it. On a route that
        // fills the screen there is nowhere to put a line of type that a scrolling stop does
        // not eventually cross, and bare text with a stop sliding through it looks like a
        // fault. An opaque plate is what the reference does with its chapter banner, and it
        // is the only thing that actually solves it.
        const plateY = h / 2 - safeInsets().top * h - h * 0.06;
        this.topPlate = roundedSprite('HomePlate', PLATE_W, PLATE_H, PLATE, PLATE_H / 2);
        this.root.addChild(this.topPlate);
        this.topPlate.setPosition(0, plateY, 0);
        this.sub = makeLabel(this.topPlate, 'HomeSub', SUB_SIZE, 0);
        this.sub.color = SUB_INK;
        this.sub.isBold = true;
        // THE CLEAR-SAVE GESTURE LIVES HERE NOW, and it is why removing the title was not a
        // pure deletion: the press-and-hold that wipes progress had the title for a target
        // and would have gone with it. The plate is what took the title's place on the
        // screen, so it takes its second job too.
        this.resetNode = this.topPlate;
        this.topPlate.active = false;

        // Against the BOTTOM EDGE rather than a fraction of the height, and clear of the
        // home indicator. A quarter of the way up put it in the middle of the route, where
        // it covered two stops and read as part of the road; down here it is a bar the route
        // runs behind, which is what the reference does with its own.
        const startY = -h / 2 + safeInsets().bottom * h + START_H / 2 + START_MARGIN;
        const start = this.buildStart(startY);
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
        this.topPlate.active = on;
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
        // The street's road runs stop to stop, so it is built from the same number at the same
        // moment -- there is no state in which one of the two exists and the other does not.
        this.scene.build(levelCount);
        for (let i = 0; i < levelCount; i++) this.stops.push(this.buildStop(i));
        this.layout();
    }

    private buildStop(i: number): Stop {
        const node = new Node(`Stop${i + 1}`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(STOP_W, STOP_H);
        this.railRoot.addChild(node);
        const fade = node.addComponent(UIOpacity);

        // The halo first, so it sits behind the chip and reads as a glow rather than a frame.
        const ring = roundedSprite(
            'ring', STOP_W + STOP_RING_PAD * 2, STOP_H + STOP_RING_PAD * 2,
            STOP_RING, STOP_R + 8,
        );
        node.addChild(ring);
        const ringFade = ring.addComponent(UIOpacity);
        const base = roundedSprite('base', STOP_W, STOP_H, STOP_BASE, STOP_R);
        node.addChild(base);
        base.setPosition(0, -BTN_LIFT, 0);
        const face = roundedSprite('face', STOP_W, STOP_H, STOP, STOP_R);
        node.addChild(face);
        const num = makeLabel(face, 'n', 62, STOP_NUM_Y);
        num.node.setPosition(0, STOP_NUM_Y, 0);
        num.color = STOP_INK;
        num.isBold = true;
        num.string = `${i + 1}`;

        const lock = this.buildLock(face);
        const stars: Node[] = [];
        for (let s = 0; s < STAR_MAX; s++) {
            const star = starSprite(`star${s}`, STOP_STAR_D, STAR_OFF);
            face.addChild(star);
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
        // Left of centre, because the level's number sits to its right now.
        lock.setPosition(LOCK_X_SHUT, STOP_NUM_Y, 0);
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
            // THE NUMBER STAYS ON WHEN IT IS LOCKED, beside the padlock rather than instead
            // of it. Hiding it made every locked stop identical -- a column of eight
            // indistinguishable pills with no way to tell which level you were looking at,
            // which is not what a route is for. The reference shows the number on its locked
            // stops too. Dimmer, so a locked number does not read as an invitation.
            stop.num.node.active = true;
            stop.num.color = open ? STOP_INK : STOP_INK_SHUT;
            stop.num.node.setPosition(open ? 0 : NUM_X_SHUT, STOP_NUM_Y, 0);
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
        const edge = this.h * 0.75;
        // THE STREET SCROLLS ON THIS OFFSET AND CULLS AGAINST THIS EDGE, the same two numbers
        // the stops below are about to use. `core/home-path` guarantees the road passes through
        // the stop centres; feeding the road a different scroll would spend that guarantee on
        // nothing, and the symptom -- a road running just past every badge -- looks like a
        // drawing mistake rather than an arithmetic one.
        this.scene.layout(this.offset, edge);
        for (let i = 0; i < this.stops.length; i++) {
            const stop = this.stops[i];
            // Level 1 at the bottom and the numbers climbing, which is what makes the column
            // read as a route rather than as a list: `railOffset` grows with i, and +y is up.
            const y = railOffset(i) - this.offset;
            if (Math.abs(y) > edge) {
                stop.node.active = false;
                continue;
            }
            stop.node.active = true;
            const t = Math.min(1, railStopT(this.offset, i));
            const scale = 1 + (STOP_REST - 1) * t;
            // x FROM `home-path`, not from a local copy of the zig: the road is stroked through
            // `nodeCenter` and the stop has to stand on the same point, or the two drift apart
            // the moment either number is retuned.
            stop.node.setPosition(nodeCenter(i).x, y, 0);
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
    beginDrag(uiY: number, t: number): void {
        if (this.waiting || this.levelCount === 0) return;
        this.dragging = true;
        this.dragFromY = uiY;
        this.dragBase = this.offset;
        this.lastY = uiY;
        this.lastT = t;
        this.travelled = 0;
        this.vel = 0;
    }

    /** Whether a finger is currently on the rail. Lets the caller skip work per mouse move. */
    isDragging(): boolean {
        return this.dragging;
    }

    moveDrag(uiY: number, t: number): void {
        if (!this.dragging) return;
        this.travelled += Math.abs(uiY - this.lastY);
        // Negated once, here, and the sign survived the turn from a horizontal rail
        // unchanged. A finger moving DOWN has to bring LATER levels to the middle, because
        // later levels are drawn ABOVE and pulling the road down is what walks up it -- and
        // a downward drag is a falling uiY, so the same subtraction that used to mean "left"
        // now means "down". Nothing downstream thinks about the sign again.
        this.offset = railRubber(this.dragBase - (uiY - this.dragFromY), this.levelCount);
        this.target = this.offset;
        const dt = t - this.lastT;
        if (dt > 0.001) this.vel = -(uiY - this.lastY) / dt;
        this.lastY = uiY;
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

    /**
     * Whether `ui` landed on the hold target that clears the save.
     *
     * It was the title until the rail turned vertical and the title went. See where
     * `resetNode` is assigned: the caption carries it now.
     */
    hitsReset(ui: Vec3): boolean {
        if (!this.open() || this.waiting) return false;
        const p = this.resetNode.worldPosition;
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
            // Per axis, because the stop is a pill now and not a square: one `half` would
            // make the hit box 236 tall as well as wide, and the 124 units of gap between
            // two stops would be claimed by both of them.
            const halfW = (STOP_W * stop.node.scale.x) / 2 + TAP_PAD;
            const halfH = (STOP_H * stop.node.scale.y) / 2 + TAP_PAD;
            if (Math.abs(ui.x - p.x) <= halfW && Math.abs(ui.y - p.y) <= halfH) return i;
        }
        return -1;
    }
}
