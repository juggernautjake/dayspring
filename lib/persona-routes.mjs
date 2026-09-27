// Settings → Personality (paths are after /api):
//   GET  /persona                         the character, sliders, templates, presets (and whether the sage egg is on)
//   POST /persona/preset {id}             pick a built-in character
//   POST /persona/slider {kind,id,value}  move a base ("base") or role ("role") slider; returns what moved
//   POST /persona/pin {id}                pin / unpin a base slider
//   POST /persona/normal                  back to Default
//   POST /persona/preview                 sample lines in the current personality (no AI needed)
//   POST /persona/preview {id, base?, role?}   developer preview only (lib/dev): any character's lines, found or not,
//                                         with the sandbox's sliders, without switching or saving anything (else 404)
//   POST /persona/build {text}            a custom persona card from ≤300 words (with AI) or the keyword guess
//   POST /persona/custom {text, card}     use (and keep) a reviewed custom card
//   POST /persona/voice {voice}           switch to the suggested voice (only when the person asks)
//   GET  /persona/templates/export        the saved personalities as JSON
//   POST /persona/templates {name, emoji, voice, alwaysVoice}         save the current setup
//   POST /persona/templates/import {json, replace}
//   POST /persona/templates/:id/(apply|rename|duplicate|delete|default|update)
import * as persona from "./persona/index.mjs";
import * as llm from "./llm.mjs";
import * as voice from "./voice.mjs";
import * as settings from "./settings.mjs";
import { broadcast } from "./bus.mjs";
import * as dev from "./dev/status.mjs";

// voices: offer the one that fits the current voice service; switching only ever happens when the person says yes
persona.setDeps({
  pickVoice: (v) => { const p = voice.ttsProvider(); return p === "openai" ? v.openai : p === "elevenlabs" ? v.eleven : v.edge ?? v.eleven; },
  voiceName: () => { try { return voice.voiceReady().voiceName ?? settings.get().voice ?? null; } catch { return null; } },
  setVoice: (name) => {
    const p = voice.ttsProvider();
    if (p === "elevenlabs") return voice.setVoice(name);
    if (p === "openai") return settings.set({ openaiVoice: String(name).toLowerCase() });
    throw new Error("This voice service's voices are chosen in Settings → Voice.");
  },
});
persona.onChange(() => { try { broadcast("persona", { describe: persona.describe() }); } catch { /* no screens */ } });
// A secret character was found: sparkles on every screen, and (unless it was found by saying something, whose reply
// already tells them) a "discoveries" notification: spoken, chimed or silent per Settings → Notifications, visual only
// when Dayspring is Off, and the desktop card when the screen is closed.
// Unlocked with XP: its own celebration (sparkles, a card, and a "discoveries" notification)
persona.onUnlock((u) => {
  try { broadcast("persona-discovered", { ...u, reveal: `Unlocked for ${u.cost} XP`, unlockedNow: true }); } catch { /* no screens */ }
  import("./announcer.mjs").then((a) => a.announce({ kind: "discovery", title: "🔓 Character unlocked", text: `${u.text}${u.line ? " " + u.line : ""}` })).catch(() => {});
});
persona.onDiscover((d) => {
  try { broadcast("persona-discovered", d); } catch { /* no screens */ }
  if (d.how === "phrase") return;
  import("./announcer.mjs").then((a) => a.announce({ kind: "discovery", title: "✨ Secret character found", text: `${d.text}${d.line ? " " + d.line : ""}` })).catch(() => {});
});

// sample lines; with a state (the developer preview), that character's instead of the current one
export function preview(state = null, { seed = "preview" } = {}) {
  const ph = (k, o) => (state ? persona.phraseAs(state, k, o) : persona.phrase(k, o)), st = (t, o) => (state ? persona.styleAs(state, t, o) : persona.style(t, o));
  const kinds = ["greeting", "ack", "done", "jokeIntro", "notSure", "goodNews", "badNews"];
  const out = Object.fromEntries(kinds.map((k) => [k, ph(k, { seed: seed + k }) ?? st(DEFAULT_LINES[k], { kind: k, seed: seed + k })]));
  out.reply = st("Your meeting is at 3:30. It's 72 degrees and sunny today.", { kind: "reply", seed });
  out.timerDone = st("Your pasta timer is done.", { kind: "timerDone", seed });
  return out;
}
const DEFAULT_LINES = { greeting: "Hi there.", ack: "Okay.", done: "Done.", jokeIntro: "Here's one.", notSure: "Sorry, I didn't catch that.", goodNews: "That's great news!", badNews: "Oh no, I'm sorry." };

