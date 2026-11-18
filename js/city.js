// Coastal city: blocks of skyscrapers (glass towers with setbacks, offices, brick mid-rises), a TV tower, a
// suspension bridge across the estuary and two girder bridges, with lit windows at dusk and aviation beacons.
// Everything solid is registered as an AABB in a spatial hash so aircraft can crash into it.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { TEX } from './textures.js';
import { makeRng, clamp, smoothstep, lerp } from './util.js';
import { merge, boxUV, tube, mesh } from './geo.js';
import { riverZ, coastX } from './terrain.js';

export class Colliders {
  constructor(cell = 250) { this.cell = cell; this.map = new Map(); this.list = []; }
  add(min, max, tag = 'building') {
    const b = { min: min.clone(), max: max.clone(), tag };
    this.list.push(b);
    const c = this.cell;
    for (let i = Math.floor(min.x / c); i <= Math.floor(max.x / c); i++) for (let j = Math.floor(min.z / c); j <= Math.floor(max.z / c); j++) {
      const k = i * 100003 + j; let a = this.map.get(k); if (!a) { a = []; this.map.set(k, a); } a.push(b);
    }
    return b;
  }
  hit(x, y, z) {
    const a = this.map.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (!a) return null;
    for (const b of a) if (x > b.min.x && x < b.max.x && y > b.min.y && y < b.max.y && z > b.min.z && z < b.max.z) return b;
    return null;
  }
  // max obstacle top near a point (AI uses this to stay above buildings)
  topNear(x, z, r = 300) {
    let top = 0; const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
      const a = this.map.get(i * 100003 + j); if (a) for (const b of a) top = Math.max(top, b.max.y);
    }
    return top;
  }
}

// walls (4 sides) with UVs in metres so facades tile floor-by-floor; roof separately
function walls(x, y0, z, w, h, d, tw, th, list) {
  const g = boxUV(w, h, d, tw, th);
  // drop top/bottom faces (indices 8..15 in BoxGeometry face order +x,-x,+y,-y,+z,-z)
  const idx = g.index.array, keep = [];
  for (let f = 0; f < 6; f++) if (f !== 2 && f !== 3) for (let k = 0; k < 6; k++) keep.push(idx[f * 6 + k]);
  g.setIndex(keep);
  g.translate(x, y0 + h / 2, z);
  list.push(g);
}
function roof(x, y, z, w, d, list) { const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2); g.translate(x, y, z); list.push(g); }

