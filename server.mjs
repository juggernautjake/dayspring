// Dayspring's server: one local Node process (127.0.0.1:4747) that serves the pages, the /api routes, live updates
// (Server-Sent Events at /api/events), the schedule announcer and the assistant. Data lives in data/, keys in .env.
//   npm install --omit=dev
//   npm start                → http://localhost:4747   (first run: http://localhost:4747/welcome)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, writeFileSync, unlinkSync, readFileSync as readFileNow } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import * as store from "./lib/store.mjs";
import * as planner from "./lib/planner.mjs";
import { chat, hasKey, modelName } from "./lib/assistant.mjs";
import * as tw from "./lib/twilio.mjs";
import * as notify from "./lib/notify.mjs";
import * as voice from "./lib/voice.mjs";
import * as announcer from "./lib/announcer.mjs";
import * as learning from "./lib/learning.mjs";
import * as files from "./lib/files.mjs";
import * as media from "./lib/media.mjs";
import * as knowledge from "./lib/knowledge.mjs";
import * as browser from "./lib/browser.mjs";
import * as settings from "./lib/settings.mjs";
import * as session from "./lib/session.mjs";
import { createSplitter } from "./lib/calls/sentences.mjs";   // the Dayspring screen's answer, sentence by sentence
import * as transcripts from "./lib/transcripts.mjs";
import * as morning from "./lib/morning.mjs";
import { setBitRate } from "./lib/phrases.mjs";
import * as mixer from "./lib/voicemeeter.mjs";
import * as special from "./lib/special.mjs";
import * as showcase from "./lib/showcase.mjs";
import * as photos from "./lib/photos.mjs";
import * as bible from "./lib/bible.mjs";
import * as church from "./lib/church.mjs";
import * as memorize from "./lib/memorize.mjs";
import * as phonenotify from "./lib/phonenotify.mjs";
import * as coder from "./lib/coder.mjs";
import * as devlog from "./lib/devlog.mjs";
import * as devices from "./lib/devices.mjs";
import { offerRestart } from "./lib/voiceskills.mjs";
import * as owner from "./lib/owner.mjs";
import * as firstrun from "./lib/firstrun.mjs";
import * as setupRoutes from "./lib/setup-routes.mjs";
import * as ollamaRoutes from "./lib/ollama/routes.mjs";   // Settings → AI brain → Ollama, and the quick AI switch
import * as updateRoutes from "./lib/update-routes.mjs";
import * as helpRoutes from "./lib/help-routes.mjs";
import * as updater from "./lib/updater.mjs";
import * as permissions from "./lib/permissions.mjs";
import * as discordRoutes from "./lib/discord-routes.mjs";
import * as callRoutes from "./lib/call-routes.mjs";
import * as callsRoutes from "./lib/calls-routes.mjs";   // Settings → Calls: call apps, latency, the Discord chat companion
import * as meetRoutes from "./lib/meet-routes.mjs";   // meetings: Dayspring and Lantern in a Google Meet call (lib/meet)
import * as studyRoutes from "./lib/study-routes.mjs";
import * as playerRoutes from "./lib/player-routes.mjs";
import * as ambientRoutes from "./lib/ambient-routes.mjs";
import * as ambient from "./lib/ambient.mjs";
import * as keepawake from "./lib/keepawake.mjs";
import * as snooze from "./lib/snooze.mjs";
import * as windowRoutes from "./lib/window-routes.mjs";
import * as winman from "./lib/winman.mjs";   // the windows on the Dayspring screens by voice: "minimize the map", "hide everything"
import * as display from "./lib/display.mjs";
import * as quiet from "./lib/quiet.mjs";
import { release as osRelease } from "node:os";
import * as aboutRoutes from "./lib/about-routes.mjs";
import * as overlay from "./lib/overlay.mjs";
import { claim as claimSpeaker, addHello } from "./lib/bus.mjs";
import * as screenlog from "./lib/screenlog.mjs";
import * as documentRoutes from "./lib/document-routes.mjs";
import * as connectorRoutes from "./lib/connector-routes.mjs";
import * as connectors from "./lib/connectors/index.mjs";
import * as calendarRoutes from "./lib/calendar-routes.mjs";
import * as fsRoutes from "./lib/fs-routes.mjs";
import * as toolingRoutes from "./lib/tooling-routes.mjs";
import * as welcomeRoutes from "./lib/welcome-routes.mjs";
import * as activityRoutes from "./lib/activity-routes.mjs";   // Settings → Activity log
import * as moneyRoutes from "./lib/money-routes.mjs";   // Money review (read-only): /money.html and /api/money (lib/money)
import { usedSince as moneyUsedSince } from "./lib/money/index.mjs";   // (money answers are never kept in transcripts)
import * as discoverRoutes from "./lib/discover-routes.mjs";
import * as discover from "./lib/discover.mjs";
import * as tunein from "./lib/tunein.mjs";
import * as callbridge from "./lib/callbridge.mjs";
import * as stt from "./lib/stt.mjs";
import * as lantern from "./lib/lantern.mjs";
import * as lanternRoutes from "./lib/lantern-routes.mjs";
import * as intentRoutes from "./lib/intent-routes.mjs";
import * as xpRoutes from "./lib/xp-routes.mjs";   // XP: earned by checking in on real tasks (lib/xp)
import * as personaRoutes from "./lib/persona-routes.mjs";   // Settings → Personality (lib/persona)
import * as namingRoutes from "./lib/naming-routes.mjs";   // Settings → Your assistant: its name, how it's said, the wake words, training (lib/naming.mjs)
import * as wakeword from "./lib/wakeword.mjs";   // the wake words, heard the same way everywhere (public/wakeword.js)
import * as namingCmd from "./lib/commands/naming.mjs";   // "your name is Nova", "answer to Jarvis": before the other quick commands
import * as timers from "./lib/timers.mjs";
import * as recipes from "./lib/recipes.mjs";
import * as intents from "./lib/intents/index.mjs";
import * as web from "./lib/web.mjs";
import * as imageRoutes from "./lib/image-routes.mjs";   // pictures from the web on the screen (lib/imagesearch)
import * as gifRoutes from "./lib/gifs/routes.mjs";   // GIFs from GIPHY, KLIPY, Imgur and the web, and the GIF picker (lib/gifs)
import * as socialRoutes from "./lib/social/index.mjs";   // sharing with friends: OFF (hidden dev switch social.enabled); inert when off (lib/social)
import * as visionRoutes from "./lib/vision-routes.mjs";   // Settings → Photos & people, the People page (lib/vision, lib/people)
import * as floorRoutes from "./lib/floor-routes.mjs";
import * as devRoutes from "./lib/dev/routes.mjs";   // the developer preview: 404 unless this is the developer's own computer (lib/dev)   // the conversation floor: the owner's requests before anything planned (lib/floor.mjs)
import * as floor from "./lib/floor.mjs";
import * as vision from "./lib/vision/index.mjs";
import * as videoRoutes from "./lib/video/routes.mjs";   // finding videos, creators' channels, his YouTube playlists, the video queue (lib/video)
import * as video from "./lib/video/index.mjs";
import * as shopRoutes from "./lib/shopping/routes.mjs";   // Shopping on Amazon: the Shopping panel and Settings → Shopping (lib/shopping)
import * as mbRoutes from "./lib/mediabrowser/routes.mjs";   // the Music & Video browser, and signing in to YouTube / Spotify in the media window
import * as mbrowser from "./lib/mediabrowser/index.mjs";
import * as mediasignin from "./lib/mediasignin.mjs";
import * as medialibRoutes from "./lib/medialib/routes.mjs";   // the owner's own music and videos, and Google Drive streaming (lib/medialib)
import * as viewerRoutes from "./lib/finder/routes.mjs";   // finding files by name, and the file viewer (lib/finder, public/viewer.js)
import * as galleryRoutes from "./lib/gallery/routes.mjs";   // the photo gallery (lib/gallery, public/gallery.js)
import * as peopleComms from "./lib/people/comms.mjs";
import * as mailRoutes from "./lib/mail/routes.mjs";   // email: every mailbox, the Mail window, the editor, Settings → Email (lib/mail)
import * as features from "./lib/features.mjs";   // release channels and feature stages: features.on(id) gates routes, pages, jobs
import * as featureRoutes from "./lib/feature-routes.mjs";   // /api/features, /api/compat, /api/testing
import * as cameraRoutes from "./lib/cameras/routes.mjs";   // cameras: webcams, IP/security, GoPro, trail cams; monitor, alerts, recordings (lib/cameras)
import * as remoteRoutes from "./lib/remote/routes.mjs";   // Settings → Devices & sign-in: his Dayspring computers linked securely (lib/remote; feature "remote")
import * as remote from "./lib/remote/index.mjs";
import * as smarthomeRoutes from "./lib/devices/routes.mjs";   // smart plugs, strips, lights, scenes and schedules: /api/smarthome (lib/devices; feature "devices")
import * as printerRoutes from "./lib/printers/routes.mjs";   // 3D printers (Bambu LAN, Ender over USB, OctoPrint, Klipper): /api/printers (lib/printers; feature "printers")
import * as looksRoutes from "./lib/looks/routes.mjs";   // Settings → Look & feel: colour themes, avatars, expression mode (lib/looks; features "themes", "avatar")
import * as mapsRoutes from "./lib/maps/routes.mjs";   // Maps: the map panel, search, directions and spoken steps: /api/maps (lib/maps; feature "maps")
import * as maps from "./lib/maps/index.mjs";
// A fresh install: create the data folder and any missing data files (empty, nothing personal) before anything runs.
firstrun.ensure();
// What each newly connected page is told first: who has the microphone and the listening state (so a page opened while
// Lantern listens doesn't listen too), and any one-time notices (e.g. a damaged file that was restored from a backup).
addHello("micOwner", () => lantern.micOwner());
addHello("listenState", () => settings.get().listenState ?? "active");
addHello("notices", () => firstrun.notices());
// The Settings/setup wizard, updates and the in-app guide each answer their own /api routes.
const ROUTES = [featureRoutes, ollamaRoutes, setupRoutes, updateRoutes, helpRoutes, discordRoutes, callRoutes, callsRoutes, meetRoutes, studyRoutes, playerRoutes, ambientRoutes, windowRoutes, winman, documentRoutes, connectorRoutes, fsRoutes, toolingRoutes, welcomeRoutes, discoverRoutes, calendarRoutes, lanternRoutes, aboutRoutes, intentRoutes, personaRoutes, xpRoutes, imageRoutes, activityRoutes, moneyRoutes, visionRoutes, socialRoutes, floorRoutes, devRoutes, mbRoutes, videoRoutes, medialibRoutes, viewerRoutes, galleryRoutes, gifRoutes, mailRoutes, cameraRoutes, remoteRoutes, smarthomeRoutes, printerRoutes, looksRoutes, mapsRoutes, namingRoutes, shopRoutes];
// Maps: the panel's "maps" event, spoken steps through the floor, home from Settings → Where you are (no GPS here), his phone
maps.start({ broadcast: (t, d) => announcer.broadcast(t, d), announce: (x) => announcer.announce(x), home: () => owner.get().location, notify: (msg) => remote.notify("all", msg) });
imageRoutes.setDeps({ openUrl: async (u) => (await import("./lib/browsers.mjs")).openUrl(u, owner.displayBrowser()) });
gifRoutes.setDeps({ openUrl: async (u) => (await import("./lib/browsers.mjs")).openUrl(u, owner.displayBrowser()) });
// 🎧 Tune in: what it hears addressed to Dayspring goes through the same assistant
tunein.setChat(chat);
// DAYSPRING_DISPLAY=1: this computer shows the Dayspring screen (any screen: a TV, a monitor…), so it keeps it open and
// watches for texts. DAYSPRING_TV=1 is the older name and still works.
const DISPLAY_MODE = process.env.DAYSPRING_DISPLAY === "1" || process.env.DAYSPRING_TV === "1";
// A new id every start: the Dayspring screen reloads itself when it sees a new one (so new code shows up after a restart).
const BUILD = String(Date.now());
// Restart the server in place (after an update, or after Claude Code changed Dayspring): scripts/launch.mjs waits for this
// server to stop, then starts the new one hidden (no command window). verify: after an update, the launcher puts the old
// version back if the new one doesn't start. The console window an older launcher left ("Dayspring server") closes too.
let restarting = false;
function restartSelf({ verify = false } = {}) {
  if (restarting) return;
  restarting = true;
  const desk = dirname(fileURLToPath(import.meta.url));
  const parentIsLauncherConsole = (() => {
    try { return /^"cmd\.exe"/i.test((spawnSync("tasklist", ["/fi", `PID eq ${process.ppid}`, "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).stdout ?? "").trim()) && process.stdout.isTTY && DISPLAY_MODE; } catch { return false; }
  })();
  const args = [join(desk, "scripts", "launch.mjs"), "--restart", "--wait-pid", String(process.pid), ...(verify ? ["--verify"] : []), ...(parentIsLauncherConsole ? ["--close-console", String(process.ppid)] : [])];
  spawn(process.execPath, args, { cwd: desk, detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, DAYSPRING_DISPLAY: DISPLAY_MODE ? "1" : "" } }).unref();
  console.log("restarting…");
  // the media window (Playwright) and the call mixer are closed first, so the new server can open them again
  setTimeout(async () => { await Promise.race([(async () => { try { await browser.close(); } catch { /* none */ } try { mixer.stop(); } catch { /* none */ } })(), new Promise((r) => setTimeout(r, 3000))]); process.exit(0); }, 300);
}
// Servers started by Dayspring 1.0.0's launcher or updater live in a visible (minimized) command window. Move to the
// hidden way once: a hidden copy starts as soon as this one stops, and that window closes. (Not the TV launcher's, and not
// a terminal someone ran "npm start" in: those don't set DAYSPRING_DISPLAY.)
// The morning alarm is close (from 45 minutes before the day's first block until half an hour after): no updates then.
function alarmSoon() {
  if (!settings.get().alarm) return false;
  const today = store.todayISO(), first = store.blocksBetween(today, today).filter((b) => !b.done).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (!first || first.start >= "12:00") return false;
  const [h, m] = first.start.split(":").map(Number), at = new Date(); at.setHours(h, m, 0, 0);
  const d = (Date.now() - at.getTime()) / 60_000;
  return d > -45 && d < 30;
}
// Shortcuts made by Dayspring 1.0.0 open "Start Dayspring.cmd" (a command window). Point them at the windowless starter.
let shortcutsFixed = false;
function fixShortcuts() {
  if (shortcutsFixed) return; shortcutsFixed = true;
  const vbs = join(here, "Start Dayspring.vbs");
  if (!existsSync(vbs)) return;
  const script = `$ErrorActionPreference='SilentlyContinue'; $w = New-Object -ComObject WScript.Shell; $vbs = $env:DS_VBS; $here = Split-Path $vbs;
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Dayspring'), [Environment]::GetFolderPath('Startup'))) {
  Get-ChildItem -LiteralPath $dir -Filter '*.lnk' | ForEach-Object { $s = $w.CreateShortcut($_.FullName);
    if ($s.TargetPath -and ($s.TargetPath -ieq (Join-Path $here 'Start Dayspring.cmd'))) { $s.TargetPath = (Join-Path $env:SystemRoot 'System32\\wscript.exe'); $s.Arguments = '"' + $vbs + '"'; $s.WindowStyle = 1; $s.Save(); 'fixed ' + $_.Name } } }`;
  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, DS_VBS: vbs } })
    .stdout.on("data", (d) => { const t = String(d).trim(); if (t) console.log(`shortcuts: ${t.replace(/\r?\n/g, ", ")}`); });
}
const LEGACY_CONSOLE = process.platform === "win32" && process.stdout.isTTY && process.env.DAYSPRING_DISPLAY === "1" && process.env.DAYSPRING_TV !== "1" && !process.env.DAYSPRING_KEEP_CONSOLE;
// Claude Code's progress shows on the Dayspring screen; when it's done, Dayspring says what changed and offers a restart.
coder.onEvent((e) => {
  if (e.kind === "progress" || e.kind === "started") announcer.broadcast("coder", e);
  if (e.kind === "done") {
    announcer.broadcast("coder", e);
    announcer.announce({ kind: "coder", text: e.ok && e.edited ? `${e.text} Want me to restart Dayspring so the changes show up?` : e.text });
    if (e.ok && e.edited) offerRestart();
  }
});
let photoOnScreen = null;   // the photo the Dayspring screen is showing right now
import { readFileSync as readSync, existsSync as fileExists } from "node:fs";
import { basename } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, "public");
const PORT = Number(process.env.PORT) || 4747;
const TUNNEL = process.argv.includes("--tunnel");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon", ".wasm": "application/wasm" };

