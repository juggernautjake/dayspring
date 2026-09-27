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
//   node scripts/qa/meet.mjs
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "ds-meet-"));
process.env.DAYSPRING_MEET_FILE = join(TMP, "meet.json");
process.env.DAYSPRING_MEET_PROFILE = join(TMP, "profile");
process.env.DAYSPRING_MEET_HEADLESS = "1";
process.env.DAYSPRING_MEET_NO_WINDOW = "1";
process.env.AI_PROVIDER = "none";
process.env.TTS_PROVIDER = "browser";
process.env.DS_CALLS_FILE = join(TMP, "calls.json");

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
host.setDeps({ persona: async () => persona, lanternSpeaking: async () => false });
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
    const r = await call("/meet/leave", {});
    check("leaving", r.ok && ["left", "closed"].includes(host.status().stage));
    check("the meeting's memory is gone (answers, people)", host.recent().length === 0 && host.status().people.length === 0);
    check("Tune in is back on duty", tunein.standingDown() === false);
  }

  console.log("\n— Meet's markup changed: the fallbacks —");
  {
    const r = await host.join(`http://localhost:${PORT}/api/meet/mock?variant=bare&prejoin=0`, { isRehearsal: true });
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
    await host.leave();
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
