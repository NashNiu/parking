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

/** Corner radius of the rounded frame, in texture pixels; also its 9-slice inset. */
const RADIUS = 14;
const ROUND_SIZE = RADIUS * 2 + 2;
const DOT_SIZE = 32;

let roundFrame: SpriteFrame | null = null;
let dotFrame: SpriteFrame | null = null;

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

function frameFrom(data: Uint8Array, size: number): SpriteFrame {
    const image = new ImageAsset({
        width: size,
        height: size,
        _data: data,
        _compressed: false,
        format: Texture2D.PixelFormat.RGBA8888,
    });
    const tex = new Texture2D();
    tex.image = image;
    const frame = new SpriteFrame();
    frame.texture = tex;
    frame.originalSize = new Size(size, size);
    frame.rect = new Rect(0, 0, size, size);
    return frame;
}

/** Distance from a rounded rect's outline, positive inside: the classic corner-clamp trick. */
function roundedCoverage(x: number, y: number): number {
    const cx = Math.min(Math.max(x, RADIUS), ROUND_SIZE - RADIUS);
    const cy = Math.min(Math.max(y, RADIUS), ROUND_SIZE - RADIUS);
    return RADIUS - Math.hypot(x - cx, y - cy) + 0.5;
}

function dotCoverage(x: number, y: number): number {
    const r = DOT_SIZE / 2;
    return r - Math.hypot(x - r, y - r);
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
 * A rounded rectangle `w`x`h`, tinted `color`. 9-sliced, so the corner radius stays the
 * same whatever size it is stretched to.
 */
export function roundedSprite(name: string, w: number, h: number, color: Color): Node {
    if (!roundFrame) roundFrame = frameFrom(paint(ROUND_SIZE, roundedCoverage), ROUND_SIZE);
    return spriteNode(name, w, h, color, roundFrame, Sprite.Type.SLICED);
}

/** A filled circle of diameter `d`, tinted `color`. */
export function dotSprite(name: string, d: number, color: Color): Node {
    if (!dotFrame) dotFrame = frameFrom(paint(DOT_SIZE, dotCoverage), DOT_SIZE);
    return spriteNode(name, d, d, color, dotFrame, Sprite.Type.SIMPLE);
}
