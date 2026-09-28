// Compatibility lists: which devices, services, browsers and systems work with Dayspring, and how well we know it.
// The data is compat/<category>.json, one file per category: { category, label, description, entries: [entry] }.
//   entry { id, brand, model, category, connection, offline, status, capabilities: [], notes, howToSetUp: [steps],
//           links: [url], lastChecked: "YYYY-MM-DD", reason? (required for not-supported), features?: [feature ids] }
//   status  verified (the owner confirmed it) · tested-sim (passes our simulator tests) · expected (should work, per the
//           protocol's documentation) · untested · not-supported (with the reason)
// When the owner marks a checklist test as passed on the Testing page, the entries it names can become "verified":
// that goes into data/compat-verified.json ({ entries: { id: { by, at, test } } }), laid over the shipped data.
// docs/compatibility.md is generated from the same data (scripts/gen-feature-docs.mjs).
//   load() → { categories, entries } · validate(entry) → [problems] · validateAll() · verify(id, { by, test }) · unverify(id)
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIR = () => process.env.DAYSPRING_COMPAT_DIR || join(DESK, "compat");
const OVERLAY = () => process.env.DAYSPRING_COMPAT_VERIFIED || join(process.env.DAYSPRING_DATA_DIR || join(DESK, "data"), "compat-verified.json");

export const STATUSES = ["verified", "tested-sim", "expected", "untested", "not-supported"];
export const STATUS_LABEL = { verified: "Verified", "tested-sim": "Passes simulator tests", expected: "Expected to work", untested: "Untested", "not-supported": "Not supported" };
export const CONNECTIONS = ["lan", "ble", "zigbee-ha", "zwave-ha", "matter-ha", "cloud", "usb", "ir", "local", "folder", "email"];
export const CONNECTION_LABEL = { lan: "Home network (local)", ble: "Bluetooth LE", "zigbee-ha": "Zigbee via Home Assistant", "zwave-ha": "Z-Wave via Home Assistant", "matter-ha": "Matter / Thread via Home Assistant",
  cloud: "Internet service", usb: "USB", ir: "Infrared", local: "On this computer", folder: "A folder or SD card", email: "Email" };
// the category files, in the order the page shows them
export const CATEGORIES = ["power", "lights", "led-strips", "bluetooth", "printers", "cameras", "hubs", "email", "gifs", "ai-voice", "browsers", "os"];

const readJSON = (f, fb) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")) : fb; } catch { return fb; } };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9][a-z0-9-]{1,80}$/;

export function validate(e, category = null) {
  const bad = [];
  const need = (k, ok) => { if (!ok) bad.push(`${e?.id ?? "?"}: ${k}`); };
  if (!e || typeof e !== "object") return ["not an object"];
  need("id (lowercase letters, digits and dashes)", ID.test(String(e.id ?? "")));
  need("brand", typeof e.brand === "string" && e.brand.trim().length > 0);
  need("model", typeof e.model === "string" && e.model.trim().length > 0);
  need("category", typeof e.category === "string" && (!category || e.category === category));
  need(`connection (one of ${CONNECTIONS.join(", ")})`, CONNECTIONS.includes(e.connection));
  need("offline (true or false)", typeof e.offline === "boolean");
  need(`status (one of ${STATUSES.join(", ")})`, STATUSES.includes(e.status));
  need("capabilities (a list)", Array.isArray(e.capabilities) && e.capabilities.every((c) => typeof c === "string"));
  need("notes", typeof e.notes === "string");
  need("howToSetUp (a list of steps)", Array.isArray(e.howToSetUp) && e.howToSetUp.every((s) => typeof s === "string" && s.trim()));
  need("links (a list of https addresses)", Array.isArray(e.links) && e.links.every((l) => /^https:\/\/\S+$/.test(l)));
  need("lastChecked (YYYY-MM-DD)", DATE.test(String(e.lastChecked ?? "")));
  if (e.status === "not-supported") need("reason (why it isn't supported)", typeof e.reason === "string" && e.reason.trim().length > 0);
  else need("howToSetUp has at least one step", Array.isArray(e.howToSetUp) && e.howToSetUp.length > 0);
  if (e.features !== undefined) need("features (a list of feature ids)", Array.isArray(e.features));
  return bad;
}

// { categories: [{ id, label, description, count }], entries: [entry + { verifiedBy?, verifiedAt? }] }
export function load() {
  const over = readJSON(OVERLAY(), {})?.entries ?? {};
  const categories = [], entries = [];
  const files = existsSync(DIR()) ? readdirSync(DIR()).filter((f) => f.endsWith(".json")) : [];
  const order = (f) => { const i = CATEGORIES.indexOf(f.replace(/\.json$/, "")); return i < 0 ? 99 : i; };
  for (const f of files.sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    const d = readJSON(join(DIR(), f), null);
    if (!d || !Array.isArray(d.entries)) continue;
    categories.push({ id: d.category, label: d.label ?? d.category, description: d.description ?? "", count: d.entries.length });
    for (const e of d.entries) {
      const v = over[e.id];
      entries.push(v ? { ...e, status: "verified", shippedStatus: e.status, verifiedBy: v.by ?? "owner", verifiedAt: v.at ?? null, verifiedTest: v.test ?? null } : { ...e });
    }
  }
  return { categories, entries, statuses: STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] })), connections: CONNECTIONS.map((c) => ({ id: c, label: CONNECTION_LABEL[c] })) };
}

export function validateAll() {
  const problems = [], seen = new Set();
  const files = existsSync(DIR()) ? readdirSync(DIR()).filter((f) => f.endsWith(".json")) : [];
  if (!files.length) problems.push("no compat/*.json files");
  for (const f of files) {
    const d = readJSON(join(DIR(), f), null);
    if (!d) { problems.push(`${f}: not valid JSON`); continue; }
    if (`${d.category}.json` !== f) problems.push(`${f}: category "${d.category}" doesn't match the file name`);
    if (!CATEGORIES.includes(d.category)) problems.push(`${f}: unknown category "${d.category}"`);
    if (!Array.isArray(d.entries) || !d.entries.length) { problems.push(`${f}: no entries`); continue; }
    for (const e of d.entries) {
      problems.push(...validate(e, d.category).map((p) => `${f}: ${p}`));
      if (seen.has(e.id)) problems.push(`${f}: duplicate id ${e.id}`);
      seen.add(e.id);
    }
  }
  return problems;
}

// counts per category and status (the report, the docs)
export function counts() {
  const { categories, entries } = load();
  return categories.map((c) => ({ category: c.id, label: c.label, total: c.count, ...Object.fromEntries(STATUSES.map((s) => [s, entries.filter((e) => e.category === c.id && e.status === s).length])) }));
}

function writeOverlay(v) { const f = OVERLAY(); mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 2) + "\n"); renameSync(tmp, f); }
export function verify(id, { by = "owner", test = null } = {}) {
  if (!load().entries.some((e) => e.id === id)) throw new Error(`There's no compatibility entry "${id}".`);
  const o = readJSON(OVERLAY(), {}) ?? {};
  o.entries = { ...(o.entries ?? {}), [id]: { by: String(by).slice(0, 80), at: new Date().toISOString(), test } };
  writeOverlay(o);
  return load().entries.find((e) => e.id === id);
}
export function unverify(id) {
  const o = readJSON(OVERLAY(), {}) ?? {};
  if (o.entries?.[id]) { delete o.entries[id]; writeOverlay(o); }
  return load().entries.find((e) => e.id === id) ?? null;
}
