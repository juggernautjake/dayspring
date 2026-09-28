// Remote control between the owner's own Dayspring devices ("sign in on all my computers and control them from any
// of them"). This file is the gate and the wiring; the work is in engine.mjs (and envelope.mjs, hub.mjs, skills.mjs).
//
// Feature "remote" (lib/features.mjs, stage "dev"): with it off there are no routes (404), no AI tools, no voice
// commands, no Settings section, and NOTHING connects to the hub. With it on but nobody signed in, nothing connects
// either: the engine (and the crypto) are only loaded once this device has signed in, and no key is made until then.
//
//   enabled()                               the feature switch
//   registerHandler(kind, fn, meta)         what this device does when asked remotely (lib/devices, lib/printers,
//                                           lib/cameras can register their own; handlers.mjs has adapters)
//   notify(deviceIdOrName | "all", { title, body, image?, contentType? })   camera alerts etc. to his other devices
//   send(device, action, args, opts)        one command to one device (voice and Settings use this)
//   start({ announce, broadcast, openUrl, port, version })   at server start: resumes if this device is signed in
//   engine({ create })                      the engine (null until signed in, unless create)
//   handle(text, { surface }) · tools() · runTool(name, input)      voice and AI
//   stills: the latest camera pictures fetched from other devices (served at /api/remote/still/<id>)
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { TOOLS } from "./skills.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DIR = () => process.env.DAYSPRING_REMOTE_DIR || join(ROOT, "data", "remote");
const F = await import("../features.mjs").catch(() => ({ on: () => true }));
export function enabled() { try { return F.on("remote") !== false; } catch { return false; } }

const handlers = new Map();
export function registerHandler(kind, fn, meta = {}) {
  if (!kind || typeof fn !== "function") throw new Error("registerHandler(kind, fn)");
  handlers.set(String(kind), { ...meta, fn });
  if (eng?.approved()) eng.publishProfile().catch(() => {});
}
export const handlerKinds = () => [...handlers.keys()];
// does THIS device control "<thing>" itself? (then the local skills answer, not a remote device)
let localNames = new Map();
export function localHas(kind, thing) {
  const q = String(thing ?? "").toLowerCase().trim();
  const names = localNames.get(kind) ?? [];
  return names.some((n) => { const a = n.toLowerCase(); return a === q || a.split(" ").every((w) => q.split(" ").includes(w)) || q.split(" ").every((w) => a.split(" ").includes(w)); });
}
async function refreshLocalNames() {
  const m = new Map();
  for (const [k, h] of handlers) if (typeof h.names === "function") { try { m.set(k, (await h.names()).map(String)); } catch { /* none */ } }
  localNames = m;
}

let deps = { announce: () => {}, broadcast: () => {}, openUrl: async () => ({ opened: false }), port: 4747, version: "0" };
let eng = null, engP = null, skills = null, builtinsOn = false, watching = false;

// the hub: Settings → Lantern's hub, else the one baked into this release, else Lantern's own release file
async function hubConfig() {
  let cfg = null;
  try { const l = await import("../lantern.mjs"); cfg = l.hubConfig(); } catch { /* no Lantern link */ }
  if (cfg) return cfg;
  try {
    const f = join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || ROOT, "AppData", "Local"), "Lantern", "release-hub.json");
    if (existsSync(f)) { const { readFileSync } = await import("node:fs"); const h = JSON.parse(readFileSync(f, "utf8")); const { isSecretKey } = await import("./hub.mjs"); if (h?.url && h?.anonKey && !isSecretKey(h.anonKey)) return { url: h.url, anonKey: h.anonKey }; }
  } catch { /* none */ }
  return null;
}

export async function engine({ create = false } = {}) {
  if (!enabled()) return null;
  if (eng) return eng;
  if (!create && !existsSync(join(DIR(), "state.json"))) return null;
  engP ??= (async () => {
    const [{ createRemote }, { dpapi }, activity] = await Promise.all([import("./engine.mjs"), import("../../vendor/ecosystem-core/lib/credentials.mjs"), import("../activity.mjs")]);
    let cfg = await hubConfig();
    ensureBuiltins();
    const e = createRemote({
      dir: DIR(), box: dpapi({ entropy: "dayspring-remote-device-v1" }), hubConfig: () => cfg, handlers,
      name: prettyHost(), platform: "Windows", version: deps.version, client: "desk",
      log: (kind, data) => activity.log(kind, data),
      onEvent: (type, data) => onEvent(type, data),
    });
    e.refreshHub = async () => { cfg = await hubConfig(); return cfg; };
    return e;
  })();
  try { eng = await engP; } finally { engP = null; }
  return eng;
}
const prettyHost = () => { const h = hostname().replace(/[-_]+/g, " ").trim(); return h ? h.charAt(0).toUpperCase() + h.slice(1).toLowerCase() : "This computer"; };

function onEvent(type, data) {
  if (type === "pairing-request") deps.announce({ kind: "remote", text: `${data?.device?.name ?? "A new device"} wants to join your Dayspring devices. To approve it, open Settings → Devices & sign-in on this screen and compare the code.` });
  else if (type === "signed-out" && data?.reason === "revoked") deps.announce({ kind: "remote", text: `This Dayspring was signed out of your other devices${data.by ? " from " + data.by : ""}.` });
  else if (type === "approved") deps.announce({ kind: "remote", text: `This Dayspring is now connected to your other devices (approved on ${data?.by ?? "another device"}).` });
  deps.broadcast("remote", { type });
}

