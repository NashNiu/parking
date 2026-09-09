import { Node, Label, Sprite, UITransform, Color, Layers, UIOpacity, Vec3, tween, Tween } from 'cc';
import {
    roundedSprite, dotSprite, starSprite, burstSprite, gearSprite, speakerSprite, buzzSprite,
} from './ui-shapes';
import { canvasSize, makeLabel, rimLabel, safeInsets } from './ui-layout';
import { STAR_MAX } from '../core/index';

/**
 * What the win card reports. Assembled by the caller, because every one of these is a fact
 * about the level and the run that the HUD has no way to know -- `stars` especially, which
 * is core's verdict (`GameCore.stars`) and not a number this file should be deriving.
 */
export interface WinStats {
    /** The level just cleared, 1-based. Also how many of the bar's cells light up. */
    level: number;
    /** How many levels the game holds, which is how many cells the bar has. */
    levelCount: number;
    /** Passengers delivered. On a win this is the level's whole queue, every one boarded. */
    passengers: number;
    /** Stalls the player opened. What the missing stars were spent on. */
    unlocks: number;
    /** The rating, 1 to STAR_MAX. */
    stars: number;
}

/**
 * A switch: its row and its two moving parts. The knob is a child of the track, so it
 * travels with it.
 *
 * `row` is the WHOLE row as one node -- icon, label and track inside it, sized to the page --
 * and it exists so the hit test can be `inBox(row)` like every button here. The arithmetic it
 * replaces measured out from the track and reached 150 units past the card, so a tap on the
 * dim scrim beside the panel toggled the sound.
 */
interface SwitchParts {
    row: Node;
    /** The holder that travels: the white ring and the coloured face are inside it. */
    knob: Node;
    /** The knob's coloured face, which is the sprite `paintSwitch` tints. */
    face: Node;
}

/**
 * What opening a stall costs, for the prompt that offers it. Assembled by the caller for the
 * same reason WinStats is: both numbers are core's (`ParkingSystem.locked`, `GameCore.stars`).
 */
export interface UnlockCost {
    /** Stalls still shut, this one included. */
    left: number;
    /** Whether opening one would actually cost a star, or the rating has already bottomed. */
    losesStar: boolean;
}

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
 * THE CARD: the shape both of this HUD's dialogs are cut from -- a thick coloured rim, a
 * cream page inside it, and the title on the RIM rather than on the page.
 *
 * It replaced a white rounded rectangle with dark grey type in it, reported as 太丑了 beside
 * a screenshot of the game this borrows from. That game's panels are not better because they
 * carry more detail; they are better because a panel there is drawn as an OBJECT -- something
 * with an edge, a face and a lit top -- where ours was drawn as a region of the screen with
 * text on it. Three things carry that, and all three are cheap:
 *
 *   the rim      a border wide enough to be a frame rather than a stroke, in a saturated
 *                colour, with a darker copy under it so the frame has a bottom edge
 *   the page     a warm off-white inside the rim, so the panel has an inside and an outside
 *   rimmed type  white glyphs with a coloured outline (`rimLabel`), which is the one trick
 *                that makes a label read as part of a toy and not as text laid over one
 *
 * CARD_HEAD is how much rim shows ABOVE the page, and it is where the title goes. CARD_RIM is
 * how much shows down the sides and along the bottom. Everything a panel puts inside itself
 * is positioned in PAGE coordinates, so a card's own layout arithmetic never mentions the rim
 * again.
 */
const CARD_R = 56;
const CARD_RIM = 24;
const CARD_HEAD = 116;
/** How far the rim's darker copy peeks out below it: the frame's bottom edge. */
const CARD_LIFT = 12;
const CARD_PAGE_R = 36;
const CARD_TITLE_SIZE = 54;
const CARD_RIM_FACE = new Color(64, 172, 236, 255);
const CARD_RIM_BASE = new Color(28, 112, 176, 255);
const CARD_PAGE = new Color(253, 246, 232, 255);
/**
 * Ink on the cream page, and the quieter ink under it.
 *
 * Browns rather than the greys this HUD uses on white, because a cool grey on a warm ground
 * reads as dirty. Measured against CARD_PAGE these are 8.8:1 and 4.9:1, so even the
 * secondary line clears 4.5:1 at the 26px it is set in -- the grey it replaces managed 2.6
 * on this ground, which is a cost line nobody can read.
 */
const CARD_INK = new Color(86, 66, 44, 255);
const CARD_SUB = new Color(128, 104, 78, 255);
/**
 * The close button, centred ON the page's top-right corner rather than tucked inside it: a
 * disc that overlaps the frame belongs to the whole card, and one inside the page competes
 * with the page's own contents for that corner.
 *
 * A white ring around it, then the same face-over-base pair as every other pressable thing
 * here. The ring is what separates a blue disc from the blue rim it half sits on.
 */
const CARD_X_D = 84;
const CARD_X_RING = 7;
const CARD_X_LIFT = 5;
/** The rim colour for white type on a green button -- the frame's blue would fight the green. */
const CARD_BTN_RIM = new Color(48, 132, 40, 255);

/**
 * The primary action: a green key drawn as two plates, the darker one peeking out below the
 * lighter, which is what makes a flat rectangle read as something with a top face to press.
 * The same trick as the padlock's rim on the board, and as the card's own rim.
 *
 * Declared here rather than with the win card it is also used by, because the settings
 * panel derives SET_BTN_Y from this height and a const initialiser cannot reach forward.
 */
const PROMPT_BTN_W = 400;
const PROMPT_BTN_H = 112;
const PROMPT_BTN_R = 38;
const PROMPT_BTN = new Color(86, 199, 104, 255);
const PROMPT_BTN_BASE = new Color(56, 156, 76, 255);
const PROMPT_BTN_LIFT = 8;

/**
 * The "open a stall or lose" prompt: the one MODAL thing on this HUD.
 *
 * Everything else here either reports (the pills, the toast) or can be ignored (the speed
 * button). This asks a question the level cannot go on without an answer to -- the bay is
 * full, nothing on it can board, and opening a stall is the only move left -- so it takes
 * the screen, dims the board behind it, and swallows every tap that is not one of its three
 * answers. See `hitsUnlockPrompt` for what each of those means.
 *
 * A dark scrim rather than a light one: the board underneath is pale and the card is pale.
 * The card is 620 of a 720-wide canvas, which is as wide as it can be and still leave the
 * close button room to overhang into.
 */
