/** Tiny element builder: h('div', { class: 'x', onclick: fn }, child, 'text') */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export const DECK_NAME = { a: 'Deck 1', b: 'Deck 2' };
export const CONTROL_NAME = {
  play: 'PLAY', cue: 'CUE', sync: 'BEAT SYNC', pfl: 'headphone CUE', tempo: 'TEMPO fader', jog: 'jog wheel',
  low: 'LOW', mid: 'MID', hi: 'HI', filter: 'CFX knob', fader: 'channel fader', trim: 'TRIM',
};
