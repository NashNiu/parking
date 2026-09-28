import {
    backfilledWallet, balance, coinsForClear, coinsFromProgress, earn, emptyWallet,
    LedgerEntry, LEDGER_MAX, parseWallet, serializeWallet, spend, unlockPrice,
    UNLOCK_PRICES, Wallet, WALLET_VERSION,
} from '../../game/assets/scripts/core/wallet';
import { emptyProgress, recordClear } from '../../game/assets/scripts/core/progress';

const T = 1758499200000; // 2026-09-22T00:00:00Z,任意但固定

/**
 * 三张数值表,写成 LITERAL。
 *
 * 本文件其余断言都读常量本身 —— 那对"算术对不对"是合适的,但会让"数字是几"完全不设防:
 * 调换两项或少写一位,整个套件照样全绿。产品定下的数字在这里钉一次,改它就必须是对这几行的
 * 蓄意编辑。
 */
test('the agreed figures', () => {
    expect(UNLOCK_PRICES).toEqual([20, 40, 80]);
    expect(LEDGER_MAX).toBe(100);
    expect(WALLET_VERSION).toBe(2);
});

// ---------- 不变式 ----------

/**
 * 整个模型压在这一条上:余额不是存的,是算的。任何一串收支之后它都必须等于期初加流水之和,
 * 否则面板里那串明细就解释不了顶栏那个数字 —— 而单机游戏没有任何对账机制能发现这种不一致。
 */
test('balance is always opening plus the log', () => {
    let w = emptyWallet();
    w = earn(w, 'clear', 60, 1, T, 3);
    w = earn(w, 'checkin', 20, 1, T);
    w = spend(w, 'unlock', 20, 2, T)!;
    w = earn(w, 'clear', 40, 2, T, 2);
    expect(balance(w)).toBe(100);
    expect(balance(w)).toBe(w.opening + w.log.reduce((s, e) => s + e.n, 0));
});

test('an empty wallet holds nothing', () => {
    expect(emptyWallet()).toEqual({ version: WALLET_VERSION, opening: 0, log: [] });
    expect(balance(emptyWallet())).toBe(0);
});

// ---------- 滚动淘汰 ----------

/**
 * 明细滚掉了,钱一分不少。这是 LEDGER_MAX 存在的全部理由,也是它唯一可能出错的地方:
 * 丢掉最老一条而不把它折进 opening,余额就会凭空缩水。
 */
test('the oldest entry folds into opening, not into thin air', () => {
    let w = emptyWallet();
    for (let i = 0; i < LEDGER_MAX; i++) w = earn(w, 'checkin', 10, 1, T);
    expect(w.log).toHaveLength(LEDGER_MAX);
    expect(w.opening).toBe(0);
    expect(balance(w)).toBe(LEDGER_MAX * 10);

    w = earn(w, 'clear', 7, 1, T, 1);
    expect(w.log).toHaveLength(LEDGER_MAX);
    expect(w.opening).toBe(10);                      // 最老那条被折进来
    expect(balance(w)).toBe(LEDGER_MAX * 10 + 7);    // 总额不变
    expect(w.log[w.log.length - 1].n).toBe(7);       // 新的在最后
});

/**
 * 一份长度已经越界的存档(旧版本、手改)也要能被收进上限,所以淘汰写成循环而不是"丢掉第一条"。
 */
test('an over-long log is folded down, not merely trimmed by one', () => {
    const log: LedgerEntry[] = [];
    for (let i = 0; i < LEDGER_MAX + 5; i++) log.push({ t: T, why: 'checkin', n: 10, ref: 1 });
    const over: Wallet = { version: WALLET_VERSION, opening: 0, log };
    const w = parseWallet(JSON.stringify(over)).wallet;
    expect(w.log).toHaveLength(LEDGER_MAX);
    expect(balance(w)).toBe((LEDGER_MAX + 5) * 10);
});

// ---------- earn / spend ----------

