// Report what the game will actually DRAW for the three car models, before importing them.
//
// Why this exists: a model's own dimensions are not what ends up on the board. Every car is
// scaled by ONE shared factor (car-builder's `sharedCarScale`) — the largest that still lets
// each capacity fit the footprint it is given — so a model set's proportions decide three
// things at once: how big each vehicle reads, how much of its footprint it fills, and how
// much bare board is left beside it in the lot. Getting that wrong is invisible in a model
// viewer and costs a full round trip through Claude Design and Cocos to discover.
//
// Usage (no dependencies, plain node, from the repo root):
//   node tools/check-car-models.mjs
//   node tools/check-car-models.mjs some/other/dir     # a candidate set before it is copied in
//
// Exits non-zero when it finds something that will look wrong, so it can gate a model swap:
//   - two capacities whose models are the same size (they will be indistinguishable)
//   - a capacity filling less than MIN_FILL of its footprint's length (a visible hole)
//
// Every number it needs comes from the source rather than a copy here, and a constant it
// cannot find is a hard error — a silent default would make this tool lie.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIN_FILL = 0.85;
const MODELS = { small: 'car', medium: 'bus', big: 'truck' };
/** Cells each capacity occupies, as (along, across). Mirrors car-builder's CAP_FOOTPRINT. */
const FOOTPRINT = { small: [1, 1], medium: [2, 1], big: [2, 1] };

// ---------------------------------------------------------------- constants, from the source

function constant(file, name) {
    const src = readFileSync(file, 'utf8');
    const m = new RegExp(`^(?:export )?const ${name} = (-?[\\d.]+);`, 'm').exec(src);
    if (!m) {
        console.error(`cannot find ${name} in ${file} — this tool is out of date with the code`);
        process.exit(2);
    }
    return parseFloat(m[1]);
}

const CTRL = 'game/assets/scripts/view/GameController.ts';
const GEN = 'game/assets/scripts/core/level-gen.ts';
const BUILDER = 'game/assets/scripts/view/car-builder.ts';

const ROAD_Y = constant(CTRL, 'ROAD_Y');
const RING_OFF = constant(CTRL, 'RING_OFF');
const RING_LOW = constant(CTRL, 'RING_LOW');
const LOT_HALF_W = constant(CTRL, 'LOT_HALF_W');
const CELL_MAX = constant(CTRL, 'CELL_MAX');
const CELL_GAP = constant(CTRL, 'CELL_GAP');
const COLS = constant(GEN, 'GRID_COLS');
const ROWS = constant(GEN, 'GRID_ROWS');
const FILL = constant(BUILDER, 'FILL');

// GameController's own expression for the grid cell: whichever budget is tighter.
const CELL = Math.min(
    CELL_MAX,
    (ROAD_Y - 2 * RING_OFF - RING_LOW - 0.3) / ROWS - CELL_GAP,
    (2 * LOT_HALF_W - 0.3) / COLS - CELL_GAP,
);

/** GridLayout.footprintSize, for a footprint given in cells. */
const footprint = (a, b) => [a * CELL + (a - 1) * CELL_GAP, b * CELL + (b - 1) * CELL_GAP];

// ---------------------------------------------------------------- the model's own AABB

