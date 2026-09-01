import { Node, MeshRenderer, Material, Color, EffectAsset, Vec4 } from 'cc';

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
type ColourLike = { r?: number; g?: number; b?: number; x?: number; y?: number; z?: number };

/** Linear 0..1 to sRGB 0..1, the transfer function Cocos applies to a `linear: true` property. */
function toSrgb(c: number): number {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * A property value as a Color, or null if it does not look like one.
 *
 * `linear` says the value is in LINEAR space and has to be converted. It matters because the
 * colour makes a round trip: what comes out of here goes straight into `instancedLitMaterial`,
 * which sets `mainColor` -- and `mainColor` is declared `linear: true`, so the engine converts
 * sRGB back to linear on the way in. Read a linear value, hand it over as if it were sRGB, and
 * every part comes out darker than the model says. On the hub that is 149 against 202.
 */
function toColour(v: ColourLike | null | undefined, linear: boolean): Color | null {
    if (!v) return null;
    let r = v.r ?? v.x, g = v.g ?? v.y, b = v.b ?? v.z;
    if (r == null || g == null || b == null) return null;
    // A Color arrives as 0..255, a Vec3/Vec4 as 0..1.
    if (r > 1 || g > 1 || b > 1) { r /= 255; g /= 255; b /= 255; }
    if (linear) { r = toSrgb(r); g = toSrgb(g); b = toSrgb(b); }
    return new Color(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255);
}

const _uni = new Vec4();

/**
 * The albedo a material will actually render with, or null if it cannot be read.
 *
 * WHERE AN IMPORTED MATERIAL KEEPS ITS COLOUR, which took a console diagnostic to find and is
 * not where anyone would look first. The car materials report:
 *
 *     effect=builtin-standard passes=6 props=[metallic|roughness|occlusion|albedoScale] x6
 *
 * No `albedo` and no `mainColor` anywhere -- the glTF importer writes baseColorFactor into
 * **`albedoScale`**, the Vec3 that multiplies albedo, and leaves `albedo` itself at its white
 * default. So `getProperty('mainColor')` and `getProperty('albedo')` both return null on every
 * car material, which is what sent the tyres, hubs and trim down the WHITE fallback for
 * several builds. `albedoScale` is a linear multiplier, so it needs converting; see `toColour`.
 *
 * Our OWN materials keep their colour in `mainColor` as an sRGB Color, so that is tried first
 * and is not converted.
 *
 * The pass uniform is the last resort -- it is what the GPU actually reads, so nothing can hide
 * from it -- and a WHITE result from it is REJECTED rather than returned: white is exactly the
 * effect default, so a white uniform cannot be told apart from "nobody set anything". Returning
 * it would replace an honest "I cannot read this" with a confident wrong answer, and noticing is
 * the caller's whole job. Note `passes=6`, so the loop cannot assume pass 0 carries albedo.
 */
export function readMainColor(m: Material): Color | null {
    // Ours: sRGB, as set.
    for (const name of ['mainColor', 'color']) {
        const c = toColour(m.getProperty(name) as ColourLike, false);
        if (c) return c;
    }
    // Imported: linear.
    for (const name of ['albedoScale', 'albedo', 'diffuseColor']) {
        const c = toColour(m.getProperty(name) as ColourLike, true);
        if (c) return c;
    }
    const passes = m.passes ?? [];
    for (const pass of passes) {
        for (const name of ['albedoScale', 'albedo', 'mainColor']) {
            const handle = pass.getHandle(name);
            if (!handle) continue;
            const c = toColour(pass.getUniform(handle, _uni), true);
            if (!c) continue;
            if (c.r === 255 && c.g === 255 && c.b === 255) continue;
            return c;
        }
    }
    return null;
}

/**
 * Where `readMainColor` looked, for a warning that can be acted on.
 *
 * "I could not read the colour" is not enough to fix anything -- the colour is somewhere, and
 * which reader to reach for depends on the effect and on what the material actually carries.
 */
export function describeMaterial(m: Material): string {
    const props = (m as unknown as { _props?: Record<string, unknown>[] })._props;
    const keys = props?.map((p) => Object.keys(p).join('|') || '-').join(' / ') ?? '(no _props)';
    return `effect=${m.effectName} passes=${m.passes?.length ?? 0} props=[${keys}]`;
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
