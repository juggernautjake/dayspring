// Everything Dayspring understands without AI. Each intent:
//   id, cat (family), label (what the suggestion list says), ex (a canonical example)
//   say: many ways people say it, in a tiny template language: (a|b|c) choose one, [x] optional,
//        {dur} {time} {date} {num} {ref} {version} {pct} are details found by slots.mjs, {text} is free words
//   plan(ctx) → the action to run, as data: { do: "timer.start", ms, label } (tests check these; index.mjs runs them)
//   label(ctx) → the suggestion's words with details filled in ("Set a timer for 10 minutes")
//   risky: true → Dayspring asks before doing it
//   instant: true → safe to run straight away even when an AI is set up (timers, math, time …)
import { sayDuration, sayTime, sayDate } from "./slots.mjs";
import { cityIn } from "../everyday.mjs";
import { MORE } from "./catalog-more.mjs";
import { PERSONA_INTENTS } from "../persona/intents.mjs";
import { IMAGE_INTENTS } from "./images.mjs";
import { GIF_INTENTS } from "./gifs.mjs";
import { MEDIALIB_INTENTS } from "./medialib.mjs";
import { VIDEO_INTENTS } from "./video.mjs";
import { MEDIABROWSER_INTENTS } from "./mediabrowser.mjs";
import { MAIL_INTENTS } from "./mail.mjs";
import { DEVICE_INTENTS } from "./devices.mjs";
import { CAMERA_INTENTS } from "./cameras.mjs";
import { SHOPPING_INTENTS } from "./shopping.mjs";

