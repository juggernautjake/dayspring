// Synthetic printer-camera pictures for the printer tests (made fresh each run; nothing personal, no real camera).
// A textured print bed seen by a camera (PEI-style speckle, a light falloff, a darker frame around it), and what can be
// on it: a finished part, a leftover purge line, a growing print, spaghetti, stringing between two towers.
//   scene({ seed, exposure, noise, objects: [...], purge, strings, spaghetti }) → JPEG Buffer (640×360)
import jpeg from "jpeg-js";

const W = 640, H = 360;
export const BED = { x0: 80, y0: 60, x1: 560, y1: 330 };            // where the bed is in the picture
export const ROI = { x: BED.x0 / W, y: BED.y0 / H, w: (BED.x1 - BED.x0) / W, h: (BED.y1 - BED.y0) / H };
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

export function scene({ seed = 1, exposure = 1, noise = 3, texSeed = 7, objects = [], purge = null, strings = 0, spaghetti = 0, stringSeed = 3 } = {}) {
  const img = new Float32Array(W * H * 3);
  const tex = rng(texSeed), n = rng(seed);
  // the bed texture is the same every time (it's the same bed); the camera noise changes per picture
  const speck = new Float32Array(W * H); for (let i = 0; i < speck.length; i++) speck[i] = (tex() - 0.5) * 22;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const onBed = x >= BED.x0 && x < BED.x1 && y >= BED.y0 && y < BED.y1;
    const fall = 1 - 0.25 * (((x - W / 2) / W) ** 2 + ((y - H / 2) / H) ** 2) * 4;
    let g = onBed ? 118 + speck[y * W + x] + ((x - BED.x0) % 40 === 0 || (y - BED.y0) % 40 === 0 ? 10 : 0) : 38 + speck[y * W + x] * 0.3;
    g *= fall;
    img[i] = g * 0.95; img[i + 1] = g * 0.9; img[i + 2] = g * 0.8;   // warm gold PEI
  }
  const put = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (Math.round(y) * W + Math.round(x)) * 3; img[i] = r; img[i + 1] = g; img[i + 2] = b; };
  for (const o of objects) {
    for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) {
      const shade = 0.7 + 0.3 * ((x - o.x) / o.w) - 0.15 * (((y - o.y) % 6) < 1 ? 1 : 0);   // layer lines
      put(x, y, o.color[0] * shade, o.color[1] * shade, o.color[2] * shade);
    }
  }
  if (purge) for (let x = purge.x; x < purge.x + purge.len; x++) for (let t = 0; t < (purge.thick ?? 3); t++) put(x, purge.y + t + Math.sin(x / 9) * 1.5, ...(purge.color ?? [40, 170, 60]));
  // stringing: thin wisps between the two first objects
  if (strings && objects.length >= 2) {
    const a = objects[0], b = objects[1], r = rng(stringSeed);
    for (let k = 0; k < strings; k++) {
      const y0 = a.y + r() * a.h, y1 = b.y + r() * b.h, sag = 6 + r() * 14;
      for (let t = 0; t <= 1; t += 0.004) { const x = a.x + a.w + t * (b.x - a.x - a.w), y = y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * sag; put(x, y, 200, 200, 200); }
    }
  }
  // spaghetti: tangled curves spreading over the bed
  if (spaghetti) {
    const r = rng(1234);
    for (let k = 0; k < spaghetti; k++) {
      let x = 260 + r() * 120, y = 140 + r() * 90, ang = r() * 6.28;
      const col = [60 + r() * 40, 90 + r() * 60, 200 + r() * 55];
      for (let s = 0; s < 260; s++) { ang += (r() - 0.5) * 0.7; x += Math.cos(ang) * 1.6; y += Math.sin(ang) * 1.6; for (let d = 0; d < 2; d++) put(x + d, y, ...col); }
    }
  }
  const out = Buffer.alloc(W * H * 4);
  for (let p = 0, i = 0; p < W * H; p++, i += 3) {
    const nn = (n() - 0.5) * 2 * noise;
    out[p * 4] = Math.max(0, Math.min(255, img[i] * exposure + nn)); out[p * 4 + 1] = Math.max(0, Math.min(255, img[i + 1] * exposure + nn)); out[p * 4 + 2] = Math.max(0, Math.min(255, img[i + 2] * exposure + nn)); out[p * 4 + 3] = 255;
  }
  return jpeg.encode({ data: out, width: W, height: H }, 85).data;
}
const BLUE = [50, 90, 210], ORANGE = [230, 120, 30], GREY = [150, 150, 160];
// the standard fixtures
export const fixtures = {
  empty: () => scene({ seed: 1 }),
  clear: () => scene({ seed: 2, exposure: 1.06, noise: 5 }),                                  // the same empty bed: new noise, a bit brighter
  object: () => scene({ seed: 3, objects: [{ x: 290, y: 160, w: 60, h: 50, color: BLUE }] }),  // a part left on the bed
  smallObject: () => scene({ seed: 4, objects: [{ x: 420, y: 250, w: 16, h: 14, color: ORANGE }] }),
  purge: () => scene({ seed: 5, purge: { x: 100, y: 300, len: 150, thick: 3 } }),            // the purge line left at the front
};
// print sequences: n pictures, one per check
export function goodPrint(n = 6) { return Array.from({ length: n }, (_, k) => scene({ seed: 10 + k, objects: k ? [{ x: 290, y: 200 - k * 8, w: 60, h: 10 + k * 8, color: BLUE }] : [] })); }
export function spaghettiPrint(n = 6) { return Array.from({ length: n }, (_, k) => scene({ seed: 20 + k, objects: k ? [{ x: 290, y: 190, w: 60, h: 12 + Math.min(k, 2) * 4, color: BLUE }] : [], spaghetti: k >= 3 ? (k - 2) * 14 : 0 })); }
export function stringingPrint(n = 6) { return Array.from({ length: n }, (_, k) => scene({ seed: 30 + k, objects: k ? [{ x: 240, y: 200 - k * 8, w: 30, h: 10 + k * 8, color: GREY }, { x: 360, y: 200 - k * 8, w: 30, h: 10 + k * 8, color: GREY }] : [], strings: k >= 3 ? (k - 2) * 5 : 0 })); }
export function detachedPrint(n = 6) { return Array.from({ length: n }, (_, k) => scene({ seed: 40 + k, objects: k && k < 4 ? [{ x: 290, y: 200 - k * 8, w: 60, h: 10 + k * 8, color: BLUE }] : [] })); }
