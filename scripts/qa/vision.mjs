// Photos and people (lib/vision, lib/people), on a throwaway copy: never your own Dayspring, its data, or your photo
// folders. The test pictures are public-domain NASA photos in scripts/qa/fixtures/vision (see SOURCES.txt); the people in
// them get made-up names. Checks:
//   A. Windows OCR through the picture helper on a generated text picture
//   B. the offline description template, and describing without AI
//   C. every setting starts off (faces, AI descriptions, saved texts and calls)
//   D. the face models: download (checked against their fingerprints; cached between runs in %TEMP%), detection and
//      fingerprints on the fixtures (same person matches, different people don't)
//   E. the background look through the (test) photo folder, grouping, naming a group, and "Who's in this picture?"
//      answered with several names and positions (me, left/middle/right, relations, what was going on)
//   F. merge, split, "not a person", ignore, delete a person (faces, thumbnails, messages all go)
//   G. encryption at rest (DPAPI) for faces and messages
//   H. the question cadence: budget per day, spacing, Quiet/Off, meetings, calls; "who" and "what" as one question
//   I. texts and calls: off writes nothing; on saves to the right person; unsure senders become questions; mentions
//      become suggestions; keep-for trimming; delete all
//   J. the profile's link-ups: prayer (private stays private), goals, past and upcoming events, connections, messages
//   K. pictures from the web are described but never identified (and the face index isn't touched)
//   L. voice commands without AI, and the server's routes (settings default off, /photos/next)
//   node scripts/qa/vision.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESK = join(HERE, "..", "..");
const INNER = process.argv.includes("--inner");

if (!INNER) {
  // ---- outer: make the throwaway copy, run the checks inside it ----
  const TMP = mkdtempSync(join(tmpdir(), "ds-vision-")), APP = join(TMP, "app"), PICS = join(TMP, "photos");
  const skip = new Set(["data", "node_modules", "bin", "dist", "dist-out", "backups", "updates", "logs", ".git", ".env"]);
  mkdirSync(APP, { recursive: true });
  for (const e of readdirSync(DESK)) if (!skip.has(e)) cpSync(join(DESK, e), join(APP, e), { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s.slice(DESK.length)) });
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary", features: { photos: true, faith: true } }));
  // a prayer list with requests about one of the made-up people (one private), for the profile link-ups (J)
  writeFileSync(join(APP, "data", "devotion.json"), JSON.stringify({ prayer: { list: [{ title: "Test Alpha's surgery", detail: "on Friday", people: ["Test Alpha"] }, { title: "Something private", detail: "secret detail", private: true, people: ["Test Alpha"] }, { title: "Unrelated request" }], answered: [{ title: "New job for Test Alpha", answeredOn: "2026-09-01", people: ["Test Alpha"] }] } }));
  mkdirSync(PICS, { recursive: true });
  for (const f of readdirSync(join(HERE, "fixtures", "vision"))) if (f.endsWith(".jpg")) copyFileSync(join(HERE, "fixtures", "vision", f), join(PICS, f));
  const env = { ...process.env, DAYSPRING_PHOTO_DIRS: PICS, DAYSPRING_VISION_CACHE: process.env.DAYSPRING_VISION_CACHE || join(tmpdir(), "dayspring-vision-cache-test"), DAYSPRING_FACE_THROTTLE_MS: "0",
    DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"), DAYSPRING_NO_ECO: "1", DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_DISPLAY: "", DAYSPRING_TV: "",
    AI_PROVIDER: "none", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", QA_TMP: TMP };
  const r = spawnSync(process.execPath, [join(APP, "scripts", "qa", "vision.mjs"), "--inner"], { cwd: APP, env, stdio: "inherit", windowsHide: true });
  if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a helper may still be closing */ } }
  else console.log(`kept: ${TMP}`);
  process.exit(r.status ?? 1);
}

