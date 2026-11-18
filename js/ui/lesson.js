// Runs one lesson: briefing -> setup check -> play -> results.

import { h, DECK_NAME, CONTROL_NAME } from './dom.js';
import { WaveView } from './waveform.js';
import { keysFor } from '../input/keyboard.js';
import { ABS_DEFAULTS } from '../input/bus.js';
import { LESSONS, CATEGORIES } from '../game/lessons.js';
import { starsFor } from '../game/scoring.js';
import { store, save, record } from '../game/progress.js';

const pad = (e) => { const m = /^pad(\d)$/.exec(e.id || ''); return m ? +m[1] : 0; };
const kbdHtml = (keys) => keys.map((k) => `<kbd>${k}</kbd>`).join(' ');

/** How to describe a control to the player, for the device they are using. */
export function describeControl(key, hardware) {
  const GAME = { tap: ['Space', 'any PAD'], snap: ['Space', 'PAD 1'], confirm: ['Enter', 'PAD 4'], left: ['←', 'PAD 1'], right: ['→', 'PAD 2'] };
  if (GAME[key]) return hardware ? `<kbd>${GAME[key][1]}</kbd> / <kbd>${GAME[key][0]}</kbd>` : `<kbd>${GAME[key][0]}</kbd>`;
  if (key === 'xfader') return `<b>crossfader</b>${hardware ? '' : ' ' + kbdHtml(keysFor(key))}`;
  const [d, id] = key.split('.');
  const keys = id === 'jog' ? [...keysFor(`${d}.nudge-`), ...keysFor(`${d}.nudge+`)] : keysFor(key);
  const eq = ['low', 'mid', 'hi'].includes(id) ? ' knob' : '';
  return `<b class="c${d}">${DECK_NAME[d]} ${CONTROL_NAME[id]}${eq}</b>${hardware || !keys.length ? '' : ' ' + kbdHtml(keys)}`;
}

export class LessonScreen {
  constructor(app, lesson) {
    this.app = app; this.lesson = lesson; this.state = 'brief';
    this.view = {}; this.viewKey = ''; this.timers = []; this.promptText = '';
    this.token = 0;   // bumps on every (re)start so an older start can't carry on
  }

  mount(root) {
    const { app, lesson } = this;
    const cat = CATEGORIES.find((c) => c.id === lesson.cat);
    this.canvasA = h('canvas'); this.canvasB = h('canvas');
    this.waves = h('div', { class: 'waves' },
      h('div', { class: 'wave wa' }, h('span', { class: 'tag ca' }, '1'), this.canvasA),
      h('div', { class: 'wave wb' }, h('span', { class: 'tag cb' }, '2'), this.canvasB));
    this.promptEl = h('div', { class: 'prompt' });
    this.hud = h('div', { class: 'hud' });
    this.toast = h('div', { class: 'toast' });
    this.overlay = h('div', { class: 'overlay' });
    this.rigWrap = h('div', { class: 'rigwrap' }, app.rig.el);
    this.el = h('section', { class: 'screen lesson' },
      h('header', { class: 'bar' },
        h('a', { class: 'ghost', href: '#/' }, '← Lessons'),
        h('div', { class: 'title' }, h('small', {}, cat.name), h('b', {}, lesson.title)),
        h('button', { class: 'ghost restart', title: 'Start this lesson again from the beginning (Backspace)', onclick: (e) => { e.currentTarget.blur(); this.restart(); } }, '↺ Restart'),
        app.devicePill()),
      h('div', { class: 'stage' }, this.waves, this.promptEl, this.hud, this.toast),
      this.rigWrap, this.overlay);
    root.replaceChildren(this.el);
    this.off = app.bus.on((e) => this.overlayInput(e));
    this.onKey = (e) => { if (e.code === 'Backspace' && !e.repeat && !e.target.closest?.('input, textarea, select')) { e.preventDefault(); this.restart(); } };
    window.addEventListener('keydown', this.onKey);
    app.engine.intercept = (e) => this.gameInput(e);
    this.showBrief();
  }

  unmount() {
    this.off?.(); this.clearTimers(); window.removeEventListener('keydown', this.onKey);
    this.state = 'gone';
    this.app.engine.stopAll(); this.app.engine.intercept = null;
    this.app.rig.highlight([]);
  }

  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

  // ---- overlays -----------------------------------------------------------

  showOverlay(...kids) { this.overlay.replaceChildren(h('div', { class: 'card' }, ...kids)); this.overlay.classList.add('open'); }
  hideOverlay() { this.overlay.classList.remove('open'); }

  showBrief() {
    const { lesson, app } = this, hw = app.bus.hardware;
    this.state = 'brief';
    this.primary = this.startBtn = h('button', { class: 'primary', onclick: () => this.begin() }, 'Start');
    this.showOverlay(
      h('small', { class: 'eyebrow' }, lesson.skill),
      h('h2', {}, lesson.title),
      h('p', { class: 'lead' }, lesson.what),
      h('p', { class: 'why' }, h('b', {}, 'Why it matters: '), lesson.why),
      h('ol', { class: 'how' }, ...lesson.how.map((s) => h('li', {}, s))),
      h('div', { class: 'uses' }, h('label', {}, 'You will use'), ...lesson.uses.map((k) => h('span', { class: 'use', html: describeControl(k, hw) }))),
      h('div', { class: 'actions' }, this.primary, h('span', { class: 'hint', html: `or press ${describeControl('confirm', hw)}` })));
    this.primary.focus();
  }

