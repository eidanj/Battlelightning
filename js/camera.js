// Camera rigs: cockpit (head moves with G, buffet shake, free look), cinematic chase, ejection follow,
// death cam, menu and hangar orbits.
import * as THREE from 'three';
import { clamp, damp, lerp, DEG } from './util.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

export class CameraRig {
  constructor(camera, ckCam) {
    this.cam = camera; this.ck = ckCam;
    this.mode = 'menu';
    this.look = { yaw: 0, pitch: 0 };
    this.chaseQ = new THREE.Quaternion(); this.chasePos = new V3(); this.chaseInit = false;
    this.orbit = { yaw: 0.8, pitch: 0.18, dist: 24, target: new V3(), auto: true };
    this.shake = 0; this.headOff = new V3();
    this.fovBase = 72; this.t = 0;
    this.focus = new V3();
    this.vel = new V3(); this._prev = new V3();
  }
  addShake(k) { this.shake = Math.min(1.5, this.shake + k); }

  freeLook(input, dt, enabled, invert) {
    const L = this.look;
    if (input.held('lookBack')) { L.yaw = damp(L.yaw, Math.PI * 0.88 * (L.yaw < 0 ? -1 : 1), 8, dt); L.pitch = damp(L.pitch, 0.25, 8, dt); return; }
    if ((enabled && input.mouse.right) || input.v?.look) {
      L.yaw = clamp(L.yaw - input.mouse.dx * 0.004, -2.7, 2.7);
      L.pitch = clamp(L.pitch - input.mouse.dy * 0.004 * (invert ? -1 : 1), -0.9, 1.45);
    } else { L.yaw = damp(L.yaw, 0, 4, dt); L.pitch = damp(L.pitch, 0, 4, dt); }
  }

  update(dt, ctx) {
    this.t += dt;
    const cam = this.cam;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const sh = this.shake * this.shake;
    if (this.mode === 'cockpit' && ctx.plane) {
      const p = ctx.plane, fm = p.fm;
      // head is pushed down by G, swayed by lateral acceleration and shaken by buffet
      const g = clamp(fm.gLoad - 1, -4, 8);
      const buf = fm.buffet * 0.006 + sh * 0.02 + (fm.onGround ? Math.min(fm.groundSpeed / 80, 1) * 0.0025 : 0);
      this.headOff.set((Math.random() - 0.5) * buf, -g * 0.011 + (Math.random() - 0.5) * buf, (Math.random() - 0.5) * buf * 0.5);
      const eye = _a.set(...p.def.geo.eye).add(this.headOff);
      cam.position.copy(eye).applyQuaternion(fm.quat).add(fm.pos);
      _q.setFromEuler(_e.set(this.look.pitch - 0.1, this.look.yaw, 0, 'YXZ'));
      cam.quaternion.copy(fm.quat).multiply(_q);
      cam.fov = damp(cam.fov, this.fovBase - clamp(g, 0, 8) * 0.6, 6, dt);
      p.freeLook.yaw = this.look.yaw; p.freeLook.pitch = this.look.pitch;
      this.focus.copy(fm.pos);
    } else if (this.mode === 'chase' && ctx.plane) {
      const p = ctx.plane, fm = p.fm;
      if (!this.chaseInit) { this.chaseQ.copy(fm.quat); this.chaseInit = true; }
      // lagged orientation for a cinematic feel, but quick enough to read the aircraft attitude
      this.chaseQ.slerp(fm.quat, 1 - Math.exp(-dt * 5));
      _q.setFromEuler(_e.set(this.look.pitch * 0.8 - 0.08, this.look.yaw, 0, 'YXZ'));
      const dist = p.def.geo.len * 1.15 + 9 + clamp(fm.V / 60, 0, 6);
      const off = _a.set(0, p.def.geo.len * 0.18 + 2.5, dist).applyQuaternion(_q).applyQuaternion(this.chaseQ);
      cam.position.copy(fm.pos).add(off);
      const s = ctx.world.surface(cam.position.x, cam.position.z, cam.position.y);
      if (cam.position.y < s.h + 2) cam.position.y = s.h + 2;
      const target = _b.copy(fm.pos).addScaledVector(p.fwd, 6);
      _q2.copy(this.chaseQ);
      const up = new V3(0, 1, 0).applyQuaternion(_q2);
      const m = new THREE.Matrix4().lookAt(cam.position, target, up);
      cam.quaternion.setFromRotationMatrix(m);
      cam.fov = damp(cam.fov, this.fovBase + clamp((fm.V - 150) / 25, 0, 10), 3, dt);
      this.focus.copy(fm.pos);
    } else if (this.mode === 'eject' && ctx.target) {
      const tp = ctx.target;
      this.orbit.yaw += dt * 0.12;
      const d = ctx.chute ? 16 : 10;
      cam.position.set(tp.x + Math.sin(this.orbit.yaw) * d, tp.y + (ctx.chute ? 3 : 2), tp.z + Math.cos(this.orbit.yaw) * d);
      cam.lookAt(tp.x, tp.y + (ctx.chute ? 1.5 : 0.5), tp.z);
      cam.fov = damp(cam.fov, 60, 3, dt);
      this.focus.copy(tp);
    } else if (this.mode === 'death' && ctx.target) {
      const tp = ctx.target;
      this.orbit.yaw += dt * 0.2;
      const d = 90;
      cam.position.set(tp.x + Math.sin(this.orbit.yaw) * d, Math.max(tp.y + 30, ctx.world.groundHeight(tp.x, tp.z) + 20), tp.z + Math.cos(this.orbit.yaw) * d);
      cam.lookAt(tp);
      this.focus.copy(tp);
    } else if ((this.mode === 'menu' || this.mode === 'hangar') && ctx.target) {
      const o = this.orbit;
      if (o.auto) o.yaw += dt * (this.mode === 'menu' ? 0.05 : 0.12);
      const tp = ctx.target;
      const d = o.dist;
      cam.position.set(tp.x + Math.sin(o.yaw) * Math.cos(o.pitch) * d, tp.y + Math.sin(o.pitch) * d, tp.z + Math.cos(o.yaw) * Math.cos(o.pitch) * d);
      if (ctx.minY != null) cam.position.y = Math.max(cam.position.y, ctx.minY);
      cam.lookAt(tp.x, tp.y + (this.mode === 'menu' ? 1.2 : 0.4), tp.z);
      cam.fov = damp(cam.fov, this.mode === 'menu' ? 46 : 40, 3, dt);
      this.focus.copy(tp);
    }
    if (sh > 0 && this.mode !== 'cockpit') { cam.position.x += (Math.random() - 0.5) * sh * 0.6; cam.position.y += (Math.random() - 0.5) * sh * 0.6; }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // the cockpit pass uses the same pose with a much closer near plane
    this.ck.position.copy(cam.position); this.ck.quaternion.copy(cam.quaternion); this.ck.fov = cam.fov; this.ck.aspect = cam.aspect;
    this.ck.updateProjectionMatrix(); this.ck.updateMatrixWorld();
    this.vel.copy(cam.position).sub(this._prev).divideScalar(Math.max(dt, 1e-3)); this._prev.copy(cam.position);
  }
}
