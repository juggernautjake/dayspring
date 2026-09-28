// Shared pieces for the GIF providers (lib/gifs/providers/*.mjs) and the engine (lib/gifs/index.mjs).
//   RATINGS, ratingOk(item, max), cleanRating(r)       the content ratings, G < PG < PG-13 < R
//   gifItem({...})                                      one result in the common shape every provider returns
//   getJSON(url, { headers, signal })                   a provider's JSON answer, with the error kinds the engine needs
//   ProviderError                                       kind: "invalid-key" | "rate-limited" | "unavailable" | "timeout" | "error"
// A result's addresses are checked here (http(s), a public-looking name); every picture still goes through the safe
// media proxy (lib/gifs/media.mjs), never straight to the screen.
import { safeUrl } from "../web.mjs";
import { isIP } from "node:net";

export const RATINGS = ["g", "pg", "pg-13", "r"];
export const cleanRating = (r, fallback = null) => {
  const s = String(r ?? "").toLowerCase().trim().replace(/^pg13$/, "pg-13").replace(/^y$/, "g");
  return RATINGS.includes(s) ? s : fallback;
};
// an item without a rating is never shown: each provider says what its results are (or what it filtered them to)
export const ratingOk = (item, max = "pg-13") => {
  const r = cleanRating(item?.rating), m = cleanRating(max, "pg-13");
  return r !== null && RATINGS.indexOf(r) <= RATINGS.indexOf(m);
};

const LOCAL_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp|.*\.intranet)$/i;
// quick address check without DNS (the full check happens when anything is fetched)
export function publicUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(safeUrl(String(u)));
    const h = url.hostname.replace(/^\[|\]$/g, "");
    if (!h || LOCAL_NAME.test(h) || (!h.includes(".") && !isIP(h)) || isIP(h)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
const decode = (s) => String(s ?? "").replace(/&(amp|lt|gt|quot|apos|#39);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" })[e] ?? m);
// titles are plain text (the screen only ever sets them as text too)
export const plainText = (s, max = 140) => decode(String(s ?? "").replace(/<[^>]*>/g, " ")).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const num = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

// The common shape. id is "<source>:<the provider's own id>"; key is what duplicates are recognised by.
export function gifItem({ source, sourceId, title, tags = [], rating, type = "gif", width, height, preview, previewWidth, previewHeight, small, still, gif, mp4, webp, page, bytes, canonical }) {
  const g = publicUrl(gif), m = publicUrl(mp4), w = publicUrl(webp), p = publicUrl(preview) ?? g ?? w;
  if (!p || !(g || m || w) || !sourceId) return null;
  const id = `${source}:${String(sourceId).replace(/[^\w.-]/g, "").slice(0, 80)}`;
  if (id.length <= source.length + 1) return null;
  return {
    id, source, sourceId: String(sourceId).slice(0, 80), title: plainText(title) || "Untitled GIF",
    tags: [...new Set((Array.isArray(tags) ? tags : []).map((t) => plainText(typeof t === "string" ? t : t?.name ?? t?.tag ?? "", 40).toLowerCase()).filter(Boolean))].slice(0, 12),
    rating: cleanRating(rating), type: type === "sticker" ? "sticker" : "gif",
    width: num(width) ?? num(previewWidth), height: num(height) ?? num(previewHeight),
    preview: p, previewSmall: publicUrl(small) ?? p, previewWidth: num(previewWidth) ?? num(width), previewHeight: num(previewHeight) ?? num(height),
    still: publicUrl(still), gif: g, mp4: m, webp: w, page: publicUrl(page), bytes: num(bytes),
    canonical: canonical ?? null,
  };
}

// the same GIF under another name: GIPHY's media addresses carry its id; any address without its query string
export function canonicalKeys(item) {
  const keys = new Set();
  if (item.canonical) keys.add(item.canonical);
  keys.add(item.id);
  for (const u of [item.gif, item.mp4, item.webp, item.preview]) {
    if (!u) continue;
    const g = /\/\/(?:[\w-]+\.)*giphy\.[a-z.]+\/(?:media\/(?:v\d[^/]*\/[^/]+\/)?|gifs\/(?:[\w-]*-)?)?([A-Za-z0-9]{2,40})(?:[/.?]|$)/.exec(u);
    if (g) keys.add(`giphy:${g[1]}`);
    const im = /i\.imgur\.com\/([A-Za-z0-9]{5,10})[a-z]?\.(?:gif|gifv|mp4|webp)/i.exec(u);
    if (im) keys.add(`imgur:${im[1]}`);
    try { const x = new URL(u); keys.add(`url:${x.hostname.replace(/^(www|media\d?|i)\./, "")}${x.pathname}`.toLowerCase()); } catch { /* not an address */ }
  }
  return [...keys];
}

export class ProviderError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Dayspring";
// fetchFn: the engine's (tests swap it). Never logs the address: some providers put the key in it.
export async function getJSON(fetchFn, url, { headers = {}, signal } = {}) {
  let r;
  try { r = await fetchFn(url, { headers: { "user-agent": UA, accept: "application/json", ...headers }, signal }); }
  catch (e) {
    const t = /abort|timeout/i.test(`${e?.name} ${e?.message}`);
    throw new ProviderError(t ? "timeout" : "unavailable", t ? "didn't answer in time" : "couldn't be reached", { retry: !t });
  }
  if (r.status === 429) {
    const ra = Number(r.headers.get("retry-after"));
    try { await r.body?.cancel(); } catch { /* fine */ }
    throw new ProviderError("rate-limited", "is busy (too many searches for now)", { retryAfterMs: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 3600) * 1000 : null });
  }
  if (r.status === 401 || r.status === 403) { try { await r.body?.cancel(); } catch { /* fine */ } throw new ProviderError("invalid-key", "didn't accept the key"); }
  if (r.status >= 500) { try { await r.body?.cancel(); } catch { /* fine */ } throw new ProviderError("unavailable", `answered ${r.status}`, { retry: true }); }
  if (!r.ok) { try { await r.body?.cancel(); } catch { /* fine */ } throw new ProviderError("error", `answered ${r.status}`); }
  try { return await r.json(); } catch { throw new ProviderError("error", "sent something that isn't JSON", { retry: true }); }
}
