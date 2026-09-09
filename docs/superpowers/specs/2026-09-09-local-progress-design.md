# Local progress

The game remembers, on the device, the best star rating each level was cleared with. That one
record is also the gate: a level is playable when the one before it has been cleared. Nothing
else is saved.

## The problem

Nothing is saved at all. The home screen shows ten identical chips with no way to tell which
have been played, the start button always means level 1, and the star rating shipped one
commit ago is forgotten the moment the win card is dismissed -- so the rating rates nothing
that lasts, and replaying a level to improve it buys the player nothing they can see.

## What is stored

One key, `parking.progress`, holding JSON:

```ts
interface Progress {
  version: number;                      // 1
  stars: { [level: string]: number };   // best stars per level, 1..STAR_MAX
}
```

String keys, because that is what `JSON.parse` yields for an object -- typing them as numbers
would be a lie the compiler cannot catch. The version lives INSIDE the JSON rather than in the
key name, so a later migration can still read what this version wrote; a versioned key name
would leave the old data addressable only by a key the new code no longer knows to look at.

The per-level ratings are the whole record. They already imply which levels are cleared, so a
separate "furthest level reached" field would be a second copy of the same fact -- and two
copies of one fact eventually disagree. `unlockedThrough` derives it.

**Not stored:** an in-progress level, aggregate statistics, anything about the player. A saved
mid-level position would mean serialising the lot, the bay, the ring and the queue, and every
change to those structures would then owe a migration -- for a feature that contradicts the
rule the home screen already establishes, that leaving a level abandons it.

## Failure policy

**Any unexpected input yields a fresh save, and nothing throws.** What comes back from the
device is untrusted: it may have been written by an older version, hand-edited, truncated, or
absent. A save that cannot be read must cost the player their progress, never their game --
an exception on the boot path is a mini-game that does not start.

Specifically, all of these produce empty progress: `null`, `''` (what WeChat's
`getStorageSync` returns for a missing key, where a browser returns `null`), text that is not
JSON, a value that is not an object, an array, and a `version` that is not 1. Within a
readable object, star values are clamped to 1..STAR_MAX and keys that are not positive
integers are dropped, rather than the whole save being rejected for one bad entry.

Writes are equally quiet: a failed `setItem` is logged and otherwise ignored. Storage can be
full or disabled, and a player who cannot save should still be able to play.

## Platform

`localStorage` directly. Cocos 3.8.7 exposes it as `sys.localStorage`, and the WeChat
mini-game adapter in this project's own build implements the same interface over wx storage:

```js
{ getItem: e => wx.getStorageSync(e),
  setItem: (e, t) => wx.setStorageSync(e, t),
  removeItem: e => wx.removeStorageSync(e), ... }
```
-- `game/build/wechatgame/web-adapter.js`

So one API covers the editor preview, the browser and the phone, and no `declare const wx` is
needed. Two properties of the wx side shape the design: the calls are SYNCHRONOUS, so nothing
may write per frame, and a missing key reads back as `''` rather than `null`.

## Architecture

### `core/progress.ts` -- pure, and where the tests are

The risky half of this feature is parsing, and parsing is a pure function of a string:

- `emptyProgress(): Progress`
- `parseProgress(raw: string | null): Progress` -- the failure policy above, in one place
- `serializeProgress(p: Progress): string`
- `bestStars(p: Progress, level: number): number` -- 0 for a level never cleared
- `recordClear(p, level, stars): { progress: Progress; changed: boolean }` -- `changed` is
  false for a result equal to or worse than the record, and the caller writes only when it is
  true. Synchronous storage should not be touched for a write that changes nothing.
- `unlockedThrough(p: Progress): number` -- one past the longest RUN of cleared levels
  starting at 1. `{}` gives 1; `{1:3}` gives 2; `{1:3, 3:3}` gives 2, because a result across
  a gap does not extend the run; all ten cleared gives 11, which the caller caps against the
  level count.
- `isUnlocked(p, level): boolean` -- `level <= unlockedThrough(p)`

It goes in core, and is exported through `core/index.ts` like every other core module, because
a rule the view computes for itself is a rule no test can see. The same argument that put
`GameCore.stars()` in core.

