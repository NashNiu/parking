import { generateLevel, levelParams, GRID_COLS, GRID_ROWS } from '../../game/assets/scripts/core/level-gen';
import { validateLevel } from '../../game/assets/scripts/core/level-data';
import { isSolvable, estimateDifficulty } from '../../game/assets/scripts/core/solvability';
import { footprint } from '../../game/assets/scripts/core/move-solver';
import { CAP_SIZE } from '../../game/assets/scripts/core/types';

const IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('the same id generates the same level every time', () => {
  for (const id of IDS) {
    expect(generateLevel(id)).toEqual(generateLevel(id));
  }
});

test('different ids generate different levels', () => {
  const seen = new Set(IDS.map((id) => JSON.stringify(generateLevel(id).grid.cars)));
  expect(seen.size).toBe(IDS.length);
});

test('generated levels balance passengers against car capacity', () => {
  for (const id of IDS) {
    expect(validateLevel(generateLevel(id))).toEqual([]);
  }
});

test('generated levels are solvable', () => {
  for (const id of IDS) {
    expect(isSolvable(generateLevel(id))).toBe(true);
  }
});

test('cars never overlap and never leave the grid', () => {
  for (const id of IDS) {
    const level = generateLevel(id);
    const taken = new Set<string>();
    for (const car of level.grid.cars) {
      expect(car.x).toBeGreaterThanOrEqual(0);
      expect(car.y).toBeGreaterThanOrEqual(0);
      expect(car.x + car.w).toBeLessThanOrEqual(level.grid.cols);
      expect(car.y + car.h).toBeLessThanOrEqual(level.grid.rows);
      for (const cell of footprint(car)) {
        expect(taken.has(cell)).toBe(false);
        taken.add(cell);
      }
    }
  }
});

test('every level uses the one grid shape the camera frames', () => {
  for (const id of IDS) {
    const level = generateLevel(id);
    expect(level.grid.cols).toBe(GRID_COLS);
    expect(level.grid.rows).toBe(GRID_ROWS);
  }
});

test('car ids are unique and the level carries the id it was asked for', () => {
  for (const id of IDS) {
    const level = generateLevel(id);
    expect(level.id).toBe(id);
    const ids = level.grid.cars.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  }
});

test('the curve never asks a later level for less than an earlier one', () => {
  for (let id = 2; id <= 12; id++) {
    const prev = levelParams(id - 1), cur = levelParams(id);
    expect(cur.cars).toBeGreaterThanOrEqual(prev.cars);
    expect(cur.colors).toBeGreaterThanOrEqual(prev.colors);
    expect(cur.blockedRatio).toBeGreaterThanOrEqual(prev.blockedRatio);
  }
});

test('a later level is measurably harder than the first', () => {
  const first = estimateDifficulty(generateLevel(1));
  const last = estimateDifficulty(generateLevel(10));
  expect(last.score).toBeGreaterThan(first.score);
  expect(last.cars).toBeGreaterThan(first.cars);
});

test('a level is short enough to finish: passengers stay within the budget', () => {
  for (const id of IDS) {
    const level = generateLevel(id);
    const pax = level.loop.queue.reduce((n, g) => n + g.count, 0);
    const seats = level.grid.cars.reduce((n, c) => n + CAP_SIZE[c.cap], 0);
    expect(pax).toBe(seats);
    // 4 board per tick at 0.5s: 640 passengers is about 80 seconds of boarding.
    expect(pax).toBeLessThanOrEqual(640);
  }
});

test('a car longer than it is wide points that length at its exit', () => {
  // The view lays a car's model along the LONGER axis of its footprint and cannot rotate
  // it across (it would overflow the cell), so a 2x1 car told to exit upwards gets drawn
  // pointing sideways — its roof arrow then contradicts where it actually goes. The
  // generator must never author that contradiction: footprint follows direction.
  for (const id of IDS) {
    for (const car of generateLevel(id).grid.cars) {
      if (car.w === car.h) continue; // square: the arrow is free to point anywhere
      const vertical = car.dir === 'up' || car.dir === 'down';
      const along = vertical ? car.h : car.w;
      const across = vertical ? car.w : car.h;
      expect(`${car.w}x${car.h} dir=${car.dir}: along=${along} across=${across}`)
        .toBe(`${car.w}x${car.h} dir=${car.dir}: along=${Math.max(along, across)} across=${Math.min(along, across)}`);
    }
  }
});
