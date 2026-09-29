// When something happens, from what was said (no AI): a day, a time, how long, and how often.
//   when(q, now)    → { date, time, explicit, part, minutes, end, texts[] }   (texts: the words used, to cut from a title)
//   repeatIn(q, now) → { repeat, texts[], part } | null   (a lib/recur.mjs rule: every other week, the first Monday…)
//   soonest(hm, now) → the next "7:30" (a.m. or p.m., whichever comes first) when no a.m./p.m. was said
// Times of day said without a clock time (documented in docs/things-you-can-say.md):
//   morning 9 a.m. · first thing 8 a.m. · noon / lunch 12 p.m. · afternoon 2 p.m. · after work 5:30 p.m. · evening 6 p.m.
//   dinner 6 p.m. · tonight / night 8 p.m. · bedtime 9:30 p.m. · this weekend: Saturday
// A bare hour: 1–6 means p.m., 7–11 a.m., unless the words say otherwise ("at 9 tonight", "every weeknight at 9" → 9 p.m.).
import { date as slotDate, time as slotTime, duration as slotDur, isoOf, toHM } from "../intents/slots.mjs";
import * as recur from "../recur.mjs";

export const PART_TIMES = { "first thing": "08:00", morning: "09:00", noon: "12:00", lunch: "12:00", lunchtime: "12:00", afternoon: "14:00", "after work": "17:30", evening: "18:00", dinner: "18:00", dinnertime: "18:00", tonight: "20:00", night: "20:00", bedtime: "21:30" };
const PART_RE = /\b(first thing|tomorrow morning|this morning|in the morning|morning|at noon|noon|lunch ?time|at lunch|lunch|this afternoon|in the afternoon|afternoon|after work|this evening|in the evening|evening|at dinner|dinner ?time|dinner|tonight|at night|night|weeknights?|nightly|bedtime|before bed)\b/;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function partOf(q) {
  const m = PART_RE.exec(q);
  if (!m) return null;
  const w = m[1];
  if (/first thing/.test(w)) return "first thing";
  if (/morning/.test(w)) return "morning";
  if (/noon/.test(w)) return "noon";
  if (/lunch/.test(w)) return "lunch";
  if (/afternoon/.test(w)) return "afternoon";
  if (/after work/.test(w)) return "after work";
  if (/evening/.test(w)) return "evening";
  if (/dinner/.test(w)) return "dinner";
  if (/bed/.test(w)) return "bedtime";
  if (/tonight/.test(w)) return "tonight";
  return "night";
}
const EVENINGISH = /\b(tonight|night|nights|nightly|weeknights?|evening|evenings|afternoon|afternoons|dinner|after work|pm|p m)\b/;

// the day: slots.mjs, plus "next month on the 5th", "the 5th of next month", "next weekend"
export function dateIn(q, now = new Date()) {
  const today = midnight(now);
  let m;
  if ((m = /\bnext month on the (\d{1,2})(?:st|nd|rd|th)?\b|\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)? (?:of )?next month\b/.exec(q))) {
    const n = Number(m[1] ?? m[2]);
    if (n >= 1 && n <= 31) return { iso: isoOf(new Date(today.getFullYear(), today.getMonth() + 1, n)), text: m[0] };
  }
  if ((m = /\bnext weekend\b/.exec(q))) { const toSat = (6 - today.getDay() + 7) % 7; return { iso: isoOf(addDays(today, today.getDay() === 0 ? toSat : toSat + 7)), text: m[0] }; }
  if ((m = /\b(this|the) weekend\b/.exec(q))) return { iso: isoOf(addDays(today, (6 - today.getDay() + 7) % 7)), text: m[0] };
  if ((m = /\b(a week from (today|now)|in a week)\b/.exec(q))) return { iso: isoOf(addDays(today, 7)), text: m[0] };
  if ((m = /\bnext month\b/.exec(q)) && !/\b(until|through|for) (the )?next month\b/.test(q)) return { iso: isoOf(new Date(today.getFullYear(), today.getMonth() + 1, 1)), text: m[0], vague: true };
  const d = slotDate(q, now);
  if (d) return { iso: d.iso, text: d.text, part: d.part ?? null, week: d.week ?? false };
  return null;
}

