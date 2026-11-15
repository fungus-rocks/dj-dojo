// Keyboard = a pocket controller for when the real one is at home.
// Buttons map 1:1. Knobs and faders move while a key is held (Shift = fine).

export const KEYMAP = {
  // deck A (left hand)            deck B (right hand)
  KeyA: ['button', 'a.cue'],       KeyJ: ['button', 'b.cue'],
  KeyS: ['button', 'a.play'],      KeyK: ['button', 'b.play'],
  KeyG: ['button', 'a.sync'],      KeyH: ['button', 'b.sync'],
  KeyV: ['button', 'a.pfl'],       KeyB: ['button', 'b.pfl'],
  KeyZ: ['button', 'a.nudge-'],    KeyN: ['button', 'b.nudge-'],
  KeyX: ['button', 'a.nudge+'],    KeyM: ['button', 'b.nudge+'],
  KeyQ: ['move', 'a.tempo', -1],   KeyU: ['move', 'b.tempo', -1],
  KeyW: ['move', 'a.tempo', +1],   KeyI: ['move', 'b.tempo', +1],
  Digit1: ['move', 'a.fader', -1], Digit7: ['move', 'b.fader', -1],
  Digit2: ['move', 'a.fader', +1], Digit8: ['move', 'b.fader', +1],
  KeyE: ['move', 'a.low', -1],     KeyO: ['move', 'b.low', -1],
  KeyR: ['move', 'a.low', +1],     KeyP: ['move', 'b.low', +1],
  KeyD: ['move', 'a.filter', -1],  KeyL: ['move', 'b.filter', -1],
  KeyF: ['move', 'a.filter', +1],  Semicolon: ['move', 'b.filter', +1],
  ArrowLeft: ['move', 'xfader', -1, 'left'],
  ArrowRight: ['move', 'xfader', +1, 'right'],
  Space: ['button', 'tap'],
  Enter: ['button', 'confirm'],
};

const LABEL = { Semicolon: ';', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter' };
export const keyLabel = (code) => LABEL[code] || code.replace(/^Key|^Digit/, '');

/** Keys bound to a control, e.g. keysFor('a.tempo') -> ['Q', 'W']. */
export function keysFor(key) {
  return Object.entries(KEYMAP).filter(([, m]) => m[1] === key).map(([code]) => keyLabel(code));
}

const SPEED = { tempo: 0.05, fader: 0.35, xfader: 0.4, default: 1.1 };   // share of full travel per second

export class Keyboard {
  constructor(bus) {
    this.bus = bus; this.held = new Map(); this.enabled = true;
    this.locks = new Set();     // controls the current lesson has switched off
    window.addEventListener('keydown', (e) => this.down(e));
    window.addEventListener('keyup', (e) => this.up(e));
    window.addEventListener('blur', () => { for (const code of [...this.held.keys()]) this.release(code); });
    let last = performance.now();
    const loop = (now) => { this.step((now - last) / 1000); last = now; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  down(e) {
    this.shift = e.shiftKey;
    if (!this.enabled || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select')) return;
    const m = KEYMAP[e.code];
    if (!m) return;
    if (e.code === 'Enter' && e.target.closest?.('button, a')) return;   // let buttons work normally
    e.preventDefault();
    if (e.repeat || this.held.has(e.code)) return;
    this.held.set(e.code, { since: e.timeStamp });
    if (m[0] === 'button') this.bus.press(m[1], true, 'key', e.timeStamp);
    else {
      if (m[3]) this.bus.press(m[3], true, 'key', e.timeStamp);     // arrows double as quiz answers
      // A tap moves one small click; holding glides.
      const fine = m[1].endsWith('tempo') ? 0.0005 : 0.02;
      if (!this.locks.has(m[1])) this.bus.set(m[1], this.bus.get(m[1]) + m[2] * fine * (e.shiftKey ? 0.5 : 1), 'key', e.timeStamp);
    }
  }

  up(e) { this.shift = e.shiftKey; if (this.held.has(e.code)) { e.preventDefault(); this.release(e.code, e.timeStamp); } }

  release(code, t) {
    this.held.delete(code);
    const m = KEYMAP[code];
    if (m[0] === 'button') this.bus.press(m[1], false, 'key', t);
    else if (m[3]) this.bus.press(m[3], false, 'key', t);
  }

  step(dt) {
    if (dt <= 0 || dt > 0.2) return;
    const now = performance.now();
    for (const [code, h] of this.held) {
      const m = KEYMAP[code];
      if (m[0] !== 'move' || this.locks.has(m[1])) continue;
      const age = (now - h.since) / 1000;
      if (age < 0.22) continue;                         // short press = single click only
      const id = m[1].split('.').pop();
      let speed = SPEED[id] ?? SPEED.default;
      if (id === 'tempo') speed *= Math.min(6, 1 + age * 1.5);   // speeds up the longer you hold
      if (this.shift) speed *= 0.25;
      this.bus.set(m[1], this.bus.get(m[1]) + m[2] * speed * dt, 'key');
    }
  }
}
