// What Dayspring can do on the computer and the web, as AI tools, limited by the owner's permissions
// (lib/permissions.mjs). Works the same with Claude, ChatGPT, Grok and Ollama models.
//   tools({ provider })     → Anthropic-style tool definitions allowed right now
//   run(name, input, ctx)   → the result, or undefined if the name isn't one of these tools
//                             ctx.via: "ai" (the default: nothing the model says counts as the owner's OK), "offline" (the
//                             no-AI commands; userConfirmed: the owner already said yes to this exact request), "owner"
//                             (the owner clicked it in Settings)
//   NAMES                   → every tool name this module can answer (so older tools with the same names can be dropped)
// Every file change goes through change(): the permission for that kind of change (create, edit, move, delete), the
// fail-safes (filesafety.mjs: never Windows, Program Files, boot files, the registry, other people's profiles, Dayspring's
// own code, permissions or logs, .git, secrets; links followed to where they really lead; path tricks refused), a warning
// and "Are you sure?" for important files, a count for bulk changes, and the owner's yes through a one-time token
// (confirm.mjs) that the model can't give itself. Then a backup, and a line in the activity log (activity.mjs) with the
// size and fingerprint before and after.
import { readdir, readFile, stat, lstat, writeFile, mkdir, copyFile, rename, cp } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve, extname, basename, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import * as permissions from "./permissions.mjs";
import * as web from "./web.mjs";
import * as programs from "./programs.mjs";
import * as browser from "./browser.mjs";
import { isSecret, NOTES, BACKUPS as NOTE_BACKUPS } from "./files.mjs";
import * as owner from "./owner.mjs";
import * as documents from "./documents.mjs";
import * as safety from "./filesafety.mjs";
import * as activity from "./activity.mjs";
import * as confirm from "./confirm.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const BACKUPS = () => resolve(process.env.DAYSPRING_ABILITY_BACKUPS || join(DATA, "backups", "files"));
activity.addBackupDir(BACKUPS());
try { activity.addBackupDir(NOTE_BACKUPS()); } catch { /* no owner file yet */ }
const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".json", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".html", ".htm", ".cfm", ".cfc",
  ".sql", ".py", ".csv", ".tsv", ".yml", ".yaml", ".toml", ".ini", ".xml", ".svg", ".sh", ".ps1", ".cmd", ".bat", ".log", ".rtf", ".srt", ".vtt", ".tex", ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs", ".rb", ".php", ".lua", ".conf", ".cfg"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "$recycle.bin", "system volume information", "appdata", ".cache", "__pycache__", "windows", "program files", "program files (x86)", "programdata"]);
const { SECRET_DIR, SECRET_NAME } = safety;
// opening one of these runs it (a script, an installer, a registry change), so it counts as running a program
const RUNS = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msix|msp|reg|scr|lnk|url|cpl|msc|jar|appref-ms|application|pif|scf|inf)$/i;

