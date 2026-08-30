import { Node, Label, Sprite, UITransform, Color, Layers, UIOpacity, Vec3, tween, Tween } from 'cc';
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
 * The "open a stall or lose" prompt: the one MODAL thing on this HUD.
 *
 * Everything else here either reports (the pills, the toast) or can be ignored (the speed
 * button). This asks a question the level cannot go on without an answer to -- the bay is
 * full, nothing on it can board, and opening a stall is the only move left -- so it takes
 * the screen, dims the board behind it, and swallows every tap that is not one of its two
 * buttons. Answering it with the close button ENDS the level (`GameCore.declineUnlock`),
 * which is the only way a level ends on a position that still had a move in it.
 *
 * A dark scrim rather than a light one: the board underneath is pale, and the panel is
 * white. The panel is 520 of a 720-wide canvas, so it clears the level pills either side.
 */
const PROMPT_W = 560;
const PROMPT_H = 430;
const PROMPT_R = 44;
const PROMPT_BG = new Color(252, 253, 255, 255);
/** The panel's own drop shadow: a second plate behind it, offset down. */
const PROMPT_SHADOW = new Color(8, 12, 24, 90);
const PROMPT_SHADOW_DROP = 10;
const PROMPT_INK = new Color(34, 42, 64, 255);
const PROMPT_SUB = new Color(122, 133, 160, 255);
const SCRIM = new Color(10, 14, 26, 178);
/**
 * The primary action: a green key drawn as two plates, the darker one peeking out below the
 * lighter, which is what makes a flat rectangle read as something with a top face to press.
 * The same trick as the padlock's rim on the board.
 */
const PROMPT_BTN_W = 400;
const PROMPT_BTN_H = 112;
const PROMPT_BTN_R = 38;
const PROMPT_BTN = new Color(86, 199, 104, 255);
const PROMPT_BTN_BASE = new Color(56, 156, 76, 255);
const PROMPT_BTN_LIFT = 8;
/** The way out: a plain disc tucked into the panel's top-right corner. */
const PROMPT_X_D = 76;
const PROMPT_X_BG = new Color(232, 236, 246, 255);
const PROMPT_X_INK = new Color(122, 133, 160, 255);

/**
 * The carousel-speed button: a round plate that sits in the CAROUSEL's bottom-left corner,
 * reading x1 or x2.
 *
 * It belongs to the carousel, so it is placed off the carousel -- `placeSpeed` takes the
 * track's own bounding box, projected out of the board and into this canvas, rather than a
 * fixed corner of the screen. A control parked in the screen's top-left says nothing about
 * what it controls; one tucked into the track's corner says it without a caption. The
 * position also survives a reframe: the board is fitted to the viewport (see `fitCamera`),
 * and a fixed HUD corner drifts away from the thing it belongs to as soon as the aspect
 * changes.
 *
 * Round and coloured, where every other plate here is a rounded rectangle in white or dark
 * navy. Those are READOUTS -- they tell you something and cannot be pressed. This is the only
 * thing on the HUD that can be, so it does not get to look like them.
 *
 * SPEED_PAD widens the tap target past the drawn circle. A thumb aimed at a 92-unit button
 * lands off its edge often enough to matter, and `handleTap` answers this before it casts a
 * ray at the board at all, so a generous target costs nothing.
 *
 * SPEED_GAP is how far clear of the track's corner it sits, measured from the button's own
 * edge -- so the two never touch however the board is framed.
 */
const SPEED_D = 92;
const SPEED_PAD = 14;
const SPEED_GAP = 10;
const SPEED_BG = new Color(74, 144, 226);
const SPEED_RIM = new Color(255, 255, 255, 235);
const SPEED_INK = new Color(255, 255, 255);

