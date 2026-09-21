/**
 * Calibrates BAND_CURVE.
 *
 *   cd logic && npm run sweep [-- --only 4-6]
 *
 * For each level id: generate it once, then rebuild its queue with `bandedQueue` at a grid of
 * offsets and report `isHardButFair` for each. Prints one row per (id, offset).
 *
 * Why re-band a generated level rather than regenerate per offset: `choosePainting` runs
 * up to eleven simulations per painting and up to 400 paintings, so a generation is minutes. The
 * level's cars are in leaving order (`scatter` numbers them along `peel`), so this tool can
 * author any offset's queue from the level file itself for the price of one simulation set.
 *
 * WHAT TO PICK, and this changed again on 2026-09-21: among the cells that are hard, take the
 * one whose `forgive` is closest to this id's `forgiveTarget`. That is the same objective
 * `choosePainting` now minimises, and the two composing is the whole point -- back when the
 * sweep optimised one thing and the painting search optimised another, every moved offset
 * landed at 0.6 to 0.8 of what the sweep had predicted.
 *
 * The two rules this replaces were both wrong, in the same direction. "Take a passing offset"
 * left most of the dial unused because `hard` saturates. "Take the largest `gap`" used a
 * metric only weakly related to whether a person loses: on the levels shipped under it, id 7
 * carried the largest gap of the ten (2.04) and was the most forgiving level in the game,
 * winning every clumsy playthrough, while id 3 carried nearly the smallest (1.09) and lost
 * more than half. `gap` says WHY a level bites; `forgive` says WHETHER it does.
 *
 * A cell that is hard but NOT fair is not out: my human partner has said a level or two may
 * require buying a stall to finish. `choosePainting` prices those at `UNFAIR_COST` rather
 * than rejecting them, so rank them here the same way -- admissible, for two or three ids,
 * and chosen rather than drifted into.
 *
 * The consequence, and it matters: a row says "which offsets suit THIS packing and painting",
 * not "which offset the generator would settle on". The loop is therefore -- sweep, put the
 * passing offsets in BAND_CURVE, regenerate, sweep again to confirm -- and the second sweep
 * is the one that counts, because by then the painting was searched at the offset it shipped
 * with. Two rounds have always been enough; if a level will not settle, that is a level whose
 * offset the curve is asking too much of, and the answer is a smaller one.
 */
import { generateLevel, bandedQueue, bandParams } from '../game/assets/scripts/core/level-gen';
import { demandPressure, isHardButFair } from '../game/assets/scripts/core/play-sim';
import { LevelData } from '../game/assets/scripts/core/types';

/** Offsets to try, in rows. 0 is included because it is the measured free end. */
const OFFSETS = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40];

/** Interleave depths to try. 1 is car-by-car, the shipped behaviour. */
const INTERLEAVES = [1, 2, 3];

function idsToSweep(argv: string[]): number[] {
    const flag = argv.indexOf('--only');
    if (flag < 0) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const arg = argv[flag + 1] ?? '';
    const range = arg.split('-').map((s) => Number(s));
    const from = range[0];
    const to = range.length > 1 ? range[1] : from;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
    const out: number[] = [];
    for (let i = from; i <= to; i++) out.push(i);
    return out;
}

for (const id of idsToSweep(process.argv.slice(2))) {
    const level = generateLevel(id);
    const tunnels = level.lot.tunnels ?? [];
    const curve = bandParams(id);
    for (const offset of OFFSETS) {
        for (const interleave of INTERLEAVES) {
            const probe: LevelData = JSON.parse(JSON.stringify(level));
            probe.loop.queue = bandedQueue(level.lot.cars, tunnels, offset, interleave);
            const v = isHardButFair(probe);
            const g = demandPressure(probe);
            const mark = offset === curve.offset && interleave === curve.interleave ? ' <- curve' : '';
            process.stdout.write(
                `L${id} offset=${String(offset).padStart(3)} il=${interleave} `
                + `hard=${v.hard ? 'Y' : 'n'} fair=${v.fair ? 'Y' : 'n'} `
                + `careless=${v.carelessLoss.toFixed(1)} `
                // 难度列。hard/fair 是两个饱和的 bit,gap 量的是结构,只有这个量的是
                // "一个偶尔手滑的玩家会不会输"。见 `forgiveness`。
                + `forgive=${v.forgive.toFixed(2)} `
                + `gap=${g.gap.toFixed(2)} ring=${g.ring.toFixed(1)} stuck=${g.starved.toFixed(2)}${mark}\n`,
            );
        }
    }
}
