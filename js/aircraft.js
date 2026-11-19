// An aircraft in the match (player or AI): flight model + 3D model + cockpit/pilot, component damage, guns,
// missile lock, flares, carrier catapult & arresting wires, landing/repair, crashes, break-up and ejection.
import * as THREE from 'three';
import { AIRCRAFT, MISSILE } from './config.js';
import { FlightModel, AB_DETENT } from './flight.js';
import { buildAircraft } from './aircraftModels.js';
import { Cockpit } from './cockpit.js';
import { buildParachute } from './pilot.js';
import { CATS, LANDING } from './ships.js';
import { clamp, lerp, DEG, smoothstep } from './util.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
export const COMPS = ['fuselage', 'wingL', 'wingR', 'engine', 'tail'];

function hitSpheres(def) {
  const g = def.geo, out = [];
  const fr = Math.max(0.75, g.span * 0.045 + 0.45);
  for (let i = 0; i < 6; i++) { const z = lerp(g.noseZ + fr, g.tailZ - fr, i / 5); out.push({ comp: i < 4 ? 'fuselage' : 'engine', c: new V3(0, 0, z), r: fr * (i === 0 ? 0.8 : 1) }); }
  out.push({ comp: 'fuselage', c: new V3(...g.eye), r: 0.65, pilot: true });
  const tip = g.tipsSwept ? [(g.tips[0] + g.tipsSwept[0]) / 2, g.tips[1], (g.tips[2] + g.tipsSwept[2]) / 2] : g.tips;
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    const t = (k + 0.5) / 4;
    out.push({ comp: s < 0 ? 'wingL' : 'wingR', c: new V3(s * lerp(fr + 0.6, tip[0], t), tip[1], lerp(0.2, tip[2], t)), r: lerp(1.7, 0.7, t) });
  }
  for (const n of g.nozzles) out.push({ comp: 'engine', c: new V3(n[0], n[1], n[2] - 1.6), r: n[3] + 0.5 });
  const fins = g.fin[0] ? [-1, 1] : [0];
  for (const s of fins) out.push({ comp: 'tail', c: new V3(s * g.fin[0], g.fin[1] * 0.6, g.fin[2]), r: 1.15 });
  for (const s of [-1, 1]) out.push({ comp: 'tail', c: new V3(s * 2.0, 0, g.tailZ - 1.4), r: 1.0 });
  return out;
}

export class Aircraft {
  constructor(game, id, team, opts = {}) {
    this.game = game; this.id = id; this.def = AIRCRAFT[id]; this.team = team;
    this.isPlayer = !!opts.player; this.name = opts.name || this.def.short;
    this.fm = new FlightModel(this.def);
    this.model = buildAircraft(id, team);
    this.group = this.model.group;
    game.scene.add(this.group);
    this.cockpit = new Cockpit(this.def, team, !this.isPlayer);
    this.group.add(this.cockpit.group);
    this.cockpit.setInteriorVisible(false);
    this.maxHp = { ...this.def.hp }; this.hp = { ...this.def.hp };
    this.alive = true; this.state = 'flying';
    const G = this.def.gun;
    this.gunAmmo = G.box; this.gunReserve = G.box * (G.boxes - 1); this.reloading = 0; this.fireAcc = 0; this.shotN = 0; this.gunFiring = false; this.gunHeat = 0;
    this.missiles = MISSILE.max; this.flares = this.def.flares; this.missileCd = 0; this.flareCd = 0;
    this.lock = { target: null, t: 0, state: 0 }; this.lockState = 0;
    this.incoming = [];
    this.kills = 0; this.deaths = 0; this.assists = 0; this.score = 0;
    this.lastHit = null; this.lastHitT = -99; this.damagers = new Map();
    this.radius = this.def.geo.len * 0.55;
    this.spheres = hitSpheres(this.def);
    this.ctrl = { fire: false };
    this.engineFire = false; this.missileWarn = false; this.smokeT = 0; this.vaporT = 0;
    this.trails = {};
    this.fwd = new V3(0, 0, -1);
    this.repairT = 0; this.landedT = 0; this.trapped = false; this.boltered = false;
    this.ejected = false; this.eject = null;
    this.prevGear = this.fm.gear; this.gearMoving = false;
    this.messages = [];
    this.freeLook = { yaw: 0, pitch: 0 };
    this.spawnT = game.time;
  }

  get pos() { return this.fm.pos; }
  hpFrac(c) { return this.hp[c] / this.maxHp[c]; }
  get health() { let s = 0, m = 0; for (const c of COMPS) { s += this.hp[c]; m += this.maxHp[c]; } return s / m; }
  // health as a pilot would read it: 0 % is the point where the jet comes apart (fuselage gone or under 22 % overall)
  combatHealth() { return this.alive ? clamp(Math.min((this.health - 0.22) / 0.78, this.hpFrac('fuselage')), 0, 1) : 0; }
  heavilyDamaged() { return this.engineFire || COMPS.some((c) => this.hpFrac(c) < 0.3); }
  say(text, kind = 'info', t = 3) { if (this.isPlayer) this.game.hud?.message(text, kind, t); }

