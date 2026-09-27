// Meetings (lib/meet): Dayspring and Lantern in a Google Meet call.
//   GET  /meet/status                      → the meeting (stage, tile/large, people and who may ask, captions check)
//   POST /meet/join { link }               → open the meeting in Dayspring's meeting window and join it
//   POST /meet/rehearse                    → a pretend meeting (fake people, captions, chat, a scripted question)
//   POST /meet/leave · POST /meet/view { view: "tile" | "large" } · POST /meet/signin
//   POST /meet/control { action: "mute" | "unmute" | "camera" | "captions" | "chat" }
//   POST /meet/permissions { mode } | { name, can: { dayspring, lantern } }
//   POST /meet/demo { on } · POST /meet/settings { announce, routeCourseToLantern, course, publicLessonUrl, rehearsalQuestions }
//   GET  /meet/preflight                   → the demo's pre-flight checklist · POST /meet/confirm { micSet | linkShared | soundTest }
//   POST /meet/ask { question, as }        → try a course question without a meeting (the answer and its lessons)
//   GET  /meet/recent                      → this meeting's answered questions (cleared when it ends)
//   GET  /meet/mock                        → the rehearsal meeting page
// Nothing here changes a device or signs in to anything.
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as host from "./meet/host.mjs";
import * as settings from "./meet/settings.mjs";
import * as preflight from "./meet/preflight.mjs";
import * as courseAnswer from "./meet/course-answer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOCK = join(ROOT, "vendor", "ecosystem-core", "lib", "meet", "mock", "meet-mock.html");

export const command = (text) => host.command(text);

export async function handle(req, res, { m, p, send, readJSON }) {
  if (!p.startsWith("/meet")) return false;
  const body = async () => (m === "POST" ? await readJSON(req).catch(() => ({})) : {});
  if (p === "/meet/status" && m === "GET") return send(res, 200, host.status()), true;
  if (p === "/meet/join" && m === "POST") { const b = await body(); return send(res, 200, await host.join(String(b.link ?? ""))), true; }
  if (p === "/meet/rehearse" && m === "POST") return send(res, 200, await host.rehearse()), true;
  if (p === "/meet/leave" && m === "POST") return send(res, 200, await host.leave()), true;
  if (p === "/meet/signin" && m === "POST") return send(res, 200, await host.openSignIn()), true;
  if (p === "/meet/view" && m === "POST") { const b = await body(); return send(res, 200, b.view === "tile" ? await host.tile() : await host.large()), true; }
  if (p === "/meet/control" && m === "POST") {
    const b = await body();
    const say = { mute: "mute", unmute: "unmute", camera: "turn off my camera", captions: "turn on captions", chat: "open the chat" }[b.action];
    if (!say) return send(res, 400, { error: "unknown action" }), true;
    if (!host.active()) return send(res, 409, { error: "not in a meeting" }), true;
    return send(res, 200, { ok: true, reply: await host.command(say) }), true;
  }
  if (p === "/meet/permissions" && m === "POST") {
    const b = await body();
    const mode = ["only-me", "everyone", "custom"].includes(b.mode) ? b.mode : null;
    const can = b.can && typeof b.can === "object" ? Object.fromEntries(Object.entries(b.can).filter(([k, v]) => ["dayspring", "lantern"].includes(k) && typeof v === "boolean")) : null;
    return send(res, 200, host.setPermission({ mode, name: typeof b.name === "string" ? b.name.slice(0, 120) : null, can })), true;
  }
  if (p === "/meet/demo" && m === "POST") { const b = await body(); host.setDemo(Boolean(b.on)); return send(res, 200, host.status()), true; }
  if (p === "/meet/settings" && m === "GET") return send(res, 200, settings.get()), true;
  if (p === "/meet/settings" && m === "POST") {
    const b = await body(), patch = {};
    if (typeof b.announce === "boolean") patch.announce = b.announce;
    if (typeof b.routeCourseToLantern === "boolean" || b.routeCourseToLantern === null) patch.routeCourseToLantern = b.routeCourseToLantern;
    if (typeof b.course === "string" && /^[\w-]{0,40}$/.test(b.course)) patch.course = b.course;
    if (Array.isArray(b.rehearsalQuestions)) patch.rehearsalQuestions = b.rehearsalQuestions.map((x) => String(x).slice(0, 200)).slice(0, 5);
    if (typeof b.publicLessonUrl === "string") {
      const u = b.publicLessonUrl.trim(), course = b.course || courseAnswer.courseId();
      if (u && !/^https:\/\/[^\s]+$/.test(u)) return send(res, 400, { error: "The link must start with https://" }), true;
      if (course) patch.courses = { [course]: { publicLessonUrl: u || null } };
    }
    return send(res, 200, settings.set(patch)), true;
  }
  if (p === "/meet/preflight" && m === "GET") return send(res, 200, await preflight.checklist()), true;
  if (p === "/meet/confirm" && m === "POST") {
    const b = await body(), c = {};
    for (const k of ["micSet", "linkShared", "soundTest"]) if (typeof b[k] === "boolean") c[k] = b[k];
    if (c.soundTest) c.soundTestAt = Date.now();
    settings.set({ confirmed: c });
    return send(res, 200, await preflight.checklist()), true;
  }
  if (p === "/meet/ask" && m === "POST") {
    const b = await body();
    const question = String(b.question ?? "").trim().slice(0, 400);
    if (!question) return send(res, 400, { error: "question is required" }), true;
    const as = b.as === "lantern" ? "lantern" : "dayspring";
    const course = courseAnswer.courseId();
    const found = await courseAnswer.retrieve(question, { course });
    const course_q = await courseAnswer.isCourseQuestion(question, { course });
    const a = found.hits.length ? await courseAnswer.answer({ question, course, hits: found.hits, as }) : null;
    return send(res, 200, { question, as, isCourse: course_q, source: found.source, hits: found.hits, answer: a, where: a ? courseAnswer.whereSpoken(a.citations) : null }), true;
  }
  if (p === "/meet/recent" && m === "GET") return send(res, 200, { answers: host.recent() }), true;
  if (p === "/meet/mock" && m === "GET") {
    try { const html = await readFile(MOCK); res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html); }
    catch { res.writeHead(404); res.end("not found"); }
    return true;
  }
  return false;
}
