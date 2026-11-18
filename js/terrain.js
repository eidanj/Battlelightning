// Mainland terrain: a coastline with beaches, rolling hills, ridged mountains inland, an estuary through the city,
// flattened ground for the city and the airbase and two rocky islands offshore. Heights are baked to a 40 m grid
// (used for both rendering and collision), drawn as LOD chunks with skirts, splat-shaded on the GPU, with forests.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { fbm2, ridge2, noise2, smoothstep, clamp, lerp, makeRng } from './util.js';
import { TEX } from './textures.js';

const X0 = -12000, Z0 = -20000, SIZE = 40000, CELL = 40, N = SIZE / CELL + 1;
const CH = 100; // cells per chunk (4 km)

export function coastX(z) { return 260 * fbm2(z / 5200, 1.3, 3) + 150 * fbm2(z / 1700, 7.1, 3) - 120 * smoothstep(-7000, -3000, z) * (1 - smoothstep(-1500, 500, z)); }
export function riverZ(x) { return WORLD.river.z + 380 * Math.sin(x / 2100 + 0.6) + 160 * fbm2(x / 1500, 3.3, 2); }
const ISLANDS = [[-4300, 7600, 520, 150], [-6200, -11000, 700, 210], [-2600, 13800, 380, 90]];

// analytic height (metres) — baked into the grid at load
export function rawHeight(x, z) {
  const cx = coastX(z);
  const d = x - cx;
  let h;
  if (d < 0) {
    h = -Math.min(64, 2 + (-d) * 0.028) + 2.5 * fbm2(x / 900, z / 900, 3);
  } else {
    const beach = Math.min(d * 0.03, 4.5);
    const inland = smoothstep(80, 2600, d);
    let hills = 0, roll = 0, mtn = 0;
    if (inland > 0) { hills = (fbm2(x / 3400, z / 3400, 5) * 0.5 + 0.5) * 210 * inland + 40 * inland; roll = fbm2(x / 900 + 3, z / 900 - 2, 3) * 18 * inland; }
    const mk = smoothstep(8500, 17000, x);
    if (mk > 0) mtn = mk * (1500 * Math.pow(ridge2(x / 7600, z / 7600, 5), 1.6) + 400 * smoothstep(12000, 24000, x));
    h = beach + hills + roll + mtn;
  }
  // islands
  for (const [ix, iz, r, hh] of ISLANDS) {
    const q = Math.hypot(x - ix, z - iz) / r;
    if (q < 2.2) h = Math.max(h, hh * Math.exp(-q * q * 1.6) * (0.75 + 0.35 * fbm2(x / 300, z / 300, 3)) - 14 * q * q + 2);
  }
  // estuary through the city (fades out a few km inland)
  if (d > -400 && d < 7500) {
    const rz = riverZ(x), dist = Math.abs(z - rz);
    const w = lerp(440, 150, smoothstep(cx, cx + 6000, x));
    if (dist < w * 2.2) {
      const bed = -7 + 2.5 * smoothstep(cx, cx + 6000, x);
      const bank = Math.max(h, 3);
      const t = smoothstep(w * 0.55, w * 1.25, dist);
      const carved = lerp(bed, bank, t);
      const k = smoothstep(w * 1.25, w * 2.2, dist) + smoothstep(cx + 5200, cx + 7300, x);
      h = lerp(carved, h, clamp(k, 0, 1));
    }
  }
  // city: low, gently rising waterfront plateau
  const C = WORLD.city;
  const cm = rectMask(x, z, C.x0, C.x1, C.z0, C.z1, 500);
  if (cm > 0) {
    const level = 6 + Math.max(0, x - cx) * 0.004;
    const rz = riverZ(x), dist = Math.abs(z - rz);
    const w = lerp(440, 150, smoothstep(cx, cx + 6000, x));
    const riverKeep = 1 - smoothstep(w * 0.9, w * 1.3, dist);
    const target = lerp(level, h, riverKeep);
    if (d > 0) h = lerp(h, target, cm);
  }
  // airbase plateau
  const A = WORLD.airbase;
  const am = rectMask(x, z, A.x - A.len / 2 - 500, A.x + A.len / 2 + 500, A.z - 650, A.z + 900, 700);
  if (am > 0) h = lerp(h, 42, am);
  // approach corridor west of the runway: keep the ground well under the 3.5 deg glide path (landings are made eastbound)
  const thrX = A.x - A.len / 2, dw = thrX - x;
  if (dw > 0 && dw < 10000) {
    const half = 350 + dw * 0.1, k = (1 - smoothstep(half, half + 600, Math.abs(z - A.z))) * (1 - smoothstep(8500, 10000, dw));
    if (k > 0) h = lerp(h, Math.min(h, 42 + dw * 0.03), k);
  }
  return h;
}
function rectMask(x, z, x0, x1, z0, z1, m) {
  const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
  return 1 - smoothstep(0, m, Math.hypot(dx, dz));
}

