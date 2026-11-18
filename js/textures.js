// Procedural textures (generated on a canvas or as raw data at load time, so the game ships no image files).
import * as THREE from 'three';
import { tileNoise, tileFbm, makeRng, clamp, lerp } from './util.js';

export const TEX = {};
let maxAniso = 4;
export function setAniso(n) { maxAniso = n; }

function finish(t, { srgb = false, repeat = true, aniso = true } = {}) {
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (aniso) t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
export function dataTex(data, w, h = w, opts = {}) { return finish(new THREE.DataTexture(data, w, h, THREE.RGBAFormat), opts); }
export function canvasTex(c, opts = {}) { return finish(new THREE.CanvasTexture(c), opts); }
export function makeCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d') }; }

// height field (Float32, tileable) -> RGBA normal map
export function normalFromHeight(hf, size, strength = 2) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = hf[y * size + ((x - 1 + size) % size)], xr = hf[y * size + ((x + 1) % size)];
    const yu = hf[((y - 1 + size) % size) * size + x], yd = hf[((y + 1) % size) * size + x];
    let nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}
function grayRGBA(arr, size, lo = 0, hi = 1, tint = [1, 1, 1]) {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = clamp(lerp(lo, hi, arr[i]), 0, 1) * 255;
    out[i * 4] = v * tint[0]; out[i * 4 + 1] = v * tint[1]; out[i * 4 + 2] = v * tint[2]; out[i * 4 + 3] = 255;
  }
  return out;
}
function colorNoise(size, cells, oct, seed, c0, c1, contrast = 1, extra) {
  const n = tileFbm(size, cells, oct, seed);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    let t = clamp((n[i] - 0.5) * contrast + 0.5, 0, 1);
    if (extra) t = extra(t, i);
    out[i * 4] = lerp(c0[0], c1[0], t); out[i * 4 + 1] = lerp(c0[1], c1[1], t); out[i * 4 + 2] = lerp(c0[2], c1[2], t); out[i * 4 + 3] = 255;
  }
  return out;
}