export function buildCity(terrain, colliders, quality = 1) {
  const C = WORLD.city;
  const r = makeRng(9001);
  const group = new THREE.Group();
  const facades = TEX.facades;
  const geos = facades.map(() => []);
  const roofs = [], details = [], beaconPos = [];
  const towerCyl = [];
  const down1 = new THREE.Vector2(2500, -4700), down2 = new THREE.Vector2(3300, -2050);
  const v3a = new THREE.Vector3(), v3b = new THREE.Vector3();
  const PX = 150, PZ = 136;
  let count = 0;
  for (let bx = C.x0; bx < C.x1; bx += PX) for (let bz = C.z0; bz < C.z1; bz += PZ) {
    const lx0 = bx + 30, lx1 = bx + PX - 6, lz0 = bz + 30, lz1 = bz + PZ - 6;
    const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2;
    const ground = Math.min(terrain.height(lx0, lz0), terrain.height(lx1, lz0), terrain.height(lx0, lz1), terrain.height(lx1, lz1));
    if (ground < 4.5) continue;
    const rz = riverZ(cx); if (Math.abs(cz - rz) < 560) continue;
    if (cx < coastX(cz) + 260) continue;
    const dd = Math.min(down1.distanceTo(new THREE.Vector2(cx, cz)), down2.distanceTo(new THREE.Vector2(cx, cz)) * 1.25);
    const core = 1 - smoothstep(250, 1700, dd);
    const edge = smoothstep(C.x1 - 600, C.x1, cx) + smoothstep(C.z1 - 400, C.z1, cz) + (1 - smoothstep(C.z0, C.z0 + 400, cz));
    if (r() < 0.12 + edge * 0.3) continue; // parks / plazas
    const lw = lx1 - lx0, ld = lz1 - lz0;
    if (core > 0.25 && r() < 0.85) {
      // tall tower, sometimes with setbacks or a cylinder
      const fi = r() < 0.6 ? (r() < 0.5 ? 0 : 4) : (r() < 0.5 ? 1 : 3);
      const H = lerp(90, 360, core * core) * (0.65 + r() * 0.55);
      const w = Math.min(lw, 40 + r() * 40), d = Math.min(ld, 40 + r() * 36);
      if (fi !== 1 && r() < 0.18) {
        const rad = Math.min(w, d) / 2;
        towerCyl.push({ x: cx, z: cz, y: ground, h: H, r: rad, fi });
        colliders.add(v3a.set(cx - rad, ground - 5, cz - rad), v3b.set(cx + rad, ground + H, cz + rad));
        beaconPos.push([cx, ground + H + 14, cz]);
        details.push({ type: 'mast', x: cx, y: ground + H, z: cz, h: 14 });
      } else {
        const tiers = H > 160 ? 3 : H > 90 ? 2 : 1;
        let y = ground, tw = w, td = d;
        for (let t = 0; t < tiers; t++) {
          const th = t === tiers - 1 ? H - (y - ground) : H * (t === 0 ? 0.55 : 0.28);
          const f = facades[fi];
          walls(cx, y, cz, tw, th, td, f.bays * f.bayW, f.floors * f.floorH, geos[fi]);
          colliders.add(v3a.set(cx - tw / 2, y - 5, cz - td / 2), v3b.set(cx + tw / 2, y + th, cz + td / 2));
          y += th; roof(cx, y, cz, tw, td, roofs);
          tw *= 0.78; td *= 0.78;
        }
        details.push({ type: 'hvac', x: cx, y, z: cz, w: tw, d: td });
        if (H > 200) { details.push({ type: 'mast', x: cx, y, z: cz, h: 18 + r() * 20 }); beaconPos.push([cx, y + 30, cz]); }
        else beaconPos.push([cx + tw / 2, y + 1, cz + td / 2]);
      }
      count++;
    } else {
      // 1-4 mid / low rises filling the lot
      const n = 1 + Math.floor(r() * 3.5);
      for (let k = 0; k < n; k++) {
        const fi = r() < 0.45 ? 2 : r() < 0.6 ? 1 : 3;
        const f = facades[fi];
        const H = lerp(12, 70, core + r() * 0.35) * (0.6 + r() * 0.7);
        const w = lw / (n > 2 ? 2 : n) - 6, d = n > 2 ? ld / 2 - 6 : ld - 4;
        const ox = n > 1 ? (k % 2 ? 1 : -1) * (lw / 4) : 0, oz = n > 2 ? (k < 2 ? -1 : 1) * (ld / 4) : 0;
        const x = cx + ox, z = cz + oz;
        walls(x, ground, z, w, H, d, f.bays * f.bayW, f.floors * f.floorH, geos[fi]);
        roof(x, ground + H, z, w, d, roofs);
        colliders.add(v3a.set(x - w / 2, ground - 5, z - d / 2), v3b.set(x + w / 2, ground + H, z + d / 2));
        if (r() < 0.4) details.push({ type: 'hvac', x, y: ground + H, z, w: w * 0.8, d: d * 0.8 });
        count++;
      }
    }
  }
  // cylinder towers
  for (const t of towerCyl) {
    const f = facades[t.fi];
    const circ = 2 * Math.PI * t.r;
    const g = new THREE.CylinderGeometry(t.r, t.r, t.h, 28, 1, true);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / (f.bays * f.bayW), uv.getY(i) * t.h / (f.floors * f.floorH));
    g.translate(t.x, t.y + t.h / 2, t.z); geos[t.fi].push(g);
    const cap = new THREE.CircleGeometry(t.r, 28).rotateX(-Math.PI / 2); cap.translate(t.x, t.y + t.h, t.z); roofs.push(cap);
  }
  // materials (emissive windows light up at dusk/dawn)
  const mats = facades.map((f) => new THREE.MeshStandardMaterial({
    map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: f.glassy ? 0.18 : 0.82, metalness: f.glassy ? 0.55 : 0.05, envMapIntensity: f.glassy ? 1.3 : 0.5,
  }));
  geos.forEach((list, i) => { if (!list.length) return; const m = new THREE.Mesh(merge(list), mats[i]); m.castShadow = true; m.receiveShadow = true; group.add(m); });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x77736c, map: TEX.concrete, roughness: 0.95 });
  if (roofs.length) { const rm = new THREE.Mesh(merge(roofs), roofMat); rm.receiveShadow = true; group.add(rm); }
  // rooftop details: HVAC boxes, masts
  const det = [], mastG = [];
  for (const d of details) {
    if (d.type === 'hvac') { for (let k = 0; k < 3; k++) { const w = 3 + r() * 6, dd = 3 + r() * 6, h = 2 + r() * 3; const g = boxUV(w, h, dd, 3, 3); g.translate(d.x + (r() - 0.5) * d.w * 0.6, d.y + h / 2, d.z + (r() - 0.5) * d.d * 0.6); det.push(g); } }
    else { const g = new THREE.CylinderGeometry(0.4, 0.9, d.h, 6); g.translate(d.x, d.y + d.h / 2, d.z); mastG.push(g); }
  }
  if (det.length) { const m = new THREE.Mesh(merge(det), new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 0.7, metalness: 0.3 })); m.castShadow = true; group.add(m); }
  if (mastG.length) group.add(new THREE.Mesh(merge(mastG), new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.7, roughness: 0.4 })));
  // TV tower landmark on the waterfront
  {
    const x = 1350, z = -5200, y = terrain.height(x, z);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 9, 330, 16), new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.6, map: TEX.concrete }));
    shaft.position.set(x, y + 165, z); shaft.castShadow = true; group.add(shaft);
    const pod = new THREE.Mesh(new THREE.SphereGeometry(22, 24, 16), new THREE.MeshStandardMaterial({ color: 0x9fb1c2, metalness: 0.6, roughness: 0.2 })); pod.scale.y = 0.6; pod.position.set(x, y + 280, z); pod.castShadow = true; group.add(pod);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 2.5, 90, 8), new THREE.MeshStandardMaterial({ color: 0xd04030 })); spire.position.set(x, y + 375, z); group.add(spire);
    colliders.add(v3a.set(x - 9, y - 5, z - 9), v3b.set(x + 9, y + 420, z + 9), 'tower');
    colliders.add(v3a.set(x - 22, y + 266, z - 22), v3b.set(x + 22, y + 294, z + 22), 'tower');
    beaconPos.push([x, y + 421, z], [x, y + 300, z]);
  }
  // bridges
  buildSuspension(group, terrain, colliders, 1500, beaconPos);
  for (const bx of [3300, 4450]) buildGirder(group, terrain, colliders, bx);
  // aviation obstruction beacons (blink)
  const bg = new THREE.SphereGeometry(1.6, 8, 6);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  const beacons = new THREE.InstancedMesh(bg, beaconMat, beaconPos.length);
  const m4 = new THREE.Matrix4();
  beaconPos.forEach((p, i) => beacons.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])));
  group.add(beacons);
  return { group, mats, beacons, beaconMat, count };
}

