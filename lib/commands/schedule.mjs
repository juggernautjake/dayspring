// The schedule and reminders by voice, with repeats, no AI needed (lib/store.mjs keeps the schedule, lib/recur.mjs the
// repeat rules, lib/reminders.mjs one-time reminders, lib/timers.mjs repeating ones).
//   add     "schedule a dentist appointment next Tuesday at 3", "add gym every Monday Wednesday Friday at 6am for an hour",
//           "Bible study every weeknight at 9", "team sync on the first Monday of every month at 10", "piano on the 15th of
//           each month at 4", "walk every day until December at 7am", "standup weekdays at 9 for the next 3 weeks",
//           "trash night every Thursday except holidays", "I have a haircut this weekend at 10"
//   remind  "remind me to take out the trash every Thursday night", "remind me to pay rent on the 1st of every month",
//           "remind me to call mom tomorrow at 6", "remind me to drink water at 11pm" (once: never hourly)
//   edit    "move my 3pm to 4", "move it to 5", "move gym to Thursday", "cancel Friday's gym", "make it recurring",
//           "make gym repeat every Monday", "stop repeating", "change it to every two weeks", "cancel all gym"
import * as store from "../store.mjs";
import * as recur from "../recur.mjs";
import { when, repeatIn, soonest, describeRepeat, PART_TIMES } from "./when.mjs";
import { sayTime, sayDate, isoOf } from "../intents/slots.mjs";
import { cap } from "./words.mjs";

const CREATE = /^(?:(?:can you |could you |please |i need to |i want to |go ahead and |lets |let us )*)(schedule|add|put|book|create|set up|plan|pencil in|block off|block out|block|put down|mark down|enter|make (?:an? )?(?:appointment|reservation|event|meeting|calendar event)(?: for)?|i have|i ve got|i got|there is|there s|new event|new appointment|save)\b/;
const NOT_SCHEDULE = /\b(timers?|alarms?|to (my |the )?(shopping|grocery|groceries|to ?do|todo|packing|prayer|task|wish|reading)( list)?|to the list|to my list|on (my |the )?(shopping|grocery|to ?do|packing|prayer) list|\d+ (more )?(minutes?|seconds?|hours?) to|volume|note|recipe|song|playlist|queue|to my (prayer|interests)|interest|course|favorites?|contacts?|bookmark|folder|file|photo|picture|money|budget|reminders? (for|to)? ?\d)\b/;
const EVENTISH = /\b(appointment|meeting|dentist|doctor|lunch|dinner|breakfast|class|study|gym|workout|practice|church|service|call|interview|exam|test|party|haircut|visit|game|rehearsal|session|lesson|walk|run|yoga|trip|flight|date|coffee|conference|event|shift|work|pickup|drop off|errand|chores?|trash|laundry|cleaning|bible|prayer|devotion|standup|sync|review)\b/;
const IMPORTANT = /\b(appointment|meeting|dentist|doctor|lunch|dinner|class|interview|exam|study|church|service|practice|rehearsal|conference|session|lesson|game)\b/;
// words that make it repeat ("this weekend" / "next week" don't: they're a day)
const REPEATING = /\b(every|each|daily|nightly|weekly|monthly|yearly|annually|weekdays|weekday|weekends|weeknights?|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|biweekly|fortnightly|of (every|each) month|every weekend|on weekends|(mon|monday) (through|thru|to) (fri|friday)|(first|second|third|fourth|last|1st|2nd|3rd|4th) (sun|mon|tues|wednes|thurs|fri|satur)day of (the|every|each) month)\b/;
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHM = (m) => `${String(Math.floor(Math.max(0, m) / 60) % 24).padStart(2, "0")}:${String(Math.max(0, m) % 60).padStart(2, "0")}`;
export function category(title) { const t = title.toLowerCase(); return /gym|workout|run|walk|exercise|practice|game|swim|yoga|bike|hike|sport/.test(t) ? "body" : /study|exam|lesson|homework|class|course|learn/.test(t) ? "study" : /church|bible|pray|worship|devotion|service/.test(t) ? "faith" : /breakfast|lunch|dinner|meal|coffee/.test(t) ? "meal" : /work|meeting|call|client|standup|sync|review|interview|conference|shift/.test(t) ? "work" : /clean|laundry|dishes|errand|haircut|shop|trash|chore/.test(t) ? "home" : /movie|nap|rest|relax/.test(t) ? "rest" : "flex"; }

