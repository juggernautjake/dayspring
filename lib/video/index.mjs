// Videos: finding them, creators' channels, browsing, the owner's YouTube playlists, the queue, and playback control.
//   command(text, { surface }) → { reply, listen?, intent } | null     the no-AI side (server.mjs asks it first, before
//        the Bible reader, music and pictures, so "find bible reading in psalms on youtube" is a video search)
//   play(req) · browse(req) · queueRequest(req) · playlistPlay(name, opts) · listPlaylists() · queueCommand(op) · control(...)
//   TOOLS / runTool(name, input)                                           the AI's tools
// Like lib/music: understand the request (parse.mjs), find candidates (youtube.mjs, creators.mjs), rank them
// (rank.mjs), play the best, and when it isn't sure show the top 3 ("number 2"). "Not that" moves on and is remembered
// (prefs.mjs). What plays goes through the queue (queue.mjs), which the screen shows (public/videos.js).
// The study rule (media.policyNow) still applies: no videos during a study block.
// Gated by the "videosearch" feature (lib/features.mjs); the playback controls are not (they work for every player).
import * as media from "../media.mjs";
import * as spotifyApi from "../spotify-api.mjs";
import { on as featureOn } from "../features.mjs";
import { broadcast as busBroadcast, clientCount } from "../bus.mjs";
import * as videolists from "../videolists.mjs";
import * as P from "./parse.mjs";
import * as controls from "./controls.mjs";
import * as creators from "./creators.mjs";
import * as yt from "./youtube.mjs";
import * as R from "./rank.mjs";
import * as prefs from "./prefs.mjs";
import * as queue from "./queue.mjs";
import * as account from "./account.mjs";
import { nameSim, covers, listNames, thumbOf, spokenLength, norm } from "./text.mjs";

export { queue, account, creators, controls };
export const FEATURE = "videosearch";
export const enabled = () => featureOn(FEATURE);

let deps = {
  broadcast: busBroadcast,
  screens: () => clientCount(),
  spotifyReady: () => { try { return spotifyApi.ready(); } catch { return false; } },
  // when the picture or GIF grid was last shown (so "number 3" goes to whichever is newer on the screen)
  othersAt: async () => { let t = 0; try { const ir = await import("../image-routes.mjs"); const v = ir.current(); if (v && !v.closed) t = Math.max(t, v.at ?? 0); } catch { /* none */ } try { const g = await import("../gifs/routes.mjs"); const v = g.current(); if (v && !v.closed) t = Math.max(t, v.at ?? 0); } catch { /* none */ } return t; },
};
export function _setDeps(d) { deps = { ...deps, ...d }; }
const broadcast = (...a) => deps.broadcast(...a);
queue.onChange((s, what) => broadcast("vqueue", { queue: s, what }));

const FRESH_MS = 20 * 60_000, ASK_MS = 3 * 60_000, GRID_MS = 15 * 60_000;
let session = null;        // the last thing looked for: { req, key, ranked, index, asking, channel, creator, at }
let grid = null;           // what the video grid on the screen shows: { id, at, title, kind, req, items, shown, ask, closed }
let queueShownAt = 0;
export function _reset() { session = null; grid = null; queueShownAt = 0; }
export const state = () => ({ session, grid, queueShownAt });

// ---- helpers ---------------------------------------------------------------------------------------------------------
const said = (x) => `${x.title}${x.channel ? `, from ${x.channel}` : ""}`;
const clip = (s, n = 70) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + "…" : String(s));
const qinfo = () => { const s = queue.get(); return { index: s.index, total: s.total, repeat: s.repeat, shuffle: s.shuffle }; };
function start(x, { audioOnly = false, fromQueue = null } = {}) {
  // the study rule first (it throws with the reason)
  const cmd = media.playCommand({ videoId: x.videoId, playlistId: x.videoId ? null : x.playlistId, title: x.title, audioOnly, shuffle: Boolean(x.shuffle) });
  const q = fromQueue ?? queue.playNow(x);
  cmd.channel = x.channel ?? "";
  cmd.fromQueue = true; cmd.queueN = q.n; cmd.queue = qinfo();
  broadcast("media", cmd);
  return cmd;
}
const playingNow = () => media.playerState();
const somethingPlaying = () => Boolean(playingNow()?.source) && deps.screens() > 0;
const videoPlaying = () => playingNow()?.source === "youtube" && deps.screens() > 0;

