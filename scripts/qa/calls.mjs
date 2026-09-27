// Dayspring in calls and Discord chat, without real devices, real Discord or real AI (everything is pretend):
//   • voice detection: an utterance ends ~0.45 s after speech (Tune in and lib/calls/vad.mjs); hum and hiss aren't speech
//   • the sentence splitter (abbreviations, decimals, a long first sentence cut at a comma, streaming)
//   • talking over Dayspring (barge-in), the echo guard, who answers when the bot and Tune in are both in a call
//   • the Discord chat companion: mentions, DMs, the Dayspring channel, permissions, rate limits, slash commands,
//     answers written into the message as they arrive, per-channel memory
//   • the answer pipeline: the first sentence reaches the voice ≤150 ms after the AI wrote it; old vs new flow timings
//   • call apps: which app is open (pretend process lists), each app's microphone/speaker card, "what mic should Zoom use?"
//   • privacy: speech that isn't for Dayspring leaves no timing record and no log line
//   node scripts/qa/calls.mjs              (all pretend)
//   node --env-file=.env scripts/qa/calls.mjs --live   also measures the real speech models, AI and voice on this PC
//                                                      (no devices are touched; keys are used, never printed)
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIVE = process.argv.includes("--live");
const TMP = mkdtempSync(join(tmpdir(), "ds-calls-"));
process.env.DS_CALLS_FILE = join(TMP, "calls.json");
process.env.DS_CALL_LATENCY_LOG = join(TMP, "call-latency.log");
if (!LIVE) { process.env.AI_PROVIDER = "anthropic"; process.env.ANTHROPIC_API_KEY = "test-not-a-real-key"; process.env.ELEVENLABS_API_KEY = ""; process.env.TTS_PROVIDER = "elevenlabs"; }

