import { Bus } from './input/bus.js';
import { Midi } from './input/midi.js';
import { Keyboard } from './input/keyboard.js';
import { Engine } from './audio/engine.js';
import { Rig } from './ui/rig.js';
import { h } from './ui/dom.js';
import { LessonScreen } from './ui/lesson.js';
import { HomeScreen, FreeScreen, SettingsScreen, isUnlocked } from './ui/screens.js';
import { LESSONS } from './game/lessons.js';
import { store } from './game/progress.js';

const root = document.getElementById('app');
const bus = new Bus();
const app = {
  bus,
  engine: new Engine(bus),
  midi: new Midi(bus, store.settings),
  keyboard: new Keyboard(bus),
  screen: null,

  /** The "which device am I using" badge shown in every header. */
  devicePill() {
    const el = h('button', { class: 'pill', onclick: () => (app.midi.status === 'connected' ? (location.hash = '#/settings') : app.midi.connect()) });
    app.paintPill(el);
    return el;
  },
  paintPill(el) {
    const m = app.midi, on = m.status === 'connected';
    el.classList.toggle('on', on);
    el.textContent = on ? `● ${m.profile.name.replace('Pioneer DJ ', '')}` : !m.supported ? '⌨ Keyboard mode' : m.status === 'waiting' ? '⌨ Keyboard mode · no controller found' : '⌨ Keyboard mode · connect controller';
    el.title = on ? 'Controller connected' : 'Click to connect a DJ controller (Chrome or Edge)';
  },
};
app.rig = new Rig(app);
app.keyboard.locks = app.engine.locks;
window.djdojo = app;   // handy for debugging in the browser console

app.midi.onChange = () => {
  document.body.classList.toggle('hw', app.midi.status === 'connected');
  document.querySelectorAll('.pill').forEach((el) => app.paintPill(el));
};

function route() {
  app.screen?.unmount();
  const [, name, arg] = location.hash.split('/');
  const idx = LESSONS.findIndex((l) => l.id === arg);
  if (name === 'lesson' && idx >= 0 && isUnlocked(idx)) app.screen = new LessonScreen(app, LESSONS[idx]);
  else if (name === 'free') app.screen = new FreeScreen(app);
  else if (name === 'settings') app.screen = new SettingsScreen(app);
  else app.screen = new HomeScreen(app);
  app.screen.mount(root);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();

// Browse knob on the controller: scroll through whatever can be opened.
bus.on((e) => {
  if (e.key === 'browse' && e.type === 'rel') {
    const items = [...document.querySelectorAll('[data-nav]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    items[Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i + Math.sign(e.delta))))].focus();
  } else if (e.key === 'browsePress' && e.type === 'button' && e.down && document.activeElement?.matches('[data-nav]')) document.activeElement.click();
});

// Keep the controller's lights in step with the decks.
const lit = {};
function frame() {
  app.screen?.frame();
  if (app.engine.decks && app.midi.status === 'connected') {
    for (const d of ['a', 'b']) for (const [id, on] of [['play', app.engine.decks[d].playing], ['pfl', app.engine.decks[d].pfl]]) {
      const key = `${d}.${id}`;
      if (lit[key] !== on) { lit[key] = on; app.midi.led(key, on); }
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// If the browser already trusts this site with MIDI, connect straight away.
if (app.midi.supported && navigator.permissions?.query) {
  navigator.permissions.query({ name: 'midi', sysex: true }).then((p) => { if (p.state === 'granted') app.midi.connect(); }).catch(() => {});
}
