// Google Drive, for every Google account that has Drive turned on (lib/connectors/google.mjs holds the accounts).
//   search(opts)      across every connected Drive at once, or one ("in my work drive"): by name, full text, type, owner,
//                     modified date, starred, shared with me, and shared drives (supportsAllDrives / includeItemsFromAllDrives)
//   recent / changes  "my recent Drive files", "what changed in my Drive this week"
//   read(ref)         Docs, Sheets and Slides (exported to text / CSV), PDFs, Word files and text files → text for the AI
//                     (the same way lib/documents.mjs reads a file on this computer; nothing is kept)
//   stream(ref, req, res)  audio, video and pictures played on the Dayspring screen through this server: Range requests
//                     pass through, and the access token stays here (the page only ever sees /api/drive/stream?…)
//   media(query)      Drive audio and video for "play …" (lib/medialib)
//   upload / mkdir / move / trash / download   only with "Let Dayspring add and change files in this Drive" on (download
//                     needs file permission instead), and each asks the owner first (lib/confirm.mjs) and is logged.
//                     Trash is Drive's own trash (restorable for 30 days); nothing is ever deleted for good.
// DRIVE_BASE / DRIVE_UPLOAD_BASE point at a stand-in server for tests.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as google from "./google.mjs";
import * as permissions from "../permissions.mjs";
import * as confirm from "../confirm.mjs";
import * as activity from "../activity.mjs";

const BASE = () => process.env.DRIVE_BASE || "https://www.googleapis.com/drive/v3";
const UPLOAD = () => process.env.DRIVE_UPLOAD_BASE || "https://www.googleapis.com/upload/drive/v3";
const FIELDS = "id,name,mimeType,size,modifiedTime,createdTime,starred,shared,trashed,driveId,parents,webViewLink,iconLink,owners(displayName,emailAddress),lastModifyingUser(displayName),videoMediaMetadata(width,height,durationMillis),imageMediaMetadata(width,height),fileExtension";
const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document", SHEET = "application/vnd.google-apps.spreadsheet", SLIDES = "application/vnd.google-apps.presentation";
const TYPE_Q = {
  audio: "mimeType contains 'audio/'", video: "mimeType contains 'video/'", media: "(mimeType contains 'audio/' or mimeType contains 'video/')", image: "mimeType contains 'image/'",
  pdf: "mimeType = 'application/pdf'", doc: `mimeType = '${DOC}'`, sheet: `mimeType = '${SHEET}'`, slides: `mimeType = '${SLIDES}'`, folder: `mimeType = '${FOLDER}'`,
  document: `(mimeType = '${DOC}' or mimeType = 'application/pdf' or mimeType contains 'wordprocessingml' or mimeType = 'text/plain')`,
};
export const TYPES = Object.keys(TYPE_Q);
const MAX_READ_BYTES = 30 * 1024 * 1024, MAX_TEXT = 60_000;
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export const connected = () => google.connectedFor("drive");
export const accounts = () => google.accountsFor("drive");
export const canWrite = (acct) => { try { return google.canWriteDrive(typeof acct === "object" ? acct : google.accountFor("drive", acct)); } catch { return false; } };
export const anyWrite = () => accounts().some((a) => google.canWriteDrive(a));
const which = (account) => (account ? [google.accountFor("drive", account)] : (() => { const l = accounts(); if (!l.length) throw Object.assign(new Error("Google Drive isn't connected yet. Connect a Google account with Drive in Settings → Apps → Google."), { code: "not_connected" }); return l; })());
const acctById = (id) => google.accounts().find((a) => a.id === id) ?? null;

