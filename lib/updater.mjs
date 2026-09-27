// Updates from GitHub releases. The repo is package.json "dayspring.updateRepo" ("owner/name"); empty = updates off.
// The release's download is always named Dayspring.zip (any .zip works).
//
//   check()        the latest release vs this version (on start, then every 6 hours)
//   stage()        download → verify → unpack into updates/<version>, ready to install
//   install()      back up data/ and .env → swap the program files (a quick rename, so it can be undone) → npm install
//                  only if the parts changed → restart → the new version confirms it started; if it doesn't within a
//                  minute, the launcher puts the old version back (rollback())
//   when           "ask" (a notice with What's new and three choices), "launch" (the next time Dayspring starts) or
//                  "idle" (when nobody has used Dayspring for a while, never during an alarm, a call or Tune in)
//
// Never touched by an update: data/, .env, bin/ (downloaded helpers), node_modules (unless the parts changed),
// backups/, updates/, logs/. data/updates.json holds the plan and the update history the owner can read in Settings.
// DAYSPRING_UPDATE_API overrides the GitHub API base (tests); DAYSPRING_UPDATE_REPO overrides the repo.
import { execFile } from "node:child_process";
// a program run in the background (never blocks Dayspring): { status, out }
const runAsync = (file, args, opts = {}) => new Promise((resolve) => execFile(file, args, { windowsHide: true, encoding: "utf8", maxBuffer: 16 << 20, ...opts }, (e, out, err) => resolve({ status: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: `${out ?? ""}${err ?? ""}` })));
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "./atomic.mjs";

