// One "now playing" for every screen: whatever is playing anywhere Dayspring can see, in one place, so the mini player
// card in the bottom-right corner of every Dayspring screen shows the same thing and its buttons reach the right player.
//
// Who reports (each under its own key):
//   screen          the Dayspring screen's own player (public/tv.js: YouTube, Spotify inside Dayspring, his own files and
//                   Google Drive's, audio and video). It posts /api/player/state; media.setState passes it on here.
//   window-spotify  Spotify's web player in the media window (server.mjs asks it every few seconds while it's open)
//   window-youtube  a YouTube video in the media window (the older way; same poll)
//   lantern, radio, anything else on this computer: POST /api/player/nowplaying/report { source, title, artist, art,
//                   playing, position, duration } (Lantern's study music, when Lantern reports it). { ended: true } clears it.
//
// current(): the one to show. The source that started playing most recently wins; when nothing plays, the last one that
// was paused (for 30 minutes), otherwise nothing. Every change is broadcast as "nowplaying-state" { current, others }.
// One voice: when a source starts playing, every other source that is playing is paused (setPauser registers how). The
// screen's own players already pause each other (tv.js); this covers the screen against the media window and Lantern.
import { broadcast as busBroadcast } from "./bus.mjs";

const KEEP_PAUSED_MS = 30 * 60_000;
let entries = new Map();          // key → entry
let pausers = new Map();          // key → async () => void
let last = "";                    // what was last broadcast (to send only changes)
let timer = null;
let deps = { broadcast: busBroadcast, now: () => Date.now() };
export function _setDeps(d) { deps = { ...deps, ...d }; }
export function _reset() { entries = new Map(); last = ""; lastPos = null; clearTimeout(timer); timer = null; }

const str = (v, n = 300) => (v == null ? "" : String(v).slice(0, n));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// what each source can do from the card
const CAN = {
  youtube: { seek: true, prev: true, next: true, like: true, modes: true },
  spotify: { seek: true, prev: true, next: true, like: true, modes: false },
  "spotify-window": { seek: false, prev: true, next: true, like: false, modes: false },
  file: { seek: true, prev: true, next: true, like: false, modes: true },
};
export const ICONS = { youtube: "youtube", spotify: "spotify", "spotify-window": "spotify", file: "file", drive: "drive", lantern: "lantern", radio: "radio", other: "music" };

// Normalise what a reporter sent. provider: youtube | spotify | spotify-window | file | lantern | radio | other
function entry(key, r, prev) {
  const provider = str(r.provider ?? r.source ?? key, 40) || "other";
  const kind = provider === "file" && /drive/i.test(str(r.sourceLabel)) ? "drive" : provider;
  const can = CAN[provider] ?? { seek: false, prev: false, next: false, like: false, modes: false };
  const t = deps.now();
  const playing = Boolean(r.playing);
  const e = {
    key, provider, icon: ICONS[kind] ?? "music",
    title: str(r.title, 200), artist: str(r.artist, 200), art: str(r.art, 500),
    playing, position: num(r.position), duration: num(r.duration), rate: num(r.rate) || 1, at: t,
    video: Boolean(r.video), mode: ["big", "corner", "audio"].includes(r.mode) ? r.mode : r.video ? "big" : null,
    videoId: r.videoId ? str(r.videoId, 20) : null, uri: r.uri ? str(r.uri, 200) : null,
    queueCount: Math.max(0, Math.round(num(r.queueCount))), sourceLabel: str(r.sourceLabel, 80),
    controllable: key === "screen" || key.startsWith("window-") || Boolean(pausers.get(key)),
    can: { ...can, modes: can.modes && Boolean(r.video || r.mode) },
    startedAt: prev?.startedAt ?? t,
  };
  // started (or changed to a different item while playing): it's the newest
  const changed = !prev || prev.title !== e.title || prev.provider !== e.provider;
  if (playing && (!prev?.playing || changed)) e.startedAt = t;
  return e;
}

// A player says what it's doing. r: {} or null clears it.
export function report(key, r) {
  key = str(key, 40) || "other";
  if (!r || r.ended || (!r.title && !r.playing && !r.provider && !r.source)) { if (entries.delete(key)) changed(); return current(); }
  const prev = entries.get(key), e = entry(key, r, prev);
  entries.set(key, e);
  if (e.playing && (!prev?.playing || prev.startedAt !== e.startedAt)) pauseOthers(key);
  changed();
  return current();
}
export const clear = (key) => report(key, null);
export function setPauser(key, fn) { if (typeof fn === "function") pausers.set(key, fn); else pausers.delete(key); }

// one voice: the newcomer plays, everyone else that is playing pauses
function pauseOthers(key) {
  for (const [k, e] of entries) {
    if (k === key || !e.playing) continue;
    const fn = pausers.get(k);
    if (fn) { e.playing = false; e.pausedBy = key; try { fn()?.catch?.(() => {}); } catch { /* that player is gone */ } }
  }
}

export function current() {
  const t = deps.now();
  const list = [...entries.values()];
  const playing = list.filter((e) => e.playing).sort((a, b) => b.startedAt - a.startedAt);
  if (playing.length) return view(playing[0]);
  const paused = list.filter((e) => t - e.at < KEEP_PAUSED_MS).sort((a, b) => b.at - a.at);
  return paused.length ? view(paused[0]) : null;
}
function view(e) {
  const t = deps.now();
  const pos = e.playing ? e.position + ((t - e.at) / 1000) * e.rate : e.position;
  return { ...e, position: e.duration ? Math.min(e.duration, pos) : pos };
}
export const all = () => [...entries.values()].map(view);
export function state() { const c = current(); return { current: c, others: all().filter((e) => e.key !== c?.key), at: deps.now() }; }

// broadcast after a short pause (a burst of reports is sent once); only when something the card shows changed
function changed() {
  clearTimeout(timer);
  timer = setTimeout(send, 60);
  timer.unref?.();
}
let lastPos = null;              // { pos, at, rate, playing } of the last broadcast (a seek is a jump from where it should be)
function send() {
  const s = state(), c = s.current;
  const key = JSON.stringify(c ? [c.key, c.provider, c.title, c.artist, c.art, c.playing, Math.round(c.duration), c.mode, c.queueCount, c.video, c.rate] : null) + s.others.length;
  const expect = lastPos ? lastPos.pos + (lastPos.playing ? ((deps.now() - lastPos.at) / 1000) * lastPos.rate : 0) : null;
  const jumped = c && expect !== null && Math.abs(c.position - expect) > 3;
  if (key === last && !jumped) return;
  last = key;
  lastPos = c ? { pos: c.position, at: deps.now(), rate: c.rate, playing: c.playing } : null;
  deps.broadcast("nowplaying-state", s);
}
export function flush() { clearTimeout(timer); send(); }
