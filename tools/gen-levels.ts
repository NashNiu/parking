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
import { generateLevel, levelParams, blockedTarget, fillableHoles, inwardCars, authoredLevel, levelMask, demandTarget, costTarget, BLOCKED_TOLERANCE } from '../game/assets/scripts/core/level-gen';
import { estimateDifficulty } from '../game/assets/scripts/core/solvability';
import { demandPressure, judge, mistakeCost } from '../game/assets/scripts/core/play-sim';
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
 * `--only` exists because generation is slow: `TUNNEL_ATTEMPTS` is 4000 packing attempts where
 * a tunnel-free level runs 200. Measured end to end on this machine, `--only 2` (no tunnel) is
 * 1m57s and `--only 4` (one tunnel) is 4m30s, so regenerating all ten to look at one of them is
 * well over half an hour. Every id is seeded from the id alone, so writing one level cannot
 * disturb any other -- the files this does not touch stay exactly as they were.
 *
 * (This paragraph said 400 and "about 150 seconds to pack". The constant is 4000, ten times
 * that, and the 150 was derived from the wrong figure. Both are measured now.)
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
    // 实际车数,不是曲线的名义车数 —— 车数是结果(spec §2.3),而搜索瞄的也是这个数。
    const target = blockedTarget(id, level.lot.cars.length, (level.lot.tunnels ?? []).length);
    const onTarget = Math.abs(got.blocked - target) <= BLOCKED_TOLERANCE && got.rounds >= want.minRounds;
    // An AUTHORED level (see TEACH_CARS) never went through the search, so scoring it against
    // the curve's blocked target would print NEAREST MISS on a level that was not aiming at
    // it. The holes and inward columns are meaningless for one too -- a deliberately sparse
    // lot is all holes -- and this word is what says so.
    const authored = authoredLevel(id) !== null;
    // Played the way a device plays it: a jam is a bill, not an ending. `perfect` is what a
    // clean run has to buy and MUST be 0, or three stars are out of reach; `cost` is what a
    // run with one tap in ten going astray buys, which is the price of a mistake and the
    // thing the curve is made of. A level below the colour floor cannot be made to cost
    // anything, and prints `teach` instead of failing. See core/play-sim.ts.
    const v = judge(level);
    const cost = want.colors <= 4 ? 0 : mistakeCost(level);
    const play = want.colors <= 4 ? 'teach'
        : v.dead ? 'BROKEN: no way through with every stall open'
        : v.demand > level.parking.unlocked ? 'NO 3-STAR RUN: the bay it ships with is not enough'
        : `needs ${v.demand} of ${level.parking.unlocked} stalls, a slip costs ${cost.toFixed(1)}`;
    // Holes, because a level can hit every difficulty number and still ship with a
    // car-shaped patch of bare asphalt in it -- which is a bug you can only see. See
    // `fillableHoles`; the search ranks its candidates on this, so this column is how you
    // check the ranking is doing anything.
    // 与候选排名同一个判据(`levelMask`):形状外面的空地不是洞。不带它的话,菱形关
    // 这一列会把四个**故意**空着的角打印成一串 big 洞,而排名看到的根本不是这个数。
    const h = fillableHoles(level, [], levelMask(id));
    // big/medium/small, in that order, because they do not read the same: one BIG hole is a
    // car-shaped rectangle of bare asphalt and looks broken, while three small ones look
    // like a car park with room in it. The search ranks on exactly this order.
    const holes = `${h.big}/${h.medium}/${h.small}`;
    // Cars driving ACROSS the lot rather than off the nearest edge -- the other thing the
    // candidate ranking chooses on, and the one that silently regressed when it did not.
    const inward = `${Math.round(inwardCars(level) / level.lot.cars.length * 100)}%`;
    // 环上平均有几种颜色是车位一个都没在接的 —— 唯一能分辨"勉强 hard"和"死死卡住"的
    // 一列。`play` 那一列在四个车位下十关全是 hard,它分不出难度,只分得出有没有崩。
    // 见 `demandPressure`。
    const gap = authored ? '-' : demandPressure(level).gap.toFixed(2);
    // 错一步值多少钱,以及曲线要的是多少 —— 单位是被迫买下的车位数。这是**难度列**。
    // 在它之前的每一版难度列量的都是"一个永远不能开车位的玩家会不会输",而真机上没有
    // 这个玩家;按真机的方式打,上一版发出去的十关全部零消耗满星。见 `judge`。
    // 同时能开出去几种颜色 —— 人类伙伴点名的那个旋钮,越小越难。配色搜索先按它筛
    // 候选(不用跑模拟),再对最窄的那批花模拟。见 `exitWidth`。
    const width = v.width.toFixed(2).padStart(5);
    // 开局给四个车位,这一关最少用几个就能过 —— 人类伙伴一直在报的那个数。四个里只要
    // 两个,另外两个就是摆设。这是**难度列**;`cost` 是同一档里的平手判据。
    const stalls = want.colors <= 4 ? '  -  '
        : `${v.demand}/${demandTarget(id)}`.padStart(5);
    const slip = want.colors <= 4 ? '  -  '
        : `${cost.toFixed(1)}/${costTarget(id).toFixed(1)}`.padStart(7);
    rows.push(
        `${String(id).padStart(3)} ${String(got.cars).padStart(5)} ${String(got.colors).padStart(7)}`
        + ` ${String(got.blocked).padStart(8)}/${String(target).padEnd(3)}`
        + ` ${String(got.rounds).padStart(7)}/${String(want.minRounds).padEnd(3)}`
        + ` ${String(got.score).padStart(6)} ${String(pax).padStart(5)} ${tun.padStart(5)}`
        + ` ${holes.padStart(7)} ${inward.padStart(6)} ${gap.padStart(5)} ${width} ${stalls} ${slip}`
        + `  ${(authored ? 'AUTHORED' : onTarget ? 'on target' : 'NEAREST MISS').padEnd(13)} ${play}`,
    );
}

console.log(`\nwrote ${ids.length - failed} level(s) to ${outDir}\n`);
console.log(' id  cars  colors  blocked/want  rounds/min  score   pax   tun   holes inward   gap width stalls    slip  packing       play');
console.log(rows.join('\n'));
console.log('');

if (failed > 0) process.exit(1);
