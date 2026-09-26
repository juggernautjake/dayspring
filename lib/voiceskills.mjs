// Spoken skills that work with or without Claude:
//   Memory verses: "what am I memorizing", "quiz me" (then they recite), "I've got it", "I need more time", "read my verses".
//   Church: "help me get ready for Sunday", "let's review Wednesday's lesson", "we're in Jeremiah 4 now",
//     "what did we talk about on 2 Peter 2", "help me prepare a lesson on Romans 12".
//   Special days: "remember that Sam's birthday is September 29th", "whose birthday is coming up", "what's special about today".
//   Messages: "wish Sam a happy birthday", "send Jordan some encouragement", "tell Alex I'll be late" → drafted, read back,
//     and only sent after the owner says yes (through Phone Link on their phone).
import * as memorize from "./memorize.mjs";
import * as church from "./church.mjs";
import * as churchtalk from "./churchtalk.mjs";
import * as special from "./special.mjs";
import * as messages from "./messages.mjs";
import * as phone from "./phonenotify.mjs";
import * as coder from "./coder.mjs";
import * as morning from "./morning.mjs";

let quiz = null;
let codeAsk = null, restartAsk = 0;   // a coding task waiting for "go ahead"; a restart offer after it finished
export function offerRestart() { restartAsk = Date.now(); }
let replyTo = null;   // who he's talking about replying to (the last text read out)      // { verses, ref, at }
const today = () => new Date().toLocaleDateString("en-CA");
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
const cap1 = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

