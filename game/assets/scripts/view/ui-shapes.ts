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
let starFrame: SpriteFrame | null = null;

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
