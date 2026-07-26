declare const wx: any;

/** Short vibration on WeChat; silently no-op elsewhere (browser/editor preview). */
export function vibrate(kind: 'light' | 'medium' | 'heavy' = 'light'): void {
    try {
        if (typeof wx !== 'undefined' && wx.vibrateShort) {
            wx.vibrateShort({ type: kind });
        }
    } catch { /* ignore */ }
}
