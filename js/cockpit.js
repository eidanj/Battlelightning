// Cockpit interior, built per aircraft: a glass cockpit (F-22, F/A-18, F-16: multi-function displays with bezel
// buttons, up-front controls) or an analog one (F-14, Su-27 in its turquoise paint, A-10: round gauges, CRT scopes).
// The panel is a live canvas (gauges, attitude, tactical map with real contacts, engine and stores pages) with raised
// 3D bezels, rims and buttons over it. Around it: a hooded glareshield with caution lights, the HUD, side consoles
// whose drawn switch panels carry matching 3D knobs and toggles, ribbed sidewalls with breaker panels, padded sills,
// a centre pedestal, rudder pedals, a detailed stick and throttle quadrant, the ejection seat and the pilot.
// Lives in the aircraft's body frame, so it can be shown through the canopy (chase view) or rendered as its own pass
// with a near camera (cockpit view).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeCanvas, canvasTex } from './textures.js';
import { Pilot, buildSeat } from './pilot.js';
import { merge } from './geo.js';
import { clamp, DEG, RAD, makeRng } from './util.js';

const PANEL_W = 1024, PANEL_H = 512, PW = 0.76, PH = 0.38;
const MONO = '"Share Tech Mono", monospace';

// paint and layout per aircraft
const STYLE = {
  f22: { glass: true, twin: true, side: true, paint: '#3a3f43', panel: '#16181a', wall: '#3c4145', label: '#e4e8ea', seed: 22 },
  f16: { glass: true, twin: false, side: true, paint: '#3e4347', panel: '#1a1c1f', wall: '#41464a', label: '#e8ebec', seed: 16 },
  f18: { glass: true, twin: true, side: false, paint: '#454a4e', panel: '#1b1d20', wall: '#464b4f', label: '#e8ebec', seed: 18 },
  f14: { glass: false, twin: true, side: false, paint: '#474c50', panel: '#1d1f22', wall: '#4a4f53', label: '#eceee8', seed: 14 },
  su27: { glass: false, twin: true, side: false, rus: true, paint: '#3b736c', panel: '#2c615c', wall: '#3d7770', label: '#f2f2ea', seed: 27 },
  a10: { glass: false, twin: true, side: false, paint: '#4b5054', panel: '#1e2023', wall: '#4d5256', label: '#eceee8', seed: 10 },
};
// instrument panel layouts in canvas pixels (1024 × 512 over 0.76 × 0.38 m)
const LAYOUT = {
  f22: [
    { k: 'ufc', x: 362, y: 8, w: 300, h: 72 },
    { k: 'mfd', x: 367, y: 104, w: 290, h: 284, page: 'sit' },
    { k: 'mfd', x: 54, y: 150, w: 236, h: 236, page: 'pfd' },
    { k: 'mfd', x: 734, y: 150, w: 236, h: 236, page: 'eng' },
    { k: 'dial', x: 172, y: 68, r: 46, q: 'spd' }, { k: 'dial', x: 852, y: 68, r: 46, q: 'alt' },
    { k: 'lights', x: 384, y: 420, cols: 4, rows: 3, w: 64, h: 22 },
    { k: 'switches', x: 60, y: 420, w: 240, h: 80 }, { k: 'switches', x: 724, y: 420, w: 240, h: 80 },
  ],
  f18: [
    { k: 'ufc', x: 367, y: 8, w: 290, h: 128 },
    { k: 'mfd', x: 40, y: 58, w: 252, h: 252, page: 'pfd' },
    { k: 'mfd', x: 732, y: 58, w: 252, h: 252, page: 'wpn' },
    { k: 'mfd', x: 382, y: 176, w: 260, h: 260, page: 'sit' },
    { k: 'lights', x: 44, y: 340, cols: 4, rows: 2, w: 60, h: 20 },
    { k: 'dial', x: 110, y: 448, r: 50, q: 'spd' }, { k: 'dial', x: 240, y: 448, r: 50, q: 'alt' },
    { k: 'dial', x: 790, y: 448, r: 50, q: 'rpm' }, { k: 'dial', x: 920, y: 448, r: 50, q: 'fuel' },
    { k: 'switches', x: 730, y: 336, w: 260, h: 40 },
  ],
  f16: [
    { k: 'ded', x: 387, y: 8, w: 250, h: 66 },
    { k: 'keys', x: 412, y: 84, w: 200, h: 38 },
    { k: 'adi', x: 512, y: 214, r: 76 },
    { k: 'hsi', x: 512, y: 404, r: 70 },
    { k: 'dial', x: 352, y: 214, r: 60, q: 'spd' }, { k: 'dial', x: 672, y: 214, r: 60, q: 'alt' },
    { k: 'dial', x: 356, y: 404, r: 52, q: 'aoa' }, { k: 'dial', x: 668, y: 404, r: 52, q: 'vsi' },
    { k: 'mfd', x: 40, y: 150, w: 224, h: 224, page: 'eng' },
    { k: 'mfd', x: 760, y: 150, w: 224, h: 224, page: 'sit' },
    { k: 'lights', x: 44, y: 412, cols: 3, rows: 2, w: 70, h: 22 },
    { k: 'dial', x: 830, y: 452, r: 46, q: 'fuel' }, { k: 'dial', x: 940, y: 452, r: 46, q: 'rpm' },
    { k: 'switches', x: 40, y: 20, w: 300, h: 90 }, { k: 'switches', x: 684, y: 20, w: 300, h: 90 },
  ],
  f14: [
    { k: 'crt', x: 407, y: 18, w: 210, h: 176, page: 'pfd' },
    { k: 'scope', x: 512, y: 372, r: 104, page: 'radar' },
    { k: 'dial', x: 116, y: 104, r: 78, q: 'spd' }, { k: 'dial', x: 296, y: 96, r: 58, q: 'aoa' },
    { k: 'dial', x: 296, y: 250, r: 56, q: 'g' }, { k: 'dial', x: 116, y: 280, r: 64, q: 'vsi' },
    { k: 'dial', x: 908, y: 104, r: 78, q: 'alt' }, { k: 'dial', x: 728, y: 96, r: 56, q: 'rpm' },
    { k: 'dial', x: 728, y: 250, r: 56, q: 'itt' }, { k: 'dial', x: 908, y: 280, r: 64, q: 'fuel' },
    { k: 'lights', x: 40, y: 372, cols: 4, rows: 2, w: 68, h: 22 }, { k: 'lights', x: 712, y: 372, cols: 4, rows: 2, w: 68, h: 22 },
    { k: 'dial', x: 200, y: 466, r: 36, q: 'clock' }, { k: 'dial', x: 824, y: 466, r: 36, q: 'mach' },
  ],
  su27: [
    { k: 'adi', x: 512, y: 150, r: 104 },
    { k: 'hsi', x: 512, y: 392, r: 88 },
    { k: 'scope', x: 712, y: 112, r: 72, page: 'radarB' },
    { k: 'dial', x: 130, y: 116, r: 80, q: 'spd' }, { k: 'dial', x: 318, y: 106, r: 58, q: 'aoa' },
    { k: 'dial', x: 318, y: 272, r: 56, q: 'g' }, { k: 'dial', x: 130, y: 320, r: 66, q: 'vsi' },
    { k: 'dial', x: 894, y: 116, r: 80, q: 'alt' }, { k: 'dial', x: 712, y: 290, r: 56, q: 'rpm' },
    { k: 'dial', x: 894, y: 320, r: 66, q: 'fuel' },
    { k: 'lights', x: 40, y: 420, cols: 4, rows: 2, w: 68, h: 22, rus: true }, { k: 'lights', x: 712, y: 420, cols: 4, rows: 2, w: 68, h: 22, rus: true },
  ],
  a10: [
    { k: 'crt', x: 40, y: 24, w: 196, h: 166, page: 'tv' },
    { k: 'adi', x: 512, y: 132, r: 94 },
    { k: 'hsi', x: 512, y: 384, r: 90 },
    { k: 'dial', x: 334, y: 100, r: 64, q: 'spd' }, { k: 'dial', x: 690, y: 100, r: 64, q: 'alt' },
    { k: 'dial', x: 334, y: 278, r: 54, q: 'aoa' }, { k: 'dial', x: 690, y: 278, r: 54, q: 'vsi' },
    { k: 'dial', x: 832, y: 64, r: 40, q: 'itt' }, { k: 'dial', x: 934, y: 64, r: 40, q: 'itt' },
    { k: 'dial', x: 832, y: 162, r: 40, q: 'rpm' }, { k: 'dial', x: 934, y: 162, r: 40, q: 'rpm' },
    { k: 'dial', x: 832, y: 260, r: 40, q: 'ff' }, { k: 'dial', x: 934, y: 260, r: 40, q: 'ff' },
    { k: 'dial', x: 884, y: 416, r: 62, q: 'fuel' }, { k: 'dial', x: 140, y: 300, r: 50, q: 'clock' },
    { k: 'lights', x: 40, y: 400, cols: 4, rows: 2, w: 68, h: 22 },
  ],
};
const CAUTIONS = ['GEAR', 'HOOK', 'STALL', 'ENG', 'FUEL', 'AB', 'BRK', 'MSL', 'OVHT', 'HYD', 'GEN', 'OXY'];
const CAUTIONS_RU = ['ШАССИ', 'КРЮК', 'СРЫВ', 'ДВИГ', 'ТОПЛ', 'ФОРС', 'ТОРМ', 'РАКЕТ'];

