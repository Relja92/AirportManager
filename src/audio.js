// Small synthesised sound effects. No audio files; everything is a few sine notes.
const KEY = 'airport-manager-muted';
let ctx = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* ignore */ }
const last = {};

// Browsers only allow audio after a user gesture, so the context is created on first input.
function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx?.state === 'suspended') ctx.resume();
}
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

function note(freq, at, length, volume, type = 'sine') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ctx.currentTime + at;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

const SOUNDS = {
  land: [[660, 0, 0.35, 0.035], [880, 0.09, 0.45, 0.03]],
  buy: [[523, 0, 0.18, 0.06], [784, 0.08, 0.3, 0.06]],
  goal: [[523, 0, 0.25, 0.06], [659, 0.1, 0.25, 0.06], [784, 0.2, 0.25, 0.06], [1047, 0.3, 0.5, 0.06]],
  alert: [[440, 0, 0.22, 0.06, 'triangle'], [349, 0.16, 0.4, 0.06, 'triangle']],
  click: [[900, 0, 0.06, 0.025]],
  report: [[392, 0, 0.3, 0.05], [523, 0.12, 0.3, 0.05], [659, 0.24, 0.5, 0.05]],
};
const MIN_GAP = { land: 1.2, click: 0.03 }; // seconds between repeats, so 10× speed isn't a wall of chimes

export const audio = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* ignore */ }
    return muted;
  },
  play(name) {
    if (muted || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
    const now = ctx.currentTime;
    if (now - (last[name] ?? -9) < (MIN_GAP[name] ?? 0.15)) return;
    last[name] = now;
    for (const n of SOUNDS[name]) note(...n);
  },
};