### `view/storage.ts` -- thin

`loadProgressText(): string | null`, `saveProgressText(text: string): void`,
`clearProgressText(): void`. Each is a `localStorage` call inside a try/catch that logs once. It
holds the key name and nothing else -- no parsing, no defaults, no policy.

### The gate

A level is playable when `isUnlocked` says so. `HomeView` refuses to report a tap on a locked
chip, which is the single place the rule is enforced: it owns the chips' state, so a second
check in the controller could only disagree with it, and the stakes (a single-player casual
game with no scoring beyond its own stars) do not justify two.

The existing developer door is unchanged and is the way to test a late level: `PICK_ROW` in
`hud-view` puts the in-game picker row back, which bypasses the home screen entirely.

### The home screen

`HomeView.setProgress(p)` updates three things at once, so they cannot drift:

- three small stars under each chip, filled to that level's record, empty for a level cleared
  with fewer, absent for one never cleared. The room is already reserved -- `CHIP_PITCH_Y` was
  set to 140 against a 100 chip for exactly this.
- locked chips dimmed, their number replaced by a padlock, and dropped from the hit test.
- the primary button: `开始游戏` when nothing is cleared, `继续 第 N 关` otherwise, where N is
  `min(unlockedThrough, levelCount)`.

The padlock is drawn from the primitives that exist -- a rounded shackle with a chip-coloured
rounded sprite over its middle to cut it hollow, and a rounded body over the join. `ui-shapes`
has no ring, and an emoji lock is one font substitution away from a hollow box, the same
reason the home button says 主页 rather than wearing a glyph.

When all levels are cleared the button reads `继续 第 10 关`. That is true -- the last level is
the furthest unlocked one -- and reads slightly oddly; a better wording needs another state,
which is not worth it yet.

### When it reads and writes

The save is READ once in `start`, unconditionally -- not alongside the home screen it feeds,
which is built only if a Canvas was found. `onEnd` writes whether or not there is a HUD to
show the result on, so a run that never read a save would overwrite a real one with a single
level's result.

It is WRITTEN in one place: `onEnd`, on a win, when `recordClear` reports a change, and
before the win card goes up -- so the card's "next level" is one the save already agrees is
unlocked, and a player who closes the app on that screen has kept the result. Replaying,
leaving and opening a stall never write.

### Reset: press and hold the title

Three seconds on the home screen's title clears the save. It needs input this game does not
register yet -- `TOUCH_START`, `MOUSE_DOWN` and `TOUCH_CANCEL` alongside the existing
`TOUCH_END`/`MOUSE_UP` -- plus a `scheduleOnce` armed on press and cancelled on release.

It fires at three seconds rather than on release, so the confirmation arrives while the finger
is still down. The confirmation is two things: the grid re-renders fully locked, which is
evidence rather than a claim, and a `进度已清除` toast (`showToast` sets its own node active,
so it works with the in-level HUD hidden).

Hidden rather than a button, because a wipe-my-progress control on the home screen of a
ten-level game is louder than the thing it does.

## Testing

`logic/tests/progress.test.ts`:

- every failure case above returns empty progress, and none of them throws
- star values out of range are clamped; junk keys are dropped without rejecting the save
- `recordClear` records an improvement, reports `changed: false` for an equal or worse result
- `unlockedThrough` for `{}`, `{1:3}`, `{1:3, 3:3}` and a fully cleared save
- serialize then parse is the identity on a valid save

No test covers `view/storage.ts`: there is nothing in it but the platform call and the
try/catch, and the suite does not load a platform.

## Risks

**The gate can strand a tester.** A fresh save allows only level 1, which is exactly the point
for a player and a nuisance for whoever is checking level 7. The `PICK_ROW` door already
exists and is the answer; if it turns out to be used often enough, a `LEVEL_GATE` switch
beside it is the next step, not a second backdoor.

**A cleared save is unrecoverable.** There is no cloud copy and no undo. That is the reason
the reset is a three-second hold on an unlabelled target rather than a button, and the reason
it is the only destructive path in the game.

**Star inflation on re-clear is not a risk.** `recordClear` keeps the maximum, so replaying a
level badly cannot lower a record.
