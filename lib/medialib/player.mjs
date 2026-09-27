// Playing the owner's own files (and Drive's) on the Dayspring screen, or in this PC's default app.
//   play(items, opts)   → the command the screen's player runs (public/medialib.js): a queue of same-origin addresses
//                         (/api/media/local/stream?id=… or /api/drive/stream?ref=…). Nothing but ids leave the server:
//                         the stream route looks the id up in the index and checks permissions again when it plays.
//   openDefault(item)   → "play it on this PC": opens the file in Windows' default app. That's opening a program, so it
//                         needs the Programs permission (and asks first when it's set to ask), and it's logged.
// Formats the screen can't play (WMA, WMV, AVI, and MKVs with codecs it doesn't know): converted on the fly by ffmpeg
// when ffmpeg is on this computer (Dayspring's own ffmpeg-static, or one on the PATH); otherwise Dayspring says so and
// offers the default app. DAYSPRING_NO_TRANSCODE=1 turns conversion off. Every play is logged (the path only).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename } from "node:path";
import * as permissions from "../permissions.mjs";
import * as confirm from "../confirm.mjs";
import * as activity from "../activity.mjs";
import * as media from "../media.mjs";
import { broadcast } from "../bus.mjs";
import * as library from "./library.mjs";
import { NEVER_PLAYS } from "./tags.mjs";

// ---- ffmpeg (only when it's already here) ----------------------------------------------------------------------------------
let ff;
export function ffmpegPath() {
  if (ff !== undefined) return ff;
  ff = null;
  if (process.env.DAYSPRING_NO_TRANSCODE === "1") return ff;
  try { const p = createRequire(import.meta.url)("ffmpeg-static"); if (p && existsSync(p)) return (ff = p); } catch { /* not installed */ }
  try { const r = spawnSync("where", ["ffmpeg"], { encoding: "utf8", windowsHide: true, timeout: 5000 }); const p = (r.stdout ?? "").split(/\r?\n/).find((x) => /ffmpeg(\.exe)?$/i.test(x.trim())); if (p && existsSync(p.trim())) ff = p.trim(); } catch { /* none */ }
  return ff;
}
export const canConvert = () => Boolean(ffmpegPath());
export function _setFfmpeg(p) { ff = p; }   // tests
let running = null;
// convert(item, res, { start }) → streams the file as MP3 (audio) or fragmented MP4 (video); one conversion at a time
export function convert(path, kind, res, req, { start = 0 } = {}) {
  const bin = ffmpegPath();
  if (!bin) { res.writeHead(415, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "This format can't play on the screen, and ffmpeg isn't installed to convert it." })); return; }
  try { running?.kill("SIGKILL"); } catch { /* gone */ }
  const at = Math.max(0, Number(start) || 0);
  const args = ["-hide_banner", "-loglevel", "error", ...(at ? ["-ss", String(at)] : []), "-i", path,
    ...(kind === "video" ? ["-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"]
      : ["-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3"]), "pipe:1"];
  const p = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  running = p;
  res.writeHead(200, { "content-type": kind === "video" ? "video/mp4" : "audio/mpeg", "cache-control": "no-store", "x-dayspring-converted": "1" });
  p.stdout.pipe(res);
  const stop = () => { try { p.kill("SIGKILL"); } catch { /* gone */ } };
  req.on("close", stop);
  p.on("exit", () => { if (running === p) running = null; if (!res.writableEnded) res.end(); });
}

// ---- building what the screen plays ---------------------------------------------------------------------------------------
const say = (x) => library.describe(x);
function entry(x) {
  if (x.source === "drive") return { id: x.id, src: `/api/drive/stream?ref=${encodeURIComponent(x.ref)}`, title: x.title, artist: x.artist ?? "", album: "", kind: x.kind, duration: x.duration ?? null, source: "drive", where: `${x.drive}'s Drive` };
  const convertIt = NEVER_PLAYS.has(x.ext) && canConvert();
  return { id: x.id, src: `/api/media/local/stream?id=${encodeURIComponent(x.id)}${convertIt ? "&convert=1" : ""}`, title: x.title, artist: x.artist ?? "", album: x.album ?? "", kind: x.kind, duration: x.duration ?? null,
    source: "local", where: x.folder, converted: convertIt || undefined, canConvert: canConvert() || undefined, ext: x.ext };
}
// the one waiting for a "yes" / "open it in the default app" (after "that format can't play here")
let pendingOpen = null;
export const pending = () => (pendingOpen && Date.now() - pendingOpen.at < 3 * 60_000 ? pendingOpen : null);
export function clearPending() { pendingOpen = null; }

