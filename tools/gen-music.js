// Synthesize the looping background track as a WAV file — zero external assets, like gen-sfx.
//
// A FILE OF ITS OWN, next to gen-sfx.js rather than inside it. Those are seven one-shots, each
// a line long; this is one piece of music with bars, chords and three voices, and the two have
// nothing to share but `encodeWav`. Folding them together would have meant one file where a
// change to the melody sits three lines from a change to the tap.
//
// 11025 Hz, NOT the 22050 the effects use, and that is the package talking rather than taste.
// WAV is uncompressed and the WeChat main package is capped at 4MB; at 22050 this loop would be
// 862KB, at 11025 it is 431KB. Nyquist is then 5.5kHz, so every voice below is band-limited to
// stay under it -- a naive square wave at this rate folds its upper harmonics back down as a
// metallic buzz, which is exactly what a background track must not have.
//
//   node tools/gen-music.js
const fs = require('fs');
const path = require('path');

const RATE = 11025;
const BPM = 96;
const BEAT = 60 / BPM;            // 0.625 s
const STEP = BEAT / 2;            // one eighth note, the grid everything below is written on
const BARS = 8;
const STEPS = BARS * 8;           // 64 eighths
const LEN = Math.round(RATE * STEP * STEPS);   // 220500 samples = 20.000 s exactly
const NYQ = RATE / 2;

/**
 * How late an off-beat eighth falls, as a fraction of a step. Straight is 0, a full triplet
 * shuffle is 1/6 (0.167).
 *
 * SMALL ON PURPOSE. This is the difference between a loop that sounds played and one that
 * sounds clocked, and it is the cheapest of every change in this file: nothing about the notes
 * moves, only when the off-beats land. Past about 0.10 it starts to read as a shuffle -- a
 * style of its own, and a busier one than this track is for.
 */
const SWING = 0.07;

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
        const s = Math.max(-1, Math.min(1, samples[i]));
        buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
    }
    return buf;
}

/**
 * The noise source, SEEDED, so that two runs of this script write byte-identical files.
 *
 * `Math.random()` would have been one character shorter and would have made every
 * regeneration a 431KB diff of nothing -- the shaker would be a different draw of the same
 * distribution, sounding the same and reviewing as a wall of changed bytes. The level
 * generator is deterministic for the same reason; an offline artefact that cannot be
 * reproduced cannot be checked.
 *
 * mulberry32: four lines, no dependency, and far better than this needs.
 */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(0x9E3779B9);

/** MIDI note number to hertz. 69 is A4 = 440. */
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * One note's samples, band-limited: the harmonics are summed explicitly and the sum stops
 * before Nyquist, so nothing folds back.
 *
 * `shape` picks how the harmonics are weighted -- 'tri' is a triangle (odd harmonics, 1/k^2,
 * alternating sign), 'sine' just the fundamental, 'pulse' a square (odd harmonics, 1/k).
 * The envelope is an exponential decay with a short attack, and it is forced to zero over the
 * last 12 ms so that no note ends on a step.
 *
 * NOTHING IN THIS TRACK USES 'pulse'. It is kept because it is three lines and because the
 * next person to want a brighter lead will reach for it; a square's odd harmonics at 1/k are
 * most of what made the first version of this loop read as arcade rather than as easy.
 */
function note(midi, dur, { shape = 'tri', decay = 4, vol = 0.2 } = {}) {
    const f = hz(midi);
    const n = Math.floor(RATE * dur);
    const out = new Float32Array(n);
    // Which harmonics fit. 0.92 rather than 1.0 keeps the topmost one clear of the filter
    // slope every resampler has near Nyquist.
    const maxK = Math.max(1, Math.floor((NYQ * 0.92) / f));
    const atk = Math.min(0.012 * RATE, n / 4);
    const rel = Math.min(0.012 * RATE, n / 4);
    for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const ph = 2 * Math.PI * f * t;
        let v = 0;
        if (shape === 'sine') {
            v = Math.sin(ph);
        } else if (shape === 'pulse') {
            for (let k = 1; k <= maxK; k += 2) v += Math.sin(k * ph) / k;
            v *= 4 / Math.PI;
        } else {
            for (let k = 1; k <= maxK; k += 2) {
                v += (((k - 1) / 2) % 2 ? -1 : 1) * Math.sin(k * ph) / (k * k);
            }
            v *= 8 / (Math.PI * Math.PI);
        }
        let env = Math.exp(-decay * t);
        if (i < atk) env *= i / atk;
        if (i > n - rel) env *= (n - i) / rel;
        out[i] = v * env * vol;
    }
    return out;
}

