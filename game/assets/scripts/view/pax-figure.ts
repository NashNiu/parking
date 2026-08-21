import { Node, Color, Mesh, MeshRenderer, primitives, utils } from 'cc';
import { instancedLitMaterial } from './materials';

/**
 * Procedural passenger figure: a round head, a tapered body carrying the passenger's
 * colour, and two thin arms that can swing independently. Replaces the old baked-GLB
 * pipeline (passenger-builder.ts, deleted) after the human rejected the loaded 3D
 * humanoid model as visual mush at this game's zoom, packed four to a row on a
 * sheared feeder channel, and asked for exactly this instead: a round head, a simple
 * body, two arms, and the arms swinging while walking. No GLB, no asset loading, no
 * async, no failure path -- every part is an engine primitive, built once per part
 * and shared (mesh AND `instancedLitMaterial`) by every figure in the crowd.
 *
 * FACING: at identity rotation the figure faces +Z. This is not an authored-art
 * convention to trust -- trusting one, unverified, is the exact bug that cost four
 * rounds on the old model. It is instead a fact of the geometry placed below: the
 * arms sit in the body's X-Y plane at rest (offset only along X, zero Z), so
 * rotating either one about the figure's local X axis (`setArmSwing`) necessarily
 * moves its hand along ±Z -- that is what rotating an X-Y-plane vector about X does,
 * not a claim about which way anything was "authored" to face. That matches the
 * convention the rest of the view already assumes at identity rotation (see
 * track-view.ts's FACE_TURN comment: "+Z = (sin(yaw), 0, cos(yaw))"), and the camera
 * itself sits at world +Z looking toward -Z (GameController.setupCamera), so +Z is
 * also, concretely, the direction toward the camera.
 *
 * No face: no eyes, no mouth. The human explicitly did not ask for one, and a face
 * would make the figure's orientation legible enough to matter -- which is the
 * problem the four earlier rounds were spent on.
 */

/**
 * Skin tone for the head and arms. Kept light and neutral so the body's colour --
 * the thing a player actually reads a row by -- stays the largest coloured area on
 * the figure.
 */
const SKIN = new Color(255, 214, 189, 255);

// Every size below is a FRACTION of the `height` argument, not an absolute unit: the
// geometry is built once, at unit height, by the mesh builders further down, and
// each figure scales that shared geometry via its own `fit` node (see
// buildPaxFigure). That is what lets one cached mesh per part serve every figure at
// whatever height a caller passes, per the brief's "share one mesh per part" ask.

/**
 * Head radius, as a fraction of height. Calibrated so it lands on exactly 0.10 at
 * PAX_HEIGHT (0.55, track-view.ts) -- the "roughly 0.10 of a unit radius" the design
 * calls for.
 */
const HEAD_RADIUS = 0.10 / 0.55;

/**
 * Body height, as a fraction of height: whatever is left once the head is accounted
 * for, so the figure's feet land exactly on the ground with no gap underneath. At
 * PAX_HEIGHT this comes out to 0.35, not the design's "roughly 0.22" -- 0.22 stacked
 * under the head's 0.20 diameter falls 0.13 short of PAX_HEIGHT (0.55) with no third
 * part (legs) to fill the difference, and a body that stops 0.13 short of the ground
 * would read as floating. A body taller than the design's rough number still
 * satisfies the actual requirement behind it: at 0.35 tall against a 0.20-diameter
 * head and a pair of thin arms, it is comfortably the largest coloured area on the
 * figure either way.
 */
const BODY_HEIGHT = 1 - 2 * HEAD_RADIUS;

/** Body taper, as fractions of height: narrower at the shoulders than at the base, so
 *  it reads as a rounded torso rather than a plain cylinder. */
const BODY_RADIUS_TOP = 0.15;
const BODY_RADIUS_BOTTOM = 0.12;

/** Thin arm capsule: radius and shoulder-to-hand length, as fractions of height. */
const ARM_RADIUS = 0.045;
const ARM_LENGTH = 0.40;

/**
 * Shoulder attachment point, as a fraction of height: just below the very top of the
 * body (so a hanging arm doesn't poke up past the shoulder line), and just outside
 * the body's own top radius there (a slight overlap, so the join shows no gap).
 */
const SHOULDER_Y = BODY_HEIGHT * 0.88;
const SHOULDER_X = BODY_RADIUS_TOP + ARM_RADIUS * 0.5;

// Mesh segment counts. Low, on purpose: these parts are a handful of pixels across at
// this game's zoom, and every figure in the crowd shares the one cached mesh per
// part, so this vertex count is paid once for the whole crowd, not once per figure.
const SPHERE_SEGMENTS = 8;
const CAPSULE_SIDES = 8;
const CAPSULE_HEIGHT_SEGMENTS = 8;

let headMeshCache: Mesh | null = null;
/** The head: a sphere, centred on its own origin by the primitive. */
function headMesh(): Mesh {
    if (headMeshCache) return headMeshCache;
    const g = primitives.sphere(HEAD_RADIUS, { segments: SPHERE_SEGMENTS });
    headMeshCache = utils.createMesh({ positions: g.positions, normals: g.normals, uvs: g.uvs, indices: g.indices });
    return headMeshCache;
}

let bodyMeshCache: Mesh | null = null;
/**
 * The body: a tapered capsule, centred on its own origin by the primitive (spans
 * [-BODY_HEIGHT/2, +BODY_HEIGHT/2]). The body NODE's position -- half its height --
 * is what lifts it to stand on the ground; see buildPaxFigure.
 */