// the title: what's left once the when, the how-often and the verbs are gone
function titleOf(q, texts) {
  let s = ` ${q} `;
  for (const t of [...texts].filter(Boolean).sort((a, b) => b.length - a.length)) s = s.replace(` ${t.trim()} `, " ").replace(t.trim(), " ");
  s = ` ${s.trim().replace(CREATE, " ")} `;
  s = s.replace(/^\s*(an?|the|my|new)\s+/, " ")
    .replace(/\b(to|on|in|onto) (my|the) (schedule|calendar|planner|agenda)\b|\b(on|to) (my )?calendar\b/g, " ")
    .replace(/\b(an event|event|appointment|a meeting) (called|named|for)\b/g, (m) => (/appointment|meeting/.test(m) ? m.replace(/ (called|named|for)$/, "") : " "))
    .replace(/\b(called|named|titled)\b/g, " ")
    .replace(/\b(at|on|from|every|each|for|starting|until|till|through|and|this|next|the|a|an|by|around|about|with|of|every other|in|to)\s*$/g, " ")
    .replace(/\s+(at|on|from|every|each|for|starting|until|till|by|around|this|next|in)\s*$/, " ")
    .replace(/^\s*(a|an|the|my|to)\s+/, " ").replace(/\s+/g, " ").trim();
  // leftovers of the when ("at", "on", "for an")
  s = s.replace(/\b(on|at|every|each|from|until|till|for an?|for|starting)$/g, "").replace(/\s+(on|at)\s+(?=\S)/g, " ").trim();
  return s.replace(/^(a|an|the|my)\s+/, "").trim();
}

