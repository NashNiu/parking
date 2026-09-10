/**
 * Puts this game's loading screen on the Cocos first screen: our artwork across the top, a
 * band below it, and a progress bar in the band that actually moves.
 *
 *   cd logic && npm run splash [-- --build ../game/build/wechatgame]
 *
 * RUN IT AFTER EVERY BUILD. `game/build/` is git-ignored (game/.gitignore:8) and the whole
 * first screen is generated output, so a hand edit lasts exactly until the next build. This
 * script is idempotent, so running it twice, or on an already-patched build, is harmless.
 *
 * A script rather than a Cocos build plugin (`game/extensions/**`, `onAfterBuild`), which
 * would be automatic, and which I could not verify from here: an extension the editor
 * silently fails to load leaves a build that still wears the Cocos logo with nothing to say
 * why. This can be run and checked right now, and its failure mode is "you forgot", which
 * you can see on the splash. The pure half below is what a plugin would call, so wiring one
 * up later is a three-line wrapper, not a rewrite.
 *
 * IT CANNOT BE A COCOS SCENE. The first screen runs in `game.js`, before `application.init`
 * has handed us an engine -- there is no `cc`, no canvas node tree, no `Label`. Everything
 * here is raw WebGL against the generated file's own shaders and module-scope variables.
 *
 * WHAT IT CHANGES, in two halves:
 *
 * 1. The plain variables at the top of the generated first-screen.js:
 *
 *      useCustomBg / bgName   the full-screen artwork          -> on, ours
 *      fitWidth / fitHeight   how the artwork is sized         -> fit to width
 *      useLogo / logoName     the centred logo slot            -> reused for the notice strip
 *      useDefaultLogo         draws the Cocos slogan           -> false
 *      bgColor                the band under the artwork       -> the road's grey
 *      progressBarColor       the bar's fill                   -> gold
 *      progressBackground     the bar's trough                 -> slate
 *
 *    `useDefaultLogo` is what stops "Created with Cocos" being drawn, and it currently draws
 *    in the WRONG PLACE anyway -- straight through the middle of the logo. The generated code
 *    places the logo centred (`updateVertexBuffer` drops the 0.225 offset `initVertexBuffer`
 *    used) while the slogan's offset formula still assumes a logo 5/12 down the screen, so on
 *    any phone at devicePixelRatio 2 or 3 the two land on top of each other. Measured on this
 *    build's own images (logo 140x200, slogan 452x64): at 1170x2532 the logo spans y -0.185
 *    to +0.185 and the slogan centres on +0.003.
 *
 * 2. An override block inserted before `module.exports`, because the rest of the work is in
 *    function BODIES and shader source, not in variables. See OVERRIDE_MARK below for why
 *    reassignment is the safe way to do that.
 *
 * LICENSING IS NOT A CODE QUESTION. game/settings/v2/packages/information.json records
 * `customSplash` and `removeSplash` as `enable: false`, each against an application form at
 * creator-api.cocos.com. Replacing the logo is the first of those. This script does the work;
 * whether the result may be published is between the project's owner and Cocos.
 */

import * as fs from 'fs';
import * as path from 'path';

/** RGBA, each 0..1, exactly as the generated file writes its colour arrays. */
export type Rgba = [number, number, number, number];

export interface SplashPatch {
    useCustomBg: boolean;
    bgName: string;
    fitWidth: boolean;
    fitHeight: boolean;
    useLogo: boolean;
    logoName: string;
    useDefaultLogo: boolean;
    bgColor: Rgba;
    progressBarColor: Rgba;
    progressBackground: Rgba;
}

/**
 * The loading screen's geometry and its animation, as fractions rather than pixels.
 *
 * Everything here is a fraction of the CANVAS, because the first screen runs at the device's
 * physical resolution -- `canvas.width` is 1170 on one phone and 1440 on the next, and this
 * is before the engine exists, so the 1280-wide design canvas the rest of the game is laid
 * out on does not exist yet either. A constant in pixels would be a different size on every
 * handset.
 *
 * Bar widths are fractions of the canvas WIDTH and vertical offsets are fractions of its
 * HEIGHT, so the bar keeps its shape and its distance from the bottom edge on any aspect.
 */
