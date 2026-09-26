// Studying by voice or typing, answered without the AI:
//   "what should I study next?" · "open my Spanish course" · "let's study guitar" · "open the next lesson"
//   "I finished Module 2" · "done with unit 1 lesson 3" · "I finished the unit 2 check" · "I'm done studying" · "mark that done"
//   → Dayspring CHECKS the course's own progress before marking anything done, and says what's missing if it isn't.
//   "mark it done anyway" · "sync my study progress" · "open it" / "yes" right after it offers
import * as study from "./study.mjs";

let pending = null;          // { kind: "open" | "force", course, id, at }
const fresh = () => pending && Date.now() - pending.at < 3 * 60_000;
const short = (t) => String(t ?? "").split(" — ")[0];

// "I finished it": the lesson they last opened in that course if it's still open work, else the next unfinished one
function openTarget(course) {
  const lt = study.lastTarget();
  const items = study.itemsOf(course);
  const opened = lt?.course === course ? items.find((i) => i.id === lt.id && !i.done) : null;
  return opened ?? items.find((i) => !i.done) ?? null;
}
function whichCourse(q) {
  return study.courseFrom(q) || (/\b(module|unit|lesson)\b/.test(q) && study.courses().find((c) => study.itemsFromText(c, q).length)) || null;
}

