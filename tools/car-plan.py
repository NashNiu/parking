#!/usr/bin/env python3
"""Render the drawn car's TOP-DOWN PLAN, the only view that decides whether it reads as a car.

WHY THIS EXISTS. The camera is orthographic and looks at the board straight on, so a car IS its
plan and nothing else. That cannot be judged from a phone screenshot -- four rounds of tuning
the car's look from one got it wrong every time -- and nothing else in the project can show it.

It reads its numbers OUT OF the source: the design constants from `car-mesh.ts`, the shadow lift
from `car-builder.ts`, the key light's pitch from `environment.ts`, and the three body sizes from
core's `CAP_BOX`. Change a constant there, run this, look. If a piece is added or reordered in
`car-mesh.ts`, `design()` below has to follow -- the constants cannot drift, but the STACK can,
so keep the two side by side.

THE LIGHTING HERE IS AN APPROXIMATION, and it matters that you know which half to trust. The
roof's depth comes from real engine lighting on tilted normals, so a render that ignored the
light would show a flat slab and be worse than useless. What this does instead is Lambert against
the key light's real direction, normalised so a straight-up-facing plate comes out exactly as
authored. So: trust it on WHERE the highlight falls, how wide the shoulder is, and how the pieces
sit together. Do not trust it on exact colour -- the engine runs a full PBR pass with its own
exposure, and this clips a bright highlight where the engine would roll it off.

    python tools/car-plan.py [out.png]      default: .tmp/car-plan.png
"""

import math
import re
import struct
import sys
import zlib

MESH = 'game/assets/scripts/view/car-mesh.ts'
BUILDER = 'game/assets/scripts/view/car-builder.ts'
ENV = 'game/assets/scripts/view/environment.ts'
TYPES = 'game/assets/scripts/core/types.ts'
CAR = (244, 67, 72)                 # COLORS.red, the busiest colour on a board
BG = (222, 226, 232)
SHADOW_ALPHA = 45 / 255             # blob-shadow.ts's mainColor alpha
PPU, PAD, SS = 300, 0.16, 3

# Relative ambient fill. The scene has skyIllum 20000 against the key light's 70000, but the two
# reach albedo through different BRDF terms, so this is a fitted knob rather than a derived
# number. It sets how dark the unlit side of the roof goes; raise it if the render reads harsher
# than the device does.
AMBIENT = 0.30


def numbers(path, needed):
    """Every `const NAME = <number>;` in a source file, checked for the ones we depend on."""
    with open(path, encoding='utf-8') as f:
        t = f.read()
    nums = {n: float(v) for n, v in
            re.findall(r'^(?:export )?const ([A-Z][A-Z0-9_]*) = (-?[0-9.]+);', t, re.M)}
    missing = [k for k in needed if k not in nums]
    if missing:
        raise SystemExit(f'{path} is missing {missing} -- renamed?')
    return nums, t


def constants():
    needed = ('BODY_ALONG', 'BODY_ACROSS', 'BODY_CORNER', 'REFERENCE_ASPECT', 'CORNER_SEGMENTS',
              'EDGE_GROW_ALONG', 'EDGE_GROW_ACROSS', 'EDGE_SHADE', 'DOME_NARROW',
              'WHEEL_X', 'WHEEL_Y', 'WHEEL_W', 'WHEEL_H', 'WHEEL_R', 'GLASS_KEEP', 'WINDOW_R',
              'WINDSCREEN_X', 'WINDSCREEN_W', 'WINDSCREEN_H',
              'REAR_WINDOW_X', 'REAR_WINDOW_W', 'REAR_WINDOW_H',
              'ARROW_X', 'ARROW_W', 'ARROW_H', 'ARROW_SHAFT', 'ARROW_HEAD')
    k, t = numbers(MESH, needed)
    tyre = re.search(r'const TYRE = new Color\((\d+), (\d+), (\d+)', t)
    if not tyre:
        raise SystemExit(f'could not read TYRE out of {MESH}')
    block = re.search(r'DOME_PROFILE[^=]*=\s*\[(.*?)\];', t, re.S)
    if not block:
        raise SystemExit(f'DOME_PROFILE not found in {MESH}')
    profile = [(float(a), float(d)) for a, d in
               re.findall(r'at:\s*([0-9.]+),\s*tilt:\s*([0-9.]+)', block.group(1))]
    if len(profile) < 2:
        raise SystemExit(f'DOME_PROFILE in {MESH} needs at least two rings')
    k.update(numbers(BUILDER, ('SHADOW_LIFT',))[0])
    k.update(numbers(ENV, ('KEY_LIGHT_PITCH_DEG',))[0])
    k['ACROSS_TO_ALONG'] = (k['BODY_ACROSS'] / k['BODY_ALONG']) / k['REFERENCE_ASPECT']
    return k, tuple(int(g) for g in tyre.groups()), profile


