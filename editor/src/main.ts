import {
    validateLevel, isSolvable, estimateDifficulty, LevelData,
} from '../../game/assets/scripts/core/index';

interface LevelEntry {
    name: string;
    json: LevelData;
}

async function loadLevels(): Promise<LevelEntry[]> {
    const res = await fetch('/api/levels');
    return res.json();
}

function renderLibrary(levels: LevelEntry[], onPick: (e: LevelEntry) => void, activeName: string): void {
    const lib = document.getElementById('library')!;
    lib.innerHTML = '<h3>关卡库</h3>';
    for (const e of levels) {
        const div = document.createElement('div');
        div.className = 'lvitem' + (e.name === activeName ? ' active' : '');
        div.textContent = e.name;
        div.onclick = () => onPick(e);
        lib.appendChild(div);
    }
}

function showLevel(entry: LevelEntry): void {
    const level = entry.json;
    const canvas = document.getElementById('canvas')!;
    canvas.innerHTML = `<h3>编辑区 · ${entry.name}</h3>
        <p>网格 ${level.grid.cols} × ${level.grid.rows},车 ${level.grid.cars.length} 辆</p>
        <p>车位 ${level.parking.unlocked} / ${level.parking.slots}(可用 / 总)</p>
        <p>乘客队列:${level.loop.queue.map((q) => `${q.color}×${q.count}`).join(', ')}</p>`;

    const insp = document.getElementById('inspector')!;
    const errs = validateLevel(level);
    const conserved = errs.length === 0;
    const solvable = isSolvable(level);
    const diff = estimateDifficulty(level);
    insp.innerHTML = `<h3>属性 / 校验</h3>
        <p>守恒:<span class="${conserved ? 'ok' : 'bad'}">${conserved ? '✅ 平衡' : '❌ ' + errs.join('; ')}</span></p>
        <p>可解:<span class="${solvable ? 'ok' : 'bad'}">${solvable ? '✅ 有解' : '❌ 无解/死锁'}</span></p>
        <p>难度分:${conserved ? diff.score : '—'}</p>
        <p style="color:#8b93a8">rounds ${diff.rounds} · blocked ${diff.blocked} · cars ${diff.cars} · colors ${diff.colors}</p>`;
}

async function main(): Promise<void> {
    const levels = await loadLevels();
    let active = levels.length > 0 ? levels[0].name : '';
    const pick = (e: LevelEntry) => {
        active = e.name;
        renderLibrary(levels, pick, active);
        showLevel(e);
    };
    renderLibrary(levels, pick, active);
    if (levels.length > 0) showLevel(levels[0]);
    else document.getElementById('canvas')!.innerHTML = '<h3>编辑区</h3><p>还没有关卡。</p>';
}

main();
