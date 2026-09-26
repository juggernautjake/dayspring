// Dayspring as its own helper: answers "how do I …?" from the guide in docs/ (and docs/dev/ for developers).
//   find(question)  → the best guide section: { slug, anchor, page, title, url, steps, say, score, alternatives }
//   handle(text)    → the no-AI answer for "how do I snooze?" / "how do I connect Spotify?": opens that section of the
//                     guide on the Dayspring screen (a "help" live update) and returns the first steps to say aloud
//   TOOLS / runTool → help_guide, so an AI brain can look things up in the guide and show it on the screen
// The index is rebuilt when a doc changes (it checks the files' times at most every 10 seconds).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { broadcast } from "./bus.mjs";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const DEV = join(DOCS, "dev");
const SLUG = /^[a-z0-9-]+$/;

// the same anchors GitHub and the in-app guide (public/help.js) make
export const anchor = (t) => String(t).toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
const plain = (md) => md.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/<(?!\/?(?:a|b|i|br|p|kbd|code|span|div|img|sub|sup|details|summary)\b)([a-z][\w ]*)>/gi, "$1").replace(/<[^>]+>/g, " ").replace(/\*\*|__/g, "").replace(/[*_>#|]/g, " ").replace(/\s+/g, " ").trim();

const STOP = new Set(("a an and are be can could do does dayspring did for from get give go have help how i i'm im in into is it its it's me mine my of on or " +
  "please set show so tell that the their them then there this to up use using want way what when where which will with would you your yours " +
  "walk through guide tutorial steps step instructions explain work works working make sure change switch choose pick fix let find").split(" "));
// everyday words → the words the guide uses
const SYNONYMS = {
  tv: ["screen", "display"], television: ["screen", "display"], monitor: ["screen", "display"], display: ["screen"],
  text: ["phone", "texts"], texts: ["phone"], sms: ["phone", "texts"], iphone: ["phone"], android: ["phone"],
  alarm: ["wake", "snooze"], wake: ["alarm"], remind: ["reminders"], reminder: ["reminders"],
  brain: ["ai"], chatgpt: ["openai", "chatgpt"], gpt: ["chatgpt", "openai"], claude: ["anthropic", "claude"], grok: ["xai"], key: ["api", "key"],
  speaker: ["sound", "speakers"], speakers: ["sound"], headset: ["sound", "headset"], headphones: ["sound", "headset"], earbuds: ["sound", "headset"],
  mic: ["microphone"], microphone: ["mic"], volume: ["sound", "volume"], loud: ["volume"], quiet: ["volume"],
  cut: ["overscan", "fit"], edges: ["overscan", "fit"], cropped: ["overscan", "fit"], big: ["size"], small: ["size"], bigger: ["size"], smaller: ["size"],
  background: ["sky"], weather: ["sky", "weather"], wallpaper: ["sky"], scenery: ["sky"],
  email: ["gmail", "outlook", "mail"], mail: ["gmail", "outlook"], gmail: ["google"], outlook: ["microsoft"], todo: ["to", "do", "todoist"],
  song: ["music"], songs: ["music"], playlist: ["music", "playlists"], ads: ["youtube", "premium"],
  file: ["files"], folder: ["files", "folders"], app: ["programs"], apps: ["programs", "connecting"], program: ["programs"],
  website: ["browser", "websites"], internet: ["online", "web"], search: ["online", "search"],
  repeat: ["repeating"], recurring: ["repeating"], weekly: ["repeating"], daily: ["repeating"], event: ["item", "adding"], appointment: ["item", "adding"],
  delete: ["deleting", "remove"], remove: ["deleting", "uninstall"], uninstall: ["uninstalling"], update: ["updating", "updates"], lantern: ["lantern"], course: ["lantern", "learning"], courses: ["lantern", "learning"], upgrade: ["updating"],
  install: ["installing", "installer"], setup: ["setup", "wizard"], restart: ["start", "over"], sleep: ["awake"], lock: ["awake"],
  bible: ["faith"], prayer: ["faith", "prayer"], church: ["faith"], verse: ["memory", "verses"], scripture: ["memory", "verses"],
  study: ["course", "study"], course: ["study"], lesson: ["study"], discord: ["discord", "bot"], call: ["calls", "tune"], calls: ["tune"], zoom: ["calls"], teams: ["calls"],
  voice: ["voices"], accent: ["voices"], natural: ["voices", "edge"], elevenlabs: ["voices"], private: ["privacy"], data: ["privacy", "data"], backup: ["back", "moving"],
  smart: ["home", "assistant"], lights: ["home", "assistant"], thermostat: ["home", "assistant"], news: ["news", "rss"], interests: ["discover"], hobbies: ["discover", "interests"],
  hide: ["window", "bar"], minimize: ["window", "bar"], close: ["window", "bar"], maximize: ["window", "bar"],
  developer: ["dev"], code: ["code", "architecture"], contribute: ["contributing", "extending"], extend: ["extending"], api: ["api"],
};
// a tiny stemmer, so texts/text, voices/voice and updating/updates/update meet
const stem = (w) => w.replace(/'s$/, "").replace(/ies$/, "y").replace(/(?<=\w{3}[^s])s$/, "").replace(/(?<=\w{3})(ing|ed)$/, "").replace(/(?<=\w{2})e$/, "");
const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);
const keyWords = (q) => [...new Set(words(q).filter((w) => !STOP.has(w)))];

// ---- the index ----------------------------------------------------------------------------------------------------
let IDX = null, stamp = "", checked = 0;
function docFiles() {
  const out = [];
  const add = (dir, prefix) => { if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".md") && SLUG.test(f.slice(0, -3))) out.push({ file: join(dir, f), slug: prefix + f.slice(0, -3) }); };
  add(DOCS, ""); add(DEV, "dev-");
  return out;
}
function resolveLink(href, fromSlug) {
  const m = /^(?:(.*)\/)?([a-z0-9-]+)\.md(?:#([\w-]+))?$/i.exec(href);
  if (!m || /^https?:/i.test(href)) return null;
  const dir = m[1] ?? "", fromDev = fromSlug.startsWith("dev-");
  const dev = /(^|\/)dev$/.test(dir) || (fromDev && !dir);
  return { slug: (dev ? "dev-" : "") + m[2].toLowerCase(), anchor: m[3] ?? "" };
}
function build() {
  const files = docFiles();
  const st = files.map((f) => `${f.slug}:${statSync(f.file).mtimeMs}`).join("|");
  if (IDX && st === stamp) return IDX;
  const sections = [], tasks = [];
  for (const { file, slug } of files) {
    const md = readFileSync(file, "utf8").replace(/\r/g, "");
    const page = /^#\s+(.+)$/m.exec(md)?.[1].trim() ?? slug;
    let sec = { slug, page, anchor: "", title: page, level: 1, body: [] };
    const flush = () => { sections.push({ ...sec, body: sec.body.join("\n") }); };
    let fence = false;
    for (const line of md.split("\n")) {
      if (/^\s*```/.test(line)) fence = !fence;
      const h = !fence && /^(#{2,3})\s+(.*?)\s*#*\s*$/.exec(line);
      if (!fence && /^#s/.test(line)) continue;                        // the page title
      if (h) { flush(); sec = { slug, page, anchor: anchor(h[2]), title: h[2].replace(/[*`]/g, ""), level: h[1].length, parent: h[1].length === 3 ? sections.at(-1)?.title : undefined, body: [] }; continue; }
      sec.body.push(line);
      // the tutorials hub and the FAQ point at the right section: "- **Snooze the alarm** → [Your schedule](schedule.md#snooze)"
      if (slug === "tutorials") {
        const t = /^\s*-\s+\*\*(.+?)\*\*\s*→\s*\[[^\]]*\]\(([^)]+)\)/.exec(line);
        const to = t && resolveLink(t[2], slug);
        if (to) tasks.push({ task: t[1], ...to });
      }
    }
    flush();
  }
  for (const s of sections) {
    s.text = plain(s.body);
    s.titleWords = new Set(words(`${s.title} ${s.parent ?? ""}`).map(stem));
    s.pageWords = new Set(words(s.page).map(stem));
    s.bodyWords = words(s.text).map(stem);
  }
  for (const t of tasks) t.words = new Set(words(t.task).filter((w) => !STOP.has(w)).map(stem));
  IDX = { sections, tasks }; stamp = st;
  return IDX;
}
function index() {
  if (!IDX || Date.now() - checked > 10_000) { checked = Date.now(); build(); }
  return IDX;
}

