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
PALETTE = 'game/assets/scripts/view/colors.ts'
BUILDER = 'game/assets/scripts/view/shadow.ts'
CTRL = 'game/assets/scripts/view/board-layout.ts'
ENV = 'game/assets/scripts/view/environment.ts'
TYPES = 'game/assets/scripts/core/types.ts'
CAR = (244, 67, 72)                 # COLORS.red, the busiest colour on a board -- see `--color`
BG = (222, 226, 232)
SHADOW_ALPHA = 45 / 255             # blob-shadow.ts's mainColor alpha
PPU, PAD, SS = 240, 0.20, 2         # SS supersamples the whole frame, then it is box-filtered
PLAY_PPU = 40                       # about what a portrait phone gives the board -- see `--play`
NO_ARROW = False                    # set from `--no-arrow` below; see the note in `triangles`

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
    needed = ('BODY_ALONG', 'BODY_ACROSS', 'CORNER_NOSE', 'CORNER_TAIL', 'CORNER_SEGMENTS',
              'EDGE_GROW_ALONG', 'EDGE_GROW_ACROSS', 'DOME_NARROW', 'DOME_RISE',
              'CAR_HEIGHT', 'WALL_LIFT', 'WALL_FOOT', 'WHEEL_Z', 'Z_STEP',
              'WHEEL_X', 'WHEEL_Y', 'WHEEL_W', 'WHEEL_H', 'WHEEL_R',
              'BUS_WHEEL_X_FRONT', 'BUS_WHEEL_X_REAR', 'BUS_WHEEL_REAR_HALF_GAP', 'BUS_WHEEL_W',
              'GLASS_LOW', 'GLASS_HIGH', 'GLASS_OUT', 'GLASS_SHADE',
              'OUTLINE_L_DROP', 'OUTLINE_S_GAIN', 'SKIRT_TOP',
              'SCREEN_LEN', 'SCREEN_SHADE',
              'TAIL_X', 'TAIL_Y', 'TAIL_W', 'TAIL_H', 'TAIL_R',
              'TRIM_LAYER', 'ARROW_BACK_LAYER', 'ARROW_LAYER',
              'ARROW_X', 'ARROW_W', 'ARROW_H', 'ARROW_SHAFT', 'ARROW_HEAD', 'ARROW_OUTLINE')
    k, t = numbers(MESH, needed)
    tyre = re.search(r'const TYRE = new Color\((\d+), (\d+), (\d+)', t)
    if not tyre:
        raise SystemExit(f'could not read TYRE out of {MESH}')
    lamp = re.search(r'const TAILLIGHT = new Color\((\d+), (\d+), (\d+)', t)
    if not lamp:
        raise SystemExit(f'could not read TAILLIGHT out of {MESH}')
    globals()['TAILLIGHT'] = tuple(int(g) for g in lamp.groups())
    block = re.search(r'DOME_PROFILE[^=]*=\s*\[(.*?)\];', t, re.S)
    if not block:
        raise SystemExit(f'DOME_PROFILE not found in {MESH}')
    profile = [(float(a), float(d)) for a, d in
               re.findall(r'at:\s*([0-9.]+),\s*tilt:\s*([0-9.]+)', block.group(1))]
    if len(profile) < 2:
        raise SystemExit(f'DOME_PROFILE in {MESH} needs at least two rings')
    with open(BUILDER, encoding='utf-8') as f:
        lift = re.search(r'contact:\s*(-?[0-9.]+)', f.read())
    if not lift:
        raise SystemExit(f'LIFT.contact not found in {BUILDER}')
    k['SHADOW_LIFT'] = float(lift.group(1))
    k.update(numbers(CTRL, ('BOARD_TILT',))[0])
    k.update(numbers(ENV, ('KEY_LIGHT_PITCH_DEG',))[0])
    # The medium car's aspect, exactly as car-mesh.ts derives REFERENCE_ASPECT from CAP_BOX.
    med = next(wd for name, ln, wd in CAPS if name == 'medium')
    k['REFERENCE_ASPECT'] = next(ln for name, ln, _ in CAPS if name == 'medium') / med
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


