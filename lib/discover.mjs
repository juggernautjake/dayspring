// Discover: things you're into. Every so often Dayspring picks one of the owner's interests and looks for something good
// about it: popular recent YouTube videos, YouTube Shorts (short clips), and articles. It keeps a small feed
// (data/discover.json), never shows the same thing twice, and learns a little from 👍 "more like this" and 👎 "not
// interested". The display shows the feed as a "For you" slide, an occasional gentle pop-up, and a list.
//
// How it searches depends on what kind of interest it is:
//   discovery (nature, science, animals, the ocean, space…): new discoveries and rare sightings, favoring reputable
//     sources (National Geographic, Smithsonian, NOAA, BBC, NASA…), plus short clips of amazing moments
//   hobby (hunting, woodworking, pickleball, cooking…): tips, gear, how-tos and stories
//   news (tech, sports, politics…): the latest news
// With an AI it classifies new interests and picks the best few results, writing one line on why they'd like each.
// Without one it ranks by views, recency and the source. Articles need the web permission.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import * as owner from "./owner.mjs";
import * as interests from "./interests.mjs";
import * as announcer from "./bus.mjs";
import * as llm from "./llm.mjs";
import * as permissions from "./permissions.mjs";
import * as media from "./media.mjs";
import * as web from "./web.mjs";
import * as ytsearch from "./ytsearch.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = () => process.env.DAYSPRING_DISCOVER_FILE || join(DATA, "discover.json");
const FEED_MAX = 100, KEYS_MAX = 3000;
export const DEFAULTS = { on: true, frequency: "few", toasts: true, maxToastsPerDay: 2 };
const FREQ = { off: 0, few: 4 * 3600_000, hourly: 3600_000 };

