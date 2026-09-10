import {
  ART_SOURCES, ART_WARN_KB, GAME_LAYOUT, GAME_SPLASH, overrideBlock, OVERRIDE_MARK,
  PACKAGE_LIMIT_KB, patchFirstScreen, SplashPatch,
} from '../../tools/patch-splash';

/**
 * A sample of the generated first screen: every variable the patch rewrites, a mention of
 * some of those names inside a function body which the patch must NOT touch, and the export
 * line the override block is inserted in front of.
 *
 * Copied from `game/build/wechatgame/first-screen.js` as Cocos Creator 3.8.7 generates it.
 */
const SAMPLE = `
let progress = 0.0;
let progressBarColor = [61 / 255, 197 / 255, 222 / 255, 1];
let progressBackground = [100 / 255, 111 / 255, 118 / 255, 1];
let bgColor = [0.01568627450980392,0.03529411764705882,0.0392156862745098,0.00392156862745098];
let useCustomBg = false;
let useLogo = true;
let useDefaultLogo = true;
let logoName = 'logo.png';
let bgName = 'background.png';
let fitWidth = true;
let fitHeight = false;

function start() {
    useLogo && loadImage(logoName).then(() => {
        return useLogo && useDefaultLogo && loadSlogan('slogan.png');
    });
    useCustomBg && loadBackground(bgName);
}
module.exports = { start, end, setProgress };
`;

test('the artwork is turned on, is ours, and is fitted to the width', () => {
  const out = patchFirstScreen(SAMPLE, GAME_SPLASH);
  expect(out).toContain('let useCustomBg = true;');
  expect(out).toContain(`let bgName = "${GAME_SPLASH.bgName}";`);
  expect(out).toContain('let fitWidth = true;');
  expect(out).toContain('let fitHeight = false;');
  expect(out).not.toContain("let bgName = 'background.png';");
});

test('the logo slot carries the notice, and the Cocos slogan is off', () => {
  const out = patchFirstScreen(SAMPLE, GAME_SPLASH);
  expect(out).toContain(`let logoName = "${GAME_SPLASH.logoName}";`);
  expect(out).toContain('let useDefaultLogo = false;');
  expect(out).not.toContain("let logoName = 'logo.png';");
  expect(out).not.toContain('let useDefaultLogo = true;');
});

/**
 * `useLogo` is the switch `main()` throws when there is no notice strip on disk: with it
 * false, `start()` never asks for the file at all, so a missing notice is a slot that is not
 * drawn rather than a texture that fails to load.
 */
test('the notice slot can be turned off without touching anything else', () => {
  const off: SplashPatch = { ...GAME_SPLASH, useLogo: false };
  expect(patchFirstScreen(SAMPLE, off)).toContain('let useLogo = false;');
  expect(patchFirstScreen(SAMPLE, GAME_SPLASH)).toContain('let useLogo = true;');
});

test('the patch recolours the band and the progress bar', () => {
  const out = patchFirstScreen(SAMPLE, GAME_SPLASH);
  expect(out).toContain('let bgColor = [0.439216, 0.454902, 0.478431, 1];');
  expect(out).toContain('let progressBarColor = [0.980392, 0.768627, 0.243137, 1];');
  expect(out).toContain('let progressBackground = [0.227451, 0.258824, 0.321569, 1];');
});

/**
 * The names it rewrites also appear inside `start()`, and a patch that matched those would
 * corrupt the file into something that fails at runtime rather than visibly.
 */
test('a mention inside a function body is left alone', () => {
  const out = patchFirstScreen(SAMPLE, GAME_SPLASH);
  expect(out).toContain('useLogo && loadImage(logoName).then(() => {');
  expect(out).toContain("return useLogo && useDefaultLogo && loadSlogan('slogan.png');");
  expect(out).toContain('useCustomBg && loadBackground(bgName);');
});

/**
 * THE ONE THAT MATTERS FOR THE OVERRIDES. `module.exports` captures the VALUES of `end` and
 * `setProgress`, so a block inserted after that line would reassign bindings nothing
 * exported reads: game.js would go on calling the originals, the bar would jump in four
 * steps exactly as before, and there would be no error anywhere to say why.
 */
test('the override block goes in FRONT of the export line', () => {
  const out = patchFirstScreen(SAMPLE, GAME_SPLASH);
  expect(out.indexOf(OVERRIDE_MARK)).toBeGreaterThan(0);
  expect(out.indexOf(OVERRIDE_MARK))
    .toBeLessThan(out.indexOf('module.exports = { start, end, setProgress };'));
});

