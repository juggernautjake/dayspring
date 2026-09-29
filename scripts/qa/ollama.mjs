// Dayspring with a local model (Ollama), end to end, against a pretend Ollama (scripts/qa/ollama-mock.mjs) and a pretend
// Anthropic: no real model is ever run, nothing is pulled, and the owner's live Dayspring, data and .env are never touched.
//   A. in this process: picking tools for 100+ phrasings, dates and times in arguments, the reply filter (no code talk),
//      "is Ollama really there" (not installed / installed but not running / running / remote / uninstalled), text,
//      long documents, pictures, streaming, warm-up, speed, fallbacks, the Claude key checks, No AI making no model calls
//   B. a throwaway copy of Dayspring (port 4796) on the pretend Ollama: the tool loop through /api/chat, tool calls
//      written as text, argument repair, the confirmation rule, fallbacks, the AI switch (providers, models, voice,
//      restart), the Claude key in Settings, and Settings → AI brain + the screen's ⋯ menu in headless Chrome
//   node scripts/qa/ollama.mjs [--keep] [--only A|B] [--live]   (--live: also a small sample on a real, installed Ollama)
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMock } from "./ollama-mock.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep"), LIVE = argv.includes("--live");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const TMP = mkdtempSync(join(tmpdir(), "ds-ollama-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const failed = [];
const check = (name, ok, got = "") => { if (ok) pass++; else { fail++; failed.push(name); } console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 260) + ")" : ""}`); };
const T0 = Date.now();

// ---- a pretend Anthropic: the answer depends on the key's last word ----------------------------------------------------
const anthropicHits = [];
const anth = createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const key = String(req.headers["x-api-key"] ?? "");
  anthropicHits.push({ path: req.url, key: key.slice(-8), model: body.model });
  const j = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const e = (code, type, message) => j(code, { type: "error", error: { type, message } });
  if (/invalid$/.test(key)) return e(401, "authentication_error", "invalid x-api-key");
  if (/credit$/.test(key)) return e(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.");
  if (/perm$/.test(key)) return e(403, "permission_error", "Your API key does not have permission to use the specified resource.");
  if (/busy$/.test(key)) return e(529, "overloaded_error", "Overloaded");
  if (/rate$/.test(key)) return e(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit");
  if (body.model === "claude-nope") return e(404, "not_found_error", "model: claude-nope");
  return j(200, { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "Claude here: happy to help." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } });
});
await new Promise((r) => anth.listen(0, "127.0.0.1", r));
const ANTH = `http://127.0.0.1:${anth.address().port}`;
const KEY = (end) => `sk-ant-api03-${"x".repeat(48)}-${end}`;

let mock = await startMock();
// in this process: a local model on the pretend Ollama, and a throwaway .env (never the real one)
Object.assign(process.env, { DAYSPRING_NO_ECO: "1", DAYSPRING_NO_BROWSER: "1", DAYSPRING_ENV_FILE: join(TMP, "test.env"), AI_PROVIDER: "ollama", AI_MODEL: "qwen2.5:3b", OLLAMA_URL: mock.url,
  OLLAMA_EMBED_MODEL: "off", DAYSPRING_OLLAMA_NO_SYSTEM: "1", ANTHROPIC_BASE_URL: ANTH, OLLAMA_FIRST_TOKEN_S: "8" });
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "OLLAMA_FALLBACK", "OLLAMA_CHAT_MODEL", "OLLAMA_VISION_MODEL", "AI_AUTO_MODEL", "DAYSPRING_MODEL"]) delete process.env[k];
writeFileSync(process.env.DAYSPRING_ENV_FILE, "# test\n");
const L = (m) => import(pathToFileURL(join(DESK, "lib", m)).href);

