"""
Draw the placeholder splash logo: a white parking P on a rounded blue plate.

A GENERATOR rather than a hand-made file, so the one binary this repo carries is explainable
and editable. It writes tools/splash/logo.png, which `patch-splash` copies into the build.

IT IS A PLACEHOLDER. The real artwork should replace tools/splash/logo.png -- any size, any
aspect; the Cocos first screen fits the image to 18.5% of the canvas height and keeps its
aspect ratio (see `updateVertexBuffer` in the generated first-screen.js). Nothing else needs
changing when it does.

The palette is the game's own: the plate is the blue of the home screen's level chips, so the
logo, the menu and the board are one family rather than three.

No PIL here (it is not installed, and a build should not need it). PNG is a short format: a
signature, an IHDR, one zlib-compressed IDAT of filter-0 scanlines, an IEND. Coverage is
supersampled 4x4 per pixel, the same trick `ui-shapes.ts` uses to get smooth edges out of
procedural shapes.
"""

import math
import os
import struct
import zlib

SIZE = 256
SS = 4  # supersampling per axis

PLATE = (74, 144, 226)
INK = (255, 255, 255)

# All shape numbers are fractions of the plate, so the whole mark scales with SIZE.
PLATE_R = 0.22        # corner radius
# The letter, at the size it was first drawn, then multiplied by LETTER. At 1.0 the stem's
# top ran into the plate's rounded corner and the bowl reached its right edge -- a mark with
# no air around it reads as a crop rather than a logo.
LETTER = 0.8
STEM_X0, STEM_X1 = -0.30 * LETTER, -0.13 * LETTER
STEM_Y0, STEM_Y1 = -0.44 * LETTER, 0.44 * LETTER
BOWL_CX, BOWL_CY = -0.055 * LETTER, 0.20 * LETTER
BOWL_OUTER, BOWL_INNER = 0.295 * LETTER, 0.135 * LETTER


def rounded_rect(x: float, y: float, half: float, r: float) -> bool:
    """Inside a square of half-width `half` centred on the origin, with corner radius `r`."""
    ax, ay = abs(x), abs(y)
    if ax > half or ay > half:
        return False
    cx, cy = half - r, half - r
    if ax <= cx or ay <= cy:
        return True
    return (ax - cx) ** 2 + (ay - cy) ** 2 <= r * r


def letter_p(x: float, y: float) -> bool:
    """The stem, plus the right-hand part of an annulus: a P without a serif in sight."""
    if STEM_X0 <= x <= STEM_X1 and STEM_Y0 <= y <= STEM_Y1:
        return True
    d = math.hypot(x - BOWL_CX, y - BOWL_CY)
    return BOWL_INNER <= d <= BOWL_OUTER and x >= STEM_X0


def sample(px: int, py: int) -> tuple:
    """One pixel, supersampled: returns RGBA."""
    plate_hits = 0
    ink_hits = 0
    for sy in range(SS):
        for sx in range(SS):
            # -0.5..0.5 across the image, y up.
            x = (px + (sx + 0.5) / SS) / SIZE - 0.5
            y = 0.5 - (py + (sy + 0.5) / SS) / SIZE
            if rounded_rect(x, y, 0.5, PLATE_R):
                plate_hits += 1
                if letter_p(x, y):
                    ink_hits += 1
    total = SS * SS
    if plate_hits == 0:
        return (0, 0, 0, 0)
    alpha = round(255 * plate_hits / total)
    # Ink coverage is measured against the PLATE, not the pixel: on the plate's own edge the
    # two blend against each other and only then fade out together.
    t = ink_hits / plate_hits
    rgb = tuple(round(PLATE[i] + (INK[i] - PLATE[i]) * t) for i in range(3))
    return (rgb[0], rgb[1], rgb[2], alpha)


def main() -> None:
    rows = []
    for py in range(SIZE):
        row = bytearray([0])  # filter type 0
        for px in range(SIZE):
            row.extend(sample(px, py))
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'splash', 'logo.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(png)
    print(f'{out}  {SIZE}x{SIZE}  {len(png)} bytes')


if __name__ == '__main__':
    main()
