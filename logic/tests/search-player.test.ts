import * as fs from 'fs';
import * as path from 'path';
import { forkCore } from '../../game/assets/scripts/core/search-player';
import { careful } from '../../game/assets/scripts/core/play-sim';
import { GameCore } from '../../game/assets/scripts/core/game-core';
import { LevelData } from '../../game/assets/scripts/core/types';

/** 发出去的那一关,逐字节。 */
function shipped(id: number): LevelData {
  const p = path.join(__dirname, '../../game/assets/resources/levels', `level-${id}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as LevelData;
}

/** The shipped game's tick, driven by a deterministic policy, for `ticks` ticks. */
function drive(g: GameCore, ticks: number): void {
  for (let t = 0; t < ticks && g.getState() === 'playing'; t++) {
    let movable = g.lot.movableCarIds();
    for (let k = 0; k < g.parking.parked.length; k++) {
      if (!g.parking.hasFreeSlot() || movable.length === 0) break;
      const id = careful(g, movable, () => 0);
      if (id < 0 || !g.tapCar(id).ok) break;
      movable = movable.filter((m) => m !== id);
    }
    g.stepLoop();
    if (g.needsUnlock()) g.unlockSlot();
  }
}

function signature(g: GameCore): string {
  return JSON.stringify([
    g.getState(), g.parking.unlocksUsed(), g.loop.remainingCount(), g.lot.cars.size,
  ]);
}

test('a fork played on is the same game as the one it was forked from', () => {
  // Level 10 on purpose: two tunnels, so a fork that dropped tunnel state (the mouth car,
  // the cars queued behind it) would diverge the first time a mouth empties.
  const a = new GameCore(shipped(10));
  drive(a, 60);
  const b = forkCore(a);
  drive(a, 4000);
  drive(b, 4000);
  expect(signature(b)).toBe(signature(a));
});

test('a fork shares no state with its source', () => {
  const a = new GameCore(shipped(10));
  const b = forkCore(a);
  const before = a.lot.cars.size;
  const id = b.lot.movableCarIds()[0];
  expect(b.tapCar(id).ok).toBe(true);
  expect(a.lot.cars.size).toBe(before);
  expect(b.lot.cars.size).toBe(before - 1);
  // And the shared references INSIDE the fork still point at the fork's own systems.
  expect((b as any).boarding.loop).toBe(b.loop);
  expect((b as any).boarding.parking).toBe(b.parking);
});

test('the search player takes no input but its seed', () => {
  // Same guard as level-gen.test.ts's source check, for the module the generator now calls.
  const src = fs.readFileSync(
    path.join(__dirname, '../../game/assets/scripts/core/search-player.ts'), 'utf8',
  );
  const code = src.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');
  expect(code).not.toMatch(/Math\.random\s*\(/);
  expect(code).not.toMatch(/Date\.now\s*\(/);
  expect(code).not.toMatch(/new Date\s*\(/);
});

import { searchPlay, certifyThreeStar, strongDemand } from '../../game/assets/scripts/core/search-player';
import { decisive, keepDistinct, simulate } from '../../game/assets/scripts/core/play-sim';

// Copied from play-sim.test.ts, where they are local: one red car and 16 red passengers.
function soloLevel(): LevelData {
  return {
    id: 1,
    lot: { w: 2, h: 2, cars: [
      { id: 1, x: 0, y: 0, angle: 90, color: 'red', cap: 'small' },
    ] },
    parking: { slots: 4, unlocked: 4 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

/** Three green cars and a red-only queue: whatever is parked can never fill. */
function hopelessLevel(): LevelData {
  return {
    id: 5,
    lot: { w: 4, h: 2, cars: [
      { id: 1, x: -1.2, y: 0, angle: 90, color: 'green', cap: 'small' },
      { id: 2, x: 0, y: 0, angle: 90, color: 'green', cap: 'small' },
      { id: 3, x: 1.2, y: 0, angle: 90, color: 'green', cap: 'small' },
    ] },
    parking: { slots: 3, unlocked: 2 },
    loop: { capacity: 4, boardIndex: 2, queue: [{ color: 'red', count: 16 }] },
    powerups: { refresh: 0, hardClear: 0, magnet: 0 },
  };
}

test('a trivial level is certified and needs one stall', () => {
  expect(certifyThreeStar(soloLevel(), 1)).toBe(true);
  expect(strongDemand(soloLevel(), 1)).toBe(1);
});

test('a level nothing can fill is not certified, and the player stops', () => {
  // Also the termination guard: this must come back as a loss inside TICK_CAP, not spin.
  expect(certifyThreeStar(hopelessLevel(), 1)).toBe(false);
  expect(searchPlay(hopelessLevel(), { buy: true, seed: 1 }).won).toBe(false);
});

test('it clears a shipped level on fewer stalls than every bot can', () => {
  // Level 6 on TWO stalls, nothing bought: all three bots lose it, this player clears it.
  // Chosen as the cheapest such witness measured 2026-09-24 -- about 9 s under plain node
  // (level 4 on three stalls, the plan's first choice, ran 437 s under ts-jest). Seeds
  // 1, 2, 3 and 7 all won it.
  const lvl = shipped(6);
  lvl.parking.unlocked = 2;
  lvl.parking.slots = 2;
  for (const pol of [decisive, careful, keepDistinct]) expect(simulate(lvl, pol, 1)).toBe(false);
  expect(searchPlay(lvl, { buy: false, seed: 7 }).won).toBe(true);
}, 900000);

test('the same seed plays the same game', () => {
  // Determinism is structural -- the source check above forbids ambient entropy -- so this
  // is a cheap backstop on a level with real decisions in it, not the proof.
  const lvl = hopelessLevel();
  expect(searchPlay(lvl, { buy: true, seed: 3 })).toEqual(searchPlay(lvl, { buy: true, seed: 3 }));
  expect(searchPlay(soloLevel(), { buy: false, seed: 3 }))
    .toEqual(searchPlay(soloLevel(), { buy: false, seed: 3 }));
});

test('a budget that runs out stops the measuring deterministically', () => {
  // Nothing left: no game is played, certification cannot be claimed.
  const none = { games: 0 };
  expect(certifyThreeStar(soloLevel(), 1, none)).toBe(false);
  expect(none.games).toBe(0);
  // One game: it certifies, then has nothing left to try lower tiers with, so the demand it
  // reports is the upper bound it already has -- the full bay -- not a guess.
  const one = { games: 1 };
  expect(certifyThreeStar(soloLevel(), 1, one)).toBe(true);
  expect(one.games).toBe(0);
  expect(strongDemand(soloLevel(), 1, one)).toBe(soloLevel().parking.unlocked);
});