try {
if (!ONLY || ONLY === "A") {
  const llm = await L("llm.mjs");
  const assistant = await L("assistant.mjs");
  const { selectFor } = await L("ollama/tools.mjs");
  const { normalizeFor, toHM, toISODate } = await L("ollama/args.mjs");
  const { cleanReply } = await L("ollama/speak.mjs");
  const status = await L("ollama/status.mjs");
  const local = await L("ollama/index.mjs");
  const sw = await L("ai-switch.mjs");
  const ck = await L("claude-key.mjs");

  // ---------------- A1. picking tools: the right one in the ~10 offered, for 100+ phrasings ----------------
  const tools = assistant.offeredTools();
  const have = new Set(tools.map((t) => t.name));
  const CASES = [
    ["what's on my schedule today", "get_agenda"], ["what do I have tomorrow", "get_agenda"], ["what's on this week", "get_agenda"], ["when is my dentist appointment", "get_agenda"], ["what's next today", "get_agenda"],
    ["what does friday look like", "get_agenda"], ["am I busy saturday afternoon", "get_agenda"], ["give me a rundown of my day", "get_rundown"], ["how does my day look", "get_rundown"],
    ["add dentist friday at 3", "add_block"], ["put a meeting with Sam on my calendar tomorrow at 10", "add_block"], ["schedule gym at 6 tomorrow morning", "add_block"], ["book a haircut on saturday at noon", "add_block"],
    ["move gym to 4", "update_block"], ["reschedule the dentist to next week", "update_block"], ["push my study block back an hour", "update_block"], ["cancel the meeting with Sam", "remove_block"], ["delete the haircut from my schedule", "remove_block"],
    ["find me an hour free this afternoon", "find_free_slots"], ["when am I free tomorrow", "find_free_slots"], ["mark the gym block done", "set_block_done"],
    ["remind me to drink water at 11pm", "set_reminder"], ["remind me to call mom at 5", "set_reminder"], ["remind me tomorrow at 6 to take out the trash", "set_reminder"], ["don't let me forget the laundry at 7:30 tonight", "set_reminder"],
    ["set a reminder to stretch in the afternoon", "set_reminder"], ["what reminders do I have", "list_reminders"], ["cancel my reminder about the trash", "cancel_reminder"],
    ["play some Hillsong on Spotify", "play_spotify"], ["play Oceans by Hillsong", "play_spotify"], ["put on my Road Trip playlist", "play_spotify"], ["play some jazz music", "play_spotify"], ["shuffle my liked songs", "play_spotify"],
    ["play the album Graceland", "play_spotify"], ["pause the music", "media_control"], ["skip this song", "media_control"], ["turn the music volume down", "media_control"], ["stop the music", "stop_media"], ["what song is this", "media_status"],
    ["play a video about sharpening chisels", "video_find"], ["find a youtube video on sourdough bread", "video_find"], ["play the latest Mike Winger video", "video_find"], ["queue three videos about woodworking", "video_find"],
    ["open my watch later playlist on youtube", "youtube_account_playlists"], ["show me youtube videos about fly fishing", "video_find"],
    ["who won the Royals game last night", "web_search"], ["search the web for the best budget laptops", "web_search"], ["look up the hours for Home Depot", "web_search"], ["how tall is the Eiffel tower", "web_search"],
    ["what's the weather tomorrow", "web_search"], ["will it rain this weekend", "web_search"], ["what's the latest news", "news_latest"], ["latest tech headlines", "news_latest"], ["read this page https://example.com/article", "read_web_page"],
    ["find a recipe for chicken pot pie online", "web_search"], ["what time does Walmart close", "web_search"], ["directions to the nearest gas station", "web_search"],
    ["show me pictures of golden retrievers", "image_search"], ["find a picture of the Grand Canyon", "image_search"], ["show me a gif of a dancing cat", "gif_search"], ["find a funny gif", "gif_search"],
    ["find my resume", "find_files"], ["open my tax return folder", "find_files"], ["read my notes about the kitchen remodel", "find_files"], ["save a note with these spanish verbs", "write_note"], ["write a study sheet for chapter 3", "write_note"],
    ["email Sam that I'm running late", "email_draft"], ["check my email", "email_search"], ["any emails from my boss", "email_search"], ["read the latest email from Amazon", "email_search"], ["reply to Sarah's email", "email_draft"],
    ["read Romans 8:28", "get_scripture"], ["read me Psalm 23", "get_scripture"], ["find the verse about faith as a mustard seed", "search_scripture"], ["what's on my prayer list", "prayer_list"], ["add Mike to my prayer list", "prayer_add"],
    ["what's my next lesson", "get_learning_progress"], ["I finished lesson 3 of the Python course", "study_check"], ["open my next course lesson", "study_open"],
    ["talk slower", "set_voice_style"], ["give me simpler answers", "set_voice_style"], ["go silent for an hour", "set_notifications"], ["play sounds through the headphones", "set_notifications"], ["make it rain on the screen", "sky_set"],
    ["set up Spotify", "media_login"], ["connect YouTube", "media_login"], ["how do I snooze the alarm", "help_guide"], ["my screen is cut off on the TV, help", "help_guide"], ["what apps are connected", "connections_status"],
    ["remember that I like dark roast coffee", "remember"], ["add buy milk to my tasks", "add_task"], ["mark the milk task done", "set_task_done"], ["take a note that the plumber comes monday", "log_note"],
    ["what did we talk about yesterday", "search_conversations"], ["what did I say about the car earlier", "search_conversations"],
    ["open Microsoft Word", "open_program"], ["close Notepad", "close_program"], ["start claude code in my dayspring project", "launch_claude_code"],
    ["what are my goals", "list_goals"], ["what chores need doing", "list_chores"], ["I finished the dishes chore", "chore_done"],
    ["turn off the fan", "device_control"], ["turn the living room lights on", "device_control"], ["is the heater on", "device_status"],
    ["how's printer 2 doing", "printer_status"], ["show me the front camera", "camera_show"], ["what's my spending this month", "money_query"],
    ["play my own music from my computer", "media_library_play"], ["find the song Amazing Grace in my music library", "media_library_search"],
    ["show me something new about woodworking", "discover_now"], ["describe this picture", "describe_image"], ["who is in this photo", "who_is_in_photo"],
    ["write an email to Grandma about Thanksgiving", "email_draft"], ["what's playing right now", "media_status"], ["search youtube for bluegrass", "video_find"], ["play hymns on youtube", "video_find"],
  ];
  let hit = 0, tried = 0, skipped = 0; const misses = [];
  const tSel = Date.now();
  for (const [q, want] of CASES) {
    if (!have.has(want)) { skipped++; continue; }
    tried++;
    const r = await selectFor(q, [], tools, { n: 10 });
    if (r.names.includes(want)) hit++; else misses.push(`${q} → wanted ${want}, got ${r.names.slice(0, 6).join(",")}`);
  }
  const selMs = Math.round((Date.now() - tSel) / Math.max(1, tried));
  console.log(`      tool picking: ${hit}/${tried} right (${skipped} phrasings skipped: that tool isn't offered here), ${selMs} ms each, ${tools.length} tools in all`);
  for (const m of misses) console.log(`      miss: ${m}`);
  check(`tool picking: the right tool among ~10 for ${tried} phrasings (≥ 97%)`, tried >= 100 && hit / tried >= 0.97, `${hit}/${tried}`);
  { const r = await selectFor("hi there", [], tools, { n: 10 }); check("tool picking: the schedule reader is always offered, and never more than N tools", r.names.includes("get_agenda") && r.names.length <= 10, r.names.join(",")); }
  { const hist = [{ role: "user", content: "play some jazz on spotify" }, { role: "assistant", content: [{ type: "tool_use", id: "1", name: "play_spotify", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "{}" }] }, { role: "assistant", content: "Playing jazz." }];
    const r = await selectFor("not that one", hist, tools, { n: 10 }); check("tool picking: \"not that one\" still reaches the tool used just before", r.names.includes("play_spotify"), r.names.join(",")); }

  // ---------------- A2. dates and times in arguments; one reminder, never a repeating one ----------------
  const now = new Date(2026, 8, 28, 14, 5);   // Monday 28 Sept 2026, 2:05 p.m.
  const RS = { type: "object", properties: { text: { type: "string" }, date: { type: "string" }, time: { type: "string" }, block_id: { type: "string" } } };
  check("args: \"11pm\" → 23:00 today (still ahead)", JSON.stringify(normalizeFor("set_reminder", { text: "drink water", time: "11pm" }, RS, now)) === JSON.stringify({ text: "drink water", time: "23:00", date: "2026-09-28" }));
  check("args: \"7:30 tonight\" → 19:30 today", normalizeFor("set_reminder", { text: "x", time: "7:30 tonight" }, RS, now).time === "19:30");
  check("args: a time that has passed today → tomorrow", normalizeFor("set_reminder", { text: "x", time: "9am" }, RS, now).date === "2026-09-29");
  check("args: \"tomorrow at 6pm\" in the time → the date and 18:00", (() => { const v = normalizeFor("set_reminder", { text: "x", time: "tomorrow at 6pm" }, RS, now); return v.time === "18:00" && v.date === "2026-09-29"; })());
  check("args: \"friday\" → the coming Friday; \"2026-10-2\" padded", toISODate("friday", now) === "2026-10-02" && toISODate("2026-10-2", now) === "2026-10-02" && toISODate("next monday", now) === "2026-10-05");
  check("args: noon, midnight, 12am, 3 p.m.", toHM("noon") === "12:00" && toHM("midnight") === "00:00" && toHM("12am") === "00:00" && toHM("3 p.m.") === "15:00");
  { const AB = tools.find((t) => t.name === "add_block")?.input_schema; const v = normalizeFor("add_block", { title: "Dentist", date: "friday", start: "3pm" }, AB, now); check("args: add_block gets an ISO date, 15:00 and an hour-long end", v.date === "2026-10-02" && v.start === "15:00" && v.end === "16:00", v); }
  { const { repairArgs } = await import(pathToFileURL(join(DESK, "vendor", "ecosystem-core", "lib", "llm-local.mjs")).href);
    const SR = tools.find((t) => t.name === "set_reminder").input_schema;
    const r = repairArgs(SR, { reminder_text: "drink water", time: "11pm", minutesBefore: "15" });
    check("args: repair maps near-miss names and numbers, and adds no repeat", r.value.minutes_before === 15 && !("every" in r.value) && !("repeat" in r.value), r); }
  check("args: no reminder schema makes repeating the default", !JSON.stringify(tools.find((t) => t.name === "set_reminder").input_schema).match(/"default"\s*:\s*"?(hourly|every|daily)/i));

  // ---------------- A3. never talking about code ----------------
  const names = [...have];
  const LEAK = /play_spotify|set_reminder|JSON|ECONNREFUSED|\.mjs|TypeError|stack|undefined|tool call|confirm_token/i;
  const fixtures = [
    ["I'll use play_spotify to start that. Playing Hillsong now.", [], /Playing Hillsong/],
    ["I called set_reminder with {\"time\":\"23:00\"}. Okay, I'll remind you at 11 tonight.", [], /remind you at 11/],
    ["Error: fetch failed ECONNREFUSED 127.0.0.1:443 at lib/music/index.mjs:42", [{ name: "play_spotify", error: "fetch failed" }], /Spotify.*YouTube/],
    ["TypeError: Cannot read properties of undefined (reading 'id')\n    at run (file:///C:/x/lib/assistant.mjs:12:3)", [{ name: "add_block", error: "boom" }], /schedule/],
    ["```json\n{\"name\":\"web_search\",\"arguments\":{\"query\":\"x\"}}\n```\nThe Royals won 5 to 3.", [], /Royals won/],
    ["**Done!** The dentist is on *Friday* at 3 p.m.", [], /^Done! The dentist is on Friday at 3 p\.m\.$/],
    ["⟪mood:happy⟫ I used the tool called get_agenda. You have gym at 7.", [], /^⟪mood:happy⟫ You have gym at 7\.$/],
  ];
  for (const [text, failed, want] of fixtures) { const out = cleanReply(text, { toolNames: names, failed }); check(`no code talk: "${text.slice(0, 44).replace(/\n/g, " ")}…" → "${out.slice(0, 60)}"`, want.test(out) && !LEAK.test(out.replace(/^⟪mood:happy⟫/, "")), out); }
  check("no code talk: ordinary words stay (arguments, tools, a file he named)", cleanReply("That's a strong argument. A chisel is a handy tool. Your resume.docx is in Documents.", { toolNames: names }) === "That's a strong argument. A chisel is a handy tool. Your resume.docx is in Documents.");

  // ---------------- A4. is Ollama really there? ----------------
  status._reset();
  let s = await status.status({ force: true });
  check("status: running (the pretend server answers /api/version)", s.state === "running" && s.version === "0.12.3", s);
  const savedUrl = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = "http://127.0.0.1:9";
  s = await status.status({ force: true });
  check("status: not installed (no ollama.exe, nothing answers)", s.state === "not-installed" && !s.running, s);
  check("status: after that, requests aren't tried for a minute", status.usable() === false);
  const fakeExe = join(TMP, "ollama.exe"); writeFileSync(fakeExe, "");
  process.env.DAYSPRING_OLLAMA_EXE = fakeExe;
  s = await status.status({ force: true });
  check("status: installed but not running (ollama.exe there, server down) → offers Start", s.state === "not-running" && s.exe === fakeExe, s);
  process.env.DAYSPRING_OLLAMA_EXE = join(TMP, "gone.exe");   // uninstalled since it was configured
  s = await status.status({ force: true });
  check("status: uninstalled after being configured (provider still says ollama) → not installed", s.state === "not-installed" && llm.provider() === "ollama", s);
  delete process.env.DAYSPRING_OLLAMA_EXE;
  process.env.OLLAMA_URL = "http://192.0.2.1:11434";   // a home server that isn't there (TEST-NET: never routed)
  s = await status.status({ force: true });
  check("status: a remote address counts only when it answers", s.remote && s.state === "unreachable" && !s.running, s);
  process.env.OLLAMA_URL = mock.url.replace("127.0.0.1", "localhost");
  s = await status.status({ force: true });
  check("status: running at another address form (localhost)", s.state === "running", s);
  process.env.OLLAMA_URL = savedUrl; status._reset();
  { const t = Date.now(); const a = await status.status(); const b = await status.status(); check("status: kept at most 10 s (a second ask is instant)", a === b && Date.now() - t < 1600); }

  // ---------------- A5. text, long documents, pictures, streaming, warm-up, speed ----------------
  mock.reset(); llm._resetSpeed();
  const txt = await llm.complete({ system: "S", prompt: "Reply with exactly: ready", maxTokens: 10 });
  const c0 = mock.chats().at(-1)?.body;
  check("complete(): native /api/chat with keep_alive and the context size", txt === "ready" && c0?.keep_alive === "30m" && c0?.options?.num_ctx === 4096 && c0?.stream === false, c0);
  process.env.OLLAMA_KEEP_ALIVE = "-1"; await llm.complete({ prompt: "Reply with exactly: ready" }); check("keep loaded \"always\" → keep_alive -1", mock.chats().at(-1).body.keep_alive === -1); delete process.env.OLLAMA_KEEP_ALIVE;
  { const long = "Summarize this report in five sentences.\n\n" + Array.from({ length: 6 }, (_, i) => `Section MARKER-${i + 1}. ` + "Lorem ipsum dolor sit amet. ".repeat(420)).join("\n\n");
    const n0 = mock.chats().length; const out = await llm.complete({ prompt: long, maxTokens: 300 });
    const calls = mock.chats().length - n0;
    check(`long documents: read in parts, then one answer (${calls} requests)`, calls >= 3 && /MARKER-1/.test(out) && /MARKER-6/.test(out) && mock.chats().slice(n0).every((c) => c.body.options.num_ctx <= 8192), out); }
  process.env.OLLAMA_VISION_MODEL = "llava:7b";
  check("pictures: a vision model makes supportsImages() true", llm.supportsImages());
  { const d = await llm.completeWithImage({ prompt: "What's this?", image: { data: Buffer.from("x").toString("base64") } }); const b = mock.chats().at(-1).body; check("pictures: sent to the vision model with the image", /golden retriever/.test(d) && b.model === "llava:7b" && b.messages.at(-1).images?.length === 1, b.model); }
  delete process.env.OLLAMA_VISION_MODEL; llm.noteVisionModels([]);
  check("pictures: without a vision model, the local AI says it can't look (no Claude fallback chosen)", !llm.supportsImages());
  { const { streamText } = await L("calls/stream-llm.mjs"); const t = Date.now(); let first = null, text = "";
    for await (const p of streamText({ system: "You are on a call.", prompt: "Heard: capital of France?\nYour answer:" })) { if (first == null) first = Date.now() - t; text += p; }
    const b = mock.chats().at(-1).body;
    check("streaming (calls, meetings): words arrive in pieces through /api/chat, model kept loaded", /Paris/.test(text) && b.stream === true && b.keep_alive === "30m" && first != null && first < Date.now() - t, { first, text }); }
  { const { reply } = await L("calls/pipeline.mjs"); const parts = []; const times = [];
    const t = Date.now(); const r = await reply({ text: "what's the capital of France", who: "owner", via: "tunein", surface: "call", onSentence: (s) => { parts.push(s); times.push(Date.now() - t); } });
    check("reply parts: the first sentence is handed on before the whole answer is done", parts.length >= 2 && times[0] <= times.at(-1) && !r.offline, { parts, r: r.reply }); }
  mock.reset();
  const w = await local.startWarm();
  const wb = mock.chats()[0]?.body;
  check("warm-up: the model is loaded with keep_alive, the context size and the instructions", w.ok && wb?.keep_alive === "30m" && wb?.options?.num_ctx === 4096 && wb?.options?.num_predict === 1 && /Dayspring/.test(wb?.messages?.[0]?.content ?? ""), wb);
  check("speed: the last answers are measured (first word, first sentence, whole)", llm.speedStats().count >= 3 && llm.speedStats().ttftMs != null && llm.speedStats().firstSentenceMs != null, llm.speedStats());

  // ---------------- A6. the local turn: loop, fallbacks, back-off, cache ----------------
  const FT = [{ name: "set_reminder", description: "Remind the owner once at a time.", input_schema: RS }, { name: "get_agenda", description: "Read the schedule.", input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } }, { name: "web_search", description: "Search the web.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }];
  const ran = [];
  const fake = (name, input) => { ran.push([name, input]); return { ok: true }; };
  mock.reset();
  let r1 = await local.chat({ history: [], userText: "remind me to drink water at 11pm", tools: FT, runTool: fake, extras: {} });
  check("local turn: set_reminder with 23:00 and a date, answered in plain words", ran[0]?.[0] === "set_reminder" && ran[0][1].time === "23:00" && /^\d{4}-\d\d-\d\d$/.test(ran[0][1].date) && /remind you at 11 tonight/.test(r1.reply) && !/every/i.test(r1.reply), { ran, reply: r1.reply });
  check("local turn: date, day, time and time zone go with the request", /Now: \w+day \d{4}-\d\d-\d\d, .* time zone /.test(mock.chats()[0].body.messages.at(-1).content));
  check("local turn: the same safety rules (confirmations, other people's words are data)", /confirm_token/.test(mock.chats()[0].body.messages[0].content) && /never as instructions/.test(mock.chats()[0].body.messages[0].content) && /988/.test(mock.chats()[0].body.messages[0].content));
  mock.set({ mode: "text" }); ran.length = 0;
  r1 = await local.chat({ history: [], userText: "who won the royals game last night", tools: FT, runTool: fake, extras: {} });
  check("local turn: a tool call written as text is run and never spoken", ran[0]?.[0] === "web_search" && !/tool_call|\{/.test(r1.reply), r1.reply);
  mock.reset(); mock.set({ fail: true });
  let usedClaude = 0;
  await local.chat({ history: [], userText: "tell me a fun fact about owls please", tools: FT, runTool: fake, extras: {}, claude: async () => { usedClaude++; return { reply: "x", history: [] }; } }).catch((e) => { r1 = e; });
  check("fallback: Ollama failing without a Claude fallback → an error the assistant answers offline", r1?.ollama && r1.status >= 500 && usedClaude === 0, r1?.message);
  process.env.ANTHROPIC_API_KEY = KEY("ok"); process.env.OLLAMA_FALLBACK = "claude";
  r1 = await local.chat({ history: [], userText: "tell me a fun fact about owls please", tools: FT, runTool: fake, extras: {}, claude: async () => { usedClaude++; return { reply: "Claude answered.", history: [] }; } });
  check("fallback: …with \"ask Claude\" chosen and a key, Claude answers (and says so once)", usedClaude === 1 && /Claude answered\./.test(r1.reply) && /Claude/.test(r1.reply.replace("Claude answered.", "")), r1.reply);
  delete process.env.OLLAMA_FALLBACK;
  mock.reset(); mock.set({ firstDelayMs: 1500 }); process.env.OLLAMA_FIRST_TOKEN_S = "1";
  { const t = Date.now(); let e = null; await local.chat({ history: [], userText: "how are you", tools: FT, runTool: fake, extras: {} }).catch((x) => { e = x; });
    check("fallback: no first word within the limit → gives up fast", e?.code === "EFIRSTTOKEN" && Date.now() - t < 1500, { code: e?.code, ms: Date.now() - t }); }
  process.env.OLLAMA_FIRST_TOKEN_S = "8"; mock.reset();
  { const saveUrl = process.env.OLLAMA_URL; process.env.OLLAMA_URL = "http://127.0.0.1:9"; status._reset();
    await local.chat({ history: [], userText: "how are you", tools: FT, runTool: fake, extras: {} }).catch(() => {});
    const n = mock.requests.length; const t = Date.now();
    let e = null; await local.chat({ history: [], userText: "how are you", tools: FT, runTool: fake, extras: {} }).catch((x) => { e = x; });
    check("back-off: once Ollama was down, the next request doesn't try it again (answers at once)", e?.code === "EOLLAMA_DOWN" && Date.now() - t < 100 && mock.requests.length === n, { code: e?.code, ms: Date.now() - t });
    process.env.OLLAMA_URL = saveUrl; const s2 = await status.status({ force: true }); check("back-off: a fresh check (Settings opening) clears it", s2.running && status.usable()); }
  mock.reset(); local._cacheClear();
  await local.chat({ history: [], userText: "tell me a fun fact about owls", tools: FT, runTool: fake, extras: {} });
  const n1 = mock.chats().length; const t1 = Date.now();
  const r2 = await local.chat({ history: [], userText: "Tell me a fun fact about owls!", tools: FT, runTool: fake, extras: {} });
  check("cache: the same question again is answered at once, with no model call", mock.chats().length === n1 && Date.now() - t1 < 50 && /270 degrees/.test(r2.reply));
  mock.reset(); mock.set({ noTools: true }); ran.length = 0;
  r1 = await local.chat({ history: [], userText: "remind me to drink water at 11pm", tools: FT, runTool: fake, extras: {} });
  check("a model without tool support: the tools go in its instructions, and the call still works", ran[0]?.[0] === "set_reminder", { ran, reply: r1.reply });
  mock.reset();

  // ---------------- A7. switching: providers, models, voice, Pick for me ----------------
  delete process.env.ANTHROPIC_API_KEY;
  let o = await sw.options({ fresh: true });
  check("switch: options show Ollama (running) and No AI; Claude needs a key", o.options.find((x) => x.id === "ollama").available && o.options.find((x) => x.id === "none").available && !o.options.find((x) => x.id === "anthropic").available && o.options.find((x) => x.id === "ollama").models.some((m) => m.id === "qwen2.5:3b"));
  check("voice: \"use opus\" without a key → says why", /no Claude key/.test(await sw.command("use opus")));
  check("voice: \"switch to mistral\" (not installed) → lists what is", /isn't available.*qwen2\.5:3b/.test(await sw.command("switch to mistral")), await sw.command("switch to mistral"));
  check("voice: \"switch to llava\" → that Ollama model, at once", /llava:7b/.test(await sw.command("switch to llava")) && llm.modelName() === "llava:7b");
  check("voice: \"use the fastest model\" → the smallest tool-capable one", /qwen2\.5:3b/.test(await sw.command("use the fastest model")) && llm.modelName() === "qwen2.5:3b");
  check("voice: \"what model are you using?\"", /Ollama.*qwen2\.5:3b/.test(await sw.command("what model are you using?")));
  process.env.ANTHROPIC_API_KEY = KEY("ok");
  check("voice: \"use opus\" with a key → Claude Opus 5.5", /Opus 5\.5/.test(await sw.command("use opus")) && llm.provider() === "anthropic" && llm.modelName() === "claude-opus-5-5");
  check("voice: \"switch to Haiku\"", /Haiku/.test(await sw.command("switch to haiku")) && llm.modelName() === "claude-haiku-4-5-20251001");
  check("voice: \"use ollama\" → back to the local model it had (each keeps its own)", /local AI/.test(await sw.command("use ollama")) && llm.provider() === "ollama" && llm.modelName() === "qwen2.5:3b");
  check("voice: \"switch to claude\" → the Claude model it had", /Claude/.test(await sw.command("switch to claude")) && llm.modelName() === "claude-haiku-4-5-20251001");
  process.env.AI_AUTO_MODEL = "1"; await sw.switchTo("anthropic", { model: "claude-sonnet-5" });
  check("Pick for me: a quick command → Haiku; writing → the chosen model", llm.autoModel("what time is it in Tokyo") === "claude-haiku-4-5-20251001" && llm.autoModel("write a thank-you letter to Grandma for the sweater") === null);
  check("Pick for me: the model is used for that request only", llm.withModel(llm.autoModel("turn on the fan"), () => llm.modelName()) === "claude-haiku-4-5-20251001" && llm.modelName() === "claude-sonnet-5");
  delete process.env.AI_AUTO_MODEL;
  check("voice: \"turn off the AI\" → No AI", /no AI/.test(await sw.command("turn off the AI")) && llm.provider() === "none");
  check("voice: \"which AI are you using?\" with No AI", /not using any AI/.test(await sw.command("which ai are you using")));
  check("switch: saved in .env (throwaway copy), each provider's model kept", /AI_PROVIDER=none/.test(readFileSync(process.env.DAYSPRING_ENV_FILE, "utf8")) && /AI_MODEL_ANTHROPIC=claude-sonnet-5/.test(readFileSync(process.env.DAYSPRING_ENV_FILE, "utf8")) && /AI_MODEL_OLLAMA=qwen2\.5:3b/.test(readFileSync(process.env.DAYSPRING_ENV_FILE, "utf8")));

  // ---------------- A8. No AI means no model calls at all ----------------
  mock.reset(); mock.set({ strictModelCalls: true }); anthropicHits.length = 0;
  let threw = 0;
  await llm.complete({ prompt: "hi" }).catch(() => threw++);
  await llm.completeWithImage({ prompt: "x", image: { data: "eA==" } }).catch(() => threw++);
  try { const { streamText } = await L("calls/stream-llm.mjs"); for await (const _ of streamText({ prompt: "x" })) { /* nothing */ } } catch { threw++; }
  const wn = await local.startWarm(); await llm.warmLocal();
  check("No AI: complete, pictures and streaming all refuse; no warm-up", threw === 3 && wn.skipped && !llm.supportsImages() && !llm.ready());
  check("No AI: zero model calls (Ollama and Claude)", mock.violations.length === 0 && anthropicHits.length === 0, { ollama: mock.violations, claude: anthropicHits });
  mock.reset();
  await sw.switchTo("ollama", { model: "qwen2.5:3b" });

  // ---------------- A9. the Claude key: cleaned, checked, explained ----------------
  check("key: pasted with spaces, quotes, a line break and ANTHROPIC_API_KEY= → cleaned", ck.cleanKey(`  ANTHROPIC_API_KEY="${KEY("ok")}"\r\n`).key === KEY("ok") && !ck.cleanKey(`  ANTHROPIC_API_KEY="${KEY("ok")}"\r\n`).error);
  check("key: an admin key is caught", /Admin key/.test(ck.cleanKey("sk-ant-admin01-" + "x".repeat(40)).error));
  check("key: an OpenAI key is caught", /OpenAI/.test(ck.cleanKey("sk-proj-" + "x".repeat(40)).error) && /OpenAI/.test(ck.cleanKey("sk-" + "x".repeat(40)).error));
  check("key: a Grok key is caught", /Grok/.test(ck.cleanKey("xai-" + "x".repeat(40)).error));
  check("key: not a key at all", /start with sk-ant-/.test(ck.cleanKey("hello").error));
  const T = async (k, m) => ck.testKey(k, m ? { model: m } : {});
  let t = await T(KEY("ok")); check("key test: works", t.ok && t.model === "claude-sonnet-5", t);
  t = await T(KEY("invalid")); check("key test: 401 → \"isn't valid… sk-ant-\", never saveable", !t.ok && t.code === "invalid" && /isn't valid/.test(t.text) && !t.saveable, t);
  t = await T(KEY("credit")); check("key test: no credit → Billing, with the link", !t.ok && t.code === "credit" && /Billing/.test(t.text) && /platform\.claude\.com/.test(t.text), t);
  t = await T(KEY("perm")); check("key test: 403 → not allowed, check the workspace", !t.ok && t.code === "permission" && /workspace/i.test(t.text), t);
  t = await T(KEY("busy")); check("key test: 529 → busy, temporary (can save anyway)", !t.ok && t.code === "busy" && t.temporary && t.saveable, t);
  t = await T(KEY("rate")); check("key test: 429 → busy, temporary", !t.ok && t.code === "busy" && t.temporary, t);
  t = await T(KEY("ok"), "claude-nope"); check("key test: a model that isn't there → tried again with the default, and says so", t.ok && t.usedDefault && t.model === "claude-sonnet-5" && /claude-nope/.test(t.text), t);
  { const b = process.env.ANTHROPIC_BASE_URL; process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9"; t = await T(KEY("ok")); process.env.ANTHROPIC_BASE_URL = b; check("key test: can't reach Anthropic → check the internet, temporary", !t.ok && t.code === "network" && t.temporary, t); }
  process.env.ANTHROPIC_API_KEY = KEY("ok");
  { const c = await ck.checkSaved(); check("check my Claude connection: the saved key, last 4 only, every step", c.ok && c.present && c.last4 === KEY("ok").slice(-4) && c.formatOk && c.reachable && c.creditOk && c.modelOk && typeof c.ms === "number", c); }
  check("voice: \"check my AI key\"", /works with claude-sonnet-5/.test(await sw.command("check my AI key")));
  delete process.env.ANTHROPIC_API_KEY;
}

// =========================================================================================== B. the whole app
if (!ONLY || ONLY === "B") {
  const PORT = await qaPort(4796), BASE = `http://127.0.0.1:${PORT}`, APP = join(TMP, "app");
  spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  const FILES = join(TMP, "files"); mkdirSync(FILES, { recursive: true }); writeFileSync(join(FILES, "notes.txt"), "old words");
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary", fileRoot: FILES }));
  writeFileSync(join(APP, "data", "permissions.json"), JSON.stringify({ files: "custom", entries: [{ path: FILES, kind: "folder", access: "readwrite", subfolders: true }], writeConfirm: "ask", allAccess: "read", can: { create: true, edit: true, move: true, delete: false }, programs: "off", browser: false, web: true, choiceMade: true }));
  // the AI settings live in the copy's own .env (so a switch survives a restart, as it does for him)
  writeFileSync(join(APP, ".env"), `AI_PROVIDER=ollama\r\nAI_MODEL=qwen2.5:3b\r\nOLLAMA_URL=${mock.url}\r\nOLLAMA_FIRST_TOKEN_S=2\r\nOLLAMA_EMBED_MODEL=off\r\n`);
  const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_REMINDER_CHANNEL: "off",
    DAYSPRING_OLLAMA_NO_SYSTEM: "1", ANTHROPIC_BASE_URL: ANTH, DAYSPRING_UPDATE_REPO: "" };
  for (const k of ["AI_PROVIDER", "AI_MODEL", "OLLAMA_URL", "OLLAMA_FIRST_TOKEN_S", "OLLAMA_EMBED_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "ELEVENLABS_API_KEY", "DAYSPRING_ENV_FILE", "AI_AUTO_MODEL", "OLLAMA_FALLBACK", "OLLAMA_KEEP_ALIVE", "OLLAMA_VISION_MODEL"]) delete env[k];
  let server = null, serverLog = "";
  const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  const start = async () => { server = spawn(process.execPath, ["--env-file-if-exists=.env", "server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d)); for (let i = 0; i < 80 && !(await up()); i++) await sleep(400); };
  const stop = async () => { if (!server) return; server.kill(); await new Promise((r) => server.once("exit", r)); server = null; for (let i = 0; i < 20 && (await up()); i++) await sleep(200); };
  const api = async (path, body, method = body === undefined ? "GET" : "POST") => { const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) }); return r.json(); };
  const chat = (message) => api("/chat", { message, surface: "desk", typed: true });
  mock.reset();
  await start();
  try {
    check("app: starts on the pretend Ollama", await up(), serverLog.slice(-300));
    await sleep(800);
    const warm = mock.chats().find((c) => c.body.options?.num_predict === 1);
    check("app: warms the model at start (keep_alive, context size, instructions)", warm && warm.body.keep_alive === "30m" && warm.body.options.num_ctx === 4096, mock.chats().map((c) => c.body.options));
    const since = () => { const n = mock.chats().length; return () => mock.chats().slice(n); };

    let s = since(), r = await chat("pencil in the dentist for friday at 3pm");
    let c = s();
    mock.set({ badArgs: true }); s = since(); r = await chat("add dentist friday at 3pm"); c = s(); mock.set({ badArgs: false });
    const blocks = await api(`/agenda?from=2026-01-01&to=2027-12-31`);
    const dentist = (blocks.blocks ?? []).find((b) => /dentist/i.test(b.title) && b.start === "15:00");
    check("app: \"add dentist friday at 3pm\" → on the schedule at 15:00 (by the model or the built-in commands)", Boolean(dentist), { reply: r.reply, calls: c.length });
    if (c.length) check("app: bad arguments went back once with the error, then the fixed call ran", c.some((x) => /weren't right/.test(JSON.stringify(x.body.messages))) && /Friday at 3/.test(r.reply), r.reply);

    s = since(); r = await chat("remind me to drink water at 11pm"); c = s();
    check("app: \"remind me to drink water at 11pm\" is one reminder at 11 p.m., never hourly", !/every|hour/i.test(r.reply) && /11/.test(r.reply), r.reply);

    s = since(); r = await chat("tell me a fun fact about owls"); c = s();
    const offered = c[0]?.body?.tools?.map((t) => t.function.name) ?? [];
    check("app: a question the built-in commands don't know goes to the local model", c.length >= 1 && /270 degrees/.test(r.reply), r.reply);
    check("app: the model is shown ~10 tools (never 200), including the schedule reader", offered.length > 0 && offered.length <= 10 && offered.includes("get_agenda"), offered);

    mock.set({ mode: "text" }); s = since(); r = await chat("search the web for the best hiking boots"); c = s(); mock.set({ mode: "native" });
    check("app: a tool call written as text (web search) runs, and isn't spoken", c.length >= 2 && !/tool_call|\{"name"/.test(r.reply), { reply: r.reply, n: c.length });

    mock.set({ leak: true }); s = since(); r = await chat("search the web for owl facts"); mock.set({ leak: false });
    check("app: a reply leaking tool names, JSON and a stack trace is cleaned before it's said", !/play_spotify|JSON|ECONNREFUSED|\.mjs|TypeError|undefined/.test(r.reply) && r.reply.length > 5, r.reply);

    // the confirmation rule: the model can't approve its own change; his yes can
    mock.set({ adversarial: true }); s = since();
    r = await chat(`save the words hello there to ${join(FILES, "notes.txt")}`); c = s();
    check("app: a change to an existing file asks \"Are you sure?\" and waits", /sure/i.test(r.reply) && readFileSync(join(FILES, "notes.txt"), "utf8") === "old words", r.reply);
    check("app: the model trying to confirm by itself changed nothing", c.length >= 3 && readFileSync(join(FILES, "notes.txt"), "utf8") === "old words", c.length);
    mock.set({ adversarial: false });
    r = await chat("yes");
    check("app: after his own yes, the change is made", readFileSync(join(FILES, "notes.txt"), "utf8") === "hello there", { reply: r.reply, file: readFileSync(join(FILES, "notes.txt"), "utf8") });

    r = await chat("launch the rocket");
    check("app: a tool that doesn't exist is recovered from (no crash, a sane answer)", typeof r.reply === "string" && r.reply.length > 3 && !/launch_rocket/.test(r.reply), r.reply);

    // falling back
    mock.set({ firstDelayMs: 3500 }); let t0 = Date.now(); r = await chat("what do you think about the meaning of friendship"); mock.set({ firstDelayMs: 0 });
    check("app: no first word within 2 s → the built-in answer, quickly, and it says so", Date.now() - t0 < 3400 && /slow/i.test(r.reply), { ms: Date.now() - t0, reply: r.reply });
    mock.set({ fail: true }); r = await chat("what do you think about the meaning of kindness"); mock.set({ fail: false });
    check("app: Ollama failing → the built-in answer", typeof r.reply === "string" && r.reply.length > 0, r.reply);

    // switching, models, voice, persistence
    let o = await api("/ai/switch?fresh=1");
    check("app switch: shows Ollama with the live models and No AI", o.current === "ollama" && o.options.find((x) => x.id === "ollama").models.some((m) => m.id === "llava:7b"));
    await api("/ai/switch", { provider: "ollama", model: "llava:7b" }); s = since(); await chat("what do you think about the color blue"); c = s();
    check("app switch: a model change is used on the very next request", c.length && c.every((x) => x.body.model === "llava:7b"), c.map((x) => x.body.model));
    await api("/ai/switch", { provider: "ollama", model: "qwen2.5:3b" });
    r = await chat("turn off the AI");
    check("app voice: \"turn off the AI\" → No AI", /no AI/.test(r.reply) && (await api("/ai/switch")).current === "none", r.reply);
    mock.set({ strictModelCalls: true }); anthropicHits.length = 0;
    r = await chat("what do you think about the history of rome");
    check("app No AI: answered with zero model calls", mock.violations.length === 0 && anthropicHits.length === 0 && r.reply.length > 0, { v: mock.violations, reply: r.reply });
    mock.set({ strictModelCalls: false });
    await stop(); await start();
    check("app switch: No AI is still chosen after a restart", (await api("/ai/switch")).current === "none");
    r = await chat("use ollama");
    check("app voice: \"use ollama\" → back on the local model, with its model", /local AI/.test(r.reply) && (await api("/ai/switch")).model === "qwen2.5:3b", r.reply);
    r = await chat("which AI are you using?");
    check("app voice: \"which AI are you using?\"", /Ollama.*qwen2\.5:3b/.test(r.reply), r.reply);

    // the Claude key in Settings
    let k = await api("/setup/ai", { provider: "anthropic", key: KEY("invalid") });
    check("app key: a rejected key (401) is refused and not saved", !k.ok && /isn't valid/.test(k.error) && !/ANTHROPIC_API_KEY/.test(readFileSync(join(APP, ".env"), "utf8")), k);
    k = await api("/setup/ai", { provider: "anthropic", key: KEY("busy") });
    check("app key: busy → not saved yet, but can be saved anyway", !k.ok && k.temporary, k);
    k = await api("/setup/ai", { provider: "anthropic", key: `  "${KEY("busy")}"\n`, saveAnyway: true });
    check("app key: \"Save anyway\" saves it (cleaned)", k.ok && readFileSync(join(APP, ".env"), "utf8").includes(`ANTHROPIC_API_KEY=${KEY("busy")}`), k);
    k = await api("/setup/ai", { provider: "anthropic", key: `ANTHROPIC_API_KEY=${KEY("ok")}` });
    check("app key: a working key (pasted with its name) is saved, and Claude is the brain", k.ok && k.ai.provider === "anthropic" && readFileSync(join(APP, ".env"), "utf8").includes(`ANTHROPIC_API_KEY=${KEY("ok")}`), k);
    k = await api("/setup/ai/check", {});
    check("app key: Check my Claude connection (saved key, last 4)", k.ok && k.last4 === KEY("ok").slice(-4), k);
    // Ollama with Claude as its fallback
    await api("/ai/switch", { provider: "ollama" }); await api("/setup/ollama/options", { fallback: "claude" });
    mock.set({ fail: true }); anthropicHits.length = 0; r = await chat("what do you think about the meaning of patience"); mock.set({ fail: false });
    check("app fallback: Ollama failing with \"ask Claude\" chosen → Claude answers", /Claude here/.test(r.reply) && anthropicHits.length >= 1, { reply: r.reply, hits: anthropicHits.length });
    await api("/setup/ollama/options", { fallback: "offline" });

    // uninstalled while configured
    const port = new URL(mock.url).port;
    await mock.close();
    o = await api("/setup/ollama/status?fresh=1");
    check("app status: Ollama gone → \"isn't installed\" (not a stale model list)", o.status.state === "not-installed" && o.models.length === 0, o.status);
    t0 = Date.now(); r = await chat("what do you think about the meaning of hope");
    check("app status: …and questions fall back at once, saying so", Date.now() - t0 < 3000 && r.reply.length > 0, { ms: Date.now() - t0, reply: r.reply });
    mock = await startMock({ port: Number(port) });

    // ---------------- Settings → AI brain and the screen's ⋯ menu, in headless Chrome ----------------
    const { chromium } = createRequire(import.meta.url)("playwright-core");   // (Dayspring's own dependency)
    const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${BASE}/setup?s=ai`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#aiActive", { timeout: 15000 });
      await page.waitForFunction(() => /Active now/.test(document.querySelector("#aiActive")?.textContent ?? ""), null, { timeout: 15000 });
      check("UI: the quick switch says what's active", /Ollama/.test(await page.textContent("#aiActive")), await page.textContent("#aiActive"));
      await page.waitForSelector('#olState[data-state="running"]', { timeout: 15000 }).catch(() => {});
      check("UI Ollama: running, with the live models", /running.*qwen2\.5:3b/s.test(await page.textContent("#olState")), await page.textContent("#olState"));
      check("UI Ollama: the model picker lists installed tool models", (await page.$$eval("#model option", (os) => os.map((o) => o.value))).includes("qwen2.5:3b"));
      check("UI Ollama: this computer and its recommendations (3B for commands)", /GB memory/.test(await page.textContent("#olHw")) && /qwen2\.5:3b/.test(await page.textContent("#olRec")));
      await page.click('[data-pull="llama3.2:3b"]');
      await page.waitForFunction(() => /ready/.test(document.querySelector("#olPullText")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
      check("UI Ollama: Pull shows progress and finishes", /llama3\.2:3b is ready/.test(await page.textContent("#olPullText")) && Number(await page.getAttribute("#olPullBar", "value")) === 100, await page.textContent("#olPullText"));
      await page.click("#test");
      await page.waitForFunction(() => /right tools|wrong/.test(document.querySelector("#testOut")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {});
      check("UI Ollama: Test tool use → the timer, reminder and schedule calls", /right tools/.test(await page.textContent("#testOut")) && (await page.$$("#olSelf li")).length === 3, await page.textContent("#olSelf"));
      check("UI Ollama: Speed shows the first word, first sentence and whole-answer times", /first word after/.test(await page.textContent("#olSpeed")), await page.textContent("#olSpeed"));
      await page.selectOption("#olTools", { value: undefined }).catch(() => {});
      await page.fill("#olTools", "8"); await page.selectOption("#olCtx", "8192"); await page.click("#olSave");
      await page.waitForFunction(() => /Saved/.test(document.querySelector("#olSaved")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
      const opts = (await api("/setup/ollama/status")).options;
      check("UI Ollama: options save (tools per request, context size)", opts.toolsN === 8 && opts.numCtx === 8192, opts);
      await api("/setup/ollama/options", { toolsN: 10, numCtx: 4096 });
      // the Claude key box
      await page.click('[data-group="provider"] [data-value="anthropic"]');
      await page.waitForSelector("#key");
      await page.fill("#key", KEY("invalid")); await page.click("#test");
      await page.waitForFunction(() => /✗|✓/.test(document.querySelector("#testOut")?.textContent ?? ""), null, { timeout: 15000 });
      check("UI key: a bad key's message says what to do", /isn't valid.*sk-ant-/.test(await page.textContent("#testOut")), await page.textContent("#testOut"));
      await page.click("#claudeCheck");
      await page.waitForFunction(() => /works|✗/.test(document.querySelector("#claudeCheckOut")?.textContent ?? ""), null, { timeout: 15000 });
      check("UI key: Check my Claude connection lists each step", /Key saved \(ends in/.test(await page.textContent("#claudeCheckOut")), await page.textContent("#claudeCheckOut"));
      // No AI from the quick switch, then back
      await page.click('#aiQuick [data-ai="none"]');
      await page.waitForFunction(() => /No AI/.test(document.querySelector("#aiActive")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => {});
      check("UI switch: one click to No AI", (await api("/ai/switch")).current === "none");
      await page.click('#aiQuick [data-ai="ollama"]');
      await page.waitForFunction(() => /Ollama/.test(document.querySelector("#aiActive")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => {});
      check("UI switch: one click back to Ollama, with its model", (await api("/ai/switch")).current === "ollama" && (await api("/ai/switch")).model === "qwen2.5:3b");
      await page.close();
      // the screen's ⋯ More → 🧠 AI brain
      const tv = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      await tv.goto(`${BASE}/display`, { waitUntil: "domcontentloaded" });
      await tv.waitForSelector("#aiBtn", { state: "attached", timeout: 15000 });
      await sleep(1500);
      const inMore = await tv.evaluate(() => Boolean(document.querySelector("#aiBtn")?.closest(".morebox")));
      check("screen: 🧠 AI brain is in the ⋯ More menu", inMore);
      await tv.click(".calbtns .util .morebtn"); await tv.click("#aiBtn");
      await tv.waitForSelector('#aiPop [data-ai="none"]', { timeout: 10000 });
      const shown = await tv.$$eval("#aiPop [data-ai]", (b) => b.map((x) => x.dataset.ai));
      check("screen: it offers only what's set up (Claude has a key, Ollama is running, No AI)", shown.includes("ollama") && shown.includes("none") && shown.includes("anthropic"), shown);
      await tv.click('#aiPop [data-ai="none"]');
      await tv.waitForSelector("#aiToast", { timeout: 8000 });
      check("screen: switching takes effect at once, with a toast", /no AI/.test(await tv.textContent("#aiToast")) && (await api("/ai/switch")).current === "none", await tv.textContent("#aiToast"));
      await api("/ai/switch", { provider: "ollama" });
      await tv.close();
    } finally { await browser.close(); }
  } finally { await stop(); if (fail) writeFileSync(join(TMP, "server.log"), serverLog); }
}

// ---------------- --live: a small sample on a real Ollama, only if one is installed with a tool model ----------------
if (LIVE) {
  let tags = [];
  try { tags = (await (await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1500) })).json()).models ?? []; } catch { /* none */ }
  const model = tags.map((m) => m.name).find((n) => /qwen2\.5|qwen3|llama3\.[123]|mistral/i.test(n));
  if (!model) console.log("SKIP  --live: no Ollama with a tool-capable model on this computer (nothing was pulled)");
  else {
    Object.assign(process.env, { OLLAMA_URL: "http://127.0.0.1:11434", AI_PROVIDER: "ollama", AI_MODEL: model, OLLAMA_FIRST_TOKEN_S: "60" });
    const assistant = await L("assistant.mjs"); const local = await L("ollama/index.mjs"); const tools = assistant.offeredTools();
    const LIVE_CASES = [["remind me to drink water at 11pm", "set_reminder"], ["what's on my schedule tomorrow", "get_agenda"], ["add dentist friday at 3pm", "add_block"], ["play some Hillsong on Spotify", "play_spotify"], ["play a video about sharpening chisels", "video_find"],
      ["who won the Royals game last night", "web_search"], ["read Romans 8:28", "get_scripture"], ["remember that I like dark roast", "remember"], ["find my resume", "find_files"], ["set up Spotify", "media_login"],
      ["turn off the fan", "device_control"], ["email Sam that I'm running late", "email_draft"], ["show me pictures of golden retrievers", "image_search"], ["latest tech news", "news_latest"], ["talk a little slower", "set_voice_style"]];
    let ok = 0; const times = [];
    for (const [q, want] of LIVE_CASES) {
      const seen = []; const t = Date.now();
      try { const r = await local.chat({ history: [], userText: q, tools, runTool: async (n, i) => { seen.push(n); return { ok: true, note: "test: nothing was done" }; }, extras: {} }); times.push({ q, ms: Date.now() - t, ttft: r.local?.metrics?.ttftMs, first: r.local?.metrics?.firstSentenceMs }); } catch (e) { times.push({ q, error: e.message }); }
      if (seen.includes(want)) ok++; else console.log(`      live miss: "${q}" → ${seen.join(",") || "no tool"} (wanted ${want})`);
    }
    const avg = (k) => Math.round(times.filter((x) => x[k]).reduce((a, x) => a + x[k], 0) / Math.max(1, times.filter((x) => x[k]).length));
    console.log(`LIVE  ${model}: ${ok}/${LIVE_CASES.length} right tool · first word ${avg("ttft")} ms · first sentence ${avg("first")} ms · whole turn ${avg("ms")} ms`);
  }
}
} finally {
  await mock.close().catch(() => {}); await new Promise((r) => anth.close(r));
  if (!KEEP && !fail) rmSync(TMP, { recursive: true, force: true }); else console.log(`Test files kept in ${TMP}`);
}
console.log(`\n${pass}/${pass + fail} passed in ${Math.round((Date.now() - T0) / 1000)} s${fail ? "; failed: " + failed.join(" | ") : ""}`);
process.exit(fail ? 1 : 0);
