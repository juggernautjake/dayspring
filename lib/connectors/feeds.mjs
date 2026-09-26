// News and RSS feeds: add any feed by its link (blogs, news sites, podcasts' RSS, YouTube channel feeds, Reddit's .rss…)
// or pick a starter feed by topic. "What's the news?", "read me the latest from Ars Technica", "any science news?".
// Also a helper other parts of Dayspring use (Discover: "articles about <interest>"). Read-only; no account needed.
// Kept in data/connectors/feeds.json: { feeds: [{ id, name, url, topic }] }. Each feed is fetched at most every 20 minutes.
import { randomBytes } from "node:crypto";
import * as store from "./store.mjs";
import * as owner from "../owner.mjs";

const GN = (path) => `https://news.google.com/rss/${path}${path.includes("?") ? "&" : "?"}hl=en-US&gl=US&ceid=US:en`;
export const newsSearchUrl = (q) => GN(`search?q=${encodeURIComponent(q)}`);
// starter feeds by topic (Google News topic feeds are stable and free; a few well-known sources alongside)
export const STARTERS = {
  top: [{ name: "Top stories", url: GN("") }, { name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" }, { name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" }],
  world: [{ name: "World news", url: GN("headlines/section/topic/WORLD") }],
  nation: [{ name: "U.S. news", url: GN("headlines/section/topic/NATION") }],
  business: [{ name: "Business", url: GN("headlines/section/topic/BUSINESS") }],
  tech: [{ name: "Technology", url: GN("headlines/section/topic/TECHNOLOGY") }, { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" }, { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" }],
  science: [{ name: "Science", url: GN("headlines/section/topic/SCIENCE") }, { name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml" }],
  health: [{ name: "Health", url: GN("headlines/section/topic/HEALTH") }],
  sports: [{ name: "Sports", url: GN("headlines/section/topic/SPORTS") }],
  entertainment: [{ name: "Entertainment", url: GN("headlines/section/topic/ENTERTAINMENT") }],
  faith: [{ name: "Faith news", url: newsSearchUrl("Christian faith church news") }],
};
const TOPIC_WORDS = { tech: /tech|computer|gadget|ai\b/, science: /science|space|nature/, sports: /sport/, health: /health|medical|fitness/, business: /business|money|market|econom|finance/, world: /world|international|global/, nation: /\bus\b|u\.s\.|national|america/, entertainment: /entertain|movie|tv|celebr|music/, faith: /faith|christian|church|religio/, top: /top|headline|general|news/ };

const load = () => ({ feeds: [], ...store.load("feeds") });
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
export function status() { const f = load().feeds; return { id: "feeds", connected: f.length > 0, who: f.length ? `${f.length} feed${f.length > 1 ? "s" : ""}` : null, feeds: f.map((x) => ({ id: x.id, name: x.name, topic: x.topic ?? null, host: host(x.url) })), topics: Object.keys(STARTERS) }; }
export const connected = () => load().feeds.length > 0;

// connect: { url, name? } adds one feed; { topic } adds that topic's starter feeds; { local: true } adds news for the owner's town
export async function connect({ url, name, topic, local } = {}) {
  const s = load();
  const add = (f) => { if (!s.feeds.some((x) => x.url === f.url)) s.feeds.push({ id: randomBytes(4).toString("hex"), ...f }); };
  if (local) {
    const place = owner.get().location?.place;
    if (!place) throw new Error("Set your town in Settings → Where you are first, then add local news.");
    add({ name: `${place} news`, url: newsSearchUrl(`${place} local news`), topic: "local" });
  } else if (topic) {
    const t = String(topic).toLowerCase(), key = STARTERS[t] ? t : Object.keys(TOPIC_WORDS).find((k) => TOPIC_WORDS[k].test(t));
    if (key) for (const f of STARTERS[key]) add({ ...f, topic: key });
    else add({ name: `${topic} news`, url: newsSearchUrl(topic), topic: t });   // any topic: a news search feed
  } else {
    let u = String(url ?? "").trim();
    if (!/^https?:\/\//i.test(u)) throw new Error("Paste the feed's link (it starts with https://). Many sites show it as an RSS icon or at /feed or /rss.");
    const feed = await fetchFeed(u);
    if (!feed.items.length && !feed.title) throw new Error("That link doesn't look like a news feed (RSS or Atom). Try the site's “RSS” link.");
    add({ name: String(name || feed.title || host(u)).slice(0, 60), url: u, topic: null });
  }
  store.save("feeds", s);
  return status();
}
export function remove({ id } = {}) { const s = load(); const k = String(id ?? "").toLowerCase(); s.feeds = s.feeds.filter((f) => f.id !== id && f.name.toLowerCase() !== k); store.save("feeds", s); return status(); }
export function disconnect() { store.forget("feeds"); cache.clear(); return status(); }

// ---- fetching and parsing (RSS 2.0, RSS 1.0/RDF and Atom) ----
const cache = new Map();
async function fetchFeed(u) {
  const hit = cache.get(u);
  if (hit && Date.now() - hit.at < 20 * 60_000) return hit.feed;
  const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Dayspring feed reader", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
  if (!r.ok) throw await store.fail(r, host(u) || "The feed");
  const feed = parseFeed(await r.text());
  cache.set(u, { at: Date.now(), feed });
  return feed;
}
const decode = (s) => String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, " ").trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml); return m ? m[1] : ""; };
export function parseFeed(xml) {
  const title = decode(tag(tag(xml, "channel") || xml, "title"));
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const items = blocks.map((b) => {
    let link = decode(tag(b, "link"));
    if (!link) { const m = /<link\b[^>]*href="([^"]+)"[^>]*\/?>/i.exec(b); link = m ? m[1].replace(/&amp;/g, "&") : ""; }
    const when = decode(tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || tag(b, "dc:date"));
    const src = decode(tag(b, "source"));
    let t = decode(tag(b, "title"));
    if (src && t.endsWith(` - ${src}`)) t = t.slice(0, -(src.length + 3));   // Google News puts " - Source" on titles
    return { title: t, link, source: src || null, published: when && !isNaN(new Date(when)) ? new Date(when).toISOString() : null, summary: decode(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 400) };
  }).filter((i) => i.title && /^https?:/i.test(i.link));
  return { title, items };
}

