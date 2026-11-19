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

// ---- ground detail textures (tileable) ----
let _sp = null;
const _speck = (i) => _sp[i % _sp.length];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// grass: patchy green with dry, yellower areas, darker tufts and blade speckle
function grassTex(S) {
  const a = tileFbm(S, 16, 5, 501), b = tileFbm(S, 5, 4, 511), tuft = tileNoise(S, S / 8, 513);
  _sp = tileNoise(S, S / 2, 512);
  const out = new Uint8Array(S * S * 4), dark = [52, 70, 34], mid = [92, 108, 54], dry = [136, 128, 74];
  for (let i = 0; i < S * S; i++) {
    let c = mix3(dark, mid, clamp((a[i] - 0.5) * 1.8 + 0.5, 0, 1));
    c = mix3(c, dry, clamp((b[i] - 0.56) * 3, 0, 0.75));
    const k = (0.84 + 0.32 * _sp[i]) * (tuft[i] > 0.72 ? 0.8 : 1);
    out[i * 4] = clamp(c[0] * k, 0, 255); out[i * 4 + 1] = clamp(c[1] * k, 0, 255); out[i * 4 + 2] = clamp(c[2] * k, 0, 255); out[i * 4 + 3] = 255;
  }
  return out;
}
// forest from above: overlapping tree crowns, each lit from the upper left, with dark gaps between them
function canopyTex(S) {
  const r = makeRng(502), col = new Float32Array(S * S * 3);
  for (let i = 0; i < S * S; i++) { col[i * 3] = 20; col[i * 3 + 1] = 30; col[i * 3 + 2] = 18; }
  const n = Math.round(S * S / 150);
  for (let k = 0; k < n; k++) {
    const cx = r() * S, cy = r() * S, rad = S / 512 * (5 + r() * 8), hue = r();
    const base = hue < 0.55 ? [52 + r() * 16, 76 + r() * 20, 38 + r() * 10] : hue < 0.85 ? [42, 64, 42] : [80, 92, 46];
    const x0 = Math.floor(cx - rad), x1 = Math.ceil(cx + rad), y0 = Math.floor(cy - rad), y1 = Math.ceil(cy + rad);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rad, dy = (y - cy) / rad, d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const lit = clamp(0.62 + 0.55 * (-dx * 0.6 - dy * 0.6) * (1 - d2 * 0.4) + 0.2 * (1 - d2), 0.25, 1.25);
      const j = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 3;
      col[j] = base[0] * lit; col[j + 1] = base[1] * lit; col[j + 2] = base[2] * lit;
    }
  }
  const out = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { out[i * 4] = clamp(col[i * 3], 0, 255); out[i * 4 + 1] = clamp(col[i * 3 + 1], 0, 255); out[i * 4 + 2] = clamp(col[i * 3 + 2], 0, 255); out[i * 4 + 3] = 255; }
  return out;
}
// rock: layered ridged noise with dark cracks and pale lichen
function rockTex(S) {
  const a = tileFbm(S, 8, 6, 503), b = tileFbm(S, 24, 4, 514), c = tileFbm(S, 12, 3, 515), li = tileNoise(S, S / 4, 516);
  const out = new Uint8Array(S * S * 4), lo = [78, 74, 68], hi = [156, 150, 138];
  for (let i = 0; i < S * S; i++) {
    const ridged = 1 - Math.abs(a[i] * 2 - 1);
    let t = clamp(ridged * 0.75 + b[i] * 0.45 - 0.2, 0, 1);
    let col = mix3(lo, hi, t);
    if (Math.abs(c[i] - 0.5) < 0.012) col = mix3(col, [40, 38, 35], 0.75);           // cracks
    if (li[i] > 0.86) col = mix3(col, li[i] > 0.93 ? [170, 160, 110] : [128, 140, 104], 0.45); // lichen
    out[i * 4] = col[0]; out[i * 4 + 1] = col[1]; out[i * 4 + 2] = col[2]; out[i * 4 + 3] = 255;
  }
  return out;
}
// sand: soft dunes with wind ripples
function sandTex(S) {
  const a = tileFbm(S, 12, 4, 504), w = tileFbm(S, 4, 3, 517);
  const out = new Uint8Array(S * S * 4), lo = [168, 152, 118], hi = [216, 202, 166];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const rip = 0.5 + 0.5 * Math.sin((x + w[i] * S * 0.25) / S * Math.PI * 2 * 40);
    const col = mix3(lo, hi, clamp(a[i] * 1.1 - 0.05 + rip * 0.12, 0, 1));
    out[i * 4] = col[0]; out[i * 4 + 1] = col[1]; out[i * 4 + 2] = col[2]; out[i * 4 + 3] = 255;
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
  // ---- aircraft skin: panel lines, fasteners, touch-up paint, grime and wear ----
  // TEX.panel is a light weathered base the paint colour multiplies; the camo schemes reuse its seams and grime.
  let skinShade; // per-pixel 0..1 multiplier (seams, grime, streaks) shared with the camo schemes
  // one low-frequency blotch field reused for the skin's dirt mottling and every camo scheme (noise is the slow part)
  const camoA = tileFbm(1024, 4, 4, 300), camoB = tileFbm(1024, 8, 3, 301);
  {
    const s = 1024, r = makeRng(42);
    const { c, g } = makeCanvas(s);
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, s, s);
    const { c: cr, g: gr } = makeCanvas(s); // roughness: three.js reads the GREEN channel, so draw it grey
    gr.fillStyle = 'rgb(150,150,150)'; gr.fillRect(0, 0, s, s);
    // panels in rows, each its own paint batch: visible tone and gloss differences
    let y = 0;
    const lines = [];
    while (y < s) {
      const hgt = 70 + r() * 150; let x = r() * -60;
      while (x < s) {
        const w = 80 + r() * 230, tone = 234 + (r() - 0.5) * 18, warm = (r() - 0.5) * 4;
        g.fillStyle = `rgb(${tone + warm},${tone},${tone - warm})`; g.fillRect(x, y, w, hgt);
        { const rv = Math.round(130 + (r() - 0.5) * 80); gr.fillStyle = `rgb(${rv},${rv},${rv})`; } gr.fillRect(x, y, w, hgt);
        lines.push([x, y, w, hgt]); x += w;
      }
      y += hgt;
    }
    // touch-up paint: fresher, slightly different grey patches over parts of panels
    for (let i = 0; i < 46; i++) {
      const [x0, y0, w0, h0] = lines[Math.floor(r() * lines.length)];
      const pw = w0 * (0.25 + r() * 0.6), ph = h0 * (0.25 + r() * 0.6), px = x0 + r() * (w0 - pw), py = y0 + r() * (h0 - ph);
      const t = 220 + r() * 30;
      g.fillStyle = `rgba(${t},${t + 2},${t + 4},0.32)`; g.fillRect(px, py, pw, ph);
      gr.fillStyle = 'rgba(95,95,95,0.6)'; gr.fillRect(px, py, pw, ph); // newer paint is glossier
    }
    // grime collects along the seams: soft dark halo first, the crisp seam goes into the height map below
    g.strokeStyle = 'rgba(60,60,60,0.10)'; g.lineWidth = 9;
    for (const [x, yy, w, hh] of lines) g.strokeRect(x, yy, w, hh);
    g.strokeStyle = 'rgba(50,50,50,0.12)'; g.lineWidth = 4;
    for (const [x, yy, w, hh] of lines) g.strokeRect(x, yy, w, hh);
    // oil and exhaust streaks running aft (+v), some long and faint, some short and dark
    for (let i = 0; i < 140; i++) {
      const sx = r() * s, sy = r() * s, len = 40 + r() * 320, wd = 1.5 + r() * 9;
      const grd = g.createLinearGradient(0, sy, 0, sy + len);
      const a0 = 0.03 + r() * 0.09;
      grd.addColorStop(0, `rgba(70,66,60,${a0})`); grd.addColorStop(1, 'rgba(70,66,60,0)');
      g.fillStyle = grd; g.fillRect(sx, sy, wd, len);
      gr.fillStyle = `rgba(200,200,200,${a0 * 1.5})`; gr.fillRect(sx, sy, wd, len); // grime is matte
    }
    // small stencils / access hatches: light and dark rectangles
    for (let i = 0; i < 70; i++) {
      const w = 6 + r() * 26, h = 3 + r() * 8, x = r() * s, yy = r() * s, dark = r() < 0.6;
      g.fillStyle = dark ? 'rgba(40,40,40,0.35)' : 'rgba(255,255,255,0.35)'; g.fillRect(x, yy, w, h);
    }
    // large-scale mottling (dirt, fading) multiplied over everything
    const ad = g.getImageData(0, 0, s, s), mot = camoB, fine = tileFbm(s, 48, 3, 4343);
    // panel seams + fasteners into a height map
    const { c: ch, g: gh } = makeCanvas(s);
    gh.fillStyle = '#fff'; gh.fillRect(0, 0, s, s);
    gh.strokeStyle = '#000'; gh.lineWidth = 2.2;
    for (const [x, yy, w, hh] of lines) gh.strokeRect(x + 0.5, yy + 0.5, w, hh);
    gh.fillStyle = '#3a3a3a';
    for (const [x, yy, w, hh] of lines) {
      if (r() < 0.65) { for (let k = 6; k < w - 4; k += 10) { gh.fillRect(x + k, yy + 5, 2, 2); gh.fillRect(x + k, yy + hh - 6, 2, 2); } }
      if (r() < 0.5) { for (let k = 6; k < hh - 4; k += 10) { gh.fillRect(x + 5, yy + k, 2, 2); gh.fillRect(x + w - 6, yy + k, 2, 2); } }
      if (r() < 0.16) { gh.strokeStyle = '#222'; gh.lineWidth = 1.5; gh.strokeRect(x + w * 0.3, yy + hh * 0.3, w * 0.25, hh * 0.3); gh.strokeStyle = '#000'; gh.lineWidth = 2.2; }
    }
    const hd = gh.getImageData(0, 0, s, s).data, hf = new Float32Array(s * s);
    for (let i = 0; i < s * s; i++) hf[i] = hd[i * 4] / 255;
    skinShade = new Float32Array(s * s);
    for (let i = 0; i < s * s; i++) {
      const k = (0.8 + 0.2 * hf[i]) * (0.9 + 0.12 * mot[i]) * (0.96 + 0.05 * fine[i]);
      ad.data[i * 4] = Math.min(255, ad.data[i * 4] * k); ad.data[i * 4 + 1] = Math.min(255, ad.data[i * 4 + 1] * k); ad.data[i * 4 + 2] = Math.min(255, ad.data[i * 4 + 2] * k);
      // camo schemes take the seams, fasteners and grime, but not the per-panel tones (those turn camo into squares)
      skinShade[i] = (0.84 + 0.16 * hf[i]) * (0.92 + 0.1 * mot[i]) * (0.97 + 0.04 * fine[i]);
    }
    // streaks and stencils, softened, also go onto the camo
    { const sd = makeCanvas(s); sd.g.fillStyle = '#fff'; sd.g.fillRect(0, 0, s, s); const rs = makeRng(77);
      for (let i = 0; i < 110; i++) { const sx = rs() * s, sy = rs() * s, len = 40 + rs() * 300, wd = 2 + rs() * 8, a0 = 0.04 + rs() * 0.08; const grd = sd.g.createLinearGradient(0, sy, 0, sy + len); grd.addColorStop(0, `rgba(60,60,60,${a0})`); grd.addColorStop(1, 'rgba(60,60,60,0)'); sd.g.fillStyle = grd; sd.g.fillRect(sx, sy, wd, len); }
      const sdd = sd.g.getImageData(0, 0, s, s).data; for (let i = 0; i < s * s; i++) skinShade[i] *= sdd[i * 4] / 255; }
    g.putImageData(ad, 0, 0);
    TEX.panel = canvasTex(c, { srgb: true });
    TEX.panelN = dataTex(normalFromHeight(hf, s, 1.4), s);
    TEX.panelR = canvasTex(cr);
  }
  // camo schemes at the skin's resolution, carrying its seams, touch-ups and grime
  // one blotch field shared by every scheme (each reads it at its own offset/threshold): generating noise is the slow part
  const camoTex = (colors, cuts, shift, flip = false, tint = [1, 1, 1]) => {
    const s = 1024, a = camoA, b = camoB;
    const out = new Uint8Array(s * s * 4);
    for (let i = 0; i < s * s; i++) {
      const x = i & 1023, y = i >> 10, j = (((y + shift) & 1023) << 10) | ((flip ? 1023 - x : x + shift) & 1023);
      const v = a[j] * 0.72 + b[j] * 0.28;
      let t = 0; while (t < cuts.length && v > cuts[t]) t++;
      const col = colors[t], k = skinShade[i];
      out[i * 4] = Math.min(255, col[0] * k * tint[0]); out[i * 4 + 1] = Math.min(255, col[1] * k * tint[1]); out[i * 4 + 2] = Math.min(255, col[2] * k * tint[2]); out[i * 4 + 3] = 255;
    }
    return dataTex(out, s, s, { srgb: true });
  };
  // coastal wing: three-tone blue-grey (Flanker style)
  TEX.camo = camoTex([[205, 214, 224], [150, 170, 196], [108, 128, 156]], [0.45, 0.56], 0);
  // F-22 "Have Glass": two close greys in big soft-edged blotches (navy greyer, coastal slightly blue)
  TEX.raptor = camoTex([[124, 130, 136], [100, 105, 111]], [0.5], 397);
  TEX.raptorC = camoTex([[120, 128, 140], [96, 103, 115]], [0.5], 611, true);
  // ---- ground surfaces ----
  TEX.grass = dataTex(grassTex(S), S, S, { srgb: true });
  TEX.forest = dataTex(canopyTex(S), S, S, { srgb: true });
  TEX.rock = dataTex(rockTex(S), S, S, { srgb: true });
  TEX.sand = dataTex(sandTex(S), S, S, { srgb: true });
  TEX.dirt = dataTex(colorNoise(S, 20, 5, 505, [92, 78, 58], [140, 122, 92], 1.6, (t, i) => t * (0.86 + 0.28 * _speck(i))), S, S, { srgb: true });
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
