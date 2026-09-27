// The activity log: everything Dayspring was asked to do and everything it did to files, kept at least 120 days, so it
// (and the owner) can go back and check. One JSON line per event in data/logs/activity/YYYY-MM-DD.jsonl.
//   command     what was said or typed (voice / typed), what understood it (an intent, the AI), and the reply
//   tool        a tool the AI (or the no-AI commands) used, with its arguments (long text as a size and fingerprint), ok/error
//   file.*      read / list / find (path only) · write / create / edit / move / copy / delete / restore (path, size and
//               sha256 before and after, and where the backup is)
//   program     a program opened or closed, a terminal or Claude Code started
//   permissions a change to what Dayspring may do (before → after, in plain words)
//   confirm     a confirmation asked, given, refused or expired
//   blocked     something refused by a fail-safe or a permission, and why
// Rules: append-only, crash-safe (each line is written whole and flushed; an unfinished line from a crash is set aside),
// and chained: each line carries the previous line's hash and its own, so an edited or removed line shows up in verify().
// Secrets never get in: file contents are never logged (only sizes and fingerprints), and anything that looks like a key
// or a password is blanked. The AI can't change or delete these files (filesafety.mjs protects them).
//   log(kind, data) · search({ query, from, to, kind, path, limit }) · get(id) · verify({ from, to }) · prune()
//   settings() / setSettings({ days }) · toCSV(entries) · redact(x) · addBackupDir(dir)
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "./atomic.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
export const DIR = () => process.env.DAYSPRING_ACTIVITY_DIR || join(DATA, "logs", "activity");
const SETTINGS = () => join(DIR(), "..", "activity-settings.json");
export const MIN_DAYS = 120, DEFAULT_DAYS = 180, MAX_DAYS = 3650;
const ZERO = "0".repeat(64);
let clock = () => new Date();
export function _setClock(fn) { clock = fn ?? (() => new Date()); state = null; }   // tests