async function call(a, method, path, { query = {}, body, headers = {}, raw = false, base = BASE(), timeout } = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]));
  const url = `${base}${path}${qs.toString() ? "?" + qs : ""}`;
  const init = { method, headers: { ...headers }, timeout };
  if (body !== undefined) { if (Buffer.isBuffer(body) || typeof body === "string") init.body = body; else { init.body = JSON.stringify(body); init.headers["content-type"] = "application/json"; } }
  const res = await google.authFetch(a, url, init);
  if (raw) return res;
  if (!res.ok) throw await driveError(res);
  return res.status === 204 ? {} : res.json();
}
async function driveError(res) {
  let msg = ""; try { const j = await res.json(); msg = j.error?.message ?? j.error_description ?? ""; } catch { /* not json */ }
  const e = new Error(/has not been used|is disabled|accessNotConfigured/i.test(msg) ? "The Google Drive API isn't turned on in your Google Cloud project yet. Settings → Apps → Google has the link (Enable Drive API)."
    : res.status === 404 ? "That Drive file isn't there anymore (or this account can't see it)." : res.status === 403 && /insufficient|scope/i.test(msg) ? "This Google account hasn't allowed that yet. Turn it on in Settings → Apps → Google and sign in again."
    : `Google Drive said ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : ""}`);
  e.status = res.status; return e;
}

// ---- what a Drive file looks like to Dayspring ------------------------------------------------------------------------
export function kindOf(mime = "", name = "") {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime === FOLDER) return "folder";
  if (mime === DOC) return "doc"; if (mime === SHEET) return "sheet"; if (mime === SLIDES) return "slides";
  if (mime === "application/pdf") return "pdf";
  if (/^text\//.test(mime) || /\.(txt|md|csv|json)$/i.test(name)) return "text";
  return "file";
}
function shape(f, a) {
  const multi = accounts().length > 1;
  return { ref: `${a.id}:${f.id}`, id: f.id, account: a.id, accountLabel: google.labelOf(a), drive: a.nickname || a.email, name: f.name, kind: kindOf(f.mimeType, f.name), mimeType: f.mimeType,
    size: f.size ? Number(f.size) : null, modified: f.modifiedTime ?? null, starred: Boolean(f.starred), shared: Boolean(f.shared), sharedDrive: f.driveId ?? null,
    owner: f.owners?.[0]?.displayName ?? f.owners?.[0]?.emailAddress ?? null, link: f.webViewLink ?? null, parents: f.parents ?? [],
    duration: f.videoMediaMetadata?.durationMillis ? Math.round(Number(f.videoMediaMetadata.durationMillis) / 1000) : null,
    width: f.videoMediaMetadata?.width ?? f.imageMediaMetadata?.width ?? null, height: f.videoMediaMetadata?.height ?? f.imageMediaMetadata?.height ?? null, ...(multi ? { where: `${a.nickname || a.email}'s Drive` } : {}) };
}
// "<accountId>:<fileId>" (what search results carry) → { a, fileId }; a bare file id uses the account given, or the only one
export function parseRef(ref, account = null) {
  const s = String(ref ?? "").trim();
  const m = /^(g\d+):([\w-]{6,200})$/.exec(s);
  if (m) { const a = acctById(m[1]); if (!a || !google.enabled(a, "drive")) throw Object.assign(new Error("That Drive account isn't connected anymore."), { status: 404 }); return { a, fileId: m[2] }; }
  if (!/^[\w-]{6,200}$/.test(s)) throw Object.assign(new Error("That isn't a Drive file."), { status: 400 });
  return { a: which(account)[0], fileId: s };
}

