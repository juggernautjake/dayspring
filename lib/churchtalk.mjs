// Church conversations: getting ready before a service, talking it through after, and preparing lessons.
//   Before (Sunday ~8–9:45 a.m., Wednesday ~4:30–6:30 p.m.): "Can I help you get ready for worship? This morning is
//     Acts 2." Yes → it reads the passage in parts, points out a few things, and asks what stands out.
//   After (Sunday afternoon, Wednesday night after church): "Want to talk through John 3?" A few questions, and the owner's
//     answers are kept as study notes (data/church.json → notes) so they can ask about them later.
//   Anytime: "help me get ready for Wednesday", "let's review Sunday's lesson", "we're in Acts 3 now",
//     "what did we talk about on Acts 2", "help me prepare a lesson on John 15".
// Offline it reads, notices repeated words and asks good questions; with Claude it adds real observations and discussion
// (contextFor() tells Claude what's going on).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as church from "./church.mjs";
import * as bible from "./bible.mjs";
import * as files from "./files.mjs";
import * as owner from "./owner.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "churchtalk.json");
let db = null;
function load() { if (!db) db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { offered: {}, notes: [] }; return db; }
function save() { writeFileSync(FILE, JSON.stringify(load(), null, 2)); }
let active = null;     // { kind: "prep" | "recap", passage, verses, part, q, at, offered }
const PART = 10;
const RECAP_Q = [
  "What would you say was the main point of {p}?",
  "Was there a verse or a phrase that stuck with you?",
  "Did anything in it challenge you, or raise a question?",
  "How could you put it into practice this week?",
];
const PREP_Q = ["What stands out to you so far?", "Anything in there you'd like to understand better before class?"];
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Which passage a service is on: the bulletin's speaker for that date, else the study's next chapter.
export function passageFor(date, when = "next") {
  const dow = DOW[new Date(date + "T12:00:00").getDay()];
  const info = church.info(), st = info.studies[dow === "sun" || dow === "wed" || dow === "mon" ? dow : "sun"];
  const sp = church.latest()?.speakers?.find((s) => s.date === date);
  if (sp) return { passage: sp.passage, who: sp.who, day: dow };
  if (!st?.book) return null;
  return { passage: `${st.book} ${when === "next" ? (st.chapter ?? 0) + 1 : st.chapter ?? 1}`, day: dow };
}

// Should Dayspring offer now? Returns { kind, text, passage } once per service per kind.
export function offerNow(now = new Date()) {
  const date = now.toLocaleDateString("en-CA"), dow = DOW[now.getDay()], m = now.getHours() * 60 + now.getMinutes();
  const d = load();
  const pick = (kind) => { const key = `${date}|${kind}`; if (d.offered[key]) return null; return key; };
  let kind = null;
  if ((dow === "sun" && m >= 8 * 60 && m <= 9 * 60 + 45) || (dow === "wed" && m >= 16 * 60 + 30 && m <= 18 * 60 + 30)) kind = "prep";
  else if ((dow === "sun" && m >= 13 * 60 + 30 && m <= 17 * 60) || (dow === "wed" && m >= 20 * 60 + 35 && m <= 21 * 60 + 15)) kind = "recap";
  if (!kind) return null;
  const key = pick(kind);
  if (!key) return null;
  const p = passageFor(date, kind === "prep" ? "next" : "current");
  if (!p) return null;
  if (kind === "recap") { const st = church.studies()[dow]; if (st?.book && p.passage.startsWith(st.book)) church.setStudy(dow, { chapter: Number(p.passage.split(" ").pop()) || st.chapter, asOf: date }); }
  d.offered[key] = true; save();
  active = { kind, passage: p.passage, offered: true, at: Date.now(), part: 0, q: 0 };
  const when = dow === "sun" ? (kind === "prep" ? "this morning" : "this morning's lesson") : kind === "prep" ? "tonight" : "tonight's study";
  const text = kind === "prep"
    ? `Hey, can I help you get your mind ready for worship? ${when === "this morning" ? "This morning" : "Tonight"} is ${p.passage}${p.who ? " with " + p.who : ""}. Want me to read it and point out a few things?`
    : `Want to talk through ${when}, ${p.passage}, for a few minutes? It helps it stick.`;
  return { kind, text, passage: p.passage };
}

