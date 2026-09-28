// A pretend YouTube for scripts/qa/video.mjs, on 127.0.0.1 (never the real one): results pages (videos, channels,
// playlists, Shorts, newest, most viewed), channel pages (/@handle/videos, /channel/UC…/videos, /streams), playlist pages,
// the owner's playlists page (/feed/playlists), a YouTube Data API (/youtube/v3/…, which insists on a Bearer token) and a
// mock of the YouTube iframe player API for the screen (/iframe_api.js). Everything is made up here.
//   const m = await startMock(); m.url; m.search(query, opts) (the same results, for ytsearch's fake); m.calls; m.close()
import http from "node:http";
import { readFileSync } from "node:fs";

// ---- the made-up world --------------------------------------------------------------------------------------------------
let seq = 0;
const vid = (p) => { seq++; return (p + String(seq).padStart(4, "0") + "abcdefghijk").slice(0, 11).replace(/[^\w-]/g, "x"); };
const V = (title, channel, { views = 10000, age = "1 month ago", length = "12:00", live = false, tags = "" } = {}) => ({ videoId: vid(channel.replace(/[^A-Za-z]/g, "").slice(0, 3) || "vid"), title, channel, views, age, length: live ? "" : length, live, tags });
export const CHANNELS = [
  { channelId: "UCjmacClipsFan000000001", name: "John MacArthur Clips", handle: "@jmacclips", subs: "12K subscribers", verified: false },
  { channelId: "UCgtyNowGraceToYou00002", name: "Grace to You", handle: "@gracetoyou", subs: "1.1M subscribers", verified: true },
  { channelId: "UConeyMomentsFans000003", name: "Oney Plays Moments", handle: "@oneyplaysmoments", subs: "20K subscribers", verified: false },
  { channelId: "UConeyPlaysOfficial0004", name: "OneyPlays", handle: "@OneyPlays", subs: "3.2M subscribers", verified: true },
  { channelId: "UCacts17Apologetics0005", name: "Acts17Apologetics", handle: "@Acts17Apologetics", subs: "520K subscribers", verified: true },
  { channelId: "UCactsSeventeenFans0006", name: "Acts 17 Fan Page", handle: "@acts17fans", subs: "3K subscribers", verified: false },
  { channelId: "UCmikeWingerClips000007", name: "Mike Winger Clips", handle: "@mikewingerclips", subs: "8K subscribers", verified: false },
  { channelId: "UCmikeWingerOfficial008", name: "Mike Winger", handle: "@MikeWinger", subs: "610K subscribers", verified: true },
  { channelId: "UCligonierMinistries009", name: "Ligonier Ministries", handle: "@LigonierMinistries", subs: "700K subscribers", verified: true },
  { channelId: "UCveritasiumClips000010", name: "Veritasium Clips", handle: "@veritasiumclips", subs: "40K subscribers", verified: false },
  { channelId: "UCveritasiumOfficial011", name: "Veritasium", handle: "@veritasium", subs: "17M subscribers", verified: true },
  { channelId: "UCtruthForLifeBegg00012", name: "Truth For Life", handle: "@truthforlife", subs: "300K subscribers", verified: true },
];
// each official channel's uploads (newest first), some Shorts among them, and a live stream on one
const uploads = {
  "@gracetoyou": [
    V("Why Every Christian Should Read the Psalms (John MacArthur)", "Grace to You", { views: 90000, age: "2 days ago", length: "45:10" }),
    V("The Sufficiency of Scripture (Selected Scriptures)", "Grace to You", { views: 410000, age: "1 week ago", length: "52:03" }),
    V("#shorts What is grace?", "Grace to You", { views: 900000, age: "2 weeks ago", length: "0:42" }),
    V("The Gospel According to Jesus", "Grace to You", { views: 250000, age: "3 weeks ago", length: "58:44" }),
    V("Q&A with John MacArthur", "Grace to You", { views: 120000, age: "1 month ago", length: "1:02:11" }),
    V("Hope for Hard Times", "Grace to You", { views: 60000, age: "2 months ago", length: "41:00" }),
  ],
  "@OneyPlays": [
    V("OneyPlays Mario Party - Episode 12", "OneyPlays", { views: 800000, age: "1 day ago", length: "25:30" }),
    V("OneyPlays Mario Party - Episode 11", "OneyPlays", { views: 1400000, age: "4 days ago", length: "24:11" }),
    V("Oney Plays Animal Crossing (Funny Moments)", "OneyPlays", { views: 2600000, age: "1 week ago", length: "31:02" }),
    V("#shorts Chris gets mad", "OneyPlays", { views: 5000000, age: "1 week ago", length: "0:31" }),
    V("OneyPlays Gmod - Hide and Seek", "OneyPlays", { views: 700000, age: "2 weeks ago", length: "28:40" }),
  ],
  "@Acts17Apologetics": [
    V("Why I Became a Christian (Acts 17)", "Acts17Apologetics", { views: 300000, age: "3 days ago", length: "33:00" }),
    V("Debate Highlights (Acts 17)", "Acts17Apologetics", { views: 900000, age: "1 week ago", length: "18:20" }),
    V("Answering Objections Live", "Acts17Apologetics", { views: 150000, age: "2 weeks ago", length: "1:45:00" }),
  ],
  "@MikeWinger": [
    V("The Trinity Explained (Mike Winger)", "Mike Winger", { views: 450000, age: "5 days ago", length: "1:10:00" }),
    V("Is the Bible Reliable? A Deep Dive", "Mike Winger", { views: 380000, age: "2 weeks ago", length: "2:05:00" }),
    V("Bible Q&A Live", "Mike Winger", { views: 90000, age: "3 weeks ago", length: "1:30:00" }),
  ],
  "@LigonierMinistries": [V("R.C. Sproul: The Holiness of God", "Ligonier Ministries", { views: 1200000, age: "1 month ago", length: "23:00" })],
  "@veritasium": [V("The Most Misunderstood Concept in Physics", "Veritasium", { views: 9000000, age: "2 weeks ago", length: "27:15" })],
  "@truthforlife": [V("Alistair Begg: The Man in the Middle", "Truth For Life", { views: 300000, age: "1 week ago", length: "38:00" })],
};
const streams = { "@MikeWinger": [V("LIVE: Bible Q&A with Mike Winger", "Mike Winger", { views: 1200, age: "", live: true })] };
// the search corpus: topics, titles, and videos that merely MENTION the creators (which must never be picked for them)
const corpus = [
  ...Array.from({ length: 30 }, (_, i) => V(`Mountain Biking ${["Moab", "Whistler", "Sedona", "Utah", "the Alps", "Colorado"][i % 6]} Trail Ride part ${i + 1}`, ["Trail Riders", "Bike Life", "GMBN"][i % 3],
    { views: 5000 + i * 37000, age: `${(i % 11) + 1} ${i % 3 ? "months" : "weeks"} ago`, length: i % 5 === 0 ? "34:10" : i % 4 === 0 ? "6:20" : "14:05", tags: "biking bike cycling" })),
  V("#shorts Biking fail", "Bike Life", { views: 2000000, age: "3 days ago", length: "0:25", tags: "biking bike" }),
  ...Array.from({ length: 14 }, (_, i) => V(`Surfing ${["Pipeline", "Nazaré", "Bali", "Malibu"][i % 4]} Big Waves ${i + 1}`, ["Surf Daily", "WSL"][i % 2], { views: 20000 + i * 50000, age: `${i + 1} weeks ago`, length: i % 3 ? "11:11" : "26:00", tags: "surfing surf waves" })),
  V("How to Cut Dovetails by Hand", "Paul Sellers", { views: 3000000, age: "4 years ago", length: "22:15", tags: "dovetails woodworking joinery" }),
  V("Hand Cut Dovetails for Beginners", "Rex Krueger", { views: 800000, age: "2 years ago", length: "16:40", tags: "dovetails woodworking" }),
  V("Router Dovetail Jig Tutorial", "Woodworkers Guild", { views: 400000, age: "1 year ago", length: "12:30", tags: "dovetails jig" }),
  V("Half-Blind Dovetails Explained", "Paul Sellers", { views: 600000, age: "3 years ago", length: "19:05", tags: "dovetails" }),
  V("Bible Reading: Psalms 1-10 (KJV Audio)", "Scripture Daily", { views: 250000, age: "1 year ago", length: "28:30", tags: "bible reading psalms scripture" }),
  V("Reading the Psalms | Full Book | Audio Bible", "Audio Bible Channel", { views: 1200000, age: "3 years ago", length: "4:12:00", tags: "bible reading psalms" }),
  V("Psalm 23 Reading", "Scripture Daily", { views: 90000, age: "6 months ago", length: "3:10", tags: "psalm psalms bible reading" }),
  V("#shorts Psalm 23 in 30 seconds", "Quick Verses", { views: 3000000, age: "1 week ago", length: "0:30", tags: "psalms bible reading" }),
  V("Amazing Grace (My Chains Are Gone) - Chris Tomlin", "ChrisTomlinVEVO", { views: 90000000, age: "12 years ago", length: "5:02", tags: "amazing grace" }),
  V("Amazing Grace - Pentatonix", "PTXofficial", { views: 40000000, age: "6 years ago", length: "3:40", tags: "amazing grace" }),
  V("Amazing Grace (Documentary Trailer)", "Neon", { views: 2000000, age: "5 years ago", length: "2:20", tags: "amazing grace" }),
  V("The Bible Project - Episode 4: Exodus", "BibleProject", { views: 3000000, age: "5 years ago", length: "8:00", tags: "bible project episode" }),
  V("The Bible Project - Episode 5: Leviticus", "BibleProject", { views: 2500000, age: "5 years ago", length: "8:10", tags: "bible project episode" }),
  V("Reacting to John MacArthur's Most Famous Sermon", "Random Reacts", { views: 5000000, age: "2 days ago", length: "20:00", tags: "john macarthur reaction" }),
  V("John MacArthur Clips: Best Moments", "John MacArthur Clips", { views: 40000, age: "1 month ago", length: "10:00", tags: "john macarthur" }),
  V("Oney Plays Funniest Moments (Fan Compilation)", "Oney Plays Moments", { views: 9000000, age: "1 day ago", length: "12:00", tags: "oneyplays oney plays" }),
  V("Mike Winger EXPOSED? My Thoughts", "Drama Channel", { views: 7000000, age: "1 day ago", length: "15:00", tags: "mike winger" }),
  V("Reacting to the david wood debate", "Some Guy", { views: 6000000, age: "2 days ago", length: "30:00", tags: "david wood debate" }),
  V("LIVE: Morning Worship Stream", "Worship Nation", { views: 3400, age: "", live: true, tags: "worship live morning" }),
  V("Morning Worship Songs 2 Hours", "Worship Nation", { views: 900000, age: "1 year ago", length: "2:01:00", tags: "worship morning" }),
  ...Object.values(uploads).flat(),
];
export const PLAYLISTS = [
  { playlistId: "PLworshipSongs0000000001", title: "Worship Songs", count: 5, items: corpus.filter((x) => /worship|amazing grace/i.test(x.title)).slice(0, 5) },
  { playlistId: "PLworkoutMix000000000002", title: "Workout Mix", count: 4, items: corpus.filter((x) => /biking/i.test(x.title)).slice(0, 4) },
  { playlistId: "PLwoodworking00000000003", title: "Woodworking", count: 4, items: corpus.filter((x) => /dovetail/i.test(x.title)) },
  { playlistId: "PLsundaySermons000000004", title: "Sunday Sermons", count: 3, items: uploads["@gracetoyou"].slice(0, 3) },
  { playlistId: "LL", title: "Liked videos", count: 3, items: [uploads["@MikeWinger"][0], uploads["@OneyPlays"][2], corpus[40]] },
  { playlistId: "WL", title: "Watch later", count: 2, items: [corpus.find((x) => /Exodus/.test(x.title)), corpus.find((x) => /Leviticus/.test(x.title))] },
];
export const ALL = corpus;

