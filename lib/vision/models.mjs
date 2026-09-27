// The face models and the small engine that runs them, downloaded only when the owner turns on "Recognise faces in my
// photos" (and says yes to the download, with its size shown). Nothing here is part of the normal install.
//
//   YuNet (face_detection_yunet_2023mar.onnx, 0.2 MB)   finds faces and 5 points on each      MIT licence      OpenCV Zoo
//   SFace (face_recognition_sface_2021dec.onnx, 37 MB)  a face's 128-number "fingerprint"     Apache-2.0       OpenCV Zoo
//   ONNX Runtime Web 1.30.0 (npm, WebAssembly, CPU)     runs them in Node, no GPU, no build   MIT licence      Microsoft
//
// Every file is checked before it's used: the models by SHA-256, the npm packages by the registry's own SHA-512
// ("integrity"). Only the four files the engine needs are kept from the npm package. Where: data/vision-cache/ (or
// DAYSPRING_VISION_CACHE), never exported, removed by "Delete all face data".
//   status() · install({ onProgress }) · remove() · paths() · SIZE
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const cacheDir = () => process.env.DAYSPRING_VISION_CACHE || join(ROOT, "data", "vision-cache");
// OpenCV Zoo on GitHub, pinned to one commit (47534e2); the files are Git LFS, served from media.githubusercontent.com
export const MODELS = {
  detect: { file: "face_detection_yunet_2023mar.onnx", url: "https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/face_detection_yunet_2023mar.onnx", sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4", bytes: 232589, licence: "MIT (OpenCV Zoo, YuNet)" },
  embed: { file: "face_recognition_sface_2021dec.onnx", url: "https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface/face_recognition_sface_2021dec.onnx", sha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79", bytes: 38696353, licence: "Apache-2.0 (OpenCV Zoo, SFace)" },
};
export const RUNTIME = [
  { name: "onnxruntime-web", version: "1.30.0", url: "https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz", integrity: "sha512-q0y+JrrtukXSzsBWEMccVfqX25LRmosXHF+CaRJmg8pZClzcV7svNc4rKY3jL02Vb7QmRMDs1SigqR4CXAfKYQ==", bytes: 33106585,
    keep: ["package/package.json", "package/dist/ort.node.min.mjs", "package/dist/ort-wasm-simd-threaded.mjs", "package/dist/ort-wasm-simd-threaded.wasm"], licence: "MIT (Microsoft)" },
  { name: "onnxruntime-common", version: "1.30.0", url: "https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-1.30.0.tgz", integrity: "sha512-7fdVWjAID1dVhH/G8qK3APARunV4VkBFoCQAP7qp4Wkab0mrorvmc+sqiT+mKXOzDqdjN5j+/Z9nb4gzNPWcyA==", bytes: 0,
    keep: null, licence: "MIT (Microsoft)" },
];
// what the owner is told before saying yes
export const SIZE = { downloadMB: 72, diskMB: 54 };

export function paths() {
  const d = cacheDir();
  return { dir: d, detect: join(d, "models", MODELS.detect.file), embed: join(d, "models", MODELS.embed.file), ort: join(d, "runtime", "node_modules", "onnxruntime-web", "dist", "ort.node.min.mjs") };
}
export function status() {
  const p = paths();
  const have = { detect: existsSync(p.detect), embed: existsSync(p.embed), runtime: existsSync(p.ort) && existsSync(join(p.dir, "runtime", "node_modules", "onnxruntime-common", "package.json")) };
  let marker = null; try { marker = JSON.parse(readFileSync(join(p.dir, "installed.json"), "utf8")); } catch { /* not yet */ }
  return { installed: have.detect && have.embed && have.runtime && Boolean(marker), have, at: marker?.at ?? null, size: SIZE, dir: p.dir, installing: Boolean(installing), progress: installing ? progress : null };
}

async function download(url, dest, onChunk) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000), redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`The download didn't work (${res.status}).`);
  mkdirSync(dirname(dest), { recursive: true });
  const out = createWriteStream(dest);
  try {
    for await (const chunk of res.body) { onChunk?.(chunk.length); if (!out.write(chunk)) await new Promise((r) => out.once("drain", r)); }
  } finally { await new Promise((r) => out.end(r)); }
}
const hashFile = (file, algo, enc = "hex") => new Promise((resolve, reject) => { const h = createHash(algo); createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest(enc))).on("error", reject); });

