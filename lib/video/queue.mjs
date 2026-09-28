// The video queue: what's playing and what comes next, kept on this computer so it survives a restart
// (data/video-queue.json; tests: DAYSPRING_VIDEO_QUEUE). The screen shows it (public/videos.js) and plays from it.
//   { items: [{ id, videoId, playlistId, title, channel, secs, length }], index (the one playing, -1 none), repeat
//     "off"|"one"|"all", shuffle, order (the order before shuffling), source ({ name } when a playlist filled it) }
// Numbers the owner says ("play number 5", "remove number 3") are positions in the whole list, 1 = the top, the way the
// panel shows them.
//   get() · add(items, { next }) · playNow(item) · replace(items, { source, shuffle }) · jump(n) · next({ auto }) · previous()
//   remove(n) · move(n, to) · clear() · setRepeat(mode) · setShuffle(on) · onChange(fn) · reload()
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { writeJSONAtomic } from "../atomic.mjs";
import { mmss, secsOf } from "./text.mjs";

const FILE = () => process.env.DAYSPRING_VIDEO_QUEUE || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "video-queue.json");
const MAX = 500;
let q = null, qFile = null;
const listeners = new Set();
function load() {
  if (q && qFile === FILE()) return q;
  qFile = FILE();
  try { q = existsSync(qFile) ? JSON.parse(readFileSync(qFile, "utf8")) : null; } catch { q = null; }
  q ??= {};
  q.items = Array.isArray(q.items) ? q.items.filter((x) => x && (x.videoId || x.playlistId)).slice(0, MAX) : [];
  q.index = Number.isInteger(q.index) && q.index < q.items.length ? q.index : -1;
  q.repeat = ["off", "one", "all"].includes(q.repeat) ? q.repeat : "off";
  q.shuffle = Boolean(q.shuffle);
  q.order = Array.isArray(q.order) ? q.order : null;
  q.source ??= null;
  return q;
}
function changed(what = "change") {
  const d = load();
  d.updated = new Date().toISOString();
  try { mkdirSync(dirname(qFile), { recursive: true }); writeJSONAtomic(qFile, d, 2); } catch (e) { console.log(`video queue: not saved (${e.message})`); }
  const s = get();
  for (const fn of listeners) { try { fn(s, what); } catch { /* a listener's own problem */ } }
  return s;
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function reload() { q = null; qFile = null; }

const clean = (s, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export function item(x = {}) {
  const videoId = /^[\w-]{11}$/.test(x.videoId ?? "") ? x.videoId : null, playlistId = /^[\w-]{2,64}$/.test(x.playlistId ?? "") ? x.playlistId : null;
  const secs = Number.isFinite(x.secs) ? x.secs : secsOf(x.length);
  return { id: randomUUID().slice(0, 8), videoId, playlistId: videoId ? null : playlistId, title: clean(x.title) || (videoId ? "YouTube video" : "YouTube playlist"), channel: clean(x.channel, 100),
    secs: secs ?? null, length: x.length ? clean(x.length, 12) : secs ? mmss(secs) : "", ...(x.live ? { live: true } : {}) };
}
export function get() {
  const d = load();
  return { items: d.items.map((x, i) => ({ ...x, n: i + 1, current: i === d.index })), index: d.index, current: d.items[d.index] ?? null, upcoming: d.items.slice(d.index + 1),
    repeat: d.repeat, shuffle: d.shuffle, source: d.source, total: d.items.length, left: Math.max(0, d.items.length - d.index - 1), updated: d.updated ?? null };
}
const pos = (n) => { const d = load(); const i = Number(n) - 1; if (!Number.isInteger(i) || i < 0 || i >= d.items.length) throw new Error(d.items.length ? `There are only ${d.items.length} in the queue.` : "The queue is empty."); return i; };

// add to the end, or right after the one playing ("play next"); returns the positions (1-based)
export function add(list, { next = false } = {}) {
  const d = load();
  const its = (Array.isArray(list) ? list : [list]).map(item).filter((x) => x.videoId || x.playlistId);
  if (!its.length) throw new Error("There's no video to add.");
  const at = next ? d.index + 1 : d.items.length;
  d.items.splice(at, 0, ...its);
  if (d.items.length > MAX) d.items.splice(0, d.items.length - MAX);
  if (d.shuffle && d.order) d.order.push(...its.map((x) => x.id));
  changed("add");
  return { added: its.length, at: at + 1, items: its };
}
// play this now: it goes right after the one playing and becomes the current one (what comes after stays up next)
export function playNow(x) {
  const d = load();
  const it = item(x);
  const cur = d.items[d.index];
  if (cur && cur.videoId && cur.videoId === it.videoId) return { item: cur, n: d.index + 1 };
  d.items.splice(d.index + 1, 0, it);
  d.index += 1;
  if (d.items.length > MAX) { const cut = d.items.length - MAX; d.items.splice(0, cut); d.index -= cut; }
  changed("play");
  return { item: it, n: d.index + 1 };
}
// a whole playlist: it becomes the queue
export function replace(list, { source = null, shuffle = false, start = 0 } = {}) {
  const d = load();
  d.items = (list ?? []).map(item).filter((x) => x.videoId || x.playlistId).slice(0, MAX);
  d.source = source; d.order = null; d.shuffle = false;
  d.index = d.items.length ? Math.max(0, Math.min(d.items.length - 1, start)) : -1;
  if (shuffle && d.items.length > 1) { d.index = -1; shuffleUpcoming(d); d.shuffle = true; d.index = 0; }
  changed("replace");
  return get();
}
export function jump(n) { const d = load(), i = pos(n); d.index = i; changed("jump"); return { item: d.items[i], n: i + 1 }; }
// the next one: repeat one (at the end of a video) plays it again; at the end, repeat all starts over
export function next({ auto = false } = {}) {
  const d = load();
  if (!d.items.length) return null;
  if (auto && d.repeat === "one" && d.index >= 0) return { item: d.items[d.index], n: d.index + 1, again: true };
  if (d.index + 1 < d.items.length) { d.index += 1; changed("next"); return { item: d.items[d.index], n: d.index + 1 }; }
  if (d.repeat === "all" || (d.repeat === "one" && !auto)) {
    if (d.shuffle) { const cur = d.index; d.index = -1; shuffleUpcoming(d); d.index = cur; }
    d.index = 0; changed("next"); return { item: d.items[0], n: 1, wrapped: true };
  }
  return null;
}
export function previous() {
  const d = load();
  if (d.index <= 0) return null;
  d.index -= 1; changed("previous");
  return { item: d.items[d.index], n: d.index + 1 };
}
export function remove(n) {
  const d = load(), i = n === 0 ? d.index : pos(n);
  if (i < 0) throw new Error("Nothing from the queue is playing.");
  const was = i === d.index;
  const [x] = d.items.splice(i, 1);
  if (i <= d.index) d.index -= 1;                              // (the one playing: it finishes, then what followed it plays)
  if (d.order) d.order = d.order.filter((id) => id !== x.id);
  changed("remove");
  return { removed: x, n: i + 1, wasCurrent: was };
}
// to: "up" | "down" | "top" | "end" | "next" | a position | { after: n } | { before: n }
export function move(n, to) {
  const d = load(), i = pos(n), cur = d.items[d.index];
  let j = to === "up" ? i - 1 : to === "down" ? i + 1 : to === "top" ? 0 : to === "end" ? d.items.length - 1 : to === "next" ? (d.index < i ? d.index + 1 : d.index)
    : to && typeof to === "object" ? (to.after ? pos(to.after) + (pos(to.after) < i ? 1 : 0) : pos(to.before) - (pos(to.before) > i ? 1 : 0)) : Number(to) - 1;
  j = Math.max(0, Math.min(d.items.length - 1, j));
  const [x] = d.items.splice(i, 1);
  d.items.splice(j, 0, x);
  d.index = cur ? d.items.indexOf(cur) : -1;
  changed("move");
  return { item: x, from: i + 1, to: j + 1 };
}
// everything except the one playing
export function clear() {
  const d = load(), cur = d.items[d.index];
  const n = d.items.length - (cur ? 1 : 0);
  d.items = cur ? [cur] : []; d.index = cur ? 0 : -1; d.order = null; d.source = null;
  changed("clear");
  return { cleared: n };
}
export function setRepeat(mode) { const d = load(); d.repeat = ["off", "one", "all"].includes(mode) ? mode : "off"; changed("repeat"); return d.repeat; }
function shuffleUpcoming(d) {
  const head = d.items.slice(0, d.index + 1), rest = d.items.slice(d.index + 1);
  d.order = d.items.map((x) => x.id);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  d.items = [...head, ...rest];
}
export function setShuffle(on) {
  const d = load();
  if (on && !d.shuffle) { shuffleUpcoming(d); d.shuffle = true; }
  else if (!on && d.shuffle) {
    const order = d.order ?? [], rank = (x) => { const k = order.indexOf(x.id); return k < 0 ? Infinity : k; };
    const head = d.items.slice(0, d.index + 1), rest = d.items.slice(d.index + 1).sort((a, b) => rank(a) - rank(b));
    d.items = [...head, ...rest]; d.shuffle = false; d.order = null;
  }
  changed("shuffle");
  return d.shuffle;
}
// a video that's playing now which the queue didn't start (a link, the morning music): the queue stops pointing at an old one
export function detach(videoId) {
  const d = load(), cur = d.items[d.index];
  if (!cur || !videoId || cur.videoId === videoId) return false;
  const k = d.items.findIndex((x) => x.videoId === videoId);
  if (k >= 0) { d.index = k; changed("follow"); return true; }
  return false;
}