// ---- search, the way YouTube's order goes ---------------------------------------------------------------------------------
const STOP = new Set("a an the of in on to for and or by with from video videos youtube".split(" "));
const wordsOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
const viewsText = (n) => `${n.toLocaleString("en-US")} views`;
const ageDays = (a) => { const m = /(\d+) (day|week|month|year)/.exec(a ?? ""); return m ? Number(m[1]) * { day: 1, week: 7, month: 30, year: 365 }[m[2]] : 0; };
export function search(query, { popular = false, newest = false, kind = "video", shorts = false, max = 20 } = {}) {
  const q = wordsOf(query);
  if (kind === "playlist") return PLAYLISTS.filter((p) => !["LL", "WL"].includes(p.playlistId) && q.some((w) => wordsOf(p.title).includes(w))).map((p) => ({ playlistId: p.playlistId, title: p.title, channel: "Someone", count: String(p.count) }));
  let hits = corpus.map((v, i) => ({ v, i, s: q.filter((w) => wordsOf(`${v.title} ${v.channel} ${v.tags}`).some((x) => x === w || (w.length > 4 && x.startsWith(w.slice(0, -1))))).length })).filter((h) => h.s > 0);
  if (shorts) hits = hits.filter((h) => /^0:\d\d$/.test(h.v.length));
  hits.sort((a, b) => (newest ? ageDays(a.v.age) - ageDays(b.v.age) : popular ? b.v.views - a.v.views : b.s - a.s || b.v.views - a.v.views));
  return hits.slice(0, max).map(({ v }) => ({ videoId: v.videoId, title: v.title, channel: v.channel, views: viewsText(v.views), age: v.age, length: v.length, live: v.live }));
}