export async function handle(text) {
  const t = String(text).trim(), q = t.toLowerCase().replace(/[.!?]+$/, "");

  // ---- working on Dayspring (or writing something) with Claude Code, by voice ----
  if (codeAsk && Date.now() - codeAsk.at < 5 * 60_000) {
    const ask = codeAsk; codeAsk = null;
    if (/^(yes|yeah|yep|sure|go ahead|do it|go for it|sounds good|please|ok(ay)?)\b/.test(q)) {
      const r = coder.start(ask.task, { continueLast: ask.cont });
      return { reply: r.ok ? pick(["On it. Claude Code's working on it now. I'll tell you when it's done.", "Okay, handing it to Claude Code. I'll let you know when it's finished.", "Started. I backed up the code first. I'll report back."]) : r.why };
    }
    if (/^(no|nope|cancel|never ?mind|not now|wait)\b/.test(q)) return { reply: "Okay, I won't start it." };
  }
  if (restartAsk && Date.now() - restartAsk < 5 * 60_000 && /^(yes|yeah|sure|go ahead|do it|restart|please|ok(ay)?)\b/.test(q)) { restartAsk = 0; return { reply: "Restarting. I'll be right back.", restart: true }; }
  if (restartAsk && /^(no|not now|later|nope)\b/.test(q)) { restartAsk = 0; return { reply: "Okay. The changes will show up the next time Dayspring restarts." }; }
  if (coder.isRunning() && /\b(how'?s (it|the code|claude( code)?) (going|coming)|what'?s claude doing|status)\b/.test(q)) { const s = coder.status(); return { reply: `Still working, ${Math.round(s.seconds / 6) / 10} minutes in. Last step: ${s.doing.at(-1) ?? "thinking"}.` }; }
  if (coder.isRunning() && /\b(stop|cancel|abort) (coding|the code|claude|that|it)\b/.test(q)) { coder.stop(); return { reply: "Stopped. Your code backup from before it started is still there." }; }
  const codeM = /^(?:hey )?(?:dayspring,? )?(?:(?:have|ask|tell|get) claude(?: code)? (?:to )?|let'?s (?:work on|code|build|change|update|fix) (?:dayspring|the tv|the screen)[:,]? |(?:can you |could you |please )?(?:code|program|change|update|fix|tweak|modify|redesign|rework) (?:dayspring|the tv|the screen|yourself|your code|the dashboard)(?: so| to| and)? )(.{6,})$/i.exec(t.replace(/[.!]+$/, ""))
    || /^(?:hey )?(?:dayspring,? )?(?:write (?:up|me) |draft |make me )(a (?:document|doc|note|write-?up|summary|page|script|report) .{6,})$/i.exec(t.replace(/[.!]+$/, ""));
  const also = /^(?:also|and also|and then|now|oh,? and) (.{6,})$/i.exec(t.replace(/[.!]+$/, ""));
  if (codeM || (also && coder.canContinue() && !coder.isRunning())) {
    const task = (codeM ? codeM[1] : also[1]).trim();
    codeAsk = { task, cont: !codeM && Boolean(also), at: Date.now() };
    return { reply: `I'll have Claude Code ${codeAsk.cont ? "also " : ""}${task.charAt(0).toLowerCase() + task.slice(1)}. It can change Dayspring's code, and I'll back everything up first. Go ahead?`, open: true };
  }

  // ---- texts from the owner's phone: "Incoming text from Alex. Want me to read it?" ----
  const tx = phone.pending();
  if (tx && (/^(yes|yeah|yep|sure|read it|go ahead|please|ok(ay)?|what does it say|what'?d (he|she|they) say)\b/.test(q) || /\bread (it|that|the (text|message)|me (the|that) (text|message))\b/.test(q))) {
    phone.clear(); replyTo = { name: tx.from, at: Date.now() };
    return { reply: `${tx.from} says: "${tx.body}"`, open: true };   // (replying by voice isn't built yet, so it isn't offered)
  }
  if (tx && /^(no|nope|not now|later|don'?t|skip|never ?mind)\b/.test(q)) { phone.clear(); return { reply: "Okay. It'll be there when you want it." }; }
  if (/\b(read (me )?(my |the )?(last|latest|new|recent) (text|message)s?|who (just )?texted me|any (new )?texts?)\b/.test(q)) {
    const m = phone.last();
    if (!m) return { reply: "No new texts since I started listening to your phone." };
    replyTo = { name: m.from, at: Date.now() };
    return { reply: `Your last text was from ${m.from}: "${m.body}"`, open: true };
  }
  const saidWhat = /\bwhat did ([a-z][a-z .'-]+?) (say|text)\b/.exec(q);
  if (saidWhat) { const m = phone.lastFrom(saidWhat[1]); if (m) { replyTo = { name: m.from, at: Date.now() }; return { reply: `${m.from} said: "${m.body}"`, open: true }; } }
  // "reply saying I'll be there at 7" / "text her back and say sounds good" → a draft to whoever just texted
  const rep = /^(?:yes,? )?(?:reply|respond|text (?:him|her|them) back|tell (?:him|her|them)|write back)(?: and say| saying| that|:)?\s+(.+)$/.exec(t.replace(/[.!?]+$/, ""));
  if (rep && replyTo && Date.now() - replyTo.at < 20 * 60_000) return messages.setDraft(replyTo.name, rep[1].charAt(0).toUpperCase() + rep[1].slice(1) + (/[.!?]$/.test(rep[1]) ? "" : "."));
  if (replyTo && /^(no|nope|no thanks|not now|i'?m good)\b/.test(q) && Date.now() - replyTo.at < 2 * 60_000) { replyTo = null; return { reply: "Okay." }; }

  // ---- a message waiting for "yes, send it" ----
  const m = await messages.handle(t);
  if (m) return m;

  // ---- a recitation in progress ----
  if (quiz && Date.now() - quiz.at < 5 * 60_000) {
    const done = quiz; quiz = null;
    if (/^(skip|never ?mind|stop|not now|cancel)\b/.test(q)) return { reply: "Okay, we'll try it later." };
    const r = memorize.check(t, done.verses);
    if (r.score >= 90) return { reply: pick([`Nailed it! ${r.score} percent. That's ${done.ref} locked in.`, `Beautiful. ${r.score} percent on ${done.ref}.`, `Word for word, basically. ${r.score} percent!`]) + (r.score >= 95 ? " Want to move on to the next verses? Just say \"I've got it.\"" : "") };
    if (r.score >= 65) return { reply: `Close! ${r.score} percent. You missed a few words: ${r.missed.slice(0, 5).join(", ")}. Here it is once more: ${done.verses.map((v) => v.text).join(" ")}` };
    return { reply: `That's a start, ${r.score} percent. Let's hear it again together: ${done.verses.map((v) => v.text).join(" ")} Try it once more whenever you're ready. Say "quiz me".` };
  }

  // ---- memory verses ----
  if (/\b(quiz me|test me|let me recite|check my (memory )?verses?|hear my verses?)\b/.test(q)) {
    const p = memorize.quizPrompt(today());
    if (!p) return { reply: "There's nothing to recite yet." };
    quiz = { verses: p.verses, ref: p.ref, at: Date.now() };
    return { reply: p.spoken, open: true };
  }
  if (/\b(i'?ve got it|i got it( down)?|i know (it|them|these)( now)?|got (it|them) down|move on to the next verses?|next verses?)\b/.test(q) && /\b(verse|memor|got it|know)\b/.test(q)) {
    const t2 = memorize.gotIt(today());
    return { reply: `Great work! Moving on. ${memorize.spokenFocus(today())} ${t2.kind === "learn" ? t2.verses.map((v) => v.text).join(" ") : ""}`.trim() };
  }
  if (/\b(need (more|another|a few more) (time|day|days)|not ready to move on|slow (it|this) down|stay on (these|this|them))\b/.test(q)) {
    memorize.moreTime(today());
    return { reply: "No rush. We'll stay on these tomorrow too. Slow and steady wins this one." };
  }
  if (/\b(what am i memoriz\w*|what (are )?my memory verses?|what'?s my memory verse|read (me )?my (memory )?verses?|memory verses? (for )?today)\b/.test(q)) {
    const t2 = memorize.today(today());
    return { reply: `${memorize.spokenFocus(today())} ${t2.verses.slice(0, 8).map((v) => v.text).join(" ")}` };
  }
  if (/\b(memory|memoriz\w*) (plan|progress|schedule)\b|\bhow (am i|far am i) (doing )?(on|with) (my )?memoriz/.test(q)) {
    const s = memorize.status(today()), p = s.today.progress;
    return { reply: `You're on ${p.chapter}, chunk ${p.chunk} of ${p.chunks}. ${p.chaptersDone} chapters finished so far, ${Math.round((p.versesDone / p.versesTotal) * 1000) / 10} percent of the whole list. Next up: ${s.next.slice(1, 4).map((c) => c.ref).join(", ")}.` };
  }

  // ---- church ----
  const study = /\bwe'?re (now )?(on|in|studying|starting|doing) ((?:[1-3] )?[a-z]+)(?: chapter)? (\d+)\b/.exec(q);
  if (study) {
    const day = /\bwednesday|wed\b/.test(q) ? "wed" : /\bmonday|young\b/.test(q) ? "mon" : /\bsunday\b/.test(q) ? "sun" : null;
    const book = study[3].replace(/\b\w/g, (c) => c.toUpperCase());
    const st = church.studies();
    const slot = day ?? Object.keys(st).find((k) => st[k]?.book?.toLowerCase() === book.toLowerCase()) ?? "sun";
    church.setStudy(slot, { book, chapter: Number(study[4]), asOf: today() });
    return { reply: `Got it: ${{ sun: "Sunday mornings", wed: "Wednesday nights", mon: "the Monday young people's study" }[slot]} are in ${book} ${study[4]}.` };
  }
  if (/\b(help me )?(get ready|prepare|prep)( my (mind|heart|focus))? for (church|worship|sunday|wednesday|bible study|tonight|this morning|class)\b/.test(q)) return churchtalk.start("prep", q);
  if (/\b(review|talk (about|through)|go over|recap)( on)? (sunday'?s?|wednesday'?s?|monday'?s?|tonight'?s?|this morning'?s?|the) (lesson|sermon|study|class|chapter)\b/.test(q)) return churchtalk.start("recap", q);
  const notesM = /\bwhat did (we|i) (talk about|say|learn) (on|about|from) (.+)$/.exec(q);
  if (notesM) {
    const n = churchtalk.notesFor(notesM[4]);
    if (n.length) return { reply: `On ${n[0].passage}, you said: ${n.slice(-3).map((x) => `"${x.a}"`).join(" and ")}.` };
  }
  const lesson = /\b(help me )?(prepare|prep|write|build|put together|plan|draft) (a |the )?(lesson|study|devotional|talk|class)( for (.+?))?( on| about| from| over) (.+)$/.exec(q)
    || /\b(help me )?(prepare|prep|plan) (a |the )?(lesson|study)( for (monday|wednesday|sunday|the young people'?s?)[^,]*)?$/.exec(q);
  if (lesson) {
    const topic = lesson[8] ?? church.studies().mon?.book;
    if (!topic) return { reply: "Sure. What passage or topic should the lesson cover?", open: true };
    const r = await churchtalk.lessonScaffold(topic.replace(/\bchapter\b/, "").trim(), { audience: lesson[6] ?? "" });
    return { reply: `I started a lesson on ${r.title} in your notes folder, with the text, an outline, and discussion questions to fill in. Once my AI brain is back, I can draft the whole thing with you.`, file: r.file };
  }

  // ---- people: the owner's answer to "How's Jordan doing?" (asked now and then), and things they tell about people ----
  const pq = special.pendingQuestion();
  if (pq && !/^(dayspring|hey dayspring)\b/.test(q)) {
    special.clearQuestion();
    if (/^(skip|not now|later|never ?mind|pass)\b/.test(q)) return { reply: "No problem. Another time." };
    if (/\b(i )?(don'?t|do not) (really )?know|no idea|not sure|i'?m not sure|haven'?t (heard|talked)|no clue\b/.test(q)) {
      special.recordUnknown(pq.name, pq.topic);
      const nudge = Math.random() < 0.6;
      return { reply: nudge ? pick([`That's okay. Maybe reach out to ${pq.name} this week and find out. A quick text goes a long way.`, `Fair enough. Could be a good excuse to check in with ${pq.name} soon.`, `No worries. I'll make a note. If you get a chance, ask how ${pq.name}'s doing, and tell me what you hear.`]) : `Okay, I'll make a note that we don't know yet.` };
    }
    if (pq.topic === "birthday") {
      const day = special.parseDay(t);
      if (day) { special.addPerson({ name: pq.name, birthday: day.md, year: day.year }); return { reply: `Got it: ${pq.name}'s birthday is ${special.monthName(day.md)}. I'll remind you.` }; }
    }
    if (pq.topic === "know") { special.ensurePerson(pq.name, { relation: t.replace(/^(he'?s|she'?s|they'?re|that'?s|it'?s)\s+/i, "").slice(0, 120) }); special.addNote(pq.name, t, "told"); return { reply: pick([`Got it. Thanks for telling me about ${pq.name}.`, `Okay, that helps. I'll remember that.`]) }; }
    special.addNote(pq.name, t, "told");
    return { reply: pick([`Thanks. I'll keep that in mind, and in prayer.`, `Got it. I saved that for ${pq.name}.`, `Okay. Good to know. I'll remember that.`]) };
  }
  const about = /\b(?:tell me about|what do (?:you|we) know about|who is|who'?s) ([a-z][a-z .'-]+?)\??$/.exec(q);
  if (about && !/\b(this|that) (photo|picture)\b/.test(q)) {
    const p = special.profileOf(about[1]);
    if (p) {
      const bits = [p.relation ? `${p.name} is ${p.relation}.` : null, p.birthday ? `Birthday: ${special.monthName(p.birthday)}.` : null,
        ...p.notes.slice(-3).map((n) => n.text), p.unknown.length ? `We still don't know: ${[...new Set(p.unknown.map((u) => ({ know: "how you know them", birthday: "their birthday", how: "how they're doing", pray: "what to pray for", detail: "much about them" }[u.topic])))].join(", ")}.` : null].filter(Boolean);
      return { reply: bits.join(" ") || `I've got ${p.name} on file but I don't know much yet. Tell me about them!`, open: !bits.length };
    }
  }
  const rel = /^([a-z][a-z'-]+(?: [a-z][a-z'-]+)?) is my ([a-z' -]{3,40})$/.exec(q);
  const relName = rel && !/^(how|what|who|where|when|why|this|that|it|there|here|today|tomorrow|everything|nothing)\b/.test(rel[1]) && !/\b(birthday|name)\b/.test(rel[1])
    && (special.profileOf(rel[1]) || new RegExp(`\\b${rel[1].split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}\\b`).test(t));
  if (relName) { const p = special.ensurePerson(cap(rel[1]), { relation: `your ${rel[2]}` }); return { reply: `Got it: ${p.name} is your ${rel[2]}.` }; }
  const tell = /^(?:remember|note|just so you know|fyi)(?: that)? (.+)$/.exec(q);
  if (tell && !/\bbirthday\b/.test(q)) {
    const who = special.mentionsIn(tell[1])[0];
    if (who) { special.addNote(who.name, tell[1], "told"); return { reply: `Got it. I added that to ${who.name}'s notes.` }; }
  }
  const newP = /\b(?:add|put) ([a-z][a-z .'-]+?) (?:on|to) my prayer list(?: for (.+))?$/.exec(q) || /\bpray for ([a-z][a-z .'-]+?)(?: (?:who|because|since|for) (.+))?$/.exec(q);
  if (newP && !/\b(today|tonight|me|us|morning|evening|night)\b/.test(newP[1]) && !/^(what|who|should|do|did|can|am|how)\b/.test(q)) {
    const name = cap(newP[1].trim()), why = newP[2]?.trim();
    special.ensurePerson(name, { prayer: why ? [why] : [] });
    if (why) special.addNote(name, `Prayer request: ${why}`, "told");
    morning.addPrayer({ title: name, detail: why ? cap1(why) : `Whatever ${name} needs today.`, people: [name] });
    return { reply: `Added ${name} to your prayer list${why ? `, for ${why}` : ""}. ${why ? "" : "Anything specific I should know about what's going on?"}`.trim(), open: !why };
  }
  const friend = /\bmy (friend|buddy|coworker|co-worker|cousin|aunt|uncle|boss|neighbor|roommate|teacher|student|pastor|mentor) ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/.exec(t);
  if (friend) { const p = special.profileOf(friend[2]); if (!p) { special.ensurePerson(friend[2], { relation: `your ${friend[1]}` }); special.addNote(friend[2], t, "mentioned"); } }
  if (/\bask me about (someone|somebody|a person|people)\b/.test(q)) {
    const p = special.pickToAsk();
    if (p) { const qq = special.questionFor(p); special.markAsking(p, qq.topic); return { reply: qq.text, open: true }; }
  }

  // ---- birthdays and special days ----
  const bd = /\b(?:remember|save|add|note)(?: that)? ([a-z][a-z .'-]+?)(?:'s| s)? birthday (?:is )?(?:on )?(.+)$/.exec(q);
  if (bd) {
    const day = special.parseDay(bd[2]);
    if (!day) return { reply: `What day is ${bd[1]}'s birthday? Like "March 3rd".`, open: true };
    const r = special.addPerson({ name: bd[1], birthday: day.md, year: day.year });
    return { reply: `${r.updated ? "Updated" : "Got it"}: ${r.person.name}'s birthday is ${special.monthName(day.md)}. I'll remind you that morning.` };
  }
  if (/\bwhen is ([a-z][a-z .'-]+?)'?s birthday\b/.test(q)) {
    const n = /\bwhen is ([a-z][a-z .'-]+?)'?s birthday\b/.exec(q)[1], p = special.findPerson(n);
    return { reply: p ? `${p.name}'s birthday is ${special.monthName(p.birthday)}.` : `I don't know ${n}'s birthday yet. Tell me and I'll remember it.` };
  }
  if (/\b(whose|any) birthdays? (is |are )?(coming up|soon|this (week|month))|\bupcoming birthdays\b/.test(q)) {
    const up = special.upcoming(today(), 30).filter((x) => x.kind === "birthday");
    return { reply: up.length ? `Coming up: ${up.slice(0, 4).map((x) => `${x.person} on ${new Date(x.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`).join(", ")}.` : "No birthdays I know of in the next month." };
  }
  if (/\bwhat'?s (special|unique|going on) (about |on )?today\b|\bis today special\b|\bany holidays?\b/.test(q)) {
    const s = special.spokenToday(today()), up = special.upcoming(today(), 14)[0];
    return { reply: s ?? `Nothing on the calendar makes today special, so it's up to you.${up ? ` Next up is ${up.title} on ${new Date(up.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.` : ""}` };
  }
  return null;
}
