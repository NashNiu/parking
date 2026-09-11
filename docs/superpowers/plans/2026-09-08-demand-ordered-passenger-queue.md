# Demand-ordered Passenger Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the passenger queue's order level data, authored by the generator along the order the cars can leave in, so a colour arrives as a band sized to the car it fills — with the mistiming between band and car as the difficulty dial.

**Architecture:** `queueFor` (one total per colour, palette order) becomes `bandedQueue` (one entry per car, in `peel` order, rotated by a curve parameter, tunnel cars last). `LoopSystem` stops shuffling and consumes that order verbatim, which leaves `reachableColors` and the deadlock argument untouched. The offset curve is calibrated by a new sweep tool against `isHardButFair`, not derived.

**Tech Stack:** TypeScript, Cocos Creator (view only — untouched here), Jest via `logic/` (`cd logic && npx jest`), generator CLI via `cd logic && npm run gen`.

**Spec:** `docs/superpowers/specs/2026-09-08-demand-ordered-passenger-queue-design.md`

## Global Constraints

- All commands run from `logic/`: `cd logic && npx jest <path>`. There is no ts-node; the generator CLI compiles through `tsc -p tsconfig.gen.json` into `../.tmp/gen`.
- `GROUP_SIZE` is 4 and must divide every car capacity. `CAP_SIZE` is `{ small: 16, medium: 24, big: 32 }`, i.e. 4, 6 and 8 rows.
- `level.lot.cars` is in LEAVING ORDER: `scatter` numbers them `id: i + 1` over `peel`'s output, which is why `repaint` indexes paintings by that order. Every part of this plan depends on it.
- `TunnelSpec.cars` holds ALL of a tunnel's cars including the head that stands outside; `level.lot.cars` does not include it. `queueFor` and `validateLevel` both sum `lot.cars` plus every `t.cars`, and `bandedQueue` must sum exactly the same set or `validateLevel` will reject the level.
- The balance number to beat is **9/10** hard-and-fair over the ten levels (level 1 is a teaching level and cannot be hard). Anything less is a regression.
- `BOARD_CELLS = 3` and the boarding animation constants are already shipped and are not touched by this plan.
- `level-gen.test.ts` takes about 80 minutes and did before this work. Budget for it.
- Comments in code are English; user-facing prose is Chinese.

---

### Task 1: `bandedQueue`

Pure function, exported, fully tested, and NOT yet wired into `assemble`. The suite stays green throughout this task because nothing calls it yet.

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts` (add beside `queueFor`, around line 686)
- Test: `logic/tests/level-gen.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function bandedQueue(cars: CarSpec[], tunnels: TunnelSpec[], offset: number, interleave: number): QueueGroup[]` — used by Task 2 (`assemble`) and Task 2's sweep tool.

- [ ] **Step 1: Write the failing tests**

Append to `logic/tests/level-gen.test.ts`. The file already imports from `level-gen`; add `bandedQueue` to that import list, and add `Cap`, `CarSpec`, `GROUP_SIZE`, `QueueGroup`, `TunnelSpec` to the `types` import if they are not already there.

```typescript
/** A car at a given place in the leaving order. Position is irrelevant to `bandedQueue`. */
const bq = (id: number, color: string, cap: Cap): CarSpec => ({
  id, x: 0, y: 0, angle: 90, color, cap,
});

/** Total people per colour, which is the invariant `validateLevel` checks. */
function perColor(q: QueueGroup[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of q) out[g.color] = (out[g.color] ?? 0) + g.count;
  return out;
}

test('bandedQueue deals one band per car, in leaving order, sized by that car seats', () => {
  // The whole idea in one assertion: a band is a car's worth of passengers, and the bands
  // arrive in the order the cars can leave. 16/24/32 seats is 4/6/8 rows.
  const cars = [bq(1, 'green', 'small'), bq(2, 'red', 'big'), bq(3, 'blue', 'medium')];
  expect(bandedQueue(cars, [], 0, 1)).toEqual([
    { color: 'green', count: 16 },
    { color: 'red', count: 32 },
    { color: 'blue', count: 24 },
  ]);
});

test('bandedQueue puts the tunnel cars last, after every grid band', () => {
  // When a tunnel car reaches the bay is the player's choice, not `peel`'s, so there is no
  // position in the leaving order that would be honest about it.
  const tunnels: TunnelSpec[] = [
    { id: 1, x: 0, y: 0, angle: 0, cars: [{ color: 'purple', cap: 'small' }, { color: 'red', cap: 'small' }] },
  ];
  expect(bandedQueue([bq(1, 'green', 'small')], tunnels, 0, 1)).toEqual([
    { color: 'green', count: 16 },
    { color: 'purple', count: 16 },
    { color: 'red', count: 16 },
  ]);
});

