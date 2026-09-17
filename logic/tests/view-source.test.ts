import * as fs from 'fs';
import * as path from 'path';

const VIEW = path.join(__dirname, '../../game/assets/scripts/view');

/**
 * Read a source file with its line endings NORMALISED to `\n`.
 *
 * EVERY READ IN THIS FILE GOES THROUGH HERE, and that is a bug fix rather than tidiness. The
 * repo stores these files with CRLF, and `core.autocrlf` is on, so a working tree on Windows
 * has CRLF too. A guard that matches within one line never notices; one that spans a line
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
 * The lobby's one fixed label is held up by a RIM, because its plate is gone.
 *
 * WHAT IT USED TO GUARD, kept because the hazard survived the fix and only the answer changed.
 * This screen was a photograph, which puts arbitrary colour behind arbitrary text -- the title
 * landed on bright sky on one phone and on a white cloud on the next. The answer then was an
 * outline on every fixed label; when the street became code the colour behind a point became
 * knowable, and an OPAQUE PLATE took the outlines' place, guarding against the second hazard: a
 * scrolling stop passing through fixed type on a route that fills the screen.
 *
 * THE PLATE IS NOW GONE TOO, and it went because it was the bug. It was 320x88 with a 205-wide
 * badge scrolling behind it whose full extent, star row included, is about 285 tall -- so the
 * badge stuck out above and below the plate and the pair read as clipping. 「共 N 关」 lives in
 * the standing top bar now, above the rail entirely, which settles the scrolling-stop hazard by
 * moving the label out of the rail's way rather than by covering the rail.
 *
 * THE SECOND HAZARD IS GONE TOO, and this docblock used to claim otherwise. It said the road
 * still runs behind this label -- `HomeScene` culls its legs at 0.75 of the screen height, well
 * above the bar -- so the surface behind the glyphs was pale pavement at one scroll position and
 * dark asphalt at another. That stopped being true when the rail's top edge became an OPAQUE
 * `GROUND` cap over the bar's whole band with the bar drawn on top of it: the background behind
 * this label is `GROUND` (189,200,218), always.
 *
 * WHAT IS LEFT IS PLAIN CONTRAST, and it is why this test still exists. White on 189,200,218 is
 * about 1.7:1 -- a knowable background is not a legible one, and a pale line on pale pavement is
 * what the caption would be without help. A near-opaque navy rim puts a dark edge around every
 * stroke and the row reads off that (about 12:1) rather than off the white. So the assertion is
 * the rim, and the rim being OPAQUE, which is the property that actually does the work -- a rim
 * faded to a low alpha is a rim that has stopped doing it while still being present.
 */
test('the lobby caption is rimmed, and the rim is opaque', () => {
  const src = readSrc('top-bar.ts');
  expect(src).toContain('rimLabel(this.caption, CAPTION_RIM,');
  expect(src).toMatch(/const CAPTION_RIM = new Color\(\d+, \d+, \d+, (2[0-4]\d|25[0-5])\)/);
  // And the plate it replaced has not quietly come back on the home screen.
  const home = readSrc('home-view.ts');
  expect(home).not.toContain("roundedSprite('HomePlate'");
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
  const street = src.indexOf('this.scene = new HomeScene(this.root, w, h);');
  const rail = src.indexOf("this.railRoot = new Node('RailStops');");
  const cap = src.indexOf("const cap = roundedSprite('RailCap', w * 2, h - this.barBottom, GROUND, 2);");
  const fade = src.indexOf("const fade = rampSprite('RailFade', w * 2, RAIL_FADE_H, GROUND);");
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
 * The lobby's street lost its decoration: no tree, no lamp, no kerb.
 *
 * WHAT THIS GUARDS. `home-scene.ts` used to paint a kerb under the road and scatter trees and
 * street lamps along the verge; all three were deleted because the kerb read as a soft blurred
 * ring rather than a lip (which a player photographed and reported as the whole street being
 * out of focus) and the trees and lamps read as colour dots rather than as scenery. A source
 * guard rather than a behavioural test, because this file imports `cc` and this suite does not
 * load the engine -- the same limit every guard in this file works under. It cannot prove the
 * screen looks uncluttered; it can prove the identifiers that drew the clutter never came back.
 */
test('home-scene has no tree, lamp or kerb identifiers', () => {
  const src = readSrc('home-scene.ts');
  expect(src).not.toMatch(/\bTREE_/);
  expect(src).not.toMatch(/\bLAMP_/);
  expect(src).not.toMatch(/\bKERB_/);
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
 * save still allowed a different, playable level. The button now reads
 * `unlockedThrough(progress)` alone, via `setCurrent`, and the locked wording lives only in the
 * toast (`showLockedToast`), nowhere near `startLabel`.
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
  // Comments stripped -- `rail-math.ts`'s header docblock is required to say IN PROSE that
  // `railStopT` used to live here and does not any more, so the code is what this checks,
  // not the prose that explains its absence.
  const strip = (src: string) => src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
  const home = strip(readSrc('home-view.ts'));
  const railMath = strip(readSrc('rail-math.ts'));
  expect(home).not.toMatch(/\bSTOP_RING\b/);
  expect(railMath).not.toMatch(/\brailStopT\b/);
});

/**
 * The guard above can still see the defects it is written for.
 *
 * Without this, "absent" is indistinguishable from "the pattern stopped matching" -- the same
 * discipline every self-test in this file applies. Both patterns are checked against the exact
 * declarations this file used to carry, before either was deleted.
 */
test('the halo guard is not fooled into passing on an empty pattern', () => {
  expect(/\bSTOP_RING\b/.test('const STOP_RING = new Color(86, 199, 104, 90);')).toBe(true);
  expect(/\brailStopT\b/.test('export function railStopT(offset: number, i: number): number {'))
    .toBe(true);
});
