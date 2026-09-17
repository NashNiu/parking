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

/**
 * The floor of the dot's bucketed frame sizes, in pixels -- see `dotBucket` below.
 *
 * A dot used to share ONE 32px frame across every circle in the project, from a 22-unit
 * unread indicator up to a 200-unit glow. STAR_SIZE's docblock, just below, used to cite that
 * as the shape that "gets away with" a single small texture, "being a circle at 40". THAT
 * CLAIM IS NOW FALSE, and it is worth saying so rather than quietly fixing it: a level badge
 * was drawn at NODE_D = 170 design units when this was written -- and the canvas is 1280 wide,
 * not 720 (`ui-layout.canvasSize` spells out why that pair is the trap it looks like), so on
 * a 1170-wide phone that is 170 x 1170 / 1280 = about 155 device pixels. A 32px frame blown
 * up 4.8x is exactly the softness and halo a player photographed and reported. The badge has
 * since come down to 128, which is still four times the old frame; the dot stopped getting
 * away with 32 the moment a badge became a circle that large, and it has not gone back.
 *
 * `dotBucket` picks a texture size per diameter now instead of one frame for all of them.
 * DOT_SIZE is only the smallest bucket, kept so the cheap circles -- the unread dot, the coin
 * -- still pay for a 32-square texture rather than every dot paying for the badge's worst
 * case.
 */
const DOT_SIZE = 32;
/** The largest bucket `dotBucket` will hand out, in pixels -- see it below for why. */
const DOT_SIZE_MAX = 256;

/**
 * The star, painted at 128 so its points survive being drawn large: a win panel's star is
 * about 130 design units, which on a 1170-wide phone against a 720-unit canvas is roughly
 * 210 device pixels. A 32px frame -- the size a small dot needs, and used to be the ONLY size
 * any dot got -- would be visibly soft at that magnification, and a soft point is not a star.
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
 * The play-head triangle, painted into a 64-square texture.
 *
 * Half of STAR_SIZE's 128, because a triangle asks less of the texture than a star does. This
 * shape is never drawn larger than about 48 design units -- an icon on the start button -- and
 * it has only three straight edges, so the one thing magnification can soften is the single
 * pixel of border along each of them. A star needs the full 128 because it has five points, and
 * a soft point reads as round rather than sharp.
 */
const TRI_SIZE = 64;

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
/** One frame per size BUCKET -- see `dotBucket` -- rather than the single frame this used to be. */
const dotFrames = new Map<number, SpriteFrame>();
let rampFrame: SpriteFrame | null = null;
let starFrame: SpriteFrame | null = null;
let burstFrame: SpriteFrame | null = null;
let triFrame: SpriteFrame | null = null;

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

function dotCoverage(size: number): (x: number, y: number) => number {
    const r = size / 2;
    return (x, y) => r - Math.hypot(x - r, y - r);
}

/**
 * The texture size to paint a `d`-unit dot into: the smallest power of two at least `d`,
 * clamped to DOT_SIZE..DOT_SIZE_MAX.
 *
 * Mirrors `roundedSprite`'s one-frame-per-radius cache, except the key is a bucket rather than
 * the exact size, because a dot is asked for at whatever diameter its caller happens to need --
 * unlike a corner radius, which a designer picks from a short list -- and a fresh bucket per
 * exact diameter would cache one frame per distinct dot on the whole screen instead of five or
 * six shared ones.
 *
 * THE FLOOR keeps the cheap circles cheap: an unread dot at 22 units or a coin at 52 still
 * gets a 32 or 64-square frame, not the largest bucket a badge needs.
 *
 * THE CEILING is not decoration. 256x256 RGBA is 256 KB, and the largest circle the lobby
 * draws -- the current-level glow -- is about 200 design units, comfortably inside it. Without
 * a ceiling, a future caller passing a much larger diameter would silently allocate a texture
 * many times that size for one frame.
 */
