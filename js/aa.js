// Anti-aircraft defences: ship flak mounts and CIWS, ground flak and autocannon emplacements. Each mount picks
// targets in range, slews its turret at a finite rate, leads the target with imperfect prediction and fires timed
// flak shells or tracer streams. Mounts can be shot up and destroyed.
import * as THREE from 'three';
import { makeCIWS, makeTurret } from './ships.js';
import { WORLD } from './config.js';
import { clamp, DEG, noise2 } from './util.js';
import { coastX } from './terrain.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _q = new THREE.Quaternion();
const SPEC = {
  flak: { range: 3800, rate: 1.9, vel: 760, yawRate: 0.5, err: 1.6, hp: 260 },
  ciws: { range: 1900, rate: 0.016, vel: 1100, yawRate: 1.6, err: 0.5, hp: 140, burst: 1.4, dmg: 7, spread: 0.007 },
  gun: { range: 2700, rate: 0.11, vel: 1000, yawRate: 1.1, err: 0.8, hp: 180, burst: 2.0, dmg: 13, spread: 0.0045 },
};

export class AADefence {
  constructor(game) {
    this.game = game; this.mounts = [];
    const world = game.world;
    // ship mounts belong to the navy
    for (const s of world.fleet.ships) for (const m of s.aa) this.add(m.type, m.node, 'navy', s);
    // ground sites belong to the coastal wing
    const steel = new THREE.MeshStandardMaterial({ color: 0x5f6a55, roughness: 0.75, metalness: 0.3 });
    const sand = new THREE.MeshStandardMaterial({ color: 0x8d7f62, roughness: 1 });
    const sites = [...world.airbase.aaSites];
    const C = WORLD.city;
    sites.push([C.x0 + 500, C.z0 + 300, 'flak'], [C.x1 - 400, C.z0 + 600, 'gun'], [C.x0 + 900, C.z1 - 300, 'gun'], [C.x1 - 300, C.z1 - 500, 'flak'], [2900, -3000, 'gun']);
    for (const z of [-9000, 5000, 11000]) sites.push([coastX(z) + 1400, z, z === 5000 ? 'gun' : 'flak']);
    for (const [x, z, type] of sites) {
      const h = world.terrain.height(x, z);
      if (h < 1) continue;
      const g = new THREE.Group(); g.position.set(x, h, z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 1.1, 6, 16), sand); ring.rotation.x = Math.PI / 2; ring.position.y = 0.6; g.add(ring);
      const node = type === 'flak' ? makeTurret(steel, 2, 1.0) : makeCIWS(steel);
      node.position.y = 0.4; g.add(node);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      game.scene.add(g);
      this.add(type, node, 'coast', null);
    }
  }
  add(type, node, team, ship) {
    const S = SPEC[type];
    this.mounts.push({ type, node, team, ship, S, hp: S.hp, alive: true, target: null, scan: Math.random(), fireT: Math.random() * 2, burstT: 0, cool: 0,
      yaw: 0, pitch: 0.3, pos: new V3(), seed: Math.random() * 100, isGround: true, name: type === 'flak' ? 'Flak battery' : type === 'ciws' ? 'CIWS' : 'AA gun' });
  }
  hitTest(p0, p1, dmg, attacker) {
    const d = _b.copy(p1).sub(p0), L2 = d.lengthSq() || 1;
    for (const m of this.mounts) {
      if (!m.alive || (attacker && attacker.team === m.team)) continue;
      const t = clamp(_a.copy(m.pos).sub(p0).dot(d) / L2, 0, 1);
      const q = _c.copy(p0).addScaledVector(d, t);
      if (q.distanceToSquared(m.pos) < 20) { this.damage(m, dmg, attacker); return true; }
    }
    return false;
  }
  blast(p, r, dmg, attacker) {
    for (const m of this.mounts) { if (!m.alive || (attacker && attacker.team === m.team)) continue; const d = m.pos.distanceTo(p); if (d < r) this.damage(m, dmg * (1 - d / r), attacker); }
  }
  damage(m, dmg, attacker) {
    m.hp -= dmg;
    if (m.hp <= 0 && m.alive) {
      m.alive = false;
      this.game.fx.explosion(m.pos, 0.9);
      this.game.audio?.explosion(m.pos, 0.8);
      m.node.userData.pitch.rotation.x = -0.5; m.node.userData.yaw.rotation.z = 0.25;
      m.node.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.25); } });
      this.game.onAADestroyed?.(m, attacker);
    }
  }
  update(dt) {
    const game = this.game, planes = game.aircraft, W = game.weapons;
    if (game.tutorialSafe) return;
    for (const m of this.mounts) {
      m.node.userData.parentOfMuzzle.updateWorldMatrix(true, false);
      m.node.getWorldPosition(m.pos);
      if (!m.alive) { if (Math.random() < dt * 3) game.fx.puff(m.pos, _a.set(0, 5, 0), 3, 6, 0.08, 0.6, 3); continue; }
      const S = m.S;
      // target selection
      m.scan -= dt;
      if (m.scan <= 0) {
        m.scan = 0.6 + Math.random() * 0.4;
        let best = null, bd = S.range;
        for (const a of planes) {
          if (!a.alive || a.team === m.team || a.parked || a.state === 'catapult') continue;
          const d = a.fm.pos.distanceTo(m.pos);
          if (d < bd && a.fm.pos.y - m.pos.y > 25) { bd = d; best = a; }
        }
        if (best !== m.target) { m.target = best; m.cool = 0.8 + Math.random() * 0.8; } // reaction time on a new target
      }
      const t = m.target;
      if (!t || !t.alive) continue;
      m.cool -= dt;
      // lead with imperfect prediction
      const toT = _a.copy(t.fm.pos).sub(m.pos), dist = toT.length();
      if (dist > S.range) { m.target = null; continue; }
      const tof = dist / S.vel;
      const aim = _b.copy(t.fm.pos).addScaledVector(t.fm.vel, tof * (0.85 + 0.25 * noise2(game.time * 0.3, m.seed)));
      aim.y += 0.5 * 9.81 * tof * tof;
      const e = S.err * DEG * dist;
      aim.x += noise2(game.time * 0.7, m.seed + 3) * e; aim.y += noise2(m.seed + 5, game.time * 0.6) * e; aim.z += noise2(game.time * 0.5, m.seed + 9) * e;
      const dir = aim.sub(m.pos).normalize();
      // turret slew (convert to the mount's parent frame)
      const parentQ = m.node.getWorldQuaternion(_q).invert();
      const local = _c.copy(dir).applyQuaternion(parentQ);
      const wantYaw = Math.atan2(-local.x, -local.z), wantPitch = Math.asin(clamp(local.y, -1, 1));
      let dy = wantYaw - m.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      m.yaw += clamp(dy, -S.yawRate * dt, S.yawRate * dt);
      m.pitch += clamp(wantPitch - m.pitch, -S.yawRate * dt, S.yawRate * dt);
      m.node.userData.yaw.rotation.y = m.yaw - m.node.rotation.y * 0;
      m.node.userData.pitch.rotation.x = m.pitch;
      const aligned = Math.abs(dy) < 4 * DEG && Math.abs(wantPitch - m.pitch) < 4 * DEG;
      if (!aligned || m.cool > 0) continue;
      const muzzle = m.node.userData.muzzle.clone().applyMatrix4(m.node.userData.parentOfMuzzle.matrixWorld);
      m.fireT -= dt;
      if (m.type === 'flak') {
        if (m.fireT <= 0) {
          m.fireT = S.rate * (0.8 + Math.random() * 0.5);
          const v = _c.copy(dir).multiplyScalar(S.vel);
          W.fireFlak(m, muzzle, v, tof * (0.95 + Math.random() * 0.12));
          game.fx.glow(muzzle, 5, 0.08, 1, 0.8, 0.5, 1);
          game.fx.puff(muzzle, _a.copy(dir).multiplyScalar(8), 2.5, 2.5, 0.6, 0.5, 2);
          game.audio?.aaGun(muzzle, 'flak');
        }
      } else {
        // bursts of tracer fire
        m.burstT -= dt;
        if (m.burstT <= -1.2 - Math.random()) m.burstT = S.burst;
        if (m.burstT > 0) {
          while (m.fireT <= 0) {
            m.fireT += S.rate;
            const sp = S.spread;
            const d = _c.set(dir.x + (Math.random() - 0.5) * sp * 2, dir.y + (Math.random() - 0.5) * sp * 2, dir.z + (Math.random() - 0.5) * sp * 2).normalize();
            W.fireBullet(m, muzzle, d.multiplyScalar(S.vel), S.dmg, Math.random() < 0.3, m.team);
          }
          if (Math.random() < 0.5) game.fx.glow(muzzle, 2, 0.05, 1, 0.8, 0.5, 1);
          game.audio?.aaGun(muzzle, m.type);
        } else m.fireT = Math.max(m.fireT, 0);
      }
    }
  }
}