// ---- finding ------------------------------------------------------------------------------------------------------
const sectionOf = (slug, a) => index().sections.find((s) => s.slug === slug && s.anchor === (a ?? ""));
const url = (s) => `/help?embed=1#${s.slug}${s.anchor ? "/" + s.anchor : ""}`;

// The first useful lines of a section, ready to say: its numbered steps (up to 4), or its first sentences.
export function stepsOf(s, max = 4) {
  const lines = s.body.split("\n");
  const steps = [];
  for (const l of lines) {
    const m = /^\s{0,3}(?:\d+[.)]|[-*+])\s+(.*)$/.exec(l);
    if (m) { const t = plain(m[1]); if (t) steps.push(t); if (steps.length >= max) break; }
    else if (steps.length && l.trim() && !/^\s/.test(l)) break;     // the list ended
  }
  if (steps.length >= 2 || (steps.length && !lines.some((l) => /^[A-Za-z]/.test(l)))) return Object.assign(steps, { listed: true });
  const para = plain(lines.filter((l) => l.trim() && !/^\s*(\||```|>|!\[)/.test(l)).slice(0, 4).join(" "));
  const sentences = para.match(/[^.!?]+[.!?]+/g) ?? (para ? [para] : []);
  return sentences.slice(0, 2).map((x) => x.trim()).concat(steps.slice(0, 1)).filter(Boolean);
}

function expand(q) {
  const base = keyWords(q);
  const out = new Map();                       // stemmed word → weight (1 = said, 0.6 = a synonym)
  for (const w of base) {
    out.set(stem(w), Math.max(out.get(stem(w)) ?? 0, 1));
    for (const s of SYNONYMS[w] ?? SYNONYMS[stem(w)] ?? []) if (!out.has(stem(s))) out.set(stem(s), 0.6);
  }
  return { said: base.map(stem), all: out };
}
function scoreSection(s, ex) {
  let score = 0, hit = 0, titled = 0;
  for (const [w, wt] of ex.all) {
    const inT = s.titleWords.has(w), inP = s.pageWords.has(w), n = s.bodyWords.filter((b) => b === w).length;
    if (!inT && !inP && !n) continue;
    if (wt === 1) hit++;
    if (inT) titled++;
    score += wt * ((inT ? 7 : 0) + (inP ? 3 : 0) + Math.min(n, 4));
  }
  const cover = ex.said.length ? hit / ex.said.length : 0;
  if (["faq", "tutorials", "settings-reference"].includes(s.slug)) score *= 0.7;     // prefer the real walkthrough
  if (s.slug.startsWith("dev-") || s.slug === "publishing-releases") score *= ex.all.has("dev") || ex.all.has("code") || ex.all.has("api") || ex.all.has("contribut") ? 1.1 : 0.35;
  if (s.level === 1) score *= 0.8;
  return { score: score * (0.4 + cover), cover, titled };
}
function scoreTask(t, ex) {
  let score = 0, hit = 0;
  let got = 0;
  for (const [w, wt] of ex.all) if (t.words.has(w)) { score += 16 * wt; got++; if (wt === 1) hit++; }
  const cover = ex.said.length ? hit / ex.said.length : 0, precise = t.words.size ? Math.min(1, got / t.words.size) : 0;
  return { score: score * (0.4 + cover) * (0.7 + 0.3 * precise), cover, titled: hit };
}

// → null when nothing in the guide is a good match
export function find(question, { min = 6 } = {}) {
  const ex = expand(question);
  if (!ex.said.length) return null;
  const { sections, tasks } = index();
  const cands = [];
  for (const s of sections) { const r = scoreSection(s, ex); if (r.score > 0) cands.push({ s, ...r }); }
  for (const t of tasks) {
    const r = scoreTask(t, ex); if (!r.score) continue;
    const s = sectionOf(t.slug, t.anchor) ?? sectionOf(t.slug, "");
    if (s) cands.push({ s, ...r, score: r.score * 1.2, task: t.task });
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best || best.score < min || !best.titled || best.cover < 0.5) return null;
  const seen = new Set([best.s.slug + "#" + best.s.anchor]), alternatives = [];
  for (const c of cands.slice(1)) {
    const k = c.s.slug + "#" + c.s.anchor; if (seen.has(k)) continue; seen.add(k);
    alternatives.push({ page: c.s.page, title: c.s.title, url: url(c.s) }); if (alternatives.length >= 3) break;
  }
  const s = best.s, steps = stepsOf(s);
  return { slug: s.slug, anchor: s.anchor, page: s.page, title: s.title, url: url(s), steps, score: Math.round(best.score * 10) / 10, task: best.task, alternatives, say: sayOf(s, steps) };
}
function sayOf(s, steps) {
  const where = s.title === s.page ? `the ${s.page} page` : `"${s.title}" in ${s.page}`;
  const said = steps.map((x) => x.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim()).map((x, i) => (steps.listed && steps.length > 1 ? `${i + 1}. ` : "") + x.replace(/\s*→\s*/g, ", then ").replace(/[→↗✓✕]/g, "")).join(" ");
  const short = said.length > 420 ? said.slice(0, said.lastIndexOf(" ", 400)) + "…" : said;
  return `Here's ${where}. ${short}${short ? " " : ""}It's open on the screen if you want the rest.`.replace(/\s+/g, " ").trim();
}

// ---- no AI needed -------------------------------------------------------------------------------------------------
const ASK = /^(?:how (?:do|can|should|would) (?:i|we|you)|how to|where do i|where can i|what's the way to|show me how (?:do i |to )?|can you show me how to|teach me (?:how )?to|walk me through(?: how to)?|help me(?: to)?|i need help(?: with)?|is there a (?:guide|tutorial) (?:for|on|about)|open the (?:guide|help|tutorial|instructions) (?:for|on|about))\s+(.+?)$/i;
const SETTING = /^what (?:does|do) (?:the )?(.+?) (?:setting|settings|option|switch|toggle|button) do$/i;
export function question(text) {
  const t = String(text).trim().replace(/^(?:(?:hey|ok|okay)\s+)?(?:dayspring[,\s]+)?/i, "").replace(/[.!?]+$/, "").trim();
  const m = ASK.exec(t) ?? SETTING.exec(t);
  return m ? m[1].trim() : null;
}
// "how do I snooze?" → { reply, url }; null when it isn't a how-to about Dayspring
export function answer(text) {
  const q = question(text);
  if (!q) return null;
  const hit = find(q, { min: 8 });
  return hit ? { reply: hit.say, url: hit.url, hit } : null;
}
export function handle(text) {
  const a = answer(text);
  if (!a) return null;
  open(a.url, a.hit.title);
  return a.reply;
}
export function open(u, title = "") {
  try { broadcast("help", { url: u, title }); } catch { /* no screen: fine */ }
}

// ---- for the assistant --------------------------------------------------------------------------------------------
export const TOOLS = [{
  name: "help_guide",
  description: "Look something up in Dayspring's own guide (install, setup, every feature, settings, troubleshooting, FAQ, and developer docs). " +
    "Use it whenever the owner asks how to do something in Dayspring, what a setting does, or why something isn't working. " +
    "It returns the best section with its steps and can open that section on the Dayspring screen. Give the steps in plain words; don't read out URLs.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string", description: "What they want to do or know, e.g. 'snooze the alarm', 'connect spotify', 'screen is cut off on my TV'" },
      open: { type: "boolean", description: "Show the section on the Dayspring screen (default true)" },
    },
    required: ["question"],
  },
}];
export async function runTool(name, input = {}) {
  if (name !== "help_guide") return undefined;
  const hit = find(String(input.question ?? ""), { min: 3 });
  if (!hit) return { found: false, tip: "Nothing in the guide matches. Offer to open the guide's search, or answer from what you know about Dayspring." };
  const s = sectionOf(hit.slug, hit.anchor);
  if (input.open !== false) open(hit.url, hit.title);
  return { found: true, page: hit.page, section: hit.title, opened: input.open !== false, steps: hit.steps, text: s?.text.slice(0, 1800) ?? "", more: hit.alternatives.map((a) => `${a.page}: ${a.title}`) };
}
