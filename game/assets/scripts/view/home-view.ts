import {
    Color, Label, Layers, Node, Sprite, tween, Tween, UIOpacity, UITransform, Vec3,
} from 'cc';
import {
    dotSprite, liftedPill, PILL_INK, roundedSprite, starSprite, toonDisc, triSprite,
} from './ui-shapes';
import { barBottomY, canvasSize, makeLabel, safeInsets } from './ui-layout';
import { CONTROL_BASE, shade } from './palette';
import {
    CHECKIN_D, COL_LIFT, COL_SCALE, COL_STROKE, CONTROL_PLATES, TopBar,
} from './top-bar';
import {
    LevelState, levelState, Progress, STAR_MAX, starsFor, unlockedThrough,
} from '../core/index';
import { railFlick, railNearest, railOffset, railRubber } from './rail-math';
import { nodeCenter } from '../core/home-path';
import { HomeScene } from './home-scene';

/**
 * The home screen: a street drawn up it, a rail of round level badges you drag through, a
 * standing top bar across the top, and one button that plays the level in the middle.
 *
 * THE GAME'S NAME IS NOT ON IT. It used to open this list, and it is gone -- the route fills
 * the screen top to bottom now and the first screen this hands over from is already wearing
 * the name at the largest size it gets. See the constructor, where the absence is argued.
 *
 * It is a UI screen in the SAME canvas as the HUD, not a Cocos scene of its own. A second
 * scene would mean a second copy of the camera rig and the preload chain that `start()`
 * spends its first frames on, and a scene load between the menu and the board -- for a
 * screen that is a few dozen sprites. `GameController.screen` decides which of the two is
 * up, and the board simply is not built while this one is.
 *
 * A RAIL RATHER THAN A GRID, and the difference is not decoration: a grid has to be
 * re-laid-out when the game grows past ten levels, while a rail just gets longer. It also
 * puts one level in the middle at a size worth looking at, which is what lets the button say
 * WHICH level it starts.
 *
 * THE BUTTON IS THE ONLY WAY IN. Dragging and tapping select; the green button plays. Two
 * jobs on one control -- tap to select, tap again to play -- is how a stray tap starts a
 * level nobody asked for, and on a rail a stray tap is exactly what a slightly-too-still
 * drag looks like.
 *
 * It draws the save, and it is the only place the level gate is enforced. WHAT THE BUTTON PLAYS
 * FOLLOWS THE RAIL, but only onto levels the save has already opened: bring a cleared level to
 * the middle and the button offers to replay it, bring a LOCKED one and the button does not move
 * at all -- it goes on offering the newest level the save allows, and the locked badge explains
 * itself with a toast instead. One place, because this screen owns what the player can see. See
 * `setFocus`, which is where that choice is actually made, and `selectedLevel`.
 */

/**
 * How far below the top bar a badge has finished dissolving.
 *
 * TWO RULES MEET AT THE TOP OF THE RAIL. A badge must not hard-cut anywhere -- `layout()` culls
 * a stop only at 0.75 of the screen height, which is off the screen entirely, so nothing stops
 * one climbing the whole way up. And a badge must not come to rest under the wx capsule, where
 * it can be seen and cannot be tapped, which is worse than not being there.
 *
 * THIS USED TO BE A COVER OVER THE WHOLE BAND, AND A COVER IS THE WRONG INSTRUMENT. It was an
 * opaque plate from `barBottomY` to the top of the screen with a ramp under it to dissolve its
 * edge, and it hid every badge that climbed past the bar -- along with the ROAD, because a plate
 * cannot choose what it covers. Repainting it in `LAWN` so it matched the ground did not fix
 * that and was not meant to: 「道路到那里就看不见了，要让道路一直延伸到最顶端」. What the player
 * could still see was not a change of colour, it was the route stopping short of the screen.
 *
 * SO THE DISSOLVE MOVED ONTO THE BADGES THEMSELVES. `layout()` eases each stop's own `UIOpacity`
 * down across this band, which reaches exactly the things that had to go and nothing else: the
 * street underneath is left alone and runs to the top edge of the screen, clipped there by the
 * screen like everything else on it. There is no plate and no ramp on this screen any more.
 *
 * IT IS ALSO THE TAP GATE NOW, and that is a simplification rather than a coincidence. `hitsStop`
 * used to carry its own `ui.y > barBottom` refusal, because a badge hidden under an opaque plate
 * was still there to be tapped. A badge is switched OFF the moment this ease reaches zero, which
 * happens exactly at `barBottom`, so the same rule is enforced by the thing that draws it.
 *
 * 220, against a badge about 190 tall once its star row is counted -- so a stop spends more than
 * its own height visibly dissolving before it reaches the bar, rather than winking out inside a
 * band shorter than itself. The old ramp's 110 only had to soften a plate's edge; this number
 * has to take a whole object away.
 */
const STOP_FADE_H = 220;

/**
 * The scroll hint: a small triangle under the fade, turned to point up, saying there is more
 * rail above without asking to be looked at.
 *
 * QUIET ON PURPOSE -- it is a hint, not a control. It borrows `triSprite`, the same shape the
 * start button's play-head icon is drawn from (see `START_ICON_D`), turned 90 degrees so its
 * tip -- drawn pointing right -- points up instead: Cocos rotates `Node.angle` positive
 * counter-clockwise, the same sense the barrier arm swings open in (see `GATE_OPEN_ANGLE`), so
 * +90 carries (1, 0) to (0, 1).
 *
 * IT FADES WITH THE SAME SMOOTHSTEP EVERYTHING ELSE ON THIS SCREEN FADES WITH, not a second
 * animation invented for it: `layout()` drives its `UIOpacity` with `t*t*(3-2*t)`, the ease the
 * badges dissolve on and the one `rampSprite` bakes into its texture, over `HINT_FADE_H` -- so
 * hint dissolves in the same visual language as the badges it sits under, rather than snapping
 * on and off. See `updateScrollHint`.
 */
/**
 * How much rail left above the top still counts as "there is more", for the hint's own fade.
 *
 * A SPAN OF SCROLL, NOT A BAND OF SCREEN. It shared a constant with the badge dissolve for no
 * better reason than that both were 110 and both eased the same way, and they answer different
 * questions -- this one is a distance the rail has still to travel, that one is a height. The
 * first time either needed retuning the other would have moved with it, which is how a number
 * ends up wrong in a place nobody was editing.
 */
const HINT_FADE_H = 110;

const CHEVRON_D = 26;
/** How far below the fade's own bottom edge the hint sits. */
const CHEVRON_GAP = 16;
/** The same quiet grey the padlock's ink wears -- see `LOCK_INK`. Not a control, so no chrome. */
const CHEVRON_INK = new Color(150, 163, 196, 220);

/**
 * How much clear space the button keeps under it, past the home indicator's own reservation.
 *
 * 90 rather than nothing: flush against the inset the button looks like it fell off the
 * screen, and on a phone with no inset at all it would genuinely be on the edge.
 */
const START_MARGIN = 90;
const START_W = 400;
const START_H = 116;
const START_R = 40;
const START = new Color(86, 199, 104, 255);
const START_BASE = new Color(56, 156, 76, 255);
/** How far the base peeks out below the face. Same lip the HUD's buttons wear. */
const BTN_LIFT = 8;

/**
 * The play-head icon on the button's face, and the arithmetic that keeps icon-plus-label
 * reading as one unit rather than as centred text with an icon hanging off its left side.
 *
 * 40, inside `ui-shapes.ts`'s own note on `triSprite` that this icon is "never drawn larger
 * than about 48 design units -- an icon on the start button", which is exactly this one.
 *
 * Both positions fall out of one requirement: icon (width START_ICON_D), a gap
 * (START_ICON_GAP), then the label (width L), read as a block centred as a whole under the
 * button's own centre. Solving that for each node's centre, taking the label's own bounding
 * box as symmetric about its centre (Label's default anchor, untouched here):
 *   label centre = (START_ICON_D + START_ICON_GAP) / 2         -- independent of L
 *   icon centre  = -(START_ICON_GAP + L) / 2                    -- depends on L
 * The label's centre is therefore a plain constant, `START_LABEL_X`, good for every string it
 * ever carries. The icon's is NOT: the button always reads "开始 第 N 关" now, one SHAPE, but
 * N is not one WIDTH -- "第 9 关" and "第 10 关" measure differently -- so the icon is still
 * repositioned every time the label's string changes, in `setCurrent`, using `L` read back
 * from the label itself via `Label.updateRenderData(true)`. That call is what makes `L`
 * available synchronously: a plain `.string` assignment leaves the node's `UITransform` width
 * stale until the renderer's next pass, but `updateRenderData(true)` flushes the assembler
 * immediately -- the same mechanism `RichText` uses to measure a label right after changing
 * it (see `updateRenderData` in the engine's `cocos/2d/components/label.ts`). It is not in
 * this project's own `.d.ts` stub, only in the engine's, which is what `tsconfig.view.json`
 * actually type-checks against (see its own comment on `game/temp/declarations/cc.d.ts`).
 *
 * `START_ICON_X` is used once, in `buildStart`, before the button has ever shown a real
 * string -- `setCurrent` (reached through `setProgress`) always runs before the button is
 * first revealed, so this placeholder is never actually seen; it exists so the icon has SOME
 * position between construction and that first `setCurrent` rather than sitting on the origin.
 */
const START_ICON_D = 40;
const START_ICON_GAP = 14;
const START_LABEL_X = (START_ICON_D + START_ICON_GAP) / 2;
const START_ICON_X = -START_W / 2 + START_R + START_ICON_D / 2 + 8;

/**
 * The toast a locked tap gets, over the button: how big, how far above it, and how long it
 * stays. See `showLockedToast`.
 */
const TOAST_W = 460;
const TOAST_H = 84;
const TOAST_GAP = 24;
const TOAST_TEXT = 34;
/** Held fully visible, then eased out -- together "about 1.6s". */
const TOAST_HOLD = 1.2;
const TOAST_FADE = 0.4;

