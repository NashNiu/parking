import { Color } from 'cc';

/**
 * Shared colours, read by more than one view. It exists because the lobby is being redrawn as
 * a flat street that has to use "the same colours and materials as the board" -- and the
 * alternative to a shared file is the lobby keeping its own copy of these numbers, which is how
 * two palettes drift apart.
 *
 * That is not hypothetical here. GROUND's own docblock below already records two occasions
 * where a DIFFERENT surface had to be re-tuned by hand just to keep reading correctly once
 * GROUND moved -- BAND_SHADOW's alpha went from 34 to 46 in track-view, and CONTACT_ALPHA was
 * raised to 112 -- both fixes living in other files, tracking this one by memory rather than by
 * import. And `environment.ts:84` carries a comment saying the ambient light's warmth ought to
 * follow GROUND but that "nothing here reads scene-stage to keep them in step" -- a second
 * coupling left as a comment because there was nothing importable to read.
 *
 * This file does not fix either of those couplings by itself, and `environment.ts` is untouched
 * here -- but the coupling is now EXPRESSIBLE: anything that wants to track GROUND, ROAD or the
 * rest can import the same constant instead of writing down a copy of the number and a promise
 * to remember it.
 */

/**
 * They read light to dark in that order: ground, lot, road. The ground carries the whole
 * palette's floor, so it cannot go much lighter than this — the passenger track is white,
 * and against the first version's near-white ground it disappeared.
 *
 * TWO THINGS MOVED, and it was the second that mattered. The saturation came down from about
 * 45% to 11%: the floor used to be a blue surface and six saturated car colours had to fight it
 * for the eye. That was worth about 7 dE on its own -- a change you can see side by side and
 * cannot see from memory. It shipped once by itself and came back as "looks like nothing
 * changed", which was a fair reading.
 *
 * What actually held the cars back was LUMINANCE, and measuring it needs the car's WALL colour
 * rather than anything in colors.ts: the wall is `lighten(c, 0.24)` (see car-mesh) and so a good
 * deal brighter than the base hue. Those six walls sit at 141 red, 157 blue, 158 purple, 191
 * green, 196 cyan, 217 yellow. The ground was 214. A YELLOW CAR STOOD 3 LUMINANCE UNITS OFF THE
 * FLOOR IT WAS PARKED ON -- same brightness, told apart by hue alone -- with green at 23 and
 * cyan at 18 not far behind. No amount of draining the blue out fixes that; only moving the
 * floor does.
 *
 * It is 177 now, which puts the nearest car 15 units away instead of 3. The number is not free
 * to choose: six car luminances leave only two gaps wide enough to sit in, 170-180 and 120-130,
 * and anything between them lands on a colour (190 hits green, 160 hits blue and purple). This
 * is the light end of that pair, because a pale floor is what was asked for.
 *
 * DOWN is also the safe direction for the note above -- a darker floor gives the white passenger
 * track MORE to sit against, not less. The one thing it costs is the contact shadows, which are
 * a flat black alpha and so fall from 38 units of separation to 31; still read, not re-tuned.
 *
 * ---
 *
 * THE FLOOR IS TWO FLOORS NOW, and the paragraph above is why it had to become two rather than
 * move again. Everything it says is still true and still binding -- it is just that ONE surface
 * cannot satisfy it twice, because the two halves of this screen hold different things:
 *
 *   - The lower half holds CARS. Its contrast problem is the one measured above, and the answer
 *     is the dark end of the range rather than the light one.
 *   - The upper half holds the PASSENGER TRACK, which is white, and the crowd standing on it.
 *     Its contrast problem is the opposite one -- it wants the floor dark, but only relative to
 *     white, and it has no cars on it at all to collide with.
 *
 * So the rule the whole palette now follows is: DARK IS WHERE CARS GO, LIGHT IS WHERE PEOPLE GO.
 * Lot and roads take the dark end; ground and grid go lighter and cooler than they were. The
 * parking bay already worked this way before anything here changed -- its stall pads are
 * (76, 87, 115) and the cars park INSIDE those, not on the pale tray around them -- so this is
 * the rest of the scene catching up with a rule one component already followed.
 *
 * MEASURE IT OFF THE ROOF, NOT THE WALL, and this correction matters more than the repaint it
 * was found during. The paragraph above measures WALLS because the wall is the brighter surface
 * and so looked like the conservative choice. It is the wrong surface: this camera is
 * ORTHOGRAPHIC and the board is tilted well back (BOARD_TILT), so what fills a car's area is
 * its ROOF, with only a sliver of wall showing under it (car-mesh's header opens by saying
 * exactly this). And the roof is not lightened at all -- DOME_PROFILE's note is explicit that
 * the crown is the palette colour and nothing else -- so the numbers to clear are colors.ts's
 * own, which at the time of this repaint were 120.5 red, 125.1 blue, 139.5 purple, 155.1 green,
 * 165.9 cyan, 203.4 yellow.
 *
 * Those sat LOWER and CLOSER TOGETHER than the walls, which moves the safe floor down and makes
 * the wall-based reading optimistic rather than conservative -- the opposite of what it was
 * picked for. Read the old lot (170.5) that way and its nearest car was CYAN at 4.6 units, not
 * purple at 12.5: a cyan bus was all but the same brightness as the tarmac it stood on, and the
 * wall measurement could not see it.
 *
 * WHAT IT BOUGHT, measured off those roofs: the worst car-against-floor contrast went from 4.6
 * (cyan) to 18.7 (red), with blue next at 23.3 and everything else far clear. The floor moved
 * AWAY from the car palette instead of trying to find a gap inside it, which is the only move
 * that helps all six at once.
 *
 * THE PALETTE HAS SINCE MOVED TOO, and it moved the same way, so the two are not in tension.
 * colors.ts was rebuilt in HCL shortly after this (its header has the reasoning) and the roofs
 * now clear this floor by: red 24.1, blue 29.2, purple 44.1, green 54.7, cyan 71.1, yellow
 * 94.3. Red is tightest again at 24 -- the rebuild spent its budget on CHROMA rather than on
 * luminance headroom, deliberately, because an intermediate version that maximised headroom
 * for all six shipped and was reported as foggy (colors.ts's header has that story). A
 * saturated car at 24 reads better on this floor than a pale one at 40. Kept because the
 * METHOD is the durable part: measure roofs, not walls.
 *
 * 101.8 IS NOT THE DARKEST AVAILABLE, and whichever car is nearest is the number to watch.
 * Below about 100 the gain slows while the lower half of the screen keeps getting heavier, and
 * the roofs are LIT where this panel is not, so they render brighter than their base figures --
 * the true margin is wider than anything quoted here. If a car reads flat on a device, this is
 * the constant to move, and down is the direction.
 *
 * WHAT IT COST, and these are the two to look at on a device first, in this order:
 *
 *   1. The white track now stands 56 luminance units off the ground instead of 78. That is the
 *      "first version's near-white ground" failure from the top of this comment, spent down
 *      deliberately rather than stumbled into -- 56 is still a clear read, but it is the least
 *      headroom in this file and it is what any further lightening of GROUND spends next.
 *      BAND_SHADOW went from 34 to 46 alpha to hold the ribbon up; see its note in track-view.
 *   2. The cars' CONTACT SHADOWS. The paragraph above already flagged these once as falling
 *      from 38 units of separation to 31 -- halving the floor took them to 18, because a flat
 *      alpha scales with what it lands on. FIXED SINCE, by raising CONTACT_ALPHA to 112, which
 *      puts them back at 30 on this floor.
 *
 *      It stayed broken for a while on a constraint that did not exist: blob-shadow's header
 *      claimed the crowd wore the same shadows, so raising the alpha looked like it would
 *      dirty 256 figures on the white track. `blobShadow` has one caller and it is cars. The
 *      lesson is the ordinary one -- a comment is not a call graph.
 *
 * Both were edges going quiet, and both were found by arithmetic rather than by looking.
 */
