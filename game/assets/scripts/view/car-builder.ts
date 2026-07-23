import { Node, Color, MeshRenderer, utils, primitives } from 'cc';
import { litMaterial, unlitMaterial } from './materials';
import { Dir } from './placeholder';

export type Cap = 'small' | 'medium' | 'big';

function litBox(name: string, w: number, h: number, d: number, color: Color): Node {
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: w, height: h, length: d }));
    mr.material = litMaterial(color);
    return n;
}

function wheel(name: string, r: number, color: Color): Node {
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    // cylinder axis is Y by default; rotate so it lies like a wheel (axis along X).
    mr.mesh = utils.createMesh(primitives.cylinder(r, r, r * 0.5, { radialSegments: 16 }));
    mr.material = litMaterial(color);
    n.setRotationFromEuler(0, 0, 90);
    return n;
}

/** Build a cartoon car sized to its footprint. Returns root (move this) and body (animate this). */
export function buildCar(
    name: string, sizeX: number, sizeY: number, color: Color, dir: Dir, cap: Cap,
): { root: Node; body: Node } {
    const root = new Node(name);
    const depth = 0.55;
    const dark = new Color(40, 44, 52);
    const glass = new Color(150, 205, 235);

    // Body = chassis + cabin. Cabin height/window count vary by capacity.
    const body = new Node('body');
    root.addChild(body);
    const chassis = litBox('chassis', sizeX * 0.92, sizeY * 0.62, depth, color);
    chassis.setPosition(0, -sizeY * 0.12, 0);
    body.addChild(chassis);
    const cabinH = cap === 'small' ? 0.34 : cap === 'medium' ? 0.42 : 0.5;
    const cabin = litBox('cabin', sizeX * 0.7, sizeY * cabinH, depth * 0.9, color);
    cabin.setPosition(0, sizeY * 0.22, 0);
    body.addChild(cabin);

    // Windows on the cabin front face.
    const winCount = cap === 'small' ? 1 : cap === 'medium' ? 2 : 3;
    const winW = (sizeX * 0.6) / winCount;
    for (let i = 0; i < winCount; i++) {
        const win = litBox(`win${i}`, winW * 0.8, sizeY * cabinH * 0.6, 0.06, glass);
        const startX = -((winCount - 1) * winW) / 2;
        win.setPosition(startX + i * winW, sizeY * 0.22, depth * 0.46);
        body.addChild(win);
    }

    // Four wheels near the corners (slightly below the chassis, in front of the body plane).
    const wr = Math.min(sizeX, sizeY) * 0.16;
    const wx = sizeX * 0.34, wy = -sizeY * 0.3, wz = depth * 0.35;
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
        const w = wheel('wheel', wr, dark);
        w.setPosition(sx * wx, sy < 0 ? wy : wy, sy > 0 ? wz : -wz);
        body.addChild(w);
    }

    // Roof direction arrow (bright, unlit so it always pops), reusing dir orientation.
    const arrow = new Node('arrow');
    const amr = arrow.addComponent(MeshRenderer);
    amr.mesh = utils.createMesh(primitives.box({ width: 0.16, height: 0.5, length: 0.12 }));
    amr.material = unlitMaterial(new Color(255, 255, 255));
    const off = 0.3 * Math.min(sizeX, sizeY);
    const z = depth / 2 + 0.12;
    switch (dir) {
        case 'up': arrow.setPosition(0, off, z); arrow.setRotationFromEuler(0, 0, 0); break;
        case 'down': arrow.setPosition(0, -off, z); arrow.setRotationFromEuler(0, 0, 180); break;
        case 'left': arrow.setPosition(-off, 0, z); arrow.setRotationFromEuler(0, 0, 90); break;
        case 'right': arrow.setPosition(off, 0, z); arrow.setRotationFromEuler(0, 0, -90); break;
    }
    body.addChild(arrow);

    return { root, body };
}
