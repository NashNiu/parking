import { LevelData, CarSpec } from './types';
import { validateLevel } from './level-data';
import { footprint, pathClear } from './move-solver';

/** Union of all cars' occupied cells. A car's exit path never includes its own
 * footprint, so passing the full occupancy (self included) is harmless. */
function occupancy(cars: CarSpec[]): Set<string> {
    const s = new Set<string>();
    for (const c of cars) for (const cell of footprint(c)) s.add(cell);
    return s;
}

/** Greedily remove every currently-exitable car, round by round. Because
 * exitability is monotone under removals, this is complete: if it stalls with
 * cars remaining, they are a mutual-block cycle and the grid is unclearable. */
function clearGrid(level: LevelData): { cleared: boolean; rounds: number; blocked: number } {
    const { cols, rows } = level.grid;
    let remaining = level.grid.cars.slice();
    const initialOcc = occupancy(remaining);
    const blocked = remaining.filter((c) => !pathClear(c, initialOcc, cols, rows)).length;

    let rounds = 0;
    while (remaining.length > 0) {
        const occ = occupancy(remaining);
        const exitable = remaining.filter((c) => pathClear(c, occ, cols, rows));
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
    const cars = level.grid.cars.length;
    const colors = new Set(level.grid.cars.map((c) => c.color)).size;
    const score = r.rounds * 3 + r.blocked * 2 + cars + colors;
    return { rounds: r.rounds, cars, colors, blocked: r.blocked, score };
}
