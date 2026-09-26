// Documents for the Dayspring screen's reader and Settings: find, outline, read in paragraphs, where the owner stopped.
//   GET  /api/docs/find?q=          → best matches for a description
//   GET  /api/docs/open?path=       → title, type, outline, first part, where they stopped last time
//   GET  /api/docs/read?path=&from=&n=&section=&page=  → paragraphs
//   POST /api/docs/progress { path, title, para, total, playing }  (the reader reports where it is)
//   POST /api/docs/show { path, read?, from? }  (open it on the screen, e.g. from Settings or a link)
import * as documents from "./documents.mjs";
import * as docskills from "./docskills.mjs";

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/docs/")) return false;
  try {
    if (m === "GET" && p === "/docs/find") return send(res, 200, await documents.find(q.get("q") ?? "")), true;
    if (m === "GET" && p === "/docs/open") { const o = await documents.outline(q.get("path")); return send(res, 200, { ...o, stoppedAt: documents.progress(o.path)?.para ?? null }), true; }
    if (m === "GET" && p === "/docs/read") return send(res, 200, await documents.read(q.get("path"), { from: q.get("from"), n: q.get("n"), section: q.get("section"), page: q.get("page") })), true;
    if (m === "POST" && p === "/docs/progress") { docskills.report(await readJSON(req)); return send(res, 200, { ok: true }), true; }
    if (m === "POST" && p === "/docs/show") { const b = await readJSON(req); const full = documents.guard(b.path); docskills.show({ action: b.read ? "read" : "open", path: full, from: b.from }); return send(res, 200, { ok: true }), true; }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
