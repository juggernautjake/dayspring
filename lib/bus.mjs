// The live connection from Dayspring's server to its own pages (Server-Sent Events), split out of announcer.mjs so
// any module can broadcast without importing the schedule, owner, morning… (see ecosystem-core docs/MIGRATION.md).
//
// One voice at a time: of all the open Dayspring pages, exactly one speaks — the first Dayspring screen that connected
// (else the guided setup's page). The others show everything but stay quiet. Pages say who they are with
// /api/events?page=display&id=… ; each gets "speaker" { id, page } whenever that changes.
//
//   addClient(res, { page, id }) · broadcast(type, data) · clientCount() · displayCount() · speaker() · on(fn)
const clients = new Set();
const pages = new Map();             // res → { id, page, at }
const listeners = new Set();
let speakerNow = null;
let hello = () => ({});              // announcer sets this: what a newly connected page gets first

export function setHello(fn) { hello = typeof fn === "function" ? fn : () => ({}); }
export function speaker() { return speakerNow; }
function elect() {
  const all = [...pages.values()].filter((x) => x.id);
  const rank = (p) => (p === "display" ? 0 : p === "welcome" ? 1 : 9);
  const best = all.filter((x) => rank(x.page) < 9).sort((a, b) => rank(a.page) - rank(b.page) || a.at - b.at)[0] ?? null;
  const next = best ? { id: best.id, page: best.page } : null;
  if (JSON.stringify(next) === JSON.stringify(speakerNow)) return;
  speakerNow = next;
  broadcast("speaker", next ?? { id: null, page: null });
}
export function addClient(res, { page = "", id = "" } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let first = {};
  try { first = hello() ?? {}; } catch { /* keep going */ }
  res.write(`event: hello\ndata: ${JSON.stringify(first)}\n\n`);
  clients.add(res);
  pages.set(res, { id: String(id).slice(0, 64), page: String(page).slice(0, 20), at: Date.now() });
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closing */ } }, 25_000);
  res.on("close", () => { clearInterval(ping); clients.delete(res); pages.delete(res); elect(); });
  elect();
  res.write(`event: speaker\ndata: ${JSON.stringify(speakerNow ?? { id: null, page: null })}\n\n`);
}
export function clientCount() { return clients.size; }
export const displayCount = () => [...pages.values()].filter((x) => x.page === "display").length;
export function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch { /* a page that just closed */ } }
  for (const fn of listeners) { try { fn(type, data); } catch { /* a listener's problem stays its own */ } }
}
// The same events inside the server (e.g. the ecosystem bridge watching "speaking")
export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
