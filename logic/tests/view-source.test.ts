import * as fs from 'fs';
import * as path from 'path';

const VIEW = path.join(__dirname, '../../game/assets/scripts/view');

/** Extract a top-level function's own body text (between its `{` and the matching closing `}` at
 * column 0) out of already-normalised source. Used to execute real conversion logic rather than a
 * reimplementation of it. */
function extractFn(src: string, signature: string): string {
  const at = src.indexOf(signature);
  if (at < 0) throw new Error(`${signature} not found -- renamed or removed?`);
  const braceStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(braceStart + 1, i);
    }
  }
  throw new Error(`${signature} -- unbalanced braces`);
}

/**
 * Read a source file with its line endings NORMALISED to `\n`.
 *
 * EVERY READ IN THIS FILE GOES THROUGH HERE, and that is a bug fix rather than tidiness. Git
 * stores these files with LF -- `core.autocrlf` is on, so they are normalised on the way IN --
 * and hands them back with CRLF on the way OUT, which is what a Windows working tree holds and
 * therefore what this suite actually reads. Checking the blob tells you nothing about it; only
 * the file on disk does. A guard that matches within one line never notices; one that spans a
 * break sees `;\r\n` where its pattern says `;\n` and silently matches nothing -- which reads
 * as "the pattern is absent from the source", the exact thing these guards are built to
 * report. The pairing guard below shipped in that state and never once ran green.
 *
 * A guard that cannot fail is worse than no guard: it costs a test run and buys a false
 * assurance. Normalising at the single place the bytes enter the suite is what makes the
 * pattern language in the guards mean what it looks like it means.
 */