// The latest items: from one feed (by name/topic words), or all feeds mixed, newest first
export async function latest({ feed = "", limit = 8 } = {}) {
  const want = String(feed).toLowerCase().trim();
  let feeds = load().feeds;
  if (want) feeds = feeds.filter((f) => f.name.toLowerCase().includes(want) || (f.topic ?? "").includes(want) || host(f.url).includes(want));
  if (!feeds.length && want) {   // not subscribed: a one-off search feed for those words
    const r = await fetchFeed(STARTERS[want]?.[0]?.url ?? newsSearchUrl(want)).catch(() => ({ items: [] }));
    return r.items.slice(0, limit).map((i) => ({ ...i, feed: `${want} (news search)` }));
  }
  if (!feeds.length) feeds = STARTERS.top.slice(0, 1).map((f) => ({ ...f, id: "top" }));
  const all = [];
  for (const f of feeds.slice(0, 12)) { const r = await fetchFeed(f.url).catch(() => ({ items: [] })); all.push(...r.items.slice(0, 15).map((i) => ({ ...i, feed: f.name }))); }
  const seen = new Set();
  return all.filter((i) => (seen.has(i.title) ? false : seen.add(i.title)))
    .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? "")).slice(0, Math.max(1, Math.min(30, limit)));
}

// For Discover (Worker Q) and anything else that wants fresh articles about a topic: [{ title, link, source, published, summary }]
export async function discoverItems(topic, limit = 6) {
  const r = await fetchFeed(newsSearchUrl(`${topic} when:14d`)).catch(() => ({ items: [] }));
  return r.items.slice(0, limit);
}
export function clearCache() { cache.clear(); }
