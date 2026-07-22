import { CarSpec } from './types';

export function footprint(car: CarSpec): string[] {
  const cells: string[] = [];
  for (let c = car.x; c < car.x + car.w; c++) {
    for (let r = car.y; r < car.y + car.h; r++) {
      cells.push(`${c},${r}`);
    }
  }
  return cells;
}

export function pathClear(
  car: CarSpec,
  occupied: Set<string>,
  cols: number,
  rows: number,
): boolean {
  const path: Array<[number, number]> = [];
  if (car.dir === 'up') {
    for (let c = car.x; c < car.x + car.w; c++)
      for (let r = 0; r < car.y; r++) path.push([c, r]);
  } else if (car.dir === 'down') {
    for (let c = car.x; c < car.x + car.w; c++)
      for (let r = car.y + car.h; r < rows; r++) path.push([c, r]);
  } else if (car.dir === 'left') {
    for (let r = car.y; r < car.y + car.h; r++)
      for (let c = 0; c < car.x; c++) path.push([c, r]);
  } else {
    // right
    for (let r = car.y; r < car.y + car.h; r++)
      for (let c = car.x + car.w; c < cols; c++) path.push([c, r]);
  }
  return path.every(([c, r]) => !occupied.has(`${c},${r}`));
}
