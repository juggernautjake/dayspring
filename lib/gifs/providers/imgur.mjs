// Imgur (api.imgur.com): its gallery search can ask for animated pictures only (q_type=anigif). It needs a Client ID
// from a registered Imgur app (imgur.com/account/settings/apps). Imgur doesn't rate content, only marks some of it
// "mature" (nsfw): those count as R and the rest as PG-13, so Imgur is left out of G and PG searches. No stickers.
import { gifItem, getJSON } from "../common.mjs";

export const id = "imgur";
export const label = "Imgur";
export const needsKey = true;
export const keyVar = "IMGUR_CLIENT_ID";
export const supports = { search: true, trending: true, categories: false, stickers: false };
export const attribution = { text: "GIFs from Imgur", url: "https://imgur.com/" };
export const keyGuide = {
  url: "https://api.imgur.com/oauth2/addclient",
  steps: [
    "Sign in to Imgur, then open api.imgur.com/oauth2/addclient (Register an application).",
    "Name it \"Dayspring\", choose \"Anonymous usage without user authorization\", and enter any callback address (for example https://localhost).",
    "Copy the Client ID it shows (not the Client secret) and paste it here, then click Save key.",
    "Imgur doesn't rate GIFs, so its results only appear with the PG-13 or R setting.",
  ],
};
const BASE = "https://api.imgur.com";

export function parseItem(x, { rating = "pg-13" } = {}) {
  if (!x) return null;
  const im = x.is_album ? (Array.isArray(x.images) ? x.images.find((i) => i?.animated) : null) : x;
  if (!im || !im.animated) return null;
  const mature = Boolean(x.nsfw || im.nsfw);
  if (mature && rating !== "r") return null;
  const small = im.id ? `https://i.imgur.com/${im.id}t.jpg` : null;
  return gifItem({
    source: id, sourceId: im.id, title: x.title || im.title || im.description, tags: (x.tags ?? []).map((t) => t?.name ?? t), rating: mature ? "r" : "pg-13",
    width: im.width, height: im.height, preview: im.link, small: im.link, still: small, gif: im.link, mp4: im.mp4, page: x.link && /imgur\.com\/(gallery|a)\//.test(x.link) ? x.link : x.id ? `https://imgur.com/gallery/${x.id}` : null,
    bytes: im.size, canonical: im.id ? `imgur:${im.id}` : null,
  });
}
export function parse(json, { rating, page = 0 } = {}) {
  const list = Array.isArray(json?.data) ? json.data : [];
  const items = list.map((x) => parseItem(x, { rating })).filter(Boolean);
  return { items, cursor: list.length ? page + 1 : null };
}
const auth = (ctx) => ({ authorization: `Client-ID ${ctx.key}` });
export async function search({ q, rating, type, cursor }, ctx) {
  if (type === "sticker" || rating === "g" || rating === "pg") return { items: [], cursor: null };
  const page = Number(cursor) || 0;
  const json = await getJSON(ctx.fetch, `${ctx.base(id, BASE)}/3/gallery/search/top/all/${page}?${new URLSearchParams({ q, q_type: "anigif" })}`, { headers: auth(ctx), signal: ctx.signal });
  return parse(json, { rating, page });
}
export async function trending({ rating, type, cursor }, ctx) {
  if (type === "sticker" || rating === "g" || rating === "pg") return { items: [], cursor: null };
  const page = Number(cursor) || 0;
  const json = await getJSON(ctx.fetch, `${ctx.base(id, BASE)}/3/gallery/search/viral/week/${page}?${new URLSearchParams({ q: "reaction", q_type: "anigif" })}`, { headers: auth(ctx), signal: ctx.signal });
  return parse(json, { rating, page });
}
export async function test(ctx) {
  await getJSON(ctx.fetch, `${ctx.base(id, BASE)}/3/gallery/search/top/all/0?${new URLSearchParams({ q: "hello", q_type: "anigif" })}`, { headers: auth(ctx), signal: ctx.signal });
  return true;
}
