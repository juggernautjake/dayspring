// NOTE (2026-09-24): Dayspring no longer changes the Windows default output. Only Dayspring's own music (Spotify, and
// YouTube in the media browser) is sent to "Voicemeeter Input" by device, so other apps are never affected.
// Voicemeeter Banana as Dayspring's mixer, so Spotify and YouTube (which can't choose their own output) can play on the
// TV and the headphones at once. It only runs while Dayspring TV runs (the launcher sets DAYSPRING_TV=1):
//   - "Voicemeeter Input" becomes the Windows default output, and the old default is saved.
//   - That input goes to A1 (the TV), A2 (the headphones) and/or A3 (the laptop speakers), following the owner's
//     "play on…" choice. The AUX input always goes to the TV and the headphones.
//   - Microphones are never sent to any output (no echo on the TV).
//   - When Dayspring stops, the old Windows default comes back.
// Without Voicemeeter, or with the mixer switched off ("stop using the mixer"), everything works as before.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { typeHint } from "./mic.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const STATE = join(here, "..", "data", "mixer-state.json");
const PS1 = join(here, "..", "scripts", "audio-default.ps1");
const DIRS = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles].filter(Boolean).map((p) => join(p, "VB", "Voicemeeter"));
const BANANA = 2;
// A1 is Voicemeeter's master clock: if its device stops (the TV turned off, the headset out of range) ALL audio stalls.
// So A1 is the laptop speakers, which are always there (silent unless he picks them); the TV and headset are A2 and A3.
const BUS = { speakers: 0, tv: 1, headphones: 2 };      // A1, A2, A3
const VAIO = 3, AUX = 4;                                 // Banana's virtual input strips

const displayMode = () => process.env.DAYSPRING_DISPLAY === "1" || process.env.DAYSPRING_TV === "1";
export function classify(label) {
  const l = String(label || "").toLowerCase();
  if (/voicemeeter|vb-audio/.test(l)) return "virtual";
  const hint = typeHint(l);
  if (/headphone|headset|buds|airpods|earphone/.test(l) || ["headset", "headphones", "earbuds"].includes(hint)) return "headphones";
  if (/display audio|hdmi|\btv\b|television|nvidia high definition|amd high definition/.test(l) || hint === "tv") return "tv";
  if (/realtek|speaker/.test(l)) return "speakers";
  return "other";
}

export function installDir() { return DIRS.find((d) => existsSync(join(d, "VoicemeeterRemote64.dll"))) ?? null; }

let api = null, connected = false, active = false, lastRouting = "", lastDevices = "", note = "";

