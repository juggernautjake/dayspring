// Social: reminders from shared memories and events. Pure; the app decides when to ask and how to say them.
// docs/SOCIAL.md "Reminders".
//
//   generateReminders({ w, viewer, now, horizonDays, people, lastContact, quietDays, label })
//     w            the world (only items this viewer may see are used: consent.canView)
//     people       the viewer's OWN people, local records ({ id, name, birthday: "MM-DD", year? })
//     lastContact  { personId: ISO date } from the viewer's own device (texts, calls) — local only, never synced
//     label(item)  optional: the decrypted title of an item, for the text
//   → [{ kind: "on-this-day" | "birthday" | "quiet" | "anniversary", date, text, itemId?, personId?, yearsAgo?, inDays? }]
import { canView } from "./consent.mjs";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const md = (s) => String(s).slice(5, 10);
const DAY = 86_400_000;

// days from `today` to the next MM-DD (0 = today)
function daysUntil(mmdd, today) {
  const [m, d] = mmdd.split("-").map(Number);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < t0) next = new Date(today.getFullYear() + 1, m - 1, d);
  return { days: Math.round((next - t0) / DAY), date: next };
}

export function generateReminders({ w, viewer, now = new Date(), horizonDays = 14, people = [], lastContact = {}, quietDays = 45, label = null } = {}) {
  const today = now instanceof Date ? now : new Date(now);
  const out = [];
  const name = (it) => { try { return label?.(it) ?? null; } catch { return null; } };
  const visible = w ? w.items.filter((it) => !w.isTombstoned("items", it.id) && canView(w, viewer, it.id, { now: today }).allow) : [];

  // on this day: a memory or photo from this date in an earlier year
  for (const it of visible) {
    if (!it.date || it.kind === "event") continue;
    const y = Number(it.date.slice(0, 4));
    if (md(it.date) === md(ymd(today)) && y < today.getFullYear()) {
      const n = today.getFullYear() - y, t = name(it);
      out.push({ kind: "on-this-day", date: ymd(today), itemId: it.id, yearsAgo: n, shared: it.owner !== viewer, text: `On this day ${n} year${n === 1 ? "" : "s"} ago${t ? `: ${t}` : ""}.` });
    }
  }
  // upcoming birthdays: the viewer's own people, and birthday events shared with them
  const seen = new Set();
  for (const p of people) {
    if (!p?.birthday || !/^\d{2}-\d{2}$/.test(p.birthday)) continue;
    const u = daysUntil(p.birthday, today);
    if (u.days <= horizonDays) { seen.add(`bday:${p.id}`); out.push({ kind: "birthday", date: ymd(u.date), personId: p.id, inDays: u.days, text: u.days === 0 ? `It's ${p.name}'s birthday today.` : `${p.name}'s birthday is in ${u.days} day${u.days === 1 ? "" : "s"}.` }); }
  }
  for (const it of visible.filter((x) => x.kind === "event" && x.date)) {
    const u = daysUntil(md(it.date), today);
    if (u.days > horizonDays) continue;
    const t = name(it);
    if (it.eventKind === "birthday") out.push({ kind: "birthday", date: ymd(u.date), itemId: it.id, inDays: u.days, shared: it.owner !== viewer, text: `${t ?? "A birthday"} ${u.days === 0 ? "is today" : `is in ${u.days} day${u.days === 1 ? "" : "s"}`}.` });
    else if (it.eventKind === "anniversary") {
      const years = today.getFullYear() + (u.date.getFullYear() - today.getFullYear()) - Number(it.date.slice(0, 4));
      out.push({ kind: "anniversary", date: ymd(u.date), itemId: it.id, inDays: u.days, years, shared: it.owner !== viewer, text: `${t ?? "A shared anniversary"}${years > 0 ? ` (${years} year${years === 1 ? "" : "s"})` : ""} ${u.days === 0 ? "is today" : `is in ${u.days} day${u.days === 1 ? "" : "s"}`}.` });
    }
  }
  // "you haven't talked to X in a while": the viewer's own contact history, on their own device only
  for (const p of people) {
    const last = lastContact?.[p.id];
    if (!last) continue;
    const days = Math.floor((today - new Date(last)) / DAY);
    if (days >= quietDays) out.push({ kind: "quiet", date: ymd(today), personId: p.id, daysSince: days, text: `You haven't talked to ${p.name} in a while (${days} days).` });
  }
  const order = { birthday: 0, anniversary: 1, "on-this-day": 2, quiet: 3 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
}