function glbJson(path) {
    const buf = readFileSync(path);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a glb`);
    const total = buf.readUInt32LE(8);
    for (let off = 12; off < total;) {
        const len = buf.readUInt32LE(off);
        const type = buf.readUInt32LE(off + 4);
        if (type === 0x4e4f534a) return JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
        off += 8 + len + ((4 - (len % 4)) % 4);
    }
    throw new Error(`${path} has no JSON chunk`);
}

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            for (let k = 0; k < 4; k++) o[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
        }
    }
    return o;
}

/** A node's local matrix, row-major. glTF stores `matrix` column-major, so it transposes. */
function localMatrix(n) {
    if (n.matrix) {
        const m = n.matrix;
        return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13],
            m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]];
    }
    const [tx, ty, tz] = n.translation ?? [0, 0, 0];
    const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale ?? [1, 1, 1];
    const r = [
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
    ];
    const s = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
    const t = [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1];
    return mul(t, mul(r, s));
}

/**
 * Model-space AABB, the way car-builder's `localAABB` computes it at runtime: union each mesh
 * primitive's POSITION min/max through the node transform it hangs off.
 */
function aabb(path) {
    const g = glbJson(path);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const visit = (idx, parent) => {
        const n = g.nodes[idx];
        const m = mul(parent, localMatrix(n));
        if (n.mesh !== undefined) {
            for (const prim of g.meshes[n.mesh].primitives ?? []) {
                const acc = g.accessors[prim.attributes.POSITION];
                if (!acc?.min || !acc?.max) continue;
                for (let i = 0; i < 8; i++) {
                    const c = [0, 1, 2].map((k) => ((i >> k) & 1 ? acc.max[k] : acc.min[k]));
                    for (let k = 0; k < 3; k++) {
                        const v = m[k * 4] * c[0] + m[k * 4 + 1] * c[1] + m[k * 4 + 2] * c[2] + m[k * 4 + 3];
                        if (v < lo[k]) lo[k] = v;
                        if (v > hi[k]) hi[k] = v;
                    }
                }
            }
        }
        for (const c of n.children ?? []) visit(c, m);
    };
    for (const r of g.scenes[g.scene ?? 0].nodes ?? []) visit(r, IDENT);
    // buildCar reads X as length, Y as height, Z as width.
    return { len: hi[0] - lo[0], hgt: hi[1] - lo[1], wid: hi[2] - lo[2] };
}

// ---------------------------------------------------------------- report

const dir = process.argv[2] ?? 'game/assets/resources/models';
const caps = Object.keys(MODELS);
const model = {};
for (const cap of caps) model[cap] = aabb(join(dir, `${MODELS[cap]}.glb`));

// sharedCarScale: the largest that lets every capacity fit its own footprint.
let k = Infinity;
for (const cap of caps) {
    const [along, across] = footprint(...FOOTPRINT[cap]);
    const long = Math.max(along, across), short = Math.min(along, across);
    k = Math.min(k, (long * FILL) / model[cap].len, (short * FILL) / model[cap].wid);
}

const f3 = (n) => n.toFixed(3).padStart(6);
console.log(`grid cell ${CELL.toFixed(4)}   shared scale ${k.toFixed(4)}   (from ${dir})\n`);
console.log('cap      model L x W x H          drawn L x W x H       along%   side air');
const problems = [];
for (const cap of caps) {
    const m = model[cap];
    const [along, across] = footprint(...FOOTPRINT[cap]);
    const long = Math.max(along, across), short = Math.min(along, across);
    const drawn = { len: m.len * k, wid: m.wid * k, hgt: m.hgt * k };
    const fill = drawn.len / long;
    const air = (short - drawn.wid) / 2;
    console.log(`${cap.padEnd(8)} ${f3(m.len)} x${f3(m.wid)} x${f3(m.hgt)}   `
        + `${f3(drawn.len)} x${f3(drawn.wid)} x${f3(drawn.hgt)}    ${(fill * 100).toFixed(0).padStart(3)}%   ${air.toFixed(3)}`);
    if (fill < MIN_FILL) {
        problems.push(`${cap} fills only ${(fill * 100).toFixed(0)}% of its footprint's length `
            + `— ${(long - drawn.len).toFixed(2)} of bare board inside its own cells. `
            + `Its model is ${m.len.toFixed(2)} long and wants to be `
            + `${((long * FILL) / k).toFixed(2)} at this shared scale.`);
    }
}

for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) {
        const a = model[caps[i]], b = model[caps[j]];
        const same = ['len', 'wid', 'hgt'].every((d) => Math.abs(a[d] - b[d]) < 0.01);
        if (same) {
            problems.push(`${caps[i]} and ${caps[j]} are the same size `
                + `(${a.len.toFixed(2)} x ${a.wid.toFixed(2)} x ${a.hgt.toFixed(2)}) — `
                + `one shared scale draws them identically, so the player cannot tell them apart.`);
        }
    }
}

if (problems.length) {
    console.log('\nproblems:');
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
}
console.log('\nlooks good.');