async function load() {
  if (api) return api;
  const dir = installDir();
  if (!dir) throw new Error("Voicemeeter isn't installed");
  const koffi = (await import("koffi")).default;
  const lib = koffi.load(join(dir, "VoicemeeterRemote64.dll"));
  api = {
    login: lib.func("int32 VBVMR_Login()"),
    logout: lib.func("int32 VBVMR_Logout()"),
    run: lib.func("int32 VBVMR_RunVoicemeeter(int32 type)"),
    type: lib.func("int32 VBVMR_GetVoicemeeterType(_Out_ int32 *type)"),
    dirty: lib.func("int32 VBVMR_IsParametersDirty()"),
    set: lib.func("int32 VBVMR_SetParameters(const char *script)"),
    outCount: lib.func("int32 VBVMR_Output_GetDeviceNumber()"),
    outDesc: lib.func("int32 VBVMR_Output_GetDeviceDescA(int32 i, _Out_ int32 *type, void *name, void *hwid)"),
    inCount: lib.func("int32 VBVMR_Input_GetDeviceNumber()"),
    inDesc: lib.func("int32 VBVMR_Input_GetDeviceDescA(int32 i, _Out_ int32 *type, void *name, void *hwid)"),
  };
  return api;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Log in to Voicemeeter, starting it if it isn't running.
async function connect() {
  const a = await load();
  if (!connected) {
    const r = a.login();
    if (r < 0) throw new Error(`Voicemeeter login failed (${r})`);
    connected = true;
  }
  const t = [0];
  if (a.type(t) !== 0) {
    a.run(BANANA);
    // a login made before Voicemeeter was running never sees it, so log in again while waiting
    for (let i = 0; i < 30 && a.type(t) !== 0; i++) { await pause(500); a.logout(); a.login(); }
    if (a.type(t) !== 0) throw new Error("Voicemeeter didn't start");
    await pause(1500);
  }
  a.dirty();   // clears the "changed" flag so the next reads are fresh
  return a;
}

// Playback devices Voicemeeter can send to: MME names only. MME is shared, so the headset is never taken over from
// other apps (WDM/KS can grab it exclusively, which once cut Discord off).
function outputs(a) {
  const list = [];
  const n = a.outCount();
  for (let i = 0; i < n; i++) {
    const type = [0], name = Buffer.alloc(512), hw = Buffer.alloc(512);
    if (a.outDesc(i, type, name, hw) !== 0) continue;
    const label = name.toString("latin1").replace(/\0.*$/s, "");
    if (type[0] === 1 && label) list.push({ name: label, role: classify(label) });
  }
  return list;
}

const q = (s) => `"${String(s).replace(/"/g, "")}"`;

// Send the Windows default (Spotify, YouTube, everything) to the outputs the owner picked. Only touches Voicemeeter
// when something changed, so music doesn't blip every time this runs.
export async function route(roles = ["tv", "headphones"]) {
  if (!active) return status();
  const a = await connect();
  const devs = outputs(a);
  const pick = Object.fromEntries(Object.keys(BUS).map((r) => [r, devs.find((d) => d.role === r)?.name ?? ""]));
  const script = [];
  const devKey = JSON.stringify(pick);
  if (devKey !== lastDevices) {
    for (const [r, b] of Object.entries(BUS)) if (pick[r]) script.push(`Bus[${b}].device.mme=${q(pick[r])};`);
    for (const b of Object.values(BUS)) script.push(`Bus[${b}].Mute=0;`);
    for (const s of [0, 1, 2]) script.push(`Strip[${s}].A1=0;Strip[${s}].A2=0;Strip[${s}].A3=0;`);   // never send a mic to the speakers
    script.push(Object.entries(BUS).map(([r, b]) => `Strip[${AUX}].A${b + 1}=${r === "speakers" ? 0 : 1};`).join(""));   // AUX: the TV and the headset
    lastDevices = devKey;
  }
  // "default" means the headphones (or the laptop speakers when no headphones are plugged in)
  let want = roles.includes("default") ? [pick.headphones ? "headphones" : "speakers"] : roles.filter((r) => BUS[r] !== undefined);
  if (!want.some((r) => pick[r])) want = pick.headphones ? ["headphones"] : pick.speakers ? ["speakers"] : want;   // never silent
  const routing = Object.entries(BUS).map(([r, b]) => `Strip[${VAIO}].A${b + 1}=${want.includes(r) ? 1 : 0};`).join("");
  if (routing !== lastRouting) { script.push(routing); lastRouting = routing; }
  if (script.length && a.set(script.join("")) !== 0) { lastRouting = lastDevices = ""; throw new Error("Voicemeeter didn't accept the change"); }
  return status({ playingOn: want.filter((r) => pick[r]), devices: pick });
}

// ---- the Windows default output ----
function ps(args) {
  return new Promise((res, rej) => execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...args], { windowsHide: true, timeout: 20000 },
    (err, out) => (err ? rej(err) : res(String(out).trim()))));
}
export async function windowsOutputs() { return JSON.parse((await ps(["-List"])) || "[]"); }
function readState() { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } }

async function takeDefault() {
  const list = await windowsOutputs();
  const vaio = list.find((d) => /^voicemeeter input/i.test(d.name));
  if (!vaio) throw new Error("Windows doesn't show a \"Voicemeeter Input\" device yet (a restart after installing usually fixes that)");
  const cur = list.find((d) => d.default);
  if (cur && cur.id !== vaio.id && !readState()) writeFileSync(STATE, JSON.stringify({ previous: cur.id, previousName: cur.name, at: new Date().toISOString() }, null, 2));
  if (!vaio.default) await ps(["-Set", vaio.id]);
}

