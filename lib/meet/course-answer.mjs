// A course question asked in a meeting, answered from the course itself: which lessons teach it (Lantern's own search
// when it offers one, else the local index of the installed pack), an answer grounded in those lessons, and links to them.
//
//   const hits = await retrieve("how do I stop SQL injection", { course: "cfml" })
//     → { course: { id, title }, source: "lantern" | "local", hits: [{ id, title, n, unit: { n, title }, score }] }
//   const a = await answer({ question, course, hits, as: "dayspring" | "lantern", onSpoken })
//     → { spoken, detail, citations: [{ lessonId, title, unit, n, label, publicUrl }], offline, model }
//   onSpoken(text) is called as soon as the spoken part exists (the detail is still being written).
//
// Citations can only be lessons that were retrieved (anything else the AI names is dropped).
import * as llm from "../llm.mjs";
import * as ci from "./course-index.mjs";
import * as settings from "./settings.mjs";

let deps = {
  lanternCall: async (path, opts) => { const { ecoApi } = await import("../lantern.mjs"); const eco = ecoApi(); return eco ? eco.call("lantern", path, opts) : { ok: false, status: 0 }; },
  stream: async function* (o) { const { streamText } = await import("../calls/stream-llm.mjs"); yield* streamText(o); },
  fastModel: async () => { const { fastModel } = await import("../calls/stream-llm.mjs"); return fastModel(); },
  aiReady: () => llm.ready(),
};
export function setDeps(d) { deps = { ...deps, ...d }; }

// Which course answers course questions: the chosen one, else the first installed.
export function courseId() {
  const want = settings.get().course;
  if (want && ci.packPath(want)) return want;
  return ci.installedCourses()[0] ?? null;
}

// A link shown on the screen and posted in the meeting chat: https only (never javascript: or a local file)
const httpsOnly = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null);

// ---- finding the lessons -------------------------------------------------------------------------------------------------
export async function retrieve(question, { course = courseId(), k = 3 } = {}) {
  if (!course) return { course: null, source: null, hits: [] };
  const ix = await ci.load(course).catch(() => null);
  const courseInfo = ix?.course ?? { id: course, title: course };
  // Lantern's own search first (it knows the course best), for a second and a half at most
  try {
    const r = await deps.lanternCall(`/api/local/search?course=${encodeURIComponent(course)}&q=${encodeURIComponent(question)}&k=${k}`, { timeoutMs: 1500 });
    const list = r?.ok && Array.isArray(r.data?.results) ? r.data.results : null;
    if (list?.length) {
      const hits = list.slice(0, k).map((x) => {
        const id = String(x.lessonId ?? x.id ?? "");
        const local = ix?.lesson(id);
        return { id, title: x.title ?? local?.title ?? id, n: x.lesson ?? local?.n ?? null, unit: x.unit && typeof x.unit === "object" ? x.unit : local?.unit ?? { n: x.unit ?? null, title: x.unitTitle ?? "" }, score: Number(x.score) || 0, snippet: x.snippet ?? null, publicUrl: httpsOnly(x.publicUrl), localUrl: x.localUrl ?? null };
      }).filter((h) => h.id);
      if (hits.length) return { course: courseInfo, source: "lantern", hits };
    }
  } catch { /* Lantern isn't running or has no search: the local index */ }
  if (!ix) return { course: courseInfo, source: null, hits: [] };
  const hits = ix.search(question, k, { synonyms: settings.get().courses?.[course]?.synonyms ?? null });
  return { course: courseInfo, source: "local", hits };
}

// Is this a question about the course (rather than "what's the weather")? The course's own words, or a strong match.
// (one of the course's own code words or a mention of the course, with a real match; or a strong match on its own;
// asked of Lantern, the learning app, a moderate match is enough)
export async function isCourseQuestion(question, { course = courseId(), assistant = null } = {}) {
  if (!course) return false;
  const ix = await ci.load(course).catch(() => null);
  if (!ix) return false;
  const sig = ix.signature();
  const hitsSig = ci.tokens(question).some((w) => sig.has(w));
  const mentions = /\b(course|lesson|module|unit)\b/i.test(question);
  const top = ix.top(question);
  return (hitsSig || mentions) && top >= 5 || top >= 20 || assistant === "lantern" && top >= 16;
}

// ---- links -----------------------------------------------------------------------------------------------------------------
export const unitLabel = (h) => `Unit ${h.unit?.n ?? "?"}, Lesson ${h.n ?? "?"}`;
export function citation(course, h) {
  return { course, lessonId: h.id, title: h.title, unit: h.unit ?? null, n: h.n ?? null, label: unitLabel(h), publicUrl: h.publicUrl || settings.publicLessonUrl(course, h.id), localUrl: h.localUrl ?? null };
}

