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
//   GET  /meet/who                         → who's in the call, who's talking, and how each was found
// Meeting notes (saved on this computer, data/meetings; lib/meet/notes.mjs):
//   POST /meet/notes/live { action: "start" | "stop" | "pause" | "private" | "resume" }   (during a meeting)
//   GET  /meet/notes[?q=…]                 → saved meetings, newest first (searching titles, people, summaries, transcripts)
//   GET  /meet/notes/<id>                  → { meta, summary, transcript, chat, audio }
//   GET  /meet/notes/<id>/audio            → audio.wav (only when audio recording was on)
//   POST /meet/notes/<id>/open             → its folder in File Explorer
//   POST /meet/notes/<id>/recap            → { text } a short recap (the screen says it out loud)
//   POST /meet/notes/<id>/draft            → { subject, body, mailto } a draft for the owner to send (never sent from here)
//   POST /meet/notes/<id>/summarize        → write the summary again (e.g. after adding an AI key)
//   POST /meet/notes/<id>/delete { confirm: true } → to the Recycle Bin
// Nothing here changes a device or signs in to anything.
import { readFile } from "node:fs/promises";
import { createReadStream, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import * as host from "./meet/host.mjs";
import * as notes from "./meet/notes.mjs";
import * as settings from "./meet/settings.mjs";
import * as preflight from "./meet/preflight.mjs";
import * as courseAnswer from "./meet/course-answer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOCK = join(ROOT, "vendor", "ecosystem-core", "lib", "meet", "mock", "meet-mock.html");

export const command = (text) => host.command(text);

export async function handle(req, res, { m, p, q, send, readJSON }) {
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
    for (const k of ["notes", "recordAudio", "ocr"]) if (typeof b[k] === "boolean") patch[k] = b[k];
    if (Number.isInteger(b.notesKeepDays) && b.notesKeepDays >= 0 && b.notesKeepDays <= 3650) patch.notesKeepDays = b.notesKeepDays;
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
  if (p === "/meet/who" && m === "GET") return send(res, 200, { here: host.whoIsHere(), talking: host.whoIsTalking(), found: host.peopleCheck(), roster: host.status().roster }), true;
  // ---- meeting notes ----
  if (p === "/meet/notes/live" && m === "POST") {
    const b = await body();
    const say = { start: "start taking notes", stop: "stop taking notes", pause: "pause the notes", private: "don't record this part", resume: "resume the notes" }[b.action];
    if (!say) return send(res, 400, { error: "unknown action" }), true;
    if (!host.active()) return send(res, 409, { error: "not in a meeting" }), true;
    return send(res, 200, { ok: true, reply: await host.command(say), notes: host.status().notes }), true;
  }
  if (p === "/meet/notes" && m === "GET") return send(res, 200, { meetings: notes.list({ q: String(q?.get("q") ?? "").slice(0, 120) }), keepDays: settings.get().notesKeepDays ?? 90 }), true;
  let mm;
  if ((mm = /^\/meet\/notes\/([\w-]{1,120})(?:\/(audio|open|recap|draft|summarize|delete))?$/.exec(p))) {
    const [, id, what = ""] = mm;
    const dir = notes.folderOf(id);
    if (!dir) return send(res, 404, { error: "Those notes aren't here any more." }), true;
    if (!what && m === "GET") return send(res, 200, notes.read(id)), true;
    if (what === "audio" && m === "GET") {
      const f = join(dir, "audio.wav");
      let size = 0; try { size = statSync(f).size; } catch { return send(res, 404, { error: "No audio was recorded." }), true; }
      res.writeHead(200, { "content-type": "audio/wav", "content-length": size, "cache-control": "no-store" });
      createReadStream(f).pipe(res);
      return true;
    }
    if (m !== "POST") return false;
    if (what === "open") { execFile("explorer.exe", [dir], { windowsHide: false }, () => {}); return send(res, 200, { ok: true }), true; }
    if (what === "recap") return send(res, 200, notes.recapOf(id) ?? { text: "" }), true;
    if (what === "draft") return send(res, 200, notes.draftOf(id)), true;
    if (what === "summarize") return send(res, 200, await notes.resummarize(id) ?? { error: "couldn't" }), true;
    if (what === "delete") {
      const b = await body();
      if (b.confirm !== true) return send(res, 400, { error: "Deleting needs { confirm: true }." }), true;
      try { await notes.remove(id); } catch (e) { return send(res, 500, { error: e.message }), true; }
      return send(res, 200, { ok: true, recycled: true }), true;
    }
  }
  if (p === "/meet/mock" && m === "GET") {
    try { const html = await readFile(MOCK); res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html); }
    catch { res.writeHead(404); res.end("not found"); }
    return true;
  }
  return false;
}
