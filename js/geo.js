// Geometry builders: smooth lofted bodies (fuselages, limbs, hulls), airfoil wing panels, hinges, helpers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export { mergeGeometries };

const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
const KEYS = ['z', 'w', 'h', 'hb', 'y', 'n', 'nb', 'x'];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function normStation(s) { return { z: s.z, w: s.w, h: s.h ?? s.w, hb: s.hb ?? s.h ?? s.w, y: s.y ?? 0, n: s.n ?? 2, nb: s.nb ?? s.n ?? 2, x: s.x ?? 0 }; }

// Smooth body through cross-section stations along an axis (default z). Sections are superellipses with separate
// top/bottom half-heights: x = w*cos^(2/n), y = y + h*sin^(2/n). The UV seam sits along the bottom.
export function loft(stations, o = {}) {
  const seg = o.seg ?? 24, sub = o.sub ?? 3;
  let st = stations.map(normStation);
  if (sub > 1 && st.length > 2) {
    const out = [];
    for (let i = 0; i < st.length - 1; i++) {
      const p0 = st[Math.max(0, i - 1)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(st.length - 1, i + 2)];
      for (let k = 0; k < sub; k++) {
        const t = k / sub, s = {};
        for (const key of KEYS) s[key] = catmull(p0[key], p1[key], p2[key], p3[key], t);
        s.w = Math.max(0, s.w); s.h = Math.max(0, s.h); s.hb = Math.max(0, s.hb); s.n = Math.max(0.6, s.n); s.nb = Math.max(0.6, s.nb);
        out.push(s);
      }
    }
    out.push(st[st.length - 1]);
    st = out;
  }
  const rings = st.length, cols = seg + 1;
  const pos = new Float32Array(rings * cols * 3), uv = new Float32Array(rings * cols * 2);
  let perim = 0;
  for (const s of st) perim += Math.PI * (s.w + (s.h + s.hb) / 2);
  perim /= rings;
  const us = o.uvScale ?? 4;
  const angRange = o.angle ?? [0, Math.PI * 2];
  for (let r = 0; r < rings; r++) {
    const s = st[r];
    for (let k = 0; k <= seg; k++) {
      const th = -Math.PI / 2 + angRange[0] + (angRange[1] - angRange[0]) * k / seg;
      const c = Math.cos(th), sn = Math.sin(th);
      const top = sn >= 0;
      const x = s.x + s.w * spow(c, 2 / (top ? s.n : s.nb));
      const y = s.y + (top ? s.h : s.hb) * spow(sn, 2 / (top ? s.n : s.nb));
      const i = (r * cols + k);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = s.z;
      uv[i * 2] = (k / seg) * perim / us; uv[i * 2 + 1] = s.z / us;
    }
  }
  const idx = [];
  const skip = o.open;
  for (let r = 0; r < rings - 1; r++) for (let k = 0; k < seg; k++) {
    if (skip) {
      const zc = (st[r].z + st[r + 1].z) / 2, th = angRange[0] + (angRange[1] - angRange[0]) * (k + 0.5) / seg; // from bottom
      let hit = false;
      for (const h of skip) if (zc > h.z0 && zc < h.z1 && th > h.a0 && th < h.a1) hit = true;
      if (hit) continue;
    }
    const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1;
    if (o.flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld normals across the seam
  if (angRange[1] - angRange[0] > 6.28) {
    const n = g.attributes.normal;
    for (let r = 0; r < rings; r++) {
      const a = r * cols, b = r * cols + seg;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
  }
  if (o.axis === 'y') g.rotateX(-Math.PI / 2); // stations along +y instead (limbs, towers)
  return g;
}

// Lathe around the y axis from a profile [[r, y], ...] with smooth normals (limbs, nozzles, missiles).
export function lathe(profile, seg = 20, o = {}) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  const g = new THREE.LatheGeometry(pts, seg, o.phi ?? 0, o.len ?? Math.PI * 2);
  if (o.uvScale) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * o.uvScale[0], uv.getY(i) * o.uvScale[1]); }
  return g;
}

// NACA 4-digit symmetric thickness at chord fraction x (closed trailing edge)
const naca = (x) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);

