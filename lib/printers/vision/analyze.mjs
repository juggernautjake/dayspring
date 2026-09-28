// What a printer's camera shows, for any brand (it only needs pictures and the printer's status):
//   bedCheck(snapshot, reference, { roi, ai }) → { clear, confidence, reason, local, ai }
//     Compared with the owner's own picture of the empty bed (per printer and plate), inside the bed area he dragged.
//     Anything that doesn't match (a part, a purge line, a scraper, a tool) means "not clear". The AI's opinion, when
//     allowed, can only make it stricter: it can say "there's something there", never overrule a difference we measured.
//   analyzeFrame({ frame, prev, reference, roi, status, history, ai }) → { score, verdict, severity, reasons, local, ai }
//     During a print: spaghetti, stringing, a part come loose, blobs, layer shifts, an empty bed while "printing", printer
//     errors. Cheap local checks every time; the AI when allowed. score 0–1; an alert at ≥ the sensitivity (0.6).
import { decode, crop, compare } from "./image.mjs";

export const WIDTH = 400;              // pictures are compared at this width
export const BED = { minObjectPx: 12 };   // the smallest group of changed pixels that means "something is there"
const prep = (buf, roi) => crop(decode(buf, { width: WIDTH }), roi);
const VERDICTS = ["ok", "spaghetti", "stringing", "detached", "blob", "layer_shift", "empty_bed", "unsure"];
export const WORDS = { spaghetti: "spaghetti (loose strands everywhere)", stringing: "stringing (thin strings between parts)", detached: "the part came loose from the bed", blob: "a blob of plastic on the nozzle or part", layer_shift: "a layer shift", empty_bed: "nothing on the bed even though it's printing", printer_error: "the printer reported an error", sudden_change: "a sudden big change on the bed", possible_stringing: "possible stringing", ok: "looks fine", unsure: "unsure" };
const SEVERITY = { stringing: "warning", possible_stringing: "warning", sudden_change: "warning" };
function json(text) { const m = /\{[\s\S]*\}/.exec(String(text ?? "")); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } }

export async function bedCheck(snapshot, reference, { roi = null, ai = null, minObjectPx = BED.minObjectPx } = {}) {
  if (!reference) return { clear: false, confidence: 0, reason: "There's no picture of the empty bed to compare with yet. Take one in Settings → Printers (with the bed cleared).", needsReference: true };
  let local;
  try { local = compare(prep(reference, roi), prep(snapshot, roi)); }
  catch (e) { return { clear: false, confidence: 0, reason: `I couldn't compare the pictures (${e.message}).` }; }
  const big = local.blobs.filter((b) => b.n >= minObjectPx);
  let clear = big.length === 0;
  let reason = clear ? "The bed matches the empty-bed picture." : describe(big, local);
  let confidence = clear ? 0.85 : Math.min(0.99, 0.6 + Math.min(0.39, big[0].n / 600));
  let aiOut = null;
  if (ai) {
    try {
      const t = await ai({ prompt: "This is a camera picture of a 3D printer's print bed. Is there ANY object on the bed: a printed part, a leftover purge line or blob of plastic, strings, a scraper, a tool, or debris? A clean, empty bed plate (its texture, logo or grid marks) is not an object. Answer only with JSON: {\"clear\": true or false, \"confidence\": 0 to 1, \"note\": \"what you see, in a few words\"}", image: snapshot });
      const j = json(t);
      if (j && typeof j.clear === "boolean") {
        aiOut = { clear: j.clear, confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0.5)), note: String(j.note ?? "").slice(0, 200) };
        if (clear && !aiOut.clear && aiOut.confidence >= 0.6) { clear = false; reason = `The AI sees something on the bed: ${aiOut.note || "an object"}.`; confidence = aiOut.confidence; }
        else if (clear && aiOut.clear) confidence = Math.max(confidence, 0.9);
      }
    } catch (e) { aiOut = { error: e.message }; }
  }
  return { clear, confidence: Math.round(confidence * 100) / 100, reason, local: { changed: local.changed, blobs: big.map((b) => ({ px: b.n, box: b.box })), threshold: local.threshold }, ai: aiOut };
}
function where(box) { const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2; return `${cy < 0.33 ? "back" : cy > 0.66 ? "front" : "middle"}${cx < 0.33 ? " left" : cx > 0.66 ? " right" : ""}`.replace(/^middle$/, "middle"); }
function describe(big, local) {
  const b = big[0], wBox = b.box[2] - b.box[0], hBox = b.box[3] - b.box[1];
  const thin = Math.min(wBox, hBox) < 0.06 && Math.max(wBox, hBox) > 0.15;
  const what = thin ? "something long and thin (a purge line or a string of plastic?)" : b.n > 800 ? "something sizeable (a printed part?)" : "something small";
  return `There's ${what} at the ${where(b.box)} of the bed${big.length > 1 ? `, and ${big.length - 1} more spot${big.length > 2 ? "s" : ""}` : ""}.`;
}

