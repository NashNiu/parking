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
import { existsSync, readdirSync } from 'node:fs';
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
 * Run a command through to completion, streaming its output.
 *
 * `tolerate` is for steps whose failure is not a failure: closing a project in a devtools
 * that is not running exits non-zero, and that is the state we wanted anyway.
 */
function run(label, exe, argv, { tolerate = false } = {}) {
    console.log(`\n[preview] ${label}\n  ${exe} ${argv.join(' ')}`);
    if (DRY) return true;
    const r = spawnSync(exe, argv, { stdio: 'inherit', shell: false });
    if (r.error) {
        if (tolerate) return true;
        console.error(`[preview] ${label} could not start: ${r.error.message}`);
        return false;
    }
    if (r.status !== 0) {
        if (tolerate) {
            console.log(`[preview] ${label} exited ${r.status} -- ignoring, see the note above`);
            return true;
        }
        console.error(`[preview] ${label} failed (exit ${r.status})`);
        return false;
    }
    return true;
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
//    Tolerated: a devtools that is not running has already satisfied it.
if (!run('closing the project in the devtools', wx, ['close', '--project', BUILD],
         { tolerate: true })) process.exit(1);

// 2. Build, with nothing watching the folder.
if (creator) {
    const ok = run('building wechatgame', creator,
                   ['--project', GAME, '--build', 'platform=wechatgame']);
    if (!ok) {
        console.error('[preview] The build step needs Creator\'s GUI CLOSED on this project.');
        console.error('          Close it and re-run, or build in the GUI and use --no-build.');
        process.exit(1);
    }
}

// 3. Hand the settled folder back. Every name in it is final, so there is no ghost to trip on.
const qr = AS_IMAGE
    ? ['--qr-format', 'image', '--qr-output', join(REPO, '.tmp', 'preview-qr.png')]
    : ['--qr-format', 'terminal'];
if (!run('generating the preview QR', wx, ['preview', '--project', BUILD, ...qr])) process.exit(1);

if (AS_IMAGE) console.log(`\n[preview] QR written to ${join(REPO, '.tmp', 'preview-qr.png')}`);
console.log('\n[preview] done. Scan it. No cache to clear -- see the note at the top of this file.');
