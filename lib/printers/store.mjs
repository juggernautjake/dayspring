// The owner's 3D printers: data/printers.json (DAYSPRING_PRINTERS_FILE in tests). Access codes and API keys are sealed
// with DPAPI in its "secrets" field (lib/devices/secrets.mjs), never in plain text.
//   printer { id, name, number, aliases, brand: bambu | marlin | octoprint | moonraker, model, host, serial, port,
//             serialPath, baud, cameraId (a camera from lib/cameras, for printers without one), cameraUrl,
//             bed: { roi: { x, y, w, h }, refs: { <plate>: file }, plate }, options: {..}, queue: { folder, items: [..] } }
//   options: snapshotMinutes (10) · autoPause (false) · autoStart (false: "ask me first") · aiVision (null = follow
//            Settings → Photos & people "describe pictures with AI") · keepTimelapse (false) · confirmGood (false) ·
//            retentionDays (30) · sensitivity (0.6) · textOnFailure (false)
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";
import * as secrets from "../devices/secrets.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
export const FILE = () => process.env.DAYSPRING_PRINTERS_FILE || join(DATA, "printers.json");
export const PRINTS_DIR = () => process.env.DAYSPRING_PRINTS_DIR || join(DATA, "prints");
export const REFS_DIR = () => join(PRINTS_DIR(), "_bed");
export const OPTION_DEFAULTS = { snapshotMinutes: 10, autoPause: false, autoStart: false, aiVision: null, keepTimelapse: false, confirmGood: false, retentionDays: 30, sensitivity: 0.6, textOnFailure: false };
export const BRANDS = ["bambu", "marlin", "octoprint", "moonraker"];

