import { GameCore } from './game-core';
import { LevelData } from './types';
import { Playout, Policy, careful, decisive, keepDistinct, slip } from './play-sim';

/**
 * A player that looks ahead, so the generator can ask how hard a painting is of something
 * closer to a person than the three bots in play-sim.ts.
 *
 * WHY IT EXISTS. The bots read colours and never the lot -- none of them considers that
 * bringing out car A frees car B behind it, which is most of what a person plans in this
 * game. Measured 2026-09-24 on the nine shipped packed levels, clamped to three stalls and
 * nothing bought, the bots cleared none of them and this player cleared eight; on two
 * stalls it cleared six. The generator had been certifying every level as "needs four
 * stalls" on the bots' word. See docs/superpowers/specs/2026-09-24-strong-player-painting-design.md.
 */

/**
 * The whole state of a game, copied, so a decision can be tried without committing to it.
 *
 * A structural deep copy: prototypes are kept (`Object.create`), and a memo keeps shared
 * references shared -- `BoardingSystem` points at the same `LoopSystem` and `ParkingSystem`
 * the core owns, and a copy that duplicated them would board passengers onto a bay nothing
 * else can see. The core's systems hold only Maps, Sets, arrays and plain values (no
 * closures, no typed arrays), which is what makes this complete; a field that broke that
 * would show up as the fork-equivalence test in search-player.test.ts failing.
 */
export function forkCore(core: GameCore): GameCore {
  return fork(core, new Map()) as GameCore;
}

function fork(obj: unknown, memo: Map<object, unknown>): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  const hit = memo.get(obj as object);
  if (hit !== undefined) return hit;
  if (obj instanceof Map) {
    const out = new Map();
    memo.set(obj, out);
    for (const [k, v] of obj) out.set(fork(k, memo), fork(v, memo));
    return out;
  }
  if (obj instanceof Set) {
    const out = new Set();
    memo.set(obj, out);
    for (const v of obj) out.add(fork(v, memo));
    return out;
  }
  if (Array.isArray(obj)) {
    const out: unknown[] = new Array(obj.length);
    memo.set(obj, out);
    for (let i = 0; i < obj.length; i++) out[i] = fork(obj[i], memo);
    return out;
  }
  const out = Object.create(Object.getPrototypeOf(obj)) as Record<string, unknown>;
  memo.set(obj as object, out);
  for (const k of Object.keys(obj as object)) out[k] = fork((obj as Record<string, unknown>)[k], memo);
  return out;
}

/** Ticks before a game is called. Same as play-sim.ts's TICK_CAP. */
const TICK_CAP = 4000;

/** mulberry32, local: level-gen.ts exports one, but level-gen imports this module. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The lines each option is played out along. The three bots as they are, plus noisy
 * `decisive`. An option is valued by its BEST line -- a player only needs one way through --
 * so a varied set is what finds it.
 */
const ROLLOUTS: Policy[] = [
  decisive, careful, keepDistinct,
  slip(decisive, 0.15), slip(decisive, 0.20), slip(decisive, 0.25),
  slip(decisive, 0.15), slip(decisive, 0.20),
];

/** One tick's taps, the way play-sim.ts's `play` makes them: at most one per open stall. */
function tapPhase(g: GameCore, choose: (g: GameCore, movable: number[]) => number): void {
  let movable: number[] | null = null;
  for (let k = 0; k < g.parking.parked.length; k++) {
    if (g.getState() !== 'playing' || !g.parking.hasFreeSlot()) break;
    if (movable === null) movable = g.lot.movableCarIds();
    if (movable.length === 0) break;
    const id = choose(g, movable);
    if (id < 0 || !g.tapCar(id).ok) break;
    movable = movable.filter((m) => m !== id);
  }
}

function step(g: GameCore, buy: boolean): void {
  g.stepLoop();
  if (buy && g.needsUnlock()) g.unlockSlot();
}

/**
 * A finished line, scored. A win outranks everything, cheaper wins first. A line still
 * PLAYING at the cap is a spin -- a policy waiting on an empty stall forever -- and scores
 * below any real deadlock, or the search would prefer standing still to losing honestly.
 */
function score(g: GameCore): number {
  if (g.getState() === 'won') return 1000 - 50 * g.parking.unlocksUsed();
  if (g.getState() === 'playing') return -g.loop.remainingCount() - 500;
  return -g.loop.remainingCount();
}

