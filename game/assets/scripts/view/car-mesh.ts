import { Color, Mesh, primitives, utils } from 'cc';
import { Cap, CAP_BOX } from '../core/index';

/**
 * The car, DRAWN rather than modelled: one flat vertex-coloured mesh per body colour.
 *
 * WHY IT IS DRAWN. The camera is orthographic, so a car is its ROOF plus however much of its
 * side the board's tilt reveals -- and nothing else. That was measured on the GLB models this
 * replaces, back when the board was flat: eight of the nine primitives in the first set were
 * invisible, and in the second set the windscreen, the rear window and the hubcaps were all 0%.
 * A model authored for a 3/4 view cannot be rescued by recolouring, and a model authored for
 * THIS view is a plan with a wall round it.
 *
 * THE WALL IS REAL GEOMETRY NOW, and that is the whole point of the board being tilted. Four
 * rounds went into faking it -- a dark copy of the silhouette offset down the screen -- and it
 * could not be made to work: the offset had to be in BOARD space, because it stood for the
 * light's direction, while the wheels and everything else on the car are in the CAR's space, so
 * their relation changed with the heading. A car lying across the screen looked right; one
 * pointing up it wore the wall on its tail with the wheels stuck to the back bumper. A real wall
 * turns with the car, so every part is where it belongs at every heading, and the engine lights
 * the four sides differently for free.
 *
 * WHAT READS AS A CAR FROM DIRECTLY ABOVE, in the order the cues matter:
 *
 *   1. A ROUNDED ROOF THE REAL LIGHT CAN FIND. See DOME_PROFILE -- not baked, unlike the rest.
 *   2. ONE hue. The paint, and whatever the light does to it. A second hue anywhere reads as a
 *      decal, not as form.
 *   3. A CRISP silhouette: straight sides and ends, with only enough corner radius to take the
 *      hard point off. See the notes on CORNER_NOSE and CORNER_TAIL.
 *   4. Glass ON THE WALL, as a band round the car at window height, not panels on the roof. On
 *      a flat board the roof was the only surface there was, so the windows had to go there and
 *      read as dark holes punched in it; with a wall to put them on they read as windows. The
 *      band runs right round rather than stopping at the ends, which is what a vehicle looks
 *      like from up here and is a great deal simpler than partial rings.
 *   5. Wheels that only just show. Drawn UNDER the body, so all that appears is the sliver
 *      past its silhouette -- which is all a wheel is from above. HOW MANY of them is what
 *      tells a bus from a car; see `axles`.
 *
 * WHY THE DEPTH HAS TO COME FROM THE LIGHT AND NOT FROM BAKED SHADING. A highlight on one side
 * is a claim about where the light is, and the mesh ROTATES WITH THE CAR -- so anything baked
 * asymmetrically puts the highlight on the left of a car heading one way and on the right of a
 * car heading back. Bake it symmetrically instead and you get a centred ridge, which survives
 * being turned but reads as a bar with a stripe down it rather than as a solid. That was the
 * first version of this file, and "still not enough depth" was exactly right about it.
 *
 * A NORMAL, unlike a colour, is transformed by the node. So tilting the roof's normals buys the
 * highlight from the engine, on the correct side, for every heading, for nothing. The plates
 * stay flat to within a few hundredths of a unit -- under this camera height buys no pixels --
 * but their NORMALS sweep from tilted-outward at the rim to straight-up at the crown, and the
 * light sees a dome where there is barely one.
 *
 * The key light is at euler (-55, 0, 0) -- see `setupEnvironment` -- so it travels
 * (0, -0.82, -0.57): mostly down the screen, partly into the board. That screen-vertical
 * component is what makes this work at all. Level the key light out toward the board normal and
 * the car goes flat, with nothing in the console to say why.
 *
 * EVERY NUMBER HERE IS A FRACTION of the car's length and width, never a world size. The three
 * caps differ in length by more than 2x, and one mesh is shared across all of them: `carMesh`
 * builds in a unit box and `buildCar` scales the node to the size core says the car has. That
 * is what keeps the whole lot down to one draw call per colour.
 *
 * To judge a change to these numbers, run `python tools/car-plan.py` -- it reads the constants
 * out of this file and renders the three caps at their real aspect ratios. It APPROXIMATES the
 * lighting (Lambert against the key light's real direction, normalised so a flat plate reads as
 * authored), so trust it on direction and layout, not on exact colour. Do not tune these from a
 * phone screenshot alone; four rounds of that got the car wrong four times.
 */

type Pt = readonly [number, number];

/** The body outline, as a fraction of the car. */
const BODY_ALONG = 0.94;
const BODY_ACROSS = 0.90;

/**
 * How much the body's four corners are rounded -- and the one number here that was settled
 * ON A DEVICE rather than by the offline render.
 *
 * The body used to be an OCTAGON, its nose and tail narrower than its waist, and the reasoning
 * for it was sound as far as it went: a rounded rectangle has parallel sides, and at the size
 * the plan renderer draws it a taper is what stops the car reading as a bar. Three earlier
 * rounds of tuning a rounded-rectangle body had failed on exactly that.
 *
 * It does not survive being shrunk to a phone. A car is about forty pixels long on screen, so
 * the taper's slants are two or three pixels of diagonal on each corner -- too few to read as a
 * shape, enough to make the outline mushy. Straight sides and ends with a small radius read
 * crisper at that size, which is the size that counts. What actually carries the form at forty
 * pixels turned out to be the shading and the glass, not the silhouette.
 *
 * So: do not "restore the taper" from the offline render alone. The render is still the only
 * way to judge the shading, the glass and the arrow, but on the OUTLINE it disagreed with the
 * device and the device won. If the corners are ever revisited, look at both.
 */
