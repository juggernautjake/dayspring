// Feature maturity and release channels: which of Dayspring's features are on in THIS install.
//
// Every user-facing feature has an entry in REGISTRY with a stage:
//   stable  the owner has confirmed it works (docs/testing-checklist.md → "Promote to stable")
//   beta    built and passing the automated tests, not yet confirmed by the owner: in production, marked "New", with an
//           off switch in Settings → This app → Features
//   dev     in progress: only in the development version
//
// The channel (which stages this build turns on):
//   production  "stable": stable + beta.  Dayspring.zip on the normal GitHub releases.
//   development "dev":    everything.     Dayspring-dev.zip on GitHub pre-releases (v1.7.0-dev.1).
// It comes from build-info.json ({ channel, version, commit }, written into the zip by scripts/release.mjs). The source
// checkout the owner runs from counts as development. A copy with neither (a plain git clone of the public repo) is
// production. DAYSPRING_CHANNEL=stable|dev overrides it (tests).
//
// THE ONE GATE: on(id). True when the feature's stage is allowed by the running channel and the owner hasn't switched
// it off. Everything a feature has asks it: its routes (404), its AI tools (left out of toolsFor), its no-AI intents,
// its Settings sections, its buttons and pages on the screen, and its background jobs (never started).
//
// Local changes, kept in data/ (never shipped):
//   data/feature-switches.json  { off: [ids], devOn: [ids] }   the owner's off switches (beta and dev features only;
//                               stable features have their own settings). devOn: dev features turned on in a PRODUCTION
//                               build, which only works with the developer preview token (lib/dev/status.mjs). This is
//                               the one documented way to try a dev feature in production (docs/dev-preview.md).
//   data/feature-stages.json    { stages: { id: { stage, verifiedBy, verifiedAt } } }   "Promote to stable" on the Testing
//                               page. In a production build a feature that is "dev" in the build is never raised by this
//                               file (only with the developer token), so editing data/ can't switch on unfinished work.
// Releases bake promotions into this file with scripts/promote-features.mjs.
//
// This file imports nothing of Dayspring's except the developer check, so any module (even one loaded while the server
// starts, with top-level await) can import it without a cycle.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDev } from "./dev/status.mjs";

export const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
export const STAGES = ["stable", "beta", "dev"];
export const CHANNELS = ["stable", "dev"];