export const GROUND = new Color(189, 200, 218);
/**
 * Paving seam: a shade DARKER than GROUND, not a lighter tint drawn over it. It was 224,232,247
 * -- white lines on top of the surface -- and an overlay in FRONT of the floor competes with the
 * cars in front of that, which is what "the grid is too hard" was about.
 *
 * Sinking it under the surface turns it into a joint between slabs, which is a thing a parking
 * lot actually has, and it costs half the contrast on the way: the old line stood 17 luminance
 * units off the ground, this one sits 12 under. With the wider pitch below, the plane keeps a
 * texture that catches the tilt and loses the pattern that read as graph paper.
 *
 * It tracked GROUND up and cooled with it (was 161,167,178 at 10 under). The seam is now the
 * only thing drawn on the upper half besides the track and the crowd, so it carries the whole
 * "this is a place" job up there on its own -- which is the argument for 12 rather than the
 * old 10, and the argument against any more than 12: a seam that reads as a GRID is the graph
 * paper this constant already failed into once.
 */
export const GRID_LINE = new Color(176, 188, 208);
/**
 * The lot, six units under the ground and BEHIND the grid, which is a change of kind rather
 * than of shade. It was 190,200,226 -- fifteen units under -- and it sat in FRONT of the grid,
 * so the lower half of the screen was a large flat panel of a different colour with no grid on
 * it while the upper half was gridded. Reported, twice, as the background not carrying on: once
 * about the top of the screen (which was the ground panel falling short; see `setupBackground`)
 * and once about the bottom, which was this.
 *
 * Now the grid runs unbroken from the top of the frame to the bottom and the lot is a faint
 * tint under it, still bounded by its dashed border. Six units is enough to see when you look
 * for the play area and not enough to read as a second background.
 *
 * ITS DROP SHADOW WENT WITH IT. A panel you can barely see cannot be lifted off anything, and
 * a shadow under an invisible edge reads as dirt. The parking bay above still has one, and
 * should -- that panel is genuinely a raised tray.
 *
 * ---
 *
 * ALL THREE OF THOSE DECISIONS ARE REVERSED, and the paragraphs above are kept because the
 * reversal only holds while the reason they gave has stopped applying. It is 97 units under the
 * ground rather than six, it sits IN FRONT of the grid again, and the drop shadow is back.
 *
 * The bug those paragraphs fixed was real: a panel FAINTLY different from the background, with
 * no grid on it, reads as the background failing to carry on. Note what actually made it read
 * that way -- not the difference, but the SIZE of the difference. Six units is too much to be
 * nothing and far too little to be something, so the eye files it as a rendering fault. The fix
 * available at the time was to push it toward nothing, and that is what "faint tint under the
 * grid" is.
 *
 * This pushes it the other way instead, to 97, which is the distance at which it stops being a
 * panel of slightly-wrong background and becomes a SURFACE: asphalt laid over the street. A
 * surface is allowed to interrupt the paving grid -- that is what laying something over
 * something means -- and it is allowed to cast a shadow, because you can see its edge now. The
 * earlier note is exactly right that an invisible edge's shadow reads as dirt; this edge is not
 * invisible.
 *
 * THE COLOUR IS NOT FREE TO CHOOSE. Every car on the board stands on THIS surface, so it is the
 * one constant in the file the car palette actually constrains, and the header's revised
 * measurement -- off ROOFS, which is what an orthographic camera on a tilted board mostly shows
 * -- is what sets it. The roofs run 125.9 red, 131.0 blue, 145.9 purple, 156.5 green, 172.9
 * cyan, 196.1 yellow (see colors.ts, which was rebuilt against this floor); at 101.8 the
 * nearest is red at 24.1.
 *
 * A FIRST PASS PUT IT AT 119 AND THAT WAS WRONG BY A LOT, which is worth leaving here because
 * the error was invisible from the wall numbers: 119 clears the nearest WALL (red, 141) by 22
 * and looks perfectly safe, while sitting 1.1 units off the red ROOF and 5.7 off the blue one
 * (those being the roofs of the palette in force at the time; colors.ts has since moved).
 * A red bus would have been the same brightness as the tarmac, told apart by hue alone, which
 * is precisely the failure the header opens by describing -- rediscovered from the other end of
 * the range, one surface later.
 */
