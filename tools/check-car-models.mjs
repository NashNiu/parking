// Check the three car models against the size core believes they are, before importing them.
//
// Why this exists: `CAP_BOX` in core/types.ts is the SOURCE of every car's drawn size, and it
// is a hand-copied table. Core cannot read a .glb — it must not even import from Cocos — so
// nothing in the codebase can notice when a re-exported model stops matching it. The failure
// is quiet and asymmetric: car-builder scales by `Math.min(len / size.x, wid / size.z)`, so a
// model that grew silently SHRINKS the car on screen, and shrinks `pickCar`'s hit box with
// it. A tap that misses is a long way from a diff that says why.
//
// This tool is that missing notice. It parses the glb itself and runs car-builder's own
// arithmetic over it.
//
// One property worth knowing before trusting the numbers: the PASS/FAIL is scale-invariant.
// `drawn = m * min(want.len / m.len, want.wid / m.wid)` cancels every common factor, so
// CAR_SCALE and the board pitch drop out of the shortfall entirely. They are carried anyway,
// because the printed "drawn" column is meant to be the size that appears on screen -- but a
// wrong PITCH would give a wrong headline and the same verdict.
//
// Note what can and cannot go wrong. A model's ABSOLUTE size is irrelevant: each capacity is
// scaled by its own `s`, so whatever the artist exported, the car is drawn at CAP_BOX times
// the board pitch. What matters is the model's PROPORTIONS. `s` is a min over the two axes,
// so if the model's length:width ratio drifts from the table's, one axis binds and the other
// comes out SHORT -- the car no longer fills the box core reserved for it, and the gap shows
// up as air beside a car that the packer thought was occupied.
//
// Usage (no dependencies, plain node, from the repo root):
//   node tools/check-car-models.mjs
//   node tools/check-car-models.mjs some/other/dir     # a candidate set before it is copied in
//
// Exits non-zero when it finds something that will look wrong, so it can gate a model swap:
//   - a model whose proportions leave more than BOX_TOLERANCE of its CAP_BOX row unfilled
//   - two capacities the table gives the same size (they will be indistinguishable)
//
// Every number it needs comes from the source rather than a copy here, and a constant it
// cannot find is a hard error — a validator that fills in a default is a validator that lies.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How much of its declared CAP_BOX a car may leave unfilled before it is a problem, as a
 * FRACTION of the axis it is short on. Relative rather than absolute, so it means the same
 * thing to a small car's 0.471 width as to a big one's 1.949 length -- 0.02 board units was
 * 4% of the one and 1% of the other. The three models currently ship at under 0.2%.
 */
const BOX_TOLERANCE = 0.02;
const MODELS = { small: 'car', medium: 'bus', big: 'truck' };

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

/** `LOT` is an object literal, so `constant` cannot see it. */
function lotExtent(file) {
    const src = readFileSync(file, 'utf8');
    const m = /^export const LOT: Lot = \{ w: ([\d.]+), h: ([\d.]+) \};/m.exec(src);
    if (!m) {
        console.error(`cannot find LOT in ${file} — this tool is out of date with the code`);
        process.exit(2);
    }
    return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
}

/**
 * One row of CAP_BOX, likewise a literal rather than a bare number.
 *
 * Scoped to the CAP_BOX declaration rather than searched across the file: `len`/`wid` is a
 * shape any future `Record<Cap, Box>` could share, and matching one of those instead would
 * be silent.
 */
function capBox(file, cap) {
    const src = readFileSync(file, 'utf8');
    const block = /export const CAP_BOX: Record<Cap, Box> = \{([\s\S]*?)\n\};/.exec(src);
    if (!block) {
        console.error(`cannot find the CAP_BOX declaration in ${file} — this tool is out of date`);
        process.exit(2);
    }
    const m = new RegExp(`${cap}:\\s*\\{ len: ([\\d.]+), wid: ([\\d.]+) \\}`).exec(block[1]);
    if (!m) {
        console.error(`cannot find CAP_BOX.${cap} in ${file} — this tool is out of date`);
        process.exit(2);
    }
    return { len: parseFloat(m[1]), wid: parseFloat(m[2]) };
}

const CTRL = 'game/assets/scripts/view/GameController.ts';
const GEN = 'game/assets/scripts/core/level-gen.ts';
const TYPES = 'game/assets/scripts/core/types.ts';

const ROAD_Y = constant(CTRL, 'ROAD_Y');
const RING_OFF = constant(CTRL, 'RING_OFF');
const RING_LOW = constant(CTRL, 'RING_LOW');
const LOT_HALF_W = constant(CTRL, 'LOT_HALF_W');
const CELL_MAX = constant(CTRL, 'CELL_MAX');
const CELL_GAP = constant(CTRL, 'CELL_GAP');
const LOT = lotExtent(GEN);
const CAR_SCALE = constant(TYPES, 'CAR_SCALE');

