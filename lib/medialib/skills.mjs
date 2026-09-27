// The owner's own music and videos (lib/medialib) and Google Drive (lib/connectors/drive.mjs), by voice and for the AI.
//   command(text)   no AI needed: "play the song Holy Forever from my computer", "play my Johnny Cash mp3s", "find the video
//                   from Sarah's wedding", "play the latest video in Downloads", "shuffle my music folder", "what audio files
//                   do I have from 2019", "play … from my work drive", "what changed in my Drive this week", "search my Drive
//                   for the budget", then "number 2", "play them all", "open it in the default app", "yes".
//   tools() / runTool()   media_library_search / media_library_play, drive_search / drive_read / drive_play / drive_show /
//                   drive_recent / drive_download, and — only when a Drive allows changes — drive_upload / drive_mkdir /
//                   drive_move / drive_trash. Accounts are chosen by label ("work", "personal", an email).
// Results show on the Dayspring screen as a numbered list (public/medialib.js); the reply stays short.
// It also registers "local" (your computer) and "drive" (Google Drive) as music sources (lib/music/sources.mjs), so a
// plain "play Holy Forever" can find his own file too, and "…from my computer" asks only it.
import * as library from "./library.mjs";
import * as player from "./player.mjs";
import { parse, followUp, OPEN_DEFAULT, LOCAL_RE, DRIVE_RE } from "./phrases.mjs";
import * as drive from "../connectors/drive.mjs";
import * as google from "../connectors/google.mjs";
import * as confirm from "../confirm.mjs";
import { broadcast } from "../bus.mjs";

const plural = (n, w, ws = w + "s") => `${n} ${n === 1 ? w : ws}`;
const listWords = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const FRESH = 3 * 60_000;

// ---- the list on the screen ---------------------------------------------------------------------------------------------
let shown = null;        // { at, items, title }
export const lastShown = () => (shown && Date.now() - shown.at < FRESH ? shown : null);
function row(x, n) {
  const mins = x.duration ? (x.duration >= 3600 ? `${Math.floor(x.duration / 3600)}:${String(Math.floor((x.duration % 3600) / 60)).padStart(2, "0")}:${String(x.duration % 60).padStart(2, "0")}` : `${Math.floor(x.duration / 60)}:${String(x.duration % 60).padStart(2, "0")}`) : "";
  return { n, id: x.id, title: x.title, detail: [x.artist, x.album, x.year].filter(Boolean).join(" · "), where: x.source === "drive" ? `${x.drive}'s Drive` : x.folder, kind: x.kind, time: mins, ext: x.ext, source: x.source ?? "local", playable: x.source === "drive" || !["wma", "wmv", "avi"].includes(x.ext) || player.canConvert() };
}
export function show(items, title) {
  shown = { at: Date.now(), items: items.slice(0, 30), title };
  broadcast("medialib", { list: { title, items: shown.items.map((x, i) => row(x, i + 1)) } });
}
export const closeList = () => { shown = null; broadcast("medialib", { close: true }); };

// ---- gathering: his computer first, then Drive (unless he named a Drive) ----------------------------------------------------
const tag = (xs) => xs.map((x) => ({ ...x, source: x.source ?? "local" }));
export async function gather(p, { limit = 30, withDrive = true } = {}) {
  const f = { kind: p.kind, year: p.year, folder: p.folder, ext: p.ext, latest: p.latest, limit };
  const local = p.source === "drive" ? [] : tag(library.search(p.query, f));
  let fromDrive = [];
  if (withDrive && p.source !== "local" && !p.folder && drive.connected() && (p.query || p.source === "drive" || p.latest)) {
    try {
      const got = await drive.media(p.query, { account: p.drive ?? undefined, kind: p.kind ?? "media", limit });
      fromDrive = p.query ? library.search(p.query, { ...f, folder: null, list: got }) : got.filter((x) => !p.year || x.year === p.year);
      if (p.ext) fromDrive = fromDrive.filter((x) => p.ext.includes(x.ext));
    } catch (e) { if (p.source === "drive") throw e; }
  }
  // his files first (a named Drive puts that Drive's first); within each, the best match first
  return p.source === "drive" ? fromDrive : [...local, ...fromDrive.map((x) => ({ ...x, score: (x.score ?? 0.5) * 0.97 }))];
}
const plan = (p) => /\b(all|them|every|mp3s|songs|videos|files|folder|albums?)\b/.test(p.raw) || p.action === "shuffle" || (!p.query && !p.latest);