export interface SplashLayout {
    /** The bar's width, as a fraction of the screen's width. */
    barWidth: number;
    /** The bar's width divided by its height. 14 is a pill you can see, not a hairline. */
    barAspect: number;
    /**
     * The bar's centre, as a fraction of the screen's height up from the bottom edge -- a
     * FLOOR on it, rather than the position itself. Where there is a notice strip, the bar is
     * lifted to clear it by `barGap`, whichever is higher.
     */
    barUp: number;
    /**
     * The clear space between the notice strip's top and the bar's underside, as a fraction
     * of the screen's height.
     *
     * The bar cannot simply be placed at `barUp` when there is a notice, because the two are
     * measured against different edges: the strip is fitted to the canvas WIDTH so its height
     * follows the width, while `barUp` is a fraction of the HEIGHT. The wider and shorter the
     * screen, the further the strip reaches up into a bar placed by `barUp` alone -- measured
     * on a 1000x178 strip, that is 25px of gap on 19.5:9, MINUS 16 on 16:9 and MINUS 85 on
     * 4:3. So the strip is placed first and the bar is lifted off it.
     */
    barGap: number;
    /**
     * The scrim: a wash over the artwork's foot, opaque at the screen's bottom edge and fading
     * out going up, so the bar and the notice read whatever the artwork happens to do behind
     * them -- and so the join between the artwork and the band below it is covered rather
     * than colour-matched, which for this artwork is not possible (see GAME_SPLASH.bgColor).
     *
     * `scrimSolid` is the FLOOR on how much of the screen's height is fully covered. The
     * actual figure is the highest of that, the join, and the bar's own top edge, so whatever
     * the scrim is for is inside the opaque part by construction rather than by luck of the
     * aspect ratio. On a 4:3 screen, for instance, the notice strip is drawn wide enough to be
     * 225px tall, which lifts the bar above both other terms -- measured, before that third
     * term existed, a bar whose top 31px sat in the fade.
     *
     * THE JOIN TERM NO LONGER BINDS, and the sizing here is what changed when it stopped. A
     * 9:21 artwork overflows every phone from 16:9 to 21:9, so there is no band and no join --
     * `parkingJoin` is negative everywhere. The scrim's remaining job is legibility, so it is
     * sized to the bar and nothing more. It used to be 0.18 solid over 0.10 of fade, which was
     * chosen to swallow a 449px band; against an artwork that fills the screen that same wash
     * put 0.68 to 0.78 of navy straight onto the bus's wheels on every common phone -- the bus
     * sinking into fog. The join term is kept for the case where somebody supplies a short
     * artwork again, where it is the only thing that covers the band.
     *
     * `scrimOver` is how far past the join the opaque part reaches. Without it the two land
     * on exactly the same pixel on a 20:9 screen -- measured, 637px against 637px -- and the
     * join sits on the boundary where the fade begins, which is the one place it can still
     * show. A percent of the height is 25px on a 19.5:9 phone and costs nothing.
     *
     * `scrimFade` is how far the fade reaches above that, again as a fraction of the height.
     * It has to stop short of anything worth seeing. The artwork's wheels sit at 76% of its
     * own height, which on a 19.5:9 phone is 457px above the bottom edge -- the tightest of
     * any screen -- and at these values the wash is down to 0.08 there. Invisible, and it
     * reads as the shadow under the bus rather than as a band across it.
     *
     * On a SHORT screen the bus is below the scrim entirely and nothing here can help: 16:9
     * shows only the top 76% of a 9:21 artwork, which puts the wheels 4px off the bottom edge.
     * That is a composition matter, not a constant.
     */
    scrim: Rgba;
    scrimSolid: number;
    scrimOver: number;
    scrimFade: number;
    /** The notice strip's width, as a fraction of the screen's width. */
    noticeWidth: number;
    /**
     * The notice strip's BOTTOM edge, measured like `barUp`. Its bottom rather than its
     * centre, because the strip's height is whatever its own aspect gives once it has been
     * fitted to `noticeWidth`: pinning the bottom means a taller strip grows up towards the
     * bar, where pinning the centre would have it grow off the bottom of the screen.
     *
     * A taller strip therefore pushes the BAR up rather than colliding with it or running
     * off the screen -- see `barGap`, which is what makes the strip's own aspect a free
     * choice instead of a constraint.
     */
    noticeUp: number;
    /**
     * How fast the fill chases a milestone that has already landed, as an exponential rate
     * per second: after 1/ease seconds it has closed about 63% of the remaining gap.
     */
    ease: number;
    /**
     * The rate of the CREEP -- the drift the fill keeps up once it has caught its milestone
     * and is waiting for the next one. Measured the same way as `ease`, and about sixteen
     * times slower, because it is covering the gap to a step that has not started yet.
     *
     * THIS is what makes the bar look alive, and it has to be asymptotic rather than a rate
     * with a ceiling. The first version of it capped the fill at the milestone plus 0.12 and
     * pushed it there at a floor of 0.06/s: it hit that cap in half a second and then SAT
     * STILL for the remaining 800ms of the gap -- measurably, in the trace, exactly the
     * freeze the creep exists to prevent. Something that never arrives never has to stop.
     */
    creep: number;
    /**
     * The spacing of game.js's own milestones (0.2, 0.4, 0.6, then end()'s 1), which is what
     * the creep drifts towards: never past the NEXT one, so the bar cannot claim a loading
     * step that has not begun.
     */
    step: number;
    /**
     * How close to a milestone counts as having reached it, in progress. Needed because an
     * exponential approach is asymptotic -- without a tolerance the fill never finishes
     * catching up, so the creep never starts. 0.002 is under two pixels of an 819px bar.
     */
    arrived: number;
    /**
     * How long the run-out takes: `end()` drives the fill from wherever it is to exactly 1
     * over this many ms, LINEARLY, and holds the screen open for it.
     *
     * Linear, and not the exponential the rest of it uses, because this is the one stretch
     * that has to ARRIVE. Easing towards 1 for 280ms from a typical 0.7 gets to 0.968 and
     * leaves the last 26px of an 819px bar to vanish in a single frame -- measured, and
     * plainly visible. A fixed-duration ramp lands on 1 and reads as a deliberate finish.
     *
     * The cost of a smooth bar is that the splash outlives loading by this much. Past about
     * a third of a second it stops reading as a flourish and starts reading as a stall.
     */
    tailMs: number;
}