/**
 * A ROUND BADGE, and its size is decided by the SAVE rather than by the scroll.
 *
 * WHAT THIS REPLACES, and why it is a bug fix rather than a restyle. The stops used to be
 * 236x148 pills that differed by state only in a shade of blue -- cleared was 59,108,168 and
 * the current level was 74,144,226, two steps apart on one hue -- while the one loud marker on
 * the screen, the green halo, was bound to the SCROLL POSITION. A player who dragged to level 4
 * saw a halo there and a button reading 开始 第 4 关, and nothing anywhere said that level 6 was
 * where they had actually got to. It was reported as an unlock bug; the unlock logic was
 * enumerated over all 1024 reachable saves and is correct. The screen simply had no language
 * for progress.
 *
 * So the three states now differ in FORM, not in shade: a cleared badge is green and carries a
 * row of stars, the current one is blue, a fifth larger, breathing, and rimmed with a bright
 * outline, a locked one is grey, faded to 60% and shrunk to 0.8, and wears a padlock. current
 * 1.2 > done 1.0 > locked 0.8 is a ladder now, not two sizes and a shrug. Every one of those
 * reads without scrolling, which is the whole test.
 *
 * AND THE SCROLL-DRIVEN SIZING IS GONE. `STOP_REST` used to shrink a stop continuously with its
 * distance from the middle, which was a nice piece of depth on a rail and is fatal here: a size
 * that changes while a finger drags is a size that cannot mean anything about the save. The
 * per-distance opacity fade went with it for the same reason -- "bright means cleared" is not a
 * sentence you can say while brightness is also saying "near the middle".
 *
 * THE HALO WAS THE LAST THING STILL BOUND TO THE SCROLL, and it was the exact bug this whole
 * rewrite was for: it followed the rail's focus, painted in `NODE_DONE`'s own green, so dragging
 * a locked level to the middle put a success-coloured glow on a padlock. It is gone. What is
 * there instead belongs to the current badge PERMANENTLY -- see `setProgress`, which toggles it
 * with the state and never with the scroll -- so it does not fade between badges and needs no
 * per-frame alpha of its own. See the current badge's own highlight, below, for what replaced
 * the halo a second time: a soft glow was reported as blur rather than emphasis, so it is now a
 * thin bright outline instead.
 */
const NODE_D = Math.round(1280 * 0.1);
/**
 * How far the base peeks out below the face: the badge's own THICKNESS, at 12% of `NODE_D`
 * (128 * 0.12 = 15.36, rounded to 15).
 *
 * DELIBERATELY NOT `BTN_LIFT` (8), and the two are not the same idea any more even though they
 * used to be the same number. `BTN_LIFT` is the lip every PRESSABLE control in this project
 * wears -- a hint that there is a face to push down. A badge is never pressed; its base peeking
 * out is instead standing in for the SIDE of a solid disc, the thing the requirement asks a
 * badge to look like it has. A button's lip and a badge's side stopped being the same number the
 * moment one of them started meaning thickness rather than travel.
 *
 * THE REQUIREMENT ASKS FOR "THE SAME THICKNESS/EDGE/LIGHT CONSTANTS THE IN-GAME CARS USE", AND
 * THERE ARE NO SUCH CONSTANTS TO SHARE. Cars are `MeshRenderer` meshes (`car-mesh.ts`) lit by a
 * scene key light, and `car-builder.ts` derives their shadow throw from the board's own tilt
 * (`shadowThrow(LIFT.contact)`) -- none of that exists here. This lobby is a flat orthographic UI
 * canvas: no light, no mesh, no board to tilt against. What this badge borrows from a car is its
 * APPEARANCE ONLY -- a darker side below the top face, plus a dark edge -- built from the same
 * two 2D primitives (`dotSprite`, `shade`) every other flat shape on this screen is drawn from.
 * A reader who goes looking for a shared `car-builder` import here will not find one, and should
 * not: the resemblance is a deliberate visual choice, not a shared constant.
 */
const NODE_LIFT = Math.round(NODE_D * 0.12);
/** Stars at a quarter of the badge, the proportion the requirement names. */
const STAR_D = Math.round(NODE_D * 0.25);
/**
 * Gap between star centres: `STAR_D` plus a fixed 5-unit gap between adjacent stars' edges.
 *
 * DERIVED, not a second literal. It used to be a plain 56 against a `STAR_D` of 51 -- a
 * 5-unit gap between stars that nothing tied together. Shrinking `STAR_D` and leaving
 * the pitch at 56 would have opened that gap to 13 and scattered the three stars under the
 * smaller badge; deriving it instead keeps today's 5-unit gap at whatever size `STAR_D` is.
 */
const STAR_PITCH = STAR_D + 5;
/**
 * The star row's centre, BELOW the badge rather than inside it.
 *
 * Three at this pitch span 2 * 37 + 32 = 106, narrower than the 128 badge, so the row reads as
 * belonging to the badge above it rather than as a bar of its own. The row bottoms out at
 * -(95 + 16) = -111 -- narrower than the -136 this row bottomed out at when the badge was 170
 * and lifted by `BTN_LIFT`. `RAIL_PITCH` (290, in `core/home-path`) has now been re-derived
 * against this smaller badge -- see that constant's own docblock for the table -- and the
 * re-derivation lands on the same 290, because the usable band (not this row) was always the
 * tighter of its two constraints.
 *
 * The gap is `NODE_LIFT` itself, not a separate constant that happens to match it: the base sits
 * `NODE_LIFT` lower than the face, so at the centreline the base's lowest point and the middle
 * star's highest point are the same y -- they touch at one point and overlap nowhere. That is
 * tight on purpose -- the stars have to read as attached.
 */
const STAR_Y = -(NODE_D / 2 + NODE_LIFT + STAR_D / 2);

/**
 * The single largest distance any pixel of a badge -- in ANY state, at ANY point in the breathe
 * tween -- can ever land from that badge's own node centre. Shared with `home-scene`, which has
 * to keep trees and lamps clear of every badge on the rail and has no other way to know how big
 * one gets (see `HomeScene`'s constructor, which takes this as a parameter rather than importing
 * it: `home-view` already imports `HomeScene`, so the reverse import would be a cycle).
 *
 * THE STAR ROW WINS, not the breathing rings, and that is the one counter-intuitive result
 * worth writing down. The current badge's bright highlight is the outermost thing that scales:
 * radius 70, sitting `NODE_LIFT` (15) low, so its farthest point from the node's centre is
 * `(70 + 15) x BREATHE_TO` = 107.1. THE OFFSET SCALES TOO -- `hi` is a child of the node
 * `layout` scales, so 1.26 multiplies its local position as well as its radius, and adding an
 * unscaled 15 to a scaled 88.2 (which is what an earlier version of this sentence did, for
 * 103.2) understates it. But a `done` badge's star row
 * never scales at all and sits further out to begin with: the outer star is offset
 * (`STAR_PITCH`, `STAR_Y`) = (37, -95) from the node's own centre, radius `STAR_D / 2` = 16, so
 * the farthest point on it is `sqrt(37^2 + 95^2) + 16` ~ 117.95 from the centre a tree's distance
 * is actually measured against. `done` badges are also the COMMON case along the rail -- unlike
 * the one `current` badge, which only exists at all when the star row does not (`starsFor`
 * returns 0 for it) -- so this is the bound that has to hold, not the more dramatic-looking one.
 *
 * A SINGLE RADIUS AROUND THE NODE'S CENTRE is a real over-approximation for any one direction --
 * the star's own reach is not radially symmetric, and neither is the edge disc's (it sits
 * `NODE_LIFT` below the node's centre, not on it). Bounding by the single largest distance in
 * ANY direction is deliberately conservative rather than exact: `home-scene` only has a scalar
 * radius to compare against a tree's own outline radius, so the bound has to be a circle that
 * contains the whole badge, not a badge-shaped budget.
 */
export const BADGE_MAX_R = Math.sqrt(STAR_PITCH ** 2 + STAR_Y ** 2) + STAR_D / 2;
/**
 * The current level's scale, which is also the FLOOR of its breath -- see `breath`.
 *
 * 1.2 is the figure the requirement asks for, and `BREATHE_TO` is a 5% swell above it, NOT a
 * multiplier applied to it: 1.2 * 1.26 would put the badge at 1.51 and a quarter bigger than
 * anyone asked for.
 */
const CUR_SCALE = 1.2;
const BREATHE_TO = 1.26;
const BREATHE_TIME = 1.6;

/** Cleared: bright. A finished level is a result, and it should look like one. */
const NODE_DONE = new Color(86, 199, 104, 255);
const NODE_DONE_BASE = new Color(56, 156, 76, 255);
/** The current level: the one thing on this screen that moves, in the primary blue. */
const NODE_CUR = new Color(74, 144, 226, 255);
const NODE_CUR_BASE = new Color(44, 96, 165, 255);
/**
 * Not yet reached: grey, wearing a padlock instead of its number, faded and shrunk so it reads
 * as weaker than either of the other two states rather than merely different.
 *
 * `LOCK_OPACITY` (153, 60%) sits on the whole badge node -- base, face, lock, everything -- via
 * `UIOpacity`, and `NODE_LOCK_SCALE` (0.8) is read against a NORMAL badge, not against the
 * current one's breathing 1.2.
 *
 * THE REQUIREMENT'S OWN WORDS SAY 80% OF THE CURRENT BADGE, and read that literally the figure
 * is 1.2 * 0.8 = 0.96 -- indistinguishable from a cleared badge's 1.0, which does the opposite of
 * what a "make the states more different" item is for. Taken instead as 0.8 of a NORMAL badge,
 * the ladder is current 1.2 > done 1.0 > locked 0.8, which is what the requirement is actually
 * asking the screen to say.
 */
const NODE_LOCK = new Color(52, 62, 90, 255);
const NODE_LOCK_BASE = new Color(38, 46, 70, 255);
const LOCK_OPACITY = 153;
const NODE_LOCK_SCALE = 0.8;
const STOP_INK = new Color(255, 255, 255, 240);

/**
 * The badge's EDGE: a disc behind both the base and the face, in each state's own face colour
 * darkened by `shade(..., -0.2)` -- the same HSL lightness shift `palette.ts` already uses for
 * every other outline on this screen's scenery (see `shade`'s own docblock there). Not a fourth
 * hand-picked colour per state; deriving it from the face it rims is what keeps a cleared, a
 * current and a locked badge looking like the SAME kind of object.
 *
 * SIZED AND POSITIONED TO RIM THE BASE, not the face: it shares the base's own `NODE_LIFT`
 * offset, so it is concentric with the base rather than with the face above it. Centred on the
 * face instead would need a stroke wider than `NODE_LIFT` (15) just to reach past the base's own
 * lowest point -- `NODE_EDGE` (4) is not that wide, on purpose, because a stroke that has to
 * outrun the base's own offset is not a thin edge any more. Concentric with the base, a modest
 * 4-unit stroke shows all the way around the base's exposed crescent -- the badge's SIDE -- which
 * is exactly where an edge is needed and exactly what is lost if this disc is only added after
 * the base (see `buildStop`'s draw order).
 */
