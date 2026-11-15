// Home (the lesson path), Free Play and Settings screens.

import { h } from './dom.js';
import { WaveView } from './waveform.js';
import { LESSONS, CATEGORIES, TRACKS } from '../game/lessons.js';
import { store, save, reset } from '../game/progress.js';
import { KEYMAP, keyLabel } from '../input/keyboard.js';
import { PROFILES } from '../input/midi.js';

export const isUnlocked = (i) => store.settings.unlockAll || i === 0 || LESSONS[i].open || (store.scores[LESSONS[i - 1].id]?.stars ?? 0) >= 1;

export class HomeScreen {
  constructor(app) { this.app = app; }
  mount(root) {
    const { app } = this;
    const earned = LESSONS.reduce((s, l) => s + (store.scores[l.id]?.stars ?? 0), 0);
    const nextIdx = LESSONS.findIndex((l, i) => isUnlocked(i) && !(store.scores[l.id]?.stars));
    const card = (l) => {
      const i = LESSONS.indexOf(l), sc = store.scores[l.id], open = isUnlocked(i);
      return h(open ? 'a' : 'div', { class: `lcard ${open ? '' : 'locked'} ${i === nextIdx ? 'next' : ''}`, href: open ? `#/lesson/${l.id}` : null, 'data-nav': open },
        h('span', { class: 'num' }, open ? String(i + 1).padStart(2, '0') : '🔒'),
        h('b', {}, l.title),
        h('small', {}, l.skill),
        h('span', { class: 'meta' },
          h('span', { class: 'stars sm' }, ...[1, 2, 3].map((n) => h('i', { class: n <= (sc?.stars ?? 0) ? 'on' : '' }, '★'))),
          h('span', {}, sc ? `best ${sc.best}` : `~${l.mins} min`)));
    };
    this.el = h('section', { class: 'screen home' },
      h('header', { class: 'bar' },
        h('div', { class: 'logo' }, h('b', {}, 'DJ DOJO'), h('small', {}, 'learn to mix, one skill at a time')),
        h('span', { class: 'total' }, `★ ${earned} / ${LESSONS.length * 3}`),
        app.devicePill(),
        h('a', { class: 'ghost', href: '#/settings', 'data-nav': true }, 'Settings')),
      h('main', {},
        ...CATEGORIES.map((c) => h('section', { class: 'cat' },
          h('div', { class: 'cathead' }, h('h3', {}, c.name), h('p', {}, c.blurb)),
          h('div', { class: 'cards' }, ...LESSONS.filter((l) => l.cat === c.id).map(card)))),
        h('section', { class: 'cat' },
          h('div', { class: 'cathead' }, h('h3', {}, 'Free Play'), h('p', {}, 'No scores. Two decks, the built-in tracks or your own music.')),
          h('div', { class: 'cards' }, h('a', { class: 'lcard free', href: '#/free', 'data-nav': true }, h('span', { class: 'num' }, '∞'), h('b', {}, 'Open the decks'), h('small', {}, 'Practise anything, your way'), h('span', { class: 'meta' }, h('span', {}, 'Load your own MP3s')))))));
    root.replaceChildren(this.el);
    this.el.querySelector('.lcard.next')?.focus();
  }
  unmount() {}
  frame() {}
}

