// The file viewer's routes (this computer only: server.mjs refuses anything else). Every file is asked for BY ITS ID
// (from the finder's index, or a file the finder was shown): never a path from the page. Each request checks file access
// and the fail-safes again (lib/finder/index.mjs allowedNow: the folders allowed right now, links followed, secrets and
// private-looking names refused), like the media library's stream route.
//   GET  /api/viewer/file?id=[&download=1][&as=jpeg][&convert=1&t=s]   the file (HTTP Range), a decoded picture, a converted video
//   GET  /api/viewer/thumb?id=              a small picture (pictures; a frame of a video)
//   GET  /api/viewer/info?id=               name, type, size, dates, folder; a picture's EXIF facts and description; what's allowed
//   GET  /api/viewer/text?id=[&entry=]      text and code (up to 2 MB)
//   GET  /api/viewer/render?id=[&entry=]    Word → HTML, Excel/CSV → sheets, PowerPoint → slides, zip → its list
//   GET  /api/viewer/inner?id=&entry=       one small file from inside a zip (or a PowerPoint's picture)
//   GET  /api/viewer/captions?id=&n=        a video's .srt/.vtt as WebVTT
//   GET  /api/viewer/siblings?id=           the files next to it (for ◀ ▶)
//   GET  /api/viewer/search?q=&kind=        the search box            GET /api/viewer/status   what's indexed, where
//   POST /api/viewer/open {id|n} · default {id, ask} · folder {id} · delete {id, ask} · copy {id, ask} · avatar {id}
//        describe {id} · state {open, id, kind, page, pages} · scan · list/close
import { createReadStream, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename, dirname } from "node:path";
import * as activity from "../activity.mjs";
import * as safety from "../filesafety.mjs";
import * as index from "./index.mjs";
import * as skills from "./skills.mjs";
import * as actions from "./actions.mjs";
import * as render from "./render.mjs";
import { parse } from "./query.mjs";
import { MIME, ACTIVE, NEEDS_DECODE, kindOf, extOf, langOf } from "./kinds.mjs";

const deny = (res, code, text) => { if (!res.headersSent) { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: text })); } return true; };
const NOSNIFF = { "x-content-type-options": "nosniff", "cache-control": "no-store" };
// a page from a file (HTML, SVG, XML, scripts) never runs as one of Dayspring's own pages
const typeFor = (ext, { raw = false } = {}) => (ACTIVE.has(ext) ? (ext === "svg" && !raw ? "image/svg+xml" : "text/plain; charset=utf-8") : MIME[ext] ?? "application/octet-stream");
const SANDBOX = { "content-security-policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'" };

