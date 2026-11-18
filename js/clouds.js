// Cumulus clouds built from thousands of lit, depth-sorted billboard puffs: flat dark bases, sunlit tops,
// silver lining toward the sun, haze with distance, and a soft fade so you can fly straight through them.
import * as THREE from 'three';
import { TEX } from './textures.js';
import { makeRng, smoothstep, clamp } from './util.js';

const vert = /* glsl */`
attribute vec3 aPos;
attribute vec4 aData; // scale, sunlit, heightFrac, tile
attribute float aRot;
uniform float uTime;
varying vec2 vUv;
varying vec3 vData;
varying float vDist;
varying vec3 vDir;
varying vec2 vQ;
void main() {
  vQ = position.xy;
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  float c = cos(aRot), s = sin(aRot);
  vec2 q = mat2(c, -s, s, c) * position.xy * aData.x;
  mv.xy += q;
  vDist = -mv.z;
  vec3 wp = aPos;
  vDir = normalize(wp - cameraPosition);
  gl_Position = projectionMatrix * mv;
  float t = aData.w;
  vUv = (uv + vec2(mod(t, 2.0), floor(t / 2.0))) * 0.5;
  vData = aData.yzx;
}`;
const frag = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uSun, uSky, uShadow, uFogColor, uSunDir;
uniform float uFogDensity, uOpacity;
uniform vec3 uSunView;
varying vec2 vQ;
varying vec2 vUv;
varying vec3 vData;
varying float vDist;
varying vec3 vDir;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * uOpacity;
  a *= smoothstep(25.0, 220.0, vDist);
  if (a < 0.004) discard;
  float lit = vData.x, hf = vData.y;
  // spherical pseudo-normal per puff for soft volumetric shading
  float rr = clamp(dot(vQ, vQ), 0.0, 1.0);
  vec3 n = normalize(vec3(vQ, sqrt(1.0 - rr) + 0.2));
  float ndl = clamp(dot(n, uSunView) * 0.5 + 0.5, 0.0, 1.0);
  float shade = clamp(lit * 0.75 + ndl * 0.3, 0.0, 1.0) * (0.5 + 0.5 * hf);
  vec3 col = mix(uShadow, uSky, 0.25 + 0.5 * hf);
  col += uSun * shade * 1.15;
  float fwd = pow(max(dot(vDir, uSunDir), 0.0), 6.0);
  col += uSun * fwd * (1.0 - t.a) * 1.4;
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist * 0.7);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Clouds {
  constructor(atmo, density = 1, seed = 5) {
    this.atmo = atmo;
    const r = makeRng(seed);
    const puffs = [];
    this.volumes = [];
    const nClouds = Math.round(70 * density);
    const sun = atmo.sunDir;
    for (let c = 0; c < nClouds; c++) {
      const cx = r.range(-24000, 26000), cz = r.range(-24000, 24000);
      const big = r() < 0.15;
      const base = r.range(1500, 2300), R = big ? r.range(900, 1500) : r.range(380, 950), H = R * (big ? r.range(0.9, 1.4) : r.range(0.35, 0.7));
      this.volumes.push({ x: cx, y: base + H * 0.45, z: cz, rx: R * 1.05, ry: H * 0.62, rz: R * 1.05 });
      const n = Math.round((14 + R / 22) * (big ? 1.4 : 1));
      for (let i = 0; i < n; i++) {
        // dome distribution: flat base, rounded top
        const a = r() * Math.PI * 2, d = Math.sqrt(r()), hf = Math.pow(r(), 0.8) * (1 - d * d * 0.7);
        const px = cx + Math.cos(a) * d * R, pz = cz + Math.sin(a) * d * R * 0.85, py = base + hf * H + 40;
        const size = (R * 0.36) * (0.6 + r() * 0.7) * (1 - hf * 0.3);
        const nx = (px - cx) / R, ny = (py - base - H * 0.35) / Math.max(H, 1), nz = (pz - cz) / R;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const lit = clamp(0.5 + 0.5 * ((nx * sun.x + ny * sun.y + nz * sun.z) / nl), 0, 1) * (0.35 + 0.65 * hf);
        puffs.push([px, py, pz, size, lit, hf, Math.floor(r() * 4), r() * 6.28]);
      }
      // flat dark base layer
      for (let i = 0; i < Math.round(R / 120); i++) { const a = r() * 6.28, d = Math.sqrt(r()) * R * 0.8; puffs.push([cx + Math.cos(a) * d, base + 60, cz + Math.sin(a) * d * 0.85, R * 0.45, 0.05, 0, Math.floor(r() * 4), r() * 6.28]); }
    }
    this.n = puffs.length;
    this.src = puffs;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    this.aPos = new Float32Array(this.n * 3); this.aData = new Float32Array(this.n * 4); this.aRot = new Float32Array(this.n);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(this.aData, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.InstancedBufferAttribute(this.aRot, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = this.n;
    this.geo = g;
    this.uniforms = {
      uMap: { value: TEX.cloud }, uSun: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uShadow: { value: new THREE.Color() },
      uFogColor: { value: atmo.fog.color }, uFogDensity: { value: atmo.fog.density }, uSunDir: { value: atmo.sunDir }, uOpacity: { value: 0.9 }, uTime: { value: 0 }, uSunView: { value: new THREE.Vector3(0, 1, 0) },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.order = new Uint32Array(this.n).map((_, i) => i);
    this.dist = new Float32Array(this.n);
    this.sortT = 0;
    this.setColors();
    this.sort(new THREE.Vector3());
  }
  setColors() {
    const a = this.atmo, el = Math.max(0.02, a.sunDir.y);
    this.uniforms.uSun.value.copy(a.sun.color).multiplyScalar(0.55 * Math.min(1, el * 3 + 0.2));
    this.uniforms.uSky.value.copy(a.horizon).multiplyScalar(0.75);
    this.uniforms.uShadow.value.copy(a.horizon).multiplyScalar(0.3).lerp(new THREE.Color(0.12, 0.14, 0.18), 0.45);
  }
  sort(cam) {
    const s = this.src, d = this.dist;
    for (let i = 0; i < this.n; i++) { const p = s[i]; const dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z; d[i] = dx * dx + dy * dy + dz * dz; }
    this.order.sort((a, b) => d[b] - d[a]);
    for (let k = 0; k < this.n; k++) {
      const p = s[this.order[k]];
      this.aPos[k * 3] = p[0]; this.aPos[k * 3 + 1] = p[1]; this.aPos[k * 3 + 2] = p[2];
      this.aData[k * 4] = p[3]; this.aData[k * 4 + 1] = p[4]; this.aData[k * 4 + 2] = p[5]; this.aData[k * 4 + 3] = p[6];
      this.aRot[k] = p[7];
    }
    this.geo.attributes.aPos.needsUpdate = true; this.geo.attributes.aData.needsUpdate = true; this.geo.attributes.aRot.needsUpdate = true;
  }
  update(dt, cam, camera) {
    this.uniforms.uFogDensity.value = this.atmo.fog.density;
    if (camera) this.uniforms.uSunView.value.copy(this.atmo.sunDir).transformDirection(camera.matrixWorldInverse);
    this.sortT -= dt;
    if (this.sortT <= 0) { this.sortT = 0.25; this.sort(cam); }
  }
  // 0..1: how deep the camera is inside a cloud (drives the white-out overlay)
  inside(p) {
    let best = 0;
    for (const v of this.volumes) {
      const dx = (p.x - v.x) / v.rx, dy = (p.y - v.y) / v.ry, dz = (p.z - v.z) / v.rz;
      const q = dx * dx + dy * dy + dz * dz;
      if (q < 1) best = Math.max(best, smoothstep(1, 0.35, q));
    }
    return best;
  }
}
