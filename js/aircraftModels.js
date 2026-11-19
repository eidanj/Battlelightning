// Procedural aircraft: lofted fuselages, airfoil wings with hinged ailerons/flaps, all-moving stabilators,
// rudders, twin/single fins, intakes, nozzles with afterburner flames, retracting gear with doors, AIM-9s on rails,
// bubble canopies, navigation lights and team paint. Parts are grouped by damage component so they can break off.
import * as THREE from 'three';
import { loft, lathe, wingPanel, hingeLine, hinge, mesh, merge } from './geo.js';
import { TEX } from './textures.js';
import { AIRCRAFT } from './config.js';
import { DEG } from './util.js';

const PAINT = {
  navy: { base: 0xa9b0b8, under: 0xc9ced3, dark: 0x5e646b, band: 0x1d4f9c },
  coast: { base: 0xffffff, under: 0xd7dde4, dark: 0x4f5e70, band: 0xb3242a },
  a10navy: { base: 0x77808a, under: 0x8b939c, dark: 0x4f565e, band: 0x1d4f9c },
  a10coast: { base: 0x6d7782, under: 0x87909a, dark: 0x4a525a, band: 0xb3242a },
  f22navy: { base: 0xffffff, under: 0xeceef0, dark: 0x4d5258, band: 0x1d4f9c },
  f22coast: { base: 0xffffff, under: 0xe9ecf1, dark: 0x4a525c, band: 0xb3242a },
};
const matCache = {};
function materials(team, id) {
  const raptor = id === 'f22';
  const key = team + (id === 'a10' ? 'a' : raptor ? 'r' : id === 'f16' ? 'v' : '');
  if (matCache[key]) return matCache[key];
  const p = PAINT[id === 'a10' ? 'a10' + team : raptor ? 'f22' + team : team];
  const camo = team === 'coast' && id !== 'a10' && !raptor;
  const map = raptor ? (team === 'coast' ? TEX.raptorC : TEX.raptor) : camo ? TEX.camo : TEX.panel;
  // the F-22's radar-absorbent coating has a faint metallic sheen
  const skin = new THREE.MeshStandardMaterial({ color: p.base, map, normalMap: TEX.panelN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: raptor ? 0.8 : 0.85, metalness: raptor ? 0.22 : 0.25, roughnessMap: TEX.panelR, envMapIntensity: 0.9 });
  const m = {
    skin,
    under: skin.clone(),
    dark: new THREE.MeshStandardMaterial({ color: p.dark, map: TEX.panel, normalMap: TEX.panelN, roughness: 0.6, metalness: 0.25 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.85 }),
    radome: new THREE.MeshStandardMaterial({ color: 0x8c9097, roughness: 0.45, metalness: 0.1 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x5a524a, roughness: 0.42, metalness: 0.9, normalMap: TEX.panelN, side: THREE.DoubleSide }),
    nozzleIn: new THREE.MeshStandardMaterial({ color: 0x1b1715, roughness: 0.7, metalness: 0.6, emissive: 0xff5a10, emissiveIntensity: 0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: raptor ? 0xd9b04e : id === 'f16' ? 0xe8d6a8 : 0xd8e4ea, roughness: 0.04, metalness: 0.0, transparent: true, opacity: raptor ? 0.32 : 0.22, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x3e4247, roughness: 0.5, metalness: 0.5 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
    strut: new THREE.MeshStandardMaterial({ color: 0xd9dadc, roughness: 0.35, metalness: 0.7 }),
    missile: new THREE.MeshStandardMaterial({ color: 0xdadad4, roughness: 0.4, metalness: 0.3 }),
    band: new THREE.MeshStandardMaterial({ color: p.band, roughness: 0.5, metalness: 0.2 }),
    insig: new THREE.MeshStandardMaterial({ map: TEX.insignia[team], transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, alphaTest: 0.05 }),
    navR: new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }),
    navG: new THREE.MeshBasicMaterial({ color: 0x20ff60, toneMapped: false }),
    navW: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  };
  m.under.color.setHex(p.under);
  matCache[key] = m;
  return m;
}

// ---- afterburner plume (additive, flickering, with shock diamonds) ----
const abMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; varying float vY; void main(){ vUv = uv; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform float uTime; uniform float uAB; varying vec2 vUv; varying float vY;
    float h(float n){ return fract(sin(n)*43758.5453); }
    void main(){ float t = vUv.y; float core = pow(1.0 - t, 1.4);
      float diam = 0.5 + 0.5 * sin(t * 34.0 - uTime * 6.0); diam = pow(diam, 6.0) * (1.0 - t) * 0.9;
      float flick = 0.85 + 0.15 * h(floor(uTime * 40.0) + vUv.x * 7.0);
      vec3 c = mix(vec3(1.0, 0.45, 0.15), vec3(0.5, 0.6, 1.0), smoothstep(0.0, 0.35, 1.0 - t)) * core * 1.6 + vec3(1.0, 0.9, 0.7) * diam * 2.5;
      float a = core * flick * (1.0 - smoothstep(0.85, 1.0, t));
      gl_FragColor = vec4(c * a, a); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
abMat.uniforms.uAB = { value: 1 };
export function abUniforms() { return abMat.uniforms; }

function missileModel(m) {
  const g = new THREE.Group();
  const body = mesh(lathe([[0.001, -1.45], [0.04, -1.38], [0.063, -1.25], [0.064, 1.4], [0.05, 1.45]], 12), m.missile); body.rotation.x = -Math.PI / 2; g.add(body);
  const seeker = mesh(new THREE.SphereGeometry(0.058, 10, 8), m.black); seeker.position.z = -1.42; g.add(seeker);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const fin = mesh(new THREE.BoxGeometry(0.004, 0.2, 0.26), m.missile); fin.position.set(Math.cos(a) * 0.13, Math.sin(a) * 0.13, 1.22); fin.rotation.z = a - Math.PI / 2; g.add(fin);
    const can = mesh(new THREE.BoxGeometry(0.004, 0.12, 0.16), m.missile); can.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, -1.0); can.rotation.z = a - Math.PI / 2; g.add(can);
  }
  const band = mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0xc9a53a })); band.rotation.x = Math.PI / 2; band.position.z = -0.6; g.add(band);
  return g;
}
export function makeMissileMesh(team = 'navy') { return missileModel(materials(team, 'f16')); }

