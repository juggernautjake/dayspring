// "Find my resume", "open the PDF called lease agreement", "show me the picture named IMG_5782", "find photos from the
// lake", "open last week's budget spreadsheet", then "number 2", "show it in the folder", "open it in the default app".
//   command(text, { surface, via }) → { reply, listen?, opened?, shown? } | null (not about a file)   (no AI needed)
//   find(q) / openOnScreen(item) / openDefault(item) / showInFolder(item) / resolve(id)
//   TOOLS / tools() / runTool(name, input)   file_find · file_open · file_show_in_folder (Claude and Ollama alike)
//   setState(state) / current() / contextText()   what the viewer on the screen has open (it reports it)
// One confident match opens straight away in the viewer (public/viewer.js) on the Dayspring screen; several show as a
// numbered list with a picture, the folder, size, date and type; none says what's close, where it looked, and how to
// allow more. Everything goes through file access (lib/permissions.mjs) again when it's opened, and every open and view
// is in the activity log (the path only).
import { spawn } from "node:child_process";
import { basename, dirname, extname } from "node:path";
import { statSync } from "node:fs";
import * as permissions from "../permissions.mjs";
import * as activity from "../activity.mjs";
import * as confirm from "../confirm.mjs";
import { broadcast } from "../bus.mjs";
import { on as featureOn } from "../features.mjs";
import * as index from "./index.mjs";
import * as searchMod from "./search.mjs";
import { parse } from "./query.mjs";
import { kindOf, extOf, typeName } from "./kinds.mjs";

const FRESH = 5 * 60_000;
const RUNS = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msix|msp|reg|scr|lnk|url|cpl|msc|jar|appref-ms|application|pif|scf|inf)$/i;
const listWords = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n, w, ws = w + "s") => `${n} ${n === 1 ? w : ws}`;
export const sizeText = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1 << 20 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1 << 30 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / (1 << 30)).toFixed(1)} GB`);
export function whenText(ms, now = Date.now()) {
  if (!ms) return "";
  const d = new Date(ms), days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return `today ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}
const dry = () => process.env.DAYSPRING_NO_BROWSER === "1" || process.env.DAYSPRING_NO_OPEN === "1";

// ---- the files it knows about: the index, plus ones found another way (the AI's paths, Google Drive) ------------------
const extras = new Map();       // id → path (a local file that isn't in the index, checked every time it's used)
const driveItems = new Map();   // "d:<ref>" → a Drive file
export function register(path) {
  const k = index.allowedNow(path);
  if (!k.ok) return { denied: true, text: k.text, reason: k.reason };
  let st; try { st = statSync(k.full); } catch { return { error: "That file isn't there anymore." }; }
  if (!st.isFile()) return { error: "That's a folder, not a file." };
  const id = index.idOf(k.full);
  if (!index.byId(id)) extras.set(id, k.full);
  return itemOf(k.full, st);
}
function itemOf(path, st) { const name = basename(path); return { id: index.idOf(path), path, name, ext: extOf(name), kind: kindOf(name), size: st?.size ?? 0, mtime: Math.round(st?.mtimeMs ?? 0), source: "local" }; }
// resolve(id) → the item, fresh from the disk, or { error | denied }. Permission is checked again every time.
export function resolve(id) {
  const s = String(id ?? "");
  if (s.startsWith("d:")) { const f = driveItems.get(s); return f ? { ...f } : { error: "That Drive file isn't on the list anymore. Ask for it again." }; }
  if (!/^[a-f0-9]{16}$/.test(s)) return { error: "That isn't a file I know." };
  const path = index.byId(s)?.path ?? extras.get(s);
  if (!path) return { error: "That isn't a file I know.", missing: true };
  const k = index.allowedNow(path);
  if (!k.ok) { activity.log("blocked", { path, reason: k.reason, text: k.text, via: "file_viewer" }); return { denied: true, text: k.text, reason: k.reason }; }
  let st; try { st = statSync(k.real); } catch { index.removeItem(s); return { error: "That file isn't there anymore.", gone: true }; }
  if (!st.isFile()) return { error: "That isn't a file." };
  return { ...itemOf(path, st), real: k.real };
}
function driveItem(f) {
  const id = `d:${f.ref}`;
  const name = f.name ?? "Drive file";
  const it = { id, ref: f.ref, name, ext: extOf(name), kind: f.kind === "doc" || f.kind === "sheet" || f.kind === "slides" ? "drivedoc" : kindOf(name), size: f.size ?? 0, mtime: f.modified ? Date.parse(f.modified) : 0, source: "drive", drive: f.where ?? `${f.drive}'s Drive`, link: f.link ?? null, mimeType: f.mimeType };
  driveItems.set(id, it);
  if (driveItems.size > 500) driveItems.delete(driveItems.keys().next().value);
  return it;
}

