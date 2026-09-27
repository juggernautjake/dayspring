// Church: the owner's congregation (data/church.json). Services, the current book studies, and each week's bulletin
// (verses, speakers, announcements, birthdays and the prayer list). The prayer list feeds the morning's "Today you are
// praying for…", the verses join the encouragement rotation, birthdays and events reach the morning's "what's special".
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "church.json");
// A fresh install knows no church. The owner's file holds, for example:
//   name, address, website, youtube
//   services: [{ day: "sun", time: "10:30", what: "Sunday morning service" }]
//   studies:  { sun: { book: "Acts", started: "YYYY-MM-DD", chapter: 1 } }        (verse by verse, chapter by chapter)
//   potluck:  { weekOfMonth: 1, day: "sun", title: "the church potluck" }          (a monthly meal, optional)
//   serviceLabels: { sun: "This morning at church" }, serviceOpenLines: { mon: "…" }   (optional wording)
const SEED = { name: "", services: [], studies: {}, bulletins: [] };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
let db = null;
function load() { if (!db) { db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : structuredClone(SEED); db.services ??= []; db.studies ??= {}; db.bulletins ??= []; } return db; }
function save() { writeJSONAtomic(FILE, load(), 2); }
export const info = () => structuredClone(load());

// Add (or replace) a week's bulletin. { date, verses:[{ref,text}], speakers:[{date,who,passage}], announcements:[], birthdays:[{name,md}], prayer:[{who,request,note,friend}] }
export function addBulletin(b) {
  const d = load();
  d.bulletins = d.bulletins.filter((x) => x.date !== b.date);
  d.bulletins.push(b);
  d.bulletins.sort((x, y) => x.date.localeCompare(y.date));
  // the study chapters move with the speakers' passages
  for (const s of b.speakers ?? []) {
    const m = /^(.+?)\s+(\d+)$/.exec(s.passage ?? "");
    if (!m) continue;
    const day = new Date(s.date + "T12:00:00").getDay() === 3 ? "wed" : "sun";
    if (d.studies[day] && d.studies[day].book === m[1] && (!d.studies[day].asOf || s.date >= d.studies[day].asOf)) Object.assign(d.studies[day], { chapter: Number(m[2]), asOf: s.date, speaker: s.who });
  }
  save();
  return b;
}
export const latest = () => { const b = load().bulletins; return b.length ? b[b.length - 1] : null; };
export const prayerList = () => latest()?.prayer ?? [];
export const verses = () => latest()?.verses ?? [];
export function setStudy(day, patch) { const d = load(); d.studies[day] = { ...(d.studies[day] ?? {}), ...patch }; save(); return d.studies[day]; }
export const studies = () => structuredClone(load().studies);
// The church's monthly meal, if it has one: { weekOfMonth, day, dow, title } or null.
export function potluck() {
  const p = load().potluck;
  if (!p?.weekOfMonth) return null;
  const dow = Math.max(0, DAYS.indexOf(p.day ?? "sun"));
  return { weekOfMonth: Number(p.weekOfMonth), day: DAYS[dow], dow, title: p.title || "the church potluck" };
}
// A heads-up one to three days before the monthly meal, so there's time to plan a dish.
export function potluckLine(date) {
  const p = potluck();
  if (!p) return null;
  const d = new Date(date + "T12:00:00"), ahead = (p.dow - d.getDay() + 7) % 7;
  if (ahead < 1 || ahead > 3) return null;
  const on = new Date(d); on.setDate(d.getDate() + ahead);
  if (Math.ceil(on.getDate() / 7) !== p.weekOfMonth) return null;      // e.g. the 4th Sunday falls on the 22nd–28th
  const dayName = on.toLocaleDateString("en-US", { weekday: "long" });
  const when = ahead === 1 ? "Tomorrow" : ahead === 2 ? `This ${dayName}` : dayName;
  return `${when} is ${p.title}. Want to plan a dish to bring? I can put a cooking or shopping block on the schedule.`;
}

// "Tonight at church you're in Acts 3." — for the morning on service days.
export function serviceLine(date) {
  const dow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(date + "T12:00:00").getDay()];
  const st = load().studies[dow], sv = load().services.find((s) => s.day === dow);
  if (!sv) return null;
  const sp = latest()?.speakers?.find((s) => s.date === date);
  const when = load().serviceLabels?.[dow] ?? (Number(String(sv.time ?? "12").slice(0, 2)) < 12 ? "This morning at church" : "Tonight at church");
  if (sp) return `${when}, ${sp.who} is teaching ${sp.passage}.`;
  if (st?.book) return `${when} you're continuing in ${st.book}${st.chapter ? `, probably chapter ${dow === "sun" || dow === "wed" ? st.chapter + 1 : st.chapter}` : ""}.`;
  return load().serviceOpenLines?.[dow] ?? `${when}.`;
}
