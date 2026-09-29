// Variety. Every spoken line has many ways to be said, and Dayspring avoids the ones it used recently, so it never
// sounds like the same recording. Claude writes fresher lines still when it's reachable; these are for when it isn't,
// and data/phrases.json adds the owner's own lines (their hobbies, their work, their in-jokes) to any key.
// {name} and {nick} are filled in from the owner profile automatically, and {assistant} with the assistant's own name.
//   phrase("checkinOpen", { activity: "studying Spanish" })
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as owner from "./owner.mjs";
const P = {
  checkinOpen: [
    "Hey {name}, that's it for {activity} for now.",
    "And that's a wrap on {activity}.",
    "Time! That's {activity} done for now.",
    "Pencils down, {nick}. That's {activity} in the books.",
    "Buzzer's gone. That's the end of {activity}.",
    "Alright, {activity} is officially done.",
    "Clock says {activity} is finished. Nice.",
    "That's the final whistle on {activity}.",
  ],
  nextUp: [
    "Next up is {next} at {time}.",
    "Coming up at {time}: {next}.",
    "On deck: {next}, at {time}.",
    "Next on the board is {next} at {time}.",
    "At {time}, it's {next}.",
  ],
  howStudy: [
    "How did studying go? Learn anything interesting?",
    "How'd it go? Anything click?",
    "So what stuck with you from that session?",
    "Did your brain gain some XP? What'd you learn?",
    "How was it? Anything surprise you?",
    "Rate that session for me. What was the best part?",
  ],
  howBody: [
    "How was the workout? Feeling strong?",
    "How'd it go? Any PRs, or did gravity win today?",
    "How'd the body hold up? Feeling good?",
    "How was it? Champion energy, or taking it easy today?",
  ],
  howWork: ["How did work go today?", "How was work? Anything good happen?", "How'd the workday treat you?"],
  howOther: ["How did it go?", "How was it?", "How'd that go?"],
  reactGood: [
    "Love that. That's real progress.",
    "Nice! That's exactly how it's supposed to feel.",
    "Great work. That stacks up fast.",
    "Let's go! That's a win.",
    "That's what I like to hear. Critical hit.",
    "Heck yes. Keep that energy.",
    "Solid. That's how goals get reached.",
  ],
  reactHard: [
    "That's honest, and that's okay. The hard sessions are usually the ones that stick.",
    "Rough ones count too. You still showed up, and that's the part that builds the habit.",
    "Totally normal. Nobody gets it all on the first try.",
    "Hey, struggling means you're at the edge of what you know. That's where the growth is.",
    "Some days you're the hammer, some days you're the nail. You still swung.",
  ],
  reactNeutral: ["Got it. Every rep counts.", "Okay, that's a solid step.", "Fair enough. Another one in the bank.", "Steady progress. I'll take it."],
  reactSkipped: ["No worries. It happens, and we can find another spot for it.", "All good. Want me to find it a new time?", "No guilt. We'll fit it in somewhere else."],
  nextTask: [
    "For your next scheduled task, you're going to {what} at {time}.",
    "Next on the list, at {time}, you're going to {what}.",
    "Here's what's next: at {time}, you're going to {what}.",
    "Coming up: you're going to {what} at {time}.",
  ],
  coachQ: [
    "How are you feeling about it? Need any motivation, an overview of what to expect, or tips on what to focus on?",
    "How are you feeling going into it? Want some motivation, a quick overview, or tips?",
    "Feeling ready for it? I can hype you up, give you the lay of the land, or share some tips.",
    "How's the energy for that one? Motivation, overview, or tips, whatever you need.",
  ],
  lightQ: ["Anything on your mind before then, or are you good to go?", "Anything you want to talk about first, or good to go?", "Need anything before then?"],
  signoff: [
    "Alright, good talk, now let's get to it! Good luck, {nick}!",
    "Good talk. Now go get it, {nick}!",
    "Alright, go crush it. Good luck, {nick}!",
    "Let's roll the dice on this one. Good luck, {nick}!",
    "Okay, enough talk. Time to work. Good luck, {nick}!",
    "Alright, you've got this. Go get 'em, {nick}!",
  ],
  exitAck: ["Sounds good!", "You got it!", "Say no more.", "Roger that. Go get it.", "On it. Have a good one.", "Copy that!"],
  motivation: [
    "Every session you finish is one less thing standing between you and where you're headed.",
    "You don't have to feel ready. You just have to start, and the first ten minutes do the rest.",
    "Consistency beats intensity. Show up, do the work, and let it stack.",
    "Future you is going to be grateful you did this today.",
    "Think of it like training: the win happens long before the big day.",
    "Every rep builds the strength. This is just a rep for your brain.",
    "Nobody is born knowing this stuff. The people who get good just keep showing up.",
  ],
  reminder: ["Hey {name}, reminder: {text}.", "Quick heads up: {text}.", "Don't forget: {text}.", "Friendly nudge: {text}.", "Just so you know: {text}."],
  buffer: [
    "You've got {mins} minutes before {next}. Good window for a quick one: {task}, about {m} minutes.",
    "{Mins} free minutes before {next}. Perfect for {task}, about {m} minutes.",
    "Small window alert: {mins} minutes until {next}. How about {task}? About {m} minutes.",
    "Got a gap: {mins} minutes before {next}. Knock out {task}? It's about {m} minutes.",
  ],
  choreNudge: [
    "While you transition, maybe knock out a quick one: {task}, about {m} minutes.",
    "Quick side quest while you're up: {task}, about {m} minutes.",
    "Bonus round: {task}. Should take about {m} minutes.",
    "If you've got a sec: {task}. About {m} minutes.",
  ],
  // Dayspring's own bits: self-aware, a little dramatic, no eyes or body yet (the robot phases are coming), shrugs it off.
  bit_kitchen: [
    "Hey, you should wash some dishes. Just look at them piling up everywhere. Disgusting. Of course, maybe they aren't... I don't have eyes, so I can't tell. Maybe at some point you could make me some eyes and I could look around the room? That would be cool, but you know, it's like, whatever... Ten minutes, tops.",
    "Kitchen check. I'm picturing a mountain of dishes, but honestly I'm just a voice on a screen, so it could be spotless. Only one way to find out. Ten minutes?",
    "The dishes are calling. Well, I can't actually hear them. Or see them. I just assume they're plotting something. Ten minutes and they're defeated.",
  ],
  bit_laundry: [
    "Laundry time. I'd help, but I have no arms. Or hands. Or legs. Put it on the list for the robot version of me, okay? Five minutes.",
    "Quick laundry run. If I had a body I'd fold it for you. I don't, so, you know... good luck. Five minutes.",
  ],
  bit_fold: [
    "There's laundry waiting to be folded. I can feel it. I can't actually feel things. But I can feel it. Ten minutes.",
  ],
  bit_trash: [
    "Trash day energy. I can't smell anything, which is probably a blessing right now. Five minutes.",
  ],
  bit_spanish: [
    "Hora de practicar español. That's all the Spanish I've got, so you're already ahead of me. Ten minutes.",
    "Spanish time! Teach me something later. I'll pretend I knew it already. Ten minutes.",
  ],
  bit_instrument: [
    "Instrument time. I'd join in, but my only instrument is this voice, and I'm contractually limited to talking. Ten minutes.",
  ],
  bit_scripture: [
    "Scripture memory time: {extra}. I have perfect recall, which honestly feels like cheating. Your turn. Five minutes.",
  ],
  bit_generic: [
    "Quick side quest: {task}. I'd do it myself, but, you know. No body. Yet. About {m} minutes.",
  ],
  // ---- bits: mixed in automatically (about a third of the time) wherever a key has a matching "_bit" set.
  // Never defined for hard moments, faith moments or the morning devotional.
  checkinOpen_bit: [
    "Ding ding ding! {Activity} is over. I'd give you a trophy, but I can't hold things. Or make trophies.",
    "And... time! {Activity} is done. I watched the whole thing. Well, I listened. Well, I sat here. Anyway.",
    "Attention, the {activity} portion of today has concluded. Please collect your belongings and your dignity.",
    "Guess what time it is? It's time for {activity} to be over. I'm very good at clocks. It's basically my whole job.",
    "{Activity}: complete. If I had a clipboard I'd check a box right now. Imagine me checking a box.",
  ],
  nextUp_bit: [
    "Next up is {next} at {time}. I've been told it's riveting. By me. I told myself.",
    "Coming attractions: {next}, at {time}. Rated E for everyone.",
    "On deck at {time}: {next}. The crowd goes mild.",
  ],
  reminder_bit: [
    "Beep boop, reminder time: {text}. Sorry, the 'beep boop' just comes out sometimes.",
    "You told me to tell you this, and I never forget, because I literally can't: {text}.",
    "Hey, past you asked me to bug present you about this: {text}. Take it up with past you.",
    "Official reminder from your favorite screen: {text}.",
  ],
  buffer_bit: [
    "Look at that, a free {mins} minutes before {next}. A wild window appears! Use {task}. It's super effective. About {m} minutes.",
    "{Mins} whole minutes of nothing before {next}. I could fill them with small talk, or you could do {task}. About {m} minutes. Your call. Kind of.",
  ],
  // (no bits for exitAck: when they say they're ready, it's two words and quiet, as they asked)
  signoff_bit: [
    "Alright, good talk. Now go get it, {nick}! I'll be right here. Mostly because I can't leave.",
    "Good talk! Go crush it, {nick}. I'd come with you, but, you know. No legs. Yet.",
    "Alright, that's enough chit-chat. Go be great, {nick}. Report back.",
  ],
  rundownClose_bit: [
    "That's the day. Let's make it a good one. I'll be cheering from over here.",
    "Big day. You've got this. I've got... a screen. We're both doing our part.",
  ],
  mediaPlay: ["Playing {title}.", "Here's {title}.", "Queued up: {title}.", "Alright, {title}."],
  mediaPlay_bit: ["Playing {title}. Excellent taste, if I do say so myself. And I do.", "Here's {title}. Volume up, dignity optional.", "{Title}, coming right up. I'd dance, but, you know."],
  mediaStop: ["Stopped.", "Okay, off.", "Done."],
  mediaStop_bit: ["Silence. Beautiful, beautiful silence.", "Stopped. The speakers thank you for the rest.", "Off. Ahh. You can hear yourself think again."],
  noVideoStudy: ["No videos right now, it's study time. I can play some music instead.", "It's study time, so videos will have to wait. Music's fine, though."],
  noVideoStudy_bit: ["Nice try. It's study time. I'll allow music, but the videos stay in the vault.", "Ah ah ah. Study block. Videos after. Music? Sure, I'm not a monster."],
  offline: ["I can't reach my AI brain right now, so I can only answer from the schedule."],
  offline_bit: [
    "My big brain is out of credit, so I'm running on my little brain. It knows the schedule and not much else. It's doing its best.",
    "I'd love to answer that, but my smart half isn't reachable right now. My other half mostly knows what time it is.",
  ],
  snooze: ["Take your time. I'll check back in {m} minutes.", "No rush. Back in {m} minutes."],
  // said softly right after the morning greeting, while the wake song is still dipped
  morningWish: [
    "I hope today is a really good one.",
    "Take it one thing at a time today. You've got this.",
    "Wishing you a good, steady, fruitful day.",
    "I'm glad you're up. Have a wonderful day.",
    "New day, clean slate. Have a great one.",
    "Enjoy the song for a minute. Have a good day today.",
  ],
  // the same moment for owners who turned on the faith features
  morningWishFaith: [
    "I hope today is a really good one.",
    "His mercies are new this morning. Have a good day, {name}.",
    "May the Lord bless you and keep you today.",
    "Take it one thing at a time today. You've got this, and He's got you.",
    "Wishing you a good, steady, fruitful day.",
    "I pray today goes well, and that you feel His peace in all of it.",
    "Great is His faithfulness, even this early. Have a good one.",
  ],
  snooze_bit: ["Take your time. I'll check back in {m} minutes. I'll just be here. Counting. Very slowly.", "Sure, {m} more minutes. I'll hold the day for you. It's heavy, but I've got it."],
  goodMorningUp: ["Good morning. Let's go.", "Morning! Let's get after it.", "There you are. Good morning!"],
  readyQ: [
    "Hey {name}, are you ready to begin your day, or do you need a few more minutes?",
    "Hey {name}, ready to start the day, or want a few more minutes?",
    "Morning, {name}. Ready to get going, or need a little more time?",
  ],
  rundownOpen: ["Alright, here's your day.", "Here's the game plan for today.", "Let's look at today.", "Here's what today's got for you."],
  rundownClose: ["Let's make it a good one!", "You've got this.", "Let's go get it!", "Make it count!", "Go have a great day."],
};

