// What Dayspring is feeling as it says something (expression mode, lib/looks/expressions.mjs): a small local classifier
// over the words of the reply, plus the AI's own hint when one came with it, plus what just happened (a badge, an
// alarm, an error). Nothing leaves the computer for this.
//
//   EMOTIONS                          the emotions and their words (for search queries and for checking a GIF fits)
//   classify(text, { hint, event })   → { emotion, confidence 0..1, scores, why }
//   forEvent(name)                    → the emotion an event means ("badge" → celebrate, "alarm" → alert, "error" → oops)
//   extractHint(reply)                → { text, mood } when the AI began its reply with a ⟪mood:…⟫ tag (the tag is removed)

// label: for Settings · words: search words (the reaction itself) · clash: words that mean the opposite (a GIF titled
// with them doesn't fit this emotion) · voice: the orb mood it goes with
export const EMOTIONS = {
  excited:   { label: "Excited", words: ["excited", "so excited", "yay", "hype", "lets go"], clash: ["sad", "crying", "cry", "sleepy", "bored", "angry", "funeral", "rip"] },
  happy:     { label: "Happy", words: ["happy", "smile", "joy", "cheerful", "good vibes"], clash: ["sad", "crying", "angry", "mad", "rip", "funeral"] },
  proud:     { label: "Proud", words: ["proud", "well done", "nice work", "impressed", "good job"], clash: ["sad", "fail", "disappointed", "crying", "angry"] },
  celebrate: { label: "Celebrating", words: ["celebrate", "celebration", "party", "confetti", "victory dance", "congratulations"], clash: ["sad", "crying", "angry", "funeral", "rip", "sleepy"] },
  thinking:  { label: "Thinking / questioning", words: ["thinking", "hmm", "curious", "pondering", "wondering"], clash: ["party", "crying", "angry"] },
  confused:  { label: "Confused", words: ["confused", "what", "huh", "puzzled", "scratching head"], clash: ["party", "celebrate", "crying"] },
  surprised: { label: "Surprised", words: ["surprised", "wow", "shocked", "no way", "mind blown"], clash: ["sleepy", "bored", "crying"] },
  sad:       { label: "Sad / sympathetic", words: ["sympathy", "sad", "hug", "sorry", "comfort"], clash: ["party", "celebrate", "lol", "laughing", "dance", "yay", "happy dance"] },
  upset:     { label: "Upset (gently)", words: ["annoyed", "grumpy", "frustrated", "ugh", "sigh"], clash: ["party", "celebrate", "love", "yay", "violence", "fight", "punch", "gun"] },
  sleepy:    { label: "Sleepy", words: ["sleepy", "yawn", "tired", "good night", "nap"], clash: ["party", "excited", "hype", "angry"] },
  laughing:  { label: "Laughing", words: ["laughing", "lol", "funny", "giggle", "haha"], clash: ["crying", "sad", "angry", "funeral"] },
  encourage: { label: "You got this", words: ["you got this", "you can do it", "keep going", "believe", "cheering"], clash: ["fail", "give up", "crying", "angry", "loser"] },
  grateful:  { label: "Grateful", words: ["thank you", "thanks", "grateful", "appreciate", "bow"], clash: ["angry", "crying", "annoyed"] },
  greeting:  { label: "Hello", words: ["hello", "hi", "wave", "good morning", "howdy"], clash: ["bye", "goodbye", "crying", "angry"] },
  goodbye:   { label: "Goodbye", words: ["bye", "goodbye", "see you", "wave goodbye", "later"], clash: ["hello", "angry", "crying"] },
  oops:      { label: "Oops", words: ["oops", "my bad", "whoops", "fail", "facepalm"], clash: ["party", "celebrate", "violence", "blood"] },
  alert:     { label: "Heads up", words: ["alert", "attention", "wake up", "heads up", "alarm"], clash: ["sleepy", "nap", "crying", "gun", "explosion"] },
  agree:     { label: "Okay / yes", words: ["thumbs up", "yes", "okay", "nod", "sounds good"], clash: ["no", "nope", "angry", "crying"] },
};
export const EMOTION_IDS = Object.keys(EMOTIONS);

