// Finding files by name and the file viewer (lib/finder, public/viewer.js), on made-up files in a temp folder (never the
// owner's): scripts/qa/file-fixtures.mjs makes pictures (JPEG with EXIF, PNG, GIF, WebP, BMP, SVG, a HEIF .heic), an MP4
// with captions, an MP3, a WMV, PDFs, Word, Excel, CSV, PowerPoint, Markdown, code, a zip and an unknown type.
//   1. the index: what's in it, what never is (secrets, private-looking names, "none" places, a junction outside), and
//      the incremental rescan
//   2. finding: 90+ ways of asking (typos, spoken numbers, underscores, kinds, dates, folders, the photo catalogue), with
//      the accuracy printed; one match opens, several make a list, none says what's close and where it looked
//   3. permissions: file access off, read-only, a place taken back, path tricks, a tampered index, secrets in a zip,
//      delete only with the permission and a yes
//   4. the AI's tools (file_find, file_open, file_show_in_folder) through a pretend Claude and a pretend Ollama, and the
//      no-AI intents
//   5. the viewer in headless Chrome (--mute-audio): every kind of file, and its controls (zoom, rotate, pages, PDF search,
//      read aloud, video seek and speed, CSV sort), voice while viewing, the list and the search box, delete with a yes
//   node scripts/qa/file-viewer.mjs            (FV_ONLY=find|perm|ai|ui to run one part)
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, extname, basename } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeFixtures } from "./file-fixtures.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHROME = process.env.QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ONLY = process.env.FV_ONLY || "";
const part = (p) => !ONLY || ONLY.split(",").includes(p);
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" && !ok ? "  (" + String(got).slice(0, 400) + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* not yet */ } await sleep(80); } return v; }

const TMP = mkdtempSync(join(tmpdir(), "ds-fileviewer-"));
const HOME = join(TMP, "home"), OUT = join(TMP, "Outside"), BIN = join(TMP, "recycle");
const VISION_EXE = join(DESK, "bin", "Dayspring Vision.exe");
Object.assign(process.env, {
  DAYSPRING_PERMISSIONS_FILE: join(TMP, "conf", "permissions.json"), DAYSPRING_ACTIVITY_DIR: join(TMP, "conf", "activity"),   // (not the folder the files are in: Dayspring guards the folder its permissions live in)
  DAYSPRING_FILEINDEX_FILE: join(TMP, "file-index.json"),
  DAYSPRING_FINDER_HOME: HOME, DAYSPRING_FINDER_DELAY_MS: "0", DAYSPRING_FILECAPTIONS_FILE: join(TMP, "captions.json"), DAYSPRING_PHOTOS_FILE: join(TMP, "photos.json"),
  DAYSPRING_MEDIALIB_FILE: join(TMP, "media-library.json"), DAYSPRING_MEDIALIB_HOME: HOME, DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"), DAYSPRING_CONNECTORS_DIR: join(TMP, "connectors"),
  DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_OPEN: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_TEST_RECYCLE: BIN, DAYSPRING_ABILITY_BACKUPS: join(TMP, "backups"), DAYSPRING_BACKUP_DIR: join(TMP, "note-backups"),
  DAYSPRING_NOTES_DIR: join(TMP, "notes"), DAYSPRING_AVATAR_DIR: join(TMP, "avatar"), DAYSPRING_LOOKS_FILE: join(TMP, "looks.json"), DAYSPRING_VISION_SETTINGS: join(TMP, "vision.json"), DAYSPRING_PEOPLE_DIR: join(TMP, "people"),
  DAYSPRING_INTENT_LEARNED: join(TMP, "learned.json"), DAYSPRING_INTENT_MISSES: join(TMP, "misses.json"), DAYSPRING_CHANNEL: "dev", DAYSPRING_FEATURE_SWITCHES: join(TMP, "switches.json"), DAYSPRING_FEATURE_STAGES: join(TMP, "stages.json"),
  DAYSPRING_ENV_FILE: join(TMP, "test.env"), DAYSPRING_TIMERS_FILE: join(TMP, "timers.json"), DS_FOLLOW_MARK: join(TMP, "follow.json"),
  ...(existsSync(VISION_EXE) ? { DAYSPRING_VISION_EXE: VISION_EXE } : {}),
});
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "AI_MODEL", "OLLAMA_URL", "OLLAMA_FALLBACK", "AI_AUTO_MODEL", "DAYSPRING_MODEL", "DAYSPRING_PHOTO_DIRS"]) delete process.env[k];
writeFileSync(process.env.DAYSPRING_ENV_FILE, "# test\n");
writeFileSync(join(TMP, "settings.json"), "{}");

console.log("making the test files…");
const { F } = await makeFixtures(HOME, OUT);
let junction = false;
try { symlinkSync(OUT, join(HOME, "Documents", "linked"), "junction"); junction = true; } catch { /* junctions need NTFS */ }
// the owner's own words about a photo (the photo catalogue, data/photos.json's shape)
const { createHash } = await import("node:crypto");
const pid = (p) => createHash("sha1").update(p.toLowerCase()).digest("hex").slice(0, 16);
writeFileSync(process.env.DAYSPRING_PHOTOS_FILE, JSON.stringify({ photos: { [pid(F.dsc)]: { status: "catalogued", description: "Sam fishing off the dock", category: "Family trip", tags: ["sam", "fishing", "dock"] }, [pid(F.img5783)]: { status: "hidden" } } }));
check("the test files were made (pictures, video, audio, PDFs, Office, text, code, zip, unknown)", Object.values(F).every(existsSync), Object.entries(F).filter(([, p]) => !existsSync(p)).map(([k]) => k).join(","));

