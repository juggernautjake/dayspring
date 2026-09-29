// Image search checks, on a throwaway copy of Dayspring (port 4796) against a local mock image search: no live site is
// ever contacted, nothing of the owner's is touched (their data, their Pictures folder, their Chrome), no key is needed.
//   A. in-process (the copy's own modules): parsing the DuckDuckGo / Bing / Brave / Google fixtures, the order sources
//      are tried in (keyed APIs, DuckDuckGo, Bing, the headless browser), the cache, SafeSearch, the picture fetcher's
//      refusals (private addresses, localhost, redirects to private addresses, non-pictures, too big, too slow),
//      saving (Pictures when allowed, else data/images, with the source noted), what people say, the AI tools
//   B. the real server and the Dayspring screen in ONE headless Chrome: "show me pictures of golden retrievers" draws a
//      numbered grid with no script run from titles, "show number 3 bigger", "more", "previous", refining ("only
//      photos", "from wikipedia"), "find a transparent png of a lantern", "close images"; the proxy route refuses
//      private and localhost addresses, other schemes, and other websites' pages (localRequest)
//   node scripts/qa/images.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(DESK, "scripts", "qa", "fixtures", "images");
// playwright-core from the exported copy next to this project (…/dayspring-app), else this app's own; QA_PLAYWRIGHT overrides
const PW = process.env.QA_PLAYWRIGHT ?? pathToFileURL([join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = await qaPort(4796), BASE = `http://127.0.0.1:${PORT}`;
const KEEP = process.argv.includes("--keep");
const TMP = mkdtempSync(join(tmpdir(), "ds-images-")), APP = join(TMP, "app"), PICS = join(TMP, "Pictures"), IMGDIR = join(TMP, "saved");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 260) + ")" : ""}`); };
const fx = (f) => readFileSync(join(FIX, f), "utf8");

// ---- a copy of the app (code only; its own empty data) ------------------------------------------------------------------
const SKIP = new Set(["data", ".env", "node_modules", "backups", "dist", "dist-out", "bin", "updates", "logs", ".git"]);
for (const e of readdirSync(DESK)) if (!SKIP.has(e) && !/\.tmp\./.test(e)) cpSync(join(DESK, e), join(APP, e), { recursive: true, filter: (s) => !/[\\/]docs[\\/](images|dev[\\/]badge-previews)[\\/]/.test(s) });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
writeFileSync(join(APP, "data", "people.json"), JSON.stringify({ people: [{ id: "p-casey", name: "Casey", aliases: [], relation: "friend" }], occasions: [] }));   // someone the owner knows
mkdirSync(PICS, { recursive: true });
// the copy's modules only ever see the copy's files
Object.assign(process.env, {
  DAYSPRING_PERMISSIONS_FILE: join(APP, "data", "permissions.json"), DAYSPRING_IMAGE_PREFS_FILE: join(APP, "data", "image-search.json"),
  DAYSPRING_IMAGES_DIR: IMGDIR, DAYSPRING_PICTURES_DIR: PICS, DAYSPRING_ENV_FILE: join(APP, ".env"), DAYSPRING_SETTINGS_FILE: join(APP, "data", "settings.json"),
  DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_ECO: "1", BRAVE_SEARCH_API_KEY: "", GOOGLE_CSE_KEY: "", GOOGLE_CSE_ID: "", BING_IMAGE_SEARCH_KEY: "",
});

// ---- the mock image search (and the picture hosts) ----------------------------------------------------------------------
const mode = { ddg: "ok", bing: "ok", brave: "ok", google: "ok" };
const hits = { ddgPage: 0, ddgJson: 0, bing: 0, brave: 0, google: 0 };
let lastDdg = null, lastBing = null, lastBraveKey = null, pinHits = 0, lastPinHost = null;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
const mock = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  if (/\.pin\.test(:\d+)?$/.test(req.headers.host ?? "")) { pinHits++; lastPinHost = req.headers.host; }
  if (p === "/img/redirect-hop") { res.writeHead(302, { location: `http://hop.pin.test:${mockPort}/img/ok.jpg` }); return res.end(); }
  const html = (s, code = 200) => { res.writeHead(code, { "content-type": "text/html" }); res.end(s); };
  const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (p === "/" && u.searchParams.get("iax") === "images") { hits.ddgPage++; lastDdg = { kp: u.searchParams.get("kp") }; if (mode.ddg === "fail") return html("no", 403); if (mode.ddg === "challenge") return html(fx("ddg-challenge.html")); return html(fx("ddg-page.html")); }
  if (p === "/i.js") { hits.ddgJson++; lastDdg = { ...lastDdg, q: u.searchParams.get("q"), f: u.searchParams.get("f"), p: u.searchParams.get("p"), vqd: u.searchParams.get("vqd"), s: u.searchParams.get("s") }; if (mode.ddg === "empty") return json({ results: [] }); return json(JSON.parse(fx("ddg.json"))); }
  if (p === "/images/search") { hits.bing++; lastBing = { q: u.searchParams.get("q"), adlt: u.searchParams.get("adlt"), qft: u.searchParams.get("qft") }; if (mode.bing === "fail") return html("no", 503); return html(fx("bing.html")); }
  if (p === "/res/v1/images/search") { hits.brave++; lastBraveKey = req.headers["x-subscription-token"]; if (mode.brave === "fail") return json({}, 429); return json(JSON.parse(fx("brave.json"))); }
  if (p === "/customsearch/v1") { hits.google++; if (mode.google === "fail") return json({}, 403); return json(JSON.parse(fx("google.json"))); }
  // picture hosts
  if (/^\/img\/(thumb|full|bing|brave|google|ok)/.test(p)) { res.writeHead(200, { "content-type": "image/jpeg", "content-length": JPEG.length }); return res.end(JPEG); }
  if (p === "/img/html") return html("<html>not a picture</html>");
  if (p === "/img/fake-jpeg") { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end("<html><script>alert(1)</script></html>"); }
  if (p === "/img/svg") { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"); }
  if (p === "/img/big") { res.writeHead(200, { "content-type": "image/jpeg", "content-length": String(9 * 1024 * 1024) }); res.write(JPEG); return; }   // left hanging: must be refused from the header
  if (p === "/img/big-chunked") { res.writeHead(200, { "content-type": "image/jpeg" }); const chunk = Buffer.alloc(512 * 1024, 1); chunk[0] = 0xff; let sent = 0; const pump = () => { while (sent < 20 && res.write(chunk)) sent++; if (sent < 20) res.once("drain", () => { sent++; pump(); }); else res.end(); }; pump(); return; }
  if (p === "/img/slow") return;                                                   // never answers
  if (p === "/img/redirect-private") { res.writeHead(302, { location: `http://127.0.0.1:${mockPort}/img/ok.jpg` }); return res.end(); }
  if (p === "/img/redirect-private-name") { res.writeHead(302, { location: "https://evil.private-fixture.test/img/ok.jpg" }); return res.end(); }
  if (p === "/img/redirect-metadata") { res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" }); return res.end(); }
  if (p === "/img/redirect-ok") { res.writeHead(302, { location: "https://img.fixture.test/img/ok.jpg" }); return res.end(); }
  if (p === "/img/redirect-loop") { res.writeHead(302, { location: "https://img.fixture.test/img/redirect-loop" }); return res.end(); }
  html("not found", 404);
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockPort = mock.address().port, MOCK = `http://127.0.0.1:${mockPort}`;

let server = null, browser = null;
try {
  // =================================================================== A. in-process
  const imp = (m) => import(pathToFileURL(join(APP, "lib", m)).href);
  const imgs = await imp("imagesearch.mjs");
  const routes = await imp("image-routes.mjs");
  const perm = await imp("permissions.mjs");
  // *.fixture.test is a "public" site that is really the mock; *.private-fixture.test points at the home network
  const lookup = async (h) => (/private-fixture\.test$/.test(h) ? [{ address: "10.0.0.7" }] : /fixture\.test$/.test(h) ? [{ address: "203.0.113.5" }] : /\.example\.(com|org)$/.test(h) ? [{ address: "93.184.215.14" }] : []);
  const fetchVia = (url, opts) => { const u = new URL(url); if (/fixture\.test$/.test(u.hostname)) { u.protocol = "http:"; u.host = `127.0.0.1:${mockPort}`; } return fetch(u.href, opts); };
  const fakePage = { goto: async () => {}, waitForSelector: async () => {}, content: async () => fx("bing.html") };
  let headlessUsed = 0;
  const legacyConnect = (href, o) => fetchVia(href, o);   // the fixture hosts are the mock (the pinned connection has its own checks below)
  imgs.setDeps({ fetch: fetchVia, connect: legacyConnect, lookup, base: { ddg: MOCK, bing: MOCK, brave: MOCK, google: MOCK, bingApi: MOCK }, searchPage: async () => { headlessUsed++; return fakePage; }, describe: null });
  routes.setDeps({ permissionsCheck: async () => ({ ok: true }) });

  // ---- parsing
  const d = imgs.parseDdg(JSON.parse(fx("ddg.json")));
  check("DDG fixture: 30 usable results (private and javascript: ones dropped)", d.length === 30, d.length);
  check("DDG result shape", d[1].thumbUrl === "https://img.fixture.test/img/thumb-2.jpg" && d[1].fullUrl === "https://img.fixture.test/img/full-2.jpg" && d[1].width === 1201 && d[1].height === 801 && d[1].sourcePage === "https://en.wikipedia.org/wiki/Golden_Retriever" && d[1].sourceDomain === "en.wikipedia.org" && d[1].title === "Golden retriever running on a beach", d[1]);
  check("DDG: HTML in a title comes out as plain text (for the screen to show as text)", d[0].title.includes("<img src=x") && d[0].title.includes("<script>"), d[0].title);
  const b = imgs.parseBingHtml(fx("bing.html"));
  check("Bing fixture: 14 results", b.length === 14, b.length);
  check("Bing result shape (m= JSON, size from the caption, & decoded)", b[0].fullUrl === "https://img.fixture.test/img/bing-full-1.jpg" && b[0].thumbUrl === "https://img.fixture.test/img/bing-thumb-1.jpg" && b[0].sourcePage === "https://www.lanterns0.example.org/item/1" && b[0].width === 1600 && b[0].height === 1200 && b[12].title === "Lantern & light", b[0]);
  check("Brave fixture parses", imgs.parseBrave(JSON.parse(fx("brave.json"))).length === 5);
  check("Google fixture parses", imgs.parseGoogle(JSON.parse(fx("google.json")))[0]?.sourcePage === "https://g.example.com/p1");

  // ---- the order sources are tried in
  const s1 = await imgs.search("golden retriever");
  check("DuckDuckGo first (no keys)", s1.source === "ddg" && s1.results.length === 12 && s1.total === 30 && s1.more, { source: s1.source, n: s1.results.length, tried: s1.tried });
  check("DuckDuckGo gets the vqd token and SafeSearch moderate", lastDdg.vqd === "4-31415926535897932384626433832795" && lastDdg.kp === "-1" && lastDdg.p === "1", lastDdg);
  const before = { ...hits };
  const s1b = await imgs.search("golden retriever");
  check("results are cached briefly (no second request)", hits.ddgPage === before.ddgPage && hits.ddgJson === before.ddgJson && s1b.results[0].fullUrl === s1.results[0].fullUrl);
  const s1p = await imgs.search("golden retriever", { page: 1 });
  check("page 2 is the next twelve", s1p.offset === 12 && s1p.results[0].fullUrl === s1.results[0].fullUrl.replace("full-1", "full-13"), s1p.results[0]?.fullUrl);
  imgs._clearCache(); mode.ddg = "fail";
  const s2 = await imgs.search("lantern");
  check("DuckDuckGo refused → Bing's page", s2.source === "bing" && s2.tried.map((x) => x.source).join() === "ddg,bing" && s2.results.length === 12, s2.tried);
  imgs._clearCache(); mode.ddg = "challenge";
  const s2b = await imgs.search("lantern");
  check("DuckDuckGo check page → Bing's page", s2b.source === "bing" && /check/.test(s2b.tried[0].error), s2b.tried);
  imgs._clearCache(); mode.ddg = "fail"; mode.bing = "fail";
  const s3 = await imgs.search("lantern");
  check("both refused → the headless browser, last", s3.source === "bingHeadless" && headlessUsed === 1 && s3.tried.map((x) => x.source).join() === "ddg,bing,bingHeadless", s3.tried);
  imgs._clearCache(); mode.ddg = "empty"; mode.bing = "ok";
  const s3b = await imgs.search("lantern");
  check("DuckDuckGo finds nothing → Bing", s3b.source === "bing", s3b.tried);
  imgs._clearCache(); mode.ddg = "ok";
  process.env.BRAVE_SEARCH_API_KEY = "test-secret-brave-key-123456";
  const logs = []; const ol = console.log, ow = console.warn, oe = console.error; console.log = console.warn = console.error = (...a) => logs.push(a.join(" "));
  const s4 = await imgs.search("golden retriever");
  mode.brave = "fail"; imgs._clearCache();
  const s4b = await imgs.search("golden retriever");
  console.log = ol; console.warn = ow; console.error = oe;
  check("a Brave key → Brave first, with its key header", s4.source === "brave" && lastBraveKey === "test-secret-brave-key-123456" && s4.results.length === 5, s4.tried);
  check("Brave refused → DuckDuckGo", s4b.source === "ddg" && s4b.tried[0].source === "brave" && !s4b.tried[0].ok, s4b.tried);
  check("the key is never logged or reported", !logs.join("\n").includes("test-secret-brave") && !JSON.stringify([s4, s4b]).includes("test-secret-brave"));
  process.env.GOOGLE_CSE_KEY = "g-key"; process.env.GOOGLE_CSE_ID = "g-id"; process.env.BING_IMAGE_SEARCH_KEY = "b-key";
  check("order with every key: Brave, Google, Bing API, DuckDuckGo, Bing, headless", imgs.order().join() === "brave,google,bingApi,ddg,bing,bingHeadless", imgs.order());
  process.env.BRAVE_SEARCH_API_KEY = ""; process.env.BING_IMAGE_SEARCH_KEY = ""; imgs._clearCache(); mode.brave = "ok";
  const s5 = await imgs.search("golden retriever");
  check("a Google key → Google", s5.source === "google" && s5.results.length === 3, s5.tried);
  process.env.GOOGLE_CSE_KEY = ""; process.env.GOOGLE_CSE_ID = ""; imgs._clearCache();

  // ---- filters and SafeSearch
  await imgs.search("lantern", { filters: { type: "transparent", size: "big", color: "red", layout: "wide", recent: "week", site: "wikipedia" } });
  check("filters reach DuckDuckGo (f=) and site: goes in the words", lastDdg.f === "time:Week,size:Large,color:Red,type:transparent,layout:Wide," && lastDdg.q === "lantern site:wikipedia.org", lastDdg);
  check("Bing filter words", imgs.bingQft({ type: "photo", size: "large", recent: "day" }) === "+filterui:imagesize-large+filterui:photo-photo+filterui:age-lt1440", imgs.bingQft({ type: "photo", size: "large", recent: "day" }));
  check("SafeSearch is on (moderate) by default", imgs.prefs().safeSearch === "moderate");
  imgs.setPrefs({ safeSearch: "strict" }); await imgs.search("cats");
  check("SafeSearch strict → DuckDuckGo kp=1", lastDdg.kp === "1" && lastDdg.p === "1", lastDdg);
  mode.ddg = "fail"; imgs._clearCache(); await imgs.search("cats");
  check("SafeSearch strict → Bing adlt=strict", lastBing.adlt === "strict", lastBing);
  mode.ddg = "ok"; imgs.setPrefs({ safeSearch: "off" }); await imgs.search("cats");
  check("SafeSearch off → DuckDuckGo p=-1", lastDdg.p === "-1" && lastDdg.kp === "-2", lastDdg);
  imgs.setPrefs({ safeSearch: "moderate" });
  let badPref = null; try { imgs.setPrefs({ safeSearch: "whatever" }); } catch (e) { badPref = e.message; }
  check("SafeSearch only takes strict/moderate/off", Boolean(badPref));

  // ---- fetching a picture safely (what the proxy and saving use)
  const refused = async (u, status, opts) => { try { await imgs.fetchImage(u, opts); return "fetched"; } catch (e) { return e.status === status ? true : `${e.status} ${e.message}`; } };
  const ok = await imgs.fetchImage("https://img.fixture.test/img/ok.jpg");
  check("a public picture comes through (checked by its bytes)", ok.type === "image/jpeg" && ok.buf.length === JPEG.length);
  for (const [u, st, name] of [
    ["http://127.0.0.1:4747/api/build", 403, "127.0.0.1 (this computer)"], ["http://localhost:4747/", 403, "localhost"], ["http://[::1]/x.jpg", 403, "::1"],
    ["http://10.1.2.3/x.jpg", 403, "10.x"], ["http://192.168.1.1/x.jpg", 403, "192.168.x"], ["http://172.20.0.1/x.jpg", 403, "172.16/12"], ["http://169.254.169.254/latest/", 403, "cloud metadata 169.254.x"],
    ["http://0.0.0.0/x.jpg", 403, "0.0.0.0"], ["http://[::ffff:127.0.0.1]/x.jpg", 403, "IPv4-mapped IPv6 loopback"], ["http://printer.local/x.jpg", 403, ".local names"],
    ["https://evil.private-fixture.test/x.jpg", 403, "a name that points at the home network"], ["file:///C:/Windows/win.ini", 400, "file:"], ["ftp://example.com/x.jpg", 400, "ftp:"],
    ["https://img.fixture.test/img/html", 415, "a web page (text/html)"], ["https://img.fixture.test/img/svg", 415, "SVG (can carry script)"], ["https://img.fixture.test/img/fake-jpeg", 415, "says image/jpeg but isn't one"],
    ["https://img.fixture.test/img/big", 413, "over 8 MB (by its header)"], ["https://img.fixture.test/img/big-chunked", 413, "over 8 MB (while streaming)"],
    ["https://img.fixture.test/img/redirect-private", 403, "a redirect to 127.0.0.1"], ["https://img.fixture.test/img/redirect-private-name", 403, "a redirect to a name on the home network"],
    ["https://img.fixture.test/img/redirect-metadata", 403, "a redirect to 169.254.169.254"], ["https://img.fixture.test/img/redirect-loop", 502, "endless redirects"],
  ]) check(`refused: ${name}`, (await refused(u, st)) === true, await refused(u, st));
  check("refused: too slow (times out)", (await refused("https://img.fixture.test/img/slow", 504, { timeoutMs: 800 })) === true);
  const red = await imgs.fetchImage("https://img.fixture.test/img/redirect-ok").catch((e) => e);
  check("a redirect to another public picture is followed", red?.type === "image/jpeg", red?.message);

  // ---- DNS rebinding: the real pinned connection, with a mock resolver. For these checks only, 127.0.0.1 (the mock)
  // counts as a public address; *.pin.test names answer from the resolver below.
  {
    let asked = 0;
    const rebinding = async (h) => {
      if (h === "rebind.pin.test") return asked++ === 0 ? [{ address: "127.0.0.1" }] : [{ address: "10.0.0.9" }];   // public first, then the home network
      if (h === "start.pin.test") return [{ address: "127.0.0.1" }];
      if (h === "hop.pin.test") return [{ address: "192.168.1.20" }];
      if (h === "evil.pin.test") return [{ address: "10.0.0.5" }];
      return lookup(h);
    };
    imgs.setDeps({ lookup: rebinding, isPrivate: (ip) => (ip === "127.0.0.1" ? false : imgs.privateIp(ip)), connect: (...a) => imgs.pinnedFetch(...a) });
    const pinned = await imgs.fetchImage(`http://rebind.pin.test:${mockPort}/img/ok.jpg`).catch((e) => e);
    check("rebinding: the name is looked up once and the picture comes from exactly that address", pinned?.type === "image/jpeg" && asked === 1 && pinHits === 1, pinned?.message ?? { asked, pinHits });
    check("rebinding: the site's name is kept in the Host header", lastPinHost === `rebind.pin.test:${mockPort}`, lastPinHost);
    const before = pinHits;
    check("rebinding: a name that answers with the home network is refused before connecting", (await refused(`http://evil.pin.test:${mockPort}/img/ok.jpg`, 403)) === true && pinHits === before, pinHits - before);
    check("rebinding: every redirect is looked up and checked again (a public site moving to the home network)", (await refused(`http://start.pin.test:${mockPort}/img/redirect-hop`, 403)) === true && pinHits === before + 1, pinHits - before);
    imgs.setDeps({ isPrivate: imgs.privateIp });
    const peer = await imgs.pinnedFetch(`http://rebind.pin.test:${mockPort}/img/ok.jpg`, {}, { address: "127.0.0.1", family: 4 }).then(() => "connected", (e) => e.status);
    check("rebinding: the connected socket's own address is checked too", peer === 403, peer);
    imgs.setDeps({ lookup, isPrivate: imgs.privateIp, connect: legacyConnect });
  }

  // ---- saving: Pictures\Dayspring only when allowed, else data/images; the source is noted beside it
  const it = s1.results[1];
  perm.set({ files: "off", entries: [] });
  const sv1 = await imgs.save(it, { query: "golden retriever" });
  const note1 = JSON.parse(readFileSync(sv1.path.replace(/\.jpg$/, ".json"), "utf8"));
  check("files off → saved in data/images", sv1.where === "data" && sv1.path.startsWith(IMGDIR) && existsSync(sv1.path), sv1);
  check("…with its source page and address noted", note1.sourcePage === "https://en.wikipedia.org/wiki/Golden_Retriever" && note1.imageUrl === it.fullUrl && note1.query === "golden retriever", note1);
  perm.set({ files: "custom", entries: [{ path: PICS, kind: "folder", access: "read" }] });
  const sv2 = await imgs.save(it);
  check("Pictures look-only → data/images", sv2.where === "data" && sv2.path.startsWith(IMGDIR), sv2);
  perm.set({ files: "custom", entries: [{ path: PICS, kind: "folder", access: "readwrite" }] });
  const sv3 = await imgs.save(it);
  check("Pictures allowed → Pictures\\Dayspring", sv3.where === "pictures" && sv3.path.startsWith(join(PICS, "Dayspring")) && existsSync(sv3.path) && existsSync(sv3.path.replace(/\.jpg$/, ".json")), sv3);
  perm.set({ files: "custom", entries: [{ path: PICS, kind: "folder", access: "readwrite" }, { path: join(PICS, "Dayspring"), kind: "folder", access: "none" }] });
  const sv4 = await imgs.save(it);
  check("Pictures\\Dayspring kept out → data/images", sv4.where === "data", sv4);
  const badSave = await imgs.save({ title: "x", fullUrl: "http://127.0.0.1/x.jpg", thumbUrl: "http://192.168.0.2/x.jpg" }).catch((e) => e.message);
  check("saving refuses private addresses too", /couldn't download/.test(badSave), badSave);
  perm.set({ files: "off", entries: [] });

  // ---- what people say
  const S = [["show me pictures of golden retrievers", "golden retrievers", {}], ["image search for mid-century desk", "mid-century desk", {}], ["find a transparent png of a lantern", "lantern", { type: "transparent" }],
    ["Dayspring, show me some photos of the eiffel tower from wikipedia", "eiffel tower", { site: "wikipedia" }], ["find me wallpapers of mountains", "mountains", { size: "wallpaper" }], ["find a gif of a dancing cat", "dancing cat", { type: "gif" }],
    ["what does a capybara look like", "capybara", {}], ["search images for red barns", "red barns", {}]];
  for (const [t, q, f] of S) { const r = routes.parseSearch(t); check(`heard: "${t}"`, r && r.query === q && JSON.stringify(r.filters) === JSON.stringify(f), r); }
  for (const t of ["show me some photos", "show me pictures of my kids", "look up how tall everest is", "what's my day look like", "show me the schedule", "set a timer for 10 minutes"]) check(`not a web picture search: "${t}"`, routes.parseSearch(t) === null, routes.parseSearch(t));
  const C = [["show number 3", { do: "view", n: 3 }], ["show number 2 bigger", { do: "view", n: 2 }], ["show number three", { do: "view", n: 3 }], ["the fourth one", { do: "view", n: 4 }], ["more", { do: "more" }], ["next page", { do: "more" }],
    ["previous page", { do: "prev" }], ["more like number 4", { do: "similar", n: 4 }], ["save that one", { do: "save", n: null }], ["save number 3", { do: "save", n: 3 }], ["close images", { do: "close" }], ["close the pictures", { do: "close" }], ["open the source for number 2", { do: "source", n: 2 }]];
  for (const [t, want] of C) check(`on screen: "${t}"`, JSON.stringify(routes.parseContext(t)) === JSON.stringify(want), routes.parseContext(t));
  for (const [t, want] of [["only photos", { type: "photo" }], ["bigger ones", { size: "large" }], ["from wikipedia", { site: "wikipedia" }], ["only red ones", { color: "red" }], ["just gifs", { type: "gif" }]]) check(`refine: "${t}"`, JSON.stringify(routes.parseRefine(t)?.filters) === JSON.stringify(want), routes.parseRefine(t));

  // ---- the AI's tools
  routes._reset();
  const t1 = await routes.runTool("image_search", { query: "golden retriever puppy" }, { provider: "anthropic" });
  check("image_search: shown, numbered 1–12, with titles and sites", t1.shownOnScreen && t1.results.length === 12 && t1.results[0].n === 1 && t1.results[11].n === 12 && t1.results[1].site === "en.wikipedia.org", t1);
  const t2 = await routes.runTool("look_at_image", { numbers: [2, 3] }, { provider: "anthropic" });
  check("look_at_image (Claude): the thumbnails as picture blocks", Array.isArray(t2.toolContent) && t2.toolContent.filter((x) => x.type === "image").length === 2 && t2.toolContent.find((x) => x.type === "image").source.media_type === "image/jpeg", t2.toolContent?.map((x) => x.type));
  check("look_at_image tells the AI not to identify people", /never identify/i.test(JSON.stringify(t2.toolContent[0])) && /never|NEVER/.test(routes.TOOLS.find((x) => x.name === "look_at_image").description));
  const t3 = await routes.runTool("look_at_image", { n: 2 }, { provider: "openai" }).catch((e) => e.message);
  check("look_at_image without a model that sees: says so", /can't look at pictures/.test(t3), t3);
  check("look_at_image is only offered to a model that sees", !routes.tools({ provider: "openai" }).some((x) => x.name === "look_at_image") && routes.tools({ provider: "anthropic" }).some((x) => x.name === "look_at_image"));
  imgs.setDeps({ describe: async (buf, o) => `a dog, ${buf.length} bytes, detail ${o.detail}` });
  const t4 = await routes.runTool("look_at_image", { n: 2 }, { provider: "openai" });
  check("look_at_image uses lib/vision's describer when there is one", t4.pictures?.[0]?.description?.startsWith("a dog"), t4);
  check("with a describer, look_at_image is offered to any AI", routes.tools({ provider: "openai" }).some((x) => x.name === "look_at_image"));
  let aiFlag = "unset"; imgs.setDeps({ describe: async (buf, o) => { aiFlag = o.ai; return { text: "text in it: OPEN" }; } });
  const t4b = await routes.runTool("look_at_image", { n: 2 }, { provider: "anthropic" });
  check("Claude still gets the picture itself, plus what lib/vision read locally (no second AI call)", aiFlag === false && t4b.toolContent.some((x) => x.type === "image") && /OPEN/.test(JSON.stringify(t4b.toolContent)), { aiFlag });
  imgs.setDeps({ describe: undefined });
  const real = await imgs.describer();
  check("the real lib/vision/describe.mjs is found when it's there", existsSync(join(APP, "lib", "vision", "describe.mjs")) ? typeof real === "function" : real === null);
  imgs.setDeps({ describe: null });
  const t5 = await routes.runTool("image_control", { action: "view", n: 5 });
  check("image_control view", t5.showing === 5 && routes.current().selected === 5, t5);
  check("look_at_image describes through describeWebImage (never identifies anyone)", /describeWebImage/.test(String(real)) && !/describeImage\(/.test(String(real)), String(real).slice(0, 160));
  // ---- the picture shown big is what "describe this picture" means (lib/vision/describe.mjs setOnScreen)
  {
    let told = null; const shown = [];
    const fakeVision = { setOnScreen: (x) => { told = x ? { ...x } : null; shown.push(told); return told; }, onScreen: () => told };
    routes.setDeps({ vision: fakeVision });
    routes._reset();
    await routes.runTool("image_search", { query: "golden retriever puppy" }, { provider: "anthropic" });
    check("a grid alone isn't \"this picture\"", told === null, told);
    await routes.runTool("image_control", { action: "view", n: 3 });
    const it3 = routes.current().all.get(3);
    for (let i = 0; i < 40 && !told?.buffer; i++) await sleep(50);
    check("shown big → vision is told: a web picture, its address and title", told?.kind === "web" && told.url === it3.fullUrl && told.title === it3.title, told);
    check("…with its bytes, fetched once through the safe fetcher", Buffer.isBuffer(told?.buffer) && told.buffer.length === JPEG.length, told?.buffer?.length);
    await routes.runTool("image_control", { action: "grid" }); await sleep(50);
    check("back to the grid → cleared (a photo shown later isn't hidden)", told === null, told);
    await routes.runTool("image_control", { action: "view", n: 4 }); await sleep(50);
    routes.close(); await sleep(50);
    check("closing the pictures → cleared", told === null && shown.some((x) => x?.url === routes.current()?.all.get(4)?.fullUrl), told);
    routes.setDeps({ vision: null });
  }
  routes._reset();

  // =================================================================== B. the real server and the screen
  const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1",
    DAYSPRING_NO_HEADLESS_SEARCH: "1", DAYSPRING_IMAGESEARCH_MOCK: MOCK, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "none", DAYSPRING_REMINDER_CHANNEL: "off",
    BRAVE_SEARCH_API_KEY: "", GOOGLE_CSE_KEY: "", GOOGLE_CSE_ID: "", BING_IMAGE_SEARCH_KEY: "" };
  imgs._clearCache();
  server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let serverLog = ""; server.stdout.on("data", (x) => (serverLog += x)); server.stderr.on("data", (x) => (serverLog += x));
  const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  check("test server started", await up(), serverLog.slice(0, 600));
  const api = async (path, body) => { const r = await fetch(BASE + "/api" + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); };
  const chat = (message) => api("/chat", { message, surface: "tv", typed: true });

  // the proxy route, over HTTP
  const px = async (u, headers = {}) => (await fetch(`${BASE}/api/images/proxy?u=${encodeURIComponent(u)}`, { headers })).status;
  check("proxy route: this computer refused", (await px(`http://127.0.0.1:${PORT}/api/build`)) === 403);
  check("proxy route: localhost refused", (await px("http://localhost:4747/")) === 403);
  check("proxy route: the home network refused", (await px("http://192.168.0.1/x.jpg")) === 403);
  check("proxy route: file: refused", (await px("file:///C:/Windows/win.ini")) === 400);
  check("proxy route: the mock search server itself refused (it's on 127.0.0.1)", (await px(`${MOCK}/img/ok.jpg`)) === 403);
  check("proxy route: another website's page can't use it (localRequest)", (await px("https://img.fixture.test/x.jpg", { origin: "https://evil.example.com", "sec-fetch-site": "cross-site" })) === 403);
  const { chromium } = await import(PW);
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--no-first-run", "--disable-extensions"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(e.message));
  const outside = []; page.on("request", (r) => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
  await page.goto(`${BASE}/display`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.dsEvents && window.dsImages, null, { timeout: 20000 });
  await sleep(800);
  const st = () => page.evaluate(() => window.dsImages._state());

  const r1 = await chat("show me pictures of golden retrievers");
  check("\"show me pictures of golden retrievers\" answers without AI", /Here are 12 pictures of golden retrievers/.test(r1.reply), r1.reply);
  await page.waitForFunction(() => window.dsImages._state().numbers.length === 12, null, { timeout: 8000 }).catch(() => {});
  let s = await st();
  check("the screen shows a numbered grid of 12", s.open && s.numbers.join() === "1,2,3,4,5,6,7,8,9,10,11,12", s);
  const grid = await page.evaluate(() => ({ xss: window.__xss ?? null, t0: document.querySelector("#dsImages .cell .t")?.textContent, d1: document.querySelectorAll("#dsImages .cell .d")[1]?.textContent, imgs: [...document.querySelectorAll("#dsImages img")].map((i) => i.getAttribute("src")), injected: document.querySelectorAll("#dsImages .cap img, #dsImages .cap script").length }));
  check("no script runs from a title, and it shows as text", grid.xss === null && grid.injected === 0 && grid.t0.includes("<img src=x"), grid);
  check("title and site under each picture", grid.d1 === "en.wikipedia.org", grid.d1);
  check("every picture comes through Dayspring's proxy", grid.imgs.length === 12 && grid.imgs.every((u) => u.startsWith("/api/images/proxy?u=")), grid.imgs.slice(0, 2));
  const r2 = await chat("show number 3 bigger");
  await page.waitForFunction(() => window.dsImages._state().big, null, { timeout: 5000 }).catch(() => {});
  s = await st();
  check("\"show number 3 bigger\" → number 3, big, with its page link", /^Number 3: Two golden retrievers/.test(r2.reply) && s.big && s.selected === 3 && await page.evaluate(() => document.querySelector("#dsImages a.src")?.getAttribute("rel") === "noopener noreferrer"), { reply: r2.reply, s });
  await page.keyboard.press("Escape"); await sleep(600);
  s = await st();
  check("Esc goes back to the grid", s.open && !s.big, s);
  await page.click('#dsImages .cell[data-n="5"]'); await page.waitForFunction(() => window.dsImages._state().selected === 5, null, { timeout: 5000 }).catch(() => {});
  check("clicking a picture shows it big", (await st()).selected === 5);
  const r3 = await chat("more");
  await page.waitForFunction(() => window.dsImages._state().numbers[0] === 13, null, { timeout: 5000 }).catch(() => {});
  s = await st();
  check("\"more\" → numbers 13 to 24", /numbers 13 to 24/.test(r3.reply) && s.numbers[0] === 13 && s.numbers.at(-1) === 24 && !s.big, { reply: r3.reply, s });
  const r4 = await chat("show number 14");
  check("numbers keep counting on the next page", /^Number 14:/.test(r4.reply), r4.reply);
  const r5 = await chat("previous page");
  await page.waitForFunction(() => window.dsImages._state().numbers[0] === 1, null, { timeout: 5000 }).catch(() => {});
  check("\"previous page\" → back to 1 to 12", /1 to 12/.test(r5.reply) && (await st()).numbers[0] === 1, r5.reply);
  const r5b = await chat("show number 40");
  check("a number that isn't there is said plainly", /no number 40/.test(r5b.reply), r5b.reply);
  const r6 = await chat("only photos");
  check("\"only photos\" searches again, photos only", /photos only/.test(r6.reply) && /type:photo/.test(lastDdg.f), { reply: r6.reply, f: lastDdg.f });
  const r7 = await chat("from wikipedia");
  check("\"from wikipedia\" → site:wikipedia.org", /from wikipedia\.org/.test(r7.reply) && lastDdg.q === "golden retrievers site:wikipedia.org", { reply: r7.reply, q: lastDdg.q });
  const savedBefore = readdirSync(IMGDIR).length;
  const r8 = await chat("save number 2");
  check("saving a picture whose host can't be reached says so (nothing written)", /couldn't download/.test(r8.reply) && readdirSync(IMGDIR).length === savedBefore, r8.reply);
  const r9 = await chat("find a transparent png of a lantern");
  check("\"find a transparent png of a lantern\" → transparent filter", /pictures of lantern, transparent/.test(r9.reply) && /type:transparent/.test(lastDdg.f) && lastDdg.q === "lantern", { reply: r9.reply, ddg: lastDdg });
  const r10 = await chat("more like number 4");
  check("\"more like number 4\" searches for what's in number 4", /^Okay, here are \d+ pictures of /.test(r10.reply) && lastDdg.q !== "lantern", { reply: r10.reply, q: lastDdg.q });
  const r11 = await chat("close images");
  await page.waitForFunction(() => !window.dsImages._state().open, null, { timeout: 5000 }).catch(() => {});
  check("\"close images\" closes them", /Closed/.test(r11.reply) && !(await st()).open, r11.reply);
  // commands that sound alike, across features
  const rc = await chat("show me photos of Casey");
  check("\"show me photos of Casey\" (someone the owner knows) → their own photos, not a web search", !/pictures of casey|picture search/i.test(rc.reply) && rc.intent !== "images" && /Casey/.test(rc.reply), rc);
  const rs = await chat("what does this picture say");
  check("\"what does this picture say\" → reading the picture (not \"did you mean…\")", /picture on the screen/i.test(rs.reply), rs);
  const rm = await chat("who's in the meeting");
  check("\"who's in the meeting\" with no meeting → said plainly (not the picture's people)", /not in a meeting/i.test(rm.reply), rm.reply);
  const rw = await chat("who's in this picture");
  check("\"who's in this picture\" → the picture, not the meeting", /picture/i.test(rw.reply) && !/meeting/i.test(rw.reply), rw);
  const r12 = await chat("show number 3");
  check("with nothing up, \"show number 3\" isn't taken by pictures (nor by the book of Numbers)", !/^Number 3:/.test(r12.reply) && /nothing numbered on the screen/i.test(r12.reply), r12.reply);
  const st2 = await api("/images/settings", { safeSearch: "strict" });
  check("settings route: SafeSearch strict", st2.safeSearch === "strict" && st2.order.join() === "ddg,bing,bingHeadless", st2);
  const k = await api("/images/keys", { service: "brave", key: "brv-secret-0000111122223333" });
  check("keys route: set, and only the last four come back", k.using?.brave === true && k.keys.BRAVE_SEARCH_API_KEY.last4 === "3333" && !JSON.stringify(k).includes("brv-secret"), k);
  await api("/images/keys", { service: "brave", key: "" });
  check("the screen loaded no picture from other sites (only through the proxy)", !outside.some((u) => /fixture\.test|example\.(com|org)|wikipedia/.test(u)), outside.slice(0, 3));
  check("no errors on the page", pageErrors.length === 0, pageErrors);
  check("the key never reached the server's log", !serverLog.includes("brv-secret"));
} catch (e) {
  check("the checks ran to the end", false, e.stack);
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  if (server) { server.kill(); await sleep(500); }
  mock.close();
  // the node_modules junction is removed as a link first (never followed into the real node_modules)
  if (!KEEP) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); if (!existsSync(join(APP, "node_modules"))) try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a file still open */ } }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