// ---- the registry --------------------------------------------------------------------------------------------------------
// id, name, area, stage, since (the version it first shipped in, or the planned one), description.
// Gates (what hiding the feature means), all optional:
//   routes    /api path prefixes ("/money" covers /api/money and /api/money/…). When several features claim a path, the
//             LONGEST prefix decides, and the path is open if any feature with that prefix is on.
//   pages     page paths (/money.html) served only while on
//   tools     AI tool names: exact names or /regexes/
//   intents   no-AI intent id prefixes ("images." covers images.search); longest prefix decides, as with routes
//   sections  Settings section ids (public/setup.js SECTIONS); hidden when every feature that owns it is off
//   ui        CSS selectors on the Dayspring screen, hidden while off (/api/features/gate.js)
//   styles    stylesheets switched off while off (the feature IS a stylesheet)
//   jobs      background job names (startJob below)
// checklist: the test ids of testing/checklist.json for this feature (filled in when this file loads, from that file).
// verifiedBy / verifiedAt: who confirmed it and when (set by scripts/promote-features.mjs).
export const REGISTRY = [
  // ---------------------------------------------------------------------------------------------------- stable
  { id: "schedule", name: "Schedule and calendar", area: "Your day", stage: "stable", since: "1.0.0",
    description: "Day, week, month and year views, repeating items, editing by voice, drag to move, overnight items, conflicts between calendars." },
  { id: "voice", name: "Voice and talking", area: "Talking to Dayspring", stage: "stable", since: "1.0.0",
    description: "The wake word, Talk, typing, spoken replies, the no-AI understanding of everyday requests and the AI conversation." },
  { id: "alarms", name: "Alarms", area: "Your day", stage: "stable", since: "1.0.0",
    description: "The morning alarm and spoken alarms, snooze, and ringing from the desktop helper when no screen is open." },
  { id: "reminders", name: "Reminders", area: "Your day", stage: "stable", since: "1.0.0",
    description: "\"Remind me to…\" at a time or in a while, announced on time, snoozable." },
  { id: "timers", name: "Timers", area: "Your day", stage: "stable", since: "1.3.0",
    description: "Up to seven named timers at once, with cards on the screen." },
  { id: "weather", name: "Weather", area: "Your day", stage: "stable", since: "1.0.0",
    description: "The forecast on the screen and in the morning briefing, weather alerts." },
  { id: "music", name: "Music (Spotify and YouTube)", area: "Music and media", stage: "stable", since: "1.0.0",
    description: "Spotify and YouTube by voice, the in-app player, the Pop out button." },
  { id: "recipes", name: "Recipes and cooking", area: "Home", stage: "stable", since: "1.3.0",
    description: "Saving recipes, cooking mode with steps, scaling and step timers." },
  { id: "jokes", name: "Jokes and fun", area: "Talking to Dayspring", stage: "stable", since: "1.3.0",
    description: "Jokes, knock-knock, trivia and games." },
  { id: "personality", name: "Personalities", area: "Talking to Dayspring", stage: "stable", since: "1.4.0",
    description: "Characters, sliders, custom personas and the secret characters." },
  { id: "xp", name: "XP and badges", area: "Progress", stage: "stable", since: "1.4.0",
    description: "XP from confirmed check-ins, levels, streaks and the badge collection." },
  { id: "lantern", name: "Lantern bridge", area: "Apps and connections", stage: "stable", since: "1.1.0",
    description: "Works with Lantern: courses, lessons, one voice and one ear, XP from verified learning." },
  { id: "calls", name: "Calls, Tune in and Discord", area: "Apps and connections", stage: "stable", since: "1.0.0",
    description: "Tune in to calls, answer into the call, Settings → Calls, the Discord bot and chat companion." },
  { id: "meetings", name: "Meetings with Dayspring and Lantern", area: "Apps and connections", stage: "stable", since: "1.5.0",
    description: "Joining a Google Meet, who can ask, answers aloud and in chat, Lantern answering course questions, demo mode." },
  { id: "screen", name: "The screen layout", area: "Screen", stage: "stable", since: "1.0.0",
    description: "The Dayspring screen, Dayspring mini, open modes, the living sky, Fit to screen." },
  { id: "notifications", name: "Desktop notifications", area: "Screen", stage: "stable", since: "1.2.0",
    description: "Top-right notification cards, notification modes, Active / Quiet / Off." },
  { id: "settings", name: "Settings and setup", area: "This app", stage: "stable", since: "1.0.0",
    description: "The guided setup and the Settings page." },
  { id: "updates", name: "Updates", area: "This app", stage: "stable", since: "1.0.1",
    description: "Checking, downloading and installing new versions with backups and automatic rollback; the update channel." },
  { id: "permissions", name: "File permissions and fail-safes", area: "Privacy and safety", stage: "stable", since: "1.6.0",
    description: "What Dayspring may do with files, asking before changes, the Recycle Bin, the protected places." },
  { id: "activity", name: "Activity log", area: "Privacy and safety", stage: "stable", since: "1.6.0",
    description: "Every command, tool call and file change, with what changed and how to undo it." },
  { id: "faith", name: "Faith", area: "Your day", stage: "stable", since: "1.0.0",
    description: "Devotion, prayer list, Bible reading in any available version, Scripture memory, church." },
  { id: "connections", name: "Calendars and connected apps", area: "Apps and connections", stage: "stable", since: "1.0.0",
    description: "Google and Microsoft calendars, subscriptions, Notion; drafts only, never sent." },

  // ---------------------------------------------------------------------------------------------------- beta (1.6.x)
  { id: "money", name: "Money review (read-only)", area: "Apps and connections", stage: "beta", since: "1.6.0",
    description: "Reads bank, Venmo or Cash App transactions or a downloaded statement and explains where the money went. Never pays or changes anything.",
    routes: ["/money"], pages: ["/money.html"], tools: [/^money_/], intents: ["money."] },
  { id: "images", name: "Pictures from the web", area: "Music and media", stage: "beta", since: "1.6.0",
    description: "\"Show me pictures of…\": a numbered grid on the screen, view, save, more like this.",
    routes: ["/images"], tools: ["image_search", "image_control", "look_at_image"], intents: ["images."], ui: ["#dsImages"] },
  { id: "vision", name: "Picture descriptions", area: "Photos and people", stage: "beta", since: "1.6.0",
    description: "\"Describe this picture\" and \"what does this say?\" for your photos, the photo on the screen and web pictures.",
    routes: ["/vision", "/vision/describe"], tools: ["describe_image", "read_image_text"], sections: ["photos"] },
  { id: "faces", name: "Faces and people", area: "Photos and people", stage: "beta", since: "1.6.0",
    description: "Recognising the people in your own photos (off until turned on), \"Who's in this picture?\", the People page and profiles.",
    routes: ["/vision", "/people"], pages: ["/people.html"], tools: ["who_is_in_photo", "name_people_in_photo", "face_group_action", "photos_of_person", /^people_/, /^person_/], sections: ["photos"], jobs: ["vision.start"] },
  { id: "medialib", name: "Your own music and videos", area: "Music and media", stage: "beta", since: "1.6.0",
    description: "\"Play … from my computer\", shuffling a folder, finding a video, the media list on the screen.",
    routes: ["/media/local"], tools: [/^media_library_/], intents: ["medialib."], ui: [".mlpanel"], jobs: ["medialib.sources", "medialib.scan"] },
  { id: "drive", name: "Google Drive", area: "Apps and connections", stage: "beta", since: "1.6.0",
    description: "Searching, playing and managing files in one or more Google Drives.",
    routes: ["/drive"], tools: [/^drive_/], intents: ["medialib.drive"] },
  { id: "meetnotes", name: "Meeting notes", area: "Apps and connections", stage: "beta", since: "1.6.0",
    description: "Notes and a summary of a Google Meet (announced first, off-the-record parts skipped), Past meetings.",
    routes: ["/meet/notes"], ui: [".meetnotes", "#meetNotesOn", "#meetNotesNow", "#meetNotesList", "#meetNotesQ"] },
  { id: "meetinvite", name: "Google Meet invitations", area: "Apps and connections", stage: "beta", since: "1.6.1",
    description: "\"Set up a Google Meet with … tomorrow at 7\": read back, your yes, then Google emails the invitations.",
    routes: ["/mail/invite"], tools: ["meet_invite", "invite_compose", "invite_update"] },
  { id: "screenmove", name: "Moving the screen", area: "Screen", stage: "beta", since: "1.7.0",
    description: "Move the open Dayspring screen to another display from Settings → Screen or by voice (\"move Dayspring to the TV\")." },
  { id: "popfit", name: "Pop-ups fit the screen margins", area: "Screen", stage: "beta", since: "1.6.1",
    description: "Every notice, card, menu and dialog stays inside the margins set in Settings → Screen.",
    styles: ["/safe-area.css"] },
  { id: "floor", name: "Your requests come first (the floor)", area: "Talking to Dayspring", stage: "beta", since: "1.6.0",
    description: "While you talk, what Dayspring planned to say waits, then comes out one at a time; \"what were you going to say?\".",
    ui: ["#dsFloorPill"] },
  { id: "spotifyresolver", name: "Spotify plays what you asked for", area: "Music and media", stage: "beta", since: "1.6.0",
    description: "The best Spotify match for what was asked (checked, typos fixed), not just the first search result." },
  { id: "devpreview", name: "Developer preview", area: "This app", stage: "beta", since: "1.6.0",
    description: "On the developer's own computer only (signed, computer-bound token): every badge's art and every character.",
    routes: ["/dev"] },

  // ---------------------------------------------------------------------------------------------------- dev (in progress)
  { id: "email", name: "Email", area: "Apps and connections", stage: "dev", since: "1.7.0",
    description: "Every mailbox (Gmail, Outlook, Yahoo, iCloud, AOL, Zoho, any IMAP), the Mail window, the editor, reading and sending with your yes.",
    routes: ["/mail"], tools: [/^email_/], intents: ["mail."], sections: ["email", "mail"], ui: ["#mailBtn", "#mailBadge", ".mailbtnwrap", ".mailwin", ".mailhelp"], jobs: ["mail.background"] },
  { id: "gifs", name: "GIFs", area: "Music and media", stage: "dev", since: "1.7.0",
    description: "GIPHY, KLIPY, Imgur and the web at once, the GIF picker, copy, save and favourites.",
    routes: ["/gifs"], pages: ["/gifs.html"], tools: [/^gif_/], intents: ["gifs."], sections: ["gifs"], ui: ["#gifsBtn", "#dsGifs", "#dsGifsPill"] },
  { id: "devices", name: "Smart devices, strips and lights", area: "Home control", stage: "dev", since: "1.7.0",
    description: "Power strips and plugs, Wake-on-LAN, Home Assistant, lights, LED strips, Bluetooth gadgets, scenes and schedules, with safety rules.",
    routes: ["/smarthome", "/home", "/devices/home", "/smart"], pages: ["/smarthome.html"], tools: [/^device_/, /^devices_/, /^home_/, /^scene_/, /^strip_/], intents: ["devices.", "home.device", "scene."], sections: ["devices", "home"], ui: ["#devicesBtn", ".devpanel"], jobs: ["devices.schedules", "devices.poll"] },
  { id: "printers", name: "3D printers", area: "Home control", stage: "dev", since: "1.7.0",
    description: "Bambu Lab (LAN) and Creality Ender 5 Plus (USB, OctoPrint or Klipper): status, camera, pause, start with a bed-clear check and your yes.",
    routes: ["/printers"], pages: ["/printers.html"], tools: [/^printer_/, /^printers_/], intents: ["printers.", "printer."], sections: ["printers"], ui: ["#printersBtn", ".printpanel"], jobs: ["printers.poll"] },
  { id: "cameras", name: "Cameras", area: "Home control", stage: "dev", since: "1.7.0",
    description: "Webcams, IP cameras (RTSP / ONVIF), GoPro, printer cameras and trail cameras: live view, snapshots, motion alerts, recordings.",
    routes: ["/cameras"], pages: ["/cameras.html"], tools: [/^camera_/, /^cameras_/], intents: ["cameras.", "camera."], sections: ["cameras"], ui: ["#camerasBtn", ".campanel"], jobs: ["cameras.monitor", "cameras.record"] },
  { id: "remote", name: "Multi-device remote control", area: "Home control", stage: "dev", since: "1.7.0",
    description: "Several Dayspring computers linked securely: control one from another (\"turn on my home computer\" from the laptop).",
    routes: ["/remote"], pages: ["/remote-view.html"], tools: [/^remote_/], intents: ["remote."], sections: ["remote", "signin"], jobs: ["remote.engine"] },
  { id: "social", name: "Sharing with friends", area: "Apps and connections", stage: "dev", since: "1.6.0",
    // (its routes and tools are already inert unless lib/social/flag.mjs says on; that switch asks on("social") too)
    description: "Sharing memories with friends. Also behind its own developer switch (lib/social/flag.mjs); off by default even in development." },
];
const byId = new Map(REGISTRY.map((f) => [f.id, f]));
export const get = (id) => byId.get(String(id)) ?? null;
export const ids = () => REGISTRY.map((f) => f.id);

