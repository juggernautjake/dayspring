// Settings → Updates: GET /update/check, POST /update/apply, GET /update/status (paths are after /api).
// ctx = { m, p, q, send, readJSON, restart? } — restart is the server's own restart, used after an update.
import * as updater from "./updater.mjs";

export async function handle(req, res, ctx) {
  const { m, p, send } = ctx;
  if (!p.startsWith("/update/")) return false;
  if (m === "GET" && p === "/update/status") { send(res, 200, { ...updater.status(), backups: updater.backups().slice(0, 5) }); return true; }
  if (m === "GET" && p === "/update/check") {
    try { send(res, 200, { ...(await updater.check()), status: updater.status() }); }
    catch (e) { send(res, 502, { error: e.message, status: updater.status() }); }
    return true;
  }
  if (m === "POST" && p === "/update/apply") {
    try { send(res, 200, await updater.apply({ restart: ctx.restart })); }
    catch (e) { send(res, 500, { error: e.message, status: updater.status() }); }
    return true;
  }
  return false;
}
