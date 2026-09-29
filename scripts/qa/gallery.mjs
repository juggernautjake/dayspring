// The photo gallery (lib/gallery, public/gallery.js) and "📂 Open file location" / "🖼 View in gallery" everywhere a
// photo shows, on a throwaway copy with made-up pictures in a temp folder: never your own Dayspring, its data, your
// photos or a real File Explorer window (DS_LAUNCH_LOG writes down what would have opened).
//   A. modules: what's in the collection (and what never is: screenshots, private-looking folders, hidden photos,
//      places outside the permitted ones), grouping, sorting, filters, paging, random sessions (no repeats, "shuffle
//      again"), breadcrumbs, the date words ("last summer"), thumbnails (made, cached, under the size cap; HEIC decoded),
//      "Open in File Explorer" (the exact explorer.exe /select command, logged, refused outside), the voice commands
//   B. the server and headless Chrome (--mute-audio): the virtualized grid over 2,000+ photos, one photo at a time with
//      Back/Next across page boundaries and the ends, the filmstrip (scrolling loads more, stays in step), the location
//      bar and its breadcrumbs, 🎲 Random (More, Shuffle again, Back/Next inside it), and the two actions on the rotating
//      photo card, the photo's detail (question) card, the file viewer (with its filmstrip), the finder's list, the media
//      list, the People page and a saved web picture; voice through /api/chat
//   node scripts/qa/gallery.mjs [--keep]      (GAL_ONLY=A or B to run one part)
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESK = join(HERE, "..", "..");
const INNER = process.argv.includes("--inner");

if (!INNER) {
  // ---- outer: the throwaway copy, then the checks inside it ----
  const TMP = mkdtempSync(join(tmpdir(), "ds-gallery-")), APP = join(TMP, "app");
  const skip = new Set(["data", "node_modules", "bin", "dist", "dist-out", "backups", "updates", "logs", "qa-out", ".git", ".env"]);
  mkdirSync(APP, { recursive: true });
  for (const e of readdirSync(DESK)) if (!skip.has(e)) cpSync(join(DESK, e), join(APP, e), { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s.slice(DESK.length)) });
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary", features: { photos: true } }));
  const VISION_EXE = join(DESK, "bin", "Dayspring Vision.exe");
  const env = { ...process.env, QA_TMP: TMP, DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"), DAYSPRING_NO_ECO: "1", DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_DEVICES_DRYRUN: "1",
    DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", AI_PROVIDER: "none", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", DAYSPRING_CHANNEL: "dev", DS_PROFILE: "DayspringQA",
    ...(existsSync(VISION_EXE) ? { DAYSPRING_VISION_EXE: VISION_EXE } : {}) };
  const r = spawnSync(process.execPath, [join(APP, "scripts", "qa", "gallery.mjs"), "--inner"], { cwd: APP, env, stdio: "inherit", windowsHide: true });
  if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a helper may still be closing */ } }
  else console.log(`kept: ${TMP}`);
  process.exit(r.status ?? 1);
}

// ---- inner: inside the copy ----
const APP = DESK, TMP = process.env.QA_TMP;
const ONLY = process.env.GAL_ONLY || "";
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 300) + ")" : ""}`); };
const section = (t) => console.log(`\n-- ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* not yet */ } await sleep(100); } return v; }

