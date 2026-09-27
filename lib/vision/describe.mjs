// Describing a picture: the owner's own photos, the one on the Dayspring screen, or one from a web image search.
// It puts together what can be known on this computer (Windows' text recognition, the photo's date, camera, size and
// colours, how many faces, the owner's own words about it, and, for the owner's own photos with face recognition on,
// the names of the people they've named) and, only when "Describe images with AI" is on (the owner said yes once),
// asks the AI provider to look at the picture too, with those facts, so it says "Sam and Riley at a lake" rather
// than "two people". Without the AI, it's a plain description from the same facts.
//
// Faces are only ever named in the owner's OWN photos (a file in their photo library), and only from the people they
// named. Pictures from the web, or given as bytes, are described ("two people at a table") but never identified, and
// no face is ever looked up anywhere.
//
//   describeImage(pathOrBuffer, { detail: "brief" | "normal" | "full", ai, question })  → { text, ocr, faces, facts, colors, source, usedAI }
//   describeWebImage({ url | buffer, title })      ← for lib/imagesearch.mjs (never identifies anyone)
//   readText(pathOrBuffer) · templateDescription(info) · setOnScreen({ kind: "photo", id } | { kind: "web", url, title }) · onScreen()
import { rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as helper from "./helper.mjs";
import * as vsettings from "./settings.mjs";
import * as models from "./models.mjs";
import * as photos from "../photos.mjs";
import * as llm from "../llm.mjs";

// ---- what's on the Dayspring screen right now (the TV tells the server; imagesearch tells it about web pictures) ----
let screen = null;
export function setOnScreen(item) { screen = item ? { ...item, at: Date.now() } : null; return screen; }
export function onScreen(photoIdFromTv = null) {
  // the most recent of: the photo the TV reported, or a web picture shown after it
  if (screen?.kind === "web" && Date.now() - screen.at < 30 * 60_000) return screen;
  if (photoIdFromTv) return { kind: "photo", id: photoIdFromTv };
  if (screen?.kind === "photo" && Date.now() - screen.at < 30 * 60_000) return screen;
  return null;
}

// ---- colours by name ----
const NAMED = [["black", 0, 0, 0], ["white", 255, 255, 255], ["grey", 128, 128, 128], ["red", 200, 30, 30], ["orange", 240, 140, 30], ["yellow", 240, 220, 50], ["green", 50, 150, 60], ["teal", 30, 140, 140],
  ["blue", 40, 80, 200], ["sky blue", 130, 190, 240], ["navy", 20, 30, 90], ["purple", 120, 50, 160], ["pink", 240, 150, 190], ["brown", 120, 80, 40], ["tan", 210, 180, 140], ["dark green", 20, 70, 30]];
export function colourName(hex) {
  const n = parseInt(String(hex).slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return NAMED.reduce((best, [name, R, G, B]) => { const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; return d < best.d ? { name, d } : best; }, { name: "grey", d: Infinity }).name;
}
const listWords = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
const spokenDate = (iso) => { if (!iso) return null; const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); return isNaN(d) ? null : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); };

