// Every conversation, kept: what the owner said and what the assistant said, with timestamps, grouped into conversations
// (a new one starts after 15 quiet minutes), and tagged with topics and keywords so it can be found again later:
// "what did we talk about with the budget last week?", "what did I say about work?".
// Stored as one JSON line per utterance per day (data/transcripts/YYYY-MM-DD.jsonl) plus an index of conversations.
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as llm from "./llm.mjs";
import * as owner from "./owner.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "transcripts");
const INDEX = join(DIR, "index.json");
const GAP = 15 * 60_000;
mkdirSync(DIR, { recursive: true });

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let idx = null;
function index() { if (!idx) idx = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : { conversations: [] }; return idx; }
function saveIndex() { writeFileSync(INDEX, JSON.stringify(idx, null, 2)); }

// Topics the assistant knows to look for, so a conversation about "deadlifts" is findable as "Fitness". The owner's own
// topics (work, study subjects, hobbies) come first, from data/topics.json: { "topics": [["Name", "regex source"], …] }.
const TOPICS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "topics.json");
function ownTopics() {
  try {
    if (!existsSync(TOPICS_FILE)) return [];
    return (JSON.parse(readFileSync(TOPICS_FILE, "utf8")).topics ?? []).map(([name, src]) => [name, new RegExp(src, "i")]);
  } catch { return []; }
}
const TOPICS = [
  ...ownTopics(),
  ["Faith", /\b(god|jesus|pray(er|ing)?|bible|scripture|verse|church|worship|devotion|psalm|gospel|sermon)\b/i],
  ["Fitness", /\b(gym|workout|bench|squat|deadlift|run|pr|lift(ing)?)\b/i],
  ["Schedule", /\b(schedule|reschedule|move|remind(er)?|tomorrow|appointment|calendar)\b/i],
  ["Chores and habits", /\b(laundry|dishes|kitchen|chore|spanish|instrument|guitar|piano|practice)\b/i],
  ["Music and video", /\b(spotify|youtube|song|playlist|video|music)\b/i],
  ["Feelings", /\b(tired|stressed|anxious|excited|happy|frustrated|sad|overwhelmed|proud|motivated)\b/i],
];
const STOP = new Set("a an the and or but if then so to of in on at for with from by about as is are was were be been being am i you he she it we they me my your our their this that these those do does did doing have has had having can could would should will just not no yes okay ok like really very what when where who why how all any some more most much many there here up down out over into also too than then now well get got go going let lets dayspring hey good great sure thanks thank please yeah".split(" "));

