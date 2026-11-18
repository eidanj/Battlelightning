// Fighter pilot: sculpted flight suit with real cloth shading (fine twill weave + sheen, geometric wrinkles at the
// elbows and knees, baggy cuffs), survival vest with harness, G-suit chaps, Nomex gloves with leather palms and
// articulated fingers, flight boots, glossy helmet with tinted visor and an oxygen mask + hose.
// Arms and legs are posed every frame with two-bone IK so the hands really hold the stick and throttle.
// Also: the ejection seat and the parachute.
import * as THREE from 'three';
import { loft, lathe, tube, mesh, merge } from './geo.js';
import { TEX } from './textures.js';
import { clamp, lerp, DEG } from './util.js';

const V3 = THREE.Vector3;
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const weave = (scale) => { const t = TEX.fabricN.clone(); t.needsUpdate = true; t.repeat.set(1, 1); return t; };
  const cloth = (color, sheen, rough = 0.9) => new THREE.MeshPhysicalMaterial({
    color, map: TEX.fabric, normalMap: TEX.fabricN, normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: rough, metalness: 0, sheen: 0.45, sheenColor: new THREE.Color(sheen), sheenRoughness: 0.75, envMapIntensity: 0.35,
  });
  MATS = {
    suit: cloth(0x5c6046, 0x7f846a),            // sage-green CWU-27/P coverall
    vest: cloth(0x3c4032, 0x5d624e, 0.85),       // survival vest / harness webbing
    gsuit: cloth(0x4a4d36, 0x666a52, 0.9),      // G-suit bladders
    glove: cloth(0x847a5c, 0xa39a7c, 0.92),      // Nomex glove backs
    leather: new THREE.MeshStandardMaterial({ color: 0x5e4a36, roughness: 0.62, normalMap: TEX.leatherN, normalScale: new THREE.Vector2(0.5, 0.5) }),
    boot: new THREE.MeshStandardMaterial({ color: 0x171513, roughness: 0.5, normalMap: TEX.leatherN, normalScale: new THREE.Vector2(0.3, 0.3) }),
    helmet: new THREE.MeshPhysicalMaterial({ color: 0xc9ccc9, roughness: 0.38, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, roughness: 0.04, metalness: 0.85, envMapIntensity: 2.2, clearcoat: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x26282a, roughness: 0.62 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.3, metalness: 0.9 }),
    patch: new THREE.MeshStandardMaterial({ color: 0x1d4f9c, roughness: 0.8 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x2d3033, roughness: 0.7, metalness: 0.3 }),
    cushion: new THREE.MeshStandardMaterial({ color: 0x3a3d2c, roughness: 0.95, normalMap: TEX.fabricN }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5 }),
    black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
  };
  return MATS;
}
const WEAVE = 0.022; // one twill repeat = 2.2 cm of cloth

// tapered limb along -y with optional cloth folds (radius r(t), t=0..1 top->bottom)
function limb(len, radiusFn, folds = [], seg = 22, rings = 24) {
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    let r = radiusFn(t);
    for (const f of folds) { const d = (t - f.at) / f.w; if (Math.abs(d) < 1) r += f.amp * Math.cos(d * Math.PI * f.n) * (1 - d * d); }
    prof.push([r, -t * len]);
  }
  prof.reverse(); // lathe wants increasing y
  const circ = 2 * Math.PI * radiusFn(0.5);
  return lathe(prof, seg, { uvScale: [circ / WEAVE, len / WEAVE] });
}

