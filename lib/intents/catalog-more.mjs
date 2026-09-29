// More of what Dayspring understands without AI (1.3.0): small talk and how someone's feeling, calendar trivia,
// home and daily life, health reminders (never medical advice), focus sessions, a small offline reference, games, and
// talking about the conversation itself ("what did you hear?", "that's wrong", "never mind").
// Same shape as catalog.mjs: I(id, family, label, example, phrasings, plan, extra).
import { sayDuration } from "./slots.mjs";

// (tested on what was actually said: "I want to die" loses its "I want to" to the filler-stripper)
export const CRISIS_RE = /(kill(ing)? myself|suicid(e|al)|end (it all|my life)|want to die|wanna die|wish i (was|were) dead|(want|going|thinking about|think about|trying) to hurt myself|hurting myself on purpose|(no|not any) reason to live|(do not|dont) want to (live|be alive|be here))/;
const I = (id, cat, label, ex, say, plan, extra = {}) => ({ id, cat, label, ex, say, plan, ...extra });
const kw = (re, x = 1.12) => (c) => (re.test(c.q) ? x : 1);
const DAYNUM = { sunday: 0, sundays: 0, monday: 1, mondays: 1, tuesday: 2, tuesdays: 2, wednesday: 3, wednesdays: 3, thursday: 4, thursdays: 4, friday: 5, fridays: 5, saturday: 6, saturdays: 6 };
// "every tuesday night", "every day", "on weekdays", "each monday and thursday" → [2], [0…6], [1…5], [1, 4]
export function repeatDays(q) {
  if (/\b(every ?day|daily|each day|every morning|every night|every evening|every afternoon|nightly)\b/.test(q)) return [0, 1, 2, 3, 4, 5, 6];
  if (/\bweekdays?\b|\bevery work ?day\b/.test(q)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(q)) return [0, 6];
  const days = [...q.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/g)].map((m) => DAYNUM[m[1]]);
  return /\b(every|each|on)\b/.test(q) && days.length ? [...new Set(days)] : null;
}
// "night" → 8 pm, "morning" → 8 am … when no clock time was said
export const partTime = (q) => (/\bmorning\b/.test(q) ? "08:00" : /\bafternoon\b/.test(q) ? "15:00" : /\bevening\b/.test(q) ? "18:00" : /\b(night|tonight|nightly|bedtime)\b/.test(q) ? "20:00" : /\bnoon|lunch\b/.test(q) ? "12:00" : null);
// Water reminders: the interval kind only when it's asked for ("every hour", "every 30 minutes", "hourly", "often").
// A clock time is one reminder at that time (today, or tomorrow once it's past), "every day at 11pm" a daily one,
// and "in 2 hours" a one-time timer. (Bug in 1.7.2: "remind me to drink water at 11pm" became "every hour".)
export const WATER_EVERY = /\b(every|each|hourly|often|throughout|all day|regularly|through the day|during the day)\b/;
export function waterPlan(c) {
  if (/\b(stop|cancel|turn off|end|no more)\b/.test(c.q)) return { do: "focus.stop", water: true };
  const every = WATER_EVERY.test(c.q), dur = c.slots.duration, time = c.slots.time?.hm ?? null, date = c.slots.date?.iso ?? null;
  const daily = /\b(every ?day|daily|each day|every (morning|night|evening|afternoon)|nightly|weekdays?|weekends?|every (sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/.test(c.q);
  if (time && daily) return { do: "reminder.repeat", text: "drink water", days: repeatDays(c.q) ?? [0, 1, 2, 3, 4, 5, 6], time };
  // "at 7:30" with no a.m./p.m.: whichever 7:30 comes next
  const loose = Boolean(time) && !/\b(am|pm|a m|p m|morning|evening|night|afternoon|tonight|noon|midnight|midday)\b/.test(c.slots.time?.text ?? "") && Number(time.slice(0, 2)) <= 12 && !date;
  if ((time || date) && !every) return { do: "reminder.repeat", text: "drink water", time: time ?? partTime(c.q) ?? "09:00", date, once: true, ...(loose ? { soonest: true } : {}) };
  if (dur && !every) return { do: "timer.start", ms: dur.ms, label: "drink water" };
  return { do: "health.water", every: dur?.ms ?? 3_600_000 };
}
const reminderText = (q) => {
  const m = /\bremind me (?:to|that|about) (.+?)(?:\s+(?:every|each|on|at|in the|tonight|daily|at night)\b.*)?$/.exec(q) ?? /\b(?:to|about) (.+?)(?:\s+(?:every|each|on|at|daily)\b.*)?$/.exec(q);
  return m ? m[1].replace(/\b(please|for me)\b/g, "").trim() : null;
};

export const MORE = [
  // ======================================================================= how someone's doing (kind, never clinical)
  I("social.crisis", "social", "Get support right now", "i want to hurt myself", [
    "i (want|am going) to (kill|hurt) myself", "i (want|wish i could) (to )?die", "i (do not|dont) want to (live|be alive|be here) anymore", "(thinking about|thoughts of) (suicide|killing myself|ending it)",
    "i want to end (it all|my life)", "suicide", "i (feel|am) suicidal", "(no|there is no) reason to live", "i am going to end it",
  ], () => ({ do: "support", kind: "crisis" }), { instant: true, boost: (c) => (CRISIS_RE.test(String(c.raw || c.q).toLowerCase().replace(/['’]/g, "")) ? 1.6 : 1) }),
  I("social.bored", "social", "Help when you're bored", "i'm bored", ["i am (so )?bored", "(i am|im) bored out of my mind", "(there is )?nothing to do", "give me something to do", "entertain me", "what should i do", "i do not know what to do", "boredom"], () => ({ do: "support", kind: "bored" }), { instant: true }),
  I("social.tired", "social", "Say something kind when you're tired", "i'm tired", ["i am (so |really |super )?(tired|sleepy|exhausted|worn out|drained)", "(i am|im) running on empty", "i need (a nap|sleep|a break)", "long day", "i am beat"], () => ({ do: "support", kind: "tired" }), { instant: true }),
  I("social.stressed", "social", "Help when you're stressed", "i'm stressed", ["i am (so |really )?(stressed|stressed out|anxious|overwhelmed|nervous|worried|freaking out)", "i (have|am having) a (bad|hard|rough|terrible) (day|week)", "(everything|it) is too much", "i (can not|cant) (handle|do) this", "i need to (relax|calm down|chill)"], () => ({ do: "support", kind: "stressed" }), { instant: true }),
  I("social.sad", "social", "Be there when you're sad", "i'm sad", ["i am (so |really |feeling )?(sad|down|depressed|upset|blue|unhappy|heartbroken|miserable)", "i (feel|am feeling) (sad|down|low|bad|awful|terrible)", "i (had|am having) a bad day", "i want to cry", "nothing is going right"], () => ({ do: "support", kind: "sad" }), { instant: true }),
  I("social.lonely", "social", "Keep you company", "i'm lonely", ["i am (so |really |feeling )?(lonely|alone)", "i (feel|am feeling) (lonely|alone|left out)", "(nobody|no one) (likes|loves|cares about) me", "talk to me", "keep me company", "i (have|got) no (one|friends) to talk to"], () => ({ do: "support", kind: "lonely" }), { instant: true }),
  I("social.happy", "social", "Celebrate with you", "i'm happy", ["i am (so |really )?(happy|excited|great|thrilled|pumped|stoked)", "(i|we) (did it|made it|won)", "i got the job", "i passed (my|the) (test|exam)", "good news", "today was (great|awesome|amazing)"], () => ({ do: "support", kind: "happy" }), { instant: true }),
  I("social.love", "chat", "Answer kindly", "i love you", ["i love you [dayspring]", "do you (love|like) me", "(will you|can you) be my (friend|best friend)", "you are my (best )?friend", "i like you", "are we friends"], () => ({ do: "chat", kind: "love" }), { instant: true }),
  I("social.compliment", "chat", "Say thanks for the kind words", "good job", ["(good|great|nice) job", "well done", "you are (awesome|amazing|the best|great|smart|funny|cool|so helpful)", "(i am|im) proud of you", "you rock", "that was (great|perfect|awesome|helpful)", "good (bot|girl|boy)"], () => ({ do: "chat", kind: "compliment" }), { instant: true }),
  I("social.insult", "chat", "Take it in stride", "you're dumb", ["you are (dumb|stupid|useless|annoying|the worst|terrible|bad)", "you (suck|stink)", "i hate you", "shut up", "(you are|youre) not (helpful|smart)", "bad (bot|dayspring)"], () => ({ do: "chat", kind: "insult" }), { instant: true }),
  I("social.sorry", "chat", "Accept an apology", "sorry", ["(i am )?sorry", "my bad", "i apologize", "oops", "my mistake"], () => ({ do: "chat", kind: "sorry" }), { instant: true, boost: kw(/^(i am )?(so )?sorry$|\bmy bad\b|\bapologi/, 1.2) }),
  I("social.whatsup", "chat", "Say what's up", "what's up", ["what is up", "whats up", "sup", "wassup", "what is (new|going on|happening) (with you)?", "what is the craic", "what are you (up to|doing)", "howdy (yall|partner)", "hey (yall|you all|everyone|folks)", "what is good"], () => ({ do: "chat", kind: "whatsup" }), { instant: true }),
  I("greet.evening", "chat", "Say good afternoon or evening", "good evening", ["good (afternoon|evening|day)", "(afternoon|evening) dayspring", "top of the morning", "happy (monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)"], () => ({ do: "chat", kind: "hello" }), { instant: true }),

  // ======================================================================= calendar trivia
  I("date.weekday", "time", "Tell you the day of the week for a date", "what day of the week is july 4", [
    "what day (of the week )?(is|was|will be|does|did) {date} [fall on|land on|be]", "(is|was) {date} (on )?a (monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|weekday)", "what day (is|was) {date} (on|this year|next year)",
    "which day (of the week )?(is|was) {date}", "what weekday is {date}",
  ], (c) => ({ do: "date.weekday", date: c.slots.date?.iso ?? null, text: c.slots.date?.text ?? null }), { instant: true, needs: ["date"], boost: kw(/\b(what|which) day\b|\bweekday\b/) }),
  I("date.leap", "time", "Tell you if it's a leap year", "is it a leap year", ["is (it|this) a leap year", "is {num} a leap year", "(when is|what is) the next leap year", "leap year", "how many days (are )?in (february|this year|{num})", "does february have 29 days (this year)?"],
    (c) => ({ do: "date.leap", year: (c.slots.numbers ?? []).find((n) => n > 1000) ?? null }), { instant: true, boost: kw(/\bleap\b/, 1.3) }),
  I("date.what", "time", "Tell you the date of a day", "what's the date next friday", ["what is the date {date}", "what (is|will be) the date {date}", "what date is {date}", "(which|what) date (is|will it be) {date}", "what is {date} date", "the date {date}"],
    (c) => ({ do: "date.what", date: c.slots.date?.iso ?? null }), { instant: true, needs: ["date"], boost: kw(/\bdate\b/, 1.08) }),

  // ======================================================================= home and daily life
  I("dinner.suggest", "home", "Suggest something for dinner", "what should i have for dinner", ["what should i (have|make|eat|cook) for (dinner|lunch|breakfast|supper)", "what is for (dinner|lunch|supper)", "(any )?(dinner|lunch|meal) (ideas|suggestions)", "i do not know what to (make|cook|eat)", "help me (pick|choose|decide) (dinner|what to eat)", "what (can|should) i (cook|make) tonight", "suggest a (meal|recipe|dinner)"],
    (c) => ({ do: "dinner.suggest", meal: /\bbreakfast\b/.test(c.q) ? "breakfast" : /\blunch\b/.test(c.q) ? "lunch" : "dinner" }), { instant: true }),
  // (health.water's plan, below: a clock time or "in 2 hours" is never an hourly reminder)
  I("reminder.repeat", "timers", "Set a repeating reminder", "remind me to take out the trash every tuesday night", [
    "remind me (to|about) {text} every {text}", "remind me every {text} to {text}", "(every|each) {text} remind me to {text}", "remind me (to|about) {text} (daily|every day|every night|every morning|on weekdays|nightly|every week)",
    "set a (daily|weekly|recurring|repeating) reminder (to|for) {text}", "(make|set up) a reminder (to|for) {text} (every|each) {text}", "remind me (to|about) {text} on (mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)",
  ], (c) => ({ do: "reminder.repeat", text: reminderText(c.q), days: repeatDays(c.q), time: c.slots.time?.hm ?? partTime(c.q) }), { boost: kw(/\b(every|each|daily|nightly|weekdays|recurring|repeating|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/, 1.15) }),

  // ======================================================================= health-ish (reminders and gentle breaks only)
  I("health.medicine", "health", "Remind you to take medicine", "remind me to take my medicine at 8", [
    "remind me to take my (medicine|meds|medication|pills|vitamins|insulin|inhaler) [at {time}] [every day|daily|every morning|every night]", "(medicine|medication|pill|meds) reminder [at {time}]",
    "(set|make) a (medicine|medication|pill) reminder [for {time}]", "i need to take my (medicine|meds|pills) at {time}", "do not let me forget my (medicine|meds|pills)",
  ], (c) => ({ do: "reminder.repeat", text: /\bvitamin/.test(c.q) ? "take your vitamins" : /\binsulin\b/.test(c.q) ? "take your insulin" : /\binhaler\b/.test(c.q) ? "use your inhaler" : "take your medicine", days: repeatDays(c.q) ?? [0, 1, 2, 3, 4, 5, 6], time: c.slots.time?.hm ?? partTime(c.q), medication: true, once: !/\b(every|each|daily|nightly)\b/.test(c.q) }),
    { boost: kw(/\b(medicine|meds|medication|pills?|vitamins?|insulin|inhaler)\b/, 1.2) }),
  I("health.water", "health", "Remind you to drink water", "remind me to drink water every hour", ["remind me to drink (water|more water) [every {dur}|every hour|often]", "(drink|water) (water )?reminders?", "(help me|i need to) (drink more water|stay hydrated)", "hydration reminder", "(set|start) (a )?water reminder [every {dur}]", "(stop|cancel|turn off|end) (the |my )?(water|drink water|hydration) reminders?", "no more water reminders"],
    (c) => waterPlan(c), { boost: kw(/\b(water|hydrat)/, 1.2),
      // "remind me to drink water at 11pm" / "tomorrow at 6" / "in 2 hours" is ONE reminder (reminder.set, a timer), and
      // "every day at 11pm" is a daily one at that time (reminder.repeat): those phrasings say it better. The water
      // reminder itself is only the interval kind ("every hour", "every 30 minutes", "hourly", "help me stay hydrated").
      check: (c) => !(c.slots.time || c.slots.date || (c.slots.duration && !WATER_EVERY.test(c.q))) }),
  I("health.stretch", "health", "Start a stretch break", "start a stretch break", ["(start|take|time for|let us take) a stretch(ing)? break", "(i need to|help me) stretch", "stretch (break|with me)", "remind me to stretch", "(give me|start) a (movement|standing|walk) break", "time to (move|stretch|get up)"], (c) => ({ do: "health.stretch", ms: c.slots.duration?.ms ?? 5 * 60_000 }), { boost: kw(/\bstretch/, 1.2) }),
  I("health.breathe", "health", "Do a breathing exercise with you", "breathing exercise", ["[do a|start a|guide me through a|lead me in a] (breathing|breath) exercise", "box breathing", "help me (breathe|calm down|relax)", "(let us|lets) (breathe|do some breathing)", "breathe with me", "(deep|calming) breaths", "i need to (breathe|calm down)"], () => ({ do: "health.breathe" }), { instant: true, boost: kw(/\bbreath/, 1.25) }),

  // ======================================================================= focus and the day so far
  I("focus.start", "focus", "Start a focus session", "start a pomodoro", ["start a (pomodoro|focus session|focus timer|work session|study session|work sprint)", "(pomodoro|focus mode|focus time) [please|now]", "(i need to|help me|time to) (focus|concentrate|get some work done)", "(start|begin|do) (a )?{dur} (focus|work|pomodoro) (session|timer|block)?", "let us (focus|get to work)"],
    (c) => ({ do: "focus.start", work: c.slots.duration?.ms ?? 25 * 60_000, rest: 5 * 60_000, rounds: 4 }), { boost: kw(/\b(pomodoro|focus)\b/, 1.2) }),
  I("focus.stop", "focus", "End the focus session", "stop the pomodoro", ["(stop|end|cancel|finish|quit) (the |my )?(pomodoro|focus session|focus timer|focus mode|work session)", "(i am|im) done focusing", "end focus", "take me out of focus mode"], () => ({ do: "focus.stop" }), { instant: true, boost: kw(/\b(pomodoro|focus)\b/, 1.2) }),
  I("day.done", "schedule", "Tell you what you did today", "what did i do today", ["what did i do today", "what have i (done|finished|gotten done) today", "(what|how much) did i (get done|accomplish|finish) today", "what have i done so far", "recap (my|the) day", "summary of (my|the) day"], () => ({ do: "day.done" }), { instant: true }),
  I("day.left", "schedule", "Tell you what's left today", "what's left today", ["what is left (today|for today|on my schedule|to do)", "what (else )?do i have (left|remaining) today", "how much (is|do i have) left today", "what is (still )?(left|remaining) (on|in) my day", "anything (else|left) today", "rest of (my|the) day"], () => ({ do: "day.left" }), { instant: true, boost: kw(/\b(left|remaining|rest of)\b/, 1.1) }),

  // ======================================================================= Dayspring itself
  I("ds.restart", "dayspring", "Restart Dayspring", "restart", ["restart [yourself|dayspring|the app]", "(reboot|reload|refresh) (yourself|dayspring|the app)", "turn (yourself )?off and (on|back on) again", "can you restart"], () => ({ do: "route", text: "restart dayspring" }), { risky: true }),
  I("ds.brightness", "dayspring", "Explain screen brightness", "turn up the brightness", ["(turn|make) (up|down) the brightness", "(brighter|dimmer|darker) (screen|display)?", "(increase|decrease|raise|lower|change) (the )?(screen )?brightness", "(the )?screen is too (bright|dark|dim)", "dim the screen"], () => ({ do: "explain", topic: "brightness" }), { instant: true, boost: kw(/\b(bright|dim|dark)/, 1.2) }),
  I("ds.examples", "dayspring", "Give you examples of what to say", "give me some examples", ["give me (some )?examples", "(what are|show me) (some )?examples", "what (else )?can i say", "teach me (some )?commands", "(give me|tell me) (an|some) (idea|ideas) (of|for) what to say", "what should i try"], () => ({ do: "examples" }), { instant: true }),

  // ======================================================================= a small offline reference
  I("know.capital", "knowledge", "Tell you a capital city", "what's the capital of france", ["what is the capital (city )?of {text}", "(capital|capital city) of {text}", "{text} capital", "what city is the capital of {text}", "which city is the capital of {text}"], (c) => ({ do: "know.capital", text: c.q }), { instant: true, boost: kw(/\bcapital\b/, 1.3) }),
  I("know.planet", "knowledge", "Tell you about the planets", "how many planets are there", ["how many planets (are there|are in the solar system)", "what is the (biggest|largest|smallest|hottest|farthest|closest) planet", "tell me about (mercury|venus|earth|mars|jupiter|saturn|uranus|neptune|pluto)", "how many moons does (mercury|venus|earth|mars|jupiter|saturn|uranus|neptune) have", "(list|name) the planets", "is pluto a planet", "which planet has the most moons", "facts about (mars|jupiter|saturn|venus|mercury|neptune|uranus)"],
    (c) => ({ do: "know.planet", text: c.q }), { instant: true, boost: kw(/\b(planets?|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto)\b/, 1.25) }),
  I("know.table", "knowledge", "Say a times table", "what's the 7 times table", ["(what is|say|read me|tell me) the {num} times table", "{num} times table", "multiplication table (for|of) {num}", "(teach me|help me learn) my {num} times"], (c) => ({ do: "know.table", n: c.slots.numbers?.[0] ?? null }), { instant: true, boost: kw(/\b(times table|multiplication)\b/, 1.3) }),
  I("know.question", "knowledge", "Look that up for you", "who invented the telephone", [
    "who (is|was|are|were|invented|discovered|wrote|made|built|founded|painted|sang) {text}", "what (is|are|was|were) (a|an|the)? {text}", "why (is|are|do|does|did|can) {text}", "how (does|do|did|many|much|far|old|tall|big|long|deep|fast) {text}",
    "when (did|was|is|were|will) {text}", "where (is|are|was|did|do) {text}", "tell me about {text}", "explain {text}", "what does {text} mean", "define {text}", "who won {text}", "is it true that {text}", "i was wondering {text}",
  ], (c) => ({ do: "know.question", query: c.q }), { prior: 0.8 }),

  // ======================================================================= games
  I("game.trivia", "games", "Ask you a trivia question", "let's play trivia", ["(let us|lets|can we|i want to) play trivia", "(ask me|give me) a (trivia )?question", "trivia (time|question|game)", "quiz me", "test my knowledge", "another (trivia )?question", "(play|start) a quiz"], () => ({ do: "game.trivia" }), { instant: true, boost: kw(/\b(trivia|quiz)\b/, 1.25) }),
  I("game.rps", "games", "Play rock paper scissors", "rock paper scissors", ["[let us|lets] play rock paper scissors", "rock paper scissors [shoot]", "(i choose|i pick|i go with) (rock|paper|scissors)", "rock paper scissors (rock|paper|scissors)", "(rock|paper|scissors) shoot", "play roshambo"],
    (c) => ({ do: "game.rps", pick: (/\b(i choose|i pick|i go with|shoot)\b/.test(c.q) || /scissors (rock|paper|scissors)$/.test(c.q)) ? (/(rock|paper|scissors)(?: shoot)?$/.exec(c.q)?.[1] ?? null) : null }), { instant: true, boost: kw(/\b(rock|paper|scissors|roshambo)\b/, 1.3) }),
  I("game.8ball", "games", "Shake the magic 8-ball", "magic 8 ball, will it snow", ["magic {num} ball {text}", "(ask|shake) the magic {num} ball", "magic {num} ball", "(what does|ask) the {num} ball [say]", "magic eight ball {text}"], () => ({ do: "game.8ball" }), { instant: true, boost: kw(/\bball\b/, 1.3) }),
  I("game.wyr", "games", "Ask a would-you-rather", "would you rather", ["would you rather", "(ask me|give me|play) (a )?would you rather [question]", "(let us|lets) play would you rather", "another would you rather"], () => ({ do: "game.wyr" }), { instant: true, boost: kw(/\brather\b/, 1.25) }),
  I("game.20q", "games", "Play 20 questions", "let's play 20 questions", ["[let us|lets|can we] play {num} questions", "{num} questions [game]", "(let us|lets) play a (guessing|word) game", "guess what i am thinking", "(play|start) (a )?game with me", "i spy"], () => ({ do: "needs.ai", what: "play guessing games like that", offer: "Without AI I can do trivia, rock paper scissors, would you rather, or the magic 8-ball." }), { boost: kw(/\b(questions|guess|i spy|game)\b/, 1.1) }),

  // ======================================================================= the conversation itself
  I("meta.heard", "meta", "Tell you what I heard", "what did you hear", ["what did you (hear|think i said|understand)", "what did i (just )?say", "(did you|what did you) (catch|get) (that|what i said)", "repeat what i said", "what do you think i (said|asked)"], () => ({ do: "meta.heard" }), { instant: true }),
  I("meta.wrong", "meta", "Undo what I got wrong", "that's wrong", ["(that is|thats) (wrong|not right|incorrect|not it|not what i (said|asked|meant|wanted))", "you misheard me", "you got (it|that) wrong", "(no|nope) that is not (it|right|what i said)", "wrong", "that is not what i asked for", "you misunderstood", "not what i meant"], () => ({ do: "meta.wrong" }), { instant: true }),
  I("meta.nevermind", "meta", "Never mind", "never mind", ["never ?mind", "forget (it|about it|that)", "cancel [that|it]", "start over", "(let us|lets) start over", "scratch that", "ignore (that|me)", "nothing", "no thanks", "i am good", "that is all", "that will be all", "nothing else", "done"], () => ({ do: "meta.nevermind" }), { instant: true }),
];
