// KLIPY (klipy.com/developers): a free GIF, sticker and meme API, the usual replacement for Tenor (Google closed the
// Tenor API on June 30, 2026). The key goes in the address: /api/v1/{key}/gifs/search. KLIPY asks for its name to be
// shown with its results ("Powered by KLIPY"). Ads are never asked for, so none come back (any that do are skipped).
//   search, trending, categories, stickers; content_filter follows the rating
import { gifItem, getJSON, cleanRating } from "../common.mjs";

export const id = "klipy";
export const label = "KLIPY";
export const needsKey = true;
export const keyVar = "KLIPY_API_KEY";
export const supports = { search: true, trending: true, categories: true, stickers: true };
export const attribution = { text: "Powered by KLIPY", url: "https://klipy.com/" };
export const keyGuide = {
  url: "https://partner.klipy.com/",
  steps: [
    "Go to partner.klipy.com (KLIPY's Partner Panel) and make a free account.",
    "Add an app (any name, like \"Dayspring\") and open its API keys.",
    "Copy the key and paste it here, then click Save key.",
    "A new key is a test key (about 100 searches an hour). You can ask KLIPY for a production key, still free, if you ever need more.",
  ],
};
const BASE = "https://api.klipy.com";
const FILTER = { g: "high", pg: "high", "pg-13": "medium", r: "low" };

const pick = (f, size, fmt) => f?.[size]?.[fmt] ?? null;
export function parseItem(x, { type = "gif", rating } = {}) {
  if (!x || x.type === "ad") return null;
  const f = x.file ?? x.files ?? {};
  const big = pick(f, "hd", "gif") ?? pick(f, "md", "gif") ?? {}, mid = pick(f, "sm", "gif") ?? pick(f, "md", "gif") ?? big, tiny = pick(f, "xs", "gif") ?? mid;
  return gifItem({
    source: id, sourceId: x.slug ?? x.id, title: x.title, tags: x.tags ?? [], rating: cleanRating(x.rating) ?? cleanRating(rating), type: type === "sticker" || x.type === "sticker" ? "sticker" : "gif",
    width: big.width, height: big.height, preview: mid.url, previewWidth: mid.width, previewHeight: mid.height, small: tiny.url,
    gif: big.url, mp4: (pick(f, "hd", "mp4") ?? pick(f, "md", "mp4") ?? {}).url, webp: (pick(f, "hd", "webp") ?? pick(f, "md", "webp") ?? {}).url,
    page: x.slug ? `https://klipy.com/${type === "sticker" ? "stickers" : "gifs"}/${encodeURIComponent(x.slug)}` : null, bytes: big.size,
  });
}
export function parse(json, opts = {}) {
  const d = json?.data ?? {};
  const list = Array.isArray(d) ? d : Array.isArray(d.data) ? d.data : [];
  const items = list.map((x) => parseItem(x, opts)).filter(Boolean);
  const page = Number(d.current_page) || Number(opts.page) || 1;
  return { items, cursor: d.has_next ? page + 1 : null };
}
export function parseCategories(json) {
  const d = json?.data ?? {};
  const list = Array.isArray(d) ? d : Array.isArray(d.categories) ? d.categories : Array.isArray(d.data) ? d.data : [];
  return list.map((c) => ({ name: String(c?.category ?? c?.name ?? c?.title ?? "").slice(0, 40), query: String(c?.query ?? c?.searchterm ?? c?.category ?? c?.name ?? "").slice(0, 60), preview: c?.preview_url ?? c?.image ?? c?.image_url ?? null })).filter((c) => c.name);
}
const kind = (type) => (type === "sticker" ? "stickers" : "gifs");
const url = (ctx, path, p) => `${ctx.base(id, BASE)}/api/v1/${encodeURIComponent(ctx.key)}${path}?${new URLSearchParams(p)}`;
const common = (ctx, rating) => ({ customer_id: ctx.customerId || "dayspring", locale: "en_US", content_filter: FILTER[rating] ?? "medium", rating: rating ?? "pg-13" });

export async function search({ q, rating, type, cursor, limit = 24 }, ctx) {
  const page = Number(cursor) || 1;
  const json = await getJSON(ctx.fetch, url(ctx, `/${kind(type)}/search`, { q, page: String(page), per_page: String(Math.max(8, Math.min(50, limit))), ...common(ctx, rating) }), { signal: ctx.signal });
  return parse(json, { type, rating, page });
}
export async function trending({ rating, type, cursor, limit = 24 }, ctx) {
  const page = Number(cursor) || 1;
  const json = await getJSON(ctx.fetch, url(ctx, `/${kind(type)}/trending`, { page: String(page), per_page: String(Math.max(8, Math.min(50, limit))), ...common(ctx, rating) }), { signal: ctx.signal });
  return parse(json, { type, rating, page });
}
export async function categories(ctx) {
  return parseCategories(await getJSON(ctx.fetch, url(ctx, "/gifs/categories", { locale: "en_US" }), { signal: ctx.signal }));
}
export async function test(ctx) {
  const j = await getJSON(ctx.fetch, url(ctx, "/gifs/search", { q: "hello", page: "1", per_page: "8", ...common(ctx, "g") }), { signal: ctx.signal });
  if (j && j.result === false) throw Object.assign(new Error("didn't accept the key"), { kind: "invalid-key" });
  return true;
}
