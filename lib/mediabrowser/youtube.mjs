// The Music & Video browser's YouTube: his watch history, subscriptions, playlists, Liked videos, Watch later, and live
// search (Videos · Channels · Playlists).
//   History, subscriptions and followed channels are read from youtube.com in the signed-in media window (lib/browser.mjs
//   youtubeFeed / youtubeApi; the Data API has no watch history). "Load more" is YouTube's own continuation, made inside
//   that page. Remove from history: YouTube's own "Remove from watch history" (the feedback token on each entry).
//   Search is keyless (lib/video/youtube.mjs: youtube.com's results page); a second "page" is the same search sorted by
//   views, then by date, with what's already shown left out.
// The parsers are pure (tests feed them fixture pages).
import * as yt from "../video/youtube.mjs";
import { secsOf, viewsOf, mmss, thumbOf, ageDays } from "../video/text.mjs";

const text = (t) => t?.simpleText ?? t?.runs?.map((r) => r.text).join("") ?? t?.content ?? "";
function walk(o, fn) {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { for (const x of o) walk(x, fn); return; }
  if (fn(o) === false) return;
  for (const k in o) walk(o[k], fn);
}
// the "Remove from watch history" token inside one entry
function feedbackToken(o) {
  let tok = null;
  walk(o, (x) => { if (tok) return false; const f = x.feedbackEndpoint?.feedbackToken; if (f) { tok = f; return false; } });
  return tok;
}
export function toItem(v, extra = {}) {
  if (!v?.videoId) return null;
  const secs = v.secs ?? secsOf(v.length);
  return { key: `yt:${v.videoId}${extra.day ? ":" + extra.day : ""}`, source: "youtube", kind: "video", videoId: v.videoId, title: v.title ?? "", sub: [v.channel, v.views, v.age].filter(Boolean).join(" · "),
    channel: v.channel ?? "", channelId: v.channelId ?? null, views: v.views ?? "", age: v.age ?? "", length: v.length || (secs ? mmss(secs) : ""), secs: secs ?? null, art: thumbOf(v.videoId), live: Boolean(v.live), short: Boolean(v.short || (secs && secs <= 60)), ...extra };
}
// one video entry (the older renderer, or the newer lockup) → { videoId, title, channel, … }
function readVideo(o) {
  const v = o.videoRenderer ?? o.gridVideoRenderer ?? o.compactVideoRenderer;
  if (v?.videoId) return { videoId: v.videoId, title: text(v.title), channel: text(v.ownerText ?? v.longBylineText ?? v.shortBylineText), channelId: v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? null,
    views: text(v.viewCountText) || text(v.shortViewCountText), age: text(v.publishedTimeText), length: text(v.lengthText), secs: secsOf(text(v.lengthText)), token: feedbackToken(v.menu ?? v) };
  const l = o.lockupViewModel;
  if (l && /VIDEO/.test(l.contentType ?? "")) {
    const md = l.metadata?.lockupMetadataViewModel;
    const rows = (md?.metadata?.contentMetadataViewModel?.metadataRows ?? []).flatMap((r) => (r.metadataParts ?? []).map((p) => p.text?.content ?? ""));
    let length = ""; walk(l.contentImage, (x) => { if (x.thumbnailBadgeViewModel && /^\d+(:\d{2}){1,2}$/.test(x.thumbnailBadgeViewModel.text ?? "")) length = x.thumbnailBadgeViewModel.text; });
    return { videoId: l.contentId, title: md?.title?.content ?? "", channel: rows.find((r) => !/views?|ago|watching/i.test(r)) ?? "", views: rows.find((r) => /views?|watching/i.test(r)) ?? "", age: rows.find((r) => /ago/i.test(r)) ?? "", length, secs: secsOf(length), token: feedbackToken(md?.menuButton ?? l) };
  }
  const s = o.reelItemRenderer ?? o.shortsLockupViewModel;
  if (s) { const id = s.videoId ?? s.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null; if (id) return { videoId: id, title: text(s.headline) || s.overlayMetadata?.primaryText?.content || "", channel: "", views: text(s.viewCountText) || s.overlayMetadata?.secondaryText?.content || "", age: "", length: "", secs: null, short: true, token: feedbackToken(s) }; }
  return null;
}
// a history page (or a continuation of one): day sections with their videos, and the token for more
//   → { sections: [{ title, items }], continuation }
export function parseHistory(data) {
  const sections = [];
  let continuation = null;
  const into = (title) => { let s = sections.at(-1); if (!s || (title && s.title !== title)) { s = { title: title || (s?.title ?? ""), items: [] }; sections.push(s); } return s; };
  walk(data, (o) => {
    if (o.continuationItemRenderer) { continuation = o.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token ?? continuation; return false; }
    if (o.itemSectionRenderer) {
      const s = o.itemSectionRenderer;
      const title = text(s.header?.itemSectionHeaderRenderer?.title) || text(s.header?.sectionHeaderViewModel?.headline) || s.header?.sectionHeaderViewModel?.headline?.content || "";
      const sec = into(title);
      walk(s.contents, (x) => { const v = readVideo(x); if (v) { sec.items.push(v); return false; } if (x.continuationItemRenderer) { continuation = x.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token ?? continuation; return false; } });
      return false;
    }
    const v = readVideo(o);
    if (v) { into("").items.push(v); return false; }
  });
  return { sections: sections.filter((s) => s.items.length), continuation };
}
// the channels he's subscribed to (/feed/channels)
export function parseChannels(data) {
  const out = [], seen = new Set();
  walk(data, (o) => {
    const c = o.channelRenderer ?? o.gridChannelRenderer;
    if (c?.channelId) { if (!seen.has(c.channelId)) { seen.add(c.channelId); out.push({ channelId: c.channelId, name: text(c.title), handle: (/@[\w.-]+/.exec(c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? text(c.subscriberCountText)) ?? [])[0] ?? null, subscribers: text(c.videoCountText) || text(c.subscriberCountText), thumb: (c.thumbnail?.thumbnails ?? []).at(-1)?.url ?? "" }); } return false; }
  });
  return out.map((c) => ({ key: `ytc:${c.channelId}`, source: "youtube", kind: "channel", channelId: c.channelId, handle: c.handle, title: c.name, sub: c.subscribers || "Channel", art: c.thumb ? (c.thumb.startsWith("//") ? "https:" + c.thumb : c.thumb) : "" }));
}
// a plain list of videos with its continuation (/feed/subscriptions)
export function parseVideoList(data) {
  const h = parseHistory(data);
  return { items: h.sections.flatMap((s) => s.items), continuation: h.continuation };
}