let db = null, dbFile = null;
export function load() {
  if (db && dbFile === FILE()) return db;
  dbFile = FILE();
  try { db = existsSync(dbFile) ? JSON.parse(readFileSync(dbFile, "utf8")) : null; } catch { db = null; }
  db = { v: 1, printers: [], secrets: "", ...(db ?? {}) };
  for (const p of db.printers) { p.options = { ...OPTION_DEFAULTS, ...(p.options ?? {}) }; p.bed ??= { roi: null, refs: {}, plate: "default" }; p.queue ??= { folder: "", items: [] }; }
  return db;
}
export function save() { mkdirSync(dirname(FILE()), { recursive: true }); writeJSONAtomic(FILE(), load(), 2); }
export function _reset() { db = null; dbFile = null; }
export const list = () => load().printers;
export const get = (id) => load().printers.find((p) => p.id === id) ?? null;
export function secretFor(id) { try { return secrets.open(load().secrets)[id] ?? {}; } catch { return {}; } }
export function setSecret(id, value) {
  const all = (() => { try { return secrets.open(load().secrets); } catch { return {}; } })();
  const clean = Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  if (value === null) delete all[id]; else if (Object.keys(clean).length) all[id] = { ...(all[id] ?? {}), ...clean };
  load().secrets = secrets.seal(all);
}
const str = (v, n = 80) => String(v ?? "").trim().slice(0, n);
export function savePrinter(input = {}) {
  const d = load();
  const ex = input.id ? get(input.id) : null;
  const brand = BRANDS.includes(input.brand) ? input.brand : ex?.brand ?? "bambu";
  const name = str(input.name ?? ex?.name, 60);
  if (!name) throw new Error("Give the printer a name, like “Printer 1” or “the X1”.");
  const used = new Set(d.printers.filter((p) => p !== ex).map((p) => p.number));
  let number = Number(input.number ?? ex?.number) || 0;
  if (!number || used.has(number)) { number = 1; while (used.has(number)) number++; }
  const p = {
    ...(ex ?? {}),
    id: ex?.id ?? (str(input.id, 30).replace(/[^\w-]/g, "") || `p${number}`),
    name, number, brand,
    aliases: input.aliases !== undefined ? (Array.isArray(input.aliases) ? input.aliases : String(input.aliases).split(/[,;\n]/)).map((x) => str(x, 60)).filter(Boolean).slice(0, 12) : ex?.aliases ?? [],
    model: str(input.model ?? ex?.model, 30),
    host: str(input.host ?? ex?.host, 200), serial: str(input.serial ?? ex?.serial, 40).toUpperCase(),
    port: input.port !== undefined ? (Number(input.port) || undefined) : ex?.port,
    // advanced (a bridge or a test setup): other ports for the printer's MQTT, FTPS and camera
    mqttPort: input.mqttPort !== undefined ? (Number(input.mqttPort) || undefined) : ex?.mqttPort,
    ftpPort: input.ftpPort !== undefined ? (Number(input.ftpPort) || undefined) : ex?.ftpPort,
    cameraPort: input.cameraPort !== undefined ? (Number(input.cameraPort) || undefined) : ex?.cameraPort,
    serialPath: str(input.serialPath ?? ex?.serialPath, 120), baud: Number(input.baud ?? ex?.baud) || 115200,
    cameraId: input.cameraId !== undefined ? str(input.cameraId, 60) || null : ex?.cameraId ?? null,
    cameraUrl: input.cameraUrl !== undefined ? str(input.cameraUrl, 300) || null : ex?.cameraUrl ?? null,
    room: input.room !== undefined ? str(input.room, 40).toLowerCase() : ex?.room ?? "",
    options: { ...OPTION_DEFAULTS, ...(ex?.options ?? {}), ...cleanOptions(input.options ?? {}) },
    bed: ex?.bed ?? { roi: null, refs: {}, plate: "default" },
    queue: ex?.queue ?? { folder: "", items: [] },
  };
  if (d.printers.some((x) => x.id === p.id && x !== ex)) throw new Error("There's already a printer with that id.");
  if (input.accessCode) setSecret(p.id, { accessCode: str(input.accessCode, 40) });
  if (input.apiKey) setSecret(p.id, { apiKey: str(input.apiKey, 200) });
  if (ex) Object.assign(ex, p); else d.printers.push(p);
  save();
  return p;
}
export function cleanOptions(o = {}) {
  const out = {};
  if (o.snapshotMinutes !== undefined) out.snapshotMinutes = Math.max(1, Math.min(120, Math.round(Number(o.snapshotMinutes)) || 10));
  for (const k of ["autoPause", "autoStart", "keepTimelapse", "confirmGood", "textOnFailure"]) if (o[k] !== undefined) out[k] = o[k] === true || o[k] === "true";
  if (o.aiVision !== undefined) out.aiVision = o.aiVision === null || o.aiVision === "" || o.aiVision === "auto" ? null : o.aiVision === true || o.aiVision === "true";
  if (o.retentionDays !== undefined) out.retentionDays = Math.max(1, Math.min(365, Math.round(Number(o.retentionDays)) || 30));
  if (o.sensitivity !== undefined) out.sensitivity = Math.max(0.3, Math.min(0.95, Number(o.sensitivity) || 0.6));
  return out;
}
export function removePrinter(id) { const d = load(); const n = d.printers.length; d.printers = d.printers.filter((p) => p.id !== id); setSecret(id, null); save(); return n !== d.printers.length; }
export function setOptions(id, o) { const p = get(id); if (!p) throw new Error("No such printer."); p.options = { ...p.options, ...cleanOptions(o) }; save(); return p.options; }
export function setBed(id, patch = {}) {
  const p = get(id); if (!p) throw new Error("No such printer.");
  if (patch.roi !== undefined) {
    const r = patch.roi; const ok = r && [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(Number(v))) && r.w > 0.05 && r.h > 0.05;
    p.bed.roi = ok ? { x: clamp(r.x), y: clamp(r.y), w: Math.min(1 - clamp(r.x), clamp(r.w)), h: Math.min(1 - clamp(r.y), clamp(r.h)) } : null;
  }
  if (patch.plate) p.bed.plate = str(patch.plate, 30).toLowerCase().replace(/[^\w-]+/g, "_") || "default";
  if (patch.ref) p.bed.refs = { ...(p.bed.refs ?? {}), [patch.ref.plate]: patch.ref.file };
  save(); return p.bed;
}
const clamp = (v) => Math.max(0, Math.min(1, Number(v)));