export class Cockpit {
  constructor(def, team = 'navy', lowDetail = false) {
    this.def = def;
    const eye = new THREE.Vector3(...def.geo.eye);
    this.eye = eye;
    this.group = new THREE.Group();
    this.low = lowDetail;
    this.style = STYLE[def.id] || STYLE.f18;
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
    const id = this.def.id, S = this.style;
    this.interior = new THREE.Group(); this.group.add(this.interior);
    const g = this.interior;
    const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.35, ...o });
    const M = this.mats = {
      paint: std({ color: S.paint, roughness: 0.78, metalness: 0.08 }),
      panel: std({ color: S.panel, roughness: 0.7, metalness: 0.15 }),
      black: std({ color: 0x0c0d0e, roughness: 0.92 }),
      rubber: std({ color: 0x151617, roughness: 0.97 }),
      metal: std({ color: 0x8a9096, roughness: 0.35, metalness: 0.85 }),
      bezel: std({ color: 0x1d2023, roughness: 0.55, metalness: 0.35 }),
      button: std({ color: 0x33373b, roughness: 0.6, metalness: 0.2 }),
      knob: std({ color: 0x141516, roughness: 0.5, metalness: 0.2 }),
      toggle: std({ color: 0xc9cdd1, roughness: 0.3, metalness: 0.9 }),
      yellow: std({ color: 0xe0b400, roughness: 0.6 }),
      pad: std({ color: 0x1a1b1c, roughness: 1.0 }),
      frame: std({ color: 0x2c3034, roughness: 0.55, metalness: 0.45 }),
    };
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    const layout = LAYOUT[id] || LAYOUT.f18;
    this.layout = layout;

    // ---- main instrument panel: live canvas + 3D bezels, rims and buttons in the panel's own frame
    const { c, g: ctx } = makeCanvas(PANEL_W, PANEL_H);
    this.canvas = c; this.ctx = ctx;
    this._units = 'kmh'; this.staticPanel = panelBackground(layout, S, 'kmh', this.def);
    this.panelTex = canvasTex(c, { srgb: true, repeat: false });
    const panelMat = std({ map: this.panelTex, emissiveMap: this.panelTex, emissive: 0xffffff, emissiveIntensity: S.rus ? 0.16 : 0.5, roughness: 0.6, metalness: 0.1 });
    const pz = eye.z - 0.74, py = eye.y - 0.42;
    const pg = this.panelGroup = new THREE.Group(); pg.position.set(eye.x, py, pz); pg.rotation.x = -0.22; g.add(pg);
    this.panel = add(new THREE.PlaneGeometry(PW, PH), panelMat, 0, 0, 0, 0, 0, 0, pg);
    add(new RoundedBoxGeometry(PW + 0.07, PH + 0.06, 0.06, 2, 0.012), M.paint, 0, -0.005, -0.032, 0, 0, 0, pg);
    const B = buildPanelHardware(layout);
    if (B.bezel) add(B.bezel, M.bezel, 0, 0, 0, 0, 0, 0, pg);
    if (B.buttons) add(B.buttons, M.button, 0, 0, 0, 0, 0, 0, pg);
    if (B.knobs) add(B.knobs, M.knob, 0, 0, 0, 0, 0, 0, pg);
    if (B.toggles) add(B.toggles, M.toggle, 0, 0, 0, 0, 0, 0, pg);
    // centre pedestal between the knees, down to the floor
    const pedTex = canvasTex(pedestalTexture(S), { srgb: true, repeat: false });
    add(new THREE.BoxGeometry(0.1, 0.34, 0.16), M.paint, eye.x, py - 0.36, pz + 0.02);
    add(new THREE.PlaneGeometry(0.09, 0.32), std({ map: pedTex, emissiveMap: pedTex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.7 }), eye.x, py - 0.36, pz + 0.101);

    // ---- glareshield hood with a padded lip, caution lights and the HUD
    // a thin, flat anti-glare hood (a thick black one reads as a seat back when the cockpit is in shadow)
    const hood = std({ color: 0x26292c, roughness: 0.96, metalness: 0.05 });
    add(new RoundedBoxGeometry(PW + 0.1, 0.024, 0.27, 2, 0.01), hood, eye.x, eye.y - 0.2, eye.z - 0.86, 0.06);
    add(new RoundedBoxGeometry(PW + 0.09, 0.014, 0.022, 2, 0.006), M.rubber, eye.x, eye.y - 0.214, eye.z - 0.733);
    for (const sd of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.26, 0.3), M.paint, eye.x + sd * (PW / 2 + 0.03), eye.y - 0.36, eye.z - 0.78, -0.22); // panel cheeks
    const lightMat = (col) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0, roughness: 0.4 });
    this.capLight = add(new RoundedBoxGeometry(0.05, 0.026, 0.02, 2, 0.004), lightMat(0xffa21a), eye.x - 0.2, eye.y - 0.165, eye.z - 0.745, -0.5);
    this.warnLight = add(new RoundedBoxGeometry(0.05, 0.026, 0.02, 2, 0.004), lightMat(0xff2a1a), eye.x + 0.2, eye.y - 0.165, eye.z - 0.745, -0.5);
    add(new THREE.BoxGeometry(0.058, 0.032, 0.016), M.bezel, eye.x - 0.2, eye.y - 0.167, eye.z - 0.752, -0.5);
    add(new THREE.BoxGeometry(0.058, 0.032, 0.016), M.bezel, eye.x + 0.2, eye.y - 0.167, eye.z - 0.752, -0.5);
    // AOA indexer: slow (green) / on speed (amber) / fast (red)
    this.aoaLights = [0x31ff6a, 0xffb21a, 0xff3a2a].map((col, i) => add(new THREE.BoxGeometry(0.016, 0.01, 0.008), lightMat(col), eye.x - 0.13, eye.y - 0.15 - i * 0.013, eye.z - 0.735, -0.4));
    add(new THREE.BoxGeometry(0.026, 0.05, 0.01), M.bezel, eye.x - 0.13, eye.y - 0.162, eye.z - 0.74, -0.4);
    // HUD: body, control panel face, combiner glass on two posts
    add(new RoundedBoxGeometry(0.17, 0.055, 0.15, 2, 0.008), M.frame, eye.x, eye.y - 0.18, eye.z - 0.73);
    add(new THREE.BoxGeometry(0.15, 0.026, 0.008), M.button, eye.x, eye.y - 0.186, eye.z - 0.653, -0.3);
    // combiner sized to the symbology's clip area (hud.js: x ±0.12, y −0.07…0.13 in the glass's frame), with the
    // boresight near its upper third like a real HUD
    for (const sd of [-1, 1]) add(new THREE.BoxGeometry(0.012, 0.225, 0.012), M.frame, eye.x + sd * 0.126, eye.y - 0.04, eye.z - 0.664, 0.25);
    const combMat = new THREE.MeshPhysicalMaterial({ color: 0x9fffd0, transparent: true, opacity: 0.07, roughness: 0.02, metalness: 0, envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide });
    const combGeo = new THREE.PlaneGeometry(0.24, 0.22); combGeo.translate(0, 0.02, 0);
    const comb = new THREE.Mesh(combGeo, combMat);
    comb.position.set(eye.x, eye.y - 0.055, eye.z - 0.655); comb.rotation.x = 0.25; g.add(comb);
    if (!S.glass) { const c2 = comb.clone(); c2.position.z -= 0.02; c2.position.y += 0.005; g.add(c2); }
    add(new THREE.BoxGeometry(0.262, 0.012, 0.012), M.frame, eye.x, eye.y + 0.071, eye.z - 0.687, 0.25);
    this.combiner = comb;

    // ---- side consoles: drawn switch panels with matching 3D knobs/toggles/guards
    for (const sd of [-1, 1]) {
      const reserve = sd < 0 ? [0.33, 0.8] : S.side ? [0.22, 0.78] : null; // throttle quadrant / side-stick armrest
      const con = consolePanel(S, sd, reserve);
      const tex = canvasTex(con.canvas, { srgb: true, repeat: false });
      const cx = eye.x + sd * 0.33, cz = eye.z - 0.25, top = eye.y - 0.745, W = 0.18, L = 0.8;
      add(new THREE.BoxGeometry(0.2, 0.22, 0.85), M.paint, cx, eye.y - 0.86, cz);
      add(new THREE.PlaneGeometry(W, L), std({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: S.rus ? 0.08 : 0.18, roughness: 0.72 }), cx, top, cz, -Math.PI / 2);
      const parts = consoleHardware(con.items, cx, top, cz, W, L);
      for (const k of ['knobs', 'toggles', 'guards', 'buttons']) if (parts[k]) add(parts[k], k === 'toggles' ? M.toggle : k === 'guards' ? std({ color: S.rus ? 0xc42a1e : 0xb8241a, roughness: 0.5 }) : k === 'buttons' ? M.button : M.knob, 0, 0, 0);
      // sidewall: ribbed structure with breaker panels on the inside face, padded sill and the canopy rail on top
      add(new THREE.BoxGeometry(0.05, 0.42, 1.25), M.paint, eye.x + sd * 0.46, eye.y - 0.55, eye.z - 0.3);
      const wt = canvasTex(sidewallTexture(S, sd), { srgb: true, repeat: false });
      add(new THREE.PlaneGeometry(1.25, 0.42), std({ map: wt, roughness: 0.8, metalness: 0.1 }), eye.x + sd * 0.4345, eye.y - 0.55, eye.z - 0.3, 0, -sd * Math.PI / 2);
      add(new RoundedBoxGeometry(0.06, 0.034, 1.28, 2, 0.012), M.pad, eye.x + sd * 0.448, eye.y - 0.33, eye.z - 0.3);
      add(new THREE.BoxGeometry(0.03, 0.025, 1.32), M.metal, eye.x + sd * 0.49, eye.y - 0.31, eye.z - 0.3);
      // grab handle on the canopy sill
      add(new THREE.TorusGeometry(0.024, 0.005, 6, 12, Math.PI), M.yellow, eye.x + sd * 0.43, eye.y - 0.312, eye.z - 0.66, 0, Math.PI / 2, 0);
    }
    // floor and rudder pedals (plate on an arm, with a heel rest)
    const ft = canvasTex(floorTexture(), { srgb: true, repeat: false });
    add(new THREE.PlaneGeometry(0.7, 1.2), std({ map: ft, roughness: 0.95 }), eye.x, eye.y - 1.2, eye.z - 0.6, -Math.PI / 2);
    this.pedals = [-1, 1].map((s) => {
      const p = new THREE.Group(); p.position.set(eye.x + s * 0.12, eye.y - 1.08, eye.z - 1.0); g.add(p);
      add(new RoundedBoxGeometry(0.1, 0.17, 0.025, 2, 0.008), M.metal, 0, 0, 0, 0.4, 0, 0, p);
      add(new THREE.BoxGeometry(0.08, 0.012, 0.03), M.rubber, 0, -0.03, 0.02, 0.4, 0, 0, p);
      add(new THREE.BoxGeometry(0.02, 0.02, 0.12), M.frame, 0, -0.07, -0.06, 0, 0, 0, p);
      return p;
    });
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.12, 0.02, 0.1), M.rubber, eye.x + s * 0.12, eye.y - 1.18, eye.z - 0.86, 0.3);

    // ---- stick: centre stick on a rubber boot, or a side-stick on an armrest (F-16 / F-22)
    this.stickPivot = new THREE.Group(); this.stickParent = g;
    const side = S.side;
    this.sideStick = side;
    if (side) this.stickPivot.position.set(eye.x + 0.33, eye.y - 0.72, eye.z - 0.33);
    else this.stickPivot.position.set(eye.x, eye.y - 1.0, eye.z - 0.47);
    g.add(this.stickPivot);
    const sp = this.stickPivot;
    if (side) {
      add(new RoundedBoxGeometry(0.1, 0.04, 0.26, 2, 0.015), M.pad, eye.x + 0.33, eye.y - 0.735, eye.z - 0.18); // armrest
      add(new THREE.CylinderGeometry(0.03, 0.036, 0.03, 14), M.rubber, 0, 0, 0, 0, 0, 0, sp);
    } else {
      for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.05 - i * 0.006, 0.056 - i * 0.006, 0.016, 14), M.rubber, 0, 0.008 + i * 0.014, 0, 0, 0, 0, sp);
    }
    const shaftL = side ? 0.07 : 0.42;
    add(new THREE.CylinderGeometry(0.013, 0.016, shaftL, 10), M.metal, 0, shaftL / 2, 0, 0, 0, 0, sp);
    const grip = new THREE.Group(); grip.position.y = shaftL; grip.rotation.x = side ? -0.35 : -0.22; sp.add(grip);
    add(new THREE.CapsuleGeometry(0.024, 0.08, 4, 12), M.black, 0, 0.055, 0, 0, 0, 0, grip);
    add(new THREE.SphereGeometry(0.03, 14, 10), M.black, 0, 0.115, -0.006, 0, 0, 0, grip).scale.set(0.95, 0.7, 1.2);
    add(new THREE.BoxGeometry(0.012, 0.026, 0.014), M.metal, 0, 0.075, -0.03, 0.4, 0, 0, grip);                 // trigger
    add(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 8), std({ color: 0xb03020, roughness: 0.5 }), 0.01, 0.135, -0.01, 0, 0, 0, grip); // pickle
    add(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 8), M.metal, -0.012, 0.13, 0.008, 0, 0, 0, grip);      // trim hat
    add(new THREE.BoxGeometry(0.01, 0.014, 0.012), M.button, 0.021, 0.1, 0.01, 0, 0, 0, grip);                 // pinky / paddle
    this.gripTop = new THREE.Vector3(0, shaftL + 0.07, 0);
    // ---- throttle quadrant on the left console: gated slots, one or two levers with button-covered grips
    this.throttleBase = new THREE.Vector3(eye.x - 0.33, eye.y - 0.72, eye.z - 0.2);
    add(new RoundedBoxGeometry(0.12, 0.05, 0.36, 2, 0.01), M.paint, this.throttleBase.x, this.throttleBase.y - 0.002, this.throttleBase.z);
    add(new THREE.BoxGeometry(S.twin ? 0.05 : 0.016, 0.006, 0.3), M.black, this.throttleBase.x, this.throttleBase.y + 0.024, this.throttleBase.z);
    add(new THREE.BoxGeometry(0.11, 0.008, 0.008), M.yellow, this.throttleBase.x, this.throttleBase.y + 0.026, this.throttleBase.z - 0.09); // AB gate
    this.throttle = new THREE.Group(); this.throttle.position.copy(this.throttleBase); g.add(this.throttle);
    this.throttle.matrixAutoUpdate = true;
    for (const ox of S.twin ? [-0.016, 0.016] : [0]) add(new THREE.BoxGeometry(0.012, 0.09, 0.016), M.metal, ox, 0.045, 0, 0, 0, 0, this.throttle);
    const tg = new THREE.Group(); tg.position.set(0, 0.11, 0); this.throttle.add(tg);
    add(new RoundedBoxGeometry(S.twin ? 0.07 : 0.055, 0.05, 0.085, 3, 0.014), M.black, 0, 0, 0, 0, 0, 0, tg);
    add(new THREE.CylinderGeometry(0.006, 0.006, 0.008, 8), M.metal, 0.012, 0.027, -0.02, 0, 0, 0, tg);
    add(new THREE.BoxGeometry(0.014, 0.008, 0.01), M.button, -0.012, 0.027, -0.012, 0, 0, 0, tg);
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.01, 8), std({ color: 0xc0c0c0, roughness: 0.4, metalness: 0.6 }), 0.03, 0.01, -0.03, 0, 0, Math.PI / 2, tg);
    add(new THREE.BoxGeometry(0.012, 0.016, 0.02), M.button, -0.034, 0.006, 0.0, 0, 0, 0, tg);

    // ---- canopy bow behind the seat, windscreen frame ahead (not on the one-piece bubbles) and rear-view mirrors
    const frame = M.frame;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.022, 8, 28, Math.PI), frame); arch.position.set(eye.x, eye.y - 0.33, eye.z + 0.55); arch.scale.set(0.96, 0.8, 1); g.add(arch);
    const mirM = new THREE.MeshStandardMaterial({ color: 0x9aa4ac, metalness: 1, roughness: 0.12, envMapIntensity: 0.7 });
    const mirBack = new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.7, metalness: 0.3 });
    const mirror = (parent, x, y, z, ry) => {
      const m = new THREE.Group(); m.position.set(x, y, z); m.rotation.set(0, ry, 0); parent.add(m);
      const housing = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.032, 0.016, 2, 0.006), mirBack); housing.position.z = -0.006; m.add(housing);
      const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.076, 0.025), mirM); glassM.position.z = 0.0035; m.add(glassM);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 6), mirBack); stalk.rotation.z = Math.PI / 2; stalk.position.set(0.045 * Math.sign(-ry || 1), 0, -0.004); m.add(stalk);
      return m;
    };
    if (id !== 'f16' && id !== 'f22') {
      // windscreen frame: A-pillars rising from the glareshield corners and sweeping back into the canopy bow overhead
      for (const sd of [-1, 1]) {
        const pts = [[0.37, -0.27, -0.74], [0.36, -0.04, -0.54], [0.32, 0.16, -0.3], [0.22, 0.29, -0.12], [0.0, 0.33, -0.06]]
          .map(([x, y, z]) => new THREE.Vector3(eye.x + sd * x, eye.y + y, eye.z + z));
        const pillar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 6), frame);
        pillar.castShadow = true; g.add(pillar);
        mirror(g, eye.x + sd * 0.315, eye.y + 0.1, eye.z - 0.37, -sd * 0.55);
      }
      // standby (whiskey) compass on the windscreen bow
      add(new RoundedBoxGeometry(0.05, 0.04, 0.04, 2, 0.008), M.black, eye.x, eye.y + 0.3, eye.z - 0.09);
    } else {
      for (const sd of [-1, 1]) mirror(g, eye.x + sd * 0.36, eye.y + 0.05, eye.z + 0.42, sd * 0.55 + Math.PI).rotation.x = 0;
    }
    // inner canopy glass (very faint reflections)
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 16, 0, Math.PI, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.035, roughness: 0.05, metalness: 0, envMapIntensity: 1.5, side: THREE.BackSide, depthWrite: false }));
    glass.rotation.set(0, -Math.PI / 2, -Math.PI / 2); glass.scale.set(1.9, 0.95, 0.85);
    glass.position.set(eye.x, eye.y - 0.32, eye.z - 0.15); g.add(glass);
    this._pose = { stickT: new THREE.Vector3(), thrT: new THREE.Vector3() };
    this._t = 0;
    this._mergeStatic(g);
  }
  // fold the static interior meshes into one mesh per material (fewer draw calls in the cockpit and its shadow pass)
  _mergeStatic(g) {
    const groups = new Map();
    for (const o of g.children) {
      if (!o.isMesh || o.material.transparent) continue;
      if (!groups.has(o.material)) groups.set(o.material, []);
      groups.get(o.material).push(o);
    }
    for (const [mat, list] of groups) {
      if (list.length < 2) continue;
      const geos = list.map((o) => { o.updateMatrix(); return o.geometry.clone().applyMatrix4(o.matrix); });
      const m = new THREE.Mesh(merge(geos), mat); m.castShadow = true; m.receiveShadow = true; g.add(m);
      for (const o of list) { g.remove(o); o.geometry.dispose(); }
    }
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
      p.handT[0].set(0, 0.11, 0).applyMatrix4(this.throttle.matrix).applyMatrix4(inv);
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
    this._t += 1 / 24;
    if (units !== this._units) { this._units = units; this.staticPanel = panelBackground(this.layout, this.style, units, this.def); }
    g.drawImage(this.staticPanel, 0, 0);
    const ctx = { a, fm, units, t: this._t, def: this.def, style: this.style, game: a.game };
    for (const it of this.layout) {
      if (it.k === 'dial') dialLive(g, it.x, it.y, it.r, quantity(it.q, ctx));
      else if (it.k === 'adi') adi(g, it.x, it.y, it.r, fm, this.style.rus);
      else if (it.k === 'hsi') hsi(g, it.x, it.y, it.r, a);
      else if (it.k === 'mfd' || it.k === 'crt') screen(g, it, ctx);
      else if (it.k === 'scope') scope(g, it, ctx);
      else if (it.k === 'lights') lights(g, it, a, fm);
      else if (it.k === 'ufc') ufc(g, it, ctx);
      else if (it.k === 'ded') ded(g, it, ctx);
    }
    this.panelTex.needsUpdate = true;
    // glareshield lights
    const caution = fm.fuel / this.def.fuel < 0.15 || fm.stall > 0.2 || a.health < 0.6 || fm.engine === 'dead';
    const warn = a.missileWarn || a.engineFire || fm.dmg.wingLost;
    const blink = (this._t * 2.5) % 1 < 0.6;
    this.capLight.material.emissiveIntensity = caution ? 2.2 : 0.02;
    this.warnLight.material.emissiveIntensity = warn && blink ? 2.6 : 0.02;
    const gearDown = fm.gearCmd > 0.5 && !fm.onGround;
    const ra = fm.alpha * RAD;
    this.aoaLights[0].material.emissiveIntensity = gearDown && ra > 9.3 ? 2 : 0;
    this.aoaLights[1].material.emissiveIntensity = gearDown && ra > 6.9 && ra < 9.3 + 0.8 ? 2 : 0;
    this.aoaLights[2].material.emissiveIntensity = gearDown && ra < 6.9 ? 2 : 0;
  }
}
const _inv = new THREE.Matrix4();