  overlayInput(e) {
    if (this.state === 'running' || e.type !== 'button' || !e.down) return;
    const confirm = e.id === 'confirm' || e.id === 'browsePress' || pad(e) === 4 || pad(e) === 8;
    if (confirm && this.primary && !this.primary.disabled) this.primary.click();
  }

  /** Throw away the current attempt and play the lesson again from the very start. */
  restart() {
    if (this.state === 'gone') return;
    if (this.state === 'brief') return this.begin();
    this.clearTimers(); this.app.engine.stopAll(); this.app.rig.highlight([]);
    this.toast.classList.remove('show');
    this.hideOverlay(); this.overlay.classList.remove('see-through');
    this.startBtn = null; this.primary = null;
    this.state = 'restart';
    this.begin();
  }

  async begin() {
    if (!['brief', 'result', 'restart'].includes(this.state)) return;
    const { app, lesson } = this, { engine, bus } = app;
    const token = ++this.token, stale = () => token !== this.token || this.state !== 'loading';
    this.state = 'loading'; this.clearTimers();
    if (this.startBtn) { this.startBtn.disabled = true; this.startBtn.textContent = 'Loading…'; }
    await Promise.race([engine.init(), new Promise((r) => setTimeout(r, 1500))]);
    if (!engine.ctx || engine.ctx.state !== 'running') {
      this.state = 'brief';
      if (!this.startBtn) this.showBrief();
      this.startBtn.disabled = false; this.startBtn.textContent = 'Click to start (switches sound on)';
      return;
    }
    engine.stopAll();
    // Keyboard mode has no real knobs to trust, so start every lesson from neutral.
    if (!bus.hardware) for (const key of Object.keys(bus.values)) bus.set(key, key === 'xfader' ? 0.5 : ABS_DEFAULTS[key.split('.')[1]], 'game');
    engine.tempoRange = store.settings.tempoRange; engine.jogScale = store.settings.jogScale;
    this.hud.replaceChildren(); this.prompt(''); this.view = {}; this.viewKey = '';
    const ctx = this.ctx = this.makeCtx();
    const run = this.run = lesson.make(ctx);
    for (const d of ['a', 'b']) {
      const id = run.tracks[d];
      if (id) engine.decks[d].load(await engine.builtin(id)); else engine.decks[d].unload();
    }
    if (stale()) return;
    this.waveA = new WaveView(this.canvasA, engine.decks.a); this.waveB = new WaveView(this.canvasB, engine.decks.b);
    run.prepare();
    await this.checklist(run.checklist || [], stale);
    if (stale()) return;
    this.hideOverlay(); this.primary = null;
    this.state = 'running';
    run.start();
  }

  /** Make sure faders and knobs are where the lesson needs them. */
  checklist(items, stale = () => false) {
    const { bus } = this.app;
    if (!items.length) return Promise.resolve();
    if (!bus.hardware) { for (const it of items) bus.set(it.key, it.want, 'game'); return Promise.resolve(); }
    const ok = (it) => bus.isKnown(it.key) && it.test(bus.get(it.key));
    if (items.every(ok)) return Promise.resolve();
    return new Promise((resolve) => {
      const rows = items.map((it) => h('li', {}, h('i', {}, '○'), ' ', it.label));
      const done = () => { clearInterval(timer); this.app.rig.highlight(this.view.highlight || []); resolve(); };
      const skip = h('button', { class: 'ghost', onclick: () => { for (const it of items) if (!ok(it)) bus.set(it.key, it.want, 'game'); done(); } }, 'Skip check');
      this.showOverlay(h('small', { class: 'eyebrow' }, 'Get set'), h('h2', {}, 'Set up your controller'),
        h('p', { class: 'lead' }, 'Move each control into place. If one will not tick, give it a wiggle so the game can read it.'),
        h('ul', { class: 'check' }, ...rows), h('div', { class: 'actions' }, skip));
      this.overlay.classList.add('see-through');
      this.app.rig.highlight(items.map((it) => it.key));
      let good = 0;
      const timer = setInterval(() => {
        if (stale()) { clearInterval(timer); return; }
        const res = items.map(ok);
        rows.forEach((r, i) => { r.classList.toggle('ok', res[i]); r.firstChild.textContent = res[i] ? '✓' : '○'; });
        good = res.every(Boolean) ? good + 1 : 0;
        if (good >= 4) { this.overlay.classList.remove('see-through'); done(); }
      }, 120);
    }).finally(() => this.overlay.classList.remove('see-through'));
  }

  // ---- lesson context -----------------------------------------------------

