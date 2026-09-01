import {
    Node, Color, Mesh, MeshRenderer, Material, Prefab, resources, assetManager, instantiate,
    Vec3, Mat4, utils, primitives,
} from 'cc';
import { Cap } from '../core/index';
import { instancedLitMaterial, readMainColor } from './materials';
import { blobShadow } from './blob-shadow';
import { mergeParts, triPart } from './slabs';

// Re-exported so the view layer can keep importing Cap from here; it is core's type now,
// not a second declaration of the same three strings. `export type`, not `export`: this is
// a type and Cocos transpiles each module without the others' type information, so a value
// re-export clause would have it emit a runtime binding core/index has no value for.
export type { Cap };

/**
 * Real 3D car art (cartoon GLB models made in Claude Design), one per capacity.
 * These live under assets/resources/models and are loaded as prefabs. Each model
 * shares the same rig: a named `paint` material for the body (recolored per car),
 * plus glass/trim/lamp/taillamp/tire/hub (kept as authored). The model's own baked
 * `roof_arrow` is switched OFF and replaced by `roofDecal` -- see the note there for why
 * nothing else on the model can be seen from this camera either.
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

/**
 * Which of `trim`'s jobs a node is doing, by name -- and it has to be by name, because the
 * model gives all of them ONE material.
 *
 * `trim` is the only material in bus/car/truck.glb with **no `baseColorFactor`**, and glTF
 * says that means white. Three nodes share it: `sill`, a 2.0 x 1.1 flat slab lying under the
 * whole car; `bumper_front`/`bumper_rear`; and `roof_arrow`, the plate that says which way
 * the car leaves. All three therefore came out white, which is one bug wearing two faces:
 *
 * - the sill is wider than the painted body (1.10 against 1.04), so a white tray showed all
 *   round the car and read as a BACKGROUND behind it rather than as part of it;
 * - and the arrow, being the same white, had nothing to stand out against.
 *
 * So the fix is not to recolour `trim` but to stop treating it as one thing. The sill and
 * bumpers take a dark neutral, which in this flat art reads as a stroke around the car and
 * lets the body read as one object; the arrow keeps the white and becomes the ONLY white on
 * the car, which is what makes it legible. Node names come straight from the glTF and Cocos
 * keeps them (`sill`, `roof_arrow`, ...), so this is as stable as the model itself.
 */
function trimRole(nodeName: string): 'chassis' | 'arrow' | null {
    const n = nodeName.toLowerCase();
    if (n.includes('arrow')) return 'arrow';
    if (n.includes('sill') || n.includes('bumper')) return 'chassis';
    return null;
}

/**
 * THE CAMERA SEES THE ROOF AND ALMOST NOTHING ELSE, which is why the car is drawn on top of
 * the model rather than tuned inside it.
 *
 * The camera is orthographic and looks at the board straight on, and the model is laid down
 * with its roof toward it. Measured on car.glb, in model units with the roof at depth 1.63:
 * the windshield sits at 1.37, the lamps at 0.85, the sill at 0.41 and the wheels at 0.43 --
 * every one of them BEHIND the roof, showing only where it pokes past the roof's silhouette:
 * 0.025 for the windshield, 0.03 for the sill, 0.09 for the bumpers and lamps, 0.28 for the
 * wheels and 0.16 for the hubcaps. Those last two are the little white dashes along a car's
 * flank -- a hubcap seen edge-on. Eight of the model's nine primitives are invisible.
 *
 * So no recolouring could ever make it read as a car: from here a car IS a flat coloured
 * roof. What it needs is structure ON that roof, and that is what this draws -- a windscreen
 * and a rear window in one dark mesh, and a direction arrow in one white one.
 *
 * The other two routes were considered and rejected. Tilting the model back to the 3/4 view
 * it was built for would show the windscreen and the wheels, but the drawn car would stop
 * matching core's footprint -- which is the whole reason the camera is orthographic (see the
 * README note on that), and it would take picking and "is it blocked?" with it. Replacing
 * the models needs art that does not exist yet.
 *
 * Proportions are FRACTIONS of the car, not fixed sizes, because the three caps differ in
 * length by more than 2x and a fixed windscreen would swallow the small car.
 */
