// Outbound texts for the schedule: block reminders, the morning brief, the evening review.
// Only ever sends to DAYSPRING_NOTIFY_NUMBER (the owner's phone). Business notifications are the website's job.
import * as store from "./store.mjs";

const SID = () => process.env.TWILIO_ACCOUNT_SID ?? "";
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN ?? "";
const FROM = () => process.env.DAYSPRING_TWILIO_NUMBER ?? "";
const TO = () => process.env.DAYSPRING_NOTIFY_NUMBER ?? "";
const LEAD = () => Number(process.env.DAYSPRING_REMIND_MINUTES ?? 10);
const BRIEF_AT = () => process.env.DAYSPRING_MORNING_BRIEF ?? "";   // "06:45" or empty to disable
const REVIEW_AT = () => process.env.DAYSPRING_EVENING_REVIEW ?? ""; // "21:30" or empty to disable

// DAYSPRING_REMINDER_CHANNEL: "sms" (needs A2P/toll-free approval), "call" (reads reminders aloud), or "off" (scheduler idle; nothing is sent).
const CHANNEL = () => (process.env.DAYSPRING_REMINDER_CHANNEL ?? "sms").toLowerCase();
export const CHANNELS = ["sms", "call", "off"];

export function notifyReady() {
  const creds = Boolean(SID() && TOKEN() && FROM() && TO());
  const channel = CHANNEL();
  return { canSend: creds && channel !== "off", creds, to: TO() || null, channel, remindMinutes: LEAD(), morningBrief: BRIEF_AT() || null, eveningReview: REVIEW_AT() || null };
}

export async function sendSms(body, to = TO()) {
  if (!SID() || !TOKEN() || !FROM()) throw new Error("Twilio creds or DAYSPRING_TWILIO_NUMBER missing");
  if (!to) throw new Error("DAYSPRING_NOTIFY_NUMBER is not set");
  const auth = Buffer.from(`${SID()}:${TOKEN()}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Messages.json`, { signal: AbortSignal.timeout(20_000),
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: FROM(), Body: body.slice(0, 1600) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Twilio ${res.status}`);
  return { sid: json.sid, status: json.status };
}

// Voice-call fallback: US carriers block SMS from numbers without A2P 10DLC registration
// (Twilio error 30034), but calls go through. DAYSPRING_REMINDER_CHANNEL=call uses this.
const xml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

export async function placeCall(text, to = TO()) {
  if (!SID() || !TOKEN() || !FROM()) throw new Error("Twilio creds or DAYSPRING_TWILIO_NUMBER missing");
  if (!to) throw new Error("DAYSPRING_NOTIFY_NUMBER is not set");
  const auth = Buffer.from(`${SID()}:${TOKEN()}`).toString("base64");
  const spoken = text.replace(/\n/g, ". ").replace(/—/g, ",");
  const twiml = `<Response><Pause length="1"/><Say voice="Google.en-US-Chirp3-HD-Aoede">${xml(spoken)}</Say></Response>`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Calls.json`, { signal: AbortSignal.timeout(20_000),
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: FROM(), Twiml: twiml }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Twilio ${res.status}`);
  return { sid: json.sid, status: json.status, channel: "call" };
}

// Send via whichever channel is configured.
export async function deliver(text, to = TO()) {
  const ch = CHANNEL();
  if (ch === "off") throw new Error("reminders are off (DAYSPRING_REMINDER_CHANNEL=off)");
  if (!CHANNELS.includes(ch)) throw new Error(`unknown DAYSPRING_REMINDER_CHANNEL "${ch}" (use sms, call, or off)`);
  return ch === "call" ? placeCall(text, to) : sendSms(text, to);
}

// ---- message builders --------------------------------------------------------------

const hm = (t) => { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`; };

export function briefText(date = store.todayISO()) {
  const blocks = store.blocksBetween(date, date).filter((b) => !b.done);
  const tasks = store.tasks(false);
  const clash = store.overlapsOn(date);
  const lines = [`Today (${date.slice(5).replace("-", "/")}):`];
  if (!blocks.length) lines.push("nothing scheduled.");
  for (const b of blocks) lines.push(`${hm(b.start)} ${b.title}${clash.has(b.id) ? " (overlap!)" : ""}`);
  if (tasks.length) lines.push(`Tasks: ${tasks.slice(0, 5).map((t) => t.title).join("; ")}${tasks.length > 5 ? ` +${tasks.length - 5}` : ""}`);
  return lines.join("\n");
}

export function reviewText(date = store.todayISO()) {
  const blocks = store.blocksBetween(date, date);
  const done = blocks.filter((b) => b.done), missed = blocks.filter((b) => !b.done);
  const tomorrow = store.addDays(date, 1);
  const first = store.blocksBetween(tomorrow, tomorrow)[0];
  return [
    `Day done: ${done.length}/${blocks.length} blocks.`,
    missed.length ? `Not marked done: ${missed.map((b) => b.title).join(", ")}.` : "Everything checked off.",
    first ? `Tomorrow starts ${hm(first.start)} with ${first.title}.` : "Tomorrow is empty so far.",
  ].join(" ");
}

// ---- scheduler ------------------------------------------------------------------------

const sentToday = new Set(); // keys like "brief:2026-09-11", "review:...", "block:<id>"
let lastDate = store.todayISO();

export async function tick(log = console.log) {
  const now = new Date();
  const today = store.todayISO(now);
  if (today !== lastDate) { sentToday.clear(); lastDate = today; }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  if (!notifyReady().canSend) return;

  const fire = async (key, text) => {
    if (sentToday.has(key)) return;
    sentToday.add(key);
    try { const r = await deliver(text); log(`${r.channel ?? "sms"} sent (${key}) → ${r.status}`); }
    catch (err) { log(`reminder FAILED (${key}): ${err.message}`); }
  };

  if (BRIEF_AT() && nowMin === toMin(BRIEF_AT())) await fire(`brief:${today}`, briefText(today));
  if (REVIEW_AT() && nowMin === toMin(REVIEW_AT())) await fire(`review:${today}`, reviewText(today));

  for (const b of store.blocksBetween(today, today)) {
    if (b.done) continue;
    const startsIn = toMin(b.start) - nowMin;
    if (startsIn === LEAD()) await fire(`block:${b.id}`, `In ${LEAD()} min: ${b.title} (${hm(b.start)}–${hm(b.end)})${b.description ? ` — ${b.description}` : ""}`);
  }
}