const strip = (q, ...res) => { let s = ` ${q} `; for (const r of res) s = s.replace(r, " "); return s.replace(/\s+/g, " ").trim(); };
const slotText = (c) => [c.slots.duration?.text, c.slots.time?.text, c.slots.date?.text].filter(Boolean);
const withoutSlots = (c) => { let s = ` ${c.q} `; for (const t of slotText(c)) s = s.replace(` ${t} `, " "); return s.replace(/\s+/g, " ").trim(); };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clip = (s, n = 40) => (s && s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") : s);
const firstNum = (c) => c.slots.numbers?.[0] ?? null;

// ---- timer labels from how it was asked -------------------------------------------------------------------------------
const NOT_LABEL = /^(a|an|the|new|another|quick|simple|kitchen|egg|countdown|my|one|1|second|minute|minutes|hour|hours|seconds|timer|timers|set|start|make|put|on|for|me|up|to|it|that|this|of|just|please|in)$/;
export function timerLabel(c) {
  const q = c.q, dur = c.slots.duration?.text ?? "";
  const tidy = (s) => { const w = String(s ?? "").replace(/\b(please|now|right now|for me|thanks|ok|okay)\b/g, " ").replace(/\s+/g, " ").trim().split(" ").filter((x) => x && !/^\d/.test(x)); while (w.length && NOT_LABEL.test(w[0])) w.shift(); while (w.length && NOT_LABEL.test(w.at(-1))) w.pop(); const out = w.join(" "); return out && !/^(minute|second|hour)s?$/.test(out) ? clip(out, 30) : ""; };
  let m;
  const q2 = dur ? q.replace(dur, " {D} ").replace(/\s+/g, " ") : q;
  if ((m = /\bremind me (?:in )?\{D\}(?: from now)? (?:to|that|about) (.+)$/.exec(q2)) || (m = /\bremind me (?:to|that|about) (.+?) in \{D\}/.exec(q2))) return tidy(m[1]);
  if ((m = /\b(?:called|named|labeled|labelled|name it|call it)\s+(?:the )?(.+?)(?:\s+(?:for|timer)\b.*)?$/.exec(q2))) return tidy(m[1]);
  if ((m = /\{D\}\s*timer\s+(?:for|on)\s+(?:the |my )?(.+)$/.exec(q2))) return tidy(m[1]);
  if ((m = /\btimer\s+(?:for|of)\s+\{D\}\s+(?:for|on)\s+(?:the |my )?(.+)$/.exec(q2))) return tidy(m[1]);
  if ((m = /\b(?:for|on) (?:the |my )?(.+?) (?:for|timer for|to|in) \{D\}/.exec(q2)) && !/\btimer\b/.test(m[1])) return tidy(m[1]);
  if ((m = /\btime (?:the |my )?(.+?) for \{D\}/.exec(q2))) return tidy(m[1]);
  if ((m = /\b(?:set|start|make|put on|put|give me|i need|need)?\s*(?:a |an |the |another )?([a-z][a-z ]*?)\s+timer\b/.exec(q2))) return tidy(m[1].replace(/\{D\}/g, ""));
  if ((m = /\btimer\s+(?:for|of)\s+\{D\}\s+(?:to|so i can|while) (.+)$/.exec(q2))) return tidy(m[1]);
  return "";
}
// which timer they mean ("the pasta timer", "the second timer", "timer 2", "all")
export function timerRef(c) {
  const q = c.q;
  if (/\b(all|every|each)( (of )?(the|my))? timers?\b|\ball of them\b/.test(q)) return "all";
  let m;
  if ((m = /\b(?:the |my )?(first|second|third|fourth|fifth|sixth|seventh|last|1st|2nd|3rd|4th|5th|6th|7th) (?:one|timer)\b/.exec(q))) return m[1];
  if ((m = /\btimer (?:number )?(\d)\b/.exec(q))) return m[1];
  if ((m = /\b(?:the |my )?([a-z][a-z ]{1,30}?) timer\b/.exec(q))) { const l = m[1].replace(/\b(the|my|a|an|this|that|current|kitchen|cancel|stop|pause|resume|restart|delete|remove|clear|end|kill|how|much|long|left|on|is|there|add|to|time|minutes?|seconds?|hours?|more|extra|rename|call|name|reset|dismiss|turn off|off|silence|mute|check|what|whats|about)\b/g, " ").replace(/\s+/g, " ").trim(); if (l && !/^\d/.test(l)) return l; }
  if ((m = /\b(?:on|for) (?:the |my )([a-z][a-z ]+?)(?:\?|$)/.exec(q)) && !/\btimers?\b/.test(m[1])) return m[1].trim();
  return "";
}

// ---- schedule words ---------------------------------------------------------------------------------------------------
const SCHED_VERBS = /\b(add|put|schedule|book|pencil in|plan|set up|create|make|new|an event|an appointment|a meeting|appointment|event|meeting|to my schedule|on my schedule|to my calendar|on my calendar|to the schedule|to the calendar|on the calendar|on the schedule|in my calendar|for|at|on|called|named|block|time for|from)\b/g;
function eventTitle(c) {
  const s = withoutSlots(c).replace(/\b(can you|could you|i need|i want|i would like|to|please|also|remember)\b/g, " ").replace(SCHED_VERBS, " ").replace(/\b(a|an|the|my)\s+(?=\b)/g, " ").replace(/\s+/g, " ").trim();
  return clip(cap(s.replace(/^(a|an|the|my) /, "")), 60);
}
function blockRef(c, verbs) {
  let s = withoutSlots(c);
  for (const v of verbs) s = s.replace(v, " ");
  const out = s.replace(/\b(my|the|a|an|to|from|on|at|for|by|back|later|earlier|up|forward|until|schedule|calendar|event|appointment|meeting|block|please|it|thing)\b/g, " ").replace(/\s+/g, " ").trim();
  // "move the meeting to 3": the generic word is all there is to go on
  return out || (/\b(meeting|appointment|event)\b/.exec(s)?.[1] ?? "");
}

// ---- helpers for free words -------------------------------------------------------------------------------------------
function after(q, re) { const m = re.exec(q); return m ? q.slice(m.index + m[0].length).trim() : ""; }
const APP_ALIASES = /\b(word|excel|powerpoint|outlook|notepad|paint|calculator|calc|chrome|edge|firefox|brave|spotify|discord|steam|zoom|teams|slack|file explorer|explorer|settings|terminal|command prompt|vs code|visual studio code|photos|camera|clock|calendar|mail|onenote|obs|vlc|itunes|netflix|whatsapp|telegram|signal|skype)\b/;
const SITES = { youtube: "https://www.youtube.com", google: "https://www.google.com", gmail: "https://mail.google.com", facebook: "https://www.facebook.com", amazon: "https://www.amazon.com", netflix: "https://www.netflix.com", twitter: "https://x.com", x: "https://x.com", reddit: "https://www.reddit.com", wikipedia: "https://en.wikipedia.org", instagram: "https://www.instagram.com", linkedin: "https://www.linkedin.com", "google maps": "https://maps.google.com", maps: "https://maps.google.com", "google drive": "https://drive.google.com", drive: "https://drive.google.com", "google docs": "https://docs.google.com", weather: "https://weather.gov", espn: "https://www.espn.com", ebay: "https://www.ebay.com", pinterest: "https://www.pinterest.com", "bible gateway": "https://www.biblegateway.com", github: "https://github.com", hulu: "https://www.hulu.com", "disney plus": "https://www.disneyplus.com", twitch: "https://www.twitch.tv", "the news": "https://news.google.com", news: "https://news.google.com", outlook: "https://outlook.live.com", chatgpt: "https://chatgpt.com", claude: "https://claude.ai" };
export function siteFrom(q) {
  const d = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|io|co|tv|us|me|app|dev|ai))\b/.exec(q);
  if (d) return { url: `https://${d[1]}`, name: d[1] };
  for (const k of Object.keys(SITES).sort((a, b) => b.length - a.length)) if (new RegExp(`\\b${k}\\b`).test(q)) return { url: SITES[k], name: k };
  return null;
}
function listFrom(q) {
  const m = /\b(?:my |the |our )?([a-z]+(?: [a-z]+)?) list\b/.exec(q);
  if (m && !/^(to do|todo|task|the|my)$/.test(m[1])) return m[1].replace(/^(my|the|our) /, "");
  if (/\b(grocer|shopping|store)/.test(q)) return "shopping";
  return "shopping";
}
function listItem(q, verbs) {
  let s = q;
  for (const v of verbs) s = s.replace(v, " ");
  return s.replace(/\b(to|on|onto|from|off|of|in)\s+(?:my|the|our)\s+[a-z]+(?: [a-z]+)? list\b/, " ").replace(/\b(to|on|onto|from|off)\s+(?:the |my )?(list|grocery|shopping|groceries)\b/, " ").replace(/\b(please|we need|we are out of|we're out of|i need|buy|get|pick up)\b/g, " ").replace(/\s+/g, " ").trim().replace(/^(some|a|an|the|more)\s+/, "");
}
function recipeName(q) {
  return q.replace(/\b(let us|lets|i want to|i would like to|we are going to|we're going to|time to|help me|walk me through|start|begin|cook|cooking|make|making|bake|baking|the recipe for|recipe for|the recipe|a recipe|recipe|my|the|some|mode|guide me through|how do i make|how to make|show me|open|pull up|read me|read)\b/g, " ").replace(/\b(for \d+ (people|servings?|persons?)|double it|half it|halve it|triple it)\b/g, " ").replace(/\s+/g, " ").trim();
}
function dishFrom(q) {
  return q.replace(/\b(find|search( for)?|look up|look for|get|show|give|pull up|can you|could you|i want|i would like|i need|what is|what are|whats|me|some|a|an|good|great|easy|best|new|few|couple of|different|online|on the web|on the internet|recipes?|ideas?|options?|for|to make|how do i make|how to make|how do you make|i want to make|dinner ideas with|with|using|to cook|instructions|guide|please|the|it|dish|meal)\b/g, " ").replace(/\s+/g, " ").trim();
}
const SCALE = (q) => { const m = /\bfor (\d+)(?: people| servings?| persons?| of us)?\b/.exec(q); if (/\bdouble\b/.test(q)) return { factor: 2 }; if (/\btriple\b/.test(q)) return { factor: 3 }; if (/\b(half|halve)\b/.test(q)) return { factor: 0.5 }; if (m) return { people: Number(m[1]) }; return null; };

// the template language ------------------------------------------------------------------------------------------------
const I = (id, cat, label, ex, say, plan, extra = {}) => ({ id, cat, label, ex, say, plan, ...extra });
const any = "[please] ";

export const INTENTS = [
  // ======================================================================= time and date
  I("time.now", "time", "Tell you the time", "what time is it", [
    "what (time|hour) is it [right now|now]", "what is the time [now|right now]", "(tell me|give me) the time", "(do you have|have you got) the time", "time [please|check]", "current time",
    "what time (do we have|have we got|is it now)", "whats the time", "how late is it", "time [is it]", "clock", "what does the clock say", "is it (late|early) yet", "check the time",
  ], () => ({ do: "say.time" }), { instant: true }),
  I("date.today", "time", "Tell you today's date", "what's today's date", [
    "what (is|s) (the|today s|todays) date", "what (is|s) the date today", "(tell me|give me) (the|today s) date", "what day (is it|is today|of the month is it)", "what is today",
    "which day is it", "is today (monday|tuesday|wednesday|thursday|friday|saturday|sunday)", "what (month|year) is it", "what month are we in", "what year are we in", "date [please|today]", "what is the day today", "todays date",
  ], (c) => ({ do: "say.date", part: /\bmonth\b/.test(c.q) ? "month" : /\byear\b/.test(c.q) ? "year" : /\bday\b|\bis today\b/.test(c.q) && !/\bdate\b/.test(c.q) ? "weekday" : "date" }), { instant: true }),
  I("date.until", "time", "Count the days until a date", "how many days until christmas", [
    "how many (days|weeks|sleeps) (until|till|to|before) {date}", "how (long|far) (until|till|is it to|away is) {date}", "days (until|till|left until|left till) {date}", "countdown to {date}",
    "when is {date}", "how many days (are left )?(until|till|before) {date}", "is {date} (soon|close)", "how many days away is {date}",
  ], (c) => ({ do: "days.until", date: c.slots.date?.iso ?? null, name: c.slots.date?.holiday ?? c.slots.date?.text ?? null }), { instant: true, needs: ["date"] }),
  I("time.city", "time", "Tell you the time somewhere else", "what time is it in tokyo", [
    "what time is it in {text}", "(tell me )?the time in {text}", "time in {text}", "what is the time (in|over in) {text}", "what time do they have in {text}", "current time in {text}", "is it (night|morning|day) in {text}",
  ], (c) => ({ do: "time.city", city: cityIn(c.q) }), { instant: true, check: (c) => Boolean(cityIn(c.q)) }),
  I("date.holiday", "time", "Tell you when a holiday is", "when is thanksgiving", [
    "when is {date}", "what (day|date) is {date} [this year]", "is today a holiday", "is (it|today) a holiday", "what holiday is (it|today|coming up|next)", "(next|upcoming) holiday", "whats the next holiday",
  ], (c) => ({ do: "holiday.when", name: c.slots.date?.holiday ?? null, date: c.slots.date?.iso ?? null }), { instant: true }),

  // ======================================================================= schedule
  I("sched.next", "schedule", "Tell you what's next", "what's next", [
    "what is next [on (my|the) schedule|today]", "whats (up )?next", "what (comes|do i have) next", "what is my next (event|thing)", "(next|upcoming) (event|thing|item)", "what am i doing next", "what should i do next", "what is coming up [next]",
    "whats after this", "what do i have (after this|coming up)", "anything (coming up|next)", "what is on deck", "when is my next (event|thing)",
  ], () => ({ do: "sched.next" }), { instant: true }),
  I("sched.now", "schedule", "Tell you what's on right now", "what should I be doing right now", [
    "what (should|am) i (be )?doing (right )?now", "what is (on )?(right )?now", "what am i supposed to be doing", "what is happening (right )?now", "what is (my|the) current (event|thing|block)", "what time block (is it|am i in)",
    "what is on the schedule (right )?now", "where should i be", "what is going on now",
  ], () => ({ do: "sched.now" }), { instant: true }),
  I("sched.day", "schedule", "Read the schedule for a day", "what's on tomorrow", [
    "what is (on )?(my schedule|the schedule|my calendar|the plan|planned) [for] {date}", "what (do i have|is on|is planned|is happening|am i doing) {date}", "(read|tell me) (my|the) schedule [for] {date}", "{date} schedule", "what does {date} look like",
    "what is (on|happening) {date}", "am i (busy|free) {date}", "do i have anything {date}", "whats my schedule [today|for today]", "what is my day (look like|looking like)", "what do i have today", "read (my|the) schedule", "whats on (the calendar|my calendar)",
    "whats (going on|happening) today", "what is on the agenda", "anything on (the calendar|the schedule|my calendar) {date}", "how busy am i {date}",
  ], (c) => ({ do: "sched.day", date: c.slots.date?.iso ?? null }), { instant: true }),
  I("sched.week", "schedule", "Show this week's schedule", "show me my week", [
    "(show|open|pull up|bring up|display) (my|the|this) week", "what (does|is) my week (look like|looking like)", "(my|the) week (at a glance|ahead)", "(show|open) (the )?weekly (view|schedule|calendar)", "what is (on|happening) this week", "whats my week", "week view",
    "(show|open) (my|the) schedule for (this|the) week", "what do i have this week", "plans for (this|the) week",
  ], () => ({ do: "client", text: "show me my week" })),
  I("sched.month", "schedule", "Show the month", "show me the month", [
    "(show|open|pull up|display) (my|the|this) month", "month view", "(show|open) (the )?monthly (view|calendar|schedule)", "what does (my|this|the) month look like", "what is (on|happening) this month",
  ], () => ({ do: "client", text: "show me the month" })),
  I("sched.year", "schedule", "Show the year", "show me the year", ["(show|open|display) (my|the|this) year", "year view", "(show|open) the (yearly|annual) (view|calendar)"], () => ({ do: "client", text: "show me the year" })),
  I("sched.open", "schedule", "Open the calendar", "open my calendar", ["(open|show|pull up|bring up) (my|the) (schedule|calendar|planner)", "(go to|take me to) (my|the) (schedule|calendar)", "let me see (my|the) (schedule|calendar)"], () => ({ do: "client", text: "show me my schedule" })),
  I("sched.add", "schedule", "Add something to your schedule", "add dentist on friday at 3", [
    "add {text} (on|for) {date} at {time}", "add {text} at {time} [on] {date}", "add {text} at {time}", "add {text} {date} at {time}", "schedule {text} (for|on) {date} at {time}", "schedule {text} at {time} [{date}]",
    "put {text} on (my schedule|the calendar|my calendar) [for] {date} at {time}", "book {text} (for|on) {date} at {time}", "(pencil in|set up|plan) {text} [for] {date} at {time}", "i have (a|an) {text} {date} at {time}",
    "(add|create|make) (a|an) (event|appointment|meeting) [called] {text} [on] {date} at {time}", "new (event|appointment) {text} at {time}", "add (an|a) (event|appointment) [for] {date}", "(add|put) {text} (to|on) my (schedule|calendar)",
    "i need to (add|schedule) {text}", "can you (add|schedule) {text} [for] {date}", "remember i have {text} at {time}", "i have {text} {date} at {time}", "{text} {date} at {time} (add it|put it on the calendar)",
    "schedule (a|an) {text} for {date}", "add {text} (tomorrow|today|tonight) at {time}", "block (off|out) {text} at {time}", "i want to (add|schedule) {text} at {time}",
  ], (c) => {
    const d = c.slots.duration?.ms ? Math.round(c.slots.duration.ms / 60000) : null;
    return { do: "sched.add", title: eventTitle(c), date: c.slots.date?.iso ?? null, time: c.slots.time?.hm ?? null, minutes: d };
  }, { label: (c) => { const t = eventTitle(c); return `Add ${t ? `"${t}"` : "an event"}${c.slots.date ? " " + sayDate(c.slots.date.iso) : ""}${c.slots.time ? " at " + sayTime(c.slots.time.hm) : ""}`; } }),
  I("sched.move", "schedule", "Move something on your schedule", "move the dentist to 4", [
    "move {text} to {time}", "move {text} to {date} [at {time}]", "reschedule {text} (to|for) {date} [at {time}]", "reschedule {text} (to|for) {time}", "(change|push|shift|switch) {text} to {time}", "can we move {text} to {date}",
    "(move|put) {text} (on|to) {date}", "(move|shift) {text} (earlier|later) to {time}", "i need to move {text} to {time}", "(make|have) {text} (at|start at) {time} instead", "change the time of {text} to {time}", "reschedule {text}",
  ], (c) => ({ do: "sched.move", what: blockRef(c, [/\b(move|reschedule|change|push|shift|switch|can we|i need to|the time of|make|have|start|instead|put)\b/g]), date: c.slots.date?.iso ?? null, time: c.slots.time?.hm ?? null }),
  { label: (c) => { const w = blockRef(c, [/\b(move|reschedule|change|push|shift|switch|can we|i need to|the time of|make|have|start|instead|put)\b/g]); return `Move ${w ? `"${w}"` : "an event"}${c.slots.date ? " to " + sayDate(c.slots.date.iso) : ""}${c.slots.time ? (c.slots.date ? " at " : " to ") + sayTime(c.slots.time.hm) : ""}`; } }),
  I("sched.push", "schedule", "Push something later", "push dinner back 30 minutes", [
    "push {text} (back|later) [by] {dur}", "(delay|bump) {text} [by] {dur}", "move {text} (back|later) [by] {dur}", "push {text} (up|earlier|forward) [by] {dur}", "(make|have) {text} {dur} (later|earlier)", "{text} is running {dur} late", "i am running {dur} late (for|to) {text}", "running {dur} (late|behind)",
    "push everything (back|later) [by] {dur}", "delay everything [by] {dur}",
  ], (c) => ({ do: "sched.push", what: blockRef(c, [/\b(push|delay|bump|move|make|have|is running|running|i am|late|behind|back|later|earlier|forward|up|everything)\b/g]) || (/\beverything\b/.test(c.q) ? "everything" : ""), ms: (/\b(up|earlier|forward)\b/.test(c.q) ? -1 : 1) * (c.slots.duration?.ms ?? 0) }), { needs: ["duration"] }),
  I("sched.rename", "schedule", "Rename something on your schedule", "rename gym to workout", [
    "rename {text} to {text}", "change the (name|title) of {text} to {text}", "call {text} {text} instead", "(change|rename) {text} (to say|to read) {text}",
  ], (c) => { const m = /\b(?:rename|change the (?:name|title) of|call|change)\s+(.+?)\s+(?:to say|to read|to|instead)\s+(.+?)(?: instead)?$/.exec(c.q); return { do: "sched.rename", what: m?.[1]?.replace(/^(the|my) /, "") ?? "", to: m?.[2] ?? "" }; }),
  I("sched.delete", "schedule", "Remove something from your schedule", "cancel the dentist", [
    "(cancel|delete|remove|clear|drop) {text} [from (my|the) (schedule|calendar)]", "(take|get) {text} off (my|the) (schedule|calendar)", "i do not have {text} anymore", "{text} is (cancelled|canceled|off)", "(cancel|delete|remove) my {text} [appointment|event|meeting] [{date}]",
    "(cancel|delete|remove) (the|my) {text} on {date}", "(erase|scratch|nix) {text}", "{text} got (cancelled|canceled)", "(cancel|delete|remove) (the|that) (event|appointment|meeting)",
  ], (c) => ({ do: "sched.delete", what: blockRef(c, [/\b(cancel|cancelled|canceled|delete|remove|clear|drop|take|get|off|i do not have|anymore|is|got|erase|scratch|nix|appointment|meeting)\b/g]), date: c.slots.date?.iso ?? null }), { risky: true,
    label: (c) => { const w = blockRef(c, [/\b(cancel|cancelled|canceled|delete|remove|clear|drop|take|get|off|i do not have|anymore|is|got|erase|scratch|nix|appointment|meeting)\b/g]); return `Remove ${w ? `"${w}"` : "an event"} from your schedule`; } }),
  I("sched.resize", "schedule", "Make something longer or shorter", "make the meeting 30 minutes longer", [
    "make {text} {dur} (longer|shorter)", "(extend|lengthen) {text} [by] {dur}", "(shorten|cut) {text} [down] [by] {dur}", "add {dur} to {text}", "take {dur} off {text}", "make {text} (last|run) {dur}", "i need {dur} more (for|on) {text}",
    "cut {text} (down )?to {dur}", "(reduce|trim) {text} to {dur}", "give me {dur} more (for|of) {text}",
  ], (c) => {
    const to = /\b(to|last|run)\s+\{?\S*\s*$/.test(c.q) || /\b(down to|cut .* to|reduce .* to|trim .* to|last|run)\b/.test(c.q);
    return { do: "sched.resize", what: blockRef(c, [/\b(make|extend|lengthen|shorten|cut|down|reduce|trim|add|take|off|longer|shorter|last|run|i need|more|give me|of)\b/g]), ms: (/\b(shorter|shorten|cut|take|off|reduce|trim)\b/.test(c.q) && !to ? -1 : 1) * (c.slots.duration?.ms ?? 0), absolute: to };
  }, { needs: ["duration"] }),
  I("sched.free", "schedule", "Find free time", "when am I free tomorrow", [
    "when am i free [{date}]", "do i have (any )?free time [{date}]", "(find|show me) (some )?free time [{date}]", "what (time|times) (am i|are) free [{date}]", "am i free at {time} [{date}]", "is {time} (open|free) [{date}]", "where do i have (a gap|an opening|time) [{date}]",
    "when (is|do i have) (my )?(next )?(opening|gap|free slot)", "how much free time do i have [{date}]", "any openings [{date}]",
  ], (c) => ({ do: "sched.free", date: c.slots.date?.iso ?? null, time: c.slots.time?.hm ?? null }), { instant: true }),
  I("sched.conflicts", "schedule", "Check for conflicts", "do I have any conflicts this week", ["(do i have|are there|any) (any )?(conflicts|clashes|overlaps|double bookings) [{date}|this week]", "is anything (overlapping|double booked)", "(check|find|fix) (my )?(conflicts|clashes|overlaps)", "am i double booked [{date}]"],
    (c) => ({ do: "route", text: /\bfix\b/.test(c.q) ? "fix my conflicts" : "do i have any conflicts this week" })),
  I("sched.clear", "schedule", "Clear part of your day", "clear my evening", ["clear (my|the) (evening|afternoon|morning|night|day) [{date}]", "cancel everything (after|from) {time} [{date}]", "clear (everything|my schedule) (after|from) {time}", "wipe (my|the) (evening|afternoon|day)", "free up (my|the) (evening|afternoon|morning)"],
    (c) => ({ do: "sched.clear", date: c.slots.date?.iso ?? null, from: c.slots.time?.hm ?? (/\bevening|night\b/.test(c.q) ? "17:00" : /\bafternoon\b/.test(c.q) ? "12:00" : /\bmorning\b/.test(c.q) ? "05:00" : "00:00"), to: /\bmorning\b/.test(c.q) ? "12:00" : /\bafternoon\b/.test(c.q) ? "17:00" : "23:59" }), { risky: true }),
  I("sched.repeat", "schedule", "Make something repeat", "make gym repeat every weekday", ["make {text} (repeat|recurring|recur) [every] {text}", "(repeat|recur) {text} every {text}", "{text} should (repeat|happen) every {text}", "set {text} to repeat {text}", "make {text} (a daily|a weekly|an every day|a) thing"],
    (c) => { const m = /\b(?:make|set|repeat|recur)\s+(.+?)\s+(?:repeat|recurring|recur|to repeat|every|a daily|a weekly|daily|weekly)\b(.*)$/.exec(c.q); return { do: "sched.repeat", what: (m?.[1] ?? "").replace(/^(the|my) /, ""), rule: c.q }; }),
  I("sched.done", "schedule", "Check something off", "mark gym done", ["mark {text} (as )?(done|complete|finished)", "(i finished|i did|i completed|done with|finished) {text}", "check off {text}", "{text} is (done|finished|complete)", "cross off {text}"],
    (c) => ({ do: "route", text: `mark ${blockRef(c, [/\b(mark|as|done|complete|completed|finished|i finished|i did|i completed|done with|check off|cross off|is)\b/g])} done` })),
  I("sched.undo", "schedule", "Undo the last change", "undo that", ["undo [that|it|the last (change|thing)]", "put it back", "take that back", "never mind put it back", "revert (that|the last change)"], () => ({ do: "route", text: "undo" })),
  I("sched.rundown", "schedule", "Give you the day's rundown", "give me my rundown", ["(give me|read me|tell me) (my|the) (rundown|briefing|summary of the day|day)", "brief me", "morning (briefing|rundown)", "how does my day look", "what is my day like", "catch me up on (today|my day)", "daily briefing"],
    () => ({ do: "route", text: "what's my day look like" })),

  // ======================================================================= timers, stopwatch, alarms, reminders
  I("timer.start", "timers", "Set a timer", "set a timer for 10 minutes", [
    "set [a|an] [new] timer (for|of) {dur}", "(start|make|put on|give me|create) [a|an] timer (for|of) {dur}", "set [a|an] {dur} timer", "{dur} timer", "timer (for|of) {dur}", "(start|set) [a|an] timer",
    "set [a] timer", "(count|countdown) {dur}", "countdown (from|of) {dur}", "(time|timer) me for {dur}", "let me know (in|when) {dur} (is up|has passed|passes)", "tell me when {dur} (is up|has passed|passes)", "(alert|ping|beep at|buzz) me in {dur}",
    "set [a|the] {text} timer (for|to) {dur}", "(start|set) [a|an] timer (for|of) {dur} (for|called|named) {text}", "{dur} (on the clock|countdown)", "i need a timer [for {dur}]", "can i get a timer (for|of) {dur}",
    "remind me in {dur} to {text}", "remind me to {text} in {dur}", "(time|timer for) the {text} (for|to) {dur}", "(start|set) a {text} timer", "{dur} for (the|my) {text}", "put {dur} on the (clock|timer)",
    "wake me (up )?in {dur}", "nap timer [for {dur}]", "set an egg timer", "{dur} (and|on) a timer", "set (the )?(oven|kitchen|cooking) timer (for|to) {dur}",
  ], (c) => ({ do: "timer.start", ms: c.slots.duration?.ms ?? null, label: timerLabel(c) || (/\bnap\b/.test(c.q) ? "nap" : /\bwake me\b/.test(c.q) ? "wake up" : "") }), { instant: true,
    label: (c) => { const l = timerLabel(c); return c.slots.duration ? `Set a${l ? ` ${l}` : ""} timer for ${sayDuration(c.slots.duration.ms)}` : "Set a timer"; } }),
  I("timer.list", "timers", "List your timers", "what timers do I have", [
    "what timers (do i have|are (running|going|set|on))", "(list|show|read) (my|the|all) timers", "(any|how many) timers [running|going|set]", "do i have (a|any) timers? [running|going|set|on]", "(what is|whats) (on|running on) (my|the) timers",
    "check (my|the) timers", "timers status", "what timers are (running|left)", "show (me )?(all )?(the )?timers",
  ], () => ({ do: "timer.list" }), { instant: true }),
  I("timer.left", "timers", "Tell you how long is left on a timer", "how long is left on the pasta", [
    "how (much time|long) (is )?left on {text}", "how much (longer|time) (on|for) {text}", "how (much time|long) (is )?left", "(time|how long) (left|remaining) [on the timer]", "how much time do i have left", "how long (until|till|before) {text} (is done|is ready|finishes|timer goes off)",
    "check (the|my) {text} timer", "how much is left on (the|my) timer", "how is (the|my) {text} timer (doing|going)", "when (will|does) (the|my) {text} timer (go off|end|finish)", "how long until the timer (goes off|is done|ends)",
  ], (c) => ({ do: "timer.left", ref: timerRef(c) || c.q.replace(/\b(how|much|time|long|is|left|on|for|longer|remaining|the|my|until|till|before|is done|is ready|finishes|timer|timers|goes off|go off|end|ends|finish|check|doing|going|do i have|when|will|does)\b/g, " ").replace(/\s+/g, " ").trim() }), { instant: true }),
  I("timer.cancel", "timers", "Cancel a timer", "cancel the pasta timer", [
    "(cancel|stop|delete|remove|clear|end|kill|turn off) (the|my|that) [{text}] timer", "(cancel|stop|delete|clear|remove) (all|every|all of) (the |my )?timers", "(cancel|stop|end) (it|that) timer", "never mind (the|that) [{text}] timer",
    "i do not need the [{text}] timer (anymore|any more)", "get rid of (the|my) [{text}] timer", "(cancel|stop|delete) timer {num}", "(cancel|stop|delete) the (first|second|third|last) timer", "(cancel|stop|delete|remove) (the )?{text} timer",
  ], (c) => ({ do: "timer.cancel", ref: timerRef(c) }), { instant: true, label: (c) => { const r = timerRef(c); return r === "all" ? "Cancel all timers" : `Cancel the ${r ? r + " " : ""}timer`; } }),
  I("timer.pause", "timers", "Pause a timer", "pause the timer", ["pause (the|my|that|all|all the|all my) [{text}] (timer|timers)", "(hold|freeze) (the|my) [{text}] timer", "pause timer {num}", "put (the|my) [{text}] timer on hold", "stop the clock", "pause (it|the countdown)"],
    (c) => ({ do: "timer.pause", ref: timerRef(c) }), { instant: true }),
  I("timer.resume", "timers", "Resume a timer", "resume the timer", ["(resume|restart|unpause|continue|start) (the|my|that|all|all the|all my) [{text}] (timer|timers) [again|back up]", "(start|continue) the (countdown|clock) again", "unpause (it|the timer)", "keep (the )?timer going", "resume timer {num}"],
    (c) => ({ do: "timer.resume", ref: timerRef(c) }), { instant: true }),
  I("timer.add", "timers", "Add time to a timer", "add 2 minutes to the oven timer", [
    "add {dur} to (the|my|that) [{text}] timer", "(give|put) (the|my) [{text}] timer {dur} more", "{dur} more (on|for) (the|my) [{text}] timer", "(extend|increase) (the|my) [{text}] timer (by|with) {dur}", "add {dur} (more )?to (it|that|the timer)",
    "add {dur} (more )?(to|on) the {text}", "another {dur} on the [{text}] timer", "i need {dur} more on the timer",
  ], (c) => ({ do: "timer.add", ref: timerRef(c), ms: c.slots.duration?.ms ?? null }), { instant: true, needs: ["duration"] }),
  I("timer.rename", "timers", "Rename a timer", "rename the laundry timer to dryer", [
    "(rename|call|name|label) (the|my) [{text}] timer [to] {text}", "(rename|call) timer {num} [to] {text}", "(rename|call) the (first|second|third|last) timer [to] {text}", "change the [{text}] timer (name|label) to {text}", "the {text} timer is (actually|really) for {text}",
  ], (c) => {
    const m = /\b(?:rename|call|name|label|change)\s+(?:the |my )?(.+?)\s*timer(?: name| label)?\s+(?:to\s+)?(?:be\s+)?(.+)$/.exec(c.q) ?? /\bthe (.+?) timer is (?:actually|really) for (.+)$/.exec(c.q);
    const ref = m ? (/^(first|second|third|fourth|fifth|sixth|seventh|last)$/.test(m[1]) ? m[1] : m[1].replace(/^(number )?(\d)$/, "$2")) : timerRef(c);
    return { do: "timer.rename", ref: (ref ?? "").replace(/\s*number\s*/, "").trim(), to: (m?.[2] ?? "").replace(/^(the|a) /, "") };
  }, { instant: true }),
  I("timer.dismiss", "timers", "Stop the ringing timer", "stop the timer", ["(stop|dismiss|silence|shut off|turn off|mute) (the )?(ringing|beeping|alarm|timer sound|timer)", "(ok|okay|got it|thanks) (the )?timer", "i know the timer is done", "(stop|dismiss) it [please]", "timer (off|done)"],
    (c) => ({ do: "timer.dismiss", ref: timerRef(c) }), { instant: true }),
  I("stopwatch", "timers", "Use the stopwatch", "start the stopwatch", [
    "(start|begin|run) (a|the) stopwatch", "(stop|pause|end) the stopwatch", "(reset|clear) the stopwatch", "(how long|what is|check) (has it been on|the) stopwatch", "stopwatch (start|stop|reset|lap|time)", "(start|begin) timing (me|this)", "how long has it been (since i started|on the stopwatch)", "(lap|split) [time]",
    "stop timing [me]", "time how long (this|it) takes",
  ], (c) => ({ do: "stopwatch", action: /\b(reset|clear)\b/.test(c.q) ? "reset" : /\b(lap|split)\b/.test(c.q) ? "lap" : /\b(stop|pause|end)\b/.test(c.q) ? "stop" : /\b(how long|what|check|time\b(?! me)|has it been)\b/.test(c.q) && !/\b(start|begin|run|time how long)\b/.test(c.q) ? "read" : "start" }), { instant: true }),
  I("alarm.set", "timers", "Set an alarm", "set an alarm for 6:30 am", [
    "set (an|the|my) alarm (for|at) {time} [{date}]", "wake me (up )?at {time} [{date}]", "(alarm|alarm clock) (for|at) {time}", "(get|wake) me up at {time}", "set (an|my) alarm [for] {date} at {time}", "i need to (get|wake) up at {time}", "(make|create) an alarm (for|at) {time}", "set a {time} alarm",
    "(set|make) (an|a) alarm {date} (for|at) {time}", "can you wake me at {time}",
  ], (c) => ({ do: "alarm.set", time: c.slots.time?.hm ?? null, date: c.slots.date?.iso ?? null, label: (/\b(?:called|for|labeled|named) ([a-z ]+)$/.exec(c.q.replace(c.slots.time?.text ?? "", ""))?.[1] ?? "").trim() }), { instant: true, needs: ["time"],
    label: (c) => (c.slots.time ? `Set an alarm for ${sayTime(c.slots.time.hm)}` : "Set an alarm") }),
  I("alarm.list", "timers", "List your alarms", "what alarms do I have", ["what alarms (do i have|are set)", "(list|show|read) (my|the) alarms", "(any|do i have (any|an)) alarms [set]", "when is my (next )?alarm", "is my alarm set"], () => ({ do: "alarm.list" }), { instant: true }),
  I("alarm.cancel", "timers", "Cancel an alarm", "cancel my alarm", ["(cancel|delete|remove|turn off|disable) (my|the|all|all my) (alarm|alarms) [for {time}]", "(i do not|don t) need (the|an|my) alarm", "no alarm (tomorrow|tonight)", "(cancel|delete) the {time} alarm"],
    (c) => ({ do: "alarm.cancel", ref: /\ball\b/.test(c.q) ? "all" : c.slots.time?.hm ?? "" }), { risky: true, instant: true }),
  I("reminder.set", "timers", "Set a reminder", "remind me to call mom tomorrow at 5", [
    "remind me to {text} (at|on) {time} [{date}]", "remind me to {text} {date} [at {time}]", "remind me (at|on) {time} to {text}", "remind me {date} to {text}", "(set|create|make) a reminder (to|for|about) {text} [{date}] [at {time}]",
    "(do not|dont) let me forget to {text} [{date}] [at {time}]", "i need to (be reminded|remember) to {text} [{date}] [at {time}]", "remember (to|that i have to) {text} {date}", "reminder (to|for) {text} [{date}] [at {time}]", "can you remind me to {text}",
    "make sure i {text} {date}", "nudge me to {text} at {time}", "remind me about {text} {date}",
  ], (c) => {
    const what = c.q.replace(/^.*?\b(?:remind me|reminder|let me forget|be reminded|remember|make sure i|nudge me)\b\s*(?:to|about|that i have to|for|that)?\s*/, "").replace(c.slots.time?.text ?? "\u0000", " ").replace(c.slots.date?.text ?? "\u0000", " ").replace(/\b(at|on|to|by)\s*$/, "").replace(/\s+/g, " ").trim();
    return { do: "reminder.set", text: what, date: c.slots.date?.iso ?? null, time: c.slots.time?.hm ?? null };
  }, { label: (c) => "Set a reminder" + (c.slots.time ? ` for ${sayTime(c.slots.time.hm)}` : "") }),
  I("reminder.list", "timers", "List your reminders", "what are my reminders", ["(what are|list|read|show) (my|the) reminders", "(any|do i have (any)?) reminders [{date}]", "what (do i need to|should i) remember [{date}]", "what reminders (do i have|are set)"], () => ({ do: "route", text: "what are my reminders" })),
  I("reminder.cancel", "timers", "Cancel a reminder", "cancel the reminder about the trash", ["(cancel|delete|remove|clear) (the|my) reminder (about|for|to) {text}", "(cancel|delete) (that|the last) reminder", "i do not need the reminder (about|for) {text}", "never mind the reminder about {text}"],
    (c) => ({ do: "route", text: `cancel the reminder about ${after(c.q, /\breminder (?:about|for|to)\s*/) || c.q.replace(/^.*\breminder\b/, "").trim()}` }), { risky: true }),
  I("snooze", "timers", "Snooze", "snooze for 10 minutes", ["snooze [it|that|the alarm] [for {dur}]", "(hit|press) snooze", "remind me again in {dur}", "(give me|five) (5|a few) more minutes", "later [please]", "not now remind me (again )?(later|in {dur})"],
    (c) => ({ do: "route", text: c.slots.duration ? `snooze for ${Math.round(c.slots.duration.ms / 60000)} minutes` : "snooze" })),

  // ======================================================================= programs, files, web
  I("app.open", "programs", "Open a program", "open notepad", [
    "open {text}", "(launch|start|run|fire up|boot up|load) {text}", "(open|start) (the|my) {text} (app|program|application)", "can you open {text}", "(go ahead and )?open up {text}", "(open|launch) (word|excel|powerpoint|outlook|notepad|paint|calculator|chrome|edge|firefox|spotify|discord|steam|zoom|teams|file explorer|settings)",
    "i need {text} open", "bring up {text}", "pull up the {text} (app|program)", "switch to {text}",
  ], (c) => ({ do: "app.open", name: c.q.replace(/\b(open up|open|launch|start up|start|run|fire up|boot up|load|can you|go ahead and|the|my|app|program|application|i need|bring up|pull up|switch to|for me|please)\b/g, " ").replace(/\s+/g, " ").trim() }),
  { label: (c) => { const n = c.q.replace(/\b(open up|open|launch|start up|start|run|fire up|boot up|load|can you|go ahead and|the|my|app|program|application|i need|bring up|pull up|switch to)\b/g, " ").replace(/\s+/g, " ").trim(); return `Open ${n || "a program"}`; }, check: (c) => !/\b(timer|calendar|schedule|settings|help|guide|stopwatch|recipe|list|notes?|reminder)\b/.test(c.q) || APP_ALIASES.test(c.q) }),
  I("app.close", "programs", "Close a program", "close notepad", ["(close|quit|exit|shut down|kill|end) {text} [app|program|application]", "(close|quit) (the|my) {text} (app|program|window)", "can you close {text}", "shut {text} down", "i am done with {text} close it"],
    (c) => ({ do: "app.close", name: c.q.replace(/\b(close|quit|exit|shut down|shut|down|kill|end|the|my|app|program|application|window|can you|i am done with|close it|it)\b/g, " ").replace(/\s+/g, " ").trim() }), { risky: true, check: (c) => !/\b(timer|calendar|schedule|settings|help|guide|recipe|cooking|dayspring|yourself|screen)\b/.test(c.q) }),
  I("web.open", "programs", "Open a website", "open youtube", ["(open|go to|pull up|bring up|load|visit|take me to) {text}.(com|org|net|io|gov|edu)", "(open|go to|visit|take me to|pull up) (youtube|google|gmail|facebook|amazon|netflix|reddit|wikipedia|twitter|instagram|linkedin|google maps|google drive|espn|ebay|github|hulu|twitch|bible gateway)", "(open|go to) the website {text}", "(open|show) {text} in (my|the) browser", "go to {text} dot com"],
    (c) => { const s = siteFrom(c.q.replace(/ dot /g, ".")); return { do: "web.open", url: s?.url ?? null, name: s?.name ?? null }; }, { check: (c) => Boolean(siteFrom(c.q.replace(/ dot /g, "."))) }),
  I("web.search", "programs", "Search the web", "look up how tall mount everest is", ["(search|google|look up|search the web for|search online for|search for|find online|bing) {text}", "(look|search) {text} up [online]", "can you (google|look up|search) {text}", "what does the internet say about {text}", "(find|look up) information (on|about) {text}", "who (is|was) {text}", "what is (a|an|the) {text}"],
    (c) => ({ do: "web.search", query: c.q.replace(/\b(search the web for|search online for|search for|find online|search|google|look up|look|up|online|bing|can you|what does the internet say about|find information on|find information about|information on|information about)\b/g, " ").replace(/\s+/g, " ").trim() })),
  I("file.find", "programs", "Find a file", "find my resume", ["(find|search for|locate|where is) (my|the) {text} (file|document|doc|folder)", "(find|search for|locate) (a|my) (file|document) (called|named|about) {text}", "where did i (put|save) {text}", "(find|look for) {text} on (my|the) computer"],
    (c) => ({ do: "file.find", text: c.raw || c.q, query: c.q.replace(/\b(find|search for|locate|where is|where did i put|where did i save|look for|my|the|a|file|document|doc|folder|called|named|about|on my computer|on the computer|computer)\b/g, " ").replace(/\s+/g, " ").trim() })),
  I("file.open", "programs", "Open a file", "open my resume document", ["open (my|the) {text} (file|document|doc|pdf|spreadsheet|folder)", "(show|pull up) (my|the) {text} (document|file|folder)", "open the (file|document|folder) (called|named) {text}", "open my {text} folder", "open (my )?(documents|downloads|desktop|pictures|music|videos) (folder)?"],
    (c) => ({ do: "file.open", text: c.raw || c.q, query: c.q.replace(/\b(open|show|pull up|my|the|file|document|doc|pdf|spreadsheet|called|named)\b/g, " ").replace(/\s+/g, " ").trim() })),
  I("folder.create", "programs", "Make a new folder", "make a folder called taxes", ["(make|create|add) (a )?(new )?folder (called|named) {text}", "new folder [called|named] {text}", "(make|create) a {text} folder"],
    (c) => ({ do: "folder.create", name: (after(c.q, /\b(?:called|named)\s+/) || c.q.replace(/\b(make|create|add|a|new|folder|called|named)\b/g, " ")).replace(/\s+/g, " ").trim() }), { risky: true }),

  // ======================================================================= Bible
  I("bible.read", "bible", "Read a Bible passage", "read John 3:16", [
    "(read|read me|recite|quote|say) {ref} [in the {version}|{version}]", "{ref} [{version}]", "what does {ref} say [in the {version}]", "(look up|pull up|show me|open) {ref} [in the {version}]", "(read|give me) {ref} (from|in) the {version}",
    "can you read {ref}", "i want to hear {ref}", "{ref} in the {version}", "{ref} please", "(read|play) the {version} (version|translation) of {ref}", "(what is|how does) {ref} (go|read)", "turn to {ref}", "open (my )?bible to {ref}",
  ], (c) => ({ do: "bible.read", ref: c.slots.ref?.ref ?? null, version: c.slots.version?.id ?? null }), { needs: ["ref"], label: (c) => `Read ${c.slots.ref?.ref ?? "a Bible passage"}${c.slots.version ? ` (${c.slots.version.id.toUpperCase()})` : ""}` }),
  I("bible.votd", "bible", "Read the verse of the day", "verse of the day", ["[give me|read me|what is] (the|a|todays) (verse|scripture|bible verse) (of the day|for today)", "(daily|todays) (verse|scripture)", "(read|give) me a (bible )?verse", "(share|read) (an encouraging|a) (verse|scripture)", "i need a verse", "(any )?(scripture|verse) for today"],
    (c) => ({ do: "bible.votd", version: c.slots.version?.id ?? null })),
  I("bible.next", "bible", "Read the next verse", "read the next verse", ["(read|keep reading|read me) (the )?next (verse|chapter)", "(what is|whats) the next verse", "keep going [with the reading]", "continue (the )?reading", "next verse [please]", "and the next (one|verse)"], (c) => ({ do: "bible.next", chapter: /\bchapter\b/.test(c.q) })),
  I("bible.versions", "bible", "List the Bible versions I can read", "what bible versions do you have", ["(what|which) (bible )?(versions|translations) (do you have|can you read|are available)", "(list|show) (the )?(bible )?(versions|translations)", "can you read (the )?{version}", "do you have the {version}"], (c) => ({ do: "bible.versions", version: c.slots.version?.id ?? null })),
  I("bible.search", "bible", "Find verses about a topic", "find verses about peace", ["(find|search for|look up|give me) (a )?(verses?|scriptures?|passages?) (about|on|for) {text}", "what does the bible say about {text}", "(bible )?verses? (about|on|for) {text}", "is there a verse about {text}", "search the bible for {text}"],
    (c) => ({ do: "bible.search", topic: c.q.replace(/^.*\b(about|on|for)\b\s*/, "").trim() })),
  I("bible.setversion", "bible", "Change your Bible version", "use the ESV from now on", ["(use|switch to|change to|read from) the {version} [from now on|by default|instead]", "(make|set) (the )?{version} (my )?(default|usual) [bible|version]", "i (prefer|like) the {version}", "(change|switch) (my )?(bible )?version to {version}"],
    (c) => ({ do: "bible.setversion", version: c.slots.version?.id ?? null }), { needs: ["version"] }),

  // ======================================================================= weather
  I("weather", "weather", "Tell you the weather", "what's the weather", [
    "what is the weather [like] [{date}|right now|outside|today]", "(how is|hows) the weather [{date}|today|outside]", "weather [{date}|today|report|update]", "(what is|whats) the (forecast|temperature) [{date}|for the week|this week|today]", "is it (going to|gonna) (rain|snow|storm) [{date}]",
    "(do i|will i) need (an umbrella|a jacket|a coat|a sweater) [{date}]", "how (hot|cold|warm) is it [outside]", "(what is|whats) it like outside", "is it (cold|hot|windy|raining|sunny|nice) (out|outside)", "how windy is it", "what is the (high|low) [{date}]",
    "(chance|chances) of rain [{date}]", "(will|is) it be (nice|sunny|hot|cold) {date}", "weekly forecast", "(forecast|weather) for the (week|weekend)", "should i (bring|wear) (a jacket|a coat|an umbrella)", "whats the temp", "degrees outside", "temperature",
  ], (c) => ({ do: "weather", part: /\b(week|weekly|weekend)\b/.test(c.q) ? "week" : c.slots.date && c.slots.date.iso !== new Date().toISOString().slice(0, 10) && !/today|tonight/.test(c.slots.date.text) ? "day" : /\b(rain|umbrella|storm|snow)\b/.test(c.q) ? "rain" : /\b(jacket|coat|sweater|wear)\b/.test(c.q) ? "jacket" : /\bwind/.test(c.q) ? "wind" : "now", date: c.slots.date?.iso ?? null }), { instant: true }),

  // ======================================================================= media
  I("media.play", "media", "Play music or a video", "play some jazz", [
    "play [some] {text} [music|songs]", "play {text} on (spotify|youtube)", "put on [some] {text} [music]", "(i want to|let me) (hear|listen to) {text}", "(start|queue up|throw on) [some] {text}", "play (music|something|a song|some music|some tunes)", "play (my|the) {text} playlist",
    "(can you )?play (the song|the album) {text}", "(find|play) (a|some) {text} (video|videos) [on youtube]", "play me something (relaxing|upbeat|calm|happy|sad|fun)", "music please", "(some|a little) (background )?music",
  ], (c) => ({ do: "media.play", query: c.q.replace(/\b(play me|play|put on|i want to|let me|hear|listen to|start|queue up|throw on|can you|some|a little|the song|the album|please)\b/g, " ").replace(/\s+/g, " ").trim() }), { check: (c) => !/\b(timer|stopwatch|game|dice|coin)\b/.test(c.q) }),
  I("media.pause", "media", "Pause the music or video", "pause", ["pause [the] [music|song|video|it|that|playback]", "(hold|freeze) the (music|video)", "pause (spotify|youtube)", "(stop|pause) for a (sec|second|moment|minute)"], () => ({ do: "media.control", action: "pause" }), { instant: true }),
  I("media.resume", "media", "Resume playing", "resume the music", ["(resume|unpause|continue|keep playing) [the] [music|song|video|it]", "(start|play) (the music|it) again", "play again", "(un)?pause (the )?music", "go (on|ahead) playing"], () => ({ do: "media.control", action: "resume" }), { instant: true }),
  I("media.next", "media", "Skip to the next song", "next song", ["(next|skip) [song|track|one|video|this song|this one|it|this]", "(play|go to) the next (song|track|video|one)", "skip (ahead|this)", "i do not like this song", "(change|switch) the song"], () => ({ do: "media.control", action: "next" }), { instant: true }),
  I("media.prev", "media", "Go back a song", "previous song", ["(previous|last|go back) [song|track|video]", "(play|go to) the (previous|last) (song|track|video)", "go back (a|one) (song|track)", "play that (song|one) again", "replay (the|that) song"], () => ({ do: "media.control", action: "previous" }), { instant: true }),
  I("media.stop", "media", "Stop the music or video", "stop the music", ["stop (the )?(music|song|video|playback|playing|youtube|spotify)", "turn (off|the music off) (the )?(music|video)?", "(end|kill|close) the (music|video)", "enough music", "no more music", "stop playing"], () => ({ do: "media.control", action: "stop" }), { instant: true }),
  I("media.volume", "media", "Change the music volume", "turn the music up", ["(turn|crank) (the )?(music|song|video) (up|down)", "(louder|quieter|softer) (music|video)", "(music|video) volume (up|down|to {num}|{num})", "set (the )?(music|video) volume to {num}", "(raise|lower) the (music|video) volume", "(turn|put) the (music|video) (up|down) [a (bit|little|lot)]"],
    (c) => ({ do: "media.control", action: firstNum(c) != null ? "volume" : "volumeBy", value: firstNum(c) ?? (/\b(down|quieter|softer|lower)\b/.test(c.q) ? -15 : 15) }), { instant: true }),
  I("media.now", "media", "Tell you what's playing", "what song is this", ["(what|which) (song|track|video|music) is (this|playing|on)", "what is (playing|this song|on)", "who (sings|is singing) this", "(what is|whats) (the name of )?this song", "name (of )?this song", "who is this [artist|band]"], () => ({ do: "media.now" }), { instant: true }),

  // ======================================================================= Dayspring itself
  I("ds.stoplistening", "dayspring", "Stop listening", "stop listening", ["stop listening [to me|for now]", "(do not|dont) listen [to me] [for a while|right now]", "(turn off|mute) (the|your) (mic|microphone)", "quit listening", "(stop|no more) listening", "you can stop listening"], () => ({ do: "client", text: "stop listening" }), { instant: true }),
  I("ds.quiet", "dayspring", "Go quiet", "go quiet", ["(go|be) quiet [for a while|for now]", "(quiet|silent|do not disturb) mode", "(shush|hush|shh) [please]", "(stop|no) (talking|announcements) [for a while|for now]", "do not disturb", "(please )?be silent", "stop announcing (things|stuff)"], () => ({ do: "route", text: "go quiet" })),
  I("ds.off", "dayspring", "Turn Dayspring off", "turn yourself off", ["(turn|switch) (yourself|dayspring) off", "go to sleep", "(turn|switch) off [listening] [completely]", "(power|shut) (down|off) [dayspring]", "take a break", "(sleep|off) mode"], () => ({ do: "route", text: "turn off" })),
  I("ds.on", "dayspring", "Turn Dayspring back on", "wake up", ["(wake|turn|switch) (back )?(up|on)", "(turn|switch) (yourself|dayspring) (back )?on", "start listening [again]", "you can (talk|listen) again", "(back to|resume) (normal|active)", "(i am|im) back"], () => ({ do: "route", text: "turn back on" })),
  I("ds.compact", "dayspring", "Switch to the small window", "compact mode", ["(compact|mini|small) (mode|window|view)", "(make|go) (yourself|dayspring|it|the window) (small|smaller|compact|mini)", "(shrink|minimize) to (mini|compact|the small window)", "(switch|go) to (compact|mini)", "make dayspring small"], () => ({ do: "route", text: "compact mode" })),
  I("ds.fullscreen", "dayspring", "Go full screen", "go full screen", ["(go|switch to|make it) (full ?screen|full size|big)", "(maximize|expand) [yourself|dayspring|the window]", "(show|open) the full (app|view|screen)", "make (yourself|dayspring) (big|bigger|full screen)", "full screen [mode|please]"], () => ({ do: "route", text: "go full screen" })),
  I("ds.settings", "dayspring", "Open Settings", "open settings", ["(open|show|go to|pull up|bring up) (the )?(settings|preferences|options|setup)", "(change|adjust) (my|your|the) settings", "settings [page|menu]", "where are (the|your) settings"], () => ({ do: "client", text: "open settings" })),
  I("ds.help", "dayspring", "Open the guide", "open help", ["(open|show|pull up) (the )?(help|guide|manual|instructions|user guide)", "i need help", "help [me|please|page]", "how do i use (you|dayspring|this)", "show me the guide"], () => ({ do: "client", text: "open help" })),
  I("ds.helpwith", "dayspring", "Show how to do something in Dayspring", "how do I connect spotify", ["how (do|can) i {text}", "how to {text} [in dayspring]", "(show|teach) me how to {text}", "where (do|can) i {text}", "is there a way to {text}", "walk me through {text}"],
    (c) => ({ do: "help.topic", text: c.q })),
  I("ds.capabilities", "dayspring", "Tell you what I can do", "what can you do", ["what can you do [without ai]", "what (are|do) you (able to do|do)", "what (can|should) i (say|ask) [you]", "(list|show) (your|the) (commands|features|skills)", "what (commands|things) do you (know|understand)", "help me (use|with) you", "what are your (features|abilities)"], () => ({ do: "capabilities" }), { instant: true }),
  I("ds.voice", "dayspring", "Change the voice", "change your voice", ["(change|switch) (your|the) voice [to {text}]", "(use|try) a different voice", "(show|list|demo) (the |your )?voices", "sound (like|different)", "(talk|speak) (in|with) (a|the) {text} voice", "i want (a|the) (different|new|male|female) voice"],
    (c) => ({ do: "route", text: /\b(show|list|demo)\b/.test(c.q) ? "demo the voices" : /\bto (\w+)/.test(c.q) ? `switch your voice to ${/\bto (\w+)/.exec(c.q)[1]}` : "change your voice" })),
  I("ds.speed", "dayspring", "Talk faster or slower", "talk slower", ["(talk|speak|go) (faster|slower|more slowly|more quickly|quicker)", "slow (down|it down) [please]", "speed (up|it up)", "(you are|youre) (talking|going) too (fast|slow)", "(normal|regular) (speed|pace)"],
    (c) => ({ do: "route", text: /\b(normal|regular)\b/.test(c.q) ? "normal speed" : /\b(slow|slower|too fast|slowly)\b/.test(c.q) ? "speak slower" : "speak faster" })),
  I("ds.volume", "dayspring", "Talk louder or softer", "speak louder", ["(talk|speak) (louder|softer|quieter|up)", "(i|we) can not hear you", "(you are|youre) too (loud|quiet|soft)", "(turn|set) (your|the) (voice )?volume (up|down|to {num})", "(louder|softer|quieter) [please]", "volume (up|down|to {num}|{num})", "(increase|decrease|raise|lower) (the |your )?volume", "(mute|unmute) (yourself|your voice)"],
    (c) => ({ do: "route", text: firstNum(c) != null ? `set volume to ${firstNum(c)}` : /\b(softer|quieter|too loud|down|decrease|lower)\b/.test(c.q) ? "quieter" : "louder" })),
  I("ds.repeat", "dayspring", "Say that again", "repeat that", ["(repeat|say) (that|it) [again|one more time]", "(what|pardon|come again|pardon me)", "(what did you|can you) (say|repeat) (that|it)? [again]", "one more time", "i (missed|did not catch) that"], () => ({ do: "client", text: "repeat that" }), { instant: true }),
  I("ds.update", "dayspring", "Check for updates", "check for updates", ["(check for|any|are there any|look for) updates", "is there (an update|a new version)", "update (dayspring|yourself|the app) [now]", "(install|get) the (update|latest version)", "(are you|is dayspring) up to date", "what version (are you|is this)"],
    (c) => ({ do: "route", text: /\b(install|get the|update (dayspring|yourself|the app))\b/.test(c.q) ? "update dayspring" : "check for updates" })),
  I("ds.sky", "dayspring", "Change the sky and scenery", "make it rain", ["make it (rain|snow|sunny|night|stormy|cloudy|windy|foggy)", "(switch|change) (the )?(sky|scene|scenery|background) to {text}", "(use|show) the {text} (scene|sky|background)", "(cozy|calm|focus|night owl|sunset|sunrise|forest|ocean|field) mode", "back to the real weather", "(turn|switch) (on|off) the (sky|scenery|animations)"],
    (c) => ({ do: "route", text: c.q })),
  I("ds.textonly", "dayspring", "Switch to text only", "text only", ["text only [mode|please]", "(typing|type) only", "(i am|im) on a (call|phone call|meeting)", "(do not|dont) talk (out loud|i will type)", "silent chat"], () => ({ do: "client", text: "text only" })),
  I("ds.whoami", "chat", "Tell you about me", "who are you", ["who are you", "what is your name", "what are you", "(tell me|what) about yourself", "are you (a robot|ai|real|alive|human)", "who made you", "what should i call you"], () => ({ do: "chat", kind: "whoami" }), { instant: true }),
  I("ds.keepawake", "dayspring", "Keep the computer awake", "keep the laptop awake", ["keep (the|this|my) (laptop|computer|screen|pc) awake", "(do not|dont) let (the|my) (laptop|computer) (sleep|go to sleep)", "let (the|my) (laptop|computer) sleep", "stop keeping (the|my) (laptop|computer) awake"], (c) => ({ do: "route", text: /\blet .* sleep|stop keeping\b/.test(c.q) ? "let the computer sleep" : "keep the laptop awake" })),
  I("ds.window", "dayspring", "Move a window", "move the window to the left", ["(move|snap|drag|put) (the|this|that|my|a) (window|app|program) [to] [the] [left|right|top|bottom|other screen|other monitor|second screen|middle|center|corner]", "(snap|tile|arrange) (the )?windows", "(resize|shrink|enlarge) (the|this) window", "(move|put) {text} (window )?(to|on) the (left|right|other screen|other monitor)"],
    () => ({ do: "needs.ai", what: "move other windows around", offer: "You can drag it yourself, or say \"compact mode\" or \"full screen\" for Dayspring's own window." })),
  I("jokes.offers", "jokes", "Stop or start offering jokes", "stop asking me about jokes", ["(stop|quit) (asking|offering) (me )?(about |to tell )?(jokes|a joke)", "(do not|dont) (ask|offer) (me )?(about |to tell )?(jokes|a joke) [anymore]", "no more joke (offers|questions)", "(start|you can) (offering|asking about) jokes again", "offer (me )?jokes [again]"],
    (c) => ({ do: "jokes.offers", on: /\b(start|you can|again)\b/.test(c.q) && !/\b(stop|quit|dont|do not|no more)\b/.test(c.q) }), { instant: true }),

  // ======================================================================= everyday
  I("calc", "everyday", "Do the math", "what's 15% of 80", [
    "(what is|whats|calculate|compute|work out|figure out|solve) {num} (plus|minus|times|divided by|multiplied by|to the power of|x|over) {num}", "{num} (plus|minus|times|divided by|multiplied by|x|over) {num}", "(what is|whats) {pct} of {num}", "{pct} of {num}", "(what is|whats) the square root of {num}", "square root of {num}",
    "{num} squared", "{num} cubed", "how much is {num} (plus|minus|times|divided by) {num}", "(calculate|compute) {text}", "(what is|whats) a {pct} tip (on|for) {num}", "{num} is what percent of {num}", "add {num} and {num}", "subtract {num} from {num}", "multiply {num} (by|and) {num}", "divide {num} by {num}",
  ], (c) => ({ do: "calc", text: c.q.replace(/\badd (\d+(?:\.\d+)?) and (\d+(?:\.\d+)?)/, "$1 plus $2").replace(/\bsubtract (\d+(?:\.\d+)?) from (\d+(?:\.\d+)?)/, "$2 minus $1").replace(/\bmultiply (\d+(?:\.\d+)?) (?:by|and) (\d+(?:\.\d+)?)/, "$1 times $2").replace(/\bdivide (\d+(?:\.\d+)?) by (\d+(?:\.\d+)?)/, "$1 divided by $2") }), { instant: true }),
  I("convert", "everyday", "Convert units", "convert 5 miles to kilometers", [
    "(convert|change) {num} {text} (to|into|in) {text}", "how many {text} (are )?in (a|an|{num}) {text}", "{num} {text} (to|in|into) {text}", "(what is|whats) {num} {text} in {text}", "how many {text} (make|in) (a|one) {text}", "{num} degrees ({text}) (in|to) {text}",
    "(what is|whats) {num} {text} (in|to) {text}", "how much is {num} {text} in {text}",
  ], (c) => ({ do: "convert", text: c.q }), { instant: true, check: (c) => /\b(to|in|into)\b/.test(c.q) }),
  I("spell", "everyday", "Spell a word", "how do you spell necessary", ["how (do you|do i|to) spell {text}", "spell {text} [for me]", "(what is|whats) the spelling (of|for) {text}", "(can you )?spell out {text}", "how is {text} spelled"], (c) => ({ do: "spell", text: c.q }), { instant: true }),
  I("coin", "everyday", "Flip a coin", "flip a coin", ["flip a coin", "(toss|throw) a coin", "coin (flip|toss)", "heads or tails", "(call|pick) heads or tails"], () => ({ do: "coin" }), { instant: true }),
  I("dice", "everyday", "Roll dice", "roll a die", ["roll (a|the|some|two|{num}) (die|dice|d{num})", "roll {num}d{num}", "roll a {num} sided (die|dice)", "throw (the )?dice", "dice roll", "roll for (initiative|damage|me)"], (c) => ({ do: "dice", text: c.q }), { instant: true }),
  I("random", "everyday", "Pick a random number", "pick a number between 1 and 10", ["(pick|give me|choose|generate) a (random )?number (between|from) {num} (and|to) {num}", "random number [between {num} and {num}]", "(pick|choose) a number", "(say|give me) a random number"], (c) => ({ do: "random", text: c.q }), { instant: true }),
  I("joke", "jokes", "Tell a joke", "tell me a joke", [
    "tell me a joke", "(say|tell|know) (something funny|a joke|any jokes)", "make me laugh", "(i need|give me) a (laugh|joke)", "(another|one more|a different) (joke|one)", "do you know (any|a) (good )?jokes", "(got|have you got|do you have) (any )?jokes",
    "tell me a {text} joke", "(tell me|say|know) (a|any) (dad|corny|funny|silly|clean|cheesy|bad|good|kids|kid) jokes?", "tell me a joke (about|for) {text}", "(i want|give me) a {text} joke", "(tell me )?(a )?(knock knock|knock-knock) joke", "(what kind of|what) jokes do you know", "another one", "one more [joke]", "(a )?different kind [of joke]",
    "(food|animal|space|math|number|science|politics|politician|celebrity|school|holiday|sports|music|country|international|pun|computer|weather) jokes?", "cheer me up", "say something funny",
  ], (c) => {
    const knock = /\bknock\b/.test(c.q);
    const cat = /\bwhat kind\b|\bwhat jokes\b/.test(c.q) ? null : (/\b(?:a|an|some|another)\s+([a-z]+(?: [a-z]+)?)\s+jokes?\b/.exec(c.q)?.[1] ?? /\bjokes? (?:about|for) ([a-z ]+)$/.exec(c.q)?.[1] ?? /^([a-z]+) jokes?$/.exec(c.q)?.[1] ?? null);
    return { do: "joke", kind: /\bwhat kind\b|\bwhat jokes\b/.test(c.q) ? "list" : "tell", type: knock ? "knock" : null, category: cat && !/^(good|funny|any|another|a|one|different)$/.test(cat) && !/knock/.test(cat) ? cat.replace(/^(a|an) /, "") : null, again: /\b(another|one more|different)\b/.test(c.q) };
  }, { instant: true }),
  I("knock.start", "jokes", "Tell me a knock-knock joke", "knock knock", ["knock knock", "knock knock dayspring", "(i have|i got|ive got|let me tell you) a (knock knock )?joke (for you)?"], (c) => ({ do: "knock.theirs", intro: !/^knock knock/.test(c.q) }), { instant: true }),
  I("count", "everyday", "Count out loud", "count to 10", [
    "count (to|up to) {num}", "(can you|could you) count (to|up to) {num}", "count from {num} to {num}", "count (backwards|backward|down) from {num} [to {num}]", "count down from {num}", "count by {num}s? (to|up to) {num}", "count by (twos|threes|fours|fives|tens|twenties|twentyfives)", "count by (twos|threes|fives|tens) (to|up to) {num}",
    "count (for me|out loud|aloud)", "(let us|lets) count (to|up to) {num}", "count (to|up to) (one hundred|a hundred)", "countdown from {num}", "(help me|teach me to) count to {num}", "count (the )?(numbers )?(from|between) {num} (and|to) {num}", "count",
  ], (c) => {
    const nums = c.slots.numbers ?? [];
    const q = c.q.replace(/\ba hundred\b/, "100");
    const stepWord = { twos: 2, threes: 3, fours: 4, fives: 5, tens: 10, twenties: 20, twentyfives: 25 }[/\bby (twos|threes|fours|fives|tens|twenties|twentyfives)\b/.exec(q)?.[1]];
    const byNum = /\bby (\d+)s?\b/.exec(q)?.[1];
    const step = stepWord ?? (byNum ? Number(byNum) : 1);
    const down = /\b(backwards?|down|countdown)\b/.test(q);
    const fromM = /\bfrom (\d+)/.exec(q), toM = /\b(?:to|up to|and) (\d+)/.exec(q);
    let from = fromM ? Number(fromM[1]) : down ? (nums.find((n) => n !== Number(byNum)) ?? 10) : step > 1 ? step : 1;
    let to = toM ? Number(toM[1]) : down ? 1 : step > 1 ? step * 10 : (nums.filter((n) => n !== Number(byNum)).at(-1) ?? 10);
    if (down && !toM) to = step > 1 ? 0 : 1;
    if (down && fromM == null && nums.length) from = nums.filter((n) => n !== Number(byNum))[0] ?? from;
    return { do: "count", from, to, step, down };
  }, { instant: true, label: (c) => { const n = c.slots.numbers?.at(-1); return n ? `Count to ${n}` : "Count out loud"; } }),
  I("fact", "chat", "Share a fun fact", "tell me a fun fact", ["tell me a (fun|random|cool|interesting) fact", "(fun|random) fact", "(teach|tell) me something (new|interesting|cool)", "did you know", "give me some trivia"], () => ({ do: "fact" }), { instant: true }),
  I("greet.morning", "chat", "Say good morning", "good morning", ["good morning [dayspring]", "morning", "top of the morning", "rise and shine"], () => ({ do: "chat", kind: "morning" }), { instant: true }),
  I("greet.night", "chat", "Say good night", "good night", ["good night [dayspring]", "(night|nighty) night", "i am going to bed", "(bed|sleep) time", "going to sleep now"], () => ({ do: "chat", kind: "night" }), { instant: true }),
  I("greet.hello", "chat", "Say hello", "hello", ["hello [dayspring|there]", "hi [there]", "hey [there]", "howdy", "yo", "hiya", "greetings"], () => ({ do: "chat", kind: "hello" }), { instant: true }),
  I("greet.thanks", "chat", "Say you're welcome", "thank you", ["thank you [so much|very much]", "thanks [a lot|so much]", "(much )?appreciated", "perfect thanks", "thanks for (that|the help|helping)", "cheers"], () => ({ do: "chat", kind: "thanks" }), { instant: true }),
  I("greet.how", "chat", "Tell you how I'm doing", "how are you", ["how are you [doing|today]", "how (is|s) it going", "how are things", "how (do you feel|are you feeling)", "you doing (ok|okay|alright)"], () => ({ do: "chat", kind: "how" }), { instant: true }),

  // ======================================================================= lists and notes
  I("list.add", "lists", "Add to a list", "add milk to my shopping list", [
    "add {text} to (my|the) [shopping|grocery|{text}] list", "put {text} on (my|the) [shopping|grocery|{text}] list", "(we need|we are out of|i need to buy|pick up) {text}", "add {text} to (my )?(groceries|the grocery list|shopping)", "{text} on the (shopping|grocery) list",
    "(remember to buy|dont forget) {text}", "(add|write) {text} (to|on) the list", "(my )?shopping list add {text}",
  ], (c) => ({ do: "list.add", list: listFrom(c.q), item: listItem(c.q, [/\b(add|put|we need|we are out of|i need to buy|pick up|remember to buy|dont forget|write|shopping list add|my shopping list add)\b/g]) }), { instant: true, label: (c) => `Add ${listItem(c.q, [/\b(add|put|we need|we are out of|i need to buy|pick up|remember to buy|write)\b/g]) || "something"} to the ${listFrom(c.q)} list` }),
  I("list.read", "lists", "Read a list", "what's on my shopping list", ["(what is|whats) on (my|the) [shopping|grocery|{text}] list", "(read|show|tell me) (me )?(my|the) [shopping|grocery|{text}] list", "(shopping|grocery) list", "what do (i|we) need (from|at) the store", "what (is|s) on the list"],
    (c) => ({ do: "list.read", list: listFrom(c.q) }), { instant: true }),
  I("list.remove", "lists", "Take something off a list", "take milk off the shopping list", ["(remove|take|cross|delete) {text} (off|from) (my|the) [shopping|grocery|{text}] list", "(i|we) (got|bought|have) {text} [already]", "(cross|check) off {text}", "{text} is (done|bought|gotten)"],
    (c) => ({ do: "list.remove", list: listFrom(c.q), item: listItem(c.q, [/\b(remove|take|cross|delete|check|i got|we got|i bought|we bought|i have|we have|already|is done|is bought|is gotten|off)\b/g]) }), { instant: true }),
  I("list.clear", "lists", "Clear a list", "clear my shopping list", ["(clear|empty|erase|reset|delete) (my|the) [shopping|grocery|{text}] list", "start a new (shopping|grocery) list", "(i|we) got everything on the list"], (c) => ({ do: "list.clear", list: listFrom(c.q) }), { risky: true }),
  I("note.add", "lists", "Take a note", "take a note: call the plumber", ["(take|make|write|jot down|write down) a note [that|to] {text}", "note (that|to self) {text}", "(write|jot) (this|that) down {text}", "remember that {text}", "(add|save) a note [that|saying] {text}", "note to self {text}"],
    (c) => ({ do: "note.add", text: c.q.replace(/^.*?\b(note to self|a note that|a note to|a note saying|a note|note that|this down|that down|down|remember that)\b\s*/, "").trim() }), { instant: true }),
  I("note.read", "lists", "Read your notes", "read my notes", ["(read|show|tell me) (me )?(my|the) notes", "what (are|were) my notes", "what did i (note|write down|ask you to remember)", "(any|do i have (any)?) notes", "last note"], () => ({ do: "note.read" }), { instant: true }),
  I("note.delete", "lists", "Delete a note", "delete the last note", ["(delete|remove|erase) (the|my) (last )?note [about {text}]", "(scratch|forget) that note"], (c) => ({ do: "note.delete", ref: after(c.q, /\babout\s+/) || "last" }), { risky: true }),
  I("todo.add", "lists", "Add a to-do", "add clean the garage to my to do list", ["add {text} to (my|the) (to do|todo|task) list", "(new|add a) (task|to do) {text}", "put {text} on my (to do|todo) list", "i (need|have) to {text} (at some point|sometime|this week|eventually)", "to do {text}"],
    (c) => ({ do: "todo.add", title: c.q.replace(/\b(add|put|new task|add a task|new to do|add a to do|to my to do list|to the to do list|on my to do list|on my todo list|to my todo list|to my task list|to do|todo|i need to|i have to|at some point|sometime|this week|eventually)\b/g, " ").replace(/\s+/g, " ").trim() }), { instant: true }),
  I("todo.read", "lists", "Read your to-do list", "what's on my to do list", ["(what is|whats) on (my|the) (to do|todo|task) list", "(read|show) (me )?my (to do|todo|task) list", "what (tasks|to dos) do i have", "(my )?(to do|todo) list", "what do i (need|have) to do"], () => ({ do: "todo.read" }), { instant: true }),

  // ======================================================================= phone and faith and other features
  I("texts.read", "phone", "Read your texts", "read my texts", ["(read|check) (my|the) (texts|text messages|messages)", "(any|do i have (any)?) (new )?(texts|messages)", "who (texted|messaged) me", "(read|what did) (it|the text|that message) say", "what did {text} (text|say)"], (c) => ({ do: "route", text: /\bwho\b/.test(c.q) ? "who texted me" : "read my texts" })),
  I("prayer.read", "faith", "Read your prayer list", "read my prayer list", ["(read|show) (me )?(my|the) [morning|evening] prayer list", "who (am i|are we|should i be) praying for", "(what is|whats) on (my|the) prayer list", "prayer list"], (c) => ({ do: "route", text: /\bevening\b/.test(c.q) ? "read my evening prayer list" : /\bmorning\b/.test(c.q) ? "read my morning prayer list" : "read my prayer list" })),
  I("prayer.add", "faith", "Add to your prayer list", "add my aunt to my prayer list", ["add {text} to (my|the) prayer list", "(please )?pray for {text}", "put {text} on (my|the) prayer list", "(i|we) need to pray for {text}"], (c) => ({ do: "route", text: `add ${c.q.replace(/\b(add|put|pray for|please|i need to|we need to|to my prayer list|to the prayer list|on my prayer list|on the prayer list)\b/g, " ").replace(/\s+/g, " ").trim()} to my prayer list` })),
  I("study.next", "study", "Tell you your next lesson", "what's my next lesson", ["(what is|whats) my next (lesson|study item|assignment)", "(open|start) my next (lesson|study session)", "how far (am i|along am i) in {text}", "(my )?study progress", "what should i study (next|today)", "(open|start) {text} (course|lesson|class)"],
    (c) => ({ do: "route", text: /\bopen|start\b/.test(c.q) ? "open my next lesson" : /\b(how far|progress|how is my|how am i)\b/.test(c.q) ? c.q : "what's my next lesson" })),
  I("discover", "discover", "Show something new about your interests", "show me something new", ["show me something (new|cool|interesting) [about {text}]", "what did you find (for me )?[today]", "(find|show) me (something|a video|an article) about {text}", "anything new (about|on) {text}", "surprise me"], (c) => ({ do: "route", text: /\babout|on\b/.test(c.q) ? c.q : "what did you find for me today" })),
  I("doc.read", "documents", "Read a document aloud", "read my lease to me", ["(read|read me) (my|the) {text} (document|doc|file|pdf|letter|lease|resume|report) [to me|out loud|aloud]", "read {text} (to me|out loud|aloud)", "(open|pull up) (my|the) {text} (document|doc|file) and read it"], (c) => ({ do: "route", text: c.q })),
  I("doc.summarize", "documents", "Summarize a document", "summarize my lease", ["(summarize|sum up|give me a summary of|what is in) (my|the) {text} (document|doc|file|pdf|letter|lease|report)?", "(tldr|summary) of {text}"], (c) => ({ do: "needs.ai", what: "summarize a document", offer: "I can read it aloud instead. Say \"read my …\" with its name." })),
  I("photos", "photos", "Show a photo", "show me a photo", ["show (me )?(a|another|some|my) (photo|photos|picture|pictures)", "(next|another) (photo|picture)", "photo slideshow", "(show|pull up) (photos|pictures) (of|from) {text}"], (c) => ({ do: "route", text: /another|next/.test(c.q) ? "show me another" : "show me a photo" })),

  // ======================================================================= recipes and cooking
  I("recipe.find", "recipes", "Find recipes online", "find me a recipe for chicken enchiladas", [
    "(find|search for|look up|look for|get|show) (me )?(a|some|a few|good|easy)? ?(recipe|recipes) (for|on) {text}", "(what is|whats) a good recipe for {text}", "how (do i|do you|to) make {text}", "i want to make {text} (find|look up|show me) (a )?recipes?", "{text} recipes?",
    "(find|show) me (some )?{text} recipes", "recipe ideas (for|with) {text}", "(dinner|lunch|breakfast) ideas with {text}", "what can i make with {text}", "(search|look) online for {text} recipes?", "(get|pull up) (me )?(a )?recipe for {text}", "how do you (cook|bake) {text}", "teach me to (make|cook|bake) {text}", "i (want|would like) to (cook|bake) {text}",
  ], (c) => ({ do: "recipe.find", dish: dishFrom(c.q) }), { label: (c) => `Find recipes for ${dishFrom(c.q) || "a dish"}`, check: (c) => !/\b(my|saved) recipes?\b/.test(c.q) }),
  I("recipe.more", "recipes", "Show more recipe options", "more options", ["(more|other|different) (options|recipes|choices|ones)", "show me (more|others|other ones|different ones)", "(any|got any) (other|more) (recipes|options)", "next (batch|page) (of recipes)?", "none of those (show|find) (me )?(more|others)"], () => ({ do: "recipe.more" })),
  I("recipe.pick", "recipes", "Choose one of the recipes", "use the second one", [
    "(use|pick|choose|go with|let us do|lets do|i will take|ill take|select) (the )?(first|second|third|fourth|fifth|sixth|last|quickest|fastest|best|top rated|highest rated) (one|recipe)?", "(use|pick|choose) (number|recipe|option) {num}", "(the )?(first|second|third|fourth|fifth|sixth|last|quickest) one", "number {num}", "(the one|recipe) from {text}", "(view|show|open) (the )?(first|second|third|fourth|fifth|sixth|last) (one|recipe)",
    "(save|keep|bookmark) (the )?(first|second|third|fourth|fifth|sixth|last|quickest) (one|recipe) (for later)?", "save (number|recipe) {num} [for later]",
  ], (c) => ({ do: "recipe.pick", ref: (/\b(first|second|third|fourth|fifth|sixth|last|quickest|fastest|best|top rated|highest rated)\b/.exec(c.q)?.[1]) ?? (firstNum(c) != null ? String(firstNum(c)) : after(c.q, /\bfrom\s+/)), then: /\b(save|keep|bookmark)\b/.test(c.q) ? "save" : /\b(view|show|open)\b/.test(c.q) ? "view" : "cook" })),
  I("recipe.cook", "recipes", "Start cooking a saved recipe", "let's make the chili", [
    "(let us|lets|i want to|time to|help me) (make|cook|bake) (the|my|some)? {text}", "(start|begin) (cooking|making|baking) {text}", "(start|open) cooking mode (for {text})?", "(walk|guide|talk) me through (the|my)? {text} (recipe)?", "(cook|make|bake) {text} (with me|now)", "(start|open) (the|my) {text} recipe",
    "we are making {text} [tonight|now]", "{text} time lets cook", "lets cook {text}", "cooking mode",
  ], (c) => ({ do: "recipe.cook", name: recipeName(c.q), scale: SCALE(c.q) }), { label: (c) => `Make ${recipeName(c.q) || "a saved recipe"}` }),
  I("recipe.list", "recipes", "List your saved recipes", "what recipes do I have", ["(what|which) recipes (do i have|have i saved|are saved)", "(show|list|read|open) (me )?(my|the) (saved )?recipes", "(my )?recipe (book|box|collection|list)", "(open|show) (the )?recipes page", "search my recipes for {text}", "do i have a recipe for {text}"],
    (c) => ({ do: "recipe.list", query: after(c.q, /\b(?:recipes for|recipe for)\s+/) })),
  I("recipe.new", "recipes", "Save a new recipe by voice", "new recipe called grandma's cookies", ["(new|add a|save a|create a|make a) recipe [called|named|for] {text}", "(i want to )?(add|save|write down|dictate) a (new )?recipe", "(record|dictate) (my|a) recipe", "start a new recipe"],
    (c) => ({ do: "recipe.new", title: after(c.q, /\b(?:called|named|for)\s+/) })),
  I("recipe.import", "recipes", "Save a recipe from a web page", "save the recipe from allrecipes.com/...", ["(save|import|add|grab) (the )?recipe from {text}", "(import|save) this recipe {text}"], (c) => ({ do: "recipe.import", url: /\bhttps?:\/\/\S+|\b[a-z0-9-]+\.[a-z]{2,}\/\S+/.exec(c.raw ?? c.q)?.[0] ?? null })),
  I("recipe.delete", "recipes", "Delete a saved recipe", "delete the pancake recipe", ["(delete|remove|get rid of|throw out) (the|my) {text} recipe", "(delete|remove) (the )?recipe (for|called) {text}"], (c) => ({ do: "recipe.delete", name: c.q.replace(/\b(delete|remove|get rid of|throw out|the|my|recipe|for|called)\b/g, " ").replace(/\s+/g, " ").trim() }), { risky: true }),
  I("cook.next", "cooking", "Go to the next step", "next step", ["next step", "(what is|whats) (the )?next (step|thing)", "(go|move) (on|to the next step)", "(ok|okay|done|alright) (what|whats) next", "i (am|m) (done|ready) (with that|for the next step)", "(and )?then what", "continue", "(keep going|go on)"], () => ({ do: "cook.next" })),
  I("cook.prev", "cooking", "Go back a step", "previous step", ["(previous|last) step", "go back (a|one) step", "(back|go back) (a step|one)", "what was the (last|previous) step"], () => ({ do: "cook.prev" })),
  I("cook.repeat", "cooking", "Repeat this step", "repeat the step", ["(repeat|read) (the|this) step [again]", "what (was|is) (that|this) step [again]", "say (the|that) step again", "(read|repeat) that again"], () => ({ do: "cook.repeat" })),
  I("cook.where", "cooking", "Tell you which step you're on", "what step am I on", ["what step (am i|are we) on", "where (am i|are we) (in the recipe|up to)", "how many steps (are )?left", "which step is this"], () => ({ do: "cook.where" })),
  I("cook.ingredients", "cooking", "Read the ingredients", "read the ingredients", ["(read|list|tell me|what are) the ingredients", "what (do i|do we) need [for this|for the recipe]", "ingredients (list|please)", "(what goes|what is) in (it|this|the recipe)"], () => ({ do: "cook.ingredients" })),
  I("cook.howmuch", "cooking", "Tell you how much of an ingredient", "how much flour do I need", ["how (much|many) {text} (do i need|does it (take|need|call for)|goes in|should i (use|add))", "how (much|many) {text}", "(what is|whats) the amount of {text}", "how (much|many) {text} (in|for) (this|the recipe)"],
    (c) => ({ do: "cook.howmuch", what: c.q.replace(/\b(how much|how many|do i need|does it take|does it need|does it call for|goes in|should i use|should i add|what is the amount of|whats the amount of|in this|for this|in the recipe|for the recipe|the recipe)\b/g, " ").replace(/\s+/g, " ").trim() })),
  I("cook.scale", "cooking", "Scale the recipe", "double the recipe", ["(double|triple|halve|half) (it|the recipe|this)", "(make|scale) (it|the recipe|this) for {num} (people|servings|persons)", "(scale|adjust) (it|the recipe) (to|for) {num}", "(i am|we are) cooking for {num}", "for {num} people"],
    (c) => ({ do: "cook.scale", ...(SCALE(c.q) ?? {}) })),
  I("cook.stop", "cooking", "Stop cooking mode", "stop cooking", ["(stop|end|exit|quit|close|done with|finish) (cooking|the recipe|cooking mode)", "(we are|im|i am) (done|finished) cooking", "that is (it|all) for (the|this) recipe", "all done cooking"], () => ({ do: "cook.stop" })),
  I("cook.goto", "cooking", "Jump to a step", "go to step 4", ["(go to|jump to|skip to|show|read) step {num}", "step (number )?{num}", "(back|go back) to step {num}"], (c) => ({ do: "cook.goto", n: firstNum(c) })),
  I("cook.timer", "cooking", "Start this step's timer", "start the timer for this step", ["(start|set) (the|a) timer for (this|the) step", "(start|set) (that|the|this) (steps )?timer", "time (this|the) step", "yes (start|set) (the|a|that) timer"], () => ({ do: "cook.timer" })),
  ...MORE,
  // the personality's own commands (lib/persona answers them)
  ...PERSONA_INTENTS.map(([id, label, ex, say]) => I(id, "personality", label, ex, say, (c) => ({ do: "persona", text: c.raw || c.q }), { instant: true })),
  ...IMAGE_INTENTS.map(([id, label, ex, say, boost]) => I(id, "images", label, ex, say, (c) => ({ do: "images", id, text: c.raw || c.q }), boost ? { boost } : {})),
  // GIFs from GIPHY, KLIPY, Imgur and the web (lib/gifs)
  ...GIF_INTENTS.map(([id, label, ex, say, boost]) => I(id, "gifs", label, ex, say, (c) => ({ do: "gifs", id, text: c.raw || c.q }), boost ? { boost } : {})),
  // his own music and videos, and Google Drive (lib/medialib)
  ...MEDIALIB_INTENTS.map(([id, label, ex, say, boost]) => I(id, "media", label, ex, say, (c) => ({ do: "medialib", id, text: c.raw || c.q }), boost ? { boost } : {})),
  // videos on YouTube: finding, browsing, the queue, his YouTube playlists (lib/video)
  ...VIDEO_INTENTS.map(([id, label, ex, say, boost]) => I(id, "media", label, ex, say, (c) => ({ do: "video", id, text: c.raw || c.q }), boost ? { boost } : {})),
  // the Music & Video browser: his Spotify and YouTube libraries and history (lib/mediabrowser)
  ...MEDIABROWSER_INTENTS.map(([id, label, ex, say, boost]) => I(id, "media", label, ex, say, (c) => ({ do: "mediabrowser", id, text: c.raw || c.q }), boost ? { boost } : {})),
  // email, every mailbox (lib/mail/skills.mjs)
  ...MAIL_INTENTS.map(([id, label, ex, say, boost]) => I(id, "mail", label, ex, say, (c) => ({ do: "mail", id, text: c.raw || c.q }), boost ? { boost } : {})),
  // smart devices and 3D printers (lib/devices, lib/printers)
  ...DEVICE_INTENTS.map(([id, label, ex, say, boost]) => I(id, id.startsWith("printers") ? "printers" : "devices", label, ex, say, (c) => ({ do: "devices", id, text: c.raw || c.q }), boost ? { boost } : {})),
  // cameras (lib/cameras/skills.mjs)
  ...CAMERA_INTENTS.map(([id, label, ex, say, boost]) => I(id, "cameras", label, ex, say, (c) => ({ do: "cameras", id, text: c.raw || c.q }), boost ? { boost } : {})),
  // shopping on Amazon (lib/shopping): searching, orders, buying again (with a yes), Subscribe & Save, the account
  ...SHOPPING_INTENTS.map(([id, label, ex, say, boost]) => I(id, "shopping", label, ex, say, (c) => ({ do: "shopping", id, text: c.raw || c.q }), boost ? { boost } : {})),
];

// ---- tuning: more ways to say things, catch-alls that give way, and words that point one way -------------------------
const kw = (re, x = 1.12) => (c) => (re.test(c.q) ? x : 1);
const MORE_SAY = {
  "media.volume": ["turn (it|this|that|the music|the song|the video) (up|down) [a (bit|little|lot|notch)]", "crank it up", "(pump|turn) up the (music|volume)", "(way )?too (loud|quiet) (music)?", "(set|change) the volume to {num} [percent]", "volume to {num}"],
  "sched.week": ["what is on {date}", "what do i have {date}", "how busy is my week", "read me the week", "(show|tell) me (my|the) week", "what does next week look like", "the week ahead"],
  "sched.month": ["what do i have in (january|february|march|april|may|june|july|august|september|october|november|december)", "what is (on|happening) in (january|february|march|april|may|june|july|august|september|october|november|december)", "(show|open) (january|february|march|april|may|june|july|august|september|october|november|december)"],
  "sched.conflicts": ["do any of my (events|things|appointments) (clash|overlap|conflict)", "(am i|are there) double booked", "(any|do i have) (clashes|overlaps)", "is anything overlapping"],
  "sched.clear": ["(clear|wipe|empty) my (schedule|calendar|day) [for] {date}", "(clear|cancel) the rest of (my|the) day", "(cancel|clear|delete) everything {date}", "(clear|free up) my (morning|afternoon|evening) [{date}]"],
  "sched.free": ["am i (busy|free) at {time}", "do i have time (for|to) {text} {date}", "is {date} (afternoon|morning|evening)? (open|free)", "when (can|could) i fit in {text}", "do i have (a )?free (slot|moment|block) {date}"],
  "sched.resize": ["make (the )?{text} {dur} long", "make {text} {dur}", "(lengthen|extend|stretch) {text} by {dur}", "{text} should (be|last) {dur}"],
  "sched.done": ["(check off|tick off|mark off) (the )?{text} [as done]", "i (finished|completed|did) {text}"],
  "sched.move": ["change (the )?{text} to {date}", "change (the )?{text} to {time}", "(move|switch) {text} over to {date}"],
  "sched.rename": ["call (the )?{text} (appointment|meeting|event) {text}", "rename (the )?{text} (appointment|meeting|event|block) to {text}"],
  "sched.add": ["add {text} at {time} {date}", "(add|schedule|put) (a )?{text} with {text} at {time}", "schedule a call with {text} at {time}"],
  "sched.delete": ["take {text} off (my|the) (schedule|calendar)", "(delete|remove|cancel) (the )?{text} (on|from) {date}"],
  "sched.repeat": ["make {text} (happen|repeat) every {text}", "make {text} (daily|weekly|every day|every other day)", "(repeat|recur) {text} every {text}"],
  "timer.left": ["is the {text} timer (almost )?done", "is (my|the) timer (almost )?done", "how is the {text} (timer )?doing"],
  "timer.add": ["put (another|one more|an extra) minute on (the )?{text}", "(give|add) (the )?{text} {dur} (more|extra)", "{dur} more (on|for) the {text}", "add {dur} to the {text}"],
  "alarm.list": ["do i have an alarm [set] [for] {date}", "is my alarm set", "(is there|any) alarm (set )?(for )?{date}"],
  "reminder.list": ["what am i supposed to remember", "(did i|do i) have (to|anything to) remember", "what did i ask you to remind me"],
  "reminder.cancel": ["(cancel|delete|remove|clear) (all )?(my |the )?reminders", "forget the {text} reminder", "(cancel|delete) (the|my) reminder (about|to|for) {text}", "no more reminders"],
  "reminder.set": ["remind me {date} to {text}", "remind me at {time} to {text}", "remind me to {text} at {time}", "remind me to {text} {date}"],
  "time.now": ["(you )?got the time", "what time you got", "time please"],
  "time.city": ["what (time is it|is the time) (in|over in) {text}", "(time|current time) (in|over in) {text}"],
  "date.today": ["what is the date today", "whats today"],
  "date.until": ["how long (until|till) {text} on {date}", "countdown (to|until|till) {date}", "how (long|many days) (until|till) my {text} {date}"],
  "date.holiday": ["when is {date} [this year|next year]", "what date is {date} (this|next) year"],
  "sched.open": ["(open|show) (the|my) (calendar|schedule|planner)", "(calendar|schedule|planner) please"],
  "web.open": ["open {text} (dot com|website|site|in the browser)", "(go to|open|take me to|pull up) (netflix|gmail|youtube|amazon|facebook|wikipedia|google|google maps|twitter|reddit|instagram|hulu|disney plus|espn|weather.com)"],
  "file.find": ["find my {text}", "where is my {text}", "look for (the|my) {text} (file|pdf|document|doc|spreadsheet|folder|photo|picture)?", "(search|look) (my|through my) (files|computer|documents) for {text}"],
  "file.open": ["open my {text} (file|document|pdf|spreadsheet|folder|resume|cv|report|letter|lease)", "open my (resume|cv|documents|downloads|desktop|pictures|music|videos)"],
  "bible.read": ["turn to {ref}", "(open|go) to {ref}", "{ref} please", "look up {ref}"],
  "bible.next": ["read more", "(keep|continue) reading", "next part", "go on reading"],
  "bible.votd": ["encourage me with (a verse|scripture|the bible)", "i need (a|some) (scripture|encouragement from the bible)"],
  "ds.fullscreen": ["maximize (yourself|dayspring|the window)", "(make|go) (it|yourself) (bigger|full size)"],
  "ds.settings": ["(open|show|go to) (the )?(settings|preferences|options|setup) [page|menu|screen]", "settings"],
  "ds.help": ["open the (manual|guide|help page|help)", "(read|show) (me )?the manual"],
  "study.next": ["how is my {text} progress", "how (is|am) (i|my) (doing|going) (in|on|with) {text} (course|class|lessons)?", "(my|the) {text} progress", "start studying", "(let us|lets) study", "(continue|resume) my (course|class|lessons|studies)", "open (the |my )?next {text} lesson", "what (lesson|course) am i on", "time to study", "study time"],
  "discover": ["what is new in my interests", "(show|find) me something (about|on) {text}", "discover something [new|interesting]", "(anything|something) new (in|about) my interests", "show me what you found"],
  "recipe.find": ["search for {text} recipes", "(i want|i would like) to make {text}", "give me a (good|great|easy) {text} recipe", "how (do|can) i make {text}", "{text} recipes", "(look up|find) (a|some) {text} recipes?"],
  "recipe.cook": ["make the {text} recipe", "make {text} for {num} people", "cook the {text} recipe", "(start|begin) (the )?{text} recipe"],
  "recipe.list": ["(show|open|list) my (saved |favorite |favourite )?recipes", "my recipes", "recipe (book|box|list)"],
  "cook.next": ["next", "okay done", "done what is next", "ready"],
  "cook.prev": ["back one step", "the step before", "go back a step", "previous"],
  "cook.goto": ["go to the (first|second|third|last) step", "(first|last) step", "start over from (the )?(first|beginning) step"],
  "health.water": ["remind me to drink water", "water reminders"],
  // more everyday ways of saying the thin ones (scripts/intents-coverage.mjs lists them)
  "coin": ["(can you )?flip a coin for me", "call it heads or tails", "toss a coin to decide", "coin toss please", "(help me )?decide with a coin"],
  "spell": ["how (do|would) you spell {text}", "(spell|spelling) (the word )?{text} (for me|please)?", "what is the spelling of {text}", "is {text} spelled right"],
  "greet.morning": ["(good )?morning (dayspring|to you|sunshine|everyone|all)", "rise and shine", "top of the morning to you"],
  "greet.night": ["(nighty night|night night|sleep tight)", "i am (off|going) to (bed|sleep)", "(going|heading) to bed", "see you in the morning"],
  "greet.hello": ["(hello|hi|hey) (there|friend|buddy|you)", "(anybody|anyone) (there|home)", "are you there"],
  "greet.how": ["how (are|have) you (been|doing|feeling)", "(how is|hows) your day (going)?", "you (doing|feeling) (ok|okay|alright|good)"],
  "knock.start": ["i (have|got) a knock knock joke", "can i tell you a (knock knock )?joke", "want to hear a (knock knock )?joke"],
  "note.delete": ["(delete|remove|erase) (my|the) (last|latest) note", "(delete|remove) the note about {text}", "forget (that|my last) note"],
  "note.read": ["what (notes|did i note) (do i have|down)", "(read|show) me (my|the) notes", "any notes"],
  "todo.read": ["what (is|s) on my (to do|todo) list", "(read|show) (me )?my (tasks|to dos|to do list)", "what (tasks|to dos) do i have", "what do i (still )?have to do"],
  "cook.where": ["which step (are we|am i) on", "how many steps (are )?left", "where (are we|am i) (in the recipe)?"],
  "recipe.delete": ["(delete|remove|get rid of) (the |my )?{text} recipe", "(i do not|dont) want the {text} recipe (anymore)?"],
  "recipe.import": ["(import|save|grab|get) (the |a )?recipe from {text}", "save this recipe link", "import (the )?recipe (from this|at) {text}"],
  "prayer.add": ["add {text} to (my|the) prayers", "(can you )?(put|add) {text} on (my|the) prayer list", "remember to pray for {text}"],
  "date.what": ["what (is|s) the date (next|this) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)", "what date (does|will) {date} (fall on|be)"],
  "date.leap": ["(is|was) {num} a leap year", "how many days (are )?in february (this year)?"],
  "know.capital": ["(what is|whats) the capital of {text}", "capital city of {text}", "{text} capital city"],
  "know.table": ["(what is|whats) the {num} times table", "times table (for|of) {num}", "(read|say) the {num} times table"],
  "game.8ball": ["(magic )?eight ball", "ask the eight ball {text}", "shake the eight ball"],
  "game.wyr": ["give me a would you rather", "ask me something fun", "a would you rather question"],
  "social.sorry": ["(i am )?(so|really) sorry", "sorry about that", "forgive me"],
  "social.love": ["i (really )?like you", "you are (sweet|nice|kind|my friend)", "do you care about me", "i appreciate you"],
  "social.bored": ["i (have|got) nothing to do", "(i am|im) so bored", "this is boring", "something fun to do"],
  "greet.evening": ["good (afternoon|evening) (dayspring|to you|everyone)", "happy (monday|tuesday|wednesday|thursday|friday|saturday|sunday) (dayspring|to you)"],
};
const TUNE = {
  "app.open": { prior: 0.9 }, "focus.stop": { boost: kw(/\b(stop|end|cancel|finish|quit|done|over)\b/, 1.12) }, "focus.start": { boost: (c) => (/\b(stop|end|cancel|finish|quit|done)\b/.test(c.q) ? 0.85 : 1) }, "ds.helpwith": { prior: 0.88 }, "media.play": { prior: 0.9 }, "web.search": { prior: 0.88 }, "know.question": { prior: 0.8 },
  "file.find": { boost: kw(/^(find|where is|where did|look for|search (my|for))\b/, 1.15) }, "file.open": { boost: kw(/\b(resume|cv|document|pdf|spreadsheet|folder|file|lease|report|letter)\b/, 1.12) },
  "sched.week": { boost: kw(/\b(week|weekend)\b/, 1.15) }, "sched.month": { boost: kw(/\b(month|january|february|march|april|june|july|august|september|october|november|december)\b(?! \d)/, 1.12) },
  "sched.delete": { boost: (c) => (/\b(timers?|alarms?|reminders?|recipes?|notes?|lists?)\b/.test(c.q) ? 0.8 : 1) }, "sched.day": { boost: (c) => (/\b(this|next|the|my) week\b|\b(this|next) month\b/.test(c.q) && !/\bend of\b/.test(c.q) ? 0.88 : 1) }, "sched.conflicts": { boost: kw(/\b(conflicts?|clash(es)?|overlap(s|ping)?|double book)/, 1.2) },
  "sched.clear": { boost: kw(/\b(everything|all of|rest of|clear|wipe)\b/, 1.15) }, "sched.free": { boost: kw(/\b(free|busy|open|available|time for)\b/, 1.1) },
  "sched.resize": { boost: kw(/\b(long|longer|shorter|shorten|extend|lengthen)\b/, 1.12) }, "reminder.cancel": { boost: kw(/\breminders?\b/, 1.15) }, "alarm.list": { boost: kw(/\balarms?\b/, 1.1) }, "alarm.cancel": { boost: kw(/\balarms?\b/, 1.1) },
  "timer.left": { boost: kw(/\b(left|almost done|how long|how much longer|remaining)\b/, 1.1) }, "timer.add": { boost: kw(/\b(more|another|extra|add)\b/, 1.08) },
  "time.city": { boost: (c) => (cityIn(c.q) ? 1.2 : 1) }, "study.next": { boost: kw(/\b(study|studying|lesson|course|class)\b/, 1.15) }, "discover": { boost: kw(/\b(interests?|discover)\b/, 1.2) },
  "recipe.list": { boost: kw(/\bmy (saved |favorite |favourite )?recipes\b|\brecipe (book|box)\b/, 1.15) }, "recipe.find": { boost: kw(/\brecipes?\b|\bhow (do|can) i make\b|\bi want to make\b/, 1.08) },
  "bible.search": { boost: (c) => (/\b(youtube|you tube|videos?)\b/.test(c.q) ? 0.5 : 1) }, "bible.read": { boost: (c) => (/\b(youtube|you tube|videos?)\b/.test(c.q) ? 0.5 : 1) },
  "bible.votd": { boost: kw(/\b(verse|scripture)\b/, 1.08) }, "sched.done": { boost: kw(/\b(i finished|i did|i am done|mark .* done|check off)\b/, 1.08) },
  "media.volume": { boost: kw(/\b(music|song|video|it up|it down)\b/, 1.1) }, "ds.volume": { boost: kw(/\b(you|your|speak|talk|hear)\b/, 1.1) },
  "date.weekday": {}, "date.holiday": { boost: kw(/^when is\b/, 1.05) },
};
for (const it of INTENTS) {
  if (it.cat === "personality") TUNE[it.id] = { boost: kw(/\b(personality|personalities|character|persona|pretending|normal self)\b/, 1.25) };
  if (it.cat === "cooking") { const b0 = it.boost; it.boost = (c) => (b0 ? b0(c) : 1) * (/\b(song|track|music|video|playlist)\b/.test(c.q) ? 0.7 : 1); }
  if (MORE_SAY[it.id]) it.say = [...it.say, ...MORE_SAY[it.id]];
  if (TUNE[it.id]) { const t = TUNE[it.id]; if (t.prior) it.prior = t.prior; if (t.boost) { const b0 = it.boost; it.boost = b0 ? (c) => b0(c) * t.boost(c) : t.boost; } }
}

export const FAMILIES = [...new Set(INTENTS.map((i) => i.cat))];
