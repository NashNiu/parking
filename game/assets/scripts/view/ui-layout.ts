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
 * How far down the screen the wx capsule -- the 胶囊按钮, the share/close pill every mini
 * program wears -- reaches, as a FRACTION of the screen's height.
 *
 * A SECOND RESERVATION, not a duplicate of `safeInsets().top`. The notch is a hole in the
 * screen; the capsule is a control the platform draws ON the screen, and on a phone with no
 * notch at all (or a very shallow one) the capsule still hangs several times lower than the
 * safe area's top edge. Anything anchored to the top has to clear the LARGER of the two, which
 * is why callers take `Math.max(safeInsets().top, capsuleInset())` rather than picking one.
 *
 * `bottom`, not `top`, because what a layout needs is the first y that is clear of it -- the
 * capsule's own top edge tells you nothing about where it stops.
 *
 * Same shape and same failure policy as `safeInsets` above, deliberately: read once, cached,
 * clamped into a sane band, and ZERO off-device. There is no capsule in a browser or in the
 * editor preview, and a layout that reserved room for one there would be wrong on the only
 * screen a developer actually looks at.
 */
let capsule: number | null = null;

export function capsuleInset(): number {
    if (capsule !== null) return capsule;
    capsule = 0;
    try {
        const rect = typeof wx !== 'undefined' && wx.getMenuButtonBoundingClientRect
            ? wx.getMenuButtonBoundingClientRect() : null;
        const info = typeof wx !== 'undefined' && wx.getSystemInfoSync
            ? wx.getSystemInfoSync() : null;
        const h = info && info.screenHeight;
        if (rect && h > 0 && rect.bottom > 0) {
            capsule = Math.max(0, Math.min(0.3, rect.bottom / h));
        }
    } catch { /* leave it at zero -- a missing inset is a cosmetic loss, not a crash */ }
    return capsule;
}

/**
 * The top bar's height, and the gap it keeps from the screen's own top edge.
 *
 * HERE RATHER THAN IN `top-bar.ts`, because `home-view` needs them too: centring the rail
 * means measuring the free band between the bar's bottom edge and the start button's top
 * edge, and the bar's bottom edge is exactly what these two numbers decide. A copy in each
 * file is two layouts that agree today and drift the first time one of them is retuned.
 *
 * 96 is the height of the HUD's two readout dials. The top of one screen and the top of the
 * other should be cut to the same measure.
 *
 * The margin is a fraction of the WIDTH, not of the height: the width is pinned at 1280 on
 * every device (see `canvasSize`) while the height is whatever the aspect ratio makes it, so
 * a fraction of the height would give a tablet a different gap from a tall phone.
 */
export const BAR_H = 96;
export const BAR_MARGIN_F = 0.03;

/**
 * The y of the top bar's bottom edge, in canvas coordinates. `w` and `h` come from
 * `canvasSize`.
 */
export function barBottomY(w: number, h: number): number {
    const top = Math.max(safeInsets().top, capsuleInset());
    return h / 2 - top * h - w * BAR_MARGIN_F - BAR_H;
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