const NODE_EDGE = 4;
const NODE_EDGE_D = NODE_D + NODE_EDGE * 2;
const NODE_DONE_EDGE = shade(NODE_DONE, -0.2);
const NODE_CUR_EDGE = shade(NODE_CUR, -0.2);
const NODE_LOCK_EDGE = shade(NODE_LOCK, -0.2);

/**
 * The current badge's own highlight: a thin bright outline behind it, in a light tint of
 * `NODE_CUR` rather than the soft glow that used to sit here.
 *
 * 「改为细描边高亮（2px 亮色描边 + 呼吸缩放），不要用模糊光晕」 -- the requirement is explicit that a
 * blur reads as a smudge, not as emphasis, so this is a plain disc rather than a soft-alpha halo
 * many times the badge's own size.
 *
 * IT IS MEASURED OFF THE DARK EDGE, NOT OFF THE FACE, and the first version was measured off the
 * face -- `NODE_D + 4` = 132 against a dark edge of `NODE_EDGE_D` = 136. A 132 disc behind a 136
 * one does not show as a thin ring; it shows as nothing at all where the two are concentric, and
 * here they are NOT concentric (the edge carries the base's `NODE_LIFT` offset and the highlight
 * did not), so what it actually drew was a bright crescent across the TOP half and nothing on the
 * bottom. Working it out: a point on the highlight's rim sits `sqrt(4581 + 1980 sin(theta))` from
 * the edge disc's centre, which is inside the edge's 68 for every theta below about 1 degree and
 * above about 179 -- the whole lower half.
 *
 * So the highlight is the OUTERMOST layer, `NODE_HI_PAD` beyond the dark edge on every side, and
 * it shares the edge's offset so the ring it leaves is the same 2 units the whole way round.
 *
 * IT REPLACES THE HALO THAT USED TO FOLLOW THE SCROLL, painted in `NODE_DONE`'s green -- drag a
 * locked level to the middle under the old code and a success-coloured ring landed on a padlock,
 * which is the bug this whole file was rewritten to stop. This highlight belongs to whichever
 * badge the SAVE calls current, permanently, so it never rides the rail: `setProgress` toggles
 * its `active` flag with `state`, once, and there is nothing per-frame about it at all -- see
 * `layout`, which does not touch it.
 *
 * IT LIVES INSIDE THE SAME NODE THE BREATHE TWEEN SCALES, so it grows and shrinks with the badge
 * for free; nothing here tweens the highlight's own size in step with `breath`.
 */
const NODE_HI_PAD = 2;
const NODE_HI_D = NODE_EDGE_D + NODE_HI_PAD * 2;
const NODE_CUR_HI = shade(NODE_CUR, 0.3);

const STAR_ON = new Color(255, 201, 52, 255);
const STAR_OFF = new Color(70, 82, 116, 255);

/**
 * The padlock on a locked stop, drawn from the primitives that exist: a round shackle with a
 * stop-coloured rounded sprite over its middle to cut it hollow, and the body over the join.
 * `ui-shapes` has no ring, and an emoji lock is one font substitution away from a hollow box
 * -- the same reason the HUD's home button says 主页 rather than wearing a glyph.
 *
 * It is drawn at the size it was when it shared a pill with the level's number and then scaled
 * up as a whole, rather than every piece being re-typed: three sprites that have to keep their
 * proportions are one node with one factor on it.
 */
const LOCK_INK = new Color(150, 163, 196, 255);
/** The padlock has the badge to itself now, so it is drawn to fill it. See `setProgress`. */
const LOCK_SCALE = 1.6;

/**
 * The barrier arm, which IS the loading screen.
 *
 * It is the one object that says "car park" with no caption, and it is nine rounded sprites.
 * IT DOES NOT SHOW A FRACTION, and that is deliberate: this game has no fractional progress
 * to show -- the preload is one material load behind an eight-second deadline -- so an arm
 * creeping toward vertical would be a progress bar reporting a number nobody measured.
 *
 * What it reports instead is the real milestone. It bobs a few degrees while the preload is
 * outstanding, which says "working" rather than "nearly there", and sweeps open once, when
 * the preload actually answers. A preload that hangs therefore leaves the arm DOWN and
 * bobbing for the full eight seconds -- which is the right thing to be looking at, and more
 * honest than a bar that fills to 90% and stops.
 */
const GATE_POST_W = 22;
const GATE_POST_H = 96;
const GATE_ARM_W = 300;
const GATE_ARM_H = 22;
const GATE_ARM_SEGS = 6;
const GATE_KERB_W = 340;
const GATE_KERB_H = 8;
const GATE_INK = new Color(107, 119, 150, 255);
const GATE_RED = new Color(232, 72, 60, 255);
const GATE_PALE = new Color(246, 247, 251, 255);
const GATE_OPEN_ANGLE = 78;
const GATE_OPEN_TIME = 0.42;
const GATE_BOB = 4;
const GATE_BOB_TIME = 0.9;
const GATE_DROP = 74;

const LOADING_SIZE = 34;
/**
 * 「正在放行…」, and it is the FIRST line of type the player ever reads.
 *
 * DARKENED FROM 150,163,196, which was picked against the deep navy this screen used to open
 * on and came with it when the navy did not. On the pavement grey this screen opened on next
 * (189,200,218) that pale grey sat at about 1.5:1 -- a pale line on pale ground, and the one
 * line on the screen with nothing else to read it by, because the barrier is still down and the
 * rail is not up yet. 64,76,108 is the same cool navy family the rest of this screen's ink
 * comes from, and it measured 5.04:1 there.
 *
 * IT IS READ ON `LAWN` NOW, not on that grey. The cap that used to put the board's pavement
 * colour behind this line is gone entirely (see STOP_FADE_H), so what is behind these glyphs is
 * the street's own lowest ground layer -- grass, everywhere on this screen, at every scroll
 * position. RE-MEASURED RATHER THAN ASSUMED, and the number is worth stating exactly because
 * it is close to a line: 64,76,108 on 147,203,128 is 4.49:1. That is a hair UNDER the 4.5 a
 * body-sized line is held to, and comfortably past the 3:1 that actually applies at this size --
 * `LOADING_SIZE` is 34 design units, about 29 device pixels on a 1080-wide phone, which is large
 * type by every threshold that draws the distinction. So the ink did not have to move with the
 * background, but it no longer has the margin it had: lightening `LAWN` costs contrast here
 * one-for-one, and this ink is what has to change if it ever does.
 */
const LOADING_INK = new Color(64, 76, 108, 255);

/**
 * The check-in icon's lip. Its DIAMETER is not here at all -- see `CHECKIN_D`, imported from
 * `top-bar`, which is the place this icon has to fill rather than a size it gets to pick. This
 * file used to write that 96 down itself, and the copy went out of step the first time the
 * column was resized.
 *
 * ITS LIP AND ITS RIM ARE NOT HERE EITHER -- `COL_LIFT` and `COL_STROKE`, imported alongside
 * the diameter, because this control has to be drawn the same way as the two it stands between
 * and every one of those numbers is decided by the column rather than by the glyph on it. This
 * file used to carry a 6-unit lip of its own, which was the gear's lip at the time and stopped
 * being it the moment the column went cartoon.
 *
 * THE FREE-COINS ENTRY THAT USED TO SIT BESIDE THIS ONE IS GONE. It drew a second coin -- with a
 * plus struck into it -- and did nothing when tapped, and the top bar's own coin readout already
 * drew a coin a few units away. Two coins on one bar reading as one thing twice is what the merge
 * fixed: `TopBar`'s coin pill is now both the balance readout and the one drawn-but-inert control
 * that argument used to describe -- see `coinTap` there for the argument itself, moved rather
 * than copied. `buildFreeCoinsIcon` and the constants it alone used (`FREE_COIN_D`,
 * `FREE_COIN_FACE_F`, `PLUS_L`, `PLUS_W`) went with it.
 */
/**
 * The calendar leaf on the check-in entry: a page, a head band, and two rings on it.
 *
 * SCALED BY THE COLUMN'S OWN STEP, imported rather than applied by hand, so the glyph keeps its
 * proportions against a disc whose size is decided in another file. The numbers below are the
 * ones this leaf wore at a 96 disc (themselves 96/76 of what it wore in the old row).
 */
const CAL_W = Math.round(53 * COL_SCALE);
const CAL_H = Math.round(51 * COL_SCALE);
const CAL_HEAD_H = Math.round(16 * COL_SCALE);
const CAL_RING_D = Math.round(11 * COL_SCALE);

/** Slack around a tap, in design units: the same padding the HUD's own hit tests use. */
const TAP_PAD = 10;

/**
 * How far a finger may travel and still count as a tap.
 *
 * 14 design units. Below it, a press that wobbles is a tap -- a rail that refused to be
 * tapped because the thumb moved two units would be maddening. Above it the gesture is a
 * drag, and the release must NOT also be treated as a tap, or every swipe would end by
 * selecting whatever it happened to stop over.
 */
const DRAG_SLOP = 14;

/**
 * How fast the rail closes on its target, per second, as a fraction of the distance left.
 * 12 lands a one-stop move in about a fifth of a second and cannot overshoot, which a spring
 * can -- and an overshooting level rail reads as broken rather than lively.
 */
const RAIL_EASE = 12;

/** Everything drawn for one level. Kept so `setProgress` can repaint without rebuilding. */
interface Stop {
    node: Node;
    /** Whole-badge fade: 255 normally, `LOCK_OPACITY` while locked. See `NODE_LOCK`. */
    opacity: UIOpacity;
    /** The current badge's own bright outline, toggled with `state` alone. See `NODE_CUR_HI`. */
    hi: Node;
    /** The dark edge behind the base and the face, recoloured with `state`. See `NODE_EDGE`. */
    outline: Node;
    face: Node;
    base: Node;
    num: Label;
    lock: Node;
    stars: Node[];
    /** What the save says about this level, and the ONLY thing that decides how it is drawn. */
    state: LevelState;
}