const localDate = (d = clock()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fileFor = (date) => join(DIR(), `${date}.jsonl`);
const sha = (s) => createHash("sha256").update(s).digest("hex");

// ---- keeping secrets out ----------------------------------------------------------------------------------------------
const KEY_FIELD = /^(.*[-_ ])?(api[-_ ]?key|apikey|secret|token|password|passwd|pwd|pass|auth(orization)?|cookie|session|private[-_ ]?key|credentials?|client[-_ ]?secret|pin)$/i;
// fingerprints and places (a path is needed exactly as it was, to put a file back)
const SAFE_FIELD = new Set(["hash", "prev", "id", "sha256", "sha256Before", "sha256After", "confirmId", "opKey", "path", "to", "from", "backup", "target", "keptAt", "real", "undoOf"]);
const PATTERNS = [
  [/\b(sk|rk|pk)-(ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, "[key hidden]"],
  [/\bxi-[A-Za-z0-9]{16,}/g, "[key hidden]"],
  [/\bxai-[A-Za-z0-9]{16,}/g, "[key hidden]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[key hidden]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[key hidden]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[key hidden]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[key hidden]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[key hidden]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[token hidden]"],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [hidden]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private key hidden]"],
  [/\b(password|passwd|pwd|passcode|api[ _-]?key|secret|token|pin)(\s*(?:is|=|:)\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1$2[hidden]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, (m) => (/^[a-f0-9]{64}$/i.test(m) ? m : "[long code hidden]")],
];
export function redactText(s) {
  let t = String(s);
  for (const [re, to] of PATTERNS) t = t.replace(re, to);
  return t;
}
export function redact(x, key = "", depth = 0) {
  if (x == null || depth > 6) return x;
  if (typeof x === "string") return SAFE_FIELD.has(key) ? x : KEY_FIELD.test(key) ? "[hidden]" : redactText(x).slice(0, 4000);
  if (typeof x === "number" || typeof x === "boolean") return x;
  if (Array.isArray(x)) return x.slice(0, 100).map((v) => redact(v, key, depth + 1));
  if (typeof x === "object") { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = KEY_FIELD.test(k) && !SAFE_FIELD.has(k) && typeof v !== "object" ? "[hidden]" : redact(v, k, depth + 1); return o; }
  return String(x);
}
// A tool's arguments for the log: long text (file contents, replacements, anything typed into a web page) becomes its size
// and fingerprint, never the words themselves.
const BODY_FIELDS = /^(content|replace|find|value|text|body|note|data)$/i;
export function summarizeArgs(input = {}) {
  const o = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (typeof v === "string" && BODY_FIELDS.test(k) && (v.length > 160 || /^(content|replace|find|value)$/i.test(k))) o[k] = { chars: v.length, sha256: sha(v) };
    else o[k] = v;
  }
  return redact(o);
}

// ---- writing ----------------------------------------------------------------------------------------------------------
let state = null;            // { date, file, prev, n }
function lastLineHash(file) {
  try {
    const s = readFileSync(file, "utf8").trimEnd();
    const line = s.slice(s.lastIndexOf("\n") + 1);
    return line ? JSON.parse(line).hash ?? null : null;
  } catch { return null; }
}
function previousFile(date) {
  try { return readdirSync(DIR()).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < date).sort().pop() ?? null; } catch { return null; }
}
// a crash can leave half a line at the end: it's cut off and kept beside the log (never silently lost), and noted
function repair(file) {
  let buf; try { buf = readFileSync(file); } catch { return null; }
  if (!buf.length || buf[buf.length - 1] === 0x0a) return null;
  const cut = buf.lastIndexOf(0x0a) + 1;
  const aside = file.replace(/\.jsonl$/, `.unfinished-${Date.now()}.txt`);
  try { writeFileSync(aside, buf.subarray(cut)); truncateSync(file, cut); } catch { return null; }
  return aside;
}
function open(date) {
  mkdirSync(DIR(), { recursive: true });
  const file = fileFor(date);
  let repaired = null;
  if (existsSync(file)) repaired = repair(file);
  let prev = existsSync(file) ? lastLineHash(file) : null;
  if (!prev) { const pf = previousFile(date); prev = pf ? lastLineHash(join(DIR(), pf)) ?? ZERO : ZERO; }
  state = { date, file, prev, n: 0 };
  if (repaired) write("log.repaired", { note: "An unfinished line (from a crash or power cut) was set aside.", keptAt: repaired });
  if (prunedOn !== date) { prunedOn = date; try { prune(); } catch { /* next time */ } }
}
let seq = 0;
function write(kind, data) {
  const at = clock();
  const entry = { at: at.toISOString(), id: `${at.getTime().toString(36)}-${(seq++).toString(36)}`, kind, ...data, prev: state.prev };
  const hash = sha(JSON.stringify(entry));
  const line = JSON.stringify({ ...entry, hash }) + "\n";
  const fd = openSync(state.file, "a");
  try { writeSync(fd, line); try { fsyncSync(fd); } catch { /* some drives can't */ } } finally { closeSync(fd); }
  state.prev = hash; state.n++;
  return { ...entry, hash };
}
// log(kind, data) → the entry (or null if it couldn't be written; logging never breaks what's being logged)
export function log(kind, data = {}) {
  try {
    const date = localDate();
    if (!state || state.date !== date || state.dir !== DIR()) { open(date); state.dir = DIR(); }
    const { at: _a, id: _i, prev: _p, hash: _h, kind: _k, ...rest } = data ?? {};
    return write(String(kind), redact(rest));
  } catch (e) {
    try { console.warn(`activity log: ${e.message}`); } catch { /* nothing */ }
    return null;
  }
}

// ---- reading ----------------------------------------------------------------------------------------------------------
const dayFiles = () => { try { return readdirSync(DIR()).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); } catch { return []; } };
function readDay(f) {
  let s = ""; try { s = readFileSync(join(DIR(), f), "utf8"); } catch { return []; }
  return s.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const isoDay = (v, fallback) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : fallback);
