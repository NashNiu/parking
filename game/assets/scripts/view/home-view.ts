import {
    Color, Label, Layers, Node, Sprite, tween, Tween, UIOpacity, UITransform, Vec3,
} from 'cc';
import { dotSprite, rampSprite, roundedSprite, starSprite, triSprite } from './ui-shapes';
import { barBottomY, canvasSize, makeLabel, safeInsets } from './ui-layout';
import { GROUND } from './palette';
import { TopBar } from './top-bar';
import {
    LevelState, levelState, Progress, STAR_MAX, starsFor, unlockedThrough,
} from '../core/index';
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
 * The rail's top edge: an OPAQUE CAP over the bar's whole band, and a ramp under it.
 *
 * A BADGE MUST NOT HARD-CUT ANYWHERE. The rail scrolls up past the top bar and `layout()` only
 * culls a stop at 0.75 of the screen height, which is far above the bar -- so without something
 * over it a 205 badge and its star row simply stop existing along a straight line. That line is
 * the artefact the floating plate was reported for (see where `TopBar`'s caption is built): an
 * edge that cuts a moving object reads as a clipping fault, not as a frame.
 *
 * IT TAKES TWO SPRITES, AND THE FIRST VERSION OF IT SHIPPED WITH ONLY ONE -- worth writing down
 * because the one-sprite version looks right and is exactly wrong. `rampSprite` is opaque along
 * its own TOP edge and gone by its bottom, so a lone ramp with its top at `barBottomY` covers a
 * badge completely as the badge climbs to that line and covers NOTHING above it. The badge
 * vanishes into the ramp and then reappears at full opacity one pixel higher, with a razor cut
 * across the full 1280 exactly at `barBottomY` -- the same artefact, moved up one band. The
 * uncovered band is `w * BAR_MARGIN_F + BAR_H` tall, the bar draws no background of its own, and
 * a badge reaches it after about half a pitch of drag. It is not an edge case.
 *
 * So the CAP is what makes the bar's band opaque and the RAMP is what dissolves the edge of the
 * cap. Both are painted in `GROUND` -- the pavement they are lying on -- and they meet at
 * `barBottomY`, where both are fully opaque, so the join is invisible and there is no hard edge
 * anywhere on the screen. Same tool and same argument as `HomeScene`'s side fades.
 *
 * WHAT IT COSTS, and it is more than the ramp alone cost: under the bar the road is now paled
 * ALL the way rather than partly, so the route reads as running out from under a band of
 * pavement. That is the trade -- the road up there is scenery, and the thing being protected is
 * the moving badge and the one line of type standing over it.
 *
 * THE CAP IS OVERSIZED the way `HomeScene`'s ground is, and for the same reason: a viewport
 * wider or taller than the design box otherwise shows a strip of bare clear colour past its
 * edge. It reaches to `h` rather than to `h / 2`.
 *
 * 110 for the ramp, a little over half a badge: enough for a 205 disc to be visibly dissolving
 * before its top edge reaches the cap, and not so much that the road looks washed out for a
 * whole screen.
 */
const RAIL_FADE_H = 110;

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
 * The play-head icon on the button's face, and the arithmetic that keeps icon-plus-label
 * reading as one unit rather than as centred text with an icon hanging off its left side.
 *
 * 40, inside `ui-shapes.ts`'s own note on `triSprite` that this icon is "never drawn larger
 * than about 48 design units -- an icon on the start button", which is exactly this one.
 *
 * Both positions fall out of one requirement: icon (width START_ICON_D), a gap
 * (START_ICON_GAP), then the label (width L), read as a block centred as a whole under the
 * button's own centre. Solving that for each node's centre, taking the label's own bounding
 * box as symmetric about its centre (Label's default anchor, untouched here):
 *   label centre = (START_ICON_D + START_ICON_GAP) / 2         -- independent of L
 *   icon centre  = -(START_ICON_GAP + L) / 2                    -- depends on L
 * The label's centre is therefore a plain constant, `START_LABEL_X`, good for every string it
 * ever carries. The icon's is NOT, because L changes between the playable string
 * ("开始 第 N 关") and the longer locked one ("通过第 N 关解锁") -- so the icon is
 * repositioned every time the label's string changes, in `setFocus`, using `L` read back from
 * the label itself via `Label.updateRenderData(true)`. That call is what makes `L` available
 * synchronously: a plain `.string` assignment leaves the node's `UITransform` width stale
 * until the renderer's next pass, but `updateRenderData(true)` flushes the assembler
 * immediately -- the same mechanism `RichText` uses to measure a label right after changing
 * it (see `updateRenderData` in the engine's `cocos/2d/components/label.ts`). It is not in
 * this project's own `.d.ts` stub, only in the engine's, which is what `tsconfig.view.json`
 * actually type-checks against (see its own comment on `game/temp/declarations/cc.d.ts`).
 *
 * `START_ICON_X` is used once, in `buildStart`, before the button has ever shown a real
 * string -- `setFocus` (reached through `setProgress`) always runs before the button is first
 * revealed, so this placeholder is never actually seen; it exists so the icon has SOME
 * position between construction and that first `setFocus` rather than sitting on the origin.
 */
const START_ICON_D = 40;
const START_ICON_GAP = 14;
const START_LABEL_X = (START_ICON_D + START_ICON_GAP) / 2;
const START_ICON_X = -START_W / 2 + START_R + START_ICON_D / 2 + 8;

/**
 * A ROUND BADGE, and its size is decided by the SAVE rather than by the scroll.
 *
 * WHAT THIS REPLACES, and why it is a bug fix rather than a restyle. The stops used to be
 * 236x148 pills that differed by state only in a shade of blue -- cleared was 59,108,168 and
 * the current level was 74,144,226, two steps apart on one hue -- while the one loud marker on
 * the screen, the green halo, was bound to the SCROLL POSITION. A player who dragged to level 4
 * saw a halo there and a button reading 开始 第 4 关, and nothing anywhere said that level 6 was
 * where they had actually got to. It was reported as an unlock bug; the unlock logic was
 * enumerated over all 1024 reachable saves and is correct. The screen simply had no language
 * for progress.
 *
 * So the three states now differ in FORM, not in shade: a cleared badge is green and carries a
 * row of stars, the current one is blue, a fifth larger, and breathing, a locked one is grey
 * and wears a padlock. Every one of those reads without scrolling, which is the whole test.
 *
 * AND THE SCROLL-DRIVEN SIZING IS GONE. `STOP_REST` used to shrink a stop continuously with its
 * distance from the middle, which was a nice piece of depth on a rail and is fatal here: a size
 * that changes while a finger drags is a size that cannot mean anything about the save. The
 * per-distance opacity fade went with it for the same reason -- "bright means cleared" is not a
 * sentence you can say while brightness is also saying "near the middle". The rail's focus
 * keeps the halo alone, which is the one signal that is genuinely about the scroll: it means
 * "the button opens this one".
 */
const NODE_D = Math.round(1280 * 0.16);
/** Stars at a quarter of the badge, the proportion the requirement names. */
const STAR_D = Math.round(NODE_D * 0.25);
const STAR_PITCH = 56;
/**
 * The star row's centre, BELOW the badge rather than inside it.
 *
 * Three at this pitch span 2 * 56 + 51 = 163, narrower than the 205 badge, so the row reads as
 * belonging to the badge above it rather than as a bar of its own. The row bottoms out at
 * -(136 + 25.5) = -161.5, which is one of the two terms `RAIL_PITCH` (340) is derived from --
 * see `core/home-path`. Do not move it without re-reading that derivation.
 *
 * The 8 of gap is measured off the FACE. The base sits `BTN_LIFT` lower, so at the centreline
 * the base's lowest point and the middle star's highest point are the same y: they touch at one
 * point and overlap nowhere. That is tight on purpose -- the stars have to read as attached.
 */
const STAR_Y = -(NODE_D / 2 + 8 + STAR_D / 2);
/**
 * The current level's scale, which is also the FLOOR of its breath -- see `breath`.
 *
 * 1.2 is the figure the requirement asks for, and `BREATHE_TO` is a 5% swell above it, NOT a
 * multiplier applied to it: 1.2 * 1.26 would put the badge at 1.51 and a quarter bigger than
 * anyone asked for.
 */
const CUR_SCALE = 1.2;
const BREATHE_TO = 1.26;
const BREATHE_TIME = 1.6;

/** Cleared: bright. A finished level is a result, and it should look like one. */
const NODE_DONE = new Color(86, 199, 104, 255);
const NODE_DONE_BASE = new Color(56, 156, 76, 255);
/** The current level: the one thing on this screen that moves, in the primary blue. */
const NODE_CUR = new Color(74, 144, 226, 255);
const NODE_CUR_BASE = new Color(44, 96, 165, 255);
/** Not yet reached: grey, and wearing a padlock instead of its number. */
const NODE_LOCK = new Color(52, 62, 90, 255);
const NODE_LOCK_BASE = new Color(38, 46, 70, 255);
const STOP_INK = new Color(255, 255, 255, 240);
/**
 * The halo on the middle stop. It fades out as that stop leaves the middle, and it is now the
 * ONLY thing the scroll position draws -- see NODE_D. It says "the button opens this one",
 * which is a fact about the rail and not about the save, so it is painted in the button's own
 * green rather than in any of the three state colours.
 */
const STOP_RING = new Color(86, 199, 104, 90);
const STOP_RING_PAD = 15;

const STAR_ON = new Color(255, 201, 52, 255);
const STAR_OFF = new Color(70, 82, 116, 255);

/**
 * The padlock on a locked stop, drawn from the primitives that exist: a round shackle with a
 * stop-coloured rounded sprite over its middle to cut it hollow, and the body over the join.
 * `ui-shapes` has no ring, and an emoji lock is one font substitution away from a hollow box
 * -- the same reason the HUD's home button says 主页 rather than wearing a glyph.
 *
 * It is drawn at the size it was when it shared a pill with the level's number and then scaled
 * up as a whole, rather than every piece being re-typed: three sprites that have to keep their
 * proportions are one node with one factor on it.
 */
const LOCK_INK = new Color(150, 163, 196, 255);
/** The padlock has the badge to itself now, so it is drawn to fill it. See `setProgress`. */
const LOCK_SCALE = 1.6;

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

/** Everything drawn for one level. Kept so `setProgress` can repaint without rebuilding. */
interface Stop {
    node: Node;
    ringFade: UIOpacity;
    face: Node;
    base: Node;
    num: Label;
    lock: Node;
    stars: Node[];
    /**
     * What the save says about this level, and the ONLY thing that decides how it is drawn.
     * `open` is derived from it rather than computed alongside it -- see `setProgress`.
     */
    state: LevelState;
    open: boolean;
}

export class HomeView {
    /** Everything this screen draws, under one node, so `show`/`hide` is one flag. */
    private root: Node;
    /**
     * The standing top bar. NOT in `revealMenu` -- see `top-bar.ts`: the coin count and the
     * gear are true while the barrier is still down, so the bar is up from the first frame.
     */
    private topBar: TopBar;
    private startBtn: Node;
    private startFace: Node;
    private startBase: Node;
    private startLabel: Label;
    private startIcon: Node;
    /** The street the rail runs up. See `home-scene`. */
    private scene: HomeScene;
    /** The stops' parent, parked on the lane. Stops are positioned within it. */
    private railRoot: Node;
    private stops: Stop[] = [];
    /**
     * The current level's scale, right now, while it breathes.
     *
     * A NUMBER IN A BOX RATHER THAN THE NODE'S OWN SCALE, and this is the one trap in this
     * file worth naming. `layout()` runs every frame and writes `setScale` on every visible
     * stop, so a tween on the node's scale would be overwritten before it was ever drawn -- the
     * badge would simply sit still and nothing would say why. The tween drives this field
     * instead and `layout()` reads it, which makes the two cooperate rather than race.
     *
     * A BOX (`{ v }`) rather than a bare field because `cc.tween` animates the PROPERTIES of an
     * object it is handed, and it cannot be handed a primitive.
     *
     * It is the ABSOLUTE scale, not a multiplier: it rests at `CUR_SCALE` and swells to
     * `BREATHE_TO`. Multiplying it into `CUR_SCALE` again would give 1.51.
     */
    private breath = { v: CUR_SCALE };
    /**
     * Whether the save HAS a current level to breathe, remembered so `show` can restart the
     * tween `hide` stopped without having to re-read the progress.
     *
     * False for a save with every level cleared, and false before the first `setProgress`.
     */
    private breathing = false;

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
     * The bar's bottom edge, READ ONCE in the constructor and used for everything on this
     * screen that measures off it: the rail's centre, the cap and the ramp above it, and the
     * bar itself -- `TopBar` is HANDED this number rather than calling `barBottomY` again, and
     * its constructor's docblock argues that at length.
     *
     * A SNAPSHOT RATHER THAN A CALL PER USE, because `capsuleInset()` no longer caches a failed
     * read (see `ui-layout` -- it used to, and a capsule that was not ready on the first call
     * pinned the bar under the system UI for the rest of the session). That retry is the right
     * behaviour and it means `barBottomY` can legitimately return one number early in a session
     * and a larger one later. `railCenterY()` is called again from `setLevels`, several frames
     * after the bar and the cap were built, so without this the rail could end up centred on a
     * band the bar is not in -- which is the exact disagreement `BAR_H` and `barBottomY` were
     * put in `ui-layout` to prevent, arriving through the back door.
     *
     * ONE READ IS THE POINT, not "few reads". While `TopBar` still called `barBottomY` for
     * itself the bar and the rail agreed only by ARGUMENT -- wx cannot change state between two
     * statements of one synchronous constructor, which is true and is not a guarantee. With the
     * number passed down there is a single read on this screen and everything below it is given
     * the result, so the agreement holds by construction and a reader does not have to
     * reconstruct the timing argument to trust it.
     */
    private barBottom = 0;

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
        // BEFORE ANYTHING READS IT, and it is the ONLY call to `barBottomY` on this screen --
        // the rail, the cap, the ramp and the bar are all given this one number. See the field.
        this.barBottom = barBottomY(w, h);

        this.root = new Node('Home');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        canvas.addChild(this.root);

        // THE STREET GOES IN FIRST, and that is the whole of its z-ordering: everything after
        // it -- the stops, the cap over them, the top bar, the button -- draws over it. It
        // builds only its ground here; the road itself needs the level count, so it is
        // finished in `setLevels`.
        this.scene = new HomeScene(this.root, w, h);

        // NO TITLE. The route fills the screen top to bottom now, and the game's name is
        // already the largest thing on the first screen this hands over from -- a second
        // copy of it over the road is a caption on a picture that has one. The level count
        // that used to sit under it is in the top bar; see below.
        this.railRoot = new Node('RailStops');
        this.railRoot.layer = Layers.Enum.UI_2D;
        this.railRoot.addComponent(UITransform);
        this.root.addChild(this.railRoot);
        // The rail hangs off the middle of the FREE BAND, not off the middle of the canvas --
        // see `railCenterY`. The street has to hang off the same y or the road comes out
        // parallel to the badges and a few dozen units beside them.
        this.railRoot.setPosition(0, this.railCenterY(), 0);
        this.scene.setRailCenter(this.railCenterY());

        // AFTER THE RAIL AND BEFORE THE BAR, so both of these draw over the scrolling stops and
        // under the row that stands on them. See RAIL_FADE_H for why it takes two sprites and
        // what the one-sprite version does instead.
        const cap = roundedSprite('RailCap', w * 2, h - this.barBottom, GROUND, 2);
        this.root.addChild(cap);
        cap.setPosition(0, (this.barBottom + h) / 2, 0);
        const fade = rampSprite('RailFade', w * 2, RAIL_FADE_H, GROUND);
        this.root.addChild(fade);
        fade.setPosition(0, this.barBottom - RAIL_FADE_H / 2, 0);

        // THE FLOATING PLATE IS GONE and the count it carried is in the bar. The plate was a
        // 320x88 slab over the road with a 205-wide badge scrolling behind it; the badge is
        // about 285 tall once its star row is counted, so it stuck out top and bottom and the
        // pair read as clipping. The clear-save hold that had taken the title's place on that
        // plate went with it -- see `GameController`, where its timer used to live; the
        // settings card grows an explicit button with a confirmation instead.
        this.topBar = new TopBar(this.root, w, this.barBottom);

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
        this.startIcon = start.icon;

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
    private buildStart(
        y: number,
    ): { node: Node; face: Node; base: Node; label: Label; icon: Node } {
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
        // Left of the label -- see START_ICON_X for where and why.
        const icon = triSprite('icon', START_ICON_D, Color.WHITE);
        face.addChild(icon);
        icon.setPosition(START_ICON_X, 0, 0);
        const label = makeLabel(face, 'HomeStartLabel', 46, 0, START_LABEL_X);
        label.isBold = true;
        label.string = '开始游戏';
        return { node: btn, face, base, label, icon };
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

    /**
     * Everything that belongs to the MENU, on or off. The top bar is deliberately absent: it
     * is standing, and it is up while the barrier is still down. See `top-bar.ts`.
     */
    private revealMenu(on: boolean): void {
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
        this.topBar.setCaption(`共 ${levelCount} 关`);
        // The street's road runs stop to stop, so it is built from the same number at the same
        // moment -- there is no state in which one of the two exists and the other does not.
        this.scene.build(levelCount);
        for (let i = 0; i < levelCount; i++) this.stops.push(this.buildStop(i));
        this.railRoot.setPosition(0, this.railCenterY(), 0);
        this.scene.setRailCenter(this.railCenterY());
        this.layout();
    }

    private buildStop(i: number): Stop {
        const node = new Node(`Stop${i + 1}`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(NODE_D, NODE_D);
        this.railRoot.addChild(node);

        // The halo first, so it sits behind the badge and reads as a glow rather than a frame.
        // A DOT, like everything else here: a rounded square around a circle shows its four
        // corners as green ears.
        const ring = dotSprite('ring', NODE_D + STOP_RING_PAD * 2, STOP_RING);
        node.addChild(ring);
        const ringFade = ring.addComponent(UIOpacity);
        const base = dotSprite('base', NODE_D, NODE_CUR_BASE);
        node.addChild(base);
        // The base peeks out below the face, the lip every pressable thing in this project
        // wears -- see BTN_LIFT. On a circle it shows as a crescent along the bottom edge.
        base.setPosition(0, -BTN_LIFT, 0);
        const face = dotSprite('face', NODE_D, NODE_CUR);
        node.addChild(face);
        const num = makeLabel(face, 'n', 62, 0);
        num.color = STOP_INK;
        num.isBold = true;
        num.string = `${i + 1}`;

        const lock = this.buildLock(face);
        // THE STARS HANG OFF `node`, NOT OFF `face`: they are below the badge now rather than
        // inside it, so they are a sibling of the badge and not part of it.
        const stars: Node[] = [];
        for (let s = 0; s < STAR_MAX; s++) {
            const star = starSprite(`star${s}`, STAR_D, STAR_OFF);
            node.addChild(star);
            star.setPosition((s - (STAR_MAX - 1) / 2) * STAR_PITCH, STAR_Y, 0);
            star.active = false;
            stars.push(star);
        }
        return { node, ringFade, face, base, num, lock, stars, state: 'locked', open: false };
    }

    /** See LOCK_INK: a padlock out of three sprites, the middle one a hole. */
    private buildLock(face: Node): Node {
        const lock = new Node('lock');
        lock.layer = Layers.Enum.UI_2D;
        lock.addComponent(UITransform);
        face.addChild(lock);
        // DEAD CENTRE, and the level's number is switched off behind it -- see `setProgress`.
        lock.setPosition(0, 0, 0);
        lock.setScale(LOCK_SCALE, LOCK_SCALE, 1);
        const shackle = dotSprite('shackle', 38, LOCK_INK);
        lock.addChild(shackle);
        shackle.setPosition(0, 13, 0);
        // The hole is a hole: it is painted the face's own colour, so it must track it.
        const hole = roundedSprite('hole', 18, 24, NODE_LOCK, 9);
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
        let hasCurrent = false;
        for (let i = 0; i < this.stops.length; i++) {
            const level = i + 1;
            const stop = this.stops[i];
            // ONE SOURCE OF TRUTH. `levelState` returns a three-way union, so the states are
            // mutually exclusive by construction and this loop cannot come away holding two of
            // them at once. It used to read `open = isUnlocked(...)` and `done = bestStars(...)
            // > 0` and then draw stars as `open && done` -- two independent facts that a call
            // site had to remember to combine, and the `&&` is the only thing that stopped a
            // gapped save from painting three stars on a level it had locked.
            //
            // `bestStars` is deliberately NOT called here, and `logic/tests/view-source.test.ts`
            // fails if it comes back: `starsFor` already returns 0 for anything that is not
            // `done`, so asking the core twice is the second source of truth arriving again.
            const state = levelState(p, level);
            const best = starsFor(p, level);
            stop.state = state;
            // Derived, not computed in parallel: what `setFocus` and `hitsStart` need is "may
            // this be played", which is exactly "not locked".
            stop.open = state !== 'locked';
            if (state === 'current') hasCurrent = true;
            stop.face.getComponent(Sprite)!.color =
                state === 'done' ? NODE_DONE : (state === 'current' ? NODE_CUR : NODE_LOCK);
            stop.base.getComponent(Sprite)!.color = state === 'done'
                ? NODE_DONE_BASE
                : (state === 'current' ? NODE_CUR_BASE : NODE_LOCK_BASE);
            // THE NUMBER GOES OFF WHEN IT IS LOCKED, and that reverses the decision the old
            // comment here argued for. It is the SHAPE that changed, not the argument: the old
            // stop was a 236-wide pill, so a padlock could sit left of centre with the number
            // beside it and both could be read. A 205 circle has room for one of the two. The
            // padlock wins, because "you have not got here yet" is what a locked stop is for
            // saying, and the road itself counts the levels off in order for anyone who wants
            // to know which one they are looking at.
            stop.num.node.active = state !== 'locked';
            stop.lock.active = state === 'locked';
            for (let s = 0; s < stop.stars.length; s++) {
                // Absent, not empty, on a level never cleared: three grey stars would say it
                // was cleared with none, which cannot happen (the rating floors at one).
                stop.stars[s].active = state === 'done';
                stop.stars[s].getComponent(Sprite)!.color = s < best ? STAR_ON : STAR_OFF;
            }
        }
        this.setBreathing(hasCurrent);
        this.setFocus(Math.max(1, Math.min(this.levelCount, unlockedThrough(p))) - 1);
        // Land there rather than glide there: this runs as the screen appears, and a rail
        // that slides in from level 1 every time would be an animation of loading a save.
        this.offset = this.target;
        this.layout();
    }

    /**
     * Start or stop the current level's breath.
     *
     * IT IS BOUND TO THE SAVE, NOT TO THE SCROLL, and that is the entire point of it. The badge
     * that breathes is the one the progress says you are up to; the badge in the middle of the
     * screen wears a halo instead. Two facts, two marks -- the screen this replaces had one
     * mark for both, so dragging the rail moved the only thing that looked like "you are here".
     *
     * Driven from `setProgress` rather than from `layout()` for the same reason: `layout()` only
     * knows where the rail is.
     *
     * `stopAllByTarget` first, because `setProgress` is called again every time a level ends --
     * without it each return to the lobby would stack another repeating tween on the same field
     * and the breath would get faster and deeper for the rest of the session.
     *
     * A game with every level cleared has no current level at all, and then there is nothing to
     * breathe: the tween is stopped and the field is parked at its resting value.
     *
     * `hide` stops it too and `show` restarts it from `breathing`, which is why the answer is
     * remembered rather than recomputed -- a `repeatForever` left running through a whole level
     * costs almost nothing, but this file's habit is that whatever starts a tween is responsible
     * for stopping it, and a habit with an exception in it is not a habit.
     */
    private setBreathing(on: boolean): void {
        this.breathing = on;
        Tween.stopAllByTarget(this.breath);
        this.breath.v = CUR_SCALE;
        if (!on) return;
        tween(this.breath)
            .to(BREATHE_TIME, { v: BREATHE_TO }, { easing: 'sineInOut' })
            .to(BREATHE_TIME, { v: CUR_SCALE }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    /**
     * The y the rail is centred on: the middle of the free band between the top bar's bottom
     * edge and the start button's top edge.
     *
     * NOT THE CANVAS CENTRE, because the canvas centre is not the centre of anything the player
     * can see: a bar eats into the space from above and the start button eats into it from
     * below, and the two bites are not the same size. Centring on the free band puts the badge
     * the rail has scrolled to in the middle of the room it actually has.
     *
     * IT IS A SMALL MOVE, and this docblock used to overclaim it. On h = 2770 with no insets
     * the band centre is +35.8, and with a typical notch and home indicator +21.95 -- about a
     * tenth of a badge. It is a tidier layout, NOT the fix for 打开大厅没滚到当前关. That
     * complaint was the halo: it was the only loud marker on the screen and it followed the
     * scroll, so the badge a player had dragged to looked like the badge they were up to. What
     * fixes it is the three state badges, not this function.
     */
    private railCenterY(): number {
        const top = this.barBottom;
        const bottom = -this.h / 2 + safeInsets().bottom * this.h + START_MARGIN + START_H;
        return (top + bottom) / 2;
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
        // Drained in step with the face and base, right here rather than in a second place
        // that could fall out of step with them -- STAR_OFF is this file's own colour for
        // "not lit", already worn by a star that has not been earned.
        this.startIcon.getComponent(Sprite)!.color = this.focusOpen ? Color.WHITE : STAR_OFF;
        this.startLabel.string = this.focusOpen
            ? `开始 第 ${this.focused + 1} 关`
            : `通过第 ${this.focused} 关解锁`;
        // Flush the assembler so the label's UITransform width is the SETTLED width of the
        // string just above, not last frame's -- see START_ICON_D for why this is safe to
        // rely on. Only then can the icon be placed exactly, rather than approximately, for
        // whichever of the two strings just went up.
        this.startLabel.updateRenderData(true);
        const labelW = this.startLabel.node.getComponent(UITransform)!.width;
        this.startIcon.setPosition(-(START_ICON_GAP + labelW) / 2, 0, 0);
    }

    /** Bring stop `i` to the middle, on a tap. */
    focusStop(i: number): void {
        this.setFocus(i);
    }

    /**
     * Pressed drops the face onto the base by BTN_LIFT; released returns it to rest. That is
     * the whole effect -- no scale, no colour change. Every pressable thing on this screen is
     * a face over a base with a visible lip (see BTN_LIFT), so taking the lip away IS the
     * press: it reuses the vocabulary the resting state already wears instead of inventing a
     * second one.
     */
    setStartPressed(on: boolean): void {
        this.startFace.setPosition(0, on ? -BTN_LIFT : 0, 0);
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
     * Place every stop for the current offset.
     *
     * BOTH COORDINATES COME FROM `nodeCenter`, which is the same function `home-scene` strokes
     * the road through. That is what makes "the road passes through the badge centres" a fact
     * rather than two pieces of arithmetic that happen to agree today -- the old lobby's dashed
     * line and its column of pills were computed separately, and looked it.
     *
     * SCALE COMES FROM THE STATE, NOT FROM THE DISTANCE. Only the halo is continuous in
     * `offset` now; see NODE_D for what that costs and why it is worth it. The current level's
     * scale is read out of `breath`, which a tween is driving -- writing it here and tweening
     * the node would be the two of them fighting over the same property every frame.
     *
     * Stops fully off screen are deactivated; ones at the edge are left to be clipped by the
     * screen itself, because a half-visible badge is what says there is more rail.
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
            // read as a route rather than as a list: `nodeCenter(i).y` grows with i, and +y is
            // up. It is the same value `railOffset(i)` returns -- both are `i * RAIL_PITCH` --
            // and taking it from `home-path` is what ties the badge to the road it stands on.
            const c = nodeCenter(i);
            const y = c.y - this.offset;
            if (Math.abs(y) > edge) {
                stop.node.active = false;
                continue;
            }
            stop.node.active = true;
            const scale = stop.state === 'current' ? this.breath.v : 1;
            stop.node.setPosition(c.x, y, 0);
            stop.node.setScale(scale, scale, 1);
            // The halo belongs to the middle alone, and is gone by half a pitch out, so two
            // badges are never wearing it at once.
            const t = Math.min(1, railStopT(this.offset, i));
            stop.ringFade.opacity = Math.round(255 * Math.max(0, 1 - t * 2));
        }
    }

    show(): void {
        this.root.active = true;
        // Restarted here rather than left to the caller. `GameController.showHome` does call
        // `setProgress` immediately before this, so in practice the breath is already running --
        // but a screen that only animates because of what its caller happens to do next is one
        // refactor away from a badge that sits still.
        this.setBreathing(this.breathing);
        // To the front. Seat chips and tunnel badges are appended to the canvas as a level
        // runs, which makes them later -- and so higher-drawing -- siblings than anything
        // built at startup. The HUD's panels raise themselves for the same reason.
        this.root.setSiblingIndex(this.root.parent!.children.length - 1);
    }

    hide(): void {
        this.root.active = false;
        // Stop what this screen started. The rest of the file already does this for the gate
        // arm and the loading fade; the breath was the one tween left ticking off screen.
        // `breathing` is deliberately NOT cleared -- it is what the save says, not what is
        // currently running, and `show` reads it back.
        Tween.stopAllByTarget(this.breath);
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

    // --- the top bar ------------------------------------------------------------------

    /**
     * Forwarded to the bar rather than exposing it, so `GameController` talks to one screen
     * object. The bar is STANDING, so none of these consults `waiting` the way the rail's own
     * hit tests do -- the gear and the coin count mean the same thing while the barrier is
     * down as they do after it lifts.
     *
     * ALL FIVE OF THEM, and that is not tidiness. `hitsSlot` can only ever return -1 unless
     * `setSlot` has populated a place, and the handler `setSlot` was given is only reachable
     * through `tapSlot` -- forwarding a subset would leave a caller holding one end of a
     * three-part protocol with no way to reach the other two.
     */
    setCoins(n: number): void {
        this.topBar.setCoins(n);
    }

    hitsGear(ui: Vec3): boolean {
        return this.topBar.hitsGear(ui);
    }

    hitsSlot(ui: Vec3): 0 | 1 | -1 {
        return this.topBar.hitsSlot(ui);
    }

    setSlot(i: 0 | 1, slot: { icon: Node; onTap: () => void } | null): void {
        this.topBar.setSlot(i, slot);
    }

    tapSlot(i: 0 | 1): void {
        this.topBar.tapSlot(i);
    }

    /** Whether `ui` (UI-space) landed on the start button, and there is a level to start. */
    hitsStart(ui: Vec3): boolean {
        if (!this.open() || this.waiting || !this.focusOpen) return false;
        const p = this.startBtn.worldPosition;
        return Math.abs(ui.x - p.x) <= START_W / 2 + TAP_PAD
            && Math.abs(ui.y - p.y) <= START_H / 2 + TAP_PAD;
    }

    /**
     * Which stop `ui` landed on, 0-based, or -1 for none. A tap on a stop brings it to the
     * middle; it does NOT start the level, which is the button's job alone.
     *
     * Measured against the badge's DRAWN size, which is now its STATE's size: only the current
     * level is scaled, and only it can change size while a finger is on the screen. The
     * paragraph that used to sit here reasoned about a resting size that shrank with distance
     * from the middle, and that no longer exists -- see NODE_D. See the box itself below for
     * why no two of them can ever meet.
     */
    hitsStop(ui: Vec3): number {
        if (!this.open() || this.waiting) return -1;
        for (let i = 0; i < this.stops.length; i++) {
            const stop = this.stops[i];
            if (!stop.node.active) continue;
            const p = stop.node.worldPosition;
            // ONE `half`, because the badge is a circle: the two axes are the same measure
            // again, which they were not while it was a pill. Squared off rather than tested
            // radially, which makes the corners of the box slightly generous -- and a hit box
            // that is a touch forgiving at the corners is the right side to err on for a target
            // a thumb is aiming at. The widest it ever gets is the breathing badge's 139, against
            // the 170 that is half of `RAIL_PITCH`, so no two boxes can ever meet in the middle
            // and claim the same tap.
            const half = (NODE_D * stop.node.scale.x) / 2 + TAP_PAD;
            if (Math.abs(ui.x - p.x) <= half && Math.abs(ui.y - p.y) <= half) return i;
        }
        return -1;
    }
}