// ---------- generic assembly helpers ----------
function addWing(grp, p, m, ctl) {
  // ctl: { c: hinge chord fraction, s0, s1 } produces a hinged trailing-edge control surface
  if (!ctl) { grp.add(mesh(wingPanel(p), m)); return null; }
  const { c, s0, s1 } = ctl;
  if (s0 > 0) grp.add(mesh(wingPanel(p, 0, s0), m));
  grp.add(mesh(wingPanel(p, s0, s1, 0, c), m));
  if (s1 < 1) grp.add(mesh(wingPanel(p, s1, 1), m));
  const surf = mesh(wingPanel(p, s0, s1, c, 1), m);
  const [a, b] = hingeLine(p, s0, s1, c);
  const pv = hinge(surf, a, b);
  grp.add(pv);
  return pv;
}
function vfin(p, m, cant = 0, side = 1) {
  // build a vertical surface: span along +y. Built as a horizontal panel then rotated about z
  const g = new THREE.Group();
  const q = { ...p, root: [0, 0, p.root[2]], mirror: false };
  const fixed = new THREE.Group();
  fixed.add(mesh(wingPanel(q, 0, 1, 0, 0.7), m));
  const surf = mesh(wingPanel(q, 0.08, 0.92, 0.7, 1), m);
  const [a, b] = hingeLine(q, 0.08, 0.92, 0.7);
  const rud = hinge(surf, a, b);
  fixed.add(rud);
  fixed.add(mesh(wingPanel(q, 0.92, 1, 0.7, 1), m));
  fixed.rotation.z = Math.PI / 2 - cant * side;
  fixed.position.set(p.root[0], p.root[1], 0);
  g.add(fixed);
  return { g, rud };
}
function nozzle(m, r, len = 1.3) {
  const g = new THREE.Group();
  const outer = mesh(lathe([[r * 1.02, 0], [r * 0.97, len * 0.45], [r * 0.86, len]], 20), m.nozzle);
  outer.rotation.x = Math.PI / 2; g.add(outer);
  const lip = mesh(new THREE.TorusGeometry(r * 0.87, r * 0.035, 6, 24), m.nozzle); lip.position.z = len; g.add(lip);
  const inner = mesh(new THREE.CircleGeometry(r * 0.84, 20), m.nozzleIn); inner.position.z = len * 0.45; g.add(inner);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(r * 0.72, r * 9, 16, 1, true), abMat);
  flame.rotation.x = Math.PI / 2; flame.position.z = len + r * 4.5; flame.visible = false; flame.renderOrder = 6; g.add(flame);
  // no per-engine point light: changing the number of lights in the scene makes three.js recompile every shader
  g.userData = { flame, inner, r };
  return g;
}
// F-22 two-dimensional thrust-vectoring nozzle: a squared-off duct with flat upper and lower flaps
function rectNozzle(m, r, len = 1.3) {
  const g = new THREE.Group();
  g.add(mesh(loft([{ z: 0, w: r * 1.12, h: r * 0.98, n: 7 }, { z: len * 0.55, w: r * 1.08, h: r * 0.86, n: 7 }, { z: len, w: r * 1.04, h: r * 0.62, n: 8 }], { seg: 24, sub: 2 }), m.nozzle));
  for (const sd of [-1, 1]) { const flap = mesh(new THREE.BoxGeometry(r * 2.1, 0.03, len * 0.5), m.nozzle); flap.position.set(0, sd * r * 0.66, len * 0.8); flap.rotation.x = sd * 0.12; g.add(flap); }
  const inner = mesh(new THREE.PlaneGeometry(r * 1.9, r * 1.3), m.nozzleIn); inner.position.z = len * 0.45; g.add(inner);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(r * 0.72, r * 9, 16, 1, true), abMat);
  flame.rotation.x = Math.PI / 2; flame.position.z = len + r * 4.5; flame.visible = false; flame.renderOrder = 6; g.add(flame);
  g.userData = { flame, inner, r };
  return g;
}
function gearLeg(m, attachY, wheelY, r, main, twin = false) {
  const leg = new THREE.Group();
  const L = attachY - (wheelY + r);
  const strut = mesh(new THREE.CylinderGeometry(main ? 0.08 : 0.06, main ? 0.1 : 0.07, L, 8), m.strut); strut.position.y = -L / 2; leg.add(strut);
  const oleo = mesh(new THREE.CylinderGeometry(main ? 0.12 : 0.09, main ? 0.12 : 0.09, L * 0.35, 8), m.strut); oleo.position.y = -L * 0.3; leg.add(oleo);
  const wheels = twin ? [-0.17, 0.17] : [0];
  for (const o of wheels) {
    const tire = mesh(new THREE.TorusGeometry(r * 0.72, r * 0.3, 8, 18), m.tire); tire.rotation.y = Math.PI / 2; tire.position.set(o, -L, 0); leg.add(tire);
    const hub = mesh(new THREE.CylinderGeometry(r * 0.48, r * 0.48, r * 0.5, 14), m.strut); hub.rotation.z = Math.PI / 2; hub.position.set(o, -L, 0); leg.add(hub);
  }
  return leg;
}
function navLights(grp, m, tipL, tipR, tail) {
  const g = new THREE.SphereGeometry(0.07, 6, 4);
  const l = new THREE.Mesh(g, m.navR); l.position.copy(tipL); grp.add(l);
  const r = new THREE.Mesh(g, m.navG); r.position.copy(tipR); grp.add(r);
  const t = new THREE.Mesh(g, m.navW); t.position.copy(tail); grp.add(t);
  return [l, r, t];
}
function insignia(grp, m, x, y, z, size, rotY, rotZ = 0) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m.insig);
  p.position.set(x, y, z); p.rotation.set(0, rotY, rotZ); grp.add(p); return p;
}

