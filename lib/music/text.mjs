// Text helpers for the music resolver: normalising what was said or typed, typo-tolerant word comparison
// (Damerau-Levenshtein, so "worhsip" is one step from "worship"), and a similarity score between a request and a
// Spotify item's name. No dependencies; everything here is pure and fast.

const NUM_WORDS = { fifties: "50s", sixties: "60s", seventies: "70s", eighties: "80s", nineties: "90s", "two thousands": "2000s", noughties: "2000s" };

// "Lo-Fi Beats!", "R&B", "90's" → "lo fi beats", "r and b", "90s"
export function norm(s) {
  let t = String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  t = t.replace(/&/g, " and ").replace(/['’`]/g, "").replace(/\b19(\d0)s\b/g, "$1s");
  for (const [w, d] of Object.entries(NUM_WORDS)) t = t.replace(new RegExp(`\\b${w}\\b`, "g"), d);
  t = t.replace(/\blo-?fi\b|\blow ?fi\b|\blofi\b/g, "lo fi").replace(/\bhip-?hop\b/g, "hip hop").replace(/\br ?n ?b\b|\br and b\b/g, "r and b");
  return t.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
export const words = (s) => norm(s).split(" ").filter(Boolean);

// Words that carry no meaning for matching a name ("the", "music", "playlist").
export const FILLER = new Set(("a an the of and or to for in on with by my me some any music songs song tunes playlist playlists mix mixes " +
  "track tracks album stuff thing things please play put spotify").split(" "));
export const content = (s) => words(s).filter((w) => !FILLER.has(w));

// Damerau-Levenshtein (optimal string alignment), stopping early past max.
export function dl(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length, n = b.length;
  let prev2 = null, prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[n];
}

// A rough sound-alike key, for speech-to-text slips ("jonny" / "johnny", "fotos" / "photos").
export function sound(w) {
  return String(w).replace(/ph/g, "f").replace(/ck|q/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/h/g, "").replace(/([a-z])\1+/g, "$1")
    .replace(/(?<=.)[aeiouy]+/g, "").replace(/z/g, "s");
}

// How many typo steps a word of this length may be off by.
export const allowance = (w) => (w.length <= 3 ? 0 : w.length <= 8 ? 1 : 2);

// Are two words the same word, allowing a typo? Returns 0 (exact), a cost in (0,1] (close) or null (different).
export function wordMatch(a, b) {
  if (a === b) return 0;
  if (!a || !b) return null;
  if (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2) return 0.3;   // plural, "christ"/"christian" no (too far)
  const d = dl(a, b, 2);
  if (d <= Math.min(allowance(a), allowance(b))) return 0.5 * d;
  if (a.length > 3 && b.length > 3 && sound(a) === sound(b)) return 0.5;
  return null;
}

// Similarity (0–1) between what was asked for and an item's text. Word-based and typo-tolerant: the share of the
// request's meaningful words found in the item, balanced against how much else the item's name says.
export function sim(asked, name) {
  const A = content(asked), B = content(name);
  if (!A.length || !B.length) return norm(asked) && norm(asked) === norm(name) ? 1 : 0;
  if (A.join(" ") === B.join(" ")) return 1;
  if (norm(asked).replace(/ /g, "") === norm(name).replace(/ /g, "")) return 0.97;          // "hill song" / "Hillsong", "roadtrip" / "Road Trip"
  let hit = 0;
  const used = new Set();
  for (const a of A) {
    let best = null, bi = -1;
    B.forEach((b, i) => { if (used.has(i)) return; const c = wordMatch(a, b); if (c != null && (best == null || c < best)) { best = c; bi = i; } });
    if (bi >= 0) { used.add(bi); hit += 1 - best * 0.4; }
  }
  const recall = hit / A.length, precision = hit / B.length;
  return Math.max(0, Math.min(1, 0.7 * recall + 0.3 * precision));
}

// Does the text contain this phrase (typo-tolerant, word by word, in order)? Returns 0–1 coverage of the phrase's words.
export function covers(text, phrase) {
  const T = words(text), P = words(phrase).filter((w) => !FILLER.has(w));
  if (!P.length) return 0;
  let n = 0;
  for (const p of P) if (T.some((t) => wordMatch(p, t) != null)) n++;
  return n / P.length;
}

export const titleCase = (s) => String(s).replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, "and").replace(/\bOf\b/g, "of").replace(/\bR And B\b/, "R&B").replace(/\bLo Fi\b/, "Lo-Fi").replace(/\bCcm\b/, "CCM").replace(/\bEdm\b/, "EDM");
export const listNames = (xs, max = 3) => { const a = [...new Set(xs.filter(Boolean))].slice(0, max); return a.length <= 1 ? a.join("") : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`; };
