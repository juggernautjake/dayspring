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
import * as updateRoutes from "./lib/update-routes.mjs";
import * as helpRoutes from "./lib/help-routes.mjs";
import * as updater from "./lib/updater.mjs";
import * as permissions from "./lib/permissions.mjs";
import * as discordRoutes from "./lib/discord-routes.mjs";
import * as callRoutes from "./lib/call-routes.mjs";
import * as studyRoutes from "./lib/study-routes.mjs";
import * as playerRoutes from "./lib/player-routes.mjs";
import * as ambientRoutes from "./lib/ambient-routes.mjs";
import * as ambient from "./lib/ambient.mjs";
import * as keepawake from "./lib/keepawake.mjs";
import * as snooze from "./lib/snooze.mjs";
import * as windowRoutes from "./lib/window-routes.mjs";
import * as display from "./lib/display.mjs";
import * as screenlog from "./lib/screenlog.mjs";
import * as documentRoutes from "./lib/document-routes.mjs";
import * as connectorRoutes from "./lib/connector-routes.mjs";
import * as connectors from "./lib/connectors/index.mjs";
import * as calendarRoutes from "./lib/calendar-routes.mjs";
import * as fsRoutes from "./lib/fs-routes.mjs";
import * as toolingRoutes from "./lib/tooling-routes.mjs";
import * as welcomeRoutes from "./lib/welcome-routes.mjs";
import * as discoverRoutes from "./lib/discover-routes.mjs";
import * as discover from "./lib/discover.mjs";
import * as tunein from "./lib/tunein.mjs";
import * as callbridge from "./lib/callbridge.mjs";
import * as stt from "./lib/stt.mjs";
// A fresh install: create the data folder and any missing data files (empty, nothing personal) before anything runs.
firstrun.ensure();
// The Settings/setup wizard, updates and the in-app guide each answer their own /api routes.
const ROUTES = [setupRoutes, updateRoutes, helpRoutes, discordRoutes, callRoutes, studyRoutes, playerRoutes, ambientRoutes, windowRoutes, documentRoutes, connectorRoutes, fsRoutes, toolingRoutes, welcomeRoutes, discoverRoutes, calendarRoutes];
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

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon" };

