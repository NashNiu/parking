import {
    Node, Color, Mesh, MeshRenderer, Material, Prefab, resources, assetManager, instantiate,
    Vec3, Mat4, gfx, utils,
} from 'cc';
import { litMaterial, readMainColor } from './materials';

/**
 * Real 3D passenger art (the same cartoon GLB pipeline the cars use). The model
 * lives at assets/resources/models/passenger.glb and exports five materials:
 * `paint` (clothes — recolored per passenger), plus `trim`, `skin`, `eye` and
 * `shoe`, which keep their authored colors.
 *
 * Unlike a car, a passenger is drawn MANY times at once (12 ring slots + 6 waiting
 * slots + fliers), so the raw prefab is never instantiated into the scene: its 19
 * separate meshes would cost 19 draw calls each, ~340 for a full track. Instead the
 * prefab is instantiated exactly once at preload, its geometry baked into ONE merged
 * mesh per material role (see `bake`), and every passenger node reuses those five
 * shared meshes — 5 draw calls apiece.
 */
const MODEL_PATH = 'models/passenger';

/**
 * UUID of the model's prefab (gltf-scene) sub-asset — see car-builder for why the
 * bare `resources.load(path, Prefab)` can miss on glTF sub-assets. From
 * `passenger.glb.meta`; re-exporting the model changes it.
 */
const MODEL_UUID = '5e130d29-2afb-4d1b-bba3-f90534c5422c@72429';

/** Material roles the model exports. `paint` is the one recolored per passenger. */
const ROLES = ['paint', 'trim', 'skin', 'eye', 'shoe'] as const;
type Role = typeof ROLES[number];

/** Role a material belongs to, by name (`paint.material` → `paint`). */
function roleOf(m: Material | null): Role {
    const n = (m?.name || '').toLowerCase();
    for (const r of ROLES) if (n.includes(r)) return r;
    return 'trim';
}

interface Baked {
    /** Merged geometry per role, in the model root's frame, centered on the origin. */
    meshes: { role: Role; mesh: Mesh }[];
    /** Authored albedo per role, used for every role except `paint`. */
    colors: Partial<Record<Role, Color>>;
    /** Size of the baked geometry, so callers can scale to a target height. */
    size: Vec3;
}

let prefab: Prefab | null = null;
let baked: Baked | null = null;

/**
 * Preload the passenger prefab, then call `done`. buildPassenger() is synchronous
 * (called while the track is being built), so the prefab must be resident first.
 * Tries the resources path, then a direct uuid load; if both fail, buildPassenger
 * falls back to the old four-ball clump.
 */
export function preloadPassengerModel(done: () => void): void {
    resources.load(MODEL_PATH, Prefab, (err, p) => {
        if (!err && p) { prefab = p; done(); return; }
        assetManager.loadAny({ uuid: MODEL_UUID }, (e2, asset) => {
            if (e2 || !asset) console.warn('[pax] model load failed:', e2 || 'no asset');
            else prefab = asset as Prefab;
            done();
        });
    });
}

// Scratch objects for the bake (it runs once, but keep the churn out of the loop).
const _rootInv = new Mat4();
const _m = new Mat4();
const _v = new Vec3();

interface Group { positions: number[]; normals: number[]; uvs: number[]; indices: number[] }

function emptyGroup(): Group {
    return { positions: [], normals: [], uvs: [], indices: [] };
}

/**
 * Instantiate the prefab once and collapse it into one mesh per material role.
 *
 * Every sub-mesh is read back with `readAttribute`/`readIndices` and rewritten into
 * the model root's frame (positions through the renderer's relative matrix, normals
 * through the same matrix as directions), so the baked meshes need no node hierarchy
 * to reproduce the model's pose — a flat node per role is enough. The result is
 * translated so the model's bounding box is centered on the origin, matching how the
 * four-ball cluster it replaces sat on its node.
 *
 * Returns null if the geometry can't be read (compressed meshes answer null), which
 * sends buildPassenger to its fallback rather than drawing nothing.
 */
