import { LevelData } from './types';
import { validateLevel } from './level-data';
import { LotSystem } from './lot-system';

/**
 * Greedily remove every currently-exitable car, round by round. Because exitability is
 * monotone under removals, this is complete: if it stalls with cars remaining, they are a
 * mutual-block cycle and the lot is unclearable.
 *
 * Runs on a `LotSystem` rather than on the level's car array, and that is what makes it
 * right in the presence of tunnels: a removal can PUT A NEW CAR ON THE BOARD, and a walk
 * over a static array would clear the lot on paper while the tunnels were still full. The
 * new car deliberately does not get to leave in the round that produced it -- `movable` is
 * taken once at the top -- so `rounds` still counts "waves", and draining a tunnel of n
 * cars costs n of them.
 *
 * Termination is unchanged in substance: every round removes at least one car, and the total
 * number of cars (on the board plus inside every tunnel) is finite and never grows.
 */
function clearGrid(level: LevelData): { cleared: boolean; rounds: number; blocked: number } {
    const lot = new LotSystem(
        { w: level.lot.w, h: level.lot.h }, level.lot.cars, level.lot.tunnels ?? [],
    );
    const blocked = Array.from(lot.cars.keys()).filter((id) => !lot.canExit(id)).length;

    let rounds = 0;
    while (lot.cars.size > 0) {
        const movable = lot.movableCarIds();
        if (movable.length === 0) return { cleared: false, rounds, blocked };
        for (const id of movable) lot.removeCar(id);
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
    const tunnelCars = (level.lot.tunnels ?? []).flatMap((t) => t.cars);
    const cars = level.lot.cars.length + tunnelCars.length;
    const colors = new Set([
        ...level.lot.cars.map((c) => c.color),
        ...tunnelCars.map((c) => c.color),
    ]).size;
    const score = r.rounds * 3 + r.blocked * 2 + cars + colors;
    return { rounds: r.rounds, cars, colors, blocked: r.blocked, score };
}
