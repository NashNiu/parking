import { Node, MeshRenderer, Material, Color, EffectAsset } from 'cc';

const litCache = new Map<string, Material>();

function key(c: Color): string {
    return `${c.r},${c.g},${c.b}`;
}

/**
 * Try to build a lit builtin-standard material. Returns null if the effect isn't
 * usable at runtime (in some pipeline/scene setups builtin-standard yields zero
 * passes when created via `new Material()`, which later crashes the renderer).
 * We only accept it once we've confirmed it actually built passes.
 */
function tryStandard(color: Color): Material | null {
    const eff = EffectAsset.get('builtin-standard');
    if (!eff) return null;
    const mat = new Material();
    try {
        mat.initialize({ effectAsset: eff });
        if (!mat.passes || mat.passes.length === 0) return null;
        // builtin-standard's albedo color property is named `mainColor` (its
        // shader target is `albedo`). roughness (0.5) / metallic (0) defaults
        // already give the matte cartoon look we want.
        mat.setProperty('mainColor', color);
        return mat;
    } catch {
        return null;
    }
}

/**
 * Cartoon material. Prefers builtin-standard (real lighting); falls back to
 * builtin-unlit (flat, but always renders) if standard can't build passes here.
 * Cached per color.
 */
export function litMaterial(color: Color): Material {
    const k = key(color);
    const hit = litCache.get(k);
    if (hit) return hit;
    const mat = tryStandard(color) ?? unlitMaterial(color);
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

/**
 * Set emissive glow on every MeshRenderer in a node's subtree; falls back to
 * brightening mainColor on unlit nodes. Composed nodes (e.g. cars) have no
 * MeshRenderer on the root/body — the meshes live on descendant nodes
 * (chassis/cabin/etc.) — so we must walk the whole subtree, not just `node`.
 */
export function setEmissive(node: Node, color: Color): void {
    const mrs = node.getComponentsInChildren(MeshRenderer);
    for (const mr of mrs) {
        if (!mr.material) continue;
        const mat = mr.material;
        // builtin-standard exposes 'emissive'; builtin-unlit does not — guard by trying standard first.
        try {
            mat.setProperty('emissive', color);
        } catch {
            mat.setProperty('mainColor', color);
        }
    }
}