export const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
export const KEEP = new Set(["data", ".env", "node_modules", "backups", ".git", "dist-out", "bin", "updates", "logs"]);   // never replaced or removed
const DATA = join(DESK, "data"), BACKUPS = join(DESK, "backups"), UPDATES = join(DESK, "updates");
const STATE = join(DATA, "updates.json");
const KEEP_BACKUPS = 5;
const api = () => (process.env.DAYSPRING_UPDATE_API || "https://api.github.com").replace(/\/$/, "");
const pkg = () => JSON.parse(readFileSync(join(DESK, "package.json"), "utf8"));
export const version = () => pkg().version ?? "0.0.0";
// The source copy that releases are made from (it has dist/ with the installer) never updates itself from a release:
// that would replace the source with the generic copy. Tests set DAYSPRING_UPDATE_REPO to try it anyway.
export const isSource = () => existsSync(join(DESK, "dist", "Install Dayspring.cmd")) && existsSync(join(DESK, "scripts", "export.mjs"));
export const repo = () => String(process.env.DAYSPRING_UPDATE_REPO || (isSource() ? "" : pkg().dayspring?.updateRepo) || "").trim();
// where releases are published (the source copy still looks, so it can say what the newest release is)
export const releaseRepo = () => String(process.env.DAYSPRING_UPDATE_REPO || pkg().dayspring?.updateRepo || "").trim();
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
// Windows' own tar (Windows 10 1803+ and 11), never another tar on the PATH (Git's can't read zips); PowerShell's
// Expand-Archive when it's missing
const TAR = () => { const t = join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe"); return existsSync(t) ? t : null; };
async function unzip(zip, dest, opts) {
  const tar = TAR();
  if (tar) return runAsync(tar, ["-xf", zip, "-C", dest], opts);
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  return runAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dest)} -Force`], opts);
}

// ---- saved plan + history (data/updates.json) ---------------------------------------------------------------------------
function load() { try { return { when: "ask", history: [], ...JSON.parse(readFileSync(STATE, "utf8")) }; } catch { return { when: "ask", history: [] }; } }
function save(s) { mkdirSync(DATA, { recursive: true }); writeJSONAtomic(STATE, s, 2); return s; }
const patchState = (p) => save({ ...load(), ...p });
const WHEN = ["ask", "launch", "idle"];
export const when = () => (WHEN.includes(load().when) ? load().when : "ask");
export function setWhen(w) { if (!WHEN.includes(w)) throw new Error("choose ask, launch or idle"); patchState({ when: w }); return w; }
export const history = () => (load().history ?? []).slice(-30).reverse();
function addHistory(entry) { const s = load(); s.history = [...(s.history ?? []), { at: new Date().toISOString(), ...entry }].slice(-50); save(s); }
function updateLastHistory(patch) { const s = load(); const h = s.history ?? []; if (h.length) Object.assign(h[h.length - 1], patch); save(s); }

let state = { phase: "idle", message: "", at: null, latest: null, error: null };
const set = (patch) => { state = { ...state, ...patch, at: new Date().toISOString() }; onChange?.(status()); return state; };
let onChange = null;
export function onStatus(fn) { onChange = fn; }
export const status = () => {
  const s = load(), L = state.latest ?? s.latest ?? null;
  // what the last check found, re-measured against the version running now (it may have been installed since)
  const latest = L ? { ...L, current: version(), available: cmp(L.latest, version()) > 0 } : null;
  return { ...state, latest, version: version(), repo: repo() || null, releaseRepo: releaseRepo() || null, source: isSource(), when: when(), staged: s.staged ?? null, plan: s.plan ?? null, lastCheck: s.lastCheck ?? null, pendingVerify: s.pendingVerify ?? null };
};

// "v1.2.10" → [1,2,10]; pre-release tags ("1.3.0-beta.1") sort before the release
export function cmp(a, b) {
  const parse = (v) => { const [core, pre] = String(v).trim().replace(/^v/i, "").split("-", 2); return { n: core.split(".").map((x) => Number.parseInt(x, 10) || 0), pre: pre ?? null }; };
  const A = parse(a), B = parse(b);
  for (let i = 0; i < Math.max(A.n.length, B.n.length, 3); i++) { const d = (A.n[i] ?? 0) - (B.n[i] ?? 0); if (d) return Math.sign(d); }
  if (A.pre === B.pre) return 0;
  if (A.pre === null) return 1;
  if (B.pre === null) return -1;
  return A.pre < B.pre ? -1 : 1;
}

async function gh(path, rp = repo()) {
  let r;
  try { r = await fetch(`${api()}${path}`, { headers: { accept: "application/vnd.github+json", "user-agent": "Dayspring-updater", "x-github-api-version": "2022-11-28" }, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new Error(/abort|timeout/i.test(e.message) ? "GitHub didn't answer in time. Check the internet connection, then Retry." : "I couldn't reach GitHub to check for updates. Check the internet connection, then Retry."); }
  if (r.status === 404) throw new Error(`I couldn't find any Dayspring releases at ${rp}. Check the update address.`);
  if (r.status === 403 || r.status === 429) {
    const reset = Number(r.headers.get("x-ratelimit-reset")) * 1000;
    const mins = reset ? Math.max(1, Math.round((reset - Date.now()) / 60000)) : 60;
    throw new Error(`GitHub is limiting update checks from this network for now. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
  if (!r.ok) throw new Error(`GitHub answered ${r.status}. Try again in a little while.`);
  return r.json();
}

// { available, current, latest, name, notes, url, zip, digest, size } — or { off: true, message } when no repo is set
export async function check() {
  const rp = repo();
  // the source copy: it can't install a release (that would replace the source), but it still says what's newest
  if (!rp && isSource() && releaseRepo()) {
    const rr = releaseRepo();
    set({ phase: "checking", message: "Checking for updates…", error: null });
    try {
      const rel = await gh(`/repos/${rr}/releases/latest`, rr);
      const latest = String(rel.tag_name ?? "").replace(/^v/i, "");
      const newer = cmp(latest, version()) > 0;
      const out = { available: false, source: true, installable: false, current: version(), latest, name: rel.name || `Dayspring ${latest}`, notes: String(rel.body ?? "").slice(0, 8000), url: rel.html_url ?? null, published: rel.published_at ?? null,
        message: `This is the development copy of Dayspring (the one releases are made from), so it's updated by changing the source, not from a release. The newest release is ${latest}; this copy is ${version()}${newer ? " (older than the release)" : ""}.` };
      patchState({ lastCheck: new Date().toISOString() });
      set({ phase: "idle", message: out.message });
      return out;
    } catch (e) { set({ phase: "error", error: e.message, message: e.message }); throw e; }
  }
  if (!rp) { set({ phase: "idle", message: isSource() ? "This is the source copy of Dayspring (the one releases are made from), so it doesn't update itself from a release." : "Automatic updates aren't set up for this copy of Dayspring.", error: null }); return { off: true, current: version(), message: state.message }; }
  if (!/^[\w.-]+\/[\w.-]+$/.test(rp)) throw new Error(`"${rp}" doesn't look like an update address. It should look like name/dayspring.`);
  set({ phase: "checking", message: "Checking for updates…", error: null });
  try {
    const rel = await gh(`/repos/${rp}/releases/latest`, rp);
    const latest = String(rel.tag_name ?? "").replace(/^v/i, "");
    const assets = (rel.assets ?? []).filter((a) => /\.zip$/i.test(a.name ?? ""));
    const asset = assets.find((a) => /^dayspring\.zip$/i.test(a.name)) ?? assets[0];
    const out = { available: cmp(latest, version()) > 0, current: version(), latest, name: rel.name || `Dayspring ${latest}`, notes: String(rel.body ?? "").slice(0, 8000), url: rel.html_url ?? null, zip: asset?.browser_download_url ?? null, digest: asset?.digest ?? null, size: asset?.size ?? null, published: rel.published_at ?? null };
    patchState({ lastCheck: new Date().toISOString(), latest: out });
    set({ phase: "idle", latest: out, message: out.available ? `Dayspring ${latest} is available (you have ${version()}).` : `You're up to date (${version()}).` });
    return out;
  } catch (e) { set({ phase: "error", error: e.message, message: e.message }); throw e; }
}