export function buildTextures(q = 1) {
  const S = q >= 1 ? 512 : 256;
  // ---- ocean detail normals (two octaves mixed) ----
  {
    const s = 512;
    const a = tileFbm(s, 8, 5, 11), b = tileFbm(s, 32, 3, 23);
    const h = new Float32Array(s * s);
    for (let i = 0; i < h.length; i++) h[i] = a[i] * 0.8 + b[i] * 0.35;
    TEX.waterNormal = dataTex(normalFromHeight(h, s, 5.5), s);
    const f = tileFbm(256, 16, 4, 77), cells = tileNoise(256, 64, 5);
    const foam = new Float32Array(256 * 256);
    for (let i = 0; i < foam.length; i++) foam[i] = clamp((f[i] - 0.42) * 3.2 + (cells[i] - 0.5) * 0.9, 0, 1);
    TEX.foam = dataTex(grayRGBA(foam, 256), 256);
  }
  // ---- fabric twill weave (flight suit) — fine, low-contrast, read as cloth not grain ----
  {
    const s = 256, h = new Float32Array(s * s), alb = new Float32Array(s * s);
    const nz = tileNoise(s, 64, 3), big = tileFbm(s, 4, 3, 9);
    const T = 8; // px per thread
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const ix = Math.floor(x / T), iy = Math.floor(y / T), fx = (x % T) / T, fy = (y % T) / T;
      const over = ((ix + iy) & 3) < 2; // 2/2 twill
      const warp = Math.sin(fx * Math.PI), weft = Math.sin(fy * Math.PI);
      const v = over ? 0.55 + 0.45 * warp * (0.7 + 0.3 * Math.sin(fy * Math.PI)) : 0.55 + 0.45 * weft * (0.7 + 0.3 * Math.sin(fx * Math.PI));
      h[y * s + x] = v * 0.9 + nz[y * s + x] * 0.1;
      alb[y * s + x] = 0.9 + 0.06 * v + 0.05 * (big[y * s + x] - 0.5);
    }
    TEX.fabricN = dataTex(normalFromHeight(h, s, 1.6), s);
    TEX.fabric = dataTex(grayRGBA(alb, s), s, s, { srgb: true });
  }
  // ---- leather pebble grain (glove palms, seat): jittered-grid voronoi ----
  {
    const s = 256, r = makeRng(5), G = 28, cs = s / G, h = new Float32Array(s * s);
    const pts = new Float32Array(G * G * 2);
    for (let i = 0; i < G * G; i++) { pts[i * 2] = r(); pts[i * 2 + 1] = r(); }
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const gx = Math.floor(x / cs), gy = Math.floor(y / cs);
      let d1 = 1e9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = (gx + ox + G) % G, cy = (gy + oy + G) % G, k = (cy * G + cx) * 2;
        const px = (gx + ox + pts[k]) * cs, py = (gy + oy + pts[k + 1]) * cs;
        const d = (x - px) * (x - px) + (y - py) * (y - py);
        if (d < d1) d1 = d;
      }
      const v = Math.min(1, Math.sqrt(d1) / (cs * 0.75));
      h[y * s + x] = 1 - v * v;
    }
    TEX.leatherN = dataTex(normalFromHeight(h, s, 1.4), s);
  }
  // ---- aircraft skin: panel lines, fasteners, light wear ----
  {
    const s = 1024, r = makeRng(42);
    const { c, g } = makeCanvas(s);
    g.fillStyle = '#ececec'; g.fillRect(0, 0, s, s);
    const { c: cr, g: gr } = makeCanvas(s); // roughness
    gr.fillStyle = '#9a9a9a'; gr.fillRect(0, 0, s, s);
    // subtle tonal variation between panels (paint batches)
    let y = 0;
    const lines = [];
    while (y < s) {
      const hgt = 70 + r() * 140; let x = r() * -60;
      while (x < s) { const w = 90 + r() * 220; const tone = 236 + (r() - 0.5) * 14; g.fillStyle = `rgb(${tone},${tone},${tone})`; g.fillRect(x, y, w, hgt); gr.fillStyle = `rgb(${150 + (r() - 0.5) * 40},0,0)`; gr.fillRect(x, y, w, hgt); lines.push([x, y, w, hgt]); x += w; }
      y += hgt;
    }
    // streaks (grime running aft)
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(90,90,90,${0.015 + r() * 0.03})`; g.fillRect(r() * s, r() * s, 2 + r() * 8, 60 + r() * 240); }
    // panel seams + fasteners into a height map
    const { c: ch, g: gh } = makeCanvas(s);
    gh.fillStyle = '#fff'; gh.fillRect(0, 0, s, s);
    gh.strokeStyle = '#000'; gh.lineWidth = 2.2;
    for (const [x, yy, w, hh] of lines) { gh.strokeRect(x + 0.5, yy + 0.5, w, hh); }
    gh.fillStyle = '#444';
    for (const [x, yy, w, hh] of lines) {
      if (r() < 0.55) { for (let k = 6; k < w - 4; k += 11) { gh.fillRect(x + k, yy + 5, 2, 2); gh.fillRect(x + k, yy + hh - 6, 2, 2); } }
      if (r() < 0.4) { for (let k = 6; k < hh - 4; k += 11) { gh.fillRect(x + 5, yy + k, 2, 2); } }
      if (r() < 0.12) { gh.strokeStyle = '#222'; gh.lineWidth = 1.5; gh.strokeRect(x + w * 0.3, yy + hh * 0.3, w * 0.25, hh * 0.3); gh.strokeStyle = '#000'; gh.lineWidth = 2.2; }
    }
    const hd = gh.getImageData(0, 0, s, s).data, hf = new Float32Array(s * s);
    for (let i = 0; i < s * s; i++) hf[i] = hd[i * 4] / 255;
    // darken seams slightly in albedo
    const ad = g.getImageData(0, 0, s, s);
    for (let i = 0; i < s * s; i++) { const k = 0.86 + 0.14 * hf[i]; ad.data[i * 4] *= k; ad.data[i * 4 + 1] *= k; ad.data[i * 4 + 2] *= k; }
    g.putImageData(ad, 0, 0);
    TEX.panel = canvasTex(c, { srgb: true });
    TEX.panelN = dataTex(normalFromHeight(hf, s, 1.2), s);
    TEX.panelR = canvasTex(cr);
  }
  // ---- camouflage (coastal team, two-tone blue-grey) ----
  {
    const s = 512, a = tileFbm(s, 3, 4, 300), b = tileFbm(s, 5, 3, 301);
    const out = new Uint8Array(s * s * 4);
    for (let i = 0; i < s * s; i++) {
      const v = a[i] * 0.7 + b[i] * 0.3;
      const t = v > 0.56 ? 2 : v > 0.45 ? 1 : 0;
      const col = [[205, 214, 224], [150, 170, 196], [108, 128, 156]][t];
      out[i * 4] = col[0]; out[i * 4 + 1] = col[1]; out[i * 4 + 2] = col[2]; out[i * 4 + 3] = 255;
    }
    TEX.camo = dataTex(out, s, s, { srgb: true });
  }
  // ---- ground surfaces ----
  TEX.grass = dataTex(colorNoise(S, 16, 5, 501, [72, 88, 44], [118, 128, 70], 1.5), S, S, { srgb: true });
  TEX.forest = dataTex(colorNoise(S, 48, 5, 502, [34, 50, 30], [70, 88, 52], 2.2), S, S, { srgb: true });
  TEX.rock = dataTex(colorNoise(S, 12, 6, 503, [88, 84, 78], [150, 144, 132], 1.8), S, S, { srgb: true });
  TEX.sand = dataTex(colorNoise(S, 32, 4, 504, [170, 156, 122], [214, 200, 164], 1.2), S, S, { srgb: true });
  TEX.dirt = dataTex(colorNoise(S, 20, 5, 505, [96, 82, 60], [140, 122, 92], 1.5), S, S, { srgb: true });
  {
    const h = tileFbm(S, 24, 5, 506);
    TEX.groundN = dataTex(normalFromHeight(h, S, 3), S);
  }
  // asphalt, concrete slabs, carrier non-skid
  TEX.asphalt = dataTex(colorNoise(S, 64, 4, 601, [44, 45, 47], [74, 75, 77], 1.4), S, S, { srgb: true });
  {
    const s = 512, n = tileFbm(s, 32, 4, 602);
    const out = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = y * s + x; const seam = (x % 128 < 2 || y % 128 < 2) ? 0.7 : 1;
      const v = (150 + (n[i] - 0.5) * 40) * seam;
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v * 0.97; out[i * 4 + 3] = 255;
    }
    TEX.concrete = dataTex(out, s, s, { srgb: true });
  }
  {
    const s = 512, n = tileNoise(s, 128, 3), streak = tileFbm(s, 4, 3, 610);
    const out = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = y * s + x; const v = 104 + n[i] * 22 - streak[(y * s + (x >> 3)) % (s * s)] * 14;
      out[i * 4] = v; out[i * 4 + 1] = v + 1; out[i * 4 + 2] = v + 3; out[i * 4 + 3] = 255;
    }
    TEX.nonskid = dataTex(out, s, s, { srgb: true });
  }
  // ---- building facades (map + emissive) ----
  TEX.facades = [
    facade({ wall: '#7f8c99', glass: ['#2b4760', '#365a75', '#22394d'], bays: 6, floors: 6, frame: '#a9b4be', mull: 2, glassy: true, seed: 1 }),
    facade({ wall: '#b8b2a6', glass: ['#3a4a55', '#2f3c45', '#46545e'], bays: 5, floors: 5, frame: '#cfc9bd', mull: 8, seed: 2 }),
    facade({ wall: '#8e5a45', glass: ['#2e3438', '#383f44'], bays: 4, floors: 5, frame: '#a87660', mull: 12, seed: 3 }),
    facade({ wall: '#d6d3cc', glass: ['#43545f', '#55666f', '#384852'], bays: 5, floors: 6, frame: '#e8e6e1', mull: 6, seed: 4 }),
    facade({ wall: '#4d5a63', glass: ['#1d3346', '#24415a', '#2c4c66'], bays: 8, floors: 8, frame: '#5f6d77', mull: 1, glassy: true, seed: 5 }),
  ];
  // ---- particle atlas 4x4: 0-7 smoke puffs, 8 fire, 9 fire2, 10 glow, 11 spark, 12 spray, 13 spray2, 14 debris, 15 ring ----
  {
    const s = 1024, cell = 256, { c, g } = makeCanvas(s);
    const r = makeRng(77);
    for (let k = 0; k < 16; k++) {
      const ox = (k % 4) * cell, oy = Math.floor(k / 4) * cell, cx = ox + cell / 2, cy = oy + cell / 2;
      g.save(); g.beginPath(); g.rect(ox, oy, cell, cell); g.clip();
      if (k < 8) { // billowy smoke: many soft blobs
        for (let i = 0; i < 34; i++) {
          const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * cell * 0.26, rad = cell * (0.08 + r() * 0.16);
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
          const gr = g.createRadialGradient(x, y, 0, x, y, rad);
          const lum = 200 + r() * 55;
          gr.addColorStop(0, `rgba(${lum},${lum},${lum},0.42)`); gr.addColorStop(1, `rgba(${lum},${lum},${lum},0)`);
          g.fillStyle = gr; g.fillRect(ox, oy, cell, cell);
        }
      } else if (k === 8 || k === 9) {
        for (let i = 0; i < 26; i++) {
          const a = r() * Math.PI * 2, d = r() * cell * 0.22, rad = cell * (0.08 + r() * 0.18);
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
          const gr = g.createRadialGradient(x, y, 0, x, y, rad);
          gr.addColorStop(0, 'rgba(255,240,200,0.55)'); gr.addColorStop(0.4, 'rgba(255,150,40,0.3)'); gr.addColorStop(1, 'rgba(200,40,0,0)');
          g.fillStyle = gr; g.fillRect(ox, oy, cell, cell);
        }
      } else if (k === 10) {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, cell / 2);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.7)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(ox, oy, cell, cell);
      } else if (k === 11) {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, cell / 2);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(ox, oy, cell, cell);
      } else if (k === 12 || k === 13) { // spray: droplet cloud
        for (let i = 0; i < 260; i++) {
          const a = r() * Math.PI * 2, d = Math.pow(r(), 0.5) * cell * 0.42, rad = 1 + r() * 5;
          g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.5})`; g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rad, 0, 7); g.fill();
        }
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.45);
        gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(ox, oy, cell, cell);
      } else if (k === 14) {
        g.fillStyle = '#fff';
        for (let i = 0; i < 9; i++) { g.save(); g.translate(cx + (r() - 0.5) * 120, cy + (r() - 0.5) * 120); g.rotate(r() * 6); g.fillRect(-6 - r() * 10, -3, 12 + r() * 20, 6 + r() * 6); g.restore(); }
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 18; g.beginPath(); g.arc(cx, cy, cell * 0.36, 0, 7); g.stroke();
        g.filter = 'blur(6px)'; g.stroke(); g.filter = 'none';
      }
      g.restore();
    }
    TEX.particles = canvasTex(c, { repeat: false });
  }
  // ---- cloud puff atlas 2x2: soft cauliflower lobes ----
  {
    const s = 512, cell = 256, { c, g } = makeCanvas(s), r = makeRng(99);
    for (let k = 0; k < 4; k++) {
      const ox = (k % 2) * cell, oy = Math.floor(k / 2) * cell, cx = ox + cell / 2, cy = oy + cell / 2;
      g.save(); g.beginPath(); g.rect(ox, oy, cell, cell); g.clip();
      const base = g.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.46);
      base.addColorStop(0, 'rgba(255,255,255,0.55)'); base.addColorStop(0.55, 'rgba(255,255,255,0.32)'); base.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = base; g.fillRect(ox, oy, cell, cell);
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * cell * 0.24, rad = cell * (0.12 + r() * 0.14);
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.9;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(255,255,255,0.2)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(ox, oy, cell, cell);
      }
      g.restore();
    }
    g.filter = 'blur(3px)'; g.drawImage(c, 0, 0); g.filter = 'none';
    TEX.cloud = canvasTex(c, { repeat: false });
  }
  TEX.insignia = { navy: insignia('#1d4f9c', '#ffffff'), coast: insignia('#b3242a', '#ffffff') };
  return TEX;
}

