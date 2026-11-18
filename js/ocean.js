// Ocean: Gerstner wave surface on a camera-centred radial grid, Fresnel sky reflection, sun glitter, subsurface
// scatter on wave crests, shallow-water colour + shore foam from the terrain depth map, crest foam from the wave
// Jacobian, and ship wakes / splash rings rendered into a top-down foam map every frame.
import * as THREE from 'three';
import { TEX, makeCanvas, canvasTex } from './textures.js';
import { makeRng } from './util.js';

const G = 9.81;
// [direction deg, wavelength m, amplitude m]
const WAVE_DEF = [[18, 118, 0.62], [-22, 74, 0.46], [52, 43, 0.3], [-48, 24, 0.17], [84, 13.5, 0.09], [6, 7.8, 0.05], [-70, 4.6, 0.03]];
export const WAVES = WAVE_DEF.map(([d, L, A], i) => {
  const k = (2 * Math.PI) / L, a = (d * Math.PI) / 180;
  return { dx: Math.cos(a), dz: Math.sin(a), k, A, w: Math.sqrt(G * k), Q: 0.62 / (k * A * WAVE_DEF.length), ph: i * 1.7 };
});

export function waveHeight(x, z, t) {
  let y = 0;
  for (const W of WAVES) y += W.A * Math.sin(W.k * (W.dx * x + W.dz * z) - W.w * t + W.ph);
  return y;
}

const vert = /* glsl */`
#define NW ${WAVES.length}
uniform float uTime;
uniform vec4 uWA[NW];
uniform vec3 uWB[NW];
uniform vec3 uOrigin;
uniform float uDispFade;
varying vec3 vWorld;
varying vec3 vN;
varying float vFoam;
varying float vH;
void main() {
  vec3 p = position;
  vec3 wp = vec3(p.x + uOrigin.x, 0.0, p.z + uOrigin.z);
  float d = length(p.xz);
  float fade = 1.0 - smoothstep(uDispFade * 0.35, uDispFade, d);
  vec3 disp = vec3(0.0);
  vec3 tx = vec3(1.0, 0.0, 0.0), tz = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < NW; i++) {
    vec2 D = uWA[i].xy; float k = uWA[i].z, A = uWA[i].w * fade, w = uWB[i].x, Q = uWB[i].y;
    float ph = k * dot(D, wp.xz) - w * uTime + uWB[i].z;
    float c = cos(ph), s = sin(ph);
    disp += vec3(Q * A * D.x * c, A * s, Q * A * D.y * c);
    float WA = k * A;
    tx += vec3(-Q * D.x * D.x * WA * s, D.x * WA * c, -Q * D.x * D.y * WA * s);
    tz += vec3(-Q * D.x * D.y * WA * s, D.y * WA * c, -Q * D.y * D.y * WA * s);
  }
  vN = normalize(cross(tz, tx));
  float jac = tx.x * tz.z - tx.z * tz.x;
  vFoam = clamp((0.72 - jac) * 2.4, 0.0, 1.0);
  vH = disp.y;
  wp += disp;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const frag = /* glsl */`