/*
 * SPLIT NOSE FROM TAIL, which is the cheap half of telling one end from the other. 0.10 was one
 * radius for all four corners, and a car with equal ends has no front. The nose is rounded past
 * what the note above settled on and the tail is pulled in tighter than it, so the pair still
 * averages near the old value -- the point is the DIFFERENCE, not either number.
 *
 * IT IS WORTH LITTLE ON ITS OWN, and the note above says why: the radius divides by
 * REFERENCE_ASPECT on the way along the car, so even at 0.22 the nose's corner is about three
 * screen pixels of length. What actually carries head-from-tail is the windscreen and the tail
 * lights (SCREEN_* and TAIL_*); this only stops the SILHOUETTE arguing with them.
 */
const CORNER_NOSE = 0.22;
const CORNER_TAIL = 0.08;

/**
 * The car's real silhouette: the body outline grown a little, more across than along. It is the
 * wall's footprint, and the roof's shoulder now starts on it exactly.
 *
 * IT USED TO BE A DARK RIM -- a flat lip of paint at EDGE_SHADE 0.52, filling the gap between
 * this outline and the roof's outermost ring. That gap existed because the ring sat on the
 * ungrown body outline, so something had to cap the top of the wall. Growing the ring onto this
 * outline instead closes the gap, and the lip goes away rather than being recoloured: paint it
 * the body colour and it would have become a BRIGHT halo instead of a dark one, because it
 * faces straight up while the shoulder just inside it is tilted away.
 *
 * What it cost: two cars of the same colour parked side by side no longer have a dark line
 * between them. What separates them now is one car's wall against the other's roof, which the
 * tilt makes about a fifth of a world unit tall -- see WALL_LIFT and CAR_HEIGHT.
 */
const EDGE_GROW_ALONG = 1.015;
const EDGE_GROW_ACROSS = 1.075;

/**
 * The roof, as concentric rings of the body outline whose NORMALS tilt outward.
 *
 * `at` is how far in from the rim a ring sits, as a fraction of the total inset; `tilt` is how
 * far its normal leans away from straight up, in degrees. Consecutive rings are stitched into
 * bands and the normal is interpolated across each one, so four rings read as a single
 * continuous shoulder rather than four steps.
 *
 * THE TILTS LOOK TOO SMALL, AND THEY ARE NOT. The node's scale is non-uniform -- (len, wid, 1)
 * -- and Cocos transforms normals by the inverse transpose (`CCGetWorldMatrixFull`, which gets
 * this right under instancing too). Dividing the across component by the car's width, about
 * 0.57, AMPLIFIES the tilt by roughly 1.8x on the way to world space: 20 degrees in mesh space
 * arrives as about 33, and past 35 it saturates. Judge these by the render, never by the number.
 *
 * NOTHING IS LIGHTENED HERE, and that is deliberate. The crown is EXACTLY the colour handed in,
 * so a car and a passenger of the same colour resolve to the same albedo -- verified rather than
 * assumed: both go through builtin-standard with the same PBR parameters, and both convert sRGB
 * with the same `x * x` (Cocos uses gamma 2.0 on the CPU for a `linear: true` property and the
 * identical curve in the shader's `SRGBToLinear`). An earlier version lightened the crown a
 * little as insurance against the lighting under-delivering; the side wall covers that now, and
 * it is worth more to have the car's own colour be the palette's colour and nothing else.
 */
const DOME_NARROW = 0.36;
const DOME_RISE = 0.03;
const DOME_PROFILE: readonly { at: number; tilt: number }[] = [
    { at: 0.00, tilt: 32 },
    { at: 0.34, tilt: 22 },
    { at: 0.66, tilt: 11 },
    { at: 1.00, tilt: 0 },
];

/**
 * Wheels, low on the wall so only the overhang past the body shows.
 *
 * WHEEL_Y is what decides how much that is: at 0.40 they reached 0.51 against a rim at 0.484,
 * which was plenty while the car was a flat plan on a pale floor and almost nothing once that
 * rim became the top of a wall. 0.45 reaches 0.56 and clears it by 0.076 of the car's width.
 *
 * IN THE CAR'S OWN FRAME, which is the only frame they can be in. A version of this file put
 * them in a screen-space side wall so they would sit at the car's foot; that works for a car
 * lying across the screen and falls apart for one pointing up it, where the wall lands on the
 * car's TAIL and takes the wheels with it -- two dark blobs stuck to the back bumper. The
 * parking bay made it obvious, every stall holding a car pointing up. See the README.
 *
 * HOW MANY, and why it is per capacity. Only ONE side of a car is ever visible: the camera
 * looks at the board from up-screen, so a car lying across the screen shows the two wheels on
 * its near side and nothing of the far pair, while a car pointing up the screen shows both
 * sides in profile. That is why every vehicle read as a two-wheeler however long it was, and
 * why "the coach should have four wheels" was a request for four along ONE side. Its wheels
 * are narrower than the others' so that the several read as several rather than as a smear.
 * Small and medium keep one axle at each end.
 *
 * The count is a SIZE CUE, which is worth more than it cost: medium and big are within 11% of
 * each other in length (1.611 against 1.793, see CAP_BOX) and were hard to tell apart.
 *
 * THE COACH IS 2 + 4, NOT 4 + 4. It had four evenly spaced along each side, which is eight
 * wheels on a vehicle and not an arrangement any vehicle has. A coach has ONE axle at the
 * front and a TANDEM PAIR at the back, so that is what these three offsets are: one forward
 * wheel per side, and two behind it close enough together to read as one bogie. Six wheels,
 * which is what a coach has.
 *
 * The pair is written as a centre and a half-spacing rather than as two positions, because
 * "these two are a pair" is the thing that has to survive somebody retuning it -- two loose
 * numbers that happen to be near each other do not say that, and drift apart the first time
 * one of them is nudged.
 */
