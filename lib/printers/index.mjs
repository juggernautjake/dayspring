// 3D printers, any brand, one interface. Bambu Lab (LAN mode) and Marlin over USB (Creality Ender 5 Plus…),
// OctoPrint and Klipper/Moonraker today; Prusa (PrusaLink) and others are one adapter each (docs/dev/printer-adapters.md).
//
// Every adapter makes a CONNECTION with the same shape:
//   connect() · close() · status() → the normalized status (below) · on("status") · pause() · resume() · stop()
//   setSpeed(1–4) · setLight(on) · setTemp({ nozzle, bed, chamber }) · setFan({ part, aux, chamber }) · gcodeLine(l)
//   upload(localPath) → remote name · startPrint({ file, plate, amsMapping, options }) · cameraSource() → source | null
//   test() → { ok, text } · capabilities: { camera, ams, light, speed, upload, dualNozzle, fans, chamber, usbStream }
// normalized status: { online, state: idle|preparing|printing|paused|finished|failed|offline|unknown, progress (%),
//   layer, totalLayers, remainingMin, nozzle: [{ temp, target }], bed, chamber, fans, speedLevel, light, ams, errors,
//   job: { name, file }, hot }
//
// The rules (in code, whatever asks: voice, the AI, the screen, another Dayspring computer):
//   · Starting a print heats things up and moves: it needs the owner's yes (confirm.mjs), unless he turned on
//     "auto-start when the bed is clear" for that printer, and EITHER WAY a fresh bed-clear check passes just before the
//     start command is sent. Never a stale check, never skipped.
//   · Stopping a print can't be undone: it asks. Pause and resume don't.
//   · Temperatures are limited to each model's safe maximum; above it is refused, not clamped.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import * as store from "./store.mjs";
import * as bridge from "./camera-bridge.mjs";
import * as monitor from "./monitor.mjs";
import { bedCheck } from "./vision/analyze.mjs";
import * as bambu from "./bambu/index.mjs";
import * as marlin from "./marlin/index.mjs";
import * as hosts from "./hosts.mjs";
import { MODELS as BAMBU_MODELS } from "./bambu/models.mjs";
import * as confirm from "../confirm.mjs";
import * as activity from "../activity.mjs";
import * as gate from "../devices/gate.mjs";
import { nameKey } from "../devices/model.mjs";
import { sayStatus } from "./words.mjs";

export const ADAPTERS = {
  bambu: { meta: bambu.meta, create: bambu.create },
  marlin: { meta: marlin.meta, create: marlin.create },
  octoprint: { meta: hosts.OCTO, create: hosts.createOcto },
  moonraker: { meta: hosts.MOON, create: hosts.createMoon },
};
let deps = { announce: () => {}, broadcast: () => {}, notify: async () => {}, keepAwake: () => {}, ai: null, ffmpeg: null, visionConsent: () => false };
export function setDeps(d) { deps = { ...deps, ...d }; monitor.setDeps(monitorDeps()); }
const log = (k, d) => activity.log(k, d);
const conns = new Map();          // printer id → connection
const last = new Map();           // printer id → last status (for transitions)
const bedChecks = new Map();      // printer id → { at, clear, file, result }

// ---- which printer ("printer 3", "the X1", "the P1S", "the Ender") ----------------------------------------------------
export function resolve(phrase) {
  const list = store.list();
  const k = nameKey(phrase ?? "").replace(/\b(3d )?printer\b/, "printer").replace(/^the /, "");
  if (!k) return list.length === 1 ? list[0] : null;
  const exact = list.filter((p) => [p.name, ...(p.aliases ?? [])].some((n) => nameKey(n) === k));
  if (exact.length === 1) return exact[0];
  const m = /(?:^|\b)printer (\d+)$/.exec(k) ?? /^(\d+)$/.exec(k);
  if (m) return list.find((p) => p.number === Number(m[1])) ?? null;
  const model = list.filter((p) => { const lbl = nameKey(BAMBU_MODELS[p.model]?.label ?? p.model ?? ""), mk = nameKey(p.model ?? ""); return (lbl && (k === lbl || k.endsWith(" " + lbl) || k === lbl.replace(/ /g, ""))) || (mk && (k === mk || k.replace(/ /g, "") === mk.replace(/ /g, ""))) || (/\bx1\b/.test(k) && /^X1/.test(p.model ?? "")) || (/\b(p1s|p1p|a1 mini|a1|h2d|h2s)\b/.test(k) && k.replace(/ /g, "").includes(String(p.model ?? "").toLowerCase().replace("a1mini", "a1mini"))) || (/\bender\b/.test(k) && /ender/i.test(`${p.model} ${p.name}`)); });
  if (model.length === 1) return model[0];
  const partial = list.filter((p) => [p.name, ...(p.aliases ?? [])].some((n) => nameKey(n).includes(k) || k.includes(nameKey(n))));
  return partial.length === 1 ? partial[0] : null;
}

