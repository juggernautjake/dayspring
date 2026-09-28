// Reading YouTube for videos, channels and playlists, with nothing opening on screen:
//   search(query, opts)              videos or playlists (lib/ytsearch.mjs: the results page, no key; the Data API if a key is set)
//   channels(query)                  channels by name → [{ channelId, name, handle, subscribers, verified }]
//   channelVideos(channel, { max })  a channel's newest uploads → [{ videoId, title, views, age, length, secs, … }]
//   playlist(playlistId)             a public playlist's videos → { title, items: [...] }
// Keyless: youtube.com's own pages (the ytInitialData they carry), read by the pure parsers below (tests feed them
// fixture pages through DAYSPRING_YT_BASE, a local mock). With a Google account connected that has the YouTube scope,
// or a Data API key, the Data API (api.* below) is used for the owner's own playlists (DAYSPRING_YT_API for tests).
import * as ytsearch from "../ytsearch.mjs";
import { initialData } from "../../vendor/ecosystem-core/lib/ytsearch.mjs";
import { secsOf, viewsOf, mmss } from "./text.mjs";

const BASE = () => (process.env.DAYSPRING_YT_BASE || "https://www.youtube.com").replace(/\/$/, "");
const API = () => (process.env.DAYSPRING_YT_API || "https://www.googleapis.com/youtube/v3").replace(/\/$/, "");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const text = (t) => t?.simpleText ?? t?.runs?.map((r) => r.text).join("") ?? t?.content ?? "";
export const SP_CHANNEL = "EgIQAg%3D%3D";