/** Waiting only means something while a ring cell is free; with the ring solid nothing changes. */
function canWait(g: GameCore): boolean {
  for (const grp of g.loop.ring) if (grp === null || grp.count === 0) return true;
  return false;
}

/** `action` is a car id to tap now, or -1 for "no more taps this tick". */
function evaluate(g: GameCore, action: number, buy: boolean, salt: number): number {
  let best = -Infinity;
  let total = 0;
  for (let i = 0; i < ROLLOUTS.length; i++) {
    const pol = ROLLOUTS[i];
    const rand = rng((i + 1) * 7919 + salt);
    const h = forkCore(g);
    if (action >= 0) {
      h.tapCar(action);
      tapPhase(h, (c, mv) => pol(c, mv, rand));
    }
    step(h, buy);
    for (let t = 0; t < TICK_CAP && h.getState() === 'playing'; t++) {
      tapPhase(h, (c, mv) => pol(c, mv, rand));
      step(h, buy);
    }
    const s = score(h);
    total += s;
    if (s > best) best = s;
  }
  return best + (total / ROLLOUTS.length) * 1e-3;
}

/**
 * Play `level` looking ahead at every decision. Same rules as play-sim.ts's `play`: without
 * `buy` the bay is clamped to `unlocked`; with it, a jam buys a stall the way the device's
 * prompt does. Deterministic in `seed`.
 *
 * A TIE GOES TO THE TAP, and "no more taps" is only offered while a ring cell is free. The
 * first version of this took the first option on a tie, which was "wait", and every level
 * spun to the tick cap -- the same failure play-sim.ts documents for `careful`.
 */
export function searchPlay(level: LevelData, opts: { buy: boolean; seed: number }): Playout {
  const copy: LevelData = JSON.parse(JSON.stringify(level));
  if (!opts.buy) copy.parking.slots = copy.parking.unlocked;
  const g = new GameCore(copy);
  for (let tick = 0; tick < TICK_CAP && g.getState() === 'playing'; tick++) {
    let k = 0;
    tapPhase(g, (c, movable) => {
      const salt = (opts.seed * 1000003 + tick * 31 + k++) >>> 0;
      let bestA = movable[0];
      let bestV = evaluate(c, bestA, opts.buy, salt);
      for (const id of movable.slice(1)) {
        const v = evaluate(c, id, opts.buy, salt);
        if (v > bestV) { bestV = v; bestA = id; }
      }
      if (canWait(c) && evaluate(c, -1, opts.buy, salt) > bestV) return -1;
      return bestA;
    });
    step(g, opts.buy);
  }
  return {
    won: g.getState() === 'won',
    bought: g.parking.unlocksUsed(),
    dead: g.getState() === 'deadlock',
  };
}

/** Games still allowed. Every `searchPlay` a measurement makes takes one. */
export interface Budget { games: number }

const TRIES = 3;

function tryWin(level: LevelData, salt: number, budget: Budget | undefined): boolean {
  for (let s = 0; s < TRIES; s++) {
    if (budget) {
      if (budget.games <= 0) return false;
      budget.games--;
    }
    if (searchPlay(level, { buy: false, seed: salt * TRIES + s }).won) return true;
  }
  return false;
}

/**
 * Cleared on the bay the level ships with, nothing bought, on any of three seeds.
 *
 * A WIN IS PROOF -- the player walked a real line to the end. A loss is not: this is a
 * search, not an enumeration, and it has lost a painting on four stalls that it then won on
 * the same four stalls by another seed. So `true` is certain and `false` means "not shown".
 */
export function certifyThreeStar(level: LevelData, salt: number, budget?: Budget): boolean {
  return tryWin(level, salt, budget);
}

/**
 * Fewest opening stalls this player clears `level` on, nothing bought. Call it only on a
 * level `certifyThreeStar` passed: it starts from `unlocked` as already shown.
 *
 * An UPPER BOUND on the true figure, for the reason `certifyThreeStar` gives: a tier is
 * given up after three losses, and a cleverer player may find what three seeds did not.
 * When the budget runs out the bound it has is what it returns.
 */
export function strongDemand(level: LevelData, salt: number, budget?: Budget): number {
  let need = level.parking.unlocked;
  for (let k = need - 1; k >= 1; k--) {
    const probe: LevelData = JSON.parse(JSON.stringify(level));
    probe.parking.unlocked = k;
    if (!tryWin(probe, salt * 7 + k, budget)) break;
    need = k;
  }
  return need;
}
