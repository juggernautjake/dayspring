// The folder/file browser behind the permissions picker (first-run setup and Settings → Permissions).
//   GET /api/fs/roots            → { drives, users, places: [{ label, path, icon }] }   (Desktop, Documents, Downloads, …)
//   GET /api/fs/list?path=&hidden=1 → { path, parent, items: [{ name, path, kind, size, modified, hidden, access }] }
//   GET /api/fs/search?q=&under= → { items } — names that match, a few levels deep, quickly
// These only list names (never read what's inside a file), so the owner can choose; "access" shows what Dayspring may do
// with each item under the current permissions. Local only (the server refuses anything from the internet).
import { readdirSync, statSync, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, dirname, resolve, parse, basename } from "node:path";
import { homedir } from "node:os";
import * as permissions from "./permissions.mjs";

const HIDDEN = /^(\$recycle\.bin|system volume information|recovery|config\.msi|msocache|pagefile\.sys|hiberfil\.sys|swapfile\.sys|dumpstack\.log(\.tmp)?|desktop\.ini|thumbs\.db|ntuser\.(dat|ini|pol)|ntuser\.dat\..*|appdata|application data|local settings|my documents|cookies|nethood|printhood|recent|sendto|start menu|templates|intelliGit|documents and settings|\$windows\.~bt|\$winreagent|\$sysreset)$/i;
const isHidden = (name) => name.startsWith(".") || name.startsWith("$") || HIDDEN.test(name) || /^ntuser/i.test(name);
const KNOWN = [["Desktop", "Desktop", "🖥️"], ["Documents", "Documents", "📄"], ["Downloads", "Downloads", "⬇️"], ["Pictures", "Pictures", "🖼️"], ["Music", "Music", "🎵"], ["Videos", "Videos", "🎬"],
  ["OneDrive", "OneDrive", "☁️"], ["OneDrive\\Documents", "OneDrive · Documents", "☁️"], ["OneDrive\\Desktop", "OneDrive · Desktop", "☁️"], ["OneDrive\\Pictures", "OneDrive · Pictures", "☁️"]];

function drives() {
  const out = [];
  for (const l of "CDEFGHIJKLMNOPQRSTUVWXYZ") { const r = `${l}:\\`; if (existsSync(r)) out.push({ path: r, label: `${l}: drive${r.toLowerCase() === parse(homedir()).root.toLowerCase() ? " (Windows)" : ""}`, icon: "💽" }); }
  return out;
}
export function roots() {
  const users = permissions.userFolders();
  const places = [];
  for (const u of users) for (const [rel, label, icon] of KNOWN) {
    const p = join(u, rel);
    try { if (statSync(p).isDirectory()) places.push({ label: users.length > 1 ? `${label} (${basename(u)})` : label, path: p, icon }); } catch { /* not there */ }
  }
  return { drives: drives(), users: users.map((u) => ({ path: u, label: basename(u), icon: "👤" })), places };
}

const whenISO = (d) => (d ? d.toISOString() : null);
export async function list(path, { hidden = false, limit = 2000 } = {}) {
  const full = resolve(String(path || homedir()));
  let st; try { st = await stat(full); } catch (e) { throw Object.assign(new Error(e.code === "ENOENT" ? "That folder doesn't exist." : "That folder can't be opened."), { status: 404 }); }
  if (!st.isDirectory()) throw Object.assign(new Error("That's a file, not a folder."), { status: 400 });
  let ents; try { ents = await readdir(full, { withFileTypes: true }); } catch { throw Object.assign(new Error("Windows won't let me look inside that folder."), { status: 403 }); }
  const items = [];
  for (const e of ents) {
    const h = isHidden(e.name);
    if (h && !hidden) continue;
    const p = join(full, e.name), dir = e.isDirectory();
    let s = null; try { s = await stat(p); } catch { if (!dir) continue; }
    items.push({ name: e.name, path: p, kind: dir ? "folder" : "file", size: dir ? null : s?.size ?? null, modified: whenISO(s?.mtime), hidden: h, access: permissions.accessFor(p) });
    if (items.length >= limit) break;
  }
  items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) : a.kind === "folder" ? -1 : 1));
  const parent = dirname(full) === full ? null : dirname(full);
  return { path: full, parent, access: permissions.accessFor(full), items, truncated: items.length >= limit, total: ents.length };
}

const SKIP = new Set(["node_modules", ".git", "appdata", "$recycle.bin", "system volume information", "windows", "program files", "program files (x86)", "programdata", "backups", ".cache", "dist", "build"]);
export async function search(q, under, { limit = 60, ms = 3500, depth = 6 } = {}) {
  const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { items: [] };
  const starts = under ? [resolve(String(under))] : [...roots().places.map((p) => p.path), ...permissions.userFolders()];
  const out = [], seen = new Set(), t0 = Date.now();
  async function walk(dir, d) {
    if (d > depth || out.length >= limit || Date.now() - t0 > ms || seen.has(dir.toLowerCase())) return;
    seen.add(dir.toLowerCase());
    let ents; try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= limit || Date.now() - t0 > ms) return;
      if (isHidden(e.name)) continue;
      const p = join(dir, e.name), n = e.name.toLowerCase();
      if (words.every((w) => n.includes(w))) out.push({ name: e.name, path: p, kind: e.isDirectory() ? "folder" : "file", access: permissions.accessFor(p) });
      if (e.isDirectory() && !SKIP.has(n)) await walk(p, d + 1);
    }
  }
  for (const s of starts) await walk(s, 0);
  return { items: out, timedOut: Date.now() - t0 > ms };
}

export async function handle(req, res, { m, p, q, send }) {
  if (m !== "GET" || !p.startsWith("/fs/")) return false;
  try {
    if (p === "/fs/roots") return send(res, 200, roots()), true;
    if (p === "/fs/list") return send(res, 200, await list(q.get("path") || "", { hidden: q.get("hidden") === "1" })), true;
    if (p === "/fs/search") return send(res, 200, await search(q.get("q"), q.get("under") || "")), true;
  } catch (e) { return send(res, e.status ?? 500, { error: e.message }), true; }
  return false;
}
