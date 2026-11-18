// Naval task force: a supercarrier (angled flight deck, island, catapults, arresting wires, IFLOLS), two battleships
// and three destroyers. Ships ride the swell, leave wakes, steam a slow circle, and expose their AA mounts.
import * as THREE from 'three';
import { loft, boxUV, mesh, merge, place, tube } from './geo.js';
import { TEX, textTex } from './textures.js';
import { waveHeight } from './ocean.js';
import { WORLD } from './config.js';
import { clamp, damp } from './util.js';

const HAZE = 0x8a9198, DARK = 0x4a4f55;

function hullMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.2, map: TEX.panel, normalMap: TEX.panelN, normalScale: new THREE.Vector2(0.4, 0.4) });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLY;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 hc = vec3(0.25, 0.27, 0.29);
  if (vLY < 0.9) hc = vec3(0.03, 0.03, 0.035);
  if (vLY < -0.6) hc = vec3(0.26, 0.045, 0.035);
  diffuseColor.rgb *= hc * 1.15;`);
  };
  return m;
}

function grey(c = HAZE, rough = 0.7) { return new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.25, map: TEX.panel, normalMap: TEX.panelN, normalScale: new THREE.Vector2(0.3, 0.3) }); }

// ---------------------------------------------------------------- CIWS / gun mounts (shared with ground AA)
export function makeCIWS(mat) {
  const g = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(1.3, 1.5, 1.4, 14), mat); base.position.y = 0.7; g.add(base);
  const yaw = new THREE.Group(); yaw.position.y = 1.4; g.add(yaw);
  const body = mesh(new THREE.BoxGeometry(1.8, 1.6, 2.2), mat); body.position.set(0, 0.8, 0.2); yaw.add(body);
  const pitch = new THREE.Group(); pitch.position.set(0, 1.4, 0); yaw.add(pitch);
  const dome = mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.5 }));
  dome.position.y = 1.0; pitch.add(dome);
  const cap = mesh(new THREE.SphereGeometry(0.9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), dome.material); cap.position.y = 2.1; pitch.add(cap);
  const barrel = mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.6, roughness: 0.4 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.2, -1.5); pitch.add(barrel);
  g.userData = { yaw, pitch, muzzle: new THREE.Vector3(0, 0.2, -2.9), parentOfMuzzle: pitch };
  return g;
}
export function makeTurret(mat, barrels = 2, scale = 1) {
  const g = new THREE.Group();
  const yaw = new THREE.Group(); g.add(yaw);
  const sh = new THREE.Shape(); sh.moveTo(-2.2, -2.2); sh.lineTo(2.2, -2.2); sh.lineTo(2.6, 0.6); sh.lineTo(1.6, 3.2); sh.lineTo(-1.6, 3.2); sh.lineTo(-2.6, 0.6); sh.closePath();
  const tg = new THREE.ExtrudeGeometry(sh, { depth: 2.2, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 2 }); tg.rotateX(-Math.PI / 2);
  const body = mesh(tg, mat); yaw.add(body);
  const pitch = new THREE.Group(); pitch.position.set(0, 1.2, -2.8); yaw.add(pitch);
  for (let i = 0; i < barrels; i++) {
    const b = mesh(new THREE.CylinderGeometry(0.13, 0.2, 6, 10), mat); b.rotation.x = Math.PI / 2; b.position.set((i - (barrels - 1) / 2) * 0.9, 0, -3); pitch.add(b);
  }
  g.scale.setScalar(scale);
  g.userData = { yaw, pitch, muzzle: new THREE.Vector3(0, 0, -6.2), parentOfMuzzle: pitch };
  return g;
}

// ---------------------------------------------------------------- CARRIER
// deck outline in ship-local x (starboard +) / z (bow -)
const DECK = [[-10, -166], [10, -166], [19, -150], [23, -120], [26, -90], [38, -70], [38, 60], [33, 95], [33, 150], [24, 166], [-22, 166], [-30, 120],
  [-41, 92], [-42, 30], [-36, -10], [-27, -50], [-21, -100], [-16, -140]];
let _tp = null, _tt = null;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const CARRIER_DECK_Y = 21.4;
// landing area axis (angled 9 degrees to port)
export const LANDING = { a: new THREE.Vector3(-3, 0, 160), b: new THREE.Vector3(-39, 0, -66), wires: [104, 92, 80, 68], width: 26 };
export const CATS = [
  { start: new THREE.Vector3(9, 0, -62), end: new THREE.Vector3(9, 0, -160) },
  { start: new THREE.Vector3(-8, 0, -62), end: new THREE.Vector3(-8, 0, -160) },
];

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function buildCarrier() {
  const g = new THREE.Group();
  const hullM = hullMaterial(), steel = grey(), dark = grey(DARK, 0.8);
  // hull: stations bow(-z) -> stern(+z)
  const st = [];
  const L = 160;
  const prof = [[-L, 0.4, 20, 2], [-150, 7, 20, 8], [-128, 13, 19, 12], [-100, 17.5, 18.5, 14], [-60, 20.5, 18, 15], [0, 21, 18, 15.5], [60, 21, 18, 15.5], [120, 20.5, 18.5, 14], [150, 19.5, 19, 9], [L, 18.5, 19.5, 5]];
  for (const [z, w, top, keel] of prof) st.push({ z, w, h: top, hb: keel, y: 0, n: 7, nb: 2.6 });
  const hull = mesh(loft(st, { seg: 32, sub: 4, uvScale: 8 }), hullM);
  g.add(hull);
  // flared bow/sponson block under the deck overhang
  const spon = new THREE.Shape(); DECK.forEach(([x, z], i) => (i ? spon.lineTo(x, -z) : spon.moveTo(x, -z)));
  const sponG = new THREE.ExtrudeGeometry(spon, { depth: 3.4, bevelEnabled: false }); sponG.rotateX(-Math.PI / 2); sponG.translate(0, CARRIER_DECK_Y - 5.0, 0); sponG.scale(0.97, 1, 0.97);
  g.add(mesh(sponG, steel));
  // flight deck slab
  const deckShape = new THREE.Shape(); DECK.forEach(([x, z], i) => (i ? deckShape.lineTo(x, -z) : deckShape.moveTo(x, -z)));
  const dg = new THREE.ExtrudeGeometry(deckShape, { depth: 1.6, bevelEnabled: false }); dg.rotateX(-Math.PI / 2); dg.translate(0, CARRIER_DECK_Y - 1.6, 0);
  const ns = TEX.nonskid.clone(); ns.repeat.set(1 / 9, 1 / 9); ns.needsUpdate = true;
  const deckM = new THREE.MeshStandardMaterial({ map: ns, roughness: 0.92, metalness: 0.05, color: 0xffffff });
  const deck = mesh(dg, deckM); g.add(deck);
  // markings (thin quads on the deck)
  const mk = (x, z, w, l, color, rot = 0) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).rotateY(rot), new THREE.MeshStandardMaterial({ color, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })); p.position.set(x, CARRIER_DECK_Y + 0.02, z); p.receiveShadow = true; g.add(p); return p; };
  const la = LANDING.a, lb = LANDING.b, dir = lb.clone().sub(la), len = dir.length(), ang = Math.atan2(-dir.x, -dir.z);
  dir.normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x);
  for (let s = 6; s < len; s += 14) { const p = la.clone().addScaledVector(dir, s); mk(p.x, p.z, 0.8, 7, 0xe8e8e8, ang); }
  for (const side of [-1, 1]) for (let s = 0; s < len; s += 4) { const p = la.clone().addScaledVector(dir, s).addScaledVector(perp, side * LANDING.width / 2); mk(p.x, p.z, 0.5, 4, s % 8 < 4 ? 0xe6e6e6 : 0xcf3b2b, ang); }
  for (const c of CATS) { const mid = c.start.clone().add(c.end).multiplyScalar(0.5); mk(mid.x, mid.z, 0.6, c.start.distanceTo(c.end), 0x1d1e20); mk(mid.x + 1.1, mid.z, 0.25, c.start.distanceTo(c.end), 0xe0c040); mk(mid.x - 1.1, mid.z, 0.25, c.start.distanceTo(c.end), 0xe0c040); }
  mk(9, -30, 30, 0.5, 0xe0c040); mk(28, 10, 0.5, 120, 0xe0c040);
  // arresting wires across the landing area
  const wireM = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.4 });
  for (const wz of LANDING.wires) {
    const p = la.clone().addScaledVector(dir, (la.z - wz) / (la.z - lb.z) * len);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, LANDING.width + 2, 6), wireM);
    w.rotation.z = Math.PI / 2; w.rotation.y = ang; w.position.set(p.x, CARRIER_DECK_Y + 0.12, p.z); g.add(w);
  }
  // deck numbers
  const num = new THREE.Mesh(new THREE.PlaneGeometry(18, 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: textTex('72', { w: 256, h: 160, font: 'bold 140px Arial' }), transparent: true, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.8 }));
  num.position.set(0, CARRIER_DECK_Y + 0.03, -128); num.rotation.y = Math.PI; g.add(num);
  const num2 = num.clone(); num2.position.set(-12, CARRIER_DECK_Y + 0.03, 148); num2.rotation.y = 0; g.add(num2);
  // island superstructure (starboard)
  const isl = new THREE.Group(); isl.position.set(31, CARRIER_DECK_Y, 18); g.add(isl);
  const blocks = [[0, 0, 0, 12, 9, 40], [0, 9, -2, 11, 7, 32], [0.5, 16, -4, 10, 6, 24], [0.5, 22, -6, 9, 4, 14], [0, 26, -8, 6.5, 3, 9]];
  for (const [x, y, z, w, h, d] of blocks) { const b = mesh(boxUV(w, h, d, 4, 4), steel); b.position.set(x, y + h / 2, z); isl.add(b); }
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1218, roughness: 0.12, metalness: 0.8 });
  for (const [y, d, w] of [[19, 24.2, 10.2], [24, 14.2, 9.2]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 1.3, d), glass); b.position.set(0.5, y, -4 - (y > 20 ? 2 : 0)); isl.add(b); }
  const mast = mesh(new THREE.CylinderGeometry(0.5, 0.9, 22, 8), dark); mast.position.set(0, 40, -8); isl.add(mast);
  for (const [y, w] of [[33, 9], [38, 7], [44, 5]]) { const yard = mesh(new THREE.BoxGeometry(w, 0.4, 0.4), dark); yard.position.set(0, y, -8); isl.add(yard); }
  const radar = new THREE.Group(); radar.position.set(0, 46.5, -8); isl.add(radar);
  const dish = mesh(new THREE.BoxGeometry(6, 2.2, 0.4), steel); radar.add(dish);
  const radar2 = new THREE.Group(); radar2.position.set(0, 30, 6); isl.add(radar2);
  radar2.add(mesh(new THREE.BoxGeometry(4.2, 3.2, 0.5), steel));
  // elevators (outlines) and deck-edge sponsons
  mk(36.5, -45, 0.5, 26, 0xe0c040); mk(36.5, 70, 0.5, 26, 0xe0c040); mk(-38, 60, 0.5, 24, 0xe0c040);
  // IFLOLS lens (meatball) on the port side
  const lens = new THREE.Group(); lens.position.set(-40, CARRIER_DECK_Y + 1.5, 70); g.add(lens);
  lens.add(mesh(new THREE.BoxGeometry(0.6, 3.4, 4), dark));
  const ballM = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
  const ball = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.6), ballM); ball.position.set(0.35, 0, 0); lens.add(ball);
  for (const s of [-1, 1]) { const datum = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 3), new THREE.MeshBasicMaterial({ color: 0x33ff55 })); datum.position.set(0.35, 0, s * 3.4); lens.add(datum); }
  // jet blast deflectors behind the bow cats
  const jbds = CATS.map((c) => { const j = new THREE.Group(); j.position.set(c.start.x, CARRIER_DECK_Y + 0.05, c.start.z + 21); const p = mesh(new THREE.BoxGeometry(12, 0.25, 3.8), dark); p.position.z = -1.9; j.add(p); j.rotation.x = 0; g.add(j); return j; });
  // AA mounts: CIWS on sponsons + missile launcher boxes
  const aa = [];
  for (const [x, z] of [[-36, 140], [34, 150], [24, -120]]) { const c = makeCIWS(steel); c.position.set(x, CARRIER_DECK_Y - 5, z); g.add(c); aa.push({ type: 'ciws', node: c }); }
  for (const [x, z] of [[-30, -60], [33, 120]]) { const t = makeTurret(steel, 2, 0.7); t.position.set(x, CARRIER_DECK_Y - 4.6, z); g.add(t); aa.push({ type: 'flak', node: t }); }
  // collision boxes (ship-local)
  const boxes = [
    { min: new THREE.Vector3(25, CARRIER_DECK_Y, -4), max: new THREE.Vector3(38, CARRIER_DECK_Y + 28, 40) },
    { min: new THREE.Vector3(29, CARRIER_DECK_Y, 6), max: new THREE.Vector3(33, CARRIER_DECK_Y + 50, 14) },
    { min: new THREE.Vector3(-21, -11, -160), max: new THREE.Vector3(21, CARRIER_DECK_Y - 2, 166) },
  ];
  return { group: g, aa, boxes, radar: [radar, radar2], ball, jbds, length: 333, beam: 40, draft: 11, deckY: CARRIER_DECK_Y };
}

// ---------------------------------------------------------------- BATTLESHIP
function buildBattleship() {
  const g = new THREE.Group();
  const hullM = hullMaterial(), steel = grey(), dark = grey(DARK, 0.8);
  const L = 135, st = [];
  for (const [z, w, top] of [[-L, 0.3, 13], [-120, 6, 12.5], [-95, 12, 11.5], [-60, 16, 10], [0, 16.5, 9.5], [60, 16, 9.5], [100, 13, 10], [125, 9, 10.5], [L, 6, 11]]) st.push({ z, w, h: top, hb: 9.5, y: 0, n: 6, nb: 2.4 });
  g.add(mesh(loft(st, { seg: 28, sub: 4, uvScale: 8 }), hullM));
  const deckM = new THREE.MeshStandardMaterial({ color: 0x8b7a5e, roughness: 0.9, map: TEX.concrete });
  const deck = mesh(new THREE.PlaneGeometry(30, 255).rotateX(-Math.PI / 2), deckM); deck.position.y = 9.6; deck.scale.x = 0.98; g.add(deck);
  // superstructure
  for (const [y, z, w, h, d] of [[10, -10, 18, 6, 50], [16, -16, 14, 6, 30], [22, -20, 10, 8, 16], [30, -22, 7, 6, 8]]) { const b = mesh(boxUV(w, h, d, 4, 4), steel); b.position.set(0, y + h / 2, z); g.add(b); }
  for (const z of [0, 22]) { const f = mesh(new THREE.CylinderGeometry(3.2, 3.8, 14, 12), steel); f.position.set(0, 23, z); g.add(f); const cap = mesh(new THREE.CylinderGeometry(3.4, 3.4, 1, 12), dark); cap.position.set(0, 30.5, z); g.add(cap); }
  const mast = mesh(new THREE.CylinderGeometry(0.4, 0.8, 26, 6), dark); mast.position.set(0, 44, -22); g.add(mast);
  const turrets = [];
  for (const [z, rot] of [[-72, 0], [-44, 0], [70, Math.PI]]) { const t = makeTurret(steel, 3, 2.2); t.position.set(0, 9.6, z); t.rotation.y = rot; g.add(t); turrets.push(t); }
  const aa = [];
  for (const [x, z] of [[-13, -20], [13, -20], [-13, 15], [13, 15]]) { const t = makeTurret(steel, 2, 0.8); t.position.set(x, 13.5, z); g.add(t); aa.push({ type: 'flak', node: t }); }
  for (const [x, z] of [[-9, -46], [9, 40], [-9, 40], [9, -46]]) { const c = makeCIWS(steel); c.position.set(x, 16, z); g.add(c); aa.push({ type: 'ciws', node: c }); }
  const boxes = [{ min: new THREE.Vector3(-16, -9, -135), max: new THREE.Vector3(16, 10, 135) }, { min: new THREE.Vector3(-9, 10, -40), max: new THREE.Vector3(9, 36, 30) }];
  return { group: g, aa, boxes, radar: [], length: 270, beam: 33, draft: 9.5, deckY: 9.6, turrets };
}

// ---------------------------------------------------------------- DESTROYER
function buildDestroyer() {
  const g = new THREE.Group();
  const hullM = hullMaterial(), steel = grey(0x8f969c), dark = grey(DARK, 0.8);
  const L = 78, st = [];
  for (const [z, w, top] of [[-L, 0.3, 9], [-66, 4, 8.5], [-45, 8.5, 7.5], [-10, 10, 6.5], [30, 10, 6.5], [65, 9, 6.5], [L, 8.2, 6.5]]) st.push({ z, w, h: top, hb: 6.2, y: 0, n: 6, nb: 2.4 });
  g.add(mesh(loft(st, { seg: 24, sub: 4, uvScale: 6 }), hullM));
  const deck = mesh(new THREE.PlaneGeometry(18, 150).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5d6064, roughness: 0.9 })); deck.position.y = 6.6; g.add(deck);
  // angular superstructure with tapered walls
  const sup = new THREE.Shape(); sup.moveTo(-7, -18); sup.lineTo(7, -18); sup.lineTo(7, 16); sup.lineTo(-7, 16); sup.closePath();
  const sg = new THREE.ExtrudeGeometry(sup, { depth: 9, bevelEnabled: true, bevelThickness: 0.5, bevelSize: -1.5, bevelSegments: 1 }); sg.rotateX(-Math.PI / 2); sg.translate(0, 6.6, 0);
  g.add(mesh(sg, steel));
  const bridge = mesh(boxUV(11, 5, 12, 3, 3), steel); bridge.position.set(0, 18, -10); g.add(bridge);
  const win = new THREE.Mesh(new THREE.BoxGeometry(11.2, 1.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x0b1218, metalness: 0.8, roughness: 0.1 })); win.position.set(0, 19.5, -16.1); g.add(win);
  for (const s of [-1, 1]) { const spy = new THREE.Mesh(new THREE.CircleGeometry(2.6, 8), dark); spy.position.set(s * 5.6, 16, -12); spy.rotation.y = s * Math.PI / 2 * 0.6; g.add(spy); }
  const mast = mesh(new THREE.CylinderGeometry(0.4, 1.2, 18, 6), dark); mast.position.set(0, 29, -4); g.add(mast);
  for (const z of [4, 14]) { const f = mesh(boxUV(4.5, 6, 5, 2, 2), steel); f.position.set(0, 18.5, z); g.add(f); }
  const gun = makeTurret(steel, 1, 0.8); gun.position.set(0, 6.6, -52); g.add(gun);
  const aa = [{ type: 'flak', node: gun }];
  for (const [x, z] of [[0, -28], [0, 30]]) { const c = makeCIWS(steel); c.position.set(x, 15.6, z); g.add(c); aa.push({ type: 'ciws', node: c }); }
  const vls = mesh(new THREE.BoxGeometry(6, 0.4, 8), dark); vls.position.set(0, 6.8, -36); g.add(vls);
  const boxes = [{ min: new THREE.Vector3(-10, -6, -78), max: new THREE.Vector3(10, 7, 78) }, { min: new THREE.Vector3(-7, 7, -18), max: new THREE.Vector3(7, 21, 18) }];
  return { group: g, aa, boxes, radar: [], length: 155, beam: 20, draft: 6.2, deckY: 6.6 };
}

class Ship {
  constructor(kind, def, offset, ocean) {
    this.kind = kind; Object.assign(this, def);
    this.offset = offset; // formation offset (fleet frame: x starboard, z aft)
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.heading = 0; this.yawRate = 0;
    this.pitch = 0; this.roll = 0; this.heave = 0;
    this.quat = new THREE.Quaternion();
    this.matrix = new THREE.Matrix4(); this.inv = new THREE.Matrix4();
    this.wake = ocean.addWake(this.beam * 0.55);
    this.bowWake = ocean.addWake(this.beam * 0.3);
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  sync(time, dt) {
    const L = this.length * 0.42, B = this.beam * 0.4, hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    const fwdx = -hx, fwdz = -hz; // heading 0 = bow toward -z
    const px = this.pos.x, pz = this.pos.z;
    const hb = waveHeight(px + fwdx * L, pz + fwdz * L, time), hs = waveHeight(px - fwdx * L, pz - fwdz * L, time);
    const hp = waveHeight(px - fwdz * B, pz + fwdx * B, time), hst = waveHeight(px + fwdz * B, pz - fwdx * B, time);
    const k = 1.2 / Math.sqrt(this.length / 100);
    const tp = Math.atan2(hb - hs, 2 * L) * 0.6, tr = Math.atan2(hp - hst, 2 * B) * 0.5, th = (hb + hs + hp + hst) / 4 * 0.6;
    this.pitch = damp(this.pitch, tp, k, dt); this.roll = damp(this.roll, tr, k, dt); this.heave = damp(this.heave, th, k, dt);
    this.group.position.set(px, this.heave, pz);
    this.group.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
    this.group.updateMatrixWorld(true);
    this.matrix.copy(this.group.matrixWorld); this.inv.copy(this.matrix).invert();
    this.quat.setFromRotationMatrix(this.matrix);
    const sternx = px + hx * this.length * 0.5, sternz = pz + hz * this.length * 0.5;
    this.wake.update(dt, sternx, sternz, -fwdx, -fwdz, this.vel.length(), 1);
    this.bowWake.update(dt, px + fwdx * this.length * 0.42, pz + fwdz * this.length * 0.42, -fwdx, -fwdz, this.vel.length(), 0.55);
  }
  toLocal(v, out) { return out.copy(v).applyMatrix4(this.inv); }
  toWorld(v, out) { return out.copy(v).applyMatrix4(this.matrix); }
}

export class Fleet {
  constructor(scene, ocean) {
    this.ships = [];
    this.center = new THREE.Vector2(...WORLD.fleetCenter);
    // racetrack: long straight legs (steady for recoveries) joined by gentle semicircular turns
    this.radius = WORLD.fleetRadius; this.speed = WORLD.fleetSpeed; this.leg = WORLD.fleetLeg;
    this.s = this.leg * 0.35; // distance travelled along the track
    const add = (kind, def, off) => { const s = new Ship(kind, def, new THREE.Vector3(...off), ocean); scene.add(s.group); this.ships.push(s); return s; };
    this.carrier = add('carrier', buildCarrier(), [0, 0, 0]);
    add('battleship', buildBattleship(), [-1300, 0, -500]);
    add('battleship', buildBattleship(), [1300, 0, -300]);
    add('destroyer', buildDestroyer(), [0, 0, -2100]);
    add('destroyer', buildDestroyer(), [-1600, 0, 1500]);
    add('destroyer', buildDestroyer(), [1700, 0, 1300]);
    this.update(0, 0);
  }
  // point and tangent on the racetrack at distance s
  track(s, out, tan) {
    const L = this.leg, R = this.radius, cx = this.center.x, cz = this.center.y, P = 2 * L + 2 * Math.PI * R;
    s = ((s % P) + P) % P;
    if (s < L) { out.set(cx + R, cz + L / 2 - s); tan.set(0, -1); }
    else if (s < L + Math.PI * R) { const t = (s - L) / R; out.set(cx + R * Math.cos(t), cz - L / 2 - R * Math.sin(t)); tan.set(-Math.sin(t), -Math.cos(t)); }
    else if (s < 2 * L + Math.PI * R) { const u = s - L - Math.PI * R; out.set(cx - R, cz - L / 2 + u); tan.set(0, 1); }
    else { const t = (s - 2 * L - Math.PI * R) / R; out.set(cx - R * Math.cos(t), cz + L / 2 + R * Math.sin(t)); tan.set(Math.sin(t), Math.cos(t)); }
    return out;
  }
  update(time, dt) {
    this.s += this.speed * dt;
    const P = _tp || (_tp = new THREE.Vector2()), T = _tt || (_tt = new THREE.Vector2());
    this.track(this.s, P, T);
    const cx = P.x, cz = P.y, tx = T.x, tz = T.y;
    const heading = Math.atan2(-tx, -tz); // bow points along the tangent
    const yawRate = dt > 0 && this._h !== undefined ? wrapA(heading - this._h) / dt : 0;
    this._h = heading;
    for (const s of this.ships) {
      const ox = s.offset.x, oz = s.offset.z, c = Math.cos(heading), sn = Math.sin(heading);
      const wx = cx + ox * c + oz * sn, wz = cz - ox * sn + oz * c;
      if (dt > 0) s.vel.set((wx - s.pos.x) / dt, 0, (wz - s.pos.z) / dt); else s.vel.set(tx * this.speed, 0, tz * this.speed);
      s.pos.set(wx, 0, wz); s.heading = heading; s.yawRate = yawRate;
      s.sync(time, dt || 0.016);
      if (s.radar) for (const r of s.radar) r.rotation.y += dt * 1.6;
    }
    // meatball shows glide slope for the player (set externally)
  }
  // flight deck query: returns deck height + velocity if (x, z) is over the carrier deck
  deckAt(x, y, z, out) {
    const c = this.carrier;
    const p = c.toLocal(_v.set(x, y, z), _l);
    if (p.y < c.deckY - 8 || p.y > c.deckY + 30) return null;
    if (!pointInPoly(p.x, p.z, DECK)) return null;
    _w.set(p.x, c.deckY, p.z); c.toWorld(_w, _w);
    out.h = _w.y; out.vx = c.vel.x + c.yawRate * (z - c.pos.z) * 0; out.vy = 0; out.vz = c.vel.z; out.kind = 'deck'; out.ship = c; out.local = p;
    return out;
  }
  // solid-obstacle test against every ship (hulls, islands, superstructure)
  hit(x, y, z) {
    if (y > 60) return null;
    for (const s of this.ships) {
      const dx = x - s.pos.x, dz = z - s.pos.z;
      if (dx * dx + dz * dz > (s.length * 0.6) ** 2) continue;
      const p = s.toLocal(_v.set(x, y, z), _l);
      for (const b of s.boxes) if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return s;
    }
    return null;
  }
  catWorld(i, s, out) { const c = CATS[i]; _w.copy(c.start).lerp(c.end, s); _w.y = this.carrier.deckY; return this.carrier.toWorld(_w, out); }
}
const _v = new THREE.Vector3(), _l = new THREE.Vector3(), _w = new THREE.Vector3();
