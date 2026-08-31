import { Node, Color, Mesh, MeshRenderer, utils, primitives, Material } from 'cc';

/**
 * Fake "contact" shadow for the 2.5D tilted board. Real-time ShadowMap looks
 * wrong here (the whole board is tilted ~52°, so a directional light casts long,
 * offset, hard shadows onto the slanted "ground") and is expensive. Instead each
 * car/passenger carries a soft dark translucent ellipse that lies flat against the
 * board plane beneath it — clean, cheap, and always reads as grounded.
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
    mat.setProperty('mainColor', new Color(0, 0, 0, 45));
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