def caps():
    """`CAP_BOX` from core, so the rows are the real aspect ratios and not remembered ones."""
    with open(TYPES, encoding='utf-8') as f:
        t = f.read()
    block = re.search(r'CAP_BOX: Record<Cap, Box> = \{(.*?)\};', t, re.S)
    if not block:
        raise SystemExit(f'CAP_BOX not found in {TYPES}')
    out = [(n, float(ln), float(wd)) for n, ln, wd in re.findall(
        r'(\w+):\s*\{\s*len:\s*([0-9.]+),\s*wid:\s*([0-9.]+)', block.group(1))]
    if not out:
        raise SystemExit(f'could not read CAP_BOX entries out of {TYPES}')
    return out


K, TYRE, PROFILE = constants()
CAPS = caps()

# The key light, as a direction TOWARD it, in board space. `setupEnvironment` rotates the node by
# euler (pitch, 0, 0) and a DirectionalLight shines along its forward (-Z), which comes out as
# (0, -sin|pitch|, -cos|pitch|); this is the negation of that.
_p = math.radians(-K['KEY_LIGHT_PITCH_DEG'])
LIGHT = (0.0, math.sin(_p), math.cos(_p))
FLAT_TERM = AMBIENT + (1 - AMBIENT) * LIGHT[2]      # what a straight-up plate receives


def lighten(c, t):
    return tuple(round(v + (255 - v) * t) for v in c)


def shade(c, f):
    return tuple(round(v * f) for v in c)


def lit(c, normal, ln, wd):
    """`c` as the engine would light it, normalised so a straight-up plate comes out unchanged.

    The mesh normal is transformed by the node's INVERSE TRANSPOSE, which for a scale of
    (ln, wd, 1) is a division by each axis -- so the across component is amplified by about 1.8x
    on a medium car. That amplification is most of why the tilts in DOME_PROFILE look small.
    """
    nx, ny, nz = normal[0] / ln, normal[1] / wd, normal[2]
    m = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    d = max(0.0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / m)
    k = (AMBIENT + (1 - AMBIENT) * d) / FLAT_TERM
    return tuple(max(0, min(255, round(v * k))) for v in c)


def round_rect(cx, cy, w, h, r):
    """Mirror of `roundRect` in car-mesh.ts, anisotropic radius and segment count included."""
    hw, hh = w / 2, h / 2
    a_ref = K['REFERENCE_ASPECT']
    world = r * min(w * a_ref, h)
    rx, ry = min(world / a_ref, hw), min(world, hh)
    ix, iy = hw - rx, hh - ry
    seg = int(K['CORNER_SEGMENTS'])
    pts = []
    for c, (ox, oy) in enumerate([(ix, -iy), (ix, iy), (-ix, iy), (-ix, -iy)]):
        start = -math.pi / 2 + c * (math.pi / 2)
        for s in range(seg + 1):
            a = start + (s / seg) * (math.pi / 2)
            pts.append((cx + ox + math.cos(a) * rx, cy + oy + math.sin(a) * ry))
    return pts


def body_outline(along, across):
    return round_rect(0, 0, K['BODY_ALONG'] * along, K['BODY_ACROSS'] * across, K['BODY_CORNER'])


def outwards(pts):
    """Mirror of `outwards` in car-mesh.ts: the plan outward direction at each vertex."""
    n = len(pts)
    out = []
    for i in range(n):
        ax, ay = pts[(i + 1) % n]
        bx, by = pts[(i - 1) % n]
        dx, dy = ax - bx, ay - by
        m = math.hypot(dx, dy) or 1.0
        out.append((dy / m, -dx / m))
    return out


