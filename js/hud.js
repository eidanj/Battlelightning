// HUD: collimated cockpit symbology projected through the camera (clipped to the combiner glass), chase-view
// gunsight, aircraft markers, lead pipper, seeker circle, telemetry, weapons, damage diagram, radar minimap,
// team counter, kill feed, tactical map + scoreboard, G-LOC vignette and cloud white-out.
import * as THREE from 'three';
import { WORLD, TEAMS } from './config.js';
import { clamp, DEG, RAD, fmtTime, lerp } from './util.js';

const $ = (s) => document.querySelector(s);
const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();
const GREEN = '#57ff9e';

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('#hud');
    this.cv = $('#hudCanvas'); this.g = this.cv.getContext('2d');
    this.mm = $('#minimap'); this.mg = this.mm.getContext('2d');
    this.tac = $('#tacCanvas'); this.tg = this.tac.getContext('2d');
    this.el = {
      spd: $('#tSpd'), alt: $('#tAlt'), thr: $('#tThr'), gear: $('#tGear'), gl: $('#tG'), aoa: $('#tAoa'), thrBar: $('#tThrBar i'), fuel: $('#tFuel'),
      gun: $('#wGun'), gunBar: $('#wGunBar i'), msl: $('#wMsl'), mslN: $('#wMslN'), flr: $('#wFlr'), lock: $('#wLock'),
      cntL: $('#cntL'), cntR: $('#cntR'), pipsL: $('#pipsL'), pipsR: $('#pipsR'), nameL: $('#nameL'), nameR: $('#nameR'), timer: $('#mTimer'), info: $('#mInfo'),
      feed: $('#killfeed'), msgs: $('#msgs'), prompt: $('#prompt'), warn: $('#warn'), hit: $('#hitmark'), flash: $('#dmgFlash'), gloc: $('#gloc'), fog: $('#cloudFog'), fps: $('#fps'), boundary: $('#boundary'),
      dmg: { fuselage: $('#dFus'), wingL: $('#dWingL'), wingR: $('#dWingR'), engine: $('#dEng'), tail: $('#dTail') }, dmgPct: $('#dmgPct'),
      score: $('#scoreboard'), tacWrap: $('#tacmap'), view: $('#viewMode'),
    };
    this.feedItems = []; this.msgItems = [];
    this.blackout = 0; this.redout = 0; this.hitT = 0; this.flashT = 0;
    this.textT = 0; this.units = 'kmh';
    this.mapImg = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = innerWidth * dpr; this.cv.height = innerHeight * dpr;
    this.cv.style.width = innerWidth + 'px'; this.cv.style.height = innerHeight + 'px';
    this.dpr = dpr;
  }
  show(v) { this.root.classList.toggle('hidden', !v); }

  // ---- pre-rendered terrain map for the radar and the tactical map ----
  buildMap(world) {
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), H = WORLD.half;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -H + (i + 0.5) / S * 2 * H, z = -H + (j + 0.5) / S * 2 * H;
      const h = world.terrain.height(x, z);
      const o = (j * S + i) * 4;
      let r, gg, b;
      if (h < 0.4) { const d = Math.min(1, -h / 50); r = 18 - d * 8; gg = 46 - d * 16; b = 70 - d * 20; }
      else { const k = Math.min(1, h / 1600); r = 52 + k * 70; gg = 74 + k * 40; b = 44 + k * 50; if (h > 1500) { r = gg = b = 190; } }
      const C = WORLD.city;
      if (h > 3 && x > C.x0 && x < C.x1 && z > C.z0 && z < C.z1) { r = 92; gg = 94; b = 98; }
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // coastline
    g.strokeStyle = 'rgba(200,230,255,0.35)'; g.lineWidth = 1;
    const A = world.airbase.runway;
    const tm = (x) => (x + H) / (2 * H) * S;
    g.strokeStyle = '#e8e8e8'; g.lineWidth = 3; g.beginPath(); g.moveTo(tm(A.x0), tm(A.z)); g.lineTo(tm(A.x1), tm(A.z)); g.stroke();
    this.mapImg = c;
  }

  message(text, kind = 'info', t = 3) {
    if (this.msgItems.length && this.msgItems[this.msgItems.length - 1].text === text) { this.msgItems[this.msgItems.length - 1].t = t; return; }
    const el = document.createElement('div'); el.className = 'msg ' + kind; el.textContent = text;
    this.el.msgs.appendChild(el);
    this.msgItems.push({ el, t, text });
    while (this.msgItems.length > 4) { const m = this.msgItems.shift(); m.el.remove(); }
  }
  feed(html, cls = '') {
    const el = document.createElement('div'); el.className = 'kf ' + cls; el.innerHTML = html;
    this.el.feed.prepend(el); this.feedItems.push({ el, t: 7 });
    while (this.feedItems.length > 6) { const m = this.feedItems.shift(); m.el.remove(); }
  }
  hitMarker(kill = false) { this.hitT = kill ? 0.5 : 0.18; this.el.hit.classList.toggle('kill', kill); }
  damageFlash(k = 1) { this.flashT = Math.min(1, this.flashT + 0.35 * k); }
  setPrompt(html) { if (this._prompt !== html) { this._prompt = html; this.el.prompt.innerHTML = html || ''; this.el.prompt.style.opacity = html ? 1 : 0; } }

  update(dt, ctx) {
    const { plane, camera, ckCamera, mode, game } = ctx;
    const g = this.g, W = this.cv.width, H = this.cv.height, dpr = this.dpr;
    g.clearRect(0, 0, W, H);
    for (let i = this.msgItems.length - 1; i >= 0; i--) { const m = this.msgItems[i]; m.t -= dt; m.el.style.opacity = clamp(m.t * 2, 0, 1); if (m.t <= 0) { m.el.remove(); this.msgItems.splice(i, 1); } }
    for (let i = this.feedItems.length - 1; i >= 0; i--) { const m = this.feedItems[i]; m.t -= dt; m.el.style.opacity = clamp(m.t, 0, 1); if (m.t <= 0) { m.el.remove(); this.feedItems.splice(i, 1); } }
    this.hitT -= dt; this.el.hit.style.opacity = this.hitT > 0 ? 1 : 0;
    this.flashT = Math.max(0, this.flashT - dt * 1.5); this.el.flash.style.opacity = this.flashT;
    this._teamBar(game);
    if (!plane) { this.el.gloc.style.opacity = 0; return; }
    const fm = plane.fm;
    const alive = plane.alive && !plane.ejected;
    this.root.classList.toggle('down', !alive); // hide the flight instruments once out of the aircraft
    // G-LOC: grey-out / tunnel vision under sustained high G, red-out under negative G
    const gl = alive ? fm.gLoad : 1;
    const tol = 6.6;
    this.blackout = clamp(this.blackout + (gl > tol ? (gl - tol) * 0.22 : -0.45) * dt, 0, 1);
    this.redout = clamp(this.redout + (gl < -2.2 ? (-2.2 - gl) * 0.4 : -0.6) * dt, 0, 1);
    this.el.gloc.style.opacity = Math.max(this.blackout, this.redout);
    this.el.gloc.style.background = this.redout > this.blackout ? `radial-gradient(ellipse at center, rgba(120,0,0,${0.2 + this.redout * 0.5}) 0%, rgba(90,0,0,${0.6 + this.redout * 0.4}) 70%)` : `radial-gradient(ellipse at center, rgba(0,0,0,0) ${Math.round(60 - this.blackout * 55)}%, rgba(0,0,0,${0.7 + this.blackout * 0.3}) ${Math.round(100 - this.blackout * 40)}%)`;
    // cloud white-out
    const fog = game.world.clouds.inside(camera.position);
    this.el.fog.style.opacity = fog * 0.85;
    if (alive) {
      if (mode === 'cockpit') this._cockpitHud(plane, camera, game);
      else this._chaseHud(plane, camera, game);
    }
    this._markers(plane, camera, game);
    this.textT -= dt;
    if (this.textT <= 0) { this.textT = 0.066; this._text(plane, game); }
    this._minimap(plane, game);
    if (this.el.tacWrap && !this.el.tacWrap.classList.contains('hidden')) this.drawTactical(game);
    // big warnings
    let warn = '';
    if (alive) {
      const agl = fm.pos.y - game.world.groundHeight(fm.pos.x, fm.pos.z);
      const sinkT = fm.vel.y < -5 ? agl / -fm.vel.y : 99;
      if (plane.missileWarn) warn = '<span class="w red">MISSILE</span>';
      else if (sinkT < 4.5 && agl < 1200 && !fm.onGround && fm.gear < 0.5) warn = '<span class="w red">PULL UP</span>';
      else if (fm.stall > 0.15 && !fm.onGround) warn = '<span class="w amber">STALL</span>';
      else if (fm.gear > 0.5 && fm.V > 170 && !fm.onGround) warn = '<span class="w amber">GEAR OVERSPEED</span>';
      else if (this.blackout > 0.5) warn = '<span class="w amber">G-LOC</span>';
      if (warn && warn.includes('PULL UP') || warn.includes('MISSILE')) game.audio?.warn();
      const out = Math.max(Math.abs(fm.pos.x), Math.abs(fm.pos.z)) > WORLD.boundaryWarn;
      this.el.boundary.style.opacity = out ? 1 : 0;
    } else this.el.boundary.style.opacity = 0;
    if (warn !== this._warn) { this._warn = warn; this.el.warn.innerHTML = warn; }
  }

  // project a world point to canvas pixels (null if behind)
  proj(p, cam, out) {
    _d.copy(p).project(cam);
    if (_d.z > 1 || _d.z < -1) return null;
    out.x = (_d.x * 0.5 + 0.5) * this.cv.width; out.y = (-_d.y * 0.5 + 0.5) * this.cv.height;
    return out;
  }
  projDir(dir, cam, out) { return this.proj(_c.copy(cam.position).addScaledVector(dir, 2000), cam, out); }

  _cockpitHud(p, cam, game) {
    const g = this.g, fm = p.fm, dpr = this.dpr;
    const ck = p.cockpit;
    if (!ck.combiner) return;
    // combiner glass outline (clip region)
    const comb = ck.combiner;
    comb.updateWorldMatrix(true, false);
    const corners = [[-0.12, -0.11], [0.12, -0.11], [0.12, 0.13], [-0.12, 0.13]].map(([x, y]) => this.proj(_a.set(x, y, 0).applyMatrix4(comb.matrixWorld), cam, { x: 0, y: 0 }));
    if (corners.some((c) => !c)) return;
    g.save();
    g.beginPath(); corners.forEach((c, i) => (i ? g.lineTo(c.x, c.y) : g.moveTo(c.x, c.y))); g.closePath(); g.clip();
    const scale = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) / 300;
    this._symbology(p, cam, game, scale, GREEN);
    g.restore();
  }
  _chaseHud(p, cam, game) { this._symbology(p, cam, game, Math.min(this.cv.width, this.cv.height) / 900, 'rgba(120,255,170,0.95)', true); }

  _symbology(p, cam, game, s, col, chase = false) {
    const g = this.g, fm = p.fm;
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = Math.max(1.5, 2 * s); g.font = `bold ${Math.round(15 * s)}px "Share Tech Mono", monospace`;
    g.shadowColor = 'rgba(80,255,160,0.6)'; g.shadowBlur = 4 * s;
    const fwd = p.fwd;
    const bore = this.projDir(fwd, cam, { x: 0, y: 0 });
    if (!bore) return;
    // gun cross / boresight
    const r = 9 * s;
    g.beginPath(); g.moveTo(bore.x - r * 2, bore.y); g.lineTo(bore.x - r * 0.6, bore.y); g.moveTo(bore.x + r * 0.6, bore.y); g.lineTo(bore.x + r * 2, bore.y); g.moveTo(bore.x, bore.y - r * 2); g.lineTo(bore.x, bore.y - r * 0.6); g.moveTo(bore.x, bore.y + r * 0.6); g.lineTo(bore.x, bore.y + r * 1.3); g.stroke();
    // flight path marker
    if (fm.V > 20) {
      const fpm = this.projDir(_a.copy(fm.vel).normalize(), cam, { x: 0, y: 0 });
      if (fpm) { g.beginPath(); g.arc(fpm.x, fpm.y, 7 * s, 0, 7); g.moveTo(fpm.x - 17 * s, fpm.y); g.lineTo(fpm.x - 7 * s, fpm.y); g.moveTo(fpm.x + 7 * s, fpm.y); g.lineTo(fpm.x + 17 * s, fpm.y); g.moveTo(fpm.x, fpm.y - 7 * s); g.lineTo(fpm.x, fpm.y - 13 * s); g.stroke(); }
    }
    // pitch ladder (horizon-referenced, centred on the heading)
    if (!chase) {
      const hd = _b.set(fwd.x, 0, fwd.z); if (hd.lengthSq() < 1e-4) hd.set(0, 0, -1); hd.normalize();
      const side = _c.set(-hd.z, 0, hd.x);
      const pitchDeg = Math.asin(clamp(fwd.y, -1, 1)) * RAD;
      for (let a = Math.round(pitchDeg / 5) * 5 - 25; a <= pitchDeg + 25; a += 5) {
        if (a < -85 || a > 85) continue;
        const ar = a * DEG;
        const dir = new V3().copy(hd).multiplyScalar(Math.cos(ar)).setY(Math.sin(ar));
        const w = a === 0 ? 0.16 : 0.07, gap = 0.025;
        const p1 = this.projDir(_a.copy(dir).addScaledVector(side, -w).normalize(), cam, { x: 0, y: 0 });
        const p2 = this.projDir(_a.copy(dir).addScaledVector(side, -gap).normalize(), cam, { x: 0, y: 0 });
        const p3 = this.projDir(_a.copy(dir).addScaledVector(side, gap).normalize(), cam, { x: 0, y: 0 });
        const p4 = this.projDir(_a.copy(dir).addScaledVector(side, w).normalize(), cam, { x: 0, y: 0 });
        if (!p1 || !p4) continue;
        g.setLineDash(a < 0 ? [6 * s, 4 * s] : []);
        g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.moveTo(p3.x, p3.y); g.lineTo(p4.x, p4.y); g.stroke();
        if (a !== 0) { g.setLineDash([]); g.fillText(String(Math.abs(a)), p4.x + 4 * s, p4.y + 5 * s); }
      }
      g.setLineDash([]);
      // speed / altitude boxes and heading tape relative to the boresight
      const kts = this.units === 'kts';
      const spd = Math.round(fm.V * (kts ? 1.944 : 3.6));
      const bx = bore.x, by = bore.y;
      g.textAlign = 'right'; g.strokeRect(bx - 150 * s, by - 12 * s, 60 * s, 22 * s); g.fillText(String(spd), bx - 94 * s, by + 5 * s);
      g.textAlign = 'left'; g.strokeRect(bx + 90 * s, by - 12 * s, 66 * s, 22 * s); g.fillText(String(Math.round(fm.pos.y)), bx + 95 * s, by + 5 * s);
      g.font = `bold ${Math.round(12 * s)}px "Share Tech Mono", monospace`;
      g.textAlign = 'right'; g.fillText(`M ${fm.mach.toFixed(2)}`, bx - 94 * s, by + 30 * s); g.fillText(`G ${fm.gLoad.toFixed(1)}`, bx - 94 * s, by + 46 * s); g.fillText(`α ${(fm.alpha * RAD).toFixed(0)}`, bx - 94 * s, by + 62 * s);
      g.textAlign = 'left'; g.fillText(`${fm.vel.y >= 0 ? '+' : ''}${Math.round(fm.vel.y)} m/s`, bx + 92 * s, by + 30 * s);
      g.fillText(p.lockState === 2 ? 'MSL LOCK' : p.missiles > 0 ? `MSL ${p.missiles}` : 'MSL --', bx + 92 * s, by + 46 * s);
      g.fillText(p.reloading > 0 ? 'GUN RLD' : `GUN ${p.gunAmmo}`, bx + 92 * s, by + 62 * s);
      // heading tape
      const hdg = ((Math.atan2(fwd.x, -fwd.z) * RAD) + 360) % 360;
      g.textAlign = 'center';
      for (let d = -30; d <= 30; d += 5) {
        const h = Math.round(hdg / 5) * 5 + d, x = bx + (h - hdg) * 3.2 * s, y = by - 120 * s;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + (h % 10 === 0 ? 8 : 4) * s); g.stroke();
        if (h % 10 === 0) g.fillText(String(((h % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, y - 4 * s);
      }
      g.beginPath(); g.moveTo(bx, by - 108 * s); g.lineTo(bx - 5 * s, by - 100 * s); g.lineTo(bx + 5 * s, by - 100 * s); g.closePath(); g.stroke();
      // landing aid: localizer / glideslope to the friendly runway or deck when the gear is down
      if (fm.gearCmd > 0.5 && !fm.onGround) this._ils(p, game, bx, by, s);
    }
    // missile seeker circle and lock
    if (p.missiles > 0) {
      const ang = p.def.missile.cone * DEG;
      const edge = this.projDir(_a.copy(fwd).applyAxisAngle(_b.set(1, 0, 0).applyQuaternion(fm.quat), ang), cam, { x: 0, y: 0 });
      if (edge) { const rr = Math.hypot(edge.x - bore.x, edge.y - bore.y); g.globalAlpha = p.lockState ? 1 : 0.45; g.setLineDash(p.lockState === 2 ? [] : [5 * s, 5 * s]); g.beginPath(); g.arc(bore.x, bore.y, rr, 0, 7); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
    }
    // gun lead pipper on the nearest enemy in front
    const t = this._gunTarget(p, game);
    if (t) {
      const dist = t.fm.pos.distanceTo(fm.pos), bv = p.def.gun.vel;
      const tof = dist / (bv + Math.max(0, fm.vel.dot(_a.copy(t.fm.pos).sub(fm.pos).normalize())));
      const lead = _b.copy(t.fm.pos).addScaledVector(t.fm.vel, tof).addScaledVector(fm.vel, -tof).add(_c.set(0, 0.5 * 9.81 * tof * tof, 0));
      const lp = this.proj(lead, cam, { x: 0, y: 0 });
      if (lp) {
        const inRange = dist < 1100;
        g.globalAlpha = inRange ? 1 : 0.5;
        g.beginPath(); g.arc(lp.x, lp.y, 10 * s, 0, 7); g.moveTo(lp.x + 2 * s, lp.y); g.arc(lp.x, lp.y, 2 * s, 0, 7); g.stroke();
        g.font = `bold ${Math.round(11 * s)}px "Share Tech Mono", monospace`; g.textAlign = 'center'; g.fillText(`${(dist / 1000).toFixed(1)}`, lp.x, lp.y + 24 * s);
        g.globalAlpha = 1;
      }
    }
    g.shadowBlur = 0;
  }
  _gunTarget(p, game) {
    let best = null, bs = 1e9;
    for (const a of game.aircraft) {
      if (!a.alive || a.team === p.team || a.parked) continue;
      const d = _a.copy(a.fm.pos).sub(p.fm.pos), dist = d.length();
      if (dist > 1800) continue;
      const c = d.dot(p.fwd) / dist;
      if (c < 0.8) continue;
      const sc = dist * (2 - c);
      if (sc < bs) { bs = sc; best = a; }
    }
    return best;
  }
  _ils(p, game, bx, by, s) {
    const g = this.g, fm = p.fm;
    let thr, dirX, dirZ, deckY;
    if (p.team === 'navy' || game.tutorialMode) {
      const c = game.world.fleet.carrier;
      if (p.team === 'navy' || fm.pos.x < 0) {
        thr = c.toWorld(_a.set(-13.8, c.deckY, 92), new V3()); // aim at the 3-wire const far = c.toWorld(_b.set(-39, c.deckY, -66), new V3());
        dirX = far.x - thr.x; dirZ = far.z - thr.z; deckY = thr.y;
      }
    }
    if (!thr) { const R = game.world.airbase.runway; const fromW = true; /* always land eastbound: mountains rise right behind the east end */ thr = new V3(fromW ? R.x0 + 300 : R.x1 - 300, R.y, R.z); dirX = fromW ? 1 : -1; dirZ = 0; deckY = R.y; }
    const dl = Math.hypot(dirX, dirZ); dirX /= dl; dirZ /= dl;
    const rx = fm.pos.x - thr.x, rz = fm.pos.z - thr.z;
    const along = -(rx * dirX + rz * dirZ), lat = rx * -dirZ + rz * dirX;
    if (along < 200 || along > 12000) return;
    const gsAlt = deckY + along * Math.tan(3.5 * DEG);
    const vdev = clamp((fm.pos.y - gsAlt) / (along * 0.02 + 20), -1, 1), hdev = clamp(lat / (along * 0.05 + 30), -1, 1);
    const R = 60 * s;
    g.globalAlpha = 0.9;
    g.strokeRect(bx - R, by - R, R * 2, R * 2);
    g.beginPath(); g.moveTo(bx - R, by + vdev * R); g.lineTo(bx + R, by + vdev * R); g.moveTo(bx + hdev * R, by - R); g.lineTo(bx + hdev * R, by + R); g.stroke();
    g.textAlign = 'center'; g.fillText(`${(along / 1000).toFixed(1)} km`, bx, by + R + 16 * s);
    // approach speed: 1.25 x the 1-g stall speed at the current weight and flap setting
    const tgt = Math.round((fm.vs1g || 65) * 1.25 * 3.6 / 5) * 5;
    const spd = fm.V * 3.6;
    g.fillText(spd > tgt + 25 ? `SLOW DOWN · ${tgt}` : spd < tgt - 20 ? `TOO SLOW · ${tgt}` : `ON SPEED · ${tgt}`, bx, by - R - 8 * s);
    g.globalAlpha = 1;
  }

  _markers(p, cam, game) {
    const g = this.g, s = Math.min(this.cv.width, this.cv.height) / 900;
    g.font = `bold ${Math.round(12 * s)}px "Rajdhani", sans-serif`; g.textAlign = 'center';
    const camFwd = _a.set(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const a of game.aircraft) {
      if (a === p || !a.alive || a.parked) continue;
      const d = _b.copy(a.fm.pos).sub(cam.position), dist = d.length();
      if (dist > 12000 || dist < 30) continue;
      if (d.dot(camFwd) <= 0) continue;
      const sp = this.proj(_c.copy(a.fm.pos).addScaledVector(_d.set(0, 1, 0), 3 + dist * 0.01), cam, { x: 0, y: 0 });
      if (!sp) continue;
      const enemy = a.team !== p.team;
      const locked = p.lock?.target === a;
      const col = enemy ? (locked && p.lockState === 2 ? '#ff3030' : '#ff5a4a') : '#5ab4ff';
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2 * s;
      const r = (locked ? 9 : 5) * s;
      g.beginPath();
      if (enemy) { g.moveTo(sp.x, sp.y + r); g.lineTo(sp.x - r, sp.y - r * 0.6); g.lineTo(sp.x + r, sp.y - r * 0.6); g.closePath(); }
      else { g.moveTo(sp.x, sp.y - r); g.lineTo(sp.x + r, sp.y); g.lineTo(sp.x, sp.y + r); g.lineTo(sp.x - r, sp.y); g.closePath(); }
      g.stroke();
      if (locked) { g.strokeRect(sp.x - 14 * s, sp.y - 14 * s, 28 * s, 28 * s); }
      if (dist < 4500 || locked) g.fillText(`${enemy ? '' : a.name + ' '}${dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'}`, sp.x, sp.y - 12 * s);
    }
    // incoming missile indicators
    for (const m of p.incoming) {
      if (m.lost) continue;
      const sp = this.proj(m.pos, cam, { x: 0, y: 0 });
      if (sp) { g.strokeStyle = '#ff3030'; g.lineWidth = 2 * s; g.beginPath(); g.arc(sp.x, sp.y, 10 * s, 0, 7); g.stroke(); }
    }
  }

  _text(p, game) {
    const fm = p.fm, E = this.el;
    const kts = this.units === 'kts';
    E.spd.textContent = `${Math.round(fm.V * (kts ? 1.944 : 3.6))} ${kts ? 'kts' : 'km/h'}`;
    E.alt.textContent = `${Math.round(fm.pos.y)} m`;
    const thrPct = Math.round(fm.throttle * 100);
    E.thr.textContent = fm.engine === 'off' ? 'OFF' : fm.engine === 'starting' ? 'START' : fm.engine === 'dead' ? 'FLAMEOUT' : `${thrPct}%${fm.ab > 0.05 ? ' AB' : ''}`;
    E.thrBar.style.width = `${thrPct}%`; E.thrBar.classList.toggle('ab', fm.ab > 0.05);
    E.gear.textContent = fm.gear > 0.99 ? 'GEAR DOWN' : fm.gear < 0.01 ? 'GEAR UP' : 'GEAR ···';
    E.gear.className = fm.gear > 0.99 ? 'down' : fm.gear < 0.01 ? 'up' : 'moving';
    E.gl.textContent = `${fm.gLoad.toFixed(1)} G`;
    E.aoa.textContent = `RPM ${Math.round(fm.rpm * 100)}%`;
    E.fuel.textContent = `FUEL ${Math.round(fm.fuel / p.def.fuel * 100)}%`;
    const G = p.def.gun;
    E.gun.textContent = p.reloading > 0 ? 'RELOADING' : `${p.gunAmmo} / ${p.gunReserve}`;
    E.gunBar.style.width = p.reloading > 0 ? `${(1 - p.reloading / G.reload) * 100}%` : `${p.gunAmmo / G.box * 100}%`;
    E.gunBar.classList.toggle('hot', p.gunHeat > 0.7);
    E.msl.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < p.missiles ? 'on' : ''}"></i>`).join('');
    E.mslN.textContent = `${p.missiles}/5`;
    E.flr.textContent = `${p.flares}`;
    E.lock.textContent = p.lockState === 2 ? 'LOCKED' : p.lockState === 1 ? 'SEEKING' : '';
    E.lock.className = p.lockState === 2 ? 'locked' : p.lockState === 1 ? 'seek' : '';
    let tot = 0;
    for (const c of ['fuselage', 'wingL', 'wingR', 'engine', 'tail']) {
      const f = p.hpFrac(c); tot += f;
      const col = f <= 0 ? '#111' : f < 0.25 ? '#ff3b30' : f < 0.5 ? '#ff8a1f' : f < 0.75 ? '#ffd43b' : '#38e07b';
      E.dmg[c].setAttribute('fill', col); E.dmg[c].setAttribute('fill-opacity', f <= 0 ? 0.9 : 0.55); E.dmg[c].setAttribute('stroke', col);
    }
    E.dmgPct.textContent = `${Math.round(tot / 5 * 100)}%`;
    if (E.fps && game.showFps) E.fps.textContent = `${game.fps | 0} fps`;
  }

  _teamBar(game) {
    const E = this.el, m = game.match;
    if (!m) return;
    const my = game.playerTeam, other = my === 'navy' ? 'coast' : 'navy';
    const a = m.count(my), b = m.count(other);
    if (this._tb !== `${a}:${b}:${m.size}`) {
      this._tb = `${a}:${b}:${m.size}`;
      E.cntL.textContent = a; E.cntR.textContent = b;
      E.nameL.textContent = TEAMS[my].short; E.nameR.textContent = TEAMS[other].short;
      E.pipsL.innerHTML = Array.from({ length: m.size }, (_, i) => `<i class="${i < a ? 'on' : ''}"></i>`).join('');
      E.pipsR.innerHTML = Array.from({ length: m.size }, (_, i) => `<i class="${i < b ? 'on' : ''}"></i>`).join('');
    }
    E.timer.textContent = fmtTime(m.timeLeft);
    E.info.textContent = m.info || '';
  }

  _minimap(p, game) {
    const g = this.mg, S = this.mm.width, R = S / 2, range = 9000, H = WORLD.half;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.clip();
    g.fillStyle = '#0a1418'; g.fillRect(0, 0, S, S);
    const fwd = p.fwd, hdg = Math.atan2(fwd.x, -fwd.z);
    const k = R / range;
    g.translate(R, R); g.rotate(-hdg);
    if (this.mapImg) { g.globalAlpha = 0.85; const sc = 2 * H * k; g.drawImage(this.mapImg, (-H - p.fm.pos.x) * k, (-H - p.fm.pos.z) * k, sc, sc); g.globalAlpha = 1; }
    const P = (x, z) => [(x - p.fm.pos.x) * k, (z - p.fm.pos.z) * k];
    // bases
    const c = game.world.fleet.carrier; const [cx, cz] = P(c.pos.x, c.pos.z);
    g.fillStyle = p.team === 'navy' ? '#5ab4ff' : '#ff5a4a'; g.fillRect(cx - 4, cz - 4, 8, 8);
    for (const s of game.world.fleet.ships) { if (s === c) continue; const [x, z] = P(s.pos.x, s.pos.z); g.fillRect(x - 2, z - 2, 4, 4); }
    const A = game.world.airbase.runway; const [ax, az] = P((A.x0 + A.x1) / 2, A.z);
    g.fillStyle = p.team === 'coast' ? '#5ab4ff' : '#ff5a4a'; g.fillRect(ax - 7, az - 2, 14, 4);
    // planes
    for (const a of game.aircraft) {
      if (!a.alive || a === p || a.parked) continue;
      const enemy = a.team !== p.team;
      if (enemy && !game.isSpotted(a)) continue;
      const [x, z] = P(a.fm.pos.x, a.fm.pos.z);
      if (x * x + z * z > R * R) continue;
      g.save(); g.translate(x, z); g.rotate(Math.atan2(a.fwd.x, -a.fwd.z));
      g.fillStyle = enemy ? '#ff4a3a' : '#5ab4ff';
      g.beginPath(); g.moveTo(0, -5); g.lineTo(3.5, 4); g.lineTo(-3.5, 4); g.closePath(); g.fill();
      g.restore();
    }
    for (const m of game.weapons.missiles) { const [x, z] = P(m.pos.x, m.pos.z); g.fillStyle = m.team === p.team ? '#bfe3ff' : '#ffb0a0'; g.fillRect(x - 1, z - 1, 2, 2); }
    g.restore();
    // own aircraft + rings
    g.strokeStyle = 'rgba(160,220,200,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.arc(R, R, R * 0.5, 0, 7); g.stroke();
    g.fillStyle = '#ffe14a'; g.beginPath(); g.moveTo(R, R - 7); g.lineTo(R + 5, R + 6); g.lineTo(R - 5, R + 6); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(160,220,200,0.6)'; g.lineWidth = 2; g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.stroke();
    // north marker
    const nx = R + Math.sin(-hdg) * (R - 12), ny = R - Math.cos(-hdg) * (R - 12);
    g.fillStyle = '#fff'; g.font = 'bold 12px Rajdhani, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny); g.textBaseline = 'alphabetic';
  }

  drawTactical(game) {
    const g = this.tg, S = this.tac.width, H = WORLD.half, k = S / (2 * H), p = game.player;
    const P = (x, z) => [(x + H) * k, (z + H) * k];
    g.clearRect(0, 0, S, S);
    if (this.mapImg) g.drawImage(this.mapImg, 0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * S / 8, 0); g.lineTo(i * S / 8, S); g.moveTo(0, i * S / 8); g.lineTo(S, i * S / 8); g.stroke(); }
    g.font = 'bold 13px Rajdhani, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 8; i++) { g.fillText('ABCDEFGH'[i], i * S / 8 + 4, 14); g.fillText(String(i + 1), 4, i * S / 8 + 28); }
    const myTeam = game.playerTeam;
    const tc = (t) => (t === myTeam ? '#5ab4ff' : '#ff4a3a');
    for (const s of game.world.fleet.ships) { const [x, z] = P(s.pos.x, s.pos.z); g.save(); g.translate(x, z); g.rotate(-s.heading); g.fillStyle = tc('navy'); g.fillRect(-3, -s.length * k / 2 - 2, 6, s.length * k + 4); g.restore(); }
    const A = game.world.airbase.runway; const [a0x, az] = P(A.x0, A.z), [a1x] = P(A.x1, A.z);
    g.strokeStyle = tc('coast'); g.lineWidth = 5; g.beginPath(); g.moveTo(a0x, az); g.lineTo(a1x, az); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 14px Rajdhani, sans-serif';
    const [cx, cz] = P(game.world.fleet.carrier.pos.x, game.world.fleet.carrier.pos.z); g.fillText('CARRIER', cx + 10, cz - 8);
    g.fillText('AIRBASE', a0x, az - 12);
    const C = WORLD.city; const [ctx0, ctz0] = P(C.x0, C.z0); g.fillText('CITY', ctx0 + 10, ctz0 + 20);
    for (const m of game.aa.mounts) { if (!m.alive) continue; const [x, z] = P(m.pos.x, m.pos.z); g.fillStyle = tc(m.team); g.globalAlpha = 0.6; g.fillRect(x - 2, z - 2, 4, 4); g.globalAlpha = 1; }
    for (const a of game.aircraft) {
      if (!a.alive || a.parked) continue;
      if (a.team !== myTeam && !game.isSpotted(a)) continue;
      const [x, z] = P(a.fm.pos.x, a.fm.pos.z);
      g.save(); g.translate(x, z); g.rotate(Math.atan2(a.fwd.x, -a.fwd.z));
      g.fillStyle = a === p ? '#ffe14a' : tc(a.team);
      g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath(); g.fill();
      g.restore();
    }
    // scoreboard
    const rows = (team) => game.match.roster.filter((a) => a.team === team).sort((x, y) => y.score - x.score);
    const table = (team) => `<table><tr><th>${TEAMS[team].name}</th><th>Aircraft</th><th>K</th><th>A</th><th>D</th><th>Score</th></tr>${rows(team).map((a) => `<tr class="${a.isPlayer ? 'me' : ''} ${a.alive || a.isPlayer ? '' : 'dead'}"><td>${a.name}</td><td>${a.def.short}</td><td>${a.kills}</td><td>${a.assists}</td><td>${a.deaths}</td><td>${a.score}</td></tr>`).join('')}</table>`;
    this.el.score.innerHTML = `<div class="sbTeam navy">${table(myTeam)}</div><div class="sbTeam coast">${table(myTeam === 'navy' ? 'coast' : 'navy')}</div>`;
  }
}
