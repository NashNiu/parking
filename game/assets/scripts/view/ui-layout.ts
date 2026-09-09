import { Color, Label, Layers, Node, UITransform } from 'cc';

/**
 * What every UI screen needs and no single screen should own: how big the canvas is, which
 * of its edges the phone has taken, and how to put a line of text somewhere.
 *
 * Split out of `hud-view` when a second screen appeared. The alternative was for `home-view`
 * to import them from `hud-view`, which points the new screen at the in-game HUD for no
 * reason, or to keep its own copies, which is how two layouts drift apart -- one of them
 * would have got the safe-area clamp and the other would not.
 *
 * Deliberately NOT in `ui-shapes`: that file paints textures, and its docblock says so.
 * Nothing here draws anything.
 */

declare const wx: any;

/**
 * The screen's unusable top and bottom edges, as FRACTIONS of its height: the notch or
 * Dynamic Island above, the home indicator below.
 *
 * Fractions, not pixels, because that is the only form in which the number is portable.
 * `safeArea` and `screenHeight` come back from wx in logical px, the canvas measures itself
 * in design units, and the ratio between those two is a project setting this file does not
 * read -- but their QUOTIENT is the same in either. `HudView.topReserve` hands the same
 * fractions to the camera for the same reason.
 *
 * Zero off-device (browser, editor preview), which is exactly right: there is no notch
 * there, and the layout should not pretend otherwise.
 *
 * Read once and cached. Nothing here changes while the game runs, and getSystemInfoSync is
 * one of the slower wx calls.
 */
let insets: { top: number; bottom: number } | null = null;

export function safeInsets(): { top: number; bottom: number } {
    if (insets) return insets;
    insets = { top: 0, bottom: 0 };
    try {
        const info = typeof wx !== 'undefined' && wx.getSystemInfoSync
            ? wx.getSystemInfoSync() : null;
        const h = info && info.screenHeight;
        const area = info && info.safeArea;
        if (h > 0 && area) {
            insets = {
                top: Math.max(0, Math.min(0.3, area.top / h)),
                bottom: Math.max(0, Math.min(0.3, (h - area.bottom) / h)),
            };
        }
    } catch { /* leave it at zero -- a missing inset is a cosmetic loss, not a crash */ }
    return insets;
}

export function canvasSize(canvas: Node): { w: number; h: number } {
    const ct = canvas.getComponent(UITransform);
    return ct ? { w: ct.width, h: ct.height } : { w: 720, h: 1280 };
}

export function makeLabel(
    parent: Node, name: string, fontSize: number, y: number, x = 0,
): Label {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform);
    const label = n.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.2);
    label.color = Color.WHITE.clone();
    parent.addChild(n);
    n.setPosition(x, y, 0);
    return label;
}
