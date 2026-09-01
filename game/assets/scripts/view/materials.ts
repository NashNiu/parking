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

/**
 * Recolor a lit node by swapping in the instanced, colour-keyed material for `color`
 * (see `instancedLitMaterial`). That material is cached and SHARED across every caller
 * asking for the same colour, same as `litMaterial` -- there is no "fresh instance" to
 * give it; recoloring means pointing the renderer at a different shared material, never
 * mutating the one it already has.
 */
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
 * renderer later. Falls back to the plain lit material, which is correct but slower --
 * and warns once per colour, so a silent instancing failure shows up as a console line
 * instead of only as a frame-rate mystery.
 *
 * The fallback path stores `litMaterial(color)`'s own object under this cache's key too,
 * so that one Material ends up reachable from both caches for this colour. That is safe
 * (not a bug) only because both caches are keyed by the exact colour a caller asked for
 * and nothing in this module mutates a fetched material's `mainColor` in place --
 * recoloring always means looking up a (possibly different) cached material and
 * reassigning it, per `setLitColor` above. (`setEmissive` DOES mutate a shared material's
 * `emissive` in place, and in the fallback case it is reachable through this function --
 * but that is a different property, already true of `litMaterial`'s own cache, and at
 * most cosmetic.) If `mainColor` ever stops being immutable here, this sharing stops
 * being safe too.
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
    if (!mat) {
        console.warn(`[materials] instancing unavailable for ${k}, falling back to non-instanced (5x draw calls for this colour)`);
    }
    const result = mat ?? litMaterial(color);
    instancedCache.set(k, result);
    return result;
}

const vertexColorCache = new Map<string, Material>();

/**
 * Lit, instanced, and taking its albedo from the MESH's vertex colours rather than from a
 * uniform. `mainColor` stays white: builtin-standard computes `albedo *= v_color` under
 * `USE_VERTEX_COLOR`, so white lets the baked colours through untouched.
 *
 * This is what the drawn car is painted with (see `car-mesh.ts`). A car needs a white arrow,
 * near-black tyres and eight shades of its own paint in one object; as materials that is eleven
 * renderers per car and nothing batching, and as vertex colours it is one renderer per car.
 *
 * KEYED BY COLOUR even though the material itself does not depend on it, and that is
 * deliberate. `setEmissive` mutates a material in place, so every car sharing a material
 * flashes together -- one material for the whole lot would flash all forty-six cars on a
 * refused tap. Keyed per colour, the flash reaches the cars of one colour, exactly as it did
 * when the body was painted with `instancedLitMaterial`. Draw calls are unaffected: the mesh
 * is already per-colour, so instancing was never going to merge two colours anyway.
 *
 * Same zero-pass guard as the others: if builtin-standard builds no passes here, fall back to
 * the plain lit material for the colour. That fallback loses the vertex colours -- the car
 * comes out one flat shade -- so it warns rather than degrading in silence.
 */
export function vertexColorMaterial(color: Color): Material {
    const k = key(color);
    const hit = vertexColorCache.get(k);
    if (hit) return hit;
    let mat: Material | null = null;
    const eff = EffectAsset.get('builtin-standard');
    if (eff) {
        const m = new Material();
        try {
            m.initialize({
                effectAsset: eff,
                defines: { USE_INSTANCING: true, USE_VERTEX_COLOR: true },
            });
            if (m.passes && m.passes.length > 0) {
                m.setProperty('mainColor', Color.WHITE);
                mat = m;
            }
        } catch {
            mat = null;
        }
    }
    if (!mat) {
        console.warn(`[materials] vertex colours unavailable for ${k}; cars of this colour will`
            + ' be drawn as one flat shade');
    }
    const result = mat ?? litMaterial(color);
    vertexColorCache.set(k, result);
    return result;
}