def arrow_pieces():
    hw, hh = K['ARROW_W'] / 2, K['ARROW_H'] / 2
    shaft = hh * K['ARROW_SHAFT']
    base = K['ARROW_X'] + hw - K['ARROW_W'] * K['ARROW_HEAD']
    return [
        [(K['ARROW_X'] - hw, -shaft), (base, -shaft), (base, shaft), (K['ARROW_X'] - hw, shaft)],
        [(base, -hh), (K['ARROW_X'] + hw, 0), (base, hh)],
    ]


def design():
    """The same three groups as `design()` in car-mesh.ts: under the roof, the roof, over it."""
    under = [(body_outline(K['EDGE_GROW_ALONG'], K['EDGE_GROW_ACROSS']),
              shade(CAR, K['EDGE_SHADE']))]
    for sx in (-1, 1):
        for sy in (-1, 1):
            under.append((round_rect(sx * K['WHEEL_X'], sy * K['WHEEL_Y'],
                                     K['WHEEL_W'], K['WHEEL_H'], K['WHEEL_R']), TYRE))
    rings = [{
        'pts': body_outline(1 - K['DOME_NARROW'] * K['ACROSS_TO_ALONG'] * at,
                            1 - K['DOME_NARROW'] * at),
        'c': CAR,       # nothing is lightened -- the crown is exactly the palette colour
        'tilt': tilt,
    } for at, tilt in PROFILE]
    glass = shade(rings[-1]['c'], K['GLASS_KEEP'])
    over = [
        (round_rect(K['WINDSCREEN_X'], 0, K['WINDSCREEN_W'], K['WINDSCREEN_H'], K['WINDOW_R']),
         glass),
        (round_rect(K['REAR_WINDOW_X'], 0, K['REAR_WINDOW_W'], K['REAR_WINDOW_H'], K['WINDOW_R']),
         glass),
    ] + [(piece, (255, 255, 255)) for piece in arrow_pieces()]
    return under, rings, over


def ellipse(cx, cy, w, h, seg=48):
    return [(cx + math.cos(2 * math.pi * i / seg) * w / 2,
             cy + math.sin(2 * math.pi * i / seg) * h / 2) for i in range(seg)]