// glove: palm + 4 fingers (3 phalanges) + thumb, all on hinge groups so they can curl
function buildHand(m, side = 1) {
  const hand = new THREE.Group();
  const palm = new THREE.Group(); hand.add(palm);
  const pg = loft([
    { z: 0.0, w: 0.032, h: 0.016, hb: 0.016, n: 2.4 }, { z: 0.03, w: 0.041, h: 0.017, hb: 0.016, n: 3 },
    { z: 0.07, w: 0.045, h: 0.015, hb: 0.014, n: 3.2 }, { z: 0.095, w: 0.044, h: 0.012, hb: 0.012, n: 3 },
  ], { seg: 18, uvScale: WEAVE, sub: 3 });
  // loft runs along +z; turn it so the palm extends along -y with the palm surface facing +z
  pg.rotateX(Math.PI / 2);
  palm.add(mesh(pg, m.glove));
  const pad = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.006), m.leather); pad.position.set(0, -0.055, 0.013); palm.add(pad);
  const cuff = mesh(limb(0.06, (t) => 0.039 + 0.006 * t, [], 18, 6), m.glove); cuff.position.y = 0.05; palm.add(cuff);
  const strap = mesh(new THREE.TorusGeometry(0.037, 0.005, 6, 18), m.leather); strap.rotation.x = Math.PI / 2; strap.position.y = 0.012; palm.add(strap);
  const fingers = [];
  const fx = [-0.03, -0.01, 0.01, 0.029], fl = [0.042, 0.047, 0.045, 0.036], fr = [0.0095, 0.0098, 0.0094, 0.0085];
  for (let i = 0; i < 4; i++) {
    const segs = []; let parent = palm;
    const base = new THREE.Group(); base.position.set(fx[i] * side, -0.095 + (i === 0 || i === 3 ? 0.006 : 0), 0); parent.add(base);
    let p = base;
    for (let k = 0; k < 3; k++) {
      const L = fl[i] * [0.46, 0.3, 0.24][k], R = fr[i] * [1, 0.9, 0.82][k];
      const j = new THREE.Group(); if (k > 0) j.position.y = -fl[i] * [0.46, 0.3, 0.24][k - 1]; p.add(j);
      const s = mesh(new THREE.CapsuleGeometry(R, Math.max(0.001, L - R), 4, 10), m.glove); s.position.y = -L / 2; j.add(s);
      if (k === 2) { const tip = mesh(new THREE.SphereGeometry(R * 0.95, 8, 6), m.leather); tip.position.set(0, -L + R * 0.2, R * 0.3); j.add(tip); }
      segs.push(j); p = j;
    }
    fingers.push(segs);
  }
  // thumb from the palm's thumb side (-x for a right hand)
  const tb = new THREE.Group(); tb.position.set(-0.037 * side, -0.03, 0.012); palm.add(tb);
  const thumb = []; let tp = tb;
  for (let k = 0; k < 3; k++) {
    const L = [0.035, 0.03, 0.026][k], R = [0.0125, 0.011, 0.01][k];
    const j = new THREE.Group(); if (k > 0) j.position.y = -[0.035, 0.03][k - 1]; tp.add(j);
    const s = mesh(new THREE.CapsuleGeometry(R, L - R, 4, 10), k === 2 ? m.leather : m.glove); s.position.y = -L / 2; j.add(s);
    thumb.push(j); tp = j;
  }
  hand.userData = { fingers, thumb, side };
  return hand;
}
function poseHand(hand, curl, thumbCurl = curl, spread = 0) {
  const { fingers, thumb, side } = hand.userData;
  fingers.forEach((segs, i) => { const c = curl * (1 + (i - 1.5) * 0.06); segs[0].rotation.set(-c * 1.15, 0, (i - 1.5) * spread * side); segs[1].rotation.x = -c * 1.45; segs[2].rotation.x = -c * 1.0; });
  thumb[0].rotation.set(-0.35 - thumbCurl * 0.3, 0, side * (0.7 + thumbCurl * 0.25)); thumb[1].rotation.x = -thumbCurl * 0.7; thumb[2].rotation.x = -thumbCurl * 0.75;
}