export const LOT = new Color(95, 102, 118);
/**
 * Off-white, HELD AT +47 LUMINANCE over the lot -- which is what it measured back when the floor
 * was pale and this was pure white. That +47 was never a designed number: the lot was at 208 and
 * white is where the channel stops, so it is simply what fell out. It is also the version nobody
 * ever complained about, which is what makes it worth keeping deliberately.
 *
 * Dropping the floor to 177 would have handed a white dash +76 for nothing, and a brighter
 * boundary drawn around the whole play area is the opposite of what "lower the background's
 * contrast" asked for. The border still has to be READ -- it is the one background element
 * carrying information -- and +47 is what reading it costs. Nothing is gained by spending more.
 *
 * THE +47 IS GONE AND WAS NOT REPLACED BY ANOTHER RULE. The lot dropped 51 units under it, so
 * the dash now stands +110 over it where it stood +47. It came down a little, to 211, and that
 * is the point: the dash barely moved, the floor did.
 *
 * What changed is what the dash IS. At +47 on a pale lot it was a boundary marker, and the
 * argument above -- buy only the contrast needed to read it -- was the right one for a marker.
 * On asphalt a white dashed line is not a marker, it is the thing car parks are painted with,
 * and the reason to keep it bright is that it is now carrying the "this is a car park" read
 * almost single-handed. So it is held near white and the ratio is a consequence, not a target.
 */
