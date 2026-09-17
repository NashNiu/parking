import { Color, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import { dotSprite, gearSprite, liftedPill, PILL_INK, PILL_LIFT } from './ui-shapes';
import { BAR_H, BAR_MARGIN_F, makeLabel, rimLabel } from './ui-layout';
import { COIN_FACE, COIN_RIM, CONTROL_BASE, CONTROL_FACE } from './palette';

/**
 * The lobby's standing top bar: the coin readout on the left, the settings gear on the right,
 * two reserved places between them, and the level count in the middle.
 *
 * ONE ROW UNDER THE CAPSULE, NOT BESIDE IT. The wx capsule owns the top-right corner, and the
 * reasoning for going under it rather than around it is written out in full on
 * `ui-layout.capsuleInset` -- the short version is that the capsule is about a quarter of the
 * screen wide and its width drifts by device and by WeChat version, so reserving room for it
 * horizontally would cost one of this bar's four places AND be a number nobody can pin. The
 * bar sits below it and keeps the whole 1280 to itself. `ui-layout.barBottomY` is where that
 * decision is actually applied, and this file does not even call it -- see the constructor.
 *
 * IT IS STANDING. It is deliberately NOT part of `HomeView.revealMenu`: the coin count and the
 * settings gear are true while the game is still loading, and a bar that popped in with the
 * rail would read as part of the menu rather than as the frame around it.
 *
 * THE HEIGHT AND THE MARGIN ARE NOT DEFINED HERE, AND THE BAND IS NOT EVEN MEASURED HERE.
 * `BAR_H`, `BAR_MARGIN_F` and `barBottomY` live in `ui-layout` because `home-view` centres the
 * rail on the free band UNDER this bar and has to measure that band with the same numbers. A
 * copy here would be two layouts agreeing until the first time one of them is retuned -- and the
 * failure mode is silent: the rail would simply be centred on a band the bar is not actually in.
 * This class imports the two constants and takes the band's position as an ARGUMENT, so there
 * is exactly one call to `barBottomY` on the whole screen; the constructor says why.
 *
 * NO BACKGROUND PLATE. The bar is four objects on a row, each standing on its own face; a slab
 * behind them would be a second horizon across the top of a screen whose whole subject is a
 * street running off the top of it. What holds the one bare label up is its rim -- see
 * `CAPTION_INK`.
 */

/** The coin plate. Same 240x88 as the HUD's readouts: one screen's row, cut to one measure. */
const COIN_W = 240;
const COIN_H = 88;
/** The coin itself, at the plate's left end, the way the passenger badge sits on the HUD's. */
const COIN_D = 52;
const COIN_PAD = 12;
/**
 * How much of the coin the bright face covers: `COIN_RIM` at the full 52 with `COIN_FACE` at
 * 0.74 of it leaves the darker colour showing as a ring about 7 units wide.
 *
 * The two colours and the reason the darker one goes down FIRST now live in `palette`, where
 * the check-in card's seven coins read them too.
 */
const COIN_FACE_F = 0.74;
const COIN_SIZE = 44;

/** The gear, and the two reserved places beside it. All three are the same disc. */
const GEAR_D = 76;
const SLOT_D = 76;
const SLOT_GAP = 16;
/** The cogwheel inside its disc, as a fraction of it -- the HUD's gear wears the same ratio. */
const GEAR_GLYPH = 0.62;
/**
 * 「共 N 关」, and the one line of type on this screen with nothing under it.
 *
 * IT USED TO HAVE A PLATE, a 320x88 slab floating over the road, and the plate is the half of
 * the complaint this bar is here to answer. The badge that scrolled behind it was 205 across and
 * about 285 tall once its star row was counted, so its top and bottom stuck out past the plate's
 * ends and the pair read as a clipping fault rather than as a caption. (The badge is 170 by 221
 * now, and would still not have fitted.) In the bar the label is above the rail entirely and
 * nothing scrolls through it.
 *
 * THE RIM STAYS, FOR A DIFFERENT REASON THAN IT WAS ADDED FOR, and the change is worth
 * writing down because the old reason is the one a reader would guess. It used to be that the
 * road ran behind this label -- `HomeScene` culls its legs at 0.75 of the screen height, well
 * above this bar -- so the surface behind these glyphs was pale pavement at one scroll position
 * and dark asphalt at another, and no single ink survives both. That is no longer true.
 * `HomeView` now lays an OPAQUE `GROUND` cap over the bar's whole band and draws this bar on top
 * of it (see RAIL_FADE_H there), so the background here is `GROUND` (189,200,218), always,
 * everywhere along the row.
 *
 * ONE KNOWN BACKGROUND IS NOT THE SAME AS A LEGIBLE ONE. White on 189,200,218 is about 1.7:1,
 * which is a pale line on pale pavement rather than a caption. The rim is what carries it: a
 * near-opaque navy outline puts a dark edge around every stroke, so what the eye reads is the
 * outline's contrast against the pavement (about 12:1) rather than the white's. Turning the rim
 * off and darkening the ink instead would work too -- and would cost this row the toy-UI
 * treatment every other fixed label in the project wears. See `rimLabel`.
 */
const CAPTION_SIZE = 36;
const CAPTION_INK = new Color(255, 255, 255, 255);
const CAPTION_RIM = new Color(30, 40, 66, 235);

/** Slack around a tap, in design units: the same padding every other hit test here uses. */
const TAP_PAD = 10;

/**
 * The unread-marker on a slot: a small disc on its top-right corner.
 *
 * 22 against the slot's 76, sitting on the corner rather than inside it, the way the card's
 * close button hangs off its own -- a dot drawn inside the disc would read as part of the icon.
 */
const DOT_D = 22;
const DOT_INK = new Color(232, 68, 62, 255);

/** One reserved place: the holder that is positioned, and what is currently in it. */
interface Slot {
    node: Node;
    /**
     * `null` means DRAWN BUT INERT, which is a real state here and not a missing handler --
     * see `setSlot`, where the one slot that uses it is named.
     */
    onTap: (() => void) | null;
    dot: Node | null;
}

export class TopBar {
    /** Everything the bar draws, under one node. */
    private root: Node;
    private coinLabel: Label;
    private caption: Label;
    private gear: Node;
    private slots: Slot[];

    /**
     * `barBottom` IS HANDED IN, NOT COMPUTED HERE, and that is the one thing about this
     * signature worth defending -- it looks like a simplification waiting to happen, and it is
     * not. `barBottomY(w, h)` is right there and this class imports its two constants already,
     * so calling it would be shorter. Do not.
     *
     * WHAT IT PREVENTS. `HomeView` centres the rail on the free band UNDER this bar, and if the
     * rail's idea of where the band is and the bar's idea of it ever differ, the rail is centred
     * on nothing and nothing says so. That is exactly the disagreement `BAR_H` and `barBottomY`
     * were moved into `ui-layout` to make impossible, and a second call site is the back door
     * into it. `HomeView` reads `barBottomY` ONCE, in its constructor, into `HomeView.barBottom`,
     * and hands the result to everything that measures off it -- the rail's centre, the cap, the
     * ramp, and this bar. One read on the whole screen.
     *
     * WHY THAT IS A RULE AND NOT A MICRO-OPTIMISATION, given that `barBottomY` is in fact stable:
     * `capsuleInset()` caches its one read, so today two calls cannot disagree. Today. That is a
     * property of a function in another file, and this bar's agreement with the rail would be an
     * inference from it rather than a fact about this screen -- the same shape as the argument
     * that used to be made here, that wx cannot change state between two statements of one
     * synchronous constructor. It was true and it was not a guarantee, and it stopped being true
     * once: `capsuleInset` spent a while deliberately NOT caching an unanswered read so a later
     * caller could retry, which made `barBottomY` legitimately return one number early in a
     * session and a larger one later. The retry is gone (it had one caller; see `ui-layout`), and
     * the number passed down is what makes this bar and that rail share a band BY CONSTRUCTION,
     * whatever the next revision of `capsuleInset` decides to do.
     *
     * `h` is not a parameter at all, for the same reason stated positively: with the band already
     * resolved there is no y on this bar that needs the screen's height, so the height is not in
     * scope and the wrong thing cannot be computed from it.
     *
     * X IS ABSOLUTE, Y IS DERIVED, which is the rule `ui-layout.canvasSize` states: the width is
     * pinned at 1280 by FIXED_WIDTH, so the four x positions below are portable numbers, while
     * every y has to come off an edge.
     *
     *     y            = barBottom + BAR_H / 2
     *     coin centre  = -w/2 + margin + COIN_W/2        = -481.6   (left edge -601.6)
     *     gear centre  =  w/2 - margin - GEAR_D/2        =  563.6   (right edge 601.6)
     *     slot 1       =  gear - GEAR_D/2 - GAP - SLOT_D/2 = 471.6
     *     slot 0       =  slot 1 - SLOT_D - GAP          =  379.6   (left edge 341.6)
     *
     * WHAT THE CAPTION HAS LEFT, and it is the number worth checking rather than the four
     * above: the coin's right edge is at -361.6 and slot 0's left edge at 341.6, so the gap is
     * 703.2 wide and NOT centred on zero -- its middle is at -10. A label centred at 0 therefore
     * has 341.6 of clearance on its tighter side, so the width it can actually use is 683.2.
     * 「共 10 关」 at 36 bold is about 145 across and 「共 100 关」 about 181, so it clears both
     * populated slots with room to spare, which is the point of measuring it against the
     * POPULATED bar rather than against the empty one it ships as.
     */
    constructor(parent: Node, w: number, barBottom: number) {
        const margin = w * BAR_MARGIN_F;
        const y = barBottom + BAR_H / 2;

        this.root = new Node('TopBar');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform).setContentSize(w, BAR_H);
        parent.addChild(this.root);
        this.root.setPosition(0, y, 0);

        this.coinLabel = this.buildCoins(-w / 2 + margin + COIN_W / 2);

        this.caption = makeLabel(this.root, 'TopBarCaption', CAPTION_SIZE, 0);
        this.caption.color = CAPTION_INK;
        // A tenth of the type, the width `rimLabel` documents as holding a rim visible without
        // closing up the counters of a Chinese glyph.
        rimLabel(this.caption, CAPTION_RIM, Math.round(CAPTION_SIZE / 10));

        const gearX = w / 2 - margin - GEAR_D / 2;
        this.gear = this.buildGear(gearX);

        const slot1X = gearX - GEAR_D / 2 - SLOT_GAP - SLOT_D / 2;
        const slot0X = slot1X - SLOT_D - SLOT_GAP;
        this.slots = [this.buildSlot(0, slot0X), this.buildSlot(1, slot1X)];
    }

    /** The coin readout: the project's two-plate treatment, a coin at its left end, the count. */
    private buildCoins(x: number): Label {
        const { holder, face } = liftedPill('TopBarCoins', COIN_W, COIN_H);
        this.root.addChild(holder);
        holder.setPosition(x, 0, 0);

        // A concentric pair rather than a struck glyph: at 52 units a minted face would be
        // three pixels of detail, and this project's rule for a small icon is the silhouette
        // (see the padlock, the passenger). Darker disc, brighter face on it -- see COIN_FACE.
        const coin = dotSprite('coin', COIN_D, COIN_RIM);
        face.addChild(coin);
        coin.setPosition(-COIN_W / 2 + COIN_PAD + COIN_D / 2, 0, 0);
        coin.addChild(dotSprite('face', COIN_D * COIN_FACE_F, COIN_FACE));

        // Centred in what the coin leaves, not nudged off the plate's middle -- the same
        // arithmetic the HUD's passenger count uses for the same reason.
        const coinRight = -COIN_W / 2 + COIN_PAD + COIN_D;
        const count = makeLabel(face, 'TopBarCoinCount', COIN_SIZE, 0, (coinRight + COIN_W / 2) / 2);
        // `PILL_INK`, not a copy of it. This plate is `liftedPill`'s face, and the ink that
        // goes on that face travels with it -- see `ui-shapes`, where both now live.
        count.color = PILL_INK;
        count.isBold = true;
        count.string = '0';
        return count;
    }

    /**
     * The same disc, wearing the same two plates and the same drawn cogwheel, as the gear on
     * the board's HUD -- `CONTROL_FACE` / `CONTROL_BASE`, imported from `palette`.
     *
     * THIS FILE USED TO CARRY ITS OWN COPY of those two numbers, with a note saying it would
     * rather import them: the HUD's pair was `CARD_RIM_FACE` / `CARD_RIM_BASE`, private to
     * `hud-view` and named for the settings CARD it rims, so the lobby had nothing it could
     * honestly import and wrote the values down instead. They are in `palette` now under a
     * name that fits both callers, and the copy is gone -- the same resolution `liftedPill`
     * got when this bar needed the HUD's pill. Nothing about the colour changed.
     */
    private buildGear(x: number): Node {
        const holder = new Node('TopBarGear');
        holder.layer = Layers.Enum.UI_2D;
        holder.addComponent(UITransform).setContentSize(GEAR_D, GEAR_D);
        this.root.addChild(holder);
        holder.setPosition(x, 0, 0);
        const base = dotSprite('base', GEAR_D, CONTROL_BASE);
        holder.addChild(base);
        base.setPosition(0, -PILL_LIFT, 0);
        const face = dotSprite('face', GEAR_D, CONTROL_FACE);
        holder.addChild(face);
        face.addChild(gearSprite('glyph', GEAR_D * GEAR_GLYPH, Color.WHITE));
        return holder;
    }

    /**
     * One reserved place: AN EMPTY NODE, SWITCHED OFF. It draws nothing at all.
     *
     * Not a greyed-out button, and this is the one decision in the file that is about the
     * player rather than about the layout. A control that is visible and does nothing gets
     * tapped, and the silence that follows reads as a bug in the game rather than as a feature
     * that has not arrived -- so a disabled button costs trust that empty space does not. The
     * places are held open in the ARITHMETIC (the gear and the coin plate already sit where
     * they will sit once both are filled) and nowhere else.
     *
     * BOTH ARE FILLED NOW -- the daily check-in in slot 1 and the free-coins entry in slot 0 --
     * so the paragraph above describes a state the bar no longer ships in. It stays because the
     * rule it states still binds: an EMPTY place draws nothing and answers nothing, and that is
     * still what `setSlot(i, null)` gives you.
     *
     * AND THE FREE-COINS SLOT IS THE EXCEPTION TO IT, deliberately and on instruction. It is
     * drawn at full weight and has no handler at all: 「免费金币暂时只能看，点击无反应」. That is
     * exactly the visible-does-nothing control the paragraph above argues costs trust, and the
     * argument has not stopped being true -- it is outweighed here by the bar reading as three
     * equal controls rather than two-and-a-gap while the rewarded video it fronts has no ad unit
     * to point at. When one exists, `setSlot` takes a handler and the exception closes.
     */
    private buildSlot(i: 0 | 1, x: number): Slot {
        const node = new Node(`TopBarSlot${i}`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(SLOT_D, SLOT_D);
        this.root.addChild(node);
        node.setPosition(x, 0, 0);
        node.active = false;
        return { node, onTap: null, dot: null };
    }

    /**
     * Put something in one of the reserved places, or take it out again.
     *
     * The icon is adopted as the slot's only child and the slot is switched on; `null` switches
     * it back off and empties it. The caller keeps no reference it has to remember to detach --
     * a half-populated slot (switched on, nothing in it) is a hole in the bar, and the only way
     * to make one is to hand this a node that draws nothing.
     *
     * `onTap` IS NULLABLE, and the null is load-bearing rather than a convenience. The free-coins
     * slot is drawn and does nothing on purpose (see `buildSlot`), and the honest way to say that
     * is a handler that is absent -- not a `() => {}` that reads, to everyone who meets it later,
     * as a handler somebody forgot to fill in. `tapSlot`'s `?.` already handles it.
     */
    setSlot(i: 0 | 1, slot: { icon: Node; onTap: (() => void) | null } | null): void {
        const s = this.slots[i];
        s.node.removeAllChildren();
        s.dot = null;
        if (!slot) {
            s.onTap = null;
            s.node.active = false;
            return;
        }
        s.node.addChild(slot.icon);
        slot.icon.setPosition(0, 0, 0);
        s.onTap = slot.onTap;
        s.node.active = true;
    }

    /**
     * Show or hide a slot's unread dot.
     *
     * Built on FIRST use rather than with the slot, because only one of the two ever wears one
     * and a dot node switched off in the other is a thing to explain. It is added last so it
     * draws over the icon, and it is a child of the slot's own node, so `setSlot` clearing that
     * node's children takes the dot with it -- which is why `dot` is cleared there too rather
     * than being left pointing at a detached node.
     */
    setSlotDot(i: 0 | 1, on: boolean): void {
        const s = this.slots[i];
        if (!s.dot) {
            if (!on) return;
            s.dot = dotSprite('dot', DOT_D, DOT_INK);
            s.node.addChild(s.dot);
            s.dot.setPosition(SLOT_D / 2 - DOT_D / 4, SLOT_D / 2 - DOT_D / 4, 0);
        }
        s.dot.active = on;
    }

    /** The coin count. Formatting is the caller's: this draws whatever number it is given. */
    setCoins(n: number): void {
        this.coinLabel.string = `${Math.max(0, Math.round(n))}`;
    }

    /** 「共 N 关」. Written by `HomeView.setLevels`, which is what knows the count. */
    setCaption(text: string): void {
        this.caption.string = text;
    }

    /**
     * Whether `ui` (UI space) landed on the gear.
     *
     * `activeInHierarchy` rather than the bar's own flag: the bar is standing, so the only
     * thing that can switch it off is the lobby closing, and asking the node is asking the
     * question that actually decides whether it is on screen.
     */
    hitsGear(ui: Vec3): boolean {
        if (!this.root.activeInHierarchy) return false;
        const p = this.gear.worldPosition;
        return Math.abs(ui.x - p.x) <= GEAR_D / 2 + TAP_PAD
            && Math.abs(ui.y - p.y) <= GEAR_D / 2 + TAP_PAD;
    }

    /**
     * Which reserved place `ui` landed on, or -1 for none.
     *
     * AN EMPTY SLOT CANNOT BE HIT. `buildSlot` leaves the node switched off and `setSlot(i,
     * null)` switches it back off, so the one flag that decides whether the place is drawn also
     * decides whether it answers -- the same discipline `HomeView`'s `waiting` keeps, and for
     * the same reason: an invisible control that still takes taps is a dead zone on a bar whose
     * neighbours are live.
     */
    hitsSlot(ui: Vec3): 0 | 1 | -1 {
        if (!this.root.activeInHierarchy) return -1;
        for (const i of [0, 1] as const) {
            const s = this.slots[i];
            if (!s.node.active) continue;
            const p = s.node.worldPosition;
            if (Math.abs(ui.x - p.x) <= SLOT_D / 2 + TAP_PAD
                && Math.abs(ui.y - p.y) <= SLOT_D / 2 + TAP_PAD) return i;
        }
        return -1;
    }

    /**
     * Fire the handler the slot was populated with. Safe on an empty one.
     *
     * Separate from `hitsSlot` so that the hit test stays a pure question, which is what every
     * other hit test on both screens is -- the caller decides whether a press that landed here
     * was a tap or the end of a drag, and only then acts. Without this the `onTap` handed to
     * `setSlot` would be a field nothing ever reads.
     */
    tapSlot(i: 0 | 1): void {
        this.slots[i].onTap?.();
    }
}
