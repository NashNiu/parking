import { Node, Color, MeshRenderer, utils, primitives } from 'cc';
import { litMaterial } from './materials';

/**
 * A tiny person silhouette: capsule body + sphere head, tinted to `color`.
 *
 * `primitives.capsule` in Cocos 3.8.7 is `capsule(radiusTop=0.5, radiusBottom=0.5,
 * height=2, opts?)` (verified against the engine source). We use equal top/bottom
 * radii of 0.14 and a torso height of 0.36.
 */
export function buildPassenger(name: string, color: Color): Node {
    const root = new Node(name);
    const body = new Node('body');
    const bmr = body.addComponent(MeshRenderer);
    bmr.mesh = utils.createMesh(primitives.capsule(0.14, 0.14, 0.36, { sides: 12 }));
    bmr.material = litMaterial(color);
    bmr.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
    body.setPosition(0, 0, 0);
    root.addChild(body);

    const head = new Node('head');
    const hmr = head.addComponent(MeshRenderer);
    hmr.mesh = utils.createMesh(primitives.sphere(0.13, { segments: 12 }));
    hmr.material = litMaterial(new Color(255, 224, 189)); // skin-ish head
    hmr.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
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