// In-memory conversations, one per surface (desk panel, Dayspring screen). Restarting starts fresh; the schedule persists.
const histories = { desk: [], tv: [] };
// one conversation turn at a time per surface: a second question waits for the first, so neither answer overwrites the
// other's history (the screen drops a reply it no longer wants)
const chatLocks = { desk: Promise.resolve(), tv: Promise.resolve() };
let lastChatAt = 0;

// Everything the Dayspring screen says on its own (check-ins, alarms, Claude Code alerts) goes into its
// conversation too, so "it went fine" or "yes, I'm ready" is understood as an answer to it.
function rememberSpoken(eventText, spoken) {
  const h = histories.tv;
  h.push({ role: "user", content: `[Dayspring event, not ${owner.name()} speaking: ${eventText}]` }, { role: "assistant", content: spoken });
  if (h.length > 24) h.splice(0, h.length - 24);
}
announcer.setEventHook((item) => {
  const what = item.kind === "checkin" ? `"${item.ended?.title}" just ended${item.started ? ` and "${item.started.title}" starts now` : ""}; you asked how it went.`
    : item.kind === "text" ? `a text message from ${item.from ?? "someone"} arrived on ${owner.name()}'s phone (through Phone Link) and you asked whether to read it aloud. If ${owner.they()} says yes or asks what it says, call read_texts and read it.`
    : item.kind === "reminder" ? `a reminder went off: ${item.reminder?.text ?? item.text}`
    : item.alarm || item.kind === "alarm" || item.kind === "morning" ? `the morning alarm${item.started?.title ? ` for "${item.started.title}"` : ""}.`
    : item.started?.title ? `"${item.started.title}" starts now.` : `you announced: ${item.text}`;
  rememberSpoken(`${item.hm} — ${what}`, item.text);
  // A check-in opens the between-blocks conversation; any other moment ends one that was left hanging.
  if (item.kind === "checkin") session.open(item);
  else if (["start", "alarm", "morning"].includes(item.kind) && session.current()) session.close(false);
  transcripts.log({ role: "event", text: item.text, kind: item.kind, surface: "tv" });
  screenlog.shown({ kind: "announce", view: item.kind, title: item.kind === "text" ? `Text from ${item.from ?? "someone"}` : item.kind === "reminder" ? "Reminder" : item.started?.title ?? item.kind, text: item.text });
});

let lastNow = "";
// When the outputs change, Spotify (in the media browser) follows.
setBitRate(settings.get().convMode === "serious" ? 0 : 0.35);
settings.onChange((s) => setBitRate(s.convMode === "serious" ? 0 : 0.35));
// With the Voicemeeter mixer on, Spotify plays on the Windows default (Voicemeeter), which the mixer sends where the owner picked.
const spotifyRoles = (s) => (mixer.isActive() ? ["voicemeeter"] : s.audioOutputs);
settings.onChange((s, patch) => {
  if (patch.mixer === true) mixer.start(s.audioOutputs, { enabled: true }).then((r) => { console.log(`mixer: ${r.active ? "on" : r.note}`); if (browser.isOpen()) browser.spotifySink(spotifyRoles(s)); }).catch(() => {});
  else if (patch.mixer === false) { mixer.stop(); console.log("mixer: off"); if (browser.isOpen()) browser.spotifySink(s.audioOutputs).catch(() => {}); }
  else if (patch.audioOutputs && mixer.isActive()) mixer.route(s.audioOutputs).catch((e) => console.log(`mixer: ${e.message}`));
  // "turn the music down": Spotify glides to the new level (YouTube follows on the TV)
  if ((patch.musicVolume !== undefined || patch.musicVolumeDelta !== undefined) && browser.isOpen()) browser.spotifyFade((s.musicVolume ?? 100) / 100, 800).catch(() => {});
});
settings.onChange((s, patch) => { if (patch.audioOutputs && browser.isOpen() && !mixer.isActive()) browser.spotifySink(spotifyRoles(s)).then((l) => l && console.log(`spotify output → ${l}`)).catch(() => {}); });
// "silent for an hour" (and a two-hour conversation mode) end on the minute even if nobody asks: the screen is told
settings.onChange((s, patch) => { if (patch?.expired) announcer.broadcast("settings", s); });
setInterval(() => { try { settings.get(); } catch { /* next minute */ } }, 60_000).unref?.();
// Something unexpected (a network hiccup in a callback, a bug in one feature) is written down and Dayspring keeps going,
// instead of the whole server stopping and the screen going quiet.
process.on("unhandledRejection", (e) => { console.error("unexpected (kept running):", e?.stack ?? e); try { devlog.log("error", { where: "unhandledRejection", error: String(e?.message ?? e).slice(0, 500) }); } catch { /* logging only */ } });
process.on("uncaughtException", (e) => { console.error("unexpected (kept running):", e?.stack ?? e); try { devlog.log("error", { where: "uncaughtException", error: String(e?.message ?? e).slice(0, 500) }); } catch { /* logging only */ } if (e?.code === "EADDRINUSE") process.exit(0); });
// SIGHUP is Windows closing the server's window: put the old Windows audio output back on the way out.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, async () => { mixer.stop(); await browser.close(); process.exit(0); });
process.on("exit", () => { if (mixer.isActive()) mixer.stop(); try { tunein.stop({ quiet: true, shutdown: true }); stt.stop(); } catch { /* already stopped */ } });

