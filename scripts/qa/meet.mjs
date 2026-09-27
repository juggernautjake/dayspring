// Meetings, end to end, on the stand-in Meet page (ecosystem-core/lib/meet/mock) in a headless Chrome: nothing real is
// joined, no device is touched, no real AI or voice is used (answers come from the lessons' own key points, or a
// pretend AI), and the meeting window never appears on screen.
//   • joining, the corner tile and back (the route), the hello in the chat
//   • captions → an addressed question → permissions → a spoken answer (the voice events) and a chat answer
//   • someone not allowed is ignored; the owner's commands; "only <owner> can do that" for everyone else
//   • chat questions (@Dayspring, @Lantern); Lantern answering (its API, and without it); the hand-off Dayspring → Lantern
//   • course answers cite retrieved lessons and link to them; one voice at a time; the assistants' own voice isn't a question
//   • names: the first answer, the frequency cap, two people with one first name, "Unknown", personality styling,
//     never in both the voice and the chat; the meeting's memory is gone when it ends
//   • Tune in stands down while the meeting reads captions (no double answers)
//   • the selector fallbacks (a Meet page with no class names at all)
//   • who is in the call and who is talking: the People list, tiles, notices, the count, a presenter, Meet in French,
//     names read off a picture of the window (Windows' own text recognition), a guest who calls themselves "You"
//   • meeting notes: the heads-up (chat and voice) before anything is written, the "● Notes" sign, the transcript with
//     who said what, "don't record this part", "what did Rich say about…", "summarize so far", only the owner controls
//     them, and the saved meetings through the routes (list, read, draft, delete)
//   • the review fixes: nothing is said or kept after leaving, two joins share one browser, Tune in switched on by the
//     meeting is switched off with it, the window closes when the call ends in it, typed text survives panel updates
//   node scripts/qa/meet.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TMP = mkdtempSync(join(tmpdir(), "ds-meet-"));
process.env.DAYSPRING_MEET_FILE = join(TMP, "meet.json");
process.env.DAYSPRING_MEET_PROFILE = join(TMP, "profile");
process.env.DAYSPRING_MEET_HEADLESS = "1";
process.env.DAYSPRING_MEET_NO_WINDOW = "1";
process.env.AI_PROVIDER = "none";
process.env.TTS_PROVIDER = "browser";
process.env.DS_CALLS_FILE = join(TMP, "calls.json");
process.env.DAYSPRING_MEETINGS_DIR = join(TMP, "meetings");      // meeting notes (never the owner's data/meetings)
process.env.DAYSPRING_TEST_RECYCLE = join(TMP, "recycle");       // "deleted" notes land here, not in the Recycle Bin

let fail = 0;
const check = (name, ok, got = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + String(got).slice(0, 220) + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bus = await import("../../lib/bus.mjs");
const host = await import("../../lib/meet/host.mjs");
const routes = await import("../../lib/meet-routes.mjs");
const settings = await import("../../lib/meet/settings.mjs");
const courseAnswer = await import("../../lib/meet/course-answer.mjs");
const lanternAsk = await import("../../lib/meet/lantern-ask.mjs");
const tunein = await import("../../lib/tunein.mjs");
const owner = await import("../../lib/owner.mjs");
const OWNER = owner.name();

// a small server with the meeting routes (the rehearsal page is served from it, like Dayspring's own)
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (r, code, body) => { r.writeHead(code, { "content-type": "application/json" }); r.end(JSON.stringify(body)); };
  const readJSON = (r) => new Promise((ok) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });
  if (url.pathname.startsWith("/api/") && await routes.handle(req, res, { m: req.method, p: url.pathname.slice(4), q: url.searchParams, send, readJSON })) return;
  // the meeting panel on a bare page (public/meet.js with the shared parts), for the panel checks
  const files = { "/meet-ui-test": null, "/meet.js": join(DESK, "public", "meet.js"), "/eco/client/meet-tile.js": join(DESK, "vendor", "ecosystem-core", "client", "meet-tile.js") };
  if (url.pathname in files) {
    const body = url.pathname === "/meet-ui-test" ? `<!doctype html><meta charset="utf-8"><div class="talktools"></div><script>window.dsEvents = new EventTarget();</script><script src="/meet.js"></script>` : readFileSync(files[url.pathname]);
    res.writeHead(200, { "content-type": url.pathname.endsWith(".js") ? "text/javascript" : "text/html" }); return res.end(body);
  }
  res.writeHead(404); res.end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const PORT = server.address().port;
