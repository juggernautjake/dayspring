// GIF media, fetched safely by Dayspring (never by the screen straight from a GIF site: no hotlinking, the owner's
// address isn't handed out, and nothing on this computer or the home network can be reached through it).
//   fetchMedia(url, { maxBytes }) → { buf, type }     image/gif|webp|png|jpeg or video/mp4 (checked from the bytes), 20 MB
//   cacheFile(url, { name }) → { path, name, type, bytes }   the file kept in data/gifs/cache (for attaching, copying, saving)
//   cacheUsage() · clearCache() · pruneCache(maxMB)
// Every address is checked the way lib/imagesearch.mjs checks pictures: http(s) only, a public name whose every
// address is public, looked up once and connected to exactly that address (DNS rebinding), again after each redirect.
import * as imgs from "../imagesearch.mjs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MAX_BYTES = 20 * 1024 * 1024;
export const CACHE_DIR = () => process.env.DAYSPRING_GIFS_CACHE_DIR || join(process.env.DAYSPRING_GIFS_DIR || join(ROOT, "data", "gifs"), "cache");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let deps = {
  resolve: (u) => imgs.resolvePublic(u),
  connect: (href, o, pin) => imgs.pinnedFetch(href, o, pin),
};
export function setDeps(d) { deps = { ...deps, ...d }; }

// Tests only: DAYSPRING_GIFS_MOCK_MEDIA=http://127.0.0.1:<port> sends *.fixture.test addresses to a local mock server
// (the real check still refuses every other private address, localhost and this computer).
function mockRoute(u) {
  const mock = process.env.DAYSPRING_GIFS_MOCK_MEDIA;
  if (!mock) return null;
  try { const x = new URL(u); if (!/\.fixture\.test$/i.test(x.hostname)) return null; const m = new URL(mock); return { href: `${m.origin}${x.pathname}${x.search}`, host: x.hostname }; } catch { return null; }
}

export function sniff(buf) {
  const t = imgs.sniff(buf);
  if (t) return ["image/gif", "image/webp", "image/png", "image/jpeg"].includes(t) ? t : null;
  const b = buf.subarray(0, 16);
  if (b.toString("latin1", 4, 8) === "ftyp" && !/^(avif|avis|heic|heix|mif1)$/.test(b.toString("latin1", 8, 12))) return "video/mp4";
  return null;
}
export const EXT = { "image/gif": ".gif", "image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg", "video/mp4": ".mp4" };
const err = (msg, status) => Object.assign(new Error(msg), { status });
const OK_TYPE = /^(image\/(gif|webp|png|jpeg|jpg|pjpeg)|video\/mp4|application\/octet-stream|binary\/octet-stream)$/;

