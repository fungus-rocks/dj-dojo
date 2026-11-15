// The on-screen controller. It mirrors whatever the hardware or keyboard does,
// can be dragged with the mouse, and lessons can spotlight the controls to use.

import { h } from './dom.js';
import { keysFor } from '../input/keyboard.js';
import { ABS_DEFAULTS } from '../input/bus.js';

const kbd = (key) => {
  const keys = key.endsWith('.jog') ? [...keysFor(key.replace('jog', 'nudge-')), ...keysFor(key.replace('jog', 'nudge+'))] : keysFor(key);
  return keys.length ? h('span', { class: 'keys' }, ...keys.map((k) => h('kbd', {}, k))) : null;
};

export class Rig {
  constructor(app) {
    this.app = app; this.bus = app.bus;
    const knob = (key, label) => h('div', { class: 'ctl knob', 'data-key': key, 'data-kind': 'abs' }, h('div', { class: 'dial' }, h('i')), h('label', {}, label), kbd(key));
    const fader = (key, label, cls = '') => h('div', { class: `ctl fader ${cls}`, 'data-key': key, 'data-kind': 'abs' }, h('div', { class: 'slot' }, h('i', { class: 'thumb' })), h('label', {}, label), kbd(key));
    const btn = (key, label, cls = '') => h('button', { class: `ctl btn ${cls}`, 'data-key': key, 'data-kind': 'button', tabindex: '-1' }, h('span', {}, label), kbd(key));

    const deck = (d, n) => h('div', { class: `deck deck-${d}` },
      h('div', { class: 'deckhead' }, h('b', {}, `DECK ${n}`), h('span', { class: 'trackname', 'data-track': d }, '–'), h('span', { class: 'bpm', 'data-bpm': d }, '')),
      h('div', { class: 'deckbody' },
        h('div', { class: 'ctl jog', 'data-key': `${d}.jog`, 'data-kind': 'jog' }, h('div', { class: 'platter', 'data-platter': d }, h('i')), kbd(`${d}.jog`)),
        h('div', { class: 'transport' }, btn(`${d}.sync`, 'SYNC', 'sm'), btn(`${d}.cue`, 'CUE', 'round'), btn(`${d}.play`, '▶ ❙❙', 'round play')),
        fader(`${d}.tempo`, 'TEMPO', 'tempo')));

    const strip = (d) => h('div', { class: `strip strip-${d}` },
      knob(`${d}.hi`, 'HI'), knob(`${d}.mid`, 'MID'), knob(`${d}.low`, 'LOW'), knob(`${d}.filter`, 'CFX'),
      btn(`${d}.pfl`, '🎧 CUE', 'sm pfl'),
      h('div', { class: 'faderrow' }, h('div', { class: 'meter', 'data-meter': d }, h('i')), fader(`${d}.fader`, 'LEVEL')));

    this.phase = h('div', { class: 'phasemeter' }, h('label', {}, 'beat offset'), h('div', { class: 'bar' }, h('i')), h('span', {}, ''));
    this.phase.style.visibility = 'hidden';
    this.el = h('div', { class: 'rig' },
      deck('a', 1),
      h('div', { class: 'mixer' }, h('div', { class: 'strips' }, strip('a'), strip('b')), this.phase, fader('xfader', 'CROSSFADER', 'horiz')),
      deck('b', 2));

    this.ctls = new Map();
    this.el.querySelectorAll('[data-key]').forEach((el) => this.ctls.set(el.dataset.key, el));
    for (const [key, el] of this.ctls) if (el.dataset.kind === 'abs') this.paint(key, this.bus.get(key));
    this.bus.on((e) => {
      if (e.type === 'abs') this.paint(e.key, e.value);
      else if (e.type === 'button') this.ctls.get(e.key)?.classList.toggle('down', e.down);
    });
    this.pointer();
  }

  paint(key, v) { this.ctls.get(key)?.style.setProperty('--v', v); }

