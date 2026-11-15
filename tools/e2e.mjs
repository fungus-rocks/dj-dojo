// End-to-end check: a robot "player" plays every lesson in a real (headless)
// browser and we check each one finishes with a high score. This proves the
// timing and scoring maths work together, not just in isolation.
//
//   npm start            (in one terminal)
//   node tools/e2e.mjs   (needs Playwright: npm i -D playwright)
//
// Options:  node tools/e2e.mjs [lessonId ...]   --shots <dir>   --midi

import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const shots = opt('--shots'), useMidi = flag('--midi'), base = opt('--url') || 'http://localhost:8080/';
const ALL = ['tap-beat', 'find-one', 'hear-phrase', 'faster-slower', 'ride-fader', 'tempo-ear', 'nudge', 'beatmatch', 'drop-one', 'bass-swap', 'blend', 'full-mix', 'keys'];
const lessons = args.length ? args : ALL;

// ---- the robot player (runs inside the page) -------------------------------
function bot(id) {
  const { engine, bus } = window.djdojo, a = engine.decks.a, b = engine.decks.b;
  const every = (ms, fn) => { const t = setInterval(() => { if (window.djdojo.screen.state !== 'running' || fn() === true) clearInterval(t); }, ms); };
  const press = (key) => { bus.press(key, true, 'key', performance.now()); bus.press(key, false, 'key', performance.now() + 1); };
  const heardBeat = () => a.beatAt(engine.heardTime(performance.now()));
  const tempoFor = (bpm) => (bpm / b.track.bpm - 1) / engine.tempoRange / 2 + 0.5;
  const jogFix = () => bus.rel('b.jog', Math.round(-engine.offsetMs() / 0.6), 'key');   // 1 tick = 0.6 ms
  const settled = () => Math.abs(b.pendingShift) < 1e-5;
  // Calls fn each time deck A crosses the start of an 8-bar section.
  const onPhrase = (fn) => { let last = a.beat % 32; every(3, () => { const p = a.beat % 32; const hit = p < last; last = p; if (hit) return fn(); }); };
  const tapper = (isTarget) => { let last = Math.floor(heardBeat()); every(2, () => { const n = Math.floor(heardBeat()); if (n !== last) { last = n; if (isTarget(n)) press('tap'); } }); };
  const prompt = () => document.querySelector('.prompt').textContent;

  // A full 16-bar blend, driven by beats since the section change it started on.
  const blendMoves = (t0beat) => {
    let laps = 0, last = a.beat, swapped = false;
    every(20, () => {
      const raw = a.beat; if (raw < last - 96) laps++; last = raw;
      const m = raw + laps * 192 - t0beat;
      bus.set('b.fader', Math.min(1, Math.max(0.15, m / 28)), 'key');
      if (m >= 32 && !swapped) { swapped = true; bus.set('a.low', 0, 'key'); bus.set('b.low', 0.5, 'key'); }
      if (m > 36) bus.set('a.fader', Math.max(0, 1 - (m - 36) / 24), 'key');
    });
  };

  const bots = {
    'tap-beat': () => tapper((n) => n >= 40 && n < 72),
    'find-one': () => tapper((n) => n >= 72 && n % 4 === 0),
    'hear-phrase': () => tapper((n) => n >= 64 && n % 32 === 0),
    'faster-slower': () => every(400, () => { if (!document.querySelector('.choice.right') && a.playing) press(b.bpm > a.bpm ? 'right' : 'left'); }),
    'ride-fader': () => every(300, () => { const t = parseFloat(document.querySelectorAll('.bignum')[1].textContent); if (t) bus.set('b.tempo', tempoFor(t), 'key'); }),
    'tempo-ear': () => { let done = 0; every(500, () => { if (a.bpm !== done && a.playing && !document.querySelector('.hud .readout').textContent) { done = a.bpm; bus.set('b.tempo', tempoFor(a.bpm), 'key'); setTimeout(() => press('confirm'), 300); } }); },
    nudge: () => { let busy = false; every(300, () => { if (!busy && /Round/.test(prompt()) && Math.abs(engine.offsetMs()) > 40) { busy = true; jogFix(); setTimeout(() => { jogFix(); setTimeout(() => { press('confirm'); busy = false; }, 500); }, 600); } }); },
    beatmatch: () => { bus.set('b.tempo', tempoFor(a.bpm), 'key'); press('b.play'); setTimeout(jogFix, 400); setTimeout(jogFix, 1200); setTimeout(() => press('confirm'), 2000); },
    'drop-one': () => onPhrase(() => { if (!b.playing) press('b.play'); }),
    'bass-swap': () => { let n = 0; onPhrase(() => { const out = n++ % 2 ? 'b' : 'a', inn = out === 'a' ? 'b' : 'a'; bus.set(`${out}.low`, 0, 'key'); bus.set(`${inn}.low`, 0.5, 'key'); }); },
    blend: () => onPhrase(() => { press('b.play'); blendMoves(Math.round(a.beat / 32) * 32); return true; }),
    'full-mix': () => { bus.set('b.tempo', tempoFor(a.bpm), 'key'); onPhrase(() => { press('b.play'); setTimeout(jogFix, 300); blendMoves(Math.round(a.beat / 32) * 32); return true; }); },
    keys: () => every(400, () => {
      if (document.querySelector('.choice.right')) return;
      const cur = document.querySelector('.keynow b')?.textContent, opts = [...document.querySelectorAll('.choice b')].map((el) => el.textContent);
      if (!cur) return;
      const fits = (k) => { const n1 = parseInt(cur), n2 = parseInt(k); return n1 === n2 || (cur.slice(-1) === k.slice(-1) && [1, 11].includes((n1 - n2 + 12) % 12)); };
      press(fits(opts[0]) ? 'left' : 'right');
    }),
  };
  bots[id]();
}