function buildSuspension(group, terrain, colliders, x, beacons) {
  const rz = riverZ(x);
  const half = 380, deckY = 62, towerH = 165, wDeck = 30;
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8402f, roughness: 0.6, metalness: 0.4 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.9, map: TEX.concrete });
  const roadM = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, map: TEX.asphalt });
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  // deck spans between ramps
  const z0 = rz - half - 420, z1 = rz + half + 420;
  const ground0 = Math.max(terrain.height(x, z0), 4), ground1 = Math.max(terrain.height(x, z1), 4);
  const deckAt = (z) => (z < rz - half ? lerp(ground0 + 1, deckY, smoothstep(z0, rz - half, z)) : z > rz + half ? lerp(deckY, ground1 + 1, smoothstep(rz + half, z1, z)) : deckY);
  const segs = 60, dg = [];
  for (let i = 0; i < segs; i++) {
    const za = lerp(z0, z1, i / segs), zb = lerp(z0, z1, (i + 1) / segs), ya = deckAt(za), yb = deckAt(zb);
    const len = Math.hypot(zb - za, yb - ya), g = new THREE.BoxGeometry(wDeck, 3.2, len + 0.4);
    g.rotateX(Math.atan2(yb - ya, zb - za)); g.translate(x, (ya + yb) / 2, (za + zb) / 2); dg.push(g);
    colliders.add(v1.set(x - wDeck / 2, Math.min(ya, yb) - 2, za), v2.set(x + wDeck / 2, Math.max(ya, yb) + 2, zb), 'bridge');
  }
  const deck = new THREE.Mesh(merge(dg), roadM); deck.castShadow = true; deck.receiveShadow = true; group.add(deck);
  // towers (two legs + cross beams)
  for (const tz of [rz - half, rz + half]) {
    const base = Math.max(terrain.height(x, tz), -8);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(5, towerH - base, 6), steel);
      leg.position.set(x + s * (wDeck / 2 + 2.5), base + (towerH - base) / 2, tz); leg.castShadow = true; group.add(leg);
      colliders.add(v1.set(x + s * (wDeck / 2 + 2.5) - 3, base - 5, tz - 3.5), v2.set(x + s * (wDeck / 2 + 2.5) + 3, towerH, tz + 3.5), 'bridge');
    }
    for (const y of [deckY + 30, deckY + 70, towerH - 6]) { const b = new THREE.Mesh(new THREE.BoxGeometry(wDeck + 10, 4, 4), steel); b.position.set(x, y, tz); group.add(b); colliders.add(v1.set(x - wDeck / 2 - 5, y - 2.5, tz - 2.5), v2.set(x + wDeck / 2 + 5, y + 2.5, tz + 2.5), 'bridge'); }
    const pier = new THREE.Mesh(new THREE.BoxGeometry(wDeck + 18, 14, 18), concrete); pier.position.set(x, base + 2, tz); group.add(pier);
    beacons.push([x - wDeck / 2 - 2.5, towerH + 1.5, tz], [x + wDeck / 2 + 2.5, towerH + 1.5, tz]);
  }
  // main cables (parabolic between towers, straight back-stays to anchorages) + suspenders
  const cableM = new THREE.MeshStandardMaterial({ color: 0xc04a36, roughness: 0.5, metalness: 0.5 });
  const sus = [];
  for (const s of [-1, 1]) {
    const cx = x + s * (wDeck / 2 + 2.5);
    const pts = [];
    pts.push(new THREE.Vector3(cx, deckAt(z0 + 60) + 2, z0 + 60));
    for (let i = 0; i <= 24; i++) { const t = i / 24, z = lerp(rz - half, rz + half, t), y = deckY + 4 + (towerH - 2 - deckY - 4) * Math.pow(2 * t - 1, 2); pts.push(new THREE.Vector3(cx, y, z)); }
    pts.push(new THREE.Vector3(cx, deckAt(z1 - 60) + 2, z1 - 60));
    group.add(new THREE.Mesh(tube(pts, 0.9, 6, 80), cableM));
    for (let z = rz - half + 20; z < rz + half; z += 20) { const t = (z - (rz - half)) / (2 * half), y = deckY + 4 + (towerH - 2 - deckY - 4) * Math.pow(2 * t - 1, 2); const g = new THREE.CylinderGeometry(0.15, 0.15, y - deckY, 4); g.translate(cx, (y + deckY) / 2, z); sus.push(g); }
  }
  group.add(new THREE.Mesh(merge(sus), cableM));
}

