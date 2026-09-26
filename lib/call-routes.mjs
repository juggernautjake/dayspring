// Routes for Tune in (listen to what's playing in the headset) and Talk into calls (Voicemeeter bridge).
//   GET  /tunein                    → status (tune in + talk + speech-to-text)
//   POST /tunein  { on, device? }   → turn listening on/off
//   POST /tunein/install            → download local speech-to-text (whisper.cpp) — the owner asked for it
//   GET  /tunein/devices            → playback devices it can listen to
//   POST /tunein/speaking { on, ms } → the display is speaking (don't answer ourselves)
//   POST /tunein/said { text }      → something Dayspring said (for echo filtering)
//   POST /call/talk { on }          → Dayspring's answers go into the call (on) or only the headset (off)
//   POST /call/finish               → close the bridge (after the call app's mic is back on the headset)
import * as lantern from "./lantern.mjs";
import * as tunein from "./tunein.mjs";
import * as bridge from "./callbridge.mjs";
import * as stt from "./stt.mjs";
import * as loopback from "./loopback.mjs";

const full = () => ({ ...tunein.status(), talk: bridge.status() });
let installing = null;

export async function handle(req, res, { m, p, send, readJSON }) {
  if (p === "/tunein" && m === "GET") return send(res, 200, full()), true;
  if (p === "/tunein" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const on = b.on ?? !tunein.isOn();
    const r = on ? await tunein.start({ device: b.device || null }) : await tunein.stop();
    return send(res, 200, { ...r, talk: bridge.status() }), true;
  }
  if (p === "/tunein/install" && m === "POST") {
    if (!installing) installing = stt.install().finally(() => { installing = null; });
    try { const r = await installing; return send(res, 200, { ok: true, stt: r }), true; }
    catch (e) { return send(res, 500, { ok: false, error: e.message }), true; }
  }
  if (p === "/tunein/devices" && m === "GET") {
    try { return send(res, 200, { devices: await loopback.devices() }), true; } catch (e) { return send(res, 500, { error: e.message }), true; }
  }
  if (p === "/tunein/speaking" && m === "POST") { const b = await readJSON(req).catch(() => ({})); tunein.speaking(Boolean(b.on), Number(b.ms) || 0); if ((b.kind ?? "voice") === "voice") lantern.selfSpeakingChanged(Boolean(b.on)); return send(res, 200, { ok: true, peerSpeaking: lantern.peerSpeakingNow() }), true; }
  if (p === "/tunein/said" && m === "POST") { const b = await readJSON(req).catch(() => ({})); tunein.noteSaid(b.text); return send(res, 200, { ok: true }), true; }
  if (p === "/call/talk" && m === "POST") { const b = await readJSON(req).catch(() => ({})); return send(res, 200, await bridge.setTalk(b.on ?? !bridge.isTalking())), true; }
  if (p === "/call/finish" && m === "POST") return send(res, 200, await bridge.finish()), true;
  return false;
}

// Spoken/typed commands, for the server's /chat (before the assistant): returns a reply string, or null.
export async function command(text) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?,]/g, "").trim();
  if (/^(?:dayspring )?(tune in|start tuning in|listen to (?:the |my )?(?:call|headset|game|discord)|call mode on|join (?:my |the )?(?:discord )?call)$/.test(t)) {
    const r = await tunein.start();
    return r.ok ? `I'm tuned in. Say my name on the call and I'll answer${bridge.isTalking() ? " right into the call" : " in your headset"}.` : r.needsInstall ? "I need to install speech-to-text first. Press the headphones button and choose Install." : `I couldn't tune in: ${r.why}`;
  }
  if (/^(?:dayspring )?(tune out|stop tuning in|stop listening to (?:the |my )?(?:call|headset|game|discord)|call mode off|leave (?:the |my )?(?:discord )?call)$/.test(t)) { await tunein.stop(); return "Okay, I've stopped listening to the call."; }
  if (/^(?:are you|is dayspring) (?:listening|tuned in)(?: to (?:the|my) (?:call|headset))?$/.test(t)) return tunein.isOn() ? `Yes, I'm tuned in to ${tunein.status().device ?? "your headset"}.` : "No, I'm not listening to the call right now.";
  if (/^(?:dayspring )?(?:talk|speak) (?:into|in) (?:the |my )?calls?$/.test(t)) { const s = await bridge.setTalk(true); return s.talk ? "Okay, when you tune me in, my answers go into the call. In Discord, set your input device to Voicemeeter Out B1." : `I couldn't set that up: ${s.error}`; }
  if (/^(?:dayspring )?(?:stop talking into|don'?t talk into) (?:the |my )?calls?$/.test(t)) { await bridge.setTalk(false); return "Okay, my answers stay in your headset."; }
  return null;
}
