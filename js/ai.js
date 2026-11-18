// AI pilot. It only moves the stick, rudder and throttle of the same flight model the player uses, so it is bound
// by the same lift, drag, stall and G limits. It perceives enemies with a reaction delay, aims with human-like
// wandering error, manages energy, breaks and flares against missiles, jinks when someone is on its six,
// avoids terrain/buildings, and goes home to repair when badly hurt.
import * as THREE from 'three';
import { DIFFICULTY, WORLD } from './config.js';
import { AB_DETENT } from './flight.js';
import { clamp, lerp, DEG, RAD, noise2, smoothstep, wrapAngle } from './util.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _q = new THREE.Quaternion();

export class AIPilot {
  constructor(game, plane, diff = 'veteran') {
    this.game = game; this.p = plane; this.D = DIFFICULTY[diff] || DIFFICULTY.veteran;
    this.state = 'patrol'; this.t = Math.random() * 100; this.target = null; this.retarget = 0;
    this.seed = Math.random() * 1000;
    this.jinkT = 0; this.jinkDir = 1; this.flareT = 0; this.fireBurst = 0; this.missileWait = 4 + Math.random() * 4;
    this.wp = new V3(); this.cruiseAlt = 1800 + Math.random() * 2600;
    this.desiredSpeed = 230;
    this.rtb = false; this.lastSeen = -99;
    this.formation = null; // { leader, offset }
    this.pickWaypoint();
  }
  pickWaypoint() {
    // sweep the contested middle of the map, leaning toward the enemy side but staying out of their AA umbrellas
    const lean = this.p.team === 'navy' ? 1 : -1;
    for (let i = 0; i < 10; i++) {
      this.wp.set(WORLD.front + lean * 1200 + (Math.random() - 0.5) * 9000, this.cruiseAlt, (Math.random() - 0.5) * 20000);
      if (!this.aaDanger(this.wp, 1.05)) break;
    }
  }
  // how many live enemy AA mounts can reach this point (k scales their range)
  aaDanger(pt, k = 1) {
    let n = 0;
    const team = this.p.team, mounts = this.game.aa?.mounts;
    if (!mounts) return 0;
    for (const m of mounts) {
      if (!m.alive || m.team === team || m.type === 'ciws') continue;
      const r = m.S.range * k;
      const dx = pt.x - m.pos.x, dz = pt.z - m.pos.z;
      if (dx * dx + dz * dz < r * r) n++;
    }
    return n;
  }

  // perceived (delayed + extrapolated) target state
  perceive(t, out, outVel, outAcc) {
    const h = t.hist, delay = this.D.react;
    const now = this.game.time;
    let k = h.length - 1;
    for (let i = h.length - 1; i >= 0; i--) { if (now - h[i].t >= delay) { k = i; break; } }
    const s = h[k];
    if (!s) { out.copy(t.fm.pos); outVel.copy(t.fm.vel); outAcc?.set(0, 0, 0); return; }
    const p = h[Math.max(0, k - 3)];
    const age = now - s.t;
    if (outAcc) { if (p && s.t - p.t > 0.05) outAcc.copy(s.vel).sub(p.vel).divideScalar(s.t - p.t); else outAcc.set(0, 0, 0); }
    outVel.copy(s.vel);
    out.copy(s.pos).addScaledVector(s.vel, age);
    if (outAcc) { out.addScaledVector(outAcc, 0.5 * age * age); outVel.addScaledVector(outAcc, age); }
  }

  // Steering toward a world direction. Small errors: bank a little, push/pull and use rudder (no rolling inverted).
  // Big errors: bank-to-turn, rolling the lift vector onto the target and pulling. aggr 0..1 scales the pull.
  steer(dirW, aggr = 1, fine = false, maxBank = Math.PI) {
    const fm = this.p.fm;
    _q.copy(fm.quat).invert();
    const d = _a.copy(dirW).normalize().applyQuaternion(_q);
    const off = Math.acos(clamp(-d.z, -1, 1));
    const inp = fm.input;
    const right = _b.set(1, 0, 0).applyQuaternion(fm.quat), up = _c.set(0, 1, 0).applyQuaternion(fm.quat);
    const bank = Math.atan2(-right.y, up.y); // + = right wing down
    const lat = Math.atan2(d.x, -d.z), vert = Math.atan2(d.y, -d.z);
    if (off < 22 * DEG && d.z < 0) {
      const wantBank = clamp(lat * (fine ? 2.5 : 4.5), -1.25, 1.25);
      inp.roll = clamp((wantBank - bank) * 2.4 + fm.omega.z * 0.45, -1, 1);
      inp.pitch = clamp(vert * (fine ? 9 : 6) + Math.abs(lat) * Math.cos(bank) * 2.2, -0.6, 1) * (fine ? 1 : aggr);
      inp.yaw = clamp(lat * 5, -0.7, 0.7);
    } else {
      let rollErr = Math.atan2(d.x, d.y);
      // target below but not far off the nose: roll at most ~110 degrees rather than fully inverted
      if (d.y < 0 && off < 70 * DEG) rollErr = clamp(rollErr, -1.9, 1.9);
      if (maxBank < Math.PI) rollErr = clamp(bank + rollErr, -maxBank, maxBank) - bank;
      inp.roll = clamp(rollErr * 2.0 + fm.omega.z * 0.4, -1, 1);
      const pull = clamp(off * 2.2, 0, 1) * Math.max(0, Math.cos(rollErr)) + (Math.abs(rollErr) < 0.5 ? 0.15 : 0);
      inp.pitch = clamp(pull, -0.3, 1) * aggr;
      inp.yaw = clamp(lat * 0.6, -0.4, 0.4);
    }
    return off;
  }