# CAPS first: `constants` derives REFERENCE_ASPECT from the medium car's box.
CAPS = caps()
K, TYRE, PROFILE = constants()

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


def round_rect(cx, cy, w, h, r, r_tail=None):
    """Mirror of `roundRect` in car-mesh.ts, anisotropic radius and segment count included.

    `r_tail` is the -X end's radius and defaults to `r`, exactly as the TypeScript does, so the
    symmetric callers are unaffected by the body's two ends being allowed to differ.
    """
    if r_tail is None:
        r_tail = r
    hw, hh = w / 2, h / 2
    a_ref = K['REFERENCE_ASPECT']
    minor = min(w * a_ref, h)

    def radii(f):
        world = f * minor
        return min(world / a_ref, hw), min(world, hh)

    nrx, nry = radii(r)
    trx, trry = radii(r_tail)
    seg = int(K['CORNER_SEGMENTS'])
    corners = [(hw - nrx, -(hh - nry), nrx, nry),
               (hw - nrx, hh - nry, nrx, nry),
               (-(hw - trx), hh - trry, trx, trry),
               (-(hw - trx), -(hh - trry), trx, trry)]
    pts = []
    for c, (ox, oy, rx, ry) in enumerate(corners):
        start = -math.pi / 2 + c * (math.pi / 2)
        for s in range(seg + 1):
            a = start + (s / seg) * (math.pi / 2)
            pts.append((cx + ox + math.cos(a) * rx, cy + oy + math.sin(a) * ry))
    return pts


def body_outline(along, across):
    return round_rect(0, 0, K['BODY_ALONG'] * along, K['BODY_ACROSS'] * across,
                      K['CORNER_NOSE'], K['CORNER_TAIL'])


def outline_of(c):
    """Mirror of `outlineOf` in car-mesh.ts: the body colour at L-20%, S+10% in HSL."""
    r, g, b = (v / 255 for v in c)
    hi, lo = max(r, g, b), min(r, g, b)
    l = (hi + lo) / 2
    d = hi - lo
    h = s = 0.0
    if d > 1e-6:
        s = d / (2 - hi - lo) if l > 0.5 else d / (hi + lo)
        if hi == r:
            h = ((g - b) / d + (6 if g < b else 0)) / 6
        elif hi == g:
            h = ((b - r) / d + 2) / 6
        else:
            h = ((r - g) / d + 4) / 6
    s = min(1.0, s * (1 + K['OUTLINE_S_GAIN']))
    l = l * (1 - K['OUTLINE_L_DROP'])
    q = l * (1 + s) if l < 0.5 else l + s - l * s
    pp = 2 * l - q

    def channel(t):
        x = t % 1.0
        if x < 1 / 6:
            return pp + (q - pp) * 6 * x
        if x < 1 / 2:
            return q
        if x < 2 / 3:
            return pp + (q - pp) * (2 / 3 - x) * 6
        return pp

    return tuple(round(max(0.0, min(1.0, channel(t))) * 255) for t in (h + 1 / 3, h, h - 1 / 3))


def clip_min_x(pts, x0):
    """Mirror of `clipMinX` in car-mesh.ts: the convex polygon at or in front of x0."""
    out = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        a_in, b_in = a[0] >= x0, b[0] >= x0
        if a_in:
            out.append(a)
        if a_in != b_in:
            t = (x0 - a[0]) / (b[0] - a[0])
            out.append((x0, a[1] + (b[1] - a[1]) * t))
    return out


def windscreen_band(crown):
    """Mirror of `windscreenBand` in car-mesh.ts: the nose SCREEN_LEN of the crown outline."""
    return clip_min_x(crown, max(p[0] for p in crown) - K['SCREEN_LEN'])


