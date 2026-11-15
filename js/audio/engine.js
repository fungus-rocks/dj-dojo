// Two decks and a mixer built on the Web Audio API.
// Signal path per deck:  track -> trim -> 3-band EQ -> filter -> channel fader
//                        -> crossfader -> master -> speakers

import { TRACKS, renderTrack, computePeaks, BEATS_PER_BAR, PHRASE_BARS } from './synth.js';
import { detectBpm } from './bpm.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const SMOOTH = 0.012;

// Knob position (0..1, 0.5 = centre) -> decibels. Fully left is a near-kill.
export const eqDb = (v) => (v >= 0.5 ? (v - 0.5) * 12 : -40 * (1 - v * 2) ** 1.4);
export const faderGain = (v) => v * v;
// Crossfader: both decks at full volume in the middle (a "smooth" curve).
export const xfadeGains = (x) => [
  x <= 0.5 ? 1 : Math.cos((x - 0.5) * Math.PI),
  x >= 0.5 ? 1 : Math.cos((0.5 - x) * Math.PI),
];

export class Deck {
  constructor(engine, id) {
    this.engine = engine; this.id = id;
    this.track = null; this.source = null;
    this.playing = false;
    this.anchorPos = 0; this.anchorTime = 0;   // position (s) at a known clock time
    this.rate = 1;                             // what the sound card is playing now
    this.tempo = 0;                            // tempo fader, -1..+1
    this.tempoLock = null;                     // lesson override: fixed rate
    this.cuePoint = 0;
    this.pendingShift = 0;                     // jog nudge still to be applied (s)
    this.holdBend = 0;                         // keyboard nudge, as a rate offset
    this.cueHeld = false;
    const ctx = engine.ctx;
    this.trim = ctx.createGain();
    this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 220;
    this.mid = ctx.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1100; this.mid.Q.value = 0.7;
    this.hi = ctx.createBiquadFilter(); this.hi.type = 'highshelf'; this.hi.frequency.value = 4200;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 22000; this.lp.Q.value = 1.2;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 10; this.hp.Q.value = 1.2;
    this.fader = ctx.createGain();
    this.xf = ctx.createGain();
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 512;
    this.trim.connect(this.low).connect(this.mid).connect(this.hi).connect(this.lp).connect(this.hp).connect(this.fader).connect(this.xf);
    // After the mixer: left/right placement and a solo switch, used by ear-training lessons.
    this.pan = ctx.createStereoPanner();
    this.out = ctx.createGain();
    this.xf.connect(this.pan).connect(this.out).connect(engine.master);
    this.xf.connect(this.meter);
    // Headphone cue stand-in: a quiet pre-fader feed to the speakers.
    this.pfl = false;
    this.pflGain = ctx.createGain(); this.pflGain.gain.value = 0;
    this.hp.connect(this.pflGain).connect(engine.master);
    this.meterBuf = new Float32Array(512);
  }

  get baseRate() { return this.tempoLock ?? 1 + this.tempo * this.engine.tempoRange; }
  get bpm() { return this.track ? this.track.bpm * this.baseRate : 0; }
  get duration() { return this.track ? this.track.buffer.duration : 0; }

  posAt(time) {
    if (!this.track) return 0;
    let p = this.playing ? this.anchorPos + (time - this.anchorTime) * this.rate : this.anchorPos;
    const d = this.duration;
    if (this.track.loop) p = ((p % d) + d) % d; else p = clamp(p, 0, d);
    return p;
  }
  get position() { return this.posAt(this.engine.ctx.currentTime); }

  /** Position counted in beats (may be fractional). Beat 0 is the first downbeat. */
  beatAt(time) { return this.track ? ((this.posAt(time) - this.track.firstBeat) * this.track.bpm) / 60 : 0; }
  get beat() { return this.beatAt(this.engine.ctx.currentTime); }
  beatToPos(beat) { return this.track.firstBeat + (beat * 60) / this.track.bpm; }

  load(track) {
    this.stopSource();
    this.track = track; this.playing = false;
    this.anchorPos = track.firstBeat; this.cuePoint = track.firstBeat;
    this.pendingShift = 0;
  }

