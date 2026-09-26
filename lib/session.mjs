// The between-blocks conversation. When a block of effort ends, the assistant opens a short conversation:
//   1. "Hey Sam, that's it for studying for now. Next up is … How did studying go? Learn anything interesting?"
//   2. The owner answers → it responds to what they said (encourage / comment), then "For your next scheduled task, you're going to …
//      How are you feeling about it? Need any motivation, an overview of what to expect, or tips on what to focus on?"
//   3. They talk a little → it winds down: "Alright, good talk, now let's get to it! Good luck, <nickname>!"
// At any point "I'm ready, don't want to talk" → "Sounds good!" and quiet. The AI runs this naturally when it's
// reachable; the scripted version below runs it when it isn't.
// The owner's own blocks can have their own wording, in data/activities.json:
//   { "activities": [{ "match": "regex on the title", "activity": "…", "how": "phrase key", "next": "… {first}", "do": "…" }] }
import * as store from "./store.mjs";
import * as learning from "./learning.mjs";
import * as goals from "./goals.mjs";
import { phrase } from "./phrases.mjs";
import * as owner from "./owner.mjs";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ACTIVITIES = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "activities.json");
let own = { at: 0, list: [] };
function ownFor(title) {
  if (Date.now() - own.at > 60_000) {
    try { own = { at: Date.now(), list: existsSync(ACTIVITIES) ? JSON.parse(readFileSync(ACTIVITIES, "utf8")).activities ?? [] : [] }; } catch { own = { at: Date.now(), list: [] }; }
  }
  return own.list.find((a) => { try { return new RegExp(a.match, "i").test(title); } catch { return false; } }) ?? null;
}
// "Course site → Learn → Module 2: Measuring. Linear…" → "Module 2: Measuring. Linear…"
const stripPath = (d) => String(d || "").replace(/^.*→\s*/, "");

const TTL = 20 * 60_000;
let s = null;   // { id, stage: "howdid" | "next" | "chat" | "closed", ended, next, turns, openedAt, mood }