// ---------------------------------------------------------------- tool definitions
const ASKS = "If the result has needsConfirm, tell the owner its text in your own words (keep the reasons, that a backup is made, and the question \"Are you sure?\"), then stop and wait. Only after the owner clearly says yes, call again with exactly the same arguments plus confirm_token from that result. Never pass a token the owner hasn't agreed to.";
const TOKEN = { confirm_token: { type: "string", description: "Only after the owner said yes: the confirm_token from the needsConfirm result" } };
const T = {
  web_search: { name: "web_search", description: "Search the internet. Use it for anything current or anything you're not sure of: news, facts, prices, hours, weather elsewhere, how-tos, reviews. Returns titles, links and short snippets; follow up with read_web_page for detail. Tell the user what you found in plain words.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What to search for, like a person would type it" } }, required: ["query"] } },
  read_web_page: { name: "read_web_page", description: "Read the text of one web page (http or https link), for example a search result. Returns the page title and its readable text (long pages are cut off).",
    input_schema: { type: "object", properties: { url: { type: "string", description: "The full http(s) address" } }, required: ["url"] } },
  browse: { name: "browse", description: "Drive Dayspring's own browser window, the way a person would. Actions: \"goto\" (open url), \"read\" (the page's text), \"links\" (the links on the page), \"click\" (a link or button, found by its visible text), \"type\" (put value into the field whose label or placeholder is field; set submit true to press Enter), \"back\". Never type passwords, card numbers or other payment or login details; if a site needs a sign-in, ask the user to sign in themselves in that window. Ask before submitting anything that sends, buys, posts or deletes.",
    input_schema: { type: "object", properties: {
      action: { type: "string", enum: ["goto", "read", "links", "click", "type", "back"] },
      url: { type: "string", description: "For goto: the full http(s) address" },
      text: { type: "string", description: "For click: the visible text of the link or button" },
      field: { type: "string", description: "For type: the field's label, placeholder or name" },
      value: { type: "string", description: "For type: what to type" },
      submit: { type: "boolean", description: "For type: press Enter afterwards" },
    }, required: ["action"] } },
  list_programs: { name: "list_programs", description: "List the programs installed on this computer (from the Start menu), optionally only those matching a word. Use it when the user asks what's installed or you need the exact name.",
    input_schema: { type: "object", properties: { match: { type: "string", description: "Optional word to filter by, like \"adobe\" or \"game\"" } }, required: [] } },
  open_program: { name: "open_program", description: "Open an installed program by name (\"Word\", \"Discord\", \"Calculator\", \"Spotify\"). If the result has needsConfirm, say its text, wait for the user's yes, then call again with confirmed true. Don't set confirmed true unless the user just said yes.",
    input_schema: { type: "object", properties: { name: { type: "string" }, confirmed: { type: "boolean" } }, required: ["name"] } },
  close_program: { name: "close_program", description: "Close a running program (like clicking its X). The first call only returns a question; ask it, and only after the user says yes call again with confirmed true.",
    input_schema: { type: "object", properties: { name: { type: "string" }, confirmed: { type: "boolean" } }, required: ["name"] } },
  list_folder: { name: "list_folder", description: "List what's in a folder on this computer (files with size and date, and subfolders). Use a full path like C:\\Users\\Name\\Documents, or a relative path inside the first allowed folder. Leave path empty to see the allowed folders.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: [] } },
  find_files: { name: "find_files", description: "Find files or folders whose names contain some words, under a folder (default: all allowed folders). Good for \"where's my resume\" or \"find the photos from the lake\".",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Words from the file name" }, under: { type: "string", description: "Optional folder to look in" } }, required: ["query"] } },
  search_text: { name: "search_text", description: "Search inside text files (notes, documents saved as text, code, csv) for a word or phrase. Returns matching lines with file paths.",
    input_schema: { type: "object", properties: { text: { type: "string" }, under: { type: "string", description: "Optional folder to look in" } }, required: ["text"] } },
  read_file: { name: "read_file", description: "Read a text file (txt, md, csv, json, code and similar). Returns up to 400 lines from fromLine. Files that hold passwords or keys are refused.",
    input_schema: { type: "object", properties: { path: { type: "string" }, fromLine: { type: "integer" } }, required: ["path"] } },
  write_file: { name: "write_file", description: `Create a text file or replace one. The old version is backed up first. ${ASKS}`,
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, ...TOKEN }, required: ["path", "content"] } },
  edit_file: { name: "edit_file", description: `Change one exact piece of text in a text file (find must appear exactly once). A backup is made first. ${ASKS}`,
    input_schema: { type: "object", properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" }, ...TOKEN }, required: ["path", "find", "replace"] } },
  // organizing: folders, moving, copying, deleting (to the Recycle Bin), opening in the normal app
  create_folder: { name: "create_folder", description: `Create a folder (and any missing parent folders). ${ASKS}`,
    input_schema: { type: "object", properties: { path: { type: "string" }, ...TOKEN }, required: ["path"] } },
  move_item: { name: "move_item", description: `Move or rename a file or folder (to: the new full path, or a folder to move it into). Never overwrites an existing file. ${ASKS}`,
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, ...TOKEN }, required: ["from", "to"] } },
  copy_item: { name: "copy_item", description: `Copy a file or folder (to: the new full path, or a folder to copy it into). Never overwrites an existing file. ${ASKS}`,
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, ...TOKEN }, required: ["from", "to"] } },
  delete_item: { name: "delete_item", description: `Move a file or folder to the Recycle Bin (it can be restored from there; files are also backed up). It ALWAYS asks first. ${ASKS}`,
    input_schema: { type: "object", properties: { path: { type: "string" }, ...TOKEN }, required: ["path"] } },
  open_item: { name: "open_item", description: `Open a file in its normal program (a Word doc in Word, a photo in Photos) or a folder in File Explorer, on the laptop's screen. Opening something that runs (a script, an installer, a .reg file) needs permission to open programs and always asks first. ${ASKS}`,
    input_schema: { type: "object", properties: { path: { type: "string" }, ...TOKEN }, required: ["path"] } },
  // what Dayspring did: the activity log (every command and every file change, kept at least 120 days)
  search_activity_log: { name: "search_activity_log", description: "Look back through Dayspring's activity log: what the owner asked, which tools ran, and every file read, created, changed, moved or deleted (with backups), programs opened, permission changes, confirmations and blocked attempts. Use it to check what you changed (\"what did you change today?\"), to find a change to undo, or to recall something from an earlier day. from/to are YYYY-MM-DD (default: the last 30 days); kind narrows it: command, tool, file, file.write, file.edit, file.create, file.move, file.delete, file.read, program, permissions, confirm, blocked.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Words to look for" }, from: { type: "string" }, to: { type: "string" }, kind: { type: "string" }, path: { type: "string", description: "Part of a file path" }, limit: { type: "integer" } }, required: [] } },
  undo_change: { name: "undo_change", description: `Undo a file change Dayspring made: put a changed or deleted file back from its backup, move a moved file back, or remove a file it created. id is the change's id from search_activity_log; leave it out for the most recent change. The current version is backed up first. It always asks first. ${ASKS}`,
    input_schema: { type: "object", properties: { id: { type: "string" }, ...TOKEN }, required: [] } },
  // plans the owner makes with Dayspring: saved as documents they can open anywhere
  save_plan: { name: "save_plan", description: "Save a plan you made with the owner (a trip, a project, a study plan, a meal plan, goals…) as a document in their Plans folder, so it can be pulled up later. content is Markdown (headings, lists, checkboxes). Saving under an existing title updates that plan (a backup is kept). Tell the owner where it was saved.",
    input_schema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, folder: { type: "string", description: "Optional: another folder to save it in" }, ...TOKEN }, required: ["title", "content"] } },
  find_plans: { name: "find_plans", description: "Pull up plans: the owner's saved Dayspring plans plus documents on the computer that look like plans (names with plan, schedule, itinerary, roadmap, goals, budget, agenda, outline, checklist). query narrows it (\"the Florida trip\", \"study\"). Then open_document/read_document to read one, or show it on screen.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: [] } },
  // documents: Word (.docx and old .doc), PDF, PowerPoint, Excel/CSV, OpenDocument, RTF, text, email, pictures of text
  document_find: { name: "document_find", description: "Find a document on this computer from how the owner describes it (\"my resume\", \"the lease agreement\", \"the Word doc I edited yesterday\", \"the bulletin in Downloads\"). Returns the best matches with paths. If ambiguous is true, list the top few and ask which one.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "The owner's own words for the document" } }, required: ["query"] } },
  open_document: { name: "open_document", description: "Open a document (Word .docx/.doc, PDF, PowerPoint, Excel, CSV, OpenDocument, RTF, text, email, or a picture of text) and get its title, type, length, outline (headings, pages or slides) and the first part of its text. Give a path, or a query to find it. Use this first, then read_document for more. Base summaries, explanations and answers only on what you actually read; never invent content. Set show true to also put it on the Dayspring screen.",
    input_schema: { type: "object", properties: { path: { type: "string" }, query: { type: "string", description: "Instead of path: how the owner described it" }, show: { type: "boolean", description: "Also open it in the reader on the Dayspring screen" } }, required: [] } },
  read_document: { name: "read_document", description: "Read a document's text in order, in paragraphs, for a full read-through, quoting, a summary of a long document (read it section by section), or answering a question about a part. from is a paragraph number (0 = start); or give section (1-based, from the outline) or page. When reading to the owner, quote the words exactly. For a spoken read-through of the whole thing, prefer read_aloud so the screen reads it paragraph by paragraph.",
    input_schema: { type: "object", properties: { path: { type: "string" }, from: { type: "integer" }, n: { type: "integer", description: "How many paragraphs (default 25, max 200)" }, section: { type: "integer" }, page: { type: "integer" } }, required: ["path"] } },
  read_aloud: { name: "read_aloud", description: "Have the Dayspring screen read a document out loud, paragraph by paragraph, with the text shown and highlighted (the owner can say pause, keep going, go back, next section, stop reading). from: a paragraph number, or resume true to pick up where the owner stopped last time.",
    input_schema: { type: "object", properties: { path: { type: "string" }, from: { type: "integer" }, section: { type: "integer" }, resume: { type: "boolean" } }, required: ["path"] } },
};
export const NAMES = Object.keys(T);
// the screen's document reader (set by the server: broadcasts to the display)
let showDoc = null;
export function setDocViewer(fn) { showDoc = fn; }

export function tools({ provider = "" } = {}) {
  const p = permissions.get(), out = [];
  if (p.web) { if (provider !== "anthropic") out.push(T.web_search); out.push(T.read_web_page); }  // Claude has its own web search
  if (p.browser) out.push(T.browse);
  if (p.programs !== "off") out.push(T.list_programs, T.open_program, T.close_program);
  if (p.files !== "off") {
    out.push(T.list_folder, T.find_files, T.search_text, T.read_file, T.document_find, T.open_document, T.read_document, T.read_aloud);
    out.push(T.open_item, T.find_plans);
    if (p.writeFiles !== "off") {
      if (p.can.create || p.can.edit) out.push(T.write_file, T.save_plan);
      if (p.can.edit) out.push(T.edit_file);
      if (p.can.create) out.push(T.create_folder, T.copy_item);
      if (p.can.move) out.push(T.move_item);
      if (p.can.delete) out.push(T.delete_item);
      out.push(T.undo_change);
    }
  }
  out.push(T.search_activity_log);
  return out;
}

// ---------------------------------------------------------------- files: finding and reading
function locate(p) {
  const roots = permissions.roots();
  if (!roots.length) throw new Error(permissions.DENY.files);
  // only a line break or surrounding quotes are tidied away: a trailing space or dot is a trick Windows would quietly drop
  const s = String(p ?? "").replace(/^\s+|[\r\n]+$/g, "").replace(/^"(.*)"$/, "$1");
  const fr = (() => { try { const r = owner.fileRoot(); return r && existsSync(r) ? r : null; } catch { return null; } })();
  const base = fr && permissions.check("read", fr).ok ? fr : roots[0];
  // path tricks are refused before anything else happens with the path
  const trick = safety.pathTrick(s);
  if (trick) { const e = new Error(`I won't use that path. ${trick}`); e.blocked = "trick"; throw e; }
  const full = !s ? base : isAbsolute(s) || /^[a-z]:/i.test(s) ? resolve(s) : resolve(base, s.replace(/^~[\\/]?/, ""));
  return full;
}
const via = (ctx) => ctx?.via ?? "ai";
function blocked(path, c, ctx, extra = {}) {
  activity.log("blocked", { path, reason: c.reason, why: c.why, text: c.text, via: via(ctx), ...extra });
  return { denied: true, text: c.text };
}
function guardRead(full, ctx) {
  const c = permissions.check("read", full);
  if (!c.ok) { blocked(full, c, ctx, { op: "read" }); throw new Error(c.text); }
  if (isSecret(full) || SECRET_DIR.test(full) || SECRET_NAME.test(basename(full))) { blocked(full, { reason: "secret", text: permissions.DENY.secret }, ctx, { op: "read" }); throw new Error(permissions.DENY.secret); }
}
const size = (n) => n == null ? null : n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`;

async function listFolder(path, ctx) {
  if (!String(path ?? "").trim()) return { allowedFolders: permissions.roots(), note: "These are the folders I may look in." };
  const full = locate(path); guardRead(full, ctx);
  const ents = await readdir(full, { withFileTypes: true });
  const items = [];
  for (const e of ents.slice(0, 300)) {
    if (e.name.startsWith(".") && e.isDirectory()) continue;
    const p = join(full, e.name);
    if (permissions.accessFor(p) === "none") continue;               // a "keep out" place inside an allowed one stays hidden
    let st = null; try { st = await stat(p); } catch { /* unreadable */ }
    items.push({ name: e.name, type: e.isDirectory() ? "folder" : "file", size: e.isDirectory() ? null : size(st?.size), modified: st?.mtime?.toLocaleDateString("en-CA") ?? null });
  }
  items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
  activity.log("file.list", { path: full, via: via(ctx), count: items.length });
  return { folder: full, count: ents.length, items, truncated: ents.length > 300 };
}

async function* walk(dir, depth = 0, budget = { n: 0 }) {
  if (depth > 8 || budget.n > 60_000) return;
  let ents; try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    budget.n++;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name.toLowerCase()) || e.name.startsWith(".") || SECRET_DIR.test(p) || permissions.accessFor(p) === "none") continue;
      yield { p, dir: true };
      yield* walk(p, depth + 1, budget);
    } else yield { p, dir: false };        // links and junctions come through as non-folders: never walked into
  }
}
const underRoots = (under) => (String(under ?? "").trim() ? [locate(under)] : permissions.roots());

async function findFiles(query, under, ctx) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error("What should I look for?");
  const out = [], started = Date.now();
  for (const root of underRoots(under)) {
    guardRead(root, ctx);
    for await (const f of walk(root)) {
      const n = basename(f.p).toLowerCase();
      if (words.every((w) => n.includes(w)) && !isSecret(f.p) && permissions.check("read", f.p).ok) out.push({ path: f.p, type: f.dir ? "folder" : "file" });
      if (out.length >= 40 || Date.now() - started > 20_000) break;
    }
    if (out.length >= 40) break;
  }
  activity.log("file.find", { query: String(query).slice(0, 200), under: under ? locate(under) : null, via: via(ctx), found: out.length });
  return { query, matches: out, note: out.length >= 40 ? "Showing the first 40." : undefined };
}

async function searchText(text, under, ctx) {
  const needle = String(text).toLowerCase();
  if (!needle) throw new Error("What should I search for?");
  const out = [], started = Date.now();
  for (const root of underRoots(under)) {
    guardRead(root, ctx);
    for await (const f of walk(root)) {
      if (f.dir || !TEXT_EXT.has(extname(f.p).toLowerCase()) || isSecret(f.p) || SECRET_NAME.test(basename(f.p)) || permissions.accessFor(f.p) === "none") continue;
      let st; try { st = await stat(f.p); } catch { continue; }
      if (st.size > 2 << 20) continue;
      let body; try { body = await readFile(f.p, "utf8"); } catch { continue; }
      const lines = body.split(/\r?\n/);
      for (let i = 0; i < lines.length && out.length < 30; i++) if (lines[i].toLowerCase().includes(needle)) out.push({ path: f.p, line: i + 1, text: lines[i].trim().slice(0, 200) });
      if (out.length >= 30 || Date.now() - started > 25_000) break;
    }
    if (out.length >= 30) break;
  }
  activity.log("file.search", { text: String(text).slice(0, 200), under: under ? locate(under) : null, via: via(ctx), found: out.length });
  return { text, matches: out };
}

async function readText(path, fromLine = 1, ctx) {
  const full = locate(path); guardRead(full, ctx);
  const st = await stat(full);
  if (st.isDirectory()) return listFolder(full, ctx);
  activity.log("file.read", { path: full, via: via(ctx) });
  const ext = extname(full).toLowerCase();
  if (!TEXT_EXT.has(ext) && ext) return { path: full, note: `That's a ${ext} file, which I can't read as text. I can open it for the user instead if programs are allowed.`, size: size(st.size) };
  const lines = (await readFile(full, "utf8")).split(/\r?\n/);
  const from = Math.max(1, Number(fromLine) || 1);
  return { path: full, fromLine: from, toLine: Math.min(lines.length, from + 399), totalLines: lines.length, text: lines.slice(from - 1, from + 399).join("\n") };
}

// ---------------------------------------------------------------- files: changing (every change comes through here)
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
async function backup(full) {
  if (!existsSync(full)) return null;
  try { if (!statSync(full).isFile()) return null; } catch { return null; }
  const dest = join(BACKUPS(), stamp(), full.replace(/^([a-z]):/i, "$1").replace(/^[\\/]+/, ""));
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(full, dest);
  return dest;
}
const fp = (p) => activity.fingerprint(p);
const nameOf = (p) => basename(p) || p;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// The owner acting in Settings: permission levels don't apply (it's their own click), the fail-safes still do.
function ownerCheck(path, kind) {
  const trick = safety.pathTrick(path);
  if (trick) return { ok: false, reason: "trick", text: `I won't use that path. ${trick}` };
  const full = resolve(path), real = safety.realPath(full), so = { ...permissions.safetyOptions(), kind };
  const hb = safety.hardBlock(full, so) ?? safety.hardBlock(real, so);
  return hb ? { ok: false, reason: "protected", why: hb.reason, text: hb.text } : { ok: true, full, real };
}

