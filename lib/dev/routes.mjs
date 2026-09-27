// The developer preview's own routes (paths are after /api). Every one answers 404 unless this is a verified developer
// computer (lib/dev/status.mjs), so on anyone else's Dayspring there's no trace of them.
//   GET  /dev/status                        { dev: true, via, issued, trial }
//   GET  /dev/persona/characters            every character: built-in, every secret (found or not), the easter egg
//   POST /dev/persona/try {id, role?, base?}   wear a character for 10 minutes, then go back to exactly what was on
//   POST /dev/persona/try/end               go back now
//   POST /dev/persona/unlock-all            "Dev: unlock all (testing)": every secret found and unlocked, free (logged)
//   POST /dev/persona/reset-unlocks         "Dev: reset unlocks": takes back exactly those (logged)
// Previewing lines is POST /persona/preview {id} and badges are /xp/badges?dev=1 (their own route files check too).
import * as dev from "./status.mjs";
import * as persona from "../persona/index.mjs";

const NOT_FOUND = { error: "Not found." };
// a trial that was running when Dayspring stopped still ends on time
setTimeout(() => { try { if (dev.isDev()) persona.devResumeTrial(); else persona.get(); } catch { /* no personality yet */ } }, 1500).unref?.();

export async function handle(req, res, { m, p, send, readJSON }) {
  if (p !== "/dev" && !p.startsWith("/dev/")) return false;
  if (!dev.isDev()) return send(res, 404, NOT_FOUND), true;
  try {
    if (m === "GET" && p === "/dev/status") { const s = dev.status(); return send(res, 200, { dev: true, via: s.via, issued: s.issued, trial: persona.devTrial() }), true; }
    if (m === "GET" && p === "/dev/persona/characters") return send(res, 200, { dev: true, characters: persona.devCharacters(), trial: persona.devTrial(), current: persona.get().preset }), true;
    if (m !== "POST") return send(res, 404, NOT_FOUND), true;
    const b = await readJSON(req).catch(() => ({}));
    if (p === "/dev/persona/try") {
      const t = persona.devTry(String(b.id ?? ""), { role: b.role ?? null, base: b.base ?? null });
      await dev.log("persona.try", { id: t.id, minutes: Math.round(t.msLeft / 60000) });
      return send(res, 200, { ok: true, trial: t, view: persona.view() }), true;
    }
    if (p === "/dev/persona/try/end") { const r = persona.devEndTrial(); if (r.ended) await dev.log("persona.try.end", {}); return send(res, 200, { ok: true, ...r, view: persona.view() }), true; }
    if (p === "/dev/persona/unlock-all") {
      const r = persona.devUnlockAll();
      await dev.log("persona.unlock-all", { added: r.added, note: "testing only; undo with Dev: reset unlocks" });
      return send(res, 200, { ok: true, ...r, view: persona.view() }), true;
    }
    if (p === "/dev/persona/reset-unlocks") {
      const r = persona.devResetUnlocks();
      await dev.log("persona.reset-unlocks", { removed: r.removed });
      return send(res, 200, { ok: true, ...r, view: persona.view() }), true;
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return send(res, 404, NOT_FOUND), true;
}
