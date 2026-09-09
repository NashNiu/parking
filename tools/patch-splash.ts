/**
 * Puts this game's logo on the Cocos first screen.
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
 * WHAT IT CHANGES, all of them plain variables at the top of the generated first-screen.js:
 *
 *   logoName          which file is drawn        -> our own, copied in beside it
 *   useDefaultLogo    draws the Cocos slogan     -> false
 *   bgColor           the screen behind it       -> the home screen's navy
 *   progressBarColor  the bar                    -> the home screen's green
 *   progressBackground the bar's trough          -> a dim navy
 *
 * `useDefaultLogo` is what stops "Created with Cocos" being drawn, and it currently draws in
 * the WRONG PLACE anyway -- straight through the middle of the logo. The generated code
 * places the logo centred (`updateVertexBuffer` drops the 0.225 offset `initVertexBuffer`
 * used) while the slogan's offset formula still assumes a logo 5/12 down the screen, so on
 * any phone at devicePixelRatio 2 or 3 the two land on top of each other. Measured on this
 * build's own images (logo 140x200, slogan 452x64): at 1170x2532 the logo spans y -0.185 to
 * +0.185 and the slogan centres on +0.003.
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
    logoName: string;
    useDefaultLogo: boolean;
    bgColor: Rgba;
    progressBarColor: Rgba;
    progressBackground: Rgba;
}

/** 0..255 to the 0..1 the shaders want, so the constants below can be read off the HUD. */
function rgba(r: number, g: number, b: number, a = 1): Rgba {
    return [r / 255, g / 255, b / 255, a];
}

/**
 * The game's own splash, in the game's own colours: HomeView's BG behind it, the green of
 * its start button in the bar. The point is that the hand-off from the first screen to the
 * menu is not a change of scene.
 */
export const GAME_SPLASH: SplashPatch = {
    logoName: 'game-logo.png',
    useDefaultLogo: false,
    bgColor: rgba(24, 30, 50),
    progressBarColor: rgba(86, 199, 104),
    progressBackground: rgba(52, 62, 90),
};

/** Where our artwork lives in the repo, and what it is called once copied into a build. */
export const LOGO_SOURCE = path.join('tools', 'splash', 'logo.png');
export const FIRST_SCREEN = 'first-screen.js';

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

/**
 * The whole change, as a function of the file's text. Pure, so it is the half that is tested
 * (`logic/tests/patch-splash.test.ts`) -- the file I/O around it has nothing to get wrong
 * that a test could see.
 */
export function patchFirstScreen(src: string, patch: SplashPatch): string {
    let out = assign(src, 'logoName', JSON.stringify(patch.logoName));
    out = assign(out, 'useDefaultLogo', String(patch.useDefaultLogo));
    out = assign(out, 'bgColor', fmt(patch.bgColor));
    out = assign(out, 'progressBarColor', fmt(patch.progressBarColor));
    out = assign(out, 'progressBackground', fmt(patch.progressBackground));
    return out;
}

function main(): void {
    const argv = process.argv.slice(2);
    const at = argv.indexOf('--build');
    // Relative to the CWD, which npm makes `logic/` -- the same convention `gen-levels` uses.
    const root = path.resolve(process.cwd(), '..');
    const buildDir = at >= 0 && argv[at + 1]
        ? path.resolve(process.cwd(), argv[at + 1])
        : path.join(root, 'game', 'build', 'wechatgame');

    const target = path.join(buildDir, FIRST_SCREEN);
    if (!fs.existsSync(target)) {
        throw new Error(`patch-splash: ${target} not found. Build the mini-game first,`
            + ' or pass --build <dir>.');
    }
    const logo = path.join(root, LOGO_SOURCE);
    if (!fs.existsSync(logo)) {
        throw new Error(`patch-splash: ${logo} not found. Run tools/make-splash-logo.py,`
            + ' or put the real artwork there.');
    }

    fs.copyFileSync(logo, path.join(buildDir, GAME_SPLASH.logoName));
    const before = fs.readFileSync(target, 'utf8');
    const after = patchFirstScreen(before, GAME_SPLASH);
    fs.writeFileSync(target, after);

    // The Cocos images are left in place. Nothing references them once `logoName` moves and
    // `useDefaultLogo` is false, they are 26KB between them, and deleting files a rebuild
    // recreates buys nothing but a diff.
    console.log(`patched  ${path.relative(root, target)}`);
    console.log(`copied   ${LOGO_SOURCE} -> ${GAME_SPLASH.logoName}`);
    console.log(before === after
        ? 'already patched (idempotent, nothing changed)'
        : 'first screen now wears the game logo, no slogan, on the menu\'s own colours');
}

if (require.main === module) main();