// ---- the pages, as YouTube draws them (ytInitialData) ------------------------------------------------------------------------
const runs = (t) => ({ runs: [{ text: t }] });
const renderer = (v) => ({ videoRenderer: { videoId: v.videoId, title: runs(v.title), ownerText: runs(v.channel), viewCountText: { simpleText: v.live ? `${v.views} watching` : viewsText(v.views) }, publishedTimeText: v.age ? { simpleText: v.age } : undefined,
  lengthText: v.length ? { simpleText: v.length } : undefined, badges: v.live ? [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW", label: "LIVE" } }] : [] } });
const lockup = (v) => ({ lockupViewModel: { contentId: v.videoId, contentType: "LOCKUP_CONTENT_TYPE_VIDEO", contentImage: { thumbnailViewModel: { overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: v.length } }] } }] } },
  metadata: { lockupMetadataViewModel: { title: { content: v.title }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: viewsText(v.views) } }, { text: { content: v.age } }] }] } } } } } });
const page = (data) => `<!doctype html><html><head><title>YouTube</title></head><body><script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`;
export function resultsPage(query, sp) {
  const s = decodeURIComponent(sp ?? "");
  if (s === "EgIQAg==") {   // channels
    const q = wordsOf(query);
    const list = CHANNELS.filter((c) => q.some((w) => wordsOf(`${c.name} ${c.handle}`).some((x) => x === w || x.includes(w) || w.includes(x))) || c.name.toLowerCase().replace(/\s/g, "").includes(query.toLowerCase().replace(/[^a-z0-9]/g, "")));
    return page({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: list.map((c) => ({ channelRenderer: {
      channelId: c.channelId, title: { simpleText: c.name }, navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: "/" + c.handle } }, subscriberCountText: { simpleText: c.handle }, videoCountText: { simpleText: c.subs },
      ownerBadges: c.verified ? [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_VERIFIED", tooltip: "Verified" } }] : [] } })) } }] } } } } });
  }
  const opts = s === "CAISAhAB" ? { newest: true } : s.startsWith("CAMS") ? { popular: true } : s === "EgIQAw==" ? { kind: "playlist" } : s === "EgIYAQ==" ? { shorts: true } : {};
  const r = search(query, { ...opts, max: 20 });
  const items = opts.kind === "playlist" ? r.map((p) => ({ playlistRenderer: { playlistId: p.playlistId, title: { simpleText: p.title }, shortBylineText: runs(p.channel), videoCount: p.count } })) : r.map((x) => renderer(corpus.find((v) => v.videoId === x.videoId)));
  return page({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } } } } });
}
export function channelPage(ref, tab) {
  const c = CHANNELS.find((x) => x.handle.toLowerCase() === ref.toLowerCase() || x.channelId === ref);
  if (!c) return null;
  const list = (tab === "streams" ? streams[c.handle] : uploads[c.handle]) ?? [];
  const items = c.handle === "@MikeWinger" ? list.map((v) => ({ richItemRenderer: { content: lockup(v) } })) : list.map((v) => ({ richItemRenderer: { content: renderer(v) } }));   // (one channel in the newer layout)
  return page({ metadata: { channelMetadataRenderer: { title: c.name, externalId: c.channelId, vanityChannelUrl: `http://www.youtube.com/${c.handle}` } },
    contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: items } } } }] } } });
}
export function playlistData(id) {
  const p = PLAYLISTS.find((x) => x.playlistId === id);
  if (!p) return null;
  return { metadata: { playlistMetadataRenderer: { title: p.title } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ playlistVideoListRenderer: { contents: p.items.map((v, i) => ({ playlistVideoRenderer: {
    videoId: v.videoId, title: runs(v.title), shortBylineText: runs(v.channel), lengthText: { simpleText: v.length }, lengthSeconds: String(secs(v.length)), index: { simpleText: String(i + 1) }, isPlayable: true } })) } }] } }] } } } }] } } };
}
const secs = (l) => { const p = String(l ?? "").split(":").map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : 0; };
export function feedPlaylistsPage() {
  const mine = PLAYLISTS.filter((p) => !["LL", "WL"].includes(p.playlistId));
  return page({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: mine.map((p, i) => ({ richItemRenderer: { content: i % 2
    ? { lockupViewModel: { contentId: p.playlistId, contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST", metadata: { lockupMetadataViewModel: { title: { content: p.title } } } } }
    : { gridPlaylistRenderer: { playlistId: p.playlistId, title: runs(p.title) } } } })) } } } }] } } });
}