// ---- connections ------------------------------------------------------------------------------------------------------------
export async function connection(id, { connect = true } = {}) {
  const p = store.get(id); if (!p) throw new Error("I don't know that printer.");
  let c = conns.get(id);
  if (!c) {
    const a = ADAPTERS[p.brand]; if (!a) throw new Error(`I can't talk to ${p.brand} printers yet.`);
    c = a.create(p, store.secretFor(p.id), { keepAwake: (on) => deps.keepAwake(p.id, on) });
    c.on("status", (s) => onStatus(p.id, s));
    c.on?.("fault", (f) => onFault(p.id, f));
    conns.set(id, c);
    const src = c.cameraSource?.() ?? (p.cameraId ? bridge.borrowed(p.id, p.cameraId, `${p.name} camera`) : p.cameraUrl ? bridge.fromUrl(p.id, p.cameraUrl, `${p.name} camera`) : null);
    if (src) await bridge.register(src);
  }
  if (connect && !c.online) await c.connect();
  return c;
}
export function forget(id) { const c = conns.get(id); try { c?.close(); } catch { /* closed */ } conns.delete(id); bridge.unregister(`printer-${id}`); last.delete(id); }
export const cameraId = (id) => (bridge.has(`printer-${id}`) ? `printer-${id}` : null);
// status(id | "printer 3" | null): one printer's status (with `say`, the spoken line), or every printer's for null
// (lib/remote asks "how's printer 3 doing?" from another computer this way)
export function status(which = null) {
  if (which == null || which === "") { const all = statusAll(); return { ok: true, printers: all, say: all.length ? all.map((s) => sayStatus(s)).join(" ") : "No 3D printers are set up here." }; }
  const id = store.get(which) ? which : resolve(which)?.id;
  const c = conns.get(id), p = store.get(id);
  if (!p) return null;
  const s = c ? c.status() : { online: false, state: "offline" };
  const job = monitor.current(id);
  const out = { id, name: p.name, number: p.number, brand: p.brand, model: p.model, ...s, camera: Boolean(cameraId(id)), capabilities: c?.capabilities ?? {}, watching: job ? monitor.publicJob(job) : null, bedCheck: bedChecks.get(id) ?? null, queue: p.queue?.items?.length ?? 0 };
  return { ...out, say: sayStatus(out) };
}
export const statusAll = () => store.list().map((p) => status(p.id));
// every printer's names (lib/remote uses them to understand "printer 3" said on another computer)
export const names = () => store.list().flatMap((p) => [p.name, `printer ${p.number}`, ...(p.aliases ?? [])]);
export const list = () => store.list().map((p) => ({ id: p.id, name: p.name, number: p.number, brand: p.brand, model: p.model }));
// Another of the owner's Dayspring computers asks for a print (lib/remote). Same rules: a fresh clear-bed check, and the
// owner's yes; `confirmed` means he already said yes on the computer that sent it (the command is signed), so that yes
// is given here, bound to that computer only. job: file words ("the benchy") or a path, or { file, plate, amsMapping }.
export async function start(which, job, { from, confirmed = false } = {}) {
  const p = which ? resolve(which) : store.list().length === 1 ? store.list()[0] : null;
  if (!p) return { ok: false, say: which ? `There's no printer called “${which}” here.` : "Which printer?" };
  const j = typeof job === "string" ? { file: job } : job ?? {};
  const { findFile } = await import("./files.mjs");
  const f = existsSync(String(j.file ?? "")) ? { file: j.file } : await findFile(p, String(j.file ?? ""));
  if (!f) return { ok: false, say: `I couldn't find “${j.file ?? ""}” for ${p.name}.` };
  const o = { id: from?.deviceId ?? from?.id, name: from?.name, verified: true, owner: true };
  const args = { file: f.file, plate: j.plate ?? f.item?.plate ?? 1, amsMapping: j.amsMapping ?? f.item?.amsMapping, queueItem: f.item?.id, from: o, surface: `remote:${o.id}` };
  let r = await startPrint(p.id, args);
  if (r.needsConfirm && confirmed) { confirm.userSaid("yes", { surface: `remote:${o.id}` }); r = await startPrint(p.id, { ...args, confirmToken: r.confirmToken }); }
  return { ...r, say: r.text };
}
// for lib/devices: may its outlet be cut? (null = can't tell)
export function powerStatus(id) {
  const s = conns.get(id)?.status(); if (!s || !s.online) return null;
  return { state: s.state, hot: s.hot, progress: s.progress, nozzle: Math.max(...(s.nozzle ?? [{ temp: 0 }]).map((n) => n.temp ?? 0)), bed: s.bed?.temp ?? null };
}
function onStatus(id, s) {
  const before = last.get(id)?.state; last.set(id, s);
  const p = store.get(id); if (!p) return;
  const printing = (st) => st === "printing" || st === "preparing" || st === "paused";
  if (printing(s.state) && !printing(before) && before !== undefined || (printing(s.state) && !monitor.current(id) && cameraId(id))) monitor.begin(p, { name: s.job?.name ?? s.job?.file ?? "print" }).catch(() => {});
  if (printing(before) && !printing(s.state)) {
    const result = s.state === "finished" ? "finished" : s.state === "failed" ? "failed" : "stopped";
    monitor.end(id, result).catch(() => {});
    // "want me to pause it?" is moot once the print is over
    for (const [k, v] of pending) if (v.kind === "pause" && v.id === id) pending.delete(k);
    if (result === "finished") deps.announce({ kind: "printer", text: `${p.name} finished ${s.job?.name ?? "its print"}.`, printer: id });
    import("./queue.mjs").then((q) => q.afterPrint(id)).catch(() => {});
  }
  deps.broadcast("printers", { status: status(id) });
}
function onFault(id, f) {
  const p = store.get(id);
  log("printer.fault", { printer: id, kind: f.kind, text: String(f.text).slice(0, 300) });
  deps.announce({ kind: "emergency", emergency: f.kind === "thermal", text: `${p?.name ?? "The printer"}: ${f.text}`, printer: id });
  deps.broadcast("printer-alert", { printer: id, name: p?.name, severity: "failure", verdict: f.kind, text: f.text });
}

