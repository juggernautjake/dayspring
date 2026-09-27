// Meeting settings (data/meet.json, private to this computer).
//
//   demo                 Demo mode: everyone may ask both assistants, course questions go to Lantern, answers are
//                        spoken AND posted in the chat
//   announce             post a short "you can ask us" note in the meeting chat on joining (default on)
//   routeCourseToLantern course questions asked of Dayspring are handed to Lantern (default: on in demo mode)
//   course               which installed Lantern course answers course questions ("" = the first installed one)
//   courses.<id>         { publicLessonUrl: "https://…#{lesson}", synonyms: { "phrase": "lesson words" } }
//   mode                 who may ask when a meeting starts: "only-me" | "everyone" | "custom"
//   confirmed            the pre-flight items only the owner can check ({ micSet, linkShared, soundTest })
//   notes                take meeting notes (a transcript and a summary, after telling everyone; default on)
//   recordAudio          also record the call's audio to a file (default off: a separate choice)
//   notesKeepDays        saved meetings older than this go to the Recycle Bin (0: kept until deleted)
//   ocr                  read names off a picture of the meeting window when the page shows none (default on)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = () => process.env.DAYSPRING_MEET_FILE || join(ROOT, "data", "meet.json");
export const DEFAULTS = { demo: false, announce: true, routeCourseToLantern: null, course: "", courses: {}, mode: "only-me", confirmed: {}, lastLink: null, signedIn: null,
  notes: true, recordAudio: false, notesKeepDays: 90, ocr: true };

let cache = null;
export function get() {
  if (cache) return structuredClone(cache);
  let s = {};
  try { if (existsSync(FILE())) s = JSON.parse(readFileSync(FILE(), "utf8")); } catch { s = {}; }
  cache = { ...DEFAULTS, ...s, courses: { ...(s.courses ?? {}) }, confirmed: { ...(s.confirmed ?? {}) } };
  return structuredClone(cache);
}
export function set(patch = {}) {
  const cur = get();
  const next = { ...cur, ...patch };
  if (patch.courses) { next.courses = { ...cur.courses }; for (const [id, c] of Object.entries(patch.courses)) next.courses[id] = { ...(cur.courses[id] ?? {}), ...c }; }
  if (patch.confirmed) next.confirmed = { ...cur.confirmed, ...patch.confirmed };
  cache = next;
  try { writeJSONAtomic(FILE(), next, 2); } catch { /* kept in memory */ }
  return structuredClone(next);
}
export const routeToLantern = () => { const s = get(); return s.routeCourseToLantern ?? s.demo; };
export function _reset() { cache = null; }

// The public link to one lesson ("https://…#{lesson}"), or null when none is set for the course.
export function publicLessonUrl(courseId, lessonId) {
  const t = get().courses?.[courseId]?.publicLessonUrl;
  if (!t || !/^https:\/\//i.test(t) || !lessonId) return null;
  return t.includes("{lesson}") ? t.replaceAll("{lesson}", encodeURIComponent(lessonId)) : `${t.replace(/#.*$/, "")}#${encodeURIComponent(lessonId)}`;
}