  makeCtx() {
    const { app } = this, { engine, bus } = app;
    const down = (e) => e.type === 'button' && e.down;
    return {
      engine, bus, a: engine.decks.a, b: engine.decks.b, hud: this.hud, h, settings: store.settings,
      get hardware() { return bus.hardware; },
      prompt: (html) => this.prompt(html),
      feedback: (text, kind) => this.feedback(text, kind),
      finish: (result) => this.finish(result),
      setView: (v) => this.setView(v),
      lock: (...keys) => keys.forEach((k) => engine.locks.add(k)),
      setAbs: (values) => { for (const [k, v] of Object.entries(values)) if (!bus.hardware || !bus.known[k]) bus.set(k, v, 'game'); },
      after: (ms, fn) => this.timers.push(setTimeout(() => { if (this.state === 'running') fn(); }, ms)),
      key: (name) => describeControl(name, bus.hardware),
      ctl: (key) => describeControl(key, bus.hardware),
      playChords: (...c) => engine.chords(...c),
      isTap: (e) => down(e) && (e.id === 'tap' || pad(e) > 0),
      isPrimary: (e) => down(e) && (e.id === 'tap' || pad(e) === 1 || pad(e) === 5),
      isConfirm: (e) => down(e) && (e.id === 'confirm' || e.id === 'browsePress' || pad(e) === 4 || pad(e) === 8),
      isLeft: (e) => down(e) && (e.id === 'left' || pad(e) === 1 || pad(e) === 5),
      isRight: (e) => down(e) && (e.id === 'right' || pad(e) === 2 || pad(e) === 6),
    };
  }

  gameInput(e) {
    if (this.state !== 'running') return e.type !== 'abs';     // nothing plays behind an overlay
    return this.run.input(e) === true;
  }

  prompt(html) { if (html !== this.promptText) { this.promptText = html; this.promptEl.innerHTML = html; } }

  feedback(text, kind = 'info') {
    this.toast.textContent = text; this.toast.className = `toast show ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('show'), 2600);
  }

  setView(v) {
    Object.assign(this.view, v);
    const key = JSON.stringify(this.view);
    if (key === this.viewKey) return;
    this.viewKey = key;
    const w = this.view.waves || {};
    this.waves.classList.toggle('none', !w.a && !w.b);
    this.waves.querySelector('.wa').classList.toggle('off', !w.a);
    this.waves.querySelector('.wb').classList.toggle('off', !w.b);
    this.rigWrap.classList.toggle('off', this.view.rig === false);
    this.app.rig.highlight(this.view.highlight || []);
  }

  frame() {
    if (!this.run || !this.waveA || (this.state !== 'running' && this.state !== 'loading')) return;
    if (this.state === 'running') this.run.frame();
    const w = this.view.waves || {};
    this.waveA.draw(!!w.a); this.waveB.draw(!!w.b);
    this.app.rig.update(this.view);
  }

  // ---- results ------------------------------------------------------------

  finish(result) {
    if (this.state !== 'running') return;
    this.state = 'result'; this.clearTimers();
    const { app, lesson } = this;
    app.engine.stopAll(); app.rig.highlight([]);
    const score = Math.round(result.score), stars = starsFor(score);
    const isBest = record(lesson.id, score, stars);
    const idx = LESSONS.indexOf(lesson), next = LESSONS[idx + 1];
    const again = h('button', { class: stars ? 'ghost' : 'primary', onclick: () => this.begin() }, 'Try again');
    const onward = next ? h('a', { class: stars ? 'primary button' : 'ghost button', href: `#/lesson/${next.id}` }, `Next: ${next.title} →`) : h('a', { class: 'primary button', href: '#/' }, 'Back to lessons');
    this.primary = stars ? onward : again; this.startBtn = again;
    const cal = result.calibrate != null ? h('button', {
      class: 'ghost small', onclick: (e) => { store.settings.tapOffsetMs = result.calibrate; save(); e.target.textContent = `Saved: taps now shifted by ${result.calibrate} ms`; e.target.disabled = true; },
    }, `Cancel out my ${Math.abs(result.calibrate - store.settings.tapOffsetMs)} ms delay in future`) : null;
    this.showOverlay(
      h('small', { class: 'eyebrow' }, stars ? (isBest ? 'New best' : 'Lesson passed') : 'Not quite: 60 needed to pass'),
      h('div', { class: 'stars' }, ...[1, 2, 3].map((n) => h('i', { class: n <= stars ? 'on' : '' }, '★'))),
      h('div', { class: 'score' }, String(score), h('small', {}, '/100')),
      h('table', { class: 'parts' }, ...result.parts.map((p) => h('tr', {}, h('td', {}, p.label), h('td', {}, p.detail), h('td', { class: 'pts' }, p.score != null ? String(Math.round(p.score)) : '')))),
      h('div', { class: 'tips' }, ...result.tips.map((t) => h('p', {}, t))),
      cal,
      h('div', { class: 'actions' }, again, onward));
    (this.primary.tagName === 'A' ? this.primary : again).focus();
  }
}