// ---- finding ---------------------------------------------------------------------------------------------------------
// the videos of a creator's channel, best first for what was asked (never other channels' videos)
async function creatorVideos(channel, req) {
  let vids = [];
  try { const r = await yt.channelVideos(channel, { tab: req.live ? "streams" : "videos" }); vids = r.videos; if (!channel.name && r.channel.name) channel.name = r.channel.name; }
  catch { /* the channel page didn't come: its own videos from a search instead */ }
  const own = (list) => list.filter((v) => v.channel && nameSim(v.channel, channel.name) >= 0.85);
  if (!vids.length) vids = own(await yt.search(channel.name, { newest: req.filters?.newest, popular: req.filters?.popular, max: 25 }).catch(() => []));
  if (req.query) {
    const about = own(await yt.search(`${channel.name} ${req.query}`, { max: 25 }).catch(() => []));
    vids = [...about, ...vids.filter((v) => covers(v.title, req.query) >= 0.5 && !about.some((a) => a.videoId === v.videoId))];
  }
  vids = vids.map((v) => ({ ...v, channel: v.channel || channel.name }));
  const f = req.filters ?? {};
  const ok = vids.filter((v) => R.passes(v, f));
  if (f.popular) ok.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  else if (!f.newest && !req.query && !req.live) {
    // "a video by X": a recent one that people watched (the most viewed of the latest ten), then the rest newest first
    const recent = ok.slice(0, 10).sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
    return [...recent, ...ok.slice(10)];
  }
  return ok;
}
// what's playing now, for "more like this" / "the next episode"
function currentVideo() {
  const st = playingNow(), cur = queue.get().current;
  if (st?.source === "youtube" && st.title) return { videoId: st.videoId ?? cur?.videoId ?? null, title: st.title, channel: st.artist && !/^youtube$/i.test(st.artist) ? st.artist : cur?.channel ?? "" };
  return cur ? { videoId: cur.videoId, title: cur.title, channel: cur.channel } : null;
}
const topicWords = (title) => norm(title).replace(/\b(?:official|video|full|hd|4k|episode|ep|part|pt|live|the|a|an|and|of|in|on|with|to|for|from|by|is|it|at)\b/g, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");

export async function find(req) {
  req = { filters: {}, ...req };
  const f = req.filters;
  let results = [], channel = null, cr = null, note = "";
  // a title or topic that's really a creator's name ("show me mike winger videos")
  if ((req.kind === "title" || req.kind === "topic") && req.query && !req.creator) {
    const hit = creators.matchPerson(req.query);
    if (hit && hit.score >= 0.9) { req = { ...req, kind: "creator", creator: req.query, query: "" }; }
  }
  if (req.kind === "creator") {
    cr = await creators.resolve(req.creator);
    if (!cr.channel) return { req, none: true, say: `I couldn't find a YouTube channel for ${req.creator}.` };
    if (cr.unsure && cr.options.length > 1) return { req, clarifyChannel: cr };
    channel = cr.channel;
    results = await creatorVideos(channel, req);
    if (!results.length) return { req, channel, none: true, say: `I found ${channel.name} on YouTube, but couldn't read its videos just now.` };
  } else if (req.kind === "morelike" || req.kind === "episode") {
    const cur = currentVideo();
    if (!cur?.title) return { req, none: true, say: req.kind === "episode" ? "Which show? Nothing's playing, so I can't tell which episode comes next." : "Nothing's playing, so I don't know what to find more of." };
    if (req.kind === "episode") {
      const m = /\b(episode|ep\.?|part|pt\.?|chapter|day|lesson|session|#)\s*(\d{1,4})\b/i.exec(cur.title);
      if (!m && !req.query) return { req, none: true, say: `I can't tell which episode ${clip(cur.title, 50)} is.` };
      const n = m ? Number(m[2]) + 1 : null;
      // the show's name and the next number ("The Bible Project - Episode 5"), without this episode's own subtitle
      const q = req.query ? `${req.query} ${n ? `${m[1]} ${n}` : "next episode"}` : `${cur.title.slice(0, m.index)}${m[1]} ${n}`.replace(/\s*[-–|:]\s*$/, "");
      const want = n ? new RegExp(`\\b${m[1].replace(/[.#]/g, "\\$&")}\\s*0?${n}\\b`, "i") : null;
      const found = (await yt.search(q, { max: 25 })).filter((x) => x.videoId !== cur.videoId && x.title !== cur.title);
      results = want ? [...found.filter((x) => want.test(x.title)), ...found.filter((x) => !want.test(x.title))] : found;
      channel = cur.channel ? { name: cur.channel } : null;
      req = { ...req, query: q, kind: "title" };
      note = n ? `${m[1][0].toUpperCase() + m[1].slice(1).replace(/\.$/, "")} ${n}` : "";
    } else {
      const q = topicWords(cur.title);
      results = (await yt.search(q || cur.title, { max: 25 })).filter((x) => x.videoId !== cur.videoId && x.title !== cur.title);
      req = { ...req, query: q, kind: "topic" };
    }
  } else {
    const q = req.live ? `${req.query} live` : req.query;
    results = await yt.search(q, { popular: f.popular, newest: f.newest, recentDays: f.recentDays, shorts: f.shorts, kind: req.kind === "playlist" ? "playlist" : "video", max: 25 });
  }
  const key = R.keyOf(req), pr = prefs.forKey(key);
  const ranked = R.rank(results, req, { kept: pr.kept, rejected: pr.rejected, channel });
  return { req, key, ranked, channel, creator: cr, conf: R.confidence(ranked, req), note };
}

// ---- play ------------------------------------------------------------------------------------------------------------
// req: from parse.request(), or the AI's tool. Returns { reply, listen?, played? }
export async function play(req) {
  const policy = media.policyNow();
  if (!policy.videosAllowed && !req.audioOnly) return { reply: `No videos right now: ${policy.reason ?? "it's study time."} Music is fine, though.` };
  const r = await find(req);
  if (r.clarifyChannel) return askChannel(r);
  if (r.none) return { reply: r.say };
  if (!r.ranked.length) return { reply: nothingFound(r.req) };
  session = { req: r.req, key: r.key, ranked: r.ranked, index: 0, asking: false, channel: r.channel, creator: r.creator, at: Date.now() };
  if (!r.conf.sure && r.ranked.length > 1) return askTop3();
  const count = Math.min(10, r.req.count ?? 1);
  const cmd = start(r.ranked[0], { audioOnly: req.audioOnly });
  if (count > 1) queue.add(r.ranked.slice(1, count), { next: true });
  // the next-best ones travel with it, so "next video" has somewhere to go when the queue runs out
  cmd.others = r.ranked.slice(count, count + 5).map((x) => ({ videoId: x.videoId ?? null, playlistId: x.playlistId ?? null, title: x.title, channel: x.channel ?? "" }));
  if (r.req.kind === "title") prefs.keep(r.key, r.ranked[0].videoId ?? r.ranked[0].playlistId, r.ranked[0].title);
  const x = r.ranked[0];
  const from = r.channel && r.req.kind === "creator" ? (r.creator?.person && nameSim(r.creator.person, r.channel.name) < 0.85 ? `, from ${r.channel.name} (${r.creator.person})` : `, from ${r.channel.name}`) : x.channel ? `, from ${x.channel}` : "";
  const why = r.req.kind === "creator" ? (r.req.filters.newest ? " It's their newest." : r.req.filters.popular ? " It's one of their most watched." : "") : "";
  const more = count > 1 ? ` ${count - 1} more are queued after it.` : "";
  return { reply: `${r.note ? r.note + ": " : ""}Playing ${clip(x.title)}${from}.${why}${more}`, played: { videoId: x.videoId, title: x.title, channel: x.channel } };
}
function nothingFound(req) {
  const f = req.filters ?? {};
  const lim = f.minSecs || f.maxSecs ? " that long" : f.recentDays ? " that recent" : "";
  return `I couldn't find ${req.kind === "playlist" ? "a playlist" : "a video"} for “${req.query || req.creator}”${lim} on YouTube.`;
}
function askTop3() {
  session.asking = true; session.at = Date.now();
  const top = session.ranked.slice(0, 3);
  showGrid({ title: "Did you mean one of these?", kind: "videos", req: session.req, items: top, ask: true });
  return { reply: `I'm not sure which one you mean. ${top.map((x, i) => `${i + 1}, ${clip(x.title, 60)}${x.channel ? ` from ${x.channel}` : ""}`).join(". ")}. Which one?`, listen: true };
}
function askChannel(r) {
  const opts = r.clarifyChannel.options.slice(0, 3);
  session = { req: r.req, key: R.keyOf(r.req), ranked: [], index: 0, asking: true, channels: opts, at: Date.now() };
  showGrid({ title: `Which ${r.req.creator}?`, kind: "channels", req: r.req, items: opts.map((c) => ({ ...c, title: c.name, channel: c.subscribers ?? "" })), ask: true });
  return { reply: `I found a few channels called something like ${r.req.creator}. ${opts.map((c, i) => `${i + 1}, ${c.name}${c.subscribers ? `, ${c.subscribers}` : ""}`).join(". ")}. Which one?`, listen: true };
}
// "number 2" after "Did you mean…?"
export async function choose(n) {
  if (!session?.asking) throw new Error("I didn't offer any videos to pick from just now.");
  if (session.channels) {
    const c = session.channels[n - 1];
    if (!c) throw new Error(`There were only ${session.channels.length}.`);
    const req = session.req;
    creators.setAlias(req.creator, { name: c.name, handle: c.handle, channelId: c.channelId }, { learned: true });   // remembered next time
    session = null; closeGrid(false);
    return play({ ...req, kind: "creator", creator: req.creator });
  }
  const x = session.ranked[n - 1];
  if (!x) throw new Error(`There were only ${Math.min(3, session.ranked.length)} choices.`);
  session.asking = false; session.index = n - 1; session.at = Date.now();
  prefs.keep(session.key, x.videoId ?? x.playlistId, x.title);
  closeGrid(false);
  start(x);
  return { reply: `Playing ${clip(x.title)}${x.channel ? `, from ${x.channel}` : ""}.`, played: x };
}
// "not that": remember it was wrong, and play the next one ("wrong channel": the creator's next channel)
export async function notThat({ channel = false } = {}) {
  if (!session || Date.now() - session.at > FRESH_MS) throw new Error("I haven't picked a video lately. Tell me what you'd like to watch.");
  if ((channel || session.req.kind === "creator") && session.channel && channel) {
    creators.reject(session.req.creator, session.channel);
    const r = await play(session.req);
    return { ...r, reply: r.reply.replace(/^Playing/, "Okay, a different channel. Playing") };
  }
  const cur = session.ranked[session.index];
  if (cur && !session.asking) prefs.reject(session.key, cur.videoId ?? cur.playlistId, cur.title);
  const from = session.asking ? 0 : session.index + 1;
  const x = session.ranked[from];
  if (!x) return { reply: `That was the last good match I found for “${session.req.query || session.req.creator}”. Try saying it another way, or say “pull up videos about” it to see a list.` };
  session.index = from; session.asking = false; session.at = Date.now();
  if (grid?.ask) closeGrid(false);
  start(x);
  return { reply: `Okay, how about ${clip(x.title)}${x.channel ? `, from ${x.channel}` : ""}?`, played: x };
}

// ---- the grid on the screen --------------------------------------------------------------------------------------------
function view() {
  if (!grid) return { open: false };
  return { open: !grid.closed, id: grid.id, title: grid.title, kind: grid.kind, ask: Boolean(grid.ask), filters: grid.req?.filters ?? {}, total: grid.items.length, more: grid.items.length > grid.shown,
    items: grid.items.slice(0, grid.shown).map((x, i) => ({ n: i + 1, videoId: x.videoId ?? null, playlistId: x.playlistId ?? null, channelId: x.channelId ?? null, title: x.title ?? x.name ?? "", channel: x.channel ?? "",
      length: x.length || (x.secs ? spokenLength(x.secs) : ""), age: x.age ?? "", views: x.views ?? "", count: x.count ?? null, live: Boolean(x.live), thumb: x.videoId ? thumbOf(x.videoId) : x.thumb ?? "" })) };
}
export const gridView = view;
function showGrid({ title, kind = "videos", req = null, items, ask = false, shown = 12 }) {
  grid = { id: Math.random().toString(36).slice(2, 8), at: Date.now(), title, kind, req, items, shown: Math.min(items.length, shown), ask, closed: false };
  broadcast("vbrowse", view());
  return grid;
}
function closeGrid(tell = true) { if (grid) { grid.closed = true; if (tell) broadcast("vbrowse", { open: false }); else broadcast("vbrowse", { open: false }); } }
export async function browse(req) {
  req = { filters: {}, ...req };
  if (req.kind === "channels") {
    const list = (await yt.channels(req.query)).slice(0, 12);
    if (!list.length) return { reply: `I couldn't find any channels about ${req.query}.` };
    showGrid({ title: `Channels: ${req.query}`, kind: "channels", req, items: list.map((c) => ({ ...c, title: c.name, channel: c.subscribersText ?? "" })) });
    return { reply: `Here are ${list.length} channels about ${req.query}. Say a number to see its videos.`, listen: true };
  }
  const r = await find(req);
  if (r.clarifyChannel) return askChannel(r);
  if (r.none) return { reply: r.say };
  if (!r.ranked.length) return { reply: nothingFound(r.req) };
  session = { req: r.req, key: r.key, ranked: r.ranked, index: -1, asking: false, channel: r.channel, creator: r.creator, at: Date.now() };
  const what = r.req.kind === "creator" ? `from ${r.channel.name}` : `about ${r.req.query}`;
  showGrid({ title: r.req.kind === "creator" ? `Videos from ${r.channel.name}` : `Videos: ${r.req.query}`, kind: "videos", req: r.req, items: r.ranked.slice(0, 40), shown: Math.min(24, Math.max(12, r.req.count ?? 12)) });
  return { reply: `Here are ${grid.shown} videos ${what}. Say a number to play one, “queue 2 and 4”, or “more”.`, listen: true };
}
async function gridPick(n) {
  const items = grid.items, i = n === -1 ? Math.min(items.length, grid.shown) - 1 : n - 1;
  const x = items[i];
  if (!x || i >= grid.shown) throw new Error(`There ${grid.shown === 1 ? "is only 1" : `are only ${grid.shown}`} on the screen.`);
  if (grid.kind === "channels") {
    const asked = grid.req?.creator;
    if (asked && x.channelId) creators.setAlias(asked, { name: x.name, handle: x.handle, channelId: x.channelId }, { learned: true });   // his pick is remembered
    closeGrid(false);
    return browse({ kind: "creator", creator: asked && x.channelId ? asked : x.name ?? x.title, query: "", filters: {} });
  }
  if (grid.kind === "playlists") { closeGrid(); return playlistPlay(x); }
  if (grid.ask) return choose(i + 1);
  if (grid.kind === "playlistItems") { const all = grid.items; queue.replace(all, { source: { name: grid.title }, start: i }); startFromQueue(queue.get().items[i], i + 1); closeGrid(); return { reply: `Playing number ${i + 1}, ${clip(x.title)}.` }; }
  if (session) { session.index = i; session.at = Date.now(); session.asking = false; }
  start(x);
  closeGrid();
  return { reply: `Playing ${clip(x.title)}${x.channel ? `, from ${x.channel}` : ""}.`, played: x };
}
async function gridQueue(ns, { next = false } = {}) {
  const items = ns.map((n) => grid.items[n - 1]).filter((x, k) => x && ns[k] <= grid.shown);
  if (!items.length) throw new Error("Those numbers aren't on the screen.");
  if (grid.kind === "playlists") { for (const p of items) await playlistQueue(p, { next }); return { reply: `Added ${items.length === 1 ? items[0].title : `${items.length} playlists`} to the queue.` }; }
  return queueItems(items, { next, label: items.length === 1 ? clip(items[0].title) : `numbers ${listNames(ns.map(String), 12)}` });
}
async function gridMore() {
  if (grid.shown < grid.items.length) { grid.shown = Math.min(grid.items.length, grid.shown + 12); grid.at = Date.now(); broadcast("vbrowse", view()); return { reply: `Here are more, up to number ${grid.shown}.` }; }
  // fetch another page of results (the most viewed ones this time) and add the new ones
  if (grid.kind === "videos" && grid.req?.query) {
    const extra = await yt.search(grid.req.query, { popular: !grid.req.filters?.popular, max: 25 }).catch(() => []);
    const have = new Set(grid.items.map((x) => x.videoId));
    const add = R.rank(extra.filter((x) => x.videoId && !have.has(x.videoId)), grid.req, {});
    if (add.length) { grid.items.push(...add); grid.shown = Math.min(grid.items.length, grid.shown + 12); grid.at = Date.now(); broadcast("vbrowse", view()); return { reply: `Here are ${add.length} more.` }; }
  }
  return { reply: "That's all I found." };
}
async function gridRefine(filters) {
  const req = { ...grid.req, filters: filters.reset ? {} : { ...(grid.req?.filters ?? {}), ...filters } };
  if (filters.newest) delete req.filters.popular;
  if (filters.popular) delete req.filters.newest;
  if (filters.maxSecs && req.filters.minSecs && req.filters.minSecs >= filters.maxSecs) delete req.filters.minSecs;
  if (filters.minSecs && req.filters.maxSecs && req.filters.maxSecs <= filters.minSecs) delete req.filters.maxSecs;
  const reSearch = filters.newest || filters.popular || filters.recentDays || filters.shorts || filters.reset;
  let items = reSearch ? (await find(req)).ranked ?? [] : grid.items.filter((x) => R.passes(x, req.filters));
  if (!reSearch && items.length < 6) items = (await find(req)).ranked ?? items;
  if (!items.length) return { reply: "None of these fit that. Say “show all” to go back." };
  showGrid({ title: grid.title, kind: grid.kind, req, items, shown: Math.min(24, Math.max(12, grid.shown)) });
  const how = filters.reset ? "all of them" : filters.newest ? "newest first" : filters.popular ? "most viewed first" : filters.noShorts ? "without Shorts" : filters.minSecs ? `longer than ${spokenLength(filters.minSecs)}` : filters.maxSecs ? `shorter than ${spokenLength(filters.maxSecs)}` : "filtered";
  return { reply: `Okay, ${how}: ${grid.shown} videos.` };
}

// ---- the queue -------------------------------------------------------------------------------------------------------
function startFromQueue(it, n) {
  const cmd = media.playCommand({ videoId: it.videoId, playlistId: it.videoId ? null : it.playlistId, title: it.title });
  cmd.channel = it.channel ?? ""; cmd.fromQueue = true; cmd.queueN = n; cmd.queue = qinfo();
  broadcast("media", cmd);
  return cmd;
}
async function queueItems(items, { next = false, label = "" } = {}) {
  const wasIdle = !videoPlaying();
  const r = queue.add(items, { next });
  if (wasIdle) {
    const s = queue.get();
    // nothing playing: start with the first one that was just added
    try { const i = r.at - 1; queue.jump(r.at); startFromQueue(s.items[i], r.at); return { reply: `Nothing was playing, so here's ${clip(r.items[0].title)}.${r.added > 1 ? ` ${r.added - 1} more are queued after it.` : ""}` }; }
    catch (e) { return { reply: `Added ${label || clip(r.items[0].title)} to the queue. ${e.message}` }; }
  }
  return { reply: `${next ? "Up next" : "Added to the queue"}: ${label || (r.added === 1 ? clip(r.items[0].title) : `${r.added} videos`)}${next ? "." : ` (number ${r.at}${r.added > 1 ? ` to ${r.at + r.added - 1}` : ""}).`}` };
}
export async function queueRequest(req) {
  req = { filters: {}, ...req };
  if (req.kind === "this") {
    const cur = currentVideo();
    if (!cur?.videoId) return { reply: "Nothing's playing to add." };
    return queueItems([cur], { next: req.next, label: clip(cur.title) });
  }
  if (req.kind === "episode" || req.kind === "morelike") {
    const r = await find(req);
    if (r.none || !r.ranked?.length) return { reply: r.say ?? "I couldn't find it." };
    return queueItems([r.ranked[0]], { next: true, label: clip(r.ranked[0].title) });
  }
  const r = await find(req);
  if (r.clarifyChannel) return askChannel(r);
  if (r.none) return { reply: r.say };
  if (!r.ranked.length) return { reply: nothingFound(r.req) };
  const count = Math.max(1, Math.min(25, req.count ?? 1));
  const picks = r.ranked.slice(0, count);
  if (count === 1 && !r.conf.sure && r.ranked.length > 1 && r.req.kind === "title") {
    session = { req: r.req, key: r.key, ranked: r.ranked, index: -1, asking: false, channel: r.channel, at: Date.now() };
    showGrid({ title: `Which one should I queue?`, kind: "videos", req: r.req, items: r.ranked.slice(0, 3) });
    return { reply: `Which one should I queue? ${r.ranked.slice(0, 3).map((x, i) => `${i + 1}, ${clip(x.title, 50)}`).join(". ")}. Say “queue number” and the number.`, listen: true };
  }
  const what = count > 1 ? `${picks.length} videos ${r.req.kind === "creator" ? `from ${r.channel?.name}` : `about ${r.req.query}`}` : clip(picks[0].title);
  return queueItems(picks, { next: req.next, label: what });
}
export async function queueCommand(op) {
  const s = queue.get();
  switch (op.op) {
    case "show": {
      queueShownAt = Date.now();
      broadcast("vqueue", { queue: s, open: true });
      if (!s.total) return { reply: "The queue is empty. Say “queue” and a video, or use ＋ Queue on any video." };
      const cur = s.current ? `Now playing number ${s.index + 1}, ${clip(s.current.title, 60)}. ` : "";
      const up = s.upcoming.slice(0, 3).map((x) => clip(x.title, 50));
      return { reply: `${s.source?.name ? `${s.source.name}: ` : ""}${s.total} ${s.total === 1 ? "video" : "videos"} in the queue. ${cur}${up.length ? `Next: ${up.join(", then ")}${s.upcoming.length > 3 ? `, and ${s.upcoming.length - 3} more` : ""}.` : "Nothing after this one."}` };
    }
    case "hide": broadcast("vqueue", { queue: s, open: false }); return { reply: "" };
    case "whatsNext": { const x = s.upcoming[0]; return { reply: x ? `Next is ${clip(x.title)}${x.channel ? `, from ${x.channel}` : ""}.` : s.repeat === "all" && s.total ? `After this it starts over with ${clip(s.items[0].title)}.` : "Nothing's queued after this one." }; }
    case "play": { const r = queue.jump(op.n); startFromQueue(r.item, r.n); return { reply: `Playing number ${r.n}, ${clip(r.item.title)}.` }; }
    case "remove": { const r = queue.remove(op.n); return { reply: `Removed ${op.n === 0 ? "this one" : `number ${r.n}`}, ${clip(r.removed.title, 60)}, from the queue.${r.wasCurrent ? " It'll finish playing first." : ""}` }; }
    case "move": { const r = queue.move(op.n, op.to); return { reply: `Moved ${clip(r.item.title, 60)} to number ${r.to}.` }; }
    case "clear": { const r = queue.clear(); return { reply: r.cleared ? `Cleared ${r.cleared} ${r.cleared === 1 ? "video" : "videos"} from the queue.${s.current ? " What's playing keeps playing." : ""}` : "The queue was already empty." }; }
    case "shuffle": queue.setShuffle(true); pushRepeatShuffle(); return { reply: "Shuffled the queue." };
    case "unshuffle": queue.setShuffle(false); pushRepeatShuffle(); return { reply: "The queue is back in order." };
    case "repeat": queue.setRepeat(op.mode); pushRepeatShuffle(); return { reply: op.mode === "all" ? "Repeating the whole queue." : op.mode === "one" ? "Repeating this video." : "Repeat off." };
    case "next": case "skip": { const r = queue.next(); if (!r) return { reply: "Nothing's queued after this one." }; startFromQueue(r.item, r.n); return { reply: `Next: ${clip(r.item.title)}.` }; }
    case "previous": { const r = queue.previous(); if (!r) return { reply: "That's the first one in the queue." }; startFromQueue(r.item, r.n); return { reply: `Back to ${clip(r.item.title)}.` }; }
    default: return null;
  }
}
// the screen's player follows the queue's repeat and shuffle
function pushRepeatShuffle() { const s = queue.get(); broadcast("player", { action: "queueMode", value: { repeat: s.repeat, shuffle: s.shuffle } }); }
// the screen says a queued video ended (autoplay), or asks for the next / previous one
export function advance(what = "ended") {
  const r = what === "previous" ? queue.previous() : queue.next({ auto: what === "ended" });
  if (!r) return { ended: true };
  if (r.again) { broadcast("player", { action: "restart" }); return { again: true, item: r.item }; }
  try { startFromQueue(r.item, r.n); } catch (e) { return { error: e.message }; }
  return { item: r.item, n: r.n };
}

// the screen opened or closed the queue panel itself (so "number 5" means the queue)
export function queueShown(open = true) { queueShownAt = open ? Date.now() : 0; return { shown: open }; }
// play this now (the screen's ▶ on a result), through the queue
export function startItem(x) { return start(x); }
// the grid's buttons on the screen: { action: pick|queue|more|refine|close, n, ns, next, filters }
export async function gridAction(b = {}) {
  if (!grid) return { reply: "There are no videos on the screen." };
  switch (b.action) {
    case "pick": return gridPick(Number(b.n));
    case "queue": return gridQueue((Array.isArray(b.ns) ? b.ns : [b.n]).map(Number), { next: Boolean(b.next) });
    case "more": return gridMore();
    case "refine": return gridRefine(b.filters ?? {});
    case "close": closeGrid(); return { reply: "" };
    default: throw new Error("unknown action");
  }
}

// ---- his YouTube playlists -------------------------------------------------------------------------------------------
// one of Dayspring's own video playlists (lib/videolists.mjs) or his YouTube account's
async function findPlaylist(name) {
  const own = videolists.find(name);
  if (own?.items?.length) return { title: own.name, own, items: own.items };
  const hit = await account.find(name);
  return hit ? hit.playlist : null;
}
async function itemsOf(pl) {
  if (pl.items) return pl.items;
  return account.items(pl);
}
export async function playlistPlay(nameOrPl, { shuffle = false } = {}) {
  const policy = media.policyNow();
  if (!policy.videosAllowed) return { reply: `No videos right now: ${policy.reason ?? "it's study time."}` };
  const pl = typeof nameOrPl === "string" ? await findPlaylist(nameOrPl) : nameOrPl;
  if (!pl) return { reply: `I couldn't find a playlist of yours called “${nameOrPl}”. Say “list my YouTube playlists” to see them.` };
  let items = [];
  try { items = await itemsOf(pl); } catch (e) { if (!pl.playlistId || ["LL", "WL"].includes(pl.playlistId)) return { reply: `I couldn't open ${pl.title}: ${e.message}` }; }
  if (!items.length) {
    if (pl.playlistId && !["LL", "WL"].includes(pl.playlistId)) { start({ playlistId: pl.playlistId, title: pl.title, shuffle }); return { reply: `Playing your ${pl.title} playlist${shuffle ? ", shuffled" : ""}.` }; }
    return { reply: `${pl.title} is empty.` };
  }
  queue.replace(items, { source: { name: pl.title, playlistId: pl.playlistId ?? null }, shuffle });
  const s = queue.get();
  startFromQueue(s.items[s.index], s.index + 1);
  return { reply: `Playing your ${pl.title} playlist${shuffle ? ", shuffled" : ""}: ${items.length} ${items.length === 1 ? "video" : "videos"}. Say “show the queue” to see them all.` };
}
export async function playlistQueue(nameOrPl, { next = false } = {}) {
  const pl = typeof nameOrPl === "string" ? await findPlaylist(nameOrPl) : nameOrPl;
  if (!pl) return { reply: `I couldn't find a playlist of yours called “${nameOrPl}”.` };
  const items = await itemsOf(pl);
  if (!items.length) return { reply: `${pl.title} is empty.` };
  return queueItems(items, { next, label: `${items.length} videos from ${pl.title}` });
}
export async function playlistShow(nameOrPl) {
  const pl = typeof nameOrPl === "string" ? await findPlaylist(nameOrPl) : nameOrPl;
  if (!pl) return { reply: `I couldn't find a playlist of yours called “${nameOrPl}”.` };
  const items = await itemsOf(pl);
  if (!items.length) return { reply: `${pl.title} is empty.` };
  showGrid({ title: pl.title, kind: "playlistItems", items, shown: Math.min(24, items.length) });
  return { reply: `${pl.title} has ${items.length} ${items.length === 1 ? "video" : "videos"}: ${items.slice(0, 3).map((x) => clip(x.title, 45)).join(", ")}${items.length > 3 ? ", and more" : ""}. Say a number to start there.`, listen: true };
}
export async function listPlaylists({ fresh = true } = {}) {
  const list = await account.playlists({ fresh });
  const own = videolists.all().filter((l) => l.items.length).map((l) => ({ title: l.name, own: true, items: l.items, count: l.items.length }));
  const all = [...list.map((p) => ({ ...p, channel: p.special ? "" : p.count != null ? `${p.count} videos` : "" })), ...own.map((p) => ({ ...p, channel: `${p.count} videos · on Dayspring` }))];
  showGrid({ title: "Your YouTube playlists", kind: "playlists", items: all, shown: Math.min(24, all.length) });
  const names = list.filter((p) => !p.special).map((p) => p.title);
  return { reply: `You have ${names.length} YouTube ${names.length === 1 ? "playlist" : "playlists"}${names.length ? `: ${listNames(names, 6)}${names.length > 6 ? ", and more" : ""}` : ""}, plus Liked videos and Watch later.${own.length ? ` And ${own.length} on Dayspring.` : ""} Say a number or a name to play one.`, listen: true };
}

// ---- playback controls (every player; always on) -----------------------------------------------------------------------
// (next and previous go to the screen too: it knows what's really playing, and a video from the queue asks the queue)
export async function control(action, value) {
  const r = await media.control(action, value);
  return { reply: r?.say ?? "" };
}

// Words about the picture ("full screen", "exit full screen", "minimize the video") while a video is on the screen: the
// video's, before Dayspring's own window takes them (server.mjs asks this first)
export function pictureWord(text) {
  const st = playingNow();
  if (!(st?.source === "youtube" && st.video !== false) && !(st?.source === "file" && st.video)) return false;
  if (deps.screens() < 1) return false;
  const c = controls.parse(text, { playing: true });
  return Boolean(c && ["full", "minimize"].includes(c.action));
}

// ---- the no-AI entry point -------------------------------------------------------------------------------------------
const fresh = (t, ms) => t && Date.now() - t < ms;
export async function command(text, { surface = "tv" } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 300) return null;
  try {
    const on = enabled();
    const st = playingNow(), playing = Boolean(st?.source) && deps.screens() > 0;
    // 1. answers to what's on the screen: "number 3", "queue 2 and 4", "more", "newest first", "not that"
    if (on) {
      const c = P.context(raw);
      if (c) {
        const gridLive = grid && !grid.closed && fresh(grid.at, GRID_MS) && grid.at >= (await deps.othersAt()) && grid.at >= queueShownAt;
        const pickNow = session && !session.asking ? session.ranked[session.index] : null;
        const stillOn = !pickNow || !st?.videoId || pickNow.videoId === st.videoId;
        if (c.op === "notThat" && session && fresh(session.at, session.asking ? ASK_MS : FRESH_MS) && (session.asking || session.index >= 0) && stillOn) return out(await notThat({ channel: c.channel }));
        if (gridLive) {
          if (c.op === "pick") return out(await gridPick(c.n));
          if (c.op === "queueMany") return out(await gridQueue(c.ns, { next: c.next }));
          if (c.op === "more") return out(await gridMore());
          if (c.op === "refine") return out(await gridRefine(c.filters));
          if (c.op === "close") { closeGrid(); return out({ reply: "Okay." }); }
          if (c.op === "none" && grid.ask) { session && (session.asking = false); closeGrid(); return out({ reply: "Okay. Tell me another way to say it, like the channel's name or more of the title." }); }
        }
        // "play number 5" with the queue on the screen (or nothing else to pick from)
        if (c.op === "pick" && queue.get().total && fresh(queueShownAt, GRID_MS) && queueShownAt >= (await deps.othersAt()) && (!gridLive || queueShownAt >= grid.at)) { const r = await queueCommand({ op: "play", n: c.n }).catch((e) => ({ reply: e.message })); return out(r); }
      }
    }
    // 2. the queue: "show the queue", "remove number 3", "move number 4 up", "clear the queue", "play number 5 in the queue"
    if (on) {
      const qo = P.queueOp(raw), other = playing && st.source !== "youtube";   // Spotify's or his own files' queue is theirs
      const skip = !qo || (other && ["show", "whatsNext", "shuffle", "unshuffle", "repeat"].includes(qo.op)) || (qo.op === "shuffle" && !queue.get().total) || (qo.op === "repeat" && !queue.get().current);
      if (!skip) { const r = await queueCommand(qo); if (r) return out(r); }
    }
    // 3. playback controls, for whatever is playing (always on)
    const ctl = controls.parse(raw, { playing });
    if (ctl?.ask) {
      if (ctl.ask === "next") { if (on && queue.get().current && playing && st.source === "youtube") return out(await queueCommand({ op: "whatsNext" })); }
      else if (playing && !(ctl.ask === "now" && st.source === "spotify")) return out({ reply: controls.answer(ctl.ask, st, { queue: on ? queue.get() : null }) });   // (Spotify's "what's playing" is lib/music's: it names the playlist too)
    } else if (ctl?.action && playing) {
      const r = await control(ctl.action, ctl.value);
      return out({ reply: r.reply || ctl.say });
    }
    if (!on) return null;
    // 4. a request
    const req = P.request(raw);
    if (!req) return null;
    if (!claim(req)) return null;
    switch (req.act) {
      case "alias": { const r = creators.setAlias(req.name, req.channel); return out({ reply: `Got it. When you say ${r.name}, I'll look for ${r.channel.name} on YouTube.` }); }
      case "unalias": return out({ reply: creators.removeAlias(req.name) ? `Okay, I forgot what ${req.name} meant.` : `I didn't have anything saved for ${req.name}.` });
      case "playlists": return out(await listPlaylists());
      case "playlist": return out(await playlistPlay(req.name, { shuffle: req.shuffle }));
      case "queuePlaylist": return out(await playlistQueue(req.name, { next: req.next }));
      case "showPlaylist": return out(await playlistShow(req.name));
      case "browse": return out(await browse(req));
      case "queue": return out(await queueRequest(req));
      case "play": return out(await play(req));
      default: return null;
    }
  } catch (e) {
    return out({ reply: /ECONN|fetch failed|timeout|aborted/i.test(e.message) ? "I couldn't reach YouTube just now. Check the internet connection and try again." : e.message });
  }
}
const out = (r) => (r ? { ...r, reply: r.reply ?? "", intent: "video" } : null);
// Words that don't say "video" or "YouTube" are only taken when nothing else would want them
function claim(req) {
  if (req.explicit) return true;
  if (req.act === "playlist" || req.act === "queuePlaylist" || req.act === "showPlaylist") {
    if (videolists.find(req.name)) return true;
    const hit = account.match(req.name, account.cached());
    return Boolean(hit && hit.score >= 0.85 && !deps.spotifyReady());
  }
  if (req.act === "playlists") return !deps.spotifyReady();
  if (req.act === "queue") return videoPlaying() || (grid && !grid.closed && fresh(grid.at, GRID_MS)) || (!somethingPlaying() && !deps.spotifyReady());
  return false;
}

// ---- the AI's tools --------------------------------------------------------------------------------------------------
export const TOOLS = [
  { name: "video_find", description: "Find YouTube videos and play the best match on the Dayspring screen, show a grid of them to pick from, or queue them. Use for any video request: a title, a topic (\"bible reading in psalms\"), a creator (\"a video by John MacArthur\" → their channel, e.g. Grace to You; never a video that merely mentions them), a live stream, a playlist, or \"more like this\". Ranks the results and asks when unsure. The study-time rule applies.",
    input_schema: { type: "object", properties: {
      action: { type: "string", enum: ["play", "browse", "queue", "choose", "not_that"], description: "play the best one; browse = a grid of 12–24 to choose from; queue = add to the queue; choose = pick number N from what's on screen; not_that = the last pick was wrong, play the next" },
      query: { type: "string", description: "What to look for (title or topic words)" }, creator: { type: "string", description: "A person or channel whose videos he wants (\"oneyplays\", \"david wood\")" },
      kind: { type: "string", enum: ["title", "topic", "creator", "playlist", "live", "morelike", "episode"] },
      newest: { type: "boolean" }, popular: { type: "boolean" }, min_minutes: { type: "number" }, max_minutes: { type: "number" }, shorts: { type: "boolean" },
      count: { type: "number", description: "How many (queue 3 videos about…)" }, next: { type: "boolean", description: "Queue right after the current video" }, number: { type: "number", description: "For choose" }, numbers: { type: "array", items: { type: "number" }, description: "Queue these numbers from the grid" },
    }, required: ["action"] } },
  { name: "video_queue", description: "The video queue on the Dayspring screen (it persists): show it, what's next, jump to number N, remove, move, clear, shuffle, repeat, next, previous.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["show", "whats_next", "play_number", "remove", "move", "clear", "shuffle", "unshuffle", "repeat_all", "repeat_one", "repeat_off", "next", "previous"] }, number: { type: "number" }, to: { type: "string", description: "For move: up, down, top, end, next, or a number" } }, required: ["action"] } },
  { name: "youtube_account_playlists", description: "The owner's own YouTube playlists (signed-in account, including Liked videos and Watch later) and Dayspring's video playlists: list them, play or shuffle one by name (fuzzy), queue one after the current video, or show what's in one.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["list", "play", "shuffle", "queue", "show"] }, name: { type: "string" }, next: { type: "boolean" } }, required: ["action"] } },
  { name: "video_creator_alias", description: "Teach Dayspring which YouTube channel a person means (\"when I say Pastor Bob I mean First Baptist Church\"), forget one, or list them.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["set", "remove", "list"] }, name: { type: "string" }, channel: { type: "string" } }, required: ["action"] } },
];
export const tools = () => (enabled() ? TOOLS : []);
export async function runTool(name, input = {}) {
  if (!TOOLS.some((t) => t.name === name)) return undefined;
  if (!enabled()) return { error: "Video search isn't part of this version (or it's switched off in Settings → Features)." };
  try {
    if (name === "video_find") {
      const a = input.action ?? "play";
      if (a === "choose") return grid && !grid.closed ? await gridPick(Number(input.number)) : await choose(Number(input.number));
      if (a === "not_that") return await notThat({});
      if (a === "queue" && Array.isArray(input.numbers) && input.numbers.length && grid) return await gridQueue(input.numbers.map(Number), { next: Boolean(input.next) });
      const filters = { newest: Boolean(input.newest) || undefined, popular: Boolean(input.popular) || undefined, minSecs: input.min_minutes ? input.min_minutes * 60 : undefined, maxSecs: input.max_minutes ? input.max_minutes * 60 : undefined, shorts: Boolean(input.shorts) || undefined };
      for (const k of Object.keys(filters)) if (filters[k] === undefined) delete filters[k];
      const kind = input.kind ?? (input.creator ? "creator" : "topic");
      const req = { kind, query: String(input.query ?? "").trim(), creator: input.creator ? String(input.creator) : undefined, filters, count: input.count ? Number(input.count) : null, next: Boolean(input.next), live: kind === "live" || undefined };
      if (kind === "live") req.kind = input.creator ? "creator" : "live";
      return a === "browse" ? await browse(req) : a === "queue" ? await queueRequest(req) : await play(req);
    }
    if (name === "video_queue") {
      const a = input.action;
      const op = { show: { op: "show" }, whats_next: { op: "whatsNext" }, play_number: { op: "play", n: Number(input.number) }, remove: { op: "remove", n: Number(input.number) }, move: { op: "move", n: Number(input.number), to: /^\d+$/.test(String(input.to)) ? Number(input.to) : input.to },
        clear: { op: "clear" }, shuffle: { op: "shuffle" }, unshuffle: { op: "unshuffle" }, repeat_all: { op: "repeat", mode: "all" }, repeat_one: { op: "repeat", mode: "one" }, repeat_off: { op: "repeat", mode: "off" }, next: { op: "next" }, previous: { op: "previous" } }[a];
      if (!op) return { error: "unknown action" };
      return (await queueCommand(op)) ?? { error: "unknown action" };
    }
    if (name === "youtube_account_playlists") {
      const a = input.action;
      if (a === "list") return await listPlaylists();
      if (!input.name) return { error: "Which playlist?" };
      return a === "queue" ? await playlistQueue(input.name, { next: input.next !== false }) : a === "show" ? await playlistShow(input.name) : await playlistPlay(input.name, { shuffle: a === "shuffle" });
    }
    if (name === "video_creator_alias") {
      if (input.action === "list") return { people: creators.people().map((p) => ({ name: p.name, channels: p.channels.map((c) => c.name), yours: Boolean(p.mine) })) };
      if (input.action === "remove") return { removed: creators.removeAlias(input.name) };
      return { saved: creators.setAlias(input.name, input.channel) };
    }
  } catch (e) { return { error: e.message }; }
  return undefined;
}