const PROMPT_W = 620;
/**
 * 520: CARD_HEAD 116 + a 380-tall page + CARD_RIM 24. The title is no longer part of this
 * stack -- it sits on the rim -- so the page holds four things where it held five.
 *
 * Laid out in PAGE coordinates, the page spanning y -190..190, each line's box being 1.2x
 * its font size (`makeLabel`):
 *
 *   sub    y  132 +/- 18  ->  114..150   (40 off the page's top edge)
 *   button y   22 +/- 56  ->  -34..78    (36 clear of the sub)
 *   cost   y  -68 +/- 16  ->  -84..-52   (18 clear of the button)
 *   replay y -138 +/- 18  -> -156..-120  (36 clear of the cost, 34 off the bottom)
 *
 * The close button's disc spans y 148..232 of the page and x 202..286, so the only line it
 * shares a band with is the sub -- whose twelve glyphs at 30 reach x 180 and clear it by 22.
 */
const PROMPT_H = 520;
/** Where each line sits, in page coordinates. The arithmetic is under PROMPT_H. */
const PROMPT_SUB_Y = 132;
const PROMPT_BTN_Y = 22;
const PROMPT_COST_Y = -68;
const PROMPT_REPLAY_Y = -138;

/**
 * The settings panel: the same card, with its three answers BELOW it rather than on it.
 *
 * Outside the card because they are answers about the LEVEL rather than about the panel --
 * the reference art does the same, and it is also what lets the middle button be as wide as
 * it is. The panel node is raised by SET_RAISE so that the card and the button row TOGETHER
 * centre on the screen; without it the composition hangs low by half a button.
 *
 *   card    y  291 .. 71     (SET_H 440: CARD_HEAD 116 + a 300-tall page + CARD_RIM 24)
 *   buttons y -179 .. -291   (SET_BTN_GAP_Y 30 below the card)
 */
const SET_W = 620;
const SET_H = 440;
const SET_PAGE_W = SET_W - CARD_RIM * 2;
const SET_PAGE_H = SET_H - CARD_HEAD - CARD_RIM;
/**
 * The two switch rows, in page coordinates: 92 tall each, 144 apart, on a 300-tall page.
 *
 * That leaves 32 clear above the first and below the second and 52 between them. The two
 * rows are the only things on this page, and rows crammed against a frame read as a list
 * that has been cut off.
 */
const SET_ROW_H = 92;
const SET_ROW1_Y = 72;
const SET_ROW2_Y = -72;
/** Icon, then label, then track, measured in from the page's own edges. */
const SET_ICON_D = 62;
const SET_ICON_X = -SET_PAGE_W / 2 + 56;
const SET_LABEL_SIZE = 40;
const SET_LABEL_X = SET_ICON_X + SET_ICON_D / 2 + 22;
const SET_SW_W = 150;
const SET_SW_H = 68;
const SET_SW_X = SET_PAGE_W / 2 - 56 - SET_SW_W / 2;
/**
 * The knob: a rounded square, not a circle, with a white ring around it.
 *
 * RED for off against green for on, which is the one thing here taken straight from the
 * reference art. Position alone is ambiguous on a control this small and colour alone fails
 * for a player who cannot tell green from grey -- but red against green at opposite ENDS of
 * the track is two independent signals, and a red knob also reads as "switched off" to
 * somebody who has never seen the control before.
 */
const SET_SW_KNOB = 64;
const SET_SW_KNOB_R = 22;
const SET_SW_RING = 5;
const SET_SW_TRACK = new Color(228, 214, 190, 255);
const SET_SW_ON = new Color(112, 200, 60, 255);
const SET_SW_OFF = new Color(230, 82, 78, 255);
/**
 * The answers under the card. The middle one is the wide green one -- see `buildSettings`.
 *
 * They take the CTA's own height and radius (PROMPT_BTN_H, PROMPT_BTN_R) rather than sizes of
 * their own: they are the same control as the prompt's 解锁车位 button, and two button heights
 * four units apart is a difference nobody can see and everybody has to maintain.
 */
const SET_WIDE_W = 300;
const SET_SIDE_W = 128;
const SET_BTN_GAP = 20;
const SET_BTN_GAP_Y = 30;
const SET_BTN_Y = -(SET_H / 2 + SET_BTN_GAP_Y + PROMPT_BTN_H / 2);
const SET_RAISE = (SET_BTN_GAP_Y + PROMPT_BTN_H) / 2;
/**
 * The cost line, smaller than the sub and directly under the button it applies to.
 *
 * It is the line this redesign is really for. Opening a stall was free, unlimited as far as
 * anything on screen said, and the only alternative offered was an X that lost the level --
 * so the "choice" was between a free rescue and suicide, and nobody reads a prompt like that
 * twice. With the star rating metering unlocks and this line naming both what is left and
 * what it costs, it becomes a decision.
 */
const PROMPT_COST_SIZE = 26;
/**
 * The win card's plate and its drop shadow. The two dialogs that used to share this white
 * plate are cards now (see CARD_R) and bring their own; the win card is next in line for the
 * same treatment and is deliberately untouched here -- it is a panel the player has already
 * seen and accepted, and restyling it belongs in its own change.
 */
const PROMPT_BG = new Color(252, 253, 255, 255);
const PROMPT_SHADOW = new Color(8, 12, 24, 90);
const PROMPT_SHADOW_DROP = 10;
const SCRIM = new Color(10, 14, 26, 178);
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
/**
 * 600, up from 420. The card carries five things now where it carried three: the stars, the
 * headline, the series progress bar, two lines of tally, and two answers. The stack below is
 * laid out from the stars DOWN, and every gap in it is written next to the constant that
 * makes it, because the last time this card was crowded the title's line box grew into the
 * caption's and nothing on screen said which number was wrong.
 *
 * Arithmetic, top to bottom, with the plate spanning y -300..300 and each line's box being
 * 1.2x its font size (Cocos' default `lineHeight`, set that way in `makeLabel`):
 *
 *   side stars   y 286 +/- 60   ->  226..346   (76 of the card's top edge, deliberately out)
 *   middle star  y 314 +/- 78   ->  236..392
 *   title        y 150 +/- 43   ->  107..193   (33 clear of the side stars' underside)
 *   caption      y  76 +/- 17   ->   59..93    (14 clear of the title)
 *   bar          y  28 +/- 6    ->   22..34    (25 clear of the caption)
 *   rule         y  -8          ->    -9..-7   (31 clear of the bar)
 *   tally line 1 y -44 +/- 16   ->  -60..-28   (19 clear of the rule)
 *   tally line 2 y -84 +/- 16   -> -100..-68   (8 clear of line 1: one block, two lines)
 *   button       y -166 +/- 56  -> -222..-110  (10 clear of the tally)
 *   replay       y -256 +/- 18  -> -274..-238  (16 clear of the button, 26 off the bottom)
 */
