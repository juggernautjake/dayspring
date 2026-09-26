// "Talk into calls": when it's on, Dayspring's answers during Tune in go into the owner's call (Discord or any app)
// through Voicemeeter, mixed with the owner's own mic. Off (the default), answers play only in the owner's headset.
//
// One-time setup in the call app: its INPUT (microphone) = "Voicemeeter Out B1". Its output stays on the headset.
// While that's set, Voicemeeter must be running or friends can't hear the owner, so switching talk off leaves
// Voicemeeter running (Dayspring just stops sending its voice to B1). "Finish" (setup off) closes Voicemeeter, after
// the owner has put the call app's mic back on the headset.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import * as vm from "./voicemeeter.mjs";
import * as loopback from "./loopback.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "callbridge.json");
const PS1 = join(ROOT, "scripts", "audio-default.ps1");
const DEFAULTS = { talk: false, bridge: false, micName: null, headsetName: null, setupAt: null };
const dry = () => process.env.DAYSPRING_DEVICES_DRYRUN === "1";

function load() { try { return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, "utf8")) }; } catch { return { ...DEFAULTS }; } }
function save(s) { writeFileSync(FILE, JSON.stringify(s, null, 2)); return s; }
let last = { error: "" };

export function status() {
  const s = load();
  return {
    talk: s.talk && s.bridge, bridge: s.bridge, voicemeeter: { installed: Boolean(vm.installDir()), running: vm.isRunning() },
    callMic: "Voicemeeter Out B1", playTo: s.talk && s.bridge ? "Voicemeeter Input" : null, mic: s.micName, headset: s.headsetName, error: last.error,
  };
}

const ps = (args) => new Promise((res, rej) => execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...args], { windowsHide: true, timeout: 20000 }, (e, o) => (e ? rej(e) : res(String(o).trim()))));
// The owner's mic and headset: the Windows defaults right now (never changed by Dayspring).
async function ownerDevices() {
  const mics = JSON.parse((await ps(["-List", "-Capture"])) || "[]");
  const mic = mics.find((d) => d.default && !/voicemeeter/i.test(d.name)) ?? mics.find((d) => d.formFactor === 4 && !/voicemeeter/i.test(d.name));
  const outs = await loopback.devices();
  const headset = outs.find((d) => d.default && !/voicemeeter/i.test(d.name)) ?? outs.find((d) => /headset|headphone/i.test(d.name));
  return { micName: mic?.name ?? null, headsetName: headset?.name ?? null };
}

// Turn talking into calls on or off. Turning it on sets the bridge up the first time.
export async function setTalk(on) {
  last.error = "";
  const s = load();
  if (dry()) return save({ ...s, talk: Boolean(on), bridge: s.bridge || Boolean(on) }) && status();
  try {
    if (on) {
      const d = s.micName && s.headsetName ? s : { ...s, ...(await ownerDevices()) };
      if (!d.micName || !d.headsetName) throw new Error("I couldn't tell which mic and headset you use. Set your headset as the Windows default and try again.");
      const r = await vm.callSetup({ micName: d.micName, headsetName: d.headsetName, talk: true });
      save({ ...d, talk: true, bridge: true, setupAt: s.setupAt ?? new Date().toISOString() });
      return { ...status(), setup: r, firstTime: !s.setupAt };
    }
    if (s.bridge && vm.isRunning()) await vm.callTalk(false);
    save({ ...s, talk: false });
    return status();
  } catch (e) { last.error = e.message; return status(); }
}
// Keep the bridge up after a restart (the call app's mic points at it).
export async function resume() {
  const s = load();
  if (!s.bridge || dry()) return status();
  try { await vm.callSetup({ micName: s.micName, headsetName: s.headsetName, talk: s.talk }); } catch (e) { last.error = e.message; }
  return status();
}
// Done with the bridge: only after the call app's mic is back on the headset.
export async function finish() {
  const s = load();
  save({ ...s, talk: false, bridge: false });
  if (!dry()) { try { await vm.callShutdown(); } catch (e) { last.error = e.message; } }
  return status();
}
export const isTalking = () => { const s = load(); return s.talk && s.bridge; };
