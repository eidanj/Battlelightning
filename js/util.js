// Small math helpers, seeded RNG and fast value/gradient noise shared by every module.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (cur, target, lambda, dt) => target + (cur - target) * Math.exp(-lambda * dt);
export const sign = (v) => (v < 0 ? -1 : 1);
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const approach = (cur, target, rate) => (cur < target ? Math.min(target, cur + rate) : Math.max(target, cur - rate));

// mulberry32 seeded RNG
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}
export const rand = Math.random;
export const randRange = (a, b) => a + (b - a) * Math.random();
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---- 2D gradient noise (Perlin-style) with a fixed permutation ----
const perm = new Uint8Array(512);
const GX = new Float32Array(512), GY = new Float32Array(512);
{
  const r = makeRng(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; const a = r() * Math.PI * 2; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const aa = perm[X + perm[Y]], ab = perm[X + perm[Y + 1]], ba = perm[X + 1 + perm[Y]], bb = perm[X + 1 + perm[Y + 1]];
  const u = fade(xf), v = fade(yf);
  const n00 = GX[aa] * xf + GY[aa] * yf, n10 = GX[ba] * (xf - 1) + GY[ba] * yf;
  const n01 = GX[ab] * xf + GY[ab] * (yf - 1), n11 = GX[bb] * (xf - 1) + GY[bb] * (yf - 1);
  const x1 = n00 + (n10 - n00) * u, x2 = n01 + (n11 - n01) * u;
  return (x1 + (x2 - x1) * v) * 1.414;
}
export function fbm2(x, y, oct = 5, lac = 2.0, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f + i * 17.3, y * f - i * 9.1); n += a; a *= gain; f *= lac; }
  return s / n;
}
export function ridge2(x, y, oct = 5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(noise2(x * f + i * 31.7, y * f + i * 7.7)); s += a * v * v; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// tileable value noise on a grid (for canvas textures)
export function tileNoise(size, cells, seed = 1) {
  const r = makeRng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fade(fx - x0), ty = fade(fy - y0);
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
    out[y * size + x] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }
  return out;
}
export function tileFbm(size, baseCells, oct = 4, seed = 1) {
  const out = new Float32Array(size * size);
  let a = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    const l = tileNoise(size, baseCells << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += l[i] * a;
    n += a; a *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

export function fmtTime(s) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// tiny event bus
export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { const a = this._h[ev]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(ev, ...args) { const a = this._h[ev]; if (a) for (const fn of a.slice()) fn(...args); }
}
