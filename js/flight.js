// Flight model shared by the player and every AI pilot.
// Rigid body (6 DOF) with lift / induced + wave drag / side force / thrust / gravity, an engine that has to be started
// and spools with lag, a lift curve that stalls, landing gear springs with tyre friction and nose-wheel steering,
// and a stability-augmentation pitch law (g-command in the air, direct stick on the ground) limited by the aircraft's G.
// Body axes: x right, y up, -z forward. Positive omega.x = nose up, omega.y = nose left, omega.z = roll left.
import * as THREE from 'three';
import { G } from './config.js';
import { clamp, lerp, smoothstep, approach, DEG } from './util.js';

const V3 = THREE.Vector3;
const QREF = 0.5 * 1.225 * 150 * 150;
export const IDLE = 0.62;
export const AB_DETENT = 0.9;

export const airDensity = (h) => 1.225 * Math.exp(-Math.max(h, 0) / 8500);
export const speedOfSound = (h) => Math.max(295, 340.3 - 0.0041 * clamp(h, 0, 11000));

const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const _vb = new V3(), _right = new V3(), _up = new V3(), _fwd = new V3(), _vDir = new V3(), _lift = new V3();
const _F = new V3(), _T = new V3(), _tmp = new V3(), _tmp2 = new V3(), _rW = new V3(), _wv = new V3(), _wW = new V3();
const _gfwd = new V3(), _glat = new V3(), _Fi = new V3(), _rate = new V3(), _ax = new V3();
const UPW = new V3(0, 1, 0);

function wf(h) { return 0.15 + 0.85 * h; } // lift fraction of a wing at hp fraction h

export class FlightModel {
  constructor(def) {
    this.def = def;
    const g = def.geo;
    this.mass = def.mass;
    this.pos = new V3(); this.vel = new V3(); this.quat = new THREE.Quaternion(); this.omega = new V3();
    this.acc = new V3(0, 0, 0);
    this.inertia = new V3(def.inertia[0], def.inertia[1], def.inertia[2]);
    this.input = { pitch: 0, roll: 0, yaw: 0, brake: 0 };
    this.surf = { pitch: 0, roll: 0, yaw: 0 };
    this.surfRate = 3.4;     // full-deflection slew per second (keyboard feel)
    this.throttle = 0; this.rpm = 0; this.ab = 0;
    this.engine = 'off'; this.startT = 0; this.ignited = false;
    this.fuel = def.fuel;
    this.gear = 1; this.gearCmd = 1; this.flaps = 0; this.airbrake = 0; this.sweep = 0;
    this.dmg = { wingL: 1, wingR: 1, engine: 1, tail: 1, drag: 0, gearOk: true, wingLost: 0 };
    this.wheels = [
      { o: new V3(...g.gearNose), main: false, load: 0, comp: 0, contact: false },
      { o: new V3(-g.gearMain[0], g.gearMain[1], g.gearMain[2]), main: true, load: 0, comp: 0, contact: false },
      { o: new V3(g.gearMain[0], g.gearMain[1], g.gearMain[2]), main: true, load: 0, comp: 0, contact: false },
    ];
    const W = this.mass * G;
    this.kSpring = W / (3 * 0.16);
    this.cSpring = 2 * 0.55 * Math.sqrt(this.kSpring * this.mass / 3);
    this.onGround = false; this.airT = 0; this.gndT = 0; this.surface = null;
    this.alpha = 0; this.beta = 0; this.V = 0; this.mach = 0; this.gLoad = 1; this.stall = 0; this.buffet = 0; this.thrust = 0;
    this.alphaStall = 0.3; this.groundSpeed = 0; this.rho = 1.225; this.qd = 0;
    this.attached = null;    // { update(fm, dt) } while held by a catapult / parked
    this.arrest = null;      // { vel: V3, decel }
    this.events = [];
    this.wind = new V3();
    this.noise = Math.random() * 100;
    this.overG = 0;
  }

  get speedKmh() { return this.V * 3.6; }
  forward(out) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  up(out) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  right(out) { return out.set(1, 0, 0).applyQuaternion(this.quat); }