// A small streaming reader for npm's .tgz files: keeps only the wanted entries (the full package unpacks to 145 MB).
function extractTgz(file, destDir, keep) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0), entry = null, got = [];
    const take = (name) => (keep ? keep.includes(name) : true);
    const gz = createReadStream(file).pipe(createGunzip());
    const safe = (name) => !name.split("/").some((x) => x === ".." || x === "") && !/^[\\/]|:/.test(name);
    gz.on("data", (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      for (;;) {
        if (!entry) {
          if (pending.length < 512) return;
          const h = pending.subarray(0, 512);
          if (h.every((b) => b === 0)) { pending = pending.subarray(512); continue; }
          const name = h.subarray(0, 100).toString("utf8").replace(/\0.*$/s, ""), prefix = h.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
          const size = parseInt(h.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
          const type = String.fromCharCode(h[156] || 48);
          const full = prefix ? `${prefix}/${name}` : name;
          entry = { name: full, size, type, parts: [], left: size, keep: (type === "0" || type === "\0") && safe(full) && take(full) };
          pending = pending.subarray(512);
        }
        if (entry.left > 0) {
          if (!pending.length) return;
          const n = Math.min(entry.left, pending.length);
          if (entry.keep) entry.parts.push(Buffer.from(pending.subarray(0, n)));
          pending = pending.subarray(n); entry.left -= n;
          if (entry.left > 0) return;
        }
        const pad = (512 - (entry.size % 512)) % 512;
        if (pending.length < pad) return;
        pending = pending.subarray(pad);
        if (entry.keep) { const rel = entry.name.replace(/^package\//, ""); const dest = join(destDir, ...rel.split("/")); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, Buffer.concat(entry.parts)); got.push(rel); }
        entry = null;
      }
    });
    gz.on("end", () => resolve(got));
    gz.on("error", reject);
  });
}

let installing = null, progress = { done: 0, total: 0, step: "" };
export function install({ onProgress } = {}) {
  if (installing) return installing;
  installing = (async () => {
    const p = paths(), tmp = join(p.dir, "downloading");
    rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
    progress = { done: 0, total: MODELS.detect.bytes + MODELS.embed.bytes + RUNTIME.reduce((a, r) => a + (r.bytes || 600_000), 0), step: "starting" };
    const tick = (n) => { progress.done += n; onProgress?.({ ...progress }); };
    try {
      for (const [k, m] of Object.entries(MODELS)) {
        progress.step = k === "detect" ? "face finder" : "face fingerprint model";
        const f = join(tmp, m.file);
        await download(m.url, f, tick);
        const got = await hashFile(f, "sha256");
        if (got !== m.sha256) throw new Error(`The ${progress.step} didn't match its checksum, so it wasn't used.`);
      }
      const rtTmp = join(tmp, "runtime", "node_modules");
      for (const r of RUNTIME) {
        progress.step = r.name;
        const f = join(tmp, `${r.name}.tgz`);
        await download(r.url, f, tick);
        const [algo, want] = r.integrity.split("-");
        if ((await hashFile(f, algo, "base64")) !== want) throw new Error(`${r.name} didn't match its checksum, so it wasn't used.`);
        const got = await extractTgz(f, join(rtTmp, r.name), r.keep);
        if (r.keep && got.length !== r.keep.length) throw new Error(`${r.name} was missing files.`);
        rmSync(f, { force: true });
      }
      // all good: move into place
      mkdirSync(join(p.dir, "models"), { recursive: true });
      for (const m of Object.values(MODELS)) { rmSync(join(p.dir, "models", m.file), { force: true }); renameSync(join(tmp, m.file), join(p.dir, "models", m.file)); }
      rmSync(join(p.dir, "runtime"), { recursive: true, force: true });
      renameSync(join(tmp, "runtime"), join(p.dir, "runtime"));
      writeFileSync(join(p.dir, "installed.json"), JSON.stringify({ at: new Date().toISOString(), models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { file: m.file, sha256: m.sha256, licence: m.licence }])), runtime: RUNTIME.map((r) => ({ name: r.name, version: r.version, licence: r.licence })) }, null, 2));
      writeFileSync(join(p.dir, "LICENCES.txt"), "Face models and engine used by Dayspring, downloaded on this computer when face recognition was turned on:\n"
        + Object.values(MODELS).map((m) => `  ${m.file}: ${m.licence} — ${m.url}`).join("\n") + "\n" + RUNTIME.map((r) => `  ${r.name}@${r.version}: ${r.licence} — ${r.url}`).join("\n") + "\n");
      progress.step = "done";
      return { ...status(), installing: false, progress: null };
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  })().finally(() => { installing = null; });
  return installing;
}
export function remove() { rmSync(cacheDir(), { recursive: true, force: true }); return status(); }
export const sizeOnDisk = () => { try { const p = paths(); return [p.detect, p.embed, p.ort].reduce((a, f) => a + (existsSync(f) ? statSync(f).size : 0), 0); } catch { return 0; } };