/**
 * The shaker: filtered noise, a short envelope, nothing pitched.
 *
 * THE WHOLE KIT, and that is the single biggest reason this track reads as easy rather than
 * as upbeat. The version before it had a kick on 1 and 3 and a snare on 2 and 4, which is a
 * BACKBEAT -- it tells a listener where to clap, and a game a player is meant to think over
 * should not be telling them anything of the sort. A shaker marks time without marking beats.
 */
function shaker(dur, { cut = 0.6, decay = 60, vol = 0.05 } = {}) {
    const n = Math.floor(RATE * dur);
    const out = new Float32Array(n);
    let last = 0;
    for (let i = 0; i < n; i++) {
        const t = i / RATE;
        // A one-pole low pass on white noise. `cut` near 1 leaves it open and hissy, lower
        // shuts it towards a rustle.
        const white = rand() * 2 - 1;
        last += (white - last) * cut;
        const env = Math.exp(-decay * t) * (i > n - 40 ? (n - i) / 40 : 1);
        out[i] = last * env * vol;
    }
    return out;
}

/**
 * Where eighth-note `step` actually falls, in samples. Integer steps only.
 *
 * `SWING` is applied HERE rather than at each call site, so every voice swings together by
 * construction. A melody that swung against a straight arpeggio would not read as a feel; it
 * would read as the two being out of time with each other.
 */
function stepAt(step) {
    return Math.round((step + (step % 2 ? SWING : 0)) * STEP * RATE);
}

/**
 * Add `src` into the track at eighth-note `step`, WRAPPING past the end.
 *
 * The wrap is what makes the loop seamless. A note struck on the last eighth has to keep
 * ringing after the file restarts, and the only place that tail can live is the head of the
 * same buffer -- exactly where the loop puts it. Truncating instead would cut every tail at
 * the boundary, and a cut waveform is a click, once every twenty seconds, forever.
 */
function mix(track, src, step) {
    const at = stepAt(step);
    for (let i = 0; i < src.length; i++) track[(at + i) % LEN] += src[i];
}

// ---------------------------------------------------------------------------------------
// The song: Cmaj7 - Am7 - Dm7 - G7, eight bars at 96 BPM -- the turnaround twice, the melody
// opening upward the second time round so the loop does not announce itself at bar five.
//
// EASY IS A SET OF CHOICES, and every one of them is a reversal of the version this replaced.
// 「重新生成一段背景音乐,需要轻松愉快的」. That one was written to be 欢快 and succeeded:
// 120 BPM, a backbeat, square-wave melody, and chords stabbed on the OFF-beats, which is the
// ska upstroke and is pure forward push. Each of those is the opposite here:
//
//   tempo    120 -> 96, so the bar has room in it
//   harmony  C-G-Am-F -> Cmaj7-Am7-Dm7-G7. The added sevenths are most of the warmth, and a
//            ii-V turnaround resolves gently where a IV-I lands hard.
//   texture  off-beat stabs -> a broken chord rolling through the bar. Same notes, no push.
//   melody   square, running eighths -> triangle, long notes, a rest at the end of every bar.
//            The rests matter as much as the notes: a line that never stops is not restful.
//   kit      kick and snare -> a shaker, and see `shaker` for why that is the big one.
//   feel     dead straight -> a little behind the beat (see SWING).
//
// It costs 86KB over the old loop: 8 bars at 96 BPM is 20 s where 8 bars at 120 was 16. The
// main package has the room and a shorter phrase would have been the wrong economy -- the
// whole point of the slower tempo is that nothing is hurried.
// ---------------------------------------------------------------------------------------

/** Bar roots, low, one per bar: C3 A2 D3 G2, twice. */
const ROOTS = [48, 45, 50, 43, 48, 45, 50, 43];
/**
 * Bar chords as four voices each, in one register so the bed does not jump between bars.
 *
 * VOICE-LED rather than written as root-position stacks: Cmaj7 [60,64,67,71] to Am7
 * [57,60,64,67] moves every part by a third or less, and the arpeggio that walks these is
 * audibly one instrument staying put rather than four notes being replaced. Root-position
 * spellings would have leapt an octave at every bar line.
 */