export class FreeScreen {
  constructor(app) { this.app = app; this.showPhase = true; }
  mount(root) {
    const { app } = this;
    this.canvasA = h('canvas'); this.canvasB = h('canvas');
    const picker = (d) => {
      const sel = h('select', { onchange: () => this.load(d, sel.value) }, ...TRACKS.map((t) => h('option', { value: t.id }, `${t.name} · ${t.bpm} BPM · ${t.camelot}`)));
      const file = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: () => file.files[0] && this.loadFile(d, file.files[0]) });
      const bpm = h('input', { type: 'number', step: '0.01', class: 'bpmfix', title: 'Correct the detected BPM', hidden: true, onchange: () => { const t = app.engine.decks[d].track; if (t && +bpm.value > 40) t.bpm = +bpm.value; } });
      this[`sel${d}`] = sel; this[`bpm${d}`] = bpm;
      return h('div', { class: `picker p${d}` }, h('b', { class: `c${d}` }, d === 'a' ? 'Deck 1' : 'Deck 2'), sel, h('button', { class: 'ghost small', onclick: () => file.click() }, 'Load a file…'), bpm, file);
    };
    this.msg = h('span', { class: 'hint' });
    const toggle = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { this.showPhase = e.target.checked; } }), ' Show beat-offset meter (turn off to train your ears)');
    this.overlay = h('div', { class: 'overlay open' }, h('div', { class: 'card' },
      h('small', { class: 'eyebrow' }, 'Free play'), h('h2', {}, 'Open decks'),
      h('p', { class: 'lead' }, 'Everything is live: play, tempo, jog, EQ, filter, faders and Sync. Nothing is scored.'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => this.begin() }, 'Start'))));
    this.el = h('section', { class: 'screen lesson free' },
      h('header', { class: 'bar' }, h('a', { class: 'ghost', href: '#/' }, '← Lessons'), h('div', { class: 'title' }, h('small', {}, 'No scores'), h('b', {}, 'Free Play')), app.devicePill()),
      h('div', { class: 'stage' },
        h('div', { class: 'waves' }, h('div', { class: 'wave wa' }, h('span', { class: 'tag ca' }, '1'), this.canvasA), h('div', { class: 'wave wb' }, h('span', { class: 'tag cb' }, '2'), this.canvasB)),
        h('div', { class: 'pickers' }, picker('a'), picker('b')), h('div', { class: 'freeopts' }, toggle, this.msg)),
      h('div', { class: 'rigwrap' }, app.rig.el), this.overlay);
    root.replaceChildren(this.el);
    this.selb.value = 'tram';
    this.overlay.querySelector('button').focus();
  }
  async begin() {
    const { engine } = this.app;
    await Promise.race([engine.init(), new Promise((r) => setTimeout(r, 1500))]);
    if (!engine.ctx || engine.ctx.state !== 'running') return;
    engine.stopAll(); engine.decks.a.unload(); engine.decks.b.unload();
    engine.tempoRange = store.settings.tempoRange; engine.jogScale = store.settings.jogScale;
    this.waveA = new WaveView(this.canvasA, engine.decks.a); this.waveB = new WaveView(this.canvasB, engine.decks.b);
    this.overlay.classList.remove('open');
    this.ready = true;
    await this.load('a', this.sela.value); await this.load('b', this.selb.value);
  }
  async load(d, id) {
    if (!this.ready) return;
    this.msg.textContent = 'Building track…';
    this.app.engine.decks[d].load(await this.app.engine.builtin(id));
    this[`bpm${d}`].hidden = true; this.msg.textContent = '';
  }
  async loadFile(d, file) {
    if (!this.ready) return;
    this.msg.textContent = `Reading ${file.name}…`;
    try {
      const track = await this.app.engine.fromFile(file);
      this.app.engine.decks[d].load(track);
      this[`bpm${d}`].hidden = false; this[`bpm${d}`].value = track.bpm;
      this.msg.textContent = `${track.name}: about ${track.bpm} BPM (a best guess; correct it in the box if it is off).`;
    } catch { this.msg.textContent = 'Could not read that file. Try an MP3, WAV or M4A.'; }
  }
  unmount() { this.ready = false; this.app.engine.stopAll(); }
  frame() {
    if (!this.ready) return;
    this.waveA.draw(); this.waveB.draw();
    this.app.rig.update({ phase: this.showPhase });
  }
}

