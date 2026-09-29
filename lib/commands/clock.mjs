// Alarms, timers to a clock time, and "every 30 minutes" reminders by voice, no AI needed (lib/timers.mjs keeps them).
//   alarms   "set an alarm for weekdays at 6:30", "alarm Saturday at 8" (just that Saturday), "wake me up at 7 every day",
//            "a gentle alarm at 6 with the bells", "a loud alarm at 5:30 called gym with a 5 minute snooze", "flash the screen",
//            "turn off my weekend alarms", "turn my 6:30 alarm back on", "skip tomorrow's alarm", "what alarms do I have",
//            "delete the 6:30 alarm", "change my 6:30 alarm to 6:45", "make my alarm louder"
//   timers   "set a timer for 7:45" (until that time), "timer until 5 pm", "a timer that goes off every day at 7" (an alarm)
//   every    "every 30 minutes remind me to stand up", "remind me to stretch every hour", "stop reminding me to stand up"
// The plain timers ("set a timer for 10 minutes", "pause the pasta timer", "add 5 minutes", "how long is left on the
// laundry") stay with lib/intents, which already does them well (up to 7, named, "What's it for?").
import { when, repeatIn, soonest, describeRepeat } from "./when.mjs";
import { sayTime, sayDate, isoOf } from "../intents/slots.mjs";
import { cap, listSay } from "./words.mjs";

const DAYN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAYW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SOUNDS = [["bells", /\bbells?\b/], ["chimes", /\bchimes?\b/], ["birds", /\b(birds?|birdsong|chirp\w*)\b/], ["beeps", /\b(beeps?|beeping|classic|buzzer)\b/], ["soft", /\b(soft|piano|calm|soothing) (sound|tone|ring|music)\b/], ["fanfare", /\b(fanfare|trumpets?)\b/]];
export const SOUND_NAMES = SOUNDS.map(([n]) => n);
const ALARM = /\balarms?\b/;
const NOT_CREATE = /\b(turn off|turn on|switch off|switch on|cancel|delete|remove|get rid of|skip|stop|dismiss|snooze|disable|enable|what|which|when|list|show|how many|do i have|is my|are my|change|move|rename|make my|make the|volume|morning alarm|wake up alarm|louder|quieter|softer)\b/;

