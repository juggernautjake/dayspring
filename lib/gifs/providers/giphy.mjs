// GIPHY (developers.giphy.com). A free key ("beta key", 100 searches an hour) is made in a minute at
// developers.giphy.com → Create an App → API. GIPHY asks for "Powered by GIPHY" wherever its results are shown.
//   search, trending, categories, stickers; the rating filter is GIPHY's own (rating=g|pg|pg-13|r is the highest allowed)
import { gifItem, getJSON } from "../common.mjs";

export const id = "giphy";
export const label = "GIPHY";
export const needsKey = true;
export const keyVar = "GIPHY_API_KEY";
export const supports = { search: true, trending: true, categories: true, stickers: true };
export const attribution = { text: "Powered by GIPHY", url: "https://giphy.com/" };
export const keyGuide = {
  url: "https://developers.giphy.com/dashboard/?create=true",
  steps: [
    "Go to developers.giphy.com and sign in (or make a free account).",
    "Click Create an App, choose API (not SDK), and give it a name like \"Dayspring\".",
    "Copy the API key it shows you and paste it here, then click Save key.",
    "A new key is a free \"beta\" key: up to 100 searches an hour, which is plenty for one home.",
  ],
};
const BASE = "https://api.giphy.com";

export function parseItem(x, { type = "gif" } = {}) {
  const im = x?.images ?? {};
  const fw = im.fixed_width ?? im.fixed_height ?? im.downsized ?? {};
  const small = im.fixed_width_small ?? im.fixed_width_downsampled ?? im.preview_gif ?? {};
  const orig = im.original ?? im.downsized_large ?? im.downsized ?? fw;
  return gifItem({
    source: id, sourceId: x?.id, title: x?.title || x?.alt_text || x?.slug?.replace(/-[A-Za-z0-9]+$/, "").replace(/-/g, " "),
    tags: Array.isArray(x?.tags) ? x.tags : [], rating: x?.rating, type: x?.is_sticker || type === "sticker" ? "sticker" : "gif",
    width: orig.width, height: orig.height, preview: fw.url ?? fw.webp, previewWidth: fw.width, previewHeight: fw.height, small: small.url,
    still: (im.fixed_width_still ?? im.original_still ?? {}).url, gif: orig.url, mp4: orig.mp4 ?? fw.mp4, webp: orig.webp ?? fw.webp,
    page: x?.url, bytes: orig.size, canonical: x?.id ? `giphy:${x.id}` : null,
  });
}
export function parse(json, opts) {
  const items = (Array.isArray(json?.data) ? json.data : []).map((x) => parseItem(x, opts)).filter(Boolean);
  const pg = json?.pagination ?? {};
  const offset = Number(pg.offset) || 0, count = Number(pg.count) || items.length, total = Number(pg.total_count);
  const next = count && (!Number.isFinite(total) || offset + count < total) ? offset + count : null;
  return { items, cursor: next };
}
export function parseCategories(json) {
  return (Array.isArray(json?.data) ? json.data : []).map((c) => ({ name: String(c?.name ?? "").slice(0, 40), query: String(c?.name ?? "").slice(0, 60), preview: c?.gif?.images?.fixed_width_small?.url ?? c?.gif?.images?.fixed_width?.url ?? null })).filter((c) => c.name);
}
const kind = (type) => (type === "sticker" ? "stickers" : "gifs");
const url = (ctx, path, p) => `${ctx.base(id, BASE)}${path}?${new URLSearchParams({ api_key: ctx.key, ...p })}`;

export async function search({ q, rating, type, cursor, limit = 25 }, ctx) {
  const json = await getJSON(ctx.fetch, url(ctx, `/v1/${kind(type)}/search`, { q, limit: String(limit), offset: String(Number(cursor) || 0), rating, lang: "en", bundle: "messaging_non_clips" }), { signal: ctx.signal });
  return parse(json, { type });
}
export async function trending({ rating, type, cursor, limit = 25 }, ctx) {
  const json = await getJSON(ctx.fetch, url(ctx, `/v1/${kind(type)}/trending`, { limit: String(limit), offset: String(Number(cursor) || 0), rating, bundle: "messaging_non_clips" }), { signal: ctx.signal });
  return parse(json, { type });
}
export async function categories(ctx) {
  return parseCategories(await getJSON(ctx.fetch, url(ctx, "/v1/gifs/categories", {}), { signal: ctx.signal }));
}
export async function test(ctx) {
  await getJSON(ctx.fetch, url(ctx, "/v1/gifs/search", { q: "hello", limit: "1", rating: "g" }), { signal: ctx.signal });
  return true;
}
