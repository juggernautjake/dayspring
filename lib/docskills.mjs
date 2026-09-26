// Documents by voice (no AI needed to open, find or read aloud; summaries and explanations use the AI the owner chose):
//   "open my resume", "read me the lease agreement", "read the bulletin in Downloads", "what's in my budget spreadsheet?"
//   while reading: "pause", "keep going", "stop reading", "go back", "read that again", "next section", "skip to section 3",
//   "go to page 2", "slower", "faster", "pick up where we left off"
//   "summarize it", "give me the gist", "explain this part", "what's this document about?"
// The Dayspring screen shows the document in its reader and speaks it paragraph by paragraph (public/reader.js).
import * as documents from "./documents.mjs";
import * as abilities from "./abilities.mjs";
import * as llm from "./llm.mjs";
import * as owner from "./owner.mjs";
import { broadcast } from "./announcer.mjs";
import * as screenlog from "./screenlog.mjs";
import * as permissions from "./permissions.mjs";

// what's open in the screen's reader (the display reports where it is)
let cur = null;          // { path, title, para, total, playing, at }
let offer = null;        // { path, at } — "want me to read it, or summarize it?"
let choices = null;      // { list, at, intent } — "which one?"
export const current = () => (cur && Date.now() - cur.at < 6 * 3600_000 ? cur : null);
export function report(p = {}) {
  if (!p.path) return;
  cur = { ...(cur?.path === p.path ? cur : {}), path: p.path, title: p.title ?? cur?.title ?? "", para: Number(p.para) || 0, total: Number(p.total) || cur?.total || 0, playing: Boolean(p.playing), at: Date.now() };
  documents.setProgress(p.path, cur.para, { title: cur.title, total: cur.total });
}
// open (and maybe start reading) on the screen
export function show(ev) {
  broadcast("doc", ev);
  // what's open changes right away (the reader's commands may come before the outline below is ready)
  cur = { path: ev.path, title: cur?.path === ev.path ? cur.title : "", para: ev.from ?? documents.progress(ev.path)?.para ?? 0, total: cur?.path === ev.path ? cur.total : 0, playing: ev.action === "read", at: Date.now() };
  documents.outline(ev.path).then((o) => {
    if (cur?.path === ev.path) Object.assign(cur, { title: o.title, total: o.paragraphs });
    screenlog.shown({ kind: "doc", view: "document", title: `${o.title} (${o.type})`, text: o.start.slice(0, 1500) });
  }).catch(() => {});
}
abilities.setDocViewer(show);

const say = (o) => `${o.title}${o.title.toLowerCase() !== o.name.replace(/\.[^.]+$/, "").toLowerCase() ? ` (${o.name})` : ""}: a ${o.type}${o.pages ? `, ${o.pages} ${/presentation/i.test(o.type) ? "slides" : "pages"}` : ""}, about ${o.minutes} minute${o.minutes === 1 ? "" : "s"} to read`;
const DOC_WORDS = /\b(docs?|documents?|files?|pdfs?|word|docx|resume|cv|letter|lease|agreement|contract|report|essay|paper|notes|bulletin|newsletter|presentation|slides|slideshow|deck|spreadsheet|workbook|budget|invoice|receipt|statement|manual|guide|form|policy|syllabus|proposal|outline|handout|worksheet|transcript|minutes|agenda|sermon|lesson|study guide|screenshot|scan|memo|article|chapter|book|story|poem|recipe|itinerary|checklist)\b|\.(docx?|pdf|pptx|xlsx?|csv|txt|md|rtf|odt)\b|\bin (my |the )?(downloads|documents|desktop)\b/;
const needAI = () => "Summaries and explanations need an AI brain (set one up in Settings → AI brain). I can read it to you word for word, though. Want me to?";

async function openIt(path, intent) {
  const o = await documents.outline(path);
  const prog = documents.progress(o.path);
  if (o.note && !o.words) return o.note;
  if (intent === "read") { show({ action: "read", path: o.path, from: 0 }); return `Reading ${o.title}.`; }
  if (intent === "summarize") { show({ action: "open", path: o.path }); return summarize(o.path); }
  show({ action: "open", path: o.path });
  offer = { path: o.path, at: Date.now() };
  const resume = prog && prog.para > 0 && prog.para < o.paragraphs - 1 ? ` Last time you stopped about ${Math.round((prog.para / Math.max(1, o.paragraphs)) * 100)}% of the way through.` : "";
  return `Here's ${say(o)}.${resume}${o.note ? " " + o.note : ""} Want me to read it${llm.ready() ? ", or give you a summary" : ""}?`;
}

