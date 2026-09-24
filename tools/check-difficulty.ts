/**
 * The difficulty of the SHIPPED levels, measured by the player that looks ahead.
 *
 *   cd logic && npm run check              -> levels 2..10
 *   cd logic && npm run check -- --only 4  -> level 4 alone
 *
 * Slow on purpose and outside jest for that reason: a level is minutes of lookahead play.
 * It replaces two jest tests that asked the bots the same questions ("three stars are
 * reachable", "every level asks for the whole bay") -- the bots' answers turned out to say
 * little about a player who reads the lot. Exits 1 if any packed level cannot be shown
 * three-star on the bay it ships with.
 */
import * as fs from 'fs';
import * as path from 'path';
import { certifyThreeStar, strongDemand } from '../game/assets/scripts/core/search-player';
import { judge, exitWidth } from '../game/assets/scripts/core/play-sim';
import { LevelData } from '../game/assets/scripts/core/types';

const dir = path.resolve(process.cwd(), '..', 'game', 'assets', 'resources', 'levels');
const flag = process.argv.indexOf('--only');
const ids = flag >= 0 ? [Number(process.argv[flag + 1])] : [2, 3, 4, 5, 6, 7, 8, 9, 10];

let failed = 0;
console.log(' id  三星认证  强玩家车位  机器人车位  width   用时');
for (const id of ids) {
  const level = JSON.parse(fs.readFileSync(path.join(dir, `level-${id}.json`), 'utf8')) as LevelData;
  const colors = new Set(level.lot.cars.map((c) => c.color)).size;
  if (colors <= level.parking.unlocked) {
    console.log(`${String(id).padStart(3)}  (教学关,颜色不多于车位,跳过)`);
    continue;
  }
  const t0 = process.hrtime.bigint();
  const ok = certifyThreeStar(level, id);
  const strong = ok ? String(strongDemand(level, id)) : '-';
  const bot = judge(level).demand;
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  if (!ok) failed++;
  console.log(
    `${String(id).padStart(3)}  ${(ok ? '通过' : '未通过').padStart(6)}  ${strong.padStart(8)}  ${String(bot).padStart(8)}`
    + `  ${exitWidth(level).toFixed(2).padStart(5)}  ${secs.toFixed(0).padStart(4)}s`,
  );
}
if (failed > 0) {
  console.error(`\n[check] ${failed} 个关卡证明不了三星(开局车位、不买车位)`);
  process.exit(1);
}
