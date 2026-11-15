// The control bus: one shared "language" for every input device.
// A hardware controller, the keyboard and the on-screen mixer all speak it, so
// lessons never need to know which device you are using.
//
// Keys:  'a.play' 'a.cue' 'a.sync' 'a.pfl' 'a.shift' 'a.pad1'..'a.pad8'   buttons
//        'a.tempo' 'a.trim' 'a.hi' 'a.mid' 'a.low' 'a.filter' 'a.fader'   0..1
//        'a.jog'                                                         relative
//        'xfader' (0..1)  'browse' (relative)  'browsePress' 'tap' 'confirm' 'left' 'right'
// (same again with 'b.' for the right-hand deck)

export const ABS_DEFAULTS = {
  tempo: 0.5, trim: 0.5, hi: 0.5, mid: 0.5, low: 0.5, filter: 0.5, fader: 1,
};
export const ABS_IDS = Object.keys(ABS_DEFAULTS);

export class Bus {
  constructor() {
    this.values = { xfader: 0.5 };
    this.known = {};            // has the hardware told us where this control sits?
    this.hardware = false;      // is a controller connected?
    this.listeners = new Set();
    for (const d of ['a', 'b']) for (const id of ABS_IDS) this.values[`${d}.${id}`] = ABS_DEFAULTS[id];
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(e) {
    const dot = e.key.indexOf('.');
    e.deck = dot > 0 ? e.key.slice(0, dot) : null;
    e.id = dot > 0 ? e.key.slice(dot + 1) : e.key;
    e.t ??= performance.now();
    for (const fn of [...this.listeners]) fn(e);
  }

  get(key) { return this.values[key]; }

  /** Absolute control (knob / fader), value 0..1. */
  set(key, value, src = 'game', t) {
    value = Math.min(1, Math.max(0, value));
    if (src === 'midi') this.known[key] = true;
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.emit({ type: 'abs', key, value, src, t });
  }

  /** Relative control (jog wheel, browse knob). */
  rel(key, delta, src = 'game', t, extra) {
    this.emit({ type: 'rel', key, delta, src, t, ...extra });
  }

  /** Button down / up. */
  press(key, down, src = 'game', t) {
    this.emit({ type: 'button', key, down, src, t });
  }

  /** Can a lesson trust this control's position? */
  isKnown(key) { return !this.hardware || !!this.known[key]; }
}