let fail = 0;
const check = (name, ok, got = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vad = await import("../../lib/calls/vad.mjs");
const { createSplitter, splitAll } = await import("../../lib/calls/sentences.mjs");
const cfg = await import("../../lib/calls/config.mjs");
const latency = await import("../../lib/calls/latency.mjs");
const { createBargeIn } = await import("../../lib/calls/bargein.mjs");
const apps = await import("../../lib/calls/apps.mjs");
const pipeline = await import("../../lib/calls/pipeline.mjs");
const streamLlm = await import("../../lib/calls/stream-llm.mjs");
const chatMod = await import("../../lib/discord/chat.mjs");
const tunein = await import("../../lib/tunein.mjs");
const warmMod = await import("../../lib/calls/warm.mjs");
const warmed = []; if (!LIVE) warmMod._setFake((u) => warmed.push(u));
const heardCalls = [];
tunein._setTranscribe(async (pcm, o) => { heardCalls.push({ speed: o?.speed ?? "accurate", at: Date.now() }); return { text: "so anyway that was the game", ms: 1 }; });
pipeline.setDeps({ personaBlock: async () => "", devices: async () => ({ callMic: "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)", voiceTo: "Voicemeeter Input (VB-Audio Voicemeeter VAIO)", yourSpeakers: "Speakers (Test Headset)", voicemeeterInstalled: true }), weather: async () => "It's 70 degrees and sunny.", joke: async () => "Why did the test pass? It was well prepared." });

console.log("\n— voice detection —");
{
  // lib/calls/vad.mjs with a pretend clock: 1 s of speech, then quiet in 20 ms steps until the utterance is cut
  let t = 0, got = null;
  const v = vad.createVad({ hangMs: 450, now: () => t, onUtterance: (pcm, info) => { got = { ...info, samples: pcm.length }; } });
  v.push(vad.synthSilence(400)); t += 400;
  v.push(vad.synthSpeech(1000)); t += 1000;
  const speechEnd = t; let steps = 0;
  while (!got && steps < 100) { v.push(vad.synthSilence(20)); t += 20; steps++; }
  const waited = got ? got.endedAt - speechEnd : null;
  check("an utterance ends 450 ms after the speech (±40 ms)", waited !== null && Math.abs(waited - 450) <= 40, `${waited} ms`);
  check("the utterance keeps the speech (≈1 s, not the trailing quiet)", got && got.samples / 16000 >= 0.95 && got.samples / 16000 <= 1.5, got ? (got.samples / 16000).toFixed(2) + " s" : "none");
  let n = 0; const v2 = vad.createVad({ onUtterance: () => n++ });
  v2.push(vad.synthSilence(3000, 300));
  const hum = new Int16Array(16000 * 2); for (let i = 0; i < hum.length; i++) hum[i] = Math.round(3000 * Math.sin(2 * Math.PI * 50 * i / 16000));
  v2.push(hum);
  const hiss = new Int16Array(16000 * 2); let s = 7; for (let i = 0; i < hiss.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; hiss[i] = (i % 2 ? 1 : -1) * (2000 + (s % 1000)); }
  v2.push(hiss); v2.push(vad.synthSilence(1000));
  check("background noise, a 50 Hz hum and hiss are not speech", n === 0, `${n} utterances`);
  let short = 0; const v3 = vad.createVad({ onUtterance: () => short++ });
  v3.push(vad.synthSpeech(200)); v3.push(vad.synthSilence(1000));
  check("a 0.2 s click or cough isn't an utterance", short === 0);
}
{
  // Tune in's own detector uses the same setting: the old 700 ms vs the new 450 ms
  const frames = async (hangMs) => {
    cfg.set({ hangMs, arbitration: "bot" });
    tunein._setBotInCall(async () => true);          // nothing is transcribed in this test
    let hit = null; tunein._setUtteranceHook((u) => { hit = u; });
    tunein._testFeed(vad.synthSilence(600)); tunein._testFeed(vad.synthSpeech(1200));
    let steps = 0; while (!hit && steps < 120) { tunein._testFeed(vad.synthSilence(20)); steps++; }
    tunein._setUtteranceHook(null);
    return hit ? steps * 20 : null;
  };
  const oldMs = await frames(700), newMs = await frames(450);
  check("Tune in ends an utterance after the configured quiet: 450 ms (was 700 ms)", newMs !== null && Math.abs(newMs - 450) <= 40 && Math.abs(oldMs - 700) <= 40, `old ${oldMs} ms → new ${newMs} ms`);
  globalThis.__hang = { oldMs, newMs };
  await sleep(50);
  cfg.set({ hangMs: 450 });
}

console.log("\n— sentences —");
{
  check("abbreviations and decimals don't end a sentence", JSON.stringify(splitAll("Dr. Smith said it's 3.5 degrees out. Bring a coat!")) === JSON.stringify(["Dr. Smith said it's 3.5 degrees out.", "Bring a coat!"]), JSON.stringify(splitAll("Dr. Smith said it's 3.5 degrees out. Bring a coat!")));
  check("initials and a.m. stay together", splitAll("J. R. R. Tolkien wrote it at 9 a.m. on a Tuesday. Fun fact.").length === 2, JSON.stringify(splitAll("J. R. R. Tolkien wrote it at 9 a.m. on a Tuesday. Fun fact.")));
  const out = []; const sp = createSplitter({ onSentence: (x) => out.push(x) });
  const text = "The Eiffel Tower is about 330 metres tall, which is roughly the height of an 81-storey building. It was finished in 1889.";
  let firstAt = null;
  for (let i = 0; i < text.length; i += 3) { sp.push(text.slice(i, i + 3)); if (out.length && firstAt === null) firstAt = i + 3; }
  sp.flush();
  check("a long first sentence is spoken up to its first comma, early", out[0] === "The Eiffel Tower is about 330 metres tall," && firstAt <= 48, `${JSON.stringify(out[0])} after ${firstAt} chars`);
  check("streaming: every word arrives exactly once, in order", out.join(" ") === text, out.length + " parts");
  check("a very long run with no punctuation is still cut", splitAll("word ".repeat(80)).length >= 2);
}

console.log("\n— barge-in, echo, who answers —");
{
  const timers = []; const fakeSet = (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }; const fakeClear = (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
  let playing = true, barged = [];
  const b = createBargeIn({ ms: () => 600, isPlaying: () => playing, onBarge: (u) => barged.push(u), setTimer: fakeSet, clearTimer: fakeClear });
  b.start("amy"); check("talking over Dayspring starts a 600 ms wait", timers.length === 1 && timers[0].ms === 600);
  timers.shift().fn(); check("still talking after 600 ms → Dayspring stops", barged.join() === "amy");
  b.start("ben"); b.end("ben"); check("a quick “mm-hm” (stopped before 600 ms) doesn't stop it", timers.length === 0 && barged.length === 1);
  playing = false; b.start("cat"); check("nothing to interrupt when Dayspring is quiet", timers.length === 0);
  const off = createBargeIn({ enabled: () => false, isPlaying: () => true, setTimer: fakeSet, clearTimer: fakeClear }); off.start("x");
  check("barge-in can be turned off", timers.length === 0);

  tunein.noteSaid("The capital of Australia is Canberra, not Sydney.");
  check("echo guard: Dayspring's own words coming back through the headset are ignored", tunein._isEcho("the capital of australia is canberra"));
  check("echo guard: a friend's new question isn't mistaken for an echo", !tunein._isEcho("dayspring what's the capital of canada"));

  // Tune in and the bot in the same call: with "bot" (the default) Tune in stays quiet and doesn't even transcribe
  cfg.set({ arbitration: "bot" }); let asked = false;
  tunein._setBotInCall(async () => { asked = true; return true; });
  let hits = 0; tunein._setUtteranceHook(() => hits++);
  tunein._testFeed(vad.synthSpeech(1200)); tunein._testFeed(vad.synthSilence(800)); await sleep(30);
  tunein._setUtteranceHook(null);
  check("bot and Tune in in one call: the bot answers, Tune in doesn't (no double replies)", asked && hits === 1 && tunein.status().replying === false, JSON.stringify({ asked, hits, q: tunein.status().queue, err: tunein.status().error }));
  check("the default is “the bot answers”", cfg.DEFAULTS.arbitration === "bot");

  // head start: the fast speech model starts 240 ms into a pause; if the pause becomes the end, those words are used
  cfg.set({ arbitration: "tunein" }); tunein._setBotInCall(async () => false);
  await sleep(20); heardCalls.length = 0;
  let got = null; tunein._setUtteranceHook((u) => { got = u; });
  tunein._testFeed(vad.synthSpeech(1200)); tunein._testFeed(vad.synthSilence(260));
  const startedEarly = heardCalls.length === 1 && heardCalls[0].speed === "fast" && !got;
  tunein._testFeed(vad.synthSilence(300)); await sleep(30);
  check("head start: the fast model is already working 240 ms into the pause", startedEarly, JSON.stringify(heardCalls.map((c) => c.speed)));
  check("…and the end of the utterance reuses it (no second pass)", got?.early === true && heardCalls.length === 1, `${heardCalls.length} passes`);
  heardCalls.length = 0; got = null;
  tunein._testFeed(vad.synthSpeech(1000)); tunein._testFeed(vad.synthSilence(300)); tunein._testFeed(vad.synthSpeech(800)); tunein._testFeed(vad.synthSilence(600)); await sleep(30);
  check("a mid-sentence pause: the early guess is dropped and the whole sentence is used", got?.seconds > 2 && got?.early === true && heardCalls.length === 2, JSON.stringify({ s: got?.seconds, n: heardCalls.length }));
  tunein._setUtteranceHook(null); cfg.set({ arbitration: "bot" });
}

console.log("\n— Discord chat —");
{
  let t = 1_000_000;
  const logs = [], owned = [];
  const conf = () => ({ ...cfg.DEFAULTS, ...confPatch, rate: { ...cfg.DEFAULTS.rate, ...(confPatch.rate ?? {}) } });
  let confPatch = { dm: "server" };
  const replies = [];
  const chat = chatMod.createChat({
    botId: () => "BOT", ownerId: () => "OWNER", textChannel: () => "", conf, now: () => t,
    inServer: async (id) => id === "FRIEND",
    ownerChat: async (text) => { owned.push(text); return { reply: `Full assistant: ${text}` }; },
    quick: async (text) => (/^what time is it\??$/i.test(text) ? { reply: "It's 3:00 PM." } : null),
    reply: async (o) => { replies.push(o); o.onSentence("Paris is the capital of France."); o.onSentence("It's lovely in spring."); return { reply: "Paris is the capital of France. It's lovely in spring.", offline: false, model: "claude-haiku-4-5-20251001" }; },
    wake: (x) => { const m = /^(?:hey\s+)?dayspring[,!.]?\s*(.*)$/i.exec(x); return m ? m[1] : null; },
    log: (k, d) => logs.push({ k, ...d }), owner: () => "Sam", assistant: () => "Dayspring", aiReady: () => true,
  });
  const sent = [];
  const msg = (o) => {
    const m = { author: { id: "FRIEND", bot: false, username: "amy" }, content: "", guild: { id: "G" }, channelId: "C1", member: { displayName: "Amy" }, mentions: { users: new Set() },
      channel: { sendTyping: async () => { m.typed = true; } }, typed: false, ...o };
    m.reply = async (content) => { const out = { content, edits: [], edit: async (c) => { out.edits.push(c); out.content = c; return out; } }; sent.push(out); return out; };
    return m;
  };
  check("a message not for Dayspring is ignored (and not logged)", (await chat.handleMessage(msg({ content: "anyone up for a game?" }))).ignored && logs.length === 0);
  check("other bots are always ignored", (await chat.handleMessage(msg({ author: { id: "B2", bot: true }, content: "<@BOT> hi" }))).ignored);
  const m1 = msg({ content: "<@BOT> what's the capital of France?", mentions: { users: new Set(["BOT"]) } });
  const r1 = await chat.handleMessage(m1);
  const s1 = sent.at(-1);
  check("an @mention is answered, with the typing indicator first", r1.reply?.startsWith("Paris") && m1.typed);
  check("the answer is posted at the first sentence and completed by an edit", s1.edits.length >= 1 && s1.content === "Paris is the capital of France. It's lovely in spring.", JSON.stringify({ first: sent.at(-1).content, edits: s1.edits.length }));
  check("friends get the friendly read-only answer (who: friend)", replies.at(-1).who === "friend" && replies.at(-1).schedule === "");
  t += 2000;
  await chat.handleMessage(msg({ content: "Dayspring, and Germany?" }));
  check("“Dayspring, …” at the start of a message works in any channel", replies.at(-1).text === "and Germany?");
  check("the channel remembers the conversation", replies.at(-1).history.length === 2 && replies.at(-1).history[0].content.includes("France"));
  t += 2000;
  await chat.handleMessage(msg({ content: "<@BOT> add pizza night to Sam's schedule", mentions: { users: new Set(["BOT"]) } }));
  check("a friend can't change anything", /Only Sam can ask me to change things/.test(sent.at(-1).content));
  t += 2000;
  await chat.handleMessage(msg({ content: "<@BOT> what's on the schedule today?", mentions: { users: new Set(["BOT"]) } }));
  check("a friend can't see the owner's schedule", /private/.test(sent.at(-1).content));
  confPatch = { ...confPatch, shareSchedule: true }; t += 2000;
  const before = replies.length;
  await chat.handleMessage(msg({ content: "<@BOT> what's on the schedule today?", mentions: { users: new Set(["BOT"]) } }));
  check("…unless the owner turned on “Share my schedule with Discord”", replies.length === before + 1);
  confPatch = { ...confPatch, shareSchedule: false }; t += 2000;
  await chat.handleMessage(msg({ author: { id: "OWNER", bot: false, username: "sam" }, content: "<@BOT> remind me to call mom at 6", mentions: { users: new Set(["BOT"]) } }));
  check("the owner gets the full assistant (reminders, schedule)", owned.at(-1) === "remind me to call mom at 6");
  t += 2000;
  await chat.handleMessage(msg({ content: "<@BOT> what time is it?", mentions: { users: new Set(["BOT"]) } }));
  check("instant answers (the time) skip the AI", sent.at(-1).content === "It's 3:00 PM.");
  // DMs
  const dm = (id, p) => msg({ author: { id, bot: false, username: id }, guild: null, channelId: "DM-" + id, content: "hi there", ...p });
  confPatch = { dm: "server" }; t += 5000;
  check("DMs “server”: someone in a server with the bot gets an answer", !(await chat.handleMessage(dm("FRIEND"))).ignored);
  t += 5000; check("DMs “server”: a stranger is ignored", (await chat.handleMessage(dm("STRANGER"))).ignored);
  confPatch = { dm: "owner" }; t += 5000;
  check("DMs “owner”: only the owner", (await chat.handleMessage(dm("FRIEND"))).ignored && !(await chat.handleMessage(dm("OWNER"))).ignored);
  confPatch = { dm: "off" }; t += 5000; check("DMs “off”: nobody", (await chat.handleMessage(dm("OWNER"))).ignored);
  confPatch = { dm: "anyone" }; t += 5000; check("DMs “anyone”: a stranger too", !(await chat.handleMessage(dm("STRANGER"))).ignored);
  // the Dayspring channel
  confPatch = { chatChannelId: "DAYCH" }; t += 5000;
  check("in Dayspring's channel every message is for it", !(await chat.handleMessage(msg({ channelId: "DAYCH", content: "how tall is Everest?", author: { id: "P2", bot: false } }))).ignored);
  // rate limits
  confPatch = {}; const spam = []; let warned = 0;
  for (let i = 0; i < 9; i++) { t += 2000; const before2 = sent.length; const r = await chat.handleMessage(msg({ author: { id: "SPAM", bot: false }, channelId: "C9", content: "<@BOT> hi " + i, mentions: { users: new Set(["BOT"]) } })); spam.push(r.limited ? "L" : "ok"); if (r.limited && sent.length > before2) warned++; }
  check("6 messages a minute per person, then a pause", spam.filter((x) => x === "ok").length === 6, spam.join(","));
  check("…with one friendly “give me a minute”, not one per message", warned === 1, `${warned} warnings`);
  t += 61_000; check("after a minute they can ask again", !(await chat.handleMessage(msg({ author: { id: "SPAM", bot: false }, channelId: "C9", content: "<@BOT> again", mentions: { users: new Set(["BOT"]) } }))).limited);
  t += 500; check("a short cooldown between one person's messages", (await chat.handleMessage(msg({ author: { id: "SPAM", bot: false }, channelId: "C9", content: "<@BOT> again!", mentions: { users: new Set(["BOT"]) } }))).limited === "cooldown");
  // memory expires
  t += 31 * 60_000;
  await chat.handleMessage(msg({ content: "<@BOT> hello", mentions: { users: new Set(["BOT"]) } }));
  check("channel memory is forgotten after 30 minutes of quiet", replies.at(-1).history.length === 0);
  // slash commands
  const inter = (name, o = {}, user = "FRIEND") => {
    const i = { commandName: name, user: { id: user, username: user }, member: { displayName: user }, channelId: "C5", out: [],
      options: { getString: (k) => o[k] ?? null, getSubcommand: () => o.sub },
      deferReply: async () => {}, editReply: async (c) => { i.out.push(typeof c === "string" ? c : c.content); }, followUp: async (c) => { i.out.push(c); }, reply: async (c) => { i.out.push(typeof c === "string" ? c : c.content); } };
    return i;
  };
  t += 5000; let i = inter("time"); await chat.handleSlash(i); check("/time answers", i.out[0] === "It's 3:00 PM.", JSON.stringify(i.out));
  t += 5000; i = inter("ask", { question: "Why is the sky blue?" }); await chat.handleSlash(i); check("/ask streams its answer into the reply", i.out.at(-1)?.includes("lovely in spring"), JSON.stringify(i.out));
  t += 5000; i = inter("help"); await chat.handleSlash(i); check("/help explains what it can do", /\/ask/.test(i.out[0]) && !/\/remind/.test(i.out[0]));
  t += 5000; i = inter("remind", { what: "stretch", when: "in 20 minutes" }); await chat.handleSlash(i); check("/remind is owner-only", /Only Sam/.test(i.out[0]));
  t += 5000; i = inter("remind", { what: "stretch", when: "in 20 minutes" }, "OWNER"); await chat.handleSlash(i); check("/remind works for the owner", owned.at(-1) === "Remind me to stretch in 20 minutes");
  const names = chatMod.slashCommands("Dayspring").map((c) => c.name);
  check("slash commands: /ask /joke /time /weather /remind /help and /dayspring join|leave|say", ["ask", "joke", "time", "weather", "remind", "help", "dayspring"].every((n) => names.includes(n)) && chatMod.slashCommands().find((c) => c.name === "dayspring").options.map((o) => o.name).join() === "join,leave,say");
  check("only requests made to Dayspring are logged", logs.every((l) => l.said && !/anyone up for a game/.test(l.said)));
  // edits are spaced out (Discord's limit is 5 edits per 5 s per channel)
  let now2 = 0; const edits = []; const pending = [];
  const target = { reply: async (c) => ({ edit: async (x) => { edits.push({ x, at: now2 }); } }) };
  const st = chatMod.createStreamer(target, { everyMs: 1100, now: () => now2, schedule: (fn, ms) => { pending.push({ fn, at: now2 + ms }); return {}; } });
  for (let k = 0; k < 10; k++) { st.push(`Sentence ${k}.`); now2 += 100; }
  await sleep(5); for (const p of pending.splice(0)) { now2 = Math.max(now2, p.at); p.fn(); } await sleep(5);
  await st.end();
  check("streamed edits are batched (not one per sentence)", edits.length <= 3 && edits.at(-1).x.endsWith("Sentence 9."), `${edits.length} edits`);
}

console.log("\n— the answer pipeline —");
{
  streamLlm._resetFast();
  check("the quick model for calls comes from the provider's own list (Claude: Haiku)", LIVE || (await streamLlm.fastModel()) === "claude-haiku-4-5-20251001", await streamLlm.fastModel());
  // pretend AI: first word after 300 ms, then a word every 15 ms
  const ANSWER = "Canberra is the capital of Australia. Lots of people guess Sydney, but Canberra was built to be the capital. Fun, right?";
  let wroteFirstSentenceAt = null;
  streamLlm._setFake(async function* () {
    await sleep(300);
    const w = ANSWER.split(/(?<= )/); let acc = "";
    for (const piece of w) { acc += piece; yield piece; if (!wroteFirstSentenceAt && acc.includes("Australia.")) wroteFirstSentenceAt = Date.now(); await sleep(15); }
  });
  const t0 = Date.now(); const got = [];
  const trace = latency.begin({ via: "tunein", endedAt: t0 });
  const r = await pipeline.reply({ text: "what's the capital of Australia", trace, onSentence: (s) => got.push({ s, at: Date.now() }) });
  const overhead = got[0].at - wroteFirstSentenceAt;
  check("the first sentence goes to the voice ≤150 ms after the AI wrote it", overhead <= 150, `${overhead} ms`);
  check("the whole answer arrives as separate sentences, in order", got.map((g) => g.s).join(" ") === ANSWER && got.length === 3, got.length + " sentences");
  check("the first sentence is out before the AI has finished", got[0].at < t0 + 300 + ANSWER.split(" ").length * 15 - 100);
  trace.mark("firstAudio", got[0].at + 200); trace.done({});
  check("answering opens the AI and voice connections early (no words sent)", LIVE || warmed.some((u) => /anthropic/.test(u)) && warmed.some((u) => /elevenlabs/.test(u)), JSON.stringify(warmed));
  const rec = latency.last()[0];
  check("each answer's timings are kept (Settings → Calls and the log)", rec.firstToken >= 290 && rec.firstSentence >= rec.firstToken && rec.total >= rec.firstSentence && existsSync(process.env.DS_CALL_LATENCY_LOG), JSON.stringify(rec));
  check("…with no words in the log", !/canberra|australia/i.test(readFileSync(process.env.DS_CALL_LATENCY_LOG, "utf8")));
  // stopping mid-answer (talked over): nothing more is spoken
  const ctl = new AbortController(); const got2 = [];
  const p2 = pipeline.reply({ text: "tell me about Australia", signal: ctl.signal, onSentence: (s) => { got2.push(s); ctl.abort(); } });
  const r2 = await p2;
  check("stopped mid-answer: nothing after the first sentence", got2.length === 1 && r2.stopped, `${got2.length} spoken`);
  streamLlm._setFake(null);
  // no AI at all: instant answers, and a clear note
  const keep = process.env.AI_PROVIDER; process.env.AI_PROVIDER = "none";
  const o1 = []; const t1 = Date.now(); const off1 = await pipeline.reply({ text: "what time is it", onSentence: (s) => o1.push(Date.now() - t1) });
  check("without AI: the time, instantly", off1.offline && /^It's \d/.test(off1.reply) && o1[0] < 50, `${o1[0]} ms`);
  const off2 = await pipeline.reply({ text: "what's twelve times seven" });
  check("without AI: quick math", /84/.test(off2.reply), off2.reply);
  const off3 = await pipeline.reply({ text: "who won the world series in 1995" });
  check("without AI: says it's limited, and what it can do", /limited without AI/.test(off3.reply));
  if (keep === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = keep;
  // "What mic should Zoom use?"
  const z = await pipeline.reply({ text: "what mic should Zoom use", via: "tunein" });
  check("“What mic should Zoom use?” → the exact microphone and speaker", z.setup === "zoom" && /Voicemeeter Out B1 \(VB-Audio Voicemeeter VAIO\)/.test(z.reply) && /Speakers \(Test Headset\)/.test(z.reply), z.reply);
  const g = await pipeline.reply({ text: "how do I set up Google Meet for you", via: "tunein" });
  check("“How do I set up Google Meet for you?” → Meet's card", g.setup === "meet" && /Google Meet/.test(g.reply));
  const f = await pipeline.reply({ text: "what mic should zoom use", via: "discord-text", who: "friend" });
  check("…but a friend on Discord isn't told about the owner's devices", f.setup !== "zoom");
}

console.log("\n— call apps —");
{
  const cases = [
    [[{ name: "Zoom", title: "Zoom Meeting" }], "zoom", true],
    [[{ name: "chrome", title: "Meet - abc-defg-hij - Google Chrome" }], "meet", true],
    [[{ name: "msedge", title: "Meet – Weekly sync and 2 more pages - Microsoft Edge" }], "meet", true],
    [[{ name: "ms-teams", title: "Meeting with Alex | Microsoft Teams" }], "teams", true],
    [[{ name: "Discord", title: "#general | My Server - Discord" }], "discord", false],
    [[{ name: "chrome", title: "Recipes - Google Chrome" }, { name: "notepad", title: "notes" }], null, false],
    [[{ name: "Discord", title: "Friends - Discord" }, { name: "Zoom", title: "Zoom Meeting" }], "zoom", true],
  ];
  for (const [list, want, meeting] of cases) {
    apps._setLister(async () => list);
    const d = await apps.detect({ fresh: true });
    check(`detects ${want ?? "no call app"} from ${list.map((x) => x.name).join("+")}`, d.app === want && d.inMeeting === meeting, JSON.stringify(d));
  }
  apps._setLister(async () => { throw new Error("no powershell"); });
  check("detection failing is harmless", (await apps.detect({ fresh: true })).app === null);
  apps._setLister(null);
  apps._setDevices(async () => ({ capture: [{ name: "Microphone (Test Headset)", default: true }, { name: "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)" }], playback: [{ name: "Speakers (Test Headset)", default: true }, { name: "Voicemeeter Input (VB-Audio Voicemeeter VAIO)" }] }));
  const dev = await apps.devices({ fresh: true });
  check("reads this computer's exact device names", dev.callMic === "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)" && dev.voiceTo === "Voicemeeter Input (VB-Audio Voicemeeter VAIO)" && dev.yourSpeakers === "Speakers (Test Headset)");
  const gs = apps.guides(dev, "Headphones (Other Headset)");
  check("a card for Discord, Zoom, Google Meet, Teams and any other app", gs.map((x) => x.app).join() === "discord,zoom,meet,teams,other");
  check("every card: microphone = Voicemeeter Out B1, speaker = the device Dayspring listens to", gs.every((x) => x.microphone === dev.callMic && x.speaker === "Headphones (Other Headset)" && /Dayspring listens to Headphones \(Other Headset\)/.test(x.speakerWhy)));
  check("every card says where the setting is", /Settings \(⚙\) → Audio/.test(gs[1].where) && /Voice & Video/.test(gs[0].where) && /Settings → Audio/.test(gs[2].where) && /Devices/.test(gs[3].where));
  check("Zoom: turn off auto mic volume; Discord: noise suppression and auto sensitivity", /Automatically adjust microphone volume/.test(gs[1].extras.join()) && /Krisp/.test(gs[0].extras.join()) && /input sensitivity/.test(gs[0].extras.join()));
  apps._setDevices(async () => ({ capture: [{ name: "Microphone (Test Headset)", default: true }], playback: [{ name: "Speakers (Test Headset)", default: true }] }));
  const none = await apps.devices({ fresh: true });
  check("no Voicemeeter: it says so (and still names the device to pick)", none.voicemeeterInstalled === false && /Voicemeeter/.test(apps.spokenAnswer("zoom", none, null)));
  apps._setDevices(null);
  check("setup questions are recognised", ["what mic should Zoom use", "how do I set up google meet for you", "which speaker should teams use", "what input does discord need"].every(apps.isSetupQuestion) && !apps.isSetupQuestion("zoom in on the map") && !apps.isSetupQuestion("what's the weather"));
  // the Test button's listening check, with a pretend capture
  const cap = async ({ device, onPcm }) => { setTimeout(() => onPcm(/voicemeeter/i.test(device) ? vad.synthSpeech(300) : vad.synthSilence(300)), 20); return { device, stop() {} }; };
  const sc = await apps.selfCheck({ ms: 120, voiceTo: "Voicemeeter Input (VB-Audio Voicemeeter VAIO)", listening: "Speakers (Test Headset)", capture: cap });
  check("Test: hears the test phrase reach the call mixer", sc.voice.ok && !sc.listening.ok, JSON.stringify({ v: sc.voice.peak, l: sc.listening.peak }));
}

console.log("\n— privacy —");
{
  latency._reset(); const lines = existsSync(process.env.DS_CALL_LATENCY_LOG) ? readFileSync(process.env.DS_CALL_LATENCY_LOG, "utf8").split("\n").length : 0;
  const tr = latency.begin({ via: "tunein" }); tr.mark("stt"); tr.cancel();
  await sleep(10);
  const after = existsSync(process.env.DS_CALL_LATENCY_LOG) ? readFileSync(process.env.DS_CALL_LATENCY_LOG, "utf8").split("\n").length : 0;
  check("speech that wasn't for Dayspring leaves no timing record", latency.last().length === 0 && after === lines);
  const src = readFileSync(new URL("../../lib/tunein.mjs", import.meta.url), "utf8");
  check("Tune in logs only requests made to Dayspring (one devlog, after the name)", (src.match(/devlog\.log\(/g) ?? []).length === 2 && /not for Dayspring: dropped, never stored/.test(src));
  check("Tune in shows it's listening (“Listening in this call”)", /Listening in this call/.test(readFileSync(new URL("../../public/callbridge.js", import.meta.url), "utf8")));
}

// ---- before / after ----------------------------------------------------------------------------------------------------
// The same answer through the old path and the new one, with component timings: measured on this PC with --live,
// otherwise typical figures (noted). Old: 700 ms quiet → tiny + base passes → the full answer from the main model →
// the whole voice file → play. New: 450 ms quiet → tiny (base only when unclear) → the quick model, streamed → the
// first sentence's voice, streamed → play.
console.log("\n— speed: before and after —");
let comp = { tiny: 200, base: 450, tinyOld: 700, baseOld: 1500, fullLlm: 2600, firstSentence: 650, ttsFull: 1100, ttsFirstByte: 280, play: 80, source: "typical figures (run with --live to measure this PC)" };
if (LIVE) comp = await measureLive(comp);
const hang = globalThis.__hang ?? { oldMs: 700, newMs: 450 };
const before = hang.oldMs + (comp.tinyOld ?? comp.tiny * 3) + (comp.baseOld ?? comp.base * 3) + comp.fullLlm + comp.ttsFull + comp.play;
// the head start: the fast speech pass begins 240 ms into the pause, so only what's left of it after the pause counts
const tinyLeft = Math.max(0, comp.tiny - (hang.newMs - 240));
const afterAi = hang.newMs + tinyLeft + comp.firstSentence + comp.ttsFirstByte + comp.play;
const afterOffline = hang.newMs + tinyLeft + 5 + comp.ttsFirstByte + comp.play;
console.log(`      components: ${JSON.stringify(comp)}`);
console.log(`      before: ${before} ms   after (AI): ${afterAi} ms   after (no AI): ${afterOffline} ms`);
if (LIVE) {
  check("end of speech → first sound with AI is under 1.5 s (measured)", afterAi <= 1500, `${afterAi} ms`);
  check("…and without AI under 0.8 s (measured)", afterOffline <= 800, `${afterOffline} ms`);
} else console.log(`      (targets: 1500 ms with AI, 800 ms without; checked with --live)`);

async function measureLive(base) {
  const out = { ...base, source: "measured on this PC" };
  const stt = await import("../../lib/stt.mjs");
  const phrase = await sapi("Dayspring, what's the capital of Australia?");
  if (stt.ready().ok && phrase) {
    await stt.transcribe(phrase, { speed: "fast" }); await stt.transcribe(phrase, {});   // warm
    const med = async (o) => { const xs = []; for (let i = 0; i < 3; i++) { const t = Date.now(); await stt.transcribe(phrase, o); xs.push(Date.now() - t); } return xs.sort((p, q) => p - q)[1]; };
    const ft = await stt.transcribe(phrase, { speed: "fast" });
    out.tiny = await med({ speed: "fast" }); out.base = await med({});
    out.tinyOld = await med({ speed: "fast", fit: false }); out.baseOld = await med({ fit: false });   // before: the whole 30 s window
    console.log(`      whisper tiny heard: ${JSON.stringify(ft.text)}`);
  } else console.log("      (speech-to-text isn't installed: typical figures used)");
  const llm = await import("../../lib/llm.mjs");
  if (llm.ready()) try {
    // each after 6 s of quiet (as between real questions, when idle connections have closed): the old way cold, the
    // new way with the connection opened ~250 ms earlier (it's opened while the question is still being transcribed)
    const sys = "Answer out loud in one or two short, warm sentences.", q = "Heard: what's the capital of Australia\nYour answer:";
    const mid = (xs) => xs.sort((p1, p2) => p1 - p2)[Math.floor(xs.length / 2)];
    const olds = [], news = [];
    streamLlm._resetFast(); const fm = await streamLlm.fastModel();
    for (let i = 0; i < 3; i++) {
      await sleep(6000); const a = Date.now(); await llm.complete({ system: sys, prompt: q, maxTokens: 220 }); olds.push(Date.now() - a);
      await sleep(6000); warmMod.warm(); await sleep(250);
      const b = Date.now(); let first = null;
      const sp = createSplitter({ onSentence: () => { first ??= Date.now() - b; } });
      for await (const piece of streamLlm.streamText({ system: sys, prompt: q, model: fm })) sp.push(piece);
      sp.flush(); news.push(first);
    }
    out.fullLlm = mid(olds); out.firstSentence = mid(news); out.fastModel = fm; out.mainModel = llm.modelName();
  } catch (e) { out.aiError = String(e.message).slice(0, 120); console.log("      (the AI didn't answer: typical AI figures used)"); }
  else console.log("      (no AI key: typical AI figures used)");
  const voice = await import("../../lib/voice.mjs");
  if (voice.ttsProvider() !== "browser") try {
    const text = "Canberra is the capital of Australia.";
    await sleep(6000); const a = Date.now(); await voice.tts(text + " Lots of people guess Sydney.", {}); out.ttsFull = Date.now() - a;
    const tts = await import("../../lib/calls/tts-stream.mjs"); tts._reset();
    await sleep(6000); warmMod.warm(); await sleep(600);   // opened when the answer started, ~0.6 s before its first sentence
    const b = Date.now(); const r = await tts.openStream(text); const rd = r.stream.getReader(); await rd.read(); out.ttsFirstByte = Date.now() - b; out.ttsModel = r.model; rd.cancel().catch(() => {});
  } catch (e) { out.voiceError = String(e.message).slice(0, 120); console.log("      (the voice didn't answer: typical voice figures used)"); }
  else console.log("      (browser voice: typical voice figures used)");
  return out;
}
async function sapi(text) {
  const { execFile } = await import("node:child_process");
  const f = join(TMP, "phrase.wav");
  const ps = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile($env:DS_WAV, $fmt); $s.Speak($env:DS_TEXT); $s.Dispose()";
  await new Promise((ok) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, DS_WAV: f, DS_TEXT: text }, windowsHide: true, timeout: 30_000 }, () => ok()));
  if (!existsSync(f)) return null;
  const b = readFileSync(f); const at = b.indexOf("data") + 8;
  return new Int16Array(b.buffer.slice(b.byteOffset + at, b.byteOffset + b.length - ((b.length - at) % 2)));
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail ? `${fail} FAILED` : "All passed"}`);
process.exit(fail ? 1 : 0);
