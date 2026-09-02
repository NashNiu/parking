import { Node, Color, Mesh, MeshRenderer } from 'cc';
import { Cap } from '../core/index';
import { vertexColorMaterial } from './materials';
import { carMesh, carSkirtMesh, skirtDrop } from './car-mesh';
import { blobShadow } from './blob-shadow';
import { KEY_LIGHT_PITCH_DEG } from './environment';

// Re-exported so the view layer can keep importing Cap from here; it is core's type now,
// not a second declaration of the same three strings. `export type`, not `export`: this is
// a type and Cocos transpiles each module without the others' type information, so a value
// re-export clause would have it emit a runtime binding core/index has no value for.
export type { Cap };

/**
 * How far the shadow falls BELOW the side wall's bottom edge, in world units.
 *
 * The wall's bottom is where the car meets the ground, so that is where the shadow starts; this
 * is only the extra throw that keeps it from reading as painted on. Small, because the wall is
 * already carrying the height.
 *
 * It can afford to be generous if it ever needs to be, which corrects an earlier note here
 * saying the opposite. The shadow uses `builtin-unlit` technique 1, whose depth state is
 * `depthTest: true, depthWrite: false` -- so a shadow at z = -0.06 is depth-REJECTED wherever a
 * car in front of it has already written depth, and cannot paint across a neighbour's paint at
 * any offset.
 */
const SHADOW_LIFT = 0.03;

/**
 * A board-space offset, expressed in `body`'s own frame.
 *
 * Every fake-height cue on this car -- the side wall, the body's matching half-step up, and the
 * drop shadow -- is a board direction: down the screen, where the light throws things. But they
 * all hang off `body`, which carries the car's heading, so writing the offset straight into a
 * local position would SPIN it with the car and put the wall and the shadow on the wrong side of
 * every car not pointing +X. Rotating by -angle here lands them in the same board direction
 * whatever the heading. (They stay on `body` rather than moving to `root` so they still squash
 * with the car on a tap.)
 */
function boardToLocal(angle: number, dx: number, dy: number): [number, number] {
    const a = angle * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return [dx * c + dy * s, -dx * s + dy * c];
}

/**
 * Contact shadow, sized to the car's ACTUAL body (`len` along body X, `wid` along body Y) so the
 * heading rotates it with the car — a car pointing up gets a tall narrow shadow, not a wide flat
 * one. z = -0.06 puts it under the side wall (-0.02) and over the lot surface (-0.10).
 *
 * The direction and distance come from the key light rather than from taste: a point `h` above
 * the board lands at -h * L.xy / L.z, and with the light at KEY_LIGHT_PITCH_DEG that is
 * h * tan(55°) straight down the screen. `lift` is where the top face already sits, so the throw
 * is measured from there. Change the light's pitch and every shadow on the board follows.
 */
function addShadow(body: Node, len: number, wid: number, angle: number, foot: number): void {
    const shadow = blobShadow('shadow', len * 0.94, wid * 1.08);
    const throwDown = SHADOW_LIFT * Math.tan(-KEY_LIGHT_PITCH_DEG * Math.PI / 180);
    const [dx, dy] = boardToLocal(angle, 0, foot - throwDown);
    shadow.setPosition(dx, dy, -0.06);
    body.addChild(shadow);
}

/** One of the car's two plan meshes, scaled to the car and offset up or down the screen. */
function mesh(
    name: string, geometry: Mesh, color: Color,
    len: number, wid: number, angle: number, dy: number, z: number,
): Node {
    const node = new Node(name);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = geometry;
    mr.material = vertexColorMaterial(color);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    node.setScale(len, wid, 1);
    const [dx, dyLocal] = boardToLocal(angle, 0, dy);
    node.setPosition(dx, dyLocal, z);
    return node;
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
    // scale. Both meshes are built in a unit box with length along X and width along Y, already
    // in board space, so there is no lay-down rotation: the plates stack a few hundredths of a
    // unit up in +Z, just far enough apart not to z-fight.
    //
    // TWO renderers: the roof, sitting EXACTLY on core's footprint, and under it the side wall
    // that makes the car read as a box rather than a sticker. The wall carries the whole offset
    // so the roof carries none of it -- see SKIRT_DROP for why that is the right way round.
    const drop = skirtDrop() * wid;
    const plan = mesh('plan', carMesh(color), color, len, wid, angle, 0, 0);
    const skirt = mesh('skirt', carSkirtMesh(color), color, len, wid, angle, -drop, -0.02);
    body.addChild(skirt);
    body.addChild(plan);

    addShadow(body, len, wid, angle, -drop);

    // The body carries the heading. The mesh's arrow points +X, which is the body's own
    // forward, so a spin of `angle` about the board normal puts both the car and the arrow
    // where core says it is going -- true by construction, with no footprint in between for
    // the two to disagree about.
    body.setRotationFromEuler(0, 0, angle);
    return { root, body, len, wid };
}