export function keywordsOf(text, n = 8) {
  const counts = new Map();
  for (const w of String(text).toLowerCase().match(/[a-z][a-z'\-]{2,}/g) ?? []) {
    const k = w.replace(/'s$/, "");
    if (STOP.has(k) || /'(ll|m|re|ve|d|t)$/.test(k) || /^(checked|minutes|nice|work|due|next|one|off)$/.test(k)) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, n).map(([w]) => w);
}
export const topicsOf = (text) => [...new Set(TOPICS.filter(([, re]) => re.test(text)).map(([t]) => t))];

// Record one utterance. role: the owner's role (whatever the caller writes) | "dayspring" | "event" (something the TV said on its own, like a check-in).
// Anything that isn't the assistant or an event is the owner speaking.
const isUser = (role) => role !== "dayspring" && role !== "event" && role !== "assistant";
const whoOf = (role) => (isUser(role) ? owner.name() : "Dayspring");
export function log({ role, text, kind = "chat", surface = "tv", at = new Date() }) {
  if (!String(text ?? "").trim()) return null;
  const I = index();
  let conv = I.conversations[I.conversations.length - 1];
  if (!conv || at - Date.parse(conv.end) > GAP) {
    if (conv && !conv.summary) summarize(conv.id).catch(() => {});
    conv = { id: randomUUID(), date: localDate(at), start: at.toISOString(), end: at.toISOString(), surface, turns: 0, topics: [], keywords: [], title: null, summary: null };
    I.conversations.push(conv);
  }
  const line = { at: at.toISOString(), conv: conv.id, role, kind, surface, text: String(text).trim() };
  appendFileSync(join(DIR, `${localDate(at)}.jsonl`), JSON.stringify(line) + "\n");
  conv.end = line.at; conv.turns++;
  conv.topics = [...new Set([...conv.topics, ...topicsOf(line.text)])];
  conv.keywords = [...new Set([...conv.keywords, ...keywordsOf(line.text, 4)])].slice(0, 24);
  if (!conv.title && isUser(role)) conv.title = line.text.slice(0, 80);
  saveIndex();
  return line;
}

function linesOf(conv) {
  const days = new Set([conv.date, localDate(new Date(conv.end))]);
  const out = [];
  for (const d of days) {
    const f = join(DIR, `${d}.jsonl`);
    if (!existsSync(f)) continue;
    for (const l of readFileSync(f, "utf8").split("\n")) { if (!l) continue; try { const j = JSON.parse(l); if (j.conv === conv.id) out.push(j); } catch { /* skip a torn line */ } }
  }
  return out;
}
export function conversation(id) {
  const conv = index().conversations.find((c) => c.id === id || c.id.startsWith(id));
  if (!conv) throw new Error(`no conversation ${id}`);
  return { ...conv, lines: linesOf(conv) };
}
export function list({ from, to, limit = 50 } = {}) {
  return index().conversations.filter((c) => (!from || c.date >= from) && (!to || c.date <= to)).slice(-limit).reverse();
}

// Find what was said about something: matches in topics, keywords, titles and the words themselves. Newest first.
export function search(query, { from, to, role, limit = 8 } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const topicHits = topicsOf(query);
  const results = [];
  for (const conv of index().conversations.slice().reverse()) {
    if ((from && conv.date < from) || (to && conv.date > to)) continue;
    const meta = [conv.title, conv.summary, ...(conv.keywords ?? []), ...(conv.topics ?? [])].join(" ").toLowerCase();
    let score = topicHits.filter((t) => conv.topics.includes(t)).length * 3 + words.filter((w) => meta.includes(w)).length * 2;
    const all = linesOf(conv);
    const lines = all.filter((l) => !role || l.role === role);
    const hits = lines.filter((l) => words.some((w) => l.text.toLowerCase().includes(w)));
    score += hits.length * 2;
    // each hit comes with the other side of the exchange: what the owner said and what the assistant answered
    const exchanges = hits.slice(0, 4).map((h) => {
      const i = all.indexOf(h);
      const pair = isUser(h.role) ? [h, all.slice(i + 1).find((l) => !isUser(l.role))] : [all.slice(0, i).reverse().find((l) => isUser(l.role)), h];
      return pair.filter(Boolean).map((l) => ({ at: l.at, who: whoOf(l.role), text: l.text.slice(0, 300) }));
    });
    if (score > 0) results.push({ id: conv.id, date: conv.date, start: conv.start, title: conv.title, summary: conv.summary, topics: conv.topics, keywords: conv.keywords, score,
      at: hits[0]?.at ?? conv.start, exchanges,
      quotes: (hits.length ? hits : lines).slice(0, 6).map((l) => ({ at: l.at, who: whoOf(l.role), text: l.text.slice(0, 300) })) });
    if (results.length >= 40) break;
  }
  return results.sort((a, b) => b.score - a.score || b.start.localeCompare(a.start)).slice(0, limit);
}

// When an AI is set up, a finished conversation gets a proper title, a two-sentence summary and better keywords.
export async function summarize(id) {
  if (!llm.ready()) return null;
  const conv = index().conversations.find((c) => c.id === id);
  if (!conv || conv.turns < 2) return null;
  const text = linesOf(conv).map((l) => `${whoOf(l.role)}: ${l.text}`).join("\n").slice(0, 12000);
  const raw = await llm.complete({ maxTokens: 300, timeoutMs: 60_000, prompt: text,
    system: `Summarise this conversation between ${owner.name()} and ${owner.their()} assistant ${owner.assistant()} for ${owner.their()} searchable archive. Reply with JSON only: {"title": "...", "summary": "two sentences", "keywords": ["..."], "topics": ["..."]}.` });
  const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  Object.assign(conv, { title: j.title ?? conv.title, summary: j.summary ?? null, keywords: [...new Set([...(j.keywords ?? []), ...conv.keywords])].slice(0, 24), topics: [...new Set([...conv.topics, ...(j.topics ?? [])])] });
  saveIndex();
  return conv;
}

// A readable copy for the notes folder: the day's conversations as markdown.
export function dayMarkdown(date) {
  const convs = index().conversations.filter((c) => c.date === date);
  const t = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return [`# Conversations, ${date}`, "", ...convs.flatMap((c) => [
    `## ${t(c.start)} · ${c.title ?? "Conversation"}`, c.summary ? `_${c.summary}_` : "", `Topics: ${c.topics.join(", ") || "none"} · Keywords: ${c.keywords.join(", ")}`, "",
    ...linesOf(c).map((l) => `**${t(l.at)} ${l.role === "event" ? "Dayspring (on its own)" : whoOf(l.role)}:** ${l.text}`), "",
  ])].join("\n");
}
export function days() { return readdirSync(DIR).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(".jsonl", "")).sort().reverse(); }
