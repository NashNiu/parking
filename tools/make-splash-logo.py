"""
Draw the splash logo: a bus seen front on, inside a ring of waiting passengers.

A GENERATOR rather than a hand-made file, so the one binary this repo carries is explainable
and editable. It writes tools/splash/logo.png, which `patch-splash` copies into the build.

WHAT IT SAYS. The ring is the game: passengers queue round a carousel in same-colour clusters
and board the car in the middle. Four clusters of five, in the four car colours, so the mark
carries the mechanic rather than a generic parking sign -- which is what it replaces, a white
P on a blue plate that could have belonged to any of a hundred games.

The bus is FRONT ON, not top down the way the board draws its cars. A vehicle read at a
glance is a face -- windscreen, two lights, a bumper -- and the logo is looked at for a second
and a half. The board's camera is the board's business.

NO WORDMARK, because the game has no name yet ("先用占位，我以后再定"). This is a mark, and a
mark is complete on its own; when there is a name, it goes UNDER this, and the first screen
will fit the taller image the same way it fits this one.

The palette is the game's own -- the four car colours, the HUD's glass navy, the card's cream
white -- so the splash, the menu and the board are one family rather than three.

Sizing: the Cocos first screen fits the image to 18.5% of the canvas HEIGHT and keeps its
aspect ratio (`updateVertexBuffer` in the generated first-screen.js), so on a 2532-tall phone
this square lands at about 468px. 512 is drawn with a little room to spare rather than
upscaled.

No PIL here (it is not installed, and a build should not need it). PNG is a short format: a
signature, an IHDR, one zlib-compressed IDAT of filter-0 scanlines, an IEND. RGBA, with the
background left TRANSPARENT rather than filled with the splash's navy -- the shader paints
that colour behind it (`bgColor`), and a mark that carries its own background would have to be
re-cut every time that colour changed.

Coverage is supersampled 4x4 per pixel, the same trick `ui-shapes.ts` uses to get smooth edges
out of procedural shapes.
"""

import math
import os
import struct
import zlib

SIZE = 512
SS = 4  # supersampling per axis

RED = (232, 78, 74)
BLUE = (74, 150, 232)
GREEN = (112, 200, 92)
YELLOW = (240, 196, 64)
BODY = (252, 250, 246)
GLASS = (52, 74, 116)
CLUSTER = (RED, BLUE, GREEN, YELLOW)

# Every number below is a fraction of the image, measured from its centre, with y running UP.
# Fractions so the mark scales with SIZE; y up because the shapes are described the way they
# are seen, and the one place the texture's y-down order matters is the sampling loop.
RING_N = 20
RING_R = 0.375
RING_DOT = 0.088
# The bus. Its body is inset well inside the ring: at 0.155 x 0.170 its corners reach 0.230
# from the centre, 0.244 with the rim below, which leaves 0.087 of clear ground before a
# dot's inner edge at 0.331.
BUS_HX, BUS_HY, BUS_R = 0.155, 0.170, 0.050
# A dark rim around the body, drawn as a slightly larger box behind it. On the splash's navy
# it is barely an edge; on a LIGHT ground it is the whole outline, and a cream bus on white is
# otherwise an invisible bus. A mark gets pasted onto backgrounds nobody asked me about.
BUS_RIM = 0.010
GLASS_Y, GLASS_HX, GLASS_HY, GLASS_R = 0.062, 0.115, 0.058, 0.024
LAMP_X, LAMP_Y, LAMP_R = 0.100, -0.075, 0.029
BUMPER_Y, BUMPER_HX, BUMPER_HY, BUMPER_R = -0.130, 0.124, 0.022, 0.011


def rrect(px: float, py: float, hx: float, hy: float, r: float) -> float:
    """Signed distance to a rounded box centred on the origin, positive OUTSIDE."""
    qx, qy = abs(px) - hx + r, abs(py) - hy + r
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def box(px: float, py: float, hx: float, hy: float, r: float) -> float:
    """Positive INSIDE a rounded box."""
    return -rrect(px, py, hx, hy, r)


def layers() -> list:
    """(coverage, colour) back to front. Later layers paint over earlier ones."""
    out = []
    for i in range(RING_N):
        # First dot at twelve o'clock, going clockwise, five dots to a cluster at 18 degrees
        # apart: four blocks of colour, each covering a quadrant.
        a = math.pi / 2 - i * 2 * math.pi / RING_N
        cx, cy = RING_R * math.cos(a), RING_R * math.sin(a)
        colour = CLUSTER[(i * len(CLUSTER)) // RING_N]
        out.append((
            lambda x, y, cx=cx, cy=cy: RING_DOT / 2 - math.hypot(x - cx, y - cy),
            colour,
        ))
    out.append((
        lambda x, y: box(x, y, BUS_HX + BUS_RIM, BUS_HY + BUS_RIM, BUS_R + BUS_RIM), GLASS,
    ))
    out.append((lambda x, y: box(x, y, BUS_HX, BUS_HY, BUS_R), BODY))
    # A roof is left above the windscreen: glass running to the top edge reads as a slot.
    out.append((
        lambda x, y: box(x, y - GLASS_Y, GLASS_HX, GLASS_HY, GLASS_R), GLASS,
    ))
    out.append((
        lambda x, y: max(LAMP_R - math.hypot(x - LAMP_X, y - LAMP_Y),
                         LAMP_R - math.hypot(x + LAMP_X, y - LAMP_Y)),
        YELLOW,
    ))
    out.append((
        lambda x, y: box(x, y - BUMPER_Y, BUMPER_HX, BUMPER_HY, BUMPER_R), GLASS,
    ))
    return out


def sample(px: int, py: int, shapes: list) -> tuple:
    """
    One pixel, supersampled: the colour is the average of the samples that hit something and
    the alpha is the share of samples that did.

    Averaging colour over the COVERED samples only, not over all of them, is what keeps a
    curved edge from picking up a dark fringe -- a straight mean would blend each transparent
    sample's colour (nothing) into the result and darken the rim.
    """
    hits = 0
    acc = [0.0, 0.0, 0.0]
    for sy in range(SS):
        for sx in range(SS):
            x = (px + (sx + 0.5) / SS) / SIZE - 0.5
            y = 0.5 - (py + (sy + 0.5) / SS) / SIZE
            colour = None
            for cov, c in shapes:
                if cov(x, y) > 0:
                    colour = c
            if colour is None:
                continue
            hits += 1
            for k in range(3):
                acc[k] += colour[k]
    if hits == 0:
        return (0, 0, 0, 0)
    return (
        int(acc[0] / hits), int(acc[1] / hits), int(acc[2] / hits),
        round(255 * hits / (SS * SS)),
    )


def main() -> None:
    shapes = layers()
    rows = []
    for py in range(SIZE):
        row = bytearray()
        for px in range(SIZE):
            row += bytes(sample(px, py, shapes))
        rows.append(bytes(row))
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    # Colour type 6 is RGBA, bit depth 8.
    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )

    # From this file's location, not the cwd, so it can be run from anywhere.
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, 'tools', 'splash', 'logo.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(png)
    print(f'wrote {out} ({SIZE}x{SIZE}, {len(png)} bytes)')
    print('run `npm run splash` (or tools/preview.mjs) to put it into a build')


if __name__ == '__main__':
    main()
