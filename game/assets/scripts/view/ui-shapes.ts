import {
    Color, ImageAsset, Layers, Node, Rect, Size, Sprite, SpriteFrame, Texture2D, UITransform,
} from 'cc';

/**
 * Rounded chips and dots for the UI layer, drawn at runtime.
 *
 * The project ships no image assets, so a rounded panel has to come from somewhere.
 * `Graphics` is the obvious tool but needs the builtin graphics material, which nothing
 * in the scene references; a generated Texture2D only needs the sprite material that the
 * HUD's Labels already prove is loaded. Each shape is painted once into a small RGBA
 * texture, white so it can be tinted, and shared by every node that asks for it.
 */

const DOT_SIZE = 32;

/**
 * The star, painted at 128 so its points survive being drawn large: a win panel's star is
 * about 130 design units, which on a 1170-wide phone against a 720-unit canvas is roughly
 * 210 device pixels. A 32px frame -- the size the dot gets away with, being a circle at 40 --
 * would be visibly soft at that magnification, and a soft point is not a star.
 */
const STAR_SIZE = 128;
/** Inner radius over outer: 0.475 is the proportion a five-pointed star is normally drawn at. */
const STAR_WAIST = 0.475;

/**
 * The sunburst: alternating wedges from the centre, fading out before the rim.
 *
 * It is drawn very large and very faint -- a glow behind the win panel, turning slowly -- so it
 * is painted small and the falloff does the work. A hard-edged wedge scaled 8x would be a
 * blurry hard edge, which looks like a mistake; a wedge that fades radially scaled 8x looks
 * like light, which is what it is for.
 *
 * BURST_FADE is where the fade starts, as a fraction of the radius, and the alpha runs to zero
 * at the rim. The centre is left solid: a burst with a hole in it reads as a ring.
 */
const BURST_SIZE = 128;
const BURST_SPOKES = 12;
const BURST_FADE = 0.30;

/**
 * One rounded frame per corner radius asked for, painted on demand.
 *
 * It used to be a single 32px frame with a radius of 15 -- half its width, so the painted
 * shape was very nearly a CIRCLE -- and `frameFrom` never set the 9-slice insets. A SLICED
 * sprite with no insets has no border to protect: the whole texture is its centre, and the
 * centre is stretched to the node's size. So every "rounded rectangle" on the HUD was in
 * fact that circle stretched into an ELLIPSE. On a 210x88 pill that passes for a rounded
 * pill and nobody looked twice; on a 520x380 dialog panel it is a white blob, which is what
 * finally showed it.
 *
 * With the insets set, the radius is honoured in DESIGN UNITS whatever the node's size --
 * which is the whole point of slicing, and also why the radius has to be a parameter now:
 * one radius cannot suit both a 88-tall pill and a 420-tall panel.
 */
const roundFrames = new Map<number, SpriteFrame>();
let dotFrame: SpriteFrame | null = null;
let rampFrame: SpriteFrame | null = null;
let starFrame: SpriteFrame | null = null;
let burstFrame: SpriteFrame | null = null;

/**
 * White pixels whose alpha comes from `coverage`, evaluated at each pixel centre and
 * clamped to 0..1 — a coverage that crosses zero over one pixel gives a soft edge.
 */
function paint(size: number, coverage: (x: number, y: number) => number): Uint8Array {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, coverage(x + 0.5, y + 0.5))));
        }
    }
    return data;
}

function frameFrom(data: Uint8Array, size: number, inset = 0): SpriteFrame {
    const image = new ImageAsset({
        width: size,
        height: size,
        _data: data,
        _compressed: false,
        format: Texture2D.PixelFormat.RGBA8888,
    });
    const tex = new Texture2D();
    tex.image = image;
    tex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    const frame = new SpriteFrame();
    // Keep it out of the dynamic atlas. Packing copies a frame in with texSubImage2D from
    // an image-like source (an <img>/canvas), and this texture's source is a raw byte
    // array — the copy throws `Overload resolution failed` and takes the whole frame with
    // it. Two extra draw calls is the price.
    frame.packable = false;
    frame.texture = tex;
    frame.originalSize = new Size(size, size);
    frame.rect = new Rect(0, 0, size, size);
    // The 9-slice border. Without it a SLICED sprite has no corners to protect and stretches
    // the whole texture -- see `roundFrames`.
    frame.insetLeft = inset;
    frame.insetRight = inset;
    frame.insetTop = inset;
    frame.insetBottom = inset;
    return frame;
}

/** Distance from a rounded rect's outline, positive inside: the classic corner-clamp trick. */
function roundedCoverage(r: number, size: number): (x: number, y: number) => number {
    return (x, y) => {
        const cx = Math.min(Math.max(x, r), size - r);
        const cy = Math.min(Math.max(y, r), size - r);
        return r - Math.hypot(x - cx, y - cy) + 0.5;
    };
}