const CHORDS = [
    [60, 64, 67, 71],   // Cmaj7  C E G B
    [57, 60, 64, 67],   // Am7    A C E G
    [57, 60, 62, 65],   // Dm7    A C D F
    [55, 59, 62, 65],   // G7     G B D F
    [60, 64, 67, 71],
    [57, 60, 64, 67],
    [57, 60, 62, 65],
    [55, 59, 62, 65],
];

/**
 * Which voice of the bar's chord the arpeggio plays on each eighth.
 *
 * UP, BACK, UP AGAIN rather than a straight run up and down. A pure up-down figure returns to
 * its lowest note twice a bar, which puts an accent on the bar line the shaker is deliberately
 * not putting there.
 */
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];

/**
 * The melody, one entry per eighth note: a MIDI number strikes, `-1` holds the note before it,
 * `null` rests. 64 entries, read straight across the eight bars.
 *
 * Every struck note is a chord tone of its own bar, except the passing D5 in bar 2 and the G5
 * in bar 7 -- the ninth and the eleventh, both of which a minor seventh wears comfortably.
 * Bars 1-4 sit around E5 and move by step; bars 5-8 open up to C6 and come back down, which
 * is the only thing distinguishing the second half and is enough.
 */
const MELODY = [
    /* Cmaj7 */ 76, -1, -1, -1, 79, -1, -1, null,
    /* Am7   */ 72, -1, -1, 74, 76, -1, -1, null,
    /* Dm7   */ 77, -1, -1, -1, 74, -1, -1, null,
    /* G7    */ 71, -1, 74, -1, 77, -1, -1, null,
    /* Cmaj7 */ 79, -1, -1, 83, 84, -1, -1, -1,
    /* Am7   */ 81, -1, -1, -1, 79, -1, 76, -1,
    /* Dm7   */ 77, -1, 79, -1, 81, -1, -1, null,
    /* G7    */ 79, -1, -1, 74, 71, -1, -1, null,
];

const track = new Float32Array(LEN);

// Melody. A held note is ONE longer note rather than a restruck one, so the run of `-1`s after
// an entry is counted before anything is rendered.
for (let s = 0; s < STEPS; s++) {
    const m = MELODY[s];
    if (m === null || m === -1) continue;
    let held = 1;
    while (s + held < STEPS && MELODY[s + held] === -1) held++;
    const dur = held * STEP * 0.98;
    mix(track, note(m, dur, { shape: 'tri', decay: 1.1, vol: 0.30 }), s);
}

for (let bar = 0; bar < BARS; bar++) {
    const base = bar * 8;
    const chord = CHORDS[bar];
    const root = ROOTS[bar];
    // Bass: root on beat 1, fifth on beat 3, both long. Two notes a bar, not four -- a bass
    // that walks every beat is a bass that is going somewhere, which is the feel being
    // avoided here.
    mix(track, note(root, BEAT * 1.9, { shape: 'tri', decay: 1.5, vol: 0.40 }), base + 0);
    mix(track, note(root + 7, BEAT * 1.9, { shape: 'tri', decay: 1.5, vol: 0.34 }), base + 4);
    // The bed: one chord tone per eighth, soft, overlapping into each other.
    for (let i = 0; i < 8; i++) {
        const voice = note(chord[ARP[i]], STEP * 2.2, { shape: 'sine', decay: 2.6, vol: 0.13 });
        mix(track, voice, base + i);
    }
    // The shaker, on every eighth, with the off-beats a touch brighter and louder -- which is
    // how a hand actually shakes one, and is the only accent anywhere in this arrangement.
    for (let i = 0; i < 8; i++) {
        const off = i % 2 === 1;
        mix(track, shaker(0.05, {
            cut: off ? 0.72 : 0.62, decay: off ? 70 : 85, vol: off ? 0.055 : 0.035,
        }), base + i);
    }
}

// Normalise to a healthy peak so the 16-bit floor stays far away; how LOUD the track actually
// plays is the AudioSource's volume in view/music.ts, which is the thing that can be tuned
// without regenerating a 431KB file.
let peak = 0;
for (let i = 0; i < LEN; i++) peak = Math.max(peak, Math.abs(track[i]));
const gain = 0.86 / peak;
for (let i = 0; i < LEN; i++) track[i] *= gain;

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'music.wav');
fs.writeFileSync(file, encodeWav(track));
console.log(
    `wrote music.wav -- ${(LEN / RATE).toFixed(2)}s, ${RATE}Hz, ${BPM}BPM, `
    + `${(fs.statSync(file).size / 1024).toFixed(0)}KB, peak ${peak.toFixed(2)} -> 0.86`,
);