// ---- files (tests point these elsewhere) ---------------------------------------------------------------------------------
const DATA = () => process.env.DAYSPRING_DATA_DIR || join(DESK, "data");
export const files = {
  buildInfo: () => process.env.DAYSPRING_BUILD_INFO || join(DESK, "build-info.json"),
  switches: () => process.env.DAYSPRING_FEATURE_SWITCHES || join(DATA(), "feature-switches.json"),
  stages: () => process.env.DAYSPRING_FEATURE_STAGES || join(DATA(), "feature-stages.json"),
  checklist: () => process.env.DAYSPRING_CHECKLIST || join(DESK, "testing", "checklist.json"),
};
const readJSON = (f, fallback) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")) : fallback; } catch { return fallback; } };
function writeJSON(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 2) + "\n"); renameSync(tmp, f); cache.at = 0; }

// the checklist ids of each feature, from testing/checklist.json
try {
  const list = readJSON(files.checklist(), { items: [] }).items ?? [];
  for (const f of REGISTRY) f.checklist = list.filter((t) => t.feature === f.id).map((t) => t.id);
} catch { for (const f of REGISTRY) f.checklist ??= []; }

// ---- the channel ---------------------------------------------------------------------------------------------------------
// the source checkout (the one releases are made from) is the development version
export const isSource = () => existsSync(join(DESK, "dist", "Install Dayspring.cmd")) && existsSync(join(DESK, "scripts", "export.mjs"));
export function buildInfo() {
  const b = readJSON(files.buildInfo(), null);
  if (b && CHANNELS.includes(b.channel)) return { channel: b.channel, version: b.version ?? null, commit: b.commit ?? null, from: "build-info" };
  if (isSource()) return { channel: "dev", version: null, commit: null, from: "source" };
  return { channel: "stable", version: null, commit: null, from: "default" };
}
export function channel() {
  const env = String(process.env.DAYSPRING_CHANNEL ?? "").trim().toLowerCase();
  if (env === "dev" || env === "development") return "dev";
  if (env === "stable" || env === "production") return "stable";
  return cached().channel;
}
export const channelName = (c = channel()) => (c === "dev" ? "Development" : "Production");

