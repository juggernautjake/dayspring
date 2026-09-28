// Talking about the cameras, with or without an AI:
//   "show me the front camera" · "show me the cameras" · "any activity on the trail cam?" · "any deer last night?"
//   "play last night's deer clip" · "what happened in the shop today?" · "what's the garage camera see?"
// command(text) answers these directly (no AI needed); the AI gets the same as tools (TOOLS, runTool).
// People seen on cameras are always described generally; nobody is named unless the owner turned face recognition on for
// that camera (lib/cameras/analyze.mjs).
import * as cams from "./index.mjs";
import * as gate from "./gate.mjs";
import { summary, visitsText, countVisits } from "./alerts.mjs";
import { dayOf } from "./events.mjs";

let bcast = null;
async function open(url) { try { bcast ??= (await import("../bus.mjs")).broadcast; bcast("cameras", { open: url }); } catch { /* no screen */ } }

const norm = (s) => String(s ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["the", "my", "a", "an", "on", "at", "in", "from", "cam", "camera", "cameras", "cams", "feed", "view", "of", "for"]);
// the camera someone means: its name, its room, or its kind ("trail cam", "the gopro", "the printer")
export function findCam(words, list = cams.list()) {
  const q = norm(words); if (!q || !list.length) return null;
  const toks = q.split(" ").filter((w) => !STOP.has(w));
  let best = null, score = 0;
  for (const c of list) {
    const n = norm(c.name), r = norm(c.room);
    let s = 0;
    if (n && q.includes(n)) s += 100;
    if (r && q.includes(r)) s += 60;
    for (const t of toks) { if (t.length < 3) continue; if (n.split(" ").includes(t)) s += 25; else if (n.includes(t)) s += 12; if (r && r.split(" ").includes(t)) s += 20; }
    if (/\btrail\b|\bhunting\b|\bgame\b/.test(q) && (c.role === "trail" || c.kind === "email" || c.kind === "folder")) s += 40;
    if (/\bgo ?pro\b/.test(q) && c.kind === "gopro") s += 40;
    if (/\bprinter\b/.test(q) && c.role === "printer") s += 40;
    if (/\bwebcam\b/.test(q) && c.kind === "usb") s += 40;
    if (/\bsecurity\b/.test(q) && c.role === "security") s += 15;
    if (s > score) { score = s; best = c; }
  }
  return score >= 20 ? best : null;
}
// "last night", "today", "yesterday", "this morning", "this week" → { since, until, words }
export function period(text, now = new Date()) {
  const q = norm(text), d = (h, back = 0) => { const x = new Date(now); x.setDate(x.getDate() - back); x.setHours(h, 0, 0, 0); return x; };
  if (/\b(last nights?|overnight|tonights?)\b/.test(q)) return { since: d(18, 1).toISOString(), until: d(8).toISOString(), words: "last night" };
  if (/\byesterdays?\b/.test(q)) return { since: d(0, 1).toISOString(), until: d(0).toISOString(), words: "yesterday" };
  if (/\bthis mornings?\b/.test(q)) return { since: d(4).toISOString(), until: d(12).toISOString(), words: "this morning" };
  if (/\bthis (week|past week)\b|\blast (7|seven) days\b/.test(q)) return { since: d(0, 7).toISOString(), until: null, words: "this week" };
  if (/\btodays?\b/.test(q)) return { since: d(0).toISOString(), until: null, words: "today" };
  return { since: new Date(now.getTime() - 24 * 3600_000).toISOString(), until: null, words: "in the last day" };
}
const LABEL_WORDS = [["deer", /\b(deer|bucks?|does?|fawns?)\b/], ["person", /\b(people|persons?|someone|anyone|visitors?|intruders?)\b/], ["vehicle", /\b(cars?|trucks?|vehicles?)\b/], ["package", /\b(packages?|parcels?|deliver(y|ies))\b/], ["animal", /\b(animals?|critters?|wildlife)\b/]];
const labelIn = (q) => LABEL_WORDS.find(([, re]) => re.test(q))?.[0] ?? null;
const when = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export async function activity({ camera = null, text = "", label = null } = {}) {
  const list = cams.list();
  if (!list.length) return { text: "You don't have any cameras set up yet. Add one in Settings → Cameras." };
  const c = camera ? findCam(camera, list) : null;
  if (camera && !c) return { text: `I don't have a camera called "${camera}". Your cameras: ${list.map((x) => x.name).join(", ")}.` };
  const p = period(text);
  const lab = label ?? labelIn(norm(text));
  const s = summary({ cam: c?.id ?? null, since: p.since, until: p.until, label: lab, cams: list });
  const where = c ? `on ${c.name}` : "on your cameras";
  if (!s.events.length) return { text: `Nothing ${lab ? `with ${lab === "person" ? "people" : lab} ` : ""}${where} ${p.words}.`, events: [] };
  const latest = s.events[0];
  const words = c ? (s.cams[0]?.text || `${s.events.length} events`) : s.text;
  return { text: `${p.words[0].toUpperCase() + p.words.slice(1)} ${where}: ${words}. The latest was at ${when(latest.at)}${latest.summary ? ` (${latest.summary.replace(/\.$/, "")})` : ""}.`, events: s.events.slice(0, 20).map((e) => ({ id: e.id, cam: e.cam, at: e.at, labels: e.labels, summary: e.summary, clip: Boolean(e.clip) })) };
}
export async function show(camera = null) {
  const list = cams.list();
  if (!list.length) { await open("/setup?embed=1&s=cameras"); return { text: "You don't have any cameras yet. Here's where to add one." }; }
  if (!camera || /^(cameras?|cams?|all|everything)$/.test(norm(camera))) { await open("/cameras.html?embed=1"); return { text: "Here are your cameras." }; }
  const c = findCam(camera, list);
  if (!c) return { text: `I don't have a camera called "${camera}". You have ${list.map((x) => x.name).join(", ")}.` };
  await open(`/cameras.html?embed=1&cam=${encodeURIComponent(c.id)}`);
  return { text: `Here's ${c.name}.`, camera: c.id };
}
export async function play({ camera = null, text = "", label = null } = {}) {
  const list = cams.list();
  const c = camera ? findCam(camera, list) : null;
  const p = period(text || "today");
  const lab = label ?? labelIn(norm(text));
  const s = summary({ cam: c?.id ?? null, since: p.since, until: p.until, label: lab, cams: list });
  const ev = s.events.find((e) => e.clip) ?? s.events[0];
  if (!ev) return { text: `I don't have a ${lab ? lab + " " : ""}clip ${c ? `from ${c.name} ` : ""}${p.words}.` };
  await open(`/cameras.html?embed=1&event=${encodeURIComponent(ev.id)}`);
  const name = list.find((x) => x.id === ev.cam)?.name ?? "the camera";
  return { text: ev.clip ? `Playing the ${lab ?? ""} clip from ${name} at ${when(ev.at)}.`.replace(/\s+/g, " ") : `There's no video of that one, just the picture from ${name} at ${when(ev.at)}.`, event: ev.id };
}
export async function look({ camera, question = "" } = {}) {
  const c = findCam(camera ?? "", cams.list()) ?? (cams.list().length === 1 ? cams.list()[0] : null);
  if (!c) return { text: camera ? `I don't have a camera called "${camera}".` : "Which camera?" };
  const cam = cams.camera(c.id);
  const jpeg = await cams.snapshot(c.id);
  if (cam.ai?.enabled) {
    const v = await cams.analyze.aiVerdict(jpeg, cam, { question: question || "What do you see?", force: true });
    if (v.usedAI) return { text: v.answer || v.summary || "Nothing much.", labels: v.labels };
  }
  return { text: `I took a picture from ${c.name}, but "Analyse with AI" is off for it, so I can't say what's in it. It's on the screen.`, shown: await open(`/cameras.html?embed=1&cam=${encodeURIComponent(c.id)}`) };
}

