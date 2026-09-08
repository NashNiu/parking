# Demand-ordered passenger queue

The ring deals passengers in bands of one colour, and a band exists only for a car that is
actually coming. The queue's ORDER becomes level data, authored by the generator along the
leaving order it already computes; difficulty comes from mistiming the bands against that
order.

## The problem

The ring is a per-row shuffle (`LoopSystem`, seeded by level id). A row is four people, and
the shuffle mixes so thoroughly that a colour almost never occupies two neighbouring cells.
So a matching car pays out four people at a time, however wide the boarding doorway is and
however well the player set the bay up. The request was for the opposite: a colour arriving
as a visible band, boarding in one burst.

The obvious implementation -- deal same-coloured rows in fixed clusters, shuffle the clusters
-- was built and measured, and it makes the game unwinnable. Verdicts from `isHardButFair`
over the ten shipped levels (level 1 is a teaching level and cannot be hard, so 9 is the
ceiling):

| cluster rows | doorway cells | hard AND fair |
| --- | --- | --- |
| 1 | 1 | 9/10 (what shipped) |
| 1 | 3 | 8/10 |
| 2 | 3 | 4/10 |
| 3 | 3 | 1/10 |
| 4 | 3 | 2/10, five levels unwinnable by any policy tried |

The mechanism is selective draining. A colour the bay covers is boarded, so its cells empty
and refill from the channels; a colour no parked car wants cannot leave, so it stays. With
four open stalls against up to six colours, two colours are homeless at any moment and their
rows pile up. Dealt one row at a time a homeless colour adds ONE cell per lap, and the ring's
colour mix decays slowly enough for the player to react -- that slack is the game. Dealt in
clusters of four it adds FOUR, and the ring seals within a few laps. Measured at the deadlock
on level 8: thirty of thirty-two cells held only cyan and yellow, while the bay sat on blue,
green and red.

Two compensations were measured and rejected. Opening more stalls does not help -- at six
unlocked instead of four, levels 2, 8 and 9 are still unwinnable, because a blocked lot means
the player cannot always reach the colour the bay is missing. Regenerating the levels does not
help either: what a painting decides is which colours the player is forced to park, and the
collapse is driven by which colours the bay is NOT covering.

## The idea

Bands are fine. Bands for colours with nowhere to go are not. So do not choose the band
order at random -- choose it to track the order the cars can actually leave in.

`peel` already computes such an order, and `scatter` already numbers the cars along it
(`id: i + 1` over `peel`'s output), which is why `repaint` can index paintings by leaving
order. The generator therefore already holds everything this needs; only `queueFor` throws it
away, by collapsing the cars into one total per colour.

Band size comes free from the same place: a car seats 16, 24 or 32, which is 4, 6 or 8 rows.
A band is one car's worth of passengers. Nothing has to pick a cluster size.

## Measurements this design is built on

A throwaway probe rebuilt each shipped level's queue as one band per car along a greedy
leaving order (the wave walk `solvability.clearGrid` does, standing in for `peel`, which the
level JSON does not carry), then rotated that order to mistime it. The probe rotated by whole
CARS because that was the cheapest thing to write; the design's dial is finer (rows, see
Decisions), so these are samples along the same axis at a coarser granularity, not the
calibration itself:

```
offset=0 cars   0/10   L1:hF L2:hF L3:hF L4:hF L5:hF ... L10:hF
offset=3 cars   3/10   L2:HF L4:Hf L5:HF L8:HF ...
offset=6 cars   3/10   L2:Hf L4:HF L7:HF L9:HF L10:Hf
```

**Perfect correspondence is the zero-difficulty end.** At offset 0 all ten levels fall to
`keepDistinct`, the one-line rule ("keep the stalls all different colours") the whole
difficulty apparatus exists to defeat. This is the single most important number here: the
curve must never ship offset 0 above the teaching levels.

**Mistiming is a working dial.** 3/10 on paintings that were searched against the OLD
ordering is not the dial's ceiling -- it is what the dial reaches on untuned data. Lifting it
is the painting search's job, which is exactly the job it already does.

