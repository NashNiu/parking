import { LevelData, CAP_SIZE } from './types';

export function validateLevel(level: LevelData): string[] {
  const errors: string[] = [];

  const carCap: Record<string, number> = {};
  for (const c of level.grid.cars) {
    carCap[c.color] = (carCap[c.color] || 0) + CAP_SIZE[c.cap];
  }
  const paxCount: Record<string, number> = {};
  for (const g of level.loop.queue) {
    paxCount[g.color] = (paxCount[g.color] || 0) + g.count;
  }
  const colors = new Set([...Object.keys(carCap), ...Object.keys(paxCount)]);
  for (const color of colors) {
    const cap = carCap[color] || 0;
    const pax = paxCount[color] || 0;
    if (cap !== pax) {
      errors.push(`color ${color}: car capacity ${cap} != passengers ${pax}`);
    }
  }

  if (level.parking.unlocked > level.parking.slots) {
    errors.push('unlocked > slots');
  }
  return errors;
}
