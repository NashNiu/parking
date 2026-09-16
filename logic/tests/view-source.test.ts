import * as fs from 'fs';
import * as path from 'path';

const VIEW = path.join(__dirname, '../../game/assets/scripts/view');
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
  expect(indexedChildLookups(fs.readFileSync(path.join(VIEW, file), 'utf8'))).toEqual([]);
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
  const src = fs.readFileSync(path.join(VIEW, 'ui-layout.ts'), 'utf8');
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
 * WHAT IS LEFT IS THE FIRST HAZARD, and it is why this test still exists. `HomeScene` culls its
 * road legs at 0.75 of the screen height, well above the bar, so the surface behind this label
 * is pale pavement sometimes and dark asphalt at others -- exactly the "two backgrounds, one
 * ink" problem the photograph had, arrived at from the other direction. No single ink survives
 * both; a rim does. So the assertion moved to the rim and to the rim being OPAQUE, which is the
 * property that actually does the work.
 */
test('the lobby caption is rimmed, and the rim is opaque', () => {
  const src = fs.readFileSync(path.join(VIEW, 'top-bar.ts'), 'utf8');
  expect(src).toContain('rimLabel(this.caption, CAPTION_RIM,');
  expect(src).toMatch(/const CAPTION_RIM = new Color\(\d+, \d+, \d+, (2[0-4]\d|25[0-5])\)/);
  // And the plate it replaced has not quietly come back on the home screen.
  const home = fs.readFileSync(path.join(VIEW, 'home-view.ts'), 'utf8');
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
 * screen already resolved instead of calling `barBottomY` a fourth time. `capsuleInset()` does
 * not cache an unanswered read (deliberately -- caching one pins every top-anchored control
 * under the system capsule for the life of the process), so `barBottomY` may legitimately
 * return different numbers at different moments, and every extra caller is another chance for
 * the rail and the bar to be built against two different bands. Passing it down makes them
 * agree BY CONSTRUCTION rather than by an argument about how fast two statements run, and
 * pinning the argument list here is what stops the call being helpfully "simplified" back.
 */
test('the home screen builds street, then rail, then cap and ramp, then bar', () => {
  const src = fs.readFileSync(path.join(VIEW, 'home-view.ts'), 'utf8');
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
  const src = fs.readFileSync(path.join(VIEW, 'home-view.ts'), 'utf8');
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
  const src = fs.readFileSync(path.join(VIEW, 'home-view.ts'), 'utf8');
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
  const src = fs.readFileSync(path.join(VIEW, 'props.ts'), 'utf8');
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
  const props = fs.readFileSync(path.join(VIEW, 'props.ts'), 'utf8');
  const bay = fs.readFileSync(path.join(VIEW, 'parking-view.ts'), 'utf8');
  const types = fs.readFileSync(path.join(VIEW, '../core/types.ts'), 'utf8');

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