/**
 * The build tag: a small, deliberately dim line in the bottom-left corner.
 *
 * A DEVELOPMENT AID, and it exists because two rounds of debugging were spent on a question
 * nothing on screen could answer: is the phone running the build I just made? Nothing else in
 * the HUD can settle it -- the level number is the same in every build, and so, as it turned
 * out, is the passenger count (the old two-colour level 1 and the new four-colour one both
 * read 744). A stale package is invisible, so it gets mistaken for a bug in the new code.
 *
 * Dim on purpose: legible if you go looking, ignorable otherwise. To drop it before release,
 * delete `setBuildTag` and its one call.
 */
const TAG_INK = new Color(90, 100, 125, 130);

/**
 * The level picker: a row of numbered chips along the bottom, tapped to jump straight to a
 * level.
 *
 * A DEVELOPMENT AID, like the build tag above it, and it goes out the same way -- delete
 * `buildLevelPicker`, `hitsLevel`, and the two calls. It is here because checking a change
 * on level 7 otherwise means playing six levels first, on a phone, once per build.
 *
 * Dim, and the current level lit: the row is a readout as much as a control, so where you
 * are should be visible without tapping anything.
 *
 * It sits in the strip of ring road BELOW the lot, and the size is what keeps it there. The
 * chips answer taps before the board is raycast, so one overlapping a car would jump levels
 * where the player meant to send that car out. At 64 across the hit circle's top edge lands
 * at board y -9.06 against a lowest car body of -8.886 -- 0.17 of clearance. At 76 it was
 * 0.08, which is not a margin, it is a coincidence.
 */