  // ---------------- spawn helpers ----------------
  placeAir(pos, heading, speed, alt) {
    const fm = this.fm;
    fm.pos.copy(pos); fm.pos.y = alt;
    fm.quat.setFromEuler(new THREE.Euler(0, heading, 0, 'YXZ'));
    fm.vel.set(0, 0, -speed).applyQuaternion(fm.quat);
    fm.engine = 'running'; fm.rpm = 0.92; fm.throttle = 0.85; fm.gear = 0; fm.gearCmd = 0; fm.flaps = 0; fm.airT = 5; fm.omega.set(0, 0, 0);
    fm.attached = null; fm.arrest = null; fm.onGround = false; fm.surface = null; this.cat = null; this.trapped = false; this.boltered = false;
    this.state = 'flying';
    this.syncModel(0);
  }
  placeRunway(world, x, z, heading, cold = false) {
    const fm = this.fm, s = world.surface(x, z, 100);
    fm.quat.setFromEuler(new THREE.Euler(0, heading, 0, 'YXZ'));
    fm.pos.set(x, s.h - this.def.geo.gearMain[1] - 0.12, z);
    fm.vel.set(0, 0, 0); fm.omega.set(0, 0, 0); fm.gear = 1; fm.gearCmd = 1; fm.airT = 0;
    if (cold) { fm.engine = 'off'; fm.rpm = 0; fm.throttle = 0; } else { fm.engine = 'running'; fm.rpm = 0.62; fm.throttle = 0; }
    this.state = 'landed';
    this.syncModel(0);
  }
  attachCatapult(i, cold = false) {
    const fm = this.fm, c = this.game.world.fleet.carrier;
    this.cat = { i, s: 0, v: 0, phase: 'hold', fullT: 0, len: CATS[i].start.distanceTo(CATS[i].end) };
    fm.gear = 1; fm.gearCmd = 1; fm.flaps = 1; fm.arrest = null; fm.omega.set(0, 0, 0);
    if (cold) { fm.engine = 'off'; fm.rpm = 0; fm.throttle = 0; }
    fm.attached = { update: (f, dt) => this._catUpdate(f, dt) };
    this.state = 'catapult'; this.trapped = false; this.boltered = false;
    this._catUpdate(fm, 0);
    this.syncModel(0);
  }
  _catUpdate(fm, dt) {
    const st = this.cat, fleet = this.game.world.fleet, c = fleet.carrier;
    if (!st) return;
    if (st.phase === 'hold') {
      const ready = fm.engine === 'running' && fm.throttle >= AB_DETENT - 0.02 && fm.rpm >= 0.965;
      st.fullT = ready ? st.fullT + dt : 0;
      if (st.fullT > 1.5) { st.phase = 'stroke'; this.game.audio?.catapult(this.isPlayer); this.say('CATAPULT!', 'good', 1.5); }
    } else {
      const a = 25 + fm.thrust / fm.mass;
      st.v += a * dt; st.s += st.v * dt;
      if (Math.random() < 0.6) this.game.fx.puff(fm.pos.clone().add(_a.set((Math.random() - 0.5) * 3, -1.6, 2).applyQuaternion(fm.quat)), _b.set(0, 3, 0), 2.5, 2.5, 0.95, 0.45, 2.5);
    }
    const cat = CATS[st.i];
    const local = _a.copy(cat.start).lerp(cat.end, Math.min(1, st.s / st.len));
    local.y = c.deckY - this.def.geo.gearMain[1] - 0.12;
    c.toWorld(local, fm.pos);
    fm.quat.copy(c.quat);
    const fwd = _b.set(0, 0, -1).applyQuaternion(c.quat);
    fm.vel.copy(c.vel).addScaledVector(fwd, st.v);
    if (c.jbds) c.jbds[st.i].rotation.x = st.phase === 'hold' && fm.rpm > 0.5 ? lerp(c.jbds[st.i].rotation.x, -0.95, 0.05) : lerp(c.jbds[st.i].rotation.x, 0, 0.05);
    if (st.phase === 'stroke' && st.s >= st.len) {
      fm.attached = null; this.cat = null; this.state = 'flying'; fm.airT = 0; fm.gndT = 0;
      if (c.jbds) c.jbds[st.i].rotation.x = 0;
      this.game.onLaunched?.(this);
    }
  }
  catReady() { return this.cat && this.cat.phase === 'hold' ? clamp(this.cat.fullT / 1.5, 0, 1) : 0; }

