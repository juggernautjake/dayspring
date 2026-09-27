// The XP ledger: an append-only record of every XP event (data/xp-ledger.jsonl), one JSON object per line.
// Nothing is ever edited or deleted: a mistake is corrected with a "reversal" entry. The balance is the sum.
//   { id, at, day, type: "award"|"spend"|"reversal"|"saver", amount, category?, source?, evidence?, fp?, reason?, ref?, reverses? }
// Each entry is written with ONE append of a whole line, so a power cut can at worst leave a half line at the end.
// When the file is read and doesn't end in "\n", that last fragment is torn: it is copied to
// xp-ledger.torn-<time>.txt next to the ledger and cut off (or, when it is a whole entry that only lost its newline,
// the newline is added), so the next append starts on a line of its own instead of gluing onto the fragment.
// Any other bad line is skipped on its own; the lines after it still count.
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const valid = (e) => Boolean(e && typeof e.amount === "number" && e.type);

export function createLedger(file) {
  let cache = null;
  function entries() {
    if (cache) return cache;
    cache = [];
    if (!existsSync(file)) return cache;
    let text = readFileSync(file, "utf8");
    if (text && !text.endsWith("\n")) text = repairTail(text);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); if (valid(e)) cache.push(e); } catch { /* a damaged line: skipped, the rest still count */ }
    }
    return cache;
  }
  // the file ends mid-line (a power cut during an append)
  function repairTail(text) {
    const cut = text.lastIndexOf("\n") + 1, frag = text.slice(cut);
    let whole = false;
    try { whole = valid(JSON.parse(frag)); } catch { /* torn */ }
    try {
      if (whole) { appendFileSync(file, "\n"); return text + "\n"; }
      writeFileSync(join(dirname(file), `${basename(file).replace(/\.jsonl?$/, "")}.torn-${Date.now()}.txt`), frag);
      truncateSync(file, Buffer.byteLength(text.slice(0, cut), "utf8"));
    } catch { /* can't write: the fragment is still skipped */ }
    return text.slice(0, cut);
  }
  function append(entry) {
    const e = { id: randomUUID(), ...entry };
    entries();                                     // loads (and repairs a torn tail) before the first write
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(e) + "\n");
    entries().push(e);
    return e;
  }
  const reversed = () => new Set(entries().filter((e) => e.type === "reversal").map((e) => e.reverses));
  // awards still standing (not reversed)
  const awards = () => { const r = reversed(); return entries().filter((e) => e.type === "award" && !r.has(e.id)); };
  // an award's "spendable" part (when it's less than its amount: a learning day past the daily spending limit, or
  // catch-up XP) is what the balance gets; the full amount counts for the lifetime total, levels and badges
  const spendOf = (e) => (typeof e.spendable === "number" ? e.spendable : e.amount);
  const balance = () => entries().reduce((s, e) => s + (e.type === "spend" ? -Math.abs(e.amount) : spendOf(e)), 0);
  const lifetime = () => awards().reduce((s, e) => s + e.amount, 0);
  const dayTotal = (day) => awards().filter((e) => e.day === day).reduce((s, e) => s + e.amount, 0);
  const isLearning = (e) => e.source === "lantern";
  const generalDay = (day) => awards().filter((e) => e.day === day && !isLearning(e)).reduce((s, e) => s + e.amount, 0);
  const learningDay = (day) => awards().filter((e) => e.day === day && isLearning(e)).reduce((s, e) => s + e.amount, 0);
  const spendDay = (day) => awards().filter((e) => e.day === day).reduce((s, e) => s + spendOf(e), 0);
  // keys of awards still standing (a reversed award's key is free again)
  const keys = () => new Set(awards().filter((e) => e.key).map((e) => e.key));
  const onDay = (day, category) => awards().filter((e) => e.day === day && (!category || e.category === category));
  const lastOf = (category) => { const a = awards().filter((e) => e.category === category); return a[a.length - 1] ?? null; };
  const fingerprints = () => new Set(awards().map((e) => e.fp).filter(Boolean));
  const evidenceTexts = () => awards().map((e) => e.evidence).filter(Boolean);
  // the latest day and time any entry was written for (the clock guard: a clock set backwards is noticed)
  const latest = () => entries().reduce((m, e) => ({ day: e.day && e.day > m.day ? e.day : m.day, at: e.at && e.at > m.at ? e.at : m.at }), { day: "", at: "" });
  return { file, entries, append, awards, balance, lifetime, dayTotal, generalDay, learningDay, spendDay, keys, isLearning, spendOf, onDay, lastOf, fingerprints, evidenceTexts, latest, reload: () => { cache = null; } };
}