test('bandedQueue rotates left by ROWS, and may cut a band in two', () => {
  // Left is the direction that mistimes: the first `offset` rows move to the back, so the
  // queue opens with rows belonging to cars deeper in the lot. Row granularity means the
  // rotation can land inside a band, and the cut piece rejoins its colour at the far end.
  const cars = [bq(1, 'green', 'small'), bq(2, 'red', 'big')];   // 4 rows then 8 rows
  expect(bandedQueue(cars, [], 2, 1)).toEqual([
    { color: 'green', count: 8 },     // rows 2..3 of the green car
    { color: 'red', count: 32 },
    { color: 'green', count: 8 },     // rows 0..1, now at the back
  ]);
  // A rotation that lands exactly on a boundary cuts nothing.
  expect(bandedQueue(cars, [], 4, 1)).toEqual([
    { color: 'red', count: 32 },
    { color: 'green', count: 16 },
  ]);
});

test('bandedQueue offset 0 and offset one-whole-lap are the same queue', () => {
  const cars = [bq(1, 'green', 'small'), bq(2, 'red', 'big'), bq(3, 'blue', 'medium')];
  const rows = (16 + 32 + 24) / GROUP_SIZE;
  expect(bandedQueue(cars, [], rows, 1)).toEqual(bandedQueue(cars, [], 0, 1));
  expect(bandedQueue(cars, [], 3 * rows, 1)).toEqual(bandedQueue(cars, [], 0, 1));
});

test('bandedQueue interleave separates one car rows with another colour', () => {
  // The assertion the throwaway probe was missing. Its `split` emitted a car halves
  // ADJACENT, and two adjacent same-coloured bands are one band -- which is why splitting
  // measured as a no-op. Separation is the thing that has to be asserted.
  const cars = [bq(1, 'green', 'small'), bq(2, 'red', 'big')];   // 4 rows then 8 rows
  expect(bandedQueue(cars, [], 0, 2)).toEqual([
    { color: 'green', count: 4 }, { color: 'red', count: 4 },
    { color: 'green', count: 4 }, { color: 'red', count: 4 },
    { color: 'green', count: 4 }, { color: 'red', count: 4 },
    { color: 'green', count: 4 }, { color: 'red', count: 20 },
  ]);
});

test('bandedQueue moves people around without changing how many of each colour there are', () => {
  // Every knob here is a REORDERING. If any of them changed a colour total, `validateLevel`
  // would reject the level for car capacity not matching its passengers.
  const cars = [
    bq(1, 'green', 'small'), bq(2, 'red', 'big'), bq(3, 'blue', 'medium'), bq(4, 'red', 'small'),
  ];
  const tunnels: TunnelSpec[] = [
    { id: 1, x: 0, y: 0, angle: 0, cars: [{ color: 'purple', cap: 'medium' }] },
  ];
  const want = { green: 16, red: 48, blue: 24, purple: 24 };
  for (const offset of [0, 1, 5, 17, 100]) {
    for (const interleave of [1, 2, 3]) {
      expect(perColor(bandedQueue(cars, tunnels, offset, interleave))).toEqual(want);
    }
  }
});