// the latest pictures from other devices, for the screen and the camera viewer (kept in memory only, 10 at most)
export const stills = new Map();
function keepStill({ bytes, contentType, device, label }) {
  const id = randomBytes(9).toString("base64url");
  stills.set(id, { bytes, contentType: contentType ?? "image/jpeg", at: Date.now(), device: device?.name ?? "", label: label ?? "" });
  while (stills.size > 10) stills.delete(stills.keys().next().value);
  return id;
}

function ensureBuiltins() {
  if (builtinsOn) return;
  builtinsOn = true;
  import("./handlers.mjs").then(async (h) => {
    const [store, reminders, announcer] = await Promise.all([import("../store.mjs"), import("../reminders.mjs"), import("../announcer.mjs").catch(() => null)]);
    const b = h.builtins({ announce: (x) => deps.announce(x), broadcast: (t, d) => deps.broadcast(t, d), version: deps.version, store, reminders, recent: () => announcer?.recent?.() ?? [],
      onNotify: ({ image, imageType, from, title }) => (image ? { imageUrl: `/api/remote/still/${keepStill({ bytes: image, contentType: imageType, device: { name: from }, label: title })}` } : null) });
    for (const [k, v] of b) if (!handlers.has(k)) handlers.set(k, v);
    await refreshLocalNames();
  }).catch((e) => console.log(`remote: ${e.message}`));
}

// Camera alerts reach his other devices: lib/cameras' onAlert → notify("all", { title, body, image }). Hooked once, at
// start (notify sends nothing until this device is signed in and approved, so it's safe before that).
let camHooked = false;
export async function hookCameras(cams = null) {
  if (camHooked) return false;
  if (!cams) { try { if (F.on("cameras") === false) return false; } catch { return false; } }
  const c = cams ?? await import("../cameras/index.mjs").catch(() => null);
  if (typeof c?.onAlert !== "function") return false;
  camHooked = true;
  c.onAlert(async (card) => {
    if (!enabled()) return;
    let image = null;
    try { image = c.lastFrame?.(card?.cam)?.jpeg ?? null; } catch { /* no picture */ }
    await notify("all", { title: card?.name ? `${card.name}` : "Camera", body: String(card?.text ?? "").slice(0, 500), image: Buffer.isBuffer(image) ? image : null, contentType: "image/jpeg" });
  });
  return true;
}
export const _unhookCameras = () => { camHooked = false; };

export async function start(d = {}) {
  deps = { ...deps, ...d };
  if (!enabled()) return false;
  hookCameras().catch(() => {});
  const e = await engine().catch(() => null);           // null unless this device signed in before
  if (!e) return false;
  ensureBuiltins();
  // the feature switched off while running: stop talking to the hub at once
  if (!watching) { watching = true; setInterval(() => { refreshLocalNames().catch(() => {}); if (!enabled()) eng?.stop(); }, 60_000).unref?.(); }
  return e.start();
}

function skillsNow() {
  if (!skills) {
    skills = (async () => {
      const [{ createSkills }, confirm] = await Promise.all([import("./skills.mjs"), import("../confirm.mjs")]);
      return createSkills({ engine: () => eng, confirm, localHas,
        show: async ({ device, action, args, bytes, contentType }) => {
          const id = keepStill({ bytes, contentType, device, label: args.printer ?? args.camera ?? "" });
          const q = new URLSearchParams({ still: id, device: device.id, action, target: args.printer ?? args.camera ?? "" });
          deps.openUrl(`http://127.0.0.1:${deps.port}/remote-view.html?${q}`).catch(() => {});
          return `/api/remote/still/${id}`;
        } });
    })();
  }
  return skills;
}
export async function handle(text, opts = {}) {
  if (!enabled() || !eng) {
    if (enabled() && /\b(which|what) of my dayspring devices\b|\bmy dayspring devices\b/i.test(String(text))) return { reply: "This Dayspring isn't signed in to your other devices yet. Open Settings → Devices & sign-in to connect them." };
    return null;
  }
  return (await skillsNow()).handle(text, opts);
}
export const tools = () => (enabled() && eng?.approved() ? TOOLS : []);
export async function runTool(name, input) {
  if (!TOOLS.some((t) => t.name === name)) return undefined;
  if (!enabled()) return undefined;
  if (!eng) return { error: "This Dayspring isn't signed in to the owner's other devices (Settings → Devices & sign-in)." };
  return (await skillsNow()).runTool(name, input);
}

export async function notify(target, msg = {}) {
  if (!enabled()) return { sent: 0, reason: "remote control is off" };
  const e = await engine().catch(() => null);
  if (!e?.approved()) return { sent: 0, reason: "this device isn't signed in to your other devices" };
  return e.notify(target, { ...msg, image: Buffer.isBuffer(msg.image) ? msg.image : null });
}
export async function send(device, action, args = {}, opts = {}) {
  const e = await engine().catch(() => null);
  if (!e?.approved()) return { ok: false, say: "This device isn't signed in to your other devices." };
  const d = e.findDevice(device) ?? e.cached().find((x) => x.id === device);
  if (!d) return { ok: false, say: `No device called "${device}".` };
  return e.send(d.id, action, args, opts);
}
export { keepStill };
