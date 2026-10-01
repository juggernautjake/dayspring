// Shopping's own settings and small memory, in data/shopping.json (never shipped; tests: DAYSPRING_SHOPPING_FILE).
//   enabled        the owner's on/off switch in Settings → Shopping (off until he turns it on)
//   notify         subscription notifications (Subscribe & Save), off until he turns them on; notifyDays: how far ahead
//   defaults       default filters for every search: { prime, maxPrice, minRating }
//   askBeforeOpen  ask before Dayspring opens Amazon pages (a yes covers the next 15 minutes)
//   signedIn / account / checkedAt   whether Amazon is signed in in the media window, and the greeting name it shows
//   lastSubsCheck / seenSubs          the once-a-day check: when it last looked, and which deliveries were already told
//   saved          "Save for later": items kept here on this computer (title, price, picture, ASIN), never on Amazon
// Never: a password, a cookie, a card, an address, an order or a one-time code.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";

const FILE = () => process.env.DAYSPRING_SHOPPING_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "shopping.json");
export const DEFAULTS = { enabled: false, notify: false, notifyDays: 7, defaults: { prime: false, maxPrice: null, minRating: null }, askBeforeOpen: false,
  signedIn: null, account: null, checkedAt: null, lastSubsCheck: 0, seenSubs: [], saved: [] };
let db = null;
export function load() {
  if (db && db.file === FILE()) return db.v;
  let raw = {};
  try { raw = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8").replace(/^﻿/, "")) : {}; } catch { raw = {}; }
  db = { file: FILE(), v: { ...structuredClone(DEFAULTS), ...raw, defaults: { ...DEFAULTS.defaults, ...(raw.defaults ?? {}) } } };
  return db.v;
}
function save() { try { mkdirSync(dirname(FILE()), { recursive: true }); writeJSONAtomic(FILE(), load(), 2); } catch (e) { console.log(`shopping: settings not saved (${e.message})`); } }
export function _reset() { db = null; }
const num = (v, lo, hi) => { if (v === null || v === "" || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
// what the Settings page may change (and the voice: notify on/off)
export function set(patch = {}) {
  const s = load();
  if (patch.enabled !== undefined) s.enabled = Boolean(patch.enabled);
  if (patch.notify !== undefined) s.notify = Boolean(patch.notify);
  if (patch.notifyDays !== undefined) s.notifyDays = num(patch.notifyDays, 1, 30) ?? 7;
  if (patch.askBeforeOpen !== undefined) s.askBeforeOpen = Boolean(patch.askBeforeOpen);
  if (patch.defaults && typeof patch.defaults === "object") {
    const d = patch.defaults;
    if (d.prime !== undefined) s.defaults.prime = Boolean(d.prime);
    if (d.maxPrice !== undefined) s.defaults.maxPrice = num(d.maxPrice, 1, 100000);
    if (d.minRating !== undefined) s.defaults.minRating = [1, 2, 3, 4].includes(Number(d.minRating)) ? Number(d.minRating) : null;
  }
  save();
  return view();
}
// internal changes (sign-in state, the subscription check, saved items)
export function patch(p) { Object.assign(load(), p); save(); return load(); }
export function view() { const s = load(); return { enabled: s.enabled, notify: s.notify, notifyDays: s.notifyDays, defaults: { ...s.defaults }, askBeforeOpen: s.askBeforeOpen, signedIn: s.signedIn, account: s.account, checkedAt: s.checkedAt, lastSubsCheck: s.lastSubsCheck || null, saved: s.saved.length }; }