  pointer() {
    let drag = null;
    this.el.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-key]');
      if (!el) return;
      const key = el.dataset.key, kind = el.dataset.kind;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (kind === 'button') { this.bus.press(key, true, 'mouse', e.timeStamp); drag = { el, key, kind }; return; }
      const rect = (el.querySelector('.slot, .platter') || el).getBoundingClientRect();
      drag = { el, key, kind, rect, y: e.clientY, v: this.bus.get(key), ang: Math.atan2(e.clientY - rect.top - rect.height / 2, e.clientX - rect.left - rect.width / 2) };
      if (kind === 'abs' && el.classList.contains('fader')) this.fromPointer(e, drag);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!drag || drag.kind === 'button') return;
      if (drag.kind === 'jog') {
        const r = drag.rect, ang = Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2);
        let d = ang - drag.ang; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
        drag.ang = ang;
        const ticks = Math.round((d / (2 * Math.PI)) * 720);
        if (ticks) this.bus.rel(drag.key, ticks, 'mouse', e.timeStamp);
      } else if (drag.el.classList.contains('fader')) this.fromPointer(e, drag);
      else this.bus.set(drag.key, drag.v + (drag.y - e.clientY) / 150, 'mouse', e.timeStamp);
    });
    const end = (e) => {
      if (drag?.kind === 'button') this.bus.press(drag.key, false, 'mouse', e.timeStamp);
      drag = null;
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('dblclick', (e) => {
      const el = e.target.closest('[data-kind="abs"]');
      if (!el) return;
      const id = el.dataset.key.split('.').pop();
      this.bus.set(el.dataset.key, id === 'xfader' ? 0.5 : ABS_DEFAULTS[id], 'mouse');
    });
  }

  fromPointer(e, drag) {
    const r = drag.rect, el = drag.el;
    let v;
    if (el.classList.contains('horiz')) v = (e.clientX - r.left) / r.width;
    else if (el.classList.contains('tempo')) v = (e.clientY - r.top) / r.height;     // down = faster
    else v = 1 - (e.clientY - r.top) / r.height;
    this.bus.set(drag.key, v, 'mouse', e.timeStamp);
  }

  /** Spotlight the controls a lesson wants you to use. */
  highlight(keys = []) {
    const set = new Set(keys);
    this.el.classList.toggle('has-hl', set.size > 0);
    for (const [key, el] of this.ctls) el.classList.toggle('hl', set.has(key));
  }

  /** Called every animation frame. */
  update(view = {}) {
    const { engine } = this.app;
    if (!engine.decks) return;
    for (const d of ['a', 'b']) {
      const deck = engine.decks[d];
      this.el.querySelector(`[data-platter="${d}"]`).style.transform = `rotate(${(deck.position * 200) % 360}deg)`;
      this.el.querySelector(`[data-track="${d}"]`).textContent = deck.track ? deck.track.name : '–';
      const showBpm = view.bpm ? view.bpm[d] : true;
      this.el.querySelector(`[data-bpm="${d}"]`).textContent = deck.track ? (showBpm ? `${deck.bpm.toFixed(2)} BPM` : '?? BPM') : '';
      this.el.querySelector(`[data-meter="${d}"] i`).style.height = `${Math.min(100, deck.level() * 115)}%`;
      this.ctls.get(`${d}.play`).classList.toggle('lit', deck.playing);
      this.ctls.get(`${d}.pfl`).classList.toggle('lit', deck.pfl);
    }
    this.phase.style.visibility = view.phase ? 'visible' : 'hidden';
    if (view.phase && engine.decks.a.playing && engine.decks.b.playing) {
      const ms = engine.offsetMs();
      this.phase.querySelector('i').style.left = `${50 + Math.max(-1, Math.min(1, ms / 120)) * 50}%`;
      this.phase.querySelector('i').classList.toggle('good', Math.abs(ms) < 15);
      this.phase.querySelector('span').textContent = Math.abs(ms) < 1 ? 'in step' : `Deck 2 ${Math.abs(ms).toFixed(0)} ms ${ms > 0 ? 'ahead' : 'behind'}`;
    }
  }
}
