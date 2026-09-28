/**
 * The player's preferences: whether sound and vibration are on.
 *
 * A SEPARATE save from `progress`, under its own key, and that is not tidiness -- wiping
 * progress (a three-second hold on the home title) must not silently turn the sound back on.
 * Two different lifetimes, two different files.
 *
 * Same failure policy as `progress`, for the same reason: this is read off the device on the
 * boot path, so anything unexpected comes back as the defaults and nothing throws. Losing a
 * preference costs one tap to set again; throwing on the boot path costs the game. One
 * unreadable field falls back on its own, too -- rejecting the whole file because the
 * haptics flag is junk would turn the SOUND back on, which is the outcome a player would
 * notice and not understand.
 *
 * `music` IS A SWITCH OF ITS OWN AND NOT A SECOND USE OF `sfx`, because the two are wanted
 * apart far more often than together: a player on a bus wants the track off and the taps
 * still there, and a player who has muted the phone wants neither. One switch for both would
 * make the common case impossible to ask for.
 *
 * THE VERSION DID NOT MOVE WHEN `music` WAS ADDED. `parseSettings` discards any file whose
 * version it does not recognise, so a bump would have reset every saved preference in the
 * field -- including a sound the player had deliberately switched OFF, which is the one they
 * would notice. An added field needs no bump: an old file says nothing about it and gets the
 * default, the same answer a new player gets. The version is for a change that makes an old
 * file MEAN something different, and adding a switch is not one.
 */

export interface Settings {
    version: number;
    sfx: boolean;
    music: boolean;
    haptics: boolean;
}

export const SETTINGS_VERSION = 1;

export function defaultSettings(): Settings {
    // All three ON. A game that starts silent reads as broken, and the player who wants quiet
    // is the one who will go looking for the switch.
    return { version: SETTINGS_VERSION, sfx: true, music: true, haptics: true };
}

export function parseSettings(raw: string | null): Settings {
    const out = defaultSettings();
    if (!raw || !raw.trim()) return out;
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return out;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return out;
    const obj = data as {
        version?: unknown; sfx?: unknown; music?: unknown; haptics?: unknown;
    };
    if (obj.version !== SETTINGS_VERSION) return out;
    if (typeof obj.sfx === 'boolean') out.sfx = obj.sfx;
    if (typeof obj.music === 'boolean') out.music = obj.music;
    if (typeof obj.haptics === 'boolean') out.haptics = obj.haptics;
    return out;
}

export function serializeSettings(s: Settings): string {
    return JSON.stringify(s);
}