/** 0..255 to the 0..1 the shaders want, so the constants below can be read off the HUD. */
function rgba(r: number, g: number, b: number, a = 1): Rgba {
    return [r / 255, g / 255, b / 255, a];
}

/**
 * The game's own loading screen.
 *
 * `bgColor` is what shows below the artwork, which is HomeView's own navy -- so the hand-off
 * from the first screen to the menu is not a change of scene. It is almost entirely covered
 * by the scrim (see SplashLayout.scrim), and matching the two means a rounding error at their
 * boundary cannot show as a line.
 *
 * IT USED TO BE A ROAD GREY, meant to continue the artwork's foot. That only works if the
 * artwork's bottom edge is one colour, and this one is not: the left 55% is asphalt and the
 * right 45% is warm cream paving. No flat colour continues that -- whatever it is, half the
 * seam shows. Hence the scrim, which covers the join instead of trying to match it.
 */
export const GAME_SPLASH: SplashPatch = {
    useCustomBg: true,
    // Overridden by main() to match whatever it actually finds -- see ART_SOURCES.
    bgName: 'splash-bg.jpg',
    // Fit to width: the artwork spans the screen and its height follows its own aspect. The
    // override below implements exactly this case and then pins it to the TOP; these two
    // variables are set to agree with it rather than to be read.
    fitWidth: true,
    fitHeight: false,
    // The logo slot, reused. `main()` turns this off when there is no notice strip to draw.
    useLogo: true,
    logoName: 'splash-notice.png',
    useDefaultLogo: false,
    bgColor: rgba(24, 30, 50),
    progressBarColor: rgba(250, 196, 62),
    progressBackground: rgba(58, 66, 82),
};

/**
 * The shape of it. Every number is justified in `SplashLayout`.
 *
 * THE BAR IS PLACED AGAINST THE SCREEN'S BOTTOM EDGE, NOT AGAINST THE BAND. The band is
 * whatever the artwork does not cover, so its height depends on two things this code cannot
 * know: the screen's aspect and the artwork's. On a 1170x2532 phone a 0.62 portrait artwork
 * leaves about 630px of band and the bar sits well inside it; on a 16:9 phone the same
 * artwork leaves about 165px and the bar ends up over the bottom of the artwork instead.
 * That is the deliberate trade -- a loading bar in the same place on every handset, over
 * asphalt on the short ones, rather than one that climbs as the screen gets shorter and
 * lands somewhere different every time.
 */
export const GAME_LAYOUT: SplashLayout = {
    barWidth: 0.7,
    barAspect: 14,
    barUp: 0.12,
    barGap: 0.02,
    // HomeView's own navy, which is also bgColor -- a cool shadow under a warm sunlit scene,
    // and the same colour the menu behind it opens on.
    scrim: [24 / 255, 30 / 255, 50 / 255, 0.78],
    scrimSolid: 0.14,
    scrimOver: 0.01,
    scrimFade: 0.04,
    noticeWidth: 0.86,
    noticeUp: 0.028,
    ease: 8,
    creep: 0.5,
    step: 0.2,
    arrived: 0.002,
    tailMs: 280,
};

/**
 * Where the artwork may live, in the order it is looked for. JPEG FIRST, AND ON PURPOSE.
 *
 * The first screen lives at the build's ROOT, so every byte of it counts against the WeChat
 * mini-game's 4MB main package -- and this build is already at 2.9MB, which leaves about
 * 1.1MB for the whole loading screen. A 1600x2848 render is several megabytes as a PNG and a
 * few hundred kilobytes as a JPEG at the same apparent quality: it is a photograph-like image,
 * gradients everywhere, no flat colour for PNG's predictor to exploit. Nothing on it needs
 * lossless, and nothing needs alpha -- it is the bottom layer.
 *
 * The NOTICE is PNG only, and that is not an oversight. It is drawn OVER the artwork and the
 * band, so it needs a transparent background, which JPEG cannot carry.
 */
export const ART_SOURCES = [
    path.join('tools', 'splash', 'splash-bg.jpg'),
    path.join('tools', 'splash', 'splash-bg.png'),
];