const mem = new Map(); let memBytes = 0;
const TTL = 10 * 60_000;
export function _clearMemory() { mem.clear(); memBytes = 0; }
export async function fetchMedia(u, { timeoutMs = 15_000, maxBytes = MAX_BYTES, maxRedirects = 4 } = {}) {
  const hit = mem.get(u);
  if (hit && Date.now() - hit.at < TTL) return hit;
  let url = String(u ?? "");
  const deadline = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; ; hop++) {
    const mocked = mockRoute(url);
    let r, href;
    try {
      if (mocked) { href = url; r = await fetch(mocked.href, { headers: { "user-agent": UA }, redirect: "manual", signal: deadline }); }
      else { const pin = await deps.resolve(url); href = pin.href; r = await deps.connect(href, { headers: { "user-agent": UA, accept: "image/gif,image/webp,video/mp4,image/*;q=0.8" }, signal: deadline }, pin); }
    } catch (e) {
      if (e?.status) throw e;
      const slow = /abort|timeout/i.test(`${e?.name} ${e?.message}`);
      throw err(slow ? "The GIF took too long to load." : "I couldn't reach that GIF.", slow ? 504 : 502);
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      try { await r.body?.cancel(); } catch { /* fine */ }
      if (!loc || hop >= maxRedirects) throw err("That GIF's address kept moving.", 502);
      url = new URL(loc, href).href;
      continue;
    }
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* fine */ } throw err(`The GIF's site answered ${r.status}.`, 502); }
    const ctype = String(r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!OK_TYPE.test(ctype)) { try { await r.body?.cancel(); } catch { /* fine */ } throw err("That address isn't a GIF or a video.", 415); }
    const len = Number(r.headers.get("content-length"));
    if (len > maxBytes) { try { await r.body?.cancel(); } catch { /* fine */ } throw err("That GIF is too big (over 20 MB).", 413); }
    const chunks = []; let size = 0;
    const reader = r.body?.getReader?.();
    try {
      if (!reader) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > maxBytes) throw err("That GIF is too big (over 20 MB).", 413); chunks.push(b); size = b.length; }
      else for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) { try { await reader.cancel(); } catch { /* fine */ } throw err("That GIF is too big (over 20 MB).", 413); }
        chunks.push(Buffer.from(value));
      }
    } catch (e) { if (e.status) throw e; throw err("The GIF stopped loading.", 504); }
    const buf = Buffer.concat(chunks, size);
    const type = sniff(buf);
    if (!type) throw err("That address isn't a GIF or a video I can show.", 415);
    const out = { at: Date.now(), buf, type };
    if (buf.length <= 2 * 1024 * 1024) {
      mem.set(u, out); memBytes += buf.length;
      for (const [k, v] of mem) { if (memBytes <= 64 * 1024 * 1024 && Date.now() - v.at < TTL) break; mem.delete(k); memBytes -= v.buf.length; }
    }
    return out;
  }
}

const slug = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "gif";
export const fileName = (title, url, type) => `${slug(title)}-${createHash("sha1").update(String(url)).digest("hex").slice(0, 8)}${EXT[type] ?? ".gif"}`;
export async function cacheFile(url, { title = "gif", maxMB } = {}) {
  const dir = CACHE_DIR();
  mkdirSync(dir, { recursive: true });
  const stem = createHash("sha1").update(String(url)).digest("hex").slice(0, 8);
  const have = existsSync(dir) ? readdirSync(dir).find((f) => f.includes(`-${stem}.`)) : null;
  if (have) { const p = join(dir, have); try { const now = new Date(); utimesSync(p, now, now); } catch { /* fine */ } const t = Object.entries(EXT).find(([, e]) => have.endsWith(e))?.[0] ?? "image/gif"; return { path: p, name: have, type: t, bytes: statSync(p).size, cached: true }; }
  const m = await fetchMedia(url);
  const name = fileName(title, url, m.type);
  const path = resolve(dir, name);
  if (!path.startsWith(resolve(dir))) throw err("That file name isn't allowed.", 400);
  writeFileSync(path, m.buf);
  if (maxMB) pruneCache(maxMB, path);
  return { path, name, type: m.type, bytes: m.buf.length, cached: false };
}
export function cacheUsage() {
  const dir = CACHE_DIR(); let bytes = 0, files = 0;
  if (existsSync(dir)) for (const f of readdirSync(dir)) { try { bytes += statSync(join(dir, f)).size; files++; } catch { /* gone */ } }
  return { bytes, files, dir };
}
// oldest first, until the cache is under maxMB (the file just added is kept)
export function pruneCache(maxMB, keep = null) {
  const dir = CACHE_DIR(); if (!existsSync(dir)) return 0;
  const list = readdirSync(dir).map((f) => { const p = join(dir, f); try { const s = statSync(p); return { p, size: s.size, t: s.mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a, b) => a.t - b.t);
  let total = list.reduce((a, x) => a + x.size, 0), removed = 0;
  for (const x of list) { if (total <= maxMB * 1024 * 1024) break; if (x.p === keep) continue; try { rmSync(x.p, { force: true }); total -= x.size; removed++; } catch { /* in use */ } }
  return removed;
}
export function clearCache() {
  const dir = CACHE_DIR(); let removed = 0;
  if (existsSync(dir)) for (const f of readdirSync(dir)) { try { rmSync(join(dir, f), { force: true }); removed++; } catch { /* in use */ } }
  _clearMemory();
  return { removed };
}