// ---- the Data API ------------------------------------------------------------------------------------------------------------
const API_PLAYLISTS = [
  { id: "PLapiWorship00000000001", title: "Worship (from the API)", items: PLAYLISTS[0].items },
  { id: "PLapiRoadTrip0000000002", title: "Road Trip Videos", items: PLAYLISTS[1].items },
];
function api(path, q, auth) {
  if (!/^Bearer qa-/.test(auth ?? "")) return [401, { error: { message: "Request is missing required authentication credential." } }];
  if (path === "/youtube/v3/playlists") return [200, { items: API_PLAYLISTS.map((p) => ({ id: p.id, snippet: { title: p.title }, contentDetails: { itemCount: p.items.length } })) }];
  if (path === "/youtube/v3/channels") return [200, { items: [{ contentDetails: { relatedPlaylists: { likes: "LLapiLiked0000000000003", uploads: "UU000" } } }] }];
  if (path === "/youtube/v3/playlistItems") {
    const id = q.get("playlistId");
    const p = API_PLAYLISTS.find((x) => x.id === id) ?? (id === "LLapiLiked0000000000003" ? { items: PLAYLISTS[4].items } : null);
    if (!p) return [404, { error: { message: "playlist not found" } }];
    return [200, { items: [...p.items.map((v) => ({ snippet: { title: v.title, videoOwnerChannelTitle: v.channel, resourceId: { videoId: v.videoId } }, contentDetails: { videoId: v.videoId } })), { snippet: { title: "Deleted video", resourceId: { videoId: "deletedxxxx" } }, contentDetails: { videoId: "deletedxxxx" } }] }];
  }
  if (path === "/youtube/v3/videos") return [200, { items: String(q.get("id") ?? "").split(",").map((id) => { const v = corpus.find((x) => x.videoId === id); return v ? { id, contentDetails: { duration: `PT${Math.floor(secs(v.length) / 60)}M${secs(v.length) % 60}S` } } : null; }).filter(Boolean) }];
  return [404, { error: { message: "no such endpoint" } }];
}