export async function handle(req, res, { m, p, send, readJSON }) {
  if (!p.startsWith("/persona")) return false;
  try {
    if (m === "GET" && p === "/persona") return send(res, 200, persona.view()), true;
    if (m === "GET" && p === "/persona/templates/export") return send(res, 200, { json: persona.exportTemplates() }), true;
    if (m !== "POST") return false;
    const b = await readJSON(req).catch(() => ({}));
    if (p === "/persona/preset") { const r = persona.selectPreset(b.id); return send(res, 200, { ...persona.view(), voiceOffer: r.voiceOffer, easter: r.easter, discovered: r.discovered }), true; }
    if (p === "/persona/slider") { const r = persona.setSlider(b.kind === "role" ? "role" : "base", String(b.id), Number(b.value)); return send(res, 200, { ...persona.view(), moved: r.moved, easter: r.easter, discovered: r.discovered }), true; }
    if (p === "/persona/pin") { persona.togglePin(String(b.id)); return send(res, 200, persona.view()), true; }
    if (p === "/persona/normal") { persona.normal(); return send(res, 200, persona.view()), true; }
    if (p === "/persona/secrets/unlock") { const r = await persona.unlockSecret(String(b.id ?? "")); if (!r.ok && !r.already) throw new Error(r.message); return send(res, 200, { ...persona.view(), unlocked: r }), true; }
    if (p === "/persona/secrets/hints") { persona.setRevealHints(Boolean(b.on)); return send(res, 200, persona.view()), true; }
    if (p === "/persona/secrets/reset") { if (b.confirm !== true) throw new Error("Confirm first."); persona.resetDiscoveries(); return send(res, 200, persona.view()), true; }
    if (p === "/persona/event") { const d = persona.event(String(b.name ?? ""), b.data ?? {}); return send(res, 200, { discovered: d }), true; }
    if (p === "/persona/preview") {
      if (b.id === undefined && b.base === undefined && b.role === undefined) return send(res, 200, preview()), true;
      // any other character: the developer preview only (no trace otherwise)
      if (!dev.isDev()) return send(res, 404, { error: "Not found." }), true;
      const state = persona.stateFor(String(b.id ?? persona.get().preset), { base: b.base, role: b.role });
      return send(res, 200, { ...preview(state, { seed: String(b.seed ?? "preview") }), dev: true, id: state.preset, describe: persona.describeAs(state), sage: persona.sageAs(state), voice: persona.voiceFor(state.preset) }), true;
    }
    if (p === "/persona/build") return send(res, 200, await persona.buildCustom(String(b.text ?? ""), { llm })), true;
    if (p === "/persona/custom") { persona.saveCustom({ text: b.text, card: b.card }); return send(res, 200, persona.view()), true; }
    if (p === "/persona/voice") { const nm = String(b.voice ?? ""); if (!nm) throw new Error("Which voice?"); await Promise.resolve(personaSetVoice(nm)); return send(res, 200, { ok: true, voice: nm }), true; }
    if (p === "/persona/templates") { const r = persona.saveTemplate(b.name, { emoji: b.emoji, voice: b.voice, alwaysVoice: b.alwaysVoice }); return send(res, 200, { ...persona.view(), template: r.template }), true; }
    if (p === "/persona/templates/import") { const r = persona.importTemplates(b.json, { replace: Boolean(b.replace) }); return send(res, 200, { ...persona.view(), import: r }), true; }
    const mm = /^\/persona\/templates\/([\w-]+)\/(apply|rename|duplicate|delete|default|update)$/.exec(p);
    if (mm) {
      const [, id, act] = mm;
      let extra = {};
      if (act === "apply") { const r = persona.applyTemplate(id); extra = { voiceOffer: r.voiceOffer, switchedVoice: r.switchedVoice, easter: r.easter }; }
      else if (act === "rename") persona.renameTemplate(id, b.name);
      else if (act === "duplicate") persona.duplicateTemplate(id);
      else if (act === "delete") persona.deleteTemplate(id);
      else if (act === "default") persona.setDefaultTemplate(b.clear ? null : id);
      else if (act === "update") persona.updateTemplate(id, b);
      return send(res, 200, { ...persona.view(), ...extra }), true;
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
function personaSetVoice(name) {
  const p = voice.ttsProvider();
  if (p === "elevenlabs") return voice.setVoice(name);
  if (p === "openai") return settings.set({ openaiVoice: String(name).toLowerCase() });
  throw new Error("This voice service's voices are chosen in Settings → Voice.");
}