// Start one on request: "help me get ready for Sunday", "let's review Wednesday's lesson".
export async function start(kind, dayWord) {
  const now = new Date(); let date = now.toLocaleDateString("en-CA");
  const want = /sun/.test(dayWord ?? "") ? 0 : /wed/.test(dayWord ?? "") ? 3 : /mon|young/.test(dayWord ?? "") ? 1 : null;
  if (want !== null) { const diff = kind === "prep" ? (want - now.getDay() + 7) % 7 : -((now.getDay() - want + 7) % 7); const t = new Date(now); t.setDate(t.getDate() + diff); date = t.toLocaleDateString("en-CA"); }
  const p = passageFor(date, kind === "prep" ? "next" : "current");
  if (!p) return { reply: "I'm not sure what passage that is yet. Tell me, like \"we're in Acts 3\", and I'll keep track." };
  active = { kind, passage: p.passage, at: Date.now(), part: 0, q: 0, offered: false };
  return kind === "prep" ? readNext() : { reply: `Okay, ${p.passage}. ${RECAP_Q[0].replace("{p}", "it")}`, open: true };
}

async function readNext() {
  const a = active;
  if (!a.verses) { try { a.verses = (await bible.passage(a.passage)).verses; } catch { a.verses = []; } }
  if (!a.verses.length) { active = null; return { reply: `I couldn't pull up ${a.passage} right now, sorry.` }; }
  const part = a.verses.slice(a.part * PART, (a.part + 1) * PART);
  a.part++;
  const more = a.part * PART < a.verses.length;
  const intro = a.part === 1 ? `${a.passage}, from the King James. ` : "";
  if (more) return { reply: `${intro}${part.map((v) => v.text).join(" ")} … Want me to keep going?`, open: true, speed: 0.92 };
  a.stage = "notice";
  return { reply: `${intro}${part.map((v) => v.text).join(" ")} … ${notice(a)} ${PREP_Q[0]}`, open: true, speed: 0.92 };
}
// Offline observations: the words the passage keeps coming back to.
function notice(a) {
  const STOP = new Set("the and of to in that for is was with his he him them they unto shall not but which be are this all by as have from your you ye it their were who what when we our us thee thou thy hath had there these those so an or at on my me i will if then shall upon also even into out may no one things been being more than now let do did doth".split(" "));
  const counts = {};
  for (const v of a.verses) for (const w of v.text.toLowerCase().match(/[a-z']+/g) ?? []) if (w.length > 3 && !STOP.has(w)) counts[w] = (counts[w] ?? 0) + 1;
  const top = Object.entries(counts).sort((x, y) => y[1] - x[1]).filter(([, n]) => n >= 2).slice(0, 3).map(([w]) => w);
  return top.length ? `A few words keep coming up: ${top.join(", ")}. Watch for those in the lesson.` : "It's a short one, so try to catch every phrase.";
}

// The owner's replies while one is going. Returns { reply, open } or null (not ours).
export async function handle(text, { claude = false } = {}) {
  const a = active;
  if (!a || Date.now() - a.at > 45 * 60_000) { active = null; return null; }
  a.at = Date.now();
  const t = String(text).toLowerCase();
  if (/^(no|nah|not now|maybe later|no thanks|i'?m good|we'?re good|that'?s (enough|all|good)|stop|let'?s stop|done)\b/.test(t)) {
    const r = a.kind === "recap" && a.q > 0 ? `Good talk. I saved your notes on ${a.passage}.` : "No problem.";
    active = null; return { reply: r };
  }
  if (a.offered && a.part === 0 && a.q === 0 && /\b(yes|yeah|sure|ok(ay)?|please|go ahead|let'?s|sounds good|yep)\b/.test(t)) {
    a.offered = false;
    if (a.kind === "prep") return readNext();
    return { reply: RECAP_Q[0].replace("{p}", a.passage), open: true };
  }
  if (a.kind === "prep" && a.part > 0 && a.stage !== "notice" && /\b(keep going|go on|continue|yes|yeah|more|the rest|next)\b/.test(t)) return readNext();
  if (claude) return null;           // with an AI, the conversation itself goes to the model (with contextFor below)
  // offline: keep the notes and ask the next question
  if (a.kind === "recap" || a.stage === "notice") {
    const q = a.kind === "recap" ? RECAP_Q[a.q] : PREP_Q[Math.min(a.q, PREP_Q.length - 1)];
    note(a.passage, a.kind, q?.replace("{p}", a.passage) ?? "", text);
    a.q++;
    const list = a.kind === "recap" ? RECAP_Q : PREP_Q;
    if (a.q < list.length) return { reply: `${pickAck()} ${list[a.q].replace("{p}", a.passage)}`, open: true };
    active = null;
    return { reply: a.kind === "recap" ? `That's really good. I saved your thoughts on ${a.passage}, so we can come back to them.` : `Good. Hold onto that going into ${a.passage}. Enjoy worship!` };
  }
  return null;
}
const pickAck = () => ["That's a good thought.", "Mm, I like that.", "Good point.", "That's worth holding onto.", "Yeah, that's it."][Math.floor(Math.random() * 5)];
function note(passage, kind, q, a) { const d = load(); d.notes.push({ at: new Date().toISOString(), passage, kind, q, a: String(a) }); save(); }
export function notesFor(passage) { const n = String(passage).toLowerCase(); return load().notes.filter((x) => x.passage.toLowerCase().includes(n)); }
export const isActive = () => Boolean(active && Date.now() - active.at < 45 * 60_000);
// for Claude's system prompt while one is going
export function contextFor() {
  if (!isActive()) return "";
  const a = active, st = church.studies();
  return `\n\n## Church conversation in progress\nKind: ${a.kind === "prep" ? `helping ${owner.name()} prepare ${owner.their()} heart and mind for worship on` : `talking through the lesson ${owner.name()} just heard on`} ${a.passage}. ${cap(owner.their())} church studies verse by verse, chapter by chapter (${Object.entries(st).map(([d, x]) => `${DAY_NAMES[d] ?? d}: ${x?.book ?? "undecided"}`).join("; ") || "no studies on file"}). `
    + (a.kind === "prep" ? "Point out 2–4 things worth noticing (context, key words, structure, connections to the rest of Scripture), then ask what stands out. Keep it warm and short enough to listen to." : `Ask one question at a time about what ${owner.name()} learned; reflect back, add a helpful insight or cross-reference, and help it stick. Keep ${owner.their()} answers in mind.`)
    + " Quote Scripture exactly (use get_scripture).";
}

// "Help me prepare a lesson on John 15": a lesson file in the owner's notes folder. Offline it's a scaffold with the text;
// with an AI, draft(…) is filled in by the model before it's written.
const DAY_NAMES = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export async function lessonScaffold(passageText, { audience = "", draft = null } = {}) {
  let p = null; try { p = await bible.passage(passageText); } catch { /* not a passage: a topic */ }
  const title = p ? p.reference : passageText;
  const today = new Date().toLocaleDateString("en-CA");
  const md = [`# Lesson: ${title}`, `_${today}${audience ? " · for " + audience : ""} · drafted with Dayspring_`, "",
    p ? `## The text (KJV)\n\n${p.verses.map((v) => `**${v.n}** ${v.text}`).join("  \n")}` : "", "",
    draft ?? [`## Context`, `- Who wrote it, to whom, and why?`, `- What comes right before and after?`, "", `## Outline`, `1. `, `2. `, `3. `, "",
      `## Key words and phrases`, `- `, "", `## Cross-references`, `- `, "", `## Discussion questions`,
      `1. What does this passage tell us about God?`, `2. What does it tell us about people, and about us?`, `3. What is it asking us to believe, or to do?`, `4. Where does this show up in the rest of Scripture?`, `5. What's one way to live this out this week?`, "",
      `## Application`, `- `, "", `## Closing thought / prayer`, ``].join("\n")].join("\n");
  const r = await files.writeNote(`Lesson — ${title.replace(/:/g, "_")} (${today})`, md);
  return { file: r.written, title };
}