// the time: slots.mjs, with the evening words deciding a bare hour, and "this weekend" etc. getting a default
export function when(q, now = new Date()) {
  const out = { date: null, time: null, explicit: false, part: null, minutes: null, end: null, texts: [] };
  const d = dateIn(q, now);
  if (d) { out.date = d.iso; out.texts.push(d.text); if (d.vague) out.vague = true; }
  // (a date's own numbers aren't a time: "on the 15th at 3" → the 15th, 3 p.m.)
  let tq = q;
  if (d?.text && /\d/.test(d.text)) tq = q.replace(d.text, " ");
  // ranges: "from 3 to 5", "3 to 5 pm", "3-5"
  const range = /\b(?:from )?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?\s*(?:to|till|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?\b/.exec(tq);
  let t = slotTime(tq);
  if (range && (range[3] || range[6] || /\bfrom\b|\bat\b/.test(range[0]) || /\b(from|at) \d/.test(tq))) {
    const ap2 = (range[6] ?? "").replace(" ", ""), ap1 = (range[3] ?? "").replace(" ", "") || ap2;
    const mk = (h, mi, ap) => { h = Number(h); if (ap === "pm" && h < 12) h += 12; else if (ap === "am" && h === 12) h = 0; else if (!ap && h >= 1 && h <= 6) h += 12; return toHM(h * 60 + Number(mi ?? 0)); };
    const s = mk(range[1], range[2], ap1), e = mk(range[4], range[5], ap2 || ap1);
    if (e > s) { t = { hm: s, text: range[0], explicit: Boolean(ap1) }; out.end = e; }
  }
  if (t) {
    out.time = t.hm; out.texts.push(t.text);
    // (said, not worked out: slots.mjs already turns a bare "6" into 6 p.m., so the hour in the words decides)
    const saidHour = Number((/(\d{1,2})(?::\d{2})?/.exec(t.text) ?? [])[1] ?? 0);
    out.explicit = t.explicit ?? (/(am|pm|a m|p m)\b|\b(morning|evening|night|afternoon|tonight|noon|midnight|midday)\b/.test(t.text) || saidHour > 12 || saidHour === 0 && /\b00?:\d\d\b/.test(t.text) || /\b0\d:\d\d\b/.test(t.text) || !/\d/.test(t.text));
    if (/^(noon|midnight|midday)$/.test(t.text)) out.explicit = true;
    // "at 9 tonight", "every weeknight at 9", "at 7 after dinner": the evening one
    const h = Number(t.hm.slice(0, 2));
    if (!out.explicit && EVENINGISH.test(q) && h < 12) { out.time = toHM((h + 12) * 60 + Number(t.hm.slice(3))); out.explicit = true; }
    if (!out.explicit && /\bmorning\b/.test(q) && h >= 12 && h < 18) { out.time = toHM((h - 12) * 60 + Number(t.hm.slice(3))); out.explicit = true; }
    if (t.loose) out.explicit = true;
  }
  out.part = partOf(q) ?? d?.part ?? null;
  // "every sunday evening", "tomorrow morning": the part of the day is a when, not part of the name ("dinner" and
  // "lunch" can be the name, so they stay)
  // (only when it's said as a time: "date night", "game night" and "morning routine" keep theirs)
  { const pm = /\b(in the|at|this|tomorrow|every|each|on|(?:sun|mon|tues|wednes|thurs|fri|satur)days?) (morning|afternoon|evening|night)s?\b/.exec(q) ?? /\b(first thing( in the morning)?|before bed|after work|at bedtime)\b/.exec(q);
    if (pm) { const txt = /^(every|each|on|(?:sun|mon|tues|wednes|thurs|fri|satur)days?)$/.test(pm[1]) ? pm[0].split(" ").slice(1).join(" ") : pm[0]; if (!out.texts.some((x) => x.includes(txt))) out.texts.push(txt); } }
  if (!out.time && out.part && !/\bweeknights?\b/.test(q)) { out.time = PART_TIMES[out.part]; out.fromPart = true; out.explicit = true; }
  if (!out.time && out.part && /\bweeknights?\b/.test(q)) { out.time = PART_TIMES.night; out.fromPart = true; out.explicit = true; }
  // how long: "for an hour", "for 90 minutes", "for an hour and a half" (never "for the next 3 weeks")
  const lm = /\bfor (?:an? |the )?(?:\d+(?:\.\d+)?|an?|half an?|one|two|three|half)?\s*(?:hours?|minutes?|mins?)(?: and (?:a )?half| and \d+ minutes?)?\b/.exec(q);
  if (lm && !/\bfor the next\b/.test(lm[0])) { const du = slotDur(lm[0].replace(/^for /, "").replace(/\bmins?\b/, "minutes").replace(/\bhalf an? hour\b/, "30 minutes")); if (du) { out.minutes = Math.round(du.ms / 60000); out.texts.push(lm[0]); } }
  return out;
}

// "7:30" with no a.m./p.m.: the next one to come round
export function soonest(hm, now = new Date()) {
  const [h, m] = hm.split(":").map(Number);
  const cands = [h % 12, (h % 12) + 12].map((hh) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, m); if (d <= now) d.setDate(d.getDate() + 1); return d; }).sort((a, b) => a - b);
  return { hm: toHM(cands[0].getHours() * 60 + m), date: isoOf(cands[0]) };
}

