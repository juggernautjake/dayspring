// Dayspring ↔ Lantern: the two apps on one computer, working as one (ecosystem-core docs/ECOSYSTEM.md; Lantern's side
// is in Lantern's docs/dev/ecosystem.md and dayspring-bridge.md). Everything here is optional: with no Lantern on the
// computer nothing changes, and every call to Lantern has a short timeout and never blocks.
//
//   - presence + events: Dayspring's presence file (port, version, token), /api/eco/hello, /api/eco/event (token),
//     /api/eco/events (SSE); it tells Lantern about the alarm, quiet time, calls, study blocks, who is speaking and who
//     owns the mic, and it announces what Lantern tells it (course offers, friend requests, finished units, reminders)
//   - status: Lantern's courses and progress for the study cards and "what's my next lesson"
//   - one account: "Connect to Lantern" (use Lantern's own sign-in, email + password, or an emailed sign-in link; a 6-digit
//     code only on hubs whose email includes one) when Lantern isn't installed yet (the session stays in
//     data/lantern-session.json, never in .env) and the one-time handoff to Lantern when it's installed
//   - installing Lantern for someone (download → extract → quiet installer → open), with their OK at every step
//   - voice: "what's my next lesson", "open Python", "send the Python course to Sam", "accept the course"…
import { createEco } from "../vendor/ecosystem-core/lib/eco.mjs";
import { createCredentials } from "../vendor/ecosystem-core/lib/credentials.mjs";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as bus from "./bus.mjs";
import * as settings from "./settings.mjs";
import * as store from "./store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const STATE_FILE = join(DATA, "lantern.json");
const SESSION_FILE = join(DATA, "lantern-session.json");
const PKG = (() => { try { return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")); } catch { return {}; } })();
const LAUNCH_URL = "https://github.com/juggernautjake/lantern/releases/latest/download/Lantern.zip";
const GUIDE_URL = "https://github.com/juggernautjake/lantern/blob/main/docs/install.md";

// ---- small helpers ------------------------------------------------------------------------------------------------
const readJ = (f, d) => { try { return JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { return d; } };
const writeJ = (f, v) => { mkdirSync(dirname(f), { recursive: true }); const t = f + ".tmp"; writeFileSync(t, JSON.stringify(v, null, 2)); renameSync(t, f); };
const state = () => ({ links: {}, seen: [], micOwner: "dayspring", hub: null, installDir: null, ...readJ(STATE_FILE, {}) });
const saveState = (patch) => { const s = { ...state(), ...patch }; s.seen = (s.seen ?? []).slice(-300); writeJ(STATE_FILE, s); return s; };
const localAppData = () => process.env.LOCALAPPDATA || join(process.env.USERPROFILE || ROOT, "AppData", "Local");
export const lanternDataDir = () => process.env.LANTERN_DATA || join(localAppData(), "Lantern");
export const defaultInstallDir = () => process.env.DAYSPRING_LANTERN_DIR || join(localAppData(), "Programs", "Lantern");
const zipUrl = () => process.env.DAYSPRING_LANTERN_ZIP || LAUNCH_URL;
const short = (t) => String(t ?? "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+\d{3}$/, "").trim();   // "Intro to Python 101" → "Python"
const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

let announce = () => {};                // set by start(): speaks + shows (announcer.announce)
let port = 4747;
let eco = null;
export const ecoApi = () => eco;
export const version = () => PKG.version ?? "0.0.0";

// ---- presence and events ------------------------------------------------------------------------------------------
export function start({ port: p = 4747, announce: say = () => {} } = {}) {
  port = p; announce = say;
  // test copies (dry-run devices) stay out of the real ecosystem folder unless a test gives them their own
  if (process.env.DAYSPRING_NO_ECO === "1" || (process.env.DAYSPRING_DEVICES_DRYRUN === "1" && !process.env.ECOSYSTEM_DIR)) return;
  eco = createEco({ app: "dayspring", version: () => PKG.version ?? "0.0.0", port: () => port, dataDir: DATA, onEvent: (ev) => { onEvent(ev).catch(() => {}); } });
  if (state().micOwner !== "dayspring" || state().micAuto) saveState({ micOwner: "dayspring", micAuto: false });     // Dayspring owns the mic while it runs (until handed over)
  try { eco.writePresence(); } catch (e) { console.log("Lantern link: couldn't write the presence file (" + e.message + ")"); }
  process.on("exit", () => { try { eco.removePresence(); } catch { /* gone */ } });
  // tell a running Lantern we're here, and that Dayspring listens for wake words while it runs
  setTimeout(() => { send("app.started", { app: "dayspring" }); send("mic.owner", { app: state().micOwner === "lantern" ? "lantern" : "dayspring" }); }, 1500);
  // the alarm going off: Lantern goes quiet
  bus.on((type, data) => { if (type === "announce" && data?.alarm) send("alarm", {}); });
  // every 20 s: quiet time, calls, study blocks, offers waiting on the hub
  setInterval(() => { tick().catch(() => {}); }, 20_000).unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 5000).unref?.();
  applySharedKey();
}
export function stopping() { return send("app.stopping", { app: "dayspring" }); }
// best effort, never throws, never waits long
export function send(type, data) {
  if (!eco) return Promise.resolve(null);
  return eco.send(type, data).then((r) => { if (r?.event) streamOut(r.event); return r; }).catch(() => null);
}
// GET /api/eco/events: what Dayspring tells the other apps, as a live stream (read-only)
const outClients = new Set();
function streamOut(ev) { const msg = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`; for (const c of outClients) { try { c.write(msg); } catch { outClients.delete(c); } } }
export function addEcoClient(res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`event: hello\ndata: ${JSON.stringify({ app: "dayspring", version: PKG.version ?? "0.0.0" })}\n\n`);
  outClients.add(res);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 25_000); ping.unref?.();
  res.on("close", () => { clearInterval(ping); outClients.delete(res); });
}

// Lantern speaking → Dayspring's pages wait (the alarm doesn't); Dayspring speaking → Lantern waits
let peerSpeaking = { on: false, until: 0 };
let selfSpeaking = false;
export function peerSpeakingNow() { return peerSpeaking.on && Date.now() < peerSpeaking.until; }
export function selfSpeakingChanged(on) {
  on = Boolean(on);
  if (on === selfSpeaking) return;
  selfSpeaking = on;
  send(on ? "speaking.start" : "speaking.stop", { app: "dayspring" });
}

// who listens for wake words: Dayspring while it runs, unless the owner handed the mic to Lantern
export const micOwner = () => (state().micOwner === "lantern" ? "lantern" : "dayspring");
export function setMicOwner(app, { auto = false } = {}) {
  const a = app === "lantern" ? "lantern" : "dayspring";
  saveState({ micOwner: a, micAuto: auto && a === "lantern", ...(auto ? {} : { micManualAt: Date.now() }) });
  bus.broadcast("mic-owner", { app: a });
  send("mic.owner", { app: a });
  return a;
}

let last = { dnd: null, inCall: null, blockKey: null };
let deps = { tunein: null, callbridge: null };
export function setDeps(d) { deps = { ...deps, ...d }; }
async function tick() {
  if (!eco) return;
  // quiet time (Dayspring's "silent" mode, with its end time)
  const s = settings.get();
  const dnd = s.mode === "silent";
  if (dnd !== last.dnd) { last.dnd = dnd; send("dnd", { on: dnd, until: dnd ? (s.until ?? null) : null }); }
  // a call in the headset (Tune in) or talking into Discord
  let inCall = false;
  try { inCall = Boolean(deps.tunein?.status?.().on) || Boolean(deps.callbridge?.status?.().talk); } catch { /* not loaded */ }
  if (inCall !== last.inCall) { last.inCall = inCall; send("call.state", { inCall }); }
  // nobody can hear Dayspring (no screen open, Tune in off) and Lantern is running: Lantern may listen until a screen opens
  try {
    const screens = bus.displayCount(), tuned = Boolean(deps.tunein?.status?.().on), st = state();
    if (!screens && !tuned && st.micOwner === "dayspring" && Date.now() - (st.micManualAt ?? 0) > 10 * 60_000 && (await running())) setMicOwner("lantern", { auto: true });
    else if ((screens || tuned) && st.micOwner === "lantern" && st.micAuto) setMicOwner("dayspring");
  } catch { /* not important */ }
  // a study block linked to a Lantern course has just begun
  const now = new Date(), hm = now.toTimeString().slice(0, 5), today = store.todayISO();
  try {
    const links = state().links ?? {};
    if (Object.keys(links).length) {
      const plan = store.planBetween(today, today);
      const blocks = (Array.isArray(plan) ? plan : plan?.[today] ?? plan?.blocks ?? []).flat?.() ?? [];
      for (const b of blocks) {
        const link = links[b.id] ?? (b.routineId ? links[b.routineId] : null);
        if (!link || b.start !== hm) continue;
        const key = `${today}|${b.id}|${hm}`;
        if (last.blockKey === key) continue;
        last.blockKey = key;
        send("schedule.block.started", { title: b.title, course: link.course, lesson: link.lesson ?? null });
      }
    }
  } catch { /* the plan couldn't be read this minute */ }
  // not installed / not running: check the hub for waiting offers and friend requests (every 60 s)
  if (!(await running()) && session() && Date.now() - lastPoll > 60_000) { lastPoll = Date.now(); pollHub().catch(() => {}); }
}
let lastPoll = 0;

// ---- what Lantern tells us ----------------------------------------------------------------------------------------
const seen = (id) => { const s = state(); if (s.seen.includes(id)) return true; saveState({ seen: [...s.seen, id] }); return false; };
let pending = null;          // the question Dayspring just asked: { kind: "offer"|"friend"|"install"|"node"|"send", data, at }
const ask = (kind, data) => { pending = { kind, data, at: Date.now() }; };
export const pendingQuestion = () => (pending && Date.now() - pending.at < 10 * 60_000 ? pending : null);

async function onEvent(ev) {
  const d = ev.data ?? {};
  switch (ev.type) {
    case "speaking.start": peerSpeaking = { on: true, until: Date.now() + 20_000 }; bus.broadcast("peer-speaking", { app: ev.source, on: true }); return;
    case "speaking.stop": peerSpeaking = { on: false, until: 0 }; bus.broadcast("peer-speaking", { app: ev.source, on: false }); return;
    case "mic.owner": { const a = d.app === "lantern" ? "lantern" : "dayspring"; if (a !== micOwner()) { saveState({ micOwner: a }); bus.broadcast("mic-owner", { app: a }); } return; }
    case "app.stopping": if (micOwner() === "lantern") { saveState({ micOwner: "dayspring" }); bus.broadcast("mic-owner", { app: "dayspring" }); } statusCache = null; bus.broadcast("lantern", { kind: "status" }); return;
    case "app.started": case "user.signed_in": case "user.signed_out": statusCache = null; bus.broadcast("lantern", { kind: "status" }); return;
    case "course.offered": return offerArrived({ id: d.offerId ?? ev.id, from: d.from, course: d.course, courseTitle: d.courseTitle, message: d.message }, true);
    case "course.accepted": statusCache = null; bus.broadcast("lantern", { kind: "status" }); return card({ id: "acc-" + ev.id, type: "info", title: "Lantern", text: `${d.courseTitle ?? short(d.course)} is in your Lantern courses.` });
    case "course.declined": return card({ id: "dec-" + ev.id, type: "info", title: "Lantern", text: `You declined ${d.courseTitle ?? short(d.course)}.` });
    case "course.updated": return card({ id: "upd-" + ev.id, type: "info", title: "Lantern", text: `${d.title ?? short(d.course)} was updated. Your progress is kept.` });
    case "friend.request": return friendArrived({ id: d.requestId, from: d.from, message: d.message }, true);
    case "friend.accepted": {
      const isOwner = Boolean((await status())?.owner);
      const text = `${d.name} accepted your friend request on Lantern.${isOwner ? ` Want to send ${d.name} a course?` : ""}`;
      card({ id: "fa-" + ev.id, type: "info", title: "Lantern", text });
      if (isOwner) ask("send-to", { name: d.name, userId: d.userId });
      return speak(text, isOwner);
    }
    case "lesson.started": case "lesson.completed": statusCache = null; bus.broadcast("lantern", { kind: "status" }); return;
    case "unit.completed": statusCache = null; bus.broadcast("lantern", { kind: "status" }); return speak(`You finished ${d.title}${d.courseTitle ? ` of ${short(d.courseTitle)}` : ""}. Nice work!`);
    case "reminder.due": return announce({ kind: "reminder", text: d.text, reminder: { text: d.text }, from: "lantern" });
    case "study.goal": case "streak": saveState({ [ev.type === "streak" ? "streak" : "goal"]: { ...d, at: Date.now() } }); return;
    case "app.update.available": if (d.app === "lantern") card({ id: "lu-" + d.version, type: "update", title: "Lantern update", text: `Lantern ${d.version} is ready.${d.notes ? " " + String(d.notes).slice(0, 200) : ""}`, buttons: [{ label: "Open Lantern", action: "open" }] }); return;
    case "schedule.block.request": return studyBlockRequested(d);
    default: return;
  }
}
function speak(text, listen = false) { announce({ kind: "lantern", title: "Lantern", text, ask: listen }); }
// a card on the Dayspring screen, with the Lantern chip (public/lantern.js draws it)
function card(c) { bus.broadcast("lantern", { kind: "card", card: { at: Date.now(), buttons: [], ...c } }); }

async function offerArrived(o, fromLantern) {
  if (seen("offer:" + o.id)) return;
  const title = o.courseTitle ?? o.course;
  const inst = await installed();
  const text = `${o.from ?? "Someone"} wants to send you a course on Lantern: ${title}.${o.message ? ` They said: ${o.message}.` : ""} ${inst ? "Want to accept it?" : "Want me to install Lantern for you?"}`;
  card({ id: "offer-" + o.id, type: "offer", title: "Course invitation", text: `${o.from ?? "Someone"} wants to send you a course: ${title}.`, note: o.message ?? "",
    buttons: inst ? [{ label: "Accept", action: "accept-offer", primary: true }, { label: "Decline", action: "decline-offer" }, { label: "Open Lantern", action: "open" }]
      : [{ label: "Install Lantern", action: "install", primary: true }, { label: "Show me the steps", action: "guide" }, { label: "Not now", action: "dismiss" }],
    data: { offerId: o.id, course: o.course, title, via: fromLantern ? "lantern" : "hub" } });
  ask(inst ? "offer" : "install", { offerId: o.id, course: o.course, title, via: fromLantern ? "lantern" : "hub" });
  speak(text, true);
}
async function friendArrived(r, fromLantern) {
  if (seen("friend:" + r.id)) return;
  card({ id: "friend-" + r.id, type: "friend", title: "Friend request", text: `${r.from ?? "Someone"} wants to be friends on Lantern.`, note: r.message ?? "",
    buttons: [{ label: "Accept", action: "accept-friend", primary: true }, { label: "Decline", action: "decline-friend" }, { label: "Ignore", action: "ignore-friend" }],
    data: { requestId: r.id, from: r.from, via: fromLantern ? "lantern" : "hub" } });
  ask("friend", { requestId: r.id, from: r.from, via: fromLantern ? "lantern" : "hub" });
  speak(`${r.from ?? "Someone"} sent you a friend request on Lantern.${r.message ? ` They said: ${r.message}.` : ""} Want to accept it?`, true);
}
function studyBlockRequested(d) {
  const days = Array.isArray(d.days) && d.days.length ? d.days.map((x) => (typeof x === "number" ? store.WEEKDAYS[x] : String(x).slice(0, 3).toLowerCase())) : ["mon", "tue", "wed", "thu", "fri"];
  const [h, m] = String(d.time).split(":").map(Number);
  const endMin = h * 60 + m + (Number(d.minutes) || 30);
  const end = `${String(Math.floor(Math.min(endMin, 1439) / 60)).padStart(2, "0")}:${String(Math.min(endMin, 1439) % 60).padStart(2, "0")}`;
  try {
    const r = store.addRoutine({ title: d.title || "Study", category: "study", days, start: String(d.time).slice(0, 5), end, description: d.course ? `Lantern course: ${d.course}` : "" });
    const s = state(); s.links[r.id] = { course: d.course ?? null, lesson: d.lesson ?? null }; saveState({ links: s.links });
    bus.broadcast("refresh", { reason: "lantern-study-block" });
    const when = days.length === 5 && !days.includes("sat") && !days.includes("sun") ? "on weekdays" : days.length === 7 ? "every day" : "on " + days.join(", ");
    speak(`I've added study time for ${String(d.title ?? "your course").replace(/^study\s+/i, "")} at ${spoken(d.time)} ${when}.`);
  } catch (e) { card({ id: "sb-" + randomUUID(), type: "info", title: "Lantern", text: "I couldn't add that study time: " + e.message }); }
}
const spoken = (t) => { const [h, m] = String(t).split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "p.m." : "a.m."}`; };

// ---- Lantern's status (its local API) -----------------------------------------------------------------------------
let statusCache = null;
export async function running() { return Boolean(eco && (await eco.peer("lantern"))); }
export async function installed() {
  if (await running()) return true;
  const dirs = [state().installDir, defaultInstallDir()].filter(Boolean);
  return dirs.some((d) => existsSync(join(d, "scripts", "launch.mjs")));
}
export async function status({ fresh = false } = {}) {
  if (!fresh && statusCache && Date.now() - statusCache.at < 15_000) return statusCache.data;
  const r = eco ? await eco.call("lantern", "/api/local/status", { timeoutMs: 2500 }) : { ok: false };
  const data = r.ok ? r.data : null;
  statusCache = { at: Date.now(), data };
  return data;
}
export async function summary() {
  const run = await running();
  const st = run ? await status() : null;
  const sess = session();
  return {
    running: run, installed: run || (await installed()), installDir: state().installDir ?? defaultInstallDir(),
    status: st, micOwner: micOwner(), connected: sess ? { email: sess.email ?? null, name: sess.name ?? null, hub: sess.hub?.url ?? null } : null,
    hub: hubConfig(), sharedKey: keyInfo(), install: installJob ? { ...installJob, proc: undefined } : null,
  };
}
const findCourse = (st, text) => {
  const list = st?.courses ?? [];
  if (!text) return list.find((c) => c.current) ?? list.find((c) => c.installed) ?? list[0] ?? null;
  const q = norm(text);
  return list.find((c) => norm(c.title) === q || norm(short(c.title)) === q || norm(c.id) === q)
    ?? list.find((c) => norm(c.title).includes(q) || q.includes(norm(short(c.title))) || (q.length > 3 && norm(short(c.title)).startsWith(q.split(" ")[0]))) ?? null;
};
const measure = (c) => c.measure || (c.steps && c.lessons ? `${c.steps.done} of ${c.steps.total} steps · ${c.lessons.done} of ${c.lessons.total} lessons` : `${c.percent ?? 0}%`);

export async function open(course = null, lesson = null) {
  if (await running()) {
    const r = await eco.call("lantern", "/api/local/open", { method: "POST", body: { course, lesson } });
    if (r.ok) return { ok: true };
  }
  return launch(course ? (lesson ? `${course}:${lesson}` : course) : null);
}
// start Lantern hidden (its launcher opens the window, or brings the running one forward)
export function launch(target = null) {
  const dir = [state().installDir, defaultInstallDir()].filter(Boolean).find((d) => existsSync(join(d, "scripts", "launch.mjs")));
  if (!dir) return { ok: false, needsInstall: true, error: "Lantern isn't installed on this computer yet." };
  // (tests start it with no window at all: DAYSPRING_LANTERN_LAUNCH_HIDDEN=1)
  const args = [join(dir, "scripts", "launch.mjs"), ...(target ? ["--open", target] : []), ...(process.env.DAYSPRING_LANTERN_LAUNCH_HIDDEN ? ["--hidden"] : [])];
  try {
    const c = spawn(process.execPath, args, { cwd: dir, windowsHide: true, stdio: "ignore", env: { ...process.env, PORT: process.env.DAYSPRING_LANTERN_PORT || "" } });
    c.on("error", () => {}); c.unref();
    return { ok: true, started: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---- one account: the hub session (only while Lantern isn't installed) ------------------------------------------
export const session = () => readJ(SESSION_FILE, null);
const saveSession = (s) => (s ? writeJ(SESSION_FILE, s) : rmSync(SESSION_FILE, { force: true }));
// which hub: Settings → Lantern, else a hub baked into this release (config/lantern-hub.json), else Lantern's own
export function hubConfig() {
  const s = state().hub;
  if (s?.url && s?.anonKey) return s;
  const baked = readJ(join(ROOT, "config", "lantern-hub.json"), null);
  if (baked?.url && baked?.anonKey && !isSecretKey(baked.anonKey)) return { url: baked.url, anonKey: baked.anonKey, ...(baked.emailCode === true ? { emailCode: true } : {}) };
  return null;
}
const isSecretKey = (k) => /service_role|sb_secret_/i.test(String(k)) || (() => { try { return JSON.parse(Buffer.from(String(k).split(".")[1] ?? "", "base64url").toString()).role === "service_role"; } catch { return false; } })();
export function setHub({ url, anonKey }) {
  url = String(url ?? "").trim().replace(/\/+$/, ""); anonKey = String(anonKey ?? "").trim();
  if (!/^https:\/\/[\w.-]+$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error("That doesn't look like a hub address (it starts with https:// and ends in .supabase.co).");
  if (/service_role|sb_secret_/i.test(anonKey) || (() => { try { return JSON.parse(Buffer.from(anonKey.split(".")[1] ?? "", "base64url").toString()).role === "service_role"; } catch { return false; } })()) throw new Error("That's the SECRET key. Use the public (publishable or anon) key instead, and keep the secret one private.");
  if (anonKey.length < 20) throw new Error("That key looks too short. Copy the whole public key.");
  saveState({ hub: { url, anonKey } });
  return { url };
}
async function hubFetch(hub, path, { method = "POST", body, token } = {}) {
  const r = await fetch(hub.url + path, { method, headers: { "content-type": "application/json", apikey: hub.anonKey, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.msg || j.message || j.error_description || j.error || `The hub answered ${r.status}.`); e.status = r.status; throw e; }
  return j;
}
const needHub = () => {
  const hub = hubConfig();
  if (!hub) throw new Error("Dayspring doesn't know your Lantern hub yet. Ask the person who invited you for the hub address and public key (Settings → Lantern).");
  return hub;
};
const cleanEmail = (email) => {
  email = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That doesn't look like an email address.");
  return email;
};
const PORT_SELF = () => Number(process.env.PORT) || 4747;
// a signed-in hub session → data/lantern-session.json (never .env); then offers and requests are checked at once
async function startSession(hub, t, email, name) {
  if (!t?.access_token) throw new Error("Signing in didn't work. Try again.");
  saveSession({ hub, email: email || t.user?.email || null, name: name || null, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000 });
  saveState({ connecting: null });
  await rpc("lantern_me", {}).catch(() => null);      // also attaches offers and requests waiting for this email
  lastPoll = 0; setTimeout(() => pollHub().catch(() => {}), 500);
  return { connected: true, email: email || t.user?.email || null };
}
// "Email me a sign-in link": Supabase's standard email (it works on the free plan). Pressing the link on this computer
// opens /lantern/auth/callback, which hands the tokens back here (connectLink). On a hub whose email also carries a
// 6-digit code (hub.emailCode), the code works too (connectVerify).
export async function connectStart(email, name = "") {
  const hub = needHub();
  email = cleanEmail(email);
  const to = encodeURIComponent(`http://127.0.0.1:${PORT_SELF()}/lantern/auth/callback`);
  await hubFetch(hub, `/auth/v1/otp?redirect_to=${to}`, { body: { email, create_user: true, data: name ? { display_name: name } : {} } });
  saveState({ connecting: { email, name, at: Date.now() } });
  return { sent: true, email, code: Boolean(hub.emailCode) };
}
// the tokens from a pressed sign-in link (read from the page's #fragment by the callback page). The refresh token is
// swapped at once: that proves it's real, and the copy in the address bar is dead.
export async function connectLink({ refresh_token } = {}) {
  const hub = needHub();
  if (!refresh_token) throw new Error("That sign-in link was incomplete. Ask for a new one.");
  let t;
  try { t = await hubFetch(hub, "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: String(refresh_token) } }); }
  catch (e) { throw new Error("That sign-in link has expired or was already used. Ask for a new one."); }
  const c = state().connecting;
  return startSession(hub, t, t.user?.email ?? c?.email, c?.name);
}
// email + password: sign in, or (create) make the account first. The password is only used for this one request; it's
// never saved.
export async function connectPassword({ email, password, name = "", create = false } = {}) {
  const hub = needHub();
  email = cleanEmail(email);
  password = String(password ?? "");
  if (password.length < 6) throw new Error("The password needs 6 or more characters.");
  if (create) {
    const b = await hubFetch(hub, "/auth/v1/signup", { body: { email, password, data: name ? { display_name: String(name).trim() } : {} } });
    if (b?.access_token) return startSession(hub, b, email, name);
    // hubs that confirm emails first: the account exists; sign in after pressing the email's link
    if (!b?.access_token) return { connected: false, confirm: true, say: "Check your email and press the link in it, then sign in here." };
  }
  let t;
  try { t = await hubFetch(hub, "/auth/v1/token?grant_type=password", { body: { email, password } }); }
  catch (e) { throw new Error(/invalid login|credentials/i.test(e.message) ? "That email and password don't match. Try again, or use \"Email me a sign-in link\"." : /not confirmed/i.test(e.message) ? "That email isn't confirmed yet. Press the link in the email the hub sent, then try again." : e.message); }
  return startSession(hub, t, email, name);
}
// "I already have Lantern on this computer": Lantern keeps the account; Dayspring just talks to it (starting it hidden
// if it's installed but not running).
export async function connectViaLantern() {
  if (!(await running())) {
    if (!(await installed())) throw new Error("Lantern isn't on this computer yet. Install it, or sign in here with your email.");
    const l = launch(null);
    if (!l.ok) throw new Error(l.error || "Lantern didn't start.");
    for (let i = 0; i < 40 && !(await running()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await running())) throw new Error("Lantern is starting slowly. Try again in a moment.");
  }
  const st = await status({ fresh: true });
  if (!st?.signedIn) return { connected: false, via: "lantern", say: "Lantern is open but not signed in yet. Sign in there (Settings → Account & hub), and Dayspring uses that account." };
  if (session()) saveSession(null);                   // one account, kept by Lantern
  return { connected: true, via: "lantern", name: st.name ?? null };
}
// a 6-digit code (only on hubs whose sign-in email includes one: custom SMTP plus {{ .Token }})
export async function connectVerify(code) {
  const hub = hubConfig(), c = state().connecting;
  if (!hub || !c?.email) throw new Error("Start with your email address first.");
  const t = await hubFetch(hub, "/auth/v1/verify", { body: { type: "email", email: c.email, token: String(code ?? "").replace(/\s+/g, "") } });
  if (!t.access_token) throw new Error("That code didn't work. Check it, or ask for a new one.");
  return startSession(hub, t, c.email, c.name);
}
export function disconnect() { saveSession(null); return { connected: false }; }
async function freshToken() {
  const s = session(); if (!s) throw new Error("Not connected to Lantern.");
  if (Date.now() < (s.expires_at ?? 0) - 60_000) return s;
  const t = await hubFetch(s.hub, "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: s.refresh_token } });
  const n = { ...s, access_token: t.access_token, refresh_token: t.refresh_token ?? s.refresh_token, expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
  saveSession(n); return n;
}
export async function rpc(fn, args = {}) {
  const s = await freshToken();
  return hubFetch(s.hub, `/rest/v1/rpc/${fn}`, { body: args, token: s.access_token });
}
async function pollHub() {
  if (!session()) return;
  try {
    const offers = await rpc("lantern_my_offers", {});
    for (const o of Array.isArray(offers) ? offers : []) await offerArrived({ id: o.id, from: o.from_name, course: o.course_id, courseTitle: o.course_title, message: o.message }, false);
  } catch { /* the hub is down or the function isn't there: try again later */ }
  try {
    const fr = await rpc("lantern_my_friend_requests", {});
    for (const q of fr?.received ?? []) if ((q.status ?? "pending") === "pending") await friendArrived({ id: q.id, from: q.from_name, message: q.message }, false);
  } catch { /* the hub has no friends yet, or is down */ }
}
// hand the session to Lantern (one use, 5 minutes), then let go of it: two apps can't share one refresh-token chain
export async function handoff() {
  const s = session(); if (!s) return { handed: false };
  let fresh = s; try { fresh = await freshToken(); } catch { /* use what we have */ }
  const lp = eco?.readPresence("lantern");
  const file = lp?.handoff || join(lanternDataDir(), "handoff.json");
  writeJ(file, { v: 1, refresh_token: fresh.refresh_token, hub: { url: fresh.hub.url, anonKey: fresh.hub.anonKey }, created_at: Date.now(), from: "dayspring" });
  saveSession(null);
  return { handed: true, file };
}

// ---- answering offers and requests --------------------------------------------------------------------------------
export async function answerOffer(offerId, accept, { via = null, course = null } = {}) {
  if (await running()) {
    const r = await eco.call("lantern", `/api/local/offers/${encodeURIComponent(offerId)}/${accept ? "accept" : "decline"}`, { method: "POST", body: { open: true } });
    if (!r.ok) throw new Error(r.data?.error || r.error || "Lantern couldn't answer that just now.");
    statusCache = null;
    return { ok: true, say: accept ? "Done. It's downloading so it works offline." : "Okay, I've let them know." };
  }
  if (session()) {
    await rpc(accept ? "lantern_accept_offer" : "lantern_decline_offer", { p_offer: offerId });
    if (!accept) return { ok: true, say: "Okay, I've let them know." };
    if (await installed()) { await handoff().catch(() => {}); launch(course); return { ok: true, say: "Accepted. I'm opening Lantern so it can download." }; }
    ask("install", { offerId, course, accepted: true });
    return { ok: true, say: "Accepted. Lantern isn't on this computer yet. Want me to install it now?" };
  }
  throw new Error("Lantern isn't running, and Dayspring isn't connected to it.");
}
export async function answerFriend(requestId, action) {
  const act = ["accept", "decline", "ignore", "cancel"].includes(action) ? action : "ignore";
  if (await running()) {
    const r = await eco.call("lantern", `/api/local/friend-requests/${encodeURIComponent(requestId)}/${act}`, { method: "POST", body: {} });
    if (!r.ok) throw new Error(r.data?.error || r.error || "Lantern couldn't answer that just now.");
  } else if (session()) await rpc("lantern_respond_friend_request", { p_request: requestId, p_action: act });
  else throw new Error("Lantern isn't running, and Dayspring isn't connected to it.");
  if (act === "accept" && !(await installed())) { ask("install", {}); return { ok: true, say: "You're friends now. They can send you courses in Lantern. Want me to install Lantern so you're ready?" }; }
  return { ok: true, say: act === "accept" ? "You're friends now." : act === "decline" ? "Okay, I declined it." : "Okay, I'll leave it for later." };
}
export async function friendRequest(to, message = "") {
  if (await running()) {
    const r = await eco.call("lantern", "/api/local/friends/request", { method: "POST", body: { to, message } });
    if (!r.ok) throw new Error(r.data?.error || r.error || "Lantern couldn't send that.");
    return r.data;
  }
  if (session()) return rpc("lantern_send_friend_request", { p_to: to, p_message: message });
  throw new Error("Lantern isn't running, and Dayspring isn't connected to it.");
}
async function people() {
  if (await running()) {
    const [p, f] = await Promise.all([eco.call("lantern", "/api/local/people"), eco.call("lantern", "/api/local/friends")]);
    const list = [...(f.ok ? (f.data?.friends ?? []).map((x) => ({ id: x.id, name: x.display_name, friend: true })) : []), ...(p.ok ? (p.data?.people ?? p.data ?? []).map((x) => ({ id: x.id ?? x.user_id, name: x.display_name ?? x.name, email: x.email })) : [])];
    return { list, owner: p.ok, forbidden: p.status === 403 };
  }
  if (session()) { const l = await rpc("lantern_people_list", {}).catch(() => []); return { list: (Array.isArray(l) ? l : []).map((x) => ({ id: x.id ?? x.user_id, name: x.display_name, email: x.email })), owner: true }; }
  return { list: [], owner: false, none: true };
}
export async function sendCourse(to, courseText, message = "") {
  const st = await status();
  const c = findCourse(st, courseText);
  const body = { to, course: c?.id ?? courseText, message };
  if (await running()) {
    const r = await eco.call("lantern", "/api/local/send", { method: "POST", body });
    if (r.status === 403) throw new Error("Only the owner of your Lantern hub can send courses.");
    if (!r.ok) throw new Error(r.data?.error || r.error || "Lantern couldn't send that.");
    return { ok: true, title: c?.title ?? courseText };
  }
  if (session()) { await rpc("lantern_send_offer", { p_to: to, p_course: body.course, p_message: message }); return { ok: true, title: c?.title ?? courseText }; }
  throw new Error("Lantern isn't running, and Dayspring isn't connected to it.");
}

// ---- installing Lantern -------------------------------------------------------------------------------------------
let installJob = null;      // { id, step, progress, message, ok, exitCode, dir, course }
const STEP_SAY = { download: "Downloading Lantern…", extract: "Unpacking it…", node: "Checking your computer…", data: "Making a place for your courses…", deps: "Getting Lantern's parts…", selftest: "Making sure it starts…", shortcuts: "Adding Lantern to your Start menu…", protocol: "Adding Lantern to your Start menu…", done: "Lantern is installed." };
function jobUpdate(patch) {
  installJob = { ...installJob, ...patch, at: Date.now() };
  bus.broadcast("lantern", { kind: "install", job: { ...installJob, proc: undefined } });
  return installJob;
}
export const installStatus = () => (installJob ? { ...installJob, proc: undefined } : null);
export async function install({ dir = null, course = null, installNode = false } = {}) {
  if (installJob && !["done", "failed", "needs-node", "no-winget"].includes(installJob.step)) return installStatus();
  dir = dir || installJob?.dir || defaultInstallDir();
  installJob = { id: randomUUID(), step: "download", progress: 0, message: STEP_SAY.download, ok: true, exitCode: null, dir, course: course ?? installJob?.course ?? null, startedAt: Date.now() };
  jobUpdate({});
  runInstall({ dir, installNode }).catch((e) => jobUpdate({ step: "failed", ok: false, message: e.message }));
  return installStatus();
}
async function runInstall({ dir, installNode }) {
  const tmp = join(DATA, "tmp"); mkdirSync(tmp, { recursive: true });
  const zip = join(tmp, "Lantern.zip");
  const haveProgram = existsSync(join(dir, "scripts", "install.ps1"));
  if (!haveProgram || !installNode) {
    // 1. download (never run anything from the zip)
    let r;
    try { r = await fetch(zipUrl(), { redirect: "follow", signal: AbortSignal.timeout(300_000) }); } catch (e) { throw new Error("I couldn't download Lantern. Check the internet connection and try again."); }
    if (!r.ok || !r.body) throw new Error(`I couldn't download Lantern (the server said ${r.status}). Try again in a little while.`);
    const total = Number(r.headers.get("content-length")) || 0;
    const chunks = []; let got = 0, lastPct = -1;
    for await (const ch of r.body) { chunks.push(ch); got += ch.length; const pct = total ? Math.floor((got / total) * 100) : 0; if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; jobUpdate({ progress: Math.round(pct * 0.3) }); } }
    writeFileSync(zip, Buffer.concat(chunks.map((c) => Buffer.from(c))));
    // 2. extract into a temp folder, then move it into place (never a half-extracted folder)
    jobUpdate({ step: "extract", progress: 32, message: STEP_SAY.extract });
    const partial = dir + ".partial-" + Date.now();
    mkdirSync(partial, { recursive: true });
    // Windows' own tar (Windows 10 1803+ and 11), else PowerShell's Expand-Archive; never another tar on the PATH
    const sysTar = process.platform === "win32" ? join(process.env.WINDIR || "C:\\Windows", "System32", "tar.exe") : "tar";
    const code = process.platform !== "win32" || existsSync(sysTar)
      ? await run(sysTar, ["-xf", zip, "-C", partial])
      : await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${partial.replace(/'/g, "''")}' -Force`]);
    if (code !== 0 || !existsSync(join(partial, "scripts", "install.ps1"))) { rmSync(partial, { recursive: true, force: true }); throw new Error("The Lantern download looks damaged. Try again."); }
    let old = null;
    if (existsSync(dir)) { old = dir + ".old-" + Date.now(); renameSync(dir, old); }
    mkdirSync(dirname(dir), { recursive: true });
    try { renameSync(partial, dir); } catch (e) { if (old) renameSync(old, dir); rmSync(partial, { recursive: true, force: true }); throw new Error("I couldn't put Lantern in " + dir + ": " + e.message); }
    if (old) rmSync(old, { recursive: true, force: true });
    rmSync(zip, { force: true });
  }
  // 3. the quiet installer, hidden, reporting progress in a status file
  jobUpdate({ step: "node", progress: 40, message: STEP_SAY.node });
  const statusFile = join(tmp, "lantern-install-status.json");
  rmSync(statusFile, { force: true });
  const extra = String(process.env.DAYSPRING_LANTERN_INSTALL_FLAGS ?? "").split(/\s+/).filter(Boolean);
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, "scripts", "install.ps1"), "--quiet", "--no-start", "--status", statusFile, ...(installNode ? ["--install-node"] : []), ...extra];
  let lastStep = null;
  const poll = setInterval(() => {
    const s = readJ(statusFile, null);
    if (s?.step && s.step !== lastStep) { lastStep = s.step; jobUpdate({ step: s.step === "done" ? "installing" : s.step, progress: 40 + Math.round((Number(s.progress) || 0) * 0.55), message: STEP_SAY[s.step] ?? s.message ?? "Installing…" }); }
  }, 500);
  const code = await run("powershell.exe", args, { cwd: dir });
  clearInterval(poll);
  const fin = readJ(statusFile, {});
  if (code === 10) { ask("node", { dir }); jobUpdate({ step: "needs-node", ok: false, exitCode: 10, message: "Lantern needs a free program called Node.js. Install it now?" }); return; }
  if (code === 11 || code === 13) { jobUpdate({ step: "no-winget", ok: false, exitCode: code, message: "I can't install Node.js on this computer by myself. Open nodejs.org, press the LTS button, install it, then try again.", url: "https://nodejs.org" }); return; }
  if (code === 12) {
    if (!installJob.retried) { installJob.retried = true; rmSync(dir, { recursive: true, force: true }); return runInstall({ dir, installNode }); }
    throw new Error(fin.message || "Lantern's self-check failed twice. Show the steps to install it by hand.");
  }
  if (code !== 0) throw new Error(fin.message || `The Lantern installer stopped (code ${code}).`);
  saveState({ installDir: dir });
  jobUpdate({ step: "done", progress: 100, ok: true, exitCode: 0, message: STEP_SAY.done });
  // 4. sign in once: hand our session over, then open Lantern at the course
  await handoff().catch(() => {});
  launch(installJob.course);
  speak("Lantern is installed. I'm opening it now.");
}
function run(cmd, args, { cwd = undefined } = {}) {
  return new Promise((resolve) => {
    let c;
    try { c = spawn(cmd, args, { cwd, windowsHide: true, stdio: "ignore", env: { ...process.env, PORT: "" } }); } catch { return resolve(-1); }
    c.on("error", () => resolve(-1));
    c.on("exit", (code) => resolve(code ?? -1));
  });
}

// ---- the shared AI key (with the person's OK) ---------------------------------------------------------------------
let cred = null;
const creds = () => (cred ??= createCredentials({ app: "dayspring" }));
function keyInfo() { try { const p = creds().peek(); return { exists: Boolean(p.exists), allowed: Boolean(p.allowed), provider: p.provider ?? null, updatedBy: p.updatedBy ?? null, error: p.error ?? null }; } catch (e) { return { exists: false, error: e.message }; } }
const ENV_KEYS = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", xai: "XAI_API_KEY", elevenlabs: "ELEVENLABS_API_KEY" };
// "Use Dayspring's AI key in Lantern?" → Dayspring writes the shared file (Lantern still asks its own person)
export function shareKey() {
  const keys = Object.fromEntries(Object.entries(ENV_KEYS).map(([k, v]) => [k, process.env[v] || ""]).filter(([, v]) => v));
  if (!Object.keys(keys).length) throw new Error("Dayspring doesn't have an AI key to share yet. Add one in Settings → AI first.");
  creds().write({ provider: process.env.AI_PROVIDER || (keys.anthropic ? "anthropic" : keys.openai ? "openai" : keys.xai ? "xai" : "none"), model: process.env.AI_MODEL || "", ollamaUrl: process.env.OLLAMA_URL || "", ttsProvider: process.env.TTS_PROVIDER || "", keys });
  return keyInfo();
}
// "Use the AI key from Lantern?" → yes: Dayspring uses it (in memory only, never written to .env)
export function useSharedKey(yes) { creds().allow(Boolean(yes)); applySharedKey(); return keyInfo(); }
function applySharedKey() {
  try {
    const p = creds().peek(); if (!p.exists || !p.allowed) return;
    const own = Object.values(ENV_KEYS).slice(0, 3).some((v) => process.env[v]);
    const ai = creds().read(); if (!ai) return;
    if (!own) { for (const [k, v] of Object.entries(ENV_KEYS)) if (ai.keys?.[k] && !process.env[v]) process.env[v] = ai.keys[k]; if (ai.provider && !process.env.AI_PROVIDER) process.env.AI_PROVIDER = ai.provider; }
    else if (ai.keys?.elevenlabs && !process.env.ELEVENLABS_API_KEY) process.env.ELEVENLABS_API_KEY = ai.keys.elevenlabs;
  } catch { /* no DPAPI here, or no file */ }
}

// ---- voice and typed commands -------------------------------------------------------------------------------------
const YES = /^(yes|yeah|yep|sure|ok(ay)?|please( do)?|do it|go ahead|sounds good|yes please|absolutely|accept( it)?)\b/;
const NO = /^(no|nope|nah|not now|no thanks|decline( it)?|don'?t)\b/;
const LATER = /^(later|maybe later|ignore( it)?|not right now|remind me later)\b/;
export async function handle(text) {
  const q = norm(text).replace(/^(hey |ok |okay )?(dayspring |lantern )?/, "").trim();
  if (!q) return null;
  const p = pendingQuestion();
  // answers to the question Dayspring just asked
  if (p && (YES.test(q) || NO.test(q) || LATER.test(q))) {
    const yes = YES.test(q), later = LATER.test(q);
    pending = null;
    try {
      if (p.kind === "offer") return (await answerOffer(p.data.offerId, yes && !later, p.data)).say;
      if (p.kind === "friend") return (await answerFriend(p.data.requestId, later ? "ignore" : yes ? "accept" : "decline")).say;
      if (p.kind === "install") {
        if (!yes) return "Okay. Say \"install Lantern\" whenever you're ready.";
        if (p.data.offerId && !p.data.accepted && session()) await rpc("lantern_accept_offer", { p_offer: p.data.offerId }).catch(() => {});
        await install({ course: p.data.course ?? null });
        return `Okay. I'm installing Lantern in ${defaultInstallDir()}. I'll tell you when it's ready.`;
      }
      if (p.kind === "node") { if (!yes) return "Okay. Lantern needs Node.js before it can run; you can install it from nodejs.org."; await install({ dir: p.data.dir, installNode: true }); return "Installing Node.js first. This can take a couple of minutes."; }
      if (p.kind === "send") { if (!yes) return "Okay, I didn't send it."; const r = await sendCourse(p.data.to, p.data.course, p.data.message); return `Sent ${short(r.title)}. I'll tell you when ${p.data.name} answers.`; }
      if (p.kind === "send-to") { if (!yes) return "Okay."; return `Which course should I send ${p.data.name}? Say "send the Python course to ${p.data.name}".`; }
    } catch (e) { return e.message; }
  }
  if (p?.kind === "friend" && /^(accept|decline|ignore) (the |that |their )?friend request/.test(q)) { pending = null; try { return (await answerFriend(p.data.requestId, q.split(" ")[0])).say; } catch (e) { return e.message; } }
  if (p?.kind === "offer" && /^(accept|decline) (the |that )?course/.test(q)) { pending = null; try { return (await answerOffer(p.data.offerId, q.startsWith("accept"), p.data)).say; } catch (e) { return e.message; } }

  // the microphone
  if (/^(let lantern listen|give (the )?(mic|microphone) to lantern|lantern (can )?listen)$/.test(q)) { setMicOwner("lantern"); return "Okay, Lantern is listening now. Say \"Dayspring, take the mic back\" when you want me again."; }
  if (/^(take (the )?(mic|microphone) back|dayspring listen|you listen)$/.test(q)) { setMicOwner("dayspring"); return "Okay, I'm listening again."; }

  const mentionsLantern = /\blantern\b/.test(q);
  // install / open
  if (/^install lantern$/.test(q)) {
    if (await installed()) return "Lantern is already on this computer. Say \"open Lantern\".";
    ask("install", {}); return `Lantern is a free learning app. I'll put it in ${defaultInstallDir()}. Okay?`;
  }
  if (/^open lantern$/.test(q)) { const r = await open(); return r.ok ? "Opening Lantern." : r.needsInstall ? "Lantern isn't on this computer yet. Say \"install Lantern\" and I'll set it up." : r.error; }

  // study: needs Lantern running for real numbers
  const isStudy = /\b(next lesson|how far am i|my progress|what courses do i have|my courses|open my course|open (the )?(.+?) (course|lesson)|continue (my )?(course|lesson|studying))\b/.test(q) || (/^open (.+)$/.test(q) && q.split(" ").length <= 4);
  if (isStudy || mentionsLantern) {
    const st = (await running()) ? await status({ fresh: true }) : null;
    if (/\bwhat courses do i have|\bmy (lantern )?courses\b/.test(q)) {
      if (!st) return (await installed()) ? "Lantern isn't open. Say \"open Lantern\" and ask me again." : null;
      if (!st.courses?.length) return "You don't have any courses in Lantern yet.";
      return "In Lantern you have " + st.courses.map((c) => `${short(c.title)}, ${measure(c)}`).join("; ") + ".";
    }
    if (/\bnext lesson\b/.test(q)) {
      if (!st) return (await installed()) ? "Lantern isn't open. Say \"open Lantern\" and ask me again." : null;
      const c = findCourse(st, (q.match(/\bin (.+)$/) ?? [])[1]);
      if (!c) return "You don't have any courses in Lantern yet.";
      return c.next ? `Your next lesson in ${short(c.title)} is ${c.next.title}.` : `You've finished everything in ${short(c.title)}!`;
    }
    const far = q.match(/\b(how far am i|my progress)(?: in (.+))?$/);
    if (far) {
      if (!st) return (await installed()) && mentionsLantern ? "Lantern isn't open. Say \"open Lantern\" and ask me again." : null;
      const c = findCourse(st, far[2]); if (!c) return far[2] ? null : "You don't have any courses in Lantern yet.";
      return `In ${short(c.title)} you've done ${measure(c)}, ${c.percent ?? 0} percent.${c.minutesLeft ? ` About ${Math.round(c.minutesLeft / 60)} hours to go.` : ""}${c.next ? ` Next up: ${c.next.title}.` : ""}`;
    }
    const op = q.match(/^(?:open|continue|start)(?: my| the)? (.+?)(?: course| lesson| in lantern)?$/);
    if (op && !/^(lantern|settings|the calendar|calendar|help)$/.test(op[1])) {
      const want = op[1].replace(/^(my |the )/, "");
      const c = st ? findCourse(st, /^(course|lesson|studying|next lesson)$/.test(want) ? null : want) : null;
      if (c) { const r = await open(c.id, c.next?.id ?? null); return r.ok ? `Opening ${short(c.title)} in Lantern.` : r.error; }
      if (!st && /\b(course|lesson|studying)\b/.test(q) && (await installed())) { const r = await open(); return r.ok ? "Opening Lantern." : r.error; }
    }
  }
  // "remind me to study at 7 (for Python)" → a Dayspring block linked to the course
  const rem = q.match(/^remind me to study (?:(.+?) )?at (\d{1,2})(?::?(\d{2}))? ?(am|pm|a m|p m)?(?: (?:for|in) (.+))?$/);
  if (rem && (await running() || mentionsLantern || rem[1] || rem[5])) {
    let h = Number(rem[2]); const m = Number(rem[3] ?? 0), ap = (rem[4] ?? "").replace(" ", "");
    if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; if (!ap && h < 7) h += 12;
    const st = await status();
    const c = findCourse(st, rem[5] ?? rem[1]);
    const hm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const endMin = Math.min(h * 60 + m + 45, 1439);
    try {
      const r = store.addBlock({ date: store.todayISO(), start: hm, end: `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`, title: c ? `Study ${short(c.title)}` : "Study", category: "study", description: c ? `Lantern course: ${c.id}` : "" });
      if (c) { const s = state(); s.links[r.block.id] = { course: c.id, lesson: c.next?.id ?? null }; saveState({ links: s.links }); }
      bus.broadcast("refresh", { reason: "lantern-study" });
      return `Okay. Study${c ? ` ${short(c.title)}` : ""} is on your schedule at ${spoken(hm)} today${c ? ", and I'll open Lantern for you then" : ""}.`;
    } catch (e) { return "I couldn't add that: " + e.message; }
  }
  // "send the Python course to Sam (with the message have fun)"
  const sc = q.match(/^send (?:the )?(.+?)(?: course)? to (.+?)(?: with the message (.+))?$/);
  if (sc && ((await running()) || session()) && /\bcourse\b|\blantern\b/.test(q + " " + (findCourse(await status(), sc[1]) ? "course" : ""))) {
    // the name as they said it ("Sam", not "sam"): the words after the last " to ", before any message
    const toText = String(text).match(/\bto\s+(\S+@\S+)/)?.[1] ?? (String(text).replace(/\s+with the message\s+[\s\S]*$/i, "").match(/\bto\s+([^.!?]+?)[.!?]*\s*$/i)?.[1] ?? sc[2]).trim();
    try {
      const { list, forbidden, none } = await people();
      if (forbidden) return "Only the owner of your Lantern hub can send courses.";
      if (none) return "Lantern isn't running, and Dayspring isn't connected to it.";
      let target = null;
      if (/@/.test(toText)) target = { id: toText, name: toText };
      else {
        const hits = list.filter((x) => norm(x.name) === norm(toText) || norm(x.name).split(" ")[0] === norm(toText) || norm(x.email ?? "") === norm(toText));
        const uniq = [...new Map(hits.map((x) => [x.id, x])).values()];
        if (uniq.length > 1) return `I see more than one ${toText}: ${uniq.map((x) => x.name).join(", ")}. Which one?`;
        if (!uniq.length) return `I don't see ${toText}. What's their email address? I'll send it there, and they'll get it when they join.`;
        target = uniq[0];
      }
      const c = findCourse(await status(), sc[1]);
      ask("send", { to: target.id, name: target.name, course: c?.id ?? sc[1], message: sc[3] ?? "" });
      return `Send ${c?.title ?? sc[1]} to ${target.name}?`;
    } catch (e) { return e.message; }
  }
  // friends
  const fr = q.match(/^(?:add (.+?) as a friend(?: on lantern)?|send a friend request to (.+?)(?: on lantern)?)$/);
  if (fr && ((await running()) || session())) {
    const who = String(text).match(/\b(\S+@\S+|LNT-[A-Z0-9]{4})\b/i)?.[1] ?? (fr[1] ?? fr[2]);
    try { await friendRequest(who); return `Sent a friend request to ${who}.`; } catch (e) { return e.message; }
  }
  if (/^who are my (lantern )?friends$/.test(q) && (await running())) {
    const f = await eco.call("lantern", "/api/local/friends");
    const list = f.ok ? f.data?.friends ?? [] : [];
    if (!list.length) return "You don't have any friends on Lantern yet.";
    return "Your Lantern friends: " + list.map((x) => `${x.display_name}${x.online ? " (online" + (x.current_course_title ? `, studying ${short(x.current_course_title)}` : "") + ")" : ""}`).join(", ") + ".";
  }
  // "I finished lesson 3" → Lantern checks its own record
  const fin = q.match(/^i (?:finished|completed|did) (?:lesson|the lesson) (.+)$/);
  if (fin && (await running())) {
    const st = await status(); const c = findCourse(st, null);
    if (c) { const r = await eco.call("lantern", "/api/local/report", { method: "POST", body: { course: c.id, lesson: fin[1] } }); if (r.ok && r.data?.message) return r.data.message; }
  }
  if (/^(accept|decline) the (course|friend request)$/.test(q)) return "There isn't anything from Lantern waiting for an answer right now.";
  return null;
}

// ---- actions from the cards on the screen -------------------------------------------------------------------------
export async function action(a, data = {}) {
  switch (a) {
    case "accept-offer": return answerOffer(data.offerId, true, data);
    case "decline-offer": return answerOffer(data.offerId, false, data);
    case "accept-friend": return answerFriend(data.requestId, "accept");
    case "decline-friend": return answerFriend(data.requestId, "decline");
    case "ignore-friend": return answerFriend(data.requestId, "ignore");
    case "install": { if (data.offerId && session()) await rpc("lantern_accept_offer", { p_offer: data.offerId }).catch(() => {}); await install({ dir: data.dir || null, course: data.course ?? null }); return { ok: true, say: "Installing Lantern." }; }
    case "install-node": await install({ dir: data.dir || installJob?.dir, installNode: true }); return { ok: true };
    case "open": { const r = await open(data.course ?? null, data.lesson ?? null); if (!r.ok) throw new Error(r.error); return { ok: true }; }
    case "guide": return { ok: true, url: GUIDE_URL };
    case "dismiss": return { ok: true };
    default: throw new Error("Unknown action.");
  }
}

// ---- context for the assistant ------------------------------------------------------------------------------------
export function contextText() {
  const c = statusCache?.data;
  if (!c?.courses?.length) return "";
  return "Lantern (the owner's learning app) courses: " + c.courses.map((x) => `${short(x.title)} (${measure(x)}${x.next ? `, next: ${x.next.title}` : ""})`).join("; ") + ". For Lantern questions (next lesson, progress, opening a course, sending a course, friend requests) the built-in Lantern commands answer; say them plainly.";
}
export const _test = { onEvent, findCourse, measure, short, norm, state, saveState, setPending: (x) => { pending = x ? { ...x, at: Date.now() } : null; } };