// ---------------- panel construction ----------------
const PX = PW / PANEL_W;
const toLocal = (x, y) => [(x - PANEL_W / 2) * PX, (PANEL_H / 2 - y) * PX];

// static layer: paint, engraved labels, gauge cups, screen glass, screws, drawn switches. Drawn once.
function panelBackground(layout, S, units, def) {
  const still = { a: {}, fm: { V: 0, pos: { y: 0 }, rpm: 0, vel: { y: 0 }, gLoad: 1, fuel: 0, alpha: 0, mach: 0, ab: 0 }, units, t: 0, def };
  const { c, g } = makeCanvas(PANEL_W, PANEL_H);
  const r = makeRng(S.seed);
  g.fillStyle = S.panel; g.fillRect(0, 0, PANEL_W, PANEL_H);
  // subtle paint texture: speckle and soft wear
  const img = g.getImageData(0, 0, PANEL_W, PANEL_H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  // sub-panel seams with screw heads at the corners
  const seams = S.glass ? [[0, 0, 340, PANEL_H], [340, 0, 344, PANEL_H], [684, 0, 340, PANEL_H]] : [[0, 0, 360, PANEL_H], [360, 0, 304, PANEL_H], [664, 0, 360, PANEL_H]];
  for (const [x, y, w, h] of seams) {
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3; g.strokeRect(x + 3, y + 3, w - 6, h - 6);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; g.strokeRect(x + 5, y + 5, w - 10, h - 10);
    for (const [sx, sy] of [[x + 12, y + 12], [x + w - 12, y + 12], [x + 12, y + h - 12], [x + w - 12, y + h - 12]]) screw(g, sx, sy, r);
  }
  for (const it of layout) {
    if (it.k === 'dial' || it.k === 'adi' || it.k === 'hsi' || it.k === 'scope') {
      const R = it.r + (it.k === 'dial' ? 9 : 10);
      const gr = g.createRadialGradient(it.x - R * 0.3, it.y - R * 0.3, R * 0.2, it.x, it.y, R + 6);
      gr.addColorStop(0, '#4a5056'); gr.addColorStop(1, '#16191b');
      g.fillStyle = gr; g.beginPath(); g.arc(it.x, it.y, R + 5, 0, 7); g.fill();
      for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; screw(g, it.x + Math.cos(a) * (R + 12), it.y + Math.sin(a) * (R + 12), r, 4); }
      if (it.k === 'dial') dialFace(g, it.x, it.y, it.r, quantity(it.q, still), S.rus);
    } else if (it.k === 'mfd' || it.k === 'crt' || it.k === 'ufc' || it.k === 'ded') {
      const m = it.k === 'mfd' ? 26 : 14;
      g.fillStyle = '#121416'; roundRect(g, it.x - m, it.y - m, it.w + m * 2, it.h + m * 2, 10); g.fill();
      if (it.k === 'mfd') { // OSB legends
        g.fillStyle = S.label; g.font = `bold 9px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        const L = ['MENU', 'SMS', 'HSD', 'FCR', 'TGP', 'DCLT', 'SWAP', 'DTE', 'TEST', 'FLIR'];
        for (let i = 0; i < 5; i++) { const t = (i + 0.5) / 5; g.fillText(L[(i + Math.floor(it.x)) % L.length], it.x + it.w * t, it.y - 18); g.fillText(L[(i + 3 + Math.floor(it.y)) % L.length], it.x + it.w * t, it.y + it.h + 19); }
      }
    } else if (it.k === 'lights') {
      g.fillStyle = '#0f1112'; roundRect(g, it.x - 8, it.y - 8, it.cols * (it.w + 6) + 10, it.rows * (it.h + 5) + 12, 6); g.fill();
    } else if (it.k === 'switches') {
      drawSwitchCluster(g, it, S, r);
    } else if (it.k === 'keys') {
      g.fillStyle = '#121416'; roundRect(g, it.x - 6, it.y - 4, it.w + 12, it.h + 8, 6); g.fill();
    }
  }
  // stencilled labels on gauges are drawn live; placards and small text here
  g.fillStyle = S.label; g.globalAlpha = 0.65; g.font = `bold 11px ${MONO}`; g.textAlign = 'left';
  g.fillText(S.rus ? 'ОСТОРОЖНО' : 'CAUTION', 20, PANEL_H - 14);
  g.textAlign = 'right'; g.fillText(S.rus ? 'ВЫКЛ  ВКЛ' : 'MASTER ARM', PANEL_W - 22, PANEL_H - 14); g.globalAlpha = 1;
  return c;
}
function screw(g, x, y, r, s = 5) {
  g.fillStyle = '#5a6066'; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
  g.strokeStyle = '#1a1c1e'; g.lineWidth = 1.5; const a = r() * Math.PI; g.beginPath(); g.moveTo(x - Math.cos(a) * s * 0.8, y - Math.sin(a) * s * 0.8); g.lineTo(x + Math.cos(a) * s * 0.8, y + Math.sin(a) * s * 0.8); g.stroke();
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawSwitchCluster(g, it, S, r) {
  g.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(g, it.x, it.y, it.w, it.h, 6); g.fill();
  const n = Math.max(2, Math.floor(it.w / 48));
  g.font = `bold 9px ${MONO}`; g.textAlign = 'center'; g.fillStyle = S.label;
  const names = S.rus ? ['ПИТ', 'НАВ', 'РЛС', 'АРК', 'СВЕТ', 'КИС'] : ['PWR', 'NAV', 'RDR', 'IFF', 'ECM', 'LT', 'O2', 'TACN', 'ANT', 'JTSN'];
  it.items = [];
  for (let i = 0; i < n; i++) {
    const x = it.x + (i + 0.5) * it.w / n, y = it.y + it.h * 0.45;
    g.fillText(names[Math.floor(r() * names.length)], x, it.y + it.h - 8);
    it.items.push({ x, y, t: r() < 0.65 ? 'toggle' : 'knob' });
  }
}

// 3D hardware over the panel, merged per material
function buildPanelHardware(layout) {
  const bez = [], btn = [], knob = [], tog = [];
  const put = (geo, x, y, z, rx = 0) => { const [lx, ly] = toLocal(x, y); geo.rotateX(rx); geo.translate(lx, ly, z); return geo; };
  for (const it of layout) {
    if (it.k === 'dial' || it.k === 'adi' || it.k === 'hsi' || it.k === 'scope') {
      const R = (it.r + 6) * PX;
      const t = new THREE.TorusGeometry(R, 4.5 * PX, 6, 32); bez.push(put(t, it.x, it.y, 0.003));
    } else if (it.k === 'mfd' || it.k === 'crt' || it.k === 'ufc' || it.k === 'ded') {
      const m = (it.k === 'mfd' ? 22 : 10), dz = it.k === 'mfd' ? 0.012 : 0.008;
      const W = it.w + m * 2, H = it.h + m * 2, cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      bez.push(put(new THREE.BoxGeometry(W * PX, m * PX, dz), cx, it.y - m / 2, dz / 2));
      bez.push(put(new THREE.BoxGeometry(W * PX, m * PX, dz), cx, it.y + it.h + m / 2, dz / 2));
      bez.push(put(new THREE.BoxGeometry(m * PX, it.h * PX, dz), it.x - m / 2, cy, dz / 2));
      bez.push(put(new THREE.BoxGeometry(m * PX, it.h * PX, dz), it.x + it.w + m / 2, cy, dz / 2));
      if (it.k === 'mfd') {
        // option select buttons: five per edge, plus the corner rockers
        for (let i = 0; i < 5; i++) {
          const t = (i + 0.5) / 5;
          for (const [x, y] of [[it.x + it.w * t, it.y - m * 0.45 + 4], [it.x + it.w * t, it.y + it.h + m * 0.45 - 4], [it.x - m * 0.5, it.y + it.h * t], [it.x + it.w + m * 0.5, it.y + it.h * t]]) btn.push(put(new THREE.BoxGeometry(13 * PX, 11 * PX, 0.006), x, y, dz + 0.003));
        }
        for (const [x, y] of [[it.x - m * 0.5, it.y - m * 0.5], [it.x + it.w + m * 0.5, it.y - m * 0.5], [it.x - m * 0.5, it.y + it.h + m * 0.5], [it.x + it.w + m * 0.5, it.y + it.h + m * 0.5]]) btn.push(put(new THREE.BoxGeometry(16 * PX, 8 * PX, 0.008), x, y, dz + 0.004));
      }
    } else if (it.k === 'keys') {
      const cols = 6, rows = 2;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) btn.push(put(new THREE.BoxGeometry(22 * PX, 13 * PX, 0.007), it.x + (i + 0.5) * it.w / cols, it.y + (j + 0.5) * it.h / rows, 0.0035));
    } else if (it.k === 'switches') {
      for (const s of it.items || []) {
        if (s.t === 'toggle') { tog.push(put(new THREE.CylinderGeometry(2.4 * PX, 3 * PX, 0.022, 8), s.x, s.y, 0.011, Math.PI / 2 - 0.4)); knob.push(put(new THREE.CylinderGeometry(7 * PX, 7 * PX, 0.004, 12), s.x, s.y, 0.002, Math.PI / 2)); }
        else { knob.push(put(new THREE.CylinderGeometry(10 * PX, 11 * PX, 0.014, 14), s.x, s.y, 0.007, Math.PI / 2)); tog.push(put(new THREE.BoxGeometry(2 * PX, 14 * PX, 0.002), s.x, s.y, 0.0145)); }
      }
    }
    if (it.k === 'ufc') {
      // keypad: 3 × 4 to the right of the scratchpad, function keys along the left
      const kx = it.x + it.w - 96, ky = it.y + 8, kw = 88, kh = it.h - 16;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) btn.push(put(new THREE.BoxGeometry(22 * PX, (kh / 4 - 4) * PX, 0.008), kx + (i + 0.5) * kw / 3, ky + (j + 0.5) * kh / 4, 0.004));
      for (let j = 0; j < 4; j++) btn.push(put(new THREE.BoxGeometry(30 * PX, (kh / 4 - 4) * PX, 0.008), it.x + 22, ky + (j + 0.5) * kh / 4, 0.004));
    }
  }
  const m = (list) => list.length ? merge(list) : null;
  return { bezel: m(bez), buttons: m(btn), knobs: m(knob), toggles: m(tog) };
}

// ---------------- consoles, walls, floor ----------------
function consolePanel(S, sd, reserve) {
  const W = 256, H = 1152, { c, g } = makeCanvas(W, H);
  const r = makeRng(S.seed * 7 + (sd > 0 ? 3 : 1));
  g.fillStyle = S.paint; g.fillRect(0, 0, W, H);
  const items = [];
  const namesL = S.rus ? ['РАДИО', 'ТОПЛИВО', 'ЗАПУСК', 'СВЕТ', 'АВАР'] : ['COMM 1', 'FUEL', 'ENGINE START', 'EXT LIGHTS', 'ANTI-ICE', 'APU', 'IFF'];
  const namesR = S.rus ? ['НАВИГАЦИЯ', 'КИСЛОРОД', 'ОТОПЛ', 'ЭЛЕКТР', 'РЛС'] : ['NAV / TACAN', 'OXYGEN', 'ECS', 'ELEC', 'SENSOR', 'INT LIGHTS', 'DEFOG'];
  const names = sd < 0 ? namesL : namesR;
  let y = 8;
  while (y < H - 40) {
    const h = 110 + Math.floor(r() * 120);
    const y1 = Math.min(H - 8, y + h);
    if (reserve && y1 / H > reserve[0] && y / H < reserve[1]) {
      // skip over the throttle quadrant / armrest region; leave a plain plate there
      const ry0 = reserve[0] * H, ry1 = reserve[1] * H;
      if (y < ry0 - 60) drawConsolePanel(g, 8, y, W - 16, ry0 - y - 6, names, S, r, items, W, H);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(8, ry0, W - 16, ry1 - ry0);
      if (sd < 0) { g.fillStyle = S.label; g.font = `bold 14px ${MONO}`; g.textAlign = 'left'; ['OFF', 'IDLE', 'MIL', 'AB'].forEach((t, i) => g.fillText(t, 16, ry1 - 14 - i * (ry1 - ry0 - 30) / 3)); }
      y = ry1 + 6; continue;
    }
    drawConsolePanel(g, 8, y, W - 16, y1 - y - 6, names, S, r, items, W, H);
    y = y1;
  }
  return { canvas: c, items };
}
function drawConsolePanel(g, x, y, w, h, names, S, r, items, W, H) {
  if (h < 50) return;
  g.fillStyle = S.panel; roundRect(g, x, y, w, h, 6); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; roundRect(g, x + 2, y + 2, w - 4, h - 4, 5); g.stroke();
  for (const [sx, sy] of [[x + 9, y + 9], [x + w - 9, y + 9], [x + 9, y + h - 9], [x + w - 9, y + h - 9]]) screw(g, sx, sy, r, 4);
  g.fillStyle = S.label; g.font = `bold 13px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(names[Math.floor(r() * names.length)], x + w / 2, y + 18);
  // a row or two of switches / knobs, with legends
  const rows = h > 150 ? 2 : 1;
  for (let j = 0; j < rows; j++) {
    const n = 2 + Math.floor(r() * 3), cy = y + 46 + j * (h - 60) / rows + (h - 60) / rows * 0.35;
    for (let i = 0; i < n; i++) {
      const cx = x + (i + 0.5) * w / n, t = r();
      const type = t < 0.5 ? 'toggle' : t < 0.8 ? 'knob' : 'guard';
      g.fillStyle = '#0b0c0d'; g.beginPath(); g.arc(cx, cy, type === 'knob' ? 17 : 11, 0, 7); g.fill();
      if (type === 'knob') { g.strokeStyle = S.label; g.lineWidth = 1.5; for (let k = 0; k < 5; k++) { const a = -Math.PI * 0.8 + k * Math.PI * 0.4; g.beginPath(); g.moveTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20); g.lineTo(cx + Math.cos(a) * 25, cy + Math.sin(a) * 25); g.stroke(); } }
      else { g.fillStyle = S.label; g.font = `bold 9px ${MONO}`; g.fillText(S.rus ? 'ВКЛ' : 'ON', cx, cy - 20); g.fillText(S.rus ? 'ВЫКЛ' : 'OFF', cx, cy + 22); }
      if (r() < 0.35) { g.fillStyle = r() < 0.5 ? '#3cff6a' : '#ffb43a'; g.beginPath(); g.arc(cx + 16, cy - 14, 3, 0, 7); g.fill(); }
      items.push({ type, u: cx / W, v: cy / H });
    }
  }
}
function consoleHardware(items, cx, top, cz, W, L) {
  const knobs = [], toggles = [], guards = [], buttons = [];
  for (const it of items) {
    const x = cx + (it.u - 0.5) * W, z = cz - (0.5 - it.v) * L;
    if (it.type === 'knob') { const k = new THREE.CylinderGeometry(0.011, 0.013, 0.016, 14); k.translate(x, top + 0.008, z); knobs.push(k); const p = new THREE.BoxGeometry(0.003, 0.002, 0.012); p.translate(x, top + 0.0165, z - 0.003); buttons.push(p); }
    else {
      const b = new THREE.CylinderGeometry(0.006, 0.006, 0.004, 10); b.translate(x, top + 0.002, z); knobs.push(b);
      const t = new THREE.CylinderGeometry(0.0018, 0.0024, 0.02, 8); t.rotateX(-0.35); t.translate(x, top + 0.011, z - 0.003); toggles.push(t);
      if (it.type === 'guard') { const gd = new THREE.BoxGeometry(0.016, 0.014, 0.028); gd.translate(x, top + 0.008, z + 0.002); guards.push(gd); }
    }
  }
  const m = (l) => l.length ? merge(l) : null;
  return { knobs: m(knobs), toggles: m(toggles), guards: m(guards), buttons: m(buttons) };
}
function sidewallTexture(S, sd) {
  const W = 1024, H = 344, { c, g } = makeCanvas(W, H), r = makeRng(S.seed + (sd > 0 ? 50 : 40));
  g.fillStyle = S.wall; g.fillRect(0, 0, W, H);
  // frames and stringers
  for (let x = 30; x < W; x += 118) { const gr = g.createLinearGradient(x - 10, 0, x + 10, 0); gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)'); g.fillStyle = gr; g.fillRect(x - 10, 0, 20, H); }
  for (const y of [40, H - 40]) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, y - 4, W, 8); }
  // rivet rows
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 30; x < W; x += 118) for (let y = 12; y < H; y += 16) { g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
  // wiring bundle along the lower edge
  g.strokeStyle = '#1b1d1f'; g.lineWidth = 10; g.beginPath(); g.moveTo(0, H - 22); for (let x = 0; x <= W; x += 64) g.lineTo(x, H - 22 + Math.sin(x * 0.02) * 4); g.stroke();
  g.strokeStyle = '#7a5a2a'; g.lineWidth = 2; g.stroke();
  for (let x = 40; x < W; x += 90) { g.fillStyle = '#c8c8c0'; g.fillRect(x, H - 28, 6, 12); }
  // circuit breaker panels and a map case (the forward half faces the pilot)
  const panels = [[90, 70, 240, 150], [420, 80, 200, 120], [700, 60, 280, 170]];
  panels.forEach(([x, y, w, h], i) => {
    g.fillStyle = S.panel; roundRect(g, x, y, w, h, 6); g.fill();
    for (const [sx, sy] of [[x + 9, y + 9], [x + w - 9, y + 9], [x + 9, y + h - 9], [x + w - 9, y + h - 9]]) screw(g, sx, sy, r, 4);
    if (i === 1) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x + 14, y + 26, w - 28, h - 40); g.fillStyle = S.label; g.font = `bold 13px ${MONO}`; g.textAlign = 'center'; g.fillText(S.rus ? 'КАРТЫ' : 'MAP CASE', x + w / 2, y + 16); return; }
    g.fillStyle = S.label; g.font = `bold 10px ${MONO}`; g.textAlign = 'center';
    for (let yy = y + 26; yy < y + h - 16; yy += 30) for (let xx = x + 20; xx < x + w - 14; xx += 26) {
      g.fillStyle = '#0a0b0c'; g.beginPath(); g.arc(xx, yy, 7, 0, 7); g.fill();
      g.fillStyle = '#d8d8d0'; g.beginPath(); g.arc(xx, yy, 3, 0, 7); g.fill();
    }
  });
  return c;
}
function pedestalTexture(S) {
  const W = 96, H = 340, { c, g } = makeCanvas(W, H), r = makeRng(S.seed + 9);
  g.fillStyle = S.panel; g.fillRect(0, 0, W, H);
  g.fillStyle = S.label; g.font = `bold 9px ${MONO}`; g.textAlign = 'center';
  for (let y = 20; y < H - 20; y += 64) {
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.strokeRect(6, y - 14, W - 12, 56);
    g.fillText(['BRAKES', 'EMER', 'HOOK', 'JETT', 'GEAR'][Math.floor(r() * 5)], W / 2, y);
    g.fillStyle = '#0b0c0d'; g.beginPath(); g.arc(W / 2, y + 22, 12, 0, 7); g.fill(); g.fillStyle = S.label;
  }
  return c;
}
function floorTexture() {
  const W = 256, H = 512, { c, g } = makeCanvas(W, H), r = makeRng(3);
  g.fillStyle = '#1d1f21'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 8) { g.fillStyle = y % 16 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.25)'; g.fillRect(0, y, W, 3); }
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.2})`; g.fillRect(r() * W, r() * H, 2 + r() * 8, 1 + r() * 3); }
  return c;
}

// ---------------- live gauges and displays ----------------
function quantity(q, { a, fm, units, t, def }) {
  const kts = units === 'kts';
  switch (q) {
    case 'spd': { const spd = fm.V * (kts ? 1.944 : 3.6); return { v: spd, min: 0, max: kts ? 1000 : 2000, ticks: 10, label: kts ? 'KNOTS' : 'KM/H', fmt: (v) => Math.round(v / (kts ? 100 : 200)), digital: `${Math.round(spd)}` }; }
    case 'alt': return { v: fm.pos.y % 1000, min: 0, max: 1000, ticks: 10, label: 'ALT M', fmt: (v) => Math.round(v / 100), digital: `${Math.round(fm.pos.y)}`, wrap: true };
    case 'rpm': { const v = fm.rpm * 100; return { v, min: 0, max: 110, ticks: 11, label: 'RPM %', fmt: (x) => Math.round(x / 10) * 10, digital: v.toFixed(0), warn: v > 98 ? '#ff9a3a' : null }; }
    case 'vsi': return { v: clamp(fm.vel.y, -100, 100), min: -100, max: 100, ticks: 8, label: 'VSI m/s', fmt: (x) => Math.round(x / 25) * 25, digital: fm.vel.y.toFixed(0) };
    case 'g': return { v: fm.gLoad, min: -3, max: 10, ticks: 13, label: 'G', fmt: (x) => Math.round(x), digital: fm.gLoad.toFixed(1), warn: fm.gLoad > 7 ? '#ff5a3a' : null };
    case 'fuel': { const f = fm.fuel / def.fuel * 100; return { v: f, min: 0, max: 100, ticks: 10, label: 'FUEL %', fmt: (x) => Math.round(x / 25) * 25, digital: `${Math.round(fm.fuel)}`, warn: f < 15 ? '#ff5a3a' : null }; }
    case 'aoa': { const v = fm.alpha * RAD; return { v, min: -5, max: 35, ticks: 8, label: 'AOA °', fmt: (x) => Math.round(x), digital: v.toFixed(0), warn: fm.stall > 0.2 ? '#ff5a3a' : null }; }
    case 'mach': return { v: fm.mach, min: 0, max: 2.5, ticks: 5, label: 'MACH', fmt: (x) => x.toFixed(1), digital: fm.mach.toFixed(2) };
    case 'itt': { const v = 280 + fm.rpm * 520 + fm.ab * 140; return { v, min: 0, max: 1100, ticks: 11, label: 'TEMP °C', fmt: (x) => Math.round(x / 100), digital: v.toFixed(0), warn: v > 900 ? '#ff9a3a' : null }; }
    case 'ff': { const v = ((def.flowMil || 1) * fm.rpm * fm.rpm + (def.flowAB || 0) * fm.ab) * 3600; return { v, min: 0, max: 8000, ticks: 8, label: 'FF KG/H', fmt: (x) => Math.round(x / 1000), digital: v.toFixed(0) }; }
    case 'clock': { const s = (t + 9 * 3600 + 1234) % 43200; return { v: (s / 3600) % 12, min: 0, max: 12, ticks: 12, label: 'CLOCK', fmt: (x) => Math.round(x) || 12, digital: `${String(Math.floor(s / 3600) || 12).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`, wrap: true }; }
    default: return { v: 0, min: 0, max: 1, ticks: 5, label: '', fmt: () => '', digital: '' };
  }
}

// gauge face (static: drawn once into the panel background): dial, ticks, numerals, limit arc, label, window
function dialFace(g, cx, cy, r, q, rus = false) {
  const { min, max, ticks, label, fmt, wrap } = q;
  g.save();
  g.translate(cx, cy);
  const grad = g.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, '#16191c'); grad.addColorStop(1, '#060708');
  g.fillStyle = grad; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  const a0 = wrap ? -Math.PI / 2 : Math.PI * 0.75, span = wrap ? Math.PI * 2 : Math.PI * 1.5;
  const ink = rus ? '#f4f0e0' : '#e8e8e2';
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 2;
  g.font = `bold ${Math.round(r * 0.17)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i <= ticks * 5; i++) {
    const t = i / (ticks * 5), a = a0 + span * t;
    const major = i % 5 === 0;
    if (wrap && i === ticks * 5) break;
    g.beginPath(); g.moveTo(Math.cos(a) * r * (major ? 0.8 : 0.88), Math.sin(a) * r * (major ? 0.8 : 0.88)); g.lineTo(Math.cos(a) * r * 0.96, Math.sin(a) * r * 0.96); g.lineWidth = major ? 3 : 1.4; g.stroke();
    if (major) g.fillText(String(fmt(min + (max - min) * t)), Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
  }
  // red / amber limit arc on the upper end of non-wrapping gauges
  if (!wrap) { g.strokeStyle = '#c8321e'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, r * 0.92, a0 + span * 0.9, a0 + span); g.stroke(); }
  g.fillStyle = '#9aa0a6'; g.font = `bold ${Math.round(r * 0.13)}px Arial`; g.fillText(label, 0, r * 0.3);
  g.fillStyle = '#000'; g.fillRect(-r * 0.42, r * 0.42, r * 0.84, r * 0.24);
  g.restore();
}
// gauge needle and digital readout (live)
function dialLive(g, cx, cy, r, q) {
  const { v, min, max, digital, wrap, warn } = q;
  g.save();
  g.translate(cx, cy);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = warn || '#ffcf5a'; g.font = `bold ${Math.round(r * 0.18)}px monospace`; g.fillText(digital, 0, r * 0.545);
  const a0 = wrap ? -Math.PI / 2 : Math.PI * 0.75, span = wrap ? Math.PI * 2 : Math.PI * 1.5;
  // needle with a shadow, then the hub
  const t = clamp((v - min) / (max - min), 0, 1), a = a0 + span * t;
  g.rotate(a);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.moveTo(-r * 0.12, -1); g.lineTo(r * 0.86, 4); g.lineTo(-r * 0.12, 7); g.closePath(); g.fill();
  g.fillStyle = warn || '#f2f2ea'; g.beginPath(); g.moveTo(-r * 0.12, -4); g.lineTo(r * 0.86, 0); g.lineTo(-r * 0.12, 4); g.closePath(); g.fill();
  g.fillStyle = '#333'; g.beginPath(); g.arc(0, 0, r * 0.08, 0, 7); g.fill();
  g.restore();
  // glass glint
  g.save(); g.globalAlpha = 0.08; g.fillStyle = '#fff'; g.beginPath(); g.ellipse(cx - r * 0.25, cy - r * 0.45, r * 0.55, r * 0.22, -0.4, 0, 7); g.fill(); g.restore();
}

