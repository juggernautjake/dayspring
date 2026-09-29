// Colour themes, avatars and expression mode (lib/looks, public/theme*.js, public/avatar*.js, public/looks-settings.js).
// Everything is mocked: no GIF service, AI or picture check is ever called (except with --live, below).
//   Part 1, in this process (a temp data folder): every theme's contrast (WCAG AA), the custom builder, theme names by
//     voice, the emotion classifier on a phrase corpus, the AI's hint, the personality → genre packs, GIF / WebP / MP4
//     loop lengths on fixture files, how long an expression shows, no repeats within the window, the picture-check gate
//     (mocked vision), the rating filter, expression mode off by default, the voice commands, the avatar pictures.
//   Part 2, a throwaway copy of the app (port 4773) in headless Chrome at 1280×720, 1920×1080 and the mini size: the
//     default look is byte-for-byte unchanged (the orb's pixels with the clock frozen, and every colour on the page),
//     each theme applies everywhere (a screenshot each: qa-out/themes/<id>.png), the five avatars render every state
//     and react to a mocked voice level, your picture breathes and grows while listening and switches per state with
//     the fallback, expression mode shows a GIF in the avatar's place (inside the safe area) for its loops and goes,
//     Settings → Look & feel works, and voice commands change the look.
//   node scripts/qa/themes-avatar.mjs [--module] [--keep] [--live]
//     --module  only part 1
//     --live    also one real search: 5 "cowboy excited" GIFs through the keyless web search, with their loop lengths
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(DESK, "scripts", "qa", "fixtures", "avatar");
const args = process.argv.slice(2), flag = (f) => args.includes(f);
const TMP = mkdtempSync(join(tmpdir(), "ds-looks-"));
const DATA = join(TMP, "data"); mkdirSync(DATA, { recursive: true });
Object.assign(process.env, { DAYSPRING_DATA_DIR: DATA, DAYSPRING_LOOKS_FILE: join(DATA, "looks.json"), DAYSPRING_AVATAR_DIR: join(DATA, "avatar"), DAYSPRING_EXPRESSIONS_DIR: join(DATA, "expressions"),
  DAYSPRING_EXPRESSION_PACKS: join(DATA, "expression-packs.json"), DAYSPRING_GIFS_FILE: join(DATA, "gifs.json"), DAYSPRING_GIFS_DIR: join(DATA, "gifs"), DAYSPRING_FEATURE_SWITCHES: join(DATA, "feature-switches.json") });
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" && got !== undefined ? "  (" + String(got).slice(0, 240) + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);

// ================================================================================================ part 1: the modules
await imp("public/theme-core.js");
const TC = globalThis.DsThemeCore;
{
  check("16 themes (the default + 15), including every one asked for", TC.THEMES.length >= 13 && ["rose", "sage", "forest", "ocean", "sunset", "lavender", "mint", "harvest", "crimson", "slate", "blossom", "emerald", "candy", "contrast", "day"].every((id) => TC.byId(id)), TC.THEMES.map((t) => t.id).join(","));
  check("the default theme's mapper changes nothing", TC.mapperFor(TC.byId("default")).identity === true && TC.mapperFor(null).css("color:#7c8cff") === "color:#7c8cff");
  for (const t of TC.THEMES) {
    const rep = TC.contrastReport(TC.tokensFor(t)), bad = rep.filter((r) => !r.ok);
    check(`theme ${t.name}: every text colour passes WCAG AA (${rep.length} pairs)`, !bad.length, bad.map((r) => `${r.pair} ${r.ratio}/${r.need}`).join("; ") || `lowest text ${Math.min(...rep.filter((r) => r.need === 4.5).map((r) => r.ratio))}:1`);
  }
  // luminance-preserving: in a dark theme every mapped colour keeps its brightness (except the lifted accents), so any
  // text/background pair keeps its contrast; the day theme keeps every ratio exactly while swapping dark and light
  const sample = ["#060812", "#eef0ff", "#a4abcc", "#8d94b8", "#121634", "rgba(20,24,50,.42)", "#b9c3ff", "#ffd27a", "#7ee3b0"];
  for (const id of ["rose", "slate", "day", "contrast"]) {
    const m = TC.mapperFor(TC.byId(id));
    const pairs = [["#eef0ff", "#060812"], ["#a4abcc", "#121634"], ["#8d94b8", "#060812"], ["#ffd27a", "#0b1026"]];
    const worst = Math.min(...pairs.map(([a, b]) => TC.contrast(m.rgb(TC.parse(a)), m.rgb(TC.parse(b))) / TC.contrast(a, b)));
    check(`theme ${id}: text/background pairs keep (or improve) their contrast after mapping`, worst > 0.98, `worst ratio kept ${worst.toFixed(3)}`);
    void sample;
  }
  const dm = TC.mapperFor(TC.byId("day"));
  check("the day theme turns the dark background light and the light text dark", TC.lum(dm.rgb(TC.parse("#060812"))) > 0.85 && TC.lum(dm.rgb(TC.parse("#eef0ff"))) < 0.02);
  check("a CSS text is mapped colour by colour (and stays valid)", /^background:linear-gradient\(90deg,#[0-9a-f]{6},rgba\(\d+,\d+,\d+,0\.5\)\)$/.test(TC.mapperFor(TC.byId("rose")).css("background:linear-gradient(90deg,#7c8cff,rgba(167,139,250,.5))")));
  // the custom builder: many random picks, all readable
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hexOf = () => "#" + [0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, "0")).join("");
  let customBad = [];
  for (let i = 0; i < 60; i++) {
    const colors = [hexOf(), hexOf(), ...(i % 3 ? [] : [hexOf()])], mode = i % 5 === 0 ? "light" : i % 7 === 0 ? "dark" : null;
    const t = TC.buildCustom({ colors, mode });
    const bad = TC.contrastReport(TC.tokensFor(t)).filter((r) => !r.ok);
    if (bad.length) customBad.push(`${colors.join("/")}${mode ? " " + mode : ""}: ${bad[0].pair} ${bad[0].ratio}`);
  }
  check("the custom builder: 60 random colour picks (dark, light, automatic) all give accessible palettes", !customBad.length, customBad.slice(0, 3).join(" | "));
  const pinkTeal = TC.buildCustom({ colors: ["#ff4fa3", "#20c9b7"] }), k = TC.tokensFor(pinkTeal);
  const hueOf = (c) => TC.rgb2hsl(TC.parse(c))[0];
  check("the custom builder keeps the picked hues (pink accent, teal secondary)", TC.hueDist(hueOf(k.accent), 330) < 25 && TC.hueDist(hueOf(k.secondary), 174) < 25, `${k.accent} ${k.secondary}`);
  check("a light background colour makes a light theme", TC.buildCustom({ colors: ["#3355ff", "#aa33ff", "#f4f1ea"] }).params.mode === "light");
  const words = [["switch to the pink theme", "rose"], ["green theme", "sage"], ["default theme", "default"], ["use the ocean theme", "ocean"], ["cherry blossom", "blossom"], ["high contrast please", "contrast"], ["candy theme", "candy"], ["the red one", "crimson"], ["light mode", "day"], ["dark green", "forest"]];
  const wrong = words.filter(([w, id]) => TC.findByWords(w)?.id !== id);
  check(`theme names by voice (${words.length} phrases)`, !wrong.length, wrong.map(([w]) => `${w} → ${TC.findByWords(w)?.id}`).join("; "));
  check("Surprise me never repeats the current theme", Array.from({ length: 40 }, () => TC.surprise("rose")).every((t) => t.id !== "rose"));
}

// ---- emotions ----
const emo = await imp("lib/looks/emotion.mjs");
{
  const CORPUS = [
    ["Congratulations, you earned a new badge!", "celebrate"], ["You did it! Three weeks in a row!", "celebrate"], ["Level up! You're level 5 now.", "celebrate"],
    ["I'm so proud of you, that was great work.", "proud"], ["Well done on finishing the chapter.", "proud"], ["Nice work, you nailed it.", "proud"],
    ["Oh this is amazing! Let's go!", "excited"], ["Yay, pizza night!", "excited"], ["I can't wait for the trip!!", "excited"],
    ["Glad to hear it. Sounds great.", "happy"], ["What a lovely sunny day.", "happy"],
    ["Hmm, let me think about that.", "thinking"], ["Good question. Let's see.", "thinking"], ["Do you want me to add it to tomorrow?", "thinking"],
    ["I'm not sure what you mean. Which one did you mean?", "confused"], ["Sorry, I didn't catch that.", "confused"],
    ["Whoa, no way! Really?", "surprised"], ["Wow, that's incredible.", "surprised"],
    ["I'm so sorry. That's really hard.", "sad"], ["Sorry to hear that. I'm here for you.", "sad"], ["Hang in there, sending you hugs.", "sad"],
    ["Ugh, not again. That's annoying.", "upset"], ["Seriously? Come on.", "upset"],
    ["Good night, sleep well.", "sleepy"], ["Time for bed. Sweet dreams.", "sleepy"],
    ["Haha, that's so funny!", "laughing"], ["Lol, good one.", "laughing"], ["Knock knock. Who's there?", "laughing"],
    ["You've got this. One step at a time.", "encourage"], ["Keep going, you're almost there!", "encourage"], ["Don't give up, I believe in you.", "encourage"],
    ["Thank you so much!", "grateful"], ["Thanks, I appreciate it.", "grateful"],
    ["Good morning! Welcome back.", "greeting"], ["Hey there, nice to see you.", "greeting"],
    ["Goodbye, see you tomorrow!", "goodbye"], ["Talk to you later, take care.", "goodbye"],
    ["Oops, my bad. Something went wrong.", "oops"], ["That didn't work. I couldn't reach the calendar.", "oops"],
    ["Heads up: your meeting starts in 5 minutes.", "alert"], ["Wake up! Your alarm is going off.", "alert"], ["Don't forget your medicine.", "alert"],
    ["Okay, done.", "agree"], ["Sounds good, will do.", "agree"], ["Got it.", "agree"],
  ];
  const miss = CORPUS.filter(([t, e]) => emo.classify(t).emotion !== e);
  check(`emotion detection: ${CORPUS.length - miss.length}/${CORPUS.length} phrases right (needs 90%)`, (CORPUS.length - miss.length) / CORPUS.length >= 0.9, miss.map(([t, e]) => `"${t}" → ${emo.classify(t).emotion} (want ${e})`).slice(0, 4).join(" | "));
  const neutral = ["Your next block is Laundry at 3 PM.", "It's 72 degrees in Springfield.", "The capital of France is Paris."];
  check("plain facts don't claim a strong feeling", neutral.every((t) => emo.classify(t).confidence < 0.42), neutral.map((t) => emo.classify(t).confidence).join(","));
  check("events: a badge celebrates, an alarm alerts, an error is oops", emo.classify("", { event: "badge" }).emotion === "celebrate" && emo.classify("", { event: "alarm" }).emotion === "alert" && emo.classify("Back online.", { event: "error" }).emotion === "oops");
  check("the AI's hint counts (a neutral line, hinted as proud)", emo.classify("That's everything for today.", { hint: "proud" }).emotion === "proud");
  const h = emo.extractHint("⟪mood:excited⟫ Let's do it!");
  check("the AI's hidden mood tag comes off and becomes the hint", h.mood === "excited" && h.text === "Let's do it!" && emo.extractHint("[mood: celebrating] Yay").mood === "celebrate" && emo.extractHint("No tag here.").mood === null);
}

// ---- personality packs ----
const packs = await imp("lib/looks/packs.mjs");
{
  const { PRESETS } = await imp("lib/persona/presets.mjs"), { SECRETS } = await imp("lib/persona/secrets.mjs");
  const allIds = [...PRESETS.map((p) => p.id), ...SECRETS.map((s) => s.id)];
  const missing = allIds.filter((id) => packs.packFor(id).id !== id);
  check(`every personality and secret character has its own pack (${allIds.length})`, !missing.length, missing.join(","));
  const thin = [];
  for (const id of packs.ids()) for (const e of emo.EMOTION_IDS) if (packs.queriesFor(id, e).length < 5) thin.push(`${id}/${e}`);
  check(`every pack has at least 5 searches for each of the ${emo.EMOTION_IDS.length} feelings`, !thin.length, thin.slice(0, 5).join(","));
  const G = { cowboy: /cowboy|western|yeehaw|rodeo|horse|howdy|saloon|sheriff|trails|giddy/, robot: /robot|computer|android|sci fi|tech|beep|compute|glitch|power/, maiden: /princess|queen|royal|castle|fairy|curtsy|medieval|carriage|hear ye/, broski: /bro|gym|workout|dude|rep|gains|surfer|flex|rise and grind/, sage: /master|space|galaxy|star|cosmic|mystic|meditat|rocket|alien|mentor|namaste|planet/ };
  for (const [id, re] of Object.entries(G)) {
    const qs = emo.EMOTION_IDS.flatMap((e) => packs.queriesFor(id, e));
    const off = qs.filter((q) => !re.test(q));
    check(`${id}: every search is in its genre (${packs.packFor(id).genre})`, !off.length, off.slice(0, 4).join(" | "));
  }
  check('the searches pair personality and feeling ("cowboy excited yeehaw", "robot confused error")', packs.queriesFor("cowboy", "excited").includes("cowboy excited yeehaw") && packs.queriesFor("robot", "confused").includes("robot confused error"));
  const tm = /\b(yoda|star wars|jedi|sith|lightsaber|darth|skywalker|marvel|disney|pixar)\b/i;
  const allQ = packs.ids().flatMap((id) => emo.EMOTION_IDS.flatMap((e) => packs.queriesFor(id, e, 40)));
  check("no brand or franchise names in any search (generic words only)", !allQ.some((q) => tm.test(q)), allQ.filter((q) => tm.test(q)).slice(0, 3).join(","));
  check("genre check: a western title fits the cowboy, a robot one doesn't", packs.genreMatch("cowboy", "Happy Cowboy Tips Hat GIF") && !packs.genreMatch("cowboy", "happy robot dance") && packs.genreMatch("robot", "retro robot beep boop"));
  check("the default pack takes anything wholesome", packs.genreMatch("default", "cute puppy"));
  check("the feeling check: a 'crying' GIF doesn't fit excitement", !packs.emotionFit("excited", "sad crying cowboy").ok && packs.emotionFit("excited", "cowboy yeehaw excited").ok);
  check("never shown: violence, weapons, alcohol, rude words", ["cowboy gun shooting", "wtf reaction", "drunk party", "scary jumpscare"].every((t) => packs.blocked(t)) && !packs.blocked("happy dance hello"));
  writeFileSync(process.env.DAYSPRING_EXPRESSION_PACKS, JSON.stringify({ packs: { cowboy: { queries: { excited: ["my own yeehaw search"] } }, newguy: { genre: "tests", subjects: ["test"], match: ["test"], queries: {} } } }));
  packs._reset();
  check("the owner's data/expression-packs.json is merged over the built-in packs", packs.queriesFor("cowboy", "excited")[0] === "my own yeehaw search" && packs.packFor("newguy").genre === "tests" && packs.packFor("cowboy").match.includes("saloon"));
  rmSync(process.env.DAYSPRING_EXPRESSION_PACKS, { force: true }); packs._reset();
}

// ---- loop lengths on fixture files ----
const gm = await imp("lib/looks/gifmeta.mjs");
{
  const manifest = JSON.parse(readFileSync(join(FIX, "manifest.json"), "utf8"));
  for (const [name, want] of Object.entries(manifest)) {
    const got = gm.mediaInfo(readFileSync(join(FIX, name)));
    const ok = Object.entries(want).every(([k, v]) => got[k] === v);
    check(`loop length: ${name}`, ok, `${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
  let threw = false; try { gm.gifInfo(Buffer.from("not a gif at all")); } catch { threw = true; }
  check("a file that isn't a GIF is refused, not guessed", threw && gm.mediaInfo(Buffer.from("hello")).animated === false);
  const P = gm.planDuration;
  const cases = [[500, 0, (r) => r.loops >= 2 && r.ms >= 1000 && r.ms % 500 === 0], [3000, 0, (r) => r.loops === 1 && r.ms === 3000], [500, 4000, (r) => r.ms === 4000 && r.loops === 8],
    [2000, 4200, (r) => r.loops === 2 && r.ms === 4000], [6000, 3000, (r) => r.loops === 1 && r.ms === 6000], [30000, 2500, (r) => r.ms <= 12000 && r.ms >= 2500], [0, 3000, (r) => r.ms === 3000 && r.loops === 0], [1800, 1000, (r) => r.ms === 1800]];
  const badP = cases.filter(([l, s, f]) => !f(P(l, s)));
  check(`how long an expression shows: whole loops, 1–2 of a medium loop, fitted to the speech (${cases.length} cases)`, !badP.length, badP.map(([l, s]) => `${l}/${s} → ${JSON.stringify(P(l, s))}`).join(" | "));
}

// ---- the library: picking, no repeats, the picture-check gate, the rating filter ----
const looks = await imp("lib/looks/index.mjs");
const ex = await imp("lib/looks/expressions.mjs");
looks.setDeps({ persona: { get: () => ({ preset: "cowboy", activeTemplate: null, templates: [] }), onChange: () => {} }, broadcast: () => {} });
{
  check("expression mode is off by default", looks.settings().expression.on === false && (await ex.pick({ text: "Congratulations!!" })).show === false);
  check("the default look: the default theme and the orb", looks.settings().theme === "default" && looks.settings().avatar.style === "orb" && (await looks.effective()).theme.id === "default");
  check("expressions default to PG, never higher than PG-13", looks.settings().expression.rating === "pg" && (() => { try { looks.set({ expression: { rating: "r" } }); return false; } catch { return true; } })());
  // a library of 20 western "excited" GIFs
  mkdirSync(join(DATA, "expressions", "media"), { recursive: true });
  const L = { items: {}, verdicts: {}, recent: [], cursors: {}, searches: [], lastShown: 0 };
  for (let i = 0; i < 20; i++) { const id = `cowboy.excited.${i}`; writeFileSync(join(DATA, "expressions", "media", `f${i}.gif`), readFileSync(join(FIX, "three-frames.gif"))); L.items[id] = { id, key: `k${i}`, pack: "cowboy", emotion: "excited", title: `Cowboy yeehaw ${i}`, file: `f${i}.gif`, type: "image/gif", bytes: 80, loopMs: 500, verdict: { ok: true }, addedAt: i, uses: 0, lastUsed: 0 }; }
  writeFileSync(join(DATA, "expressions", "index.json"), JSON.stringify(L)); ex._reload();
  looks.set({ expression: { on: true, often: "always", noRepeat: 12, web: false } });
  let t = 1_000_000; ex.setDeps({ now: () => (t += 60_000) });
  const seq = [];
  for (let i = 0; i < 200; i++) { const r = await ex.pick({ text: "Yeehaw, that's amazing!!", persona: "cowboy", speechMs: 2000 }); if (r.show) seq.push(r.item.id); }
  let rep = 0; for (let i = 0; i < seq.length; i++) if (seq.slice(Math.max(0, i - 12), i).includes(seq[i])) rep++;
  check("no repeats: 200 picks from 20 GIFs, none repeats within the last 12", seq.length === 200 && rep === 0, `${seq.length} shown, ${rep} repeats`);
  check("every GIF gets its turn (the weighting favours the fresh)", new Set(seq).size === 20, `${new Set(seq).size} different`);
  const counts = Object.values(seq.reduce((a, id) => ((a[id] = (a[id] ?? 0) + 1), a), {}));
  check("the uses even out (fresh and less-used first)", Math.max(...counts) - Math.min(...counts) <= 6, `${Math.min(...counts)}–${Math.max(...counts)} uses each`);
  const r1 = await ex.pick({ text: "Yeehaw, that's amazing!!", persona: "cowboy", speechMs: 2000 });
  check("a pick says how long to show it: whole loops of its own length (5 × 0.5 s for 2 s of speech: never under 2.5 s)", r1.item.loopMs === 500 && r1.item.plan.ms === 2500 && r1.item.plan.loops === 5, JSON.stringify(r1.item.plan));
  // a small library: the window shrinks so something can always be shown
  const L2 = { ...L, items: Object.fromEntries(Object.entries(L.items).slice(0, 3)), recent: [] };
  writeFileSync(join(DATA, "expressions", "index.json"), JSON.stringify(L2)); ex._reload();
  const seq2 = []; for (let i = 0; i < 30; i++) seq2.push((await ex.pick({ text: "Yeehaw!! amazing", persona: "cowboy" })).item?.id);
  check("with only 3, it never shows the same one twice in a row, and never gets stuck", seq2.every(Boolean) && seq2.every((id, i) => i === 0 || id !== seq2[i - 1]));
  check("the robot never gets the cowboy's GIFs (nothing in its pack: nothing shown)", (await ex.pick({ text: "Yeehaw!! amazing", persona: "robot" })).show === false);
  check("the default personality falls back to Dayspring's own sticker", (await ex.pick({ text: "Congratulations, you did it!", persona: "default" })).item?.sticker === true);
  looks.set({ expression: { often: "sometimes" } });
  check("\"sometimes\": a plain line doesn't get a GIF", (await ex.pick({ text: "Your next block is Study at 3 PM.", persona: "cowboy" })).show === false);

  // the gate, with mocked search / media / vision
  const gifBuf = readFileSync(join(FIX, "three-frames.gif"));
  const item = (id, title, rating = "pg", tags = []) => ({ id: `mock:${id}`, canonical: `mock:${id}`, source: "mock", sourceId: id, title, tags, rating, preview: `https://gifs.fixture.test/${id}.gif`, gif: `https://gifs.fixture.test/${id}.gif`, page: `https://gifs.fixture.test/page/${id}` });
  let genreOverride = null, describeCalls = 0, describeReply = "FITS: yes\nSAFE: yes\nGENRE: yes\nA happy cowboy throwing his hat.", ocrText = "";
  ex.setDeps({
    now: () => (t += 1000), searchGapMs: 0, hourlySearches: 1000,
    search: async ({ q, rating }) => ({ items: [item("a", "Cowboy yeehaw celebration", "g"), item("b", "Cowboy yeehaw hat", "pg"), item("c", "Rodeo party cowboy", "pg-13"), item("d", "Cowboy rodeo wild", "r"), item("e", "Cowboy no rating", null), item("f", "Sad crying cowboy", "g"), item("g", "Cowboy gun shooting", "g"), item("h", "Happy dance party", "g"), item("i", "Western horse yeehaw", "pg")].map((x) => ({ ...x, q, askedRating: rating })), attribution: { mock: { text: "Mock GIFs" } } }),
    fetchMedia: async () => ({ buf: gifBuf, type: "image/gif" }),
    aiUsable: async () => ({ usable: true }),
    describe: async ({ question, ai }) => { describeCalls++; const g = genreOverride ?? (/cowboy|western|rodeo|horse/i.test(/titled "([^"]*)"/.exec(question)?.[1] ?? "") ? "yes" : "no"); return ai === false ? { usedAI: false, text: "", ocr: { text: ocrText } } : { usedAI: true, text: describeReply.replace(/GENRE: (yes|no)/, "GENRE: " + g), ocr: { text: ocrText }, question }; },
    webAllowed: async () => true,
  });
  writeFileSync(join(DATA, "expressions", "index.json"), JSON.stringify({ items: {}, verdicts: {}, recent: [], cursors: {}, searches: [] })); ex._reload();
  looks.set({ expression: { rating: "pg", vision: true, web: true } });
  const r = await ex.fetchBatch("cowboy", "excited", { want: 20 });
  const kept = ex.items({ pack: "cowboy", emotion: "excited" }).map((x) => x.title).sort();
  check("the rating filter: PG keeps G and PG, drops PG-13, R and unrated", kept.includes("Cowboy yeehaw celebration") && kept.includes("Cowboy yeehaw hat") && !kept.includes("Rodeo party cowboy") && !kept.includes("Cowboy rodeo wild") && !kept.includes("Cowboy no rating"), kept.join(" | "));
  check("the gate: a 'sad crying' title never fits excitement, a 'gun' title is never kept, an off-genre one is left out", !kept.includes("Sad crying cowboy") && !kept.includes("Cowboy gun shooting") && !kept.includes("Happy dance party"), `${r.added} added, ${r.rejected} left out`);
  check("each kept GIF has its loop length, verdict and attribution", ex.items({ pack: "cowboy" }).every((x) => x.loopMs === 500 && x.verdict?.ok && x.attribution?.text === "Mock GIFs"));
  const calls1 = describeCalls;
  await ex.fetchBatch("cowboy", "excited", { want: 20 });
  check("verdicts are cached: the same GIFs aren't checked twice", describeCalls === calls1, `${calls1} then ${describeCalls}`);
  // the AI says no, the text in it says no
  writeFileSync(join(DATA, "expressions", "index.json"), JSON.stringify({ items: {}, verdicts: {}, recent: [], cursors: {}, searches: [] })); ex._reload();
  describeReply = "FITS: yes\nSAFE: no\nThere is a rude gesture."; await ex.fetchBatch("cowboy", "excited", { want: 20 });
  check("the picture check: 'not safe' keeps it out", ex.items({ pack: "cowboy" }).length === 0);
  writeFileSync(join(DATA, "expressions", "index.json"), JSON.stringify({ items: {}, verdicts: {}, recent: [], cursors: {}, searches: [] })); ex._reload();
  describeReply = "FITS: no\nSAFE: yes\nThe cowboy looks bored."; await ex.fetchBatch("cowboy", "excited", { want: 20 });
  check("the picture check: 'doesn't fit the feeling' keeps it out", ex.items({ pack: "cowboy" }).length === 0);
  writeFileSync(join(DATA, "expressions", "index.json"), JSON.stringify({ items: {}, verdicts: {}, recent: [], cursors: {}, searches: [] })); ex._reload();
  describeReply = "FITS: yes\nSAFE: yes\nGENRE: yes\nFine."; ocrText = "SO SAD TODAY"; await ex.fetchBatch("cowboy", "excited", { want: 20 });
  check("text in the picture that contradicts the feeling keeps it out", ex.items({ pack: "cowboy" }).length === 0);
  ocrText = "";
  const v1 = await ex.verify({ title: "Happy dance", tags: [] }, gifBuf, { pack: "cowboy", emotion: "excited", ai: { usable: false } });
  genreOverride = "yes"; describeReply = "FITS: yes\nSAFE: yes\nGENRE: yes\nA cowboy dancing."; const v2 = await ex.verify({ title: "Happy dance", tags: [] }, gifBuf, { pack: "cowboy", emotion: "excited", ai: { usable: true } }); genreOverride = null;
  check("off-genre words need the picture check to say it's western (without it: left out)", v1.ok === false && v2.ok === true, `${v1.reason} / ${v2.by}`);
  check("the AI's verdict line is read", ex.parseVerdict("FITS: yes\nSAFE: no\nGENRE: yes\nbecause").safe === false && ex.parseVerdict("nothing") === null);
  // G is stricter still
  writeFileSync(join(DATA, "expressions", "index.json"), JSON.stringify({ items: {}, verdicts: {}, recent: [], cursors: {}, searches: [] })); ex._reload();
  looks.set({ expression: { rating: "g" } }); describeReply = "FITS: yes\nSAFE: yes\nGENRE: yes\nok";
  await ex.fetchBatch("cowboy", "excited", { want: 20 });
  check("the rating filter at G keeps only G", ex.items({ pack: "cowboy" }).every((x) => x.rating === "g") && ex.items({ pack: "cowboy" }).length >= 1);
  looks.set({ expression: { rating: "pg" } });
  // the web switched off (Permissions): nothing is searched
  ex.setDeps({ webAllowed: async () => false });
  check("with web look-ups off (Settings → Permissions), nothing is searched", /Permissions/.test((await ex.fetchBatch("cowboy", "happy")).why ?? ""));
  ex.setDeps({ webAllowed: async () => true });
  // the owner's own
  const own = ex.addOwn(readFileSync(join(FIX, "anim.webp")), { emotion: "laughing", persona: "robot", title: "my robot laugh" });
  check("your own GIF: kept with its loop length (600 ms) for the robot's laughing", own.own && own.loopMs === 600 && own.pack === "robot");
  let bad415 = false; try { ex.addOwn(Buffer.from("plain text"), { emotion: "happy" }); } catch (e) { bad415 = e.status === 415; }
  check("an upload that isn't a picture is refused", bad415);
  const rOwn = await ex.pick({ text: "Haha, that's hilarious!", persona: "robot", force: true });
  check("your own GIF is picked for its personality and feeling", rOwn.item?.id === own.id, JSON.stringify(rOwn).slice(0, 120));
  // the build: progress, finishing
  ex.setDeps({ search: async ({ q }) => ({ items: [0, 1, 2, 3, 4, 5].map((i) => item(`${q.replace(/\W+/g, "")}${i}`, `cowboy ${q} ${i}`, "g")), attribution: {} }) });
  const b0 = ex.build({ personas: ["cowboy"], perCombo: 3, emotions: ["happy", "proud"] });
  check("Build my expression library: starts, with a total", b0.running && b0.total === 2);
  for (let i = 0; i < 100 && ex.buildStatus().running; i++) await sleep(50);
  const b1 = ex.buildStatus();
  check("the build finishes with its progress counted", !b1.running && b1.done === 2 && b1.added >= 6 && ex.items({ pack: "cowboy", emotion: "happy" }).length >= 3, JSON.stringify(b1).slice(0, 200));
  // the size cap
  looks.set({ expression: { maxMB: 20 } });
  const before = ex.library().total;
  const Lx = JSON.parse(readFileSync(join(DATA, "expressions", "index.json"), "utf8")); for (const x of Object.values(Lx.items)) if (!x.own) x.bytes = 3 * 1024 * 1024;
  writeFileSync(join(DATA, "expressions", "index.json"), JSON.stringify(Lx)); ex._reload();
  ex.prune(20);
  check("the size cap: the least-used go first, your own are never removed", ex.library().total < before && ex.items({}).some((x) => x.own) && ex.library().bytes <= 20 * 1024 * 1024 + 1e6, `${before} → ${ex.library().total}`);
}

// ---- the look: saving, personalities, templates, voice, pictures ----
{
  looks._reload();
  looks.set({ theme: "default", avatar: { style: "orb" } });
  const said = async (t) => looks.handle(t);
  const cases = [
    ["switch to the pink theme", () => looks.settings().theme === "rose"], ["green theme", () => looks.settings().theme === "sage"], ["default theme", () => looks.settings().theme === "default"],
    ["use the blob avatar", () => looks.settings().avatar.style === "blob"], ["change your avatar", () => looks.settings().avatar.style === "halo"], ["go back to the orb", () => looks.settings().avatar.style === "orb"],
    ["use the pixel avatar", () => looks.settings().avatar.style === "pixel"], ["turn on expression mode", () => looks.settings().expression.on === true], ["stop using gifs", () => looks.settings().expression.on === false],
  ];
  const badV = [];
  for (const [t, ok] of cases) { const r = await said(t); if (!r || !ok()) badV.push(`${t} → ${r}`); }
  check(`voice: ${cases.length} look commands work`, !badV.length, badV.join(" | "));
  const notMine = ["make it rain", "switch to cozy mode", "change the sky colors", "what's the weather", "play some music", "use the forest scene"];
  const grabbed = []; for (const t of notMine) if (await said(t)) grabbed.push(t);
  check("voice: sky and other commands are left alone", !grabbed.length, grabbed.join(","));
  looks.set({ avatar: { style: "orb" }, theme: "default" });
  looks.setForPersona("cowboy", { avatar: "pixel", theme: "harvest" });
  const e1 = await looks.effective();
  check("a personality's own look shows for it (the cowboy: Harvest Gold and the Pixel pal)", e1.theme.id === "harvest" && e1.avatar.style === "pixel" && e1.themeFrom === "personality");
  looks.setDeps({ persona: { get: () => ({ preset: "robot", activeTemplate: "t1", templates: [{ id: "t1", name: "Work mode" }] }), onChange: () => {} } });
  check("…and not for another personality", (await looks.effective()).theme.id === "default");
  await looks.rememberForTemplate("t1", { name: "Work mode" });
  looks.set({ theme: "ocean", avatar: { style: "blob" } });
  const e2 = await looks.effective();
  check("a template remembers its look (it wins over the everyday choice)", e2.theme.id === "default" && e2.avatar.style === "orb" && e2.themeFrom === "template");
  looks.forgetTemplate("t1");
  check("…until it's told to forget it", (await looks.effective()).theme.id === "ocean");
  // pictures
  let refused = false; try { looks.saveImage("idle", Buffer.from("definitely not a picture")); } catch (e) { refused = e.status === 415; }
  check("an avatar upload that isn't a JPEG/PNG/WebP/GIF is refused", refused);
  const up = looks.saveImage("idle", readFileSync(join(FIX, "avatar-idle.png")));
  looks.saveImage("listen", readFileSync(join(FIX, "avatar-listen.png")));
  check("avatar pictures are kept in data/avatar, one per state", existsSync(join(DATA, "avatar", up.file)) && Object.keys(looks.imageUrls()).sort().join() === "idle,listen");
  looks.removeImage("listen");
  check("a state's picture can be removed (it falls back to the main picture)", !looks.imageUrls().listen && looks.imageUrls().idle);
  let badState = false; try { looks.saveImage("dancing", readFileSync(join(FIX, "avatar-idle.png"))); } catch { badState = true; }
  check("only the eight states take pictures", badState && looks.STATES.length === 8);
}
console.log(`\npart 1: ${pass} passed, ${fail} failed`);

// ================================================================================================ the live smoke (--live)
if (flag("--live")) {
  const g = await imp("lib/gifs/index.mjs"), media = await imp("lib/gifs/media.mjs");
  const ses = await g.searchOnce({ mode: "search", q: "cowboy excited yeehaw", rating: "pg", type: "gif", providers: ["web"] });
  const got = [];
  for (const it of ses.items) {
    if (got.length >= 5) break;
    try { const m = await media.fetchMedia(it.preview ?? it.gif, { maxBytes: 8 * 1024 * 1024 }); const info = gm.mediaInfo(m.buf, m.type); if (!info.animated) continue; got.push({ title: it.title, loopMs: info.loopMs, frames: info.frames, bytes: m.buf.length, from: new URL(it.page ?? it.gif).hostname, genre: packs.genreMatch("cowboy", [it.title, it.page].join(" ")) }); }
    catch (e) { void e; }
  }
  console.log("\nLIVE: 5 \"cowboy excited\" GIFs through the keyless web search:");
  for (const x of got) console.log(`  ${(x.loopMs / 1000).toFixed(2)} s loop, ${x.frames} frames, ${Math.round(x.bytes / 1024)} KB, ${x.genre ? "western words ✓" : "no western words"}  ${x.title.slice(0, 60)}  (${x.from})`);
  check("live: 5 animated cowboy GIFs found, each with a loop length", got.length === 5 && got.every((x) => x.loopMs > 0), `${got.length} found`);
}

if (flag("--module")) { rmSync(TMP, { recursive: true, force: true }); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

// ================================================================================================ part 2: the screen
// playwright-core from the exported copy next to this project (…/dayspring-app), else this app's own; QA_PLAYWRIGHT overrides
const PW = process.env.QA_PLAYWRIGHT ?? pathToFileURL([join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
if (!PW || PW === "file:///") { check("playwright-core is there", false); process.exit(1); }
const { chromium } = await import(PW);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 4773, BASE = `http://127.0.0.1:${PORT}`, APP = join(TMP, "app");
const SHOTS = join(DESK, "qa-out", "themes"); mkdirSync(SHOTS, { recursive: true });
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA", DAYSPRING_NO_HEADLESS_SEARCH: "1", DAYSPRING_CHANNEL: "dev" };   // (dev: the GIF window is on too)
for (const k of ["DAYSPRING_DATA_DIR", "DAYSPRING_LOOKS_FILE", "DAYSPRING_AVATAR_DIR", "DAYSPRING_EXPRESSIONS_DIR", "DAYSPRING_EXPRESSION_PACKS", "DAYSPRING_GIFS_FILE", "DAYSPRING_GIFS_DIR", "DAYSPRING_FEATURE_SWITCHES"]) delete env[k];
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
let isUp = false; for (let i = 0; i < 120 && !(isUp = await up()); i++) await sleep(500);
check("the throwaway server is up", isUp, serverLog.slice(-300));
const api = async (path, body, method) => { const r = await fetch(BASE + "/api" + path, body === undefined && !method ? {} : { method: method ?? "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); };
const rawUp = async (path, buf, type) => (await fetch(BASE + "/api" + path, { method: "POST", headers: { "content-type": type }, body: buf })).json();

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
const mock = () => {
  window.__dsAllowAutomatedListen = true;
  const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; }
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
};
// the clock frozen and chance fixed, so the orb draws the same picture every time (for the pixel check)
const freeze = () => {
  let s = 12345; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const q = []; window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  window.__step = (t) => { const run = q.splice(0); for (const cb of run) { try { cb(t); } catch { /* one callback's problem */ } } return run.length; };
};
const DEVICE_ROUTES = /\/api\/(sound|window|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge|open|app\/quit|update)/;
async function page(w, h, path = "/display", { frozen = false, noTheme = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(mock);
  if (frozen) await ctx.addInitScript(freeze);
  await ctx.route("**/*", (rt) => {
    const u = rt.request().url();
    if (noTheme && /\/theme(-core)?\.js$/.test(u)) return rt.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    if (rt.request().method() === "POST" && DEVICE_ROUTES.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    return rt.continue();
  });
  const p = await ctx.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e.stack || e.message).slice(0, 300)));
  await p.goto(BASE + path); await p.waitForTimeout(frozen ? 1500 : 2200);
  if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(500); }
  return p;
}
// every colour the page shows, for a fixed set of elements (the "DOM snapshot")
const colourSnapshot = (p) => p.evaluate(() => {
  const sel = ["body", ".card", ".label", ".clock .t span", ".clock .d", ".now", ".presence .cap", "#mic", ".btn", "button", "a", "#talkStatus", ".chip", "select", ".now .rail", ".talk"];
  const props = ["color", "background-color", "background-image", "border-color", "box-shadow", "outline-color", "text-shadow", "fill", "stroke"];
  const out = {};
  for (const s of sel) { const e = document.querySelector(s); if (!e) continue; const cs = getComputedStyle(e); out[s] = props.map((k) => cs.getPropertyValue(k)).join(" | "); }
  const root = getComputedStyle(document.documentElement); out[":root"] = ["--indigo", "--violet", "--blue", "--ink", "--muted", "--dim", "--edge", "--edge2"].map((v) => root.getPropertyValue(v)).join(" | ");
  return out;
});
const orbHash = (p) => p.evaluate(() => { for (let i = 0; i < 3; i++) window.__step(1000 + i * 16); return document.getElementById("viz").toDataURL(); }).then((d) => createHash("sha1").update(d).digest("hex"));

// ---- the default look is unchanged ----
// (a fixed sky: night, clear, fall, the hills, a set time, so two page loads draw the same world)
const FIXED = "/display?sky=night&weather=clear&season=fall&scene=hills&wind=5&winddir=200&t=21:30";
{
  await api("/looks", { theme: "default", avatar: { style: "orb" } });
  const pa = await page(1280, 720, FIXED, { frozen: true, noTheme: true });
  const baseHash = await orbHash(pa), baseCol = await colourSnapshot(pa);
  const pb = await page(1280, 720, FIXED, { frozen: true });
  const hashB = await orbHash(pb), colB = await colourSnapshot(pb);
  check("the default look: the orb's pixels are identical with the theme engine loaded (frozen clock)", baseHash === hashB, `${baseHash.slice(0, 10)} vs ${hashB.slice(0, 10)}`);
  const diffB = Object.keys(baseCol).filter((k) => baseCol[k] !== colB[k]);
  check("the default look: every colour on the screen is identical with the theme engine loaded", !diffB.length, diffB.slice(0, 3).map((k) => `${k}: ${baseCol[k].slice(0, 60)} → ${colB[k]?.slice(0, 60)}`).join(" | "));
  // switch to Rose and back to the default, in the same page
  await pb.evaluate(() => window.dsThemeApply("rose")); await pb.waitForTimeout(300);
  const colRose = await colourSnapshot(pb);
  check("switching to Rose changes the colours", Object.keys(baseCol).some((k) => baseCol[k] !== colRose[k]));
  await pb.evaluate(() => window.dsThemeApply(null)); await pb.waitForTimeout(1600);   // (some colours glide over 1 s)
  const colBack = await colourSnapshot(pb), hashBack = await orbHash(pb);
  const diffBack = Object.keys(baseCol).filter((k) => baseCol[k] !== colBack[k]);
  check("…and back to the default puts every colour back exactly", !diffBack.length, diffBack.slice(0, 2).map((k) => `${k}: ${baseCol[k].slice(0, 50)} → ${colBack[k]?.slice(0, 50)}`).join(" | "));
  const pc = await page(1280, 720, FIXED, { frozen: true });
  check("the orb is still the orb with the default theme (a fresh page, same pixels)", (await orbHash(pc)) === baseHash);
  check("the default look: no avatar layer is showing", await pb.evaluate(() => document.getElementById("dsAvatar")?.hidden === true && document.getElementById("presence").dataset.avatar === "orb"));
  check("no page errors (default look)", !pa.errs.length && !pb.errs.length, [...pa.errs, ...pb.errs].slice(0, 2).join(" | "));
  for (const p of [pa, pb, pc]) await p.context().close();
}

// ---- every theme applies everywhere, with a screenshot each ----
{
  const p = await page(1280, 720);
  const shots = [];
  for (const t of TC.THEMES) {
    await api("/looks/theme", { id: t.id });
    await p.waitForFunction((id) => (id === "default" ? !document.documentElement.dataset.dsTheme : document.documentElement.dataset.dsTheme === id), t.id, { timeout: 6000 }).catch(() => {});
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      // what's left of the default look's own colours in the page's stylesheets
      let left = 0, total = 0;
      for (const s of document.styleSheets) { let rules; try { rules = s.cssRules; } catch { continue; } const walk = (list) => { for (const x of list) { if (x.style) for (let i = 0; i < x.style.length; i++) { const v = x.style.getPropertyValue(x.style[i]); if (/rgb|#/.test(v)) { total++; if (/rgba?\(\s*124,\s*140,\s*255|rgba?\(\s*167,\s*139,\s*250|#7c8cff|#a78bfa/i.test(v)) left++; } } if (x.cssRules) walk(x.cssRules); } }; walk(rules); }
      const b = getComputedStyle(document.body), lbl = document.querySelector(".label");
      // the quieter text as drawn (labels, times, the date): solid, not faded away
      const quiet = [".label", ".clock .d", ".now .time", ".next .when", ".talkfoot button", ".tl .t"].map((q) => document.querySelector(q)).filter(Boolean).map((e) => getComputedStyle(e).color);
      return { theme: document.documentElement.dataset.dsTheme ?? "default", left, total, ink: b.color, quiet, bg: window.dsTheme?.tokens?.bg ?? "#060812", mode: window.dsTheme?.mode ?? "dark" };
    });
    const file = join(SHOTS, `${t.id}.png`);
    await p.screenshot({ path: file });
    shots.push(file);
    const rgbOf = (c) => { const m = /rgba?\(([^)]*)\)/.exec(c); if (!m) return null; const n = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [n[0], n[1], n[2], n[3] ?? 1]; };
    const faint = r.quiet.map(rgbOf).filter((c) => !c || c[3] < 0.99 || TC.contrast(c.slice(0, 3), TC.parse(r.bg)) < 4.5);
    check(`theme ${t.name}: the quieter text (labels, times, the date) is solid and readable (4.5:1 on the page colour)`, r.quiet.length >= 2 && !faint.length, `${r.quiet.length} checked; ${faint.map((c) => c?.join(",")).join(" | ")}`);
    check(`theme ${t.name}: applied to the screen${t.id === "default" ? "" : ", no default indigo/violet left in its stylesheets"}`, r.theme === t.id && (t.id === "default" || r.left === 0), `${r.left} of ${r.total} colour values still the default's · ink ${r.ink}`);
  }
  // the text on the screen, as drawn: the main text against the page's own dark or light
  await api("/looks/theme", { id: "day" }); await p.waitForTimeout(900);
  const dayInk = await p.evaluate(() => getComputedStyle(document.body).color);
  check("the day theme draws dark text", (() => { const c = TC.parse(dayInk.replace(/rgb\(([^)]*)\)/, (m, x) => `rgb(${x})`)); return c && TC.lum(c) < 0.05; })(), dayInk);
  check("no page errors while switching themes", !p.errs.length, p.errs.slice(0, 2).join(" | "));
  console.log(`      screenshots: ${SHOTS}`);
  await api("/looks/theme", { id: "default" });
  await p.context().close();
  // Settings, the guide, the GIF window: they take the theme too
  await api("/looks/theme", { id: "candy" });
  for (const path of ["/setup?s=looks", "/help", "/gifs"]) {
    const q = await page(1280, 720, path);
    const th = await q.evaluate(() => document.documentElement.dataset.dsTheme ?? "default");
    check(`${path}: takes the theme (Candy)`, th === "candy", th);
    await q.context().close();
  }
  await api("/looks/theme", { id: "default" });
}

// ---- the avatars: each renders every state and reacts to the voice ----
{
  const p = await page(1280, 720);
  const lit = (st, lv) => p.evaluate(async ([st, lv]) => {
    window.__dsAvatarState = st; window.__dsAvatarLevel = lv;
    await new Promise((r) => setTimeout(r, 450));
    const c = document.querySelector("#dsAvatar canvas"); if (!c) return { n: -1 };
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 24) n++;
    return { n, w: c.width, hash: c.toDataURL().length };
  }, [st, lv]);
  for (const s of ["aurora", "sunring", "blob", "halo", "pixel"]) {
    await api("/looks", { avatar: { style: s } });
    await p.waitForFunction((s) => window.dsAvatar?.style() === s && document.querySelector("#dsAvatar canvas"), s, { timeout: 6000 }).catch(() => {});
    const blank = [];
    for (const st of ["idle", "listen", "think", "speak", "muted", "stopped", "error", "sleep"]) { const r = await lit(st, st === "speak" ? 0.6 : 0); if (!(r.n > 50)) blank.push(`${st}:${r.n}`); }
    check(`avatar ${s}: draws something in all 8 states`, !blank.length, blank.join(","));
    const quiet = await lit("speak", 0), loud = await lit("speak", 0.95);
    check(`avatar ${s}: reacts to the voice level (quiet ${quiet.n} → loud ${loud.n} lit pixels)`, loud.n !== quiet.n && (["blob", "pixel"].includes(s) || loud.n > quiet.n * 1.08));
    check(`avatar ${s}: the orb rests underneath (hidden, not drawn)`, await p.evaluate(() => getComputedStyle(document.getElementById("viz")).visibility === "hidden" && window.dsAvatarActive === true));
  }
  await p.evaluate(() => { window.__dsAvatarState = null; window.__dsAvatarLevel = null; });
  // your picture
  await rawUp("/looks/avatar/upload?state=idle", readFileSync(join(FIX, "avatar-idle.png")), "image/png");
  await rawUp("/looks/avatar/upload?state=listen", readFileSync(join(FIX, "avatar-listen.png")), "image/png");
  await api("/looks", { avatar: { style: "image" } });
  await p.waitForFunction(() => window.dsAvatar?.style() === "image" && document.querySelector("#dsAvatar .dsav-img img.on"), null, { timeout: 6000 }).catch(() => {});
  const scaleAt = (st, lv) => p.evaluate(async ([st, lv]) => { window.__dsAvatarState = st; window.__dsAvatarLevel = lv; await new Promise((r) => setTimeout(r, 900)); const el = document.querySelector("#dsAvatar .dsav-img"); const m = /scale\(([\d.]+)\)/.exec(el.style.transform); const on = el.querySelector("img.on"); return { s: m ? Number(m[1]) : null, src: on?.getAttribute("src") ?? "" }; }, [st, lv]);
  const idle = await scaleAt("idle", 0), talkQ = await scaleAt("speak", 0.05), talkL = await scaleAt("speak", 0.9), listen = await scaleAt("listen", 0.1), think = await scaleAt("think", 0);
  check("your picture: idle, it only breathes (about 1×)", Math.abs(idle.s - 1) < 0.02, idle.s);
  check("your picture: talking, it grows with the voice (quiet → loud)", talkL.s > talkQ.s + 0.06 && talkL.s <= 1.14, `${talkQ.s} → ${talkL.s}`);
  check("your picture: listening, a little bigger", listen.s > 1.05 && listen.s < 1.1, listen.s);
  check("your picture: listening shows the listening picture", /\/img\/listen\b/.test(listen.src), listen.src);
  check("your picture: thinking has no picture of its own, so it falls back to the main picture", /\/img\/idle\b/.test(think.src), think.src);
  check("your picture: two layers crossfade (one showing)", await p.evaluate(() => document.querySelectorAll("#dsAvatar .dsav-img img").length === 2 && document.querySelectorAll("#dsAvatar .dsav-img img.on").length === 1));
  await p.evaluate(() => { window.__dsAvatarState = null; window.__dsAvatarLevel = null; });
  // expression mode: a GIF of our own, shown for its loops in the avatar's place
  await api("/looks", { avatar: { style: "blob" }, expression: { on: true, often: "always", web: false } });
  await rawUp("/expressions/upload?emotion=celebrate&persona=any&title=test%20confetti", readFileSync(join(FIX, "three-frames.gif")), "image/gif");
  await p.evaluate(() => window.dsAvatar.reload()); await p.waitForTimeout(600);
  await p.evaluate(() => window.dispatchEvent(new CustomEvent("ds-stage", { detail: { mode: "speak", text: "Congratulations, you did it! A new badge!" } })));
  const shown = await p.waitForFunction(() => { const e = document.getElementById("dsExpr"); return e && !e.hidden && e.classList.contains("on") && e.querySelector("img.ex-media"); }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  check("expression mode: the GIF shows in the avatar's place", shown);
  const geo = await p.evaluate(() => { const e = document.getElementById("dsExpr").getBoundingClientRect(), pr = document.getElementById("presence").getBoundingClientRect(), s = window.dsSafeRect?.() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }; return { inPresence: e.left >= pr.left - 1 && e.right <= pr.right + 1 && e.top >= pr.top - 1 && e.bottom <= pr.bottom + 1, inSafe: e.left >= s.left - 1 && e.right <= s.right + 1 && e.top >= s.top - 1 && e.bottom <= s.bottom + 1, title: document.getElementById("dsExpr").title }; });
  check("expression mode: it stays inside the avatar's own box and the safe area (covers nothing else)", geo.inPresence && geo.inSafe, JSON.stringify(geo));
  check("expression mode: where it's from shows on hover", /test confetti/.test(geo.title), geo.title);
  const gone = await p.waitForFunction(() => document.getElementById("dsExpr").hidden, null, { timeout: 12_000 }).then(() => true).catch(() => false);
  check("expression mode: after its loops, the avatar comes back", gone);
  check("no page errors (avatars, pictures, expressions)", !p.errs.length, p.errs.slice(0, 2).join(" | "));
  await api("/looks", { avatar: { style: "orb" }, expression: { on: false } });
  await p.context().close();
}

// ---- headless UI at 1920×1080 and the mini size ----
for (const [w, h, path] of [[1920, 1080, "/display"], [380, 560, "/mini"], [1280, 720, "/display"]]) {
  await api("/looks", { theme: "ocean", avatar: { style: "sunring" } });
  const p = await page(w, h, path);
  await p.waitForFunction(() => window.dsAvatar?.style() === "sunring", null, { timeout: 6000 }).catch(() => {});
  const r = await p.evaluate(() => { const a = document.getElementById("dsAvatar"), v = document.getElementById("viz"); const ar = a.getBoundingClientRect(), vr = v.getBoundingClientRect(); const s = window.dsSafeRect?.() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const shown = getComputedStyle(document.getElementById("presence")).display !== "none";
    if (!shown) return { theme: document.documentElement.dataset.dsTheme, hiddenWithPresence: true, over: true, inSafe: true, frames: 99 };
    return { theme: document.documentElement.dataset.dsTheme, over: Math.abs(ar.left + ar.width / 2 - (vr.left + vr.width / 2)) < 3 && Math.abs(ar.top + ar.height / 2 - (vr.top + vr.height / 2)) < 3 && ar.width > 20, inSafe: ar.left >= s.left - 1 && ar.right <= s.right + 1 && ar.top >= s.top - 1 && ar.bottom <= s.bottom + 1, frames: window.dsAvatar.stats().canvas?.frames ?? 0 }; });
  check(`${path} ${w}×${h}: the theme and the avatar show, centred on the orb's place, inside the safe area`, r.theme === "ocean" && r.over && r.inSafe && r.frames > 3, JSON.stringify(r));
  await p.screenshot({ path: join(SHOTS, `avatar-sunring-${w}x${h}.png`) });
  check(`${path} ${w}×${h}: no page errors`, !p.errs.length, p.errs.slice(0, 2).join(" | "));
  await p.context().close();
}
await api("/looks", { theme: "default", avatar: { style: "orb" } });

// ---- Settings → Look & feel ----
for (const [w, h] of [[1280, 720], [1920, 1080]]) {
  const p = await page(w, h, "/setup?s=looks");
  await p.waitForSelector(".lf-themes .lf-theme", { timeout: 8000 }).catch(() => {});
  const r = await p.evaluate(async () => { await new Promise((r) => setTimeout(r, 1200)); return { themes: document.querySelectorAll(".lf-theme").length, avs: document.querySelectorAll(".lf-av").length, canvases: document.querySelectorAll(".lf-stage canvas").length, slots: document.querySelectorAll(".lf-slot").length, exOff: document.getElementById("lf-exon")?.getAttribute("aria-checked") === "false", overflow: document.documentElement.scrollWidth > innerWidth + 2 }; });
  check(`Settings → Look & feel ${w}×${h}: 16 themes, 7 avatars with live previews, 8 picture slots, expression mode off`, r.themes >= 16 && r.avs === 7 && r.canvases >= 5 && r.slots === 8 && r.exOff && !r.overflow, JSON.stringify(r));
  if (w === 1280) {
    await p.click('.lf-theme[data-theme="mint"]'); await p.waitForTimeout(700);
    const th = await p.evaluate(() => document.documentElement.dataset.dsTheme);
    check("Settings: picking a theme applies it at once, here and on the server", th === "mint" && (await api("/looks/theme")).theme.id === "mint", th);
    await p.evaluate(() => { document.getElementById("lf-builder").open = true; }); await p.evaluate(() => { const i = document.getElementById("lf-c1"); i.value = "#ff3399"; i.dispatchEvent(new Event("input")); });
    const ok = await p.evaluate(() => document.querySelector("#lf-contrast .status")?.className ?? "");
    check("Settings: the theme builder shows its readability check", /ok/.test(ok), ok);
    await p.click("#lf-usecustom"); await p.waitForTimeout(700);
    check("Settings: Use this theme saves your own theme", (await api("/looks/theme")).theme.id === "custom");
    await p.click('.lf-av[data-style="halo"]'); await p.waitForTimeout(500);
    check("Settings: picking an avatar saves it", (await api("/looks")).settings.avatar.style === "halo");
    await p.click("#lf-reset"); await p.waitForTimeout(700);
    const s = (await api("/looks")).settings;
    check("Settings: Back to the default look puts everything back", s.theme === "default" && s.avatar.style === "orb" && s.expression.on === false && !(await p.evaluate(() => document.documentElement.dataset.dsTheme)));
  }
  await p.screenshot({ path: join(SHOTS, `settings-look-and-feel-${w}x${h}.png`), fullPage: false });
  check(`Settings ${w}×${h}: no page errors`, !p.errs.length, p.errs.slice(0, 2).join(" | "));
  await p.context().close();
}

// ---- by voice, through the real chat (no AI) ----
{
  const say = (message) => api("/chat", { message, surface: "desk", typed: true });
  const a = await say("switch to the pink theme"), b = await say("use the blob avatar"), c = await say("default theme"), d = await say("go back to the orb");
  const s = (await api("/looks")).settings;
  check("voice: \"switch to the pink theme\" → Rose", /Rose/.test(a.reply ?? ""), a.reply);
  check("voice: \"use the blob avatar\" → the blob", /Blob/.test(b.reply ?? ""), b.reply);
  check("voice: \"default theme\" and \"go back to the orb\" put the default look back", s.theme === "default" && s.avatar.style === "orb", `${c.reply} / ${d.reply}`);
}

server.kill();
await browser.close();
if (!flag("--keep")) { await sleep(500); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* still in use */ } }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