  update(dt) {
    const p = this.p, fm = p.fm, game = this.game, world = game.world, D = this.D;
    if (!p.alive || p.ejected || p.parked) return;
    this.t += dt;
    p.ctrl.fire = false;
    const inp = fm.input;
    inp.brake = 0;
    // on the catapult / runway: run up and go
    if (p.state === 'catapult') { if (fm.engine !== 'running') fm.startEngine(); fm.throttle = 1; inp.pitch = 0; inp.roll = 0; return; }
    if (fm.onGround && fm.V < 90 && this.state !== 'landing') {
      if (fm.engine !== 'running') fm.startEngine();
      fm.throttle = 1; inp.roll = 0; inp.yaw = 0;
      inp.pitch = fm.V > (fm.vs1g || 75) * 1.25 ? 0.6 : 0;
      this.state = 'climbout';
      return;
    }
    const pos = fm.pos, vel = fm.vel, V = fm.V;
    const agl = pos.y - world.groundHeight(pos.x, pos.z);
    if (fm.gearCmd > 0.5 && agl > 60 && fm.vel.y > 0) fm.gearCmd = 0;
    // doomed? punch out
    if ((p.lost_wingL || p.lost_wingR || p.lost_tail || p.hpFrac('fuselage') < 0.12) && !p.ejected) {
      if (Math.random() < dt * (0.8 + D.skill)) { p.doEject(); return; }
    }
    // ---------- decide ----------
    this.retarget -= dt;
    if (this.retarget <= 0) { this.retarget = 1.2 + Math.random(); this.chooseTarget(); }
    const hurt = p.heavilyDamaged() || (p.missiles === 0 && p.gunAmmo + p.gunReserve < p.def.gun.box * 0.3) || fm.fuel < p.def.fuel * 0.12;
    if (hurt) this.rtb = true;
    const threatM = p.incoming.find((m) => m.target === p && !m.lost && m.pos.distanceTo(pos) < 6000);
    let mode = this.rtb ? 'rtb' : this.target ? 'engage' : 'patrol';
    if (threatM) mode = 'defendMissile';
    else {
      const six = this.onMySix();
      if (six && mode !== 'rtb') mode = 'defendGun';
      this.sixThreat = six;
    }
    if (this.state === 'climbout') { if (agl > 450 || this.t > 25) this.state = 'free'; else mode = 'climbout'; }
    this.mode = mode;

    // ---------- act ----------
    let dir = _c.set(0, 0, -1).applyQuaternion(fm.quat);
    let aggr = 0.6 + 0.4 * D.skill, fine = false, wantSpeed = 240, ab = false, maxBank = Math.PI;
    if (mode === 'climbout') {
      dir.set(dir.x, 0, dir.z).normalize().setY(0.35).normalize(); wantSpeed = 200; ab = true;
    } else if (mode === 'patrol') {
      this.aaCheck = (this.aaCheck || 0) - dt;
      if (this.aaCheck <= 0) { this.aaCheck = 1.5; if (this.aaDanger(this.wp, 1.05) || (this.aaDanger(pos, 0.95) && Math.random() < 0.5 + 0.5 * D.skill)) this.pickWaypoint(); }
      if (pos.distanceTo(this.wp) < 2500) this.pickWaypoint();
      dir.copy(this.wp).sub(pos).normalize(); aggr = 0.45; wantSpeed = 225; maxBank = 65 * DEG;
    } else if (mode === 'rtb') {
      const home = this.homePoint(_d);
      const dist = Math.hypot(home.x - pos.x, home.z - pos.z);
      dir.copy(home).sub(pos);
      dir.y = clamp((home.y - pos.y) / Math.max(dist, 1), -0.25, 0.25) * dist; dir.normalize();
      aggr = 0.5; wantSpeed = dist < 4000 ? 140 : 210; maxBank = 60 * DEG;
      if (dist < 3000 && pos.y < 900) { this.goParked(); return; }
    } else if (mode === 'engage') {
      const t = this.target;
      const tp = _d, tv = _b, ta = this._acc || (this._acc = new V3());
      this.perceive(t, tp, tv, ta);
      ta.clampLength(0, 90);
      const toT = tp.clone().sub(pos), dist = toT.length();
      // gun solution: lead the target and compensate drop, with wandering aim error
      const bv = p.def.gun.vel;
      const tof = dist / (bv + Math.max(0, vel.dot(toT) / dist));
      const lead = tp.clone().addScaledVector(tv, tof).addScaledVector(vel, -tof).addScaledVector(ta, 0.5 * tof * tof * D.skill).add(_a.set(0, 0.5 * 9.81 * tof * tof, 0));
      const errA = D.aimErr * DEG * (0.5 + 0.5 * Math.sin(this.t * 0.7 + this.seed));
      const ex = noise2(this.t * 0.9, this.seed) * errA * dist, ey = noise2(this.seed, this.t * 0.8) * errA * dist;
      const right = _a.set(1, 0, 0).applyQuaternion(fm.quat), up = new V3(0, 1, 0).applyQuaternion(fm.quat);
      lead.addScaledVector(right, ex).addScaledVector(up, ey);
      const useLead = dist < 1400;
      if (useLead) dir.copy(lead).sub(pos).normalize();
      else { const aimY = dist > 2500 ? Math.max(tp.y, Math.min(pos.y, tp.y + 800)) : tp.y; dir.set(tp.x - pos.x, aimY - pos.y, tp.z - pos.z).normalize(); }
      fine = useLead && dir.dot(this.p.fwd) > Math.cos(10 * DEG);
      aggr = 0.75 + 0.25 * D.skill;
      // close in, then match the target's speed at gun range instead of overshooting
      wantSpeed = clamp(tv.length() + (dist - 450) * 0.12, 160, 330);
      ab = dist > 1500 || V < 200;
      // fire control: short bursts when the pipper is on, no friendlies in the way
      const angle = Math.acos(clamp(dir.dot(this.p.fwd), -1, 1));
      const window = Math.max(Math.atan2(t.radius * 0.9, dist) + D.aimErr * DEG * 0.6, dist < 550 ? 2.4 * DEG : 0);
      if (useLead && dist < D.gunRange && angle < window && !this.friendlyInLine(dist)) {
        if (this.fireBurst <= 0 && Math.random() < dt * 6) this.fireBurst = 0.35 + Math.random() * 0.7;
      }
      if (this.fireBurst > 0) { this.fireBurst -= dt; p.ctrl.fire = true; }
      // missile when locked and in a sensible range
      this.missileWait -= dt;
      if (p.lock.state === 2 && p.lock.target === t && dist > 700 && dist < p.def.missile.lockRange * 0.85 && this.missileWait <= 0 && p.missiles > 0) {
        if (p.fireMissile()) this.missileWait = 7 + Math.random() * 8 / D.skill;
      }
      if (p.gunAmmo === 0 && p.gunReserve > 0) p.reload();
      this.lastSeen = this.t;
    } else if (mode === 'defendMissile') {
      const m = threatM;
      const los = _d.copy(m.pos).sub(pos).normalize();
      // beam the missile: turn perpendicular to it, diving if there is room
      const side = _a.crossVectors(los, new V3(0, 1, 0)).normalize();
      if (side.dot(this.p.fwd) < 0) side.negate();
      dir.copy(side).setY(agl > 1200 ? -0.35 : 0.1).normalize();
      aggr = 1; ab = true; wantSpeed = 320;
      const md = m.pos.distanceTo(pos);
      this.flareT -= dt;
      if (md < 2600 && this.flareT <= 0 && Math.random() < D.flareSkill + 0.2) { p.dropFlares(); this.flareT = 0.6 + Math.random() * 0.8; }
    } else if (mode === 'defendGun') {
      const att = this.sixThreat;
      this.jinkT -= dt;
      if (this.jinkT <= 0) { this.jinkT = 1.2 + Math.random() * 2; this.jinkDir = Math.random() < 0.5 ? -1 : 1; }
      const toA = _d.copy(att.fm.pos).sub(pos).normalize();
      const side = _a.crossVectors(this.p.fwd, new V3(0, 1, 0)).normalize().multiplyScalar(this.jinkDir);
      dir.copy(side).addScaledVector(toA, 0.5).addScaledVector(new V3(0, 1, 0), agl < 600 ? 0.6 : (Math.random() - 0.5) * 0.4).normalize();
      aggr = 1; ab = true; wantSpeed = 300;
      if (p.flares > 6 && Math.random() < dt * 0.5 * D.flareSkill) p.dropFlares();
    }

    // ---------- energy management: never pull into a stall ----------
    const vs = fm.vs1g || 70;
    if (V < vs * 1.7) { aggr *= clamp((V - vs * 1.15) / (vs * 0.55), 0.15, 1); ab = true; }
    if (V < vs * 1.25 && agl > 300) dir.y = Math.min(dir.y, -0.3), dir.normalize();

    // ---------- terrain / obstacle / boundary avoidance (overrides everything) ----------
    const look = clamp(V * 4.5, 400, 1500);
    const ahead = _a.copy(vel).normalize().multiplyScalar(look).add(pos);
    const clr = Math.max(world.clearance(ahead.x, ahead.z, 260), world.clearance(pos.x, pos.z, 200));
    const minAlt = clr + 180 + Math.max(0, -vel.y) * 4;
    if (pos.y < minAlt || ahead.y < minAlt) {
      const urg = clamp((minAlt - Math.min(pos.y, ahead.y)) / 250, 0, 1);
      dir.lerp(_b.set(this.p.fwd.x, 0, this.p.fwd.z).normalize().setY(0.7).normalize(), 0.5 + urg * 0.5).normalize();
      aggr = Math.max(aggr, 0.7 + 0.3 * urg); fine = false;
      if (fm.vel.y < -20 && agl < 900) aggr = 1;
    }
    if (Math.abs(pos.x) > WORLD.boundaryWarn - 500 || Math.abs(pos.z) > WORLD.boundaryWarn - 500) { dir.lerp(_b.set(-pos.x, 0, -pos.z).normalize(), 0.7).normalize(); }
    if (pos.y > WORLD.ceiling - 1500) dir.y = Math.min(dir.y, -0.1);

    this.steer(dir, aggr, fine, maxBank);
    // throttle
    const spdErr = wantSpeed - V;
    let thr = clamp(0.7 + spdErr * 0.02, 0.35, AB_DETENT);
    if (ab || spdErr > 40) thr = 1;
    fm.throttle = lerp(fm.throttle, thr, 1 - Math.exp(-dt * 2));
    if ((mode === 'rtb' || mode === 'engage') && V > wantSpeed + 30) inp.brake = 1;
  }