uniform float uTime;
uniform samplerCube uEnv;
uniform sampler2D uNormalMap, uFoamMap, uWakeMap, uDepthMap;
uniform vec4 uWakeRect;   // x0, z0, size, -
uniform vec4 uDepthRect;  // x0, z0, sizeX, sizeZ
uniform vec3 uSunDir, uSunColor, uFogColor, uDeep, uShallow, uScatter;
uniform float uFogDensity, uSunI, uAmbient, uEnvI;
varying vec3 vWorld;
varying vec3 vN;
varying float vFoam;
varying float vH;
vec3 tnorm(vec2 uv) { return texture2D(uNormalMap, uv).xyz * 2.0 - 1.0; }
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float near = 1.0 - smoothstep(200.0, 4500.0, dist);
  vec3 n1 = tnorm(vWorld.xz * 0.011 + uTime * vec2(0.010, 0.006));
  vec3 n2 = tnorm(vWorld.xz * 0.043 + uTime * vec2(-0.016, 0.012));
  vec3 n3 = tnorm(vWorld.xz * 0.0018 + uTime * vec2(0.0016, -0.0011));
  vec3 n4 = tnorm(vWorld.xz * 0.16 + uTime * vec2(0.03, -0.024));
  vec2 dn = n1.xy * 0.55 * (0.4 + 0.6 * near) + n2.xy * 0.32 * near + n3.xy * 0.42 + n4.xy * 0.22 * (1.0 - smoothstep(30.0, 400.0, dist));
  vec3 N = normalize(vN + vec3(dn.x, 0.0, dn.y) * 0.55);
  // tame far-field sparkle (normal variance grows with distance)
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(3000.0, 30000.0, dist) * 0.65));
  // water depth from the terrain depth map
  vec2 duv = (vWorld.xz - uDepthRect.xy) / uDepthRect.zw;
  float depth = 60.0;
  if (duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0) depth = texture2D(uDepthMap, duv).r * 60.0;
  // wakes / splash foam
  vec2 wuv = (vWorld.xz - uWakeRect.xy) / uWakeRect.z;
  float wake = 0.0;
  wuv.y = 1.0 - wuv.y;
  if (wuv.x > 0.0 && wuv.x < 1.0 && wuv.y > 0.0 && wuv.y < 1.0) wake = texture2D(uWakeMap, wuv).r;
  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.02;
  vec3 refl = textureCube(uEnv, R).rgb * uEnvI;
  // body colour: deep blue -> turquoise shallows, lit by sky and sun
  float shallow = 1.0 - smoothstep(0.5, 16.0, depth);
  vec3 body = mix(uDeep, uShallow, shallow);
  float sunUp = max(uSunDir.y, 0.0);
  body *= uAmbient + 0.55 * sunUp;
  // subsurface light through the back of wave crests
  float sss = pow(max(dot(V, -normalize(uSunDir * vec3(1.0, 0.0, 1.0) + vec3(0.0, -0.25, 0.0))), 0.0), 3.0) * clamp(vH * 0.6 + 0.35, 0.0, 1.0);
  body += uScatter * sss * (0.6 + sunUp) * uSunI * 0.35;
  vec3 col = mix(body, refl, F);
  // foam: wave crests, wakes, shoreline
  float ft = texture2D(uFoamMap, vWorld.xz * 0.045 + uTime * 0.01).r;
  float ft2 = texture2D(uFoamMap, vWorld.xz * 0.013 - uTime * 0.006).r;
  float crest = vFoam * smoothstep(0.25, 0.75, ft) * near;
  float shore = (1.0 - smoothstep(0.2, 3.5, depth)) * smoothstep(0.3, 0.7, ft2 + 0.25 * sin(uTime * 0.8 + depth * 2.0));
  float wk = clamp(wake * (0.45 + 0.9 * ft), 0.0, 1.0);
  float foam = clamp(max(max(crest, shore * 0.9), wk), 0.0, 1.0);
  vec3 foamCol = vec3(0.92) * (uAmbient * 1.2 + 0.85 * sunUp * uSunI * 0.3);
  col = mix(col, foamCol, foam);
  // sun glitter
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, 900.0) * 60.0 + pow(nh, 120.0) * 1.2;
  col += uSunColor * spec * uSunI * (1.0 - foam) * smoothstep(-0.02, 0.08, uSunDir.y);
  // aerial perspective
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function wakeTexture() {
  const w = 128, h = 512, { c, g } = makeCanvas(w, h), r = makeRng(8);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    const v = r() * h, across = (r() - 0.5);
    const edge = Math.abs(across) > 0.36;
    const x = w / 2 + across * w;
    const a = edge ? 0.25 + r() * 0.4 : 0.05 + r() * 0.22;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(x - 1.5, v, 3 + r() * 3, 6 + r() * 26);
  }
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.18, 'rgba(0,0,0,0)'); gr.addColorStop(0.82, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.filter = 'blur(1.5px)'; g.drawImage(c, 0, 0); g.filter = 'none';
  return canvasTex(c);
}