// ---- voice commands without AI ----
export async function command(text) {
  await gate.ready;
  if (!gate.on()) return null;
  const q = norm(text);
  if (!/\b(cam|cams|camera|cameras|footage|clip|clips|recording|recordings|trail|gopro|go pro|webcam)\b/.test(q) && !/^what happened (in|at|on|out) /.test(q)) return null;
  const list = cams.list();
  let m;
  if ((m = /^(?:hey |ok )?(?:dayspring )?(?:(?:can you |please )?(?:show|open|pull up|bring up|put up|let me see|go to)(?: me)?(?: the| my)? (.+?)(?: camera| cam| feed| view)?|(?:open|show)(?: me)? (?:the |my )?(cameras|cams|camera page))(?: please| now)?$/.exec(q))) {
    const what = m[2] ? "cameras" : m[1];
    if (!/\b(cam|cams|camera|cameras|feed|webcam|gopro|go pro|trail)\b/.test(q)) return null;
    return (await show(what)).text;
  }
  if ((m = /^(?:play|show)(?: me)?(?: the)? (last nights?|tonights?|todays?|yesterdays?|this mornings?|the latest|the last|latest|last)? ?(.*?) ?(?:clip|video|recording|footage)(?: from| on)?(?: the)? ?(.*)$/.exec(q))) {
    const rest = `${m[2] ?? ""} ${m[3] ?? ""}`.trim();
    const c = findCam(rest, list);
    return (await play({ camera: c?.name ?? null, text: `${m[1] ?? ""} ${rest}`, label: labelIn(rest) })).text;
  }
  if (/^(?:was there |is there |were there |any |anything |has there been |did (?:the |my )?.+ see )/.test(q) || /\bactivity\b|\bmotion\b|\bmovement\b/.test(q) || /^what happened\b/.test(q) || /^(?:what|who) (?:did|came|was) /.test(q)) {
    if (!list.length) return /\b(cam|camera|cameras|trail)\b/.test(q) ? "You don't have any cameras set up yet. Add one in Settings → Cameras." : null;
    const c = findCam(q, list);
    if (/^what happened (in|at|on|out) /.test(q) && !c && !/\b(cam|camera|cameras|trail)\b/.test(q)) return null;   // "what happened in history" isn't about cameras
    return (await activity({ camera: c?.name ?? null, text: q })).text;
  }
  return null;
}
// for the no-AI intent list (lib/intents): the words go through command(), with a fallback line
export async function fromIntent(id, text) {
  return (await command(text)) ?? (id === "cameras.show" ? (await show("cameras")).text : "Say \"show me the front camera\", \"any activity on the trail cam?\" or \"play last night's deer clip\".");
}

