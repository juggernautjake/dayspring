// Which microphone Dayspring listens through: "use my headset mic", "use the laptop mic".
// Chrome's speech recognition always listens through the Windows default microphone, so choosing a mic means making it
// the Windows default recording device (scripts/audio-default.ps1 -Capture); the TV then restarts listening.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PS1 = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "audio-default.ps1");
function ps(args) {
  return new Promise((res, rej) => execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...args], { windowsHide: true, timeout: 20000 },
    (err, out) => (err ? rej(err) : res(String(out).trim()))));
}
// What kind of device a name is, from the owner's own hints (data/devices.json "typeHints": { "<part of a name>": "headset" | "tv" | … }),
// for devices whose Windows names don't say. Returns the kind or null.
const DEVICES_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "devices.json");
let hints = { at: 0, map: {} };
export function typeHint(label) {
  if (Date.now() - hints.at > 60_000) {
    try { hints = { at: Date.now(), map: existsSync(DEVICES_FILE) ? JSON.parse(readFileSync(DEVICES_FILE, "utf8")).typeHints ?? {} : {} }; } catch { hints = { at: Date.now(), map: {} }; }
  }
  const l = String(label || "").toLowerCase();
  for (const [w, t] of Object.entries(hints.map)) if (w && l.includes(w.toLowerCase())) return t;
  return null;
}
export function roleOf(name) {
  const l = String(name).toLowerCase();
  if (/voicemeeter|vb-audio/.test(l)) return "virtual";
  if (/headset|headphone|buds|airpods/.test(l) || ["headset", "headphones", "earbuds"].includes(typeHint(l))) return "headset";
  if (/array|realtek|intel|internal|built-?in|laptop/.test(l)) return "laptop";
  return "other";
}
// The real microphones (not Voicemeeter's virtual ones): [{ id, name, role, default }]
export async function list() {
  const all = JSON.parse((await ps(["-List", "-Capture"])) || "[]");
  return all.map((d) => ({ ...d, role: roleOf(d.name) })).filter((d) => d.role !== "virtual");
}
// Make "headset" / "laptop" (or part of a device's name) the mic. Returns the chosen device, or null if it isn't plugged in.
export async function use(want) {
  const mics = await list();
  const w = String(want).toLowerCase();
  const pick = mics.find((d) => d.role === w) ?? mics.find((d) => d.name.toLowerCase().includes(w));
  if (!pick) return null;
  if (process.env.DAYSPRING_DEVICES_DRYRUN === "1") return pick;      // tests never change the real mic
  // (the communications mic, which chat and meeting apps follow, is left alone)
  if (!pick.default) await ps(["-Set", pick.id, "-KeepComms"]);
  return pick;
}
export async function current() { return (await list()).find((d) => d.default) ?? null; }
