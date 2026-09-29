// Ending the conversation: "thanks", "that's all", "no that's fine", "never mind", "bye", "good night", "stop listening
// for now", "we're done", "perfect, thanks"… on their own, or tacked onto a request ("set a timer for 5 minutes, thanks").
// Dayspring then answers briefly (nothing extra when it was tacked on), asks no follow-up question, and closes the
// listening window right away instead of waiting for more.
//   closing(text) → null | { only: true, kind, ack } | { appended: true, rest, kind }
// Look-alikes that are NOT an ending: "thanks for the reminder, now set a timer" (thanks, then a request: the request is
// handled, the thanks dropped: see lead()), "never mind the timer, cancel it" (a cancel), "remind me to say thank you",
// "play See You Again", "set an alarm called goodbye" (the words are the content).

const CONTR = [[/ (that|what|it|there|he|she|who)'?s /g, " $1 is "], [/ i'?m /g, " i am "], [/ (we|you|they)'re /g, " $1 are "], [/ that'?ll /g, " that will "],
  [/ don'?t /g, " do not "], [/ doesn'?t /g, " does not "], [/ isn'?t /g, " is not "], [/ can'?t /g, " cannot "]];
export function clean(t) {
  let s = ` ${String(t ?? "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  for (let i = 0; i < 2; i++) for (const [re, to] of CONTR) s = s.replace(re, to);    // twice: back-to-back matches share a space
  return s.replace(/'/g, "").replace(/\s+/g, " ").trim();
}

// each is a whole unit; they can be chained ("okay that is all thanks dayspring")
const THANKS = "(?:thanks|thank you|thank ya|thankyou|thx|ty|cheers|much appreciated|appreciate it|i appreciate it|many thanks)(?: (?:so|very) much| a lot| a bunch| a ton| again| a million| kindly| dayspring| buddy| friend)*";
const DONE = "(?:that is all|that is it|that is everything|that will be all|that will do|that will be it|that is all i need(?:ed)?|that is all for now|that is it for now|that is all for today|nothing else|nothing more|no more|i am good|i am all set|i am done|i am set|all good|all set|all done|we are done|we are good|we are all set|we are finished|done for now|i am finished|that is enough|that should do it|that does it|that is perfect|that is great|that is fine|that works|sounds good|got it|you can go|you can stop listening|stop listening for now|you can stop now|no follow up|nothing for now|not right now|nope that is it|no that is it|no that is all|no that is fine|no that is ok|no that is okay|no that is good|no thanks|no thank you|no i am good|nah i am good|never ?mind|forget it|forget about it|cancel that|scratch that)";
const BYE = "(?:good ?bye|bye(?: bye| now| for now)?|see (?:you|ya)(?: later| soon| tomorrow| in the morning| around)?|later(?: dayspring)?|talk (?:to you )?(?:later|soon|tomorrow)|catch you later|until next time|peace out|take care|have a good (?:one|day|night|evening))";
const NIGHT = "(?:good ?night|night night|nighty night|sleep well|sweet dreams)";
const SOFT = "(?:ok|okay|alright|all right|cool|great|perfect|awesome|nice|excellent|wonderful|fantastic|sweet|good|yep|yeah|oh|well|and|so|no|nope|nah)";
const TAIL = "(?:dayspring|buddy|friend|then|for now|for today|again|very much|so much|that is all|that is it)";
const UNIT = `(?:${THANKS}|${DONE}|${BYE}|${NIGHT})`;
const THANKS_FOR_RE = new RegExp(`^(?:${SOFT} )*(?:${THANKS}) for (?:[a-z]+ ){0,7}[a-z]+(?: (?:${TAIL}))?$`);
const ONLY_RE = new RegExp(`^(?:${SOFT} )*(?:${UNIT})(?: (?:${SOFT} )*(?:${UNIT}|${TAIL}))*$`);
// bare "okay", "cool", "perfect", "great"…: an ending only when nothing is waiting for an answer (then it may be a yes)
const SOFT_ONLY_RE = new RegExp(`^(?:${SOFT}|got it|sounds good|good stuff|very good|ok cool|okay cool|cool cool|perfect perfect)(?: ${SOFT})*(?: ${TAIL})?$`);
// tacked onto a request: only the clear enders ("thanks", "that's all", "bye"), never "later", "okay" or "good"
const APPEND_UNIT = `(?:${THANKS}|that is all|that is it|that will be all|that is everything|nothing else|i am good|we are done|that is all i need(?:ed)?|good ?bye|bye(?: bye| now| for now)?|see you(?: later| soon| tomorrow)?|${NIGHT})`;
const APPEND_RE = new RegExp(`^(.*\\S)\\s+(?:(?:and|ok|okay|alright|cool|great|perfect|awesome|then|so) )*(?:${APPEND_UNIT})(?: (?:${APPEND_UNIT}|${TAIL}))*$`);
// the words before an ending that make the ending part of the content: "remind me to say thanks", "a song called goodbye"
const CONTENT_BEFORE = /\b(to|say|said|tell|telling|told|text|message|send|write|note|called|named|titled|label(?:ed|led)?|about|play|playing|song|by|the|a|an|my|of|with|for|that|saying|words?|reply|answer|type|spell|is|was)$/;

function kindOf(q) {
  if (/^(no|nope|nah)\b/.test(q)) return "done";
  if (new RegExp(`\\b${NIGHT}\\b`).test(q)) return "night";
  if (new RegExp(`(^| )${BYE}( |$)`).test(q)) return "bye";
  if (new RegExp(`\\b${THANKS}\\b`).test(q)) return "thanks";
  if (/\bnever ?mind\b|\bforget (it|about it)\b|\bcancel that\b|\bscratch that\b/.test(q)) return "nevermind";
  return "done";
}
const ACKS = {
  thanks: ["You're welcome!", "Anytime!", "Happy to help!", "You're welcome."],
  bye: ["Bye for now!", "See you later!", "Talk to you later!", "Bye!"],
  night: ["Good night!", "Good night. Sleep well!", "Sweet dreams!"],
  nevermind: ["Okay, never mind.", "No problem.", "Okay."],
  done: ["Okay!", "Sounds good.", "Alright.", "Okay."],
};
let turn = 0;
export const ackFor = (kind) => { const a = ACKS[kind] ?? ACKS.done; return a[turn++ % a.length]; };

// { pending: true } when Dayspring is waiting for an answer: a bare "okay" / "sure" is then an answer, not an ending
export function closing(text, { pending = false } = {}) {
  const q = clean(text);
  if (!q || q.split(" ").length > 30) return null;
  if (ONLY_RE.test(q)) {
    // "okay" / "no" / "yeah" on their own were caught by SOFT above only as a lead-in; they must have a real unit
    return { only: true, kind: kindOf(q), ack: ackFor(kindOf(q)), text: q };
  }
  // "thanks for the help", "thank you for setting that up" (and nothing asked after it)
  if (THANKS_FOR_RE.test(q) && !lead(text)) return { only: true, kind: "thanks", ack: ackFor("thanks"), text: q };
  if (!pending && SOFT_ONLY_RE.test(q) && !/^(no|nope|nah|yep|yeah|and|so|well|oh)$/.test(q)) return { only: true, kind: "done", ack: ackFor("done"), text: q, soft: true };
  const m = APPEND_RE.exec(q);
  if (m) {
    const rest = m[1].replace(/\s+(and|then|ok|okay|so)$/, "").trim();
    if (!rest || CONTENT_BEFORE.test(rest) || rest.split(" ").length < 2 || /^(text|message|tell (?!me\b)|send|reply|email|write|say|type|spell)\b/.test(rest)) return null;
    return { appended: true, rest: restIn(text, rest), kind: kindOf(q.slice(rest.length)), text: q };
  }
  return null;
}
// the request part in the owner's own words and capitals (the ending cut off the end)
function restIn(raw, restClean) {
  const words = restClean.split(" ").length;
  const toks = String(raw).trim().split(/\s+/);
  // walk the original words until the cleaned prefix is covered
  let n = 0, acc = "";
  while (n < toks.length && clean(acc).split(" ").filter(Boolean).length < words) acc = (acc + " " + toks[n++]).trim();
  return acc.replace(/[\s,;.!-]+$/, "").trim() || restClean;
}

// Gratitude or a change of mind in FRONT of a request: "thanks for the reminder, now set a timer for 10 minutes",
// "never mind, cancel the timer", "actually, make it 6". → the request alone (or null when there's no request after it).
// "never mind the timer, cancel it" → "cancel the timer".
const VERB = /^(set|add|remind|make|turn|cancel|delete|remove|schedule|what|whats|when|where|how|is|are|do|does|play|pause|start|stop|move|show|hide|open|close|put|change|switch|can|could|would|will|please|tell|read|call|text|book|create|let|give|go|use|skip|snooze|wake|find|search|look|check|clear|mark|rename|undo|repeat|keep)\b/;
const CONNECT = new Set(["and", "but", "also", "oh", "now", "then", "next", "ok", "okay", "so", "can", "could"]);
// the first place after the lead-in where a request starts ("… for the reminder | now set a timer …")
function requestAfter(words, from, maxSkip) {
  for (let k = from; k <= Math.min(words.length - 2, from + maxSkip); k++) {
    let j = k; while (j < words.length && CONNECT.has(words[j]) && !(words[j] === "can" || words[j] === "could")) j++;
    const rest = words.slice(j).join(" ");
    if (rest.split(" ").length >= 2 && VERB.test(rest) && (k === from || words[from] === "for" || j > k)) return rest;
  }
  return null;
}
export function lead(text) {
  const raw = String(text ?? "").trim();
  const q = clean(raw).replace(/^(?:(?:hey|ok|okay|hi) )?dayspring /, "").replace(/ please$/, "");
  let m = /^(?:ok(?:ay)? )?never ?mind (?:the |my |that |about the |about my )?(.+?) (?:just )?(cancel|delete|stop|remove|kill|turn off|get rid of|clear) (?:it|that|them)$/.exec(q);
  if (m) return { text: `${m[2]} the ${m[1]}`, why: "nevermind-cancel" };
  m = new RegExp(`^(?:(?:ok(?:ay)?|oh|great|perfect|cool|awesome) )?(?:${THANKS}) `).exec(q + " ");
  if (m) {
    const words = q.split(" "), start = m[0].trim().split(" ").length;
    const rest = requestAfter(words, start, 8);
    if (rest) return { text: tail(raw, rest), why: "thanks-then" };
  }
  m = /^(?:no |oh |wait |oops |sorry )?(?:never ?mind|scratch that|forget (?:it|that)|actually|wait|oops|sorry|no wait|hold on)(?: then)? (.+)$/.exec(q);
  if (m && VERB.test(m[1]) && m[1].split(" ").length >= 2) return { text: tail(raw, m[1]), why: "change-of-mind" };
  return null;
}
// the request in his own words: the last words of what he said, as many as the request has (a "please" said after it
// comes along: it was taken off the cleaned copy)
function tail(raw, cleaned) {
  const toks = String(raw).trim().split(/\s+/);
  const extra = / please[.!?]*$/i.test(String(raw).trim()) ? 1 : 0;
  const n = cleaned.split(" ").length + extra;
  return toks.slice(Math.max(0, toks.length - n)).join(" ").replace(/^[,;.!\s-]+/, "") || cleaned;
}

// a quick, conservative check the Dayspring screen also uses (public/tv.js keeps a copy): does this end with an ending?
export const ENDS_RE_SOURCE = `(?:${THANKS}|that is all|that is it|nothing else|good ?bye|bye|see you(?: later)?|${NIGHT}|we are done|i am good|no that is fine)$`;
