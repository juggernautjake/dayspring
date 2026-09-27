// The details inside a request, found without AI. Each finder works on normalize()d text and reports what it found and
// where, so the matcher can see "set a timer for {dur}" instead of "set a timer for 10 minutes".
//   duration  "10 minutes", "an hour and 30 minutes", "90 seconds", "half an hour" → ms
//   time      "at 7", "7:30 pm", "noon", "quarter past 8", "7 oclock"               → "HH:MM"
//   date      "today", "tomorrow", "friday", "next tuesday", "october 21", "10/21", "in 3 days", "christmas" → "YYYY-MM-DD"
//   ref       "john 3 16", "1 cor 13 4-7", "psalm 23"                               → { book, chapter, from, to, ref }
//   version   "esv", "king james", "new living translation"                         → "esv"
import * as bible from "../bible.mjs";
import { lev } from "./text.mjs";

// dynamic patterns are compiled once
const RX = new Map();
const rx = (src) => { let r = RX.get(src); if (!r) { r = new RegExp(src); RX.set(src, r); } return r; };
const pad = (n) => String(n).padStart(2, "0");
export const toHM = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const UNIT_MS = { second: 1000, seconds: 1000, sec: 1000, minute: 60_000, minutes: 60_000, hour: 3_600_000, hours: 3_600_000, day: 86_400_000, days: 86_400_000 };
const QTY = (w) => (/^\d/.test(w) ? Number(w) : /^(a|an|1)$/.test(w) ? 1 : w === "half" ? 0.5 : /^couple( of)?$/.test(w) ? 2 : /^few$/.test(w) ? 3 : NaN);
// "an hour and 30 minutes", "1 hour 15 minutes", "90 seconds", "2.5 hours", "half hour", "a couple of minutes"
const DUR_RE = /\b(\d+(?:\.\d+)?|a|an|half|couple of|couple|few)\s+(seconds?|minutes?|hours?|days?)\b(?:\s+(?:and\s+)?(?:a\s+)?(\d+(?:\.\d+)?|half)\s*(seconds?|minutes?|hours?)?\b)?/;
// loose amounts of time people say ("in a bit" is 15 minutes, "in a little while" half an hour)
const LOOSE = [[/\bin a (?:little )?bit\b/, 15 * 60_000], [/\bin a (?:little )?while\b/, 30 * 60_000], [/\bin a sec(?:ond)?\b|\bin a moment\b/, 60_000]];
export function duration(q) {
  for (const [re, ms] of LOOSE) { const m = re.exec(q); if (m) return { ms, text: m[0], index: m.index, loose: true }; }
  const s = q.replace(/\bhalf (?:an? )?hour\b/, "30 minutes").replace(/\bquarter (?:of an? )?hour\b/, "15 minutes").replace(/\b(\d+) and half\b/, (_, n) => `${Number(n) + 0.5}`);
  const m = DUR_RE.exec(s);
  if (!m) return null;
  let ms = QTY(m[1].replace(/ of$/, "")) * UNIT_MS[m[2]];
  if (m[3]) {
    const n2 = m[3] === "half" ? 0.5 : Number(m[3]);
    ms += m[4] ? n2 * UNIT_MS[m[4]] : m[3] === "half" ? 0.5 * UNIT_MS[m[2]] : 0;
  }
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return { ms: Math.round(ms), text: m[0], index: s === q ? m.index : q.indexOf(m[1]) };
}
export function sayDuration(ms) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (mi) parts.push(`${mi} minute${mi === 1 ? "" : "s"}`);
  if (se && !h) parts.push(`${se} second${se === 1 ? "" : "s"}`);
  return parts.join(" and ") || "0 seconds";
}

