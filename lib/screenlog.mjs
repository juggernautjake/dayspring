// What the Dayspring screen shows, so the assistant knows about it: what's on it right now (the slide, the cards,
// what's playing, any open panel), what's coming up in the rotation, and everything shown in the last 24 hours
// (slides with their words, pop-ups, videos, songs). "Read me that proverb", "what was that quote?", "what's on the
// screen?" all work from here. Kept on this computer only (data/screenlog.json), trimmed to 24 hours.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "screenlog.json");
const DAY = 24 * 3600_000, MAX = 600;
let log = null, now = { at: 0 }, saveTimer = 0;
const load = () => (log ??= existsSync(FILE) ? (() => { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return []; } })() : []);
const trim = () => { const cut = Date.now() - DAY; log = load().filter((e) => e.at >= cut).slice(-MAX); };
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { writeFileSync(FILE, JSON.stringify(load())); } catch { /* not critical */ } }, 3000); };
const clean = (t, n = 4000) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Something appeared: { kind: "slide"|"toast"|"video"|"song"|"photo"|"panel"|"announce", view?, title, text }
export function shown(e = {}) {
  const entry = { at: Date.now(), kind: clean(e.kind, 20) || "slide", view: clean(e.view, 30) || null, title: clean(e.title, 200), text: clean(e.text) };
  if (!entry.title && !entry.text) return null;
  const last = load().at(-1);
  if (last && last.kind === entry.kind && last.title === entry.title && last.text === entry.text && entry.at - last.at < 10 * 60_000) { last.at = entry.at; return last; }   // same thing again
  load().push(entry); trim(); saveSoon();
  return entry;
}
// What's on the screen right now, and what's lined up next (sent by the display whenever it changes)
export function setState(s = {}) {
  now = { at: Date.now(), slide: s.slide ? { view: clean(s.slide.view, 30), title: clean(s.slide.title, 200), text: clean(s.slide.text) } : null,
    cards: (s.cards ?? []).slice(0, 8).map((c) => clean(c, 300)).filter(Boolean), playing: clean(s.playing, 200) || null,
    panels: (s.panels ?? []).slice(0, 6).map((p) => clean(p, 300)).filter(Boolean),
    queue: (s.queue ?? []).slice(0, 8).map((q) => ({ view: clean(q.view, 30), title: clean(q.title, 200), text: clean(q.text, 1500) })) };
}
export const state = () => now;
export function history({ query = "", hours = 24, limit = 12, kind = "" } = {}) {
  const cut = Date.now() - Math.min(24, Math.max(0.05, Number(hours) || 24)) * 3600_000;
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const hits = load().filter((e) => e.at >= cut && (!kind || e.kind === kind || e.view === kind))
    .map((e) => ({ e, score: words.length ? words.filter((w) => `${e.title} ${e.text} ${e.view ?? ""}`.toLowerCase().includes(w)).length : 1 }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.e.at - a.e.at);
  return hits.slice(0, Math.max(1, Math.min(40, limit))).map(({ e }) => ({ ...e, minutesAgo: Math.round((Date.now() - e.at) / 60_000) }));
}

// For the assistant's context: short, current
export function contextText() {
  const lines = [];
  const fresh = now.at && Date.now() - now.at < 10 * 60_000;
  if (fresh && now.slide) lines.push(`Main panel ("${now.slide.title}"): ${now.slide.text.slice(0, 700)}`);
  if (fresh && now.cards?.length) lines.push(`Cards: ${now.cards.join(" | ").slice(0, 500)}`);
  if (fresh && now.playing) lines.push(`Playing: ${now.playing}`);
  if (fresh && now.panels?.length) lines.push(`Open: ${now.panels.join(" | ")}`);
  if (fresh && now.queue?.length) lines.push(`Next slides on the screen (the main panel changes about every 40 seconds; "what's coming up on the screen" means these, not the schedule): ${now.queue.map((q) => `${q.title}${q.text ? ` ("${q.text.slice(0, 160)}")` : ""}`).join("; ")}`);
  const n = load().filter((e) => e.at >= Date.now() - DAY).length;
  if (n) lines.push(`${n} things were shown on the screen in the last 24 hours; use screen_history to look any of them up (full words).`);
  return lines.length ? `ON THE DAYSPRING SCREEN (the owner can see this; read any of it aloud when asked):\n${lines.join("\n")}` : "";
}

// No AI needed: "read me that proverb", "what was that quote", "read the verse", "what's on the screen"
const KIND_WORDS = [[/\b(proverb|quote|quotation|saying|encouragement)\b/, ["quote"]], [/\b(verse|verses|scripture|memory verse)\b/, ["memory", "quote"]], [/\b(prayer list|praying for)\b/, ["prayer", "prayerChurch"]], [/\bweather\b/, ["weather"]], [/\b(video)\b/, ["video"]], [/\b(photo|picture)\b/, ["photo"]]];
export function handle(text) {
  const q = String(text).toLowerCase().replace(/[?!.]/g, "").trim();
  if (/^(what'?s|what is) on (the |my )?screen|^read (me )?(what'?s|what is) on (the |my )?screen|^what am i looking at/.test(q)) {
    if (!now.slide) return null;
    return `The main panel shows ${now.slide.title}: ${now.slide.text.slice(0, 600)}`;
  }
  const ask = /\b(read|say|repeat|what (was|did|does|is)|tell me)\b/.test(q) && /\b(that|the|last|this|it)\b/.test(q);
  if (!ask) return null;
  const k = KIND_WORDS.find(([re]) => re.test(q));
  if (!k) return null;
  const views = k[1];
  // what's on screen now first, then the most recent one shown
  if (now.slide && views.includes(now.slide.view) && Date.now() - now.at < 5 * 60_000 && !/\blast\b/.test(q)) return now.slide.text.slice(0, 900) || null;
  const e = [...load()].reverse().find((x) => views.includes(x.view));
  const proverb = /\bproverb\b/.test(q) ? [...load()].reverse().find((x) => /proverbs?\b/i.test(`${x.title} ${x.text}`)) : null;
  const hit = proverb ?? e;
  if (!hit) return null;
  const ago = Math.round((Date.now() - hit.at) / 60_000);
  return `${ago > 2 ? `From ${ago < 60 ? `${ago} minutes` : `${Math.round(ago / 60)} hour${Math.round(ago / 60) === 1 ? "" : "s"}`} ago: ` : ""}${hit.text.slice(0, 900)}`;
}