// ---- the answer ------------------------------------------------------------------------------------------------------------
const PERSONA = {
  dayspring: (course) => `You are Dayspring, a friendly, warm assistant taking part in a live video meeting. Someone in the meeting asked a question about the course "${course}".`,
  lantern: (course) => `You are Lantern, a warm and wise learning companion (a glowing lantern that lights the way for learners), taking part in a live video meeting. Someone asked you a question about your course "${course}". You speak with gentle, encouraging wisdom, never stiff.`,
};
function context(ix, hits) {
  return hits.map((h) => {
    const l = ix?.lesson(h.id);
    const text = (l?.text ?? h.snippet ?? "").replace(/\s+/g, " ").slice(0, 1800);
    const code = (l?.code ?? "").replace(/\s+\n/g, "\n").slice(0, 600);
    return [`[${h.id}] ${unitLabel(h)}: ${h.title}${h.unit?.title ? ` (unit: ${h.unit.title})` : ""}`,
      l?.objectives?.length ? `Objectives: ${l.objectives.join("; ")}` : "",
      l?.takeaways?.length ? `Takeaways: ${l.takeaways.join(" ")}` : "",
      text ? `Lesson text: ${text}` : "", code ? `Example code:\n${code}` : ""].filter(Boolean).join("\n");
  }).join("\n\n");
}
export function systemFor({ as = "dayspring", courseTitle }) {
  return [PERSONA[as]?.(courseTitle) ?? PERSONA.dayspring(courseTitle),
    "Answer correctly and concretely, grounded in the lessons given. You may add accurate general knowledge, but never contradict the lessons.",
    "Reply in exactly this format:",
    "SPOKEN: one or two short sentences said out loud to the meeting: the direct answer in plain words (no code symbols, no URLs, no lesson numbers).",
    "CITE: the ids (in square brackets above) of the one or two lessons that teach this best, most relevant first, e.g. u4l2",
    "DETAIL: a detailed answer for the meeting chat, 90 to 200 words: what it is, why it matters, and how to do it, with one short code example if it helps (plain text, no markdown headings, no bold). Do not include links or lesson numbers; they are added for you.",
    "Do not greet the person or use their name; that is added for you.",
  ].join("\n");
}

export function parseReply(text, allowed) {
  const t = String(text ?? "");
  const spoken = (/SPOKEN:\s*([\s\S]*?)(?=\n\s*CITE:|\n\s*DETAIL:|$)/i.exec(t)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const citeRaw = /CITE:\s*([^\n]*)/i.exec(t)?.[1] ?? "";
  const detail = (/DETAIL:\s*([\s\S]*)$/i.exec(t)?.[1] ?? "").replace(/\*\*|__|^#+\s*/gm, "").trim();
  const cite = [...new Set((citeRaw.match(/[a-z0-9][\w-]*/gi) ?? []).filter((id) => allowed.includes(id)))].slice(0, 2);
  return { spoken, detail, cite };
}

// Without AI: the best lesson's own words.
export function offlineAnswer(ix, hits) {
  const top = hits[0]; const l = ix?.lesson(top?.id);
  if (!top) return { spoken: "", detail: "", cite: [] };
  const take = l?.takeaways ?? [];
  const spoken = take[0] ?? l?.objectives?.[0] ?? `That's what the lesson ${top.title} is about.`;
  const detail = [`From the lesson "${top.title}":`, ...take.map((x) => `• ${x}`), ...(l?.objectives?.length ? ["You'll learn to: " + l.objectives.join("; ") + "."] : [])].join("\n");
  return { spoken, detail, cite: [top.id] };
}

export async function answer({ question, course = courseId(), hits = null, as = "dayspring", onSpoken = null, signal = null } = {}) {
  const ix = course ? await ci.load(course).catch(() => null) : null;
  const courseTitle = ix?.course?.title ?? course ?? "the course";
  const found = hits ?? (await retrieve(question, { course })).hits;
  if (!found.length) return { spoken: "", detail: "", citations: [], offline: true, none: true };
  const allowed = found.map((h) => h.id);
  let parsed = null, model = null, offline = false, spokenSent = false;
  if (deps.aiReady()) {
    try {
      model = await deps.fastModel();
      const prompt = `Lessons:\n${context(ix, found)}\n\nQuestion: ${question}\nYour reply:`;
      let full = "";
      for await (const piece of deps.stream({ system: systemFor({ as, courseTitle }), prompt, model, maxTokens: 700, timeoutMs: 25_000, signal })) {
        full += piece;
        // the spoken part is ready as soon as CITE: starts: say it while the detail is written
        if (!spokenSent && onSpoken && /\n\s*CITE:/i.test(full)) { const p = parseReply(full, allowed); if (p.spoken) { spokenSent = true; onSpoken(p.spoken); } }
      }
      parsed = parseReply(full, allowed);
      if (!parsed.spoken && !parsed.detail) parsed = null;
    } catch { parsed = null; }
  }
  if (!parsed) { parsed = offlineAnswer(ix, found); offline = true; }
  if (!parsed.cite.length) parsed.cite = [found[0].id];
  const citations = parsed.cite.map((id) => citation(course, found.find((h) => h.id === id)));
  return { spoken: parsed.spoken || parsed.detail.split(/(?<=[.!?])\s+/)[0] || "", detail: parsed.detail || parsed.spoken, citations, offline, model, spokenSent, course: { id: course, title: courseTitle } };
}

// "It's covered in Unit 4, Lesson 2, cfqueryparam, and the day without it, and I've put the link in the chat."
export function whereSpoken(citations, { linkInChat = true } = {}) {
  const c = citations[0]; if (!c) return "";
  const withLink = linkInChat && c.publicUrl;
  return `It's covered in ${c.label}, ${c.title}${withLink ? ", and I've put the link in the chat." : "."}`;
}
export function whereChat(citations) {
  return citations.map((c) => `📘 ${c.label}: ${c.title}${c.publicUrl ? `\n${c.publicUrl}` : ""}`).join("\n");
}