export const LOT_DASH = new Color(206, 212, 224);
/**
 * Down with the lot, and kept just UNDER it (93 against 102) so the ring road reads as the same
 * asphalt, slightly shaded, rather than as a third surface. The two used to differ by 35, which
 * was a lot to spend on telling apart two things that are both "ground the cars drive on".
 *
 * Cars only cross this, never rest on it, so the roof clearances that bind LOT are slack here --
 * the nearest is red at 28.
 */
export const ROAD = new Color(86, 93, 108);
/** Held at the +69 it had over ROAD, for the reason spelled out on LOT_DASH. */
export const ROAD_LINE = new Color(156, 162, 176);
/**
 * THE ONE DELIBERATE DEPARTURE FROM shadow.ts's `SHADOW_ALPHA` (44), and the area is the whole
 * argument. This shadow is about fifteen times the bay's, spread across the one part of the
 * screen that is meant to read as open pavement, and at 44 that much translucent ink stops being
 * an edge and becomes a smudge the lot is sitting in. It separates by 19.4 against the pavement
 * where the baseline would give 28.5, and the edge still reads because it is against the
 * lightest surface in the scene.
 *
 * RENAMED FROM `LOT_SHADOW_ALPHA` to `AREA_SHADOW_ALPHA`, not to `SHADOW_ALPHA`: the departure
 * is about AREA, not about which object owns the shadow -- a large area needs less ink before it
 * reads as a smudge rather than an edge, which is exactly the argument above. A small shadow
 * (a tree's, say) has no reason to borrow this figure; it should take shadow.ts's standard 44
 * like everything else does, and reach for this one only when its own shadow is large enough to
 * need the same discount.
 */
export const AREA_SHADOW_ALPHA = 30;

/**
 * THE SECOND FAMILY IN THIS FILE, and it is worth saying that it is a different kind of thing
 * from everything above. `GROUND` down to `AREA_SHADOW_ALPHA` are SURFACES -- floors the camera
 * looks at, chosen against the car palette by luminance. What follows is CHROME: the colour the
 * UI's furniture is drawn in, on a layer no car is ever on. They share a file because they share
 * the one property that put this file here -- more than one view reads them.
 *
 * ONE PAIR, TWO PLATES. Every raised or framing piece of UI in this game is the same trick: a
 * brighter FACE drawn over a darker BASE peeking out below it, which is what makes a flat shape
 * read as something with a top to press (`liftedPill`, `buildCardBtn`, both gears, the card's
 * rim, the stars, the padlock). So the pair is the unit, and either one alone is meaningless --
 * that is why they are declared together and named for their roles in the pair.
 *
 * WHO WEARS IT: the settings card's rim and its close disc, the card's side buttons, the switch
 * rows' icons, the HUD's gear and the lobby's gear.
 *
 * WHY IT IS HERE RATHER THAN IN `hud-view`, which is where it was born. It was `CARD_RIM_FACE` /
 * `CARD_RIM_BASE`, private to that file and named for the settings CARD it rims; the lobby's top
 * bar then needed the same two numbers for its gear and wrote its own copy of them, with a
 * comment saying it would rather import them and that the honest home was here. Two copies of a
 * colour is how two palettes drift apart -- the same argument this file's own header opens with,
 * and the same resolution `liftedPill` got when the lobby needed the HUD's pill.
 *
 * THE NAME IS NOT `CARD_RIM_*` ANY MORE for the reason the move exists: a name that says CARD
 * is a name the lobby's gear cannot honestly import. `CONTROL_*` is what the two callers have in
 * common -- the game's chrome blue -- and it stops being a reason to write a third copy.
 *
 * THE COLOUR ITSELF is unchanged by the move, and its own history is worth keeping: it is
 * DARKER than it first was (64,172,236 over 28,112,176), asked for as 卡片外层的背景颜色再深一些.
 * The bright cyan was competing with the cream page for the eye instead of holding it -- a
 * frame's job is to be the edge of the thing, and an edge brighter than the page it frames reads
 * as the subject.
 */