// change(spec, input, ctx) → null (go ahead) or a result to hand back ({ denied } / { needsConfirm, confirm_token, text })
//   spec: { tool, op: "create"|"edit"|"move"|"delete"|"copy", targets: [{ path, check, kind, main }], say: plain sentence for
//          the ordinary "ask me first" question, verb: "change"|"replace"|"delete"|"move"|"create"|"put back", bind: extra
//          things the owner agreed to (content fingerprint, destination…), always: always ask (undo) }
async function change(spec, input, ctx = {}) {
  const v = via(ctx);
  const p = permissions.get();
  for (const t of spec.targets) {
    const c = v === "owner" ? ownerCheck(t.path, t.kind) : permissions.check(t.check, t.path, { kind: t.kind });
    if (!c.ok) return blocked(t.path, c, ctx, { op: spec.op, tool: spec.tool });
  }
  const main = spec.targets.find((t) => t.main) ?? spec.targets[0];
  if (v === "owner") return null;
  const real = safety.realPath(main.path);
  // important files: why it might be a bad idea
  const opts = { usual: permissions.usualFolders(), marked: p.important };
  const why = [];
  for (const t of spec.targets.filter((x) => x.check !== "read")) for (const r of safety.importance(safety.realPath(t.path), t.main ? spec.op : "create", opts)) if (!why.includes(r)) why.push(r);
  // bulk: a whole folder, or more files than the limit
  let count = null;
  try { if (["delete", "move", "copy"].includes(spec.op) && statSync(real).isDirectory()) count = safety.countFiles(real); } catch { /* not there */ }
  const bulk = count && (spec.op === "delete" || count.files > p.bulkLimit);
  const ordinary = p.writeConfirm === "ask" && !(v === "offline" && ctx.userConfirmed);
  if (!why.length && !bulk && !ordinary && spec.op !== "delete" && !spec.always) return null;
  // the exact operation the owner is agreeing to
  const op = { tool: spec.tool, op: spec.op, paths: spec.targets.map((t) => safety.realPath(t.path).toLowerCase()), ...(spec.bind ?? {}) };
  if (input?.confirm_token) {
    const r = confirm.consume(input.confirm_token, op);
    if (r.ok) { activity.log("confirm.used", { tool: spec.tool, path: main.path, via: v }); return null; }
    if (r.why === "not-approved") return { needsConfirm: true, confirm_token: input.confirm_token, waiting: true, text: "I still need a clear yes from the owner before I do that. Ask them, and only call again after they say yes." };
    if (r.why === "different") return blocked(main.path, { reason: "confirm-mismatch", text: "That yes was for a different change, so I didn't do this one. Ask the owner again." }, ctx, { tool: spec.tool });
    // expired or unknown: ask again below
  }
  const n = nameOf(main.path);
  const backupLine = spec.op === "delete" ? (count ? " It goes to the Recycle Bin, so it can be restored." : " It goes to the Recycle Bin, and I keep a backup copy too, so it can be put back.")
    : spec.op === "edit" || spec.op === "restore" ? " I'll make a backup first, so it can be put back."
    : spec.op === "move" ? " Nothing is deleted, and it can be moved back." : "";
  let text;
  if (why.length) text = `Before I ${spec.verb} ${n}, you should know: ${why.join(" ")}${count ? ` It holds ${count.atLeast ? "at least " : ""}${plural(count.files, "file")}.` : ""}${backupLine} Are you sure?`;
  else if (bulk) text = `${n} holds ${count.atLeast ? "at least " : ""}${plural(count.files, "file")}. That will ${spec.verb} all of ${count.files === 1 ? "it" : "them"}.${backupLine} Are you sure?`;
  else if (spec.op === "delete") text = `Should I move ${n} to the Recycle Bin?${backupLine} Are you sure?`;
  else text = `${spec.say}${backupLine} ${spec.always ? "Are you sure?" : "Should I go ahead?"}`;
  const token = confirm.issue(op, { text, what: `${spec.tool} ${main.path}` });
  return { needsConfirm: true, confirm_token: token, text, why: why.length ? why : undefined, count: count?.files, important: why.length > 0 || undefined,
    howToConfirm: "Say this to the owner and wait. Only after a clear yes, call again with the same arguments plus this confirm_token. It works once, for this exact change, for two minutes." };
}
// one line per change, with what it was and what it is now
function logChange(kind, path, before, after, extra, ctx) {
  activity.log(kind, { path, via: via(ctx), sizeBefore: before?.size ?? null, sizeAfter: after?.size ?? null, sha256Before: before?.sha256 ?? null, sha256After: after?.sha256 ?? null, result: "ok", ...extra });
}
const failed = (kind, path, e, ctx, extra = {}) => { activity.log(kind, { path, via: via(ctx), result: "error", error: String(e?.message ?? e).slice(0, 300), ...extra }); };

