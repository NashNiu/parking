// Synthesize simple arcade SFX as WAV files — zero external assets.
const fs = require('fs');
const path = require('path');

const RATE = 22050;
const OUT = path.resolve(__dirname, '..', 'game', 'assets', 'resources', 'audio');

function encodeWav(samples) {
    const n = samples.length;
    const buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
    }
    return buf;
}

// tone: freq(t)->hz, dur seconds, envelope decay, optional wave type
function tone(freqFn, dur, { decay = 6, wave = 'sine', vol = 0.6 } = {}) {
    const n = Math.floor(RATE * dur);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const f = typeof freqFn === 'function' ? freqFn(t / dur) : freqFn;
        phase += (2 * Math.PI * f) / RATE;
        let v = wave === 'square' ? (Math.sin(phase) >= 0 ? 1 : -1) : Math.sin(phase);
        out[i] = v * vol * Math.exp(-decay * t);
    }
    return out;
}

function concat(...arrs) {
    const n = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(n);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
}

const sfx = {
    tap: tone(880, 0.08, { decay: 20, wave: 'square', vol: 0.4 }),
    drive: tone((p) => 300 + p * 500, 0.25, { decay: 5 }),
    park: tone(660, 0.18, { decay: 8 }),
    board: concat(tone(784, 0.06, { decay: 18 }), tone(1046, 0.08, { decay: 14 })),
    depart: concat(tone(523, 0.07, { decay: 12 }), tone(659, 0.07, { decay: 12 }), tone(784, 0.12, { decay: 8 })),
    win: concat(tone(523, 0.1, { decay: 6 }), tone(659, 0.1, { decay: 6 }), tone(784, 0.1, { decay: 6 }), tone(1046, 0.25, { decay: 4 })),
    lose: tone((p) => 440 - p * 240, 0.4, { decay: 4, wave: 'square', vol: 0.4 }),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, samples] of Object.entries(sfx)) {
    fs.writeFileSync(path.join(OUT, `${name}.wav`), encodeWav(samples));
    console.log('wrote', name + '.wav');
}