// ---- the description without AI: every fact that's there, in plain words ----
export function templateDescription(info) {
  const bits = [];
  const f = info.faces ?? { count: 0, names: [], unnamed: 0 };
  const cat = info.catalogue;
  if (cat?.description) bits.push(`You told me: "${cat.description.replace(/[.\s]+$/, "")}."`);
  if (f.names?.length) bits.push(`${listWords(f.names)} ${f.names.length === 1 ? "is" : "are"} in it${f.unnamed ? `, with ${f.unnamed === 1 ? "someone" : f.unnamed + " people"} I don't know yet` : ""}.`);
  else if (f.count) bits.push(`There ${f.count === 1 ? "is one face" : `are ${f.count} faces`} in it.`);
  else if (f.count === 0 && f.checked) bits.push("I don't see any faces in it.");
  const text = (info.ocr?.text ?? "").trim();
  if (text) bits.push(text.length > 280 ? `It has a lot of text. It starts: "${text.slice(0, 260).replace(/\s+/g, " ")}…"` : `The text in it says: "${text.replace(/\s+/g, " ")}".`);
  const when = spokenDate(info.facts?.taken ?? info.catalogue?.taken ?? null);
  if (when) bits.push(`It was taken on ${when}${info.facts?.camera ? ` with a ${info.facts.camera}` : ""}.`);
  else if (info.facts?.camera) bits.push(`It was taken with a ${info.facts.camera}.`);
  if (info.facts?.gps) bits.push("The photo has its location saved in it.");
  const cols = [...new Set((info.colors ?? []).filter((c) => c.share >= 0.08).map((c) => colourName(c.hex)))].slice(0, 3);
  if (cols.length) bits.push(`Mostly ${listWords(cols)}.`);
  if (info.facts?.width) bits.push(`${info.facts.width} by ${info.facts.height} pixels${info.facts.width > info.facts.height * 1.15 ? ", wide" : info.facts.height > info.facts.width * 1.15 ? ", tall" : ", square-ish"}.`);
  if (info.source === "web" && f.count) bits.push("It's a picture from the web, so I describe people but don't identify anyone.");
  return bits.join(" ") || "I couldn't make out much in that picture.";
}

// ---- the whole thing ----
async function asFile(input) {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const f = join(tmpdir(), `ds-pic-${randomUUID()}.img`);
    writeFileSync(f, Buffer.from(input));
    return { path: f, cleanup: () => rmSync(f, { force: true }), fromBytes: true };
  }
  const s = String(input ?? "");
  if (/^https?:\/\//i.test(s)) {
    // the image search's safe fetcher: public addresses only, checked once and connected to exactly (no DNS rebinding),
    // re-checked on every redirect, pictures only, size-capped
    const { fetchImage } = await import("../imagesearch.mjs");
    const { buf } = await fetchImage(s, { timeoutMs: 20_000, maxBytes: 20e6 });
    const r = await asFile(buf); return { ...r, url: s };
  }
  if (!s || !existsSync(s)) throw new Error("I can't find that picture.");
  return { path: s, cleanup: () => {}, fromBytes: false };
}

// is this file one of the owner's own photos (in their photo folders, past the privacy filter)?
function libraryPhoto(path) {
  const id = photos.idOf(path);
  const p = photos.byId(id);
  return p && p.path.toLowerCase() === String(path).toLowerCase() ? p : null;
}

let peopleMod = null;
const people = async () => (peopleMod ??= await import("../people/index.mjs"));
let libMod = null;
const lib = async () => (libMod ??= await import("./library.mjs"));