function adi(g, cx, cy, r, fm, rus = false) {
  const e = _e.setFromQuaternion(fm.quat, 'YXZ');
  const pitch = e.x, roll = e.z;
  g.save(); g.translate(cx, cy);
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.clip();
  g.rotate(roll);
  const off = pitch * RAD * (r / 40);
  // Soviet ADIs are blue over brown too, with the sky darker
  g.fillStyle = rus ? '#2d6fb0' : '#3d7fc4'; g.fillRect(-r * 2, -r * 4 + off, r * 4, r * 4);
  g.fillStyle = rus ? '#6a4626' : '#7a5530'; g.fillRect(-r * 2, off, r * 4, r * 4);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
  g.lineWidth = 2; g.fillStyle = '#fff'; g.font = `bold ${Math.round(r * 0.13)}px Arial`; g.textAlign = 'left';
  for (let d = -80; d <= 80; d += 10) {
    if (!d) continue;
    const y = off - d * (r / 40), w = d % 20 === 0 ? r * 0.36 : r * 0.18;
    g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
    if (d % 20 === 0) g.fillText(String(Math.abs(d)), w + 4, y + 5);
  }
  g.restore();
  g.save(); g.translate(cx, cy);
  // shaded ball edge
  const sh = g.createRadialGradient(0, 0, r * 0.7, 0, 0, r); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = sh; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.strokeStyle = '#ffb000'; g.lineWidth = Math.max(3, r * 0.05);
  g.beginPath(); g.moveTo(-r * 0.55, 0); g.lineTo(-r * 0.2, 0); g.lineTo(-r * 0.1, r * 0.1); g.moveTo(r * 0.55, 0); g.lineTo(r * 0.2, 0); g.lineTo(r * 0.1, r * 0.1); g.stroke();
  g.fillStyle = '#ffb000'; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const a = -Math.PI / 2 + d * DEG; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); }
  g.rotate(roll); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -r * 0.88); g.lineTo(-7, -r * 0.76); g.lineTo(7, -r * 0.76); g.fill();
  g.restore();
}
const _e = new THREE.Euler();