  startEngine() { if (this.engine === 'off' && this.fuel > 0 && this.dmg.engine > 0) { this.engine = 'starting'; this.startT = 0; this.ignited = false; this.events.push(['starter']); } }
  hotStart() { this.engine = 'running'; this.rpm = IDLE + (1 - IDLE) * Math.min(1, this.throttle / AB_DETENT); }

  _engine(dt, mach) {
    const E = this.def.engine;
    const cap = this.dmg.engine <= 0 ? 0 : 0.3 + 0.7 * this.dmg.engine;
    if (this.engine === 'off') {
      this.rpm = Math.max(0, this.rpm - dt * 0.08); this.ab = 0;
    } else if (this.engine === 'starting') {
      this.startT += dt;
      const t = this.startT;
      if (t < 2.6) this.rpm = approach(this.rpm, 0.24 * (t / 2.6), dt * 0.2);
      else {
        if (!this.ignited) { this.ignited = true; this.events.push(['ignition']); }
        this.rpm = approach(this.rpm, IDLE, dt * (0.06 + 0.05 * Math.min(1, (t - 2.6) / 1.5)));
      }
      if (this.rpm >= IDLE - 0.002) { this.engine = 'running'; this.events.push(['running']); }
    } else if (this.engine === 'running') {
      const cmd = Math.min(1, this.throttle / AB_DETENT) * cap;
      const target = IDLE + (1 - IDLE) * cmd;
      const tau = E.spool * (this.rpm < 0.8 ? 1.7 : 1.0) * (target < this.rpm ? 0.8 : 1);
      this.rpm += (target - this.rpm) * (1 - Math.exp(-dt / tau));
      const abWant = !E.noAB && this.throttle > AB_DETENT + 0.005 && this.rpm > 0.965 && cap > 0.85 ? (this.throttle - AB_DETENT) / (1 - AB_DETENT) : 0;
      this.ab = abWant > this.ab ? Math.min(abWant, this.ab + dt * 1.3) : Math.max(abWant, this.ab - dt * 3);
      const milFrac = clamp((this.rpm - 0.6) / 0.4, 0, 1);
      this.fuel -= (this.def.flowMil * (0.12 + 0.88 * milFrac) + this.def.flowAB * this.ab) * dt;
      if (this.fuel <= 0) { this.fuel = 0; this.engine = 'dead'; this.events.push(['flameout']); }
      if (this.dmg.engine <= 0) { this.engine = 'dead'; this.events.push(['flameout']); }
    } else { // dead: windmilling
      this.ab = 0;
      this.rpm += (Math.min(0.14, 0.1 + this.V / 2500) - this.rpm) * (1 - Math.exp(-dt / 4));
    }
    const milFrac = clamp((this.rpm - 0.6) / 0.4, 0, 1);
    let T = this.engine === 'running' || (this.engine === 'starting' && this.rpm > 0.5) ? E.thrustMil * (0.045 + 0.955 * Math.pow(milFrac, 1.6)) : 0;
    T += (E.thrustAB - E.thrustMil) * this.ab;
    const sigma = this.rho / 1.225;
    T *= Math.pow(sigma, 0.75) * Math.max(0.25, 1 - E.lapse * mach) * (1 + 0.16 * mach * this.ab);
    this.thrust = T;
  }

  // Lift coefficient for angle of attack a (rad): linear, rounded peak at stall, post-stall drop to a flat plate.
  liftCoeff(a, clA, clMax, as) {
    const s = a < 0 ? -1 : 1;
    let x = Math.abs(a);
    if (x > Math.PI / 2) x = Math.PI - x; // flying backwards
    const neg = s < 0;
    const asU = neg ? as * 0.8 : as, clm = neg ? clMax * 0.8 : clMax;
    const Dl = 2 * (asU - clm / clA), a1 = asU - Dl;
    let cl;
    if (x < a1) cl = clA * x;
    else if (x < asU) { const t = x - a1; cl = clA * a1 + clA * t - clA * t * t / (2 * Dl); }
    else {
      const post = x - asU;
      const plateau = clm * (1 - 0.34 * smoothstep(0, 0.15, post));
      cl = lerp(plateau, 1.12 * Math.sin(2 * x), smoothstep(0.14, 0.55, post));
    }
    return s * cl;
  }

