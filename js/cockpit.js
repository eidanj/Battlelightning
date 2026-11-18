// Cockpit interior: instrument panel with live analog/digital gauges (canvas texture), glareshield, HUD combiner,
// side consoles, moving stick and throttle, rudder pedals, canopy bow and rails, ejection seat and the pilot.
// Lives in the aircraft's body frame, so it can be shown through the canopy (chase view) or rendered as its own
// pass with a near camera (cockpit view).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeCanvas, canvasTex, TEX } from './textures.js';
import { Pilot, buildSeat } from './pilot.js';
import { clamp, DEG, RAD } from './util.js';
import { AB_DETENT } from './flight.js';

const PANEL_W = 1024, PANEL_H = 512;

export class Cockpit {
  constructor(def, team = 'navy', lowDetail = false) {
    this.def = def;
    const eye = new THREE.Vector3(...def.geo.eye);
    this.eye = eye;
    this.group = new THREE.Group();
    this.low = lowDetail;
    // pilot + seat
    this.pilot = new Pilot({ lod: lowDetail ? 1 : 0 });
    this.pilot.recline = def.id === 'f16' ? 0.42 : 0.16;
    this.pilotAnchor = new THREE.Group();
    this.pilotAnchor.position.set(eye.x, eye.y - 0.79, eye.z + 0.05 + (def.id === 'f16' ? 0.28 : 0.1));
    this.group.add(this.pilotAnchor);
    this.seat = buildSeat();
    this.seat.position.set(0, -0.08, 0.12);
    this.seat.rotation.x = this.pilot.recline * 0.9;
    this.pilotAnchor.add(this.seat);
    this.pilotAnchor.add(this.pilot.root);
    if (lowDetail) { this._trimPilot(); return; }
    this._buildInterior(eye);
  }
  _trimPilot() {
    // AI pilots: keep torso, helmet and arms (seen through the canopy), drop the legs
    for (const L of this.pilot.legs) { L.thigh.visible = L.shin.visible = L.foot.visible = false; }
    this.pilot.update();
  }

