import { Node, MeshRenderer, Material, Color } from 'cc';

const litCache = new Map<string, Material>();

function key(c: Color): string {
    return `${c.r},${c.g},${c.b}`;
}

/** Cartoon-ish lit material (builtin-standard, matte with a faint sheen). Cached per color. */
export function litMaterial(color: Color): Material {
    const k = key(color);
    const hit = litCache.get(k);
    if (hit) return hit;
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-standard' });
    // In builtin-standard the albedo color's property NAME is `mainColor` (its
    // shader `target` is `albedo`). Setting `albedo`/`roughness`/`metallic` by
    // those names is rejected as "illegal property", which leaves the material's
    // passes null and crashes MeshRenderer's skin-pass update on enable. We set
    // only `mainColor`; roughness (0.5) / metallic (0) defaults already give the
    // matte cartoon look we want.
    mat.setProperty('mainColor', color);
    litCache.set(k, mat);
    return mat;
}

/** Unlit solid color (for UI-ish bits that must stay bright regardless of lighting). */
export function unlitMaterial(color: Color): Material {
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-unlit' });
    mat.setProperty('mainColor', color);
    return mat;
}

/** Recolor a lit node (its material is shared from cache, so give it a fresh instance first). */
export function setLitColor(node: Node, color: Color): void {
    const mr = node.getComponent(MeshRenderer);
    if (!mr) return;
    mr.material = litMaterial(color);
}

/** Set emissive glow on a lit node; falls back to brightening mainColor on unlit nodes. */
export function setEmissive(node: Node, color: Color): void {
    const mr = node.getComponent(MeshRenderer);
    if (!mr || !mr.material) return;
    const mat = mr.material;
    // builtin-standard exposes 'emissive'; builtin-unlit does not — guard by trying standard first.
    try {
        mat.setProperty('emissive', color);
    } catch {
        mat.setProperty('mainColor', color);
    }
}