export async function handle(text) {
  const raw = String(text).trim();
  const q = raw.toLowerCase().replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim();
  // "add a course called Spanish at duolingo.com with 30 lessons" · "add my guitar course"
  {
    const m = /^(?:please )?(?:add|start|track|set up) (?:a |my |the )?(?:new )?(?:course|class)(?: called| named)? (.+?)(?:,? (?:at|on|from) ((?:https?:\/\/)?[\w.-]+\.[a-z]{2,}\S*))?(?:,? with (\d+) (?:lessons|modules|units|chapters|items))?$/i.exec(raw.replace(/[.!?]+$/, ""))
      ?? /^(?:please )?(?:add|track) (?:my |the )?(.+?) (?:course|class)(?:,? (?:at|on|from) ((?:https?:\/\/)?[\w.-]+\.[a-z]{2,}\S*))?(?:,? with (\d+) (?:lessons|modules|units|chapters|items))?$/i.exec(raw.replace(/[.!?]+$/, ""));
    if (m && !/\b(to my schedule|on my calendar|at \d)/i.test(raw)) {
      const title = m[1].replace(/^["“]|["”]$/g, "").trim().replace(/^./, (c) => c.toUpperCase());
      const r = study.addCourse({ title, url: m[2] ?? null, count: Number(m[3]) || 10 });
      return `Added ${title} with ${r.lessons} lessons.${r.url ? " Click it on my screen, or say \"open " + title + "\", and I'll open the next lesson." : " Tell me its web address (\"" + title + " is at …\") and I'll open lessons for you."} You can check lessons off by saying "I finished lesson 1".`;
    }
    // "Spanish is at duolingo.com" — give an existing course its address
    const at = /^(?:my )?(.+?) (?:course |class )?(?:is|lives) (?:at|on) ((?:https?:\/\/)?[\w.-]+\.[a-z]{2,}\S*)$/i.exec(raw.replace(/[.!?]+$/, ""));
    const ck = at ? study.courseFrom(at[1]) : null;
    if (ck) { study.setCourseUrl(ck, at[2]); return `Got it. I'll open ${at[1]} at ${at[2]} from now on.`; }
  }
  if (!study.courses().length) return null;

  // follow-ups to an offer
  if (fresh() && /^(yes|yeah|yep|sure|ok|okay|please|open it|let's do it|lets do it|go ahead|do it|sounds good)( please)?$/.test(q)) {
    const p = pending; pending = null;
    if (p.kind === "open") return (await study.open(p.course, p.id)).say;
    if (p.kind === "force") { await study.finish(p.course, [p.id], { force: true }); return `Okay, marked done. ${study.describeNext(p.course)}`; }
  }
  if (fresh() && /^(no|nope|not now|later|no thanks)$/.test(q)) { pending = null; return "Okay."; }
  if (/\bmark (it|that|this) (as )?(done|complete|finished) anyway\b|\bjust mark it( done)?\b/.test(q)) {
    const t = pending ?? study.lastTarget();
    if (!t?.id) return null;
    pending = null;
    await study.finish(t.course, [t.id], { force: true });
    return `Okay, marked done on your word. ${study.describeNext(t.course)}`;
  }

  const studyWords = /\b(study|studying|lesson|module|unit|course|quiz|exam prep|coursework|homework)\b/;
  const course = whichCourse(q);

  // what's next
  if (/\bwhat('s| is| should)\b.*\b(next|study|learn|work on)\b|\bwhere (am i|was i|did i leave off)\b|\bmy (study )?progress\b/.test(q) && (studyWords.test(q) || course)) {
    const list = course ? [course] : study.courses();
    const lines = list.map((c) => study.describeNext(c));
    const first = list.map((c) => ({ c, n: study.nextItem(c) })).find((x) => x.n);
    if (first) pending = { kind: "open", course: first.c, id: first.n.id, at: Date.now() };
    return `${lines.join(" ")}${first ? " Want me to open it?" : ""}`;
  }

  // open
  if (/\b(open|start|begin|pull up|bring up|let'?s (do|study|work on|start)|take me to|launch)\b/.test(q) && (studyWords.test(q) || course)) {
    const c = course ?? study.courses().find((x) => study.nextItem(x)) ?? study.courses()[0];
    const named = study.itemsFromText(c, q);
    const target = named.find((i) => !i.done) ?? named[0] ?? null;
    return (await study.open(c, target?.id ?? null)).say;
  }

  // finished: check it
  if (/\b(i('m| am)? )?(finished|done( with)?|completed|wrapped up|got through)\b|\bmark (it|that|this) (as )?(done|complete|finished)\b/.test(q)
      // "mark that done" alone is about a schedule block, unless a lesson was opened in the last two hours
      && (studyWords.test(q) || course || (/\bmark (it|that|this)\b|\bdone studying\b/.test(q) && study.lastTarget() && Date.now() - study.lastTarget().at < 2 * 3600_000))) {
    let c = course, ids = [];
    if (c) {
      const named = study.itemsFromText(c, q).filter((i) => !i.done);
      ids = named.map((i) => i.id);
      if (!ids.length && !study.itemsFromText(c, q).length) { const n = openTarget(c)?.id; if (n) ids = [n]; }
      if (!ids.length && study.itemsFromText(c, q).length) return `That's already marked done. ${study.describeNext(c)}`;
    } else {
      c = study.lastTarget()?.course ?? study.courses().find((x) => study.nextItem(x));
      const t = c ? openTarget(c) : null;
      if (!t) return "You're all caught up!";
      ids = [t.id];
    }
    const r = await study.finish(c, ids);
    const ok = r.checked.filter((x) => x.ok), no = r.checked.filter((x) => x.ok === false), unk = r.checked.filter((x) => x.ok === null);
    const title = (id) => short(study.itemsOf(c).find((i) => i.id === id)?.title);
    const next = study.nextItem(c);
    if (ok.length && !no.length && !unk.length) {
      if (next) pending = { kind: "open", course: c, id: next.id, at: Date.now() };
      const lead = ok.every((x) => x.onWord) ? `Checked off: ${ok.map((x) => title(x.id)).join(", ")}.` : `I checked, and it's done: ${ok.map((x) => title(x.id)).join(", ")}${ok[0].detail ? ` (${ok[0].detail})` : ""}.`;
      return `${lead} Nice work!${next ? ` Next up: ${short(next.title)}. Want me to open it?` : " That's the whole course!"}`;
    }
    const parts = [];
    if (ok.length) parts.push(`${ok.map((x) => title(x.id)).join(", ")} checks out`);
    if (no.length) {
      parts.push(`not quite yet: ${no.map((x) => x.missing).join("; ")}`);
      pending = { kind: "open", course: c, id: no[0].id, at: Date.now() };
    }
    if (unk.length) {
      if (unk[0].signedOut) parts.push(`I can't see your progress yet because ${unk[0].missing}. Sign in there once and ask me again, or say "mark it done anyway"`);
      else parts.push(`I can't check ${unk.map((x) => title(x.id)).join(", ")} (${unk[0].missing}). Say "mark it done anyway" if it's done`);
      if (!no.length) pending = { kind: "force", course: c, id: unk[0].id, at: Date.now() };
    }
    const said = `${parts.join(". ")}.${no.length ? " Want me to open it so you can finish?" : ""}`.replace(/\.\./g, ".");
    return said.charAt(0).toUpperCase() + said.slice(1);
  }

  if (/\b(sync|update|refresh) (my )?(study|course|learning) progress\b/.test(q)) {
    if (!study.isOpen()) return "The study window isn't open, so there's nothing new to pull in. Open a lesson and I'll keep up with you.";
    const r = await study.sync();
    const n = Object.values(r).flat().length;
    return n ? `Pulled in ${n} finished item${n > 1 ? "s" : ""}, all checked.` : "Everything's already up to date.";
  }
  if (/\bimport\b.*\b(progress|backup)\b/.test(q) && (studyWords.test(q) || course)) {
    return "In your usual browser, open the course, go to Progress, press Make a backup and copy the text. Then click the course on my screen, choose Bring in progress, and paste it there.";
  }
  return null;
}

// For the AI (any provider): tool definitions and a runner. See the lead's wiring notes.
export const TOOLS = [
  { name: "study_status", description: "The owner's study courses: what's done, what's next, how far behind. Use for 'what should I study', 'how's my progress'.",
    input_schema: { type: "object", properties: { course: { type: "string", description: "course key, optional" } } } },
  { name: "study_open", description: "Open a lesson/module in the study browser window on the owner's main screen so they can start right away. Default: the next unfinished item.",
    input_schema: { type: "object", properties: { course: { type: "string" }, item_id: { type: "string", description: "optional item id from study_status" } }, required: ["course"] } },
  { name: "study_check", description: "The owner says they finished something: CHECK the course's real progress and mark done only what really is. Returns what's missing otherwise. Never mark study items done any other way.",
    input_schema: { type: "object", properties: { course: { type: "string" }, item_ids: { type: "array", items: { type: "string" } }, force: { type: "boolean", description: "only when the owner explicitly says to mark it done anyway" } }, required: ["course"] } },
  { name: "study_add_course", description: "Add a course the owner wants to track (any online course, class or book): its name, optional web address, and its lessons (names) or how many there are. Then 'open my next lesson' and 'I finished lesson 3' work for it.",
    input_schema: { type: "object", properties: { title: { type: "string" }, url: { type: "string" }, lessons: { type: "array", items: { type: "string" } }, count: { type: "integer" } }, required: ["title"] } },
  { name: "study_remove_course", description: "Stop tracking a course (removes it and its checklist). Confirm with the owner first.",
    input_schema: { type: "object", properties: { course: { type: "string" } }, required: ["course"] } },
];
export async function runTool(name, input) {
  if (name === "study_add_course") return study.addCourse(input);
  if (name === "study_remove_course") return { removed: study.removeCourse(input.course) };
  if (name === "study_status") return study.state();
  if (name === "study_open") return study.open(input.course, input.item_id ?? null);
  if (name === "study_check") {
    const ids = input.item_ids?.length ? input.item_ids : [study.lastTarget()?.course === input.course ? study.lastTarget().id : study.nextItem(input.course)?.id].filter(Boolean);
    return study.finish(input.course, ids, { force: Boolean(input.force) });
  }
  return undefined;
}