  homePoint(out) {
    if (this.p.team === 'navy') { const c = this.game.world.fleet.carrier; return out.set(c.pos.x, 500, c.pos.z); }
    const A = WORLD.airbase; return out.set(A.x - A.len / 2 - 2500, 450, A.z);
  }
  goParked() {
    // touches down and taxis to the hangar: removed from the sky, repaired, then relaunched by the match
    const p = this.p;
    p.parked = true; p.group.visible = false; p.state = 'parked';
    for (const k in p.trails) p.trails[k]?.stop();
    this.game.onAIParked?.(p);
  }
  onMySix() {
    const p = this.p, pos = p.fm.pos;
    for (const a of this.game.aircraft) {
      if (!a.alive || a.team === p.team || a.parked) continue;
      const d = _b.copy(pos).sub(a.fm.pos), dist = d.length();
      if (dist > 1600) continue;
      d.divideScalar(dist);
      if (d.dot(a.fwd) > 0.94 && d.dot(p.fwd) > 0.2) return a; // they point at me and are behind me
    }
    return null;
  }
  friendlyInLine(dist) {
    const p = this.p;
    for (const a of this.game.aircraft) {
      if (a === p || !a.alive || a.team !== p.team) continue;
      const d = _b.copy(a.fm.pos).sub(p.fm.pos), l = d.length();
      if (l < dist && d.dot(p.fwd) / l > 0.995) return true;
    }
    return false;
  }
  chooseTarget() {
    const p = this.p, pos = p.fm.pos;
    let best = null, bs = 1e12;
    const counts = new Map();
    for (const a of this.game.aircraft) if (a.ai?.target) counts.set(a.ai.target, (counts.get(a.ai.target) || 0) + 1);
    for (const a of this.game.aircraft) {
      if (!a.alive || a.team === p.team || a.parked || a.state === 'catapult' || a.ejected) continue;
      const d = a.fm.pos.distanceTo(pos);
      if (d > 11000) continue;
      const ang = 1 - _b.copy(a.fm.pos).sub(pos).normalize().dot(p.fwd);
      let score = d * (1 + ang * 0.8) * (1 + (counts.get(a) || 0) * 0.6);
      if (a.isPlayer) score *= 0.8;
      if (a === this.target) score *= 0.7; // stick with the current target
      const danger = this.aaDanger(a.fm.pos, 0.9); // experienced pilots won't chase into enemy flak
      if (danger) score *= 1 + danger * (0.6 + 2.4 * this.D.skill);
      if (score < bs) { bs = score; best = a; }
    }
    this.target = best;
  }
}