function dotCoverage(x: number, y: number): number {
    const r = DOT_SIZE / 2;
    return r - Math.hypot(x - r, y - r);
}

/**
 * Coverage for a five-pointed star inscribed in a `size` texture, point up.
 *
 * A star is not convex, so the corner-clamp trick `roundedCoverage` uses does not apply. What
 * DOES apply is that a star is star-shaped about its own centre -- every ray from the centre
 * crosses the outline exactly once -- so the outline's distance in a pixel's own direction can
 * be found by intersecting that ray with each of the ten edges and taking the one hit that
 * lands inside its segment. Coverage is then that distance minus the pixel's, in pixels, which
 * gives the same one-pixel soft edge every other shape here has.
 *
 * Ten intersections per pixel over 128x128 is 164k of them, paid ONCE for the whole game: the
 * frame is cached like the others.
 */
function starCoverage(size: number): (x: number, y: number) => number {
    const c = size / 2;
    // A pixel inside the tip still needs somewhere to fade out, hence the inset.
    const outer = c - 1.5;
    const pts: [number, number][] = [];
    for (let k = 0; k < 10; k++) {
        // First vertex straight up. Texture y runs DOWN, and the shape is symmetric
        // left-to-right, so the sign here decides only which way the star points.
        const a = -Math.PI / 2 + k * Math.PI / 5;
        const rad = k % 2 === 0 ? outer : outer * STAR_WAIST;
        pts.push([rad * Math.cos(a), rad * Math.sin(a)]);
    }
    const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;
    return (x, y) => {
        const px = x - c, py = y - c;
        const d = Math.hypot(px, py);
        if (d < 1e-6) return outer;
        const dx = px / d, dy = py / d;
        for (let k = 0; k < 10; k++) {
            const [ax, ay] = pts[k];
            const [bx, by] = pts[(k + 1) % 10];
            const ex = bx - ax, ey = by - ay;
            const den = cross(dx, dy, ex, ey);
            if (Math.abs(den) < 1e-9) continue;
            const s = cross(ax, ay, dx, dy) / den;
            if (s < 0 || s > 1) continue;
            const t = cross(ax, ay, ex, ey) / den;
            if (t <= 0) continue;
            return t - d + 0.5;
        }
        // Only reachable on the exact vertex rays, where the loop above can reject both
        // adjacent edges to floating-point error. Outside by a hair is the safe answer.
        return -1;
    };
}

/**
 * Coverage for `BURST_SPOKES` wedges of a `size` texture, alternating on and off around the
 * circle, with a radial falloff from BURST_FADE out to the rim.
 *
 * The wedge edges are left HARD in angle and soft in radius. Softening them in angle too would
 * need a per-pixel angular width, which is what an actual antialiased shader does; at the size
 * this is drawn -- a faint glow eight times the texture's width -- the magnification is the
 * antialiasing.
 */
function burstCoverage(size: number): (x: number, y: number) => number {
    const c = size / 2;
    return (x, y) => {
        const px = x - c, py = y - c;
        const d = Math.hypot(px, py) / c;
        if (d > 1) return 0;
        const wedge = Math.floor(
            ((Math.atan2(py, px) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / BURST_SPOKES),
        );
        if (wedge % 2 === 1) return 0;
        return d <= BURST_FADE ? 1 : (1 - d) / (1 - BURST_FADE);
    };
}

function spriteNode(
    name: string, w: number, h: number, color: Color, frame: SpriteFrame, type: number,
): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    const sprite = node.addComponent(Sprite);
    // CUSTOM before the frame is assigned, or the frame's own size overwrites ours.
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.type = type;
    sprite.spriteFrame = frame;
    sprite.color = color;
    const tf = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    tf.setContentSize(w, h);
    return node;
}

/**
 * A rounded rectangle `w`x`h`, tinted `color`, with corners of `radius` DESIGN UNITS.
 *
 * The default is half the shorter side, which draws a stadium -- straight sides, semicircular
 * ends -- and is what every pill on the HUD wants. Pass a smaller radius for a panel, which
 * wants corners rather than ends.
 *
 * The radius is also clamped to half the shorter side on the way in: a corner wider than the
 * shape has no meaning, and the two clamped quarter-circles would meet in the middle and
 * leave the slice's centre strip inside-out.
 */
