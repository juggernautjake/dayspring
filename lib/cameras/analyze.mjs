// What's in a camera's picture.
//   local (always, free): motion (motion.mjs) and the shape of what moved. It says "something moved", never what.
//   AI (only when "Analyse with AI" is on for that camera, and the AI provider can see pictures): sent only on motion or
//     on the schedule (the camera's setting), at most once a minute per camera, to keep the cost down. It answers "is
//     there a person, an animal (a deer?), a vehicle, a package?" plus the camera's own question ("tell me if there's a
//     deer"), as labels with a confidence.
//   People are described in general words only ("a person in a red jacket"). Face recognition (the people the owner named
//     in Photos & people) runs only on a camera where the owner turned it on, never on a public-facing camera, and never
//     by default; the AI is always told not to identify anyone.
//   aiVerdict(jpeg, cam, { motion, history, question }) → { labels: [{ label, confidence, detail }], summary, match, answer, usedAI }
//   faceAllowed(cam) · recognise(jpeg, cam) → names (only when allowed) · normLabel(word)
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as ff from "./ffmpeg.mjs";

let deps = {
  supportsImages: async () => (await import("../llm.mjs")).supportsImages(),
  completeWithImage: async (a) => (await import("../llm.mjs")).completeWithImage(a),
  faceSettings: async () => (await import("../vision/settings.mjs")).get(),
  identify: null,        // tests: a spy; otherwise the local face engine (below)
};
export function setDeps(d) { deps = { ...deps, ...d }; }

const ANIMALS = /\b(deer|doe|buck|fawn|elk|moose|turkey|hog|boar|pig|coyote|fox|bear|raccoon|possum|opossum|skunk|rabbit|squirrel|bobcat|cat|dog|horse|cow|bird|wolf|animal)s?\b/;
const VEHICLES = /\b(car|truck|van|suv|vehicle|atv|motorcycle|tractor|bike|bicycle)s?\b/;
export function normLabel(word) {
  const w = String(word ?? "").toLowerCase().trim();
  if (/\b(person|people|man|woman|child|kid|human|someone|intruder|visitor)s?\b/.test(w)) return "person";
  if (/\b(deer|doe|buck|fawn)s?\b/.test(w)) return "deer";
  if (ANIMALS.test(w)) return "animal";
  if (VEHICLES.test(w)) return "vehicle";
  if (/\b(package|parcel|box|delivery)s?\b/.test(w)) return "package";
  return w.replace(/[^a-z ]/g, "").slice(0, 30) || "something";
}
export const isAnimal = (label) => label === "deer" || label === "animal" || ANIMALS.test(label);

// ---- face recognition: off unless the owner turned it on for THIS camera, never public-facing ----
export async function faceAllowed(cam) {
  if (!cam || cam.faces !== true || cam.publicFacing) return false;
  const s = await deps.faceSettings().catch(() => ({ faces: false }));
  return s.faces === true;
}
export async function recognise(jpeg, cam) {
  if (!(await faceAllowed(cam))) return [];
  if (deps.identify) return deps.identify(jpeg, cam);
  const f = join(tmpdir(), `ds-cam-${randomUUID()}.jpg`);
  try {
    writeFileSync(f, jpeg);
    const faces = await import("../vision/faces.mjs"), library = await import("../vision/library.mjs"), people = await import("../people/index.mjs");
    const found = await faces.find(f, { embed: true });
    const names = [];
    for (const x of found.faces ?? []) {
      if (!x.emb) continue;
      const m = await library.match(x.emb).catch(() => null);
      const pid = m?.sure ? m.personId : null;        // only a sure match is named
      const p = pid ? people.find(pid) : null;
      if (p?.name) names.push(p.name);
    }
    return [...new Set(names)];
  } catch { return []; } finally { rmSync(f, { force: true }); }
}

// ---- the AI ----
const SYSTEM = "You check pictures from a home camera (security, trail/hunting, indoor or 3D-printer camera) for the owner. " +
  "Be literal and careful: only report what is clearly visible. Never identify or guess who a real person is, even if famous; describe people only generically (clothes, what they're doing). " +
  "Answer with JSON only, no markdown.";
