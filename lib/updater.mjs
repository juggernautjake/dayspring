// Updates from GitHub releases. The repo is package.json "dayspring.updateRepo" ("owner/name"); empty = updates off.
// check(): latest release vs this version. apply(): download → verify → back up this code → replace the code → npm install
// if the dependencies changed → restart. data/, .env, node_modules and backups/ are never touched. A daily check announces
// "An update is available"; nothing is ever installed without the owner asking.
// DAYSPRING_UPDATE_API overrides the GitHub API base (tests).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = new Set(["data", ".env", "node_modules", "backups", ".git", "dist-out"]);   // never replaced or removed
const api = () => (process.env.DAYSPRING_UPDATE_API || "https://api.github.com").replace(/\/$/, "");
const pkg = () => JSON.parse(readFileSync(join(DESK, "package.json"), "utf8"));
export const version = () => pkg().version ?? "0.0.0";
export const repo = () => String(process.env.DAYSPRING_UPDATE_REPO || pkg().dayspring?.updateRepo || "").trim();

let state = { phase: "idle", message: "", at: null, latest: null, error: null };
const set = (patch) => { state = { ...state, ...patch, at: new Date().toISOString() }; return state; };
export const status = () => ({ ...state, version: version(), repo: repo() || null });

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

async function gh(path) {
  const r = await fetch(`${api()}${path}`, { headers: { accept: "application/vnd.github+json", "user-agent": "Dayspring-updater" }, signal: AbortSignal.timeout(15000) });
  if (r.status === 404) throw new Error(`I couldn't find any Dayspring updates at ${repo()}. Check the update address in Settings → Updates.`);
  if (r.status === 403) throw new Error("GitHub is limiting requests right now. Try again in an hour.");
  if (!r.ok) throw new Error(`GitHub answered ${r.status}.`);
  return r.json();
}

