import {
    Node, Color, MeshRenderer, Material, Prefab, resources, assetManager, instantiate,
    Vec3, Mat4, utils, primitives,
} from 'cc';
import { Dir } from './placeholder';
import { litMaterial } from './materials';
import { blobShadow } from './blob-shadow';

export type Cap = 'small' | 'medium' | 'big';

/**
 * Real 3D car art (cartoon GLB models made in Claude Design), one per capacity.
 * These live under assets/resources/models and are loaded as prefabs. Each model
 * shares the same rig: a named `paint` material for the body (recolored per car),
 * plus glass/trim/lamp/taillamp/tire/hub (kept as authored). The roof direction
 * arrow is baked into the model (the white `trim` chevron), so we don't add one.
 */
const MODEL_PATH: Record<Cap, string> = {
    small: 'models/car',
    medium: 'models/bus',
    big: 'models/truck',
};

/**
 * UUID of each model's prefab (gltf-scene) sub-asset. glTF sub-assets aren't always
 * reachable by a bare `resources.load(path, Prefab)` — the resources bundle indexes
 * them as `<glb>/<sub>`, so the bare path misses ("Bundle doesn't contain models/car").
 * Loading the prefab sub-asset directly by uuid via assetManager bypasses the path
 * index entirely (same approach used for builtin-standard). These come from the
 * `.glb.meta` files; if a model is re-exported/re-imported its uuid changes, so
 * update here from the meta's gltf-scene subMeta uuid.
 */
const MODEL_UUID: Record<Cap, string> = {
    small: '0a5670d4-ef6b-4e90-a818-f9cf574eaf43@aa365',
    medium: '9d619bee-3267-4376-840b-a12353416992@d3cbc',
    big: 'f16c714b-27c9-4522-996f-44428e88f71d@c0498',
};

const prefabs: Partial<Record<Cap, Prefab>> = {};

/**
 * Preload all three car prefabs, then call `done`. buildCar() is synchronous
 * (called during board render), so the prefabs must be resident first. Tries the
 * resources path first (works if the bundle indexes it), then falls back to a
 * direct uuid load. If both fail, buildCar falls back to a plain colored box.
 */
export function preloadCarModels(done: () => void): void {
    const caps: Cap[] = ['small', 'medium', 'big'];
    let remaining = caps.length;
    const finish = (): void => { if (--remaining === 0) done(); };
    for (const cap of caps) {
        resources.load(MODEL_PATH[cap], Prefab, (err, prefab) => {
            if (!err && prefab) { prefabs[cap] = prefab; finish(); return; }
            assetManager.loadAny({ uuid: MODEL_UUID[cap] }, (e2, asset) => {
                if (e2 || !asset) console.warn('[car] model load failed:', cap, e2 || 'no asset');
                else prefabs[cap] = asset as Prefab;
                finish();
            });
        });
    }
}

// Scratch objects for the local-AABB computation (avoid per-car allocation churn).
const _rootInv = new Mat4();
const _m = new Mat4();
const _c = new Vec3();

/**
 * Local-space AABB of an instantiated model, expressed in the model root's own
 * frame. Unions each MeshRenderer's mesh min/max transformed by the renderer's
 * transform relative to the root. Works on a detached (not-yet-parented) node.
 */
function localAABB(root: Node): { center: Vec3; size: Vec3 } {
    Mat4.invert(_rootInv, root.worldMatrix);
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (const mr of root.getComponentsInChildren(MeshRenderer)) {
        const mesh = mr.mesh;
        if (!mesh) continue;
        const mn = mesh.struct.minPosition;
        const mx = mesh.struct.maxPosition;
        if (!mn || !mx) continue;
        Mat4.multiply(_m, _rootInv, mr.node.worldMatrix);
        for (let i = 0; i < 8; i++) {
            _c.set(i & 1 ? mx.x : mn.x, i & 2 ? mx.y : mn.y, i & 4 ? mx.z : mn.z);
            Vec3.transformMat4(_c, _c, _m);
            if (_c.x < minx) minx = _c.x; if (_c.x > maxx) maxx = _c.x;
            if (_c.y < miny) miny = _c.y; if (_c.y > maxy) maxy = _c.y;
            if (_c.z < minz) minz = _c.z; if (_c.z > maxz) maxz = _c.z;
        }
    }
    if (minx === Infinity) return { center: new Vec3(), size: new Vec3(1, 1, 1) };
    return {
        center: new Vec3((minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2),
        size: new Vec3(maxx - minx, maxy - miny, maxz - minz),
    };
}

// The models export `paint` as teal (0.03,0.56,0.72) and `glass` as dark navy
// (0.03,0.07,0.15). We detect roles by default color (robust — works even if the
// imported Material's `.name` is stripped) and fall back to a name match.
const PAINT_TEAL = { r: 8, g: 143, b: 184 };
const GLASS_NAVY = { r: 8, g: 18, b: 38 };

/** Read a material's mainColor as 0-255 RGB, tolerating a 0-1 (linear/Vec4) return. */
function readMainColor(m: Material): { r: number; g: number; b: number } | null {
    const v = m.getProperty('mainColor') as { r?: number; g?: number; b?: number; x?: number; y?: number; z?: number } | undefined;
    if (!v) return null;
    const r = v.r ?? v.x, g = v.g ?? v.y, b = v.b ?? v.z;
    if (r == null || g == null || b == null) return null;
    const s = (r <= 1 && g <= 1 && b <= 1) ? 255 : 1;
    return { r: r * s, g: g * s, b: b * s };
}

function matchesRole(m: Material, role: 'paint' | 'glass'): boolean {
    if ((m.name || '').toLowerCase().includes(role)) return true;
    const c = readMainColor(m);
    if (!c) return false;
    const t = role === 'paint' ? PAINT_TEAL : GLASS_NAVY;
    return Math.abs(c.r - t.r) + Math.abs(c.g - t.g) + Math.abs(c.b - t.b) < 90;
}

function scaleColor(c: Color, f: number): Color {
    return new Color(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f), 255);
}

