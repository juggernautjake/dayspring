// Motion, found on this computer (no AI): each picture is decoded, shrunk to a small grey grid, and compared with what
// the camera normally sees. Only the parts inside the region of interest count, single stray pixels (sensor noise, rain)
// are ignored, and a whole-picture change (a light turned on, a cloud, the camera switching to night vision) resets the
// comparison instead of counting as motion.
//   gray(jpeg, { width }) → { w, h, px: Float32Array }       (0–255)
//   createDetector({ sensitivity 0–100, roi: [{x,y,w,h}] }) → { check(jpegOrGray) → result, reset(), set(opts) }
//     result: { motion, score (share of the watched area that changed), box: {x,y,w,h} (0–1), shape: tall|wide|square|null,
//               lighting (a whole-picture change), first (nothing to compare with yet) }
import jpeg from "jpeg-js";

export const GRID_W = 96;
// the picture as a small grid of colour cells (r, g, b per cell): colour matters, a brown deer on green grass can be
// almost the same grey
export function gray(buf, { width = GRID_W } = {}) {
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 60, maxMemoryUsageInMB: 400, tolerantDecoding: true });
  const W = img.width, H = img.height, d = img.data;
  const w = Math.max(8, Math.min(width, W)), h = Math.max(6, Math.round(w * H / W));
  const px = new Float32Array(w * h * 3), cnt = new Uint32Array(w * h);
  const step = Math.max(1, Math.floor(W / (w * 4)));
  for (let y = 0; y < H; y += step) {
    const gy = Math.min(h - 1, Math.floor(y * h / H)), row = y * W;
    for (let x = 0; x < W; x += step) {
      const i = (row + x) * 4, g = Math.min(w - 1, Math.floor(x * w / W)) + gy * w;
      px[g * 3] += d[i]; px[g * 3 + 1] += d[i + 1]; px[g * 3 + 2] += d[i + 2]; cnt[g]++;
    }
  }
  for (let i = 0; i < cnt.length; i++) { const c = cnt[i] || 1; px[i * 3] /= c; px[i * 3 + 1] /= c; px[i * 3 + 2] /= c; }
  return { w, h, px, srcW: W, srcH: H };
}

// sensitivity 0 (only big, obvious changes) … 100 (the smallest thing)
export const thresholds = (s = 50) => {
  const t = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
  return { pixel: 44 - 26 * t, area: 0.03 * (1 - t) ** 2 + 0.0005, neighbours: t >= 0.8 ? 0 : t >= 0.4 ? 1 : 2, min: t >= 0.8 ? 2 : 3 };
};
const median = (a) => { if (!a.length) return 0; const s = Float32Array.from(a).sort(); return s[Math.floor(s.length / 2)]; };

export function createDetector(opts = {}) {
  let o = { sensitivity: 50, roi: [], ...opts };
  let bg = null, mask = null, size = "";
  const makeMask = (w, h) => {
    const m = new Uint8Array(w * h);
    const rois = (o.roi ?? []).filter((r) => r && r.w > 0 && r.h > 0);
    if (!rois.length) { m.fill(1); return m; }
    for (const r of rois) {
      const x0 = Math.floor(r.x * w), y0 = Math.floor(r.y * h), x1 = Math.ceil((r.x + r.w) * w), y1 = Math.ceil((r.y + r.h) * h);
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) m[y * w + x] = 1;
    }
    return m;
  };
  function check(input) {
    const g = Buffer.isBuffer(input) || input instanceof Uint8Array ? gray(input) : input;
    const { w, h, px } = g;
    if (size !== `${w}x${h}` || !bg) { size = `${w}x${h}`; bg = Float32Array.from(px); mask = makeMask(w, h); return { motion: false, score: 0, box: null, shape: null, lighting: false, first: true }; }
    const th = thresholds(o.sensitivity);
    // the overall shift in each colour (auto exposure, clouds) is taken out first
    const dr = [], dg = [], db = [];
    let watched = 0;
    for (let i = 0; i < w * h; i++) if (mask[i]) { watched++; dr.push(px[i * 3] - bg[i * 3]); dg.push(px[i * 3 + 1] - bg[i * 3 + 1]); db.push(px[i * 3 + 2] - bg[i * 3 + 2]); }
    const sh = [median(dr), median(dg), median(db)];
    const changed = new Uint8Array(w * h);
    let raw = 0;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      const m = Math.max(Math.abs(px[i * 3] - bg[i * 3] - sh[0]), Math.abs(px[i * 3 + 1] - bg[i * 3 + 1] - sh[1]), Math.abs(px[i * 3 + 2] - bg[i * 3 + 2] - sh[2]));
      if (m > th.pixel) { changed[i] = 1; raw++; }
    }
    // a lighting change: a big shift in brightness, or most of the picture changed at once. The comparison starts over.
    const lighting = Math.max(...sh.map(Math.abs)) > 22 || (watched && raw / watched > 0.55);
    if (lighting) { bg = Float32Array.from(px); return { motion: false, score: watched ? raw / watched : 0, box: null, shape: null, lighting: true, first: false }; }
    // noise: a changed cell counts only with enough changed neighbours (fewer needed at high sensitivity)
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!changed[i]) continue;
      const nb = (x > 0 && changed[i - 1]) + (x < w - 1 && changed[i + 1]) + (y > 0 && changed[i - w]) + (y < h - 1 && changed[i + w]);
      if (nb < th.neighbours) continue;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const score = watched ? n / watched : 0;
    const motion = score >= th.area && n >= th.min;
    // the background follows slowly while something is there (so a parked car becomes normal), faster when it's quiet
    const a = motion ? 0.08 : 0.5;
    for (let i = 0; i < px.length; i++) bg[i] = bg[i] * (1 - a) + px[i] * a;
    if (!motion) return { motion: false, score, box: null, shape: null, lighting: false, first: false };
    const box = { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
    // the shape of what moved, in real proportions (a hint only; the AI or the owner decides what it is)
    const ratio = (box.h * g.srcH) / (box.w * g.srcW);
    const shape = ratio > 1.35 ? "tall" : ratio < 0.8 ? "wide" : "square";
    return { motion, score, box, shape, lighting: false, first: false };
  }
  return { check, reset() { bg = null; size = ""; }, set(p) { o = { ...o, ...p }; size = ""; bg = null; } };
}