// Put the old Windows default back. Synchronous so it also works while the process is exiting.
export function restoreDefault() {
  const s = readState();
  if (!s?.previous) return false;
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, "-Set", s.previous], { windowsHide: true, timeout: 20000 });
  if (r.status === 0) { try { unlinkSync(STATE); } catch { /* already gone */ } }
  return r.status === 0;
}

// Turn the mixer on (only for Dayspring TV, and only when Voicemeeter is installed and the setting allows it).
export async function start(roles, { enabled = true } = {}) {
  if (!enabled || !displayMode() || !installDir()) { note = !installDir() ? "not installed" : !enabled ? "switched off" : "only runs on the computer that shows the Dayspring screen"; return status(); }
  try {
    sanitizeSavedSetup();
    await connect();
    // (it no longer makes itself the Windows default: other apps like chat apps must keep their own speakers)
    active = true; lastRouting = lastDevices = ""; note = "";
    return await route(roles);
  } catch (e) {
    active = false; note = e.message;
    restoreDefault();
    return status();
  }
}

export function stop() {
  const was = active;
  active = false; lastRouting = lastDevices = "";
  if (displayMode()) restoreDefault();   // a test server never touches the computer's audio
  if (connected && api) { try { api.logout(); } catch { /* already gone */ } connected = false; }
  note = "switched off";
  return was;
}

export function isActive() { return active; }
export function status(extra = {}) { return { installed: Boolean(installDir()), active, note, ...extra }; }

// ================= the call bridge: Dayspring talks into a call through the owner's mic =================
// Only MME (shared) devices are ever given to Voicemeeter here: WDM/KS devices can be taken over exclusively, which is
// what once silenced the headset for Discord. Voicemeeter reloads its last setup at every start, so before starting it
// the saved setup's WDM/KS/ASIO device slots are cleared (a backup is kept in data/).
//   Hardware input 1 = the owner's mic (MME)   → B1
//   "Voicemeeter Input" (Dayspring's call voice) → B1 (+ A1, so the owner hears it too)
//   A1 = the owner's headset speakers (MME)
//   The owner's call app (Discord) uses "Voicemeeter Out B1" as its microphone.
const SAVED = join(process.env.APPDATA || "", "VoiceMeeterBananaDefault.xml");
const SAVED_BACKUP = join(here, "..", "data", "voicemeeter-settings.backup.xml");

export function isRunning() {
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq voicemeeter*", "/FO", "CSV", "/NH"], { windowsHide: true, encoding: "utf8" });
  return /voicemeeter/i.test(r.stdout || "");
}

// Clear any device slot that isn't MME from the setup Voicemeeter will load (only while it isn't running).
export function sanitizeSavedSetup() {
  if (isRunning() || !existsSync(SAVED)) return { changed: false };
  const xml = readFileSync(SAVED, "utf8");
  if (!existsSync(SAVED_BACKUP)) writeFileSync(SAVED_BACKUP, xml);
  const out = xml.replace(/<(InputDev|OutputDev)\s+index='(\d+)'\s+type='(\d+)'\s+name="[^"]*"\s*\/>/g,
    (m, tag, i, type) => (type === "1" ? m : `<${tag} index='${i}' name="-" />`));
  if (out !== xml) writeFileSync(SAVED, out);
  return { changed: out !== xml };
}

function deviceList(a, dir) {
  const n = dir === "in" ? a.inCount() : a.outCount(), list = [];
  for (let i = 0; i < n; i++) {
    const type = [0], name = Buffer.alloc(512), hw = Buffer.alloc(512);
    if ((dir === "in" ? a.inDesc : a.outDesc)(i, type, name, hw) !== 0) continue;
    const label = name.toString("latin1").replace(/\0.*$/s, "");
    if (label) list.push({ name: label, type: type[0] });
  }
  return list;
}
// MME names are cut at 31 characters, so match on the start of the Windows name.
function mmeMatch(list, want) {
  const w = String(want || "").toLowerCase();
  const mme = list.filter((d) => d.type === 1 && !/voicemeeter|vb-audio/i.test(d.name));
  return mme.find((d) => w.startsWith(d.name.toLowerCase().replace(/\s+$/, ""))) ?? mme.find((d) => d.name.toLowerCase().includes(w.slice(0, 20))) ?? null;
}

