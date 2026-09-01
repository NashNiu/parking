import { Node, Color, MeshRenderer } from 'cc';
import { Cap } from '../core/index';
import { vertexColorMaterial } from './materials';
import { carMesh } from './car-mesh';
import { blobShadow } from './blob-shadow';

// Re-exported so the view layer can keep importing Cap from here; it is core's type now,
// not a second declaration of the same three strings. `export type`, not `export`: this is
// a type and Cocos transpiles each module without the others' type information, so a value
// re-export clause would have it emit a runtime binding core/index has no value for.
export type { Cap };

/**
 * Contact shadow, parented to `body` and sized to the car's ACTUAL body
 * (`len` along body X, `wid` along body Y) so the heading rotates it with the
 * car — a car pointing up gets a tall narrow shadow, not a wide flat one. Sits
 * centered under the car: in board space the key light travels almost straight
 * into the board (-Z), so there's no meaningful lateral shadow offset to fake.
 * z = -0.06 puts it between the lot surface (-0.10) and the car's lowest plate (0).
 */
function addShadow(body: Node, len: number, wid: number): void {
    const shadow = blobShadow('shadow', len * 0.94, wid * 1.08);
    shadow.setPosition(0, 0, -0.06);
    body.addChild(shadow);
}

/** What `buildCar` hands back: the nodes to move and animate, and the size it settled on. */
export interface BuiltCar {
    /** Move this; kept unrotated, so `pickCar` can undo the body's heading itself. */
    root: Node;
    /** Animate this — squash/flash/drive operate on it, and it carries the heading. */
    body: Node;
    /** Drawn length along the body's own X, in world units. */
    len: number;
    /** Drawn width along the body's own Y. */
    wid: number;
}

/**
 * Build a car at the size and heading core says it has: one vertex-coloured plan mesh
 * (`car-mesh.ts`) scaled to `len` x `wid`, plus a body-matched contact shadow.
 *
 * WHAT THIS USED TO BE, and why the drawn car replaced it: three GLB models loaded as prefabs,
 * scaled to fit, laid down toward the camera, then recoloured plate by plate with a shrink
 * applied to whichever plates were covering the glass. The camera is orthographic and looks at
 * the board straight on, so a car IS its top-down plan, and the plan was measured twice: of the
 * first set's nine primitives, eight showed nothing at all; of the second set's, the windscreen,
 * the rear window and the hubcaps were each exactly 0%. Everything that made a car read as a
 * car was authored for an angle this camera does not have, and no recolouring reaches it.
 *
 * The drawn car has no async load (so no preload step and no prefab-missing fallback), no uuid
 * to keep in sync with a re-import, and no scale to negotiate: `len` and `wid` arrive from
 * BoardLayout.carSize, which reads core's CAP_BOX, and the mesh is a unit box, so the node
 * scale IS the size. They are handed straight back, exactly matching core's footprint -- there
 * is no fitted size left to differ from the requested one.
 *
 * It is also about seventy times cheaper to draw. One mesh and one material per colour, six
 * colours in the palette, one MeshRenderer per car: a full lot is six instanced draw calls,
 * against roughly 414 for 46 nine-primitive models.
 */
export function buildCar(
    name: string, len: number, wid: number, color: Color, angle: number,
): BuiltCar {
    const root = new Node(name);

    // body: the animatable node. Carries the heading (about the board normal) and is what
    // squash/flash target. Kept separate from `root` so movement tweens live on root and
    // `pickCar` can undo the heading itself to test the tap in the car's own frame. Its own
    // scale stays (1,1,1) -- `squash` captures it as the rest pose.
    const body = new Node('body');
    root.addChild(body);

    // The size lives on a child, so the squash tween and the car's dimensions never share a
    // scale. The mesh is built in a unit box with length along X and width along Y, already in
    // board space, so there is no lay-down rotation and no lift: the plates stack a few
    // hundredths of a unit up in +Z, just far enough apart not to z-fight.
    const plan = new Node('plan');
    const mr = plan.addComponent(MeshRenderer);
    mr.mesh = carMesh(color);
    mr.material = vertexColorMaterial(color);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    plan.setScale(len, wid, 1);
    body.addChild(plan);

    addShadow(body, len, wid);

    // The body carries the heading. The mesh's arrow points +X, which is the body's own
    // forward, so a spin of `angle` about the board normal puts both the car and the arrow
    // where core says it is going -- true by construction, with no footprint in between for
    // the two to disagree about.
    body.setRotationFromEuler(0, 0, angle);
    return { root, body, len, wid };
}