/**
 * THE OUTLINE INK: the body's own colour taken down and out -- L-20%, S+10% in HSL.
 *
 * RELATIVE, NOT ABSOLUTE. `l * (1 - drop)`, not `l - drop`: the palette's luminances run wide on
 * purpose (see `colors.ts`, which spends its whole argument on keeping that range), and
 * subtracting a fixed amount would crush the dark end of it toward black while barely touching
 * the light end. Multiplying takes the same BITE out of every colour.
 *
 * 0.45, AND IT WAS ASKED FOR AS 0.20. Twenty percent is the number you would pick for a normal
 * palette and it does almost nothing to this one, because these colours are already at or near
 * the top of their chroma (that is the entire argument of `colors.ts`) and so sit at HSL
 * saturation 0.85-1.00. Dropping L on a colour whose S is pinned at 1 mostly just walks it along
 * the same face of the cube. Measured as the ink's luminance against the paint's:
 *
 *      drop      red   blue  green yellow purple  cyan
 *      0.20      53%    67%    85%    87%    61%    80%
 *      0.45      35%    46%    58%    60%    40%    55%
 *      0.55      29%    37%    48%    49%    33%    45%
 *
 * At 0.20 the ink on GREEN and YELLOW is 85-87% of the paint -- no boundary at all, and yellow
 * is one of the two colours the arrow was reported as vanishing on, so the fix would have missed
 * exactly the case it was for.
 *
 * 0.55, up from a first pass at 0.45, and PLAY SIZE is what moved it. 0.45 holds every colour's
 * ink under 60% of the paint, which is a clear boundary in the plan renderer at 240 pixels per
 * world unit and is not one at the forty-odd a phone gives a car. Under half the paint's
 * luminance on every colour is what survives being shrunk. The spread that is left is the
 * gamut's: red and purple fall furthest because their S was already clamped and they lose only
 * L, while yellow and green get some of it back through OUTLINE_S_GAIN.
 *
 * NOT BLACK, and that is the whole point of doing it in HSL rather than lerping toward zero. A
 * black edge on a saturated toy-coloured car reads as a printing artefact -- the colour of the
 * line has nothing to do with the object. A darker, slightly MORE saturated version of the paint
 * reads as the paint turning away from the light, which is what an edge on a rounded solid
 * actually is. The S+10% is what stops the darkening washing it grey: reducing L in HSL pulls a
 * colour toward the achromatic axis, so saturation has to be given back or the edge comes out
 * muddy rather than deep.
 */
const OUTLINE_L_DROP = 0.55;
const OUTLINE_S_GAIN = 0.10;

/**
 * How much of the wall's height the skirt takes: the dark contact edge at its foot.
 *
 * THIS IS THE OUTLINE, AND IT IS ONLY ON THREE SIDES OF THE SILHOUETTE. From up here a car's
 * screen outline is its roof's far edge along the top and its wall along the bottom and sides,
 * so a skirt at the wall's FOOT draws the bottom and the sides and nothing along the top. That
 * is deliberate rather than a shortfall: what sits above a car on a packed board is another
 * car's WALL, which the tilt makes about a fifth of a world unit tall (see the note on
 * EDGE_GROW_*), so the top edge already has its separator. Drawing a dark line along the top as
 * well would be the removed rim lip again -- it faces UP, so darkening it turns it into a halo.
 *
 * 0.16 of a wall that shows 0.209 world units on screen is a bit over a pixel on a phone, which
 * is the 1-2px this stands in for. It replaces nothing: WALL_FOOT's grade still runs over the
 * wall ABOVE the skirt, so the wall reads as shaded and the skirt as its edge.
 */
const SKIRT_TOP = 0.16;

const WHEEL_X = 0.30;
const BUS_WHEEL_X_FRONT = 0.35;
const BUS_WHEEL_X_REAR = -0.265;
const BUS_WHEEL_REAR_HALF_GAP = 0.065;
const WHEEL_Y = 0.45;
const WHEEL_W = 0.15;
const BUS_WHEEL_W = 0.10;
const WHEEL_H = 0.22;
const WHEEL_R = 0.35;
const TYRE = new Color(25, 28, 34);

/**
 * Where this capacity's wheels sit along the body, as fractions of its length from the centre,
 * and how wide each one is. Mirrored across the centreline already, so the list IS one side.
 *
 * +X is the nose; see ARROW_X, which points that way. Measured against a body that spans
 * -0.47..+0.47 (BODY_ALONG halved), the coach's three clear it with 0.070 at the nose and
 * 0.090 at the tail, and its rear pair leaves 0.030 of daylight between the two tyres --
 * about a third of a tyre's own length, which is what makes them read as two wheels side by
 * side rather than as one long one.
 *
 * THE TAIL CLEARANCE IS THE NUMBER THAT WAS WRONG. The tandem sat at -0.315, which left 0.040
 * behind the rearmost tyre -- 10% of the body, so the wheels were effectively flush with the
 * back and the coach looked like it was sitting on its bumper. At -0.265 the overhang is 15%,
 * which is about what a real coach carries behind its rear axle for the engine bay, and the
 * wheelbase is still 65% of the body.
 */
function axles(cap: Cap): { xs: readonly number[]; w: number } {
    return cap === 'big'
        ? {
            xs: [
                BUS_WHEEL_X_FRONT,
                BUS_WHEEL_X_REAR + BUS_WHEEL_REAR_HALF_GAP,
                BUS_WHEEL_X_REAR - BUS_WHEEL_REAR_HALF_GAP,
            ],
            w: BUS_WHEEL_W,
        }
        : { xs: [WHEEL_X, -WHEEL_X], w: WHEEL_W };
}