function readSrc(file: string): string {
  return fs.readFileSync(path.join(VIEW, file), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * The same, for a file under `core/`.
 *
 * A sibling rather than a `readSrc('../core/x.ts')` call, so that "every read in this file is
 * normalised" stays true by CONSTRUCTION rather than by everyone remembering. One guard here
 * already reached for a bare `readFileSync` to get at `core/checkin.ts`, three commits after
 * the bare-read bug above was fixed; it survived by luck, and luck is not what a guard is for.
 */
function readCore(file: string): string {
  return fs.readFileSync(path.join(VIEW, '../core', file), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Source with its comment lines removed.
 *
 * Several guards here assert that a name is ABSENT from a file whose docblocks are required to
 * discuss that very name -- `rail-math.ts` has to say in prose that `railStopT` used to live
 * there. Stripping prose is what lets the guard be about the code.
 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

/**
 * The deleted halo's two names, as SHARED constants.
 *
 * Module-level so the guard and its self-test use the same objects. Written out twice they
 * drift, and the self-test silently stops protecting the guard -- which is what happened.
 */
const HALO_COLOUR = /\bSTOP_RING\b/;
const HALO_FN = /\brailStopT\b/;

/**
 * Every view file that builds a panel by appending children, which is all of them that hold
 * one. A file added here needs no other change: the first test walks the list.
 */
const FILES = ['hud-view.ts', 'home-view.ts', 'home-scene.ts', 'top-bar.ts'];

/** `.children[<number>]` in code, with comments stripped. See the test below for why. */
function indexedChildLookups(src: string): string[] {
  const offenders: string[] = [];
  src.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    // COMMENTS ARE EXEMPT, and that is not laziness. The first version of this guard failed
    // on the very comment explaining the bug it exists to prevent -- a rule that cannot tell
    // code from prose pressures the next person into not writing the explanation down, which
    // costs more than the rule is worth in a file whose docblocks are the point.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const code = trimmed.split('//')[0];
    // A VARIABLE index (`children[i]`) is not this defect: it means "walk them all", which
    // inserting a sibling does not invalidate. Only a literal index is pinned here.
    if (/\.children\s*\[\s*\d+\s*\]/.test(code)) offenders.push(`${i + 1}: ${trimmed}`);
  });
  return offenders;
}

/**
 * A view locates child nodes by NAME, never by sibling index.
 *
 * A source-level guard rather than a behavioural test, because these files import `cc` and
 * this suite does not load the engine -- so this is the only automated check available for
 * the one defect class that has actually shipped here.
 *
 * WHAT IT CAUGHT. `showWin` read its panel as `scrim.children[0]`. That was correct when it
 * was written: the scrim had exactly one child. Two commits later a decorative rotating burst
 * was added, deliberately OUTSIDE the panel so the entrance scale would not scale the glow --
 * and appended BEFORE it. Index 0 silently became the burst. The burst has no `plate` child,
 * so the next line dereferenced null and threw, BEFORE `scrim.active = true` -- the win panel
 * never appeared, and because `onEnd` sets `ended` on its first line and the throw aborted the
 * rest of it, the win sound and the log line went with it. The game read as "you cleared the
 * level and nothing happened", and it read that way for six days, because nothing anywhere
 * could notice.
 *
 * `showUnlockPrompt` had the same lookup and got away with it: it sets `active` BEFORE reading
 * the child, and uses the node only for a bounce tween, so a wrong node would have cost the
 * animation and nothing else. That is not a reason to leave it -- it is the reason it would
 * have gone unnoticed too.
 *
 * A name lookup cannot break that way: inserting, reordering or removing a sibling leaves it
 * pointing at the same node. The rule is worth more than the one bug -- every panel in these
 * files is built by appending children, so any future decoration is another chance to make
 * this mistake, and the failure is silent by construction.
 */
test.each(FILES)('%s never locates a child node by sibling index', (file) => {
  expect(indexedChildLookups(readSrc(file))).toEqual([]);
});

/**
 * `makeLabel` blanks the string on every label it makes.
 *
 * WHAT IT CAUGHT. A fresh Cocos `Label` arrives with its `string` already set to the literal
 * word "label" -- the engine's placeholder for the editor's inspector -- so a caller that
 * builds a label and forgets to give it text does not get an empty space, it gets that word
 * on screen. Both switches in the settings panel shipped that way and were photographed
 * reading "label", twice, in the middle of a panel about sound and vibration.
 *
 * WHAT IT DOES NOT DO, and this is the honest limit of it: it cannot tell whether any given
 * label was ever given text. That would need the engine loaded and every panel built. What it
 * pins is the one line that decides what a FORGOTTEN string looks like -- blank rather than
 * "label" -- so the same mistake costs a hole in a layout, which gets found, instead of a word
 * in a shipped build, which gets photographed.
 */
test('makeLabel blanks the engine placeholder string', () => {
  const src = readSrc('ui-layout.ts');
  expect(src).toMatch(/^\s*label\.string = '';$/m);
});

/**
 * The guard can still see the defect it was written for.
 *
 * Without this, "no offenders" is indistinguishable from "the regex stopped matching" -- and a
 * guard that cannot fail is not a guard. The bad line is the one `showWin` actually shipped.
 */
test('the guard catches an indexed lookup, and is not fooled by prose about one', () => {
  expect(indexedChildLookups('        const panel = scrim.children[0];'))
    .toEqual(['1: const panel = scrim.children[0];']);
  expect(indexedChildLookups('const a = node.children[12];').length).toBe(1);
  // Comments and docblock prose naming the pattern are not offenders.
  expect(indexedChildLookups('// this used to read scrim.children[0], which broke')).toEqual([]);
  expect(indexedChildLookups(' * see `scrim.children[0]` for the bug this prevents')).toEqual([]);
  expect(indexedChildLookups('const p = f(); // was scrim.children[0]')).toEqual([]);
  // A variable index is walking the list, not pinning a position.
  expect(indexedChildLookups('for (const c of n.children) {}')).toEqual([]);
  expect(indexedChildLookups('const c = n.children[i];')).toEqual([]);
  // `children.length` is not an index at all, and HomeView.show uses it.
  expect(indexedChildLookups('n.setSiblingIndex(n.parent!.children.length - 1);')).toEqual([]);
});

/**
 * The lobby has NO fixed label at all now, and neither of the two things it used to need.
 *
 * WHAT THIS GUARD HAS OUTLIVED, in order, because the hazard kept moving and the answer kept
 * changing with it. This screen was once a photograph, which puts arbitrary colour behind
 * arbitrary text -- the title landed on bright sky on one phone and on a white cloud on the
 * next -- so every fixed label wore an outline. When the street became code the colour behind a
 * point became knowable, and an OPAQUE PLATE took the outline's place, guarding a second hazard:
 * a scrolling stop passing through fixed type on a route that fills the screen. The plate was
 * itself the bug -- 320x88, with a badge about 285 tall scrolling behind it, so the badge stuck
 * out top and bottom and the pair read as clipping -- and 「共 N 关」 moved to the standing top
 * bar, where a RIM held it up against known-but-pale pavement.
 *
 * AND NOW THE LABEL IS GONE, on instruction, which retires the whole chain: there is no fixed
 * type on this screen, so there is nothing for a plate or a rim to protect. What is worth
 * guarding is that none of the three retired answers comes back by accident, since each one was
 * reasonable when it was written and would look reasonable again. The caption itself is the
 * first assertion; the plate is the second.
 */
test('the lobby has no fixed caption, and no plate behind where one was', () => {
  const bar = readSrc('top-bar.ts');
  expect(bar).not.toContain('TopBarCaption');
  expect(bar).not.toContain('setCaption');
  expect(bar).not.toContain('rimLabel');
  // And the home screen no longer asks for one either.
  const home = readSrc('home-view.ts');
  expect(home).not.toContain('setCaption');
  // Nor has the floating plate the caption used to sit on come back.
  expect(home).not.toContain("roundedSprite('HomePlate'");
});

/**
 * The top band is the SAME COLOUR as the ground, and it is still opaque.
 *
 * 「顶部的背景色改成一样的」. The cap over the top bar's band and the ramp that dissolves its edge
 * were painted in `GROUND`, the board's pavement blue-grey, which drew a flat grey header across
 * the top sixth of a screen that has no header -- grass everywhere else, a road running up into
 * a band of nothing. Both are `LAWN` now, so the grass continues to the top of the screen.
 *
 * THE SECOND HALF OF THIS TEST IS THE HALF THAT MATTERS. Recolouring the cap to match what is
 * under it makes the cap invisible, and an invisible thing is exactly what a later reader
 * deletes as dead. It is not dead: it is what stops a badge hard-cutting across the full 1280
 * the moment it passes `barBottomY`, because `layout()` deliberately keeps stops alive well
 * above that line. So this asserts both sprites still exist, by name, and that neither has
 * quietly gone back to `GROUND`.
 */
test('the rail cap and its ramp are painted in the ground colour', () => {
  const src = stripComments(readSrc('home-view.ts'));
  expect(src).toMatch(/roundedSprite\('RailCap',[^;]*, LAWN, \d+\);/);
  expect(src).toMatch(/rampSprite\('RailFade',[^;]*, LAWN\);/);
  // Not "these two are not GROUND" but "this screen has no GROUND left on it at all": the
  // import went with the recolour, and a stray reference could only mean one came back.
  expect(src).not.toContain('GROUND');
});

/**
 * The lobby's left-hand column grows as ONE step, sizes and gaps together.
 *
 * 「左上角的三个按钮 尺寸 和 间距都 增加 20%」 -- both halves of that, which is why the gap is
 * asserted alongside the diameters. A column whose controls grew while its gaps stayed put reads
 * as tighter rather than larger, and it is the easiest half of the requirement to miss, because
 * nothing looks wrong in a diff that scales three discs and leaves one number alone.
 *
 * ASSERTED AS THE EXPRESSION, NOT THE RESULT. Pinning `115` would pass just as well if someone
 * typed the literal in and left `COL_SCALE` unused, which is the state this guard exists to
 * prevent: the point is that one step governs all of them, so the check is that each constant is
 * still DERIVED. The rounding is asserted too -- a fractional plate size is what the pass this
 * landed in was opened to get rid of.
 *
 * IT REACHES INTO `home-view` TOO, because the column is drawn from two files and that is
 * exactly where the step was first missed. The bar holds an empty PLACE for the check-in
 * control; the control itself -- its disc and the calendar leaf on it -- is built in
 * `home-view`, which had its own `96` written down. Scaling the bar alone grew the gear and
 * left the button beside it at its old size, in a slot now reserving room for a larger one. So
 * the disc is asserted to be the bar's own exported constant (no second copy of the number) and
 * the leaf to be derived from the same step.
 */
test('the lobby column is sized from one scale step, gaps included', () => {
  const src = stripComments(readSrc('top-bar.ts'));
  expect(src).toMatch(/^export const COL_SCALE = 1\.2;$/m);
  for (const c of ['COIN_W', 'COIN_H', 'COIN_D', 'COIN_PAD', 'COIN_SIZE',
                   'GEAR_D', 'COL_GAP', 'DOT_D']) {
    expect(src).toMatch(new RegExp(`^const ${c} = Math\\.round\\(\\d+ \\* COL_SCALE\\);$`, 'm'));
  }
  expect(src).toMatch(/^export const CHECKIN_D = Math\.round\(\d+ \* COL_SCALE\);$/m);

  // The control that lives in the other file scales with the same step, and takes its diameter
  // from the place it has to fill rather than writing that number down a second time.
  const home = stripComments(readSrc('home-view.ts'));
  expect(home).toMatch(/^import \{ CHECKIN_D, COL_SCALE, TopBar \} from '\.\/top-bar';$/m);
  expect(home).not.toMatch(/^const CHECKIN_ICON_D/m);
  for (const c of ['CAL_W', 'CAL_H', 'CAL_HEAD_H', 'CAL_RING_D']) {
    expect(home).toMatch(new RegExp(`^const ${c} = Math\\.round\\(\\d+ \\* COL_SCALE\\);$`, 'm'));
  }
});

/**
 * The button follows the rail, but a LOCKED stop never becomes the level it plays.
 *
 * THIS SCREEN HAS NOW BEEN WRONG IN BOTH DIRECTIONS, which is why the rule gets a guard rather
 * than a comment. First the button read the scroll position with no gate on it, so scrolling to
 * a locked badge offered to start a locked level. The cure was to stop the button reading the
 * rail at all -- which produced the opposite complaint, 「已经玩到第6关了，好像没法选之前的5关」:
 * a cleared level could be dragged to the middle and still not be played.
 *
 * THE RULE THAT SATISFIES BOTH is a fallback, not a refusal: follow the rail onto any stop the
 * save has opened, and on a locked one leave the button alone, still offering `unlocked`. So
 * what is pinned here is the fallback line itself -- the `state === 'locked'` test and the
 * `this.unlocked` it falls back to -- because deleting either half is what restores one of the
 * two bugs, and both halves live on one line.
 *
 * THE WORDING IS PINNED SEPARATELY, for a different failure: `replay` has to come from the
 * PLAYED stop's own state, not from comparing the level against `unlocked`. On a fully cleared
 * save `unlocked` is capped at `levelCount`, so that comparison would call the last level a
 * first run forever.
 */
test('the lobby button falls back to the save when the rail aims at a locked stop', () => {
  const src = stripComments(readSrc('home-view.ts'));
  expect(src).toContain(
    "const level = !aimed || aimed.state === 'locked' ? this.unlocked : this.focused + 1;");
  expect(src).toContain('const played = this.stops[level - 1];');
  expect(src).toContain("this.setStart(level, played !== undefined && played.state === 'done');");
  // The wording is the stop's state, never an arithmetic stand-in for it.
  expect(src).not.toMatch(/replay = level < this\.unlocked/);
});

/**
 * The home screen is built back to front: street, rail, the cap and its ramp, then the bar.
 *
 * Cocos draws siblings in the order they were appended, so build order IS z-order here, and
 * every one of these pairs is load-bearing. THE STREET BEFORE THE RAIL: `HomeScene` strokes a
 * road through the stop centres, and a road appended after the stops paints over the stops it
 * is meant to run under. THE CAP AND RAMP AFTER THE RAIL: they exist to hide the top of a
 * climbing badge, and a cover drawn under the badges covers nothing. THE BAR LAST: the bar is
 * the frame, and a frame with a pavement-tinted cap drawn over it is a frame behind a wash.
 *
 * BOTH HALVES OF THE COVER ARE PINNED, not just the ramp, and that is the point of this
 * revision. The first version of this screen's top edge was the ramp ALONE, anchored with its
 * opaque side at `barBottomY` -- which covers a badge right up to that line and nothing above
 * it, so the badge reappeared at full opacity one pixel higher behind a razor cut across the
 * full width. A guard that watched only the ramp would have stayed green through exactly that.
 * It replaces a plate that used to be the last of the list, and the plate's own entry here is
 * why the order is pinned by CONSTRUCTION LINES rather than by prose: moving any one of them
 * past another has to come and change this test rather than changing only the picture.
 *
 * THE BAR'S LINE NOW CARRIES A SECOND FACT, and it is the reason this string is spelled out in
 * full rather than matched loosely. It used to read `new TopBar(this.root, w, h)`; it reads
 * `new TopBar(this.root, w, this.barBottom)` because the bar is HANDED the band position this
 * screen already resolved instead of calling `barBottomY` a fourth time. `HomeView` centres the
 * rail on the free band UNDER the bar, so if the rail's idea of the band and the bar's idea of
 * it differ, the rail is centred on nothing and nothing says so. One read, passed down, makes
 * them agree BY CONSTRUCTION, and pinning the argument list here stops the call being helpfully
 * "simplified" back into a second call to `barBottomY`.
 *
 * THE CAP AND THE RAMP ARE FOUND BY NAME, NOT BY THEIR WHOLE CONSTRUCTION LINE, and that is a
 * deliberate retreat from how this test used to find them. It matched each line in full, colour
 * argument included -- so recolouring the cap (which happened, from `GROUND` to `LAWN`) failed a
 * test about ORDER, with a message about an index being -1 that says nothing at all about what
 * actually changed. The colour is a fact with its own guard; this one owns only the sequence.
 *
 * THAT IS A STRUCTURAL RULE, NOT A CLAIM ABOUT TIMING, and the difference matters because the
 * timing claim is what this paragraph used to make. `capsuleInset()` spent a while deliberately
 * NOT caching an unanswered read so that a later caller could retry, which made `barBottomY`
 * legitimately return one number early in a session and a larger one later; the retry is gone
 * (it had exactly one caller -- see `ui-layout`) and `capsuleInset` now caches whatever its
 * single read answers. So two calls cannot disagree today. Today is not a guarantee, and the
 * one-read shape costs nothing to keep.
 */
test('the home screen builds street, then rail, then cap and ramp, then bar', () => {
  const src = readSrc('home-view.ts');
  const street = src.indexOf('this.scene = new HomeScene(this.root, w, h, BADGE_MAX_R);');
  const rail = src.indexOf("this.railRoot = new Node('RailStops');");
  const cap = src.indexOf("const cap = roundedSprite('RailCap',");
  const fade = src.indexOf("const fade = rampSprite('RailFade',");
  const bar = src.indexOf('this.topBar = new TopBar(this.root, w, this.barBottom);');
  expect(street).toBeGreaterThan(0);
  expect(rail).toBeGreaterThan(street);
  expect(cap).toBeGreaterThan(rail);
  expect(fade).toBeGreaterThan(rail);
  expect(bar).toBeGreaterThan(cap);
  expect(bar).toBeGreaterThan(fade);
  // The cap's opaque band reaches the screen's top edge, and the ramp hangs BELOW the cap's
  // lower edge rather than sharing it -- the two numbers that make the join seamless.
  expect(src).toContain('cap.setPosition(0, (this.barBottom + h) / 2, 0);');
  expect(src).toContain('fade.setPosition(0, this.barBottom - RAIL_FADE_H / 2, 0);');
});

/**
 * The rail's centre and the street's centre are written TOGETHER, every time either is written.
 *
 * `HomeView` hangs its rail off the middle of the free band between the top bar and the start
 * button rather than off the middle of the canvas, and `HomeScene` has to hang the road off the
 * same y. Two objects, one number, and the number is written in FOUR places -- the pair runs
 * once in the constructor (before the level count is known) and again in `setLevels` (once the
 * road can be built). Drop or retune either half of either pair and the road comes out running
 * parallel to the badges and a few dozen units beside them, which reads as a drawing mistake
 * rather than as the arithmetic one it is, and `core/home-path`'s whole guarantee that the road
 * passes through the stop centres is spent on nothing.
 *
 * THIS IS THE SHAPE BOTH OF ITS NEIGHBOURS WERE ALREADY BITTEN BY. The build-order guard above
 * watched the ramp and not the cap, and would have stayed green through a defect in the half it
 * was not watching; the offset/edge guard below watched `scene.layout` and not what the STOPS
 * cull against, and would have stayed green while the two drifted apart. Both were widened for
 * the same reason, and this is the third instance of it: watching `railRoot.setPosition` alone
 * would stay green while somebody removed the `setRailCenter` beside it.
 *
 * So: every write of one is adjacent to a write of the other, both from `railCenterY()`, and
 * there are no writes of either outside those pairs.
 */
test('the rail centre and the street centre are always written together', () => {
  const src = readSrc('home-view.ts');
  // Comments stripped, the rule every source guard in this file works under: a docblock that
  // quotes one of these lines is prose about the pairing, not a second write of it.
  const code = src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
  const pairs = code.match(
    /this\.railRoot\.setPosition\(0, this\.railCenterY\(\), 0\);\n\s*this\.scene\.setRailCenter\(this\.railCenterY\(\)\);/g,
  ) ?? [];
  // Both call sites: the constructor's, and `setLevels`'s once the road exists.
  expect(pairs.length).toBe(2);
  // And neither half is ever written on its own, with any argument.
  expect((code.match(/this\.railRoot\.setPosition\(/g) ?? []).length).toBe(pairs.length);
  expect((code.match(/this\.scene\.setRailCenter\(/g) ?? []).length).toBe(pairs.length);
});

/**
 * The street scrolls on the rail's own offset and culls against the rail's own edge.
 *
 * `core/home-path` exists to make "the road passes exactly through the stop centres" a fact a
 * test can assert without an engine, and `legSamples(i)[0] === nodeCenter(i)` is that test. ALL
 * OF THAT IS SPENT if the view hands the road a different scroll position from the one it hands
 * the stops: the road comes out parallel to the route and a few units beside it, which reads as
 * a drawing mistake rather than as the arithmetic error it is, and no test in the core suite can
 * see it because both halves are individually correct.
 *
 * One call, both numbers, taken from the same two locals the stop loop below it reads.
 *
 * ALL THREE LINES ARE PINNED, not just the call. The first version of this guard asserted the
 * `scene.layout` call and the declaration of `edge` and stopped there -- which would have stayed
 * green while somebody changed what the STOPS cull against, leaving the street culling on a
 * threshold nothing else uses. A guard that only watches one end of an agreement is watching
 * nothing.
 */
test('the street is laid out on the same offset and edge as the stops', () => {
  const src = readSrc('home-view.ts');
  expect(src).toMatch(/const edge = this\.h \* 0\.75;/);
  expect(src).toContain('this.scene.layout(this.offset, edge);');
  // The stop loop's own cull, reading the same local.
  expect(src).toContain('Math.abs(y) > edge');
});

/**
 * `home-view` asks `core/level-state` what a level's state is, and never works it out itself.
 *
 * WHAT IT PINS. `levelState(p, level)` returns one of `'done' | 'current' | 'locked'` and
 * `starsFor(p, level)` returns 0 for anything that is not `'done'`. Between them there is
 * exactly ONE place that decides what a level is, and the three answers are mutually exclusive
 * because they are a union rather than three booleans. The moment the view calls `bestStars`
 * itself there are two places again, and the second one has no idea about the lock.
 *
 * WHAT THAT COST. This screen used to compute `open = isUnlocked(...)`, `best = bestStars(...)`,
 * `done = best > 0`, and then draw the stars as `open && done` -- correct, but only because
 * somebody remembered the `&&`. "Locked" and "has stars" are independent facts that a gapped
 * save makes both true at once, so dropping that one operator paints three stars on a level the
 * same frame draws a padlock on. The earlier investigation deliberately did NOT pin the
 * `open && done` expression, because pinning a workaround would have blocked the rewrite that
 * removed the need for it; this pins the invariant that replaced it instead.
 *
 * A SOURCE GUARD because `home-view.ts` imports `cc` and this suite does not load the engine --
 * the same limit every test in this file works under. It cannot prove the view draws the right
 * badge; it can prove the view is not asking a second source what to draw.
 */
test('home-view reads level state from core and never calls bestStars itself', () => {
  const src = readSrc('home-view.ts');
  const code = src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
  expect(code).not.toMatch(/\bbestStars\s*\(/);
  // And the pair that replaced it is genuinely being called, so "no bestStars" cannot be
  // satisfied by a file that stopped reading the save at all.
  expect(code).toMatch(/\blevelState\s*\(/);
  expect(code).toMatch(/\bstarsFor\s*\(/);
});

/**
 * `props.ts` cancels its holder's rotation when it bakes a prop's board position into the mesh.
 *
 * WHAT IT CAUGHT, on a device rather than here. The props are merged by colour into one mesh
 * each, which means a prop's position has to live in its VERTICES -- there is no per-prop node
 * to put it on. The merged meshes then hang off one holder turned +90 about X, which is what
 * stands the trees up: it maps model +Y onto board +Z (the height) and model +Z onto board -Y
 * (the position). Writing `bz = spot.y` therefore mirrors every prop to the opposite half of
 * the board. The trees were meant to flank the parking bay; they rendered on top of the lot,
 * sitting over the cars.
 *
 * WHY A GUARD AND NOT A TEST. Nothing throws, nothing is out of bounds, and the picture is
 * plausible -- a tree is a tree wherever it lands, so this reads as a placement choice rather
 * than a defect until someone notices it is covering the board. `pax-figure` never meets it
 * because it turns a per-figure `fit` node and positions the unrotated root above it; this
 * file is the only place in the view that bakes a position through a rotation, and the sign is
 * the whole of the correctness.
 */
test('props.ts negates the board Y it bakes into the mesh', () => {
  const src = readSrc('props.ts');
  const code = src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
  // The depth fed to `placed` must be the negated board Y, never the raw one.
  expect(code).toMatch(/const\s+bz\s*=\s*-\s*spot\.y\s*;/);
  expect(code).not.toMatch(/const\s+bz\s*=\s*spot\.y\s*;/);
});

/**
 * The scene dressing's vertical budget, checked against the band it has to live in.
 *
 * WHY THIS IS A TEST AND THE ONE ABOVE IS A GUARD. `PROP_ROWS` scatters six props DOWN from the
 * bay's centre to stop them reading as four mirrored twins, and every one of those offsets is
 * bounded by something it cannot see: a lamp is 1.15 tall and the loop track sits just past the
 * bay's top edge, so a lamp nudged UP puts its head through the track; a bed is BED_D across and
 * the ring road is just past the bottom edge, so a prop nudged DOWN spills its bed onto the road.
 * Both failures are a few hundredths of a unit away from the values that ship, both look like
 * plausible scenery in a screenshot, and NOTHING in the scene complains about either.
 *
 * The numbers come out of the sources rather than being written here, so the test tracks a
 * retune of the props, of the stall, or of the car's scale instead of going stale against them.
 */
test('every scene prop stays inside the parking band, top and bottom', () => {
  const num = (src: string, name: string): number => {
    const m = new RegExp(`const ${name}\\s*=\\s*(-?[0-9.]+)\\s*;`).exec(src);
    if (!m) throw new Error(`${name} not found -- renamed?`);
    return Number(m[1]);
  };
  const props = readSrc('props.ts');
  const bay = readSrc('parking-view.ts');
  const types = readSrc('../core/types.ts');

  // The bay band's half-height, derived exactly as `bayPanelSize(stallFootprint(scale))` does,
  // in units of the board scale. CAP_BOX.big is the stall's sizing case: a bus has to fit.
  const carScale = num(types, 'CAR_SCALE');
  const bigLen = Number(/big:\s*\{[^}]*len:\s*([0-9.]+)/.exec(types)![1]);
  const bigWid = Number(/big:\s*\{[^}]*wid:\s*([0-9.]+)/.exec(types)![1]);
  const stallH = bigLen * carScale * num(bay, 'STALL_AIR_LEN');
  const stallW = bigWid * carScale * num(bay, 'STALL_AIR_WID');
  const halfH = (stallH + 2 * num(bay, 'PANEL_PAD_Y') * (stallW / num(bay, 'GLYPH_REF_W'))) / 2;

  // How tall each kind stands off its own foot, and how wide the bed under it is.
  const lampTop = num(props, 'BASE_H') + num(props, 'POLE_H') + num(props, 'SHADE_H');
  const crownTop = Math.max(...[...props.matchAll(/\{\s*r:\s*([0-9.]+),\s*x:[^,]+,\s*y:\s*([0-9.]+)/g)]
    .map((m) => Number(m[1]) + Number(m[2])));
  const bedR = num(props, 'BED_D') / 2;

  const rows = [...props.matchAll(
    /\{\s*kind:\s*'(tree|lamp)',\s*side:\s*(-?1),\s*drop:\s*([0-9.]+),\s*size:\s*([0-9.]+)\s*\}/g,
  )].map((m) => ({ kind: m[1], side: Number(m[2]), drop: Number(m[3]), size: Number(m[4]) }));
  expect(rows.length).toBeGreaterThanOrEqual(4);

  for (const r of rows) {
    const top = -r.drop + (r.kind === 'lamp' ? lampTop : crownTop) * r.size;
    expect(top).toBeLessThan(halfH);
    // A lamp's bed is smaller than a tree's; using the tree's for both is the safe side.
    expect(-r.drop - bedR * r.size).toBeGreaterThan(-halfH);
  }

  // Two trees sharing a side share an x lane, so their crowns must not run into each other.
  const span = num(props, 'CROWN_SPAN');
  for (const side of [-1, 1]) {
    const lane = rows.filter((r) => r.kind === 'tree' && r.side === side)
      .sort((a, b) => a.drop - b.drop);
    for (let i = 0; i + 1 < lane.length; i++) {
      const gap = lane[i + 1].drop - lane[i].drop;
      expect(gap).toBeGreaterThan(span * (lane[i].size + lane[i + 1].size));
    }
  }
});

/**
 * The lobby's street still has no kerb.
 *
 * WHAT THIS GUARDS, AND WHAT IT STOPPED GUARDING. `home-scene.ts` used to paint a kerb under the
 * road and scatter trees and street lamps along the verge; all three were deleted at once,
 * because the kerb read as a soft blurred ring rather than a lip (which a player photographed
 * and reported as the whole street being out of focus) and the trees and lamps read as colour
 * dots rather than as scenery. The kerb stays deleted -- nothing fixed the ring, so nothing
 * brought it back. Trees and lamps came back in a later revision, deliberately, because they now
 * carry the outline and the hard shadow that were the actual missing ingredient; this guard no
 * longer bans `TREE_`/`LAMP_`, and the guard below checks the thing that was actually missing
 * instead of the identifiers that happened to be attached to it.
 */
test('home-scene has no kerb identifiers', () => {
  const src = readSrc('home-scene.ts');
  expect(src).not.toMatch(/\bKERB_/);
});

/**
 * Every tree and every lamp carries an outline and a hard shadow -- the requirement's own kill
 * switch: 「必须有描边和硬投影……做不到有描边有投影就先不要放」.
 *
 * WHAT THIS GUARDS. The colour-dot failure this file's header describes was not "no trees or
 * lamps drawn" -- it was trees and lamps drawn AS FLAT DOTS, with nothing behind them to read as
 * an edge or a drop. `buildTree` and `buildLamp` are the only two places that construct one, so
 * pinning what each of THOSE functions does is pinning the property for every tree and lamp the
 * screen ever draws, not just the ones on screen today.
 *
 * THE OUTLINE CHECK IS FOR `shade(`, NOT FOR A COLOUR LITERAL, because the requirement names the
 * mechanism ("the screen's one outline idiom") rather than a number -- a hand-picked darker
 * literal would satisfy "looks darker" today and drift from the crown/head colour on the next
 * retune, which `shade` cannot do by construction (see its own docblock in `palette.ts`).
 *
 * THE SHADOW CHECK IS FOR `ROAD_SHADOW` AND THE SHARED OFFSETS, NOT A FRESH ALPHA-64 COLOUR OR A
 * FRESH `(2, -3)` PAIR, because the brief is explicit that the road's shadow already defines
 * these constants and a tree or lamp shadow must reuse them rather than write a second copy that
 * can drift from the first.
 *
 * A SOURCE GUARD, for the reason every guard in this file is one: this suite does not load the
 * engine, so it cannot render a tree and measure whether it reads as a colour dot. What it CAN
 * pin is that the code path which builds one never stops calling `shade` or stops reusing the
 * road's own shadow constants.
 */
test('every tree and lamp carries an outline (shade) and the road\'s own hard shadow', () => {
  const src = readSrc('home-scene.ts');
  for (const fn of ['private buildTree(', 'private buildLamp(']) {
    const body = extractFn(src, fn);
    expect(body).toMatch(/shade\(/);
    expect(body).toContain('ROAD_SHADOW');
    expect(body).toContain('SHADOW_OFFSET_X');
    expect(body).toContain('SHADOW_OFFSET_Y');
  }
});

/**
 * The guard above can still see the defect it is written for.
 *
 * Without this, "found" is indistinguishable from "the check stopped running" -- the same
 * discipline every self-test in this file applies. This is not a reimplementation of the guard;
 * it runs `extractFn` itself, the same function the guard above calls, against a hand-built
 * "reverted" tree builder that draws a flat dot with no outline and no shadow, and confirms the
 * guard's own assertions would fail against it.
 */
test('the outline/shadow guard would fail against a reverted, flat-dot tree builder', () => {
  const reverted = `
    private buildTree(leg: Node, i: number, side: number, y0: number, y1: number): void {
        const tree = container(\`Tree\${i}\`, leg);
        const crown = dotSprite('crown', TREE_D, COLORS.green);
        tree.addChild(crown);
    }
  `;
  const body = extractFn(reverted, 'private buildTree(');
  expect(body).not.toMatch(/shade\(/);
  expect(body).not.toContain('ROAD_SHADOW');
});

/**
 * The road's shadow is drawn before the road, across the whole street.
 *
 * `HomeScene` keeps the shadow and the road in two separate containers -- `shadows` appended to
 * `street` before `roads` -- rather than drawing each leg's shadow-then-road pair in one
 * container, because legs are siblings that overlap at the stop they share: a leg drawing both
 * of its own layers before its neighbour would let that neighbour's later layer paint over this
 * leg's already-drawn one at the shared seam. This is the same ordering rule the kerb used to
 * need, checked here because a "helpful" simplification that inlines the shadow into the road's
 * own container would reintroduce exactly that bug, quietly, per leg.
 */
test('home-scene draws the shadow pass before the road pass', () => {
  const src = readSrc('home-scene.ts');
  const shadows = src.indexOf("this.shadows = container('Shadows', this.street);");
  const roads = src.indexOf("this.roads = container('Roads', this.street);");
  expect(shadows).toBeGreaterThan(0);
  expect(roads).toBeGreaterThan(shadows);
});

/**
 * The road shadow's three numbers, pinned as literals.
 *
 * THE SIGN IS THE ONE THAT MATTERS. Canvas +y is UP, so a shadow falling DOWN-right is
 * `(+2, -3)` -- and `-3` reads as wrong to anyone who has not stopped to work out which way
 * the axis points, which makes it a standing invitation to be "corrected" to `+3`. That edit
 * would compile, typecheck, pass every other guard in this file, and put the street's shadow
 * on the wrong side of the road, where it reads as a second faint road rather than as depth.
 *
 * The alpha is here for a different reason: 64 is a DEPARTURE from `shadow.ts`'s `SHADOW_ALPHA`
 * (44) and `CONTACT_ALPHA` (112), settled by a product decision. `home-scene`'s docblock argues
 * it; this makes the argument load-bearing, so a later unification pass that sweeps the file
 * toward the shared constants has to come through here and read that argument first.
 *
 * Source-level rather than behavioural because these files import `cc` and this suite does not
 * load the engine -- the same honest limit every guard in this file works under.
 */
test('the road shadow falls down-right, at the alpha that was chosen over shadow.ts', () => {
  const src = readSrc('home-scene.ts');
  expect(src).toMatch(/^const SHADOW_OFFSET_X = 2;$/m);
  expect(src).toMatch(/^const SHADOW_OFFSET_Y = -3;$/m);
  expect(src).toMatch(/^const ROAD_SHADOW = new Color\(SHADOW_INK\.r, SHADOW_INK\.g, SHADOW_INK\.b, 64\);$/m);
});

/**
 * The lobby's ground is four layers, appended in one fixed order: lawn, then paving, then
 * shadow, then road -- and never rearranged into a per-leg stack.
 *
 * WHY THIS MATTERS MORE FOR `PAVING` THAN FOR THE PAIR ABOVE. `PAVING` is wider than `ROAD`
 * the same way the deleted kerb was (see `home-scene.ts`'s header), so it is the layer that
 * would actually repeat that old bug if a leg drew its own paving-then-road pair instead of
 * every leg's paving being drawn, across the whole street, before any leg's road: a
 * neighbouring leg's later, wider paving would repaint this leg's already-drawn, narrower road
 * right where they share a stop, leaving the same crescent of wrong colour the kerb used to.
 *
 * Checked as container-DECLARATION lines in source order, not as one regex over the whole
 * file, because source order of these four `container(...)` calls is exactly what determines
 * paint order here -- Cocos draws siblings in the order they were appended to `street`, not in
 * whatever order `build()`'s per-leg loop happens to create their children.
 */
test('home-scene appends its four ground containers lawn -> paving -> shadow -> road', () => {
  const src = readSrc('home-scene.ts');
  const lawn = src.indexOf("roundedSprite('Lawn', w * 2, h * 2, LAWN, 2)");
  const paving = src.indexOf("this.paving = container('Paving', this.street);");
  const shadows = src.indexOf("this.shadows = container('Shadows', this.street);");
  const roads = src.indexOf("this.roads = container('Roads', this.street);");
  expect(lawn).toBeGreaterThan(0);
  expect(paving).toBeGreaterThan(lawn);
  expect(shadows).toBeGreaterThan(paving);
  expect(roads).toBeGreaterThan(shadows);
});

/**
 * The centre dashes are appended AFTER the road -- a fifth container, not a spot inside the
 * road's own per-leg loop -- and their length/gap/thickness keep the ratios the board's own
 * dashed lot border uses, not its raw board-unit figures.
 *
 * WHY A CONTAINER OF ITS OWN, EVEN THOUGH A DASH IS NARROWER THAN THE ROAD. `strokePath`'s own
 * segments overhang by half their width at each end to bridge a shared stop, so a later leg's
 * road reaching back over that stop would still paint over an earlier leg's already-drawn dash
 * if the dash lived inside the road's own per-leg container -- "wider eats narrower" is not the
 * only way this class of bug shows up.
 *
 * THE RATIO CHECK READS BOTH SIDES OUT OF SOURCE rather than hard-coding the board's numbers a
 * second time, so a deliberate retune of either file's dash geometry moves both sides of the
 * comparison together instead of leaving this test comparing stale figures to a live file.
 */
test('the centre dashes sit after the road, and their ratios track the lot border\'s', () => {
  const src = readSrc('home-scene.ts');
  const roads = src.indexOf("this.roads = container('Roads', this.street);");
  const dashes = src.indexOf("this.dashes = container('Dashes', this.street);");
  expect(roads).toBeGreaterThan(0);
  expect(dashes).toBeGreaterThan(roads);

  const num = (source: string, name: string): number => {
    const m = new RegExp(`const ${name}\\s*=\\s*([0-9.]+);`).exec(source);
    if (!m) throw new Error(`${name} not found in home-scene.ts -- renamed?`);
    return Number(m[1]);
  };
  const dashLen = num(src, 'DASH_LEN');
  const dashGap = num(src, 'DASH_GAP');
  const dashThick = num(src, 'DASH_THICK');

  const board = readSrc('scene-stage.ts');
  const boardDash = Number(/\bdash = ([0-9.]+)/.exec(board)![1]);
  const boardGap = Number(/\bgap = ([0-9.]+)/.exec(board)![1]);
  const boardThick = Number(/\bthick = ([0-9.]+)/.exec(board)![1]);

  // The RATIOS travel, not the board-unit figures -- see `DASH_LEN`'s own docblock.
  expect(dashGap / dashLen).toBeCloseTo(boardGap / boardDash, 1);
  expect(dashThick / dashLen).toBeCloseTo(boardThick / boardDash, 1);
});

/**
 * The scenery -- trees and lamps -- is its own fifth container, appended last of all.
 *
 * WHY LAST RATHER THAN A SIXTH SPOT IN AN EXISTING PER-LEG LOOP. `vergeIn` keeps every tree and
 * lamp clear of `PAVING`'s own band by construction, so unlike `paving`/`dashes` above it has no
 * "wider eats narrower" seam to protect against -- but it still needs its OWN container, appended
 * after `dashes`, so a leg's scenery cannot be caught underneath a neighbouring leg's ground layer
 * at the stop they share.
 */
test('home-scene appends the scenery container last, after the dashes', () => {
  const src = readSrc('home-scene.ts');
  const dashes = src.indexOf("this.dashes = container('Dashes', this.street);");
  const scenery = src.indexOf("this.scenery = container('Scenery', this.street);");
  expect(dashes).toBeGreaterThan(0);
  expect(scenery).toBeGreaterThan(dashes);
});

/**
 * Whether two substrings ever occur within `window` characters of one another, anywhere in
 * `src`. Every occurrence of `a` is checked against every occurrence of `b`, so it does not
 * matter which one comes first or how many times either appears.
 */
function within(src: string, a: string, b: string, window: number): boolean {
  const idxA: number[] = [];
  for (let i = src.indexOf(a); i !== -1; i = src.indexOf(a, i + 1)) idxA.push(i);
  for (let j = src.indexOf(b); j !== -1; j = src.indexOf(b, j + 1)) {
    if (idxA.some((k) => Math.abs(k - j) <= window)) return true;
  }
  return false;
}

/**
 * The start button's label never carries the "locked" wording.
 *
 * WHAT THIS GUARDS. `setFocus` used to write `this.startLabel.string` to either the playable
 * string or `` `通过第 ${this.focused} 关解锁` `` depending on `focusOpen` -- so scrolling the
 * rail to a locked badge re-labelled the ONE button in the game as a refusal, even though the
 * save still allowed a different, playable level.
 *
 * `setFocus` WRITES THE BUTTON AGAIN NOW, so this guard is load-bearing in a way it briefly was
 * not. For one pass the button ignored the rail entirely and the refusal wording had nowhere to
 * come from; today the button follows the rail again (see the fallback guard above), which puts
 * the original defect back within one edit -- a locked aim is once more a branch in the method
 * that writes `startLabel`, and the wrong thing to do in that branch is to say so on the button.
 * The right thing, which is what ships, is to leave the button offering `unlocked` and let
 * `showLockedToast` answer. The locked wording therefore still lives only in the toast, nowhere
 * near `startLabel`.
 *
 * A SOURCE GUARD, for the reason every guard in this file is one: this suite does not load the
 * engine, so it cannot render the button and read what it says. 200 characters is not a precise
 * boundary -- it is wide enough to catch the phrase sitting right next to a `startLabel` write
 * (as it did) and it does not need to be any tighter than that.
 */
test('the start button never carries the locked wording near its label', () => {
  const src = readSrc('home-view.ts');
  expect(within(src, 'startLabel', '通过第', 200)).toBe(false);
});

/**
 * The guard above can still see the defect it is written for.
 *
 * Without this, "not found" is indistinguishable from "the check stopped running" -- the same
 * discipline the sibling-index guard's own self-test applies. The first case is the actual bug
 * this project shipped (`startLabel` and `通过第` a few characters apart); the second confirms
 * 200 characters is actually being enforced as a WINDOW and not treated as "anywhere in the
 * file" -- the toast's own `通过第 ${n} 关解锁` line is far from every `startLabel` write, and a
 * guard that could not tell the difference would fail on this file forever.
 */
test('the locked-wording guard is not fooled by distance or absence', () => {
  const near = "this.startLabel.string = ok ? 'a' : ('通过第' + n + '关解锁');";
  expect(within(near, 'startLabel', '通过第', 200)).toBe(true);
  const far = `this.startLabel.string = 'ok';\n${' '.repeat(250)}const t = '通过第' + n;`;
  expect(within(far, 'startLabel', '通过第', 200)).toBe(false);
  expect(within('no occurrences of either token here', 'startLabel', '通过第', 200)).toBe(false);
});

/**
 * The scroll-bound halo does not come back: no `STOP_RING` anywhere in the home screen, and
 * `railStopT` -- its only reader's only reason to exist -- gone from `rail-math.ts` too.
 *
 * WHAT THIS GUARDS. `STOP_RING` was a success-green ring painted in `NODE_DONE`'s own colour
 * and bound to the SCROLL rather than the save: drag a locked level to the middle and the halo
 * landed on its padlock. The fix moved the glow onto the badge the save calls current
 * (`CUR_GLOW`, toggled by `state` alone) and deleted the scroll-driven one along with the
 * function that measured distance from the centre for it. Either name reappearing -- the colour
 * under a new spelling, or the function with a new caller -- is the same defect coming back.
 *
 * A SOURCE GUARD, for the reason every guard in this file is one: this suite does not load the
 * engine, so it cannot drag the rail and photograph what lands on a padlock.
 */
test('the padlock halo is gone: no STOP_RING, and railStopT is gone from rail-math', () => {
  const home = stripComments(readSrc('home-view.ts'));
  const railMath = stripComments(readSrc('rail-math.ts'));
  expect(home).not.toMatch(HALO_COLOUR);
  expect(railMath).not.toMatch(HALO_FN);
  // `stripComments` must still be leaving CODE behind. Without this, a strip that removed
  // everything would make both assertions above pass on any input at all -- the exact failure
  // an absence guard is defenceless against.
  expect(railMath).toContain('export function railOffset');
});

/**
 * The guard above can still see the defects it is written for.
 *
 * Without this, "absent" is indistinguishable from "the pattern stopped matching" -- the same
 * discipline every self-test in this file applies. Both patterns are checked against the exact
 * declarations this file used to carry, before either was deleted.
 */
test('the halo guard is not fooled into passing on an empty pattern', () => {
  // THE SAME REGEXES THE GUARD USES, by reference. An earlier version of this test wrote its
  // own copies of them, which made it decorative: breaking the guard's patterns could not fail
  // it, so it protected nothing while looking exactly like the self-tests that do.
  expect(HALO_COLOUR.test('const STOP_RING = new Color(86, 199, 104, 90);')).toBe(true);
  expect(HALO_FN.test('export function railStopT(offset: number, i: number): number {'))
    .toBe(true);
  // And `stripComments` must not eat code, which is the other half of the guard above.
  expect(stripComments('const STOP_RING = 1;\n// const STOP_RING = 2;'))
    .toBe('const STOP_RING = 1;');
});

/**
 * The scroll hint exists, hides with the rest of the menu, and fades with the SAME ramp
 * `RailFade` already dissolves into the bar -- not a second easing invented for it.
 *
 * A SOURCE GUARD, for the reason every guard in this file is one: this suite does not load the
 * engine, so it cannot scroll the rail and photograph what the hint does near the bar. What it
 * can pin is that `updateScrollHint` drives the hint's opacity from the identical smoothstep
 * `rampSprite` bakes into `RailFade`'s own texture, and that `revealMenu` hides the hint along
 * with the rail and the button while the barrier is down.
 */
test('the scroll hint fades with the same ramp as RailFade, and hides with the menu', () => {
  const src = readSrc('home-view.ts');
  expect(src).toContain("triSprite('ScrollHint'");
  expect(src).toMatch(/t \* t \* \(3 - 2 \* t\)/);
  expect(src).toContain('this.scrollHint.active = on;');
});


/**
 * The merged coin/free-coins pill is drawn and has NO handler, and that is on instruction.
 *
 * 「免费金币暂时只能看，点击无反应」 -- it fronts a rewarded video and there is no ad unit to point
 * it at yet. The free-coins entry used to be a separate reserved place with its own `onTap:
 * null`; it merged into `TopBar`'s own coin pill (see task 7's brief), and the null handler moved
 * with it into `coinTap`. The risk this guards is not that someone deletes the pill; it is that
 * someone reads `coinTap`'s `null` as an oversight and "fixes" it with a toast, a disabled state,
 * or an empty function. Any of those changes what the player gets, and none of them would fail
 * anything else in this suite.
 *
 * It pins the NULL FIELD rather than the absence of a handler, because those differ in what they
 * say: an omitted field would also mean inert, and would read as forgotten. It also pins that
 * `tapCoins` reaches it through `?.`, not a direct call -- a direct call on a `null` field would
 * throw the moment anyone tapped the pill.
 */
test('the lobby merges free-coins into the coin pill, with a null handler, deliberately', () => {
  const src = readSrc('top-bar.ts');
  expect(src).toContain('private readonly coinTap: (() => void) | null = null;');
  expect(src).toContain('this.coinTap?.();');
  // And the old two-slot machinery is actually gone, not merely unused -- a stray `setSlot` or
  // `SLOT_FREE_COINS` left behind would mean the merge was cosmetic rather than real. Comments
  // are stripped first: this file's own docblocks are allowed to name what used to be here (the
  // same allowance `stripComments`'s own header gives the halo guard below), and only CODE
  // reappearing is the defect this checks for.
  const home = stripComments(readSrc('home-view.ts'));
  expect(home).not.toContain('SLOT_FREE_COINS');
  expect(home).not.toContain('buildFreeCoinsIcon()');
});

/**
 * `barBottomY` is called exactly ONCE on the home screen, in `HomeView`'s own constructor.
 *
 * WHAT THIS GUARDS. `TopBar`'s constructor docblock (and `HomeView.barBottom`'s own) spend a
 * long paragraph each arguing that a second call site is how the rail and the bar's idea of the
 * shared band drift apart -- `capsuleInset()` only caches ONE read, so two calls that happened to
 * agree today are not guaranteed to agree tomorrow. Turning the bar from a row into a column
 * changed nothing about that argument, and it would be exactly the kind of change that tempts a
 * "simplification" back to `barBottomY(w, h)` inside `top-bar.ts` now that it already imports the
 * two constants the function is built from.
 *
 * A SOURCE GUARD, for the reason every guard in this file is one: this suite does not load the
 * engine, so it cannot build both objects and compare the bands they measured. Counting call
 * sites in the CODE (comments stripped, so a docblock that has to quote `barBottomY(w, h)` to
 * explain the rule does not trip its own guard) is what is left.
 */
test('barBottomY is called exactly once on the home screen', () => {
  const files = ['home-view.ts', 'top-bar.ts', 'home-scene.ts', 'hud-view.ts'];
  const calls = files.reduce(
    (n, f) => n + (stripComments(readSrc(f)).match(/\bbarBottomY\s*\(/g) ?? []).length,
    0,
  );
  expect(calls).toBe(1);
});

/**
 * The guard above can still see the defect it is written for.
 *
 * Without this, "one call" is indistinguishable from "the regex stopped matching anything at
 * all" -- the same discipline every self-test in this file applies.
 */
test('the barBottomY guard is not fooled by zero calls or by comments', () => {
  const zero = stripComments("export function f(w: number, h: number) { return w + h; }");
  expect((zero.match(/\bbarBottomY\s*\(/g) ?? []).length).toBe(0);
  const commentedOut = stripComments('// this.barBottom = barBottomY(w, h);');
  expect((commentedOut.match(/\bbarBottomY\s*\(/g) ?? []).length).toBe(0);
  const twice = stripComments('const a = barBottomY(w, h);\nconst b = barBottomY(w, h);');
  expect((twice.match(/\bbarBottomY\s*\(/g) ?? []).length).toBe(2);
});

/**
 * 领取 stops ANSWERING when it stops being claimable, not merely stops looking claimable.
 *
 * `inBox` measures a `worldPosition`, so a button repainted grey still occupies its box. This is
 * the trap the settings card's `setLobby` gate exists for, and it has shipped on this project
 * once already: hiding a control is not the same as disarming it. Without the `chkClaimable &&`
 * here, a second tap on a spent button would reach the controller, and only the controller's own
 * `canClaim` guard would stop it paying twice -- a rule load-bearing in exactly one place is a
 * rule waiting to be deleted as redundant.
 */
test('the check-in claim button is gated on being claimable, not just repainted', () => {
  expect(readSrc('hud-view.ts'))
    .toContain('if (this.chkClaimable && this.inBox(ui, this.chkClaim!');
});

/**
 * The card and the payout read the landing day from the SAME function.
 *
 * `claim` records it, `nextReward` prices it, and `paintCheckin` highlights it; all three go
 * through `nextDay`. The failure this prevents is silent and slow: a card that computed the cell
 * as `day + 1` would be right until the first broken streak and would then highlight a day the
 * payout does not pay. Inferring it from `nextReward` fails sooner and even more quietly -- days
 * 1 and 2 both pay 20.
 */
test('claim, nextReward and the card all read the landing day from nextDay', () => {
  const core = readCore('checkin.ts');
  for (const fn of ['claim', 'nextReward']) {
    const at = core.indexOf('export function ' + fn + '(');
    expect(at).toBeGreaterThan(0);
    // The function's own body, up to the next top-level export.
    const next = core.indexOf('\nexport ', at + 1);
    const body = next === -1 ? core.slice(at) : core.slice(at, next);
    expect(body).toContain('nextDay(c, today)');
  }
  expect(readSrc('hud-view.ts')).toContain('const landing = nextDay(c, today);');
});

/**
 * The check-in card reads `c.day` for the day already claimed, NOT `nextDay`.
 *
 * THIS IS THE BRANCH'S ONE PLAYER-VISIBLE DEFECT, guarded because nothing else can see it. The
 * card ticked day 1 and nothing else after every claim, whatever day the streak had reached --
 * `nextDay` continues a streak only when `last` is yesterday, and after a claim `last` is today,
 * so it fell through to "start again" and answered 1. Six days in seven the card contradicted
 * the payout; on the seventh it showed a day that had just paid 100 as still to come.
 *
 * `logic/tests/checkin.test.ts` pins the core half -- that `nextDay` really does answer 1 in
 * that state -- but the defect was in the VIEW, in the expression wrapped around the call, and
 * `hud-view.ts` imports `cc` so no test in this repo can execute it. Reverting the fix would
 * leave every other check-in assertion green.
 */
test('the check-in card reads c.day, not nextDay, for the day already claimed', () => {
  const src = stripComments(readSrc('hud-view.ts'));
  expect(src).toContain('const claimedThrough = live ? landing - 1 : c.day;');
  // And the trap itself must not come back under any spelling.
  expect(src).not.toContain('live ? landing - 1 : landing');
});

/**
 * Every circle in the project no longer shares one 32px frame.
 *
 * WHAT THIS GUARDS. `ui-shapes.ts` used to paint ONE `dotFrame` at `DOT_SIZE` (32) and hand
 * it, stretched, to every caller of `dotSprite` -- a 22-unit unread dot on the top bar, a
 * 52-unit coin, a 170-unit level badge, a 200-unit glow, all the same texture. A badge at 170
 * design units is roughly 275 device pixels on a 1170-wide phone: a soft antialiased 32px edge
 * blown up that far is the blur and halo a player photographed and reported. The fix caches a
 * frame per size BUCKET in `dotFrames`, the same shape `roundFrames` already uses per corner
 * radius, so `dotFrame` (singular, a nullable single frame) has no reason to exist any more.
 *
 * A SOURCE GUARD, for the reason every guard in this file is one: this suite does not load the
 * engine, so it cannot paint a texture and measure how soft its edge is. What it can pin is
 * that the single shared frame is gone and that the two constants bounding the bucket --
 * `DOT_SIZE` as the floor, `DOT_SIZE_MAX` as the ceiling -- are the literals the brief asked
 * for, with the ceiling actually enforced in the clamp rather than merely declared.
 */
test('ui-shapes has no single shared dotFrame, and dotBucket is clamped at both ends', () => {
  const src = stripComments(readSrc('ui-shapes.ts'));
  // `dotFrames` (the Map) is fine; a bare singleton `dotFrame` is the defect.
  expect(src).not.toMatch(/\bdotFrame\b/);
  expect(src).toContain('const dotFrames = new Map<number, SpriteFrame>();');
  expect(src).toMatch(/^const DOT_SIZE = 32;$/m);
  expect(src).toMatch(/^const DOT_SIZE_MAX = 256;$/m);
  expect(src).toContain('return Math.min(size, DOT_SIZE_MAX);');
});

/**
 * The guard above can still see the defect it is written for, and the bucket function it pins
 * actually behaves the way the brief specifies.
 *
 * RATHER THAN RE-IMPLEMENTING `dotBucket` here, which would drift from the real one and end up
 * testing a copy instead of the code, this extracts the function's own body out of the source
 * text and executes it -- so a future change to the clamping LOGIC, not just to the two
 * constants, can fail this test too. `DOT_SIZE` and `DOT_SIZE_MAX` are likewise read out of the
 * source rather than hard-coded, so a deliberate retune of either number does not make this
 * test lie about what the current file does.
 */
test('the guard catches a reverted dotFrame, and dotBucket really buckets 22..200', () => {
  expect(/\bdotFrame\b/.test('let dotFrame: SpriteFrame | null = null;')).toBe(true);
  // The Map that replaced it must not itself trip the same guard.
  expect(/\bdotFrame\b/.test('const dotFrames = new Map<number, SpriteFrame>();')).toBe(false);

  const src = readSrc('ui-shapes.ts');
  const numConst = (name: string): number => {
    const m = new RegExp(`const ${name}\\s*=\\s*(\\d+);`).exec(src);
    if (!m) throw new Error(`${name} not found in ui-shapes.ts -- renamed?`);
    return Number(m[1]);
  };
  const dotSize = numConst('DOT_SIZE');
  const dotSizeMax = numConst('DOT_SIZE_MAX');
  const fnMatch = /function dotBucket\(d: number\): number \{([\s\S]*?)\n\}/.exec(src);
  if (!fnMatch) throw new Error('dotBucket not found in ui-shapes.ts -- renamed or removed?');
  const rawBucket = new Function('d', 'DOT_SIZE', 'DOT_SIZE_MAX', fnMatch[1]) as
    (d: number, floor: number, ceil: number) => number;
  const bucket = (d: number): number => rawBucket(d, dotSize, dotSizeMax);

  // The five diameters this project actually draws a dot at: the top bar's unread dot, the
  // coin, the level badge's base/face, and its padded glow.
  expect(bucket(22)).toBe(32);
  expect(bucket(52)).toBe(64);
  expect(bucket(128)).toBe(128);
  expect(bucket(170)).toBe(256);
  expect(bucket(200)).toBe(256);

  // THE FLOOR: nothing smaller than DOT_SIZE is ever handed out.
  expect(bucket(1)).toBe(dotSize);
  expect(bucket(0)).toBe(dotSize);

  // THE CEILING: a diameter far past anything the lobby draws does not escape DOT_SIZE_MAX --
  // the guard against a future caller silently allocating a multi-megabyte texture.
  expect(bucket(10000)).toBe(dotSizeMax);
});

/**
 * The four badge layers' own creation lines, and whether they appear in the order the badge
 * needs: the dark edge outline, then the base, then the face, then the number and the padlock
 * (both children of the face). A plain function rather than inline `indexOf` calls in each of
 * the two tests below, so the real guard and its self-test check the identical thing -- written
 * out twice they drift, which is what happened to the halo guard this file already carries a
 * fix for (see `HALO_COLOUR`).
 */
function badgeLayerOrder(src: string): boolean {
  // `hi` is in the list because it is the outermost ring and has to be created FIRST.
  //
  // WHAT THIS DOES NOT CATCH, said plainly because an earlier comment here claimed it did:
  // the highlight defect that shipped was a wrong DIAMETER and a missing OFFSET, with the
  // creation order already correct. Order is not the property that was broken, so adding
  // `hi` here would not have caught it. The geometry is pinned separately, below.
  const hiAt = src.indexOf("const hi = dotSprite('hi'");
  const outlineAt = src.indexOf("const outline = dotSprite('outline'");
  const baseAt = src.indexOf("const base = dotSprite('base'");
  const faceAt = src.indexOf("const face = dotSprite('face'");
  const numAt = src.indexOf("const num = makeLabel(face, 'n'");
  const lockAt = src.indexOf('const lock = this.buildLock(face);');
  if ([hiAt, outlineAt, baseAt, faceAt, numAt, lockAt].some((at) => at < 0)) return false;
  return hiAt < outlineAt && outlineAt < baseAt && baseAt < faceAt
    && faceAt < numAt && faceAt < lockAt;
}

/**
 * The badge's blurred glow does not come back, and its four layers are still appended outline,
 * base, face, then number-and-padlock.
 *
 * WHAT THIS GUARDS. `CUR_GLOW` was a soft-alpha disc many times the badge's own size, painted
 * behind the current badge permanently; the requirement (「不要用模糊光晕」) replaced it with a thin
 * bright outline (`NODE_CUR_HI`) instead, so the old name must not reappear under any spelling.
 * Separately, the NEW dark-edge outline (`NODE_EDGE`) has to be added BEFORE the base or the base
 * paints over it, hiding the badge's edge exactly where the thickness is meant to show it (see
 * `NODE_EDGE`'s own docblock in `home-view.ts`, and `buildStop`'s draw-order comment). Either
 * regression -- the glow returning, or the edge sliding behind the base -- is worth catching on
 * its own, but they are checked together because both guard the same four-layer badge this task
 * built.
 *
 * A SOURCE GUARD, for the reason every guard in this file is one: this suite does not load the
 * engine, so it cannot render a badge and photograph whether its edge or its glow came back.
 */
test('CUR_GLOW stays gone, and the badge layers are added outline, base, face, then number/lock', () => {
  const src = readSrc('home-view.ts');
  expect(src).not.toMatch(/\bCUR_GLOW\b/);
  expect(badgeLayerOrder(src)).toBe(true);
});

/**
 * The guard above can still see the defects it is written for.
 *
 * Without this, "the layers are in order" is indistinguishable from "the check stopped running"
 * -- the same discipline every self-test in this file applies. `badgeLayerOrder` is exercised
 * directly, not reimplemented, so a change to its own logic (not just to the source it reads)
 * can fail this test too.
 */
test('the badge-layer guard is not fooled by a reordered, missing, or renamed layer', () => {
  const inOrder = `
    const hi = dotSprite('hi', NODE_HI_D, NODE_CUR_HI);
    const outline = dotSprite('outline', NODE_EDGE_D, NODE_CUR_EDGE);
    const base = dotSprite('base', NODE_D, NODE_CUR_BASE);
    const face = dotSprite('face', NODE_D, NODE_CUR);
    const num = makeLabel(face, 'n', 62, 0);
    const lock = this.buildLock(face);
  `;
  expect(badgeLayerOrder(inOrder)).toBe(true);

  // The base ahead of the outline: exactly the regression the guard exists to catch.
  const baseBeforeOutline = `
    const hi = dotSprite('hi', NODE_HI_D, NODE_CUR_HI);
    const base = dotSprite('base', NODE_D, NODE_CUR_BASE);
    const outline = dotSprite('outline', NODE_EDGE_D, NODE_CUR_EDGE);
    const face = dotSprite('face', NODE_D, NODE_CUR);
    const num = makeLabel(face, 'n', 62, 0);
    const lock = this.buildLock(face);
  `;
  expect(badgeLayerOrder(baseBeforeOutline)).toBe(false);

  // The highlight drawn AFTER the dark edge: the regression that actually shipped once. It is
  // the outermost ring, so behind everything means first -- created second it is covered by the
  // edge it is meant to sit outside of, and the badge loses its current-level mark entirely.
  const hiAfterOutline = `
    const outline = dotSprite('outline', NODE_EDGE_D, NODE_CUR_EDGE);
    const hi = dotSprite('hi', NODE_HI_D, NODE_CUR_HI);
    const base = dotSprite('base', NODE_D, NODE_CUR_BASE);
    const face = dotSprite('face', NODE_D, NODE_CUR);
    const num = makeLabel(face, 'n', 62, 0);
    const lock = this.buildLock(face);
  `;
  expect(badgeLayerOrder(hiAfterOutline)).toBe(false);

  // A layer missing entirely -- the outline deleted rather than reordered.
  const missingOutline = `
    const hi = dotSprite('hi', NODE_HI_D, NODE_CUR_HI);
    const base = dotSprite('base', NODE_D, NODE_CUR_BASE);
    const face = dotSprite('face', NODE_D, NODE_CUR);
    const num = makeLabel(face, 'n', 62, 0);
    const lock = this.buildLock(face);
  `;
  expect(badgeLayerOrder(missingOutline)).toBe(false);

  // And the deleted glow constant must still be visible to the OTHER half of the guard above,
  // under a plain re-declaration -- the exact shape a revert would take.
  expect(/\bCUR_GLOW\b/.test('const CUR_GLOW = new Color(74, 144, 226, 90);')).toBe(true);
});

/**
 * `shade`'s HSL round-trip is really HSL, not RGB scaling wearing an HSL docblock.
 *
 * `palette.ts` imports `cc` (for `Color`), which this suite does not load, so `shade` itself
 * cannot be called here -- the same limit every guard in this file works under. What CAN be
 * executed without an engine is the pure arithmetic underneath it: `rgbToHsl` and `hslToRgb` take
 * and return plain numbers. This extracts both function bodies out of the real source text (not
 * a reimplementation, which would drift from the file and end up testing a copy) and runs them
 * as `shade` itself does -- convert to HSL, then straight back with no lightness change -- across
 * a handful of colours actually declared in this file, including two saturated, non-grey ones
 * (`CONTROL_FACE`, `COIN_FACE`) where an RGB-scaling approximation would show up first as a hue
 * or saturation drift. A round trip landing back on the exact input RGB, for every case, is what
 * "a real HSL conversion" means here.
 *
 * WHAT THIS DOES NOT COVER. It does not call `shade` itself, so it cannot catch a mistake in the
 * clamp, the lightness-delta arithmetic, or the alpha carry-through in `shade`'s own body -- only
 * that the HSL conversion it is built on is genuinely invertible. Nor does it render anything, so
 * it cannot show a badge outline actually looks like "L-20%" on a device.
 */
test('rgbToHsl/hslToRgb round-trip exactly, for real colours from this file', () => {
  const src = readSrc('palette.ts');
  const hslBody = extractFn(src, 'function rgbToHsl(r: number, g: number, b: number)');
  const rgbBody = extractFn(src, 'function hslToRgb(h: number, s: number, l: number)');
  const hueBody = extractFn(src, 'function hue2rgb(p: number, q: number, t: number)');

  type Hue2rgb = (p: number, q: number, t: number) => number;
  const hue2rgb = new Function('p', 'q', 't', hueBody) as Hue2rgb;
  const rgbToHsl = new Function('r', 'g', 'b', hslBody) as
    (r: number, g: number, b: number) => [number, number, number];
  const hslToRgb = new Function('h', 's', 'l', 'hue2rgb', rgbBody) as
    (h: number, s: number, l: number, hue2rgb: Hue2rgb) => [number, number, number];

  const colours: Array<[number, number, number]> = [
    [147, 203, 128], // LAWN -- the new saturated green this task adds
    [113, 122, 142], // PAVING -- the new blue-grey this task adds
    [86, 93, 108],   // ROAD -- an existing, muted board colour
    [42, 138, 208],  // CONTROL_FACE -- saturated, the case RGB-scaling gets wrong first
    [255, 196, 46],  // COIN_FACE -- saturated and at the channel ceiling
    [0, 0, 0],       // grey edge case: min == max, hue is undefined and must not throw
  ];
  for (const [r, g, b] of colours) {
    const [h, s, l] = rgbToHsl(r, g, b);
    const [r2, g2, b2] = hslToRgb(h, s, l, hue2rgb);
    expect([r2, g2, b2]).toEqual([r, g, b]);
  }
});

/**
 * The docblock's rejected alternative, MEASURED with the shipped conversion.
 *
 * `shade`'s docblock argues that scaling R, G and B by one factor is not "L-20%", and it gives
 * figures. This runs those figures. It takes `CONTROL_FACE`, applies the naive `*0.8`, and asks
 * the REAL extracted `rgbToHsl` what lightness came out -- so the claim in the comment and the
 * behaviour of the code cannot drift apart.
 *
 * AN EARLIER VERSION OF THIS TEST WAS A TAUTOLOGY: it scaled a colour and asserted the result
 * differed from the input, which is true of any factor other than 1 and says nothing about HSL.
 * It is worth recording, because it looked exactly like the self-tests in this file that do
 * work -- a test that cannot fail is the failure mode this file is most prone to.
 */
test('the docblock\'s rejected RGB scaling really does miss the lightness it claims to hit', () => {
  const src = readSrc('palette.ts');
  const hslBody = extractFn(src, 'function rgbToHsl(r: number, g: number, b: number)');
  const rgbToHsl = new Function('r', 'g', 'b', hslBody) as
    (r: number, g: number, b: number) => [number, number, number];

  // CONTROL_FACE, the worked example in `shade`'s docblock.
  const [, , l0] = rgbToHsl(42, 138, 208);
  expect(l0 * 100).toBeCloseTo(49.02, 1);

  // The naive "L-20%": multiply every channel by 0.8.
  const scaled: [number, number, number] = [
    Math.round(42 * 0.8), Math.round(138 * 0.8), Math.round(208 * 0.8),
  ];
  expect(scaled).toEqual([34, 110, 166]);
  const [, sScaled, lScaled] = rgbToHsl(...scaled);

  // It lands at 39.22%, not the 29.02% "L-20" asks for -- 9.8 points moved, not 20. That is the
  // defect, and it is multiplicative: a lighter face would lose more, a darker one less.
  expect(lScaled * 100).toBeCloseTo(39.22, 1);
  expect(lScaled * 100).not.toBeCloseTo(l0 * 100 - 20, 1);

  // And the objection the docblock explicitly does NOT make: saturation survives the scale here,
  // because below l = 0.5 it is `d / (max + min)` and both halves scale together. Pinned so the
  // docblock is not "corrected" back to blaming saturation.
  const [, s0] = rgbToHsl(42, 138, 208);
  expect(sScaled * 100).toBeCloseTo(s0 * 100, 0);
});

/**
 * The current badge's highlight is measured off the EDGE and shares its offset.
 *
 * THE TWO FACTS THAT ACTUALLY BROKE, and neither is an ordering. The highlight shipped as
 * `NODE_D + NODE_HI_PAD * 2` — measured off the FACE — behind a dark edge measured off the
 * BASE, and drawn at the node's own centre while that edge sat `NODE_LIFT` lower. It was not
 * hidden and it was not a ring: it drew a bright crescent across the top half and nothing below.
 *
 * The layer-order guard above could not have caught either one; the order was right the whole
 * time. These two lines are the ones that were wrong, so these two lines are what is pinned.
 */
test('the badge highlight is sized off the edge and shares its offset', () => {
  const src = stripComments(readSrc('home-view.ts'));
  // Off the EDGE, not the face. `NODE_D + ...` here is the exact regression.
  expect(src).toMatch(/^const NODE_HI_D = NODE_EDGE_D \+ NODE_HI_PAD \* 2;$/m);
  expect(src).not.toMatch(/^const NODE_HI_D = NODE_D \+/m);
  // Concentric with the edge: both carry the base's lift, or the ring comes out lopsided.
  expect(src).toContain('hi.setPosition(0, -NODE_LIFT, 0);');
  expect(src).toContain('outline.setPosition(0, -NODE_LIFT, 0);');
});