async function writeText(path, content, input, ctx) {
  const full = locate(path);
  const exists = existsSync(full);
  const body = String(content ?? "");
  const stop = await change({ tool: "write_file", op: exists ? "edit" : "create", verb: exists ? "replace" : "create", targets: [{ path: full, check: exists ? "edit" : "create", kind: "file", main: true }],
    say: exists ? `That will replace ${basename(full)}.` : `That will create ${basename(full)} in ${dirname(full)}.`, bind: { content: activity._sha(body) } }, input, ctx);
  if (stop) return stop;
  const before = fp(full);
  try {
    const saved = await backup(full);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body, "utf8");
    logChange(exists ? "file.write" : "file.create", full, before, fp(full), { tool: "write_file", backup: saved }, ctx);
    return { written: full, created: !exists, backup: saved };
  } catch (e) { failed(exists ? "file.write" : "file.create", full, e, ctx); throw e; }
}
async function editText(path, find, replace, input, ctx) {
  const full = locate(path); guardRead(full, ctx);
  const body = await readFile(full, "utf8");
  const count = body.split(String(find)).length - 1;
  if (count !== 1) return { error: count ? `That text appears ${count} times; give me a longer piece so it's exact.` : "I couldn't find that text in the file." };
  const stop = await change({ tool: "edit_file", op: "edit", verb: "change", targets: [{ path: full, check: "edit", kind: "file", main: true }],
    say: `In ${basename(full)}, I'll change "${String(find).slice(0, 80)}" to "${String(replace).slice(0, 80)}".`, bind: { find: activity._sha(String(find)), replace: activity._sha(String(replace)) } }, input, ctx);
  if (stop) return stop;
  const before = fp(full);
  try {
    const saved = await backup(full);
    await writeFile(full, body.replace(String(find), () => String(replace)), "utf8");
    logChange("file.edit", full, before, fp(full), { tool: "edit_file", backup: saved }, ctx);
    return { edited: full, backup: saved };
  } catch (e) { failed("file.edit", full, e, ctx); throw e; }
}

