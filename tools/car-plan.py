#!/usr/bin/env python3
"""Render the drawn car AS THE TILTED BOARD SHOWS IT: roof, side wall, wheels and shadow.

WHY THIS EXISTS. The camera is orthographic, so a car is its roof plus however much of its side
the board's tilt reveals -- and nothing else. That cannot be judged from a phone screenshot;
several rounds of tuning the car's look from one got it wrong every time, and the round that
finally forced this tool into existence was four attempts at a FAKE side wall, every one of them
shipped blind. Nothing else in the project can show what a car will look like.

It reads its numbers OUT OF the source -- the design from `car-mesh.ts`, the tilt and the shadow
lift from `GameController.ts` and `car-builder.ts`, the key light's pitch from `environment.ts`,
the three body sizes from core's `CAP_BOX` -- so the picture cannot drift from the code. If a
piece is added or reordered in `car-mesh.ts`, `triangles()` below has to follow: the constants
cannot drift, but the STACK can.

WHAT TO TRUST. The projection and the depth sorting are exact -- the same orthographic tilt the
camera applies, so the silhouette, how much wall shows, and what occludes what are all real. The
LIGHTING is Lambert against the key light's true direction, normalised so a roof-facing plate
comes out as authored; trust it on which faces are light and dark and by roughly how much, but
not on exact colour, since the engine runs a full PBR pass with its own exposure and rolls off a
highlight this clips.

    python tools/car-plan.py [out.png]      default: .tmp/car-plan.png
"""

import math
import re
import struct
import sys
import zlib

MESH = 'game/assets/scripts/view/car-mesh.ts'
BUILDER = 'game/assets/scripts/view/car-builder.ts'
CTRL = 'game/assets/scripts/view/board-layout.ts'
ENV = 'game/assets/scripts/view/environment.ts'
TYPES = 'game/assets/scripts/core/types.ts'
CAR = (244, 67, 72)                 # COLORS.red, the busiest colour on a board
BG = (222, 226, 232)
SHADOW_ALPHA = 45 / 255             # blob-shadow.ts's mainColor alpha
PPU, PAD, SS = 240, 0.20, 2         # SS supersamples the whole frame, then it is box-filtered

# How much of a fully-lit surface's light is ambient, read out of `setupEnvironment` rather than
# fitted, so it tracks the scene. It is a ROUGH stand-in -- the hemisphere ambient and the key
# light reach albedo through different BRDF terms -- but it is the number that decides how dark
# an unlit face goes, and having it sourced beats having it guessed.


def numbers(path, needed):
    """Every `const NAME = <number>;` in a source file, checked for the ones we depend on."""
    with open(path, encoding='utf-8') as f:
        t = f.read()
    nums = {n: float(v) for n, v in
            re.findall(r'^(?:export )?const ([A-Z][A-Z0-9_]*)(?::\s*\w+)? = (-?[0-9.]+);',
                       t, re.M)}
    missing = [k for k in needed if k not in nums]
    if missing:
        raise SystemExit(f'{path} is missing {missing} -- renamed?')
    return nums, t


def illuminances():
    """The key light's illuminance and the hemisphere ambient's, from `setupEnvironment`."""
    with open(ENV, encoding='utf-8') as f:
        s = f.read()
    key = re.search(r'illuminance\s*=\s*(\d+)', s)
    amb = re.search(r'skyIllum\s*=\s*(\d+)', s)
    if not key or not amb:
        raise SystemExit(f'could not read illuminance/skyIllum out of {ENV}')
    return float(key.group(1)), float(amb.group(1))