// GameController's own expression, verbatim: the board scale is whichever budget is tighter.
// One board unit is this many world units, which is what turns a measured AABB into the units
// CAP_BOX is written in.
const PITCH = Math.min(
    CELL_MAX,
    (ROAD_Y - 2 * RING_OFF - RING_LOW - 0.3) / LOT.h - CELL_GAP,
    (2 * LOT_HALF_W - 0.3) / LOT.w - CELL_GAP,
) + CELL_GAP;

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
const table = {};
for (const cap of caps) {
    model[cap] = aabb(join(dir, `${MODELS[cap]}.glb`));
    table[cap] = capBox(TYPES, cap);
}

const f3 = (n) => n.toFixed(3).padStart(6);
console.log(`board pitch ${PITCH.toFixed(4)} world units, car scale ${CAR_SCALE}   (models from ${dir})\n`);
console.log('cap      model L x W x H           declared L x W   drawn L x W      short');
const problems = [];
for (const cap of caps) {
    const m = model[cap];
    const want = table[cap];
    // car-builder's own arithmetic: one uniform scale, the min over both axes.
    const wantLen = want.len * CAR_SCALE * PITCH;
    const wantWid = want.wid * CAR_SCALE * PITCH;
    const s = Math.min(wantLen / m.len, wantWid / m.wid);
    const drawn = { len: (m.len * s) / (CAR_SCALE * PITCH), wid: (m.wid * s) / (CAR_SCALE * PITCH) };
    const shortLen = (want.len - drawn.len) / want.len;
    const shortWid = (want.wid - drawn.wid) / want.wid;
    const short = Math.max(shortLen, shortWid);
    console.log(`${cap.padEnd(8)} ${f3(m.len)} x${f3(m.wid)} x${f3(m.hgt)}   `
        + `${f3(want.len)} x${f3(want.wid)}   ${f3(drawn.len)} x${f3(drawn.wid)}   `
        + `${(short * 100).toFixed(2)}%`);
    if (short > BOX_TOLERANCE) {
        const axis = shortLen > shortWid ? 'length' : 'width';
        problems.push(`${cap}: the model is ${(m.len / m.wid).toFixed(3)} long for every 1 wide, `
            + `but CAP_BOX asks for ${(want.len / want.wid).toFixed(3)}. Scaled uniformly it comes `
            + `out ${(short * 100).toFixed(1)}% short across its ${axis}, so the car does not fill `
            + `the space the packer reserved for it. Either re-proportion the model, or set `
            + `CAP_BOX.${cap} in core/types.ts to ${drawn.len.toFixed(3)} x ${drawn.wid.toFixed(3)} `
            + `and re-run "cd logic && npm run gen" -- the packer sizes its boxes from that table, `
            + `so the shipped levels stay laid out for the old size until they are regenerated.`);
    }
}

// Two ways the three can fail to read as three, and they need separate checks.
//
// The table can say they are the same size, which no model can fix: each is scaled to its own
// row, so the table is what decides how big the three come out.
for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) {
        const a = table[caps[i]], b = table[caps[j]];
        if (Math.abs(a.len - b.len) < 0.01 && Math.abs(a.wid - b.wid) < 0.01) {
            problems.push(`CAP_BOX gives ${caps[i]} and ${caps[j]} the same size `
                + `(${a.len} x ${a.wid}) — the player cannot tell them apart. The models' own `
                + `sizes cannot fix this: each is scaled to its own row.`);
        }
    }
}
// Or two of the glb files can be the same MESH, which the shortfall check above cannot see:
// copy truck.glb over bus.glb and its ratio is close enough to the bus row to pass, so the
// bus would silently be drawn as a shrunken truck. Compare the raw AABBs for that.
for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) {
        const a = model[caps[i]], b = model[caps[j]];
        if (['len', 'wid', 'hgt'].every((d) => Math.abs(a[d] - b[d]) < 1e-4)) {
            problems.push(`${MODELS[caps[i]]}.glb and ${MODELS[caps[j]]}.glb are the same mesh `
                + `(${a.len.toFixed(3)} x ${a.wid.toFixed(3)} x ${a.hgt.toFixed(3)}) — one is a copy `
                + `of the other, so ${caps[i]} and ${caps[j]} will be the same vehicle at two `
                + `sizes. Which file was overwritten is not something this can tell you.`);
        }
    }
}

if (problems.length) {
    console.log('\nproblems:');
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
}
console.log('\nlooks good.');
