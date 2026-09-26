// What Dayspring can do on the computer and the web, as AI tools, limited by the owner's permissions
// (lib/permissions.mjs). Works the same with Claude, ChatGPT, Grok and Ollama models.
//   tools({ provider })  → Anthropic-style tool definitions allowed right now
//   run(name, input)     → the result, or undefined if the name isn't one of these tools
//   NAMES                → every tool name this module can answer (so older tools with the same names can be dropped)
import { readdir, readFile, stat, writeFile, mkdir, copyFile, rename, cp } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, extname, basename, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import * as permissions from "./permissions.mjs";
import * as web from "./web.mjs";
import * as programs from "./programs.mjs";
import * as browser from "./browser.mjs";
import { isSecret, NOTES } from "./files.mjs";
import * as owner from "./owner.mjs";
import * as documents from "./documents.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const BACKUPS = join(DATA, "backups", "files");
const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".json", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".html", ".htm", ".cfm", ".cfc",
  ".sql", ".py", ".csv", ".tsv", ".yml", ".yaml", ".toml", ".ini", ".xml", ".svg", ".sh", ".ps1", ".cmd", ".bat", ".log", ".rtf", ".srt", ".vtt", ".tex", ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs", ".rb", ".php", ".lua", ".conf", ".cfg"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "$recycle.bin", "system volume information", "appdata", ".cache", "__pycache__", "windows", "program files", "program files (x86)", "programdata"]);
const SECRET_DIR = /(^|[\\/])(\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.config[\\/]gh|1password|bitwarden|keepass|wallets?|electrum|exodus|metamask)([\\/]|$)/i;
const SECRET_NAME = /(password|passwd|wallet|seed[-_ ]?phrase|recovery[-_ ]?(codes?|phrase)|private[-_ ]?key|\.kdbx$|login data|cookies$)/i;