// ---- finding -------------------------------------------------------------------------------------------------------------------
// find(q) → { results, total, searched, off, how, drive: [...] }   q: parse()'s result (or the same fields from the AI)
export async function find(q, { limit = 30, withDrive = null } = {}) {
  const st = index.status();
  if (!st.off && !st.scannedAt) await Promise.race([index.scanNow().catch(() => null), new Promise((r) => setTimeout(r, Number(process.env.DAYSPRING_FINDER_FIRST_WAIT_MS ?? 8000)))]);
  const local = q.source === "drive" ? { results: [], total: 0, searched: [], files: [] } : await searchMod.search(q, { limit });
  let drive = [];
  const useDrive = withDrive ?? (q.source === "drive" || (!local.results.length && q.words.length > 0 && q.source !== "local"));
  if (useDrive) {
    try {
      const d = await import("../connectors/drive.mjs");
      if (d.connected()) {
        const type = q.kinds.includes("image") ? "image" : q.kinds.includes("video") ? "video" : q.kinds.includes("audio") ? "audio" : q.exts.includes("pdf") ? "pdf" : undefined;
        const r = await d.search({ query: q.words.join(" "), type, limit: 15, after: q.after ? q.after.toISOString().slice(0, 10) : undefined });
        drive = (r.files ?? []).filter((f) => f.kind !== "folder").map(driveItem);
      }
    } catch (e) { if (q.source === "drive") throw e; }
  }
  return { ...local, results: [...local.results.map((x) => ({ ...x, source: "local" })), ...drive].slice(0, limit), drive: drive.length };
}

// ---- the list on the screen ------------------------------------------------------------------------------------------------------
let shown = null;         // { at, items, title }
export const lastShown = () => (shown && Date.now() - shown.at < FRESH ? shown : null);
export function row(x, n) {
  return { n, id: x.id, name: x.name, where: x.source === "drive" ? x.drive : index.whereOf(x.path), size: x.size ?? null, sizeText: sizeText(x.size), modified: x.mtime ? new Date(x.mtime).toISOString() : null, when: whenText(x.mtime),
    kind: x.kind, type: typeName(x.ext), ext: x.ext, source: x.source ?? "local", thumb: x.source === "drive" ? (x.kind === "image" ? `/api/drive/stream?ref=${encodeURIComponent(x.ref)}` : null) : (x.kind === "image" || x.kind === "video" ? `/api/viewer/thumb?id=${x.id}` : null) };
}
export async function showList(items, title, { q = null } = {}) {
  shown = { at: Date.now(), items: items.slice(0, 30), title, q: q?.raw ?? null };
  broadcast("viewer", { list: { title, items: shown.items.map((x, i) => row(x, i + 1)), q: q?.raw ?? "" } });
  // the media library's list (if any) is older now: "number 2" is about this one
  try { (await import("../medialib/skills.mjs")).closeList?.(); } catch { /* not loaded */ }
  return shown;
}
export function closeList() { shown = null; broadcast("viewer", { list: null }); }

