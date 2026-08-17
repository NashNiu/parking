// Reduce a cartoon GLB for use as a MANY-instances prop (the passenger figures).
//
// Why this exists: the models exported from Claude Design are authored for a viewer
// showing one figure, at ~20k triangles. A passenger is ~40px tall on the board with 18
// of them on screen, so full detail costs ~354k triangles a frame for detail nobody can
// see. Cocos's own LOD generation cannot help — see the note in passenger-builder.ts:
// the exported meshes are NON-INDEXED, and an edge-collapse simplifier needs the shared
// topology an index buffer provides, so it emits verbatim copies of every level.
//
// The fix has to happen before import, in this order:
//   1. dedup      — collapse primitives that are byte-identical (mirrored ears, etc).
//   2. weld on POSITION ONLY — the model is hard-edged, so every face owns its normals
//      and an exact-attribute weld leaves the triangles just as disconnected. Matching
//      on position alone is what actually creates connectivity. This is why the authored
//      normals must be discarded, and it is the one lossy step here.
//   3. simplify   — meshopt edge collapse, now that there are edges to collapse.
//   4. normals    — recompute what step 2 invalidated (smooth, no longer faceted).
//
// Node and material names survive all four steps, which passenger-builder depends on:
// it keys recoloring off the `paint` material name and LOD selection off node names.
//
// Usage (from the repo root, with the deps installed somewhere reachable):
//   npm i --no-save @gltf-transform/core @gltf-transform/functions meshoptimizer
//   node tools/reduce-model.mjs <in.glb> <out.glb> [ratio=0.25]
//
// passenger.glb in this repo is the output of:
//   node tools/reduce-model.mjs passenger-source.glb passenger.glb 0.25
// which took it from 19,684 to 3,354 triangles and 1.9 MB to 434 KB. The unprocessed
// source is not kept in the tree; it is the `Download GLB` output of the model artifact,
// and commit eca16d4 has the original bytes if they are ever needed again.

import { NodeIO } from '@gltf-transform/core';
import { dedup, simplify, normals } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [src, dst, ratioArg] = process.argv.slice(2);
if (!src || !dst) {
    console.error('usage: node tools/reduce-model.mjs <in.glb> <out.glb> [ratio]');
    process.exit(1);
}
const ratio = Number(ratioArg ?? 0.25);

const io = new NodeIO();
const doc = await io.read(src);

function triangles() {
    let t = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            const idx = prim.getIndices();
            t += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
        }
    }
    return Math.round(t);
}

console.log('source        :', triangles(), 'triangles');
await doc.transform(dedup());

// Weld on position. Keeps the first vertex of each welded group and reindexes; every
// other attribute is gathered the same way so the arrays stay parallel.
for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const n = pos.getCount();
        const seen = new Map();
        const remap = new Uint32Array(n);
        const kept = [];
        const p = [0, 0, 0];
        for (let i = 0; i < n; i++) {
            pos.getElement(i, p);
            const key = `${p[0].toFixed(5)},${p[1].toFixed(5)},${p[2].toFixed(5)}`;
            let at = seen.get(key);
            if (at === undefined) { at = kept.length; seen.set(key, at); kept.push(i); }
            remap[i] = at;
        }
        for (const semantic of prim.listSemantics()) {
            const attr = prim.getAttribute(semantic);
            const dim = attr.getElementSize();
            const from = attr.getArray();
            const to = new from.constructor(kept.length * dim);
            kept.forEach((s, d) => to.set(from.subarray(s * dim, s * dim + dim), d * dim));
            attr.setArray(to);
        }
        const idx = prim.getIndices();
        if (idx) idx.setArray(new Uint32Array(Array.from(idx.getArray(), (v) => remap[v])));
        else prim.setIndices(doc.createAccessor().setArray(remap).setBuffer(doc.getRoot().listBuffers()[0]));
    }
}
console.log('position-weld : indexed (welding alone never changes the triangle count)');

await MeshoptSimplifier.ready;
await doc.transform(
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.05, lockBorder: false }),
    normals({ overwrite: true }),
);
console.log(`simplified    : ${triangles()} triangles (ratio=${ratio}), normals recomputed`);

await io.write(dst, doc);
console.log('written       :', dst);
