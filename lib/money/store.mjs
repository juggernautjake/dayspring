// Money review: what is kept on this computer, and how.
//
//   data/finance/raw/<when>-<source>.bin       the transactions read or imported, ENCRYPTED with Windows DPAPI
//                                              (this Windows user only; a copied file is unreadable elsewhere).
//                                              Deleted after `retentionDays` (a setting, 90 by default).
//   data/finance/reports/<when>-money-review.md / .csv   the reports, kept until the owner deletes them
//   data/finance/reports/<when>-money-review.json.bin    the same report for the Money page (encrypted)
//   data/finance/import/                       drop a CSV or OFX/QFX file here (or use the Money page) to import it
//   data/finance/settings.json                 settings and the one-time AI consent (no financial data)
//   data/finance/activity.log                  what Dayspring did ("clicked Next on venmo.com"), never amounts
//
// DAYSPRING_FINANCE_DIR moves all of it (tests). Nothing here is ever exported: data/ is left out of exports.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dpapi } from "../../vendor/ecosystem-core/lib/credentials.mjs";
import { writeJSONAtomic, writeTextAtomic } from "../atomic.mjs";
import { fingerprint, dedupe } from "./normalize.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dir = () => process.env.DAYSPRING_FINANCE_DIR || join(DESK, "data", "finance");
export const rawDir = () => join(dir(), "raw");
export const reportsDir = () => join(dir(), "reports");
export const importDir = () => join(dir(), "import");
const settingsFile = () => join(dir(), "settings.json");
const MAGIC = Buffer.from("DSF1");

let box = null;
const crypto = () => (box ??= dpapi({ entropy: "dayspring-finance-v1" }));
export function _setCrypto(b) { box = b; }          // tests only

export function encrypt(obj) { return Buffer.concat([MAGIC, crypto().protect(Buffer.from(JSON.stringify(obj), "utf8"))]); }
export function decrypt(buf) {
  if (buf.length < 5 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error("not a Dayspring money file");
  return JSON.parse(crypto().unprotect(buf.subarray(4)).toString("utf8"));
}
function writeEncrypted(file, obj) { mkdirSync(dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, encrypt(obj), { mode: 0o600 }); renameSync(tmp, file); }

// ---- settings and consent ---------------------------------------------------------------------------------------------
export const DEFAULTS = { idleMinutes: 15, retentionDays: 90, aiConsent: false, aiConsentAt: null, aiConsentAsked: false, visionConsent: false, bankUrl: "", months: 3 };
export function settings() {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(settingsFile(), "utf8")) }; } catch { return { ...DEFAULTS }; }
}
export function setSettings(patch = {}) {
  const cur = settings(), next = { ...cur };
  if (patch.idleMinutes !== undefined) next.idleMinutes = Math.max(1, Math.min(240, Math.round(Number(patch.idleMinutes) || DEFAULTS.idleMinutes)));
  if (patch.retentionDays !== undefined) next.retentionDays = Math.max(1, Math.min(3650, Math.round(Number(patch.retentionDays) || DEFAULTS.retentionDays)));
  if (patch.months !== undefined) next.months = Math.max(1, Math.min(24, Math.round(Number(patch.months) || 3)));
  if (patch.bankUrl !== undefined) { const u = String(patch.bankUrl || "").trim(); next.bankUrl = !u ? "" : /^https:\/\//i.test(u) || (process.env.DAYSPRING_FINANCE_ALLOW_LOCAL === "1" && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(u)) ? u.slice(0, 300) : /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(u) ? `https://${u}`.slice(0, 300) : cur.bankUrl; }
  // consent is only ever changed by the owner (the Money page, or their own "yes" to the question): see money/index.mjs
  if (patch.aiConsent !== undefined) { next.aiConsent = Boolean(patch.aiConsent); next.aiConsentAt = next.aiConsent ? new Date().toISOString() : null; }
  if (patch.visionConsent !== undefined) next.visionConsent = Boolean(patch.visionConsent);
  if (patch.aiConsentAsked !== undefined) next.aiConsentAsked = Boolean(patch.aiConsentAsked);
  mkdirSync(dir(), { recursive: true });
  writeJSONAtomic(settingsFile(), next);
  return next;
}

// ---- the action log (no amounts, merchants or account numbers: only what was done and where) --------------------------
export function logLine(text) {
  try { mkdirSync(dir(), { recursive: true }); writeFileSync(join(dir(), "activity.log"), `${new Date().toISOString()} ${String(text).replace(/\s+/g, " ").slice(0, 200)}\n`, { flag: "a" }); } catch { /* the log is a nice-to-have */ }
}
export function logTail(n = 50) { try { return readFileSync(join(dir(), "activity.log"), "utf8").trim().split("\n").slice(-n); } catch { return []; } }

// ---- raw transactions (encrypted) ---------------------------------------------------------------------------------------
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const safe = (s) => String(s ?? "data").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").slice(0, 40);
// { source, host, from, to, transactions, balances, via: "browser"|"import" }
export function saveRaw(set) {
  prune();
  const file = join(rawDir(), `${stamp()}-${safe(set.source)}.bin`);
  writeEncrypted(file, { v: 1, collectedAt: new Date().toISOString(), ...set });
  return file;
}
export function rawFiles() { try { return readdirSync(rawDir()).filter((f) => f.endsWith(".bin")).sort().map((f) => join(rawDir(), f)); } catch { return []; } }
export function loadSets() {
  prune();
  const out = [];
  for (const f of rawFiles()) { try { out.push({ file: f, ...decrypt(readFileSync(f)) }); } catch { /* another user's or a damaged file: skipped */ } }
  return out;
}
// every transaction kept, merged: a row read in two sessions counts once (the most times it appeared in any one session)
export function allTransactions({ from = null, to = null, source = null } = {}) {
  const sets = loadSets().filter((s) => !source || s.source === source);
  const best = new Map();
  for (const s of sets) {
    const counts = new Map();
    for (const t of s.transactions ?? []) { const k = fingerprint(t); const c = counts.get(k) ?? counts.set(k, []).get(k); c.push(t); }
    for (const [k, list] of counts) { const cur = best.get(k); if (!cur || list.length > cur.length || (list.length === cur.length && s.collectedAt > cur.at)) best.set(k, Object.assign(list, { at: s.collectedAt })); }
  }
  const all = [...best.values()].flat().filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
  return dedupe(all.map(({ id, ...t }) => t));
}
export function latestBalances() {
  const sets = loadSets().filter((s) => s.balances?.length).sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : -1));
  const seen = new Set(), out = [];
  for (const s of sets) if (!seen.has(s.source)) { seen.add(s.source); out.push({ source: s.source, at: s.collectedAt, balances: s.balances }); }
  return out;
}
// retention: raw data older than retentionDays is deleted (reports stay until the owner deletes them)
export function prune(now = Date.now()) {
  const days = settings().retentionDays, cutoff = now - days * 86_400_000;
  let n = 0;
  for (const f of rawFiles()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(f.split(/[\\/]/).pop());
    const at = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : statSync(f).mtimeMs;
    if (at < cutoff) { rmSync(f, { force: true }); n++; }
  }
  if (n) logLine(`retention: deleted ${n} raw file(s) older than ${days} days`);
  return n;
}