/**
 * The size at which the artwork gets a warning, in KB, and the budget it is measured against.
 *
 * A warning and not an error: what the package may hold is a judgement about the whole build,
 * not about this one file, and a script that refused to run would be wrong as often as it was
 * right. But an artwork that quietly takes the package over the limit fails at UPLOAD, hours
 * later, with a message about the package and nothing about the splash -- so it says so here.
 */
export const ART_WARN_KB = 900;
export const PACKAGE_LIMIT_KB = 4096;
export const NOTICE_SOURCE = path.join('tools', 'splash', 'splash-notice.png');
export const FIRST_SCREEN = 'first-screen.js';

/**
 * The marker that makes the insertion idempotent, and the anchor it goes in front of.
 *
 * The override block REASSIGNS function declarations rather than rewriting their bodies:
 * `function f() {}` creates a mutable binding, so `f = ...` is seen by every existing call
 * site, including the ones inside the generated code that we never touch. That buys two
 * things a regex over function bodies cannot. It survives Cocos reformatting the bodies --
 * only the NAMES have to hold, and the variable assignments already fail loudly if those
 * move. And there is exactly one insertion point to get right instead of five.
 *
 * It has to go in front of `module.exports`, not after it: that line captures the current
 * VALUES of `start`, `end` and `setProgress`, so an override placed after it would rewrite
 * bindings nothing exported reads, and `game.js` would keep calling the originals.
 *
 * The mark is also what makes an EXISTING block findable, so a stale one can be cut out and
 * replaced. Skipping the insertion when the mark was present was the first version of that,
 * and it was wrong in a way that only shows up while the block is being worked on: a build
 * already patched by an older version of this script never received the newer block, and the
 * script cheerfully reported "already patched". Idempotence should fall out of writing an
 * identical block over the old one, not out of declining to look.
 */
export const OVERRIDE_MARK = '/* --- parking loading screen (tools/patch-splash.ts) --- */';
const EXPORT_ANCHOR = 'module.exports = { start, end, setProgress };';

function assign(src: string, name: string, value: string): string {
    // Anchored at the start of a line so a mention inside a function body cannot be hit, and
    // the value is taken to the end of the statement.
    const re = new RegExp(`^(let\\s+${name}\\s*=\\s*)[^;]*;`, 'm');
    if (!re.test(src)) {
        // LOUD, because the alternative is a build that quietly keeps the Cocos logo. A Cocos
        // version that renames or restructures these variables has to be noticed here.
        throw new Error(
            `patch-splash: no \`let ${name} = ...;\` in ${FIRST_SCREEN}.`
            + ' The generated first screen has changed shape -- read it and update this script.',
        );
    }
    return src.replace(re, `$1${value};`);
}

const fmt = (c: Rgba): string => `[${c.map((v) => Number(v.toFixed(6))).join(', ')}]`;
const num = (v: number): string => String(Number(v.toFixed(6)));

/**
 * The override block: the artwork pinned to the top, the notice strip and the bar placed
 * against the bottom edge, rounded caps, and a fill that eases instead of jumping.
 *
 * WHY THE BAR NEEDED ITS OWN SHADER. The generated one takes a single 0..1 along the bar
 * (`a_Progress`) and picks fill or trough from it, which can only ever draw a hard-edged
 * rectangle. Rounded caps need to know where the fragment is in BOTH axes, so the quad
 * carries a uv and the fragment shader measures a signed distance to the pill's skeleton.
 *
 * WHY THE VERTEX MATHS LOOKS ASYMMETRIC. NDC spans -1..1 across `canvas.width` and -1..1
 * across `canvas.height`, so one NDC unit is `canvas.width / 2` pixels horizontally and
 * `canvas.height / 2` vertically. A width fraction is therefore its own NDC half-extent,
 * while a height in pixels has to be divided by `canvas.height` to become one. Getting this
 * backwards is how you get a bar that is a pill on one phone and a sliver on another.
 *
 * WHY THE TEXCOORDS DIFFER BETWEEN THE TWO IMAGES. `drawTexture` hands `backgroundFilp` to
 * every program as `u_flip`, but only `FS_BG` declares that uniform -- `FS_LOGO` does not, so
 * `getUniformLocation` returns null and the call is a silent no-op. The background is
 * therefore flipped in the shader and the logo is not, and the two quads have to be wound
 * to match. The blocks below keep each one's original convention.
 */