// the ringing options said with it
function ringIn(q) {
  const o = {};
  const s = SOUNDS.find(([, re]) => re.test(q)); if (s) o.sound = s[0];
  let m;
  if ((m = /\b(?:at |volume )(\d{2,3}) ?(?:percent|%)(?: volume)?\b|\bvolume (?:at |of )?(\d{2,3})\b/.exec(q))) o.volume = Number(m[1] ?? m[2]);
  else if (/\b(loud|really loud|very loud|loudest|full volume|max(imum)? volume)\b/.test(q)) o.volume = 100;
  else if (/\b(quiet|soft|low volume|not too loud)\b(?! (sound|tone|ring|music))/.test(q) && !/\bquiet (mode|hours)\b/.test(q)) o.volume = 40;
  if ((m = /\b(\d{1,2}) ?minutes? snooze\b|\bsnooze (?:for |of |time of |length of |to )?(\d{1,2})(?: minutes?)?\b/.exec(q))) o.snooze = Number(m[1] ?? m[2]);
  if (/\b(gentle|gently|fade in|fading in|fades in|gradual(ly)?|slowly (gets|get|getting) louder|soft start|sunrise wake|ease me awake|wake me gently|build(s|ing)? up)\b/.test(q)) o.gentle = true;
  if (/\b(no gentle|not gentle|right away full|straight to full)\b/.test(q)) o.gentle = false;
  if (/\b(flash(ing)?|flashes|blink(ing)?|vibrat\w*|strobe|light up the screen)\b/.test(q)) o.flash = true;
  return o;
}
// "called gym", "for work", "named wake up", "labeled pills", "to take my pills"
function labelIn(q, texts) {
  let s = ` ${q} `;
  for (const t of texts.filter(Boolean).sort((a, b) => b.length - a.length)) s = s.replace(` ${t} `, " ");
  const m = /\b(?:called|named|label(?:l)?ed|titled|that says|saying|with the (?:label|name)) (.+?)(?: (?:with|at|every|on|for|and)\b.*)?$/.exec(s.trim())
    ?? /\b(?:alarm|wake me up|wake me) (?:for|to) (?!\d)(?!(?:the |a |an )?(?:morning|weekdays?|weekends?|every|each|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday))(.+?)(?: (?:with|at|every|on|and)\b.*)?$/.exec(s.trim());
  if (!m) return "";
  const l = m[1].replace(/\b(the |a |an )/, "").replace(/\b(sound|snooze|flash|gentle|loud|quiet)\b.*$/, "").trim();
  return l.split(" ").length <= 5 ? l : "";
}
// which alarms: "weekend", "weekday", "saturday", "6:30", "the gym one", "all", "tomorrow's"
export function alarmFilter(q, now = new Date()) {
  const f = {};
  if (/\ball( (of )?my| the)? alarms\b|\bevery alarm\b/.test(q)) f.all = true;
  if (/\bweekends?\b/.test(q)) f.days = [0, 6];
  else if (/\bweekdays?|work ?days?|school days?\b/.test(q)) f.days = [1, 2, 3, 4, 5];
  else { const d = [...q.matchAll(/\b(sun|mon|tues|wednes|thurs|fri|satur)days?\b/g)].map((x) => DAYN[x[1].slice(0, 3)]); if (d.length) f.days = d; }
  const t = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?(?= ?(?:alarm|o ?clock|oclock|one|\b))/.exec(q.replace(/\b(\d+) (minutes?|percent|seconds?)\b/g, ""));
  if (t && /\balarm\b/.test(q)) { let h = Number(t[1]); const mi = Number(t[2] ?? 0), ap = (t[3] ?? "").replace(" ", ""); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; if (h <= 23) f.hm = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`; f.hmLoose = !ap; }
  if (/\btomorrow( s)?\b/.test(q)) { const d = new Date(now); d.setDate(d.getDate() + 1); f.date = isoOf(d); }
  else if (/\btoday( s)?\b|\btonight( s)?\b/.test(q)) f.date = isoOf(now);
  const lab = /\b(?:the|my) ([a-z]+(?: [a-z]+)?) alarms?\b/.exec(q)?.[1];
  if (lab && !/^(my|the|an|a|all|every|weekend|weekday|weekends|weekdays|morning|next|this|that|it|tomorrow s|tomorrows|today s|off|on|of|one|each|repeating|daily|recurring|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|am|pm|oclock|\d+)$/.test(lab) && !/\d/.test(lab)) f.label = lab.replace(/^(my|the) /, "");
  if (/\bnext alarm\b/.test(q)) f.next = true;
  return f;
}
export function matchAlarms(list, f, now = new Date()) {
  let out = list.filter((a) => (a.kind ?? "alarm") === "alarm");
  if (f.label) { const byLabel = out.filter((a) => (a.label ?? "").toLowerCase().includes(f.label)); if (byLabel.length) out = byLabel; else if (!f.hm && !f.days) return []; }
  if (f.hm) { const exact = out.filter((a) => a.hm === f.hm); out = exact.length || !f.hmLoose ? exact : out.filter((a) => { const [h, m] = f.hm.split(":").map(Number); return a.hm === `${String((h + 12) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }); }
  if (f.days) out = out.filter((a) => { const ds = a.repeat?.days ?? (a.repeat?.rule?.freq === "weekly" ? a.repeat.rule.days.map((d) => DAYN[d]) : a.repeat?.rule?.freq === "daily" ? [0, 1, 2, 3, 4, 5, 6] : [new Date(a.at).getDay()]); return ds.some((d) => f.days.includes(d)); });
  if (f.date) out = out.filter((a) => isoOf(new Date(a.at)) === f.date);
  if (f.next) out = out.filter((a) => !a.off).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 1);
  return out;
}