// ---- the camera and the bed ---------------------------------------------------------------------------------------------------
export async function snapshot(which) {
  const id = store.get(which) ? which : resolve(which ?? "")?.id;
  if (!id) throw new Error("Which printer?");
  await connection(id, { connect: false });
  const cam = cameraId(id); if (!cam) throw new Error(`${store.get(id)?.name ?? "That printer"} has no camera. You can lend it one in Settings → Printers.`);
  return bridge.snapshot(cam);
}
const refFile = (id, plate) => join(store.REFS_DIR(), `${id.replace(/[^\w-]/g, "_")}-${String(plate ?? "default").replace(/[^\w-]/g, "_")}.jpg`);
export function reference(p) {
  const plate = p.bed?.plate ?? "default";
  const f = p.bed?.refs?.[plate] ? join(store.REFS_DIR(), p.bed.refs[plate]) : refFile(p.id, plate);
  try { return existsSync(f) ? readFileSync(f) : null; } catch { return null; }
}
export async function captureReference(id, { plate } = {}) {
  const p = store.get(id); if (!p) throw new Error("No such printer.");
  const pl = plate ?? p.bed?.plate ?? "default";
  const jpg = await snapshot(id);
  mkdirSync(store.REFS_DIR(), { recursive: true });
  const f = refFile(id, pl); writeFileSync(f, jpg);
  store.setBed(id, { plate: pl, ref: { plate: pl, file: basename(f) } });
  log("printer.bed", { printer: id, event: "empty-bed picture saved", plate: pl });
  return { plate: pl, file: basename(f), bytes: jpg.length };
}
export function aiFor(p) {
  if (deps.ai) return deps.ai(p);
  const allowed = p.options?.aiVision ?? deps.visionConsent();
  if (!allowed) return null;
  return async ({ prompt, image }) => { const llm = await import("../llm.mjs"); if (!llm.supportsImages()) throw new Error("this AI can't look at pictures"); return llm.completeWithImage({ system: "You check 3D printer camera pictures. Answer with JSON only.", prompt, image: { data: image.toString("base64"), mediaType: "image/jpeg" }, maxTokens: 200, timeoutMs: 45_000 }); };
}
export async function checkBed(id, { save = true } = {}) {
  const p = store.get(id); if (!p) throw new Error("No such printer.");
  const shot = await snapshot(id);
  const r = await bedCheck(shot, reference(p), { roi: p.bed?.roi ?? null, ai: aiFor(p) });
  const at = new Date().toISOString();
  let file = null;
  if (save) { mkdirSync(store.REFS_DIR(), { recursive: true }); file = `${id.replace(/[^\w-]/g, "_")}-lastcheck.jpg`; writeFileSync(join(store.REFS_DIR(), file), shot); }
  const out = { at, ...r, image: file ? `/api/printers/${encodeURIComponent(id)}/bedcheck.jpg?t=${Date.parse(at)}` : null };
  bedChecks.set(id, { at, clear: r.clear, reason: r.reason, image: out.image });
  log("printer.bedcheck", { printer: id, clear: r.clear, confidence: r.confidence, reason: r.reason.slice(0, 200), ai: r.ai?.clear ?? null });
  deps.broadcast("printers", { bedCheck: { printer: id, ...bedChecks.get(id) } });
  return out;
}