// the local files, read again at most once a second (on() is asked a lot: every intent candidate, every tool list)
const cache = { at: 0, channel: "stable", switches: { off: [], devOn: [] }, stages: {}, dev: false };
function cached() {
  if (Date.now() - cache.at < 1000) return cache;
  const sw = readJSON(files.switches(), {}) ?? {};
  cache.switches = { off: Array.isArray(sw.off) ? sw.off.map(String) : [], devOn: Array.isArray(sw.devOn) ? sw.devOn.map(String) : [] };
  cache.stages = readJSON(files.stages(), {})?.stages ?? {};
  cache.channel = buildInfo().channel;
  cache.dev = (() => { try { return isDev(); } catch { return false; } })();
  cache.at = Date.now();
  return cache;
}
export const _clear = () => { cache.at = 0; };
// the developer preview token is on this computer (lib/dev/status.mjs)
export const developer = () => cached().dev;
// the Testing page (and promoting features) is for the development version, or the developer on a production build
export const testingVisible = () => channel() === "dev" || developer();

// ---- stages and the gate -------------------------------------------------------------------------------------------------
// the stage this install uses: the build's, raised by a local promotion (never a production build's dev feature,
// except for the developer)
export function stageOf(id) {
  const f = get(id); if (!f) return null;
  const o = cached().stages[f.id];
  if (!o || !STAGES.includes(o.stage)) return f.stage;
  if (channel() === "stable" && f.stage === "dev" && !developer()) return f.stage;
  return o.stage;
}
// on(id): the one gate every feature asks. Unknown ids are on only in the development version.
export function on(id) {
  const f = get(id);
  if (!f) return channel() === "dev";
  const st = stageOf(f.id), c = cached();
  if (st === "stable") return true;
  if (c.switches.off.includes(f.id)) return false;
  if (st === "dev" && channel() !== "dev") return c.dev && c.switches.devOn.includes(f.id);
  return true;
}
export const isOn = on;
// can the owner switch it here? stable: no (it has its own settings). beta: yes. dev: in development, or with the token.
export function switchable(id) {
  const st = stageOf(id);
  if (!st || st === "stable") return false;
  if (st === "dev" && channel() !== "dev") return developer();
  return true;
}
export function setSwitch(id, want) {
  const f = get(id);
  if (!f) throw new Error(`There's no feature called "${id}".`);
  if (!switchable(f.id)) throw new Error(stageOf(f.id) === "stable" ? `${f.name} is a finished feature; it has its own settings.` : `${f.name} is still being built and isn't part of this version.`);
  const sw = { off: [], devOn: [], ...(readJSON(files.switches(), {}) ?? {}) };
  sw.off = (sw.off ?? []).filter((x) => x !== f.id);
  sw.devOn = (sw.devOn ?? []).filter((x) => x !== f.id);
  if (!want) sw.off.push(f.id);
  else if (stageOf(f.id) === "dev" && channel() !== "dev") sw.devOn.push(f.id);
  writeJSON(files.switches(), sw);
  return on(f.id);
}
// "Promote to stable" (the Testing page): a local override, with who and when
export function promote(id, { stage = "stable", by = "owner", at = new Date().toISOString() } = {}) {
  const f = get(id);
  if (!f) throw new Error(`There's no feature called "${id}".`);
  if (!STAGES.includes(stage)) throw new Error("stage must be stable, beta or dev");
  const s = readJSON(files.stages(), {}) ?? {};
  s.stages = { ...(s.stages ?? {}), [f.id]: { stage, verifiedBy: String(by).slice(0, 80), verifiedAt: at } };
  writeJSON(files.stages(), s);
  return { id: f.id, stage: stageOf(f.id), verifiedBy: s.stages[f.id].verifiedBy, verifiedAt: at };
}
export function unpromote(id) {
  const s = readJSON(files.stages(), {}) ?? {};
  if (s.stages?.[id]) { delete s.stages[id]; writeJSON(files.stages(), s); }
  return { id, stage: stageOf(id) };
}