// ---------------------------------------------------------------- tool definitions
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
  write_file: { name: "write_file", description: "Create a text file or replace one. If the result has needsConfirm, read the change back to the user in a sentence, wait for yes, then call again with confirmed true. The old version is backed up first.",
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, confirmed: { type: "boolean" } }, required: ["path", "content"] } },
  edit_file: { name: "edit_file", description: "Change one exact piece of text in a text file (find must appear exactly once). Same confirmation rule as write_file; a backup is made first.",
    input_schema: { type: "object", properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" }, confirmed: { type: "boolean" } }, required: ["path", "find", "replace"] } },
  // organizing: folders, moving, copying, deleting (to the Recycle Bin), opening in the normal app
  create_folder: { name: "create_folder", description: "Create a folder (and any missing parent folders). Same confirmation rule as write_file.",
    input_schema: { type: "object", properties: { path: { type: "string" }, confirmed: { type: "boolean" } }, required: ["path"] } },
  move_item: { name: "move_item", description: "Move or rename a file or folder (to: the new full path, or a folder to move it into). Never overwrites an existing file. Same confirmation rule as write_file.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, confirmed: { type: "boolean" } }, required: ["from", "to"] } },
  copy_item: { name: "copy_item", description: "Copy a file or folder (to: the new full path, or a folder to copy it into). Never overwrites an existing file.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, confirmed: { type: "boolean" } }, required: ["from", "to"] } },
  delete_item: { name: "delete_item", description: "Move a file or folder to the Recycle Bin (it can be restored from there). ALWAYS confirm first: the first call returns a question; ask it, and only after the owner says yes call again with confirmed true.",
    input_schema: { type: "object", properties: { path: { type: "string" }, confirmed: { type: "boolean" } }, required: ["path"] } },
  open_item: { name: "open_item", description: "Open a file in its normal program (a Word doc in Word, a photo in Photos) or a folder in File Explorer, on the laptop's screen.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  // plans the owner makes with Dayspring: saved as documents they can open anywhere
  save_plan: { name: "save_plan", description: "Save a plan you made with the owner (a trip, a project, a study plan, a meal plan, goals…) as a document in their Plans folder, so it can be pulled up later. content is Markdown (headings, lists, checkboxes). Saving under an existing title updates that plan (a backup is kept). Tell the owner where it was saved.",
    input_schema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, folder: { type: "string", description: "Optional: another folder to save it in" } }, required: ["title", "content"] } },
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
    if (p.writeFiles !== "off") out.push(T.write_file, T.edit_file, T.create_folder, T.move_item, T.copy_item, T.delete_item, T.save_plan);
  }
  return out;
}

// ---------------------------------------------------------------- files
function locate(p) {
  const roots = permissions.roots();
  if (!roots.length) throw new Error(permissions.DENY.files);
  const s = String(p ?? "").trim();
  const fr = (() => { try { const r = owner.fileRoot(); return r && existsSync(r) ? r : null; } catch { return null; } })();
  const base = fr && permissions.check("read", fr).ok ? fr : roots[0];
  const full = !s ? base : isAbsolute(s) || /^[a-z]:/i.test(s) ? resolve(s) : resolve(base, s.replace(/^~[\\/]?/, ""));
  return full;
}
function guardRead(full) {
  const c = permissions.check("read", full);
  if (!c.ok) throw new Error(c.text);
  if (isSecret(full) || SECRET_DIR.test(full) || SECRET_NAME.test(basename(full))) throw new Error(permissions.DENY.secret);
}
const size = (n) => n == null ? null : n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`;

async function listFolder(path) {
  if (!String(path ?? "").trim()) return { allowedFolders: permissions.roots(), note: "These are the folders I may look in." };
  const full = locate(path); guardRead(full);
  const ents = await readdir(full, { withFileTypes: true });
  const items = [];
  for (const e of ents.slice(0, 300)) {
    if (e.name.startsWith(".") && e.isDirectory()) continue;
    let st = null; try { st = await stat(join(full, e.name)); } catch { /* unreadable */ }
    items.push({ name: e.name, type: e.isDirectory() ? "folder" : "file", size: e.isDirectory() ? null : size(st?.size), modified: st?.mtime?.toLocaleDateString("en-CA") ?? null });
  }
  items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
  return { folder: full, count: ents.length, items, truncated: ents.length > 300 };
}

async function* walk(dir, depth = 0, budget = { n: 0 }) {
  if (depth > 8 || budget.n > 60_000) return;
  let ents; try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    budget.n++;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name.toLowerCase()) || e.name.startsWith(".") || SECRET_DIR.test(p)) continue;
      yield { p, dir: true };
      yield* walk(p, depth + 1, budget);
    } else yield { p, dir: false };
  }
}
const underRoots = (under) => (String(under ?? "").trim() ? [locate(under)] : permissions.roots());

async function findFiles(query, under) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error("What should I look for?");
  const out = [], started = Date.now();
  for (const root of underRoots(under)) {
    guardRead(root);
    for await (const f of walk(root)) {
      const n = basename(f.p).toLowerCase();
      if (words.every((w) => n.includes(w)) && !isSecret(f.p)) out.push({ path: f.p, type: f.dir ? "folder" : "file" });
      if (out.length >= 40 || Date.now() - started > 20_000) break;
    }
    if (out.length >= 40) break;
  }
  return { query, matches: out, note: out.length >= 40 ? "Showing the first 40." : undefined };
}

async function searchText(text, under) {
  const needle = String(text).toLowerCase();
  if (!needle) throw new Error("What should I search for?");
  const out = [], started = Date.now();
  for (const root of underRoots(under)) {
    guardRead(root);
    for await (const f of walk(root)) {
      if (f.dir || !TEXT_EXT.has(extname(f.p).toLowerCase()) || isSecret(f.p) || SECRET_NAME.test(basename(f.p))) continue;
      let st; try { st = await stat(f.p); } catch { continue; }
      if (st.size > 2 << 20) continue;
      let body; try { body = await readFile(f.p, "utf8"); } catch { continue; }
      const lines = body.split(/\r?\n/);
      for (let i = 0; i < lines.length && out.length < 30; i++) if (lines[i].toLowerCase().includes(needle)) out.push({ path: f.p, line: i + 1, text: lines[i].trim().slice(0, 200) });
      if (out.length >= 30 || Date.now() - started > 25_000) break;
    }
    if (out.length >= 30) break;
  }
  return { text, matches: out };
}

async function readText(path, fromLine = 1) {
  const full = locate(path); guardRead(full);
  const st = await stat(full);
  if (st.isDirectory()) return listFolder(full);
  const ext = extname(full).toLowerCase();
  if (!TEXT_EXT.has(ext) && ext) return { path: full, note: `That's a ${ext} file, which I can't read as text. I can open it for the user instead if programs are allowed.`, size: size(st.size) };
  const lines = (await readFile(full, "utf8")).split(/\r?\n/);
  const from = Math.max(1, Number(fromLine) || 1);
  return { path: full, fromLine: from, toLine: Math.min(lines.length, from + 399), totalLines: lines.length, text: lines.slice(from - 1, from + 399).join("\n") };
}

async function backup(full) {
  if (!existsSync(full)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(BACKUPS, stamp, full.replace(/^([a-z]):/i, "$1").replace(/^[\\/]+/, ""));
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(full, dest);
  return dest;
}
function guardWrite(full, confirmed, summary) {
  const c = permissions.check("write", full);
  if (!c.ok) return { denied: true, text: c.text };
  if (isSecret(full) || SECRET_DIR.test(full) || SECRET_NAME.test(basename(full))) return { denied: true, text: permissions.DENY.secret };
  if (c.ask && !confirmed) return { needsConfirm: true, text: `${summary} Should I go ahead?` };
  return null;
}
async function writeText(path, content, confirmed) {
  const full = locate(path);
  const exists = existsSync(full);
  const stop = guardWrite(full, confirmed, exists ? `That will replace ${basename(full)} (a backup is kept).` : `That will create ${basename(full)} in ${dirname(full)}.`);
  if (stop) return stop;
  const saved = await backup(full);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, String(content), "utf8");
  return { written: full, created: !exists, backup: saved };
}
async function editText(path, find, replace, confirmed) {
  const full = locate(path);
  const body = await readFile(full, "utf8");
  const count = body.split(String(find)).length - 1;
  if (count !== 1) return { error: count ? `That text appears ${count} times; give me a longer piece so it's exact.` : "I couldn't find that text in the file." };
  const stop = guardWrite(full, confirmed, `In ${basename(full)}, I'll change "${String(find).slice(0, 80)}" to "${String(replace).slice(0, 80)}".`);
  if (stop) return stop;
  const saved = await backup(full);
  await writeFile(full, body.replace(String(find), () => String(replace)), "utf8");
  return { edited: full, backup: saved };
}