export function overrideBlock(layout: SplashLayout): string {
    const L = layout;
    return `${OVERRIDE_MARK}
// The artwork, fitted to the screen's width and pinned to the TOP edge, so whatever the
// screen's aspect leaves over is one band along the BOTTOM -- filled by bgColor, and holding
// the bar and the notice. Centring it, which is what the generated code does, would split
// that band in two and leave the bar sitting on the artwork.
updateBgVertexBuffer = function () {
    const half = (canvas.width / bg.width * bg.height) / canvas.height;
    const bottom = 1.0 - 2.0 * half;
    gl.bindBuffer(gl.ARRAY_BUFFER, bgVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
         1.0, 1.0,    1.0, 1.0,
         1.0, bottom, 1.0, 0.0,
        -1.0, 1.0,    0.0, 1.0,
        -1.0, bottom, 0.0, 0.0,
    ]), gl.STATIC_DRAW);
    // This is the only place that knows where the artwork's foot landed. Record it and let
    // the scrim size itself, so the two ways it can be too short stay in one place.
    parkingJoin = 1.0 - half;
    parkingWriteScrim();
};

// The scrim. A full-width wash from opaque at the screen's bottom edge to nothing partway
// up, drawn between the artwork and everything else -- see SplashLayout.scrim for why this
// exists rather than a colour-matched band.
//
// Its own program, because the artwork's shader samples a texture and the bar's draws a pill;
// neither can produce a vertical gradient of a flat colour. It is a dozen lines and one more
// draw call, and it is what makes the bar legible over an artwork nobody has seen yet.
let parkingScrimSolid = ${num(L.scrimSolid)};
// Where the artwork's foot fell, and where the bar's top edge is, both as fractions of the
// screen's height. Written by the two functions that know, read by parkingWriteScrim.
let parkingJoin = 0.0;
let parkingBarTop = 0.0;
let parkingScrimBuffer = null;
let parkingScrimProgram = null;
const PARKING_SCRIM_VS = \`
attribute vec4 a_Position;
varying float v_T;
void main() {
    gl_Position = vec4(a_Position.xy, 0.0, 1.0);
    v_T = a_Position.z;
}\`;
const PARKING_SCRIM_FS = \`
precision mediump float;
uniform vec4 u_Scrim;
uniform float u_Solid;
varying float v_T;
void main() {
    // v_T runs 0 at the screen's bottom edge to 1 at the top of the fade. Below u_Solid the
    // wash is flat; above it, it eases out -- smoothstep and not a straight ramp, so there is
    // no visible edge where the fade begins.
    float a = u_Scrim.a * (1.0 - smoothstep(u_Solid, 1.0, v_T));
    gl_FragColor = vec4(u_Scrim.rgb, a);
}\`;

const parkingWriteScrim = function () {
    parkingScrimSolid = Math.max(${num(L.scrimSolid)},
                                 parkingJoin + ${num(L.scrimOver)},
                                 parkingBarTop + ${num(L.scrimOver)});
    const top = parkingScrimSolid + ${num(L.scrimFade)};
    const topNdc = -1.0 + 2.0 * top;
    if (!parkingScrimBuffer) parkingScrimBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, parkingScrimBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
         1.0, -1.0,   0.0,
         1.0, topNdc, 1.0,
        -1.0, -1.0,   0.0,
        -1.0, topNdc, 1.0,
    ]), gl.STATIC_DRAW);
};

const parkingDrawScrim = function () {
    if (!parkingScrimBuffer) return;
    if (!parkingScrimProgram) {
        parkingScrimProgram = initShaders(PARKING_SCRIM_VS, PARKING_SCRIM_FS);
    }
    gl.useProgram(parkingScrimProgram);
    gl.uniform4fv(gl.getUniformLocation(parkingScrimProgram, 'u_Scrim'),
                  ${fmt(L.scrim)});
    // As a fraction of the scrim's own height, which is what v_T is measured in.
    gl.uniform1f(gl.getUniformLocation(parkingScrimProgram, 'u_Solid'),
                 parkingScrimSolid / (parkingScrimSolid + ${num(L.scrimFade)}));
    gl.bindBuffer(gl.ARRAY_BUFFER, parkingScrimBuffer);
    const aPosition = gl.getAttribLocation(parkingScrimProgram, 'a_Position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 12, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};

// The logo slot, carrying the health notice instead of a logo: fitted to a fraction of the
// width, with its BOTTOM edge a fixed fraction of the height up from the screen's bottom.
updateVertexBuffer = function () {
    const halfW = ${num(L.noticeWidth)};
    const halfH = (halfW * canvas.width / image.width * image.height) / canvas.height;
    const cy = -1.0 + 2.0 * ${num(L.noticeUp)} + halfH;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
         halfW, cy - halfH, 1.0, 1.0,
         halfW, cy + halfH, 1.0, 0.0,
        -halfW, cy - halfH, 0.0, 1.0,
        -halfW, cy + halfH, 0.0, 0.0,
    ]), gl.STATIC_DRAW);
    // Now lift the bar clear of it. halfH is an NDC half-extent, which is the strip's FULL
    // height as a fraction of the screen -- the -1..1 span and the /2 cancel, the same
    // cancellation parkingWriteBar documents -- so the strip's top edge is at
    // noticeUp + halfH of the height, and the bar's centre needs half its own height on top
    // of the gap above that.
    parkingBarUp = Math.max(${num(L.barUp)},
                            ${num(L.noticeUp)} + halfH + ${num(L.barGap)}
                            + parkingBarPx / (2.0 * canvas.height));
    parkingWriteBar();
    // The bar has moved, so the scrim has to grow to keep covering it.
    parkingWriteScrim();
};

// The bar's quad: xy in NDC, zw the uv across and down it, four floats a vertex. The vertex
// order is the generated one (right-bottom, right-top, left-bottom, left-top), which is what
// the TRIANGLE_STRIP in drawProgressBar expects.
//
// Written by ONE function with TWO callers, because the bar is placed twice: once from
// start(), before the notice strip has loaded and its height is knowable, and again from
// updateVertexBuffer once the strip is measured and the bar has to clear it. The alternative
// -- two copies of the arithmetic -- is how the two ends of a layout drift apart.
let parkingBarPx = 1.0;
let parkingBarUp = ${num(L.barUp)};
const parkingWriteBar = function () {
    const halfW = ${num(L.barWidth)};
    // A half-extent of halfW in NDC is halfW * canvas.width of PIXELS, not twice that: the
    // -1..1 span and the /2 in the pixel conversion cancel. Doubling it here once made a bar
    // of aspect 7 out of a barAspect of 14 -- twice as fat as asked for, with the feather
    // below half as wide as it should be, and nothing to say so but the look of it.
    parkingBarPx = halfW * canvas.width / ${num(L.barAspect)};
    const halfH = parkingBarPx / canvas.height;
    const cy = -1.0 + 2.0 * parkingBarUp;
    // halfH is an NDC half-extent, which is the bar's FULL height as a fraction of the screen
    // -- the same cancellation the comment above describes -- so its top edge is barUp plus
    // half of that.
    parkingBarTop = parkingBarUp + halfH / 2.0;
    // Reused, not recreated: this runs a second time once the notice is measured, and a
    // fresh buffer each time would leak the first and leave end()'s deleteBuffer with the
    // wrong one.
    if (!vertexBufferProgress) vertexBufferProgress = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBufferProgress);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
         halfW, cy - halfH, 1.0, 1.0,
         halfW, cy + halfH, 1.0, 0.0,
        -halfW, cy - halfH, 0.0, 1.0,
        -halfW, cy + halfH, 0.0, 0.0,
    ]), gl.STATIC_DRAW);
};
initProgressVertexBuffer = function () {
    parkingWriteBar();
    parkingWriteScrim();
};

// A pill, drawn as a signed distance to the segment running between the two cap centres. The
// whole thing is measured in units of the bar's HEIGHT (u.x is scaled by the aspect), which
// is what makes the caps true semicircles instead of squashed ellipses.
let parkingBarProgram = null;
const PARKING_BAR_VS = \`
attribute vec4 a_Position;
varying vec2 v_Uv;
void main() {
    gl_Position = vec4(a_Position.xy, 0.0, 1.0);
    v_Uv = a_Position.zw;
}\`;
const PARKING_BAR_FS = \`
precision mediump float;
uniform float u_CurrentProgress;
uniform vec4 u_ProgressBarColor;
uniform vec4 u_ProgressBackground;
uniform float u_Aspect;
uniform float u_Feather;
varying vec2 v_Uv;
void main() {
    vec2 p = vec2(v_Uv.x * u_Aspect, v_Uv.y);
    vec2 skeleton = vec2(clamp(p.x, 0.5, u_Aspect - 0.5), 0.5);
    float outside = distance(p, skeleton) - 0.5;
    float pill = 1.0 - smoothstep(-u_Feather, u_Feather, outside);
    float fill = 1.0 - smoothstep(u_CurrentProgress - u_Feather / u_Aspect,
                                  u_CurrentProgress + u_Feather / u_Aspect, v_Uv.x);
    vec4 c = mix(u_ProgressBackground, u_ProgressBarColor, fill);
    gl_FragColor = vec4(c.rgb, c.a * pill);
}\`;

drawProgressBar = function (_glCtx, _program, buffer, _stride, value, fill, trough) {
    if (!parkingBarProgram) {
        parkingBarProgram = initShaders(PARKING_BAR_VS, PARKING_BAR_FS);
    }
    gl.useProgram(parkingBarProgram);
    gl.uniform1f(gl.getUniformLocation(parkingBarProgram, 'u_CurrentProgress'), value);
    gl.uniform4fv(gl.getUniformLocation(parkingBarProgram, 'u_ProgressBarColor'), fill);
    gl.uniform4fv(gl.getUniformLocation(parkingBarProgram, 'u_ProgressBackground'), trough);
    gl.uniform1f(gl.getUniformLocation(parkingBarProgram, 'u_Aspect'), ${num(L.barAspect)});
    // 1.5 device pixels of antialiasing, expressed in the height units the shader works in.
    gl.uniform1f(gl.getUniformLocation(parkingBarProgram, 'u_Feather'), 1.5 / parkingBarPx);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const aPosition = gl.getAttribLocation(parkingBarProgram, 'a_Position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 4, gl.FLOAT, false, 16, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};

// draw(), reproduced so the scrim can go in the one place it belongs: OVER the artwork and
// UNDER the notice. There is no other hook -- the notice is drawn before the bar, so a scrim
// painted from inside drawProgressBar would cover the notice it exists to make readable.
//
// The generated version also draws the slogan when useDefaultLogo is set. That is patched to
// false above, and the slogan is the "Created with Cocos" line drawn straight through the
// middle of the logo, so it is dropped here rather than carried along.
draw = function () {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(bgColor[0], bgColor[1], bgColor[2], bgColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (useCustomBg) drawTexture(gl, programBg, bgTexture, bgVertexBuffer, 4);
    parkingDrawScrim();
    if (useLogo) drawTexture(gl, program, logoTexture, vertexBuffer, 4);
    drawProgressBar(gl, programProgress, vertexBufferProgress, 3, progress,
                    progressBarColor, progressBackground);
};

// The fill's own clock. \`setProgress\` records a TARGET and still resolves on the next tick,
// so loading is never held up waiting for an animation -- game.js keeps its four milestones
// (0.2, 0.4, 0.6, then end()'s 1) and the bar catches up in its own time.
let parkingTarget = 0.0;
let parkingLast = 0;
// Non-null once end() has been called: {from, at}, the run-out's start point and start time.
let parkingTail = null;
setProgress = function (val) {
    parkingTarget = val;
    return new Promise((resolve) => {
        afterTick = () => { resolve(); };
    });
};

tick = function () {
    rafHandle = requestAnimationFrame(() => {
        const now = Date.now();
        // Clamped: a first frame, or a frame after the mini-game was backgrounded, would
        // otherwise hand the easing a dt of seconds and snap the bar to its ceiling.
        const dt = parkingLast ? Math.min(0.05, (now - parkingLast) / 1000) : 0;
        parkingLast = now;
        if (parkingTail) {
            // The run-out. Takes priority over both branches below: once end() has been
            // called there is nothing left to guess about, so the fill stops chasing
            // milestones and simply arrives. See SplashLayout.tailMs.
            const k = Math.min(1.0, (now - parkingTail.at) / ${num(L.tailMs)});
            progress = parkingTail.from + (1.0 - parkingTail.from) * k;
        } else if (parkingTarget - progress > ${num(L.arrived)}) {
            // Catching up to a milestone that has landed.
            progress += (parkingTarget - progress)
                        * (1.0 - Math.exp(-${num(L.ease)} * dt));
        } else if (parkingTarget < 1.0) {
            // Close enough to have arrived, so snap the remainder and creep on towards the
            // next milestone. The snap is what makes this branch reachable AT ALL: an
            // exponential approach never actually reaches its target, so the fill would
            // asymptote onto the milestone and stop dead -- measured, the first time round,
            // as a bar that converged on 0.400 and never moved again. See SplashLayout.creep
            // and SplashLayout.arrived.
            if (progress < parkingTarget) progress = parkingTarget;
            const next = Math.min(1.0, parkingTarget + ${num(L.step)});
            progress += (next - progress) * (1.0 - Math.exp(-${num(L.creep)} * dt));
        }
        draw();
        tick();
        if (afterTick) {
            afterTick();
            afterTick = null;
        }
    });
};

// The tail: hand the run-out its start point, then hold the screen open until it lands.
// The deadline is belt and braces -- the ramp above reaches 1 in exactly tailMs, so the only
// way to need it is a tick loop that has stopped being called at all.
const parkingEnd = end;
end = function () {
    parkingTarget = 1.0;
    const started = Date.now();
    parkingTail = { from: progress, at: started };
    return new Promise((resolve) => {
        const wait = () => {
            if (progress >= 1.0 || Date.now() - started >= ${num(L.tailMs)} + 100) resolve();
            else setTimeout(wait, 16);
        };
        wait();
    }).then(() => parkingEnd()).then(() => {
        // parkingEnd deletes the generated bar's program, not ours.
        if (parkingBarProgram) {
            gl.deleteProgram(parkingBarProgram);
            parkingBarProgram = null;
        }
        if (parkingScrimProgram) {
            gl.deleteProgram(parkingScrimProgram);
            parkingScrimProgram = null;
        }
        if (parkingScrimBuffer) {
            gl.deleteBuffer(parkingScrimBuffer);
            parkingScrimBuffer = null;
        }
    });
};

`;
}