// ---- what the viewer has open (it tells us) ---------------------------------------------------------------------------------------
let state = null;
export function setState(s = {}) { state = s && s.open ? { ...s, at: Date.now() } : null; return state; }
export const current = () => (state && Date.now() - state.at < 30 * 60_000 ? state : null);
let lastOpened = null;    // the item last opened (for "show it in the folder", "open it in the default app")
export function contextText() {
  if (!featureOn("fileviewer")) return "";
  const c = current();
  if (!c?.id) return "";
  const it = resolve(c.id);
  if (it.error || it.denied) return "";
  return `Open in the file viewer on the screen: "${it.name}" (${it.source === "drive" ? it.drive : it.path}), a ${typeName(it.ext)}${c.page ? `, page ${c.page}${c.pages ? ` of ${c.pages}` : ""}` : ""}. Its contents go to you only if the owner asks about it: then use read_document (or read_file) on that path.`;
}

// ---- opening -------------------------------------------------------------------------------------------------------------------------
function entry(x) {
  return { id: x.id, name: x.name, kind: x.kind, ext: x.ext, type: typeName(x.ext), size: x.size, sizeText: sizeText(x.size), modified: x.mtime ? new Date(x.mtime).toISOString() : null, when: whenText(x.mtime),
    where: x.source === "drive" ? x.drive : index.whereOf(x.path), source: x.source ?? "local", link: x.link ?? null, ref: x.ref ?? null };
}
// openOnScreen(item, { list, via }) → { opened, where, reply } | { denied, text } | { error }
export function openOnScreen(x, { list = null, via = "voice" } = {}) {
  const it = x.source === "drive" ? x : resolve(x.id ?? index.idOf(x.path));
  if (it.error || it.denied) return it;
  const ids = (list ?? []).map((y) => y.id).filter(Boolean);
  const at = Math.max(0, ids.indexOf(it.id));
  broadcast("viewer", { open: { ...entry(it), list: ids.length > 1 ? ids : null, index: at } });
  lastOpened = it;
  activity.log("file.view", it.source === "drive" ? { source: "drive", file: it.name, via } : { path: it.path, via });
  const where = it.source === "drive" ? it.drive : index.whereOf(it.path);
  return { opened: it.name, where, id: it.id, reply: `Opening ${it.name} from ${where}.` };
}
// "open it in the default app": that's starting a program, so it needs the Programs permission (and asks when it's set
// to ask, or always for something that runs when opened)
export function openDefault(x, { confirm_token = null, owner = false, via = "voice" } = {}) {
  const it = x?.id ? resolve(x.id) : x;
  if (!it || it.error || it.denied) return it ?? { error: "Which file?" };
  if (it.source === "drive") return it.link ? { link: it.link, text: `That one is in Google Drive. Open it there: ${it.link}` } : { error: "That one is in Google Drive, not on this computer." };
  const pc = permissions.check("programs");
  if (!pc.ok) { activity.log("blocked", { reason: "programs", action: "open", path: it.path, text: pc.text, via }); return { denied: true, text: "Opening it in another app means starting a program, and I don't have permission to open programs. You can turn that on in Settings → Permissions." }; }
  const runs = RUNS.test(it.path);
  if ((pc.ask && !owner) || runs) {
    const op = { tool: "file_open_default", path: String(it.real ?? it.path).toLowerCase() };
    const ok = confirm_token && confirm.consume(confirm_token, op).ok;
    if (!ok) {
      const text = runs ? `Opening ${it.name} will run it (it's a ${extname(it.name)} file, which can change things on this computer). Are you sure?` : `Open ${it.name} in its usual app on this computer? Should I go ahead?`;
      pending = { at: Date.now(), kind: "default", item: it };
      return { needsConfirm: true, confirm_token: confirm.issue(op, { text, what: `open ${basename(it.path)}` }), text };
    }
  }
  pending = null;
  if (!dry()) spawn("explorer.exe", [it.real ?? it.path], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  activity.log(runs ? "program" : "file.open", { action: "open", app: "default", path: it.real ?? it.path, via, dryRun: dry() || undefined, result: "ok" });
  return { opened: it.name, dryRun: dry() || undefined, reply: `Opening ${it.name} in its usual app.` };
}
export function showInFolder(x, { via = "voice" } = {}) {
  const it = x?.id ? resolve(x.id) : x;
  if (!it || it.error || it.denied) return it ?? { error: "Which file?" };
  if (it.source === "drive") return it.link ? { link: it.link, text: `That one is in Google Drive: ${it.link}` } : { error: "That one is in Google Drive." };
  const k = permissions.check("read", dirname(it.path));
  if (!k.ok) { activity.log("blocked", { path: it.path, reason: k.reason, text: k.text, via }); return { denied: true, text: k.text }; }
  if (!dry()) spawn("explorer.exe", [`/select,${it.real ?? it.path}`], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  activity.log("file.open", { action: "show in folder", path: it.real ?? it.path, via, dryRun: dry() || undefined, result: "ok" });
  return { shown: it.name, folder: dirname(it.path), dryRun: dry() || undefined, reply: `Showing ${it.name} in its folder, ${index.whereOf(it.path)}.` };
}

// ---- no AI needed ------------------------------------------------------------------------------------------------------------------------
let pending = null;      // a question waiting for "yes": { at, kind: "default" | "delete", item }
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
function pick(t) {
  const m = /^(?:(?:open|show( me)?|view|pull up|play|let'?s see|go with|pick|choose|i want|the|number|#|no\.?)\s*)*(?:number |#|no\.? )?(\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?: one)?(?: please)?$/.exec(t);
  if (!m) return /^(the )?last one$/.test(t) ? -1 : null;
  if (!/^(number|#|no|open|show|view|pull|play|the|pick|choose|go|let|i )/.test(t) && !/^\d{1,2}$/.test(t) && !/^(first|second|third|fourth|fifth)( one)?$/.test(t)) return null;
  return Number(ORD[m[2]] ?? m[2]);
}
const IN_DOC = /^(?:search(?: for)?|look for) (.+?)(?: in (?:it|this|here|the (?:document|pdf|file|page)))?$|^(?:find|look for|search for) (.+?) (?:in|on) (?:it|this|here|this page|the (?:document|pdf|file|page))$|^search (?:this|the) (?:page|document|file|pdf) for (.+)$/;
const VIEWER_CTL = [
  [/^(next|next (one|picture|photo|image|file|page|slide)|go (forward|to the next (one|page|picture)))$/, { ctl: "next" }],
  [/^(previous|back|go back|previous (one|picture|photo|image|file|page|slide)|last (picture|photo|page))$/, { ctl: "prev" }],
  [/^zoom (in|closer)$|^(make it )?bigger$|^enlarge( it)?$/, { ctl: "zoomIn" }], [/^zoom out$|^(make it )?smaller$/, { ctl: "zoomOut" }],
  [/^(fit (it )?(to (the )?)?(screen|window|page)|fit width|fit page|reset (the )?zoom|actual size)$/, { ctl: "fit" }],
  [/^rotate( it)?( (right|clockwise))?$|^turn it( right)?$/, { ctl: "rotate", dir: 1 }], [/^rotate( it)? (left|counter ?clockwise|anti ?clockwise)$|^turn it left$/, { ctl: "rotate", dir: -1 }],
  [/^flip( it)?( (horizontally|sideways|over))?$/, { ctl: "flip" }],
  [/^(start|play|begin) (the |a )?slide ?show$|^slide ?show$/, { ctl: "slideshow", on: true }], [/^(stop|end|pause) (the )?slide ?show$/, { ctl: "slideshow", on: false }],
  [/^(read (this|the) page|read (it|this|the page) (to me|aloud|out loud)|read aloud|read this( to me)?)$/, { ctl: "read" }], [/^stop reading$/, { ctl: "stopRead" }],
  [/^(full ?screen|go full ?screen|make it full ?screen)$/, { ctl: "full", on: true }], [/^(exit|leave) full ?screen$/, { ctl: "full", on: false }],
  [/^(show|hide) (the )?(info|details|information)$/, { ctl: "info" }],
  [/^(close|close (it|this|the viewer|the file|the picture|the pdf|the document)|stop viewing|i'?m done( looking)?)$/, { ctl: "close" }],
  [/^pause( it| the video| the song)?$/, { ctl: "pause" }], [/^(play|resume|continue|keep playing)( it| the video| the song)?$/, { ctl: "play" }],
];
export async function command(text, { surface = "tv", via = "voice" } = {}) {
  const t0 = String(text ?? "").trim();
  if (!t0 || surface === "call") return null;
  const t = t0.toLowerCase().replace(/[\u201c\u201d"]/g, "").replace(/[?!.,]+$/g, "").replace(/\s+/g, " ").trim();
  // 1. an answer to a question it asked
  const pend = pending && Date.now() - pending.at < 2 * 60_000 ? pending : null;
  if (pend && confirm.isYes(t)) {
    pending = null;
    if (pend.kind === "default") { const op = { tool: "file_open_default", path: String(pend.item.real ?? pend.item.path).toLowerCase() }; const r = openDefault(pend.item, { confirm_token: confirm.issueApproved(op, { what: `open ${pend.item.name}`, via: "voice" }), via }); return { reply: r.reply ?? r.text ?? r.error }; }
    if (pend.kind === "delete") { const { deleteFile } = await import("./actions.mjs"); const r = await deleteFile(pend.item.id, { approve: true, via }); return { reply: r.recycled ? `Moved ${pend.item.name} to the Recycle Bin.` : r.text ?? r.error ?? "I couldn't delete it." }; }
  }
  if (pend && confirm.isNo(t)) { pending = null; return { reply: "Okay, I'll leave it." }; }
  // 2. the viewer is open: "next", "zoom in", "page 5", "search for rent", "close"
  const cur = current();
  if (cur?.open) {
    // (pause and play only for a video or song in the viewer: otherwise they're the music's)
    for (const [re, c] of VIEWER_CTL) if (re.test(t) && (!["pause", "play"].includes(c.ctl) || ["video", "audio"].includes(cur.kind))) { broadcast("viewer", { ctl: c }); if (c.ctl === "close") setState(null); return { reply: c.ctl === "read" ? "Reading it." : "Okay." }; }
    let m;
    if ((m = /^(?:go to |turn to |jump to |show )?(page|slide) (\d{1,4})$/.exec(spokenNum(t)))) { broadcast("viewer", { ctl: { ctl: "page", n: Number(m[2]) } }); return { reply: `Page ${m[2]}.` }; }
    // "search for rent", "find rent in this document" (a plain "find …" is a file to find)
    if ((m = IN_DOC.exec(t)) && !/\b(file|files|folder|photos?|pictures?|pdfs?|documents?|videos?)\b/.test(m[1] ?? m[2] ?? m[3])) { const q = m[1] ?? m[2] ?? m[3]; broadcast("viewer", { ctl: { ctl: "search", q } }); return { reply: `Looking for “${q}”.` }; }
    if (/^(delete|remove|trash) (this|it|this (file|picture|photo|one))$/.test(t) && cur.id) { const { deleteFile } = await import("./actions.mjs"); const r = await deleteFile(cur.id, { via }); if (r.needsConfirm) { pending = { at: Date.now(), kind: "delete", item: { id: cur.id, name: r.name } }; return { reply: r.text, listen: true }; } return { reply: r.text ?? r.error }; }
  }
  // 3. about what was just opened or listed
  const about = lastOpened ?? lastShown()?.items[0] ?? null;
  if (/^(show|open)( me)? (it|that|this|that file|this file) in (the |its )?(folder|file explorer|explorer)$|^(show|open) (the |its )?(containing )?folder$|^where is (it|that|this)( saved)?$|^show (it|that) in (the )?folder$/.test(t) && about) {
    const r = showInFolder(about, { via }); return { reply: r.reply ?? r.text ?? r.error };
  }
  if (/^open (it|that|this)( one)? (in|with) (the |its )?(default|usual|normal|regular) (app|program|player|viewer)$|^open (it|that|this) (in|with) (word|excel|powerpoint|acrobat|photos|notepad|the app)$/.test(t) && about) {
    const r = openDefault(about, { via }); return { reply: r.reply ?? r.text ?? r.error, ...(r.needsConfirm ? { listen: true } : {}) };
  }
  // 4. a pick from the list on the screen (only while it's the newest list)
  const ls = lastShown();
  if (ls) {
    if (/^(close|hide) (the |that )?(list|results|files)$/.test(t)) { closeList(); return { reply: "Okay." }; }
    const n = pick(t) ?? pick(spokenNum(t));
    if (n) {
      const x = n === -1 ? ls.items.at(-1) : ls.items[n - 1];
      if (!x) return { reply: `There ${ls.items.length === 1 ? "is only 1 file" : `are only ${ls.items.length} files`} on the list.` };
      const r = openOnScreen(x, { list: ls.items, via });
      return { reply: r.reply ?? r.text ?? r.error, opened: Boolean(r.opened) };
    }
  }
  // 5. finding ("show number 3" with no list of its own on the screen belongs to whatever list is there)
  if (pick(t) || pick(spokenNum(t)) || /^(show|open|play|pick|choose) (number|#|no\.?) ?\w+$/.test(t)) return null;
  const q = parse(t0);
  if (!q) return null;
  return findAndAnswer(q, { via });
}
const spokenNum = (t) => t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?! one)/g, (w) => String(ORD[w]));
const WEBISH = /\b(pictures?|photos?|images?|pics?|videos?|gifs?|clips?) (of|about|on how|showing)\b|\bon (youtube|the (web|internet))\b|\b(online|youtube|spotify)\b/;

export async function findAndAnswer(q, { via = "voice" } = {}) {
  // not clearly about a file ("find a restaurant", "what's the weather"): only a quick look in an index that's ready
  if (!q.explicit && (q.action === "list" || !q.words.length || q.words.length > 6 || !index.scannedAt())) { if (!index.scannedAt()) index.scanSoon(); return null; }
  const mine = /\b(my|mine|i (took|saved|made|downloaded))\b|called|named|titled|on (my|this) (computer|pc|laptop)/.test(q.raw.toLowerCase());
  const r = await find(q);
  const st = index.status();
  if (r.off) return q.explicit && !(WEBISH.test(q.raw.toLowerCase()) && !mine) ? { reply: r.how } : null;
  const best = r.results[0];
  // not clearly about a file here: only a strong match (otherwise the web, YouTube, music or the AI take it)
  // (two or more of the words said are exactly in its name or folder: that's a file he means)
  const strong = best && best.exact >= 2 && best.score >= 0.6;
  if (!q.explicit && !strong && (!best || best.score < (mine && (q.action === "find" || q.action === "open") ? 0.7 : 0.9))) return null;
  if (WEBISH.test(q.raw.toLowerCase()) && !mine && !strong && (!best || best.score < 1.0)) return null;
  const what = q.kinds.includes("image") && q.kinds.length === 1 ? "picture" : q.kinds.includes("video") && q.kinds.length === 1 ? "video" : q.exts.length === 1 && q.exts[0] === "pdf" ? "PDF" : q.kinds.includes("sheet") ? "spreadsheet" : q.kinds.includes("slides") ? "presentation" : "file";
  if (!r.results.length) {
    const close = await searchMod.similar(q);
    const folders = r.searched.map((x) => basename(x) || x);
    const said = q.named ?? q.phrase;
    let reply = `I couldn't find ${said ? `a ${what} called “${said}”` : `any ${what}s`}${q.said ? ` from ${q.said}` : ""}${q.folder ? ` in ${q.folder}` : ""}.`;
    if (close.length) reply += ` Did you mean ${listWords(close.map((x) => x.name))}?`;
    reply += folders.length ? ` I looked in ${listWords(folders.slice(0, 6))}${folders.length > 6 ? ` and ${folders.length - 6} more` : ""}.` : "";
    if (st.scanning) reply += " I'm still going through your folders, so try again in a minute.";
    reply += ` ${index.HOW_TO_ALLOW}`;
    if (close.length) await showList(close, "Did you mean…", { q });
    return { reply, found: 0, suggestions: close.map((x) => x.name) };
  }
  const one = r.results.length === 1 || (searchMod.confident(r.results, q) && !(q.plural && r.results.length > 1 && !q.named));
  if (one && q.action !== "list") {
    const o = openOnScreen(best, { list: r.results.length > 1 ? r.results : null, via });
    return { reply: o.reply ?? o.text ?? o.error, opened: Boolean(o.opened), found: r.results.length, id: best.id };
  }
  await showList(r.results, q.phrase ? `Files like “${q.named ?? q.phrase}”` : `Your ${what}s${q.said ? ` from ${q.said}` : ""}`, { q });
  const n = r.total > 30 ? "more than 30" : String(r.results.length);
  const top = r.results.slice(0, 3).map((x, i) => `${i + 1}, ${x.name}${x.source === "drive" ? ` (${x.drive})` : ` in ${index.whereOf(x.path)}`}`);
  return { reply: `I found ${n} ${r.results.length === 1 ? what : what + "s"}: ${top.join("; ")}. Say a number to open one.`, listen: true, found: r.results.length, shown: true };
}

// ---- the AI's tools ----------------------------------------------------------------------------------------------------------------------
const TOKEN = { confirm_token: { type: "string", description: "Only after the owner said yes: the confirm_token from the needsConfirm result" } };
export const TOOLS = [
  { name: "file_find", description: "Find the owner's files and pictures by NAME on this computer (and, when connected, Google Drive), forgiving typos and spoken numbers: \"my resume\", \"the PDF called lease agreement\", \"the picture named IMG_5782\", \"photos from the lake\", \"last week's budget spreadsheet\". Filters: kind, folder, dates, newest. Also matches the owner's own words about photos. Returns ids, names, folders, sizes and dates (never file contents), and shows a numbered list on the Dayspring screen. Then file_open with an id. Only folders file access allows are searched.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "The owner's own words, e.g. \"the lease agreement pdf in Documents from last month\"" }, name: { type: "string", description: "Words from the file name, if you know them" }, kind: { type: "string", enum: ["image", "video", "audio", "pdf", "document", "spreadsheet", "presentation", "text", "code", "zip"] }, folder: { type: "string", description: "e.g. Downloads, Documents, Pictures, or a folder name" }, after: { type: "string", description: "modified on or after YYYY-MM-DD" }, before: { type: "string", description: "modified before YYYY-MM-DD" }, latest: { type: "boolean", description: "newest first" }, source: { type: "string", enum: ["computer", "drive", "all"] }, show: { type: "boolean", description: "show the list on the screen (default true)" }, limit: { type: "integer" } } } },
  { name: "file_open", description: "Open one of the owner's files in Dayspring's viewer on the screen (pictures, video, audio, PDF, text and code, Word, Excel/CSV, PowerPoint, zip), or with where \"default\" in its usual Windows app (needs the Programs permission; may need the owner's yes). Give an id from file_find, a number from the list on the screen, a full path, or a query (the best match opens). Reading a file's contents is separate: use read_document only when the owner asks something about the file." + " If the result has needsConfirm, say its text to the owner and wait; only after a clear yes call again with the same arguments plus confirm_token.",
    input_schema: { type: "object", properties: { id: { type: "string" }, n: { type: "integer", description: "number on the list on the screen" }, path: { type: "string" }, query: { type: "string" }, where: { type: "string", enum: ["screen", "default"] }, ...TOKEN } } },
  { name: "file_show_in_folder", description: "Open File Explorer at the folder a file is in, with the file selected (\"where is it?\", \"show it in the folder\"). id from file_find, n from the list, or a path.",
    input_schema: { type: "object", properties: { id: { type: "string" }, n: { type: "integer" }, path: { type: "string" } } } },
];
export const tools = () => (permissions.get().files === "off" ? [TOOLS[0]] : TOOLS);
const KIND_MAP = { image: { kinds: ["image"] }, video: { kinds: ["video"] }, audio: { kinds: ["audio"] }, pdf: { exts: ["pdf"] }, document: { kinds: ["docx", "doc", "pdf", "text", "markdown"] }, spreadsheet: { kinds: ["sheet", "csv"] }, presentation: { kinds: ["slides"] }, text: { kinds: ["text", "markdown"] }, code: { kinds: ["code"] }, zip: { kinds: ["zip"] } };
function queryOf(i) {
  const q = parse(`find ${i.query ?? ""} ${i.name ? `called ${i.name}` : ""}`) ?? parse("find files");
  const k = KIND_MAP[i.kind]; if (k) { q.kinds = k.kinds ?? []; q.exts = k.exts ?? []; }
  if (i.folder) q.folder = String(i.folder).toLowerCase();
  if (i.after && !isNaN(Date.parse(i.after))) q.after = new Date(i.after + (String(i.after).length === 10 ? "T00:00:00" : ""));
  if (i.before && !isNaN(Date.parse(i.before))) q.before = new Date(i.before + (String(i.before).length === 10 ? "T23:59:59" : ""));
  if (i.latest) q.latest = true;
  if (i.source) q.source = i.source === "computer" ? "local" : i.source === "drive" ? "drive" : null;
  return q;
}
const brief = (x, n) => ({ n, id: x.id, name: x.name, where: x.source === "drive" ? x.drive : index.whereOf(x.path), path: x.source === "drive" ? undefined : x.path, type: typeName(x.ext), size: sizeText(x.size), modified: x.mtime ? new Date(x.mtime).toISOString().slice(0, 16) : null, source: x.source ?? "local", score: x.score });
async function target(i) {
  if (i.id) return resolve(i.id);
  if (i.n) { const x = lastShown()?.items[Number(i.n) - 1]; return x ? (x.source === "drive" ? x : resolve(x.id)) : { error: "That number isn't on the list on the screen." }; }
  if (i.path) { const r = register(String(i.path).replace(/^"|"$/g, "")); if (r.denied) activity.log("blocked", { path: String(i.path), reason: r.reason, text: r.text, via: "ai" }); return r; }
  if (i.query) { const q = queryOf({ query: i.query }); const r = await find(q, { limit: 5 }); return r.results[0] ? (r.results[0].source === "drive" ? r.results[0] : resolve(r.results[0].id)) : { error: `Nothing matched “${i.query}”.` }; }
  return { error: "Which file? Give an id from file_find, a number from the list, a path or a query." };
}
export async function runTool(name, i = {}) {
  if (!TOOLS.some((t) => t.name === name)) return undefined;
  try {
    if (name === "file_find") {
      const q = queryOf(i);
      const r = await find(q, { limit: Math.min(50, Number(i.limit) || 20) });
      if (r.off) return { denied: true, text: r.how };
      activity.log("file.find", { query: String(i.query ?? i.name ?? "").slice(0, 200), via: "ai", found: r.results.length, tool: "file_find" });
      if (i.show !== false && r.results.length) await showList(r.results, `Files like “${i.query ?? i.name ?? ""}”`, { q });
      const res = { count: r.results.length, results: r.results.map((x, k) => brief(x, k + 1)), searchedFolders: r.searched, shownOnScreen: i.show !== false && r.results.length > 0 };
      if (!r.results.length) { res.didYouMean = (await searchMod.similar(q)).map((x) => x.name); res.howToAllowMore = index.HOW_TO_ALLOW; }
      if (index.isScanning()) res.note = "Still looking through the folders; more may turn up in a minute.";
      return res;
    }
    const it = await target(i);
    if (it.error || it.denied) return it.denied ? { denied: true, text: it.text } : { error: it.error };
    if (name === "file_show_in_folder") { const r = showInFolder(it, { via: "ai" }); return r.denied ? { denied: true, text: r.text } : r; }
    if (i.where === "default") { const r = openDefault(it, { confirm_token: i.confirm_token, via: "ai" }); return r; }
    const r = openOnScreen(it, { list: lastShown()?.items ?? null, via: "ai" });
    return r.opened ? { opened: r.opened, where: r.where, id: r.id, say: r.reply } : r;
  } catch (e) { return { error: String(e?.message ?? e).slice(0, 300) }; }
}
export function _reset() { shown = null; state = null; pending = null; lastOpened = null; extras.clear(); driveItems.clear(); }