// ---- starting a print ----------------------------------------------------------------------------------------------------------
const OWNER_SURFACES = ["tv", "desk", "typed"];
// his own screens, his own other Dayspring computers, the queue itself; never a call, a meeting, Discord or a text
export const ownerSurface = (s) => s == null || OWNER_SURFACES.includes(s) || String(s).startsWith("remote:") || s === "schedule" || s === "queue";
const surfacesFor = (o) => (o.from?.id && o.from.id !== "local" ? [`remote:${o.from.id}`] : OWNER_SURFACES);
export const pending = new Map();   // surface → { token, kind, args, at }
const opOf = (id, file, plate) => ({ tool: "printer_start", printer: id, file: String(file), plate: Number(plate) || 1 });
// startPrint(id, { file, plate, amsMapping, options, confirmToken, auto, surface, from })
//   file: a path on this computer (uploaded first) or a name already on the printer ("printer:benchy.3mf")
export async function startPrint(id, o = {}) {
  if (!gate.on("printers")) return { ok: false, text: "Printers aren't turned on in this version of Dayspring." };
  if (!ownerSurface(o.surface)) return { ok: false, refused: true, text: "Only the owner can control the printers, from their own screen or devices." };
  const p = store.get(id); if (!p) return { ok: false, text: "I don't know that printer." };
  if (o.from?.id && o.from.id !== "local" && o.from.verified !== true) return { ok: false, text: "That request didn't come from one of your verified Dayspring computers." };
  let c; try { c = await connection(id); } catch (e) { return { ok: false, text: `I can't reach ${p.name}: ${e.message}` }; }
  const st = c.status();
  if (["printing", "preparing", "paused"].includes(st.state)) return { ok: false, text: `${p.name} is already ${st.state === "paused" ? "in the middle of a (paused) print" : "printing"}.` };
  if (!o.file) return { ok: false, text: "Which file should it print?" };
  const onPrinter = String(o.file).startsWith("printer:");
  if (!onPrinter && !existsSync(o.file)) return { ok: false, text: `I can't find ${basename(String(o.file))}.` };
  const name = onPrinter ? String(o.file).slice(8) : basename(o.file);
  const op = opOf(id, o.file, o.plate);
  // 1. the bed, right now (a printer with no camera at all: the owner's own look at the bed IS the check, so it always
  //    asks, whatever auto-start says)
  const noCamera = !cameraId(id);
  let bed = noCamera ? { clear: true, manual: true, at: new Date().toISOString(), reason: "no camera" } : await checkBed(id).catch((e) => ({ clear: false, reason: e.message }));
  if (!bed.clear) { log("blocked", { reason: "printer-bed-not-clear", printer: id, file: name, why: bed.reason?.slice(0, 200) }); return { ok: false, bedNotClear: true, text: `I won't start ${name} on ${p.name}: ${bed.reason}`, image: bed.image ?? null, bed }; }
  // 2. the owner's yes (unless auto-start is on for this printer and this start came from the queue)
  const autoOk = o.auto === true && p.options?.autoStart === true && !noCamera;
  if (!autoOk) {
    const ok = o.confirmToken ? confirm.consume(o.confirmToken, op) : { ok: false, why: "none" };
    if (!ok.ok) {
      if (ok.why !== "none" && ok.why !== "not-approved") return { ok: false, text: ok.why === "expired" ? "That question ran out. Ask me again." : "That yes was for something else, so I didn't start anything." };
      const usb = p.brand === "marlin" ? " It prints over USB from this computer, so I'll keep the computer awake until it's done (OctoPrint or Klipper would be more reliable)." : "";
      const text = `${noCamera ? `${p.name} has no camera, so I can't see its bed: please check that it's clear.` : `The bed on ${p.name} looks clear.`} Start ${name}${o.plate > 1 ? ` (plate ${o.plate})` : ""}? It will heat up and start printing.${usb} Say yes to start.`;
      const token = confirm.issue(op, { text, what: "printer start", surfaces: surfacesFor(o) });
      const sk = surfacesFor(o)[0] === "tv" ? o.surface ?? "tv" : surfacesFor(o)[0];
      pending.set(sk, { token, kind: "start", id, args: { ...o, confirmToken: undefined }, at: Date.now() });
      log("printer.asked", { printer: id, file: name, from: o.from?.id ?? "local" });
      return { ok: false, needsConfirm: true, confirmToken: token, text, image: bed.image ?? null, bed };
    }
    // the yes may have come a while after the check: look again (never start on an old check)
    if (!noCamera && Date.now() - Date.parse(bed.at ?? 0) > 60_000) {
      bed = await checkBed(id).catch((e) => ({ clear: false, reason: e.message }));
      if (!bed.clear) return { ok: false, bedNotClear: true, text: `Something changed: ${bed.reason} I didn't start it.`, image: bed.image ?? null };
    }
  }
  // 3. upload (if needed) and start
  try {
    const remote = onPrinter ? name : await c.upload(o.file, { name });
    const r = await c.startPrint({ file: remote, plate: o.plate ?? 1, amsMapping: o.amsMapping, options: { ...(p.options?.printOptions ?? {}), ...(o.options ?? {}) } });
    log("printer.start", { printer: id, file: name, plate: o.plate ?? 1, auto: autoOk || undefined, from: o.from?.id ?? "local", bedConfidence: bed.confidence });
    if (o.queueItem) { const it = p.queue.items.find((x) => x.id === o.queueItem); p.queue.items = p.queue.items.filter((x) => x.id !== o.queueItem); if (it) p.queue.done = [...(p.queue.done ?? []), it.file.toLowerCase()].slice(-500); store.save(); }
    monitor.begin(p, { name }).catch(() => {});
    deps.broadcast("printers", { status: status(id) });
    return { ok: true, started: true, text: `Starting ${name} on ${p.name}.${cameraId(id) ? ` I'll check on it every ${p.options?.snapshotMinutes ?? 10} minutes.` : ""}`, ...r };
  } catch (e) {
    log("printer.start", { printer: id, file: name, result: "error", error: e.message.slice(0, 200) });
    return { ok: false, text: `${p.name} didn't start: ${e.message}` };
  }
}
// pause / resume / stop / speed / light / temp / fan
export async function command(id, kind, value, o = {}) {
  if (!gate.on("printers")) return { ok: false, text: "Printers aren't turned on in this version of Dayspring." };
  if (!ownerSurface(o.surface)) return { ok: false, refused: true, text: "Only the owner can control the printers, from their own screen or devices." };
  const p = store.get(id); if (!p) return { ok: false, text: "I don't know that printer." };
  if (o.from?.id && o.from.id !== "local" && o.from.verified !== true) return { ok: false, text: "That request didn't come from one of your verified Dayspring computers." };
  let c; try { c = await connection(id); } catch (e) { return { ok: false, text: `I can't reach ${p.name}: ${e.message}` }; }
  if (kind === "stop") {
    const op = { tool: "printer_stop", printer: id };
    const ok = o.confirmToken ? confirm.consume(o.confirmToken, op) : { ok: false };
    if (!ok.ok && !o.approved) {
      const text = `Stop the print on ${p.name}? It can't be resumed after that. Say yes to stop it.`;
      const token = confirm.issue(op, { text, what: "printer stop", surfaces: surfacesFor(o) });
      pending.set(surfacesFor(o)[0] === "tv" ? o.surface ?? "tv" : surfacesFor(o)[0], { token, kind: "stop", id, at: Date.now() });
      return { ok: false, needsConfirm: true, confirmToken: token, text };
    }
  }
  try {
    if (kind === "pause") await c.pause();
    else if (kind === "resume") await c.resume();
    else if (kind === "stop") await c.stop();
    else if (kind === "speed") await c.setSpeed(value);
    else if (kind === "light") await c.setLight(value === true || value === "on");
    else if (kind === "temp") await c.setTemp(value ?? {});
    else if (kind === "fan") await c.setFan(value ?? {});
    else return { ok: false, text: `I don't know how to “${kind}” a printer.` };
  } catch (e) { log("printer.command", { printer: id, kind, result: "error", error: e.message.slice(0, 200) }); return { ok: false, text: e.message }; }
  log("printer.command", { printer: id, kind, value: typeof value === "object" ? JSON.stringify(value) : value, from: o.from?.id ?? "local" });
  const words = { pause: "paused", resume: "resumed", stop: "stopped", speed: `set to ${({ 1: "silent", 2: "standard", 3: "sport", 4: "ludicrous" })[value] ?? value} speed`, light: `light ${value === true || value === "on" ? "on" : "off"}`, temp: "temperature set", fan: "fan set" };
  return { ok: true, text: `${p.name}: ${words[kind]}.` };
}
// "yes" / "no" to a printer question (start, stop, pause-after-an-alert)
export async function answer(said, o = {}) {
  const sk = o.from?.id && o.from.id !== "local" ? `remote:${o.from.id}` : o.surface ?? "tv";
  const q = pending.get(sk);
  if (!q || Date.now() - q.at > confirm.WINDOW_MS * 3) { pending.delete(sk); return null; }
  if (confirm.isNo(said)) { pending.delete(sk); return { ok: true, text: "Okay, I won't." }; }
  if (!confirm.isYes(said)) return null;
  pending.delete(sk);
  if (q.kind === "start") return startPrint(q.id, { ...q.args, confirmToken: q.token, surface: o.surface, from: o.from });
  if (q.kind === "stop") return command(q.id, "stop", null, { confirmToken: q.token, surface: o.surface, from: o.from });
  if (q.kind === "pause") return command(q.id, "pause", null, o);
  if (q.kind === "good") return monitor.confirmResult(q.id, true).then(() => ({ ok: true, text: "Great. I cleared its pictures." }));
  return null;
}
export const hasPending = (o = {}) => { const q = pending.get(o.from?.id && o.from.id !== "local" ? `remote:${o.from.id}` : o.surface ?? "tv"); return Boolean(q && Date.now() - q.at < confirm.WINDOW_MS * 3); };
// after an alert: "Want me to pause it?" (pausing is harmless and resumable: a plain yes is enough)
function askPause(id) { for (const s of OWNER_SURFACES) pending.set(s, { kind: "pause", id, at: Date.now() }); }

function monitorDeps() {
  return {
    announce: (x) => deps.announce(x), broadcast: (t, d) => deps.broadcast(t, d), notify: (t) => deps.notify(t), activity: log,
    statusOf: (id) => conns.get(id)?.status() ?? {}, pause: (id) => command(id, "pause").then((r) => { if (!r.ok) throw new Error(r.text); }),
    reference, askPause, ai: (p) => aiFor(p), ffmpeg: deps.ffmpeg,
    clearAsk: (id) => { for (const [k, v] of pending) if (v.kind === "pause" && v.id === id) pending.delete(k); },
    snapshotWatch: async (p, opts) => { const cam = cameraId(p.id); if (!cam) throw new Error("no camera"); return bridge.watch(cam, opts); },
  };
}
monitor.setDeps(monitorDeps());

// ---- starting up ---------------------------------------------------------------------------------------------------------------
let started = false;
export async function startUp(d = {}) {
  setDeps(d);
  if (started) return; started = true;
  await gate.loaded;
  if (!gate.on("printers")) return;
  for (const p of store.list()) connection(p.id).catch((e) => console.log(`printers: ${p.name}: ${e.message}`));
  const t = setInterval(() => { try { monitor.prune(); } catch { /* next time */ } }, 6 * 3600_000); t.unref?.();
}
export function stopAll() { for (const id of [...conns.keys()]) forget(id); started = false; }
export const _announce = (x) => deps.announce(x);
export { store, monitor, bridge };