def grow(pts, d):
    """Mirror of `grow` in car-mesh.ts: the polygon pushed out along its own plan normals."""
    out = outwards(pts)
    a_ref = K['REFERENCE_ASPECT']
    return [(pt[0] + o[0] * d / a_ref, pt[1] + o[1] * d) for pt, o in zip(pts, out)]


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


def axles(cap):
    """Mirrors `axles` in car-mesh.ts: the wheel offsets along one side, and their width."""
    if cap == 'big':
        return ([K['BUS_WHEEL_X_FRONT'],
                 K['BUS_WHEEL_X_REAR'] + K['BUS_WHEEL_REAR_HALF_GAP'],
                 K['BUS_WHEEL_X_REAR'] - K['BUS_WHEEL_REAR_HALF_GAP']], K['BUS_WHEEL_W'])
    return ([K['WHEEL_X'], -K['WHEEL_X']], K['WHEEL_W'])


def triangles(ln, wd, cap):
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

    # Wheels, low on the wall. How many depends on the capacity -- see `axles`.
    xs, ww = axles(cap)
    for x in xs:
        for sy in (-1, 1):
            flat(round_rect(x, sy * K['WHEEL_Y'],
                            ww, K['WHEEL_H'], K['WHEEL_R']), K['WHEEL_Z'], TYRE)

    # The wall: the rim extruded from the board up to the roof, normals flat and outward, with
    # the outline ink taking its bottom SKIRT_TOP as a contact edge.
    wall = lighten(CAR, K['WALL_LIFT'])
    ink = outline_of(CAR)
    skirt_top = height * K['SKIRT_TOP']
    band(rim, 0.0, ink, 90, rim, skirt_top, ink, 90)
    band(rim, skirt_top, shade(wall, K['WALL_FOOT']), 90, rim, height, wall, 90)

    # The window band, on the same outline grown just enough not to z-fight the wall.
    gp = body_outline(K['EDGE_GROW_ALONG'] * K['GLASS_OUT'],
                      K['EDGE_GROW_ACROSS'] * K['GLASS_OUT'])
    gc = shade(CAR, K['GLASS_SHADE'])
    band(gp, height * K['GLASS_LOW'], gc, 90, gp, height * K['GLASS_HIGH'], gc, 90)

    # The roof. Its outermost ring sits ON the silhouette, at the wall's top edge -- there is
    # no rim lip between them any more.
    rings = [(body_outline(K['EDGE_GROW_ALONG'] - K['DOME_NARROW'] * K['ACROSS_TO_ALONG'] * at,
                           K['EDGE_GROW_ACROSS'] - K['DOME_NARROW'] * at),
              height + K['DOME_RISE'] * at, tilt) for at, tilt in PROFILE]
    for i in range(len(rings) - 1):
        pa, za, ta = rings[i]
        pb, zb, tb = rings[i + 1]
        band(pa, za, CAR, ta, pb, zb, CAR, tb)
    crown_pts, crown_z, _ = rings[-1]
    flat(crown_pts, crown_z, CAR)

    # The trim and the arrow, on the crown. Each plate carries the LAYER it sits on rather than
    # its index in this list -- see the `Plate` note in car-mesh.ts.
    trim, back, front = K['TRIM_LAYER'], K['ARROW_BACK_LAYER'], K['ARROW_LAYER']
    over = [
        (windscreen_band(crown_pts), shade(CAR, K['SCREEN_SHADE']), trim),
        (round_rect(K['TAIL_X'], K['TAIL_Y'], K['TAIL_W'], K['TAIL_H'], K['TAIL_R']),
         TAILLIGHT, trim),
        (round_rect(K['TAIL_X'], -K['TAIL_Y'], K['TAIL_W'], K['TAIL_H'], K['TAIL_R']),
         TAILLIGHT, trim),
    ]
    # `--no-arrow` leaves the arrow and its backing off, which is not a debugging convenience:
    # the car is REQUIRED to say which way it is pointing without them ("遮住箭头也能一眼看出车
    # 朝哪边"), and that is a claim about the windscreen and the tail lights alone. Rendering it
    # with the arrow on cannot test it -- the arrow answers the question before the eye gets to
    # anything else. This is the acceptance criterion, run rather than eyeballed.
    if not NO_ARROW:
        over += [(grow(piece, K['ARROW_OUTLINE']), ink, back) for piece in arrow_pieces()]
        over += [(piece, (255, 255, 255), front) for piece in arrow_pieces()]
    for pts, col, layer in over:
        flat(pts, crown_z + layer * K['Z_STEP'], col)
    return tris


