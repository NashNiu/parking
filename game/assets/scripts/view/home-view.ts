import { Color, Label, Layers, Node, Sprite, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { roundedSprite, starSprite } from './ui-shapes';
import { canvasSize, makeLabel, safeInsets } from './ui-layout';
import { bestStars, isUnlocked, Progress, STAR_MAX, unlockedThrough } from '../core/index';

/**
 * The home screen: the game's name, one button that starts playing, and the level grid.
 *
 * It is a UI screen in the SAME canvas as the HUD, not a Cocos scene of its own. A second
 * scene would mean a second copy of the camera rig and the preload chain that `start()`
 * spends its first frames on, and a scene load between the menu and the board -- for a
 * screen that is nine sprites and a dozen labels. `GameController.screen` decides which of
 * the two is up, and the board simply is not built while this one is.
 *
 * It draws the save, and it is the only place the gate is enforced (`hitsLevel` refuses a
 * locked chip). One place, because this screen owns the chips' state -- a second check
 * elsewhere could only disagree with what the player can see.
 */

/**
 * A placeholder, and named so it is easy to find: the game has no title yet. One constant,
 * one string.
 */
const GAME_TITLE = '停车场';

/** Covers the whole canvas, so the empty 3D scene behind the menu is never visible. */
const BG = new Color(24, 30, 50, 255);
const TITLE_INK = new Color(255, 255, 255, 255);
const SUB_INK = new Color(150, 163, 196, 255);

const START_W = 400;
const START_H = 116;
const START_R = 40;
const START = new Color(86, 199, 104, 255);
const START_BASE = new Color(56, 156, 76, 255);
/** How far the base peeks out below the face. Same lip the HUD's buttons wear. */
const BTN_LIFT = 8;

const CHIP_D = 100;
const CHIP_R = 28;
const CHIP = new Color(74, 144, 226, 255);
const CHIP_BASE = new Color(44, 96, 165, 255);
const CHIP_INK = new Color(255, 255, 255, 240);
/**
 * A locked chip: the same shape, drained. Dark enough to read as unavailable against the blue
 * of an open one, light enough to still read as one of the row -- the grid is ten chips and
 * should look like ten, the same argument the bay's locked stalls settled.
 */
const CHIP_LOCKED = new Color(52, 62, 90, 255);
const CHIP_LOCKED_BASE = new Color(38, 46, 70, 255);
const CHIP_PITCH_X = 118;
/**
 * 140 for a 100-unit chip, so there are 40 units of clear space under each row rather than
 * the 18 an even grid would give. That band holds the three small stars each cleared level
 * reports -- reserving it when the screen was first built is what kept adding them from
 * moving every chip.
 */
const CHIP_PITCH_Y = 140;
/** Five across fits 10 levels in two rows, and 10 is what the game ships. */
const COLS = 5;

/**
 * The rating under a chip: three small stars, `CHIP_STAR_Y` below its centre, which puts them
 * in the band CHIP_PITCH_Y reserves. Absent entirely on a level never cleared -- an empty row
 * of three would say "cleared with nothing", which is not a thing that can happen.
 */
const CHIP_STAR_D = 22;
const CHIP_STAR_PITCH = 26;
const CHIP_STAR_Y = -66;
const CHIP_STAR_ON = new Color(255, 201, 52, 255);
/** Dim, but lighter than the background it sits on -- an unearned star still has a place. */
const CHIP_STAR_OFF = new Color(70, 82, 116, 255);

/**
 * The padlock on a locked chip, drawn from the primitives that exist.
 *
 * `ui-shapes` has no ring, so the shackle is a rounded square with a chip-coloured rounded
 * square over its middle to cut it hollow, and the body goes on top of the join. Later
 * siblings draw over earlier ones, which is the whole mechanism.
 *
 * Not an emoji lock: 🔒 is one font substitution away from a hollow box on a device whose
 * system font lacks it, the same reason the HUD's home button says 主页 rather than wearing a
 * glyph.
 */
const LOCK_INK = new Color(150, 163, 196, 255);
const LOCK_SHACKLE_D = 34;
const LOCK_SHACKLE_Y = 12;
const LOCK_HOLE_W = 18;
const LOCK_HOLE_H = 22;
const LOCK_BODY_W = 44;
const LOCK_BODY_H = 32;
const LOCK_BODY_Y = -10;

/**
 * The line that stands where the start button will be while the game is still loading.
 *
 * IN THE SAME PLACE as the button it is waiting for, so the eye does not have to move when
 * one becomes the other. It pulses because a still "loading" is indistinguishable from a
 * frozen one, and a frozen loading screen is the failure this screen exists to make visible
 * (see PRELOAD_DEADLINE in GameController: a preload has up to eight seconds to answer).
 */
const LOADING_SIZE = 34;
const LOADING_INK = new Color(150, 163, 196, 255);
const LOADING_PULSE = 0.7;
const LOADING_DIM = 110;

/** Slack around a tap, in design units: the same padding the HUD's own hit tests use. */
const TAP_PAD = 10;

/**
 * The title's hit box, for the press-and-hold that clears the save. Much larger than the
 * three characters it covers, because it is a hidden control: a player who has been told
 * where it is should not also have to find it precisely.
 */
const TITLE_HIT_W = 400;
const TITLE_HIT_H = 140;

/** Everything drawn for one level. Kept so `setProgress` can repaint without rebuilding. */
interface Chip {
    node: Node;
    face: Node;
    base: Node;
    num: Label;
    lock: Node;
    stars: Node[];
    /** Set by `setProgress`; read by `hitsLevel`, which is how the gate is enforced. */
    open: boolean;
}

export class HomeView {
    /** Everything this screen draws, under one node, so `show`/`hide` is one flag. */
    private root: Node;
    private startBtn: Node;
    private startLabel: Label;
    private titleNode: Node;
    /** One per level, in level order, so the index IS the level number minus one. */
    private chips: Chip[] = [];
    /** 0 until `setLevels` has been told, which is also what "the grid exists" means. */
    private levelCount = 0;
    private sub: Label;
    private pickCap: Label;
    private loading: Label;
    private loadingFade: UIOpacity;
    /** Whether the screen is still waiting. Every hit test refuses while it is true. */
    private waiting = true;
    /** Where the grid starts, kept because it is built later than the constructor. */
    private gridTopY: number;

    /**
     * Builds everything that does NOT depend on knowing the levels: the background, the
     * title, and the line that says the game is still loading.
     *
     * Split that way so this screen can be on the canvas from the first frame the engine
     * draws. The Cocos first screen ends BEFORE the app starts -- `game.js` has it as
     * `firstScreen.end().then(() => application.start())` -- so between that logo and this
     * menu there is a stretch with nothing drawn in it but the camera's clear colour. The
     * grid arrives with `setLevels` once the level count can be read.
     */
    constructor(canvas: Node) {
        const { w, h } = canvasSize(canvas);

        this.root = new Node('Home');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        canvas.addChild(this.root);

        // Twice the canvas, like the modal scrims: a viewport wider than the design
        // resolution would otherwise show a strip of empty 3D scene down either side.
        const bg = roundedSprite('HomeBg', w * 2, h * 2, BG, 2);
        this.root.addChild(bg);

        // Under the notch, not under the top edge -- the same reservation the HUD's title
        // plate makes, for the same reason.
        const titleY = h / 2 - safeInsets().top * h - h * 0.17;
        const title = makeLabel(this.root, 'HomeTitle', 80, titleY);
        title.color = TITLE_INK;
        title.isBold = true;
        title.string = GAME_TITLE;
        this.titleNode = title.node;

        this.sub = makeLabel(this.root, 'HomeSub', 30, titleY - 78);
        this.sub.color = SUB_INK;
        this.sub.node.active = false;

        const start = this.buildStart(h * 0.04);
        this.startBtn = start.node;
        this.startLabel = start.label;
        this.pickCap = makeLabel(this.root, 'HomePickCap', 30, -h * 0.10);
        this.pickCap.color = SUB_INK;
        this.pickCap.string = '选择关卡';

        this.loading = makeLabel(this.root, 'HomeLoading', LOADING_SIZE, h * 0.04);
        this.loading.color = LOADING_INK;
        this.loading.string = '加载中…';
        this.loadingFade = this.loading.node.addComponent(UIOpacity);

        this.gridTopY = -h * 0.10 - 92;
        this.setLoading(true);
        this.root.active = false;
    }

    /**
     * Show or hide the waiting state: the loading line stands in for the start button and the
     * grid, and every hit test refuses while it is up.
     *
     * One flag drives the visibility AND the hit tests, the discipline SPEED_BUTTON and
     * PICK_ROW settled: a control that is invisible but still answering taps would start a
     * level out of a screen that has not finished loading one.
     */
    setLoading(on: boolean): void {
        this.waiting = on;
        this.loading.node.active = on;
        this.startBtn.active = !on;
        this.pickCap.node.active = !on;
        this.sub.node.active = !on;
        for (const chip of this.chips) chip.node.active = !on;
        Tween.stopAllByTarget(this.loadingFade);
        this.loadingFade.opacity = 255;
        if (on) {
            tween(this.loadingFade)
                .to(LOADING_PULSE, { opacity: LOADING_DIM }, { easing: 'sineInOut' })
                .to(LOADING_PULSE, { opacity: 255 }, { easing: 'sineInOut' })
                .union()
                .repeatForever()
                .start();
        }
    }

    /**
     * Tell the screen how many levels there are, and build the grid.
     *
     * `levelCount` comes from the caller rather than a constant here, because the number of
     * levels is a fact about the `resources/levels` folder and `GameController` is what can
     * see it. Adding a level-11.json then extends this grid with no change to this file --
     * the same property `nextLevelName` has.
     *
     * Called once, after the preload: reading the bundle's index is the one thing on this
     * screen that cannot be done before the engine has finished starting.
     */
    setLevels(levelCount: number): void {
        if (this.chips.length > 0) return;
        this.levelCount = levelCount;
        this.sub.string = `共 ${levelCount} 关`;
        this.buildGrid(levelCount, this.gridTopY);
        for (const chip of this.chips) chip.node.active = !this.waiting;
    }

    /**
     * The primary button. Its LABEL says which level it opens and the caller decides what
     * that is (see `continueLevel`), so this only reports the tap.
     */
    private buildStart(y: number): { node: Node; label: Label } {
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
        return { node: btn, label };
    }

    /**
     * The level grid, `COLS` across, centred on x and running down from `topY`.
     *
     * A partly filled last row is centred on its OWN width rather than left-aligned under a
     * full row: with 10 levels and 5 columns both rows are full, but an eleventh level must
     * not leave one chip hanging off the left edge of the block.
     *
     * Every chip is built with all its parts -- number, padlock, three stars -- and
     * `setProgress` only ever changes colours and `active` flags. Rebuilding a chip to change
     * its state would mean destroying nodes on a screen the player is looking at.
     */
    private buildGrid(levelCount: number, topY: number): void {
        const rows = Math.ceil(levelCount / COLS);
        for (let r = 0; r < rows; r++) {
            const inRow = Math.min(COLS, levelCount - r * COLS);
            for (let c = 0; c < inRow; c++) {
                const n = r * COLS + c + 1;
                const node = new Node(`HomeLevel${n}`);
                node.layer = Layers.Enum.UI_2D;
                node.addComponent(UITransform).setContentSize(CHIP_D, CHIP_D);
                this.root.addChild(node);
                node.setPosition(
                    (c - (inRow - 1) / 2) * CHIP_PITCH_X, topY - r * CHIP_PITCH_Y, 0,
                );
                const base = roundedSprite('base', CHIP_D, CHIP_D, CHIP_BASE, CHIP_R);
                node.addChild(base);
                base.setPosition(0, -BTN_LIFT, 0);
                const face = roundedSprite('face', CHIP_D, CHIP_D, CHIP, CHIP_R);
                node.addChild(face);
                const num = makeLabel(face, 'n', 44, 0);
                num.color = CHIP_INK;
                num.isBold = true;
                num.string = `${n}`;
                this.chips.push({
                    node,
                    face,
                    base,
                    num,
                    lock: this.buildLock(face),
                    stars: this.buildChipStars(node),
                    open: true,
                });
            }
        }
    }

    /** See LOCK_INK for how a padlock is made of rounded squares and what draws over what. */
    private buildLock(face: Node): Node {
        const lock = new Node('lock');
        lock.layer = Layers.Enum.UI_2D;
        lock.addComponent(UITransform);
        face.addChild(lock);

        const shackle = roundedSprite(
            'shackle', LOCK_SHACKLE_D, LOCK_SHACKLE_D, LOCK_INK, LOCK_SHACKLE_D / 2,
        );
        lock.addChild(shackle);
        shackle.setPosition(0, LOCK_SHACKLE_Y, 0);
        // The hole, in the colour of the plate behind it. A locked chip is the only state
        // this is ever drawn in, so CHIP_LOCKED is that colour and not a guess.
        const hole = roundedSprite('hole', LOCK_HOLE_W, LOCK_HOLE_H, CHIP_LOCKED, LOCK_HOLE_W / 2);
        lock.addChild(hole);
        hole.setPosition(0, LOCK_SHACKLE_Y + 2, 0);
        const body = roundedSprite('body', LOCK_BODY_W, LOCK_BODY_H, LOCK_INK, 8);
        lock.addChild(body);
        body.setPosition(0, LOCK_BODY_Y, 0);

        lock.active = false;
        return lock;
    }

    private buildChipStars(chip: Node): Node[] {
        const out: Node[] = [];
        for (let i = 0; i < STAR_MAX; i++) {
            const star = starSprite(`star${i}`, CHIP_STAR_D, CHIP_STAR_OFF);
            chip.addChild(star);
            star.setPosition((i - (STAR_MAX - 1) / 2) * CHIP_STAR_PITCH, CHIP_STAR_Y, 0);
            star.active = false;
            out.push(star);
        }
        return out;
    }

    /**
     * Draw the save: each chip locked or open, its rating, and what the start button opens.
     *
     * All three in one call so they cannot drift apart -- a grid that says level 4 is open
     * over a button that offers level 3 is two answers to one question.
     */
    setProgress(p: Progress): void {
        // No-op before `setLevels`: there is nothing to paint, and `continueLevel` would
        // report level 1 off a levelCount of 0. The caller draws again once the grid is up.
        if (this.chips.length === 0) return;
        for (let i = 0; i < this.chips.length; i++) {
            const level = i + 1;
            const chip = this.chips[i];
            const open = isUnlocked(p, level);
            const best = bestStars(p, level);
            chip.open = open;
            chip.face.getComponent(Sprite)!.color = open ? CHIP : CHIP_LOCKED;
            chip.base.getComponent(Sprite)!.color = open ? CHIP_BASE : CHIP_LOCKED_BASE;
            chip.num.node.active = open;
            chip.lock.active = !open;
            for (let s = 0; s < chip.stars.length; s++) {
                // Absent, not empty, on a level never cleared: three grey stars would say it
                // was cleared with none, which cannot happen (the rating floors at one).
                chip.stars[s].active = open && best > 0;
                chip.stars[s].getComponent(Sprite)!.color =
                    s < best ? CHIP_STAR_ON : CHIP_STAR_OFF;
            }
        }
        const level = this.continueLevel(p);
        this.startLabel.string = level === 1 ? '开始游戏' : `继续 第 ${level} 关`;
    }

    /**
     * Which level the start button opens: the furthest one unlocked, capped at the last that
     * exists.
     *
     * `unlockedThrough` reports one PAST the series on a fully cleared save, which is what the
     * cap is for. On such a save the button reads "继续 第 10 关" -- true, since the last level
     * is the furthest unlocked one, and slightly odd; a better wording needs another state.
     */
    continueLevel(p: Progress): number {
        return Math.max(1, Math.min(this.levelCount, unlockedThrough(p)));
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

    /** Whether `ui` (UI-space) landed on the start button. */
    hitsStart(ui: Vec3): boolean {
        if (!this.open() || this.waiting) return false;
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
     * Which level chip `ui` landed on, 1-based, or -1 for none OR for a locked one.
     *
     * THE GATE IS HERE. A locked chip is not a tap that gets refused later -- it is not a tap
     * at all, so there is no second opinion anywhere about which levels can be played.
     *
     * Square hit boxes, unlike the HUD's circular chip test, because these chips ARE squares
     * -- a circular test would refuse their corners.
     */
    hitsLevel(ui: Vec3): number {
        if (!this.open() || this.waiting) return -1;
        const r = CHIP_D / 2 + TAP_PAD;
        for (let i = 0; i < this.chips.length; i++) {
            const chip = this.chips[i];
            const p = chip.node.worldPosition;
            if (Math.abs(ui.x - p.x) <= r && Math.abs(ui.y - p.y) <= r) {
                return chip.open ? i + 1 : -1;
            }
        }
        return -1;
    }
}