const WIN_H = 600;
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
const WIN_STAR_Y = 286;
const WIN_STAR_MID_Y = 314;
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
 * How far the win card's close button is pulled in from its corner.
 *
 * It has to come further in than a dialog's normally would, because on this card the corner
 * is not empty: the right-hand star's box reaches x 206, and a 76 button at a 62 inset would
 * span 200..276 -- straight through it. At 44 it spans 218..294, which clears the star by 12
 * and still leaves 6 units of plate outside it. The two overlap in y whatever happens (star
 * 226..346 against button 218..294), so x is the only separation there is.
 */
const WIN_CLOSE_INSET = 44;

/** Where each line of the stack sits. The arithmetic that spaces them is under WIN_H. */
const WIN_TITLE_Y = 150;
const WIN_CAPTION_Y = 76;
const WIN_BAR_Y = 28;
const WIN_RULE_Y = -8;
const WIN_TALLY_Y = -44;
const WIN_TALLY_PITCH = 40;
const WIN_CTA_Y = -166;
const WIN_REPLAY_Y = -256;

/**
 * The series progress bar: one cell per level, the cleared one lit.
 *
 * It replaces the words the caption used to spend on the same fact ("第 N 关 · 共 M 关"), and
 * says something they could not: how much of the game is behind you. The cell count comes
 * from the caller, so a level series of any length draws its own bar -- at which point the
 * PITCH is what has to give, not the count, which is why the width below is derived rather
 * than written down.
 */
const WIN_BAR_H = 12;
const WIN_BAR_GAP = 8;
/** The widest the bar may get. Inside the card's 600 with its 48 of side padding to spare. */
const WIN_BAR_MAX_W = 504;
const WIN_BAR_ON = new Color(86, 199, 104, 255);
const WIN_BAR_OFF = new Color(222, 227, 238, 255);

/** The tally lines: what the level cost, in the same ink as the caption but smaller. */
const WIN_TALLY_SIZE = 27;

/**
 * A card's quiet second answer, as TEXT rather than a second slab. Both cards use it: the
 * win card's replay, and the blocked-stall prompt's.
 *
 * Two buttons of equal weight is a question the player did not ask -- nearly everyone wants
 * the obvious one -- so the other answer is text under the main button: reachable, plainly
 * tappable, and clearly the quieter of the two.
 *
 * The hit box is much bigger than the ink, because a text button sized to its own glyphs is
 * a text button nobody can hit.
 */
const TEXT_BTN_SIZE = 30;
const TEXT_BTN_INK = new Color(122, 133, 160, 255);
const TEXT_BTN_W = 240;
const TEXT_BTN_H = 72;

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
 * The button that opens the settings panel, top LEFT, on the counter's row.
 *
 * IT WAS TOP RIGHT AND THAT WAS WRONG. WeChat draws its own capsule -- the ... and the
 * dot -- pinned to the top right of every mini-game, and it is not ours to move or to
 * overlap. A 76 disc in that corner sits underneath it: unreadable, and half of it
 * unpressable. Reported from a device, and the fix is to leave that corner to WeChat.
 *
 * On the counter's row rather than the title's, because a disc on the title line reaches 16
 * units down into the counter's plate -- which is what sent it right in the first place.
 * Sharing the counter's row instead is what the reference art does, and there is room: the
 * counter simply starts to the right of it.
 *
 * It opens a PANEL rather than going straight home, because "leave this level" is not the
 * only thing a player wants from that corner, and a bare exit invites a mis-tap that throws
 * a level away.
 *
 * A DRAWN cogwheel, not the word 设置 and not a font glyph. It said 设置 first, over an
 * argument that was sound as far as it went -- a gear from the system font is one
 * substitution away from a hollow box on a device whose font lacks it -- but that argument is
 * about fonts, and `gearSprite` paints the shape here, the way the stars and the padlock are
 * already painted here. Nothing is looked up, so nothing can be missing. Two characters at 30
 * inside a 76 disc were also the smallest type on the HUD, in the corner most likely to be
 * read at a glance.
 *
 * In the card's blue, with the same face-over-base pair: it is the only control on the board
 * that opens a dialog, and it now looks like the dialog it opens.
 */
