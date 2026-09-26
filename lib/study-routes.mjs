// /api/study/*: open the next thing to study, check what the owner says they finished, and pull verified progress in.
// Also serves a course kept as a local file (data/study.json "open.file") to the study window at /study/course/<key>.
import { readFile } from "node:fs/promises";
import * as study from "./study.mjs";

export async function handle(req, res, { m, p, send, readJSON }) {
  if (!p.startsWith("/study")) return false;
  try {
    if (m === "GET" && p === "/study/state") return send(res, 200, study.state()), true;
    if (m === "POST" && p === "/study/open") {
      const { course, id } = await readJSON(req);
      if (!study.courses().includes(course)) return send(res, 400, { error: "unknown course" }), true;
      return send(res, 200, await study.open(course, id || null)), true;
    }
    if (m === "POST" && p === "/study/verify") {
      const { course, id, force } = await readJSON(req);
      if (!study.courses().includes(course)) return send(res, 400, { error: "unknown course" }), true;
      const target = id || study.nextItem(course)?.id;
      if (!target) return send(res, 200, { say: "Everything in that course is already done.", checked: [], marked: [] }), true;
      const r = await study.finish(course, [target], { force: Boolean(force) });
      const c = r.checked[0] ?? {};
      const next = study.nextItem(course);
      const say = c.ok ? `${force ? "Marked done." : "Checked, and it's done!"}${next ? ` Next up: ${next.title.split(" — ")[0]}.` : " That's the whole course!"}`
        : c.signedOut ? `I can't check yet: ${c.missing}. Sign in there once, or mark it done anyway.`
        : c.ok === null ? `I can't check this one (${c.missing}). You can mark it done yourself.`
        : `Not quite yet: ${c.missing}.`;
      return send(res, 200, { ...r, say, next }), true;
    }
    if (m === "POST" && p === "/study/sync") return send(res, 200, { marked: await study.sync() }), true;
    if (m === "POST" && p === "/study/import") {
      const { course, backup } = await readJSON(req);
      return send(res, 200, await study.importBackup(course, String(backup ?? ""))), true;
    }
    if (m === "POST" && p === "/study/close") { await study.close(); return send(res, 200, { closed: true }), true; }
  } catch (e) { return send(res, 500, { error: e.message }), true; }
  return false;
}

// Non-/api page: the course file for the study window. Only the exact file named in data/study.json is ever served.
export async function handlePage(req, res, { m, pathname }) {
  const mm = /^\/study\/course\/([a-z0-9_-]+)$/i.exec(pathname);
  if (m !== "GET" || !mm) return false;
  const f = study.courseFile(decodeURIComponent(mm[1]));
  if (!f) { res.writeHead(404, { "content-type": "text/plain" }); res.end("No local file for that course."); return true; }
  let body; try { body = await readFile(f); } catch { res.writeHead(404, { "content-type": "text/plain" }); res.end("That course file isn't there any more."); return true; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
  return true;
}