  step(dt, env) {
    const def = this.def, ae = def.aero;
    // -- control surfaces slew like a real stick, no instant snapping
    const r = this.surfRate * dt;
    this.surf.pitch = approach(this.surf.pitch, clamp(this.input.pitch, -1, 1), r);
    this.surf.roll = approach(this.surf.roll, clamp(this.input.roll, -1, 1), r * 1.15);
    this.surf.yaw = approach(this.surf.yaw, clamp(this.input.yaw, -1, 1), r * 0.9);
    // -- gear and flaps (flaps come down with the gear at low speed)
    const gearRate = dt / 4.2;
    if (this.dmg.gearOk) this.gear = approach(this.gear, this.gearCmd, gearRate);
    const wantFlaps = this.gearCmd > 0.5 && this.V < 115 ? 1 : 0;
    this.flaps = approach(this.flaps, wantFlaps, dt / 2.5);
    this.airbrake = approach(this.airbrake, this.input.brake > 0.5 && !this.onGround ? 1 : 0, dt / 1.2);

    const q = this.quat;
    _qi.copy(q).invert();
    _right.set(1, 0, 0).applyQuaternion(q); _up.set(0, 1, 0).applyQuaternion(q); _fwd.set(0, 0, -1).applyQuaternion(q);

    // air data
    _tmp.copy(this.vel).sub(this.wind);
    const V = _tmp.length();
    this.V = V;
    this.rho = airDensity(this.pos.y);
    const a0 = speedOfSound(this.pos.y);
    this.mach = V / a0;
    if (ae.swing) {
      const want = this.gearCmd > 0.5 ? 0 : smoothstep(0.6, 1.02, this.mach);
      this.sweep = approach(this.sweep, want, dt * 0.35);
    }
    this._engine(dt, this.mach);

    if (this.attached) {
      this.attached.update(this, dt);
      this.alpha = 0; this.beta = 0; this.stall = 0; this.buffet = 0; this.gLoad = 1; this.onGround = true; this.airT = 0; this.gndT += dt;
      this.omega.set(0, 0, 0);
      this.V = this.vel.length();
      return;
    }

    _vb.copy(_tmp).applyQuaternion(_qi);
    let alpha = 0, beta = 0;
    if (V > 0.5) {
      alpha = Math.atan2(-_vb.y, -_vb.z);
      beta = Math.asin(clamp(_vb.x / V, -1, 1));
      _vDir.copy(_tmp).divideScalar(V);
    } else _vDir.copy(_fwd);
    this.alpha = alpha; this.beta = beta;
    const qd = 0.5 * this.rho * V * V;
    this.qd = qd;
    const qn = qd / QREF, qa = Math.min(qn, 2.2);

    // aerodynamic coefficients
    const sw = this.sweep;
    const k = lerp(ae.k, ae.kSwept || ae.k, sw);
    const clMax = lerp(ae.clMax, ae.clMaxSwept || ae.clMax, sw) + 0.14 * this.flaps;
    const S = ae.S * (1 - 0.06 * sw);
    const as = clMax / ae.clA + 2 * DEG;
    this.alphaStall = as;
    const wingF = 0.5 * (wf(this.dmg.wingL) + wf(this.dmg.wingR));
    const CL = this.liftCoeff(alpha, ae.clA, clMax, as) + 0.22 * this.flaps * (1 - this.stall);
    const ax = Math.abs(alpha);
    this.stall = smoothstep(as * 0.97, as * 1.12, ax) * (V > 8 ? 1 : 0);
    this.buffet = clamp(smoothstep(as * 0.8, as, ax) * 0.6 + this.stall, 0, 1) * smoothstep(20, 50, V);
    const M = this.mach;
    const wave = smoothstep(0.8, 1.02, M) * (1 - 0.42 * smoothstep(1.05, 1.9, M));
    const sinA = Math.sin(Math.min(ax, Math.PI / 2));
    const CD = ae.cd0 + this.dmg.drag + k * CL * CL + 0.024 * this.gear + 0.034 * this.flaps + 0.075 * this.airbrake
      + ae.cdWave * wave + 1.5 * sinA * sinA * smoothstep(as * 0.85, as * 1.35, ax) + 0.4 * Math.abs(Math.sin(beta));

    // forces
    _F.set(0, -this.mass * G, 0);
    if (V > 0.5) {
      _lift.crossVectors(_right, _vDir);
      const ll = _lift.length();
      if (ll > 1e-4) {
        _lift.divideScalar(ll).multiplyScalar(qd * S * CL * wingF);
        _F.add(_lift);
      }
      _F.addScaledVector(_vDir, -qd * S * CD);
      _F.addScaledVector(_right, -qd * S * 0.55 * Math.sin(beta));
    }
    _F.addScaledVector(_fwd, this.thrust);

    // flight-path rotation rate (velocity vector) in body axes
    _rate.set(0, 0, 0);
    if (V > 5) _rate.crossVectors(this.vel, this.acc).divideScalar(V * V);
    const gdx = _rate.dot(_right), gdy = _rate.dot(_up);

    // ---- moments (angular accelerations, body frame)
    const om = this.omega;
    const airBlend = smoothstep(0.0, 0.6, this.airT);
    const tailAuth = 0.3 + 0.7 * this.dmg.tail;
    const e = this.surf.pitch;
    const qS = Math.max(qd * S * wingF, 1);
    const nCmd = e >= 0 ? 1 + e * (ae.gMax - 1) : 1 + e * (1 + ae.gNeg);
    // AoA limiter: holds max-lift AoA at speed; when slow the wing can be pulled past critical AoA and stall
    const vs1g = Math.sqrt(this.mass * G / (0.5 * this.rho * S * clMax * wingF));
    const over = ae.alphaOver * DEG * (1 - smoothstep(1.15 * vs1g, 1.5 * vs1g, V));
    const clNeed = nCmd * this.mass * G / qS - 0.22 * this.flaps;
    const aAir = clNeed > clMax * 0.97 ? as * 0.985 + over : clamp(clNeed / ae.clA, -as * 0.8 - 0.04, as * 0.985 + over);
    this.vs1g = vs1g;
    const aGnd = e * as * 0.85;
    const aCmd = lerp(aGnd, aAir, airBlend);
    const sq = Math.sqrt(qa + 0.004);
    let dwx = ae.pitchK * qa * tailAuth * (aCmd - alpha) - ae.pitchD * sq * (om.x - gdx * airBlend);
    // thrust vectoring (F-22): the nozzles add pitch authority that does not need airspeed, so the nose can be held
    // and pointed even when slow, and a stall does not drop it as hard
    const tv = ae.tv ? clamp(this.thrust / this.def.engine.thrustAB, 0, 1) * airBlend : 0;
    if (tv > 0) dwx += 2.6 * tv * (aCmd - alpha) - 1.1 * tv * (om.x - gdx);
    dwx -= 2.4 * (1 - 0.6 * tv) * this.stall * Math.min(qa * 4, 1) * (alpha > 0 ? 1 : -1);
    // roll: rate command
    const pMax = ae.rollRate * DEG * clamp(Math.sqrt(qn / 0.5), 0.05 + 0.3 * tv, 1) * (1 - 0.65 * this.stall) * (qn > 2.6 ? 0.85 : 1);
    const pCmd = -this.surf.roll * pMax;
    let dwz = 5.5 * (pCmd - om.z) * Math.min(1, 0.06 + qa * 2.5);
    dwz += 1.6 * qa * beta;                                       // dihedral
    dwz += (wf(this.dmg.wingR) - wf(this.dmg.wingL)) * 3.2 * Math.min(qa, 1.6) * clamp(Math.abs(CL) / clMax + 0.25, 0, 1.3) * Math.sign(CL || 1);
    dwz += this.surf.yaw * -0.5 * qa;                             // rudder roll
    if (this.stall > 0.25) { this.noise += dt; dwz += Math.sin(this.noise * 2.3) * Math.sin(this.noise * 0.7 + 1) * 2.0 * this.stall * Math.min(1, qa * 5); }
    if (this.dmg.wingLost) dwz += this.dmg.wingLost * 4.5 * Math.min(1, qa * 2 + 0.2);
    // yaw: sideslip command with weathercock stability
    const bCmd = -this.surf.yaw * (10 * DEG) / (1 + qn * 1.4);
    let dwy = -ae.yawK * qa * tailAuth * (beta - bCmd) - ae.yawD * sq * (om.y - gdy * airBlend);

    // ---- landing gear
    _T.set(0, 0, 0);
    this.onGround = false;
    let anyContact = false;
    this.groundSpeed = 0;
    if (env && this.gear > 0.98 && this.dmg.gearOk) {
      const steer = -this.surf.yaw * (0.55 * (1 - smoothstep(4, 35, this.groundSpeedPrev || 0)) + 0.04);
      _wW.copy(om).applyQuaternion(q);
      for (let i = 0; i < 3; i++) {
        const w = this.wheels[i];
        _rW.copy(w.o).applyQuaternion(q);
        _tmp.copy(this.pos).add(_rW);
        const s = env.surface(_tmp.x, _tmp.z, _tmp.y);
        const comp = s.h - _tmp.y;
        w.contact = false; w.load = 0;
        if (comp <= 0 || s.kind === 'water' || comp > 3) { w.comp = 0; continue; }
        anyContact = true; w.contact = true; this.surface = s;
        _wv.crossVectors(_wW, _rW).add(this.vel);
        _wv.x -= s.vx; _wv.y -= s.vy; _wv.z -= s.vz;
        const compRate = -_wv.y;
        if (w.comp === 0 && compRate > 0.2) this.events.push(['touch', compRate, w.main, s.kind]);
        w.comp = comp;
        let Fn = this.kSpring * Math.min(comp, 0.5) + this.cSpring * compRate + (comp > 0.5 ? this.kSpring * 6 * (comp - 0.5) : 0);
        if (Fn < 0) Fn = 0;
        w.load = Fn;
        _gfwd.copy(_fwd); _gfwd.y = 0;
        if (_gfwd.lengthSq() < 1e-6) _gfwd.set(0, 0, -1);
        _gfwd.normalize();
        if (!w.main && steer !== 0) { const c = Math.cos(steer), sn = Math.sin(steer); const x = _gfwd.x, z = _gfwd.z; _gfwd.x = x * c + z * sn; _gfwd.z = -x * sn + z * c; }
        _glat.crossVectors(_gfwd, UPW);
        const vLong = _wv.dot(_gfwd), vLat = _wv.dot(_glat);
        if (w.main) this.groundSpeed = Math.max(this.groundSpeed, Math.abs(vLong));
        const mu = s.kind === 'grass' ? 0.55 : 0.8;
        const fLat = clamp(-vLat * this.mass * 5, -mu * Fn, mu * Fn);
        const roll = (s.kind === 'grass' ? 0.06 : 0.016) + (w.main ? this.input.brake * 0.62 : 0);
        const fLong = -Math.tanh(vLong / 0.35) * roll * Fn;
        _Fi.set(0, Fn, 0).addScaledVector(_gfwd, fLong).addScaledVector(_glat, fLat);
        _F.add(_Fi);
        _T.add(_tmp2.crossVectors(_rW, _Fi));
      }
    }
    this.groundSpeedPrev = this.groundSpeed;
    if (anyContact) { this.onGround = true; this.gndT += dt; this.airT = 0; } else { this.airT += dt; this.gndT = 0; this.surface = null; }

    // arresting wire
    if (this.arrest) {
      _tmp.copy(this.vel).sub(this.arrest.vel);
      const sp = _tmp.length();
      if (sp > 0.25) _F.addScaledVector(_tmp, -this.mass * Math.min(this.arrest.decel, sp / dt * 0.5) / sp);
    }

    // ---- integrate
    _tmp.copy(_T).applyQuaternion(_qi);
    dwx += _tmp.x / this.inertia.x; dwy += _tmp.y / this.inertia.y; dwz += _tmp.z / this.inertia.z;
    om.x += dwx * dt; om.y += dwy * dt; om.z += dwz * dt;
    const omL = om.length();
    if (omL > 7) om.multiplyScalar(7 / omL);
    if (omL > 1e-7) {
      _ax.copy(om).divideScalar(omL);
      _dq.setFromAxisAngle(_ax, omL * dt);
      q.multiply(_dq).normalize();
    }
    // felt load factor (everything except gravity, along body up)
    this.acc.copy(_F).divideScalar(this.mass);
    this.gLoad = _tmp.copy(_F).addScaledVector(UPW, this.mass * G).dot(_up) / (this.mass * G);
    this.vel.addScaledVector(this.acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    if (this.gLoad > this.def.aero.gMax * 1.25) this.overG += dt; else this.overG = Math.max(0, this.overG - dt * 0.5);
  }

  // advance with sub-steps (smaller near the ground for stable gear springs)
  update(dt, env, nearGround) {
    const h = nearGround ? 1 / 240 : 1 / 120;
    const n = Math.min(24, Math.max(1, Math.ceil(dt / h)));
    const sd = dt / n;
    for (let i = 0; i < n; i++) this.step(sd, env);
  }
}

// Performance numbers computed from the same aerodynamic/engine model (hangar stat panel).
export function measureAircraft(def) {
  const ae = def.aero, E = def.engine, alt = 1000;
  const rho = airDensity(alt), a0 = speedOfSound(alt);
  const W = def.mass * G;
  const fm = new FlightModel(def);
  fm.rho = rho; fm.engine = 'running'; fm.rpm = 1; fm.throttle = 1; fm.ab = E.noAB ? 0 : 1;
  const thrustAt = (V) => { fm._engine(0, V / a0); fm.engine = 'running'; fm.rpm = 1; fm.ab = E.noAB ? 0 : 1; fm.fuel = 1e9; return fm.thrust; };
  const sweepAt = (M) => (ae.swing ? smoothstep(0.6, 1.02, M) : 0);
  const coeffs = (V) => {
    const M = V / a0, sw = sweepAt(M);
    const k = lerp(ae.k, ae.kSwept || ae.k, sw), clMax = lerp(ae.clMax, ae.clMaxSwept || ae.clMax, sw), S = ae.S * (1 - 0.06 * sw);
    const wave = smoothstep(0.8, 1.02, M) * (1 - 0.42 * smoothstep(1.05, 1.9, M));
    return { k, clMax, S, cd0: ae.cd0 + ae.cdWave * wave, q: 0.5 * rho * V * V };
  };
  const excess = (V, n) => { const c = coeffs(V); const CL = n * W / (c.q * c.S); return thrustAt(V) - c.q * c.S * (c.cd0 + c.k * CL * CL); };
  // top speed: highest V with positive excess thrust at 1 G
  let top = 50;
  for (let V = 60; V < 800; V += 1) if (excess(V, 1) > 0) top = V;
  // acceleration 400 -> 900 km/h (capped near top speed)
  const v0 = 400 / 3.6, v1 = Math.min(900 / 3.6, top * 0.96);
  let t = 0;
  for (let V = v0; V < v1; V += 0.5) t += 0.5 / Math.max(excess(V, 1) / def.mass, 0.05);
  const accel = (v1 - v0) / t;
  // best sustained turn: max n with T = D, limited by CLmax and the G limit
  let best = 0, bestV = 0;
  for (let V = 70; V < top; V += 2) {
    const c = coeffs(V);
    const Tq = thrustAt(V) / (c.q * c.S);
    if (Tq <= c.cd0) continue;
    let n = Math.sqrt((Tq - c.cd0) / c.k) * c.q * c.S / W;
    n = Math.min(n, c.clMax * c.q * c.S / W, ae.gMax);
    if (n <= 1) continue;
    const w = G * Math.sqrt(n * n - 1) / V / DEG;
    if (w > best) { best = w; bestV = V; }
  }
  const vs = Math.sqrt(W / (0.5 * rho * ae.S * ae.clMax));
  return { topSpeed: top * 3.6, accel, turn: best, turnSpeed: bestV * 3.6, stall: vs * 3.6, tw: E.thrustAB / W };
}
