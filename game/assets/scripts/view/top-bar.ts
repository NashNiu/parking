import { Color, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import {
    dotSprite, gearSprite, PILL_BASE, PILL_BG, PILL_INK, Plates, toonDisc, toonPill,
} from './ui-shapes';
import { BAR_MARGIN_F, makeLabel } from './ui-layout';
import {
    COIN_FACE, COIN_RIM, CONTROL_BASE, CONTROL_EDGE, CONTROL_FACE, shade,
} from './palette';

/**
 * The lobby's standing top bar: a COLUMN down the left edge, settings above check-in above the
 * coin readout. Three controls, and nothing else on the bar at all.
 *
 * IT USED TO BE A ROW -- settings and two reserved places on the right, the coin plate on the
 * left, a 「共 N 关」 caption squeezed into what was left between them. Moved to a column, larger,
 * because a thumb reaching for three controls in the corner of a tall phone reads better as one
 * column it can walk down than as three targets spread across the top edge. The free-coins entry
 * that used to be the second reserved place is GONE as a separate control: it drew the same coin
 * the readout already drew, so the two are now one pill -- see `buildCoins` and `coinTap` below.
 *
 * THE CAPTION IS GONE TOO, ON INSTRUCTION -- the requirement is to drop the title. Worth saying
 * what went with it, because it is nothing the screen does not already say: the rail IS the level
 * count, drawn, and a player who wants the total scrolls to the end of it. What it cost was a
 * whole band of the bar reserved for one fact, and the only line of type on this screen that
 * needed a rim to be legible at all. That band is empty now and stays empty -- the column hangs
 * DOWN from `barBottom` and nothing is centred above it.
 *
 * AND THE COLUMN IS A FIFTH LARGER THAN IT SHIPPED -- see `COL_SCALE`.
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
 * This class takes the band's position as an ARGUMENT, so there is exactly one call to
 * `barBottomY` on the whole screen; the constructor says why. `BAR_H` is no longer imported at
 * all: the caption was the only thing here that ever measured the band rather than hanging off
 * its edge, and everything left hangs off `barBottom`.
 *
 * NO BACKGROUND PLATE. Every control here stands on its own two-plate face; a slab behind the
 * column would be a panel down the side of a screen whose whole subject is a street running off
 * the top of it. With the caption gone there is no bare type left on this bar to hold up.
 */

/**
 * THE COLUMN'S SIZE STEP. Every diameter, plate measure, glyph size and gap below is the number
 * this bar shipped with, multiplied by this and rounded -- the requirement asks for the three
 * controls to grow by a fifth in BOTH size and spacing, after the column read as small on a real
 * phone.
 *
 * ONE STEP, WRITTEN ONCE, rather than nine hand-scaled literals. Three controls that are each
 * supposed to be a fifth larger are three chances to fat-finger one of them, and the symptom --
 * a column where one disc is 114 and its neighbour 115 -- is invisible in a diff and obvious on
 * a screen.
 *
 * ROUNDED PER CONSTANT, not carried through the arithmetic as a fraction. These are pixel sizes
 * on a 1280-wide design canvas: a plate 115.2 units tall lands its edges on a different
 * sub-pixel than the 115.2 disc beside it, and the pass this landed in was opened because
 * fractional sizes were coming out soft. Every ratio quoted in the docblocks below is stated
 * against the ROUNDED number, not against the fraction it came from.
 */
export const COL_SCALE = 1.2;

/** The coin plate. The HUD readouts' 240 measure, stepped up with the rest of the column. */
const COIN_W = Math.round(240 * COL_SCALE);
/** In step with `GEAR_D` / `CHECKIN_D` below: the row's 88, then 96, now this. */
const COIN_H = Math.round(96 * COL_SCALE);
/** The coin itself, at the plate's left end, rising with the plate's own height. */
const COIN_D = Math.round(56 * COL_SCALE);
const COIN_PAD = Math.round(12 * COL_SCALE);
/**
 * How much of the coin the bright face covers: `COIN_RIM` at the full `COIN_D` (67) with
 * `COIN_FACE` at 0.74 of it leaves the darker colour showing as a ring -- the same proportion
 * the bar has worn at every diameter it has had (52 in the row, then 56, now 67).
 *
 * The two colours and the reason the darker one goes down FIRST now live in `palette`, where
 * the check-in card's seven coins read them too.
 */
const COIN_FACE_F = 0.74;
const COIN_SIZE = Math.round(46 * COL_SCALE);

/** The gear and the check-in disc: the same size as each other, always. 76, then 96, now 115. */
const GEAR_D = Math.round(96 * COL_SCALE);
/**
 * EXPORTED, because this bar does not draw the check-in control -- it holds a place for one.
 *
 * `buildCheckin` makes an empty node and `setCheckin` adopts whatever icon the caller hands it,
 * and that icon brings its own two plates: what the player sees as the check-in button is drawn
 * in `home-view`, at whatever diameter that file picks. So this constant sets the HIT BOX and
 * the column's arithmetic while a number in another file sets the PICTURE, and when they
 * disagree nothing fails -- the button is simply the wrong size, sitting in a slot that is
 * still reserving the right one.
 *
 * They disagreed the moment `COL_SCALE` landed: `home-view` had its own `96` written down, so
 * the gear grew and the check-in disc beside it did not. Exporting this is the fix, and it is
 * the right shape rather than the convenient one -- the icon has to FILL the place, so the
 * place's diameter is not a number the icon should be choosing for itself.
 */
export const CHECKIN_D = Math.round(96 * COL_SCALE);
/**
 * The gap between one control's LOWEST DRAWN EDGE and the next one's top.
 *
 * MEASURED ON WHAT IS DRAWN, NOT ON THE FACES. Each control hangs `COL_LIFT + COL_STROKE` of
 * side and rim below its face, so a gap measured face-to-face is 18 units smaller than it looks
 * on the arithmetic -- and that is not a rounding error, it is most of what the gap was. See the
 * constructor for where those two terms enter the spacing.
 *
 * A FLAT NUMBER, NOT A MULTIPLE OF `COL_SCALE`, because scaling it is what failed. It was 16 in
 * the old row and 19 after the column grew by a fifth, and the answer to that was 「间距还是太
 * 小」: a fifth of a number that was already too small is still too small. 40 is about a third
 * of a disc, and it is set directly so the next retune is a number somebody chose rather than a
 * number that fell out of a different decision.
 */
const COL_GAP = 40;

/**
 * How thick a control's side is, and how wide the dark line around it.
 *
 * 「样式能否做的更卡通一些」. What makes the rail's badges read as toys and made these read as
 * flat chips was never the colour: it was that a badge is a disc with a visible SIDE and a dark
 * rim, and these were a disc with a 6-unit lip and nothing around it. `NODE_LIFT` is 12% of a
 * badge's diameter; the same fraction of 115 is 14, against the 6 these wore -- a lip that was
 * 5% of the control and read as a drop shadow rather than as thickness. The stroke is
 * `NODE_EDGE`'s 4 unchanged, because a rim is a line and a line does not scale with its object.
 *
 * NOT DERIVED FROM `COL_SCALE`. These are not the column getting bigger, they are the column
 * being drawn differently, and the two happened in the same file for different reasons -- if the
 * column is ever resized again the lift should follow the DIAMETER (12% of it) and the stroke
 * should not move at all.
 *
 * EXPORTED FOR THE SAME REASON `CHECKIN_D` IS: the check-in control is drawn in `home-view` and
 * only HELD here, so a treatment that lived privately in this file would have restyled two of
 * the column's three controls and left the middle one flat.
 */
export const COL_LIFT = Math.round(GEAR_D * 0.12);
export const COL_STROKE = 4;

/**
 * The plates for the two blue discs and for the coin plate -- see `ui-shapes.Plates`.
 *
 * THE COIN PLATE'S RIM IS DERIVED FROM ITS BASE and the discs' from `palette`, and the reason
 * is the same in both cases: a rim has to be darker than the plate it rims. `PILL_BG` is
 * near-white, so a fifth off IT is a pale grey that disappears against the plate; a fifth off
 * `PILL_BASE` is a grey-blue that reads as a line. `CONTROL_EDGE`'s own docblock works the same
 * argument through for the blue, where the trap is the opposite way round.
 */
export const CONTROL_PLATES: Plates = { face: CONTROL_FACE, base: CONTROL_BASE, edge: CONTROL_EDGE };
const COIN_PLATES: Plates = { face: PILL_BG, base: PILL_BASE, edge: shade(PILL_BASE, -0.2) };
/** The cogwheel inside its disc, as a fraction of it -- the HUD's gear wears the same ratio. */
const GEAR_GLYPH = 0.62;

/** Slack around a tap, in design units: the same padding every other hit test here uses. */
const TAP_PAD = 10;

/**
 * The unread-marker on the check-in disc: a small disc on its top-right corner.
 *
 * 34 against the disc's 115 -- about 0.30, the ratio this marker has held at every size the bar
 * has had (22-against-76 in the row, 28-against-96 before `COL_SCALE`) -- sitting on the corner
 * rather than inside it, the way the card's close button hangs off its own: a dot drawn inside
 * the disc would read as part of the icon.
 */
const DOT_D = Math.round(28 * COL_SCALE);
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
     *     left   = -w/2 + margin                                              = -601.6
     *     drop   = COL_LIFT + COL_STROKE                                       =   18
     *     gear   centre = (left + GEAR_D/2,    barBottom - GEAR_D/2)           = (-544.1, barBottom -  57.5)
     *     checkin centre= (left + CHECKIN_D/2, gearY - 57.5 - drop - 40 - 57.5)= (-544.1, barBottom - 230.5)
     *     coin   centre = (left + COIN_W/2,    checkinY - 57.5 - drop - 40 - 57.5) = (-457.6, barBottom - 403.5)
     *
     * THE COLUMN'S TOP IS STILL `barBottom` EVEN THOUGH EVERY CONTROL NOW HAS A RIM. The rim is
     * drawn around the BASE, which sits `COL_LIFT` low, so its top edge reaches `57.5 + 4 - 14`
     * = 47.5 from the gear's centre -- inside the face's own 57.5. Nothing pokes above the face,
     * and `gearY` did not have to move. Below is another matter: the column now hangs 18 units
     * further down per control, which is what `drop` is for.
     *
     * THE TOP OF THE COLUMN IS `barBottom` ITSELF -- the gear's own top edge, not its centre --
     * which is the same y the old row's BOTTOM edge sat at. That is deliberate, not a coincidence
     * of the arithmetic: the column runs down the left margin from that line, alongside the rail
     * rather than above it.
     *
     * HOW CLOSE THE COLUMN NOW COMES TO THE RAIL, and it is the number to watch on this screen.
     * The widest control is the coin plate, and its right edge is now
     * `-457.6 + COIN_W / 2 + COL_STROKE` = -309.6 -- the rim counts, it is drawn. The furthest
     * LEFT a badge ever draws is `ZIG_X` plus the widest thing a badge wears, the current badge's
     * bright highlight at its breathing scale (`70 * 1.26` = 88.2), so -210 - 88.2 = -298.2.
     *
     * THAT LEAVES 11.4 UNITS. They do not touch, and the arithmetic says they cannot, but the
     * margin has gone 63.4 -> 15.4 -> 11.4 over three changes that each looked local: the column
     * grew by a fifth, then it grew a rim. Anything that widens `COIN_W` or `COL_STROKE` again
     * has to RE-DERIVE this line rather than assume it still holds, and the badge half of it
     * comes from `home-view` -- it does not move when anything in this file does.
     *
     * Nothing here needed to move `railCenterY`, the cap or the ramp -- see their own files.
     */
    constructor(parent: Node, w: number, barBottom: number) {
        const margin = w * BAR_MARGIN_F;
        const left = -w / 2 + margin;

        this.root = new Node('TopBar');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        parent.addChild(this.root);
        this.root.setPosition(0, 0, 0);

        const gearY = barBottom - GEAR_D / 2;
        this.gear = this.buildGear(left + GEAR_D / 2, gearY);

        // `drop` is everything a control hangs BELOW its own face: the side it stands on and the
        // rim around that side. Without it the gap is measured between two faces while the eye
        // measures it between two drawn objects, and the two answers differ by 18 units.
        const drop = COL_LIFT + COL_STROKE;
        const checkinY = gearY - GEAR_D / 2 - drop - COL_GAP - CHECKIN_D / 2;
        this.checkin = this.buildCheckin(left + CHECKIN_D / 2, checkinY);

        const coinY = checkinY - CHECKIN_D / 2 - drop - COL_GAP - COIN_H / 2;
        const coins = this.buildCoins(left + COIN_W / 2, coinY);
        this.coin = coins.holder;
        this.coinLabel = coins.label;
    }

    /** The coin readout: the project's two-plate treatment, a coin at its left end, the count. */
    private buildCoins(x: number, y: number): { holder: Node; label: Label } {
        const { holder, face } = toonPill(
            'TopBarCoins', COIN_W, COIN_H, COIN_PLATES, COL_LIFT, COL_STROKE,
        );
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
        // `PILL_INK`, not a copy of it. This plate wears `PILL_BG` as its face, and the ink
        // that goes on that face travels with it -- see `ui-shapes`, where both live.
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
        const { holder, face } = toonDisc(
            'TopBarGear', GEAR_D, CONTROL_PLATES, COL_LIFT, COL_STROKE,
        );
        this.root.addChild(holder);
        holder.setPosition(x, y, 0);
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
