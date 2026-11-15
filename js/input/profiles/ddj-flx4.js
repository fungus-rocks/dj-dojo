// Pioneer DJ DDJ-FLX4 controller profile.
// A profile is just a table: "this MIDI message means that control".
// To support another controller, copy this file, change the numbers and add it
// to profiles/index.js. Message numbers here follow Pioneer's published MIDI
// message list and the open-source Mixxx mapping for the FLX4.

const inputs = [];
const leds = {};

['a', 'b'].forEach((d, ch) => {
  const note = 0x90 + ch, cc = 0xb0 + ch, pads = 0x97 + ch * 2;
  const button = (d1, key) => inputs.push({ type: 'button', status: note, d1, key: `${d}.${key}` });
  const abs14 = (msb, key, opts) => inputs.push({ type: 'abs14', status: cc, msb, lsb: msb + 0x20, key: `${d}.${key}`, ...opts });

  button(0x0b, 'play');
  button(0x0c, 'cue');
  button(0x58, 'sync');
  button(0x54, 'pfl');           // headphone cue button
  button(0x3f, 'shift');
  button(0x36, 'jogTouch');
  // The 8 pads send a different note range in each pad mode (hot cue, pad FX,
  // beat jump, sampler ...). Accept them all so the pads work in any mode.
  for (let mode = 0; mode < 8; mode++) for (let p = 0; p < 8; p++) inputs.push({ type: 'button', status: pads, d1: mode * 16 + p, key: `${d}.pad${p + 1}` });

  abs14(0x00, 'tempo');          // top of the fader = slow, bottom = fast
  abs14(0x04, 'trim');
  abs14(0x07, 'hi');
  abs14(0x0b, 'mid');
  abs14(0x0f, 'low');
  abs14(0x13, 'fader');

  // Jog wheel: sends 64 +/- the number of ticks moved (720 ticks per turn).
  inputs.push({ type: 'rel', status: cc, d1: 0x21, key: `${d}.jog`, center: 64 });                 // outer edge
  inputs.push({ type: 'rel', status: cc, d1: 0x22, key: `${d}.jog`, center: 64, platter: true });  // top, vinyl on
  inputs.push({ type: 'rel', status: cc, d1: 0x23, key: `${d}.jog`, center: 64 });                 // top, vinyl off

  leds[`${d}.play`] = [note, 0x0b];
  leds[`${d}.cue`] = [note, 0x0c];
  leds[`${d}.sync`] = [note, 0x58];
  leds[`${d}.pfl`] = [note, 0x54];
  for (let p = 0; p < 8; p++) leds[`${d}.pad${p + 1}`] = [pads, p];
});

// Mixer section lives on MIDI channel 7.
inputs.push({ type: 'abs14', status: 0xb6, msb: 0x1f, lsb: 0x3f, key: 'xfader' });
inputs.push({ type: 'abs14', status: 0xb6, msb: 0x17, lsb: 0x37, key: 'a.filter' });
inputs.push({ type: 'abs14', status: 0xb6, msb: 0x18, lsb: 0x38, key: 'b.filter' });
inputs.push({ type: 'rel', status: 0xb6, d1: 0x40, key: 'browse', signed7: true });
inputs.push({ type: 'button', status: 0x96, d1: 0x41, key: 'browsePress' });
inputs.push({ type: 'button', status: 0x96, d1: 0x46, key: 'a.load' });
inputs.push({ type: 'button', status: 0x96, d1: 0x47, key: 'b.load' });

export default {
  id: 'ddj-flx4',
  name: 'Pioneer DJ DDJ-FLX4',
  match: /DDJ-FLX4/i,
  inputs,
  leds,
  // Asks the controller to report every knob and fader position. It also works
  // as a "still here" signal, so it is re-sent a few times a second.
  query: [0xf0, 0x00, 0x40, 0x05, 0x00, 0x00, 0x04, 0x05, 0x00, 0x50, 0x02, 0xf7],
  queryEveryMs: 250,
};
