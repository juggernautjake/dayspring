// Settings → Cameras, saved in data/cameras.json (DAYSPRING_CAMERAS_FILE for tests). Passwords are sealed with DPAPI and
// addresses are kept without them (secret.mjs), so the file holds nothing that opens a camera on its own.
//
//   camera: { id, name, kind, room, role, publicFacing, enabled, preset, conn, schedule, motion, ai, faces, alerts, retention, record, audio }
//     kind      usb | rtsp | http | onvif | gopro | homeassistant | folder | email   (sources registered by other features,
//               like the 3D printers, aren't saved here: they call cameras.register())
//     role      general | indoor | security | trail | printer
//     conn      usb: { device }   rtsp: { url, snapshotUrl }   http: { snapshotUrl, mjpegUrl, auth }
//               onvif: { host, port, profile }   gopro: { host, via: "usb"|"wifi", mode: "preview"|"photo" }
//               homeassistant: { entity }   folder: { folder, brand }   email: { from, subject, account, brand }
//               + username, password (sealed)
//     schedule  { mode: off | every | motion, everyMin, checkSec }
//     motion    { sensitivity 0–100, roi: [{ x, y, w, h }] (0–1, the parts to watch; none = everywhere) }
//     ai        { enabled (send pictures to the AI: off by default), when: motion | schedule | both, prompt, watchFor }
//     faces     recognise people the owner named: OFF by default, never on a public-facing camera (analyze.mjs)
//     alerts    { on, labels, urgent, quiet: { from, to } | null, cooldownMin, channels: { screen, voice, phone, devices }, summary }
//     retention { mode: all | events | hook, days }
//     record    { mode: off | events | continuous, preSec, postSec, segmentMin }
//   top level: { storageDir (null = data/cameras), diskCapGB, cameras: [...] }
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { writeJSONAtomic } from "../atomic.mjs";
import * as secret from "./secret.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = () => process.env.DAYSPRING_CAMERAS_FILE || join(ROOT, "data", "cameras.json");
export const DEFAULT_DIR = () => process.env.DAYSPRING_CAMERAS_DIR || join(ROOT, "data", "cameras");
export const KINDS = ["usb", "rtsp", "http", "onvif", "gopro", "homeassistant", "folder", "email"];
export const ROLES = ["general", "indoor", "security", "trail", "printer"];
export const LABELS = ["person", "animal", "deer", "vehicle", "package", "motion"];

const TOP = { v: 1, storageDir: null, diskCapGB: 20, cameras: [] };
export function defaultsFor(kind = "rtsp", role = "general") {
  const trail = role === "trail" || kind === "email" || kind === "folder";
  const security = role === "security" || trail;
  return {
    enabled: true, room: "", role, publicFacing: false, preset: null, conn: {}, audio: false,
    schedule: trail ? { mode: "every", everyMin: 15, checkSec: 5 } : { mode: security ? "motion" : "off", everyMin: 10, checkSec: 5 },
    motion: { sensitivity: 50, roi: [] },
    ai: { enabled: false, when: "motion", prompt: "", watchFor: trail ? ["deer", "animal", "person"] : ["person", "animal", "vehicle", "package"] },
    faces: false,
    alerts: { on: security, labels: trail ? ["deer", "animal", "person"] : ["person", "vehicle", "package"], urgent: [], quiet: null, cooldownMin: 10,
      channels: { screen: true, voice: true, phone: false, devices: true }, summary: true },
    retention: { mode: "events", days: 14 },
    record: { mode: "off", preSec: 5, postSec: 10, segmentMin: 5 },
  };
}