export async function analyzeFrame({ frame, prev = null, reference = null, roi = null, status = {}, history = [], ai = null, sensitivity = 0.6 } = {}) {
  const reasons = [];
  const add = (verdict, score, why) => reasons.push({ verdict, score, why });
  // the printer's own word first
  if ((status.errors ?? []).length) add("printer_error", 0.9, status.errors.map((e) => e.text).join("; "));
  if (status.state === "failed") add("printer_error", 0.95, "The printer says the print failed.");
  let vsRef = null, vsPrev = null;
  try {
    const cur = prep(frame, roi);
    if (reference) vsRef = compare(prep(reference, roi), cur);
    if (prev) vsPrev = compare(prep(prev, roi), cur);
  } catch (e) { add("unsure", 0, `couldn't compare pictures: ${e.message}`); }
  const progress = Number(status.progress ?? 0), layer = Number(status.layer ?? 0);
  const maxBefore = Math.max(0, ...history.map((h) => h.local?.occupied ?? 0));
  if (vsRef) {
    const occ = vsRef.changed;
    if ((progress >= 15 || layer >= 10) && occ < 0.002) {
      if (maxBefore >= 0.008) add("detached", 0.8, "The part that was on the bed is gone.");
      else add("empty_bed", 0.7, `It's ${Math.round(progress)}% through${layer ? ` (layer ${layer})` : ""}, but the bed still looks empty.`);
    } else if (maxBefore >= 0.02 && occ < maxBefore * 0.3) add("detached", 0.7, "Most of the part that was on the bed isn't there any more.");
    if (vsRef.blobCount >= 8 && (vsRef.outside >= 0.3 || vsRef.spread >= 8)) add("spaghetti", vsRef.blobCount >= 20 ? 0.8 : 0.7, `Many separate strands across the bed (${vsRef.blobCount}).`);
  }
  if (vsPrev) {
    if (vsPrev.changed >= 0.06 || vsPrev.blobCount >= 12) add("sudden_change", 0.55, "A big, scattered change since the last picture.");
    else if (vsPrev.blobCount >= 4 && (vsRef?.blobCount ?? 0) >= 2) add("possible_stringing", 0.35, "Small new bits between the parts.");
  }
  let aiOut = null;
  if (ai) {
    try {
      const t = await ai({ prompt: `This is a camera picture of a 3D printer in the middle of a print${progress ? ` (${Math.round(progress)}% done` : ""}${layer ? `, layer ${layer}${status.totalLayers ? ` of ${status.totalLayers}` : ""}` : ""}${progress ? ")" : ""}. Has the print failed or is it failing? Look for spaghetti (loose tangled strands), stringing (thin strings between parts), a part that came loose or moved, a blob of plastic, a layer shift, or an empty bed while printing. Answer only with JSON: {"verdict": one of ${JSON.stringify(VERDICTS)}, "confidence": 0 to 1, "note": "a few words"}`, image: frame });
      const j = json(t);
      if (j && VERDICTS.includes(j.verdict)) {
        aiOut = { verdict: j.verdict, confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0.5)), note: String(j.note ?? "").slice(0, 200) };
        if (aiOut.verdict !== "ok" && aiOut.verdict !== "unsure") add(aiOut.verdict, aiOut.confidence, `AI: ${aiOut.note || WORDS[aiOut.verdict]}`);
      }
    } catch (e) { aiOut = { error: e.message }; }
  }
  reasons.sort((a, b) => b.score - a.score);
  let top = reasons[0] ?? { verdict: "ok", score: 0, why: "" };
  let score = top.score;
  // the AI saying "fine" with confidence calms the cheap picture checks (never the printer's own errors)
  if (aiOut?.verdict === "ok" && aiOut.confidence >= 0.7 && top.verdict !== "printer_error") score = Math.round(score * 0.6 * 100) / 100;
  const alert = score >= sensitivity;
  return { score, verdict: alert ? top.verdict : "ok", topGuess: top.verdict, severity: alert ? SEVERITY[top.verdict] ?? "failure" : "none", alert, reasons,
    local: { occupied: vsRef?.changed ?? null, blobs: vsRef?.blobCount ?? null, delta: vsPrev?.changed ?? null, deltaBlobs: vsPrev?.blobCount ?? null }, ai: aiOut };
}