// In-memory conversations, one per surface (desk panel, Dayspring screen). Restarting starts fresh; the schedule persists.
const histories = { desk: [], tv: [] };

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
  announcer.broadcast("claude", item);
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
  for (const r of ROUTES) if (await r.handle(req, res, { m, p, q, send, readJSON, restart: restartSelf })) return;

  // ---- starting and stopping (scripts/launch.mjs, the window bar) ----
  // open: the guided setup until it's done (once), then the Dayspring screen (the open one comes back instead of a second)
  if (m === "POST" && p === "/app/open") {
    const b = await readJSON(req).catch(() => ({}));
    windowRoutes.clearClosed();
    if (!owner.setupDone()) return send(res, 200, { setup: true, ...(await display.openSetup({ connected: announcer.clientCount() })) });
    return send(res, 200, await display.open({ screen: b.screen || undefined }));
  }
  if (m === "POST" && p === "/app/quit") {
    send(res, 200, { ok: true, text: "Dayspring is stopping." });
    announcer.broadcast("window", { action: "quit" });
    setTimeout(async () => { try { await windowRoutes.windowAction("close"); } catch { /* no window */ } try { mixer.stop(); await browser.close(); } catch { /* fine */ } process.exit(0); }, 400);
    return;
  }
  // ---- the Dayspring screen ----
  if (m === "GET" && p === "/events") return announcer.addClient(res, { page: q.get("page") ?? "", id: q.get("id") ?? "" });
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
    // wake words from Settings ("dayspring" → also "hey dayspring"); DAYSPRING_WAKE_PHRASES in .env still overrides
    const words = owner.get().wakeWords?.length ? owner.get().wakeWords : [owner.assistant().toLowerCase()];
    const phrases = (process.env.DAYSPRING_WAKE_PHRASES ? process.env.DAYSPRING_WAKE_PHRASES.split(",") : [...words, ...words.map((w) => "hey " + w)]).map((x) => x.trim().toLowerCase()).filter(Boolean);
    // the owner's device type hints (data/devices.json "typeHints"), so the screen sorts their speakers and headsets right
    let typeHints = {};
    try { typeHints = JSON.parse(readSync(join(here, "data", "devices.json"), "utf8")).typeHints ?? {}; } catch { /* none */ }
    return send(res, 200, { wakePhrases: phrases, voice: voice.voiceReady(), hasKey: hasKey(), model: modelName(), notes: files.NOTES(), fileRoot: files.ROOT(), setupDone: owner.setupDone(), ownerName: owner.get().name, assistantName: owner.assistant(), typeHints, features: owner.get().features });
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
  // The TV couldn't embed a video (its owner blocks it): play it on youtube.com in the media browser.
  if (m === "POST" && p === "/media/fallback") {
    const b = await readJSON(req);
    if (!media.policyNow().videosAllowed) return send(res, 200, { skipped: "study time" });
    return send(res, 200, await browser.youtubeWatch({ videoId: b.videoId, playlistId: b.playlistId }));
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
    const now = new Date(), date = store.todayISO(), hm = now.toTimeString().slice(0, 5);
    const cur = store.blocksBetween(date, date).find((b) => b.start <= hm && hm < b.end);
    const relaxed = now.getHours() >= 8 && now.getHours() < 21 && (!cur || ["flex", "home", "meal", "rest"].includes(cur.category));
    const ask = q.get("ask") === "1" && relaxed && photos.canAskToday(date);
    const photo = photos.pick({ forQuestion: ask });
    return send(res, 200, { photo, ask: Boolean(ask && photo && !photo.description), stats: photos.stats() });
  }
  if (m === "POST" && p === "/photos/showing") { const { id, asked } = await readJSON(req); photoOnScreen = id ?? null; if (asked && id) photos.markAsked(id, store.todayISO()); return send(res, 200, { ok: true }); }
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
    const { message, surface } = await readJSON(req);
    if (!message?.trim()) return send(res, 400, { error: "message is required" });
    const key = surface === "tv" ? "tv" : "desk";
    transcripts.log({ role: "user", text: message.trim(), surface: key });
    // "tune in" / "tune out" / "answer into the call": handled right away, no AI needed
    // "minimize", "hide yourself", "show yourself", "close the screen": the display window, right away
    const wc = await windowRoutes.command(message.trim()).catch(() => null);
    if (wc) { transcripts.log({ role: "dayspring", text: wc, surface: key }); return send(res, 200, { reply: wc, changes: [], usage: null }); }
    const uc = await updateRoutes.command(message.trim(), { restart: restartSelf }).catch(() => null);
    if (uc) { transcripts.log({ role: "dayspring", text: uc, surface: key }); return send(res, 200, { reply: uc, changes: [], usage: null }); }
    const tc = await callRoutes.command(message.trim()).catch(() => null);
    if (tc) { transcripts.log({ role: "dayspring", text: tc, surface: key }); return send(res, 200, { reply: tc, changes: [], usage: null }); }
    const t0 = Date.now();
    devlog.log("sent", { surface: key, text: message.trim(), historyLen: histories[key].length });
    let out;
    try { out = await chat(histories[key], message.trim(), key === "tv" ? { surface: "tv", photo: photoOnScreen } : {}); }
    catch (err) { devlog.log("error", { where: "chat", surface: key, text: message.trim(), status: err?.status ?? null, error: String(err?.message ?? err).slice(0, 500), ms: Date.now() - t0 }); throw err; }
    histories[key] = out.history;
    transcripts.log({ role: "dayspring", text: out.reply, surface: key });
    // who answered: Claude (it used tokens), a built-in skill, the offline fallback, or a local handler
    const by = out.usage ? "claude" : out.offline ? "offline(" + out.offline + ")" : out.changes?.includes("skills") ? "skill" : out.changes?.includes("offline") ? "offline" : "local";
    devlog.log("reply", { surface: key, by, ms: Date.now() - t0, reply: out.reply, changes: out.changes, tokensIn: out.usage?.input_tokens ?? null, tokensOut: out.usage?.output_tokens ?? null, cacheRead: out.usage?.cache_read_input_tokens ?? null, historyLen: out.history?.length ?? null, open: Boolean(out.open), quiet: Boolean(out.quiet) });
    if (out.changes.length) announcer.broadcast("refresh", { reason: "chat" });
    // conversation: the TV keeps listening (no wake phrase) while a between-blocks conversation is open;
    // quiet: he asked to stop talking, so the TV goes quiet right away
    if (out.restart) setTimeout(restartSelf, 3500);      // after "Restarting, I'll be right back" has been said
    return send(res, 200, { reply: out.reply, changes: out.changes, usage: out.usage, conversation: Boolean(key === "tv" && (session.current() || out.open)), quiet: Boolean(out.quiet), speed: out.speed ?? null, photo: out.photo ?? null, panel: out.panel ?? null });
  }
  if (m === "POST" && p === "/chat/reset") { const { surface } = await readJSON(req).catch(() => ({})); histories[surface === "tv" ? "tv" : "desk"] = []; return send(res, 200, { ok: true }); }

  return send(res, 404, { error: `no route ${m} ${p}` });
}

