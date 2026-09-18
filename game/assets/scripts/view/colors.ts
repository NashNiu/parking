import { Color } from 'cc';

/**
 * The six play colours, shared by cars and passengers. Keys match the core colour strings.
 *
 * ONE VALUE SERVES TWO BACKGROUNDS, and that is the constraint the whole set is built around.
 * A car's roof is this colour exactly (car-mesh's DOME_PROFILE note: the crown is not lightened,
 * so a car and a passenger of the same colour resolve to the same albedo) and it lands on the
 * asphalt at 102 luminance. A passenger is the same colour and stands on the white track at 255.
 * So a colour too dark disappears under the cars, one too light disappears under the crowd, and
 * there is no separate knob for the two -- adding one would break the match a player reads the
 * board with.
 *
 * Built in HCL: hue spread round the circle, then CHROMA MAXIMISED at a spread of target
 * luminances. The order of those two matters and is the lesson of the version before this one --
 * see the last section.
 *
 * WHAT IT FIXES, measured against the palette this line of work started from:
 *
 *  1. HUE WAS BUNCHED AT THE TAIL. The old hues ran 30 / 87 / 145 / 203 / 285 / 314 -- even for
 *     two thirds of the way round, and then BLUE AND PURPLE 29 DEGREES APART. That pair was the
 *     worst on the board at dE 37, inside the range small shapes get confused at. Purple moves
 *     to 335, which puts it 50 from blue, and the worst pair in the set is now 63.
 *
 *  2. BLUE STAYS AT 285, and that is a correction of the version between. Moving it to 265 made
 *     the hue spacing prettier and cost it a quarter of its chroma: sRGB's gamut narrows sharply
 *     through the blues, and the ceiling runs 48.6 at h255, 53.5 at h265, 73.6 at h285. The
 *     spacing is worth less than the saturation, so blue sits where the gamut is wide and purple
 *     does the moving.
 *
 *  3. CHROMA IS THE POINT, not a constraint to satisfy. Mean chroma is 72.3 against the original
 *     palette's 67.0. On a dark floor a saturated mid-luminance colour reads harder than a pale
 *     bright one, which is why this is the axis to spend on -- see below for the version that
 *     learned it the other way round.
 *
 * CYAN IS THE ONE COMPROMISE AND IT IS THE GAMUT'S, NOT A CHOICE. sRGB is pinched in the
 * blue-green, so h203 tops out at chroma 47 at ANY lightness, where red, green and purple reach
 * 88-103. Cyan is the least saturated of the six no matter what is done, and it is given its
 * maximum rather than the cap. Its lightness is high (L* 88) for the same reason: that is where
 * its chroma peaks.
 *
 * `purple` IS NOW A MAGENTA, and the key is unchanged on purpose. The name is a core colour
 * string appearing in every level's JSON, so renaming it is a data migration for a word.
 *
 * ---
 *
 * THE VERSION IN BETWEEN WAS DESATURATED AND IT SHIPPED, AND IT LOOKED FOGGY. Worth recording
 * because the mistake was in the METHOD and would otherwise be easy to repeat.
 *
 * It capped chroma at 58 and laid luminance out as an even ladder from 130 to 198 -- built to
 * guarantee that every colour cleared BOTH backgrounds comfortably. Mean chroma came out at 55.5,
 * down 17% from the original, and the luminance range narrowed from 83 to 68. The result was
 * exactly what those two numbers predict and it was reported as "foggy": every colour was
 * adequate against both backgrounds and none was striking against either. Guaranteeing the floor
 * for all six is the same operation as flattening them toward each other.
 *
 * TWO THINGS TO CARRY FORWARD FROM IT:
 *
 *  - SPEND ON CHROMA, ACCEPT UNEVEN LUMINANCE CONTRAST. The original palette was not evenly
 *     safe -- red cleared the asphalt by only 18, yellow cleared white by only 52 -- and it did
 *     not read as foggy, because what was weak on one background was strong on the other. A
 *     palette with range has some colours anchoring each half of the screen. A flat one has none.
 *  - A SWATCH GRID LIES ABOUT A DENSE BOARD. The desaturated set was chosen off a comparison
 *     page showing six large blocks per option, where it read as pleasantly restrained. The
 *     actual board is 89 small cars packed edge to edge, where the eye averages neighbours
 *     together and saturation is most of what survives. Judge a play palette at play size.
 */
export const COLORS: Record<string, Color> = {
    red: new Color(255, 70, 75),
    blue: new Color(70, 138, 255),
    green: new Color(55, 219, 101),
    yellow: new Color(251, 200, 32),
    purple: new Color(241, 85, 210),
    cyan: new Color(0, 245, 255),
};

export function colorOf(name: string): Color {
    return COLORS[name] ?? Color.GRAY.clone();
}