// ---------------------------------------------------------------- organizing
const destFor = async (from, to) => { const t = locate(to); try { if ((await stat(t)).isDirectory()) return join(t, basename(from)); } catch { /* new name */ } return t; };
async function createFolder(path, confirmed) {
  const full = locate(path);
  if (existsSync(full)) return { exists: true, folder: full };
  const stop = guardWrite(full, confirmed, `That will create the folder ${basename(full)} in ${dirname(full)}.`); if (stop) return stop;
  await mkdir(full, { recursive: true });
  return { created: full };
}
async function moveOrCopy(from, to, confirmed, copy) {
  const src = locate(from); guardRead(src);
  if (!existsSync(src)) return { error: `I can't find ${from}.` };
  const dest = await destFor(src, to);
  if (existsSync(dest)) return { error: `There's already something called ${basename(dest)} there, so I didn't overwrite it.` };
  const stop = guardWrite(dest, confirmed, `${copy ? "That will copy" : "That will move"} ${basename(src)} to ${dirname(dest)}${basename(dest) !== basename(src) ? ` as ${basename(dest)}` : ""}.`)
    ?? (copy ? null : guardWrite(src, confirmed, `That will move ${basename(src)}.`));
  if (stop) return stop;
  await mkdir(dirname(dest), { recursive: true });
  if (copy) await cp(src, dest, { recursive: true, errorOnExist: true, force: false });
  else { try { await rename(src, dest); } catch (e) { if (e.code !== "EXDEV") throw e; await cp(src, dest, { recursive: true, errorOnExist: true, force: false }); await recycle(src); } }
  return { [copy ? "copied" : "moved"]: src, to: dest };
}
// Recycle Bin (restorable), through Windows' own file operation
function recycle(full) {
  return new Promise((res, rej) => {
    const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; $p = $env:DS_TARGET; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }`;
    execFile("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true, env: { ...process.env, DS_TARGET: full }, timeout: 60_000 }, (e) => (e ? rej(new Error("Windows couldn't move it to the Recycle Bin.")) : res()));
  });
}
async function deleteItem(path, confirmed) {
  const full = locate(path); guardRead(full);
  if (!existsSync(full)) return { error: `I can't find ${path}.` };
  const c = permissions.check("write", full); if (!c.ok) return { denied: true, text: c.text };
  if (isSecret(full) || SECRET_DIR.test(full) || SECRET_NAME.test(basename(full))) return { denied: true, text: permissions.DENY.secret };
  const isDir = (await stat(full)).isDirectory();
  if (!confirmed) return { needsConfirm: true, text: `Should I move ${isDir ? "the folder " : ""}${basename(full)} to the Recycle Bin? You can restore it from there.` };
  await recycle(full);
  return { recycled: full };
}
function openItem(path) {
  const full = locate(path); guardRead(full);
  if (!existsSync(full)) return { error: `I can't find ${path}.` };
  spawn("explorer.exe", [full], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  return { opened: full };
}
// ---------------------------------------------------------------- plans
const PLANS = () => join(NOTES(), "Plans");
const PLAN_WORDS = /\b(plans?|planning|schedule|itinerary|roadmap|goals?|budget|agenda|outline|checklist|to-?do|strategy|timeline)\b/i;
async function savePlan(title, content, folder) {
  const dir = folder ? locate(folder) : PLANS();
  const name = String(title).replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "Plan";
  const full = join(dir, name + ".md");
  const stop = guardWrite(full, true, ""); if (stop && !stop.needsConfirm) return stop;
  const saved = await backup(full);
  await mkdir(dir, { recursive: true });
  const body = String(content).startsWith("#") ? String(content) : `# ${name}\n\n${content}`;
  await writeFile(full, body + `\n\n_Saved by Dayspring on ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}_\n`, "utf8");
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
async function browse(i) {
  const p = await browser.page("browse");
  const a = String(i.action ?? "").toLowerCase();
  if (a === "goto") { await p.goto(web.safeUrl(i.url), { waitUntil: "domcontentloaded", timeout: 30_000 }); await p.waitForTimeout(800); return { at: p.url(), title: await p.title() }; }
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
export async function run(name, input = {}) {
  if (!NAMES.includes(name)) return undefined;
  const i = input ?? {};
  try {
    switch (name) {
      case "web_search": { const c = permissions.check("web"); if (!c.ok) return { denied: true, text: c.text }; return await web.search(i.query); }
      case "read_web_page": { const c = permissions.check("web"); if (!c.ok) return { denied: true, text: c.text }; return await web.read(i.url); }
      case "browse": { const c = permissions.check("browser"); if (!c.ok) return { denied: true, text: c.text }; return await browse(i); }
      case "list_programs": {
        const c = permissions.check("programs"); if (!c.ok) return { denied: true, text: c.text };
        const all = await programs.list(), m = String(i.match ?? "").toLowerCase();
        const names = all.map((a) => a.name).filter((n) => !m || n.toLowerCase().includes(m));
        return { count: names.length, programs: names.slice(0, 150), truncated: names.length > 150 };
      }
      case "open_program": return await programs.open(i.name, { confirmed: i.confirmed === true });
      case "close_program": return await programs.close(i.name, { confirmed: i.confirmed === true });
      case "list_folder": return await listFolder(i.path);
      case "find_files": return await findFiles(i.query, i.under);
      case "search_text": return await searchText(i.text, i.under);
      case "read_file": {
        const ext = extname(String(i.path ?? "")).toLowerCase();
        if (documents.supported(i.path) && !TEXT_EXT.has(ext)) return await documents.read(i.path, { from: Math.max(0, (Number(i.fromLine) || 1) - 1) });   // Word, PDF… read as documents
        return await readText(i.path, i.fromLine);
      }
      case "document_find": return await documents.find(i.query);
      case "open_document": {
        let p = i.path;
        if (!p && i.query) { const r = await documents.find(i.query); if (!r.best) return { found: false, note: "I couldn't find a document like that.", searchedFor: r.searchedFor }; if (r.ambiguous) return { ambiguous: true, choices: r.matches.slice(0, 5) }; p = r.best.path; }
        const o = await documents.outline(p);
        const prog = documents.progress(o.path);
        if (i.show && showDoc) showDoc({ action: "open", path: o.path });
        return { ...o, lastStoppedAtParagraph: prog?.para ?? null };
      }
      case "read_document": return await documents.read(i.path, { from: i.from, n: i.n, section: i.section, page: i.page });
      case "read_aloud": {
        const o = await documents.outline(i.path);
        const from = i.resume ? documents.progress(o.path)?.para ?? 0 : i.section ? (await documents.read(o.path, { section: i.section, n: 1 })).from : Number(i.from) || 0;
        if (!showDoc) return { note: "The Dayspring screen isn't connected, so I can't read it aloud there. I can read it here instead." };
        showDoc({ action: "read", path: o.path, from });
        return { reading: true, title: o.title, from, paragraphs: o.paragraphs, minutes: o.minutes };
      }
      case "write_file": return await writeText(i.path, i.content ?? "", i.confirmed === true);
      case "create_folder": return await createFolder(i.path, i.confirmed === true);
      case "move_item": return await moveOrCopy(i.from, i.to, i.confirmed === true, false);
      case "copy_item": return await moveOrCopy(i.from, i.to, i.confirmed === true, true);
      case "delete_item": return await deleteItem(i.path, i.confirmed === true);
      case "open_item": return openItem(i.path);
      case "save_plan": return await savePlan(i.title, i.content ?? "", i.folder);
      case "find_plans": return await findPlans(i.query ?? "");
      case "edit_file": return await editText(i.path, i.find ?? "", i.replace ?? "", i.confirmed === true);
    }
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 400) };
  }
  return undefined;
}

// For the system prompt: one line on what the assistant may do.
export function summary() { return `On this computer you ${permissions.describe()}. If something isn't allowed, say so kindly and mention Settings → Permissions.`; }
