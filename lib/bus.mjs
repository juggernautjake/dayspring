// The live connection from Dayspring's server to its own pages (Server-Sent Events), split out of announcer.mjs so
// any module can broadcast without importing the schedule, owner, morning… (see ecosystem-core docs/MIGRATION.md).
//
// One voice at a time: of all the open Dayspring pages, exactly one speaks — the Dayspring screen the owner opened most
// recently on purpose (claim(): switching to compact / full / a tab), else the first one that connected (else the guided
// setup's page). The others show everything but stay quiet. Pages say who they are with
// /api/events?page=display&id=… ; each gets "speaker" { id, page } whenever that changes.
//
//   addClient(res, { page, id }) · claim(id) · release(id) · broadcast(type, data) · clientCount() · displayCount() · speaker() · on(fn)
const clients = new Set();
const pages = new Map();             // res → { id, page, at }
const listeners = new Set();
let speakerNow = null;
let hello = () => ({});              // announcer sets this: what a newly connected page gets first

export function setHello(fn) { hello = typeof fn === "function" ? fn : () => ({}); }
// other modules add to what a newly connected page is told (who has the microphone, listening state, notices…)
const helloParts = new Map();
export function addHello(key, fn) { if (typeof fn === "function") helloParts.set(String(key), fn); }
export function speaker() { return speakerNow; }
function elect() {
  const all = [...pages.values()].filter((x) => x.id && !x.gone);
  const rank = (p) => (p === "display" ? 0 : p === "welcome" ? 1 : 9);
  const best = all.filter((x) => rank(x.page) < 9).sort((a, b) => rank(a.page) - rank(b.page) || (b.claimAt ?? 0) - (a.claimAt ?? 0) || a.at - b.at)[0] ?? null;
  const next = best ? { id: best.id, page: best.page } : null;
  if (JSON.stringify(next) === JSON.stringify(speakerNow)) return;
  speakerNow = next;
  broadcast("speaker", next ?? { id: null, page: null });
}
export function addClient(res, { page = "", id = "" } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let first = {};
  try { first = hello() ?? {}; } catch { /* keep going */ }
  for (const [k, fn] of helloParts) { try { const v = fn(); if (v !== undefined) first[k] = v; } catch { /* that part is left out */ } }
  res.write(`event: hello\ndata: ${JSON.stringify(first)}\n\n`);
  clients.add(res);
  pages.set(res, { id: String(id).slice(0, 64), page: String(page).slice(0, 20), at: Date.now() });
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closing */ } }, 25_000);
  res.on("close", () => { clearInterval(ping); clients.delete(res); pages.delete(res); elect(); });
  elect();
  res.write(`event: speaker\ndata: ${JSON.stringify(speakerNow ?? { id: null, page: null })}\n\n`);
}
// The page with this id becomes the speaker (it was just opened or brought forward on purpose)
export function claim(id) {
  let found = false;
  for (const p of pages.values()) if (p.id && p.id === String(id)) { p.claimAt = Date.now(); found = true; }
  if (found) elect();
  return found;
}
// The page with this id is going away (its pagehide beacon): it stops being the speaker now, without waiting for its
// connection to close (a browser can keep it open a few seconds, or longer while it's frozen)
export function release(id) {
  let found = false;
  for (const p of pages.values()) if (p.id && p.id === String(id)) { p.gone = true; found = true; }
  if (found) elect();
  return found;
}
export function clientCount() { return clients.size; }
export const displayCount = () => [...pages.values()].filter((x) => x.page === "display" && !x.gone).length;
export function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch { /* a page that just closed */ } }
  for (const fn of listeners) { try { fn(type, data); } catch { /* a listener's problem stays its own */ } }
}
// The same events inside the server (e.g. the ecosystem bridge watching "speaking")
export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
