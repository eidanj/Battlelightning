// Visual effects: GPU-instanced billboard particles (lit smoke, additive fire / sparks / flashes, water spray),
// ribbon trails (missile smoke, contrails, wingtip vortices), explosions with light flashes, splashes, and
// physically falling burning debris.
import * as THREE from 'three';
import { TEX, makeCanvas, canvasTex } from './textures.js';
import { makeRng, clamp, lerp } from './util.js';

const pVert = /* glsl */`
attribute vec3 aPos; attribute vec4 aCol; attribute vec3 aMisc; // size, rot, tile
varying vec2 vUv; varying vec4 vCol;
void main() {
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  float c = cos(aMisc.y), s = sin(aMisc.y);
  mv.xy += mat2(c, -s, s, c) * position.xy * aMisc.x;
  gl_Position = projectionMatrix * mv;
  float t = aMisc.z;
  vUv = (uv + vec2(mod(t, 4.0), 3.0 - floor(t / 4.0))) * 0.25;
  vCol = aCol;
}`;
const pFragSmoke = /* glsl */`
uniform sampler2D uMap; varying vec2 vUv; varying vec4 vCol;
void main() { vec4 t = texture2D(uMap, vUv); float a = t.a * vCol.a; if (a < 0.003) discard; gl_FragColor = vec4(vCol.rgb * t.rgb * a, a);
  #include <colorspace_fragment>
}`;
const pFragAdd = /* glsl */`
uniform sampler2D uMap; varying vec2 vUv; varying vec4 vCol;
void main() { vec4 t = texture2D(uMap, vUv); float a = t.a * vCol.a; gl_FragColor = vec4(vCol.rgb * t.rgb * a, 0.0); }`;

class ParticleLayer {
  constructor(scene, cap, additive) {
    this.cap = cap; this.n = 0;
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3);
    this.age = new Float32Array(cap); this.life = new Float32Array(cap);
    this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap); this.rot = new Float32Array(cap); this.rv = new Float32Array(cap);
    this.col = new Float32Array(cap * 3); this.a0 = new Float32Array(cap); this.tile = new Float32Array(cap);
    this.drag = new Float32Array(cap); this.buoy = new Float32Array(cap); this.grav = new Float32Array(cap);
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index; g.attributes.position = q.attributes.position; g.attributes.uv = q.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aMisc', this.aMisc);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: TEX.particles } }, vertexShader: pVert, fragmentShader: additive ? pFragAdd : pFragSmoke,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 9 : 8;
    this.geo = g;
    scene.add(this.mesh);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, tile, drag = 0.5, buoy = 0, grav = 0) {
    let i = this.n;
    if (i >= this.cap) { i = Math.floor(Math.random() * this.cap); } else this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.rot[i] = Math.random() * 6.28; this.rv[i] = (Math.random() - 0.5) * 0.8;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.a0[i] = a; this.tile[i] = tile;
    this.drag[i] = drag; this.buoy[i] = buoy; this.grav[i] = grav;
  }
  update(dt) {
    let n = this.n;
    const P = this.aPos.array, C = this.aCol.array, M = this.aMisc.array;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { // swap-remove
        n--; this._copy(n, i); i--; continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k + (this.buoy[i] - this.grav[i]) * dt; this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.rot[i] += this.rv[i] * dt;
      const t = this.age[i] / this.life[i];
      const size = lerp(this.s0[i], this.s1[i], Math.sqrt(t));
      const a = this.a0[i] * Math.min(1, t * 12) * (1 - t) * (1 - t * 0.3);
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      C[i * 4] = this.col[i * 3]; C[i * 4 + 1] = this.col[i * 3 + 1]; C[i * 4 + 2] = this.col[i * 3 + 2]; C[i * 4 + 3] = a;
      M[i * 3] = size; M[i * 3 + 1] = this.rot[i]; M[i * 3 + 2] = this.tile[i];
    }
    this.n = n;
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aMisc.needsUpdate = true;
    this.aPos.addUpdateRange(0, n * 3); this.aCol.addUpdateRange(0, n * 4); this.aMisc.addUpdateRange(0, n * 3);
  }
  _copy(src, dst) {
    for (let k = 0; k < 3; k++) { this.p[dst * 3 + k] = this.p[src * 3 + k]; this.v[dst * 3 + k] = this.v[src * 3 + k]; this.col[dst * 3 + k] = this.col[src * 3 + k]; }
    this.age[dst] = this.age[src]; this.life[dst] = this.life[src]; this.s0[dst] = this.s0[src]; this.s1[dst] = this.s1[src];
    this.rot[dst] = this.rot[src]; this.rv[dst] = this.rv[src]; this.a0[dst] = this.a0[src]; this.tile[dst] = this.tile[src];
    this.drag[dst] = this.drag[src]; this.buoy[dst] = this.buoy[src]; this.grav[dst] = this.grav[src];
  }
}

