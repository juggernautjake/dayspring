// What the assistant knows about the owner's interests and sense of humor, so its lines can be their kind of funny.
// It starts from the owner profile (data/owner.json) and grows: they tell it things, the AI notes what it learns, and when they laugh at a
// line ("haha", "that's funny") or groans at one ("that's corny") the line is kept as an example of what does or doesn't land.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as owner from "./owner.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "profile.json");
const SEED = {
  interests: [],   // filled from the owner profile on first run
  humor: ["light, friendly teasing"],
  notes: [],
  hits: [],     // lines they enjoyed
  misses: [],   // lines that didn't land
};
let db = null;
function load() {
  if (!db) {
    const o = owner.get();
    db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { ...SEED, interests: [...(o.interests ?? [])], humor: o.humor ? String(o.humor).split(/;\s*/).filter(Boolean) : SEED.humor };
    if (!existsSync(FILE)) save();
  }
  return db;
}
function save() { writeFileSync(FILE, JSON.stringify(db, null, 2)); }

export function get() { return { ...load() }; }
export function learn(kind, note) {
  const d = load();
  const k = kind === "humor" ? "humor" : kind === "interest" ? "interests" : "notes";
  const n = String(note ?? "").trim();
  if (!n) throw new Error("nothing to remember");
  if (!d[k].some((x) => x.toLowerCase() === n.toLowerCase())) d[k].push(n);
  save();
  return { saved: n, as: k };
}
export function feedback(kind, line) {
  const d = load();
  const k = kind === "hit" ? "hits" : "misses";
  if (!line) return null;
  d[k].push({ at: new Date().toISOString(), line: String(line).slice(0, 300) });
  if (d[k].length > 40) d[k].shift();
  save();
  return { noted: kind };
}
// A laugh or a groan in what they just said?
export function reaction(text) {
  const t = String(text).toLowerCase();
  if (/\b(haha+|hahaha|lol|lmao|that'?s (funny|hilarious|great)|love (that|it)|good one|nice one)\b/.test(t)) return "hit";
  if (/\b(corny|cringe|not funny|don'?t say that|stop saying|that'?s lame|too much)\b/.test(t)) return "miss";
  return null;
}
// For the prompts: who they are, what makes them laugh, and what hasn't landed.
export function note() {
  const d = load();
  const Their = owner.their().charAt(0).toUpperCase() + owner.their().slice(1);
  return [
    d.interests.length ? `${Their} interests: ${d.interests.join("; ")}.` : "",
    `${Their} humor: ${d.humor.join("; ")}.`,
    d.notes.length ? `Things you've learned about ${owner.them()}: ${d.notes.slice(-15).join("; ")}.` : "",
    d.hits.length ? `Lines ${owner.they()} enjoyed (the kind of thing that lands): ${d.hits.slice(-6).map((h) => `"${h.line}"`).join(" ")}` : "",
    d.misses.length ? `Lines that didn't land (avoid that style): ${d.misses.slice(-6).map((h) => `"${h.line}"`).join(" ")}` : "",
  ].filter(Boolean).join("\n");
}
