import { Color } from 'cc';
import { BOARD_TILT } from './board-layout';
import { KEY_LIGHT_PITCH_DEG } from './environment';

/**
 * Where shadows fall, how dark they are, and what colour. One place, because the scene had six
 * answers to those three questions and they disagreed.
 *
 * WHAT WAS WRONG, and the first one is the reason this file exists:
 *
 *  1. THE DIRECTION WAS CONTRADICTORY. `car-builder` derived its contact shadow's offset from
 *     the key light and the board's tilt -- correctly -- and threw it UP the screen. Every panel
 *     shadow in the scene was a hard-coded `y - DROP` and threw DOWN, three to six times as far.
 *     Two opposite light sources in one picture, which is the kind of thing that reads as "the
 *     art is a bit off" without ever resolving into a nameable fault.
 *
 *  2. THE COLOUR CAME IN TWO FAMILIES. Panels used (24, 34, 56) -- a cool near-black biased the
 *     same way as the board. The cars and the whole crowd used FLAT BLACK. hud-view's PILL_BASE
 *     note already had the rule written down ("a neutral shadow under a white plate reads as
 *     dirty; a shadow biased the same way as the surface it falls on reads as a shadow") -- the
 *     blob shadows just never followed it.
 *
 *  3. ALPHA WAS SIX SEPARATE HAND-TUNINGS. 30, 34, 42, 45, 46 -- close enough that most of them
 *     were probably reaching for the same value, far enough apart to guarantee they would keep
 *     drifting.
 *
 * WHAT THIS DOES NOT COVER: the HUD's shadows (PROMPT_SHADOW, TUNNEL_CHIP_SHADOW). Those are 2D
 * sprites on the UI canvas, which has no board tilt and no key light -- the geometry here is
 * meaningless for them, and they are left alone deliberately rather than overlooked.
 */

/**
 * The one shadow ink. Cool and board-biased, not neutral: see point 2 above.
 *
 * The alpha is supplied per use, so this carries none -- a Color with a misleading alpha field
 * sitting in a module that also exports alphas is a trap worth not setting.
 */
export const SHADOW_INK = new Color(24, 34, 56);

/**
 * Standard shadow opacity. The five values it replaces sat at 42-46 apart from the lot's 30, so
 * this is very nearly what the scene already had -- the point is that it is now ONE number that
 * moves everything, not five that move independently.
 *
 * A caller may pass its own, and `setupStage` does. Doing that should come with a reason.
 */
export const SHADOW_ALPHA = 44;

/**
 * Opacity for the contact shadows under cars. CARS ONLY -- `blobShadow` has exactly one caller,
 * `car-builder`, and nothing else in the scene wears one.
 *
 * That fact is worth stating because the file it lives in says otherwise. blob-shadow's header
 * describes "each car/passenger" carrying an ellipse, and pax-figure's renderers carry a note
 * about the board painting blob shadows for the crowd. Neither is true and neither ever was in
 * this version of the scene: the crowd has no contact shadow at all. An earlier pass through
 * these files took those comments at their word, reasoned about 256 passenger shadows on the
 * white track, and concluded that this alpha was pinned between two backgrounds it could not
 * both serve. It is not pinned. The only surfaces it lands on are the ones cars drive and park
 * on, and all of them are dark.
 *
 * SO IT IS SET BY ONE MEASUREMENT: 30 units of separation on the lot, which is what the contact
 * shadows had before the lot darkened (the old pale lot at 170.5 under flat black at 45). The
 * lot dropped to 101.8 when the scene split into pavement and asphalt and took the shadows down
 * to 18 with it -- an edge going quiet, flagged in scene-stage's header at the time and left
 * uncompensated only because of the phantom constraint above.
 *
 * On the surfaces cars touch, at 112: asphalt 30.0, ring road 25.9, stall pad 23.4. The outlier
 * is the bay TRAY at 68.3, which is the pale slab around the stalls -- a car parks inside the
 * dark pad, so only the fringe of its shadow reaches the tray, and there are seven stalls rather
 * than eighty-nine cars. Watch it there if anywhere.
 *
 * HIGHER THAN `SHADOW_ALPHA` BECAUSE IT MUST BE, not because contact shadows want to be darker:
 * flat ink at alpha `a` separates by `(bg - 33.6) * a/255`, so the darker the floor, the more
 * alpha the same visible weight costs. The panels' 44 works because most of them lie on pavement
 * at 199. These lie on asphalt at 102.
 */