// search({ query, from, to, kind, path, limit }) → { entries (newest first), total, from, to }
export function search({ query = "", from, to, kind = "", path = "", limit = 50, offset = 0 } = {}) {
  const today = localDate();
  const f = isoDay(from, localDate(new Date(clock().getTime() - 30 * 86400000))), t = isoDay(to, today);
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const kinds = String(kind ?? "").toLowerCase().split(/[,\s]+/).filter(Boolean);
  const p = String(path ?? "").toLowerCase().replace(/\//g, "\\");
  const out = [];
  for (const file of dayFiles().filter((x) => x.slice(0, 10) >= f && x.slice(0, 10) <= t).reverse()) {
    for (const e of readDay(file).reverse()) {
      if (kinds.length && !kinds.some((k) => e.kind === k || e.kind.startsWith(k + "."))) continue;
      if (p && !JSON.stringify([e.path, e.to, e.from, e.target]).toLowerCase().replace(/\\\\/g, "\\").includes(p)) continue;
      if (words.length) { const hay = JSON.stringify(e).toLowerCase(); if (!words.every((w) => hay.includes(w))) continue; }
      out.push(e);
    }
  }
  const lim = Math.max(1, Math.min(Number(limit) || 50, 5000));
  return { from: f, to: t, total: out.length, entries: out.slice(offset, offset + lim) };
}
export function get(id) {
  const s = String(id ?? "");
  const day = (() => { const ms = parseInt(s.split("-")[0], 36); return Number.isFinite(ms) ? localDate(new Date(ms)) : null; })();
  const files = day && existsSync(fileFor(day)) ? [`${day}.jsonl`, ...dayFiles().reverse()] : dayFiles().reverse();
  for (const f of files) for (const e of readDay(f)) if (e.id === s) return e;
  return null;
}

// verify({ from, to }) → { ok, files: [{ date, lines, ok, problem, line }] } — recomputes every hash and checks the chain
export function verify({ from, to } = {}) {
  const res = [];
  let prevFileLast = null;
  for (const f of dayFiles()) {
    const date = f.slice(0, 10);
    const inRange = (!from || date >= from) && (!to || date <= to);
    let s = ""; try { s = readFileSync(join(DIR(), f), "utf8"); } catch { res.push({ date, ok: false, problem: "couldn't be read" }); continue; }
    const lines = s.split("\n");
    if (lines.at(-1) === "") lines.pop();
    let prev = null, ok = true, problem = null, at = null;
    for (let i = 0; i < lines.length; i++) {
      let e; try { e = JSON.parse(lines[i]); } catch { ok = false; problem = "a line isn't readable (changed or damaged)"; at = i + 1; break; }
      const { hash, ...rest } = e;
      if (sha(JSON.stringify(rest)) !== hash) { ok = false; problem = "a line was changed after it was written"; at = i + 1; break; }
      if (i === 0) { if (prevFileLast && e.prev !== prevFileLast && e.prev !== ZERO) { ok = false; problem = "the first line doesn't follow the day before (lines may have been removed)"; at = 1; break; } }
      else if (e.prev !== prev) { ok = false; problem = "the chain is broken (a line was removed or moved)"; at = i + 1; break; }
      prev = hash;
    }
    prevFileLast = ok ? prev : null;
    if (inRange) res.push({ date, lines: lines.length, ok, ...(problem ? { problem, line: at } : {}) });
  }
  return { ok: res.every((r) => r.ok), files: res };
}

// ---- keeping it (at least 120 days) -----------------------------------------------------------------------------------
export function settings() {
  let s = {}; try { s = JSON.parse(readFileSync(SETTINGS(), "utf8")); } catch { /* defaults */ }
  const days = Math.round(Number(s.days));
  return { days: Number.isFinite(days) ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, days)) : DEFAULT_DAYS, min: MIN_DAYS, default: DEFAULT_DAYS };
}
export function setSettings({ days } = {}) {
  const before = settings().days;
  const d = Math.round(Number(days));
  if (!Number.isFinite(d)) throw new Error("How many days should the activity log be kept?");
  const kept = Math.min(MAX_DAYS, Math.max(MIN_DAYS, d));
  mkdirSync(dirname(SETTINGS()), { recursive: true });
  writeJSONAtomic(SETTINGS(), { days: kept }, 2);
  if (kept !== before) log("settings.activity", { daysBefore: before, daysAfter: kept });
  return { ...settings(), clamped: kept !== d };
}
// backup folders pruned on the same schedule (folders named by the time they were made: 2026-09-27T…)
const backupDirs = new Set();
export function addBackupDir(dir) { if (dir) backupDirs.add(dir); }
let prunedOn = null;
export function prune() {
  const days = settings().days;                       // never fewer than 120
  const cutoff = localDate(new Date(clock().getTime() - days * 86400000));
  const removed = [];
  for (const f of dayFiles()) if (f.slice(0, 10) < cutoff) { try { rmSync(join(DIR(), f), { force: true }); removed.push(f); } catch { /* in use */ } }
  try { for (const f of readdirSync(DIR())) if (/^\d{4}-\d{2}-\d{2}\.unfinished-\d+\.txt$/.test(f) && f.slice(0, 10) < cutoff) rmSync(join(DIR(), f), { force: true }); } catch { /* none */ }
  const backups = [];
  for (const dir of backupDirs) {
    let names = []; try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) if (/^\d{4}-\d{2}-\d{2}/.test(n) && n.slice(0, 10) < cutoff) { try { rmSync(join(dir, n), { recursive: true, force: true }); backups.push(join(dir, n)); } catch { /* in use */ } }
  }
  if (removed.length || backups.length) {
    if (state) write("log.pruned", { keptDays: days, removedDays: removed.map((f) => f.slice(0, 10)), removedBackups: backups.length });
  }
  return { keptDays: days, cutoff, removed, removedBackups: backups };
}
// once a day even when nothing is logged
const daily = setInterval(() => { try { if (prunedOn !== localDate()) { prunedOn = localDate(); prune(); } } catch { /* next time */ } }, 6 * 3600_000);
daily.unref?.();

