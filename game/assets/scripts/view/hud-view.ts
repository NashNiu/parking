import { Node, Label, Sprite, UITransform, Color, Layers, UIOpacity, Vec3, tween, Tween } from 'cc';
import { roundedSprite, dotSprite, starSprite, burstSprite } from './ui-shapes';
import { canvasSize, makeLabel, safeInsets } from './ui-layout';

/**
 * The passenger figure as a flat glyph, centred on `parent`: a head over a narrower body.
 *
 * The two pieces are positioned so the pair straddles the parent's centre -- the head above
 * it, the body below -- rather than stacking upward from it, so the glyph is optically
 * centred in whatever it sits in without the caller doing arithmetic.
 */
function paxGlyph(parent: Node): void {
    const total = PILL_FIG_HEAD + PILL_FIG_BODY_H - PILL_FIG_TUCK;
    const top = total / 2;
    const body = roundedSprite('paxBody', PILL_FIG_BODY_W, PILL_FIG_BODY_H, PILL_ICON);
    parent.addChild(body);
    body.setPosition(0, top - PILL_FIG_HEAD + PILL_FIG_TUCK - PILL_FIG_BODY_H / 2, 0);
    // After the body, so the head is the later sibling and draws over the tuck.
    const head = dotSprite('paxHead', PILL_FIG_HEAD, PILL_ICON);
    parent.addChild(head);
    head.setPosition(0, top - PILL_FIG_HEAD / 2, 0);
}

/**
 * A readout plate: a white face over a base of the same shape, offset down so it shows as a
 * lip. Returns both, because callers hang their contents off the FACE (so the contents move
 * with it) and position the HOLDER.
 */
function liftedPill(name: string, w: number, h: number): { holder: Node; face: Node } {
    const holder = new Node(name);
    holder.layer = Layers.Enum.UI_2D;
    holder.addComponent(UITransform).setContentSize(w, h);
    const base = roundedSprite('base', w, h, PILL_BASE);
    holder.addChild(base);
    base.setPosition(0, -PILL_LIFT, 0);
    const face = roundedSprite('face', w, h, PILL_BG);
    holder.addChild(face);
    return { holder, face };
}

/**
 * The remaining-passenger pill, sized off its own type so it stays in step with the HUD.
 *
 * 236 wide, up from 210: the count reaches FOUR digits now (a level runs 1200-1350 passengers,
 * see CARS_PER_LEVEL), and the old width was measured against a three-digit readout.
 */
const PILL_W = 240;
const PILL_H = 88;
/**
 * Both readouts are drawn as TWO plates -- a white face over a cool-grey base peeking out
 * below -- which is the same trick as the unlock button, the padlock rims on the board and the
 * win panel's stars. They were flat white stadiums, and flat is what "redesign these" was
 * about: on a HUD where the pressable things have a top face, the readouts having none made
 * them read as unfinished rather than as a different kind of object.
 *
 * The base is a TINT OF THE BOARD, not grey and not a darker white. The board behind is
 * blue-grey (see GROUND in scene-stage), so a neutral shadow under a white plate reads as
 * dirty; a shadow biased the same way as the surface it falls on reads as a shadow.
 */
const PILL_BASE = new Color(202, 211, 231, 255);
const PILL_LIFT = 6;
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
const TITLE_PILL_W = 216;
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
 * The win panel, which is the one piece of CELEBRATION on this HUD.
 *
 * It replaces two bare Labels floating over the board -- big outlined type plus three star
 * GLYPHS from the system font -- reported as needing "some cartoon and some depth". Neither
 * was reachable from where it was: type with a rim has no depth to give, and a star glyph is
 * a thin outline-weight shape at whatever proportions the device's font happens to draw it.
 *
 * So it is built out of the vocabulary the unlock prompt already established -- a scrim, a
 * card with a darker plate behind it, and a key drawn as two plates so it has a top face --
 * plus real star SHAPES (`starSprite`) each sitting on its own darker copy, which is the same
 * two-plate trick a third time. That is where the depth comes from: one light source, implied
 * by every element being offset the same way against a darker twin, on a HUD that otherwise
 * has none.
 *
 * The MIDDLE star is bigger and higher, and lands last. Three identical stars in a row read as
 * a progress bar; an arch with the emphasis in the middle reads as a prize.
 *
 * A LIGHTER scrim than the prompt's 178. The prompt has to swallow taps and be answered; this
 * one is a curtain call over a board the player has just emptied, and there is nothing left
 * behind it worth hiding. It also must NOT behave modally: the level advances on a tap
 * ANYWHERE (see `onTouchEnd`), so this panel deliberately has no hit test of its own and the
 * button is a drawing, not a target -- tapping it works only because tapping anything works.
 */