function buildGirder(group, terrain, colliders, x) {
  const rz = riverZ(x);
  const w = 240, deckY = 26, wd = 22;
  const z0 = rz - w - 200, z1 = rz + w + 200;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa29f98, roughness: 0.9, map: TEX.concrete });
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const g0 = Math.max(terrain.height(x, z0), 4), g1 = Math.max(terrain.height(x, z1), 4);
  const deckAt = (z) => (z < rz - w ? lerp(g0 + 1, deckY, smoothstep(z0, rz - w, z)) : z > rz + w ? lerp(deckY, g1 + 1, smoothstep(rz + w, z1, z)) : deckY);
  const dg = [];
  const segs = 30;
  for (let i = 0; i < segs; i++) {
    const za = lerp(z0, z1, i / segs), zb = lerp(z0, z1, (i + 1) / segs), ya = deckAt(za), yb = deckAt(zb);
    const g = new THREE.BoxGeometry(wd, 4, Math.hypot(zb - za, yb - ya) + 0.3); g.rotateX(Math.atan2(yb - ya, zb - za)); g.translate(x, (ya + yb) / 2, (za + zb) / 2); dg.push(g);
    colliders.add(v1.set(x - wd / 2, Math.min(ya, yb) - 3, za), v2.set(x + wd / 2, Math.max(ya, yb) + 2, zb), 'bridge');
  }
  for (let z = rz - w; z <= rz + w; z += 80) { const b = Math.max(terrain.height(x, z), -8); const g = new THREE.BoxGeometry(6, deckY - b, 8); g.translate(x, b + (deckY - b) / 2, z); dg.push(g); colliders.add(v1.set(x - 3, b - 4, z - 4), v2.set(x + 3, deckY, z + 4), 'bridge'); }
  const m = new THREE.Mesh(merge(dg), concrete); m.castShadow = true; m.receiveShadow = true; group.add(m);
}