// ---- search ---------------------------------------------------------------------------------------------------------------
// opts: { query (name words), text (full text), type (audio|video|media|image|pdf|doc|sheet|slides|folder|document), owner,
//         after / before (YYYY-MM-DD, modified), starred, sharedWithMe, sharedDrives (default true), inFolder (a folder ref),
//         account (a label: only that Drive), limit, orderBy }
export function buildQuery({ query, text, type, owner, after, before, starred, sharedWithMe, inFolder, trashed = false } = {}) {
  const q = [];
  if (!trashed) q.push("trashed = false");
  for (const w of String(query ?? "").split(/\s+/).filter(Boolean).slice(0, 8)) q.push(`name contains '${esc(w)}'`);
  if (text) q.push(`fullText contains '${esc(text)}'`);
  if (type && TYPE_Q[type]) q.push(TYPE_Q[type]);
  if (owner) q.push(/@/.test(owner) ? `'${esc(owner)}' in owners` : owner === "me" ? "'me' in owners" : `not 'me' in owners`);
  if (after) q.push(`modifiedTime > '${new Date(String(after).length === 10 ? after + "T00:00:00" : after).toISOString()}'`);
  if (before) q.push(`modifiedTime < '${new Date(String(before).length === 10 ? before + "T23:59:59" : before).toISOString()}'`);
  if (starred) q.push("starred = true");
  if (sharedWithMe) q.push("sharedWithMe = true");
  if (inFolder) q.push(`'${esc(inFolder)}' in parents`);
  return q.join(" and ");
}
export async function search(opts = {}) {
  const list = which(opts.account);
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 25));
  const per = await Promise.all(list.map(async (a) => {
    const folder = opts.inFolder ? (/^g\d+:/.test(opts.inFolder) ? parseRef(opts.inFolder).fileId : opts.inFolder) : null;
    const query = { q: buildQuery({ ...opts, inFolder: folder }), pageSize: Math.min(100, limit), fields: `files(${FIELDS})`, orderBy: opts.orderBy ?? (opts.text ? undefined : "modifiedTime desc"),
      spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: opts.sharedDrives === false ? "false" : "true", corpora: opts.sharedDrives === false ? "user" : "allDrives" };
    try { return ((await call(a, "GET", "/files", { query })).files ?? []).map((f) => shape(f, a)); }
    catch (e) { if (list.length === 1) throw e; return [{ error: `${google.labelOf(a)}: ${e.message}` }]; }
  }));
  const errors = per.flat().filter((x) => x.error).map((x) => x.error);
  const files = per.flat().filter((x) => !x.error).sort((x, y) => String(y.modified).localeCompare(String(x.modified))).slice(0, limit);
  activity.log("drive.search", { query: String(opts.query ?? opts.text ?? "").slice(0, 200), type: opts.type ?? null, accounts: list.map((a) => a.email), found: files.length });
  return { files, count: files.length, drives: list.map((a) => google.labelOf(a)), ...(errors.length ? { errors } : {}) };
}
export async function recent({ days = 7, account, limit = 20, type } = {}) {
  const after = new Date(Date.now() - Math.max(1, Number(days) || 7) * 86_400_000).toISOString();
  return search({ account, after, limit, type, orderBy: "modifiedTime desc" });
}
// "what changed in my Drive this week": the files changed since then, grouped by who changed them
export async function changes({ days = 7, account } = {}) {
  const r = await recent({ days, account, limit: 50 });
  const by = {};
  for (const f of r.files) { const k = f.drive; (by[k] ??= []).push(f); }
  return { ...r, days, summary: r.files.length ? `${plural(r.files.length, "file")} changed in the last ${plural(days, "day")}${r.drives.length > 1 ? ` across ${r.drives.length} Drives` : ""}.` : `Nothing changed in the last ${plural(days, "day")}.`, byDrive: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])) };
}
export async function info(ref, account) {
  const { a, fileId } = parseRef(ref, account);
  return shape(await call(a, "GET", `/files/${encodeURIComponent(fileId)}`, { query: { fields: FIELDS, supportsAllDrives: "true" } }), a);
}