const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
(await imp("lib/media.mjs"))._setPolicy?.({ videosAllowed: true });
const permissions = await imp("lib/permissions.mjs");
const activity = await imp("lib/activity.mjs");
const index = await imp("lib/finder/index.mjs");
const skills = await imp("lib/finder/skills.mjs");
const actions = await imp("lib/finder/actions.mjs");
const routes = await imp("lib/finder/routes.mjs");
const { parse } = await imp("lib/finder/query.mjs");
const bus = await imp("lib/bus.mjs");
const events = [];
bus.on((type, data) => { if (type === "viewer") events.push(data); });
const lastOpen = () => [...events].reverse().find((e) => e.open)?.open ?? null;
const lastList = () => [...events].reverse().find((e) => e.list !== undefined)?.list ?? null;
const idOf = (p) => index.idOf(p);
const DOCS = join(HOME, "Documents");
// "Only the places I pick", with the temp home's folders: the parts that reach other modules (the assistant's tools, the
// no-AI intents) never get "everything on this computer", which would let them walk the real profile
const allowHome = (access = "read", more = {}) => permissions.set({ files: "custom", entries: ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive"].map((f) => ({ path: join(HOME, f), kind: "folder", access })), choice: true, ...more });

// ---- 1. the index -------------------------------------------------------------------------------------------------------------
permissions.set({ files: "all", allAccess: "read", entries: [], choice: true });
index._reset(); skills._reset();
let scan = await index.scanNow();
const has = (p) => index.items().some((x) => x.path.toLowerCase() === p.toLowerCase());
{
  check("everything: the owner's folders are indexed (Documents, Pictures, Videos, Music, Downloads, Desktop, OneDrive)", [F.lease, F.img5782, F.wedding, F.song, F.invoice, F.plan, F.thesis].every(has), `${scan.items} items`);
  check("secrets are never indexed (passwords.txt, .env, id_rsa, a wallet)", ![F.passwords, F.env, F.idrsa, F.wallet].some(has));
  check("private-looking folders and names are never indexed (Taxes, insurance, Private)", ![F.taxes, F.insurance, F.privatePic].some(has));
  check("a folder outside the allowed places isn't indexed, and a junction to it isn't followed", !has(F.outside) && !index.items().some((x) => /[\\/]linked[\\/]/i.test(x.path)), junction ? "" : "(no junction here)");
  check("the index keeps names, sizes and dates only (no contents)", !readFileSync(process.env.DAYSPRING_FILEINDEX_FILE, "utf8").includes("monthly rent"));
  const again = await index.scanNow();
  check("a rescan reuses folders that didn't change (none listed again)", again.listed === 0 && again.reused > 5 && again.items === scan.items, JSON.stringify(again));
  writeFileSync(join(DOCS, "New Note.txt"), "new"); utimesSync(DOCS, new Date(), new Date(Date.now() + 5000));
  const third = await index.scanNow();
  check("…a folder that changed is listed again, and the new file is found", third.listed >= 1 && has(join(DOCS, "New Note.txt")), JSON.stringify(third));
}

// ---- 2. finding ----------------------------------------------------------------------------------------------------------------
if (part("find")) {
  // [what's said, expected]: "open:key" (opens that file), "top:key" (opens it, or it's in the first three of the list),
  // "none" (says it couldn't find it), "null" (not about a file: left for the rest of Dayspring), "notfound" (none or null)
  const CASES = [
    ["find my resume", "top:resume"], ["open my resume", "top:resume"], ["where's my resume", "top:resume"], ["find my resumee", "top:resume"], ["open my résumé", "top:resume"],
    ["find my resume from 2024", "top:resume"], ["open the word document called resume", "top:resume"], ["pull up my resume document", "top:resume"], ["find my 2024 resume", "top:resume"], ["find my resume on my computer", "top:resume"],
    ["open the PDF called lease agreement", "open:lease"], ["open the lease agreement", "top:lease"], ["find the lease", "top:lease"], ["open the leese agreement pdf", "top:lease"], ["find lease agrement", "top:lease"],
    ["show me the lease agreement in Documents", "open:lease"], ["find the signed lease in downloads", "top:leaseSigned"], ["open lease underscore agreement underscore signed", "open:leaseSigned"], ["open the lease pdf", "top:lease"], ["where did I put the lease in downloads", "top:leaseSigned"],
    ["show me the picture named IMG_5782", "open:img5782"], ["show me the picture named img underscore five seven eight two", "open:img5782"], ["open IMG 5782", "top:img5782"], ["open image fifty seven eighty two", "open:img5782"], ["open img5782.jpg", "open:img5782"],
    ["open the jpeg called IMG_5782", "open:img5782"], ["open IMG_0001", "open:heic"], ["find the photo named IMG five seven eight two", "open:img5782"],
    ["find the video from Sarah's wedding", "top:wedding"], ["open the video from sarahs wedding", "top:wedding"], ["find sara's wedding video", "top:wedding"], ["show me the wedding video", "top:wedding"], ["find the ceremony video", "top:wedding"],
    ["find the birthday toast video", "open:toast"],
    ["open last week's budget spreadsheet", "open:budget26"], ["find my budget spreadsheet", "top:budget26"], ["open the 2023 budget", "top:budget23"], ["find the budget from 2023", "open:budget23"], ["open budget twenty twenty six", "open:budget26"],
    ["find the budget spreadsheet in the Finance folder", "top:household"], ["find my excel files", "top:budget26"], ["open the budget from this week", "open:budget26"],
    ["find photos from the lake", "top:sunset"], ["show me pictures from lake tahoe", "top:sunset"], ["find the sunset picture", "top:sunset"], ["find my photos of Sam fishing", "top:dsc"], ["find my picture of the dock", "top:dsc"],
    ["find the birthday party photos", "top:bday1"], ["show me birthday party 002", "open:bday2"], ["find photos from 2024", "top:bday1"], ["find the pictures from June 2024", "top:bday1"], ["show me the birthday pictures from twenty twenty four", "top:bday1"],
    ["find my latest screenshot", "open:shot"], ["open the screenshot from last week", "open:shot"],
    ["open invoice 7731", "open:invoice"], ["find the invoice pdf in downloads", "open:invoice"], ["find invoice seven seven three one", "open:invoice"], ["look for the invoice", "top:invoice"], ["open the latest pdf", "open:invoice"], ["find pdfs from last month", "top:invoice"],
    ["open my grocery list", "open:grocery"], ["find the grocery list text file", "open:grocery"], ["open grocry list", "open:grocery"], ["find my todo list", "open:todo"],
    ["open the meeting notes", "open:notes"], ["find my meeting notes markdown", "open:notes"],
    ["open contacts.csv", "open:contacts"], ["find the contacts spreadsheet", "open:contacts"],
    ["find grandma's apple pie recipe", "open:pie"], ["open the apple pie document", "open:pie"],
    ["open app.js", "open:appjs"], ["find the python script called analysis", "open:py"], ["open config json", "open:json"],
    ["open the quarterly report presentation", "open:report"], ["find the quarterly report slides", "open:report"], ["open quartely report", "open:report"], ["open the powerpoint called quarterly report final", "open:report"],
    ["open old photos zip", "open:zip"], ["find the old photos archive", "open:zip"], ["open the mystery file", "open:unknown"],
    ["find my thesis draft", "open:thesis"], ["open thesis in onedrive", "open:thesis"],
    ["find the song holy forever", "open:song"], ["open holy forever mp3", "open:song"],
    ["open the project plan on my desktop", "open:plan"], ["open the logo gif", "open:gif"], ["open the scan of the drawing", "open:bmp"], ["find the banner picture", "open:webp"], ["open the diagram", "open:svg"],
    ["can you find the file called grocery list", "open:grocery"], ["please open the resume", "top:resume"], ["i want to see the sunset photo", "top:sunset"], ["bring up the lease agreement pdf", "open:lease"], ["show me the heic photo from my iphone folder", "top:heic"],
    ["find the pdf called quantum banana", "none"], ["open my tax return", "notfound"], ["find my passwords", "notfound"], ["open the car insurance pdf", "none"], ["find the outside plan", "notfound"], ["find the IMG_9999 picture", "none"],
    ["find a restaurant near me", "null"], ["what's the weather tomorrow", "null"], ["show me pictures of golden retrievers", "null"], ["play holy forever", "null"], ["find my keys", "null"],
    ["what's today's date", "null"], ["what time is it", "null"], ["show number 3", "null"], ["show me number 2", "null"], ["show me my schedule", "null"], ["open settings", "null"], ["what's on my calendar tomorrow", "null"],
    ["open my music", "null"], ["show me the weather", "null"], ["what's the date today", "null"], ["show the list", "null"], ["open the second one", "null"], ["what reminders do I have", "null"], ["show me today's schedule", "null"],
    ["what does this picture say", "null"], ["what is this document about", "null"], ["describe this photo", "null"], ["read this page to me", "null"],
  ];
  let ok = 0; const misses = [];
  for (const [said, want] of CASES) {
    skills.closeList(); events.length = 0;
    const r = await skills.command(said, { surface: "desk" });
    const opened = lastOpen(), list = lastList();
    const [kind, key] = want.split(":");
    const id = key ? idOf(F[key]) : null;
    let good;
    if (kind === "open") good = opened?.id === id && /^Opening .+ from .+\.$/.test(r?.reply ?? "");
    else if (kind === "top") good = opened?.id === id || (list?.items ?? []).slice(0, 3).some((x) => x.id === id);
    else if (kind === "none") good = /couldn't find/.test(r?.reply ?? "") && !opened;
    else if (kind === "notfound") good = !opened && (!r || /couldn't find/.test(r.reply ?? ""));
    else good = r === null;
    if (good) ok++; else misses.push(`${said} → ${want} (got ${r === null ? "null" : JSON.stringify(r?.reply ?? "").slice(0, 120)}${opened ? `, opened ${opened.name}` : ""}${list?.items ? `, list ${list.items.slice(0, 3).map((x) => x.name).join("|")}` : ""})`);
  }
  const acc = ok / CASES.length;
  console.log(`      find accuracy: ${ok}/${CASES.length} = ${(acc * 100).toFixed(1)}%`);
  for (const m of misses) console.log(`      miss: ${m}`);
  check(`finding by name: ${CASES.length} ways of asking, at least 95% right`, CASES.length >= 80 && acc >= 0.95, `${(acc * 100).toFixed(1)}%`);
  // with file access off, it still leaves everything else alone (it only says "I can't look at your files" to a file request)
  permissions.set({ files: "off", choice: true });
  const NOT_FILES = ["what's today's date", "show number 3", "what time is it", "show me my schedule", "open settings", "find my keys", "what's the weather", "open the second one", "show me pictures of golden retrievers"];
  const grabbed = [];
  for (const t of NOT_FILES) { const r = await skills.command(t, { surface: "desk" }); if (r !== null) grabbed.push(`${t} → ${r.reply}`); }
  check("file access off: dates, times, “show number 3”, the schedule, settings and the web are left alone", !grabbed.length, grabbed.join(" | "));
  const offReply = await skills.command("open the PDF called lease agreement");
  check("…while a clear file request says it can't look yet", /can't look at your files yet/.test(offReply?.reply ?? ""), offReply?.reply);
  permissions.set({ files: "all", allAccess: "read", entries: [], choice: true });
  // a second set, written after the finder was tuned on the first (so it says how well it does on new wordings)
  const HELD = [["could you find my resume please", "top:resume"], ["show me the lease", "top:lease"], ["open the rental lease agreement", "top:lease"], ["get me the invoice from downloads", "top:invoice"],
    ["where is the birthday party picture", "top:bday1"], ["open the tahoe sunset", "top:sunset"], ["find the video of the wedding ceremony", "top:wedding"], ["open my budget for 2026", "top:budget26"],
    ["find the household budget", "top:household"], ["open the recipe for apple pie", "top:pie"], ["show me my meeting notes", "top:notes"], ["open the contacts list", "top:contacts"], ["find the analysis script", "top:py"],
    ["open the quarterly slides", "top:report"], ["open the zip with old photos", "top:zip"], ["find the project plan", "top:plan"], ["show the diagram svg", "top:svg"], ["find grocery", "top:grocery"], ["open my thesis", "top:thesis"],
    ["find the banner image", "top:webp"], ["open the logo", "top:gif"], ["find invoice 7731 pdf", "top:invoice"], ["find the heic picture IMG_0001", "top:heic"], ["show me the screenshot", "top:shot"], ["open the song holy forever", "top:song"]];
  let hok = 0;
  for (const [said, want] of HELD) {
    skills.closeList(); events.length = 0;
    const r = await skills.command(said, { surface: "desk" });
    const id = idOf(F[want.split(":")[1]]), opened = lastOpen(), list = lastList();
    if (opened?.id === id || (list?.items ?? []).slice(0, 3).some((x) => x.id === id)) hok++; else console.log(`      held-out miss: ${said} → ${want} (got ${r === null ? "null" : JSON.stringify(r?.reply ?? "").slice(0, 100)})`);
  }
  console.log(`      held-out accuracy: ${hok}/${HELD.length} = ${(hok / HELD.length * 100).toFixed(1)}%`);
  check(`finding by name, new wordings (${HELD.length}): at least 85% right`, hok / HELD.length >= 0.85, `${hok}/${HELD.length}`);
  // what it says
  skills.closeList(); events.length = 0;
  let r = await skills.command("open the PDF called lease agreement");
  check("one confident match opens straight away: “Opening Lease Agreement.pdf from Documents.”", r?.reply === "Opening Lease Agreement.pdf from Documents." && lastOpen()?.kind === "pdf", r?.reply);
  const view = activity.search({ kind: "file.view" }).entries[0];
  check("…and the view is in the activity log (the path only)", view?.path?.toLowerCase() === F.lease.toLowerCase() && !("text" in view) && !("title" in view), JSON.stringify(view));
  events.length = 0;
  r = await skills.command("find the lease");
  const l = lastList();
  check("several matches: a numbered list with a picture, the folder, size, date and type", r?.listen && /Say a number/.test(r.reply) && l?.items?.length >= 2 && l.items.every((x) => x.n && x.where && x.sizeText && x.when && x.type), JSON.stringify(l?.items?.[0]));
  check("…pictures in the list get a thumbnail address (by id)", (await (async () => { events.length = 0; await skills.command("find photos from the lake"); return lastList()?.items?.find((x) => x.kind === "image")?.thumb ?? ""; })()).startsWith("/api/viewer/thumb?id="));
  await skills.command("find the lease");
  r = await skills.command("number 2");
  check("“number 2” opens the second one", lastOpen()?.id === lastList()?.items?.[1]?.id && /^Opening /.test(r?.reply ?? ""), r?.reply);
  await skills.command("find the lease");
  r = await skills.command("the first one");
  check("“the first one” opens the first", lastOpen()?.id === lastList()?.items?.[0]?.id, r?.reply);
  r = await skills.command("number 9");
  check("a number that isn't on the list says so", /only \d files? on the list/.test(r?.reply ?? ""), r?.reply);
  r = await skills.command("find the pdf called quantum banana");
  check("none: says so, which folders it looked in, and how to allow more", /couldn't find a PDF called “quantum banana”/.test(r?.reply ?? "") && /I looked in .*Documents/.test(r.reply) && /Settings → Permissions/.test(r.reply), r?.reply);
  r = await skills.command("open the leese agrement signd pdf");
  check("…a near miss suggests similar names (“Did you mean …”)", /lease_agreement_signed\.pdf|Opening lease_agreement_signed/.test(r?.reply ?? ""), r?.reply);
  r = await skills.command("find the file called lease agremant final copy xyz");
  check("…and when nothing matches, it offers the closest names", /Did you mean .*Lease Agreement\.pdf/.test(r?.reply ?? "") || /Opening/.test(r?.reply ?? ""), r?.reply);
  await skills.command("open the lease agreement pdf");
  r = await skills.command("show it in the folder");
  const shownLog = activity.search({ kind: "file.open" }).entries[0];
  check("“show it in the folder” (dry run here) is logged", /Showing .* in its folder, Documents/.test(r?.reply ?? "") && shownLog?.action === "show in folder", r?.reply);
  permissions.set({ programs: "off" });
  r = await skills.command("open it in the default app");
  check("“open it in the default app” needs the Programs permission", /permission to open programs/.test(r?.reply ?? ""), r?.reply);
  permissions.set({ programs: "ask" });
  r = await skills.command("open it in the default app");
  check("…with Programs = ask, it asks first", /Should I go ahead\?/.test(r?.reply ?? ""), r?.reply);
  r = await skills.command("yes");
  check("…and “yes” opens it (dry run), logged", /Opening Lease Agreement\.pdf in its usual app/.test(r?.reply ?? "") && activity.search({ kind: "file.open" }).entries[0]?.app === "default", r?.reply);
  permissions.set({ programs: "off" });
  // parsing details
  const p = parse("open last week's budget spreadsheet", { now: new Date("2026-09-29T12:00:00") });
  check("parse: last week, a spreadsheet, the word budget", p.after && +p.after === +new Date("2026-09-15T00:00:00") && p.kinds.includes("sheet") && p.words.join() === "budget", JSON.stringify(p));
  check("parse: spoken numbers and underscores (“img underscore five seven eight two” → img_5782)", parse("show me the picture named img underscore five seven eight two").words.join() === "img_5782");
  check("parse: years said as words (“twenty twenty four”, “two thousand nineteen”)", parse("find photos from twenty twenty four").year === 2024 && parse("find photos from two thousand nineteen").year === 2019);
  check("parse: a folder hint (“in my Downloads”, “in the Finance folder”)", parse("find the lease in my downloads").folder === "downloads" && parse("find the budget in the Finance folder").folder === "finance");
}

// ---- 3. permissions ----------------------------------------------------------------------------------------------------------------
const readJSON = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>viewer test</title></head><body style="margin:0;background:#070913;color:#fff;font-family:sans-serif">
<script>window.__spoken = []; window.dsSpeak = (t) => { window.__spoken.push(t); return new Promise((r) => setTimeout(r, 30)); }; window.dsStopSpeaking = () => { window.__stopped = (window.__stopped ?? 0) + 1; };
window.dayspring = { toast: (a, b) => { (window.__toasts ??= []).push(a + ": " + b); } };
const es = new EventSource("/api/events"); window.dsEvents = es;</script><script src="/viewer.js"></script></body></html>`;
const PUB = join(DESK, "public");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };
const srv = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (url.pathname === "/api/events") return bus.addClient(res, { page: "display", id: "qa" });
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGE); }
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/chat") return send(res, 200, { reply: "The AI would answer here." });
      if (await routes.handle(req, res, { m: req.method, p: url.pathname.slice(4), q: url.searchParams, send, readJSON })) return;
      return send(res, 404, { error: "no route" });
    }
    const f = join(PUB, decodeURIComponent(url.pathname));
    if (!f.startsWith(PUB) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" }); res.end(readFileSync(f));
  } catch (e) { if (!res.headersSent) send(res, 500, { error: e.message }); }
}).listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const get = (path, headers = {}, method = "GET", body = null) => new Promise((ok, no) => { const r = http.request(BASE + path, { method, headers: body ? { ...headers, "content-type": "application/json" } : headers }, (res) => { const b = []; res.on("data", (c) => b.push(c)); res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(b), json: () => JSON.parse(Buffer.concat(b).toString() || "{}") })); }); r.on("error", no); if (body) r.write(JSON.stringify(body)); r.end(); });
const post = (path, body) => get(path, {}, "POST", body);

if (part("perm")) {
  const lease = idOf(F.lease), bytes = readFileSync(F.lease);
  let r = await get(`/api/viewer/file?id=${lease}`);
  check("the file route serves by id (200, application/pdf, the right bytes)", r.status === 200 && r.headers["content-type"] === "application/pdf" && r.body.equals(bytes), r.status);
  r = await get(`/api/viewer/file?id=${lease}`, { range: "bytes=10-99" });
  check("…with HTTP Range (206, exactly those bytes)", r.status === 206 && r.body.equals(bytes.subarray(10, 100)) && r.headers["content-range"] === `bytes 10-99/${bytes.length}`, r.status);
  r = await get(`/api/viewer/file?id=${lease}`, { range: `bytes=${bytes.length + 5}-` });
  check("…a range past the end → 416", r.status === 416);
  for (const bad of [encodeURIComponent(F.lease), "..%5c..%5cWindows%5cwin.ini", encodeURIComponent("C:\\Windows\\win.ini"), "0123456789abcdef"]) {
    r = await get(`/api/viewer/file?id=${bad}`);
    check(`a path or unknown id instead of an id is refused (${decodeURIComponent(bad).slice(0, 26)})`, r.status === 404 && !r.body.includes(Buffer.from("%PDF")));
  }
  r = await get(`/api/viewer/file?path=${encodeURIComponent(F.lease)}`);
  check("a path= parameter is ignored (only ids)", r.status === 404);
  // a tampered index: entries pointing outside, through the junction, at a secret, into Windows
  const raw = JSON.parse(readFileSync(process.env.DAYSPRING_FILEINDEX_FILE, "utf8"));
  const tampered = [F.outside, join(DOCS, "linked", "Outside Plan.pdf"), F.passwords, "C:\\Windows\\win.ini", F.taxes];
  raw.items.push(...tampered.map((p) => [p, 10, Date.now(), "Documents"]));
  writeFileSync(process.env.DAYSPRING_FILEINDEX_FILE, JSON.stringify(raw)); index._reset();
  for (const p of tampered) { r = await get(`/api/viewer/file?id=${idOf(p)}`); check(`a tampered index entry is refused (403): ${basename(p)}${p.includes("linked") ? " through a junction" : ""}`, r.status === 403 && !r.body.includes(Buffer.from("%PDF")) && !r.body.includes(Buffer.from("hunter2")), r.status); }
  check("…and each refusal is in the activity log", activity.search({ kind: "blocked", query: "file_viewer" }).entries.length >= 4);
  await index.scanNow();
  // read-only: look, but no delete or copy
  r = await post("/api/viewer/delete", { id: lease });
  check("read-only: delete is refused (403) with why", r.status === 403 && /not allowed|permission|only|change/i.test(r.json().error ?? ""), r.body.toString());
  r = await post("/api/viewer/copy", { id: lease });
  check("read-only: save a copy is refused (403)", r.status === 403, r.body.toString());
  // a place taken back after indexing
  permissions.set({ files: "all", allAccess: "read", entries: [{ path: DOCS, kind: "folder", access: "none" }], choice: true });
  r = await get(`/api/viewer/file?id=${lease}`);
  check("Documents taken back after indexing: the file is refused (403)", r.status === 403, r.status);
  r = await skills.command("open the PDF called lease agreement");
  check("…and finding no longer shows it", !/Opening Lease/.test(r?.reply ?? ""), r?.reply);
  // only the places picked
  permissions.set({ files: "custom", entries: [{ path: join(HOME, "Pictures"), kind: "folder", access: "read" }], choice: true });
  await index.scanNow();
  check("“only the places I pick” (Pictures): only Pictures is indexed", has(F.img5782) && !has(F.lease) && !has(F.wedding), index.items().length);
  r = await skills.command("open the PDF called lease agreement");
  check("…a file elsewhere isn't found, and it says which folders it looked in", /couldn't find/.test(r?.reply ?? "") && /I looked in Pictures/.test(r.reply), r?.reply);
  // off
  permissions.set({ files: "off", choice: true });
  r = await skills.command("open the PDF called lease agreement");
  check("file access off: it says it can't look, and how to allow it", /can't look at your files yet.*Settings → Permissions/.test(r?.reply ?? ""), r?.reply);
  r = await get(`/api/viewer/file?id=${idOf(F.img5782)}`);
  check("…and nothing is served", r.status === 403, r.status);
  // path tricks through the AI's file_open
  permissions.set({ files: "all", allAccess: "read", entries: [], choice: true });
  await index.scanNow();
  for (const [trick, why] of [[join(DOCS, "..", "..", "Outside", "Outside Plan.pdf"), "“..”"], ["\\\\?\\" + F.lease, "\\\\?\\"], ["\\\\server\\share\\x.pdf", "a network share"], [F.lease + ":hidden", "a data stream"], [join(DOCS, "Lease Agreement.pdf."), "a trailing dot"], ["C:\\PROGRA~1\\x.txt", "an 8.3 name"], [join(DOCS, "CON"), "a device name"], ["C:\\Windows\\win.ini", "Windows"], [F.passwords, "a secret"], [F.outside, "outside"]]) {
    const o = await skills.runTool("file_open", { path: trick });
    check(`file_open refuses ${why}`, (o.denied || o.error) && !o.opened, JSON.stringify(o).slice(0, 160));
  }
  // secrets inside a zip, and a file too big inside it
  const zid = idOf(F.zip);
  r = await get(`/api/viewer/inner?id=${zid}&entry=.env`);
  check("a secret-looking file inside a zip isn't opened", r.status === 403 && !r.body.includes(Buffer.from("do-not-show")), r.status);
  r = await get(`/api/viewer/inner?id=${zid}&entry=${encodeURIComponent("Private/diary.txt")}`);
  check("…nor a private-looking one", r.status === 403, r.status);
  r = await get(`/api/viewer/inner?id=${zid}&entry=big.bin`);
  check("…and a file too big to open from inside (30 MB) is refused (413)", r.status === 413, r.status);
  r = await get(`/api/viewer/inner?id=${zid}&entry=readme.txt`);
  check("…a small ordinary one opens", r.status === 200 && /old photos from the farm/.test(r.body.toString()), r.status);
  // an HTML or SVG file never runs as a page of Dayspring's
  r = await get(`/api/viewer/file?id=${idOf(F.svg)}`);
  check("an SVG is served sandboxed (CSP sandbox, nosniff)", r.status === 200 && /sandbox/.test(r.headers["content-security-policy"] ?? "") && r.headers["x-content-type-options"] === "nosniff");
  // delete: only with the permission, and only after a yes
  permissions.set({ files: "all", allAccess: "readwrite", entries: [], can: { create: true, edit: true, move: true, delete: false }, writeConfirm: "ask", choice: true });
  r = await post("/api/viewer/delete", { id: idOf(F.todo) });
  check("read & write but “Can delete files” off: delete is refused", r.status === 403 && /delete/i.test(r.json().error ?? ""), r.body.toString());
  permissions.set({ can: { delete: true } });
  r = await post("/api/viewer/delete", { id: idOf(F.todo) });
  const askTok = r.json().ask;
  check("with delete on: the first request only asks (Recycle Bin, are you sure?)", r.status === 200 && r.json().needsConfirm && /Recycle Bin/.test(r.json().text) && existsSync(F.todo), r.body.toString());
  r = await post("/api/viewer/delete", { id: idOf(F.todo), ask: "made-up-token" });
  check("…a made-up answer doesn't delete it", existsSync(F.todo) && r.json().needsConfirm, r.body.toString());
  r = await post("/api/viewer/delete", { id: idOf(F.todo), ask: askTok });
  const del = activity.search({ kind: "file.delete" }).entries[0];
  check("…the yes moves it to the Recycle Bin (logged, backed up)", r.json().recycled === "Todo.txt" && !existsSync(F.todo) && readdirSync(BIN).some((n) => n.endsWith("Todo.txt")) && del?.path?.toLowerCase() === F.todo.toLowerCase(), r.body.toString());
  check("…and it's gone from the index", !has(F.todo));
  // save a copy (asks first here: the temp folder is outside the owner's usual folders)
  r = await post("/api/viewer/copy", { id: idOf(F.grocery) });
  if (r.json().needsConfirm) r = await post("/api/viewer/copy", { id: idOf(F.grocery), ask: r.json().ask });
  check("save a copy: “Grocery List (copy).txt” next to it, logged", r.json().copied === "Grocery List (copy).txt" && existsSync(join(DOCS, "Grocery List (copy).txt")) && activity.search({ kind: "file.copy" }).entries.length > 0, r.body.toString());
  // set as avatar
  r = await post("/api/viewer/avatar", { id: idOf(F.img5782) });
  check("set as avatar: the picture becomes the avatar (saved in the avatar folder)", r.json().avatar === "IMG_5782.jpg" && readdirSync(process.env.DAYSPRING_AVATAR_DIR).length === 1, r.body.toString());
  // info: EXIF
  r = await get(`/api/viewer/info?id=${idOf(F.img5782)}`);
  const inf = r.json();
  check("info: the EXIF date taken, the camera and the size in pixels", inf.taken === "2024-07-04T18:30:00" && inf.camera === "Canon EOS R6" && inf.width === 64 && inf.height === 48, JSON.stringify(inf));
  r = await get(`/api/viewer/info?id=${idOf(F.dsc)}`);
  check("info: the owner's own words about a photo (the catalogue)", /Sam fishing off the dock/.test(r.json().ownWords ?? ""), r.body.toString().slice(0, 200));
  r = await get(`/api/viewer/info?id=${idOf(F.wedding)}`);
  check("info: a video's captions next to it (ceremony.en.srt)", r.json().captions?.[0]?.label === "EN", r.body.toString().slice(0, 200));
  r = await get(`/api/viewer/captions?id=${idOf(F.wedding)}&n=0`);
  check("captions: the .srt is served as WebVTT", r.status === 200 && /^WEBVTT/.test(r.body.toString()) && /00:00:00\.500 --> 00:00:03\.000/.test(r.body.toString()), r.body.toString().slice(0, 80));
  // HEIC (a HEIF container), decoded by Windows
  if (existsSync(VISION_EXE)) {
    r = await get(`/api/viewer/file?id=${idOf(F.heic)}`);
    check("HEIC: Windows' decoder turns it into a JPEG for the screen", r.status === 200 && r.headers["content-type"] === "image/jpeg" && r.body[0] === 0xff && r.body[1] === 0xd8, `${r.status} ${r.headers["content-type"]} ${r.body.toString().slice(0, 120)}`);
  } else check("HEIC: the picture helper isn't built here (skipped)", true);
  // text, render
  r = await get(`/api/viewer/text?id=${idOf(F.appjs)}`);
  check("text route: code with its language (javascript)", r.json().lang === "javascript" && /function hi/.test(r.json().text));
  r = await get(`/api/viewer/render?id=${idOf(F.resume)}`);
  check("render: Word → cleaned HTML", /<h1>Sam Example<\/h1>/.test(r.json().html) && /<strong>Skills/.test(r.json().html) && !/<script/i.test(r.json().html), r.json().html?.slice(0, 200));
  r = await get(`/api/viewer/render?id=${idOf(F.budget26)}`);
  check("render: Excel → sheets (Monthly, Yearly)", r.json().sheets?.map((s) => s.name).join() === "Monthly,Yearly" && r.json().sheets[0].rows[2][0] === "Groceries", JSON.stringify(r.json()).slice(0, 200));
  r = await get(`/api/viewer/render?id=${idOf(F.report)}`);
  check("render: PowerPoint → each slide's title, text, notes and pictures", r.json().slides?.[0]?.title === "Quarterly Report" && r.json().slides[0].images[0] === "ppt/media/image1.png" && /Thank the team/.test(r.json().slides[0].notes), JSON.stringify(r.json()).slice(0, 240));
  r = await get(`/api/viewer/render?id=${zid}`);
  check("render: zip → the list of what's inside", r.json().entries?.some((e) => e.name === "readme.txt" && e.size > 10), JSON.stringify(r.json()).slice(0, 200));
  permissions.set({ files: "all", allAccess: "read", entries: [], choice: true });
}

// ---- 4. the AI's tools, a pretend Claude and a pretend Ollama, and the no-AI intents ---------------------------------------------------
if (part("ai")) {
  allowHome("read");
  await index.scanNow();
  const a = await skills.runTool("file_find", { query: "lease agreement", kind: "pdf" });
  check("file_find: results with ids, folders, sizes and dates (no contents), shown on the screen", a.count >= 1 && a.results[0].id === idOf(F.lease) && a.results[0].where === "Documents" && a.shownOnScreen && !JSON.stringify(a).includes("monthly rent"), JSON.stringify(a).slice(0, 200));
  const b = await skills.runTool("file_open", { id: a.results[0].id });
  check("file_open by id opens it in the viewer", b.opened === "Lease Agreement.pdf" && lastOpen()?.id === idOf(F.lease), JSON.stringify(b));
  const c = await skills.runTool("file_open", { n: 1 });
  check("file_open by the number on the screen", c.opened === "Lease Agreement.pdf", JSON.stringify(c));
  const d = await skills.runTool("file_show_in_folder", { id: idOf(F.resume) });
  check("file_show_in_folder (dry run)", d.shown === "Resume 2024.docx" && d.dryRun, JSON.stringify(d));
  permissions.set({ programs: "ask" });
  const e1 = await skills.runTool("file_open", { id: idOf(F.resume), where: "default" });
  check("file_open where=default with Programs = ask: needs the owner's yes (a token)", e1.needsConfirm && e1.confirm_token, JSON.stringify(e1));
  const e2 = await skills.runTool("file_open", { id: idOf(F.resume), where: "default", confirm_token: e1.confirm_token });
  check("…the AI can't approve it itself (the token isn't approved yet)", !e2.opened, JSON.stringify(e2));
  permissions.set({ programs: "off" });
  const none = await skills.runTool("file_find", { query: "quantum banana" });
  check("file_find with nothing close: didYouMean and how to allow more", none.count === 0 && Array.isArray(none.didYouMean) && /Settings → Permissions/.test(none.howToAllowMore), JSON.stringify(none));
  // the tools the AI is offered
  const assistant = await imp("lib/assistant.mjs");
  const names = assistant.offeredToolNames();
  check("the assistant offers file_find, file_open and file_show_in_folder (files allowed)", ["file_find", "file_open", "file_show_in_folder"].every((n) => names.includes(n)), names.filter((n) => /^file/.test(n)).join());
  // a pretend Claude: calls file_find, then file_open with the first id, then answers
  const calls = [];
  const anth = http.createServer(async (req, res) => {
    let raw = ""; for await (const ch of req) raw += ch;
    const body = JSON.parse(raw || "{}");
    const tools = (body.tools ?? []).map((t) => t.name);
    const last = body.messages.at(-1);
    const results = Array.isArray(last.content) ? last.content.filter((x) => x.type === "tool_result") : [];
    let content, stop = "tool_use";
    if (!results.length) { calls.push({ tools }); content = tools.includes("file_find") ? [{ type: "tool_use", id: "tu_1", name: "file_find", input: { query: "the lease agreement pdf" } }] : [{ type: "text", text: "no tool" }]; if (!tools.includes("file_find")) stop = "end_turn"; }
    else {
      const out = JSON.parse(typeof results[0].content === "string" ? results[0].content : results[0].content?.[0]?.text ?? "{}");
      if (out.results?.length) content = [{ type: "tool_use", id: "tu_2", name: "file_open", input: { id: out.results[0].id } }];
      else { content = [{ type: "text", text: out.say ?? (out.opened ? `Opening ${out.opened}.` : "Done.") }]; stop = "end_turn"; }
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_x", type: "message", role: "assistant", model: body.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
  });
  await new Promise((r) => anth.listen(0, "127.0.0.1", r));
  // (the real assistant's tool list; the loop that Claude's answers go through, calling the finder's tools)
  process.env.AI_PROVIDER = "anthropic";
  const { default: Anthropic } = await import(pathToFileURL(createRequire(join(DESK, "package.json")).resolve("@anthropic-ai/sdk")).href);
  const client = new Anthropic({ apiKey: `sk-ant-api03-${"x".repeat(48)}-ok`, baseURL: `http://127.0.0.1:${anth.address().port}`, maxRetries: 0 });
  const offered = assistant.offeredTools();
  const msgs = [{ role: "user", content: "can you pull up the lease agreement for me" }];
  let out = { reply: "" };
  events.length = 0;
  for (let round = 0; round < 5; round++) {
    const res = await client.messages.create({ model: "claude-sonnet-5", max_tokens: 500, tools: offered, messages: msgs });
    msgs.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((x) => x.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) { out.reply = res.content.filter((x) => x.type === "text").map((x) => x.text).join(""); break; }
    const results = [];
    for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(await skills.runTool(u.name, u.input)) });
    msgs.push({ role: "user", content: results });
  }
  check("pretend Claude: offered file_find, finds the lease, opens it with file_open, and says so", calls[0]?.tools.includes("file_find") && lastOpen()?.id === idOf(F.lease) && /Opening Lease Agreement\.pdf/.test(out?.reply ?? ""), `${out?.reply} tools=${calls[0]?.tools?.filter((t) => /^file/.test(t))}`);
  anth.close();
  // a pretend Ollama: the same two tools through the local model's path (lib/ollama picks ~10 tools per request)
  const oreq = [];
  const oll = http.createServer(async (req, res) => {
    let raw = ""; for await (const ch of req) raw += ch;
    const body = raw ? JSON.parse(raw) : {};
    const path = new URL(req.url, "http://x").pathname;
    const json = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (path === "/api/version") return json({ version: "0.12.3" });
    if (path === "/api/tags") return json({ models: [{ name: "qwen2.5:3b", model: "qwen2.5:3b", size: 1.9e9, details: { family: "qwen2" } }] });
    if (path === "/api/show") return json({ capabilities: ["completion", "tools"] });
    if (path === "/api/ps") return json({ models: [] });
    if (path !== "/api/chat") return json({});
    if (!body.messages?.length) return json({ model: body.model, message: { role: "assistant", content: "" }, done: true });
    const offered = (body.tools ?? []).map((t) => t.function?.name);
    oreq.push(offered);
    const last = body.messages.at(-1);
    let msg;
    if (last.role === "tool") {
      // (lib/ollama wraps a tool's result in a line of its own before the JSON)
      const c = String(last.content ?? ""), id = /"results":\[\{"n":1,"id":"([a-f0-9]{16})"/.exec(c)?.[1], say = /"say":"([^"]+)"/.exec(c)?.[1];
      msg = id && !/"opened"/.test(c) ? { role: "assistant", content: "", tool_calls: [{ function: { name: "file_open", arguments: { id } } }] } : { role: "assistant", content: say ?? "Done." };
    } else msg = offered.includes("file_find") ? { role: "assistant", content: "", tool_calls: [{ function: { name: "file_find", arguments: { query: "budget spreadsheet", latest: true } } }] } : { role: "assistant", content: "I can't." };
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(JSON.stringify({ model: body.model, message: msg, done: false }) + "\n");
    res.end(JSON.stringify({ model: body.model, message: { role: "assistant", content: "" }, done: true, done_reason: "stop", eval_count: 3, eval_duration: 1e7 }) + "\n");
  });
  await new Promise((r) => oll.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { AI_PROVIDER: "ollama", AI_MODEL: "qwen2.5:3b", OLLAMA_URL: `http://127.0.0.1:${oll.address().port}`, OLLAMA_EMBED_MODEL: "off", DAYSPRING_OLLAMA_NO_SYSTEM: "1" });
  events.length = 0;
  // (lib/ollama's own path: it picks the tools for this request from the assistant's list, calls them, answers)
  const local = await imp("lib/ollama/index.mjs");
  try { out = await local.chat({ history: [], userText: "find my latest budget spreadsheet", surface: "desk", tools: assistant.offeredTools(), runTool: async (n, i) => (await skills.runTool(n, i)) ?? { error: "not part of this test" }, extras: {} }); } catch (e) { out = { reply: "ERR " + e.message }; }
  check("pretend Ollama: offered file_find for a file request, finds the budget and opens it", oreq[0]?.includes("file_find") && lastOpen()?.id === idOf(F.budget26), `${out?.reply} offered=${oreq[0]?.join(",")}`);
  oll.close();
  // No AI: the no-AI intents take the common phrasings to the finder
  process.env.AI_PROVIDER = "none"; delete process.env.OLLAMA_URL; delete process.env.AI_MODEL;
  const I = await imp("lib/intents/index.mjs");
  let hits = 0;
  const OFF = [["find my resume", idOf(F.resume)], ["open my resume document", idOf(F.resume)], ["where is my lease agreement file", idOf(F.lease)], ["find a file called grocery list", idOf(F.grocery)], ["open the lease agreement pdf", idOf(F.lease)]];
  for (const [said, id] of OFF) { events.length = 0; skills.closeList(); const r = await I.fallback(said, { surface: "desk" }).catch((e) => ({ reply: e.message })); if (lastOpen()?.id === id || lastList()?.items?.some((x) => x.id === id)) hits++; else console.log(`      offline miss: ${said} → ${r?.reply}`); }
  check(`no AI: the offline intents send ${OFF.length} common phrasings to the finder`, hits === OFF.length, `${hits}/${OFF.length}`);
}

// ---- 5. the viewer in headless Chrome ----------------------------------------------------------------------------------------------------
if (part("ui")) {
  allowHome("read", { programs: "off" });
  await index.scanNow();
  let pw = null;
  for (const p of [join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")]) { if (existsSync(p)) { try { pw = await import(pathToFileURL(p).href); break; } catch { /* next */ } } }
  pw ??= createRequire(join(DESK, "package.json"))("playwright-core");
  const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
    await page.goto(BASE + "/");
    await until(() => page.evaluate(() => Boolean(window.dsViewer) && window.dsEvents?.readyState === 1), 6000);
    const V = () => page.evaluate(() => window.dsViewer.state());
    const openKey = async (k) => { const it = skills.resolve(idOf(F[k])); const r = skills.openOnScreen(it, { via: "test" }); await until(async () => (await V()).id === idOf(F[k]), 5000); return r; };
    const local = (t) => page.evaluate((x) => { for (const f of window.dsLocal ?? []) { const r = f(x, x); if (r) return r; } return false; }, t);
    // pictures
    await openKey("img5782");
    let ok = await until(() => page.evaluate(() => { const i = document.querySelector("#dsViewer .vw-img img"); return i && i.naturalWidth === 64; }), 6000);
    check("picture (JPEG): shown, fitted to the window", Boolean(ok) && (await V()).zoom >= 1 - 1e-6, JSON.stringify(await V()));
    const z0 = (await V()).zoom;
    await page.click('#dsViewer [data-t="in"]');
    check("zoom in (+ button)", (await V()).zoom > z0 * 1.2);
    await page.keyboard.press("-"); await page.keyboard.press("-");
    check("zoom out (− key)", (await V()).zoom < z0 * 1.1);
    const box = await page.locator("#dsViewer .vw-img").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -300);
    check("zoom with the wheel", (await V()).zoom > z0 * 0.9);
    await page.click('#dsViewer [data-t="fit"]'); check("fit", Math.abs((await V()).zoom - (await V()).fit) < 1e-6);
    await page.click('#dsViewer [data-t="one"]'); check("100% (actual size)", Math.abs((await V()).zoom - 1) < 1e-6);
    await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 160, box.y + 130, { steps: 4 }); await page.mouse.up();
    check("pan (drag)", Math.abs((await V()).x - 60) < 2 && Math.abs((await V()).y - 30) < 2, JSON.stringify(await V()));
    await page.click('#dsViewer [data-t="rotr"]'); check("rotate right", (await V()).rot === 90);
    await page.keyboard.press("Shift+R"); check("rotate left (Shift+R)", (await V()).rot === 0);
    await page.click('#dsViewer [data-t="fliph"]'); check("flip", (await V()).fx === -1);
    // info panel: EXIF
    await page.click('#dsViewer [data-a="info"]');
    ok = await until(() => page.evaluate(() => { const t = document.querySelector("#dsViewer .vw-info")?.innerText ?? ""; return /Camera/.test(t) ? t : ""; }), 6000) || "";
    check("the info panel: date taken, camera, dimensions and size", /Canon EOS R6/.test(ok) && /64 × 48 pixels/.test(ok) && /Taken/.test(ok), ok.slice(0, 200));
    // ◀ ▶ and the slideshow
    const first = (await V()).id;
    await until(async () => ((await V()).list?.length ?? 0) > 1, 4000);
    await page.click('#dsViewer [data-a="next"]');
    check("▶ goes to the next picture in the folder", await until(async () => (await V()).id !== first, 4000));
    await page.click('#dsViewer [data-a="prev"]');
    check("◀ comes back", await until(async () => (await V()).id === first, 4000));
    check("voice: “zoom in”, “rotate”, “flip” while viewing", (await local("zoom in")) && (await local("rotate")) && (await local("flip")) && (await V()).rot === 90);
    await page.selectOption('#dsViewer select[data-t="every"]', "3");
    await local("start slideshow");
    check("voice: “start slideshow” (every 3 s) moves on by itself", (await V()).slideshow && (await until(async () => (await V()).id !== first, 5000)));
    await local("stop slideshow"); check("…“stop slideshow”", !(await V()).slideshow);
    // other pictures
    for (const k of ["sunset", "gif", "bmp", "webp", "svg"].concat(existsSync(VISION_EXE) ? ["heic"] : [])) {
      await openKey(k);
      ok = await until(() => page.evaluate(() => { const i = document.querySelector("#dsViewer .vw-img img"); return i && i.complete && i.naturalWidth > 0; }), 8000);
      check(`picture (${extname(F[k]).slice(1).toUpperCase()}${k === "heic" ? ", decoded by Windows" : ""}) is shown`, Boolean(ok));
    }
    check("the SVG's script never ran", await page.evaluate(() => window.__svgRan === undefined));
    // video
    await openKey("wedding");
    ok = await until(async () => { const s = await V(); return s.duration > 4 && s.time > 0.2 ? s : null; }, 8000);
    check("video (MP4): plays", Boolean(ok), JSON.stringify(await V()));
    await page.evaluate(() => window.dsViewer._ctl().seek(3));
    check("video: seek to 0:03", await until(async () => Math.abs((await V()).time - 3) < 0.8, 4000), (await V()).time);
    await page.selectOption('#dsViewer select[data-t="speed"]', "1.5");
    check("video: speed 1.5×", (await V()).rate === 1.5);
    await page.click('#dsViewer [data-t="back"]');
    check("video: −10 s", (await V()).time < 1.5, (await V()).time);
    check("video: captions from the .srt next to it", await until(async () => (await V()).tracks === 1, 4000) && (await page.evaluate(() => !document.querySelector('#dsViewer [data-t="cc"]').hidden)));
    await page.click('#dsViewer [data-t="cc"]');
    check("video: captions on", await page.evaluate(() => document.querySelector("#dsViewer video").textTracks[0].mode === "showing"));
    await page.click('#dsViewer [data-t="loop"]'); check("video: loop", (await V()).loop);
    await page.evaluate(() => window.dsViewer._ctl().volume(0.4)); check("video: volume", Math.abs((await V()).volume - 0.4) < 0.01);
    check("video: picture-in-picture and full-screen buttons are there", await page.evaluate(() => Boolean(document.querySelector('#dsViewer [data-t="pip"]') && document.querySelector('#dsViewer [data-t="vfull"]'))));
    await local("pause"); check("voice: “pause”", (await V()).paused);
    await openKey("toast");
    ok = await until(async () => { const s = await V(); return s.converted && s.time > 0.1 ? s : null; }, 12000);
    check("video (WMV): converted by ffmpeg as it plays", Boolean(ok), JSON.stringify(await V()));
    await openKey("song");
    ok = await until(async () => { const s = await V(); return !s.paused && s.time > 0.2 ? s : null; }, 6000);
    check("audio (MP3): plays", Boolean(ok), JSON.stringify(await V()));
    // PDF
    await openKey("lease");
    ok = await until(async () => { const s = await V(); return s.pages === 3 && s.rendered >= 1 ? s : null; }, 15000);
    check("PDF (pdf.js): opens, 3 pages, drawn", Boolean(ok), JSON.stringify(await V()) + errs.join("|"));
    check("PDF: page thumbnails", await until(() => page.evaluate(() => document.querySelectorAll("#dsViewer .vw-thumb canvas").length >= 2), 8000));
    await page.click('#dsViewer [data-t="np"]');
    check("PDF: next page", await until(async () => (await V()).page === 2, 4000), (await V()).page);
    await local("page 3"); check("voice: “page 3”", await until(async () => (await V()).page === 3, 4000), (await V()).page);
    const sc = (await V()).scale;
    await page.click('#dsViewer [data-t="in"]'); check("PDF: zoom in", (await V()).scale > sc * 1.1);
    await page.click('#dsViewer [data-t="fp"]'); const fpS = (await V()).scale; await page.click('#dsViewer [data-t="fw"]');
    check("PDF: fit page and fit width", (await V()).scale > fpS, `${fpS} → ${(await V()).scale}`);
    await page.click('#dsViewer [data-t="rot"]'); check("PDF: rotate", (await V()).rot === 90);
    await page.click('#dsViewer [data-t="rot"]'); await page.click('#dsViewer [data-t="rot"]'); await page.click('#dsViewer [data-t="rot"]');
    await page.fill('#dsViewer input[data-t="find"]', "rent"); await page.press('#dsViewer input[data-t="find"]', "Enter");
    ok = await until(async () => { const s = await V(); return s.hits >= 2 && s.page === 2 ? s : null; }, 8000);
    check("PDF: search for “rent” finds it (twice, on page 2) and goes there", Boolean(ok), JSON.stringify(await V()));
    check("…and marks it in the text layer", await until(() => page.evaluate(() => document.querySelectorAll("#dsViewer .textLayer .hit").length >= 1), 5000));
    await local("page 1");
    await page.evaluate(() => { window.__spoken = []; });
    await local("read this page");
    ok = await until(() => page.evaluate(() => window.__spoken.join(" ")), 5000);
    check("PDF: “read this page” reads the page's text through Dayspring's voice (dsSpeak)", /This lease is made between the landlord and the tenant/.test(ok), ok.slice(0, 160));
    await local("stop reading"); check("…“stop reading”", !(await V()).reading);
    check("PDF: print and download are there", await page.evaluate(() => Boolean(document.querySelector('#dsViewer [data-t="print"]') && document.querySelector('#dsViewer a[data-t="dl"][download]'))));
    await page.click('#dsViewer [data-t="print"]'); check("PDF: print starts (a hidden frame with the PDF)", await page.evaluate(() => window.__dsViewerPrinted === 1));
    // text, Markdown, code, JSON
    await openKey("grocery");
    check("text: shown", await until(() => page.evaluate(() => /Milk\s+Eggs/.test(document.querySelector("#dsViewer pre.vw-code")?.innerText ?? "")), 5000));
    await local("search for eggs"); check("text: search marks the match", await until(() => page.evaluate(() => document.querySelectorAll("#dsViewer mark.vw-hit").length === 1), 3000));
    const size0 = (await V()).size; await page.click('#dsViewer [data-t="big"]'); check("text: bigger text", (await V()).size === size0 + 1);
    await page.click('#dsViewer [data-t="wrap"]'); check("text: word wrap toggles", (await V()).wrap === false);
    await openKey("notes");
    check("Markdown: rendered (heading, list, table), its <script> never runs", await until(() => page.evaluate(() => document.querySelector("#dsViewer .vw-doc h1")?.textContent === "Meeting Notes" && document.querySelector("#dsViewer .vw-doc table") && document.querySelector("#dsViewer .vw-doc strong")?.textContent === "budget"), 4000) && (await page.evaluate(() => window.__mdRan === undefined)));
    await page.click('#dsViewer [data-t="src"]'); check("Markdown: Source shows the text", await page.evaluate(() => /^# Meeting Notes/.test(document.querySelector("#dsViewer pre.vw-code")?.innerText ?? "")));
    await openKey("appjs");
    check("code: highlighted (Prism)", await until(async () => (await V()).highlighted > 3, 5000), (await V()).highlighted);
    await openKey("json");
    await until(() => page.evaluate(() => Boolean(document.querySelector('#dsViewer [data-t="pretty"]'))), 4000);
    await page.click('#dsViewer [data-t="pretty"]');
    check("JSON: pretty-printed", await until(() => page.evaluate(() => /\n  "port": 8080/.test(document.querySelector("#dsViewer pre.vw-code code")?.textContent ?? "")), 3000));
    // tables
    await openKey("contacts");
    ok = await until(async () => (await V()).rows === 4, 5000);
    check("CSV: a table with its header", Boolean(ok) && (await page.evaluate(() => [...document.querySelectorAll("#dsViewer .vw-table thead th")].map((t) => t.textContent).join("|"))) === "#|Name|Age|City");
    await page.click('#dsViewer .vw-table thead th[data-c="1"]');
    check("CSV: sort by Age (numbers, smallest first: 9 before 31 before 120)", (await V()).first?.[1] === "9" && (await page.evaluate(() => document.querySelector('#dsViewer th[data-c="1"]').getAttribute("aria-sort"))) === "ascending");
    await page.click('#dsViewer .vw-table thead th[data-c="1"]');
    check("CSV: sort again: largest first", (await V()).first?.[1] === "120");
    await page.click('#dsViewer .vw-table thead th[data-c="0"]');
    check("CSV: sort by name (A–Z)", (await V()).first?.[0] === "Adam");
    await openKey("budget26");
    check("Excel: sheets as tabs, rows as a table", await until(async () => { const s = await V(); return s.sheets === 2 && s.rows === 3; }, 5000) && (await page.evaluate(() => /Groceries/.test(document.querySelector("#dsViewer .vw-table")?.innerText ?? ""))));
    await page.click('#dsViewer [data-sheet="1"]'); check("Excel: the second sheet", (await V()).sheet === 1);
    // Word, PowerPoint, zip, unknown
    await openKey("resume");
    check("Word: rendered (heading, bold)", await until(() => page.evaluate(() => document.querySelector("#dsViewer .vw-doc h1")?.textContent === "Sam Example" && /Skills/.test(document.querySelector("#dsViewer .vw-doc strong")?.textContent ?? "")), 5000));
    await openKey("report");
    check("PowerPoint: the slide's title, text and picture", await until(() => page.evaluate(() => { const s = document.querySelector("#dsViewer .vw-slide"); const i = s?.querySelector("img"); return s && /Quarterly Report/.test(s.querySelector("h2").textContent) && /Sales up 12 percent/.test(s.innerText) && i?.complete && i.naturalWidth === 40; }), 6000));
    await local("next"); check("PowerPoint: “next” goes to slide 2", (await V()).slide === 2);
    await openKey("zip");
    check("zip: the list of what's inside", await until(() => page.evaluate(() => document.querySelectorAll("#dsViewer .vw-zip [data-e]").length >= 3), 5000));
    await page.click('#dsViewer .vw-zip [data-e="readme.txt"]');
    check("zip: a small file inside opens here", await until(() => page.evaluate(() => /old photos from the farm/.test(document.querySelector("#dsViewer pre.vw-code")?.innerText ?? "")), 5000));
    await page.click('#dsViewer [data-t="back"]');
    check("zip: back to the list", await until(() => page.evaluate(() => document.querySelectorAll("#dsViewer .vw-zip [data-e]").length >= 3), 4000));
    await page.click('#dsViewer .vw-zip [data-e="pics/barn.png"]');
    check("zip: a picture inside opens here", await until(() => page.evaluate(() => document.querySelector("#dsViewer .vw-img img")?.naturalWidth === 30), 5000));
    await openKey("unknown");
    check("anything else: an info card with “Open in the default app”", await until(() => page.evaluate(() => /mystery\.xyz/.test(document.querySelector("#dsViewer .vw-card")?.innerText ?? "") && Boolean(document.querySelector('#dsViewer .vw-card [data-t="default"]'))), 4000));
    await page.click('#dsViewer .vw-card [data-t="default"]');
    check("…which needs the Programs permission (it says so)", await until(() => page.evaluate(() => /permission to open programs/.test(document.querySelector("#dsViewer .vw-foot .st")?.textContent ?? "")), 4000));
    // delete from the viewer: needs the permission, then a yes
    await openKey("invoice");
    await page.evaluate(() => window.dsViewer.action("delete"));
    check("delete without the permission: refused (it says why), nothing asked", await until(() => page.evaluate(() => /not to change|not allowed|delete/i.test(document.querySelector("#dsViewer .vw-foot .st")?.textContent ?? "") && !document.querySelector("#dsViewer .vw-ask")), 4000) && existsSync(F.invoice),
      await page.evaluate(() => document.querySelector("#dsViewer .vw-foot .st")?.textContent));
    allowHome("readwrite", { can: { delete: true } });
    await page.evaluate(() => { window.dsViewer.action("delete"); });
    check("delete with the permission: it asks first (Recycle Bin)", await until(() => page.evaluate(() => /Recycle Bin/.test(document.querySelector("#dsViewer .vw-ask")?.innerText ?? "")), 4000));
    await page.click('#dsViewer .vw-ask [data-k="no"]');
    check("…Cancel keeps it", await until(() => page.evaluate(() => !document.querySelector("#dsViewer .vw-ask")), 2000) && existsSync(F.invoice));
    await page.evaluate(() => { window.dsViewer.action("delete"); });
    await until(() => page.evaluate(() => Boolean(document.querySelector("#dsViewer .vw-ask"))), 4000);
    await page.click('#dsViewer .vw-ask [data-k="yes"]');
    check("…yes moves it to the Recycle Bin", await until(() => !existsSync(F.invoice), 5000) && readdirSync(BIN).some((n) => n.endsWith("invoice-7731.pdf")));
    allowHome("read", { can: { delete: false } });
    // the list, and the search box
    await local("close");
    check("voice: “close” closes the viewer", !(await V()).open);
    const rl = await skills.command("find the lease");
    check("several matches: the numbered list on the screen", await until(() => page.evaluate(() => document.querySelectorAll("#dsFinder li[data-n]").length >= 2), 4000), `${rl?.reply} · ${await page.evaluate(() => document.getElementById("dsFinder")?.outerHTML.slice(0, 300))}`);
    check("…with a folder, size, date and type on each line", await page.evaluate(() => /Documents|Downloads/.test(document.querySelector("#dsFinder li[data-n] .meta")?.textContent ?? "") && /KB|B/.test(document.querySelector("#dsFinder li[data-n] .meta").textContent)));
    await local("number 1");
    check("voice: “number 1” opens it in the viewer", await until(async () => (await V()).open && (await V()).kind === "pdf", 6000));
    await local("close");
    const n = await page.evaluate(() => window.dsViewer.find("birthday"));
    check("the search box finds files as you ask (“birthday”)", n >= 2 && (await page.evaluate(() => [...document.querySelectorAll("#dsFinder li b")].some((b) => /Birthday Party 001/.test(b.textContent)))));
    const firstName = await page.evaluate(() => document.querySelector("#dsFinder li[data-n='1'] b").textContent);
    await page.focus("#dsFinder li[data-n='1']"); await page.keyboard.press("Enter");
    check("…Enter on a line opens it", await until(async () => (await V()).open && (await page.evaluate(() => document.querySelector("#dsViewer .vw-title b").textContent)) === firstName, 5000), firstName);
    // full screen, Esc
    await page.keyboard.press("f");
    check("F: full screen (fills the window)", await until(async () => (await V()).full && (await page.evaluate(() => Math.round(document.getElementById("dsViewer").getBoundingClientRect().width))) === 1280, 2000),
      `${JSON.stringify(await page.evaluate(() => { const r = document.getElementById("dsViewer").getBoundingClientRect(); return { r, iw: innerWidth, style: document.getElementById("dsViewer").style.cssText }; }))}`);
    await page.keyboard.press("f"); await page.keyboard.press("Escape");
    check("Esc closes it", !(await V()).open);
    check("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally { await browser.close(); }
}

srv.close();
try { const h = await imp("lib/vision/helper.mjs"); h.stop(); } catch { /* not started */ }
await sleep(300);
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ }
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