def render(out_path):
    # Board space, like `addShadow`: tan(pitch - tilt), which flips sign when the light crosses
    # to the near side of the board.
    throw = K['SHADOW_LIFT'] * math.tan(
        math.radians(-K['KEY_LIGHT_PITCH_DEG'] - K['BOARD_TILT']))
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
        for verts, cols in triangles(ln, wd, name):
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
    # Every face's brightness against the roof's, because reading them off the picture is how
    # the glass band got blamed on the wall. Taken on the medium car.
    def lum(c):
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    roof = lum(lit(CAR, (0, 0, 1), 1.772, 0.567))
    faces = [
        ('near wall, top', lit(lighten(CAR, K['WALL_LIFT']), (0, -1, 0), 1.772, 0.567)),
        ('near wall, foot',
         lit(shade(lighten(CAR, K['WALL_LIFT']), K['WALL_FOOT']), (0, -1, 0), 1.772, 0.567)),
        ('glass band', lit(shade(CAR, K['GLASS_SHADE']), (0, -1, 0), 1.772, 0.567)),
        ('nose/tail wall', lit(CAR, (1, 0, 0), 1.772, 0.567)),
    ]
    print('against the roof: ' + ', '.join(
        f'{n} {lum(c) / roof * 100:.0f}%' for n, c in faces)
        + f"; glass covers {(K['GLASS_HIGH'] - K['GLASS_LOW']) * 100:.0f}% of the wall")
    print(f'shadow throw {throw:.3f} (negative = up-screen, behind the car)')


def palette():
    """The play colours, read out of `colors.ts` so this cannot drift from the game's."""
    with open(PALETTE, encoding='utf-8') as f:
        body = re.search(r'export const COLORS[^{]*\{(.*?)\n\};', f.read(), re.S)
    if not body:
        raise SystemExit(f'could not find COLORS in {PALETTE}')
    return {n: (int(r), int(g), int(b)) for n, r, g, b in
            re.findall(r'(\w+):\s*new Color\((\d+),\s*(\d+),\s*(\d+)\)', body.group(1))}


# `--color NAME` swaps the body colour for another of the play palette's. RED IS THE DEFAULT AND
# NOT AN ARBITRARY ONE -- it is the busiest colour on a board -- but it is also the EASIEST, and
# that matters for anything judged by contrast against the paint: the outline ink and the arrow
# were both reported as weak on YELLOW and CYAN, which are the palette's two lightest colours,
# and a change tuned on red alone will pass on red alone. Judge those two before shipping.
args = [a for a in sys.argv[1:]]
NO_ARROW = '--no-arrow' in args
if NO_ARROW:
    args.remove('--no-arrow')
# `--play` renders at the size the game actually plays at, and it exists because TWO rounds of
# head/tail marking passed the big render and failed on a device. At 240 pixels per world unit a
# medium car is 390 pixels long and every detail on it reads; on a phone it is about forty, and
# anything under two pixels is averaged away by the antialiaser. The big render is still the only
# way to judge SHAPE -- use both, and believe this one about whether a cue survives.
if '--play' in args:
    PPU, SS = PLAY_PPU, 4
    args.remove('--play')
if '--color' in args:
    i = args.index('--color')
    name = args[i + 1]
    pal = palette()
    if name not in pal:
        raise SystemExit(f'--color {name}: pick one of {", ".join(pal)}')
    CAR = pal[name]
    del args[i:i + 2]

render(args[0] if args else '.tmp/car-plan.png')