const WIN_W = 600;
const WIN_H = 420;
const WIN_R = 56;
const WIN_SCRIM = new Color(10, 14, 26, 110);
/**
 * The stars STRADDLE the card's top edge, which is the single thing that stops this reading as
 * a dialog box with stars in it. Their y is measured from the card's centre, so a side star at
 * 196 with the card 420 tall sits half in and half out; the middle one is bigger, higher, and
 * mostly outside.
 *
 * The pitch keeps eight units of daylight between a side star and the middle one at these
 * diameters -- worth checking by hand if any of the three change, because two stars whose
 * points cross look like a mistake rather than a cluster.
 */
const WIN_STAR_D = 120;
const WIN_STAR_MID_D = 156;
const WIN_STAR_PITCH = 146;
const WIN_STAR_Y = 196;
const WIN_STAR_MID_Y = 224;
/** How far each star's darker twin peeks out below it. */
const WIN_STAR_LIFT = 8;
const WIN_STAR = new Color(255, 201, 52, 255);
const WIN_STAR_BASE = new Color(206, 140, 18, 255);
const WIN_STAR_OFF = new Color(219, 224, 236, 255);
const WIN_STAR_OFF_BASE = new Color(183, 191, 209, 255);
/**
 * The sunburst behind the card: very large, very faint, and turning once every forty seconds.
 *
 * It is the one thing here that is purely decorative, and it earns its place by being the only
 * element that MOVES once the entrance is over -- a still panel over a board that has stopped
 * moving reads as a screenshot. Slow enough that it is not an animation you watch; fast enough
 * that the screen is alive.
 */
const WIN_BURST_D = 980;
const WIN_BURST = new Color(255, 255, 255, 30);
const WIN_BURST_TURN = 40;
const WIN_CAPTION = new Color(140, 150, 175, 255);

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

/**
 * Whether the speed button is shown at all. FALSE: it is hidden for now.
 *
 * It is a switch rather than a deletion because the button is wanted back later, and because
 * the thing that must not happen is a HALF-hidden button -- invisible but still answering
 * taps, so the carousel changes speed under a player who pressed empty screen. `hitsSpeed`
 * and the node's own visibility both read THIS constant, so the two cannot drift apart.
 *
 * The node is still built, just inactive. That keeps `speedNode` non-nullable and leaves
 * `placeSpeed` and `setSpeed` valid as written; making it optional instead would spread null
 * checks through the HUD and through `GameController`'s reframe path to hide one disc.
 *
 * With no way to press it, `GameController.speed` stays 1 for the whole session, so every
 * `/ this.speed` there divides by one and the boarding flights, the lane slides and the ring
 * rotation all run at their authored durations.
 */
const SPEED_BUTTON = false;
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
/**
 * Whether the in-game picker row is shown at all. FALSE: the home screen owns level choice
 * now (`HomeView`), and two ways to change level -- one of them sitting under the player's
 * thumb all game -- is one too many.
 *
 * A switch rather than a deletion for the reason PICK_LEVELS was written down: checking a
 * change on level 7 otherwise means playing six levels first, on a phone, once per build.
 * Flipping this back puts the row under the lot again.
 *
 * Visibility and `hitsLevel` read THIS constant, the same discipline as SPEED_BUTTON: a row
 * that is invisible but still answering taps would jump levels under a player who pressed
 * empty screen.
 */
const PICK_ROW = false;
const PICK_D = 64;
const PICK_PITCH = 88;
const PICK_BG = new Color(120, 132, 158, 120);
const PICK_ON = new Color(74, 144, 226, 235);
const PICK_INK = new Color(255, 255, 255, 220);

/**
 * The button that leaves a level for the home screen, top RIGHT.
 *
 * Right, against the usual convention of a back button top-left, because the left of that
 * row is taken: the title plate is centred and the passenger counter hangs off the left
 * margin one row below it, and a 76 disc on the title line reaches 16 units down into the
 * counter's plate. The right of that row is empty at every screen width.
 *
 * Words, not a glyph. A house or a chevron is one font substitution away from a hollow box
 * on a device whose system font lacks it, and every other string on this HUD is already
 * Chinese text that is known to render.
 */
const HOME_BTN_D = 76;
const HOME_BTN_BG = new Color(252, 253, 255, 235);
const HOME_BTN_INK = new Color(84, 96, 124, 255);