// ---- a pretend YouTube iframe player (for the Dayspring screen, headless) -------------------------------------------------
export const IFRAME_API = `(() => {
  const S = { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3, CUED: 5 };
  const all = [];
  class Player {
    constructor(el, o) {
      this.o = o; this.id = o.videoId ?? null; this.list = o.playerVars?.list ?? null; this.t = Number(o.playerVars?.start ?? 0); this.rate = 1; this.vol = 100; this.muted = false; this.state = -1;
      this.dur = 600; this.quality = "hd720"; this.levels = ["hd1080", "hd720", "large", "medium", "small", "tiny", "auto"]; this.modules = new Set(); this.captions = null; this.calls = []; this.loop = false; this.shuffle = false;
      const host = typeof el === "string" ? document.getElementById(el) : el;
      this.frame = document.createElement("iframe"); this.frame.id = typeof el === "string" ? el : "yt"; this.frame.dataset.mock = "yt"; host?.replaceWith(this.frame);
      if (o.playerVars?.cc_load_policy) this.modules.add("captions");
      all.push(this); window.__ytMock = this;
      setTimeout(() => { o.events?.onReady?.({ target: this }); }, 30);
    }
    _set(s) { this.state = s; this.o.events?.onStateChange?.({ target: this, data: s }); }
    _tick() { if (this.state === 1 && this._at) { this.t = Math.min(this.dur, this.t + (Date.now() - this._at) / 1000 * this.rate); } this._at = Date.now(); }
    playVideo() { this.calls.push("playVideo"); this._tick(); this._set(1); }
    pauseVideo() { this.calls.push("pauseVideo"); this._tick(); this._set(2); }
    stopVideo() { this.calls.push("stopVideo"); this._set(5); }
    seekTo(t) { this.calls.push("seekTo:" + Math.round(t)); this.t = t; this._at = Date.now(); if (this.state === 0) this._set(1); }
    getCurrentTime() { this._tick(); return this.t; }
    getDuration() { return this.dur; }
    getPlayerState() { return this.state; }
    getVideoData() { return { video_id: this.id ?? "listfirst00", title: window.__ytTitles?.[this.id] ?? "Mock video " + (this.id ?? this.list), author: window.__ytAuthors?.[this.id] ?? "Mock Channel" }; }
    setVolume(v) { this.vol = v; } getVolume() { return this.vol; } mute() { this.muted = true; } unMute() { this.muted = false; }
    setPlaybackRate(r) { this.calls.push("rate:" + r); this.rate = r; this.o.events?.onPlaybackRateChange?.({ target: this, data: r }); }
    getPlaybackRate() { return this.rate; } getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; }
    setPlaybackQuality(q) { this.calls.push("quality:" + q); this.quality = q; } getPlaybackQuality() { return this.quality; } getAvailableQualityLevels() { return this.levels.slice(); }
    loadModule(m) { this.calls.push("load:" + m); this.modules.add(m); } unloadModule(m) { this.calls.push("unload:" + m); this.modules.delete(m); this.captions = null; }
    setOption(m, k, v) { this.calls.push("option:" + m + ":" + k + ":" + JSON.stringify(v)); if (m === "captions" && k === "track") this.captions = v; }
    getOption(m, k) { if (m === "captions" && k === "tracklist") return [{ languageCode: "en", displayName: "English" }, { languageCode: "es", displayName: "Spanish" }]; return null; }
    nextVideo() { this.calls.push("nextVideo"); } previousVideo() { this.calls.push("previousVideo"); } setShuffle(b) { this.shuffle = b; } setLoop(b) { this.loop = b; }
    destroy() { this.calls.push("destroy"); this.frame?.remove(); }
    _end() { this.t = this.dur; this._set(0); }
  }
  window.YT = { Player, PlayerState: S };
  window.__ytAll = all;
  setTimeout(() => window.onYouTubeIframeAPIReady?.(), 10);
})();`;

