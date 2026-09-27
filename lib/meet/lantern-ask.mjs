// Asking Lantern itself, when Lantern offers it (POST /api/local/ask, with the ecosystem token):
//   request  { question, askerName, course, surface: "meeting" }
//   response { answer, short, citations: [{ course, lessonId, title, unit, lesson, localUrl, publicUrl }], persona }
// → { spoken, detail, citations, via: "lantern" } | null (Lantern isn't running, or has no /ask yet: Dayspring answers as Lantern)
let call = async (path, opts) => { const { ecoApi } = await import("../lantern.mjs"); const eco = ecoApi(); return eco ? eco.call("lantern", path, opts) : { ok: false, status: 0 }; };
export function _setCall(fn) { call = fn; }

let missingUntil = 0;                            // a 404 is remembered for a minute (no waiting on every question)
export async function ask({ question, askerName = null, course = null }) {
  if (Date.now() < missingUntil) return null;
  let r;
  try { r = await call("/api/local/ask", { method: "POST", body: { question, askerName, course, surface: "meeting" }, timeoutMs: 20_000 }); }
  catch { return null; }
  if (!r?.ok) { if (r?.status === 404 || r?.status === 405 || r?.status === 501) missingUntil = Date.now() + 60_000; return null; }
  const d = r.data ?? {};
  const answer = String(d.answer ?? "").trim(), short = String(d.short ?? "").trim();
  if (!answer && !short) return null;
  const citations = (Array.isArray(d.citations) ? d.citations : []).slice(0, 3).map((c) => ({
    course: c.course ?? course, lessonId: String(c.lessonId ?? ""), title: String(c.title ?? c.lessonId ?? ""),
    unit: typeof c.unit === "object" ? c.unit : { n: c.unit ?? null, title: c.unitTitle ?? "" }, n: c.lesson ?? c.n ?? null,
    label: `Unit ${typeof c.unit === "object" ? c.unit?.n ?? "?" : c.unit ?? "?"}, Lesson ${c.lesson ?? c.n ?? "?"}`,
    publicUrl: /^https:\/\//.test(c.publicUrl ?? "") ? c.publicUrl : null, localUrl: c.localUrl ?? null,
  })).filter((c) => c.lessonId);
  return { spoken: short || answer.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "), detail: answer || short, citations, via: "lantern", persona: d.persona ?? null };
}
export function _reset() { missingUntil = 0; }