// ---- reading --------------------------------------------------------------------------------------------------------------
async function bytes(a, fileId, max = MAX_READ_BYTES) {
  const res = await call(a, "GET", `/files/${encodeURIComponent(fileId)}`, { query: { alt: "media", supportsAllDrives: "true" }, raw: true, timeout: 60_000 });
  if (!res.ok) throw await driveError(res);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max) throw new Error(`That file is ${Math.round(len / 1048576)} MB, too big to read here.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error("That file is too big to read here.");
  return buf;
}
async function exported(a, fileId, mime) {
  const res = await call(a, "GET", `/files/${encodeURIComponent(fileId)}/export`, { query: { mimeType: mime }, raw: true, timeout: 60_000 });
  if (!res.ok) throw await driveError(res);
  return Buffer.from(await res.arrayBuffer()).toString("utf8");
}
// read(ref, { account, from }) → { name, kind, text, chars, truncated } — the words only, for the AI to summarise or read out
export async function read(ref, { account, from = 0 } = {}) {
  const { a, fileId } = parseRef(ref, account);
  const f = await info(`${a.id}:${fileId}`);
  let text = "", note = null;
  if (f.mimeType === DOC) text = await exported(a, fileId, "text/plain");
  else if (f.mimeType === SHEET) text = await exported(a, fileId, "text/csv");
  else if (f.mimeType === SLIDES) text = await exported(a, fileId, "text/plain");
  else if (f.kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { text: pages } = await extractText(await getDocumentProxy(new Uint8Array(await bytes(a, fileId))), { mergePages: false });
    text = pages.map((t, i) => (pages.length > 1 ? `[Page ${i + 1}]\n` : "") + String(t).trim()).join("\n\n");
    if (!text.trim()) note = "This PDF has no text layer (it's probably scanned).";
  } else if (/wordprocessingml/.test(f.mimeType)) {
    const { createRequire } = await import("node:module");
    const mammoth = createRequire(import.meta.url)("mammoth");
    text = (await mammoth.extractRawText({ buffer: await bytes(a, fileId) })).value;
  } else if (f.kind === "text" || /json|xml|csv|javascript/.test(f.mimeType)) text = (await bytes(a, fileId, 5 * 1024 * 1024)).toString("utf8");
  else return { ...f, text: null, note: f.kind === "audio" || f.kind === "video" ? "It's a media file: use drive_play to play it on the screen." : f.kind === "image" ? "It's a picture: use drive_show to put it on the screen." : `Dayspring can't read ${f.mimeType} files. Open it in Drive: ${f.link ?? ""}` };
  text = String(text).replace(/\r/g, "");
  const start = Math.max(0, Number(from) || 0), part = text.slice(start, start + MAX_TEXT);
  activity.log("drive.read", { account: a.email, file: f.name, fileId, kind: f.kind, chars: text.length });
  return { ...f, text: part, chars: text.length, from: start, truncated: start + part.length < text.length, ...(note ? { note } : {}) };
}