// ---- what hiding means: routes, pages, tools, intents, sections, the screen, jobs ----------------------------------------
const prefixHit = (path, pre) => path === pre || path.startsWith(pre.endsWith("/") || pre.endsWith(".") ? pre : pre + "/");
// the features with the longest matching prefix in `key`; null when none claims it
function claimants(key, value, hit = prefixHit) {
  let best = -1, who = [];
  for (const f of REGISTRY) for (const pre of f[key] ?? []) {
    if (!hit(value, pre)) continue;
    if (pre.length > best) { best = pre.length; who = [f]; } else if (pre.length === best && !who.includes(f)) who.push(f);
  }
  return who.length ? who : null;
}
// an /api path (without "/api") that must answer 404 now → the feature id, or null
export function routeBlocked(p) {
  const who = claimants("routes", String(p ?? ""));
  return who && !who.some((f) => on(f.id)) ? who[0].id : null;
}
export function pageBlocked(pathname) {
  const p = String(pathname ?? "").toLowerCase();
  for (const f of REGISTRY) if ((f.pages ?? []).some((x) => x.toLowerCase() === p) && !on(f.id)) return f.id;
  return null;
}
const toolHit = (name, t) => (t instanceof RegExp ? t.test(name) : t === name);
export function toolFeature(name) { const n = String(name ?? ""); for (const f of REGISTRY) if ((f.tools ?? []).some((t) => toolHit(n, t))) return f.id; return null; }
export const toolAllowed = (name) => { const id = toolFeature(name); return !id || on(id); };
export const filterTools = (list) => (list ?? []).filter((t) => toolAllowed(t?.name ?? t?.type));
const intentHit = (id, pre) => id === pre || id.startsWith(pre.endsWith(".") ? pre : pre + ".") || (pre.endsWith(".") && id === pre.slice(0, -1));
export function intentAllowed(intentId) {
  const who = claimants("intents", String(intentId ?? ""), intentHit);
  return !who || who.some((f) => on(f.id));
}
export function hiddenSections() {
  const owners = new Map();
  for (const f of REGISTRY) for (const s of f.sections ?? []) owners.set(s, [...(owners.get(s) ?? []), f]);
  const out = [...owners].filter(([, fs]) => !fs.some((f) => on(f.id))).map(([s]) => s);
  if (!testingVisible()) out.push("testing");
  return out;
}
export function hiddenUi() {
  const off = REGISTRY.filter((f) => !on(f.id));
  return { selectors: off.flatMap((f) => f.ui ?? []), styles: off.flatMap((f) => f.styles ?? []), off: off.map((f) => f.id) };
}

