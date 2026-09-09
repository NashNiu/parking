import {
  GAME_SPLASH, patchFirstScreen, SplashPatch,
} from '../../tools/patch-splash';

/**
 * A sample of the generated first screen: the variable block the patch rewrites, plus a
 * mention of one of those names inside a function body, which the patch must NOT touch.
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

function start() {
    useLogo && loadImage(logoName).then(() => {
        return useLogo && useDefaultLogo && loadSlogan('slogan.png');
    });
}
`;

test('the patch renames the logo and turns the slogan off', () => {
  const out = patchFirstScreen(SAMPLE, GAME_SPLASH);
  expect(out).toContain(`let logoName = "${GAME_SPLASH.logoName}";`);
  expect(out).toContain('let useDefaultLogo = false;');
  expect(out).not.toContain("let logoName = 'logo.png';");
  expect(out).not.toContain('let useDefaultLogo = true;');
});

test('the patch recolours the background and the progress bar', () => {
  const out = patchFirstScreen(SAMPLE, GAME_SPLASH);
  // 24/255 -- the home screen's navy, written out rather than left as a division.
  expect(out).toContain('let bgColor = [0.094118, 0.117647, 0.196078, 1];');
  expect(out).toContain('let progressBarColor = [0.337255, 0.780392, 0.407843, 1];');
  expect(out).toContain('let progressBackground = [0.203922, 0.243137, 0.352941, 1];');
});

/**
 * The names it rewrites also appear inside `start()`, and a patch that matched those would
 * corrupt the file into something that fails at runtime rather than visibly.
 */
test('a mention inside a function body is left alone', () => {
  const out = patchFirstScreen(SAMPLE, GAME_SPLASH);
  expect(out).toContain('useLogo && loadImage(logoName).then(() => {');
  expect(out).toContain("return useLogo && useDefaultLogo && loadSlogan('slogan.png');");
});

/**
 * It must be safe to run after every build, including on a build somebody already patched.
 */
test('patching twice changes nothing the second time', () => {
  const once = patchFirstScreen(SAMPLE, GAME_SPLASH);
  expect(patchFirstScreen(once, GAME_SPLASH)).toBe(once);
});

/**
 * THE IMPORTANT ONE. If a Cocos version renames or restructures these variables, the patch
 * has to fail loudly: the alternative is a silent no-op, which ships a build still wearing
 * the Cocos logo with nothing anywhere to say why.
 */
test('a first screen without the expected variable is an error, not a no-op', () => {
  expect(() => patchFirstScreen('let somethingElse = 1;', GAME_SPLASH))
    .toThrow(/no `let logoName/);
  const noSlogan = SAMPLE.replace('let useDefaultLogo = true;', 'const useDefaultLogo = true;');
  expect(() => patchFirstScreen(noSlogan, GAME_SPLASH)).toThrow(/useDefaultLogo/);
});

test('the patch it ships with is the game palette, not the Cocos one', () => {
  const p: SplashPatch = GAME_SPLASH;
  expect(p.useDefaultLogo).toBe(false);
  expect(p.logoName).not.toBe('logo.png');
  // Opaque: the generated default has an alpha of 1/255, which is only invisible because the
  // context is created with `alpha: false`.
  expect(p.bgColor[3]).toBe(1);
});