// ---------------------------------------------------------------- organizing
const destFor = async (from, to) => { const t = locate(to); try { if ((await stat(t)).isDirectory()) return join(t, basename(from)); } catch { /* new name */ } return t; };
async function createFolder(path, input, ctx) {
  const full = locate(path);
  if (existsSync(full)) return { exists: true, folder: full };
  const stop = await change({ tool: "create_folder", op: "create", verb: "create", targets: [{ path: full, check: "create", kind: "folder", main: true }], say: `That will create the folder ${basename(full)} in ${dirname(full)}.` }, input, ctx);
  if (stop) return stop;
  try { await mkdir(full, { recursive: true }); logChange("folder.create", full, null, null, { tool: "create_folder" }, ctx); return { created: full }; }
  catch (e) { failed("folder.create", full, e, ctx); throw e; }
}
async function moveOrCopy(from, to, input, ctx, copy) {
  const src = locate(from); guardRead(src, ctx);
  if (!existsSync(src)) return { error: `I can't find ${from}.` };
  const dest = await destFor(src, to);
  if (existsSync(dest)) return { error: `There's already something called ${basename(dest)} there, so I didn't overwrite it.` };
  const isDir = statSync(src).isDirectory();
  const say = `${copy ? "That will copy" : "That will move"} ${basename(src)} to ${dirname(dest)}${basename(dest) !== basename(src) ? ` as ${basename(dest)}` : ""}.`;
  const targets = copy ? [{ path: src, check: "read", kind: isDir ? "folder" : "file", main: true }, { path: dest, check: "create", kind: isDir ? "folder" : "file" }]
    : [{ path: src, check: "move", kind: isDir ? "folder" : "file", main: true }, { path: dest, check: "move", kind: isDir ? "folder" : "file" }];
  const stop = await change({ tool: copy ? "copy_item" : "move_item", op: copy ? "copy" : "move", verb: copy ? "copy" : "move", targets, say, bind: { to: dest.toLowerCase() } }, input, ctx);
  if (stop) return stop;
  const before = isDir ? null : fp(src);
  const kind = copy ? "file.copy" : "file.move";
  try {
    await mkdir(dirname(dest), { recursive: true });
    if (copy) await cp(src, dest, { recursive: true, errorOnExist: true, force: false });
    else { try { await rename(src, dest); } catch (e) { if (e.code !== "EXDEV") throw e; await cp(src, dest, { recursive: true, errorOnExist: true, force: false }); await recycle(src); } }
    activity.log(kind, { path: src, to: dest, via: via(ctx), folder: isDir || undefined, size: before?.size ?? null, sha256: before?.sha256 ?? null, result: "ok", tool: copy ? "copy_item" : "move_item" });
    return { [copy ? "copied" : "moved"]: src, to: dest };
  } catch (e) { failed(kind, src, e, ctx, { to: dest }); throw e; }
}
// Recycle Bin (restorable), through Windows' own file operation. Tests point DAYSPRING_TEST_RECYCLE at a folder instead.
async function recycle(full) {
  const testBin = process.env.DAYSPRING_TEST_RECYCLE;
  if (testBin) { const dest = join(testBin, `${Date.now()}-${basename(full)}`); await mkdir(testBin, { recursive: true }); await rename(full, dest); return; }
  await new Promise((res, rej) => {
    const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; $p = $env:DS_TARGET; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }`;
    execFile("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true, env: { ...process.env, DS_TARGET: full }, timeout: 60_000 }, (e) => (e ? rej(new Error("Windows couldn't move it to the Recycle Bin.")) : res()));
  });
}
async function deleteItem(path, input, ctx, { undoOf = null } = {}) {
  const full = locate(path); guardRead(full, ctx);
  if (!existsSync(full)) return { error: `I can't find ${path}.` };
  // a link or junction: deleting "through" it could empty the folder it points to
  if ((await lstat(full)).isSymbolicLink()) return blocked(full, { reason: "link", text: "That's a link to another place, so I won't delete through it. Delete the real folder or file instead, if that's what you mean." }, ctx, { op: "delete" });
  const isDir = (await stat(full)).isDirectory();
  const stop = await change({ tool: undoOf ? "undo_change" : "delete_item", op: "delete", verb: "delete", targets: [{ path: full, check: "delete", kind: isDir ? "folder" : "file", main: true }], say: "" }, input, ctx);
  if (stop) return stop;
  const before = isDir ? null : fp(full);
  try {
    const saved = isDir || (before?.size ?? 0) > 200 * 1024 * 1024 ? null : await backup(full);
    const count = isDir ? safety.countFiles(full).files : null;
    await recycle(full);
    logChange("file.delete", full, before, null, { tool: undoOf ? "undo_change" : "delete_item", backup: saved, folder: isDir || undefined, files: count ?? undefined, recycled: true, undoOf: undoOf ?? undefined }, ctx);
    return { recycled: full, backup: saved, files: count ?? undefined };
  } catch (e) { failed("file.delete", full, e, ctx); throw e; }
}
async function openItem(path, input, ctx) {
  const full = locate(path); guardRead(full, ctx);
  if (!existsSync(full)) return { error: `I can't find ${path}.` };
  // something that runs when opened: it's running a program, so it needs that permission and always asks
  if (RUNS.test(full) && via(ctx) !== "owner") {
    const pc = permissions.check("programs");
    if (!pc.ok) return blocked(full, { reason: "programs", text: `Opening ${basename(full)} would run it, and I don't have permission to run programs. You can change that in Settings → Permissions.` }, ctx, { op: "run" });
    const op = { tool: "open_item", run: full.toLowerCase() };
    const ok = input?.confirm_token && confirm.consume(input.confirm_token, op).ok;
    if (!ok) {
      const text = `Opening ${basename(full)} will run it (it's a ${extname(full)} file, which can change things on this computer). Are you sure?`;
      return { needsConfirm: true, confirm_token: confirm.issue(op, { text, what: `open_item ${full}` }), text };
    }
  }
  spawn("explorer.exe", [full], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  activity.log(RUNS.test(full) ? "program" : "file.open", { path: full, action: "open", via: via(ctx) });
  return { opened: full };
}

// ---------------------------------------------------------------- undo: put back what Dayspring changed
const UNDOABLE = new Set(["file.write", "file.edit", "file.create", "file.move", "file.delete", "file.undo"]);
// the most recent change that can still be undone (not undone already)
export function lastUndoable({ days = 30 } = {}) {
  const from = new Date(Date.now() - days * 86400000).toLocaleDateString("en-CA");
  const { entries } = activity.search({ from, kind: "file", limit: 2000 });
  const undone = new Set(entries.filter((e) => e.undoOf).map((e) => e.undoOf));
  return entries.find((e) => UNDOABLE.has(e.kind) && e.result === "ok" && !undone.has(e.id) && (e.backup || e.kind === "file.create" || e.kind === "file.move")) ?? null;
}
export function describeUndo(e) {
  const when = new Date(e.at).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });
  const n = nameOf(e.path);
  if (e.kind === "file.create") return `remove ${n}, which I created ${when}`;
  if (e.kind === "file.move") return `move ${n} back from ${dirname(e.to)} to ${dirname(e.path)}`;
  if (e.kind === "file.delete") return `put back ${n}, which I deleted ${when}`;
  return `put ${n} back the way it was before ${when}`;
}
async function undoChange(input, ctx) {
  const e = input?.id ? activity.get(input.id) : lastUndoable();
  if (!e) return { error: input?.id ? "I couldn't find that change in the activity log." : "I haven't changed any files lately, so there's nothing to undo." };
  if (!UNDOABLE.has(e.kind) || e.result !== "ok") return { error: "That entry isn't a file change I can undo." };
  const always = via(ctx) !== "owner";
  const v = via(ctx);
  // put a file back from its backup (the current version is backed up first)
  if (e.backup && ["file.write", "file.edit", "file.delete", "file.undo"].includes(e.kind)) {
    if (!existsSync(e.backup)) return { error: "The backup for that change isn't there any more (backups are kept as long as the activity log)." };
    const target = e.path, exists = existsSync(target);
    const stop = await change({ tool: "undo_change", op: exists ? "restore" : "create", verb: "put back", always, targets: [{ path: target, check: exists ? "edit" : "create", kind: "file", main: true }],
      say: `I'll ${describeUndo(e)}.`, bind: { undo: e.id } }, input, ctx);
    if (stop) return stop.needsConfirm && !stop.waiting ? { ...stop, change: summarize(e) } : stop;
    const before = fp(target);
    try {
      const saved = await backup(target);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(e.backup, target);
      logChange("file.undo", target, before, fp(target), { tool: "undo_change", undoOf: e.id, restoredFrom: e.backup, backup: saved }, ctx);
      return { restored: target, from: e.backup, backupOfCurrent: saved };
    } catch (err) { failed("file.undo", target, err, ctx, { undoOf: e.id }); throw err; }
  }
  if (e.kind === "file.move") {
    if (!existsSync(e.to)) return { error: `${nameOf(e.to)} isn't where I moved it any more.` };
    if (existsSync(e.path)) return { error: `There's something called ${nameOf(e.path)} in the old place now, so I can't move it back without overwriting it.` };
    const stop = await change({ tool: "undo_change", op: "move", verb: "move back", always, targets: [{ path: e.to, check: "move", main: true }, { path: e.path, check: "move" }], say: `I'll ${describeUndo(e)}.`, bind: { undo: e.id } }, input, ctx);
    if (stop) return stop;
    try { await rename(e.to, e.path); activity.log("file.move", { path: e.to, to: e.path, via: v, result: "ok", tool: "undo_change", undoOf: e.id }); return { movedBack: e.path }; }
    catch (err) { failed("file.move", e.to, err, ctx, { undoOf: e.id }); throw err; }
  }
  if (e.kind === "file.create") {
    if (!existsSync(e.path)) return { error: `${nameOf(e.path)} isn't there any more.` };
    // only a file that's still exactly what Dayspring made (so this never removes someone's later work)
    const now = fp(e.path);
    if (!now?.sha256 || now.sha256 !== e.sha256After) return { error: `${nameOf(e.path)} has changed since I created it, so I won't remove it. You can delete it yourself if you're sure.` };
    const c = permissions.check("edit", e.path);
    if (!c.ok && v !== "owner") return blocked(e.path, c, ctx, { op: "undo" });
    const op = { tool: "undo_change", undo: e.id };
    if (v !== "owner") {
      const ok = input?.confirm_token && confirm.consume(input.confirm_token, op).ok;
      if (!ok) { const text = `I'll ${describeUndo(e)}. It goes to the Recycle Bin, and I keep a backup copy too. Are you sure?`; return { needsConfirm: true, confirm_token: confirm.issue(op, { text, what: `undo ${e.path}` }), text, change: summarize(e) }; }
    }
    try {
      const saved = await backup(e.path);
      await recycle(e.path);
      logChange("file.delete", e.path, now, null, { tool: "undo_change", undoOf: e.id, backup: saved, recycled: true }, ctx);
      return { removed: e.path, backup: saved };
    } catch (err) { failed("file.delete", e.path, err, ctx, { undoOf: e.id }); throw err; }
  }
  return { error: "I can't undo that one." };
}
const summarize = (e) => ({ id: e.id, at: e.at, kind: e.kind, path: e.path, to: e.to, backup: e.backup });