// ---- what reaches YouTube (tests replace these) ---------------------------------------------------------------------------
let deps = {
  browser: () => import("../browser.mjs"),
  signin: () => import("../mediasignin.mjs"),
  account: () => import("../video/account.mjs"),
  queue: () => import("../video/queue.mjs"),
};
export function _setDeps(d) { deps = { ...deps, ...d }; }
const signInError = () => Object.assign(new Error("Sign in to YouTube first: your history, subscriptions and playlists come from your YouTube account."), { signIn: "youtube" });
async function feed(path) {
  const b = await deps.browser();
  let r;
  try { r = await b.youtubeFeed(path); }
  catch (e) { if (/switched off/i.test(e.message)) throw Object.assign(new Error("The media window isn't available here, so your YouTube account can't be read."), { unavailable: true }); throw e; }
  const s = await deps.signin();
  if (r?.signedIn === false) { s.sawSignedOut("youtube"); throw signInError(); }
  return r.data;
}
async function more(token, extra = {}) {
  const b = await deps.browser();
  const j = await b.youtubeApi("browse", { continuation: token, ...extra });
  if (j?.error === 401 || j?.error === 403) { (await deps.signin()).sawSignedOut("youtube"); throw signInError(); }
  if (j?.error) throw new Error(`YouTube answered ${j.error}.`);
  return j;
}
const dayItems = (sections) => sections.flatMap((s) => s.items.map((v) => toItem(v, { day: s.title, removeToken: v.token ?? null })).filter(Boolean));