  _buildInterior(eye) {
    const id = this.def.id;
    this.interior = new THREE.Group(); this.group.add(this.interior);
    const g = this.interior;
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.75, metalness: 0.2 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0d0e0f, roughness: 0.9 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x4a5056, roughness: 0.6, metalness: 0.3 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    // instrument panel with the live gauge canvas
    const { c, g: ctx } = makeCanvas(PANEL_W, PANEL_H);
    this.canvas = c; this.ctx = ctx;
    this.panelTex = canvasTex(c, { srgb: true, repeat: false });
    const panelMat = new THREE.MeshStandardMaterial({ map: this.panelTex, emissiveMap: this.panelTex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.55, metalness: 0.1 });
    const pz = eye.z - 0.74, py = eye.y - 0.42;
    this.panel = add(new THREE.PlaneGeometry(0.76, 0.38), panelMat, eye.x, py, pz, -0.22);
    add(new THREE.BoxGeometry(0.82, 0.44, 0.05), dark, eye.x, py - 0.01, pz - 0.035, -0.22);
    // glareshield + HUD combiner
    const coaming = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.95, metalness: 0.05 });
    add(new RoundedBoxGeometry(0.68, 0.06, 0.3, 3, 0.025), coaming, eye.x, eye.y - 0.2, eye.z - 0.78, 0.08);
    const hudFrame = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.6, metalness: 0.5 });
    add(new THREE.BoxGeometry(0.18, 0.06, 0.12), hudFrame, eye.x, eye.y - 0.15, eye.z - 0.68);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.012, 0.16, 0.012), hudFrame, eye.x + s * 0.085, eye.y - 0.06, eye.z - 0.66, 0.25);
    const comb = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.15), new THREE.MeshPhysicalMaterial({ color: 0x9fffd0, transparent: true, opacity: 0.06, roughness: 0.02, metalness: 0, envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide }));
    comb.position.set(eye.x, eye.y - 0.055, eye.z - 0.655); comb.rotation.x = 0.25; g.add(comb);
    this.combiner = comb;
    // side consoles with switch panels
    const conTex = consoleTexture();
    const conMat = new THREE.MeshStandardMaterial({ map: conTex, roughness: 0.7, emissiveMap: conTex, emissive: 0xffffff, emissiveIntensity: 0.12 });
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.2, 0.22, 0.85), dark, eye.x + s * 0.33, eye.y - 0.86, eye.z - 0.25);
      add(new THREE.PlaneGeometry(0.18, 0.8), conMat, eye.x + s * 0.33, eye.y - 0.745, eye.z - 0.25, -Math.PI / 2);
      add(new THREE.BoxGeometry(0.05, 0.42, 1.25), dark, eye.x + s * 0.46, eye.y - 0.55, eye.z - 0.3);   // cockpit walls / sills
      add(new THREE.BoxGeometry(0.08, 0.04, 1.3), grey, eye.x + s * 0.44, eye.y - 0.33, eye.z - 0.3);    // canopy rail
    }
    // floor and pedals
    add(new THREE.BoxGeometry(0.7, 0.04, 1.2), black, eye.x, eye.y - 1.22, eye.z - 0.6);
    this.pedals = [-1, 1].map((s) => add(new THREE.BoxGeometry(0.1, 0.16, 0.03), grey, eye.x + s * 0.12, eye.y - 1.08, eye.z - 1.0, 0.4));
    // stick
    this.stickPivot = new THREE.Group(); this.stickParent = g;
    const side = id === 'f16';
    this.sideStick = side;
    if (side) this.stickPivot.position.set(eye.x + 0.33, eye.y - 0.72, eye.z - 0.33);
    else this.stickPivot.position.set(eye.x, eye.y - 1.0, eye.z - 0.47);
    g.add(this.stickPivot);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.06, 12), black); this.stickPivot.add(boot);
    const shaftL = side ? 0.08 : 0.42;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, shaftL, 10), grey); shaft.position.y = shaftL / 2; this.stickPivot.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.13, 12), black); grip.position.y = shaftL + 0.06; grip.rotation.x = -0.25; this.stickPivot.add(grip);
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), grey); trig.position.set(0, shaftL + 0.05, -0.03); this.stickPivot.add(trig);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 8), new THREE.MeshStandardMaterial({ color: 0xb03020 })); hat.position.set(0, shaftL + 0.13, -0.01); this.stickPivot.add(hat);
    this.gripTop = new THREE.Vector3(0, shaftL + 0.07, 0);
    // throttle quadrant on the left console
    this.throttleBase = new THREE.Vector3(eye.x - 0.33, eye.y - 0.72, eye.z - 0.2);
    add(new THREE.BoxGeometry(0.08, 0.05, 0.3), grey, this.throttleBase.x, this.throttleBase.y, this.throttleBase.z);
    this.throttle = new THREE.Group(); this.throttle.position.copy(this.throttleBase); g.add(this.throttle);
    this.throttle.matrixAutoUpdate = true;
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), grey); lever.position.y = 0.05; this.throttle.add(lever);
    const th = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.08), black); th.position.set(0, 0.11, 0); this.throttle.add(th);
    // canopy bow behind the seat, windscreen frame ahead (not on the F-16's one-piece bubble) and rear-view mirrors
    const frame = new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.55, metalness: 0.45 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.02, 6, 24, Math.PI), frame); arch.position.set(eye.x, eye.y - 0.33, eye.z + 0.55); arch.scale.set(0.96, 0.8, 1); g.add(arch);
    const mirM = new THREE.MeshStandardMaterial({ color: 0x9aa4ac, metalness: 1, roughness: 0.12, envMapIntensity: 0.7 });
    const mirBack = new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.7, metalness: 0.3 });
    const mirror = (parent, x, y, z, ry) => {
      const m = new THREE.Group(); m.position.set(x, y, z); m.rotation.set(0, ry, 0); parent.add(m);
      const housing = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.032, 0.016, 2, 0.006), mirBack); housing.position.z = -0.006; m.add(housing);
      const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.076, 0.025), mirM); glassM.position.z = 0.0035; m.add(glassM);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 6), mirBack); stalk.rotation.z = Math.PI / 2; stalk.position.set(0.045 * Math.sign(-ry || 1), 0, -0.004); m.add(stalk);
      return m;
    };
    if (id !== 'f16') {
      // windscreen frame: A-pillars rising from the glareshield corners and sweeping back into the canopy bow overhead
      for (const sd of [-1, 1]) {
        const pts = [[0.37, -0.27, -0.74], [0.36, -0.04, -0.54], [0.32, 0.16, -0.3], [0.22, 0.29, -0.12], [0.0, 0.33, -0.06]]
          .map(([x, y, z]) => new THREE.Vector3(eye.x + sd * x, eye.y + y, eye.z + z));
        const pillar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.011, 6), frame);
        pillar.castShadow = true; g.add(pillar);
        // mirror on a short stalk, angled in toward the pilot
        mirror(g, eye.x + sd * 0.315, eye.y + 0.1, eye.z - 0.37, -sd * 0.55);
      }
    } else {
      for (const sd of [-1, 1]) mirror(g, eye.x + sd * 0.36, eye.y + 0.05, eye.z + 0.42, sd * 0.55 + Math.PI).rotation.x = 0;
    }
    // inner canopy glass (very faint reflections)
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 16, 0, Math.PI, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.035, roughness: 0.05, metalness: 0, envMapIntensity: 1.5, side: THREE.BackSide, depthWrite: false }));
    glass.rotation.set(0, -Math.PI / 2, -Math.PI / 2); glass.scale.set(1.9, 0.95, 0.85);
    glass.position.set(eye.x, eye.y - 0.32, eye.z - 0.15); g.add(glass);
    // pilot pose targets (pilot-anchor space)
    this._pose = { stickT: new THREE.Vector3(), thrT: new THREE.Vector3() };
  }

  setInteriorVisible(v) { if (this.interior) this.interior.visible = v; }
  // animate stick, throttle, pedals and the pilot's hands from the flight controls
  animate(fm, freeLook = { yaw: 0, pitch: 0 }) {
    const p = this.pilot;
    if (!this.low) {
      const s = fm.surf;
      this.stickPivot.rotation.set(-s.pitch * (this.sideStick ? 0.08 : 0.28), 0, -s.roll * (this.sideStick ? 0.08 : 0.3));
      const thr = clamp(fm.throttle, 0, 1);
      this.throttle.position.z = this.throttleBase.z + 0.1 - thr * 0.22;
      this.throttle.rotation.x = -0.3 + thr * 0.5;
      this.pedals[0].position.z = this.eye.z - 1.0 + s.yaw * 0.04; this.pedals[1].position.z = this.eye.z - 1.0 - s.yaw * 0.04;
      // hand targets (convert cockpit-frame points into the pilot anchor frame)
      this.stickPivot.updateMatrix(); this.throttle.updateMatrix(); this.pilotAnchor.updateMatrix();
      const inv = _inv.copy(this.pilotAnchor.matrix).invert();
      p.handT[1].copy(this.gripTop).applyMatrix4(this.stickPivot.matrix).applyMatrix4(inv);
      p.handN[1].set(-1, 0.1, 0).normalize();
      p.handT[0].set(0, 0.1, 0).applyMatrix4(this.throttle.matrix).applyMatrix4(inv);
      p.handN[0].set(0.45, -1, 0).normalize();
      p.footT[0].set(this.eye.x - 0.12, this.eye.y - 1.04, this.pedals[0].position.z + 0.12).applyMatrix4(inv);
      p.footT[1].set(this.eye.x + 0.12, this.eye.y - 1.04, this.pedals[1].position.z + 0.12).applyMatrix4(inv);
    } else {
      p.handT[1].set(0.02, 0.12, -0.42); p.handT[0].set(-0.24, 0.1, -0.3);
    }
    p.headYaw = freeLook.yaw * 0.9; p.headPitch = freeLook.pitch * 0.7;
    p.update();
  }

  // ---------------- live instrument panel ----------------
  draw(a, units = 'kmh') {
    const g = this.ctx, fm = a.fm;
    if (!g) return;
    g.fillStyle = '#23272b'; g.fillRect(0, 0, PANEL_W, PANEL_H);
    // panel screws & panel seams
    g.strokeStyle = '#15181b'; g.lineWidth = 3; g.strokeRect(6, 6, PANEL_W - 12, PANEL_H - 12); g.beginPath(); g.moveTo(340, 0); g.lineTo(340, PANEL_H); g.moveTo(690, 0); g.lineTo(690, PANEL_H); g.stroke();
    const kts = units === 'kts';
    const spd = fm.V * (kts ? 1.944 : 3.6);
    dial(g, 120, 130, 98, spd, 0, kts ? 1000 : 2000, 10, kts ? 'KNOTS' : 'KM/H', (v) => Math.round(v / (kts ? 100 : 200)) * (kts ? 100 : 200), `${Math.round(spd)}`);
    adi(g, 512, 128, 108, fm);
    const alt = fm.pos.y;
    dial(g, 900, 130, 98, (alt % 1000), 0, 1000, 10, 'ALT M', (v) => Math.round(v / 100), `${Math.round(alt)}`, true);
    const rpm = fm.rpm * 100;
    dial(g, 100, 360, 72, rpm, 0, 110, 11, 'RPM %', (v) => Math.round(v / 10) * 10, `${rpm.toFixed(0)}`, false, rpm > 98 ? '#ff9a3a' : null);
    dial(g, 260, 380, 60, clamp(fm.vel.y, -100, 100), -100, 100, 8, 'VSI m/s', (v) => Math.round(v / 25) * 25, `${fm.vel.y.toFixed(0)}`);
    dial(g, 760, 380, 60, fm.gLoad, -3, 10, 13, 'G', (v) => Math.round(v), fm.gLoad.toFixed(1), false, fm.gLoad > 7 ? '#ff5a3a' : null);
    dial(g, 920, 360, 72, fm.fuel / this.def.fuel * 100, 0, 100, 10, 'FUEL %', (v) => Math.round(v / 25) * 25, `${Math.round(fm.fuel)} kg`, false, fm.fuel / this.def.fuel < 0.15 ? '#ff5a3a' : null);
    // digital weapons display (MFD)
    g.fillStyle = '#060a08'; g.fillRect(372, 306, 280, 190);
    g.strokeStyle = '#3d443f'; g.lineWidth = 6; g.strokeRect(372, 306, 280, 190);
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#5dff9a'; g.font = 'bold 24px monospace'; g.textAlign = 'left';
    g.fillText(`GUN  ${a.gunAmmo}/${a.gunReserve}${a.reloading > 0 ? '  RLD' : ''}`, 388, 334);
    g.fillText(`MSL  ${'■'.repeat(a.missiles)}${'□'.repeat(Math.max(0, 5 - a.missiles))} ${a.missiles}/5`, 388, 366);
    g.fillText(`FLR  ${a.flares}`, 388, 398);
    g.fillText(`THR  ${Math.round(fm.throttle * 100)}%${fm.ab > 0.05 ? ' AB' : ''}`, 388, 430);
    g.fillText(`HDG  ${String(Math.round(((Math.atan2(-a.fwd.x, a.fwd.z) * RAD + 180) % 360 + 360) % 360)).padStart(3, '0')}`, 388, 462);
    g.fillStyle = a.lockState === 2 ? '#ff4a3a' : '#5dff9a'; g.fillText(a.lockState === 2 ? 'LOCK' : a.lockState === 1 ? 'SEEK' : '', 560, 462);
    // warning / gear lights
    const lights = [
      ['GEAR', fm.gear > 0.99 ? '#3cff6a' : fm.gear > 0.01 ? '#ff3b2a' : '#202020'],
      ['HOOK', fm.gearCmd > 0.5 ? '#ffb43a' : '#202020'],
      ['STALL', fm.stall > 0.2 || fm.buffet > 0.6 ? '#ff3b2a' : '#202020'],
      ['ENG', a.engineFire ? '#ff3b2a' : fm.engine === 'running' ? '#202020' : '#ffb43a'],
      ['FUEL', fm.fuel / this.def.fuel < 0.15 ? '#ffb43a' : '#202020'],
      ['AB', fm.ab > 0.05 ? '#ffb43a' : '#202020'],
      ['BRK', fm.input.brake > 0.5 ? '#ffb43a' : '#202020'],
      ['MSL', a.missileWarn ? '#ff3b2a' : '#202020'],
    ];
    lights.forEach(([t, col], i) => {
      const x = 372 + (i % 4) * 70, y = 256 + Math.floor(i / 4) * 22;
      g.fillStyle = col; g.fillRect(x, y, 64, 18);
      g.fillStyle = col === '#202020' ? '#555' : '#000'; g.font = 'bold 13px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x + 32, y + 9);
    });
    this.panelTex.needsUpdate = true;
  }
}
const _inv = new THREE.Matrix4();