const say = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "p.m." : "a.m."}`; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// "Spanish study" → "studying Spanish"; "Gym" → "the gym"
export function activity(b) {
  const t = b.title;
  const mine = ownFor(t);
  if (mine?.activity) return mine.activity;
  if (/^(.+) study$/i.test(t)) return "studying " + t.replace(/ study$/i, "");
  if (/light workout/i.test(t)) return "your morning workout";
  if (/^workout$/i.test(t)) return "your workout";
  if (/^gym$/i.test(t)) return "the gym";
  if (/^work \(afternoon\)$/i.test(t)) return "work today";
  if (/^work \(morning\)$/i.test(t)) return "this morning's work";
  return t.charAt(0).toLowerCase() + t.slice(1);
}
export function howQuestion(b) {
  const mine = ownFor(b.title);
  if (mine?.how) return phrase(mine.how);
  if (b.category === "study") return phrase("howStudy");
  if (b.category === "body") return phrase("howBody");
  if (b.category === "work") return phrase("howWork");
  return phrase("howOther");
}
// What the next block actually involves, in a spoken phrase.
// "Breakfast & prep for work" → "have breakfast and prep for work"; "Gym" → "hit the gym"
export function doPhrase(b) {
  const t = b.title.replace(/ — session \d/, "").replace(/&/g, "and");
  const low = t.charAt(0).toLowerCase() + t.slice(1);
  if (/^(breakfast|lunch|dinner)/i.test(t)) return "have " + low;
  if (/^gym$/i.test(t)) return "hit the gym";
  if (/^(workout|light workout)/i.test(t)) return "get your " + low.replace(/ — .*/, "") + " in";
  const mine = ownFor(b.title);
  if (mine?.do) return mine.do;
  if (/^(nightly|morning)/i.test(t)) return "have your " + low;
  if (/^church|bible study/i.test(t)) return "head to " + low;
  if (/^work \(/i.test(t)) return "get back to work";
  if (/^(free time|your time|open)/i.test(t)) return "have some " + (/free/i.test(t) ? "free time" : "time to yourself");
  if (/^game time/i.test(t)) return "play a game for a bit";
  return low;
}
export function nextWhat(b) {
  if (!b) return "nothing else on the schedule today";
  const d = stripPath(b.description);
  const first = d.split(/(?<=\.)\s/)[0].replace(/\s*\(\d+ min\)/, "").replace(/\.$/, "");
  if (b.category === "study" && first) {
    const mine = ownFor(b.title), on = first.replace(/:\s*/, ", ");
    return mine?.next ? mine.next.replace("{first}", on) : `${doPhrase(b)}, working on ${on}`;
  }
  return doPhrase(b);
}
function detailsOf(b) {
  const d = stripPath(b?.description);
  return d.split(/(?<=\.)\s/).slice(1, 3).join(" ").trim();
}

export function open(item) {
  const day = store.blocksBetween(item.date, item.date);
  const ended = day.find((b) => b.id === item.ended?.id) ?? null;
  const next = item.started ? day.find((b) => b.id === item.started.id) : day.find((b) => b.start >= (ended?.end ?? item.hm)) ?? null;
  s = { id: `${item.date}|${item.hm}`, stage: "howdid", ended, next, turns: 0, openedAt: Date.now(), mood: null };
  return s;
}
export function current() {
  if (s && (s.stage === "closed" || Date.now() - s.openedAt > TTL)) s = null;
  return s;
}
export function close(markDone = true) {
  if (!s) return;
  if (markDone && s.ended && !s.skipped) {
    try { const b = store.setDone(s.ended.id, true); learning.onBlockDone(b); } catch { /* block moved or gone */ }
  }
  s.stage = "closed";
  s = null;
}
export function setStage(stage) { if (s) s.stage = stage; }

// The opening line, when the AI can't write it.
export function openingLine(item) {
  const ended = item.ended, next = s?.next;
  const nextBit = next ? " " + phrase("nextUp", { next: next.title.replace(/ — session \d/, "").replace(/&/g, "and"), time: say(next.start) }) : "";
  return `${phrase("checkinOpen", { activity: activity(ended) })}${nextBit} ${howQuestion(ended)}`;
}

const EXIT = /\b(i'?m ready|ready to go|ready for the next|let'?s go|don'?t (want|need|wanna) (to )?talk|no more talk|not now|gotta go|got to go|moving on|i'?ll get started|good to go|want to get started|wanna get started)\b/i;
export const isExit = (t) => EXIT.test(t) && !/\bnot ready\b/i.test(t);
const SKIPPED = /\b(skipped|didn'?t (do|get to|go|study|work out)|missed it|never started|couldn'?t)\b/i;
const HARD = /\b(hard|rough|tough|struggl\w*|confus\w*|lost|tired|exhausted|bad|meh|not great|frustrat\w*|stuck|slow|distracted|didn'?t get)\b/i;
const GOOD = /\b(good|great|awesome|amazing|fine|solid|well|productive|fun|learned|figured|clicked|nailed|strong|better|easy|love)\b/i;

const MOTIVATION = [
  "Every session you finish is one less thing standing between you and that license.",
  "You don't have to feel ready. You just have to start, and the first ten minutes do the rest.",
  "Consistency beats intensity. Show up, do the work, and let it stack.",
  "Future you, on exam day, is going to be grateful you did this tonight.",
];
const TIPS = {
  study: "Start by skimming the headings so you know where it's going, then work the examples by hand before checking. If something doesn't click after two tries, write the question down and move on.",
  body: "Warm up properly, keep your form clean, and pick one thing to push a little harder than last time.",
  work: "Pick the one task that matters most and knock it out first, before the inbox gets you.",
  faith: "Put the phone away and give it your full attention. Even ten quiet minutes goes a long way.",
  meal: "Eat something real and give yourself a real break.",
};

// The scripted conversation, for when the AI isn't reachable. Returns { reply, open }.
export function scripted(text) {
  const r = scriptedRaw(text);
  if (r) r.reply = r.reply.replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim();
  return r;
}
function scriptedRaw(text) {
  const c = current();
  if (!c) return null;
  const t = String(text);
  if (isExit(t)) { close(true); return { reply: phrase("exitAck"), open: false }; }
  c.turns++;
  if (c.stage === "howdid") {
    if (SKIPPED.test(t)) { c.skipped = true; c.mood = "skipped"; }
    else c.mood = HARD.test(t) ? "hard" : GOOD.test(t) ? "good" : "neutral";
    const react = phrase(c.mood === "skipped" ? "reactSkipped" : c.mood === "hard" ? "reactHard" : c.mood === "good" ? "reactGood" : "reactNeutral");
    const next = c.next;
    const nextLine = next ? " " + phrase("nextTask", { what: nextWhat(next), time: say(next.start) }) : " That's the last thing on the schedule for today.";
    c.stage = next ? "chat" : "closed";
    if (!next) { close(true); return { reply: react + nextLine + " Enjoy the rest of your evening!", open: false }; }
    const q = " " + phrase(["study", "body", "work"].includes(next.category) ? "coachQ" : "lightQ");
    return { reply: `${react}${nextLine}${q}`, open: true };
  }
  // chat stage
  const next = c.next, cat = next?.category ?? "study";
  let reply;
  if (/\b(motivat\w*|pump|hype|encourage\w*|push)\b/i.test(t)) {
    const g = goals.list()[0];
    reply = `${phrase("motivation")}${g ? ` Remember, you're working toward this: ${g.text}.` : ""}`;
  } else if (/\b(overview|expect|what'?s (in|on)|what is it|cover|about)\b/i.test(t)) {
    const det = detailsOf(next);
    reply = det ? `Here's what's ahead: ${nextWhat(next)}. ${det}` : `It's ${nextWhat(next)}, from ${say(next.start)} to ${say(next.end)}.`;
  } else if (/\b(tips?|focus|advice|how should i)\b/i.test(t)) {
    reply = TIPS[cat] ?? TIPS.study;
  } else if (/\b(no|nope|nah|i'?m (fine|okay|ok|good)|all good|no thanks|that'?s (it|all)|feeling (good|fine|great|ready)|good to go)\b/i.test(t)) {
    close(true);
    return { reply: phrase("signoff"), open: false };
  } else if (HARD.test(t)) {
    reply = "That's fair. Just commit to the first ten minutes, and if it's still a grind after that, we'll adjust. You've done harder things than this.";
  } else {
    reply = "Makes sense. Anything else, or are you ready to dive in?";
  }
  if (c.turns >= 4) { close(true); return { reply: `${reply} ${phrase("signoff")}`, open: false }; }
  return { reply, open: true };
}

