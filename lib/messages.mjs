// Messages by voice: "wish Sam a happy birthday", "send Jordan some encouragement", "text Alex that I'll be late".
// Dayspring drafts it, reads it back, and sends only after a clear yes. "Change it to…" rewrites it; "no" drops it.
// Sending goes through Phone Link (the owner's phone, paired over Bluetooth). Until that's paired and tested, it says so
// honestly and keeps the draft so nothing is lost. With Claude, the model can polish the draft (draft_message tool).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as phonelink from "./phonelink.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "messages.json");
let db = null;
function load() { if (!db) db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { sent: [], drafts: [] }; return db; }
function save() { writeJSONAtomic(FILE, load(), 2); }
let pending = null;   // { to, body, at }
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const BIRTHDAY = [
  "Happy birthday, {n}! Hope you have a wonderful day and a blessed year ahead.",
  "Happy birthday, {n}! Praying God blesses you this year. Enjoy your day!",
  "Happy birthday, {n}! Thankful for you. Hope it's a great one.",
];
const ENCOURAGE = [
  "Hey {n}, just wanted you to know I'm praying for you today. Hang in there.",
  "Hey {n}, thinking about you and praying for you. You're not alone in this.",
  "{n}, just a note to say I'm praying for you, and I'm here if you need anything.",
];
// "I'll be late" → the message they'd send, in their voice
function fromGist(name, gist) {
  let g = gist.trim().replace(/^(that|to say|saying)\s+/i, "");
  g = g.replace(/\bhe'?s\b/gi, "you're").replace(/\bshe'?s\b/gi, "you're");
  g = g.charAt(0).toUpperCase() + g.slice(1);
  if (!/[.!?]$/.test(g)) g += ".";
  return `Hey ${name}, ${g.charAt(0).toLowerCase() + g.slice(1)}`.replace(/^Hey (\w+), i\b/, "Hey $1, I");
}

// Start a draft from what they said. Returns { reply, open } or null.
export function draftFrom(text) {
  const q = String(text).trim();
  let m;
  if ((m = /\b(?:wish|tell|text|send|message) ([A-Za-z][A-Za-z .'-]+?) (?:a )?happy birthday\b/i.exec(q)) || (m = /\bsend (?:a )?happy birthday (?:text |message )?to ([A-Za-z][A-Za-z .'-]+?)\b\.?$/i.exec(q))) {
    return start(cap(m[1].trim()), pick(BIRTHDAY).replace("{n}", cap(m[1].trim().split(" ")[0])));
  }
  if ((m = /\b(?:send|text|message) ([A-Za-z][A-Za-z .'-]+?) (?:some |a (?:note|message|text) of |an? )?(?:encouragement|encouraging (?:note|message|text))\b/i.exec(q)) || (m = /\b(?:encourage|send encouragement to) ([A-Za-z][A-Za-z .'-]+?)\b\.?$/i.exec(q))) {
    return start(cap(m[1].trim()), pick(ENCOURAGE).replace("{n}", cap(m[1].trim().split(" ")[0])));
  }
  if ((m = /\b(?:text|message|send a (?:text|message) to|tell) ([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:that |to say |saying )(.+)$/.exec(q)) || (m = /\b(?:text|message) ([A-Za-z]+) (.{4,})$/i.exec(q))) {
    return start(cap(m[1].trim()), fromGist(cap(m[1].trim().split(" ")[0]), m[2]));
  }
  return null;
}
function start(to, body) {
  pending = { to, body, at: Date.now() };
  return { reply: `Here's what I'd send to ${to}: "${body}" Want me to send it?`, open: true };
}
export const draft = () => pending;
export function setDraft(to, body) { return start(to, body); }

// Follow-ups: yes / no / change it.
export async function handle(text) {
  const q = String(text).trim().toLowerCase().replace(/[.!?]+$/, "");
  if (!pending || Date.now() - pending.at > 10 * 60_000) { pending = null; return draftFrom(text); }
  const change = /^(?:change it to|make it say|instead say|say) (.+)$/i.exec(String(text).trim());
  if (change) { pending.body = change[1].trim(); pending.at = Date.now(); return { reply: `Okay: "${pending.body}" Send it?`, open: true }; }
  if (/^(no|nope|don'?t|cancel|never ?mind|scratch that|forget it)\b/.test(q)) { load().drafts.push({ ...pending, dropped: true }); save(); pending = null; return { reply: "Okay, I won't send it." }; }
  if (/^(yes|yeah|yep|sure|send it|go ahead|do it|sounds good|perfect|that'?s good)\b/.test(q)) {
    const p = pending; pending = null;
    const r = await phonelink.send(p.to, p.body);
    if (r.sent) { load().sent.push({ ...p, at: new Date().toISOString() }); save(); return { reply: pick([`Sent to ${p.to}.`, `Done. ${p.to} has it.`, `Message sent.`]) }; }
    load().drafts.push({ ...p, at: new Date().toISOString(), why: r.why }); save();
    return { reply: `I couldn't send it: ${r.why} I saved the message so it isn't lost. It says: "${p.body}"` };
  }
  return draftFrom(text);
}
