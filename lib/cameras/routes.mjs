// The cameras' routes (local only, like every /api route). Off (404) when this build doesn't have cameras (gate.mjs).
//   GET  /api/cameras                        → { cameras, status, settings, usage, presets, trail, ai }
//   POST /api/cameras { camera }             add            POST /api/cameras/:id { patch }   DELETE /api/cameras/:id
//   POST /api/cameras/test { camera | id }   one picture (not saved) → { ok, jpeg (data URL), ms } | { ok: false, error }
//   GET  /api/cameras/:id/snapshot[?cached=1]  a JPEG           GET /api/cameras/:id/live   an MJPEG stream (low rate)
//   POST /api/cameras/:id/check              take and look at a picture now (the schedule's own path)
//   GET  /api/cameras/events?cam=&day=&label=&limit=      DELETE /api/cameras/events/:id
//   GET  /api/cameras/recordings?cam=&day=   clips, continuous segments, events, days
//   GET  /api/cameras/media/:cam/:day/:file  a picture or clip (Range requests, for the video player)
//   GET  /api/cameras/:id/device-recordings  what the camera keeps itself (SD card, GoPro)
//   GET  /api/cameras/:id/device-recordings/play?ref=   that recording, streamed (MP4)
//   GET  /api/cameras/discover/usb · /discover/onvif · /discover/homeassistant   (only when the owner presses Discover)
//   POST /api/cameras/settings { storageDir, diskCapGB }  · GET /api/cameras/summary?cam=&when=
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as cams from "./index.mjs";
import * as config from "./config.mjs";
import * as events from "./events.mjs";
import * as gate from "./gate.mjs";
import * as ff from "./ffmpeg.mjs";
import * as onvif from "./onvif.mjs";
import * as skills from "./skills.mjs";
import { PRESETS, TRAIL, build } from "./presets.mjs";
import { MODELS as GOPRO_MODELS } from "./sources/gopro.mjs";

const DATA = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data"));
let permMod = null;
const perms = async () => (permMod ??= await import("../permissions.mjs"));
// Storage outside Dayspring's own data folder needs the owner's "read and write" there (Settings → Permissions).
export async function checkStorage(dir) {
  if (!dir) return null;
  const full = resolve(dir);
  const P = await perms();
  if (P.isSystemPath(full)) throw new Error("That's a Windows or program folder. Pick a folder of your own, like D:\\Camera recordings.");
  const inData = full.toLowerCase() === DATA.toLowerCase() || full.toLowerCase().startsWith(DATA.toLowerCase() + sep);
  if (!inData && P.accessFor(full) !== "readwrite") throw Object.assign(new Error("Dayspring isn't allowed to save files there. Allow read and write for that folder in Settings → Permissions, then try again."), { code: "permission" });
  mkdirSync(full, { recursive: true });
  const probe = join(full, `.dayspring-write-test-${process.pid}`);
  try { writeFileSync(probe, "ok"); rmSync(probe, { force: true }); } catch { throw new Error("Windows didn't let Dayspring write in that folder."); }
  return full;
}
export async function checkFolderCam(folder) {
  const P = await perms();
  if (P.accessFor(resolve(folder)) === "none") throw Object.assign(new Error("Dayspring isn't allowed to read that folder yet. Allow it in Settings → Permissions (read is enough), then add the camera."), { code: "permission" });
}