const ROOF_LIFT = 0.01;
const DECAL_D = 0.02;
/**
 * The arrow, as fractions of the car: how far forward of centre it sits, and how much of the
 * length and width it takes. Fractions rather than sizes because the three caps differ in
 * length by more than 2x, and one number would either lose the arrow on the truck or bury
 * the small car under it.
 */
const ROOF_ARROW = { x: 0.04, w: 0.30, h: 0.48 };

const arrowMeshes = new Map<string, Mesh>();

/**
 * The arrow on the roof, and nothing else on it.
 *
 * Windows were drawn here too for one build and taken out: at 40px a car cannot carry three
 * marks, and a windscreen plus a rear window plus an arrow read as two dark blocks with a
 * triangle between them rather than as a car. What the roof has to say is which colour the
 * car is and which way it leaves -- and the body already says the first.
 *
 * One mesh cached per car size (there are only three caps) and one shared white material, so
 * the whole board costs about one draw call for all the arrows on it.
 *
 * It points +X because that is where the car leaves: `buildCar` turns `body` by the car's
 * heading and the model's length already runs along body X, so this agrees with the exit by
 * construction, exactly as the baked arrow it replaces did.
 */
function roofDecal(body: Node, len: number, wid: number, hgt: number): void {
    const key = `${len.toFixed(3)},${wid.toFixed(3)}`;
    let mesh = arrowMeshes.get(key);
    if (!mesh) {
        mesh = mergeParts([
            triPart(len * ROOF_ARROW.w, wid * ROOF_ARROW.h, DECAL_D, len * ROOF_ARROW.x, 0),
        ]);
        arrowMeshes.set(key, mesh);
    }
    const arrow = new Node('roof-arrow');
    const mr = arrow.addComponent(MeshRenderer);
    mr.mesh = mesh;
    mr.material = instancedLitMaterial(Color.WHITE);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    // Clear of the roof, which is at z = hgt in body space (`lay` centres the model there).
    arrow.setPosition(0, 0, hgt + ROOF_LIFT);
    body.addChild(arrow);
}

/**
 * How much darker the sill and bumpers are than the body, and the white the arrow has to
 * itself.
 *
 * A shade of the car's OWN colour, not a neutral. A dark slate was tried first and it just
 * swapped one problem for the other: the tray stopped being white and started being black,
 * because what reads as a tray is the CONTRAST, not the colour. At 0.88 the sill and bumpers
 * are the same car, a touch darker where they sit lower -- so there is no second object for
 * the eye to separate out, which is the only way the tray goes away.
 *
 * That the sill and bumpers stick out at all is the model's doing: the sill is 1.10 across
 * against a 1.04 body, and the bumpers reach x = 1.36 against the body's 1.27. So they will
 * always show; the question is only whether they show as the car or as something behind it.
 */
const CHASSIS_SHADE = 0.88;

function scaleColor(c: Color, f: number): Color {
    return new Color(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f), 255);
}

