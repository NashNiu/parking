import { levelState, starsFor } from '../../game/assets/scripts/core/level-state';
import { emptyProgress, Progress } from '../../game/assets/scripts/core/progress';

/** 造一个只有指定关卡有星的存档。星数一律 3,除非另行指定。 */
function save(cleared: number[], stars: Record<number, number> = {}): Progress {
  const p = emptyProgress();
  for (const n of cleared) p.stars[n] = stars[n] ?? 3;
  return p;
}

test('空存档:第 1 关是当前关,后面全锁', () => {
  const p = emptyProgress();
  expect(levelState(p, 1)).toBe('current');
  expect(levelState(p, 2)).toBe('locked');
  expect(levelState(p, 10)).toBe('locked');
});

test('通了 1 2 3:第 4 关当前,第 5 关锁', () => {
  const p = save([1, 2, 3]);
  expect(levelState(p, 3)).toBe('done');
  expect(levelState(p, 4)).toBe('current');
  expect(levelState(p, 5)).toBe('locked');
  expect(starsFor(p, 5)).toBe(0);
});

/**
 * 这一条是整个文件存在的理由。存档里第 5 关有三星,但第 4 关没通 —— 于是"锁着"和
 * "有星"同时为真。旧代码把这两件事分别算出来,再靠调用点记得 `&&` 起来;这里要求
 * 锁赢,而且星数从状态派生,view 拿不到自相矛盾的组合。
 */
test('缺口存档:第 5 关有三星但第 4 关没通,第 5 关仍然是锁着的且不画星', () => {
  const p = save([1, 2, 3, 5]);
  expect(levelState(p, 4)).toBe('current');
  expect(levelState(p, 5)).toBe('locked');
  expect(starsFor(p, 5)).toBe(0);
});

test('starsFor 只在 done 时给真实星数', () => {
  const p = save([1, 2], { 1: 3, 2: 1 });
  expect(starsFor(p, 1)).toBe(3);
  expect(starsFor(p, 2)).toBe(1);
  expect(starsFor(p, 3)).toBe(0); // current
  expect(starsFor(p, 9)).toBe(0); // locked
});

test('全通之后最后一关是 done,越界的关号不崩', () => {
  const p = save([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(levelState(p, 10)).toBe('done');
  expect(levelState(p, 11)).toBe('current');
  expect(levelState(p, 99)).toBe('locked');
});

test.each([0, -1, 1.5, NaN])('不合法的关号 %p 不抛', (level) => {
  const p = save([1, 2]);
  expect(() => levelState(p, level)).not.toThrow();
  expect(() => starsFor(p, level)).not.toThrow();
});
