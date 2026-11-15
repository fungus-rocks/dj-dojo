// The lesson path. Each lesson is a small state machine that gets:
//   ctx.engine / ctx.a / ctx.b   the decks and mixer
//   ctx.hud                      an element to draw its own display into
//   ctx.prompt / ctx.feedback    the instruction line and pop-up feedback
//   ctx.finish(result)           call once with { score, parts, tips }
// and may implement prepare(), start(), frame(), input(event).

import { TRACKS, sectionAtBar } from '../audio/synth.js';
import * as S from './scoring.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const coin = () => (Math.random() < 0.5 ? -1 : 1);
const lateEarly = (ms) => (Math.abs(ms) < 1 ? 'spot on' : `${Math.abs(Math.round(ms))} ms ${ms > 0 ? 'late' : 'early'}`);
const aheadBehind = (ms) => (Math.abs(ms) < 1 ? 'dead on' : `${Math.abs(Math.round(ms))} ms ${ms > 0 ? 'ahead' : 'behind'}`);
const PAIRS = [['neon', 'tram'], ['tide', 'neon'], ['lantern', 'tide'], ['tram', 'garden'], ['neon', 'garden'], ['lantern', 'neon']];
const PHRASE = 32;   // beats in an 8-bar phrase

// "Is the controller set up for this lesson?" checks. In keyboard mode the game
// sets these itself; with hardware it asks you to move the real control.
const up = (d) => [
  { key: `${d}.fader`, label: `Deck ${d === 'a' ? 1 : 2} channel fader up`, want: 1, test: (v) => v > 0.85 },
  { key: `${d}.low`, label: `Deck ${d === 'a' ? 1 : 2} LOW near 12 o’clock`, want: 0.5, test: (v) => v > 0.35 && v < 0.7 },
  { key: `${d}.filter`, label: `Deck ${d === 'a' ? 1 : 2} CFX knob centred`, want: 0.5, test: (v) => Math.abs(v - 0.5) < 0.08 },
];
const XF = { key: 'xfader', label: 'Crossfader in the middle', want: 0.5, test: (v) => Math.abs(v - 0.5) < 0.2 };
const A_UP = [...up('a'), XF];
const B_UP = [...up('b'), XF];
const BOTH_UP = [...up('a'), ...up('b'), XF];

/** A beat counter for a looping deck that keeps counting up past the loop point. */
function beatClock(deck) {
  const total = Math.round((deck.duration * deck.track.bpm) / 60);   // beats in one loop of the track
  let last = deck.beat, laps = 0;
  const now = () => {
    const raw = deck.beat;
    if (raw < last - total / 2) laps++; else if (raw > last + total / 2) laps--;
    last = raw;
    return raw + laps * total;
  };
  // at(): the count at another moment close to now (e.g. when a key was pressed).
  return { now, at(time) { const n = now(); return n + S.wrap(deck.beatAt(time) - deck.beat, total); } };
}

/** Put deck B at the same tempo as A and (optionally) on the same beat. */
function matchTempo(ctx) { ctx.b.tempoLock = ctx.a.bpm / ctx.b.track.bpm; }
function alignB(ctx, beatsApart = 0) {
  const { a, b } = ctx;
  // Keep B's own bar position but land its beat exactly on A's.
  const want = a.beat + beatsApart, cur = b.beat;
  b.seekBeat(cur + S.wrap(want - cur, 1));
}

// ---------------------------------------------------------------------------
// Rhythm: tapping lessons
// ---------------------------------------------------------------------------

function tapRun(ctx, o) {
  const { engine, a, h } = ctx;
  let clock, taps = [], dots, lamp, count, readout, finished = false;
  const targets = o.targets;
  const first = targets[0], last = targets[targets.length - 1];
  const goFrom = o.goFrom ?? first - 0.6;
  const heardBeat = (t) => clock.at(engine.heardTime(t) - ctx.settings.tapOffsetMs / 1000);
  const msPerBeat = () => 60000 / a.bpm;

  return {
    tracks: { a: o.track },
    checklist: A_UP,
    prepare() {
      a.tempoLock = 1; a.seekBeat(o.startBeat);
      ctx.setView({ waves: { a: !!o.showWave }, bpm: {}, rig: false });
      lamp = h('div', { class: 'lamp' });
      count = h('div', { class: 'count' }, ...[1, 2, 3, 4].map((n) => h('span', {}, String(n))));
      dots = h('div', { class: 'tapstrip' }, h('i', { class: 'mid' }), h('b', { class: 'l' }, 'early'), h('b', { class: 'r' }, 'late'));
      readout = h('div', { class: 'readout' }, ' ');
      const tapPad = h('button', { class: 'tappad', tabindex: '-1', onpointerdown: (e) => { e.preventDefault(); ctx.bus.press('tap', true, 'mouse', e.timeStamp); } }, 'TAP');
      ctx.hud.append(h('div', { class: 'tapbox' }, lamp, count, tapPad), dots, readout);
      ctx.prompt(o.listen);
    },
    start() { a.play(); clock = beatClock(a); },
    input(e) {
      if (e.type !== 'button') return false;
      if (!ctx.isTap(e) || finished) return true;
      const beat = heardBeat(e.t);
      if (beat < Math.min(goFrom, first - 1)) { ctx.feedback('Not yet, just listen', 'info'); return true; }
      taps.push(beat);
      const near = targets.reduce((best, t) => (Math.abs(t - beat) < Math.abs(best - beat) ? t : best), targets[0]);
      const err = beat - near, ms = err * msPerBeat();
      const ok = Math.abs(err) <= o.window;
      const dot = h('i', { class: 'dot ' + (ok ? (Math.abs(ms) < o.goodMs ? 'good' : 'ok') : 'bad') });
      dot.style.left = `${50 + S.clamp(ms / o.spanMs, -1, 1) * 50}%`;
      dots.append(dot); setTimeout(() => dot.classList.add('old'), 30);
      readout.textContent = ok ? lateEarly(ms) : o.miss(beat);
      readout.className = 'readout ' + (ok ? (Math.abs(ms) < o.goodMs ? 'good' : 'ok') : 'bad');
      return true;
    },
    frame() {
      const beat = heardBeat(performance.now());
      const fr = beat - Math.floor(beat), inBar = ((Math.floor(beat) % 4) + 4) % 4;
      const showLamp = o.lamp(beat), showCount = o.count(beat);
      lamp.style.opacity = showLamp ? String(Math.max(0, 1 - fr * 2.2)) : '0';
      lamp.classList.toggle('one', inBar === 0);
      count.style.visibility = showCount ? 'visible' : 'hidden';
      [...count.children].forEach((el, i) => el.classList.toggle('on', i === inBar));
      if (beat < goFrom) ctx.prompt(o.listen);
      else if (beat <= last + 0.5) ctx.prompt(o.go(beat));
      if (beat > last + 1.2 && !finished) {
        finished = true;
        const { hits, extras } = S.matchTaps(taps, targets, o.window);
        const errorsMs = hits.filter((x) => x.hit).map((x) => x.error * msPerBeat());
        const missed = hits.length - errorsMs.length;
        const med = S.median(errorsMs), avgAbs = S.mean(errorsMs.map(Math.abs));
        const spread = Math.sqrt(S.mean(errorsMs.map((e) => (e - S.mean(errorsMs)) ** 2)));
        const per = errorsMs.map((e) => S.curve(e, o.curve));
        const score = S.clamp(per.reduce((s, x) => s + x, 0) / targets.length - extras * o.extraPenalty, 0, 100);
        const tips = [];
        if (missed > targets.length / 3) tips.push('You missed a lot of them. Nod your head or tap your foot to the kick drum first, then add the taps.');
        if (extras > 2) tips.push(o.extraTip);
        if (errorsMs.length > 5 && Math.abs(med) > 45 && spread < 45) tips.push(`You were steadily ${lateEarly(med)}. Steady but offset usually means speaker or Bluetooth delay, not you. Use the button below to cancel it out.`);
        else if (spread > 50) tips.push('Your timing wandered. Lock onto the kick drum (the low thump) and ignore everything else.');
        if (!tips.length) tips.push(o.nextTip);
        ctx.finish({
          score, tips,
          parts: [
            { label: 'Average error', detail: errorsMs.length ? `${Math.round(avgAbs)} ms` : 'n/a' },
            { label: 'Hit', detail: `${errorsMs.length} of ${targets.length}` },
            { label: 'Extra taps', detail: String(extras) },
            { label: 'Steadiness', detail: errorsMs.length > 2 ? `±${Math.round(spread)} ms` : 'n/a' },
          ],
          calibrate: errorsMs.length > 5 && Math.abs(med) > 25 && spread < 60 ? Math.round(med + ctx.settings.tapOffsetMs) : null,
        });
      }
    },
  };
}