// ---------- the five aircraft ----------
const SPECS = {
  f16(m, P) {
    const fus = loft([
      { z: -7.25, w: 0.04, h: 0.04, y: 0.1 }, { z: -6.7, w: 0.28, h: 0.3, hb: 0.28, y: 0.08 }, { z: -5.7, w: 0.47, h: 0.47, hb: 0.44, y: 0.1 },
      { z: -4.7, w: 0.56, h: 0.56, hb: 0.48, y: 0.12 }, { z: -3.6, w: 0.62, h: 0.6, hb: 0.54, y: 0.12 }, { z: -2.4, w: 0.72, h: 0.6, hb: 0.6, y: 0.08, n: 2.3 },
      { z: -0.8, w: 0.9, h: 0.55, hb: 0.66, y: 0.04, n: 2.6 }, { z: 1.2, w: 0.9, h: 0.5, hb: 0.64, y: 0.02, n: 2.6 }, { z: 3.4, w: 0.78, h: 0.5, hb: 0.56 },
      { z: 5.4, w: 0.64, h: 0.52, hb: 0.52 }, { z: 6.6, w: 0.58, h: 0.56, hb: 0.56 }, { z: 7.25, w: 0.57, h: 0.57, hb: 0.57 },
    ], { seg: 28, open: [{ z0: -4.75, z1: -2.45, a0: Math.PI * 0.72, a1: Math.PI * 1.28 }] });
    P.fuselage.add(mesh(fus, m.skin));
    const radome = mesh(loft([{ z: -7.65, w: 0.015, h: 0.015, y: 0.1 }, { z: -7.25, w: 0.05, h: 0.05, y: 0.1 }, { z: -6.75, w: 0.27, h: 0.29, hb: 0.27, y: 0.08 }], { seg: 20, sub: 2 }), m.radome); P.fuselage.add(radome);
    P.fuselage.add(mesh(loft([{ z: -3.9, w: 0.5, h: 0.24, hb: 0.3, y: -0.62, n: 4 }, { z: -2.5, w: 0.58, h: 0.3, hb: 0.34, y: -0.66, n: 4 }, { z: 0.5, w: 0.62, h: 0.3, hb: 0.26, y: -0.62, n: 3.5 }, { z: 2.4, w: 0.5, h: 0.2, hb: 0.12, y: -0.5 }], { seg: 20 }), m.skin));
    const intakeLip = mesh(new THREE.RingGeometry(0.0, 0.42, 20), m.black); intakeLip.scale.set(1.15, 0.62, 1); intakeLip.position.set(0, -0.62, -3.89); intakeLip.rotation.y = Math.PI; P.fuselage.add(intakeLip);
    // strakes (LERX)
    for (const s of [-1, 1]) P.fuselage.add(mesh(wingPanel({ root: [0.55, 0.06, -4.4], span: 0.42, rootChord: 4.4, tipChord: 0.4, sweep: 78 * DEG, tRoot: 0.03, mirror: s < 0, nChord: 6, nSpan: 2 }), m.skin));
    const wing = { root: [0.75, 0.02, -1.15], span: 4.2, rootChord: 4.7, tipChord: 1.05, sweep: 40 * DEG, tRoot: 0.042, tTip: 0.04 };
    P.ailR = addWing(P.wingR, wing, m.skin, { c: 0.72, s0: 0.05, s1: 0.78 });
    P.ailL = addWing(P.wingL, { ...wing, mirror: true }, m.skin, { c: 0.72, s0: 0.05, s1: 0.78 });
    const stab = { root: [0.55, 0.05, 4.95], span: 2.55, rootChord: 2.35, tipChord: 0.85, sweep: 40 * DEG, dihedral: -10 * DEG, tRoot: 0.04 };
    P.stabR = new THREE.Group(); P.stabR.position.set(0.6, 0.05, 6.0); P.stabR.add(mesh(wingPanel({ ...stab, root: [-0.05, 0, -1.05] }), m.skin)); P.tail.add(P.stabR);
    P.stabL = new THREE.Group(); P.stabL.position.set(-0.6, 0.05, 6.0); P.stabL.add(mesh(wingPanel({ ...stab, root: [-0.05, 0, -1.05], mirror: true }), m.skin)); P.tail.add(P.stabL);
    const fin = vfin({ root: [0, 0.5, 3.85], span: 2.9, rootChord: 3.55, tipChord: 1.15, sweep: 47 * DEG, tRoot: 0.04 }, m.skin);
    P.tail.add(fin.g); P.rudders = [fin.rud];
    for (const s of [-1, 1]) { const v = mesh(wingPanel({ root: [0, 0, 4.6], span: 0.6, rootChord: 1.3, tipChord: 0.7, sweep: 35 * DEG, tRoot: 0.04 }), m.skin); v.rotation.z = -Math.PI / 2 - s * 0.5; v.position.set(s * 0.5, -0.45, 0); P.tail.add(v); }
    insignia(P.tail, m, 0.06, 2.0, 5.8, 0.85, Math.PI / 2); insignia(P.tail, m, -0.06, 2.0, 5.8, 0.85, -Math.PI / 2);
    P.canopy.add(mesh(loft([{ z: -4.85, w: 0.04, h: 0.03, y: 0.58 }, { z: -4.4, w: 0.36, h: 0.32, y: 0.56 }, { z: -3.7, w: 0.47, h: 0.55, y: 0.55 }, { z: -3.0, w: 0.45, h: 0.5, y: 0.55 }, { z: -2.45, w: 0.33, h: 0.3, y: 0.56 }, { z: -2.1, w: 0.12, h: 0.08, y: 0.58 }], { seg: 24, angle: [Math.PI / 2, Math.PI * 1.5], sub: 3 }), m.glass));
    P.canopy.add(frameArch(m, -3.55, 0.55, 0.47, 0.55));
    return { nozzles: [[0, 0.02, 7.15, 0.56]], gun: [-0.78, 0.36, -2.9], intakeY: -0.62 };
  },

  f14(m, P) {
    P.fuselage.add(mesh(loft([
      { z: -9.6, w: 0.05, h: 0.05, y: 0 }, { z: -8.9, w: 0.45, h: 0.45, y: 0.0 }, { z: -7.8, w: 0.72, h: 0.72, hb: 0.66, y: 0.05 },
      { z: -6.4, w: 0.84, h: 0.86, hb: 0.74, y: 0.12 }, { z: -4.8, w: 0.88, h: 0.96, hb: 0.8, y: 0.2 }, { z: -3.2, w: 0.92, h: 0.92, hb: 0.84, y: 0.2 },
      { z: -1.6, w: 1.05, h: 0.7, hb: 0.8, y: 0.12 }, { z: 0.2, w: 1.25, h: 0.5, hb: 0.6, y: 0.0 }, { z: 2.6, w: 1.2, h: 0.4, hb: 0.42, y: 0.0, n: 3 }, { z: 7.2, w: 1.0, h: 0.32, hb: 0.3, y: 0.0, n: 4 }, { z: 9.0, w: 0.5, h: 0.12, hb: 0.12, y: 0.0, n: 4 },
    ], { seg: 30, open: [{ z0: -6.3, z1: -2.3, a0: Math.PI * 0.72, a1: Math.PI * 1.28 }] }), m.skin));
    P.fuselage.add(mesh(loft([{ z: -10.05, w: 0.02, h: 0.02 }, { z: -9.6, w: 0.05, h: 0.05 }, { z: -8.95, w: 0.44, h: 0.44 }], { seg: 20, sub: 2 }), m.radome));
    // pancake between the nacelles
    P.fuselage.add(mesh(loft([{ z: -2.6, w: 1.4, h: 0.2, hb: 0.2, y: -0.15, n: 5 }, { z: 0, w: 2.2, h: 0.34, hb: 0.3, y: -0.1, n: 7 }, { z: 6.0, w: 2.2, h: 0.32, hb: 0.28, y: -0.05, n: 7 }, { z: 8.0, w: 1.8, h: 0.16, hb: 0.14, y: -0.05, n: 7 }], { seg: 24 }), m.skin));
    for (const s of [-1, 1]) {
      P.engine.add(mesh(loft([{ z: -3.6, w: 0.5, h: 0.62, hb: 0.62, y: -0.35, x: s * 1.5, n: 7 }, { z: -2.0, w: 0.58, h: 0.66, hb: 0.66, y: -0.35, x: s * 1.45, n: 5 }, { z: 1.5, w: 0.62, h: 0.64, hb: 0.64, y: -0.3, x: s * 1.38, n: 3 }, { z: 6.0, w: 0.62, h: 0.62, hb: 0.62, y: -0.18, x: s * 1.35 }, { z: 8.95, w: 0.57, h: 0.57, hb: 0.57, y: -0.12, x: s * 1.35 }], { seg: 22 }), m.skin));
      const lip = mesh(new THREE.PlaneGeometry(0.95, 1.18), m.black); lip.position.set(s * 1.5, -0.35, -3.58); lip.rotation.y = Math.PI; P.engine.add(lip);
    }
    // gloves
    for (const s of [-1, 1]) P.fuselage.add(mesh(wingPanel({ root: [1.9, 0.08, -3.9], span: 1.15, rootChord: 7.6, tipChord: 3.6, sweep: 68 * DEG, tRoot: 0.05, mirror: s < 0, nChord: 8 }), m.skin));
    // swinging outer wings around the pivots
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(s * 2.75, 0.1, -0.7);
      const wingP = { root: [-0.4, 0, -0.9], span: 7.2, rootChord: 3.1, tipChord: 1.05, sweep: 20 * DEG, tRoot: 0.05, tTip: 0.045, mirror: s < 0 };
      const grp = new THREE.Group(); pivot.add(grp);
      const ail = addWing(grp, wingP, m.skin, { c: 0.72, s0: 0.12, s1: 0.85 });
      (s > 0 ? P.wingR : P.wingL).add(pivot);
      if (s > 0) { P.sweepR = pivot; P.ailR = ail; } else { P.sweepL = pivot; P.ailL = ail; }
    }
    const stab = { root: [-0.1, 0, -1.4], span: 3.3, rootChord: 3.0, tipChord: 1.05, sweep: 50 * DEG, tRoot: 0.04 };
    P.stabR = new THREE.Group(); P.stabR.position.set(1.95, -0.1, 7.4); P.stabR.add(mesh(wingPanel(stab), m.skin)); P.tail.add(P.stabR);
    P.stabL = new THREE.Group(); P.stabL.position.set(-1.95, -0.1, 7.4); P.stabL.add(mesh(wingPanel({ ...stab, mirror: true }), m.skin)); P.tail.add(P.stabL);
    P.rudders = [];
    for (const s of [-1, 1]) {
      const f = vfin({ root: [s * 1.6, 0.3, 4.6], span: 2.75, rootChord: 3.6, tipChord: 1.2, sweep: 45 * DEG, tRoot: 0.045 }, m.skin, 5 * DEG, s);
      P.tail.add(f.g); P.rudders.push(f.rud);
      insignia(P.tail, m, s * 1.6 + s * 0.12, 1.85, 6.45, 0.95, s * Math.PI / 2, 0);
      const v = mesh(wingPanel({ root: [0, 0, 6.0], span: 0.7, rootChord: 1.6, tipChord: 0.9, sweep: 40 * DEG, tRoot: 0.04 }), m.skin); v.rotation.z = -Math.PI / 2 - s * 0.25; v.position.set(s * 1.4, -0.85, 0); P.tail.add(v);
    }
    P.canopy.add(mesh(loft([{ z: -6.35, w: 0.047, h: 0.030, y: 0.740 }, { z: -5.9, w: 0.562, h: 0.340, y: 0.740 }, { z: -5.0, w: 0.702, h: 0.500, y: 0.740 }, { z: -3.8, w: 0.702, h: 0.480, y: 0.740 }, { z: -2.8, w: 0.585, h: 0.340, y: 0.740 }, { z: -2.2, w: 0.292, h: 0.120, y: 0.740 }], { seg: 24, angle: [Math.PI / 2, Math.PI * 1.5] }), m.glass));
    P.canopy.add(frameArch(m, -5.65, 0.74, 0.64, 0.43)); P.canopy.add(frameArch(m, -4.25, 0.74, 0.7, 0.49));
    return { nozzles: [[-1.35, -0.12, 8.85, 0.56], [1.35, -0.12, 8.85, 0.56]], gun: [-0.62, -0.32, -6.6] };
  },

  f18(m, P) {
    P.fuselage.add(mesh(loft([
      { z: -8.45, w: 0.04, h: 0.04 }, { z: -7.9, w: 0.36, h: 0.36 }, { z: -6.8, w: 0.6, h: 0.6, hb: 0.56, y: 0.04 }, { z: -5.5, w: 0.7, h: 0.72, hb: 0.62, y: 0.1 },
      { z: -4.4, w: 0.72, h: 0.82, hb: 0.64, y: 0.16 }, { z: -3.0, w: 0.8, h: 0.76, hb: 0.7, y: 0.14 }, { z: -1.4, w: 0.95, h: 0.64, hb: 0.74, y: 0.08, n: 2.5 },
      { z: 1.0, w: 1.15, h: 0.56, hb: 0.66, y: 0.04, n: 3 }, { z: 4.0, w: 1.15, h: 0.5, hb: 0.56, n: 3 }, { z: 6.6, w: 1.06, h: 0.45, hb: 0.46, n: 3 }, { z: 8.05, w: 1.0, h: 0.44, hb: 0.44, n: 3 },
    ], { seg: 28, open: [{ z0: -5.4, z1: -2.9, a0: Math.PI * 0.72, a1: Math.PI * 1.28 }] }), m.skin));
    P.fuselage.add(mesh(loft([{ z: -8.85, w: 0.015, h: 0.015 }, { z: -8.45, w: 0.05, h: 0.05 }, { z: -7.85, w: 0.35, h: 0.35 }], { seg: 20, sub: 2 }), m.radome));
    for (const s of [-1, 1]) {
      P.fuselage.add(mesh(wingPanel({ root: [0.7, 0.05, -6.3], span: 1.0, rootChord: 6.2, tipChord: 0.3, sweep: 74 * DEG, tRoot: 0.03, mirror: s < 0, nChord: 8, nSpan: 3 }), m.skin));
      P.engine.add(mesh(loft([{ z: -2.6, w: 0.32, h: 0.42, hb: 0.42, y: -0.4, x: s * 1.02, n: 5 }, { z: -1.0, w: 0.36, h: 0.44, hb: 0.44, y: -0.4, x: s * 1.0, n: 4 }, { z: 1.5, w: 0.3, h: 0.36, hb: 0.36, y: -0.36, x: s * 0.92, n: 3 }], { seg: 18 }), m.skin));
      const lip = mesh(new THREE.PlaneGeometry(0.62, 0.82), m.black); lip.position.set(s * 1.02, -0.4, -2.58); lip.rotation.y = Math.PI; P.engine.add(lip);
    }
    const wing = { root: [1.0, 0.06, -0.7], span: 5.15, rootChord: 4.0, tipChord: 1.6, sweep: 26 * DEG, dihedral: -3 * DEG, tRoot: 0.05, tTip: 0.04 };
    P.ailR = addWing(P.wingR, wing, m.skin, { c: 0.7, s0: 0.08, s1: 0.82 });
    P.ailL = addWing(P.wingL, { ...wing, mirror: true }, m.skin, { c: 0.7, s0: 0.08, s1: 0.82 });
    const stab = { root: [-0.05, 0, -1.2], span: 2.65, rootChord: 2.4, tipChord: 0.95, sweep: 42 * DEG, dihedral: -2 * DEG, tRoot: 0.04 };
    P.stabR = new THREE.Group(); P.stabR.position.set(0.95, 0.0, 6.5); P.stabR.add(mesh(wingPanel(stab), m.skin)); P.tail.add(P.stabR);
    P.stabL = new THREE.Group(); P.stabL.position.set(-0.95, 0.0, 6.5); P.stabL.add(mesh(wingPanel({ ...stab, mirror: true }), m.skin)); P.tail.add(P.stabL);
    P.rudders = [];
    for (const s of [-1, 1]) {
      const f = vfin({ root: [s * 1.25, 0.45, 3.4], span: 2.55, rootChord: 2.9, tipChord: 1.1, sweep: 36 * DEG, tRoot: 0.045 }, m.skin, 20 * DEG, s);
      P.tail.add(f.g); P.rudders.push(f.rud);
      const ins = insignia(P.tail, m, s * (1.25 + 0.55), 1.55, 4.6, 0.8, s * Math.PI / 2, 0); ins.rotation.set(0, s * Math.PI / 2, 0); ins.rotateX(-20 * DEG * s * 0);
    }
    P.canopy.add(mesh(loft([{ z: -5.45, w: 0.046, h: 0.030, y: 0.640 }, { z: -5.0, w: 0.487, h: 0.500, y: 0.640 }, { z: -4.2, w: 0.580, h: 0.660, y: 0.640 }, { z: -3.4, w: 0.534, h: 0.600, y: 0.640 }, { z: -2.85, w: 0.290, h: 0.340, y: 0.640 }], { seg: 24, angle: [Math.PI / 2, Math.PI * 1.5] }), m.glass));
    P.canopy.add(frameArch(m, -4.75, 0.64, 0.56, 0.6));
    return { nozzles: [[-0.56, -0.08, 7.95, 0.42], [0.56, -0.08, 7.95, 0.42]], gun: [0, 0.42, -8.1] };
  },

  su27(m, P) {
    P.fuselage.add(mesh(loft([
      { z: -11.0, w: 0.04, h: 0.04, y: -0.12 }, { z: -10.2, w: 0.48, h: 0.48, y: -0.06 }, { z: -8.8, w: 0.78, h: 0.8, hb: 0.74, y: 0.1 },
      { z: -7.2, w: 0.86, h: 0.98, hb: 0.78, y: 0.22 }, { z: -5.6, w: 0.92, h: 0.9, hb: 0.76, y: 0.28 }, { z: -4.0, w: 1.05, h: 0.72, hb: 0.6, y: 0.24, n: 2.4 },
      { z: -2.0, w: 1.45, h: 0.56, hb: 0.42, y: 0.1, n: 3.2 }, { z: 0.5, w: 1.65, h: 0.5, hb: 0.38, y: 0.06, n: 4 }, { z: 3.5, w: 1.62, h: 0.44, hb: 0.36, y: 0.04, n: 4 },
      { z: 6.4, w: 1.2, h: 0.38, hb: 0.32, y: 0.04, n: 3.5 }, { z: 8.6, w: 0.5, h: 0.3, hb: 0.28, y: 0.02 }, { z: 10.5, w: 0.12, h: 0.12, y: 0.02 },
    ], { seg: 30, open: [{ z0: -7.7, z1: -4.6, a0: Math.PI * 0.72, a1: Math.PI * 1.28 }] }), m.skin));
    P.fuselage.add(mesh(loft([{ z: -11.4, w: 0.015, h: 0.015, y: -0.13 }, { z: -11.0, w: 0.05, h: 0.05, y: -0.12 }, { z: -10.15, w: 0.47, h: 0.47, y: -0.06 }], { seg: 20, sub: 2 }), m.radome));
    for (const s of [-1, 1]) {
      P.fuselage.add(mesh(wingPanel({ root: [0.85, 0.12, -6.4], span: 1.25, rootChord: 6.6, tipChord: 0.4, sweep: 77 * DEG, tRoot: 0.03, mirror: s < 0, nChord: 8, nSpan: 3 }), m.skin));
      P.engine.add(mesh(loft([{ z: -3.9, w: 0.58, h: 0.36, hb: 0.36, y: -0.6, x: s * 1.2, n: 7 }, { z: -1.5, w: 0.64, h: 0.52, hb: 0.5, y: -0.52, x: s * 1.24, n: 5 }, { z: 3.0, w: 0.64, h: 0.64, hb: 0.62, y: -0.42, x: s * 1.25, n: 3 }, { z: 7.5, w: 0.64, h: 0.64, hb: 0.64, y: -0.34, x: s * 1.25 }, { z: 9.45, w: 0.6, h: 0.6, hb: 0.6, y: -0.32, x: s * 1.25 }], { seg: 22 }), m.skin));
      const lip = mesh(new THREE.PlaneGeometry(1.1, 0.7), m.black); lip.position.set(s * 1.2, -0.6, -3.88); lip.rotation.y = Math.PI; P.engine.add(lip);
    }
    const wing = { root: [1.65, 0.04, -1.6], span: 5.7, rootChord: 5.6, tipChord: 1.35, sweep: 42 * DEG, dihedral: -2 * DEG, tRoot: 0.045, tTip: 0.035 };
    P.ailR = addWing(P.wingR, wing, m.skin, { c: 0.74, s0: 0.1, s1: 0.85 });
    P.ailL = addWing(P.wingL, { ...wing, mirror: true }, m.skin, { c: 0.74, s0: 0.1, s1: 0.85 });
    const stab = { root: [-0.1, 0, -1.3], span: 2.7, rootChord: 2.8, tipChord: 1.0, sweep: 45 * DEG, tRoot: 0.04 };
    P.stabR = new THREE.Group(); P.stabR.position.set(1.95, -0.25, 7.6); P.stabR.add(mesh(wingPanel(stab), m.skin)); P.tail.add(P.stabR);
    P.stabL = new THREE.Group(); P.stabL.position.set(-1.95, -0.25, 7.6); P.stabL.add(mesh(wingPanel({ ...stab, mirror: true }), m.skin)); P.tail.add(P.stabL);
    P.rudders = [];
    for (const s of [-1, 1]) {
      const f = vfin({ root: [s * 2.2, 0.05, 4.4], span: 3.4, rootChord: 3.8, tipChord: 1.35, sweep: 40 * DEG, tRoot: 0.045 }, m.skin, 0, s);
      P.tail.add(f.g); P.rudders.push(f.rud);
      insignia(P.tail, m, s * 2.27, 1.9, 6.6, 1.0, s * Math.PI / 2);
      const v = mesh(wingPanel({ root: [0, 0, 6.4], span: 0.8, rootChord: 1.6, tipChord: 0.9, sweep: 40 * DEG, tRoot: 0.04 }), m.skin); v.rotation.z = -Math.PI / 2; v.position.set(s * 1.7, -0.75, 0); P.tail.add(v);
    }
    P.canopy.add(mesh(loft([{ z: -7.8, w: 0.052, h: 0.030, y: 0.850 }, { z: -7.3, w: 0.572, h: 0.370, y: 0.850 }, { z: -6.4, w: 0.702, h: 0.590, y: 0.850 }, { z: -5.4, w: 0.676, h: 0.530, y: 0.850 }, { z: -4.7, w: 0.416, h: 0.290, y: 0.850 }, { z: -4.3, w: 0.156, h: 0.060, y: 0.850 }], { seg: 24, angle: [Math.PI / 2, Math.PI * 1.5] }), m.glass));
    P.canopy.add(frameArch(m, -7.05, 0.85, 0.65, 0.46));
    return { nozzles: [[-1.25, -0.32, 9.35, 0.62], [1.25, -0.32, 9.35, 0.62]], gun: [0.98, 0.3, -3.7] };
  },

  f22(m, P) {
    // chined nose (diamond-ish section) blending into a wide, flat lifting body
    P.fuselage.add(mesh(loft([
      { z: -9.1, w: 0.03, h: 0.03, y: 0.0 }, { z: -8.5, w: 0.4, h: 0.26, hb: 0.24, y: 0.02, n: 1.45, nb: 1.5 }, { z: -7.3, w: 0.74, h: 0.5, hb: 0.38, y: 0.08, n: 1.55, nb: 1.6 },
      { z: -6.0, w: 0.94, h: 0.7, hb: 0.46, y: 0.16, n: 1.8, nb: 1.7 }, { z: -4.6, w: 1.2, h: 0.66, hb: 0.52, y: 0.18, n: 2.3, nb: 2.1 }, { z: -3.0, w: 1.78, h: 0.62, hb: 0.6, y: 0.14, n: 3, nb: 3 },
      { z: -1.0, w: 2.06, h: 0.6, hb: 0.66, y: 0.1, n: 3.6, nb: 3.6 }, { z: 1.6, w: 2.16, h: 0.55, hb: 0.62, y: 0.08, n: 3.6, nb: 3.6 }, { z: 4.6, w: 2.02, h: 0.48, hb: 0.55, y: 0.06, n: 3.6, nb: 3.4 },
      { z: 7.0, w: 1.78, h: 0.42, hb: 0.46, y: 0.06, n: 3.2, nb: 3 }, { z: 8.4, w: 1.62, h: 0.36, hb: 0.36, y: 0.08, n: 3, nb: 3 }, { z: 9.0, w: 1.5, h: 0.3, hb: 0.3, y: 0.08, n: 3, nb: 3 },
    ], { seg: 32, open: [{ z0: -6.7, z1: -3.7, a0: Math.PI * 0.72, a1: Math.PI * 1.28 }] }), m.skin));
    P.fuselage.add(mesh(loft([{ z: -9.45, w: 0.012, h: 0.012, y: 0.0 }, { z: -9.1, w: 0.035, h: 0.035, y: 0.0 }, { z: -8.45, w: 0.4, h: 0.26, hb: 0.24, y: 0.02, n: 1.45, nb: 1.5 }], { seg: 20, sub: 2 }), m.dark));
    for (const s of [-1, 1]) {
      // chine plate running from the nose into the wing leading edge
      P.fuselage.add(mesh(wingPanel({ root: [0.7, 0.1, -8.2], span: 0.95, rootChord: 6.4, tipChord: 0.3, sweep: 80 * DEG, tRoot: 0.02, mirror: s < 0, nChord: 8, nSpan: 3 }), m.skin));
      // caret intake: raked, diamond-section mouth with a dark duct
      P.engine.add(mesh(loft([{ z: -4.75, w: 0.36, h: 0.4, hb: 0.42, y: -0.12, x: s * 1.42, n: 1.4, nb: 1.4 }, { z: -3.4, w: 0.42, h: 0.44, hb: 0.46, y: -0.1, x: s * 1.5, n: 1.8, nb: 1.8 }, { z: -1.2, w: 0.44, h: 0.46, hb: 0.5, y: -0.06, x: s * 1.45, n: 2.4 }, { z: 1.0, w: 0.4, h: 0.4, hb: 0.44, y: -0.04, x: s * 1.3, n: 2.6 }], { seg: 20 }), m.skin));
      const mouth = mesh(new THREE.PlaneGeometry(0.62, 0.72), m.black); mouth.position.set(s * 1.43, -0.13, -4.72); mouth.rotation.set(0, Math.PI + s * 0.35, 0); P.engine.add(mouth);
    }
    // diamond wing: 42 deg leading edge, trailing edge swept forward, slight anhedral
    const wing = { root: [1.55, 0.1, -2.05], span: 5.23, rootChord: 7.95, tipChord: 1.5, sweep: 42 * DEG, dihedral: -3.25 * DEG, tRoot: 0.042, tTip: 0.03, nChord: 12 };
    P.ailR = addWing(P.wingR, wing, m.skin, { c: 0.76, s0: 0.12, s1: 0.82 });
    P.ailL = addWing(P.wingL, { ...wing, mirror: true }, m.skin, { c: 0.76, s0: 0.12, s1: 0.82 });
    // big all-moving stabilators tucked right behind the wing
    const stab = { root: [-0.1, 0, -1.45], span: 2.55, rootChord: 3.2, tipChord: 1.05, sweep: 42 * DEG, tRoot: 0.035 };
    P.stabR = new THREE.Group(); P.stabR.position.set(1.62, 0.02, 8.0); P.stabR.add(mesh(wingPanel(stab), m.skin)); P.tail.add(P.stabR);
    P.stabL = new THREE.Group(); P.stabL.position.set(-1.62, 0.02, 8.0); P.stabL.add(mesh(wingPanel({ ...stab, mirror: true }), m.skin)); P.tail.add(P.stabL);
    // twin fins canted 28 deg outward
    P.rudders = [];
    for (const s of [-1, 1]) {
      const f = vfin({ root: [s * 1.95, 0.42, 4.75], span: 2.75, rootChord: 3.7, tipChord: 1.35, sweep: 23 * DEG, tRoot: 0.04 }, m.skin, 28 * DEG, s);
      P.tail.add(f.g); P.rudders.push(f.rud);
      const ins = insignia(P.tail, m, s * 2.67, 1.62, 6.35, 0.75, s * Math.PI / 2); ins.rotation.order = 'ZYX'; ins.rotation.z = -s * 28 * DEG; // flat on the canted fin
    }
    // frameless, gold-tinted bubble canopy
    P.canopy.add(mesh(loft([{ z: -6.95, w: 0.05, h: 0.03, y: 0.8 }, { z: -6.3, w: 0.5, h: 0.5, y: 0.8 }, { z: -5.4, w: 0.62, h: 0.76, y: 0.8 }, { z: -4.4, w: 0.62, h: 0.76, y: 0.8 }, { z: -3.5, w: 0.48, h: 0.56, y: 0.8 }, { z: -2.9, w: 0.12, h: 0.12, y: 0.8 }], { seg: 24, angle: [Math.PI / 2, Math.PI * 1.5] }), m.glass));
    return { nozzles: [[-0.82, 0.08, 9.3, 0.55], [0.82, 0.08, 9.3, 0.55]], gun: [1.05, 0.42, -2.6], rectNozzles: true };
  },

  a10(m, P) {
    P.fuselage.add(mesh(loft([
      { z: -8.05, w: 0.3, h: 0.32, y: -0.2 }, { z: -7.3, w: 0.62, h: 0.66, hb: 0.6, y: -0.06 }, { z: -6.2, w: 0.82, h: 0.92, hb: 0.78, y: 0.12 },
      { z: -4.9, w: 0.88, h: 1.05, hb: 0.86, y: 0.22 }, { z: -3.4, w: 0.9, h: 0.98, hb: 0.92, y: 0.2 }, { z: 0, w: 0.92, h: 0.86, hb: 0.96, y: 0.12 },
      { z: 3.0, w: 0.76, h: 0.76, hb: 0.72, y: 0.12 }, { z: 6.0, w: 0.48, h: 0.55, hb: 0.48, y: 0.18 }, { z: 8.05, w: 0.26, h: 0.36, hb: 0.3, y: 0.22 },
    ], { seg: 28, open: [{ z0: -6.2, z1: -3.9, a0: Math.PI * 0.72, a1: Math.PI * 1.28 }] }), m.skin));
    // GAU-8 barrels
    const bar = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), m.frame); bar.rotation.x = Math.PI / 2; bar.position.set(-0.18, -0.55, -8.35); P.fuselage.add(bar);
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const b = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), m.black); b.rotation.x = Math.PI / 2; b.position.set(-0.18 + Math.cos(a) * 0.035, -0.55 + Math.sin(a) * 0.035, -8.65); P.fuselage.add(b); }
    const wing = { root: [0.8, -0.55, -1.25], span: 7.95, rootChord: 3.05, tipChord: 1.85, sweep: 0, dihedral: 4 * DEG, tRoot: 0.13, tTip: 0.11 };
    P.ailR = addWing(P.wingR, wing, m.skin, { c: 0.74, s0: 0.55, s1: 0.94 });
    P.ailL = addWing(P.wingL, { ...wing, mirror: true }, m.skin, { c: 0.74, s0: 0.55, s1: 0.94 });
    for (const s of [-1, 1]) (s > 0 ? P.wingR : P.wingL).add(mesh(loft([{ z: -1.4, w: 0.05, h: 0.05, x: s * 2.65, y: -0.95 }, { z: -0.9, w: 0.32, h: 0.34, x: s * 2.65, y: -0.95 }, { z: 0.6, w: 0.32, h: 0.34, x: s * 2.65, y: -0.92 }, { z: 1.4, w: 0.1, h: 0.12, x: s * 2.65, y: -0.8 }], { seg: 16 }), m.skin));
    for (const s of [-1, 1]) {
      P.engine.add(mesh(loft([{ z: 2.2, w: 0.6, h: 0.6, x: s * 1.45, y: 1.08 }, { z: 2.6, w: 0.68, h: 0.68, x: s * 1.45, y: 1.08 }, { z: 4.4, w: 0.66, h: 0.66, x: s * 1.45, y: 1.08 }, { z: 5.4, w: 0.56, h: 0.56, x: s * 1.45, y: 1.08 }], { seg: 22 }), m.skin));
      const fan = mesh(new THREE.CircleGeometry(0.56, 20), m.black); fan.position.set(s * 1.45, 1.08, 2.21); fan.rotation.y = Math.PI; P.engine.add(fan);
      const py = mesh(new THREE.BoxGeometry(0.6, 0.12, 1.6), m.skin); py.position.set(s * 0.95, 0.75, 3.6); py.rotation.z = s * 0.5; P.engine.add(py);
    }
    const stab = { root: [0.3, 0.32, 6.1], span: 3.0, rootChord: 2.05, tipChord: 1.7, sweep: 0, tRoot: 0.08 };
    P.stabR = new THREE.Group(); P.stabR.add(mesh(wingPanel(stab), m.skin)); P.tail.add(P.stabR);
    P.stabL = new THREE.Group(); P.stabL.add(mesh(wingPanel({ ...stab, mirror: true }), m.skin)); P.tail.add(P.stabL);
    P.rudders = [];
    for (const s of [-1, 1]) {
      const f = vfin({ root: [s * 3.3, -0.6, 5.85], span: 3.25, rootChord: 1.95, tipChord: 1.55, sweep: 3 * DEG, tRoot: 0.08 }, m.skin, 0, s);
      P.tail.add(f.g); P.rudders.push(f.rud);
      insignia(P.tail, m, s * 3.4, 1.4, 6.8, 0.9, s * Math.PI / 2);
    }
    P.canopy.add(mesh(loft([{ z: -6.35, w: 0.056, h: 0.030, y: 0.840 }, { z: -5.9, w: 0.565, h: 0.560, y: 0.840 }, { z: -5.0, w: 0.678, h: 0.740, y: 0.840 }, { z: -4.3, w: 0.621, h: 0.640, y: 0.840 }, { z: -3.95, w: 0.339, h: 0.360, y: 0.840 }], { seg: 24, angle: [Math.PI / 2, Math.PI * 1.5] }), m.glass));
    P.canopy.add(frameArch(m, -5.95, 0.84, 0.6, 0.56));
    return { nozzles: [[-1.45, 1.08, 5.35, 0.52], [1.45, 1.08, 5.35, 0.52]], gun: [-0.18, -0.58, -8.35], noAB: true };
  },
};

