import { Node, MeshRenderer, utils, primitives, Material, Color } from 'cc';

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Update the color of a box node created by makeBox/makeCar. */
export function setBoxColor(node: Node, color: Color): void {
    const mr = node.getComponent(MeshRenderer);
    if (mr && mr.material) mr.material.setProperty('mainColor', color);
}

/** Create a Node rendering a solid-colored box (unlit, so it shows without lights). */
export function makeBox(name: string, w: number, h: number, d: number, color: Color): Node {
    const node = new Node(name);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: w, height: h, length: d }));
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-unlit' });
    mat.setProperty('mainColor', color);
    mr.material = mat;
    return node;
}

/**
 * A placeholder car: a colored box the size of its footprint, with a small white
 * bar on the front face offset toward its exit direction to indicate `dir`.
 */
export function makeCar(name: string, sizeX: number, sizeY: number, color: Color, dir: Dir): Node {
    const depth = 0.6;
    const car = makeBox(name, sizeX, sizeY, depth, color);

    const arrow = makeBox('arrow', 0.16, 0.5, 0.12, Color.WHITE.clone());
    const off = 0.3 * Math.min(sizeX, sizeY);
    const z = depth / 2 + 0.07;
    switch (dir) {
        case 'up':
            arrow.setPosition(0, off, z);
            arrow.setRotationFromEuler(0, 0, 0);
            break;
        case 'down':
            arrow.setPosition(0, -off, z);
            arrow.setRotationFromEuler(0, 0, 180);
            break;
        case 'left':
            arrow.setPosition(-off, 0, z);
            arrow.setRotationFromEuler(0, 0, 90);
            break;
        case 'right':
            arrow.setPosition(off, 0, z);
            arrow.setRotationFromEuler(0, 0, -90);
            break;
    }
    car.addChild(arrow);
    return car;
}
