// The face engine, in its own small process (started by faces.mjs, at below-normal priority, closed when idle), so the
// models' memory never sits inside Dayspring itself. It gets a picture's RGB pixels and answers with each face's place
// (0..1 of the picture), its 5 points, and a 128-number fingerprint (SFace), L2-normalised. It never learns who anyone
// is: matching happens in faces.mjs, only against the owner's own photos and the people they named.
//   in:  { id, cmd: "faces", w, h, rgb: Buffer }   { id, cmd: "mem" }
//   out: { id, faces: [{ box: [x, y, w, h], score, kps: [10 numbers 0..1], emb: base64 Float32 }] }  or { id, error }
import { pathToFileURL } from "node:url";

const P = JSON.parse(process.env.DAYSPRING_FACE_PATHS || "{}");
let ort = null, det = null, rec = null;
async function load() {
  if (det && rec) return;
  ort = await import(pathToFileURL(P.ort).href);
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  const opts = { executionProviders: ["wasm"], graphOptimizationLevel: "all", logSeverityLevel: 3 };
  det = await ort.InferenceSession.create(P.detect, opts);
  rec = await ort.InferenceSession.create(P.embed, opts);
}

const SIZE = 640;                                     // YuNet 2023mar takes a fixed 640×640
// the picture, shrunk to fit 640×640 (top-left, the rest black), as BGR planes 0..255
function detectInput(rgb, w, h) {
  const s = Math.min(SIZE / w, SIZE / h), nw = Math.round(w * s), nh = Math.round(h * s);
  const data = new Float32Array(3 * SIZE * SIZE), plane = SIZE * SIZE;
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, (y + 0.5) / s - 0.5);
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, (x + 0.5) / s - 0.5);
      const [r, g, b] = sample(rgb, w, h, sx, sy);
      const o = y * SIZE + x;
      data[o] = b; data[plane + o] = g; data[2 * plane + o] = r;
    }
  }
  return { tensor: new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]), scale: s };
}
// bilinear sample → [r, g, b]
function sample(rgb, w, h, x, y) {
  x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = rgb[(y0 * w + x0) * 3 + c], b = rgb[(y0 * w + x1) * 3 + c], d = rgb[(y1 * w + x0) * 3 + c], e = rgb[(y1 * w + x1) * 3 + c];
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
  return out;
}

// YuNet's outputs → faces (in 640-space), as OpenCV's FaceDetectorYN decodes them
function decode(o, { threshold = 0.8 } = {}) {
  const faces = [];
  for (const s of [8, 16, 32]) {
    const cols = SIZE / s, rows = SIZE / s;
    const cls = o[`cls_${s}`].data, obj = o[`obj_${s}`].data, bbox = o[`bbox_${s}`].data, kps = o[`kps_${s}`].data;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < threshold) continue;
      const cx = (c + bbox[i * 4]) * s, cy = (r + bbox[i * 4 + 1]) * s, bw = Math.exp(bbox[i * 4 + 2]) * s, bh = Math.exp(bbox[i * 4 + 3]) * s;
      const pts = []; for (let n = 0; n < 5; n++) pts.push((kps[i * 10 + 2 * n] + c) * s, (kps[i * 10 + 2 * n + 1] + r) * s);
      faces.push({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, score, kps: pts });
    }
  }
  faces.sort((a, b) => b.score - a.score);
  const keep = [];
  const iou = (a, b) => { const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h); const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / (a.w * a.h + b.w * b.h - i); };
  for (const f of faces) if (keep.every((k) => iou(k, f) < 0.3)) keep.push(f);
  return keep.slice(0, 30);
}

// Line the face up with the standard 112×112 template (the eyes, nose and mouth corners where SFace expects them)
const TEMPLATE = [38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041];
function align(rgb, w, h, pts) {
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let n = 0; n < 5; n++) { msx += pts[2 * n]; msy += pts[2 * n + 1]; mdx += TEMPLATE[2 * n]; mdy += TEMPLATE[2 * n + 1]; }
  msx /= 5; msy /= 5; mdx /= 5; mdy /= 5;
  let num1 = 0, num2 = 0, den = 0;
  for (let n = 0; n < 5; n++) {
    const sx = pts[2 * n] - msx, sy = pts[2 * n + 1] - msy, dx = TEMPLATE[2 * n] - mdx, dy = TEMPLATE[2 * n + 1] - mdy;
    num1 += sx * dx + sy * dy; num2 += sx * dy - sy * dx; den += sx * sx + sy * sy;
  }
  const a = num1 / den, b = num2 / den, k = 1 / (a * a + b * b);
  const data = new Float32Array(3 * 112 * 112), plane = 112 * 112;
  for (let v = 0; v < 112; v++) for (let u = 0; u < 112; u++) {
    const qx = u - mdx, qy = v - mdy;
    const x = k * (a * qx + b * qy) + msx, y = k * (-b * qx + a * qy) + msy;
    const [r, g, bl] = sample(rgb, w, h, x, y);
    const o = v * 112 + u;
    data[o] = r; data[plane + o] = g; data[2 * plane + o] = bl;           // SFace takes RGB, 0..255
  }
  return new ort.Tensor("float32", data, [1, 3, 112, 112]);
}

async function faces({ w, h, rgb }) {
  await load();
  const px = Buffer.isBuffer(rgb) ? rgb : Buffer.from(rgb);
  const { tensor, scale } = detectInput(px, w, h);
  const out = await det.run({ [det.inputNames[0]]: tensor });
  const found = decode(out).filter((f) => f.w / scale >= 14);
  const result = [];
  for (const f of found) {
    const pts = f.kps.map((v) => v / scale);
    const e = await rec.run({ [rec.inputNames[0]]: align(px, w, h, pts) });
    const v = Float32Array.from(Object.values(e)[0].data);
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= n;
    const bx = f.x / scale, by = f.y / scale, bw = f.w / scale, bh = f.h / scale;
    result.push({ box: [bx / w, by / h, bw / w, bh / h].map((z) => Math.round(Math.max(0, z) * 10000) / 10000), score: Math.round(f.score * 1000) / 1000,
      kps: pts.map((z, i) => Math.round((z / (i % 2 ? h : w)) * 10000) / 10000), emb: Buffer.from(v.buffer).toString("base64") });
  }
  return result;
}

process.on("message", async (m) => {
  try {
    if (m.cmd === "faces") process.send({ id: m.id, faces: await faces(m) });
    else if (m.cmd === "mem") process.send({ id: m.id, rss: process.memoryUsage().rss });
    else if (m.cmd === "bye") process.exit(0);
  } catch (e) { process.send({ id: m.id, error: String(e?.message ?? e).slice(0, 300) }); }
});
process.on("disconnect", () => process.exit(0));