/**
 * Recolor the car body by REPLACING the paint/glass material slots with our own
 * opaque litMaterial (the same builtin-standard material the balls use — proven to
 * render its color reliably). We don't mutate the imported glTF materials: on these
 * models `mainColor` overrides didn't reliably reach the albedo, and the glass is
 * semi-transparent (so tinting it left the canopy dark from the top-down camera).
 * Replacing the slot guarantees a solid, correctly-colored body. Paint → `color`;
 * glass canopy → a slightly darker tint (a hint of "window" while still clearly the
 * car's color). Lamps/trim/tires/hubs keep their authored materials.
 * litMaterial is builtin-standard, so the emissive tap/flash feedback still works.
 */
function recolorCar(model: Node, color: Color): void {
    const paintMat = litMaterial(color);
    const glassMat = litMaterial(scaleColor(color, 0.72));
    for (const mr of model.getComponentsInChildren(MeshRenderer)) {
        const mats = mr.sharedMaterials;
        for (let i = 0; i < mats.length; i++) {
            const m = mats[i];
            if (!m) continue;
            if (matchesRole(m, 'paint')) mr.setMaterial(paintMat, i);
            else if (matchesRole(m, 'glass')) mr.setMaterial(glassMat, i);
        }
    }
}

/**
 * Spin (about the board normal +Z) applied to `body`. After the Rx(90) lay-down the
 * model's length runs along board X and its baked roof arrow points +X. From there:
 *  - Square footprint (1×1): no "longer axis", so orient by the exit direction — the
 *    arrow points at the exit (up→90, down→270, left→180, right→0).
 *  - Longer axis is X (wide car): keep length along X; flip 180° for `left` so the
 *    arrow aims at the exit. up/down here are the "wide car facing across its length"
 *    mismatch — the arrow can't point at the exit — accepted per design.
 *  - Longer axis is Y (tall car): rotate 90° so length runs along board Y; arrow points
 *    +Y (up), 270° for `down`.
 */
function orientAngle(dir: Dir, sizeX: number, sizeY: number): number {
    if (Math.abs(sizeX - sizeY) < 1e-3) {
        return dir === 'up' ? 90 : dir === 'down' ? 270 : dir === 'left' ? 180 : 0;
    }
    if (sizeX > sizeY) return dir === 'left' ? 180 : 0;
    return dir === 'down' ? 270 : 90;
}

/** Safety fallback if a model prefab failed to load: a plain colored box. */
function fallbackBox(body: Node, sizeX: number, sizeY: number, color: Color): void {
    const mr = body.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: sizeX * 0.9, height: sizeY * 0.9, length: 0.5 }));
    mr.material = litMaterial(color);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
}

/**
 * Build a cartoon car sized to its footprint from the real 3D model. Returns
 * `root` (move this; kept unrotated so footprint picking stays valid) and `body`
 * (animate this — squash/flash/drive operate on it). The model is laid flat onto
 * the tilted board (roof facing the camera) and recolored to `color`.
 */
export function buildCar(
    name: string, sizeX: number, sizeY: number, color: Color, dir: Dir, cap: Cap,
): { root: Node; body: Node } {
    const root = new Node(name);

    // Fake contact shadow tucked under the car (lies against the board plane).
    const shadow = blobShadow('shadow', sizeX * 0.9, sizeY * 0.5);
    shadow.setPosition(0, -sizeY * 0.32, -0.06);
    root.addChild(shadow);

    // body: the animatable node. Carries the dir spin (about the board normal) and
    // is what squash/flash target. Kept separate from `root` so movement tweens on
    // root and picking (root.position + footprint half-extents) stay clean.
    const body = new Node('body');
    root.addChild(body);

    const prefab = prefabs[cap];
    if (!prefab) {
        fallbackBox(body, sizeX, sizeY, color);
        return { root, body };
    }

    const model = instantiate(prefab) as unknown as Node;
    const { center, size } = localAABB(model);

    // Preserve the model's TRUE proportions: one uniform scale (no per-axis stretch),
    // laying its length along the footprint's LONGER axis and fitting within it. This
    // keeps a long bus looking long instead of squashing it to fill a wide-shallow cell.
    const longDim = Math.max(sizeX, sizeY);
    const shortDim = Math.min(sizeX, sizeY);
    const fill = 0.9;
    const s = Math.min((longDim * fill) / size.x, (shortDim * fill) / size.z);

    // `lay` lays the upright model onto the board: Rx(90) turns model-up (+Y) into
    // board-out (+Z) so the roof faces the camera; the length stays along board X.
    const lay = new Node('lay');
    lay.setRotationFromEuler(90, 0, 0);
    lay.setScale(s, s, s);
    // Center the geometry on the body origin (models sit on y=0, centered up).
    model.setPosition(-center.x, -center.y, -center.z);
    lay.addChild(model);
    body.addChild(lay);

    recolorCar(model, color);

    body.setRotationFromEuler(0, 0, orientAngle(dir, sizeX, sizeY));
    return { root, body };
}
