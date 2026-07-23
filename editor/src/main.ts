import {
    validateLevel, isSolvable, estimateDifficulty, LevelData, CarSpec, CAP_SIZE, GameCore,
} from '../../game/assets/scripts/core/index';

interface LevelEntry { name: string; json: LevelData; }

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan'];
const COLOR_HEX: Record<string, string> = {
    red: '#e64646', blue: '#4678e6', green: '#5ac85a',
    yellow: '#f0d246', purple: '#aa5ad2', cyan: '#50c8d2',
};
const CAPS: Array<CarSpec['cap']> = ['small', 'medium', 'big'];
const DIRS: Array<CarSpec['dir']> = ['up', 'down', 'left', 'right'];
const DIR_ARROW: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const CELL = 46;

let levels: LevelEntry[] = [];
let level: LevelData;
let activeName = '';
let selectedId: number | null = null;
const paint = { color: 'red', cap: 'small' as CarSpec['cap'], dir: 'up' as CarSpec['dir'] };

function clone<T>(o: T): T { return JSON.parse(JSON.stringify(o)); }
function nextCarId(): number { return level.grid.cars.reduce((m, c) => Math.max(m, c.id), 0) + 1; }

function carAt(x: number, y: number, exceptId?: number): CarSpec | null {
    for (const c of level.grid.cars) {
        if (c.id === exceptId) continue;
        if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) return c;
    }
    return null;
}

function fits(car: CarSpec): boolean {
    if (car.x < 0 || car.y < 0 || car.x + car.w > level.grid.cols || car.y + car.h > level.grid.rows) return false;
    for (let x = car.x; x < car.x + car.w; x++)
        for (let y = car.y; y < car.y + car.h; y++)
            if (carAt(x, y, car.id)) return false;
    return true;
}

// ---------- rendering ----------