const tapBeat = (ctx) => {
  const start = 32, first = start + 8;
  const targets = Array.from({ length: 32 }, (_, i) => first + i);
  return tapRun(ctx, {
    track: pick(['neon', 'tide', 'lantern']), startBeat: start, targets, window: 0.5, goodMs: 35, spanMs: 150,
    curve: S.CURVES.tapMs, extraPenalty: 1.5, showWave: false,
    lamp: (b) => b < first + 16, count: () => false,
    listen: 'Listen… feel the kick drum.',
    go: (b) => (b < first + 16 ? `Tap ${ctx.key('tap')} on every beat, with the light.` : 'Light off. Keep tapping by ear.'),
    miss: () => 'off the beat',
    extraTip: 'Too many taps: one tap per kick drum, no more.',
    nextTip: 'Solid. This steady pulse is the ruler every other DJ skill is measured against.',
  });
};

const findOne = (ctx) => {
  const start = 64, first = start + 8;
  const targets = Array.from({ length: 12 }, (_, i) => first + i * 4);
  return tapRun(ctx, {
    track: pick(['neon', 'tram', 'tide']), startBeat: start, targets, window: 0.5, goodMs: 40, spanMs: 150,
    curve: S.CURVES.tapMs, extraPenalty: 5, showWave: false,
    lamp: (b) => b < first + 16, count: (b) => b < first + 16,
    listen: 'Count along: 1 – 2 – 3 – 4…',
    go: (b) => (b < first + 16 ? `Tap ${ctx.key('tap')} only on the “1”.` : 'Counter off. Keep counting in your head.'),
    miss: (beat) => `that was beat ${((Math.round(beat) % 4) + 4) % 4 + 1}, not the 1`,
    extraTip: 'Only tap on the “1”. Count “1-2-3-4” out loud; the chords and bassline restart on the 1.',
    nextTip: 'Nice. Once you can always find the “1”, starting a track in time becomes easy.',
  });
};

const hearPhrase = (ctx) => {
  const startBar = pick([11, 12, 13]);
  const targets = [16, 24, 32, 40].map((bar) => bar * 4);
  return tapRun(ctx, {
    track: pick(['neon', 'lantern', 'tide', 'tram']), startBeat: startBar * 4, goFrom: startBar * 4 + 6, targets, window: 1, goodMs: 60, spanMs: 400,
    curve: [[40, 100], [80, 92], [150, 75], [300, 45], [480, 0]], extraPenalty: 12, showWave: false,
    lamp: () => true, count: () => true,
    listen: 'Listen for the change coming…',
    go: () => `Tap ${ctx.key('tap')} at the exact moment a new 8-bar section begins.`,
    miss: (beat) => {
      const bar = Math.floor(Math.round(beat) / 4) % 8;
      return `not a section start (that was bar ${bar + 1} of 8)`;
    },
    extraTip: 'Tap only when a new section starts. The clues: a drum fill right before, then a cymbal crash and something added or removed.',
    nextTip: 'Good ears. Music moves in 8-bar blocks, and mixes sound natural when you make your moves on those block edges.',
  });
};

// ---------------------------------------------------------------------------
// Ear training: faster or slower?
// ---------------------------------------------------------------------------

const fasterSlower = (ctx) => {
  const { a, b, h } = ctx;
  const diffs = [5, 4, 3, 2.5, 2, 1.5, 1, 0.7];
  let round = -1, dir = 0, state = 'idle', correct = 0, log = [], clock, btnL, btnR, dotsEl;
  const pair = pick(PAIRS);

  function next() {
    round++;
    if (round >= diffs.length) return end();
    dir = coin(); state = 'listen';
    a.tempoLock = 1 + rnd(-0.02, 0.02);
    b.tempoLock = (a.bpm * (1 + (dir * diffs[round]) / 100)) / b.track.bpm;
    restart();
    btnL.className = btnR.className = 'choice';
    ctx.prompt(`Round ${round + 1} of ${diffs.length}: is <b class="cb">Deck 2</b> faster or slower than <b class="ca">Deck 1</b>?`);
  }
  function restart() { a.pause(); b.pause(); a.seekBeat(4); b.seekBeat(4); a.play(); b.play(); clock = beatClock(a); }
  function answer(d) {
    if (state !== 'listen') return;
    const right = d === dir; state = 'reveal';
    if (right) correct++;
    log.push(right);
    (d < 0 ? btnL : btnR).classList.add(right ? 'right' : 'wrong');
    (dir < 0 ? btnL : btnR).classList.add('right');
    dotsEl.children[round].className = right ? 'good' : 'bad';
    ctx.feedback(`${right ? 'Yes' : 'No'}: Deck 2 was ${diffs[round]}% ${dir > 0 ? 'faster' : 'slower'} (${b.bpm.toFixed(1)} vs ${a.bpm.toFixed(1)} BPM)`, right ? 'good' : 'bad');
    ctx.after(1700, next);
  }
  function end() {
    a.pause(); b.pause();
    const firstMiss = log.indexOf(false);
    ctx.finish({
      score: (correct / diffs.length) * 100,
      parts: [
        { label: 'Correct', detail: `${correct} of ${diffs.length}` },
        { label: 'Smallest gap you caught', detail: `${diffs[log.lastIndexOf(true)] ?? '–'}%` },
      ],
      tips: [firstMiss < 0
        ? 'Perfect ears. Under 1% is tiny: about 1 BPM. That is the precision beatmatching needs.'
        : 'Trick: pick one deck’s kick and listen to whether the other kick lands just before it (faster) or just after it (slower). The gap grows every bar.'],
    });
  }
  return {
    tracks: { a: pair[0], b: pair[1] },
    checklist: BOTH_UP,
    prepare() {
      ctx.setView({ waves: {}, bpm: {}, rig: false });
      ctx.lock('xfader', 'a.tempo', 'b.tempo', 'a.jog', 'b.jog');
      ctx.setAbs({ 'a.fader': 1, 'b.fader': 1, xfader: 0.5, 'a.low': 0.5, 'b.low': 0.5 });
      btnL = h('button', { class: 'choice', onclick: () => answer(-1) }, h('b', {}, 'Slower'), h('span', { html: ctx.key('left') }));
      btnR = h('button', { class: 'choice', onclick: () => answer(1) }, h('b', {}, 'Faster'), h('span', { html: ctx.key('right') }));
      dotsEl = h('div', { class: 'rounds' }, ...diffs.map(() => h('i')));
      ctx.hud.append(h('div', { class: 'choices' }, btnL, btnR), dotsEl);
    },
    start() { next(); },
    input(e) {
      if (e.type !== 'button') return false;
      if (ctx.isLeft(e)) answer(-1); else if (ctx.isRight(e)) answer(1);
      return true;
    },
    frame() { if (state === 'listen' && clock.now() > 4 + 32) restart(); },
  };
};

// ---------------------------------------------------------------------------
// Tempo fader control (eyes open)
// ---------------------------------------------------------------------------