class WakeRibbon {
  constructor(scene, mat, width, maxPts = 80) {
    this.pts = []; this.max = maxPts; this.width = width; this.timer = 0;
    const n = maxPts * 2;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.uv = new Float32Array(n * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(dt, x, z, dirx, dirz, speed, strength = 1) {
    this.timer -= dt;
    for (const p of this.pts) p.age += dt;
    if (this.timer <= 0 || this.pts.length === 0) { this.timer = 1.2; this.pts.unshift({ x, z, age: 0, dx: dirx, dz: dirz }); if (this.pts.length > this.max) this.pts.pop(); }
    else { this.pts[0].x = x; this.pts[0].z = z; this.pts[0].dx = dirx; this.pts[0].dz = dirz; }
    const n = this.pts.length;
    for (let i = 0; i < this.max; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const age = p.age;
      const w = this.width * (0.6 + Math.sqrt(age) * 0.55);
      const px = -p.dz, pz = p.dx;
      const k = i < n ? Math.max(0, 1 - age / 95) * strength * Math.min(1, speed / 6) : 0;
      const a = i * 2;
      this.pos[a * 3] = p.x + px * w; this.pos[a * 3 + 1] = 0; this.pos[a * 3 + 2] = p.z + pz * w;
      this.pos[a * 3 + 3] = p.x - px * w; this.pos[a * 3 + 4] = 0; this.pos[a * 3 + 5] = p.z - pz * w;
      const f = k * k;
      for (let j = 0; j < 6; j++) this.col[a * 3 + j] = f;
      this.uv[a * 2] = 0; this.uv[a * 2 + 1] = i * 0.25; this.uv[a * 2 + 2] = 1; this.uv[a * 2 + 3] = i * 0.25;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
  }
}

export class Ocean {
  constructor(renderer, atmo, quality = 2, depth) {
    this.renderer = renderer; this.atmo = atmo;
    const segs = quality >= 2 ? 288 : quality === 1 ? 192 : 128;
    this.geo = radialGrid(segs, 90000);
    const wa = WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.A));
    const wb = WAVES.map((w) => new THREE.Vector3(w.w, w.Q, w.ph));
    // wakes
    this.wakeSize = 4000;
    this.wakeRT = new THREE.WebGLRenderTarget(quality >= 2 ? 1024 : 512, quality >= 2 ? 1024 : 512, { depthBuffer: false });
    this.wakeScene = new THREE.Scene();
    this.wakeCam = new THREE.OrthographicCamera(-this.wakeSize / 2, this.wakeSize / 2, this.wakeSize / 2, -this.wakeSize / 2, -100, 100);
    this.wakeCam.up.set(0, 0, -1); this.wakeCam.lookAt(0, -1, 0);
    this.wakeMat = new THREE.MeshBasicMaterial({ map: wakeTexture(), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.ringMat = new THREE.MeshBasicMaterial({ map: TEX.particles, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.ribbons = []; this.rings = [];
    this.uniforms = {
      uTime: { value: 0 }, uWA: { value: wa }, uWB: { value: wb }, uOrigin: { value: new THREE.Vector3() }, uDispFade: { value: 2600 },
      uEnv: { value: null }, uNormalMap: { value: TEX.waterNormal }, uFoamMap: { value: TEX.foam }, uWakeMap: { value: this.wakeRT.texture },
      uDepthMap: { value: depth?.tex || null }, uWakeRect: { value: new THREE.Vector4(0, 0, this.wakeSize, 0) },
      uDepthRect: { value: depth ? new THREE.Vector4(depth.x0, depth.z0, depth.sx, depth.sz) : new THREE.Vector4(0, 0, 1, 1) },
      uSunDir: { value: atmo.sunDir }, uSunColor: { value: atmo.sun.color }, uFogColor: { value: atmo.fog.color }, uFogDensity: { value: atmo.fog.density },
      uDeep: { value: new THREE.Color(0.006, 0.03, 0.05) }, uShallow: { value: new THREE.Color(0.03, 0.16, 0.15) }, uScatter: { value: new THREE.Color(0.03, 0.2, 0.16) },
      uSunI: { value: 1 }, uAmbient: { value: 0.35 }, uEnvI: { value: 1.0 },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }
  setEnv(cubeTex) { this.uniforms.uEnv.value = cubeTex; }
  addWake(width) { const r = new WakeRibbon(this.wakeScene, this.wakeMat, width); this.ribbons.push(r); return r; }
  ring(x, z, size, life = 6) {
    let m = this.rings.find((r) => r.t >= r.life);
    if (!m) {
      const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.75 + uv.getX(i) * 0.25, uv.getY(i) * 0.25);
      m = { mesh: new THREE.Mesh(g, this.ringMat.clone()), t: 0, life }; this.wakeScene.add(m.mesh); this.rings.push(m);
    }
    m.t = 0; m.life = life; m.size = size; m.mesh.position.set(x, 0, z); m.mesh.visible = true;
  }
  update(dt, time, camPos) {
    const u = this.uniforms;
    u.uTime.value = time;
    const step = 4;
    u.uOrigin.value.set(Math.round(camPos.x / step) * step, 0, Math.round(camPos.z / step) * step);
    this.mesh.position.set(0, 0, 0);
    u.uFogDensity.value = this.atmo.fog.density;
    const el = Math.max(0, this.atmo.sunDir.y);
    u.uSunI.value = 0.6 + 1.4 * Math.min(1, el * 3);
    u.uAmbient.value = 0.18 + 0.3 * Math.min(1, el * 2.5);
    // displacement detail fades out faster when high up (saves aliasing)
    u.uDispFade.value = 2600 + Math.min(camPos.y, 4000) * 0.5;
    for (const r of this.rings) if (r.t < r.life) { r.t += dt; const k = r.t / r.life; r.mesh.scale.setScalar(r.size * (0.4 + k * 1.4)); r.mesh.material.opacity = (1 - k) * 0.9; if (r.t >= r.life) r.mesh.visible = false; }
  }
  renderWakes(camPos) {
    const s = this.wakeSize, snap = s / this.wakeRT.width;
    const cx = Math.round(camPos.x / snap) * snap, cz = Math.round(camPos.z / snap) * snap;
    this.wakeCam.position.set(cx, 50, cz);
    this.wakeCam.lookAt(cx, 0, cz);
    this.wakeCam.updateMatrixWorld();
    this.uniforms.uWakeRect.value.set(cx - s / 2, cz - s / 2, s, 0);
    const r = this.renderer, prev = r.getRenderTarget(), prevClear = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
    r.setRenderTarget(this.wakeRT); r.setClearColor(0x000000, 1); r.clear(true, false, false);
    r.render(this.wakeScene, this.wakeCam);
    r.setRenderTarget(prev); r.setClearColor(prevClear, prevA);
  }
}

// Concentric rings with exponential spacing: ~1.5 m cells under the camera, kilometres at the horizon.
function radialGrid(seg, maxR) {
  const step = (2 * Math.PI) / seg, ratio = 1 + step;
  const a = 1.4 / step;
  const rings = [0];
  let i = 1;
  while (true) { const r = a * (Math.pow(ratio, i) - 1); rings.push(Math.min(r, maxR)); if (r >= maxR) break; i++; }
  const nr = rings.length, cols = seg + 1;
  const pos = new Float32Array(nr * cols * 3);
  for (let j = 0; j < nr; j++) for (let k = 0; k <= seg; k++) {
    const t = k * step, r = rings[j], o = (j * cols + k) * 3;
    pos[o] = Math.cos(t) * r; pos[o + 1] = 0; pos[o + 2] = Math.sin(t) * r;
  }
  const idx = [];
  for (let j = 0; j < nr - 1; j++) for (let k = 0; k < seg; k++) { const a0 = j * cols + k, b = a0 + 1, c = a0 + cols, d = c + 1; idx.push(a0, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), maxR);
  return g;
}
