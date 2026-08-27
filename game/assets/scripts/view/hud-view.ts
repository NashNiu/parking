import { Node, Label, UITransform, Color, Layers, UIOpacity, Vec3, tween, Tween } from 'cc';
import { roundedSprite, dotSprite } from './ui-shapes';

function canvasSize(canvas: Node): { w: number; h: number } {
    const ct = canvas.getComponent(UITransform);
    return ct ? { w: ct.width, h: ct.height } : { w: 720, h: 1280 };
}

function makeLabel(parent: Node, name: string, fontSize: number, y: number, x = 0): Label {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform);
    const label = n.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.2);
    label.color = Color.WHITE.clone();
    parent.addChild(n);
    n.setPosition(x, y, 0);
    return label;
}

/** The remaining-passenger pill, sized off its own type so it stays in step with the HUD. */
const PILL_W = 210;
const PILL_H = 88;
/** Corner inset, as a fraction of the canvas width — the only resolution-relative number here. */
const PILL_MARGIN = 0.03;

/**
 * The level-title pill: the passenger pill's mirror image in the OPPOSITE top corner, same
 * height, same margin, narrower only because its text is shorter.
 *
 * The corner is the point. This started as bare centred type, which the ring's own
 * passengers stood up into and made unreadable; a plate fixed the type and moved the problem
 * -- the plate then covered the passengers instead. Centre-top belongs to the track, which
 * is as wide as the board and reaches within a plate's height of the top edge. The two
 * corners above the track's rounded ends are the only places up here that are reliably
 * empty, and the counter already had one of them.
 */
const TITLE_PILL_W = 190;
const TITLE_PILL_H = PILL_H;

/**
 * The toast: one line of what happened and one of what to do about it. It sits at the
 * canvas centre, which on this board is the empty band between the parking bay and the lot
 * -- close enough to the bay to belong to it, and over nothing it would hide.
 *
 * Dark and translucent, where the two corner pills are opaque white. That is the difference
 * between them said in the styling: the pills are always there and always true, so they get
 * to look built in; a toast is neither, and a scrim the board shows through reads as
 * something passing before it has moved at all. It also stops a third white plate from
 * competing with the two that are permanent.
 *
 * The title keeps nearly full alpha and the second line takes less. Translucency is for the
 * plate; type that the board shows through is type nobody reads, and the whole point of the
 * second line is that a new player reads it.
 */
const TOAST_W = 320;
const TOAST_H = 104;
const TOAST_HOLD = 1.1;
const TOAST_BG = new Color(26, 32, 50, 188);
const TOAST_INK = new Color(255, 255, 255, 244);
const TOAST_SUB = new Color(226, 232, 245, 196);

/** The seat-count chip that sits under a parked car's stall. */
const CHIP_W = 88;
const CHIP_H = 58;

const PILL_BG = new Color(252, 252, 255);
const PILL_INK = new Color(48, 60, 92);
const PILL_CAPTION = new Color(126, 134, 156);
const PILL_ICON = new Color(255, 150, 66);

/**
 * Ink for the level title and the win/lose banner. The board is a light scene, so white
 * type — which is what this used — disappears into it; the banner keeps a white rim
 * because it lands over cars and passengers of every colour.
 */
const TITLE_INK = new Color(43, 52, 80);

/**
 * Minimal HUD built at runtime under the editor-created Canvas: a level label, a
 * remaining-passengers pill in the top-left corner, per-car seat chips, and a center
 * banner for win/lose.
 */
export class HudView {
    private canvas: Node;
    private levelLabel: Label;
    private progressLabel: Label;
    private bannerLabel: Label;
    private starLabels: Label[] = [];
    /** The toast pill and its parts, built on first use. See `showToast`. */
    private toast: Node | null = null;
    private toastFade: UIOpacity | null = null;
    private toastTitle: Label | null = null;
    private toastSub: Label | null = null;

