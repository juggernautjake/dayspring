// The photo gallery's routes (public/gallery.js). Photos by id, folders by folder id: never a path from the page.
//   GET  /api/gallery/list?view=all|folder|search|person|favs|set|random&fid=&deep=1&q=&set=&person=&fav=1&text=1&videos=1
//        &from=&to=&said=&group=folder|date|album|none&sort=date|name|size&dir=asc|desc&rs=&shuffle=1&seed=&focus=&offset=&limit=
//   GET  /api/gallery/item?id=         a photo's details: date, camera, size, dimensions, people, words, and where it is
//   GET  /api/gallery/thumb?id=        a small picture (cached in data/thumbs)
//   GET  /api/gallery/file?id=         the photo (HEIC and TIFF decoded by Windows), or the video (HTTP Range)
//   GET  /api/gallery/people           the people in the photos (only with face recognition on)
//   GET  /api/gallery/status
//   POST /api/gallery/reveal {id}      📂 File Explorer with the photo selected (permitted places only; logged)
//   POST /api/gallery/fav {id, on}     ★
//   POST /api/gallery/set {ids, title} → { set } a collection of these photos (the People page's, the finder's results)
//   POST /api/gallery/register {id}    a picture from elsewhere (the file viewer, a saved web picture) → { id, fid }
//   POST /api/gallery/state {open, id, single}   what's open (for "view this in the gallery", "open this photo's folder")
import * as G from "./index.mjs";
import { sendBytes, sendFile } from "../finder/routes.mjs";
import { NEEDS_DECODE, MIME } from "../finder/kinds.mjs";

const decoded = new Map();
async function decodedJpeg(real, key) {
  if (decoded.has(key)) return decoded.get(key);
  const helper = await import("../vision/helper.mjs");
  const buf = Buffer.from((await helper.jpeg(real, 2400)).data, "base64");
  decoded.set(key, buf); if (decoded.size > 12) decoded.delete(decoded.keys().next().value);
  return buf;
}
const num = (v) => (v == null || v === "" ? undefined : Number(v));

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/gallery/")) return false;
  try {
    const get = m === "GET" || m === "HEAD";
    if (m === "GET" && p === "/gallery/list") {
      const o = Object.fromEntries(["view", "fid", "q", "set", "person", "said", "group", "sort", "dir", "rs", "focus"].map((k) => [k, q.get(k) ?? undefined]));
      Object.assign(o, { deep: q.get("deep") === "1", fav: q.get("fav") === "1", text: q.get("text") === "1", videos: q.get("videos") === "1", shuffle: q.get("shuffle") === "1",
        from: num(q.get("from")), to: num(q.get("to")), seed: num(q.get("seed")), offset: num(q.get("offset")), limit: num(q.get("limit")) });
      return send(res, 200, await G.query(o)), true;
    }
    if (m === "GET" && p === "/gallery/item") { const r = await G.info(q.get("id")); return send(res, r.denied ? 403 : r.error ? 404 : 200, r.denied ? { error: r.text, denied: true } : r), true; }
    if (get && p === "/gallery/thumb") {
      const r = await G.thumb(q.get("id"));
      if (r.denied) return send(res, 403, { error: r.text }), true;
      if (r.error) return send(res, 404, { error: r.error }), true;
      const cache = { "cache-control": "private, max-age=86400" };
      return r.file ? sendFile(req, res, r.file, r.type, cache) : sendBytes(req, res, r.buf, r.type, { ...cache, ...(r.cached ? { "x-thumb": "cached" } : { "x-thumb": "made" }) });
    }
    if (get && p === "/gallery/file") {
      const f = G.fileFor(q.get("id"));
      if (f.denied) return send(res, 403, { error: f.text }), true;
      if (f.error) return send(res, 404, { error: f.error }), true;
      const x = f.item;
      if (x.kind === "image" && NEEDS_DECODE.has(x.ext)) {
        try { return sendBytes(req, res, await decodedJpeg(f.real, `${x.id}|${x.mtime}`), "image/jpeg", { "cache-control": "private, max-age=3600" }); }
        catch (e) { return send(res, 415, { error: `Windows couldn't open this ${x.ext.toUpperCase()} picture here (${e.message}).` }), true; }
      }
      return sendFile(req, res, f.real, MIME[x.ext] ?? (x.kind === "video" ? "video/mp4" : "image/jpeg"), { "cache-control": "private, max-age=3600" });
    }
    if (m === "GET" && p === "/gallery/people") return send(res, 200, { people: await G.peopleList() }), true;
    if (m === "GET" && p === "/gallery/status") return send(res, 200, G.status()), true;
    if (m !== "POST") return false;
    const b = await readJSON(req).catch(() => ({}));
    if (p === "/gallery/reveal") { const r = G.reveal(b.id, { via: b.via === "voice" ? "voice" : "screen" }); return send(res, r.denied ? 403 : r.error ? 404 : 200, r.denied ? { error: r.text, denied: true } : r), true; }
    if (p === "/gallery/fav") { const r = G.setFav(b.id, Boolean(b.on)); return send(res, r.error ? 404 : 200, r), true; }
    if (p === "/gallery/set") return send(res, 200, { set: G.makeSet(b.ids, b.title) }), true;
    if (p === "/gallery/register") {
      const x = G.find(b.id);
      if (!x) return send(res, 404, { error: "That picture isn't one Dayspring may show in the gallery." }), true;
      return send(res, 200, { id: x.id, fid: G.fidOf(x.dir), name: x.name, where: G.whereText(x) }), true;
    }
    if (p === "/gallery/state") { G.setState(b); return send(res, 200, { ok: true }), true; }
  } catch (e) { return send(res, e.status && e.status < 500 ? e.status : 400, { error: e.message }), true; }
  return false;
}
