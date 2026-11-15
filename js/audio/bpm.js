// Tempo estimate for tracks you load yourself. Built-in tracks never need this.
// Method: build a "how punchy is the bass right now" curve, then find the beat
// spacing where that curve best lines up with itself.

export function detectBpm(samples, sr, { min = 80, max = 170 } = {}) {
  const hop = Math.round(sr / 200), fps = sr / hop;   // exact frames per second
  const maxFrames = Math.min(Math.floor(samples.length / hop), Math.floor(fps * 120));
  const start = Math.max(0, Math.floor((samples.length / hop - maxFrames) / 2));
  const env = new Float32Array(maxFrames);
  const k = 1 - Math.exp((-2 * Math.PI * 180) / sr);
  let lp = 0, prev = 0;
  for (let f = 0; f < maxFrames; f++) {
    let e = 0;
    const base = (start + f) * hop;
    for (let i = 0; i < hop; i++) { lp += k * (samples[base + i] - lp); e += lp * lp; }
    env[f] = Math.max(0, e - prev); prev = e;
  }
  const score = (lag) => {
    let s = 0;
    const n = maxFrames - Math.ceil(lag) - 1;
    for (let i = 0; i < n; i += 1) {
      const j = i + lag, j0 = Math.floor(j), fr = j - j0;
      s += env[i] * (env[j0] * (1 - fr) + env[j0 + 1] * fr);
    }
    return s / n;
  };
  const scoreBpm = (bpm) => {
    const lag = (60 / bpm) * fps;
    return score(lag) + 0.5 * score(lag * 2) + 0.25 * score(lag * 4);
  };
  let best = 120, bestS = -1;
  for (let bpm = min; bpm <= max; bpm += 0.5) {
    const s = scoreBpm(bpm);
    if (s > bestS) { bestS = s; best = bpm; }
  }
  for (let bpm = best - 0.5; bpm <= best + 0.5; bpm += 0.02) {
    const s = scoreBpm(bpm);
    if (s > bestS) { bestS = s; best = bpm; }
  }
  if (Math.abs(best - Math.round(best)) < 0.12) best = Math.round(best);

  // Where does beat one sit? Slide the grid and keep the best fit.
  const lag = (60 / best) * fps;
  let bestOff = 0, bestO = -1;
  for (let o = 0; o < lag; o += 0.5) {
    let s = 0;
    for (let t = o; t < maxFrames - 1; t += lag) s += env[Math.round(t)];
    if (s > bestO) { bestO = s; bestOff = o; }
  }
  const period = 60 / best;
  let firstBeat = (start + bestOff) / fps;
  firstBeat -= Math.floor(firstBeat / period) * period;
  return { bpm: Math.round(best * 100) / 100, firstBeat };
}
