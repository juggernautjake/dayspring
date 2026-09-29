// The assistant's name and wake words: checking them, and hearing them in what a speech recognizer wrote down.
// One file for both sides: the Dayspring screen loads it as a plain script (window.dsWake), and the server imports it
// (lib/wakeword.mjs wraps it with the owner's settings). No imports, no network, nothing kept.
//
//   validateName(text)                  → { ok, value, error }            1–19 letters, numbers, spaces, ' and -
//   validateWake(text, { name })        → { ok, value, error, warnings, tips }  (refuses "Lantern" and sound-alikes)
//   soundKey(text) / similarity(a, b)   the phonetic key and how alike two phrases sound (0…1)
//   createMatcher(config)               → { match(text, opts), matchAny(alternatives, opts), strip(text), phrases }
//   neighbours(phrase)                  everyday words that sound like it (the confusion list, and the warnings)
//   trainReport(config, samples)        what "Train my wake word" learned from what the recognizer heard
//   regexLike(matcher)                  test / exec / String#replace, like the RegExp the screen used before
//
// How hearing works (why "computa" wakes on "computer, what time is it" but not on "my computer is slow"):
//   1. Every phrase is turned into a rough sound key (letters → sounds: "ph" → f, "c" before e/i → s, a final "-er",
//      "-a" or "-ah" → a weak "uh"…), so different spellings of one sound get the same key: computa, compootah,
//      computer, "compute a", "come puta" all become k-O-m-p-U-t-@.
//   2. The words the recognizer wrote are compared with each wake phrase (and its pronunciation, the "also accept"
//      words and the trained variants) with a weighted edit distance: close sounds (p/b, s/z, two vowels) cost less.
//   3. Position rules: the wake word counts at the start of what was said (after "hey", "ok", "um"…), or right after
//      a pause the recognizer marked with punctuation, or right before a comma. Never in the middle of a sentence.
//   4. Everyday words are guarded: a common word that merely sounds like the wake word ("computer" for "computa")
//      only counts at the start and only when it's a close match; the most common words ("the", "okay", "super")
//      never count unless the owner taught them (Train my wake word, or "also accept").
(function (root) {
  "use strict";
  const MAX_CHARS = 19, MAX_WAKE = 3, MAX_VARIANTS = 24;
  const SENS = { strict: 0.93, normal: 0.8, relaxed: 0.7 };
  const LOOKALIKE = { strict: 2, normal: 0.92, relaxed: 0.82 };     // everyday words that only sound like it (2 = never)
  const FILLERS = new Set(["hey", "hi", "hello", "ok", "okay", "yo", "um", "umm", "uh", "uhh", "er", "erm", "ah", "so", "and", "alright", "well", "oh", "hmm", "hm", "yeah", "now"]);
  const HEYISH = new Set(["hey", "hi", "hay", "ay", "eh", "okay", "ok", "yo", "hei", "heya"]);   // what "hey" gets written as
  // little words a sentence starts with ("my computer…", "the spring…"): a sound-alike of a wake word never starts with one
  const FUNC = new Set("a an the my your his her our their its this that these those is are was were be to of in on at for with and or but so if as by from it i you he she we they me him them us no not".split(" "));
  const LEADS = new Set(["hey", "hi", "hello", "ok", "okay", "yo", "um", "umm", "uh", "uhh", "er", "erm", "ah", "oh", "hmm"]);   // "hey / ok / yo" before a wake word
  // Words people say all the time: never a wake word on their own, never a sound-alike (unless the owner taught it).
  const VERY_COMMON = new Set(("a an the and or but so if then than that this these those there here where when what who whom whose which why how i me my mine " +
    "you your yours he him his she her hers it its we us our they them their is am are was were be been being do does did done have has had " +
    "will would shall should can could may might must not no yes yeah yep yup nope ok okay hey hi hello bye oh ah uh um hmm well just very really " +
    "too also only even still yet now again all any some every each both much many more most less few lot lots to of in on at by for with from up " +
    "down out off over under into onto about after before like as because while until since though whats its im youre thats lets dont cant wont " +
    "isnt wasnt didnt right sure super cool nice great good fine thanks thank please sorry wow whoa yay awesome perfect alright go get got make made " +
    "take see say said know think want need look come give tell one two three four five six seven eight nine ten first last next new old big " +
    "little same other another such way thing things time day today tonight tomorrow yesterday man guy guys hear here er ever never always maybe " +
    "stop wait listen hold on off play put let use try keep call text send open close turn set show read write watch talk ask help find check").split(/\s+/));
  // Everyday words (a sound-alike only at the start, and only when it's close). Also the dictionary for the confusion list.
  const COMMON = new Set([...VERY_COMMON, ...("computer computers commuter compute computing compact company complete common coming " +
    "music movie movies phone call calls calling text texts message email mail weather schedule timer timers alarm alarms reminder reminders " +
    "light lights lamp kitchen dinner lunch breakfast coffee water work working home house room bedroom car truck game games playing player " +
    "start starting stopping opening closing turning showing reading writing watching listening talking telling asking helping finding " +
    "search searching buy buying pay paying order ordering shop store money bank card price cost week month year morning night evening afternoon " +
    "noon midnight hour hours minute minutes second seconds clock date calendar meeting class school homework study test exam book books paper " +
    "pen pencil desk chair table window door floor wall bed couch sofa tv television screen monitor laptop tablet camera speaker speakers " +
    "headphones mic microphone volume louder quieter song songs album artist playlist radio news story stories video videos picture pictures " +
    "photo photos family friend friends mom dad mother father brother sister son daughter baby kids kid wife husband boss teacher doctor dentist " +
    "nurse church god prayer bible verse food pizza pasta chicken soup salad bread milk eggs cheese apple apples banana orange juice tea sugar " +
    "salt pepper dish dishes laundry trash garbage clean cleaning cook cooking bake baking recipe recipes shower bath sleep sleeping wake waking " +
    "tired happy sad angry funny joke jokes story weekend monday tuesday wednesday thursday friday saturday sunday january february march april " +
    "june july august september october november december spring summer fall autumn winter snow rain sun sunny cloudy windy hot cold warm cool " +
    "outside inside upstairs downstairs street road city town country world earth moon star stars sky space rocket plane train bus bike walk " +
    "run running drive driving trip travel vacation holiday party birthday gift present card number numbers name names word words letter " +
    "language english spanish math science history art computer's program programs app apps phone's internet website web page link button " +
    "file files folder folders document documents list lists note notes task tasks project projects plan plans idea ideas problem question " +
    "answer answers thing's person people everyone someone anyone nobody somebody anything something nothing everything nowhere somewhere " +
    "super duper scooper hooper supper upper paper pepper copper hopper shopper chopper dropper proper power tower flower shower hour our " +
    "extra orchestra sister mister master faster plaster water later letter better butter matter mother other brother either " +
    "over clover lover rover novel noble nobody notice never ever every even evening movie movies " +
    "jar jars service nervous harvest marvel carvings starving " +
    "mic big bigger biggest like likes bike hike nice mice rice price spice " +
    "day days spring springs springer daisy stay they the dare date " +
    "lamp lamps latte lance land landed tern turn " +
    "eve even if " +
    "kept kettle kestrel chest vest best rest test nest west guest quest " +
    "zoo zoom soup super scoop coop hoop loop troop group oops pewter").split(/\s+/)]);
  const NUMWORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  // Lantern (the learning app) answers to these; Dayspring's name and wake words must never sound like them.
  const LANTERN = ["lantern", "lanterns", "latern", "lanturn", "lanton", "lan tern", "land tern", "lanterne", "hey lantern"];
  // "Dayspring" as speech recognition often writes it (the old lists from the screen, Tune in and Discord)
  // ("they spring" and "the spring" are left out: "The spring is lovely" is everyday talk)
  const DAYSPRING_ALSO = ["day spring", "day-spring", "daysprings", "day springs", "dayspring's", "days spring", "dace spring", "dare spring", "darespring", "date spring", "dave spring", "daisy spring", "des spring", "day springer"];

  // ---- text ------------------------------------------------------------------------------------------------------------
  const deaccent = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const clean = (s) => String(s ?? "").normalize("NFC").replace(/[‘’ʼ`]/g, "'").replace(/\s+/g, " ").trim();
  // words with where they are in the original text ("Hey, Nova!" → hey@0, nova@5)
  function tokenize(text) {
    const s = String(text ?? ""), out = [];
    const re = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}]+)*/gu;
    let m;
    while ((m = re.exec(s))) {
      let w = deaccent(m[0]).toLowerCase().replace(/['’]s$/, "").replace(/['’]/g, "");
      if (/^\d+$/.test(w)) w = NUMWORDS[Number(w)] ?? w;
      if (!w) continue;
      out.push({ w, start: m.index, end: m.index + m[0].length });
    }
    return out;
  }
  const words = (text) => tokenize(text).map((t) => t.w);
  const norm = (text) => words(text).join(" ");

  // ---- the sound key ---------------------------------------------------------------------------------------------------
  // consonants: p b t d k g f v s z S (sh) C (ch) j (judge) 0 (th) m n N (ng) l r h w y · vowels: A E I O U, @ (a weak "uh")
  const VOW = new Set(["A", "E", "I", "O", "U", "@"]);
  const isV = (c) => VOW.has(c);
  function vowelOf(g) {
    if (/^(oo|ou|ew|ue|ui|u)/.test(g)) return "U";
    if (/^(ee|ea|ey|ei|ie|i|y)/.test(g)) return "I";
    if (g[0] === "a") return "A";
    if (g[0] === "e") return "E";
    return "O";
  }
  // (keys are memoized: the same few hundred words come up again and again)
  const KEYS = new Map();
  function wordKey(raw) {
    const k0 = String(raw ?? "");
    const hit = KEYS.get(k0); if (hit) return hit;
    const key = wordKeyRaw(k0);
    if (KEYS.size > 5000) KEYS.clear();
    KEYS.set(k0, key);
    return key;
  }
  function wordKeyRaw(raw) {
    let w = deaccent(raw).toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return [];
    if (w === "a" || w === "uh" || w === "ah" || w === "er" || w === "eh") return ["@"];
    w = w.replace(/^(kn|gn|pn)/, "n").replace(/^wr/, "r").replace(/^ps/, "s").replace(/^x/, "z").replace(/^wh/, "w").replace(/mb$/, "m");
    const vowelsIn = (s) => (s.match(/[aeiouy]+/g) ?? []).length;
    // a final silent e ("mike", "compute"), when another vowel carries the word
    if (w.length > 2 && /[^aeiouy]e$/.test(w) && !/le$/.test(w) && vowelsIn(w.slice(0, -2)) > 0) w = w.slice(0, -1);
    // a weak final syllable: "-er", "-or", "-ar", "-re", "-a", "-ah", "-uh" all sound like "uh" at the end of a word
    let schwa = false;
    const wk = /(?:[aeiou]?r|re|ah|uh|a)$/.exec(w);
    if (wk && w.length > wk[0].length && vowelsIn(w.slice(0, w.length - wk[0].length)) > 0) { w = w.slice(0, w.length - wk[0].length); schwa = true; }
    const out = [];
    const push = (c) => { if (out[out.length - 1] !== c) out.push(c); };
    for (let i = 0; i < w.length;) {
      const c = w[i], n = w[i + 1] ?? "", r = w.slice(i);
      if (/^[aeiou]/.test(r) || (c === "y" && i > 0 && !/[aeiou]/.test(n))) {
        const g = /^[aeiouy]+/.exec(r)[0].replace(/y(?=[aeiou])/, "");
        push(vowelOf(g)); i += Math.max(1, g.length); continue;
      }
      if (r.startsWith("tch")) { push("C"); i += 3; continue; }
      if (r.startsWith("sch")) { push("s"); push("k"); i += 3; continue; }
      if (/^(tion|sion)/.test(r)) { push("S"); push("@"); push("n"); i += 4; continue; }
      if (/^ti[ao]/.test(r) && i > 0) { push("S"); i += 2; continue; }
      if (r.startsWith("ch")) { push(i === 0 && w[2] === "r" ? "k" : "C"); i += 2; continue; }
      if (r.startsWith("sh")) { push("S"); i += 2; continue; }
      if (r.startsWith("th")) { push("0"); i += 2; continue; }
      if (r.startsWith("ph")) { push("f"); i += 2; continue; }
      if (r.startsWith("gh")) { if (i === 0) push("g"); i += 2; continue; }
      if (r.startsWith("ck")) { push("k"); i += 2; continue; }
      if (r.startsWith("qu")) { push("k"); push("w"); i += 2; continue; }
      if (r.startsWith("dg")) { push("j"); i += 2; continue; }
      if (r.startsWith("ng") && !/[aeiouy]/.test(w[i + 2] ?? "")) { push("N"); i += 2; continue; }
      if (c === "c") { push(/[eiy]/.test(n) ? "s" : "k"); i++; continue; }
      if (c === "q") { push("k"); i++; continue; }
      if (c === "x") { push("k"); push("s"); i++; continue; }
      if (c === "w") { if (/[aeiouy]/.test(n)) push("w"); i++; continue; }
      if (c === "y") { push("y"); i++; continue; }
      if (c === "h") { if (i === 0 && /[aeiouy]/.test(n)) push("h"); i++; continue; }
      push(c); i++;
    }
    if (schwa) push("@");
    // a vowel straight after another vowel is one sound ("idea" → I d E)
    return out.filter((c, i) => !(isV(c) && isV(out[i - 1] ?? "")));
  }
  function soundKey(text) {
    const out = [];
    for (const w of (Array.isArray(text) ? text : words(text))) for (const c of wordKey(w)) if (out[out.length - 1] !== c && !(isV(c) && isV(out[out.length - 1] ?? ""))) out.push(c);
    // a phrase that ends on an open "a" ("ee-fa", "com pu ta") ends weakly, like one word would ("Eefa", "computa")
    if (out.length > 2 && out[out.length - 1] === "A" && out.slice(0, -1).some(isV)) out[out.length - 1] = "@";
    return out;
  }
  const syllables = (key) => key.filter(isV).length;
  const PAIRS = ["pb", "td", "kg", "fv", "bv", "sz", "SCj", "0f", "0t", "0d", "mnN", "lr", "Sz"];
  const near = (a, b) => PAIRS.some((p) => p.includes(a) && p.includes(b));
  const insCost = (c) => (isV(c) ? 0.6 : /[hwy]/.test(c) ? 0.5 : 1);
  function subCost(a, b) {
    if (a === b) return 0;
    if (isV(a) && isV(b)) return a === "@" || b === "@" ? 0.15 : ("EI".includes(a) && "EI".includes(b)) || ("OU".includes(a) && "OU".includes(b)) ? 0.2 : 0.3;
    if (isV(a) !== isV(b)) return /[wy]/.test(a + b) ? 0.5 : 1.2;
    return near(a, b) ? 0.35 : 1;
  }
  const weight = (key) => key.reduce((s, c) => s + insCost(c), 0);
  function distance(a, b) {
    const m = a.length, n = b.length;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    prev[0] = 0; for (let j = 1; j <= n; j++) prev[j] = prev[j - 1] + insCost(b[j - 1]);
    for (let i = 1; i <= m; i++) {
      cur[0] = prev[0] + insCost(a[i - 1]);
      // (a different FIRST sound counts double: "movie" is not "Nova", "super" is not "Zoopa")
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + insCost(a[i - 1]), cur[j - 1] + insCost(b[j - 1]), prev[j - 1] + (i === 1 && j === 1 && !isV(a[0]) ? Math.min(1.2, 2 * subCost(a[0], b[0])) : subCost(a[i - 1], b[j - 1])));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  function keySim(a, b) {
    if (!a.length || !b.length) return 0;
    return Math.max(0, 1 - distance(a, b) / Math.max(weight(a), weight(b)));
  }
  const similarity = (a, b) => keySim(Array.isArray(a) ? a : soundKey(a), Array.isArray(b) ? b : soundKey(b));

  // ---- checking a name or a wake word --------------------------------------------------------------------------------
  const CHARSET = /^[\p{L}\p{M}\p{N}' -]+$/u;
  const count = (s) => [...s].length;
  function basic(raw, what) {
    const value = clean(raw).replace(/^[\s'-]+|[\s'-]+$/g, "");
    if (!value) return { error: what === "name" ? "Give me a name: anything from 1 to 19 letters." : "Type a wake word, like “Hey Nova” or “Computer”." };
    if (count(value) > MAX_CHARS) return { error: `That's ${count(value)} characters. ${what === "name" ? "A name" : "A wake word"} can be up to ${MAX_CHARS}.` };
    if (!CHARSET.test(value)) return { error: `${what === "name" ? "A name" : "A wake word"} can use letters, numbers, spaces, apostrophes (') and hyphens (-). Leave out ${[...new Set(value.replace(/[\p{L}\p{M}\p{N}' -]/gu, ""))].map((c) => `“${c}”`).slice(0, 4).join(" ")}.` };
    if (!/[\p{L}\p{N}]/u.test(value)) return { error: "It needs at least one letter or number." };
    return { value };
  }
  // Does it sound like "Lantern"? (whole phrase, and each part of it)
  function lanternClash(text) {
    const ws = words(text);
    if (ws.some((w) => w.startsWith("lantern"))) return true;
    const L = LANTERN.map((x) => soundKey(x));
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j <= Math.min(ws.length, i + 3); j++) {
      const k = soundKey(ws.slice(i, j));
      if (weight(k) >= 2.5 && L.some((l) => keySim(k, l) >= 0.72)) return true;
    }
    return false;
  }
  const LANTERN_WHY = "Lantern is the learning app's name and wake word. If they sounded alike, both would answer (or the wrong one would), so pick something that sounds different.";
  function validateName(raw) {
    const b = basic(raw, "name");
    if (b.error) return { ok: false, error: b.error };
    if (lanternClash(b.value)) return { ok: false, error: `“${b.value}” sounds too much like Lantern. ${LANTERN_WHY}` };
    return { ok: true, value: b.value };
  }
  function strength(text) {
    const k = soundKey(text), ws = words(text);
    const content = ws.filter((w) => !HEYISH.has(w) && !FILLERS.has(w));
    return { key: k, syllables: syllables(k), phonemes: k.length, weight: weight(k), content, common: content.length > 0 && content.every((w) => COMMON.has(w)), veryCommon: content.length > 0 && content.every((w) => VERY_COMMON.has(w)) };
  }
  function validateWake(raw, { name = "" } = {}) {
    const b = basic(raw, "wake");
    if (b.error) return { ok: false, error: b.error, warnings: [], tips: [] };
    const value = b.value.toLowerCase();
    if (lanternClash(value)) return { ok: false, error: `“${b.value}” sounds too much like Lantern. ${LANTERN_WHY}`, warnings: [], tips: [] };
    const st = strength(value), warnings = [], tips = [];
    if (!st.content.length || st.veryCommon) return { ok: false, error: `“${b.value}” is something people say all the time, so I'd wake up constantly. ${name ? `Try “Hey ${name}” or “${name}”.` : "Try a name, like “Hey Nova”."}`, warnings: [], tips: [] };
    if (st.common) warnings.push(`“${b.value}” is an everyday word, so I'll only answer to it at the start of what you say (“${cap(b.value)}, what time is it?”), never in the middle of a sentence.`);
    if (st.syllables < 2 || st.phonemes < 3) {
      warnings.push(`“${b.value}” is very short, so it's easy to miss or to hear by accident.`);
      if (!/^(hey|ok|okay|hi) /.test(value)) tips.push(`Hey ${cap(b.value)}`);
    }
    const nb = neighbours(value).filter((x) => x !== value).slice(0, 4);
    if (nb.length) warnings.push(`It sounds like ${nb.map((x) => `“${x}”`).join(", ")}. I'll accept ${nb.length > 1 ? "those" : "that"} at the start of what you say too, which can wake me by accident.`);
    return { ok: true, value, warnings, tips, syllables: st.syllables, phonemes: st.phonemes };
  }
  const cap = (s) => String(s ?? "").replace(/(^|\s)(\p{L})/gu, (m, a, c) => a + c.toUpperCase());

  // ---- the confusion list: everyday words (and word pairs) that sound like the phrase --------------------------------
  const DICT = [...COMMON].filter((w) => w.length > 1 && !/'/.test(w));
  const TAILS = ["a", "uh", "er", "the", "her", "up", "it", "to", "on", "in", "an", "of"];
  let dictKeys = null;
  const dk = () => dictKeys ?? (dictKeys = DICT.map((w) => [w, wordKey(w)]));
  function neighbours(phrase, { min = 0.76, max = 8 } = {}) {
    const target = soundKey(phrase), tw = weight(target), own = norm(phrase);
    if (!target.length) return [];
    const hits = [];
    for (const [w, k] of dk()) {
      if (w === own) continue;
      const s = keySim(k, target);
      if (s >= min) hits.push([w, s]);
      // "compute a", "come puta": a word that covers most of it, then a little word
      if (weight(k) >= tw * 0.55 && weight(k) < tw) for (const t of TAILS) { const s2 = keySim(soundKey([w, t]), target); if (s2 >= Math.max(min, 0.9)) hits.push([`${w} ${t}`, s2]); }
    }
    return [...new Map(hits.sort((a, b) => b[1] - a[1]).map(([w, s]) => [w, s])).keys()].slice(0, max);
  }

  // ---- the matcher -----------------------------------------------------------------------------------------------------
  // config: { name, words: [{ text, say, also: [], trained: [] }], sensitivity, extra: [] }
  function createMatcher(config = {}) {
    const sens = SENS[config.sensitivity] ? config.sensitivity : "normal";
    const list = (Array.isArray(config.words) && config.words.length ? config.words : [{ text: config.name || "dayspring" }]).slice(0, MAX_WAKE);
    const variants = [];
    const add = (phrase, text, source) => {
      const ws = words(text); if (!ws.length || ws.length > 5) return;
      const key = soundKey(ws); if (!key.length) return;
      const st = strength(text);
      variants.push({ phrase, text: ws.join(" "), joined: ws.join(""), n: ws.length, key, w: weight(key), syl: syllables(key), source, heyFirst: HEYISH.has(ws[0]) && ws.length > 1, common: st.common });
    };
    const phrases = [];
    for (const p of list) {
      const text = norm(typeof p === "string" ? p : p.text); if (!text) continue;
      phrases.push(text);
      add(text, text, "word");
      if (p.say) add(text, p.say, "say");
      if (text === "dayspring") for (const x of DAYSPRING_ALSO) add(text, x, "also");
      for (const x of [...(p.also ?? []), ...(p.trained ?? [])].slice(0, MAX_VARIANTS)) add(text, x, "also");
    }
    for (const x of config.extra ?? []) { const t = norm(x); if (t && !phrases.includes(t)) add(t, t, "also"); }
    const lanternKeys = LANTERN.map((x) => soundKey(x));
    const maxN = Math.max(1, ...variants.map((v) => v.n)) + 2;

    function candidates(text, opts = {}) {
      const s = String(text ?? "");
      const toks = tokenize(s);
      if (!toks.length) return [];
      const sv = SENS[opts.sensitivity] ? opts.sensitivity : sens;
      const thr = SENS[sv], look = LOOKALIKE[sv];
      const out = [];
      for (let i = 0; i < toks.length; i++) {
        // Where may a wake word be?
        //   atStart: the start of what was said, after at most 3 fillers ("okay so, Nova…")
        //   atHead:  the start after only "hey / ok / yo / um" (sound-alike everyday words need this: "computer, what…")
        //   afterPause / beforeComma: the recognizer marked a pause (punctuation) right before or right after it
        let lead = 0; while (lead < i && FILLERS.has(toks[lead].w)) lead++;
        let head = 0; while (head < i && LEADS.has(toks[head].w)) head++;
        const atStart = lead === i && i <= 3, atHead = head === i && i <= 2;
        if (opts.startOnly && !atStart) break;                               // (strip: only the start matters)
        const gapBefore = i > 0 ? s.slice(toks[i - 1].end, toks[i].start) : "";
        const afterPause = /[.,!?;:—–]|\s-\s/.test(gapBefore);
        for (let len = 1; len <= Math.min(maxN, toks.length - i); len++) {
          const win = toks.slice(i, i + len), ws = win.map((t) => t.w), joined = ws.join("");
          const gapAfter = s.slice(win[len - 1].end, toks[i + len]?.start ?? s.length);
          const beforeComma = /^\s*[,.!?;:—]/.test(gapAfter);
          if (!(atStart || afterPause || beforeComma)) continue;
          const key = soundKey(ws), kw = weight(key);
          if (!key.length) continue;
          let isLantern = null;                                                 // never Lantern's name (checked only for a hit)
          const lantern = () => (isLantern ??= lanternKeys.some((l) => 1 - Math.abs(weight(l) - kw) / Math.max(weight(l), kw) >= 0.8 && keySim(key, l) >= 0.8));
          const allCommon = ws.every((w) => COMMON.has(w) || FILLERS.has(w)), oneVeryCommon = len === 1 && VERY_COMMON.has(ws[0]);
          for (const v of variants) {
            let score = 0, how = "";
            if (joined === v.joined) { score = 1; how = v.source === "also" ? "taught" : "exact"; }
            else {
              if (oneVeryCommon || v.source === "also") continue;                  // taught spellings count only as written
              if (v.heyFirst && !HEYISH.has(ws[0]) && !/^h/.test(ws[0])) continue;   // "Hey Nova" needs something like "hey"
              // "my computer", "the spring": a sound-alike never starts with an everyday little word (the wake word would)
              if (len > 1 && !v.heyFirst && (FUNC.has(ws[0]) || FILLERS.has(ws[0])) && !v.text.startsWith(ws[0] + " ")) continue;
              // (a cheap bound first: the distance is at least the difference in weight, so far longer or shorter can't match)
              const canClip = len === 1 && atHead && sv === "relaxed" && v.syl >= 3 && v.n === 1;
              if (!canClip && 1 - Math.abs(kw - v.w) / Math.max(kw, v.w) < Math.min(thr, 0.78)) continue;
              const sim = keySim(key, v.key);
              if (sim >= thr) {
                if (allCommon && (sim < look || kw < 3.4)) continue;              // an everyday word that only sounds like it
                score = sim; how = allCommon ? "lookalike" : "sound";
              } else if (len === 1 && atHead && sv === "relaxed" && !COMMON.has(ws[0]) && v.syl >= 3 && v.n === 1) {
                // the first syllable got lost ("puter" for "computa"): the end of it, at the start of what was said
                const tail = v.key.slice(v.key.length - key.length);
                if (key.filter((c) => !isV(c)).length >= 2 && kw >= v.w * 0.5 && keySim(key, tail) >= 0.9) { score = 0.78; how = "clipped"; }
              }
            }
            if (!score) continue;
            // the place rules, by how sure it is
            if (allCommon || how === "lookalike" || how === "clipped") { if (!atHead) continue; }       // everyday words: only at the head
            else if (how === "sound" && !atStart && !(afterPause && score >= Math.max(thr, 0.85)) && !(beforeComma && score >= Math.max(thr, 0.85))) continue;
            if (lantern()) continue;
            const endChar = win[len - 1].end + (/^[,.!?;:—]+/.exec(s.slice(win[len - 1].end))?.[0].length ?? 0);
            out.push({ i, len, score, how, phrase: v.phrase, variant: v.text, index: win[0].start, end: endChar, atStart: atStart || atHead });
          }
        }
      }
      return out;
    }
    // → { index, end, wake, rest, before, score, how, phrase } | null   (the earliest place; there the best, then the shortest)
    function match(text, opts = {}) {
      const c = candidates(text, opts);
      if (!c.length) return null;
      c.sort((a, b) => a.i - b.i || b.score - a.score || a.len - b.len);
      const best = c[0], s = String(text);
      return { index: best.index, end: best.end, wake: s.slice(best.index, best.end).trim(), rest: s.slice(best.end).replace(/^[\s,.!?;:—-]+/, "").trim(), before: s.slice(0, best.index).replace(/[\s,.!?;:—-]+$/, "").trim(), score: Math.round(best.score * 100) / 100, how: best.how, phrase: best.phrase, variant: best.variant, atStart: best.atStart };
    }
    // several guesses from the recognizer (its n-best list): the first one that has the wake word
    function matchAny(alts, opts = {}) {
      for (const [k, a] of (alts ?? []).entries()) { const m = match(typeof a === "string" ? a : a?.transcript, opts); if (m) return { ...m, alt: k, text: typeof a === "string" ? a : a?.transcript }; }
      return null;
    }
    // "Hey Nova, set a timer" → "set a timer"; only a wake word at the start is taken off
    function strip(text) { const m = match(text, { startOnly: true }); return m && m.atStart ? m.rest : String(text ?? ""); }
    return { match, matchAny, strip, phrases, variants: variants.map((v) => ({ phrase: v.phrase, text: v.text, source: v.source })), sensitivity: sens };
  }

  // ---- "Train my wake word" --------------------------------------------------------------------------------------------
  // samples: [[what the recognizer heard (best first), …], …] for one wake word. The success rate is how many it would
  // have heard as the wake word BEFORE learning; what it heard is then kept as accepted variants (except the unsafe ones).
  function trainReport(config, word, samples) {
    const w = norm(word);
    const mine = (config.words ?? []).filter((x) => norm(typeof x === "string" ? x : x.text) === w);
    const one = createMatcher({ ...config, words: mine.length ? mine : [{ text: w }] });
    const heard = [], learned = [], skipped = [], warnings = [];
    let hits = 0;
    for (const alts of samples ?? []) {
      const list = (Array.isArray(alts) ? alts : [alts]).map((a) => clean(typeof a === "string" ? a : a?.transcript)).filter(Boolean).slice(0, 5);
      if (!list.length) { heard.push({ text: "", ok: false }); continue; }
      const got = one.matchAny(list);
      if (got && got.atStart && !got.rest) hits++;
      heard.push({ text: list[0], ok: Boolean(got), how: got?.how ?? null });
      const t = norm(list[0]).split(" ").slice(0, 4).join(" ");
      if (!t || t === w || learned.includes(t) || skipped.some((x) => x.text === t)) continue;
      const st = strength(t);
      if (lanternClash(t)) skipped.push({ text: t, why: "sounds like Lantern" });
      else if (st.veryCommon || !st.content.length) skipped.push({ text: t, why: "people say it all the time" });
      else if (st.weight < 1.6) skipped.push({ text: t, why: "too short to be safe" });
      else { learned.push(t); if (st.common) warnings.push(`I'll now also answer to “${t}”, which is made of everyday words: it may wake me when you say it at the start of a sentence.`); }
    }
    const n = heard.length, rate = n ? Math.round((hits / n) * 100) : 0;
    const st = strength(w), suggestions = [];
    if (st.syllables < 2 || st.phonemes < 3) warnings.push(`“${word}” is short (${st.syllables} syllable${st.syllables === 1 ? "" : "s"}), which is hard to hear reliably.`);
    if (st.common) warnings.push(`“${word}” is an everyday word: I only answer to it at the start of what you say.`);
    if (rate < 60 || st.syllables < 2) {
      if (!/^(hey|ok|okay|hi) /.test(w)) suggestions.push(`hey ${w}`);
      for (const s of ["jarvis", "nova", "computa", "kestra"]) if (s !== w && suggestions.length < 3 && !(config.words ?? []).some((x) => norm(typeof x === "string" ? x : x.text) === s)) suggestions.push(s);
    }
    return { word: w, samples: n, recognized: hits, successRate: rate, heard, learned, skipped, warnings, suggestions };
  }

  // ---- the RegExp-shaped adapter (the screen's older code calls test / exec / replace on its wake pattern) ------------
  function regexLike(matcher, opts = {}) {
    // [0] is the wake word as written (with its comma), [1] what came after it
    const exec = (t) => { const m = matcher.match(t, opts); if (!m) return null; const a = [String(t).slice(m.index, m.end), m.rest]; a.index = m.index; a.input = String(t); a.wake = m; return a; };
    return {
      test: (t) => Boolean(matcher.match(t, opts)),
      exec,
      [Symbol.replace]: (s, rep) => { const m = matcher.match(s, opts); if (!m) return String(s); const body = typeof rep === "function" ? rep(String(s).slice(m.index), m.rest) : String(rep).replace(/\$1/g, m.rest).replace(/\$&/g, String(s).slice(m.index)); return String(s).slice(0, m.index) + body; },
      lastIndex: 0, source: "(wake word)", flags: "i",
    };
  }

  const api = { MAX_CHARS, MAX_WAKE, SENSITIVITIES: Object.keys(SENS), FILLERS, VERY_COMMON, COMMON, LANTERN, DAYSPRING_ALSO,
    tokenize, words, norm, soundKey, wordKey, similarity, syllables, weight, validateName, validateWake, lanternClash, neighbours, strength,
    createMatcher, trainReport, regexLike, cap };
  root.dsWake = api;
})(typeof window !== "undefined" ? window : globalThis);
