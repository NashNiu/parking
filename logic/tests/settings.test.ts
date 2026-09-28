import {
  defaultSettings, parseSettings, serializeSettings,
} from '../../game/assets/scripts/core/settings';

/**
 * The same failure policy `progress` has, for the same reason: this is read off the device on
 * the boot path, so anything unexpected has to come back as the defaults rather than as an
 * exception. Losing a preference costs a tap to set again; throwing costs the game.
 *
 * A SEPARATE key from the progress save, and that is not tidiness -- wiping progress must not
 * silently turn the sound back on. Different lifetimes, different files.
 */
test.each([
  ['a missing key (null)', null],
  ['a missing key on WeChat (empty string)', ''],
  ['not JSON', '{oops'],
  ['JSON that is not an object', '7'],
  ['an array', '[true,false]'],
  ['a future version', '{"version":2,"sfx":false,"haptics":false}'],
  ['no version', '{"sfx":false}'],
])('%s parses as the defaults', (_what, raw) => {
  expect(parseSettings(raw as string | null)).toEqual(defaultSettings());
});

test('all three are on by default -- a game that starts silent reads as broken', () => {
  expect(defaultSettings().sfx).toBe(true);
  expect(defaultSettings().music).toBe(true);
  expect(defaultSettings().haptics).toBe(true);
});

/**
 * THE VERSION DID NOT MOVE WHEN `music` ARRIVED, and that is the whole point of this test.
 *
 * `parseSettings` throws away any file whose version it does not recognise, so bumping to 2
 * for a new field would have reset every player's saved preferences -- including the sound
 * they had switched OFF, which is the one they would notice. A field ADDED to a version is
 * backwards compatible by construction here: an old file simply has nothing to say about it
 * and gets the default, which is the same answer a brand new player gets.
 *
 * The version is for a change that makes an old file MEAN something different. Adding a
 * switch is not one.
 */
test('a version-1 file written before music existed keeps its other answers', () => {
  expect(parseSettings('{"version":1,"sfx":false,"haptics":false}')).toEqual({
    version: 1, sfx: false, music: true, haptics: false,
  });
});

test('a valid file round-trips', () => {
  const s = { ...defaultSettings(), sfx: false };
  expect(parseSettings(serializeSettings(s))).toEqual(s);
});

/**
 * One unreadable field does not condemn the other. A file with the sound switched off and a
 * corrupt haptics flag should keep the sound off -- rejecting the whole file would silently
 * turn it back on, which is the one outcome the player would notice and not understand.
 */
test('a bad field falls back on its own, and the rest of the file survives', () => {
  const s = parseSettings('{"version":1,"sfx":false,"music":0,"haptics":"yes"}');
  expect(s.sfx).toBe(false);
  expect(s.music).toBe(true);
  expect(s.haptics).toBe(true);
});

test('a missing field falls back to its default', () => {
  expect(parseSettings('{"version":1,"sfx":false}')).toEqual({
    version: 1, sfx: false, music: true, haptics: true,
  });
});

/**
 * The music switch is the one a player is most likely to reach for, and the least likely to
 * want asked twice -- background music off is a settled preference, not a per-session mood.
 * So it has to survive a round trip on its own, with the sound left ON around it.
 */
test('music off with sound on round-trips', () => {
  const s = { ...defaultSettings(), music: false };
  expect(parseSettings(serializeSettings(s))).toEqual(s);
  expect(parseSettings(serializeSettings(s)).sfx).toBe(true);
});