async function summarize(path, focus = "") {
  if (!llm.ready()) return needAI();
  const d = await documents.extract(path);
  const ask = focus ? `Focus on: ${focus}. ` : "";
  const system = `You summarize documents for ${owner.name()} out loud. Plain spoken sentences, no markdown, no lists. Use only what's in the document; never add facts. Start straight with the summary (no "here's the summary"). Mention anything that needs action (dates, amounts, deadlines, things to sign).`;
  try {
    if (d.text.length <= 60_000) return await llm.complete({ system, prompt: `${ask}Summarize this ${d.type} titled "${d.title}" in about five to eight sentences:\n\n${d.text}`, maxTokens: 700, timeoutMs: 90_000 });
    // long: summarize each part, then the whole
    const parts = []; let buf = "";
    for (const s of d.sections) { const t = (s.heading ? s.heading + "\n" : "") + s.text; if ((buf + t).length > 40_000 && buf) { parts.push(buf); buf = ""; } buf += t + "\n\n"; }
    if (buf) parts.push(buf);
    const notes = [];
    for (const [i, p] of parts.slice(0, 12).entries()) notes.push(await llm.complete({ system, prompt: `Part ${i + 1} of ${parts.length} of "${d.title}". Summarize this part in three or four sentences:\n\n${p}`, maxTokens: 350, timeoutMs: 90_000 }));
    return await llm.complete({ system, prompt: `${ask}These are summaries of each part of "${d.title}" (${d.type}). Combine them into one summary of about six to eight sentences:\n\n${notes.join("\n\n")}${parts.length > 12 ? "\n\n(The document is very long; only the first twelve parts were summarized.)" : ""}`, maxTokens: 700, timeoutMs: 90_000 });
  } catch (e) { return `I couldn't get a summary just now (${String(e.message).slice(0, 120)}). I can read it to you instead.`; }
}
async function explain(path, para, question = "") {
  if (!llm.ready()) return needAI();
  const r = await documents.read(path, { from: Math.max(0, para - 1), n: 4 });
  const here = r.paras.map((x) => x.text).join("\n\n");
  try {
    return await llm.complete({ system: `You explain documents to ${owner.name()} in plain, friendly spoken words. No markdown. Stick to what the text says; if it's unclear, say so.`,
      prompt: `From "${r.title}" (${r.type}), the part being read now (a short window from a longer document, so don't mention what isn't shown; the first paragraph is the one just read):\n\n${here}\n\n${question ? `Question: ${question}` : "Explain what the paragraph just read means, in two to four sentences."}`, maxTokens: 400, timeoutMs: 60_000 });
  } catch (e) { return `I couldn't explain that just now (${String(e.message).slice(0, 120)}).`; }
}

// the reader's buttons and voice commands, sent to the screen
function control(cmd, extra = {}) { broadcast("doc", { action: "control", cmd, ...extra }); }
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w) => Number(ORD[w] ?? w);

