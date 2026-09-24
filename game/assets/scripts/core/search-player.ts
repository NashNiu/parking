import { GameCore } from './game-core';

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
