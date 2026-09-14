import { Node, Color, Mesh, MeshRenderer, utils, primitives, Material } from 'cc';
import { SHADOW_INK, CONTACT_ALPHA } from './shadow';

/**
 * Fake "contact" shadow for the 2.5D tilted board. Real-time ShadowMap looks
 * wrong here (the whole board is tilted -- see BOARD_TILT -- so a directional light casts long,
 * offset, hard shadows onto the slanted "ground") and is expensive. Instead a car carries a
 * soft dark translucent ellipse that lies flat against the board plane beneath it — clean,
 * cheap, and always reads as grounded.
 *
 * CARS. NOT PASSENGERS. This said "each car/passenger" and that was wrong: `blobShadow` has
 * exactly one caller in the scene, `car-builder`, and the crowd wears nothing. The claim cost
 * something real before it was checked -- a later pass reasoned from it that this material was
 * stuck serving both the asphalt and the white track, and left the cars' shadows at a third of
 * the weight they should have had. If the crowd should have contact shadows, that is a feature
 * to add and to price (there can be 256 of them), not something this comment can assert.
 */

let shadowMat: Material | null = null;

function shadowMaterial(): Material {
    if (shadowMat) return shadowMat;
    const mat = new Material();
    // technique 1 = builtin-unlit "transparent" (blend enabled) → honors mainColor alpha.
    // USE_INSTANCING so the scene's shadows batch: they all share this material and, now
    // that they share a mesh too (see `discGeometry`), nothing else keeps them apart. Draw
    // ORDER among them does not matter -- every one is the same flat dark ellipse lying on
    // the board plane, and no two overlap in a way an ordering could show.
    mat.initialize({
        effectName: 'builtin-unlit', technique: 1, defines: { USE_INSTANCING: true },
    });
    // SHARED INK, AND CONTACT_ALPHA IS WHAT KEEPS THE WEIGHT UNCHANGED ACROSS THAT SWITCH.
    // This was flat black at 45 while every panel in the scene used the cool board-biased ink;
    // see shadow.ts for why one ink, and CONTACT_ALPHA for why 67 is the same weight 45 was on
    // black rather than a decision to darken anything.
    //
    // ONE ALPHA, ONE KIND OF FLOOR. Every shadow drawn with this material belongs to a car, and
    // cars only ever stand on dark surfaces -- asphalt 102, ring road 93, stall pad 87 -- so
    // there is no second background to balance against. CONTACT_ALPHA is set from that; see its
    // note for the measurements and for the phantom constraint that held it at 67.
    mat.setProperty('mainColor', new Color(SHADOW_INK.r, SHADOW_INK.g, SHADOW_INK.b, CONTACT_ALPHA));
    shadowMat = mat;
    return mat;
}

let discMesh: Mesh | null = null;
/**
 * The disc itself, built ONCE and shared.
 *
 * It used to be built per shadow, which handed 46 cars 46 distinct meshes of identical
 * geometry -- so no two shadows could ever batch, and the engine uploaded the same disc 46
 * times. The size difference between shadows is a node SCALE, not geometry, so there was
 * never anything for a per-shadow mesh to express.
 */
function discGeometry(): Mesh {
    if (discMesh) return discMesh;
    discMesh = utils.createMesh(primitives.cylinder(0.5, 0.5, 0.02, { radialSegments: 24 }));
    return discMesh;
}

/**
 * A flat dark ellipse (full width `w`, full height `h`) lying in the local XY plane
 * (thin along Z), facing the camera on the tilted board. Caller positions it at the
 * object's base. Does not cast/receive real shadows.
 *
 * One mesh and one material across the whole scene, both shared, so the 46 shadows in a
 * lot collapse into about one draw call instead of 46.
 */
export function blobShadow(name: string, w: number, h: number): Node {
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    // Radius 0.5 -> diameter 1, so the node's scale IS the size in world units. Rotated 90
    // about X so the circular face points at the camera and lies against the board plane.
    mr.mesh = discGeometry();
    mr.material = shadowMaterial();
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    n.setScale(w, 1, h);
    n.setRotationFromEuler(90, 0, 0);
    return n;
}
