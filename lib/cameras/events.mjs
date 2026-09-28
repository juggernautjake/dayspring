// Where camera pictures, clips and events are kept, and how long.
//   <storage>/<cameraId>/<YYYY-MM-DD>/index.jsonl     one line per event or kept still
//   <storage>/<cameraId>/<YYYY-MM-DD>/HHMMSS-xxxx.jpg  the picture;  …-xxxx.mp4 its clip
//   <storage>/<cameraId>/continuous/YYYY-MM-DD_HH-MM-SS.mp4   continuous recording, in segments
// storage = Settings → Cameras → Storage folder (data/cameras by default). Only files Dayspring made (these names) are
// ever deleted here, so a folder the owner also uses is safe.
//   save(camId, jpeg, meta) → record · attachClip(id, file) · update(id, patch) · list({ cam, day, from, to, label, kind, limit })
//   get(id) · remove(id) · days(cam) · recordings({ cam, day }) · fileFor(cam, day, name) · sweep(cams, { capBytes }) · usage()
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import * as config from "./config.mjs";

export const root = () => config.storageDir();
const pad = (n) => String(n).padStart(2, "0");
export const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // local date, never UTC
const hms = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const OURS = /^\d{6}-[a-z0-9]{4,12}(\.thumb)?\.(jpg|mp4)$/;
const CONT = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/;
const ID_RE = /^[\w-]{3,40}$/, DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const safeCam = (c) => { if (!ID_RE.test(String(c))) throw Object.assign(new Error("Bad camera id."), { status: 400 }); return c; };
export const camDir = (cam) => join(root(), safeCam(cam));
const dayDir = (cam, day) => join(camDir(cam), day);
const indexFile = (cam, day) => join(dayDir(cam, day), "index.jsonl");

function readIndex(cam, day) {
  const f = indexFile(cam, day);
  if (!existsSync(f)) return [];
  const out = new Map();
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.deleted) out.delete(r.id); else out.set(r.id, { ...(out.get(r.id) ?? {}), ...r }); } catch { /* a torn line */ }
  }
  return [...out.values()];
}
function append(cam, day, rec) { mkdirSync(dayDir(cam, day), { recursive: true }); appendFileSync(indexFile(cam, day), JSON.stringify(rec) + "\n"); }
// rewrite a day's index without superseded lines (after a sweep)
function compact(cam, day) {
  const recs = readIndex(cam, day), f = indexFile(cam, day);
  if (!recs.length) { rmSync(f, { force: true }); return; }
  const tmp = f + ".tmp"; writeFileSync(tmp, recs.map((r) => JSON.stringify(r)).join("\n") + "\n"); renameSync(tmp, f);
}

// id = <cam>~<day>~<file stem>, so an id says where its record is
export const idOf = (cam, day, stem) => `${cam}~${day}~${stem}`;
export function parseId(id) { const [cam, day, stem] = String(id).split("~"); if (!ID_RE.test(cam ?? "") || !DAY_RE.test(day ?? "") || !/^\d{6}-[a-z0-9]{4,12}$/.test(stem ?? "")) return null; return { cam, day, stem }; }