// Set the bridge up. micName / headsetName: the Windows names of the owner's mic and headset speakers.
// monitor: the owner hears Dayspring's call answers in the headset too (A1).
export async function callSetup({ micName, headsetName, talk = true, monitor = true } = {}) {
  if (!installDir()) throw new Error("Voicemeeter isn't installed. It's free from vb-audio.com (Voicemeeter Banana).");
  sanitizeSavedSetup();
  const a = await connect();
  const mic = mmeMatch(deviceList(a, "in"), micName), out = mmeMatch(deviceList(a, "out"), headsetName);
  if (!mic) throw new Error(`Voicemeeter can't see the microphone "${micName}".`);
  if (!out) throw new Error(`Voicemeeter can't see the headset "${headsetName}".`);
  const s = [
    `Strip[0].device.mme=${q(mic.name)};`, `Bus[0].device.mme=${q(out.name)};`,
    "Strip[0].A1=0;Strip[0].A2=0;Strip[0].A3=0;Strip[0].B1=1;Strip[0].B2=0;Strip[0].Mute=0;",   // your mic → the call only
    "Strip[1].A1=0;Strip[1].A2=0;Strip[1].A3=0;Strip[1].B1=0;Strip[1].B2=0;",
    "Strip[2].A1=0;Strip[2].A2=0;Strip[2].A3=0;Strip[2].B1=0;Strip[2].B2=0;",
    `Strip[${VAIO}].A1=${monitor ? 1 : 0};Strip[${VAIO}].A2=0;Strip[${VAIO}].A3=0;Strip[${VAIO}].B1=${talk ? 1 : 0};Strip[${VAIO}].B2=0;Strip[${VAIO}].Mute=0;`,
    `Strip[${AUX}].A1=1;Strip[${AUX}].A2=0;Strip[${AUX}].A3=0;Strip[${AUX}].B1=0;Strip[${AUX}].B2=0;`,
    "Bus[0].Mute=0;Bus[3].Mute=0;",
  ];
  if (a.set(s.join("")) !== 0) throw new Error("Voicemeeter didn't accept the call setup");
  return { mic: mic.name, headset: out.name, callMic: "Voicemeeter Out B1", dayspringVoiceTo: "Voicemeeter Input" };
}
// Whether Dayspring's call voice reaches the call (the owner's mic path is untouched either way).
export async function callTalk(on) {
  const a = await connect();
  if (a.set(`Strip[${VAIO}].B1=${on ? 1 : 0};`) !== 0) throw new Error("Voicemeeter didn't accept the change");
  return { talk: Boolean(on) };
}
// Close Voicemeeter (the owner's call app must be back on the headset mic first, or friends stop hearing them).
export async function callShutdown() {
  if (!isRunning()) return { stopped: false };
  const a = await connect();
  a.set("Command.Shutdown=1;");
  for (let i = 0; i < 10 && isRunning(); i++) { await pause(300); a.dirty(); }
  try { a.logout(); } catch { /* gone */ }
  connected = false;
  // not closed by the API: close its window normally (not forced, so it saves its setup)
  if (isRunning()) { spawnSync("taskkill", ["/IM", "voicemeeterpro.exe"], { windowsHide: true }); spawnSync("taskkill", ["/IM", "voicemeeter.exe"], { windowsHide: true }); spawnSync("taskkill", ["/IM", "voicemeeter8.exe"], { windowsHide: true }); spawnSync("taskkill", ["/IM", "voicemeeter8x64.exe"], { windowsHide: true }); for (let i = 0; i < 10 && isRunning(); i++) await pause(300); }
  return { stopped: !isRunning() };
}
