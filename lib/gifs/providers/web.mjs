// The keyless fallback: animated pictures from the web image search (lib/imagesearch.mjs, DuckDuckGo then Bing, with
// their "animated GIF" filter). No account and no key, so GIFs always work. The web isn't rated, so SafeSearch does the
// job: G and PG search with SafeSearch strict, PG-13 with moderate (or strict, if that's what picture search is set
// to), R with the picture-search setting. Each result is marked with the rating it was searched for.
import * as imgs from "../../imagesearch.mjs";
import { gifItem, ProviderError } from "../common.mjs";

export const id = "web";
export const label = "Web";
export const needsKey = false;
export const keyVar = null;
export const supports = { search: true, trending: true, categories: false, stickers: true };
export const attribution = { text: "Web results via DuckDuckGo and Bing", url: null };
export const keyGuide = null;

export function safeFor(rating) {
  const pref = imgs.prefs().safeSearch;
  if (rating === "g" || rating === "pg") return "strict";
  if (rating === "r") return pref;
  return pref === "strict" ? "strict" : "moderate";
}
const GIFISH = /\.gif(?:$|[?#])|giphy\.com|tenor\.com|klipy\.com|imgur\.com\/\w+\.(?:gif|gifv|mp4)/i;
export function fromImageResult(x, { rating, type }) {
  if (!x || !(GIFISH.test(x.fullUrl ?? "") || GIFISH.test(x.thumbUrl ?? ""))) return null;
  const key = x.fullUrl ?? x.thumbUrl;
  let sid = "";
  try { const u = new URL(key); sid = Buffer.from(`${u.hostname}${u.pathname}`).toString("base64url").slice(-40); } catch { return null; }
  return gifItem({
    source: id, sourceId: sid, title: String(x.title ?? "").replace(/\.gif\b/gi, "").replace(/\s*[-|•·–—]\s*(GIF|Giphy|Tenor|Imgur|Tumblr).*$/i, "").trim() || x.sourceDomain,
    rating, type, width: x.width, height: x.height, preview: x.fullUrl, small: x.thumbUrl, still: x.thumbUrl, gif: x.fullUrl, page: x.sourcePage,
  });
}
const ORDER = ["ddg", "bing", "bingHeadless"];
// cursor: "engine:offset"
export async function search({ q, rating, type, cursor }, ctx) {
  const safe = safeFor(rating);
  const [startEngine, startOffset] = String(cursor ?? "").split(":");
  const f = { type: "gif" };
  const words = type === "sticker" ? `${q} sticker transparent` : `${q} gif`;
  const engines = startEngine && ORDER.includes(startEngine) ? [startEngine] : ORDER;
  let lastErr = null, refused = 0;
  for (const name of engines) {
    if (name === "bingHeadless" && (refused < 2 || process.env.DAYSPRING_NO_HEADLESS_SEARCH || ctx.noHeadless)) continue;
    try {
      const offset = Number(startOffset) || 0;
      const r = await imgs._engines[name](words, f, { offset, safe });
      const items = r.results.map((x) => fromImageResult(x, { rating, type })).filter(Boolean);
      if (items.length || r.results.length) return { items, cursor: r.next != null ? `${name}:${r.next}` : null };
    } catch (e) { lastErr = e; refused++; }
  }
  if (lastErr) throw new ProviderError("unavailable", "web search couldn't be reached", { retry: false });
  return { items: [], cursor: null };
}
export async function trending({ rating, type, cursor }, ctx) {
  return search({ q: type === "sticker" ? "funny reaction" : "trending reaction", rating, type, cursor }, ctx);
}
export async function test(ctx) {
  await search({ q: "hello", rating: "g", type: "gif" }, ctx);
  return true;
}
