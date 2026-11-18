// Procedural, layered Web Audio: turbine whine + compressor howl + exhaust roar + afterburner rumble that spool
// with RPM, wind rush and buffet with airspeed, sonic booms, gear hydraulics and clunks, guns, missiles,
// explosions delayed by the speed of sound, flak, CIWS, lock tones, RWR, warnings and spatialised AI engines
// with Doppler. Nothing is a sample file: every sound is synthesised.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

const C_SOUND = 340;

export class AudioEngine {
  constructor() { this.ok = false; this.volume = 0.8; this.music = 0.4; this.inCockpit = true; this.voices = []; this._last = {}; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    // external sounds are muffled in the cockpit
    this.ext = ctx.createGain();
    this.extLP = ctx.createBiquadFilter(); this.extLP.type = 'lowpass'; this.extLP.frequency.value = 18000;
    this.ext.connect(this.extLP).connect(this.master);
    this.ui = ctx.createGain(); this.ui.connect(this.master);
    this.cock = ctx.createGain(); this.cock.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0; this.amb.connect(this.ext);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.music; this.musicBus.connect(this.master);
    // noise buffers
    const mk = (fn, secs = 2) => { const b = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate); const d = b.getChannelData(0); fn(d); return b; };
    this.white = mk((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.brown = mk((d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    this.pink = mk((d) => { let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 3; } });
    this.crackle = mk((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() < 0.004 ? (Math.random() * 2 - 1) : d[i - 1] * 0.82 || 0; });
    this.gunBuffers = {};
    this._buildPlayerEngine();
    this._buildAmbience();
    this.ok = true;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusic(v) { this.music = v; if (this.musicBus) this.musicBus.gain.value = v; }
  get now() { return this.ctx.currentTime; }
  _ok() { return this.ok && this.ctx.state === 'running'; }
  _noise(buf, loop = true) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; if (loop) s.loopStart = Math.random(); return s; }
  _filter(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  _gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  // ---------------- player engine ----------------
  _buildPlayerEngine() {
    const ctx = this.ctx;
    const E = this.eng = {};
    E.out = this._gain(1); E.out.connect(this.master);
    E.lp = this._filter('lowpass', 12000, 0.5); E.lp.connect(E.out);
    E.whine1 = ctx.createOscillator(); E.whine1.type = 'triangle';
    E.whine2 = ctx.createOscillator(); E.whine2.type = 'sine';
    E.wg = this._gain(0); E.whine1.connect(E.wg); E.whine2.connect(E.wg);
    E.wbp = this._filter('peaking', 2000, 2); E.wbp.gain.value = 8; E.wg.connect(E.wbp).connect(E.lp);
    E.howlSrc = this._noise(this.white); E.howlBP = this._filter('bandpass', 800, 5); E.howlG = this._gain(0);
    E.howlSrc.connect(E.howlBP).connect(E.howlG).connect(E.lp);
    E.roarSrc = this._noise(this.brown); E.roarLP = this._filter('lowpass', 400, 0.7); E.roarG = this._gain(0);
    E.roarSrc.connect(E.roarLP).connect(E.roarG).connect(E.lp);
    E.abSrc = this._noise(this.brown); E.abLP = this._filter('lowpass', 160, 0.8); E.abG = this._gain(0);
    E.abSrc.connect(E.abLP).connect(E.abG).connect(E.lp);
    E.crSrc = this._noise(this.crackle); E.crBP = this._filter('bandpass', 1800, 0.7); E.crG = this._gain(0);
    E.crSrc.connect(E.crBP).connect(E.crG).connect(E.lp);
    E.windSrc = this._noise(this.pink); E.windBP = this._filter('bandpass', 600, 0.6); E.windG = this._gain(0);
    E.windSrc.connect(E.windBP).connect(E.windG).connect(this.master);
    E.bufSrc = this._noise(this.brown); E.bufLP = this._filter('lowpass', 90, 1); E.bufG = this._gain(0); E.bufAM = this._gain(0);
    E.bufLFO = ctx.createOscillator(); E.bufLFO.frequency.value = 11; E.bufLFO.connect(E.bufAM.gain);
    E.bufSrc.connect(E.bufLP).connect(E.bufG).connect(E.bufAM).connect(this.master);
    // lock tone + RWR + stall horn
    E.lock = ctx.createOscillator(); E.lock.type = 'sine'; E.lockG = this._gain(0); E.lockLFO = ctx.createOscillator(); E.lockLFO.frequency.value = 18; E.lockLFOg = this._gain(0);
    E.lockLFO.connect(E.lockLFOg).connect(E.lock.frequency); E.lock.connect(E.lockG).connect(this.cock);
    E.rwr = ctx.createOscillator(); E.rwr.type = 'square'; E.rwr.frequency.value = 1150; E.rwrG = this._gain(0); E.rwrF = this._filter('lowpass', 3000); E.rwr.connect(E.rwrF).connect(E.rwrG).connect(this.cock);
    E.horn = ctx.createOscillator(); E.horn.type = 'sawtooth'; E.horn.frequency.value = 420; E.hornG = this._gain(0); E.hornF = this._filter('lowpass', 1500); E.horn.connect(E.hornF).connect(E.hornG).connect(this.cock);
    for (const n of [E.whine1, E.whine2, E.howlSrc, E.roarSrc, E.abSrc, E.crSrc, E.windSrc, E.bufSrc, E.bufLFO, E.lock, E.lockLFO, E.rwr, E.horn]) n.start();
    // gun loop
    E.gunG = this._gain(0); E.gunG.connect(this.master);
    E.gunSrc = null; E.gunRpm = 0;
    E.prevMach = 0;
  }
  _gunBuffer(rpm, caliber) {
    const key = rpm + ':' + caliber;
    if (this.gunBuffers[key]) return this.gunBuffers[key];
    const ctx = this.ctx, sr = ctx.sampleRate, period = 60 / rpm, n = Math.max(1, Math.round(1 / period));
    const len = Math.round(period * n * sr);
    const b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const heavy = caliber > 25;
    for (let s = 0; s < n; s++) {
      const o = Math.round(s * period * sr);
      const L = Math.round(sr * (heavy ? 0.05 : 0.03));
      for (let i = 0; i < L && o + i < len; i++) {
        const t = i / sr, env = Math.exp(-t * (heavy ? 60 : 110));
        d[o + i] += ((Math.random() * 2 - 1) * 0.7 + Math.sin(t * 2 * Math.PI * (heavy ? 70 : 110)) * 0.9) * env;
      }
    }
    this.gunBuffers[key] = b;
    return b;
  }
  // per-frame parameters for the aircraft being flown / watched
  updatePlayer(p, dt, inCockpit, camMode) {
    if (!this._ok() || !p) return;
    const E = this.eng, fm = p.fm, t = this.now, k = 0.08;
    const alive = p.alive && !p.ejected;
    const rpm = alive ? fm.rpm : 0, thr = alive ? fm.thrust / p.def.engine.thrustAB : 0, ab = alive ? fm.ab : 0;
    const V = fm.V;
    // spool: whine rises with RPM (fan blade-pass), howl with compressor, roar with thrust
    const f0 = 60 + rpm * rpm * 2400;
    E.whine1.frequency.setTargetAtTime(f0, t, k); E.whine2.frequency.setTargetAtTime(f0 * 1.51, t, k);
    E.wbp.frequency.setTargetAtTime(f0 * 1.2, t, k);
    E.wg.gain.setTargetAtTime(rpm > 0.05 ? (0.02 + rpm * rpm * 0.05) * (inCockpit ? 0.8 : 0.6) : 0, t, k);
    E.howlBP.frequency.setTargetAtTime(250 + rpm * 2600, t, k);
    E.howlG.gain.setTargetAtTime(rpm * 0.12 * (inCockpit ? 0.7 : 1), t, k);
    E.roarLP.frequency.setTargetAtTime(160 + thr * 1500 + ab * 600, t, k);
    E.roarG.gain.setTargetAtTime(Math.pow(thr, 0.8) * (inCockpit ? 0.35 : 0.85), t, k);
    E.abG.gain.setTargetAtTime(ab * (inCockpit ? 0.9 : 1.4), t, k);
    E.crG.gain.setTargetAtTime(ab * (inCockpit ? 0.12 : 0.45), t, k);
    E.lp.frequency.setTargetAtTime(inCockpit ? 2600 : 16000, t, 0.2);
    // wind and buffet
    const w = clamp(V / 320, 0, 1.6);
    E.windBP.frequency.setTargetAtTime(300 + V * 4, t, k);
    E.windG.gain.setTargetAtTime(w * w * (inCockpit ? 0.22 : 0.4) * (alive || p.eject ? 1 : 0), t, k);
    const buf = alive ? fm.buffet : 0;
    E.bufG.gain.setTargetAtTime(buf * 0.9, t, 0.05);
    E.bufLFO.frequency.setTargetAtTime(9 + buf * 6, t, 0.1);
    // muffle the outside world inside the cockpit
    this.extLP.frequency.setTargetAtTime(inCockpit ? 2200 : 18000, t, 0.15);
    // lock tone: growl while seeking, steady high tone when locked
    const ls = alive ? p.lockState : 0;
    E.lock.frequency.setTargetAtTime(ls === 2 ? 1250 : 420, t, 0.03);
    E.lockLFOg.gain.setTargetAtTime(ls === 1 ? 90 : 0, t, 0.05);
    E.lockG.gain.setTargetAtTime(ls === 0 || p.missiles === 0 ? 0 : ls === 2 ? 0.07 : 0.045, t, 0.03);
    // RWR beeping when a missile is inbound
    const beep = p.missileWarn && alive && (t * 6) % 1 < 0.5;
    E.rwrG.gain.setTargetAtTime(beep ? 0.05 : 0, t, 0.01);
    // stall horn
    const stall = alive && !fm.onGround && (fm.stall > 0.15 || (fm.buffet > 0.7 && fm.V < (fm.vs1g || 70) * 1.3));
    E.hornG.gain.setTargetAtTime(stall && (t * 2.5) % 1 < 0.6 ? 0.045 : 0, t, 0.02);
    // guns
    if (p.gunFiring && alive) {
      if (!E.gunSrc) {
        const G = p.def.gun;
        E.gunSrc = this.ctx.createBufferSource(); E.gunSrc.buffer = this._gunBuffer(G.rpm, G.dmg > 15 ? 30 : 20); E.gunSrc.loop = true;
        const lp = this._filter('lowpass', inCockpit ? 1800 : 6000); E.gunSrc.connect(lp).connect(E.gunG); E.gunSrc.start();
      }
      E.gunG.gain.setTargetAtTime(0.55, t, 0.01);
    } else if (E.gunSrc) {
      E.gunG.gain.setTargetAtTime(0, t, 0.02);
      const s = E.gunSrc; E.gunSrc = null; s.stop(t + 0.15);
    }
    // sonic boom when crossing Mach 1
    if (alive && E.prevMach < 1 && fm.mach >= 1) this.sonicBoom(1);
    E.prevMach = fm.mach;
  }
  silencePlayer() {
    if (!this._ok()) return;
    const E = this.eng, t = this.now;
    for (const g of [E.wg, E.howlG, E.roarG, E.abG, E.crG, E.windG, E.bufG, E.lockG, E.rwrG, E.hornG, E.gunG]) g.gain.setTargetAtTime(0, t, 0.05);
    if (E.gunSrc) { E.gunSrc.stop(t + 0.1); E.gunSrc = null; }
  }

  // ---------------- AI engines (spatial, Doppler) ----------------
  _voice() {
    const ctx = this.ctx;
    const v = { pan: ctx.createPanner(), g: this._gain(0) };
    v.pan.panningModel = 'equalpower'; v.pan.distanceModel = 'inverse'; v.pan.refDistance = 60; v.pan.maxDistance = 12000; v.pan.rolloffFactor = 1.1;
    v.roar = this._noise(this.brown); v.lp = this._filter('lowpass', 600, 0.7);
    v.whine = ctx.createOscillator(); v.whine.type = 'triangle'; v.wg = this._gain(0.06);
    v.roar.connect(v.lp).connect(v.g); v.whine.connect(v.wg).connect(v.g);
    v.g.connect(v.pan).connect(this.ext);
    v.roar.start(); v.whine.start();
    v.plane = null;
    return v;
  }
  updateWorld(listener, camVel, planes, player, dt) {
    if (!this._ok()) return;
    const L = this.ctx.listener, t = this.now;
    const p = listener.position, f = listener.forward, u = listener.up;
    if (L.positionX) { L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02); L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    this.listenerPos = p.clone ? p.clone() : p;
    // nearest 6 other aircraft get an engine voice
    while (this.voices.length < 6) this.voices.push(this._voice());
    const near = planes.filter((a) => a !== player && a.alive && !a.parked).map((a) => [a, a.fm.pos.distanceToSquared(p)]).sort((a, b) => a[1] - b[1]).slice(0, 6);
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i], e = near[i];
      if (!e || e[1] > 9000 * 9000) { v.g.gain.setTargetAtTime(0, t, 0.1); v.plane = null; continue; }
      const a = e[0], fm = a.fm, d = Math.sqrt(e[1]);
      const pos = fm.pos;
      if (v.pan.positionX) { v.pan.positionX.setTargetAtTime(pos.x, t, 0.03); v.pan.positionY.setTargetAtTime(pos.y, t, 0.03); v.pan.positionZ.setTargetAtTime(pos.z, t, 0.03); } else v.pan.setPosition(pos.x, pos.y, pos.z);
      // Doppler: relative velocity along the line of sight
      const los = new THREE.Vector3().subVectors(p, pos).normalize();
      const vs = fm.vel.dot(los), vl = camVel ? camVel.dot(los) : 0;
      const dop = clamp((C_SOUND + vl) / Math.max(40, C_SOUND - vs), 0.4, 3);
      const thr = fm.thrust / a.def.engine.thrustAB;
      v.lp.frequency.setTargetAtTime((300 + thr * 1400 + fm.ab * 800) * dop, t, 0.05);
      v.whine.frequency.setTargetAtTime((80 + fm.rpm * fm.rpm * 2200) * dop, t, 0.05);
      v.wg.gain.setTargetAtTime(0.05 * fm.rpm, t, 0.05);
      v.g.gain.setTargetAtTime((0.5 + thr * 1.2 + fm.ab * 1.5) * 1.2, t, 0.08);
      // supersonic flyby -> boom
      if (fm.mach > 1 && d < 1800 && v.plane === a && !a._boomed) { a._boomed = true; this.sonicBoom(clamp(1 - d / 1800, 0.3, 1)); }
      if (fm.mach < 0.98) a._boomed = false;
      v.plane = a;
    }
  }

  // ---------------- one-shots ----------------
  _spatial(pos, refD = 120) {
    const pan = this.ctx.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = refD; pan.maxDistance = 20000; pan.rolloffFactor = 1;
    if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z; } else pan.setPosition(pos.x, pos.y, pos.z);
    pan.connect(this.ext); return pan;
  }
  _delayFor(pos) { return this.listenerPos ? Math.min(6, this.listenerPos.distanceTo(pos) / C_SOUND) : 0; }
  _rate(key, gap) { const t = performance.now(); if (this._last[key] && t - this._last[key] < gap) return false; this._last[key] = t; return true; }
  tone(f, t, dur, { type = 'sine', gain = 0.2, f2 = null, attack = 0.005, dest = null, q = null } = {}) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t + dur);
    const g = this._gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.ui); o.start(t); o.stop(t + dur + 0.05);
  }
  burst(buf, t, dur, { type = 'lowpass', f = 1000, f2 = null, q = 0.7, gain = 0.3, attack = 0.005, dest = null, offset = 0 } = {}) {
    const s = this._noise(buf, false); const fl = this._filter(type, f, q); if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(f2, 20), t + dur);
    const g = this._gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(dest || this.ext); s.start(t, offset || Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  explosion(pos, size = 1) {
    if (!this._ok() || !this._rate('exp', 60)) return;
    const d = this._delayFor(pos), t = this.now + d, dest = this._spatial(pos, 220 * size);
    const dist = this.listenerPos ? this.listenerPos.distanceTo(pos) : 100;
    const bright = clamp(1 - dist / 6000, 0.1, 1);
    this.tone(70 * (0.8 + Math.random() * 0.3), t, 1.8 * size, { gain: 0.9 * size, f2: 22, dest });
    this.burst(this.brown, t, 2.4 * size, { f: 600 * bright + 100, f2: 80, gain: 1.3 * size, dest });
    this.burst(this.white, t, 0.5, { f: 3000 * bright + 300, f2: 300, gain: 0.5 * size * bright, dest });
    this.burst(this.crackle, t + 0.1, 1.6, { type: 'bandpass', f: 1400, gain: 0.5 * size * bright, dest });
  }
  flak(pos) {
    if (!this._ok() || !this._rate('flak', 40)) return;
    const d = this._delayFor(pos), t = this.now + d, dest = this._spatial(pos, 160);
    this.tone(95, t, 0.7, { gain: 0.7, f2: 35, dest });
    this.burst(this.brown, t, 1.0, { f: 900, f2: 120, gain: 0.8, dest });
  }
  aaGun(pos, type) {
    if (!this._ok() || !this._rate('aa' + type + Math.round(pos.x / 50), type === 'flak' ? 300 : 70)) return;
    const d = this._delayFor(pos), t = this.now + d, dest = this._spatial(pos, 100);
    if (type === 'flak') { this.tone(120, t, 0.35, { gain: 0.8, f2: 50, dest }); this.burst(this.white, t, 0.25, { f: 2500, f2: 400, gain: 0.5, dest }); }
    else { const G = this._gunBuffer(type === 'ciws' ? 4500 : 600, 20); const s = this.ctx.createBufferSource(); s.buffer = G; const g = this._gain(0.6); s.connect(g).connect(dest); s.start(t); s.stop(t + 0.075); }
  }
  missileLaunch(pos, isPlayer) {
    if (!this._ok()) return;
    const t = this.now + (isPlayer ? 0 : this._delayFor(pos)), dest = isPlayer ? this.master : this._spatial(pos, 150);
    this.burst(this.white, t, 0.6, { type: 'bandpass', f: 600, f2: 3000, q: 0.8, gain: 0.8, dest });
    this.burst(this.brown, t + 0.05, 2.8, { f: 900, f2: 200, gain: isPlayer ? 0.9 : 0.6, dest });
  }
  sonicBoom(k = 1) {
    if (!this._ok() || !this._rate('boom', 1500)) return;
    const t = this.now;
    for (const o of [0, 0.13]) { this.burst(this.white, t + o, 0.18, { f: 4000, f2: 200, gain: 0.9 * k, dest: this.master }); this.tone(55, t + o, 1.2, { gain: 0.9 * k, f2: 20, dest: this.master }); }
    this.burst(this.brown, t + 0.05, 2.5, { f: 300, f2: 40, gain: 0.8 * k, dest: this.master });
  }
  catapult(isPlayer) {
    if (!this._ok() || !isPlayer) return;
    const t = this.now;
    this.tone(48, t, 1.2, { gain: 0.9, f2: 30, dest: this.master });
    this.burst(this.white, t, 2.4, { type: 'bandpass', f: 1800, q: 0.5, gain: 0.5, dest: this.master });
    this.burst(this.brown, t, 2.5, { f: 200, gain: 0.7, dest: this.master });
  }
  wire(isPlayer) { if (!this._ok() || !isPlayer) return; const t = this.now; this.tone(180, t, 0.6, { type: 'square', gain: 0.2, f2: 60, dest: this.master }); this.burst(this.white, t, 0.5, { type: 'bandpass', f: 3200, q: 3, gain: 0.5, dest: this.master }); this.tone(60, t, 0.8, { gain: 0.8, dest: this.master }); }
  touchdown(pos, vs, isPlayer) { if (!this._ok() || !isPlayer) return; const t = this.now; this.tone(60, t, 0.35, { gain: clamp(vs / 4, 0.3, 1), f2: 35, dest: this.master }); this.burst(this.white, t, 0.4, { type: 'bandpass', f: 2600, q: 4, gain: 0.35, dest: this.master }); }
  gearStart(p) { if (!this._ok() || !p.isPlayer) return; const t = this.now; const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(240, t); o.frequency.linearRampToValueAtTime(320, t + 1); o.frequency.linearRampToValueAtTime(300, t + 4); const g = this._gain(0); g.gain.linearRampToValueAtTime(0.035, t + 0.3); g.gain.setValueAtTime(0.035, t + 3.6); g.gain.linearRampToValueAtTime(0, t + 4.2); const f = this._filter('lowpass', 900); o.connect(f).connect(g).connect(this.cock); o.start(t); o.stop(t + 4.3); this.tone(90, t, 0.25, { gain: 0.4, f2: 50, dest: this.cock }); }
  gearClunk(p) { if (!this._ok() || !p.isPlayer) return; const t = this.now; this.tone(75, t, 0.3, { gain: 0.8, f2: 40, dest: this.cock }); this.burst(this.white, t, 0.12, { type: 'bandpass', f: 1500, q: 2, gain: 0.4, dest: this.cock }); this.tone(320, t + 0.02, 0.15, { type: 'square', gain: 0.05, f2: 200, dest: this.cock }); }
  engineEvent(ev, p) {
    if (!this._ok() || !p.isPlayer) return;
    const t = this.now;
    if (ev === 'starter') { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(900, t + 3); const g = this._gain(0); g.gain.linearRampToValueAtTime(0.06, t + 0.4); g.gain.setValueAtTime(0.06, t + 3); g.gain.linearRampToValueAtTime(0, t + 5); const f = this._filter('bandpass', 700, 1.5); o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 5.1); }
    if (ev === 'ignition') { this.burst(this.brown, t, 1.5, { f: 300, f2: 120, gain: 1.0, attack: 0.03, dest: this.master }); this.tone(45, t, 0.8, { gain: 0.6, dest: this.master }); }
    if (ev === 'flameout') { this.tone(400, t, 2.5, { type: 'triangle', gain: 0.1, f2: 60, dest: this.master }); }
  }
  hitTink(heavy = false) { if (!this._ok() || !this._rate('tink', 45)) return; const t = this.now; this.tone(2200 + Math.random() * 1800, t, 0.09, { type: 'square', gain: 0.07, dest: this.cock }); this.burst(this.white, t, heavy ? 0.4 : 0.12, { type: 'bandpass', f: heavy ? 600 : 2500, q: 2, gain: heavy ? 0.6 : 0.25, dest: this.cock }); if (heavy) this.tone(80, t, 0.4, { gain: 0.6, dest: this.cock }); }
  hitMarker() { if (!this._ok() || !this._rate('hm', 70)) return; this.tone(1700, this.now, 0.05, { type: 'triangle', gain: 0.06 }); }
  killConfirm() { if (!this._ok()) return; const t = this.now; this.tone(880, t, 0.12, { gain: 0.12 }); this.tone(1320, t + 0.1, 0.18, { gain: 0.12 }); }
  denied(isPlayer) { if (!this._ok() || !isPlayer || !this._rate('den', 300)) return; const t = this.now; this.tone(300, t, 0.12, { type: 'square', gain: 0.06, dest: this.cock }); this.tone(220, t + 0.13, 0.15, { type: 'square', gain: 0.06, dest: this.cock }); }
  reload(isPlayer) { if (!this._ok() || !isPlayer) return; const t = this.now; for (const o of [0, 0.5, 1.6, 2.4]) { this.tone(140, t + o, 0.08, { type: 'square', gain: 0.12, f2: 80, dest: this.cock }); this.burst(this.white, t + o, 0.06, { type: 'bandpass', f: 2000, q: 3, gain: 0.25, dest: this.cock }); } }
  flare(isPlayer) { if (!this._ok() || !isPlayer) return; const t = this.now; this.burst(this.white, t, 0.18, { type: 'highpass', f: 1500, gain: 0.25, dest: this.cock }); this.tone(500, t, 0.08, { type: 'square', gain: 0.04, dest: this.cock }); }
  ejectBang(isPlayer) { if (!this._ok() || !isPlayer) return; const t = this.now; this.tone(60, t, 0.6, { gain: 1, f2: 30, dest: this.master }); this.burst(this.white, t, 1.6, { f: 2500, f2: 300, gain: 0.9, dest: this.master }); }
  chute(isPlayer) { if (!this._ok() || !isPlayer) return; const t = this.now; this.burst(this.brown, t, 0.6, { f: 400, gain: 0.8, dest: this.master }); this.tone(70, t, 0.4, { gain: 0.5, dest: this.master }); }
  click() { if (!this._ok()) return; this.tone(1300, this.now, 0.04, { type: 'triangle', gain: 0.05 }); }
  hover() { if (!this._ok() || !this._rate('hov', 60)) return; this.tone(900, this.now, 0.025, { type: 'sine', gain: 0.025 }); }
  warn() { if (!this._ok() || !this._rate('warn', 900)) return; const t = this.now; this.tone(880, t, 0.12, { type: 'square', gain: 0.05, dest: this.cock }); this.tone(880, t + 0.2, 0.12, { type: 'square', gain: 0.05, dest: this.cock }); }
  introHit() {
    if (!this._ok()) return;
    const t = this.now;
    this.tone(55, t, 2.8, { gain: 0.3, attack: 0.02, dest: this.master });
    for (const f of [98, 147, 196]) this.tone(f, t, 3.4, { type: 'triangle', gain: 0.04, attack: 0.6, dest: this.master });
  }

  // ---------------- ambience: ocean and wind on the carrier deck / menu ----------------
  _buildAmbience() {
    const w = this._noise(this.pink), f = this._filter('lowpass', 500, 0.5), g = this._gain(0.25);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.12; const lg = this._gain(0.15); lfo.connect(lg).connect(g.gain);
    w.connect(f).connect(g).connect(this.amb); w.start(); lfo.start();
    const wind = this._noise(this.white), wf = this._filter('bandpass', 900, 0.4), wg = this._gain(0.04);
    wind.connect(wf).connect(wg).connect(this.amb); wind.start();
    // a slow, quiet pad for the menu
    this.pad = [];
    for (const fr of [55, 82.4, 110, 164.8]) { const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr; const g2 = this._gain(0); const lp = this._filter('lowpass', 700); o.connect(lp).connect(g2).connect(this.musicBus); o.start(); this.pad.push(g2); }
  }
  setAmbience(level, pad = 0) {
    if (!this._ok()) return;
    const t = this.now;
    this.amb.gain.setTargetAtTime(level, t, 0.6);
    this.pad.forEach((g, i) => g.gain.setTargetAtTime(pad * (0.03 - i * 0.004), t, 1.2));
  }
}