function dial(g, cx, cy, r, v, min, max, ticks, label, fmt, digital, wrap = false, warn = null) {
  g.save();
  g.translate(cx, cy);
  const grad = g.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
  grad.addColorStop(0, '#111417'); grad.addColorStop(1, '#070809');
  g.fillStyle = '#3a3f44'; g.beginPath(); g.arc(0, 0, r + 9, 0, 7); g.fill();
  g.fillStyle = grad; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  const a0 = wrap ? -Math.PI / 2 : Math.PI * 0.75, span = wrap ? Math.PI * 2 : Math.PI * 1.5;
  g.strokeStyle = '#e8e8e2'; g.fillStyle = '#e8e8e2'; g.lineWidth = 2;
  g.font = `bold ${Math.round(r * 0.16)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i <= ticks * 5; i++) {
    const t = i / (ticks * 5), a = a0 + span * t;
    const major = i % 5 === 0;
    if (wrap && i === ticks * 5) break;
    g.beginPath(); g.moveTo(Math.cos(a) * r * (major ? 0.8 : 0.88), Math.sin(a) * r * (major ? 0.8 : 0.88)); g.lineTo(Math.cos(a) * r * 0.96, Math.sin(a) * r * 0.96); g.lineWidth = major ? 3 : 1.5; g.stroke();
    if (major) g.fillText(String(fmt(min + (max - min) * t)), Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
  }
  g.fillStyle = '#9aa0a6'; g.font = `bold ${Math.round(r * 0.13)}px Arial`; g.fillText(label, 0, r * 0.3);
  // digital window
  g.fillStyle = '#000'; g.fillRect(-r * 0.42, r * 0.42, r * 0.84, r * 0.24);
  g.fillStyle = warn || '#ffcf5a'; g.font = `bold ${Math.round(r * 0.18)}px monospace`; g.fillText(digital, 0, r * 0.545);
  // needle
  const t = clamp((v - min) / (max - min), 0, 1), a = a0 + span * t;
  g.rotate(a);
  g.fillStyle = warn || '#f2f2ea'; g.beginPath(); g.moveTo(-r * 0.12, -4); g.lineTo(r * 0.86, 0); g.lineTo(-r * 0.12, 4); g.closePath(); g.fill();
  g.fillStyle = '#333'; g.beginPath(); g.arc(0, 0, r * 0.08, 0, 7); g.fill();
  g.restore();
}

function adi(g, cx, cy, r, fm) {
  const e = new THREE.Euler().setFromQuaternion(fm.quat, 'YXZ');
  const pitch = e.x, roll = e.z;
  g.save(); g.translate(cx, cy);
  g.fillStyle = '#3a3f44'; g.beginPath(); g.arc(0, 0, r + 10, 0, 7); g.fill();
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.clip();
  g.rotate(roll);
  const off = pitch * RAD * (r / 40);
  g.fillStyle = '#3d7fc4'; g.fillRect(-r * 2, -r * 4 + off, r * 4, r * 4);
  g.fillStyle = '#7a5530'; g.fillRect(-r * 2, off, r * 4, r * 4);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
  g.lineWidth = 2; g.fillStyle = '#fff'; g.font = 'bold 14px Arial'; g.textAlign = 'left';
  for (let d = -80; d <= 80; d += 10) {
    if (!d) continue;
    const y = off - d * (r / 40), w = d % 20 === 0 ? r * 0.36 : r * 0.18;
    g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
    if (d % 20 === 0) g.fillText(String(Math.abs(d)), w + 4, y + 5);
  }
  g.restore();
  g.save(); g.translate(cx, cy);
  g.strokeStyle = '#ffb000'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(-r * 0.55, 0); g.lineTo(-r * 0.2, 0); g.lineTo(-r * 0.1, r * 0.1); g.moveTo(r * 0.55, 0); g.lineTo(r * 0.2, 0); g.lineTo(r * 0.1, r * 0.1); g.stroke();
  g.fillStyle = '#ffb000'; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
  // roll scale
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const a = -Math.PI / 2 + d * DEG; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); }
  g.rotate(roll); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -r * 0.88); g.lineTo(-7, -r * 0.76); g.lineTo(7, -r * 0.76); g.fill();
  g.restore();
}

function consoleTexture() {
  const { c, g } = makeCanvas(256, 1024);
  g.fillStyle = '#25292d'; g.fillRect(0, 0, 256, 1024);
  let y = 10;
  while (y < 1010) {
    const h = 70 + Math.random() * 110;
    g.fillStyle = '#1c1f22'; g.fillRect(8, y, 240, h - 8);
    g.strokeStyle = '#3c4146'; g.strokeRect(8, y, 240, h - 8);
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const x = 30 + i * (200 / n);
      g.fillStyle = '#9aa0a6'; g.fillRect(x, y + 20, 8, 22);
      g.fillStyle = '#ddd'; g.font = '11px Arial'; g.fillText(['PWR', 'NAV', 'IFF', 'RDR', 'TACN', 'ECM', 'LT', 'O2'][Math.floor(Math.random() * 8)], x - 6, y + 60);
      if (Math.random() < 0.3) { g.fillStyle = '#3cff6a'; g.fillRect(x + 14, y + 22, 6, 6); }
    }
    y += h;
  }
  return canvasTex(c, { srgb: true, repeat: false });
}