// → an item, or it has already answered (404/403)
function itemFor(res, q) {
  const it = skills.resolve(q.get("id"));
  if (it.denied) { deny(res, 403, it.text); return null; }
  if (it.error) { deny(res, 404, it.error); return null; }
  return it;
}
export function sendBytes(req, res, buf, type, extra = {}) {
  res.writeHead(200, { "content-type": type, "content-length": buf.length, ...NOSNIFF, ...extra });
  res.end(req.method === "HEAD" ? undefined : buf);
  return true;
}
// the file itself, with HTTP Range (video seeking, pdf.js reading a part at a time)
export function sendFile(req, res, path, type, extra = {}) {
  let st; try { st = statSync(path); } catch { return deny(res, 404, "That file isn't there anymore."); }
  const size = st.size, base = { "content-type": type, "accept-ranges": "bytes", ...NOSNIFF, ...extra };
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    if (!range || (range[1] === "" && range[2] === "")) { res.writeHead(416, { ...base, "content-range": `bytes */${size}` }); res.end(); return true; }
    if (range[1] === "") start = Math.max(0, size - Number(range[2])); else { start = Number(range[1]); if (range[2] !== "") end = Math.min(size - 1, Number(range[2])); }
    if (start >= size || start > end) { res.writeHead(416, { ...base, "content-range": `bytes */${size}` }); res.end(); return true; }
    status = 206;
  }
  res.writeHead(status, { ...base, "content-length": size ? end - start + 1 : 0, ...(status === 206 ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === "HEAD" || !size) { res.end(); return true; }
  const s = createReadStream(path, { start, end });
  s.on("error", () => { try { res.destroy(); } catch { /* gone */ } });
  req.on("close", () => s.destroy());
  s.pipe(res);
  return true;
}
const attachment = (name) => ({ "content-disposition": `attachment; filename="${String(name).replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}` });

// ---- decoded pictures and thumbnails (a small cache: TVs have little memory to spare) ------------------------------------------
const cache = new Map(); const CACHE_MAX = 60;
const remember = (k, v) => { cache.set(k, v); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); return v; };
async function jpegOf(it, max) {
  const key = `${it.id}|${it.mtime}|${max}`;
  if (cache.has(key)) return cache.get(key);
  const helper = await import("../vision/helper.mjs");
  const j = await helper.jpeg(it.real ?? it.path, max);
  return remember(key, Buffer.from(j.data, "base64"));
}
async function videoFrame(it) {
  const key = `${it.id}|${it.mtime}|frame`;
  if (cache.has(key)) return cache.get(key);
  const { ffmpegPath } = await import("../medialib/player.mjs");
  const bin = ffmpegPath(); if (!bin) return null;
  const buf = await new Promise((ok) => {
    const p = spawn(bin, ["-hide_banner", "-loglevel", "error", "-ss", "1", "-i", it.real ?? it.path, "-frames:v", "1", "-vf", "scale=320:-2", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const parts = []; const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, 8000);
    p.stdout.on("data", (c) => parts.push(c)); p.on("close", () => { clearTimeout(t); const b = Buffer.concat(parts); ok(b.length > 100 ? b : null); }); p.on("error", () => { clearTimeout(t); ok(null); });
  });
  return buf ? remember(key, buf) : null;
}

// bytes of the file, or of one file inside it (a zip's, a PowerPoint's picture)
async function bytesOf(it, entry) {
  if (!entry) return readFileSync(it.real ?? it.path);
  if (!["zip", "slides", "docx", "sheet"].includes(it.kind)) throw Object.assign(new Error("That file has nothing inside it to open."), { status: 400 });
  if (safety.isSecretPath(String(entry)) || /(^|[\\/])\.\.([\\/]|$)/.test(String(entry))) throw Object.assign(new Error("That file inside the archive looks like it holds passwords or keys, so I won't open it."), { status: 403 });
  if (index.PRIVATE.test(String(entry))) throw Object.assign(new Error("That file inside the archive looks private, so I keep it off the screen."), { status: 403 });
  if (statSync(it.real ?? it.path).size > 400 * 1024 * 1024) throw Object.assign(new Error("That archive is too big to look inside here."), { status: 413 });
  return (await render.zipEntry(readFileSync(it.real ?? it.path), entry)).buf;
}
const kindOfEntry = (it, entry) => (entry ? kindOf(entry) : it.kind);
const extOfEntry = (it, entry) => (entry ? extOf(entry) : it.ext);

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/viewer/")) return false;
  try {
    const get = m === "GET" || m === "HEAD";
    if (get && p === "/viewer/file") {
      const it = itemFor(res, q); if (!it) return true;
      if (it.source === "drive") {
        if (!["image", "video", "audio"].includes(it.kind)) return deny(res, 415, "Only pictures, video and audio from Google Drive open here. Open the others in Drive.");
        const d = await import("../connectors/drive.mjs"); await d.stream(it.ref, req, res); return true;
      }
      const download = q.get("download") === "1";
      if (download) activity.log("file.read", { path: it.path, via: "file_viewer", action: "download" });
      if (!download && it.kind === "image" && (NEEDS_DECODE.has(it.ext) || q.get("as") === "jpeg")) {
        try { return sendBytes(req, res, await jpegOf(it, Math.max(256, Math.min(4096, Number(q.get("max")) || 3000))), "image/jpeg"); }
        catch (e) { return deny(res, 415, `Windows couldn't open this ${it.ext.toUpperCase()} picture here (${e.message}). “Open in the default app” should show it.`); }
      }
      if (!download && (it.kind === "video" || it.kind === "audio") && q.get("convert") === "1") {
        const player = await import("../medialib/player.mjs");
        if (!player.canConvert()) return deny(res, 415, "This format can't play on the screen, and ffmpeg isn't here to convert it.");
        player.convert(it.real ?? it.path, it.kind, res, req, { start: q.get("t") }); return true;
      }
      return sendFile(req, res, it.real ?? it.path, download ? "application/octet-stream" : typeFor(it.ext), { ...(download ? attachment(it.name) : {}), ...(ACTIVE.has(it.ext) ? SANDBOX : {}) });
    }
    if (get && p === "/viewer/thumb") {
      const it = itemFor(res, q); if (!it) return true;
      if (it.source === "drive") return deny(res, 404, "No picture.");
      if (it.kind === "image") {
        try { return sendBytes(req, res, await jpegOf(it, 320), "image/jpeg", { "cache-control": "private, max-age=600" }); }
        catch { if (it.size <= 4 * 1024 * 1024 && !NEEDS_DECODE.has(it.ext)) return sendFile(req, res, it.real ?? it.path, typeFor(it.ext), ACTIVE.has(it.ext) ? SANDBOX : {}); return deny(res, 404, "No picture."); }
      }
      if (it.kind === "video") { const f = await videoFrame(it).catch(() => null); return f ? sendBytes(req, res, f, "image/jpeg", { "cache-control": "private, max-age=600" }) : deny(res, 404, "No picture."); }
      return deny(res, 404, "No picture.");
    }
    if (m === "GET" && p === "/viewer/info") { const r = await actions.info(q.get("id")); return send(res, r.denied ? 403 : r.error ? 404 : 200, r.denied ? { error: r.text } : r), true; }
    if (m === "GET" && p === "/viewer/text") {
      const it = itemFor(res, q); if (!it) return true;
      if (it.source === "drive") { const d = await import("../connectors/drive.mjs"); const r = await d.read(it.ref); return send(res, 200, { text: r.text ?? r.note ?? "", truncated: Boolean(r.truncated), lang: null }), true; }
      const entry = q.get("entry");
      const r = render.text(await bytesOf(it, entry));
      activity.log("file.read", { path: it.path, via: "file_viewer", ...(entry ? { entry: String(entry).slice(0, 200) } : {}) });
      return send(res, 200, { ...r, lang: langOf(extOfEntry(it, entry)), kind: kindOfEntry(it, entry) }), true;
    }
    if (m === "GET" && p === "/viewer/render") {
      const it = itemFor(res, q); if (!it) return true;
      const entry = q.get("entry"), kind = kindOfEntry(it, entry), ext = extOfEntry(it, entry);
      let out;
      if (kind === "docx") out = await render.docx(await bytesOf(it, entry));
      else if (kind === "doc" && !entry) { const documents = await import("../documents.mjs"); const d = await documents.extract(it.real ?? it.path); out = { html: render.paragraphsHtml(d.paras), note: d.note ?? null }; }
      else if (kind === "sheet" || kind === "csv") out = render.sheet(await bytesOf(it, entry), ext);
      else if (kind === "slides") out = await render.slides(await bytesOf(it, entry));
      else if (kind === "zip" && !entry) out = await render.zipList(await bytesOf(it, null));
      else return send(res, 415, { error: "That kind of file isn't shown this way." }), true;
      activity.log("file.read", { path: it.path, via: "file_viewer", ...(entry ? { entry: String(entry).slice(0, 200) } : {}) });
      return send(res, 200, { kind, ...out }), true;
    }
    if (get && p === "/viewer/inner") {
      const it = itemFor(res, q); if (!it) return true;
      const entry = String(q.get("entry") ?? "");
      const buf = await bytesOf(it, entry);
      const ext = extOf(entry);
      return sendBytes(req, res, buf, q.get("download") === "1" ? "application/octet-stream" : typeFor(ext), { ...(q.get("download") === "1" ? attachment(basename(entry)) : {}), ...(ACTIVE.has(ext) ? SANDBOX : {}) });
    }
    if (m === "GET" && p === "/viewer/captions") {
      const it = itemFor(res, q); if (!it) return true;
      const s = actions.sidecars(it)[Number(q.get("n")) || 0];
      if (!s || !index.allowedNow(s.path).ok) return deny(res, 404, "No captions.");
      let t = render.text(readFileSync(s.path)).text;
      if (/\.srt$/i.test(s.path)) t = "WEBVTT\n\n" + t.replace(/\r/g, "").replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2").replace(/^\d+\n(?=\d\d:)/gm, "");
      return sendBytes(req, res, Buffer.from(t, "utf8"), "text/vtt; charset=utf-8"), true;
    }
    if (m === "GET" && p === "/viewer/siblings") {
      const it = itemFor(res, q); if (!it) return true;
      if (it.source === "drive") return send(res, 200, { ids: [it.id], index: 0 }), true;
      const dir = dirname(it.path).toLowerCase();
      const same = (k) => (it.kind === "image" ? k === "image" : it.kind === "video" || it.kind === "audio" ? k === "video" || k === "audio" : k !== "other");
      const list = index.items().filter((x) => dirname(x.path).toLowerCase() === dir && same(x.kind)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })).slice(0, 2000);
      if (!list.some((x) => x.id === it.id)) list.push(it);
      return send(res, 200, { ids: list.map((x) => x.id), index: list.findIndex((x) => x.id === it.id), names: list.map((x) => x.name) }), true;
    }
    if (m === "GET" && p === "/viewer/search") {
      const text = String(q.get("q") ?? "").slice(0, 200).trim();
      const pq = parse(`find ${text}`) ?? parse("find files");
      if (q.get("kind")) { const k = String(q.get("kind")); pq.kinds = k === "pdf" ? [] : [k]; pq.exts = k === "pdf" ? ["pdf"] : []; }
      const r = await skills.find(pq, { limit: 40, withDrive: q.get("drive") === "1" ? true : undefined });
      activity.log("file.find", { query: text, via: "file_viewer", found: r.results.length });
      return send(res, 200, { q: text, results: r.results.map((x, i) => skills.row(x, i + 1)), searched: r.searched.map((x) => basename(x) || x), off: Boolean(r.off), how: r.how ?? null, scanning: index.isScanning() }), true;
    }
    if (m === "GET" && p === "/viewer/status") return send(res, 200, index.status()), true;
    if (m !== "POST") return false;
    const b = await readJSON(req).catch(() => ({}));
    const reply = (r) => send(res, r?.denied ? 403 : r?.error ? 400 : 200, r?.denied ? { error: r.text, denied: true } : r ?? {});
    if (p === "/viewer/open") {
      const ls = skills.lastShown();
      const x = b.n ? ls?.items[Number(b.n) - 1] : null;
      const it = x?.source === "drive" ? x : skills.resolve(b.id ?? x?.id);
      if (it.error || it.denied) return reply(it), true;
      return reply(skills.openOnScreen(it, { list: b.list ? null : ls?.items ?? null, via: "screen" })), true;
    }
    if (p === "/viewer/default") return reply(await actions.openDefaultClick(b.id, { ask: b.ask })), true;
    if (p === "/viewer/folder") return reply(skills.showInFolder({ id: b.id }, { via: "screen" })), true;
    if (p === "/viewer/delete") return reply(await actions.deleteFile(b.id, { ask: b.ask, via: "screen" })), true;
    if (p === "/viewer/copy") return reply(await actions.copyFile(b.id, { ask: b.ask })), true;
    if (p === "/viewer/avatar") return reply(await actions.setAvatar(b.id)), true;
    if (p === "/viewer/describe") return reply(await actions.describe(b.id)), true;
    if (p === "/viewer/state") return send(res, 200, { ok: Boolean(skills.setState(b)) || true }), true;
    if (p === "/viewer/scan") { index.scanSoon(true); return send(res, 200, { scanning: true }), true; }
    if (p === "/viewer/list/close") { skills.closeList(); return send(res, 200, { ok: true }), true; }
  } catch (e) { return send(res, e.status && e.status < 500 ? e.status : 400, { error: e.message }), true; }
  return false;
}