// ---- parse (dry run) ------------------------------------------------------------------------------------------------
export function parse(q, { now = new Date(), last = null } = {}) {
  q = String(q ?? "").trim();
  if (!q) return null;
  let m;
  // "pay rent reminder on the 1st of every month", "a stand up reminder every weekday at 3": the same as "remind me to …"
  if ((m = /^(?:set |add |create |make |put in |i need )?(?:a |an |my )?(?!.*\b(timer|alarm)\b)(.+?) reminders? ((?:on|every|each|at|for|daily|weekly|monthly|tomorrow|tonight|this|next|weekdays|weekends)\b.*)$/.exec(q)) && !/^(set|add|create|make|a|an|the|my|stop|cancel|delete|remove|no more|what|any)$/.test(m[2]) && !/^(stop|cancel|delete|remove|no more|what|which|list|any)\b/.test(q)) {
    q = `remind me to ${m[2]} ${m[3]}`;
  }
  // ---- reminders with a time or a repeat ----
  if (/^(?:remind me|set (?:a |up a )?reminder|create a reminder|make a reminder|add a reminder|do not let me forget|dont let me forget|i need a reminder|reminder)\b/.test(q) && !/\bremind me (in|again in) \d|\bin (\d+|an?|a few|a couple of|half an?) (minutes?|hours?|seconds?)\b|\bin a (bit|while|sec|moment)\b/.test(q)) {
    const everyDur = /\b(?:every|each) (\d+(?:\.\d+)?|half an?|an?|other|couple of|few)?\s*(minutes?|hours?|half hour)\b|\bhourly\b/.test(q);
    if (everyDur) return null;                                            // "every 30 minutes": lib/commands/clock.mjs
    const body = q.replace(/^(?:remind me|set (?:a |up a )?reminder|create a reminder|make a reminder|add a reminder|do not let me forget|dont let me forget|i need a reminder|reminder)\s*/, "");
    const rep = REPEATING.test(body.replace(/\b(this|next|the|that) (weekend|week)\b/g, " ")) ? repeatIn(body, now) : null;
    const w = when(body, now);
    if (!rep && !w.time) return null;                                     // no time: the rundown reminder (lib/offline.mjs)
    const texts = [...w.texts, ...(rep?.texts ?? [])];
    let text = body;
    for (const t of texts.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.replace(t, " ");
    text = text.replace(/^\s*(to|about|that|of|for)\s+/, "").replace(/\b(on|at|every|each|in the|at night|tonight|this evening|in the morning|morning|night|evening|afternoon|nights|mornings|evenings)\s*$/g, "").replace(/\b(to|about|that)\s+/, (x, _a, i) => (i === 0 ? "" : x))
      .replace(/\s+(on|at|every|each|the|of|this|next|and|until|starting)\s*$/g, "").replace(/\s+/g, " ").trim();
    text = text.replace(/^(to|about|that|of|for) /, "");
    if (!text) return { intent: "reminder.create", args: { needText: true, time: w.time, date: w.date, ...(rep ? { repeat: rep.repeat } : {}) } };
    let time = w.time ?? (rep?.part ? PART_TIMES[rep.part === "night" ? "night" : rep.part] : null) ?? "09:00";
    return { intent: "reminder.create", args: { text, time, date: rep ? null : w.date, ...(rep ? { repeat: rep.repeat } : {}), loose: !w.explicit && !rep && !w.date } };
  }
  // ---- stop repeating / make it recurring / change how often ----
  if ((m = /^(?:stop repeating|do not repeat|dont repeat|no more repeating|make (.+?) (?:a )?(?:one|1) ?time(?: thing| event| only)?|(?:end|stop|cancel) (?:the )?(.+?) (?:series|for good|from now on|going forward)|(?:cancel|delete|remove) (?:all|every) (?:(?:the|my|future|upcoming) )*(.+?)(?: events?| blocks?)?|(.+?) (?:should not|shouldnt|does not need to|doesnt need to) repeat(?: anymore)?|stop (?:the )?(.+?) from repeating)(?: (it|that|this|them))?$/.exec(q)) && !/\b(timers?|alarms?|reminders?|notes?|lists?)\b/.test(q)) {
    const ref = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? "it").replace(/^(my|the) /, "").trim().replace(/^(that|this|them|that one|this one)$/, "it");
    return { intent: "sched.norecur", args: { ref: ref || "it" } };
  }
  if ((m = /^(?:make|have|set|turn|let|change|switch|put|schedule|repeat) (?:(.+?) )?(?:repeat(?:ing)?|recurring|recur|a recurring (?:event|thing|block)|happen|occur|go)?\s*((?:every|each|daily|weekly|monthly|yearly|on weekdays|weekdays|weekends|on (?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)|biweekly|every other).*)?$/.exec(q))
      && (/\b(repeat|repeating|recurring|recur|every|each|daily|weekly|monthly|weekdays|weekends|biweekly)\b/.test(q)) && !/\b(timers?|alarms?|reminders?|remind|volume|voice|theme|sky|background|rain|snow|night|sunset)\b/.test(q) && !/^(schedule|add|put|book)\b/.test(q) || /^change (it|that|this|.+?) to (every|each|daily|weekly|monthly|weekdays|weekends|biweekly)\b/.test(q)) {
    const cm = /^change (it|that|this|.+?) to ((?:every|each|daily|weekly|monthly|weekdays|weekends|biweekly).*)$/.exec(q);
    const ref = ((cm ? cm[1] : m?.[1] ?? "it").replace(/^(my|the|a) /, "").replace(/ (repeat|recurring|happen|occur)$/, "").trim() || "it").replace(/^(that|this|that one|this one)$/, "it");
    const ruleText = cm ? cm[2] : q;
    const rep = repeatIn(ruleText.replace(/\binstead\b/, ""), now) ?? (/\bweekly\b/.test(ruleText) ? { repeat: { freq: "weekly", interval: 1, days: null } } : /\bmonthly\b/.test(ruleText) ? { repeat: { freq: "monthly", interval: 1 } } : null);
    if (ref.split(" ").length <= 5 && !/^(it|that|this)$/.test(ref) || /^(it|that|this)$/.test(ref)) return { intent: "sched.recur", args: { ref, repeat: rep?.repeat ?? null } };
  }
  // ---- move ----
  // (only these verbs move a thing; "put X on Saturday at 10" is a new one, and "make it / put it" means the last thing)
  if ((m = /^(?:move|reschedule|shift|push|bump|slide|change|switch) (?:my |the |our )?(.+?) (?:to|till|until|over to|back to|forward to) (.+?)(?: instead)?$/.exec(q)) || (m = /^(?:make|move|put|set|push|change|switch) (it|that|this|that one|this one) (?:to |at |for |on )?(.+?)(?: instead)?$/.exec(q))) {
    const ref = m[1].trim().replace(/^(that|this|that one|this one)$/, "it"), target = m[2].trim();
    // "change bible study to mondays and wednesdays", "move gym to every other week": how often, not when
    if (REPEATING.test(target) || /\brepeat\b/.test(target)) { const rep = repeatIn(target.replace(/\binstead\b/, ""), now); return rep && ref.split(" ").length <= 5 ? { intent: "sched.recur", args: { ref: ref.replace(/^(my|the) /, ""), repeat: rep.repeat } } : null; }
    if (/^(the )?(window|screen|dayspring|yourself|volume|voice|theme|background|sky|music|song|video|timer|alarm|reminder|brightness|margin|text|clock|layout|panel|notifications?|night mode|wake word|speed|avatar|scenery|weather|it (louder|quieter|bigger|smaller))\b/.test(ref) || /\b(timer|alarm|reminder|volume|theme)s?$/.test(ref)) return null;
    const t = when(target, now);
    if (!t.date && !t.time && !/^\d{1,2}$/.test(target)) return null;
    const time = t.time ?? (/^\d{1,2}$/.test(target) ? when(`at ${target}`, now).time : null);
    const series = /^(all|every|each)\b/.test(ref) || /\b(every week|all of them|the series|every time)\b/.test(q);
    return { intent: "sched.move", args: { ref: ref.replace(/^(all|every|each) (the |my )?/, "").replace(/ (every week|all of them)$/, ""), date: t.date, time, loose: !t.explicit, series } };
  }
  // ---- cancel one (or a day of a repeating one) ----
  if ((m = /^(?:cancel|delete|remove|drop|skip|clear|take off|get rid of|scratch|call off|nix|erase) (?:my |the |this |our )?(.+?)(?: (?:from|off) (?:my |the )?(?:schedule|calendar|planner|agenda))?$/.exec(q))) {
    const ref = m[1].trim();
    if (/\b(timers?|alarms?|reminders?|notes?|lists?|recipes?|everything|all of it|that|it|pomodoro|focus|session|music|song|video|order|subscription|snooze|call|download|update|search|request|the rest of (my|the) day|my afternoon|my morning|my evening|this evening|tonight|tomorrow morning|all|everything)$/.test(ref) && !/\b(gym|meeting|appointment|class)\b/.test(ref)) return null;
    if (/^(it|that|this)$/.test(ref) && !last) return null;
    const t = when(ref, now);
    let words = ref;
    for (const x of t.texts) words = words.replace(x, " ");
    words = words.replace(/\b(on|for|at|this|next|the|my|s|from)\b/g, " ").replace(/\s+/g, " ").trim();
    if (!words && !t.time) return null;
    return { intent: "sched.cancel", args: { ref: words || null, date: t.date, time: t.date || /\b\d/.test(ref) ? t.time : null } };
  }
  // ---- a new event ----
  const created = CREATE.test(q);
  if (NOT_SCHEDULE.test(q)) return null;
  const hasRepeat = REPEATING.test(q.replace(/\b(this|next|the|that) (weekend|week)\b/g, " "));
  if (!created && !(hasRepeat && /\b(at|from) \d|\bat (noon|midnight)\b|\b\d(am|pm)\b|\b(night|morning|evening)\b/.test(q))) return null;
  if (!created && (/^(what|when|where|who|why|how|is|are|do|does|did|can|could|will|would|should|tell|show|read|play|turn|set|make|stop|start|open|close|find|search|remind|cancel|delete|move)\b/.test(q))) return null;
  if (/^(i have|i ve got|i got|there is|there s)\b/.test(q) && !EVENTISH.test(q)) return null;
  const rep = hasRepeat ? repeatIn(q, now) : null;
  const w = when(q, now);
  const title0 = titleOf(q, [...w.texts, ...(rep?.texts ?? [])]);
  if (!title0 || /^(something|a thing|some thing|stuff|an event|event|it)$/.test(title0)) return created ? { intent: "sched.create", args: { needTitle: true, date: w.date, time: w.time } } : null;
  if (title0.split(" ").length > 8) return null;
  let time = w.time, explicit = w.explicit;
  if (!time && rep?.part) { time = PART_TIMES[rep.part]; explicit = true; }
  const minutes = w.minutes ?? (w.end && time ? toMin(w.end) - toMin(time) : null);
  // a repeating one starts now (or when it says, "starting next month"): "every Monday" isn't "next Monday"
  const date = rep && /\b(sun|mon|tues|wednes|thurs|fri|satur)days?\b|\bweekend\b/.test(w.texts[0] ?? "") ? null : w.date;
  return { intent: "sched.create", args: { title: title0, date, time, minutes, repeat: rep?.repeat ?? null, loose: Boolean(time) && !explicit, vague: Boolean(w.vague) } };
}