    constructor(canvas: Node) {
        this.canvas = canvas;
        const { w, h } = canvasSize(canvas);
        const margin = w * PILL_MARGIN;
        // Both readouts share one line, at the pill's own half-height below the top margin,
        // which is what puts them where the reference art has them rather than jammed
        // against the top edge.
        const line = h / 2 - margin - PILL_H / 2;
        this.levelLabel = this.buildTitlePill(canvas, w / 2 - margin - TITLE_PILL_W / 2, line);
        this.progressLabel = this.buildPassengerPill(canvas, w, h, margin);
        this.bannerLabel = makeLabel(canvas, 'Banner', 72, 0);
        this.bannerLabel.color = TITLE_INK;
        this.bannerLabel.isBold = true;
        this.bannerLabel.enableOutline = true;
        this.bannerLabel.outlineColor = new Color(255, 255, 255, 235);
        this.bannerLabel.outlineWidth = 5;
        this.bannerLabel.node.active = false;
        for (let i = 0; i < 3; i++) {
            const label = makeLabel(canvas, `Star${i}`, 60, 100);
            label.node.setPosition((i - 1) * 80, 100, 0);
            label.node.active = false;
            this.starLabels.push(label);
        }
    }

    /**
     * The level title on its own rounded plate, in the top-RIGHT corner (see TITLE_PILL_W
     * for why it is not centred). 42px, not the counter's 52: at three digits a bolder
     * setting would run past the plate's edge.
     */
    private buildTitlePill(canvas: Node, x: number, line: number): Label {
        const pill = roundedSprite('TitlePill', TITLE_PILL_W, TITLE_PILL_H, PILL_BG);
        canvas.addChild(pill);
        pill.setPosition(x, line, 0);
        const label = makeLabel(pill, 'LevelLabel', 42, 0);
        label.color = TITLE_INK;
        label.isBold = true;
        return label;
    }

    /**
     * The remaining-passenger readout: a white rounded pill in the top-left corner
     * holding a huddle of passenger dots, a small caption, and a big count. It replaces
     * a bare centred line of text, which read as debug output rather than a HUD.
     */
    private buildPassengerPill(canvas: Node, w: number, h: number, margin: number): Label {
        const pill = roundedSprite('PaxPill', PILL_W, PILL_H, PILL_BG);
        canvas.addChild(pill);
        pill.setPosition(-w / 2 + margin + PILL_W / 2, h / 2 - margin - PILL_H / 2, 0);

        // Three dots in a huddle is all the passenger icon that survives at this size —
        // a drawn figure would just be a smudge.
        for (const [dx, dy, d] of [[-13, 6, 24], [13, 6, 24], [0, -12, 27]] as const) {
            const dot = dotSprite('paxdot', d, PILL_ICON);
            pill.addChild(dot);
            dot.setPosition(-68 + dx, dy, 0);
        }

        const caption = makeLabel(pill, 'PaxCaption', 24, 23, 34);
        caption.string = '剩余乘客';
        caption.color = PILL_CAPTION;
        const count = makeLabel(pill, 'PaxCount', 52, -18, 34);
        count.color = PILL_INK;
        count.isBold = true;
        return count;
    }

    /**
     * A parked car's remaining-seat chip: a rounded plate in the car's own colour with the
     * count on it, which the caller positions under the stall and destroys on departure
     * (the label is a child, so destroying the chip takes both). Colour-matching the car
     * is what lets the player pair a chip with a stall at a glance.
     */
    newSeatChip(color: Color): { chip: Node; label: Label } {
        const chip = roundedSprite('seatChip', CHIP_W, CHIP_H, color);
        this.canvas.addChild(chip);
        const label = makeLabel(chip, 'seat', 38, 0);
        label.isBold = true;
        // A dark rim keeps white digits legible on a light car (yellow especially).
        label.enableOutline = true;
        label.outlineColor = new Color(0, 0, 0, 90);
        label.outlineWidth = 2;
        return { chip, label };
    }

    /** Half the chip's height, so the caller can hang it off a stall's bottom edge. */
    get seatChipHalfHeight(): number {
        return CHIP_H / 2;
    }