def constants():
    needed = ('BODY_ALONG', 'BODY_ACROSS', 'BODY_CORNER', 'REFERENCE_ASPECT', 'CORNER_SEGMENTS',
              'EDGE_GROW_ALONG', 'EDGE_GROW_ACROSS', 'EDGE_SHADE', 'DOME_NARROW', 'DOME_RISE',
              'CAR_HEIGHT', 'WALL_FOOT', 'WHEEL_Z', 'Z_STEP',
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
    k.update(numbers(CTRL, ('BOARD_TILT',))[0])
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

TILT = math.radians(K['BOARD_TILT'])
TILT_SIN, TILT_COS = math.sin(TILT), math.cos(TILT)

KEY_LUX, AMB_LUX = illuminances()
AMBIENT = AMB_LUX / (AMB_LUX + KEY_LUX)

# The key light, as a direction TOWARD it. `setupEnvironment` turns the light node by euler
# (pitch, 0, 0) and a DirectionalLight shines along its forward (-Z), giving
# (0, -sin|pitch|, -cos|pitch|) in WORLD space; this is the negation of that.
_p = math.radians(-K['KEY_LIGHT_PITCH_DEG'])
LIGHT_WORLD = (0.0, math.sin(_p), math.cos(_p))

# AND THEN INTO BOARD SPACE, which an earlier version of this file got wrong. The light is a
# scene node, so tilting the board does not move it -- but every normal here is in BOARD
# coordinates, and dotting a board normal with a world light is meaningless. The board is turned
# by -tilt about X, so a world vector reaches board coordinates through the inverse, Rx(+tilt).
#
# This is not a detail: it is the entire reason a roof gets brighter when the board tips. In
# board space the light's z component is cos(pitch - tilt), so a roof-facing plate goes from
# 0.574 at no tilt to 0.956 at 38 degrees. Missing it hid a 67% brightness change.
LIGHT = (0.0,
         LIGHT_WORLD[1] * TILT_COS - LIGHT_WORLD[2] * TILT_SIN,
         LIGHT_WORLD[1] * TILT_SIN + LIGHT_WORLD[2] * TILT_COS)
FLAT_TERM = AMBIENT + (1 - AMBIENT) * LIGHT[2]      # what a roof-facing plate receives


def lighten(c, t):
    return tuple(round(v + (255 - v) * t) for v in c)


def shade(c, f):
    return tuple(round(v * f) for v in c)


def lit(c, normal, ln, wd):
    """`c` as the engine would light it, normalised so a roof-facing plate comes out unchanged.

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


def ellipse(cx, cy, w, h, seg=48):
    return [(cx + math.cos(2 * math.pi * i / seg) * w / 2,
             cy + math.sin(2 * math.pi * i / seg) * h / 2) for i in range(seg)]


def triangles(ln, wd):
    """Every triangle of the car, mirroring `carMesh`'s stack, as (3 board verts, 3 colours).

    A board vert is (x, y, z): x and y in fractions of the car (they get multiplied by ln/wd on
    the way to the screen, exactly as the node's scale does), z in world units.
    """
    tris = []

    def flat(pts, z, col):
        c = lit(col, (0, 0, 1), ln, wd)
        for i in range(1, len(pts) - 1):
            tris.append((((pts[0][0], pts[0][1], z), (pts[i][0], pts[i][1], z),
                          (pts[i + 1][0], pts[i + 1][1], z)), (c, c, c)))

    def band(pts_a, za, ca, tilt_a, pts_b, zb, cb, tilt_b):
        """The band between two rings, mirroring `Plan.addBand` including its normals."""
        outs_a, outs_b = outwards(pts_a), outwards(pts_b)
        la, ua = math.sin(math.radians(tilt_a)), math.cos(math.radians(tilt_a))
        lb, ub = math.sin(math.radians(tilt_b)), math.cos(math.radians(tilt_b))
        col_a = [lit(ca, (o[0] * la, o[1] * la, ua), ln, wd) for o in outs_a]
        col_b = [lit(cb, (o[0] * lb, o[1] * lb, ub), ln, wd) for o in outs_b]
        n = len(pts_a)
        for i in range(n):
            j = (i + 1) % n
            ai = (pts_a[i][0], pts_a[i][1], za)
            aj = (pts_a[j][0], pts_a[j][1], za)
            bi = (pts_b[i][0], pts_b[i][1], zb)
            bj = (pts_b[j][0], pts_b[j][1], zb)
            tris.append(((ai, aj, bi), (col_a[i], col_a[j], col_b[i])))
            tris.append(((aj, bj, bi), (col_a[j], col_b[j], col_b[i])))

    rim = body_outline(K['EDGE_GROW_ALONG'], K['EDGE_GROW_ACROSS'])
    height = K['CAR_HEIGHT']

    # Wheels, low on the wall.
    for sx in (-1, 1):
        for sy in (-1, 1):
            flat(round_rect(sx * K['WHEEL_X'], sy * K['WHEEL_Y'],
                            K['WHEEL_W'], K['WHEEL_H'], K['WHEEL_R']), K['WHEEL_Z'], TYRE)

    # The wall: the rim extruded from the board up to the roof, normals flat and outward.
    band(rim, 0.0, shade(CAR, K['WALL_FOOT']), 90, rim, height, CAR, 90)
    flat(rim, height, shade(CAR, K['EDGE_SHADE']))

    # The roof.
    base = height + K['Z_STEP']
    rings = [(body_outline(1 - K['DOME_NARROW'] * K['ACROSS_TO_ALONG'] * at,
                           1 - K['DOME_NARROW'] * at),
              base + K['DOME_RISE'] * at, tilt) for at, tilt in PROFILE]
    for i in range(len(rings) - 1):
        pa, za, ta = rings[i]
        pb, zb, tb = rings[i + 1]
        band(pa, za, CAR, ta, pb, zb, CAR, tb)
    crown_pts, crown_z, _ = rings[-1]
    flat(crown_pts, crown_z, CAR)

    # Glass and arrow, on the crown.
    glass = shade(CAR, K['GLASS_KEEP'])
    over = [
        (round_rect(K['WINDSCREEN_X'], 0, K['WINDSCREEN_W'], K['WINDSCREEN_H'], K['WINDOW_R']),
         glass),
        (round_rect(K['REAR_WINDOW_X'], 0, K['REAR_WINDOW_W'], K['REAR_WINDOW_H'], K['WINDOW_R']),
         glass),
    ] + [(piece, (255, 255, 255)) for piece in arrow_pieces()]
    for i, (pts, col) in enumerate(over):
        flat(pts, crown_z + (i + 1) * K['Z_STEP'], col)
    return tris


def render(out_path):
    throw = K['SHADOW_LIFT'] * math.tan(math.radians(-K['KEY_LIGHT_PITCH_DEG']))
    # Each row is as tall as the car projects: its width foreshortened, plus the wall's rise.
    rows = [(name, ln, wd, wd * TILT_COS + K['CAR_HEIGHT'] * TILT_SIN + 2 * PAD)
            for name, ln, wd in CAPS]
    W = max(ln for _, ln, _ in CAPS) + 2 * PAD
    w, h = int(W * PPU), int(sum(r[3] for r in rows) * PPU)
    sw, sh = w * SS, h * SS
    ppu = PPU * SS

    # Supersampled colour and depth. Depth is world z after the board's rotation, so LARGER is
    # nearer the camera; -inf means nothing has been drawn there yet, which is also how the
    # shadow knows where it is allowed to land (see below).
    col = [BG] * (sw * sh)
    depth = [-1e9] * (sw * sh)

    def project(v, cx, cy, ln, wd):
        """A board vert to (pixel x, pixel y, depth). The board is tipped back about X."""
        x, y, z = v
        by = y * wd
        wy = by * TILT_COS + z * TILT_SIN          # up the screen
        wz = -by * TILT_SIN + z * TILT_COS         # toward the camera
        return (cx + x * ln * ppu, cy - wy * ppu, wz)

    def raster(p, c, alpha=1.0):
        """One triangle, depth-tested per sample. `alpha` under 1 only paints where nothing is."""
        (x1, y1, d1), (x2, y2, d2), (x3, y3, d3) = p
        den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        if abs(den) < 1e-9:
            return
        xa, xb = max(0, int(min(x1, x2, x3))), min(sw, int(max(x1, x2, x3)) + 2)
        ya, yb = max(0, int(min(y1, y2, y3))), min(sh, int(max(y1, y2, y3)) + 2)
        for yy in range(ya, yb):
            py = yy + 0.5
            row = yy * sw
            for xx in range(xa, xb):
                px = xx + 0.5
                a = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / den
                b = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / den
                g = 1 - a - b
                if a < 0 or b < 0 or g < 0:
                    continue
                d = a * d1 + b * d2 + g * d3
                i = row + xx
                if d <= depth[i]:
                    continue
                if alpha >= 1:
                    depth[i] = d
                    col[i] = (round(a * c[0][0] + b * c[1][0] + g * c[2][0]),
                              round(a * c[0][1] + b * c[1][1] + g * c[2][1]),
                              round(a * c[0][2] + b * c[1][2] + g * c[2][2]))
                elif depth[i] < -1e8:
                    # Transparent, and depth-tested but not depth-writing -- the same state
                    # `builtin-unlit` technique 1 uses, which is why a shadow never paints over
                    # a car in front of it.
                    o = col[i]
                    col[i] = tuple(round(o[j] + (c[0][j] - o[j]) * alpha) for j in range(3))

    y0 = 0.0
    for (name, ln, wd, ch) in rows:
        cx, cy = W / 2 * ppu, (y0 + ch / 2) * ppu
        # The contact shadow, on the board, thrown down-screen by the light. It goes down first
        # so the car's own depth values are all in front of it.
        sh_pts = ellipse(0, -throw / wd, 0.94, 1.02)
        black = ((0, 0, 0),) * 3
        for i in range(1, len(sh_pts) - 1):
            raster((project((sh_pts[0][0], sh_pts[0][1], -0.06), cx, cy, ln, wd),
                    project((sh_pts[i][0], sh_pts[i][1], -0.06), cx, cy, ln, wd),
                    project((sh_pts[i + 1][0], sh_pts[i + 1][1], -0.06), cx, cy, ln, wd)),
                   black, SHADOW_ALPHA)
        for verts, cols in triangles(ln, wd):
            raster(tuple(project(v, cx, cy, ln, wd) for v in verts), cols)
        print(f'{name}: {ln} x {wd}')
        y0 += ch

    # Box-filter the supersampled frame down.
    out = bytearray()
    n = SS * SS
    for yy in range(h):
        out.append(0)
        base = yy * SS * sw
        for xx in range(w):
            r = g = b = 0
            for sy in range(SS):
                i = base + sy * sw + xx * SS
                for sx in range(SS):
                    p = col[i + sx]
                    r += p[0]
                    g += p[1]
                    b += p[2]
            out += bytes((r // n, g // n, b // n))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    with open(out_path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(out), 9)) + chunk(b'IEND', b''))
    print(f'wrote {w}x{h} -> {out_path}')
    print(f'tilt {K["BOARD_TILT"]:.0f} deg, car height {K["CAR_HEIGHT"]:.2f} '
          f'-> {K["CAR_HEIGHT"] * TILT_SIN:.3f} world units of wall on screen')
    print(f'light board-space {tuple(round(v, 3) for v in LIGHT)} '
          f'(roof N.L {LIGHT[2]:.3f}), key {KEY_LUX:.0f} + ambient {AMB_LUX:.0f} '
          f'-> ambient fraction {AMBIENT:.2f}')
    print(f'a wall facing the viewer renders at '
          f'{AMBIENT / FLAT_TERM * 100:.0f}% of the roof; shadow throw {throw:.3f}')


render(sys.argv[1] if len(sys.argv) > 1 else '.tmp/car-plan.png')