test('the override block reassigns, and does not redeclare, what it takes over', () => {
  const block = overrideBlock(GAME_LAYOUT);
  for (const name of ['updateBgVertexBuffer', 'updateVertexBuffer',
                      'initProgressVertexBuffer', 'drawProgressBar', 'setProgress', 'tick',
                      'end']) {
    expect(block).toContain(`${name} = function`);
    // Reassignment, never redeclaration -- see the duplicate-declaration test below.
    expect(block).not.toContain(`function ${name}(`);
  }
});

/**
 * A SyntaxError in the block is invisible here and fatal on a phone: it is inserted into
 * generated output that nothing type-checks and no bundler parses, so the first thing that
 * reads it is the mini-game's own engine, at which point the screen is blank. `new Function`
 * parses the body without running it, which is exactly the check that is missing otherwise.
 */
test('the override block is parseable JavaScript', () => {
  // eslint-disable-next-line no-new-func
  expect(() => new Function(overrideBlock(GAME_LAYOUT))).not.toThrow();
});

/**
 * THE OTHER SILENT-FATAL ONE. The block sits at the generated file's module scope, so a
 * `let` or `const` there whose name the generated file already declares is a duplicate
 * declaration -- a SyntaxError for the whole file, again with a blank screen as the symptom.
 * Prefixing every name the block introduces is what keeps that impossible, so the test is on
 * the prefix rather than on a list of Cocos's own names, which the next version will change.
 */
test('every name the block declares is prefixed, so it cannot collide with Cocos', () => {
  const block = overrideBlock(GAME_LAYOUT);
  const declared = [...block.matchAll(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1]);
  expect(declared.length).toBeGreaterThan(0);
  for (const name of declared) {
    expect(name).toMatch(/^(parking|PARKING_)/);
  }
});

/**
 * The layout constants have to reach the generated code as NUMBERS. They are interpolated
 * into a string, so a typo in a placeholder yields `undefined` in the shader setup rather
 * than a compile error anywhere.
 */
test('the layout numbers are interpolated, not left as placeholders', () => {
  const block = overrideBlock(GAME_LAYOUT);
  expect(block).not.toContain('undefined');
  expect(block).not.toContain('${');
  expect(block).toContain(`'u_Aspect'), ${GAME_LAYOUT.barAspect}`);
  expect(block).toContain(`${GAME_LAYOUT.barWidth}`);
  expect(block).toContain(`Math.exp(-${GAME_LAYOUT.ease} * dt)`);
});

/**
 * It must be safe to run after every build, including on a build somebody already patched --
 * and here that is not just tidiness: inserting the block twice would redeclare every
 * `parking*` name in it, which is a SyntaxError.
 */
test('patching twice changes nothing the second time', () => {
  const once = patchFirstScreen(SAMPLE, GAME_SPLASH);
  expect(patchFirstScreen(once, GAME_SPLASH)).toBe(once);
  expect(once.split(OVERRIDE_MARK).length - 1).toBe(1);
});

/**
 * THE IMPORTANT ONE. If a Cocos version renames or restructures these variables, the patch
 * has to fail loudly: the alternative is a silent no-op, which ships a build still wearing
 * the Cocos logo with nothing anywhere to say why.
 */
