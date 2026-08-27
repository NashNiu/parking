declare const wx: any;

/**
 * Whether haptics should be asked for at all: yes on a real device, NO in the WeChat
 * devtools simulator.
 *
 * The observed symptom: in the devtools simulator, every vibration leaves the simulator
 * panel a little smaller, so a run of refused taps (each of which vibrates) shrinks the
 * preview to a postage stamp. Attributing that to `vibrateShort` is an INFERENCE -- the
 * devtools panel is not ours to read -- but it is the only call in the jolt path that talks
 * to the device, and the game itself is ruled out: every scale tween in the view animates to
 * an ABSOLUTE target (Vec3.ONE, a fitted stall scale, or `squash`'s remembered rest pose),
 * so there is no ratchet left on our side to find.
 *
 * Skipping it in the simulator costs nothing either way. There is no motor there.
 *
 * Resolved once and cached: this is called from every jolt, and the device-info calls are
 * among the slower wx ones.
 */
let enabled: boolean | null = null;

function haptable(): boolean {
    if (enabled !== null) return enabled;
    if (typeof wx === 'undefined' || !wx.vibrateShort) {
        enabled = false;
        return enabled;
    }
    // `platform` is 'devtools' in the simulator and the real OS name on a phone. Read it
    // through whichever accessor this client has: getDeviceInfo is the current one,
    // getSystemInfoSync the deprecated one every version still answers. If neither is
    // there, or the call throws, assume a real device -- vibrateShort exists, and a phone
    // silently missing a buzz is a smaller loss than a simulator quirk costing real haptics.
    try {
        const info = wx.getDeviceInfo ? wx.getDeviceInfo()
            : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null);
        enabled = !info || info.platform !== 'devtools';
    } catch {
        enabled = true;
    }
    return enabled;
}

/** Short vibration on a real device; silently no-op elsewhere (simulator/browser/editor). */
export function vibrate(kind: 'light' | 'medium' | 'heavy' = 'light'): void {
    if (!haptable()) return;
    try {
        wx.vibrateShort({ type: kind });
    } catch { /* ignore */ }
}
