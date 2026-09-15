import { bestStars, Progress, unlockedThrough } from './progress';

/**
 * 一关在大厅里的样子,三选一。
 *
 * 一个函数而不是三个谓词,而且**顺序即优先级** —— 这是这个文件唯一的设计内容。
 *
 * 在这之前 `home-view` 自己算三件事:`open = isUnlocked(...)`、`best = bestStars(...)`、
 * `done = best > 0`,然后把星星画成 `active = open && done`。"锁着"和"有星"是两个可以
 * 同时为真的独立事实(存档有缺口时就会:通了 1235,第 4 关空着,于是第 5 关既锁着又有
 * 三星),靠每个调用点都记得把它们 `&&` 起来。少写一次就是一个自相矛盾的节点。
 *
 * 收成一个返回联合类型的函数之后,三态由类型互斥,调用点不可能同时拿到两个。
 */
export type LevelState = 'done' | 'current' | 'locked';

export function levelState(p: Progress, level: number): LevelState {
    // 锁先判,锁赢。缺口存档里第 5 关有星也照锁不误。
    if (!(level <= unlockedThrough(p))) return 'locked';
    if (bestStars(p, level) > 0) return 'done';
    return 'current';
}

/**
 * 该画几颗星。非 `done` 一律 0。
 *
 * view 只该问这个,不该自己去调 `bestStars` —— 那样就又有了第二个真值来源,
 * 而"锁着却画了三星"正是第二个真值来源造出来的那类画面。
 */
export function starsFor(p: Progress, level: number): number {
    return levelState(p, level) === 'done' ? bestStars(p, level) : 0;
}