// ---- the server ---------------------------------------------------------------------------------------------------------------
export async function startMock() {
  const calls = [], files = new Map();   // extra files for the browser tests: path → { path | body, type } (Range requests answered)
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    calls.push(`${req.method} ${u.pathname}${u.search}`);
    const html = (s, body) => { res.writeHead(s, { "content-type": "text/html; charset=utf-8" }); res.end(body); };
    const json = ([s, body]) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (files.has(u.pathname)) {
      const f = files.get(u.pathname), buf = f.body != null ? Buffer.from(f.body) : readFileSync(f.path);
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
      const head = { "content-type": f.type, "accept-ranges": "bytes", "access-control-allow-origin": "*" };
      if (!m) { res.writeHead(200, { ...head, "content-length": buf.length }); return res.end(buf); }
      const a = m[1] ? Number(m[1]) : Math.max(0, buf.length - Number(m[2])), b = m[1] && m[2] ? Math.min(buf.length - 1, Number(m[2])) : buf.length - 1;
      res.writeHead(206, { ...head, "content-range": `bytes ${a}-${b}/${buf.length}`, "content-length": b - a + 1 }); return res.end(buf.subarray(a, b + 1));
    }
    if (u.pathname.startsWith("/youtube/v3/")) return json(api(u.pathname, u.searchParams, req.headers.authorization));
    if (u.pathname === "/iframe_api.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(IFRAME_API); }
    if (u.pathname === "/results") return html(200, resultsPage(u.searchParams.get("search_query") ?? "", u.searchParams.get("sp")));
    if (u.pathname === "/playlist") { const d = playlistData(u.searchParams.get("list")); return d ? html(200, page(d)) : html(404, "no playlist"); }
    if (u.pathname === "/feed/playlists") return html(200, feedPlaylistsPage());
    let m;
    if ((m = /^\/(@[\w.-]+|channel\/(UC[\w-]+))\/(videos|streams)$/.exec(u.pathname))) { const p = channelPage(m[2] ?? decodeURIComponent(m[1]), m[3]); return p ? html(200, p) : html(404, "This channel doesn't exist."); }
    html(404, "not here");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return { url, calls, files, search, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}
export { page as pageHtml };