const PICK_LEVELS = 10;
const PICK_D = 64;
const PICK_PITCH = 88;
const PICK_BG = new Color(120, 132, 158, 120);
const PICK_ON = new Color(74, 144, 226, 235);
const PICK_INK = new Color(255, 255, 255, 220);

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
    private buildTag: Label | null = null;
    /** The unlock prompt's scrim, its two hit targets, and whether it is up. */
    private prompt: Node | null = null;
    private promptBtn: Node | null = null;
    private promptClose: Node | null = null;
    private pickNodes: Node[] = [];
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
        // A fallback spot only. `placeSpeed` moves it onto the carousel's corner as soon as
        // the board is framed, which happens in the same frame the board is built -- but a
        // HUD with no board behind it (a failed level load) should still put it somewhere
        // sane rather than at the canvas origin, under everything.
        const speed = this.buildSpeedButton(canvas, -w / 2 + margin + SPEED_D / 2);
        this.speedNode = speed.node;
        this.speedLabel = speed.label;
        this.buildLevelPicker(
            canvas,
            -h / 2 + safeInsets().bottom * h + margin + 22 + PICK_D / 2 + 10,
        );
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

    /**
     * Raise the "open a stall or lose" prompt. Idempotent -- the controller asks on every
     * tick the condition holds, not only on the edge.
     */
    showUnlockPrompt(): void {
        if (!this.prompt) this.buildUnlockPrompt();
        const scrim = this.prompt!;
        if (scrim.active) return;
        scrim.active = true;
        // To the front, past every seat chip: chips are appended as cars park, so they are
        // later siblings than anything built in the constructor. Same reason as the banner.
        scrim.setSiblingIndex(this.canvas.children.length - 1);
        const panel = scrim.children[0];
        Tween.stopAllByTarget(panel);
        panel.setScale(0.86, 0.86, 1);
        tween(panel)
            .to(0.14, { scale: new Vec3(1.03, 1.03, 1) }, { easing: 'backOut' })
            .to(0.08, { scale: Vec3.ONE })
            .start();
    }

    /** Take the prompt down. Safe before it has ever been built. */
    hideUnlockPrompt(): void {
        if (this.prompt) this.prompt.active = false;
    }

    /** Whether the prompt is up, i.e. whether it owns the next tap. */
    promptOpen(): boolean {
        return !!this.prompt && this.prompt.active;
    }

    /**
     * Which of the prompt's two answers `ui` landed on, or null for the panel and the
     * scrim -- a tap that hits neither button is SWALLOWED, not passed through, because
     * closing this by tapping the board would be the same as choosing to lose.
     */
    hitsUnlockPrompt(ui: Vec3): 'unlock' | 'close' | null {
        if (!this.promptOpen()) return null;
        const c = this.promptClose!.worldPosition;
        const r = PROMPT_X_D / 2 + 12;
        if ((ui.x - c.x) ** 2 + (ui.y - c.y) ** 2 <= r * r) return 'close';
        const b = this.promptBtn!.worldPosition;
        if (Math.abs(ui.x - b.x) <= PROMPT_BTN_W / 2 + 8
            && Math.abs(ui.y - b.y) <= PROMPT_BTN_H / 2 + 8) return 'unlock';
        return null;
    }

    private buildUnlockPrompt(): void {
        const { w, h } = canvasSize(this.canvas);
        // The scrim IS the modal: it covers the canvas, so nothing behind it can be seen to
        // be tappable. Sized well past the canvas so a wider viewport cannot show a strip of
        // live board down either side.
        const scrim = roundedSprite('UnlockScrim', w * 2, h * 2, SCRIM, 2);
        this.canvas.addChild(scrim);
        scrim.setPosition(0, 0, 0);

        // Panel and its shadow under one node, so `showUnlockPrompt` scales them together.
        const panel = new Node('UnlockPanel');
        panel.layer = Layers.Enum.UI_2D;
        panel.addComponent(UITransform);
        scrim.addChild(panel);

        const shadow = roundedSprite('shadow', PROMPT_W, PROMPT_H, PROMPT_SHADOW, PROMPT_R);
        panel.addChild(shadow);
        shadow.setPosition(0, -PROMPT_SHADOW_DROP, 0);

        const plate = roundedSprite('plate', PROMPT_W, PROMPT_H, PROMPT_BG, PROMPT_R);
        panel.addChild(plate);

        const title = makeLabel(plate, 'PromptTitle', 54, 116);
        title.color = PROMPT_INK;
        title.isBold = true;
        title.string = '车位堵住了';

        const sub = makeLabel(plate, 'PromptSub', 30, 52);
        sub.color = PROMPT_SUB;
        sub.string = '解锁一个车位才能继续';

        // A hairline between the message and the choice, so the panel reads as two parts
        // rather than four stacked things.
        const rule = roundedSprite('rule', PROMPT_W - 96, 2, PROMPT_X_BG, 1);
        plate.addChild(rule);
        rule.setPosition(0, 8, 0);

        const btn = new Node('PromptBtn');
        btn.layer = Layers.Enum.UI_2D;
        btn.addComponent(UITransform).setContentSize(PROMPT_BTN_W, PROMPT_BTN_H);
        plate.addChild(btn);
        btn.setPosition(0, -92, 0);
        const base = roundedSprite(
            'base', PROMPT_BTN_W, PROMPT_BTN_H, PROMPT_BTN_BASE, PROMPT_BTN_R,
        );
        btn.addChild(base);
        base.setPosition(0, -PROMPT_BTN_LIFT, 0);
        const face = roundedSprite(
            'face', PROMPT_BTN_W, PROMPT_BTN_H, PROMPT_BTN, PROMPT_BTN_R,
        );
        btn.addChild(face);
        const btnLabel = makeLabel(face, 'PromptBtnLabel', 46, 0);
        btnLabel.isBold = true;
        btnLabel.string = '解锁车位';

        const close = dotSprite('PromptClose', PROMPT_X_D, PROMPT_X_BG);
        plate.addChild(close);
        // Inside the corner now that the corner is real -- with the old stretched-ellipse
        // panel there was no corner to sit in and it floated off the edge.
        close.setPosition(PROMPT_W / 2 - PROMPT_R - 6, PROMPT_H / 2 - PROMPT_R - 6, 0);
        const x = makeLabel(close, 'PromptCloseLabel', 46, 2);
        x.color = PROMPT_X_INK;
        x.isBold = true;
        x.string = '×';

        scrim.active = false;
        this.prompt = scrim;
        this.promptBtn = btn;
        this.promptClose = close;
    }

    /** See PICK_LEVELS for why this exists and how to remove it. */
    private buildLevelPicker(canvas: Node, y: number): void {
        for (let i = 0; i < PICK_LEVELS; i++) {
            const chip = dotSprite(`pick-${i + 1}`, PICK_D, PICK_BG);
            canvas.addChild(chip);
            chip.setPosition((i - (PICK_LEVELS - 1) / 2) * PICK_PITCH, y, 0);
            const label = makeLabel(chip, 'n', 30, 0);
            label.color = PICK_INK;
            label.isBold = true;
            label.string = `${i + 1}`;
            this.pickNodes.push(chip);
        }
    }

    /**
     * Which level chip `ui` landed on, 1-based, or -1 for none. Same circular test and the
     * same UI-space point as `hitsSpeed`.
     */
    hitsLevel(ui: Vec3): number {
        const r = PICK_D / 2 + 8;
        for (let i = 0; i < this.pickNodes.length; i++) {
            const p = this.pickNodes[i].worldPosition;
            const dx = ui.x - p.x;
            const dy = ui.y - p.y;
            if (dx * dx + dy * dy <= r * r) return i + 1;
        }
        return -1;
    }

    /**
     * Stamp the build tag into the bottom-left corner. See TAG_INK for why this exists.
     *
     * Built on first call and updated after that, because the caller stamps it twice: once
     * at startup with the build alone, and again once a level has loaded, with a fingerprint
     * of the data that actually arrived.
     *
     * The label's anchor is moved to its left edge. `makeLabel` leaves it centred, which
     * shipped a tag half off the left of the screen -- it read `ild 0829-1`, having lost the
     * word `build`. A left-aligned STRING inside a centre-anchored box is still centred; the
     * anchor is the thing that had to move.
     */
    setBuildTag(tag: string): void {
        if (!this.buildTag) {
            const { w, h } = canvasSize(this.canvas);
            const margin = w * PILL_MARGIN;
            const label = makeLabel(
                this.canvas, 'BuildTag', 22,
                -h / 2 + safeInsets().bottom * h + margin,
                -w / 2 + margin,
            );
            label.color = TAG_INK;
            label.horizontalAlign = Label.HorizontalAlign.LEFT;
            const tf = label.node.getComponent(UITransform);
            if (tf) tf.setAnchorPoint(0, 0.5);
            this.buildTag = label;
        }
        this.buildTag.string = tag;
    }

    /**
     * Put the button beside the carousel's lower-left flank, given that point already
     * projected into this canvas's space (`GameController.placeSpeedButton` does the
     * projecting -- it is the side that holds both cameras).
     *
     * SIDEWAYS ONLY. The caller hands over a point already at the right height: the middle of
     * the empty band down the track's left side, measured between the track's lowest row and
     * the feeder channel above it. This used to offset upward from the track's bottom-LEFT
     * CORNER by a fixed number of design units, and that corner is a bad place to measure
     * from -- it sits BAND_GAP (0.16 units) above the parking bay, so every placement derived
     * from it starts out crowding the bay and a fixed nudge in design units cannot reliably
     * escape it. Centring in a measured band does, on any screen.
     */
    placeSpeed(ui: Vec3): void {
        this.speedNode.setWorldPosition(ui.x - (SPEED_D / 2 + SPEED_GAP), ui.y, ui.z);
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
        for (let i = 0; i < this.pickNodes.length; i++) {
            const sprite = this.pickNodes[i].getComponent(Sprite);
            if (sprite) sprite.color = i + 1 === id ? PICK_ON : PICK_BG;
        }
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
