// Synthesize the looping background track as a WAV file — zero external assets, like gen-sfx.
//
// A FILE OF ITS OWN, next to gen-sfx.js rather than inside it. Those are seven one-shots, each
// a line long; this is one piece of music with bars, chords and four voices, and the two have
// nothing to share but `encodeWav`. Folding them together would have meant one file where a
// change to the melody sits three lines from a change to the tap.
//
// 11025 Hz, NOT the 22050 the effects use, and that is the package talking rather than taste.
// WAV is uncompressed and the WeChat main package is capped at 4MB with the build already near
// 2.9MB; at 22050 this loop would be 700KB, at 11025 it is 345KB. Nyquist is then 5.5kHz, so
// every voice below is band-limited to stay under it -- a naive square wave at this rate folds
// its upper harmonics back down as a metallic buzz, which is exactly what a background track
// must not have.
//
//   node tools/gen-music.js
const fs = require('fs');
const path = require('path');

const RATE = 11025;
const BPM = 120;
const BEAT = 60 / BPM;            // 0.5 s
const STEP = BEAT / 2;            // one eighth note, the grid everything below is written on
const BARS = 8;
const STEPS = BARS * 8;           // 64 eighths
const LEN = Math.round(RATE * STEP * STEPS);   // 176400 samples = 16.000 s exactly
const NYQ = RATE / 2;

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
 * regeneration a 345KB diff of nothing -- the hats and the snare would be a different draw of
 * the same distribution, sounding the same and reviewing as a wall of changed bytes. The
 * level generator is deterministic for the same reason; an offline artefact that cannot be
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
 * `shape` picks how the harmonics are weighted -- 'pulse' is a square (odd harmonics, 1/k),
 * 'tri' a triangle (odd harmonics, 1/k^2, alternating sign), 'sine' just the fundamental.
 * The envelope is an exponential decay with a short attack, and it is forced to zero over the
 * last 12 ms so that no note ends on a step.
 */
function note(midi, dur, { shape = 'pulse', decay = 4, vol = 0.2 } = {}) {
    const f = hz(midi);
    const n = Math.floor(RATE * dur);
    const out = new Float32Array(n);
    // Which harmonics fit. 0.92 rather than 1.0 keeps the topmost one clear of the filter
    // slope every resampler has near Nyquist.
    const maxK = Math.max(1, Math.floor((NYQ * 0.92) / f));
    const atk = Math.min(0.006 * RATE, n / 4);
    const rel = Math.min(0.012 * RATE, n / 4);
    for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const ph = 2 * Math.PI * f * t;
        let v = 0;
        if (shape === 'sine') {
            v = Math.sin(ph);
        } else if (shape === 'tri') {
            for (let k = 1; k <= maxK; k += 2) {
                v += (((k - 1) / 2) % 2 ? -1 : 1) * Math.sin(k * ph) / (k * k);
            }
            v *= 8 / (Math.PI * Math.PI);
        } else {
            for (let k = 1; k <= maxK; k += 2) v += Math.sin(k * ph) / k;
            v *= 4 / Math.PI;
        }
        let env = Math.exp(-decay * t);
        if (i < atk) env *= i / atk;
        if (i > n - rel) env *= (n - i) / rel;
        out[i] = v * env * vol;
    }
    return out;
}

/** A drum: filtered noise plus an optional pitched thump. One envelope, no oscillator table. */
function drum(dur, { tone = 0, sweep = 0, noise = 1, decay = 30, vol = 0.2 } = {}) {
    const n = Math.floor(RATE * dur);
    const out = new Float32Array(n);
    let last = 0, phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const p = i / n;
        // A one-pole low pass on white noise: a hat wants it open, a snare half shut.
        const white = rand() * 2 - 1;
        last += (white - last) * 0.6;
        let v = last * noise;
        if (tone) {
            phase += (2 * Math.PI * (tone - sweep * p)) / RATE;
            v += Math.sin(phase) * 1.4;
        }
        const env = Math.exp(-decay * t) * (i > n - 40 ? (n - i) / 40 : 1);
        out[i] = v * env * vol;
    }
    return out;
}

/**
 * Add `src` into the track at eighth-note `step`, WRAPPING past the end.
 *
 * The wrap is what makes the loop seamless. A note struck on the last eighth has to keep
 * ringing after the file restarts, and the only place that tail can live is the head of the
 * same buffer -- exactly where the loop puts it. Truncating instead would cut every tail at
 * the boundary, and a cut waveform is a click, once every sixteen seconds, forever.
 */
function mix(track, src, step) {
    const at = Math.round(step * STEP * RATE);
    for (let i = 0; i < src.length; i++) track[(at + i) % LEN] += src[i];
}