// the folder inside an extracted zip that holds server.mjs (GitHub zipballs wrap everything in "owner-repo-sha/")
function findRoot(dir, depth = 0) {
  if (existsSync(join(dir, "server.mjs")) && existsSync(join(dir, "package.json"))) return dir;
  if (depth > 2) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) { const r = findRoot(join(dir, e.name), depth + 1); if (r) return r; }
  return null;
}
const depsOf = (p) => { try { const j = JSON.parse(readFileSync(p, "utf8")); return JSON.stringify({ d: j.dependencies ?? {}, o: j.optionalDependencies ?? {} }); } catch { return ""; } };

// Download and unpack the latest release into updates/<version>. Nothing in the running program changes.
export async function stage(info) {
  info ??= await check();
  if (info.off) throw new Error(info.message);
  if (!info.available) return null;
  const have = load().staged;
  if (have?.version === info.latest && existsSync(join(have.dir, "server.mjs"))) return have;
  if (!info.zip) throw new Error("That release has no download attached.");
  set({ phase: "downloading", message: `Downloading Dayspring ${info.latest}…`, error: null });
  const dir = join(UPDATES, info.latest);
  try {
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const r = await fetch(info.zip, { headers: { "user-agent": "Dayspring-updater", accept: "application/octet-stream" }, redirect: "follow", signal: AbortSignal.timeout(300_000) });
    if (!r.ok) throw new Error(`The download failed (${r.status}).`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (info.size && buf.length !== info.size) throw new Error("The download was incomplete. I'll try again later.");
    const m = /^sha256:([a-f0-9]{64})$/i.exec(info.digest ?? "");
    if (m && createHash("sha256").update(buf).digest("hex") !== m[1].toLowerCase()) throw new Error("The download didn't match GitHub's checksum, so I didn't use it.");
    const zip = join(dir, "Dayspring.zip");
    writeFileSync(zip, buf);
    const x = join(dir, "x"); mkdirSync(x);
    const t = await unzip(zip, x, { timeout: 300_000 });
    if (t.status !== 0) throw new Error("The download couldn't be unpacked: " + t.out.trim().slice(0, 200));
    const root = findRoot(x);
    if (!root) throw new Error("That download doesn't look like Dayspring (no server.mjs and package.json in it).");
    const p = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (!/dayspring/i.test(`${p.name ?? ""} ${JSON.stringify(p.dayspring ?? {})}`)) throw new Error("That download isn't Dayspring.");
    if (cmp(p.version, version()) <= 0) throw new Error(`That download is version ${p.version}, which isn't newer than yours.`);
    for (const k of KEEP) rmSync(join(root, k), { recursive: true, force: true });   // a release never brings data, keys or modules
    rmSync(zip, { force: true });
    const staged = { version: p.version, name: info.name, notes: info.notes, url: info.url, dir: root, at: new Date().toISOString() };
    patchState({ staged });
    set({ phase: "idle", message: `Dayspring ${p.version} is downloaded and ready to install.` });
    return staged;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    set({ phase: "error", error: e.message, message: e.message });
    throw e;
  }
}

// ---- backups ----------------------------------------------------------------------------------------------------------
function prune(prefix) {
  if (!existsSync(BACKUPS)) return;
  const all = readdirSync(BACKUPS).filter((d) => d.startsWith(prefix)).map((d) => ({ d, t: statSync(join(BACKUPS, d)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { d } of all.slice(KEEP_BACKUPS)) rmSync(join(BACKUPS, d), { recursive: true, force: true });
}
// data/ (without logs) and .env, copied before anything changes
export function backupData(tag = version()) {
  const dir = join(BACKUPS, `data-${tag}-${stamp()}`);
  mkdirSync(dir, { recursive: true });
  if (existsSync(DATA)) cpSync(DATA, join(dir, "data"), { recursive: true, filter: (src) => !/[\\/]data[\\/]logs([\\/]|$)/.test(src) });
  if (existsSync(join(DESK, ".env"))) cpSync(join(DESK, ".env"), join(dir, ".env"));
  prune("data-");
  return dir;
}
const programEntries = (dir) => readdirSync(dir).filter((e) => !KEEP.has(e));
function moveAll(from, to, names) { mkdirSync(to, { recursive: true }); const moved = []; for (const e of names) { renameSync(join(from, e), join(to, e)); moved.push(e); } return moved; }

// Put the program files from a code backup back (after a failed update). The files that didn't work go to backups/failed-*.
export function rollback(codeBackup, { reason = "" } = {}) {
  if (!codeBackup || !existsSync(codeBackup)) throw new Error("There's no backup to go back to.");
  const failed = join(BACKUPS, `failed-${version()}-${stamp()}`);
  moveAll(DESK, failed, programEntries(DESK));
  moveAll(codeBackup, DESK, readdirSync(codeBackup));
  rmSync(codeBackup, { recursive: true, force: true });
  const s = load(); delete s.pendingVerify; save(s);
  updateLastHistory({ ok: false, error: reason || "The new version didn't start, so the previous one was put back." });
  return { restored: version() };
}

// ---- installing --------------------------------------------------------------------------------------------------------
let busyInstall = false;
// restart: how to start the new version afterwards (the server passes its own; the launcher passes none, it starts the
// server itself). how: "now" | "launch" | "idle" (for the history).
export async function install({ restart = null, how = "now" } = {}) {
  if (busyInstall) throw new Error("An update is already being installed.");
  busyInstall = true;
  try {
    let staged = load().staged;
    if (!staged || !existsSync(join(staged.dir ?? "", "server.mjs"))) staged = await stage();
    if (!staged) return { updated: false, message: state.message || `You're up to date (${version()}).` };
    const from = version(), to = staged.version;
    set({ phase: "applying", message: "Backing up your data…", error: null });
    const dataBackup = backupData(from);

    set({ message: `Installing Dayspring ${to}…` });
    const codeBackup = join(BACKUPS, `code-${from}-${stamp()}`);
    const depsBefore = depsOf(join(DESK, "package.json"));
    let movedOld = [], movedNew = [];
    try {
      movedOld = moveAll(DESK, codeBackup, programEntries(DESK));
      movedNew = moveAll(staged.dir, DESK, programEntries(staged.dir));
    } catch (e) {
      // undo whatever moved, in reverse
      for (const n of movedNew) try { renameSync(join(DESK, n), join(staged.dir, n)); } catch { /* keep going */ }
      for (const n of movedOld) try { renameSync(join(codeBackup, n), join(DESK, n)); } catch { /* keep going */ }
      throw new Error(`The update couldn't replace Dayspring's files (${e.code ?? e.message}). Nothing was changed; try again after restarting the computer.`);
    }
    if (depsOf(join(DESK, "package.json")) !== depsBefore || !existsSync(join(DESK, "node_modules"))) {
      set({ message: "Installing new parts…" });
      const n = await runAsync("cmd.exe", ["/d", "/s", "/c", "npm install --omit=dev --no-audit --no-fund"], { cwd: DESK, timeout: 600_000 });
      if (n.status !== 0) {
        rollback(codeBackup, { reason: "New parts couldn't be downloaded." });
        await runAsync("cmd.exe", ["/d", "/s", "/c", "npm install --omit=dev --no-audit --no-fund"], { cwd: DESK, timeout: 600_000 });
        throw new Error(`Dayspring ${to} needs new parts, and they couldn't be downloaded. Your version was kept. Check the internet connection and try again.`);
      }
    }
    rmSync(join(UPDATES), { recursive: true, force: true });
    const s = load(); delete s.staged; delete s.plan; s.pendingVerify = { from, to, backup: codeBackup, dataBackup, at: new Date().toISOString() }; save(s);
    addHistory({ from, to, ok: null, how, name: staged.name, notes: staged.notes, dataBackup });
    prune("code-"); prune("failed-");
    set({ phase: "restarting", message: `Updated to ${to}. Restarting…`, latest: null });
    if (restart) setTimeout(() => restart({ verify: true }), 1500);
    return { updated: true, from, to, backup: codeBackup, dataBackup, message: state.message };
  } catch (e) {
    set({ phase: "error", error: e.message, message: e.message });
    throw e;
  } finally { busyInstall = false; }
}

// Kept for older callers (scripts/update.mjs, the v1.0.0 route name): check, download and install now.
export async function apply({ restart } = {}) { return install({ restart: restart ? () => restart({ verify: true }) : null, how: "now" }); }

// Called by the server once it's listening: the version it's running is the one just installed, so the update worked.
export function confirmStarted() {
  const s = load(); const pv = s.pendingVerify;
  if (!pv || pv.to !== version()) return null;
  delete s.pendingVerify; save(s);
  updateLastHistory({ ok: true, confirmedAt: new Date().toISOString() });
  return pv;
}

// An install from v1.0.0's updater removed bin/ (downloaded helpers such as speech recognition) with the old files.
// Put it back from the newest backup that has it.
export function restoreHelpers() {
  if (existsSync(join(DESK, "bin")) || !existsSync(BACKUPS)) return false;
  const withBin = readdirSync(BACKUPS).filter((d) => d.startsWith("code-") && existsSync(join(BACKUPS, d, "bin"))).map((d) => ({ d, t: statSync(join(BACKUPS, d)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  if (!withBin) return false;
  cpSync(join(BACKUPS, withBin.d, "bin"), join(DESK, "bin"), { recursive: true });
  return true;
}

// ---- the owner's choice on the notice ------------------------------------------------------------------------------------
// "now" → install and restart · "launch" → download now, install the next time Dayspring starts · "idle" → download now,
// install when Dayspring isn't being used · "later" → don't bring this version up again (Settings → Updates still has it)
export async function choose(choice, { restart } = {}) {
  const known = status().latest;
  const info = known?.available ? known : await check();
  if (info.off) throw new Error(info.message);
  if (!info.available) return { ok: true, message: `You're up to date (${version()}).` };
  if (choice === "later") { patchState({ plan: { version: info.latest, when: "later" } }); return { ok: true, message: "Okay. It's in Settings → Updates whenever you want it." }; }
  if (choice === "now") return install({ restart, how: "now" });
  if (!["launch", "idle"].includes(choice)) throw new Error("choose now, launch, idle or later");
  const staged = await stage(info);
  patchState({ plan: { version: staged?.version ?? info.latest, when: choice } });
  return { ok: true, staged: Boolean(staged), message: choice === "launch" ? `Dayspring ${info.latest} is downloaded. It will install the next time Dayspring starts.` : `Dayspring ${info.latest} is downloaded. It will install when you're not using Dayspring.` };
}
// The launcher asks this before starting the server: install a downloaded update now?
export const installAtLaunch = () => { const s = load(); return Boolean(s.staged && existsSync(join(s.staged.dir ?? "", "server.mjs")) && (["launch", "idle"].includes(s.plan?.when) || ["launch", "idle"].includes(when()))); };

// ---- the automatic check (on start, then every 6 hours) and idle installs ---------------------------------------------------
let lastActivity = Date.now();
export const touch = () => { lastActivity = Date.now(); };
export const idleMinutes = () => (Date.now() - lastActivity) / 60_000;
let timers = [];
// announce(text, info): says it once per version · notify(info): shows the notice card · busy(): true during an alarm,
// a call or Tune in, or right before the morning alarm · restart: the server's restart
// (tests shorten the waits: DAYSPRING_UPDATE_FIRST_MS, DAYSPRING_UPDATE_IDLE_MIN, DAYSPRING_UPDATE_IDLE_TICK_MS)
export function startAuto({ announce, notify, busy = () => false, restart, idleAfter = Number(process.env.DAYSPRING_UPDATE_IDLE_MIN ?? 30) } = {}) {
  if (timers.length || !repo()) return;
  const run = async () => {
    try {
      const info = await check();
      if (!info.available) return;
      const s = load(), mode = s.plan?.version === info.latest ? s.plan.when : when();
      if (mode === "later") return;
      if (mode === "launch" || mode === "idle") { await stage(info).catch(() => {}); if (mode === "launch") return; }
      if (mode === "ask" && s.told !== info.latest) {
        patchState({ told: info.latest });
        notify?.({ ...info, when: mode });
        announce?.(`There's a new version of Dayspring: ${info.latest}. You can see what's new on the screen, and choose when to install it.`, info);
      } else if (mode === "ask") notify?.({ ...info, when: mode, quiet: true });
    } catch { /* quiet: offline or rate-limited; try again later */ }
  };
  const idleTry = async () => {
    const s = load(), mode = s.plan?.when ?? when();
    if (mode !== "idle" || !s.staged || busyInstall) return;
    if (idleMinutes() < idleAfter || busy()) return;
    await install({ restart, how: "idle" }).catch(() => {});
  };
  timers.push(setTimeout(run, Number(process.env.DAYSPRING_UPDATE_FIRST_MS ?? 60_000)), setInterval(run, 6 * 3600_000), setInterval(idleTry, Number(process.env.DAYSPRING_UPDATE_IDLE_TICK_MS ?? 5 * 60_000)));
  for (const t of timers) t.unref?.();
}
export const startDailyCheck = (announce) => startAuto({ announce });   // the older name

// newest code backups (for Settings → Updates → "go back")
export function backups() {
  if (!existsSync(BACKUPS)) return [];
  return readdirSync(BACKUPS).filter((d) => d.startsWith("code-") || d.startsWith("data-")).map((d) => ({ name: d, kind: d.startsWith("code-") ? "program" : "data", at: statSync(join(BACKUPS, d)).mtime.toISOString() })).sort((a, b) => b.at.localeCompare(a.at));
}