test('a first screen without the expected variable is an error, not a no-op', () => {
  expect(() => patchFirstScreen('let somethingElse = 1;', GAME_SPLASH))
    .toThrow(/no `let useCustomBg/);
  const noSlogan = SAMPLE.replace('let useDefaultLogo = true;', 'const useDefaultLogo = true;');
  expect(() => patchFirstScreen(noSlogan, GAME_SPLASH)).toThrow(/useDefaultLogo/);
});

/** Same reasoning, for the insertion point: no anchor means the overrides have nowhere safe. */
test('a first screen without the export line is an error too', () => {
  const noExport = SAMPLE.replace('module.exports = { start, end, setProgress };', '');
  expect(() => patchFirstScreen(noExport, GAME_SPLASH)).toThrow(/module\.exports/);
});

test('the patch it ships with is the game palette, not the Cocos one', () => {
  const p: SplashPatch = GAME_SPLASH;
  expect(p.useDefaultLogo).toBe(false);
  expect(p.useCustomBg).toBe(true);
  expect(p.bgName).not.toBe('background.png');
  expect(p.logoName).not.toBe('logo.png');
  // Opaque: the generated default has an alpha of 1/255, which is only invisible because the
  // context is created with `alpha: false`.
  expect(p.bgColor[3]).toBe(1);
});

/**
 * The animation constants, which are the ones that can be wrong in a way nobody notices
 * until a slow phone. Two of the three came out of measuring the generated block against a
 * simulated load rather than out of reasoning, and both replaced something that looked fine:
 *
 *   `step` is the milestone spacing the creep aims at, and it is what keeps the bar honest --
 *   past 0.2 the fill would drift beyond the NEXT milestone and claim a step of the load that
 *   has not begun.
 *
 *   `creep` has to be far slower than `ease`. The catch-up covers a 0.2 gap in a few hundred
 *   ms; the creep has to cover the same 0.2 over however long the phone takes, so a creep
 *   anywhere near `ease` arrives immediately and then there is nothing left to move.
 *
 *   `arrived` is the tolerance without which the creep branch is UNREACHABLE: an exponential
 *   approach never reaches its target, so the fill asymptotes onto the milestone and stops.
 */
test('the animation constants are the ones the trace was measured with', () => {
  expect(GAME_LAYOUT.step).toBeGreaterThan(0);
  expect(GAME_LAYOUT.step).toBeLessThanOrEqual(0.2);
  expect(GAME_LAYOUT.creep).toBeGreaterThan(0);
  expect(GAME_LAYOUT.creep).toBeLessThan(GAME_LAYOUT.ease / 4);
  expect(GAME_LAYOUT.arrived).toBeGreaterThan(0);
  expect(GAME_LAYOUT.arrived).toBeLessThan(0.01);
  expect(GAME_LAYOUT.tailMs).toBeGreaterThan(0);
});

/**
 * The run-out is the branch that has to ARRIVE, so it is linear and it takes priority. A
 * `parkingTail` that were checked after the milestone branches would be shadowed by them for
 * as long as the target were still below 1, and the fill would ease towards 1 instead of
 * ramping to it -- which is the visible snap the ramp was written to remove.
 */
test('the run-out is checked before the milestone branches', () => {
  const block = overrideBlock(GAME_LAYOUT);
  expect(block).toContain('if (parkingTail) {');
  expect(block.indexOf('if (parkingTail) {'))
    .toBeLessThan(block.indexOf('} else if (parkingTarget - progress >'));
  // Armed by end(), which is the only thing that knows loading is actually over.
  expect(block).toContain('parkingTail = { from: progress, at: started };');
});

/**
 * The bar is placed twice -- once before the notice strip has loaded, once after -- and both
 * placements have to come out of the same arithmetic. Two copies is how the two ends of a
 * layout drift apart.
 */
test('the bar has one writer and two callers', () => {
  const block = overrideBlock(GAME_LAYOUT);
  expect(block.split('parkingWriteBar();').length - 1).toBe(2);
  expect(block).toContain('const parkingWriteBar = function () {');
  // And the lift is what stops the notice and the bar overlapping on a short screen: the
  // strip's height follows the canvas WIDTH while barUp is a fraction of its HEIGHT, which
  // measured -16px of clearance on 16:9 and -85px on 4:3 before this existed.
  expect(block).toContain('parkingBarUp = Math.max(');
  expect(GAME_LAYOUT.barGap).toBeGreaterThan(0);
});

/**
 * The artwork's format is a package-size decision, not a preference. The first screen sits at
 * the build's root, so all of it counts against the 4MB main package -- and the build is
 * already near 2.9MB, so a multi-megabyte PNG render fails at UPLOAD, with a message about
 * the package and nothing about the splash.
 *
 * Hence JPEG first in the lookup, and hence `bgName` carrying whichever extension was found:
 * the first screen loads the file BY NAME through `new Image()`, so a .jpg on disk copied in
 * under a .png name is a texture that never arrives, on a screen with nothing to say why.
 */
test('the artwork is looked for as a JPEG before a PNG', () => {
  expect(ART_SOURCES).toHaveLength(2);
  expect(ART_SOURCES[0].endsWith('.jpg')).toBe(true);
  expect(ART_SOURCES[1].endsWith('.png')).toBe(true);
  // The shipped default names one of them, so a build with neither still reads honestly.
  expect(ART_SOURCES.some((p) => p.endsWith(GAME_SPLASH.bgName))).toBe(true);
});

test('the size warning leaves room for the rest of the package', () => {
  expect(ART_WARN_KB).toBeGreaterThan(0);
  expect(ART_WARN_KB).toBeLessThan(PACKAGE_LIMIT_KB / 4);
});

/**
 * The notice has to stay PNG. It is drawn over the artwork and the band, so it needs a
 * transparent background, and JPEG cannot carry one -- a JPEG notice would be a white slab.
 */
test('the notice slot is PNG only', () => {
  expect(GAME_SPLASH.logoName.endsWith('.png')).toBe(true);
});