// ---- the AI's tools ----
export const TOOLS = [
  { name: "camera_show", description: "Show a camera (or all cameras) on the Dayspring screen: live view, latest pictures and events. camera: its name, room or kind (\"front door\", \"trail cam\", \"shop\"); leave empty for all cameras.",
    input_schema: { type: "object", properties: { camera: { type: "string" } } } },
  { name: "camera_activity", description: "What the cameras saw: events (people, deer and other animals, vehicles, packages, motion) with times, for 'any activity on the trail cam?', 'what happened in the shop today?', 'any deer last night?'. People are described generally, never identified.",
    input_schema: { type: "object", properties: { camera: { type: "string", description: "name, room or kind; empty = all cameras" }, when: { type: "string", description: "today, last night, yesterday, this morning, this week" }, label: { type: "string", enum: ["person", "deer", "animal", "vehicle", "package", "motion"] } } } },
  { name: "camera_play", description: "Play a camera clip (or show its picture) on the screen: 'play last night's deer clip'.",
    input_schema: { type: "object", properties: { camera: { type: "string" }, when: { type: "string" }, label: { type: "string" } } } },
  { name: "camera_look", description: "Take a fresh picture from a camera and say what's in it (only if 'Analyse with AI' is on for that camera). question: what the owner wants to know.",
    input_schema: { type: "object", properties: { camera: { type: "string" }, question: { type: "string" } }, required: ["camera"] } },
];
export const tools = () => (gate.on() ? TOOLS : []);
export async function runTool(name, input = {}) {
  if (!name.startsWith("camera_")) return undefined;
  if (!gate.on()) return { error: "Cameras aren't turned on in this version." };
  try {
    if (name === "camera_show") return await show(input.camera || null);
    if (name === "camera_activity") return await activity({ camera: input.camera || null, text: input.when ?? "", label: input.label ?? null });
    if (name === "camera_play") return await play({ camera: input.camera || null, text: input.when ?? "", label: input.label ?? null });
    if (name === "camera_look") return await look({ camera: input.camera, question: input.question ?? "" });
  } catch (e) { return { error: e.message }; }
  return undefined;
}
export { visitsText, countVisits, dayOf };