export function buildPrompt(cam, { motion = null, history = [], question = "", names = [] } = {}) {
  const watch = (cam.ai?.watchFor?.length ? cam.ai.watchFor : ["person", "animal", "vehicle", "package"]).join(", ");
  const lines = [
    `Camera: "${cam.name}"${cam.room ? ` (${cam.room})` : ""}, a ${cam.role ?? "general"} camera.`,
    `Look for: ${watch}. For animals, say the species if you can (deer, turkey, hog, coyote…).`,
    motion?.motion ? `Something moved in the ${motion.box ? positionWords(motion.box) : "picture"}.` : "This is a scheduled check.",
    cam.ai?.prompt ? `The owner's own request for this camera: "${cam.ai.prompt}". Set "match" true only if the picture clearly shows it.` : "",
    question ? `The owner asks now: "${question}". Put a one or two sentence answer in "answer".` : "",
    names.length ? `People the owner named, recognised on this camera (he turned that on): ${names.join(", ")}. You may use these names; don't name anyone else.` : "",
    history.length ? `Recent on this camera: ${history.slice(-3).map((h) => `${h.at?.slice(11, 16) ?? ""} ${h.summary || (h.labels ?? []).map((l) => l.label).join(", ") || "nothing"}`).join("; ")}.` : "",
    `Reply as JSON: {"labels":[{"label":"person|deer|animal|vehicle|package|<other>","confidence":0.0-1.0,"detail":"a few words"}],"summary":"one short sentence","match":true|false,"answer":""}. Empty labels if nothing of interest is there.`,
  ];
  return lines.filter(Boolean).join("\n");
}
const positionWords = (b) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return `${cy < 0.33 ? "top " : cy > 0.66 ? "bottom " : ""}${cx < 0.33 ? "left" : cx > 0.66 ? "right" : "middle"} of the picture`; };
export function parseVerdict(text) {
  const s = String(text ?? "");
  const m = /\{[\s\S]*\}/.exec(s);
  let j = null; try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
  if (!j) return { labels: [], summary: s.slice(0, 200), match: false, answer: s.slice(0, 400) };
  const labels = (Array.isArray(j.labels) ? j.labels : []).map((l) => (typeof l === "string" ? { label: l, confidence: 0.6 } : l)).filter((l) => l && l.label)
    .map((l) => ({ label: normLabel(l.label), raw: String(l.label).slice(0, 30), confidence: Math.max(0, Math.min(1, Number(l.confidence) || 0.5)), detail: String(l.detail ?? "").slice(0, 80) }));
  return { labels, summary: String(j.summary ?? "").slice(0, 240), match: j.match === true, answer: String(j.answer ?? "").slice(0, 600) };
}
const lastAI = new Map();   // camId → time of the last AI look (the cost guard)
export async function aiVerdict(jpeg, cam, { motion = null, history = [], question = "", force = false, minGapMs = 60_000 } = {}) {
  if (cam?.ai?.enabled !== true) return { labels: [], summary: "", match: false, answer: "", usedAI: false, why: "off" };
  if (!(await deps.supportsImages())) return { labels: [], summary: "", match: false, answer: "", usedAI: false, why: "no-ai" };
  if (!force && Date.now() - (lastAI.get(cam.id) ?? 0) < minGapMs) return { labels: [], summary: "", match: false, answer: "", usedAI: false, why: "cooldown" };
  lastAI.set(cam.id, Date.now());
  const names = await recognise(jpeg, cam);
  const small = jpeg.length > 700_000 ? await ff.resize(jpeg, 1280).catch(() => jpeg) : jpeg;
  const text = await deps.completeWithImage({ system: SYSTEM, prompt: buildPrompt(cam, { motion, history, question, names }), image: { data: small.toString("base64"), mediaType: "image/jpeg" }, maxTokens: 350, timeoutMs: 45_000 });
  return { ...parseVerdict(text), usedAI: true, names };
}
export const _resetCooldown = () => lastAI.clear();