def render(out_path):
    W = max(c[1] for c in CAPS) + PAD * 2
    Hs = [c[2] + PAD * 2 for c in CAPS]
    w, h = int(W * PPU), int(sum(Hs) * PPU)
    buf = [[BG] * w for _ in range(h)]

    def blend(xx, yy, col, a):
        if a >= 1:
            buf[yy][xx] = col
        else:
            o = buf[yy][xx]
            buf[yy][xx] = tuple(round(o[i] + (col[i] - o[i]) * a) for i in range(3))

    def fill(pts, col, alpha=1.0):
        """Flat colour, supersampled, even-odd point-in-polygon."""
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for yy in range(max(0, int(min(ys))), min(h, int(max(ys)) + 1)):
            for xx in range(max(0, int(min(xs))), min(w, int(max(xs)) + 1)):
                n = 0
                for sy in range(SS):
                    py = yy + (sy + 0.5) / SS
                    for sx in range(SS):
                        px = xx + (sx + 0.5) / SS
                        inside = False
                        j = len(pts) - 1
                        for i in range(len(pts)):
                            xi, yi = pts[i]
                            xj, yj = pts[j]
                            if (yi > py) != (yj > py) and \
                               px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                                inside = not inside
                            j = i
                        if inside:
                            n += 1
                if n:
                    blend(xx, yy, col, n / (SS * SS) * alpha)

    class Roof:
        """Accumulator for the roof, composited ONCE at the end.

        Compositing each triangle straight into the frame does not work here. Neighbouring
        triangles tile the roof exactly, so each one covers about half of every shared boundary
        pixel -- blend them one after another and that pixel ends up part background twice over,
        which draws a visible seam along every single edge. Sixty of them radiating out of the
        four corners is not a design to judge. Accumulating coverage first makes interior pixels
        come out fully covered, and leaves antialiasing only where the roof genuinely ends.
        """

        def __init__(self):
            self.acc = {}

        def tri(self, p, c):
            (x1, y1), (x2, y2), (x3, y3) = p
            den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
            if abs(den) < 1e-9:
                return
            for yy in range(max(0, int(min(y1, y2, y3))), min(h, int(max(y1, y2, y3)) + 1)):
                for xx in range(max(0, int(min(x1, x2, x3))), min(w, int(max(x1, x2, x3)) + 1)):
                    n, add = 0, [0.0, 0.0, 0.0]
                    for sy in range(SS):
                        py = yy + (sy + 0.5) / SS
                        for sx in range(SS):
                            px = xx + (sx + 0.5) / SS
                            a = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / den
                            b = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / den
                            g = 1 - a - b
                            if a < 0 or b < 0 or g < 0:
                                continue
                            n += 1
                            for i in range(3):
                                add[i] += a * c[0][i] + b * c[1][i] + g * c[2][i]
                    if not n:
                        continue
                    cell = self.acc.setdefault((xx, yy), [0.0, 0.0, 0.0, 0])
                    for i in range(3):
                        cell[i] += add[i]
                    cell[3] += n

        def composite(self):
            for (xx, yy), (r, g, b, n) in self.acc.items():
                blend(xx, yy, (round(r / n), round(g / n), round(b / n)),
                      min(1.0, n / (SS * SS)))

    under, rings, over = design()
    throw = K['SHADOW_LIFT'] * math.tan(math.radians(-K['KEY_LIGHT_PITCH_DEG']))
    lift = 0.0
    y0 = 0.0
    for (name, ln, wd), ch in zip(CAPS, Hs):
        cx0, cy0 = W / 2 * PPU, (y0 + ch / 2) * PPU

        def to_px(pts, cx0=cx0, cy0=cy0, ln=ln, wd=wd):
            # MINUS on y: board +Y is UP on the board (and so on screen -- the camera looks
            # straight down -Z), while image rows run downward. It made no difference while the
            # car was symmetric across its length; now that the key light comes from board +Y it
            # decides which edge is the lit one, so getting it backwards would show a render that
            # is a mirror of the device.
            return [(cx0 + x * ln * PPU, cy0 - y * wd * PPU) for x, y in pts]

        # Everything below is offset in BOARD space -- down the screen, where the light throws
        # things. Every car here is at zero heading, so board -Y is just -Y; on the board
        # `boardToLocal` rotates the same board-space offsets back through each car's heading.
        def raise_(pts, dy):
            return [(x, y + dy) for x, y in pts]

        # The shadow is thrown from the top face, which is already `lift` up.
        fill(to_px(ellipse(0, -throw / wd, 0.94, 1.02)), (0, 0, 0), SHADOW_ALPHA)

        for pts, col in under:
            fill(to_px(raise_(pts, lift)), col)

        # The roof: each ring's vertices lit from their own tilted normal, then interpolated
        # across the bands between them. Bands and crown together tile the roof exactly, so they
        # go through one accumulator and are composited once (see Roof).
        roof = Roof()
        shaded = []
        for ring in rings:
            lean = math.sin(math.radians(ring['tilt']))
            up = math.cos(math.radians(ring['tilt']))
            shaded.append((to_px(raise_(ring['pts'], lift)),
                           [lit(ring['c'], (o[0] * lean, o[1] * lean, up), ln, wd)
                            for o in outwards(ring['pts'])]))
        for i in range(len(shaded) - 1):
            (pa, ca), (pb, cb) = shaded[i], shaded[i + 1]
            n = len(pa)
            for j in range(n):
                k = (j + 1) % n
                roof.tri((pa[j], pa[k], pb[j]), (ca[j], ca[k], cb[j]))
                roof.tri((pa[k], pb[k], pb[j]), (ca[k], cb[k], cb[j]))
        crown, flat = shaded[-1][0], lit(rings[-1]['c'], (0, 0, 1), ln, wd)
        for j in range(1, len(crown) - 1):
            roof.tri((crown[0], crown[j], crown[j + 1]), (flat, flat, flat))
        roof.composite()

        for pts, col in over:
            fill(to_px(raise_(pts, lift)), lit(col, (0, 0, 1), ln, wd))
        print(f'{name}: {ln} x {wd}')
        y0 += ch

    raw = b''.join(b'\x00' + b''.join(bytes(c) for c in row) for row in buf)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    with open(out_path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    print(f'wrote {w}x{h} -> {out_path}')
    print(f'{len(under)} under + {len(rings)} roof rings + {len(over)} over, from {MESH}')
    print(f'light {tuple(round(v, 3) for v in LIGHT)}, ambient {AMBIENT}, '
          f'shadow throw {throw:.3f} world units')


render(sys.argv[1] if len(sys.argv) > 1 else '.tmp/car-plan.png')
