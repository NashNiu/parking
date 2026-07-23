import { Node, Color, MeshRenderer, utils, primitives } from 'cc';
import { litMaterial } from './materials';

/**
 * A tiny person silhouette: capsule body + sphere head, tinted to `color`.
 *
 * Note on `primitives.capsule`: in Cocos Creator 3.8.7 the signature is
 * `capsule(radius = 0.5, height = 2, opts?)` — a single radius (both caps are
 * hemispheres of the same size), unlike `cylinder`'s `(radiusTop, radiusBottom, height, opts?)`
 * which can taper. The brief's example call assumed a 4-arg
 * `(radiusTop, radiusBottom, height, opts)` form; since it always passed equal
 * top/bottom radii anyway, we adapt to the real 3-arg form with no visual change.
 */
export function buildPassenger(name: string, color: Color): Node {
    const root = new Node(name);
    const body = new Node('body');
    const bmr = body.addComponent(MeshRenderer);
    bmr.mesh = utils.createMesh(primitives.capsule(0.14, 0.36, { sides: 12 }));
    bmr.material = litMaterial(color);
    body.setPosition(0, 0, 0);
    root.addChild(body);

    const head = new Node('head');
    const hmr = head.addComponent(MeshRenderer);
    hmr.mesh = utils.createMesh(primitives.sphere(0.13, { segments: 12 }));
    hmr.material = litMaterial(new Color(255, 224, 189)); // skin-ish head
    head.setPosition(0, 0.32, 0);
    root.addChild(head);

    return root;
}

/** Retint a passenger's body (head stays skin-colored). */
export function recolorPassenger(node: Node, color: Color): void {
    const body = node.getChildByName('body');
    if (!body) return;
    const mr = body.getComponent(MeshRenderer);
    if (mr) mr.material = litMaterial(color);
}
