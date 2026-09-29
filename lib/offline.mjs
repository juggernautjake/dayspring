// Scheduling by voice without Claude. When the model can't be reached, these plain commands still work:
//   "what's on tomorrow" · "add haircut Saturday at 10" · "add study for 2 hours at 7 pm"
//   "move gym to 7" · "move FS study to tomorrow at 8 pm" · "push dinner back 30 minutes"
//   "mark FS study done" · "I finished the gym" · "remove haircut" · "undo"
import * as store from "./store.mjs";
import * as recur from "./recur.mjs";
import * as learning from "./learning.mjs";
import * as planner from "./planner.mjs";
import * as reminders from "./reminders.mjs";
import * as chores from "./chores.mjs";
import * as transcripts from "./transcripts.mjs";
let fitTitle = null;
let pendingReminder = null;            // a block id: "Want a reminder before it?" was just asked
let pendingImportance = null;          // a block id: "How important is it?" was just asked
let lastAdded = null;                  // the block "that" / "it" means right after adding
// Things that usually matter more than a normal block: Dayspring asks how important they are
const SOUNDS_IMPORTANT = /\b(meeting|appointment|interview|exam|test|trip|flight|wedding|funeral|deadline|doctor|dentist|surgery|court|closing|conference|presentation|party|recital|graduation|tournament|game|visit|call with|lunch with|dinner with|birthday)\b/i;
const IMP_WORDS = ["normal", "notable", "important", "major"];
function importanceFrom(q) {
  if (/\b(major|huge|really (important|big)|very important|super important|big deal|top priority|critical|can'?t miss)\b/.test(q)) return 3;
  if (/\b(important|pretty|fairly|quite|big)\b/.test(q) && !/\bnot (very |that |really )?important\b/.test(q)) return 2;
  if (/\b(notable|kind of|kinda|sort of|somewhat|a little|medium|moderate)\b/.test(q)) return 1;
  if (/\b(normal|not (very |that |really )?important|no|nah|just normal|regular|not really)\b/.test(q)) return 0;
  return null;
}
// After adding: ask how important (if it sounds like it matters), otherwise go straight to the reminder question.
function afterAdd(block) {
  lastAdded = block.id;
  if (SOUNDS_IMPORTANT.test(block.title)) { pendingImportance = block.id; return " That sounds important. How important is it: just normal, notable, important, or major?"; }
  pendingReminder = block.id;
  return " Want a reminder before it?";
}
let morningRundown = () => "I can't put the rundown together right now.";
export function setRundown(fn) { morningRundown = fn; }
export function askReminderFor(blockId) { pendingReminder = blockId; }
// a question of ours waiting for its answer ("How important is it?", "Want a reminder before it?"), and dropping it
// when the owner ends the conversation instead ("no thanks", "that's all": lib/commands)
export const pending = () => Boolean(pendingReminder || pendingImportance || planner.hasPending());
export function clearPending() { pendingReminder = null; pendingImportance = null; if (planner.hasPending()) { planner.dropPending(); fitTitle = null; } }
const WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty five": 45, "half an": 0.5, "half a": 0.5 };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const say = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "p.m." : "a.m."}`; };
let lastRemoved = null;

// "tomorrow", "friday", "on saturday", "today" → YYYY-MM-DD (the next such day)
function parseDay(q) {
  const today = store.todayISO();
  if (/\btomorrow\b/.test(q)) return store.addDays(today, 1);
  if (/\btoday\b|\btonight\b/.test(q)) return today;
  const m = new RegExp(`\\b(?:on |next )?(${DAYS.join("|")})\\b`).exec(q);
  if (m) {
    const want = DAYS.indexOf(m[1]), [y, mo, d] = today.split("-").map(Number);
    const now = new Date(y, mo - 1, d).getDay();
    return store.addDays(today, ((want - now + 7) % 7) || 7);
  }
  return null;
}
// "7", "7 pm", "7:30pm", "19:00", "noon", "midnight" → "HH:MM" (a bare evening-ish hour means p.m.)
function parseTime(s) {
  const q = String(s).trim().toLowerCase().replace(/\./g, "");
  if (/\bnoon\b/.test(q)) return "12:00";
  if (/\bmidnight\b/.test(q)) return "23:59";
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?\b/.exec(q);
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2] ?? 0); const ap = m[3]?.replace(" ", "");
  if (h > 23 || mi > 59) return null;
  if (ap === "pm" && h < 12) h += 12; else if (ap === "am" && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 7) h += 12;                  // "at 7" means 7 p.m.
  return toHM(h * 60 + mi);
}
function parseDuration(q) {
  const m = /\bfor (\d+(?:\.\d+)?|an?|half an?) (hour|hours|minute|minutes|min|mins)\b/.exec(q);
  if (!m) return null;
  const n = /^\d/.test(m[1]) ? Number(m[1]) : /half/.test(m[1]) ? 0.5 : 1;
  return Math.round(/hour/.test(m[2]) ? n * 60 : n);
}
function guessCategory(title) {
  const t = title.toLowerCase();
  if (/gym|workout|run|lift|walk|exercise|practice|game|sport|swim|bike|yoga/.test(t)) return "body";
  if (/study|exam|lesson|read|course|homework|class|learn/.test(t)) return "study";
  if (/church|bible|pray|worship|devotion/.test(t)) return "faith";
  if (/breakfast|lunch|dinner|eat|meal/.test(t)) return "meal";
  if (/work|meeting|call|client/.test(t)) return "work";
  if (/clean|laundry|dishes|chore|errand|haircut|shop/.test(t)) return "home";
  if (/game|movie|nap|rest|relax/.test(t)) return "rest";
  return "flex";
}
// Find a block by words from its title, preferring the given date, then today, then the next week.
function findBlock(words, date) {
  const w = words.toLowerCase().replace(/\b(the|my|a|an)\b/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  const today = store.todayISO();
  const days = date ? [date] : [today, ...Array.from({ length: 7 }, (_, i) => store.addDays(today, i + 1))];
  const nowHM = new Date().toTimeString().slice(0, 5);
  for (const d of days) {
    // closest title first: exactly the words, then starting with them, then containing them all
    const phrase = w.join(" ");
    const rank = (b) => { const t = b.title.toLowerCase(); return t === phrase ? 0 : t.startsWith(phrase) ? 1 : t.startsWith(w[0]) ? 2 : 3; };
    const hits = store.blocksBetween(d, d).filter((b) => w.every((x) => b.title.toLowerCase().includes(x))).sort((a, b) => rank(a) - rank(b));
    if (hits.length) return hits.find((b) => rank(b) === rank(hits[0]) && (d !== today || b.end > nowHM)) ?? hits[0];
  }
  return null;
}
const dayName = (d) => { const [y, m, dd] = d.split("-").map(Number); const t = store.todayISO(); return d === t ? "today" : d === store.addDays(t, 1) ? "tomorrow" : new Date(y, m - 1, dd).toLocaleDateString("en-US", { weekday: "long" }); };

export function handle(text) {
  const r = handleRaw(text);
  return r && r.replace(/\.{2,}/g, ".");
}
const ADD_RE = /^(?:add|schedule|put|book)\s+(.+?)\s+(?:(on |next )?(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+)?(?:at|from)\s+([\d: ]+(?:\s*[ap]\.?\s?m\.?)?|noon|midnight)(?:\s+(?:to|until)\s+([\d: ]+(?:\s*[ap]\.?\s?m\.?)?))?(.*)$/;
function handleRaw(text) {
  const q = String(text).toLowerCase().replace(/[?!]/g, "").replace(/\.$/, "").trim();
  let m;

  // "How important is it?" is waiting for an answer
  if (pendingImportance) {
    const lvl = importanceFrom(q);
    if (lvl !== null) {
      const id = pendingImportance; pendingImportance = null;
      store.updateBlock(id, { importance: lvl });
      pendingReminder = id;
      return lvl === 3 ? "Got it, marked as major. It'll stand out on your week, month and year. Want a reminder before it? I'd suggest the night before."
        : lvl === 2 ? "Got it, marked important. It'll stand out on your week. Want a reminder before it?"
        : lvl === 1 ? "Okay, marked notable. Want a reminder before it?" : "Okay, a normal one. Want a reminder before it?";
    }
    if (/^(skip|never ?mind|doesn'?t matter)\b/.test(q)) { pendingReminder = pendingImportance; pendingImportance = null; return "Okay. Want a reminder before it?"; }
  }
  // "add … every day / weekdays / every monday and wednesday / the first monday of every month …": a repeating item
  const rp = /^(?:add|schedule|put|book)\b/.test(q) ? recur.parse(q) : null;
  if (rp && (m = ADD_RE.exec(rp.rest))) {
    const title = cap(m[1].replace(/\b(to my schedule|on my calendar)\b/, "").replace(/\s+for (\d+(\.\d+)?|an?|half an?) (hour|hours|minute|minutes|min|mins)\b/, "").trim());
    const date = parseDay(`${m[3] ?? ""} ${m[6] ?? ""}`) ?? store.todayISO();
    const start = parseTime(m[4]);
    if (!start) return null;
    const end = m[5] ? parseTime(m[5]) : toHM(Math.min(toMin(start) + (parseDuration(q) ?? 30), 23 * 60 + 59));
    if (!end || end <= start) return `I couldn't work out when ${title} ends.`;
    const r = store.addRoutine({ title, start, end, category: guessCategory(title), repeat: { ...rp.repeat, start: date } });
    return `Added ${r.title}, ${r.repeatText.replace(/^./, (c) => c.toLowerCase())} at ${say(start)}.`;
  }
  // "make that major", "mark it important", "mark the meeting with Rich as major", "make lunch normal"
  {
    const mk = /^(?:make|mark|set|flag)\s+(.+?)\s+(?:as\s+)?(?:a\s+)?(major|important|notable|normal)(?:\s+(?:one|event|thing))?$/.exec(q);
    if (mk) {
      const lvl = IMP_WORDS.indexOf(mk[2]);
      let b = null;
      if (/^(that|it|this)$/.test(mk[1]) && lastAdded) b = store.all().blocks.find((x) => x.id === lastAdded);
      else { const hits = store.findBlocks(mk[1].replace(/^(the|my)\s+/, ""), store.todayISO(), store.addDays(store.todayISO(), 120)); b = hits[0] ?? null; }
      if (b) { store.updateBlock(b.id, { importance: lvl }); return `Done. ${b.title} is now ${mk[2]}.`; }
    }
  }
  // "Want a reminder before it?" is waiting for an answer
  if (pendingReminder) {
    const blockId = pendingReminder;
    const amount = /\b(\d+|an?|one|two|three|five|ten|fifteen|twenty|thirty|forty[- ]five|half an?)\s*(minutes?|mins?|hours?|hrs?)\b/.exec(q);
    if (/\b(night|day|evening) before\b/.test(q)) { pendingReminder = null; const r = reminders.beforeBlock(blockId, { nightBefore: true }); return `Okay, I'll remind you the night before, at ${say(r.time)}.`; }
    if (amount) {
      pendingReminder = null;
      const n = WORDNUM[amount[1].replace(/-/g, " ")] ?? (/^\d+$/.test(amount[1]) ? Number(amount[1]) : /half/.test(amount[1]) ? 0.5 : 1);
      const mins = Math.round(/^h/.test(amount[2]) ? n * 60 : n);
      reminders.beforeBlock(blockId, { minutes: mins });
      return `Got it. I'll remind you ${mins >= 60 ? (mins === 60 ? "an hour" : `${mins / 60} hours`) : `${mins} minutes`} before.`;
    }
    if (/^(yes|yeah|yep|sure|please|ok|okay|that'?d be great)\b/.test(q)) { pendingReminder = null; reminders.beforeBlock(blockId, { minutes: 30 }); return "Okay, I'll remind you 30 minutes before."; }
    if (/^(no|nah|nope|don'?t|i'?m good|no thanks|not needed)\b/.test(q)) { pendingReminder = null; return "Okay, no reminder."; }
  }

  // "remind me to call Tommy tomorrow at noon", "remind me in 20 minutes to check the laundry",
  // "remind me tomorrow to take the trash out" (no time: it comes up in the morning rundown)
  if (/^(can you |please |hey )?remind me\b/.test(q)) {
    const body = q.replace(/^(can you |please |hey )?remind me\s*/, "");
    let r;
    const inM = /\bin (\d+|an?|half an?|one|two|five|ten|fifteen|twenty|thirty)\s*(minutes?|mins?|hours?)\b/.exec(body);
    let what = body.replace(/\bin (\d+|an?|half an?|one|two|five|ten|fifteen|twenty|thirty)\s*(minutes?|mins?|hours?)\b/, "")
      .replace(/\b(on |this |next )?(today|tonight|tomorrow( morning| evening| night)?|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/, "")
      .replace(/\b(at|around) ([\d: ]+(\s*[ap]\.?\s?m\.?)?|noon)\b/, "").replace(/^\s*(to|about|that)\s+/, "").replace(/\s+/g, " ").trim();
    if (!what) return "What should I remind you about?";
    // keep their capitals ("call Tommy"): find the same words in what they actually said
    const orig = String(text).replace(/\s+/g, " ").trim(), at0 = orig.toLowerCase().indexOf(what);
    if (at0 >= 0) what = orig.substr(at0, what.length);
    if (inM) {
      const n = WORDNUM[inM[1]] ?? (/^\d+$/.test(inM[1]) ? Number(inM[1]) : /half/.test(inM[1]) ? 0.5 : 1);
      const at = new Date(Date.now() + Math.round(/hour/.test(inM[2]) ? n * 60 : n) * 60_000);
      r = reminders.add({ date: store.todayISO(at), time: toHM(at.getHours() * 60 + at.getMinutes()), text: what });
      return `Okay, I'll remind you to ${what} at ${say(r.time)}.`;
    }
    const tM = /\b(?:at|around) ([\d: ]+(?:\s*[ap]\.?\s?m\.?)?|noon)\b/.exec(body);
    let time = tM ? parseTime(tM[1]) : /\btonight\b/.test(body) ? "19:00" : /\b(tomorrow )?evening\b/.test(body) ? "18:00" : null;
    // "at 7:30" with no a.m./p.m. and no day: whichever 7:30 comes next (not 7:30 p.m. when it's 6 a.m.)
    const nowHM = new Date().toTimeString().slice(0, 5), said = parseDay(body);
    if (tM && !said && !/[ap]\.?\s?m|noon/.test(tM[1]) && /\bat\b/.test(tM[0]) && !/\b(tonight|evening|night|afternoon|morning)\b/.test(body)) {
      const [h, mi] = time.split(":").map(Number), am = toHM((h % 12) * 60 + mi), pm = toHM(((h % 12) + 12) * 60 + mi);
      time = [am, pm].filter((t) => t > nowHM).sort()[0] ?? am;
    }
    // a time that's already gone today means tomorrow (it would otherwise go off right away)
    const date = said ?? (time && time <= nowHM ? store.addDays(store.todayISO(), 1) : store.todayISO());
    r = reminders.add({ date, time, text: what });
    return time ? `Okay, ${dayName(date)} at ${say(time)} I'll remind you to ${what}.` : `Okay, I'll bring it up in ${dayName(date) === "today" ? "today's" : dayName(date) + "'s"} rundown: ${what}.`;
  }
  if (/^(what are my|list my|any) reminders\b|^what reminders\b/.test(q)) {
    const up = reminders.upcoming(6);
    const one = (r) => r.blockId ? `${r.text}, with a reminder ${dayName(r.date)} at ${say(r.time)}` : r.time ? `${r.text}, ${dayName(r.date)} at ${say(r.time)}` : `${r.text}, in ${dayName(r.date) === "today" ? "today's" : dayName(r.date) + "'s"} rundown`;
    return up.length ? `You have ${up.length} coming up: ${up.map(one).join("; ")}.` : "You don't have any reminders set.";
  }
  if ((m = /^(?:cancel|delete|remove) (?:the |my )?reminder (?:about |for |to )?(.+)$/.exec(q))) {
    try { const r = reminders.cancel(m[1]); return `Okay, I cancelled the reminder: ${r.text}.`; } catch { return `I couldn't find a reminder about ${m[1]}.`; }
  }

  // the day's rundown, whenever they ask
  if (/\b(rundown|what'?s my day (look like|looking like)|how does my day look|what do i have today|brief me)\b/.test(q)) return "__RUNDOWN__";   // the assistant fills it in (it's async)

  // recall past conversations: "what did we talk about with curves", "what did I say about work last week"
  if ((m = /\b(?:what did (?:we|i|you) (?:talk|say|discuss|decide)|do you remember|remind me what we said|recall|what was that conversation)(?: about| on| regarding| with)? (.+)$/.exec(q))) {
    const topic = m[1].replace(/\b(last week|yesterday|today|the other day|recently|earlier)\b/g, "").trim();
    const from = /\blast week\b/.test(q) ? store.addDays(store.todayISO(), -7) : /\byesterday\b/.test(q) ? store.addDays(store.todayISO(), -1) : undefined;
    const hits = transcripts.search(topic, { from });
    if (!hits.length) return `I don't have a conversation about ${topic} saved yet.`;
    const h = hits[0];
    const ex = h.exchanges?.[0] ?? [];
    const when = new Date(ex[0]?.at ?? h.at ?? h.start);
    const whenSay = `${dayName(h.date)} at ${say(`${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`)}`;
    const me = ex.find((x) => x.who === "Dayspring"), you = ex.find((x) => x.who !== "Dayspring");
    const clip = (t) => (t.length > 170 ? t.slice(0, 167).replace(/\s+\S*$/, "") + "…" : t);
    const quoted = (t) => { const c = clip(t); return /[.!?…]$/.test(c) ? `"${c}"` : `"${c}."`; };
    return `${cap(whenSay)}${h.summary ? `, in a conversation about ${h.title ?? topic}. ${h.summary}` : ","}` + (you ? ` you said: ${quoted(you.text)}` : "") + (me ? ` And I said: ${quoted(me.text)}` : "") + (hits.length > 1 || (h.exchanges?.length ?? 0) > 1 ? " There's more on the History page." : "");
  }

  // a rearrangement is waiting for a yes
  if (planner.hasPending()) {
    if (/^(yes|yeah|yep|do it|sure|sounds good|go ahead|ok|okay|please|let'?s do it|make it happen)\b/.test(q)) {
      const r = planner.apply({ title: fitTitle, category: guessCategory(fitTitle) });
      fitTitle = null;
      return `Done. ${r.added.title} is on ${dayName(r.added.date)} at ${say(r.added.start)}` + (r.moved.length ? `, and I moved ${r.moved.map((mv) => `${mv.title} to ${mv.to.date === r.added.date ? "" : dayName(mv.to.date) + " at "}${say(mv.to.start)}`).join(", ")}.` : ".") + afterAdd(r.added);
    }
    if (/^(no|nah|nope|never ?mind|cancel|don'?t|leave it)\b/.test(q)) { planner.dropPending(); fitTitle = null; return "Okay, I left everything as it is."; }
  }

  // "change of plans, I need to do laundry next" / "I have to take a call now for 20 minutes"
  if ((m = /(?:change of plans\W*)?\bi (?:need|have|got|gotta) to (.+?) (?:next|now|right now|first|instead)(?: for (\d+) (minutes?|mins?|hours?))?$/.exec(q))) {
    const mins = m[2] ? Number(m[2]) * (/hour/.test(m[3]) ? 60 : 1) : 30;
    const title = cap(m[1].replace(/^(go |do )/, ""));
    const r = planner.doNow({ title, minutes: mins, category: guessCategory(title) });
    if (r.blockedBy) { fitTitle = title; return `You're in ${r.blockedBy.title} until ${say(r.blockedBy.end)}, and that one doesn't move. Want me to put ${title.toLowerCase()} right after, at ${say(r.suggestion)}?`; }
    return `Got it, change of plans. ${r.added.title} is on now until ${say(r.added.end)}` + (r.stopped ? `. I've wrapped up ${r.stopped} here` : "") + (r.pushed.length ? `, and pushed ${r.pushed.slice(0, 3).map((b) => `${b.title} to ${say(b.start)}`).join(", ")}${r.pushed.length > 3 ? " and the rest" : ""} back.` : ".");
  }

  // "do I have anything going on Saturday at 3" / "I need to schedule a dentist appointment Friday at 2 for an hour, can we move things around"
  const fitM = /\b(?:schedule|fit in|squeeze in|book|set up|make time for|need time for)\s+(.+?)\s+(?:on |for |this |next )?(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)?\s*(?:at|around|from)\s+([\d: ]+(?:\s*[ap]\.?\s?m\.?)?|noon)(?:\s+(?:to|until)\s+([\d: ]+(?:\s*[ap]\.?\s?m\.?)?))?/.exec(q)
    || /\b(?:do i have|is there) (?:anything|something)(?: going on| scheduled| planned)?\s+(?:on |this |next )?(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)?\s*(?:at|around)\s+([\d: ]+(?:\s*[ap]\.?\s?m\.?)?|noon)/.exec(q);
  if (fitM) {
    const asked = fitM.length > 4;                       // the first pattern names the thing
    const what = asked ? fitM[1].replace(/^(something|a thing)$/, "").trim() : "";
    const dayW = asked ? fitM[2] : fitM[1], timeW = asked ? fitM[3] : fitM[2], endW = asked ? fitM[4] : null;
    const date = parseDay(dayW ?? q) ?? store.todayISO();
    const start = parseTime(timeW);
    if (!start) return null;
    const dur = parseDuration(q) ?? 60;
    const end = endW ? parseTime(endW) : toHM(Math.min(toMin(start) + dur, 23 * 60 + 59));
    fitTitle = what ? cap(what.replace(/^(a|an|my)\s+/, "")) : "New appointment";
    const f = planner.fit({ date, start, end, title: fitTitle });
    const when = `${dayName(date)} at ${say(start)}`;
    if (f.free) { return `You're free ${when}. Want me to put ${fitTitle.toLowerCase() === "new appointment" ? "it" : fitTitle} on the schedule?`; }
    const busy = f.inTheWay.map((b) => `${b.title} (${say(b.start)} to ${say(b.end)})`).join(", ");
    if (!f.workable) {
      planner.dropPending();
      const fixedNames = f.fixed.map((b) => b.title).join(" and ");
      return `${cap(when)} you have ${busy}. ${fixedNames ? `${fixedNames} can't move, so that time doesn't work.` : "I couldn't find another spot this week for everything."} Want to try a different time?`;
    }
    const plan = f.moves.map((mv) => `move ${mv.title} to ${mv.to.date === date ? say(mv.to.start) : `${dayName(mv.to.date)} at ${say(mv.to.start)}`}`);
    const freeBit = f.freeTimeUsed.length ? `use some of your ${f.freeTimeUsed.join(" and ").toLowerCase()}` : "";
    const steps = [freeBit, ...plan].filter(Boolean);
    return `${cap(when)} you have ${busy}. I can ${steps.join(", and ")}, so everything still gets done. Want me to do that?`;
  }

  // what's on …
  if ((m = /^(?:what(?:'s| is) (?:on|my schedule|the plan|planned)|what do i have)(.*)$/.exec(q))) {
    const d = parseDay(m[1]) ?? store.todayISO();
    const nowHM = new Date().toTimeString().slice(0, 5);
    const list = store.blocksBetween(d, d).filter((b) => d !== store.todayISO() || b.end > nowHM);
    if (!list.length) return `Nothing is scheduled ${dayName(d)}.`;
    const top = list.slice(0, 7).map((b) => `${b.title} at ${say(b.start)}`).join(", ");
    return `${cap(dayName(d))}: ${top}${list.length > 7 ? `, and ${list.length - 7} more` : ""}.`;
  }

  // undo the last removal
  if (/^undo( that)?$/.test(q) && lastRemoved) {
    const b = lastRemoved; lastRemoved = null;
    store.addBlock({ ...b, source: "manual" });
    return `Put ${b.title} back.`;
  }

  // add … every day / every other day / weekdays / every monday and wednesday / the 1st of every month … (repeating)
  if ((m = ADD_RE.exec(q))) {
    const title = m[1].replace(/\b(to my schedule|on my calendar)\b/, "")
      .replace(/\s+for (\d+(\.\d+)?|an?|half an?) (hour|hours|minute|minutes|min|mins)\b/, "").trim();
    const date = parseDay(`${m[3] ?? ""} ${m[6] ?? ""}`) ?? store.todayISO();
    const start = parseTime(m[4]);
    if (!start) return null;
    const dur = parseDuration(q) ?? 30;
    const end = m[5] ? parseTime(m[5]) : toHM(Math.min(toMin(start) + dur, 23 * 60 + 59));
    if (!end || end <= start) return `I couldn't work out when ${title} ends.`;
    const r = store.addBlock({ date, start, end, title: cap(title), category: guessCategory(title), source: "manual" });
    return `Added ${r.block.title}, ${dayName(date)} at ${say(start)}.` + (r.conflicts.length ? ` Heads up: it overlaps ${r.conflicts.map((c) => c.title).join(" and ")}. Say "can we move things around" and I'll sort it out.` : "") + afterAdd(r.block);
  }

  // move X to [day] [at] time / move X to tomorrow
  if ((m = /^(?:move|reschedule|shift)\s+(.+?)\s+to\s+(.+)$/.exec(q))) {
    const target = m[2];
    const date = parseDay(target);
    const b = findBlock(m[1]);
    if (!b) return `I couldn't find ${m[1]} on the schedule.`;
    const time = parseTime(target.replace(/\b(today|tonight|tomorrow|on|next|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, ""));
    const dur = toMin(b.end) - toMin(b.start);
    const start = time ?? b.start;
    const r = store.updateBlock(b.id, { date: date ?? b.date, start, end: toHM(Math.min(toMin(start) + dur, 23 * 60 + 59)) });
    return `Moved ${b.title} to ${dayName(r.block.date)} at ${say(r.block.start)}.` + (r.conflicts.length ? ` It now overlaps ${r.conflicts.map((c) => c.title).join(" and ")}.` : "");
  }

  // push X back N minutes
  if ((m = /^(?:push|bump|delay)\s+(.+?)\s+(?:back|later)?\s*(?:by\s+)?(\d+|an?|half an?)\s*(minutes?|mins?|hours?)$/.exec(q))) {
    const b = findBlock(m[1].replace(/\b(back|later)\b/, ""));
    if (!b) return `I couldn't find ${m[1]} on the schedule.`;
    const n = /^\d/.test(m[2]) ? Number(m[2]) : /half/.test(m[2]) ? 0.5 : 1;
    const by = Math.round(/hour/.test(m[3]) ? n * 60 : n);
    const r = store.updateBlock(b.id, { start: toHM(toMin(b.start) + by), end: toHM(Math.min(toMin(b.end) + by, 23 * 60 + 59)) });
    return `Pushed ${b.title} to ${say(r.block.start)}.` + (r.conflicts.length ? ` It overlaps ${r.conflicts.map((c) => c.title).join(" and ")}.` : "");
  }

  // micro-habits first: "done with the dishes", "I just started a load of laundry", "moved it to the dryer",
  // "folded some laundry", "practiced guitar", "did my Spanish", "reviewed my verses"
  const HABIT = /\b(dish(es)?|kitchen|laundry|washer|dryer|fold(ed)?|spanish|scripture|verses?|memory|instrument|guitar|piano|trash|vacuum(ed)?|bed|tidy|tidied|bathroom)\b/;
  if (HABIT.test(q) && /\b(done|finished|did|started|put|moved|switched|folded|practiced|practised|reviewed|made|took|vacuumed|tidied|washed|cleaned|just)\b/.test(q)) {
    try {
      const r = chores.markDone(/\b(moved|switched)\b.*\b(dryer)\b/.test(q) || /\bdryer\b/.test(q) ? "dryer" : q);
      return `Nice${r.kind === "habit" ? " work" : ""}! ${r.done} is checked off.${r.next ? " " + r.next : ""}`;
    } catch { /* not a habit after all */ }
  }
  // done
  if ((m = /^(?:mark|check off)\s+(.+?)\s+(?:as\s+)?(?:done|complete|finished)$/.exec(q)) || (m = /^(?:i (?:finished|did|completed)|done with|finished)\s+(.+)$/.exec(q))) {
    const b = findBlock(m[1], store.todayISO()) ?? findBlock(m[1]);
    if (!b) return null;                     // maybe it's a chore; let the caller try that
    const done = store.setDone(b.id, true);
    const n = learning.onBlockDone(done);
    return `Nice work. ${b.title} is checked off${n ? ", and so is its study item" : ""}.`;
  }

  // remove
  if ((m = /^(?:remove|delete|cancel|clear)\s+(.+?)(?:\s+from (?:my|the) (?:schedule|calendar))?$/.exec(q))) {
    const date = parseDay(m[1]);
    const b = findBlock(m[1].replace(/\b(today|tonight|tomorrow|on|next|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, "").trim(), date);
    if (!b) return `I couldn't find ${m[1]} on the schedule.`;
    lastRemoved = store.removeBlock(b.id);
    return `Removed ${b.title} from ${dayName(b.date)}. Say "undo" to put it back.`;
  }
  return null;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
