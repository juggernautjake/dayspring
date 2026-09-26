// Calendar subscriptions (ICS / iCal links): an iCloud shared or public calendar, a school, team or league schedule,
// holidays, a work calendar's "secret address in iCal format" — any link that ends in .ics or starts with webcal://.
// Read-only: the events show on Dayspring's schedule (their own color, not editable there). Several can be added.
// Kept in data/connectors/ics.json: { calendars: [{ id, name, url }] }. Each link is fetched at most every 30 minutes.
import { randomBytes } from "node:crypto";
import * as store from "./store.mjs";

const load = () => ({ calendars: [], ...store.load("ics") });
const httpUrl = (u) => String(u ?? "").trim().replace(/^webcals?:\/\//i, "https://");
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export function status() {
  const c = load().calendars;
  return { id: "ics", connected: c.length > 0, who: c.length ? `${c.length} calendar${c.length > 1 ? "s" : ""}` : null, calendars: c.map((x) => ({ id: x.id, name: x.name, host: host(x.url) })) };
}
export const connected = () => load().calendars.length > 0;

// Add a subscription: fetch it once so a bad link is caught now, not later.
export async function connect({ url, name } = {}) {
  const u = httpUrl(url);
  if (!/^https?:\/\/[^\s]+$/i.test(u)) throw new Error("Paste the calendar's link (it starts with https:// or webcal://).");
  const text = await fetchText(u);
  const cal = parse(text);
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link didn't return a calendar. Make sure it's the “iCal” / “.ics” / “webcal” link, not the page you view the calendar on.");
  const s = load();
  if (s.calendars.some((c) => c.url === u)) return status();
  s.calendars.push({ id: randomBytes(4).toString("hex"), name: String(name || cal.name || host(u) || "Calendar").slice(0, 60), url: u });
  store.save("ics", s); cache.delete(u);
  return status();
}
export function remove({ id } = {}) { const s = load(); s.calendars = s.calendars.filter((c) => c.id !== id && c.name.toLowerCase() !== String(id ?? "").toLowerCase()); store.save("ics", s); return status(); }
export function disconnect() { store.forget("ics"); cache.clear(); return status(); }

// ---- fetching and parsing ----
const cache = new Map();   // url → { at, cal }
async function fetchText(u) {
  const r = await fetch(u, { headers: { "user-agent": "Dayspring calendar (personal assistant)", accept: "text/calendar, */*" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!r.ok) throw await store.fail(r, host(u) || "The calendar");
  return r.text();
}
async function calendarFor(u) {
  const hit = cache.get(u);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.cal;
  const cal = parse(await fetchText(u));
  cache.set(u, { at: Date.now(), cal });
  return cal;
}

// RFC 5545, the parts calendars actually use: VEVENT with DTSTART/DTEND/DURATION, SUMMARY, LOCATION, DESCRIPTION,
// RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY), EXDATE, RECURRENCE-ID overrides.
export function parse(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events = []; let cur = null, name = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { cur = { exdates: [] }; continue; }
    if (/^END:VEVENT/i.test(line)) { if (cur?.start) events.push(cur); cur = null; continue; }
    const m = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/i.exec(line);
    if (!m) continue;
    const [, key, params, value] = m, K = key.toUpperCase();
    if (!cur) { if (K === "X-WR-CALNAME") name = unescape(value); continue; }
    if (K === "DTSTART") cur.start = when(value, params);
    else if (K === "DTEND") cur.end = when(value, params);
    else if (K === "DURATION") cur.duration = durationMs(value);
    else if (K === "SUMMARY") cur.title = unescape(value);
    else if (K === "LOCATION") cur.where = unescape(value);
    else if (K === "DESCRIPTION") cur.notes = unescape(value).slice(0, 500);
    else if (K === "RRULE") cur.rrule = Object.fromEntries(value.split(";").map((p) => p.split("=")).map(([a, b]) => [a.toUpperCase(), b]));
    else if (K === "EXDATE") for (const v of value.split(",")) cur.exdates.push(when(v, params).key);
    else if (K === "RECURRENCE-ID") cur.recurrenceId = when(value, params).key;
    else if (K === "UID") cur.uid = value;
    else if (K === "STATUS") cur.cancelled = /CANCELLED/i.test(value);
    else if (K === "TRANSP") cur.transparent = /^TRANSPARENT/i.test(value.trim());
  }
  return { name, events };
}
const unescape = (s) => String(s).replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
function durationMs(v) { const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(v); if (!m) return 0; return (Number(m[2] || 0) * 7 * 86400 + Number(m[3] || 0) * 86400 + Number(m[4] || 0) * 3600 + Number(m[5] || 0) * 60 + Number(m[6] || 0)) * 1000; }
// A date or date-time → { date: Date, allDay, key }. UTC ("Z") times and TZID times (IANA names like America/Chicago, and
// the common Windows names Outlook uses) convert to this computer's time; an unknown TZID is treated as local time.
function when(v, params = "") {
  const s = String(v).trim();
  if (/VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(s)) { const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); return { date: d, allDay: true, key: s.slice(0, 8) }; }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(s);
  if (!m) return { date: new Date(NaN), allDay: false, key: s };
  const zone = m[7] ? null : zoneOf(params);
  const d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))
    : zone ? inZone(zone, +m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return { date: d, allDay: false, key: zone || m[7] ? localISO(d).replace(/-/g, "") : s.slice(0, 8) };
}
const localISO = (d) => d.toLocaleDateString("en-CA");
const WINDOWS_ZONES = { "eastern standard time": "America/New_York", "central standard time": "America/Chicago", "mountain standard time": "America/Denver", "us mountain standard time": "America/Phoenix",
  "pacific standard time": "America/Los_Angeles", "alaskan standard time": "America/Anchorage", "hawaiian standard time": "Pacific/Honolulu", "atlantic standard time": "America/Halifax",
  "gmt standard time": "Europe/London", "w. europe standard time": "Europe/Berlin", "romance standard time": "Europe/Paris", "central europe standard time": "Europe/Budapest",
  "e. australia standard time": "Australia/Brisbane", "aus eastern standard time": "Australia/Sydney", "india standard time": "Asia/Kolkata", "tokyo standard time": "Asia/Tokyo", "utc": "UTC" };
