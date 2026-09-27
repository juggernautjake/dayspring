// The first-run guided setup (/welcome): where the owner is in it (so closing the page resumes at the same step),
// the interests menu, and the connection walkthroughs. Everything it saves goes through the same /api/setup/* routes
// as Settings; this module only adds what's onboarding-specific.
// Mounted by server.mjs in ROUTES: handle(req, res, { m, p, q, send, readJSON }).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as interests from "./interests.mjs";
import * as owner from "./owner.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "welcome.json");
const load = () => { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}; } catch { return {}; } };
const save = (s) => { mkdirSync(dirname(FILE), { recursive: true }); writeJSONAtomic(FILE, s, 2); return s; };
const str = (v, n = 200) => String(v ?? "").trim().slice(0, n);

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/welcome")) return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};

  // progress: { step, ai: "anthropic"|"openai"|"xai"|"ollama"|"none", done: {stepId: true}, muted?, startedAt }
  if (p === "/welcome/state" && m === "GET") return send(res, 200, { ...load(), setupDone: owner.setupDone(), name: owner.get().name ?? "" }), true;
  if (p === "/welcome/state" && m === "POST") {
    const s = load();
    if (body.step !== undefined) s.step = str(body.step, 30);
    if (body.ai !== undefined) s.ai = str(body.ai, 20);
    if (body.done && typeof body.done === "object") s.done = { ...(s.done ?? {}), ...Object.fromEntries(Object.entries(body.done).map(([k, v]) => [str(k, 30), Boolean(v)])) };
    if (body.choices && typeof body.choices === "object") s.choices = { ...(s.choices ?? {}), ...body.choices };
    s.startedAt ??= new Date().toISOString(); s.updatedAt = new Date().toISOString();
    return send(res, 200, save(s)), true;
  }
  if (p === "/welcome/restart" && m === "POST") return send(res, 200, save({ step: "welcome", startedAt: new Date().toISOString() })), true;

  // interests
  if (p === "/welcome/interests" && m === "GET") {
    const ids = q.get("ids") ? q.get("ids").split(",") : interests.picked().ids;
    return send(res, 200, { catalog: interests.CATALOG.map(({ routines, features, ...c }) => ({ ...c, features: Object.keys(features) })), groups: interests.GROUPS, picked: interests.picked(), suggestions: interests.suggestions(ids) }), true;
  }
  if (p === "/welcome/interests" && m === "POST") {
    try { return send(res, 200, interests.apply({ ids: (body.ids ?? []).map((x) => str(x, 30)), other: body.other ?? [], addRoutines: (body.addRoutines ?? []).map((x) => str(x, 120)) })), true; }
    catch (e) { return send(res, 400, { error: e.message }), true; }
  }

  // connection walkthroughs (Notion, Google, Microsoft, …) come from the connectors module when it's installed
  if (p === "/welcome/guides" && m === "GET") {
    // connectors/guides.mjs: guides() → [{ id, name, icon, what, needs, time, steps: [{ text, link, linkLabel, copy }], fields: [{ key, label, secret, placeholder }], notes }]
    try { const g = await import("./connectors/guides.mjs"); const list = typeof g.guides === "function" ? g.guides() : g.guides ?? []; return send(res, 200, { guides: Object.fromEntries((Array.isArray(list) ? list : Object.values(list)).map((x) => [x.id, x])) }), true; }
    catch { return send(res, 200, { guides: {} }), true; }
  }
  return false;
}
