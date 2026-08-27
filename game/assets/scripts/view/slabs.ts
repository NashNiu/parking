import { Color, Mesh, MeshRenderer, Node, utils } from 'cc';
import { flatMaterial, alphaMaterial } from './materials';

/** One primitive geometry, in the shape `utils.createMesh` and `mergeParts` both take. */
export interface MeshPart {
    positions: number[];
    normals?: number[];
    uvs?: number[];
    indices?: number[];
}

/** Merge several geometries into one mesh, i.e. one draw call for the lot. */
export function mergeParts(parts: MeshPart[]): Mesh {
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    let base = 0;
    for (const g of parts) {
        const vc = g.positions.length / 3;
        for (let i = 0; i < vc; i++) {
            positions.push(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
            if (g.normals) normals.push(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]);
            if (g.uvs) uvs.push(g.uvs[i * 2], g.uvs[i * 2 + 1]);
        }
        for (const ii of (g.indices || [])) indices.push(ii + base);
        base += vc;
    }
    return utils.createMesh({ positions, normals, uvs, indices });
}

/** Segments per rounded corner. Four is plenty at the size these slabs are drawn. */
const CORNER_SEG = 4;

/** The outline of a rounded rect, counter-clockwise from the bottom-right corner. */
function outline(w: number, h: number, r: number): [number, number][] {
    const hw = w / 2, hh = h / 2;
    const rad = Math.max(0, Math.min(r, hw, hh));
    if (rad < 1e-4) return [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
    const corners: [number, number, number][] = [
        [hw - rad, -(hh - rad), -Math.PI / 2],
        [hw - rad, hh - rad, 0],
        [-(hw - rad), hh - rad, Math.PI / 2],
        [-(hw - rad), -(hh - rad), Math.PI],
    ];
    const pts: [number, number][] = [];
    for (const [cx, cy, a0] of corners) {
        for (let i = 0; i <= CORNER_SEG; i++) {
            const a = a0 + (Math.PI / 2) * (i / CORNER_SEG);
            pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
        }
    }
    return pts;
}

/**
 * A rounded-cornered slab `w` x `h` x `d`, centred on (`ox`, `oy`, 0): two triangle
 * fans for the faces and a quad per outline edge for the rim. Returned as a part so a
 * caller can merge several into one mesh.
 *
 * Every ground panel in the scene is one of these. The corner radius is the single
 * biggest thing separating a screen built out of `primitives.box` from one that looks
 * authored, and it costs about 80 triangles per panel.
 */
export function roundedSlabPart(
    w: number, h: number, d: number, r: number, ox = 0, oy = 0,
): MeshPart {
    const pts = outline(w, h, r);
    const n = pts.length;
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number): void => {
        positions.push(ox + x, oy + y, z);
        normals.push(nx, ny, nz);
        uvs.push(x / w + 0.5, y / h + 0.5);
    };

    const front = positions.length / 3;
    put(0, 0, d / 2, 0, 0, 1);
    for (const [x, y] of pts) put(x, y, d / 2, 0, 0, 1);
    for (let i = 0; i < n; i++) indices.push(front, front + 1 + i, front + 1 + (i + 1) % n);

    const back = positions.length / 3;
    put(0, 0, -d / 2, 0, 0, -1);
    for (const [x, y] of pts) put(x, y, -d / 2, 0, 0, -1);
    for (let i = 0; i < n; i++) indices.push(back, back + 1 + (i + 1) % n, back + 1 + i);

    for (let i = 0; i < n; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        // Outward normal of a counter-clockwise edge.
        const nx = dy / len, ny = -dx / len;
        const b = positions.length / 3;
        put(x0, y0, d / 2, nx, ny, 0);
        put(x1, y1, d / 2, nx, ny, 0);
        put(x1, y1, -d / 2, nx, ny, 0);
        put(x0, y0, -d / 2, nx, ny, 0);
        indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return { positions, normals, uvs, indices };
}

/**
 * A right-pointing triangle as a mergeable part, `w` across and `h` tall, centred on
 * (`ox`, `oy`, 0) and `d` deep. Front and back faces plus the three sides, so it reads the
 * same whichever way the board is turned.
 *
 * Flat-shaded like everything else here: one normal per face, no sharing of vertices
 * between faces, which is what keeps `mergeParts`' colours exactly as authored.
 */
export function triPart(w: number, h: number, d: number, ox = 0, oy = 0): MeshPart {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const hw = w / 2, hh = h / 2, hd = d / 2;
    // The three corners, in the board plane: apex right, base left.
    const c: [number, number][] = [
        [ox - hw, oy + hh],
        [ox - hw, oy - hh],
        [ox + hw, oy],
    ];
    const face = (z: number, nz: number, wind: number[]): void => {
        const base = positions.length / 3;
        for (const i of [0, 1, 2]) {
            positions.push(c[i][0], c[i][1], z);
            normals.push(0, 0, nz);
            uvs.push(0, 0);
        }
        indices.push(base + wind[0], base + wind[1], base + wind[2]);
    };
    face(hd, 1, [0, 1, 2]);
    face(-hd, -1, [0, 2, 1]);
    // Sides: one quad per edge, its own normal, so the silhouette stays crisp.
    for (let i = 0; i < 3; i++) {
        const [x0, y0] = c[i];
        const [x1, y1] = c[(i + 1) % 3];
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        // Outward normal of a clockwise-wound edge, in the board plane.
        const nx = dy / len, ny = -dx / len;
        const base = positions.length / 3;
        for (const [x, y, z] of [
            [x0, y0, hd], [x1, y1, hd], [x1, y1, -hd], [x0, y0, -hd],
        ] as const) {
            positions.push(x, y, z);
            normals.push(nx, ny, 0);
            uvs.push(0, 0);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { positions, normals, uvs, indices };
}

/** A box as a mergeable part, centred on (`ox`, `oy`, 0). For dashes and grid lines. */
export function boxPart(w: number, h: number, d: number, ox = 0, oy = 0): MeshPart {
    return roundedSlabPart(w, h, d, 0, ox, oy);
}

/**
 * A flat panel: rounded if `r` > 0, and UNLIT, so the colour on screen is exactly the
 * colour written here. The ground panels are a flat graphic design, not lit geometry —
 * going through `builtin-standard` made every authored colour arrive somewhere else and
 * turned palette work into guesswork. The 3D cars and passengers stay lit.
 */
export function makeSlab(name: string, w: number, h: number, d: number, color: Color, r = 0): Node {
    const node = new Node(name);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = mergeParts([roundedSlabPart(w, h, d, r)]);
    mr.material = flatMaterial(color);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    return node;
}

/** Several parts as one unlit node — one draw call for a whole set of dashes. */
export function makeMerged(name: string, parts: MeshPart[], color: Color): Node {
    const node = new Node(name);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = mergeParts(parts);
    mr.material = flatMaterial(color);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    return node;
}

/**
 * The soft drop shadow under a panel: the same rounded shape in translucent black,
 * offset down and set behind the panel so only the sliver below it shows. Real shadows
 * are wrong here (the whole board is tilted ~52°, so a directional light throws long
 * offset shadows onto a slanted ground) and this is what the reference art does anyway.
 */
export function makeShadowSlab(name: string, w: number, h: number, r: number, alpha = 42): Node {
    const node = new Node(name);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = mergeParts([roundedSlabPart(w, h, 0.02, r)]);
    mr.material = alphaMaterial(new Color(24, 34, 56, alpha));
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    return node;
}