// ---- how often ----------------------------------------------------------------------------------------------------------
// recur.parse understands: every day, every other day, every 3 days, weekdays, weekends, every monday, mondays and
// wednesdays, every other week, every 2 weeks on friday, monthly, the 15th of every month, the first monday of every
// month, yearly, "until december 1", "except holidays". Added here: weeknights, every morning/night, biweekly,
// monday through friday, every day except weekends / sundays, "until December", "for the next 3 weeks",
// "starting next monday", "on the 15th of each month" said with words, and "every thursday night".
export function repeatIn(q, now = new Date()) {
  let t = ` ${q} `;
  const texts = [];
  let part = null, until = null, start = null, m;
  const cut = (re, keep = "") => { const x = re.exec(t); if (x) { texts.push(x[0].trim()); t = t.replace(x[0], ` ${keep} `); } return x; };
  // (first: "monday through friday" is weekdays, not "until Friday")
  cut(/ (?:every |on )?(?:monday (?:through|thru|to) friday|mon (?:through|thru|to) fri) /, "weekdays");
  // how long it goes on
  if ((m = cut(/ (?:for|over) (?:the )?(?:next )?(\d+|a|an|one|two|three|four|five|six|couple of) (days?|weeks?|months?) /))) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, "couple of": 2 }[m[1]] ?? 1;
    const days = /week/.test(m[2]) ? n * 7 : /month/.test(m[2]) ? n * 30 : n;
    until = isoOf(addDays(midnight(now), days - 1));
  }
  if (!until && (m = cut(/ (?:until|till|through|thru|to) (?:the end of )?(january|february|march|april|may|june|july|august|september|october|november|december)(?! \d) /))) {
    const mi = MONTHS.indexOf(m[1]);
    let y = now.getFullYear(); if (mi < now.getMonth() || (mi === now.getMonth() && !/end of/.test(m[0]))) y++;
    // "until December": up to the end of November; "through December" / "until the end of December": the whole month
    until = /through|thru|end of/.test(m[0]) ? isoOf(new Date(y, mi + 1, 0)) : isoOf(new Date(y, mi, 0));
  }
  if (!until && (m = / (?:until|till|through|thru|ending(?: on)?) (the end of (?:the |this )?(?:month|week|year)|next \w+|(?:this |next )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|christmas|thanksgiving|new years?|tomorrow|(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(?:st|nd|rd|th)?(?: \d{4})?) /.exec(t))) {
    const phrase = m[1];
    const d = /end of (the |this )?year/.test(phrase) ? { iso: `${now.getFullYear()}-12-31` } : dateIn(phrase, now);
    if (d) { until = d.iso; texts.push(m[0].trim()); t = t.replace(m[0], " "); }
  }
  if ((m = / (?:starting|beginning|from|as of) (?:on )?(tomorrow|today|next \w+|(?:this )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(?:st|nd|rd|th)?|the \d{1,2}(?:st|nd|rd|th)?) /.exec(t))) {
    const d = dateIn(m[1], now); if (d) { start = d.iso; texts.push(m[0].trim()); t = t.replace(m[0], " "); }
  }
  // words recur.parse doesn't know
  if ((m = cut(/ (?:every |each |on )?week ?nights? /, "weekdays"))) part = "night";
  if ((m = cut(/ (?:every|each) (morning|night|evening|afternoon)s? | (nightly) /, "every day"))) part = m[1] ?? "night";
  cut(/ (?:bi-?weekly|fortnightly|every fortnight) /, "every other week");
  // "every other friday", "every second tuesday", "every 2nd monday" → every other week on that day
  { const x = / (?:every|each) (other|second|2nd|third|3rd) ((?:sun|mon|tues|wednes|thurs|fri|satur)day)s? /.exec(t); if (x) { texts.push(x[0].trim()); t = t.replace(x[0], ` every ${/third|3rd/.test(x[1]) ? 3 : 2} weeks on ${x[2]} `); } }
  cut(/ (?:every day|daily) (?:except|but not|other than) (?:on )?(?:the )?weekends? /, "weekdays");
  cut(/ (?:only )?on weekdays only | weekdays only /, "weekdays");
  const except = / (?:every day|daily) (?:except|but not|other than) (?:on )?((?:(?:sun|mon|tues|wednes|thurs|fri|satur)days?(?:,| and| or)? ?)+) /.exec(t);
  let dropDays = [];
  if (except) { dropDays = [...except[1].matchAll(/(sun|mon|tue|wed|thu|fri|sat)/g)].map((x) => x[1]); texts.push(except[0].trim()); t = t.replace(except[0], " every day "); }
  // "on the 15th of each month" / "on the 1st every month"
  const r = recur.parse(t, { today: isoOf(now) });
  if (!r) return null;
  const rep = { ...r.repeat };
  if (dropDays.length) { rep.freq = "weekly"; rep.interval = 1; rep.days = recur.WEEKDAYS.filter((d) => !dropDays.includes(d)); }
  if (until && !rep.until) rep.until = until;
  if (start) rep.start = start;
  // what recur.parse took out of the words (so the title can lose it too), as the runs of words it took
  const before = t.trim().split(/\s+/), after = r.rest.split(/\s+/);
  let run = [];
  for (const w of [...before, "\u0000"]) { if (w !== "\u0000" && !after.includes(w)) run.push(w); else { if (run.length) texts.push(run.join(" ")); run = []; } }
  if (!part) part = /\bnights?\b|\bnightly\b/.test(q) ? "night" : /\bmornings?\b/.test(q) ? "morning" : /\bevenings?\b/.test(q) ? "evening" : /\bafternoons?\b/.test(q) ? "afternoon" : null;
  return { repeat: rep, texts, part, rest: r.rest };
}
export const describeRepeat = (rep) => recur.describe({ repeat: rep, days: rep.days });
export { DAYS };
