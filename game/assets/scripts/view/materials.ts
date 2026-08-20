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

/**
 * Read a material's albedo as 0-255 RGB, tolerating a 0-1 (linear/Vec4) return.
 * Imported glTF materials answer `mainColor` in either range depending on how the
 * property was authored, so callers that compare against a known 0-255 reference
 * (car-builder's role detection) or rebuild a `litMaterial` from it (the passenger
 * model's non-recolored roles) must normalize first. Returns null if the material
 * has no readable `mainColor`.
 */
export function readMainColor(m: Material): Color | null {
    const v = m.getProperty('mainColor') as
        { r?: number; g?: number; b?: number; x?: number; y?: number; z?: number } | undefined;
    if (!v) return null;
    const r = v.r ?? v.x, g = v.g ?? v.y, b = v.b ?? v.z;
    if (r == null || g == null || b == null) return null;
    const s = (r <= 1 && g <= 1 && b <= 1) ? 255 : 1;
    return new Color(Math.round(r * s), Math.round(g * s), Math.round(b * s), 255);
}

/** Unlit solid color (for UI-ish bits that must stay bright regardless of lighting). */
export function unlitMaterial(color: Color): Material {
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-unlit' });
    mat.setProperty('mainColor', color);
    return mat;
}

const flatCache = new Map<string, Material>();
const alphaCache = new Map<string, Material>();

/**
 * Unlit solid colour, CACHED and therefore SHARED — never mutate what this returns.
 * `unlitMaterial` stays uncached for callers that recolour the instance they are handed;
 * this one is for the scene's flat ground panels, where dozens of nodes ask for the same
 * handful of colours.
 */
export function flatMaterial(color: Color): Material {
    const k = key(color);
    const hit = flatCache.get(k);
    if (hit) return hit;
    const mat = unlitMaterial(color);
    flatCache.set(k, mat);
    return mat;
}

/**
 * Translucent unlit colour, cached and shared. Technique 1 of `builtin-unlit` is its
 * transparent pass, which is the one that honours the alpha in `mainColor`.
 */
export function alphaMaterial(color: Color): Material {
    const k = `${key(color)},${color.a}`;
    const hit = alphaCache.get(k);
    if (hit) return hit;
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-unlit', technique: 1 });
    mat.setProperty('mainColor', color);
    alphaCache.set(k, mat);
    return mat;
}

/** Recolor a lit node (its material is shared from cache, so give it a fresh instance first). */
export function setLitColor(node: Node, color: Color): void {
    const mr = node.getComponent(MeshRenderer);
    if (!mr) return;
    mr.material = instancedLitMaterial(color);
}

/**
 * Set emissive glow on every builtin-standard MeshRenderer in a node's subtree.
 * Composed nodes (e.g. cars) have no MeshRenderer on the root/body — the meshes
 * live on descendant nodes (chassis/cabin/etc.) — so we walk the whole subtree.
 * Unlit meshes (direction arrow, fill bars) are skipped: `builtin-unlit` has no
 * `emissive` uniform, so touching it only spams "illegal property" warnings and
 * risks clobbering their `mainColor`. Only `builtin-standard` supports emissive.
 */
export function setEmissive(node: Node, color: Color): void {
    const mrs = node.getComponentsInChildren(MeshRenderer);
    for (const mr of mrs) {
        const mat = mr.material;
        if (!mat || mat.effectName !== 'builtin-standard') continue;
        mat.setProperty('emissive', color);
    }
}

const instancedCache = new Map<string, Material>();

/**
 * Lit material with GPU instancing on. Every model sharing a mesh AND this exact
 * material collapses into one instanced draw call, which is what makes a 26-row track
 * affordable: the passenger figures are 100+ copies of five baked meshes, so the whole
 * crowd costs about one draw call per (mesh, colour) pair instead of five per figure.
 *
 * Same zero-pass guard as `tryStandard`: in some pipeline setups builtin-standard
 * builds no passes when created at runtime, and a pass-less material crashes the
 * renderer later. Falls back to the plain lit material, which is correct but slower.
 */
export function instancedLitMaterial(color: Color): Material {
    const k = key(color);
    const hit = instancedCache.get(k);
    if (hit) return hit;
    let mat: Material | null = null;
    const eff = EffectAsset.get('builtin-standard');
    if (eff) {
        const m = new Material();
        try {
            m.initialize({ effectAsset: eff, defines: { USE_INSTANCING: true } });
            if (m.passes && m.passes.length > 0) {
                m.setProperty('mainColor', color);
                mat = m;
            }
        } catch {
            mat = null;
        }
    }
    const result = mat ?? litMaterial(color);
    instancedCache.set(k, result);
    return result;
}
