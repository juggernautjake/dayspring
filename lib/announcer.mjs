// Schedule-triggered speech for the TV. At each block boundary the assistant speaks once:
//   - a block of real effort (study, workout, the workday) just ended  → a check-in: "time's up —
//     how did it go?", then what's next, and it waits for the owner to say they're good to move on;
//   - a block starts → what it is and, for study, exactly what to cover;
//   - the day's first block → the alarm, which keeps ringing on the TV until they answer.
// Lines are written by the model (curated, warm, short); a plain line is used if it can't be reached.
import * as store from "./store.mjs";
import * as llm from "./llm.mjs";
import * as owner from "./owner.mjs";
import * as learning from "./learning.mjs";
import * as goals from "./goals.mjs";
import * as chores from "./chores.mjs";
import * as settings from "./settings.mjs";
import * as session from "./session.mjs";
import * as morning from "./morning.mjs";
import * as reminders from "./reminders.mjs";
import * as media from "./media.mjs";
import * as voice from "./voice.mjs";
import { phrase, habitNudge, PERSONALITY } from "./phrases.mjs";
import * as profile from "./profile.mjs";
import * as devlog from "./devlog.mjs";
import * as churchtalk from "./churchtalk.mjs";
import * as special from "./special.mjs";
const personAsk = { date: null, count: 0, last: 0 };

const clients = new Set();
const done = new Set();              // "date|minute" boundaries already spoken
const log = [];
let lastDate = store.todayISO();
let goalRemindedOn = null;
let onEvent = () => {};              // server hook: puts each spoken event into the TV conversation
export function setEventHook(fn) { onEvent = fn; }

export function addClient(res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`event: hello\ndata: ${JSON.stringify({ recent: log.slice(-3) })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  res.on("close", () => { clearInterval(ping); clients.delete(res); });
}
export function clientCount() { return clients.size; }
export function recent() { return log.slice(-20); }
export function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}

const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hmOf = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const spokenTime = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "p.m." : "a.m."}`; };

// Blocks worth asking about when they end.
const wantsCheckin = (b) => !b.done && (b.category === "study" || b.category === "body" || b.title === "Work (afternoon)");

// What happens at minute `min` of `date`.
export function boundaryAt(date, min) {
  const day = store.blocksBetween(date, date);
  const hm = hmOf(min);
  const ended = day.find((b) => b.end === hm && wantsCheckin(b)) ?? null;
  const started = day.find((b) => b.start === hm && !b.done) ?? null;
  const first = day.find((b) => !b.done) ?? null;
  const alarm = Boolean(started && first && first.id === started.id && toMin(started.start) < 12 * 60);
  const after = started ? day.find((b) => b.start >= started.end && b.id !== started.id) ?? null : day.find((b) => toMin(b.start) > min) ?? null;
  // a gap: something ends here, nothing starts, and there are at least 10 minutes before the next thing
  let buffer = null;
  const endsHere = day.find((b) => b.end === hm);
  if (endsHere && !started) {
    const next = day.find((b) => toMin(b.start) > min);
    const gap = next ? toMin(next.start) - min : 24 * 60 - min;
    if (gap >= 10 && next) buffer = { minutes: gap, next };
  }
  // the end of the morning's quiet time with God, while the morning is still open
  const qb = morning.quietBlock(date);
  const readyCheck = Boolean(qb && qb.end === hm && morning.current()?.date === date);
  return { date, hm, ended, started, alarm, after, buffer, readyCheck };
}

