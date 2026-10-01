// The windows on the Dayspring screens (public/winman.js), by voice: "minimize the map", "shrink the email", "put the
// viewer in the corner", "maximize the browser", "restore the map", "move the map to the right side", "close the viewer",
// "hide everything" / "minimize all", "show everything again". No AI needed.
//   Each screen reports its windows (POST /api/winman/state { page, windows: [{ id, title, mode, open, aliases }] }); a
//   command is only taken when that window is open on a screen (otherwise "close the map" is left to Maps itself), and it
//   goes to every screen as a "winman" event { op, id, value }.
//   command(text) → { reply } | null        handle(): /api/winman/state (GET, POST)
// The words are public/view-words.js's (dsWindowWords), the same file the screen uses.
import { broadcast as busBroadcast, clientCount } from "./bus.mjs";
import "../public/view-words.js";

const STALE_MS = 10 * 60_000;
let pages = new Map();                   // page → { windows, at }
let deps = { broadcast: busBroadcast, screens: () => clientCount() };
export function _setDeps(d) { deps = { ...deps, ...d }; }
export function _reset() { pages = new Map(); }

const clip = (s, n) => String(s ?? "").slice(0, n);
export function setState(page, windows) {
  const list = (Array.isArray(windows) ? windows : []).slice(0, 40).map((w) => ({ id: clip(w.id, 40), title: clip(w.title, 80), mode: clip(w.mode, 10), open: Boolean(w.open), aliases: (Array.isArray(w.aliases) ? w.aliases : []).slice(0, 12).map((a) => clip(a, 40).toLowerCase()) })).filter((w) => w.id);
  pages.set(clip(page, 80) || "screen", { windows: list, at: Date.now() });
}
// every window any screen has, the most recent report first (an open one wins over a closed one)
export function windows() {
  const out = new Map();
  const now = Date.now();
  for (const p of [...pages.values()].filter((x) => now - x.at < STALE_MS).sort((a, b) => b.at - a.at)) for (const w of p.windows) { const had = out.get(w.id); if (!had || (!had.open && w.open)) out.set(w.id, w); }
  return [...out.values()];
}
const NAME = { video: "the video", mediabrowser: "the Music & Video browser", viewer: "the viewer", maps: "the map", mail: "your email", gifs: "the GIFs", images: "the pictures", schedule: "the schedule", page: "that page", shopping: "Shopping" };
const nameOf = (w) => NAME[w.id] ?? (w.title ? `the ${w.title.toLowerCase()}` : "that window");
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function command(text) {
  if (deps.screens() < 1) return null;
  const all = windows(), open = all.filter((w) => w.open && w.mode !== "closed");
  const w = globalThis.dsWindowWords?.(text, all);
  if (!w) return null;
  const send = (x) => deps.broadcast("winman", x);
  // (everything at once: the screens do it with what they have, even if their last report is a moment old)
  if (w.op === "minAll") {
    if (!open.length) return null;
    const up = open.filter((x) => x.mode !== "min");
    send({ op: "minAll" });
    return { reply: up.length ? `Okay, I tucked ${up.length === 1 ? nameOf(up[0]) : "everything"} away. Say “show everything again” to bring ${up.length === 1 ? "it" : "it all"} back.` : "It's all tucked away already." };
  }
  if (w.op === "restoreAll") {
    if (!open.length) return null;
    send({ op: "restoreAll" });
    return { reply: open.some((x) => x.mode === "min") ? "Here it all is." : "Everything's showing." };
  }
  const win = open.find((x) => x.id === w.id);
  if (!win) return null;                                 // not open on any screen: its own words (Maps' "close the map"…)
  if (w.op === "restore") {
    if (!["min", "small", "max"].includes(win.mode)) return null;   // "show the map" when it's already showing normally
    send({ op: "mode", id: win.id, value: "restore" });
    return { reply: "" };
  }
  if (w.op === "close") { send({ op: "mode", id: win.id, value: "close" }); return { reply: `Closed ${nameOf(win)}.` }; }
  if (w.op === "mode") {
    send({ op: "mode", id: win.id, value: w.value });
    return { reply: w.value === "min" ? `${cap(nameOf(win))} is down in the dock. Say “restore ${nameOf(win).replace(/^(the|your) /, "the ")}” to bring it back.` : "" };
  }
  if (w.op === "place" || w.op === "resize") { send({ op: w.op, id: win.id, value: w.value }); return { reply: "" }; }
  return null;
}

export async function handle(req, res, { m, p, send, readJSON }) {
  if (p !== "/winman/state") return false;
  if (m === "GET") return send(res, 200, { windows: windows() }), true;
  if (m === "POST") { const b = await readJSON(req).catch(() => ({})); setState(b.page, b.windows); return send(res, 200, { ok: true }), true; }
  return false;
}