// the rules: [emotion, weight, pattern] over the reply (lower-cased)
const R = (e, w, re) => ({ e, w, re });
const RULES = [
  R("celebrate", 3, /\b(congrat\w*|you did it|we did it|celebrat\w*|new badge|level(ed)? up|milestone|hooray|woo+ ?hoo+|party time)\b/),
  R("celebrate", 1.5, /\b(streak|record|finished (the|your) (course|book|goal)|all done for today)\b/),
  R("proud", 2.5, /\b(proud of you|well done|nice work|great job|good job|nailed it|crushed it|way to go|impressive|you earned)\b/),
  R("excited", 2.2, /\b(so excited|can'?t wait|let'?s go+|this is (so )?(great|amazing|awesome)|awesome|amazing|fantastic|yay|woo+|yeehaw|oh boy)\b/),
  R("excited", 0.6, /!{2,}/),
  R("happy", 1.4, /\b(glad|happy|lovely|wonderful|delighted|nice|great news|good news|sounds great|beautiful day|sunny)\b/),
  R("laughing", 2.6, /\b(haha+|hehe+|lol|lmao|that'?s (so )?funny|cracks me up|good one|hilarious|ha ha|knock[- ]knock|punchline)\b/),
  R("laughing", 1.2, /\b(joke|kidding|pun)\b/),
  R("thinking", 2, /\b(let me think|hmm+|good question|i wonder|thinking|let'?s see|interesting question|ponder\w*|curious)\b/),
  R("thinking", 0.9, /\?\s*$/),
  R("confused", 2.3, /\b(i'?m not sure|not sure what you mean|i didn'?t (catch|understand|get) that|confus\w*|which one did you mean|what do you mean|say that again|puzzl\w*)\b/),
  R("surprised", 2.2, /\b(wow+|whoa+|no way|really\?|oh my|what a surprise|surpris\w*|unbelievable|incredible|mind[- ]blown|holy cow)\b/),
  R("sad", 2.6, /\b(i'?m (so )?sorry|that'?s (really )?(hard|tough|sad|rough)|sorry to hear|my condolences|i'?m here for you|hang in there|sending (you )?(love|hugs)|that hurts|heavy day|grief|loss)\b/),
  R("upset", 2.1, /\b(ugh+|annoying|frustrat\w*|that'?s not (okay|fair)|grr+|argh+|seriously\?|not again|come on)\b/),
  R("sleepy", 2.3, /\b(good ?night|sleep (well|tight)|time for bed|bedtime|yawn|so tired|sleepy|sweet dreams|get some rest|nap)\b/),
  R("encourage", 2.5, /\b(you('?ve)? got this|you can do (it|this)|keep (it up|going)|don'?t give up|believe in you|one step at a time|almost there|you'?re doing (great|well)|go get (it|'em|them))\b/),
  R("grateful", 2.3, /\b(thank you|thanks( so much)?|i appreciate|grateful|much obliged|you'?re welcome)\b/),
  R("greeting", 2.4, /^(hi|hey|hello|howdy|good (morning|afternoon|evening)|welcome back|greetings)\b/),
  R("greeting", 1, /\b(good morning|welcome back|nice to see you)\b/),
  R("goodbye", 2.4, /\b(good ?bye|bye( for now)?|see you (later|soon|tomorrow)|talk (to you )?(later|soon)|take care|catch you later|farewell|until next time)\b/),
  R("oops", 2.6, /\b(oops|whoops|my bad|my mistake|something went wrong|that didn'?t work|i couldn'?t|i can'?t (reach|find|do)|error|failed|isn'?t working|went wrong)\b/),
  R("alert", 2.6, /\b(heads up|reminder:|time to|wake up|your alarm|don'?t forget|starts in|it'?s time|attention|urgent|leave now)\b/),
  R("agree", 1.5, /^(okay|ok|sure|done|got it|you got it|will do|sounds good|all set|alright|yes|yep|absolutely|of course|on it)\b/),
];
const EVENT = { badge: "celebrate", levelup: "celebrate", streak: "celebrate", award: "proud", goal: "proud", alarm: "alert", reminder: "alert", timer: "alert", error: "oops", offline: "oops", morning: "greeting", welcome: "greeting", night: "sleepy", goodbye: "goodbye", joke: "laughing", checkin: "encourage", focus: "encourage", thanks: "grateful" };
export const forEvent = (name) => EVENT[String(name ?? "").toLowerCase()] ?? null;

export function classify(text, { hint = null, event = null } = {}) {
  const q = String(text ?? "").toLowerCase().replace(/[’‘]/g, "'").trim();
  const scores = Object.fromEntries(EMOTION_IDS.map((e) => [e, 0]));
  const why = [];
  for (const r of RULES) { const m = r.re.exec(q); if (m) { scores[r.e] += r.w; why.push(`${r.e}: "${m[0].trim().slice(0, 30)}"`); } }
  // a lot of exclamation marks and no sadness: excitement
  const bangs = (q.match(/!/g) ?? []).length;
  if (bangs >= 1 && scores.sad < 1 && scores.oops < 1) scores.excited += Math.min(1.2, bangs * 0.4), scores.happy += 0.3;
  // the AI's own hint weighs a lot, but a clear rule can still win (it's a hint)
  const h = String(hint ?? "").toLowerCase().trim();
  const hintId = EMOTIONS[h] ? h : ALIASES[h] ?? null;
  if (hintId) { scores[hintId] += 2.8; why.push(`${hintId}: the AI's hint`); }
  const ev = forEvent(event);
  if (ev) { scores[ev] += 5; why.push(`${ev}: event ${event}`); }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, s1] = ranked[0], s2 = ranked[1][1];
  if (s1 <= 0) return { emotion: null, confidence: 0, scores, why };
  // confidence: how strong, and how far ahead of the next one
  const confidence = Math.max(0, Math.min(1, (s1 / 3.2) * (0.55 + 0.45 * Math.min(1, (s1 - s2) / Math.max(1, s1)))));
  return { emotion: top, confidence: Math.round(confidence * 100) / 100, scores, why };
}
const ALIASES = { joy: "happy", glad: "happy", celebrating: "celebrate", party: "celebrate", question: "thinking", questioning: "thinking", curious: "thinking", puzzled: "confused",
  shocked: "surprised", wow: "surprised", sympathetic: "sad", sympathy: "sad", sorry: "sad", annoyed: "upset", frustrated: "upset", angry: "upset", tired: "sleepy",
  funny: "laughing", laugh: "laughing", encouraging: "encourage", motivating: "encourage", thanks: "grateful", hello: "greeting", hi: "greeting", bye: "goodbye",
  error: "oops", mistake: "oops", warning: "alert", urgent: "alert", yes: "agree", ok: "agree", okay: "agree", calm: null, neutral: null };

// ⟪mood:excited⟫ (or [mood: excited]) at the very start of a reply: the AI's hint, taken off before anyone sees it
const HINT = /^\s*(?:⟪|\[\[?|\{)\s*mood\s*[:=]\s*([a-z-]{2,20})\s*(?:⟫|\]\]?|\})\s*/i;
export function extractHint(reply) {
  const s = String(reply ?? "");
  const m = HINT.exec(s);
  if (!m) return { text: s, mood: null };
  const raw = m[1].toLowerCase();
  const mood = EMOTIONS[raw] ? raw : ALIASES[raw] ?? null;
  return { text: s.slice(m[0].length), mood };
}
// the line the AI gets while expression mode is on (so it can say how it feels; nobody sees the tag)
export const PROMPT_LINE = `Begin every reply with a hidden mood tag, exactly like ⟪mood:happy⟫, naming the feeling of your reply: one of ${EMOTION_IDS.join(", ")}, or neutral. It is removed before anyone sees or hears the reply; never mention it.`;