// ---- storage -----------------------------------------------------------------------------------------------------
let db = null;
function load() {
  if (db) return db;
  try { db = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { db = {}; }
  db.settings = { ...DEFAULTS, ...(db.settings ?? {}) };
  db.feed ??= []; db.keys ??= []; db.lastRun ??= {}; db.types ??= {}; db.toasts ??= { date: "", count: 0 }; db.votes ??= {};
  return db;
}
function save() { try { mkdirSync(dirname(FILE()), { recursive: true }); writeJSONAtomic(FILE(), load(), 1); } catch { /* not critical */ } }
export function _reset(file) { if (file) process.env.DAYSPRING_DISCOVER_FILE = file; db = null; }

export const settings = () => ({ ...load().settings });
export function setSettings(p = {}) {
  const s = load().settings;
  if (typeof p.on === "boolean") s.on = p.on;
  if (p.frequency && p.frequency in FREQ) s.frequency = p.frequency;          // "off": only when asked (voice, Look now)
  if (typeof p.toasts === "boolean") s.toasts = p.toasts;
  if (p.maxToastsPerDay !== undefined) s.maxToastsPerDay = Math.max(0, Math.min(10, Math.round(Number(p.maxToastsPerDay) || 0)));
  save(); announcer.broadcast("discover", { kind: "settings", settings: { ...s } });
  return { ...s };
}

// ---- the interests it looks for ------------------------------------------------------------------------------------
export function topics() {
  const mine = (owner.get().interests ?? []).map((i) => String(i).replace(/\s*\(.*?\)\s*/g, " ").split(/[:]/)[0].trim()).filter(Boolean);
  if (mine.length) return [...new Set(mine)];
  try { const t = JSON.parse(readFileSync(join(DATA, "showcase.json"), "utf8")).videoTopics; if (t?.length) return t; } catch { /* none */ }
  return [];
}
const DISCOVERY = /\b(ocean|oceans|marine|sea|seas|deep[- ]sea|underwater|wildlife|animals?|birds?|birding|bird ?watching|nature|space|astronomy|stars|planets?|cosmos|science|dinosaurs?|fossils?|paleontology|archaeology|geology|volcano(es)?|storms?|weather|insects?|reptiles?|sharks?|whales?|dolphins?|octopus|jellyfish|coral|reefs?|botany|plants?|biology|physics|chemistry|nasa|minerals|wolves|bears|forests?|rainforest|jungle|species|zoology|ecology|climate)\b/i;
const NEWS = /\b(news|politics|economy|stocks?|markets?|world|election|tech news|video game news|headlines)\b/i;
export function kindOf(interest) {
  const k = String(interest).toLowerCase(), cached = load().types[k];
  if (cached) return cached;
  return DISCOVERY.test(k) ? "discovery" : NEWS.test(k) ? "news" : "hobby";
}
// With an AI: one short call per new interest, remembered.
async function classify(interest) {
  const k = String(interest).toLowerCase();
  if (load().types[k]) return load().types[k];
  let t = kindOf(interest);
  if (deps.llmReady()) {
    try {
      const r = await deps.complete({ system: "Answer with one word only.", prompt: `Is "${interest}" mostly (a) a nature/science/discovery topic people like to see new finds and rare sightings about, (b) a hobby or activity people want tips, gear and stories about, or (c) a news topic? Reply: discovery, hobby or news.`, maxTokens: 5, timeoutMs: 15_000 });
      const m = /discovery|hobby|news/i.exec(r ?? ""); if (m) t = m[0].toLowerCase();
    } catch { /* keep the guess */ }
  }
  load().types[k] = t; save();
  return t;
}
// What to search for, by kind (a couple are picked each run, rotating)
function queries(interest, kind, n) {
  const i = interest;
  const T = {
    discovery: { videos: [`${i} new discovery`, `rare ${i} sighting`, `amazing ${i} footage`, `${i} documentary`], shorts: [`${i} rare sighting`, `amazing ${i}`, `${i}`],
      articles: [`${i} new discovery`, `rare ${i} sighting`, `${i} site:nationalgeographic.com`, `${i} site:smithsonianmag.com`, `${i} site:noaa.gov`, `${i} site:bbc.com`, `${i} scientists found`] },
    hobby: { videos: [`${i} tips`, `${i} tutorial`, `${i} stories`, `best ${i} moments`, `${i} gear review`], shorts: [`${i} tips`, `${i}`, `${i} moment`],
      articles: [`${i} tips`, `${i} guide`, `${i} gear`, `${i} season tips`, `${i} stories`, `${i} for beginners`] },
    news: { videos: [`${i} news this week`, `latest ${i}`], shorts: [`${i} news`], articles: [`${i} news`, `latest ${i}`, `${i} this week`] },
  }[kind] ?? {};
  const pick = (arr) => { const r = (load().lastRun[i.toLowerCase()]?.n ?? 0) + n; return arr?.length ? arr[r % arr.length] : i; };
  return { video: pick(T.videos), short: pick(T.shorts), articles: [pick(T.articles), pick([...(T.articles ?? []).slice(1), i])] };
}

// ---- searching (swappable in tests) --------------------------------------------------------------------------------
const YT_KEY = () => process.env.YOUTUBE_API_KEY ?? "";
async function youtubeShorts(query) {
  if (YT_KEY()) {
    const p = new URLSearchParams({ part: "snippet", q: query, type: "video", videoDuration: "short", order: "viewCount", maxResults: "12", key: YT_KEY(), safeSearch: "moderate", relevanceLanguage: "en", publishedAfter: new Date(Date.now() - 60 * 86400000).toISOString() });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${p}`, { signal: AbortSignal.timeout(15_000) });
    const j = await r.json(); if (!r.ok) return [];
    return (j.items ?? []).map((it) => ({ videoId: it.id.videoId, title: it.snippet.title, channel: it.snippet.channelTitle, published: it.snippet.publishedAt?.slice(0, 10) }));
  }
  // youtube.com's own results, "under 4 minutes", with #shorts: read directly, nothing opens on screen
  return ytsearch.search(query + " #shorts", { shorts: true, max: 12 });
}
const deps = {
  searchVideos: (q) => media.searchYouTube({ query: q, recentDays: 60, popular: true, unseen: true, max: 8 }),
  searchShorts: youtubeShorts,
  searchWeb: (q) => web.search(q, { max: 8 }).then((r) => r.results ?? []),
  llmReady: () => llm.ready(),
  complete: (o) => llm.complete(o),
  played: () => media.playedIds(),
  webAllowed: () => Boolean(permissions.get().web),
  now: () => new Date(),
};
export function _setDeps(d) { Object.assign(deps, d); }

// ---- ranking -------------------------------------------------------------------------------------------------------
const JUNK = /(^|\.)(pinterest\.|quora\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|amazon\.|ebay\.|walmart\.com|etsy\.com|reddit\.com|youtube\.com|youtu\.be|linkedin\.com|scribd\.com|coursehero\.com)/i;
const PAYWALL = /(^|\.)(wsj\.com|nytimes\.com|ft\.com|bloomberg\.com|washingtonpost\.com|economist\.com|thetimes\.co\.uk|telegraph\.co\.uk|newyorker\.com|theatlantic\.com)/i;
const TRUSTED = /(^|\.)(nationalgeographic\.com|smithsonianmag\.com|si\.edu|noaa\.gov|bbc\.(com|co\.uk)|nasa\.gov|nature\.com|sciencedaily\.com|livescience\.com|phys\.org|newscientist\.com|audubon\.org|oceana\.org|mbari\.org|scientificamerican\.com|apnews\.com|reuters\.com|npr\.org|outdoorlife\.com|fieldandstream\.com|meateater\.com|realtree\.com|popularmechanics\.com|wired\.com|theverge\.com|arstechnica\.com|seriouseats\.com|bonappetit\.com|finewoodworking\.com|runnersworld\.com)$/i;
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const views = (s) => { const m = /([\d.,]+)\s*([KMB])?/i.exec(String(s ?? "").replace(/,/g, "")); if (!m) return 0; return Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[String(m[2] ?? "").toLowerCase()] ?? 1); };
const ageDays = (s) => { const m = /(\d+)\s*(minute|hour|day|week|month|year)/i.exec(String(s ?? "")); if (!m) return 30; return Number(m[1]) * { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }[m[2].toLowerCase()]; };
const keyOf = (x) => x.videoId ? `yt:${x.videoId}` : `url:${String(x.url ?? "").replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase()}`;
// "Rare octopus unfurls #shorts #ocean" → "Rare octopus unfurls"
const cleanTitle = (t) => { const s = String(t ?? "").trim(); return (s.replace(/(\s*#[\p{L}\d_]+)+\s*$/u, "").trim() || s).slice(0, 200); };
const idOf = (k) => createHash("sha1").update(k).digest("hex").slice(0, 12);
function score(c) {
  if (c.type === "article") return (TRUSTED.test(host(c.url)) ? 50 : 10) + Math.max(0, 8 - (c.rank ?? 0));
  const v = views(c.views), a = ageDays(c.age);
  return Math.log10(v + 10) * 10 + Math.max(0, 30 - a) / 3 + (c.type === "short" ? 2 : 0);
}

// ---- one run: find new things about one interest ---------------------------------------------------------------------
let running = null;
export async function run({ interest, like = null, reason = "scheduled" } = {}) {
  if (running) return running;
  running = (async () => {
    const all = topics();
    const topic = interest ? String(interest).trim() : pickInterest(all);
    if (!topic) return { ok: false, why: "no-interests", items: [] };
    const kind = await classify(topic);
    const lr = load().lastRun[topic.toLowerCase()] ?? { at: 0, n: 0 };
    const q = queries(like ? `${topic} ${like}` : topic, kind, lr.n);
    const seen = new Set(load().keys), played = deps.played?.() ?? new Set();
    const cands = [];
    const add = (x) => { const k = keyOf(x); if (!k || seen.has(k) || cands.some((c) => keyOf(c) === k) || (x.videoId && played.has(x.videoId))) return; cands.push(x); };
    const tasks = [
      deps.searchVideos(q.video).then((r) => r.filter((v) => v.videoId && !v.live).slice(0, 6).forEach((v) => add({ type: "video", ...v, url: `https://www.youtube.com/watch?v=${v.videoId}` }))).catch(() => {}),
      deps.searchShorts(q.short).then((r) => r.filter((v) => v.videoId).slice(0, 5).forEach((v) => add({ type: "short", ...v, url: `https://www.youtube.com/shorts/${v.videoId}` }))).catch(() => {}),
    ];
    if (deps.webAllowed()) for (const aq of q.articles) tasks.push(deps.searchWeb(aq).then((r) => r.filter((a) => /^https?:/.test(a.url) && !JUNK.test(host(a.url)) && !PAYWALL.test(host(a.url))).slice(0, 5).forEach((a, i) => add({ type: "article", title: a.title, url: a.url, snippet: a.snippet, source: host(a.url), rank: i }))).catch(() => {}));
    await Promise.all(tasks);
    let picks = await choose(topic, kind, cands);
    const now = Date.now();
    const items = picks.map((c) => ({
      id: idOf(keyOf(c)), key: keyOf(c), interest: topic, kind, type: c.type, title: cleanTitle(c.title), url: c.url, videoId: c.videoId ?? null,
      thumb: c.videoId ? `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg` : null, source: c.type === "article" ? c.source : c.channel ?? "", views: c.views ?? "", age: c.age ?? c.published ?? "",
      length: c.length ?? "", snippet: String(c.snippet ?? "").slice(0, 300), why: c.why ?? "", found: now, seen: false, liked: false, dismissed: false,
    }));
    const d = load();
    d.feed = [...items, ...d.feed].slice(0, FEED_MAX);
    d.keys = [...new Set([...d.keys, ...items.map((x) => x.key)])].slice(-KEYS_MAX);
    d.lastRun[topic.toLowerCase()] = { at: now, n: lr.n + 1 };
    save();
    if (items.length) announcer.broadcast("discover", { kind: "new", interest: topic, items, toast: maybeToast(topic, items, reason) });
    return { ok: true, interest: topic, kind, items, candidates: cands.length };
  })().finally(() => { running = null; });
  return running;
}
// The interest least recently looked at, nudged by 👍/👎
function pickInterest(all) {
  if (!all.length) return null;
  const d = load(), cut = Date.now() - 7 * 86400_000;
  const w = (t) => { const v = d.votes[t.toLowerCase()] ?? { up: 0, down: [] }; const downs = (v.down ?? []).filter((x) => x > cut).length; return (d.lastRun[t.toLowerCase()]?.at ?? 0) + downs * 12 * 3600_000 - (v.up ?? 0) * 3600_000; };
  return [...all].sort((a, b) => w(a) - w(b))[0];
}
// The best few: 1–2 videos, a short, 1–2 articles; with an AI it picks and says why
async function choose(topic, kind, cands) {
  if (!cands.length) return [];
  const byType = (t) => cands.filter((c) => c.type === t).sort((a, b) => score(b) - score(a));
  const shortlist = [...byType("video").slice(0, 4), ...byType("short").slice(0, 3), ...byType("article").slice(0, 5)];
  if (deps.llmReady() && shortlist.length > 1) {
    try {
      const list = shortlist.map((c, i) => `${i}. [${c.type}] ${c.title}${c.type === "article" ? ` — ${c.source}: ${String(c.snippet ?? "").slice(0, 140)}` : ` — ${c.channel ?? ""} ${c.views ?? ""} ${c.age ?? ""}`}`).join("\n");
      const r = await deps.complete({ system: "You pick great things for someone to watch or read. Reply with JSON only.",
        prompt: `Someone who's into "${topic}" (${kind === "discovery" ? "they like new discoveries, rare sightings and amazing finds" : kind === "news" ? "they like the latest news" : "they like tips, gear, how-tos and good stories"}). From these, pick the best 3 or 4 (mix videos, shorts and articles when good ones exist; skip clickbait, spam and anything unrelated). For each, one short friendly line on why they'd like it (max 14 words).\n${list}\nReply as: [{"i":0,"why":"..."}]`,
        maxTokens: 300, timeoutMs: 25_000 });
      const arr = JSON.parse(/\[[\s\S]*\]/.exec(r ?? "")?.[0] ?? "[]");
      const out = arr.map((x) => shortlist[Number(x.i)] && { ...shortlist[Number(x.i)], why: String(x.why ?? "").slice(0, 140) }).filter(Boolean);
      if (out.length) return [...new Map(out.map((c) => [keyOf(c), c])).values()].slice(0, 4);
    } catch { /* fall back to simple ranking */ }
  }
  const out = [...byType("video").slice(0, kind === "discovery" ? 1 : 2), ...byType("short").slice(0, 1), ...byType("article").slice(0, kind === "hobby" ? 1 : 2)];
  return out.map((c) => ({ ...c, why: c.type === "short" ? `A quick ${topic} clip` : c.type === "video" ? (views(c.views) >= 1e5 ? `Popular right now (${c.views})` : `New ${topic} video`) : TRUSTED.test(host(c.url)) ? `From ${c.source}` : `About ${topic}` }));
}
// A gentle pop-up at most N a day, in the daytime
function maybeToast(topic, items, reason) {
  const s = load().settings, d = load(), today = deps.now().toLocaleDateString("en-CA"), h = deps.now().getHours();
  if (!s.toasts || reason === "asked" || h < 9 || h >= 21) return null;
  if (d.toasts.date !== today) d.toasts = { date: today, count: 0 };
  if (d.toasts.count >= s.maxToastsPerDay) return null;
  const it = items.find((x) => x.type === "video") ?? items.find((x) => x.type === "short") ?? items[0];
  d.toasts.count++; save();
  const text = it.type === "article" ? `Found a good ${topic} article you might like.` : `Found a popular new ${topic} ${it.type === "short" ? "short clip" : "video"}. Want to watch?`;
  return { id: it.id, type: it.type, text, title: it.title };
}