// ---- inner: inside the copy ----
const APP = join(HERE, "..", "..");
const TMP = process.env.QA_TMP, PICS = process.env.DAYSPRING_PHOTO_DIRS;
const lib = (m) => import(pathToFileURL(join(APP, "lib", m)).href);
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 260) + ")" : ""}`); };
const section = (t) => console.log(`\n-- ${t}`);

const helper = await lib("vision/helper.mjs");
const describe = await lib("vision/describe.mjs");
const vsettings = await lib("vision/settings.mjs");
const models = await lib("vision/models.mjs");
const faces = await lib("vision/faces.mjs");
const library = await lib("vision/library.mjs");
const ask = await lib("vision/ask.mjs");
const skills = await lib("vision/skills.mjs");
const people = await lib("people/index.mjs");
const comms = await lib("people/comms.mjs");
const secure = await lib("vision/secure.mjs");
const photos = await lib("photos.mjs");
const store = await lib("store.mjs");
const settings = await lib("settings.mjs");
const goals = await lib("goals.mjs");
const PEOPLE_DIR = join(APP, "data", "people");

try {
  // ------------------------------------------------------------------ A. OCR
  section("A. text in pictures (Windows OCR)");
  const av = await helper.available();
  check("the picture helper builds and runs", av.ok, av.error);
  check("Windows OCR is available", av.ocr, av);
  const textPic = join(TMP, "sign.png");
  await helper.render("Welcome to Dayspring\nMeet at 7:30 by the lake", textPic, { w: 900, h: 260, size: 42 });
  const rt = await describe.readText(textPic);
  check("OCR reads the generated text", /dayspring/i.test(rt.text) && /lake/i.test(rt.text), rt.text);

  // ------------------------------------------------------------------ B. offline template
  section("B. describing without AI");
  const tpl = describe.templateDescription({ source: "library", faces: { count: 3, checked: true, names: ["Sarah", "Tom"], unnamed: 1 }, ocr: { text: "Happy birthday" }, facts: { taken: "2021-07-04T10:00:00", camera: "Pixel 7", width: 1200, height: 800, gps: { lat: 1, lon: 2 } }, colors: [{ hex: "#2050c0", share: 0.4 }, { hex: "#f0f0f0", share: 0.3 }], catalogue: { description: "Our trip to the lake" } });
  check("template: owner's words, names, unnamed count", tpl.includes("Our trip to the lake") && tpl.includes("Sarah and Tom are in it") && tpl.includes("someone I don't know yet"), tpl);
  check("template: text, date, camera, colours, location noted (no coordinates)", tpl.includes('"Happy birthday"') && tpl.includes("July 4, 2021") && tpl.includes("Pixel 7") && /blue/.test(tpl) && tpl.includes("location saved") && !/\b1\b.*\b2\b/.test(tpl.replace(/\d{3,}/g, "")), tpl);
  const d1 = await describe.describeImage(textPic, { ai: false });
  check("describeImage without AI includes the OCR text", d1.text.includes("Meet at 7:30") && d1.usedAI === false, d1.text);
  const tplWeb = describe.templateDescription({ source: "web", faces: { count: 2, checked: true, names: [], unnamed: 2 } });
  check("template for a web picture says people aren't identified", /don't identify anyone/.test(tplWeb) && /2 faces/.test(tplWeb), tplWeb);

  // ------------------------------------------------------------------ C. defaults
  section("C. settings start off");
  const s0 = vsettings.get();
  check("face recognition off by default", s0.faces === false);
  check("AI descriptions off by default", s0.aiDescribe === false && s0.aiMessages === false);
  check("saving texts and calls off by default", s0.saveTexts === false && s0.saveCalls === false);
  check("one question a day by default; keep messages by default", s0.askPerDay === 1 && s0.keepDays === 0);
  check("off: no text is written", (await comms.recordText({ who: "Anyone", text: "hello" })) === null && !existsSync(join(PEOPLE_DIR, "comms.bin")));
  check("off: no call is written", (await comms.logCall({ who: ["Anyone"], app: "phone" })) === null && !existsSync(join(PEOPLE_DIR, "comms.bin")));
  const scanned = await photos.scanNow();
  check("the test photo folder is the only photo folder", scanned.length === 4 && scanned.every((p) => p.path.startsWith(PICS)), scanned.map((p) => p.path));
  // without face recognition, Windows' own detector still counts faces (no names)
  const byName = Object.fromEntries(scanned.map((p) => [p.name, p]));
  const g0 = await describe.describeImage(byName["pd-group-three.jpg"].path, { ai: false });
  check("faces off: three faces counted, nobody named", g0.faces.count === 3 && g0.faces.names.length === 0, g0.faces);

  // ------------------------------------------------------------------ D. models, detection, fingerprints
  section("D. face models and fingerprints");
  let st = models.status();
  if (!st.installed) { console.log("  (downloading the face models to the test cache, ~72 MB)"); st = await models.install(); }
  check("models installed and checksums verified", st.installed, st);
  const found = {};
  for (const n of Object.keys(byName)) found[n] = await faces.find(byName[n].path);
  check("group photo: three faces with fingerprints", found["pd-group-three.jpg"].faces.length === 3 && found["pd-group-three.jpg"].faces.every((f) => f.emb), found["pd-group-three.jpg"].faces.length);
  check("each portrait: one face", ["left", "middle", "right"].every((k) => found[`pd-portrait-${k}.jpg`].faces.length === 1));
  const group = found["pd-group-three.jpg"].faces.slice().sort((a, b) => a.box[0] - b.box[0]).map((f) => faces.decodeEmb(f.emb));
  const por = ["left", "middle", "right"].map((k) => faces.decodeEmb(found[`pd-portrait-${k}.jpg`].faces[0].emb));
  const sims = por.map((p) => group.map((g) => faces.similarity(p, g)));
  check("the same person matches (left↔left, middle↔middle, right↔right)", sims.every((row, i) => row[i] >= library.T.JOIN && row[i] === Math.max(...row)), sims.map((r) => r.map((x) => x.toFixed(2))));
  check("different people don't match", sims.every((row, i) => row.every((x, j) => i === j || x < library.T.SUGGEST)), sims.map((r) => r.map((x) => x.toFixed(2))));
  check("the face engine stays under its memory limit", faces.workerStatus().rssMB <= faces.workerStatus().limitMB, faces.workerStatus());

  // ------------------------------------------------------------------ E. indexing, grouping, naming
  section("E. the look through the photos, groups, naming");
  vsettings.set({ faces: true });
  await library.start({ throttleMs: 0 });
  const ix = await library.waitIdle(180_000);
  check("all four test photos looked through", ix.done === 4 && !ix.running, ix);
  let groups = await library.clusters();
  check("three groups, each in two photos", groups.length === 3 && groups.every((g) => g.photos.length === 2), groups.map((g) => g.photos.length));
  check("each group has a thumbnail", groups.every((g) => g.thumb && Buffer.from(g.thumb, "base64")[0] === 0xff));
  const idOf = (name) => byName[name].id;
  const leftCluster = (await library.facesIn(idOf("pd-portrait-left.jpg")))[0].cluster;
  const named = await people.nameFaces({ cluster: leftCluster, name: "Test Alpha", relation: "your cousin" });
  check("naming a group names every face in it", named.faces === 2 && (await library.photosOf(named.person.id)).length === 2, named);
  check("the person is in people.json with an id, a source and private visibility", Boolean(named.person.id && named.person.source?.app === "dayspring" && named.person.visibility === "private"), named.person);
  const alpha = named.person;

  // "Who's in this picture?" for the group photo: two faces still unnamed, and no description yet → one combined question
  const noon = new Date(); noon.setHours(14, 0, 0, 0);
  const today = store.todayISO(noon);
  const plan = await ask.plan({ date: today, want: true, now: noon });
  check("a relaxed moment with budget left: may ask", plan.any && plan.who && plan.what, plan);
  const pickd = photos.pick({ forQuestion: true, prefer: plan.prefer });
  const dec = await ask.decide(photos.info(idOf("pd-group-three.jpg")), plan);
  check("the photo with unnamed faces is preferred", plan.prefer.has(pickd.id), pickd.name);
  check("who + what become ONE question", dec.ask && dec.kind === "both" && /Who's in this picture, and what was going on\?/.test(dec.question), dec);
  const vision = await lib("vision/index.mjs");
  await vision.showing({ id: idOf("pd-group-three.jpg"), asked: true, kind: "both" });
  const ans = await skills.handle("Test Alpha on the left, Test Bravo in the middle and his friend Test Charlie on the right at the launch pad", { photo: idOf("pd-group-three.jpg") });
  check("the answer is confirmed briefly", /^Saved: Test Alpha on the left, Test Bravo in the middle and Test Charlie on the right, at the launch pad\./.test(ans?.reply ?? ""), ans?.reply);
  const gf = await library.facesIn(idOf("pd-group-three.jpg"));
  const nameOf = (id) => (id ? people.find(id)?.name : null);
  check("names matched to face positions", gf.map((f) => nameOf(f.personId)).join("|") === "Test Alpha|Test Bravo|Test Charlie", gf.map((f) => nameOf(f.personId)));
  check("the names spread to the rest of each group (the portraits)", nameOf((await library.facesIn(idOf("pd-portrait-middle.jpg")))[0].personId) === "Test Bravo" && nameOf((await library.facesIn(idOf("pd-portrait-right.jpg")))[0].personId) === "Test Charlie");
  const cat = photos.info(idOf("pd-group-three.jpg"));
  check("what was going on went into the photo catalogue", /launch pad/.test(cat.description ?? ""), cat);
  const charlie = people.find("Test Charlie"), bravo = people.find("Test Bravo");
  check("a relation to the previous person is kept as a connection", (charlie.links ?? []).some((l) => l.personId === bravo.id && l.relation === "friend"), charlie.links);
  check("the event is a fact on each person's profile", people.find("Test Bravo").notes.some((n) => /launch pad/.test(n.text) && n.photoId === idOf("pd-group-three.jpg")));
  check("the question isn't waiting any more", !ask.pending() && !photos.pending());
  const who = await skills.handle("who is in this picture?", { photo: idOf("pd-group-three.jpg") });
  check("\"who is in this picture?\" answers left to right", who.reply === "Test Alpha on the left, Test Bravo in the middle and Test Charlie on the right.", who.reply);
  const desc = await skills.handle("describe this picture", { photo: idOf("pd-group-three.jpg") });
  check("\"describe this picture\" uses the names (no AI)", /Test Alpha, Test Bravo and Test Charlie are in it/.test(desc.reply) && /launch pad/.test(desc.reply), desc.reply);
  const showOf = await skills.handle("show me photos of Test Alpha", { photo: null });
  check("\"show me photos of …\" puts their photos up", showOf.photo === "next" && /2 photos of Test Alpha/.test(showOf.reply) && [idOf("pd-portrait-left.jpg"), idOf("pd-group-three.jpg")].includes(photos.pick().id), showOf.reply);
  const lastSeen = await skills.handle("when did I last see Test Bravo in a photo?", {});
  check("\"when did I last see … in a photo\"", /The most recent photo I've found of Test Bravo/.test(lastSeen?.reply ?? ""), lastSeen?.reply);

  // parsing, on its own
  section("   answer parsing");
  const P1 = ask.parseAnswer("me, Sarah and her husband Tom", 3);
  check("\"me, Sarah and her husband Tom\" → me / Sarah / Tom (Sarah's husband), in order", P1.people.map((p) => (p.me ? "ME" : p.name) + ":" + p.face).join(",") === "ME:0,Sarah:1,Tom:2" && P1.people[2].relation === "husband" && P1.people[2].relOf === "previous", P1);
  const P2 = ask.parseAnswer("Sarah's on the left and Tom is on the right", 2);
  check("\"Sarah's on the left and Tom is on the right\"", P2.people.map((p) => p.name + ":" + p.face).join(",") === "Sarah:0,Tom:1", P2);
  const P3 = ask.parseAnswer("Mike in the middle, Sarah on the left, and Tom on the right at the lake", 3);
  check("positions in any order, and what was going on", P3.people.map((p) => p.name + ":" + p.face).join(",") === "Mike:1,Sarah:0,Tom:2" && P3.activity === "at the lake", P3);
  const P4 = ask.parseAnswer("that's my cousin Sarah at her wedding", 1);
  check("\"that's my cousin Sarah at her wedding\"", P4.people[0].name === "Sarah" && P4.people[0].relation === "cousin" && P4.people[0].relOf === "owner" && P4.activity === "at her wedding", P4);
  const P5 = ask.parseAnswer("From left to right: Tom, Sarah, Mike. We were camping.", 3);
  check("\"from left to right\" lists, and a second sentence", P5.people.map((p) => p.name + ":" + p.face).join(",") === "Tom:0,Sarah:1,Mike:2" && P5.activity === "We were camping", P5);
  check("\"this is Dad with his dog\": the dog isn't a person", ask.parseAnswer("this is Dad with his dog on vacation", 1).people.length === 1);
  check("\"skip\" skips", ask.parseAnswer("skip", 2).skip === true);

  // ------------------------------------------------------------------ F. fixing mistakes
  section("F. merge, split, not a person, ignore, delete");
  // a made-up face group (fingerprints near Test Alpha's, but not sure): a suggestion, never silently labelled
  const base = por[0];
  let seed = 12345; const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);   // the same "random" every run
  const near = (sim) => { const r = Float32Array.from({ length: base.length }, () => rand() - 0.5); let d = 0; for (let i = 0; i < r.length; i++) d += r[i] * base[i]; for (let i = 0; i < r.length; i++) r[i] -= d * base[i]; let n = Math.hypot(...r); const out = Float32Array.from(base, (b, i) => sim * b + Math.sqrt(1 - sim * sim) * r[i] / n); return Buffer.from(out.buffer).toString("base64"); };
  await library.ingest("synthetic0001", { faces: [{ box: [0.4, 0.3, 0.2, 0.2], score: 0.9, emb: near(0.5) }] });
  const sf = (await library.facesIn("synthetic0001"))[0];
  check("an unsure match isn't labelled", !sf.personId && sf.suggest?.personId === alpha.id && sf.suggest.conf >= library.T.SUGGEST && sf.suggest.conf < library.T.AUTO, sf);
  const sugg = await library.suggestionsFor(alpha.id);
  check("…it's offered as \"Is this also Test Alpha?\" with a confidence", sugg.some((s) => s.cluster === sf.cluster && s.conf < library.T.AUTO), sugg);
  await library.ingest("synthetic0002", { faces: [{ box: [0.4, 0.3, 0.2, 0.2], score: 0.9, emb: near(0.9) }] });
  check("a sure match joins the named person by itself", (await library.facesIn("synthetic0002"))[0].personId === alpha.id);
  // split: the sure one was actually someone else
  const wrong = (await library.facesIn("synthetic0002"))[0];
  const sp = await people.splitFaces([wrong.id]);
  check("split: the face leaves Test Alpha", !(await library.facesIn("synthetic0002"))[0].personId && sp.faces === 1 && (await library.photosOf(alpha.id)).length === 2);
  const delta = (await people.nameFaces({ face: wrong.id, name: "Test Delta" })).person;
  check("…and can be named on its own", nameOf((await library.facesIn("synthetic0002"))[0].personId) === "Test Delta");
  // merge: Delta is really Alpha after all
  const merged = await people.merge(alpha.id, delta.id);
  check("merge: faces, names and notes move to the one kept", !people.find(delta.id) && (await library.photosOf(alpha.id)).length === 3 && merged.aliases.includes("Test Delta"), merged);
  // answering the suggestion with no
  await people.answerFaceSuggestion(sf.cluster, alpha.id, false);
  check("\"no\" to a suggestion: it isn't offered again", !(await library.suggestionsFor(alpha.id)).some((s) => s.cluster === sf.cluster));
  // not a person / ignore
  await people.notPerson(sf.id);
  const nf = await library.face(sf.id);
  check("\"not a person\": the fingerprint and thumbnail are dropped", nf.state === "notPerson" && !(await library.db()).faces[sf.id].emb && !(await library.thumbOf(sf.id)));
  await library.ingest("synthetic0003", { faces: [{ box: [0.1, 0.1, 0.2, 0.2], score: 0.9, emb: near(-0.2) }] });
  const ig = (await library.facesIn("synthetic0003"))[0];
  await people.ignoreFaces(ig.cluster);
  check("\"ignore this person\": never asked about", !(await library.photosWithUnnamed()).has("synthetic0003"));
  // rename
  people.rename(bravo.id, "Test Bravo Two");
  check("rename keeps the faces", nameOf((await library.facesIn(idOf("pd-portrait-middle.jpg")))[0].personId) === "Test Bravo Two");
  people.rename(bravo.id, "Test Bravo");

  // ------------------------------------------------------------------ I. texts and calls (before delete, so the cascade is tested)
  section("I. texts and calls");
  vsettings.set({ saveTexts: true, saveCalls: true });
  people.update(alpha.id, { phone: "555.010.2030" });
  const t1 = await comms.recordText({ who: "Test Alpha", text: "See you at the lake on Saturday! My husband Tomas is coming too." });
  check("on: a text from a known name goes to that person", t1?.personId === alpha.id && t1.source?.from === "phonelink" && t1.visibility === "private", t1);
  const t2 = await comms.recordText({ who: "+1 555 010 2030", text: "running late" });
  check("a phone number matches the person's number", t2?.personId === alpha.id, t2);
  await comms.recordOutgoing("Test Charlie", "Happy birthday!");
  check("texts Dayspring sends are saved as outgoing", (await comms.thread(charlie.id)).some((m) => m.dir === "out" && m.text === "Happy birthday!"));
  const t3 = await comms.recordText({ who: "Test B.", text: "call me" });
  check("an unsure sender isn't guessed", t3.personId === null);
  const q1 = await people.nextMatchQuestion();
  check("…it becomes a question: \"Is 'Test B.' the same person as Test Bravo?\"", q1 && /is "Test B\." in your texts the same person as Test Bravo\?/i.test(q1.text), q1);
  // the question goes out within the budget (a fresh day), and the answer moves the text
  const calls = [];
  ask.setDeps({ announce: (x) => calls.push(x), inCall: () => false });
  const tomorrow = new Date(noon.getTime() + 86400_000);
  const tq = await ask.tickPeople(store.todayISO(tomorrow), tomorrow);
  check("the match question is asked (as a person question)", tq && calls[0]?.kind === "person" && calls[0].text === q1.text, calls);
  const am = await skills.handle("yes", {});
  check("\"yes\" links the sender and their texts", /keep "Test B\." with Test Bravo/.test(am?.reply ?? "") && (await comms.thread(bravo.id)).some((m) => m.text === "call me"), am);
  const later = await comms.recordText({ who: "Test B.", text: "thanks!" });
  check("…and later texts from them too", later.personId === bravo.id);
  const sug = await comms.suggestions();
  check("names mentioned in texts are only suggestions", sug.some((s) => s.name === "Tomas" && s.relation === "husband" && s.relatedTo === alpha.id && s.status === "new") && !people.find("Tomas"), sug);
  const lc = await comms.logCall({ who: ["Test Charlie"], app: "discord", start: Date.now() - 600_000, end: Date.now() });
  check("calls are logged with app and duration", lc[0].personId === charlie.id && lc[0].app === "discord" && lc[0].durationSec >= 599, lc);
  vsettings.set({ keepDays: 30 });
  const old = await comms.recordText({ who: "Test Alpha", text: "an old one", at: Date.now() - 40 * 86400_000 });
  check("keep-for: old messages are trimmed", old && (await comms.prune()).removed === 1 && !(await comms.thread(alpha.id)).some((m) => m.text === "an old one"));
  vsettings.set({ keepDays: 0 });

  // ------------------------------------------------------------------ J. link-ups
  section("J. the profile's link-ups");
  goals.add({ text: "Call Test Alpha every week", area: "relationships" });
  goals.add({ text: "Read more books" });
  const yday = store.addDays(today, -1), tmr = store.addDays(today, 1);
  store.addBlock({ date: yday, start: "10:00", end: "11:00", title: "Coffee with Test Alpha", category: "flex" });
  store.addBlock({ date: tmr, start: "12:00", end: "13:00", title: "Lunch with Test Alpha", category: "meal" });
  const prof = await people.profile(alpha.id);
  check("prayer: open and answered requests about them", prof.prayer.filter((x) => !x.answered).length === 2 && prof.prayer.some((x) => x.answered && /New job/.test(x.title)) && !prof.prayer.some((x) => /Unrelated/.test(x.title)), prof.prayer);
  check("prayer: a private request shows its title only", prof.prayer.some((x) => x.private && x.title === "Something private" && x.detail === null));
  check("…until the owner opens it", (await people.profile(alpha.id, { openPrivate: true })).prayer.some((x) => x.private && x.detail === "secret detail"));
  check("goals: the relationship goal, not the others", prof.goals.length === 1 && /Call Test Alpha/.test(prof.goals[0].text), prof.goals);
  check("events: last time together and next planned", prof.events.lastTogether?.title === "Coffee with Test Alpha" && prof.events.nextPlanned?.title === "Lunch with Test Alpha", prof.events);
  check("messages on the profile", prof.messages.length >= 2 && prof.lastContact);
  check("photos on the profile: count and dates", prof.faces.photos === 3);
  check("every record has an id, a source and private visibility", [...prof.prayer, ...prof.goals, ...prof.messages, ...prof.notes].every((r) => r.id && r.source && r.visibility === "private"), [...prof.prayer, ...prof.goals, ...prof.messages, ...prof.notes].find((r) => !(r.id && r.source && r.visibility)));
  const tell = await skills.handle("tell me about Test Alpha", {});
  check("\"tell me about …\"", /Test Alpha is your cousin/.test(tell?.reply ?? "") && /surgery/.test(tell.reply) && /Something private \(private\)/.test(tell.reply) && !/secret detail/.test(tell.reply) && /Lunch with Test Alpha/.test(tell.reply), tell?.reply);
  const talked = await skills.handle("when did I last talk to Test Alpha?", {});
  check("\"when did I last talk to …\"", /The last time was/.test(talked?.reply ?? "") && /Coffee with Test Alpha/.test(talked.reply), talked?.reply);
  const lately = await skills.handle("what's going on with Test Alpha lately?", {});
  check("\"what's going on with … lately?\"", /text/.test(lately?.reply ?? "") && /surgery/.test(lately.reply) && /Lunch with Test Alpha/.test(lately.reply), lately?.reply);
  const rem = await skills.handle("remind me to check on Test Charlie", {});
  const reminders = await lib("reminders.mjs");
  check("\"remind me to check on …\" makes a reminder", /remind you tomorrow at 10 to check on Test Charlie/.test(rem?.reply ?? "") && reminders.forDay(tmr).some((r) => r.text === "Check on Test Charlie"), rem?.reply);

  // ------------------------------------------------------------------ G. encryption at rest
  section("G. encryption at rest");
  await library.flush(); await comms.flush();
  const fb = readFileSync(join(PEOPLE_DIR, "faces.bin")), cb = readFileSync(join(PEOPLE_DIR, "comms.bin"));
  const anEmb = Object.values((await library.db()).faces).find((f) => f.emb).emb;
  check("faces.bin is DPAPI-encrypted (no fingerprints, no JSON)", fb.subarray(0, 4).toString() === "DSP1" && !fb.includes(Buffer.from(anEmb.slice(0, 24))) && !fb.includes(Buffer.from('"faces"')));
  check("comms.bin is encrypted (no message words)", cb.subarray(0, 4).toString() === "DSP1" && !cb.includes(Buffer.from("lake on Saturday")) && !cb.includes(Buffer.from("Happy birthday")));
  const back = await secure.readSecure(join(PEOPLE_DIR, "comms.bin"));
  check("…and reads back for this Windows user", back.texts.some((t) => /lake on Saturday/.test(t.text)));
  const peopleJson = readFileSync(join(APP, "data", "people.json"), "utf8");
  check("people.json holds no fingerprints or messages", !peopleJson.includes(anEmb.slice(0, 24)) && !peopleJson.includes("lake on Saturday"));

  // ------------------------------------------------------------------ F2. delete a person
  section("F2. delete a person");
  const beforeFaces = Object.values((await library.db()).faces).filter((f) => f.personId === charlie.id).length;
  const thumbsBefore = Object.keys((await library.db()).thumbs).length;
  const del = await people.remove(charlie.id);
  check("delete: profile, faces and messages go", del.faces === beforeFaces && beforeFaces === 2 && del.messages >= 2 && !people.find(charlie.id), del);
  check("…fingerprints and thumbnails are gone from the store", !Object.values((await library.db()).faces).some((f) => f.personId === charlie.id) && Object.keys((await library.db()).thumbs).length < thumbsBefore);
  check("…their texts and calls are gone", (await comms.thread(charlie.id)).length === 0 && (await comms.calls(charlie.id)).length === 0);
  check("…and links to them are removed", !(people.find(bravo.id).links ?? []).some((l) => l.personId === charlie.id));
  const actDir = process.env.DAYSPRING_ACTIVITY_DIR;
  const act = existsSync(actDir) ? readdirSync(actDir).map((f) => readFileSync(join(actDir, f), "utf8")).join("") : "";
  check("face-profile changes are in the activity log, without names", /"kind":"people"/.test(act) && /"action":"deleted"/.test(act) && !/Test Charlie/.test(act), act.slice(0, 200));

  // ------------------------------------------------------------------ H. cadence
  section("H. question cadence");
  const d2 = new Date(noon.getTime() + 2 * 86400_000); d2.setHours(14, 0, 0, 0);
  const day2 = store.todayISO(d2);
  check("fresh day, relaxed: ok", ask.canAskNow(day2, d2).ok, ask.canAskNow(day2, d2));
  vsettings.countAsk(day2, d2.getTime());
  check("budget: once a day by default", ask.canAskNow(day2, d2).why === "budget");
  vsettings.set({ askPerDay: 2 });
  check("twice a day: not within 3 hours of the last one", ask.canAskNow(day2, new Date(d2.getTime() + 3600_000)).why === "spacing");
  check("twice a day: fine later on", ask.canAskNow(day2, new Date(d2.getTime() + 4 * 3600_000)).ok);
  vsettings.countAsk(day2, d2.getTime() + 4 * 3600_000);
  check("twice a day: not a third time", ask.canAskNow(day2, new Date(d2.getTime() + 6.5 * 3600_000)).why === "budget");
  const d3 = new Date(d2.getTime() + 86400_000), day3 = store.todayISO(d3);
  check("not at night", ask.canAskNow(day3, new Date(new Date(d3).setHours(22, 30))).why === "hour");
  settings.set({ listenState: "quiet" });
  check("never in Quiet", ask.canAskNow(day3, d3).why === "quiet-or-off");
  settings.set({ listenState: "off" });
  check("never when Off (not listening)", ask.canAskNow(day3, d3).why === "quiet-or-off");
  settings.set({ listenState: "active" });
  store.addBlock({ date: day3, start: "13:30", end: "14:30", title: "Team meeting", category: "flex" });
  check("never during a meeting on the schedule", ask.canAskNow(day3, d3).why === "busy");
  const d4 = new Date(d3.getTime() + 86400_000), day4 = store.todayISO(d4);
  ask.setDeps({ inCall: () => true });
  check("never during a call", ask.canAskNow(day4, d4).why === "call");
  ask.setDeps({ inCall: () => false });
  check("the TV's own \"What's this one?\" still works with faces off", (vsettings.set({ faces: false }), (await ask.plan({ date: day4, want: true, now: d4 })).who === false));
  vsettings.set({ faces: true });

  // ------------------------------------------------------------------ K. web pictures
  section("K. pictures from the web are never identified");
  const facesBefore = Object.keys((await library.db()).faces).length, photosBefore = Object.keys((await library.db()).photos).length;
  const web = await describe.describeWebImage({ buffer: readFileSync(byName["pd-group-three.jpg"].path), title: "test" });
  check("described: faces counted", web.source === "web" && web.faces.count === 3, web.faces);
  check("…but nobody named (even people the owner named)", web.faces.names.length === 0 && web.faces.positions.every((p) => !p.name) && !/Test Alpha|Test Bravo/.test(web.text), web.text);
  check("…and the face index isn't touched", Object.keys((await library.db()).faces).length === facesBefore && Object.keys((await library.db()).photos).length === photosBefore);
  const outside = join(TMP, "outside-copy.jpg"); copyFileSync(byName["pd-group-three.jpg"].path, outside);
  const loc = await describe.describeImage(outside, { ai: false });
  check("a file outside the owner's photo folders isn't identified either", loc.source === "local" && loc.faces.names.length === 0, loc.source);
  describe.setOnScreen({ kind: "web", url: pathToFileURL(outside).href, buffer: readFileSync(outside), title: "x" });
  const whoWeb = await skills.handle("who is in this picture?", { photo: idOf("pd-group-three.jpg") });
  check("\"who is in this picture?\" on a web picture: describes, doesn't identify", /don't identify people in pictures from the web/.test(whoWeb.reply) && !/Test Alpha/.test(whoWeb.reply), whoWeb.reply);
  describe.setOnScreen(null);
  check("describe_image tool on a web picture says identification isn't allowed", (describe.setOnScreen({ kind: "web", buffer: readFileSync(outside) }), (await skills.runTool("describe_image", { target: "screen" })).identification === "not allowed for web pictures"));
  describe.setOnScreen(null);

  // ------------------------------------------------------------------ L. voice + the server
  section("L. voice commands and the server");
  const rd = await skills.handle("what does this say?", { photo: null });
  check("\"what does this say?\" with nothing on screen says so", /isn't a picture on the screen/.test(rd.reply));
  const del2 = await skills.handle("delete Test Bravo from my people", {});
  check("deleting a person by voice asks first", /Say yes to delete/.test(del2.reply) && people.find(bravo.id));
  const no = await skills.handle("no", {});
  check("…\"no\" keeps them", /kept them/.test(no.reply) && people.find(bravo.id));
  const tn = await (await lib("vision/skills.mjs")).TOOLS.map((t) => t.name);
  check("AI tools have unique names", new Set(tn).size === tn.length);
  await comms.deleteAll();
  check("\"Delete all saved messages\"", !existsSync(join(PEOPLE_DIR, "comms.bin")) && (await comms.counts()).texts === 0);
  await library.flush();
  faces.stopWorker(); helper.stop();

  // the server, briefly: routes and defaults on a fresh data folder
  const PORT = await qaPort(4793), BASE = `http://127.0.0.1:${PORT}`;
  rmSync(join(APP, "data", "vision.json"), { force: true });
  const srv = spawn(process.execPath, ["server.mjs"], { cwd: APP, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  const up = async () => { try { return (await fetch(`${BASE}/api/vision/settings`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  for (let i = 0; i < 80 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  try {
    const s = await (await fetch(`${BASE}/api/vision/settings`)).json();
    check("server: Settings → Photos & people starts off", s.settings && s.settings.faces === false && s.settings.saveTexts === false && s.settings.aiDescribe === false, s.settings ?? log.slice(-400));
    const n = await (await fetch(`${BASE}/api/photos/next?ask=1`)).json();
    check("server: /photos/next answers with the question fields", "photo" in n && "ask" in n && "question" in n && "askKind" in n, n);
    const pl = await (await fetch(`${BASE}/api/people`)).json();
    check("server: the People list", Array.isArray(pl.people) && pl.people.some((p) => p.name === "Test Alpha"), pl);
    const page = await (await fetch(`${BASE}/people.html`)).text();
    check("server: the People page is served", /<title>Dayspring People<\/title>/.test(page));
    const chat = await (await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "tell me about Test Alpha", surface: "tv", typed: true }) })).json();
    check("server: \"tell me about …\" through the chat, no AI", /Test Alpha is your cousin/.test(chat.reply ?? ""), chat.reply ?? chat);
  } finally { srv.kill(); await new Promise((r) => setTimeout(r, 800)); }
} catch (e) {
  fail++; console.log(`FAIL  crashed: ${e.stack}`);
} finally {
  try { faces.stopWorker(); helper.stop(); } catch { /* fine */ }
}
console.log(`\n${pass} passed, ${fail} failed`);
setTimeout(() => process.exit(fail ? 1 : 0), 500);