// ---- reports ------------------------------------------------------------------------------------------------------
export function saveReport(report, { markdown, csv }) {
  const base = `${stamp()}-money-review`;
  mkdirSync(reportsDir(), { recursive: true });
  writeTextAtomic(join(reportsDir(), `${base}.md`), markdown);
  writeTextAtomic(join(reportsDir(), `${base}.csv`), csv);
  writeEncrypted(join(reportsDir(), `${base}.json.bin`), report);
  return { id: base, markdown: join(reportsDir(), `${base}.md`), csv: join(reportsDir(), `${base}.csv`) };
}
export function reports() {
  try { return readdirSync(reportsDir()).filter((f) => f.endsWith(".json.bin")).sort().reverse().map((f) => ({ id: f.replace(/\.json\.bin$/, ""), md: f.replace(/\.json\.bin$/, ".md"), csv: f.replace(/\.json\.bin$/, ".csv") })); } catch { return []; }
}
export function loadReport(id = null) {
  const list = reports(); const pick = id ? list.find((r) => r.id === id) : list[0];
  if (!pick || !/^[\w-]+$/.test(pick.id)) return null;
  try { return { id: pick.id, ...decrypt(readFileSync(join(reportsDir(), `${pick.id}.json.bin`))) }; } catch { return null; }
}
export function deleteReport(id) {
  if (!/^[\w-]+$/.test(String(id))) return false;
  for (const ext of [".md", ".csv", ".json.bin"]) rmSync(join(reportsDir(), id + ext), { force: true });
  return true;
}

// ---- delete everything ----------------------------------------------------------------------------------------------
export function deleteAll() {
  const had = { raw: rawFiles().length, reports: reports().length };
  for (const d of [rawDir(), reportsDir(), importDir()]) rmSync(d, { recursive: true, force: true });
  rmSync(join(dir(), "activity.log"), { force: true });
  // settings stay (consent is withdrawn): the owner doesn't have to set the bank address again
  if (existsSync(settingsFile())) setSettings({ aiConsent: false, visionConsent: false });
  return had;
}