let db = null;
function load() {
  if (db) return db;
  let d = {};
  try { d = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { d = {}; }
  db = { ...TOP, ...d, cameras: Array.isArray(d.cameras) ? d.cameras : [] };
  return db;
}
function save() { writeJSONAtomic(FILE(), db, 2); for (const fn of listeners) { try { fn(); } catch { /* a listener must not break saving */ } } }
const listeners = [];
export const onChange = (fn) => listeners.push(fn);
export function _reset() { db = null; }

export const all = () => structuredClone(load().cameras);
export const get = (id) => structuredClone(load().cameras.find((c) => c.id === id) ?? null);
export function top() { const d = load(); return { storageDir: d.storageDir, diskCapGB: d.diskCapGB }; }
export function setTop({ storageDir, diskCapGB } = {}) {
  const d = load();
  if (storageDir !== undefined) {
    const s = String(storageDir ?? "").trim();
    if (s && !isAbsolute(s)) throw new Error("Pick a whole folder path, like D:\\Camera recordings.");
    d.storageDir = s ? resolve(s) : null;
  }
  if (diskCapGB !== undefined) { const n = Number(diskCapGB); if (!(n >= 0.1 && n <= 100_000)) throw new Error("The space limit is between 0.1 GB and 100,000 GB."); d.diskCapGB = n; }
  save(); return top();
}
export const storageDir = () => load().storageDir || DEFAULT_DIR();

// ---- the plain password never gets saved ----
const URL_FIELDS = ["url", "snapshotUrl", "mjpegUrl"];
function sealConn(conn = {}, old = {}) {
  const out = { ...conn };
  let username = out.username ?? old.username ?? "", password = null;
  for (const f of URL_FIELDS) {
    if (!out[f]) continue;
    const s = secret.splitUrl(out[f]);
    out[f] = s.url;
    if (s.username && !out.username) username = s.username;
    if (s.password && password === null) password = s.password;      // the first one found (they should all be the same)
  }
  if (typeof conn.password === "string" && conn.password && !secret.isSealed(conn.password)) password = conn.password;
  out.username = username;
  if (password !== null) out.password = secret.seal(password);
  else if (conn.password === "" && conn.clearPassword) out.password = "";
  else if (secret.isSealed(conn.password)) out.password = conn.password;
  else out.password = old.password ?? "";
  delete out.clearPassword;
  return out;
}
// credentials for use (memory only)
export function creds(cam) { return { username: cam?.conn?.username ?? "", password: cam?.conn?.password ? secret.unseal(cam.conn.password) : "" }; }

const clamp = (n, a, b, d) => { const x = Number(n); return Number.isFinite(x) ? Math.max(a, Math.min(b, x)) : d; };
const HM = /^([01]?\d|2[0-3]):[0-5]\d$/;
function clean(c, old = null) {
  const kind = KINDS.includes(c.kind) ? c.kind : old?.kind;
  if (!kind) throw new Error("Pick what kind of camera it is.");
  const role = ROLES.includes(c.role) ? c.role : old?.role ?? (kind === "email" || kind === "folder" ? "trail" : "general");
  const base = old ?? defaultsFor(kind, role);
  const name = String(c.name ?? base.name ?? "").trim().slice(0, 60);
  if (!name) throw new Error("Give the camera a name, like Front door or Trail cam.");
  const m = { ...base, ...c };
  const out = {
    id: old?.id ?? c.id ?? "cam-" + randomBytes(4).toString("hex"), name, kind, role,
    room: String(m.room ?? "").trim().slice(0, 40), enabled: m.enabled !== false, publicFacing: Boolean(m.publicFacing),
    preset: m.preset ? String(m.preset).slice(0, 30) : null, audio: Boolean(m.audio),
    conn: c.conn ? sealConn(c.conn, old?.conn ?? {}) : structuredClone(old?.conn ?? {}),
    schedule: { mode: ["off", "every", "motion"].includes(m.schedule?.mode) ? m.schedule.mode : "off", everyMin: clamp(m.schedule?.everyMin, 1, 1440, 10), checkSec: clamp(m.schedule?.checkSec, 1, 120, 5) },
    motion: { sensitivity: clamp(m.motion?.sensitivity, 0, 100, 50), roi: (Array.isArray(m.motion?.roi) ? m.motion.roi : []).slice(0, 8).map((r) => ({ x: clamp(r.x, 0, 1, 0), y: clamp(r.y, 0, 1, 0), w: clamp(r.w, 0.01, 1, 1), h: clamp(r.h, 0.01, 1, 1) })) },
    ai: { enabled: m.ai?.enabled === true, when: ["motion", "schedule", "both"].includes(m.ai?.when) ? m.ai.when : "motion", prompt: String(m.ai?.prompt ?? "").slice(0, 400),
      watchFor: (Array.isArray(m.ai?.watchFor) ? m.ai.watchFor : []).map((x) => String(x).toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 12) },
    // never on a public-facing camera, whatever was sent
    faces: m.faces === true && !m.publicFacing,
    alerts: { on: typeof m.alerts?.on === "boolean" ? m.alerts.on : Boolean(base.alerts?.on),
      labels: (Array.isArray(m.alerts?.labels) ? m.alerts.labels : []).map((x) => String(x).toLowerCase().slice(0, 30)).slice(0, 12),
      urgent: (Array.isArray(m.alerts?.urgent) ? m.alerts.urgent : []).map((x) => String(x).toLowerCase().slice(0, 30)).slice(0, 12),
      quiet: m.alerts?.quiet && HM.test(m.alerts.quiet.from ?? "") && HM.test(m.alerts.quiet.to ?? "") ? { from: m.alerts.quiet.from, to: m.alerts.quiet.to } : null,
      cooldownMin: clamp(m.alerts?.cooldownMin, 0, 1440, 10),
      channels: { screen: m.alerts?.channels?.screen !== false, voice: m.alerts?.channels?.voice !== false, phone: m.alerts?.channels?.phone === true, devices: m.alerts?.channels?.devices !== false },
      summary: m.alerts?.summary !== false },
    retention: { mode: ["all", "events", "hook"].includes(m.retention?.mode) ? m.retention.mode : "events", days: clamp(m.retention?.days, 1, 3650, 14) },
    record: { mode: ["off", "events", "continuous"].includes(m.record?.mode) ? m.record.mode : "off", preSec: clamp(m.record?.preSec, 0, 30, 5), postSec: clamp(m.record?.postSec, 2, 300, 10), segmentMin: clamp(m.record?.segmentMin, 1, 60, 5) },
  };
  if (kind === "usb" && !out.conn.device) throw new Error("Pick the webcam from the list (Discover USB cameras).");
  if (kind === "rtsp" && !out.conn.url) throw new Error("Type the camera's stream address (rtsp://…), or pick its brand.");
  if (kind === "http" && !out.conn.snapshotUrl && !out.conn.mjpegUrl) throw new Error("Type the camera's picture address or MJPEG address.");
  if (kind === "onvif" && !out.conn.host) throw new Error("Type the camera's address, or use Discover.");
  if (kind === "gopro" && !out.conn.host) out.conn.host = out.conn.via === "usb" ? "" : "10.5.5.9";
  if (kind === "homeassistant" && !/^camera\.[\w]+$/.test(out.conn.entity ?? "")) throw new Error("Pick the Home Assistant camera (camera.something).");
  if (kind === "folder" && !out.conn.folder) throw new Error("Pick the folder the photos arrive in.");
  if (kind === "email" && !out.conn.from && !out.conn.subject) throw new Error("Say who the photo emails come from (like spypoint.com), or words in their subject.");
  return out;
}
export function add(c) { const d = load(); const cam = clean(c); if (d.cameras.some((x) => x.id === cam.id)) throw new Error("That camera is already here."); d.cameras.push(cam); save(); return structuredClone(cam); }
export function update(id, patch) {
  const d = load(); const i = d.cameras.findIndex((c) => c.id === id);
  if (i < 0) throw Object.assign(new Error("I can't find that camera."), { status: 404 });
  const old = d.cameras[i];
  const merged = { ...patch, ...(patch.conn ? { conn: { ...old.conn, ...patch.conn, password: patch.conn.password } } : {}) };
  delete merged.id;
  const cam = clean({ ...merged, kind: old.kind }, old);
  d.cameras[i] = cam; save(); return structuredClone(cam);
}
export function remove(id) { const d = load(); const n = d.cameras.length; d.cameras = d.cameras.filter((c) => c.id !== id); if (d.cameras.length === n) return false; save(); return true; }
// a draft for "Test" (not saved): the same cleaning, the password stays in memory
export function draft(c) { const cam = clean({ ...c, name: c.name || "Test" }); return cam; }

// what the page sees: never a password, addresses without secrets
export function publicCam(c) {
  if (!c) return null;
  const conn = { ...c.conn }; const hasPassword = Boolean(conn.password); delete conn.password;
  for (const f of URL_FIELDS) if (conn[f]) conn[f] = secret.redact(conn[f]);
  return { ...c, conn: { ...conn, hasPassword } };
}
