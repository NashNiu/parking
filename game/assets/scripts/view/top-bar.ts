import { Color, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import { dotSprite, gearSprite, liftedPill, PILL_LIFT } from './ui-shapes';
import { BAR_H, BAR_MARGIN_F, makeLabel, rimLabel } from './ui-layout';

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
 * TWO DISCS, DARKER FIRST: the rim is the full 52 and the bright face is drawn on top at
 * `COIN_FACE_F` of it, which leaves the darker colour showing as a ring about 7 units wide.
 *
 * THE ORDER IS THE WHOLE OF IT, and the first version had it backwards -- gold underneath, the
 * darker disc on top -- which draws a dark 38-unit centre with gold surviving only as a thin
 * outer ring. That is a washer, not a coin, and it inverts the layering every other object in
 * this project uses: `liftedPill`, `buildGear` and the rail's own badges all put the darker
 * plate down first and the brighter face over it. Same rule here, so the name and the picture
 * agree.
 */
const COIN_GOLD = new Color(255, 196, 46, 255);
const COIN_RIM = new Color(214, 152, 20, 255);
const COIN_FACE_F = 0.74;
const COIN_INK = new Color(48, 60, 92, 255);
const COIN_SIZE = 44;

/** The gear, and the two reserved places beside it. All three are the same disc. */
const GEAR_D = 76;
const SLOT_D = 76;
const SLOT_GAP = 16;
/** The cogwheel inside its disc, as a fraction of it -- the HUD's gear wears the same ratio. */
const GEAR_GLYPH = 0.62;
/**
 * The gear's two plates.
 *
 * THE SAME PAIR THE HUD'S GEAR WEARS, written out here rather than imported: the HUD's copy is
 * `CARD_RIM_FACE` / `CARD_RIM_BASE`, named for the settings CARD it rims, and it is private to
 * `hud-view`. Importing it would point the lobby at the in-game HUD for a colour, which is the
 * coupling `ui-layout`'s own header was split out to avoid. The honest position is that these
 * two want to be in `palette.ts` next to `GROUND` and `ROAD`, and moving them is a change to
 * every settings panel in `hud-view` -- more than this task should touch. Flagged, not hidden.
 */
const GEAR_FACE = new Color(42, 138, 208, 255);
const GEAR_BASE = new Color(20, 92, 150, 255);

/**
 * 「共 N 关」, and the one line of type on this screen with nothing under it.
 *
 * IT USED TO HAVE A PLATE, a 320x88 slab floating over the road, and the plate is the half of
 * the complaint this bar is here to answer. The badge that scrolls behind it is 205 across but
 * about 285 tall once its star row is counted, so the badge's top and bottom stuck out past the
 * plate's ends and the pair read as a clipping fault rather than as a caption. In the bar the
 * label is above the rail entirely and nothing scrolls through it.
 *
 * THE ROAD STILL PASSES BEHIND IT, which is why the rim stays. `HomeScene` culls its legs at
 * 0.75 of the screen height and this bar sits well inside that, so the surface behind these
 * glyphs is sometimes pale pavement (189,200,218) and sometimes dark asphalt (86,93,108). No
 * single ink survives both; white with a navy rim survives either, which is exactly the job
 * `rimLabel` exists for.
 */
const CAPTION_SIZE = 36;
const CAPTION_INK = new Color(255, 255, 255, 255);
const CAPTION_RIM = new Color(30, 40, 66, 235);

/** Slack around a tap, in design units: the same padding every other hit test here uses. */
const TAP_PAD = 10;

/** One reserved place: the holder that is positioned, and what is currently in it. */
interface Slot {
    node: Node;
    onTap: (() => void) | null;
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
     * WHAT IT PREVENTS. `barBottomY` reads `capsuleInset()`, which (see `ui-layout`) no longer
     * caches an unanswered read: if wx is present but the capsule rect is not ready, it returns
     * 0 WITHOUT caching and the next caller asks again. That is deliberate -- caching a failed
     * read pins every top-anchored control under the system capsule for the life of the process
     * -- but it means the function can legitimately return one number early in a session and a
     * larger one later. Every extra caller is therefore another chance for two parts of one
     * layout to be built against two different bands.
     *
     * That disagreement is EXACTLY what `BAR_H` and `barBottomY` were moved into `ui-layout` to
     * make impossible: `HomeView` centres the rail on the free band under this bar, and if the
     * rail's idea of the band and the bar's idea of the band differ, the rail is centred on
     * nothing and nothing says so. `HomeView` pulled its own three reads down to one snapshot
     * (`HomeView.barBottom`) for that reason; this constructor is the fourth caller, and taking
     * the number rather than re-deriving it is what makes the guarantee STRUCTURAL instead of an
     * argument about how fast two statements run.
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
        // (see the padlock, the passenger). Darker disc, brighter face on it -- see COIN_GOLD.
        const coin = dotSprite('coin', COIN_D, COIN_RIM);
        face.addChild(coin);
        coin.setPosition(-COIN_W / 2 + COIN_PAD + COIN_D / 2, 0, 0);
        coin.addChild(dotSprite('face', COIN_D * COIN_FACE_F, COIN_GOLD));

        // Centred in what the coin leaves, not nudged off the plate's middle -- the same
        // arithmetic the HUD's passenger count uses for the same reason.
        const coinRight = -COIN_W / 2 + COIN_PAD + COIN_D;
        const count = makeLabel(face, 'TopBarCoinCount', COIN_SIZE, 0, (coinRight + COIN_W / 2) / 2);
        count.color = COIN_INK;
        count.isBold = true;
        count.string = '0';
        return count;
    }

    /** See GEAR_FACE: the same disc, the same drawn cogwheel, as the one on the board's HUD. */
    private buildGear(x: number): Node {
        const holder = new Node('TopBarGear');
        holder.layer = Layers.Enum.UI_2D;
        holder.addComponent(UITransform).setContentSize(GEAR_D, GEAR_D);
        this.root.addChild(holder);
        holder.setPosition(x, 0, 0);
        const base = dotSprite('base', GEAR_D, GEAR_BASE);
        holder.addChild(base);
        base.setPosition(0, -PILL_LIFT, 0);
        const face = dotSprite('face', GEAR_D, GEAR_FACE);
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
     * The two that are coming are the daily check-in and the free-coins entry (a rewarded
     * video). Neither exists yet, and `setSlot` is how either arrives.
     */
    private buildSlot(i: 0 | 1, x: number): Slot {
        const node = new Node(`TopBarSlot${i}`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(SLOT_D, SLOT_D);
        this.root.addChild(node);
        node.setPosition(x, 0, 0);
        node.active = false;
        return { node, onTap: null };
    }

    /**
     * Put something in one of the reserved places, or take it out again.
     *
     * The icon is adopted as the slot's only child and the slot is switched on; `null` switches
     * it back off and empties it. The caller keeps no reference it has to remember to detach --
     * a half-populated slot (switched on, nothing in it) is a hole in the bar, and the only way
     * to make one is to hand this a node that draws nothing.
     */
    setSlot(i: 0 | 1, slot: { icon: Node; onTap: () => void } | null): void {
        const s = this.slots[i];
        s.node.removeAllChildren();
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