// ---- the feed --------------------------------------------------------------------------------------------------------
export function feed({ all = false, limit = 30 } = {}) { return load().feed.filter((x) => all || !x.dismissed).slice(0, limit); }
export function today() { const t = deps.now().toLocaleDateString("en-CA"); return feed().filter((x) => new Date(x.found).toLocaleDateString("en-CA") === t); }
let lastShown = null;   // { id, at }: what "more like that" / "not interested" mean
export function mark(id, action) {
  const d = load(), it = d.feed.find((x) => x.id === id);
  if (!it) return { ok: false };
  if (action === "seen" || action === "shown") { it.seen = true; it.shownAt = Date.now(); lastShown = { id, at: Date.now() }; }
  if (action === "opened" || action === "played") { it.seen = true; it.opened = Date.now(); lastShown = { id, at: Date.now() }; }
  if (action === "liked") { it.liked = true; const v = (d.votes[it.interest.toLowerCase()] ??= { up: 0, down: [] }); v.up++; }
  if (action === "dismissed") { it.dismissed = true; const v = (d.votes[it.interest.toLowerCase()] ??= { up: 0, down: [] }); v.down = [...(v.down ?? []), Date.now()].slice(-20); }
  save();
  if (action === "liked") run({ interest: it.interest, like: likeWords(it.title), reason: "asked" }).catch(() => {});
  if (action === "liked" || action === "dismissed") announcer.broadcast("discover", { kind: "update", id, action });
  return { ok: true, item: it };
}
// a couple of meaningful words from a title, for "more like this"
const STOP = new Set("the a an and or of to in on for with at by from this that these those is are was were be how why what when your you my our new best top video shorts short official full".split(" "));
function likeWords(title) { return String(title).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).slice(0, 2).join(" "); }
export const lastShownItem = () => (lastShown && Date.now() - lastShown.at < 20 * 60_000 ? load().feed.find((x) => x.id === lastShown.id) : null);