export const CONTACT_ALPHA = 112;

/**
 * How high something reads as floating above the board, in world units.
 *
 * DECLARED VISUAL HEIGHT, NOT PHYSICAL THICKNESS, and the ordering gives that away: the lot is
 * the FLATTEST thing in the scene -- asphalt laid on a street -- and it sits highest here, above
 * the parking tray that genuinely is a raised slab. That is not an oversight.
 *
 * The reason is area. A drop shadow is read as the sliver showing past an edge, and the sliver
 * has to stay in some proportion to the edge casting it, or the largest panel on screen ends up
 * with the thinnest shadow (the note on the lot's old LOT_DROP made this argument when it was a
 * standalone constant). These numbers are chosen so the offsets come out near what each panel
 * was already using, because the only intended visual change in this unification is the
 * DIRECTION -- see `shadowThrow`.
 */
export const LIFT = {
    /** Cars and passengers. What `car-builder`'s SHADOW_LIFT has always been. */
    contact: 0.06,
    /** The passenger track and its feeder channels. */
    ribbon: 0.19,
    /** The parking bay's raised tray. */
    tray: 0.30,
    /** The lot. Biggest panel on screen; see the note above on why biggest also means highest. */
    surface: 0.38,
} as const;

/**
 * The board-Y offset of the shadow cast by something `lift` above the board. ADD it to the
 * caster's own y; a POSITIVE result means the shadow sits further UP the screen.
 *
 * THE SIGN IS THE WHOLE POINT, AND IT IS EASY TO GET BACKWARDS. A point `h` above the board
 * lands at `-h * L.xy / L.z` in BOARD space -- board space, not world, because the light is a
 * scene node and the board is what tilts under it, so the two frames differ by exactly the tilt.
 * That works out to `-h * tan(-pitch - tilt)`. With the shipped pitch of -18 and tilt of 38 the
 * angle is -20 degrees and the tangent is negative, so the leading minus makes the whole thing
 * POSITIVE: every shadow in this scene throws UP the screen.
 *
 * That is not an accident of the numbers and not a bug -- `KEY_LIGHT_PITCH_DEG`'s own note works
 * it out and explains why it does not matter (the caster stands above the board, the tilt
 * already separates them, and the shadow reads as plainly below the object whichever way it
 * leans).
 *
 * THE MINUS IS CARRIED HERE, INSIDE THE FUNCTION, on purpose. `car-builder` used to compute the
 * tangent into a local called `throwDown` and then apply `-throwDown` at the call site -- correct,
 * but it reads as though the shadow goes down, and it is the reason this unification was nearly
 * done in the wrong direction. There is one sign convention now and it is stated in the first
 * line above.
 *
 * SO THE PANELS WERE ALL THROWING THE WRONG WAY, and fixing them is a VISIBLE change: every
 * panel shadow in the scene moves to the opposite edge. Their DISTANCES barely move -- the LIFT
 * values were picked to reproduce what each panel already used, to within 0.002 -- so the flip
 * is the only thing to look for. That is the cost of having one light instead of two, and it was
 * taken deliberately.
 *
 * Derived rather than stored, so moving the key light or the board's tilt moves every shadow
 * together. Changing either used to move exactly one of them.
 */
export function shadowThrow(lift: number): number {
    return -lift * Math.tan((-KEY_LIGHT_PITCH_DEG - BOARD_TILT) * Math.PI / 180);
}
