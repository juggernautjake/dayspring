// People's names in a meeting: how to call someone, and when to.
//
//   displayName("Rich Alvarez (Host)") → "Rich Alvarez"      firstName("Rich Alvarez") → "Rich"
//   callName("Jess Park", roster, { selfName: "Sam" })      → "Jess" (or "Jess Park" when two people are called Jess)
//   callName("You", roster, { selfName: "Sam" })            → "Sam"
//   callName("Unknown", …) / callName("", …)                → null  (never guess)
//
//   const policy = createNamePolicy();
//   policy.decide("Rich Alvarez") → true on the first answer to Rich, then about one answer in three, and never twice
//                                   in a row to the same person within two minutes. policy.note(key, used) records it.
//
//   opener("Rich", { style: "cowboy", kind: "answer", n }) → "Well howdy, Rich!"   (the name is used exactly as given)
//
// Names are shown the way the meeting shows them: never respelled or "corrected".

const UNKNOWN = /^(unknown|unknown speaker|someone|guest|presenter|presentation|speaker \d+|participant|\?+)$/i;
const SELF = /^(you|me|yourself)$/i;

// "Rich Alvarez (Host)", "Jess 🌟 Park", "Dr. Ann Lee - Acme", "Pat (they/them)" → the name as the person wrote it
export function displayName(raw) {
  let s = String(raw ?? "").replace(/[​-‏⁠﻿]/g, "");
  s = s.replace(/\((?:host|co-?host|presentation|presenting|you|me|guest|external|organi[sz]er|[a-z]+\/[a-z]+(?:\/[a-z]+)?)\)/gi, " ");
  s = s.replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u{FE0F}/gu, " ");
  s = s.replace(/\s+[-–—|·]\s+.*$/, "");                  // "Name - Company"
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
export function firstName(raw) {
  const d = displayName(raw).replace(/^(?:mr|mrs|ms|miss|mx|dr|prof|rev|pastor|fr)\.?\s+/i, "");
  const f = d.split(" ")[0] ?? "";
  return /[\p{L}]/u.test(f) ? f.replace(/[,.;:]+$/, "") : "";
}
export const nameKey = (raw) => displayName(raw).toLowerCase();

export function isUnknown(raw) { const d = displayName(raw); return !d || UNKNOWN.test(d); }
export function isSelf(raw) { return SELF.test(displayName(raw)); }

// What to call this person, or null when it isn't safe to use a name at all.
// roster: the display names of everyone in the meeting (so two people called Jess are told apart by full name).
export function callName(raw, roster = [], { selfName = "" } = {}) {
  if (isSelf(raw)) return selfName ? firstName(selfName) || null : null;
  if (isUnknown(raw)) return null;
  const d = displayName(raw), f = firstName(raw);
  if (!f) return null;
  const others = [...new Set((roster ?? []).map(displayName).filter((x) => x && !isSelf(x) && x.toLowerCase() !== d.toLowerCase()))];
  const clash = others.some((o) => firstName(o).toLowerCase() === f.toLowerCase());
  if (clash) return d.includes(" ") ? d : null;           // two people share the first name and this one has no other: skip
  return f;
}

// ---- when to use a name --------------------------------------------------------------------------------------------
export function createNamePolicy({ now = () => Date.now(), every = 3, cooldownMs = 120_000 } = {}) {
  const people = new Map();                       // key → { answers, lastUsedAt, uses }
  const get = (k) => { const key = String(k ?? "").toLowerCase(); if (!people.has(key)) people.set(key, { answers: 0, lastUsedAt: 0, uses: 0 }); return people.get(key); };
  return {
    // Should this answer (to this person) use their name?
    decide(key) {
      if (!key) return false;
      const p = get(key);
      if (p.answers === 0) return true;                             // the first answer to each person
      if (p.lastUsedAt && now() - p.lastUsedAt < cooldownMs) return false;   // not twice in a row within ~2 minutes
      return p.answers - (p.lastAnswerUsed ?? 0) >= every - 1;       // then about one answer in three
    },
    // After answering: whether the name was used (in the voice OR the chat, never both)
    note(key, used) {
      if (!key) return;
      const p = get(key);
      p.answers++;
      if (used) { p.lastUsedAt = now(); p.uses++; p.lastAnswerUsed = p.answers; }
    },
    stats: (key) => ({ ...get(key) }),
    clear() { people.clear(); },
  };
}

// ---- how a name is said, in each personality ---------------------------------------------------------------------------
// {n} is replaced by the name exactly as given. Several of each so it doesn't sound canned.
export const OPENERS = {
  default:    { answer: ["Good question, {n}.", "{n}, here's the short answer.", "Great question, {n}."], handoff: ["Great question, {n}."], refuse: ["Sorry, {n},"] },
  cowboy:     { answer: ["Well howdy, {n}!", "Good question, {n}, partner.", "{n}, here's the straight shootin' answer."], handoff: ["Well now, {n}, that's a good one."], refuse: ["Sorry, {n}, partner,"] },
  broski:     { answer: ["Yo {n}!", "{n}, great question, bro.", "Big question, {n}!"], handoff: ["Ooh, {n}, great one."], refuse: ["Sorry {n},"] },
  maiden:     { answer: ["A lovely question, {n}.", "Good {n}, allow me.", "{n}, gladly."], handoff: ["Oh, a fine question, {n}."], refuse: ["Forgive me, {n},"] },
  knight:     { answer: ["Well asked, {n}.", "{n}, I shall answer.", "A worthy question, {n}."], handoff: ["A worthy question, {n}."], refuse: ["My apologies, {n},"] },
  sage:       { answer: ["A wise question, {n}.", "{n}, listen well.", "Hmm, {n}, a good question that is."], handoff: ["A wise question, {n}."], refuse: ["Sorry, {n},"] },
  groovy:     { answer: ["Far out question, {n}.", "{n}, right on.", "Groovy question, {n}."], handoff: ["Far out, {n}."], refuse: ["Sorry, {n}, man,"] },
  professor:  { answer: ["Ah, an excellent question, {n}.", "{n}, a very good question.", "Splendid question, {n}."], handoff: ["An excellent question, {n}."], refuse: ["I'm afraid, {n},"] },
  moviebuff:  { answer: ["{n}, great question. Roll the tape.", "Scene one, {n}.", "{n}, here's the director's cut."], handoff: ["Great scene, {n}."], refuse: ["Cut, sorry {n},"] },
  politician: { answer: ["Great question, {n}, and let me be very clear.", "{n}, I'm so glad you asked.", "Thank you for that question, {n}."], handoff: ["I'm glad you asked, {n}."], refuse: ["No comment, {n}:"] },
  // Lantern's own voice: warm and wise, like an old lamp by the study window
  lantern:    { answer: ["Ah, {n}, a fine question.", "{n}, happy to shed some light on that.", "Good question, {n}. Let's light it up."], handoff: ["Ah, {n}, a fine question."], refuse: ["I'm sorry, {n},"] },
};
export function opener(name, { style = "default", kind = "answer", n = 0 } = {}) {
  if (!name) return "";
  const set = (OPENERS[style] ?? OPENERS.default)[kind] ?? OPENERS.default[kind] ?? OPENERS.default.answer;
  return set[Math.abs(n) % set.length].replaceAll("{n}", name);
}
// A sentence that names the person, with nothing else changed: exact spelling, exact case.
export const usesName = (text, name) => Boolean(name) && new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(String(text ?? ""));
