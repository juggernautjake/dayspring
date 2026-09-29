// Settings → Your assistant: the name, how it's said, and the wake words (paths are after /api):
//   GET  /assistant                        the name, how it's said, the wake words (lib/naming.mjs view())
//   POST /assistant { name?, say?, followsName?, wakeWords?, wakeSay?, wakeAlso?, sensitivity? }   save (400 + a friendly error)
//   POST /assistant/check { name } | { wake } | { say }   is it allowed, and what to know about it (sound-alikes, too short…)
//   GET  /wake/config                      what the screen needs to hear the wake words itself (public/wakeword.js)
//   POST /wake/test { text, alternatives? }  would this wake it, and what's the request? ("Try it")
//   POST /wake/also { word, also: [] }     the "also accept" words for one wake word
//   GET  /wake/train                       the training in progress (or the last report)
//   POST /wake/train/start { word? } · /wake/train/sample { id, alternatives } · /wake/train/finish · /wake/train/cancel
//   POST /wake/trained/forget { word, variant? }
// Every change is sent to the screens ("assistant" event: labels, the wake words) and to the Discord bot (its nickname).
import * as naming from "./naming.mjs";
import * as wake from "./wakeword.mjs";
import { broadcast } from "./bus.mjs";

naming.onChange((what) => {
  try { broadcast("assistant", { ...naming.view(), wakeConfig: wake.clientConfig(), what }); } catch { /* no screens */ }
  if (what === "name" && process.env.DISCORD_BOT_TOKEN) import("./discord/bot.mjs").then((d) => d.applyName?.()).catch(() => {});   // (only when there's a bot)
});

const trainEvent = (st) => { try { broadcast("wake-train", st); } catch { /* no screens */ } };

export async function handle(req, res, { m, p, send, readJSON }) {
  if (!(p === "/assistant" || p.startsWith("/assistant/") || p.startsWith("/wake/"))) return false;
  try {
    if (m === "GET" && p === "/assistant") return send(res, 200, naming.view()), true;
    if (m === "GET" && p === "/wake/config") return send(res, 200, wake.clientConfig()), true;
    if (m === "GET" && p === "/wake/train") return send(res, 200, naming.trainStatus()), true;
    if (m !== "POST") return false;
    const b = await readJSON(req).catch(() => ({}));
    if (p === "/assistant") {
      const warnings = [];
      if (b.name !== undefined || b.say !== undefined) {
        const r = naming.setName(b.name ?? naming.name(), b.say !== undefined ? { say: b.say } : {});
        if (!r.ok) return send(res, 400, { error: r.error, field: "name" }), true;
      }
      if (b.followsName === true) naming.setFollows(true);
      if (b.wakeWords !== undefined && b.followsName !== true) {
        const r = naming.setWakeWords(b.wakeWords, { say: b.wakeSay ?? null, also: b.wakeAlso ?? null });
        if (!r.ok) return send(res, 400, { error: r.error, field: "wake", word: r.word ?? null }), true;
        warnings.push(...r.warnings);
      }
      if (b.sensitivity !== undefined) { const r = naming.setSensitivity(String(b.sensitivity)); if (!r.ok) return send(res, 400, { error: r.error, field: "sensitivity" }), true; }
      return send(res, 200, { ...naming.view(), warnings }), true;
    }
    if (p === "/assistant/check") {
      if (b.name !== undefined) return send(res, 200, naming.checkName(b.name)), true;
      if (b.say !== undefined) return send(res, 200, naming.checkSay(b.say)), true;
      if (b.wake !== undefined) return send(res, 200, naming.describeWake(b.wake)), true;
      return send(res, 400, { error: "Check what? Send a name, a wake word or how to say it." }), true;
    }
    if (p === "/wake/test") {
      const alts = Array.isArray(b.alternatives) && b.alternatives.length ? b.alternatives : [String(b.text ?? "")];
      const hit = wake.matchAny(alts);
      return send(res, 200, { wakes: Boolean(hit), request: hit?.rest ?? null, heard: hit?.wake ?? null, how: hit?.how ?? null, score: hit?.score ?? 0, phrase: hit?.phrase ?? null }), true;
    }
    if (p === "/wake/also") { const r = naming.setAlso(String(b.word ?? ""), b.also ?? []); if (!r.ok) return send(res, 400, r), true; return send(res, 200, { ...naming.view(), also: r.also }), true; }
    if (p === "/wake/train/start") { const r = naming.trainStart({ word: b.word ?? null, want: b.want, from: String(b.from ?? "settings") }); if (!r.ok) return send(res, 400, r), true; trainEvent(r); return send(res, 200, r), true; }
    if (p === "/wake/train/sample") { const r = naming.trainSample(b.alternatives ?? b.text ?? [], { id: b.id ?? null }); if (!r.ok) return send(res, 400, r), true; trainEvent(r); return send(res, 200, r), true; }
    if (p === "/wake/train/finish") { const r = naming.trainFinish({ apply: b.apply !== false }); trainEvent(r); return send(res, 200, r), true; }
    if (p === "/wake/train/cancel") { const r = naming.trainCancel(); trainEvent(r); return send(res, 200, r), true; }
    if (p === "/wake/trained/forget") return send(res, 200, naming.forgetTrained(String(b.word ?? ""), b.variant ?? null)), true;
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