    /**
     * Show a passing message. Built on first use and reused after that, so a player
     * hammering a refused tap restarts one toast instead of stacking a pile of them --
     * which is also why every tween on the pill is stopped before the next one starts.
     *
     * `sub` carries what to DO. A toast that only names the problem ("the bay is full")
     * leaves a new player stuck, because the thing they have not worked out yet is that a
     * car leaves by itself once its seats fill.
     */
    showToast(title: string, sub: string): void {
        if (!this.toast) this.buildToast();
        const pill = this.toast!;
        this.toastTitle!.string = title;
        this.toastSub!.string = sub;
        Tween.stopAllByTarget(pill);
        Tween.stopAllByTarget(this.toastFade!);
        pill.active = true;
        pill.setScale(0.85, 0.85, 1);
        this.toastFade!.opacity = 255;
        tween(pill)
            .to(0.12, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'backOut' })
            .to(0.08, { scale: Vec3.ONE })
            .start();
        tween(this.toastFade!)
            .delay(TOAST_HOLD)
            .to(0.25, { opacity: 0 })
            .call(() => { pill.active = false; })
            .start();
    }

    private buildToast(): void {
        const pill = roundedSprite('Toast', TOAST_W, TOAST_H, TOAST_BG);
        this.canvas.addChild(pill);
        pill.setPosition(0, 0, 0);
        // UIOpacity multiplies into the colours above rather than replacing them, so the
        // fade-out starts from the plate's 188 and the type's own alpha, not from 255.
        this.toastFade = pill.addComponent(UIOpacity);
        this.toastTitle = makeLabel(pill, 'ToastTitle', 36, 20);
        this.toastTitle.color = TOAST_INK;
        this.toastTitle.isBold = true;
        this.toastSub = makeLabel(pill, 'ToastSub', 22, -24);
        this.toastSub.color = TOAST_SUB;
        pill.active = false;
        this.toast = pill;
    }

    setLevel(id: number): void {
        // No spaces around the number: the title has a plate to fit inside, and at three
        // digits the spaced form runs past its edge.
        this.levelLabel.string = `第${id}关`;
    }

    setProgress(remaining: number): void {
        this.progressLabel.string = `${remaining}`;
    }

    /**
     * Moves the banner and the stars to the end of the canvas's child list, so they
     * render on top of every seat chip. `newSeatChip` appends chips at runtime as cars
     * park, which makes each one a later — and therefore higher-rendering — sibling of
     * the banner and stars, which are constructed early. Raising both at show time (once
     * the game is over, no further chip can appear) undoes that ordering.
     */
    private raiseBannerToFront(): void {
        const lastIndex = this.canvas.children.length - 1;
        this.bannerLabel.node.setSiblingIndex(lastIndex);
        for (const label of this.starLabels) label.node.setSiblingIndex(lastIndex);
    }

    showBanner(text: string): void {
        this.bannerLabel.string = text;
        this.bannerLabel.node.active = true;
        this.raiseBannerToFront();
    }

    /**
     * Victory panel: big banner + a row of 3 stars, filled left-to-right up to
     * `starCount`, each popping in in turn. `hasNext` switches the call-to-action
     * between advancing and replaying, matching what the next tap will actually do.
     */
    showWin(starCount: number, hasNext: boolean = false): void {
        this.bannerLabel.string = hasNext ? '过关!\n点击进入下一关' : '全部通关!\n点击重玩';
        this.bannerLabel.node.active = true;
        this.raiseBannerToFront();
        this.starLabels.forEach((label, i) => {
            const filled = i < starCount;
            label.string = filled ? '★' : '☆'; // ★ / ☆
            label.color = filled ? new Color(255, 210, 60) : new Color(120, 120, 120);
            label.node.active = true;
            label.node.setScale(0.01, 0.01, 0.01);
            tween(label.node)
                .delay(i * 0.12)
                .to(0.18, { scale: new Vec3(1.3, 1.3, 1.3) }, { easing: 'backOut' })
                .to(0.1, { scale: Vec3.ONE }, { easing: 'backOut' })
                .start();
        });
    }

    /** Failure panel: deadlock message; the stuck-car highlight itself is driven by the caller. */
    showLose(): void {
        this.bannerLabel.string = '游戏失败\n点击重试';
        this.bannerLabel.node.active = true;
        this.raiseBannerToFront();
        for (const label of this.starLabels) label.node.active = false;
    }

    /** Hides the banner and any win-panel stars; used on restart to clear whichever panel was shown. */
    hideBanner(): void {
        this.bannerLabel.node.active = false;
        for (const label of this.starLabels) label.node.active = false;
    }
}
