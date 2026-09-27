// Settings → Activity log: look through, search, export and check the activity log (lib/activity.mjs), and put back a
// version of a file from its backup. Local only, like every /api route (the server refuses anything from the internet),
// and the AI can't reach these pages (abilities.mjs keeps its browser off this computer's own pages).
//   GET  /api/activity?from=&to=&q=&kind=&path=&limit=&offset=   → { entries, total, from, to }
//   GET  /api/activity/export.csv?(same filters)                 → a CSV file
//   GET  /api/activity/verify                                   → { ok, files: [{ date, lines, ok, problem }] }
//   GET  /api/activity/settings · POST { days }                  → { days, min, default } (never fewer than 120 days)
//   POST /api/activity/restore { id }                             → put back the version from before that change
// Mounted by server.mjs in ROUTES: handle(req, res, { m, p, q, send, readJSON }).
import { existsSync } from "node:fs";
import * as activity from "./activity.mjs";
import * as abilities from "./abilities.mjs";

const filters = (q) => ({ query: q.get("q") ?? "", from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, kind: q.get("kind") ?? "", path: q.get("path") ?? "" });
const CHANGE = new Set(["file.write", "file.edit", "file.delete", "file.undo", "file.create", "file.move"]);

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/activity")) return false;
  if (m === "GET" && p === "/activity") {
    const r = activity.search({ ...filters(q), limit: Number(q.get("limit")) || 200, offset: Number(q.get("offset")) || 0 });
    const entries = r.entries.map(({ prev, hash, ...e }) => ({ ...e, restorable: CHANGE.has(e.kind) && e.result === "ok" && (e.backup ? existsSync(e.backup) : e.kind === "file.move" || e.kind === "file.create") }));
    return send(res, 200, { ...r, entries, settings: activity.settings() }), true;
  }
  if (m === "GET" && p === "/activity/export.csv") {
    const r = activity.search({ ...filters(q), limit: 5000 });
    const body = "﻿" + activity.toCSV(r.entries);          // the mark lets Excel read it as UTF-8
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="dayspring-activity-${r.from}-to-${r.to}.csv"`, "cache-control": "no-store" });
    res.end(body);
    return true;
  }
  if (m === "GET" && p === "/activity/verify") return send(res, 200, activity.verify({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined })), true;
  if (p === "/activity/settings") {
    if (m === "GET") return send(res, 200, activity.settings()), true;
    if (m === "POST") {
      const b = await readJSON(req).catch(() => ({}));
      try { return send(res, 200, activity.setSettings({ days: b.days })), true; } catch (e) { return send(res, 400, { error: e.message }), true; }
    }
  }
  if (m === "POST" && p === "/activity/restore") {
    const b = await readJSON(req).catch(() => ({}));
    if (!b.id) return send(res, 400, { error: "Which change?" }), true;
    const r = await abilities.restoreFromLog(String(b.id).slice(0, 60));
    if (r?.error || r?.denied) return send(res, 400, { error: r.error ?? r.text }), true;
    return send(res, 200, r), true;
  }
  return false;
}
