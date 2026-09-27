// Routes for Dayspring in calls (Discord, Zoom, Google Meet, Teams) and the Discord chat companion (Settings → Calls).
//   GET  /calls/status              → Tune in, the Discord bot, answering into the call, which app is open, settings
//   GET  /calls/apps                → per-app setup cards: the exact microphone and speaker to pick on this computer
//   POST /calls/test { ms? }        → listens (read-only) while the display plays a test phrase into the call mixer
//   GET  /calls/latency             → the last 10 answers' timings (end of speech → first sound)
//   POST /calls/latency/mark { id, name } → the display reports when an answer's first sound started
//   GET  /calls/settings, POST /calls/settings { … }   → data/calls.json
//   GET  /tts/stream?text=…         → the voice for one sentence, streamed as it's made (204 = the browser's own voice)
//   GET  /discord/invite            → the link that adds the bot to a server (with slash commands)
// Nothing here changes a device: the cards only say what to pick.
import * as tunein from "./tunein.mjs";
import * as bridge from "./callbridge.mjs";
import * as cfg from "./calls/config.mjs";
import * as latency from "./calls/latency.mjs";
import * as apps from "./calls/apps.mjs";
import * as voice from "./voice.mjs";

// View Channels, Send Messages, Send Messages in Threads, Embed Links, Add Reactions, Read Message History,
// Connect, Speak, Use Voice Activity, Use Application Commands
const PERMS = [1n << 10n, 1n << 11n, 1n << 38n, 1n << 14n, 1n << 6n, 1n << 16n, 1n << 20n, 1n << 21n, 1n << 25n, 1n << 31n].reduce((a, b) => a | b, 0n);
export const inviteUrl = (appId) => `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&scope=bot%20applications.commands&permissions=${PERMS}`;

async function botStatus() { try { return (await import("./discord/bot.mjs")).status(); } catch { return { configured: false, status: "off" }; } }
async function cards(fresh = false) {
  const t = tunein.status();
  const dev = await apps.devices({ fresh }).catch(() => ({ callMic: null, voiceTo: null, yourSpeakers: null, voicemeeterInstalled: null }));
  return { devices: dev, listening: t.on ? t.device : null, app: t.on ? { app: t.app, label: t.appLabel, inMeeting: t.inMeeting } : await apps.detect().catch(() => null), guides: apps.guides(dev, t.on ? t.device : null) };
}
const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (p === "/calls/status" && m === "GET") {
    const bot = await botStatus();
    return send(res, 200, { tunein: tunein.status(), talk: bridge.status(), bot, settings: cfg.get(), tts: voice.ttsProvider(), arbitration: cfg.get().arbitration, answering: bot.voice && cfg.get().arbitration === "bot" ? "bot" : tunein.isOn() ? "tunein" : null }), true;
  }
  if (p === "/calls/apps" && m === "GET") return send(res, 200, await cards(q?.get("fresh") === "1")), true;
  if (p === "/calls/test" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const c = await cards(true);
    const listening = c.listening || c.devices.yourSpeakers;
    const r = await apps.selfCheck({ ms: Math.max(1500, Math.min(10_000, Number(b.ms) || 5000)), voiceTo: c.devices.voiceTo, listening });
    const talk = bridge.status();
    return send(res, 200, { ...r, voicemeeterInstalled: c.devices.voicemeeterInstalled, voicemeeterRunning: Boolean(talk.voicemeeter?.running), talk: Boolean(talk.talk), callMic: c.devices.callMic }), true;
  }
  if (p === "/calls/latency" && m === "GET") {
    const last = latency.last();
    return send(res, 200, { last, median: median(last.map((x) => x.total)), medianOffline: median(last.filter((x) => x.offline).map((x) => x.total)), targetMs: { ai: 1500, offline: 800 } }), true;
  }
  if (p === "/calls/latency/mark" && m === "POST") { const b = await readJSON(req).catch(() => ({})); if (b.id && /^[a-zA-Z]{2,20}$/.test(b.name ?? "")) latency.markById(String(b.id), b.name); return send(res, 200, { ok: true }), true; }
  if (p === "/calls/settings" && m === "GET") return send(res, 200, cfg.get()), true;
  if (p === "/calls/settings" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const before = cfg.get().dm;
    const next = cfg.set(b);
    // the DM setting decides whether the slash commands exist in DMs: register again
    if (next.dm !== before) import("./discord/bot.mjs").then((bot) => bot.status().status === "online" && bot.restart()).catch(() => {});
    return send(res, 200, next), true;
  }
  if (p === "/tts/stream" && m === "GET") {
    const text = String(q?.get("text") ?? "").trim().slice(0, 900);
    if (!text) return send(res, 400, { error: "text is required" }), true;
    tunein.noteSaid(text); tunein.speaking(true, 2500 + text.length * 70);
    const { openStream } = await import("./calls/tts-stream.mjs");
    let r;
    try { r = await openStream(text); } catch (e) { return send(res, e.status || 502, { error: e.message }), true; }
    if (r.browser) { res.writeHead(204, { "x-voice": "browser" }); res.end(); return true; }
    res.writeHead(200, { "content-type": r.type, "cache-control": "no-store", "x-voice-model": r.model ?? "cached" });
    try { for await (const chunk of r.stream) { if (!res.write(chunk)) await new Promise((ok) => res.once("drain", ok)); if (res.destroyed) break; } }
    catch { /* the display stopped listening (✋ Stop, or talked over) */ }
    res.end();
    return true;
  }
  if (p === "/discord/invite" && m === "GET") {
    const bot = await botStatus();
    const id = bot.userId || process.env.DISCORD_APP_ID || "";
    if (!id) return send(res, 200, { url: null, why: bot.configured ? "Start the bot first (it needs to sign in once to know its ID)." : "Add your bot token first (Settings → Discord)." }), true;
    return send(res, 200, { url: inviteUrl(id) }), true;
  }
  return false;
}
