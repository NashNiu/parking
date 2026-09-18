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

/**
 * The wallet's own key, beside the progress rather than inside it -- `core/wallet` says why
 * the balance is a save of its own. Its LIFETIME is the interesting part, and it is written
 * out on `clearWalletText`.
 */
const WALLET_KEY = 'parking.wallet';

export function loadWalletText(): string | null {
    try {
        return sys.localStorage.getItem(WALLET_KEY);
    } catch (e) {
        console.warn('[Game] wallet could not be read:', e);
        return null;
    }
}

export function saveWalletText(text: string): void {
    try {
        sys.localStorage.setItem(WALLET_KEY, text);
    } catch (e) {
        console.warn('[Game] wallet could not be saved:', e);
    }
}

/**
 * Wiping the progress wipes the wallet with it, and this is THE REVERSE of the rule stated on
 * SETTINGS_KEY above -- deliberately, and the two are worth reading together.
 *
 * The settings survive a wipe because their lifetime has nothing to do with the save's: a
 * player who clears their progress has not asked for the sound back on. Coins are the opposite
 * case, because they are DERIVED from the progress rather than independent of it -- clearing a
 * level is the only way one is ever earned. Keep them across a wipe and "clear -> wipe -> clear
 * again" is an unlimited mint, and the wipe is now two taps away on the settings card rather
 * than a three-second hold nobody ever found.
 *
 * So the test is not "is this a different key" -- both of these are -- but "does this outlive
 * the thing that produced it". Settings do; coins cannot.
 */
export function clearWalletText(): void {
    try {
        sys.localStorage.removeItem(WALLET_KEY);
    } catch (e) {
        console.warn('[Game] wallet could not be cleared:', e);
    }
}

/**
 * The check-in streak's key, and its lifetime is the WALLET's, not the settings'.
 *
 * `clearWalletText` above draws the line: a save outlives a wipe when its lifetime has nothing
 * to do with the player's progress, and does not when it is produced BY playing. Settings pass
 * that test -- clearing a save is not a request to turn the sound back on. A streak fails it
 * the same way coins do: it is a record of turning up to play, it pays out in coins, and coins
 * are wiped. Keeping a seven-day streak across a wipe would also hand a fresh save the 100-coin
 * day, which is the one figure in the table that is meant to take a week to reach.
 */
const CHECKIN_KEY = 'parking.checkin';

export function loadCheckinText(): string | null {
    try {
        return sys.localStorage.getItem(CHECKIN_KEY);
    } catch (e) {
        console.warn('[Game] check-in could not be read:', e);
        return null;
    }
}

export function saveCheckinText(text: string): void {
    try {
        sys.localStorage.setItem(CHECKIN_KEY, text);
    } catch (e) {
        console.warn('[Game] check-in could not be saved:', e);
    }
}

export function clearCheckinText(): void {
    try {
        sys.localStorage.removeItem(CHECKIN_KEY);
    } catch (e) {
        console.warn('[Game] check-in could not be cleared:', e);
    }
}