const GEAR_D = 76;
/** Between the gear and the counter beside it. */
const PILL_GAP = 12;
/** The cogwheel inside the disc, as a fraction of it. */
const GEAR_GLYPH = 0.62;

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
    /** One cell per level. See `buildWinBar`. */
    private winBar: Node[] = [];
    /** The two lines of tally under the rule, in order. See `showWin`. */
    private winTally: Label[] = [];
    /** The card's three answers, kept for `hitsWin`. Null until the panel is built. */
    private winCta: Node | null = null;
    private winReplay: Node | null = null;
    private winClose: Node | null = null;
    /** The toast pill and its parts, built on first use. See `showToast`. */
    private toast: Node | null = null;
    private toastFade: UIOpacity | null = null;
    private toastTitle: Label | null = null;
    private buildTag: Label | null = null;
    /** The unlock prompt's scrim and its three hit targets. */
    private prompt: Node | null = null;
    private promptBtn: Node | null = null;
    private promptClose: Node | null = null;
    private promptReplay: Node | null = null;
    /** The only line on the prompt that changes. See `showUnlockPrompt`. */
    private promptCost: Label | null = null;
    /** The settings panel's scrim and its five hit targets, built on first use. */
    private settings: Node | null = null;
    private setClose: Node | null = null;
    private setResume: Node | null = null;
    private setHome: Node | null = null;
    private setReplay: Node | null = null;
    private sfxSwitch: SwitchParts | null = null;
    private hapticSwitch: SwitchParts | null = null;
    private pickNodes: Node[] = [];
    /**
     * The two readout plates, by their HOLDERS rather than their labels: `setPlayVisible`
     * takes the whole plate down, and the label is two nodes inside it.
     */
    private titlePill: Node;
    private paxPill: Node;
    /** Opens the settings panel. See GEAR_D and `hitsGear`. */
    private gearBtn: Node;
    /** Whether a level is on screen. `syncGear` is the only reader. */
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
        // The counter's row also carries the gear, so the pill starts to the right of it.
        const secondRow = line - PILL_H / 2 - margin;
        this.gearBtn = this.buildGear(canvas, -w / 2 + margin + GEAR_D / 2, secondRow);
        const pax = this.buildPassengerPill(
            canvas, w, margin + GEAR_D + PILL_GAP, secondRow,
        );
        this.progressLabel = pax.label;
        this.paxPill = pax.holder;
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

    /** See GEAR_D for where this sits and why it is a drawn cogwheel. */
    private buildGear(canvas: Node, x: number, y: number): Node {
        const holder = new Node('GearBtn');
        holder.layer = Layers.Enum.UI_2D;
        holder.addComponent(UITransform).setContentSize(GEAR_D, GEAR_D);
        canvas.addChild(holder);
        holder.setPosition(x, y, 0);
        const base = dotSprite('base', GEAR_D, CARD_RIM_BASE);
        holder.addChild(base);
        base.setPosition(0, -PILL_LIFT, 0);
        const face = dotSprite('face', GEAR_D, CARD_RIM_FACE);
        holder.addChild(face);
        face.addChild(gearSprite('glyph', GEAR_D * GEAR_GLYPH, Color.WHITE));
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
    /**
     * `left` is the inset from the screen's left edge to the pill's left edge -- the margin
     * PLUS whatever shares its row, which is now the gear.
     */
    private buildPassengerPill(
        canvas: Node, w: number, left: number, y: number,
    ): { holder: Node; label: Label } {
        const { holder, face } = liftedPill('PaxPill', PILL_W, PILL_H);
        canvas.addChild(holder);
        holder.setPosition(-w / 2 + left + PILL_W / 2, y, 0);

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
            if (this.settings) this.settings.active = false;
            if (this.toast) this.toast.active = false;
        }
        this.syncGear();
    }

    /**
     * The home button is live only when a level is up AND no modal is over it.
     *
     * Both panels raise their scrim to the front of the canvas, so the button is UNDER them
     * -- and a hit test does not care about draw order, so leaving it active would make the
     * top-right corner of a modal quietly leave the level. That is the same defect as a
     * hidden button that still answers taps, arrived at from the other direction, so the
     * answer is the same one: one predicate drives both the visibility and the hit test
     * (`hitsGear` reads `active`), and every place that raises or drops a panel calls this.
     *
     * The lose BANNER is not a panel: it is a bare label with no scrim, so the button stays
     * live behind it. That is deliberate -- a lost level is one a player particularly wants
     * to leave, and until now the only way out was to replay it.
     */
    private syncGear(): void {
        const modal = !!(this.win?.active) || !!(this.prompt?.active)
            || !!(this.settings?.active);
        this.gearBtn.active = this.play && !modal;
    }

    /** Whether `ui` landed on the home button. Dead while the home screen is up. */
    hitsGear(ui: Vec3): boolean {
        if (!this.gearBtn.active) return false;
        const p = this.gearBtn.worldPosition;
        const r = GEAR_D / 2 + 10;
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
     * Raise the "nothing can board" prompt. Idempotent -- the controller asks on every tick
     * the condition holds, not only on the edge.
     *
     * `cost` is read only when the prompt is actually raised, which is safe because the state
     * behind it is frozen: the bay is full, nothing on it can board, so no stall opens or
     * frees itself while this is up. The only things that change these numbers are the
     * player's own answers, and all three of them take the prompt down first.
     */
    showUnlockPrompt(cost: UnlockCost): void {
        if (!this.prompt) this.buildUnlockPrompt();
        const scrim = this.prompt!;
        if (scrim.active) return;
        scrim.active = true;
        // To the front, past every seat chip: chips are appended as cars park, so they are
        // later siblings than anything built in the constructor. Same reason as the banner.
        scrim.setSiblingIndex(this.canvas.children.length - 1);
        this.syncGear();
        // Both halves of the price, because either one alone reads as a smaller decision than
        // it is: how many are left, and what this one takes off the rating. At one star the
        // rating has bottomed out and there is nothing left to lose, so saying so is more
        // honest than repeating a threat that no longer applies.
        this.promptCost!.string = cost.losesStar
            ? `还能开 ${cost.left} 个 · 少一颗星`
            : `还能开 ${cost.left} 个 · 星级已到底`;
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
        this.syncGear();
    }

    /** Whether the prompt is up, i.e. whether it owns the next tap. */
    promptOpen(): boolean {
        return !!this.prompt && this.prompt.active;
    }

    /**
     * Which of the prompt's three answers `ui` landed on, or null for the panel and the
     * scrim -- a tap that hits neither button is SWALLOWED, not passed through, because the
     * board behind it has no move left in it and tapping around would just look broken.
     *
     * The close button means 'home' here, and it did NOT before: it used to end the level in
     * a loss, on a position that still had a legal move in it. An X is the one control on a
     * phone whose meaning is not up for grabs -- it dismisses -- and wiring the harshest
     * outcome in the game to it made the prompt a trap, on a state the player reaches in 59
     * of 80 runs. Leaving for the menu is what dismissing this actually means, now that
     * there is a menu to leave for.
     */
    hitsUnlockPrompt(ui: Vec3): 'unlock' | 'replay' | 'home' | null {
        if (!this.promptOpen()) return null;
        const c = this.promptClose!.worldPosition;
        const r = CARD_X_D / 2 + 12;
        if ((ui.x - c.x) ** 2 + (ui.y - c.y) ** 2 <= r * r) return 'home';
        const b = this.promptBtn!.worldPosition;
        if (Math.abs(ui.x - b.x) <= PROMPT_BTN_W / 2 + 8
            && Math.abs(ui.y - b.y) <= PROMPT_BTN_H / 2 + 8) return 'unlock';
        const p = this.promptReplay!.worldPosition;
        if (Math.abs(ui.x - p.x) <= TEXT_BTN_W / 2
            && Math.abs(ui.y - p.y) <= TEXT_BTN_H / 2) return 'replay';
        return null;
    }

    /**
     * The card every dialog here is built on: rim, page, title, close button. See CARD_R for
     * what it looks like and why.
     *
     * Returns the three things a caller needs and nothing else -- the node to animate, the
     * page to hang content on, and the close button to hit-test. The rim, its darker copy, the
     * drop shadow and the title are inside it and no caller touches them again.
     *
     * The card is NOT the modal: the caller owns the scrim, because a scrim's size and colour
     * are decisions about the screen behind it rather than about the card.
     */
    private buildCard(
        parent: Node, name: string, w: number, h: number, title: string,
    ): { card: Node; page: Node; close: Node } {
        const card = new Node(name);
        card.layer = Layers.Enum.UI_2D;
        card.addComponent(UITransform).setContentSize(w, h);
        parent.addChild(card);

        // Shadow, then the rim's darker copy, then its face: three plates offset down by
        // different amounts is the whole of the depth here.
        const shadow = roundedSprite('shadow', w, h, PROMPT_SHADOW, CARD_R);
        card.addChild(shadow);
        shadow.setPosition(0, -CARD_LIFT - PROMPT_SHADOW_DROP, 0);
        const rimBase = roundedSprite('rimBase', w, h, CARD_RIM_BASE, CARD_R);
        card.addChild(rimBase);
        rimBase.setPosition(0, -CARD_LIFT, 0);
        const rim = roundedSprite('rim', w, h, CARD_RIM_FACE, CARD_R);
        card.addChild(rim);

        const pageH = h - CARD_HEAD - CARD_RIM;
        const pageW = w - CARD_RIM * 2;
        const page = roundedSprite('page', pageW, pageH, CARD_PAGE, CARD_PAGE_R);
        card.addChild(page);
        page.setPosition(0, h / 2 - CARD_HEAD - pageH / 2, 0);

        // On the rim, centred in the band the page leaves above itself.
        const label = makeLabel(rim, 'title', CARD_TITLE_SIZE, h / 2 - CARD_HEAD / 2);
        rimLabel(label, CARD_RIM_BASE, 5);
        label.string = title;

        // A child of the PAGE, so its corner is the page's corner whatever the card's size.
        const close = new Node('close');
        close.layer = Layers.Enum.UI_2D;
        close.addComponent(UITransform).setContentSize(CARD_X_D, CARD_X_D);
        page.addChild(close);
        close.setPosition(pageW / 2, pageH / 2, 0);
        close.addChild(dotSprite('ring', CARD_X_D + CARD_X_RING * 2, Color.WHITE));
        const xBase = dotSprite('base', CARD_X_D, CARD_RIM_BASE);
        close.addChild(xBase);
        xBase.setPosition(0, -CARD_X_LIFT, 0);
        const xFace = dotSprite('face', CARD_X_D, CARD_RIM_FACE);
        close.addChild(xFace);
        const x = makeLabel(xFace, 'x', 52, 2);
        x.isBold = true;
        x.string = '×';

        return { card, page, close };
    }

    /**
     * One chunky button: a coloured face over a darker copy of itself, with rimmed white type
     * on it. The same two-plate trick as the card's rim, the stars and the padlock.
     *
     * The node returned is the HIT BOX -- `setContentSize` is what `inBox` measures -- and the
     * plates are drawn inside it, so a button's target is its face and not a guess at it.
     */
    private buildCardBtn(parent: Node, spec: {
        x: number; y: number; w: number; text: string;
        face: Color; base: Color; rim: Color; size: number;
    }): Node {
        const btn = new Node(`btn-${spec.text}`);
        btn.layer = Layers.Enum.UI_2D;
        btn.addComponent(UITransform).setContentSize(spec.w, PROMPT_BTN_H);
        parent.addChild(btn);
        btn.setPosition(spec.x, spec.y, 0);
        const under = roundedSprite(
            'base', spec.w, PROMPT_BTN_H, spec.base, PROMPT_BTN_R,
        );
        btn.addChild(under);
        under.setPosition(0, -PROMPT_BTN_LIFT, 0);
        const top = roundedSprite('face', spec.w, PROMPT_BTN_H, spec.face, PROMPT_BTN_R);
        btn.addChild(top);
        const label = makeLabel(top, 'l', spec.size, 0);
        rimLabel(label, spec.rim, Math.round(spec.size / 10));
        label.string = spec.text;
        return btn;
    }

    private buildUnlockPrompt(): void {
        const { w, h } = canvasSize(this.canvas);
        // The scrim IS the modal: it covers the canvas, so nothing behind it can be seen to
        // be tappable. Sized well past the canvas so a wider viewport cannot show a strip of
        // live board down either side.
        const scrim = roundedSprite('UnlockScrim', w * 2, h * 2, SCRIM, 2);
        this.canvas.addChild(scrim);
        scrim.setPosition(0, 0, 0);

        // The card is named UnlockPanel because `showUnlockPrompt` finds it by that name to
        // bounce it, and the bounce should scale the card and its shadow together.
        //
        // The title NAMES THE STATE, and it is on the card's rim. "车位堵住了" was wrong twice
        // over: the stalls are not blocked, they are full, and a player who reads it goes
        // looking for something to unblock. What has actually happened is that no car on the
        // bay can take a passenger any more, and the sub line says what to do about it.
        const { page, close } = this.buildCard(
            scrim, 'UnlockPanel', PROMPT_W, PROMPT_H, '没有车能上客了',
        );

        const sub = makeLabel(page, 'PromptSub', 30, PROMPT_SUB_Y);
        sub.color = CARD_INK;
        sub.string = '开一个车位，让新的车进来';

        const btn = this.buildCardBtn(page, {
            x: 0, y: PROMPT_BTN_Y, w: PROMPT_BTN_W, text: '解锁车位',
            face: PROMPT_BTN, base: PROMPT_BTN_BASE, rim: CARD_BTN_RIM, size: 48,
        });

        // Under the button, not on it: it is the price of pressing that button, and a price
        // printed inside a button competes with the button's own word. See PROMPT_COST_SIZE.
        this.promptCost = makeLabel(page, 'PromptCost', PROMPT_COST_SIZE, PROMPT_COST_Y);
        this.promptCost.color = CARD_SUB;

        // See TEXT_BTN_SIZE. The same control the win card wears, and the same reason: this
        // is the answer for a player who would rather start the level over than pay, and it
        // must be reachable without being as loud as the offer.
        const replay = new Node('PromptReplay');
        replay.layer = Layers.Enum.UI_2D;
        replay.addComponent(UITransform).setContentSize(TEXT_BTN_W, TEXT_BTN_H);
        page.addChild(replay);
        replay.setPosition(0, PROMPT_REPLAY_Y, 0);
        const replayLabel = makeLabel(replay, 'PromptReplayLabel', TEXT_BTN_SIZE, 0);
        replayLabel.color = CARD_SUB;
        replayLabel.string = '重玩本关';

        scrim.active = false;
        this.prompt = scrim;
        this.promptBtn = btn;
        this.promptClose = close;
        this.promptReplay = replay;
    }

    /**
     * The settings panel: two switches and the three things a player wants from a level they
     * are in the middle of.
     *
     * IT REPLACED A BARE HOME BUTTON, and the reason is worth keeping: that button sat under
     * WeChat's capsule (see GEAR_D), and a single exit in a corner is also a mis-tap that
     * throws a level away. A panel asks, and it has room for the switches the corner had
     * nowhere to put.
     *
     * Laid out from the top edge down, plate spanning y -240..240, each line's box being 1.2x
     * its font size (`makeLabel`):
     *
     *   title  y  176 +/- 29   ->  147..205   (35 off the top edge)
     *   rule   y  126          ->  125..127   (20 clear of the title)
     *   sound  y   76 +/- 28   ->   48..104   (21 clear of the rule, switch height)
     *   buzz   y   -4 +/- 28   ->  -32..24    (16 clear of the row above: one block)
     *   rule   y  -62          ->  -63..-61   (29 clear)
     *   answers y -140 +/- 48  -> -188..-92   (29 clear, 52 off the bottom)
     *
     * NO MUSIC ROW: nothing in this project plays a track, and a switch that toggles nothing
     * is worse than no switch.
     */
    private buildSettings(): void {
        const { w, h } = canvasSize(this.canvas);
        const scrim = roundedSprite('SetScrim', w * 2, h * 2, SCRIM, 2);
        this.canvas.addChild(scrim);
        scrim.setPosition(0, 0, 0);

        // The card and the answer row under ONE node, raised by SET_RAISE so the pair of them
        // centres on the screen. `showSettings` finds this node by name to bounce it, and the
        // bounce should take the buttons with it.
        const panel = new Node('SetPanel');
        panel.layer = Layers.Enum.UI_2D;
        panel.addComponent(UITransform);
        scrim.addChild(panel);
        panel.setPosition(0, SET_RAISE, 0);

        const { page, close } = this.buildCard(panel, 'SetCard', SET_W, SET_H, '设置');
        this.setClose = close;

        this.sfxSwitch = this.buildSwitch(page, 'Sfx', '音效', SET_ROW1_Y, speakerSprite);
        this.hapticSwitch = this.buildSwitch(page, 'Buzz', '震动', SET_ROW2_Y, buzzSprite);

        // Three answers in one row, the middle one wide and green: carrying on is what nearly
        // every visit to this panel ends in, so it is the one that looks like a button.
        this.setResume = this.buildCardBtn(panel, {
            x: 0, y: SET_BTN_Y, w: SET_WIDE_W, text: '继续游戏',
            face: PROMPT_BTN, base: PROMPT_BTN_BASE, rim: CARD_BTN_RIM, size: 44,
        });
        const side = SET_WIDE_W / 2 + SET_BTN_GAP + SET_SIDE_W / 2;
        this.setHome = this.buildCardBtn(panel, {
            x: -side, y: SET_BTN_Y, w: SET_SIDE_W, text: '主页',
            face: CARD_RIM_FACE, base: CARD_RIM_BASE, rim: CARD_RIM_BASE, size: 36,
        });
        this.setReplay = this.buildCardBtn(panel, {
            x: side, y: SET_BTN_Y, w: SET_SIDE_W, text: '重玩',
            face: CARD_RIM_FACE, base: CARD_RIM_BASE, rim: CARD_RIM_BASE, size: 36,
        });

        scrim.active = false;
        this.settings = scrim;
    }

    /**
     * One switch row: an icon, a label, and a track with a knob on it.
     *
     * The label used to render the word "label" -- the engine's placeholder for a Label whose
     * string was never set, which is what shipped and what got photographed. `makeLabel` now
     * blanks it, so the only way to get that word on screen again is to type it.
     *
     * `icon` is passed in rather than chosen from `text`, so this function has no table of
     * strings to keep in step with `ui-shapes`; the caller names both.
     */
    private buildSwitch(
        page: Node, name: string, text: string, y: number,
        icon: (name: string, d: number, color: Color) => Node,
    ): SwitchParts {
        const row = new Node(`Row${name}`);
        row.layer = Layers.Enum.UI_2D;
        row.addComponent(UITransform).setContentSize(SET_PAGE_W, SET_ROW_H);
        page.addChild(row);
        row.setPosition(0, y, 0);

        const glyph = icon('icon', SET_ICON_D, CARD_RIM_FACE);
        row.addChild(glyph);
        glyph.setPosition(SET_ICON_X, 0, 0);

        const label = makeLabel(row, 'label', SET_LABEL_SIZE, 0, SET_LABEL_X);
        rimLabel(label, CARD_RIM_BASE, 4);
        label.string = text;
        // Anchored at its LEFT edge, so SET_LABEL_X is where the text starts rather than
        // where its middle happens to land. Both rows say two characters today and centring
        // them would look identical -- and would quietly misalign the moment one of them
        // says three.
        label.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);

        const track = roundedSprite('track', SET_SW_W, SET_SW_H, SET_SW_TRACK, SET_SW_H / 2);
        row.addChild(track);
        track.setPosition(SET_SW_X, 0, 0);

        // The knob is a holder with the white ring behind its coloured face, so `paintSwitch`
        // moves one node and tints one sprite. With the ring the knob is 74 across against a
        // 68 track, so it overhangs by 3 top and bottom, on purpose: a knob that stands proud
        // of its track reads as a thing ON the track rather than a hole cut in it.
        const knob = new Node('knob');
        knob.layer = Layers.Enum.UI_2D;
        knob.addComponent(UITransform);
        track.addChild(knob);
        const ringD = SET_SW_KNOB + SET_SW_RING * 2;
        knob.addChild(roundedSprite(
            'ring', ringD, ringD, Color.WHITE, SET_SW_KNOB_R + SET_SW_RING,
        ));
        const face = roundedSprite(
            'face', SET_SW_KNOB, SET_SW_KNOB, SET_SW_ON, SET_SW_KNOB_R,
        );
        knob.addChild(face);

        return { row, knob, face };
    }

    /**
     * Raise the settings panel. `sfx` and `haptics` are the caller's current values -- the
     * panel draws them and reports taps; it does not remember them, because the thing that
     * has to be right is what the game is actually doing, not what a panel thinks.
     */
    showSettings(sfx: boolean, haptics: boolean): void {
        if (!this.settings) this.buildSettings();
        const scrim = this.settings!;
        this.paintSwitches(sfx, haptics);
        if (scrim.active) return;
        scrim.active = true;
        scrim.setSiblingIndex(this.canvas.children.length - 1);
        this.syncGear();
        const panel = scrim.getChildByName('SetPanel')!;
        Tween.stopAllByTarget(panel);
        panel.setScale(0.86, 0.86, 1);
        tween(panel)
            .to(0.14, { scale: new Vec3(1.03, 1.03, 1) }, { easing: 'backOut' })
            .to(0.08, { scale: Vec3.ONE })
            .start();
    }

    /** Repaint both switches. Called on every raise and on every toggle. */
    paintSwitches(sfx: boolean, haptics: boolean): void {
        if (!this.settings) return;
        this.paintSwitch(this.sfxSwitch!, sfx);
        this.paintSwitch(this.hapticSwitch!, haptics);
    }

    private paintSwitch(sw: SwitchParts, on: boolean): void {
        sw.face.getComponent(Sprite)!.color = on ? SET_SW_ON : SET_SW_OFF;
        // The ring is the knob's real width, so it is the ring that has to stay inside the
        // track's ends -- see SET_SW_KNOB.
        const travel = (SET_SW_W - SET_SW_KNOB - SET_SW_RING * 2) / 2;
        sw.knob.setPosition(on ? travel : -travel, 0, 0);
    }

    hideSettings(): void {
        if (this.settings) this.settings.active = false;
        this.syncGear();
    }

    /** Whether the panel is up, i.e. whether it owns the next tap. */
    settingsOpen(): boolean {
        return !!this.settings && this.settings.active;
    }

    /**
     * What `ui` chose on the settings panel, or null for the card and the scrim -- a tap
     * that hits nothing is SWALLOWED rather than closing the panel, because the board behind
     * it is mid-level and a stray tap there would move a car.
     */
    hitsSettings(ui: Vec3): 'close' | 'home' | 'replay' | 'sfx' | 'haptics' | null {
        if (!this.settingsOpen()) return null;
        const c = this.setClose!.worldPosition;
        const r = CARD_X_D / 2 + 12;
        if ((ui.x - c.x) ** 2 + (ui.y - c.y) ** 2 <= r * r) return 'close';
        if (this.inBox(ui, this.setResume!, SET_WIDE_W, PROMPT_BTN_H)) return 'close';
        if (this.inBox(ui, this.setHome!, SET_SIDE_W, PROMPT_BTN_H)) return 'home';
        if (this.inBox(ui, this.setReplay!, SET_SIDE_W, PROMPT_BTN_H)) return 'replay';
        // The whole ROW is the switch's target, icon and label included: a 150-wide track is
        // a small thing to ask of a thumb when the row it sits in is 572 wide and holds
        // nothing else. The row is a node with that size on it, so this is the same `inBox`
        // every button here uses -- the arithmetic it replaces measured out from the track
        // and reached past the card, so a tap on the scrim beside the panel toggled the sound.
        if (this.inBox(ui, this.sfxSwitch!.row, SET_PAGE_W, SET_ROW_H)) return 'sfx';
        if (this.inBox(ui, this.hapticSwitch!.row, SET_PAGE_W, SET_ROW_H)) return 'haptics';
        return null;
    }

    private inBox(ui: Vec3, node: Node, wid: number, hgt: number): boolean {
        const p = node.worldPosition;
        return Math.abs(ui.x - p.x) <= wid / 2 + 8 && Math.abs(ui.y - p.y) <= hgt / 2 + 8;
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
     * The win panel, built once and kept. See WIN_W for the palette and WIN_H for the
     * arithmetic that spaces the stack.
     *
     * The star ORDER on screen is left, middle, right; the order in `winStars` is the order
     * they are ANIMATED in -- left, right, middle -- so `showWin` can just stagger by index.
     * Filling left-to-right up to the rating reads off the x positions, not the array, so the
     * two are kept separate rather than one being inferred from the other.
     *
     * `levelCount` sizes the progress bar, which is why this takes an argument at all and why
     * it is built on the first win rather than in the constructor: the HUD is constructed
     * before anything has counted the levels.
     */
    private buildWinPanel(levelCount: number): void {
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

        const title = makeLabel(plate, 'WinTitle', 72, WIN_TITLE_Y);
        title.color = TITLE_INK;
        title.isBold = true;
        const caption = makeLabel(plate, 'WinCaption', 28, WIN_CAPTION_Y);
        caption.color = WIN_CAPTION;

        this.buildWinBar(plate, levelCount);

        // The same hairline the unlock prompt uses, and for the same reason: it splits the
        // card into what happened (above) and what to do next (below), so the six things on
        // it read as two groups rather than six stacked things.
        const rule = roundedSprite('rule', WIN_W - 96, 2, PROMPT_X_BG, 1);
        plate.addChild(rule);
        rule.setPosition(0, WIN_RULE_Y, 0);

        for (let i = 0; i < 2; i++) {
            const line = makeLabel(
                plate, `WinTally${i}`, WIN_TALLY_SIZE, WIN_TALLY_Y - i * WIN_TALLY_PITCH,
            );
            line.color = WIN_CAPTION;
            this.winTally.push(line);
        }

        const cta = new Node('WinCta');
        cta.layer = Layers.Enum.UI_2D;
        cta.addComponent(UITransform).setContentSize(PROMPT_BTN_W, PROMPT_BTN_H);
        plate.addChild(cta);
        cta.setPosition(0, WIN_CTA_Y, 0);
        const ctaBase = roundedSprite(
            'base', PROMPT_BTN_W, PROMPT_BTN_H, PROMPT_BTN_BASE, PROMPT_BTN_R,
        );
        cta.addChild(ctaBase);
        ctaBase.setPosition(0, -PROMPT_BTN_LIFT, 0);
        const face = roundedSprite('face', PROMPT_BTN_W, PROMPT_BTN_H, PROMPT_BTN, PROMPT_BTN_R);
        cta.addChild(face);
        const ctaLabel = makeLabel(face, 'WinCtaLabel', 44, 0);
        ctaLabel.isBold = true;
        this.winCta = cta;

        // See TEXT_BTN_SIZE: a node with a hit box, holding a label.
        const replay = new Node('WinReplay');
        replay.layer = Layers.Enum.UI_2D;
        replay.addComponent(UITransform).setContentSize(TEXT_BTN_W, TEXT_BTN_H);
        plate.addChild(replay);
        replay.setPosition(0, WIN_REPLAY_Y, 0);
        const replayLabel = makeLabel(replay, 'WinReplayLabel', TEXT_BTN_SIZE, 0);
        replayLabel.color = TEXT_BTN_INK;
        replayLabel.string = '重玩本关';
        this.winReplay = replay;

        // Inside the corner, and pulled further in than the prompt's (44 against 62) to clear
        // the right-hand star, whose disc reaches x 206 against this one's left edge at 218.
        const close = dotSprite('WinClose', PROMPT_X_D, PROMPT_X_BG);
        plate.addChild(close);
        close.setPosition(WIN_W / 2 - WIN_CLOSE_INSET, WIN_H / 2 - WIN_CLOSE_INSET, 0);
        const x = makeLabel(close, 'WinCloseLabel', 46, 2);
        x.color = PROMPT_X_INK;
        x.isBold = true;
        x.string = '×';
        this.winClose = close;

        scrim.active = false;
        this.win = scrim;
    }

    /**
     * One cell per level, the pitch derived from how many there are rather than fixed, so the
     * bar keeps to WIN_BAR_MAX_W however long the series gets. The gap tightens past twenty
     * levels and the cells have a floor of 3 units: at 99 the bar is hairlines, which still
     * reads as a progress meter, and the alternative -- wrapping onto a second row -- is a
     * layout for a game that does not exist.
     */
    private buildWinBar(plate: Node, levelCount: number): void {
        const n = Math.max(1, levelCount);
        const gap = n <= 20 ? WIN_BAR_GAP : 2;
        const cellW = Math.max(3, Math.floor((WIN_BAR_MAX_W - gap * (n - 1)) / n));
        const total = n * cellW + (n - 1) * gap;
        for (let i = 0; i < n; i++) {
            const cell = roundedSprite(`WinBar${i}`, cellW, WIN_BAR_H, WIN_BAR_OFF, WIN_BAR_H / 2);
            plate.addChild(cell);
            cell.setPosition(-total / 2 + cellW / 2 + i * (cellW + gap), WIN_BAR_Y, 0);
            this.winBar.push(cell);
        }
    }

    /**
     * Victory panel: the rating in stars over a card that scales in, what the level cost
     * underneath it, and two answers.
     *
     * `hasNext` switches the headline and the call to action between advancing and replaying
     * the series, matching what the next tap will actually do.
     *
     * Every tween is stopped before it is restarted and every property it will touch is set
     * explicitly first: this panel can be shown again without the scene being rebuilt (win,
     * replay, win), and a half-finished pop from last time would otherwise leave a star at
     * whatever scale it had got to.
     */
    showWin(stats: WinStats, hasNext: boolean = false): void {
        if (!this.win) this.buildWinPanel(stats.levelCount);
        const scrim = this.win!;
        // BY NAME, not by index. This read `scrim.children[0]`, which was the panel when it
        // was written and became the decorative burst the moment one was added in front of
        // it -- see the guard in logic/tests/view-source.test.ts for what that cost.
        const panel = scrim.getChildByName('WinPanel')!;
        const plate = panel.getChildByName('plate')!;
        plate.getChildByName('WinTitle')!.getComponent(Label)!.string =
            hasNext ? '过关!' : '全部通关!';
        plate.getChildByName('WinCaption')!.getComponent(Label)!.string =
            hasNext ? `第 ${stats.level} 关完成` : `${stats.levelCount} 关全部完成`;
        this.winCta!.getChildByName('face')!
            .getChildByName('WinCtaLabel')!.getComponent(Label)!.string =
            hasNext ? '下一关' : '再玩一次';

        // Lit up to and including the level just cleared. The bar is the series, not this
        // level, which is the one thing on the card that says how far in the player is.
        for (let i = 0; i < this.winBar.length; i++) {
            this.winBar[i].getComponent(Sprite)!.color =
                i < stats.level ? WIN_BAR_ON : WIN_BAR_OFF;
        }

        this.winTally[0].string = `送达乘客 ${stats.passengers} 人`;
        // Named as a cost, and only when there was one. "解锁车位 0 个" is a line about
        // something that did not happen, and the star row above has already said as much.
        const lost = STAR_MAX - stats.stars;
        this.winTally[1].string = stats.unlocks === 0
            ? '没有解锁车位'
            : `解锁车位 ${stats.unlocks} 个 · 少 ${lost} 颗星`;

        scrim.active = true;
        // Past every seat chip: chips are appended as cars park, so they are later siblings
        // than anything built in the constructor. Same reason as the banner and the prompt.
        scrim.setSiblingIndex(this.canvas.children.length - 1);
        this.syncGear();
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
            const on = rank < stats.stars;
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

        // The button breathes. It IS a hit target now (see `hitsWin`), but a tap anywhere
        // else on the card advances too, so the movement is still what marks it as the thing
        // to do next rather than the only thing that works.
        const cta = this.winCta!;
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

    /**
     * What `ui` chose on the win card: the level after this one, this one again, or the home
     * screen.
     *
     * Anything that is not the close button or the replay text counts as 'next' -- the card
     * is not a form, and tapping the board to get on with it is how this screen has always
     * worked. That is also why the two quiet answers are the ones with hit boxes: they have
     * to be asked for.
     */
    hitsWin(ui: Vec3): 'next' | 'replay' | 'home' | null {
        if (!this.win?.active) return null;
        const c = this.winClose!.worldPosition;
        const r = PROMPT_X_D / 2 + 12;
        if ((ui.x - c.x) ** 2 + (ui.y - c.y) ** 2 <= r * r) return 'home';
        const p = this.winReplay!.worldPosition;
        if (Math.abs(ui.x - p.x) <= TEXT_BTN_W / 2
            && Math.abs(ui.y - p.y) <= TEXT_BTN_H / 2) return 'replay';
        return 'next';
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
        this.syncGear();
    }
}
