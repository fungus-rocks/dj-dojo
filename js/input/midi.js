// Web MIDI: reads a DJ controller straight from the browser (Chrome / Edge).
// Translates raw messages into control-bus events using a controller profile.

import { PROFILES, findProfile } from './profiles/index.js';

const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

export class Midi {
  constructor(bus, settings) {
    this.bus = bus; this.settings = settings;
    this.access = null; this.profile = null; this.input = null; this.output = null;
    this.status = 'idle';        // idle | unsupported | denied | waiting | connected
    this.sysex = false;
    this.log = [];               // recent raw messages, for the settings screen
    this.onChange = () => {};
    this.msb = new Map(); this.timers = new Map();
  }

  get supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }
  get deviceName() { return this.input ? this.input.name : null; }

  async connect() {
    if (!this.supported) { this.status = 'unsupported'; this.onChange(); return; }
    try {
      // "sysex" lets us ask the controller where its knobs sit. Fall back without it.
      try { this.access = await navigator.requestMIDIAccess({ sysex: true }); this.sysex = true; }
      catch { this.access = await navigator.requestMIDIAccess(); this.sysex = false; }
    } catch { this.status = 'denied'; this.onChange(); return; }
    this.access.onstatechange = () => this.scan();
    this.scan();
  }

  scan() {
    const inputs = [...this.access.inputs.values()].filter((p) => p.state !== 'disconnected');
    const outputs = [...this.access.outputs.values()].filter((p) => p.state !== 'disconnected');
    const input = inputs.find((p) => findProfile(p.name)) || null;
    if (input === this.input && (input || this.status === 'waiting')) return;
    if (this.input) this.input.onmidimessage = null;
    clearInterval(this.queryTimer);
    this.input = input;
    this.otherInputs = inputs.filter((p) => p !== input).map((p) => p.name);
    if (!input) {
      this.profile = null; this.output = null; this.status = 'waiting';
      this.bus.hardware = false; this.bus.known = {};
      // Still listen to unknown devices so the MIDI monitor can show them.
      for (const p of inputs) p.onmidimessage = (m) => this.record(m.data, p.name);
      this.onChange(); return;
    }
    this.profile = findProfile(input.name);
    this.output = outputs.find((p) => this.profile.match.test(p.name)) || null;
    this.index = new Map();
    for (const inp of this.profile.inputs) {
      if (inp.type === 'abs14') { this.index.set(`${inp.status}:${inp.msb}`, { ...inp, part: 'msb' }); this.index.set(`${inp.status}:${inp.lsb}`, { ...inp, part: 'lsb' }); }
      else this.index.set(`${inp.status}:${inp.d1}`, inp);
    }
    input.onmidimessage = (m) => this.handle(m);
    this.status = 'connected';
    this.bus.hardware = true; this.bus.known = {};
    this.query();
    if (this.profile.queryEveryMs) this.queryTimer = setInterval(() => this.query(), this.profile.queryEveryMs);
    this.onChange();
  }

  query() {
    if (!this.output || !this.sysex || !this.profile?.query) return;
    try { this.output.send(this.profile.query); } catch {}
  }

  record(data, port) {
    this.log.push({ t: performance.now(), text: [...data].map(hex).join(' '), port });
    if (this.log.length > 60) this.log.shift();
  }

  handle(m) {
    const [status, d1, d2 = 0] = m.data;
    if (status >= 0xf0) return;
    this.record(m.data);
    const kind = status & 0xf0;
    // Note-off (0x8n) is treated as the matching note-on with velocity 0.
    const st = kind === 0x80 ? status + 0x10 : status;
    const inp = this.index.get(`${st}:${d1}`);
    if (!inp) return;
    const t = m.timeStamp || performance.now();
    if (inp.type === 'button') {
      this.bus.press(inp.key, kind !== 0x80 && d2 > 0, 'midi', t);
    } else if (inp.type === 'rel') {
      const delta = inp.signed7 ? (d2 < 64 ? d2 : d2 - 128) : d2 - (inp.center ?? 64);
      if (delta) this.bus.rel(inp.key, delta, 'midi', t, { platter: !!inp.platter });
    } else if (inp.type === 'abs14') {
      // Faders arrive as two messages (coarse then fine). Wait a moment for the
      // fine half so the value never jumps.
      const id = inp.key;
      const emit = (lsb) => {
        clearTimeout(this.timers.get(id)); this.timers.delete(id);
        let v = (((this.msb.get(id) ?? 0) << 7) | lsb) / 16383;
        if (inp.key.endsWith('.tempo') && this.settings.invertTempo) v = 1 - v;
        this.bus.set(inp.key, v, 'midi', t);
      };
      if (inp.part === 'msb') {
        this.msb.set(id, d2);
        clearTimeout(this.timers.get(id));
        this.timers.set(id, setTimeout(() => emit(d2 === 127 ? 127 : 0), 6));
      } else emit(d2);
    }
  }

  /** Light a button on the controller (best effort; ignored if unsupported). */
  led(key, on) {
    const l = this.profile?.leds?.[key];
    if (!l || !this.output) return;
    try { this.output.send([l[0], l[1], on ? 0x7f : 0x00]); } catch {}
  }
}

export { PROFILES };