// Page names: /display (the Dayspring screen; /tv is its older name), /setup (first-run wizard and Settings), /help (the guide)
const PAGES = { "/": "/index.html", "/tv": "/tv.html", "/display": "/tv.html", "/history": "/history.html", "/setup": "/setup.html", "/settings": "/setup.html", "/help": "/help.html", "/welcome": "/welcome.html" };
async function serveStatic(res, pathname) {
  // until setup is done, the Dayspring screen (and the plain address, which a new user is most likely to type) sends people to the wizard
  if ((pathname === "/" || pathname === "/tv" || pathname === "/display" || pathname === "/setup" || pathname === "/settings") && !owner.setupDone()) { res.writeHead(302, { location: "/welcome" }); return res.end(); }
  const rel = PAGES[pathname] ?? pathname;
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

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Requests arriving through the Cloudflare tunnel carry cf-connecting-ip. Only Twilio's
  // webhooks are allowed in from the internet; the UI and API stay laptop-only.
  const fromInternet = Boolean(req.headers["cf-connecting-ip"]) || /trycloudflare\.com$/i.test(req.headers.host ?? "");
  if (fromInternet && !url.pathname.startsWith("/twilio/")) { res.writeHead(403); return res.end("local only"); }
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (url.pathname.startsWith("/twilio/") && req.method === "POST") await twilio(req, res, url);
    // the study window's course pages (a course's own files served locally)
    // Google and Microsoft sign-ins come back here (/oauth/google, /oauth/microsoft)
    else if (await connectorRoutes.handlePage(req, res, { m: req.method, pathname: url.pathname, q: url.searchParams })) return;
    // the Spotify sign-in comes back here (/spotify/callback)
    else if (await playerRoutes.handlePage(req, res, { m: req.method, pathname: url.pathname, q: url.searchParams })) return;
    else if (await studyRoutes.handlePage(req, res, { m: req.method, pathname: url.pathname, q: url.searchParams })) return;
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
  // an update from 1.0.0 took the downloaded helpers (bin/) away with the old files: bring them back
  try { if (updater.restoreHelpers()) console.log("Put the downloaded helpers (bin) back after the update."); } catch { /* not important */ }
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
  // While the media browser is open, keep the screen's "now playing" card in step with Spotify.
  setInterval(async () => {
    if (!browser.isOpen() || announcer.clientCount() === 0) return;
    const now = await browser.spotifyNow().catch(() => null);
    const key = now ? JSON.stringify([now.title, now.artist, now.playing]) : "";
    if (key !== lastNow) { lastNow = key; announcer.broadcast("nowplaying", { source: "spotify", ...(now ?? { playing: false }) }); }
  }, 3000);
  // The phone (Phone Link): new texts are announced ("Incoming text message from Sarah. Want me to read it?");
  // app notifications show quietly on the screen (title only; others may see it). Only when the phone feature is on.
  const phoneOn = DISPLAY_MODE && owner.feature("phone");
  if (phoneOn) phonenotify.prime();
  if (phoneOn) setInterval(() => {
    for (const n of phonenotify.poll()) {
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
  if (DISPLAY_MODE) {
    // Not until the guided setup is finished (the setup page is the window then), and never a second window: display.open()
    // brings back the one that's open (even minimized or loading) instead. When the chosen screen isn't connected, it
    // looks again every few minutes, quietly.
    let missing = 0, nextTry = 0;
    setInterval(async () => {
      if (!owner.setupDone()) return;
      if (announcer.displayCount() > 0) { missing = 0; return; }
      if (windowRoutes.closedByOwner()) return;          // they closed it on purpose: don't pop it back open
      if (screenPick() === "primary") return;
      if (++missing < 2 || Date.now() < nextTry) return;
      nextTry = Date.now() + 90_000;      // give the browser time to connect before trying again
      const r = await display.open({ screen: screenPick() }).catch(() => null);
      if (r?.noScreen) nextTry = Date.now() + 5 * 60_000;
      else if (r?.opened) console.log("Dayspring screen reopened");
    }, 30_000);
  }
  // Updates: checked now and every 6 hours. The notice (What's new + Update now / Next time / When I'm not using it) shows
  // on the screen; "idle" installs wait for a quiet half hour, never during an alarm, a call or Tune in.
  updater.onStatus((s) => announcer.broadcast("updatestatus", s));
  updater.startAuto({
    announce: (text) => announcer.announce({ kind: "update", text }),
    notify: (info) => announcer.broadcast("update", info),
    busy: () => tunein.isOn() || callbridge.isTalking() || snooze.list_().some((x) => Date.parse(x.until) - Date.now() < 30 * 60_000) || alarmSoon(),
    restart: restartSelf,
  });
  // older shortcuts started "Start Dayspring.cmd" (a command window); point them at the windowless starter
  if (process.platform === "win32") setTimeout(() => fixShortcuts(), 20_000);
  // the Dayspring screen's computer stays awake (no sleep, no idle lock) while plugged in, so alerts and alarms get through
  if (DISPLAY_MODE) keepawake.start();
  // the speakers and mics are looked up once in the background, so the Sound panel opens straight away
  setTimeout(() => devices.list().catch(() => {}), 8000);
  snooze.start();                // snoozed alarms and reminders come back, even after a restart
  discover.start();
  // connected apps that work in the background: weather alerts, calendar subscriptions, news feeds
  connectors.startBackground({ announce: (x) => announcer.announce(x) });
  // clashes between calendars are noticed and announced; the optional copy of the schedule onto Google/Outlook
  import("./lib/conflicts.mjs").then((c) => c.startWatcher({ announce: announcer.announce, broadcast: announcer.broadcast })).catch(() => {});
  import("./lib/calsync.mjs").then((c) => c.startBackground()).catch(() => {});              // now and then: popular videos and articles about the owner's interests
  ambient.keepFresh();           // the living sky: sunrise/sunset, weather and wind for the owner's location
  discordRoutes.init();          // the Discord bot logs in only when a bot token is set; otherwise it stays off
  if (TUNNEL) startTunnel();
  else if (t.publicUrl) console.log(`Public URL (from .env): ${t.publicUrl}  → point Twilio webhooks here or run with --tunnel`);
});

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