// watch history: { items (each with .day), next, sections: [day titles] }. query: search within his history
export async function history({ cursor = null, query = "" } = {}) {
  let parsed;
  if (cursor) parsed = parseHistory(await more(cursor));
  else if (query) { const data = await feed("/feed/history"); void data; parsed = parseHistory(await (await deps.browser()).youtubeApi("browse", { browseId: "FEhistory", query: String(query).slice(0, 100) })); }
  else parsed = parseHistory(await feed("/feed/history"));
  const items = dayItems(parsed.sections);
  return { items, next: parsed.continuation, total: null, days: parsed.sections.map((s) => s.title) };
}
export async function removeFromHistory(token) {
  if (!token) throw new Error("YouTube didn't offer a way to remove that one.");
  const b = await deps.browser();
  const j = await b.youtubeApi("feedback", { feedbackTokens: [token], isFeedbackTokenUnencrypted: false, shouldMerge: false });
  if (j?.error) throw new Error(`YouTube answered ${j.error}.`);
  const ok = j?.feedbackResponses?.[0]?.isProcessed !== false;
  if (!ok) throw new Error("YouTube didn't remove it.");
  return { removed: true };
}
// subscriptions: the channels (first page), and their latest videos
export async function subscriptions({ cursor = null, what = "videos" } = {}) {
  if (what === "channels") {
    if (cursor) { const j = await more(cursor); return { items: parseChannels(j), next: parseHistory(j).continuation, total: null }; }
    const data = await feed("/feed/channels");
    return { items: parseChannels(data), next: parseHistory(data).continuation, total: null };
  }
  const r = cursor ? parseVideoList(await more(cursor)) : parseVideoList(await feed("/feed/subscriptions"));
  return { items: r.items.map((v) => toItem(v)).filter(Boolean), next: r.continuation, total: null };
}
// his playlists (lib/video/account.mjs), and what's in one: offset pages of 50 of the whole list
const PAGE = 50;
export async function playlists() {
  const a = await deps.account();
  let list;
  try { list = await a.playlists({ fresh: false }); }
  catch (e) { if (e.signIn) throw signInError(); throw e; }
  return { items: list.map((p) => ({ key: `ytp:${p.playlistId}`, source: "youtube", kind: "ytplaylist", playlistId: p.playlistId, title: p.title, sub: p.special === "liked" ? "Liked videos" : p.special === "watchlater" ? "Watch later" : p.count != null ? `${p.count} videos` : "Playlist", art: "", count: p.count ?? null, special: p.special ?? null })), next: null, total: list.length };
}
const listCache = new Map();
export async function playlistItems(playlistId, { cursor = 0, title = "" } = {}) {
  const a = await deps.account();
  const off = Number(cursor) || 0;
  let all = listCache.get(playlistId);
  if (!all || !off) {
    try { all = await a.items({ playlistId, title }); }
    catch (e) { if (e.signIn || /sign/i.test(e.message)) throw signInError(); throw e; }
    listCache.set(playlistId, all);
  }
  const items = all.slice(off, off + PAGE).map((v, i) => toItem(v, { pos: off + i + 1, fromPlaylist: playlistId })).filter(Boolean);
  return { items, next: off + PAGE < all.length ? off + PAGE : null, total: all.length };
}
export const liked = (o = {}) => playlistItems("LL", { ...o, title: "Liked videos" });
export const watchLater = (o = {}) => playlistItems("WL", { ...o, title: "Watch later" });
export async function queue() {
  const q = await deps.queue();
  const s = q.get();
  return { items: s.items.map((x) => ({ ...toItem({ videoId: x.videoId, title: x.title, channel: x.channel, length: x.length, secs: x.secs }, { queueN: x.n, current: x.current }), key: `ytq:${x.id}` })).filter((x) => x.videoId), next: null, total: s.total, index: s.index, source: s.source };
}