// ---------------- ribbon trails ----------------
function ribbonTexture() {
  const w = 64, h = 256, { c, g } = makeCanvas(w, h), r = makeRng(3);
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const y = r() * h, x = w / 2 + (r() - 0.5) * w * 0.5, rad = 6 + r() * 16;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  return canvasTex(c);
}
const ribVert = /* glsl */`attribute float aA; varying float vA; varying vec2 vUv; void main(){ vA = aA; vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const ribFrag = /* glsl */`uniform sampler2D uMap; uniform vec3 uColor; varying float vA; varying vec2 vUv;
  void main(){ float a = texture2D(uMap, vUv).a * vA; if (a < 0.003) discard; gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
  }`;

export class Trail {
  constructor(fx, o) {
    this.fx = fx; this.max = o.max ?? 160; this.life = o.life ?? 6; this.w0 = o.w0 ?? 0.6; this.w1 = o.w1 ?? 6; this.alpha = o.alpha ?? 0.7;
    this.interval = o.interval ?? 0.04; this.t = 0; this.pts = []; this.alive = true; this.emitting = true;
    const n = this.max * 2;
    this.pos = new Float32Array(n * 3); this.a = new Float32Array(n); this.uv = new Float32Array(n * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < this.max - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    g.setIndex(idx); g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({ uniforms: { uMap: { value: fx.ribTex }, uColor: { value: new THREE.Color(o.color ?? 0xe8e8e8) } }, vertexShader: ribVert, fragmentShader: ribFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
    fx.scene.add(this.mesh);
    this.drift = o.drift ?? 0.6;
  }
  add(p, strength = 1) {
    if (!this.emitting) return;
    this.t -= this.fx.dt;
    if (this.t > 0 && this.pts.length) { const q = this.pts[this.pts.length - 1]; q.x = p.x; q.y = p.y; q.z = p.z; return; }
    this.t = this.interval;
    this.pts.push({ x: p.x, y: p.y, z: p.z, age: 0, s: strength, v: Math.random() * 0.3 });
    if (this.pts.length > this.max) this.pts.shift();
  }
  stop() { this.emitting = false; }
  update(dt, cam) {
    const pts = this.pts;
    for (const q of pts) { q.age += dt; q.y += this.drift * dt; }
    while (pts.length && pts[0].age > this.life) pts.shift();
    if (!this.emitting && !pts.length) { this.alive = false; this.fx.scene.remove(this.mesh); this.geo.dispose(); return; } // material kept: disposing the last one frees its shader, and the next trail would recompile it
    const n = pts.length;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const q = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const vx = q.x - cam.x, vy = q.y - cam.y, vz = q.z - cam.z;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const t = q.age / this.life, w = lerp(this.w0, this.w1, Math.sqrt(t)) / sl * 0.5;
      const k = i * 2;
      this.pos[k * 3] = q.x + sx * w; this.pos[k * 3 + 1] = q.y + sy * w; this.pos[k * 3 + 2] = q.z + sz * w;
      this.pos[k * 3 + 3] = q.x - sx * w; this.pos[k * 3 + 4] = q.y - sy * w; this.pos[k * 3 + 5] = q.z - sz * w;
      const al = this.alpha * q.s * (1 - t) * (1 - t) * Math.min(1, (n - 1 - i) * 0.5 + 0.3);
      this.a[k] = al; this.a[k + 1] = al;
      v += i ? Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z) / 60 : 0;
      this.uv[k * 2] = 0; this.uv[k * 2 + 1] = v + q.v; this.uv[k * 2 + 2] = 1; this.uv[k * 2 + 3] = v + q.v;
    }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aA.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, quality = 1, ocean = null) {
    this.scene = scene; this.q = quality; this.ocean = ocean; this.dt = 0.016;
    this.smoke = new ParticleLayer(scene, Math.round(7000 * quality), false);
    this.fire = new ParticleLayer(scene, Math.round(4000 * quality), true);
    this.ribTex = ribbonTexture();
    this.trails = [];
    // explosion flash lights: a fixed pool that is always in the scene (intensity 0 when idle). Never toggle
    // their visibility: a change in the light count forces three.js to recompile every lit shader (a multi-second freeze)
    this.lights = Array.from({ length: 2 }, () => { const l = new THREE.PointLight(0xffa050, 0, 600, 1.6); l.position.set(0, -5000, 0); scene.add(l); return { l, t: 1, life: 1, i0: 0, on: false }; });
    this.debris = [];
    this.sunLight = 1;
  }
  trail(o) { const t = new Trail(this, o); this.trails.push(t); return t; }
  // lit grey smoke puff
  puff(p, v, size, life, shade = 0.6, alpha = 0.6, grow = 3) { const s = shade * this.sunLight; this.smoke.emit(p.x, p.y, p.z, v.x, v.y, v.z, life, size, size * grow, s, s, s * 1.02, alpha, Math.floor(Math.random() * 8), 0.6, 1.2, 0); }
  fireball(p, v, size, life, alpha = 1) { this.fire.emit(p.x, p.y, p.z, v.x, v.y, v.z, life, size, size * 2.2, 1.0, 0.62, 0.3, alpha, 8 + (Math.random() < 0.5 ? 1 : 0), 1.2, 2, 0); }
  glow(p, size, life, r = 1, g = 0.8, b = 0.5, a = 1) { this.fire.emit(p.x, p.y, p.z, 0, 0, 0, life, size, size * 0.9, r, g, b, a, 10, 0, 0, 0); }
  spark(p, v, life = 0.8, size = 0.5) { this.fire.emit(p.x, p.y, p.z, v.x, v.y, v.z, life, size, size * 0.3, 1, 0.75, 0.4, 1, 11, 0.3, 0, 9.8); }
  spray(p, v, size, life) { const s = 0.85 * this.sunLight; this.smoke.emit(p.x, p.y, p.z, v.x, v.y, v.z, life, size, size * 2.5, s, s, s * 1.03, 0.85, 12 + (Math.random() < 0.5 ? 1 : 0), 1.0, 0, 9.8); }
  flash(p, intensity, range, life = 0.35) {
    const L = this.lights.find((x) => !x.on) || this.lights.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    L.l.position.copy(p); L.l.distance = range; L.i0 = intensity; L.l.intensity = intensity; L.t = 0; L.life = life; L.on = true;
  }

  explosion(p, size = 1, opts = {}) {
    const n = Math.round(14 * this.q * size + 6), V = new THREE.Vector3();
    this.glow(p, 40 * size, 0.18, 1, 0.9, 0.7, 1);
    for (let i = 0; i < n; i++) {
      V.set(Math.random() - 0.5, Math.random() - 0.4, Math.random() - 0.5).normalize().multiplyScalar(12 * size * (0.3 + Math.random()));
      if (opts.vel) V.addScaledVector(opts.vel, 0.4);
      this.fireball(p, V, 6 * size * (0.6 + Math.random() * 0.6), 0.5 + Math.random() * 0.7);
    }
    for (let i = 0; i < n * 1.4; i++) {
      V.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(14 * size);
      if (opts.vel) V.addScaledVector(opts.vel, 0.25);
      this.puff(_p.copy(p).addScaledVector(V, 0.15), V, 7 * size, 4 + Math.random() * 5, 0.12 + Math.random() * 0.12, 0.85, 2.6);
    }
    for (let i = 0; i < n * 1.5; i++) { V.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(40 + Math.random() * 60 * size); this.spark(p, V, 0.8 + Math.random() * 1.5, 0.6 + size * 0.3); }
    this.flash(p, 400 * size, 300 * size, 0.6);
  }
  flak(p) {
    this.glow(p, 14, 0.12, 1, 0.8, 0.5, 1);
    const V = new THREE.Vector3();
    for (let i = 0; i < 6; i++) { V.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6); this.smoke.emit(p.x, p.y, p.z, V.x, V.y, V.z, 6 + Math.random() * 3, 7, 17, 0.06, 0.06, 0.065, 0.9, Math.floor(Math.random() * 8), 0.8, 0.2, 0); }
    for (let i = 0; i < 8; i++) { V.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(80); this.spark(p, V, 0.4, 0.4); }
  }
  splash(p, size = 1) {
    const V = new THREE.Vector3();
    const n = Math.round(10 * size * this.q + 4);
    for (let i = 0; i < n; i++) { V.set((Math.random() - 0.5) * 6 * size, (10 + Math.random() * 22) * Math.sqrt(size), (Math.random() - 0.5) * 6 * size); this.spray(_p.set(p.x + (Math.random() - 0.5) * 3 * size, 0.5, p.z + (Math.random() - 0.5) * 3 * size), V, 3 * size, 1.6 + Math.random() * 1.6); }
    for (let i = 0; i < n / 2; i++) { V.set((Math.random() - 0.5) * 10 * size, 2 + Math.random() * 3, (Math.random() - 0.5) * 10 * size); this.puff(_p.set(p.x, 1, p.z), V, 5 * size, 3, 0.9, 0.35, 3); }
    if (this.ocean) this.ocean.ring(p.x, p.z, 14 * size, 8);
  }
  bulletSplash(p) {
    const V = new THREE.Vector3((Math.random() - 0.5) * 2, 9 + Math.random() * 7, (Math.random() - 0.5) * 2);
    this.spray(_p.set(p.x, 0.3, p.z), V, 1.0, 1.0);
    if (Math.random() < 0.3 && this.ocean) this.ocean.ring(p.x, p.z, 3, 3);
  }
  dust(p) {
    const V = new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3);
    this.smoke.emit(p.x, p.y + 0.5, p.z, V.x, V.y, V.z, 2.5, 1.5, 6, 0.45, 0.4, 0.33, 0.6, Math.floor(Math.random() * 8), 1.5, 0, 0);
    this.spark(p, V.multiplyScalar(4), 0.25, 0.3);
  }
  // burning wreckage piece: falls with tumbling, trails smoke & fire, explodes / splashes on impact
  addDebris(obj, pos, vel, spin, opts = {}) {
    this.scene.add(obj);
    obj.position.copy(pos);
    this.debris.push({ obj, vel: vel.clone(), spin: spin.clone(), t: 0, fire: opts.fire ?? true, life: opts.life ?? 40, ground: opts.ground, landed: false, smokeT: 0 });
  }

  update(dt, cam, world) {
    this.dt = dt;
    this.smoke.update(dt); this.fire.update(dt);
    for (let i = this.trails.length - 1; i >= 0; i--) { const t = this.trails[i]; t.update(dt, cam); if (!t.alive) this.trails.splice(i, 1); }
    for (const L of this.lights) if (L.on) { L.t += dt; const k = 1 - L.t / L.life; if (k <= 0) { L.on = false; L.l.intensity = 0; } else L.l.intensity = L.i0 * k * k; }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      if (!d.landed) {
        d.vel.y -= 9.81 * dt; d.vel.multiplyScalar(Math.exp(-0.08 * dt));
        d.obj.position.addScaledVector(d.vel, dt);
        d.obj.rotation.x += d.spin.x * dt; d.obj.rotation.y += d.spin.y * dt; d.obj.rotation.z += d.spin.z * dt;
        d.smokeT -= dt;
        if (d.fire && d.smokeT <= 0) {
          d.smokeT = 0.05 / this.q;
          this.puff(d.obj.position, _v.set((Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2), 3, 5, 0.1, 0.8, 3);
          if (Math.random() < 0.7) this.fireball(d.obj.position, _v.set(0, 1, 0), 2.2, 0.4, 0.9);
        }
        if (world) {
          const s = world.surface(d.obj.position.x, d.obj.position.z, d.obj.position.y);
          if (d.obj.position.y <= s.h) {
            d.landed = true;
            if (s.kind === 'water') { this.splash(d.obj.position, 1.2); d.sink = true; }
            else { this.explosion(d.obj.position, 0.6); d.obj.position.y = s.h; }
            d.landT = d.t;
          }
        }
      } else {
        if (d.sink) d.obj.position.y -= dt * 2;
        else if (d.fire && d.t - d.landT < 25) { d.smokeT -= dt; if (d.smokeT <= 0) { d.smokeT = 0.12; this.puff(d.obj.position, _v.set(0, 4, 0), 4, 8, 0.08, 0.7, 4); } }
      }
      if (d.t > d.life || (d.sink && d.t - d.landT > 8)) { this.scene.remove(d.obj); this.debris.splice(i, 1); }
    }
  }
}
const _p = new THREE.Vector3(), _v = new THREE.Vector3();
