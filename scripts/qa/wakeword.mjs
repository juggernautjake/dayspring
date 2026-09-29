// Renaming the assistant and custom wake words, without a server (the E2E checks are scripts/qa/naming-e2e.mjs):
//   • the rules for a name and a wake word (1–19 characters; letters, numbers, spaces, ' and -), and Lantern refused
//   • hearing many wake words in what a recognizer writes: short, long, made-up spellings ("Computa" said "compootah",
//     "Zoopa", "Kestra", "Aoife" said "Ee-fa"), two words ("Big Mike", "Hey Nova"), the recognizer's n-best guesses
//   • a corpus of ordinary sentences that must never wake it ("my computer is slow")
//   • the offline intents taking a custom wake word off ("Computa, set a timer…"), Tune in and Discord's checks
//   • "Train my wake word" with injected transcripts; the voice commands ("your name is Nova", "answer to Jarvis"…)
//   • it calls itself by its name (the reply filter, the prompt note) and says the name the way it's said
//   node scripts/qa/wakeword.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "ds-wake-"));
process.env.DAYSPRING_OWNER_FILE = join(TMP, "owner.json");
process.env.DS_CALLS_FILE = join(TMP, "calls.json");
process.env.DS_CALL_LATENCY_LOG = join(TMP, "call-latency.log");
Object.assign(process.env, { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-not-a-real-key", TTS_PROVIDER: "browser", ELEVENLABS_API_KEY: "", DAYSPRING_NO_ECO: "1" });   // (the call pipeline's AI is a stand-in below)
delete process.env.DAYSPRING_WAKE_PHRASES;
writeFileSync(process.env.DAYSPRING_OWNER_FILE, JSON.stringify({ name: "Sam", setupDone: true }));

let pass = 0, fail = 0;
const failed = [];
const check = (name, ok, got = "") => { if (ok) pass++; else { fail++; failed.push(name); } if (!ok || process.argv.includes("--verbose")) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 300) + ")" : ""}`); };
const section = (t) => console.log(`\n— ${t} —`);

await import("../../public/wakeword.js");
const W = globalThis.dsWake;
const owner = await import("../../lib/owner.mjs");
const wake = await import("../../lib/wakeword.mjs");
const naming = await import("../../lib/naming.mjs");
const cmd = await import("../../lib/commands/naming.mjs");
const text = await import("../../lib/intents/text.mjs");
const dwake = await import("../../lib/discord/wake.mjs");
const dnaming = await import("../../lib/discord/naming.mjs");

// ---------------------------------------------------------------------------------------------------------------------------
section("migration: an existing install keeps Dayspring as its name and wake word");
{
  const o = owner.get();
  check("name is Dayspring, wake word dayspring, following the name", o.assistantName === "Dayspring" && o.wakeWords.join() === "dayspring" && o.wakeFollowsName === true, o);
  writeFileSync(process.env.DAYSPRING_OWNER_FILE, JSON.stringify({ name: "Sam", setupDone: true, assistantName: "Dayspring", wakeWords: ["dayspring"] }));
}

section("validation: names");
{
  const ok = ["Nova", "A", "Big Mike", "Aoife", "Zoë", "D'Arcy", "Jean-Luc", "R2 D2", "Computa", "Abcdefghijklmnopqrs", "  Nova  "];
  for (const n of ok) check(`name “${n}” is allowed`, W.validateName(n).ok, W.validateName(n).error);
  check("trimmed: “  Nova  ” → “Nova”", W.validateName("  Nova  ").value === "Nova");
  const bad = [["", /1 to 19/], ["Abcdefghijklmnopqrst", /20 characters/], ["Nova!", /“!”/], ["Nova 🚀", /letters/], ["<b>", /letters/], ["---", /1 to 19|letter or number/], ["Nova_2", /“_”/]];
  for (const [n, re] of bad) { const r = W.validateName(n); check(`name “${n}” is refused with a friendly reason`, !r.ok && re.test(r.error), r.error); }
  check("19 characters exactly is fine, 20 isn't", W.validateName("x".repeat(19)).ok && !W.validateName("x".repeat(20)).ok);
}

section("validation: wake words, and Lantern refused");
{
  for (const w of ["Hey Nova", "Computer", "Jarvis", "Computa", "Big Mike"]) check(`wake word “${w}” is allowed`, W.validateWake(w, { name: "Nova" }).ok, W.validateWake(w).error);
  for (const w of ["hey", "ok", "the", "okay so"]) { const r = W.validateWake(w, { name: "Nova" }); check(`wake word “${w}” is refused (people say it all the time)`, !r.ok && /all the time/.test(r.error), r.error); }
  const c = W.validateWake("computer");
  check("“Computer” warns it's an everyday word (start only)", c.ok && c.warnings.some((w) => /everyday word/.test(w)), c.warnings);
  const e = W.validateWake("Ed");
  check("“Ed” warns it's short and suggests “Hey Ed”", e.ok && e.warnings.some((w) => /short/.test(w)) && e.tips.includes("Hey Ed"), e);
  for (const w of ["Lantern", "lanterns", "Hey Lantern", "Lan tern", "Latern", "Lanturn", "Lanterne"]) { const r = W.validateWake(w); check(`wake word “${w}” is refused: too like Lantern, and says why`, !r.ok && /Lantern/.test(r.error) && /both would answer/.test(r.error), r.error); }
  for (const n of ["Lantern", "Lanturn"]) check(`name “${n}” is refused too`, !W.validateName(n).ok);
  check("“Lance” and “Latte” are fine (they don't sound like Lantern)", W.validateWake("Lance").ok && W.validateName("Latte").ok);
  const nl = naming.setName("Lantern");
  check("naming.setName refuses Lantern and nothing changes", !nl.ok && owner.get().assistantName === "Dayspring", nl);
}

// ---------------------------------------------------------------------------------------------------------------------------
section("hearing wake words (normal sensitivity)");
const CASES = [
  { label: "Dayspring (default)", cfg: { words: [{ text: "dayspring" }] },
    yes: [["Dayspring what time is it", "what time is it"], ["hey dayspring, what's the weather", "what's the weather"], ["day spring set a timer", "set a timer"], ["day-spring, play music", "play music"], ["daysprings what's the weather", "what's the weather"], ["Okay Dayspring", ""], ["dayspring's there?", "there?"], ["So, Dayspring, what's next", "what's next"]],
    no: ["the spring is lovely this year", "I told her about Dayspring yesterday", "days are getting longer in spring"] },
  { label: "Nova", cfg: { words: [{ text: "nova" }] },
    yes: [["Nova what time is it", "what time is it"], ["hey Nova, set a timer", "set a timer"], ["okay nova", ""], ["um nova play some music", "play some music"], ["Novah, what's up", "what's up"]],
    no: ["movie night is on Friday", "never mind", "over there by the door", "is it in Nova Scotia", "a supernova is a big explosion", "I love my Toyota"] },
  { label: "Hey Nova (needs the hey)", cfg: { words: [{ text: "hey nova" }] },
    yes: [["hey nova what time is it", "what time is it"], ["hi nova, what's up", "what's up"], ["hay nova", ""]],
    no: ["nova what time is it", "a nova is a star", "movie night"] },
  { label: "Computa (said “compootah”)", cfg: { words: [{ text: "computa", say: "compootah" }] },
    yes: [["computa what time is it", "what time is it"], ["Computer, what time is it?", "what time is it?"], ["compute a set a timer", "set a timer"], ["compute uh what's the weather", "what's the weather"], ["compootah", ""], ["compu ta play music", "play music"], ["come puta turn on the lights", "turn on the lights"], ["computah", ""], ["komputa, what's up", "what's up"], ["hey computer what's next", "what's next"], ["okay, computer, lights off", "lights off"]],
    no: ["my computer is slow", "I need a new computer", "the computer crashed again", "and computer science is hard", "can you compute the total", "compute the average", "restart the computer please", "is your computer on", "computing has changed", "commuter trains are late"] },
  { label: "Computa, relaxed (the rougher mishearings)", cfg: { words: [{ text: "computa", say: "compootah" }], sensitivity: "relaxed" },
    yes: [["commuter what time is it", "what time is it"], ["puter what time is it", "what time is it"], ["Computer, what time is it?", "what time is it?"]],
    no: ["my computer is slow", "the computer crashed again"] },
  { label: "Zoopa", cfg: { words: [{ text: "zoopa" }] },
    yes: [["zoopa what time is it", "what time is it"], ["zoo pa, play music", "play music"], ["zupa", ""], ["zooper what's up", "what's up"]],
    no: ["super, thanks", "that's super cool", "soup for dinner", "zoom in a little", "the zoo opens at nine"] },
  { label: "Kestra", cfg: { words: [{ text: "kestra" }] },
    yes: [["kestra what time is it", "what time is it"], ["kes tra, set a timer", "set a timer"], ["kestrah", ""], ["hey kestra", ""]],
    no: ["extra cheese please", "the orchestra was great", "a kestrel flew by", "sister is coming over"] },
  { label: "Aoife (said “Ee-fa”)", cfg: { words: [{ text: "aoife", say: "ee-fa" }] },
    yes: [["Aoife what time is it", "what time is it"], ["Ee-fa, what's up", "what's up"], ["eefa", ""], ["ifa set a timer", "set a timer"]],
    no: ["if a train leaves at noon", "if I go to the store", "I found it"] },
  { label: "Big Mike", cfg: { words: [{ text: "big mike" }] },
    yes: [["big mike what time is it", "what time is it"], ["Big Mic, play music", "play music"], ["bigmike", ""], ["hey big mike", ""]],
    no: ["big like a house", "that was a big mistake", "a big bike ride", "Mike is coming over", "the big mic is broken"] },
  { label: "Jarvis", cfg: { words: [{ text: "jarvis" }] },
    yes: [["jarvis what time is it", "what time is it"], ["Jarvis, lights on", "lights on"], ["jar vis", ""], ["hey jarvis", ""]],
    no: ["the service was slow", "harvest time", "Travis is here", "a jar of pickles"] },
  { label: "Computer (an everyday word)", cfg: { words: [{ text: "computer" }] },
    yes: [["computer what time is it", "what time is it"], ["Computer, lights on", "lights on"], ["hey computer", ""]],
    no: ["my computer is slow", "turn off the computer", "I bought a computer"] },
  { label: "several: Nova + Jarvis + Hey Kestra", cfg: { words: [{ text: "nova" }, { text: "jarvis" }, { text: "hey kestra" }] },
    yes: [["nova what's up", "what's up"], ["jarvis what's up", "what's up"], ["hey kestra what's up", "what's up"]],
    no: ["extra time", "the service"] },
];
for (const c of CASES) {
  const m = W.createMatcher(c.cfg);
  for (const [t, rest] of c.yes) { const r = m.match(t); check(`${c.label}: “${t}” wakes → “${rest}”`, r && r.rest === rest, r); }
  for (const t of c.no) { const r = m.match(t); check(`${c.label}: “${t}” does not wake`, !r, r); }
}
{
  const m = W.createMatcher({ words: [{ text: "computa", say: "compootah" }] });
  const r = m.matchAny(["can you tell me what time it is", "Computa what time is it"]);
  check("n-best: the recognizer's second guess has the wake word → heard", r && r.alt === 1 && r.rest === "what time is it", r);
  check("n-best: no guess has it → not heard", !m.matchAny(["my computer is slow", "my commuter is slow"]));
  const strict = W.createMatcher({ words: [{ text: "computa", say: "compootah" }], sensitivity: "strict" });
  check("strict: “Computer, what time…” doesn't count (only the word itself and what training taught)", !strict.match("Computer, what time is it"));
  check("normal: “commuter” and “puter” need training (or relaxed)", !m.match("commuter what time is it") && !m.match("puter what time is it"));
  check("strict: “computa what time” still counts", strict.match("computa what time is it")?.rest === "what time is it");
  const relaxed = W.createMatcher({ words: [{ text: "nova" }], sensitivity: "relaxed" });
  check("relaxed: a rougher “Noba” counts", relaxed.match("noba what time is it")?.rest === "what time is it", relaxed.match("noba what time is it"));
  check("Lantern's own name never wakes Dayspring (wake word “Latte”)", !W.createMatcher({ words: [{ text: "latte" }], sensitivity: "relaxed" }).match("Lantern, what's a struct?"));
  check("Lantern-addressed sentences don't wake Nova", !W.createMatcher({ words: [{ text: "nova" }] }).match("Hey Lantern, what does cfqueryparam do?"));
  const rx = W.regexLike(W.createMatcher({ words: [{ text: "nova" }] }));
  const e = rx.exec("So, Nova, what's the weather");
  check("RegExp shape: exec → [wake, rest] with index", e && e[0] === "Nova," && e[1] === "what's the weather" && e.index === 4, e);
  check("RegExp shape: String#replace keeps the words before", "So, Nova, what's the weather".replace(rx, "$1") === "So, what's the weather", "So, Nova, what's the weather".replace(rx, "$1"));
}

// ---------------------------------------------------------------------------------------------------------------------------
section("false positives: ordinary sentences never wake it");
const CORPUS = [
  "my computer is slow", "I need a new computer for school", "the computer crashed again last night", "did you restart the computer", "can you compute the total for me",
  "what time is the game tonight", "I'm going to the store later", "let's have pizza for dinner", "the weather is nice today", "turn it up a little",
  "never mind, it's fine", "over there by the window", "movie night is on Friday", "I watched a movie about space", "that's super, thanks",
  "we need extra chairs for the party", "the orchestra played beautifully", "she's my sister", "the service at the restaurant was great", "they harvest the corn in the fall",
  "Travis said he'd be late", "a jar of peanut butter", "if a train leaves Chicago at noon", "if I finish early I'll call you", "Eva is coming to visit",
  "that was a big mistake", "big like a house", "the big mic stopped working", "Mike is picking up the kids", "I like my bike",
  "the spring is lovely this year", "days are getting longer", "they spring into action", "stay safe out there", "the dare was silly",
  "the zoo opens at nine", "soup is ready", "zoom in on the map", "scoop some ice cream", "the group is meeting at six",
  "no, I don't think so", "yes, that's right", "okay, sounds good", "hey, how are you", "hi there",
  "the kids are asleep", "remind me to call mom", "what's on the calendar tomorrow", "play some jazz", "read me the news",
  "I think the novel was better than the movie", "a supernova lit up the sky", "we drove through Nova Scotia last summer", "the Toyota needs an oil change", "it's over now",
  "the commuter train was late", "commuters were stuck in traffic", "computing has changed a lot", "my compact car is small", "the company picnic is Saturday",
  "extra time was added to the game", "the kestrel hunted a mouse", "a chest of drawers", "the best test results", "west of the river",
  "can you pass the salt", "I lost my keys again", "the dog needs a walk", "call grandma on Sunday", "what should we cook tonight",
  "turn off the lights in the kitchen", "open the window a bit", "who won the game last night", "how far is the airport", "set the table please",
  "the meeting ran long", "my phone is almost dead", "did you feed the cat", "the printer is out of paper", "I'll be home by six",
  "put the laundry in the dryer", "take out the trash", "the baby is crying", "let's go for a hike", "the river flooded",
  "service with a smile", "the harvest moon is bright", "a jarful of cookies", "my brother Marvin called", "Davis won the race",
  "zooper dooper is a silly word", "super duper", "a pepper and some paper", "the copper pipe leaked", "proper manners matter",
  "I need to compute my taxes", "compute the average", "the computer science class", "computers are everywhere", "pewter mugs are heavy",
  "if a friend asks, say yes", "if anyone calls, take a message", "ifa ifa is a song", "every evening we walk", "even if it rains",
  "never have I ever", "nobody knows", "no one is home", "novel ideas", "nova is a TV show about science",
];
const FP_CFGS = [
  ["dayspring", { words: [{ text: "dayspring" }] }], ["nova", { words: [{ text: "nova" }] }], ["hey nova", { words: [{ text: "hey nova" }] }],
  ["computa", { words: [{ text: "computa", say: "compootah" }] }], ["zoopa", { words: [{ text: "zoopa" }] }], ["kestra", { words: [{ text: "kestra" }] }],
  ["aoife", { words: [{ text: "aoife", say: "ee-fa" }] }], ["big mike", { words: [{ text: "big mike" }] }], ["jarvis", { words: [{ text: "jarvis" }] }], ["computer", { words: [{ text: "computer" }] }],
];
// the few that SHOULD wake: the sentence starts with the wake word (or its everyday twin) — addressing it, as far as anyone can tell
const EXPECTED = new Set(["computer|computers are everywhere", "nova|nova is a TV show about science", "hey nova|—", "aoife|ifa ifa is a song", "zoopa|zooper dooper is a silly word", "computa|computers are everywhere"]);
let fp = 0, fpList = [];
for (const [label, cfg] of FP_CFGS) {
  const m = W.createMatcher(cfg);
  for (const s of CORPUS) { const r = m.match(s); if (r && !EXPECTED.has(`${label}|${s}`)) { fp++; fpList.push(`${label}: “${s}” (${r.how} ${r.score})`); } }
}
check(`no false wake-ups: ${CORPUS.length} ordinary sentences × ${FP_CFGS.length} wake words (${CORPUS.length * FP_CFGS.length} checks)`, fp === 0, fpList.join(" | "));
console.log(`  normal: ${fp} false wake-ups in ${CORPUS.length * FP_CFGS.length} checks`);
let relaxedAll = 0;
for (const [label, cfg] of FP_CFGS) {
  const m = W.createMatcher({ ...cfg, sensitivity: "relaxed" });
  const hits = CORPUS.filter((s) => m.match(s) && !EXPECTED.has(`${label}|${s}`));
  relaxedAll += hits.length;
  if (hits.length) console.log(`  relaxed “${label}”: ${hits.map((h) => `“${h}”`).join(", ")}`);
  check(`relaxed “${label}”: at most 2 false wake-ups in the corpus`, hits.length <= 2, hits);
}
console.log(`  relaxed: ${relaxedAll} false wake-ups in ${CORPUS.length * FP_CFGS.length} checks`);
{
  const strictHits = FP_CFGS.reduce((n, [label, cfg]) => n + CORPUS.filter((s) => W.createMatcher({ ...cfg, sensitivity: "strict" }).match(s) && !EXPECTED.has(`${label}|${s}`)).length, 0);
  check("strict: no false wake-ups at all", strictHits === 0, strictHits);
}

// ---------------------------------------------------------------------------------------------------------------------------
section("the confusion list (sound-alike everyday words)");
{
  const n = W.neighbours("computa");
  check("computa → computer, compute a, commuter", ["computer", "compute a", "commuter"].every((x) => n.includes(x)), n);
  check("zoopa → super", W.neighbours("zoopa").includes("super"), W.neighbours("zoopa"));
  check("jarvis has no everyday sound-alikes", W.neighbours("jarvis").length === 0, W.neighbours("jarvis"));
}

// ---------------------------------------------------------------------------------------------------------------------------
section("the owner's settings: the name, wake words following it, and independence");
{
  let r = naming.setName("Computa", { say: "compootah" });
  check("rename to Computa (said compootah): the wake word follows", r.ok && owner.get().wakeWords.join() === "computa" && owner.get().assistantSay === "compootah", owner.get());
  check("…and the matcher hears “computer, what time” now", wake.match("computer, what time is it")?.rest === "what time is it");
  check("…the local speech hint spells it the owner's way", /Hey Computa, what's the weather\?/.test(wake.hint()), wake.hint());
  check("the voice says it the way it's said: “I'm Computa” → “I'm compootah”", naming.forSpeech("Hi, I'm Computa.") === "Hi, I'm compootah.", naming.forSpeech("Hi, I'm Computa."));
  r = naming.setWakeWords(["jarvis", "hey computa"]);
  check("explicit wake words: Jarvis and Hey Computa (no longer following the name)", r.ok && owner.get().wakeFollowsName === false && owner.get().wakeWords.join() === "jarvis,hey computa", owner.get());
  r = naming.setName("Kestra");
  check("renamed to Kestra: the chosen wake words stay", r.ok && owner.get().wakeWords.join() === "jarvis,hey computa" && !r.wakeChanged, owner.get());
  check("…and the new name's pronunciation was cleared (it was Computa's)", owner.get().assistantSay === "");
  r = naming.setWakeWords(["kestra"]);
  check("wake words set to exactly the name → following the name again", r.ok && owner.get().wakeFollowsName === true);
  naming.setName("Nova");
  check("…so renaming to Nova moves the wake word too", owner.get().wakeWords.join() === "nova");
  r = naming.setWakeWords(["a", "b", "c", "d"]);
  check("more than 3 wake words is refused", !r.ok && /Up to 3/.test(r.error));
  r = naming.setWakeWords(["nova", "lantern"]);
  check("a Lantern wake word is refused, and nothing changes", !r.ok && /Lantern/.test(r.error) && owner.get().wakeWords.join() === "nova");
  r = naming.removeWakeWord("nova");
  check("the only wake word can't be removed", !r.ok && /only wake word/.test(r.error));
}

section("the offline intents take a custom wake word off");
{
  naming.setName("Computa", { say: "compootah" });
  check("“Computa, set a timer for ten minutes” → “set a timer for 10 minutes”", text.normalize("Computa, set a timer for ten minutes") === "set a timer for 10 minutes", text.normalize("Computa, set a timer for ten minutes"));
  check("“computer set a timer for 10 minutes” → the lookalike at the start comes off", text.normalize("computer set a timer for 10 minutes") === "set a timer for 10 minutes", text.normalize("computer set a timer for 10 minutes"));
  check("“hey compute a what's the weather” → “what is the weather”", text.normalize("hey compute a what's the weather") === "what is the weather", text.normalize("hey compute a what's the weather"));
  check("“my computer is slow” keeps its computer", text.normalize("my computer is slow") === "my computer is slow", text.normalize("my computer is slow"));
  naming.setWakeWords(["jarvis", "big mike"]);
  check("“Big Mike, what time is it” → “what time is it”", text.normalize("Big Mike, what time is it") === "what time is it", text.normalize("Big Mike, what time is it"));
  check("“Jarvis turn on the lights” → “turn on the lights”", text.normalize("Jarvis turn on the lights") === "turn on the lights", text.normalize("Jarvis turn on the lights"));
  check("“hey dayspring what time is it” still works (the app's own name)", text.normalize("hey dayspring what time is it") === "what time is it");
}

section("Tune in and the Discord bot hear the same wake words");
{
  const tunein = await import("../../lib/tunein.mjs");
  check("Tune in: “Jarvis, what's the capital of France?”", tunein.commandFrom("Jarvis, what's the capital of France?") === "what's the capital of France?", tunein.commandFrom("Jarvis, what's the capital of France?"));
  check("Tune in: “big mic what's the score”", tunein.commandFrom("big mic what's the score") === "what's the score", tunein.commandFrom("big mic what's the score"));
  check("Tune in: a friend saying “my jar of pickles” is not for it", tunein.commandFrom("my jar of pickles is empty") === null);
  check("Discord: “Jarvis, tell us a joke” → the request", dwake.wakeCommand("Jarvis, tell us a joke") === "tell us a joke");
  check("Discord: just the name → \"\" (listen for the rest)", dwake.wakeCommand("Jarvis?") === "");
  check("Discord: “did you see Jarvis yet” (mid-sentence) → not for it", dwake.wakeCommand("did you see Jarvis yet") === null);
  naming.setWakeWords(["computa"]);
  check("Discord: “compute a what time is it”", dwake.wakeCommand("compute a what time is it") === "what time is it", dwake.wakeCommand("compute a what time is it"));
}

section("Discord: the bot's nickname follows the name (a stand-in client)");
{
  const calls = [];
  const member = (nick, fail = false) => ({ nickname: nick, setNickname: async (n, why) => { if (fail) throw Object.assign(new Error("Missing Permissions"), { code: 50013 }); calls.push({ n, why }); } });
  const client = { guilds: { cache: new Map([["g1", { id: "g1", members: { me: member(null) } }], ["g2", { id: "g2", members: { me: member("Nova") } }], ["g3", { id: "g3", members: { me: member(null, true) } }]]) } };
  const res = await dnaming.applyBotName(client, "Nova");
  check("renamed: the nickname is set where it differs", calls.length === 1 && calls[0].n === "Nova" && res.find((r) => r.guild === "g2")?.same, { calls, res });
  check("a server without the permission is reported, not fatal", res.find((r) => r.guild === "g3")?.ok === false && /Change Nickname/.test(res.find((r) => r.guild === "g3").why), res);
  calls.length = 0;
  const back = { guilds: { cache: new Map([["g1", { id: "g1", members: { me: member("Nova") } }]]) } };
  await dnaming.applyBotName(back, "Dayspring");
  check("back to Dayspring: the nickname is cleared (the bot's own name shows)", calls.length === 1 && calls[0].n === null, calls);
}

// ---------------------------------------------------------------------------------------------------------------------------
section("Train my wake word (injected recognizer results)");
{
  naming.setName("Computa", { say: "compootah" });
  let st = naming.trainStart({ word: "computa" });
  check("training starts for the wake word", st.ok && st.word === "computa" && st.want === 5, st);
  for (const alts of [["compute a"], ["computer", "computa"], ["compootah"], ["commuter"], ["come puta"]]) st = naming.trainSample(alts, { id: st.id });
  const rep = st.report;
  check("after 5 tries it finishes and reports a success rate", st.done && rep && rep.samples === 5 && typeof rep.successRate === "number", st);
  check("it learned what the recognizer wrote: compute a, computer, compootah, commuter, come puta", ["compute a", "computer", "compootah", "commuter", "come puta"].every((x) => rep.learned.includes(x)), rep.learned);
  check("the learned variants are saved for that wake word", ["compute a", "computer"].every((x) => owner.get().wakeTrained.computa.includes(x)), owner.get().wakeTrained);
  check("it warns that some are everyday words", rep.warnings.some((w) => /everyday words/.test(w)), rep.warnings);
  check("strict sensitivity now accepts “computer, what time is it” (taught)", W.createMatcher({ ...wake.config(), sensitivity: "strict" }).match("computer, what time is it")?.rest === "what time is it");
  naming.setWakeWords(["ed"]);
  st = naming.trainStart({ word: "ed" });
  for (const alts of [["the"], ["add"], ["hey"], ["it"]]) st = naming.trainSample(alts, { id: st.id });
  st = naming.trainFinish();
  check("a short wake word: low success, warned, better ones suggested", st.report.successRate < 60 && st.report.warnings.some((w) => /short/.test(w)) && st.report.suggestions.includes("hey ed"), st.report);
  check("…and “the” / “hey” / “it” are never learned", !st.report.learned.some((x) => ["the", "hey", "it"].includes(x)) && st.report.skipped.some((x) => x.text === "the"), st.report);
  st = naming.trainStart({ word: "nope" });
  check("training a word that isn't a wake word is refused", !st.ok);
}

// ---------------------------------------------------------------------------------------------------------------------------
section("voice commands: telling it its name (parse)");
{
  naming.setName("Dayspring"); naming.setWakeWords(["dayspring"]); cmd._reset();
  const NAMES = [
    ["your name is Nova", "Nova"], ["your name is now Nova", "Nova"], ["I'm going to call you Nova", "Nova"], ["I'll call you Nova", "Nova"],
    ["call yourself Nova", "Nova"], ["from now on you're Nova", "Nova"], ["From now on, you are Nova.", "Nova"], ["can I call you Nova?", "Nova"],
    ["change your name to Nova", "Nova"], ["rename yourself Nova", "Nova"], ["let's name you Nova", "Nova"], ["you're Nova from now on", "Nova"],
    ["change your name to big mike", "Big Mike"], ["I want to call you Aoife", "Aoife"], ["your new name is Kestra", "Kestra"], ["Hey Dayspring, change your name to Zoopa please", "Zoopa"],
  ];
  for (const [t, n] of NAMES) { const p = cmd.parse(t); check(`“${t}” → rename to ${n}`, p?.intent === "name.set" && p.args.name === n, p); }
  const p = cmd.parse("your new name is Computa, it's said compootah");
  check("“your new name is Computa, it's said compootah” → Computa, said Compootah", p?.intent === "name.set" && p.args.name === "Computa" && /compootah/i.test(p.args.say), p);
  for (const t of ["my friend's name is Nova", "call Nova", "call me Nova", "I'll call you later", "can I call you back", "I'll call you when I get home", "you are now muted", "you're now in charge", "what's your name", "is your name Nova"]) {
    const q = cmd.parse(t); check(`“${t}” does NOT rename it`, q?.intent !== "name.set", q);
  }
  const Q = [["what's your name?", "name.get"], ["what should I call you", "name.get"], ["what were you called before?", "name.origin"], ["what's your original name", "name.origin"],
    ["go back to Dayspring", "name.reset"], ["change your name back", "name.reset"], ["what's your wake word?", "wake.get"], ["what are your wake words", "wake.get"],
    ["change your wake word to Jarvis", "wake.set"], ["set your wake word to Computa", "wake.set"], ["change the wake word to computer", "wake.set"], ["only answer to Jarvis", "wake.set"],
    ["add a wake word Computer", "wake.add"], ["add Computer as a wake word", "wake.add"], ["answer to Jarvis", "wake.add"], ["train my wake word", "wake.train"],
    ["make the wake word less sensitive", "wake.sensitivity"], ["stop answering to Jarvis", "wake.remove"]];
  for (const [t, want] of Q) { const q = cmd.parse(t); check(`“${t}” → ${want}`, q?.intent === want, q); }
  for (const t of ["answer to the question", "respond to Sam's text", "remove milk from my list", "add milk to my list", "respond to that email"]) { const q = cmd.parse(t); check(`“${t}” is not a wake word command`, !q || !/^wake\./.test(q.intent), q); }
}

section("voice commands: the conversation (confirm, yes, it calls itself by the new name)");
{
  cmd._reset();
  const say = (t) => cmd.handle(t, { surface: "tv" });
  let r = await say("your name is Nova");
  check("asks first: “Okay, call me Nova from now on? Say yes.”", /call me Nova from now on\? Say yes\./.test(r.reply) && owner.get().assistantName === "Dayspring", r.reply);
  r = await say("yes");
  check("after yes: “Great, I'm Nova now!” and the name is saved", /^Great, I'm Nova now!/.test(r.reply) && owner.get().assistantName === "Nova", r.reply);
  check("…the wake word followed the name (it was the name)", owner.get().wakeWords.join() === "nova" && /Say “Nova”/.test(r.reply), r.reply);
  r = await say("what's your name?");
  check("“what's your name?” → “I'm Nova.”", r.reply === "I'm Nova.", r.reply);
  r = await say("what were you called before?");
  check("“what were you called before?” → “I started out as Dayspring.”", /^I started out as Dayspring\./.test(r.reply), r.reply);
  r = await say("my friend's name is Kestra");
  check("“my friend's name is Kestra” is not about its name (passes on)", r === null && owner.get().assistantName === "Nova");
  r = await say("call Kestra");
  check("“call Kestra” (a phone call) passes on", r === null);
  r = await say("I'm going to call you Kestra"); r = await say("nope");
  check("a no leaves the name alone", /left it alone/.test(r.reply) && owner.get().assistantName === "Nova", r.reply);
  r = await say("your name is Lantern");
  check("“your name is Lantern” is refused with the reason", /Lantern/.test(r.reply) && /both would answer/.test(r.reply) && owner.get().assistantName === "Nova", r.reply);
  r = await say("change your name to Abcdefghijklmnopqrstuv");
  check("a name that's too long is refused kindly", /up to 19/.test(r.reply), r.reply);
  // independence: wake words set on their own stay when the name changes, and it asks
  r = await say("set your wake word to Jarvis"); check("wake word change asks first (Say yes)", /Say yes/.test(r.reply) && owner.get().wakeWords.join() === "nova", r.reply);
  r = await say("yes"); check("…then Jarvis is the wake word", owner.get().wakeWords.join() === "jarvis" && owner.get().wakeFollowsName === false, r.reply);
  r = await say("your new name is Computa, it's said compootah"); check("rename with a pronunciation asks, with it", /call me Computa from now on, said “Compootah”\? Say yes/.test(r.reply), r.reply);
  r = await say("yeah");
  check("renamed; the explicit wake word stays; it asks about answering to the new name", owner.get().assistantName === "Computa" && owner.get().wakeWords.join() === "jarvis" && /Want me to answer to “Computa” too\?/.test(r.reply), r.reply);
  r = await say("sure");
  check("…yes → it answers to Jarvis and Computa", owner.get().wakeWords.join() === "jarvis,computa", owner.get().wakeWords);
  r = await say("add Computer as a wake word"); r = await say("yes");
  check("“add Computer as a wake word” + yes → three wake words", owner.get().wakeWords.join() === "jarvis,computa,computer", r.reply);
  r = await say("answer to Nova");
  check("a fourth wake word is refused (up to 3)", /up to 3/.test(r.reply), r.reply);
  r = await say("remove Jarvis"); r = await say("that's right");
  check("“remove Jarvis” + “that's right” → removed", owner.get().wakeWords.join() === "computa,computer", r.reply);
  r = await say("what are your wake words?");
  check("“what are your wake words?” lists them", /“Computa” and “Computer”/.test(r.reply), r.reply);
  r = await say("you're not Computa anymore"); r = await say("yes");
  check("“you're not Computa anymore” + yes → Dayspring again", owner.get().assistantName === "Dayspring" && /Dayspring again/.test(r.reply), r.reply);
  r = await say("train my wake word");
  check("“train my wake word” starts training on the screen", /Let's train/.test(r.reply) && r.wakeTrain && naming.trainStatus().word === "computa", r);
  naming.trainCancel();
  r = await cmd.handle("your name is Nova", { surface: "call" });
  check("someone on a call can't rename it", r === null);
}

section("it calls itself by its name (any AI's reply, the personality, the prompt)");
{
  naming.setName("Nova");
  const f = naming.fixReply;
  check("“Hi! I'm Dayspring, your assistant.” → “Hi! I'm Nova, your assistant.”", f("Hi! I'm Dayspring, your assistant.") === "Hi! I'm Nova, your assistant.", f("Hi! I'm Dayspring, your assistant."));
  check("“Dayspring here!” → “Nova here!”", f("Dayspring here!") === "Nova here!");
  check("“This is Dayspring, signing off.” → Nova", f("This is Dayspring, signing off.") === "This is Nova, signing off.");
  check("“My name is Dayspring.” → Nova", f("My name is Dayspring.") === "My name is Nova.");
  check("the app stays the app: “Open Settings on the Dayspring screen.”", f("Open Settings on the Dayspring screen.") === "Open Settings on the Dayspring screen.");
  check("…and “Dayspring 1.8.0 is available”", f("Dayspring 1.8.0 is available (you have 1.7.2).") === "Dayspring 1.8.0 is available (you have 1.7.2).");
  check("the prompt note: its name, and never Dayspring as its name", /Your name is Nova\. Always call yourself Nova; "Dayspring" is only the name of the app/.test(naming.promptNote()), naming.promptNote());
  const persona = await import("../../lib/persona/index.mjs");
  check("the personality block (every AI's prompt) carries the note", /Your name is Nova/.test(persona.promptBlock()), persona.promptBlock());
  check("“What personality are you?” in the plain style says Nova", /regular Nova/.test(persona.describe()), persona.describe());
  // calls, Tune in, Discord voice and meetings stream the answer a sentence at a time (lib/calls/pipeline.mjs)
  const stream = await import("../../lib/calls/stream-llm.mjs");
  const pipeline = await import("../../lib/calls/pipeline.mjs");
  stream._setFake(async function* () { for (const p of ["I'm Dayspring! ", "Paris is the capital of France. ", "Dayspring here, anytime."]) yield p; });
  const got = [];
  const pr = await pipeline.reply({ text: "what's the capital of France", onSentence: (s) => got.push(s) });
  check("a streamed call answer that says “I'm Dayspring” comes out as Nova, sentence by sentence", got.join(" ") === "I'm Nova! Paris is the capital of France. Nova here, anytime." && /I'm Nova!/.test(pr.reply), got);
  const sys = await pipeline.systemFor({});
  check("the call pipeline's instructions say who it is (“Your name is Nova”)", /Your name is Nova/.test(sys), sys.slice(0, 200));
  stream._setFake(null);
  naming.setName("Dayspring");
  check("not renamed: no note, no change", naming.promptNote() === "" && f("I'm Dayspring.") === "I'm Dayspring.");
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed${fail ? "\n  " + failed.join("\n  ") : ""}`);
process.exit(fail ? 1 : 0);