export async function handle(text) {
  const q = String(text).toLowerCase().replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
  const c = current();

  // "which one?" was asked
  if (choices && Date.now() - choices.at < 120_000) {
    const m = /\b(first|second|third|fourth|fifth|one|two|three|four|five|\d)\b/.exec(q);
    let pick = m ? choices.list[num(m[1]) - 1] : choices.list.find((x) => q.split(" ").some((w) => w.length > 2 && x.name.toLowerCase().includes(w)));
    if (/\b(the )?(newest|latest|most recent)\b/.test(q)) pick = [...choices.list].sort((a, b) => b.modified.localeCompare(a.modified))[0];
    if (pick) { const intent = choices.intent; choices = null; return openIt(pick.path, intent); }
    if (/^(never ?mind|neither|none|cancel)\b/.test(q)) { choices = null; return "Okay."; }
  }
  // the offer after opening: "want me to read it, or give you a summary?"
  if (offer && Date.now() - offer.at < 180_000) {
    if (/^(yes|yeah|yep|sure|ok(ay)?|please|go ahead|read it|read it to me|read the whole thing|read it all|from the top|start reading)\b/.test(q) && !/\bsummar/.test(q)) { const p = offer.path; offer = null; show({ action: "read", path: p, from: 0 }); return "Okay, reading it now."; }
    if (/\b(summar|the gist|overview|what'?s it about|tldr|short version)\b/.test(q)) { const p = offer.path; offer = null; return summarize(p); }
    if (/^(no|nope|not now|later|that'?s ok)\b/.test(q)) { offer = null; return "Okay. It's on the screen if you want it."; }
  }
  // while the reader is in use (reading now, or used in the last 10 minutes): its controls. "pause" otherwise belongs to music.
  const active = c && (c.playing || Date.now() - c.at < 10 * 60_000);
  if (c && active) {
    if (/^(stop|stop reading|that'?s enough|close (it|the (document|reader)))\b/.test(q) && (c.playing || /reading|document|reader/.test(q))) { control(/close/.test(q) ? "close" : "stop"); return /close/.test(q) ? "Closed." : "Stopped. Say \"pick up where we left off\" any time."; }
    if (/^(pause|hold on|wait|hang on)( (reading|a (sec|second|minute)))?$/.test(q)) { control("pause"); return "Paused."; }
    if (/^(keep going|continue|resume|go on|carry on|keep reading|unpause|play)$/.test(q)) { control("resume"); return "Okay."; }
    if (/^(read (that|it) again|say (that|it) again|repeat (that|it)|again|what was that)$/.test(q)) { control("again"); return "Okay."; }
    if (/^(go back|back up|previous paragraph|go back a (paragraph|bit))$/.test(q)) { control("back"); return "Okay."; }
    if (/^(skip( ahead| that)?|next paragraph)$/.test(q)) { control("next"); return "Okay."; }
    if (/^(next|skip to the next) (section|part|chapter|slide|page)$/.test(q)) { control("nextSection"); return "Okay."; }
    if (/^(previous|last|go back to the (previous|last)) (section|part|chapter|slide)$/.test(q)) { control("prevSection"); return "Okay."; }
    let m;
    if ((m = /^(?:skip|go|jump|move) to (?:the )?(?:section|part|chapter|slide) (\w+)$/.exec(q)) || (m = /^(?:skip|go|jump) to the (\w+) (?:section|part|chapter)$/.exec(q))) { const n = num(m[1]); if (n) { control("section", { n }); return "Okay."; } }
    if ((m = /^(?:skip|go|jump|turn) to page (\w+)$/.exec(q))) { const n = num(m[1]); if (n) { control("page", { n }); return "Okay."; } }
    if (/^(read )?(slower|slow down( reading)?|a (little|bit) slower)$/.test(q)) { control("slower"); return "Slower."; }
    if (/^(read )?(faster|speed up( reading)?|a (little|bit) faster)$/.test(q)) { control("faster"); return "Faster."; }
    if (/^(read it|read it to me|read the whole thing|read it all|start reading|read it from the (top|beginning)|start over|from the (top|beginning))$/.test(q)) { show({ action: "read", path: c.path, from: /top|beginning|start over/.test(q) ? 0 : c.para }); return /top|beginning|start over/.test(q) ? "From the top." : "Okay, reading."; }
  }
  // about the open document (any time it's open)
  if (c) {
    if (/\b(summar\w*|the gist|give me an overview|tl ?dr)\b/.test(q) && /\b(it|this|that|the (document|doc|file|whole thing)|so far)?\b/.test(q) && !DOC_WORDS.test(q.replace(/\b(the )?(document|doc|file)\b/g, ""))) return summarize(c.path);
    if (/^(what does (that|this) mean|explain (that|this|this part|that part|it)|what'?s (that|this part) saying|i don'?t (get|understand) (that|it))\b/.test(q)) return explain(c.path, c.para);
    if (/^what'?s (this|the) document( about)?$|^what am i reading$/.test(q)) return summarize(c.path, "what it is and what it's for, in two sentences");
  }
  // "pick up where we left off"
  if (/\b(pick up|continue|keep reading|resume)\b.*\b(where (we|i) (left off|stopped)|the (document|book|reading))\b|^where was i$/.test(q)) {
    const last = c ?? documents.lastRead();
    if (!last) return "I don't have anything half-read. Tell me which document.";
    show({ action: "read", path: last.path, from: last.para ?? 0 });
    return `Picking up ${last.title ? `"${last.title}"` : "where you left off"}.`;
  }
  // "open my resume", "read me the lease agreement", "summarize the bulletin in downloads"
  const m = /^(?:can you |could you |please |hey )*(open|read|pull up|bring up|show me|look at|review|go (?:over|through)|summarize|give me (?:a|the) summary of|explain|what'?s in|tell me what'?s in)(?: me)?(?: up)? (.+)$/.exec(q);
  if (m && DOC_WORDS.test(m[2]) && !/\b(text|texts|message|messages|email from|proverb|quote|verse)\b/.test(m[2]) && !/\b(on the screen|website|web ?page|link|video|song|playlist)\b/.test(m[2])) {
    const intent = /^(read|go)/.test(m[1]) ? (/\b(summar|gist)\b/.test(q) ? "summarize" : "read") : /summar|explain|what'?s in|tell me/.test(m[1]) ? "summarize" : "open";
    let r;
    try { r = await documents.find(m[2]); } catch (e) { return e.message; }
    if (!r.best) {
      const p = permissions.get();
      if (p.files === "off") return "I'm not allowed to look at your files yet. You can let me in Settings, under Permissions: everything, or just the folders you pick.";
      if (p.files !== "all") { const where = permissions.roots().map((x) => x.split(/[\\/]/).filter(Boolean).pop()).slice(0, 4).join(", "); return `I couldn't find a document like "${m[2]}" in the places I'm allowed to look (${where}). If it's somewhere else, like Documents or Downloads, you can add that folder in Settings, under Permissions.`; }
      return `I couldn't find a document like "${m[2]}". Tell me a word from its name, or where it is (Downloads, Documents, Desktop).`;
    }
    if (r.ambiguous) {
      choices = { list: r.matches.slice(0, 4), at: Date.now(), intent };
      return `I found a few: ${choices.list.map((x, i) => `${["first", "second", "third", "fourth"][i]}, ${x.name} from ${new Date(x.modified).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`).join("; ")}. Which one?`;
    }
    try { return await openIt(r.best.path, intent); } catch (e) { return e.message; }
  }
  return null;
}