export class SettingsScreen {
  constructor(app) { this.app = app; }
  mount(root) {
    const { app } = this, s = store.settings;
    const row = (label, control, note) => h('div', { class: 'row' }, h('label', {}, label), control, note ? h('small', {}, note) : null);
    const num = (key, attrs) => h('input', { type: 'number', value: s[key], ...attrs, onchange: (e) => { s[key] = +e.target.value; save(); } });
    const check = (key) => { const el = h('input', { type: 'checkbox', onchange: (e) => { s[key] = e.target.checked; save(); } }); el.checked = s[key]; return el; };
    const range = h('select', { onchange: (e) => { s.tempoRange = +e.target.value; save(); } }, ...[0.06, 0.08, 0.1, 0.16].map((r) => h('option', { value: r }, `±${Math.round(r * 100)}%`)));
    range.value = String(s.tempoRange);
    this.midiStatus = h('div', { class: 'midistatus' });
    this.log = h('pre', { class: 'midilog' });
    const keys = Object.entries(KEYMAP).map(([code, m]) => h('tr', {}, h('td', {}, h('kbd', {}, keyLabel(code))), h('td', {}, m[1] + (m[0] === 'move' ? (m[2] > 0 ? ' +' : ' −') : ''))));
    this.el = h('section', { class: 'screen settings' },
      h('header', { class: 'bar' }, h('a', { class: 'ghost', href: '#/' }, '← Lessons'), h('div', { class: 'title' }, h('b', {}, 'Settings')), app.devicePill()),
      h('main', {},
        h('section', { class: 'panel' }, h('h3', {}, 'Controller'),
          this.midiStatus,
          h('p', { class: 'note' }, `Supported now: ${PROFILES.map((p) => p.name).join(', ')}. Needs Chrome or Edge on a computer. Close rekordbox first: only one app can talk to the controller at a time.`),
          row('Tempo fader feels upside down', check('invertTempo'), 'Normal: towards you = faster.'),
          row('Jog wheel sensitivity', num('jogScale', { step: '0.1', min: '0.2', max: '4' }), '1 = normal. Higher = each turn moves the track more.'),
          h('h4', {}, 'Controller messages (move a control to test it)'), this.log),
        h('section', { class: 'panel' }, h('h3', {}, 'Game'),
          row('Tempo fader range', range, 'How far the tempo fader can change the speed.'),
          row('Tap timing offset (ms)', num('tapOffsetMs', { step: '5' }), 'Cancels out speaker or Bluetooth delay in the tapping lessons. The game offers to set this for you after a tapping lesson.'),
          row('Unlock every lesson', check('unlockAll')),
          row('Progress', h('button', { class: 'ghost small', onclick: (e) => { if (confirm('Erase all stars and scores?')) { reset(); e.target.textContent = 'Erased'; } } }, 'Erase my progress'))),
        h('section', { class: 'panel' }, h('h3', {}, 'Keyboard controls'),
          h('p', { class: 'note' }, 'Left hand runs Deck 1 (a), right hand runs Deck 2 (b). Tap a key for a small step, hold it to glide. Hold Shift for finer moves.'),
          h('table', { class: 'keytable' }, ...keys))));
    root.replaceChildren(this.el);
    this.timer = setInterval(() => this.refresh(), 250);
    this.refresh();
  }
  refresh() {
    const m = this.app.midi;
    const text = {
      idle: 'Not connected yet.', unsupported: 'This browser cannot read MIDI controllers. Use Chrome or Edge on a computer.',
      denied: 'Permission was refused. Allow “MIDI devices” for this site in the browser’s site settings, then reload.',
      waiting: `No supported controller found.${m.otherInputs?.length ? ' Seen: ' + m.otherInputs.join(', ') : ' Plug it in by USB.'}`,
      connected: `Connected: ${m.deviceName}${m.sysex ? '' : ' (limited: could not ask for knob positions, so wiggle each control once)'}`,
    }[m.status];
    this.midiStatus.replaceChildren(h('span', { class: `dot ${m.status}` }), text, ' ',
      m.status !== 'connected' && m.supported ? h('button', { class: 'ghost small', onclick: () => m.connect() }, 'Connect controller') : null);
    this.log.textContent = m.log.slice(-14).map((l) => l.text + (l.port ? `   (${l.port})` : '')).join('\n') || 'No messages yet.';
  }
  unmount() { clearInterval(this.timer); }
  frame() {}
}