// ---- no AI needed ------------------------------------------------------------------------------------------------------------
// → { reply, suggest?, listen? } or null (not about his files)
export async function command(text, { surface = "tv" } = {}) {
  const t = String(text ?? "").trim();
  if (!t || surface === "call") return null;
  // 1. an answer to "Want me to open it in your default player?"
  const pend = player.pending();
  if (pend && (confirm.isYes(t) || OPEN_DEFAULT.test(t.toLowerCase()))) { const r = player.openDefault(pend.item, { owner: true }); return { reply: r.opened ? `Opening ${pend.item.title} in your default player.` : r.text ?? r.error }; }
  if (pend && confirm.isNo(t)) { player.clearPending(); return { reply: "Okay." }; }
  // 2. "open it in the default app" about what's playing or was just found
  if (OPEN_DEFAULT.test(t.toLowerCase())) {
    const cur = current ?? lastShown()?.items[0];
    if (cur) { const r = player.openDefault(cur); return { reply: r.opened ? `Opening ${cur.title} in your default player.` : r.needsConfirm ? r.text : r.text ?? r.error, ...(r.needsConfirm ? { listen: true } : {}) }; }
  }
  // 3. a pick from the list on the screen (only while it's the newest question on the screen)
  const ls = lastShown();
  if (ls) {
    const f = followUp(t);
    const music = (await import("../music/index.mjs").catch(() => null))?.lastSession?.();
    if (f && !(music?.asking && music.at > ls.at)) {
      if (f.close) { closeList(); return { reply: "Okay." }; }
      if (f.all) return playReply(ls.items, { shuffle: f.shuffle });
      if (f.pick) { const x = ls.items[f.pick - 1]; if (!x) return { reply: `There ${ls.items.length === 1 ? "is only 1 file" : `are only ${ls.items.length} files`} on the list.` }; return playReply([x]); }
    }
  }
  // 4. Drive by voice
  const dq = t.toLowerCase().replace(/[?.!,]/g, "").trim();
  let m;
  if (/\b(what(?:'s| has| have)? changed|what'?s new|recent(?:ly)? (?:changed|edited)|anything new) in (?:my |the )?(?:(\w+) )?(?:google )?drive\b/.test(dq) || /\bmy recent (?:google )?drive files\b/.test(dq)) {
    if (!drive.connected()) return { reply: "Google Drive isn't connected yet. You can connect it in Settings, under Apps, then Google." };
    const who = /in (?:my |the )?(\w+) (?:google )?drive/.exec(dq)?.[1];
    const days = /\btoday\b/.test(dq) ? 1 : /\bmonth\b/.test(dq) ? 30 : 7;
    const r = await drive.changes({ days, account: who && !/^(google|my)$/.test(who) ? who : undefined });
    if (r.files.length) showDrive(r.files, `Changed in the last ${plural(days, "day")}`);
    return { reply: r.files.length ? `${r.summary} The newest: ${r.files.slice(0, 3).map((f) => f.name).join(", ")}.` : r.summary };
  }
  if ((m = /^(?:search|look in|look through|check) (?:my |the )?(?:(\w+) )?(?:google )?drive for (.+)$/.exec(dq)) || (m = /^find (.+?) (?:in|on) (?:my |the )?(?:(\w+) )?(?:google )?drive$/.exec(dq))) {
    if (!drive.connected()) return { reply: "Google Drive isn't connected yet. You can connect it in Settings, under Apps, then Google." };
    const [who, what] = dq.startsWith("find") ? [m[2], m[1]] : [m[1], m[2]];
    const r = await drive.search({ query: what.replace(/\b(the|my|a|an|file|files|document|doc)\b/g, " ").trim(), account: who && !/^(google|my)$/.test(who) ? who : undefined, limit: 20 });
    if (!r.files.length) return { reply: `Nothing in ${r.drives.length > 1 ? "your Drives" : "your Drive"} matches “${what}”.` };
    showDrive(r.files, `In Drive: ${what}`);
    return { reply: `I found ${plural(r.files.length, "file")} in ${r.drives.length > 1 ? "your Drives" : "your Drive"}: ${r.files.slice(0, 3).map((f, i) => `${i + 1}, ${f.name}${r.drives.length > 1 ? ` (${f.drive})` : ""}`).join("; ")}.` };
  }
  // 5. his music and videos
  const p = parse(t);
  if (!p) return null;
  const st = library.status();
  if (p.source === "local" && st.off) return { reply: `I can't look at your files yet. ${st.how}` };
  if (p.source === "drive" && !drive.connected()) return { reply: "Google Drive isn't connected yet. You can connect it in Settings, under Apps, then Google. Then say it again." };
  let found;
  // (Google Drive is asked only when the words are clearly about his own files: no network wait for "find a video on cooking")
  try { found = await gather(p, { withDrive: p.explicit }); } catch (e) { return p.explicit ? { reply: e.message } : null; }
  const best = found[0];
  // not clearly about his own files: only when there's a good match (otherwise Spotify / YouTube / the AI take it)
  if (!p.explicit && (!best || (p.action === "play" ? !(p.query && best.score >= 1) : best.score < 0.8))) return null;
  if (st.off && p.source !== "drive" && !found.length) return { reply: `I can't look at your files yet. ${st.how}` };
  const what = p.kind === "video" ? "videos" : p.kind === "audio" ? "songs" : "files";
  const where = p.source === "drive" ? (p.drive ? `your ${p.drive} Drive` : "your Google Drive") : p.folder ? `your ${p.folder[0].toUpperCase() + p.folder.slice(1)} folder` : "your computer";
  if (!found.length) {
    const more = !st.off && p.source !== "drive" && st.roots.length ? ` I looked in ${listWords(st.roots.map((r) => r.split(/[\\/]/).pop()))}.` : "";
    const scanning = st.scanning ? " I'm still going through your folders, so try again in a minute." : "";
    return { reply: `I couldn't find ${p.query ? `“${p.said || p.query}”` : `any ${p.kind === "audio" ? "audio files" : p.kind === "video" ? "videos" : "music or videos"}`}${p.year ? ` from ${p.year}` : ""} on ${where}.${more}${scanning}` };
  }
  if (p.action === "list" || p.action === "find") {
    show(found, p.action === "list" ? `Your ${p.kind === "video" ? "videos" : p.kind === "audio" ? "audio files" : "music and videos"}${p.year ? ` from ${p.year}` : ""}` : `Found: ${p.query || what}`);
    const n = found.length >= 30 ? "at least 30" : String(found.length);
    return { reply: `I found ${n} ${found.length === 1 ? what.replace(/s$/, "") : what}${p.year ? ` from ${p.year}` : ""}: ${found.slice(0, 3).map((x, i) => `${i + 1}, ${library.describe(x)}${x.source === "drive" ? ` (${x.drive}'s Drive)` : ""}`).join("; ")}. Say a number to play one${found.length > 1 ? ", or “play them all”" : ""}.`, listen: true };
  }
  // play / shuffle
  if (plan(p)) {
    const all = p.query ? found.filter((x) => x.score >= best.score * 0.6) : await gather(p, { limit: 200, withDrive: p.source === "drive" });
    return playReply(p.latest ? all : [...all].sort(library.natural), { shuffle: p.action === "shuffle" });
  }
  // one thing: the best match, unless a few are about as good (then ask)
  const close = found.filter((x) => x.score >= best.score - 0.04).slice(0, 5);
  if (close.length > 1 && best.score < 1.2 && !p.latest) {
    show(found.slice(0, 10), `Which one?`);
    return { reply: `I found a few: ${close.slice(0, 3).map((x, i) => `${i + 1}, ${library.describe(x, { long: true })}`).join("; ")}. Which one?`, listen: true };
  }
  return playReply([best]);
}
let current = null;
function playReply(items, opts = {}) {
  const r = player.play(items, { ...opts, via: "voice" });
  if (r.error) return { reply: r.error };
  if (r.unplayable) return { reply: r.reply, listen: true };
  current = items[r.cmd.index] ?? items[0];
  broadcast("medialib", { close: true });
  return { reply: r.reply, played: true };
}
function showDrive(files, title) {
  shown = { at: Date.now(), items: files.map((f) => ({ id: `d:${f.ref}`, ref: f.ref, source: "drive", kind: f.kind, title: f.name, name: f.name, drive: f.drive, accountLabel: f.accountLabel, duration: f.duration, ext: (f.name.split(".").pop() ?? "").toLowerCase(), folder: f.drive })), title };
  broadcast("medialib", { list: { title, items: shown.items.map((x, i) => ({ ...row(x, i + 1), detail: [files[i].kind, files[i].modified?.slice(0, 10), files[i].owner].filter(Boolean).join(" · "), playable: ["audio", "video", "image"].includes(files[i].kind) })) } });
}
// the screen's own clicks on the list (routes.mjs)
export function playFromList(n, { all = false, shuffle = false } = {}) {
  const ls = shown;
  if (!ls) return { error: "That list is gone. Ask again." };
  if (all) return playReply(ls.items, { shuffle });
  const x = ls.items[Number(n) - 1];
  if (!x) return { error: "That number isn't on the list." };
  if (x.source === "drive" && x.kind === "image") { broadcast("medialib", { image: { src: `/api/drive/stream?ref=${encodeURIComponent(x.ref)}`, title: x.title } }); return { reply: `Here's ${x.title}.` }; }
  if (x.source === "drive" && !["audio", "video"].includes(x.kind)) return { error: "That one isn't something to play. Ask me to read it instead." };
  return playReply([x]);
}
export function openFromList(n) {
  const x = shown?.items[Number(n) - 1];
  if (!x) return { error: "That number isn't on the list." };
  return player.openDefault(x, { owner: true, via: "screen" });
}

// ---- the AI's tools -----------------------------------------------------------------------------------------------------------
const ACCOUNT = { type: "string", description: "Only this Google account's Drive, by its label (\"work\", \"personal\") or email. Omit for every connected Drive." };
const TOKEN = { confirm_token: { type: "string", description: "Only after the owner said yes: the confirm_token from the needsConfirm result" } };
const ASKS = " If the result has needsConfirm, say its text to the owner and wait; only after a clear yes call again with the same arguments plus confirm_token.";
const LIB_TOOLS = [
  { name: "media_library_search", description: "Search the owner's OWN music and videos: files on this computer (Music, Videos, Downloads and the folders file access allows) and, when connected, Google Drive. Finds by title, artist, album, genre, file name and folder; filters by kind, year, folder, file type, newest. Shows a numbered list on the Dayspring screen. Use for \"play/find … from my computer\", \"my mp3s\", \"the video from Sarah's wedding\", \"what audio files do I have from 2019\". Local files come first unless a Drive is named.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "title / artist / album / words from the file or folder name (may be empty with filters)" }, kind: { type: "string", enum: ["audio", "video"] }, year: { type: "integer" }, folder: { type: "string", description: "e.g. Downloads, Music, Videos" }, ext: { type: "string", description: "file type, e.g. mp3" }, latest: { type: "boolean", description: "newest first" }, source: { type: "string", enum: ["computer", "drive", "all"] }, drive: ACCOUNT, show: { type: "boolean", description: "show the list on the screen (default true)" }, limit: { type: "integer" } } } },
  { name: "media_library_play", description: "Play the owner's own music or videos on the Dayspring screen (audio with the normal music controls, a queue, shuffle and repeat; video full screen), or open one in this PC's default app (where: \"pc\", needs the Programs permission). Give ids from media_library_search, or a query to play the best match. Formats the screen can't play (WMA, WMV, AVI) are converted when ffmpeg is available; otherwise offer the default app." + ASKS,
    input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, query: { type: "string" }, kind: { type: "string", enum: ["audio", "video"] }, folder: { type: "string" }, year: { type: "integer" }, ext: { type: "string" }, latest: { type: "boolean" }, source: { type: "string", enum: ["computer", "drive", "all"] }, drive: ACCOUNT, all_matches: { type: "boolean", description: "play every match (e.g. all his Johnny Cash mp3s)" }, shuffle: { type: "boolean" }, repeat: { type: "string", enum: ["off", "all", "one"] }, where: { type: "string", enum: ["screen", "pc"] }, ...TOKEN } } },
];
const DRIVE_READ_TOOLS = [
  { name: "drive_search", description: "Search the owner's Google Drive (every connected Drive at once, or one by account label). By name words, full text, type, owner, modified dates, starred, shared with me; shared drives are included. Returns files with ref (use it with the other drive_ tools) and which Drive each is in. Shows a list on the screen.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "words in the file name" }, text: { type: "string", description: "words inside the file (full-text search)" }, type: { type: "string", enum: drive.TYPES }, owner: { type: "string", description: "\"me\", \"others\", or an email" }, after: { type: "string", description: "modified after YYYY-MM-DD" }, before: { type: "string", description: "modified before YYYY-MM-DD" }, starred: { type: "boolean" }, shared_with_me: { type: "boolean" }, shared_drives: { type: "boolean", description: "include shared drives (default true)" }, account: ACCOUNT, limit: { type: "integer" }, show: { type: "boolean" } } } },
  { name: "drive_recent", description: "The owner's recently changed Google Drive files (\"what changed in my Drive this week\"), newest first, across every connected Drive or one.", input_schema: { type: "object", properties: { days: { type: "integer", description: "default 7" }, account: ACCOUNT } } },
  { name: "drive_read", description: "Read a Drive file's text (Google Docs, Sheets as CSV, Slides, PDFs, Word and text files) to summarise it or read it aloud. Use a ref from drive_search. Long files come in parts: pass from to continue. Never invent content.", input_schema: { type: "object", properties: { file: { type: "string", description: "ref from drive_search" }, from: { type: "integer" } }, required: ["file"] } },
  { name: "drive_play", description: "Play audio or video stored in Google Drive on the Dayspring screen (streamed through Dayspring, following its speaker). Give a ref, or a query to play the best match.", input_schema: { type: "object", properties: { file: { type: "string" }, query: { type: "string" }, kind: { type: "string", enum: ["audio", "video"] }, account: ACCOUNT, shuffle: { type: "boolean" } } } },
  { name: "drive_show", description: "Show a picture from Google Drive on the Dayspring screen; describe: true also describes it (people are described, never identified).", input_schema: { type: "object", properties: { file: { type: "string" }, describe: { type: "boolean" } }, required: ["file"] } },
  { name: "drive_download", description: "Download a Drive file into a folder on this computer (Google Docs/Sheets/Slides become Word/Excel/PowerPoint files). Needs file permission to create files there, and always asks the owner first." + ASKS, input_schema: { type: "object", properties: { file: { type: "string" }, to: { type: "string", description: "folder on this computer (default Downloads)" }, ...TOKEN }, required: ["file"] } },
];
const DRIVE_WRITE_TOOLS = [
  { name: "drive_upload", description: "Save to the owner's Google Drive: a file from this computer (path) or text you wrote (name + text), into a folder (name or ref; default My Drive). Only for a Drive that allows changes; always asks first." + ASKS, input_schema: { type: "object", properties: { path: { type: "string" }, name: { type: "string" }, text: { type: "string" }, folder: { type: "string" }, convert: { type: "boolean", description: "make it a Google Doc" }, account: ACCOUNT, ...TOKEN } } },
  { name: "drive_mkdir", description: "Make a folder in the owner's Google Drive (inside parent: a folder name or ref; default My Drive). Always asks first." + ASKS, input_schema: { type: "object", properties: { name: { type: "string" }, parent: { type: "string" }, account: ACCOUNT, ...TOKEN }, required: ["name"] } },
  { name: "drive_move", description: "Move a Drive file to another folder and/or rename it. Always asks first." + ASKS, input_schema: { type: "object", properties: { file: { type: "string" }, to: { type: "string", description: "folder name or ref" }, rename: { type: "string" }, ...TOKEN }, required: ["file"] } },
  { name: "drive_trash", description: "Move a Drive file to Drive's trash (restorable for 30 days; nothing is deleted for good). Always asks first." + ASKS, input_schema: { type: "object", properties: { file: { type: "string" }, ...TOKEN }, required: ["file"] } },
];
export const ALL_TOOLS = [...LIB_TOOLS, ...DRIVE_READ_TOOLS, ...DRIVE_WRITE_TOOLS];
const NAMES = new Set(ALL_TOOLS.map((t) => t.name));
// what the AI is offered right now: Drive tools only with a Drive connected, changing ones only when a Drive allows it
export function tools() {
  let d = false, w = false;
  try { d = drive.connected(); w = d && drive.anyWrite(); } catch { /* not set up */ }
  return [...LIB_TOOLS, ...(d ? DRIVE_READ_TOOLS : []), ...(w ? DRIVE_WRITE_TOOLS : [])];
}
const srcOf = (s) => (s === "computer" ? "local" : s === "drive" ? "drive" : "any");
const P = (i) => ({ action: "find", kind: i.kind ?? null, query: String(i.query ?? ""), source: i.drive ? "drive" : srcOf(i.source), drive: i.drive ?? null, folder: i.folder ? String(i.folder).toLowerCase() : null, year: i.year ?? null, ext: i.ext ? [String(i.ext).toLowerCase().replace(/^\./, "")] : null, latest: Boolean(i.latest), raw: "" });
const brief = (x) => ({ id: x.id, title: x.title, artist: x.artist || undefined, album: x.album || undefined, year: x.year ?? undefined, kind: x.kind, duration: x.duration ?? undefined, where: x.source === "drive" ? `${x.drive}'s Drive` : x.folder, format: x.ext, score: x.score });
export async function runTool(name, i = {}) {
  if (!NAMES.has(name)) return undefined;
  if (name.startsWith("drive_") && !tools().some((t) => t.name === name)) return { error: DRIVE_WRITE_TOOLS.some((t) => t.name === name) ? "No connected Drive allows changes. The owner can turn on \"Let Dayspring add and change files in this Drive\" in Settings → Apps → Google." : "Google Drive isn't connected. The owner can connect it in Settings → Apps → Google." };
  try {
    switch (name) {
      case "media_library_search": {
        const st = library.status();
        const p = P(i);
        const found = await gather(p, { limit: Math.min(50, Number(i.limit) || 20) });
        if (i.show !== false && found.length) show(found, i.query ? `Found: ${i.query}` : "Your music and videos");
        return { count: found.length, results: found.slice(0, Math.min(50, Number(i.limit) || 20)).map(brief), ...(st.off ? { note: `File access is off, so only Drive was searched. ${st.how}` } : {}), ...(st.scanning ? { note: "Still indexing the folders; more may turn up in a minute." } : {}), shownOnScreen: i.show !== false && found.length > 0 };
      }
      case "media_library_play": {
        let items = (i.ids ?? []).map((id) => (String(id).startsWith("d:") ? lastShown()?.items.find((x) => x.id === id) ?? null : library.byId(id))).filter(Boolean);
        if (!items.length) {
          const p = P(i);
          const found = await gather(p, { limit: i.all_matches || i.shuffle ? 200 : 10 });
          items = i.all_matches || i.shuffle || (!p.query && !p.latest) ? found : found.slice(0, 1);
        }
        if (!items.length) return { error: library.status().off ? `File access is off. ${library.status().how}` : "Nothing in the owner's music or videos matched." };
        if (i.where === "pc") { const r = player.openDefault(items[0], { confirm_token: i.confirm_token, via: "ai" }); return r; }
        const r = player.play(items, { shuffle: Boolean(i.shuffle), repeat: i.repeat ?? "off", via: "ai" });
        if (r.cmd) { current = items[r.cmd.index]; broadcast("medialib", { close: true }); }
        return r.cmd ? { playing: r.cmd.queue.map((q) => q.title).slice(0, 10), count: r.cmd.queue.length, say: r.reply } : r;
      }
      case "drive_search": {
        const r = await drive.search({ query: i.query, text: i.text, type: i.type, owner: i.owner, after: i.after, before: i.before, starred: i.starred, sharedWithMe: i.shared_with_me, sharedDrives: i.shared_drives, account: i.account, limit: i.limit });
        if (i.show !== false && r.files.length) showDrive(r.files, `In Drive${i.query || i.text ? `: ${i.query || i.text}` : ""}`);
        return r;
      }
      case "drive_recent": { const r = await drive.changes({ days: i.days ?? 7, account: i.account }); if (r.files.length) showDrive(r.files, `Changed in the last ${plural(r.days, "day")}`); return r; }
      case "drive_read": return await drive.read(i.file, { from: i.from });
      case "drive_play": {
        let items;
        if (i.file) { const f = await drive.info(i.file); if (!["audio", "video"].includes(f.kind)) return { error: `${f.name} isn't audio or video.${f.kind === "image" ? " Use drive_show for pictures." : ""}` }; items = [{ id: `d:${f.ref}`, ref: f.ref, source: "drive", kind: f.kind, title: f.name.replace(/\.[a-z0-9]{2,4}$/i, ""), name: f.name, drive: f.drive, accountLabel: f.accountLabel, duration: f.duration, ext: (f.name.split(".").pop() ?? "").toLowerCase() }]; }
        else { const found = await gather({ ...P({ ...i, source: "drive", drive: i.account }), source: "drive" }, { limit: 50 }); items = i.shuffle ? found : found.slice(0, 1); }
        if (!items.length) return { error: "Nothing in Drive matched." };
        const r = player.play(items, { shuffle: Boolean(i.shuffle), via: "ai" });
        return r.cmd ? { playing: r.cmd.queue.map((q) => q.title).slice(0, 10), say: r.reply } : r;
      }
      case "drive_show": {
        const f = await drive.info(i.file);
        if (f.kind !== "image") return { error: `${f.name} isn't a picture.` };
        broadcast("medialib", { image: { src: `/api/drive/stream?ref=${encodeURIComponent(f.ref)}`, title: f.name } });
        if (!i.describe) return { shown: f.name };
        const { describeImage } = await import("../vision/describe.mjs");
        const res = await google.authFetch(f.account, `${process.env.DRIVE_BASE || "https://www.googleapis.com/drive/v3"}/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`);
        if (!res.ok) return { shown: f.name, error: "I couldn't fetch it to describe it." };
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 12 * 1024 * 1024) return { shown: f.name, note: "It's too big to describe." };
        const d = await describeImage(buf, { source: "web" });
        return { shown: f.name, description: d.text, text: d.ocr?.text || undefined };
      }
      case "drive_download": return await drive.download({ file: i.file, to: i.to, confirm_token: i.confirm_token });
      case "drive_upload": return await drive.upload(i);
      case "drive_mkdir": return await drive.mkdir(i);
      case "drive_move": return await drive.move(i);
      case "drive_trash": return await drive.trash(i);
    }
  } catch (e) { return e.denied ? { denied: true, text: e.message } : { error: e.message }; }
  return undefined;
}
export function contextText() {
  const st = library.status();
  const d = (() => { try { return drive.connected() ? google.accountsFor("drive").map((a) => `${google.labelOf(a)}${google.canWriteDrive(a) ? " (may change files, asking first)" : " (look only)"}`) : []; } catch { return []; } })();
  return `The owner's own music and videos: ${st.off ? "file access is off, so none on this computer (" + st.how + ")" : `${st.audio} audio files and ${st.video} videos indexed on this computer`}${d.length ? `; Google Drive: ${d.join(", ")}` : ""}. Use media_library_search / media_library_play for them (and drive_* for Drive files); results show on the screen, so keep the spoken reply short.`;
}