function bodyMesh(): Mesh {
    if (bodyMeshCache) return bodyMeshCache;
    const g = primitives.capsule(BODY_RADIUS_TOP, BODY_RADIUS_BOTTOM, BODY_HEIGHT,
        { sides: CAPSULE_SIDES, heightSegments: CAPSULE_HEIGHT_SEGMENTS });
    bodyMeshCache = utils.createMesh({ positions: g.positions, normals: g.normals, uvs: g.uvs, indices: g.indices });
    return bodyMeshCache;
}

let armMeshCache: Mesh | null = null;
/**
 * One arm: a thin capsule. The primitive centres it on its own origin, spanning
 * [-ARM_LENGTH/2, +ARM_LENGTH/2] -- but the arm's NODE origin has to be the shoulder,
 * since that is what `setArmSwing` rotates about, so the geometry is shifted down by
 * half its length here, once, to span [-ARM_LENGTH, 0] instead: shoulder at the
 * node's own y = 0, hand hanging below it.
 */
function armMesh(): Mesh {
    if (armMeshCache) return armMeshCache;
    const g = primitives.capsule(ARM_RADIUS, ARM_RADIUS, ARM_LENGTH,
        { sides: CAPSULE_SIDES, heightSegments: CAPSULE_HEIGHT_SEGMENTS });
    const positions = g.positions.slice();
    for (let i = 1; i < positions.length; i += 3) positions[i] -= ARM_LENGTH / 2;
    armMeshCache = utils.createMesh({ positions, normals: g.normals, uvs: g.uvs, indices: g.indices });
    return armMeshCache;
}

/**
 * The four part-nodes of one figure, keyed by its root. `recolorPaxFigure` and
 * `setArmSwing` read this instead of walking the hierarchy or matching on node names,
 * so neither has to trust a naming convention every call -- and `setArmSwing`, which
 * runs for every visible ring figure every frame, gets its two arm nodes from one
 * allocation-free WeakMap lookup.
 */
interface Parts { body: Node; head: Node; armL: Node; armR: Node }
const registry = new WeakMap<Node, Parts>();

/**
 * Build one passenger figure `height` units tall. Returns the root node with its own
 * transform untouched (identity rotation, scale 1, position 0) -- the `height` scale
 * lives on an inner `fit` node, so callers can position and tween the root freely, the
 * same contract the old GLB-backed builder offered. Faces +Z at identity rotation
 * (see the module doc comment above for why).
 */
export function buildPaxFigure(name: string, color: Color, height: number): Node {
    const root = new Node(name);
    const fit = new Node('fit');
    fit.setScale(height, height, height);
    root.addChild(fit);

    const body = new Node('body');
    body.setPosition(0, BODY_HEIGHT / 2, 0);
    const bodyMr = body.addComponent(MeshRenderer);
    bodyMr.mesh = bodyMesh();
    bodyMr.material = instancedLitMaterial(color);
    fit.addChild(body);

    const head = new Node('head');
    head.setPosition(0, BODY_HEIGHT + HEAD_RADIUS, 0);
    const headMr = head.addComponent(MeshRenderer);
    headMr.mesh = headMesh();
    headMr.material = instancedLitMaterial(SKIN);
    fit.addChild(head);

    // Both arms start from the same instanced skin material -- built once here and
    // reused for the second arm -- so the whole crowd's arms (both sides, every
    // figure) still collapse to one (mesh, colour) pair, not two.
    const skinArmMat = instancedLitMaterial(SKIN);

    const armL = new Node('arm-L');
    armL.setPosition(-SHOULDER_X, SHOULDER_Y, 0);
    const armLMr = armL.addComponent(MeshRenderer);
    armLMr.mesh = armMesh();
    armLMr.material = skinArmMat;
    fit.addChild(armL);

    const armR = new Node('arm-R');
    armR.setPosition(SHOULDER_X, SHOULDER_Y, 0);
    const armRMr = armR.addComponent(MeshRenderer);
    armRMr.mesh = armMesh();
    armRMr.material = skinArmMat;
    fit.addChild(armR);

    registry.set(root, { body, head, armL, armR });
    return root;
}

/**
 * Repaint a figure built by `buildPaxFigure`: the body takes `shade(color)`, the head
 * and arms take `shade(skin)`. Every part goes through `shade`, so a dimmed waiting
 * row dims as a whole figure rather than going two-tone -- the inactive channel has
 * to read as inactive at a glance.
 */
export function recolorPaxFigure(root: Node, color: Color, shade: (c: Color) => Color): void {
    const parts = registry.get(root);
    if (!parts) return;
    const bodyMat = instancedLitMaterial(shade(color));
    const skinMat = instancedLitMaterial(shade(SKIN));
    const bodyMr = parts.body.getComponent(MeshRenderer);
    if (bodyMr) bodyMr.material = bodyMat;
    const headMr = parts.head.getComponent(MeshRenderer);
    if (headMr) headMr.material = skinMat;
    const armLMr = parts.armL.getComponent(MeshRenderer);
    if (armLMr) armLMr.material = skinMat;
    const armRMr = parts.armR.getComponent(MeshRenderer);
    if (armRMr) armRMr.material = skinMat;
}

/**
 * Swing the two arms to +degrees and -degrees about the figure's local X axis --
 * opposite phase, one forward as the other goes back, like a walking gait. Cheap and
 * allocation free: the arm nodes come from one WeakMap lookup (no getChildByName /
 * getChildByPath walk), and `Node.setRotationFromEuler` writes straight into the
 * node's own quaternion rather than building a new one -- this runs for every visible
 * ring figure every frame.
 */
export function setArmSwing(root: Node, degrees: number): void {
    const parts = registry.get(root);
    if (!parts) return;
    parts.armL.setRotationFromEuler(degrees, 0, 0);
    parts.armR.setRotationFromEuler(-degrees, 0, 0);
}