export const CONTROL_FACE = new Color(42, 138, 208, 255);
export const CONTROL_BASE = new Color(20, 92, 150, 255);

/**
 * The coin, as two concentric discs: the darker edge first, the bright face on it.
 *
 * MOVED HERE FROM `top-bar.ts` when a second caller appeared -- the check-in card draws a coin
 * in each of its seven day cells. That is the same resolution `CONTROL_FACE` got two paragraphs
 * up, and for the same reason: the alternative is a second gold, one shade off, on a screen that
 * shows both at once.
 *
 * THE ORDER IS PART OF THE PAIR. Darker disc down first at the full diameter, brighter face over
 * it at about three quarters, which leaves the edge showing as a ring. Drawn the other way round
 * it is a washer, not a coin -- that was the first version, and it also inverted the layering
 * every other object in this project uses (`liftedPill`, the gear, the rail's badges all put the
 * darker plate down first).
 */
export const COIN_FACE = new Color(255, 196, 46, 255);
export const COIN_RIM = new Color(214, 152, 20, 255);

/**
 * THE LOBBY'S OWN GROUND, and it is worth saying out loud that this section breaks the rule this
 * file's own header opens with -- "the lobby is being redrawn as a flat street that has to use
 * the same colours and materials as the board". `LAWN` and `PAVING` below are NOT board colours,
 * and nothing above this line lost a caller or changed a value to make room for them.
 *
 * They exist because the lobby grew a third ground layer (grass, pavement, road in that order)
 * and the requirement asked for grass "比路面明度高 20%" (20% lighter than the road) under the
 * street. There is no green anywhere in the board's six-colour table to answer that with, because
 * no surface a car ever stands on is grass -- `GROUND` down to `ROAD_LINE` are all tuned against
 * the six car roofs in colors.ts, which is a constraint grass has no part in.
 *
 * THE ALTERNATIVE WAS OFFERED AND DECLINED. A blue-grey that stayed inside the board's family
 * could have carried the three-layer read on hard edges alone -- a lighter band, a darker band,
 * then `ROAD` -- spending no new hue at all. The user was shown that option and chose a real
 * green instead, accepting explicitly that the lobby's ground and the board's ground no longer
 * come from one shared table. That is a DECISION, made on purpose, not a leak: if a later reader
 * finds a green sitting in an otherwise blue-grey file and "restores consistency" by deleting it,
 * they are undoing a choice the user made, not fixing one anybody made by accident.
 */

/**
 * The grass, under everything -- the lowest of the lobby's three ground layers.
 *
 * PICKED AGAINST `ROAD`, because "比路面明度高 20%" is the actual requirement it has to answer,
 * not a target for the lawn's own look. `ROAD` sits at 38.04% HSL lightness (86,93,108). Treating
 * that 20-point ask as a FLOOR rather than a number to land on exactly, this is (147,203,128): H
 * 104.8° (a yellow-green -- the hue real grass leans toward, rather than a pure 120° green, which
 * reads as a flat-design icon instead of a lawn), S 41.9%, L 64.90%.
 *
 * THAT IS 26.86 POINTS ABOVE `ROAD`, NOT 20, and it is left there rather than dimmed down to hit
 * the number asked for. A grass this light needs the saturation to stay legible as green instead
 * of washing out toward `GROUND`'s pale blue-grey, and pulling the lightness down to land closer
 * to +20 would have also closed the gap to `PAVING` (see below) below what a second layer needs
 * to read as its own band rather than a shadow on the grass.
 */