// ---- the schedule -----------------------------------------------------------------------------------------------------
let timer = null;
export function start() {
  if (timer) return;
  const tick = () => {
    const s = load().settings, now = deps.now(), h = now.getHours();
    if (!s.on || s.frequency === "off" || ((h < 7 || h >= 22) && !process.env.DAYSPRING_DISCOVER_ANYTIME)) return;   // quiet at night
    if (announcer.clientCount() < 1) return;                                      // only while the screen is on
    if (!topics().length) return;
    const last = Math.max(0, ...Object.values(load().lastRun).map((x) => x.at ?? 0));
    const empty = !feed().some((x) => !x.seen);
    if (Date.now() - last >= FREQ[s.frequency] || (empty && Date.now() - last > 45 * 60_000)) run().catch(() => {});
  };
  // tests shorten these: DAYSPRING_DISCOVER_FIRST_MS / DAYSPRING_DISCOVER_EVERY_MS
  setTimeout(tick, Number(process.env.DAYSPRING_DISCOVER_FIRST_MS) || 2 * 60_000);
  timer = setInterval(tick, Number(process.env.DAYSPRING_DISCOVER_EVERY_MS) || 10 * 60_000);
}

// ---- interests: free text ------------------------------------------------------------------------------------------
export function addInterest(text) { const r = interests.addFree(text); announcer.broadcast("discover", { kind: "interests", interests: r.interests }); if (r.added.length && load().settings.on) setTimeout(() => run({ interest: r.added[0], reason: "asked" }).catch(() => {}), 1500); return r; }
export function removeInterest(text) { const r = interests.removeFree(text); announcer.broadcast("discover", { kind: "interests", interests: r.interests }); return r; }