function dotBucket(d: number): number {
    let size = DOT_SIZE;
    while (size < d) size *= 2;
    return Math.min(size, DOT_SIZE_MAX);
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

/**
 * Coverage for an equilateral triangle inscribed in a `size` texture, tip pointing RIGHT -- a
 * play head.
 *
 * A triangle is CONVEX, which makes this the third distinct technique in this file for turning
 * a shape into coverage: `roundedCoverage` clamps to the nearest corner, `starCoverage` casts a
 * ray from the centre because a star is NOT convex, and a convex polygon needs neither trick --
 * the signed distance to each edge, minimum taken over all three, is exact inside and
 * conservative outside (the same reasoning `polyIn`, further down, spells out in full for the
 * icon shapes). Of the three, a convex polygon is the easiest to get right.
 *
 * The 1.5 inset on the circumradius exists for the same reason `starCoverage` has one: a vertex
 * sitting exactly on the texture's edge has nowhere to fade out to, so the triangle is pulled in
 * half a pixel short of the frame.
 */
function triCoverage(size: number): (x: number, y: number) => number {
    const c = size / 2;
    const r = c - 1.5;
    // Vertex 0 sits straight right (angle 0); the other two follow at 120-degree steps. Texture
    // y runs DOWN, so walking the vertices in this order traces them clockwise on screen -- the
    // opposite sense from `polyIn`'s edges below, which are wound so the interior sits on the
    // LEFT of each one. That is why the edge distance is negated (`-d`, not `d`) before it goes
    // into the minimum: checked numerically, this makes the centre come out strongly positive
    // (+15.75 at TRI_SIZE) and a texture corner strongly negative (-15.25), which is what
    // "positive inside" requires.
    const pts: [number, number][] = [0, 1, 2].map((k) => {
        const a = (k * 2 * Math.PI) / 3;
        return [c + r * Math.cos(a), c + r * Math.sin(a)] as [number, number];
    });
    return (x, y) => {
        let min = Infinity;
        for (let k = 0; k < 3; k++) {
            const [ax, ay] = pts[k];
            const [bx, by] = pts[(k + 1) % 3];
            const ex = bx - ax, ey = by - ay;
            const len = Math.hypot(ex, ey);
            // Cross product over edge length = signed distance to the line this edge sits on,
            // negated here because these vertices wind the opposite way from `polyIn`'s -- see
            // above.
            const d = ((x - ax) * ey - (y - ay) * ex) / len;
            min = Math.min(min, -d);
        }
        return min + 0.5;
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

/**
 * A filled circle of diameter `d`, tinted `color`, from a frame cached per `dotBucket(d)` --
 * see it above for why one bucket cannot serve every dot in the project any more.
 */
export function dotSprite(name: string, d: number, color: Color): Node {
    const size = dotBucket(d);
    let frame = dotFrames.get(size);
    if (!frame) {
        frame = frameFrom(paint(size, dotCoverage(size)), size);
        dotFrames.set(size, frame);
    }
    return spriteNode(name, d, d, color, frame, Sprite.Type.SIMPLE);
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
 * A `d`-unit-wide triangular play head, tip right, tinted `color`. SIMPLE, not sliced -- like
 * the star, it has no middle that can be stretched, so it scales as a whole and one frame
 * serves every size it is drawn at.
 */
export function triSprite(name: string, d: number, color: Color): Node {
    if (!triFrame) triFrame = frameFrom(paint(TRI_SIZE, triCoverage(TRI_SIZE)), TRI_SIZE);
    return spriteNode(name, d, d, color, triFrame, Sprite.Type.SIMPLE);
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
 *
 * THIS USED TO DRAW A BALD PATCH, NOT MERELY TOO FEW TEETH, and the difference matters because
 * the fix is not "add more teeth" -- it is "stop losing the ones already specified" for half the
 * circle. `Math.atan2` returns a NEGATIVE angle for the whole lower-left half of the circle
 * (roughly -pi to 0), and `%` in JavaScript keeps the sign of its LEFT operand rather than
 * folding into a positive range the way a mathematical modulo does. For any angle where
 * `atan2(py, px) + span` was itself negative but small in magnitude -- a band about `2 * span`
 * (45 degrees) wide -- `(atan2 + span) % (2 * span)` returned that same small negative number
 * completely UNWRAPPED (the quotient truncates to zero, so there is no wraparound at all), and
 * subtracting `span` again then put `a` as far as `2 * span` outside the intended `[-span, span)`
 * wedge. `Math.abs(a)` that large makes `span * 0.46 - Math.abs(a)` strongly negative, so the
 * tooth term never wins there -- the gear had no tooth over that whole band, and the wrap error
 * compounds around the rest of the negative-angle half, so what actually rendered was drawn teeth
 * over less than half the circle and a bald arc over the rest of it -- sampled at the tooth radius
 * on a fresh render, 170 of 360 degrees came back with no tooth at all. It was NOT a matter of too
 * few teeth spaced too far apart; the spacing (`2 * span` = 45 degrees, eight teeth) was always
 * right, and a correctly-folded `a` proves it: the fix below is the same formula with a second
 * `% (2 * span)` added after shifting by a full period, which is the standard way to force a
 * possibly-negative JavaScript `%` into `[0, 2 * span)` before subtracting `span` back out.
 */
function gearCoverage(size: number): (x: number, y: number) => number {
    const span = Math.PI / 8;
    const period = 2 * span;
    return (x, y) => {
        const px = x / size - 0.5, py = y / size - 0.5;
        const d = Math.hypot(px, py);
        // The exact centre has no angle, and it is inside the hole regardless.
        if (d < 1e-6) return -1;
        // Folded into [0, period) first -- see the docblock above for why the naive
        // `(angle + span) % period` alone leaves a band unwrapped -- then shifted back to
        // [-span, span), the wedge every tooth is tested against.
        const wrapped = (((Math.atan2(py, px) + span) % period) + period) % period;
        const a = wrapped - span;
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

/**
 * THE TWO-PLATE READOUT, and the three constants it is made of.
 *
 * HERE RATHER THAN IN `hud-view`, where it lived while the HUD was the only screen with
 * readouts on it. The lobby's top bar wears the same coin plate, and the alternative was a
 * second copy of these four lines -- which is how one button style becomes two that agree
 * today and disagree after the first retune of either. `hud-view` imports it now; nothing
 * about the HUD's own geometry moved with it.
 *
 * NOT A CONTRADICTION OF THIS FILE'S HEADER, which says it paints textures. It still does:
 * this composes two `roundedSprite`s and paints nothing new. What it shares is the SHAPE
 * every pressable and every readout in this project wears, which is the same kind of fact as
 * "a star has five points".
 */

/**
 * Both readouts are drawn as TWO plates -- a white face over a cool-grey base peeking out
 * below -- which is the same trick as the unlock button, the padlock rims on the board and the
 * win panel's stars. They were flat white stadiums, and flat is what "redesign these" was
 * about: on a HUD where the pressable things have a top face, the readouts having none made
 * them read as unfinished rather than as a different kind of object.
 *
 * The base is a TINT OF THE BOARD, not grey and not a darker white. The board behind is
 * blue-grey (see GROUND in `palette.ts`), so a neutral shadow under a white plate reads as
 * dirty; a shadow biased the same way as the surface it falls on reads as a shadow.
 *
 * It tracks GROUND at the same few units under it that it always sat at, so it followed the
 * floor down when the floor moved (see `palette.ts`). Left where it was, a base still carrying
 * the old pale blue would have been lighter than the board it is supposed to be a shadow on.
 *
 * IT HAS NOW FOLLOWED THE FLOOR BACK UP, to -4 under 199 where it was -4 under 177, and the
 * paragraph above is the whole reason it had to. The failure it describes has a mirror image
 * and this constant was one edit away from it: a base held at 173 against a 199 floor is 26
 * units under the board rather than 4, which does not read as a soft lip beneath the plate --
 * it reads as a dark bar drawn round it. Too light and too dark break this the same way,
 * because what makes it a shadow is that it is CLOSE to the surface and biased with it.
 *
 * Both readouts sit on the upper half of the screen, which is the half that stayed pavement
 * when the scene split, so GROUND is still the right thing for it to track. Anything that
 * moves onto the asphalt wants its own base, not this one.
 *
 * THE LOBBY'S COIN PLATE ALSO STANDS ON PAVEMENT -- `palette.GROUND`, the same surface the
 * argument above is about -- so it takes this base unchanged rather than picking its own.
 */
export const PILL_BASE = new Color(185, 196, 214, 255);
/** How far the base peeks out below the face. */
export const PILL_LIFT = 6;
/** The face: off-white, so ink on it is near-black rather than fighting pure white. */
export const PILL_BG = new Color(252, 252, 255);
/**
 * The ink that goes ON that face: a very dark blue, not black, biased the same way as every
 * other colour in this project.
 *
 * HERE RATHER THAN IN EACH CALLER, which is the same argument `PILL_BASE`, `PILL_BG` and
 * `liftedPill` came out of `hud-view` on, and it was left behind by that move. The HUD's
 * readouts and the lobby's coin plate carried identical copies of 48,60,92 under two private
 * names -- one file's retune of its plate's face would have left the other file's ink on it,
 * and nothing anywhere would have said so. A face and the only ink that ever lands on it are
 * one fact.
 */
export const PILL_INK = new Color(48, 60, 92);

/**
 * A readout plate: a white face over a base of the same shape, offset down so it shows as a
 * lip. Returns both, because callers hang their contents off the FACE (so the contents move
 * with it) and position the HOLDER.
 */
export function liftedPill(
    name: string, w: number, h: number,
): { holder: Node; face: Node } {
    const holder = new Node(name);
    holder.layer = Layers.Enum.UI_2D;
    holder.addComponent(UITransform).setContentSize(w, h);
    const base = roundedSprite('base', w, h, PILL_BASE);
    holder.addChild(base);
    base.setPosition(0, -PILL_LIFT, 0);
    const face = roundedSprite('face', w, h, PILL_BG);
    holder.addChild(face);
    return { holder, face };
}