  // ---------------- hit testing / damage ----------------
  raycast(p0, p1) {
    _q.copy(this.fm.quat).invert();
    const a = _a.copy(p0).sub(this.fm.pos).applyQuaternion(_q), b = _b.copy(p1).sub(this.fm.pos).applyQuaternion(_q);
    const d = _c.copy(b).sub(a), L2 = d.lengthSq();
    let best = null, bt = 2;
    for (const s of this.spheres) {
      // segment-sphere
      const fx = a.x - s.c.x, fy = a.y - s.c.y, fz = a.z - s.c.z;
      const B = fx * d.x + fy * d.y + fz * d.z, C = fx * fx + fy * fy + fz * fz - s.r * s.r;
      const disc = B * B - L2 * C;
      if (disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / L2;
      if (t >= 0 && t <= 1 && t < bt) { bt = t; best = s; } else if (C < 0 && 0 < bt) { bt = 0; best = s; }
    }
    if (!best) return null;
    return { comp: best.comp, pilot: best.pilot, point: new V3().copy(p0).lerp(p1, bt) };
  }
  damage(comp, amount, attacker, point, kind = 'gun') {
    if (!this.alive || amount <= 0) return;
    if (this.game.tutorialSafe && this.isPlayer) amount *= 0.2;
    const dmg = amount / this.def.armor;
    this.hp[comp] = Math.max(0, this.hp[comp] - dmg);
    // every hit also loads the main structure
    if (comp !== 'fuselage') this.hp.fuselage = Math.max(0, this.hp.fuselage - dmg * 0.35);
    if (attacker && attacker !== this) {
      this.lastHit = attacker; this.lastHitT = this.game.time;
      this.damagers.set(attacker, (this.damagers.get(attacker) || 0) + dmg);
    }
    this.game.onHit?.(attacker, this, comp, dmg, kind, point);
    this._applyDamage();
    if (this.hp.fuselage <= 0 || this.health < 0.22) this.destroy('shot down', attacker);
  }
  _applyDamage() {
    const fm = this.fm, f = (c) => this.hpFrac(c);
    fm.dmg.wingL = f('wingL'); fm.dmg.wingR = f('wingR'); fm.dmg.tail = f('tail');
    fm.dmg.engine = f('engine');
    fm.dmg.drag = 0.006 * (4 - f('wingL') - f('wingR') - f('fuselage') - f('tail'));
    if (f('engine') < 0.3 && !this.engineFire) { this.engineFire = true; this.say('ENGINE FIRE — land or eject!', 'bad', 3); }
    for (const [c, sign] of [['wingL', 1], ['wingR', -1]]) if (f(c) <= 0 && !this['lost_' + c]) { this['lost_' + c] = true; fm.dmg.wingLost += sign; this._breakOff(c); this.say(c === 'wingL' ? 'LEFT WING LOST' : 'RIGHT WING LOST', 'bad', 4); }
    if (f('tail') <= 0 && !this.lost_tail) { this.lost_tail = true; this._breakOff('tail'); this.say('TAIL LOST', 'bad', 4); }
  }
  _breakOff(part) {
    const g = this.model.parts[part];
    if (!g || !g.parent) return;
    g.updateWorldMatrix(true, false);
    const piece = new THREE.Group();
    g.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
    g.parent.remove(g);
    g.position.set(0, 0, 0); g.quaternion.identity(); piece.add(g);
    const vel = this.fm.vel.clone().add(_a.set((Math.random() - 0.5) * 20, 6 + Math.random() * 10, (Math.random() - 0.5) * 20));
    this.game.fx.addDebris(piece, piece.position.clone(), vel, new V3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8), { fire: true, life: 45 });
    this.game.fx.explosion(piece.position, 0.45, { vel: this.fm.vel.clone().multiplyScalar(0.5) });
  }