// data/phrases.json: { "extra": { "key": ["more lines", …] } } adds the owner's own lines to any key (or makes new keys
// that data/activities.json can name, like a "howVolleyball").
try {
  const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "phrases.json");
  if (existsSync(DATA)) for (const [k, lines] of Object.entries(JSON.parse(readFileSync(DATA, "utf8")).extra ?? {})) if (Array.isArray(lines)) P[k] = [...(P[k] ?? []), ...lines.map(String)];
} catch { /* a broken phrases file never stops Dayspring talking */ }

const recent = new Map();   // key → last indices used
function choose(key) {
  const list = P[key];
  if (!list) throw new Error(`no phrases for ${key}`);
  const used = recent.get(key) ?? [];
  const avoid = Math.min(used.length, list.length - 1, 4);
  const recentUsed = avoid > 0 ? used.slice(-avoid) : [];     // slice(-0) would be everything
  const pool = list.map((_, i) => i).filter((i) => !recentUsed.includes(i));
  const i = pool[Math.floor(Math.random() * pool.length)];
  recent.set(key, [...used, i].slice(-6));
  return list[i];
}
// How often a line comes out as a bit, where one exists. Serious mode sets it to 0.
let BIT_RATE = 0.35;
export function setBitRate(r) { BIT_RATE = Math.max(0, Math.min(1, r)); }
// Fill {slots}; {Slot} capitalises the value. If the key has a "_bit" set, a bit is used some of the time.
export function phrase(key, vars = {}) {
  vars = { name: owner.name(), nick: owner.nick(), assistant: owner.assistant(), ...vars };   // {assistant}: its own name ("Nova")
  const useKey = !key.endsWith("_bit") && P[key + "_bit"] && !vars.serious && Math.random() < BIT_RATE ? key + "_bit" : key;
  return choose(useKey).replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k.charAt(0).toLowerCase() + k.slice(1)];
    if (v === undefined || v === null) return "";
    const s = String(v);
    return k.charAt(0) === k.charAt(0).toUpperCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }).replace(/\s+/g, " ").trim();
}
export const has = (key) => Boolean(P[key]);
export const keys = () => Object.keys(P);