export class Terrain {
  constructor() {
    this.grid = new Float32Array(N * N);
    this.group = new THREE.Group();
    this.chunks = [];
  }
  bake(progress) {
    const g = this.grid;
    for (let j = 0; j < N; j++) {
      const z = Z0 + j * CELL;
      for (let i = 0; i < N; i++) g[j * N + i] = rawHeight(X0 + i * CELL, z);
      if (progress && j % 100 === 0) progress(j / N);
    }
  }
  // bilinear lookup on the baked grid (matches the rendered triangles closely)
  height(x, z) {
    const fx = (x - X0) / CELL, fz = (z - Z0) / CELL;
    if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return rawHeight(x, z);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, g = this.grid, k = j * N + i;
    // match the triangle split used by the mesh
    if (tx + tz <= 1) return g[k] + (g[k + 1] - g[k]) * tx + (g[k + N] - g[k]) * tz;
    return g[k + N + 1] + (g[k + N] - g[k + N + 1]) * (1 - tx) + (g[k + 1] - g[k + N + 1]) * (1 - tz);
  }
  normal(x, z, out) {
    const e = 20;
    return out.set(this.height(x - e, z) - this.height(x + e, z), 2 * e, this.height(x, z - e) - this.height(x, z + e)).normalize();
  }

  buildMaterial(atmo) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    const C = WORLD.city, A = WORLD.airbase;
    const uniforms = {
      tGrass: { value: TEX.grass }, tForest: { value: TEX.forest }, tRock: { value: TEX.rock }, tSand: { value: TEX.sand }, tDirt: { value: TEX.dirt },
      tAsphalt: { value: TEX.asphalt }, tConcrete: { value: TEX.concrete }, tMacro: { value: TEX.foam },
      uCity: { value: new THREE.Vector4(C.x0, C.x1, C.z0, C.z1) }, uBase: { value: new THREE.Vector4(A.x - A.len / 2 - 350, A.x + A.len / 2 + 350, A.z - 420, A.z + 700) },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWN;
uniform sampler2D tGrass, tForest, tRock, tSand, tDirt, tAsphalt, tConcrete, tMacro;
uniform vec4 uCity, uBase;
vec3 tri(sampler2D t, vec2 p) { return texture2D(t, p * 0.045).rgb * 0.6 + texture2D(t, p * 0.0071).rgb * 0.4; }
float rmask(vec2 p, vec4 r, float m) { vec2 d = max(vec2(r.x - p.x, r.z - p.y), vec2(p.x - r.y, p.y - r.w)); return 1.0 - smoothstep(0.0, m, length(max(d, 0.0))); }`)
        .replace('#include <map_fragment>', `
  vec2 P = vWPos.xz;
  float hgt = vWPos.y;
  vec3 wn = normalize(vWN);
  float slope = 1.0 - wn.y;
  float macro = texture2D(tMacro, P * 0.00021).r;
  float macro2 = texture2D(tMacro, P * 0.0011 + 0.3).r;
  vec3 c = tri(tGrass, P);
  c = mix(c, tri(tForest, P), smoothstep(0.42, 0.62, macro) * (1.0 - smoothstep(900.0, 1400.0, hgt)));
  c = mix(c, tri(tDirt, P), smoothstep(0.55, 0.8, macro2) * 0.55);
  c = mix(c, c * vec3(1.08, 1.02, 0.82), smoothstep(200.0, 600.0, hgt) * 0.5);
  float beach = 1.0 - smoothstep(1.5, 4.0 + macro2 * 2.5, hgt);
  c = mix(c, tri(tSand, P), beach);
  c = mix(c, tri(tRock, P), smoothstep(0.24, 0.42, slope + (macro2 - 0.5) * 0.12));
  c = mix(c, tri(tRock, P) * 0.85, smoothstep(-0.5, -3.0, hgt));
  float snow = smoothstep(1650.0, 1950.0, hgt + (macro - 0.5) * 300.0) * (1.0 - smoothstep(0.35, 0.6, slope));
  c = mix(c, vec3(0.92, 0.94, 0.97), snow);
  // city streets & blocks
  float cm = rmask(P, uCity, 40.0) * step(4.0, hgt);
  if (cm > 0.0) {
    vec2 b = mod(P - uCity.xz, vec2(150.0, 136.0));
    float road = 1.0 - step(24.0, b.x) * step(24.0, b.y);
    float side = (1.0 - step(28.0, b.x) * step(28.0, b.y)) * (1.0 - road);
    vec3 street = texture2D(tAsphalt, P * 0.05).rgb * 0.8;
    vec3 lot = texture2D(tConcrete, P * 0.03).rgb * vec3(0.82, 0.8, 0.76);
    float lane = road * step(abs(b.x - 12.0), 0.25) * step(fract(P.y * 0.08), 0.5) + road * step(abs(b.y - 12.0), 0.25) * step(fract(P.x * 0.08), 0.5);
    vec3 cc = mix(lot, street, road);
    cc = mix(cc, vec3(0.62, 0.6, 0.56), side);
    cc = mix(cc, vec3(0.85, 0.8, 0.45), lane);
    c = mix(c, cc, cm);
  }
  // airbase: mown grass + concrete aprons are separate meshes
  float bm = rmask(P, uBase, 60.0);
  c = mix(c, tri(tGrass, P) * vec3(1.05, 1.08, 0.9), bm * 0.6);
  diffuseColor.rgb *= c;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.97, 0.75, beach * smoothstep(1.0, 0.0, hgt));');
    };
    this.material = m;
    return m;
  }

  buildMeshes(quality = 1) {
    const mat = this.material;
    // detailed chunks over the battle area (3 LODs each)
    const nx = (N - 1) / CH, nz = (N - 1) / CH;
    for (let cj = 0; cj < nz; cj++) for (let ci = 0; ci < nx; ci++) {
      let maxH = -1e9;
      for (let j = cj * CH; j <= (cj + 1) * CH; j += 5) for (let i = ci * CH; i <= (ci + 1) * CH; i += 5) maxH = Math.max(maxH, this.grid[j * N + i]);
      if (maxH < -1.5) continue;
      const lods = [1, 2, 5].map((s) => { const g = this._chunkGeo(ci * CH, cj * CH, CH, s); const ms = new THREE.Mesh(g, mat); ms.receiveShadow = true; ms.visible = false; this.group.add(ms); return ms; });
      const cx = X0 + (ci + 0.5) * CH * CELL, cz = Z0 + (cj + 0.5) * CH * CELL;
      this.chunks.push({ lods, cx, cz });
    }
    // coarse far terrain around the detailed region (mountains on the horizon)
    this.far = new THREE.Mesh(this._farGeo(), mat);
    this.far.receiveShadow = false;
    this.group.add(this.far);
    return this.group;
  }

  _chunkGeo(i0, j0, n, s) {
    const cnt = n / s + 1, verts = cnt * cnt;
    const skirt = cnt * 4;
    const pos = new Float32Array((verts + skirt) * 3), nor = new Float32Array((verts + skirt) * 3), uv = new Float32Array((verts + skirt) * 2);
    const g = this.grid, tmp = new THREE.Vector3();
    for (let j = 0; j < cnt; j++) for (let i = 0; i < cnt; i++) {
      const gi = i0 + i * s, gj = j0 + j * s, k = j * cnt + i;
      const x = X0 + gi * CELL, z = Z0 + gj * CELL;
      pos[k * 3] = x; pos[k * 3 + 1] = g[gj * N + gi]; pos[k * 3 + 2] = z;
      const hl = g[gj * N + Math.max(gi - 1, 0)], hr = g[gj * N + Math.min(gi + 1, N - 1)], hd = g[Math.max(gj - 1, 0) * N + gi], hu = g[Math.min(gj + 1, N - 1) * N + gi];
      tmp.set(hl - hr, 2 * CELL, hd - hu).normalize();
      nor[k * 3] = tmp.x; nor[k * 3 + 1] = tmp.y; nor[k * 3 + 2] = tmp.z;
      uv[k * 2] = x / 50; uv[k * 2 + 1] = z / 50;
    }
    const idx = [];
    for (let j = 0; j < cnt - 1; j++) for (let i = 0; i < cnt - 1; i++) { const a = j * cnt + i, b = a + 1, c = a + cnt, d = c + 1; idx.push(a, c, b, b, c, d); }
    // skirts: duplicate the border, dropped 40 m
    let sk = verts;
    const border = [];
    for (let i = 0; i < cnt; i++) border.push(i);
    for (let j = 1; j < cnt; j++) border.push(j * cnt + cnt - 1);
    for (let i = cnt - 2; i >= 0; i--) border.push((cnt - 1) * cnt + i);
    for (let j = cnt - 2; j > 0; j--) border.push(j * cnt);
    const start = sk;
    for (const b of border) { pos[sk * 3] = pos[b * 3]; pos[sk * 3 + 1] = pos[b * 3 + 1] - 40; pos[sk * 3 + 2] = pos[b * 3 + 2]; nor[sk * 3 + 1] = 1; uv[sk * 2] = uv[b * 2]; uv[sk * 2 + 1] = uv[b * 2 + 1]; sk++; }
    for (let k = 0; k < border.length; k++) {
      const a = border[k], b = border[(k + 1) % border.length], c = start + k, d = start + ((k + 1) % border.length);
      idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, sk * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, sk * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, sk * 2), 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }

  _farGeo() {
    const step = 700, xa = -14000, xb = 70000, za = -70000, zb = 70000;
    const nx = Math.round((xb - xa) / step) + 1, nz = Math.round((zb - za) / step) + 1;
    const pos = [], idx = [], map = new Int32Array(nx * nz).fill(-1);
    const inside = (x, z) => x > X0 + 600 && x < X0 + SIZE - 600 && z > Z0 + 600 && z < Z0 + SIZE - 600;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = xa + i * step, z = za + j * step;
      let h = rawHeight(x, z);
      if (inside(x, z)) h -= 60;
      map[j * nx + i] = pos.length / 3; pos.push(x, h, z);
    }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const x = xa + (i + 0.5) * step, z = za + (j + 0.5) * step;
      if (inside(x - step, z - step) && inside(x + step, z + step)) continue;
      const a = map[j * nx + i], b = map[j * nx + i + 1], c = map[(j + 1) * nx + i], d = map[(j + 1) * nx + i + 1];
      if (Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1], pos[d * 3 + 1]) < -2) continue;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // depth below sea level for the ocean shader (shallows + shore foam)
  depthTexture() {
    const R = 1024, data = new Uint8Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const x = X0 + (i + 0.5) / R * SIZE, z = Z0 + (j + 0.5) / R * SIZE;
      const h = this.height(x, z);
      data[j * R + i] = clamp(-h / 60, 0, 1) * 255;
    }
    const t = new THREE.DataTexture(data, R, R, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return { tex: t, x0: X0, z0: Z0, sx: SIZE, sz: SIZE };
  }

  updateLOD(camPos) {
    for (const c of this.chunks) {
      const d = Math.hypot(camPos.x - c.cx, camPos.z - c.cz) + Math.max(0, camPos.y - 1500) * 0.6;
      const l = d < 6500 ? 0 : d < 15000 ? 1 : 2;
      for (let k = 0; k < 3; k++) c.lods[k].visible = k === l;
    }
  }

  // forests: instanced conifers and broadleaf trees placed with the same mask the terrain shader uses for
  // its forest colour, grouped into 2 km cells that are only drawn near the camera
  buildTrees(density = 1, avoid) {
    const r = makeRng(2024);
    const conGeo = treeGeo('con'), leafGeo = treeGeo('leaf');
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const group = new THREE.Group();
    const cells = {};
    const mask = TEX.foam.image.data, MS = TEX.foam.image.width;
    const sample = (x, z) => {
      let u = x * 0.00021 * MS - 0.5, v = z * 0.00021 * MS - 0.5;
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const at = (a, b) => mask[(((b % MS) + MS) % MS * MS + ((a % MS) + MS) % MS) * 4] / 255;
      return lerp(lerp(at(i, j), at(i + 1, j), fu), lerp(at(i, j + 1), at(i + 1, j + 1), fu), fv);
    };
    const step = 38 / Math.sqrt(Math.max(density, 0.15));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
    const CS = 2000;
    for (let z = -17000; z < 17000; z += step) for (let x = -1500; x < 23000; x += step) {
      const px = x + (r() - 0.5) * step * 0.9, pz = z + (r() - 0.5) * step * 0.9;
      const f = smoothstep(0.42, 0.62, sample(px, pz));
      if (r() > f * 0.9 + 0.006) continue;
      const h = this.height(px, pz);
      if (h < 6 || h > 1350) continue;
      if (avoid && avoid(px, pz)) continue;
      this.normal(px, pz, nrm);
      if (nrm.y < 0.8) continue;
      const key = `${Math.floor(px / CS)},${Math.floor(pz / CS)}`;
      const cell = (cells[key] ||= { con: [], leaf: [], cx: (Math.floor(px / CS) + 0.5) * CS, cz: (Math.floor(pz / CS) + 0.5) * CS });
      const con = h > 320 ? r() < 0.85 : r() < 0.4;
      const sc = 1.0 + r() * 0.75;
      q.setFromAxisAngle(up, r() * 6.28);
      s.set(sc, sc * (0.85 + r() * 0.35), sc);
      p.set(px, h - 0.5, pz);
      m4.compose(p, q, s);
      (con ? cell.con : cell.leaf).push(m4.clone());
    }
    const col = new THREE.Color();
    this.treeCells = [];
    let total = 0;
    for (const k in cells) {
      const c = cells[k];
      const g = new THREE.Group();
      for (const [list, geo] of [[c.con, conGeo], [c.leaf, leafGeo]]) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((m, i) => { im.setMatrixAt(i, m); col.setHSL(0.22 + r() * 0.1, 0.3 + r() * 0.25, 0.7 + r() * 0.35); im.setColorAt(i, col); });
        im.castShadow = true; im.receiveShadow = true;
        im.computeBoundingSphere();
        g.add(im); total += list.length;
      }
      g.visible = false;
      group.add(g);
      this.treeCells.push({ g, cx: c.cx, cz: c.cz });
    }
    this.treeCount = total;
    this.trees = group;
    return group;
  }
  updateTrees(camPos, range = 4500) {
    if (!this.treeCells) return;
    const hide = camPos.y > 4200;
    for (const c of this.treeCells) c.g.visible = !hide && Math.hypot(camPos.x - c.cx, camPos.z - c.cz) < range + 1400;
  }
}

function treeGeo(kind) {
  const parts = [];
  const add = (g, rgb) => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g.index ? g.toNonIndexed() : g); };
  const trunk = new THREE.CylinderGeometry(0.22, 0.38, 4, 5); trunk.translate(0, 2, 0); add(trunk, [0.28, 0.2, 0.14]);
  if (kind === 'con') {
    for (let i = 0; i < 3; i++) { const c = new THREE.ConeGeometry(3.4 - i * 0.9, 5.2 - i * 0.8, 7); c.translate(0, 4.5 + i * 3.1, 0); add(c, [0.13 - i * 0.01, 0.24 + i * 0.02, 0.12]); }
  } else {
    const a = new THREE.IcosahedronGeometry(3.6, 1); a.scale(1, 0.85, 1); a.translate(0, 6.4, 0); add(a, [0.2, 0.32, 0.13]);
    const b = new THREE.IcosahedronGeometry(2.4, 0); b.translate(1.6, 7.6, 0.8); add(b, [0.24, 0.36, 0.15]);
  }
  const merged = new THREE.BufferGeometry();
  let total = 0; for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) { p.computeVertexNormals(); pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3)); merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}

export const TERRAIN_BOUNDS = { X0, Z0, SIZE, CELL, N };