  // aircraft lost without a wreck to show (abandoned jet removed on respawn): score it, credit the last attacker
  writeOff(cause) {
    if (!this.alive) return;
    this.alive = false; this.state = 'destroyed';
    const recent = this.lastHit && this.game.time - this.lastHitT < 25 ? this.lastHit : null;
    this.game.onKill?.(recent, this, cause);
  }
  destroy(cause, attacker) {
    if (!this.alive) return;
    this.alive = false; this.state = 'destroyed';
    const recent = this.lastHit && this.game.time - this.lastHitT < 25 ? this.lastHit : null;
    const killer = attacker && attacker !== this ? attacker : recent;
    this.game.onKill?.(killer, this, cause);
    const fx = this.game.fx, p = this.fm.pos.clone();
    const s = this.game.world.surface(p.x, p.z, p.y);
    if (p.y - s.h < 6 && s.kind === 'water') { fx.splash(p, 3); fx.explosion(p, 1.0); }
    else fx.explosion(p, 1.7, { vel: this.fm.vel.clone().multiplyScalar(0.4) });
    this.game.audio?.explosion(p, 1.5);
    // break into burning pieces
    const air = p.y - s.h > 15;
    for (const part of ['wingL', 'wingR', 'tail', 'engine', 'fuselage']) {
      const g = this.model.parts[part];
      if (!g || !g.parent) continue;
      if (!air) { g.visible = false; continue; }
      g.updateWorldMatrix(true, false);
      const piece = new THREE.Group();
      g.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
      g.parent.remove(g); g.position.set(0, 0, 0); g.quaternion.identity(); piece.add(g);
      const vel = this.fm.vel.clone().multiplyScalar(0.75).add(_a.set((Math.random() - 0.5) * 30, Math.random() * 15, (Math.random() - 0.5) * 30));
      fx.addDebris(piece, piece.position.clone(), vel, new V3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 7), { fire: part !== 'wingL' && part !== 'wingR' ? true : Math.random() < 0.5, life: 50 });
    }
    if (!air) { this.game.fx.addDebris(new THREE.Group(), p, new V3(), new V3(), { fire: true, life: 30 }); }
    this.group.visible = air ? true : false;
    for (const k in this.trails) this.trails[k]?.stop();
    if (this.cat) { this.fm.attached = null; this.cat = null; }
  }
  // remove from the scene entirely (after respawn / match end)
  dispose() {
    this.game.scene.remove(this.group);
    for (const k in this.trails) this.trails[k]?.stop();
    if (this.eject) { this.game.scene.remove(this.eject.anchor); if (this.eject.chute) this.game.scene.remove(this.eject.chute); }
  }

  // ---------------- weapons ----------------
  _guns(dt) {
    const G = this.def.gun;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { const take = Math.min(G.box - this.gunAmmo, this.gunReserve); this.gunAmmo += take; this.gunReserve -= take; this.reloading = 0; this.say('GUNS RELOADED', 'good', 1.5); }
    }
    this.gunHeat = Math.max(0, this.gunHeat - dt * 0.18);
    this.gunFiring = false;
    if (this.ctrl.fire && this.reloading <= 0 && this.gunAmmo > 0 && this.gunHeat < 1 && this.state !== 'catapult') {
      this.gunFiring = true;
      this.fireAcc += dt * G.rpm / 60;
      const q = this.fm.quat;
      const muzzle = _a.set(...this.def.geo.gun).applyQuaternion(q).add(this.fm.pos);
      const fwd = _b.set(0, 0, -1).applyQuaternion(q);
      let shots = 0;
      while (this.fireAcc >= 1 && this.gunAmmo > 0) {
        this.fireAcc -= 1; this.gunAmmo--; this.shotN++; shots++;
        const sp = G.spread * (1 + this.gunHeat * 1.5);
        const dir = _c.set((Math.random() - 0.5) * 2 * sp, (Math.random() - 0.5) * 2 * sp, -1).applyQuaternion(q).normalize();
        const v = dir.multiplyScalar(G.vel).add(this.fm.vel);
        const mz = muzzle.clone().addScaledVector(fwd, Math.random() * 3);
        this.game.weapons.fireBullet(this, mz, v, G.dmg, this.shotN % 3 === 0, this.team);
        this.gunHeat += 0.0022;
      }
      if (shots) { this.game.fx.glow(muzzle.clone().addScaledVector(fwd, 0.8), 1.8 + Math.random(), 0.05, 1, 0.8, 0.45, 1); }
      if (this.gunHeat >= 1) this.say('GUNS OVERHEATED', 'warn', 2);
      if (this.gunAmmo === 0) this.say(this.gunReserve > 0 ? 'GUNS EMPTY — RELOAD (Q)' : 'OUT OF AMMO', 'warn', 2.5);
    } else this.fireAcc = Math.min(this.fireAcc, 1);
  }
  reload() {
    const G = this.def.gun;
    if (this.reloading > 0 || this.gunReserve <= 0 || this.gunAmmo >= G.box) return false;
    this.reloading = G.reload; this.say('RELOADING…', 'info', G.reload);
    this.game.audio?.reload(this.isPlayer);
    return true;
  }
  _updateLock(dt) {
    const M = this.def.missile, fm = this.fm;
    const fwd = this.fwd;
    let best = null, bestScore = 1e9;
    const cosCone = Math.cos(M.cone * DEG);
    for (const a of this.game.aircraft) {
      if (!a.alive || a.team === this.team) continue;
      const d = _a.copy(a.fm.pos).sub(fm.pos), dist = d.length();
      if (dist > M.lockRange || dist < 200) continue;
      const c = d.dot(fwd) / dist;
      if (c < cosCone) continue;
      const score = (1 - c) * 4000 + dist * 0.3;
      if (score < bestScore) { bestScore = score; best = a; }
    }
    if (best !== this.lock.target) { this.lock.target = best; this.lock.t = 0; }
    if (best && this.missiles > 0) { this.lock.t += dt * (best.fm.ab > 0.1 ? 1.4 : 1); this.lock.state = this.lock.t >= M.lockTime ? 2 : 1; }
    else this.lock.state = 0;
    this.lockState = this.lock.state;
  }
  fireMissile() {
    if (this.missileCd > 0 || this.state === 'catapult') return false;
    if (this.missiles <= 0) { this.say('NO MISSILES LEFT', 'warn', 1.5); this.game.audio?.denied(this.isPlayer); return false; }
    if (this.lock.state !== 2 || !this.lock.target?.alive) { this.say('NO LOCK — keep the target in the circle', 'warn', 1.5); this.game.audio?.denied(this.isPlayer); return false; }
    const slot = this.model.parts.missiles[MISSILE.max - this.missiles];
    this.game.weapons.launchMissile(this, this.lock.target, slot);
    if (slot) slot.visible = false;
    this.missiles--; this.missileCd = 1.1;
    return true;
  }
  dropFlares() {
    if (this.flareCd > 0 || this.flares <= 0) return false;
    this.flares -= 2; this.flareCd = 0.45;
    this.game.weapons.dropFlare(this);
    return true;
  }
  // anything for the ground crew to do?
  needsService() {
    const G = this.def.gun;
    if (this.missiles < MISSILE.max || this.flares < this.def.flares || this.gunAmmo + this.gunReserve < G.box * G.boxes || this.fm.fuel < this.def.fuel * 0.98) return true;
    for (const c of COMPS) if (this.hp[c] < this.maxHp[c]) return true;
    return this.engineFire;
  }
  rearm() {
    const G = this.def.gun;
    this.missiles = MISSILE.max; this.flares = this.def.flares; this.gunAmmo = G.box; this.gunReserve = G.box * (G.boxes - 1); this.reloading = 0; this.gunHeat = 0;
    for (const m of this.model.parts.missiles) m.visible = true;
    this.fm.fuel = this.def.fuel;
  }
  repairStep(dt, rate = 1 / 8) {
    let done = true;
    for (const c of COMPS) { this.hp[c] = Math.min(this.maxHp[c], this.hp[c] + this.maxHp[c] * rate * dt); if (this.hp[c] < this.maxHp[c]) done = false; }
    if (this.engineFire && this.hpFrac('engine') > 0.35) this.engineFire = false;
    this._applyDamage();
    if (this.fm.engine === 'dead' && this.hpFrac('engine') > 0.3 && this.fm.fuel > 0) this.fm.engine = 'off';
    return done;
  }

  // ---------------- ejection ----------------
  doEject() {
    if (!this.alive || this.ejected) return;
    this.ejected = true;
    const fm = this.fm, game = this.game;
    const up = _a.set(0, 1, 0).applyQuaternion(fm.quat).clone();
    // canopy blows off
    const can = this.model.parts.canopy;
    if (can && can.parent) {
      can.updateWorldMatrix(true, false);
      const piece = new THREE.Group(); can.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
      can.parent.remove(can); can.position.set(0, 0, 0); piece.add(can);
      game.fx.addDebris(piece, piece.position.clone(), fm.vel.clone().addScaledVector(up, 26).add(_b.set(0, 0, 8).applyQuaternion(fm.quat)), new V3(4, 1, 2), { fire: false, life: 25 });
    }
    game.audio?.ejectBang(this.isPlayer);
    // seat + pilot leave on the rocket
    const anchor = this.cockpit.pilotAnchor;
    anchor.updateWorldMatrix(true, false);
    const wp = new V3(), wq = new THREE.Quaternion(), ws = new V3();
    anchor.matrixWorld.decompose(wp, wq, ws);
    anchor.parent.remove(anchor);
    anchor.position.copy(wp); anchor.quaternion.copy(wq);
    game.scene.add(anchor);
    this.cockpit.setInteriorVisible(false);
    this.cockpit.pilot.setHeadVisible(true);
    this.eject = { anchor, t: 0, vel: fm.vel.clone().addScaledVector(up, 12), up: up.clone(), phase: 'rocket', chute: null, landed: false,
      trail: game.fx.trail({ w0: 0.4, w1: 4, life: 5, alpha: 0.7, color: 0xd8d8d8, max: 80, interval: 0.03 }) };
    // aircraft keeps going with nobody at the controls
    fm.input.pitch = 0; fm.input.roll = 0; fm.input.yaw = 0; this.ctrl.fire = false;
    this.state = 'abandoned';
    game.onEject?.(this);
  }
  _ejectUpdate(dt) {
    const E = this.eject, game = this.game, a = E.anchor;
    if (!E || E.landed) return;
    E.t += dt;
    if (E.phase === 'rocket') {
      E.vel.addScaledVector(E.up, 150 * dt);
      game.fx.fireball(a.position.clone().addScaledVector(E.up, -0.6), E.up.clone().multiplyScalar(-30), 0.9, 0.18, 1);
      E.trail.add(a.position, 1);
      if (E.t > 0.28) E.phase = 'coast';
    } else if (E.phase === 'coast') {
      if (E.t > 1.6) {
        E.phase = 'chute'; E.trail.stop();
        // seat separates, chute deploys
        const seat = this.cockpit.seat;
        seat.updateWorldMatrix(true, false);
        const sp = new THREE.Group(); seat.matrixWorld.decompose(sp.position, sp.quaternion, sp.scale);
        seat.parent.remove(seat); seat.position.set(0, 0, 0); seat.rotation.set(0, 0, 0); sp.add(seat);
        game.fx.addDebris(sp, sp.position.clone(), E.vel.clone().add(_a.set(0, -4, 0)), new V3(2, 1, 3), { fire: false, life: 20 });
        E.chute = buildParachute(); E.chute.scale.setScalar(0.05); game.scene.add(E.chute);
        game.audio?.chute(this.isPlayer);
        const p = this.cockpit.pilot;
        p.recline = 0; p.handT[0].set(-0.22, 0.95, -0.05); p.handT[1].set(0.22, 0.95, -0.05); p.handN[0].set(1, 0, 0); p.handN[1].set(-1, 0, 0);
        p.footT[0].set(-0.1, -0.95, -0.12); p.footT[1].set(0.12, -0.9, -0.05); p.grip = [1.1, 1.1];
      }
    }
    if (E.phase === 'chute') {
      const k = Math.min(1, (E.t - 1.6) / 1.3);
      E.chute.scale.setScalar(0.05 + 0.95 * k * k * (3 - 2 * k));
      const target = _a.set(2.5, -6.2, 1.5);
      E.vel.lerp(target, 1 - Math.exp(-dt * (0.6 + 2.5 * k)));
      const breathe = 1 + Math.sin(E.t * 2.1) * 0.03;
      E.chute.userData.canopy.scale.set(breathe, 1 / breathe, breathe);
      // hang the pilot under the chute, upright
      _q.setFromEuler(new THREE.Euler(Math.sin(E.t * 0.9) * 0.08, E.t * 0.15, Math.sin(E.t * 1.3) * 0.08));
      a.quaternion.slerp(_q, 1 - Math.exp(-dt * 2));
      E.chute.position.copy(a.position); E.chute.quaternion.copy(a.quaternion);
    } else E.vel.y -= 9.81 * dt;
    a.position.addScaledVector(E.vel, dt);
    this.cockpit.pilot.update();
    const s = game.world.surface(a.position.x, a.position.z, a.position.y);
    if (a.position.y < s.h + 0.6) {
      E.landed = true; a.position.y = s.h + 0.6;
      if (s.kind === 'water') { game.fx.splash(a.position, 0.6); }
      if (E.chute) { E.chute.rotation.z = 1.3; E.chute.position.y = s.h + 0.5; }
      game.onPilotLanded?.(this, s.kind === 'water');
    }
  }

  // ---------------- per-frame update ----------------
  update(dt) {
    const fm = this.fm, game = this.game, world = game.world;
    if (this.eject) this._ejectUpdate(dt);
    if (!this.alive) return;
    this.missileCd -= dt; this.flareCd -= dt;
    this.fwd.set(0, 0, -1).applyQuaternion(fm.quat);
    if (this.state !== 'abandoned') { this._guns(dt); this._updateLock(dt); }
    // burning engine
    if (this.engineFire) { this.hp.engine = Math.max(0, this.hp.engine - 6 * dt); this.hp.fuselage = Math.max(0, this.hp.fuselage - 7 * dt); this._applyDamage(); if (this.hp.fuselage <= 0) { this.destroy('burned', null); return; } }
    if (fm.overG > 0.6) { this.damage('wingL', 25 * dt, null, fm.pos, 'overstress'); this.damage('wingR', 25 * dt, null, fm.pos, 'overstress'); if (Math.random() < dt) this.say('OVER-G! airframe overstressed', 'bad', 1.5); }
    // missile warning
    this.missileWarn = this.incoming.some((m) => m.target === this && !m.lost && m.pos.distanceTo(fm.pos) < 7000);
    // physics
    const surfH = world.surface(fm.pos.x, fm.pos.z, fm.pos.y).h;
    const agl = fm.pos.y - surfH;
    fm.update(dt, world, agl < 30 || !!fm.attached);
    this._events();
    if (!this.alive) return;
    this._groundChecks(dt, agl);
    if (!this.alive) return;
    this.syncModel(dt);
    this._effects(dt, agl);
  }

  _events() {
    const fm = this.fm, game = this.game;
    for (const ev of fm.events) {
      if (ev[0] === 'touch') {
        const [, vs, main, kind] = ev;
        const limit = this.team === 'navy' || this.id === 'f14' || this.id === 'f18' ? 8.5 : 7;
        if (vs > limit) { this.say('HARD LANDING — GEAR COLLAPSED', 'bad', 3); this.crash('hard landing'); return; }
        if (main && vs > 1.2) { for (let i = 0; i < 4; i++) game.fx.puff(fm.pos.clone().add(_a.set((Math.random() - 0.5) * 3, this.def.geo.gearMain[1], 0).applyQuaternion(fm.quat)), _b.set(0, 1, 0), 1.2, 2, 0.8, 0.5, 3); game.audio?.touchdown(fm.pos, vs, this.isPlayer); }
      } else if (ev[0] === 'ignition' || ev[0] === 'starter' || ev[0] === 'running' || ev[0] === 'flameout') game.audio?.engineEvent(ev[0], this);
    }
    fm.events.length = 0;
  }

  crash(cause) { if (this.alive) this.destroy(cause, null); }

  _groundChecks(dt, agl) {
    const fm = this.fm, world = this.game.world, g = this.def.geo, q = fm.quat;
    if (fm.attached) return;
    // airframe points that must never touch anything
    const sw = fm.sweep;
    const tip = g.tipsSwept ? [lerp(g.tips[0], g.tipsSwept[0], sw), g.tips[1], lerp(g.tips[2], g.tipsSwept[2], sw)] : g.tips;
    const pts = [[0, 0, g.noseZ + 0.4, 'nose'], [-tip[0], tip[1], tip[2], 'tip'], [tip[0], tip[1], tip[2], 'tip'], [g.fin[0], g.fin[1], g.fin[2], 'fin'], [0, g.gearMain[1] * 0.55, 0, 'belly'], [0, 0.0, g.tailZ, 'tail']];
    if (agl < 40) {
      for (const [x, y, z, kind] of pts) {
        const p = _a.set(x, y, z).applyQuaternion(q).add(fm.pos);
        const s = world.surface(p.x, p.z, p.y);
        if (p.y < s.h - 0.05) {
          if (kind === 'tail' && fm.vel.y > -3 && s.kind !== 'water') { this.damage('tail', 30 * dt, null, p, 'scrape'); this.game.fx.spark(p, _b.set(0, 3, 0), 0.4, 0.5); continue; }
          if (kind === 'belly' && fm.gear > 0.98 && fm.dmg.gearOk) continue;
          this.crash(s.kind === 'water' ? 'ditched' : kind === 'belly' ? 'belly landing' : 'crashed');
          if (kind === 'belly' && fm.gear < 0.98) this.say('GEAR WAS UP!', 'bad', 3);
          return;
        }
      }
      // wheels in the water = ditching; fast over rough ground tears the gear off
      if (fm.gear > 0.5) for (const w of fm.wheels) {
        const p = _a.copy(w.o).applyQuaternion(q).add(fm.pos);
        const s = world.surface(p.x, p.z, p.y);
        if (s.kind === 'water' && p.y < s.h) { this.crash('ditched'); return; }
      }
      if (fm.onGround && fm.surface && fm.surface.kind === 'grass' && fm.groundSpeed > 45) { this.say('RAN OFF THE RUNWAY', 'bad', 3); this.crash('ran off the runway'); return; }
      if (fm.onGround && fm.surface && fm.surface.kind === 'city' && fm.groundSpeed > 25) { this.crash('crashed into the city'); return; }
    }
    // buildings, bridges, ships, towers
    if (fm.pos.y < 480) {
      for (const [x, y, z] of pts) {
        const p = _a.set(x, y, z).applyQuaternion(q).add(fm.pos);
        const ob = world.obstacle(p.x, p.y, p.z);
        if (ob && !(ob === 'ship' && fm.onGround)) { this.crash('hit a ' + (ob === 'ship' ? 'ship' : ob)); return; }
      }
    }
    // carrier: arresting wires, bolters, rolling off the deck
    if (fm.onGround && fm.surface) {
      const s = fm.surface;
      if (s.kind === 'deck') {
        const c = s.ship, loc = s.local;
        const la = LANDING.a, lb = LANDING.b;
        const ax = lb.x - la.x, az = lb.z - la.z, L = Math.hypot(ax, az);
        const t = ((loc.x - la.x) * ax + (loc.z - la.z) * az) / L, lat = Math.abs((loc.x - la.x) * az - (loc.z - la.z) * ax) / L;
        const wireS0 = (la.z - LANDING.wires[0] - 8) / (la.z - lb.z) * L, wireS1 = (la.z - LANDING.wires[3] + 6) / (la.z - lb.z) * L;
        if (!fm.arrest && !this.trapped && fm.gearCmd > 0.5 && lat < LANDING.width / 2 + 5 && t > wireS0 && t < wireS1) {
          const rel = _b.copy(fm.vel).sub(c.vel).length();
          if (rel < 80) {
            fm.arrest = { vel: c.vel, decel: 27 }; this.trapped = true;
            const wire = Math.max(1, Math.min(4, Math.ceil((t - wireS0) / ((wireS1 - wireS0) / 4))));
            this.say(`TRAP! Caught the #${wire} wire`, 'good', 3); this.game.audio?.wire(this.isPlayer);
            this.game.onTrap?.(this, wire);
          } else if (!this.boltered) { this.boltered = true; this.say('TOO FAST — missed the wires! Full power, go around!', 'bad', 3); }
        }
        // touched down past the wires or outside the landing area: bolter
        if (!fm.arrest && !this.trapped && !this.boltered && this.state === 'flying' && (t > wireS1 || lat > LANDING.width / 2 + 5)) {
          const rel = _b.copy(fm.vel).sub(c.vel).length();
          if (rel > 30) { this.boltered = true; this.say(fm.gearCmd > 0.5 ? 'BOLTER — missed the wires! Full power, go around!' : 'NO GEAR — full power, go around!', 'bad', 3); }
        }
        if (fm.arrest) fm.arrest.vel = c.vel;
      }
      // stopped on a friendly base: repair & rearm
      const rel = s.kind === 'deck' ? _b.copy(fm.vel).sub(s.ship.vel).length() : fm.groundSpeed;
      if (rel < 1.6 && (world.isFriendlyBase(s, this.team) || (this.game.tutorialMode && /^(deck|runway|apron)$/.test(s.kind))) && this.state !== 'abandoned' && (this.state === 'flying' || this.state === 'repairing' || this.needsService())) {
        this.landedT += dt;
        if (this.landedT > 0.8) {
          if (this.state !== 'repairing') { this.state = 'repairing'; this.repairT = 0; this.say('ON THE GROUND — repairing & rearming', 'good', 3); this.game.onLanded?.(this, s.kind); }
          this.repairT += dt;
          const done = this.repairStep(dt, 1 / 7);
          if (done && this.repairT > 4) { this.rearm(); this.state = 'landed'; this.landedT = -999; this.game.onRepaired?.(this, s.kind); }
        }
      } else if (rel > 4) { if (this.state === 'repairing' || this.state === 'landed') this.state = 'flying'; this.landedT = 0; }
    } else { this.landedT = 0; if (this.state === 'landed' || this.state === 'repairing') this.state = 'flying'; if (fm.airT > 2) { this.trapped = false; this.boltered = false; fm.arrest = null; } }
  }

  syncModel(dt) {
    const fm = this.fm;
    this.group.position.copy(fm.pos);
    this.group.quaternion.copy(fm.quat);
    this.model.update(fm, dt, this.game.time);
    if (!this.ejected) this.cockpit.animate(fm, this.freeLook);
    // gear sounds
    if (Math.abs(fm.gear - this.prevGear) > 1e-4) { if (!this.gearMoving) { this.gearMoving = true; this.game.audio?.gearStart(this); } }
    else if (this.gearMoving) { this.gearMoving = false; this.game.audio?.gearClunk(this); }
    this.prevGear = fm.gear;
  }

  _effects(dt, agl) {
    const fm = this.fm, fx = this.game.fx, q = fm.quat, g = this.def.geo;
    const cam = this.game.camPos;
    const near = cam ? cam.distanceToSquared(fm.pos) < 6000 * 6000 : true;
    if (!near) return;
    this.smokeT -= dt;
    const eng = this.hpFrac('engine');
    if ((eng < 0.7 || this.engineFire || this.hpFrac('fuselage') < 0.4) && this.smokeT <= 0) {
      this.smokeT = (this.engineFire ? 0.03 : 0.05 + eng * 0.1) / Math.max(0.5, fx.q);
      for (const n of g.nozzles) {
        const p = _a.set(n[0], n[1], n[2] + 0.6).applyQuaternion(q).add(fm.pos);
        const shade = this.engineFire ? 0.06 : 0.12 + eng * 0.25;
        fx.puff(p, _b.copy(fm.vel).multiplyScalar(0.08).add(_c.set(0, 1, 0)), 1.4 + (1 - eng) * 1.5, 3 + (1 - eng) * 4, shade, 0.75, 3.5);
        if (this.engineFire) fx.fireball(p, _b.copy(fm.vel).multiplyScalar(0.3), 1.6, 0.25, 1);
      }
    }
    // high-G wingtip vortices and transonic vapour
    const tip = g.tipsSwept ? [lerp(g.tips[0], g.tipsSwept[0], fm.sweep), g.tips[1], lerp(g.tips[2], g.tipsSwept[2], fm.sweep)] : g.tips;
    const vort = smoothstep(4.5, 7.5, fm.gLoad) * smoothstep(80, 140, fm.V) * (fm.pos.y < 6000 ? 1 : 0.4);
    for (const s of [-1, 1]) {
      const key = s < 0 ? 'vL' : 'vR';
      if (vort > 0.05) {
        if (!this.trails[key] || !this.trails[key].emitting) this.trails[key] = fx.trail({ w0: 0.15, w1: 1.4, life: 1.6, alpha: 0.55, color: 0xffffff, max: 50, interval: 0.03, drift: 0 });
        this.trails[key].add(_a.set(s * tip[0], tip[1], tip[2] + 0.3).applyQuaternion(q).add(fm.pos), vort);
      } else if (this.trails[key]) { this.trails[key].stop(); this.trails[key] = null; }
    }
    // contrails at altitude
    if (fm.pos.y > 8500 && fm.rpm > 0.7) {
      g.nozzles.forEach((n, i) => {
        const key = 'c' + i;
        if (!this.trails[key] || !this.trails[key].emitting) this.trails[key] = fx.trail({ w0: 0.6, w1: 14, life: 22, alpha: 0.5, color: 0xf4f6f8, max: 220, interval: 0.12, drift: 0 });
        this.trails[key].add(_a.set(n[0], n[1], n[2] + 6).applyQuaternion(q).add(fm.pos), smoothstep(8500, 9500, fm.pos.y));
      });
    } else g.nozzles.forEach((n, i) => { const key = 'c' + i; if (this.trails[key]) { this.trails[key].stop(); this.trails[key] = null; } });
    // transonic vapour cone
    const m = fm.mach;
    if (m > 0.95 && m < 1.06 && fm.pos.y < 3000) {
      this.vaporT -= dt;
      if (this.vaporT <= 0) {
        this.vaporT = 0.02;
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2, r = this.radius * 0.35;
          const p = _a.set(Math.cos(a) * r, Math.sin(a) * r * 0.7, -1 + Math.random() * 2).applyQuaternion(q).add(fm.pos);
          fx.smoke.emit(p.x, p.y, p.z, fm.vel.x * 0.98, fm.vel.y * 0.98, fm.vel.z * 0.98, 0.18, 2.5, 4, 0.95, 0.95, 0.97, 0.35, 12, 0, 0, 0);
        }
      }
    }
    // spray when skimming the sea
    if (agl < 14 && fm.V > 90) {
      const s = this.game.world.surface(fm.pos.x, fm.pos.z, fm.pos.y);
      if (s.kind === 'water' && Math.random() < 0.6) fx.spray(_a.set(fm.pos.x + (Math.random() - 0.5) * 8, 0.4, fm.pos.z + (Math.random() - 0.5) * 8), _b.copy(fm.vel).multiplyScalar(0.1).setY(6 + Math.random() * 6), 3 * (1 - agl / 14) + 1, 1.8);
    }
  }
}