test('no band is bigger than the biggest car', () => {
  // What `validateLevel` will check in Task 2, asserted here at the source: a queue written
  // in the OLD collapsed form has one entry per colour running into the hundreds, so this
  // bound is what tells the two forms apart.
  const cars = [
    bq(1, 'red', 'big'), bq(2, 'red', 'big'), bq(3, 'red', 'big'),   // same colour, adjacent
  ];
  for (const g of bandedQueue(cars, [], 0, 1)) {
    expect(g.count).toBeLessThanOrEqual(CAP_SIZE.big);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd logic && npx jest tests/level-gen.test.ts -t bandedQueue`
Expected: FAIL — `bandedQueue is not a function` / TypeScript error that it is not exported from `level-gen`.

- [ ] **Step 3: Implement `bandedQueue`**

Add to `game/assets/scripts/core/level-gen.ts`, directly after `queueFor` (which stays for now; Task 2 removes it).

```typescript
/**
 * The passenger queue as an ORDERED list of bands: one entry per car, in the order the cars
 * can leave in, each holding exactly that car's seats.
 *
 * This replaces `queueFor`'s one-total-per-colour summary, and the difference is the whole
 * point. `LoopSystem` consumes this order verbatim, so the ARRAY ORDER is now arrival order:
 * a colour reaches the doorway as a band of 4, 6 or 8 rows and boards in one burst, instead
 * of four people at a time out of a shuffled ring.
 *
 * Why a band may exist at all: the ring drains SELECTIVELY -- a colour the bay covers boards
 * and frees its cells, a colour nothing wants cannot leave -- so bands dealt at random pile
 * the homeless colours up four cells at a time and seal the track. Dealing them along the
 * LEAVING order is what gives every band a car that is actually coming. `cars` arrives in
 * that order already (`scatter` numbers them along `peel`), so this only has to walk it.
 *
 * `offset` is the difficulty dial, in ROWS, and it rotates LEFT: the first `offset` rows move
 * to the back, so the queue opens with rows belonging to cars deeper in the lot and those
 * bands reach the doorway while their cars are still buried. It dials TOWARD the pile-up
 * above -- that is what makes it difficulty and not decoration, and it means the dial has a
 * cliff rather than a ceiling. Measured: at offset 0 all ten levels fall to the one-line
 * rule, so 0 is the free end and belongs only to the teaching levels.
 *
 * `interleave` deals that many cars' rows round robin instead of car by car, so one car's
 * passengers arrive separated by other colours and its stall stays occupied for several
 * laps. A feel knob; see the plan's Task 4 for whether it is also a difficulty one.
 *
 * The tunnel cars go last, all of them, after every grid band. When a tunnel car reaches the
 * bay is the player's choice rather than `peel`'s, so no position in the leaving order would
 * be honest about it -- and last is the right end, because by then the lot is nearly empty
 * and the player has few cars left to choose between anyway.
 */
export function bandedQueue(
    cars: CarSpec[], tunnels: TunnelSpec[], offset: number, interleave: number,
): QueueGroup[] {
    // Rows carry a BAND id, not just a colour, so the grouping at the end can tell "one car's
    // eight rows" from "two same-coloured cars that happen to adjoin" -- and so a rotation
    // that lands inside a band produces two entries rather than silently merging into the
    // neighbour it now touches.
    const rows: { color: string; band: number }[] = [];
    const step = Math.max(1, Math.trunc(interleave));
    let band = 0;
    for (let base = 0; base < cars.length; base += step) {
        const group = cars.slice(base, base + step);
        const ids = group.map(() => band++);
        const left = group.map((c) => CAP_SIZE[c.cap] / GROUP_SIZE);
        // Round robin over the group until every car in it is dealt out. At interleave 1 the
        // group is one car and this is the plain car-by-car walk.
        for (let dealing = true; dealing;) {
            dealing = false;
            for (let i = 0; i < group.length; i++) {
                if (left[i] <= 0) continue;
                rows.push({ color: group[i].color, band: ids[i] });
                left[i]--;
                dealing = true;
            }
        }
    }

    const n = rows.length;
    const shift = n === 0 ? 0 : ((Math.trunc(offset) % n) + n) % n;
    const ordered = rows.slice(shift).concat(rows.slice(0, shift));

    // After the rotation, so a level's closing stretch is its least demand-matched.
    for (const t of tunnels) {
        for (const c of t.cars) {
            const id = band++;
            for (let r = CAP_SIZE[c.cap] / GROUP_SIZE; r > 0; r--) {
                ordered.push({ color: c.color, band: id });
            }
        }
    }

    const queue: QueueGroup[] = [];
    let open = -1;
    for (const row of ordered) {
        if (row.band === open) queue[queue.length - 1].count += GROUP_SIZE;
        else {
            queue.push({ color: row.color, count: GROUP_SIZE });
            open = row.band;
        }
    }
    return queue;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd logic && npx jest tests/level-gen.test.ts -t band`
Expected: PASS, 7 tests. `-t band` matches all seven, including "no band is bigger than the
biggest car", which does not have `bandedQueue` in its name.

- [ ] **Step 5: Run the fast suite to confirm nothing else moved**

Run: `cd logic && npx jest --testPathIgnorePatterns "level-gen|coverage-m2"`
Expected: PASS, 15 suites. `bandedQueue` is not wired yet, so no behaviour changed.

- [ ] **Step 6: Commit**

```bash
git add game/assets/scripts/core/level-gen.ts logic/tests/level-gen.test.ts
git commit -m "feat(core): the passenger queue can be dealt as bands along the leaving order"
```

---

### Task 2: Wire it, drop the shuffle, and calibrate the offset curve

These belong together and cannot be split: removing the shuffle without an authored order gives every colour one enormous band, and wiring the authored order at the provisional offsets gives levels the one-line rule wins. Neither halfway state is something a reviewer could approve. The task ends with `level-gen.test.ts` green at 9/10 or better.

**Files:**
- Modify: `game/assets/scripts/core/types.ts` (delete `CLUSTER_ROWS` and its docblock, ~line 238-276)
- Modify: `game/assets/scripts/core/loop-system.ts` (delete `rng`, `shuffleInPlace`, `toClusters`, `shuffleClusters`, the `shuffleSeed` parameter)
- Modify: `game/assets/scripts/core/game-core.ts:40-49` (stop passing the seed)
- Modify: `game/assets/scripts/core/level-gen.ts` (a `BAND_CURVE` table and `bandParams`, `assemble`, delete `queueFor`)
- Modify: `game/assets/scripts/core/level-data.ts:22-32` (band-size check)
- Create: `tools/band-sweep.ts`
- Modify: `logic/tsconfig.gen.json` (include the new tool), `logic/package.json` (a `sweep` script)
- Test: `logic/tests/loop-system.test.ts`, `logic/tests/level-data.test.ts`

**Interfaces:**
- Consumes: `bandedQueue(cars, tunnels, offset, interleave)` from Task 1.
- Produces: `LoopSystem` constructor `(capacity: number, boardIndex: number, queue: QueueGroup[], feeds?: Feed[])` — no seed. `export function bandParams(id: number): { offset: number; interleave: number }`, reading a module-level `BAND_CURVE` table.

- [ ] **Step 1: Write the failing tests for the order-respecting `LoopSystem`**

In `logic/tests/loop-system.test.ts`, DELETE these tests, which assert behaviour that is being removed (the shuffle and the cluster knob):

- `a seed mixes the colors without changing how many of each there are`
- `shuffling keeps every group single-coloured`
- `the same seed always shuffles the same way`
- `a cluster is a run of one colour, at most CLUSTER_ROWS long`
- `the shuffle deals same-coloured rows in clusters, not one by one`
- `clustering is a reordering: it moves rows without changing the colour mix`
- `a cluster never mixes colours, however ragged the counts`

Delete the now-unused `counts` helper and `colorRuns` helper, and drop `CLUSTER_ROWS` and `toClusters` from the imports. Rename `without a seed the queue keeps its authored order` and add the band test:

```typescript
test('the queue is consumed in the order it was authored', () => {
  // The queue's ORDER is level data now. There is no shuffle and no seed: ring cell i holds
  // authored row i, so a band the generator put at the front of the queue is a band the
  // player sees at the front of the track.
  const loop = new LoopSystem(4, 0, [{ color: 'a', count: 4 * G }, { color: 'b', count: 4 * G }]);
  expect(loop.ring).toEqual([g('a', G), g('a', G), g('a', G), g('a', G)]);
  expect(loop.channels.flatMap((c) => c.queue)).toEqual([
    g('b', G), g('b', G), g('b', G), g('b', G),
  ]);
});

test('a band of one colour lands on neighbouring ring cells', () => {
  // What the whole design is for: an authored band of six rows occupies six adjacent cells,
  // so the BOARD_CELLS doorway can take three of them in one burst.
  const loop = new LoopSystem(12, 6, [
    { color: 'a', count: 6 * G }, { color: 'b', count: 6 * G },
  ]);
  expect(loop.ring.map((x) => x!.color)).toEqual([
    'a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'b', 'b',
  ]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd logic && npx jest tests/loop-system.test.ts`
Expected: FAIL — TypeScript errors on the deleted imports are the first thing you see; the two new tests fail once those are cleared, because the four-argument constructor still shuffles when a seed is passed and `GameCore` still passes one.

- [ ] **Step 3: Strip the shuffle out of `LoopSystem`**

In `game/assets/scripts/core/loop-system.ts` delete `rng`, `shuffleInPlace`, `toClusters` and `shuffleClusters` entirely, drop `BOARD_CELLS`-unrelated imports (`CLUSTER_ROWS` goes; `BOARD_CELLS`, `DEFAULT_FEEDS`, `Feed`, `FeedSide`, `GROUP_SIZE`, `PaxGroup`, `QueueGroup` all stay), and change the constructor:

```typescript
  constructor(
    capacity: number,
    boardIndex: number,
    queue: QueueGroup[],
    feeds: Feed[] = DEFAULT_FEEDS,
  ) {
    this.capacity = capacity;
    this.boardIndex = boardIndex;
    // Never so wide that the window swallows an entry cell (boardIndex +- capacity/4);
    // see BOARD_CELLS. The floor of 0 is what leaves the toy rings in the tests with the
    // single-cell doorway they were written against.
    this.boardHalf = Math.max(0, Math.min(
      (BOARD_CELLS - 1) >> 1, Math.floor(capacity / 4) - 1,
    ));
    // The queue's ORDER is level data: the generator authored it along the order the cars can
    // leave in (see `bandedQueue`), so it is consumed verbatim. There used to be a seeded
    // shuffle here, and it is gone rather than made optional -- a shuffle would destroy
    // exactly the correspondence the order exists to carry.
    const all = toGroups(queue);
    this.ring = new Array(capacity).fill(null);
    for (let i = 0; i < capacity && all.length > 0; i++) this.ring[i] = all.shift()!;
```

Leave the rest of the constructor (the channel split) and every other method exactly as they are. `reachableColors`' docblock needs no change: the queue is still a fixed FIFO.

In `game/assets/scripts/core/game-core.ts`, replace the four-argument call:

```typescript
    this.loop = new LoopSystem(
      level.loop.capacity,
      level.loop.boardIndex,
      level.loop.queue,
      level.loop.feeds ?? DEFAULT_FEEDS,
    );
```

In `game/assets/scripts/core/types.ts`, delete `CLUSTER_ROWS` and its whole docblock. The measurements in it are not lost — they are the spec's "The problem" section, which is the durable home for them.

- [ ] **Step 4: Run the loop tests**

Run: `cd logic && npx jest tests/loop-system.test.ts tests/game-core.test.ts tests/boarding-system.test.ts tests/integration.test.ts`
Expected: PASS. If `integration.test.ts` fails, it is because it asserts a ring built from a per-colour queue that is now consumed in order — read the assertion and fix the expectation, do not reintroduce a shuffle.

- [ ] **Step 5: Commit the core half**

```bash
git add game/assets/scripts/core/loop-system.ts game/assets/scripts/core/game-core.ts game/assets/scripts/core/types.ts logic/tests/loop-system.test.ts
git commit -m "feat(core): the ring consumes the queue order the level authored"
```

- [ ] **Step 6: Add the band curve**

`BAND_CURVE` is a hand-calibrated table read through its own accessor, which is how
`TRACK_CURVE` and `TUNNEL_CURVE` already work -- `tunnelParams(id)` is a sibling of
`levelParams(id)`, not a field inside it. The spec proposed putting the two values on
`GenParams`; follow the codebase instead, because `bandParams(id)` answers the same question
and fields on `GenParams` that nothing reads would be dead weight.

Add the table next to `TUNNEL_CURVE` in `game/assets/scripts/core/level-gen.ts`:

```typescript
/**
 * The band curve, one row per level, alongside TRACK_CURVE and TUNNEL_CURVE and read the
 * same way -- clamped past both ends, so an id past the authored ten gets the last row.
 *
 * `offset` is rows of mistiming between a band and the car it fills, and it is the difficulty
 * dial this milestone adds. It is CALIBRATED, not derived: the effective mistiming at any
 * moment is this value plus however far the player has strayed from `peel`'s order, and how
 * far they stray is the game, so no arithmetic predicts it. Every value here was chosen by
 * running `npm run sweep` and keeping what `isHardButFair` passed.
 *
 * ZERO ON THE TEACHING LEVELS, deliberately. Measured over the ten shipped levels: at offset
 * 0 every one of them falls to `keepDistinct`, the one-line rule ("keep the stalls all
 * different colours") the whole difficulty apparatus exists to defeat. Perfect correspondence
 * is the free end of this dial -- which is exactly what levels 1 and 2 want and what nothing
 * after them may have.
 *
 * `interleave` is 1 throughout until measured; see the plan's Task 4.
 */
const BAND_CURVE: { offset: number; interleave: number }[] = [
    { offset: 0, interleave: 1 },    // 1  teaching level
    { offset: 0, interleave: 1 },    // 2  teaching level
    { offset: 8, interleave: 1 },    // 3  PROVISIONAL -- replaced in Step 10
    { offset: 12, interleave: 1 },   // 4  PROVISIONAL
    { offset: 16, interleave: 1 },   // 5  PROVISIONAL
    { offset: 20, interleave: 1 },   // 6  PROVISIONAL
    { offset: 24, interleave: 1 },   // 7  PROVISIONAL
    { offset: 28, interleave: 1 },   // 8  PROVISIONAL
    { offset: 32, interleave: 1 },   // 9  PROVISIONAL
    { offset: 36, interleave: 1 },   // 10 PROVISIONAL
];

/** This level's band parameters, clamped past both ends of BAND_CURVE. */
export function bandParams(id: number): { offset: number; interleave: number } {
    const i = Math.min(Math.max(1, Math.trunc(id)), BAND_CURVE.length) - 1;
    return BAND_CURVE[i];
}
```

Leave `GenParams` and `levelParams` alone.

- [ ] **Step 7: Wire `assemble` and delete `queueFor`**

`assemble` already reads the curve for itself (`trackParams(id)`), so it reads this one the same way and no call site changes. In `game/assets/scripts/core/level-gen.ts`, in `assemble` (line 702), replace the queue line:

```typescript
function assemble(id: number, cars: CarSpec[], tunnels: TunnelSpec[] = []): LevelData {
    const track = trackParams(id);
    const bands = bandParams(id);
    return {
        id,
        lot: tunnels.length > 0
            ? { w: LOT.w, h: LOT.h, cars, tunnels }
            : { w: LOT.w, h: LOT.h, cars },
        parking: { slots: SLOTS, unlocked: UNLOCKED },
        loop: {
            capacity: track.capacity,
            boardIndex: track.capacity / 2,
            track: track.track,
            feeds: track.feeds,
            queue: bandedQueue(cars, tunnels, bands.offset, bands.interleave),
        },
```

Then delete `queueFor` and its docblock entirely. Nothing else calls it — confirm with `grep -rn "queueFor" --include=*.ts . | grep -v node_modules` and fix any comment that names it (the docblocks on `choosePainting` and `paintings` both do; they should say `bandedQueue`).

- [ ] **Step 8: Add the band-size check to `validateLevel`**

In `game/assets/scripts/core/level-data.ts`, after the per-colour loop (line 32):

```typescript
  // A band is one car's worth of passengers, so nothing in the queue may exceed the biggest
  // car. This is what tells the current form apart from the OLD one, which wrote a single
  // entry per colour holding that colour's whole total -- hundreds of people. Under the
  // order-respecting reader that form is not merely stale, it is one enormous band per
  // colour: the exact shape that seals the ring (see `bandedQueue`).
  for (const g of level.loop.queue) {
    if (g.count > CAP_SIZE.big) {
      errors.push(`queue band ${g.color} x${g.count} is bigger than the biggest car (${CAP_SIZE.big})`);
    }
  }
```

Add its test to `logic/tests/level-data.test.ts`, following the file's existing pattern for building a minimal valid level:

```typescript
test('a queue written as one total per colour is rejected as an oversized band', () => {
  // The old collapsed form. Under the order-respecting ring it is one band per colour, which
  // is the failure the banding exists to avoid, so it has to be an error and not a warning.
  const level = validLevel();
  level.loop.queue = [{ color: 'red', count: 160 }];
  level.lot.cars = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1, x: 0.5 + i, y: 0.5, angle: 90, color: 'red', cap: 'small' as const,
  }));
  expect(validateLevel(level).some((e) => e.includes('bigger than the biggest car'))).toBe(true);
});
```

If `level-data.test.ts` has no `validLevel()` helper, build the level inline the way the file's neighbouring tests do — read two of them first and match the style.

- [ ] **Step 9: Build the sweep tool**

Create `tools/band-sweep.ts`. It regenerates each level once, then re-bands that level's queue at a grid of offsets and judges each — so one expensive generation buys a whole row of the table.

```typescript
/**
 * Calibrates BAND_CURVE.
 *
 *   cd logic && npm run sweep [-- --only 4-6]
 *
 * For each level id: generate it once, then rebuild its queue with `bandedQueue` at a grid of
 * offsets and report `isHardButFair` for each. Prints one row per (id, offset).
 *
 * Why re-band a generated level rather than regenerate per offset: `choosePainting` runs
 * seven simulations per painting and up to 400 paintings, so a generation is minutes. The
 * level's cars are in leaving order (`scatter` numbers them along `peel`), so this tool can
 * author any offset's queue from the level file itself for the price of one simulation set.
 *
 * The consequence, and it matters: a row says "which offsets suit THIS packing and painting",
 * not "which offset the generator would settle on". The loop is therefore -- sweep, put the
 * passing offsets in BAND_CURVE, regenerate, sweep again to confirm -- and the second sweep
 * is the one that counts, because by then the painting was searched at the offset it shipped
 * with. Two rounds have always been enough; if a level will not settle, that is a level whose
 * offset the curve is asking too much of, and the answer is a smaller one.
 */
import { generateLevel, bandedQueue, bandParams } from '../game/assets/scripts/core/level-gen';
import { isHardButFair } from '../game/assets/scripts/core/play-sim';
import { LevelData } from '../game/assets/scripts/core/types';

/** Offsets to try, in rows. 0 is included because it is the measured free end. */
const OFFSETS = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40];

function idsToSweep(argv: string[]): number[] {
    const flag = argv.indexOf('--only');
    if (flag < 0) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const arg = argv[flag + 1] ?? '';
    const range = arg.split('-').map((s) => Number(s));
    const from = range[0];
    const to = range.length > 1 ? range[1] : from;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
    const out: number[] = [];
    for (let i = from; i <= to; i++) out.push(i);
    return out;
}

for (const id of idsToSweep(process.argv.slice(2))) {
    const level = generateLevel(id);
    const tunnels = level.lot.tunnels ?? [];
    const curve = bandParams(id);
    for (const offset of OFFSETS) {
        const probe: LevelData = JSON.parse(JSON.stringify(level));
        probe.loop.queue = bandedQueue(level.lot.cars, tunnels, offset, curve.interleave);
        const v = isHardButFair(probe);
        const mark = offset === curve.offset ? ' <- curve' : '';
        process.stdout.write(
            `L${id} offset=${String(offset).padStart(3)} `
            + `hard=${v.hard ? 'Y' : 'n'} fair=${v.fair ? 'Y' : 'n'} `
            + `careless=${v.carelessLoss.toFixed(1)}${mark}\n`,
        );
    }
}
```

Add the tool to `logic/tsconfig.gen.json`'s include list:

```json
  "include": ["../tools/gen-levels.ts", "../tools/band-sweep.ts", "../game/assets/scripts/core/**/*.ts"]
```

and a script to `logic/package.json`, beside `gen`:

```json
    "sweep": "tsc -p tsconfig.gen.json && node ../.tmp/gen/tools/band-sweep.js",
```

- [ ] **Step 10: Calibrate**

Run: `cd logic && npm run sweep`
This is long — one generation per level plus eleven verdicts each. Run it detached and read the output when it lands.

Then, for each id from 3 to 10, pick from its rows the offset with `hard=Y fair=Y`, preferring one near the middle of the passing range rather than at its edge — the edges are where the player's own drift tips a level over. Write those values into `BAND_CURVE`, replace every `PROVISIONAL` comment with the passing range you saw (e.g. `// 5  offset 12-20 passed; 16 is the middle`), and keep ids 1 and 2 at 0.

If an id has NO passing offset, do not force it: leave that id's offset at the smallest value whose `fair` is `Y` and note it in the comment. Task 3's regeneration re-searches paintings at the new offset and often turns such an id green; if it still fails after Task 3, that is a real finding and belongs back with the human partner, not papered over.

- [ ] **Step 11: Run the whole suite**

Run: `cd logic && npx jest --testPathIgnorePatterns "level-gen|coverage-m2"`
Expected: PASS, 15 suites.

Run: `cd logic && npx jest tests/level-gen.test.ts tests/coverage-m2.test.ts`
Expected: PASS. About 80 minutes. The test that matters is `every level above the colour floor beats the one-line rule, and stays winnable` — it regenerates each level and judges it, so it is the 9/10 gate. If it fails, go back to Step 10 for the ids it names.

Also run the view typecheck, since `types.ts` lost an export: `cd logic && npx tsc -p tsconfig.view.json --noEmit` and `npx tsc -p tsconfig.json --noEmit`. Both expected to exit 0.

- [ ] **Step 12: Commit**

```bash
git add game/assets/scripts/core/level-gen.ts game/assets/scripts/core/level-data.ts logic/tests/level-data.test.ts tools/band-sweep.ts logic/tsconfig.gen.json logic/package.json
git commit -m "feat(core): bands are dealt along the leaving order, mistimed by the curve"
```

---

### Task 3: Regenerate the ten level files

The data change is the deliverable here, and the numbers it produces are what a reviewer actually reads.

**Files:**
- Modify: `game/assets/resources/levels/level-1.json` … `level-10.json`

**Interfaces:**
- Consumes: `BAND_CURVE` as calibrated in Task 2.
- Produces: the shipped level data every later change is measured against.

- [ ] **Step 1: Regenerate**

Run: `cd logic && npm run gen`
Expected: ten files written, and a table printed. That table is the point — `gen-levels.ts` prints it precisely because it is the only view of what the curve produced rather than what it was asked for.

- [ ] **Step 2: Read the table before committing**

Check, from the printed table: every level's blocked count within `BLOCKED_TOLERANCE` of its target, every level `hard` and `fair` except level 1, and no validation errors. Keep the table — Step 4 puts it in the commit message.

- [ ] **Step 3: Confirm the files are consistent with the code that reads them**

Run: `cd logic && npx jest tests/level-data.test.ts tests/integration.test.ts`
Expected: PASS.

Then spot-check one file by eye: `git diff game/assets/resources/levels/level-5.json` should show `loop.queue` gone from a handful of per-colour entries to many small bands, in an order that is not palette order.

- [ ] **Step 4: Commit the data with its numbers**

```bash
git add game/assets/resources/levels
git commit -m "$(cat <<'EOF'
data: regenerate the ten levels with demand-ordered queues

<paste the table `npm run gen` printed, and the before/after hard-and-fair
count -- the baseline to compare against is 9/10>
EOF
)"
```

---

### Task 4: Decide `bandInterleave` on evidence

`interleave` shipped at 1 in Task 2 because nothing had measured it. Either it earns a place on the curve or it gets pinned at 1 with the measurement recorded. Both outcomes are a finished task; what is not finished is leaving an unmeasured knob on the curve.

**Files:**
- Modify: `tools/band-sweep.ts` (sweep interleave as well)
- Modify: `game/assets/scripts/core/level-gen.ts` (`BAND_CURVE` comments, and the values if it earns them)

**Interfaces:**
- Consumes: `bandedQueue`, `bandParams`, `BAND_CURVE` from Tasks 1 and 2.
- Produces: nothing new. This task only changes data and comments.

- [ ] **Step 1: Sweep interleave alongside offset**

In `tools/band-sweep.ts`, add a second grid and loop it inside the offset loop:

```typescript
/** Interleave depths to try. 1 is car-by-car, the shipped behaviour. */
const INTERLEAVES = [1, 2, 3];
```

and replace the inner body so it walks both, keeping the printed line's shape:

```typescript
    for (const offset of OFFSETS) {
        for (const interleave of INTERLEAVES) {
            const probe: LevelData = JSON.parse(JSON.stringify(level));
            probe.loop.queue = bandedQueue(level.lot.cars, tunnels, offset, interleave);
            const v = isHardButFair(probe);
            const mark = offset === curve.offset && interleave === curve.interleave ? ' <- curve' : '';
            process.stdout.write(
                `L${id} offset=${String(offset).padStart(3)} il=${interleave} `
                + `hard=${v.hard ? 'Y' : 'n'} fair=${v.fair ? 'Y' : 'n'} `
                + `careless=${v.carelessLoss.toFixed(1)}${mark}\n`,
            );
        }
    }
```

- [ ] **Step 2: Run it on a few levels rather than all ten**

Run: `cd logic && npm run sweep -- --only 5-8`
Expected: rows for four ids across all offset/interleave pairs. Four ids is enough to answer "does interleave move the verdict at all", and it costs a quarter of the wall clock.

- [ ] **Step 3: Read the answer and write it down**

Compare, at each fixed offset, whether `il=2` or `il=3` changes `hard`/`fair` relative to `il=1`.

If the verdicts move: pick per-level values, put them in `BAND_CURVE`, and replace the "1 throughout until measured" line in its docblock with what you measured and where you measured it. Then re-run Task 2 Step 11 and Task 3 in full — the levels have to be regenerated against the new curve.

If the verdicts do not move: leave every `interleave` at 1 and replace that line with the measurement, in the form the codebase's other constants use — what was tried, over what, and what came out. For example: "Measured over levels 5-8 at every offset in the sweep's grid, depths 2 and 3 changed no verdict; it is a knob on how long a car occupies its stall, not on whether the level can be won." Keep the parameter: it is threaded, tested and free, and the thing that would make it earn its place (a bay big enough for longer bands) is named in the spec's Out of scope.

- [ ] **Step 4: Confirm and commit**

Run: `cd logic && npx jest --testPathIgnorePatterns "level-gen|coverage-m2"`
Expected: PASS. (Only comments changed, unless the curve values moved — in which case Step 3 already sent you back through the full gate.)

```bash
git add tools/band-sweep.ts game/assets/scripts/core/level-gen.ts
git commit -m "chore(core): measure the interleave knob and record what it does"
```

---

## Self-review notes

Checked against the spec, section by section:

- **The problem / mechanism** — no task; it is the rationale, and it now lives in `bandedQueue`'s docblock so the reason survives next to the code.
- **Architecture 1, `queue` order-significant** — Task 2 Steps 6-8 (wiring plus the band-size check), Task 3 (the data).
- **Architecture 2, `LoopSystem` stops shuffling** — Task 2 Steps 1-5.
- **Architecture 3, the generator authors the order** — Task 1 (the function), Task 2 Step 7 (`assemble`). Tunnels last and offset-in-rows are both pinned by Task 1's tests.
- **Architecture 4, the curve** — Task 2 Steps 6 and 10, but as a `BAND_CURVE` table with its own `bandParams(id)` accessor rather than the `GenParams` fields the spec proposed. `tunnelParams` is the codebase's own precedent for exactly this, and nothing in the plan would have read the `GenParams` fields. The monotonicity test the spec asks for is NOT included: `BAND_CURVE` is a hand-calibrated table like `TUNNEL_CURVE`, which has no monotonicity test either, and Step 10 can legitimately produce a non-monotone row if that is what passes. Asserting a shape the calibration is allowed to break would make the test the thing that gets edited. The `PROVISIONAL`-comment discipline in Step 10 is what guards the table instead.
- **Architecture 5, the view** — nothing to do, as the spec says.
- **`paintings()` run-ladder interaction** — surfaced by Task 2 Step 11: a run of 6 now deals a band of six cars' seats, and if that is what breaks the 9/10 gate the ladder is the thing to shorten. Left as a contingency rather than a task, because the measurement may not call for it.
- **Testing** — Task 1's seven tests plus Task 2 Steps 1 and 8 cover every bullet the spec lists.
- **Risks** — the calibration risk is Task 2 Step 10's "prefer the middle of the passing range"; the cliff risk is its "do not force it"; the regeneration risk is Task 3 Step 4's insistence on committing the numbers.
