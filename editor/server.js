// Minimal editor server: bundles the UI (browser) and the core (node) with
// esbuild on start, serves the page, and reads/writes/deletes the game's level
// JSON files under game/assets/resources/levels/.
const http = require('http');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const PORT = 3000;
const ROOT = __dirname;
const LEVELS_DIR = path.resolve(ROOT, '..', 'game', 'assets', 'resources', 'levels');

let core = null; // { validateLevel, isSolvable } — loaded after the node bundle builds

function buildAll() {
    const ui = esbuild.build({
        entryPoints: [path.join(ROOT, 'src', 'main.ts')],
        bundle: true,
        outfile: path.join(ROOT, 'dist', 'editor.js'),
        platform: 'browser',
        format: 'iife',
        sourcemap: true,
        logLevel: 'info',
    });
    const node = esbuild.build({
        entryPoints: [path.join(ROOT, 'src', 'server-core.ts')],
        bundle: true,
        outfile: path.join(ROOT, 'dist', 'server-core.cjs'),
        platform: 'node',
        format: 'cjs',
        logLevel: 'info',
    });
    return Promise.all([ui, node]);
}

function send(res, code, type, body) {
    res.writeHead(code, { 'Content-Type': type });
    res.end(body);
}
function sendJson(res, code, obj) { send(res, code, 'application/json', JSON.stringify(obj)); }

function safeName(name) {
    return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : null;
}

function listLevels() {
    if (!fs.existsSync(LEVELS_DIR)) return [];
    return fs.readdirSync(LEVELS_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => ({
            name: f.replace(/\.json$/, ''),
            json: JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, f), 'utf8')),
        }));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => { data += c; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

const STATIC = {
    '/': { file: path.join(ROOT, 'index.html'), type: 'text/html' },
    '/editor.js': { file: path.join(ROOT, 'dist', 'editor.js'), type: 'text/javascript' },
    '/editor.js.map': { file: path.join(ROOT, 'dist', 'editor.js.map'), type: 'application/json' },
};

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const levelMatch = url.match(/^\/api\/levels\/([^/]+)$/);

    try {
        if (url === '/api/levels' && req.method === 'GET') {
            return sendJson(res, 200, listLevels());
        }
        if (levelMatch && req.method === 'PUT') {
            const name = safeName(decodeURIComponent(levelMatch[1]));
            if (!name) return sendJson(res, 400, { error: 'bad name' });
            const body = await readBody(req);
            let level;
            try { level = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'bad json' }); }
            const errors = core ? core.validateLevel(level) : [];
            const solvable = core ? core.isSolvable(level) : true;
            if (!fs.existsSync(LEVELS_DIR)) fs.mkdirSync(LEVELS_DIR, { recursive: true });
            fs.writeFileSync(path.join(LEVELS_DIR, `${name}.json`), JSON.stringify(level, null, 2));
            return sendJson(res, 200, { ok: true, conserved: errors.length === 0, errors, solvable });
        }
        if (levelMatch && req.method === 'DELETE') {
            const name = safeName(decodeURIComponent(levelMatch[1]));
            if (!name) return sendJson(res, 400, { error: 'bad name' });
            const fp = path.join(LEVELS_DIR, `${name}.json`);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
            return sendJson(res, 200, { ok: true });
        }

        const s = STATIC[url];
        if (s && req.method === 'GET') {
            return fs.readFile(s.file, (err, data) => {
                if (err) return send(res, 404, 'text/plain', 'not built: ' + url);
                send(res, 200, s.type, data);
            });
        }
        send(res, 404, 'text/plain', 'not found');
    } catch (e) {
        sendJson(res, 500, { error: String(e) });
    }
});

buildAll()
    .then(() => {
        core = require(path.join(ROOT, 'dist', 'server-core.cjs'));
        server.listen(PORT, () => console.log(`[editor] http://localhost:${PORT}`));
    })
    .catch((e) => {
        console.error('[editor] build failed:', e);
        process.exit(1);
    });