process.env.PORT = String(PORT);
const call = async (path, body) => { const r = await fetch(`http://localhost:${PORT}/api${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json(); };

// what Dayspring broadcasts: the voice (reply-part) and the meeting's events
const events = [];
bus.on((type, data) => events.push({ type, ...data, t: Date.now() }));
const since = (n) => events.slice(n);
const voiceOf = (evs, as = null) => evs.filter((e) => e.type === "tunein" && e.kind === "reply-part" && !e.final && (as === null || (e.as ?? "dayspring") === as)).map((e) => e.text).join(" ");

let persona = "default";
// Tune in is never really switched on here (no microphone): the meeting's calls to it are counted instead
const tuneinCalls = { on: false, start: 0, stop: 0 };
host.setDeps({ persona: async () => persona, lanternSpeaking: async () => false,
  tuneinOn: () => tuneinCalls.on, tuneinStart: async () => { tuneinCalls.start++; tuneinCalls.on = true; }, tuneinStop: async () => { tuneinCalls.stop++; tuneinCalls.on = false; } });
const realGeneral = async ({ text, who, onSentence, signal }) => { const p = await import("../../lib/calls/pipeline.mjs"); return p.reply({ text, who, via: "meet", surface: "call", onSentence, signal }); };
const pwChromium = createRequire(import.meta.url)("playwright-core").chromium;
let launches = 0;
host.setDeps({ chromium: () => { launches++; return pwChromium; } });
const waitFor = async (fn, ms = 6000) => { const until = Date.now() + ms; while (Date.now() < until) { if (await fn()) return true; await sleep(150); } return Boolean(await fn()); };
let lanternApi = null;       // null → Lantern has no /ask (404)
lanternAsk._setCall(async (path, opts) => {
  if (path === "/api/local/ask") return lanternApi ? { ok: true, status: 200, data: lanternApi(opts.body) } : { ok: false, status: 404 };
  return { ok: false, status: 0 };
});
courseAnswer.setDeps({ lanternCall: async () => ({ ok: false, status: 0 }) });   // no Lantern search: the local index

const course = courseAnswer.courseId();
const TEMPLATE = "https://example.test/course-artifact#{lesson}";
if (course) settings.set({ courses: { [course]: { publicLessonUrl: TEMPLATE } } });
console.log(`course for the course questions: ${course ?? "(none installed: course checks skipped)"}`);

const page = () => host._session()?.page;
const say = async (who, text) => { await page().evaluate(([w, t]) => window.__mock.say(w, t, { chunks: 3, ms: 120 }), [who, text]); };
const chat = async (who, text) => { await page().evaluate(([w, t]) => window.__mock.chat(w, t), [who, text]); };
const sent = async () => page().evaluate(() => window.__mock.sent.slice());
// wait for an answer (a "meet" answer event) after event index n
async function answered(n, { count = 1, ms = 12_000 } = {}) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const a = since(n).filter((e) => e.type === "meet" && e.kind === "answer"); if (a.length >= count) return a; await sleep(150); }
  return since(n).filter((e) => e.type === "meet" && e.kind === "answer");
}

try {
  console.log("\n— joining —");
  {
    const r = await host.join(`http://localhost:${PORT}/api/meet/mock?prejoin=1`, { isRehearsal: true });
    check("joins the rehearsal meeting (clicks Join now)", r.ok && host.status().stage === "in-call", r.reply);
    const st = host.status();
    check("captions switched on and detected", st.check.captions === true, JSON.stringify(st.check.used));
    check("the chat is ready", st.check.chat === true);
    await sleep(500);
    const s = await sent();
    check("says hello in the meeting chat (who can ask, how)", s.some((m) => /^Dayspring: Hi everyone! I'm Dayspring/.test(m) && /@Lantern/.test(m)), s[0]);
    check("tells everyone it's taking notes (in the chat), before anything is written down", s.some((m) => /^Dayspring: Heads up: Dayspring is taking notes in this meeting, for a summary\./.test(m)) && host._notes()._current()?.entries[0]?.kind === "mark" && host.status().notes.live === true, s.join(" | ").slice(0, 200));
    check("…and the meeting window shows “● Notes”", await page().evaluate(() => document.querySelector("[data-eco-rec]")?.textContent) === "Notes");
    check("the meeting went to the corner after joining", st.view === "tile");
    const big = await call("/meet/view", { view: "large" });
    const small = await call("/meet/view", { view: "tile" });
    check("the chip's route: tile → large → tile", big.view === "large" && small.view === "tile", `${big.view}, ${small.view}`);
    const cover = await page().evaluate(() => Boolean(document.querySelector("[data-eco-tile]")));
    check("the tile has its click-to-enlarge cover", cover);
    await page().evaluate(() => document.querySelector("[data-eco-tile]").click());
    await sleep(600);
    check("clicking the tile enlarges it", host.status().view === "large");
    check("Tune in stands down while the meeting reads captions", tunein.standingDown() === true);
    await page().evaluate(() => { for (const p of ["Rich Alvarez", "Jess Park", "Sam Lee"]) window.__mock.join(p); });
    await sleep(1200);
  }

  console.log("\n— who is in the call, who is talking —");
  {
    const ok = await waitFor(() => host.status().people.length === 3);
    const st = host.status();
    check("everyone in the call is known (the tiles and the People list, merged)", ok && ["Rich Alvarez", "Jess Park", "Sam Lee"].every((n) => st.people.some((p) => p.name === n)), st.people.map((p) => `${p.name}[${p.sources}]`).join(", "));
    check("…each once, and not the owner", st.people.length === 3 && !st.people.some((p) => /^you$/i.test(p.name)));
    check("…and the count on Meet's People button agrees", st.roster?.expected === 4 && st.roster?.agrees === true, JSON.stringify(st.roster && { count: st.roster.count, expected: st.roster.expected }));
    check("Meet's join notices are read", Boolean(st.roster?.sources?.toast), JSON.stringify(st.roster?.sources));
    const here = await host.command("who's in the call?");
    check("“who's in the call?”", /^In the meeting: Rich Alvarez, Jess Park and Sam Lee, and you\.$/.test(here), here);
    await page().evaluate(() => window.__mock.say("Jess Park", "so I think we should start", { chunks: 2, ms: 60 }));
    const talk = await host.command("who's talking?");
    check("“who's talking?” (the caption's speaker)", /^Jess Park is talking\.$/.test(talk), talk);
    const pf = await call("/meet/preflight");
    const pi = pf.items.find((i) => i.id === "people");
    check("the checklist's “People detected” line says how", pi?.ok === true && /the People list|the video tiles/.test(pi.detail), pi?.detail);
    const said = await host.command("is the meeting working?");
    check("“is the meeting working?” reports captions, chat and people", /Captions detected ✓, chat ready ✓, people detected ✓/.test(said), said);
    await page().evaluate(() => window.__mock.setCaptions(false));
    check("captions switched off by themselves are switched back on", await waitFor(() => page().evaluate(() => window.__mock.state.captions)));
    await sleep(2000);                                 // (the lines above settle: they aren't questions)
  }

  console.log("\n— who may ask —");
  {
    let n = events.length;
    await say("Rich Alvarez", "Dayspring, what time is it?");
    await sleep(2600);
    check("someone not allowed is ignored (only the owner, at first)", !since(n).some((e) => e.type === "meet" && e.kind === "answer") && since(n).some((e) => e.type === "meet" && e.kind === "denied"));
    check("…and what they said isn't passed on", !JSON.stringify(since(n).filter((e) => e.kind === "denied")).includes("time is it"));
    n = events.length;
    await say("You", "Dayspring, let Rich and Jess ask.");
    const a = await answered(n);
    check("the owner: “let Rich and Jess ask”", /Rich and Jess can ask/.test(a[0]?.spoken ?? ""), a[0]?.spoken);
    const st = host.status();
    const can = (name, as) => st.people.find((p) => p.name === name)?.can?.[as];
    check("the people panel shows it", can("Rich Alvarez", "dayspring") && can("Jess Park", "lantern") && !can("Sam Lee", "dayspring"));
    const off = await call("/meet/permissions", { name: "Jess Park", can: { lantern: false } });
    check("a per-person toggle (Jess can't ask Lantern)", off.people.find((p) => p.name === "Jess Park")?.can?.lantern === false && off.people.find((p) => p.name === "Jess Park")?.can?.dayspring === true);
    await call("/meet/permissions", { name: "Jess Park", can: { lantern: true } });
  }

  console.log("\n— a course question, answered by Lantern —");
  let richFirst = null;
  if (course) {
    const n = events.length;
    const before = (await sent()).length;
    await say("Rich Alvarez", "Lantern, how do I protect a query from SQL injection?");
    const a = await answered(n, { ms: 15_000 });
    richFirst = a[0];
    const e = since(n);
    const spoken = voiceOf(e, "lantern");
    check("Lantern answers out loud, in Lantern's voice", spoken.length > 20 && voiceOf(e, "dayspring") === "", spoken);
    check("…using Rich's name, Lantern's way (first answer to Rich)", /^Ah, Rich, a fine question\./.test(spoken), spoken.slice(0, 60));
    const cite = a[0]?.citations?.[0];
    check("cites a lesson it retrieved", Boolean(cite?.lessonId) && /^Unit \d+, Lesson \d+$/.test(cite.label), cite ? `${cite.label}: ${cite.title}` : "none");
    check("says where it's covered and that the link is in the chat", /It's covered in Unit \d+, Lesson \d+, .+, and I've put the link in the chat\./.test(spoken));
    await sleep(600);
    const posted = (await sent()).slice(before);
    const all = posted.join("\n");
    check("posts the detail in the chat as “Lantern: …”", posted.length >= 1 && /^Lantern(?: \(\d+\/\d+\))?: /.test(posted[0]), posted[0]?.slice(0, 80));
    check("…with the link to that exact lesson", all.includes(TEMPLATE.replace("{lesson}", cite?.lessonId ?? "?")), all.slice(-160));
    check("the name is used once: in the voice, not also in the chat", !/\bRich\b/.test(all));
    check("the answer is shown with the lantern (name card: “Lantern — answering Rich”)", e.some((x) => x.type === "meet" && x.kind === "answering" && x.as === "lantern" && /Lantern — answering Rich/.test(x.text)));
    const parts = e.filter((x) => x.type === "tunein" && x.kind === "reply-part");
    check("one voice: every part of the answer is one turn", new Set(parts.map((p) => p.id)).size === 1);
  }

  console.log("\n— the chat —");
  {
    const n = events.length, before = (await sent()).length;
    await chat("Jess Park", "@Dayspring what's 2 plus 2?");
    const a = await answered(n);
    await sleep(400);
    const posted = (await sent()).slice(before);
    check("@Dayspring in the chat gets a chat answer", posted.some((m) => /^Dayspring: .*\b4\b/.test(m)), posted.join(" | "));
    check("…naming Jess in the chat (her first answer), and nothing said out loud", posted.some((m) => /^Dayspring: Good question, Jess — /.test(m)) && voiceOf(since(n)) === "", posted[0]);
    check("the assistants never answer their own chat messages", (await answered(events.length, { ms: 1500 })).length === 0);
  }

  console.log("\n— owner-only commands —");
  {
    const n = events.length;
    await say("Rich Alvarez", "Dayspring, mute the meeting.");
    const a = await answered(n);
    const sp = a[0]?.spoken ?? "";
    check("a participant can't run the owner's commands", new RegExp(`only ${OWNER} can ask me to do that`, "i").test(sp), sp);
    check("…and Rich isn't named again so soon (2-minute cap)", !/\bRich\b/.test(sp));
    const m0 = await page().evaluate(() => window.__mock.state.mic);
    check("…and the mic wasn't touched", m0 === true);
    // (the owner's own captions are ignored while Dayspring's voice is still going out: it's captioned as the owner too)
    while (host.status().speaking) await sleep(200);
    const n2 = events.length;
    await say("You", "Dayspring, mute.");
    await answered(n2);
    check("the owner can (“Dayspring, mute”)", await page().evaluate(() => window.__mock.state.mic) === false);
    await host.command("unmute");
  }

  console.log("\n— the hand-off, echoes, and one voice at a time —");
  if (course) {
    host.setDemo(true);
    check("Demo mode: everyone can ask, course questions go to Lantern", host.status().mode === "everyone" && host.status().routeCourseToLantern === true);
    const n = events.length;
    await say("Sam Lee", "Dayspring, what's the difference between an inner join and a left join?");
    const a = await answered(n, { ms: 15_000 });
    const e = since(n);
    const hand = voiceOf(e, "dayspring");
    check("Dayspring hands it to Lantern, naming Sam (his first answer)", /^Great question, Sam\. Lantern, want to take that one\?$/.test(hand), hand);
    const lan = voiceOf(e, "lantern");
    check("…and Lantern answers, without naming Sam again", lan.length > 20 && !/\bSam\b/.test(lan), lan.slice(0, 80));
    const turns = e.filter((x) => x.type === "tunein" && x.kind === "reply-part");
    const firstLantern = turns.findIndex((x) => x.as === "lantern");
    const dsFinal = turns.findIndex((x) => !x.as && x.final);
    check("one voice at a time: Dayspring's turn ends before Lantern's starts", dsFinal >= 0 && firstLantern > dsFinal);
    check("Lantern's answer is on the results card with its lessons", a.at(-1)?.as === "lantern" && a.at(-1)?.citations?.length >= 1);
    // Dayspring's own words come back as the owner's captions (its voice goes into the call through the owner's mic)
    const n2 = events.length;
    await say("You", "Great question, Sam. Lantern, want to take that one?");
    await sleep(2600);
    check("the assistants' own voice (captioned as the owner) isn't taken as a question", !since(n2).some((x) => x.type === "meet" && (x.kind === "asked" || x.kind === "answer")));
  }

  console.log("\n— names —");
  {
    // two people called Jess: the full name
    await page().evaluate(() => window.__mock.join("Jess Moreno"));
    await sleep(1500);
    persona = "cowboy";
    const n = events.length;
    await say("Jess Moreno", "Dayspring, what's 3 times 4?");
    const a = await answered(n);
    const sp = voiceOf(since(n));
    check("two people named Jess: the full name, in the personality's style", /^Well howdy, Jess Moreno!/.test(sp), sp);
    check("…the name exactly as shown", sp.includes("Jess Moreno") && !/jess moreno|JESS/.test(sp));
    persona = "default";
    const n2 = events.length;
    await host.setPermission({ mode: "everyone" });
    await say("Unknown", "Dayspring, what's 5 plus 5?");
    const b = await answered(n2);
    const sp2 = voiceOf(since(n2));
    check("an unknown speaker: answered, but no name guessed", /10/.test(sp2) && !/Unknown|question,/.test(sp2), sp2);
  }

  console.log("\n— Lantern's own API —");
  if (course) {
    lanternApi = (body) => ({ answer: `From Lantern itself: parameterize with cfqueryparam. (asked by ${body.askerName})`, short: "Use cfqueryparam for every value in a query.",
      citations: [{ course: body.course, lessonId: "api-lesson", title: "A lesson Lantern chose", unit: 4, lesson: 2, localUrl: "lantern://x", publicUrl: "https://example.test/from-lantern#api-lesson" }], persona: "lantern" });
    lanternAsk._reset();                                  // (a 404 earlier is remembered for a minute)
    const n = events.length, before = (await sent()).length;
    await say("Rich Alvarez", "Lantern, how do I protect a query from SQL injection?");
    const a = await answered(n, { ms: 15_000 });
    const posted = (await sent()).slice(before).join("\n");
    check("Lantern's own /ask answer is used when Lantern offers it", a[0]?.lanternApi === true && /From Lantern itself/.test(posted) && /from-lantern#api-lesson/.test(posted), posted.slice(0, 120));
    check("…with its lesson named out loud", /Unit 4, Lesson 2, A lesson Lantern chose/.test(voiceOf(since(n), "lantern")));
    lanternApi = null; lanternAsk._reset();
  }

  console.log("\n— an AI answer (pretend AI): citations limited to retrieved lessons —");
  if (course) {
    const { hits } = await courseAnswer.retrieve("how do I read a text file from disk?", { course });
    let spokenEarly = null;
    courseAnswer.setDeps({ aiReady: () => true, fastModel: async () => "pretend", stream: async function* () {
      yield "SPOKEN: Use FileRead with the file's full path; it returns the whole file as text.\n";
      yield `CITE: not-a-lesson, ${hits[0].id}\n`;
      yield "DETAIL: FileRead(path) reads the file into a string. Check FileExists first.";
    } });
    const a = await courseAnswer.answer({ question: "how do I read a text file from disk?", course, hits, onSpoken: (t) => { spokenEarly = t; } });
    check("the spoken part is ready before the detail is finished", /FileRead/.test(spokenEarly ?? ""));
    check("a lesson the AI made up is dropped; the real one is kept", a.citations.length === 1 && a.citations[0].lessonId === hits[0].id);
    check("the link is the course's public link to that lesson", a.citations[0].publicUrl === TEMPLATE.replace("{lesson}", hits[0].id));
    courseAnswer.setDeps({ aiReady: () => false });
  }

  console.log("\n— no double answers with Tune in —");
  {
    let transcribed = 0;
    tunein._setTranscribe(async () => { transcribed++; return { text: "Dayspring what time is it", ms: 1 }; });
    const vad = await import("../../lib/calls/vad.mjs");
    tunein._testFeed(vad.synthSilence(400)); tunein._testFeed(vad.synthSpeech(1200)); for (let i = 0; i < 60; i++) tunein._testFeed(vad.synthSilence(20));
    await sleep(800);
    check("while the meeting answers, Tune in doesn't even transcribe", transcribed === 0, `${transcribed} transcriptions`);
    tunein._setTranscribe(null);
  }

  console.log("\n— the meeting ends —");
  {
    check("this meeting's answers are kept while it runs", host.recent().length >= 3);
    // captions that can't be read at all: Tune in listens instead (switched on by the meeting, so off with it)
    await page().evaluate(() => { document.querySelector("[role=region]")?.remove(); document.querySelector("#ccb")?.remove(); });
    await host._captionsLost();
    check("captions unreadable: Tune in listens instead", tuneinCalls.start === 1 && host.status().fallbackTunein === true);
    // an answer still being written when the meeting ends
    let release; const gate = new Promise((r) => { release = r; });
    host.setDeps({ generalReply: async ({ onSentence }) => { await gate; onSentence?.("A late answer."); return { reply: "A late answer." }; } });
    const n = events.length;
    await chat("You", "@Dayspring tell me something interesting");
    await waitFor(() => since(n).some((e) => e.type === "meet" && e.kind === "asked"));
    const r = await call("/meet/leave", {});
    release(); await sleep(600);
    host.setDeps({ generalReply: realGeneral });
    check("leaving", r.ok && ["left", "closed"].includes(host.status().stage));
    check("an answer still being written when it ends: nothing of it is said, posted or kept", host.recent().length === 0 && !since(n).some((e) => (e.type === "meet" && e.kind === "answer") || (e.type === "tunein" && /late answer/i.test(e.text ?? e.full ?? ""))));
    check("the meeting's memory is gone (answers, people, who could ask)", host.recent().length === 0 && host.status().people.length === 0 && host._people().people().length === 0 && host._people().status().expected === null);
    check("Tune in is back on duty", tunein.standingDown() === false);
    check("…and the Tune in the meeting switched on is switched off again", tuneinCalls.stop === 1 && tuneinCalls.on === false && host.status().fallbackTunein === false);
  }

  console.log("\n— the meeting's notes —");
  {
    const nm = host._notes();
    const saved = nm.list();
    check("the notes were saved when the meeting ended", saved.length === 1 && saved[0].title === "Rehearsal", JSON.stringify(saved.map((m) => m.title)));
    await waitFor(() => nm.read(saved[0].id)?.meta.summary !== "writing");
    const r = nm.read(saved[0].id);
    const lines = r.transcript.split("\n").filter((l) => /^\[/.test(l));
    check("the transcript starts when everyone had been told", /— Notes started \(everyone in the meeting was told\) —/.test(lines[0]), lines[0]);
    check("…who came", /→ Rich Alvarez joined/.test(r.transcript) && /→ Jess Park joined/.test(r.transcript));
    check("…what they said, by name (from the captions)", /\] Rich Alvarez: Dayspring, what time is it\?/.test(r.transcript), lines.slice(1, 6).join(" / "));
    check("…the chat", /\(chat\) Jess Park: @Dayspring what's 2 plus 2\?/.test(r.transcript) && /Jess Park: @Dayspring what's 2 plus 2/.test(r.chat));
    if (course) check("…Lantern's answer with its lesson link", /Lantern \(answering Rich Alvarez\): .*\[Unit \d+, Lesson \d+: .+ https:\/\/example\.test\/course-artifact#/.test(r.transcript));
    check("…nothing from the answer still being written when it ended", !/late answer|something interesting/i.test(r.transcript.split("\n").slice(-4).join("\n")) || !/A late answer/.test(r.transcript));
    check("…and Dayspring's own voice isn't written down as the owner talking", !/\] [^:]+: Great question, Sam\. Lantern, want to take that one\?/.test(r.transcript.replace(/Dayspring[^:]*: Great question/g, "")));
    check("the summary (no AI here): who was there, and what was asked of Dayspring and Lantern", /## Who was there/.test(r.summary) && /\| Rich Alvarez \|/.test(r.summary) && /## Asked of Dayspring and Lantern/.test(r.summary), r.summary.slice(0, 200));
    check("meta.json: who, when, how long", r.meta.people.some((p) => p.name === "Jess Park" && p.joinedAt) && r.meta.minutes >= 1 && r.meta.rehearsal === true && r.meta.link === null);
  }

  console.log("\n— meeting notes: said out loud first, off the record, what Rich said, so far, only the owner —");
  {
    // a pretend Dayspring screen, so the heads-up is said out loud into the call too
    const bus2 = await import("../../lib/bus.mjs");
    const { EventEmitter } = await import("node:events");
    const screen = Object.assign(new EventEmitter(), { writeHead() {}, write() { return true; } });
    bus2.addClient(screen, { page: "display", id: "qa-screen" });
    const n0 = events.length;
    await host.join(`http://localhost:${PORT}/api/meet/mock?prejoin=0`, { isRehearsal: true });
    const heads = since(n0).filter((e) => e.type === "tunein" && e.kind === "reply-part" && /Heads up: I'm taking notes/.test(e.text ?? ""));
    const first = host._notes()._current()?.entries[0];
    check("with the Dayspring screen open, the heads-up is also said out loud, before the notes start", heads.length === 1 && first && Date.parse(first.at) >= heads[0].t - 5, `${heads.length} spoken`);
    await host.setPermission({ mode: "everyone" });
    await page().evaluate(() => window.__mock.join("Rich Alvarez"));
    await waitFor(() => host.status().people.length === 1);
    while (host.status().speaking) await sleep(200);
    await say("Rich Alvarez", "The launch budget is five thousand dollars for the spring.");
    await sleep(1600);
    let n = events.length;
    await say("You", "Dayspring, don't record this part.");
    const off = await answered(n);
    check("“don't record this part”: the notes pause, and the sign says so (the heads-up in the chat quoted it: chat isn't Dayspring's voice, so it's no echo)", host.status().notes.paused === "private" && await page().evaluate(() => document.querySelector("[data-eco-rec]")?.textContent) === "Notes paused", `${off[0]?.question} → ${off[0]?.spoken}`);
    while (host.status().speaking) await sleep(200);
    await say("Rich Alvarez", "My password is hunter two, keep that between us.");
    await sleep(1600);
    n = events.length;
    await say("You", "Dayspring, you can record again.");
    await answered(n);
    check("“you can record again”", host.status().notes.live === true && !host.status().notes.paused);
    while (host.status().speaking) await sleep(200);
    await say("Rich Alvarez", "Okay, back to the plan for the launch.");
    await sleep(1600);
    const w = await host.command("what did Rich say about the budget?");
    check("“what did Rich say about the budget?”", /Rich Alvarez said “The launch budget is five thousand dollars for the spring\.”/.test(w), w);
    const so = await host.command("summarize the meeting so far");
    check("“summarize so far”", /so far, \d+ things said/.test(so), so);
    n = events.length;
    await say("Rich Alvarez", "Dayspring, pause the notes please.");
    const a = await answered(n);
    check("a participant can't pause the notes (or ask what someone said)", new RegExp(`only ${OWNER} can ask me to do that`, "i").test(a[0]?.spoken ?? "") && host.status().notes.live && !host.status().notes.paused, a[0]?.spoken);
    const before = (await sent()).length;
    const st = await call("/meet/notes/live", { action: "stop" });
    await sleep(300);
    check("stopping the notes (the panel's button): the meeting is told, the sign goes", /stopped taking notes/.test(st.reply) && (await sent()).slice(before).some((m) => /^Dayspring: Dayspring has stopped taking notes\./.test(m)) && await page().evaluate(() => !document.querySelector("[data-eco-rec]")));
    await host.leave();
    screen.emit("close");
    const list = await call("/meet/notes");
    const mine = list.meetings[0];
    await waitFor(async () => (await call(`/meet/notes/${mine.id}`)).meta.summary !== "writing");
    const r = await call(`/meet/notes/${mine.id}`);
    check("saved: the budget is in it, the part off the record isn't (a gap is marked)", /five thousand dollars/.test(r.transcript) && !/hunter/i.test(r.transcript + r.summary) && /Not recorded from .+ \(asked not to\)/.test(r.transcript));
    check("…nor the request to go off the record", !/don't record this part/i.test(r.transcript));
    const d = await call(`/meet/notes/${mine.id}/draft`, {});
    check("“email the summary” is a draft only (mailto, nobody in it)", /^mailto:\?subject=/.test(d.mailto ?? ""));
    const rc = await call(`/meet/notes/${mine.id}/recap`, {});
    check("a spoken recap of it", /^Rehearsal: /.test(rc.text ?? ""), rc.text);
    const no = await fetch(`http://localhost:${PORT}/api/meet/notes/${mine.id}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    check("deleting needs a confirmation", no.status === 400 && (await call("/meet/notes")).meetings.some((m) => m.id === mine.id));
    const del = await call(`/meet/notes/${mine.id}/delete`, { confirm: true });
    check("…and then it's gone (to the Recycle Bin)", del.ok && del.recycled && !(await call("/meet/notes")).meetings.some((m) => m.id === mine.id));
    const bad = await fetch(`http://localhost:${PORT}/api/meet/notes/..%2F..%2Fsecrets`);
    check("an id that isn't a saved meeting reaches nothing", bad.status === 404 || bad.status === 400 || !(await bad.json().catch(() => ({}))).transcript);
  }

  console.log("\n— Meet's markup changed: the fallbacks —");
  {
    const launched = launches;
    const bareUrl = `http://localhost:${PORT}/api/meet/mock?variant=bare&prejoin=0`;
    const [r, r2] = await Promise.all([host.join(bareUrl, { isRehearsal: true }), host.join(bareUrl, { isRehearsal: true })]);
    check("two joins at once: one meeting window, never two browsers on one profile", launches - launched === 1 && r.ok && r2.ok, `${launches - launched} launches`);
    check("a Meet page with no class names: still joined, captions still read", r.ok && host.status().check.captions === true, JSON.stringify(host.status().check.used));
    await page().evaluate(() => window.__mock.join("Pat Quill"));
    await host.setPermission({ mode: "everyone" });
    await sleep(800);
    const n = events.length;
    await say("Pat Quill", "Dayspring, what's 6 times 7?");
    const a = await answered(n);
    check("…and who is talking still comes through (Pat, by name)", /^Good question, Pat\./.test(voiceOf(since(n))) && /42/.test(a[0]?.spoken ?? ""), a[0]?.spoken);
    const n2 = events.length, before = (await sent()).length;
    await chat("Pat Quill", "@Lantern what's your favourite colour?");
    await answered(n2);
    await sleep(300);
    check("…and the chat too (@Lantern answers as Lantern)", (await sent()).slice(before).some((m) => /^Lantern: /.test(m)));
    // the call ends inside the meeting window (Leave pressed there): its window closes with it
    const was = page();
    await was.evaluate(() => document.querySelector("#leave").click());
    const gone = await waitFor(() => host.status().stage !== "in-call" && was.isClosed(), 14_000);
    check("left from the meeting window itself: the meeting ends and its window closes", gone && !host._session(), host.status().stage);
    await host.leave();
  }

  console.log("\n— Meet in French; a guest who calls themselves “You” —");
  {
    const r = await host.join(`http://localhost:${PORT}/api/meet/mock?lang=fr&prejoin=0`, { isRehearsal: true });
    await page().evaluate(() => { for (const p of ["Rich Alvarez", "Jess Park"]) window.__mock.join(p); });
    await waitFor(() => host.status().people.length === 2);
    check("Meet in French: joined, captions read, people found", r.ok && host.status().check.captions === true && host.status().people.length === 2, host.status().people.map((p) => p.name).join(", "));
    check("…the “joined” notices in French too", Boolean(host.status().roster?.sources?.toast));
    const n = events.length;
    await say("Vous", "Dayspring, mute.");
    await answered(n);
    check("…and the owner (“Vous”) can still give meeting commands", await page().evaluate(() => window.__mock.state.mic) === false);
    await host.command("unmute");
    await host.leave();

    await host.join(`http://localhost:${PORT}/api/meet/mock?prejoin=0`, { isRehearsal: true });
    await host.setPermission({ mode: "everyone" });
    const n2 = events.length;
    await page().evaluate(() => { window.__mock.join("Rich Alvarez"); window.__mock.join("You "); });
    const warned = await waitFor(() => since(n2).some((e) => e.type === "meet" && e.kind === "notice" && /named “You”/.test(e.text)));
    check("a guest named “You”: noticed, and the owner is told", warned && host.status().roster?.impostor === true);
    while (host.status().speaking) await sleep(200);
    const n3 = events.length;
    await say("You ", "Dayspring, unmute me please.");
    const a = await answered(n3);
    check("…and “You” can't give the owner's commands any more (the mic isn't touched)", new RegExp(`only ${OWNER} can ask me to do that`, "i").test(a[0]?.spoken ?? "") && await page().evaluate(() => window.__mock.state.mic) === true, a[0]?.spoken);
    await host.leave();
  }

  console.log("\n— nothing on the page names anyone: names read off a picture of the window —");
  {
    const ocr = await import("../../lib/meet/ocr.mjs");
    check("picking name labels from what the picture says", JSON.stringify(ocr.pickNames([
      { text: "Rich Alvarez", x: 348, y: 134, w: 164, h: 23 }, { text: "You", x: 30, y: 136, w: 49, h: 21 }, { text: "Lantern, what is a struct and how do I loop over it?", x: 25, y: 718, w: 311, h: 13 },
      { text: "4", x: 732, y: 767, w: 8, h: 10 }, { text: "Leave call", x: 900, y: 500, w: 60, h: 14 }, { text: "Jess Park", x: 662, y: 780, w: 122, h: 23 }], { width: 1280, height: 800 })) === JSON.stringify(["Rich Alvarez", "You"]));
    if (ocr.available()) {
      await host.join(`http://localhost:${PORT}/api/meet/mock?variant=canvas&prejoin=0`, { isRehearsal: true });
      await page().evaluate(() => { for (const p of ["Rich Alvarez", "Jess Park", "Sam Lee"]) window.__mock.join(p, { quiet: true }); });
      await sleep(800);
      check("names only as pixels: the page itself shows nobody", host.status().people.length === 0);
      const names = await host._peopleFromPicture();
      const st = host.status();
      check("…read off a picture of the window (Windows' own text recognition, on this computer)", ["Rich Alvarez", "Jess Park", "Sam Lee"].every((x) => st.people.some((p) => p.name === x && p.sources.includes("ocr"))), JSON.stringify(names));
      check("…the owner's own tile isn't a guest", !st.people.some((p) => /^you$/i.test(p.name)));
      await host.leave();
    } else console.log("(skipped: reading pictures needs Windows)");
  }

  console.log("\n— pre-flight and the course question tester —");
  {
    const pf = await call("/meet/preflight");
    check("the pre-flight checklist has every item", ["google", "mic", "sound", "captions", "lantern", "index", "ai", "link"].every((id) => pf.items.some((i) => i.id === id)), pf.items.map((i) => `${i.ok ? "✓" : "✗"}${i.id}`).join(" "));
    check("captions were seen in the rehearsal (remembered for the checklist)", pf.items.find((i) => i.id === "captions")?.ok === true);
    if (course) {
      const t = await call("/meet/ask", { question: "How do I protect a query from SQL injection?" });
      check("“try a course question” without a meeting", t.isCourse === true && t.answer?.citations?.length >= 1 && /It's covered in/.test(t.where ?? ""), t.where);
      const w = await call("/meet/ask", { question: "what's the weather like tomorrow" });
      check("…and a question that isn't about the course isn't treated as one", w.isCourse === false);
    }
    const bad = await call("/meet/settings", { publicLessonUrl: "javascript:alert(1)" });
    check("the public link must be https", /https/.test(bad.error ?? ""));
    // a lesson link from Lantern's search that isn't https is dropped (it's shown on the screen and posted in the chat)
    if (course) {
      courseAnswer.setDeps({ lanternCall: async () => ({ ok: true, status: 200, data: { results: [{ lessonId: "u1l1", title: "x", publicUrl: "javascript:alert(1)" }, { lessonId: "u1l2", title: "y", publicUrl: "https://example.test/ok#u1l2" }] } }) });
      const f = await courseAnswer.retrieve("anything at all", { course });
      check("a lesson link from Lantern must be https too", f.hits[0]?.publicUrl === null && f.hits[1]?.publicUrl === "https://example.test/ok#u1l2", JSON.stringify(f.hits.map((h) => h.publicUrl)));
      courseAnswer.setDeps({ lanternCall: async () => ({ ok: false, status: 0 }) });
    }
  }

  console.log("\n— the meeting panel —");
  {
    const browser = await pwChromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] }).catch(() => pwChromium.launch({ headless: true, args: ["--mute-audio"] }));
    try {
      const ui = await browser.newPage();
      await ui.goto(`http://localhost:${PORT}/meet-ui-test`);
      await ui.click("#meetMore");
      await ui.waitForSelector("#meetPublic");
      await ui.fill("#meetPublic", "https://typed.example/#{lesson}");
      await ui.focus("#meetPublic");
      await ui.evaluate(() => window.dsEvents.dispatchEvent(new MessageEvent("meet", { data: JSON.stringify({ kind: "state", stage: "closed", view: "large" }) })));
      await sleep(600);
      check("what's being typed in the panel survives a meeting update", await ui.inputValue("#meetPublic") === "https://typed.example/#{lesson}" && await ui.evaluate(() => document.activeElement?.id === "meetPublic"));
      await ui.evaluate(() => window.dsEvents.dispatchEvent(new MessageEvent("meet", { data: JSON.stringify({ kind: "notice", text: "<img src=x onerror=window.__xss=1> Rich" }) })));
      await sleep(200);
      check("…and a name or notice with markup in it is shown as text", await ui.evaluate(() => !window.__xss && !document.querySelector(".tunecard img")));
    } finally { await browser.close(); }
  }
} catch (e) {
  fail++; console.log("FAIL  unexpected: " + (e.stack ?? e.message));
} finally {
  await host.close().catch(() => {});
  server.close();
  await sleep(300);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* the browser may still hold the profile a moment */ }
}
console.log(`\n${fail ? `${fail} FAILED` : "all passed"}`);
process.exit(fail ? 1 : 0);