function el(tag: string, cls?: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function render(): void {
    renderLibrary();
    renderCanvas();
    renderInspector();
}

function renderLibrary(): void {
    const lib = document.getElementById('library')!;
    lib.innerHTML = '<h3>关卡库</h3>';

    const nameInput = document.createElement('input');
    nameInput.id = 'nameInput';
    nameInput.className = 'nameInput';
    nameInput.value = activeName;
    nameInput.placeholder = '关卡名';
    lib.appendChild(nameInput);

    const bar = el('div', 'libbar');
    const save = el('button', 'primary', '💾 保存');
    save.onclick = saveLevel;
    const neo = el('button', '', '+ 新建');
    neo.onclick = newLevel;
    const copy = el('button', '', '复制');
    copy.onclick = copyLevel;
    const del = el('button', 'danger', '删除');
    del.onclick = deleteLevel;
    bar.appendChild(save); bar.appendChild(neo); bar.appendChild(copy); bar.appendChild(del);
    lib.appendChild(bar);

    const status = el('div', 'savestatus', '');
    status.id = 'saveStatus';
    lib.appendChild(status);

    for (const e of levels) {
        const div = el('div', 'lvitem' + (e.name === activeName ? ' active' : ''), e.name);
        div.onclick = () => { loadIntoEditor(e); };
        lib.appendChild(div);
    }
}

function renderCanvas(): void {
    const canvas = document.getElementById('canvas')!;
    canvas.innerHTML = '';
    if (playing) { renderPlaytest(canvas); return; }
    canvas.appendChild(el('h3', undefined, `编辑区 · ${activeName || '(未命名)'}`));
    canvas.appendChild(renderPaintbar());
    const playRow = el('div', 'row2');
    const play = el('button', 'primary', '▶ 试玩');
    play.onclick = enterPlaytest;
    playRow.appendChild(play);
    canvas.appendChild(playRow);
    canvas.appendChild(renderGrid());
    canvas.appendChild(el('p', 'hint', '点空格放车 · 点车选中(右栏改属性)'));
}

function renderPaintbar(): HTMLElement {
    const bar = el('div', 'paintbar');
    bar.appendChild(el('span', 'lbl', '新车:'));
    for (const c of COLORS) {
        const sw = el('span', 'swatch' + (paint.color === c ? ' sel' : ''));
        sw.style.background = COLOR_HEX[c];
        sw.onclick = () => { paint.color = c; renderCanvas(); };
        bar.appendChild(sw);
    }
    for (const cap of CAPS) {
        const b = el('button', paint.cap === cap ? 'sel' : '', cap);
        b.onclick = () => { paint.cap = cap; renderCanvas(); };
        bar.appendChild(b);
    }
    for (const d of DIRS) {
        const b = el('button', paint.dir === d ? 'sel' : '', DIR_ARROW[d]);
        b.onclick = () => { paint.dir = d; renderCanvas(); };
        bar.appendChild(b);
    }
    return bar;
}

function renderGrid(): HTMLElement {
    const g = el('div', 'grid');
    g.style.gridTemplateColumns = `repeat(${level.grid.cols}, ${CELL}px)`;
    g.style.gridTemplateRows = `repeat(${level.grid.rows}, ${CELL}px)`;

    for (let y = 0; y < level.grid.rows; y++) {
        for (let x = 0; x < level.grid.cols; x++) {
            const cell = el('div', 'cell');
            cell.style.gridColumn = `${x + 1}`;
            cell.style.gridRow = `${y + 1}`;
            cell.onclick = () => addCar(x, y);
            g.appendChild(cell);
        }
    }
    for (const c of level.grid.cars) {
        const car = el('div', 'car' + (c.id === selectedId ? ' sel' : ''), DIR_ARROW[c.dir]);
        car.style.gridColumn = `${c.x + 1} / span ${c.w}`;
        car.style.gridRow = `${c.y + 1} / span ${c.h}`;
        car.style.background = COLOR_HEX[c.color] || '#888';
        car.onclick = (ev) => { ev.stopPropagation(); selectedId = c.id; render(); };
        g.appendChild(car);
    }
    return g;
}

function renderInspector(): void {
    const insp = document.getElementById('inspector')!;
    insp.innerHTML = '<h3>属性 / 校验</h3>';

    // selected car
    const car = level.grid.cars.find((c) => c.id === selectedId) || null;
    if (car) {
        insp.appendChild(el('h4', undefined, `选中车 #${car.id}`));
        insp.appendChild(rowSelect('颜色', COLORS, car.color, (v) => { car.color = v; commit(); }));
        insp.appendChild(rowSelect('尺寸', CAPS, car.cap, (v) => { car.cap = v as CarSpec['cap']; commit(); }));
        insp.appendChild(rowSelect('朝向', DIRS, car.dir, (v) => { car.dir = v as CarSpec['dir']; commit(); }));
        insp.appendChild(rowStepper('宽 w', car.w, 1, level.grid.cols, (v) => { const o = car.w; car.w = v; if (!fits(car)) car.w = o; commit(); }));
        insp.appendChild(rowStepper('高 h', car.h, 1, level.grid.rows, (v) => { const o = car.h; car.h = v; if (!fits(car)) car.h = o; commit(); }));
        const del = el('button', 'danger', '删除此车');
        del.onclick = () => { level.grid.cars = level.grid.cars.filter((c) => c.id !== car.id); selectedId = null; commit(); };
        insp.appendChild(del);
    }

    // grid size
    insp.appendChild(el('h4', undefined, '网格'));
    insp.appendChild(rowStepper('列 cols', level.grid.cols, 1, 12, (v) => { level.grid.cols = v; dropOutOfBounds(); commit(); }));
    insp.appendChild(rowStepper('行 rows', level.grid.rows, 1, 14, (v) => { level.grid.rows = v; dropOutOfBounds(); commit(); }));

    // parking
    insp.appendChild(el('h4', undefined, '车位'));
    insp.appendChild(rowStepper('总数 slots', level.parking.slots, 1, 12, (v) => { level.parking.slots = v; if (level.parking.unlocked > v) level.parking.unlocked = v; commit(); }));
    insp.appendChild(rowStepper('可用 unlocked', level.parking.unlocked, 1, level.parking.slots, (v) => { level.parking.unlocked = v; commit(); }));

    // queue
    insp.appendChild(el('h4', undefined, '乘客队列'));
    level.loop.queue.forEach((seg, i) => {
        insp.appendChild(renderQueueSeg(seg, i));
    });
    const add = el('button', '', '+ 加一段');
    add.onclick = () => { level.loop.queue.push({ color: paint.color, count: 8 }); commit(); };
    insp.appendChild(add);
    const bal = el('button', 'primary', '按车容量自动配平');
    bal.onclick = autoBalance;
    insp.appendChild(bal);

    // validation
    insp.appendChild(renderValidation());
}

function rowSelect(label: string, opts: string[], value: string, onChange: (v: string) => void): HTMLElement {
    const row = el('div', 'row');
    row.appendChild(el('label', undefined, label));
    const sel = document.createElement('select');
    for (const o of opts) {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o; if (o === value) opt.selected = true;
        sel.appendChild(opt);
    }
    sel.onchange = () => onChange(sel.value);
    row.appendChild(sel);
    return row;
}

function rowStepper(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
    const row = el('div', 'row');
    row.appendChild(el('label', undefined, label));
    const dec = el('button', 'step', '−');
    const num = el('span', 'num', String(value));
    const inc = el('button', 'step', '+');
    dec.onclick = () => { if (value > min) onChange(value - 1); };
    inc.onclick = () => { if (value < max) onChange(value + 1); };
    row.appendChild(dec); row.appendChild(num); row.appendChild(inc);
    return row;
}

function renderQueueSeg(seg: { color: string; count: number }, i: number): HTMLElement {
    const row = el('div', 'row');
    const sw = el('span', 'swatch small');
    sw.style.background = COLOR_HEX[seg.color] || '#888';
    row.appendChild(sw);
    const sel = document.createElement('select');
    for (const c of COLORS) {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c; if (c === seg.color) opt.selected = true;
        sel.appendChild(opt);
    }
    sel.onchange = () => { seg.color = sel.value; commit(); };
    row.appendChild(sel);
    const dec = el('button', 'step', '−');
    const num = el('span', 'num', String(seg.count));
    const inc = el('button', 'step', '+');
    dec.onclick = () => { seg.count = Math.max(1, seg.count - 4); commit(); };
    inc.onclick = () => { seg.count += 4; commit(); };
    row.appendChild(dec); row.appendChild(num); row.appendChild(inc);
    const del = el('button', 'step', '✕');
    del.onclick = () => { level.loop.queue.splice(i, 1); commit(); };
    row.appendChild(del);
    return row;
}

function renderValidation(): HTMLElement {
    const box = el('div', 'validation');
    const errs = validateLevel(level);
    const conserved = errs.length === 0;
    const solvable = isSolvable(level);
    const diff = estimateDifficulty(level);
    box.appendChild(el('h4', undefined, '校验'));
    const c = el('p'); c.innerHTML = `守恒:<span class="${conserved ? 'ok' : 'bad'}">${conserved ? '✅ 平衡' : '❌ ' + errs.join('; ')}</span>`;
    box.appendChild(c);
    const s = el('p'); s.innerHTML = `可解:<span class="${solvable ? 'ok' : 'bad'}">${solvable ? '✅ 有解' : '❌ 无解/死锁'}</span>`;
    box.appendChild(s);
    box.appendChild(el('p', undefined, `难度分:${conserved ? diff.score : '—'}`));
    box.appendChild(el('p', 'dim', `rounds ${diff.rounds} · blocked ${diff.blocked} · cars ${diff.cars} · colors ${diff.colors}`));
    return box;
}

// ---------- actions ----------

function addCar(x: number, y: number): void {
    if (carAt(x, y)) return;
    const car: CarSpec = { id: nextCarId(), x, y, w: 1, h: 1, dir: paint.dir, color: paint.color, cap: paint.cap };
    level.grid.cars.push(car);
    selectedId = car.id;
    commit();
}

function dropOutOfBounds(): void {
    level.grid.cars = level.grid.cars.filter(
        (c) => c.x + c.w <= level.grid.cols && c.y + c.h <= level.grid.rows,
    );
}

function autoBalance(): void {
    const byColor: Record<string, number> = {};
    for (const c of level.grid.cars) byColor[c.color] = (byColor[c.color] || 0) + CAP_SIZE[c.cap];
    level.loop.queue = Object.keys(byColor).map((color) => ({ color, count: byColor[color] }));
    commit();
}

function commit(): void {
    // Re-render only the editing surfaces, not the library (keeps the name input stable).
    renderCanvas();
    renderInspector();
}

function loadIntoEditor(entry: LevelEntry): void {
    activeName = entry.name;
    level = clone(entry.json);
    selectedId = null;
    render();
}

function blankLevel(): LevelData {
    return {
        id: 1,
        grid: { cols: 5, rows: 6, cars: [] },
        parking: { slots: 7, unlocked: 4 },
        loop: { capacity: 12, boardIndex: 6, queue: [] },
        powerups: { refresh: 3, hardClear: 1, magnet: 1 },
    };
}

function suggestName(): string {
    let n = 1;
    const taken = new Set(levels.map((l) => l.name));
    while (taken.has(`level-${n}`)) n++;
    return `level-${n}`;
}

function newLevel(): void {
    activeName = suggestName();
    level = blankLevel();
    selectedId = null;
    render();
}

function copyLevel(): void {
    activeName = (activeName || 'level') + '-copy';
    selectedId = null;
    render();
}

function setStatus(msg: string, ok: boolean): void {
    const s = document.getElementById('saveStatus');
    if (s) { s.textContent = msg; s.className = 'savestatus ' + (ok ? 'ok' : 'bad'); }
}

async function saveLevel(): Promise<void> {
    const input = document.getElementById('nameInput') as HTMLInputElement | null;
    const name = (input?.value || '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) { setStatus('名称需为字母/数字/-/_', false); return; }
    const res = await fetch(`/api/levels/${encodeURIComponent(name)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(level),
    });
    const r = await res.json();
    activeName = name;
    await refreshLevels();
    render();
    if (!r.conserved) setStatus('已保存(⚠️不守恒)', false);
    else if (!r.solvable) setStatus('已保存(⚠️无解)', false);
    else setStatus('已保存 ✅', true);
}

async function deleteLevel(): Promise<void> {
    if (!activeName) return;
    if (!confirm(`删除关卡 "${activeName}"?`)) return;
    await fetch(`/api/levels/${encodeURIComponent(activeName)}`, { method: 'DELETE' });
    await refreshLevels();
    if (levels.length > 0) loadIntoEditor(levels[0]);
    else newLevel();
}

async function refreshLevels(): Promise<void> {
    levels = await (await fetch('/api/levels')).json();
}

// ---------- playtest ----------

let playing = false;
let pcore: GameCore | null = null;
let playTimer: number | null = null;

function enterPlaytest(): void {
    if (validateLevel(level).length > 0) { alert('关卡不守恒,请先"自动配平"再试玩'); return; }
    pcore = new GameCore(clone(level));
    playing = true;
    renderCanvas();
    playTimer = window.setInterval(playTick, 150);
}

function exitPlaytest(): void {
    if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
    playing = false;
    pcore = null;
    renderCanvas();
}

function playTick(): void {
    if (!pcore) return;
    if (pcore.getState() === 'playing') pcore.stepLoop();
    updatePlayStatus();
    if (pcore.getState() !== 'playing' && playTimer !== null) {
        clearInterval(playTimer); playTimer = null;
    }
}

function renderPlaytest(canvas: HTMLElement): void {
    canvas.appendChild(el('h3', undefined, `试玩 · ${activeName}`));
    const stop = el('button', 'danger', '■ 停止试玩');
    stop.onclick = exitPlaytest;
    canvas.appendChild(stop);
    canvas.appendChild(renderPlayGrid());
    const status = el('div', 'playstatus');
    status.id = 'playStatus';
    canvas.appendChild(status);
    canvas.appendChild(el('p', 'hint', '点车开进车位;乘客自动上车、坐满开走'));
    updatePlayStatus();
}

function renderPlayGrid(): HTMLElement {
    const g = el('div', 'grid');
    const cols = pcore!.grid.cols;
    const rows = pcore!.grid.rows;
    g.style.gridTemplateColumns = `repeat(${cols}, ${CELL}px)`;
    g.style.gridTemplateRows = `repeat(${rows}, ${CELL}px)`;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const cell = el('div', 'cell');
            cell.style.gridColumn = `${x + 1}`;
            cell.style.gridRow = `${y + 1}`;
            g.appendChild(cell);
        }
    }
    for (const c of pcore!.grid.cars.values()) {
        const car = el('div', 'car', DIR_ARROW[c.dir]);
        car.style.gridColumn = `${c.x + 1} / span ${c.w}`;
        car.style.gridRow = `${c.y + 1} / span ${c.h}`;
        car.style.background = COLOR_HEX[c.color] || '#888';
        car.onclick = () => {
            const r = pcore!.tapCar(c.id);
            if (r.ok) renderCanvas();
        };
        g.appendChild(car);
    }
    return g;
}

function updatePlayStatus(): void {
    const s = document.getElementById('playStatus');
    if (!s || !pcore) return;
    const state = pcore.getState();
    const remaining = pcore.loop.remainingCount();
    const parked = pcore.parking.parked
        .map((p, i) => (p ? `位${i}:${p.color} ${p.filled}/${p.capacity}` : `位${i}:空`))
        .join('   ');
    const banner = state === 'won' ? '🎉 过关!' : state === 'deadlock' ? '💀 卡住了(死锁)' : '进行中…';
    s.innerHTML = `<p><b>${banner}</b> · 剩余乘客 ${remaining}</p><p class="dim">${parked}</p>`;
}

async function main(): Promise<void> {
    const res = await fetch('/api/levels');
    levels = await res.json();
    if (levels.length > 0) {
        loadIntoEditor(levels[0]);
    } else {
        level = { id: 1, grid: { cols: 5, rows: 6, cars: [] }, parking: { slots: 7, unlocked: 4 }, loop: { capacity: 12, boardIndex: 6, queue: [] }, powerups: { refresh: 3, hardClear: 1, magnet: 1 } };
        render();
    }
}

main();
