// The home's devices, strips, scenes, groups and schedules: data/devices-home.json (DAYSPRING_DEVICES_FILE in tests).
// Passwords, tokens and keys are never in it as plain text: they're sealed with DPAPI in its "secrets" field (./secrets.mjs).
//
//   strip   { id, name, adapter, host, port?, model?, outlets, outletNames: [], childIds: [], custom?, room?, notes? }
//           One piece of hardware that switches power: a power strip (HS300, KP303, P300, Shelly 4PM, Meross MSS425F), a
//           single smart plug (outlets: 1), or a custom HTTP/MQTT device. Outlets are numbered from 1, as printed on it.
//   device  { id, name, aliases, type, room, group, number?, safety?, critical, hostsDayspring, permission, power: [..],
//             control?, printer?, autoOffMinutes?, alertOpenMinutes?, icon? }
//           power: how it turns on and off, tried in order: { via: "outlet", strip, outlet } · { via: "wol", mac, broadcast?,
//           port? } · { via: "homeassistant" | "matter", entity } · { via: "cec", address? } · { via: "webhook", on, off, status }
//           control: a richer adapter for lights and the like: { via: "wled", host } · { via: "hue", bridge, light } ·
//           { via: "homeassistant", entity } (lights, covers, locks, climate)
//   scene   { id, name, aliases, steps: [{ device, action, value? }] }      group { id, name, aliases, members: [ids] }
//   schedule{ id, target: { kind, id, label }, action, at?: ISO, daily?: "HH:MM", days?: [0-6], approved, from, created }
//   hues    Hue bridges { id, host, name } (their app keys are secrets)
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";
import * as secrets from "./secrets.mjs";
import { slug, TYPES, SAFETY } from "./model.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
export const FILE = () => process.env.DAYSPRING_DEVICES_FILE || join(DATA, "devices-home.json");
export const DEFAULT_OPTIONS = { minToggleSeconds: 3, maxTogglesPerMinute: 8, maxActionsPerMinute: 40, bulkConfirmAt: 4, wolDelaySeconds: 8, statusCacheMs: 3000 };
const EMPTY = () => ({ v: 1, strips: [], devices: [], scenes: [], groups: [], schedules: [], hues: [], options: { ...DEFAULT_OPTIONS }, secrets: "" });

let db = null, dbFile = null;
export function load() {
  if (db && dbFile === FILE()) return db;
  dbFile = FILE();
  try { db = existsSync(dbFile) ? { ...EMPTY(), ...JSON.parse(readFileSync(dbFile, "utf8")) } : EMPTY(); }
  catch { db = EMPTY(); }
  db.options = { ...DEFAULT_OPTIONS, ...(db.options ?? {}) };
  for (const k of ["strips", "devices", "scenes", "groups", "schedules", "hues"]) if (!Array.isArray(db[k])) db[k] = [];
  return db;
}
export function save() { mkdirSync(dirname(FILE()), { recursive: true }); writeJSONAtomic(FILE(), load(), 2); listeners.forEach((f) => { try { f(); } catch { /* one listener */ } }); }
export function _reset() { db = null; dbFile = null; }
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---- secrets (sealed; the screen only ever learns whether one is set) ----
export function secretFor(id) { try { return secrets.open(load().secrets)[id] ?? {}; } catch { return {}; } }
export function setSecret(id, value) {
  const all = (() => { try { return secrets.open(load().secrets); } catch { return {}; } })();
  const clean = Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  if (Object.keys(clean).length) all[id] = { ...(all[id] ?? {}), ...clean }; else delete all[id];
  load().secrets = secrets.seal(all);
}
export function hasSecret(id) { return Object.keys(secretFor(id)).length > 0; }

// ---- reading ----
export const strips = () => load().strips;
export const devices = () => load().devices;
export const scenes = () => load().scenes;
export const groups = () => load().groups;
export const schedules = () => load().schedules;
export const options = () => load().options;
export const strip = (id) => load().strips.find((s) => s.id === id) ?? null;
export const device = (id) => load().devices.find((d) => d.id === id) ?? null;
export const rooms = () => [...new Set(load().devices.map((d) => d.room).filter(Boolean))].sort();
// which device sits on a strip's outlet
export const onOutlet = (stripId, outlet) => load().devices.find((d) => (d.power ?? []).some((p) => p.via === "outlet" && p.strip === stripId && Number(p.outlet) === Number(outlet))) ?? null;