test.each([
    ['zero', 0],
    ['negative', -20],
    ['a fraction', 12.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
])('earn of %s writes no row and returns the SAME object', (_what, n) => {
    const w = earn(emptyWallet(), 'clear', 1, 1, T, 3);
    expect(earn(w, 'clear', n as number, 1, T, 3)).toBe(w);
});

/**
 * 同一个对象,不是一份等值的拷贝:GameController 用 `===` 决定要不要写盘,而重玩拿 0 币时
 * 不该产生一次同步写入。
 */
test('spend of zero returns the SAME object', () => {
    const w = earn(emptyWallet(), 'clear', 60, 1, T, 3);
    expect(spend(w, 'unlock', 0, 1, T)).toBe(w);
});

test('spend beyond the balance is refused with null and changes nothing', () => {
    const w = earn(emptyWallet(), 'clear', 25, 1, T, 1);
    expect(spend(w, 'unlock', 26, 1, T)).toBeNull();
    expect(balance(w)).toBe(25);
    expect(w.log).toHaveLength(1);
});

test('spend of exactly the balance is allowed and lands on zero', () => {
    const w = earn(emptyWallet(), 'clear', 20, 1, T, 1);
    const after = spend(w, 'unlock', 20, 1, T)!;
    expect(balance(after)).toBe(0);
    expect(after.log[after.log.length - 1].n).toBe(-20);
});

/**
 * `spend` 自己取负,调用点永远传正数。传负数是符号写反的样子,必须当成无效额度拒掉,
 * 而不是变成一次意外的收入。
 */
test('spend of a negative amount is a no-op, never an income', () => {
    const w = earn(emptyWallet(), 'clear', 60, 1, T, 3);
    expect(spend(w, 'unlock', -20, 1, T)).toBe(w);
});

test('extra is written only when given', () => {
    const w = earn(emptyWallet(), 'clear', 60, 3, T, 3);
    expect(w.log[0]).toEqual({ t: T, why: 'clear', n: 60, ref: 3, extra: 3 });
    const c = earn(emptyWallet(), 'checkin', 20, 7, T);
    expect(c.log[0]).toEqual({ t: T, why: 'checkin', n: 20, ref: 7 });
    expect('extra' in c.log[0]).toBe(false);
});

// ---------- 解锁定价 ----------

test('the first three unlocks in a level cost 20, 40, 80', () => {
    expect(unlockPrice(0)).toBe(20);
    expect(unlockPrice(1)).toBe(40);
    expect(unlockPrice(2)).toBe(80);
});

/**
 * 当前关卡数据下 slots - unlocked === 3,所以第 4 次开不出来。取表尾而不是 undefined,
 * 是为了让这条对任何关卡数据都成立 —— 一个 undefined 会一路变成 NaN 币,静默地免费。
 */
test('an out-of-range unlock costs the last price, never undefined', () => {
    expect(unlockPrice(3)).toBe(80);
    expect(unlockPrice(99)).toBe(80);
    expect(unlockPrice(-1)).toBe(20);
    expect(unlockPrice(NaN)).toBe(80);
});

// ---------- 解析 ----------

/**
 * 和 progress 同一条契约:这跑在开机路径上,任何异常输入都要变成空钱包而不是异常。`''` 在列表里,
 * 是因为微信的 getStorageSync 对缺失键返回空串,而浏览器的 getItem 返回 null —— 两者在这里
 * 必须不可区分。
 */
test.each([
    ['a missing key (null)', null],
    ['a missing key on WeChat (empty string)', ''],
    ['whitespace', '   '],
    ['not JSON at all', '{oops'],
    ['a truncated object', '{"version":2,"opening":12'],
    ['JSON that is not an object', '42'],
    ['JSON null', 'null'],
    ['an array', '[1,2,3]'],
    ['a future version', '{"version":3,"opening":100,"log":[]}'],
    ['no version', '{"opening":100,"log":[]}'],
    ['opening missing', '{"version":2,"log":[]}'],
    ['opening negative', '{"version":2,"opening":-5,"log":[]}'],
    ['opening a fraction', '{"version":2,"opening":1.5,"log":[]}'],
    ['log missing', '{"version":2,"opening":10}'],
    ['log not an array', '{"version":2,"opening":10,"log":{}}'],
    ['an entry with an unknown why', '{"version":2,"opening":0,"log":[{"t":1,"why":"gift","n":5,"ref":0}]}'],
    ['an entry with n = 0', '{"version":2,"opening":0,"log":[{"t":1,"why":"clear","n":0,"ref":0}]}'],
    ['an entry with a fractional n', '{"version":2,"opening":0,"log":[{"t":1,"why":"clear","n":1.5,"ref":0}]}'],
    ['a log that drives the balance negative', '{"version":2,"opening":0,"log":[{"t":1,"why":"unlock","n":-5,"ref":0}]}'],
])('%s parses as an empty wallet, and not from legacy', (_what, raw) => {
    expect(parseWallet(raw as string | null)).toEqual({ wallet: emptyWallet(), fromLegacy: false });
});

test('a valid wallet round-trips', () => {
    let w = earn(emptyWallet(), 'clear', 60, 1, T, 3);
    w = spend(w, 'unlock', 20, 1, T)!;
    expect(parseWallet(serializeWallet(w))).toEqual({ wallet: w, fromLegacy: false });
});

// ---------- v1 迁移 ----------

test('a v1 wallet becomes an opening balance and reports fromLegacy', () => {
    expect(parseWallet('{"version":1,"coins":135}')).toEqual({
        wallet: { version: 2, opening: 135, log: [] },
        fromLegacy: true,
    });
});

/**
 * 损坏的 v1 不算 v1:它没有一个可信的余额可搬,当空存档处理。
 */
test('a v1 wallet with an unusable balance is not a migration', () => {
    expect(parseWallet('{"version":1,"coins":-5}')).toEqual(
        { wallet: emptyWallet(), fromLegacy: false });
    expect(parseWallet('{"version":1,"coins":"100"}')).toEqual(
        { wallet: emptyWallet(), fromLegacy: false });
});

/**
 * 这是整个改动存在的理由,值得单独一条。
 *
 * 损坏的 v2 归零且**不**回填。若损坏也触发回填,手改存档就成了退款按钮:花掉的钱可以靠
 * 把 wallet 键改成垃圾拿回来。代价是这类玩家丢余额 —— 和 parseWallet 一贯的政策一致。
 */
test('a corrupt v2 wallet does NOT re-trigger the backfill', () => {
    expect(parseWallet('{"version":2,"opening":"oops","log":[]}').fromLegacy).toBe(false);
});

// ---------- 回填 ----------

test('coinsForClear pays only the difference, never negative', () => {
    expect(coinsForClear(0, 3)).toBe(60);
    expect(coinsForClear(2, 3)).toBe(20);
    expect(coinsForClear(3, 3)).toBe(0);
    expect(coinsForClear(3, 1)).toBe(0);
});

test('coinsFromProgress totals what the stars would have paid', () => {
    let p = emptyProgress();
    p = recordClear(p, 1, 3).progress;
    p = recordClear(p, 2, 1).progress;
    expect(coinsFromProgress(p, 10)).toBe(85);
});

/**
 * 回填现在写成一条 `carryover` 流水,而不是直接设余额 —— 否则余额和流水就对不上,不变式当场破。
 */
test('the backfill raises the balance with a carryover row', () => {
    let p = emptyProgress();
    p = recordClear(p, 1, 3).progress;   // 派生 60
    const w = backfilledWallet(emptyWallet(), p, 10, T);
    expect(balance(w)).toBe(60);
    expect(w.log).toEqual([{ t: T, why: 'carryover', n: 60, ref: 0 }]);
});

/**
 * 返回同一个对象,让调用方用 `===` 就能判断"不欠",不必比余额再把这个判断重做一遍。
 */
test('the backfill never lowers a balance, and returns the SAME object', () => {
    let p = emptyProgress();
    p = recordClear(p, 1, 1).progress;   // 派生 25
    const rich = earn(emptyWallet(), 'checkin', 100, 1, T);
    expect(backfilledWallet(rich, p, 10, T)).toBe(rich);
});

/**
 * 花过钱的钱包也不该被回填抬回去 —— 这正是 v1 那条"每次开机都回填"会造成的退款。
 * 这里只验证函数本身不主动退款;"开机路径上根本不再调用它"由 Task 2 保证。
 */
test('the backfill tops up only the shortfall, not the amount spent', () => {
    let p = emptyProgress();
    p = recordClear(p, 1, 3).progress;                  // 派生 60
    let w = earn(emptyWallet(), 'clear', 60, 1, T, 3);  // 已有 60
    w = spend(w, 'unlock', 20, 1, T)!;                  // 花掉 20,剩 40
    const after = backfilledWallet(w, p, 10, T);
    expect(balance(after)).toBe(60);
    expect(after.log[after.log.length - 1]).toEqual(
        { t: T, why: 'carryover', n: 20, ref: 0 });
});
