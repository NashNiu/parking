import { sys } from 'cc';

/**
 * The device side of saving: three calls and a try/catch each. No parsing, no defaults, no
 * policy -- all of that is `core/progress`, where it is a pure function of a string and can
 * be tested. Nothing in here is testable, and that is the point of it being this thin.
 *
 * `sys.localStorage` covers every platform this game runs on with one interface. In the
 * editor and the browser it IS `window.localStorage`; in the WeChat mini-game the engine's
 * adapter implements the same shape over wx storage -- this project's own build carries it:
 *
 *   { getItem: e => wx.getStorageSync(e),
 *     setItem: (e, t) => wx.setStorageSync(e, t),
 *     removeItem: e => wx.removeStorageSync(e), ... }
 *                                    -- game/build/wechatgame/web-adapter.js
 *
 * Two properties of that shape matter upstream: the calls are SYNCHRONOUS, so nothing may
 * write per frame (the only write is one per level cleared), and a missing key reads back as
 * `''` on wx where a browser gives `null`. `parseProgress` treats both as no save.
 *
 * Every call is wrapped because every call can throw: storage full, storage disabled, a
 * privacy mode that stubs it out. A player who cannot save should still be able to play, so a
 * failure here is logged and otherwise ignored.
 */

/**
 * The key. Fixed for the life of the game -- the version travels inside the payload (see
 * `PROGRESS_VERSION`), so a later build can still open what this one wrote.
 */
const KEY = 'parking.progress';

export function loadProgressText(): string | null {
    try {
        return sys.localStorage.getItem(KEY);
    } catch (e) {
        console.warn('[Game] progress could not be read:', e);
        return null;
    }
}

export function saveProgressText(text: string): void {
    try {
        sys.localStorage.setItem(KEY, text);
    } catch (e) {
        console.warn('[Game] progress could not be saved:', e);
    }
}

/**
 * The settings live under their OWN key, so `clearProgressText` cannot take them with it: a
 * player who wipes their progress has not asked for the sound back on.
 */
const SETTINGS_KEY = 'parking.settings';

export function loadSettingsText(): string | null {
    try {
        return sys.localStorage.getItem(SETTINGS_KEY);
    } catch (e) {
        console.warn('[Game] settings could not be read:', e);
        return null;
    }
}

export function saveSettingsText(text: string): void {
    try {
        sys.localStorage.setItem(SETTINGS_KEY, text);
    } catch (e) {
        console.warn('[Game] settings could not be saved:', e);
    }
}

export function clearProgressText(): void {
    try {
        sys.localStorage.removeItem(KEY);
    } catch (e) {
        console.warn('[Game] progress could not be cleared:', e);
    }
}
