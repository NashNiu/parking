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
