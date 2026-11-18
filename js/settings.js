// Saved settings (localStorage) and rebindable keys.
import { DEFAULT_SETTINGS, DEFAULT_KEYS, GFX_PRESETS } from './config.js';

import { TOUCH_LABELS } from './touch.js';
const KEY = 'battlelightning.settings.v1';

export function loadSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
  const out = structuredClone(DEFAULT_SETTINGS);
  if (s && typeof s === 'object') {
    for (const k of Object.keys(out)) if (k in s && k !== 'gfx' && k !== 'keys') out[k] = s[k];
    if (s.gfx) out.gfx = { ...GFX_PRESETS[out.preset] || GFX_PRESETS.high, ...s.gfx };
  }
  if (!out.gfx) out.gfx = { ...GFX_PRESETS[out.preset] };
  out.keys = structuredClone(DEFAULT_KEYS);
  if (s && s.keys) for (const a in out.keys) if (Array.isArray(s.keys[a])) out.keys[a] = [s.keys[a][0] ?? null, s.keys[a][1] ?? null];
  const q = new URLSearchParams(location.search);
  if (q.has('preset') && GFX_PRESETS[q.get('preset')]) { out.preset = q.get('preset'); out.gfx = { ...GFX_PRESETS[out.preset] }; }
  if (q.has('reset')) { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } return loadSettingsDefault(); }
  return out;
}
function loadSettingsDefault() { const o = structuredClone(DEFAULT_SETTINGS); o.keys = structuredClone(DEFAULT_KEYS); return o; }
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

const NAMES = { BracketRight: ']', BracketLeft: '[', Space: 'Space', Tab: 'Tab', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Enter: 'Enter', Backspace: 'Bksp', CapsLock: 'Caps' };
// what to show for an action in prompts and the tutorial: the key, or the touch control's name
export function actionLabel(settings, action) {
  if (document.body.classList.contains('touch')) {
    let t = TOUCH_LABELS[action] || action;
    if (settings.touchInvert && action === 'pitchUp') t = 'STICK ▲'; else if (settings.touchInvert && action === 'pitchDown') t = 'STICK ▼';
    return t;
  }
  return keyName(settings.keys[action]?.[0]);
}
export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}