/**
 * Glass: a band round the side wall, between GLASS_LOW and GLASS_HIGH of the car's height.
 *
 * GROWN A HAIR OUTWARD (GLASS_OUT) so it sits just proud of the wall instead of coplanar with
 * it, which would z-fight the whole way round. It reaches past the car's silhouette by about
 * 0.0014 world units, which is nothing.
 *
 * The shade is deeper than anything else on the car on purpose: the wall it sits on is already
 * the car's darkest lit surface, so the glass has to be darker still to read as glass rather
 * than as a slightly different panel. But only just -- the first version at 0.52 across 46% of
 * the wall's height came out at 30% of the roof's brightness over most of the visible side, so
 * the WALL got reported as too dark when the wall itself was fine at 58% and the glass was
 * covering it. Measured with `tools/car-plan.py`, which prints these percentages.
 */
const GLASS_LOW = 0.40;
const GLASS_HIGH = 0.74;
const GLASS_OUT = 1.006;
const GLASS_SHADE = 0.66;

/**
 * THE WINDSCREEN, and the two ROOF RAILS it replaces.
 *
 * What was here: two thin seams across the roof at +-0.34, clear of the arrow, whose job was to
 * give the eye something to measure the roof's curve against. They did that, and they were
 * MIRROR IMAGES -- so the roof's only asymmetry was the arrow, and a car read as a bar with a
 * direction printed on it. Both are gone; the windscreen stands where the nose one did and the
 * tail lights where the tail one did, so the roof keeps its rhythm and gains an end.
 *
 * WHY IT IS ON THE ROOF AND NOT ON THE WALL, which is where GLASS_* correctly puts the windows.
 * The nose wall faces along the car, so it is visible only while the car points DOWN the screen
 * -- a windscreen there would appear and vanish as the car turned, which is the one thing a
 * head/tail cue must not do. The roof is the surface the camera always sees.
 *
 * IT IS NOT THE ROOF PANELS THAT FAILED. The note at the top of this file records windows being
 * moved off the roof because they "read as dark holes punched in it", and that was two panels,
 * SYMMETRIC, on a flat board with no wall to carry real glass. This is one trapezoid, at one
 * end, with the window band still running round the wall underneath it. The shape is what
 * reads: a rectangle would be a hole, and a trapezoid narrowing toward the nose is a raked
 * screen.
 *
 * A BAND RIGHT ACROSS THE ROOF, not a shape sitting on it, and PLAY SIZE is the whole argument.
 * Two versions of this were trapezoids inset from the roof's edges -- first narrowing toward the
 * nose, which drew a dark arrowhead in front of the white one and competed with it, then
 * widening toward it. Both read at 240 pixels per world unit and NEITHER read on a phone, where
 * a car is about forty pixels long: an inset shape is a small mark near one end, and a small
 * mark is indistinguishable from the tail lights at the other end. Two sets of small marks on
 * one car is not a head and a tail, it is noise, which is exactly how it came back.
 *
 * What a band buys is that it cannot be mistaken for a detail. It runs the full width of the
 * crown and takes SCREEN_LEN of the car's length, so at any size it is one of the two or three
 * things a car is made of rather than something printed on it.
 *
 * SCREEN_LEN IS THE CAR'S LENGTH, NOT THE CROWN'S, so 0.20 is the 20% it reads as. Where the
 * band STOPS is derived from the crown rather than written down -- see `windscreenBand`.
 */
const SCREEN_LEN = 0.20;
const SCREEN_SHADE = 0.60;

/**
 * Tail lights: two small plates at the other end, and the one place the car's paint is allowed
 * a second hue.
 *
 * THE "ONE HUE" RULE AT THE TOP OF THIS FILE IS ABOUT FORM, and this is not form. That rule is
 * there because a second hue used for SHADING reads as a decal instead of as a surface turning
 * away; a tail light IS a decal, and a lamp lens is the one part of a real car that disagrees
 * with the paint. The tyres already take the same exemption.
 *
 * DARK RED, NOT BRIGHT. These are about four pixels square on a phone, and at that size hue is
 * nearly unreadable -- what reads is that there are TWO of them and that they are dark. Bright
 * lamps would also compete with the white arrow, which is the one thing on the roof that has to
 * win. On the palette's own red the pair lands close to a plain dark shade of the paint, which
 * is exactly what it should look like there.
 *
 * SMALLER AND SQUARER THAN THE FIRST VERSION, which at 0.07 x 0.24 and a 0.35 radius came out
 * as two round buttons taking up most of the tail's width. A lamp is a small hard-edged rectangle
 * set near the corner; roundness and size both pushed it toward reading as a decorative dot.
 *
 * They sit inboard of x -0.409, where the crown's tail corner starts under CORNER_TAIL.
 */
const TAIL_X = -0.365;
const TAIL_Y = 0.175;
const TAIL_W = 0.055;
const TAIL_H = 0.19;
const TAIL_R = 0.26;
const TAILLIGHT = new Color(190, 40, 46);

/** The exit arrow, pointing +X (the body's own forward). */
const ARROW_X = -0.02;
const ARROW_W = 0.34;
const ARROW_H = 0.54;
const ARROW_SHAFT = 0.42;
const ARROW_HEAD = 0.52;