// play(items, { index, shuffle, repeat, via }) → { cmd, reply } or { unplayable, reply } / { error }
export function play(list, { index = 0, shuffle = false, repeat = "off", via = "voice", only = null } = {}) {
  let items = (list ?? []).filter(Boolean);
  if (!items.length) return { error: "There's nothing to play." };
  const pol = media.policyNow();
  if (items.some((x) => x.kind === "video") && !pol.videosAllowed) {
    const audio = items.filter((x) => x.kind === "audio");
    if (!audio.length) return { error: `No videos right now. ${pol.reason}` };
    items = audio;
  }
  // local files: still allowed right now? (the stream route checks again when each one plays)
  const kept = [], refused = [];
  for (const x of items) {
    if (x.source === "drive") { kept.push(x); continue; }
    const k = permissions.check("read", x.path);
    if (k.ok) kept.push(x); else { refused.push(x); activity.log("blocked", { path: x.path, reason: k.reason, text: k.text, via: "media_library" }); }
  }
  if (!kept.length) return { error: refused.length ? permissions.check("read", refused[0].path).text : "There's nothing to play." };
  // formats the screen can't play and nothing here can convert
  const playable = kept.filter((x) => x.source === "drive" || !NEVER_PLAYS.has(x.ext) || canConvert());
  if (!playable.length) {
    const x = kept[0];
    pendingOpen = { at: Date.now(), item: x };
    return { unplayable: true, item: x, reply: `${say(x)} is a ${x.ext.toUpperCase()} file, which the Dayspring screen can't play. Want me to open it in your default player on this PC?` };
  }
  const queue = playable.map(entry);
  let i = Math.max(0, Math.min(queue.length - 1, Number(index) || 0));
  const cmd = { action: "play", provider: "local", queue, index: i, shuffle: Boolean(shuffle), repeat: ["off", "all", "one"].includes(repeat) ? repeat : "off", only: only ?? undefined, at: new Date().toISOString() };
  broadcast("media", cmd);
  const first = playable[i];
  try { media.noteNowPlaying?.({ provider: first.source === "drive" ? "drive" : "local", title: first.title, artist: first.artist ?? "" }); } catch { /* not important */ }
  logPlay(first, via);
  const skipped = kept.length - playable.length;
  const reply = queue.length === 1
    ? `Playing ${say(first)}${first.source === "drive" ? ` from ${first.drive}'s Drive` : ""}.${queue[0].converted ? ` It's a ${first.ext.toUpperCase()} file, so I'm converting it as it plays. Say "open it in the default app" to use your usual player instead.` : ""}`
    : `${shuffle ? "Shuffling" : "Playing"} ${queue.length} ${first.kind === "video" && playable.every((x) => x.kind === "video") ? "videos" : "songs"}, starting with ${say(first)}.`;
  return { cmd, reply: reply + (skipped ? ` (${skipped} ${skipped === 1 ? "file is in a format" : "files are in formats"} the screen can't play, so I left ${skipped === 1 ? "it" : "them"} out.)` : "") + (refused.length ? ` ${refused.length} file${refused.length === 1 ? " is" : "s are"} somewhere I'm not allowed to look anymore.` : "") };
}
// the screen tells us when it moves on to the next one (for the log and "what's playing")
export function played(id, via = "screen") {
  const x = library.byId(id);
  if (!x) return false;
  logPlay(x, via);
  try { media.noteNowPlaying?.({ provider: "local", title: x.title, artist: x.artist ?? "" }); } catch { /* not important */ }
  return true;
}
function logPlay(x, via) {
  if (x.source === "drive") activity.log("media.play", { source: "drive", drive: x.accountLabel ?? x.drive, file: x.name ?? x.title, via });
  else activity.log("media.play", { source: "local", path: x.path, via });
}

// ---- "play it on this PC" -------------------------------------------------------------------------------------------------
// openDefault(item, { confirm_token, owner }) → { opened } | { needsConfirm, confirm_token, text } | { denied, text }
export function openDefault(x, { confirm_token = null, owner = false, via = "voice" } = {}) {
  if (!x) return { error: "Which file?" };
  if (x.source === "drive") return { error: `That one is in ${x.drive}'s Google Drive, not on this computer. I can play it on the screen, or download it to a folder first.` };
  const pc = permissions.check("programs");
  if (!pc.ok) { activity.log("blocked", { reason: "programs", action: "open", path: x.path, text: pc.text }); return { denied: true, text: `Opening it in another app means starting a program, and I don't have permission to open programs. You can turn that on in Settings → Permissions.` }; }
  const k = permissions.check("read", x.path);
  if (!k.ok) { activity.log("blocked", { reason: k.reason, action: "open", path: x.path, text: k.text }); return { denied: true, text: k.text }; }
  if (pc.ask && !owner) {
    const op = { tool: "media_open_default", path: k.real.toLowerCase() };
    const ok = confirm_token && confirm.consume(confirm_token, op).ok;
    if (!ok) { const text = `Open ${say(x)} in your default player on this PC? Should I go ahead?`; pendingOpen = { at: Date.now(), item: x, asked: true }; return { needsConfirm: true, confirm_token: confirm.issue(op, { text, what: `open ${basename(x.path)}` }), text }; }
  }
  pendingOpen = null;
  const dry = process.env.DAYSPRING_NO_BROWSER === "1" || process.env.DAYSPRING_NO_OPEN === "1";
  if (!dry) spawn("explorer.exe", [k.real], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  activity.log("program", { action: "open", app: "default", path: k.real, via, dryRun: dry || undefined, result: "ok" });
  return { opened: basename(k.real), dryRun: dry || undefined };
}