const rideFader = (ctx) => {
  const { b, h } = ctx;
  const ROUNDS = 4, TOL = 0.1, HOLD = 1.2, LIMIT = 40;
  let round = -1, target = 0, t0 = 0, held = 0, lastT = 0, times = [], big, tgt, bar, state = 'idle';
  function next() {
    round++;
    if (round >= ROUNDS) return end();
    const lo = b.track.bpm * (1 - ctx.engine.tempoRange * 0.8), hi = b.track.bpm * (1 + ctx.engine.tempoRange * 0.8);
    do { target = Math.round(rnd(lo, hi) * 10) / 10; } while (Math.abs(target - b.bpm) < 1.5);
    t0 = performance.now(); held = 0; state = 'go';
    tgt.textContent = target.toFixed(1);
    ctx.prompt(`Round ${round + 1} of ${ROUNDS}: move ${ctx.ctl('b.tempo')} until Deck 2 reads <b>${target.toFixed(1)}</b> BPM, then hold still.`);
  }
  function end() {
    b.pause();
    const scores = times.map((t) => S.curve(t, [[5, 100], [9, 90], [15, 75], [25, 60], [LIMIT, 30]]));
    ctx.finish({
      score: S.mean(scores),
      parts: times.map((t, i) => ({ label: `Round ${i + 1}`, detail: t >= LIMIT ? 'timed out' : `${t.toFixed(1)} s` })),
      tips: ['Big move first, then tiny taps. Near the target, nudge the fader with one fingertip. Down (towards you) is faster, up is slower.'],
    });
  }
  return {
    tracks: { b: pick(['neon', 'tram', 'tide']) },
    checklist: B_UP,
    prepare() {
      ctx.setView({ waves: { b: true }, bpm: {}, rig: true, highlight: ['b.tempo'] });
      ctx.setAbs({ 'b.fader': 1, xfader: 0.5, 'b.low': 0.5 });
      b.seekBeat(32);
      big = h('div', { class: 'bignum cb' }, '–');
      tgt = h('div', { class: 'bignum' }, '–');
      bar = h('div', { class: 'holdbar' }, h('i'));
      ctx.hud.append(h('div', { class: 'duo' }, h('div', {}, h('label', {}, 'Deck 2 now'), big), h('div', {}, h('label', {}, 'Target'), tgt)), bar);
    },
    start() { b.play(); lastT = performance.now(); next(); },
    input(e) { return e.type === 'button' && e.deck === 'b' && (e.id === 'play' || e.id === 'cue' || e.id === 'sync'); },
    frame() {
      const now = performance.now(), dt = (now - lastT) / 1000; lastT = now;
      big.textContent = b.bpm.toFixed(2);
      if (state !== 'go') return;
      const ok = Math.abs(b.bpm - target) <= TOL;
      big.classList.toggle('good', ok);
      held = ok ? held + dt : 0;
      bar.firstChild.style.width = `${Math.min(1, held / HOLD) * 100}%`;
      const elapsed = (now - t0) / 1000;
      if (held >= HOLD || elapsed >= LIMIT) {
        state = 'pause';
        times.push(held >= HOLD ? elapsed - HOLD : LIMIT);
        ctx.feedback(held >= HOLD ? `Locked in ${(elapsed - HOLD).toFixed(1)} s` : 'Time is up, next one', held >= HOLD ? 'good' : 'bad');
        ctx.after(900, next);
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Tempo by ear / nudging / full beatmatch
// ---------------------------------------------------------------------------

const tempoByEar = (ctx) => {
  const { a, b, h } = ctx;
  const ROUNDS = 2;
  let round = -1, results = [], state = 'idle', info;
  const pair = pick(PAIRS);
  function next() {
    round++;
    if (round >= ROUNDS) return end();
    do { a.tempoLock = 1 + rnd(-0.025, 0.025); } while (Math.abs(a.bpm - b.bpm) < 0.8 || Math.abs(a.bpm / b.track.bpm - 1) > ctx.engine.tempoRange * 0.9);
    a.seekBeat(32); b.seekBeat(32); a.play(); b.play();
    state = 'go';
    info.textContent = '';
    ctx.prompt(`Round ${round + 1} of ${ROUNDS}: match <b class="cb">Deck 2</b>’s speed to <b class="ca">Deck 1</b> with ${ctx.ctl('b.tempo')}. ${ctx.key('snap')} snaps the beats together so you can hear the drift. ${ctx.key('confirm')} when it stays together.`);
  }
  function lockIn() {
    if (state !== 'go') return;
    state = 'reveal';
    const diff = b.bpm - a.bpm;
    results.push(diff);
    const drift = Math.abs(diff / a.bpm) * 16 * 4 * (60000 / a.bpm);
    const kind = Math.abs(diff) < 0.12 ? 'good' : Math.abs(diff) < 0.4 ? 'ok' : 'bad';
    info.innerHTML = `Deck 1: <b>${a.bpm.toFixed(2)}</b> · Deck 2: <b>${b.bpm.toFixed(2)}</b> BPM`;
    ctx.feedback(`${Math.abs(diff).toFixed(2)} BPM ${diff > 0 ? 'too fast' : 'too slow'}. Over 16 bars the beats would slip ${Math.round(drift)} ms.`, kind);
    ctx.after(2600, next);
  }
  function end() {
    a.pause(); b.pause();
    const scores = results.map((d) => S.curve(d, S.CURVES.bpm));
    const tips = [];
    if (S.mean(results.map(Math.abs)) > 0.3) tips.push('Snap the beats together, then listen for 4 to 8 bars. If Deck 2’s kick creeps ahead it is too fast: pull its fader up a touch (slower). Repeat with smaller and smaller moves.');
    else tips.push('That is tight. The closer you get, the longer you must listen before the drift shows, so be patient near the end.');
    tips.push('Tempo fader = long-term fix. If you keep needing to re-snap, the fader is wrong, not the timing.');
    ctx.finish({ score: S.mean(scores), parts: results.map((d, i) => ({ label: `Round ${i + 1}`, detail: `${Math.abs(d).toFixed(2)} BPM ${d > 0 ? 'fast' : 'slow'}`, score: scores[i] })), tips });
  }
  return {
    tracks: { a: pair[0], b: pair[1] },
    checklist: BOTH_UP,
    prepare() {
      ctx.setView({ waves: {}, bpm: { a: true }, rig: true, highlight: ['b.tempo'] });
      ctx.lock('a.tempo', 'a.jog', 'a.play', 'a.cue', 'b.play', 'b.cue', 'a.nudge-', 'a.nudge+');
      ctx.engine.allowSync = false;
      ctx.setAbs({ 'a.fader': 1, 'b.fader': 1, xfader: 0.5, 'a.low': 0.5, 'b.low': 0.5 });
      a.tempoLock = 1;
      info = h('div', { class: 'readout' });
      ctx.hud.append(h('div', { class: 'earsonly' }, 'Ears only: Deck 2’s BPM and both waveforms are hidden.'), info);
    },
    start() { next(); },
    input(e) {
      if (e.type !== 'button' || !e.down) return false;
      if (ctx.isConfirm(e)) { lockIn(); return true; }
      if (ctx.isPrimary(e)) { if (state === 'go') { alignB(ctx); ctx.feedback('Beats snapped together. Now listen…', 'info'); } return true; }
      return false;
    },
    frame() {},
  };
};

const nudgePhase = (ctx) => {
  const { a, b, h } = ctx;
  const ROUNDS = 3;
  let round = -1, results = [], state = 'idle';
  const pair = pick(PAIRS);
  function next() {
    round++;
    if (round >= ROUNDS) return end();
    const ears = round > 0;
    ctx.setView({ waves: ears ? {} : { a: true, b: true }, bpm: { a: true, b: true }, rig: true, highlight: ['b.jog'], phase: !ears });
    alignB(ctx, (coin() * rnd(55, 170)) / (60000 / a.bpm));
    state = 'go';
    ctx.prompt(`Round ${round + 1} of ${ROUNDS}${ears ? ' (ears only)' : ''}: the tempos match but <b class="cb">Deck 2</b> is out of step. Nudge it with ${ctx.ctl('b.jog')} until the two kicks land as one. ${ctx.key('confirm')} to lock in.`);
  }
  function lockIn() {
    if (state !== 'go') return;
    state = 'reveal';
    const ms = ctx.engine.offsetMs();
    results.push(ms);
    ctx.setView({ phase: true });
    ctx.feedback(`Deck 2 was ${aheadBehind(ms)}`, Math.abs(ms) < 15 ? 'good' : Math.abs(ms) < 35 ? 'ok' : 'bad');
    ctx.after(2200, next);
  }
  function end() {
    a.pause(); b.pause();
    const scores = results.map((d) => S.curve(d, S.CURVES.phaseMs));
    const tips = [];
    if (S.mean(results.map(Math.abs)) > 30) tips.push('Listen for a “flam” (two kicks like a galloping horse: ka-thunk). Nudge one way: if the gallop gets worse, go the other way. Aim for one single, fat kick.');
    else tips.push('Clean. Under about 15 ms two kicks blur into one, and that is the sound you are hunting for.');
    tips.push('Small touches only. Over-nudging and chasing it back and forth is the classic beginner trap.');
    ctx.finish({ score: S.mean(scores), parts: results.map((d, i) => ({ label: `Round ${i + 1}${i ? ' (ears)' : ''}`, detail: aheadBehind(d), score: scores[i] })), tips });
  }
  return {
    tracks: { a: pair[0], b: pair[1] },
    checklist: BOTH_UP,
    prepare() {
      ctx.lock('a.tempo', 'b.tempo', 'a.jog', 'a.play', 'a.cue', 'b.play', 'b.cue', 'a.nudge-', 'a.nudge+');
      ctx.engine.allowSync = false;
      ctx.setAbs({ 'a.fader': 1, 'b.fader': 1, xfader: 0.5, 'a.low': 0.5, 'b.low': 0.5 });
      a.tempoLock = 1 + rnd(-0.015, 0.015); matchTempo(ctx);
      a.seekBeat(32); b.seekBeat(32);
    },
    start() { a.play(); b.play(); next(); },
    input(e) {
      if (e.type !== 'button' || !e.down) return false;
      if (ctx.isConfirm(e)) { lockIn(); return true; }
      return false;
    },
    frame() {},
  };
};

const fullBeatmatch = (ctx) => {
  const { a, b, h } = ctx;
  const HOLD_BEATS = 32;
  let state = 'idle', clock, holdStart = 0, startMs = 0, worst = 0, bar, t0;
  const pair = pick(PAIRS);
  function lockIn() {
    if (state !== 'go') return;
    if (!b.playing) { ctx.feedback('Start Deck 2 first', 'info'); return; }
    state = 'hold';
    startMs = ctx.engine.offsetMs(); worst = Math.abs(startMs);
    holdStart = clock.now();
    ctx.lock('b.tempo', 'b.jog', 'b.play', 'b.cue', 'b.nudge-', 'b.nudge+');
    ctx.setView({ highlight: [] });
    ctx.prompt('Hands off! Let’s see if it holds for 8 bars…');
  }
  function end() {
    const diff = b.bpm - a.bpm;
    const secs = (performance.now() - t0) / 1000;
    a.pause(); b.pause();
    const sPhase = S.curve(startMs, S.CURVES.phaseMs);
    const sHold = S.curve(worst, [[15, 100], [30, 90], [50, 75], [80, 50], [140, 0]]);
    const tips = [];
    if (Math.abs(diff) > 0.15) tips.push(`The tempo was ${Math.abs(diff).toFixed(2)} BPM ${diff > 0 ? 'fast' : 'slow'}, so the beats drifted apart. If you have to nudge more than once every few bars, fix the fader, not the jog.`);
    if (Math.abs(startMs) > 25) tips.push('The beats were not quite together when you locked in. Give it one more gentle nudge before you commit.');
    if (!tips.length) tips.push('That is a real beatmatch: tempo and timing, by hand, and it held. This is the foundation of every blend.');
    tips.push('Order matters: tempo first (fader), then timing (jog). Fixing both at once is what causes overcorrection.');
    ctx.finish({
      score: S.combine([{ score: sPhase, weight: 1 }, { score: sHold, weight: 2 }]),
      parts: [
        { label: 'Timing at lock-in', detail: aheadBehind(startMs), score: sPhase },
        { label: 'Worst slip over 8 bars', detail: `${Math.round(worst)} ms`, score: sHold },
        { label: 'Tempo gap', detail: `${Math.abs(diff).toFixed(2)} BPM` },
        { label: 'Time taken', detail: `${Math.round(secs)} s` },
      ],
      tips,
    });
  }
  return {
    tracks: { a: pair[0], b: pair[1] },
    checklist: BOTH_UP,
    prepare() {
      ctx.setView({ waves: { a: true, b: true }, bpm: { a: true }, rig: true, highlight: ['b.play', 'b.tempo', 'b.jog'] });
      ctx.lock('a.tempo', 'a.jog', 'a.play', 'a.cue', 'a.nudge-', 'a.nudge+');
      ctx.engine.allowSync = false;
      ctx.setAbs({ 'a.fader': 1, 'b.fader': 1, xfader: 0.5, 'a.low': 0.5, 'b.low': 0.5 });
      do { a.tempoLock = 1 + rnd(-0.025, 0.025); } while (Math.abs(a.bpm - b.bpm) < 0.8 || Math.abs(a.bpm / b.track.bpm - 1) > ctx.engine.tempoRange * 0.9);
      a.seekBeat(32); b.seekBeat(0);
      bar = h('div', { class: 'holdbar' }, h('i'));
      ctx.hud.append(bar);
    },
    start() {
      a.play(); clock = beatClock(a); state = 'go'; t0 = performance.now();
      ctx.prompt(`Beatmatch <b class="cb">Deck 2</b> to <b class="ca">Deck 1</b>: press ${ctx.ctl('b.play')} on a “1”, match the speed with ${ctx.ctl('b.tempo')}, tidy the timing with ${ctx.ctl('b.jog')}. ${ctx.key('confirm')} when it is locked.`);
    },
    input(e) {
      if (e.type !== 'button' || !e.down) return false;
      if (ctx.isConfirm(e)) { lockIn(); return true; }
      return false;
    },
    frame() {
      if (state !== 'hold') return;
      const done = clock.now() - holdStart;
      worst = Math.max(worst, Math.abs(ctx.engine.offsetMs()));
      bar.firstChild.style.width = `${Math.min(1, done / HOLD_BEATS) * 100}%`;
      if (done >= HOLD_BEATS) { state = 'done'; end(); }
    },
  };
};

// ---------------------------------------------------------------------------
// Phrasing: drop on the one
// ---------------------------------------------------------------------------

/** 8 boxes showing where we are in the current 8-bar phrase. */
function phraseBoxes(h) {
  const el = h('div', { class: 'phrase' }, ...Array.from({ length: 8 }, (_, i) => h('i', {}, String(i + 1))));
  el.update = (beat, show = true) => {
    el.style.visibility = show ? 'visible' : 'hidden';
    const bar = ((Math.floor(beat / 4) % 8) + 8) % 8;
    [...el.children].forEach((c, i) => { c.classList.toggle('on', i === bar); c.classList.toggle('past', i < bar); });
  };
  return el;
}

const dropOnOne = (ctx) => {
  const { a, b, h } = ctx;
  const ROUNDS = 3;
  let round = -1, state = 'idle', clock, results = [], boxes, dropBeat = 0;
  const pair = pick(PAIRS);
  function arm() {
    round++;
    if (round >= ROUNDS) return end();
    b.pause(); b.seekBeat(0);
    state = 'armed';
    const aid = ['with the bar counter', 'waveforms only', 'ears only'][round];
    ctx.prompt(`Drop ${round + 1} of ${ROUNDS} (${aid}): press ${ctx.ctl('b.play')} exactly when <b class="ca">Deck 1</b> starts a new 8-bar section.`);
  }
  function drop() {
    b.seekBeat(0); b.play();
    const beat = clock.now();
    const err = S.wrap(beat, PHRASE);                 // beats from the nearest phrase start (+ = late)
    const ms = (err * 60000) / a.bpm;
    let score, text, kind;
    if (Math.abs(err) < 0.5) { score = S.curve(ms, S.CURVES.dropMs); text = `On the one: ${lateEarly(ms)}`; kind = score > 85 ? 'good' : 'ok'; }
    else {
      const bars = Math.round(err / 4), onBar = Math.abs(S.wrap(err, 4)) < 0.4;
      if (onBar) { score = 40; text = `Right on a “1”, but ${Math.abs(bars)} bar${Math.abs(bars) > 1 ? 's' : ''} ${bars > 0 ? 'late' : 'early'} for the section change`; }
      else { score = 10; text = `${Math.abs(err).toFixed(1)} beats ${err > 0 ? 'late' : 'early'}`; }
      kind = 'bad';
    }
    results.push({ err, ms, score });
    ctx.feedback(text, kind);
    state = 'play'; dropBeat = beat;
  }
  function end() {
    a.pause(); b.pause();
    const tips = [];
    if (results.some((r) => Math.abs(r.err) >= 0.5)) tips.push('Count the bars: “1-2-3-4, 2-2-3-4, 3-2-3-4 …” up to 8. The drum fill in bar 8 is your get-ready signal; press on the crash.');
    if (results.some((r) => Math.abs(r.err) < 0.5 && r.ms > 40)) tips.push('You were a little late. Press as if you were playing a drum on the beat, not reacting after you hear it.');
    if (!tips.length) tips.push('On the money. Start the new track on a section change and both tracks will change together from then on.');
    ctx.finish({
      score: S.mean(results.map((r) => r.score)),
      parts: results.map((r, i) => ({ label: `Drop ${i + 1}`, detail: Math.abs(r.err) < 0.5 ? lateEarly(r.ms) : `${Math.abs(r.err).toFixed(1)} beats ${r.err > 0 ? 'late' : 'early'}`, score: r.score })),
      tips,
    });
  }
  return {
    tracks: { a: pair[0], b: pair[1] },
    checklist: BOTH_UP,
    prepare() {
      ctx.setView({ waves: { a: true, b: true }, bpm: { a: true, b: true }, rig: true, highlight: ['b.play'] });
      ctx.lock('a.tempo', 'b.tempo', 'a.jog', 'b.jog', 'a.play', 'a.cue', 'b.cue', 'a.nudge-', 'a.nudge+', 'b.nudge-', 'b.nudge+');
      ctx.engine.allowSync = false;
      ctx.setAbs({ 'a.fader': 1, 'b.fader': 1, xfader: 0.5, 'a.low': 0.5, 'b.low': 0.5 });
      a.tempoLock = 1; matchTempo(ctx);
      a.seekBeat((8 + pick([4, 5])) * 4); b.seekBeat(0);
      boxes = phraseBoxes(h);
      ctx.hud.append(boxes);
    },
    start() { a.play(); clock = beatClock(a); arm(); },
    input(e) {
      if (e.key === 'b.play' && e.type === 'button') { if (e.down && state === 'armed') drop(); return true; }
      return false;
    },
    frame() {
      const beat = clock.now();
      boxes.update(beat, round === 0);
      ctx.setView({ waves: round < 2 ? { a: true, b: true } : {} });
      // After a drop, let it ride for 3 bars, then re-arm once a new phrase is far enough away.
      if (state === 'play' && beat - dropBeat > 12) { b.pause(); b.seekBeat(0); state = 'wait'; }
      if (state === 'wait') { const toNext = PHRASE - (((beat % PHRASE) + PHRASE) % PHRASE); if (toNext > 10 && toNext < 26) arm(); }
    },
  };
};

// ---------------------------------------------------------------------------
// EQ: the bass swap
// ---------------------------------------------------------------------------

/** Watches the two LOW knobs around a target beat and scores the hand-over. */
function swapWatcher(ctx, target, outDeck) {
  const inDeck = outDeck === 'a' ? 'b' : 'a';
  let tOut = null, tIn = null, clash = 0, last = null;
  return {
    target, outDeck, inDeck,
    sample(beat) {
      if (beat < target - 8 || beat > target + 8) { last = beat; return; }
      const lo = ctx.bus.get(`${outDeck}.low`), li = ctx.bus.get(`${inDeck}.low`);
      if (tOut === null && lo < 0.2) tOut = beat;
      if (tOut !== null && lo > 0.3) tOut = null;                 // went back up: not done yet
      if (tIn === null && li > 0.4) tIn = beat;
      if (tIn !== null && li < 0.3) tIn = null;
      if (last !== null && lo > 0.35 && li > 0.35) clash += beat - last;
      last = beat;
    },
    result() {
      if (tOut === null || tIn === null) return { score: 0, detail: tOut === null && tIn === null ? 'no swap' : tIn === null ? 'new bass never came in' : 'old bass never left', clash, done: false };
      const eOut = tOut - target, eIn = tIn - target;
      const timing = S.curve((Math.abs(eOut) + Math.abs(eIn)) / 2, S.CURVES.swapBeats);
      const score = S.clamp(timing - Math.max(0, clash - 1) * 8, 0, 100);
      const mid = (eOut + eIn) / 2;
      return { score, clash, done: true, eOut, eIn, detail: Math.abs(mid) < 0.5 ? 'right on the change' : `${Math.abs(mid).toFixed(1)} beats ${mid > 0 ? 'late' : 'early'}` };
    },
  };
}

const bassSwap = (ctx) => {
  const { a, b, h } = ctx;
  let clock, swaps = [], idx = 0, boxes, meters, origin = 0, done = false;
  const pair = pick(PAIRS);
  return {
    tracks: { a: pair[0], b: pair[1] },
    checklist: [
      { key: 'a.low', label: 'Deck 1 LOW at 12 o’clock', want: 0.5, test: (v) => Math.abs(v - 0.5) < 0.08 },
      { key: 'b.low', label: 'Deck 2 LOW all the way left', want: 0, test: (v) => v < 0.06 },
      { key: 'a.fader', label: 'Deck 1 channel fader up', want: 1, test: (v) => v > 0.9 },
      { key: 'b.fader', label: 'Deck 2 channel fader up', want: 1, test: (v) => v > 0.9 },
      { key: 'xfader', label: 'Crossfader in the middle', want: 0.5, test: (v) => Math.abs(v - 0.5) < 0.15 },
    ],
    prepare() {
      ctx.setView({ waves: { a: true, b: true }, bpm: { a: true, b: true }, rig: true, highlight: ['a.low', 'b.low'] });
      ctx.lock('a.tempo', 'b.tempo', 'a.jog', 'b.jog', 'a.play', 'a.cue', 'b.play', 'b.cue', 'a.nudge-', 'a.nudge+', 'b.nudge-', 'b.nudge+');
      ctx.engine.allowSync = false;
      a.tempoLock = 1; matchTempo(ctx);
      a.seekBeat(20 * 4); b.seekBeat(12 * 4);
      boxes = phraseBoxes(h);
      meters = h('div', { class: 'bassline' }, h('span', { class: 'ca' }, 'Deck 1 bass'), h('i', { class: 'ba' }), h('i', { class: 'bb' }), h('span', { class: 'cb' }, 'Deck 2 bass'));
      ctx.hud.append(boxes, meters);
    },
    start() {
      a.play(); b.play(); clock = beatClock(a); origin = clock.now();
      // Swaps at the next three phrase starts: 1 -> 2, 2 -> 1, 1 -> 2.
      const firstTarget = Math.ceil((origin + 4) / PHRASE) * PHRASE;
      swaps = [0, 1, 2].map((i) => swapWatcher(ctx, firstTarget + i * PHRASE, i % 2 ? 'b' : 'a'));
    },
    input() { return false; },
    frame() {
      if (done) return;
      const beat = clock.now(), sw = swaps[idx];
      boxes.update(beat);
      meters.children[1].style.opacity = String(0.15 + ctx.bus.get('a.low') * 1.7);
      meters.children[2].style.opacity = String(0.15 + ctx.bus.get('b.low') * 1.7);
      swaps.forEach((s) => s.sample(beat));
      const toGo = sw.target - beat, from = sw.outDeck === 'a' ? 1 : 2, to = sw.outDeck === 'a' ? 2 : 1;
      if (toGo > 0) ctx.prompt(`Swap ${idx + 1} of 3: at the next section change, turn <b class="c${sw.outDeck}">Deck ${from} LOW</b> down and <b class="c${sw.inDeck}">Deck ${to} LOW</b> up to 12 o’clock, together. ${toGo < 4.5 ? `<b>${Math.max(1, Math.ceil(toGo))}…</b>` : `In ${Math.ceil(toGo / 4)} bars.`}`);
      else ctx.prompt('<b>Swap!</b>');
      if (beat > sw.target + 6) {
        const r = sw.result();
        ctx.feedback(r.done ? `Swap ${idx + 1}: ${r.detail}${r.clash > 1.5 ? `, basses clashed for ${r.clash.toFixed(1)} beats` : ''}` : `Swap ${idx + 1}: ${r.detail}`, r.score > 85 ? 'good' : r.score > 55 ? 'ok' : 'bad');
        idx++;
        if (idx >= swaps.length) {
          done = true; a.pause(); b.pause();
          const rs = swaps.map((s) => s.result());
          const tips = [];
          if (rs.some((r) => r.clash > 1.5)) tips.push('Two basslines at once turn to mud. Move both knobs in one motion: one hand on each LOW knob, twist together.');
          if (rs.some((r) => r.done && Math.abs((r.eOut + r.eIn) / 2) > 1)) tips.push('Hit the swap on the “1” of the new section. Count bar 8 (“8-2-3-4”) and twist on the next beat.');
          if (rs.some((r) => !r.done)) tips.push('A swap needs both moves: old bass fully down (left), new bass up to the middle (12 o’clock).');
          if (!tips.length) tips.push('Clean swaps. This one move is what makes a blend sound like one track handing over to another.');
          ctx.finish({ score: S.mean(rs.map((r) => r.score)), parts: rs.map((r, i) => ({ label: `Swap ${i + 1}`, detail: r.detail, score: r.score })), tips });
        }
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Transitions: the 16-bar blend (with or without sync)
// ---------------------------------------------------------------------------

const blend = (synced) => (ctx) => {
  const { a, b, h } = ctx;
  let clock, state = 'prep', t0 = null, swap = null, phraseErr = 0, entryErr = 0, done = false;
  let tight = [], inAt = null, outAt = null, boxes, line, cursor, lastAud = 0, giveUp;
  const pair = pick(PAIRS);
  const aud = (id) => ctx.engine.audible(id);

  function finish() {
    if (done) return; done = true;
    a.pause(); b.pause();
    const parts = [], tips = [];
    if (t0 === null) {
      return ctx.finish({ score: 0, parts: [{ label: 'Mix', detail: 'Deck 2 never came in' }], tips: ['Start Deck 2 on a section change, then raise its channel fader to begin the blend.'] });
    }
    const sPhrase = Math.abs(phraseErr) < 0.5 ? 100 : Math.abs(S.wrap(phraseErr, 4)) < 0.5 ? 50 : 15;
    parts.push({ label: 'Sections lined up', detail: sPhrase === 100 ? 'yes' : sPhrase === 50 ? `${Math.abs(Math.round(phraseErr / 4))} bar(s) out` : 'off the bar', score: sPhrase, weight: 20 });
    const sTight = tight.length ? S.curve(S.mean(tight), S.CURVES.phaseMs) : 0;
    parts.push({ label: 'Beats tight during blend', detail: tight.length ? `avg ${Math.round(S.mean(tight))} ms apart` : 'n/a', score: sTight, weight: synced ? 15 : 30 });
    const sIn = inAt === null ? 0 : inAt < 6 ? 55 : inAt <= 36 ? 100 : inAt <= 52 ? 60 : 30;
    parts.push({ label: 'Deck 2 fade-in', detail: inAt === null ? 'never reached full' : inAt < 6 ? 'slammed in too fast' : `full after ${Math.round(inAt / 4)} bars`, score: sIn, weight: 15 });
    const sw = swap.result();
    parts.push({ label: 'Bass swap', detail: sw.detail, score: sw.score, weight: 30 });
    const sOut = outAt === null ? 0 : outAt < 30 ? 50 : outAt <= 70 ? 100 : 60;
    parts.push({ label: 'Deck 1 fade-out', detail: outAt === null ? 'still playing at the end' : outAt < 30 ? 'left too early' : `gone after ${Math.round(outAt / 4)} bars`, score: sOut, weight: 20 });
    if (sPhrase < 100) tips.push('Start Deck 2 exactly when Deck 1 begins a new 8-bar section, so the two tracks change together.');
    if (sTight < 75) tips.push(synced ? 'The beats were loose. Give the jog wheel a tiny nudge when you hear a flam.' : 'The beats drifted during the blend. Get the tempo right in your “headphones” before you bring the fader up.');
    if (sw.score < 75) tips.push('Swap the bass at the half-way section change (bar 9): old LOW down, new LOW up, in one move.');
    if (sIn < 100) tips.push('Bring the new track in over about 8 bars. Too fast sounds abrupt, too slow and the mix never arrives.');
    if (sOut < 100) tips.push('Finish the job: have Deck 1 fully out by the end of bar 16, not before bar 8.');
    if (!tips.length) tips.push(synced ? 'A textbook blend. Next: do it without sync.' : 'That is a complete, hand-made DJ transition. Record yourself doing a few in a row: that is a mix.');
    ctx.finish({ score: S.combine(parts), parts, tips });
  }

  return {
    tracks: { a: pair[0], b: pair[1] },
    checklist: [
      { key: 'b.fader', label: 'Deck 2 channel fader all the way down', want: 0, test: (v) => v < 0.05 },
      { key: 'b.low', label: 'Deck 2 LOW all the way left', want: 0, test: (v) => v < 0.06 },
      { key: 'a.fader', label: 'Deck 1 channel fader up', want: 1, test: (v) => v > 0.9 },
      { key: 'a.low', label: 'Deck 1 LOW at 12 o’clock', want: 0.5, test: (v) => Math.abs(v - 0.5) < 0.08 },
      { key: 'xfader', label: 'Crossfader in the middle', want: 0.5, test: (v) => Math.abs(v - 0.5) < 0.15 },
    ],
    prepare() {
      ctx.setView({ waves: { a: true, b: true }, bpm: { a: true, b: true }, rig: true, highlight: synced ? ['b.play', 'b.fader', 'a.low', 'b.low', 'a.fader'] : ['b.pfl', 'b.play', 'b.tempo', 'b.jog'] });
      ctx.lock('a.tempo', 'a.jog', 'a.play', 'a.cue', 'a.nudge-', 'a.nudge+');
      ctx.engine.allowSync = false;
      if (synced) { a.tempoLock = 1; matchTempo(ctx); ctx.lock('b.tempo'); }
      else { do { a.tempoLock = 1 + rnd(-0.02, 0.02); } while (Math.abs(a.bpm - b.bpm) < 0.8 || Math.abs(a.bpm / b.track.bpm - 1) > ctx.engine.tempoRange * 0.9); }
      a.seekBeat(synced ? 20 * 4 : 16 * 4); b.seekBeat(0);
      boxes = phraseBoxes(h);
      cursor = h('i', { class: 'cur' });
      line = h('div', { class: 'timeline' },
        h('div', { class: 'seg in' }, 'bars 1–8: ease Deck 2 in'),
        h('div', { class: 'seg mark' }, 'swap bass'),
        h('div', { class: 'seg out' }, 'bars 9–16: ease Deck 1 out'), cursor);
      giveUp = h('button', { class: 'ghost small', onclick: finish }, 'Finish now');
      ctx.hud.append(boxes, line, giveUp);
    },
    start() {
      a.play(); clock = beatClock(a);
      ctx.prompt(synced
        ? `Press ${ctx.ctl('b.play')} when <b class="ca">Deck 1</b> starts a new section, then ease ${ctx.ctl('b.fader')} up.`
        : `First beatmatch <b class="cb">Deck 2</b> quietly: turn on ${ctx.ctl('b.pfl')} (your “headphones”), press play, match tempo and timing. Then restart it on a section change and bring ${ctx.ctl('b.fader')} up.`);
    },
    input(e) {
      // With sync on, pressing play snaps Deck 2 onto the nearest beat (like BEAT SYNC + quantize).
      if (synced && e.key === 'b.play' && e.type === 'button') {
        if (e.down) { if (b.playing) b.pause(); else { b.play(); alignB(ctx); } }
        return true;
      }
      return false;
    },
    frame() {
      if (done) return;
      const beat = clock.now();
      boxes.update(beat);
      const audB = aud('b'), audA = aud('a');
      if (state === 'prep') {
        line.classList.remove('live');
        if (b.playing && audB > 0.02 && lastAud <= 0.02) {
          // The blend starts now. Its "bar 1" is the nearest section start on Deck 1.
          t0 = Math.round(beat / PHRASE) * PHRASE;
          if (beat - t0 > 12) t0 += PHRASE;                // came in mid-section: aim for the next change
          entryErr = beat - t0;
          phraseErr = S.wrap(b.beat - a.beat, PHRASE);
          swap = swapWatcher(ctx, t0 + PHRASE, 'a');
          state = 'mix'; ctx.setView({ highlight: ['b.fader', 'a.low', 'b.low', 'a.fader'] });
        }
      } else if (state === 'mix') {
        const m = beat - t0;                               // beats into the 16-bar blend
        line.classList.add('live');
        cursor.style.left = `${S.clamp(m / 64, 0, 1) * 100}%`;
        swap.sample(beat);
        if (audA > 0.15 && audB > 0.15 && b.playing) tight.push(Math.abs(ctx.engine.offsetMs()));
        if (inAt === null && audB > 0.7) inAt = Math.max(0, m);
        if (outAt === null && audA < 0.03 && m > 4) outAt = m;
        if (outAt !== null && audA > 0.1) outAt = null;
        const bar = Math.floor(m / 4) + 1;
        if (m < 0) ctx.prompt('Deck 2 is in early. Keep it low until the section change.');
        else if (m < 28) ctx.prompt(`Bar ${bar} of 16: ease ${ctx.ctl('b.fader')} up to full by bar 8.`);
        else if (m < 36) ctx.prompt(`<b>Bass swap ${m < 32 ? 'coming: ' + Math.max(1, Math.ceil(32 - m)) + '…' : 'now!'}</b> Deck 1 LOW down, Deck 2 LOW up.`);
        else if (m < 64) ctx.prompt(`Bar ${bar} of 16: ease ${ctx.ctl('a.fader')} down. Deck 1 should be gone by bar 16.`);
        if (m >= 70 || (outAt !== null && m >= 44 && m - outAt > 4)) finish();
      }
      lastAud = b.playing ? audB : 0;
    },
  };
};

// ---------------------------------------------------------------------------
// Harmony: which keys fit?
// ---------------------------------------------------------------------------

const MINOR = ['G♯m', 'D♯m', 'A♯m', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F♯m', 'C♯m'];
const MAJOR = ['B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E'];
const MINOR_ROOT = [56, 51, 58, 53, 48, 55, 50, 57, 52, 59, 54, 49];   // MIDI notes for 1A..12A
const MAJOR_ROOT = [59, 54, 49, 56, 51, 58, 53, 48, 55, 50, 57, 52];   // 1B..12B
export const keyName = (c) => (c.endsWith('A') ? MINOR : MAJOR)[parseInt(c) - 1];
const chordOf = (c) => { const i = parseInt(c) - 1, minor = c.endsWith('A'), r = (minor ? MINOR_ROOT : MAJOR_ROOT)[i]; return [r, r + (minor ? 3 : 4), r + 7]; };
const allKeys = Array.from({ length: 24 }, (_, i) => `${(i % 12) + 1}${i < 12 ? 'A' : 'B'}`);

const keysQuiz = (ctx) => {
  const { h } = ctx;
  const ROUNDS = 8;
  let round = -1, cur, opts, good, correct = 0, state = 'idle', now, btnL, btnR, dotsEl, wheel;
  function next() {
    round++;
    if (round >= ROUNDS) return ctx.finish({
      score: (correct / ROUNDS) * 100,
      parts: [{ label: 'Correct', detail: `${correct} of ${ROUNDS}` }],
      tips: ['The rule: same number, or one number up or down with the same letter. 8A goes with 8A, 7A, 9A and 8B. Think of it as a clock face: move one hour at a time.'],
    });
    cur = pick(allKeys);
    const fits = allKeys.filter((k) => k !== cur && S.camelotCompatible(cur, k));
    const clashes = allKeys.filter((k) => !S.camelotCompatible(cur, k));
    const fit = pick(fits), clash = pick(clashes);
    good = coin(); opts = good < 0 ? [fit, clash] : [clash, fit];
    state = 'ask';
    now.innerHTML = `<b>${cur}</b><small>${keyName(cur)}</small>`;
    [btnL, btnR].forEach((btn, i) => { btn.className = 'choice'; btn.firstChild.textContent = opts[i]; btn.children[1].textContent = keyName(opts[i]); });
    drawWheel();
    ctx.prompt(`Question ${round + 1} of ${ROUNDS}: the track playing is in <b>${cur}</b>. Which track will blend in smoothly?`);
  }
  function drawWheel(reveal) {
    wheel.replaceChildren(...Array.from({ length: 12 }, (_, i) => {
      const n = i + 1, ang = (n / 12) * Math.PI * 2 - Math.PI / 2;
      return ['B', 'A'].map((l, ring) => {
        const k = `${n}${l}`, r = ring ? 29 : 43;
        const el = h('i', { class: (k === cur ? 'cur ' : '') + (reveal && S.camelotCompatible(cur, k) && k !== cur ? 'fit' : '') }, k);
        el.style.left = `${50 + Math.cos(ang) * r}%`; el.style.top = `${50 + Math.sin(ang) * r}%`;
        return el;
      });
    }).flat());
  }
  function answer(side) {
    if (state !== 'ask') return;
    state = 'reveal';
    const right = side === good;
    if (right) correct++;
    (side < 0 ? btnL : btnR).classList.add(right ? 'right' : 'wrong');
    (good < 0 ? btnL : btnR).classList.add('right');
    dotsEl.children[round].className = right ? 'good' : 'bad';
    drawWheel(true);
    const chosen = opts[side < 0 ? 0 : 1];
    ctx.playChords(chordOf(cur), chordOf(chosen));
    ctx.feedback(right ? `Yes. ${chosen} is a neighbour of ${cur}. Hear how they sit together?` : `${chosen} clashes with ${cur}. Hear the sourness? Neighbours are highlighted.`, right ? 'good' : 'bad');
    ctx.after(2600, next);
  }
  return {
    tracks: {},
    prepare() {
      ctx.setView({ waves: {}, bpm: {}, rig: false });
      ctx.lock('xfader');
      now = h('div', { class: 'keynow' });
      btnL = h('button', { class: 'choice', onclick: () => answer(-1) }, h('b', {}, ''), h('small', {}, ''), h('span', { html: ctx.key('left') }));
      btnR = h('button', { class: 'choice', onclick: () => answer(1) }, h('b', {}, ''), h('small', {}, ''), h('span', { html: ctx.key('right') }));
      wheel = h('div', { class: 'wheel' });
      dotsEl = h('div', { class: 'rounds' }, ...Array.from({ length: ROUNDS }, () => h('i')));
      ctx.hud.append(h('div', { class: 'keyrow' }, h('div', {}, h('label', {}, 'Now playing'), now), wheel), h('div', { class: 'choices' }, btnL, btnR), dotsEl);
    },
    start() { next(); },
    input(e) {
      if (e.type !== 'button') return false;
      if (ctx.isLeft(e)) answer(-1); else if (ctx.isRight(e)) answer(1);
      return true;
    },
    frame() {},
  };
};

// ---------------------------------------------------------------------------
// The path
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  { id: 'rhythm', name: 'Rhythm', blurb: 'Hear the grid that all dance music is built on.' },
  { id: 'beatmatch', name: 'Beatmatching', blurb: 'Make two tracks run at the same speed, in step.' },
  { id: 'phrasing', name: 'Phrasing', blurb: 'Start tracks where the music wants them to start.' },
  { id: 'mixing', name: 'EQ & Transitions', blurb: 'Hand over from one track to the next.' },
  { id: 'harmony', name: 'Harmony', blurb: 'Pick tracks whose notes get along.' },
];

export const LESSONS = [
  {
    id: 'tap-beat', cat: 'rhythm', title: 'Tap the Beat', mins: 1, make: tapBeat,
    skill: 'Feel the pulse',
    what: 'Tap along with every kick drum.',
    why: 'The beat is the ruler everything else is measured with. If you can’t tap it steadily, you can’t match two of them.',
    how: ['Listen to two bars first.', 'Tap on every kick: the low “thump”.', 'Half-way through the light goes out. Keep going by ear.'],
    uses: ['tap'],
  },
  {
    id: 'find-one', cat: 'rhythm', title: 'Find the One', mins: 1, make: findOne,
    skill: 'Count bars',
    what: 'Tap only on beat 1 of each bar.',
    why: 'Beats come in groups of four called bars, like words in a sentence. DJs start tracks on the “1”, the first word.',
    how: ['Count “1-2-3-4” with the counter.', 'Tap only on the “1”.', 'The counter disappears. Keep counting in your head.'],
    uses: ['tap'],
  },
  {
    id: 'hear-phrase', cat: 'rhythm', title: 'Hear the Phrase', mins: 1, make: hearPhrase,
    skill: 'Spot section changes',
    what: 'Tap the moment a new 8-bar section starts.',
    why: 'Bars group into 8-bar phrases, like sentences forming a paragraph. Tracks add or drop instruments at each new phrase, and that is when DJs make their moves.',
    how: ['Listen for the drum fill: it means a phrase is ending.', 'Tap on the cymbal crash that starts the next one.', 'There are four to catch.'],
    uses: ['tap'],
  },
  {
    id: 'faster-slower', cat: 'beatmatch', title: 'Faster or Slower?', mins: 2, make: fasterSlower,
    skill: 'Hear tempo drift',
    what: 'Two tracks play together. Say whether Deck 2 is faster or slower.',
    why: 'Before you can fix a tempo you must hear which way it is wrong. It is like two people walking: the faster one slowly pulls ahead.',
    how: ['Both tracks start in step.', 'Listen for Deck 2’s kick landing just before (faster) or after (slower) Deck 1’s.', 'The gap shrinks each round, from 5% down to under 1%.'],
    uses: ['left', 'right'],
  },
  {
    id: 'ride-fader', cat: 'beatmatch', title: 'Ride the Tempo Fader', mins: 1, make: rideFader,
    skill: 'Fine fader control',
    what: 'Set Deck 2 to an exact BPM using its tempo fader.',
    why: 'The tempo fader is very sensitive: one millimetre is a noticeable change. This drill builds the tiny finger movements you will need.',
    how: ['Watch Deck 2’s BPM readout.', 'Move the tempo fader to hit the target. Towards you = faster.', 'Hold it within 0.1 BPM to lock the round.'],
    uses: ['b.tempo'],
  },
  {
    id: 'tempo-ear', cat: 'beatmatch', title: 'Tempo by Ear', mins: 3, make: tempoByEar,
    skill: 'Match speed without looking',
    what: 'Match Deck 2’s tempo to Deck 1 with no BPM display.',
    why: 'This is the heart of beatmatching. Screens and Sync can be wrong or missing; your ears always work.',
    how: ['Snap the beats together, then listen.', 'Deck 2 pulling ahead? It is too fast: fader up a touch. Falling behind? Fader down.', 'Repeat with smaller moves. Lock in when they stay together.'],
    uses: ['b.tempo', 'snap', 'confirm'],
  },
  {
    id: 'nudge', cat: 'beatmatch', title: 'Nudge into Step', mins: 2, make: nudgePhase,
    skill: 'Line the beats up',
    what: 'The speeds match but the beats are out of step. Nudge Deck 2 into place.',
    why: 'Same speed isn’t enough: two runners at the same pace can still be out of step. The jog wheel gives a short push or drag to fix that.',
    how: ['Hear the “gallop” of two kicks close together.', 'Turn the jog wheel edge forward to push Deck 2 ahead, backward to hold it back.', 'When the two kicks become one, lock in.'],
    uses: ['b.jog', 'confirm'],
  },
  {
    id: 'beatmatch', cat: 'beatmatch', title: 'The Full Beatmatch', mins: 3, make: fullBeatmatch,
    skill: 'Tempo + timing, hands-off test',
    what: 'Start Deck 2, match tempo, line it up, then let go for 8 bars.',
    why: 'A real beatmatch must survive without babysitting, because during a mix your hands are busy with EQ and faders.',
    how: ['Press play on Deck 2 on a “1”.', 'Fix the tempo with the fader, tidy the timing with the jog.', 'Lock in, then hands off: the game measures the slip over 8 bars.'],
    uses: ['b.play', 'b.tempo', 'b.jog', 'confirm'],
  },
  {
    id: 'drop-one', cat: 'phrasing', title: 'Drop on the One', mins: 2, make: dropOnOne,
    skill: 'Start on the section change',
    what: 'Press play on Deck 2 exactly when Deck 1 starts a new 8-bar section.',
    why: 'If the new track starts on a section change, both tracks will build and break together, so the mix sounds planned rather than random.',
    how: ['Count Deck 1’s bars up to 8.', 'The fill in bar 8 is your warning.', 'Press play on the first beat of the next section. Three drops, with fewer hints each time.'],
    uses: ['b.play'],
  },
  {
    id: 'bass-swap', cat: 'mixing', title: 'The Bass Swap', mins: 2, make: bassSwap,
    skill: 'EQ hand-over',
    what: 'Swap which track owns the bass, right on the section change.',
    why: 'Two basslines together sound muddy, like two people talking at once. Only one track should have its bass up at a time.',
    how: ['Both tracks are playing in sync; Deck 2’s bass is cut.', 'On the section change: Deck 1 LOW down, Deck 2 LOW up, together.', 'Then swap back twice more.'],
    uses: ['a.low', 'b.low'],
  },
  {
    id: 'blend', cat: 'mixing', title: 'The 16-Bar Blend', mins: 2, make: blend(true),
    skill: 'A complete transition (sync on)',
    what: 'Bring Deck 2 in, swap the bass, take Deck 1 out: a full transition in 16 bars.',
    why: 'This is the bread-and-butter DJ transition. The game keeps the tempos matched so you can focus on timing, faders and EQ.',
    how: ['Start Deck 2 on a section change with its fader down.', 'Bars 1–8: ease Deck 2’s fader up.', 'Bar 9: bass swap.', 'Bars 9–16: ease Deck 1’s fader down.'],
    uses: ['b.play', 'b.fader', 'a.low', 'b.low', 'a.fader'],
  },
  {
    id: 'full-mix', cat: 'mixing', title: 'The Full Mix', mins: 4, make: blend(false),
    skill: 'Everything, no sync',
    what: 'Beatmatch by hand, then perform the 16-bar blend.',
    why: 'This is real DJing: prepare the next track privately, then bring it in on time while keeping the beats together.',
    how: ['Turn on Deck 2’s headphone CUE to hear it quietly while its fader is down.', 'Beatmatch it to Deck 1.', 'Re-start it on a section change and run the 16-bar blend.'],
    uses: ['b.pfl', 'b.play', 'b.tempo', 'b.jog', 'b.fader', 'a.low', 'b.low', 'a.fader'],
  },
  {
    id: 'keys', cat: 'harmony', title: 'Keys that Fit', mins: 2, make: keysQuiz, open: true,
    skill: 'Harmonic mixing basics',
    what: 'Pick the track whose musical key blends with the one playing.',
    why: 'Tracks in clashing keys sound sour together, like two singers on different notes. DJ software labels keys with a clock-face code (the Camelot wheel) to make matching easy.',
    how: ['Each key has a code like 8A.', 'Good matches: the same number, or one step up or down with the same letter.', 'After each answer you will hear the two chords together.'],
    uses: ['left', 'right'],
  },
];

export { TRACKS, sectionAtBar };
