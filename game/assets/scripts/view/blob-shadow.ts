import { Node, Color, MeshRenderer, utils, primitives, Material } from 'cc';

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
    mat.initialize({ effectName: 'builtin-unlit', technique: 1 });
    mat.setProperty('mainColor', new Color(0, 0, 0, 45));
    shadowMat = mat;
    return mat;
}

/**
 * A flat dark ellipse (full width `w`, full height `h`) lying in the local XY plane
 * (thin along Z), facing the camera on the tilted board. Caller positions it at the
 * object's base. Does not cast/receive real shadows.
 */
export function blobShadow(name: string, w: number, h: number): Node {
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    // Cylinder disc (radius 0.5 → diameter 1) scaled to w×h; rotate 90° about X so the
    // circular face points toward the camera and the disc lies against the board plane.
    mr.mesh = utils.createMesh(primitives.cylinder(0.5, 0.5, 0.02, { radialSegments: 24 }));
    mr.material = shadowMaterial();
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    n.setScale(w, 1, h);
    n.setRotationFromEuler(90, 0, 0);
    return n;
}