The probe also tried splitting each car's rows in half, and got results identical to not
splitting. That is not a finding about splitting: the probe emitted the two halves ADJACENT,
and two adjacent same-coloured bands are one band. The probe says nothing about splitting;
see `bandInterleave` below, which is specified but unmeasured.

Separately: the boarding doorway's width is a weak difficulty lever, not a neutral one. A
wider door boards more rows per tick, so the ring drains faster, so more of the queue gets in,
so more colours reach the gap. Measured, `BOARD_CELLS` 3 tipped level 10 from hard to easy on
its shipped painting -- a level already sitting on the verdict boundary. Freshly generated
levels are unaffected: `level-gen.test.ts` passes with the wide door because the painting
search re-searches under it.

## Decisions

Settled with the human partner before this was written:

- **Generator-authored, not runtime-reactive.** The alternative -- promote a band when the
  player actually parks a car of that colour -- guarantees every parked car a payout and by
  doing so very nearly deletes the only way to lose. It also makes a level's ring
  unreproducible between replays, which the seeded shuffle exists to prevent.
- **Tunnel bands go at the END of the queue**, not interleaved at their mouth car's position.
- **Offset is measured in ROWS**, not cars.
- **Splitting is a feel knob, not a difficulty knob**, until measured otherwise.
- **The three-cell doorway stays.** `BOARD_CELLS = 3`, already shipped and green.

## Architecture

### 1. `LevelData.loop.queue` becomes order-significant

The type does not change: it stays `QueueGroup[]`. What changes is that the ARRAY ORDER is
now the arrival order, one entry per band, rather than a per-colour summary written in palette
order.

`validateLevel` needs no change -- it sums `count` per colour and compares against car
capacity, which a multi-entry queue satisfies exactly as a one-entry-per-colour queue did.
A new check is worth adding: no band may exceed one car's largest capacity, which catches a
queue accidentally written in the old collapsed form.

All ten level JSONs must be regenerated. An old-style queue consumed in order is one enormous
band per colour -- the worst case this design exists to avoid -- so the old files are not
merely stale, they are actively wrong under the new reader.

### 2. `LoopSystem` stops shuffling

The `shuffleSeed` constructor parameter, `shuffleInPlace`, `toClusters`, `shuffleClusters`
and the `CLUSTER_ROWS` constant all go. `toGroups` stays: chopping a band into rows of
`GROUP_SIZE` is still how a band becomes ring cells, and a colour change still ends a row.
`GameCore` stops passing `level.id` as a seed.

`reachableColors` and the deadlock argument are untouched, and that is the return on choosing
the static option: the queue is still a fixed FIFO, so "if nothing reachable can board, no
cell empties, so the ring is frozen and this set can never grow" holds word for word.

### 3. The generator authors the order

`queueFor(cars, tunnels)` becomes `bandedQueue(cars, tunnels, offset, interleave)`:

1. Walk `cars` -- already in leaving order -- and emit one band per car:
   `{ color: car.color, count: CAP_SIZE[car.cap] }`.
2. Interleave, if `interleave > 1`: take the next `interleave` cars and deal their rows round
   robin instead of car by car, so one car's passengers arrive separated by other colours.
   At `interleave = 1` this is the plain car-by-car walk.
3. Flatten to rows, rotate LEFT by `offset` rows -- the first `offset` rows move to the back
   -- and re-group. Left is the direction that mistimes: the queue then opens with rows
   belonging to cars deeper in the lot, so those bands reach the doorway while their cars are
   still buried, which is the pressure the dial is for. Rotation at row granularity will cut a
   band in two -- offset 5 into a queue that opens with 4 green rows lands inside the next
   band -- and that is accepted rather than avoided: it is what a row-granular dial means, and
   the cut piece rejoins its colour at the far end of the queue.
4. Append the tunnel cars' bands, one per tunnel car, after everything above.

The tunnel cars sit at the end because when a tunnel car reaches the bay is the player's
choice rather than `peel`'s, so there is no position in the leaving order that is honest about
them. Putting them last means a level's closing stretch is its least demand-matched -- which
is the right way round, since by then the lot is nearly empty and the player has few cars to
choose between anyway.

