// Menus: main menu, hangar (stat comparison straight from the flight model), match setup, settings with key
// rebinding / graphics / audio, pause, death and end-of-match screens.
import { AIRCRAFT, AIRCRAFT_ORDER, ACTIONS, DEFAULT_KEYS, GFX_PRESETS, TEAMS, TIME_OF_DAY, DIFFICULTY, VERSION } from './config.js';
import { saveSettings, keyName } from './settings.js';
import { measureAircraft } from './flight.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

export class UI {
  constructor(game) {
    this.game = game; this.s = game.settings;
    this.screen = null; this.prev = 'menu';
    this.stats = {};
    for (const id of AIRCRAFT_ORDER) this.stats[id] = measureAircraft(AIRCRAFT[id]);
    $('#ver').textContent = VERSION;
    $$('[data-go]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); game.audio.click(); this.go(b.dataset.go); }));
    $$('button').forEach((b) => b.addEventListener('mouseenter', () => game.audio.hover()));
    this._hangar(); this._setup(); this._settings(); this._overlays();
    this.refreshMenu();
  }

  go(name) {
    const g = this.game;
    if (name === 'back') name = this.prev;
    if (name === 'tutorial') { this.hideAll(); g.startTutorial(); return; }
    if (name === 'settings') this.prev = this.screen === 'pause' ? 'pause' : 'menu';
    this.hideAll();
    this.screen = name;
    const el = $('#' + name);
    if (el) el.classList.remove('hidden');
    if (name === 'menu' || name === 'hangar' || name === 'setup') g.enterMenu(name);
    if (name === 'hangar') this.renderStats(this.hangarId || this.s.aircraft);
    if (name === 'settings') this.renderKeys();
    if (name === 'pause') this.renderKeysHelp();
  }
  hideAll() { for (const id of ['menu', 'hangar', 'setup', 'settings', 'pause', 'death', 'end']) $('#' + id).classList.add('hidden'); this.screen = null; }
  refreshMenu() {
    $('#menuPlane').textContent = AIRCRAFT[this.s.aircraft].name;
    $('#menuSide').textContent = this.s.side === 'navy' ? 'Navy (carrier)' : 'Coastal Air Wing (airbase)';
    for (const el of $$('.k-throttleUp')) el.textContent = keyName(this.s.keys.throttleUp[0]);
    for (const el of $$('.k-eject')) el.textContent = keyName(this.s.keys.eject[0]);
  }

  // ---------------- hangar ----------------
  _hangar() {
    const list = $('#planeList');
    list.innerHTML = AIRCRAFT_ORDER.map((id) => `<button data-id="${id}"><b>${AIRCRAFT[id].name}</b><small>${AIRCRAFT[id].role}</small></button>`).join('');
    list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { this.game.audio.click(); this.hangarId = b.dataset.id; this.renderStats(b.dataset.id); this.game.showcase(b.dataset.id); }));
    $('#hangarSelect').addEventListener('click', () => { this.s.aircraft = this.hangarId || this.s.aircraft; saveSettings(this.s); this.refreshMenu(); this._syncSetup(); this.game.audio.click(); this.go('setup'); });
    // drag to orbit, wheel to zoom
    const cv = $('#game');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { if (this.screen === 'hangar') { drag = { x: e.clientX, y: e.clientY }; this.game.rig.orbit.auto = false; } });
    window.addEventListener('pointermove', (e) => { if (!drag) return; const o = this.game.rig.orbit; o.yaw -= (e.clientX - drag.x) * 0.006; o.pitch = Math.max(-0.1, Math.min(1.3, o.pitch + (e.clientY - drag.y) * 0.005)); drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', (e) => { if (this.screen === 'hangar') { const o = this.game.rig.orbit; o.dist = Math.max(10, Math.min(60, o.dist * (1 + Math.sign(e.deltaY) * 0.1))); } }, { passive: true });
  }
  renderStats(id) {
    this.hangarId = id;
    $$('#planeList button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    const A = AIRCRAFT[id], st = this.stats[id];
    const all = AIRCRAFT_ORDER.map((k) => ({ d: AIRCRAFT[k], m: this.stats[k] }));
    const hp = (d) => Object.values(d.hp).reduce((a, b) => a + b, 0);
    const max = (f) => Math.max(...all.map(f)), min = (f) => Math.min(...all.map(f));
    const norm = (v, f, lo = 0.15) => lo + (1 - lo) * (v - min(f) * 0.7) / (max(f) - min(f) * 0.7);
    const rows = [
      ['Health', hp(A), (x) => hp(x.d), `${hp(A)} HP`],
      ['Fire rate', A.gun.rpm * A.gun.dmg, (x) => x.d.gun.rpm * x.d.gun.dmg, `${A.gun.rpm} rpm`],
      ['Top speed', st.topSpeed, (x) => x.m.topSpeed, `${Math.round(st.topSpeed)} km/h`],
      ['Acceleration', st.accel, (x) => x.m.accel, `${st.accel.toFixed(1)} m/s²`],
      ['Turn rate', st.turn, (x) => x.m.turn, `${st.turn.toFixed(1)} °/s`],
      ['Durability', A.armor, (x) => x.d.armor, `×${A.armor.toFixed(2)}`],
    ];
    $('#statPanel').innerHTML = `<h3>${A.name}</h3><div class="role">${A.role.toUpperCase()}</div>
      ${rows.map(([n, v, f, txt]) => `<div class="stat"><span>${n}</span><div class="sb"><i style="width:${Math.max(6, Math.min(100, norm(v, f) * 100))}%"></i></div><span class="v">${txt}</span></div>`).join('')}
      <div class="procon"><div class="pro"><b>PRO</b> · ${A.pro}</div><div class="con"><b>CON</b> · ${A.con}</div></div>
      <div class="specs">Gun: ${A.gun.name} · ${A.gun.box * A.gun.boxes} rds<br>Missiles: 5 × ${A.missile.name} · lock range ${(A.missile.lockRange / 1000).toFixed(1)} km<br>Thrust/weight ${st.tw.toFixed(2)} · stall ${Math.round(st.stall)} km/h · G limit ${A.aero.gMax}<br>Stats measured from the flight model at 1,000 m, full power.</div>`;
  }

  // ---------------- match setup ----------------
  _setup() {
    const s = this.s;
    const ts = $('#teamSize');
    ts.addEventListener('input', () => { s.teamSize = +ts.value; $('#teamSizeOut').textContent = `${ts.value} v ${ts.value}`; saveSettings(s); });
    const seg = (sel, key, cb) => { $$(`${sel} button`).forEach((b) => b.addEventListener('click', () => { s[key] = b.dataset.v; saveSettings(s); this._syncSetup(); this.game.audio.click(); cb?.(b.dataset.v); })); };
    $('#acSeg').innerHTML = AIRCRAFT_ORDER.map((id) => `<button data-v="${id}">${AIRCRAFT[id].short}</button>`).join('');
    seg('#sideSeg', 'side'); seg('#diffSeg', 'difficulty'); seg('#todSeg', 'timeOfDay'); seg('#acSeg', 'aircraft', (id) => this.game.showcase(id));
    $('#startMatch').addEventListener('click', () => { this.game.audio.click(); this.hideAll(); this.game.startMatch(); });
    this._syncSetup();
  }
  _syncSetup() {
    const s = this.s;
    $('#teamSize').value = s.teamSize; $('#teamSizeOut').textContent = `${s.teamSize} v ${s.teamSize}`;
    const mark = (sel, v) => $$(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    mark('#sideSeg', s.side); mark('#diffSeg', s.difficulty); mark('#todSeg', s.timeOfDay); mark('#acSeg', s.aircraft);
    $('#sideDesc').innerHTML = s.side === 'navy' ? 'Launch from the <b>aircraft carrier</b>, escorted by battleships and destroyers with flak and CIWS. Trap on the deck to repair.' : 'Take off from the <b>military airbase</b> on the mainland, defended by ground flak and AA guns around the city. Land on the runway to repair.';
    this.refreshMenu();
  }

  // ---------------- settings ----------------
  _settings() {
    const s = this.s, g = this.game;
    $$('.tabs button').forEach((b) => b.addEventListener('click', () => { $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); $$('.tab').forEach((t) => t.classList.add('hidden')); $('#tab-' + b.dataset.tab).classList.remove('hidden'); g.audio.click(); }));
    $('#resetKeys').addEventListener('click', () => { s.keys = structuredClone(DEFAULT_KEYS); saveSettings(s); this.renderKeys(); this.refreshMenu(); });
    // graphics
    const pr = $('#presets');
    pr.innerHTML = Object.entries(GFX_PRESETS).map(([k, v]) => `<button data-p="${k}">${v.label}</button>`).join('');
    pr.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { s.preset = b.dataset.p; s.gfx = { ...GFX_PRESETS[b.dataset.p] }; saveSettings(s); this._syncGfx(); g.applyGraphics(); }));
    const bind = (id, key, fmt = (v) => v, obj = () => s.gfx, after) => {
      const el = $('#' + id); const out = el.parentElement.querySelector('output');
      el.addEventListener('input', () => { const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? (isNaN(+el.value) ? el.value : +el.value) : +el.value; obj()[key] = v; if (out) out.textContent = fmt(v); saveSettings(s); after ? after() : g.applyGraphics(); });
    };
    bind('gScale', 'scale', (v) => `${Math.round(v * 100)}%`); bind('gShadows', 'shadows'); bind('gClouds', 'clouds', (v) => v.toFixed(2)); bind('gTrees', 'trees', (v) => v.toFixed(2)); bind('gParticles', 'particles', (v) => v.toFixed(2));
    bind('gFov', 'fov', (v) => `${v}°`, () => s); bind('gBloom', 'bloom'); bind('gFxaa', 'fxaa'); bind('gFps', 'showFps', (v) => v, () => s);
    bind('sVol', 'volume', (v) => `${Math.round(v * 100)}%`, () => s, () => g.audio.setVolume(s.volume));
    bind('sMusic', 'music', (v) => `${Math.round(v * 100)}%`, () => s, () => g.audio.setMusic(s.music));
    bind('sUnits', 'units', (v) => v, () => s, () => { g.hud.units = s.units; });
    bind('sInvert', 'invertLook', (v) => v, () => s, () => {});
    $('#sName').addEventListener('input', (e) => { s.callsign = e.target.value.trim() || 'You'; saveSettings(s); });
    this._syncGfx();
  }
  _syncGfx() {
    const s = this.s;
    const setv = (id, v, fmt) => { const el = $('#' + id); if (el.type === 'checkbox') el.checked = !!v; else el.value = v; const o = el.parentElement.querySelector('output'); if (o && fmt) o.textContent = fmt(v); };
    $$('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.p === s.preset));
    setv('gScale', s.gfx.scale, (v) => `${Math.round(v * 100)}%`); setv('gShadows', s.gfx.shadows); setv('gClouds', s.gfx.clouds, (v) => (+v).toFixed(2)); setv('gTrees', s.gfx.trees, (v) => (+v).toFixed(2)); setv('gParticles', s.gfx.particles, (v) => (+v).toFixed(2));
    setv('gFov', s.fov, (v) => `${v}°`); setv('gBloom', s.gfx.bloom); setv('gFxaa', s.gfx.fxaa); setv('gFps', s.showFps);
    setv('sVol', s.volume, (v) => `${Math.round(v * 100)}%`); setv('sMusic', s.music, (v) => `${Math.round(v * 100)}%`); setv('sUnits', s.units); setv('sInvert', s.invertLook);
    $('#sName').value = s.callsign || 'You';
  }
  renderKeys() {
    const s = this.s, list = $('#keyList');
    const used = {};
    for (const a in s.keys) for (const c of s.keys[a]) if (c) (used[c] ||= []).push(a);
    list.innerHTML = '<div class="dim">Action</div><div class="dim">Primary</div><div class="dim">Alternate</div>' + ACTIONS.map(([a, label]) => `<div class="act">${label}</div>${[0, 1].map((i) => { const c = s.keys[a][i]; return `<button data-a="${a}" data-i="${i}" class="${c && used[c].length > 1 ? 'conflict' : ''}" title="${c && used[c].length > 1 ? 'Also bound to: ' + used[c].filter((x) => x !== a).join(', ') : ''}">${keyName(c)}</button>`; }).join('')}`).join('');
    list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      b.classList.add('wait'); b.textContent = 'press a key…';
      this.game.input.rebind((code) => {
        if (code !== 'Escape') {
          const a = b.dataset.a, i = +b.dataset.i;
          s.keys[a][i] = code === 'Backspace' ? null : code;
          saveSettings(s);
        }
        this.renderKeys(); this.refreshMenu();
      });
    }));
  }
  renderKeysHelp() {
    const s = this.s;
    $('#keysHelp').innerHTML = ACTIONS.map(([a, l]) => `<span><kbd>${keyName(s.keys[a][0])}</kbd>${s.keys[a][1] ? ` <kbd>${keyName(s.keys[a][1])}</kbd>` : ''}</span><span>${l}</span>`).join('') + '<span><kbd>RMB</kbd></span><span>Hold to look around</span><span><kbd>Esc</kbd></span><span>Pause</span>';
  }

  // ---------------- overlays ----------------
  _overlays() {
    const g = this.game;
    $('#resume').addEventListener('click', () => { g.audio.click(); g.resume(); });
    $('#quit').addEventListener('click', () => { g.audio.click(); g.quitToMenu(); });
    $('#respawn').addEventListener('click', () => { g.audio.click(); g.respawn(); });
    $('#deathMenu').addEventListener('click', () => { g.audio.click(); g.quitToMenu(); });
    $('#again').addEventListener('click', () => { g.audio.click(); this.hideAll(); g.startMatch(); });
    $('#endMenu').addEventListener('click', () => { g.audio.click(); g.quitToMenu(); });
  }
  showDeath(title, by) {
    $('#deathTitle').textContent = title; $('#deathBy').innerHTML = by || '';
    $('#death').classList.remove('hidden'); this.screen = 'death';
  }
  setRespawn(t, can) {
    const b = $('#respawn');
    if (!can) { b.disabled = true; $('#deathTimer').textContent = 'No aircraft left in your squadron.'; return; }
    b.disabled = t > 0;
    $('#deathTimer').textContent = t > 0 ? `Next aircraft ready in ${Math.ceil(t)} s` : 'Your next aircraft is ready on the ' + (this.s.side === 'navy' ? 'catapult.' : 'runway.');
  }
  showEnd(win, reason, p) {
    $('#endTitle').textContent = win ? 'VICTORY' : 'DEFEAT';
    $('#endTitle').style.color = win ? '#ffd23f' : '#ff6a5a';
    $('#endReason').textContent = reason;
    $('#endStats').innerHTML = `<div><b>${p.kills}</b>Kills</div><div><b>${p.assists}</b>Assists</div><div><b>${p.deaths}</b>Deaths</div><div><b>${p.score}</b>Score</div>`;
    $('#end').classList.remove('hidden'); this.screen = 'end';
  }
}
