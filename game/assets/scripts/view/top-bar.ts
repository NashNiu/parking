import { Color, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import { dotSprite, gearSprite, liftedPill, PILL_INK, PILL_LIFT } from './ui-shapes';
import { BAR_H, BAR_MARGIN_F, makeLabel, rimLabel } from './ui-layout';
import { COIN_FACE, COIN_RIM, CONTROL_BASE, CONTROL_FACE } from './palette';

/**
 * The lobby's standing top bar: a COLUMN down the left edge now, settings above check-in above
 * the coin readout, and the level count centred above all three.
 *
 * IT USED TO BE A ROW -- settings and two reserved places on the right, the coin plate on the
 * left, the caption squeezed into what was left between them. Moved to a column, larger, because
 * a thumb reaching for three controls in the corner of a tall phone reads better as one column it
 * can walk down than as three targets spread across the top edge. The free-coins entry that used
 * to be the second reserved place is GONE as a separate control: it drew the same coin the
 * readout already drew, so the two are now one pill -- see `buildCoins` and `coinTap` below.
 *
 * A COLUMN, NOT BESIDE THE CAPSULE. The wx capsule owns the top-right corner, and the reasoning
 * for going under it rather than around it is written out in full on `ui-layout.capsuleInset` --
 * the short version is that the capsule is about a quarter of the screen wide and its width
 * drifts by device and by WeChat version, so reserving room for it horizontally is a number
 * nobody can pin. This column starts BELOW that reservation, at the same y the old row started
 * at, and runs down the screen instead of across it -- `ui-layout.barBottomY` is where that
 * decision is actually applied, and this file does not even call it -- see the constructor.
 *
 * IT IS STANDING. It is deliberately NOT part of `HomeView.revealMenu`: the coin count and the
 * settings gear are true while the game is still loading, and a bar that popped in with the
 * rail would read as part of the menu rather than as the frame around it.
 *
 * THE HEIGHT AND THE MARGIN ARE NOT DEFINED HERE, AND THE BAND IS NOT EVEN MEASURED HERE.
 * `BAR_H`, `BAR_MARGIN_F` and `barBottomY` live in `ui-layout` because `home-view` centres the
 * rail on the free band UNDER the bar and has to measure that band with the same numbers. A
 * copy here would be two layouts agreeing until the first time one of them is retuned -- and the
 * failure mode is silent: the rail would simply be centred on a band the bar is not actually in.
 * This class imports the two constants and takes the band's position as an ARGUMENT, so there
 * is exactly one call to `barBottomY` on the whole screen; the constructor says why.
 *
 * NO BACKGROUND PLATE. Every control here stands on its own two-plate face; a slab behind the
 * column would be a panel down the side of a screen whose whole subject is a street running off
 * the top of it. What holds the one bare label up is its rim -- see `CAPTION_INK`.
 */

/** The coin plate. 240 wide, same measure the HUD's readouts use; tall now like the two above it. */
const COIN_W = 240;
/** In step with `GEAR_D` / `CHECKIN_D` below, up from the row's 88. */
const COIN_H = 96;
/** The coin itself, at the plate's left end, scaled up from 52 with the plate's own height. */
const COIN_D = 56;
const COIN_PAD = 12;
/**
 * How much of the coin the bright face covers: `COIN_RIM` at the full 56 with `COIN_FACE` at
 * 0.74 of it leaves the darker colour showing as a ring, same proportion the row wore at 52.
 *
 * The two colours and the reason the darker one goes down FIRST now live in `palette`, where
 * the check-in card's seven coins read them too.
 */
const COIN_FACE_F = 0.74;
const COIN_SIZE = 46;

/** The gear and the check-in disc: the same size, up from the row's 76. */
const GEAR_D = 96;
const CHECKIN_D = 96;
/** The vertical gap between stacked controls -- the row's `SLOT_GAP`, turned sideways. */
const COL_GAP = 16;
/** The cogwheel inside its disc, as a fraction of it -- the HUD's gear wears the same ratio. */
const GEAR_GLYPH = 0.62;

/**
 * 「共 N 关」, and the one line of type on this screen with nothing under it.
 *
 * IT USED TO SHARE A ROW WITH THE COIN PLATE AND THE RESERVED PLACES, boxed in by both, which is
 * the paragraph that used to have to prove `683.2` design units of clearance survived the widest
 * populated bar. That proof is gone because the row is: the column stands to the side of this
 * label now, not beside it, so the caption has the FULL WIDTH of the canvas to itself and no
 * clearance arithmetic is needed at all. What survives is only its own y: the same band the row
 * used to occupy, `barBottom + BAR_H / 2` -- the free strip directly above where the column's
 * topmost control (the gear) begins. See the constructor for that number.
 *
 * THE RIM STAYS, FOR A DIFFERENT REASON THAN IT WAS ADDED FOR, and the change is worth writing
 * down because the old reason is the one a reader would guess. It used to be that the road ran
 * behind this label -- `HomeScene` culls its legs at 0.75 of the screen height, well above this
 * bar -- so the surface behind these glyphs was pale pavement at one scroll position and dark
 * asphalt at another, and no single ink survives both. That is no longer true. `HomeView` now
 * lays an OPAQUE `GROUND` cap over the bar's whole band and draws this bar on top of it (see
 * RAIL_FADE_H there), so the background here is `GROUND` (189,200,218), always, everywhere.
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
 * The unread-marker on the check-in disc: a small disc on its top-right corner.
 *
 * 28 against the disc's 96 -- the same ~0.29 ratio the row wore at 22-against-76 -- sitting on
 * the corner rather than inside it, the way the card's close button hangs off its own: a dot
 * drawn inside the disc would read as part of the icon.
 */
const DOT_D = 28;
const DOT_INK = new Color(232, 68, 62, 255);

/** The one reserved place left: check-in, populated from outside with an icon and a handler. */
interface Checkin {
    node: Node;
    onTap: (() => void) | null;
    dot: Node | null;
}

export class TopBar {
    /** Everything the bar draws, under one node. */
    private root: Node;
    private coinLabel: Label;
    private caption: Label;
    private gear: Node;
    private checkin: Checkin;
    /** The merged coin/free-coins pill's own node, for hit-testing. See `coinTap`. */
    private coin: Node;
    /**
     * `null`, PERMANENTLY, until a rewarded-video ad unit exists to point it at.
     *
     * THIS IS THE MERGE. The row used to carry two coin-shaped things: a plain readout on the
     * left showing the balance, and a reserved place on the right that also drew a coin (with a
     * plus struck into it) and did nothing when tapped -- 「免费金币暂时只能看，点击无反应」. Two
     * coins on one bar reading as one thing twice was the reason to fold them: this pill IS the
     * readout, and it is also the one place a rewarded video will eventually hang off, so it
     * gets the same drawn-but-inert treatment the old reserved place had, on the same instruction
     * and for the same reason -- there is still no ad unit to point it at.
     *
     * `null` is load-bearing here the way it was on the old slot's `onTap`, not a convenience: it
     * is the honest way to say "this is meant to do something and does not, yet" rather than
     * writing a `() => {}` that reads, to whoever meets it later, as a handler somebody forgot to
     * fill in. `tapCoins`'s `?.` already handles it, and there is no setter for it here -- when an
     * ad unit exists, the field gains one and this comment is the one to update, not to delete.
     */
    private readonly coinTap: (() => void) | null = null;

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
     * ramp, and this bar. One read on the whole screen. Turning this into a column changed
     * nothing about that argument -- it is still the one number that ties the rail and this bar
     * to the same band, and it is still read once.
     *
     * `h` IS STILL NOT A PARAMETER, and the column changes nothing about why: every y below is
     * `barBottom` plus a fixed offset built from constants (`GEAR_D`, `CHECKIN_D`, `COIN_H`,
     * `COL_GAP`), never from the screen's own height. With the band already resolved there is no
     * y on this bar that needs `h` in scope.
     *
     * X IS ABSOLUTE, Y IS DERIVED, which is the rule `ui-layout.canvasSize` states: the width is
     * pinned at 1280 by FIXED_WIDTH, so the x positions below are portable numbers, while every y
     * has to come off an edge -- here, off `barBottom`, which is itself derived from `h`.
     *
     * On a 1280-wide canvas with `margin = 1280 * 0.03 = 38.4`:
     *
     *     left          = -w/2 + margin                    = -601.6
     *     gear   centre = (left + GEAR_D/2,     barBottom - GEAR_D/2)                = (-553.6, barBottom - 48)
     *     checkin centre= (left + CHECKIN_D/2,  gearY - GEAR_D/2 - COL_GAP - CHECKIN_D/2) = (-553.6, barBottom - 160)
     *     coin   centre = (left + COIN_W/2,     checkinY - CHECKIN_D/2 - COL_GAP - COIN_H/2) = (-481.6, barBottom - 272)
     *
     * THE TOP OF THE COLUMN IS `barBottom` ITSELF -- the gear's own top edge, not its centre --
     * which is the same y the old row's BOTTOM edge sat at. That is deliberate, not a coincidence
     * of the arithmetic: the column runs down the left margin from that line, alongside the rail
     * rather than above it, because the rail's stops never reach this far left (`ZIG_X` keeps
     * them within +-210 of centre, and the column's widest control -- the coin pill -- reaches
     * only to -481.6 + 120 = -361.6, well short of that). Nothing here needed to move
     * `railCenterY`, the cap or the ramp for that reason -- see their own files.
     *
     * THE CAPTION IS NOT PART OF THIS ARITHMETIC ANY MORE. It used to be squeezed into what the
     * row's four controls left between them; with the controls in a column beside it rather than
     * a row around it, the caption owns the full width and sits at `barBottom + BAR_H / 2` -- the
     * same y the row used to occupy, now empty except for it. See its own docblock above.
     */
    constructor(parent: Node, w: number, barBottom: number) {
        const margin = w * BAR_MARGIN_F;
        const left = -w / 2 + margin;

        this.root = new Node('TopBar');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        parent.addChild(this.root);
        this.root.setPosition(0, 0, 0);

        this.caption = makeLabel(this.root, 'TopBarCaption', CAPTION_SIZE, barBottom + BAR_H / 2);
        this.caption.color = CAPTION_INK;
        // A tenth of the type, the width `rimLabel` documents as holding a rim visible without
        // closing up the counters of a Chinese glyph.
        rimLabel(this.caption, CAPTION_RIM, Math.round(CAPTION_SIZE / 10));

        const gearY = barBottom - GEAR_D / 2;
        this.gear = this.buildGear(left + GEAR_D / 2, gearY);

        const checkinY = gearY - GEAR_D / 2 - COL_GAP - CHECKIN_D / 2;
        this.checkin = this.buildCheckin(left + CHECKIN_D / 2, checkinY);

        const coinY = checkinY - CHECKIN_D / 2 - COL_GAP - COIN_H / 2;
        const coins = this.buildCoins(left + COIN_W / 2, coinY);
        this.coin = coins.holder;
        this.coinLabel = coins.label;
    }

    /** The coin readout: the project's two-plate treatment, a coin at its left end, the count. */
    private buildCoins(x: number, y: number): { holder: Node; label: Label } {
        const { holder, face } = liftedPill('TopBarCoins', COIN_W, COIN_H);
        this.root.addChild(holder);
        holder.setPosition(x, y, 0);

        // A concentric pair rather than a struck glyph: at this size a minted face would be
        // a handful of pixels of detail, and this project's rule for a small icon is the
        // silhouette (see the padlock, the passenger). Darker disc, brighter face on it -- see
        // COIN_FACE.
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
        return { holder, label: count };
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
    private buildGear(x: number, y: number): Node {
        const holder = new Node('TopBarGear');
        holder.layer = Layers.Enum.UI_2D;
        holder.addComponent(UITransform).setContentSize(GEAR_D, GEAR_D);
        this.root.addChild(holder);
        holder.setPosition(x, y, 0);
        const base = dotSprite('base', GEAR_D, CONTROL_BASE);
        holder.addChild(base);
        base.setPosition(0, -PILL_LIFT, 0);
        const face = dotSprite('face', GEAR_D, CONTROL_FACE);
        holder.addChild(face);
        face.addChild(gearSprite('glyph', GEAR_D * GEAR_GLYPH, Color.WHITE));
        return holder;
    }

    /**
     * The check-in place: AN EMPTY NODE, SWITCHED OFF, until `setCheckin` fills it.
     *
     * Not a greyed-out button -- a control that is visible and does nothing gets tapped, and the
     * silence that follows reads as a bug in the game rather than as a feature that has not
     * arrived. The place is held open in the ARITHMETIC (the gear and the coin pill already sit
     * where they will sit whether or not this one is filled) and nowhere else.
     */
    private buildCheckin(x: number, y: number): Checkin {
        const node = new Node('TopBarCheckin');
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(CHECKIN_D, CHECKIN_D);
        this.root.addChild(node);
        node.setPosition(x, y, 0);
        node.active = false;
        return { node, onTap: null, dot: null };
    }

    /**
     * Put something in the check-in place, or take it out again.
     *
     * The icon is adopted as the place's only child and it is switched on; `null` switches it
     * back off and empties it. The caller keeps no reference it has to remember to detach -- a
     * half-populated place (switched on, nothing in it) is a hole in the bar, and the only way to
     * make one is to hand this a node that draws nothing.
     */
    setCheckin(slot: { icon: Node; onTap: () => void } | null): void {
        const s = this.checkin;
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
     * Show or hide the check-in place's unread dot.
     *
     * Built on FIRST use, so a game that never calls this never pays for a dot node it does not
     * need. It is added last so it draws over the icon, and it is a child of the place's own
     * node, so `setCheckin` clearing that node's children takes the dot with it -- which is why
     * `dot` is cleared there too rather than being left pointing at a detached node.
     */
    setCheckinDot(on: boolean): void {
        const s = this.checkin;
        if (!s.dot) {
            if (!on) return;
            s.dot = dotSprite('dot', DOT_D, DOT_INK);
            s.node.addChild(s.dot);
            s.dot.setPosition(CHECKIN_D / 2 - DOT_D / 4, CHECKIN_D / 2 - DOT_D / 4, 0);
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
     * Whether `ui` landed on the check-in place.
     *
     * AN EMPTY PLACE CANNOT BE HIT. `buildCheckin` leaves the node switched off and
     * `setCheckin(null)` switches it back off, so the one flag that decides whether the place is
     * drawn also decides whether it answers -- the same discipline `HomeView`'s `waiting` keeps,
     * and for the same reason: an invisible control that still takes taps is a dead zone on a bar
     * whose neighbours are live.
     */
    hitsCheckin(ui: Vec3): boolean {
        if (!this.root.activeInHierarchy || !this.checkin.node.active) return false;
        const p = this.checkin.node.worldPosition;
        return Math.abs(ui.x - p.x) <= CHECKIN_D / 2 + TAP_PAD
            && Math.abs(ui.y - p.y) <= CHECKIN_D / 2 + TAP_PAD;
    }

    /**
     * Fire the handler `setCheckin` was given. Safe on an empty place.
     *
     * Separate from `hitsCheckin` so that the hit test stays a pure question, which is what
     * every other hit test on both screens is -- the caller decides whether a press that landed
     * here was a tap or the end of a drag, and only then acts.
     */
    tapCheckin(): void {
        this.checkin.onTap?.();
    }

    /**
     * Whether `ui` landed on the coin pill. Always tested, and always answered by `tapCoins`
     * with nothing -- see `coinTap`. Measured against the PILL's box, not a disc: this control
     * is a 240x96 plate, the same shape `hitsStart` measures for the button below.
     */
    hitsCoins(ui: Vec3): boolean {
        if (!this.root.activeInHierarchy) return false;
        const p = this.coin.worldPosition;
        return Math.abs(ui.x - p.x) <= COIN_W / 2 + TAP_PAD
            && Math.abs(ui.y - p.y) <= COIN_H / 2 + TAP_PAD;
    }

    /** Fire the coin pill's handler. See `coinTap` for why this is always a no-op today. */
    tapCoins(): void {
        this.coinTap?.();
    }
}
