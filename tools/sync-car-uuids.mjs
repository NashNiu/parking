#!/usr/bin/env node
// Rewrite MODEL_UUID in car-builder.ts from the models' own .glb.meta files.
//
// WHY THIS EXISTS. `preloadCarModels` tries `resources.load('models/car', Prefab)` first and
// falls back to loading the prefab sub-asset directly by uuid, because the resources bundle
// does not always index a glTF sub-asset by its bare path. Those uuids are `<glb-uuid>@<id>`,
// and the `@<id>` half is regenerated when Cocos re-imports a replaced .glb -- so every model
// swap silently rots the fallback. The comment above MODEL_UUID has said "update here from
// the meta's gltf-scene subMeta uuid" since the models went in; this does it.
//
// Run it AFTER Cocos has re-imported the new .glb files (the .meta must already be updated).
//
// USAGE
//   node tools/sync-car-uuids.mjs            rewrite car-builder.ts
//   node tools/sync-car-uuids.mjs --check    report only, non-zero if stale (for CI)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = join(REPO, 'game', 'assets', 'resources', 'models');
const SOURCE = join(REPO, 'game', 'assets', 'scripts', 'view', 'car-builder.ts');
const CHECK = process.argv.includes('--check');

// cap -> model file, matching MODEL_PATH in car-builder.ts.
const MODEL = { small: 'car', medium: 'bus', big: 'truck' };

/** The prefab sub-asset uuid inside a .glb.meta: the one whose importer is `gltf-scene`. */
function sceneUuid(metaPath) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const subs = Object.values(meta.subMetas ?? {});
    const scene = subs.find((s) => s.importer === 'gltf-scene');
    if (!scene) throw new Error(`no gltf-scene sub-asset in ${metaPath} -- has Cocos imported it?`);
    return scene.uuid;
}

const wanted = {};
for (const [cap, file] of Object.entries(MODEL)) {
    const meta = join(MODELS, `${file}.glb.meta`);
    if (!existsSync(meta)) {
        console.error(`[uuids] missing ${meta}`);
        process.exit(1);
    }
    wanted[cap] = sceneUuid(meta);
}

const src = readFileSync(SOURCE, 'utf8');
const crlf = src.includes('\r\n');
let out = src.replace(/\r\n/g, '\n');
let stale = 0;

for (const [cap, uuid] of Object.entries(wanted)) {
    // Match only inside the MODEL_UUID literal: `    small: '<uuid>',`
    const re = new RegExp(`(${cap}: ')([0-9a-f-]+@[0-9a-f]+)(')`);
    const found = out.match(re);
    if (!found) {
        console.error(`[uuids] could not find the ${cap} entry in MODEL_UUID`);
        process.exit(1);
    }
    if (found[2] === uuid) {
        console.log(`  ${cap.padEnd(7)} ok    ${uuid}`);
        continue;
    }
    stale++;
    console.log(`  ${cap.padEnd(7)} STALE ${found[2]}`);
    console.log(`  ${''.padEnd(7)}    ->  ${uuid}`);
    out = out.replace(re, `$1${uuid}$3`);
}

if (!stale) {
    console.log('[uuids] MODEL_UUID already matches the models.');
    process.exit(0);
}
if (CHECK) {
    console.error(`[uuids] ${stale} entr${stale === 1 ? 'y is' : 'ies are'} stale.`
        + ' Run `npm run uuids` to fix.');
    process.exit(1);
}
writeFileSync(SOURCE, crlf ? out.replace(/\n/g, '\r\n') : out, 'utf8');
console.log(`[uuids] updated ${stale} entr${stale === 1 ? 'y' : 'ies'} in car-builder.ts`);