function template(ev) {
  // A check-in opens the between-blocks conversation:
  // "Hey Sam, that's it for studying for now. Next up is the gym at 8 p.m. How did studying go? Learn anything interesting?"
  if (ev.ended) {
    const nxt = ev.started ?? ev.after;
    const parts = [phrase("checkinOpen", { activity: session.activity(ev.ended) })];
    if (nxt) parts.push(phrase("nextUp", { next: nxt.title.replace(/ — session \d/, "").replace(/&/g, "and"), time: spokenTime(nxt.start) }));
    if (ev.chore) parts.push(habitNudge(ev.chore));
    parts.push(session.howQuestion(ev.ended));
    return parts.join(" ").replace(/\s+/g, " ").replace(/\.{2,}/g, ".").trim();
  }
  if (ev.buffer && !ev.started) {
    const task = ev.chore ? `${ev.chore.text.toLowerCase()}${ev.chore.extra ? `, ${ev.chore.extra}` : ""}` : "";
    const nextName = ev.buffer.next.title.replace(/ — session \d/, "").replace(/&/g, "and");
    const line = habitNudge(ev.chore, { key: "buffer", vars: { mins: ev.buffer.minutes, next: nextName } });
    // a bit doesn't mention the window, so say it first
    return /minutes? (before|until)/.test(line) ? line : `You've got ${ev.buffer.minutes} minutes before ${nextName}. ${line}`;
  }
  const parts = [];
  if (ev.alarm) parts.push(`Good morning, ${owner.name()}. It's ${spokenTime(ev.hm)}.`);
  if (ev.ended) parts.push(`Time's up on ${/^(gym|workout|lunch|dinner|breakfast)$/i.test(ev.ended.title) ? "the " + ev.ended.title.toLowerCase() : ev.ended.title}. How did it go?`);
  if (ev.started) {
    const lead = ev.ended ? "When you're ready, next is" : ev.alarm ? "Time for" : `It's ${spokenTime(ev.hm)}. Time for`;
    parts.push(`${lead} ${ev.started.title}.`);
    if (ev.started.category === "study" && ev.started.description) {
      // "Course site → Learn → Module 2: Measuring. Linear…" → "Today: Module 2, Measuring."
      const what = ev.started.description.replace(/^.*→\s*/, "")
        .split(/(?<=\.)\s/)[0].replace(/:\s*/, ", ").replace(/\s*\(\d+ min\)/, "");
      parts.push(`${Number(ev.hm.slice(0, 2)) >= 17 ? "Tonight" : "Today"}: ${what}`);
    }
  } else if (ev.ended && ev.after) parts.push(`Next up is ${ev.after.title} at ${spokenTime(ev.after.start)}.`);
  if (ev.chore) parts.push(habitNudge(ev.chore));
  if (ev.goal) parts.push(`Remember what you're working toward: ${ev.goal.text}.`);
  return parts.join(" ").replace(/\s+/g, " ").replace(/\.{2,}/g, ".").trim();
}

// Who it is and who it's talking to come from the owner profile, at the moment it speaks.
const SYSTEM = () => {
  const n = owner.name(), their = owner.their(), them = owner.them(), exam = learning.progress().exam;
  return `You are ${owner.assistant()}, ${n}'s home assistant, speaking out loud through the TV in ${their} room at a moment in ${their} schedule.
Write exactly what you will say: two to four short spoken sentences. No markdown, lists or emoji. Say times naturally ("8 p.m.").
- If a block just ended, this opens a short conversation. Say it in this shape, in your own words:
  "Hey ${n}, that's it for <the activity, e.g. studying chemistry> for now. Next up is <next block> at <time>." Then, only
  if a chore is given, a quick casual chore nudge. Then END with a warm, specific question about how it went (for study:
  "How did studying go? Learn anything interesting?"; for a workout: "How was the workout?"). Do not assume how it went,
  and don't mention goals here.
- If a block is starting, name it, and for study blocks say exactly what to cover (the module or lesson). If a block just ended
  too, frame the new one as "when you're ready" — ${n} will tell you when it's time to move on.
- The first block of the day is the wake-up alarm: greet ${them}, tell ${them} the time, and get ${them} up for it, warm but firm.
- If a goal is given, weave in one short reminder of it and why it matters. Otherwise don't mention goals.
- If a micro-habit is given (a small chore, or language, scripture memory or instrument practice), suggest it casually as a
  quick thing for this window with its rough time ("while you're up, knock out the dishes, ten minutes"). Consistency in small
  bursts is the whole point; make it sound easy. Put it after the main message. Never nag.
${exam?.date ? `- Mention the ${exam.name || "exam"} countdown only when a study block for it starts, and only sometimes.\n` : ""}- Faith blocks: gentle and brief. Never invent details that are not given.
- ${PERSONALITY}
- Make every line fresh and a little creative. Never reuse the wording of your recent lines (listed below), and let ${their}
  interests and sense of humor show: a playful reference, a light tease, a metaphor from what ${n} enjoys, when it fits the moment.
  Faith moments stay sincere.`;
};

