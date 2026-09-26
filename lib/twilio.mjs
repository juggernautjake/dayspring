// Twilio voice + SMS for Dayspring. No SDK: TwiML is a few XML tags and the request
// signature is one HMAC. Speech-to-text and text-to-speech are Twilio's own (<Gather
// input="speech"> and <Say>), so there are no extra voice API keys to manage.
//
// Flow for a call:
//   Twilio -> POST /twilio/voice          greet, listen
//   Twilio -> POST /twilio/voice/turn     SpeechResult -> assistant -> say reply, listen again
// Flow for a text:
//   Twilio -> POST /twilio/sms            Body -> assistant -> reply
import { createHmac } from "node:crypto";
import { chat } from "./assistant.mjs";
import * as owner from "./owner.mjs";

const SID = () => process.env.TWILIO_ACCOUNT_SID ?? "";
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN ?? "";
const NUMBER = () => process.env.DAYSPRING_TWILIO_NUMBER ?? "";
const ALLOWED = () => (process.env.DAYSPRING_ALLOWED_CALLERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export const publicUrl = () => (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");

export function twilioReady() {
  return { creds: Boolean(SID() && TOKEN()), number: NUMBER() || null, publicUrl: publicUrl() || null, allowed: ALLOWED().length };
}

// ---- security --------------------------------------------------------------------

// Twilio signs: full URL + POST params sorted by key, concatenated key+value, HMAC-SHA1 with the auth token, base64.
export function validSignature(fullUrl, params, header) {
  if (!TOKEN() || !header) return false;
  const keys = Object.keys(params).sort();
  const data = fullUrl + keys.map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", TOKEN()).update(data).digest("base64");
  return expected === header;
}

function allowed(from) {
  const list = ALLOWED();
  return list.length === 0 || list.includes(from);
}

// ---- TwiML ---------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const VOICE = process.env.DAYSPRING_VOICE || "Google.en-US-Chirp3-HD-Aoede"; // Chirp 3 HD generative voice; override in .env

function say(text) { return `<Say voice="${VOICE}">${esc(text)}</Say>`; }
function gather(prompt) {
  return `<Gather input="speech" action="/twilio/voice/turn" method="POST" speechTimeout="auto" language="en-US" enhanced="true" speechModel="phone_call">${prompt ? say(prompt) : ""}</Gather>`;
}
const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

// One conversation per phone number per channel, kept in memory.
const histories = new Map();
const hist = (key) => histories.get(key) ?? [];

function endTurn(text) {
  return /\b(bye|goodbye|that's all|thats all|done|hang up|thank you|thanks)\b/i.test(text);
}

// ---- handlers --------------------------------------------------------------------

export async function handleVoiceStart(params) {
  if (!allowed(params.From)) return twiml(say("Sorry, this number isn't set up for you.") + "<Hangup/>");
  histories.delete(`voice:${params.From}`);
  return twiml(gather(`Hey ${owner.name()}. What do you need?`));
}

export async function handleVoiceTurn(params) {
  if (!allowed(params.From)) return twiml("<Hangup/>");
  const heard = (params.SpeechResult ?? "").trim();
  if (!heard) return twiml(gather("I didn't catch that. Say it again?"));
  const key = `voice:${params.From}`;
  const out = await chat(hist(key), heard, { surface: "phone call" });
  histories.set(key, out.history);
  if (endTurn(heard)) return twiml(say(out.reply || "Talk later.") + "<Hangup/>");
  return twiml(say(out.reply) + gather("") + say("Anything else?") + gather(""));
}

export async function handleSms(params) {
  if (!allowed(params.From)) return twiml("");
  const body = (params.Body ?? "").trim();
  if (!body) return twiml("");
  const key = `sms:${params.From}`;
  const out = await chat(hist(key), body, { surface: "text message" });
  histories.set(key, out.history);
  return twiml(`<Message>${esc(out.reply)}</Message>`);
}

// ---- Twilio REST helpers (number setup + webhook pointing) ----------------------------

async function rest(path, method = "GET", form) {
  const auth = Buffer.from(`${SID()}:${TOKEN()}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}${path}`, {
    method,
    headers: { authorization: `Basic ${auth}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Twilio ${res.status}`);
  return json;
}

export async function listNumbers() {
  const j = await rest("/IncomingPhoneNumbers.json?PageSize=20");
  return j.incoming_phone_numbers.map((n) => ({ sid: n.sid, number: n.phone_number, name: n.friendly_name, voiceUrl: n.voice_url, smsUrl: n.sms_url }));
}

export async function searchNumbers(areaCode = "254") {
  const j = await rest(`/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode}&VoiceEnabled=true&SmsEnabled=true&PageSize=5`);
  return j.available_phone_numbers.map((n) => ({ number: n.phone_number, locality: n.locality, region: n.region }));
}

export async function buyNumber(number) {
  const j = await rest("/IncomingPhoneNumbers.json", "POST", { PhoneNumber: number, FriendlyName: "Dayspring" });
  return { sid: j.sid, number: j.phone_number };
}

// Point the Dayspring number's voice and SMS webhooks at this app's public URL.
export async function pointWebhooks(base) {
  const nums = await listNumbers();
  const mine = nums.find((n) => n.number === NUMBER());
  if (!mine) throw new Error(`DAYSPRING_TWILIO_NUMBER ${NUMBER() || "(unset)"} is not on this Twilio account`);
  await rest(`/IncomingPhoneNumbers/${mine.sid}.json`, "POST", {
    VoiceUrl: `${base}/twilio/voice`, VoiceMethod: "POST",
    SmsUrl: `${base}/twilio/sms`, SmsMethod: "POST",
  });
  return { number: mine.number, voice: `${base}/twilio/voice`, sms: `${base}/twilio/sms` };
}
