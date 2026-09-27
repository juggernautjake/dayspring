// The media library's and Google Drive's routes (this computer only: server.mjs refuses anything else, localRequest()).
//   GET  /api/media/local/stream?id=…[&convert=1&t=s]   a file FROM THE INDEX by its id (never a path from the page), with
//                                                       HTTP Range; permissions and the fail-safes are checked again every
//                                                       time, and nothing outside the folders file access allows is served
//   GET  /api/media/local/status · /search?q=&kind=     what's indexed, and a search (for the screen's list)
//   POST /api/media/local/scan                          look through the folders again now
//   POST /api/media/local/folders { add | remove }      an extra media folder (still only where file access allows)
//   POST /api/media/local/pick { n | all, shuffle }     the screen's list: play number n, or all of them
//   POST /api/media/local/open { n }                    the screen's list: open number n in this PC's default app
//   POST /api/media/local/played { id }                 the screen moved on to the next file (the activity log)
//   GET  /api/media/local/sink                          which output device music follows (lib/sinkpick.mjs), and its picker
//   GET  /api/drive/stream?ref=…                        a Drive file's audio/video/picture, streamed through here (Range passes
//                                                       through; the Google token never reaches the page)
//   GET  /api/drive/search?q=&type=&account=            Drive search (every connected Drive, or one)
import { createReadStream, statSync } from "node:fs";
import * as permissions from "../permissions.mjs";
import * as safety from "../filesafety.mjs";
import * as activity from "../activity.mjs";
import * as sinkpick from "../sinkpick.mjs";
import * as library from "./library.mjs";
import * as player from "./player.mjs";
import * as skills from "./skills.mjs";
import * as drive from "../connectors/drive.mjs";
import { kindOf, NEVER_PLAYS } from "./tags.mjs";

const MIME = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", wma: "audio/x-ms-wma",
  mp4: "video/mp4", m4v: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo", wmv: "video/x-ms-wmv" };
const deny = (res, code, text) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: text })); return true; };

// → true when it answered
export function streamLocal(req, res, q) {
  const id = String(q.get("id") ?? "");
  const x = /^[a-f0-9]{16}$/.test(id) ? library.byId(id) : null;
  if (!x) return deny(res, 404, "That isn't in your media library.");
  // checked again now: file access may have changed since it was indexed
  const k = permissions.check("read", x.path);
  if (!k.ok) { activity.log("blocked", { path: x.path, reason: k.reason, text: k.text, via: "media_stream" }); return deny(res, 403, k.text); }
  const real = k.real ?? x.path;
  const inside = library.roots().roots.some((r) => safety.under(k.full, r) && safety.under(real, r));
  if (!inside || safety.isSecretPath(real) || !kindOf(real) || library.PRIVATE.test(real.split(/[\\/]/).slice(-4).join("\\"))) {
    activity.log("blocked", { path: x.path, reason: "outside-media-folders", text: "A media file outside the folders file access allows was asked for.", via: "media_stream" });
    return deny(res, 403, "That file isn't in a folder I'm allowed to play from.");
  }
  let st; try { st = statSync(real); } catch { return deny(res, 404, "That file isn't there anymore. I'll look through your folders again."); }
  if (!st.isFile()) return deny(res, 404, "That isn't a file.");
  if (q.get("convert") === "1" || (NEVER_PLAYS.has(x.ext) && q.get("convert") !== "0" && player.canConvert())) { player.convert(real, x.kind, res, req, { start: q.get("t") }); return true; }
  const type = MIME[x.ext] ?? "application/octet-stream", size = st.size;
  const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    if (!range || (range[1] === "" && range[2] === "")) { res.writeHead(416, { ...base, "content-range": `bytes */${size}` }); res.end(); return true; }
    if (range[1] === "") { start = Math.max(0, size - Number(range[2])); } else { start = Number(range[1]); if (range[2] !== "") end = Math.min(size - 1, Number(range[2])); }
    if (start >= size || start > end) { res.writeHead(416, { ...base, "content-range": `bytes */${size}` }); res.end(); return true; }
    status = 206;
  }
  res.writeHead(status, { ...base, "content-length": end - start + 1, ...(status === 206 ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === "HEAD") { res.end(); return true; }
  const s = createReadStream(real, { start, end });
  s.on("error", () => { try { res.destroy(); } catch { /* gone */ } });
  req.on("close", () => s.destroy());
  s.pipe(res);
  return true;
}

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/media/local/") && !p.startsWith("/drive/")) return false;
  try {
    if ((m === "GET" || m === "HEAD") && p === "/media/local/stream") return streamLocal(req, res, q);
    if ((m === "GET" || m === "HEAD") && p === "/drive/stream") {
      if (!drive.connected()) return deny(res, 404, "Google Drive isn't connected.");
      await drive.stream(String(q.get("ref") ?? ""), req, res);
      return true;
    }
    const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
    if (m === "GET" && p === "/media/local/status") { library.scanSoon(); return send(res, 200, { ...library.status(), canConvert: player.canConvert() }), true; }
    if (m === "GET" && p === "/media/local/search") {
      const r = library.search(String(q.get("q") ?? "").slice(0, 200), { kind: ["audio", "video"].includes(q.get("kind")) ? q.get("kind") : null, limit: 50 });
      return send(res, 200, { results: r.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, kind: x.kind, duration: x.duration, folder: x.folder, year: x.year, ext: x.ext })) }), true;
    }
    if (m === "POST" && p === "/media/local/scan") { library.scanSoon(true); return send(res, 200, { scanning: true, ...library.status() }), true; }
    if (m === "POST" && p === "/media/local/folders") {
      const r = body.add ? library.addFolder(body.add) : body.remove ? library.removeFolder(body.remove) : { error: "add or remove a folder" };
      return send(res, r.denied || r.error ? 400 : 200, r.denied ? { error: r.text } : r), true;
    }
    if (m === "POST" && p === "/media/local/pick") { const r = skills.playFromList(body.n, { all: Boolean(body.all), shuffle: Boolean(body.shuffle) }); return send(res, r.error ? 400 : 200, r), true; }
    if (m === "POST" && p === "/media/local/open") { const r = skills.openFromList(body.n); return send(res, r.error || r.denied ? 400 : 200, r.denied ? { error: r.text } : r), true; }
    if (m === "POST" && p === "/media/local/played") return send(res, 200, { ok: player.played(String(body.id ?? "")) }), true;
    if (m === "GET" && p === "/media/local/sink") return send(res, 200, { cfg: sinkpick.config(), pick: sinkpick.pickOutput.toString() }), true;
    if (m === "GET" && p === "/drive/search") {
      const r = await drive.search({ query: String(q.get("q") ?? "").slice(0, 200), type: drive.TYPES.includes(q.get("type")) ? q.get("type") : undefined, account: q.get("account") || undefined, limit: 50 });
      return send(res, 200, r), true;
    }
  } catch (e) { return send(res, e.status && e.status < 500 ? e.status : 400, { error: e.message }), true; }
  return false;
}