// ---------------------------------------------------------------- the activity log, for the AI
function searchLog(i) {
  const r = activity.search({ query: i.query, from: i.from, to: i.to, kind: i.kind, path: i.path, limit: Math.min(Number(i.limit) || 40, 200) });
  return { from: r.from, to: r.to, total: r.total, entries: r.entries.map(({ prev, hash, ...e }) => e),
    note: r.total > r.entries.length ? `Showing the newest ${r.entries.length} of ${r.total}. Narrow it with from/to, kind, path or query.` : undefined };
}

// ---------------------------------------------------------------- plans
const PLANS = () => join(NOTES(), "Plans");
const PLAN_WORDS = /\b(plans?|planning|schedule|itinerary|roadmap|goals?|budget|agenda|outline|checklist|to-?do|strategy|timeline)\b/i;
async function savePlan(title, content, folder, input, ctx) {
  const dir = folder ? locate(folder) : PLANS();
  const name = String(title).replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "Plan";
  const full = join(dir, name + ".md");
  const exists = existsSync(full);
  const body = (String(content).startsWith("#") ? String(content) : `# ${name}\n\n${content}`) + `\n\n_Saved by Dayspring on ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}_\n`;
  // saving a plan is what the owner asked for: no "should I go ahead?", but the fail-safes and important-file warnings hold
  const stop = await change({ tool: "save_plan", op: exists ? "edit" : "create", verb: exists ? "update" : "create", targets: [{ path: full, check: exists ? "edit" : "create", kind: "file", main: true }], say: "", bind: { title: name, content: activity._sha(String(content)) } }, input, { ...ctx, userConfirmed: true, via: via(ctx) === "ai" ? "offline" : via(ctx) });
  if (stop) return stop;
  const before = fp(full);
  const saved = await backup(full);
  await mkdir(dir, { recursive: true });
  await writeFile(full, body, "utf8");
  logChange(exists ? "file.write" : "file.create", full, before, fp(full), { tool: "save_plan", backup: saved }, ctx);
  return { saved: full, updated: Boolean(saved), backup: saved };
}
async function findPlans(query = "") {
  const q = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const mine = [];
  try { for (const e of await readdir(PLANS(), { withFileTypes: true })) if (e.isFile()) { const full = join(PLANS(), e.name); const st = await stat(full); mine.push({ title: e.name.replace(/\.md$/i, ""), path: full, modified: st.mtime.toISOString().slice(0, 10), saved: "with Dayspring" }); } } catch { /* none yet */ }
  const match = (x) => !q.length || q.some((w) => x.toLowerCase().includes(w));
  let docs = [];
  try { const r = await documents.find(query ? `${query} plan` : "plan"); docs = (r.matches ?? []).filter((m) => PLAN_WORDS.test(m.name) && !mine.some((x) => x.path === m.path)).slice(0, 10).map((m) => ({ title: m.name, path: m.path, modified: String(m.modified ?? "").slice(0, 10) })); } catch { /* search not allowed */ }
  const all = [...mine.filter((p) => match(p.title)), ...docs.filter((d) => match(d.title) || !q.length)];
  return { plansFolder: PLANS(), plans: all.slice(0, 15), note: all.length ? undefined : "No plans found yet. Make one together and I'll save it with save_plan." };
}