/**
 * Give every material slot on the car an INSTANCED material of the right colour.
 *
 * Two jobs in one pass, and the second is why it touches slots it does not recolour.
 *
 * RECOLOURING. The paint slot takes `color` and the glass canopy a slightly darker tint --
 * a hint of window while still clearly the car's colour. The imported glTF materials are
 * replaced rather than mutated: on these models `mainColor` overrides did not reliably
 * reach the albedo, and the authored glass is semi-transparent, so tinting it left the
 * canopy dark under a top-down camera. Replacing the slot guarantees a solid body.
 *
 * INSTANCING, which is a frame-rate fix measured on a device. Each model is 9 primitives,
 * so 9 MeshRenderers, and a level holds 46 cars: about 414 draw calls for the lot alone,
 * against roughly 600 in the whole scene. At 18fps -- 55ms a frame -- that is about what
 * 600 mobile draw calls cost, and the cars were the bulk of it. 46 copies of the same 9
 * meshes is the textbook instancing case, and it only works if the material is instanced
 * TOO, so the five roles nobody recolours (trim, lamps, taillamps, tyres, hubs) have to be
 * swapped as well or they keep a non-instanced draw each.
 *
 * Swapping them costs nothing, and that is a fact about these particular models rather
 * than an assumption: all three GLBs carry ZERO textures and ZERO images, and their
 * materials are a flat baseColorFactor. There is no authored detail for a flat lit material
 * of the same colour to lose. Re-check that if the models are ever re-exported with a
 * texture -- `readMainColor` would silently flatten it away.
 *
 * SIX of the seven materials carry a baseColorFactor. The seventh, `trim`, does not, and
 * that one needs `trimRole` rather than a colour read -- see the note there.
 *
 * `instancedLitMaterial` is builtin-standard, so the emissive flash still works. It is
 * shared per colour, so flashing one car flashes every car of that colour -- already true
 * before this change, and the one surviving caller (the deadlock highlight) wants all of
 * them anyway.
 */
function recolorCar(model: Node, color: Color): void {
    const paintMat = instancedLitMaterial(color);
    const glassMat = instancedLitMaterial(scaleColor(color, 0.72));
    const chassisMat = instancedLitMaterial(scaleColor(color, CHASSIS_SHADE));
    for (const mr of model.getComponentsInChildren(MeshRenderer)) {
        const role = trimRole(mr.node.name);
        const mats = mr.sharedMaterials;
        for (let i = 0; i < mats.length; i++) {
            const m = mats[i];
            if (!m) continue;
            if (matchesRole(m, 'paint')) mr.setMaterial(paintMat, i);
            else if (matchesRole(m, 'glass')) mr.setMaterial(glassMat, i);
            else if (role === 'chassis') mr.setMaterial(chassisMat, i);
            // Everything left keeps its own colour and gains instancing. The lamps, the
            // tyres and the hubs all carry a baseColorFactor, so `readMainColor` has
            // something to read and the fallback never fires for them.
            else mr.setMaterial(instancedLitMaterial(readMainColor(m) ?? Color.WHITE), i);
        }
    }
}

/** Safety fallback if a model prefab failed to load: a plain colored box. */
function fallbackBox(body: Node, len: number, wid: number, color: Color): void {
    const box = new Node('box');
    const mr = box.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: len * 0.9, height: wid * 0.9, length: 0.5 }));
    mr.material = instancedLitMaterial(color);
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
/**
 * Switch off the model's baked roof arrow, which `roofDecal` replaces.
 *
 * It is 0.9 x 0.76 with a node scale of 0.88 x 0.72 already on it, so it covers 0.79 x 0.55
 * of a roof 2.5 long -- and scaling it up (1.3x, then 1.8x) never made it read. Left on, it
 * would sit under the drawn arrow and fight it.
 */
function hideBakedArrow(model: Node): void {
    for (const mr of model.getComponentsInChildren(MeshRenderer)) {
        if (trimRole(mr.node.name) === 'arrow') mr.node.active = false;
    }
}

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
    hideBakedArrow(model);
    roofDecal(body, drawnLen, drawnWid, hgt);
    addShadow(body, drawnLen, drawnWid);

    // The body carries the heading. After the Rx(90) lay-down the model's length runs along
    // board X and its baked roof arrow points +X, so a spin of `angle` about the board
    // normal puts both the body and the arrow where core says the car is going. That the
    // arrow agrees with the exit is now true by construction: there is no footprint for the
    // body to be laid along, so there is no orientation left for the two to disagree about.
    body.setRotationFromEuler(0, 0, angle);
    return { root, body, len: drawnLen, wid: drawnWid };
}