export const LAWN = new Color(147, 203, 128);

/**
 * The pavement band either side of the road -- the middle of the lobby's three ground layers,
 * and the one that has to sit visibly BETWEEN the other two or the street reads as two layers
 * wearing three names.
 *
 * THIS SCREEN HAS ALREADY FAILED THIS EXACT WAY ONCE. The old kerb was `KERB(150,161,180)`
 * painted under a 96-wide `ROAD`, against `GROUND(189,200,218)` -- an 8% lightness step -- and a
 * player photographed the result and reported the whole street as out of focus (see
 * `home-scene.ts`'s docblock on the kerb it deleted, and `core/home-path.ts:99`). A band that
 * faint is not a subtle layer; it is a rendering fault the eye cannot place, and it shipped once
 * already on this exact screen.
 *
 * SO THE SEPARATIONS HERE ARE MEASURED, NOT ASSUMED. `PAVING` is (113,122,142): H 221.4°, S
 * 11.4% -- the same blue-grey hue and near-identical saturation as `ROAD`'s own 220.9°/11.3%,
 * because pavement is concrete, not grass, and stays in the board's cool family -- at L 50.00%.
 * Against `ROAD` (38.04%) that is a 11.96-point gap; against `LAWN` (64.90%) that is 14.90
 * points. Both are comfortably wider than the 8% step that already failed here once, so neither
 * neighbour is left to guess where it ends and the next layer begins.
 */
export const PAVING = new Color(113, 122, 142);

/**
 * RGB -> HSL, each component normalised to [0,1] (`h` as a fraction of a full turn, not degrees).
 * Standard colour-space conversion, named so that `shade` below is not secretly reimplementing
 * one at the call site.
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

/** One channel of an HSL -> RGB conversion; `hslToRgb` calls this once per channel. */
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** HSL (each of `h`, `s`, `l` in [0,1]) -> RGB, each channel rounded to an integer in [0,255]. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * A colour, shifted in HSL LIGHTNESS by `dl` -- a delta on the same [0,1] scale `l` itself uses,
 * so pass `-0.2` for "L-20%" -- clamped so the result cannot leave [0,1], with hue and saturation
 * held fixed and alpha carried through unchanged.
 *
 * WHY THIS GOES THROUGH HSL AND IS NOT THREE MULTIPLICATIONS, stated carefully because the
 * obvious objection to `*0.8` is the wrong one. Scaling R, G and B by one factor does NOT
 * generally wreck saturation: in the `l <= 0.5` branch saturation is `d / (max + min)`, and both
 * halves of that scale together, so it comes out unchanged. What scaling gets wrong is the
 * LIGHTNESS ITSELF, and it gets it wrong in a way that varies by colour.
 *
 * "L-20%" is an ABSOLUTE delta on a [0,1] lightness. A `*0.8` scale is a MULTIPLICATIVE one.
 * Measured on `CONTROL_FACE` (42,138,208 -- H 205.3°, S 66.4%, L 49.02%): `*0.8` gives
 * (34,110,166), whose lightness is 39.22% -- it moved 9.8 points where 20 were asked for, and it
 * moved that far only because this colour happens to start near the middle. A face at L 80%
 * would lose 16 points to the same scale and one at L 25% would lose 5. So a fleet of outlines
 * derived by scaling would each stand a different distance from the face they rim, and the
 * badges would stop looking like one set of objects.
 *
 * `shade(CONTROL_FACE, -0.2)` gives (25,82,123): H 205.1°, S 66.2%, L 29.02% -- hue and
 * saturation held within rounding, lightness down exactly the 20 points asked for, and down the
 * same 20 whatever colour it is handed. That last property is the whole reason this is a shared
 * function rather than a multiplication at the call site.
 *
 * (Above `l = 0.5` the saturation branch is `d / (2 - max - min)`, where the denominator does not
 * scale with `d`, so there scaling moves saturation as well. The argument above does not need
 * that case and does not rest on it.)
 */
export function shade(c: Color, dl: number): Color {
  const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
  const l2 = Math.max(0, Math.min(1, l + dl));
  const [r, g, b] = hslToRgb(h, s, l2);
  return new Color(r, g, b, c.a);
}