export class HomeView {
    /** Everything this screen draws, under one node, so `show`/`hide` is one flag. */
    private root: Node;
    /**
     * The standing top bar. NOT in `revealMenu` -- see `top-bar.ts`: the coin count and the
     * gear are true while the barrier is still down, so the bar is up from the first frame.
     */
    private topBar: TopBar;
    private startBtn: Node;
    private startFace: Node;
    private startLabel: Label;
    private startIcon: Node;
    /** The toast a locked tap gets: `HomeToast`'s holder, its fade, and its label. */
    private toastNode: Node;
    private toastFade: UIOpacity;
    private toastLabel: Label;
    /** The scroll hint under the fade: `ScrollHint`'s node and the opacity `layout()` ramps. */
    private scrollHint: Node;
    private scrollHintOpacity: UIOpacity;
    /** The street the rail runs up. See `home-scene`. */
    private scene: HomeScene;
    /** The stops' parent, parked on the lane. Stops are positioned within it. */
    private railRoot: Node;
    private stops: Stop[] = [];
    /**
     * The current level's scale, right now, while it breathes.
     *
     * A NUMBER IN A BOX RATHER THAN THE NODE'S OWN SCALE, and this is the one trap in this
     * file worth naming. `layout()` runs every frame and writes `setScale` on every visible
     * stop, so a tween on the node's scale would be overwritten before it was ever drawn -- the
     * badge would simply sit still and nothing would say why. The tween drives this field
     * instead and `layout()` reads it, which makes the two cooperate rather than race.
     *
     * A BOX (`{ v }`) rather than a bare field because `cc.tween` animates the PROPERTIES of an
     * object it is handed, and it cannot be handed a primitive.
     *
     * It is the ABSOLUTE scale, not a multiplier: it rests at `CUR_SCALE` and swells to
     * `BREATHE_TO`. Multiplying it into `CUR_SCALE` again would give 1.51.
     */
    private breath = { v: CUR_SCALE };
    /**
     * Whether the save HAS a current level to breathe, remembered so `show` can restart the
     * tween `hide` stopped without having to re-read the progress.
     *
     * False for a save with every level cleared, and false before the first `setProgress`.
     */
    private breathing = false;

    private loadingLayer: Node;
    private loadingFade: UIOpacity;
    private gateArm: Node;

    /** 0 until `setLevels`, which is also what "the rail exists" means. */
    private levelCount = 0;
    /** Whether the screen is still waiting. Every hit test refuses while it is true. */
    private waiting = true;

    /** The rail's drawn scroll position, and where it is heading. See `rail-math`. */
    private offset = 0;
    private target = 0;
    private focused = 0;
    /**
     * The newest level the save allows, capped at `levelCount`. Written by `setProgress` alone.
     *
     * NOT WHAT THE BUTTON PLAYS -- that is `selected`. This is the FALLBACK it drops back to
     * when the rail is aimed at a level the save has not opened, and it is the only number on
     * this screen that comes from `unlockedThrough` rather than from where the rail is looking.
     */
    private unlocked = 1;
    /** What the button plays. Written by `setFocus` alone -- see `selectedLevel`. */
    private selected = 1;

    private dragging = false;
    private dragFromY = 0;
    private dragBase = 0;
    private lastY = 0;
    private lastT = 0;
    private travelled = 0;
    /** Offset units per second, positive when later levels are coming to the middle. */
    private vel = 0;

    private h = 1280;
    /**
     * The bar's bottom edge, READ ONCE in the constructor and used for everything on this
     * screen that measures off it: the rail's centre, the cap and the ramp above it, and the
     * bar itself -- `TopBar` is HANDED this number rather than calling `barBottomY` again, and
     * its constructor's docblock argues that at length.
     *
     * WHEN IT IS READ, and it is the whole timing story for this screen: ONCE, in the
     * constructor, which `GameController.start()` runs on frame 0, and never again --
     * `HomeView` is not reconstructed. `capsuleInset()` (see `ui-layout`) caches whatever its
     * one read answers, including a zero, so `barBottomY` is a constant for the session and
     * this field is that constant. It used to be otherwise: `capsuleInset` deliberately did not
     * cache an unanswered read, so that a caller arriving later could ask again. That retry was
     * removed when this constructor became its only caller -- a second chance nobody can take
     * is machinery that reads like a guarantee and is not one. What it accepts is stated there:
     * `wx.getMenuButtonBoundingClientRect` is synchronous and normally ready at launch, and a
     * platform that answered late would cost this screen's top row one session.
     *
     * ONE READ IS STILL THE POINT, not "few reads", and the argument survives the retry it was
     * originally written against. `railCenterY()` runs again from `setLevels`, many frames after
     * the bar and the cap were built; the cap, the ramp and the bar were positioned from this
     * field, so the second call reads the same number by construction rather than by a claim
     * about how `capsuleInset` behaves. That is the disagreement `BAR_H` and `barBottomY` were
     * moved into `ui-layout` to make impossible, and it is closed here by a field rather than by
     * trusting a function to keep answering the same way -- a reader does not have to reconstruct
     * the timing argument to know the rail and the bar are in the same band.
     */
    private barBottom = 0;

    /**
     * Builds everything that does NOT depend on knowing the levels: the background, the
     * title, the lane, the button, and the barrier that stands in for all of it while the
     * game loads.
     *
     * Split that way so this screen can be on the canvas from the first frame the engine
     * draws. The Cocos first screen ends BEFORE the app starts -- `game.js` has it as
     * `firstScreen.end().then(() => application.start())` -- so between that logo and this
     * menu there is a stretch with nothing drawn in it but the camera's clear colour. The
     * stops arrive with `setLevels`, once the level count can be read.
     */
    constructor(canvas: Node) {
        const { w, h } = canvasSize(canvas);
        // `w` stays a local: everything on this screen that needs the width is built right
        // here, in this constructor, and the one y that outlives it is `barBottom` below.
        // It used to be a field because `railCenterY()` called `barBottomY(this.w, this.h)`;
        // that call is a field read now, and a width kept for nobody is a width that drifts.
        this.h = h;
        // BEFORE ANYTHING READS IT, and it is the ONLY call to `barBottomY` on this screen --
        // the rail, the cap, the ramp and the bar are all given this one number. See the field.
        this.barBottom = barBottomY(w, h);

        this.root = new Node('Home');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        canvas.addChild(this.root);

        // THE STREET GOES IN FIRST, and that is the whole of its z-ordering: everything after
        // it -- the stops, the cap over them, the top bar, the button -- draws over it. It
        // builds only its ground here; the road itself needs the level count, so it is
        // finished in `setLevels`.
        //
        // `BADGE_MAX_R` IS PASSED IN, NOT IMPORTED, the same way `setRailCenter` hands the
        // street a y it did not compute itself: `HomeScene` needs to know how far a badge's
        // outline can reach so its own `vergeIn` can keep scenery clear of one, but the number
        // is defined by how a badge is DRAWN, which is this file's business, not the street's.
        // Importing it the other way round would also be a straight import cycle -- this file
        // already imports `HomeScene` below.
        this.scene = new HomeScene(this.root, w, h, BADGE_MAX_R);

        // NO TITLE. The route fills the screen top to bottom now, and the game's name is
        // already the largest thing on the first screen this hands over from -- a second
        // copy of it over the road is a caption on a picture that has one. The level count
        // that used to sit under it is in the top bar; see below.
        this.railRoot = new Node('RailStops');
        this.railRoot.layer = Layers.Enum.UI_2D;
        this.railRoot.addComponent(UITransform);
        this.root.addChild(this.railRoot);
        // The rail hangs off the middle of the FREE BAND, not off the middle of the canvas --
        // see `railCenterY`. The street has to hang off the same y or the road comes out
        // parallel to the badges and a few dozen units beside them.
        this.railRoot.setPosition(0, this.railCenterY(), 0);
        this.scene.setRailCenter(this.railCenterY());

        // THE SCROLL HINT, just under the band the badges dissolve in -- see CHEVRON_D and
        // STOP_FADE_H. Nothing is drawn over the rail here any more: the street runs to the top
        // edge of the screen and the badges take themselves out of the bar's band. Built
        // inactive by default
        // (see `revealMenu`) and its opacity is driven every frame from `layout()`.
        const chevron = triSprite('ScrollHint', CHEVRON_D, CHEVRON_INK);
        chevron.angle = 90;
        this.root.addChild(chevron);
        chevron.setPosition(0, this.barBottom - STOP_FADE_H - CHEVRON_GAP, 0);
        this.scrollHint = chevron;
        this.scrollHintOpacity = chevron.addComponent(UIOpacity);
        this.scrollHintOpacity.opacity = 0;

        // THE FLOATING PLATE IS GONE and the count it carried is in the bar. The plate was a
        // 320x88 slab over the road with a 205-wide badge scrolling behind it; the badge is
        // about 285 tall once its star row is counted, so it stuck out top and bottom and the
        // pair read as clipping. The clear-save hold that had taken the title's place on that
        // plate went with it -- see `GameController`, where its timer used to live; the
        // settings card grows an explicit button with a confirmation instead.
        this.topBar = new TopBar(this.root, w, this.barBottom);

        // Against the BOTTOM EDGE rather than a fraction of the height, and clear of the
        // home indicator. A quarter of the way up put it in the middle of the route, where
        // it covered two stops and read as part of the road; down here it is a bar the route
        // runs behind, which is what the reference does with its own.
        const startY = -h / 2 + safeInsets().bottom * h + START_H / 2 + START_MARGIN;
        const start = this.buildStart(startY);
        this.startBtn = start.node;
        // `start.base` is deliberately not kept. It was, to repaint the button's plate
        // when the button went grey for a locked level -- and the button has no grey
        // state any more (see `setCurrent`). The base is drawn once, never written again.
        this.startFace = start.face;
        this.startLabel = start.label;
        this.startIcon = start.icon;

        const toast = this.buildToast(startY + START_H / 2 + TOAST_GAP + TOAST_H / 2);
        this.toastNode = toast.node;
        this.toastFade = toast.fade;
        this.toastLabel = toast.label;

        this.loadingLayer = new Node('Loading');
        this.loadingLayer.layer = Layers.Enum.UI_2D;
        this.loadingLayer.addComponent(UITransform);
        this.root.addChild(this.loadingLayer);
        this.loadingFade = this.loadingLayer.addComponent(UIOpacity);
        this.gateArm = this.buildGate(h * 0.03);

        this.setLoading(true);
        this.root.active = false;
    }

    /**
     * The primary button. Its LABEL says which level it opens, and it is driven from the SAVE
     * alone, by `setCurrent` -- see `setFocus` for the scroll-driven state this button used to
     * share with the rail and no longer does.
     */
    private buildStart(
        y: number,
    ): { node: Node; face: Node; base: Node; label: Label; icon: Node } {
        const btn = new Node('HomeStart');
        btn.layer = Layers.Enum.UI_2D;
        btn.addComponent(UITransform).setContentSize(START_W, START_H);
        this.root.addChild(btn);
        btn.setPosition(0, y, 0);
        const base = roundedSprite('base', START_W, START_H, START_BASE, START_R);
        btn.addChild(base);
        base.setPosition(0, -BTN_LIFT, 0);
        const face = roundedSprite('face', START_W, START_H, START, START_R);
        btn.addChild(face);
        // Left of the label -- see START_ICON_X for where and why.
        const icon = triSprite('icon', START_ICON_D, Color.WHITE);
        face.addChild(icon);
        icon.setPosition(START_ICON_X, 0, 0);
        const label = makeLabel(face, 'HomeStartLabel', 46, 0, START_LABEL_X);
        label.isBold = true;
        label.string = '开始游戏';
        return { node: btn, face, base, label, icon };
    }