function buildHelmet(m) {
  const h = new THREE.Group();
  const shell = mesh(new THREE.SphereGeometry(0.135, 32, 24), m.helmet); shell.scale.set(0.98, 1.06, 1.14); shell.position.set(0, 0.03, 0.01); h.add(shell);
  const rim = mesh(new THREE.TorusGeometry(0.128, 0.012, 8, 32, Math.PI * 1.2), m.rubber); rim.rotation.set(Math.PI / 2, 0, -Math.PI * 0.1); rim.position.set(0, -0.045, 0.02); rim.scale.set(1, 1.1, 1); h.add(rim);
  // visor housing ridge and dark visor (lowered)
  const housing = mesh(new THREE.SphereGeometry(0.142, 28, 10, -Math.PI * 0.45, Math.PI * 0.9, Math.PI * 0.22, Math.PI * 0.14), m.helmet); housing.rotation.y = Math.PI; housing.scale.set(1, 1.06, 1.13); housing.position.set(0, 0.035, 0.0); h.add(housing);
  const visor = mesh(new THREE.SphereGeometry(0.141, 28, 16, -Math.PI * 0.36, Math.PI * 0.72, Math.PI * 0.34, Math.PI * 0.26), m.visor); visor.rotation.y = Math.PI; visor.scale.set(1, 1.06, 1.13); visor.position.set(0, 0.03, 0.0); h.add(visor);
  // oxygen mask + bayonet straps + hose
  const mask = mesh(loft([{ z: 0, w: 0.05, h: 0.055, hb: 0.045 }, { z: 0.04, w: 0.04, h: 0.044, hb: 0.036 }, { z: 0.07, w: 0.022, h: 0.026, hb: 0.022 }, { z: 0.08, w: 0.012, h: 0.012 }], { seg: 18 }), m.rubber);
  mask.rotation.y = Math.PI; mask.position.set(0, -0.07, -0.1); mask.rotation.x = 0.35; h.add(mask);
  for (const s of [-1, 1]) { const st = mesh(new THREE.BoxGeometry(0.012, 0.008, 0.11), m.rubber); st.position.set(s * 0.062, -0.055, -0.065); st.rotation.y = s * 0.55; h.add(st); const b = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), m.metal); b.rotation.z = Math.PI / 2; b.position.set(s * 0.115, -0.05, -0.03); h.add(b); }
  const hose = mesh(tube([[0, -0.12, -0.17], [0.01, -0.2, -0.16], [0.04, -0.28, -0.1], [0.07, -0.36, -0.07]], 0.013, 8, 20), m.rubber); h.add(hose);
  const patch = mesh(new THREE.BoxGeometry(0.03, 0.02, 0.002), m.patch); patch.position.set(0.08, 0.06, -0.1); patch.rotation.y = -0.6; h.add(patch);
  return h;
}

export function buildSeat(scale = 1) {
  const m = mats(), g = new THREE.Group();
  const bucket = mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), m.seat); bucket.position.set(0, -0.04, -0.2); g.add(bucket);
  for (const s of [-1, 1]) { const side = mesh(new THREE.BoxGeometry(0.04, 0.32, 0.5), m.seat); side.position.set(s * 0.25, 0.08, -0.2); g.add(side); const rail = mesh(new THREE.BoxGeometry(0.05, 1.1, 0.06), m.seat); rail.position.set(s * 0.22, 0.5, 0.11); g.add(rail); }
  const back = mesh(new THREE.BoxGeometry(0.46, 0.8, 0.08), m.seat); back.position.set(0, 0.42, 0.08); g.add(back);
  const cush = mesh(new THREE.BoxGeometry(0.4, 0.06, 0.42), m.cushion); cush.position.set(0, 0.03, -0.2); g.add(cush);
  const bcush = mesh(new THREE.BoxGeometry(0.38, 0.62, 0.05), m.cushion); bcush.position.set(0, 0.38, 0.03); g.add(bcush);
  const head = mesh(new THREE.BoxGeometry(0.34, 0.3, 0.2), m.seat); head.position.set(0, 0.98, 0.1); g.add(head);
  const hc = mesh(new THREE.BoxGeometry(0.26, 0.22, 0.04), m.cushion); hc.position.set(0, 0.96, -0.01); g.add(hc);
  for (const s of [-1, 1]) { const horn = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.18, 8), m.seat); horn.position.set(s * 0.15, 1.18, 0.1); g.add(horn); }
  const handle = mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16, Math.PI), m.yellow); handle.position.set(0, 0.02, -0.44); handle.rotation.x = -Math.PI / 2; g.add(handle);
  const stripe = mesh(new THREE.TorusGeometry(0.06, 0.0125, 6, 16, Math.PI * 0.3), m.black); stripe.position.copy(handle.position); stripe.rotation.copy(handle.rotation); g.add(stripe);
  const rocket = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), m.metal); rocket.position.set(0, -0.12, 0.08); g.add(rocket);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.scale.setScalar(scale);
  return g;
}