// ---- a pretend DDJ-FLX4, so the MIDI path is tested without hardware --------
function fakeMidi() {
  const input = { name: 'DDJ-FLX4', state: 'connected', onmidimessage: null };
  const sent = [];
  const output = { name: 'DDJ-FLX4', state: 'connected', send: (d) => sent.push([...d]) };
  navigator.requestMIDIAccess = async () => ({ inputs: new Map([['i', input]]), outputs: new Map([['o', output]]), onstatechange: null });
  window.__midi = { sent, send: (...bytes) => input.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp: performance.now() }) };
}

async function midiCheck(browser) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(fakeMidi);
  await page.goto(base + '#/free');
  await page.click('.pill');
  await page.waitForFunction(() => window.djdojo.midi.status === 'connected');
  await page.click('.overlay .primary');
  await page.waitForFunction(() => window.djdojo.engine.decks?.b.track, null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const { bus, engine, midi } = window.djdojo, m = window.__midi, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = {};
    out.sysexQuery = m.sent.some((d) => d[0] === 0xf0 && d.at(-1) === 0xf7);
    m.send(0xb0, 0x13, 64); m.send(0xb0, 0x33, 0); await wait(20);           // deck 1 channel fader: half
    out.fader = bus.get('a.fader');
    m.send(0xb6, 0x1f, 127); m.send(0xb6, 0x3f, 127); await wait(20);        // crossfader: full right
    out.xfader = bus.get('xfader');
    m.send(0xb1, 0x0f, 0); await wait(20);                                   // deck 2 LOW: coarse byte only
    out.lowB = bus.get('b.low');
    m.send(0xb1, 0x00, 127); m.send(0xb1, 0x20, 127); await wait(20);        // deck 2 tempo: bottom = fastest
    out.bpmB = engine.decks.b.bpm; out.maxB = engine.decks.b.track.bpm * (1 + engine.tempoRange);
    m.send(0x91, 0x0b, 127); m.send(0x91, 0x0b, 0); await wait(300);         // deck 2 PLAY
    out.playing = engine.decks.b.playing;
    const deck = engine.decks.b, t0 = engine.ctx.currentTime, p0 = deck.position;
    m.send(0xb1, 0x21, 64 + 20); await wait(500);                            // jog edge: 20 ticks forward = 12 ms
    out.jogShiftMs = Math.round(((deck.position - p0) - (engine.ctx.currentTime - t0) * deck.baseRate) * 1e4) / 10;
    out.jogMoved = deck.pendingShift === 0 && Math.abs(out.jogShiftMs - 12) < 1;
    m.send(0x99, 0x22, 127); await wait(20);                                 // deck 2 pad 3 (beat-jump pad mode)
    out.known = bus.isKnown('a.fader') && !bus.isKnown('a.hi');
    await wait(100);
    out.playLed = m.sent.some((d) => d[0] === 0x91 && d[1] === 0x0b && d[2] === 0x7f);
    out.pill = document.querySelector('.pill').textContent;
    out.keysHidden = getComputedStyle(document.querySelector('.rig .keys')).display === 'none';
    return out;
  });
  if (shots) await page.screenshot({ path: `${shots}/midi-free.png` });
  const ok = r.sysexQuery && Math.abs(r.fader - 64 * 128 / 16383) < 1e-6 && r.xfader === 1 && r.lowB === 0 && Math.abs(r.bpmB - r.maxB) < 1e-6 && r.playing && r.jogMoved && r.known && r.playLed && r.keysHidden && !errs.length;
  console.log(`${ok ? 'PASS' : 'FAIL'}  fake DDJ-FLX4  ${JSON.stringify(r)} ${errs.join(' | ')}`);
  await page.close();
  return ok;
}

// ---- run -------------------------------------------------------------------
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

async function play(id) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const page = await context.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => localStorage.setItem('djdojo.v1', JSON.stringify({ settings: { unlockAll: true } })));
  await page.goto(`${base}#/lesson/${id}`);
  await page.waitForSelector('.overlay.open .primary');
  if (shots) await page.screenshot({ path: `${shots}/${id}-brief.png` });
  await page.keyboard.press('Enter');
  let out;
  try {
    await page.waitForFunction(() => window.djdojo.screen.state === 'running', null, { timeout: 30000 });
    await page.evaluate(bot, id);
    if (shots) { await page.waitForTimeout(9000); await page.screenshot({ path: `${shots}/${id}-play.png` }); }
    await page.waitForFunction(() => window.djdojo.screen.state === 'result', null, { timeout: 240000 });
    out = await page.evaluate(() => ({
      score: parseInt(document.querySelector('.score').textContent),
      parts: [...document.querySelectorAll('.parts tr')].map((tr) => [...tr.children].map((td) => td.textContent).filter(Boolean).join(': ')).join(' | '),
    }));
    if (shots) await page.screenshot({ path: `${shots}/${id}-result.png` });
  } catch (e) {
    out = { score: -1, parts: e.message.split('\n')[0] + ' | prompt: ' + await page.evaluate(() => document.querySelector('.prompt')?.textContent).catch(() => '?') };
    if (shots) await page.screenshot({ path: `${shots}/${id}-stuck.png` }).catch(() => {});
  }
  await context.close();
  const ok = out.score >= 85 && !errs.length;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(14)} ${String(out.score).padStart(3)}  ${out.parts}${errs.length ? '  ERRORS: ' + errs.join(' | ') : ''}`);
  return ok;
}

const results = [];
if (useMidi) results.push(await midiCheck(browser));
// A few at a time: enough to be quick, not so many that timers get starved.
for (let i = 0; i < lessons.length; i += 4) results.push(...await Promise.all(lessons.slice(i, i + 4).map(play)));
await browser.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