`assemble` passes the curve's `offset` and `interleave` through. Nothing else in the generator
moves: `choosePainting` still calls `assemble` per painting, so the painting and the queue
order stay coupled -- a painting decides the colour sequence along leaving order, and the
queue now follows that same sequence. One search covers both.

### 4. The curve

`GenParams` gains two fields:

- `bandOffset`: rows of mistiming. 0 for the teaching levels, deliberately -- they are meant
  to be free, and offset 0 is measurably free. Ramping to a value the search can actually
  satisfy on the later levels; where that is comes from `isHardButFair`, not from arithmetic
  (see Risks).
- `bandInterleave`: how many cars' bands are dealt round robin at a time. 1 until measured.

Both belong in the curve table beside `colors` and the blocked-car share, and both must be
pinned by a test that says a later level never asks for less mistiming than an earlier one --
the same shape as the existing curve-monotonicity test.

An interaction to watch: `paintings()` opens with runs of 1 through 6, where a run of `k`
paints `k` consecutive cars in leaving order the same colour. Under this design a run of `k`
is also a band of `k` cars' seats -- up to 8 rows each. Run 6 could therefore deal a band of
nearly fifty rows, which is most of a ring. The run ladder may need shortening; that is a
measurement, not a guess, and it belongs in the plan rather than here.

### 5. What the view sees

Nothing changes. `TrackView` draws whatever `LoopSystem` hands it, and a band is just
neighbouring cells that happen to share a colour. The three-cell doorway already boards them
together and `playBoarding` already flies one figure per boarded passenger from its own cell
and seat.

## Testing

Unit, in `logic/tests`:

- `bandedQueue` emits one band per car in leaving order, with `CAP_SIZE / GROUP_SIZE` rows
  each; total per colour equals total car capacity (the invariant `validateLevel` checks).
- `offset` rotates at row granularity, including the case that cuts a band, and `offset = 0`
  is the identity.
- `interleave > 1` separates one car's rows with another colour -- the assertion the probe
  was missing.
- Tunnel bands come last, after every grid band.
- `LoopSystem` consumes the authored order verbatim: no seed, no shuffle, ring cell `i` holds
  authored row `i`.
- A regenerated level still passes `validateLevel` and `validateTrack`.

Balance, in `level-gen.test.ts` (the existing gate, unchanged in kind):

- every level above the colour floor is hard AND fair. The number to beat is the current
  **9/10**; anything less is a regression, not a trade.
- the curve never asks a later level for less mistiming than an earlier one.

Note for whoever runs it: `level-gen.test.ts` takes about 80 minutes, and did before this
work. It regenerates ten levels and each one searches paintings against seven simulations of
up to 4000 ticks.

## Risks

**The offset's effect is scattered, so the curve must be calibrated rather than computed.**
The correspondence assumes the player leaves cars in roughly `peel`'s order. They will not
exactly -- which car to bring out is the game -- so the effective mistiming at any moment is
the authored offset plus however far the player has strayed. This is a feature, but it means a
curve value cannot be reasoned to; each level's offset has to be chosen by running
`isHardButFair` and keeping what passes.

**Mistiming dials toward the collapse this design exists to avoid.** A band whose car is still
buried has nowhere to go and accumulates, which is exactly the failure the fixed clusters hit.
That is what makes it a difficulty dial rather than a decoration, and it also means the dial
has a cliff rather than a ceiling. The search must be allowed to reject an offset, not just
rank it.

**Regeneration is the deliverable, not a side effect.** The ten level JSONs change. Their
difficulty numbers will move, and they should be reported alongside the change rather than
discovered later.

## Out of scope

- Runtime-reactive band promotion. Rejected above; if the demand match ever needs to be
  tighter than static ordering can make it, that is a separate design with its own loss
  condition.
- Bay size and ring length. Either would buy room for longer bands, and both are design
  changes rather than numbers.
- The boarding doorway and the boarding animation. Both are already shipped: `BOARD_CELLS`
  3 and a 0.32s flight staggered by 0.05s, with the departing car's stall released on the
  tick core reports it so the animation's length is no longer bounded by a ratio against the
  tick.