function facade(o) {
  const s = 512, { c, g } = makeCanvas(s), { c: ce, g: ge } = makeCanvas(s), r = makeRng(o.seed * 31);
  g.fillStyle = o.wall; g.fillRect(0, 0, s, s);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, s, s);
  const bw = s / o.bays, fh = s / o.floors;
  for (let f = 0; f < o.floors; f++) for (let b = 0; b < o.bays; b++) {
    const x = b * bw, y = f * fh;
    const m = o.mull;
    const wx = x + m, wy = y + (o.glassy ? m : fh * 0.22), ww = bw - m * 2, wh = o.glassy ? fh - m * 2 : fh * 0.55;
    const gc = o.glass[Math.floor(r() * o.glass.length)];
    const gr = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
    gr.addColorStop(0, gc); gr.addColorStop(1, shade(gc, 0.75 + r() * 0.3));
    g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
    if (!o.glassy) { g.fillStyle = o.frame; g.fillRect(wx - 2, wy + wh, ww + 4, 4); g.fillRect(wx + ww / 2 - 1, wy, 2, wh); }
    // a few lit windows for dusk
    if (r() < 0.32) { const warm = r() < 0.7; ge.fillStyle = warm ? `rgb(${200 + r() * 55},${150 + r() * 60},${70 + r() * 40})` : `rgb(${150 + r() * 40},${180 + r() * 40},${210 + r() * 40})`; ge.fillRect(wx, wy, ww, wh); }
    if (r() < 0.25) { g.fillStyle = 'rgba(230,230,220,0.18)'; g.fillRect(wx, wy, ww * (0.3 + r() * 0.7), wh); } // blinds
  }
  if (o.glassy) { g.fillStyle = o.frame; for (let f = 0; f <= o.floors; f++) g.fillRect(0, f * fh - 2, s, 4); for (let b = 0; b <= o.bays; b++) g.fillRect(b * bw - 1, 0, 2, s); }
  return { map: canvasTex(c, { srgb: true }), emissive: canvasTex(ce, { srgb: true }), bayW: o.glassy ? 3.0 : 3.6, floorH: 3.6, bays: o.bays, floors: o.floors, glassy: !!o.glassy };
}
function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k); return `rgb(${r | 0},${g | 0},${b | 0})`; }

function insignia(col, fg) {
  const s = 256, { c, g } = makeCanvas(s);
  g.clearRect(0, 0, s, s);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(128, 128, 108, 0, 7); g.fill();
  // lightning bolt
  g.fillStyle = fg; g.beginPath();
  g.moveTo(146, 30); g.lineTo(84, 140); g.lineTo(124, 140); g.lineTo(104, 226); g.lineTo(174, 108); g.lineTo(132, 108); g.lineTo(160, 30); g.closePath(); g.fill();
  return canvasTex(c, { srgb: true, repeat: false });
}

// text label texture (runway numbers, deck numbers, tail codes)
export function textTex(text, { w = 256, h = 128, font = 'bold 100px Arial', color = '#fff', bg = null } = {}) {
  const { c, g } = makeCanvas(w, h);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } else g.clearRect(0, 0, w, h);
  g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  return canvasTex(c, { srgb: true, repeat: false });
}
