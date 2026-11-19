// Weapons: ballistic cannon rounds (gravity, drag, travel time) drawn as tracer streaks, IR missiles with a seeker,
// proportional navigation, limited G, flare seduction and proximity fuze, flares, and timed flak shells.
import * as THREE from 'three';
import { MISSILE, FLAK } from './config.js';
import { makeMissileMesh } from './aircraftModels.js';
import { clamp, DEG } from './util.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _q = new THREE.Quaternion();

const trVert = /* glsl */`
attribute vec3 aHead; attribute vec3 aTail; attribute vec4 aCol;
varying vec4 vCol; varying vec2 vUv;
void main() {
  vec3 p = mix(aTail, aHead, position.y);
  vec3 dir = aHead - aTail;
  vec3 toCam = cameraPosition - p;
  vec3 side = normalize(cross(dir, toCam));
  float dist = length(toCam);
  float w = max(0.12, dist * 0.0016) * aCol.a;
  p += side * position.x * w;
  vCol = aCol; vUv = vec2(position.x, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const trFrag = /* glsl */`
varying vec4 vCol; varying vec2 vUv;
void main() { float e = 1.0 - abs(vUv.x) * 2.0; float a = e * e * (0.25 + 0.75 * vUv.y); gl_FragColor = vec4(vCol.rgb * a * 2.5, 0.0); }`;

export class Weapons {
  constructor(game) {
    this.game = game;
    const cap = 4000;
    this.cap = cap; this.n = 0;
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap);
    this.owner = new Array(cap); this.dmg = new Float32Array(cap); this.tracer = new Uint8Array(cap); this.prev = new Float32Array(cap * 3);
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
    quad.setIndex([0, 1, 2, 1, 3, 2]);
    g.index = quad.index; g.attributes.position = quad.attributes.position;
    this.aHead = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aTail = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aHead', this.aHead); g.setAttribute('aTail', this.aTail); g.setAttribute('aCol', this.aCol);
    g.instanceCount = 0;
    this.trGeo = g;
    this.trMesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: trVert, fragmentShader: trFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.trMesh.frustumCulled = false; this.trMesh.renderOrder = 10;
    game.scene.add(this.trMesh);
    this.missiles = []; this.flares = []; this.shells = [];
  }

  fireBullet(owner, p, v, dmg, tracer, team) {
    let i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.prev[i * 3] = p.x; this.prev[i * 3 + 1] = p.y; this.prev[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = 3.2; this.owner[i] = owner; this.dmg[i] = dmg; this.tracer[i] = tracer ? 1 : 0;
    this._team = team;
  }

  _remove(i) {
    const n = --this.n;
    if (i === n) return;
    for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[n * 3 + k]; this.vel[i * 3 + k] = this.vel[n * 3 + k]; this.prev[i * 3 + k] = this.prev[n * 3 + k]; }
    this.life[i] = this.life[n]; this.owner[i] = this.owner[n]; this.dmg[i] = this.dmg[n]; this.tracer[i] = this.tracer[n];
  }

  update(dt) {
    const G = this.game, world = G.world, planes = G.aircraft, fx = G.fx;
    // ---- bullets ----
    const H = this.aHead.array, T = this.aTail.array, C = this.aCol.array;
    let draw = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      const o = i * 3;
      const px = this.pos[o], py = this.pos[o + 1], pz = this.pos[o + 2];
      const k = Math.exp(-0.22 * dt);
      this.vel[o] *= k; this.vel[o + 1] = this.vel[o + 1] * k - 9.81 * dt; this.vel[o + 2] *= k;
      const nx = px + this.vel[o] * dt, ny = py + this.vel[o + 1] * dt, nz = pz + this.vel[o + 2] * dt;
      let dead = this.life[i] <= 0;
      // aircraft hits
      if (!dead) {
        const own = this.owner[i];
        for (const a of planes) {
          if (!a.alive || a === own || (own && own.team === a.team && !own.isGround)) continue;
          if (own && own.isGround && own.team === a.team) continue;
          const dx = a.fm.pos.x - nx, dy = a.fm.pos.y - ny, dz = a.fm.pos.z - nz;
          const r = a.radius + 40;
          if (dx * dx + dy * dy + dz * dz > r * r) continue;
          const hit = a.raycast(_a.set(px, py, pz), _b.set(nx, ny, nz));
          if (hit) { a.damage(hit.comp, this.dmg[i] * (hit.pilot ? 2.5 : 1), own, hit.point, 'gun'); if (hit.comp === 'engine' && Math.random() < 0.035 && !a.engineFire) { a.engineFire = true; a.say('ENGINE FIRE — land or eject!', 'bad', 3); } fx.spark(hit.point, _c.set(this.vel[o], this.vel[o + 1], this.vel[o + 2]).multiplyScalar(-0.02), 0.4, 0.8); fx.glow(hit.point, 2.2, 0.08, 1, 0.8, 0.5, 1); dead = true; break; }
        }
      }
      if (!dead && ny < 220 && G.aa && this.owner[i] && !this.owner[i].isGround && G.aa.hitTest(_a.set(px, py, pz), _b.set(nx, ny, nz), this.dmg[i], this.owner[i])) { dead = true; fx.spark(_b, _c.set(0, 6, 0), 0.4, 0.7); }
      if (!dead && ny < 2600) {
        const s = world.surface(nx, nz, ny);
        if (ny <= s.h) {
          dead = true;
          if (s.kind === 'water') fx.bulletSplash(_a.set(nx, 0, nz)); else fx.dust(_a.set(nx, s.h, nz));
        } else if (ny < 470) {
          const ob = world.obstacle(nx, ny, nz);
          if (ob) { dead = true; fx.spark(_a.set(nx, ny, nz), _b.set(0, 5, 0), 0.3, 0.5); fx.dust(_a); }
        }
      }
      if (dead) { this._remove(i); i--; continue; }
      this.prev[o] = px; this.prev[o + 1] = py; this.prev[o + 2] = pz;
      this.pos[o] = nx; this.pos[o + 1] = ny; this.pos[o + 2] = nz;
      // streak: tracers long & bright, ball rounds faint
      const len = this.tracer[i] ? 0.018 : 0.008;
      const d = draw * 3;
      H[d] = nx; H[d + 1] = ny; H[d + 2] = nz;
      T[d] = nx - this.vel[o] * len; T[d + 1] = ny - this.vel[o + 1] * len; T[d + 2] = nz - this.vel[o + 2] * len;
      const c = draw * 4;
      if (this.tracer[i]) { C[c] = 1.0; C[c + 1] = 0.55; C[c + 2] = 0.2; C[c + 3] = 1.0; } else { C[c] = 0.35; C[c + 1] = 0.3; C[c + 2] = 0.25; C[c + 3] = 0.5; }
      draw++;
    }
    this.trGeo.instanceCount = draw;
    this.aHead.needsUpdate = true; this.aTail.needsUpdate = true; this.aCol.needsUpdate = true;

    // ---- flares ----
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.t += dt; f.vel.y -= 9.81 * dt * 0.6; f.vel.multiplyScalar(Math.exp(-1.6 * dt)); f.pos.addScaledVector(f.vel, dt);
      fx.glow(f.pos, 3.5 + Math.random() * 1.5, 0.06, 1, 0.85, 0.6, 1);
      f.trail.add(f.pos, 1);
      if (f.t > f.life) { f.trail.stop(); this.flares.splice(i, 1); }
    }
    // ---- missiles ----
    for (let i = this.missiles.length - 1; i >= 0; i--) if (!this._missile(this.missiles[i], dt)) this.missiles.splice(i, 1);
    // ---- flak shells ----
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt; s.vel.y -= 9.81 * dt; s.pos.addScaledVector(s.vel, dt);
      if (s.t >= s.fuse) { this.flakBurst(s.pos, s.owner); this.shells.splice(i, 1); }
    }
  }

  flakBurst(p, owner) {
    const G = this.game;
    G.fx.flak(p);
    G.audio?.flak(p);
    for (const a of G.aircraft) {
      if (!a.alive || (owner && a.team === owner.team)) continue;
      const d = a.fm.pos.distanceTo(p);
      if (d < FLAK.burst) {
        const k = 1 - d / FLAK.burst;
        const comps = ['fuselage', 'wingL', 'wingR', 'engine', 'tail'];
        // shrapnel: several components take damage
        for (let n = 0; n < 3; n++) a.damage(comps[Math.floor(Math.random() * comps.length)], FLAK.dmg * k * (0.4 + Math.random() * 0.6) / 2, owner, p, 'flak');
      }
    }
  }
  fireFlak(owner, p, v, fuse) { this.shells.push({ pos: p.clone(), vel: v.clone(), t: 0, fuse, owner }); }

  // ---------------- missiles ----------------
  launchMissile(owner, target, slotMesh) {
    const G = this.game;
    const mesh = makeMissileMesh(owner.team);
    mesh.scale.setScalar(1.15);
    G.scene.add(mesh);
    const p = new V3(), q = owner.fm.quat;
    if (slotMesh) slotMesh.getWorldPosition(p); else p.copy(owner.fm.pos);
    const m = {
      owner, target, mesh, pos: p, vel: owner.fm.vel.clone().addScaledVector(_a.set(0, -1, 0).applyQuaternion(q), 6),
      t: 0, armed: false, prevDist: 1e9, minDist: 1e9, team: owner.team, lost: false,
      trail: G.fx.trail({ w0: 0.7, w1: 7, life: 9, alpha: 0.75, color: 0xe6e6e2, max: 260, interval: 0.035 }),
    };
    m.fwd = new V3(0, 0, -1).applyQuaternion(q);
    this.missiles.push(m);
    if (target && target.incoming) target.incoming.push(m);
    G.audio?.missileLaunch(p, owner.isPlayer);
    G.onMissileLaunched?.(m);
    return m;
  }
  _missile(m, dt) {
    const G = this.game, fx = G.fx, M = MISSILE;
    m.t += dt;
    const V = m.vel.length();
    // motor
    if (m.t < M.burn && m.t > 0.15) { m.vel.addScaledVector(m.fwd, M.accel * dt); fx.glow(_a.copy(m.pos).addScaledVector(m.fwd, -1.8), 2.4, 0.05, 1, 0.75, 0.45, 1); }
    if (m.t < M.burn + 0.4 && m.t > 0.12) m.trail.add(_a.copy(m.pos).addScaledVector(m.fwd, -1.7), m.t < M.burn ? 1 : Math.max(0, 1 - (m.t - M.burn) / 0.4));
    if (m.t >= M.burn + 0.4) m.trail.stop();
    // drag (more after burnout, more down low)
    const rho = Math.exp(-m.pos.y / 8500);
    m.vel.multiplyScalar(Math.exp(-(0.05 + 0.12 * rho) * dt * Math.max(V, 1) / 600));
    m.vel.y -= 9.81 * dt * 0.35;
    // seeker + proportional navigation
    const tgt = m.target;
    let tp = null, tv = null;
    if (tgt && !m.lost) {
      if (tgt.isFlare) { tp = tgt.pos; tv = tgt.vel; } else if (tgt.alive) { tp = tgt.fm.pos; tv = tgt.fm.vel; } else m.lost = true;
    }
    if (tp && m.t > 0.25) {
      const los = _b.copy(tp).sub(m.pos), dist = los.length();
      los.divideScalar(dist);
      if (Math.acos(clamp(los.dot(m.fwd), -1, 1)) > M.gimbal * DEG) m.lost = true;
      else {
        const rv = _c.copy(tv).sub(m.vel);
        const vc = -rv.dot(los);
        // proportional navigation: a = N * Vc * (lateral relative velocity / range)
        const acc = _d.copy(rv).addScaledVector(los, -rv.dot(los)).multiplyScalar(4.2 * Math.max(vc, 150) / Math.max(dist, 1));
        acc.addScaledVector(_a.set(0, 9.81 * 0.35, 0), 1);
        const maxA = M.maxG * 9.81 * clamp(V / 450, 0.25, 1);
        const al = acc.length(); if (al > maxA) acc.multiplyScalar(maxA / al);
        m.vel.addScaledVector(acc, dt);
        // proximity fuze
        if (dist < 9 || (m.minDist < 26 && dist > m.prevDist)) { this._detonate(m, tgt.isFlare ? null : tgt); return false; }
        m.minDist = Math.min(m.minDist, dist); m.prevDist = dist;
      }
    }
    // orient along velocity
    const vl = m.vel.length();
    if (vl > 1) m.fwd.copy(m.vel).divideScalar(vl);
    m.pos.addScaledVector(m.vel, dt);
    m.mesh.position.copy(m.pos);
    _q.setFromUnitVectors(_a.set(0, 0, -1), m.fwd); m.mesh.quaternion.copy(_q);
    // ground / water / timeout
    const s = G.world.surface(m.pos.x, m.pos.z, m.pos.y);
    if (m.pos.y <= s.h || m.t > M.life) {
      if (m.pos.y <= s.h) { if (s.kind === 'water') fx.splash(m.pos, 1); else fx.explosion(m.pos, 0.7); G.audio?.explosion(m.pos, 0.6); this._missed(m); }
      else this._detonate(m, null);
      this._cleanup(m); return false;
    }
    return true;
  }
  _detonate(m, tgt) {
    const G = this.game;
    G.aa?.blast(m.pos, 30, 300, m.owner);
    G.fx.explosion(m.pos, 0.8, { vel: m.vel.clone().multiplyScalar(0.2) });
    G.audio?.explosion(m.pos, 0.8);
    let best = null, bestK = 0;
    for (const a of G.aircraft) {
      if (!a.alive || a.team === m.team) continue;
      const d = a.fm.pos.distanceTo(m.pos);
      if (d < MISSILE.blast + a.radius) {
        // full effect within ~4 m of the airframe, half at ~14 m, never below a quarter inside the blast
        const gap = Math.max(0, d - a.radius * 0.6);
        const k = clamp(1 - Math.max(0, gap - 4) / 20, 0.25, 1);
        // blast + fragments spread over components, worst on the side facing the warhead
        const local = _a.copy(m.pos).sub(a.fm.pos).applyQuaternion(_q.copy(a.fm.quat).invert());
        const side = local.x > 0 ? 'wingR' : 'wingL';
        const aft = local.z > 2 ? 'engine' : 'fuselage';
        a.damage(aft, MISSILE.dmg * 0.5 * k, m.owner, m.pos, 'missile');
        a.damage(side, MISSILE.dmg * 0.45 * k, m.owner, m.pos, 'missile');
        a.damage(local.z > 3 ? 'tail' : 'fuselage', MISSILE.dmg * 0.3 * k, m.owner, m.pos, 'missile');
        if (k > bestK) { bestK = k; best = a; }
      }
    }
    if (m.owner?.isPlayer) {
      if (best) {
        const left = Math.round(best.combatHealth() * 100);
        G.hud?.message(best.alive ? `MISSILE HIT — ${best.def.short} · ${left}% left` : `MISSILE HIT — ${best.def.short} DOWN`, 'good', 3);
        G.hud?.hitMarker(!best.alive); G.audio?.hitMarker();
      } else this._missed(m);
    }
    this._cleanup(m);
  }
  // the player's missile came to nothing (a decoyed one was already reported when it went for the flare)
  _missed(m) { if (m.owner?.isPlayer && !m.decoyed && !m.reported) { m.reported = true; this.game.hud?.message('MISSILE MISSED', 'warn', 2.2); } }
  _cleanup(m) {
    m.trail.stop();
    this.game.scene.remove(m.mesh);
    if (m.target && m.target.incoming) { const k = m.target.incoming.indexOf(m); if (k >= 0) m.target.incoming.splice(k, 1); }
  }

  dropFlare(owner) {
    const G = this.game, q = owner.fm.quat;
    let decoy = null;
    for (let s = -1; s <= 1; s += 2) {
      const pos = owner.fm.pos.clone().addScaledVector(_a.set(s * 0.8, -0.8, 2).applyQuaternion(q), 1);
      const vel = owner.fm.vel.clone().multiplyScalar(0.85).add(_b.set(s * 12, -14, 10).applyQuaternion(q));
      const f = { isFlare: true, pos, vel, t: 0, life: 4.5, team: owner.team, owner, trail: G.fx.trail({ w0: 0.3, w1: 3.5, life: 4, alpha: 0.5, color: 0xdedede, max: 70, interval: 0.06 }) };
      this.flares.push(f);
      if (s < 0) decoy = f;
    }
    // decoy: one roll per salvo for each missile chasing this aircraft. Harder from behind and with the
    // afterburner lit; a missile that has seen through two salvos is locked on for good.
    for (const m of owner.incoming || []) {
      if (m.target !== owner || m.lost || (m.resisted || 0) >= 2) continue;
      const toMissile = _c.copy(m.pos).sub(owner.fm.pos).normalize();
      const aspect = toMissile.dot(_d.set(0, 0, 1).applyQuaternion(q)); // 1 = missile directly behind
      const p = 0.1 + 0.16 * (1 - Math.max(0, aspect)) + (owner.fm.ab > 0.1 ? -0.05 : 0.03);
      if (Math.random() < p) {
        m.target = decoy;
        if (m.owner?.isPlayer && !m.decoyed) { m.decoyed = true; G.hud?.message('MISSILE DECOYED — target dropped flares', 'warn', 2.6); }
      } else m.resisted = (m.resisted || 0) + 1;
    }
    G.audio?.flare(owner.isPlayer);
  }
}
