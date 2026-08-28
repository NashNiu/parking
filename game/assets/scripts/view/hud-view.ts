import { Node, Label, UITransform, Color, Layers, UIOpacity, Vec3, tween, Tween } from 'cc';
import { roundedSprite, dotSprite } from './ui-shapes';

declare const wx: any;

/**
 * The screen's unusable top and bottom edges, as FRACTIONS of its height: the notch or
 * Dynamic Island above, the home indicator below.
 *
 * Fractions, not pixels, because that is the only form in which the number is portable.
 * `safeArea` and `screenHeight` come back from wx in logical px, the canvas measures itself
 * in design units, and the ratio between those two is a project setting this file does not
 * read -- but their QUOTIENT is the same in either. `topReserve` hands the same fractions to
 * the camera for the same reason.
 *
 * Zero off-device (browser, editor preview), which is exactly right: there is no notch
 * there, and the layout should not pretend otherwise.
 *
 * Read once and cached. Nothing here changes while the game runs, and getSystemInfoSync is
 * one of the slower wx calls.
 */
let insets: { top: number; bottom: number } | null = null;

function safeInsets(): { top: number; bottom: number } {
    if (insets) return insets;
    insets = { top: 0, bottom: 0 };
    try {
        const info = typeof wx !== 'undefined' && wx.getSystemInfoSync
            ? wx.getSystemInfoSync() : null;
        const h = info && info.screenHeight;
        const area = info && info.safeArea;
        if (h > 0 && area) {
            insets = {
                top: Math.max(0, Math.min(0.3, area.top / h)),
                bottom: Math.max(0, Math.min(0.3, (h - area.bottom) / h)),
            };
        }
    } catch { /* leave it at zero -- a missing inset is a cosmetic loss, not a crash */ }
    return insets;
}

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
 * The level-title pill: same height and margin as the passenger pill, narrower only because
 * its text is shorter. CENTRED at the top, with the counter dropped one row below it on the
 * left.
 *
 * It was in the top-right corner, and the reason it was there has expired. Centre-top used
 * to belong to the track: the ring reached within a plate's height of the top edge, so bare
 * centred type had passengers standing up through it and a plate over it covered the
 * passengers instead. The board has since been reframed twice -- the lot went portrait, and
 * the track was pushed up to clear a parking bay deep enough for a bus -- and the top band
 * is now this: the ring's topmost figure sits 1.67 board units below the top of the frame,
 * which is 8.3% of the screen height, and this plate takes about 6% of it. It clears.
 *
 * Those are FRACTIONS on purpose. The canvas's own size in design units is a project
 * setting this file does not read (`canvasSize` asks the Canvas at runtime), so every
 * clearance here is worked out as a share of the screen rather than in pixels -- the pill
 * sizes are fixed design units and the margin is a fraction of the width, so the band they
 * occupy moves with the design resolution and a pixel claim would be fiction.
 *
 * Which is also why the counter drops only HALF a row: sideways it is safe (the ring's path
 * spans at most +/-1.85 and its figures +/-1.96, while this pill's right edge lands near
 * -1.96 -- they touch at best), but a full row down would turn that touch into an overlap
 * over the ring's leftmost top row.
 *
 * The title plate does not rely on any of that. It sits under the notch (`safeInsets`) and
 * the BOARD gets out of its way: `topReserve` tells the camera how much of the screen the
 * plate owns, and `fitCamera` frames the board below it -- see `buildBoard`. Centring it and
 * leaving the board where it was is what put the plate behind the Dynamic Island.
 */
const TITLE_PILL_W = 190;
const TITLE_PILL_H = PILL_H;

/**
 * The toast: ONE line, saying what happened. It sits at the canvas centre, which on this
 * board is the empty band between the parking bay and the lot -- close enough to the bay to
 * belong to it, and over nothing it would hide.
 *
 * It used to carry a second, smaller line explaining what to do about it, and that line is
 * gone. A toast is read in the gap between deciding to tap and seeing nothing happen; at 22
 * against a 36 the second line was not read in that gap, and it cost the first line the size
 * that would have made it land. One line at 56 says the same thing in the time available.
 *
 * Dark, where the two corner pills are opaque white. That is the difference between them
 * said in the styling: the pills are always there and always true, so they get to look built
 * in; a toast is neither, and a third white plate would compete with the two that are
 * permanent. Nearly opaque, though -- it was 188 and it sits over the lot, which is the
 * busiest thing on the screen, so the board showing through was costing it exactly the
 * legibility it exists for.
 */
const TOAST_W = 340;
const TOAST_H = 108;
const TOAST_HOLD = 1.5;
const TOAST_BG = new Color(26, 32, 50, 236);
const TOAST_INK = new Color(255, 255, 255, 255);

/**
 * The carousel-speed button: a round plate on the LEFT EDGE at the canvas centre, reading
 * x1 or x2.
 *
 * That position is chosen, not spare. The canvas centre is the empty band between the
 * parking bay and the lot -- the same band the toast uses, and for the same reason -- and the
 * left edge of it is the one place a permanent control can sit without covering a stall, a
 * car, or a waiting passenger. It is also where the reference art the player asked for puts
 * it, which is worth something on its own: a speed control belongs where players already
 * look for one.
 *
 * Round and coloured, where every other plate here is a rounded rectangle in white or dark
 * navy. Those are READOUTS -- they tell you something and cannot be pressed. This is the only
 * thing on the HUD that can be, so it does not get to look like them.
 *
 * SPEED_PAD widens the tap target past the drawn circle. A thumb aimed at a 92-unit button
 * lands off its edge often enough to matter, and there is nothing behind this one to hit by
 * accident -- the band is empty, and `handleTap` answers the button before it casts a ray at
 * the board at all.
 */