// ---- finding what they mean -----------------------------------------------------------------------------------------
// every block and repeating item over the next two weeks (or on one day), with the projected routine days included
export function planned(from, to) { return store.planBetween(from, to); }
export function findBlock(ref, { date = null, time = null, last = null, now = new Date() } = {}) {
  const today = isoOf(now), nowHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const r = String(ref ?? "").toLowerCase().replace(/\b(the|my|a|an|our|s)\b/g, " ").replace(/\s+/g, " ").trim();
  if ((!r || /^(it|that|this|that one|this one|the last one)$/.test(r)) && last) {
    if (last.kind === "routine") { const ro = store.routines().find((x) => x.id === last.routineId); if (ro) return { routine: ro, block: null }; }
    const b = store.all().blocks.find((x) => x.id === last.id); if (b) return { block: b };
  }
  // "my 3pm", "the 3 o'clock"
  const t = time ?? (/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m|oclock)?$/.test(r) ? when(`at ${r}`, now).time : null);
  const days = date ? [date] : Array.from({ length: 14 }, (_, i) => store.addDays(today, i));
  const words = r.replace(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m|oclock)?$/, "").split(" ").filter((w) => w && !/^(on|at|for|this|next|today|tomorrow)$/.test(w));
  const hits = [];
  for (const d of days) {
    for (const b of planned(d, d)) {
      if (d === today && !date && b.end <= nowHM && !t) continue;
      const title = b.title.toLowerCase();
      // (every word of the ref in the title, most of them, or the whole title in the ref: "gym session" finds "Gym")
      const byWords = words.length && (words.every((w) => title.includes(w)) || (words.length > 1 && words.filter((w) => title.includes(w)).length >= Math.ceil(words.length * 0.6)) || title.split(/\s+/).every((tw) => words.includes(tw)));
      const byTime = t && (b.start === t || (!/(am|pm)/.test(r) && b.start === toHM((toMin(t) + 12 * 60) % (24 * 60))));
      if ((words.length ? byWords : true) && (t ? byTime : words.length > 0)) hits.push(b);
    }
    if (hits.length && !date) break;
  }
  if (!hits.length) return null;
  return { block: hits[0], more: hits.length - 1 };
}

// ---- saying it ---------------------------------------------------------------------------------------------------------
export const whenSay = (date, hm, now = new Date()) => `${sayDate(date, now)} at ${sayTime(hm)}`;
export function defaultMinutes(title) { return /\bbible study|study|class|lesson|practice|rehearsal|church|service\b/i.test(title) ? 60 : IMPORTANT.test(title.toLowerCase()) ? 60 : 30; }
export { toMin, toHM, describeRepeat, soonest, recur };
