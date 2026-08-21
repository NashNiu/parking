import { Node, Color, Mesh, MeshRenderer, primitives, utils } from 'cc';
import { instancedLitMaterial } from './materials';

/**
 * Procedural passenger figure: a rounded head sitting on a rounder, chunkier body, and
 * two thin arms that can swing independently -- head, body and arms all in the one
 * passenger colour (revision 2: the human rejected revision 1's beige skin tone and
 * narrow chess-pawn silhouette, and asked for a single-colour, rounder blob instead,
 * pointing at a reference where a crowd of uniformly coloured figures reads instantly
 * as belonging to one car). Before that, this replaced the old baked-GLB pipeline
 * (passenger-builder.ts, deleted) after the human rejected the loaded 3D humanoid
 * model as visual mush at this game's zoom, packed four to a row on a sheared feeder
 * channel, and asked for exactly this instead: a round head, a simple body, two arms,
 * and the arms swinging while walking. No GLB, no asset loading, no async, no failure
 * path -- every part is an engine primitive, built once per part and shared (mesh AND
 * `instancedLitMaterial`) by every figure in the crowd.
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

// Every size below is a FRACTION of the `height` argument, not an absolute unit: the
// geometry is built once, at unit height, by the mesh builders further down, and
// each figure scales that shared geometry via its own `fit` node (see
// buildPaxFigure). That is what lets one cached mesh per part serve every figure at
// whatever height a caller passes, per the brief's "share one mesh per part" ask.

/**
 * Head radius, as a fraction of height. Written as absolute/0.55 so it lands on
 * exactly 0.08 at PAX_HEIGHT (0.55, track-view.ts): smaller than the body's own
 * radius below, so the head sits ON the body instead of overhanging it (revision 2 --
 * the previous 0.10 head was wider than the 0.15/0.12 body and read as top-heavy).
 */
const HEAD_RADIUS = 0.08 / 0.55;

/**
 * Body height, as a fraction of height: whatever is left once the head is accounted
 * for, so the figure's feet land exactly on the ground with no gap underneath, and
 * the head-plus-body stack always sums to exactly `height` regardless of how
 * HEAD_RADIUS is tuned. At PAX_HEIGHT (0.08 head radius) this comes out to
 * 0.55 - 2*0.08 = 0.39.
 */
const BODY_HEIGHT = 1 - 2 * HEAD_RADIUS;

/**
 * Body taper, written as absolute/0.55 so they land on exactly 0.095 (shoulder level)
 * and 0.105 (base) at PAX_HEIGHT -- narrower at the shoulders than at the base, so it
 * reads as a rounded torso rather than a plain cylinder, and its 0.21 diameter at the
 * base is bigger than the head's 0.16, making the body -- not the head -- the widest
 * single part of the figure (the thing revision 2 asked for: "rounder" comes from
 * this body/head ratio, not from scaling the whole figure up).
 */
const BODY_RADIUS_TOP = 0.095 / 0.55;
const BODY_RADIUS_BOTTOM = 0.105 / 0.55;

/**
 * Thin arm capsule: radius and shoulder-to-hand length, as fractions of height.
 * ARM_RADIUS is written as absolute/0.55 so it lands on exactly 0.03 at PAX_HEIGHT --
 * thinner than revision 1's 0.045, so a same-coloured arm reads as motion rather than
 * as a limb (see setArmSwing's doc comment).
 */
const ARM_RADIUS = 0.03 / 0.55;
const ARM_LENGTH = 0.40;

/**
 * Shoulder attachment point, as a fraction of height: just below the very top of the
 * body (so a hanging arm doesn't poke up past the shoulder line), and pulled IN from
 * the body's own top radius there by half the arm radius -- the opposite of revision
 * 1, which pushed it OUT by the same half-radius. With one colour now, an arm whose
 * near half is buried inside the body reads fine; only its far half needs to clear
 * the surface to show as a bump. At PAX_HEIGHT: 0.095 - 0.03/2 = 0.08.
 */
const SHOULDER_Y = BODY_HEIGHT * 0.88;
const SHOULDER_X = BODY_RADIUS_TOP - ARM_RADIUS * 0.5;