// ---------------------------------------------------------------- browser
const BLOCKED_FIELD = /(pass(word)?|pwd|card|cc-?(num|number|csc|exp)|cvv|cvc|security code|expir|iban|routing|account number|ssn|social security|otp|one[- ]time|2fa|pin\b)/i;
// Dayspring's own pages (Settings, permissions, the activity log) are the owner's, never the AI's to click through
const LOCAL = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;
async function browse(i) {
  const p = await browser.searchPage("browse");
  const a = String(i.action ?? "").toLowerCase();
  if (a === "goto") { const url = web.safeUrl(i.url); if (LOCAL.test(url)) return { refused: true, text: "That's a page on this computer (Dayspring's own settings or another local app), so I won't open it in the browser I drive." }; await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }); await p.waitForTimeout(800); return { at: p.url(), title: await p.title() }; }
  if (LOCAL.test(p.url())) return { refused: true, text: "That browser window is on a page on this computer, so I won't use it." };
  if (a === "back") { await p.goBack({ timeout: 15_000 }).catch(() => {}); return { at: p.url(), title: await p.title() }; }
  if (a === "read") {
    const text = await p.evaluate(() => (document.querySelector("main, article") ?? document.body).innerText);
    return { at: p.url(), title: await p.title(), text: text.length > 15_000 ? text.slice(0, 15_000) + "\n…(cut off here)" : text };
  }
  if (a === "links") {
    const links = await p.evaluate(() => [...document.querySelectorAll("a[href]")].map((x) => ({ text: x.innerText.trim().replace(/\s+/g, " ").slice(0, 100), url: x.href })).filter((x) => x.text && /^https?:/.test(x.url)).slice(0, 80));
    return { at: p.url(), links };
  }
  if (a === "click") {
    const t = String(i.text ?? "").trim(); if (!t) throw new Error("Which link or button should I click?");
    const loc = p.getByRole("link", { name: t }).or(p.getByRole("button", { name: t })).or(p.getByText(t, { exact: false })).first();
    await loc.click({ timeout: 8000 });
    await p.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await p.waitForTimeout(600);
    if (LOCAL.test(p.url())) { await p.goBack({ timeout: 15_000 }).catch(() => {}); return { refused: true, text: "That link led to a page on this computer, so I went back." }; }
    return { clicked: t, at: p.url(), title: await p.title() };
  }
  if (a === "type") {
    const f = String(i.field ?? "").trim(); if (!f) throw new Error("Which field should I type into?");
    if (BLOCKED_FIELD.test(f)) return { refused: true, text: "I don't type passwords, card numbers or sign-in codes. Please enter that one yourself in the Dayspring browser window." };
    const loc = p.getByLabel(f).or(p.getByPlaceholder(f)).or(p.locator(`[name="${f.replace(/"/g, "")}"]`)).or(p.getByRole("searchbox")).first();
    const meta = await loc.evaluate((el) => ({ type: el.type ?? "", ac: el.autocomplete ?? "", name: `${el.name ?? ""} ${el.id ?? ""} ${el.getAttribute("aria-label") ?? ""}` }), null, { timeout: 8000 });
    if (meta.type === "password" || /cc-|password|one-time-code/i.test(meta.ac) || BLOCKED_FIELD.test(meta.name)) return { refused: true, text: "That's a password or payment field, so I won't fill it in. Please type it yourself in the Dayspring browser window." };
    await loc.fill(String(i.value ?? ""), { timeout: 8000 });
    if (i.submit) { await loc.press("Enter"); await p.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {}); await p.waitForTimeout(800); }
    return { typed: true, field: f, at: p.url(), title: await p.title() };
  }
  throw new Error(`Unknown browse action "${i.action}". Use goto, read, links, click, type or back.`);
}