async function compose(ev) {
  const fallback = template(ev);
  if (!llm.ready()) return fallback;
  const p = learning.progress();
  const fmt = (b) => `${b.start}–${b.end} "${b.title}" (${b.category})${b.description ? ` — ${b.description}` : ""}`;
  const prompt = [
    `Now: ${ev.hm} on ${ev.date}.`,
    ev.ended ? `Just ended: ${fmt(ev.ended)}` : "",
    ev.started ? `Starting now: ${fmt(ev.started)}` : "",
    !ev.started && ev.after ? `Next later: ${fmt(ev.after)}` : "",
    ev.alarm ? "This is the first block of the day: the wake-up alarm." : "",
    ev.goal ? `Goal to remind ${owner.them()} of: ${ev.goal.text}${ev.goal.why ? ` (why: ${ev.goal.why})` : ""}` : "",
    ev.chore ? `Micro-habit to suggest: ${ev.chore.text}${ev.chore.extra ? ` (${ev.chore.extra})` : ""} (about ${ev.chore.minutes} minutes)` : "",
    ev.buffer && !ev.started ? `This is a gap in the schedule: ${ev.buffer.minutes} free minutes before ${ev.buffer.next.title} at ${ev.buffer.next.start}. Just point out the window and suggest the micro-habit in one or two sentences.` : "",
    `About ${owner.name()}:\n${owner.get().about ? owner.get().about + "\n" : ""}${profile.note()}`,
    log.length ? `Your recent lines (do not repeat their wording):\n${log.slice(-8).map((x) => "- " + x.text).join("\n")}` : "",
    p.exam?.date && p.exam.daysLeft >= 0 ? `${p.exam.name || "The exam"} in ${p.exam.daysLeft} days.` : "",
    Object.keys(p.courses).length ? "Progress: " + Object.values(p.courses).map((c) => `${c.title} ${c.done}/${c.total}${c.behind ? `, ${c.behind} behind` : ""}`).join("; ") : "",
  ].filter(Boolean).join("\n");
  try {
    const text = await llm.complete({ system: SYSTEM() + "\n- Style right now: " + voice.styleNote(), prompt, maxTokens: 260, timeoutMs: 20_000 });
    return text.trim() || fallback;
  } catch (e) {
    console.log(`announce: model unavailable (${String(e.message).slice(0, 80)}); plain line used`);
    return fallback;
  }
}

async function speakBoundary(ev, when = 0) {
  const key = `${ev.date}|${ev.hm}`;
  if (done.has(key)) return null;
  done.add(key);
  const prefsM = settings.get();
  // The morning: a wake song, then the greeting and time with God (instead of a plain alarm).
  if (ev.alarm && prefsM.alarm) return speakMorning(ev, when);
  // The end of morning quiet time: "are you ready to begin your day?"
  if (ev.readyCheck) return emit({ kind: "ready", date: ev.date, hm: ev.hm, text: morning.readyQ(), alarm: false, mode: prefsM.mode, speed: 0.92 }, when, () => { morning.setStage("ready"); readyAskedAt = Date.now(); readyAsks = 1; });
  // One goal reminder a day outside the alarm: before the first evening study block.
  const prefs = settings.get();
  if (prefs.goals && (ev.alarm || (!ev.ended && ev.started?.category === "study" && toMin(ev.started.start) >= 17 * 60 && goalRemindedOn !== ev.date))) {
    ev.goal = goals.pickToRemind();
    if (!ev.alarm) goalRemindedOn = ev.date;
  }
  // A small chore at a real transition: after a block of effort, or as a home, meal or free block begins.
  // Never at the alarm, never into study or work, and only between 7 a.m. and 9 p.m.
  const hour = Number(ev.hm.slice(0, 2));
  const intoFocus = ev.started && (ev.started.category === "study" || ev.started.category === "work" || ev.started.category === "faith");
  const transition = !ev.alarm && hour >= 7 && hour < 21 && !intoFocus && (ev.ended || ev.buffer || ["home", "meal", "flex"].includes(ev.started?.category));
  const room = ev.buffer && !ev.started ? Math.min(15, ev.buffer.minutes - 2) : ev.started && ["flex", "home"].includes(ev.started.category) ? 15 : 10;
  if (transition && prefs.chores) ev.chore = chores.pick(room, new Date(), { extra: morning.today(ev.date).memoryRef });
  // a gap with nothing worth suggesting stays quiet
  if (ev.buffer && !ev.started && !ev.ended && !ev.chore) return null;
  const text = await compose(ev);
  const kind = ev.alarm && prefs.alarm ? "alarm" : ev.ended ? "checkin" : ev.started ? "start" : "buffer";
  if (ev.alarm && !prefs.alarm) ev.alarm = false;
  const item = { at: new Date().toISOString(), kind, date: ev.date, hm: ev.hm, text, alarm: ev.alarm, mode: prefs.mode,
    chore: ev.chore ?? null,
    ended: ev.ended && { id: ev.ended.id, title: ev.ended.title }, started: ev.started && { id: ev.started.id, title: ev.started.title, start: ev.started.start, end: ev.started.end, category: ev.started.category } };
  const fire = () => {
    log.push(item); if (log.length > 50) log.shift();
    onEvent(item);
    broadcast("announce", item);
    console.log(`announce (${kind}) ${ev.hm}: ${item.ended?.title ?? ""}${item.ended && item.started ? " → " : ""}${item.started?.title ?? ""}`);
  };
  if (when > Date.now()) setTimeout(fire, when - Date.now()); else fire();
  return item;
}

