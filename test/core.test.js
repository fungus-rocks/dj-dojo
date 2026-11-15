import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, SECTIONS, BARS, renderTrack, computePeaks, sectionAtBar } from '../js/audio/synth.js';
import { detectBpm } from '../js/audio/bpm.js';
import * as S from '../js/game/scoring.js';
import flx4 from '../js/input/profiles/ddj-flx4.js';
import { KEYMAP } from '../js/input/keyboard.js';
import { Bus } from '../js/input/bus.js';

const SR = 22050;   // half rate keeps the tests quick

test('built-in tracks render at exactly their stated tempo and length', () => {
  for (const def of TRACKS) {
    const r = renderTrack(def, SR);
    const want = Math.round((60 / def.bpm) * 4 * BARS * SR);
    assert.equal(r.samples.length, want, def.id);
    let peak = 0;
    for (const x of r.samples) { assert.ok(Number.isFinite(x)); peak = Math.max(peak, Math.abs(x)); }
    assert.ok(peak > 0.85 && peak <= 0.91, `${def.id} peak ${peak}`);
  }
});

test('the kick drum lands on the beat grid', () => {
  const def = TRACKS[0], r = renderTrack(def, SR), beat = (60 / def.bpm) * SR;
  const energy = (from, len) => { let e = 0; for (let i = Math.floor(from); i < from + len; i++) e += r.samples[i] ** 2; return e / len; };
  // Bar 2 of the intro: loud right on each beat, quiet just before it.
  for (let b = 4; b < 8; b++) assert.ok(energy(b * beat, 600) > 6 * energy(b * beat - 900, 600), `beat ${b}`);
});

test('the break has no kick, the drop brings it back', () => {
  const def = TRACKS[0], r = renderTrack(def, SR), bar = (60 / def.bpm) * 4 * SR;
  const low = (barIdx) => { const p = computePeaks(r.samples.subarray(Math.floor(barIdx * bar), Math.floor((barIdx + 1) * bar)), SR); return Math.max(...p.low); };
  assert.ok(low(41) > 3 * low(34));
  assert.equal(sectionAtBar(34).name, 'Break');
  assert.equal(sectionAtBar(40).name, 'Drop');
  assert.equal(SECTIONS.at(-1).bars[1], BARS);
});

test('tempo detection finds the tempo of a rendered track', () => {
  for (const def of [TRACKS[0], TRACKS[3]]) {
    const r = renderTrack(def, SR);
    const { bpm, firstBeat } = detectBpm(r.samples, SR);
    assert.ok(Math.abs(bpm - def.bpm) < 0.3, `${def.id}: got ${bpm}`);
    const period = 60 / bpm, off = Math.min(firstBeat, period - firstBeat);
    assert.ok(off < 0.03, `${def.id}: first beat ${firstBeat}`);
  }
});

test('score curves', () => {
  assert.equal(S.curve(0, S.CURVES.tapMs), 100);
  assert.equal(S.curve(-18, S.CURVES.tapMs), 100);
  assert.equal(S.curve(500, S.CURVES.tapMs), 0);
  assert.ok(Math.abs(S.curve(47.5, S.CURVES.tapMs) - 80) < 1e-9);
  let prev = 101;
  for (let e = 0; e < 200; e += 5) { const s = S.curve(e, S.CURVES.phaseMs); assert.ok(s <= prev); prev = s; }
  assert.deepEqual([59, 60, 80, 93, 100].map(S.starsFor), [0, 1, 2, 3, 3]);
});

test('tap matching', () => {
  const { hits, extras } = S.matchTaps([0.02, 1.1, 1.9, 2.5, 7], [0, 1, 2, 3], 0.4);
  assert.equal(hits.filter((x) => x.hit).length, 3);
  assert.equal(hits[3].hit, false);
  assert.equal(extras, 2);
  assert.ok(Math.abs(hits[1].error - 0.1) < 1e-9);
  assert.equal(S.wrap(31.5, 32), -0.5);
  assert.equal(S.wrap(0.3, 1), 0.3);
  assert.equal(S.combine([{ score: 100, weight: 1 }, { score: 40, weight: 2 }]), 60);
});

test('camelot wheel neighbours', () => {
  assert.ok(S.camelotCompatible('8A', '8A'));
  assert.ok(S.camelotCompatible('8A', '9A'));
  assert.ok(S.camelotCompatible('8A', '7A'));
  assert.ok(S.camelotCompatible('8A', '8B'));
  assert.ok(S.camelotCompatible('12A', '1A'));
  assert.ok(!S.camelotCompatible('8A', '9B'));
  assert.ok(!S.camelotCompatible('8A', '10A'));
  assert.ok(!S.camelotCompatible('8A', '2A'));
});

test('DDJ-FLX4 profile is consistent', () => {
  const seen = new Set();
  for (const inp of flx4.inputs) {
    const ids = inp.type === 'abs14' ? [inp.msb, inp.lsb] : [inp.d1];
    for (const id of ids) {
      const k = `${inp.status}:${id}`;
      assert.ok(!seen.has(k), `duplicate message ${k} (${inp.key})`);
      seen.add(k);
      assert.ok(id >= 0 && id < 128);
    }
  }
  const keys = new Set(flx4.inputs.map((i) => i.key));
  for (const d of ['a', 'b']) for (const id of ['play', 'cue', 'sync', 'pfl', 'tempo', 'trim', 'hi', 'mid', 'low', 'fader', 'filter', 'jog', 'pad1', 'pad8']) assert.ok(keys.has(`${d}.${id}`), `${d}.${id}`);
  assert.ok(keys.has('xfader'));
  assert.ok(flx4.match.test('DDJ-FLX4 MIDI 1') && flx4.match.test('DDJ-FLX4'));
  assert.equal(flx4.query[0], 0xf0); assert.equal(flx4.query.at(-1), 0xf7);
});

test('keyboard covers both decks evenly', () => {
  const keys = Object.values(KEYMAP).map((m) => m[1]);
  for (const k of keys.filter((x) => x.startsWith('a.'))) assert.ok(keys.includes('b.' + k.slice(2)), k);
  for (const id of ['play', 'cue', 'tempo', 'fader', 'low', 'nudge-', 'nudge+']) assert.ok(keys.includes(`a.${id}`));
});

test('control bus', () => {
  const bus = new Bus(), got = [];
  bus.on((e) => got.push(e));
  bus.set('a.low', 2, 'key', 1);
  bus.set('a.low', 1, 'key', 2);          // unchanged: no event
  bus.press('b.play', true, 'midi', 3);
  bus.rel('b.jog', -3, 'midi', 4, { platter: true });
  assert.equal(bus.get('a.low'), 1);
  assert.equal(got.length, 3);
  assert.deepEqual([got[0].deck, got[0].id, got[1].deck, got[1].id, got[2].delta, got[2].platter], ['a', 'low', 'b', 'play', -3, true]);
  bus.hardware = true;
  assert.equal(bus.isKnown('a.fader'), false);
  bus.set('a.fader', 0.3, 'midi');
  assert.equal(bus.isKnown('a.fader'), true);
});
