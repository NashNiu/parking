import { Node, Label, UITransform, Color, Layers, Vec3, tween } from 'cc';
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
const PILL_W = 238;
const PILL_H = 105;
/** Corner inset, as a fraction of the canvas width — the only resolution-relative number here. */
const PILL_MARGIN = 0.03;

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

    constructor(canvas: Node) {
        this.canvas = canvas;
        const { w, h } = canvasSize(canvas);
        const margin = w * PILL_MARGIN;
        // Title centred on the same line as the passenger pill, which is what puts it
        // where the reference art has it rather than jammed against the top edge.
        this.levelLabel = makeLabel(canvas, 'LevelLabel', 68, h / 2 - margin - PILL_H / 2);
        this.levelLabel.color = TITLE_INK;
        this.levelLabel.isBold = true;
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
        for (const [dx, dy, d] of [[-15, 7, 27], [15, 7, 27], [0, -14, 31]] as const) {
            const dot = dotSprite('paxdot', d, PILL_ICON);
            pill.addChild(dot);
            dot.setPosition(-77 + dx, dy, 0);
        }

        const caption = makeLabel(pill, 'PaxCaption', 27, 27, 38);
        caption.string = '剩余乘客';
        caption.color = PILL_CAPTION;
        const count = makeLabel(pill, 'PaxCount', 62, -21, 38);
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

    setLevel(id: number): void {
        this.levelLabel.string = `第 ${id} 关`;
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
