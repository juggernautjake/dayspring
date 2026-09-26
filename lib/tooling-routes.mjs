// Setup/Settings routes for the AI coding tools and Voicemeeter (see cli-tools.mjs, voicemeeter-install.mjs).
//   GET  /api/cli/status?provider=&fresh=1   → { tools: [{ id, label, installed, version, signedIn, … }], coder, using, suggested, jobs }
//   GET  /api/cli/guide?tool=claude|codex     → step-by-step words for the setup screen and guide voice
//   POST /api/cli/install { tool, method?, dryRun? } → a job;  GET /api/cli/job?id=
//   POST /api/cli/login { tool, dryRun? }     → opens a terminal the owner signs in with
//   POST /api/cli/coder { coder: auto|claude|codex } → which one voice coding uses
//   GET  /api/voicemeeter/status?latest=1     → { installed, version, running, needsRestart, why, latest? }
//   POST /api/voicemeeter/install { mode: plan|verify|install } → a job;  GET /api/voicemeeter/job?id=
import * as cli from "./cli-tools.mjs";
import * as vmi from "./voicemeeter-install.mjs";

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/cli/") && !p.startsWith("/voicemeeter/")) return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
  try {
    if (m === "GET" && p === "/cli/status") return send(res, 200, cli.statusAll({ fresh: q.get("fresh") === "1", provider: q.get("provider") ?? "" })), true;
    if (m === "GET" && p === "/cli/guide") return send(res, 200, cli.guide(q.get("tool") ?? "claude")), true;
    if (m === "POST" && p === "/cli/install") return send(res, 200, cli.install(String(body.tool), { method: body.method ?? "powershell", dryRun: Boolean(body.dryRun) })), true;
    if (m === "GET" && p === "/cli/job") { const j = cli.job(q.get("id")); return send(res, j ? 200 : 404, j ?? { error: "no such job" }), true; }
    if (m === "POST" && p === "/cli/login") return send(res, 200, cli.login(String(body.tool), { dryRun: Boolean(body.dryRun) })), true;
    if (m === "POST" && p === "/cli/coder") return send(res, 200, { coder: cli.setPreferred(String(body.coder)), using: cli.coderTool() }), true;
    if (m === "GET" && p === "/voicemeeter/status") return send(res, 200, { ...vmi.status(), ...(q.get("latest") === "1" ? { latest: await vmi.latest() } : {}) }), true;
    if (m === "POST" && p === "/voicemeeter/install") return send(res, 200, vmi.install({ mode: ["plan", "verify", "install"].includes(body.mode) ? body.mode : "plan" })), true;
    if (m === "GET" && p === "/voicemeeter/job") { const j = vmi.job(q.get("id")); return send(res, j ? 200 : 404, j ?? { error: "no such job" }), true; }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