/**
 * Widest horizontal extent of the whole figure, absolute at PAX_HEIGHT, INCLUDING an
 * arm at full swing: 2 * (SHOULDER_X + ARM_RADIUS) = 2 * (0.08 + 0.03) = 0.22.
 *
 * That arm term does not grow with the swing angle: `setArmSwing` rotates each arm
 * about the figure's local X axis only (`setRotationFromEuler(degrees, 0, 0)`), and
 * rotation about the X axis leaves every point's x-coordinate unchanged (it mixes y
 * and z only) -- the same fact the module's FACING comment relies on, applied to the
 * other axis. So the arm capsule's x-extent is ARM_RADIUS at any swing angle, not
 * just at rest, and the figure's widest point is this arm-plus-shoulder reach, not
 * the body: 0.22 > the body's own 0.21 diameter at its base (BODY_RADIUS_BOTTOM).
 *
 * 0.22 is at or below the hard budget of 0.24 that ROW_STEP (0.26, track-view.ts)
 * leaves for four side-by-side figures on a ring row -- 0.02 of clearance to spare.
 * This constant is not read by any other code; it exists so this number is computed
 * from the constants above rather than restated by hand somewhere it could drift.
 */
const WIDEST_EXTENT_AT_PAX_HEIGHT = 2 * (SHOULDER_X + ARM_RADIUS) * 0.55;

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

    // One colour, one material, shared by all four parts of this figure: the head and
    // arms no longer carry a separate skin tone (revision 2 dropped SKIN entirely), so
    // there is nothing left to buy by giving them their own `instancedLitMaterial`
    // call -- and reusing this one object still leaves every part's (mesh, colour)
    // pair instanced across the whole crowd, per `instancedLitMaterial`'s own cache.
    const mat = instancedLitMaterial(color);

    const body = new Node('body');
    body.setPosition(0, BODY_HEIGHT / 2, 0);
    const bodyMr = body.addComponent(MeshRenderer);
    bodyMr.mesh = bodyMesh();
    bodyMr.material = mat;
    fit.addChild(body);

    const head = new Node('head');
    head.setPosition(0, BODY_HEIGHT + HEAD_RADIUS, 0);
    const headMr = head.addComponent(MeshRenderer);
    headMr.mesh = headMesh();
    headMr.material = mat;
    fit.addChild(head);

    const armL = new Node('arm-L');
    armL.setPosition(-SHOULDER_X, SHOULDER_Y, 0);
    const armLMr = armL.addComponent(MeshRenderer);
    armLMr.mesh = armMesh();
    armLMr.material = mat;
    fit.addChild(armL);

    const armR = new Node('arm-R');
    armR.setPosition(SHOULDER_X, SHOULDER_Y, 0);
    const armRMr = armR.addComponent(MeshRenderer);
    armRMr.mesh = armMesh();
    armRMr.material = mat;
    fit.addChild(armR);

    registry.set(root, { body, head, armL, armR });
    return root;
}

/**
 * Repaint a figure built by `buildPaxFigure`: every part takes `shade(color)`, the
 * same single colour the whole figure was built with. All four parts go through the
 * same call to `shade`, so a dimmed waiting row dims as one solid-coloured figure
 * rather than going two-tone -- the inactive channel has to read as inactive at a
 * glance, and (since revision 2) there is no second, skin-toned material left to fall
 * out of step with it.
 */
export function recolorPaxFigure(root: Node, color: Color, shade: (c: Color) => Color): void {
    const parts = registry.get(root);
    if (!parts) return;
    const mat = instancedLitMaterial(shade(color));
    const bodyMr = parts.body.getComponent(MeshRenderer);
    if (bodyMr) bodyMr.material = mat;
    const headMr = parts.head.getComponent(MeshRenderer);
    if (headMr) headMr.material = mat;
    const armLMr = parts.armL.getComponent(MeshRenderer);
    if (armLMr) armLMr.material = mat;
    const armRMr = parts.armR.getComponent(MeshRenderer);
    if (armRMr) armRMr.material = mat;
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
