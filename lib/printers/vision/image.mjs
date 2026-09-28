// Pictures from a printer's camera, as small grey images to compare (pure JavaScript: jpeg-js, no native parts).
//   decode(jpeg, { width }) → { w, h, px: Float32Array (0–255 grey) }   (box-filtered down to `width`)
//   crop(img, roi)  roi = { x, y, w, h } as fractions of the picture (the bed area the owner dragged)
//   compare(a, b, { block }) → { changed: fraction of blocks, blocks, blobs: [{ n, box }], maxBlob, outside, spread, map }
// A block counts as changed when its structure differs (SSIM on brightness-normalised pixels, so a lamp being brighter or
// the camera's exposure drifting isn't "something on the bed") or when enough of its pixels differ strongly (a thin
// purge line or a string is only a few pixels wide).
import jpeg from "jpeg-js";

export function decode(buf, { width = 192 } = {}) {
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512, maxResolutionInMP: 60 });
  const W = raw.width, H = raw.height, w = Math.max(8, Math.min(width, W)), h = Math.max(8, Math.round((H / W) * w));
  const px = new Float32Array(w * h), cnt = new Float32Array(w * h);
  const sx = w / W, sy = h / H, d = raw.data;
  for (let y = 0; y < H; y++) {
    const ty = Math.min(h - 1, Math.floor(y * sy)), row = y * W * 4;
    for (let x = 0; x < W; x++) {
      const i = row + x * 4, t = ty * w + Math.min(w - 1, Math.floor(x * sx));
      px[t] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; cnt[t]++;
    }
  }
  for (let i = 0; i < px.length; i++) px[i] /= cnt[i] || 1;
  return { w, h, px };
}
export function crop(img, roi) {
  if (!roi) return img;
  const x0 = Math.max(0, Math.floor(roi.x * img.w)), y0 = Math.max(0, Math.floor(roi.y * img.h));
  const w = Math.max(4, Math.min(img.w - x0, Math.round(roi.w * img.w))), h = Math.max(4, Math.min(img.h - y0, Math.round(roi.h * img.h)));
  const px = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = img.px[(y0 + y) * img.w + x0 + x];
  return { w, h, px };
}
function norm(img) {
  let s = 0, s2 = 0; const n = img.px.length;
  for (const v of img.px) { s += v; s2 += v * v; }
  const mean = s / n, sd = Math.sqrt(Math.max(1e-6, s2 / n - mean * mean));
  const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = (img.px[i] - mean) / Math.max(sd, 8);
  return { ...img, px: out, mean, sd };
}
// minArea: the smallest group of changed pixels that counts (in pixels at the compared size); smaller specks are camera
// noise. k: how many "noise widths" a pixel must differ by; floor: the least difference that counts, in normalised units.
export const DEFAULTS = { k: 4.5, floor: 0.9, minArea: 10, blur: true };
function blur3(img) {
  const { w, h, px } = img, out = new Float32Array(px.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue; s += px[yy * w + xx] * (dx === 0 && dy === 0 ? 2 : 1); n += dx === 0 && dy === 0 ? 2 : 1; }
    out[y * w + x] = s / n;
  }
  return { ...img, px: out };
}
export function compare(a0, b0, o = {}) {
  const { k, floor, minArea, blur } = { ...DEFAULTS, ...o };
  if (a0.w !== b0.w || a0.h !== b0.h) throw new Error("The pictures are different sizes.");
  const a = norm(blur ? blur3(a0) : a0), b = norm(blur ? blur3(b0) : b0), w = a.w, h = a.h, n = w * h;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.abs(a.px[i] - b.px[i]);
  // the noise level: the median difference (most of the picture is unchanged)
  const sample = Array.from(d.filter((_, i) => i % 7 === 0)).sort((x, y) => x - y);
  const med = sample[Math.floor(sample.length / 2)] ?? 0;
  const tau = Math.max(floor, k * med * 1.4826);
  const mask = new Uint8Array(n); for (let i = 0; i < n; i++) if (d[i] > tau) mask[i] = 1;
  const seen = new Uint8Array(n), blobs = []; let changedPx = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i]; seen[i] = 1; let cnt = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w; cnt++;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    }
    if (cnt >= minArea) { blobs.push({ n: cnt, box: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h], long: Math.max(x1 - x0 + 1, y1 - y0 + 1) / w }); changedPx += cnt; }
  }
  blobs.sort((p, q) => q.n - p.n);
  const outside = changedPx ? (changedPx - blobs.slice(0, 2).reduce((s2, x) => s2 + x.n, 0)) / changedPx : 0;
  let spread = 0;
  if (changedPx) { const bx0 = Math.min(...blobs.map((x) => x.box[0])), by0 = Math.min(...blobs.map((x) => x.box[1])), bx1 = Math.max(...blobs.map((x) => x.box[2])), by1 = Math.max(...blobs.map((x) => x.box[3])); spread = ((bx1 - bx0) * (by1 - by0) * n) / changedPx; }
  return { changed: changedPx / n, pixels: changedPx, total: n, blobs: blobs.slice(0, 30), blobCount: blobs.length, maxBlob: blobs[0]?.n ?? 0, maxBlobShare: (blobs[0]?.n ?? 0) / n, longest: Math.max(0, ...blobs.map((x) => x.long)), outside, spread, noise: med, threshold: tau, lighting: { a: a.mean, b: b.mean } };
}