export function roundedSprite(
    name: string, w: number, h: number, color: Color, radius?: number,
): Node {
    const r = Math.max(2, Math.round(Math.min(radius ?? Math.min(w, h) / 2, Math.min(w, h) / 2)));
    let frame = roundFrames.get(r);
    if (!frame) {
        const size = r * 2 + 2;
        frame = frameFrom(paint(size, roundedCoverage(r, size)), size, r);
        roundFrames.set(r, frame);
    }
    return spriteNode(name, w, h, color, frame, Sprite.Type.SLICED);
}

/**
 * A vertical fade: opaque at the TOP, gone at the bottom, tinted `color`.
 *
 * The one thing this file could not draw before, and the reason a flat background reads as
 * flat -- a tinted sprite is one colour everywhere, so a screen painted from them has no
 * light in it anywhere. Layered over a flat ground at low alpha this is a glow at the top of
 * the sky; rotated 180 it is a vignette at the bottom.
 *
 * SMOOTHSTEP rather than a straight line, because the visible artefact of a linear ramp is
 * not the ramp -- it is the hard stop where the sprite's bottom edge meets the ground it was
 * laid over. Easing both ends puts the whole of the fade inside the sprite.
 *
 * Painted at RAMP_SIZE square and stretched, SIMPLE: a ramp has no detail across, so one
 * frame serves every size and any aspect.
 */
const RAMP_SIZE = 64;

export function rampSprite(name: string, w: number, h: number, color: Color): Node {
    if (!rampFrame) {
        rampFrame = frameFrom(paint(RAMP_SIZE, (_x, y) => {
            const t = 1 - y / RAMP_SIZE;
            return t * t * (3 - 2 * t);
        }), RAMP_SIZE);
    }
    return spriteNode(name, w, h, color, rampFrame, Sprite.Type.SIMPLE);
}

/** A filled circle of diameter `d`, tinted `color`. */
export function dotSprite(name: string, d: number, color: Color): Node {
    if (!dotFrame) dotFrame = frameFrom(paint(DOT_SIZE, dotCoverage), DOT_SIZE);
    return spriteNode(name, d, d, color, dotFrame, Sprite.Type.SIMPLE);
}

/**
 * A five-pointed star `d` units across, tinted `color`. SIMPLE, not sliced -- a star has no
 * middle that can be stretched, so it scales as a whole, which is also what lets one frame
 * serve every size on screen.
 */
export function starSprite(name: string, d: number, color: Color): Node {
    if (!starFrame) starFrame = frameFrom(paint(STAR_SIZE, starCoverage(STAR_SIZE)), STAR_SIZE);
    return spriteNode(name, d, d, color, starFrame, Sprite.Type.SIMPLE);
}

/** A radiating sunburst `d` units across, tinted `color`. See `burstCoverage`. */
export function burstSprite(name: string, d: number, color: Color): Node {
    if (!burstFrame) {
        burstFrame = frameFrom(paint(BURST_SIZE, burstCoverage(BURST_SIZE)), BURST_SIZE);
    }
    return spriteNode(name, d, d, color, burstFrame, Sprite.Type.SIMPLE);
}

/**
 * THE THREE GLYPH ICONS: a gear for the settings button, a speaker and a buzzing phone for
 * the two switches inside it.
 *
 * They exist because the settings button used to say the WORD 设置, over an argument that is
 * written down at GEAR_D in hud-view: a gear from the system font is one substitution away
 * from a hollow box on a device whose font lacks it, and every other string on the HUD is
 * Chinese text known to render. That argument holds -- against a FONT glyph. It says nothing
 * about a shape this file paints itself, which is the same thing the stars and the padlock
 * already are, and which cannot be substituted because no font is consulted.
 *
 * Each is described in the unit square, y DOWN, and scaled to the texture on the way out --
 * so the numbers below read as fractions of the icon rather than as pixels of whatever size
 * it happens to be painted at.
 *
 * Painted at 96 rather than the dot's 32: these are drawn at 44 to 68 design units, which on
 * a 1170-wide phone against a 720-unit canvas is up to 110 device pixels, and a gear tooth
 * has corners a circle does not.
 */
const ICON_SIZE = 96;

/** Positive INSIDE a box centred on the origin: the distance to its nearest edge. */
function boxIn(px: number, py: number, hx: number, hy: number): number {
    return Math.min(hx - Math.abs(px), hy - Math.abs(py));
}