function emit(item, when = 0, then = null) {
  item.at = new Date().toISOString();
  const fire = () => {
    log.push(item); if (log.length > 50) log.shift();
    if (then) then();
    onEvent(item);
    broadcast("announce", item);
    devlog.log("announce", { kind: item.kind, hm: item.hm ?? null, text: item.text, clients: clients.size });
    console.log(`announce (${item.kind}) ${item.hm ?? ""}: ${item.text.slice(0, 70)}`);
  };
  if (when > Date.now()) setTimeout(fire, when - Date.now()); else fire();
  return item;
}

// Wake song + greeting + time with God. The TV plays the song, waits ~30 s, then speaks each part slowly.
async function speakMorning(ev, when) {
  // The TV asks for the music when the alarm goes off (POST /api/morning/music): Spotify first, YouTube if not.
  // Then: 20 s of music → it dips → greeting and a good-day wish → back up → a full minute → it fades → time with God.
  const script = morning.wakeScript(ev.date);
  const s = script.song;
  const song = s ? { title: typeof s === "string" ? s : `${s.title}${s.artist ? " by " + s.artist : ""}` } : null;
  const text = [script.greeting, script.wish, ...script.segments].join(" ");
  return emit({ kind: "morning", alarm: true, date: ev.date, hm: ev.hm, text, greeting: script.greeting, wish: script.wish, segments: script.segments, segmentTitle: script.segmentTitle,
    song, lead: script.timing.lead, hold: script.timing.hold, speed: 0.9,
    started: ev.started && { id: ev.started.id, title: ev.started.title, start: ev.started.start, end: ev.started.end, category: ev.started.category } },
    when, () => morning.begin(ev.date));
}

