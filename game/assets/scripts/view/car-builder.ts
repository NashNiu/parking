import {
    Node, Color, MeshRenderer, Material, Prefab, resources, assetManager, instantiate,
    Vec3, Mat4, utils, primitives,
} from 'cc';
import { Cap } from '../core/index';
import { litMaterial, readMainColor } from './materials';
import { blobShadow } from './blob-shadow';

// Re-exported so the view layer can keep importing Cap from here; it is core's type now,
// not a second declaration of the same three strings. `export type`, not `export`: this is
// a type and Cocos transpiles each module without the others' type information, so a value
// re-export clause would have it emit a runtime binding core/index has no value for.
export type { Cap };

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

/** Safety fallback if a model prefab failed to load: a plain colored box. */
function fallbackBox(body: Node, len: number, wid: number, color: Color): void {
    const box = new Node('box');
    const mr = box.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: len * 0.9, height: wid * 0.9, length: 0.5 }));
    mr.material = litMaterial(color);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
    box.setPosition(0, 0, 0.25); // rest on the board plane, not straddling it
    body.addChild(box);
    addShadow(body, len * 0.9, wid * 0.9);
}

/**
 * Contact shadow, parented to `body` and sized to the car's ACTUAL body
 * (`len` along body X, `wid` along body Y) so the heading rotates it with the
 * car — a car pointing up gets a tall narrow shadow, not a wide flat one. Sits
 * centered under the car: in board space the key light travels almost straight
 * into the board (-Z), so there's no meaningful lateral shadow offset to fake.
 * z = -0.06 puts it between the lot surface (-0.10) and the wheels (0).
 */
function addShadow(body: Node, len: number, wid: number): void {
    const shadow = blobShadow('shadow', len * 0.94, wid * 1.08);
    shadow.setPosition(0, 0, -0.06);
    body.addChild(shadow);
}

/** What `buildCar` hands back: the nodes to move and animate, and the size it settled on. */
export interface BuiltCar {
    /** Move this; kept unrotated, so `pickCar` can undo the body's heading itself. */
    root: Node;
    /** Animate this — squash/flash/drive operate on it, and it carries the heading. */
    body: Node;
    /** Drawn length along the body's own X, in world units. */
    len: number;
    /** Drawn width along the body's own Y. */
    wid: number;
}

/**
 * Build a cartoon car at the size and heading core says it has. The model is laid onto the
 * tilted board (roof facing the camera), lifted so its wheels rest on the board plane,
 * given a body-matched contact shadow, recolored to `color`, and turned to `angle`.
 *
 * `len` and `wid` arrive from BoardLayout.carSize, which reads core's CAP_BOX. There is no
 * footprint to fit inside any more and no shared scale to negotiate: the table says how big
 * the car is and the model is scaled to match. What that removes is the reason three
 * vehicle sizes used to read as two -- every car was fitted to its OWN footprint, so a
 * one-cell car got about half the factor a two-cell one did, and of two models sharing the
 * two-cell footprint the LONGER one was scaled down further to fit and came out smaller.
 *
 * The fitted size comes back with it: a car that later leaves the lot for a parking stall
 * has to be refitted to the stall, and only this knows how big it currently is.
 */
export function buildCar(
    name: string, len: number, wid: number, color: Color, angle: number, cap: Cap,
): BuiltCar {
    const root = new Node(name);

    // body: the animatable node. Carries the heading (about the board normal) and is what
    // squash/flash target. Kept separate from `root` so movement tweens live on root and
    // `pickCar` can undo the heading itself to test the tap in the car's own frame.
    const body = new Node('body');
    root.addChild(body);

    const prefab = prefabs[cap];
    if (!prefab) {
        fallbackBox(body, len, wid, color);
        body.setRotationFromEuler(0, 0, angle);
        return { root, body, len, wid };
    }

    const model = instantiate(prefab) as unknown as Node;
    const { center, size } = localAABB(model);

    // One uniform scale, no per-axis stretch: a car 30% wider than the artist drew it is a
    // different car. CAP_BOX was measured FROM this model, so the two ratios agree to
    // within rounding; taking the smaller is what keeps a re-exported model from spilling
    // past the size core believes it has -- core cannot see models, so this is the only
    // place a drifted export can be contained.
    const s = Math.min(len / size.x, wid / size.z);

    // What the model actually came out as, which is what the caller gets back: length along
    // body X, width along body Y (model Z after the lay-down), height along board-out +Z.
    const drawnLen = size.x * s, drawnWid = size.z * s, hgt = size.y * s;

    // `lay` lays the upright model onto the board: Rx(90) turns model-up (+Y) into
    // board-out (+Z) so the roof faces the camera; the length stays along board X.
    const lay = new Node('lay');
    lay.setRotationFromEuler(90, 0, 0);
    lay.setScale(s, s, s);
    // Lift by half the car's height so the wheels REST ON the board plane. Without
    // this the centered geometry straddles the plane and its bottom half (0.3 for a
    // car, 0.7 for a truck) is swallowed by the opaque lot slab, whose near face is
    // at z = -0.10 — the car then reads as embedded in the asphalt at a wrong angle.
    lay.setPosition(0, 0, hgt / 2);
    // Center the geometry on the lay origin (models sit on y=0, centered up).
    model.setPosition(-center.x, -center.y, -center.z);
    lay.addChild(model);
    body.addChild(lay);

    recolorCar(model, color);
    addShadow(body, drawnLen, drawnWid);

    // The body carries the heading. After the Rx(90) lay-down the model's length runs along
    // board X and its baked roof arrow points +X, so a spin of `angle` about the board
    // normal puts both the body and the arrow where core says the car is going. That the
    // arrow agrees with the exit is now true by construction: there is no footprint for the
    // body to be laid along, so there is no orientation left for the two to disagree about.
    body.setRotationFromEuler(0, 0, angle);
    return { root, body, len: drawnLen, wid: drawnWid };
}
