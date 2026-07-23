// Minimal editor server: bundles the UI with esbuild on start, serves the page,
// and reads/writes the game's level JSON files under game/assets/resources/levels/.
const http = require('http');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const PORT = 3000;
const ROOT = __dirname;
const LEVELS_DIR = path.resolve(ROOT, '..', 'game', 'assets', 'resources', 'levels');

function build() {
    return esbuild.build({
        entryPoints: [path.join(ROOT, 'src', 'main.ts')],
        bundle: true,
        outfile: path.join(ROOT, 'dist', 'editor.js'),
        platform: 'browser',
        format: 'iife',
        sourcemap: true,
        logLevel: 'info',
    });
}

function send(res, code, type, body) {
    res.writeHead(code, { 'Content-Type': type });
    res.end(body);
}

function listLevels() {
    if (!fs.existsSync(LEVELS_DIR)) return [];
    return fs.readdirSync(LEVELS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({
            name: f.replace(/\.json$/, ''),
            json: JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, f), 'utf8')),
        }));
}

const STATIC = {
    '/': { file: path.join(ROOT, 'index.html'), type: 'text/html' },
    '/editor.js': { file: path.join(ROOT, 'dist', 'editor.js'), type: 'text/javascript' },
    '/editor.js.map': { file: path.join(ROOT, 'dist', 'editor.js.map'), type: 'application/json' },
};

const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/api/levels' && req.method === 'GET') {
        try {
            return send(res, 200, 'application/json', JSON.stringify(listLevels()));
        } catch (e) {
            return send(res, 500, 'text/plain', String(e));
        }
    }

    const s = STATIC[url];
    if (s) {
        return fs.readFile(s.file, (err, data) => {
            if (err) return send(res, 404, 'text/plain', 'not built: ' + url);
            send(res, 200, s.type, data);
        });
    }
    send(res, 404, 'text/plain', 'not found');
});

build()
    .then(() => server.listen(PORT, () => console.log(`[editor] http://localhost:${PORT}`)))
    .catch((e) => {
        console.error('[editor] build failed:', e);
        process.exit(1);
    });