// Background jobs: startJob("medialib", "medialib.scan", () => …) runs it only while the feature is on, and remembers
// what ran and what didn't (GET /api/features says, and the tests check it).
const jobLog = [];
export function startJob(id, name, fn) {
  const ok = on(id);
  jobLog.push({ feature: id, job: name, started: ok, at: new Date().toISOString() });
  if (jobLog.length > 200) jobLog.shift();
  if (!ok) return false;
  try { const r = fn?.(); if (r && typeof r.catch === "function") r.catch(() => {}); } catch { /* the job's own problem */ }
  return true;
}
export const jobs = () => jobLog.slice();

// ---- for Settings and the screen -----------------------------------------------------------------------------------------
export function describe(id) {
  const f = get(id); if (!f) return null;
  const o = cached().stages[f.id] ?? null, st = stageOf(f.id);
  return { id: f.id, name: f.name, area: f.area, stage: st, buildStage: f.stage, since: f.since, description: f.description, on: on(f.id), switchable: switchable(f.id),
    offByOwner: cached().switches.off.includes(f.id), isNew: st === "beta", promoted: Boolean(o && o.stage !== f.stage && st === o.stage),
    verifiedBy: o?.verifiedBy ?? f.verifiedBy ?? null, verifiedAt: o?.verifiedAt ?? f.verifiedAt ?? null, checklist: f.checklist ?? [] };
}
export function status() {
  const b = buildInfo();
  return { channel: channel(), channelName: channelName(), build: b, developer: developer(), testing: testingVisible(), features: REGISTRY.map((f) => describe(f.id)),
    hiddenSections: hiddenSections(), ui: hiddenUi(), jobs: jobs() };
}