// ---------------------------------------------------------------- run
export async function run(name, input = {}, ctx = {}) {
  if (!NAMES.includes(name)) return undefined;
  const i = input ?? {};
  const c = { via: ctx.via ?? "ai", userConfirmed: ctx.via === "offline" && ctx.userConfirmed === true };
  try {
    switch (name) {
      case "web_search": { const k = permissions.check("web"); if (!k.ok) return { denied: true, text: k.text }; return await web.search(i.query); }
      case "read_web_page": { const k = permissions.check("web"); if (!k.ok) return { denied: true, text: k.text }; if (LOCAL.test(String(i.url ?? ""))) return { refused: true, text: "That's a page on this computer, so I won't read it as a web page." }; return await web.read(i.url); }
      case "browse": { const k = permissions.check("browser"); if (!k.ok) return { denied: true, text: k.text }; return await browse(i); }
      case "list_programs": {
        const k = permissions.check("programs"); if (!k.ok) return { denied: true, text: k.text };
        const all = await programs.list(), m = String(i.match ?? "").toLowerCase();
        const names = all.map((a) => a.name).filter((n) => !m || n.toLowerCase().includes(m));
        return { count: names.length, programs: names.slice(0, 150), truncated: names.length > 150 };
      }
      case "open_program": return await programs.open(i.name, { confirmed: i.confirmed === true });
      case "close_program": return await programs.close(i.name, { confirmed: i.confirmed === true });
      case "list_folder": return await listFolder(i.path, c);
      case "find_files": return await findFiles(i.query, i.under, c);
      case "search_text": return await searchText(i.text, i.under, c);
      case "read_file": {
        const ext = extname(String(i.path ?? "")).toLowerCase();
        if (documents.supported(i.path) && !TEXT_EXT.has(ext)) { const r = await documents.read(i.path, { from: Math.max(0, (Number(i.fromLine) || 1) - 1) }); activity.log("file.read", { path: r?.path ?? String(i.path), via: c.via }); return r; }   // Word, PDF… read as documents
        return await readText(i.path, i.fromLine, c);
      }
      case "document_find": { const r = await documents.find(i.query); activity.log("file.find", { query: String(i.query ?? "").slice(0, 200), via: c.via, found: r?.matches?.length ?? 0 }); return r; }
      case "open_document": {
        let p = i.path;
        if (!p && i.query) { const r = await documents.find(i.query); if (!r.best) return { found: false, note: "I couldn't find a document like that.", searchedFor: r.searchedFor }; if (r.ambiguous) return { ambiguous: true, choices: r.matches.slice(0, 5) }; p = r.best.path; }
        const o = await documents.outline(p);
        activity.log("file.read", { path: o.path, via: c.via });
        const prog = documents.progress(o.path);
        if (i.show && showDoc) showDoc({ action: "open", path: o.path });
        return { ...o, lastStoppedAtParagraph: prog?.para ?? null };
      }
      case "read_document": { const r = await documents.read(i.path, { from: i.from, n: i.n, section: i.section, page: i.page }); activity.log("file.read", { path: r?.path ?? String(i.path), via: c.via }); return r; }
      case "read_aloud": {
        const o = await documents.outline(i.path);
        activity.log("file.read", { path: o.path, via: c.via, aloud: true });
        const from = i.resume ? documents.progress(o.path)?.para ?? 0 : i.section ? (await documents.read(o.path, { section: i.section, n: 1 })).from : Number(i.from) || 0;
        if (!showDoc) return { note: "The Dayspring screen isn't connected, so I can't read it aloud there. I can read it here instead." };
        showDoc({ action: "read", path: o.path, from });
        return { reading: true, title: o.title, from, paragraphs: o.paragraphs, minutes: o.minutes };
      }
      case "write_file": return await writeText(i.path, i.content ?? "", i, c);
      case "create_folder": return await createFolder(i.path, i, c);
      case "move_item": return await moveOrCopy(i.from, i.to, i, c, false);
      case "copy_item": return await moveOrCopy(i.from, i.to, i, c, true);
      case "delete_item": return await deleteItem(i.path, i, c);
      case "open_item": return await openItem(i.path, i, c);
      case "save_plan": return await savePlan(i.title, i.content ?? "", i.folder, i, c);
      case "find_plans": return await findPlans(i.query ?? "");
      case "edit_file": return await editText(i.path, i.find ?? "", i.replace ?? "", i, c);
      case "search_activity_log": return searchLog(i);
      case "undo_change": return await undoChange(i, c);
    }
  } catch (e) {
    if (e?.blocked) activity.log("blocked", { reason: e.blocked, text: e.message, via: c.via, tool: name, path: String(i.path ?? i.from ?? "").slice(0, 400) });
    return { error: String(e?.message ?? e).slice(0, 400) };
  }
  return undefined;
}
// the owner's own "put back this version" in Settings → Activity log
export const restoreFromLog = (id) => undoChange({ id }, { via: "owner" });

// For the system prompt: one line on what the assistant may do.
export function summary() { return `On this computer you ${permissions.describe()}. If something isn't allowed, say so kindly and mention Settings → Permissions.`; }
// For the system prompt: how confirmations and the fail-safes work (so the model says the right thing).
export const SAFETY_TEXT = "Files and safety: some changes come back with needsConfirm (important files, deleting, many files at once, or when the owner asked to be asked first). Then say the result's text in your own words, keeping why it might be a bad idea, that a backup is made, and the question \"Are you sure?\", and wait. Only after the owner clearly says yes, call the same tool again with the same arguments plus confirm_token. You can't confirm for them, and the token only works for that exact change. Windows, Program Files, boot files, the registry, other people's profiles, Dayspring's own code, its permissions and its activity log can never be changed; if asked, explain why it would be a bad idea. Everything you do is recorded in the activity log: use search_activity_log to check what you changed or to recall something, and undo_change to put a change back.";
