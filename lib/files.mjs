// The assistant's view of the owner's files: search and read anywhere under the file root,
// write only inside the notes folder. Secrets are never read, because anything read here
// is sent to the model.
import { readdir, readFile, stat, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join, resolve, relative, extname, basename, sep, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import * as owner from "./owner.mjs";

// Notes and file backups live in Dayspring's own data folder unless the owner picked somewhere else (owner.json notesDir /
// backupDir, or DAYSPRING_NOTES_DIR / DAYSPRING_BACKUP_DIR in .env).
const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
export const ROOT = () => resolve(process.env.DAYSPRING_FILE_ROOT || owner.fileRoot());
export const NOTES = () => resolve(process.env.DAYSPRING_NOTES_DIR || owner.get().notesDir || join(DATA, "notes"));

// Folders that are build output, dependencies or version control: never worth walking.
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".cache", ".turbo", "__pycache__",
  ".venv", "venv", "target", ".gradle", "coverage", "test-results", ".vercel", "AppData", "$RECYCLE.BIN", ".pnpm-store"]);
// Never read: credentials and keys.
const SECRET = [/^\.env(\..*)?$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i, /^id_(rsa|ed25519|ecdsa)/i, /credentials?/i,
  /secrets?\./i, /\.kdbx$/i, /^\.npmrc$/i, /^\.netrc$/i, /service[-_]?account.*\.json$/i, /(^|[-_.])tokens?\.(json|txt)$/i];
const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".json", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".html", ".htm",
  ".cfm", ".cfc", ".sql", ".py", ".csv", ".yml", ".yaml", ".toml", ".ini", ".xml", ".svg", ".sh", ".ps1", ".cmd", ".bat",
  ".c", ".cpp", ".h", ".hpp", ".ino", ".java", ".cs", ".go", ".rs", ".rb", ".php", ".lua", ".tex", ".log", ".gcode", ".scad"]);
const MAX_READ = 200_000;      // characters returned from one read
const MAX_SEARCH_FILE = 1_000_000;

export function isSecret(p) { return SECRET.some((re) => re.test(basename(p))); }

// Resolve a user- or model-supplied path inside the root. Relative paths are relative to the root.
export function inside(p) {
  const full = resolve(ROOT(), String(p || "."));
  const rel = relative(ROOT(), full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${p} is outside ${ROOT()}`);
  return full;
}
const shown = (full) => relative(ROOT(), full) || ".";

export async function listDir(p = ".") {
  const dir = inside(p);
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
    let size = null, modified = null;
    try { const s = await stat(join(dir, e.name)); size = e.isDirectory() ? null : s.size; modified = s.mtime.toISOString().slice(0, 10); } catch { /* unreadable */ }
    out.push({ name: e.name + (e.isDirectory() ? "/" : ""), size, modified, secret: !e.isDirectory() && isSecret(e.name) || undefined });
    if (out.length >= 300) break;
  }
  return { path: shown(dir), entries: out, truncated: entries.length > out.length };
}

// Walk the tree under `start`, yielding file paths. Stops at `limit` files or `ms` milliseconds.
async function* walk(start, { ms = 8000, limit = 200_000 } = {}) {
  const t0 = Date.now();
  const stack = [start];
  let n = 0;
  while (stack.length) {
    if (Date.now() - t0 > ms || n > limit) return;
    const dir = stack.pop();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    const subdirs = [];
    for (const e of entries) {
      if (e.name.startsWith(".") && e.isDirectory()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) subdirs.push(full); }
      else { n++; yield full; }
    }
    // pushed in reverse so folders are visited A→Z: numbered folders first, then the rest
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]);
  }
}

// Find files by name. Every word in the query must appear in the path (case-insensitive).
export async function findFiles(query, under = ".", max = 40) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for await (const f of walk(inside(under))) {
    const rel = shown(f).toLowerCase();
    if (words.every((w) => rel.includes(w))) { hits.push(shown(f)); if (hits.length >= max) break; }
  }
  return { query, under: shown(inside(under)), matches: hits };
}

// Search inside text files for a phrase (case-insensitive). Returns file + line + snippet.
export async function searchText(text, under = ".", max = 30) {
  const needle = String(text).toLowerCase();
  if (needle.length < 3) throw new Error("search text must be at least 3 characters");
  const hits = [];
  let scanned = 0;
  for await (const f of walk(inside(under), { ms: 12000 })) {
    if (!TEXT_EXT.has(extname(f).toLowerCase()) || isSecret(f)) continue;
    let s;
    try { const st = await stat(f); if (st.size > MAX_SEARCH_FILE) continue; s = await readFile(f, "utf8"); } catch { continue; }
    scanned++;
    const low = s.toLowerCase();
    let at = low.indexOf(needle);
    while (at >= 0 && hits.length < max) {
      const line = s.slice(0, at).split("\n").length;
      const ls = s.lastIndexOf("\n", at) + 1, le = s.indexOf("\n", at);
      hits.push({ file: shown(f), line, text: s.slice(ls, le < 0 ? undefined : le).trim().slice(0, 240) });
      at = low.indexOf(needle, at + needle.length);
      if (hits.filter((h) => h.file === shown(f)).length >= 3) break;
    }
    if (hits.length >= max) break;
  }
  return { text, under: shown(inside(under)), filesScanned: scanned, matches: hits };
}

export async function readText(p, fromLine = 1, lines = 400) {
  const full = inside(p);
  if (isSecret(full)) throw new Error(`${basename(full)} holds secrets, so it is not read.`);
  const st = await stat(full);
  if (st.isDirectory()) return listDir(p);
  const ext = extname(full).toLowerCase();
  if (!TEXT_EXT.has(ext) && ext !== "") {
    return { path: shown(full), size: st.size, note: `${ext} is not a text file, so its contents can't be read here. Name and size only.` };
  }
  const s = await readFile(full, "utf8");
  const all = s.split("\n");
  const start = Math.max(1, Number(fromLine) || 1);
  let body = all.slice(start - 1, start - 1 + Math.min(Number(lines) || 400, 2000)).join("\n");
  if (body.length > MAX_READ) body = body.slice(0, MAX_READ) + "\n…(cut off)";
  return { path: shown(full), totalLines: all.length, fromLine: start, content: body, modified: st.mtime.toISOString().slice(0, 16) };
}