// Airfoil wing panel. Root leading edge at p.root, span along +x (or -x when mirror). Positive z is aft.
// Can build a sub-panel (spanwise s0..s1, chordwise c0..c1) with closed edges, used for ailerons, flaps and rudders.
export function wingPanel(p, s0 = 0, s1 = 1, c0 = 0, c1 = 1) {
  const nC = p.nChord ?? 10, nS = Math.max(1, Math.round((p.nSpan ?? 6) * (s1 - s0)));
  const span = p.span, sweep = p.sweep ?? 0, dih = p.dihedral ?? 0, tR = p.tRoot ?? 0.05, tT = p.tTip ?? tR;
  const verts = [], uvs = [], idx = [];
  const sec = (s) => {
    const chord = p.rootChord + (p.tipChord - p.rootChord) * s;
    const xs = s * span, le = p.root[2] + xs * Math.tan(sweep) + (p.crank ? p.crank(s) : 0), y = p.root[1] + xs * Math.tan(dih);
    return { chord, x: p.root[0] + xs, le, y, t: tR + (tT - tR) * s };
  };
  const ring = (s) => {
    const S = sec(s), pts = [];
    for (let i = 0; i <= nC; i++) { const f = c0 + (c1 - c0) * (1 - Math.cos(Math.PI * i / nC)) / 2; const yt = naca(Math.max(f, 1e-4)) * S.t * S.chord; pts.push([S.x, S.y + yt, S.le + f * S.chord, f]); }
    for (let i = nC; i >= 0; i--) { const f = c0 + (c1 - c0) * (1 - Math.cos(Math.PI * i / nC)) / 2; const yt = naca(Math.max(f, 1e-4)) * S.t * S.chord; pts.push([S.x, S.y - yt, S.le + f * S.chord, f]); }
    return pts;
  };
  const per = (nC + 1) * 2;
  for (let j = 0; j <= nS; j++) {
    const s = s0 + (s1 - s0) * j / nS;
    for (const q of ring(s)) { verts.push(q[0], q[1], q[2]); uvs.push(q[3] * p.rootChord / 4, (q[0] - p.root[0]) / 4); }
  }
  for (let j = 0; j < nS; j++) for (let i = 0; i < per - 1; i++) {
    const a = j * per + i, b = a + 1, c = a + per, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const addCap = (j) => { // close a spanwise end
    const base = verts.length / 3, ringStart = j * per;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < per; i++) { cx += verts[(ringStart + i) * 3]; cy += verts[(ringStart + i) * 3 + 1]; cz += verts[(ringStart + i) * 3 + 2]; }
    verts.push(cx / per, cy / per, cz / per); uvs.push(0, 0);
    for (let i = 0; i < per - 1; i++) { if (j === 0) idx.push(base, ringStart + i + 1, ringStart + i); else idx.push(base, ringStart + i, ringStart + i + 1); }
  };
  if (p.capRoot || s0 > 0) addCap(0);
  if (s1 < 1 || p.capTip !== false) addCap(nS);
  if (c0 > 0 || c1 < 1) { // close chord cuts (top/bottom ends of each ring)
    for (let j = 0; j < nS; j++) {
      if (c0 > 0) { const a = j * per, b = j * per + per - 1, c = a + per, d = b + per; idx.push(a, c, b, b, c, d); }
      if (c1 < 1) { const a = j * per + nC, b = j * per + nC + 1, c = a + per, d = b + per; idx.push(a, b, c, b, d, c); }
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  if (p.mirror) { g.scale(-1, 1, 1); const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
  g.computeVertexNormals();
  return g;
}

// the hinge line (chord fraction c at span stations s0..s1) of a panel built with the same params
export function hingeLine(p, s0, s1, c) {
  const pt = (s) => {
    const chord = p.rootChord + (p.tipChord - p.rootChord) * s, xs = s * p.span;
    const le = p.root[2] + xs * Math.tan(p.sweep ?? 0) + (p.crank ? p.crank(s) : 0), y = p.root[1] + xs * Math.tan(p.dihedral ?? 0);
    return new THREE.Vector3((p.root[0] + xs) * (p.mirror ? -1 : 1), y, le + c * chord);
  };
  return [pt(s0), pt(s1)];
}

// Wrap a mesh so it rotates about the axis a->b. Returns a group with setAngle(rad).
export function hinge(mesh, a, b) {
  const pivot = new THREE.Group();
  pivot.position.copy(a);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  const inner = new THREE.Group();
  pivot.quaternion.copy(q);
  inner.add(mesh);
  mesh.position.sub(a);
  mesh.position.applyQuaternion(q.clone().invert());
  mesh.quaternion.premultiply(q.clone().invert());
  pivot.add(inner);
  pivot.setAngle = (ang) => { inner.rotation.x = ang; };
  return pivot;
}

// Box with UVs measured in metres (for buildings / decks so textures tile at real-world scale)
export function boxUV(w, h, d, us = 1, vs = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const u = uv.getX(i), v = uv.getY(i);
    if (nx > 0.5) uv.setXY(i, u * d / us, v * h / vs);
    else if (ny > 0.5) uv.setXY(i, u * w / us, v * d / vs);
    else uv.setXY(i, u * w / us, v * h / vs);
  }
  return g;
}

export function tube(points, radius, seg = 8, tubular = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  return new THREE.TubeGeometry(curve, tubular, radius, seg, false);
}

export function place(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
  return g.applyMatrix4(m);
}
export function mesh(g, mat, cast = true, recv = true) { const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = recv; return m; }
// merge an array of geometries (non-indexed/indexed mixed safely)
export function merge(list) {
  const fixed = list.map((g) => {
    let x = g.index ? g : g;
    if (!x.attributes.uv) { const n = x.attributes.position.count; x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); }
    if (!x.attributes.normal) x.computeVertexNormals();
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    return x.index ? x.toNonIndexed() : x;
  });
  return mergeGeometries(fixed, false);
}