/**
 * How far the arrow's dark backing is grown past the arrow itself, in fractions of the car's
 * WIDTH -- so about two pixels on a phone.
 *
 * 0.12, UP FROM 0.07, AND THE FIRST TRY WAS THE ONE PICKED TO SPEC. A one-pixel outline was what
 * was asked for and 0.07 measures as one pixel on a phone, and it came back from a device still
 * unreadable on yellow: a one-pixel line between two light colours is mostly eaten by the
 * antialiaser, which averages it with the paint on both sides. The line has to be wide enough
 * that its middle survives sampling, which means two pixels, not one. Judge this on yellow or
 * cyan and at play size (`--ppu`), never on red in the big render.
 *
 * WHY A GROWN COPY AND NOT A TRANSLUCENT PAD. A pad at alpha 0.2 multiplies whatever is under
 * it, so on a yellow or a cyan roof -- the two the arrow was reported as vanishing on -- it
 * lands as a slightly darker yellow, and the white arrow is still white on light. What was
 * missing is a BOUNDARY, and a boundary has to be opaque and dark against BOTH sides of itself:
 * the outline ink is dark against the roof and the arrow is white against the ink, so the arrow
 * reads on all six colours by the same mechanism instead of six different ones.
 *
 * Grown along the polygon's own outward normals (see `grow`), so the shaft and the head each
 * thicken and their shared seam only overlaps harder -- there is no join to open up.
 */
const ARROW_OUTLINE = 0.12;

/**
 * How tall the car stands off the board, in WORLD units.
 *
 * WORLD, not a fraction: the node's scale is (len, wid, 1), so Z is the one axis the three caps
 * share, and all three should stand about the same height anyway -- a small car is not a third
 * as tall as a truck.
 *
 * What it buys on screen is CAR_HEIGHT * sin(BOARD_TILT), so the two have to be judged together.
 * At the tilt of 38 degrees this ships with, 0.34 shows about 0.21 world units of wall, a bit
 * over a third of a medium car's width.
 *
 * It is also the amount by which the drawn car sits up-screen of the footprint core reasons
 * about, so `onTap` subtracts it back out; see ROOF_RISE in GameController.
 */
export const CAR_HEIGHT = 0.34;

/**
 * The side wall's paint: lifted toward white, then graded a little darker at the foot.
 *
 * WHY IT IS LIFTED AND NOT JUST LEFT AS THE BODY COLOUR. The wall receives 58% of the light the
 * roof does (measured -- `tools/car-plan.py` prints it), and 58% of the light on a SATURATED
 * colour is darker than it sounds: red (244,67,72) carries only 41% of white's luminance to
 * begin with, so the lit wall lands at 24% and reads nearly black. Multiplying is not what a
 * painter does to a shaded face; they shift it toward the light that is actually falling on it,
 * which here is a grey-blue sky ambient. WALL_LIFT is that shift, and it is why the side can read
 * as "the same car, in shade" rather than as a hole -- which is what it was reported as.
 */
const WALL_LIFT = 0.24;
const WALL_FOOT = 0.90;

/** How high up the wall the wheels sit. Low, so they read as touching the ground. */
const WHEEL_Z = 0.03;

/**
 * Depth steps, in WORLD units and deliberately tiny: they order the plates and nothing else.
 * The node carries no Z scale, so these stay the same however long the car is. Coplanar
 * plates would z-fight, which is the only reason they are not all at zero.
 */
const Z_STEP = 0.008;

/**
 * Arc segments per rounded corner. 5, not 3: on the body's rings a corner is where the outward
 * normal swings through ninety degrees, and too few segments show up as facets in the highlight.
 * The wheels and windows would be fine with 3 and share this only for simplicity.
 */
const CORNER_SEGMENTS = 5;

/**
 * Length-to-width ratio the rounded corners are shaped for -- the medium car's, which is the
 * commonest on a board. READ OFF CAP_BOX rather than written down: it was a literal 3.126, and
 * a revision that resized medium would have left it describing the wrong car in silence.
 *
 * A corner radius is only a circle in WORLD space, and the mesh is built in a unit box that
 * then gets stretched by (len, wid). Take the radius as a plain fraction of the normalized
 * shape and the stretch turns it into an ellipse three times wider than tall: the windows come
 * out rounded on their short sides and square on their long ones, which is a brick, not glass.
 * So the radius is worked out at this aspect and divided back out along X, which makes the
 * corners true circles on a medium car and near enough on big (3.15 against 3.13) -- small, at
 * 2.05, is the one carrying real error, its corners about half again as rounded along X as
 * across.
 *
 * That could now be made exact: the mesh is keyed by CAPACITY as well as colour (see
 * `carMesh`), so each cap could be shaped at its own aspect. It would mean threading the
 * aspect through `bodyOutline` and `roundRect` instead of reading a module constant, and the
 * error it removes has never been reported, so it is recorded here rather than done.
 */
const REFERENCE_ASPECT = CAP_BOX.medium.len / CAP_BOX.medium.wid;

/**
 * Convert an ACROSS shrink into the ALONG shrink that removes the same distance in world units.
 * Without it the roof's shoulder would be three times wider at the nose than along the flank,
 * because a fraction of the length is three times a fraction of the width.
 */
const ACROSS_TO_ALONG = (BODY_ACROSS / BODY_ALONG) / REFERENCE_ASPECT;

function lighten(c: Color, t: number): Color {
    const up = (v: number): number => Math.round(v + (255 - v) * t);
    return new Color(up(c.r), up(c.g), up(c.b), 255);
}

function shade(c: Color, f: number): Color {
    return new Color(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f), 255);
}

/** HSL back to a Color. `h`, `s` and `l` are all 0..1. */
function fromHsl(h: number, s: number, l: number): Color {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t: number): number => {
        let x = t;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    const to = (t: number): number => Math.round(Math.max(0, Math.min(1, channel(t))) * 255);
    return new Color(to(h + 1 / 3), to(h), to(h - 1 / 3), 255);
}