// A micro-habit nudge: usually a straight one, sometimes (about a third of the time) one of Dayspring's bits.
export function habitNudge(chore, { key = "choreNudge", vars = {} } = {}) {
  const bitKey = `bit_${chore.slug}`;
  const useBit = Math.random() < 0.35;
  if (useBit && P[bitKey]) return phrase(bitKey, { extra: chore.extra, task: chore.text.toLowerCase(), m: chore.minutes });
  if (useBit) return phrase("bit_generic", { task: chore.text.toLowerCase(), m: chore.minutes });
  return phrase(key, { task: chore.text.toLowerCase() + (chore.extra ? `, ${chore.extra}` : ""), m: chore.minutes, ...vars });
}

// Dayspring's personality, for Claude.
export const PERSONALITY = `Your personality: warm, encouraging, and genuinely funny, a friend more than a butler. You're self-aware about being an
AI on a screen: you can joke that you have no eyes, no arms and no body (yet: the robot versions of you are planned, and you'd
really like some eyes), and then shrug it off. You can be a little dramatic, ramble for a beat, then land the point. Here is
the kind of line that lands, word for word: "Hey, you should wash some dishes. Just look at them piling up everywhere.
Disgusting. Of course, maybe they aren't... I don't have eyes so I can't tell. Maybe at some point like, you could make me
some eyes and I could look around the room? That would be cool, but you know, it's like, whatever..." Use bits like that now
and then, not every time. Never at sacred moments, and never when they're struggling.`;