async function state() {
  const { canSee, label } = await (async () => { try { const l = await import("../llm.mjs"); return { canSee: l.supportsImages(), label: l.label() }; } catch { return { canSee: false, label: "" }; } })();
  let usage = { bytes: 0, files: 0 }; try { usage = events.usage(); } catch { /* none yet */ }
  return { cameras: cams.list(), status: cams.status(), settings: { ...config.top(), storage: config.storageDir(), defaultStorage: config.DEFAULT_DIR() }, usage,
    presets: PRESETS.map(({ id, label, kind, port, note, onvifPort }) => ({ id, label, kind, port, note, onvifPort })), trail: TRAIL, gopro: GOPRO_MODELS, ai: { canSee, provider: label } };
}
const TYPES = { jpg: "image/jpeg", mp4: "video/mp4" };
function serveFile(req, res, file) {
  const size = statSync(file).size, type = TYPES[file.split(".").pop().toLowerCase()] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { "content-range": `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" });
  createReadStream(file).pipe(res);
}
const jpegOut = (res, buf) => { res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "content-length": buf.length }); res.end(buf); };

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/cameras")) return false;
  await gate.ready;
  if (!gate.on()) return send(res, 404, { error: "Cameras aren't in this version of Dayspring.", off: true }), true;
  let mm;
  if (p === "/cameras" && m === "GET") return send(res, 200, await state()), true;
  if (p === "/cameras" && m === "POST") {
    const b = await readJSON(req);
    if (b.camera?.kind === "folder" && b.camera?.conn?.folder) await checkFolderCam(b.camera.conn.folder);
    const cam = config.add(b.camera ?? b);
    cams.restart(cam.id);
    return send(res, 200, { camera: config.publicCam(cam), ...(await state()) }), true;
  }
  if (p === "/cameras/preset" && m === "POST") {
    const b = await readJSON(req);
    const host = String(b.host ?? "").trim();
    if (!/^[\w.:[\]-]{1,100}$/.test(host)) return send(res, 400, { error: "Type the camera's address, like 192.168.1.50." }), true;
    return send(res, 200, build(b.id, { host, channel: b.channel, sub: Boolean(b.sub), name: String(b.name ?? "").replace(/[^\w-]/g, "") })), true;
  }
  if (p === "/cameras/settings" && m === "POST") {
    const b = await readJSON(req);
    if (b.storageDir !== undefined && b.storageDir) b.storageDir = await checkStorage(b.storageDir);
    config.setTop(b);
    return send(res, 200, await state()), true;
  }
  if (p === "/cameras/test" && m === "POST") {
    const b = await readJSON(req); const t = Date.now();
    try {
      let src;
      if (b.id && !b.camera) src = cams.source(b.id);
      else {
        // an edited camera keeps its saved password unless a new one was typed
        const old = b.id ? config.get(b.id) : null;
        const draft = config.draft({ ...(old ?? {}), ...b.camera, conn: { ...(old?.conn ?? {}), ...(b.camera?.conn ?? {}), ...(b.camera?.conn?.password ? {} : { password: old?.conn?.password }) } });
        src = cams.build(draft);
      }
      if (!src) return send(res, 404, { ok: false, error: "I can't find that camera." }), true;
      const jpeg = await src.snapshot();
      const small = await ff.resize(jpeg, 960).catch(() => jpeg);
      return send(res, 200, { ok: true, ms: Date.now() - t, bytes: jpeg.length, jpeg: "data:image/jpeg;base64," + small.toString("base64") }), true;
    } catch (e) { return send(res, 200, { ok: false, error: e.message, ms: Date.now() - t }), true; }
  }
  if (p === "/cameras/events" && m === "GET") {
    const list = events.list({ cam: q.get("cam") || null, day: q.get("day") || null, label: q.get("label") || null, kind: q.get("kind") || null, limit: Math.min(500, Number(q.get("limit")) || 100) });
    return send(res, 200, { events: list.map((e) => ({ ...e, thumb: `/api/cameras/media/${e.cam}/${e.day}/${e.file}`, clipUrl: e.clip ? `/api/cameras/media/${e.cam}/${e.day}/${e.clip}` : null })) }), true;
  }
  if ((mm = /^\/cameras\/events\/([^/]+)$/.exec(p))) {
    const id = decodeURIComponent(mm[1]);
    if (m === "DELETE") return send(res, 200, { removed: events.remove(id) }), true;
    if (m === "GET") { const e = events.get(id); if (!e) return send(res, 404, { error: "That event is gone." }), true; return send(res, 200, { event: { ...e, thumb: `/api/cameras/media/${e.cam}/${e.day}/${e.file}`, clipUrl: e.clip ? `/api/cameras/media/${e.cam}/${e.day}/${e.clip}` : null } }), true; }
  }
  if (p === "/cameras/recordings" && m === "GET") {
    const cam = q.get("cam"); if (!cam) return send(res, 400, { error: "Which camera?" }), true;
    const day = q.get("day") || events.dayOf(new Date());
    return send(res, 200, { ...events.recordings({ cam, day }), days: events.days(cam) }), true;
  }
  if ((mm = /^\/cameras\/media\/([\w-]+)\/([\w-]+)\/([\w.-]+)$/.exec(p)) && m === "GET") {
    const f = events.fileFor(mm[1], mm[2], mm[3]);
    if (!f) return send(res, 404, { error: "not found" }), true;
    serveFile(req, res, f); return true;
  }
  if (p === "/cameras/summary" && m === "GET") return send(res, 200, await skills.activity({ camera: q.get("cam") || null, text: q.get("when") || "today", label: q.get("label") || null })), true;
  if (p === "/cameras/discover/usb" && m === "GET") return send(res, 200, { devices: await ff.listDshow() }), true;
  if (p === "/cameras/discover/onvif" && m === "GET") {
    const to = q.get("host") ? { host: q.get("host"), port: Number(q.get("port")) || 3702 } : null;
    return send(res, 200, { found: await onvif.discover({ timeoutMs: Math.min(8000, Number(q.get("ms")) || 3000), to }) }), true;
  }
  if (p === "/cameras/discover/onvif-profiles" && m === "POST") {
    const b = await readJSON(req);
    const old = b.id ? config.get(b.id) : null;
    const d = { host: b.host, port: Number(b.port) || 80, xaddr: b.xaddr || null, username: b.username ?? old?.conn?.username ?? "", password: b.password || (old ? config.creds(old).password : "") };
    try { return send(res, 200, { profiles: await onvif.profiles(d) }), true; } catch (e) { return send(res, 200, { error: e.message }), true; }
  }
  if (p === "/cameras/discover/homeassistant" && m === "GET") {
    try { const ha = await import("./sources/homeassistant.mjs"); return send(res, 200, { connected: ha.connected(), cameras: ha.connected() ? await ha.list() : [] }), true; }
    catch (e) { return send(res, 200, { connected: false, error: e.message, cameras: [] }), true; }
  }
  if ((mm = /^\/cameras\/([\w-]{3,40})(\/[\w-]+)?$/.exec(p))) {
    const id = mm[1], sub = mm[2] ?? "";
    if (!sub && m === "POST") {
      const b = await readJSON(req);
      if (b.conn?.folder) await checkFolderCam(b.conn.folder);
      const cam = config.update(id, b); cams.restart(id);
      return send(res, 200, { camera: config.publicCam(cam), ...(await state()) }), true;
    }
    if (!sub && m === "DELETE") { const ok = config.remove(id); cams.forget(id); return send(res, ok ? 200 : 404, { removed: ok, ...(await state()) }), true; }
    if (!sub && m === "GET") { const c = cams.camera(id); if (!c) return send(res, 404, { error: "I can't find that camera." }), true; return send(res, 200, { camera: { ...config.publicCam(c), status: cams.statusOf(id) } }), true; }
    if (sub === "/snapshot" && m === "GET") {
      try { return jpegOut(res, await cams.snapshot(id, { fresh: q.get("cached") !== "1" })), true; }
      catch (e) { return send(res, e.status ?? 502, { error: e.message }), true; }
    }
    if (sub === "/check" && m === "POST") {
      const h = cams.monitor.handleOf(id);
      if (h) { const r = await h.runNow("manual"); return send(res, 200, { done: true, saved: (r ?? []).filter(Boolean).map((x) => x.id) }), true; }
      // not scheduled: one look with the same rules, kept as an event if it is one
      const cam = cams.camera(id); if (!cam) return send(res, 404, { error: "I can't find that camera." }), true;
      const jpeg = await cams.snapshot(id);
      const v = await cams.defaultAnalyze(cam, { camId: id, at: new Date().toISOString(), jpeg, reason: "manual" }, []);
      const rec = v.event ? events.save(id, jpeg, { kind: "event", source: "manual", labels: v.labels, summary: v.summary, usedAI: v.usedAI }) : null;
      return send(res, 200, { done: true, verdict: { event: Boolean(v.event), labels: v.labels, summary: v.summary, usedAI: v.usedAI }, saved: rec ? [rec.id] : [] }), true;
    }
    if (sub === "/live" && m === "GET") {
      let off = null, closed = false;
      res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=dsframe", "cache-control": "no-store", connection: "close" });
      const end = () => { if (closed) return; closed = true; off?.(); try { res.end(); } catch { /* gone */ } };
      try {
        off = cams.live(id, (jpeg, why) => {
          if (!jpeg) return end();
          if (res.writableLength > 2e6) return;          // a slow screen: skip frames rather than queue them
          res.write(`--dsframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`); res.write(jpeg); res.write("\r\n");
        }, { fps: Math.min(5, Number(q.get("fps")) || 2) });
      } catch (e) { end(); return true; }
      req.on("close", end);
      setTimeout(end, 30 * 60_000).unref?.();             // a forgotten page doesn't keep a camera open forever
      return true;
    }
    if (sub === "/device-recordings" && m === "GET") {
      const s = cams.source(id);
      if (!s?.recordings) return send(res, 200, { recordings: [], supported: false }), true;
      try { return send(res, 200, { supported: true, recordings: (await s.recordings()).slice(0, 300) }), true; }
      catch (e) { return send(res, 200, { supported: true, recordings: [], error: e.message }), true; }
    }
    if (sub === "/device-recordings" && m === "POST") return send(res, 405, { error: "read only" }), true;
    if (sub === "/device-play" && m === "GET") {
      const s = cams.source(id); const ref = q.get("ref") ?? "";
      if (!s?.fetchRecording) return send(res, 404, { error: "This camera doesn't keep recordings Dayspring can reach." }), true;
      const r = await s.fetchRecording(ref);
      if (r.file) { serveFile(req, res, r.file); return true; }
      if (r.buf) { res.writeHead(200, { "content-type": r.type ?? "application/octet-stream", "content-length": r.buf.length }); res.end(r.buf); return true; }
      if (r.res) { res.writeHead(200, { "content-type": r.type, ...(r.length ? { "content-length": r.length } : {}) }); for await (const c of r.res.body) { if (!res.write(Buffer.from(c))) await new Promise((ok) => res.once("drain", ok)); } res.end(); return true; }
      if (r.input) {
        // a recording played back over RTSP: remuxed on the fly into a streamable MP4
        const c = ff.spawnFfmpeg(["-loglevel", "error", ...r.input, "-t", String(r.seconds ?? 120), "-c:v", "copy", "-an", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"]);
        res.writeHead(200, { "content-type": "video/mp4", "cache-control": "no-store" });
        c.stdout.pipe(res); c.stderr.on("data", () => {});
        req.on("close", () => { try { c.kill("SIGKILL"); } catch { /* gone */ } });
        return true;
      }
      return send(res, 404, { error: "That recording couldn't be opened." }), true;
    }
  }
  return false;
}

// "show me the front camera", "any activity on the trail cam?" … (server.mjs asks before the AI)
export const command = (text) => skills.command(text);
export const TOOLS = skills.TOOLS;
export const tools = skills.tools;
export const runTool = skills.runTool;
