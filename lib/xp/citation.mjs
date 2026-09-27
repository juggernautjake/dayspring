// The citation line on each badge: "{Name} achieved this milestone by {doing something} on {Month} {day-ordinal}, {year}!"
// Built once from the check-in that earned the badge (the clincher) and stored, so it never changes; only
// "update the names on my badges" re-renders it (with the same activity, date and wording, just the new name).
// Prayer and worship stay general and respectful: never the words of a prayer.
import { parseHours } from "./index.mjs";

// ---- dates -----------------------------------------------------------------------------------------------------------
export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// ISO time → "July 2nd, 2027" in the local time zone ("YYYY-MM-DD" is taken as that calendar day)
export function longDate(iso) { const d = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(iso + "T12:00:00") : new Date(iso); return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())}, ${d.getFullYear()}`; }

// ---- verbs: "run" → "running", "did the dishes" → "doing the dishes" ---------------------------------------------------
const PAST = { ran: "run", swam: "swim", did: "do", made: "make", went: "go", took: "take", wrote: "write", ate: "eat", had: "have", rode: "ride",
  drew: "draw", sang: "sing", read: "read", taught: "teach", brought: "bring", spent: "spend", met: "meet", fed: "feed", sat: "sit", led: "lead",
  swept: "sweep", built: "build", fixed: "fix", saw: "see", gave: "give", got: "get", began: "begin", hit: "hit", put: "put", cut: "cut", shot: "shoot",
  studied: "study", tidied: "tidy", emptied: "empty", practiced: "practice", practised: "practise", played: "play", prayed: "pray", stayed: "stay" };
const DOUBLE = new Set(["run", "swim", "jog", "sit", "shop", "plan", "chat", "skip", "hop", "dig", "get", "spin", "grab", "scrub", "mop", "knit", "prep", "set",
  "cut", "hit", "put", "win", "begin", "drum", "strum", "wrap", "trim", "stir", "hug", "pat", "dip", "rub", "bat", "row", "nap", "stop", "chop", "sip", "jam", "hum", "trek"]);
const NODOUBLE = new Set(["row"]);
const KNOWN_VERBS = new Set(["run", "swim", "jog", "walk", "hike", "bike", "cycle", "ride", "lift", "train", "stretch", "row", "climb", "dance", "box", "ski", "skate", "surf",
  "play", "study", "read", "review", "learn", "practice", "practise", "write", "journal", "draw", "paint", "sketch", "knit", "sew", "bake", "cook", "make", "prepare",
  "clean", "wash", "vacuum", "sweep", "mop", "tidy", "fold", "dust", "scrub", "organize", "organise", "empty", "take", "do", "mow", "weed", "water", "rake", "fix", "build",
  "call", "visit", "talk", "phone", "chat", "meet", "catch", "help", "serve", "volunteer", "teach", "tutor", "feed", "donate", "meditate", "breathe", "pray", "worship",
  "sing", "eat", "have", "garden", "plant", "work", "finish", "complete", "go", "spend", "sit", "hum", "strum", "drum", "craft", "carve", "sculpt", "compose", "record",
  "edit", "code", "plan", "prep", "chop", "grill", "roast", "fry", "attend", "lead", "listen", "reflect", "shoot", "kick", "throw", "pitch", "bowl", "golf", "fish", "camp", "explore", "watch"]);
export function gerund(verb) {
  let v = String(verb).toLowerCase();
  v = PAST[v] ?? v;
  if (!PAST[verb.toLowerCase()] && /ed$/.test(v) && !KNOWN_VERBS.has(v)) {       // "cleaned" → "clean", "baked" → "bake", "jogged" → "jog"
    const stem = v.slice(0, -2), stemE = v.slice(0, -1);
    if (/(.)\1$/.test(stem) && DOUBLE.has(stem.slice(0, -1))) v = stem.slice(0, -1);
    else if (KNOWN_VERBS.has(stemE)) v = stemE;
    else if (/ied$/.test(v)) v = v.slice(0, -3) + "y";
    else v = stem;
  }
  if (v === "be") return "being";
  if (/ie$/.test(v)) return v.slice(0, -2) + "ying";
  if (/[^aeiouy]e$/.test(v) || /[^e]ue$/.test(v)) return v.slice(0, -1) + "ing";
  if (DOUBLE.has(v) && !NODOUBLE.has(v)) return v + v.slice(-1) + "ing";
  return v + "ing";
}
const isVerbish = (w) => { const l = w.toLowerCase(); return KNOWN_VERBS.has(l) || Boolean(PAST[l]) || (/ed$/.test(l) && KNOWN_VERBS.has(gerund(l).replace(/ing$/, "")) ) || (/ed$/.test(l) && (KNOWN_VERBS.has(l.slice(0, -1)) || KNOWN_VERBS.has(l.slice(0, -2)))); };

// "a 45-minute run" → "running"; a noun that means an activity
const NOUN_ACTIVITY = { run: "running", jog: "jogging", swim: "swimming", walk: "taking a walk", hike: "hiking", ride: "cycling", "bike ride": "cycling", bike: "cycling",
  workout: "working out", yoga: "doing yoga", pilates: "doing pilates", cardio: "doing cardio", weights: "lifting weights", lift: "lifting weights", stretch: "stretching",
  climb: "climbing", dance: "dancing", game: "playing a game", match: "playing a match", meditation: "meditating", "breathing exercise": "doing a breathing exercise",
  nap: "resting", session: "practising", lesson: "taking a lesson", practice: "practising", class: "taking a class", shift: "working a shift" };

// ---- durations -----------------------------------------------------------------------------------------------------
export function forDuration(hours) {
  if (!(hours > 0)) return "";
  const mins = Math.round(hours * 60);
  if (mins < 60) return `for ${mins} minute${mins === 1 ? "" : "s"}`;
  if (mins === 60) return "for an hour";
  if (mins === 90) return "for an hour and a half";
  if (mins % 60 === 0) return `for ${mins / 60} hours`;
  if (mins % 30 === 0) return `for ${Math.floor(mins / 60)} and a half hours`;
  return `for ${mins} minutes`;
}
const DURATION_RE = /\b(?:for )?(?:about |around |roughly |nearly |almost )?(?:an? |one |two |three |\d+(?:\.\d+)?\s*)(?:and a half )?(?:-| )?(?:hours?|hrs?|h|minutes?|mins?)\b(?: and a half)?(?: long)?/gi;

// ---- the activity phrase for a check-in ---------------------------------------------------------------------------------
const clean = (t) => String(t ?? "").split("\n")[0].replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
const firstClause = (t) => clean(t).split(/(?<=[.!?;])\s|[.!?;]$|,\s+(?=(?:and |then |but |so ))/)[0].replace(/[.!?;,]+$/, "").trim();
const tidy = (t) => t.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").trim();
const MAXW = 9;
const clipWords = (t, n = MAXW) => { const w = t.split(" "); return w.length > n ? w.slice(0, n).join(" ").replace(/\b(and|or|with|the|a|an|of|to|for|at|in|on)$/i, "").trim() : t; };
const FALLBACK = { workout: "completing a workout", sports: "playing sports", worship: "worshipping at church", prayer: "spending time in prayer", eating: "eating a healthy meal",
  chore: "doing chores around the house", study: "completing a study session", reading: "reading", practice: "practising", call: "reaching out to someone they love", writing: "writing",
  outdoors: "spending time outdoors", sleep: "getting to bed on time", cooking: "cooking a meal", volunteer: "serving others", art: "making something creative",
  mindfulness: "taking a mindful moment", work: "completing a focused work session" };
// the verb a bare object takes: "dishes" (chore) → "doing the dishes", "pasta" (cooking) → "cooking pasta"
const OBJ_VERB = { workout: "doing", sports: "playing", eating: "eating", chore: "doing", study: "studying", reading: "reading", practice: "practising", call: "calling",
  writing: "writing", outdoors: "enjoying", cooking: "cooking", volunteer: "helping with", art: "making", mindfulness: "practising", work: "working on" };
const CHORE_NOUNS = { dishes: "doing the dishes", laundry: "doing the laundry", vacuuming: "vacuuming", trash: "taking out the trash", garbage: "taking out the trash",
  bathroom: "cleaning the bathroom", kitchen: "cleaning the kitchen", floors: "cleaning the floors", room: "tidying their room", bed: "making the bed", lawn: "mowing the lawn" };

// { phrase, hours, private } for a clincher entry (evidence, title, hours, category, at)
export function activity(e) {
  const cat = e.category, hours = e.hours ?? (cat === "work" ? null : parseHours(e.evidence ?? "")) ?? null;
  const dur = cat === "work" ? forDuration(e.hours ?? null) : forDuration(hours);
  const hourOf = new Date(e.at).getHours(), part = hourOf < 12 ? "morning" : hourOf < 17 ? "afternoon" : "evening";
  if (cat === "prayer") return { phrase: `spending time in ${part} prayer`, private: true };
  if (cat === "worship") return { phrase: new Date(e.at).getDay() === 0 ? "worshipping at Sunday service" : "worshipping with their church", private: true };
  if (cat === "sleep") return { phrase: "getting to bed on time" };
  if (e.source === "lantern") {                                     // verified learning in Lantern
    const course = String(e.courseTitle ?? e.course ?? "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+\d{3}$/, "").trim(), t = clean(e.title ?? "");
    const inC = course ? ` in ${course}` : "";
    const p = { lesson: t ? `completing the lesson “${t}”${inC}` : `completing a lesson${inC}`, exercise: t ? `passing the exercise “${t}”${inC}` : `passing an exercise${inC}`,
      practice: `practising${inC} ${forDuration((e.minutes ?? 0) / 60)}`, check: t ? `passing the ${t}${inC}` : `passing a unit check${inC}`, milestone: t ? `reaching the project milestone “${t}”${inC}` : `reaching a project milestone${inC}`,
      unit: t ? `finishing ${t}${inC}` : `finishing a unit${inC}`, course: `finishing the ${course || "whole"} course` }[e.kind];
    if (p) return { phrase: tidy(p) };
  }
  let ev = firstClause(e.evidence ?? "");
  ev = ev.replace(/^(?:well,?\s*|so,?\s*|yeah,?\s*|yes,?\s*|um,?\s*)/i, "").replace(/^(?:i\s+(?:just\s+|finally\s+|also\s+)?|we\s+(?:just\s+)?)/i, "");
  if (cat === "study" || cat === "reading") {                       // their answer is what they learned; the title says what they studied
    const subj = clean(e.title ?? "").replace(/^(study|studying|reading|read)\s*:?\s*/i, "");
    const base = cat === "study" ? (subj ? `studying ${subj}` : "studying") : (subj ? `reading ${subj}` : "reading");
    return { phrase: tidy(`${clipWords(base, 6)} ${dur}`) };
  }
  if (cat === "work") { const subj = clean(e.title ?? "").replace(/^(work|focus|deep work)\s*:?\s*/i, ""); return { phrase: tidy(`working${subj ? ` on ${clipWords(subj, 5)}` : ""} ${dur}`) }; }
  if (cat === "call") {
    let who = ev.replace(/^(?:called|phoned|visited|facetimed|talked (?:to|with)|spoke (?:to|with)|caught up with|chatted with)\s+/i, "").replace(DURATION_RE, "").trim();
    who = clipWords(who, 4);
    return { phrase: who && !/^(someone|somebody|no one|nobody)$/i.test(who) ? tidy(`catching up with ${who} ${dur}`) : tidy(`reaching out to someone they love ${dur}`) };
  }
  if (!ev) return { phrase: tidy(`${FALLBACK[cat] ?? "completing a check-in"} ${dur}`), fallback: true };
  // "a 45-minute run", "30 min jog", "an hour of yoga"
  const noun = /^(?:a |an )?(?:\d+(?:\.\d+)?|an?|one|two|half an?)?[- ]?(?:hour|hr|minute|min)s?[- ](?:long )?(?:of )?(.+)$/i.exec(ev);
  let body = noun ? noun[1] : ev;
  body = body.replace(DURATION_RE, "").replace(/\s{2,}/g, " ").replace(/^(?:a |an )/i, (m) => m).trim();
  const words = body.split(" ").filter(Boolean);
  let phrase = "";
  const nounKey = body.toLowerCase().replace(/^(?:a|an|my|the)\s+/, "");
  if (NOUN_ACTIVITY[nounKey]) phrase = NOUN_ACTIVITY[nounKey];
  else if (cat === "chore" && CHORE_NOUNS[nounKey.replace(/^the\s+/, "")]) phrase = CHORE_NOUNS[nounKey.replace(/^the\s+/, "")];
  else if (words.length && isVerbish(words[0])) {
    const rest = words.slice(1).join(" ");
    phrase = `${gerund(words[0])}${rest ? " " + rest : ""}`;
    phrase = phrase.replace(/^taking (?:a )?walk\b/i, "taking a walk").replace(/\b(my|our)\b/gi, "their");
  } else if (words.length) {
    const verb = OBJ_VERB[cat] ?? "doing";
    phrase = `${verb} ${body.replace(/\b(my|our)\b/gi, "their")}`;
    if (cat === "outdoors" && !/^(a |an |the |some )/i.test(body)) phrase = `enjoying ${body}`;
  }
  if (!phrase) return { phrase: tidy(`${FALLBACK[cat]} ${dur}`), fallback: true };
  phrase = clipWords(phrase.replace(/[.!?,;:]+$/, ""));
  if (dur && !/\bfor (\d|an? |about)/i.test(phrase)) phrase = `${phrase} ${dur}`;
  return { phrase: tidy(phrase) };
}

// ---- the whole line -------------------------------------------------------------------------------------------------
const VARIANTS = ["achieved this milestone by", "earned this badge by", "reached this milestone by", "unlocked this honour by", "earned this milestone by"];
export function variantFor(cat, tier) { let h = 2166136261; for (const ch of `${cat}:${tier}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return tier === 1 ? 0 : (h >>> 0) % VARIANTS.length; }
// who: the name as it should read ("Casey", or "You" for none). their: the possessive to use for "their".
export function nameFor(mode, { name = "", nickname = "" } = {}) {
  if (mode === "none") return { who: "You", their: "your" };
  const n = mode === "nickname" ? nickname || name : name;
  return n ? { who: n, their: "their" } : { who: "You", their: "your" };
}
// parts = { who, their, verb, activity, date } → the sentence
export function render(parts) {
  const act = parts.their && parts.their !== "their" ? parts.activity.replace(/\btheir\b/g, parts.their).replace(/\bthey love\b/g, "you love") : parts.activity;
  return `${parts.who} ${parts.verb} ${act} on ${parts.date}!`;
}
// clincher entry + badge (cat, tier) + name settings → { text, parts }
export function build(e, { cat, tier, mode = "name", name = "", nickname = "" } = {}) {
  const a = activity(e);
  const n = nameFor(mode, { name, nickname });
  const parts = { who: n.who, their: n.their, verb: VARIANTS[variantFor(cat, tier)], activity: a.phrase, date: longDate(e.source === "lantern" || !e.day ? e.at : e.day), private: Boolean(a.private), fallback: Boolean(a.fallback), mode };
  return { text: render(parts), parts };
}
// "update the names on my badges": the same citation with a new name
export function rename(parts, { mode = "name", name = "", nickname = "" } = {}) {
  const n = nameFor(mode, { name, nickname });
  const next = { ...parts, who: n.who, their: n.their, mode };
  return { text: render(next), parts: next };
}
// The spoken version after the persona styles it: the name, the activity and the date must survive word for word,
// otherwise the plain line is used.
export function styledKeepsFacts(styled, parts) {
  const s = String(styled ?? "");
  return [parts.who === "You" ? "" : parts.who, parts.activity.replace(/\btheir\b/g, parts.their ?? "their").split(" ").slice(0, 3).join(" "), parts.date].every((x) => !x || s.includes(x));
}