// ---- search: Videos · Channels · Playlists -----------------------------------------------------------------------------------
export const GROUP_TITLE = { video: "Videos", channel: "Channels", ytplaylist: "Playlists" };
// filters: { duration: "short"|"medium"|"long", date: "today"|"week"|"month"|"year", noShorts: bool, sort: "relevance"|"newest"|"popular" }
const DAYS = { today: 1, week: 7, month: 31, year: 366 };
export function passes(x, f = {}) {
  if (f.noShorts && x.short) return false;
  if (f.duration && x.secs) { if (f.duration === "short" && x.secs >= 240) return false; if (f.duration === "medium" && (x.secs < 240 || x.secs > 1200)) return false; if (f.duration === "long" && x.secs <= 1200) return false; }
  if (f.duration && !x.secs && !x.live) return false;
  if (f.date && x.age) { const d = ageDays(x.age); if (d != null && d > DAYS[f.date]) return false; }
  return true;
}
async function videos(q, f = {}, page = 0, have = new Set()) {
  const sort = page === 1 ? (f.sort === "popular" ? "newest" : "popular") : page >= 2 ? (f.sort === "newest" ? "relevance" : "newest") : f.sort ?? "relevance";
  const found = await yt.search(q, { popular: sort === "popular", newest: sort === "newest", recentDays: f.date ? DAYS[f.date] : undefined, shorts: f.noShorts ? false : undefined, kind: "video", max: 25 }).catch(() => []);
  return found.map((v) => toItem({ ...v, secs: v.secs ?? secsOf(v.length) })).filter((x) => x && !have.has(x.videoId) && passes(x, f));
}
export async function search(q, { only = null, from = 0, filters = {}, have = [] } = {}) {
  const words = String(q ?? "").trim().slice(0, 200);
  if (!words) return { groups: [] };
  const seen = new Set(have);
  if (only === "video") { const page = Number(from) || 0; const items = await videos(words, filters, page, seen); return { groups: [{ id: "video", title: GROUP_TITLE.video, items, next: page < 2 && items.length ? page + 1 : null }] }; }
  const [vids, chans, pls] = await Promise.all([
    only && only !== "video" ? [] : videos(words, filters, 0, seen),
    only && only !== "channel" ? [] : yt.channels(words).catch(() => []),
    only && only !== "ytplaylist" ? [] : yt.search(words, { kind: "playlist", max: 12 }).catch(() => []),
  ]);
  const groups = [
    { id: "video", title: GROUP_TITLE.video, items: vids, next: vids.length ? 1 : null },
    { id: "channel", title: GROUP_TITLE.channel, items: chans.slice(0, 12).map((c) => ({ key: `ytc:${c.channelId}`, source: "youtube", kind: "channel", channelId: c.channelId, handle: c.handle, title: c.name, sub: [c.subscribersText, c.verified ? "✓" : ""].filter(Boolean).join(" "), art: "" })), next: null },
    { id: "ytplaylist", title: GROUP_TITLE.ytplaylist, items: pls.filter((p) => p.playlistId).map((p) => ({ key: `ytp:${p.playlistId}`, source: "youtube", kind: "ytplaylist", playlistId: p.playlistId, title: p.title, sub: [p.channel, p.count ? `${p.count} videos` : ""].filter(Boolean).join(" · "), art: p.videoId ? thumbOf(p.videoId) : p.thumb ?? "" })), next: null },
  ];
  return { groups: groups.filter((g) => g.items.length) };
}
// a channel's page inside the browser: its newest videos (and its live streams)
export async function channelPage({ channelId, handle, title }) {
  const r = await yt.channelVideos({ channelId, handle }, { max: 60 });
  const name = r.channel.name || title || "Channel";
  return { head: { key: `ytc:${channelId ?? handle}`, source: "youtube", kind: "channel", channelId: r.channel.channelId ?? channelId, handle: r.channel.handle ?? handle, title: name, sub: "Newest videos" },
    items: r.videos.map((v) => toItem({ ...v, channel: v.channel || name })).filter(Boolean), next: null, total: r.videos.length };
}
export async function publicPlaylistPage(playlistId) {
  const r = await yt.playlist(playlistId);
  return { head: { key: `ytp:${playlistId}`, source: "youtube", kind: "ytplaylist", playlistId, title: r.title || "Playlist", sub: `${r.items.length} videos` }, items: r.items.map((v, i) => toItem(v, { pos: i + 1, fromPlaylist: playlistId })).filter(Boolean), next: null, total: r.items.length };
}
