/**
 * Generates the shipped level files.
 *
 *   cd logic && npm run gen [count]
 *
 * There is no ts-node in this project, so `npm run gen` compiles the core plus this file
 * into .tmp/gen with the workspace's own tsc and then runs the result — no new
 * dependencies. Output goes to game/assets/resources/levels/level-N.json, and the table
 * it prints is the point: read it before committing, because it is the only view of what
 * the difficulty curve actually produced (as opposed to what it was asked for).
 *
 * The generator itself lives in core/level-gen.ts, under test in logic/tests. This file is
 * only the CLI: it must not hold any generation logic, or the tested path and the shipped
 * levels would drift.
 */
import * as fs from 'fs';
import * as path from 'path';
import { generateLevel, levelParams, blockedTarget, BLOCKED_TOLERANCE } from '../game/assets/scripts/core/level-gen';
import { estimateDifficulty } from '../game/assets/scripts/core/solvability';
import { isHardButFair } from '../game/assets/scripts/core/play-sim';
import { validateLevel, validateTrack } from '../game/assets/scripts/core/level-data';
import { CAP_SIZE } from '../game/assets/scripts/core/types';

/**
 * Which level ids to (re)generate.
 *
 *   npm run gen                -> 1..10, the shipped set
 *   npm run gen 5              -> 1..5
 *   npm run gen -- --only 8    -> level 8 alone
 *   npm run gen -- --only 4-6  -> levels 4 to 6
 *
 * `--only` exists because a tunnel level costs about 150 seconds to pack (TUNNEL_ATTEMPTS is
 * 400 where a tunnel-free level runs 200), so regenerating all ten to look at one of them is
 * twenty-odd minutes of waiting. Every id is seeded from the id alone, so writing one level
 * cannot disturb any other -- the files this does not touch stay exactly as they were.
 *
 * The `--` is npm's, not ours: without it npm eats the flag instead of passing it on.
 */
function idsToGenerate(argv: string[]): number[] {
    const flag = argv.indexOf('--only');
    if (flag === -1) {
        const count = Number(argv[2] || 10);
        return Array.from({ length: count }, (_, i) => i + 1);
    }
    const spec = argv[flag + 1] ?? '';
    const [lo, hi] = spec.split('-').map(Number);
    if (!Number.isInteger(lo) || lo < 1) {
        console.error(`[gen] --only wants an id or a range, e.g. --only 8 or --only 4-6 (got "${spec}")`);
        process.exit(1);
    }
    const last = Number.isInteger(hi) && hi >= lo ? hi : lo;
    return Array.from({ length: last - lo + 1 }, (_, i) => lo + i);
}

const ids = idsToGenerate(process.argv);
// Run from logic/ (npm sets the cwd to the package), so the repo root is one up.
const outDir = path.resolve(process.cwd(), '..', 'game', 'assets', 'resources', 'levels');

if (!fs.existsSync(outDir)) {
    console.error(`[gen] no such directory: ${outDir} — run this with \`cd logic && npm run gen\``);
    process.exit(1);
}

const rows: string[] = [];
let failed = 0;

for (const id of ids) {
    const level = generateLevel(id);
    const errors = validateLevel(level);
    const want = levelParams(id);
    const got = estimateDifficulty(level);
    // Every car in the level, tunnel cars included: they reach the bay one at a time as the
    // player empties the mouth, so they are passengers exactly as a grid car is. Counting
    // only the board would under-report a tunnel level by four to twelve cars' worth, which
    // is the difference between reading the pax budget and guessing at it.
    const tunnels = level.lot.tunnels ?? [];
    const pax = level.lot.cars.reduce((n, c) => n + CAP_SIZE[c.cap], 0)
        + tunnels.reduce((n, t) => n + t.cars.reduce((m, c) => m + CAP_SIZE[c.cap], 0), 0);
    // `2x5` reads as "two tunnels, five cars each"; `-` is a level the curve gives none.
    // Without this column the table cannot say whether the tunnels came out at all.
    const tun = tunnels.length === 0
        ? '-'
        : `${tunnels.length}x${tunnels[0].cars.length}`;

    if (errors.length > 0) {
        console.error(`[gen] level ${id} is invalid: ${errors.join('; ')}`);
        failed++;
        continue;
    }

    const trackErrors = validateTrack(level);
    if (trackErrors.length > 0) {
        console.error(`[gen] level ${level.id}: undrawable track`);
        for (const e of trackErrors) console.error(`[gen]   ${e}`);
        failed++;
        continue;
    }

    fs.writeFileSync(
        path.join(outDir, `level-${id}.json`),
        `${JSON.stringify(level, null, 2)}\n`,
        'utf8',
    );

    // Through `blockedTarget`, not recomputed here. The denominator is the cars ON THE BOARD
    // at the opening position, which is no longer `want.cars` once a tunnel holds some of the
    // budget back -- and a column that scored the level against a different target than the
    // search aimed at would print NEAREST MISS on every tunnel level.
    const target = blockedTarget(id);
    const onTarget = Math.abs(got.blocked - target) <= BLOCKED_TOLERANCE && got.rounds >= want.minRounds;
    // Played, not inferred. `hard` means the one-line rule ("keep the stalls all different")
    // loses; `fair` means a policy a player could actually arrive at wins. A level below the
    // colour floor cannot be hard whatever the generator does, and prints `teach` instead of
    // failing -- that is a curve decision, not a generation miss. See core/play-sim.ts.
    const v = isHardButFair(level);
    const play = want.colors <= 4 ? 'teach'
        : v.hard && v.fair ? `hard  (careless ${Math.round(v.carelessLoss * 100)}%)`
        : v.hard ? 'NO WAY THROUGH'
        : 'FREE: the one-line rule wins';
    rows.push(
        `${String(id).padStart(3)} ${String(got.cars).padStart(5)} ${String(got.colors).padStart(7)}`
        + ` ${String(got.blocked).padStart(8)}/${String(target).padEnd(3)}`
        + ` ${String(got.rounds).padStart(7)}/${String(want.minRounds).padEnd(3)}`
        + ` ${String(got.score).padStart(6)} ${String(pax).padStart(5)} ${tun.padStart(5)}`
        + `  ${(onTarget ? 'on target' : 'NEAREST MISS').padEnd(13)} ${play}`,
    );
}

console.log(`\nwrote ${ids.length - failed} level(s) to ${outDir}\n`);
console.log(' id  cars  colors  blocked/want  rounds/min  score   pax   tun  packing       play');
console.log(rows.join('\n'));
console.log('');

if (failed > 0) process.exit(1);