// Claude Code sessions report in through hooks/claude-event.mjs.
const claudeSeen = new Map();
function lastAssistantText(transcriptPath) {
  try {
    if (!transcriptPath || !fileExists(transcriptPath)) return "";
    const lines = readSync(transcriptPath, "utf8").trim().split("\n").slice(-40).reverse();
    for (const l of lines) {
      const j = JSON.parse(l);
      if (j.type !== "assistant") continue;
      const t = (j.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(" ").trim();
      if (t) return t.replace(/[#*`>|]/g, "").replace(/\s+/g, " ").slice(0, 400);
    }
  } catch { /* unreadable transcript */ }
  return "";
}
// A name people recognize: "desk" or "src" says nothing, so walk up past generic folder names ("…\dayspring\apps\desk" → "Dayspring").
const GENERIC_DIRS = new Set(["desk", "app", "apps", "src", "web", "site", "client", "server", "frontend", "backend", "packages", "lib", "code", "repo", "main", "api", "ui", "public", "scripts"]);
function projectName(cwd) {
  const parts = String(cwd || "").split(/[\\/]+/).filter(Boolean);
  const home = /^users$/i.test(parts[1] ?? "") ? 3 : 1;          // never climb into C:\Users\<name>
  for (let i = parts.length - 1; i >= home; i--) if (!GENERIC_DIRS.has(parts[i].toLowerCase())) return parts[i].replace(/^\d+-/, "").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  return "your computer";
}
// The gist of what Claude said last: its first sentence, if it's short enough to say out loud.
function gistOf(text) {
  const first = String(text || "").split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  return first.length >= 8 && first.length <= 110 ? first : "";
}
function claudeEvent(ev) {
  if (!settings.get().claudeAlerts) return null;
  const project = projectName(ev.cwd);
  const kind = ev.hook_event_name === "Notification" ? "waiting" : "finished";
  const key = `${ev.session_id}|${kind}`;
  if (Date.now() - (claudeSeen.get(key) ?? 0) < 20_000) return null;   // one alert per session per 20 s
  claudeSeen.set(key, Date.now());
  const summary = kind === "finished" ? lastAssistantText(ev.transcript_path) : String(ev.message ?? "");
  const quiet = media.policyNow().block?.category === "study" || media.policyNow().block?.category === "faith";
  const gist = gistOf(summary);
  // e.g. "Claude's all done with Dayspring. The pop-ups can be closed now." / "Claude needs a quick yes from you on Dayspring."
  const home = project === "your computer";
  const spoken = kind === "finished"
    ? `Claude's all done ${home ? "on your computer" : "with " + project}.${gist ? " " + gist : " It's ready for you to look over."}`
    : /permission/i.test(summary) ? `Claude needs a quick yes from you ${home ? "on your computer" : "on " + project}.` : `Claude's waiting on you ${home ? "on your computer" : "in " + project}.`;
  const item = { at: new Date().toISOString(), kind: "claude", event: kind, project, cwd: ev.cwd, text: spoken, summary: gist || summary.slice(0, 160), quiet };
  // waits while he's talking (lib/floor.mjs); the screen reports it done, or "called back" when he started talking as it
  // began (then it goes back in line and comes again, marked again: its card is already up)
  floor.offer(item, (it) => announcer.broadcast("claude", it), { refire: (it) => announcer.broadcast("claude", { ...it, again: true }) });
  rememberSpoken(`Claude Code ${kind} in ${ev.cwd}. ${summary ? "Its last words: " + summary.slice(0, 300) : ""}`, spoken);
  return item;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}
async function readJSON(req) {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
}

// ---- Twilio webhooks (public, signature-checked) ----
async function twilio(req, res, url) {
  const raw = await readBody(req);
  const params = Object.fromEntries(new URLSearchParams(raw));
  const base = tw.publicUrl();
  const fullUrl = `${base}${url.pathname}${url.search}`;
  if (!base || !tw.validSignature(fullUrl, params, req.headers["x-twilio-signature"])) {
    console.warn(`twilio: rejected ${url.pathname} (bad signature or PUBLIC_URL unset)`);
    res.writeHead(403); return res.end("forbidden");
  }
  let xml;
  if (url.pathname === "/twilio/voice") xml = await tw.handleVoiceStart(params);
  else if (url.pathname === "/twilio/voice/turn") xml = await tw.handleVoiceTurn(params);
  else if (url.pathname === "/twilio/sms") xml = await tw.handleSms(params);
  else { res.writeHead(404); return res.end(); }
  console.log(`twilio: ${url.pathname} from ${params.From ?? "?"}: "${(params.SpeechResult ?? params.Body ?? "").slice(0, 80)}"`);
  res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
  res.end(xml);
}

async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, "");
  const m = req.method;
  const q = url.searchParams;

  if (m !== "GET" && /^\/(chat|tts|blocks|routines|tasks|media|player|reader|documents|setup|welcome|study|snooze|voice|call|tunein)\b/.test(p)) updater.touch();
  // a feature that's off in this build (or switched off) has no routes: 404, as if it weren't there (its /…/enabled probe still answers)
  { const off = /\/enabled$/.test(p) ? null : features.routeBlocked(p); if (off) return send(res, 404, { error: `no route ${m} ${p}`, feature: off, off: true }); }
  for (const r of ROUTES) if (await r.handle(req, res, { m, p, q, send, readJSON, restart: restartSelf })) return;

  // ---- starting and stopping (scripts/launch.mjs, the window bar) ----
  // open: the guided setup until it's done (once), then the Dayspring screen (the open one comes back instead of a second)
  if (m === "POST" && p === "/app/open") {
    const b = await readJSON(req).catch(() => ({}));
    windowRoutes.clearClosed();
    if (!owner.setupDone()) return send(res, 200, { setup: true, ...(await display.openSetup({ connected: announcer.clientCount() })) });
    // openAs (window | compact | fullscreen | tab, or "full" = Expand from the mini) from a shortcut like "Dayspring in
    // browser" or the ⤢ / ⤡ buttons: open that way this time, moving an open screen there (never a second one)
    const openAs = (owner.OPEN_AS.includes(String(b.openAs ?? "")) && b.openAs !== "auto") || b.openAs === "full" ? b.openAs : undefined;
    return send(res, 200, await display.open({ screen: b.screen || undefined, openAs, switchTo: Boolean(openAs) }));
  }
  aboutRoutes.setQuit(() => { announcer.broadcast("window", { action: "quit" }); lantern.stopping(); setTimeout(async () => { try { await windowRoutes.windowAction("close"); } catch { /* no window */ } try { mixer.stop(); await browser.close(); } catch { /* fine */ } process.exit(0); }, 300); });
  if (m === "POST" && p === "/app/quit") {
    send(res, 200, { ok: true, text: "Dayspring is stopping." });
    announcer.broadcast("window", { action: "quit" });
    lantern.stopping();
    setTimeout(async () => { try { await windowRoutes.windowAction("close"); } catch { /* no window */ } try { mixer.stop(); await browser.close(); } catch { /* fine */ } process.exit(0); }, 400);
    return;
  }
  // ---- the Dayspring screen ----
  if (m === "GET" && p === "/events") {
    if (q.get("page") === "display") windowRoutes.clearClosed();      // a Dayspring screen is open again
    return announcer.addClient(res, { page: q.get("page") ?? "", id: q.get("id") ?? "" });
  }
  // "Reopen now in <browser>": the Dayspring screen closes and opens again the same way in the browser just chosen
  if (m === "POST" && p === "/app/reopen") { windowRoutes.clearClosed(); return send(res, 200, await display.open({ openAs: display.openedAs() ?? undefined, switchTo: true, reopen: true })); }
  // Speech to text for the Dayspring screen when the browser can't do it (Brave, Firefox) or the owner chose "on this
  // computer": 16 kHz mono 16-bit PCM in the body; ?purpose=wake (fast model) | request (accurate). Nothing is kept.
  if (m === "POST" && p === "/stt") {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 1_500_000) return send(res, 413, { error: "That's too long to transcribe in one go." }); chunks.push(c); }
    const pcm = Buffer.concat(chunks);
    if (pcm.length < 3200) return send(res, 200, { text: "" });
    const r = stt.ready();
    if (!r.ok) return send(res, 503, { needsInstall: true, why: r.why, installing: sttJob.running });
    const wake = q.get("purpose") !== "request";
    // (the wake words written into a sentence: whisper then spells a made-up word like "Computa" the owner's way)
    try { const t = await stt.transcribe(pcm, { speed: wake ? "fast" : "accurate", prompt: wake ? wakeword.hint() : "" }); return send(res, 200, { text: t.text, ms: t.ms }); }
    catch (e) { return send(res, e.status ?? 500, { error: e.message }); }
  }
  if (m === "GET" && p === "/stt/status") return send(res, 200, { ...stt.ready(), installing: sttJob.running, error: sttJob.error, engine: settings.get().speechEngine ?? "auto" });
  if (m === "POST" && p === "/stt/install") {
    if (!sttJob.running) { sttJob.running = true; sttJob.error = null; stt.install().then(() => { sttJob.running = false; announcer.broadcast("stt", { ready: true }); }).catch((e) => { sttJob.running = false; sttJob.error = e.message; announcer.broadcast("stt", { ready: false, error: e.message }); }); }
    return send(res, 200, { installing: true });
  }
  // the window the owner just opened on purpose (mini ⇄ full) takes over speaking and listening
  if (m === "POST" && p === "/speaker/claim") { const b = await readJSON(req).catch(() => ({})); return send(res, 200, { ok: claimSpeaker(String(b.id ?? "")) }); }
  // Active / Quiet / Off
  if (m === "GET" && p === "/listen") return send(res, 200, { state: quiet.state(), label: quiet.label(), alarmsWhenOff: settings.get().alarmsWhenOff !== false, overlayWhenOff: settings.get().overlayWhenOff !== false });
  if (m === "POST" && p === "/listen") { const b = await readJSON(req).catch(() => ({})); try { return send(res, 200, await quiet.setState(String(b.state ?? ""), { from: b.from ?? "button" })); } catch (e) { return send(res, 400, { error: e.message }); } }
  // desktop notifications (top-right, in front of every window)
  if (m === "GET" && p === "/overlay") return send(res, 200, overlay.status());
  if (m === "GET" && p === "/overlay/helper") return send(res, 200, await overlay.helperStatus());
  // the alarm was answered on a Dayspring screen: the desktop helper stops ringing too (and the other way round)
  // `from` is the page's own id (so every OTHER Dayspring page stops ringing too), "overlay" or "screen" (older pages)
  if (m === "POST" && p === "/alarm/dismissed") { const b = await readJSON(req).catch(() => ({})); announcer.broadcast("alarm-dismissed", { from: String(b.from ?? "screen").slice(0, 64), snoozed: Boolean(b.snoozed), at: Date.now() }); return send(res, 200, { ok: true }); }
  if (m === "GET" && p === "/notices") return send(res, 200, { notices: firstrun.notices() });
  // tests only (DAYSPRING_TEST_HOOKS=1): announce something now, as the schedule would
  if (m === "POST" && p === "/test/overlay" && process.env.DAYSPRING_TEST_HOOKS === "1") { const b = await readJSON(req).catch(() => ({})); if (b.type === "alarm-stop" && !b.id) b.id = overlay._ringing()?.id; return send(res, 200, { sent: overlay._send(b) }); }
  if (m === "POST" && p === "/test/announce" && process.env.DAYSPRING_TEST_HOOKS === "1") { const b = await readJSON(req).catch(() => ({})); return send(res, 200, { item: announcer.announce(b) }); }
  if (m === "POST" && p === "/overlay/test") {
    const st = await overlay.start({ onAction: overlayAction });
    const ok = overlay.show({ title: "Dayspring", text: "This is how desktop notifications look. They sit in front of every window and go away on their own.", kind: "schedule", snooze: false });
    return send(res, 200, { ...st, sent: ok });
  }
  if ((m === "POST" || m === "GET") && p === "/tts") {
    const b = m === "GET" ? { text: q.get("text"), speed: q.get("speed"), tone: q.get("tone"), voice: q.get("voice") } : await readJSON(req);
    const text = b.text;
    if (!String(text ?? "").trim()) return send(res, 400, { error: "text is required" });
    // 🎧 Tune in must not hear Dayspring's own voice coming back through the headset as if a friend said it
    tunein.noteSaid(String(text)); tunein.speaking(true, 2500 + String(text).length * 70);
    let audio;
    try { audio = await voice.tts(String(text), { speed: b.speed ? Number(b.speed) : undefined, tone: b.tone || undefined, voice: b.voice || undefined }); }
    catch (e) { if (e.status === 204) { res.writeHead(204, { "x-voice": "browser" }); return res.end(); } throw e; }   // free voices: the screen speaks by itself
    res.writeHead(200, { "content-type": "audio/mpeg", "content-length": audio.length, "cache-control": "no-store" });
    return res.end(audio);
  }
  if (m === "GET" && p === "/voices") {
    const provider = voice.ttsProvider();
    if (provider === "elevenlabs") await voice.loadLibrary();
    return send(res, 200, { provider, voices: voice.voiceChoices(), describe: voice.describeFor(provider), current: voice.voiceReady(),
      chosen: provider === "browser" ? settings.get().browserVoice ?? null : provider === "openai" ? settings.get().openaiVoice ?? "nova" : settings.get().voice ?? null });
  }
  if (m === "POST" && p === "/voice") { const { id } = await readJSON(req); return send(res, 200, voice.setVoice(id)); }
  if (m === "GET" && p === "/tv/config") {
    // wake words from Settings → Your assistant (DAYSPRING_WAKE_PHRASES in an older .env only adds to them)
    // (wake: everything public/wakeword.js needs to hear them the way the server does: lib/wakeword.mjs)
    const wake = wakeword.clientConfig();
    const phrases = wake.words.map((w) => w.text);
    // the owner's device type hints (data/devices.json "typeHints"), so the screen sorts their speakers and headsets right
    let typeHints = {};
    try { typeHints = JSON.parse(readSync(join(here, "data", "devices.json"), "utf8")).typeHints ?? {}; } catch { /* none */ }
    return send(res, 200, { wakePhrases: phrases, wake, voice: voice.voiceReady(), hasKey: hasKey(), model: modelName(), notes: files.NOTES(), fileRoot: files.ROOT(), setupDone: owner.setupDone(), ownerName: owner.get().name, assistantName: owner.assistant(), typeHints, features: owner.get().features });
  }
  if (m === "GET" && p === "/learning") return send(res, 200, learning.progress());
  if (m === "GET" && p === "/history") {
    const qq = q.get("q");
    return send(res, 200, qq ? { results: transcripts.search(qq, { from: q.get("from") || undefined, to: q.get("to") || undefined, limit: 30 }) } : { conversations: transcripts.list({ from: q.get("from") || undefined, to: q.get("to") || undefined, limit: 100 }) });
  }
  const hm = p.match(/^\/history\/([\w-]+)$/);
  if (hm && m === "GET") return send(res, 200, transcripts.conversation(hm[1]));
  if (m === "GET" && p === "/devotion") return send(res, 200, { devotion: morning.devotion(), today: morning.today() });
  if (m === "GET" && p === "/rundown") return send(res, 200, { text: await morning.rundown() });
  if (m === "POST" && p === "/claude-event") return send(res, 200, { alerted: claudeEvent(await readJSON(req)) });
  if (m === "POST" && p === "/media/played") { media.recordPlayed(await readJSON(req)); return send(res, 200, { ok: true }); }
  if (m === "POST" && p === "/media/play") {
    // { link | videoId | playlistId, title?, audioOnly?, shuffle? } — the study rule still applies
    const b = await readJSON(req);
    const ids = media.parseYouTube(b.link);
    const cmd = media.playCommand({ videoId: b.videoId ?? ids.videoId, playlistId: b.playlistId ?? ids.playlistId, title: b.title, audioOnly: b.audioOnly, shuffle: b.shuffle });
    announcer.broadcast("media", cmd);
    return send(res, 200, { playing: cmd });
  }
  if (m === "POST" && p === "/media/stop") { const r = await media.stopAll(); announcer.broadcast("media", { action: "stop" }); lastNow = ""; announcer.broadcast("nowplaying", { playing: false }); return send(res, 200, { stopped: r }); }
  // Pop a video out into the person's own browser (their choice, a normal window), at the second it was on.
  // Only ever on request: the Pop out button, "pop it out", or the card for a video that can't be embedded.
  // /media/fallback is the old name (older screens): it does the same thing, and never plays in a hidden window.
  if (m === "POST" && (p === "/media/popout" || p === "/media/fallback")) {
    const b = await readJSON(req);
    const vid = /^[\w-]{11}$/.test(b.videoId ?? "") ? b.videoId : null, list = /^[\w-]{10,64}$/.test(b.playlistId ?? "") ? b.playlistId : null;
    if (!vid && !list) return send(res, 400, { opened: false, error: "There's no video to pop out." });
    const t = Math.max(0, Math.floor(Number(b.t) || 0));
    const url = vid ? `https://www.youtube.com/watch?v=${vid}${list ? `&list=${list}` : ""}${t ? `&t=${t}s` : ""}` : `https://www.youtube.com/playlist?list=${list}`;
    try { return send(res, 200, await (await import("./lib/browsers.mjs")).openUrl(url, owner.displayBrowser())); }
    catch (e) { return send(res, 200, { opened: false, url, error: `I couldn't open your browser (${e.message}).` }); }
  }
  // The morning wake song, started when the TV's alarm goes off. Spotify (the curated track) first; YouTube if Spotify can't.
  if (m === "POST" && p === "/morning/music") {
    const s = morning.today().song;
    if (!s) return send(res, 200, { provider: null });
    const q = typeof s === "string" ? s : `${s.title} ${s.artist ?? ""}`.trim();
    if (s.url) {
      try {
        const r = await media.spotify({ url: s.url, query: q, type: "track" });
        announcer.broadcast("nowplaying", { source: "spotify", ...r });
        return send(res, 200, { provider: "spotify", title: r.title || s.title, artist: r.artist || s.artist });
      } catch (e) { console.log(`morning music: Spotify didn't play (${e.message}); trying YouTube`); }
    }
    const v = await media.searchYouTube({ query: q, max: 1 }).then((r) => r[0]).catch(() => null);
    if (!v) return send(res, 200, { provider: null });
    return send(res, 200, { provider: "youtube", cmd: { action: "play", provider: "youtube", videoId: v.videoId ?? null, playlistId: v.playlistId ?? null, title: v.title, audioOnly: true } });
  }
  if (m === "POST" && p === "/media/fade") {
    const { level = 1, ms = 2500, pause = false } = await readJSON(req);
    return send(res, 200, { faded: await browser.spotifyFade(Math.max(0, Math.min(1, Number(level))), Math.max(0, Math.min(15000, Number(ms))), { pause: Boolean(pause) }) });
  }
  if (m === "GET" && p === "/media/elements") return send(res, 200, { elements: await browser.mediaElements(url.searchParams.get("page") ?? "spotify") });
  if (m === "GET" && p === "/media/snapshot") {
    const s = await browser.snapshot(url.searchParams.get("page") ?? "spotify");
    if (!s?.png) return send(res, 404, { error: "that media page isn't open", url: s?.url });
    res.writeHead(200, { "content-type": "image/png", "x-page-url": s.url }); return res.end(s.png);
  }
  // audio devices: the list (with nicknames), point sound / the mic at one, rename one
  if (m === "GET" && p === "/devices") return send(res, 200, { devices: await devices.list({ fresh: q.get("fresh") === "1" }) });
  if (m === "POST" && p === "/devices/use") {
    const { key, as } = await readJSON(req);
    const g = (await devices.list()).find((d) => d.key === key);
    if (!g) return send(res, 404, { error: "no such device" });
    const said = await devices.apply({ outputs: as === "mic" ? [] : g.outputs.length ? [g] : [], input: as === "sound" ? null : g.inputs.length ? g : null });
    announcer.broadcast("settings", settings.get());
    if (as !== "sound" && g.inputs.length) announcer.broadcast("mic", { name: g.inputs[0].name, role: "" });
    return send(res, 200, { said, devices: await devices.list({ fresh: true }) });
  }
  if (m === "POST" && p === "/devices/nickname") { const { key, nickname } = await readJSON(req); devices.setNickname(key, String(nickname ?? "").trim().slice(0, 40) || null); return send(res, 200, { devices: await devices.list({ fresh: true }) }); }
  if (m === "POST" && p === "/devlog") {
    const { events = [] } = await readJSON(req);
    for (const e of events.slice(0, 200)) {
      if (!e || typeof e.type !== "string") continue;
      const { type, ...rest } = e;
      devlog.log(type, { source: "tv", ...rest });
      // replies the TV gave by itself belong in the transcript too
      if (type === "local-reply" && rest.said) { transcripts.log({ role: "user", text: String(rest.heard ?? ""), surface: "tv" }); transcripts.log({ role: "dayspring", text: String(rest.said), surface: "tv" }); }
    }
    return send(res, 200, { ok: true });
  }
  if (m === "GET" && p === "/devlog") return send(res, 200, { entries: devlog.read(q.get("date") ?? undefined) });
  if (m === "GET" && p === "/build") return send(res, 200, { build: BUILD });
  if (m === "GET" && p === "/coder") return send(res, 200, coder.status());
  // Open a web link in his normal browser on the laptop (clicked on the TV, or "open that video in my browser")
  if (m === "POST" && p === "/open") {
    const { url: link } = await readJSON(req);
    if (!/^https?:\/\/[^\s"<>]+$/i.test(String(link ?? ""))) return send(res, 400, { error: "only web links can be opened" });
    spawn("explorer.exe", [String(link)], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return send(res, 200, { opened: link });
  }
  if (m === "GET" && p === "/mixer") return send(res, 200, mixer.status());
  if (m === "GET" && p === "/settings") return send(res, 200, { settings: settings.get(), summary: settings.describe() });
  if (m === "POST" && p === "/settings") { const s = settings.set(await readJSON(req)); announcer.broadcast("settings", s); return send(res, 200, { settings: s, summary: settings.describe(s) }); }
  if (m === "POST" && p === "/media/duck") { const { on } = await readJSON(req); return send(res, 200, { ducked: await browser.spotifyDuck(Boolean(on)) }); }
  if (m === "POST" && p === "/media/control") {
    const { action } = await readJSON(req);
    const r = await browser.spotifyControl(action);
    announcer.broadcast("nowplaying", { source: "spotify", ...r });
    return send(res, 200, r);
  }
  if (m === "POST" && p === "/media/login") { const { service } = await readJSON(req); return send(res, 200, await browser.showLogin(service)); }
  if (m === "GET" && p === "/media") return send(res, 200, { nowPlaying: media.nowPlaying(), policy: media.policyNow(), recent: media.recentlyPlayed() });
  if (m === "GET" && p === "/sounds") return send(res, 200, media.sounds());
  if (m === "GET" && p === "/goals") return send(res, 200, { goals: (await import("./lib/goals.mjs")).list() });
  if (m === "GET" && p === "/announcements") return send(res, 200, { recent: announcer.recent(), clients: announcer.clientCount() });
  if (m === "POST" && p === "/announce/now") { const b = await readJSON(req).catch(() => ({})); return send(res, 200, { announced: await announcer.announceNow(b.date, b.hm) }); }

  if (m === "GET" && p === "/status") {
    return send(res, 200, { ok: true, hasKey: hasKey(), model: modelName(), twilio: tw.twilioReady(), notify: notify.notifyReady(), today: store.todayISO(), now: new Date().toTimeString().slice(0, 5), categories: store.CATEGORIES });
  }
  if (m === "POST" && p === "/notify/brief") { const r = await notify.sendSms(notify.briefText()); return send(res, 200, { sent: r }); }
  if (m === "POST" && p === "/notify/review") { const r = await notify.sendSms(notify.reviewText()); return send(res, 200, { sent: r }); }
  if (m === "POST" && p === "/notify/text") { const { body } = await readJSON(req); const r = await notify.sendSms(String(body ?? "").trim() || "(empty)"); return send(res, 200, { sent: r }); }
  if (m === "GET" && p === "/agenda") {
    const from = q.get("from") ?? store.todayISO();
    const to = q.get("to") ?? from;
    return send(res, 200, { blocks: store.blocksBetween(from, to) });
  }
  // The calendar views: every day in a range, with its plan (stamped blocks + projected routines) and what's special.
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (at most a year and a week). summary=1 leaves out the blocks (the year view).
  if (m === "GET" && p === "/calendar") {
    const from = q.get("from") ?? store.todayISO();
    let to = q.get("to") ?? from;
    if (to < from || to > store.addDays(from, 372)) to = store.addDays(from, 6);
    const plan = store.planBetween(from, to), specials = special.between(from, to);
    // every connected calendar (hidden ones left out, duplicates merged, subscriptions included)
    plan.push(...(await calendarRoutes.externalBlocks(from, to).catch(() => [])));
    const days = [], byDay = new Map(), spByDay = new Map();
    for (const b of plan) { const l = byDay.get(b.date); if (l) l.push(b); else byDay.set(b.date, [b]); }
    for (const s of specials) { const l = spByDay.get(s.date); if (l) l.push(s); else spByDay.set(s.date, [s]); }
    for (let d = from; d <= to; d = store.addDays(d, 1)) {
      const bl = byDay.get(d) ?? [];
      const cats = [...new Set(bl.map((b) => b.category))];
      days.push({ date: d, count: bl.length, cats, study: bl.filter((b) => b.category === "study").length, special: spByDay.get(d) ?? [],
        major: bl.filter((b) => (b.importance ?? 0) >= 3).map((b) => b.title), important: bl.filter((b) => (b.importance ?? 0) === 2).map((b) => b.title),
        ...(q.get("summary") ? {} : { blocks: bl.map((b) => ({ id: b.id, start: b.start, end: b.end, title: b.title, description: b.description ?? "", importance: b.importance ?? 0, source: b.source ?? null, category: b.category, done: Boolean(b.done), projected: Boolean(b.projected), external: b.external ?? null, color: b.color ?? null, sourceLabel: b.sourceLabel ?? null, allDay: Boolean(b.allDay), routineId: b.routineId ?? null, repeatText: b.repeatText ?? null, repeat: b.repeat ?? null, link: b.link ?? null, span: b.span ?? null })) }) });
    }
    return send(res, 200, { from, to, today: store.todayISO(), categories: store.CATEGORIES, days });
  }
  // The TV's rotating panel. ?part=weather|video|quote|devotion (or everything at once).
  if (m === "GET" && p === "/showcase") {
    const part = q.get("part");
    const out = {};
    if (!part || part === "devotion") out.devotion = showcase.devotionToday();
    if (!part || part === "quote") out.quote = showcase.quote();
    if (!part || part === "weather") out.weather = await showcase.weather();
    if (part === "video") out.video = await showcase.video({ refresh: q.get("refresh") === "1" });
    return send(res, 200, out);
  }
  // Photos: the next one for the TV (?ask=1 also says whether now is a good moment to ask about it), the image itself
  // (only files in the photo index are ever served), and which one is on screen (so "don't show that again" knows).
  if (m === "GET" && p === "/photos/next") {
    // relaxed moments only, Active, not in a meeting or call, within the daily question budget; "who's in it" and
    // "what's this one" together are one question (lib/vision/ask.mjs)
    const r = await vision.nextPhoto({ want: q.get("ask") === "1" });
    return send(res, 200, { ...r, stats: photos.stats() });
  }
  if (m === "POST" && p === "/photos/showing") { const { id, asked, kind } = await readJSON(req); photoOnScreen = id ?? null; await vision.showing({ id, asked, kind }); return send(res, 200, { ok: true }); }
  const pm = p.match(/^\/photos\/img\/([0-9a-f]{16})$/);
  if (m === "GET" && pm) {
    const f = photos.filePath(pm[1]);
    if (!f) return send(res, 404, { error: "no such photo" });
    const type = { ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" }[extname(f).toLowerCase()] ?? "image/jpeg";
    let body; try { body = await readFile(f); } catch { return send(res, 404, { error: "that photo isn't there any more" }); }
    res.writeHead(200, { "content-type": type, "cache-control": "max-age=86400" });
    return res.end(body);
  }
  // ---- the detail viewer on the TV (click anything in the big panel) ----
  if (m === "GET" && p === "/detail/memory") {
    const t = memorize.today(store.todayISO()), st = memorize.status(store.todayISO());
    const chapter = t.book ? memorize.chapterText(t.book, t.ch) : [];
    return send(res, 200, { ref: t.ref, kind: t.kind, focus: st.focus, from: t.from ?? null, to: t.to ?? null, chapter, chapterRef: t.chapter?.ref, progress: t.progress, next: st.next, done: st.done, finishing: st.finishing });
  }
  if (m === "GET" && p === "/detail/prayer") {
    const d = morning.devotion();
    const mine = (d.prayer?.list ?? []).map((x) => (typeof x === "string" ? { title: x } : { title: x.title, detail: x.private ? null : x.detail, private: Boolean(x.private) }));
    return send(res, 200, { mine, today: morning.today().prayer, church: church.prayerList(), bulletin: church.latest()?.date ?? null, website: church.info().website, youtube: church.info().youtube });
  }
  if (m === "GET" && p === "/detail/bible") {
    const ref = String(q.get("ref") ?? "");
    try { const r = await bible.passage(ref.replace(/[:.][\d–-]+$/, "").replace(/–/g, "-")); return send(res, 200, r); } catch (e) { return send(res, 404, { error: e.message }); }
  }
  // open one of his photos in the laptop's photo viewer
  const po = p.match(/^\/photos\/open\/([0-9a-f]{16})$/);
  if (m === "POST" && po) { const f = photos.filePath(po[1]); if (!f) return send(res, 404, { error: "no such photo" }); spawn("explorer.exe", [f], { detached: true, stdio: "ignore", windowsHide: true }).unref(); return send(res, 200, { opened: true }); }
  if (m === "GET" && p === "/special") return send(res, 200, { today: special.forDate(store.todayISO()), spoken: special.spokenToday(store.todayISO()), upcoming: special.upcoming(store.todayISO(), 30), people: special.people() });
  if (m === "POST" && p === "/blocks") {
    const body = await readJSON(req);
    // an end before the start runs past midnight (11pm–1am): two linked halves
    const r = body?.end && body?.start && body.end < body.start ? store.addSpan(body) : store.addBlock(body);
    announcer.broadcast("refresh", { reason: "add" });
    return send(res, 201, r);
  }
  let mm;
  if ((mm = p.match(/^\/blocks\/([^/]+)$/))) {
    const id = decodeURIComponent(mm[1]);
    // close_gap: a shorter (or removed) block pulls that day's later ones earlier; work, church and meetings stay put
    const toM = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    if (m === "PATCH") {
      const real = id.startsWith("r:") ? store.materialize(id).id : id;
      const { close_gap, ...patch } = await readJSON(req);
      const before = store.blocksBetween("0000-01-01", "9999-12-31").find((b) => b.id === real);
      const s0 = patch.start ?? before?.span?.start ?? before?.start, e0 = patch.end ?? before?.span?.end ?? before?.end;
      if (before?.link || (s0 && e0 && e0 < s0)) { const r = store.updateSpan(real, patch); announcer.broadcast("refresh", { reason: "edit" }); return send(res, 200, r); }
      const r = store.updateBlock(real, patch);
      if (close_gap && before && before.date === r.block.date && toM(r.block.end) < toM(before.end))
        r.pulledEarlier = store.pullLater(r.block.date, before.end, toM(before.end) - toM(r.block.end), { isFixed: planner.isAnchored, exceptId: real });
      announcer.broadcast("refresh", { reason: "edit" }); return send(res, 200, r);
    }
    if (m === "DELETE") {
      const b = id.startsWith("r:") ? store.materialize(id) : null;
      const removed = store.removeBlock(b ? b.id : id);
      let pulledEarlier;
      if (q.get("close_gap") === "1") pulledEarlier = store.pullLater(removed.date, removed.end, toM(removed.end) - toM(removed.start), { isFixed: planner.isAnchored });
      announcer.broadcast("refresh", { reason: "edit" }); return send(res, 200, { removed, pulledEarlier });
    }
  }
  if ((mm = p.match(/^\/blocks\/([^/]+)\/done$/)) && m === "POST") {
    const { done } = await readJSON(req);
    const block = store.setDone(mm[1], done);
    learning.onBlockDone(block);
    announcer.broadcast("refresh", { reason: "done" });
    return send(res, 200, { block });
  }
  if ((mm = p.match(/^\/blocks\/([^/]+)\/resolve$/)) && m === "POST") {
    const { mode } = await readJSON(req);
    if (mode !== "shift_others") return send(res, 400, { error: "mode must be shift_others" });
    return send(res, 200, { moved: store.shiftOthers(mm[1]) });
  }
  if (m === "GET" && p === "/free") {
    const date = q.get("date") ?? store.todayISO();
    return send(res, 200, { slots: store.freeSlots(date, Number(q.get("minutes")) || 30, q.get("earliest") ?? "06:00", q.get("latest") ?? "23:00") });
  }
  if (m === "GET" && p === "/overlaps") {
    return send(res, 200, { ids: [...store.overlapsOn(q.get("date") ?? store.todayISO())] });
  }
  if (m === "POST" && p === "/routines/apply") {
    const { date } = await readJSON(req);
    return send(res, 200, { added: store.applyRoutines(date ?? store.todayISO()) });
  }
  // what the Dayspring screen shows: the display reports each thing it shows, and what's on it / coming up
  if (m === "POST" && p === "/screen/shown") { screenlog.shown(await readJSON(req)); return send(res, 200, { ok: true }); }
  if (m === "POST" && p === "/screen/state") { screenlog.setState(await readJSON(req)); return send(res, 200, { ok: true }); }
  if (m === "GET" && p === "/screen") return send(res, 200, { now: screenlog.state(), history: screenlog.history({ limit: 40 }) });
  // snooze: { minutes } snoozes the last alert; { item, minutes } a specific one (the display sends the alert it showed)
  if (m === "GET" && p === "/snooze") return send(res, 200, { list: snooze.list() });
  if (m === "POST" && p === "/snooze") { const b = await readJSON(req); return send(res, 200, snooze.snooze(b.item ?? undefined, b.minutes)); }
  if (m === "DELETE" && (mm = p.match(/^\/snooze\/([^/]+)$/))) return send(res, 200, snooze.cancel(decodeURIComponent(mm[1])));
  if (m === "GET" && p === "/keepawake") return send(res, 200, keepawake.status());
  if (m === "POST" && p === "/keepawake") { const { on } = await readJSON(req); return send(res, 200, keepawake.set(on !== false)); }
  if (m === "GET" && p === "/routines") return send(res, 200, { routines: store.routines() });
  // repeating items: create, change the whole series, stop it; the screen redraws right away
  if (m === "POST" && p === "/routines") { const routine = store.addRoutine(await readJSON(req)); announcer.broadcast("refresh", { reason: "edit" }); return send(res, 201, { routine }); }
  if ((mm = p.match(/^\/routines\/([^/]+)$/))) {
    if (m === "PATCH") { const routine = store.updateRoutine(mm[1], await readJSON(req)); announcer.broadcast("refresh", { reason: "edit" }); return send(res, 200, { routine }); }
    if (m === "DELETE") { store.removeRoutine(mm[1], { future: q.get("future") !== "0" }); announcer.broadcast("refresh", { reason: "edit" }); return send(res, 200, { ok: true }); }
  }
  if (m === "POST" && (mm = p.match(/^\/routines\/([^/]+)\/end$/))) {
    const { from } = await readJSON(req); const routine = store.endRoutine(mm[1], from || store.todayISO());
    announcer.broadcast("refresh", { reason: "edit" }); return send(res, 200, { routine });
  }
  // make a one-time item repeat: { repeat: { freq, interval, days, monthDay | nth, until } }
  if (m === "POST" && (mm = p.match(/^\/blocks\/([^/]+)\/repeat$/))) {
    const id = decodeURIComponent(mm[1]), { repeat } = await readJSON(req);
    const routine = id.startsWith("r:") ? store.updateRoutine(store.routineOf(id).id, { repeat }) : store.routineOf(id) ? store.updateRoutine(store.routineOf(id).id, { repeat }) : store.makeRecurring(id, repeat);
    announcer.broadcast("refresh", { reason: "edit" });
    return send(res, 200, { routine });
  }
  if (m === "GET" && p === "/tasks") return send(res, 200, { tasks: store.tasks(q.get("all") === "1") });
  if (m === "POST" && p === "/tasks") return send(res, 201, { task: store.addTask(await readJSON(req)) });
  if ((mm = p.match(/^\/tasks\/([^/]+)$/))) {
    if (m === "PATCH") { const { done } = await readJSON(req); return send(res, 200, { task: store.setTaskDone(mm[1], done) }); }
    if (m === "DELETE") { store.removeTask(mm[1]); return send(res, 200, { ok: true }); }
  }
  if (m === "GET" && p === "/memories") return send(res, 200, { memories: store.memories() });
  if ((mm = p.match(/^\/memories\/([^/]+)$/)) && m === "DELETE") { store.forget(mm[1]); return send(res, 200, { ok: true }); }

  if (m === "POST" && p === "/chat") {
    const MONEY_NOT_KEPT = "(a money review answer; not kept)";
    const { message, surface, typed, stream: wantStream } = await readJSON(req);
    if (!message?.trim()) return send(res, 400, { error: "message is required" });
    const key = surface === "tv" ? "tv" : "desk";
    transcripts.log({ role: "user", text: message.trim(), surface: key });
    // its name and wake words first ("your name is Nova", "what were you called before?", "answer to Jarvis", and the yes to
    // its read-back): "called…" and "call you…" aren't files or phone calls here (lib/commands/naming.mjs)
    { const nm = await namingCmd.handle(message.trim(), { surface: key }).catch(() => null);
      if (nm) { floor.owner("message", key); floor.replied(key, nm); transcripts.log({ role: "dayspring", text: nm.reply, surface: key }); return send(res, 200, { ...nm, changes: nm.changes ?? [], usage: null }); } }
    // "tune in" / "tune out" / "answer into the call": handled right away, no AI needed
    // while a video is showing, "full screen" and "exit full screen" are the video's (lib/video/controls.mjs)
    { const vw = video.pictureWord(message.trim()) ? await video.command(message.trim(), { surface: key }).catch(() => null) : null;
      if (vw) { floor.owner("message", key); floor.replied(key, vw); transcripts.log({ role: "dayspring", text: vw.reply, surface: key }); return send(res, 200, { reply: vw.reply, changes: [], usage: null, intent: "video" }); } }
    // the windows ON the screen by name: "minimize the map", "put the viewer in the corner", "hide everything" (lib/winman.mjs)
    { const wm = winman.command(message.trim());
      if (wm) { floor.owner("message", key); floor.replied(key, wm); transcripts.log({ role: "dayspring", text: wm.reply, surface: key }); return send(res, 200, { reply: wm.reply, changes: [], usage: null, intent: "winman" }); } }
    // "minimize", "hide yourself", "show yourself", "close the screen": the display window, right away
    const wc = await windowRoutes.command(message.trim()).catch(() => null);
    if (wc) { transcripts.log({ role: "dayspring", text: wc, surface: key }); return send(res, 200, { reply: wc, changes: [], usage: null }); }
    // "turn off the AI", "switch to Claude", "use Ollama", "which AI are you using?": right away, no AI needed (lib/ai-switch.mjs)
    { const ai = await import("./lib/ai-switch.mjs").then((a) => a.command(message.trim())).catch(() => null);
      if (ai) { floor.owner("message", key); transcripts.log({ role: "dayspring", text: ai, surface: key }); announcer.broadcast("aiswitch", {}); return send(res, 200, { reply: ai, changes: ["settings"], usage: null, intent: "ai.switch" }); } }
    // "join my meeting", a pasted Meet link, "bring the meeting back", "let Rich ask", "mute", "leave the meeting"…
    const mc = await meetRoutes.command(message.trim()).catch((e) => { console.log(`meet: ${e.message}`); return null; });
    if (mc) { transcripts.log({ role: "dayspring", text: mc, surface: key }); return send(res, 200, { reply: mc, changes: [], usage: null }); }
    // "what were you going to say?": what Dayspring was holding while he talked comes out now (lib/floor.mjs)
    const fl = floor.command(message.trim());
    if (fl) { transcripts.log({ role: "dayspring", text: fl, surface: key }); return send(res, 200, { reply: fl, changes: [], usage: null, intent: "floor.release" }); }
    const uc = await updateRoutes.command(message.trim(), { restart: restartSelf }).catch(() => null);
    if (uc) { transcripts.log({ role: "dayspring", text: uc, surface: key }); return send(res, 200, { reply: uc, changes: [], usage: null }); }
    const tc = await callRoutes.command(message.trim()).catch(() => null);
    if (tc) { transcripts.log({ role: "dayspring", text: tc, surface: key }); return send(res, 200, { reply: tc, changes: [], usage: null }); }
    // the photo gallery: "open the photo gallery", "show my photos from last summer", "shuffle my photos", "view this in
    // the gallery", "open this photo's folder" (lib/gallery/skills.mjs), before pictures from the web and the finder
    { const gc = !features.on("gallery") ? null : await (await import("./lib/gallery/skills.mjs")).command(message.trim(), { photo: photoOnScreen }).catch((e) => { console.log(`gallery: ${e.message}`); return null; });
      if (gc) { transcripts.log({ role: "dayspring", text: gc.reply, surface: key }); return send(res, 200, { reply: gc.reply, changes: [], usage: null, intent: gc.intent ?? "gallery" }); } }
    // videos, before the Bible, music, pictures and GIFs: "find bible reading in psalms on youtube", "play a video by
    // mike winger", "pull up videos about biking", "queue 3 videos about dovetails", "play my Worship playlist", "show the
    // queue", "number 3", "not that", and playback controls for whatever is playing ("skip ahead 2 minutes", "captions
    // on", "1.5x", "how long is left"). His request comes first (lib/floor.mjs), as with everything he says.
    // signing in to YouTube / Spotify in the media window, signing out, "am I signed in to YouTube?" (lib/mediasignin.mjs)
    { const si = await mediasignin.command(message.trim()).catch((e) => ({ reply: e.message }));
      const sr = typeof si === "string" ? si : si?.reply;
      if (sr) { floor.owner("message", key); transcripts.log({ role: "dayspring", text: sr, surface: key }); return send(res, 200, { reply: sr, changes: [], usage: null, intent: "media.signin" }); } }
    // the Music & Video browser: "open my music", "show my liked songs", "what did I listen to yesterday", "search YouTube
    // for …", and "play number 3" / "queue number 2" / "like number 4" on whatever list it's showing (lib/mediabrowser)
    { const mc = await mbrowser.command(message.trim()).catch((e) => { console.log(`media browser: ${e.message}`); return null; });
      if (mc) {
        floor.owner("message", key); floor.replied(key, mc);
        transcripts.log({ role: "dayspring", text: mc.reply, surface: key });
        return send(res, 200, { reply: mc.reply, changes: [], usage: null, intent: mc.intent ?? "mediabrowser", ...(mc.listen ? { listen: true } : {}) });
      } }
    { const vc = await video.command(message.trim(), { surface: key }).catch((e) => { console.log(`video: ${e.message}`); return null; });
      if (vc) {
        floor.owner("message", key); floor.replied(key, vc);
        transcripts.log({ role: "dayspring", text: vc.reply, surface: key });
        return send(res, 200, { reply: vc.reply, changes: vc.played ? ["media"] : [], usage: null, intent: vc.intent ?? "video", ...(vc.listen ? { listen: true } : {}) });
      } }
    // cameras: "show me the front camera", "any activity on the trail cam?", "play last night's deer clip" (lib/cameras)
    const cc = await cameraRoutes.command(message.trim()).catch((e) => { console.log(`cameras: ${e.message}`); return null; });
    if (cc) { transcripts.log({ role: "dayspring", text: cc, surface: key }); return send(res, 200, { reply: cc, changes: [], usage: null, intent: "cameras" }); }
    // GIFs (before pictures: "a GIF of …" is a GIF): "show me a GIF of a dancing cat", and while they're up: "number 4",
    // "more", "save that GIF", "copy that one", "only stickers", "clean ones only" (lib/gifs/routes.mjs)
    const gc = await gifRoutes.command(message.trim()).catch((e) => { console.log(`gifs: ${e.message}`); return null; });
    if (gc) { transcripts.log({ role: "dayspring", text: gc, surface: key }); return send(res, 200, { reply: gc, changes: [], usage: null, intent: "gifs" }); }
    // "show me pictures of …", and while pictures are up: "show number 3", "more", "save that one", "close images"
    const ic = await imageRoutes.command(message.trim()).catch((e) => { console.log(`images: ${e.message}`); return null; });
    if (ic) { transcripts.log({ role: "dayspring", text: ic, surface: key }); return send(res, 200, { reply: ic, changes: [], usage: null, intent: "images" }); }
    // his own music and videos, and Google Drive: "play … from my computer", "shuffle my music folder", "number 2" (lib/medialib)
    const ml = !(features.on("medialib") || features.on("drive")) ? null : await (await import("./lib/medialib/skills.mjs")).command(message.trim(), { surface: key }).catch((e) => { console.log(`media library: ${e.message}`); return null; });
    if (ml) { transcripts.log({ role: "dayspring", text: ml.reply, surface: key }); return send(res, 200, { reply: ml.reply, changes: ml.played ? ["media"] : [], usage: null, intent: "medialib", ...(ml.listen ? { listen: true } : {}) }); }
    // his files by name, and the viewer: "find my resume", "open the PDF called lease agreement", "number 2", "zoom in" (lib/finder)
    const fv = !features.on("fileviewer") ? null : await (await import("./lib/finder/skills.mjs")).command(message.trim(), { surface: key }).catch((e) => { console.log(`file finder: ${e.message}`); return null; });
    if (fv) { transcripts.log({ role: "dayspring", text: fv.reply, surface: key }); return send(res, 200, { reply: fv.reply, changes: [], usage: null, intent: "fileviewer", ...(fv.listen ? { listen: true } : {}) }); }
    const t0 = Date.now();
    lastChatAt = Date.now();
    // The Dayspring screen can have the answer as it's written (stream: true): each finished sentence goes out at once as a
    // line of NDJSON {t:"say", text, round}, then {t:"done", round, data} with the usual reply. Only once the AI actually
    // writes something; everything answered without it stays plain JSON. round: which step it came from (text before a
    // tool call is said too, "Let me check"; the reply is the last step's text).
    let ndjson = false, finalRound = -1;
    const splitters = new Map();
    const streamOpts = wantStream && key === "tv" && !typed ? {
      onText: (d, round) => {
        if (!ndjson) { res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" }); ndjson = true; }
        let sp = splitters.get(round);
        if (!sp) { sp = createSplitter({ firstMin: 60, onSentence: (text) => { try { res.write(JSON.stringify({ t: "say", text, round }) + "\n"); } catch { /* the screen went away */ } } }); splitters.set(round, sp); }
        sp.push(d);
      },
      onRoundEnd: (round, stop) => { splitters.get(round)?.flush(); if (stop !== "tool_use" && stop !== "pause_turn") finalRound = round; },
    } : {};
    const before = chatLocks[key]; let unlock; chatLocks[key] = new Promise((r) => { unlock = r; });
    let out;
    try {
      await before.catch(() => {});
      devlog.log("sent", { surface: key, text: message.trim(), historyLen: histories[key].length });
      // "Pick for me" (off unless chosen): a quick command goes to the fast model, for this one request (lib/llm.mjs)
      const llmMod = await import("./lib/llm.mjs");
      // (a serious talk, sparring, or a between-blocks conversation stays on the main model for every turn)
      const deep = Boolean(settings.get().convMode || (key === "tv" && session.current()));
      const model = llmMod.autoModel(message.trim(), { deep });
      try { out = await llmMod.withModel(model, () => chat(histories[key], message.trim(), key === "tv" ? { surface: "tv", photo: photoOnScreen, typed: Boolean(typed), ...streamOpts } : { surface: "desk", typed: true })); }
      catch (err) {
        devlog.log("error", { where: "chat", surface: key, text: message.trim(), status: err?.status ?? null, error: String(err?.message ?? err).slice(0, 500), ms: Date.now() - t0 });
        if (ndjson) { try { res.end(JSON.stringify({ t: "error", error: "Sorry, I couldn't get an answer just then." }) + "\n"); } catch { /* gone */ } return; }
        throw err;
      }
      if (out) out.model = model ?? llmMod.modelName();
      histories[key] = out.history;
    } finally { unlock(); }
    // a Money review answer (amounts, payees, balances) is never kept in the conversation history on disk, the same as
    // the activity log; the answer itself was already given
    const moneyAnswer = out?.private === "money" || moneyUsedSince(t0);
    transcripts.log({ role: "dayspring", text: moneyAnswer ? MONEY_NOT_KEPT : out.reply, surface: key });
    // who answered: Claude (it used tokens), a built-in skill, the offline fallback, or a local handler
    const by = out.usage ? "claude" : out.offline ? "offline(" + out.offline + ")" : out.changes?.includes("skills") ? "skill" : out.changes?.includes("offline") ? "offline" : "local";
    devlog.log("reply", { surface: key, by, model: out.usage ? out.model : null, streamed: ndjson, ms: Date.now() - t0, reply: moneyAnswer ? MONEY_NOT_KEPT : out.reply, changes: out.changes, tokensIn: out.usage?.input_tokens ?? null, tokensOut: out.usage?.output_tokens ?? null, cacheRead: out.usage?.cache_read_input_tokens ?? null, historyLen: out.history?.length ?? null, open: Boolean(out.open), quiet: Boolean(out.quiet) });
    if (out.changes.length) announcer.broadcast("refresh", { reason: "chat" });
    // conversation: the TV keeps listening (no wake phrase) while a between-blocks conversation is open;
    // quiet: he asked to stop talking, so the TV goes quiet right away
    if (out.restart) setTimeout(restartSelf, 3500);      // after "Restarting, I'll be right back" has been said
    const body = { reply: out.reply, changes: out.changes, usage: out.usage, conversation: Boolean(key === "tv" && (session.current() || out.open)), quiet: Boolean(out.quiet), speed: out.speed ?? null, photo: out.photo ?? null, panel: out.panel ?? null,
      // what the no-AI understanding adds: a list to pick from, a help link, something for the screen to do
      ...Object.fromEntries(["suggest", "link", "clientRun", "clientShow", "count", "timers", "cooking", "cookingDone", "recipes", "recipeView", "listen", "joke", "intent", "openPage", "offerSearch", "dismissTimers", "miss", "dictating", "webResults", "breathing", "show", "devVoice", "support", "offer", "trivia",
        // (lib/commands: he ended the conversation, so the screen stops listening at once; the parts of "this and that")
        "close", "closing", "parts", "security"].filter((k) => out[k] !== undefined).map((k) => [k, out[k]])) };
    if (ndjson) { res.end(JSON.stringify({ t: "done", round: finalRound, data: body }) + "\n"); return; }
    return send(res, 200, body);
  }
  if (m === "POST" && p === "/chat/reset") { const { surface } = await readJSON(req).catch(() => ({})); histories[surface === "tv" ? "tv" : "desk"] = []; return send(res, 200, { ok: true }); }

  return send(res, 404, { error: `no route ${m} ${p}` });
}

// Page names: /display (the Dayspring screen; /tv is its older name), /setup (first-run wizard and Settings), /help (the guide)
const PAGES = { "/": "/index.html", "/tv": "/tv.html", "/display": "/tv.html", "/mini": "/tv.html", "/history": "/history.html", "/setup": "/setup.html", "/settings": "/setup.html", "/help": "/help.html", "/welcome": "/welcome.html", "/recipes": "/recipes.html", "/progress": "/progress.html", "/gifs": "/gifs.html" };
async function serveStatic(res, pathname) {
  // until setup is done, the Dayspring screen (and the plain address, which a new user is most likely to type) sends people to the wizard
  if ((pathname === "/" || pathname === "/tv" || pathname === "/display" || pathname === "/mini" || pathname === "/setup" || pathname === "/settings") && !owner.setupDone()) { res.writeHead(302, { location: "/welcome" }); return res.end(); }
  const rel = PAGES[pathname] ?? pathname;
  if (features.pageBlocked(rel)) { res.writeHead(404); return res.end("not found"); }   // a feature that's off has no pages
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}

const ECO_ROOT = join(here, "vendor", "ecosystem-core");
async function serveEco(res, pathname) {
  const rel = decodeURIComponent(pathname.slice(5));
  const file = join(ECO_ROOT, rel);
  if (!file.startsWith(ECO_ROOT) || !/^(client|shared)[\\/]/.test(rel)) { res.writeHead(404); return res.end("not found"); }
  try { const body = await readFile(file); res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end("not found"); }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
function localRequest(req) {
  const host = String(req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return false;
  const site = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (site === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try { const o = new URL(origin); return (o.protocol === "http:" || o.protocol === "https:") && LOCAL_HOSTS.has(o.hostname.toLowerCase() === "::1" ? "[::1]" : o.hostname.toLowerCase()) && o.port === String(PORT); }
  catch { return false; }          // "null" (a file or sandboxed page) is refused
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Requests arriving through the Cloudflare tunnel carry cf-connecting-ip. Only Twilio's
  // webhooks are allowed in from the internet; the UI and API stay laptop-only.
  const fromInternet = Boolean(req.headers["cf-connecting-ip"]) || /trycloudflare\.com$/i.test(req.headers.host ?? "");
  if (fromInternet && !url.pathname.startsWith("/twilio/")) { res.writeHead(403); return res.end("local only"); }
  // Other websites open in the owner's browser must not be able to drive Dayspring. DNS rebinding: only our own host
  // names are answered. Cross-site requests: a browser page from anywhere but Dayspring itself is refused (programs on
  // this computer, like Lantern or the launcher, send no Origin and are unaffected).
  // (a name that isn't this computer is a misdirected request, 421, as the ecosystem contract says; a page from elsewhere is 403)
  if (!fromInternet && !localRequest(req)) { const misdirected = !LOCAL_HOSTS.has(String(req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "")); res.writeHead(misdirected ? 421 : 403, { "content-type": "text/plain" }); return res.end("Dayspring only answers its own pages."); }
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (url.pathname.startsWith("/twilio/") && req.method === "POST") await twilio(req, res, url);
    // the shared look and page parts both apps use (vendor/ecosystem-core: tokens.css, icons, the lantern avatar…)
    else if (url.pathname.startsWith("/eco/")) await serveEco(res, url.pathname);
    // the study window's course pages (a course's own files served locally)
    // Google and Microsoft sign-ins come back here (/oauth/google, /oauth/microsoft)
    else if (await connectorRoutes.handlePage(req, res, { m: req.method, pathname: url.pathname, q: url.searchParams })) return;
    // the Spotify sign-in comes back here (/spotify/callback)
    else if (await playerRoutes.handlePage(req, res, { m: req.method, pathname: url.pathname, q: url.searchParams })) return;
    else if (await studyRoutes.handlePage(req, res, { m: req.method, pathname: url.pathname, q: url.searchParams })) return;
    // an emailed "Connect to Lantern" sign-in link comes back here (/lantern/auth/callback)
    else if (await lanternRoutes.handlePage(req, res, { m: req.method, pathname: url.pathname })) return;
    // an emailed sign-in link for this device comes back here (/remote/auth/callback)
    else if (await remoteRoutes.handlePage(req, res, { m: req.method, pathname: url.pathname })) return;
    else await serveStatic(res, url.pathname);
  } catch (err) {
    const status = err?.status ?? 400;
    console.error(`${req.method} ${url.pathname} ->`, err?.message ?? err);
    if (process.env.DAYSPRING_DEBUG && err?.stack) console.error(err.stack);
    if (res.headersSent) { try { res.destroy(); } catch { /* gone */ } return; }
    send(res, status, { error: err?.message ?? String(err) });
  }
}).on("error", (e) => {
  // Only one Dayspring at a time: a second start (a double-click, a shortcut while it's running) just stops quietly.
  if (e.code === "EADDRINUSE") { console.log(`Dayspring is already running (port ${PORT} is in use). This copy stops; the running one carries on.`); process.exit(0); }
  throw e;
}).listen(PORT, "127.0.0.1", () => {
  if (LEGACY_CONSOLE) { console.log("Moving Dayspring to run in the background, without a command window…"); restartSelf(); return; }
  // which process is Dayspring (Stop Dayspring uses it if asking nicely doesn't work)
  const PIDFILE = join(here, "data", "server.pid");
  try { writeFileSync(PIDFILE, String(process.pid)); } catch { /* not important */ }
  process.on("exit", () => { try { if (readFileNow(PIDFILE, "utf8") === String(process.pid)) unlinkSync(PIDFILE); } catch { /* gone */ } });
  // after an update: this is the new version running, so the update worked (Settings → Updates shows it in the history)
  { const pv = updater.confirmStarted(); if (pv) console.log(`Updated from ${pv.from} to ${pv.to}.`); }
  // a local model (Ollama): load it now and keep it loaded, so the first question doesn't wait (nothing with any other AI, or none)
  import("./lib/ollama/index.mjs").then((o) => o.startWarm()).then((w) => { if (w?.ok) console.log(`Local AI warmed up (${w.model}, ${Math.round(w.ms / 100) / 10} s).`); else if (w?.state) console.log(`Local AI: ${w.state}`); }).catch(() => {});
  // an update from 1.0.0 took the downloaded helpers (bin/) away with the old files: bring them back
  try { if (updater.restoreHelpers()) console.log("Put the downloaded helpers (bin) back after the update."); } catch { /* not important */ }
  // Lantern (the learning app), if it's on this computer: presence, events, "one voice, one ear"
  lantern.setDeps({ tunein, callbridge });
  lantern.start({ port: PORT, announce: (x) => announcer.announce(x) });
  // his other Dayspring computers (only if this one signed in before, and only with the "remote" feature on)
  remote.start({ port: PORT, version: lantern.version(), announce: (x) => announcer.announce(x), broadcast: (t, d) => announcer.broadcast(t, d),
    openUrl: async (u) => (await import("./lib/browsers.mjs")).openUrl(u, owner.displayBrowser()) }).catch((e) => console.log(`remote: ${e.message}`));
  // Make sure today has its routines so the first screen isn't empty.
  const added = store.applyRoutines(store.todayISO());
  console.log(`Dayspring desk  →  http://localhost:${PORT}`);
  console.log(`AI:     ${hasKey() ? `on (${modelName()})` : "off (free mode). Pick Claude, ChatGPT, Grok or Ollama in Settings: http://localhost:" + PORT + "/setup"}`);
  if (added.length) console.log(`Stamped ${added.length} routine block(s) onto today.`);
  const t = tw.twilioReady();
  if (t.creds || t.number) console.log(`Twilio: creds ${t.creds ? "found" : "missing"}, number ${t.number ?? "not set"}, allowed callers ${t.allowed}`);
  const n = notify.notifyReady();
  if (t.creds || n.canSend) console.log(`Reminders: ${n.canSend ? `${n.channel === "call" ? "calling" : "texting"} ${n.to} ${n.remindMinutes} min before each block; brief ${n.morningBrief ?? "off"}, review ${n.eveningReview ?? "off"}` : n.channel === "off" ? "off (DAYSPRING_REMINDER_CHANNEL=off; set to sms once texting is approved)" : "off (set DAYSPRING_NOTIFY_NUMBER in .env)"}`);
  setInterval(() => notify.tick().catch((e) => console.log(`reminder tick error: ${e.message}`)), 60_000);
  // Announcements run on the minute boundary so the voice lands when the block starts.
  const onMinute = () => announcer.tick().catch((e) => console.log(`announce tick error: ${e.message}`));
  setTimeout(() => { onMinute(); setInterval(onMinute, 60_000); }, 60_000 - (Date.now() % 60_000) + 500);
  const v = voice.voiceReady();
  console.log(`System: Windows ${osRelease()} (${osRelease().split(".")[2] >= 22000 ? "11" : "10"}) · Node ${process.version} · running as ${process.execPath.split(/[\/]/).pop()}`);
  console.log(`Screen: http://localhost:${PORT}/display   (voice: ${voice.ttsProvider() === "browser" ? "free browser voices" : v.ready ? `${v.voiceName} via ${voice.ttsProvider() === "openai" ? "OpenAI" : "ElevenLabs"}` : voice.ttsProvider()})`);
  console.log(owner.setupDone() ? `Settings: http://localhost:${PORT}/setup   Help: http://localhost:${PORT}/help` : `First-time setup: http://localhost:${PORT}/welcome`);
  console.log(`Files:  ${permissions.describe()}${permissions.get().files === "off" ? " (Settings → Permissions)" : ` (backups in ${files.BACKUPS()})`}`);
  // The Voicemeeter mixer (optional): Spotify and YouTube on the screen's speakers and the headphones too.
  mixer.start(settings.get().audioOutputs, { enabled: settings.get().mixer !== false }).then((r) => {
    console.log(`Mixer:  ${r.active ? `Voicemeeter on, playing on ${(r.playingOn ?? []).join(" and ")}` : `off (${r.note})`}`);
    // pick up a screen or headphones that get plugged in later
    setInterval(() => { if (mixer.isActive()) mixer.route(settings.get().audioOutputs).catch(() => {}); }, 20_000);
  });
  knowledge.map();   // builds the folder map if it is missing or a day old
  if (owner.feature("photos")) import("./lib/photos.mjs").then((p) => p.scan()).catch(() => {});   // the photo list, built in the background
  if (DISPLAY_MODE) features.startJob("faces", "vision.start", () => vision.start({ announce: (x) => announcer.announce(x) }));   // faces in the photos (only if turned on), people questions
  // While the media browser is open, keep the screen's "now playing" card in step with Spotify.
  setInterval(async () => {
    if (!browser.isOpen() || announcer.clientCount() === 0) { if (!browser.isOpen()) media.pollWindow().catch(() => {}); return; }
    const now = await media.pollWindow().catch(() => null);   // (it also feeds the one "now playing": lib/nowplaying.mjs)
    const key = now ? JSON.stringify([now.title, now.artist, now.playing]) : "";
    if (key !== lastNow) { lastNow = key; announcer.broadcast("nowplaying", { source: "spotify", ...(now ?? { playing: false }) }); }
  }, 3000);
  // The phone (Phone Link): new texts are announced ("Incoming text message from Sarah. Want me to read it?");
  // app notifications show quietly on the screen (title only; others may see it). Only when the phone feature is on.
  const phoneOn = DISPLAY_MODE && owner.feature("phone");
  if (phoneOn) phonenotify.prime();
  if (phoneOn) setInterval(() => {
    for (const n of phonenotify.poll()) {
      peopleComms.onPhoneEvent(n);   // a copy on their profile, only with "Save my text messages" on (off: nothing is written)
      if (n.kind === "text") {
        phonenotify.announceText(n);
        const lines = [`Incoming text message from ${n.from}. Do you want me to read it to you?`, `You've got a text from ${n.from}. Want me to read it?`, `${n.from} just texted you. Should I read it?`];
        announcer.announce({ kind: "text", from: n.from, text: lines[Math.floor(Math.random() * lines.length)] });
      } else announcer.broadcast("phonenote", { title: n.title });
    }
  }, 4000);
  // Keep the Dayspring screen open. If nothing has been connected for a minute (closed, crashed, or the screen was just
  // plugged back in), open it again on the chosen screen. open-display.cmd does nothing when that screen isn't connected.
  // Only for a second screen: on the main screen, closing Dayspring's window means "not now", so it isn't reopened.
  const screenPick = () => { const d = String(owner.get().display ?? "auto"); return d === "auto" ? "secondary" : d; };
  // if Discord was left pointing at Dayspring's call mixer, bring the mixer back so friends can still hear the owner
  if (DISPLAY_MODE) callbridge.resume().catch(() => {});
  // 🎧 Tune in comes back on if the owner left it on
  if (DISPLAY_MODE) setTimeout(() => tunein.resume().catch(() => {}), 4000);
  // the display window, as it was before a restart or an update (lib/sinkfollow.mjs); guarded inside, never in tests
  display.resumeAfterRestart();
  if (DISPLAY_MODE) {
    // Not until the guided setup is finished (the setup page is the window then), and never a second window: display.open()
    // brings back the one that's open (even minimized or loading) instead. When the chosen screen isn't connected, it
    // looks again every few minutes, quietly.
    let missing = 0, nextTry = 0;
    const WATCH_MS = Number(process.env.DAYSPRING_WATCHDOG_MS) || 30_000;   // tests make it tick faster
    setInterval(async () => {
      if (!owner.setupDone()) return;
      if (announcer.displayCount() > 0) { missing = 0; return; }
      if (!owner.get().keepScreenOpen) return;          // only when "Keep the Dayspring screen open" is on (TV / always-on display)
      if (windowRoutes.closedByOwner()) return;          // they closed it on purpose: don't pop it back open
      if (display.wantOpenAs() === "tab" || display.openedAs() === "tab") return;   // a browser tab they close stays closed
      if (screenPick() === "primary") return;
      if (++missing < 2 || Date.now() < nextTry) return;
      nextTry = Date.now() + 3 * WATCH_MS;   // give the browser time to connect before trying again
      const r = await display.open({ screen: screenPick() }).catch(() => null);
      if (r?.noScreen) nextTry = Date.now() + 10 * WATCH_MS;
      else if (r?.opened) console.log("Dayspring screen reopened");
    }, WATCH_MS);
  }
  // Updates: checked now and every 6 hours. The notice (What's new + Update now / Next time / When I'm not using it) shows
  // on the screen; "idle" installs wait for a quiet half hour, never during an alarm, a call or Tune in.
  // Quiet/Off pauses Tune in; desktop notifications start (and restart when turned back on in Settings)
  quiet._setDeps({ tunein });
  if (DISPLAY_MODE || process.env.DAYSPRING_OVERLAY === "1") {
    overlay.start({ onAction: overlayAction }).catch(() => {});
    // the helper keeps running with the cards off: with the screen closed it's what rings the alarm
    settings.onChange(() => { overlay.start({ onAction: overlayAction }).catch(() => {}); });
  }
  // installs from before 1.1.3 get the "Dayspring (full screen)" and "Dayspring in browser" Start-menu shortcuts, once
  import("./lib/shortcuts.mjs").then((m) => m.ensure()).catch(() => {});
  updater.onStatus((s) => announcer.broadcast("updatestatus", s));
  updater.startAuto({
    announce: (text) => announcer.announce({ kind: "update", text }),
    notify: (info) => announcer.broadcast("update", info),
    busy: () => tunein.isOn() || callbridge.isTalking() || snooze.list_().some((x) => (Number(x.until) || Date.parse(x.until)) - Date.now() < 30 * 60_000) || alarmSoon(),
    restart: restartSelf,
  });
  // older shortcuts started "Start Dayspring.cmd" (a command window); point them at the windowless starter
  if (process.platform === "win32") setTimeout(() => fixShortcuts(), 20_000);
  // the Dayspring screen's computer stays awake (no sleep, no idle lock) while plugged in, so alerts and alarms get through
  if (DISPLAY_MODE) keepawake.start();
  // the speakers and mics are looked up once in the background, so the Sound panel opens straight away
  setTimeout(() => devices.list().catch(() => {}), 8000);
  snooze.start();                // snoozed alarms and reminders come back, even after a restart
  startTimersAndRecipes();
  discover.start();
  // connected apps that work in the background: weather alerts, calendar subscriptions, news feeds
  connectors.startBackground({ announce: (x) => announcer.announce(x) });
  // cameras: each saved camera's schedule, motion checks, recording and alerts (only on the owner's own Dayspring; lib/cameras)
  features.startJob("cameras", "cameras.monitor", () => import("./lib/cameras/index.mjs").then((c) => c.start()));
  // smart devices: their schedules (and auto-off / left-open alerts); 3D printers: connections, print watching (lib/devices, lib/printers)
  features.startJob("devices", "devices.schedules", () => startHome());
  features.startJob("printers", "printers.poll", () => startPrinters());
  // clashes between calendars are noticed and announced; the optional copy of the schedule onto Google/Outlook
  import("./lib/conflicts.mjs").then((c) => c.startWatcher({ announce: announcer.announce, broadcast: announcer.broadcast })).catch(() => {});
  import("./lib/calsync.mjs").then((c) => c.startBackground()).catch(() => {});              // now and then: popular videos and articles about the owner's interests
  ambient.keepFresh();           // the living sky: sunrise/sunset, weather and wind for the owner's location
  discordRoutes.init();          // the Discord bot logs in only when a bot token is set; otherwise it stays off
  // his own music and videos: joins the music sources now, looks through the allowed folders a little later, slowly
  // are YouTube and Spotify still signed in in the media window? (only while it's open; at most every few hours)
  mediasignin.startHealth();
  // Shopping on Amazon: the once-a-day Subscribe & Save check, only when the owner turned shopping AND its notices on (lib/shopping)
  features.startJob("shopping", "shopping.subscriptions", () => import("./lib/shopping/index.mjs").then((s) => s.start({ announce: (x) => announcer.announce(x) })));
  features.startJob("medialib", "medialib.sources", () => import("./lib/medialib/skills.mjs").then((m) => m.registerSources()));
  setTimeout(() => features.startJob("medialib", "medialib.scan", () => import("./lib/medialib/library.mjs").then((l) => l.scanSoon())), 90_000).unref?.();
  setTimeout(() => features.startJob("fileviewer", "fileviewer.scan", () => import("./lib/finder/index.mjs").then((x) => x.scanSoon())), 150_000).unref?.();
  if (TUNNEL) startTunnel();
  else if (t.publicUrl) console.log(`Public URL (from .env): ${t.publicUrl}  → point Twilio webhooks here or run with --tunnel`);
});

// Installing the private speech recognition (whisper.cpp) from the Dayspring screen, with the owner's OK
const sttJob = { running: false, error: null };

// Smart devices and 3D printers (lib/devices, lib/printers): announcements go through the floor like everything else; the
// printers tell the device rules whether an outlet may be cut (printing or hot); USB printing holds the PC awake.
async function startHome() {
  const [dv, pr] = await Promise.all([import("./lib/devices/index.mjs"), import("./lib/printers/index.mjs").catch(() => null)]);
  dv.start({ announce: (x) => announcer.announce(x), broadcast: (t, d) => announcer.broadcast(t, d), ownerName: () => owner.name(), printerStatus: (id) => pr?.powerStatus(id) ?? null });
}
async function startPrinters() {
  const [pr, awake, vset] = await Promise.all([import("./lib/printers/index.mjs"), import("./lib/printers/awake.mjs"), import("./lib/vision/settings.mjs").catch(() => null)]);
  const ffmpeg = await import("ffmpeg-static").then((m) => m.default).catch(() => null);
  await pr.startUp({ announce: (x) => announcer.announce(x), broadcast: (t, d) => announcer.broadcast(t, d), keepAwake: (id, on) => awake.hold(id, on), ffmpeg,
    visionConsent: () => Boolean(vset?.get?.().aiDescribe), notify: (text) => (notify.notifyReady().canSend ? notify.sendSms(text) : Promise.resolve(null)) });
}

// Timers (lib/timers.mjs) ring through the same announcements as everything else; recipes search the web the same way
// Dayspring's own search does. A timer that ended while Dayspring was closed rings once it's back (the first tick).
function startTimersAndRecipes() {
  timers.setDeps({
    emit: (type, data) => announcer.broadcast(type, data),
    // (a focus round ending, or "time to drink water", is said once: text given, nothing to dismiss)
    ring: ({ labels, ids, repeat, text, once }) => announcer.announce({ kind: "timer", text: text ?? timers.doneLine(labels, repeat), timer: { labels, ids, repeat, once: Boolean(once) } }),
    alarm: (a) => {
      const d = new Date(a.at), hm = d.toTimeString().slice(0, 5);
      if (a.kind === "reminder") return announcer.announce({ kind: "reminder", hm, text: `Reminder: ${a.label}.`, reminder: { id: a.id, text: a.label } });
      // (how it rings, when it was set with a sound, a volume, a snooze length, a gentle start or a flashing screen)
      const how = Object.fromEntries(["sound", "volume", "snooze", "gentle", "flash"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      announcer.announce({ kind: "alarm", alarm: true, hm, text: a.label ? `It's time: ${a.label}.` : "It's time. This is your alarm.", ...how, alarmId: a.id });
    },
  });
  timers.startTicking();
  // changes that put themselves back ("make it rain for 10 minutes", "go quiet until 3") end on time, even after a restart
  import("./lib/commands/index.mjs").then((c) => c.start()).catch((e) => console.log(`commands: ${e.message}`));
  // the no-AI understanding is indexed once, now, so no one waits for it on their first request (about a second)
  setTimeout(() => { try { intents.stats(); } catch (e) { console.log(`intents: ${e.message}`); } }, 300);
  recipes.setDeps({ search: (query, o) => web.search(query, o), emit: (type, data) => announcer.broadcast(type, data) });
  // XP: when a scheduled block ends, "Did you finish your workout?" (never on a call, while ringing, Off or Quiet,
  // or with listening stopped on the screen), and the badge and Progress page kept up to date
  xpRoutes.wire({
    announce: (item) => announcer.announce(item),
    broadcast: (type, data) => announcer.broadcast(type, data),
    blocksToday: () => { const d = store.todayISO(); return store.blocksBetween(d, d); },
    canAsk: () => quiet.state() === "active" && announcer.displayCount() > 0 && floor.free() && !(callbridge.isTalking?.() || tunein.isOn?.()) && timers.ringing().length === 0,
    env: () => ({ listen: quiet.state(), mode: quiet.modeFor("schedule"), inCall: Boolean(callbridge.isTalking?.() || tunein.isOn?.()), alarm: timers.ringing().length > 0 }),
  });
  // Funny personality: now and then, "Want to hear a joke?" (never on a call, during an alarm, a timer, cooking, the
  // morning routine, a meeting or a focus block, and only when someone's been around in the last 45 minutes)
  setInterval(() => {
    try {
      const nowHM = new Date().toTimeString().slice(0, 5), today = store.todayISO();
      const cur = store.blocksBetween(today, today).find((b) => b.start <= nowHM && nowHM < b.end);
      const env = {
        lastActivity: lastChatAt, stopped: false, inCall: callbridge.isTalking?.() || tunein.isOn?.(), timerRinging: timers.ringing().length > 0,
        cooking: Boolean(recipes.cookingNow()), morning: Boolean(morning.current?.()), meeting: cur && (cur.category === "work" || /meeting|call|class|exam/i.test(cur.title)), speaking: false,
        textOnly: false, muted: announcer.displayCount() === 0,
      };
      if (cur && ["study", "work"].includes(cur.category)) env.meeting = true;
      if (intents.jokeOfferDue(env)) announcer.announce({ kind: "jokeoffer", text: intents.makeJokeOffer("tv") });
    } catch (e) { console.log(`joke offer: ${e.message}`); }
  }, 60_000).unref?.();
}

// What the desktop notification cards do when clicked
async function overlayAction(a) {
  // a finished timer's card: +5 min / Dismiss (it running out on its own leaves the minute-by-minute reminders going)
  if (a.item?.kind === "timer") {
    if (a.type === "alarm-snoozed") timers.snooze("", 5 * 60_000);
    else if (a.type === "alarm-dismissed") timers.dismiss("");
    else if (a.type === "click") { windowRoutes.clearClosed(); await display.open().catch(() => {}); }
    return;
  }
  if (a.type === "hotkey") { await quiet.setState(quiet.state() === "off" ? "active" : "off", { from: "hotkey" }).catch(() => {}); return; }
  if (a.type === "snooze" && a.item) { try { snooze.snooze(a.item); } catch { /* nothing to snooze */ } return; }
  // the alarm card with no screen open: Snooze 9 min / Dismiss / it rang out; every surface hears it
  if (a.type === "alarm-snoozed") { try { snooze.snooze(a.item ?? undefined, 9); } catch { /* nothing to snooze */ } announcer.broadcast("alarm-dismissed", { from: "overlay", snoozed: true, at: Date.now() }); return; }
  if (a.type === "alarm-dismissed" || a.type === "alarm-timeout") { announcer.broadcast("alarm-dismissed", { from: "overlay", at: Date.now() }); return; }
  if (a.type === "click") { windowRoutes.clearClosed(); await display.open().catch(() => {}); }
}

// ---- optional: expose this laptop to Twilio through a Cloudflare quick tunnel ----
// Spawns `cloudflared tunnel --url http://localhost:PORT`, grabs the random trycloudflare.com URL,
// sets PUBLIC_URL for signature checks, and points the Dayspring number's webhooks at it.
function startTunnel() {
  // Prefer the copy in apps/desk/bin (downloaded during setup); fall back to one on PATH.
  const local = join(here, "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  const bin = existsSync(local) ? local : "cloudflared";
  const child = spawn(bin, ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let found = false;
  const onData = async (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m || found) return;
    found = true;
    process.env.PUBLIC_URL = m[0];
    console.log(`Tunnel up: ${m[0]}`);
    try {
      const r = await tw.pointWebhooks(m[0]);
      console.log(`Twilio ${r.number} now rings this app. Call or text it.`);
    } catch (err) {
      console.log(`Tunnel is up but Twilio webhooks were not set: ${err.message}`);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (e) => console.log(`cloudflared failed to start (${e.message}). Install it: winget install Cloudflare.cloudflared`));
  child.on("exit", (code) => console.log(`cloudflared exited (${code})`));
  process.on("exit", () => child.kill());
}