// ---- music sources: his computer and Google Drive (lib/music/sources.mjs) ----------------------------------------------------
const wordsOf = (req) => [req.title, req.artist].filter(Boolean).join(" ") || req.album || req.name || req.query || req.raw || "";
const asCandidate = (x, scale = 1) => ({ type: "track", name: x.title, by: x.artist || (x.source === "drive" ? `${x.drive}'s Drive` : ""), id: x.id, uri: x.source === "drive" ? `drive:${x.ref}` : `local:${x.id}`, play: { id: x.id }, item: x, score: Math.min(1.08, (x.score ?? 0) / 1.25) * scale });
async function sourceSearch(req, onlyDrive) {
  const q = wordsOf(req);
  if (!q.trim()) return [];
  const found = await gather({ action: "play", query: q, kind: "audio", source: onlyDrive ? "drive" : "local", drive: null, folder: null, year: null, ext: null, latest: false, raw: q }, { limit: 8, withDrive: onlyDrive });
  return found.filter((x) => x.score >= 0.6).map((x) => asCandidate(x, onlyDrive ? 0.97 : 1));
}
function sourcePlay(c) {
  const x = c.item ?? (String(c.id).startsWith("d:") ? null : library.byId(c.id));
  if (!x) { const e = new Error("That file isn't there anymore."); e.unplayable = true; throw e; }
  const r = player.play([x], { via: "music" });
  if (r.error || r.unplayable) { const e = new Error(r.error ?? r.reply); e.unplayable = true; throw e; }
  current = x;
  return { title: x.title, artist: x.artist ?? "" };
}
export async function registerSources() {
  try {
    const music = await import("../music/index.mjs");
    if (typeof music.registerSource !== "function") return false;
    music.registerSource({ id: "local", label: "your computer", phrases: LOCAL_RE, available: () => !library.status().off && library.items().length > 0, search: (req) => sourceSearch(req, false), play: (c) => sourcePlay(c), verify: async (c) => ({ ok: true, now: { name: c.name, by: c.by } }) });
    music.registerSource({ id: "drive", label: "Google Drive", phrases: DRIVE_RE, available: () => drive.connected(), search: (req) => sourceSearch(req, true), play: (c) => sourcePlay(c), verify: async (c) => ({ ok: true, now: { name: c.name, by: c.by } }) });
    return true;
  } catch (e) { console.log(`media library: couldn't join the music sources (${e.message})`); return false; }
}
