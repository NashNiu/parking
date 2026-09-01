#!/usr/bin/env python3
"""Render the drawn car's TOP-DOWN PLAN, the only view that decides whether it reads as a car.

WHY THIS EXISTS. The camera is orthographic and looks at the board straight on, so a car IS its
plan and nothing else. That cannot be judged from a phone screenshot -- four rounds of tuning
the car's look from one got it wrong every time -- and nothing else in the project can show it.

It reads the design constants OUT OF `car-mesh.ts` and the three body sizes out of core's
`CAP_BOX`, then rebuilds the same plate stack in the same order. Change a constant there, run
this, look. If a plate is added or reordered in `car-mesh.ts`, `plates()` below has to follow --
the constants cannot drift, but the STACK can, so keep the two lists side by side.

    python tools/car-plan.py [out.png]      default: .tmp/car-plan.png
"""

import math
import re
import struct
import sys
import zlib

MESH = 'game/assets/scripts/view/car-mesh.ts'
TYPES = 'game/assets/scripts/core/types.ts'
CAR = (244, 67, 72)                 # COLORS.red, the busiest colour on a board
BG = (222, 226, 232)
PPU, PAD, SS = 300, 0.13, 3


def constants():
    """Every `const NAME = <number>;` in car-mesh.ts, plus TYRE."""
    with open(MESH, encoding='utf-8') as f:
        t = f.read()
    nums = {n: float(v) for n, v in re.findall(r'^const ([A-Z][A-Z0-9_]*) = ([-0-9.]+);', t, re.M)}
    tyre = re.search(r'const TYRE = new Color\((\d+), (\d+), (\d+)', t)
    if not tyre:
        raise SystemExit(f'could not read TYRE out of {MESH}')
    missing = [k for k in ('BODY_ALONG', 'BODY_ACROSS', 'BODY_CORNER', 'REFERENCE_ASPECT')
               if k not in nums]
    if missing:
        raise SystemExit(f'{MESH} is missing {missing} -- renamed?')
    return nums, tuple(int(g) for g in tyre.groups())


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


K, TYRE = constants()
CAPS = caps()


def lighten(c, t):
    return tuple(round(v + (255 - v) * t) for v in c)


def shade(c, f):
    return tuple(round(v * f) for v in c)



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

def arrow_pieces():
    hw, hh = K['ARROW_W'] / 2, K['ARROW_H'] / 2
    shaft = hh * K['ARROW_SHAFT']
    base = K['ARROW_X'] + hw - K['ARROW_W'] * K['ARROW_HEAD']
    return [
        [(K['ARROW_X'] - hw, -shaft), (base, -shaft), (base, shaft), (K['ARROW_X'] - hw, shaft)],
        [(base, -hh), (K['ARROW_X'] + hw, 0), (base, hh)],
    ]


def plates():
    """The same stack as `plates()` in car-mesh.ts, bottom to top."""
    out = [(body_outline(K['EDGE_GROW_ALONG'], K['EDGE_GROW_ACROSS']), shade(CAR, K['EDGE_SHADE']))]
    for sx in (-1, 1):
        for sy in (-1, 1):
            out.append((round_rect(sx * K['WHEEL_X'], sy * K['WHEEL_Y'],
                                   K['WHEEL_W'], K['WHEEL_H'], K['WHEEL_R']), TYRE))
    out.append((body_outline(1, 1), CAR))
    top = CAR
    for i in range(1, int(K['BEVEL']) + 1):
        t = i / K['BEVEL']
        top = lighten(CAR, K['BEVEL_LIFT'] * i)
        out.append((body_outline(1 - K['BEVEL_SHORTEN'] * t, 1 - K['BEVEL_NARROW'] * t), top))
    glass = shade(top, K['GLASS_KEEP'])
    out.append((round_rect(K['WINDSCREEN_X'], 0, K['WINDSCREEN_W'],
                           K['WINDSCREEN_H'], K['WINDOW_R']), glass))
    out.append((round_rect(K['REAR_WINDOW_X'], 0, K['REAR_WINDOW_W'],
                           K['REAR_WINDOW_H'], K['WINDOW_R']), glass))
    for piece in arrow_pieces():
        out.append((piece, (255, 255, 255)))
    return out


def render(out_path):
    W = max(c[1] for c in CAPS) + PAD * 2
    Hs = [c[2] + PAD * 2 for c in CAPS]
    w, h = int(W * PPU), int(sum(Hs) * PPU)
    buf = [[BG] * w for _ in range(h)]

    def fill(pts, col):
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
                if not n:
                    continue
                a = n / (SS * SS)
                o = buf[yy][xx]
                buf[yy][xx] = tuple(round(o[i] + (col[i] - o[i]) * a) for i in range(3))

    stack = plates()
    y0 = 0.0
    for (name, ln, wd), ch in zip(CAPS, Hs):
        cx0, cy0 = W / 2 * PPU, (y0 + ch / 2) * PPU
        for pts, col in stack:
            fill([(cx0 + x * ln * PPU, cy0 + y * wd * PPU) for x, y in pts], col)
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
    print(f'{len(stack)} plates, constants from {MESH}')


render(sys.argv[1] if len(sys.argv) > 1 else '.tmp/car-plan.png')