  unload() { this.stopSource(); this.track = null; this.playing = false; this.anchorPos = 0; }

  stopSource() {
    if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; }
  }

  startSource(pos) {
    const ctx = this.engine.ctx;
    this.stopSource();
    const src = ctx.createBufferSource();
    src.buffer = this.track.buffer; src.loop = !!this.track.loop;
    this.rate = clamp(this.baseRate + this.holdBend, 0.02, 3);
    src.playbackRate.value = this.rate;
    src.connect(this.trim);
    const now = ctx.currentTime;
    src.start(now, clamp(pos, 0, this.duration - 0.001));
    src.onended = () => { if (this.source === src && !src.loop) { this.playing = false; this.anchorPos = this.duration; } };
    this.source = src; this.anchorPos = pos; this.anchorTime = now;
  }

  play() { if (!this.track || this.playing) return; this.playing = true; this.startSource(this.anchorPos); }
  pause() { if (!this.playing) return; this.anchorPos = this.position; this.playing = false; this.stopSource(); }
  toggle() { this.playing ? this.pause() : this.play(); }

  seek(pos) {
    if (!this.track) return;
    const d = this.duration;
    pos = this.track.loop ? ((pos % d) + d) % d : clamp(pos, 0, d);
    this.pendingShift = 0;
    if (this.playing) this.startSource(pos); else this.anchorPos = pos;
  }
  seekBeat(beat) { this.seek(this.beatToPos(beat)); }

  setRate(rate) {
    rate = clamp(rate, 0.02, 3);
    if (!this.playing || !this.source) { this.rate = rate; return; }
    if (Math.abs(rate - this.rate) < 1e-7) return;
    const now = this.engine.ctx.currentTime;
    this.anchorPos = this.anchorPos + (now - this.anchorTime) * this.rate;
    this.anchorTime = now;
    this.rate = rate;
    this.source.playbackRate.setValueAtTime(rate, now);
  }

  /** Jog wheel: shove the track forwards (+) or backwards (-) by a little time. */
  nudge(seconds) {
    if (this.playing) this.pendingShift = clamp(this.pendingShift + seconds, -2, 2);
    else this.seek(this.anchorPos + seconds * 4);
  }

  /** Called ~60 times a second: bleeds jog nudges into the playback speed. */
  tick(dt) {
    if (!this.playing) return;
    let bend = 0;
    if (this.pendingShift !== 0) {
      // Fast at first, easing off, but never slower than 2 % so it always finishes.
      const want = this.pendingShift / 0.07;
      bend = Math.sign(want) * clamp(Math.abs(want), 0.02, 0.9);
      const applied = bend * dt;
      if (Math.abs(applied) >= Math.abs(this.pendingShift)) { bend = this.pendingShift / dt; this.pendingShift = 0; } else this.pendingShift -= applied;
    }
    this.setRate(this.baseRate + this.holdBend + bend);
  }

  // CDJ-style cue button: paused -> set cue point (or preview while held);
  // playing -> jump back to the cue point and stop.
  cueDown() {
    if (!this.track) return;
    if (this.playing && !this.cueHeld) { this.pause(); this.seek(this.cuePoint); return; }
    if (!this.playing) {
      if (Math.abs(this.anchorPos - this.cuePoint) > 0.005) this.cuePoint = this.anchorPos;
      this.cueHeld = true; this.play();
    }
  }
  cueUp() {
    if (this.cueHeld) { this.cueHeld = false; this.pause(); this.seek(this.cuePoint); }
  }

  level() {
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    for (let i = 0; i < this.meterBuf.length; i++) peak = Math.max(peak, Math.abs(this.meterBuf[i]));
    return peak;
  }
}

export class Engine {
  constructor(bus) {
    this.bus = bus; this.ctx = null; this.decks = null;
    this.tempoRange = 0.08;      // tempo fader covers +/- 8 %
    this.jogScale = 1;
    this.locks = new Set();      // control keys the current lesson has disabled
    this.allowSync = true;
    this.cache = new Map();
    this.intercept = null;       // lesson hook: return true to swallow an input
  }

