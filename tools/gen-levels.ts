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
import { generateLevel, levelParams, BLOCKED_TOLERANCE } from '../game/assets/scripts/core/level-gen';
import { estimateDifficulty } from '../game/assets/scripts/core/solvability';
import { validateLevel, validateTrack } from '../game/assets/scripts/core/level-data';
import { CAP_SIZE } from '../game/assets/scripts/core/types';

const count = Number(process.argv[2] || 10);
// Run from logic/ (npm sets the cwd to the package), so the repo root is one up.
const outDir = path.resolve(process.cwd(), '..', 'game', 'assets', 'resources', 'levels');

if (!fs.existsSync(outDir)) {
    console.error(`[gen] no such directory: ${outDir} — run this with \`cd logic && npm run gen\``);
    process.exit(1);
}

const rows: string[] = [];
let failed = 0;

for (let id = 1; id <= count; id++) {
    const level = generateLevel(id);
    const errors = validateLevel(level);
    const want = levelParams(id);
    const got = estimateDifficulty(level);
    const pax = level.grid.cars.reduce((n, c) => n + CAP_SIZE[c.cap], 0);

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

    const target = Math.round(want.blockedRatio * want.cars);
    const onTarget = Math.abs(got.blocked - target) <= BLOCKED_TOLERANCE && got.rounds >= want.minRounds;
    rows.push(
        `${String(id).padStart(3)} ${String(got.cars).padStart(5)} ${String(got.colors).padStart(7)}`
        + ` ${String(got.blocked).padStart(8)}/${String(target).padEnd(3)}`
        + ` ${String(got.rounds).padStart(7)}/${String(want.minRounds).padEnd(3)}`
        + ` ${String(got.score).padStart(6)} ${String(pax).padStart(5)}`
        + `  ${onTarget ? 'on target' : 'NEAREST MISS'}`,
    );
}

console.log(`\nwrote ${count - failed} level(s) to ${outDir}\n`);
console.log(' id  cars  colors  blocked/want  rounds/min  score   pax');
console.log(rows.join('\n'));
console.log('');

if (failed > 0) process.exit(1);