// What the AI needs to know to run the conversation itself.
export function contextFor() {
  const c = current();
  if (!c) return "";
  const n = owner.name(), them = owner.them(), their = owner.their();
  const fmt = (b) => b ? `${b.start}-${b.end} "${b.title}" (${b.category})${b.description ? ` — ${b.description}` : ""} #${b.id}` : "none";
  return [
    `A BETWEEN-BLOCKS CONVERSATION IS OPEN (stage: ${c.stage}, turns so far: ${c.turns}).`,
    `Just ended: ${fmt(c.ended)}. Next: ${fmt(c.next)}.`,
    `Run it like this. Your opening already asked how "${c.ended?.title}" went.`,
    `1) React to what ${n} says: encourage ${them}, or comment on what ${n} learned, warmly and specifically. If ${n} learned something,`,
    `   be curious about it. If ${n} struggled, normalise it and give one small, concrete idea. If ${n} skipped it, no guilt; offer`,
    `   to find it another slot.`,
    `2) Then say "For your next scheduled task, you're going to …" with exactly what it is, and ask how ${n} is feeling about it:`,
    `   motivation, insights, an overview of what to expect, or tips on what to focus on?`,
    `3) Talk as long as ${n} wants (a coach who knows the material; use ${their} files and course content). When it's winding down,`,
    `   close with something like "Alright, good talk, now let's get to it! Good luck, ${owner.nick()}!" and call end_conversation.`,
    `- If at ANY point ${n} says they're ready, doesn't want to talk, or anything like it: reply only "Sounds good!" (or two or three`,
    `  words like it) and call end_conversation. Nothing else.`,
    `- If ${n} says plans changed ("I need to do X next"), rearrange with the scheduling tools (plan_fit, then apply), confirm in`,
    `  one sentence, and end the conversation.`,
    `- Keep each spoken turn to two to four sentences. Make every line fresh: never reuse your wording from earlier in the day,`,
    `  and let ${their} interests and humor show (see what you know about ${them}).`,
  ].join("\n");
}
export function turn() { if (s) s.turns++; }