    /**
     * The toast a locked tap gets instead of a mute button: `通过第 N 关解锁`, shown for about
     * 1.6s and then gone on its own -- not a dialog, and it never blocks a tap on anything
     * else. See `showLockedToast`.
     *
     * BUILT FROM `liftedPill`, THE SAME FACE-OVER-BASE EVERY PRESSABLE THING ON THIS SCREEN
     * WEARS, because a fourth panel idiom for one line of text would be a new thing to keep in
     * step with the project's own rule that a raised plate is what a panel here looks like. It
     * never gets pressed, so it borrows the shape and not `BTN_LIFT`'s press animation.
     *
     * PARKED ABOVE THE BUTTON rather than over the rail, so it can never cover the badge whose
     * lock it is explaining.
     */
    private buildToast(y: number): { node: Node; fade: UIOpacity; label: Label } {
        const { holder, face } = liftedPill('HomeToast', TOAST_W, TOAST_H);
        this.root.addChild(holder);
        holder.setPosition(0, y, 0);
        const fade = holder.addComponent(UIOpacity);
        const label = makeLabel(face, 'HomeToastLabel', TOAST_TEXT, 0);
        label.color = PILL_INK;
        label.isBold = true;
        holder.active = false;
        return { node: holder, fade, label };
    }

    /** See GATE_POST_W for what this is and why its arm does not report a fraction. */
    private buildGate(y: number): Node {
        const kerb = roundedSprite('gateKerb', GATE_KERB_W, GATE_KERB_H, GATE_INK, 4);
        this.loadingLayer.addChild(kerb);
        kerb.setPosition(0, y - GATE_DROP, 0);

        const postX = -GATE_KERB_W / 2 + GATE_POST_W;
        const post = roundedSprite('gatePost', GATE_POST_W, GATE_POST_H, GATE_INK, 8);
        this.loadingLayer.addChild(post);
        post.setPosition(postX, y - GATE_DROP + GATE_POST_H / 2, 0);

        // The arm pivots at its LEFT end, on top of the post, so its own node sits there and
        // the stripes hang off to the right of the origin -- rotating the node then rotates
        // the whole arm about the post, which is what a barrier does.
        const arm = new Node('gateArm');
        arm.layer = Layers.Enum.UI_2D;
        arm.addComponent(UITransform);
        this.loadingLayer.addChild(arm);
        arm.setPosition(postX, y - GATE_DROP + GATE_POST_H, 0);
        const seg = GATE_ARM_W / GATE_ARM_SEGS;
        for (let i = 0; i < GATE_ARM_SEGS; i++) {
            const bar = roundedSprite(
                `seg-${i}`, seg, GATE_ARM_H, i % 2 === 0 ? GATE_RED : GATE_PALE, 3,
            );
            arm.addChild(bar);
            bar.setPosition(seg / 2 + i * seg, 0, 0);
        }

        const label = makeLabel(this.loadingLayer, 'HomeLoading', LOADING_SIZE, y - 200);
        label.color = LOADING_INK;
        label.string = '正在放行…';
        return arm;
    }

    /**
     * Show or hide the waiting state: the barrier stands in for the rail and the button, and
     * every hit test refuses while it is up.
     *
     * One flag drives the visibility AND the hit tests, the discipline SPEED_BUTTON and
     * PICK_ROW settled: a control that is invisible but still answering taps would start a
     * level out of a screen that has not finished loading one.
     *
     * Turning it OFF sweeps the arm open and brings the menu up as the sweep clears it, so
     * the two read as one movement rather than a wipe followed by a menu. That costs
     * GATE_OPEN_TIME, and it is the only reason the metaphor is worth having.
     */
    setLoading(on: boolean): void {
        this.waiting = on;
        Tween.stopAllByTarget(this.gateArm);
        Tween.stopAllByTarget(this.loadingFade);
        Tween.stopAllByTarget(this.root);
        if (on) {
            this.loadingLayer.active = true;
            this.loadingFade.opacity = 255;
            this.gateArm.angle = 0;
            this.revealMenu(false);
            // Bobbing, not creeping: it says "working", and it cannot be mistaken for a
            // measurement of how much is left.
            tween(this.gateArm)
                .to(GATE_BOB_TIME, { angle: -GATE_BOB }, { easing: 'sineInOut' })
                .to(GATE_BOB_TIME, { angle: 0 }, { easing: 'sineInOut' })
                .union()
                .repeatForever()
                .start();
            return;
        }
        tween(this.gateArm)
            .to(GATE_OPEN_TIME, { angle: GATE_OPEN_ANGLE }, { easing: 'cubicOut' })
            .start();
        tween(this.loadingFade)
            .delay(GATE_OPEN_TIME * 0.55)
            .to(0.2, { opacity: 0 })
            .call(() => { this.loadingLayer.active = false; })
            .start();
        tween(this.root)
            .delay(GATE_OPEN_TIME * 0.5)
            .call(() => this.revealMenu(true))
            .start();
    }

    /**
     * Everything that belongs to the MENU, on or off. The top bar is deliberately absent: it
     * is standing, and it is up while the barrier is still down. See `top-bar.ts`.
     */
    private revealMenu(on: boolean): void {
        this.startBtn.active = on;
        this.railRoot.active = on;
        this.scrollHint.active = on;
    }

    /**
     * Tell the screen how many levels there are, and build the rail.
     *
     * `levelCount` comes from the caller rather than a constant here, because the number of
     * levels is a fact about the `resources/levels` folder and `GameController` is what can
     * see it. Adding a level-11.json then extends the rail with no change to this file --
     * and with a rail, not even a change of layout.
     *
     * Called once, after the preload: reading the bundle's index is the one thing on this
     * screen that cannot be done before the engine has finished starting.
     */
    setLevels(levelCount: number): void {
        if (this.stops.length > 0) return;
        this.levelCount = levelCount;
        // The street's road runs stop to stop, so it is built from the same number at the same
        // moment -- there is no state in which one of the two exists and the other does not.
        this.scene.build(levelCount);
        for (let i = 0; i < levelCount; i++) this.stops.push(this.buildStop(i));
        this.railRoot.setPosition(0, this.railCenterY(), 0);
        this.scene.setRailCenter(this.railCenterY());
        this.layout();
    }

