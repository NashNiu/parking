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