let readyAskedAt = 0, readyAsks = 0;
// Every minute: prepare the next minute's boundary a minute early so the voice lands on time.
export async function tick() {
  const now = new Date();
  const today = store.todayISO(now);
  if (today !== lastDate) { done.clear(); lastDate = today; }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // reminders due this minute: spoken on both outputs
  for (const r of reminders.dueAt(today, hmOf(nowMin))) {
    emit({ kind: "reminder", date: today, hm: hmOf(nowMin), text: reminders.spokenText(r), alarm: false, mode: settings.get().mode, reminder: { id: r.id, text: r.text } });
  }
  // church: an offer to get ready before a service, or to talk it through after (once each; never in study or work time)
  {
    const cur = store.blocksBetween(today, today).find((b) => b.start <= hmOf(nowMin) && hmOf(nowMin) < b.end);
    if (!cur || !["study", "work"].includes(cur.category)) {
      const off = settings.get().mode === "voice" ? churchtalk.offerNow(now) : null;
      if (off) emit({ kind: "church", date: today, hm: hmOf(nowMin), text: off.text, alarm: false, mode: settings.get().mode, passage: off.passage, church: off.kind });
    }
  }
  // people: now and then, a question about someone the owner prays for ("How's Jordan doing lately?"), twice a day at most,
  // 3+ hours apart, only in relaxed moments; today's prayer list comes first, and those it knows least about
  {
    const cur = store.blocksBetween(today, today).find((b) => b.start <= hmOf(nowMin) && hmOf(nowMin) < b.end);
    const h = now.getHours();
    if (personAsk.date !== today) Object.assign(personAsk, { date: today, count: 0, last: 0 });
    const relaxed = !cur || ["flex", "home", "meal", "rest"].includes(cur.category);
    if (relaxed && h >= 10 && h < 21 && personAsk.count < 2 && Date.now() - personAsk.last > 3 * 3600_000 && settings.get().mode === "voice" && !special.pendingQuestion() && Math.random() < 1 / 40) {
      const prefer = (morning.today(today).prayerItems ?? []).flatMap((p) => p.people ?? []);
      const p = special.pickToAsk(prefer);
      if (p) {
        const qq = special.questionFor(p);
        special.markAsking(p, qq.topic);
        personAsk.count++; personAsk.last = Date.now();
        emit({ kind: "person", date: today, hm: hmOf(nowMin), text: qq.text, alarm: false, mode: settings.get().mode, person: p.name });
      }
    }
  }
  // the morning: a snooze that's up, or a ready question nobody answered
  const m = morning.current();
  if (m && m.stage === "ready") {
    if (m.snoozeUntil && Date.now() >= m.snoozeUntil) {
      m.snoozeUntil = null; readyAskedAt = Date.now(); readyAsks++;
      emit({ kind: "ready", date: today, hm: hmOf(nowMin), text: `Hey ${owner.name()}, checking back in. Are you ready to begin your day, or do you need a few more minutes?`, alarm: false, mode: settings.get().mode, speed: 0.92 });
    } else if (!m.snoozeUntil && readyAskedAt && Date.now() - readyAskedAt > 10 * 60_000) {
      readyAskedAt = Date.now();
      if (readyAsks >= 2) { morning.end(); emit({ kind: "rundown", date: today, hm: hmOf(nowMin), text: await morning.rundown(today), alarm: false, mode: settings.get().mode, speed: 0.95 }); }
      else { readyAsks++; emit({ kind: "ready", date: today, hm: hmOf(nowMin), text: morning.READY_Q, alarm: false, mode: settings.get().mode, speed: 0.92 }); }
    }
  }
  for (const [min, delay] of [[nowMin + 1, true], [nowMin, false]]) {
    if (min >= 24 * 60) continue;
    const ev = boundaryAt(today, min);
    if (!ev.ended && !ev.started && !ev.buffer && !ev.readyCheck) continue;
    const at = new Date(now); at.setHours(Math.floor(min / 60), min % 60, 0, 0);
    speakBoundary(ev, delay ? at.getTime() : 0).catch((e) => console.log(`announce failed: ${e.message}`));
  }
}

// "What's now?" from the TV button, and for testing any minute of any day.
export async function announceNow(date, hm) {
  const d = date ?? store.todayISO();
  const now = new Date();
  let min = hm ? toMin(hm) : now.getHours() * 60 + now.getMinutes();
  let ev = boundaryAt(d, min);
  if (!hm && !ev.started) {
    const day = store.blocksBetween(d, d);
    const cur = day.find((b) => toMin(b.start) <= min && min < toMin(b.end));
    ev = { date: d, hm: hmOf(min), ended: null, started: cur ?? null, alarm: false, after: cur ? day.find((b) => b.start >= cur.end) ?? null : day.find((b) => toMin(b.start) > min) ?? null };
    if (!cur && !ev.after) { const item = { at: now.toISOString(), kind: "start", text: "Nothing else is on the schedule today.", alarm: false }; broadcast("announce", item); return item; }
    if (!cur) ev.started = null;
  }
  done.delete(`${ev.date}|${ev.hm}`);
  return speakBoundary(ev);
}

// Something outside the schedule to say on the TV (a text from the owner's phone, …): same delivery as everything else.
export function announce(item) { return emit({ date: store.todayISO(), hm: new Date().toTimeString().slice(0, 5), alarm: false, mode: settings.get().mode, ...item }); }
