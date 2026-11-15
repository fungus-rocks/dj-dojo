// Scoring maths. Pure functions so they can be unit-tested without a browser.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Turn an error into points using a list of [error, points] waypoints.
 * e.g. curve(30, [[15,100],[40,80],[100,0]]) -> 88
 */
export function curve(err, points) {
  err = Math.abs(err);
  if (err <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [e0, s0] = points[i - 1], [e1, s1] = points[i];
    if (err <= e1) return s0 + ((err - e0) / (e1 - e0)) * (s1 - s0);
  }
  return points[points.length - 1][1];
}

export const CURVES = {
  tapMs: [[18, 100], [35, 90], [60, 70], [100, 40], [160, 0]],
  phaseMs: [[8, 100], [15, 93], [25, 80], [40, 60], [70, 25], [110, 0]],
  bpm: [[0.04, 100], [0.1, 93], [0.2, 80], [0.4, 60], [0.8, 25], [1.5, 0]],
  dropMs: [[20, 100], [40, 90], [70, 72], [120, 45], [220, 0]],
  swapBeats: [[0.5, 100], [1, 90], [2, 70], [4, 40], [8, 0]],
};

export const starsFor = (score) => (score >= 93 ? 3 : score >= 80 ? 2 : score >= 60 ? 1 : 0);

/**
 * Match taps to targets (both in beats). Each target takes its nearest tap
 * within `window` beats; unmatched taps count as extras.
 */
export function matchTaps(taps, targets, window = 0.5) {
  const used = new Set();
  const hits = targets.map((target) => {
    let best = -1, bestD = window;
    taps.forEach((tap, i) => {
      const d = Math.abs(tap - target);
      if (!used.has(i) && d <= bestD) { best = i; bestD = d; }
    });
    if (best < 0) return { target, hit: false };
    used.add(best);
    return { target, hit: true, error: taps[best] - target };
  });
  return { hits, extras: taps.length - used.size };
}

/** Fold a beat difference into the range (-span/2, span/2]. */
export function wrap(x, span) { return x - Math.round(x / span) * span; }

/** Weighted average of score parts: [{score, weight}] */
export function combine(parts) {
  const w = parts.reduce((s, p) => s + (p.weight ?? 1), 0);
  return parts.reduce((s, p) => s + p.score * (p.weight ?? 1), 0) / w;
}

// ---- harmonic mixing (Camelot wheel) --------------------------------------
// Keys are written like '8A': a number 1-12 (position on a clock face) and a
// letter (A = minor, B = major). Neighbours on the clock sound good together.

export function camelotCompatible(k1, k2) {
  const [n1, l1] = [parseInt(k1), k1.slice(-1)], [n2, l2] = [parseInt(k2), k2.slice(-1)];
  if (n1 === n2) return true;                                   // same key, or its major/minor twin
  const step = Math.min((n1 - n2 + 12) % 12, (n2 - n1 + 12) % 12);
  return l1 === l2 && step === 1;                               // one hour either way
}