  /** Must be called from a click or key press (browsers block sound otherwise). */
  async init() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain(); this.master.gain.value = 0.8;
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.ratio.value = 12; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.12;
    this.master.connect(this.limiter).connect(this.ctx.destination);
    this.decks = { a: new Deck(this, 'a'), b: new Deck(this, 'b') };
    this.bus.on((e) => this.onControl(e));
    for (const key of Object.keys(this.bus.values)) this.applyAbs(key, this.bus.values[key], true);
    this.last = this.ctx.currentTime;
    setInterval(() => this.tick(), 12);
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  tick() {
    const now = this.ctx.currentTime, dt = now - this.last; this.last = now;
    if (dt <= 0) return;
    for (const d of Object.values(this.decks)) {
      if (d.bendDir) d.holdBend = d.bendDir * Math.min(0.2, 0.03 + (performance.now() - d.bendStart) / 1000 * 0.12);
      d.tick(dt);
    }
  }

  // ---- tracks -------------------------------------------------------------

  async builtin(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const def = TRACKS.find((t) => t.id === id);
    await new Promise((r) => setTimeout(r, 0));   // let the "loading" message paint
    const r = renderTrack(def, this.ctx.sampleRate);
    const buffer = this.ctx.createBuffer(1, r.samples.length, r.sampleRate);
    buffer.copyToChannel(r.samples, 0);
    const track = { ...def, buffer, bars: r.bars, firstBeat: 0, loop: true, builtin: true, peaks: computePeaks(r.samples, r.sampleRate) };
    this.cache.set(id, track);
    while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value);
    return track;
  }

  async fromFile(file) {
    const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    const n = buffer.length, mono = new Float32Array(n);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += ch[i] / buffer.numberOfChannels;
    }
    const { bpm, firstBeat } = detectBpm(mono, buffer.sampleRate);
    return { id: 'file:' + file.name, name: file.name.replace(/\.[^.]+$/, ''), style: 'Your track', bpm, firstBeat, loop: false, buffer, peaks: computePeaks(mono, buffer.sampleRate) };
  }

  // ---- inputs -------------------------------------------------------------

  onControl(e) {
    if (!this.decks) return;
    if (this.intercept && this.intercept(e) === true) return;
    if (this.locks.has(e.key)) return;
    const deck = e.deck && this.decks[e.deck];
    if (e.type === 'abs') return this.applyAbs(e.key, e.value);
    if (!deck) return;
    if (e.type === 'rel' && e.id === 'jog') return deck.nudge(e.delta * (e.platter ? 0.0025 : 0.0006) * this.jogScale);
    if (e.type !== 'button') return;
    switch (e.id) {
      case 'play': if (e.down) deck.toggle(); break;
      case 'cue': e.down ? deck.cueDown() : deck.cueUp(); break;
      case 'sync': if (e.down && this.allowSync) this.sync(e.deck); break;
      case 'pfl': if (e.down) this.setPfl(e.deck, !deck.pfl); break;
      case 'nudge-': case 'nudge+':
        if (e.down) { deck.bendDir = e.id === 'nudge+' ? 1 : -1; deck.bendStart = performance.now(); }
        else { deck.bendDir = 0; deck.holdBend = 0; }
        break;
    }
  }

  applyAbs(key, v, instant = false) {
    if (!this.decks) return;
    const t = this.ctx.currentTime;
    const ramp = (param, value) => (instant ? param.setValueAtTime(value, t) : param.setTargetAtTime(value, t, SMOOTH));
    if (key === 'xfader') {
      const [ga, gb] = xfadeGains(v);
      ramp(this.decks.a.xf.gain, ga); ramp(this.decks.b.xf.gain, gb);
      return;
    }
    const [d, id] = key.split('.');
    const deck = this.decks[d];
    if (!deck) return;
    switch (id) {
      case 'tempo': deck.tempo = (v - 0.5) * 2; break;
      case 'trim': ramp(deck.trim.gain, 10 ** ((v - 0.5) * 24 / 20)); break;
      case 'low': ramp(deck.low.gain, eqDb(v)); break;
      case 'mid': ramp(deck.mid.gain, eqDb(v)); break;
      case 'hi': ramp(deck.hi.gain, eqDb(v)); break;
      case 'fader': ramp(deck.fader.gain, faderGain(v)); break;
      case 'filter': {
        // Left of centre = low-pass (muffles), right of centre = high-pass (thins out).
        const lp = v < 0.48 ? 22000 * (80 / 22000) ** ((0.48 - v) / 0.48) : 22000;
        const hp = v > 0.52 ? 10 * (9000 / 10) ** ((v - 0.52) / 0.48) : 10;
        ramp(deck.lp.frequency, lp); ramp(deck.hp.frequency, hp);
        break;
      }
    }
  }

  setPfl(id, on) {
    const deck = this.decks[id];
    deck.pfl = on;
    deck.pflGain.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, SMOOTH);
  }

  /** Play two chords together (used by the harmony lesson). */
  chords(...chords) {
    const t = this.ctx.currentTime + 0.03, out = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.16, t + 0.03); out.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
    lp.connect(out).connect(this.master);
    chords.forEach((midis, i) => midis.forEach((m) => {
      const osc = this.ctx.createOscillator();
      osc.type = i ? 'sawtooth' : 'triangle';
      osc.frequency.value = 440 * 2 ** ((m + 12 - 69) / 12);
      const g = this.ctx.createGain(); g.gain.value = i ? 0.45 : 1;
      osc.connect(g).connect(lp); osc.start(t); osc.stop(t + 2);
    }));
  }

  /** The Sync button: copy the other deck's tempo and line the beats up. */
  sync(id) {
    const me = this.decks[id], other = this.decks[id === 'a' ? 'b' : 'a'];
    if (!me.track || !other.track || !other.bpm) return;
    const want = clamp((other.bpm / me.track.bpm - 1) / this.tempoRange, -1, 1);
    this.bus.set(`${id}.tempo`, want / 2 + 0.5, 'game');
    if (me.playing && other.playing) me.nudge((-this.offsetBeats() * (id === 'b' ? 1 : -1) * 60) / me.track.bpm);
  }

  // ---- measurements the lessons score with --------------------------------

  /** How far deck B's beat is ahead (+) of deck A's, in beats, within +/- half of `span`. */
  offsetBeats(span = 1, time = this.ctx.currentTime) {
    const d = this.decks.b.beatAt(time) - this.decks.a.beatAt(time);
    return d - Math.round(d / span) * span;
  }
  /** Same, in milliseconds of real time. Positive = B's beat lands early. */
  offsetMs(span = 1, time) {
    const bpm = this.decks.a.bpm || 120;
    return (this.offsetBeats(span, time) * 60000) / bpm;
  }
  /** Convert an input timestamp into the clock time of the sound you were hearing. */
  heardTime(perfTs) {
    const ctx = this.ctx;
    const ot = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ot && ot.performanceTime > 0) return ot.contextTime + (perfTs - ot.performanceTime) / 1000;
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - (performance.now() - perfTs) / 1000;
  }
  /** How loud each deck is in the room right now (0..1), ignoring EQ. */
  audible(id) {
    const [ga, gb] = xfadeGains(this.bus.get('xfader'));
    return faderGain(this.bus.get(`${id}.fader`)) * (id === 'a' ? ga : gb);
  }
  /** Place a deck in the stereo field: -1 = left ear, +1 = right ear. */
  setPan(id, v) { this.decks[id].pan.pan.setTargetAtTime(v, this.ctx.currentTime, SMOOTH); }
  /** Hear one deck alone ('a' or 'b'), or both again (null). */
  solo(id) { for (const d of Object.values(this.decks)) d.out.gain.setTargetAtTime(!id || d.id === id ? 1 : 0, this.ctx.currentTime, SMOOTH); }

  stopAll() { if (this.decks) { this.solo(null); this.setPan('a', 0); this.setPan('b', 0); }
    for (const d of Object.values(this.decks || {})) { d.pause(); d.tempoLock = null; d.bendDir = 0; d.holdBend = 0; d.cueHeld = false; this.setPfl(d.id, false); } this.locks.clear(); this.allowSync = true;
    if (this.decks) for (const key of Object.keys(this.bus.values)) this.applyAbs(key, this.bus.values[key]);
  }
}

export { BEATS_PER_BAR, PHRASE_BARS, TRACKS };
