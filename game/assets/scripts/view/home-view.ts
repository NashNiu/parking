import { Color, Layers, Node, UITransform, Vec3 } from 'cc';
import { roundedSprite } from './ui-shapes';
import { canvasSize, makeLabel, safeInsets } from './ui-layout';

/**
 * The home screen: the game's name, one button that starts playing, and the level grid.
 *
 * It is a UI screen in the SAME canvas as the HUD, not a Cocos scene of its own. A second
 * scene would mean a second copy of the camera rig and the preload chain that `start()`
 * spends its first frames on, and a scene load between the menu and the board -- for a
 * screen that is nine sprites and a dozen labels. `GameController.screen` decides which of
 * the two is up, and the board simply is not built while this one is.
 *
 * WHAT IS DELIBERATELY MISSING: which levels are unlocked, and how many stars each was
 * cleared with. Neither can be answered until progress is saved locally, so nothing here
 * pretends to know -- every chip is live. The layout already leaves the room they will need
 * (see CHIP_PITCH_Y), so that change is a new data source and not a re-layout.
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
const CHIP_PITCH_X = 118;
/**
 * 140 for a 100-unit chip, so there are 40 units of clear space under each row rather than
 * the 18 an even grid would give. That band is where the three small stars go once progress
 * is saved and a chip can report how well the level was cleared -- reserving it now is what
 * keeps that change from moving every chip on the screen.
 */
const CHIP_PITCH_Y = 140;
/** Five across fits 10 levels in two rows, and 10 is what the game ships. */
const COLS = 5;

/** Slack around a tap, in design units: the same padding the HUD's own hit tests use. */
const TAP_PAD = 10;

export class HomeView {
    /** Everything this screen draws, under one node, so `show`/`hide` is one flag. */
    private root: Node;
    private startBtn: Node;
    /** One per level, in level order, so the index IS the level number minus one. */
    private chips: Node[] = [];

    /**
     * `levelCount` comes from the caller rather than a constant here, because the number of
     * levels is a fact about the `resources/levels` folder and `GameController` is what can
     * see it. Adding a level-11.json then extends this grid with no change to this file --
     * the same property `nextLevelName` has.
     */
    constructor(canvas: Node, levelCount: number) {
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

        const sub = makeLabel(this.root, 'HomeSub', 30, titleY - 78);
        sub.color = SUB_INK;
        sub.string = `共 ${levelCount} 关`;

        this.startBtn = this.buildStart(h * 0.04);
        const pickCap = makeLabel(this.root, 'HomePickCap', 30, -h * 0.10);
        pickCap.color = SUB_INK;
        pickCap.string = '选择关卡';

        this.buildGrid(levelCount, -h * 0.10 - 92);

        this.root.active = false;
    }

    /**
     * The primary button. It starts at level 1 today; when progress is saved it becomes
     * "continue", pointing at the furthest level reached -- which is why the caller decides
     * WHICH level it starts (see `GameController.enterLevel`) and this only reports the tap.
     */
    private buildStart(y: number): Node {
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
        return btn;
    }

    /**
     * The level grid, `COLS` across, centred on x and running down from `topY`.
     *
     * A partly filled last row is centred on its OWN width rather than left-aligned under a
     * full row: with 10 levels and 5 columns both rows are full, but an eleventh level must
     * not leave one chip hanging off the left edge of the block.
     */
    private buildGrid(levelCount: number, topY: number): void {
        const rows = Math.ceil(levelCount / COLS);
        for (let r = 0; r < rows; r++) {
            const inRow = Math.min(COLS, levelCount - r * COLS);
            for (let c = 0; c < inRow; c++) {
                const n = r * COLS + c + 1;
                const chip = new Node(`HomeLevel${n}`);
                chip.layer = Layers.Enum.UI_2D;
                chip.addComponent(UITransform).setContentSize(CHIP_D, CHIP_D);
                this.root.addChild(chip);
                chip.setPosition(
                    (c - (inRow - 1) / 2) * CHIP_PITCH_X, topY - r * CHIP_PITCH_Y, 0,
                );
                const base = roundedSprite('base', CHIP_D, CHIP_D, CHIP_BASE, CHIP_R);
                chip.addChild(base);
                base.setPosition(0, -BTN_LIFT, 0);
                const face = roundedSprite('face', CHIP_D, CHIP_D, CHIP, CHIP_R);
                chip.addChild(face);
                const label = makeLabel(face, 'n', 44, 0);
                label.color = CHIP_INK;
                label.isBold = true;
                label.string = `${n}`;
                this.chips.push(chip);
            }
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

    /** Whether `ui` (UI-space) landed on the start button. */
    hitsStart(ui: Vec3): boolean {
        if (!this.open()) return false;
        const p = this.startBtn.worldPosition;
        return Math.abs(ui.x - p.x) <= START_W / 2 + TAP_PAD
            && Math.abs(ui.y - p.y) <= START_H / 2 + TAP_PAD;
    }

    /**
     * Which level chip `ui` landed on, 1-based, or -1 for none.
     *
     * Square hit boxes, unlike the HUD's circular chip test, because these chips ARE
     * squares -- a circular test would refuse their corners.
     */
    hitsLevel(ui: Vec3): number {
        if (!this.open()) return -1;
        const r = CHIP_D / 2 + TAP_PAD;
        for (let i = 0; i < this.chips.length; i++) {
            const p = this.chips[i].worldPosition;
            if (Math.abs(ui.x - p.x) <= r && Math.abs(ui.y - p.y) <= r) return i + 1;
        }
        return -1;
    }
}