/** The seat-count chip that sits under a parked car's stall. */
const CHIP_W = 88;
const CHIP_H = 58;

/**
 * The tunnel count: a WHITE DISC floating over the vault's crown, dark navy digits on it.
 *
 * It was a bare navy number printed straight onto the roof, and it came back as 不清晰. Two
 * reasons, and only one of them is size. Navy on pale blue is a weak pair to begin with; then
 * the roof is the face most turned toward the key light (see BOARD_TILT: a tilted roof takes
 * 67% more light than a flat one), so the ground under the digits is the brightest and least
 * predictable surface on the board. The digits were being asked to hold contrast against a
 * highlight.
 *
 * A disc of its own settles both: the number now sits on paint this file controls, and lifting
 * it clear of the crown (see `tunnelCrown`) puts it above the roof rather than on it, so no
 * heading and no lighting can wash it out.
 *
 * It is the same object as the level chips along the bottom of the screen -- disc, dark ink,
 * one number -- which is deliberate. This HUD already taught the player what a round number
 * chip means; a count badge is that, not a new vocabulary.
 */
/*
 * The disc and the digit on it, both up: 52 -> 58 and 32 -> 40, asked for as "make the number
 * bigger".
 *
 * The digit can take it because of something that changed elsewhere. This readout is
 * `remainingIn`, the cars a tunnel still holds, and TUNNEL_CURVE's depth is now flat at 4 for
 * every level that has a tunnel at all -- so the string here is ONE character, always, and a
 * large glyph has nothing to overflow into. It was two characters' worth of room when tunnels
 * ran six deep, which is what kept 32 modest.
 *
 * The disc grows by less than the digit (12% against 25%) on purpose: what was asked for is a
 * bigger NUMBER, and letting the glyph take more of the disc is most of how that reads. At 40
 * in 58 a single digit keeps about 9px of white on each side, which is still a ring rather
 * than a rim.
 */
const TUNNEL_CHIP_D = 58;
const TUNNEL_CHIP_BG = new Color(253, 253, 255);
const TUNNEL_CHIP_SHADOW = new Color(20, 36, 68, 54);
const TUNNEL_CHIP_DROP = 3;
const TUNNEL_COUNT_INK = new Color(24, 44, 88);
const TUNNEL_COUNT_SIZE = 40;

const PILL_BG = new Color(252, 252, 255);
const PILL_INK = new Color(48, 60, 92);
const PILL_CAPTION = new Color(126, 134, 156);
/**
 * The passenger badge: a saturated disc at the pill's left end with a WHITE figure on it.
 *
 * It was three orange dots in a huddle on a pale well, and it came back as "the little
 * flower" -- which is exactly what three round blobs in a triangle are. The icon on a counter
 * has to name what is being counted, and three dots name nothing.
 *
 * So it is now the game's OWN passenger, drawn flat: a round head over a narrower rounded
 * body, the proportions this project already settled on for the figures on the track (see
 * HEAD_RADIUS in pax-figure.ts -- a big head on a small body is what makes that silhouette
 * read as a person at any size). Two sprites, no new shape needed.
 *
 * WHITE ON SATURATED, not saturated on pale. The old pairing was orange ink on a cream well,
 * a contrast ratio of about 1.4; white on this orange is nearer 2.6, and at the size an icon
 * on a HUD pill actually occupies, contrast is the only thing that survives.
 */
const PILL_ICON = new Color(255, 255, 255, 255);
const PILL_BADGE = new Color(255, 146, 58, 255);
const PILL_BADGE_D = 68;
/**
 * The flat figure inside the badge: head diameter, then the body's width and height, then how
 * far the body TUCKS UNDER the head.
 *
 * The overlap is not a nicety. The body is a stadium, so its top is a semicircle; butted
 * against the head it leaves a visible pinch where the two curves meet, which reads as a neck
 * on a figure that has no neck. Four units of overlap puts the join inside the head.
 */
