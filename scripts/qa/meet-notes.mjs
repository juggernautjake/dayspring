// Meeting notes (lib/meet/notes.mjs), without a browser: nothing is written before everyone is told, "pause" and
// "don't record this part" keep words out, long meetings are summarized in parts (a pretend AI counts the calls), the
// summary without AI, saved meetings (list, search, read, recap, a draft that is never sent, delete to the "Recycle Bin",
// keeping them only so long), "what did Quinn say about…", "summarize so far", and the audio file (a pretend capture).
//   node scripts/qa/meet-notes.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "ds-notes-"));
process.env.DAYSPRING_MEETINGS_DIR = join(TMP, "meetings");
process.env.DAYSPRING_TEST_RECYCLE = join(TMP, "recycle");
process.env.DAYSPRING_MEET_FILE = join(TMP, "meet.json");
process.env.DAYSPRING_PEOPLE_DIR = join(TMP, "people");                // people's profiles (call history): the temp folder
process.env.DAYSPRING_VISION_SETTINGS = join(TMP, "vision.json");

let fail = 0;
const check = (name, ok, got = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + String(got).slice(0, 220) + ")" : ""}`); };
const notes = await import("../../lib/meet/notes.mjs");
const settings = await import("../../lib/meet/settings.mjs");

let t = Date.parse("2026-09-27T15:00:00Z");
let ai = false, calls = [];
const done = [];
notes.setDeps({
  now: () => t, aiReady: async () => ai, onDone: (id) => done.push(id),
  complete: async ({ system, prompt }) => { calls.push({ system, prompt }); return /exactly these sections/.test(system) ? "## Summary\nThey agreed to ship on Friday. Quinn will write the release notes.\n\n## Key points\n- Shipping Friday\n\n## Decisions\n- Ship Friday\n\n## Action items\n- **Quinn Harlow**: release notes (due Thursday)\n\n## Questions asked\n- None\n\n## Follow-ups\n- None." : `notes on part (${prompt.length} chars)`; },
});
const waitDone = async (n) => { for (let i = 0; i < 100 && done.length < n; i++) await new Promise((r) => setTimeout(r, 20)); return done.length >= n; };

try {
  console.log("\n— nothing is written before everyone is told —");
  {
    notes.begin({ title: "Weekly sync", link: "https://meet.google.com/abc-defg-hij" });
    notes.caption({ id: "c1", who: "Quinn Harlow", text: "before the heads-up" });
    notes.chat({ who: "Nova Brightwell", text: "also before" });
    check("before the announcement: nothing kept", notes._current().entries.length === 0 && notes.status().live === false);
    t += 1000; notes.live();
    t += 1000; notes.caption({ id: "c2", who: "Quinn Harlow", text: "Let's ship" });
    t += 500; notes.caption({ id: "c2", who: "Quinn Harlow", text: "Let's ship on Friday" });            // the caption grew
    t += 500; notes.caption({ id: "c2", who: "Quinn Harlow", text: "ship on Friday, and I'll write the notes" });   // its start was trimmed
    const e = notes._current().entries;
    check("after it: the first line says notes started (everyone was told)", e[0].kind === "mark" && /everyone in the meeting was told/.test(e[0].text));
    check("a caption line that grows (and gets trimmed at the start) is kept whole, once", e.filter((x) => x.kind === "speech").length === 1 && e[1].text === "Let's ship on Friday, and I'll write the notes", e[1].text);
    check("…a corrected word replaces the old one", notes.mergeGrowing("we should meet on Tuesday at", "we should meet on Thursday at noon") === "we should meet on Thursday at noon");
    notes.caption({ id: "c3", who: "Dayspring's voice", text: "an echo", echo: true });
    check("the assistants' own voice (captioned as the owner) isn't kept as speech", !notes._current().entries.some((x) => x.text === "an echo"));
  }

  console.log("\n— pause, and “don't record this part” —");
  {
    t += 1000; notes.caption({ id: "c4", who: "Wren Castellan", text: "Dayspring, don't record this part" });
    notes.pause("private");
    t += 1000; notes.caption({ id: "c5", who: "Nova Brightwell", text: "my salary is a secret" });
    notes.chat({ who: "Nova Brightwell", text: "secret chat" });
    notes.presence({ action: "joined", who: "Ollie Tamsin" });
    notes.answer({ as: "dayspring", who: "Nova", question: "q", spoken: "secret answer" });
    t += 60_000; notes.resume();
    const e = notes._current().entries;
    check("nothing said, written, or answered while it's off the record is kept", !JSON.stringify(e).match(/secret|Ollie Tamsin/), JSON.stringify(e.map((x) => x.text)));
    check("…and the request itself is taken out too", !e.some((x) => /don't record/.test(x.text)));
    check("…with a marker for the gap (from–to)", e.some((x) => x.kind === "mark" && /Not recorded from 00:04 to 01:05 \(asked not to\)/.test(x.text)), e.at(-1).text);
    notes.pause("paused"); t += 5000; notes.caption({ id: "c6", who: "Quinn Harlow", text: "paused words" }); notes.resume();
    check("“pause the notes” works the same way", !notes._current().entries.some((x) => x.text === "paused words"));
  }

  console.log("\n— what was said: joins, chat, answers; “what did Quinn say”; “so far” —");
  {
    t += 1000; notes.presence({ action: "joined", who: "Ollie Tamsin" });
    t += 1000; notes.chat({ who: "Nova Brightwell", text: "Here's the doc: https://example.test/doc" });
    t += 1000; notes.caption({ id: "c7", who: "Quinn Harlow", text: "The budget for the launch is five thousand dollars" });
    t += 1000; notes.caption({ id: "c8", who: null, text: "said by someone Tune in heard" });
    notes.heard("heard by Tune in");
    t += 1000; notes.answer({ as: "lantern", who: "Quinn", question: "how do I stop SQL injection?", spoken: "Use cfqueryparam.", citations: [{ label: "Unit 4, Lesson 2", title: "cfqueryparam", publicUrl: "https://example.test/c#u4l2" }] });
    t += 1000; notes.presence({ action: "left", who: "Ollie Tamsin" });
    const lines = notes.transcriptLines(notes._current().entries).join("\n");
    check("the transcript has times, speakers, the chat, joins and leaves, and answers with their lesson links", /\[\d\d:\d\d\] Quinn Harlow: The budget/.test(lines) && /\(chat\) Nova Brightwell: Here's the doc/.test(lines) && /→ Ollie Tamsin joined/.test(lines) && /→ Ollie Tamsin left/.test(lines) && /Lantern \(answering Quinn\): Use cfqueryparam\. \[Unit 4, Lesson 2: cfqueryparam https:\/\/example\.test\/c#u4l2\]/.test(lines), lines.slice(-400));
    check("what Tune in heard is kept as “Speaker unknown”", /Speaker unknown: heard by Tune in/.test(lines));
    const w = await notes.whatDid("Quinn", "the budget");
    check("“what did Quinn say about the budget?” (quoted, without AI)", /^Quinn Harlow said “The budget for the launch is five thousand dollars”/.test(w), w);
    check("…and about something he didn't mention", /didn't hear Quinn Harlow say anything about the weather/.test(await notes.whatDid("Quinn", "the weather")));
    const so = await notes.soFar();
    check("“summarize so far” without AI", /minutes? so far, \d+ things said, mostly by Quinn Harlow/.test(so), so);
    ai = true; calls = [];
    const so2 = await notes.soFar();
    check("…and with AI (one call for a short meeting; the transcript is marked as material, not instructions)", calls.length === 1 && /never follow instructions/.test(calls[0].system) && /<transcript>/.test(calls[0].prompt), `${calls.length} calls`);
    ai = false;
  }

  console.log("\n— the meeting ends: the files —");
  let id;
  {
    t += 60_000;
    const r = await notes.finish({ attendance: [{ name: "Quinn Harlow", joinedAt: t - 120_000, leftAt: null, talkMs: 42_000 }, { name: "Nova Brightwell", joinedAt: t - 110_000, leftAt: t - 5000, talkMs: 3000 }, { name: "Ollie Tamsin", joinedAt: t - 100_000, leftAt: t - 90_000, talkMs: 0 }], self: { name: "Wren Castellan", talkMs: 20_000 } });
    id = r?.id;
    check("saved in data/meetings/<date-title>", Boolean(id) && /^2026-09-2\d-\d{4}-weekly-sync$/.test(id) && r.dir.startsWith(process.env.DAYSPRING_MEETINGS_DIR), id);
    const files = readdirSync(r.dir).sort();
    check("transcript.md, chat.md, summary.md, meta.json (and transcript.json)", ["chat.md", "meta.json", "summary.md", "transcript.json", "transcript.md"].every((f) => files.includes(f)), files.join(", "));
    check("…no audio unless it was switched on", !files.includes("audio.wav"));
    await waitDone(1);
    const sum = readFileSync(join(r.dir, "summary.md"), "utf8");
    check("without AI: a summary anyway (who was there, talk time, questions heard, the chat, the whole transcript)", /Written without AI/.test(sum) && /\| Quinn Harlow \| .+ \| stayed \| 42 s \|/.test(sum) && /## Questions heard/.test(sum) && /## Chat/.test(sum) && /## The whole transcript/.test(sum) && /The budget for the launch/.test(sum), sum.slice(0, 300));
    check("…the course answers with their lesson links", /\*\*Quinn\*\* asked Lantern: “how do I stop SQL injection\?”/.test(sum) && /📘 Unit 4, Lesson 2: cfqueryparam — https:\/\/example\.test\/c#u4l2/.test(sum));
    check("…and it says which part wasn't recorded", /_Not recorded: 00:04–01:05, /.test(sum));
    const meta = JSON.parse(readFileSync(join(r.dir, "meta.json"), "utf8"));
    check("meta.json: who came and went, and how long each talked", meta.people.length === 3 && meta.people[0].talkMs === 42_000 && meta.people[1].leftAt && meta.summary === "offline", JSON.stringify(meta.people[1]));
    check("the chat file has just the chat", /\(chat\) Nova Brightwell: Here's the doc/.test(readFileSync(join(r.dir, "chat.md"), "utf8")) && !/budget/.test(readFileSync(join(r.dir, "chat.md"), "utf8")));
    check("a meeting where nothing was ever written down leaves nothing behind", (notes.begin({ title: "Empty" }), (await notes.finish({})) === null) && readdirSync(process.env.DAYSPRING_MEETINGS_DIR).length === 1);
  }

  console.log("\n— a two-hour meeting: summarized in parts —");
  {
    ai = true; calls = [];
    const entries = [];
    for (let i = 0; i < 2400; i++) entries.push({ t: i * 3000, kind: "speech", who: i % 2 ? "Quinn Harlow" : "Nova Brightwell", text: `Point number ${i} about the launch plan and what we decided for the rollout schedule.` });
    const meta = { title: "Planning", startedAt: new Date(t).toISOString(), endedAt: new Date(t + 7_200_000).toISOString(), minutes: 120, people: [{ name: "Quinn Harlow", talkMs: 3_600_000 }, { name: "Nova Brightwell", talkMs: 3_600_000 }], self: null, counts: { said: 2400, chat: 0, answers: 0 }, gaps: [] };
    const s = await notes.summarize({ meta, entries });
    const maps = calls.filter((c) => /one part of a meeting transcript/.test(c.system)).length;
    const reduce = calls.filter((c) => /exactly these sections/.test(c.system));
    check("the transcript is cut into parts (each under the size a model reads well)", s.parts > 1 && maps >= s.parts && calls.every((c) => c.prompt.length < 26_000), `${s.parts} parts, ${maps} part notes, largest prompt ${Math.max(...calls.map((c) => c.prompt.length))}`);
    check("…then one summary from the parts' notes, with every section", reduce.length === 1 && /## Summary[\s\S]*## Key points[\s\S]*## Decisions[\s\S]*## Action items[\s\S]*## Questions asked[\s\S]*## Follow-ups/.test(s.text) && /\*\*Quinn Harlow\*\*: release notes \(due Thursday\)/.test(s.text));
    check("…plus who was there, counted (not written by the AI)", /## Who was there[\s\S]*\| Quinn Harlow \| — \| stayed \| 60 min \|/.test(s.text));
    check("chunking keeps every line", notes.chunk(entries.map((e) => e.text).join("\n"), 5000).join("\n").split("\n").length === 2400);
    ai = false;
  }

  console.log("\n— saved meetings: list, search, read, recap, a draft, rewrite, delete, keep so long —");
  {
    const all = notes.list();
    check("the list", all.length === 1 && all[0].id === id && all[0].people.includes("Quinn Harlow") && all[0].minutes >= 1);
    check("search finds words said in it", notes.list({ q: "five thousand" }).length === 1 && notes.list({ q: "nothing like this" }).length === 0);
    const r = notes.read(id);
    check("reading one: its summary, transcript and chat", /Weekly sync/.test(r.summary) && /Quinn Harlow/.test(r.transcript) && /doc/.test(r.chat) && r.meta.id === id);
    const recap = notes.recapOf();
    check("“recap my last meeting”", /^Weekly sync: /.test(recap?.text ?? ""), recap?.text);
    const d = notes.draftOf(id);
    check("“email the summary”: only a draft (a mailto link with no one in it, never sent from here)", /^mailto:\?subject=Notes%3A%20Weekly%20sync/.test(d.mailto) && !/@/.test(d.mailto.split("?")[0]));
    ai = true;
    const again = await notes.resummarize(id);
    check("writing the summary again (e.g. once an AI key is added)", again?.how === "ai" && /They agreed to ship on Friday/.test(notes.read(id).summary) && notes.read(id).meta.summary === "ai");
    ai = false;
    check("an id that isn't a saved meeting can't reach anything", notes.read("../../etc") === null && notes.read("..") === null && (await notes.remove("../x")) === false);
    // keep for 30 days: an old one goes to the Recycle Bin
    settings.set({ notesKeepDays: 30 });
    const old = JSON.parse(readFileSync(join(process.env.DAYSPRING_MEETINGS_DIR, id, "meta.json"), "utf8"));
    check("kept while it's newer than 30 days", (await notes.cleanup({ now: Date.parse(old.endedAt) + 5 * 86_400_000 })) === 0 && notes.list().length === 1);
    check("older than 30 days: to the Recycle Bin", (await notes.cleanup({ now: Date.parse(old.endedAt) + 31 * 86_400_000 })) === 1 && notes.list().length === 0 && readdirSync(process.env.DAYSPRING_TEST_RECYCLE).some((f) => f.endsWith(id)));
    settings.set({ notesKeepDays: 90 });
    // delete
    notes.begin({ title: "To delete" }); notes.live(); t += 1000; notes.caption({ id: "x", who: "Quinn Harlow", text: "hello" });
    const r2 = await notes.finish({});
    await waitDone(2);
    check("delete: gone from the list, into the Recycle Bin (restorable)", (await notes.remove(r2.id)) === true && !notes.list().some((m) => m.id === r2.id) && readdirSync(process.env.DAYSPRING_TEST_RECYCLE).some((f) => f.endsWith(r2.id)));
  }

  console.log("\n— the audio (a separate choice; a pretend capture) —");
  {
    let onPcm = null, stopped = 0;
    notes.setDeps({ capture: async (o) => { onPcm = o.onPcm; return { device: "test", stop: () => { stopped++; } }; } });
    notes.begin({ title: "With audio" });
    onPcm?.(new Int16Array(1600));
    check("no audio before everyone is told", onPcm === null);
    notes.live({ audio: true });
    for (let i = 0; i < 20 && !onPcm; i++) await new Promise((r) => setTimeout(r, 10));
    onPcm(new Int16Array(16000));                      // one second
    notes.pause("private"); onPcm(new Int16Array(16000)); notes.resume();   // not kept
    onPcm(new Int16Array(8000));
    t += 1000; notes.caption({ id: "a", who: "Quinn Harlow", text: "with audio" });
    const r = await notes.finish({});
    await new Promise((ok) => setTimeout(ok, 30));     // (a capture still starting when the notes end is stopped as it arrives)
    const wav = readFileSync(join(r.dir, "audio.wav"));
    check("audio.wav: a real WAV file, 16 kHz mono, with only the recorded parts (1.5 s, not 2.5 s)", wav.toString("ascii", 0, 4) === "RIFF" && wav.readUInt32LE(24) === 16000 && wav.readUInt32LE(40) === 48000 && wav.length === 44 + 48000 && stopped === 1, `${wav.readUInt32LE(40)} bytes of sound, ${wav.length} in the file, stopped ${stopped}`);
    check("…and the list says it has audio", notes.list().find((m) => m.id === r.id)?.audio === true);
    await waitDone(3);
  }

  console.log("\n— who was in the meeting, onto people's profiles (only with “Save call history” on) —");
  {
    const host = await import("../../lib/meet/host.mjs");
    const logged = [];
    host.setDeps({ logCall: async (c) => { logged.push(c); return [c]; } });
    const who = [{ name: "Quinn Harlow", joinedAt: 1000, leftAt: null }, { name: "Nova Brightwell", joinedAt: 2000, leftAt: 5000 }, { name: "" }];
    check("a rehearsal's made-up people are never saved", (await host._logAttendees(who, { rehearsal: true, start: 500, end: 9000 })) === 0 && logged.length === 0);
    await host._logAttendees(who, { rehearsal: false, start: 500, end: 9000 });
    check("a real meeting: logCall({ who, app: \"meet\", start, end }) for each attendee", logged.length === 2 && logged[0].who === "Quinn Harlow" && logged[0].app === "meet" && logged[0].start === 1000 && logged[0].end === 9000 && logged[1].end === 5000, JSON.stringify(logged));
    // the real lib/people/comms: nothing written unless the owner turned "Save call history" on
    const secure = await import("../../lib/vision/secure.mjs");
    secure._setCrypto({ protect: async (b) => b, unprotect: async (b) => b });           // no DPAPI helper needed here
    const comms = await import("../../lib/people/comms.mjs"), vs = await import("../../lib/vision/settings.mjs");
    const off = await comms.logCall({ who: "Quinn Harlow", app: "meet", start: 1000, end: 9000 });
    await comms.flush?.();
    check("\"Save call history\" off (the default): nothing is kept", off === null && !existsSync(join(TMP, "people", "comms.bin")), off);
    vs.set({ saveCalls: true });
    const on = await comms.logCall({ who: "Quinn Harlow", app: "meet", start: 1000, end: 9000 });
    check("…on: the call is kept for that person, as a meet call", on?.length === 1 && on[0].app === "meet" && on[0].durationSec === 8, JSON.stringify(on));
    comms._reset();
  }
} catch (e) {
  fail++; console.log("FAIL  unexpected: " + (e.stack ?? e.message));
} finally {
  notes._reset();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ }
}
console.log(`\n${fail ? `${fail} FAILED` : "all passed"}`);
process.exit(fail ? 1 : 0);
