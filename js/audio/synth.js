// Built-in practice tracks, generated from maths so there is nothing to license
// and the tempo and beat positions are known exactly (which makes scoring fair).
// Pure JS: runs in the browser and in Node tests.

export const BARS = 48;
export const BEATS_PER_BAR = 4;
export const PHRASE_BARS = 8;

const TAU = Math.PI * 2;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- one-shot sounds -------------------------------------------------------

function kick(sr, k = {}) {
  const { f0 = 165, f1 = 47, len = 0.36, punch = 34 } = k;
  const n = Math.floor(sr * len), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t * punch))) / sr;
    const env = Math.exp(-t * 8) * Math.min(1, (n - i) / 400);
    out[i] = Math.sin(ph) * env + (i < 90 ? (1 - i / 90) * 0.35 * (i % 2 ? 1 : -1) : 0);
  }
  return out;
}

function noiseHit(sr, rand, { len, decay, hp = 0.9, lp = 1, bursts = 1 }) {
  const n = Math.floor(sr * len), out = new Float32Array(n);
  let prev = 0, hpState = 0, lpState = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, x = rand() * 2 - 1;
    hpState = hp * (hpState + x - prev); prev = x;      // one-pole high-pass
    lpState += lp * (hpState - lpState);                // one-pole low-pass
    let env = Math.exp(-t * decay);
    if (bursts > 1 && t < 0.03) env = Math.exp(-((t % 0.01) * 400)) * 0.9;
    out[i] = lpState * env * Math.min(1, (n - i) / 300);
  }
  return out;
}

function bassNote(sr, midi, len, { bright = 0.12, sub = 0.6 } = {}) {
  const n = Math.floor(sr * len), out = new Float32Array(n), f = hz(midi);
  let ph = 0, lpState = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += f / sr; if (ph >= 1) ph -= 1;
    const saw = ph * 2 - 1;
    const cut = bright * (0.25 + 0.75 * Math.exp(-t * 14));
    lpState += cut * (saw - lpState);
    const env = Math.min(1, i / 60) * Math.min(1, (n - i) / 500);
    out[i] = (sub * Math.sin(TAU * ph) + (1 - sub) * lpState * 2.2) * env;
  }
  return out;
}

function chordHit(sr, midis, len, { decay = 6, cut = 0.22, attack = 0.002 } = {}) {
  const n = Math.floor(sr * len), out = new Float32Array(n);
  const voices = [];
  for (const m of midis) for (const d of [-0.07, 0.07]) voices.push({ ph: Math.abs(d) * 3 + m * 0.13 % 1, inc: hz(m + d) / sr });
  let lpState = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    for (const v of voices) { v.ph += v.inc; if (v.ph >= 1) v.ph -= 1; s += v.ph * 2 - 1; }
    s /= voices.length;
    const c = cut * (0.35 + 0.65 * Math.exp(-t * decay));
    lpState += c * (s - lpState);
    const env = Math.min(1, t / attack) * Math.exp(-t * decay * 0.6) * Math.min(1, (n - i) / 600);
    out[i] = lpState * env * 2.4;
  }
  return out;
}

function pluck(sr, midi, len) {
  const n = Math.floor(sr * len), out = new Float32Array(n), f = hz(midi);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += f / sr; if (ph >= 1) ph -= 1;
    const tri = 1 - 4 * Math.abs(ph - 0.5);
    const sq = ph < 0.5 ? 1 : -1;
    out[i] = (tri * 0.8 + sq * 0.2 * Math.exp(-t * 20)) * Math.exp(-t * 7) * Math.min(1, i / 40) * Math.min(1, (n - i) / 400);
  }
  return out;
}

function riser(sr, rand, len) {
  const n = Math.floor(sr * len), out = new Float32Array(n);
  let prev = 0, hpState = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n, x = rand() * 2 - 1;
    const hp = 0.5 + 0.49 * p;
    hpState = hp * (hpState + x - prev); prev = x;
    out[i] = hpState * p * p * Math.min(1, (n - i) / 800);
  }
  return out;
}

function mix(dst, src, at, gain) {
  const start = Math.round(at), n = Math.min(src.length, dst.length - start);
  for (let i = 0; i < n; i++) dst[start + i] += src[i] * gain;
}