function heading(a) { return ((Math.atan2(-a.fwd.x, a.fwd.z) * RAD + 180) % 360 + 360) % 360; }
// horizontal situation indicator: rotating compass card, course arrow, aircraft symbol
const _cards = new Map();
function hsiCard(r) {
  if (_cards.has(r)) return _cards.get(r);
  const S = Math.ceil(r * 2 + 4), { c, g } = makeCanvas(S, S);
  g.translate(S / 2, S / 2);
  g.fillStyle = '#07080a'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.strokeStyle = '#e8e8e2'; g.fillStyle = '#e8e8e2'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let d = 0; d < 360; d += 5) {
    const a0 = d * DEG - Math.PI / 2, major = d % 30 === 0, mid = d % 10 === 0;
    g.lineWidth = major ? 3 : 1.5; g.beginPath(); g.moveTo(Math.cos(a0) * r * (major ? 0.78 : mid ? 0.84 : 0.88), Math.sin(a0) * r * (major ? 0.78 : mid ? 0.84 : 0.88)); g.lineTo(Math.cos(a0) * r * 0.95, Math.sin(a0) * r * 0.95); g.stroke();
    if (major) { g.save(); g.rotate(d * DEG); g.font = `bold ${Math.round(r * 0.17)}px Arial`; g.fillText(d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10), 0, -r * 0.64); g.restore(); }
  }
  _cards.set(r, c);
  return c;
}
function hsi(g, cx, cy, r, a) {
  const hdg = heading(a);
  g.save(); g.translate(cx, cy);
  g.save(); g.rotate(-hdg * DEG);
  const card = hsiCard(r); g.drawImage(card, -card.width / 2, -card.height / 2);
  // course arrow toward the carrier / base (fixed bearing for flavour)
  g.rotate(225 * DEG); g.strokeStyle = '#d24ad8'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, r * 0.55); g.lineTo(0, -r * 0.55); g.moveTo(-8, -r * 0.42); g.lineTo(0, -r * 0.55); g.lineTo(8, -r * 0.42); g.stroke();
  g.restore();
  g.strokeStyle = '#ffb000'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -r * 0.22); g.lineTo(0, r * 0.2); g.moveTo(-r * 0.16, -r * 0.02); g.lineTo(r * 0.16, -r * 0.02); g.moveTo(-r * 0.08, r * 0.17); g.lineTo(r * 0.08, r * 0.17); g.stroke();
  g.fillStyle = '#ffb000'; g.beginPath(); g.moveTo(0, -r * 0.98); g.lineTo(-7, -r * 0.86); g.lineTo(7, -r * 0.86); g.fill();
  g.fillStyle = '#000'; g.fillRect(-r * 0.24, r * 0.6, r * 0.48, r * 0.22); g.fillStyle = '#ffcf5a'; g.font = `bold ${Math.round(r * 0.17)}px monospace`; g.textAlign = 'center'; g.fillText(String(Math.round(hdg)).padStart(3, '0'), 0, r * 0.72);
  g.restore();
}

