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

/**
 * The canvas, in DESIGN UNITS. Read it; do not assume it.
 *
 * IT IS 1280 WIDE, not 720, and getting that wrong is expensive. The project ships
 * `designResolution 1280x720, policy 4` -- FIXED_WIDTH -- so the width is pinned at 1280 on
 * every device and the HEIGHT is whatever the aspect ratio makes it: about 2770 on a 19.5:9
 * phone, 1707 on a 4:3 tablet. The 1280x720 pair reads as a landscape resolution and the game
 * is portrait, which is exactly the trap: the numbers are the design box, and FIXED_WIDTH
 * keeps the first of them and throws the second away.
 *
 * The fallback below used to say 720x1280 -- the same two numbers the other way round, which
 * is wrong in BOTH of them. It never fired (the Canvas always has a UITransform), but it was
 * the only statement in this file about how big the screen is, and three rounds of dialog
 * geometry were built on top of it before a screenshot showed the panels coming out at half
 * the width they were designed for.
 *
 * So: x measurements are portable as absolute design units, because 1280 is a constant. Y
 * measurements are NOT -- anything anchored to an edge has to be derived from `h`.
 */
export function canvasSize(canvas: Node): { w: number; h: number } {
    const ct = canvas.getComponent(UITransform);
    return ct ? { w: ct.width, h: ct.height } : { w: 1280, h: 2770 };
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
    // BLANK, EXPLICITLY. A fresh Label's `string` is the engine's placeholder -- the literal
    // word "label" -- so a caller that forgets to set one puts that word on screen, which is
    // exactly what shipped on both switches in the settings panel. Blank is not a good
    // outcome either, but a missing line is a hole in a layout, and a hole gets found and
    // fixed; "label" in a shipped build gets photographed.
    label.string = '';
    parent.addChild(n);
    n.setPosition(x, y, 0);
    return label;
}

/**
 * White type with a coloured rim around it, which is most of what makes a label read as part
 * of a toy UI rather than as text laid over one.
 *
 * `width` is in the font's own pixels, so it wants to scale with the type: about a tenth of
 * the font size holds the rim visible without closing up the counters of a Chinese glyph,
 * which have far less room in them than a Latin letter's.
 */
export function rimLabel(label: Label, rim: Color, width: number): Label {
    label.isBold = true;
    label.enableOutline = true;
    label.outlineColor = rim;
    label.outlineWidth = width;
    return label;
}