const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
// the TZID parameter as an IANA zone this computer understands, or null (no TZID, the local zone already, or unknown)
function zoneOf(params) {
  const raw = /TZID="?([^;:"]+)/i.exec(params ?? "")?.[1]?.trim(); if (!raw) return null;
  const z = WINDOWS_ZONES[raw.toLowerCase()] ?? raw.replace(/^\/[^/]+\/[^/]+\//, "");   // "/mozilla.org/20050126_1/America/New_York" style too
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); } catch { return null; }
  return z === LOCAL_ZONE ? null : z;
}
// wall-clock time in a zone → the real instant
function inZone(zone, y, mo, d, h, mi, s) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = (t) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t; };
  let t = guess - offset(guess); t = guess - offset(t);
  return new Date(t);
}
const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// every start time of an event between two dates (recurring ones expanded; at most 500 per event)
function occurrences(ev, fromD, toD) {
  const start = ev.start.date; if (isNaN(start)) return [];
  const r = ev.rrule;
  if (!r) return start >= fromD && start <= toD ? [start] : [];
  const out = [], interval = Math.max(1, Number(r.INTERVAL) || 1), count = Number(r.COUNT) || Infinity;
  const until = r.UNTIL ? when(r.UNTIL).date : null;
  const byday = r.BYDAY ? r.BYDAY.split(",").map((x) => x.replace(/^[+-]?\d+/, "")) : null;
  const bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null;
  let n = 0;
  const push = (d) => { if (until && d > until) return false; n++; if (n > count) return false; if (d >= fromD && d <= toD) out.push(new Date(d)); return true; };
  const f = String(r.FREQ).toUpperCase();
  for (let i = 0, d = new Date(start); i < 3000 && out.length < 500 && d <= toD; i++) {
    if (f === "DAILY") { if (!push(d)) break; d.setDate(d.getDate() + interval); }
    else if (f === "WEEKLY") {
      const days = byday ?? [DAYS[start.getDay()]];
      const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
      let stop = false;
      for (const code of DAYS) {
        if (!days.includes(code)) continue;
        const x = new Date(weekStart); x.setDate(weekStart.getDate() + DAYS.indexOf(code)); x.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (x < start) continue;
        if (!push(x)) { stop = true; break; }
      }
      if (stop) break;
      d = new Date(weekStart); d.setDate(weekStart.getDate() + 7 * interval); d.setHours(start.getHours(), start.getMinutes(), 0, 0);
    } else if (f === "MONTHLY") {
      const days = bymd ?? [start.getDate()];
      let stop = false;
      for (const md of days) { const x = new Date(d.getFullYear(), d.getMonth(), md, start.getHours(), start.getMinutes()); if (x.getMonth() !== d.getMonth() || x < start) continue; if (!push(x)) { stop = true; break; } }
      if (stop) break;
      d = new Date(d.getFullYear(), d.getMonth() + interval, 1, start.getHours(), start.getMinutes());
    } else if (f === "YEARLY") { if (!push(d)) break; d = new Date(d.getFullYear() + interval, start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()); }
    else { push(d); break; }
  }
  return out;
}

// Events between two dates (YYYY-MM-DD), in the same shape as the Google and Outlook ones
export async function events(from, to) {
  const out = [];
  const fromD = new Date(from + "T00:00:00"), toD = new Date(to + "T23:59:59");
  for (const c of load().calendars) {
    let cal; try { cal = await calendarFor(c.url); } catch { continue; }
    const overrides = new Set(cal.events.filter((e) => e.recurrenceId).map((e) => `${e.uid}|${e.recurrenceId}`));
    for (const ev of cal.events) {
      if (ev.cancelled) continue;
      const len = ev.end && !isNaN(ev.end.date) ? ev.end.date - ev.start.date : ev.duration || (ev.start.allDay ? 86_400_000 : 3_600_000);
      for (const s of occurrences(ev, fromD, toD)) {
        const key = s.toLocaleDateString("en-CA").replace(/-/g, "");
        if (ev.exdates.includes(key) || (!ev.recurrenceId && ev.rrule && overrides.has(`${ev.uid}|${key}`))) continue;
        const e = new Date(s.getTime() + len), allDay = ev.start.allDay;
        out.push({ id: `ics:${c.id}:${ev.uid ?? ev.title}:${key}`, source: "ics", calendar: c.name, title: ev.title || "(no title)", date: localISO(s),
          start: allDay ? "00:00" : hm(s), end: allDay ? "23:59" : localISO(e) !== localISO(s) ? "23:59" : hm(e), allDay, where: ev.where ?? "", notes: ev.notes ?? "",
          busy: allDay ? ev.transparent === false : ev.transparent !== true });
      }
    }
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
export function clearCache() { cache.clear(); }