// glass display or CRT page
function screen(g, it, ctx) {
  const { x, y, w, h } = it;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = it.k === 'crt' ? '#04100a' : '#020403'; g.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h / 2;
  const page = it.page;
  if (page === 'sit') sitPage(g, it, ctx, false);
  else if (page === 'pfd') pfdPage(g, it, ctx);
  else if (page === 'eng') engPage(g, it, ctx);
  else if (page === 'wpn') wpnPage(g, it, ctx);
  else if (page === 'tv') tvPage(g, it, ctx);
  // scanlines on CRTs, a faint glass sheen on glass
  if (it.k === 'crt') { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let yy = y; yy < y + h; yy += 3) g.fillRect(x, yy, w, 1); }
  const gl = g.createLinearGradient(x, y, x + w, y + h); gl.addColorStop(0, 'rgba(255,255,255,0.06)'); gl.addColorStop(0.4, 'rgba(255,255,255,0)'); g.fillStyle = gl; g.fillRect(x, y, w, h);
  g.restore();
  void cx; void cy;
}
// tactical situation display: heading-up, own ship at the bottom, range rings, friends and spotted enemies
function sitPage(g, it, ctx, round) {
  const { x, y, w, h } = it, a = ctx.a, game = ctx.game;
  const ox = x + w / 2, oy = round ? y + h / 2 : y + h * 0.78, R = round ? Math.min(w, h) * 0.47 : h * 0.72;
  const range = 40000, k = R / range;
  const col = '#5dff9a';
  g.strokeStyle = 'rgba(93,255,154,0.35)'; g.lineWidth = 1.5;
  for (const f of [0.25, 0.5, 1]) { g.beginPath(); g.arc(ox, oy, R * f, Math.PI, 0); if (round) g.arc(ox, oy, R * f, 0, Math.PI); g.stroke(); }
  g.fillStyle = col; g.font = `bold 12px ${MONO}`; g.textAlign = 'left'; g.fillText('40', ox + 4, oy - R + 12); g.fillText('20', ox + 4, oy - R * 0.5 + 12);
  // compass ticks along the top ring
  const hdg = heading(a) * DEG;
  g.strokeStyle = col; g.lineWidth = 2;
  for (let d = 0; d < 360; d += 10) { const ang = d * DEG - hdg - Math.PI / 2; if (!round && Math.sin(ang) > 0.05) continue; g.beginPath(); g.moveTo(ox + Math.cos(ang) * R, oy + Math.sin(ang) * R); g.lineTo(ox + Math.cos(ang) * (R - (d % 30 ? 5 : 11)), oy + Math.sin(ang) * (R - (d % 30 ? 5 : 11))); g.stroke(); }
  // contacts
  if (game) {
    const ch = Math.cos(hdg), shh = Math.sin(hdg);
    for (const o of game.aircraft) {
      if (o === a || !o.alive || o.parked) continue;
      const dx = o.fm.pos.x - a.fm.pos.x, dz = o.fm.pos.z - a.fm.pos.z;
      if (dx * dx + dz * dz > range * range) continue;
      const friend = o.team === a.team;
      if (!friend && !game.isSpotted?.(o) && dx * dx + dz * dz > 12000 * 12000) continue;
      // rotate world into heading-up (forward = up on the display)
      const rx = dx * ch + dz * shh, rz = -dx * shh + dz * ch;
      const sx = ox + rx * k, sy = oy + rz * k;
      if (!round && sy > y + h - 4) continue;
      const oh = Math.atan2(-o.fwd.x, o.fwd.z) - hdg;
      g.save(); g.translate(sx, sy);
      if (friend) { g.strokeStyle = '#4fc3ff'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 6, Math.PI, 0); g.stroke(); }
      else { g.strokeStyle = '#ff4a3a'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -7); g.lineTo(7, 0); g.lineTo(0, 7); g.lineTo(-7, 0); g.closePath(); g.stroke(); if (a.lock?.target === o && a.lockState === 2) { g.strokeRect(-11, -11, 22, 22); } }
      g.rotate(oh + Math.PI); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -14); g.stroke();
      g.restore();
    }
    for (const m of game.weapons?.missiles || []) {
      const dx = m.pos.x - a.fm.pos.x, dz = m.pos.z - a.fm.pos.z;
      const rx = dx * ch + dz * shh, rz = -dx * shh + dz * ch;
      g.fillStyle = m.team === a.team ? '#bfe3ff' : '#ff8a6a'; g.fillRect(ox + rx * k - 2, oy + rz * k - 2, 4, 4);
    }
  }
  // own ship
  g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 2;
  g.beginPath(); g.moveTo(ox, oy - 10); g.lineTo(ox + 7, oy + 8); g.lineTo(ox, oy + 4); g.lineTo(ox - 7, oy + 8); g.closePath(); g.fill();
  g.font = `bold 13px ${MONO}`; g.textAlign = 'left'; g.fillText(`HDG ${String(Math.round(heading(a))).padStart(3, '0')}`, x + 8, y + 16);
  g.textAlign = 'right'; g.fillText(a.lockState === 2 ? 'LOCK' : 'SRCH', x + w - 8, y + 16);
}
function pfdPage(g, it, ctx) {
  const { x, y, w, h } = it, fm = ctx.fm;
  const r = Math.min(w, h) * 0.32;
  adi(g, x + w / 2, y + h * 0.5, r, fm);
  const kts = ctx.units === 'kts';
  const col = '#5dff9a';
  g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 2; g.font = `bold ${Math.round(h * 0.07)}px ${MONO}`;
  // speed and altitude tapes
  const tape = (tx, val, step, right) => {
    g.save(); g.beginPath(); g.rect(tx - 30, y + 10, 60, h - 20); g.clip();
    const pxPer = (h - 20) / (step * 6);
    for (let v = Math.floor(val / step - 4) * step; v < val + step * 4; v += step) {
      const yy = y + h / 2 - (v - val) * pxPer;
      g.beginPath(); g.moveTo(right ? tx - 28 : tx + 28, yy); g.lineTo(right ? tx - 18 : tx + 18, yy); g.stroke();
      g.textAlign = right ? 'left' : 'right'; g.font = `${Math.round(h * 0.055)}px ${MONO}`; g.fillText(String(Math.round(v)), right ? tx - 14 : tx + 14, yy + 4);
    }
    g.restore();
    g.fillStyle = '#000'; g.fillRect(tx - 30, y + h / 2 - 12, 60, 24); g.strokeRect(tx - 30, y + h / 2 - 12, 60, 24);
    g.fillStyle = col; g.textAlign = 'center'; g.font = `bold ${Math.round(h * 0.065)}px ${MONO}`; g.fillText(String(Math.round(val)), tx, y + h / 2 + 6);
  };
  tape(x + 34, fm.V * (kts ? 1.944 : 3.6), kts ? 20 : 50, false);
  tape(x + w - 34, fm.pos.y, 100, true);
  g.textAlign = 'center'; g.font = `bold ${Math.round(h * 0.06)}px ${MONO}`;
  g.fillText(`G ${fm.gLoad.toFixed(1)}   M ${fm.mach.toFixed(2)}`, x + w / 2, y + h - 10);
  g.fillText(`α ${(fm.alpha * RAD).toFixed(0)}`, x + w / 2, y + 18);
}
function engPage(g, it, ctx) {
  const { x, y, w, h } = it, fm = ctx.fm, def = ctx.def, a = ctx.a;
  const col = '#5dff9a';
  g.font = `bold ${Math.round(h * 0.065)}px ${MONO}`; g.textAlign = 'center'; g.fillStyle = col;
  g.fillText('ENGINE', x + w / 2, y + 18);
  const twin = def.engine?.twin;
  const bars = [['RPM', fm.rpm, 1.05], ['NOZ', 0.2 + fm.ab * 0.7 + (1 - fm.rpm) * 0.1, 1], ['TEMP', (280 + fm.rpm * 520 + fm.ab * 140) / 1100, 1]];
  const groups = twin ? 2 : 1, bw = 12, gap = 8;
  bars.forEach(([lab, v], i) => {
    const bx = x + 20 + i * (w - 40) / 3, by = y + 36, bh = h * 0.42;
    for (let e = 0; e < groups; e++) {
      const xx = bx + e * (bw + gap) + (twin ? 0 : (bw + gap) / 2);
      g.strokeStyle = col; g.lineWidth = 1.5; g.strokeRect(xx, by, bw, bh);
      const f = clamp(v + (e ? 0.004 : 0), 0, 1);
      g.fillStyle = f > 0.92 ? '#ffb43a' : col; g.fillRect(xx + 2, by + bh - f * (bh - 4) - 2, bw - 4, f * (bh - 4));
    }
    g.fillStyle = col; g.font = `bold ${Math.round(h * 0.05)}px ${MONO}`; g.fillText(lab, bx + (twin ? bw + gap / 2 : bw + gap / 2), by + bh + 16);
  });
  const fuel = fm.fuel, ff = ((def.flowMil || 1) * fm.rpm * fm.rpm + (def.flowAB || 0) * fm.ab) * 3600;
  g.textAlign = 'left'; g.font = `bold ${Math.round(h * 0.07)}px ${MONO}`;
  g.fillStyle = fuel / def.fuel < 0.15 ? '#ff5a3a' : col;
  g.fillText(`FUEL ${Math.round(fuel)} KG`, x + 14, y + h - 42);
  g.fillStyle = col; g.fillText(`FF   ${Math.round(ff)} KG/H`, x + 14, y + h - 18);
  if (a.engineFire) { g.fillStyle = '#ff3a2a'; g.textAlign = 'right'; g.fillText('FIRE', x + w - 12, y + 18); }
}
function wpnPage(g, it, ctx) {
  const { x, y, w, h } = it, a = ctx.a, col = '#5dff9a';
  const cx = x + w / 2, cy = y + h * 0.48;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
  // planform outline
  g.beginPath(); g.moveTo(cx, cy - h * 0.34); g.lineTo(cx + 12, cy - h * 0.1); g.lineTo(cx + w * 0.38, cy + h * 0.08); g.lineTo(cx + w * 0.38, cy + h * 0.14); g.lineTo(cx + 14, cy + h * 0.12);
  g.lineTo(cx + w * 0.14, cy + h * 0.3); g.lineTo(cx - w * 0.14, cy + h * 0.3); g.lineTo(cx - 14, cy + h * 0.12); g.lineTo(cx - w * 0.38, cy + h * 0.14); g.lineTo(cx - w * 0.38, cy + h * 0.08); g.lineTo(cx - 12, cy - h * 0.1); g.closePath(); g.stroke();
  const n = a.maxMissiles || 5;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2, sx = cx + t * w * 0.32, sy = cy + h * 0.06 + Math.abs(t) * 6;
    const full = i < a.missiles;
    g.beginPath(); g.rect(sx - 5, sy - 14, 10, 28); full ? g.fill() : g.stroke();
  }
  g.font = `bold ${Math.round(h * 0.065)}px ${MONO}`; g.textAlign = 'center';
  g.fillText(`${a.def.missile.name}  ${a.missiles}/${n}`, cx, y + h - 46);
  g.fillText(a.reloading > 0 ? 'GUN  RELOADING' : `GUN  ${a.gunAmmo}/${a.gunReserve}`, cx, y + h - 24);
  g.textAlign = 'left'; g.fillText('SMS', x + 10, y + 18); g.textAlign = 'right'; g.fillText(`FLR ${a.flares}`, x + w - 10, y + 18);
}
// A-10 targeting camera: a grainy grey picture of the ground below, with a crosshair
const _tv = { key: null, c: null };
function tvPage(g, it, ctx) {
  const { x, y, w, h } = it, fm = ctx.fm;
  const sx = Math.floor(fm.pos.x / 40), sz = Math.floor(fm.pos.z / 40), key = sx * 100003 + sz;
  if (_tv.key !== key || !_tv.c) {
    // the picture only changes when the ground under the camera does
    if (!_tv.c) _tv.c = makeCanvas(w, h);
    const tg = _tv.c.g, r = makeRng(((sx * 73856093) ^ (sz * 19349663)) >>> 0);
    tg.fillStyle = '#2b2f2b'; tg.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { const v = 40 + Math.floor(r() * 70); tg.fillStyle = `rgb(${v},${v + 4},${v})`; tg.fillRect(r() * w, r() * h, 8 + r() * 40, 6 + r() * 30); }
    _tv.key = key;
  }
  g.drawImage(_tv.c.c, x, y);
  g.fillStyle = 'rgba(160,160,160,0.3)';
  for (let i = 0; i < 60; i++) g.fillRect(x + Math.random() * w, y + Math.random() * h, 2, 1);
  g.strokeStyle = '#e8e8e0'; g.lineWidth = 1.5; const cx = x + w / 2, cy = y + h / 2;
  g.beginPath(); g.moveTo(cx - 30, cy); g.lineTo(cx - 8, cy); g.moveTo(cx + 8, cy); g.lineTo(cx + 30, cy); g.moveTo(cx, cy - 30); g.lineTo(cx, cy - 8); g.moveTo(cx, cy + 8); g.lineTo(cx, cy + 30); g.stroke();
  g.fillStyle = '#e8e8e0'; g.font = `bold 12px ${MONO}`; g.textAlign = 'left'; g.fillText('TGP  WHOT', x + 6, y + 14); g.textAlign = 'right'; g.fillText(`${(fm.pos.y / 1000).toFixed(1)} KM`, x + w - 6, y + h - 6);
}
// round radar scope (F-14 HSD / Su-27): sweeping beam with fading returns
function scope(g, it, ctx) {
  const { x, y, r } = it, a = ctx.a, game = ctx.game;
  g.save(); g.translate(x, y);
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.clip();
  g.fillStyle = it.page === 'radarB' ? '#03120c' : '#020c08'; g.fillRect(-r, -r, r * 2, r * 2);
  const col = it.page === 'radarB' ? '120,255,190' : '93,255,154';
  g.strokeStyle = `rgba(${col},0.3)`; g.lineWidth = 1;
  for (const f of [0.33, 0.66, 1]) { g.beginPath(); g.arc(0, 0, r * f * 0.96, 0, 7); g.stroke(); }
  for (let d = 0; d < 360; d += 30) { const an = d * DEG; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(an) * r, Math.sin(an) * r); g.stroke(); }
  const sweep = (ctx.t * 2.2) % (Math.PI * 2);
  const grd = g.createConicGradient ? g.createConicGradient(sweep - 0.9, 0, 0) : null;
  if (grd) { grd.addColorStop(0, `rgba(${col},0)`); grd.addColorStop(0.14, `rgba(${col},0.32)`); grd.addColorStop(0.145, `rgba(${col},0)`); g.fillStyle = grd; g.fillRect(-r, -r, r * 2, r * 2); }
  if (game) {
    const hdg = heading(a) * DEG, ch = Math.cos(hdg), sh = Math.sin(hdg), range = 30000, k = r * 0.96 / range;
    for (const o of game.aircraft) {
      if (o === a || !o.alive || o.parked) continue;
      const dx = o.fm.pos.x - a.fm.pos.x, dz = o.fm.pos.z - a.fm.pos.z;
      if (dx * dx + dz * dz > range * range) continue;
      const rx = dx * ch + dz * sh, rz = -dx * sh + dz * ch;
      const ang = Math.atan2(rz, rx);
      const age = ((sweep - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const al = Math.max(0.15, 1 - age / (Math.PI * 2));
      g.fillStyle = o.team === a.team ? `rgba(120,200,255,${al})` : `rgba(${col},${al})`;
      g.beginPath(); g.arc(rx * k, rz * k, 3.5, 0, 7); g.fill();
    }
  }
  g.fillStyle = `rgb(${col})`; g.beginPath(); g.moveTo(0, -6); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath(); g.fill();
  g.restore();
}
function lights(g, it, a, fm) {
  const rus = it.rus;
  const on = {
    GEAR: fm.gear > 0.99 ? '#3cff6a' : fm.gear > 0.01 ? '#ff3b2a' : null, HOOK: fm.gearCmd > 0.5 ? '#ffb43a' : null,
    STALL: fm.stall > 0.2 || fm.buffet > 0.6 ? '#ff3b2a' : null, ENG: a.engineFire ? '#ff3b2a' : fm.engine === 'running' ? null : '#ffb43a',
    FUEL: fm.fuel / a.def.fuel < 0.15 ? '#ffb43a' : null, AB: fm.ab > 0.05 ? '#ffb43a' : null, BRK: fm.input.brake > 0.5 ? '#ffb43a' : null,
    MSL: a.missileWarn ? '#ff3b2a' : null, OVHT: fm.rpm > 0.99 && fm.ab > 0.5 ? '#ffb43a' : null, HYD: a.hpFrac?.('tail') < 0.5 ? '#ffb43a' : null,
    GEN: a.hpFrac?.('engine') < 0.4 ? '#ffb43a' : null, OXY: null,
  };
  const names = rus ? CAUTIONS_RU : CAUTIONS;
  let i = 0;
  for (let j = 0; j < it.rows; j++) for (let c = 0; c < it.cols; c++, i++) {
    const key = CAUTIONS[i % CAUTIONS.length], col = on[key];
    const x = it.x + c * (it.w + 6), y = it.y + j * (it.h + 5);
    g.fillStyle = col || '#1a1a1a'; g.fillRect(x, y, it.w, it.h);
    if (col) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y, it.w, it.h * 0.35); }
    g.fillStyle = col ? '#000' : '#4a4a4a'; g.font = `bold ${rus ? 11 : 12}px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(names[i % names.length], x + it.w / 2, y + it.h / 2 + 1);
  }
  g.textBaseline = 'alphabetic';
}
// up-front control: scratchpad lines (left) next to the keypad (3D keys sit over the right side)
function ufc(g, it, ctx) {
  const { x, y, w, h } = it, a = ctx.a, fm = ctx.fm;
  g.fillStyle = '#020302'; g.fillRect(x + 44, y + 6, w - 150, h - 12);
  g.fillStyle = '#5dff9a'; g.font = `bold ${Math.min(18, Math.round(h * 0.2))}px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  const lines = [`COM1 ${(305 + (a.id?.length || 3) * 0.25).toFixed(2)}`, `TCN 74X  ${String(Math.round(heading(a))).padStart(3, '0')}°`, `ALT ${Math.round(fm.pos.y)}`, `${a.lockState === 2 ? 'LOCK' : 'A/A'} ${fm.throttle > 0.99 ? 'MAX' : 'MIL'}`];
  const n = Math.max(1, Math.min(lines.length, Math.floor((h - 12) / 22)));
  for (let i = 0; i < n; i++) g.fillText(lines[i], x + 52, y + 6 + (i + 0.5) * (h - 12) / n);
  // key legends under the 3D keys
  g.fillStyle = '#c8ccce'; g.font = `bold 10px ${MONO}`; g.textAlign = 'center';
  const kx = x + w - 96, ky = y + 8, kw = 88, kh = h - 16;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'ENT'];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) g.fillText(keys[j * 3 + i], kx + (i + 0.5) * kw / 3, ky + (j + 0.5) * kh / 4);
  g.textBaseline = 'alphabetic';
}
// F-16 data entry display
function ded(g, it, ctx) {
  const { x, y, w, h } = it, a = ctx.a, fm = ctx.fm;
  g.fillStyle = '#030402'; g.fillRect(x, y, w, h);
  g.fillStyle = '#d9ff4a'; g.font = `bold 15px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(`UHF 305.00  STPT  3`, x + 8, y + 14);
  g.fillText(`VHF  1  ${new Date().toTimeString().slice(0, 8)}`, x + 8, y + 33);
  g.fillText(`M ${fm.mach.toFixed(2)}  ${a.lockState === 2 ? 'LOCK' : 'SRCH'}  ${fm.fuel | 0}`, x + 8, y + 52);
  g.textBaseline = 'alphabetic';
}
