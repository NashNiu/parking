#!/usr/bin/env python3
"""Render the car models' TOP-DOWN PLAN the way the game will draw them.

WHY THIS EXISTS. The camera is orthographic and looks at the board straight on, so a car IS
its plan and nothing else: every part hidden behind a higher one contributes nothing at all.
That cannot be judged from a phone screenshot -- four rounds of tuning the car's look from one
got it wrong every time -- and it is the only view that decides whether a car reads as a car.

It reads the shading and plan-shrink constants OUT OF car-builder.ts, so the picture cannot
drift from the code. Change them there, run this, look.

    python tools/car-plan.py [out.png]      default: .tmp/car-plan.png
"""

import json
import re
import struct
import sys
import zlib

CAR_COLOUR = (231, 76, 60)          # a game red, roughly colorOf('red')
BG = (222, 226, 232)
SRC = 'game/assets/scripts/view/car-builder.ts'
MODELS = ['game/assets/resources/models/car.glb',
          'game/assets/resources/models/bus.glb',
          'game/assets/resources/models/truck.glb']

CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
      5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def constants():
    """CABIN_LIFT, ROOF_LIFT_COLOUR, CHASSIS_SHADE and PLATE_SHRINK, read from the source."""
    with open(SRC, encoding='utf-8') as f:
        t = f.read()

    def num(name):
        m = re.search(name + r"\s*=\s*([0-9.]+)", t)
        if not m:
            raise SystemExit(f"{name} not found in {SRC} -- renamed?")
        return float(m.group(1))

    block = re.search(r"PLATE_SHRINK[^{]*\{(.*?)\n\};", t, re.S)
    if not block:
        raise SystemExit(f"PLATE_SHRINK not found in {SRC}")
    shrink = {}
    for name, along, across in re.findall(
            r"(\w+):\s*\{\s*along:\s*([0-9.]+),\s*across:\s*([0-9.]+)", block.group(1)):
        shrink[name] = (float(along), float(across))
    return num('CABIN_LIFT'), num('ROOF_LIFT_COLOUR'), num('CHASSIS_SHADE'), shrink


CABIN_LIFT, ROOF_LIFT, CHASSIS_SHADE, SHRINK = constants()


def srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def to255(v):
    return tuple(max(0, min(255, round(srgb(x) * 255))) for x in v[:3])


def lighten(c, t):
    return tuple(round(v + (255 - v) * t) for v in c)


def scale(c, f):
    return tuple(round(v * f) for v in c)


def read_glb(path):
    with open(path, 'rb') as f:
        d = f.read()
    off, js, bin_ = 12, None, None
    while off < len(d):
        ln, tag = struct.unpack_from('<I4s', d, off)
        off += 8
        if tag == b'JSON':
            js = json.loads(d[off:off + ln].decode('utf-8'))
        elif tag[:3] == b'BIN':
            bin_ = d[off:off + ln]
        off += ln + (-ln % 4)
    return js, bin_


def accessor(j, b, idx):
    a = j['accessors'][idx]
    bv = j['bufferViews'][a['bufferView']]
    fmt, size = CT[a['componentType']]
    n = NC[a['type']]
    stride = bv.get('byteStride') or size * n
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return [struct.unpack_from('<' + fmt * n, b, base + i * stride) for i in range(a['count'])]


def plate_of(node_name):
    n = node_name.lower()
    if 'arrow' in n:
        return 'arrow'
    if 'roof' in n:
        return 'roof'
    if 'cabin' in n:
        return 'cabin'
    if 'bumper' in n or 'sill' in n:
        return 'chassis'
    return None