export function save(cam, jpeg, meta = {}) {
  const at = meta.at ? new Date(meta.at) : new Date();
  const when = isNaN(at) ? new Date() : at;
  const day = dayOf(when), stem = `${hms(when)}-${randomBytes(3).toString("hex")}`;
  mkdirSync(dayDir(cam, day), { recursive: true });
  writeFileSync(join(dayDir(cam, day), stem + ".jpg"), jpeg);
  const rec = { id: idOf(cam, day, stem), cam, day, at: when.toISOString(), kind: meta.kind ?? "event", source: meta.source ?? "schedule", file: stem + ".jpg", clip: null,
    labels: meta.labels ?? [], summary: meta.summary ?? "", motion: meta.motion ?? null, alerted: false, usedAI: Boolean(meta.usedAI), extra: meta.extra ?? null };
  append(cam, day, rec);
  return rec;
}
export function update(id, patch) { const p = parseId(id); if (!p) return null; const cur = readIndex(p.cam, p.day).find((r) => r.id === id); if (!cur) return null; append(p.cam, p.day, { id, ...patch }); return { ...cur, ...patch }; }
export function clipPathFor(id) { const p = parseId(id); return p ? join(dayDir(p.cam, p.day), p.stem + ".mp4") : null; }
export function attachClip(id) { const p = parseId(id); if (!p) return null; return update(id, { clip: p.stem + ".mp4" }); }
export function get(id) { const p = parseId(id); if (!p) return null; return readIndex(p.cam, p.day).find((r) => r.id === id) ?? null; }
export function remove(id) {
  const p = parseId(id); if (!p) return false;
  const r = get(id); if (!r) return false;
  for (const f of [r.file, r.clip].filter(Boolean)) rmSync(join(dayDir(p.cam, p.day), f), { force: true });
  append(p.cam, p.day, { id, deleted: true });
  return true;
}
export function days(cam) {
  const d = camDir(cam); if (!existsSync(d)) return [];
  return readdirSync(d).filter((x) => DAY_RE.test(x)).sort().reverse();
}
export function cams() { const r = root(); if (!existsSync(r)) return []; return readdirSync(r).filter((x) => ID_RE.test(x)); }
const labelHit = (r, want) => !want || (r.labels ?? []).some((l) => l.label === want || (want === "animal" && l.animal) || l.label.includes(want));
export function list({ cam = null, day = null, from = null, to = null, label = null, kind = null, limit = 200 } = {}) {
  const out = [];
  for (const c of cam ? [cam] : cams()) {
    for (const d of day ? [day] : days(c)) {
      if (from && d < dayOf(new Date(from))) continue;
      if (to && d > dayOf(new Date(to))) continue;
      for (const r of readIndex(c, d)) {
        if (from && r.at < new Date(from).toISOString()) continue;
        if (to && r.at > new Date(to).toISOString()) continue;
        if (kind && r.kind !== kind) continue;
        if (!labelHit(r, label)) continue;
        out.push(r);
      }
      if (!day && out.length > limit * 3) break;
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
// a file to serve: only names Dayspring made, only inside the storage folder
export function fileFor(cam, day, name) {
  if (!ID_RE.test(cam) || !(DAY_RE.test(day) || day === "continuous") || !(OURS.test(name) || CONT.test(name))) return null;
  const f = resolve(join(camDir(cam), day, name));
  if (!f.startsWith(resolve(root()) + sep)) return null;
  return existsSync(f) ? f : null;
}
export const continuousDir = (cam) => join(camDir(cam), "continuous");
// the clips of a day: event clips, and continuous segments that start that day
export function recordings({ cam, day = dayOf(new Date()) } = {}) {
  const clips = readIndex(cam, day).filter((r) => r.clip).map((r) => ({ id: r.id, at: r.at, url: `/api/cameras/media/${cam}/${day}/${r.clip}`, thumb: `/api/cameras/media/${cam}/${day}/${r.file}`, labels: r.labels, summary: r.summary, kind: "event" }));
  const segs = [];
  const cd = continuousDir(cam);
  if (existsSync(cd)) for (const f of readdirSync(cd)) {
    if (!CONT.test(f) || !f.startsWith(day)) continue;
    const [d, t] = f.slice(0, -4).split("_"); let size = 0; try { size = statSync(join(cd, f)).size; } catch { /* gone */ }
    segs.push({ at: new Date(`${d}T${t.replace(/-/g, ":")}`).toISOString(), url: `/api/cameras/media/${cam}/continuous/${f}`, size, kind: "continuous", name: f });
  }
  return { cam, day, clips: clips.sort((a, b) => a.at.localeCompare(b.at)), continuous: segs.sort((a, b) => a.at.localeCompare(b.at)), events: readIndex(cam, day).filter((r) => r.kind === "event").map((r) => ({ id: r.id, at: r.at, labels: r.labels, summary: r.summary })) };
}

// ---- retention and the disk limit ----
function ourFiles() {
  const out = [];
  for (const c of cams()) {
    for (const d of [...days(c), "continuous"]) {
      const dir = join(camDir(c), d); if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) { if (!(OURS.test(f) || CONT.test(f))) continue; try { const s = statSync(join(dir, f)); out.push({ cam: c, day: d, name: f, path: join(dir, f), size: s.size, mtime: s.mtimeMs }); } catch { /* gone */ } }
    }
  }
  return out;
}
export function usage() { const fs = ourFiles(); return { bytes: fs.reduce((s, f) => s + f.size, 0), files: fs.length }; }
const stemOf = (name) => name.replace(/(\.thumb)?\.(jpg|mp4)$/, "");
// cams: the camera settings (retention per camera). Removes: files past each camera's days; with the storage over the
// limit, the oldest files (any camera) until it's back under 90% of it. Returns what went.
export function sweep(camList = config.all(), { capBytes = (config.top().diskCapGB ?? 20) * 1e9, now = Date.now() } = {}) {
  const byId = new Map(camList.map((c) => [c.id, c]));
  const gone = []; const touched = new Set();
  const drop = (f, why) => { try { rmSync(f.path, { force: true }); gone.push({ ...f, why }); if (f.day !== "continuous") touched.add(`${f.cam}|${f.day}|${stemOf(f.name)}`); } catch { /* in use: next time */ } };
  let files = ourFiles();
  for (const f of files) {
    const cam = byId.get(f.cam); const days = cam?.retention?.days ?? 14;
    if (now - f.mtime > days * 864e5) drop(f, "age");
  }
  files = files.filter((f) => !gone.includes(f) && existsSync(f.path));
  let total = files.reduce((s, f) => s + f.size, 0);
  if (capBytes > 0 && total > capBytes) {
    const target = capBytes * 0.9;
    for (const f of files.sort((a, b) => a.mtime - b.mtime)) { if (total <= target) break; drop(f, "space"); total -= f.size; }
  }
  // the index follows: a record whose picture went is removed; one whose clip went keeps its picture
  const byDay = new Map();
  for (const k of touched) { const [c, d, stem] = k.split("|"); if (!byDay.has(`${c}|${d}`)) byDay.set(`${c}|${d}`, []); byDay.get(`${c}|${d}`).push(stem); }
  for (const [k, stems] of byDay) {
    const [c, d] = k.split("|");
    for (const r of readIndex(c, d)) {
      const stem = stemOf(r.file);
      if (!stems.includes(stem)) continue;
      const hasPic = existsSync(join(dayDir(c, d), r.file)), hasClip = r.clip && existsSync(join(dayDir(c, d), r.clip));
      if (!hasPic && !hasClip) append(c, d, { id: r.id, deleted: true });
      else if (r.clip && !hasClip) append(c, d, { id: r.id, clip: null });
    }
    compact(c, d);
    try { if (!readdirSync(dayDir(c, d)).length) rmSync(dayDir(c, d), { recursive: true, force: true }); } catch { /* fine */ }
  }
  return { removed: gone.length, bytes: gone.reduce((s, f) => s + f.size, 0), total };
}
