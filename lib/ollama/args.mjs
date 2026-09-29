// Dates and times in a local model's tool arguments, made exact. Small models write "11pm", "tomorrow", "Friday" or
// "2026-10-2T15:00" where Dayspring's tools want "23:00" and "2026-10-02"; this fixes them before the tool runs (after
// the general repair in ecosystem-core's repairArgs). A reminder at a time with no date is today if that time is still
// ahead, otherwise tomorrow: one reminder, never a repeating one.
//   normalizeFor(name, input, schema, now?) → input (a copy, fixed)
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// "11pm", "11 p.m.", "7:30 tonight", "23:00:00", "noon", "7" (→ as given) → "HH:MM"; null if it isn't a time
export function toHM(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().replace(/\./g, "");
  if (!s) return null;
  if (/^noon|midday$/.test(s)) return "12:00";
  if (/^midnight$/.test(s)) return "00:00";
  const t = /(?:t|\s|^)(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a m|p m|in the morning|in the evening|at night|tonight|this evening|this afternoon|morning|evening|afternoon|night)?\b/.exec(s);
  if (!t) return null;
  let h = Number(t[1]); const m = Number(t[2] ?? 0); const suf = (t[3] ?? "").replace(/\s/g, "");
  if (h > 23 || m > 59) return null;
  if (/^(pm|evening|intheevening|atnight|tonight|thisevening|thisafternoon|afternoon|night)$/.test(suf) && h < 12) h += 12;
  if (/^(am|morning|inthemorning)$/.test(suf) && h === 12) h = 0;
  return `${pad(h)}:${pad(m)}`;
}
// "today", "tomorrow", "tonight", "friday", "next monday", "2026-10-2", "10/2", "2026-10-02T15:00" → "YYYY-MM-DD"
export function toISODate(v, now = new Date()) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/^(today|tonight|this (morning|afternoon|evening))$/.test(s)) return iso(base);
  if (/^tomorrow/.test(s)) { base.setDate(base.getDate() + 1); return iso(base); }
  if (/^yesterday/.test(s)) { base.setDate(base.getDate() - 1); return iso(base); }
  m = /^(?:(next|this) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(s);
  if (m) { let d = (DAYS.indexOf(m[2]) - base.getDay() + 7) % 7; if (m[1] === "next" && d === 0) d = 7; base.setDate(base.getDate() + d); return iso(base); }
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (m) { let y = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : base.getFullYear(); const d = new Date(y, Number(m[1]) - 1, Number(m[2])); if (!m[3] && d < base) d.setFullYear(y + 1); return iso(d); }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed) && /[a-z]{3}/.test(s)) { const d = new Date(parsed); if (d.getFullYear() < 2001) d.setFullYear(base.getFullYear()); if (d < base && !/\d{4}/.test(s)) d.setFullYear(d.getFullYear() + 1); return iso(d); }
  return null;
}
const isTimeProp = (k, s) => /^(time|start|end|at|start_time|end_time)$/.test(k) || /HH:MM/.test(s?.description ?? "");
const isDateProp = (k, s) => /^(date|from|to|day|start_date|end_date|due|due_date)$/.test(k) || /YYYY-MM-DD/.test(s?.description ?? "");

export function normalizeFor(name, input, schema, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const out = { ...input };
  const props = schema?.properties ?? {};
  for (const [k, v] of Object.entries(out)) {
    if (typeof v !== "string") continue;
    const s = props[k] ?? {};
    if (s.type && s.type !== "string") continue;
    if (isDateProp(k, s)) {
      // "2026-10-02T15:00": the date here, the time to its time field if that's empty
      const dt = /^(\d{4}-\d{1,2}-\d{1,2})[t ](\d{1,2}:\d{2})/i.exec(v);
      if (dt) { out[k] = toISODate(dt[1], now); const tk = ["time", "start"].find((x) => x in props); if (tk && !out[tk]) out[tk] = toHM(dt[2]); continue; }
      const d = toISODate(v, now); if (d) out[k] = d;
    } else if (isTimeProp(k, s)) {
      // "tomorrow at 6pm" in a time field: the time here, the date to its date field if that's empty
      const dk = ["date", "day"].find((x) => x in props);
      if (dk && !out[dk]) { const d = toISODate(v.replace(/\s*(at|@)?\s*\d.*$/i, ""), now); if (d && /tomorrow|day\b|\d{4}-/.test(v.toLowerCase())) out[dk] = d; }
      const h = toHM(v); if (h) out[k] = h;
    }
  }
  // one reminder at a clock time with no date: today if it's still ahead, else tomorrow
  if (name === "set_reminder" && out.time && !out.date && !out.block_id) {
    const hm = toHM(out.time);
    if (hm) {
      const [h, m] = hm.split(":").map(Number), when = new Date(now); when.setHours(h, m, 0, 0);
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (when <= now) day.setDate(day.getDate() + 1);
      out.date = iso(day);
    }
  }
  // an event with a start and no end: an hour long (add_block needs both)
  if (name === "add_block" && out.start && !out.end && "end" in props) { const hm = toHM(out.start); if (hm) { const [h, m] = hm.split(":").map(Number); out.end = `${pad(Math.min(23, h + 1))}:${pad(h + 1 > 23 ? 59 : m)}`; } }
  return out;
}
