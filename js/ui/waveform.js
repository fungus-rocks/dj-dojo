// Scrolling waveform with a beat grid, like the display in DJ software.
// The playhead sits in the middle; music scrolls right-to-left through it.

import { SECTIONS } from '../audio/synth.js';

const COLORS = { a: ['#2f7fb0', '#7fd6ff'], b: ['#b0652a', '#ffc083'] };

export class WaveView {
  constructor(canvas, deck) {
    this.canvas = canvas; this.deck = deck; this.g = canvas.getContext('2d');
    this.pxPerSec = 95;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr), hgt = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== hgt) { this.canvas.width = w; this.canvas.height = hgt; }
    this.dpr = dpr;
  }

  draw(visible = true) {
    this.resize();
    const { g, canvas, deck } = this, W = canvas.width, H = canvas.height, track = deck.track;
    g.clearRect(0, 0, W, H);
    if (!track || !visible || !W) return;
    const [dim, bright] = COLORS[deck.id];
    const pos = deck.position, dur = deck.duration, pk = track.peaks;
    // Stretch with tempo, so matched tracks show matching beat spacing.
    const secPerPx = (deck.baseRate || 1) / (this.pxPerSec * this.dpr);
    const cx = W / 2, mid = H / 2, bins = pk.binsPerSec, n = pk.full.length;
    const step = Math.max(1, Math.round(this.dpr));
    for (let x = 0; x < W; x += step) {
      let t = pos + (x - cx) * secPerPx;
      if (track.loop) t = ((t % dur) + dur) % dur; else if (t < 0 || t >= dur) continue;
      const i = Math.min(n - 1, Math.floor(t * bins));
      const full = pk.full[i] * mid * 0.95, low = pk.low[i] * mid * 1.25;
      g.fillStyle = dim; g.fillRect(x, mid - full, step, full * 2);
      g.fillStyle = bright; g.fillRect(x, mid - Math.min(low, full), step, Math.min(low, full) * 2);
    }
    // Beat grid: thin = beat, taller = bar, full height + label = 8-bar section.
    const beatLen = 60 / track.bpm, tLeft = pos - cx * secPerPx, tRight = pos + (W - cx) * secPerPx;
    const first = Math.ceil((tLeft - track.firstBeat) / beatLen), lastBeat = Math.floor((tRight - track.firstBeat) / beatLen);
    g.font = `${10 * this.dpr}px ui-monospace, monospace`; g.textBaseline = 'top';
    for (let b = first; b <= lastBeat; b++) {
      const t = track.firstBeat + b * beatLen;
      if (!track.loop && (t < 0 || t > dur)) continue;
      const x = Math.round(cx + (t - pos) / secPerPx);
      const bar = b % 4 === 0, phrase = track.builtin && ((b % 32) + 32) % 32 === 0;
      g.fillStyle = phrase ? 'rgba(255,255,255,.85)' : bar ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.14)';
      const hh = phrase ? H : bar ? H * 0.5 : H * 0.22;
      g.fillRect(x, (H - hh) / 2, phrase ? 2 * this.dpr : this.dpr, hh);
      if (phrase) {
        const total = (track.bars || 0) * 4, bb = ((b % total) + total) % total;
        const sec = SECTIONS.find((s) => s.bars[0] * 4 === bb);
        if (sec) {
          const label = sec.name.toUpperCase(), tw = g.measureText(label).width;
          g.fillStyle = 'rgba(8,9,12,.8)'; g.fillRect(x + 2 * this.dpr, 0, tw + 8 * this.dpr, 15 * this.dpr);
          g.fillStyle = '#fff'; g.fillText(label, x + 6 * this.dpr, 3 * this.dpr);
        }
      }
    }
    // Playhead: "now" is the lime line in the middle.
    g.fillStyle = '#c6f35e'; g.fillRect(cx - this.dpr, 0, 2 * this.dpr, H);
    g.beginPath(); g.moveTo(cx - 6 * this.dpr, 0); g.lineTo(cx + 6 * this.dpr, 0); g.lineTo(cx, 7 * this.dpr); g.fill();
  }
}