export async function describeImage(input, { detail = "normal", ai = null, question = "", source: forced = null } = {}) {
  const file = await asFile(input);
  try {
    const own = file.fromBytes ? null : libraryPhoto(file.path);
    const source = forced === "web" || file.fromBytes || file.url ? "web" : own ? "library" : "local";
    const a = await helper.analyze(file.path, ["facts", "colors", "ocr", "faces"], { max: 1280 });
    const facts = { width: a.width, height: a.height, format: a.facts?.format ?? null, taken: a.facts?.taken ?? null,
      camera: [a.facts?.make, a.facts?.model].filter(Boolean).join(" ").replace(/^(\w+) \1\b/i, "$1") || null,
      // where it was taken stays private: coordinates only (no place lookup is done), never sent to the AI or spoken
      gps: a.facts?.lat != null ? { lat: a.facts.lat, lon: a.facts.lon, private: true } : null };
    const lines = a.ocr?.lines ?? [];
    const ocr = { text: lines.map((l) => l.text).join("\n"), lines, lang: a.ocr?.lang ?? null, available: !a.ocr?.error };
    const found = (a.faces ?? []).map((f) => ({ box: [f.x, f.y, f.w, f.h] })).sort((x, y) => x.box[0] - y.box[0]);
    let faceInfo = { count: found.length, checked: Array.isArray(a.faces), names: [], unnamed: found.length, positions: found.map((f) => ({ box: f.box, name: null })) };
    // names: only the owner's own photos, only with face recognition on, only people they named
    if (source === "library" && vsettings.get().faces && models.status().installed) {
      try {
        const L = await lib(), P = await people();
        const list = (await L.indexed(own.id)) ? await L.facesIn(own.id) : await L.indexOne(own.id, { path: own.path });
        const positions = list.map((f) => ({ box: f.box, name: f.personId ? P.find(f.personId)?.name ?? null : null, faceId: f.id, cluster: f.cluster, label: f.label }));
        faceInfo = { count: list.length, checked: true, names: positions.map((x) => x.name).filter(Boolean), unnamed: positions.filter((x) => !x.name).length, positions };
      } catch (e) { faceInfo.error = e.message; }
    }
    const catalogue = own ? photos.info(own.id) : null;
    const info = { source, facts, ocr, faces: faceInfo, colors: a.colors ?? [], catalogue, photoId: own?.id ?? null };
    const useAI = ai ?? vsettings.get().aiDescribe;
    let text = null, usedAI = false, aiError = null;
    if (useAI && llm.supportsImages()) {
      try { text = await aiDescribe(file.path, info, { detail, question }); usedAI = true; }
      catch (e) { aiError = e.message; }
    }
    if (!text) text = templateDescription(info);
    return { text, usedAI, aiError, aiAvailable: llm.supportsImages(), aiConsented: vsettings.get().aiDescribe, ...info, url: file.url ?? null };
  } finally { file.cleanup(); }
}

async function aiDescribe(path, info, { detail, question }) {
  const img = await helper.jpeg(path, 1568);
  const known = [];
  if (info.faces.positions?.length && info.source === "library") {
    known.push(`People in it, left to right: ${info.faces.positions.map((p) => p.name ?? "someone not named yet").join(", ")}. Use these names; don't guess names for anyone else.`);
  }
  if (info.catalogue?.description) known.push(`The owner said about this photo: "${info.catalogue.description}"`);
  if (info.ocr.text) known.push(`Text found in it (OCR): ${info.ocr.text.slice(0, 1500)}`);
  if (info.facts.taken) known.push(`Taken: ${info.facts.taken.slice(0, 10)}.`);
  const rules = info.source === "library" ? "" : "This picture is not from the owner's own photos. Never identify or guess who any real person in it is, even a famous one; describe people only by what they're doing and how they look (clothes, setting), never by name.";
  const size = { brief: "two sentences", normal: "one short paragraph", full: "a thorough description in a few short paragraphs: the scene and setting, the people and what they're doing, objects, any text (quote it), the mood, colours and light" }[detail] ?? "one short paragraph";
  const system = "You describe pictures for someone, out loud, warmly and plainly. No markdown, no lists. " + rules;
  const prompt = `${question ? `They asked: "${question}". Answer that first.\n` : ""}Describe this picture in ${size}.\n${known.join("\n")}`;
  return llm.completeWithImage({ system, prompt, image: { data: img.data, mediaType: "image/jpeg" }, maxTokens: detail === "full" ? 900 : 450 });
}

// For lib/imagesearch.mjs: a web picture (a URL, or its bytes). Described, never identified: the source is always
// "web", so no face is matched against the owner's people. ai: false = only what this computer can tell (text in it,
// colours, how many faces), for a model that looks at the picture itself.
export function describeWebImage({ url = null, buffer = null, title = "", detail = "normal", question = "", ai = undefined } = {}) {
  return describeImage(buffer ?? url, { detail, question, source: "web", ...(ai === false ? { ai: false } : {}) }).then((r) => ({ ...r, title }));
}
// "what does this say?": the text only
export async function readText(input) {
  const file = await asFile(input);
  try { const a = await helper.analyze(file.path, ["ocr"], { max: 2600 }); return { text: (a.ocr?.lines ?? []).map((l) => l.text).join("\n"), lines: a.ocr?.lines ?? [], available: !a.ocr?.error, error: a.ocr?.error ?? null }; }
  finally { file.cleanup(); }
}