// ---- parse (dry run) ------------------------------------------------------------------------------------------------
export function parse(q, now = new Date()) {
  q = String(q ?? "").trim();
  if (!q) return null;
  let m;
  // ---- every N minutes: interval reminders (and stopping them) ----
  const everyDur = /\b(?:every|each) (\d+(?:\.\d+)?|half an?|an?|other|couple of|few)?\s*(minutes?|hours?|hour|half hour)\b|\b(hourly|every half hour)\b/.exec(q);
  if ((m = /^(?:stop|quit|no more|cancel|end|turn off|stop the|cancel the|end the|turn off the)(?: reminding me| reminders?| the reminders?)? (?:to |about |for )?(.+?)(?: reminders?)?$/.exec(q)) && /\b(stop reminding|reminders?$|no more .+ reminders?|remind(ers)? to)\b/.test(q) && !/\b(water|all reminders|my reminders)\b/.test(q) && !/^cancel (the |my )?reminder (about|for|to)\b/.test(q)) {
    return { intent: "every.stop", args: { text: m[1].replace(/^(the|my) /, "").replace(/ (every|each) .*$/, "").trim() } };
  }
  if (everyDur && /\bremind(er)?s?\b/.test(q) && !/\b(at \d|every (day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|night|evening|weekday))\b/.test(q)) {
    const n = everyDur[3] ? (/half/.test(everyDur[3]) ? 0.5 : 1) : everyDur[2] === "half hour" ? 0.5 : !everyDur[1] || /^an?$/.test(everyDur[1]) ? 1 : /half/.test(everyDur[1]) ? 0.5 : /other/.test(everyDur[1]) ? 2 : /couple/.test(everyDur[1]) ? 2 : /few/.test(everyDur[1]) ? 3 : Number(everyDur[1]);
    const ms = Math.round((/hour/.test(everyDur[2] ?? everyDur[3]) ? n * 60 : n) * 60_000);
    const text = (/\bremind me (?:to|about) (.+?)(?: every| each| hourly|$)/.exec(q) ?? /\b(?:every|each) .+? remind me (?:to|about) (.+)$/.exec(q) ?? /\bremind me (?:every|each) .+? (?:to|about) (.+)$/.exec(q) ?? /\b(?:a |an )?(.+?) reminders? (?:every|each|hourly)\b/.exec(q) ?? /\b(?:hourly|half hourly) reminders? (?:to|for) (.+)$/.exec(q))?.[1]?.trim();
    if (text && ms >= 60_000) return { intent: "every.start", args: { ms, text: text.replace(/^(set |set up |start )?(a |an )?/, "") } };
  }
  // ---- cancelling a timer: "cancel the timer", "stop the pasta timer", "delete all timers" ----
  if ((m = /^(?:cancel|delete|remove|kill|end|clear|get rid of|turn off|stop) (?:the |my |all (?:the |my |of my )?|all )?(.*?)\s*timers?$/.exec(q)) && !/\b(stopwatch)\b/.test(q)) return { intent: "timer.cancel", args: { ref: /^(cancel|delete|remove|kill|end|clear|get rid of|turn off|stop) (all|every)\b/.test(q) ? "all" : m[1].replace(/^(the|my) /, "").trim() } };
  // ---- a timer that goes off every day at 7: that's an alarm ----
  const w = when(q, now);
  const rep = /\b(every|each|daily|weekdays?|weekends?|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|weeknights?|nightly|except|(monday|mon) (through|thru|to) (friday|fri))\b/.test(q) ? repeatIn(q, now) : null;
  if (/\btimer\b/.test(q) && rep && w.time && !/\b(pause|cancel|stop|how long|resume|add)\b/.test(q)) return alarmCreate(q, w, rep, now);
  // ---- a timer until a clock time: "set a timer for 7:45", "timer until 5 pm" ----
  if (/\btimer\b/.test(q) && w.time && !/\b\d+(\.\d+)? ?(seconds?|minutes?|hours?|mins?|secs?)\b/.test(q) && !/\b(pause|cancel|stop|resume|how long|how much|add|rename|call|dismiss)\b/.test(q)
    && (/\d:\d\d|\b(am|pm|a m|p m|oclock|noon|midnight)\b|\b(until|till|til|up to|to go off at|that goes off at|ending at|for) \d/.test(q))) {
    const label = /\b(?:called|named|for (?:the |my )?)(?!\d)([a-z][a-z ]{1,30}?)(?: (?:timer|until|till|at)\b|$)/.exec(q.replace(w.texts[0] ?? "", " "))?.[1]?.trim() ?? "";
    return { intent: "timer.until", args: { hm: w.time, loose: !w.explicit, label: /^(a|the|me)$/.test(label) ? "" : label } };
  }
  if (!ALARM.test(q) && !/\bwake me( up)?\b|\bwake up call\b/.test(q)) return null;
  // ---- what alarms ----
  if ((/^(what|which|list|show|read|tell me|do i have|are there|any|how many|when)\b.*\balarms?\b|\bwhen (is|does) my (next )?alarm\b|\bwhat time is my alarm\b|^(show|list|read)( me)? (all )?(of )?my alarms$/.test(q)) && !/\b(set|make|create|add) (an?|another|new|one more|my|the)\b/.test(q)) return { intent: "alarm.list", args: { filter: alarmFilter(q, now) } };
  // ---- skip one day ----
  if ((m = /\bskip (?:the |my )?(?:next )?(?:alarm )?(?:for )?(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)?(?: s)? ?(?:alarms?)?(?: (?:for |on )?(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday))?\b/.exec(q)) && /\balarm/.test(q) || (m = /\bno alarm (tomorrow|today|tonight|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.exec(q)) || (m = /\b(?:do not|dont) wake me( up)? (tomorrow|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.exec(q))) {
    const dayWord = (/\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/.exec(q) ?? [])[1] ?? (/\bnext\b/.test(q) ? "next" : "tomorrow");
    return { intent: "alarm.skip", args: { day: dayWord } };
  }
  // ---- switch off / on (kept) ----
  if (((m = /\b(turn off|switch off|disable|pause|silence|mute|turn on|switch on|enable|unpause|reactivate|resume|turn back on)\b/.exec(q)) || /\b(turn|switch|put)\b.*\b(on|off)$/.test(q)) && !/\b(volume|morning alarm|wake up alarm)\b/.test(q) && !/\b(set|create|add)\b/.test(q)) {
    const on = (/\b(turn on|switch on|enable|unpause|reactivate|resume|turn back on)\b|\b(turn|switch|put) .+ (back )?on$/.test(q)) && !/\b(turn|switch) .+ off\b|\bturn off\b/.test(q);
    return { intent: "alarm.onoff", args: { on, filter: alarmFilter(q, now) } };
  }
  // ---- delete ----
  if (/\b(delete|remove|cancel|get rid of|clear|erase)\b/.test(q)) return { intent: "alarm.delete", args: { filter: alarmFilter(q, now) } };
  // ---- change one ----
  // ("set my alarm for 7" is a new alarm, like "set an alarm for 7"; "change my alarm to 7" changes the one there is)
  if ((m = /\b(?:change|move|push|set|switch|make|update|reschedule) (?:my |the )?(.*?)alarms? (?:to|for|at) (.+)$/.exec(q)) && !/\b(set|make) (an|a|another|new)\b/.test(q) && !(/^(set|make) (my|the) alarm (for|at) /.test(q))) {
    const t = when(m[2], now), opts = ringIn(m[2]);
    const newLabel = /^(?:be )?called (.+)$/.exec(m[2])?.[1];
    if (t.time || Object.keys(opts).length || newLabel) return { intent: "alarm.change", args: { filter: alarmFilter(`${m[1]} alarm`, now), ...(t.time ? { hm: t.time, loose: !t.explicit } : {}), ...opts, ...(newLabel ? { label: newLabel } : {}) } };
  }
  if ((m = /\b(?:make|set) (?:my |the )?(.*?)alarms? (louder|quieter|softer|gentle|gentler|loud|quiet|flash|flashing|vibrate|not gentle)\b/.exec(q)) || (m = /\brename (?:my |the )?(.*?)alarms? to (.+)$/.exec(q))) {
    const opts = /rename/.test(q) ? { label: m[2] } : /louder|loud/.test(m[2]) ? { volumeDelta: 20 } : /quieter|softer|quiet/.test(m[2]) ? { volumeDelta: -20 } : /not gentle/.test(m[2]) ? { gentle: false } : /gentle/.test(m[2]) ? { gentle: true } : { flash: true };
    return { intent: "alarm.change", args: { filter: alarmFilter(`${m[1]} alarm`, now), ...opts } };
  }
  if ((m = /\b(?:set|change|make) the snooze (?:on|for) (?:my |the )?(.*?)alarms? to (\d{1,2})(?: minutes?)?\b/.exec(q))) return { intent: "alarm.change", args: { filter: alarmFilter(`${m[1]} alarm`, now), snooze: Number(m[2]) } };
  // ---- a new alarm ----
  if (NOT_CREATE.test(q.replace(/\b(set|make|create|add|give me|i need|i want)\b/, "")) && !/^(set|make|create|add|give me|i need|i want|wake me|put|schedule|please set|can you set)\b/.test(q) && !/\bwake me\b/.test(q)) return null;
  if (!w.time) return { intent: "alarm.create", args: { needTime: true, ...ringIn(q) } };
  return alarmCreate(q, w, rep, now);
}
function alarmCreate(q, w, rep, now) {
  const opts = ringIn(q);
  let hm = w.time, loose = !w.explicit;
  // an alarm is usually to wake up: a bare "6" is 6 a.m. when it repeats (weekdays at 6), with "wake me", or when it's
  // a waking hour (4 to 10); other bare hours are whichever comes next
  const h12 = Number(hm.slice(0, 2)) % 12;
  if (loose && (rep || /\bwake\b/.test(q) || (h12 >= 4 && h12 <= 10))) { hm = `${String(h12).padStart(2, "0")}${hm.slice(2)}`; loose = false; }
  const once = /\b(just once|one time|only once|once|just (this|that|for) (one|time|day|once))\b/.test(q);
  let repeat = null, days = null;
  if (rep && !once) {
    const r = rep.repeat;
    if (r.freq === "weekly" && (r.interval ?? 1) === 1 && !r.until && !r.start && !r.exceptHolidays && r.days?.length) days = r.days.map((d) => DAYN[d]).sort();
    else if (r.freq === "daily" && (r.interval ?? 1) === 1 && !r.until && !r.start && !r.exceptHolidays) days = [0, 1, 2, 3, 4, 5, 6];
    else repeat = { rule: r };
  }
  const label = labelIn(q, [...w.texts, ...(rep?.texts ?? [])]);
  return { intent: "alarm.create", args: { hm, loose: loose && !days && !repeat, date: days || repeat ? null : w.date, ...(days ? { days } : {}), ...(repeat ? { rule: repeat.rule } : {}), label, ...opts } };
}

// ---- saying alarms ---------------------------------------------------------------------------------------------------
export function daysSay(days) {
  const s = [...new Set(days)].sort();
  if (s.length === 7) return "every day";
  if (s.join() === "1,2,3,4,5") return "on weekdays";
  if (s.join() === "0,6") return "on weekends";
  return "every " + listSay(s.map((d) => DAYW[d]));
}
export function alarmWhen(a, now = new Date()) {
  const t = sayTime(a.hm ?? new Date(a.at).toTimeString().slice(0, 5));
  if (a.repeat?.days) return `${t} ${daysSay(a.repeat.days)}`;
  if (a.repeat?.rule) return `${t}, ${describeRepeat(a.repeat.rule).replace(/^./, (c) => c.toLowerCase())}`;
  return `${t} ${sayDate(isoOf(new Date(a.at)), now)}`;
}
export function alarmExtras(a) {
  const x = [];
  if (a.label) x.push(`called ${a.label}`);
  if (a.gentle) x.push("a gentle wake");
  if (a.sound) x.push(`the ${a.sound} sound`);
  if (a.volume) x.push(`at ${a.volume}% volume`);
  if (a.snooze) x.push(`a ${a.snooze} minute snooze`);
  if (a.flash) x.push("a flashing screen");
  return x.length ? ` (${x.join(", ")})` : "";
}
export const nameOf = (a, now) => `the ${alarmWhen(a, now)} alarm`;
export { cap };
