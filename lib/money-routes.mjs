// /api/money: the Money review page (public/money.html). Local only, like every /api route (server.mjs refuses other
// websites and the internet). Reports and transactions are decrypted only to answer this page.
//   GET  /money/state                       permission, settings, consent, the money window, reports, the import folder
//   POST /money/permission { on }           the "Money review (read-only)" permission (the page explains it first)
//   POST /money/settings { idleMinutes, retentionDays, months, bankUrl }
//   POST /money/consent { ai, vision }      the owner's own answer to the consent questions (never the AI's)
//   POST /money/open { target } · /money/close
//   POST /money/review { months }           read the open money page (if allowed) + everything kept → a new report
//   POST /money/import { name, text }       a CSV / OFX / QFX file dropped on the page · /money/import-folder
//   GET  /money/report?id=  · /money/reports · GET /money/file?id=&kind=md|csv · POST /money/report/delete { id }
//   POST /money/delete-all { confirm: "DELETE" }
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as permissions from "./permissions.mjs";
import * as money from "./money/index.mjs";
import * as store from "./money/store.mjs";
import * as fin from "./money/browser.mjs";
import * as ai from "./money/ai.mjs";
import * as activity from "./money/activity.mjs";
import * as llm from "./llm.mjs";

const state = () => ({
  permission: Boolean(permissions.get().money), permissionText: money.PERMISSION_TEXT, consentText: money.CONSENT_TEXT, visionConsentText: ai.VISION_CONSENT_TEXT,
  settings: store.settings(), aiReady: llm.ready(), browser: fin.status(), reports: store.reports().slice(0, 30), saved: store.rawFiles().length,
  importFolder: store.importDir(), activity: store.logTail(30),
});

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/money/") && p !== "/money") return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
  if (p === "/money/state" && m === "GET") return send(res, 200, state()), true;
  if (p === "/money/permission" && m === "POST") {
    const on = body.on === true;
    if (on && body.understood !== true) return send(res, 400, { error: "Please read the explanation and tick \"I understand\" first." }), true;
    permissions.set({ money: on });
    activity.log(`money review permission turned ${on ? "on" : "off"} by the owner`);
    if (!on) await fin.close();
    return send(res, 200, state()), true;
  }
  if (p === "/money/settings" && m === "POST") { store.setSettings(body); store.prune(); return send(res, 200, state()), true; }
  if (p === "/money/consent" && m === "POST") {
    const patch = {};
    if (typeof body.ai === "boolean") { patch.aiConsent = body.ai; patch.aiConsentAsked = true; }
    if (typeof body.vision === "boolean") patch.visionConsent = body.vision && (body.ai ?? store.settings().aiConsent);
    store.setSettings(patch);
    activity.log(`the owner ${patch.aiConsent === false ? "withdrew" : "set"} money AI consent${patch.visionConsent !== undefined ? ` (screenshots ${patch.visionConsent ? "allowed" : "off"})` : ""}`);
    return send(res, 200, state()), true;
  }
  if (p === "/money/open" && m === "POST") {
    if (!money.allowed()) return send(res, 403, { error: "Turn on Money review (read-only) first." }), true;
    try { const r = await fin.open(body.target); return send(res, r.opened ? 200 : 400, r.opened ? { ...r, say: "Sign in yourself in the money window. Dayspring never types or sees passwords or codes." } : { error: r.reason }), true; }
    catch (e) { return send(res, 400, { error: e.message }), true; }
  }
  if (p === "/money/close" && m === "POST") return send(res, 200, { closed: await fin.close() }), true;
  if (p === "/money/review" && m === "POST") {
    const r = await money.review({ months: body.months, show: false });
    return send(res, 200, { ok: r.ok, say: r.reply, id: r.saved?.id ?? null }), true;
  }
  if (p === "/money/import" && m === "POST") {
    try {
      const r = money.importText(String(body.name ?? "statement.csv").slice(0, 120), String(body.text ?? ""));
      const rv = await money.review({ live: false, show: false });
      return send(res, 200, { ok: true, imported: r, say: rv.reply, id: rv.saved?.id ?? null }), true;
    } catch (e) { return send(res, 400, { error: e.message }), true; }
  }
  if (p === "/money/import-folder" && m === "POST") {
    const r = money.importFolder();
    const rv = r.done.length ? await money.review({ live: false, show: false }) : null;
    return send(res, 200, { ...r, say: rv?.reply ?? null, id: rv?.saved?.id ?? null }), true;
  }
  if (p === "/money/reports" && m === "GET") return send(res, 200, { reports: store.reports() }), true;
  if (p === "/money/report" && m === "GET") { const r = store.loadReport(q.get("id") || null); return send(res, r ? 200 : 404, r ?? { error: "No report yet." }), true; }
  if (p === "/money/report/delete" && m === "POST") { store.deleteReport(String(body.id ?? "")); return send(res, 200, state()), true; }
  if (p === "/money/file" && m === "GET") {
    const id = String(q.get("id") ?? ""), kind = q.get("kind") === "csv" ? "csv" : "md";
    if (!store.reports().some((r) => r.id === id)) return send(res, 404, { error: "not found" }), true;
    const text = readFileSync(join(store.reportsDir(), `${id}.${kind}`), "utf8");
    res.writeHead(200, { "content-type": kind === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${id}.${kind}"` });
    res.end(text); return true;
  }
  if (p === "/money/delete-all" && m === "POST") {
    if (body.confirm !== "DELETE") return send(res, 400, { error: "Type DELETE to confirm." }), true;
    await fin.close();
    const had = store.deleteAll();
    return send(res, 200, { deleted: had, ...state() }), true;
  }
  return false;
}
