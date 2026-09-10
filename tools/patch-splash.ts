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
 * `bgColor` is the band below the artwork, and it is the one colour here that has to be
 * chosen against the art rather than against the HUD: the artwork is fitted to the screen's
 * width, so on a tall phone it stops short of the bottom and this colour continues it. A
 * road grey, because the bottom of the artwork is asphalt -- the seam should be invisible.
 */
export const GAME_SPLASH: SplashPatch = {
    useCustomBg: true,
    bgName: 'splash-bg.png',
    // Fit to width: the artwork spans the screen and its height follows its own aspect. The
    // override below implements exactly this case and then pins it to the TOP; these two
    // variables are set to agree with it rather than to be read.
    fitWidth: true,
    fitHeight: false,
    // The logo slot, reused. `main()` turns this off when there is no notice strip to draw.
    useLogo: true,
    logoName: 'splash-notice.png',
    useDefaultLogo: false,
    bgColor: rgba(112, 116, 122),
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
    noticeWidth: 0.86,
    noticeUp: 0.028,
    ease: 8,
    creep: 0.5,
    step: 0.2,
    arrived: 0.002,
    tailMs: 280,
};

/** Where our artwork lives in the repo, and what each file is called once copied in. */
export const ART_SOURCE = path.join('tools', 'splash', 'splash-bg.png');
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

    if (out.includes(OVERRIDE_MARK)) return out;
    if (!out.includes(EXPORT_ANCHOR)) {
        throw new Error(
            `patch-splash: no \`${EXPORT_ANCHOR}\` in ${FIRST_SCREEN}.`
            + ' The overrides have nowhere safe to go -- read the generated file and update'
            + ' EXPORT_ANCHOR.',
        );
    }
    return out.replace(EXPORT_ANCHOR, `${overrideBlock(layout)}${EXPORT_ANCHOR}`);
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
    const art = path.join(root, ART_SOURCE);
    if (!fs.existsSync(art)) {
        throw new Error(`patch-splash: ${art} not found.`
            + ' Put the loading screen artwork there -- portrait, the artwork ALONE, with no'
            + ' band and no text: it is fitted to the screen\'s width and pinned to the top,'
            + ' and the band below it is drawn in bgColor.');
    }

    // The notice is optional, and its absence turns the slot off rather than drawing a
    // missing texture: `useLogo` false is what stops `start()` even asking for the file.
    const notice = path.join(root, NOTICE_SOURCE);
    const hasNotice = fs.existsSync(notice);
    const patch: SplashPatch = { ...GAME_SPLASH, useLogo: hasNotice };

    fs.copyFileSync(art, path.join(buildDir, patch.bgName));
    if (hasNotice) fs.copyFileSync(notice, path.join(buildDir, patch.logoName));

    const before = fs.readFileSync(target, 'utf8');
    const after = patchFirstScreen(before, patch, GAME_LAYOUT);
    fs.writeFileSync(target, after);

    // The Cocos images are left in place. Nothing references them once the names move and
    // `useDefaultLogo` is false, they are 26KB between them, and deleting files a rebuild
    // recreates buys nothing but a diff.
    console.log(`patched  ${path.relative(root, target)}`);
    console.log(`copied   ${ART_SOURCE} -> ${patch.bgName}`);
    console.log(hasNotice
        ? `copied   ${NOTICE_SOURCE} -> ${patch.logoName}`
        : `skipped  ${NOTICE_SOURCE} (absent, so the notice slot is off)`);
    console.log(before === after
        ? 'already patched (idempotent, nothing changed)'
        : 'first screen now wears the artwork, with an easing bar in the band below it');
}

if (require.main === module) main();