// Times. A bare number counts only after at/by/until/around/from/to/for (so "10 minutes" is never 10 o'clock).
const TIME_WORD = /\b(noon|midday|midnight)\b/;
const TIME_RE = /\b(?:(at|by|until|till|around|from|to|for|before|after)\s+)?(\d{1,2})(?::(\d{2})|\s(\d{2})(?=\s*(?:am|pm|a m|p m)\b))?\s*(am|pm|a m|p m|oclock|in the morning|in the evening|at night|in the afternoon|tonight)?\b/g;
// times of day people name instead of a clock time
const TIME_PHRASES = [[/\bfirst thing(?: in the morning)?\b/, "08:00"], [/\bafter lunch\b/, "13:00"], [/\bafter dinner\b/, "19:00"], [/\bafter work\b/, "17:30"], [/\bbefore bed\b|\bat bedtime\b/, "21:30"], [/\bafter school\b/, "15:30"]];
export function time(q) {
  let m = TIME_WORD.exec(q);
  if (m) return { hm: m[1] === "midnight" ? "00:00" : "12:00", text: m[0], index: m.index };
  for (const [re, hm] of TIME_PHRASES) { const x = re.exec(q); if (x) return { hm, text: x[0], index: x.index, loose: true }; }
  const rel = /\b(quarter|half|\d{1,2})\s+(past|after|to|til|till)\s+(\d{1,2})\b/.exec(q);
  if (rel) {
    const mins = rel[1] === "quarter" ? 15 : rel[1] === "half" ? 30 : Number(rel[1]);
    let h = Number(rel[3]);
    const apm = /^\s*(am|a m|in the morning|pm|p m|in the (afternoon|evening)|at night|tonight)\b/.exec(q.slice(rel.index + rel[0].length));
    if (apm && /^\s*(am|a m|in the morning)/.test(apm[0])) { if (h === 12) h = 0; }
    else if (apm) { if (h < 12) h += 12; }
    else if (h >= 1 && h <= 7) h += 12;
    const total = /past|after/.test(rel[2]) ? h * 60 + mins : h * 60 - mins;
    return { hm: toHM(total), text: rel[0], index: rel.index };
  }
  TIME_RE.lastIndex = 0;
  while ((m = TIME_RE.exec(q))) {
    const [all, prep, hh, mm1, mm2, ap] = m;
    const mm = mm1 ?? mm2;
    if (!prep && !ap && !mm1) continue;                       // "10 minutes", "3 16" …: not a time
    if (/^(for|to)$/.test(prep ?? "") && !ap && !mm1 && /^\s*(seconds?|minutes?|hours?|days?|percent|times|x)\b/.test(q.slice(m.index + all.length))) continue;
    // "count from 10", "a number between 1 and 50", "verses 5 to 7": numbers, not times
    if (/^(from|to|by|until|till|between)$/.test(prep ?? "") && !ap && !mm1 && /\b(count|counting|number|numbers|between|random|pick|roll|verses?|chapters?|step)\b/.test(q)) continue;
    let h = Number(hh); const mi = Number(mm ?? 0);
    if (h > 23 || mi > 59) continue;
    const apx = (ap ?? "").replace(/ /g, "");
    if (/pm|evening|night|afternoon|tonight/.test(apx) && h < 12) h += 12;
    else if (/am|morning/.test(apx) && h === 12) h = 0;
    else if (!apx && h >= 1 && h <= 6) h += 12;              // "at 5" means 5 p.m.
    else if (apx === "oclock" && h >= 1 && h <= 6) h += 12;
    return { hm: toHM(h * 60 + mi), text: all.trim(), index: m.index, prep: prep ?? null };
  }
  return null;
}
export function sayTime(hm) { const [h, m] = hm.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + pad(m) : ""} ${h >= 12 ? "p.m." : "a.m."}`; }

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON_SHORT = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const ORD = (s) => Number(String(s).replace(/(st|nd|rd|th)$/, ""));
// US holidays: fixed and computed
function nthWeekday(y, month, weekday, n) { const d = new Date(y, month, 1); const add = (weekday - d.getDay() + 7) % 7; return new Date(y, month, 1 + add + (n - 1) * 7); }
function lastWeekday(y, month, weekday) { const d = new Date(y, month + 1, 0); return new Date(y, month, d.getDate() - ((d.getDay() - weekday + 7) % 7)); }
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, month - 1, day); }
export const HOLIDAYS = {
  "new years day": (y) => new Date(y, 0, 1), "new years": (y) => new Date(y, 0, 1), "new years eve": (y) => new Date(y, 11, 31),
  "martin luther king day": (y) => nthWeekday(y, 0, 1, 3), "mlk day": (y) => nthWeekday(y, 0, 1, 3), "valentines day": (y) => new Date(y, 1, 14), valentines: (y) => new Date(y, 1, 14),
  "presidents day": (y) => nthWeekday(y, 1, 1, 3), "st patricks day": (y) => new Date(y, 2, 17), "saint patricks day": (y) => new Date(y, 2, 17),
  easter: (y) => easter(y), "good friday": (y) => addDays(easter(y), -2), "palm sunday": (y) => addDays(easter(y), -7),
  "mothers day": (y) => nthWeekday(y, 4, 0, 2), "memorial day": (y) => lastWeekday(y, 4, 1), "fathers day": (y) => nthWeekday(y, 5, 0, 3),
  juneteenth: (y) => new Date(y, 5, 19), "independence day": (y) => new Date(y, 6, 4), "fourth of july": (y) => new Date(y, 6, 4), "4th of july": (y) => new Date(y, 6, 4), "july 4th": (y) => new Date(y, 6, 4),
  "labor day": (y) => nthWeekday(y, 8, 1, 1), "columbus day": (y) => nthWeekday(y, 9, 1, 2), halloween: (y) => new Date(y, 9, 31),
  "veterans day": (y) => new Date(y, 10, 11), thanksgiving: (y) => nthWeekday(y, 10, 4, 4), "black friday": (y) => addDays(nthWeekday(y, 10, 4, 4), 1),
  "christmas eve": (y) => new Date(y, 11, 24), christmas: (y) => new Date(y, 11, 25), "christmas day": (y) => new Date(y, 11, 25), "boxing day": (y) => new Date(y, 11, 26),
};
export function holiday(q, now = new Date()) {
  const names = Object.keys(HOLIDAYS).sort((a, b) => b.length - a.length);
  for (const n of names) {
    const i = q.indexOf(n);
    if (i >= 0 && (i === 0 || q[i - 1] === " ")) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let d = HOLIDAYS[n](now.getFullYear());
      if (d < today) d = HOLIDAYS[n](now.getFullYear() + 1);
      return { name: n, date: isoOf(d), text: n, index: i };
    }
  }
  return null;
}
export function date(q, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m;
  if ((m = /\bday after tomorrow\b/.exec(q))) return { iso: isoOf(addDays(today, 2)), text: m[0], index: m.index };
  if ((m = /\b(tomorrow)(?: (morning|afternoon|evening|night))?\b/.exec(q))) return { iso: isoOf(addDays(today, 1)), text: m[0], index: m.index, part: m[2] ?? null };
  if ((m = /\byesterday\b/.exec(q))) return { iso: isoOf(addDays(today, -1)), text: m[0], index: m.index };
  if ((m = /\b(today|tonight|this (?:morning|afternoon|evening))\b/.exec(q))) return { iso: isoOf(today), text: m[0], index: m.index, part: /tonight|evening/.test(m[1]) ? "evening" : null };
  if ((m = /\b(?:the )?end of (?:the |this )?month\b/.exec(q))) return { iso: isoOf(new Date(today.getFullYear(), today.getMonth() + 1, 0)), text: m[0], index: m.index };
  if ((m = /\b(?:the )?end of (?:the |this )?week\b/.exec(q))) return { iso: isoOf(addDays(today, (5 - today.getDay() + 7) % 7)), text: m[0], index: m.index };
  if ((m = /\b(?:this|the) weekend\b/.exec(q))) return { iso: isoOf(addDays(today, (6 - today.getDay() + 7) % 7)), text: m[0], index: m.index };
  if ((m = /\bin (\d+|a|an) (days?|weeks?)\b/.exec(q))) { const n = /^\d/.test(m[1]) ? Number(m[1]) : 1; return { iso: isoOf(addDays(today, /week/.test(m[2]) ? n * 7 : n)), text: m[0], index: m.index }; }
  if ((m = /\b(next|this|coming)? ?week\b/.exec(q)) && /next week/.test(q)) return { iso: isoOf(addDays(today, 7 - today.getDay() + 1)), text: "next week", index: q.indexOf("next week"), week: true };
  if ((m = rx(`\\b(?:(next|this|on|coming) )?(${DAYS.join("|")})s?\\b`).exec(q))) {
    const want = DAYS.indexOf(m[2]);
    let add = (want - today.getDay() + 7) % 7;
    if (m[1] === "next") add = add === 0 ? 7 : add < 7 && add > 0 && today.getDay() !== 0 ? add + (add <= 6 - today.getDay() ? 7 : 0) : add;
    if (add === 0 && m[1] !== "this") add = /\btoday\b/.test(q) ? 0 : 7;
    return { iso: isoOf(addDays(today, add)), text: m[0], index: m.index };
  }
  // "october 21", "oct 21st", "the 21st of october", "21 october"
  const monRe = `(${MONTHS.join("|")}|${Object.keys(MON_SHORT).join("|")})`;
  if ((m = rx(`\\b${monRe}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`).exec(q)) || (m = rx(`\\b(?:the )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${monRe}(?:\\s+(\\d{4}))?\\b`).exec(q))) {
    const monW = isNaN(Number(m[1])) ? m[1] : m[2], dayN = isNaN(Number(m[1])) ? Number(m[2]) : Number(m[1]);
    const mon = MONTHS.indexOf(monW) >= 0 ? MONTHS.indexOf(monW) : MON_SHORT[monW];
    let y = m[3] ? Number(m[3]) : now.getFullYear();
    let d = new Date(y, mon, dayN);
    if (!m[3] && d < today) d = new Date(y + 1, mon, dayN);
    if (dayN >= 1 && dayN <= 31) return { iso: isoOf(d), text: m[0], index: m.index };
  }
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(q))) {
    let y = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : now.getFullYear();
    let d = new Date(y, Number(m[1]) - 1, Number(m[2]));
    if (!m[3] && d < today) d = new Date(y + 1, Number(m[1]) - 1, Number(m[2]));
    return { iso: isoOf(d), text: m[0], index: m.index };
  }
  if ((m = /\b(?:on )?the (\d{1,2})(st|nd|rd|th)\b/.exec(q))) {
    let d = new Date(now.getFullYear(), now.getMonth(), ORD(m[1]));
    if (d < today) d = new Date(now.getFullYear(), now.getMonth() + 1, ORD(m[1]));
    return { iso: isoOf(d), text: m[0], index: m.index };
  }
  const h = holiday(q, now);
  if (h) return { iso: h.date, text: h.text, index: h.index, holiday: h.name };
  return null;
}
export function sayDate(iso, now = new Date()) {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(y, mo - 1, d), t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((dt - t) / 86_400_000);
  if (diff === 0) return "today"; if (diff === 1) return "tomorrow"; if (diff === -1) return "yesterday";
  if (diff > 1 && diff < 7) return dt.toLocaleDateString("en-US", { weekday: "long" });
  return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...(y !== now.getFullYear() ? { year: "numeric" } : {}) });
}

// Scripture: more ways people say book names than bible.parseRef knows
const BOOK_SAY = {
  "gen|genisis": "genesis", "exo|exod": "exodus", "levit": "leviticus", "numb": "numbers", "deu|deut|dt": "deuteronomy", "josh|jos": "joshua", "judg|jdg": "judges",
  "1 sam|1st samuel|first sam": "1 samuel", "2 sam|2nd samuel|second sam": "2 samuel", "1 kgs|1 kin": "1 kings", "2 kgs|2 kin": "2 kings", "1 chron|1 chr": "1 chronicles", "2 chron|2 chr": "2 chronicles",
  "neh": "nehemiah", "esth|est": "esther", "psalms|psa|pss|psalter|the psalms|psalm number": "psalm", "prov|prv|proverb": "proverbs", "eccles|ecc|qoh": "ecclesiastes",
  "song|sos|song of songs|song of sol": "song of solomon", "isa": "isaiah", "jer|jere": "jeremiah", "lam": "lamentations", "ezek|eze|ezk": "ezekiel", "dan|dn": "daniel",
  "hos": "hosea", "obad": "obadiah", "jon|jnh": "jonah", "nah": "nahum", "hab": "habakkuk", "zeph|zep": "zephaniah", "hag": "haggai", "zech|zec": "zechariah", "mal": "malachi",
  "matt|mt|mat": "matthew", "mk|mrk|mar": "mark", "lk|luk": "luke", "jn|jhn|joh": "john", "acts of the apostles": "acts", "rom|rm": "romans",
  "1 cor|1 corinth|1st corinthians|first corinthians": "1 corinthians", "2 cor|2 corinth|2nd corinthians|second corinthians": "2 corinthians", "gal": "galatians", "eph|ephes": "ephesians",
  "phil|php|philip|phillipians|philipians": "philippians", "colos": "colossians", "1 thess|1 thes|1 th": "1 thessalonians", "2 thess|2 thes|2 th": "2 thessalonians",
  "1 tim|1 ti": "1 timothy", "2 tim|2 ti": "2 timothy", "philem|phm": "philemon", "heb|hebrew": "hebrews", "jas|jms": "james",
  "1 pet|1 pe|1 pt": "1 peter", "2 pet|2 pe|2 pt": "2 peter", "1 jn|1 jhn|1st john|first john": "1 john", "2 jn|2nd john": "2 john", "3 jn|3rd john": "3 john", "jud": "jude", "rev|revelations|revelation of john|apocalypse": "revelation",
};
const BOOK_SAY_RE = Object.entries(BOOK_SAY).flatMap(([alts, full]) => alts.split("|").map((a) => [new RegExp(`(^| )${a}(?= \\d)`, "g"), `$1${full}`])).sort((a, b) => b[0].source.length - a[0].source.length);
// book names as they're misheard or mistyped ("revelatoin", "roamns"): the nearest real one, if it's close
const BOOK_WORDS = [...new Set(bible.BOOKS.map((b) => b.toLowerCase().replace(/^\d /, "").split(" ")[0]))].filter((w) => w.length >= 4);
function fixBook(w) {
  if (w.length < 4 || BOOK_WORDS.includes(w) || bible.parseRef(`${w} 1`)) return w;      // (a name bible.mjs already knows, like "psalm")
  let best = null, bd = 3;
  for (const b of BOOK_WORDS) { if (Math.abs(b.length - w.length) > 2 || b[0] !== w[0]) continue; const d = lev(w, b, 2); if (d < bd) { bd = d; best = b; } }
  return best && bd <= (w.length >= 7 ? 2 : 1) ? best : w;
}
const ORDW = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
export const fixScripture = (q) => String(q).replace(/\b([a-z]{4,})(?= \d)/g, (w) => fixBook(w))
  // "the first chapter of james" → "james 1"
  .replace(/\bthe (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d+)(?:st|nd|rd|th)? chapter of ((?:\d |first |second |third |1st |2nd |3rd )?[a-z]+)/, (_, n, b) => `${b} ${ORDW[n] ?? parseInt(n, 10)}`);
export function scripture(q) {
  q = fixScripture(q);
  let t = ` ${q} `.replace(/\bchapter (\d+) verses? (\d+)/g, "$1:$2").replace(/\bverses? (\d+) (?:through|thru|to) (\d+)/g, "$1-$2");
  for (const [re, to] of BOOK_SAY_RE) t = t.replace(re, to);
  t = t.replace(/(\d+) (\d+) (?:through|thru|to|-) ?(\d+)/g, "$1:$2-$3").replace(/([a-z]) (\d+) (\d+)\b/g, "$1 $2:$3").trim();
  const r = bible.parseRef(t);
  if (!r) return null;
  // where it sits in q (roughly: from the book's first word to the last number)
  const first = r.book.toLowerCase().replace(/^\d /, "").split(" ")[0];
  const idx = Math.max(0, q.search(new RegExp(`\\b(${first.slice(0, 3)}|\\d ${first.slice(0, 2)})`)));
  const nums = [...q.matchAll(/\d+/g)].map((m) => m.index + m[0].length);
  const end = nums.filter((n) => n > idx).slice(0, 3).at(-1) ?? idx + first.length;
  return { ...r, text: q.slice(idx, end), index: idx };
}
const VERSION_SAY = [[/\bnew king james( version)?\b/, "nkjv"], [/\bking james( version)?\b|\bauthori[sz]ed version\b/, "kjv"], [/\bnew living( translation)?\b/, "nlt"],
  [/\benglish standard( version)?\b/, "esv"], [/\bnew international( version)?\b/, "niv"], [/\bnew american standard( bible)?\b/, "nasb"], [/\bchristian standard( bible)?\b/, "csb"],
  [/\bamerican standard( version)?\b/, "asv"], [/\bworld english( bible)?\b/, "web"], [/\byoungs? literal( translation)?\b/, "ylt"], [/\bbasic english\b/, "bbe"],
  [/\bdouay( rheims)?\b/, "dra"], [/\bdarby\b/, "darby"], [/\bopen english\b/, "oeb-us"], [/\b(message|the message|msg)\b(?= (version|bible|translation))/, "msg"],
  [/\b(nkjv|kjv|nlt|esv|niv|nasb|csb|asv|web|ylt|bbe|dra|oeb|msg|amp|nrsv|rsv|hcsb)\b/, null]];
export function version(q) {
  for (const [re, v] of VERSION_SAY) { const m = re.exec(q); if (m) return { id: v ?? (m[1] === "oeb" ? "oeb-us" : m[1]), text: m[0], index: m.index }; }
  return null;
}

// Everything at once, with the request rewritten for matching ("set a timer for {dur}")
export function extract(q, now = new Date()) {
  q = fixScripture(q);
  const slots = {};
  const spans = [];
  const take = (key, found, token) => { if (!found) return; slots[key] = found; if (found.text && found.index >= 0) spans.push({ from: found.index, to: found.index + found.text.length, token }); };
  if (/\d/.test(q)) take("ref", scripture(q), "{ref}");      // (a passage always has a number)
  take("version", version(q), "{version}");
  const overlaps = (f) => spans.some((s) => f && f.index < s.to && f.index + f.text.length > s.from);
  const dur = duration(q); if (!overlaps(dur)) take("duration", dur, "{dur}");
  const tm = time(q); if (tm && !overlaps(tm)) take("time", tm, "{time}");
  const dt = date(q, now); if (dt && !overlaps(dt)) take("date", dt, "{date}");
  const pct = /\b(\d+(?:\.\d+)?) percent\b/.exec(q); if (pct && !overlaps({ index: pct.index, text: pct[0] })) take("percent", { value: Number(pct[1]), text: pct[0], index: pct.index }, "{pct}");
  let masked = q;
  for (const s of spans.sort((a, b) => b.from - a.from)) masked = masked.slice(0, s.from) + ` ${s.token} ` + masked.slice(s.to);
  masked = masked.replace(/\b\d+(?:\.\d+)?\b/g, (n) => { slots.numbers = [...(slots.numbers ?? []), Number(n)]; return "{num}"; }).replace(/\s+/g, " ").trim();
  return { slots, masked };
}