// ---- voice and typing (no AI needed) ----------------------------------------------------------------------------------
const clean = (s) => String(s).replace(/[.!?]+$/, "").replace(/^(the|my)\s+/i, "").trim();
export async function handle(text) {
  const t = String(text).trim(), q = t.toLowerCase().replace(/[.!?]+$/, "");
  let m;
  if ((m = /^(?:please )?(?:add|put) (.+?) (?:to|on|in|into) my (?:interests|hobbies|interest list|hobby list)$/i.exec(t)) || (m = /^i'?m (?:really |also )?(?:into|interested in) (.+)$/i.exec(t)) || (m = /^my new (?:hobby|interest) is (.+)$/i.exec(t))) {
    const items = clean(m[1]).split(/\s*(?:,|\band\b)\s*/).filter(Boolean);
    if (!items.length || items.some((x) => x.split(/\s+/).length > 5 || /^(it|that|this|them|you)$/i.test(x))) return null;   // "I'm into buying a new car next month…" is chat, not an interest
    const r = addInterest(items);
    return r.added.length ? `Added ${r.added.join(" and ")} to your interests.${load().settings.on ? " I'll keep an eye out for good videos and articles about " + (r.added.length > 1 ? "them" : "it") + "." : ""}` : `${items.join(" and ")} ${items.length > 1 ? "are" : "is"} already on your list.`;
  }
  if ((m = /^(?:please )?(?:remove|take|delete|drop) (.+?) (?:from|off|out of) my (?:interests|hobbies|interest list)$/i.exec(t)) || (m = /^i'?m not (?:into|interested in) (.+?)(?: anymore| any more)?$/i.exec(t))) {
    const r = removeInterest(clean(m[1]));
    return r.removed.length ? `Okay, I took ${r.removed.join(" and ")} off your interests.` : `I didn't find ${clean(m[1])} in your interests.`;
  }
  if (/^what(?:'s| are| is) (?:on )?my (?:interests|hobbies|interest list)|^(?:list|show) my (?:interests|hobbies)/.test(q)) {
    const l = owner.get().interests ?? [];
    return l.length ? `Your interests: ${l.join(", ")}.` : "You haven't added any interests yet. Say something like \"add woodworking to my interests\".";
  }
  if ((m = /^(?:show me|find me|get me|discover) (?:something|anything) (?:new|cool|interesting|fun)? ?(?:about|on|for|in) (.+)$/i.exec(t))) {
    const topic = clean(m[1]);
    run({ interest: topic, reason: "asked" }).then((r) => announcer.broadcast("discover", { kind: "show", items: r.items ?? [], interest: topic })).catch(() => {});
    return `Looking for something good about ${topic}. It'll show up on the screen in a moment.`;
  }
  if (/^(?:find|show) me something new$|^surprise me$/.test(q)) {
    run({ reason: "asked" }).then((r) => announcer.broadcast("discover", { kind: "show", items: r.items ?? [], interest: r.interest })).catch(() => {});
    return "Looking for something new for you. One moment.";
  }
  if (/^what (?:did|have) you (?:find|found) (?:for me )?(?:today)?|^(?:show|open) (?:me )?(?:my )?(?:discover|for you)(?: feed| list)?$|^show me what you found/.test(q)) {
    const list = today().length ? today() : feed().slice(0, 6);
    announcer.broadcast("discover", { kind: "open" });
    if (!list.length) return topics().length ? "Nothing yet today. I look a few times a day; say \"surprise me\" to look now." : "Tell me what you're into first, like \"add hiking to my interests\", and I'll find good videos and articles about it.";
    return `${today().length ? "Today" : "Lately"} I found: ${list.slice(0, 5).map((x) => `${x.type === "article" ? "an article" : x.type === "short" ? "a short" : "a video"} about ${x.interest}, "${x.title}"`).join("; ")}. They're on the screen.`;
  }
  if (/^(?:more like (?:that|this)(?: one)?|show me more like (?:that|this)|i like (?:that|this) one)$/.test(q)) {
    const it = lastShownItem(); if (!it) return null;
    mark(it.id, "liked");
    return `Got it. I'll look for more like "${it.title}".`;
  }
  if (/^(?:not interested(?: in (?:that|this)(?: one)?)?|i don'?t like (?:that|this) one|skip (?:that|this) one|no more like (?:that|this))$/.test(q)) {
    const it = lastShownItem(); if (!it) return null;
    mark(it.id, "dismissed");
    return "Okay, I won't show that one again, and I'll show a bit less like it.";
  }
  return null;
}

// ---- AI tools ------------------------------------------------------------------------------------------------------
export const TOOLS = [
  { name: "interests_update", description: "Add or remove the owner's interests and hobbies (free text like 'woodworking', 'marine wildlife', 'pickleball'). Interests shape recommendations and the Discover feed (popular videos, short clips and articles found now and then).",
    input_schema: { type: "object", properties: { add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } } } },
  { name: "discover_now", description: "Look right now for popular new videos, YouTube Shorts and articles about one of the owner's interests (or any topic), and show them on the screen's For you slide. Use for 'find me something new about X', 'show me cool ocean stuff'.",
    input_schema: { type: "object", properties: { interest: { type: "string", description: "Optional: a topic; empty = the next interest in rotation" } } } },
  { name: "discover_feed", description: "What Dayspring found for the owner lately (the Discover feed): titles, links, why they'd like each. Use for 'what did you find for me today?'.",
    input_schema: { type: "object", properties: { today: { type: "boolean" } } } },
];
export async function runTool(name, input = {}) {
  if (name === "interests_update") {
    const a = (input.add ?? []).length ? addInterest(input.add) : null, r = (input.remove ?? []).length ? removeInterest(input.remove) : null;
    return { added: a?.added ?? [], removed: r?.removed ?? [], interests: owner.get().interests ?? [] };
  }
  if (name === "discover_now") { const r = await run({ interest: input.interest || undefined, reason: "asked" }); announcer.broadcast("discover", { kind: "show", items: r.items ?? [], interest: r.interest }); return { interest: r.interest, found: (r.items ?? []).map((x) => ({ type: x.type, title: x.title, url: x.url, why: x.why })), note: r.why === "no-interests" ? "No interests yet." : undefined }; }
  if (name === "discover_feed") { const l = input.today ? today() : feed({ limit: 12 }); announcer.broadcast("discover", { kind: "open" }); return { items: l.map((x) => ({ type: x.type, interest: x.interest, title: x.title, url: x.url, why: x.why, seen: x.seen })) }; }
  return undefined;
}
export function contextText() {
  const l = today().slice(0, 4);
  return l.length ? `Found for the owner today (Discover feed): ${l.map((x) => `${x.type} "${x.title}" (${x.interest})`).join("; ")}.` : "";
}