/**
 * The whole change, as a function of the file's text. Pure, so it is the half that is tested
 * (`logic/tests/patch-splash.test.ts`) -- the file I/O around it has nothing to get wrong
 * that a test could see.
 */
export function patchFirstScreen(
    src: string,
    patch: SplashPatch,
    layout: SplashLayout = GAME_LAYOUT,
): string {
    let out = assign(src, 'useCustomBg', String(patch.useCustomBg));
    out = assign(out, 'bgName', JSON.stringify(patch.bgName));
    out = assign(out, 'fitWidth', String(patch.fitWidth));
    out = assign(out, 'fitHeight', String(patch.fitHeight));
    out = assign(out, 'useLogo', String(patch.useLogo));
    out = assign(out, 'logoName', JSON.stringify(patch.logoName));
    out = assign(out, 'useDefaultLogo', String(patch.useDefaultLogo));
    out = assign(out, 'bgColor', fmt(patch.bgColor));
    out = assign(out, 'progressBarColor', fmt(patch.progressBarColor));
    out = assign(out, 'progressBackground', fmt(patch.progressBackground));

    const anchor = out.indexOf(EXPORT_ANCHOR);
    if (anchor < 0) {
        throw new Error(
            `patch-splash: no \`${EXPORT_ANCHOR}\` in ${FIRST_SCREEN}.`
            + ' The overrides have nowhere safe to go -- read the generated file and update'
            + ' EXPORT_ANCHOR.',
        );
    }
    // Cut out any block already there before writing the current one. The block always sits
    // immediately in front of the anchor, so mark..anchor is exactly it -- and replacing it
    // rather than skipping is what keeps a re-run without a rebuild honest. See OVERRIDE_MARK.
    const stale = out.indexOf(OVERRIDE_MARK);
    const head = stale >= 0 ? out.slice(0, stale) : out.slice(0, anchor);
    return `${head}${overrideBlock(layout)}${out.slice(anchor)}`;
}

