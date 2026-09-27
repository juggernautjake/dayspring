// The XP ledger: an append-only record of every XP event (data/xp-ledger.jsonl), one JSON object per line.
// Nothing is ever edited or deleted: a mistake is corrected with a "reversal" entry. The balance is the sum.
//   { id, at, day, type: "award"|"spend"|"reversal"|"saver", amount, category?, source?, evidence?, fp?, reason?, ref?, reverses? }
// Each entry is written with ONE append of a whole line, so a power cut can at worst leave a half line at the end,
// which is skipped when the file is read back.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export function createLedger(file) {
  let cache = null;
  function entries() {
    if (cache) return cache;
    cache = [];
    if (!existsSync(file)) return cache;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); if (e && typeof e.amount === "number" && e.type) cache.push(e); } catch { /* a torn last line */ }
    }
    return cache;
  }
  function append(entry) {
    const e = { id: randomUUID(), ...entry };
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(e) + "\n");
    entries().push(e);
    return e;
  }
  const reversed = () => new Set(entries().filter((e) => e.type === "reversal").map((e) => e.reverses));
  // awards still standing (not reversed)
  const awards = () => { const r = reversed(); return entries().filter((e) => e.type === "award" && !r.has(e.id)); };
  const balance = () => entries().reduce((s, e) => s + (e.type === "spend" ? -Math.abs(e.amount) : e.amount), 0);
  const lifetime = () => awards().reduce((s, e) => s + e.amount, 0);
  const dayTotal = (day) => awards().filter((e) => e.day === day).reduce((s, e) => s + e.amount, 0);
  const onDay = (day, category) => awards().filter((e) => e.day === day && (!category || e.category === category));
  const lastOf = (category) => { const a = awards().filter((e) => e.category === category); return a[a.length - 1] ?? null; };
  const fingerprints = () => new Set(awards().map((e) => e.fp).filter(Boolean));
  const evidenceTexts = () => awards().map((e) => e.evidence).filter(Boolean);
  return { file, entries, append, awards, balance, lifetime, dayTotal, onDay, lastOf, fingerprints, evidenceTexts, reload: () => { cache = null; } };
}