    private buildStop(i: number): Stop {
        const node = new Node(`Stop${i + 1}`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(NODE_D, NODE_D);
        this.railRoot.addChild(node);
        // The whole-badge fade for the locked state. See `LOCK_OPACITY`.
        const opacity = node.addComponent(UIOpacity);

        // FOUR LAYERS, IN THIS ORDER, and getting the order wrong loses either the side or the
        // edge: the current badge's own highlight first (furthest back, so it is the one thing
        // visible past everything else when it is active), then the dark edge, then the base
        // (offset down -- see NODE_LIFT), then the face, with the number and the padlock drawn
        // as children of the face on top of all of it.
        //
        // The highlight, first and furthest back. A DOT, like everything else here: a rounded
        // square around a circle shows its four corners as coloured ears. Parented under `node`,
        // the same node `layout()` scales for the breathe tween, so it grows and shrinks with the
        // badge without a tween of its own. Its visibility is a plain flag `setProgress` sets
        // with the state -- see `NODE_CUR_HI`.
        const hi = dotSprite('hi', NODE_HI_D, NODE_CUR_HI);
        node.addChild(hi);
        // Concentric with the EDGE, not with the face: the two rings have to share a centre or
        // the bright one comes out thicker at the top than at the bottom. See `NODE_HI_PAD`.
        hi.setPosition(0, -NODE_LIFT, 0);
        hi.active = false;

        // The edge, second: it must be added BEFORE the base or the base would paint over it
        // and the side would lose its edge exactly where it matters -- see `NODE_EDGE`. It
        // shares the base's own `NODE_LIFT` offset so the two are concentric.
        const outline = dotSprite('outline', NODE_EDGE_D, NODE_CUR_EDGE);
        node.addChild(outline);
        outline.setPosition(0, -NODE_LIFT, 0);

        const base = dotSprite('base', NODE_D, NODE_CUR_BASE);
        node.addChild(base);
        // The base peeks out below the face -- the badge's own SIDE, at `NODE_LIFT`, not the
        // button's lip (`BTN_LIFT`). On a circle it shows as a crescent along the bottom edge.
        base.setPosition(0, -NODE_LIFT, 0);
        const face = dotSprite('face', NODE_D, NODE_CUR);
        node.addChild(face);
        const num = makeLabel(face, 'n', 62, 0);
        num.color = STOP_INK;
        num.isBold = true;
        num.string = `${i + 1}`;

        const lock = this.buildLock(face);
        // THE STARS HANG OFF `node`, NOT OFF `face`: they are below the badge now rather than
        // inside it, so they are a sibling of the badge and not part of it.
        const stars: Node[] = [];
        for (let s = 0; s < STAR_MAX; s++) {
            const star = starSprite(`star${s}`, STAR_D, STAR_OFF);
            node.addChild(star);
            star.setPosition((s - (STAR_MAX - 1) / 2) * STAR_PITCH, STAR_Y, 0);
            star.active = false;
            stars.push(star);
        }
        return { node, opacity, hi, outline, face, base, num, lock, stars, state: 'locked' };
    }

    /** See LOCK_INK: a padlock out of three sprites, the middle one a hole. */
    private buildLock(face: Node): Node {
        const lock = new Node('lock');
        lock.layer = Layers.Enum.UI_2D;
        lock.addComponent(UITransform);
        face.addChild(lock);
        // DEAD CENTRE, and the level's number is switched off behind it -- see `setProgress`.
        lock.setPosition(0, 0, 0);
        lock.setScale(LOCK_SCALE, LOCK_SCALE, 1);
        const shackle = dotSprite('shackle', 38, LOCK_INK);
        lock.addChild(shackle);
        shackle.setPosition(0, 13, 0);
        // The hole is a hole: it is painted the face's own colour, so it must track it.
        const hole = roundedSprite('hole', 18, 24, NODE_LOCK, 9);
        lock.addChild(hole);
        hole.setPosition(0, 15, 0);
        const body = roundedSprite('body', 46, 34, LOCK_INK, 8);
        lock.addChild(body);
        body.setPosition(0, -10, 0);
        lock.active = false;
        return lock;
    }

    /**
     * Draw the save: every stop's state and rating, and which level the rail opens on.
     *
     * Opening on the furthest unlocked level is what makes the rail land where the player
     * left off, and it is the same number the button offers -- `setCurrent` and `setFocus`
     * each take it from this one local, so the two agree by construction rather than by one
     * of them writing both.
     */
    setProgress(p: Progress): void {
        if (this.stops.length === 0) return;
        let hasCurrent = false;
        for (let i = 0; i < this.stops.length; i++) {
            const level = i + 1;
            const stop = this.stops[i];
            // ONE SOURCE OF TRUTH. `levelState` returns a three-way union, so the states are
            // mutually exclusive by construction and this loop cannot come away holding two of
            // them at once. It used to read `open = isUnlocked(...)` and `done = bestStars(...)
            // > 0` and then draw stars as `open && done` -- two independent facts that a call
            // site had to remember to combine, and the `&&` is the only thing that stopped a
            // gapped save from painting three stars on a level it had locked.
            //
            // `bestStars` is deliberately NOT called here, and `logic/tests/view-source.test.ts`
            // fails if it comes back: `starsFor` already returns 0 for anything that is not
            // `done`, so asking the core twice is the second source of truth arriving again.
            const state = levelState(p, level);
            const best = starsFor(p, level);
            stop.state = state;
            if (state === 'current') hasCurrent = true;
            stop.face.getComponent(Sprite)!.color =
                state === 'done' ? NODE_DONE : (state === 'current' ? NODE_CUR : NODE_LOCK);
            stop.base.getComponent(Sprite)!.color = state === 'done'
                ? NODE_DONE_BASE
                : (state === 'current' ? NODE_CUR_BASE : NODE_LOCK_BASE);
            // The edge is derived from the same state, via `shade`, so it always rims whichever
            // face colour is showing -- see `NODE_EDGE`.
            stop.outline.getComponent(Sprite)!.color = state === 'done'
                ? NODE_DONE_EDGE
                : (state === 'current' ? NODE_CUR_EDGE : NODE_LOCK_EDGE);
            // THE NUMBER GOES OFF WHEN IT IS LOCKED, and that reverses the decision the old
            // comment here argued for. It is the SHAPE that changed, not the argument: the old
            // stop was a 236-wide pill, so a padlock could sit left of centre with the number
            // beside it and both could be read. A 128 circle has room for one of the two. The
            // padlock wins, because "you have not got here yet" is what a locked stop is for
            // saying, and the road itself counts the levels off in order for anyone who wants
            // to know which one they are looking at.
            stop.num.node.active = state !== 'locked';
            stop.lock.active = state === 'locked';
            // The highlight belongs to the current badge alone, and belongs to it permanently:
            // no fade, no distance -- just this one flag, set once here and left alone by
            // `layout`.
            stop.hi.active = state === 'current';
            // Locked reads weaker than either state it sits between: faded (see `LOCK_OPACITY`)
            // and shrunk (`NODE_LOCK_SCALE`). BOTH are applied in `layout` against the state,
            // not here -- the lock fade and the top-of-rail dissolve multiply into one opacity,
            // and two writers on one property means whichever ran last wins.
            for (let s = 0; s < stop.stars.length; s++) {
                // Absent, not empty, on a level never cleared: three grey stars would say it
                // was cleared with none, which cannot happen (the rating floors at one).
                stop.stars[s].active = state === 'done';
                stop.stars[s].getComponent(Sprite)!.color = s < best ? STAR_ON : STAR_OFF;
            }
        }
        this.setBreathing(hasCurrent);
        const current = Math.max(1, Math.min(this.levelCount, unlockedThrough(p)));
        this.unlocked = current;
        // THE ORDER HERE IS LOAD-BEARING, twice over. `setFocus` is the only thing that writes
        // the button, and it decides what to write by reading the stop STATES the loop above
        // has just finished assigning -- so it has to run after that loop, and `unlocked` has
        // to be set before it, because a locked aim falls back to it.
        this.setFocus(current - 1);
        // Land there rather than glide there: this runs as the screen appears, and a rail
        // that slides in from level 1 every time would be an animation of loading a save.
        this.offset = this.target;
        this.layout();
    }

    /**
     * Start or stop the current level's breath.
     *
     * IT IS BOUND TO THE SAVE, NOT TO THE SCROLL, and that is the entire point of it. The badge
     * that breathes is the same one that wears the highlight (`NODE_CUR_HI`) -- one badge, one
     * state, both marks -- rather than the old split where the breath followed the save and a
     * halo followed wherever the rail had been dragged.
     *
     * Driven from `setProgress` rather than from `layout()` for the same reason: `layout()` only
     * knows where the rail is.
     *
     * `stopAllByTarget` first, because `setProgress` is called again every time a level ends --
     * without it each return to the lobby would stack another repeating tween on the same field
     * and the breath would get faster and deeper for the rest of the session.
     *
     * A game with every level cleared has no current level at all, and then there is nothing to
     * breathe: the tween is stopped and the field is parked at its resting value.
     *
     * `hide` stops it too and `show` restarts it from `breathing`, which is why the answer is
     * remembered rather than recomputed -- a `repeatForever` left running through a whole level
     * costs almost nothing, but this file's habit is that whatever starts a tween is responsible
     * for stopping it, and a habit with an exception in it is not a habit.
     */
    private setBreathing(on: boolean): void {
        this.breathing = on;
        Tween.stopAllByTarget(this.breath);
        this.breath.v = CUR_SCALE;
        if (!on) return;
        tween(this.breath)
            .to(BREATHE_TIME, { v: BREATHE_TO }, { easing: 'sineInOut' })
            .to(BREATHE_TIME, { v: CUR_SCALE }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    /**
     * The y the rail is centred on: the middle of the free band between the top bar's bottom
     * edge and the start button's top edge.
     *
     * NOT THE CANVAS CENTRE, because the canvas centre is not the centre of anything the player
     * can see: a bar eats into the space from above and the start button eats into it from
     * below, and the two bites are not the same size. Centring on the free band puts the badge
     * the rail has scrolled to in the middle of the room it actually has.
     *
     * IT IS A SMALL MOVE, and this docblock used to overclaim it. On h = 2770 with no insets
     * the band centre is +35.8, and with a typical notch and home indicator +21.95 -- about a
     * tenth of a badge. It is a tidier layout, NOT the fix for 打开大厅没滚到当前关. That
     * complaint was the halo: it was the only loud marker on the screen and it followed the
     * scroll, so the badge a player had dragged to looked like the badge they were up to. What
     * fixes it is the three state badges, not this function.
     *
     * THE COLUMN DID NOT MOVE THIS. `TopBar` went from a 96-tall row across the whole width to a
     * column of three larger controls running down the left margin, which is taller than the old
     * row -- but the column sits at x from -601.6 to -361.6 (see `top-bar.ts`'s own
     * constructor docblock), and a stop never reaches further out than `ZIG_X` (210) plus its own
     * radius, nowhere close. `top` is still `this.barBottom` -- the SAME number the column's own
     * top edge sits at (see `TopBar`'s constructor) -- because the free band this centres on was
     * never about the bar's SHAPE, only about the one y both files agree is the boundary between
     * chrome and rail. `RailCap` and `RailFade` did not move either, for the same reason: both
     * are painted from `this.barBottom`, unchanged, and neither reads the bar's width or shape.
     */
    private railCenterY(): number {
        const top = this.barBottom;
        const bottom = -this.h / 2 + safeInsets().bottom * this.h + START_MARGIN + START_H;
        return (top + bottom) / 2;
    }

    /**
     * Which level the button plays: the one the rail is aimed at, whenever the save allows it.
     *
     * THE ONLY LEVEL NUMBER THIS SCREEN HANDS OUT, and it is still exactly one. It used to be
     * called `currentLevel` and to return the newest level the save allowed, because there had
     * been a `focusedLevel()` beside it returning the raw centred stop and `GameController`
     * started levels from that -- ungated, so a scroll onto a locked badge started a locked
     * level. Both accessors collapsing into one was the fix, and the one that survived was the
     * one that could not return a locked level.
     *
     * THIS IS NOT `focusedLevel()` COMING BACK. The gate did not move and did not loosen; it is
     * still enforced in exactly one place, `setFocus`, which refuses to let a locked stop become
     * `selected` at all. There is still no scroll position from which this returns a level the
     * save has not opened -- what changed is that a scroll onto an OPEN one is now honoured.
     *
     * WHY IT FOLLOWS THE RAIL AT ALL, having pointedly not: 「现在如果已经玩到第6关了，好像没法选
     * 之前的5关」. A screen that draws ten levels, lets the player drag any of them to the middle,
     * centres the one they tapped, and then starts a different one is arguing with itself. The
     * levels below the newest were never gated -- they are cleared -- so there was nothing to
     * protect by refusing them, and the refusal read as a bug because it was one.
     *
     * `focused` (the scroll) stays private, and so does `unlocked` (the save). Neither is a
     * level number anyone outside this class gets to reach for.
     */
    selectedLevel(): number {
        return this.selected;
    }

    /**
     * Write the button: which level it plays, and whether it offers that as a first run or a
     * replay. The only place `selected` is assigned.
     *
     * `replay` IS PASSED IN RATHER THAN DERIVED HERE as `level < this.unlocked`, and the
     * difference shows on a fully cleared save: `unlocked` is capped at `levelCount`, so the
     * last level is at once "the newest the save allows" and already beaten, and that comparison
     * would call it a first run forever. The caller passes the stop's OWN STATE, which is the
     * question actually being asked -- has this level been cleared -- rather than a proxy for it.
     */
    private setStart(level: number, replay: boolean): void {
        this.selected = level;
        this.startLabel.string = `${replay ? '重玩' : '开始'} 第 ${level} 关`;
        // Flush the assembler so the label's UITransform width is the SETTLED width of the
        // string just above, not last frame's -- see START_ICON_D for why this is safe to
        // rely on. Only then can the icon be placed exactly, rather than approximately, for
        // whichever width this level's number just gave it.
        this.startLabel.updateRenderData(true);
        const labelW = this.startLabel.node.getComponent(UITransform)!.width;
        this.startIcon.setPosition(-(START_ICON_GAP + labelW) / 2, 0, 0);
    }

    /**
     * Move the rail's aim to stop `i`, AND decide what the button plays. Both, here, because
     * they are one decision: the button offers the level the rail is showing, when it may.
     *
     * THE GATE MUST NOT SHOW AS A REFUSAL, and that is the constraint the whole method is
     * shaped around. It used to: bringing a locked level to the middle turned the button grey
     * and re-worded it as what would unlock it -- the same defect this file had already fixed
     * for the badges (see `NODE_CUR_HI`'s own docblock, above) left standing in the one control
     * that matters most. The cure at the time was to stop the button reading the rail at all,
     * which fixed the grey button and created a second complaint: a cleared level could be
     * brought to the middle and still not be played.
     *
     * SO THE RULE IS NOT "FOLLOW THE RAIL" AND NOT "IGNORE IT" -- it is follow the rail onto
     * anything the save has opened, and DO NOT MOVE for anything it has not. A locked aim leaves
     * the button exactly as it was, still green, still live, still offering `unlocked`; the
     * locked badge answers for itself through `showLockedToast`. There is no state in which this
     * screen presents a button the player cannot press.
     *
     * TWO LOOKUPS, NOT ONE, and they are different stops. `aimed` is where the rail is pointing
     * and decides WHICH level the button gets; `played` is the stop for that level and decides
     * how the button WORDS it. On a locked aim the two are different rows of `stops` -- the aim
     * is the locked badge, the wording comes from the fallback level's own badge -- and reading
     * the wording off `aimed` would label a replay of level 6 with the state of the locked level
     * 8 the player happened to be looking at.
     *
     * A MISSING STOP COUNTS AS LOCKED. `setFocus` can run before `setProgress` has assigned a
     * single state (an early drag, in principle) and `stops[i]` can be undefined on a rail that
     * is not built yet; falling back to `unlocked` is the safe answer in both cases, and it is
     * the answer the screen opens on anyway.
     */
    private setFocus(i: number): void {
        this.focused = Math.max(0, Math.min(Math.max(0, this.levelCount - 1), i));
        this.target = railOffset(this.focused);
        const aimed = this.stops[this.focused];
        const level = !aimed || aimed.state === 'locked' ? this.unlocked : this.focused + 1;
        const played = this.stops[level - 1];
        this.setStart(level, played !== undefined && played.state === 'done');
    }

    /**
     * Bring stop `i` to the middle, on a tap. A locked stop also raises the toast that says
     * what would unlock it -- the button itself no longer reads the focus, so a tap on a
     * locked badge would otherwise land on a screen that says nothing about why it is grey.
     */
    focusStop(i: number): void {
        this.setFocus(i);
        const stop = this.stops[i];
        // `i` IS the level just before the tapped one (the tapped level is `i + 1`), so no
        // further arithmetic is needed to name what the toast should say unlocks it.
        if (stop && stop.state === 'locked') this.showLockedToast(i);
    }

    /**
     * Say what would unlock stop `n + 1`, over the button, and fade it out on its own.
     *
     * `stopAllByTarget` FIRST, the same discipline `setBreathing` argues for: a second locked
     * tap before the first toast finished fading would otherwise stack a second tween on the
     * same opacity, and the two would fight over it for the rest of the fade.
     *
     * TOAST_HOLD then TOAST_FADE is "about 1.6s" -- held fully visible, then eased out, with
     * no dismissal for the player to reach for: it is explaining a badge, not asking a
     * question, so it does not need to block anything to be seen.
     */
    private showLockedToast(n: number): void {
        this.toastLabel.string = `通过第 ${n} 关解锁`;
        this.toastNode.active = true;
        Tween.stopAllByTarget(this.toastFade);
        this.toastFade.opacity = 255;
        tween(this.toastFade)
            .delay(TOAST_HOLD)
            .to(TOAST_FADE, { opacity: 0 })
            .call(() => { this.toastNode.active = false; })
            .start();
    }

    /**
     * Pressed drops the face onto the base by BTN_LIFT; released returns it to rest. That is
     * the whole effect -- no scale, no colour change. Every pressable thing on this screen is
     * a face over a base with a visible lip (see BTN_LIFT), so taking the lip away IS the
     * press: it reuses the vocabulary the resting state already wears instead of inventing a
     * second one.
     */
    setStartPressed(on: boolean): void {
        this.startFace.setPosition(0, on ? -BTN_LIFT : 0, 0);
    }

    /**
     * Ease the rail toward its target and lay the stops out. Driven from
     * `GameController.update`, which calls it BEFORE its own `core` guard -- there is no core
     * on this screen.
     *
     * Exponential smoothing rather than a tween: the target changes mid-flight (a tap during
     * a glide, a second flick) and a tween would have to be stopped and rebuilt every time,
     * while this just keeps closing on whatever the target is now.
     */
    tick(dt: number): void {
        if (!this.dragging && this.offset !== this.target) {
            this.offset += (this.target - this.offset) * Math.min(1, dt * RAIL_EASE);
            if (Math.abs(this.target - this.offset) < 0.5) this.offset = this.target;
        }
        this.layout();
    }

    /**
     * Place every stop for the current offset.
     *
     * BOTH COORDINATES COME FROM `nodeCenter`, which is the same function `home-scene` strokes
     * the road through. That is what makes "the road passes through the badge centres" a fact
     * rather than two pieces of arithmetic that happen to agree today -- the old lobby's dashed
     * line and its column of pills were computed separately, and looked it.
     *
     * SCALE COMES FROM THE STATE, NOT FROM THE DISTANCE -- nothing here reads `offset` at all
     * any more; see NODE_D for what that costs and why it is worth it. The current level's
     * scale is read out of `breath`, which a tween is driving -- writing it here and tweening
     * the node would be the two of them fighting over the same property every frame. A locked
     * badge gets the plain constant `NODE_LOCK_SCALE` instead, and the highlight and the edge
     * ride along with whichever of the two the badge gets, because both are parented under the
     * same node.
     *
     * Stops fully off screen are deactivated; ones at the edge are left to be clipped by the
     * screen itself, because a half-visible badge is what says there is more rail.
     */
    private layout(): void {
        const edge = this.h * 0.75;
        // THE STREET SCROLLS ON THIS OFFSET AND CULLS AGAINST THIS EDGE, the same two numbers
        // the stops below are about to use. `core/home-path` guarantees the road passes through
        // the stop centres; feeding the road a different scroll would spend that guarantee on
        // nothing, and the symptom -- a road running just past every badge -- looks like a
        // drawing mistake rather than an arithmetic one.
        this.scene.layout(this.offset, edge);
        for (let i = 0; i < this.stops.length; i++) {
            const stop = this.stops[i];
            // Level 1 at the bottom and the numbers climbing, which is what makes the column
            // read as a route rather than as a list: `nodeCenter(i).y` grows with i, and +y is
            // up. It is the same value `railOffset(i)` returns -- both are `i * RAIL_PITCH` --
            // and taking it from `home-path` is what ties the badge to the road it stands on.
            const c = nodeCenter(i);
            const y = c.y - this.offset;
            // THE DISSOLVE AND THE CULL ARE THE SAME TEST, from opposite ends of the rail. Below
            // the screen a stop is simply switched off; above the bar it is switched off because
            // it has finished fading. `shown` reaching zero is what puts a badge out of reach of
            // `hitsStop`, which no longer carries a bound of its own -- see STOP_FADE_H.
            const shown = this.topFade(y);
            if (Math.abs(y) > edge || shown <= 0) {
                stop.node.active = false;
                continue;
            }
            stop.node.active = true;
            const scale = stop.state === 'current'
                ? this.breath.v
                : (stop.state === 'locked' ? NODE_LOCK_SCALE : 1);
            // The lock fade times the dissolve: a locked badge dissolving is 60% of what it
            // would have been, not 60% again from wherever the dissolve had got to.
            const base = stop.state === 'locked' ? LOCK_OPACITY : 255;
            stop.opacity.opacity = Math.round(base * shown);
            stop.node.setPosition(c.x, y, 0);
            stop.node.setScale(scale, scale, 1);
        }
        this.updateScrollHint();
    }

    /**
     * How much of a stop is left, for a stop at rail-space `y`: 1 well below the bar, 0 at it.
     *
     * RAIL SPACE, NOT CANVAS SPACE, which is the one thing to get right here. `y` is measured
     * from `railRoot`, which sits at `railCenterY()` -- a stop's canvas y is `railRoot.y + y`.
     * Comparing `y` against `barBottom` directly would be out by the whole rail centre, which on
     * a tall phone is about 43 units and on a short one several hundred: the badges would
     * dissolve in the wrong place, in a way that looks like a tuning problem rather than a
     * coordinate mistake. So the bar is converted INTO rail space once, here, rather than every
     * stop being converted out of it.
     *
     * The ease is `rampSprite`'s own smoothstep, which is what the scroll hint uses too -- see
     * CHEVRON_D. A linear fade reads as a badge being turned down; this one reads as a badge
     * going away.
     */
    private topFade(y: number): number {
        const bar = this.barBottom - this.railRoot.position.y;
        const t = Math.max(0, Math.min(1, (bar - y) / STOP_FADE_H));
        return t * t * (3 - 2 * t);
    }

    /**
     * Fade the scroll hint by how much rail is left ABOVE it -- see `CHEVRON_D`.
     *
     * `remaining` is the offset still between here and the LAST stop, `railOffset(levelCount -
     * 1)` being the offset that centres it: at 0 the rail has scrolled all the way to the final
     * level and there is genuinely nothing left above to hint at. Ramped over the last
     * `HINT_FADE_H` of that with the exact smoothstep the badges dissolve on -- `rampSprite`
     * texture, so the hint eases out in step with the fade rather than switching off underneath
     * it. Above `HINT_FADE_H` of rail left, `t` clamps to 1 and the hint sits fully in.
     */
    private updateScrollHint(): void {
        if (this.levelCount === 0) {
            this.scrollHintOpacity.opacity = 0;
            return;
        }
        const remaining = Math.max(0, railOffset(this.levelCount - 1) - this.offset);
        const t = Math.min(1, remaining / HINT_FADE_H);
        this.scrollHintOpacity.opacity = Math.round(t * t * (3 - 2 * t) * 255);
    }

    show(): void {
        this.root.active = true;
        // Restarted here rather than left to the caller. `GameController.showHome` does call
        // `setProgress` immediately before this, so in practice the breath is already running --
        // but a screen that only animates because of what its caller happens to do next is one
        // refactor away from a badge that sits still.
        this.setBreathing(this.breathing);
        // To the front. Seat chips and tunnel badges are appended to the canvas as a level
        // runs, which makes them later -- and so higher-drawing -- siblings than anything
        // built at startup. The HUD's panels raise themselves for the same reason.
        this.root.setSiblingIndex(this.root.parent!.children.length - 1);
    }

    hide(): void {
        this.root.active = false;
        // Stop what this screen started. The rest of the file already does this for the gate
        // arm and the loading fade; the breath and the toast are the tweens left ticking off
        // screen otherwise. `breathing` is deliberately NOT cleared -- it is what the save
        // says, not what is currently running, and `show` reads it back. The toast has no
        // such memory to preserve: it is a one-shot reaction to a tap, not a fact about the
        // save, so it is simply stopped and hidden.
        Tween.stopAllByTarget(this.breath);
        Tween.stopAllByTarget(this.toastFade);
        this.toastNode.active = false;
    }

    open(): boolean {
        return this.root.active;
    }

    // --- the gesture -------------------------------------------------------------------

    /**
     * A press landed. `t` is a clock in seconds; only differences matter.
     *
     * The drag takes hold of the DRAWN offset rather than the target, so grabbing the rail
     * mid-glide catches it where it visibly is -- taking hold of a moving thing and having
     * it jump is the single thing that makes a drag feel broken.
     */
    beginDrag(uiY: number, t: number): void {
        if (this.waiting || this.levelCount === 0) return;
        this.dragging = true;
        this.dragFromY = uiY;
        this.dragBase = this.offset;
        this.lastY = uiY;
        this.lastT = t;
        this.travelled = 0;
        this.vel = 0;
    }

    /** Whether a finger is currently on the rail. Lets the caller skip work per mouse move. */
    isDragging(): boolean {
        return this.dragging;
    }

    moveDrag(uiY: number, t: number): void {
        if (!this.dragging) return;
        this.travelled += Math.abs(uiY - this.lastY);
        // Negated once, here, and the sign survived the turn from a horizontal rail
        // unchanged. A finger moving DOWN has to bring LATER levels to the middle, because
        // later levels are drawn ABOVE and pulling the road down is what walks up it -- and
        // a downward drag is a falling uiY, so the same subtraction that used to mean "left"
        // now means "down". Nothing downstream thinks about the sign again.
        this.offset = railRubber(this.dragBase - (uiY - this.dragFromY), this.levelCount);
        this.target = this.offset;
        const dt = t - this.lastT;
        if (dt > 0.001) this.vel = -(uiY - this.lastY) / dt;
        this.lastY = uiY;
        this.lastT = t;
    }

    /**
     * The press ended. Says whether it was a tap or a drag, and the caller uses that to
     * decide whether the release also counts as a click.
     *
     * A release that travelled more than DRAG_SLOP must NOT also be treated as a tap, or
     * every swipe would end by selecting whatever it stopped over.
     */
    endDrag(t: number): 'tap' | 'slid' {
        if (!this.dragging) return 'tap';
        this.dragging = false;
        if (this.travelled < DRAG_SLOP) {
            // A wobble, not a drag: put the rail back on the stop it was aiming at -- the
            // offset may have drifted a unit or two under the finger -- and let the tap out.
            this.setFocus(railNearest(this.offset, this.levelCount));
            return 'tap';
        }
        // Stale velocity is worse than none: a finger that slid, stopped, rested and then
        // lifted must not fling the rail on the speed it had a second ago.
        const fresh = t - this.lastT < 0.12 ? this.vel : 0;
        this.setFocus(railFlick(this.offset, fresh, this.levelCount));
        return 'slid';
    }

    // --- the top bar ------------------------------------------------------------------

    /**
     * Forwarded to the bar rather than exposing it, so `GameController` talks to one screen
     * object. The bar is STANDING, so none of these consults `waiting` the way the rail's own
     * hit tests do -- the gear, the check-in place and the coin pill mean the same thing while
     * the barrier is down as they do after it lifts.
     *
     * ALL SIX OF THEM, and that is not tidiness. `hitsCheckin` can only ever answer true once
     * `setCheckin` has populated the place, and the handler it was given is only reachable
     * through `tapCheckin`; `hitsCoins` answers unconditionally but `tapCoins` is a no-op until
     * an ad unit exists (see `TopBar.coinTap`) -- forwarding a subset would leave a caller
     * holding one end of a protocol with no way to reach the other end.
     */
    setCoins(n: number): void {
        this.topBar.setCoins(n);
    }

    hitsGear(ui: Vec3): boolean {
        return this.topBar.hitsGear(ui);
    }

    hitsCheckin(ui: Vec3): boolean {
        return this.topBar.hitsCheckin(ui);
    }

    tapCheckin(): void {
        this.topBar.tapCheckin();
    }

    /** The merged coin/free-coins pill. See `TopBar.coinTap` for why tapping it does nothing. */
    hitsCoins(ui: Vec3): boolean {
        return this.topBar.hitsCoins(ui);
    }

    tapCoins(): void {
        this.topBar.tapCoins();
    }

    /** Show or hide the check-in place's unread dot. */
    setCheckinDot(on: boolean): void {
        this.topBar.setCheckinDot(on);
    }

    /**
     * Put the check-in entry in the bar's one reserved place. Called once, from the controller.
     *
     * ONLY ONE ENTRY NOW. The bar used to reserve two places -- check-in and free-coins -- and
     * this method filled both; the free-coins place is gone, merged into `TopBar`'s own coin
     * pill (see its `coinTap`), so there is only one external icon left to hand over. The
     * argument that used to live here about the free-coins place drawing without a handler moved
     * with it -- see `TopBar.coinTap` for the argument, not a second copy of it.
     */
    fillCheckin(onCheckin: () => void): void {
        this.topBar.setCheckin({ icon: this.buildCheckinIcon(), onTap: onCheckin });
    }

    /**
     * 签到: a calendar leaf -- a pale page under a darker head, with two rings on the head.
     *
     * DRAWN, not typed, the same rule the padlock and the gear follow: a glyph one font
     * substitution away from a hollow box is not an icon. At this size the calendar is three
     * rectangles and two dots, which is as much detail as this disc carries.
     */
    private buildCheckinIcon(): Node {
        // The same three plates, the same lift and the same rim as the gear above it -- all
        // four numbers imported from `top-bar`, which is the file that decides what the column
        // looks like even though this is the file that draws this one control.
        const { holder, face } = toonDisc(
            'CheckinIcon', CHECKIN_D, CONTROL_PLATES, COL_LIFT, COL_STROKE,
        );
        const page = roundedSprite('page', CAL_W, CAL_H, Color.WHITE, 6);
        face.addChild(page);
        page.setPosition(0, -CAL_RING_D / 2, 0);
        const head = roundedSprite('head', CAL_W, CAL_HEAD_H, CONTROL_BASE, 6);
        page.addChild(head);
        head.setPosition(0, CAL_H / 2 - CAL_HEAD_H / 2, 0);
        for (const side of [-1, 1]) {
            const ring = dotSprite('ring', CAL_RING_D, Color.WHITE);
            page.addChild(ring);
            ring.setPosition(side * CAL_W / 4, CAL_H / 2, 0);
        }
        return holder;
    }

    /**
     * Whether `ui` (UI-space) landed on the start button. The button is always live once the
     * screen is up -- see `setCurrent` -- so this only guards the screen's own state.
     */
    hitsStart(ui: Vec3): boolean {
        if (!this.open() || this.waiting) return false;
        const p = this.startBtn.worldPosition;
        return Math.abs(ui.x - p.x) <= START_W / 2 + TAP_PAD
            && Math.abs(ui.y - p.y) <= START_H / 2 + TAP_PAD;
    }

    /**
     * Which stop `ui` landed on, 0-based, or -1 for none. A tap on a stop brings it to the
     * middle; it does NOT start the level, which is the button's job alone.
     *
     * Measured against the badge's DRAWN size, which is now its STATE's size: only the current
     * level is scaled, and only it can change size while a finger is on the screen. The
     * paragraph that used to sit here reasoned about a resting size that shrank with distance
     * from the middle, and that no longer exists -- see NODE_D. See the box itself below for
     * why no two of them can ever meet.
     *
     * NOTHING ABOVE `barBottom` ANSWERS, AND THIS METHOD NO LONGER SAYS SO. It used to carry an
     * explicit `ui.y > this.barBottom` refusal, and that refusal was not tidiness: `layout()`
     * culls a stop only at 0.75 of the screen height, which is far above the bar -- deliberately,
     * so a stop can still be drawn while it is on its way out -- and an opaque cap used to cover
     * everything from `barBottom` upward. Between those two lines sat badges that were completely
     * invisible and still taking taps. Worked on a 19.5:9 phone (h = 2770) with a typical capsule
     * (bottom 80 of 812) at offset 0: `barBottom` lands at about 978, the rail centres on about
     * -43, and stop 5 sits at 4 * 290 - 43 = about y 1117 -- some 139 units up under the cap,
     * well short of the 2078 `layout()` culls at. A tap on the empty middle of the top bar
     * scrolled the rail to a level nobody could see, and the button under it re-labelled itself
     * to match.
     *
     * THE CAP IS GONE AND THE RULE IS NOW ENFORCED BY THE THING THAT DRAWS. `layout()` eases each
     * stop out across `STOP_FADE_H` and switches it OFF the moment that ease reaches zero, which
     * is exactly at `barBottom` -- so the `active` test below already refuses everything the
     * explicit bound used to, and a second copy of the rule could only drift away from the first.
     * Same rule as `TopBar.hitsCheckin`, `hitsGear` and the HUD's `inBox`: what cannot be seen
     * does not answer. A badge straddling the line keeps the half of it that is showing.
     */
    hitsStop(ui: Vec3): number {
        if (!this.open() || this.waiting) return -1;
        for (let i = 0; i < this.stops.length; i++) {
            const stop = this.stops[i];
            if (!stop.node.active) continue;
            const p = stop.node.worldPosition;
            // ONE `half`, because the badge is a circle: the two axes are the same measure
            // again, which they were not while it was a pill. Squared off rather than tested
            // radially, which makes the corners of the box slightly generous -- and a hit box
            // that is a touch forgiving at the corners is the right side to err on for a target
            // a thumb is aiming at. The widest it ever gets is the breathing badge's 90.6,
            // against the 145 that is half of `RAIL_PITCH`, so no two boxes can ever meet in the
            // middle and claim the same tap.
            const half = (NODE_D * stop.node.scale.x) / 2 + TAP_PAD;
            if (Math.abs(ui.x - p.x) <= half && Math.abs(ui.y - p.y) <= half) return i;
        }
        return -1;
    }
}