const PILL_FIG_HEAD = 21;
const PILL_FIG_BODY_W = 17;
const PILL_FIG_BODY_H = 24;
const PILL_FIG_TUCK = 4;

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
    /** The win panel's scrim and the three star nodes on it, built on first win. */
    private win: Node | null = null;
    private winStars: Node[] = [];
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
    /**
     * The two readout plates, by their HOLDERS rather than their labels: `setPlayVisible`
     * takes the whole plate down, and the label is two nodes inside it.
     */
    private titlePill: Node;
    private paxPill: Node;
    /** Leaves the level for the home screen. See HOME_BTN_D and `hitsHome`. */
    private homeBtn: Node;
    /** Whether a level is on screen. `syncHomeBtn` is the only reader. */
    private play = false;
    /** Per-tunnel count readouts, keyed by tunnel id. See `setTunnelCount`. */
    private tunnelBadges = new Map<number, { holder: Node; label: Label }>();
    private speedNode: Node;
    private speedLabel: Label;
    /** The level on screen, kept because the win panel's caption names it. See `setLevel`. */
    private levelId = 1;

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
        const title = this.buildTitlePill(canvas, 0, line);
        this.levelLabel = title.label;
        this.titlePill = title.holder;
        // Dropped half its own height plus a margin -- clear of the status bar it used to
        // share, and no further. A FULL row lower was tried on paper and rejected: see
        // TITLE_PILL_W for the arithmetic, but the short version is that the ring's top
        // rows start 8.3% of the screen height down and a full row puts this plate's
        // bottom edge past that.
        const pax = this.buildPassengerPill(
            canvas, w, margin, line - PILL_H / 2 - margin,
        );
        this.progressLabel = pax.label;
        this.paxPill = pax.holder;
        this.homeBtn = this.buildHomeButton(canvas, w / 2 - margin - HOME_BTN_D / 2, line);
        // A fallback spot only. `placeSpeed` moves it onto the carousel's corner as soon as
        // the board is framed, which happens in the same frame the board is built -- but a
        // HUD with no board behind it (a failed level load) should still put it somewhere
        // sane rather than at the canvas origin, under everything.
        const speed = this.buildSpeedButton(canvas, -w / 2 + margin + SPEED_D / 2);
        this.speedNode = speed.node;
        this.speedLabel = speed.label;
        this.speedNode.active = SPEED_BUTTON;
        this.buildLevelPicker(
            canvas,
            -h / 2 + safeInsets().bottom * h + margin + 22 + PICK_D / 2 + 10,
        );
        for (const chip of this.pickNodes) chip.active = PICK_ROW;
        this.bannerLabel = makeLabel(canvas, 'Banner', 72, 0);
        this.bannerLabel.color = TITLE_INK;
        this.bannerLabel.isBold = true;
        this.bannerLabel.enableOutline = true;
        this.bannerLabel.outlineColor = new Color(255, 255, 255, 235);
        this.bannerLabel.outlineWidth = 5;
        this.bannerLabel.node.active = false;
        // Nothing here belongs to a level yet: the game opens on the home screen, and the
        // preload before it can take up to PRELOAD_DEADLINE seconds. Built hidden rather
        // than shown and then hidden, so there is no frame of empty readouts over nothing.
        this.setPlayVisible(false);
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
     * The level title on its own lifted plate, centred at the top (see TITLE_PILL_W for what
     * makes the centre safe). 46px against the counter's 54 -- it is the quieter of the two,
     * because the number is the one that changes.
     */
    private buildTitlePill(
        canvas: Node, x: number, line: number,
    ): { holder: Node; label: Label } {
        const { holder, face } = liftedPill('TitlePill', TITLE_PILL_W, TITLE_PILL_H);
        canvas.addChild(holder);
        holder.setPosition(x, line, 0);
        const label = makeLabel(face, 'LevelLabel', 46, 0);
        label.color = TITLE_INK;
        label.isBold = true;
        return { holder, label };
    }

    /** See HOME_BTN_D for where this sits and why it says what it says. */
    private buildHomeButton(canvas: Node, x: number, y: number): Node {
        const holder = new Node('HomeBtn');
        holder.layer = Layers.Enum.UI_2D;
        holder.addComponent(UITransform).setContentSize(HOME_BTN_D, HOME_BTN_D);
        canvas.addChild(holder);
        holder.setPosition(x, y, 0);
        const base = dotSprite('base', HOME_BTN_D, PILL_BASE);
        holder.addChild(base);
        base.setPosition(0, -PILL_LIFT, 0);
        const face = dotSprite('face', HOME_BTN_D, HOME_BTN_BG);
        holder.addChild(face);
        const label = makeLabel(face, 'HomeBtnLabel', 30, 0);
        label.color = HOME_BTN_INK;
        label.isBold = true;
        label.string = '主页';
        return holder;
    }

    /**
     * The remaining-passenger readout: a lifted plate on the left, one row under the title,
     * with the passenger badge at its left end and the caption over the count beside it.
     *
     * The two lines are read as ONE unit -- the caption is the label for the number under it --
     * so they share an x, and that x is the middle of what the badge leaves rather than a
     * nudged offset. At four digits and 48px bold the count is about 110 wide, which leaves it
     * eleven units clear of the badge on one side and of the plate's edge on the other.
     *
     * 48 and 24, down from 54 and 22, and the pair moved TOGETHER for one reason: at 54 the
     * count's line box (1.2x the font) reached up through the caption's. Shrinking the number
     * a little and growing the caption a little buys both of them room and makes the caption
     * legible, which at 22 it was not -- it is the smallest type on the screen and it was
     * carrying the only words that say what the number means.
     */
    private buildPassengerPill(
        canvas: Node, w: number, margin: number, y: number,
    ): { holder: Node; label: Label } {
        const { holder, face } = liftedPill('PaxPill', PILL_W, PILL_H);
        canvas.addChild(holder);
        holder.setPosition(-w / 2 + margin + PILL_W / 2, y, 0);

        const badge = dotSprite('paxBadge', PILL_BADGE_D, PILL_BADGE);
        face.addChild(badge);
        badge.setPosition(-PILL_W / 2 + PILL_BADGE_D / 2 + 12, 0, 0);
        paxGlyph(badge);

        const badgeRight = -PILL_W / 2 + 12 + PILL_BADGE_D;
        const textX = (badgeRight + PILL_W / 2) / 2;
        const caption = makeLabel(face, 'PaxCaption', 24, 23, textX);
        caption.string = '剩余乘客';
        caption.color = PILL_CAPTION;
        const count = makeLabel(face, 'PaxCount', 48, -19, textX);
        count.color = PILL_INK;
        count.isBold = true;
        return { holder, label: count };
    }

    /**
     * Show or hide everything that belongs to a level in play: the two readout plates, the
     * home button, the speed disc and the picker row, plus whichever end-of-level panel was
     * up. `GameController` calls this with false when it leaves for the home screen and true
     * when it enters a level.
     *
     * The two SWITCHED parts stay switched off either way -- `on && SPEED_BUTTON`, and the
     * picker's own `PICK_ROW` -- so turning play back on cannot resurrect a control that is
     * deliberately hidden. That is the whole reason this reads the constants rather than a
     * remembered "what was visible before".
     *
     * Per-level nodes are NOT in here. Seat chips and tunnel badges are created as a level
     * runs and destroyed when it is torn down (`clearTunnelBadges`, and the controller's own
     * chip destroy), so hiding them would leave two owners of the same lifetime.
     */
    setPlayVisible(on: boolean): void {
        this.play = on;
        this.titlePill.active = on;
        this.paxPill.active = on;
        this.speedNode.active = on && SPEED_BUTTON;
        for (const chip of this.pickNodes) chip.active = on && PICK_ROW;
        if (!on) {
            this.bannerLabel.node.active = false;
            if (this.win) this.win.active = false;
            if (this.prompt) this.prompt.active = false;
            if (this.toast) this.toast.active = false;
        }
        this.syncHomeBtn();
    }

    /**
     * The home button is live only when a level is up AND no modal is over it.
     *
     * Both panels raise their scrim to the front of the canvas, so the button is UNDER them
     * -- and a hit test does not care about draw order, so leaving it active would make the
     * top-right corner of a modal quietly leave the level. That is the same defect as a
     * hidden button that still answers taps, arrived at from the other direction, so the
     * answer is the same one: one predicate drives both the visibility and the hit test
     * (`hitsHome` reads `active`), and every place that raises or drops a panel calls this.
     *
     * The lose BANNER is not a panel: it is a bare label with no scrim, so the button stays
     * live behind it. That is deliberate -- a lost level is one a player particularly wants
     * to leave, and until now the only way out was to replay it.
     */
    private syncHomeBtn(): void {
        const modal = !!(this.win?.active) || !!(this.prompt?.active);
        this.homeBtn.active = this.play && !modal;
    }

    /** Whether `ui` landed on the home button. Dead while the home screen is up. */
    hitsHome(ui: Vec3): boolean {
        if (!this.homeBtn.active) return false;
        const p = this.homeBtn.worldPosition;
        const r = HOME_BTN_D / 2 + 10;
        const dx = ui.x - p.x;
        const dy = ui.y - p.y;
        return dx * dx + dy * dy <= r * r;
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
     * The count on a tunnel: how many cars it still holds, the one at the mouth included.
     *
     * The DIGIT lives in the HUD; the tile it sits on is board geometry (`tunnel-mesh.ts`).
     * Placed each frame at the tunnel's projected point -- the same route `placeSpeed` and the
     * seat chips take. A Label on a 3D node would need a second rendering path for the one
     * piece of text outside the Canvas; this needs none, and faces the camera for free. What it
     * gives up is being occluded by anything in the scene, which for a readout that must always
     * be legible is not a loss.
     */
    setTunnelCount(tunnelId: number, n: number): void {
        let badge = this.tunnelBadges.get(tunnelId);
        if (!badge) {
            const holder = new Node(`tunnel-${tunnelId}`);
            holder.layer = Layers.Enum.UI_2D;
            holder.addComponent(UITransform).setContentSize(TUNNEL_CHIP_D, TUNNEL_CHIP_D);
            this.canvas.addChild(holder);
            // Shadow first, then face, then digits: children draw in the order they are added,
            // and the shadow is what keeps a white disc from dissolving into the pale roof it
            // floats over -- the one surface on the board close to its own colour.
            const shadow = dotSprite('chipShadow', TUNNEL_CHIP_D, TUNNEL_CHIP_SHADOW);
            shadow.setPosition(0, -TUNNEL_CHIP_DROP, 0);
            holder.addChild(shadow);
            holder.addChild(dotSprite('chipFace', TUNNEL_CHIP_D, TUNNEL_CHIP_BG));
            const label = makeLabel(holder, 'count', TUNNEL_COUNT_SIZE, 0);
            label.color = TUNNEL_COUNT_INK.clone();
            label.isBold = true;
            // Centred in the line box, not sitting at the top of it. `makeLabel` gives every
            // label a lineHeight of 1.2x its font size, and Cocos defaults a Label's vertical
            // align to TOP -- so a single line is pinned to the top of a box a fifth taller
            // than the glyph, and rides that much high inside the disc. It is a couple of
            // pixels at the old 32 and four at 40, which is what "as centred as you can get
            // it" was about. Set here and not in `makeLabel`, because every other caller is
            // laying text out against a box it sized itself and reads correctly as it is.
            label.verticalAlign = Label.VerticalAlign.CENTER;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            badge = { holder, label };
            this.tunnelBadges.set(tunnelId, badge);
        }
        badge.label.string = String(n);
        badge.holder.active = n > 0;
    }

    /**
     * Put a tunnel's badge at a point already converted into UI space.
     *
     * `setWorldPosition`, NOT `setPosition`, and that is the whole of a bug that made every
     * badge invisible: the point comes from `uiCam.screenToWorld`, so it is a WORLD position,
     * while the holder is a child of the canvas and `setPosition` would read it as a LOCAL
     * one. The canvas node does not sit at the UI world origin, so the badge landed about
     * half a screen away and never appeared. `placeSpeed` above and the seat chips in
     * `GameController.positionChip` both take the same route and both use `setWorldPosition`;
     * this is the same idiom, not a new one.
     */
    placeTunnelBadge(tunnelId: number, ui: Vec3): void {
        this.tunnelBadges.get(tunnelId)?.holder.setWorldPosition(ui);
    }

    /**
     * Drop every tunnel badge. The badges live under this HUD's own Canvas, not under the
     * board -- `buildBoard`'s `boardRoot.destroy()` never touches them, so a level with no
     * tunnel at id 3 that follows one that HAD a tunnel 3 would otherwise leave that badge
     * sitting on screen forever, `active` and showing a stale count, since nothing would ever
     * call `setTunnelCount(3, ...)` again to hide it.
     *
     * Destroys the holders rather than just deactivating them, the same way `switchTo`
     * retires a departed car's seat chip (`e.chip.destroy()`) rather than hiding it -- one
     * discipline for both of this HUD's per-id collections, not two.
     */
    clearTunnelBadges(): void {
        for (const badge of this.tunnelBadges.values()) badge.holder.destroy();
        this.tunnelBadges.clear();
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
        this.syncHomeBtn();
        // By name, for the reason `showWin` now does: this happens to be children[0] today,
        // and would quietly become whatever decoration is added in front of it tomorrow.
        // Here the failure would be milder than showWin's -- the panel still shows, because
        // `active` is set above this, and only the entrance bounce would land on the wrong
        // node -- which is exactly why it would go unnoticed.
        const panel = scrim.getChildByName('UnlockPanel')!;
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
        this.syncHomeBtn();
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
        // Hidden means unpressable -- see PICK_ROW.
        if (!PICK_ROW) return -1;
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
        // Hidden means unpressable. Same constant the node's visibility reads, so a hidden
        // button can never still be swallowing taps -- see SPEED_BUTTON.
        if (!SPEED_BUTTON) return false;
        const p = this.speedNode.worldPosition;
        const r = SPEED_D / 2 + SPEED_PAD;
        const dx = ui.x - p.x;
        const dy = ui.y - p.y;
        return dx * dx + dy * dy <= r * r;
    }

    setLevel(id: number): void {
        this.levelId = id;
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
     * Moves the banner to the end of the canvas's child list, so it renders on top of every
     * seat chip. `newSeatChip` appends chips at runtime as cars park, which makes each one a
     * later — and therefore higher-rendering — sibling of the banner, which is constructed
     * early. Raising it at show time (once the game is over, no further chip can appear)
     * undoes that ordering. `showWin` does the same for the win panel's scrim.
     */
    private raiseBannerToFront(): void {
        this.bannerLabel.node.setSiblingIndex(this.canvas.children.length - 1);
    }

    showBanner(text: string): void {
        this.bannerLabel.string = text;
        this.bannerLabel.node.active = true;
        this.raiseBannerToFront();
    }

    /**
     * The win panel, built once and kept. See WIN_W for what it is made of and why.
     *
     * The star ORDER on screen is left, middle, right; the order in `winStars` is the order
     * they are ANIMATED in -- left, right, middle -- so `showWin` can just stagger by index.
     * Filling left-to-right up to `starCount` reads off the x positions, not the array, so
     * the two are kept separate rather than one being inferred from the other.
     */
    private buildWinPanel(): void {
        const { w, h } = canvasSize(this.canvas);
        const scrim = roundedSprite('WinScrim', w * 2, h * 2, WIN_SCRIM, 2);
        scrim.addComponent(UIOpacity);
        this.canvas.addChild(scrim);

        // Outside the panel node, so the entrance scale does not scale the glow with it.
        const burst = burstSprite('WinBurst', WIN_BURST_D, WIN_BURST);
        scrim.addChild(burst);
        tween(burst).by(WIN_BURST_TURN, { angle: 360 }).repeatForever().start();

        const panel = new Node('WinPanel');
        panel.layer = Layers.Enum.UI_2D;
        panel.addComponent(UITransform);
        scrim.addChild(panel);

        const shadow = roundedSprite('shadow', WIN_W, WIN_H, PROMPT_SHADOW, WIN_R);
        panel.addChild(shadow);
        shadow.setPosition(0, -PROMPT_SHADOW_DROP, 0);
        const plate = roundedSprite('plate', WIN_W, WIN_H, PROMPT_BG, WIN_R);
        panel.addChild(plate);

        // Left, right, middle -- see the note above.
        const slots: { x: number; y: number; d: number }[] = [
            { x: -WIN_STAR_PITCH, y: WIN_STAR_Y, d: WIN_STAR_D },
            { x: WIN_STAR_PITCH, y: WIN_STAR_Y, d: WIN_STAR_D },
            { x: 0, y: WIN_STAR_MID_Y, d: WIN_STAR_MID_D },
        ];
        for (let i = 0; i < slots.length; i++) {
            const { x, y, d } = slots[i];
            const holder = new Node(`WinStar${i}`);
            holder.layer = Layers.Enum.UI_2D;
            holder.addComponent(UITransform);
            plate.addChild(holder);
            holder.setPosition(x, y, 0);
            const base = starSprite('base', d, WIN_STAR_BASE);
            holder.addChild(base);
            base.setPosition(0, -WIN_STAR_LIFT, 0);
            holder.addChild(starSprite('face', d, WIN_STAR));
            this.winStars.push(holder);
        }

        // 84, not 92, and the caption a row lower: at 92 the title's line box (1.2x the font)
        // reached from 9 up to 119 against the stars' bottom edge at 136 and DOWN through the
        // caption's box. The three of them now clear each other by 13 to 24 units.
        const title = makeLabel(plate, 'WinTitle', 84, 72);
        title.color = TITLE_INK;
        title.isBold = true;
        const caption = makeLabel(plate, 'WinCaption', 30, -14);
        caption.color = WIN_CAPTION;

        const cta = new Node('WinCta');
        cta.layer = Layers.Enum.UI_2D;
        cta.addComponent(UITransform).setContentSize(PROMPT_BTN_W, PROMPT_BTN_H);
        plate.addChild(cta);
        cta.setPosition(0, -112, 0);
        const ctaBase = roundedSprite(
            'base', PROMPT_BTN_W, PROMPT_BTN_H, PROMPT_BTN_BASE, PROMPT_BTN_R,
        );
        cta.addChild(ctaBase);
        ctaBase.setPosition(0, -PROMPT_BTN_LIFT, 0);
        const face = roundedSprite('face', PROMPT_BTN_W, PROMPT_BTN_H, PROMPT_BTN, PROMPT_BTN_R);
        cta.addChild(face);
        const ctaLabel = makeLabel(face, 'WinCtaLabel', 44, 0);
        ctaLabel.isBold = true;

        scrim.active = false;
        this.win = scrim;
    }

    /**
     * Victory panel: three stars filled left-to-right up to `starCount`, over a card that
     * scales in, with the stars popping and spinning into place behind it. `hasNext` switches
     * the call to action between advancing and replaying, matching what the next tap will
     * actually do.
     *
     * Every tween is stopped before it is restarted and every property it will touch is set
     * explicitly first: this panel can be shown again without the scene being rebuilt (win,
     * replay, win), and a half-finished pop from last time would otherwise leave a star at
     * whatever scale it had got to.
     */
    showWin(starCount: number, hasNext: boolean = false): void {
        if (!this.win) this.buildWinPanel();
        const scrim = this.win!;
        // BY NAME, not by index. This read `scrim.children[0]`, which was the panel when it
        // was written and became the decorative burst the moment one was added in front of
        // it -- see the guard in logic/tests/view-source.test.ts for what that cost.
        const panel = scrim.getChildByName('WinPanel')!;
        const plate = panel.getChildByName('plate')!;
        plate.getChildByName('WinTitle')!.getComponent(Label)!.string =
            hasNext ? '过关!' : '全部通关!';
        // The caption is the only place the level's own number appears once the board is
        // cleared, and it is what stops the panel being three words on a card.
        plate.getChildByName('WinCaption')!.getComponent(Label)!.string =
            hasNext ? `第 ${this.levelId} 关完成` : '十关全部完成';
        plate.getChildByName('WinCta')!.getChildByName('face')!
            .getChildByName('WinCtaLabel')!.getComponent(Label)!.string =
            hasNext ? '点击进入下一关' : '点击重玩';

        scrim.active = true;
        // Past every seat chip: chips are appended as cars park, so they are later siblings
        // than anything built in the constructor. Same reason as the banner and the prompt.
        scrim.setSiblingIndex(this.canvas.children.length - 1);
        this.syncHomeBtn();
        const fade = scrim.getComponent(UIOpacity)!;
        Tween.stopAllByTarget(fade);
        fade.opacity = 0;
        tween(fade).to(0.14, { opacity: 255 }).start();

        Tween.stopAllByTarget(panel);
        panel.setScale(0.82, 0.82, 1);
        tween(panel)
            .to(0.16, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'backOut' })
            .to(0.09, { scale: Vec3.ONE })
            .start();

        for (let i = 0; i < this.winStars.length; i++) {
            const star = this.winStars[i];
            // Slot order is left, right, middle (see `buildWinPanel`), and the fill is by
            // POSITION: the middle star is the third of three, the right one the second.
            const rank = i === 2 ? 1 : (i === 0 ? 0 : 2);
            const on = rank < starCount;
            star.getChildByName('face')!.getComponent(Sprite)!.color =
                on ? WIN_STAR : WIN_STAR_OFF;
            star.getChildByName('base')!.getComponent(Sprite)!.color =
                on ? WIN_STAR_BASE : WIN_STAR_OFF_BASE;
            Tween.stopAllByTarget(star);
            star.setScale(0.01, 0.01, 1);
            star.angle = -50;
            tween(star)
                .delay(0.16 + i * 0.11)
                .to(0.2, { scale: new Vec3(1.22, 1.22, 1), angle: 0 }, { easing: 'backOut' })
                .to(0.1, { scale: Vec3.ONE })
                .start();
        }

        // The button breathes, and that is the only reason it reads as the thing to do next --
        // it cannot be a hit target (a tap anywhere advances), so movement is all it has.
        const cta = plate.getChildByName('WinCta')!;
        Tween.stopAllByTarget(cta);
        cta.setScale(Vec3.ONE);
        tween(cta)
            .delay(0.5)
            .to(0.7, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'sineInOut' })
            .to(0.7, { scale: Vec3.ONE }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    /** Failure panel: deadlock message; the stuck-car highlight itself is driven by the caller. */
    showLose(): void {
        this.bannerLabel.string = '游戏失败\n点击重试';
        this.bannerLabel.node.active = true;
        this.raiseBannerToFront();
    }

    /** Takes down whichever end-of-level panel was shown. Safe before either has been built. */
    hideBanner(): void {
        this.bannerLabel.node.active = false;
        if (this.win) this.win.active = false;
        this.syncHomeBtn();
    }
}
