import { LevelData } from './types';
import { validateLevel } from './level-data';
import { pathClear } from './move-solver';

/** Greedily remove every currently-exitable car, round by round. Because
 * exitability is monotone under removals, this is complete: if it stalls with
 * cars remaining, they are a mutual-block cycle and the grid is unclearable. */
function clearGrid(level: LevelData): { cleared: boolean; rounds: number; blocked: number } {
    const lot = { w: level.lot.w, h: level.lot.h };
    let remaining = level.lot.cars.slice();
    const blocked = remaining.filter((c) => !pathClear(c, remaining, lot)).length;

    let rounds = 0;
    while (remaining.length > 0) {
        const exitable = remaining.filter((c) => pathClear(c, remaining, lot));
        if (exitable.length === 0) return { cleared: false, rounds, blocked };
        const ids = new Set(exitable.map((c) => c.id));
        remaining = remaining.filter((c) => !ids.has(c.id));
        rounds++;
    }
    return { cleared: true, rounds, blocked };
}

export function isSolvable(level: LevelData): boolean {
    if (validateLevel(level).length > 0) return false;
    return clearGrid(level).cleared;
}

export interface Difficulty {
    rounds: number;
    cars: number;
    colors: number;
    blocked: number;
    score: number;
}

export function estimateDifficulty(level: LevelData): Difficulty {
    const r = clearGrid(level);
    const cars = level.lot.cars.length;
    const colors = new Set(level.lot.cars.map((c) => c.color)).size;
    const score = r.rounds * 3 + r.blocked * 2 + cars + colors;
    return { rounds: r.rounds, cars, colors, blocked: r.blocked, score };
}