/** The outline ink for a body colour: darker and a little more saturated. See OUTLINE_L_DROP. */
function outlineOf(c: Color): Color {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    const l = (hi + lo) / 2;
    const d = hi - lo;
    let h = 0, s = 0;
    if (d > 1e-6) {
        s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
        if (hi === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (hi === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return fromHsl(h, Math.min(1, s * (1 + OUTLINE_S_GAIN)), l * (1 - OUTLINE_L_DROP));
}

/**
 * A rounded rectangle as a counter-clockwise polygon. `r` is a fraction of the shape's shorter
 * side MEASURED AT REFERENCE_ASPECT, so the corner comes out circular once the node's stretch
 * is applied; see that constant.
 *
 * `rTail` is the radius for the -X end, and it DEFAULTS TO `r` so every symmetric caller here
 * -- the wheels, the tail lights, the glass -- reads exactly as it did before the body's two
 * ends were allowed to differ. Only `bodyOutline` passes the pair.
 */
function roundRect(
    cx: number, cy: number, w: number, h: number, r: number, rTail: number = r,
): Pt[] {
    const hw = w / 2, hh = h / 2;
    // In world terms the shape is (w * aspect) by h; take the radius there, then bring it back.
    const minor = Math.min(w * REFERENCE_ASPECT, h);
    const radii = (f: number): { rx: number; ry: number } => {
        const world = f * minor;
        return { rx: Math.min(world / REFERENCE_ASPECT, hw), ry: Math.min(world, hh) };
    };
    const nose = radii(r), tail = radii(rTail);
    const pts: Pt[] = [];
    // Corner centres in counter-clockwise order, each swept a quarter turn: the two +X (nose)
    // corners first, then the two -X (tail) ones, which is the order `outwards` walks too.
    const corners: readonly { ox: number; oy: number; rx: number; ry: number }[] = [
        { ox: hw - nose.rx, oy: -(hh - nose.ry), rx: nose.rx, ry: nose.ry },
        { ox: hw - nose.rx, oy: hh - nose.ry, rx: nose.rx, ry: nose.ry },
        { ox: -(hw - tail.rx), oy: hh - tail.ry, rx: tail.rx, ry: tail.ry },
        { ox: -(hw - tail.rx), oy: -(hh - tail.ry), rx: tail.rx, ry: tail.ry },
    ];
    for (let c = 0; c < 4; c++) {
        const { ox, oy, rx, ry } = corners[c];
        const start = -Math.PI / 2 + c * (Math.PI / 2);
        for (let s = 0; s <= CORNER_SEGMENTS; s++) {
            const a = start + (s / CORNER_SEGMENTS) * (Math.PI / 2);
            pts.push([cx + ox + Math.cos(a) * rx, cy + oy + Math.sin(a) * ry]);
        }
    }
    return pts;
}

/**
 * The body outline at a fraction of full size. The corner radius shrinks with it, because
 * `roundRect` takes it as a fraction of the shape's own shorter side -- which is what keeps the
 * dome steps looking like one curved roof rather than a stack of differently-rounded plates.
 */
function bodyOutline(along: number, across: number): Pt[] {
    return roundRect(0, 0, BODY_ALONG * along, BODY_ACROSS * across, CORNER_NOSE, CORNER_TAIL);
}

/**
 * The part of a convex polygon at or in front of `x0`, cut off square there.
 *
 * Sutherland-Hodgman against one half-plane. Every outline it is used on comes from `roundRect`
 * and is convex, so the result is convex too and `addFlat`'s fan is valid. Winding is preserved.
 */
function clipMinX(pts: readonly Pt[], x0: number): Pt[] {
    const out: Pt[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const aIn = a[0] >= x0, bIn = b[0] >= x0;
        if (aIn) out.push(a);
        if (aIn !== bIn) {
            const t = (x0 - a[0]) / (b[0] - a[0]);
            out.push([x0, a[1] + (b[1] - a[1]) * t]);
        }
    }
    return out;
}

/**
 * The windscreen: the nose end of the CROWN'S OWN OUTLINE, cut off square SCREEN_LEN back.
 *
 * TAKEN FROM THE CROWN RATHER THAN DRAWN, which is what makes it a band rather than a plate
 * lying on one. Its sides ARE the roof's sides, nose corner rounding included, so it reaches
 * exactly as wide as the flat top goes and stops where the shoulder starts curving away. A
 * rectangle sized to match would either fall short of the edge -- leaving a sliver of paint
 * that reads as a gap -- or overhang the shoulder and float above it.
 *
 * It also cannot drift: CORNER_NOSE, DOME_NARROW and EDGE_GROW_* all move the crown, and the
 * band follows all three without being retuned.
 */
function windscreenBand(crown: readonly Pt[]): Pt[] {
    let nose = -Infinity;
    for (const [x] of crown) if (x > nose) nose = x;
    return clipMinX(crown, nose - SCREEN_LEN);
}

/**
 * A polygon grown outward by `d`, in fractions of the car's WIDTH.
 *
 * ANISOTROPIC, the same correction `roundRect` makes and for the same reason: the node stretches
 * X by the car's length and Y by its width, so an equal offset in mesh space comes out three
 * times thicker along the car than across it. Dividing the X component by REFERENCE_ASPECT makes
 * the grown border about even in world units on a medium car.
 */
function grow(pts: readonly Pt[], d: number): Pt[] {
    const out = outwards(pts);
    return pts.map((pt, i) =>
        [pt[0] + out[i][0] * d / REFERENCE_ASPECT, pt[1] + out[i][1] * d] as Pt);
}

/** The arrow, as the two convex pieces it is made of: a shaft rectangle and a head triangle. */
function arrowPieces(): Pt[][] {
    const hw = ARROW_W / 2, hh = ARROW_H / 2;
    const shaft = hh * ARROW_SHAFT;
    const base = ARROW_X + hw - ARROW_W * ARROW_HEAD;
    return [
        [[ARROW_X - hw, -shaft], [base, -shaft], [base, shaft], [ARROW_X - hw, shaft]],
        [[base, -hh], [ARROW_X + hw, 0], [base, hh]],
    ];
}

/**
 * The outward direction of a counter-clockwise polygon at each of its vertices, in the plan.
 *
 * Taken from the neighbours rather than from the centre: measured from the centre, a point
 * halfway along a long flank would point diagonally instead of squarely out of that flank.
 * These are MESH-space directions -- the node's inverse transpose turns them into the correct
 * world normals for the stretched shape, which is exactly what that transform is for.
 */
function outwards(pts: readonly Pt[]): Pt[] {
    const n = pts.length;
    return pts.map((_, i) => {
        const [ax, ay] = pts[(i + 1) % n];
        const [bx, by] = pts[(i - 1 + n) % n];
        const dx = ax - bx, dy = ay - by;
        const len = Math.hypot(dx, dy) || 1;
        return [dy / len, -dx / len] as Pt;         // CCW winding, so this points outward
    });
}

/** One ring of the roof: an outline, the height it sits at, its colour, and its normal tilt. */
interface Ring { pts: readonly Pt[]; z: number; c: Color; tilt: number }

/** A flat, straight-up-facing piece: the rim, the wheels, the glass, the arrow. */
interface Flat { pts: readonly Pt[]; c: Color }

/**
 * A plate on the roof, and WHICH LAYER it sits on, counted in Z_STEPs above the crown.
 *
 * It used to be the plate's index in the list, which meant every plate added to the roof lifted
 * every plate after it. That was survivable at four and is not at seven: the stack would stand
 * 0.056 world units off the crown, and on a board tilted 38 degrees the topmost plate -- the
 * arrow, the one thing that must look painted on -- would visibly float above the roof it is
 * painted on.
 *
 * Layers are assigned by what OVERLAPS what, not by position in the list, so the plates that
 * cannot overlap each other share one. Three layers is the whole stack: the trim (windscreen and
 * tail lights, which are at opposite ends of the car), then the arrow's dark backing, then the
 * arrow. See ARROW_OUTLINE for why the last two are a pair rather than one shape.
 */
interface Plate extends Flat { layer: number }

const TRIM_LAYER = 1;
const ARROW_BACK_LAYER = 2;
const ARROW_LAYER = 3;

/** Vertex/index accumulator. Flat convex polygons, plus rings stitched into shaded bands. */
class Plan {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly colors: number[] = [];
    readonly indices: number[] = [];

    /** One ring of vertices, normals tilted `tilt` degrees outward. Returns its first index. */
    private ring(pts: readonly Pt[], z: number, c: Color, tilt: number): number {
        const base = this.positions.length / 3;
        const r = c.r / 255, g = c.g / 255, b = c.b / 255;
        const out = outwards(pts);
        const lean = Math.sin(tilt * Math.PI / 180), up = Math.cos(tilt * Math.PI / 180);
        for (let i = 0; i < pts.length; i++) {
            this.positions.push(pts[i][0], pts[i][1], z);
            this.normals.push(out[i][0] * lean, out[i][1] * lean, up);
            this.colors.push(r, g, b, 1);
        }
        return base;
    }

    /** Add one convex polygon at height `z`, fanned from its first point, facing straight up. */
    addFlat(pts: readonly Pt[], z: number, c: Color): void {
        const base = this.ring(pts, z, c, 0);
        for (let i = 1; i < pts.length - 1; i++) {
            this.indices.push(base, base + i, base + i + 1);
        }
    }

    /**
     * Add the band between two rings of EQUAL vertex count, corresponding index for index.
     * Every outline here comes from `roundRect` with the same segment count, so they do -- but
     * a silently mismatched pair would stitch the roof to itself diagonally, so it is checked.
     */
    addBand(outer: Ring, inner: Ring): void {
        if (outer.pts.length !== inner.pts.length) {
            throw new Error('car-mesh: band rings differ in vertex count');
        }
        const a = this.ring(outer.pts, outer.z, outer.c, outer.tilt);
        const b = this.ring(inner.pts, inner.z, inner.c, inner.tilt);
        const n = outer.pts.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            this.indices.push(a + i, a + j, b + i);
            this.indices.push(a + j, b + j, b + i);
        }
    }
}

/**
 * The whole car, described rather than built: the flat pieces under the roof, the roof's rings,
 * and the flat pieces on top of it.
 *
 * Split out from `carMesh` so `tools/car-plan.py` has one description to mirror and the ordering
 * cannot drift between the mesh and the picture used to judge it.
 */
function design(
    color: Color, cap: Cap,
): { rim: readonly Pt[]; wheels: Flat[]; rings: Ring[]; over: Plate[] } {
    const rim = bodyOutline(EDGE_GROW_ALONG, EDGE_GROW_ACROSS);
    const wheels: Flat[] = [];
    const axle = axles(cap);
    for (const x of axle.xs) {
        for (const sy of [-1, 1]) {
            wheels.push({
                pts: roundRect(x, sy * WHEEL_Y, axle.w, WHEEL_H, WHEEL_R),
                c: TYRE,
            });
        }
    }

    // The outermost ring sits ON the silhouette, at exactly the wall's top edge, so the wall
    // and the roof meet with nothing between them. DOME_NARROW's inset is unchanged: it is
    // subtracted from the grown outline rather than from the body's.
    const rings: Ring[] = DOME_PROFILE.map(({ at, tilt }) => ({
        pts: bodyOutline(EDGE_GROW_ALONG - DOME_NARROW * ACROSS_TO_ALONG * at,
            EDGE_GROW_ACROSS - DOME_NARROW * at),
        z: CAR_HEIGHT + DOME_RISE * at,
        c: color,
        tilt,
    }));

    const ink = outlineOf(color);
    const over: Plate[] = [
        {
            pts: windscreenBand(rings[rings.length - 1].pts),
            c: shade(color, SCREEN_SHADE),
            layer: TRIM_LAYER,
        },
        { pts: roundRect(TAIL_X, TAIL_Y, TAIL_W, TAIL_H, TAIL_R), c: TAILLIGHT, layer: TRIM_LAYER },
        { pts: roundRect(TAIL_X, -TAIL_Y, TAIL_W, TAIL_H, TAIL_R), c: TAILLIGHT, layer: TRIM_LAYER },
        ...arrowPieces().map((pts) =>
            ({ pts: grow(pts, ARROW_OUTLINE), c: ink, layer: ARROW_BACK_LAYER }) as Plate),
        ...arrowPieces().map((pts) => ({ pts, c: Color.WHITE, layer: ARROW_LAYER }) as Plate),
    ];
    return { rim, wheels, rings, over };
}

function colourKey(c: Color, cap: Cap): string {
    return `${c.r},${c.g},${c.b},${cap}`;
}

const meshCache = new Map<string, Mesh>();

/**
 * The whole car as ONE mesh, in a unit box (length along X, width along Y, -0.5..0.5), with
 * every plate's colour baked into its vertices. Cached per (colour, CAPACITY) -- six colours
 * in the palette and three capacities, so at most eighteen meshes serve a whole lot.
 *
 * It was per colour alone until the wheels stopped being the same on every vehicle (see
 * `axles`). The cost is draw calls: one instanced draw per (mesh, material) pair, so a lot
 * went from six to at most eighteen. That is nothing here -- the frame-rate problem this
 * design solved was ~414 draws for 46 modelled cars, and the JS-side cost of walking a
 * thousand renderers, neither of which eighteen comes near.
 *
 * Vertex colours, not materials, are what collapse the draw calls. The car needs a white
 * arrow, near-black tyres and several shades of its own paint; as materials that is a dozen
 * renderers per car and no two cars batching. Baked into the mesh it is one renderer per car,
 * and every car of a colour shares mesh AND material, so the lot costs one instanced draw per
 * colour. See `vertexColorMaterial`.
 *
 * The roof's SHADING is not baked -- only its colour is. Its normals do that work, and the
 * engine's key light does the rest; see DOME_PROFILE.
 */
export function carMesh(color: Color, cap: Cap): Mesh {
    const key = colourKey(color, cap);
    const hit = meshCache.get(key);
    if (hit) return hit;

    const plan = new Plan();
    const { rim, wheels, rings, over } = design(color, cap);

    // The wheels first, low on the wall, so the wall's own band draws over whatever part of them
    // falls inside the body: what shows is the sliver past the silhouette, which is all a wheel
    // is from up here.
    for (const wheel of wheels) plan.addFlat(wheel.pts, WHEEL_Z, wheel.c);

    // THE WALL: the body's outline extruded from the board up to the roof, with the vertices'
    // normals lying flat and pointing outward (tilt 90). That is what makes the engine light the
    // four sides differently -- and, unlike everything the fake wall tried, it turns with the
    // car, so the side facing the viewer is always the side facing the viewer.
    //
    // THE SKIRT is the bottom band of it: the same outline, the same flat outward normals, just
    // the outline ink instead of the paint. It is a band rather than a separate plate so it
    // costs nothing -- one more ring in the same mesh, no renderer, no material, no draw call.
    const wall = lighten(color, WALL_LIFT);
    const skirtTop = CAR_HEIGHT * SKIRT_TOP;
    const ink = outlineOf(color);
    plan.addBand(
        { pts: rim, z: 0, c: ink, tilt: 90 },
        { pts: rim, z: skirtTop, c: ink, tilt: 90 },
    );
    plan.addBand(
        { pts: rim, z: skirtTop, c: shade(wall, WALL_FOOT), tilt: 90 },
        { pts: rim, z: CAR_HEIGHT, c: wall, tilt: 90 },
    );
    // The window band, on the same outline grown just enough not to z-fight the wall.
    const glassPts = bodyOutline(EDGE_GROW_ALONG * GLASS_OUT, EDGE_GROW_ACROSS * GLASS_OUT);
    const glass = shade(color, GLASS_SHADE);
    plan.addBand(
        { pts: glassPts, z: CAR_HEIGHT * GLASS_LOW, c: glass, tilt: 90 },
        { pts: glassPts, z: CAR_HEIGHT * GLASS_HIGH, c: glass, tilt: 90 },
    );
    for (let i = 0; i + 1 < rings.length; i++) plan.addBand(rings[i], rings[i + 1]);
    const roof = rings[rings.length - 1];
    plan.addFlat(roof.pts, roof.z, roof.c);            // the crown, inside the innermost ring
    for (const plate of over) plan.addFlat(plate.pts, roof.z + plate.layer * Z_STEP, plate.c);
    const top = roof.z + ARROW_LAYER * Z_STEP;
    const geometry: primitives.IGeometry = {
        positions: plan.positions,
        normals: plan.normals,
        colors: plan.colors,
        indices: plan.indices,
        // Given by hand: the plates all live inside the unit box by construction, and letting
        // createMesh derive the bounds from a vertex sweep would only rediscover that.
        minPos: { x: -0.5, y: -0.5, z: 0 },
        maxPos: { x: 0.5, y: 0.5, z: top },
        boundingRadius: Math.sqrt(0.5),
    };
    const mesh = utils.createMesh(geometry);
    meshCache.set(key, mesh);
    return mesh;
}