// Writing is allowed only inside the notes folder.
export async function writeNote(name, content, append = false) {
  const safe = String(name || "note").replace(/[<>:"|?*\\/]+/g, "-").replace(/^\.+/, "").slice(0, 120) || "note";
  const file = join(NOTES(), /\.[a-z0-9]+$/i.test(safe) ? safe : safe + ".md");
  if (!resolve(file).startsWith(NOTES() + sep)) throw new Error("notes can only be written in the notes folder");
  await mkdir(dirname(file), { recursive: true });
  if (append) await appendFile(file, (content.startsWith("\n") ? "" : "\n") + content);
  else await writeFile(file, content);
  return { written: file, bytes: Buffer.byteLength(content), append };
}

// ---- writing anywhere under the root (with a backup of whatever it replaces) ----------------

export const BACKUPS = () => resolve(process.env.DAYSPRING_BACKUP_DIR || owner.get().backupDir || join(DATA, "file-backups"));
const NO_WRITE_DIRS = /[\\/](\.git|node_modules)([\\/]|$)/i;

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

function checkWritable(full) {
  if (isSecret(full)) throw new Error(`${basename(full)} holds secrets, so it is never written.`);
  if (NO_WRITE_DIRS.test(full)) throw new Error("Files inside .git or node_modules are never written.");
}

// Copy the current file into the backups folder before it changes. Returns the backup path.
async function backup(full) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = join(BACKUPS(), stamp, relative(ROOT(), full));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, await readFile(full));
  return dest;
}

// Create a file, or replace an existing one (existing files need confirmed: true).
export async function writeAnyFile(p, content, { confirmed = false } = {}) {
  const full = inside(p);
  checkWritable(full);
  const had = await exists(full);
  if (had && !confirmed) {
    const e = new Error(`${shown(full)} already exists. Tell ${owner.name()} what will change and get a yes, then call again with confirmed: true.`);
    e.needsConfirmation = true; throw e;
  }
  const saved = had ? await backup(full) : null;
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  return { written: shown(full), created: !had, backup: saved, bytes: Buffer.byteLength(content) };
}

// Replace one exact piece of text in a file (it must occur exactly once).
export async function editAnyFile(p, find, replace, { confirmed = false } = {}) {
  const full = inside(p);
  checkWritable(full);
  if (!confirmed) {
    const e = new Error(`Editing ${shown(full)} changes an existing file. Tell ${owner.name()} what will change and get a yes, then call again with confirmed: true.`);
    e.needsConfirmation = true; throw e;
  }
  const s = await readFile(full, "utf8");
  const n = s.split(find).length - 1;
  if (n !== 1) throw new Error(n === 0 ? "The text to replace was not found." : `The text to replace appears ${n} times; include more of the surrounding text so it is unique.`);
  const saved = await backup(full);
  await writeFile(full, s.replace(find, () => replace));
  return { edited: shown(full), backup: saved };
}