// ---- playing and showing: the server streams it (Range passes through; the token never reaches the page) --------------
const PLAYABLE = /^(audio|video|image)\//;
export async function stream(ref, req, res, { account } = {}) {
  const { a, fileId } = parseRef(ref, account);
  const headers = {};
  if (req.headers.range && /^bytes=\d*-\d*$/.test(req.headers.range)) headers.range = req.headers.range;
  const up = await call(a, "GET", `/files/${encodeURIComponent(fileId)}`, { query: { alt: "media", supportsAllDrives: "true", acknowledgeAbuse: "false" }, headers, raw: true, timeout: 120_000 });
  if (!up.ok && up.status !== 206) { const e = await driveError(up); res.writeHead(e.status === 404 ? 404 : 502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: e.message })); return; }
  const type = up.headers.get("content-type") ?? "application/octet-stream";
  if (!PLAYABLE.test(type)) { try { await up.body?.cancel(); } catch { /* fine */ } res.writeHead(415, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Only audio, video and pictures play on the screen." })); return; }
  const out = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  for (const h of ["content-length", "content-range"]) { const v = up.headers.get(h); if (v) out[h] = v; }
  res.writeHead(up.status, out);
  if (req.method === "HEAD" || !up.body) { res.end(); try { await up.body?.cancel(); } catch { /* fine */ } return; }
  const body = Readable.fromWeb(up.body);
  req.on("close", () => body.destroy());
  await pipeline(body, res).catch(() => {});
}
// Drive audio and video for "play …": { id: "d:<acct>:<file>", source: "drive", … } in the media library's shape
export async function media(query, { account, kind = "media", limit = 25 } = {}) {
  if (!connected()) return [];
  const words = String(query ?? "").trim();
  const r = await search({ query: words, type: kind === "audio" ? "audio" : kind === "video" ? "video" : "media", account, limit }).catch(() => ({ files: [] }));
  return r.files.map((f) => ({ id: `d:${f.ref}`, source: "drive", kind: f.kind, title: f.name.replace(/\.[a-z0-9]{2,4}$/i, ""), name: f.name, artist: "", album: "", genre: "", year: f.modified ? Number(f.modified.slice(0, 4)) : null,
    duration: f.duration, width: f.width, height: f.height, mtime: f.modified ? Date.parse(f.modified) : 0, folder: f.drive, drive: f.drive, account: f.account, accountLabel: f.accountLabel, size: f.size, ext: extname(f.name).slice(1).toLowerCase(), mimeType: f.mimeType, ref: f.ref }));
}

// ---- changing Drive: only with write on, and always after the owner's yes --------------------------------------------------
const WRITE_OFF = (a) => `Dayspring isn't allowed to add or change files in ${google.labelOf(a)}. Turn on "Let Dayspring add and change files in this Drive" in Settings → Apps → Google.`;
function writable(account) {
  const a = google.accountFor("drive", account);
  if (!google.canWriteDrive(a)) { activity.log("blocked", { reason: "drive-write-off", account: a.email, text: WRITE_OFF(a) }); throw Object.assign(new Error(WRITE_OFF(a)), { denied: true }); }
  return a;
}
// ask(op, text, input) → null (the owner said yes to exactly this) or the question to hand back
function ask(op, text, input) {
  if (input?.confirm_token) {
    const r = confirm.consume(input.confirm_token, op);
    if (r.ok) return null;
    if (r.why === "not-approved") return { needsConfirm: true, confirm_token: input.confirm_token, waiting: true, text: "I still need a clear yes from the owner before I do that. Ask them, and only call again after they say yes." };
    if (r.why === "different") return { refused: true, text: "That yes was for a different change, so I didn't do this one. Ask the owner again." };
  }
  return { needsConfirm: true, confirm_token: confirm.issue(op, { text, what: `${op.tool} ${op.name ?? op.fileId ?? ""}`.trim() }), text,
    howToConfirm: "Say this to the owner and wait. Only after a clear yes, call again with the same arguments plus this confirm_token. It works once, for this exact change, for two minutes." };
}
async function folderRef(a, parent) {
  if (!parent || /^(root|my drive)$/i.test(String(parent))) return { id: "root", name: "My Drive" };
  if (/^g\d+:[\w-]+$/.test(parent)) { const f = await info(parent); if (f.kind !== "folder") throw new Error(`${f.name} isn't a folder.`); return { id: f.id, name: f.name }; }
  if (/^[\w-]{20,}$/.test(parent)) return { id: parent, name: parent };
  const r = await search({ query: parent, type: "folder", account: a.id, limit: 5 });
  const f = r.files.find((x) => x.name.toLowerCase() === String(parent).toLowerCase()) ?? r.files[0];
  if (!f) throw new Error(`I couldn't find a folder called "${parent}" in ${google.labelOf(a)}.`);
  return { id: f.id, name: f.name };
}
const MIME_BY_EXT = { ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json", ".html": "text/html", ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".wav": "audio/wav", ".zip": "application/zip" };
// upload({ path | (name + text), folder, account, confirm_token }) — a file from this computer (it must be one Dayspring may
// read) or text Dayspring wrote ("save this to my Drive")
export async function upload(input = {}) {
  const a = writable(input.account);
  let buf, name, source = null;
  if (input.path) {
    const k = permissions.check("read", input.path);
    if (!k.ok) { activity.log("blocked", { path: String(input.path), reason: k.reason, text: k.text, via: "drive_upload" }); return { denied: true, text: k.text }; }
    if (!existsSync(k.real) || !statSync(k.real).isFile()) return { error: `I can't find ${input.path}.` };
    if (statSync(k.real).size > 100 * 1024 * 1024) return { error: "That file is over 100 MB. Upload it with Drive itself." };
    buf = await readFile(k.real); name = String(input.name || basename(k.full)); source = k.full;
  } else if (input.text != null) { buf = Buffer.from(String(input.text), "utf8"); name = String(input.name || "Dayspring note.txt"); }
  else return { error: "Give a file on this computer (path) or the text to save." };
  name = name.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 200) || "Untitled";
  const folder = await folderRef(a, input.folder);
  const sha = activity._sha(buf);
  const stop = ask({ tool: "drive_upload", account: a.id, name, parent: folder.id, sha }, `Upload ${name} (${Math.max(1, Math.round(buf.length / 1024))} KB) to ${folder.name} in ${google.labelOf(a)}? Should I go ahead?`, input);
  if (stop) return stop;
  const mime = input.mimeType || MIME_BY_EXT[extname(name).toLowerCase()] || "application/octet-stream";
  const boundary = "ds" + Date.now().toString(36);
  const meta = { name, parents: [folder.id], ...(input.convert && /\.(docx|txt|md)$/i.test(name) ? { mimeType: DOC } : {}) };
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--`)]);
  const f = await call(a, "POST", "/files", { base: UPLOAD(), query: { uploadType: "multipart", supportsAllDrives: "true", fields: FIELDS }, body, headers: { "content-type": `multipart/related; boundary=${boundary}` }, timeout: 120_000 });
  activity.log("drive.upload", { account: a.email, name, fileId: f.id, folder: folder.name, size: buf.length, sha256: sha, path: source ?? undefined, result: "ok" });
  return { uploaded: name, to: folder.name, drive: google.labelOf(a), file: shape(f, a) };
}
export async function mkdir(input = {}) {
  const a = writable(input.account);
  const name = String(input.name ?? "").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 200);
  if (!name) return { error: "What should the folder be called?" };
  const folder = await folderRef(a, input.parent);
  const stop = ask({ tool: "drive_mkdir", account: a.id, name, parent: folder.id }, `Make a folder called ${name} in ${folder.name} (${google.labelOf(a)})? Should I go ahead?`, input);
  if (stop) return stop;
  const f = await call(a, "POST", "/files", { query: { supportsAllDrives: "true", fields: FIELDS }, body: { name, mimeType: FOLDER, parents: [folder.id] } });
  activity.log("drive.mkdir", { account: a.email, name, fileId: f.id, folder: folder.name, result: "ok" });
  return { created: name, in: folder.name, drive: google.labelOf(a), file: shape(f, a) };
}
// move (to another folder) and/or rename
export async function move(input = {}) {
  const { a: owner, fileId } = parseRef(input.file ?? input.ref ?? input.id, input.account);
  const a = writable(owner.id);
  const f = await info(`${a.id}:${fileId}`);
  const to = input.to ? await folderRef(a, input.to) : null;
  const rename = input.rename ? String(input.rename).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 200) : null;
  if (!to && !rename) return { error: "Where should it go (a folder), or what should it be called?" };
  const what = [to ? `move ${f.name} to ${to.name}` : null, rename ? `${to ? "and " : ""}rename it to ${rename}` : null].filter(Boolean).join(" ");
  const stop = ask({ tool: "drive_move", account: a.id, fileId, to: to?.id ?? null, rename }, `In ${google.labelOf(a)}: ${what}? Nothing is deleted, and it can be moved back. Should I go ahead?`, input);
  if (stop) return stop;
  const query = { supportsAllDrives: "true", fields: FIELDS, ...(to ? { addParents: to.id, removeParents: (f.parents ?? []).join(",") } : {}) };
  const out = await call(a, "PATCH", `/files/${encodeURIComponent(fileId)}`, { query, body: rename ? { name: rename } : {} });
  activity.log("drive.move", { account: a.email, fileId, from: f.name, to: to?.name ?? null, rename: rename ?? undefined, result: "ok" });
  return { moved: f.name, ...(to ? { to: to.name } : {}), ...(rename ? { renamed: rename } : {}), file: shape(out, a) };
}
// to Drive's trash only (restorable there for 30 days); always asks
export async function trash(input = {}) {
  const { a: owner, fileId } = parseRef(input.file ?? input.ref ?? input.id, input.account);
  const a = writable(owner.id);
  const f = await info(`${a.id}:${fileId}`);
  const stop = ask({ tool: "drive_trash", account: a.id, fileId }, `Move ${f.name} to the trash in ${google.labelOf(a)}? It stays in Drive's trash for 30 days, so it can be restored. Are you sure?`, input);
  if (stop) return stop;
  await call(a, "PATCH", `/files/${encodeURIComponent(fileId)}`, { query: { supportsAllDrives: "true", fields: "id,trashed" }, body: { trashed: true } });
  activity.log("drive.trash", { account: a.email, fileId, file: f.name, result: "ok", recoverable: "Drive trash, 30 days" });
  return { trashed: f.name, drive: google.labelOf(a), restore: "It's in Drive's trash for 30 days (drive.google.com → Trash → Restore)." };
}
// download a Drive file into a folder on this computer: file permission (create) and the owner's yes
const EXPORT_AS = { [DOC]: [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], [SHEET]: [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], [SLIDES]: [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"] };
export async function download(input = {}) {
  const { a, fileId } = parseRef(input.file ?? input.ref ?? input.id, input.account);
  const f = await info(`${a.id}:${fileId}`);
  if (f.kind === "folder") return { error: "That's a folder. Download the files in it one at a time." };
  const exp = EXPORT_AS[f.mimeType];
  if (!exp && /^application\/vnd\.google-apps\./.test(f.mimeType)) return { error: `A ${f.mimeType.split(".").pop()} can't be downloaded. Open it in Drive: ${f.link ?? ""}` };
  const dir = input.to ? resolve(String(input.to)) : resolve(process.env.USERPROFILE ?? ".", "Downloads");
  const name = (f.name.replace(/[\\/:*?"<>|]+/g, "-") + (exp && !f.name.toLowerCase().endsWith(exp[0]) ? exp[0] : "")).slice(0, 200);
  const dest = join(dir, name);
  const k = permissions.check("create", dest, { kind: "file" });
  if (!k.ok) { activity.log("blocked", { path: dest, reason: k.reason, text: k.text, via: "drive_download" }); return { denied: true, text: k.text }; }
  if (existsSync(k.real)) return { error: `${name} is already in ${dir}. Pick another folder, or rename the one that's there.` };
  const stop = ask({ tool: "drive_download", account: a.id, fileId, dest: k.real.toLowerCase() }, `Download ${f.name}${f.size ? ` (${Math.max(1, Math.round(f.size / 1024))} KB)` : ""} from ${google.labelOf(a)} into ${dir}? Should I go ahead?`, input);
  if (stop) return stop;
  const res = exp ? await call(a, "GET", `/files/${encodeURIComponent(fileId)}/export`, { query: { mimeType: exp[1] }, raw: true, timeout: 300_000 })
    : await call(a, "GET", `/files/${encodeURIComponent(fileId)}`, { query: { alt: "media", supportsAllDrives: "true" }, raw: true, timeout: 300_000 });
  if (!res.ok) throw await driveError(res);
  mkdirSync(dirname(k.real), { recursive: true });
  const tmp = k.real + ".dayspring-download";
  try { await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp)); renameSync(tmp, k.real); }
  catch (e) { rmSync(tmp, { force: true }); activity.log("file.create", { path: k.real, via: "drive_download", result: "error", error: e.message }); throw e; }
  const fp = activity.fingerprint(k.real);
  activity.log("file.create", { path: k.real, via: "drive_download", tool: "drive_download", sizeAfter: fp?.size ?? null, sha256After: fp?.sha256 ?? null, from: `${a.email} Drive: ${f.name}`, result: "ok" });
  return { downloaded: f.name, to: k.real, size: fp?.size ?? null };
}