// ---- writing ----
const str = (v, n = 80) => String(v ?? "").trim().slice(0, n);
const list = (v, n = 20) => (Array.isArray(v) ? v : String(v ?? "").split(/[,;\n]/)).map((x) => str(x, 60)).filter(Boolean).slice(0, n);
const PERM = ["inherit", "off", "ask", "on"];
function cleanPower(p) {
  if (!p || typeof p !== "object") return null;
  const via = String(p.via ?? "");
  if (via === "outlet") return p.strip && Number(p.outlet) >= 1 ? { via, strip: str(p.strip, 40), outlet: Math.round(Number(p.outlet)) } : null;
  if (via === "wol") { const mac = String(p.mac ?? "").toUpperCase().replace(/[^0-9A-F]/g, ""); return mac.length === 12 ? { via, mac: mac.match(/../g).join(":"), broadcast: str(p.broadcast, 60) || "255.255.255.255", port: Number(p.port) || 9 } : null; }
  if (via === "homeassistant" || via === "matter") return /^[a-z_]+\.[\w]+$/.test(String(p.entity ?? "")) ? { via, entity: String(p.entity) } : null;
  if (via === "cec") return { via, address: Math.max(0, Math.min(15, Number(p.address) || 0)) };
  if (via === "webhook") return p.on || p.off ? { via, on: p.on ?? null, off: p.off ?? null, status: p.status ?? null } : null;
  return null;
}
function cleanControl(c) {
  if (!c || typeof c !== "object") return null;
  if (c.via === "wled" && c.host) return { via: "wled", host: str(c.host, 120), segment: c.segment != null ? Number(c.segment) : undefined };
  if (c.via === "hue" && c.bridge && c.light) return { via: "hue", bridge: str(c.bridge, 40), light: str(c.light, 60), kind: c.kind === "group" ? "group" : "light" };
  if (c.via === "homeassistant" && /^[a-z_]+\.[\w]+$/.test(String(c.entity ?? ""))) return { via: "homeassistant", entity: String(c.entity) };
  return null;
}
export function saveDevice(input = {}) {
  const d0 = load();
  const existing = input.id ? device(input.id) : null;
  const name = str(input.name ?? existing?.name, 60);
  if (!name) throw new Error("Give the device a name, like “Computer” or “Fan 2”.");
  const type = TYPES[input.type] ? input.type : existing?.type ?? "other";
  const d = {
    ...(existing ?? {}),
    id: existing?.id ?? slug(name, new Set(d0.devices.map((x) => x.id))),
    name, type,
    aliases: input.aliases !== undefined ? list(input.aliases) : existing?.aliases ?? [],
    room: input.room !== undefined ? str(input.room, 40).toLowerCase() : existing?.room ?? "",
    group: input.group !== undefined ? str(input.group, 40).toLowerCase() : existing?.group ?? "",
    number: input.number !== undefined ? (Number(input.number) >= 1 ? Math.round(Number(input.number)) : undefined) : existing?.number,
    safety: SAFETY.includes(input.safety) ? input.safety : input.safety === "" ? undefined : existing?.safety,
    critical: input.critical !== undefined ? Boolean(input.critical) : Boolean(existing?.critical ?? ["router", "fridge"].includes(type)),
    hostsDayspring: input.hostsDayspring !== undefined ? Boolean(input.hostsDayspring) : Boolean(existing?.hostsDayspring),
    permission: PERM.includes(input.permission) ? input.permission : existing?.permission ?? "inherit",
    power: input.power !== undefined ? (Array.isArray(input.power) ? input.power : [input.power]).map(cleanPower).filter(Boolean).slice(0, 4) : existing?.power ?? [],
    control: input.control !== undefined ? cleanControl(input.control) : existing?.control ?? null,
    printer: input.printer !== undefined ? (str(input.printer, 40) || null) : existing?.printer ?? null,
    autoOffMinutes: input.autoOffMinutes !== undefined ? (Number(input.autoOffMinutes) > 0 ? Math.min(24 * 60, Math.round(Number(input.autoOffMinutes))) : null) : existing?.autoOffMinutes ?? null,
    alertOpenMinutes: input.alertOpenMinutes !== undefined ? (Number(input.alertOpenMinutes) > 0 ? Math.round(Number(input.alertOpenMinutes)) : null) : existing?.alertOpenMinutes ?? null,
    hostname: input.hostname !== undefined ? str(input.hostname, 64) : existing?.hostname ?? "",
  };
  if (d.hostsDayspring) d.critical = true;
  if (existing) Object.assign(existing, d); else d0.devices.push(d);
  save();
  return d;
}
export function removeDevice(id) {
  const d0 = load(); const before = d0.devices.length;
  d0.devices = d0.devices.filter((d) => d.id !== id);
  for (const g of d0.groups) g.members = g.members.filter((m) => m !== id);
  for (const s of d0.scenes) s.steps = s.steps.filter((x) => x.device !== id);
  d0.schedules = d0.schedules.filter((s) => !(s.target?.kind === "device" && s.target.id === id));
  save(); return before !== d0.devices.length;
}
export function saveStrip(input = {}) {
  const d0 = load();
  const existing = input.id ? strip(input.id) : null;
  const adapter = str(input.adapter ?? existing?.adapter, 20);
  if (!adapter) throw new Error("Which kind of strip or plug is it?");
  const name = str(input.name ?? existing?.name, 60) || `Strip ${String.fromCharCode(65 + d0.strips.length)}`;
  const s = {
    ...(existing ?? {}),
    id: existing?.id ?? (str(input.id, 20) || String.fromCharCode(65 + d0.strips.filter((x) => /^[A-Z]$/.test(x.id)).length)),
    name, adapter,
    host: input.host !== undefined ? str(input.host, 120) : existing?.host ?? "",
    port: input.port !== undefined ? (Number(input.port) || undefined) : existing?.port,
    model: input.model !== undefined ? str(input.model, 40) : existing?.model ?? "",
    outlets: Math.max(1, Math.min(16, Number(input.outlets ?? existing?.outlets ?? 1) || 1)),
    outletNames: Array.isArray(input.outletNames) ? input.outletNames.map((x) => str(x, 40)) : existing?.outletNames ?? [],
    childIds: Array.isArray(input.childIds) ? input.childIds.map((x) => str(x, 80)) : existing?.childIds ?? [],
    custom: input.custom !== undefined ? input.custom : existing?.custom ?? null,
    room: input.room !== undefined ? str(input.room, 40).toLowerCase() : existing?.room ?? "",
    mac: input.mac !== undefined ? str(input.mac, 20) : existing?.mac ?? "",
    // what the adapter learned: a Shelly's generation, a Kasa that speaks KLAP (and on which port)
    gen: input.gen !== undefined ? (Number(input.gen) || undefined) : existing?.gen,
    protocol: input.protocol !== undefined ? (input.protocol === "klap" ? "klap" : undefined) : existing?.protocol,
    klapPort: input.klapPort !== undefined ? (Number(input.klapPort) || undefined) : existing?.klapPort,
  };
  if (strip(s.id) && !existing) throw new Error(`There's already a strip called ${s.id}.`);
  if (input.secret) setSecret(`strip:${s.id}`, input.secret);
  if (existing) Object.assign(existing, s); else d0.strips.push(s);
  save();
  return s;
}
export function removeStrip(id) {
  const d0 = load(); const before = d0.strips.length;
  d0.strips = d0.strips.filter((s) => s.id !== id);
  for (const d of d0.devices) d.power = (d.power ?? []).filter((p) => !(p.via === "outlet" && p.strip === id));
  setSecret(`strip:${id}`, null);
  save(); return before !== d0.strips.length;
}
export function saveScene(input = {}) {
  const d0 = load();
  const name = str(input.name, 60);
  if (!name) throw new Error("Give the scene a name, like “Movie mode”.");
  const existing = input.id ? d0.scenes.find((s) => s.id === input.id) : d0.scenes.find((s) => s.name.toLowerCase() === name.toLowerCase());
  const steps = (Array.isArray(input.steps) ? input.steps : []).filter((x) => x && device(x.device) && ["on", "off", "toggle", "brightness", "color", "effect", "colortemp"].includes(x.action)).map((x) => ({ device: x.device, action: x.action, ...(x.value !== undefined ? { value: x.value } : {}) })).slice(0, 60);
  const s = { id: existing?.id ?? slug(name, new Set(d0.scenes.map((x) => x.id))), name, aliases: list(input.aliases ?? existing?.aliases ?? []), steps };
  if (existing) Object.assign(existing, s); else d0.scenes.push(s);
  save(); return s;
}
export function removeScene(id) { const d0 = load(); const n = d0.scenes.length; d0.scenes = d0.scenes.filter((s) => s.id !== id); save(); return n !== d0.scenes.length; }
export function saveGroup(input = {}) {
  const d0 = load();
  const name = str(input.name, 60);
  if (!name) throw new Error("Give the group a name.");
  const existing = input.id ? d0.groups.find((g) => g.id === input.id) : d0.groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
  const g = { id: existing?.id ?? slug(name, new Set(d0.groups.map((x) => x.id))), name, aliases: list(input.aliases ?? existing?.aliases ?? []), members: (input.members ?? existing?.members ?? []).filter((m) => device(m)) };
  if (existing) Object.assign(existing, g); else d0.groups.push(g);
  save(); return g;
}
export function removeGroup(id) { const d0 = load(); const n = d0.groups.length; d0.groups = d0.groups.filter((s) => s.id !== id); save(); return n !== d0.groups.length; }
export function setOptions(patch = {}) {
  const o = load().options;
  for (const k of Object.keys(DEFAULT_OPTIONS)) if (patch[k] !== undefined && Number.isFinite(Number(patch[k]))) o[k] = Number(patch[k]);
  save(); return o;
}
export function saveHue(input = {}) {
  const d0 = load();
  const existing = d0.hues.find((h) => h.id === input.id || h.host === input.host);
  const h = { id: existing?.id ?? (str(input.id, 40) || slug(input.name ?? "hue", new Set(d0.hues.map((x) => x.id)))), host: str(input.host ?? existing?.host, 120), name: str(input.name ?? existing?.name ?? "Hue bridge", 60) };
  if (input.key) setSecret(`hue:${h.id}`, { key: input.key });
  if (existing) Object.assign(existing, h); else d0.hues.push(h);
  save(); return h;
}
export const hue = (id) => load().hues.find((h) => h.id === id) ?? null;
