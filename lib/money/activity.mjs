// Money review → the activity log. Every action on a money site is written down ("clicked "Next" on venmo.com",
// "refused to click …", "read 212 transactions from venmo.com"), never an amount, merchant, name or account number.
//
// Entries go to Dayspring's shared activity log (lib/activity.mjs: log(kind, data)) as kind "money" (or "blocked" for
// a refusal), and to data/finance/activity.log, which the Money page shows and "delete my money data" clears.
import { logLine } from "./store.mjs";

let shared = undefined;           // undefined = not looked yet, null = not there
async function sharedLog() {
  if (shared !== undefined) return shared;
  shared = null;
  try { const m = await import(new URL("../activity.mjs", import.meta.url).href); if (typeof m.log === "function") shared = m.log; } catch { /* no shared log in this copy */ }
  return shared;
}

export function log(text) {
  const line = String(text).replace(/\s+/g, " ").slice(0, 200);
  logLine(line);
  const kind = /^(refused|blocked|stopped)/.test(line) ? "blocked" : "money";
  sharedLog().then((fn) => { if (fn) { try { fn(kind, { area: "money", action: line }); } catch { /* the shared log's problem, not ours */ } } }).catch(() => {});
}