async function getPage(path) {
  const r = await fetch(BASE() + path, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw Object.assign(new Error(`YouTube answered ${r.status}`), { status: r.status });
  const data = initialData(await r.text());
  if (!data) throw new Error("YouTube didn't send the page (a consent or check page?)");
  return data;
}

// ---- the parsers (pure; tests) ----------------------------------------------------------------------------------------
function walk(o, fn) {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { for (const x of o) walk(x, fn); return; }
  if (fn(o) === false) return;
  for (const k in o) walk(o[k], fn);
}
const verifiedIn = (badges) => (badges ?? []).some((b) => /VERIFIED/.test(b.metadataBadgeRenderer?.style ?? "") || /verified/i.test(b.metadataBadgeRenderer?.tooltip ?? ""));
const handleOf = (s) => { const m = /@[\w.-]{2,}/.exec(String(s ?? "")); return m ? m[0] : null; };

// channels in a results page (sp=channel)
export function parseChannels(data) {
  const out = [], seen = new Set();
  walk(data?.contents ?? data, (o) => {
    if (!o.channelRenderer) return;
    const c = o.channelRenderer, subs = [text(c.subscriberCountText), text(c.videoCountText)].find((s) => /subscriber/i.test(s)) ?? "";
    const handle = handleOf(c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl) ?? handleOf(text(c.subscriberCountText));
    if (!c.channelId || seen.has(c.channelId)) return false;
    seen.add(c.channelId);
    out.push({ channelId: c.channelId, name: text(c.title), handle, subscribers: viewsOf(subs), subscribersText: subs, verified: verifiedIn(c.ownerBadges), description: text(c.descriptionSnippet).slice(0, 200) });
    return false;
  });
  return out;
}
const videoOf = (v, extra = {}) => ({ videoId: v.videoId, title: text(v.title), channel: text(v.ownerText ?? v.longBylineText ?? v.shortBylineText) || extra.channel || "", views: text(v.viewCountText) || text(v.shortViewCountText),
  age: text(v.publishedTimeText), length: text(v.lengthText) || (v.lengthSeconds ? mmss(v.lengthSeconds) : ""), secs: v.lengthSeconds ? Number(v.lengthSeconds) : secsOf(text(v.lengthText)),
  live: (v.badges ?? []).some((b) => /LIVE/.test(b.metadataBadgeRenderer?.style ?? "")) || /watching/i.test(text(v.viewCountText)), ...extra });
// a lockup (YouTube's newer layout): what it can tell
function lockupVideo(l, extra = {}) {
  const md = l.metadata?.lockupMetadataViewModel;
  const rows = (md?.metadata?.contentMetadataViewModel?.metadataRows ?? []).flatMap((r) => (r.metadataParts ?? []).map((p) => p.text?.content ?? ""));
  let length = "";
  walk(l.contentImage, (o) => { if (o.thumbnailBadgeViewModel && /^\d+(:\d{2}){1,2}$/.test(o.thumbnailBadgeViewModel.text ?? "")) length = o.thumbnailBadgeViewModel.text; });
  return { videoId: l.contentId, title: md?.title?.content ?? "", channel: extra.channel ?? rows.find((r) => !/views?|ago|watching/i.test(r)) ?? "", views: rows.find((r) => /views?|watching/i.test(r)) ?? "",
    age: rows.find((r) => /ago/i.test(r)) ?? "", length, secs: secsOf(length), live: rows.some((r) => /watching/i.test(r)), ...extra };
}
// a channel's /videos (or /streams) page
export function parseChannelVideos(data) {
  const meta = data?.metadata?.channelMetadataRenderer ?? {};
  const channel = { channelId: meta.externalId ?? null, name: meta.title ?? "", handle: handleOf(meta.vanityChannelUrl) };
  const out = [], seen = new Set();
  walk(data?.contents ?? data, (o) => {
    const v = o.videoRenderer ?? o.gridVideoRenderer;
    if (v?.videoId) { if (!seen.has(v.videoId)) { seen.add(v.videoId); out.push(videoOf(v, { channel: channel.name })); } return false; }
    if (o.lockupViewModel && /VIDEO/.test(o.lockupViewModel.contentType ?? "")) { const x = lockupVideo(o.lockupViewModel, { channel: channel.name }); if (x.videoId && !seen.has(x.videoId)) { seen.add(x.videoId); out.push(x); } return false; }
    if (o.reelItemRenderer || o.shortsLockupViewModel) return false;   // Shorts: not here
  });
  return { channel, videos: out };
}
// a playlist page
export function parsePlaylist(data) {
  const title = data?.metadata?.playlistMetadataRenderer?.title ?? text(data?.header?.playlistHeaderRenderer?.title) ?? "";
  const out = [], seen = new Set();
  walk(data?.contents ?? data, (o) => {
    const v = o.playlistVideoRenderer;
    if (v?.videoId) { if (!seen.has(v.videoId) && v.isPlayable !== false) { seen.add(v.videoId); out.push(videoOf(v)); } return false; }
    if (o.lockupViewModel && /VIDEO/.test(o.lockupViewModel.contentType ?? "")) { const x = lockupVideo(o.lockupViewModel); if (x.videoId && !seen.has(x.videoId)) { seen.add(x.videoId); out.push(x); } return false; }
  });
  return { title, items: out };
}

// ---- keyless reads ----------------------------------------------------------------------------------------------------
// videos or playlists: lib/ytsearch.mjs (its fake answers in tests)
export async function search(query, opts = {}) {
  const list = await ytsearch.search(query, opts);
  return (list ?? []).map((x) => ({ ...x, secs: x.secs ?? secsOf(x.length), viewCount: viewsOf(x.views) }));
}
export async function channels(query) {
  return parseChannels(await getPage(`/results?search_query=${encodeURIComponent(query)}&sp=${SP_CHANNEL}&hl=en&gl=US`));
}
// channel: { handle: "@x" } or { channelId: "UC…" }; tab "videos" (uploads, newest first) or "streams"
export async function channelVideos(channel, { tab = "videos", max = 30 } = {}) {
  const path = channel.handle ? `/${encodeURIComponent(channel.handle).replace(/^%40/, "@")}/${tab}` : `/channel/${encodeURIComponent(channel.channelId)}/${tab}`;
  const r = parseChannelVideos(await getPage(path + "?hl=en&gl=US"));
  r.videos = r.videos.slice(0, max).map((v) => ({ ...v, viewCount: viewsOf(v.views) }));
  return r;
}
export async function playlist(playlistId) {
  if (!/^[\w-]{2,64}$/.test(String(playlistId ?? ""))) throw new Error("That isn't a playlist id.");
  return parsePlaylist(await getPage(`/playlist?list=${encodeURIComponent(playlistId)}&hl=en&gl=US`));
}

// ---- the Data API (the owner's own playlists, when an account with the YouTube scope is connected) ----------------------
// token: an OAuth access token (Authorization: Bearer); key: a Data API key (public data only)
async function apiGet(path, params, { token = null, key = null, fetcher = null } = {}) {
  const q = new URLSearchParams(params);
  if (key && !token) q.set("key", key);
  const url = `${API()}/${path}?${q}`;
  const r = fetcher ? await fetcher(url) : await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`YouTube: ${j.error?.message ?? r.status}`), { status: r.status });
  return j;
}
export const api = {
  // the owner's playlists, and Liked videos (the account's "likes" list)
  async myPlaylists(auth) {
    const out = [];
    let page = "";
    for (let i = 0; i < 4; i++) {
      const j = await apiGet("playlists", { part: "snippet,contentDetails", mine: "true", maxResults: "50", ...(page ? { pageToken: page } : {}) }, auth);
      for (const it of j.items ?? []) out.push({ playlistId: it.id, title: it.snippet?.title ?? "", count: it.contentDetails?.itemCount ?? null, via: "api" });
      page = j.nextPageToken; if (!page) break;
    }
    const ch = await apiGet("channels", { part: "contentDetails", mine: "true" }, auth).catch(() => null);
    const likes = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.likes;
    if (likes) out.unshift({ playlistId: likes, title: "Liked videos", special: "liked", via: "api" });
    return out;
  },
  async playlistItems(playlistId, auth, max = 200) {
    const out = [];
    let page = "";
    for (let i = 0; i < Math.ceil(max / 50); i++) {
      const j = await apiGet("playlistItems", { part: "snippet,contentDetails", playlistId, maxResults: "50", ...(page ? { pageToken: page } : {}) }, auth);
      for (const it of j.items ?? []) {
        const vid = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
        if (vid && !/^(Private|Deleted) video$/.test(it.snippet?.title ?? "")) out.push({ videoId: vid, title: it.snippet?.title ?? "", channel: it.snippet?.videoOwnerChannelTitle ?? "" });
      }
      page = j.nextPageToken; if (!page) break;
    }
    // lengths, in one more call per 50
    for (let i = 0; i < out.length; i += 50) {
      const ids = out.slice(i, i + 50).map((x) => x.videoId).join(",");
      const d = await apiGet("videos", { part: "contentDetails", id: ids }, auth).catch(() => null);
      for (const v of d?.items ?? []) { const x = out.find((y) => y.videoId === v.id); if (x) x.secs = isoSecs(v.contentDetails?.duration); }
    }
    return out;
  },
};
// "PT1H2M15S" → 3735
export const isoSecs = (d) => { const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(d ?? "")); return m ? (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0)) : null; };