const SPEED_D = 92;
const SPEED_PAD = 14;
const SPEED_BG = new Color(74, 144, 226);
const SPEED_RIM = new Color(255, 255, 255, 235);
const SPEED_INK = new Color(255, 255, 255);

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
    private speedNode: Node;
    private speedLabel: Label;

    constructor(canvas: Node) {
        this.canvas = canvas;
        const { w, h } = canvasSize(canvas);
        const margin = w * PILL_MARGIN;
        // Both readouts share one line, at the pill's own half-height below the top margin,
        // which is what puts them where the reference art has them rather than jammed
        // against the top edge.
        // Below the notch, not below the top edge. The centred plate is directly under a
        // Dynamic Island otherwise, which is where it went the first time.
        const line = h / 2 - safeInsets().top * h - margin - PILL_H / 2;
        this.levelLabel = this.buildTitlePill(canvas, 0, line);
        // Dropped half its own height plus a margin -- clear of the status bar it used to
        // share, and no further. A FULL row lower was tried on paper and rejected: see
        // TITLE_PILL_W for the arithmetic, but the short version is that the ring's top
        // rows start 8.3% of the screen height down and a full row puts this plate's
        // bottom edge past that.
        this.progressLabel = this.buildPassengerPill(
            canvas, w, margin, line - PILL_H / 2 - margin,
        );
        const speed = this.buildSpeedButton(canvas, -w / 2 + margin + SPEED_D / 2);
        this.speedNode = speed.node;
        this.speedLabel = speed.label;
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
     * How much of the screen's height the centred title owns, top edge down, as a fraction:
     * the notch plus the plate and its margin. The camera reserves it (see `buildBoard`) so
     * the board never reaches up into it.
     *
     * The COUNTER is deliberately not in this number even though it hangs lower. It sits on
     * the left, where the ring never reaches at any height (its figures stop at x +/-1.96,
     * the pill starts outside that), so reserving board height for it would push the board
     * down for nothing.
     */
    topReserve(): number {
        const { w, h } = canvasSize(this.canvas);
        if (!(h > 0)) return safeInsets().top;
        return safeInsets().top + (w * PILL_MARGIN + PILL_H) / h;
    }

    /** The home indicator's band, as a fraction of the screen's height. */
    bottomReserve(): number {
        return safeInsets().bottom;
    }

    /**
     * The level title on its own rounded plate, centred at the top (see TITLE_PILL_W for
     * what makes the centre safe). 42px, not the counter's 52: at three digits a bolder
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
     * The remaining-passenger readout: a white rounded pill on the left, one row under the
     * title, holding a huddle of passenger dots, a small caption, and a big count. It
     * replaces a bare centred line of text, which read as debug output rather than a HUD.
     */
    private buildPassengerPill(canvas: Node, w: number, margin: number, y: number): Label {
        const pill = roundedSprite('PaxPill', PILL_W, PILL_H, PILL_BG);
        canvas.addChild(pill);
        pill.setPosition(-w / 2 + margin + PILL_W / 2, y, 0);

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
     * One line, and it names the problem. What to DO about it is on the board -- a car
     * leaves by itself once its seats fill, and the next locked stall wears the button that
     * opens it -- so the toast's whole job is to be read, not to teach.
     */
    showToast(title: string): void {
        if (!this.toast) this.buildToast();
        const pill = this.toast!;
        this.toastTitle!.string = title;
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
        // Centred, because there is nothing else on the plate to make room for. 56 sets four
        // CJK glyphs at about 224 wide inside a 340 plate -- the same share of its plate the
        // title pill's 42 takes of its 190, so the toast reads as the same HUD, only louder.
        this.toastTitle = makeLabel(pill, 'ToastTitle', 56, 0);
        this.toastTitle.color = TOAST_INK;
        this.toastTitle.isBold = true;
        pill.active = false;
        this.toast = pill;
    }

    /**
     * The speed button: a white disc with a coloured one inside it, so it reads as a raised
     * button against either a light board or a dark one, and the digit on top.
     */
    private buildSpeedButton(canvas: Node, x: number): { node: Node; label: Label } {
        const rim = dotSprite('SpeedButton', SPEED_D, SPEED_RIM);
        canvas.addChild(rim);
        rim.setPosition(x, 0, 0);
        const face = dotSprite('face', SPEED_D - 10, SPEED_BG);
        rim.addChild(face);
        const label = makeLabel(face, 'speed', 40, 0);
        label.color = SPEED_INK;
        label.isBold = true;
        // Set here rather than left to the first `setSpeed`: an unset Label draws the string
        // 'label', and the seat chips have already been caught doing exactly that once.
        label.string = 'x1';
        return { node: rim, label };
    }

    /** Show the multiplier the carousel is running at. */
    setSpeed(multiplier: number): void {
        this.speedLabel.string = `x${multiplier}`;
        // A press the player can see, on the thing they pressed. Absolute, not relative:
        // hammering the button restarts this rather than compounding it.
        Tween.stopAllByTarget(this.speedNode);
        this.speedNode.setScale(0.82, 0.82, 1);
        tween(this.speedNode).to(0.14, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
    }

    /**
     * Whether `ui` -- a tap converted into the UI camera's space, which is what the seat
     * chips are already positioned in -- landed on the speed button.
     *
     * Squared distance against a squared radius: a circle's hit test, matching what is
     * drawn. A box test on a round button accepts the corners, and the corners of this one
     * hang over the lot.
     */
    hitsSpeed(ui: Vec3): boolean {
        const p = this.speedNode.worldPosition;
        const r = SPEED_D / 2 + SPEED_PAD;
        const dx = ui.x - p.x;
        const dy = ui.y - p.y;
        return dx * dx + dy * dy <= r * r;
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
