#!/usr/bin/env node
// One command for a device preview: take the WeChat devtools off the build folder, build,
// then hand the settled folder back to it and print the QR code.
//
// WHY THIS EXISTS. The manual ritual had grown to five steps -- clear the cache, close the
// devtools, rebuild in Creator, reopen the project, hit preview -- and only two of them do
// anything. The one that matters is the ORDER: with MD5 Cache on, Cocos writes each output
// under its plain name and then RENAMES it to a content-hashed one, and the devtools' file
// watcher (wxfilewatcher.exe) queues both names for compilation while the project is open.
// The pre-rename name is gone by the time preview packages the queue, so preview fails with
// ENOENT on a file that never survives a build. Clearing the cache cannot help -- the ghost
// entry is made by THIS build, not left over from a previous one -- and the fix is simply to
// have the project closed in the devtools while Cocos writes.
//
// So: `close`, build, `preview`. Both tools have a CLI; this is the two of them in order.
//
// USAGE
//   node tools/preview.mjs               close, build, preview
//   node tools/preview.mjs --no-build    skip the build (you already built in Creator's GUI)
//   node tools/preview.mjs --image       write the QR to a PNG instead of the terminal
//   node tools/preview.mjs --dry-run     print the commands and resolve the tools, run nothing
//
// The build step launches its own Creator instance, so it needs Creator's GUI CLOSED on this
// project. Keep the GUI open and use --no-build: click Build there, then run this for the
// rest. Either way the devtools side is handled.
//
// Tool locations are auto-detected and can be overridden:
//   WX_DEVTOOLS_CLI=<path to cli.bat>
//   COCOS_CREATOR=<path to CocosCreator.exe>

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAME = join(REPO, 'game');
const BUILD = join(GAME, 'build', 'wechatgame');

const args = new Set(process.argv.slice(2));
const NO_BUILD = args.has('--no-build');
const AS_IMAGE = args.has('--image');
const DRY = args.has('--dry-run');

const WX_CANDIDATES = [
    process.env.WX_DEVTOOLS_CLI,
    'D:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
    'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
    'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat',
];

/** Newest installed Creator, or whatever COCOS_CREATOR points at. */
function findCreator() {
    if (process.env.COCOS_CREATOR) return process.env.COCOS_CREATOR;
    for (const root of ['C:\\ProgramData\\cocos\\editors\\Creator',
                        'D:\\ProgramData\\cocos\\editors\\Creator']) {
        if (!existsSync(root)) continue;
        // Highest version wins, compared numerically per part so 3.8.10 beats 3.8.7.
        const versions = readdirSync(root)
            .filter((v) => existsSync(join(root, v, 'CocosCreator.exe')))
            .sort((a, b) => {
                const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
                for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
                    if (d) return d;
                }
                return 0;
            });
        if (versions.length) return join(root, versions[0], 'CocosCreator.exe');
    }
    return null;
}

function findWx() {
    return WX_CANDIDATES.find((p) => p && existsSync(p)) ?? null;
}

/**
 * Run a command through to completion, streaming its output. Returns its exit status, or
 * null if it could not start.
 */
function run(label, exe, argv) {
    console.log('');
    console.log(`[preview] ${label}`);
    console.log(`  ${exe} ${argv.join(' ')}`);
    if (DRY) return 0;
    const r = spawnSync(exe, argv, { stdio: 'inherit', shell: false });
    if (r.error) {
        console.error(`[preview] ${label} could not start: ${r.error.message}`);
        return null;
    }
    return r.status;
}

/** The newest mtime anywhere under `dir`, in ms, or 0 if the directory is missing. */
function newestMtime(dir) {
    if (!existsSync(dir)) return 0;
    let newest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
    }
    return newest;
}

const wx = findWx();
if (!wx) {
    console.error('[preview] WeChat devtools CLI not found. Set WX_DEVTOOLS_CLI to its cli.bat.');
    console.error('          Tried:\n' + WX_CANDIDATES.filter(Boolean).map((p) => '            ' + p).join('\n'));
    process.exit(1);
}
console.log(`[preview] devtools cli : ${wx}`);

const creator = NO_BUILD ? null : findCreator();
if (!NO_BUILD && !creator) {
    console.error('[preview] Cocos Creator not found. Set COCOS_CREATOR to its CocosCreator.exe,');
    console.error('          or build in the GUI and re-run with --no-build.');
    process.exit(1);
}
if (creator) console.log(`[preview] creator      : ${creator}`);

// 1. Off the folder. This is the step the whole script exists for -- see the note at the top.
//    Its exit status is ignored on purpose: a devtools that is not running exits non-zero
//    and has already satisfied what we wanted.
run('closing the project in the devtools', wx, ['close', '--project', BUILD]);

// 2. Build, with nothing watching the folder.
//
//    JUDGED BY ITS OUTPUT, NOT BY ITS EXIT CODE, and that is not laziness. Creator's CLI is
//    an Electron app that exits non-zero on a perfectly ordinary quit -- observed: exit 36
//    on a build whose own log said `build Task (wechatgame) Finished in (12 s)` and which
//    had just rewritten game.js, game.json and first-screen.js. Gating on the status
//    reported a working build as a failure and sent the human off to close a GUI that was
//    already closed. So: did the folder come out coherent, and was it written just now?
if (creator) {
    const startedAt = Date.now();
    const status = run('building wechatgame', creator,
                       ['--project', GAME, '--build', 'platform=wechatgame']);
    if (status === null) process.exit(1);
    const wrote = newestMtime(BUILD);
    const coherent = existsSync(join(BUILD, 'game.js')) && existsSync(join(BUILD, 'game.json'));
    if (!coherent) {
        console.error('');
        console.error(`[preview] the build produced no usable output in ${BUILD}`);
        console.error(`          (creator exited ${status}; its log is above)`);
        process.exit(1);
    }
    // A second of slack: mtimes and Date.now() do not have to agree to the millisecond.
    if (!DRY && wrote < startedAt - 1000) {
        console.log('');
        console.log('[preview] NOTE: nothing in the build folder was rewritten');
        console.log(`          (newest file ${new Date(wrote).toLocaleString()})`);
        console.log(`          Creator may have skipped an unchanged build. Check the build`);
        console.log(`          tag on screen against what you expect.`);
    } else if (status !== 0) {
        console.log('');
        console.log(`[preview] creator exited ${status}, which it does on a normal quit --`);
        console.log(`          the output is fresh, so the build is good.`);
    }
}

// 3. Hand the settled folder back. Every name in it is final, so there is no ghost to trip on.
const qr = AS_IMAGE
    ? ['--qr-format', 'image', '--qr-output', join(REPO, '.tmp', 'preview-qr.png')]
    : ['--qr-format', 'terminal'];
const previewStatus = run('generating the preview QR', wx, ['preview', '--project', BUILD, ...qr]);
if (previewStatus === null) process.exit(1);
if (previewStatus !== 0) {
    console.error('');
    console.error(`[preview] the devtools CLI exited ${previewStatus} -- read its message above.`);
    console.error('          If it is ENOENT on a file, something was watching the folder');
    console.error('          during the build; see the note at the top of this file.');
    process.exit(1);
}

if (AS_IMAGE) console.log(`\n[preview] QR written to ${join(REPO, '.tmp', 'preview-qr.png')}`);
console.log('\n[preview] done. Scan it. No cache to clear -- see the note at the top of this file.');