// ---- export -----------------------------------------------------------------------------------------------------------
const csvCell = (v) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCSV(entries) {
  const cols = ["at", "kind", "via", "result", "path", "to", "text", "tool", "sizeBefore", "sizeAfter", "sha256Before", "sha256After", "backup", "reason", "id"];
  const rows = entries.map((e) => {
    const extra = Object.fromEntries(Object.entries(e).filter(([k]) => !cols.includes(k) && !["prev", "hash"].includes(k)));
    return [...cols.map((c) => csvCell(e[c])), csvCell(Object.keys(extra).length ? extra : "")].join(",");
  });
  return [...cols, "details"].join(",") + "\r\n" + rows.join("\r\n") + (rows.length ? "\r\n" : "");
}
// size and fingerprint of a file on disk (for before/after); null when it isn't there or is too big to fingerprint quickly
// (read in pieces, so a big file never has to fit in memory)
export function fingerprint(file, maxBytes = 1024 * 1024 * 1024) {
  try {
    const st = statSync(file);
    if (!st.isFile()) return { size: null, sha256: null, folder: st.isDirectory() || undefined };
    if (st.size > maxBytes) return { size: st.size, sha256: null };
    const h = createHash("sha256"), buf = Buffer.alloc(1 << 20), fd = openSync(file, "r");
    try { let n; while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) h.update(n === buf.length ? buf : buf.subarray(0, n)); } finally { closeSync(fd); }
    return { size: st.size, sha256: h.digest("hex") };
  } catch { return null; }
}
export const _sha = sha;