/** Signed distance to a rounded box centred on the origin, positive OUTSIDE. */
function roundBoxSd(
    px: number, py: number, hx: number, hy: number, r: number,
): number {
    const qx = Math.abs(px) - hx + r;
    const qy = Math.abs(py) - hy + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Positive inside a CONVEX polygon, as the smallest of its edges' signed distances.
 *
 * Exact inside, conservative outside (a point past a corner reports the nearer of the two
 * edge planes, which is further than the true distance) -- and outside is where coverage is
 * clamped to zero anyway, so the only place it shows is the one-pixel fade at a corner.
 *
 * The winding matters: these are wound so that the interior is to the LEFT of each edge in
 * this file's y-down frame. Reversed, every distance flips sign and the shape disappears --
 * which is exactly what the speaker's cone did on the first attempt.
 */
function polyIn(px: number, py: number, pts: [number, number][]): number {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        const ex = bx - ax, ey = by - ay;
        const len = Math.hypot(ex, ey);
        best = Math.min(best, ((px - ax) * ey - (py - ay) * ex) / len);
    }
    return best;
}

/**
 * A cogwheel: a round body, eight teeth, a hole through the middle.
 *
 * The teeth are one test rather than eight shapes -- the angle to the NEAREST tooth centre,
 * folded into a single wedge -- and the wedge's angular half-width is turned into a length by
 * multiplying by the radius, so a tooth has parallel sides instead of widening outward.
 */
function gearCoverage(size: number): (x: number, y: number) => number {
    const span = Math.PI / 8;
    return (x, y) => {
        const px = x / size - 0.5, py = y / size - 0.5;
        const d = Math.hypot(px, py);
        // The exact centre has no angle, and it is inside the hole regardless.
        if (d < 1e-6) return -1;
        const a = ((Math.atan2(py, px) + span) % (2 * span)) - span;
        const tooth = Math.min(0.46 - d, (span * 0.46 - Math.abs(a)) * d);
        return (Math.min(Math.max(0.33 - d, tooth), d - 0.13)) * size + 0.5;
    };
}

/** A speaker: a stem, a cone, and two arcs of sound coming off it. */
function speakerCoverage(size: number): (x: number, y: number) => number {
    return (x, y) => {
        const u = x / size, v = y / size;
        // The arcs' centre, which is the cone's throat rather than the icon's middle.
        const px = u - 0.34, py = v - 0.5;
        let cov = boxIn(u - 0.23, py, 0.07, 0.095);
        cov = Math.max(cov, polyIn(u, v, [
            [0.30, 0.595], [0.50, 0.80], [0.50, 0.20], [0.30, 0.405],
        ]));
        const d = Math.hypot(px, py);
        for (const r of [0.28, 0.40]) {
            // A ring, then cut to the right-hand side and to a wedge -- a full ring would
            // circle the cone, and half a ring would still curl round its mouth.
            let arc = 0.026 - Math.abs(d - r);
            arc = Math.min(arc, px - 0.19, px * 1.05 - Math.abs(py));
            cov = Math.max(cov, arc);
        }
        return cov * size + 0.5;
    };
}

/** A phone shaking: the body as an outline, with two motion ticks either side of it. */
function buzzCoverage(size: number): (x: number, y: number) => number {
    return (x, y) => {
        const px = x / size - 0.5, py = y / size - 0.5;
        // The body is a rounded box's OUTLINE: its distance field, banded about zero.
        let cov = 0.026 - Math.abs(roundBoxSd(px, py, 0.135, 0.245, 0.055));
        cov = Math.max(cov, boxIn(px, py + 0.155, 0.055, 0.016));
        cov = Math.max(cov, boxIn(px, py - 0.175, 0.030, 0.030));
        for (const side of [-1, 1]) {
            cov = Math.max(cov, boxIn(px - side * 0.245, py, 0.019, 0.100));
            cov = Math.max(cov, boxIn(px - side * 0.335, py, 0.019, 0.070));
        }
        return cov * size + 0.5;
    };
}

/**
 * One cached frame per icon, and one factory instead of three copies of the caching.
 *
 * SIMPLE, not sliced, for the same reason the star is: an icon has no middle that can be
 * stretched, so it scales as a whole and one frame serves every size it is drawn at.
 */
const iconFrames = new Map<string, SpriteFrame>();

function iconSprite(
    kind: string, coverage: (size: number) => (x: number, y: number) => number,
): (name: string, d: number, color: Color) => Node {
    return (name, d, color) => {
        let frame = iconFrames.get(kind);
        if (!frame) {
            frame = frameFrom(paint(ICON_SIZE, coverage(ICON_SIZE)), ICON_SIZE);
            iconFrames.set(kind, frame);
        }
        return spriteNode(name, d, d, color, frame, Sprite.Type.SIMPLE);
    };
}

/** A cogwheel `d` units across, tinted `color`. */
export const gearSprite = iconSprite('gear', gearCoverage);
/** A speaker with sound coming off it, `d` units across, tinted `color`. */
export const speakerSprite = iconSprite('speaker', speakerCoverage);
/** A shaking phone `d` units across, tinted `color`. */
export const buzzSprite = iconSprite('buzz', buzzCoverage);