export class Pilot {
  constructor(opts = {}) {
    const m = mats();
    this.lod = opts.lod ?? 0;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    // ---- torso (stations along +y; front = -z) ----
    const torsoSt = [
      { z: 0.0, w: 0.165, h: 0.11, hb: 0.12, n: 2.3 }, { z: 0.1, w: 0.162, h: 0.105, hb: 0.112, n: 2.4 }, { z: 0.22, w: 0.15, h: 0.1, hb: 0.1, n: 2.3 },
      { z: 0.34, w: 0.163, h: 0.11, hb: 0.1, n: 2.3 }, { z: 0.46, w: 0.182, h: 0.122, hb: 0.108, n: 2.4 }, { z: 0.54, w: 0.195, h: 0.112, hb: 0.104, n: 2.6 },
      { z: 0.6, w: 0.185, h: 0.085, hb: 0.088, n: 2.4 }, { z: 0.645, w: 0.11, h: 0.06, hb: 0.062 }, { z: 0.68, w: 0.062, h: 0.052, hb: 0.052 }, { z: 0.72, w: 0.058, h: 0.05, hb: 0.05 },
    ];
    this.torso = mesh(loft(torsoSt, { seg: 32, axis: 'y', uvScale: WEAVE, sub: 4 }), m.suit); this.body.add(this.torso);
    // collar
    const collar = mesh(new THREE.TorusGeometry(0.064, 0.012, 8, 20), m.suit); collar.rotation.x = Math.PI / 2; collar.position.y = 0.665; this.body.add(collar);
    // survival vest over the chest
    const vestSt = torsoSt.slice(2, 7).map((s) => ({ ...s, w: s.w + 0.016, h: s.h + 0.02, hb: s.hb + 0.014 }));
    this.body.add(mesh(loft(vestSt, { seg: 30, axis: 'y', uvScale: WEAVE * 2, sub: 3 }), m.vest));
    // vest pockets, harness straps, buckles
    for (const [x, y, w, h] of [[-0.09, 0.4, 0.07, 0.09], [0.09, 0.4, 0.07, 0.09], [-0.1, 0.27, 0.08, 0.06], [0.1, 0.27, 0.08, 0.06]]) { const p = mesh(new THREE.BoxGeometry(w, h, 0.03), m.vest); p.position.set(x, y, -0.13); p.rotation.y = x > 0 ? -0.18 : 0.18; this.body.add(p); }
    for (const s of [-1, 1]) {
      this.body.add(mesh(tube([[s * 0.1, 0.12, -0.12], [s * 0.11, 0.35, -0.135], [s * 0.115, 0.55, -0.12], [s * 0.11, 0.62, -0.02], [s * 0.1, 0.58, 0.1], [s * 0.09, 0.3, 0.12]], 0.012, 6, 30), m.vest));
      const kb = mesh(new THREE.BoxGeometry(0.045, 0.035, 0.02), m.metal); kb.position.set(s * 0.11, 0.46, -0.145); this.body.add(kb);
      this.body.add(mesh(tube([[s * 0.1, 0.12, -0.12], [s * 0.15, 0.02, -0.1], [s * 0.13, -0.04, -0.02], [s * 0.08, -0.03, 0.06]], 0.011, 6, 20), m.vest));
    }
    const chest = mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), m.metal); chest.position.set(0, 0.36, -0.15); this.body.add(chest);
    const nameTag = mesh(new THREE.BoxGeometry(0.09, 0.03, 0.004), m.leather); nameTag.position.set(-0.09, 0.48, -0.145); nameTag.rotation.y = 0.2; this.body.add(nameTag);
    // G-suit around the belly
    this.body.add(mesh(loft([{ z: -0.02, w: 0.172, h: 0.118, hb: 0.125 }, { z: 0.1, w: 0.17, h: 0.116, hb: 0.12 }, { z: 0.2, w: 0.158, h: 0.108, hb: 0.108 }], { seg: 28, axis: 'y', uvScale: WEAVE * 1.6 }), m.gsuit));
    // shoulders (deltoids)
    for (const s of [-1, 1]) { const d = mesh(new THREE.SphereGeometry(0.062, 18, 14), m.suit); d.scale.set(1, 0.9, 1.05); d.position.set(s * 0.175, 0.585, 0); this.body.add(d); }
    // neck + helmet
    this.head = new THREE.Group(); this.head.position.set(0, 0.8, -0.01); this.body.add(this.head);
    this.helmet = buildHelmet(m); this.head.add(this.helmet);
    // arms (positioned by IK in pilot space)
    this.arms = [-1, 1].map((s) => {
      const upper = new THREE.Group(), fore = new THREE.Group();
      upper.add(mesh(limb(0.3, (t) => 0.056 - 0.012 * t + 0.006 * Math.sin(t * Math.PI), [{ at: 0.92, w: 0.12, amp: 0.004, n: 3 }], 22, 28), m.suit));
      fore.add(mesh(limb(0.255, (t) => 0.048 - 0.012 * t + 0.004 * Math.sin(t * Math.PI * 0.8), [{ at: 0.08, w: 0.12, amp: 0.0045, n: 3 }, { at: 0.86, w: 0.08, amp: 0.004, n: 2 }], 22, 30), m.suit));
      const cuffZip = mesh(new THREE.BoxGeometry(0.008, 0.06, 0.004), m.metal); cuffZip.position.set(0, -0.22, -0.04); fore.add(cuffZip);
      const pocket = mesh(new THREE.BoxGeometry(0.05, 0.08, 0.012), m.suit); pocket.position.set(s * 0.04, -0.12, -0.03); pocket.rotation.y = s * 0.7; upper.add(pocket);
      const hand = buildHand(m, 1);
      if (s < 0) hand.scale.x = -1;
      this.body.add(upper, fore, hand);
      return { s, upper, fore, hand, shoulder: new V3(s * 0.18, 0.585, 0) };
    });
    // legs
    this.legs = [-1, 1].map((s) => {
      const thigh = new THREE.Group(), shin = new THREE.Group(), foot = new THREE.Group();
      thigh.add(mesh(limb(0.44, (t) => 0.088 - 0.03 * t, [{ at: 0.94, w: 0.08, amp: 0.004, n: 2 }], 22, 24), m.suit));
      thigh.add(mesh(limb(0.36, (t) => 0.094 - 0.03 * t, [], 22, 8), m.gsuit)).position.y = -0.03;
      const pk = mesh(new THREE.BoxGeometry(0.11, 0.14, 0.03), m.suit); pk.position.set(s * 0.07, -0.2, -0.02); pk.rotation.y = s * 1.2; thigh.add(pk);
      shin.add(mesh(limb(0.43, (t) => 0.058 - 0.018 * t + 0.008 * Math.sin(t * Math.PI * 0.7), [{ at: 0.05, w: 0.08, amp: 0.004, n: 2 }], 20, 22), m.suit));
      shin.add(mesh(limb(0.3, (t) => 0.064 - 0.016 * t, [], 20, 6), m.gsuit)).position.y = -0.02;
      const boot = mesh(loft([{ z: -0.04, w: 0.045, h: 0.06, hb: 0.03 }, { z: 0.02, w: 0.05, h: 0.075, hb: 0.04 }, { z: 0.12, w: 0.046, h: 0.05, hb: 0.04 }, { z: 0.2, w: 0.04, h: 0.035, hb: 0.035 }, { z: 0.24, w: 0.02, h: 0.02 }], { seg: 16, uvScale: 0.05 }), m.boot);
      boot.rotation.y = Math.PI; boot.position.set(0, -0.04, 0); foot.add(boot);
      const ankle = mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.12, 14), m.boot); ankle.position.y = 0.02; foot.add(ankle);
      this.body.add(thigh, shin, foot);
      return { s, thigh, shin, foot, hip: new V3(s * 0.095, 0.0, -0.02) };
    });
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // pose targets in pilot space (set by setPose / cockpit)
    this.handT = [new V3(-0.26, 0.15, -0.36), new V3(0.03, 0.12, -0.46)];
    this.handN = [new V3(0.25, -1, 0.05), new V3(-1, 0.05, 0)];
    this.footT = [new V3(-0.12, -0.36, -0.9), new V3(0.12, -0.36, -0.9)];
    this.recline = 0;
    this.grip = [0.85, 1.05];
    this.headYaw = 0; this.headPitch = 0;
    this.showHead = true;
  }
  setHeadVisible(v) { this.showHead = v; this.head.visible = v; this.torso.visible = true; }

  // place a limb segment from a to b (segment geometry points along -y)
  static seg(obj, a, b) {
    obj.position.copy(a);
    _d.copy(b).sub(a).normalize();
    obj.quaternion.setFromUnitVectors(_down, _d);
  }
  // two-bone IK: root, target, lengths, pole -> joint position
  static ik(root, target, a, b, pole, out) {
    _t.copy(target).sub(root);
    let d = _t.length();
    d = clamp(d, Math.abs(a - b) + 0.001, a + b - 0.002);
    _t.normalize();
    const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
    _p.copy(pole).addScaledVector(_t, -pole.dot(_t)).normalize();
    out.copy(root).addScaledVector(_t, x).addScaledVector(_p, h);
    return out;
  }
  update() {
    const rc = this.recline;
    this.body.rotation.x = rc;
    this.body.updateMatrix();
    this.head.rotation.set(this.headPitch, this.headYaw, 0, 'YXZ');
    // arms
    _inv.copy(this.body.matrix).invert();
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i];
      const T = _a.copy(this.handT[i]).applyMatrix4(_inv); // targets are in pilot space; limbs live in body space
      const S = A.shoulder;
      const pole = _b.set(A.s * 0.9, -0.6, 0.35);
      const E = Pilot.ik(S, T, 0.3, 0.255 + 0.03, pole, _c);
      Pilot.seg(A.upper, S, E);
      Pilot.seg(A.fore, E, T);
      // hand basis: fingers continue the forearm, palm faces the control
      const f = _d2.copy(T).sub(E).normalize();
      const n = _n.copy(this.handN[i]).transformDirection(_inv);
      n.addScaledVector(f, -n.dot(f)).normalize();
      const th = _th.crossVectors(f, n);
      if (A.s < 0) th.negate(); // left hand is mirrored
      _m.makeBasis(A.s > 0 ? th.clone().negate() : th, f.clone().negate(), n);
      A.hand.quaternion.setFromRotationMatrix(_m);
      A.hand.position.copy(T).addScaledVector(f, -0.01);
      poseHand(A.hand, this.grip[i], this.grip[i] * 0.9, 0.05);
    }
    // legs
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      const T = _a.copy(this.footT[i]).applyMatrix4(_inv);
      const K = Pilot.ik(L.hip, T, 0.44, 0.43, _b.set(L.s * 0.15, 0.4, -1), _c);
      Pilot.seg(L.thigh, L.hip, K);
      Pilot.seg(L.shin, K, T);
      L.foot.position.copy(T); L.foot.quaternion.identity();
    }
  }
}
const _down = new V3(0, -1, 0), _d = new V3(), _t = new V3(), _p = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _d2 = new V3(), _n = new V3(), _th = new V3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();

// ---------------- parachute ----------------
export function buildParachute() {
  const g = new THREE.Group();
  const gores = 24, R = 3.8, H = 2.6;
  const geo = new THREE.SphereGeometry(R, gores, 10, 0, Math.PI * 2, 0, Math.PI * 0.42);
  geo.scale(1, H / R, 1);
  const cols = new Float32Array(geo.attributes.position.count * 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * gores) % 2;
    const c = k ? [0.95, 0.42, 0.08] : [0.94, 0.93, 0.9];
    cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const canopy = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, map: TEX.fabric }));
  canopy.position.y = 6.2; canopy.castShadow = true; g.add(canopy);
  const lp = [];
  const skirtY = 6.2 + H * Math.cos(Math.PI * 0.42), skirtR = R * Math.sin(Math.PI * 0.42);
  for (let i = 0; i < gores; i++) { const a = (i / gores) * Math.PI * 2; lp.push(Math.cos(a) * skirtR, skirtY, Math.sin(a) * skirtR, (i % 2 ? 0.12 : -0.12), 0.75, 0.02); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7 })));
  g.userData.canopy = canopy;
  return g;
}