// { available, current, latest, notes, url, zip } — or { off: true, message } when no repo is set
export async function check() {
  const rp = repo();
  if (!rp) { set({ phase: "idle", message: "Automatic updates aren't set up for this copy of Dayspring yet. Ask the person who shared Dayspring with you for its update address (it looks like name/dayspring), then add it in Settings → Updates.", error: null }); return { off: true, current: version(), message: state.message }; }
  if (!/^[\w.-]+\/[\w.-]+$/.test(rp)) throw new Error(`"${rp}" doesn't look like an update address. It should look like name/dayspring.`);
  set({ phase: "checking", message: "Checking for updates…", error: null });
  try {
    const rel = await gh(`/repos/${rp}/releases/latest`);
    const latest = String(rel.tag_name ?? "").replace(/^v/i, "");
    const asset = (rel.assets ?? []).find((a) => /\.zip$/i.test(a.name ?? ""));
    const out = { available: cmp(latest, version()) > 0, current: version(), latest, name: rel.name ?? latest, notes: String(rel.body ?? "").slice(0, 4000), url: rel.html_url ?? null, zip: asset?.browser_download_url ?? rel.zipball_url ?? null, published: rel.published_at ?? null };
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

// Downloads and installs the latest release. restart: a function that restarts the server (the server passes its own).
export async function apply({ restart } = {}) {
  if (state.phase === "applying") throw new Error("An update is already being installed.");
  const info = await check();
  if (info.off) throw new Error(info.message);
  if (!info.available) return { updated: false, message: state.message };
  if (!info.zip) throw new Error("That release has no download attached.");
  const work = mkdtempSync(join(tmpdir(), "dayspring-update-"));
  try {
    set({ phase: "applying", message: `Downloading Dayspring ${info.latest}…`, error: null });
    const r = await fetch(info.zip, { headers: { "user-agent": "Dayspring-updater", accept: "application/octet-stream" }, redirect: "follow", signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`The download failed (${r.status}).`);
    const zip = join(work, "release.zip");
    writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    const ex = join(work, "x"); mkdirSync(ex);
    const t = spawnSync("tar", ["-xf", zip, "-C", ex], { windowsHide: true, encoding: "utf8" });
    if (t.status !== 0) throw new Error("The download couldn't be unpacked: " + (t.stderr || "").trim().slice(0, 200));
    const root = findRoot(ex);
    if (!root) throw new Error("That download doesn't look like Dayspring (no server.mjs and package.json in it). Nothing was changed.");
    const newVer = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
    for (const k of KEEP) rmSync(join(root, k), { recursive: true, force: true });   // a release never brings data, keys or modules

    // back up the code we have now
    set({ message: "Backing up your current version…" });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backup = join(DESK, "backups", `code-${version()}-${stamp}`);
    mkdirSync(backup, { recursive: true });
    for (const e of readdirSync(DESK)) if (!KEEP.has(e)) cpSync(join(DESK, e), join(backup, e), { recursive: true });

    // replace: remove old code entries the release no longer has, then copy the release over
    set({ message: `Installing Dayspring ${newVer}…` });
    const depsBefore = depsOf(join(DESK, "package.json"));
    const incoming = new Set(readdirSync(root));
    for (const e of readdirSync(DESK)) if (!KEEP.has(e) && !incoming.has(e)) rmSync(join(DESK, e), { recursive: true, force: true });
    for (const e of incoming) { if (KEEP.has(e)) continue; rmSync(join(DESK, e), { recursive: true, force: true }); cpSync(join(root, e), join(DESK, e), { recursive: true }); }

    if (depsOf(join(DESK, "package.json")) !== depsBefore || !existsSync(join(DESK, "node_modules"))) {
      set({ message: "Installing new parts…" });
      const n = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: DESK, shell: true, windowsHide: true, encoding: "utf8", timeout: 600000 });
      if (n.status !== 0) throw new Error(`Dayspring ${newVer} was copied in, but "npm install" failed. Run "Update Dayspring.cmd" again, or restore from ${backup}.`);
    }
    set({ phase: "restarting", message: `Updated to ${newVer}. Restarting…`, latest: null });
    setTimeout(() => (restart ?? restartServer)(), 1500);
    return { updated: true, from: info.current, to: newVer, backup, message: state.message };
  } catch (e) {
    set({ phase: "error", error: e.message, message: e.message });
    throw e;
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

// A restart of our own, for when the server didn't pass one (scripts/update.mjs uses none: it isn't the server).
export function restartServer() {
  const disp = process.env.DAYSPRING_DISPLAY ?? process.env.DAYSPRING_TV ?? "";
  const cmd = `timeout /t 2 /nobreak >nul & set DAYSPRING_DISPLAY=${disp}& start "Dayspring server" /min cmd /k node --env-file-if-exists=.env server.mjs`;
  spawn("cmd.exe", ["/d", "/c", cmd], { cwd: DESK, detached: true, stdio: "ignore", windowsHide: true }).unref();
  setTimeout(() => process.exit(0), 500);
}

// The daily check: announce() is called with a sentence when a newer version appears (once per version).
let timer = null, told = null;
export function startDailyCheck(announce) {
  if (timer || !repo()) return;
  const run = async () => {
    try { const r = await check(); if (r.available && told !== r.latest) { told = r.latest; announce?.(`An update is available: Dayspring ${r.latest}. Say "update Dayspring" or open Settings → Updates when you're ready.`, r); } }
    catch { /* quiet: offline or rate-limited; try tomorrow */ }
  };
  setTimeout(run, 60_000).unref?.();
  timer = setInterval(run, 24 * 3600_000); timer.unref?.();
}

// newest code backups (for Settings → Updates → "go back")
export function backups() {
  const dir = join(DESK, "backups");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => d.startsWith("code-")).map((d) => ({ name: d, at: statSync(join(dir, d)).mtime.toISOString() })).sort((a, b) => b.at.localeCompare(a.at));
}