def colour_of(node, mat):
    """Mirror recolorCar: plates shaded apart, arrow white, chassis dark, the rest as authored."""
    plate = plate_of(node)
    if mat.get('name') == 'paint':
        if plate == 'roof':
            return lighten(CAR_COLOUR, ROOF_LIFT)
        if plate == 'cabin':
            return lighten(CAR_COLOUR, CABIN_LIFT)
        return CAR_COLOUR
    if plate == 'arrow':
        return (255, 255, 255)
    if plate == 'chassis':
        return scale(CAR_COLOUR, CHASSIS_SHADE)
    bc = mat.get('pbrMetallicRoughness', {}).get('baseColorFactor')
    return to255(bc) if bc else (255, 255, 255)


def tris_of(path):
    """Every triangle as (mean height, three (x, y, z) points, colour), model space."""
    j, b = read_glb(path)
    out = []
    for n in j['nodes']:
        if n.get('mesh') is None:
            continue
        t = n.get('translation') or [0, 0, 0]
        s = list(n.get('scale') or [1, 1, 1])
        plate = plate_of(n['name'])
        if plate in SHRINK:
            s[0] *= SHRINK[plate][0]
            s[2] *= SHRINK[plate][1]
        for pr in j['meshes'][n['mesh']]['primitives']:
            pos = accessor(j, b, pr['attributes']['POSITION'])
            if 'indices' in pr:
                idx = [i[0] for i in accessor(j, b, pr['indices'])]
            else:
                idx = list(range(len(pos)))
            col = colour_of(n['name'], j['materials'][pr['material']])
            for k in range(0, len(idx) - 2, 3):
                v = [[pos[idx[k + m]][d] * s[d] + t[d] for d in range(3)] for m in range(3)]
                out.append((sum(p[1] for p in v) / 3, v, col))
    return out


def render(paths, ppu=200, pad=0.12, path_out='.tmp/car-plan.png'):
    cars = [tris_of(p) for p in paths]
    ext = []
    for c in cars:
        xs = [p[0] for _, v, _ in c for p in v]
        zs = [p[2] for _, v, _ in c for p in v]
        ext.append((min(xs), max(xs), min(zs), max(zs)))
    W = max(e[1] - e[0] for e in ext) + pad * 2
    Hs = [e[3] - e[2] + pad * 2 for e in ext]
    w, h = int(W * ppu), int(sum(Hs) * ppu)
    buf = [[BG] * w for _ in range(h)]
    depth = [[-1e9] * w for _ in range(h)]
    y0 = 0.0
    for car, e, ch in zip(cars, ext, Hs):
        cx, cz = (e[0] + e[1]) / 2, (e[2] + e[3]) / 2
        for ymid, v, col in car:
            px = [((p[0] - cx + W / 2) * ppu, (p[2] - cz + ch / 2 + y0) * ppu) for p in v]
            xa, xb = max(0, int(min(q[0] for q in px))), min(w, int(max(q[0] for q in px)) + 1)
            za, zb = max(0, int(min(q[1] for q in px))), min(h, int(max(q[1] for q in px)) + 1)
            (x1, y1), (x2, y2), (x3, y3) = px
            den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
            if abs(den) < 1e-9:
                continue
            for yy in range(za, zb):
                py = yy + 0.5
                for xx in range(xa, xb):
                    pxx = xx + 0.5
                    a = ((y2 - y3) * (pxx - x3) + (x3 - x2) * (py - y3)) / den
                    bb = ((y3 - y1) * (pxx - x3) + (x1 - x3) * (py - y3)) / den
                    if a < 0 or bb < 0 or 1 - a - bb < 0:
                        continue
                    if ymid > depth[yy][xx]:
                        depth[yy][xx] = ymid
                        buf[yy][xx] = col
        y0 += ch
    raw = b''.join(b'\x00' + b''.join(bytes(c) for c in row) for row in buf)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    with open(path_out, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    print(f'wrote {w}x{h} -> {path_out}')
    print(f'constants from {SRC}: cabin +{CABIN_LIFT} roof +{ROOF_LIFT} '
          f'chassis x{CHASSIS_SHADE} shrink={SHRINK}')


render(MODELS, path_out=sys.argv[1] if len(sys.argv) > 1 else '.tmp/car-plan.png')