const COCKPIT_BOX = { f22: [1.02, 0.75, 2.7, 0.42, -5.15], f16: [0.98, 0.75, 2.3, 0.115, -3.6], f14: [1.42, 0.85, 4.0, 0.345, -4.3], f18: [1.2, 0.8, 2.5, 0.24, -4.15], su27: [1.44, 0.85, 3.1, 0.425, -6.15], a10: [1.4, 0.9, 2.3, 0.39, -5.05] };
function frameArch(m, z, y, w, h) {
  const curve = new THREE.EllipseCurve(0, 0, w, h, 0, Math.PI, false, 0);
  const pts = curve.getPoints(20).map((p) => new THREE.Vector3(p.x, p.y + y, z));
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035, 6, false), m.frame);
}

// Build a full aircraft. Returns { group, parts, update(fm, dt, t) }
export function buildAircraft(id, team = 'navy', opts = {}) {
  const def = AIRCRAFT[id], g = def.geo;
  const m = materials(team, id);
  const group = new THREE.Group();
  const P = { fuselage: new THREE.Group(), wingL: new THREE.Group(), wingR: new THREE.Group(), tail: new THREE.Group(), engine: new THREE.Group(), canopy: new THREE.Group(), gear: [], doors: [] };
  for (const k of ['fuselage', 'wingL', 'wingR', 'tail', 'engine']) { P[k].name = k; group.add(P[k]); }
  P.fuselage.add(P.canopy);
  const info = SPECS[id](m, P);
  // dark cockpit tub under the canopy opening (hides gaps, gives depth through the glass)
  {
    const tubG = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const ix = tubG.index.array, keep = []; for (let f = 0; f < 6; f++) if (f !== 2) for (let k = 0; k < 6; k++) keep.push(ix[f * 6 + k]); tubG.setIndex(keep);
    const tub = new THREE.Mesh(tubG, new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.9, side: THREE.DoubleSide }));
    const ck = COCKPIT_BOX[id]; tub.scale.set(ck[0], ck[1], ck[2]); tub.position.set(0, ck[3], ck[4]); P.fuselage.add(tub);
  }
  // nozzles
  P.nozzles = info.nozzles.map(([x, y, z, r]) => { const n = (info.rectNozzles ? rectNozzle : nozzle)(m, r, r * 1.8); n.position.set(x, y, z - r * 0.9); P.engine.add(n); return n; });
  // landing gear (nose folds forward, mains fold inward)
  const wr = g.wheelR;
  const mkLeg = (pos, r, main, side) => {
    const attachY = main ? Math.min(-0.45, pos[1] + 1.25) : Math.min(-0.42, pos[1] + 1.2);
    const leg = gearLeg(m, attachY, pos[1], r, main, !main && (id === 'f14' || id === 'f18'));
    const piv = new THREE.Group(); piv.position.set(pos[0], attachY, pos[2]); piv.add(leg); P.fuselage.add(piv);
    const door = mesh(new THREE.BoxGeometry(main ? 0.55 : 0.36, 0.02, main ? 1.3 : 1.1), m.under);
    const dp = new THREE.Group(); dp.position.set(pos[0] + (main ? side * 0.32 : 0.18), attachY + 0.02, pos[2]); door.position.x = main ? -side * 0.28 : -0.18; dp.add(door); P.fuselage.add(dp);
    P.gear.push({ piv, main, side }); P.doors.push({ dp, main, side });
  };
  mkLeg(g.gearNose, wr[0], false, 0);
  mkLeg([-g.gearMain[0], g.gearMain[1], g.gearMain[2]], wr[1], true, -1);
  mkLeg(g.gearMain, wr[1], true, 1);
  // tail hook
  const hook = mesh(new THREE.BoxGeometry(0.06, 0.06, 1.6), m.dark); hook.position.z = 0.8;
  P.hook = new THREE.Group(); P.hook.position.set(g.hook[0], g.hook[1], g.hook[2] - 1.4); P.hook.add(hook); P.fuselage.add(P.hook);
  // missiles on their rails
  P.missiles = g.missiles.map(([x, y, z]) => { const ms = missileModel(m); ms.position.set(x, y, z); const host = Math.abs(x) > 2.4 && id !== 'f14' ? (x > 0 ? P.wingR : P.wingL) : P.fuselage; host.add(ms); return ms; });
  if (id === 'f14') { P.missiles[2].parent.remove(P.missiles[2]); P.missiles[3].parent.remove(P.missiles[3]); P.fuselage.add(P.missiles[2], P.missiles[3]); }
  // nav lights
  const tip = g.tips;
  P.nav = navLights(id === 'f14' ? P.fuselage : group, m, new THREE.Vector3(-tip[0], tip[1], tip[2]), new THREE.Vector3(tip[0], tip[1], tip[2]), new THREE.Vector3(0, 0.3, g.tailZ));
  if (id === 'f14') { P.nav[0].parent.remove(P.nav[0]); P.nav[1].parent.remove(P.nav[1]); P.sweepL.add(P.nav[0]); P.sweepR.add(P.nav[1]); P.nav[0].position.set(-6.75, 0, 0.5); P.nav[1].position.set(6.75, 0, 0.5); }
  // shadows
  group.traverse((o) => { if (o.isMesh) { o.castShadow = o.material !== m.glass && o.material !== abMat; o.receiveShadow = true; } });
  // seat / pilot anchor
  P.seat = new THREE.Vector3(0, g.eye[1] - 0.82, g.eye[2] + 0.12);
  const state = { gear: 1, sweep: 0 };
  const update = (fm, dt, t) => {
    const s = fm.surf;
    if (P.ailR) P.ailR.setAngle(-s.roll * 0.35 + fm.flaps * 0.12);
    if (P.ailL) P.ailL.setAngle(-s.roll * 0.35 - fm.flaps * 0.12);
    const stab = -s.pitch * 0.32;
    if (P.stabR) { P.stabR.rotation.x = stab - s.roll * 0.12; }
    if (P.stabL) { P.stabL.rotation.x = stab + s.roll * 0.12; }
    for (const r of P.rudders || []) r.setAngle(s.yaw * 0.45);
    if (P.sweepR) { const a = (fm.sweep * 48) * DEG; P.sweepR.rotation.y = -a; P.sweepL.rotation.y = a; }
    // gear: legs first half, doors throughout
    const gp = fm.gear;
    for (const gr of P.gear) {
      const k = Math.min(1, Math.max(0, (gp - 0.15) / 0.85));
      if (gr.main) gr.piv.rotation.z = -gr.side * (1 - k) * Math.PI / 2 * 0.98;
      else gr.piv.rotation.x = (1 - k) * Math.PI / 2 * 0.95;
      gr.piv.visible = gp > 0.02 || !fm.dmg.gearOk;
      if (!fm.dmg.gearOk) gr.piv.visible = false;
    }
    for (const d of P.doors) { const open = Math.min(1, gp * 4) * (gp < 0.999 ? 1 : 0.85); d.dp.rotation.z = d.main ? d.side * open * 1.45 : open * 1.4; }
    P.hook.rotation.x = fm.gearCmd > 0.5 ? -0.55 : 0;
    // engine glow and afterburner
    for (const n of P.nozzles) {
      const u = n.userData;
      const hot = Math.max(0, (fm.rpm - 0.55) / 0.45);
      // cold engine: no glow; a turbofan without afterburner (A-10) only warms faintly
      u.inner.material.emissiveIntensity = (info.noAB ? 0.03 : 0.2) * Math.min(1, fm.rpm / 0.6) + hot * (info.noAB ? 0.05 : 1.2) + fm.ab * 6;
      u.flame.visible = fm.ab > 0.02;
      if (u.flame.visible) { const k = 0.5 + 0.5 * fm.ab; u.flame.scale.set(k, 0.6 + 0.6 * fm.ab + Math.random() * 0.06, k); }
    }
    // strobe
    if (P.nav) P.nav[2].visible = (t % 1.2) < 0.08;
  };
  return { group, parts: P, mats: m, update, info, id, team };
}