function main(): void {
    const argv = process.argv.slice(2);
    const at = argv.indexOf('--build');
    // From THIS FILE's location, not the CWD. It compiles to `.tmp/gen/tools/`, so three up
    // is the repo root -- and unlike `gen-levels`' cwd convention, that holds whether npm ran
    // it from `logic/` or `tools/preview.mjs` ran it from the repo root.
    const root = path.resolve(__dirname, '..', '..', '..');
    const buildDir = at >= 0 && argv[at + 1]
        ? path.resolve(argv[at + 1])
        : path.join(root, 'game', 'build', 'wechatgame');

    const target = path.join(buildDir, FIRST_SCREEN);
    if (!fs.existsSync(target)) {
        throw new Error(`patch-splash: ${target} not found. Build the mini-game first,`
            + ' or pass --build <dir>.');
    }
    const art = ART_SOURCES.map((rel) => path.join(root, rel))
        .find((p) => fs.existsSync(p));
    if (!art) {
        throw new Error(`patch-splash: none of ${ART_SOURCES.join(' or ')} found.`
            + ' Put the loading screen artwork there -- portrait, the artwork ALONE, with no'
            + ' band and no text: it is fitted to the screen\'s width and pinned to the top,'
            + ' and the band below it is drawn in bgColor.');
    }

    // The notice is optional, and its absence turns the slot off rather than drawing a
    // missing texture: `useLogo` false is what stops `start()` even asking for the file.
    const notice = path.join(root, NOTICE_SOURCE);
    const hasNotice = fs.existsSync(notice);
    // The name in the build carries the extension of whatever was found: the first screen
    // loads it by name through `new Image()`, so the two have to agree.
    const patch: SplashPatch = {
        ...GAME_SPLASH,
        useLogo: hasNotice,
        bgName: `splash-bg${path.extname(art)}`,
    };

    fs.copyFileSync(art, path.join(buildDir, patch.bgName));
    if (hasNotice) fs.copyFileSync(notice, path.join(buildDir, patch.logoName));

    const before = fs.readFileSync(target, 'utf8');
    const after = patchFirstScreen(before, patch, GAME_LAYOUT);
    fs.writeFileSync(target, after);

    // The Cocos images are left in place. Nothing references them once the names move and
    // `useDefaultLogo` is false, they are 26KB between them, and deleting files a rebuild
    // recreates buys nothing but a diff.
    console.log(`patched  ${path.relative(root, target)}`);
    const artKb = Math.round(fs.statSync(art).size / 1024);
    console.log(`copied   ${path.relative(root, art)} -> ${patch.bgName}  (${artKb} KB)`);
    if (artKb > ART_WARN_KB) {
        console.warn('');
        console.warn(`patch-splash: WARNING -- the artwork is ${artKb} KB.`);
        console.warn("  It sits at the build's root, so all of it counts against the"
            + ` ${PACKAGE_LIMIT_KB} KB main`);
        console.warn('  package, and THAT failure shows up at upload time with a message about');
        console.warn('  the package and nothing about the splash. Export it as a JPEG, and no');
        console.warn('  wider than 1440 -- the widest phone canvas there is.');
        console.warn('');
    }
    console.log(hasNotice
        ? `copied   ${NOTICE_SOURCE} -> ${patch.logoName}`
        : `skipped  ${NOTICE_SOURCE} (absent, so the notice slot is off)`);
    console.log(before === after
        ? 'already patched (idempotent, nothing changed)'
        : 'first screen now wears the artwork, with an easing bar in the band below it');
}

if (require.main === module) main();