function bake(source: Prefab): Baked | null {
    const root = instantiate(source) as unknown as Node;
    Mat4.invert(_rootInv, root.worldMatrix);

    const groups = new Map<Role, Group>();
    const colors: Partial<Record<Role, Color>> = {};
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;

    for (const mr of root.getComponentsInChildren(MeshRenderer)) {
        const mesh = mr.mesh;
        if (!mesh) continue;
        Mat4.multiply(_m, _rootInv, mr.node.worldMatrix);

        const count = mesh.struct.primitives.length;
        for (let sub = 0; sub < count; sub++) {
            // Only a plain triangle list can be concatenated by offsetting indices;
            // a strip or fan would need its topology expanded first. The field is
            // optional and defaults to TRIANGLE_LIST, which is what these models use.
            const mode = mesh.struct.primitives[sub].primitiveMode;
            if (mode !== undefined && mode !== gfx.PrimitiveMode.TRIANGLE_LIST) {
                root.destroy();
                return null;
            }
            const pos = mesh.readAttribute(sub, gfx.AttributeName.ATTR_POSITION);
            if (!pos) { root.destroy(); return null; }
            // These models export NON-INDEXED triangle lists (the imported struct has
            // no indexView at all), so readIndices answers null and the vertices are
            // already in draw order. Synthesize the identity index run in that case —
            // treating null as failure is what sent the first attempt to the fallback.
            const idx = mesh.readIndices(sub);
            const nrm = mesh.readAttribute(sub, gfx.AttributeName.ATTR_NORMAL);
            const uv = mesh.readAttribute(sub, gfx.AttributeName.ATTR_TEX_COORD);

            const mat = mr.sharedMaterials[sub] ?? mr.sharedMaterials[0] ?? null;
            const role = roleOf(mat);
            if (!colors[role] && mat) {
                const c = readMainColor(mat);
                if (c) colors[role] = c;
            }

            let g = groups.get(role);
            if (!g) { g = emptyGroup(); groups.set(role, g); }
            const base = g.positions.length / 3;

            const verts = pos.length / 3;
            for (let i = 0; i < verts; i++) {
                _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
                Vec3.transformMat4(_v, _v, _m);
                g.positions.push(_v.x, _v.y, _v.z);
                if (_v.x < minx) minx = _v.x; if (_v.x > maxx) maxx = _v.x;
                if (_v.y < miny) miny = _v.y; if (_v.y > maxy) maxy = _v.y;
                if (_v.z < minz) minz = _v.z; if (_v.z > maxz) maxz = _v.z;

                if (nrm) {
                    _v.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
                    Vec3.transformMat4Normal(_v, _v, _m);
                    _v.normalize();
                    g.normals.push(_v.x, _v.y, _v.z);
                }
                if (uv) g.uvs.push(uv[i * 2], uv[i * 2 + 1]);
            }
            if (idx) for (let i = 0; i < idx.length; i++) g.indices.push(idx[i] + base);
            else for (let i = 0; i < verts; i++) g.indices.push(base + i);
        }
    }
    root.destroy();
    if (minx === Infinity) return null;

    // Center the baked geometry on the origin so a passenger node's position is the
    // figure's middle, exactly like the four-ball cluster's node position was.
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
    const meshes: { role: Role; mesh: Mesh }[] = [];
    for (const role of ROLES) {
        const g = groups.get(role);
        if (!g || g.indices.length === 0) continue;
        for (let i = 0; i < g.positions.length; i += 3) {
            g.positions[i] -= cx;
            g.positions[i + 1] -= cy;
            g.positions[i + 2] -= cz;
        }
        meshes.push({
            role,
            mesh: utils.createMesh({
                positions: g.positions,
                normals: g.normals.length ? g.normals : undefined,
                uvs: g.uvs.length ? g.uvs : undefined,
                indices: g.indices,
            }),
        });
    }
    if (meshes.length === 0) return null;
    return { meshes, colors, size: new Vec3(maxx - minx, maxy - miny, maxz - minz) };
}

/** Bake on first use (the prefab is resident by then) and reuse forever after. */
function bakedModel(): Baked | null {
    if (baked) return baked;
    if (!prefab) return null;
    baked = bake(prefab);
    if (!baked) console.warn('[pax] model bake failed, falling back to ball clusters');
    return baked;
}

/** True once the model is loaded and bakeable — callers use it to pick a fallback. */
export function passengerModelReady(): boolean {
    return bakedModel() !== null;
}

/** Node name carrying a role's geometry, so recolor can tell `paint` from the rest. */
function roleNodeName(role: Role): string {
    return `role-${role}`;
}

/**
 * Build a passenger figure `height` units tall, standing on the board plane and
 * facing the camera. Returns a root node whose own transform is untouched (scale 1,
 * position 0) so callers can position and tween it freely — the fit scale lives on
 * an inner node. Returns null if the model isn't available; callers fall back.
 */
export function buildPassenger(name: string, color: Color, height: number): Node | null {
    const model = bakedModel();
    if (!model) return null;

    const root = new Node(name);
    // The model stands along +Y and faces +Z, which is exactly the board's own frame
    // (+Y up the board, +Z out toward the camera), so no rotation is needed — unlike
    // the cars, which are laid flat with Rx(90) because they're seen from above.
    const fit = new Node('fit');
    const s = height / model.size.y;
    fit.setScale(s, s, s);
    root.addChild(fit);

    for (const { role, mesh } of model.meshes) {
        const n = new Node(roleNodeName(role));
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = mesh;
        mr.material = litMaterial(role === 'paint' ? color : (model.colors[role] ?? Color.WHITE));
        fit.addChild(n);
    }
    return root;
}

/**
 * Recolor a passenger built by `buildPassenger`. Only the `paint` role takes the
 * passenger's color; the others keep their authored albedo. `shade` scales every
 * role, so a dimmed waiting passenger dims as a whole figure rather than going
 * two-tone (the inactive channel has to read as inactive at a glance).
 */
export function recolorPassenger(root: Node, color: Color, shade: (c: Color) => Color): void {
    const model = baked;
    if (!model) return;
    for (const mr of root.getComponentsInChildren(MeshRenderer)) {
        const role = mr.node.name.replace('role-', '') as Role;
        const base = role === 'paint' ? color : (model.colors[role] ?? Color.WHITE);
        mr.material = litMaterial(shade(base));
    }
}
