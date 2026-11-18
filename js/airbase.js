// Military airbase: 3 km runway with markings, edge lights and PAPI glide-slope lights, parallel taxiway, apron,
// arched hangars, hardened shelters, control tower, rotating radar and fuel farm.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { TEX, textTex } from './textures.js';
import { merge, boxUV, mesh } from './geo.js';

export function buildAirbase(terrain, colliders) {
  const A = WORLD.airbase;
  const y0 = 42.06;
  const group = new THREE.Group();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const asp = TEX.asphalt.clone(); asp.repeat.set(A.len / 30, A.width / 30); asp.needsUpdate = true;
  const runway = mesh(new THREE.PlaneGeometry(A.len, A.width).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: asp, roughness: 0.9, color: 0xc8c8c8 }), false, true);
  runway.position.set(A.x, y0 + 0.08, A.z); group.add(runway);
  const conc = (w, d, x, z) => { const t = TEX.concrete.clone(); t.repeat.set(w / 40, d / 40); t.needsUpdate = true; const m = mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 }), false, true); m.position.set(x, y0 + 0.05, z); group.add(m); };
  conc(A.len - 200, 24, A.x, A.z + 230);           // parallel taxiway
  for (let i = -2; i <= 2; i++) conc(24, 206, A.x + i * 700, A.z + 127); // connectors
  conc(1500, 240, A.x - 150, A.z + 440);           // apron
  // markings
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  const mk = [];
  const quad = (x, z, w, d) => { const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2); g.translate(x, y0 + 0.12, z); mk.push(g); };
  const x0 = A.x - A.len / 2, x1 = A.x + A.len / 2;
  for (let x = x0 + 400; x < x1 - 400; x += 60) quad(x, A.z, 36, 0.9);                 // centreline
  quad(A.x, A.z - A.width / 2 + 1, A.len - 20, 0.9); quad(A.x, A.z + A.width / 2 - 1, A.len - 20, 0.9); // edges
  for (const [tx, s] of [[x0, 1], [x1, -1]]) {
    for (let k = 0; k < 8; k++) { quad(tx + s * 30, A.z - 19 + k * 2.6 + (k >= 4 ? 7 : 0), 45, 1.8); } // piano keys
    quad(tx + s * 400, A.z - 10, 45, 4); quad(tx + s * 400, A.z + 10, 45, 4);                         // aiming points
    for (const d of [150, 300, 600, 750]) { quad(tx + s * d, A.z - 12, 22, 1.8); quad(tx + s * d, A.z + 12, 22, 1.8); quad(tx + s * d, A.z - 9, 22, 1.8); quad(tx + s * d, A.z + 9, 22, 1.8); }
  }
  group.add(mesh(merge(mk), white, false, true));
  for (const [tx, s, txt] of [[x0, 1, '09'], [x1, -1, '27']]) {
    const num = new THREE.Mesh(new THREE.PlaneGeometry(18, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: textTex(txt, { w: 256, h: 420, font: 'bold 300px Arial' }), transparent: true, polygonOffset: true, polygonOffsetFactor: -3 }));
    num.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2; num.position.set(tx + s * 95, y0 + 0.14, A.z); group.add(num);
  }
  // edge lights + approach lights
  const lightG = new THREE.SphereGeometry(0.35, 6, 4), lights = [];
  for (let x = x0; x <= x1; x += 60) { lights.push([x, A.z - A.width / 2 - 1.5]); lights.push([x, A.z + A.width / 2 + 1.5]); }
  for (const [tx, s] of [[x0, -1], [x1, 1]]) for (let d = 30; d <= 450; d += 30) for (const o of [-6, -3, 0, 3, 6]) lights.push([tx + s * d, A.z + o]);
  const lm = new THREE.InstancedMesh(lightG, new THREE.MeshBasicMaterial({ color: 0xfff1c8, toneMapped: false }), lights.length);
  const m4 = new THREE.Matrix4();
  lights.forEach(([x, z], i) => lm.setMatrixAt(i, m4.makeTranslation(x, y0 + 0.4, z)));
  group.add(lm);
  // PAPI: 4 lights left of each touchdown zone (red/white by viewing angle, updated per frame)
  const papi = [];
  for (const [tx, s, dirX] of [[x0, 1, -1], [x1, -1, 1]]) for (let k = 0; k < 4; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    m.position.set(tx + s * 320, y0 + 0.6, A.z - A.width / 2 - 14 - k * 9);
    group.add(m); papi.push({ mesh: m, k, threshold: new THREE.Vector3(tx, y0, A.z), dirX, aim: new THREE.Vector3(tx + s * 320, y0, A.z) });
  }
  // hangars (arched), shelters, tower, radar, fuel tanks
  const metal = new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.55, metalness: 0.5, map: TEX.panel });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.8 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9e9a90, roughness: 0.95, map: TEX.concrete });
  for (let i = 0; i < 6; i++) {
    const hx = A.x - 800 + i * 110, hz = A.z + 640;
    const arch = new THREE.CylinderGeometry(26, 26, 60, 24, 1, true, -Math.PI / 2, Math.PI); arch.rotateX(-Math.PI / 2);
    const am = mesh(arch, metal); am.scale.y = 0.72; am.position.set(hx, y0, hz); group.add(am);
    const back = mesh(new THREE.CircleGeometry(26, 24, 0, Math.PI), metal); back.scale.y = 0.72; back.position.set(hx, y0, hz + 30); group.add(back);
    const door = mesh(new THREE.CircleGeometry(25.5, 24, 0, Math.PI), dark); door.scale.y = 0.7; door.position.set(hx, y0, hz - 29.5); door.rotation.y = Math.PI; group.add(door);
    colliders.add(v1.set(hx - 26, y0 - 2, hz - 30), v2.set(hx + 26, y0 + 19, hz + 30), 'hangar');
  }
  for (let i = 0; i < 6; i++) {
    const sx = A.x + 520 + i * 70, sz = A.z + 620;
    const dome = new THREE.SphereGeometry(15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); dome.scale(1, 0.55, 1.4);
    const dm = mesh(dome, concrete); dm.position.set(sx, y0, sz); group.add(dm);
    colliders.add(v1.set(sx - 14, y0 - 2, sz - 20), v2.set(sx + 14, y0 + 8, sz + 20), 'hangar');
  }
  const tx = A.x + 250, tz = A.z + 330;
  const shaft = mesh(boxUV(7, 34, 7, 3, 3), concrete); shaft.position.set(tx, y0 + 17, tz); group.add(shaft);
  const cab = mesh(new THREE.CylinderGeometry(7.5, 6, 5, 8), new THREE.MeshStandardMaterial({ color: 0x15202a, metalness: 0.7, roughness: 0.15 })); cab.position.set(tx, y0 + 36.5, tz); group.add(cab);
  const capm = mesh(new THREE.CylinderGeometry(8.2, 8.2, 1, 8), concrete); capm.position.set(tx, y0 + 39.5, tz); group.add(capm);
  colliders.add(v1.set(tx - 8, y0 - 2, tz - 8), v2.set(tx + 8, y0 + 41, tz + 8), 'tower');
  const radar = new THREE.Group(); radar.position.set(A.x - 1100, y0 + 18, A.z + 520); group.add(radar);
  const rpost = mesh(new THREE.CylinderGeometry(0.8, 1.4, 18, 8), metal); rpost.position.y = -9; radar.add(rpost);
  const rd = mesh(new THREE.BoxGeometry(10, 3, 0.6), metal); rd.position.y = 1.5; radar.add(rd);
  for (let i = 0; i < 4; i++) { const t = mesh(new THREE.CylinderGeometry(9, 9, 11, 20), new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.6 })); t.position.set(A.x + 900 + (i % 2) * 24, y0 + 5.5, A.z + 760 + Math.floor(i / 2) * 24); group.add(t); }
  group.traverse((o) => { if (o.isMesh && !o.material.polygonOffset) { o.castShadow = true; o.receiveShadow = true; } });
  // AA emplacement sites around the base (filled in by the AA system)
  const aaSites = [[A.x - 1700, A.z - 300, 'flak'], [A.x - 900, A.z - 600, 'gun'], [A.x + 300, A.z - 650, 'flak'], [A.x + 1300, A.z - 500, 'gun'], [A.x + 1900, A.z + 300, 'flak'], [A.x - 300, A.z + 1050, 'gun'], [A.x + 1100, A.z + 1000, 'flak'], [A.x - 1500, A.z + 900, 'gun']];
  const repair = { x0: x0 - 60, x1: x1 + 60, z0: A.z - A.width / 2 - 8, z1: A.z + 570 };
  return { group, papi, radar, aaSites, repair, y0, runway: { x0, x1, z: A.z, y: y0, width: A.width } };
}

// PAPI: each light shows white if the eye is above its angle, red if below (3 deg glide path)
export function updatePapi(papi, eye) {
  const ang = [3.5, 3.17, 2.83, 2.5];
  for (const p of papi) {
    const dx = Math.abs(eye.x - p.aim.x), dy = eye.y - p.aim.y;
    const a = Math.atan2(dy, Math.max(dx, 1)) * 180 / Math.PI;
    const behind = Math.sign(eye.x - p.aim.x) !== p.dirX;
    p.mesh.material.color.setHex(behind ? 0x330000 : a > ang[p.k] ? 0xffffff : 0xff2010);
  }
}