// ---- track definitions -----------------------------------------------------
// prog: one chord per bar (4-bar loop): [semitones above root, 'm' | 'M']
// bass: 16 steps per bar, semitones above the chord root (null = rest)
// lead: 2-bar motif as [step 0..31, semitones above track root]

const _ = null;
export const TRACKS = [
  {
    id: 'neon', name: 'Neon Avenue', style: 'House', bpm: 124, key: 'A minor', camelot: '8A', root: 33, seed: 11,
    prog: [[0, 'm'], [0, 'm'], [8, 'M'], [10, 'M']],
    bass: [_, _, 0, _, _, _, 0, _, _, _, 0, _, _, _, 0, 12],
    stab: [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0],
    lead: [[0, 12], [3, 15], [6, 19], [10, 17], [14, 15], [16, 12], [19, 15], [22, 10], [26, 12]],
    openHat: true,
  },
  {
    id: 'tram', name: 'Night Tram', style: 'Tech house', bpm: 126, key: 'F minor', camelot: '4A', root: 29, seed: 23,
    prog: [[0, 'm'], [0, 'm'], [0, 'm'], [3, 'M']],
    bass: [0, _, 0, 0, _, 0, _, 12, 0, _, 0, 0, _, 0, 10, _],
    stab: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    lead: [[2, 12], [5, 12], [8, 15], [11, 12], [18, 19], [21, 17], [24, 15], [28, 12]],
    kick: { f0: 150, f1: 44, punch: 40 }, openHat: false,
  },
  {
    id: 'lantern', name: 'Paper Lanterns', style: 'Disco house', bpm: 120, key: 'C major', camelot: '8B', root: 36, seed: 37,
    prog: [[0, 'M'], [9, 'm'], [5, 'M'], [7, 'M']],
    bass: [0, _, _, 12, _, _, 0, _, 7, _, _, 12, _, 0, _, _],
    stab: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    lead: [[0, 16], [4, 19], [8, 24], [12, 19], [16, 21], [20, 19], [24, 16], [28, 14]],
    openHat: true,
  },
  {
    id: 'garden', name: 'Concrete Garden', style: 'Techno', bpm: 128, key: 'D minor', camelot: '7A', root: 26, seed: 53,
    prog: [[0, 'm'], [0, 'm'], [0, 'm'], [0, 'm']],
    bass: [_, 0, 0, _, _, 0, 0, _, _, 0, 0, _, _, 0, 0, 3],
    stab: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
    lead: [[0, 24], [6, 24], [12, 27], [16, 24], [22, 22], [28, 19]],
    kick: { f0: 140, f1: 42, punch: 28, len: 0.4 }, openHat: false,
  },
  {
    id: 'tide', name: 'Low Tide', style: 'Deep house', bpm: 122, key: 'G minor', camelot: '6A', root: 31, seed: 71,
    prog: [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']],
    bass: [0, _, _, 0, _, _, 12, _, _, 0, _, _, 0, _, 7, _],
    stab: [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    lead: [[4, 19], [8, 15], [14, 12], [20, 19], [24, 22], [28, 19]],
    openHat: true,
  },
];

// Which layers play in each 8-bar section. A crash marks each phrase start and a
// snare fill ends each phrase: the same signposts real dance tracks use.
export const SECTIONS = [
  { name: 'Intro', bars: [0, 8], kick: 1, hat: 1 },
  { name: 'Groove', bars: [8, 16], kick: 1, hat: 1, clap: 1, bass: 1 },
  { name: 'Main', bars: [16, 24], kick: 1, hat: 1, clap: 1, bass: 1, stab: 1 },
  { name: 'Main', bars: [24, 32], kick: 1, hat: 1, clap: 1, bass: 1, stab: 1, lead: 1 },
  { name: 'Break', bars: [32, 40], hat: 1, stab: 1, lead: 1, pad: 1, rise: 1 },
  { name: 'Drop', bars: [40, 48], kick: 1, hat: 1, clap: 1, bass: 1, stab: 1, lead: 1 },
];

export function sectionAtBar(bar) {
  const b = ((bar % BARS) + BARS) % BARS;
  return SECTIONS.find((s) => b >= s.bars[0] && b < s.bars[1]);
}

export function renderTrack(def, sr = 44100) {
  const rand = rng(def.seed);
  const beat = (60 / def.bpm) * sr, step = beat / 4, bar = beat * 4;
  const total = Math.round(bar * BARS);
  const out = new Float32Array(total);

  const K = kick(sr, def.kick);
  const hatC = noiseHit(sr, rand, { len: 0.06, decay: 85, hp: 0.95 });
  const hatO = noiseHit(sr, rand, { len: 0.28, decay: 13, hp: 0.95 });
  const clap = noiseHit(sr, rand, { len: 0.22, decay: 20, hp: 0.8, lp: 0.45, bursts: 3 });
  const snare = noiseHit(sr, rand, { len: 0.12, decay: 30, hp: 0.7, lp: 0.6 });
  const crash = noiseHit(sr, rand, { len: 1.9, decay: 2.4, hp: 0.97 });
  const rise = riser(sr, rand, (bar * 2) / sr);

  const triad = (root, q) => [root, root + (q === 'm' ? 3 : 4), root + 7];
  const cache = new Map();
  const memo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

  for (const sec of SECTIONS) {
    for (let b = sec.bars[0]; b < sec.bars[1]; b++) {
      const at = b * bar;
      const [off, q] = def.prog[b % 4];
      const lastBar = b === sec.bars[1] - 1;
      if (b === sec.bars[0]) mix(out, crash, at, 0.22);
      for (let s = 0; s < 16; s++) {
        const t = at + s * step;
        const fill = lastBar && s >= 8;
        if (sec.kick && s % 4 === 0 && !(fill && s >= 12)) mix(out, K, t, 0.95);
        if (sec.hat) {
          if (s % 4 === 2) mix(out, def.openHat ? hatO : hatC, t, def.openHat ? 0.13 : 0.2);
          else if (s % 2 === 0 || (s * 7 + b) % 5 === 0) mix(out, hatC, t, s % 4 === 0 ? 0.07 : 0.13);
        }
        if (sec.clap && s % 8 === 4) mix(out, clap, t, 0.42);
        if (fill && (s >= 12 || s % 2 === 0)) mix(out, snare, t, 0.16 + (s - 8) * 0.03);
        if (sec.bass && def.bass[s] !== null && !(fill && s >= 12)) {
          const m = def.root + off + def.bass[s];
          mix(out, memo(`b${m}`, () => bassNote(sr, m, (step * 1.7) / sr)), t, 0.5);
        }
        if (sec.stab && def.stab[s]) {
          const key = `s${off}${q}`;
          mix(out, memo(key, () => chordHit(sr, triad(def.root + 24 + off, q), 0.45)), t, 0.2);
        }
      }
      if (sec.pad) {
        const key = `p${off}${q}`;
        mix(out, memo(key, () => chordHit(sr, triad(def.root + 24 + off, q), bar / sr, { decay: 0.7, cut: 0.08, attack: 0.25 })), at, 0.3);
      }
      if (sec.lead) {
        const half = (b % 2) * 16;
        for (const [s, semi] of def.lead) {
          if (s < half || s >= half + 16) continue;
          const m = def.root + 24 + semi;
          mix(out, memo(`l${m}`, () => pluck(sr, m, 0.4)), at + (s - half) * step, 0.2);
        }
      }
      if (sec.rise && b === sec.bars[1] - 2) mix(out, rise, at, 0.3);
    }
  }

  // Gentle limiter, then normalise so every track sits at the same loudness.
  let peak = 0;
  for (let i = 0; i < total; i++) { out[i] = Math.tanh(out[i] * 1.15); peak = Math.max(peak, Math.abs(out[i])); }
  const g = 0.9 / (peak || 1);
  for (let i = 0; i < total; i++) out[i] *= g;

  return { samples: out, sampleRate: sr, bpm: def.bpm, firstBeat: 0, loop: true, bars: BARS };
}

// Peaks for drawing waveforms: overall level plus the low (kick/bass) band.
export function computePeaks(samples, sr, binsPerSec = 150) {
  const hop = sr / binsPerSec, n = Math.ceil(samples.length / hop);
  const full = new Float32Array(n), low = new Float32Array(n);
  const k = 1 - Math.exp((-TAU * 160) / sr);
  let lp = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]; lp += k * (x - lp);
    const b = Math.floor(i / hop), ax = Math.abs(x), al = Math.abs(lp);
    if (ax > full[b]) full[b] = ax;
    if (al > low[b]) low[b] = al;
  }
  return { full, low, binsPerSec };
}