// the made-up photos
const HOME = join(TMP, "home"), PICS = join(HOME, "Pictures"), DOCS = join(HOME, "Documents"), OUT = join(TMP, "Outside");
const LAUNCH = join(TMP, "launch.jsonl");
Object.assign(process.env, {
  DAYSPRING_PHOTO_DIRS: PICS, DAYSPRING_PHOTO_MIN_BYTES: "0", DAYSPRING_FINDER_HOME: HOME, DAYSPRING_FINDER_DELAY_MS: "0", DAYSPRING_FILEINDEX_FILE: join(TMP, "file-index.json"),
  DAYSPRING_FILECAPTIONS_FILE: join(TMP, "captions.json"), DAYSPRING_GALLERY_FILE: join(TMP, "gallery.json"), DAYSPRING_THUMBS_DIR: join(TMP, "thumbs"), DS_LAUNCH_LOG: LAUNCH,
});
const { jpeg, png } = await import(pathToFileURL(join(HERE, "file-fixtures.mjs")).href);
const require = createRequire(join(APP, "package.json"));
const FF = require("ffmpeg-static");
const put = (p, buf, when = null) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); if (when) { const t = new Date(when); utimesSync(p, t, t); } return p; };
const F = {};
console.log("making the test photos…");
const base = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => jpeg(32, 24, false, k * 30));
F.fam26 = Array.from({ length: 12 }, (_, i) => put(join(PICS, "Family", "2026", `Beach day ${String(i + 1).padStart(2, "0")}.jpg`), base[i % 8], `2026-07-${String(i + 1).padStart(2, "0")}T12:00:00`));
F.fam25 = Array.from({ length: 8 }, (_, i) => put(join(PICS, "Family", "2025", `Camping ${i + 1}.jpg`), base[(i + 3) % 8], `2025-07-${String(i + 10)}T12:00:00`));
F.tahoe = Array.from({ length: 6 }, (_, i) => put(join(PICS, "Trips", "Lake Tahoe", `Tahoe sunset ${i + 1}.png`), png(40 + i * 10, 30), `2024-08-0${i + 1}T18:00:00`));
F.bulk = [];
for (let part = 1; part <= 10; part++) for (let i = 1; i <= 200; i++) {
  const n = (part - 1) * 200 + i, d = new Date(Date.UTC(2023, 0, 1) + n * 8 * 3600_000);
  F.bulk.push(put(join(PICS, "Bulk", `Part ${String(part).padStart(2, "0")}`, `IMG_${String(n).padStart(4, "0")}.jpg`), base[n % 8], d.toISOString()));
}
F.big = put(join(PICS, "Big", "Panorama.jpg"), jpeg(900, 700, false, 50), "2022-05-05T10:00:00");
F.shot = put(join(PICS, "Screenshots", "Screenshot 2026-09-20.png"), png(40, 30), "2026-09-20T10:00:00");
F.tax = put(join(PICS, "Taxes 2024", "receipt.jpg"), base[1], "2024-04-01T10:00:00");
F.hidden = put(join(PICS, "Family", "hide me.jpg"), base[2], "2026-01-01T10:00:00");
F.dock = put(join(PICS, "Family", "Sam at the dock.jpg"), base[3], "2026-06-20T10:00:00");
F.sign = put(join(PICS, "Family", "Birthday sign.jpg"), base[4], "2026-05-02T10:00:00");
F.outside = put(join(OUT, "not allowed.jpg"), base[5]);
F.doc1 = put(join(DOCS, "Trip Photos", "Canyon 1.jpg"), base[6], "2021-03-01T10:00:00");
F.doc2 = put(join(DOCS, "Trip Photos", "Canyon 2.jpg"), base[7], "2021-03-02T10:00:00");
F.doc3 = put(join(DOCS, "Trip Photos", "Canyon 3.jpg"), base[0], "2021-03-03T10:00:00");
const ff = (out, args) => { mkdirSync(dirname(out), { recursive: true }); const r = spawnSync(FF, ["-v", "error", "-y", ...args, out], { windowsHide: true }); return r.status === 0 ? out : null; };
F.heic = ff(join(PICS, "iPhone", "IMG_0001.heic"), ["-f", "lavfi", "-i", "testsrc=size=64x48", "-frames:v", "1", "-c:v", "libaom-av1", "-still-picture", "1", "-f", "avif"]);
if (F.heic) { const t = new Date("2020-01-05T10:00:00"); utimesSync(F.heic, t, t); }
F.clip = ff(join(DOCS, "Trip Photos", "Canyon clip.mp4"), ["-f", "lavfi", "-i", "testsrc=size=64x48:rate=10:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
const { createHash } = await import("node:crypto");
const { resolve } = await import("node:path");
const idOf = (p) => createHash("sha1").update(resolve(p).toLowerCase()).digest("hex").slice(0, 16);
// the owner's catalogue (a category, the owner's words) and one hidden photo; the text read in one picture
writeFileSync(join(APP, "data", "photos.json"), JSON.stringify({ photos: { [idOf(F.dock)]: { status: "catalogued", description: "Sam fishing off the dock", category: "Family trip", tags: ["sam", "fishing"] }, [idOf(F.hidden)]: { status: "hidden" } } }));
writeFileSync(process.env.DAYSPRING_FILECAPTIONS_FILE, JSON.stringify({ v: 1, items: { [idOf(F.sign)]: { description: "A sign", ocr: "Happy birthday Sam" } } }));
const permFile = join(APP, "data", "permissions.json");
const PERM = { files: "custom", entries: [{ path: DOCS, kind: "folder", access: "read" }], choiceMade: true, programs: "off", writeConfirm: "ask", can: { create: true, edit: true, move: true, delete: false } };
writeFileSync(permFile, JSON.stringify(PERM));
const launches = () => (existsSync(LAUNCH) ? readFileSync(LAUNCH, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const lib = (m) => import(pathToFileURL(join(APP, "lib", m)).href);

// =================================================================================================================== A
if (!ONLY || ONLY === "A") {
  section("A. the collection");
  const photos = await lib("photos.mjs");
  const findex = await lib("finder/index.mjs");
  const G = await lib("gallery/index.mjs");
  const S = await lib("gallery/skills.mjs");
  const activity = await lib("activity.mjs");
  const bus = await lib("bus.mjs");
  const events = []; bus.on((type, data) => { if (type === "gallery") events.push(data); });
  await photos.scanNow(); await findex.scanNow();
  const all = await G.query({ view: "all", limit: 500 });
  const allIds = new Set((await G.query({ view: "all", limit: 500, offset: 0 })).items.map((x) => x.id));
  for (let o = 500; o < all.total; o += 500) for (const x of (await G.query({ view: "all", limit: 500, offset: o })).items) allIds.add(x.id);
  const expect = 12 + 8 + 6 + 2000 + 1 + 1 + 1 + 3 + (F.heic ? 1 : 0);
  const wantPaths = [...F.fam26, ...F.fam25, ...F.tahoe, ...F.bulk, F.big, F.dock, F.sign, F.doc1, F.doc2, F.doc3, ...(F.heic ? [F.heic] : [])];
  check(`every photo from the photo folders and the finder's permitted places is there (${expect})`, all.total === expect && allIds.size === expect, `${all.total} / ${allIds.size}; missing: ${wantPaths.filter((p) => !allIds.has(idOf(p))).join(", ")}`);
  check("never: a screenshot, a private-looking folder (Taxes), a hidden photo, a place outside the permitted ones", ![F.shot, F.tax, F.hidden, F.outside].some((p) => allIds.has(idOf(p))));
  check("the finder's pictures (Documents, allowed by file access) are in it", [F.doc1, F.doc2, F.doc3].every((p) => allIds.has(idOf(p))));
  const withVideos = await G.query({ view: "all", videos: true, limit: 1 });
  check("videos only when asked for", Boolean(F.clip) && !allIds.has(idOf(F.clip)) && withVideos.total === all.total + 1, `clip ${F.clip}, with videos ${withVideos.total}`);
  if (F.heic) check("a HEIC photo is in it", allIds.has(idOf(F.heic)));

  section("A. grouping, sorting, filtering, paging");
  const byFolder = await G.query({ view: "all", group: "folder", limit: 5 });
  const gf = Object.fromEntries(byFolder.groups.map((g) => [g.label, g.count]));
  check("group by folder: Pictures › Family › 2026 (12), Pictures › Bulk › Part 01 (200), Documents › Trip Photos (3)", gf["Pictures › Family › 2026"] === 12 && gf["Pictures › Bulk › Part 01"] === 200 && gf["Documents › Trip Photos"] === 3, JSON.stringify(byFolder.groups.slice(0, 6)));
  check("…the groups add up to the whole collection, in order", byFolder.groups.reduce((a, g) => a + g.count, 0) === expect && byFolder.groups.map((g) => g.label).join("|") === [...byFolder.groups.map((g) => g.label)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })).join("|"));
  const byDate = await G.query({ view: "all", group: "date", limit: 3 });
  check("group by date: months, newest first (September 2026's screenshot is left out: July 2026 first)", byDate.groups[0].label === "July 2026" && byDate.groups[0].count === 12 && byDate.groups.some((g) => g.label === "July 2025" && g.count === 8), JSON.stringify(byDate.groups.slice(0, 3)));
  const byAlbum = await G.query({ view: "all", group: "album", limit: 2 });
  check("group by album: the catalogue's category first (Family trip), then the rest", byAlbum.groups[0].label === "Family trip" && byAlbum.groups[0].count === 1 && byAlbum.items[0].id === idOf(F.dock), JSON.stringify(byAlbum.groups.slice(0, 2)));
  const byName = await G.query({ view: "folder", fid: G.fidOf(join(PICS, "Family", "2026")), sort: "name", limit: 20 });
  check("sort by name (A→Z)", byName.items.map((x) => x.name).join() === byName.items.map((x) => x.name).sort().join() && byName.items[0].name === "Beach day 01.jpg");
  const bySize = await G.query({ view: "all", sort: "size", limit: 3 });
  check("sort by size (biggest first)", bySize.items[0].id === idOf(F.big) && bySize.items[0].size >= bySize.items[1].size, JSON.stringify(bySize.items.slice(0, 2)));
  const byDateDesc = await G.query({ view: "all", sort: "date", limit: 400 });
  check("sort by date (newest first)", byDateDesc.items.every((x, i, a) => !i || a[i - 1].t >= x.t) && byDateDesc.items[0].name === "Beach day 12.jpg");
  const fam = G.fidOf(join(PICS, "Family"));
  G.crumbs(G.find(idOf(F.fam26[0])));   // (the folder ids come from the photos' breadcrumbs)
  check("a folder with its subfolders (Family: 2026, 2025 and its own two)", (await G.query({ view: "folder", fid: fam, deep: true })).total === 22);
  check("this folder only (Family/2026)", (await G.query({ view: "folder", fid: G.fidOf(join(PICS, "Family", "2026")) })).total === 12);
  check("search words (tahoe → 6; the owner's words: fishing → 1)", (await G.query({ view: "search", q: "tahoe" })).total === 6 && (await G.query({ view: "search", q: "fishing" })).total === 1);
  check("has text (read from the picture)", (await G.query({ view: "all", text: true })).items.map((x) => x.id).join() === idOf(F.sign));
  G.setFav(idOf(F.fam26[2]), true); G.setFav(idOf(F.bulk[5]), true);
  const favs = await G.query({ view: "favs" });
  check("favourites (★ kept in gallery.json)", favs.total === 2 && JSON.parse(readFileSync(process.env.DAYSPRING_GALLERY_FILE, "utf8")).favs.length === 2);
  G.setFav(idOf(F.bulk[5]), false);
  const summer = S.dateRange("last summer", new Date("2026-09-29T12:00:00"));
  check("“last summer” (asked in September 2026) → June–August 2026", summer && new Date(summer.from).getMonth() === 5 && new Date(summer.from).getFullYear() === 2026 && new Date(summer.to).getMonth() === 8, JSON.stringify(summer));
  check("…a date range filters the photos (summer 2026: 12 beach days + the dock)", (await G.query({ view: "all", from: summer.from, to: summer.to })).total === 13);
  check("date words: “last summer” in June 2026 is 2025's, “summer 2025”, “June 2024”, “last year”, “2023”", S.dateRange("last summer", new Date("2026-06-15")).said === "last summer" && new Date(S.dateRange("last summer", new Date("2026-06-15")).from).getFullYear() === 2025
    && new Date(S.dateRange("summer 2025").from).getFullYear() === 2025 && new Date(S.dateRange("june 2024").from).getMonth() === 5 && new Date(S.dateRange("last year", new Date("2026-03-01")).from).getFullYear() === 2025 && new Date(S.dateRange("2023").to).getFullYear() === 2024 && S.dateRange("the lake") === null);
  // paging: pages join up with no gaps or repeats; the focus is found anywhere in the collection
  const p0 = await G.query({ view: "all", sort: "name", limit: 120, offset: 0 }), p1 = await G.query({ view: "all", sort: "name", limit: 120, offset: 120 });
  const whole = await G.query({ view: "all", sort: "name", limit: 240, offset: 0 });
  check("pages join up exactly (0–119 + 120–239 = 0–239)", [...p0.items, ...p1.items].map((x) => x.id).join() === whole.items.map((x) => x.id).join());
  const f = await G.query({ view: "all", sort: "name", focus: idOf(F.bulk[1500]), limit: 1 });
  check("the focus photo's place in the whole collection is found (for “View in gallery”)", f.focusIndex > 1000 && (await G.query({ view: "all", sort: "name", offset: f.focusIndex, limit: 1 })).items[0].id === idOf(F.bulk[1500]));

  section("A. 🎲 random");
  const seen = []; for (let o = 0; o < 600; o += 60) seen.push(...(await G.query({ view: "random", rs: "qa1", offset: o, limit: 60, seed: o ? undefined : 7, shuffle: o === 0 })).items.map((x) => x.id));
  check("More, ten times: 600 photos, not one repeated", seen.length === 600 && new Set(seen).size === 600);
  check("…and in a shuffled order (not the folder order)", seen.slice(0, 20).join() !== (await G.query({ view: "all", group: "folder", limit: 20 })).items.map((x) => x.id).join());
  const again = (await G.query({ view: "random", rs: "qa1", shuffle: true, offset: 0, limit: 200 })).items.map((x) => x.id);
  check("“Shuffle again”: a new order that starts with photos not seen yet this session", again.length === 200 && again.every((id) => !seen.includes(id)));
  const other = (await G.query({ view: "random", rs: "qa2", offset: 0, limit: 60, seed: 99, shuffle: true })).items.map((x) => x.id);
  check("another session has its own order", other.join() !== seen.slice(0, 60).join());
  check("random never includes a hidden or private photo", ![F.hidden, F.shot, F.tax].some((p) => seen.includes(idOf(p)) || again.includes(idOf(p))));

  section("A. where it's saved, and 📂 Open in File Explorer");
  const it26 = await G.info(idOf(F.fam26[0]));
  check("breadcrumbs: Pictures › Family › 2026, each part a folder id", it26.crumbs.map((c) => c.label).join(" › ") === "Pictures › Family › 2026" && it26.crumbs.every((c) => /^f[0-9a-f]{15}$/.test(c.fid)) && it26.crumbs.at(-1).last, JSON.stringify(it26.crumbs));
  check("…clicking a part filters to that folder (Family, with subfolders: 22)", (await G.query({ view: "folder", fid: it26.crumbs[1].fid, deep: true })).total === 22);
  check("…the full path is there too", it26.path === resolve(F.fam26[0]) && it26.where === "Pictures › Family › 2026");
  const n0 = launches().length;
  const rv = G.reveal(idOf(F.fam26[0]), { via: "screen" });
  const L = launches().at(-1);
  check("Open in File Explorer: exactly  explorer.exe /select,\"<path>\"", rv.shown && launches().length === n0 + 1 && L.exe === "explorer.exe" && L.args.length === 1 && L.args[0] === `/select,"${resolve(F.fam26[0])}"`, JSON.stringify(L));
  check("…a path with spaces stays one argument, in quotes", /^\/select,".* .*"$/.test(L.args[0]));
  const logged = activity.search({ kind: "file.open" }).entries.find((e) => e.action === "show in folder" && e.path === resolve(F.fam26[0]));
  check("…and it's in the activity log (show in folder, the path, where it came from)", Boolean(logged) && logged.via === "screen", JSON.stringify(activity.search({ kind: "file.open" }).entries[0]));
  const rdoc = G.reveal(idOf(F.doc1));
  check("a picture the finder found (Documents) opens its folder too", rdoc.shown && launches().at(-1).args[0] === `/select,"${resolve(F.doc1)}"`);
  const n1 = launches().length;
  const out = G.register(F.outside);
  check("refused outside the permitted folders (nothing opens)", out.denied && G.reveal(idOf(F.outside)).error && launches().length === n1, JSON.stringify(out));
  const sec = G.reveal("0123456789abcdef");
  check("an id it doesn't know opens nothing", Boolean(sec.error) && launches().length === n1);
  // a folder taken back (kept out) after it was shown: refused, and the refusal is logged
  const permissions = await lib("permissions.mjs");
  permissions.set({ entries: [...PERM.entries, { path: join(PICS, "Family", "2025"), kind: "folder", access: "none" }] });
  const kept = G.reveal(idOf(F.fam25[0]));
  const blocked = activity.search({ kind: "blocked" }).entries.find((e) => e.op === "show in folder");
  check("a folder kept out (Settings → Permissions) is refused, logged as blocked, nothing opens", kept.denied && Boolean(blocked) && launches().length === n1, JSON.stringify(kept));
  check("…and its photos can't be fetched either", G.fileFor(idOf(F.fam25[0])).denied === true);
  permissions.set({ entries: PERM.entries });
  const skills = await lib("finder/skills.mjs");
  const fr = skills.showInFolder({ id: idOf(F.doc2) }, { via: "voice" });
  check("the finder's “show it in the folder” uses the same command", fr.shown && launches().at(-1).args[0] === `/select,"${resolve(F.doc2)}"`, JSON.stringify(fr));

  section("A. thumbnails");
  const direct = await G.thumb(idOf(F.bulk[0]));
  check("a small JPEG is sent as it is", Boolean(direct.file));
  process.env.DAYSPRING_THUMB_DIRECT_MAX = "0"; process.env.DAYSPRING_THUMBS_MAX_MB = "0.03";
  const helper = await lib("vision/helper.mjs"); const av = await helper.available().catch(() => ({ ok: false }));
  if (av.ok) {
    const t1 = await G.thumb(idOf(F.big));
    check("a big photo: a small JPEG is made, and cached in data/thumbs", t1.buf?.length > 500 && t1.buf.length < 60_000 && readdirSync(process.env.DAYSPRING_THUMBS_DIR).length === 1, t1.error);
    const t2 = await G.thumb(idOf(F.big));
    check("…the second time it comes from the cache", t2.cached === true);
    for (const p of F.bulk.slice(0, 30)) await G.thumb(idOf(p));
    const used = readdirSync(process.env.DAYSPRING_THUMBS_DIR).reduce((a, n) => a + statSync(join(process.env.DAYSPRING_THUMBS_DIR, n)).size, 0);
    check("the thumbnail folder stays under its size cap (oldest go first)", used <= 0.03 * 1024 * 1024 && readdirSync(process.env.DAYSPRING_THUMBS_DIR).length < 31, `${used} bytes, ${readdirSync(process.env.DAYSPRING_THUMBS_DIR).length} files`);
    if (F.heic) { const th = await G.thumb(idOf(F.heic)); check("a HEIC photo's thumbnail (Windows decodes it)", th.buf?.[0] === 0xff && th.buf[1] === 0xd8, th.error); }
  } else console.log("SKIP  thumbnails need the picture helper (bin/Dayspring Vision.exe): " + (av.error ?? ""));
  delete process.env.DAYSPRING_THUMB_DIRECT_MAX; delete process.env.DAYSPRING_THUMBS_MAX_MB;

  section("A. voice (no AI)");
  const say = async (t, ctx = {}) => { events.length = 0; const r = await S.command(t, ctx); return { r, ev: events.at(-1) ?? null }; };
  let x = await say("open the photo gallery");
  check("“open the photo gallery”", x.r?.intent === "gallery.open" && x.ev?.open?.view === "all");
  x = await say("show my photos from last summer");
  check("“show my photos from last summer” → a date range, grouped by month", x.ev?.open?.from && x.ev.open.to && x.ev.open.group === "date" && /last summer/.test(x.r.reply), JSON.stringify(x));
  x = await say("show photos in the Family folder");
  check("“show photos in the Family folder” → that folder, with its subfolders", x.ev?.open?.view === "folder" && G.folderOf(x.ev.open.fid)?.toLowerCase() === join(PICS, "Family").toLowerCase() && x.ev.open.deep === true, JSON.stringify(x));
  x = await say("show me pictures in the Lake Tahoe folder");
  check("…“the Lake Tahoe folder”", G.folderOf(x.ev?.open?.fid)?.toLowerCase() === join(PICS, "Trips", "Lake Tahoe").toLowerCase());
  for (const t of ["show me random photos", "shuffle my photos", "surprise me with a photo"]) { x = await say(t); check(`“${t}” → 🎲 random`, x.ev?.open?.view === "random"); }
  x = await say("view this in the gallery", { photo: idOf(F.fam26[3]) });
  check("“view this in the gallery” (the photo on the TV) → its folder, that photo open", x.ev?.open?.view === "folder" && x.ev.open.focus === idOf(F.fam26[3]) && x.ev.open.single === true);
  const n2 = launches().length;
  x = await say("open this photo's folder", { photo: idOf(F.fam26[4]) });
  check("“open this photo's folder” → File Explorer with it selected", x.r?.revealed && launches().length === n2 + 1 && launches().at(-1).args[0] === `/select,"${resolve(F.fam26[4])}"`, JSON.stringify(x.r));
  G.setState({ open: true, id: idOf(F.tahoe[1]), single: true });
  x = await say("show me where this is saved");
  check("“show me where this is saved” → the photo open in the gallery", x.r?.revealed && launches().at(-1).args[0] === `/select,"${resolve(F.tahoe[1])}"`);
  for (const [t, c] of [["next", "next"], ["previous", "prev"], ["scroll right", "next"], ["scroll left", "prev"], ["start a slideshow", "slideshow"], ["shuffle again", "shuffle"], ["close the gallery", "close"]]) { x = await say(t); check(`while it's open: “${t}”`, x.ev?.ctl?.ctl === c, JSON.stringify(x)); }
  G.setState({ open: false });
  x = await say("next");
  check("“next” with the gallery closed is left for the rest of Dayspring", x.r === null);
  for (const t of ["find photos from the lake", "show me pictures of golden retrievers", "show me another photo", "what's the weather", "show me the birthday pictures from 2024"]) check(`not the gallery's: “${t}”`, (await S.command(t)) === null);
}

// =================================================================================================================== B
if (!ONLY || ONLY === "B") {
  section("B. the server and the screen");
  writeFileSync(permFile, JSON.stringify(PERM));
  try { rmSync(process.env.DAYSPRING_FILEINDEX_FILE, { force: true }); } catch { /* fine */ }
  // playwright-core: QA_PLAYWRIGHT, else this copy's own, else the exported copy next to this project (…/dayspring-app)
  const PW = process.env.QA_PLAYWRIGHT ?? pathToFileURL([join(APP, "node_modules", "playwright-core", "index.mjs"), join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
  const { chromium } = await import(PW);
  const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const PORT = await qaPort(4776), BASE = `http://127.0.0.1:${PORT}`;
  const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
  const j = async (path, body) => { const r = await fetch(BASE + "/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const up = await until(async () => (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok, 60_000);
  check("the throwaway server is up", Boolean(up), log.slice(-300));
  await j("/viewer/scan", {});
  const ready = await until(async () => (await j("/gallery/list?view=all&limit=1")).body.total >= 2030, 60_000);
  check("the gallery over HTTP: every photo", Boolean(ready), JSON.stringify((await j("/gallery/list?view=all&limit=1")).body).slice(0, 200));
  const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] } : { headless: true, args: ["--mute-audio"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    window.__dsAllowAutomatedListen = true;
    const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; }
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
    window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
  });
  const DEVICE_ROUTES = /\/api\/(sound|window|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge|open|app\/quit|update)/;
  await ctx.route("**/*", (rt) => { const u = rt.request().url(); if (rt.request().method() === "POST" && DEVICE_ROUTES.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); return rt.continue(); });
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
  await page.goto(BASE + "/display"); await page.waitForTimeout(2200);
  if (await page.locator("#startBtn").isVisible().catch(() => false)) { await page.click("#startBtn"); await page.waitForTimeout(600); }
  const st = () => page.evaluate(() => window.dsGallery.state());

  try {
    // ---- the grid: 2,000+ photos, only what's on the screen drawn
    await page.evaluate(() => window.dsGallery.open({ view: "all", group: "none", sort: "name" }));
    await until(async () => (await st()).total > 2000 && (await st()).drawn?.cells > 0, 8000);
    let s = await st();
    const cells = await page.evaluate(() => document.querySelectorAll("#dsGallery .g-cell").length);
    check(`the grid opens with ${s.total} photos, but only ${cells} cells are drawn`, s.total >= 2030 && cells > 10 && cells < 400, JSON.stringify(s.drawn));
    await until(() => page.evaluate(() => document.querySelectorAll("#dsGallery .g-cell img").length > 10), 6000);
    check("…the thumbnails load (lazily, from /api/gallery/thumb)", Boolean(await until(() => page.evaluate(() => [...document.querySelectorAll("#dsGallery .g-cell img")].filter((i) => i.complete && i.naturalWidth > 0).length > 5), 6000)), await page.evaluate(() => [...document.querySelectorAll("#dsGallery .g-cell img")].slice(0, 2).map((i) => i.src + " " + i.complete + " " + i.naturalWidth).join(" | ")));
    await page.evaluate(() => { const g = document.querySelector("#dsGallery .g-grid"); g.scrollTop = g.scrollHeight; });
    await until(async () => (await st()).drawn?.hi === (await st()).total - 1 && (await page.evaluate(() => document.querySelectorAll("#dsGallery .g-cell[data-id]").length)) > 5, 8000);
    s = await st();
    const cells2 = await page.evaluate(() => document.querySelectorAll("#dsGallery .g-cell").length);
    check("scrolled to the end: the last photos are drawn and loaded, still only a screenful of cells", s.drawn.hi === s.total - 1 && cells2 < 400 && s.loaded >= 2, JSON.stringify({ drawn: s.drawn, loaded: s.loaded, cells2 }));
    // grouping on the screen
    await page.selectOption("#dsGallery [data-g=group]", "folder");
    await until(async () => (await st()).groups > 5, 6000);
    check("group by folder on the screen: folder headers", (await page.evaluate(() => [...document.querySelectorAll("#dsGallery .g-head")].map((h) => h.textContent).join("|"))).includes("Pictures › Bulk › Part 01"));
    await page.selectOption("#dsGallery [data-g=group]", "date");
    await until(async () => (await st()).group === "date", 4000);
    check("group by month: month headers", Boolean(await until(() => page.evaluate(() => /2026/.test(document.querySelector("#dsGallery .g-head")?.textContent ?? "")), 5000)), await page.evaluate(() => [...document.querySelectorAll("#dsGallery .g-head")].slice(0, 3).map((h) => h.textContent).join("|")));

    // ---- one photo: Back / Next across the whole collection, the filmstrip, the ends
    await page.evaluate(() => window.dsGallery.open({ view: "all", group: "none", sort: "name" }));
    await until(async () => (await st()).total > 2000, 6000);
    await page.click("#dsGallery .g-cell[data-i='0']");
    await until(async () => (await st()).single && (await st()).name, 4000);
    s = await st();
    check("clicking a photo opens it big, with “1 of N”", s.single && s.index === 0 && (await page.textContent("#dsGallery .gs-pos")) === `1 of ${s.total.toLocaleString("en-US")}`);
    await until(async () => (await st()).path, 4000);
    s = await st();
    check("its location is always shown: the breadcrumbs and the full path", s.crumbs.length >= 2 && /.(jpg|png)$/.test(s.path) && s.path.includes("Pictures"), JSON.stringify({ c: s.crumbs, p: s.path }));
    // jump near the first page's end (120), then Next across it
    await page.evaluate(() => window.dsGallery.open({ view: "all", group: "none", sort: "name", focus: window.dsGallery._item(117)?.id, single: true }));
    await until(async () => (await st()).index === 117 && (await st()).single, 5000);
    for (let k = 0; k < 6; k++) { await page.click("#dsGallery .gs-next"); await page.waitForTimeout(60); }
    await until(async () => (await st()).index === 123 && (await st()).name, 5000);
    s = await st();
    const want = (await j(`/gallery/list?view=all&group=none&sort=name&offset=123&limit=1`)).body.items[0];
    check("Next ▶ goes on past the first page (118 → 124): more loads as it goes", s.index === 123 && s.name === want.name, JSON.stringify({ i: s.index, n: s.name, want: want.name }));
    check("“124 of N”", (await page.textContent("#dsGallery .gs-pos")).startsWith("124 of "));
    check("the filmstrip marks the same photo", await page.evaluate(() => document.querySelector("#dsGallery .gs-t.on")?.dataset.t === "123"));
    await page.keyboard.press("ArrowLeft"); await until(async () => (await st()).index === 122, 3000);
    check("← goes back", (await st()).index === 122);
    await page.locator("#dsGallery .gs-stage").hover(); await page.mouse.wheel(0, 120);
    await until(async () => (await st()).index === 123, 3000);
    check("the wheel on the photo moves to the next one", (await st()).index === 123);
    const box = await page.locator("#dsGallery .gs-stage").boundingBox();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
    await until(async () => (await st()).index === 124, 3000);
    check("a swipe (drag) to the left moves on", (await st()).index === 124);
    // the filmstrip: scroll it to the far right; it keeps loading; click a photo there
    const loadedBefore = (await st()).loaded;
    await page.evaluate(() => { const s = document.querySelector("#dsGallery .gs-strip"); s.scrollLeft = s.scrollWidth; });
    await until(async () => (await st()).strip?.last === (await st()).total - 1 && (await page.evaluate(() => document.querySelectorAll("#dsGallery .gs-t img").length)) > 3, 8000);
    s = await st();
    check("scrolling the filmstrip to the right loads the photos out there (the whole collection, not just 10)", s.strip.last === s.total - 1 && s.loaded > loadedBefore && (await page.evaluate(() => document.querySelectorAll("#dsGallery .gs-t").length)) < 120, JSON.stringify({ strip: s.strip, loaded: s.loaded }));
    await page.evaluate(() => { const s = document.querySelector("#dsGallery .gs-strip"); s.scrollLeft -= 200; });
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 0);
    const pick = await page.evaluate(() => { const b = [...document.querySelectorAll("#dsGallery .gs-t")].find((x) => { const r = x.getBoundingClientRect(); return r.left > 20 && r.right < innerWidth - 20; }); return b ? Number(b.dataset.t) : -1; });
    await page.click(`#dsGallery .gs-t[data-t='${pick}']`);
    await until(async () => (await st()).index === pick, 4000);
    check("clicking a photo in the filmstrip shows it big (they stay in step)", (await st()).index === pick && await page.evaluate((p) => document.querySelector("#dsGallery .gs-t.on")?.dataset.t === String(p), pick));
    const sl0 = await page.evaluate(() => document.querySelector("#dsGallery .gs-strip").scrollLeft);
    await page.locator("#dsGallery .gs-strip").hover(); await page.mouse.wheel(0, 400); await page.waitForTimeout(250);
    check("the wheel over the filmstrip scrolls it sideways", (await page.evaluate(() => document.querySelector("#dsGallery .gs-strip").scrollLeft)) !== sl0);
    // the ends
    await page.locator("#dsGallery .gs-stage").focus(); await page.keyboard.press("End");
    await until(async () => (await st()).index === (await st()).total - 1, 5000);
    await page.click("#dsGallery .gs-next");
    s = await st();
    check("at the end: it stays, and says so clearly", s.index === s.total - 1 && /last photo here/.test(s.note), s.note);
    await page.click("#dsGallery .gs-next");
    await until(async () => (await st()).index === 0, 4000);
    check("…one more Next starts over from the first", (await st()).index === 0);
    // 📂 from the single view: the path link and the button
    await until(async () => (await st()).path, 3000);
    let n = launches().length; const path0 = (await st()).path;
    await page.click("#dsGallery .gs-path");
    await until(() => launches().length === n + 1, 4000);
    check("clicking the full path opens File Explorer with the photo selected", launches().length === n + 1 && launches().at(-1).args[0] === `/select,"${path0}"`, JSON.stringify(launches().at(-1)));
    n = launches().length;
    await page.click("#dsGallery .gs-loc .gb[data-s=reveal]");
    await until(() => launches().length === n + 1, 4000);
    check("📂 Open in File Explorer does the same", launches().at(-1)?.args[0] === `/select,"${path0}"`);
    // a breadcrumb part filters the gallery to that folder
    await page.evaluate(() => window.dsGallery.openFor);
    const fam0 = idOf(F.fam26[0]);
    await page.evaluate((id) => window.dsGallery.openFor(id), fam0);
    await until(async () => (await st()).id === fam0, 5000);
    s = await st();
    check("🖼 View in gallery: its folder (12), with that photo open", s.single && s.total === 12 && s.view === "folder", JSON.stringify(s));
    await page.click("#dsGallery .gs-crumbs .crumb >> text=Family");
    await until(async () => !(await st()).single && (await st()).total === 22, 5000);
    check("clicking “Family” in the breadcrumbs shows that folder's photos (with its subfolders: 22)", (await st()).total === 22 && await page.evaluate(() => !document.querySelector("#dsGallery .g-crumbs").hidden));
    await page.click("#dsGallery .g-crumbs input[data-g=deep]");
    await until(async () => (await st()).total === 2, 4000);
    check("…“This folder only”: just Family's own two", (await st()).total === 2);
    // slideshow
    await page.evaluate(() => window.dsGallery.open({ view: "folder", fid: null }));
    await page.evaluate((id) => window.dsGallery.openFor(id), fam0);
    await until(async () => (await st()).single, 4000);
    await page.click("#dsGallery [data-s=show]");
    check("▶ Slideshow runs", (await st()).slideshow);
    await page.click("#dsGallery [data-s=show]");
    // ★
    await page.click("#dsGallery [data-s=fav]");
    await until(async () => (await j("/gallery/list?view=favs")).body.items.some((x) => x.id === fam0), 3000);
    check("☆ makes it a favourite", (await j("/gallery/list?view=favs")).body.items.some((x) => x.id === fam0));
    await page.click("#dsGallery [data-s=info]");
    await until(() => page.evaluate(() => /Folder/.test(document.querySelector("#dsGallery .gs-info")?.textContent ?? "")), 3000);
    check("ℹ Info: date, size, dimensions, folder", await page.evaluate(() => { const t = document.querySelector("#dsGallery .gs-info").textContent; return /Date/.test(t) && /Size/.test(t) && /Dimensions/.test(t) && /Pictures › Family › 2026/.test(t); }));

    // ---- 🎲 random
    await page.keyboard.press("Escape");
    await page.click("#dsGallery [data-g=tab][data-view=random]");
    await until(async () => (await st()).view === "random" && (await st()).total > 2000, 5000);
    s = await st();
    check("🎲 Random: a shuffled grid, a first helping", s.shown === 60 && await page.isVisible("#dsGallery [data-g=shuffle]"));
    const firstIds = await page.evaluate(() => [...document.querySelectorAll("#dsGallery .g-cell[data-id]")].slice(0, 12).map((c) => c.dataset.id));
    await page.click("#dsGallery [data-g=more]");
    await until(async () => (await st()).shown >= 120, 3000);
    check("More: more photos, none repeated", (await st()).shown >= 120);
    await page.evaluate(() => { const g = document.querySelector("#dsGallery .g-grid"); g.scrollTop = 0; });
    await page.waitForTimeout(200);
    await page.click("#dsGallery .g-cell[data-i='5']");
    await until(async () => (await st()).single && (await st()).index === 5, 4000);
    const r5 = (await st()).id;
    await page.click("#dsGallery .gs-next");
    await until(async () => (await st()).index === 6, 3000);
    const r6 = (await st()).id;
    check("opening a random photo: Back/Next go through that shuffled set", r5 && r6 && r5 !== r6 && await page.evaluate(() => window.dsGallery._item(6)?.id) === r6);
    await page.click("#dsGallery [data-s=grid]");
    await page.click("#dsGallery [data-g=shuffle]");
    await until(async () => { const ids = await page.evaluate(() => [...document.querySelectorAll("#dsGallery .g-cell[data-id]")].slice(0, 12).map((c) => c.dataset.id)); return ids.length === 12 && ids.join() !== firstIds.join(); }, 6000);
    const newIds = await page.evaluate(() => [...document.querySelectorAll("#dsGallery .g-cell[data-id]")].slice(0, 12).map((c) => c.dataset.id));
    check("Shuffle again: a new order, starting with ones not seen yet", newIds.length === 12 && newIds.every((id) => !firstIds.includes(id)));
    await page.click("#dsGallery .g-x");

    // ---- the two actions on the rotating photo card and the photo's detail (question) card
    const jumped = await page.evaluate(() => { const d = document.querySelector("[data-jump=photo]"); if (d) { d.click(); return true; } return false; });
    await until(() => page.evaluate(() => document.querySelectorAll("#vPhoto .dsg-acts .dsg-a").length === 2), 8000);
    const pid = await page.evaluate(() => document.querySelector("#vPhoto .dsg-a")?.dataset.galId);
    check("the rotating photo card has 📂 Open file location and 🖼 View in gallery", jumped && isIdLike(pid), pid);
    n = launches().length;
    await page.evaluate(() => document.querySelector("#vPhoto [data-gal-act=loc]").click());
    await until(() => launches().length === n + 1, 4000);
    check("…📂 on the card opens File Explorer with that photo selected (and the card's own click doesn't fire)", launches().length === n + 1 && /\/select,".*Pictures/.test(launches().at(-1).args[0]) && !(await page.evaluate(() => document.querySelector("#detail") && !document.querySelector("#detail").hidden)));
    await page.evaluate(() => document.querySelector("#vPhoto [data-gal-act=gal]").click());
    await until(async () => (await st()).single && (await st()).id === pid, 5000);
    check("…🖼 on the card opens the gallery on that photo, in its folder", (await st()).id === pid && (await st()).view === "folder");
    await page.evaluate(() => window.dsGallery.close());
    await page.evaluate(() => document.querySelector("#vPhoto .photo img")?.click());
    const detailActs = await until(() => page.evaluate(() => document.querySelectorAll("#dBody .dnav .dsg-a").length === 2), 5000);
    check("the photo's detail card (where “What's this one?” is asked) has both too", Boolean(detailActs));
    await page.keyboard.press("Escape");

    // ---- the file viewer: its location bar, 🖼, and the filmstrip
    const vid = idOf(F.doc2);
    await page.evaluate(async (id) => { const r = await fetch(`/api/viewer/info?id=${id}`).then((x) => x.json()); window.dsViewer.open({ item: r }); }, vid);
    await until(() => page.evaluate(() => document.querySelectorAll("#dsViewer .vw-loc .dsg-a").length === 2 && /Documents/.test(document.querySelector("#dsViewer .vw-loc .crumbs")?.textContent ?? "")), 6000);
    check("the file viewer's picture: “📂 Documents › Trip Photos” and both actions", await page.evaluate(() => /Documents › Trip Photos/.test(document.querySelector("#dsViewer .vw-loc .crumbs").textContent)));
    await until(() => page.evaluate(() => document.querySelectorAll("#dsViewer .vw-strip button").length >= 3), 5000);
    check("…and a filmstrip of the pictures next to it", await page.evaluate(() => document.querySelectorAll("#dsViewer .vw-strip button").length >= 3 && Boolean(document.querySelector("#dsViewer .vw-strip button.on"))));
    await page.click("#dsViewer .vw-strip button:not(.on)");
    await until(() => page.evaluate((v) => window.dsViewer.state().id !== v, vid), 4000);
    check("…clicking one there opens it", await page.evaluate((v) => window.dsViewer.state().id !== v, vid));
    n = launches().length;
    await page.click("#dsViewer .vw-loc [data-gal-act=loc]");
    await until(() => launches().length === n + 1, 4000);
    check("…📂 Open file location from the viewer", launches().at(-1)?.args[0]?.includes("Trip Photos"));
    await page.click("#dsViewer .vw-loc [data-gal-act=gal]");
    await until(async () => (await st()).single, 5000);
    check("…🖼 View in gallery from the viewer (the viewer steps aside)", (await st()).single && !(await page.evaluate(() => window.dsViewer.state().open)));
    await page.evaluate(() => window.dsGallery.close());

    // ---- the finder's list, the media list, a saved web picture
    await page.evaluate((id) => window.dsViewer.showList("Files like “canyon”", [{ n: 1, id, name: "Canyon 1.jpg", kind: "image", where: "Documents\\Trip Photos", sizeText: "1 KB", when: "today", type: "picture" }, { n: 2, id: "0123456789abcdef", name: "notes.txt", kind: "text", where: "Documents", sizeText: "1 KB", when: "today", type: "text" }]), idOf(F.doc1));
    check("the finder's list: a picture gets both actions, a text file doesn't", await page.evaluate(() => document.querySelectorAll('#dsFinder li[data-n="1"] .dsg-a').length === 2 && !document.querySelector('#dsFinder li[data-n="2"] .dsg-a')));
    n = launches().length;
    await page.click('#dsFinder li[data-n="1"] [data-gal-act=loc]');
    await until(() => launches().length === n + 1, 4000);
    check("…📂 there opens its folder, and doesn't open the file", launches().length === n + 1 && !(await page.evaluate(() => window.dsViewer.state().open)));
    await page.evaluate(() => window.dsViewer.closeList());
    await page.evaluate((id) => window.dsMediaLib.showList({ title: "Your pictures", items: [{ n: 1, id, kind: "image", title: "Canyon 3", where: "Trip Photos", source: "local" }, { n: 2, id: "d:abc", kind: "image", title: "From Drive", source: "drive" }] }), idOf(F.doc3));
    check("the media list: his own picture has both; a Drive picture doesn't (no folder here)", await page.evaluate(() => document.querySelectorAll('.mlpanel li[data-n="1"] .dsg-a').length === 2 && !document.querySelector('.mlpanel li[data-n="2"] .dsg-a')));
    await page.evaluate(() => window.dsMediaLib.closeList());
    await page.evaluate(() => window.dsMediaLib.showImage({ src: "/api/drive/stream?ref=x", title: "Drive photo" }));
    check("the Drive picture show says it's in Google Drive", await page.evaluate(() => /Google Drive/.test(document.querySelector(".mlimg p")?.textContent ?? "") && !document.querySelector(".mlimg .dsg-a")));
    await page.evaluate(() => document.querySelector(".mlimg")?.click());
    // a web picture: Save to my photos first, then the two actions
    const saved = idOf(F.tahoe[0]);
    await page.route("**/api/images/act", (rt) => rt.request().postDataJSON()?.action === "save" ? rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: { name: "x.png", where: "pictures", id: saved } }) }) : rt.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-images", { detail: { open: true, query: "sunsets", filters: {}, items: [{ n: 1, title: "Sunset", thumb: "" }], selected: 1, big: { n: 1, title: "Sunset", thumb: "", sourceDomain: "example.org" } } })));
    check("a web picture: no file location yet, “Save to my photos” first", await page.evaluate(() => /Save to my photos/.test(document.querySelector("#dsImages [data-save]")?.textContent ?? "") && !document.querySelector("#dsImages .dsg-a")));
    await page.click("#dsImages [data-save]");
    await until(() => page.evaluate(() => document.querySelectorAll("#dsImages .dsg-a").length === 2), 4000);
    check("…once saved: 📂 Open file location and 🖼 View in gallery", await page.evaluate(() => document.querySelectorAll("#dsImages .dsg-a").length === 2));
    await page.unroute("**/api/images/act");
    await page.evaluate(() => window.dsImages.close());

    // ---- voice through /api/chat (no AI here)
    const chat = (message) => j("/chat", { message, surface: "tv" });
    let c = await chat("open the photo gallery");
    await until(async () => (await st()).open, 5000);
    check("voice: “open the photo gallery”", c.body.intent === "gallery.open" && (await st()).open);
    c = await chat("show my photos from last summer");
    await until(async () => /last summer/.test((await st()).title ?? ""), 5000);
    s = await st();
    check("voice: “show my photos from last summer” (summer 2026: 13)", /last summer/.test(s.title) && s.total === 13, JSON.stringify({ t: s.title, n: s.total }));
    c = await chat("show photos in the Family folder");
    await until(async () => (await st()).total === 22, 5000);
    check("voice: “show photos in the Family folder”", (await st()).total === 22);
    c = await chat("surprise me with a photo");
    await until(async () => (await st()).view === "random", 5000);
    check("voice: “surprise me with a photo” → 🎲", (await st()).view === "random");
    await page.evaluate((id) => window.dsGallery.openFor(id), idOf(F.fam26[5]));
    await until(async () => (await st()).single && (await st()).id === idOf(F.fam26[5]), 5000);
    const i0 = (await st()).index;
    await page.waitForTimeout(500);
    c = await chat("next");
    await until(async () => (await st()).index === i0 + 1, 4000);
    check("voice: “next” moves on (the gallery tells the server what's open)", (await st()).index === i0 + 1, JSON.stringify(c.body));
    c = await chat("scroll left");
    await until(async () => (await st()).index === i0, 4000);
    check("voice: “scroll left”", (await st()).index === i0);
    await page.waitForTimeout(500);
    n = launches().length;
    c = await chat("show me where this is saved");
    await until(() => launches().length === n + 1, 4000);
    check("voice: “show me where this is saved” → File Explorer on the photo that's open", launches().at(-1)?.args[0] === `/select,"${resolve(F.fam26[5])}"`, JSON.stringify(c.body));
    const local = await page.evaluate(() => { for (const f of window.dsLocal) { const r = f("start a slideshow"); if (r) return r; } return null; });
    check("on the screen, instantly: “start a slideshow”", /Slideshow/.test(String(local)) && (await st()).slideshow);
    await page.evaluate(() => { for (const f of window.dsLocal) if (f("close the gallery")) break; });
    check("…and “close the gallery”", !(await st()).open);

    // ---- the People page (its photos: both actions, and all of them in the gallery)
    const pp = await ctx.newPage();
    const ids = [F.fam26[0], F.fam26[1], F.fam26[2]].map(idOf);
    await pp.route("**/api/people", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ people: [{ id: "p1", name: "Test Person", photos: 3 }], faces: false }) }));
    await pp.route("**/api/people/p1*", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "p1", name: "Test Person", faces: { photos: 3, photoIds: ids, thumb: null }, connections: [], prayer: [], goals: [], events: { upcoming: [], past: [] }, messages: [], calls: [], notes: [] }) }));
    await pp.route("**/api/people/questions", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: '{"matches":[],"suggestions":[]}' }));
    await pp.goto(BASE + "/people.html?id=p1");
    await until(() => pp.evaluate(() => document.querySelectorAll(".thumbs .dsg-a").length === 6), 6000);
    check("the People page: each photo has 📂 and 🖼", await pp.evaluate(() => document.querySelectorAll(".thumbs .dsg-a").length === 6));
    await pp.click(".thumbs figure:nth-child(2) [data-gal-act=gal]");
    await until(() => pp.evaluate(() => window.dsGallery.state().single), 5000);
    const ps = await pp.evaluate(() => window.dsGallery.state());
    check("…🖼 opens the gallery with that person's photos, on that one", ps.view === "set" && ps.total === 3 && ps.id === ids[1], JSON.stringify(ps));
    n = launches().length;
    await pp.evaluate(() => window.dsGallery.close());
    await pp.click(".thumbs figure:nth-child(3) [data-gal-act=loc]");
    await until(() => launches().length === n + 1, 4000);
    check("…📂 opens its folder", launches().at(-1)?.args[0] === `/select,"${resolve(F.fam26[2])}"`);
    await pp.close();
    check("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  } catch (e) { check("the screen checks ran to the end", false, e.stack?.slice(0, 500)); try { await page.screenshot({ path: join(TMP, "gallery-fail.png") }); console.log("screenshot:", join(TMP, "gallery-fail.png")); } catch { /* fine */ } }
  await browser.close();
  server.kill();
  await sleep(500);
}
function isIdLike(s) { return /^[a-f0-9]{16}$/.test(String(s ?? "")); }
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nALL PASSED: ${pass} passed`);
process.exit(fail ? 1 : 0);
