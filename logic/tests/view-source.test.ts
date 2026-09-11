import * as fs from 'fs';
import * as path from 'path';

const VIEW = path.join(__dirname, '../../game/assets/scripts/view');
/**
 * Every view file that builds a panel by appending children, which is all of them that hold
 * one. A file added here needs no other change: the first test walks the list.
 */
const FILES = ['hud-view.ts', 'home-view.ts'];

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
 * The backdrop photograph must COVER the screen, and the difference is one word.
 *
 * `Math.max(w / raw.width, h / raw.height)` fills the screen and crops whatever the aspect
 * ratio does not want; `Math.min` fits the picture INSIDE the screen and leaves the flat
 * background showing along two edges. Both compile, both draw a picture, and only one of them
 * is a background -- and the wrong one looks deliberate enough that it can survive a glance
 * at a device. Which is the entire reason this is asserted in text: the value is decided
 * inside a `resources.load` callback against a frame that only exists at runtime, so no test
 * in this suite can reach it.
 *
 * The limits are the usual ones for a source guard: it proves the expression is written, not
 * that it is reached, and a rewrite that keeps the behaviour under a different shape has to
 * come and change this line.
 */
test('the home backdrop covers the screen rather than fitting inside it', () => {
  const src = fs.readFileSync(path.join(VIEW, 'home-view.ts'), 'utf8');
  expect(src).toMatch(/Math\.max\(w \/ tex\.width, h \/ tex\.height\)/);
  expect(src).not.toMatch(/Math\.min\(w \/ tex\.width, h \/ tex\.height\)/);
  // And it is pinned to the top, so the crop comes off the bottom -- the road, not the sky.
  expect(src).toContain('photo.setPosition(0, h / 2 - tex.height * scale / 2, 0);');
});

/**
 * THE ONE THAT ACTUALLY SHIPPED BROKEN. `resources.load('home-bg/spriteFrame', ...)` is the
 * obvious line to write and it fails at runtime with nothing to explain it: this project
 * imports images as `type: "texture"`, so the built bundle registers exactly `home-bg` and
 * `home-bg/texture` and no sprite frame exists to load. Loading the texture and wrapping it
 * works under either import type, because a sprite-frame import registers `/texture` too.
 *
 * A source guard because the path is a string resolved inside the engine's asset manager
 * against a bundle this suite does not build -- there is no way to fail it from here.
 */
test('the home backdrop loads the texture, not a sprite frame', () => {
  const src = fs.readFileSync(path.join(VIEW, 'home-view.ts'), 'utf8');
  expect(src).toContain("const HOME_BG = 'home-bg/texture';");
  expect(src).not.toContain("'home-bg/spriteFrame'");
});

/**
 * 1440x3360 is not a power of two, and the engine's note on `setWrapMode` says only
 * CLAMP_TO_EDGE is allowed for such a texture. The importer's default is REPEAT, under which
 * a WebGL1 device samples the whole thing as black -- a symptom that looks like "the image
 * did not load" and is not.
 */
test('the backdrop texture is clamped, which a non-power-of-two texture requires', () => {
  const src = fs.readFileSync(path.join(VIEW, 'home-view.ts'), 'utf8');
  expect(src).toContain('Texture2D.WrapMode.CLAMP_TO_EDGE');
});

/**
 * The two lines of type that sit DIRECTLY on the backdrop need an outline, because a
 * photograph puts arbitrary colour behind them and no ink survives both a bright sky and a
 * white cloud. See HOME_RIM in home-view.ts.
 *
 * It names them rather than counting them, which is the lesson of the version before this
 * one: that asserted "at least three rimLabel calls", and three was right only while the
 * title existed. A count breaks when the screen changes for an unrelated reason and says
 * nothing about what is actually wrong. Everything else on this screen -- the stop numbers,
 * the button's label -- sits on an opaque face and needs no rim.
 */
test('nothing on the home screen is bare type over the backdrop', () => {
  const src = fs.readFileSync(path.join(VIEW, 'home-view.ts'), 'utf8');
  // The only fixed label left is the plate's, and it reads because the plate under it is
  // opaque -- which is also what stops a scrolling stop from passing through it.
  expect(src).toContain("this.sub = makeLabel(this.topPlate, 'HomeSub', SUB_SIZE, 0);");
  expect(src).toMatch(/const PLATE = new Color\(\d+, \d+, \d+, (2[0-4]\d|25[0-5])\)/);
});

/**
 * The plate is built AFTER the road and the rail, and that order is the whole point of it:
 * a plate drawn before the stops is a plate the stops slide over, which is the bare-type
 * problem it was introduced to solve, with an extra draw call.
 */
test('the top plate is built after the rail, so stops pass behind it', () => {
  const src = fs.readFileSync(path.join(VIEW, 'home-view.ts'), 'utf8');
  const rail = src.indexOf('this.railRoot = this.buildRoad();');
  const plate = src.indexOf("this.topPlate = roundedSprite('HomePlate'");
  expect(rail).toBeGreaterThan(0);
  expect(plate).toBeGreaterThan(rail);
});
