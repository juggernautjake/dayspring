// GIF checks, on a throwaway copy of Dayspring (port 4798) against local mock GIF providers: no live API is ever
// contacted (GIPHY, KLIPY, Imgur and the web search are all the mock), nothing of the owner's is touched (their data,
// their Pictures folder, their clipboard, their Chrome), and no real key is used.
//   A. in-process: each provider's fixture parses; the parallel search merges fairly, labels sources and drops
//      duplicates across providers and anything rated too high; one slow, one failing and one rate-limited provider
//      (time limit, retries, the circuit breaker, Retry-After) never hold up the rest; results come out progressively;
//      the keyless web fallback works with zero keys; caches (memory, trending on disk); the media proxy's refusals
//      (this computer, the home network, redirects there, too big, not a GIF); files, saving (Pictures when allowed,
//      else data\gifs, logged), settings, favourites, keys (never logged), key tests, what people say, the AI's tools
//   B. the real server and ONE headless Chrome: the picker searches, streams, numbers the tiles, drops a broken tile and
//      a look-alike, filters by source, rating and type, shows chips for providers in trouble, previews, copies a
//      link, saves (respecting permissions), picks (onPick gets the file), answers voice ("number 3", "more", "pick
//      number 2"), works from the keyboard, fits the safe area, and Settings → GIFs saves, tests keys and reorders
//   node scripts/qa/gifs.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(DESK, "scripts", "qa", "fixtures", "gifs"), IMGFIX = join(DESK, "scripts", "qa", "fixtures", "images");
const PW = process.env.QA_PLAYWRIGHT ?? pathToFileURL([join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 4798, BASE = `http://127.0.0.1:${PORT}`;
const KEEP = process.argv.includes("--keep");
const TMP = mkdtempSync(join(tmpdir(), "ds-gifs-")), APP = join(TMP, "app"), PICS = join(TMP, "Pictures");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 300) + ")" : ""}`); };
const fx = (f) => readFileSync(join(FIX, f), "utf8");

// ---- a copy of the app (code only; its own empty data) ------------------------------------------------------------------
const SKIP = new Set(["data", ".env", "node_modules", "backups", "dist", "dist-out", "bin", "updates", "logs", ".git", "qa-out"]);
for (const e of readdirSync(DESK)) if (!SKIP.has(e) && !/\.tmp\./.test(e)) cpSync(join(DESK, e), join(APP, e), { recursive: true, filter: (s) => !/[\\/]docs[\\/](images|dev[\\/]badge-previews)[\\/]/.test(s) });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true }); mkdirSync(PICS, { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const KEYS = { GIPHY_API_KEY: "giphy-good-000111", KLIPY_API_KEY: "klipy-good-000222", IMGUR_CLIENT_ID: "imgur-good-000333" };
Object.assign(process.env, {
  DAYSPRING_PERMISSIONS_FILE: join(APP, "data", "permissions.json"), DAYSPRING_IMAGE_PREFS_FILE: join(APP, "data", "image-search.json"),
  DAYSPRING_GIFS_FILE: join(APP, "data", "gifs.json"), DAYSPRING_GIFS_DIR: join(APP, "data", "gifs"), DAYSPRING_PICTURES_DIR: PICS,
  DAYSPRING_ENV_FILE: join(APP, ".env"), DAYSPRING_SETTINGS_FILE: join(APP, "data", "settings.json"), DAYSPRING_ACTIVITY_DIR: join(APP, "data", "logs", "activity"),
  DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_NO_HEADLESS_SEARCH: "1", DAYSPRING_GIFS_CLIPBOARD: "dry", DAYSPRING_CHANNEL: "dev",
  BRAVE_SEARCH_API_KEY: "", GOOGLE_CSE_KEY: "", GOOGLE_CSE_ID: "", BING_IMAGE_SEARCH_KEY: "", ...KEYS,
});

// ---- tiny GIFs: 8×8, a pattern from the name (so two names never look alike, and "same" always looks the same) --------
function gifBytes(seed) {
  const bits = createHash("sha1").update(String(seed)).digest();
  const px = Array.from({ length: 64 }, (_, i) => ((bits[i >> 3] >> (i & 7)) & 1) ? 1 : 0);
  const codes = []; for (const p of px) codes.push(4, p); codes.push(5);          // clear, pixel … end (3-bit codes, never grows)
  const out = []; let acc = 0, n = 0; for (const c of codes) { acc |= c << n; n += 3; while (n >= 8) { out.push(acc & 255); acc >>= 8; n -= 8; } } if (n) out.push(acc & 255);
  const blocks = []; for (let i = 0; i < out.length; i += 255) { const b = out.slice(i, i + 255); blocks.push(b.length, ...b); }
  return Buffer.from([...Buffer.from("GIF89a"), 8, 0, 8, 0, 0x91, 0, 0, 0, 0, 0, 255, 255, 255, 220, 40, 40, 40, 40, 220, 0x2c, 0, 0, 0, 0, 8, 0, 8, 0, 0, 2, ...blocks, 0, 0x3b]);
}
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(12, 0)]);

// ---- the mock providers and GIF hosts -----------------------------------------------------------------------------------
const mode = { giphy: "ok", klipy: "ok", imgur: "ok", ddg: "ok" };
const delay = { giphy: 0, klipy: 0, imgur: 0, ddg: 0 };
const hits = { giphy: 0, klipy: 0, imgur: 0, ddg: 0, media: 0 };
const last = { giphy: null, klipy: null, imgur: null, ddg: null };
const rewrite = (json, prefix) => JSON.parse(JSON.stringify(json).replace(/"(g[A-C]\d|k\d|i\d[ab]?|dancing-cat-by-happy-pets-k1|totally-different-k2|broken-k3|cat-in-a-box-k4|dance-dance-k5|happy-kitten-k6)"/g, (m, id) => `"${prefix}${id}"`).replace(/\/m\/(g[A-C]\d|k\d|i\d)/g, `/m/${prefix}$1`));
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname;
  const json = (o, code = 200, h = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(typeof o === "string" ? o : JSON.stringify(o)); };
  const html = (s, code = 200) => { res.writeHead(code, { "content-type": "text/html" }); res.end(s); };
  const provider = p.startsWith("/v1/") ? "giphy" : p.startsWith("/api/v1/") ? "klipy" : p.startsWith("/3/") ? "imgur" : (p === "/" && u.searchParams.get("iax")) || p === "/i.js" ? "ddg" : null;
  if (provider) {
    hits[provider]++;
    last[provider] = { path: p, q: Object.fromEntries(u.searchParams), auth: req.headers.authorization ?? null };
    if (delay[provider]) await sleep(delay[provider]);
    const m = mode[provider];
    if (m === "fail") return json({ message: "boom" }, 500);
    if (m === "429") return json({ message: "Too many requests" }, 429, { "retry-after": "120" });
    if (m === "hang") return;                                              // never answers
  }
  if (provider === "giphy") {
    if (u.searchParams.get("api_key") !== KEYS.GIPHY_API_KEY && u.searchParams.get("api_key") !== "giphy-good-000999") return json({ message: "Invalid authentication credentials" }, 401);
    if (p === "/v1/gifs/categories") return json(fx("giphy-categories.json"));
    const off = Number(u.searchParams.get("offset")) || 0;
    const base = JSON.parse(fx("giphy-search.json"));
    let j = off ? rewrite(base, `p${off}`) : base;
    if (p.startsWith("/v1/stickers/")) { j = rewrite(base, "st"); for (const x of j.data) x.is_sticker = 1; }
    if (p.endsWith("/trending")) j = rewrite(base, "tr");
    if (u.searchParams.get("q") === "slow test") j = rewrite(base, "sl");
    j.pagination.offset = off;
    const r = u.searchParams.get("rating"); if (r === "g") j.data = j.data.filter((x) => x.rating === "g");
    return json(j);
  }
  if (provider === "klipy") {
    const key = decodeURIComponent(p.split("/")[3]);
    if (key !== KEYS.KLIPY_API_KEY) return json({ result: false, message: "invalid key" }, 403);
    if (p.endsWith("/categories")) return json(fx("klipy-categories.json"));
    const page = Number(u.searchParams.get("page")) || 1;
    let j = JSON.parse(fx("klipy-search.json"));
    if (page > 1) j = rewrite(j, `p${page}`);
    if (p.includes("/stickers/")) j = rewrite(j, "st");
    if (p.endsWith("/trending")) j = rewrite(j, "tr");
    if (u.searchParams.get("q") === "slow test") j = rewrite(j, "sl");
    j.data.current_page = page;
    return json(j);
  }
  if (provider === "imgur") {
    if (req.headers.authorization !== `Client-ID ${KEYS.IMGUR_CLIENT_ID}`) return json({ data: { error: "Invalid client_id" }, success: false, status: 403 }, 403);
    const pg = Number(p.split("/").pop()) || 0;
    let j = JSON.parse(fx("imgur-search.json")); if (pg) j = rewrite(j, `p${pg}`); if (p.includes("/viral/")) j = rewrite(j, "tr"); if (u.searchParams.get("q") === "slow test") j = rewrite(j, "sl");
    return json(j);
  }
  if (provider === "ddg") {
    if (p === "/") return html(readFileSync(join(IMGFIX, "ddg-page.html"), "utf8"));
    last.ddg.kp = last.ddg.kp ?? null;
    return json(u.searchParams.get("q")?.startsWith("slow test") ? rewrite(JSON.parse(fx("ddg-gif.json")), "sl") : fx("ddg-gif.json"));
  }
  if (p === "/images/search") return html("<html>nothing</html>");        // Bing: nothing (DuckDuckGo answers)
  // the GIF hosts (every *.fixture.test address comes here)
  if (p.startsWith("/media/")) { hits.media++; const b = gifBytes(p); res.writeHead(200, { "content-type": "image/gif", "content-length": b.length }); return res.end(b); }
  if (p.startsWith("/m/")) {
    hits.media++;
    const name = p.slice(3).replace(/\.[a-z0-9]+$/, ""), ext = (/\.([a-z0-9]+)$/.exec(p) ?? [])[1];
    if (/broken/.test(name)) return html("gone", 404);
    if (name === "redirect-private") { res.writeHead(302, { location: `http://127.0.0.1:${mockPort}/m/a.gif` }); return res.end(); }
    if (name === "redirect-meta") { res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" }); return res.end(); }
    if (name === "redirect-private-name") { res.writeHead(302, { location: "https://evil.private-fixture.test/m/a.gif" }); return res.end(); }
    if (name === "redirect-ok") { res.writeHead(302, { location: "https://media.fixture.test/m/after-redirect.gif" }); return res.end(); }
    if (name === "html") return html("<html>not a gif</html>");
    if (name === "svg") { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"); }
    if (name === "fake-gif") { res.writeHead(200, { "content-type": "image/gif" }); return res.end("<html><script>alert(1)</script></html>"); }
    if (name === "huge") { res.writeHead(200, { "content-type": "image/gif", "content-length": String(25 * 1024 * 1024) }); res.write(gifBytes("huge")); return; }
    if (name === "huge-chunked") { res.writeHead(200, { "content-type": "image/gif" }); const chunk = Buffer.alloc(1024 * 1024, 7); chunk.set(gifBytes("x")); let sent = 0; const pump = () => { while (sent < 24 && res.write(chunk)) sent++; if (sent < 24) res.once("drain", () => { sent++; pump(); }); else res.end(); }; pump(); return; }
    if (ext === "mp4") { res.writeHead(200, { "content-type": "video/mp4" }); return res.end(MP4); }
    const b = gifBytes(/^same/.test(name) ? "same" : name);
    res.writeHead(200, { "content-type": ext === "webp" ? "image/webp" : ext === "jpg" ? "image/jpeg" : "image/gif", "content-length": b.length }); return res.end(b);
  }
  html("not found", 404);
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockPort = mock.address().port, MOCK = `http://127.0.0.1:${mockPort}`;
process.env.DAYSPRING_GIFS_MOCK = MOCK; process.env.DAYSPRING_IMAGESEARCH_MOCK = MOCK; process.env.DAYSPRING_GIFS_MOCK_MEDIA = MOCK;
const reset = () => { for (const k of Object.keys(mode)) { mode[k] = "ok"; delay[k] = 0; } };

let server = null, browser = null;
const logs = []; const origLog = console.log;
try {
  // =================================================================== A. in-process
  const imp = (m) => import(pathToFileURL(join(APP, "lib", m)).href);
  const imgs = await imp("imagesearch.mjs");
  const gifs = await imp("gifs/index.mjs");
  const media = await imp("gifs/media.mjs");
  const routes = await imp("gifs/routes.mjs");
  const giphy = await imp("gifs/providers/giphy.mjs"), klipy = await imp("gifs/providers/klipy.mjs"), imgur = await imp("gifs/providers/imgur.mjs"), web = await imp("gifs/providers/web.mjs");
  const common = await imp("gifs/common.mjs");
  const perm = await imp("permissions.mjs");
  imgs.setDeps({ lookup: async (h) => (/private-fixture\.test$/.test(h) ? [{ address: "10.0.0.7" }] : /fixture\.test$/.test(h) ? [{ address: "203.0.113.5" }] : []) });
  let clock = Date.now();
  gifs.setDeps({ now: () => clock, sleep: async () => {} });
  routes.setDeps({ permissionsCheck: async () => ({ ok: true }), imagesAt: async () => 0 });
  const run = async (opts) => { const ses = gifs.startSession(opts); await ses.ready; return ses; };
  const fresh = () => { gifs.clearCaches(); gifs._resetHealth(); reset(); };

  // ---- 1. each provider's answer parses into the one shape
  const gp = giphy.parse(JSON.parse(fx("giphy-search.json")));
  check("GIPHY fixture: 8 GIFs, the next page is offset 8", gp.items.length === 8 && gp.cursor === 8, { n: gp.items.length, c: gp.cursor });
  const g1 = gp.items[0];
  check("GIPHY shape: id, source, title, rating, sizes, preview/small/still, gif/mp4/webp, page", g1.id === "giphy:gA1" && g1.source === "giphy" && g1.title === "Dancing Cat GIF by Happy Pets" && g1.rating === "g" && g1.width === 480 && g1.height === 360 && g1.previewWidth === 200 && /gA1\.gif$/.test(g1.preview) && /gA1-small/.test(g1.previewSmall) && /gA1-still/.test(g1.still) && /gA1-orig\.gif$/.test(g1.gif) && /gA1\.mp4$/.test(g1.mp4) && /gA1\.webp$/.test(g1.webp) && g1.page === "https://giphy.com/gifs/gA1" && g1.bytes === 234567, g1);
  check("GIPHY: a title with HTML comes out as plain text", !/<b>/.test(gp.items[3].title) && gp.items[3].title.includes("<img src=x"), gp.items[3].title);
  check("GIPHY categories parse", giphy.parseCategories(JSON.parse(fx("giphy-categories.json"))).map((c) => c.name).join() === "Animals,Reactions,Sports");
  const kp = klipy.parse(JSON.parse(fx("klipy-search.json")), { rating: "pg-13" });
  check("KLIPY fixture: 6 GIFs (the ad skipped), next page 2", kp.items.length === 6 && kp.cursor === 2 && !kp.items.some((x) => /ad/.test(x.id)), { n: kp.items.length, c: kp.cursor });
  const k1 = kp.items[0];
  check("KLIPY shape: hd GIF/MP4/WebP, sm preview, xs small, rating from the filter, page", k1.id === "klipy:dancing-cat-by-happy-pets-k1" && /k1-hd\.gif$/.test(k1.gif) && /k1-hd\.mp4$/.test(k1.mp4) && /k1-hd\.webp$/.test(k1.webp) && /k1-sm\.gif$/.test(k1.preview) && /k1-xs/.test(k1.previewSmall) && k1.rating === "pg-13" && k1.width === 480 && k1.page === "https://klipy.com/gifs/dancing-cat-by-happy-pets-k1" && k1.tags.includes("cat"), k1);
  check("KLIPY categories parse", klipy.parseCategories(JSON.parse(fx("klipy-categories.json"))).map((c) => c.query).join() === "love,animals,happy birthday");
  const ip = imgur.parse(JSON.parse(fx("imgur-search.json")), { rating: "pg-13" });
  check("Imgur fixture: animated only, mature left out at PG-13, an album's animated image used", ip.items.map((x) => x.sourceId).join() === "i1b,i2,i5" && ip.items.every((x) => x.rating === "pg-13") && ip.items[0].title === "Cat dancing in the kitchen" && /i1b\.mp4$/.test(ip.items[0].mp4), ip.items.map((x) => x.sourceId));
  check("Imgur: mature ones only with R (rated R)", imgur.parse(JSON.parse(fx("imgur-search.json")), { rating: "r" }).items.find((x) => x.sourceId === "i4")?.rating === "r");
  const wr = imgs.parseDdg(JSON.parse(fx("ddg-gif.json"))).map((x) => web.fromImageResult(x, { rating: "pg-13", type: "gif" })).filter(Boolean);
  check("Web: only animated GIF addresses kept (the JPEG photo dropped), titles tidied", wr.length === 6 && !wr.some((x) => /w3/.test(x.gif)) && wr[0].title === "Cat Dance Party" && wr.every((x) => x.source === "web" && x.rating === "pg-13"), wr.map((x) => x.title));
  check("the same GIF on GIPHY and in web results is recognised (GIPHY id in the address)", common.canonicalKeys(wr[0]).includes("giphy:gA2"), common.canonicalKeys(wr[0]));
  check("ratings: G < PG < PG-13 < R; unrated is never shown", common.ratingOk({ rating: "pg" }, "pg-13") && !common.ratingOk({ rating: "r" }, "pg-13") && !common.ratingOk({ rating: null }, "r") && common.ratingOk({ rating: "g" }, "g"));

  // ---- 2. all four at once: merged, fair, labelled, no duplicates, rated
  fresh();
  const s1 = await run({ q: "dancing cat" });
  const ids = s1.items.map((x) => x.id);
  check("every provider asked at once, each answered", ["giphy", "klipy", "imgur", "web"].every((p) => s1.statuses[p]?.state === "ok"), s1.statuses);
  check("fair: the first 8 have all four sources, none more than 3 times", new Set(s1.items.slice(0, 8).map((x) => x.source)).size === 4 && ["giphy", "klipy", "imgur", "web"].every((p) => s1.items.slice(0, 8).filter((x) => x.source === p).length <= 3), s1.items.slice(0, 8).map((x) => x.source));
  check("every result is labelled with its source", s1.items.every((x) => ["giphy", "klipy", "imgur", "web"].includes(x.source)));
  check("R-rated GIF dropped at PG-13 (server side)", !ids.includes("giphy:gA5") && s1.dropped.rating >= 1, s1.dropped);
  check("cross-provider duplicate by GIPHY id: gA2 appears once", s1.items.filter((x) => common.canonicalKeys(x).includes("giphy:gA2")).length === 1);
  check("cross-provider duplicate by title and shape: KLIPY's copy of 'Dancing Cat GIF by Happy Pets' dropped", s1.items.filter((x) => x.title === "Dancing Cat GIF by Happy Pets").length === 1 && s1.dropped.dupes >= 2, s1.dropped);
  check("no id twice", new Set(ids).size === ids.length);
  check("the best match to the words leads its round", s1.items[0].title.toLowerCase().includes("cat") && s1.items[0].title.toLowerCase().includes("danc"), s1.items[0].title);
  const hb = { ...hits };
  const s1b = await run({ q: "Dancing cat" });
  check("searches are cached for a while (no second request to any provider)", hits.giphy === hb.giphy && hits.klipy === hb.klipy && hits.imgur === hb.imgur && hits.ddg === hb.ddg && s1b.items.length === s1.items.length);
  const before = s1.items.length;
  await s1.more();
  check("more: the next page from each, still no duplicates", s1.items.length > before && new Set(s1.items.map((x) => x.id)).size === s1.items.length, { before, after: s1.items.length });

  // ---- 3. one slow provider: the rest come first, its GIFs follow (progressive)
  fresh(); gifs.setDeps({ timeoutMs: 1500, windowMs: 120 });
  delay.klipy = 500;
  const t0 = Date.now(); const evs = [];
  const s2 = gifs.startSession({ q: "slow test" }); s2.on((e) => evs.push({ ...e, ms: Date.now() - t0 }));
  await s2.ready;
  const firstItems = evs.find((e) => e.t === "items"), klipyStatus = evs.find((e) => e.t === "status" && e.provider === "klipy");
  check("progressive: the first GIFs went out before the slow provider answered", firstItems && klipyStatus && firstItems.i < klipyStatus.i && firstItems.ms < 450, { first: firstItems?.ms, slow: klipyStatus?.ms });
  check("progressive: the slow provider's GIFs followed in a later batch", evs.some((e) => e.t === "items" && e.i > klipyStatus.i && e.items.some((x) => x.source === "klipy")), evs.map((e) => `${e.t}:${e.provider ?? ""}${e.items ? e.items.map((x) => x.source[0]).join("") : ""}`).join(" "));
  fresh(); delay.klipy = 0; mode.klipy = "hang";
  const t1 = Date.now(); const s3 = await run({ q: "slow test" });
  check("a provider that never answers is cut off at its time limit; the rest are shown", s3.statuses.klipy?.state === "timeout" && s3.items.length > 5 && !s3.items.some((x) => x.source === "klipy") && Date.now() - t1 < 2600, { st: s3.statuses.klipy, ms: Date.now() - t1 });

  // ---- 4. one failing provider: retries, then the circuit breaker
  fresh(); gifs.setDeps({ timeoutMs: 4000, windowMs: 600 });
  mode.giphy = "fail";
  let h0 = hits.giphy; const f1 = await run({ q: "fail one" });
  check("a failing provider is retried (3 tries), then reported unavailable; the others still answer", hits.giphy - h0 === 3 && f1.statuses.giphy?.state === "unavailable" && f1.items.length > 5, { tries: hits.giphy - h0, st: f1.statuses.giphy });
  await run({ q: "fail two" }); await run({ q: "fail three" });
  h0 = hits.giphy; const f4 = await run({ q: "fail four" });
  check("after 3 failed searches the breaker opens: GIPHY is skipped (no request)", hits.giphy === h0 && f4.statuses.giphy?.skipped === true && gifs.providerState("giphy").state === "unavailable", { hits: hits.giphy - h0, st: f4.statuses.giphy });
  mode.giphy = "ok"; clock += 3 * 60_000 + 1000;
  const f5 = await run({ q: "fail five" });
  check("after its rest GIPHY is tried again and recovers", f5.statuses.giphy?.state === "ok" && gifs.providerState("giphy").state === "ready", f5.statuses.giphy);

  // ---- 5. a rate-limited provider (429 with Retry-After)
  fresh(); mode.imgur = "429";
  h0 = hits.imgur; const r1 = await run({ q: "busy one" });
  check("429: reported as busy, not retried", r1.statuses.imgur?.state === "rate-limited" && hits.imgur - h0 === 1, { st: r1.statuses.imgur, tries: hits.imgur - h0 });
  mode.imgur = "ok"; h0 = hits.imgur; const r2 = await run({ q: "busy two" });
  check("429: skipped until its Retry-After (120 s)", hits.imgur === h0 && r2.statuses.imgur?.state === "rate-limited" && gifs.providerState("imgur").state === "rate-limited");
  clock += 121_000; const r3 = await run({ q: "busy three" });
  check("…and asked again after it", r3.statuses.imgur?.state === "ok");

  // ---- 6. zero keys: the keyless web fallback
  fresh();
  for (const k of Object.keys(KEYS)) process.env[k] = "";
  const z1 = await run({ q: "dancing cat" });
  check("zero keys: web results only, marked as the fallback", z1.order.join() === "web" && z1.items.length >= 4 && z1.items.every((x) => x.source === "web"), { order: z1.order, n: z1.items.length });
  gifs.setSettings({ providers: { web: { on: false } } });
  const z2 = await run({ q: "party cat" });
  check("zero keys and web switched off: the web still answers (GIFs always work)", z2.fallback && z2.items.length >= 4, { fb: z2.fallback, n: z2.items.length });
  gifs.setSettings({ providers: { web: { on: true } } });
  Object.assign(process.env, KEYS);
  fresh(); gifs.setSettings({ providers: { web: { on: false } } }); mode.giphy = mode.klipy = mode.imgur = "fail";
  const z3 = await run({ q: "rescue me" });
  check("every keyed provider failing (web off): the web steps in", z3.items.length >= 4 && z3.items.every((x) => x.source === "web") && z3.events.some((e) => e.t === "fallback"), { n: z3.items.length });
  gifs.setSettings({ providers: { web: { on: true } } });

  // ---- 7. rating and type filters
  fresh();
  const g2 = await run({ q: "dancing cat", rating: "g" });
  check("rating G: GIPHY asked for G, KLIPY for its strictest filter, web with SafeSearch strict", last.giphy.q.rating === "g" && last.klipy.q.content_filter === "high" && web.safeFor("g") === "strict", { g: last.giphy.q.rating, k: last.klipy.q.content_filter });
  check("rating G: every result is G, Imgur (unrated) left out", g2.items.length > 0 && g2.items.every((x) => x.rating === "g") && !g2.items.some((x) => x.source === "imgur"), g2.items.map((x) => `${x.source}:${x.rating}`));
  const st1 = await run({ q: "dancing cat", type: "sticker" });
  check("stickers: GIPHY's and KLIPY's sticker searches, Imgur not asked, all marked sticker", /\/v1\/stickers\/search/.test(last.giphy.path) && /\/stickers\/search/.test(last.klipy.path) && !st1.order.includes("imgur") && st1.items.every((x) => x.type === "sticker"), { order: st1.order, p: last.giphy.path });
  const only = await run({ q: "dancing cat", providers: ["klipy"] });
  check("one source only (the KLIPY tab)", only.items.length > 0 && only.items.every((x) => x.source === "klipy"));

  // ---- 8. trending: cached on disk, used when the provider fails
  fresh();
  const tr = await run({ mode: "trending" });
  check("trending from every source", tr.items.length > 5 && /trending/.test(last.giphy.path), last.giphy?.path);
  check("trending is kept on disk (data\\gifs\\trending.json)", existsSync(join(APP, "data", "gifs", "trending.json")));
  gifs.clearCaches(); mode.giphy = "fail";
  const tr2 = await run({ mode: "trending" });
  check("trending with GIPHY down: the saved list is used", tr2.items.some((x) => x.source === "giphy") && tr2.statuses.giphy?.cached === "disk", tr2.statuses.giphy);
  reset();

  // ---- 9. the media proxy: only public GIFs and videos, 20 MB, never this computer or the home network
  const mf = async (u) => { try { const r = await media.fetchMedia(u); return r.type; } catch (e) { return e.status; } };
  check("a GIF loads (sniffed from its bytes)", (await mf("https://media.fixture.test/m/ok.gif")) === "image/gif");
  check("an MP4 loads", (await mf("https://media.fixture.test/m/ok.mp4")) === "video/mp4");
  check("a redirect to another public address is followed", (await mf("https://media.fixture.test/m/redirect-ok.gif")) === "image/gif");
  check("this computer refused (127.0.0.1)", (await mf(`http://127.0.0.1:${PORT}/api/build`)) === 403);
  check("localhost refused", (await mf("http://localhost:4747/")) === 403);
  check("the home network refused (192.168.x)", (await mf("http://192.168.1.1/a.gif")) === 403);
  check("a redirect to this computer refused", (await mf("https://media.fixture.test/m/redirect-private.gif")) === 403);
  check("a redirect to the cloud metadata address refused", (await mf("https://media.fixture.test/m/redirect-meta.gif")) === 403);
  check("a redirect to a name that points at the home network refused", (await mf("https://media.fixture.test/m/redirect-private-name.gif")) === 403);
  check("file: refused", (await mf("file:///C:/Windows/win.ini")) === 400);
  check("a web page refused", (await mf("https://media.fixture.test/m/html.gif")) === 415);
  check("SVG refused", (await mf("https://media.fixture.test/m/svg.gif")) === 415);
  check("HTML pretending to be a GIF refused", (await mf("https://media.fixture.test/m/fake-gif.gif")) === 415);
  check("over 20 MB refused from the header", (await mf("https://media.fixture.test/m/huge.gif")) === 413);
  check("over 20 MB refused while downloading", (await mf("https://media.fixture.test/m/huge-chunked.gif")) === 413);

  // ---- 10. files, saving (permissions), the log
  fresh(); const s5 = await run({ q: "dancing cat" });
  const pickIt = s5.items.find((x) => x.source === "giphy");
  const f = await gifs.file(pickIt.id);
  check("file(): a local copy in data\\gifs\\cache, a real GIF", f.path.startsWith(join(APP, "data", "gifs", "cache")) && existsSync(f.path) && f.type === "image/gif" && readFileSync(f.path).subarray(0, 4).toString() === "GIF8", f);
  check("file(): only GIFs Dayspring has shown (an unknown id is refused)", await gifs.file("giphy:nope").then(() => false, (e) => e.status === 404));
  perm.set({ files: "off", entries: [] });
  const sv1 = await gifs.save(pickIt.id);
  check("save without permission for Pictures: Dayspring's data\\gifs, with a note of where it came from", sv1.where === "data" && sv1.path.startsWith(join(APP, "data", "gifs")) && existsSync(sv1.path) && existsSync(sv1.path.replace(/\.gif$/, ".json")), sv1);
  perm.set({ files: "custom", entries: [{ path: PICS, kind: "folder", access: "readwrite" }] });
  const sv2 = await gifs.save(pickIt.id);
  check("save with permission: Pictures\\Dayspring GIFs", sv2.where === "pictures" && sv2.path.startsWith(join(PICS, "Dayspring GIFs")) && existsSync(sv2.path), sv2);
  perm.set({ files: "custom", entries: [{ path: PICS, kind: "folder", access: "read" }] });
  check("read-only Pictures: back to data\\gifs", (await gifs.save(pickIt.id)).where === "data");
  perm.set({ files: "off", entries: [] });
  const act = (() => { try { return readdirSync(join(APP, "data", "logs", "activity")).map((x) => readFileSync(join(APP, "data", "logs", "activity", x), "utf8")).join("\n"); } catch { return ""; } })();
  check("every save is in the activity log", (act.match(/gif_save/g) ?? []).length >= 3);
  check("cache size and clearing", media.cacheUsage().files >= 1 && media.clearCache().removed >= 1 && media.cacheUsage().files === 0);

  // ---- 11. settings, favourites, recents
  gifs.setSettings({ rating: "pg", order: ["web", "klipy", "giphy", "imgur"], autoplay: "hover", format: "mp4", cacheMB: 300, sayTitle: false, providers: { imgur: { on: false } } });
  gifs._reload();
  const ss = gifs.settings();
  check("settings saved and read back", ss.rating === "pg" && ss.order.join() === "web,klipy,giphy,imgur" && ss.autoplay === "hover" && ss.format === "mp4" && ss.cacheMB === 300 && ss.sayTitle === false && ss.providers.imgur.on === false, ss);
  check("the order is the providers' order", gifs.providerList().map((p) => p.id).join() === "web,klipy,giphy,imgur");
  check("a bad rating is refused", (() => { try { gifs.setSettings({ rating: "nc17" }); return false; } catch { return true; } })());
  gifs.setSettings({ rating: "pg-13", order: ["giphy", "klipy", "imgur", "web"], autoplay: "always", format: "gif", sayTitle: true, providers: { imgur: { on: true } } });
  const s6 = await run({ q: "dancing cat" });
  gifs.setFavorite(s6.items[0].id, true); gifs.addRecent(s6.items[1].id);
  gifs._reload();
  check("favourites and recents kept (data\\gifs.json) and still usable after a restart", gifs.favorites()[0]?.id === s6.items[0].id && gifs.recents()[0]?.id === s6.items[1].id && gifs.item(s6.items[0].id)?.title === s6.items[0].title);
  gifs.clearList("recents");
  check("clearing recents", gifs.recents().length === 0 && gifs.favorites().length === 1);

  // ---- 12. keys: tests, states, never logged
  console.log = (...a) => { logs.push(a.join(" ")); origLog(...a); };
  fresh();
  check("key test: ok", (await gifs.testProvider("giphy")).state === "ok");
  process.env.GIPHY_API_KEY = "giphy-bad-777777";
  check("key test: a wrong key → invalid-key", (await gifs.testProvider("giphy")).state === "invalid-key");
  const bad = await run({ q: "wrong key" });
  check("a refused key is reported and skipped", bad.statuses.giphy?.state === "invalid-key" && gifs.providerState("giphy").state === "invalid-key", bad.statuses.giphy);
  process.env.GIPHY_API_KEY = KEYS.GIPHY_API_KEY; gifs.keyChanged("giphy");
  check("a new key clears it", gifs.providerState("giphy").state === "ready");
  mode.klipy = "429"; check("key test: rate-limited", (await gifs.testProvider("klipy")).state === "rate-limited"); mode.klipy = "ok"; gifs.keyChanged("klipy");
  mode.imgur = "fail"; check("key test: unavailable", (await gifs.testProvider("imgur")).state === "unavailable"); mode.imgur = "ok";
  process.env.IMGUR_CLIENT_ID = ""; check("key test: no key → needs-key", (await gifs.testProvider("imgur")).state === "needs-key"); process.env.IMGUR_CLIENT_ID = KEYS.IMGUR_CLIENT_ID;
  const keyLeak = logs.join("\n") + JSON.stringify(gifs.providerList()) + readFileSync(join(APP, "data", "gifs.json"), "utf8");
  check("keys are never logged, listed or stored in gifs.json", !Object.values(KEYS).some((k) => keyLeak.includes(k)) && !keyLeak.includes("giphy-bad-777777"));
  console.log = origLog;

  // ---- 13. what people say (no AI)
  const S = [["show me a GIF of a dancing cat", "dancing cat", "gif"], ["find a thumbs up gif", "thumbs up", "gif"], ["Dayspring, find me a sticker of a cat", "cat", "sticker"], ["facepalm gif", "facepalm", "gif"], ["can you find me some funny gifs about mondays", "mondays", "gif"], ["add a funny gif about mondays to the email", "mondays", "gif"], ["show me dancing cat gifs", "dancing cat", "gif"]];
  for (const [t, q, type] of S) { const r = routes.parseSearch(t); check(`heard: "${t}"`, r && r.q === q && r.type === type && r.mode === "search", r); }
  for (const t of ["trending gifs", "show me trending gifs", "what gifs are trending", "show me gifs", "open the gif picker"]) check(`heard: "${t}" → trending`, routes.parseSearch(t)?.mode === "trending", routes.parseSearch(t));
  for (const t of ["show me pictures of cats", "save that one", "number 4", "what time is it", "show me my photos"]) check(`not a GIF search: "${t}"`, routes.parseSearch(t) === null, routes.parseSearch(t));
  const C = [["number 4", { do: "view", n: 4 }], ["show number four", { do: "view", n: 4 }], ["more", { do: "more" }], ["save that gif", { do: "save", n: null }], ["save number 2", { do: "save", n: 2 }], ["copy that one", { do: "copy", n: null, what: "gif" }], ["copy the link", { do: "copy", n: null, what: "link" }], ["only stickers", { do: "filter", type: "sticker" }], ["clean ones only", { do: "filter", rating: "g" }], ["just gifs", { do: "filter", type: "gif" }], ["only from giphy", { do: "filter", providers: ["giphy"] }], ["pick number 3", { do: "pick", n: 3 }], ["favourite that one", { do: "favorite", n: null }], ["close the gifs", { do: "close" }], ["more like number 2", { do: "similar", n: 2 }]];
  for (const [t, want] of C) check(`while GIFs are up: "${t}"`, JSON.stringify(routes.parseContext(t)) === JSON.stringify(want), routes.parseContext(t));
  fresh();
  const say1 = await routes.command("show me a GIF of a dancing cat");
  check("voice: a search answers with where they're from and what to say", /GIFs of dancing cat, from .*GIPHY/.test(say1) && /number 3/.test(say1), say1);
  const say2 = await routes.command("number 2");
  check("voice: \"number 2\" names it and its source", /^Number 2: .+, from (GIPHY|KLIPY|Imgur|Web)\.$/.test(say2), say2);
  const say3 = await routes.command("save that gif");
  check("voice: \"save that GIF\" saves number 2", /^Saved number 2/.test(say3), say3);
  const say4 = await routes.command("copy that one");
  check("voice: \"copy that one\" copies (a dry run here: the owner's clipboard is never touched)", /^Copied number 2/.test(say4), say4);
  const say5 = await routes.command("only stickers");
  check("voice: \"only stickers\"", /stickers only/.test(say5) && routes.current().filters.type === "sticker", say5);
  const say6 = await routes.command("clean ones only");
  check("voice: \"clean ones only\" → G", /rated G/.test(say6) && routes.current().filters.rating === "g", say6);
  const say7 = await routes.command("more");
  check("voice: \"more\"", /more GIF|That's all/.test(say7), say7);
  check("voice: \"close the gifs\"", (await routes.command("close the gifs")) === "Closed the GIFs." && (await routes.command("number 2")) === null);

  // ---- 14. the AI's tools
  const t1r = await routes.runTool("gif_search", { query: "funny mondays", rating: "g" });
  check("gif_search: numbered results with source and rating, shown on the screen", t1r.shownOnScreen && t1r.results.length > 3 && t1r.results[0].n === 1 && t1r.results.every((x) => x.rating === "g" && x.source), t1r.results.slice(0, 2));
  const t2r = await routes.runTool("gif_pick", { n: 2 });
  check("gif_pick: the GIF's address, size and a local file to attach", /^https:\/\//.test(t2r.url) && t2r.width > 0 && t2r.file?.path && existsSync(t2r.file.path) && t2r.title, t2r);
  check("the tools have unique, expected names", routes.TOOLS.map((t) => t.name).join() === "gif_search,gif_pick");
  const intents = await imp("intents/index.mjs");
  for (const [t, id] of [["show me a gif of a dancing cat", "gifs.search"], ["trending gifs", "gifs.trending"], ["find a thumbs up gif", "gifs.search"], ["show me pictures of golden retrievers", "images.search"]]) { const pl = intents.plan(t); check(`no-AI intent: "${t}" → ${id}`, pl.intent === id, pl.intent); }
  routes._reset();

  // =================================================================== B. the real server and the screen
  const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1",
    ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "none", DAYSPRING_REMINDER_CHANNEL: "off", DAYSPRING_GIFS_TIMEOUT_MS: "1500",
    DAYSPRING_GIFS_FILE: "", DAYSPRING_GIFS_DIR: "", DAYSPRING_PERMISSIONS_FILE: "", DAYSPRING_ACTIVITY_DIR: "" };
  for (const k of ["DAYSPRING_GIFS_FILE", "DAYSPRING_GIFS_DIR", "DAYSPRING_PERMISSIONS_FILE", "DAYSPRING_ACTIVITY_DIR"]) delete env[k];     // the copy's own data folder
  rmSync(join(APP, "data", "gifs.json"), { force: true }); rmSync(join(APP, "data", "permissions.json"), { force: true });
  reset();
  server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let serverLog = ""; server.stdout.on("data", (x) => (serverLog += x)); server.stderr.on("data", (x) => (serverLog += x));
  const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  check("test server started", await up(), serverLog.slice(0, 600));
  const api = async (path, body) => { const r = await fetch(BASE + "/api" + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const chat = (message) => api("/chat", { message, surface: "tv", typed: true });

  // the routes, over HTTP
  const px = async (u, headers = {}) => (await fetch(`${BASE}/api/gifs/media?u=${encodeURIComponent(u)}`, { headers })).status;
  check("media route: a GIF loads through the proxy", (await px("https://media.fixture.test/m/route.gif")) === 200);
  check("media route: this computer refused", (await px(`http://127.0.0.1:${PORT}/api/build`)) === 403);
  check("media route: localhost refused", (await px("http://localhost:4747/")) === 403);
  check("media route: file: refused", (await px("file:///C:/Windows/win.ini")) === 400);
  check("media route: another website's page can't use it", (await px("https://media.fixture.test/m/x.gif", { origin: "https://evil.example.com", "sec-fetch-site": "cross-site" })) === 403);
  check("the \"gifs\" feature is on in this (dev) build", (await api("/gifs/enabled")).enabled === true);
  check("file route: an id Dayspring never showed is refused", (await api("/gifs/file?id=giphy:nope")).status === 404);

  const { chromium } = await import(PW);
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--no-first-run", "--disable-extensions"] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => {
    window.__clip = [];
    try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__clip.push({ text: t }); }, write: async (items) => { window.__clip.push({ items: items.length }); }, readText: async () => "" } }); } catch { /* fine */ }
    window.__dsAllowAutomatedListen = true;
    const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; }
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  });
  await ctx.route("**/*", (rt) => { const u = rt.request().url(); if (rt.request().method() === "POST" && /\/api\/(sound|window|devices\/use|keepawake|tunein|open|app\/quit|update)/.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); return rt.continue(); });
  const page = await ctx.newPage();
  const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(e.message));
  const outside = []; page.on("request", (r) => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
  await page.goto(`${BASE}/display`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.dsEvents && window.dsGifPicker, null, { timeout: 20000 });
  await sleep(800);
  const gst = () => page.evaluate(() => window.dsGifPicker._state());
  const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const s = await gst(); if (fn(s)) return s; await sleep(150); } return gst(); };
  check("🎞 GIFs button by the clock", await page.evaluate(() => Boolean(document.getElementById("gifsBtn"))));

  // search, numbering, dropped tiles, labels, attribution, XSS
  await page.evaluate(() => { window.__picked = null; window.dsGifPicker.open({ query: "dancing cat", onPick: (x) => { window.__picked = x; } }); });
  let s = await until((x) => !x.loading && x.numbers.length >= 10);
  check("the picker opens, streams and numbers the GIFs in order", s.open && s.numbers.length >= 10 && s.numbers.every((x, i) => x.n === i + 1), s.numbers.length);
  s = await until((x) => x.dropped.broken >= 1 && x.dropped.look >= 1, 6000);
  check("a GIF that doesn't load is dropped (never a broken tile)", s.dropped.broken >= 1 && !s.numbers.some((x) => /broken/.test(x.id)), s.dropped);
  check("a look-alike from another source (same first frame) is dropped by its fingerprint", s.dropped.look >= 1 && s.numbers.filter((x) => ["giphy:gA3", "klipy:totally-different-k2"].includes(x.id)).length === 1, s.dropped);
  check("no R-rated GIF, every tile labelled with its source", !s.numbers.some((x) => x.id === "giphy:gA5") && await page.evaluate(() => [...document.querySelectorAll("#dsGifs .g-tile")].every((t) => t.querySelector(".g-src")?.textContent)));
  const dom = await page.evaluate(() => ({ xss: window.__xss ?? null, titles: [...document.querySelectorAll("#dsGifs .g-tile")].map((t) => t.title), injected: document.querySelectorAll("#dsGifs .g-src img, #dsGifs .g-num img, #dsGifs .g-tile > b").length, srcs: [...document.querySelectorAll("#dsGifs img")].map((i) => i.getAttribute("src")), attr: document.querySelector("#dsGifs .g-attr")?.textContent }));
  check("titles are text only (an HTML title shows as text, runs nothing)", dom.xss === null && dom.injected === 0 && dom.titles.some((t) => t.includes("<img src=x")), dom.titles.find((t) => t.includes("img")));
  check("every picture comes through Dayspring's proxy", dom.srcs.length > 5 && dom.srcs.every((u) => u.startsWith("/api/gifs/media?u=")), dom.srcs.slice(0, 2));
  check("attribution: Powered by GIPHY and Powered by KLIPY", /Powered by GIPHY/.test(dom.attr) && /Powered by KLIPY/.test(dom.attr), dom.attr);

  // voice numbering on the screen's numbers
  const n3 = s.numbers[2];
  const v1 = await chat("number 3");
  s = await until((x) => x.detail?.n === 3, 4000);
  check("voice \"number 3\" opens the tile numbered 3 and names it", s.detail?.n === 3 && v1.reply.startsWith(`Number 3: ${n3.title}`), { reply: v1.reply, d: s.detail });
  const acts = await page.evaluate(() => [...document.querySelectorAll("#dsGifs .g-acts button")].map((b) => b.textContent));
  check("the preview has Insert, Copy GIF, Copy link, Save, Favourite, Open source page, More like this, Back", ["Insert", "Copy GIF", "Copy link", "Save to my computer", "Favourite", "Open source page", "More like this", "Back"].every((w) => acts.some((a) => a.includes(w))), acts);
  await page.click("#dsGifs .g-act-link"); await sleep(300);
  const clip = await page.evaluate(() => window.__clip);
  check("Copy link copies the GIF's page address", clip.some((c) => /^https:\/\//.test(c.text ?? "")), clip);
  await page.click("#dsGifs .g-act-copy"); s = await until((x) => x.lastCopy, 4000);
  check("Copy GIF: the file, a picture and the link to the clipboard (dry run here)", s.lastCopy?.dryRun && s.lastCopy.would.file && s.lastCopy.would.html && /^https:/.test(s.lastCopy.would.text), s.lastCopy);
  await page.click("#dsGifs .g-act-save"); s = await until((x) => x.lastSave, 5000);
  check("Save without Pictures permission → Dayspring's data\\gifs", s.lastSave?.where === "data" && existsSync(join(APP, "data", "gifs", s.lastSave.name)), s.lastSave);
  await api("/setup/permissions", { files: "custom", entries: [{ path: PICS, kind: "folder", access: "readwrite" }] });
  await page.click("#dsGifs .g-act-save"); await sleep(1200); s = await gst();
  check("Save with Pictures permission → Pictures\\Dayspring GIFs", s.lastSave?.where === "pictures" && existsSync(join(PICS, "Dayspring GIFs", s.lastSave.name)), s.lastSave);
  await api("/setup/permissions", { files: "off", entries: [] });
  await page.keyboard.press("Escape"); await sleep(200);
  check("Esc goes back from the preview to the grid", (await gst()).detail === null && (await gst()).open);

  // keyboard: arrows move between tiles, Enter previews
  await page.focus("#dsGifs .g-tile");
  const kb0 = await page.evaluate(() => document.activeElement?.dataset.id);
  await page.keyboard.press("ArrowRight"); const kb1 = await page.evaluate(() => document.activeElement?.dataset.id);
  await page.keyboard.press("ArrowDown"); const kb2 = await page.evaluate(() => document.activeElement?.dataset.id);
  await page.keyboard.press("Enter"); await sleep(300);
  check("keyboard: arrows move between tiles, Enter opens the preview", kb0 && kb1 && kb1 !== kb0 && kb2 && kb2 !== kb1 && (await gst()).detail?.id === kb2, { kb0, kb1, kb2 });
  await page.keyboard.press("Escape"); await sleep(200);

  // more (scrolling and voice)
  const had = (await gst()).numbers.length;
  const v2 = await chat("more"); s = await until((x) => x.numbers.length > had + 5, 8000);
  check("voice \"more\" adds GIFs below, numbering carries on", s.numbers.length > had + 5 && /more GIF/.test(v2.reply), { had, now: s.numbers.length, reply: v2.reply });

  // pick: the callback gets the GIF and a local file
  const v3 = await chat("pick number 2"); await sleep(1500);
  const picked = await page.evaluate(() => window.__picked);
  check("voice \"pick number 2\" → onPick gets { url, mp4, width, height, title, source, id, file }", picked && picked.id === s.numbers[1].id && /^https:\/\//.test(picked.url) && picked.width > 0 && picked.title && picked.source && picked.file?.path && existsSync(picked.file.path) && /^\/api\/gifs\/media\?u=/.test(picked.preview), { reply: v3.reply, picked });
  check("…and the picker closes after picking", !(await gst()).open);
  await page.evaluate(() => { window.__picked = null; window.dsGifPicker.open({ query: "thumbs up", onPick: (x) => { window.__picked = x; } }); });
  await until((x) => x.numbers.length >= 4);
  await page.click('#dsGifs .g-tile[data-n="1"]'); await page.click("#dsGifs .g-act-pick"); await sleep(1500);
  const picked2 = await page.evaluate(() => window.__picked);
  check("clicking Insert → onPick", picked2?.id && picked2.file?.name, picked2);

  // filters: source tab, rating, stickers
  await page.evaluate(() => window.dsGifPicker.open({ query: "dancing cat" })); await until((x) => x.numbers.length >= 8);
  await page.click('#dsGifs .g-prov button[data-p="giphy"]'); s = await until((x) => !x.loading && x.numbers.length >= 3 && x.numbers.every((y) => y.source === "giphy"), 6000);
  check("the GIPHY tab shows GIPHY only", s.numbers.length >= 3 && s.numbers.every((x) => x.source === "giphy"), s.numbers.map((x) => x.source));
  await page.click('#dsGifs .g-prov button[data-p="all"]'); await page.selectOption("#dsGifs .g-rating", "g"); s = await until((x) => !x.loading && x.rating === "g" && x.numbers.length >= 3, 6000);
  check("rating G: GIPHY asked for G, only G tiles, no Imgur", last.giphy.q.rating === "g" && s.numbers.length >= 3 && !s.numbers.some((x) => x.source === "imgur"), { rating: last.giphy.q.rating, src: s.numbers.map((x) => x.source) });
  await page.selectOption("#dsGifs .g-rating", "pg-13"); await page.selectOption("#dsGifs .g-type", "sticker"); s = await until((x) => !x.loading && x.type === "sticker" && x.numbers.length >= 3, 6000);
  check("stickers: the sticker search is used", /stickers/.test(last.giphy.path) && s.numbers.length >= 3, last.giphy.path);
  await page.selectOption("#dsGifs .g-type", "gif");
  const v4 = await chat("clean ones only"); s = await until((x) => x.rating === "g" && !x.loading, 5000);
  check("voice \"clean ones only\" re-searches at G on the screen", s.rating === "g" && /rated G/.test(v4.reply), v4.reply);

  // progressive, and chips for providers in trouble
  await page.selectOption("#dsGifs .g-rating", "pg-13"); await until((x) => !x.loading);
  delay.klipy = 900; mode.giphy = "fail"; mode.imgur = "429";
  await page.evaluate(() => window.dsGifPicker.open({ query: "slow test" }));
  s = await until((x) => !x.loading && x.timeline.some((e) => e.t === "done"), 9000);
  const tl = s.timeline, iFirst = tl.findIndex((e) => e.t === "items"), iKlipy = tl.findIndex((e) => e.t === "status" && e.provider === "klipy");
  check("progressive on the screen: GIFs showed before the slow source answered, its GIFs after", iFirst >= 0 && iKlipy > iFirst && tl.slice(iKlipy).some((e) => e.t === "items" && e.sources.includes("klipy")), tl.map((e) => e.t + (e.provider ? ":" + e.provider : "") + (e.sources ? ":" + e.sources.join("") : "")).join(" "));
  const chips = await page.evaluate(() => [...document.querySelectorAll("#dsGifs .g-chipbad")].map((c) => `${c.dataset.p}:${c.dataset.state}:${c.textContent}`));
  check("chips say which source is in trouble (GIPHY unavailable, Imgur busy)", chips.some((c) => /^giphy:unavailable:GIPHY unavailable/.test(c)) && chips.some((c) => /^imgur:rate-limited:Imgur busy/.test(c)), chips);
  reset();

  // zero keys: the web still answers, and the picker says so
  for (const p of ["giphy", "klipy", "imgur"]) await api("/gifs/keys", { provider: p, key: "" });
  await page.evaluate(() => window.dsGifPicker.open({ query: "party cat" }));
  s = await until((x) => !x.loading && x.numbers.length >= 3, 8000);
  check("zero keys: web GIFs, with a note about free keys", s.fallback && s.numbers.every((x) => x.source === "web") && /free GIPHY or KLIPY key/.test(await page.evaluate(() => document.querySelector("#dsGifs .g-attr").textContent)), { fb: s.fallback, src: s.numbers.map((x) => x.source) });
  await api("/gifs/keys", { provider: "giphy", key: KEYS.GIPHY_API_KEY }); await api("/gifs/keys", { provider: "klipy", key: KEYS.KLIPY_API_KEY }); await api("/gifs/keys", { provider: "imgur", key: KEYS.IMGUR_CLIENT_ID });

  // the window: minimise, resize, inside the safe area
  await page.evaluate(() => window.dsGifPicker.open({ tab: "favorites" })); await sleep(600);
  const fit = await page.evaluate(() => { const r = document.getElementById("dsGifs").getBoundingClientRect(), S2 = window.dsSafeRect(); return { inside: r.left >= S2.left - 1 && r.top >= S2.top - 1 && r.right <= S2.right + 1 && r.bottom <= S2.bottom + 1, r: [r.left, r.top, r.right, r.bottom].map(Math.round) }; });
  check("the picker fits the safe area", fit.inside, fit.r);
  await page.click("#dsGifs .g-min"); await sleep(200);
  const mini = await page.evaluate(() => ({ hidden: document.getElementById("dsGifs").hidden, pill: !document.getElementById("dsGifsPill").hidden }));
  await page.click("#dsGifsPill"); await sleep(200);
  check("minimise to a 🎞 GIFs button and back", mini.hidden && mini.pill && !(await page.evaluate(() => document.getElementById("dsGifs").hidden)));
  const grip = await page.evaluate(() => { const r = document.querySelector("#dsGifs .g-resize").getBoundingClientRect(); return { x: r.left + 8, y: r.top + 8 }; });
  await page.mouse.move(grip.x, grip.y); await page.mouse.down(); await page.mouse.move(grip.x - 300, grip.y - 200, { steps: 5 }); await page.mouse.up();
  const rz = await page.evaluate(() => { const e = document.getElementById("dsGifs"), r = e.getBoundingClientRect(), S2 = window.dsSafeRect(); return { float: e.classList.contains("float"), w: Math.round(r.width), inside: r.left >= S2.left - 1 && r.top >= S2.top - 1 && r.right <= S2.right + 1 && r.bottom <= S2.bottom + 1 }; });
  check("resizable (floats, smaller, still inside)", rz.float && rz.w < 1100 && rz.inside, rz);
  await page.click("#dsGifs .g-max"); await page.click("#dsGifs .g-x"); await sleep(200);
  check("✕ closes it", !(await gst()).open);
  check("favourites tab and recents work (GIFs picked are in Recent)", (await api("/gifs/library")).recents.length >= 2);

  // Settings → GIFs
  const sp = await ctx.newPage(); sp.on("pageerror", (e) => pageErrors.push("settings: " + e.message));
  await sp.goto(`${BASE}/setup?s=gifs`, { waitUntil: "domcontentloaded" });
  await sp.waitForSelector(".gs-prov", { timeout: 15000 });
  const cards = await sp.evaluate(() => [...document.querySelectorAll(".gs-prov")].map((c) => c.dataset.id));
  check("Settings → GIFs: a card per source, in order", cards.join() === "giphy,klipy,imgur,web", cards);
  check("Settings → GIFs is in the nav under Apps & connections, after Photos & people (before Privacy & safety)", await sp.evaluate(() => { const b = [...document.querySelectorAll("#nav button")].map((x) => x.textContent.trim()); const i = b.findIndex((t) => /GIFs/.test(t)), ph = b.findIndex((t) => /Photos/.test(t)), perm = b.findIndex((t) => /Permissions/.test(t)); return i > 0 && ph >= 0 && ph < i && (perm < 0 || i < perm); }));   // (Cameras, Smart devices and 3D printers may sit between them in the development version)
  check("keys are never shown back (only \"Key saved ✓\")", await sp.evaluate((ks) => !ks.some((k) => document.body.innerHTML.includes(k)) && document.querySelector('.gs-prov[data-id="giphy"] .gs-key').placeholder.includes("saved"), Object.values(KEYS)));
  await sp.fill('.gs-prov[data-id="giphy"] .gs-key', "giphy-bad-555555"); await sp.click('.gs-prov[data-id="giphy"] .gs-savekey');
  await sp.waitForFunction(() => document.querySelector('.gs-prov[data-id="giphy"] .gs-state')?.dataset.state === "invalid-key", null, { timeout: 8000 }).catch(() => {});
  check("key test: a wrong key → \"Key not accepted\"", await sp.evaluate(() => document.querySelector('.gs-prov[data-id="giphy"] .gs-state').textContent.startsWith("Key not accepted")));
  await sp.fill('.gs-prov[data-id="giphy"] .gs-key', "giphy-good-000999"); await sp.click('.gs-prov[data-id="giphy"] .gs-savekey');
  await sp.waitForFunction(() => document.querySelector('.gs-prov[data-id="giphy"] .gs-state')?.dataset.state === "ok", null, { timeout: 8000 }).catch(() => {});
  check("key test: the right key → \"✓ Works\"", await sp.evaluate(() => document.querySelector('.gs-prov[data-id="giphy"] .gs-state').textContent === "✓ Works"));
  mode.klipy = "429"; await sp.click('.gs-prov[data-id="klipy"] .gs-test');
  await sp.waitForFunction(() => document.querySelector('.gs-prov[data-id="klipy"] .gs-state')?.dataset.state === "rate-limited", null, { timeout: 8000 }).catch(() => {});
  check("key test: busy → \"Busy\"", await sp.evaluate(() => /^Busy/.test(document.querySelector('.gs-prov[data-id="klipy"] .gs-state').textContent)));
  mode.klipy = "fail"; await sp.click('.gs-prov[data-id="klipy"] .gs-test');
  await sp.waitForFunction(() => document.querySelector('.gs-prov[data-id="klipy"] .gs-state')?.dataset.state === "unavailable", null, { timeout: 8000 }).catch(() => {});
  check("key test: down → \"Unavailable\"", await sp.evaluate(() => /^Unavailable/.test(document.querySelector('.gs-prov[data-id="klipy"] .gs-state').textContent)));
  reset();
  await sp.click('.gs-prov[data-id="giphy"] .gs-down');
  await sp.click('.gs-prov[data-id="imgur"] .gs-on');
  await sp.selectOption("#gs-rating", "g"); await sp.selectOption("#gs-format", "webp"); await sp.selectOption("#gs-autoplay", "hover"); await sp.click("#gs-saver");
  await sp.fill("#gs-cache", "150");
  await sp.click("#next"); await sleep(800);
  await sp.reload({ waitUntil: "domcontentloaded" }); await sp.waitForSelector(".gs-prov", { timeout: 15000 }); await sleep(300);
  const after = await sp.evaluate(() => ({ cards: [...document.querySelectorAll(".gs-prov")].map((c) => c.dataset.id), imgur: document.querySelector('.gs-prov[data-id="imgur"] .gs-on').getAttribute("aria-checked"), rating: document.getElementById("gs-rating").value, format: document.getElementById("gs-format").value, auto: document.getElementById("gs-autoplay").value, saver: document.getElementById("gs-saver").getAttribute("aria-checked"), cache: document.getElementById("gs-cache").value }));
  check("Settings saved and still there after a reload: reorder (▼), Imgur off, G, WebP, on hover, data saver, 150 MB", after.cards.join() === "klipy,giphy,imgur,web" && after.imgur === "false" && after.rating === "g" && after.format === "webp" && after.auto === "hover" && after.saver === "true" && after.cache === "150", after);
  const sv = await api("/gifs/settings");
  check("…and the server has it (order, off, rating)", sv.settings.order.join() === "klipy,giphy,imgur,web" && sv.settings.providers.imgur.on === false && sv.settings.rating === "g");
  // drag to reorder
  // (HTML5 drag and drop, the way the browser sends it: dragstart on one card, dragover and drop on another)
  await sp.evaluate(() => { const dt = new DataTransfer(), a = document.querySelector('.gs-prov[data-id="web"]'), b = document.querySelector('.gs-prov[data-id="klipy"]'); a.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true })); b.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true })); b.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })); a.dispatchEvent(new DragEvent("dragend", { dataTransfer: dt, bubbles: true })); }); await sleep(200);
  check("drag a card to reorder", (await sp.evaluate(() => window.DayspringGifSettings._state().order)).join() === "web,klipy,giphy,imgur", await sp.evaluate(() => window.DayspringGifSettings._state().order));
  check("the GIF settings page's own guide link", await sp.evaluate(() => Boolean(document.querySelector('.guide-link a[href*="#gifs"]'))));
  await sp.close();

  check("the screen loaded no GIF from other sites (only through the proxy)", !outside.some((u) => /fixture\.test|giphy|klipy|imgur/.test(u)), outside.slice(0, 3));
  check("no errors on the pages", pageErrors.length === 0, pageErrors);
  check("no key in the server's log", !Object.values(KEYS).some((k) => serverLog.includes(k)) && !serverLog.includes("giphy-bad-555555"));
  check("no live provider was contacted (every request went to the mock)", hits.giphy > 0 && hits.klipy > 0 && hits.imgur > 0 && hits.ddg > 0);
} catch (e) {
  console.log = origLog;
  check("the checks ran to the end", false, e.stack);
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  if (server) { server.kill(); await sleep(500); }
  mock.close();
  if (!KEEP) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); if (!existsSync(join(APP, "node_modules"))) try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a file still open */ } }
  else console.log("kept:", TMP);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