// ---------------------------------------------------------------------------------------
// The song: C major, I-V-vi-IV, eight bars -- the progression twice, with the melody opening
// out the second time round so the loop does not announce itself at bar five.
//
// CHEERFUL IS A SET OF CHOICES, not a mood: a major key, an upbeat tempo, the chords stabbed
// on the OFF-beats (the ska upstroke, which is most of the bounce), a melody that moves in
// steps and skips rather than leaps, and a bass that walks root-root-fifth-root instead of
// sitting on one note.
// ---------------------------------------------------------------------------------------

/** Bar roots, low, one per bar: C3 G2 A2 F2, twice. */
const ROOTS = [48, 43, 45, 41, 48, 43, 45, 41];
/** Bar triads, in the octave above the bass. */
const CHORDS = [
    [60, 64, 67], [59, 62, 67], [60, 64, 69], [60, 65, 69],
    [60, 64, 67], [59, 62, 67], [60, 64, 69], [60, 65, 69],
];

/**
 * The melody, one entry per eighth note: a MIDI number strikes, `-1` holds the note before it,
 * `null` rests. 64 entries, read straight across the eight bars.
 */
const MELODY = [
    /* C  */ 76, 79, 76, 72, 74, -1, -1, null,
    /* G  */ 74, 79, 71, 74, 79, -1, -1, null,
    /* Am */ 81, 79, 76, 69, 72, -1, -1, null,
    /* F  */ 77, 81, 79, 77, 76, -1, -1, null,
    /* C  */ 79, 84, 83, 79, 76, 79, 72, -1,
    /* G  */ 81, 83, 79, 74, 79, -1, 83, -1,
    /* Am */ 84, 83, 81, 76, 81, -1, 79, -1,
    /* F  */ 77, 79, 81, 84, 81, 79, 76, -1,
];

const track = new Float32Array(LEN);

// Melody. A held note is ONE longer note rather than a restruck one, so the run of `-1`s after
// an entry is counted before anything is rendered.
for (let s = 0; s < STEPS; s++) {
    const m = MELODY[s];
    if (m === null || m === -1) continue;
    let held = 1;
    while (s + held < STEPS && MELODY[s + held] === -1) held++;
    const dur = held * STEP * 0.96;
    mix(track, note(m, dur, { shape: 'pulse', decay: held > 1 ? 1.6 : 3.4, vol: 0.20 }), s);
}

for (let bar = 0; bar < BARS; bar++) {
    const base = bar * 8;
    const root = ROOTS[bar];
    // Bass: root, root, fifth, root on the four beats. The fifth is seven semitones up.
    for (const [beat, midi] of [[0, root], [2, root], [4, root + 7], [6, root]]) {
        mix(track, note(midi, STEP * 1.8, { shape: 'tri', decay: 3.2, vol: 0.34 }), base + beat);
    }
    // Chord stabs on the off-beats: short, quiet, and the whole reason this reads as bouncy.
    for (const off of [1, 3, 5, 7]) {
        for (const midi of CHORDS[bar]) {
            const stab = note(midi, STEP * 0.5, { shape: 'pulse', decay: 14, vol: 0.075 });
            mix(track, stab, base + off);
        }
    }
    // Kit: kick on 1 and 3, snare on 2 and 4, hats on every off-beat.
    mix(track, drum(0.16, { tone: 150, sweep: 100, noise: 0.25, decay: 26, vol: 0.34 }), base + 0);
    mix(track, drum(0.16, { tone: 150, sweep: 100, noise: 0.25, decay: 26, vol: 0.30 }), base + 4);
    for (const beat of [2, 6]) {
        mix(track, drum(0.13, { tone: 0, noise: 1, decay: 34, vol: 0.20 }), base + beat);
    }
    for (const off of [1, 3, 5, 7]) {
        mix(track, drum(0.045, { tone: 0, noise: 1, decay: 90, vol: 0.085 }), base + off);
    }
}

// Normalise to a healthy peak so the 16-bit floor stays far away; how LOUD the track actually
// plays is the AudioSource's volume in view/music.ts, which is the thing that can be tuned
// without regenerating a 345KB file.
let peak = 0;
for (let i = 0; i < LEN; i++) peak = Math.max(peak, Math.abs(track[i]));
const gain = 0.86 / peak;
for (let i = 0; i < LEN; i++) track[i] *= gain;

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'music.wav');
fs.writeFileSync(file, encodeWav(track));
console.log(
    `wrote music.wav -- ${(LEN / RATE).toFixed(2)}s, ${RATE}Hz, `
    + `${(fs.statSync(file).size / 1024).toFixed(0)}KB, peak ${peak.toFixed(2)} -> 0.86`,
);
