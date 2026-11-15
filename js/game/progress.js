// Saved progress and settings (kept in this browser only).

const KEY = 'djdojo.v1';
const DEFAULTS = {
  scores: {},                  // lessonId -> { best, stars, plays }
  settings: {
    tapOffsetMs: 0,            // your personal tap timing offset (speakers + reflexes)
    tempoRange: 0.08,
    jogScale: 1,
    invertTempo: false,
    unlockAll: false,
  },
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { scores: raw.scores || {}, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}

export const store = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {}
}

export function record(lessonId, score, stars) {
  const prev = store.scores[lessonId] || { best: 0, stars: 0, plays: 0 };
  const isBest = score > prev.best;
  store.scores[lessonId] = { best: Math.max(prev.best, score), stars: Math.max(prev.stars, stars), plays: prev.plays + 1 };
  save();
  return isBest;
}

export function reset() {
  store.scores = {};
  save();
}
