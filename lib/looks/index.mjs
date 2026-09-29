// Look & feel: the colour theme and Dayspring's avatar (Settings → Look & feel, voice, the personality templates).
// Stored in data/looks.json; the uploaded avatar pictures in data/avatar/. Everything is optional and reversible: with
// nothing set, the screen looks exactly as it always has (the default theme, the orb).
//
//   settings() · set(patch)                       the saved choices
//   effective()                                   what's in use right now: the global choice, overridden by the current
//                                                 personality's pick, overridden by the active template's remembered look
//   themeWire(id, custom) · STYLES · STATES
//   saveImage(state, buffer) · removeImage(state) · imageFile(state)       the avatar pictures (one per state, optional)
//   rememberForTemplate(id) · forgetTemplate(id)                           a template keeps its avatar and theme
//   handle(text) → reply | null                   "switch to the pink theme", "use the blob avatar", "change your avatar"
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";
import * as features from "../features.mjs";
import { PROMPT_LINE } from "./emotion.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = () => process.env.DAYSPRING_DATA_DIR || join(DESK, "data");
const FILE = () => process.env.DAYSPRING_LOOKS_FILE || join(DATA(), "looks.json");
export const AVATAR_DIR = () => process.env.DAYSPRING_AVATAR_DIR || join(DATA(), "avatar");

await import("../../public/theme-core.js");
export const Theme = globalThis.DsThemeCore;

export const STYLES = [
  { id: "orb", name: "Dayspring orb", blurb: "The living ring and glassy orb. The default." },
  { id: "aurora", name: "Aurora flame", blurb: "A flickering flame of northern lights that leaps as it talks." },
  { id: "sunring", name: "Sun ring", blurb: "A glowing ring of sunrise rays that pulse with the voice." },
  { id: "blob", name: "Blob buddy", blurb: "A friendly blob with eyes and a mouth that moves with the words." },
  { id: "halo", name: "Waveform halo", blurb: "A halo drawn by the voice itself, rippling as it speaks." },
  { id: "pixel", name: "Pixel pal", blurb: "A little 8-bit sprite that chatters, blinks and waves." },
  { id: "image", name: "Your picture", blurb: "Any JPEG, PNG, WebP or GIF: it breathes as it talks and leans in to listen." },
];
export const STATES = [
  { id: "idle", name: "Idle" }, { id: "listen", name: "Listening" }, { id: "think", name: "Thinking" }, { id: "speak", name: "Talking" },
  { id: "muted", name: "Muted / deafened (Off)" }, { id: "stopped", name: "Stopped listening" }, { id: "error", name: "Error / reconnecting" }, { id: "sleep", name: "Sleeping / quiet" },
];
const STYLE_IDS = STYLES.map((s) => s.id), STATE_IDS = STATES.map((s) => s.id);
export const RATINGS = ["g", "pg", "pg-13"];
export const OFTEN = ["always", "sometimes", "rarely", "events"];

const DEFAULTS = () => ({
  theme: "default", custom: null,
  avatar: { style: "orb", images: {}, fit: "cover", round: true },
  expression: { on: false, rating: "pg", often: "sometimes", vision: true, maxMB: 300, perCombo: 30, noRepeat: 12, own: true, web: true, events: true, aiHint: true },
  perPersona: {}, templates: {},
});
let deps = { persona: null, broadcast: null, now: () => Date.now() };
export function setDeps(d) { deps = { ...deps, ...d }; }
const personaMod = async () => deps.persona ?? (deps.persona = await import("../persona/index.mjs"));
const say = (type, data) => { try { (deps.broadcast ?? (() => {}))(type, data); } catch { /* no screens */ } };

// ---- the saved choices ----
let store = null;
function clean(raw = {}) {
  const d = DEFAULTS(), o = structuredClone(d);
  if (typeof raw.theme === "string" && (Theme.byId(raw.theme) || raw.theme === "custom")) o.theme = raw.theme;
  if (raw.custom && typeof raw.custom === "object" && raw.custom.params) o.custom = cleanCustom(raw.custom);
  if (o.theme === "custom" && !o.custom) o.theme = "default";
  const a = raw.avatar ?? {};
  if (STYLE_IDS.includes(a.style)) o.avatar.style = a.style;
  if (a.images && typeof a.images === "object") for (const s of STATE_IDS) if (a.images[s]?.file && /^[\w.-]+$/.test(a.images[s].file)) o.avatar.images[s] = { file: a.images[s].file, type: String(a.images[s].type ?? ""), at: a.images[s].at ?? null };
  if (["cover", "contain"].includes(a.fit)) o.avatar.fit = a.fit;
  if (typeof a.round === "boolean") o.avatar.round = a.round;
  const e = raw.expression ?? {};
  for (const k of ["on", "vision", "own", "web", "events", "aiHint"]) if (typeof e[k] === "boolean") o.expression[k] = e[k];
  if (RATINGS.includes(e.rating)) o.expression.rating = e.rating;
  if (OFTEN.includes(e.often)) o.expression.often = e.often;
  const num = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : def);
  o.expression.maxMB = num(e.maxMB, 20, 5000, d.expression.maxMB);
  o.expression.perCombo = num(e.perCombo, 3, 100, d.expression.perCombo);
  o.expression.noRepeat = num(e.noRepeat, 1, 60, d.expression.noRepeat);
  for (const [k, v] of Object.entries(raw.perPersona ?? {})) if (/^[\w-]{1,40}$/.test(k) && v && typeof v === "object") {
    const x = {};
    if (STYLE_IDS.includes(v.avatar)) x.avatar = v.avatar;
    if (typeof v.theme === "string" && (Theme.byId(v.theme) || (v.theme === "custom" && v.custom))) { x.theme = v.theme; if (v.theme === "custom") x.custom = cleanCustom(v.custom); }
    if (Object.keys(x).length) o.perPersona[k] = x;
  }
  for (const [k, v] of Object.entries(raw.templates ?? {})) if (/^[\w-]{1,40}$/.test(k) && v && typeof v === "object") {
    const x = { name: String(v.name ?? "").slice(0, 40) };
    if (STYLE_IDS.includes(v.avatar)) x.avatar = v.avatar;
    if (typeof v.theme === "string" && (Theme.byId(v.theme) || (v.theme === "custom" && v.custom))) { x.theme = v.theme; if (v.theme === "custom") x.custom = cleanCustom(v.custom); }
    o.templates[k] = x;
  }
  return o;
}
function cleanCustom(c) {
  if (!c || typeof c !== "object" || !c.params) return null;
  const p = c.params, n = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : def);
  return { id: "custom", name: String(c.name ?? "My theme").slice(0, 40), colors: Array.isArray(c.colors) ? c.colors.filter((x) => Theme.parse(x)).slice(0, 3) : [],
    params: { aH: n(p.aH, 0, 360, 232), aS: n(p.aS, 0, 1.2, 1), bH: n(p.bH, 0, 360, 262), bS: n(p.bS, 0, 1.2, 1), sH: n(p.sH, 0, 360, 230), sS: n(p.sS, 0, 1.2, 0.5), inkS: n(p.inkS, 0, 1, 0.45), lift: n(p.lift, 0.7, 1.4, 1),
      mode: ["dark", "light", "contrast"].includes(p.mode) ? p.mode : "dark", sky: Theme.parse(p.sky) ? p.sky : "#0b1026", skyMix: n(p.skyMix, 0, 1, 0.28) } };
}
function load() {
  if (store) return store;
  let raw = {};
  try { if (existsSync(FILE())) raw = JSON.parse(readFileSync(FILE(), "utf8")); } catch { raw = {}; }
  store = clean(raw);
  return store;
}
function persist() { try { mkdirSync(dirname(FILE()), { recursive: true }); writeJSONAtomic(FILE(), store, 2); } catch (e) { console.log(`looks: couldn't save (${e.message})`); } }
export const settings = () => structuredClone(load());
export function _reload() { store = null; }
export function set(patch = {}, why = "settings") {
  const cur = load();
  const merged = { ...cur, ...patch,
    avatar: { ...cur.avatar, ...(patch.avatar ?? {}), images: { ...cur.avatar.images, ...(patch.avatar?.images ?? {}) } },
    expression: { ...cur.expression, ...(patch.expression ?? {}) },
    perPersona: patch.perPersona ? patch.perPersona : cur.perPersona,
    templates: patch.templates ? patch.templates : cur.templates };
  if (patch.theme !== undefined && patch.theme !== "custom" && !Theme.byId(patch.theme)) throw new Error("There's no theme by that name.");
  if (patch.avatar?.style !== undefined && !STYLE_IDS.includes(patch.avatar.style)) throw new Error("There's no avatar by that name.");
  if (patch.expression?.rating !== undefined && !RATINGS.includes(patch.expression.rating)) throw new Error("The rating for expressions must be G, PG or PG-13.");
  store = clean(merged);
  persist();
  say("looks", { why });
  return settings();
}

// ---- what's in use right now ----
export function themeWire(id, custom = null) {
  if (id === "custom" && custom?.params) return { id: "custom", name: custom.name ?? "My theme", params: custom.params, colors: custom.colors ?? [] };
  const t = Theme.byId(id) ?? Theme.byId("default");
  return t.params ? { id: t.id, name: t.name, params: t.params } : { id: "default", name: t.name };
}
export async function personaNow() {
  try { const P = await personaMod(); const s = P.get(); const tpl = s.activeTemplate ? (s.templates ?? []).find((t) => t.id === s.activeTemplate) : null; return { preset: s.preset, template: s.activeTemplate ?? null, templateName: tpl?.name ?? null }; }
  catch { return { preset: "default", template: null, templateName: null }; }
}
export async function effective() {
  const s = load(), who = await personaNow();
  let theme = s.theme, custom = s.custom, style = s.avatar.style, themeFrom = "you", avatarFrom = "you";
  const pp = s.perPersona[who.preset];
  if (pp?.theme) { theme = pp.theme; custom = pp.custom ?? custom; themeFrom = "personality"; }
  if (pp?.avatar) { style = pp.avatar; avatarFrom = "personality"; }
  const tp = who.template ? s.templates[who.template] : null;
  if (tp?.theme) { theme = tp.theme; custom = tp.custom ?? custom; themeFrom = "template"; }
  if (tp?.avatar) { style = tp.avatar; avatarFrom = "template"; }
  if (!features.on("themes")) { theme = "default"; themeFrom = "off"; }
  const avatarOn = features.on("avatar");
  if (!avatarOn) { style = "orb"; avatarFrom = "off"; }
  return {
    theme: themeWire(theme, custom), themeFrom, persona: who,
    avatar: { style, from: avatarFrom, fit: s.avatar.fit, round: s.avatar.round, images: imageUrls() },
    expression: { on: avatarOn && s.expression.on, often: s.expression.often, events: s.expression.events },
  };
}

// ---- the avatar pictures ----
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
export function sniffImage(buf) {
  const b = buf.subarray(0, 16), s = (i, str) => b.toString("latin1", i, i + str.length) === str;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (s(0, "\x89PNG")) return "image/png";
  if (s(0, "GIF8")) return "image/gif";
  if (s(0, "RIFF") && s(8, "WEBP")) return "image/webp";
  return null;
}
export const MAX_IMAGE = 12 * 1024 * 1024;
export function saveImage(state, buf) {
  if (!STATE_IDS.includes(state)) throw Object.assign(new Error("Which state is this picture for?"), { status: 400 });
  if (!buf?.length) throw Object.assign(new Error("That file is empty."), { status: 400 });
  if (buf.length > MAX_IMAGE) throw Object.assign(new Error("That picture is too big (12 MB at most)."), { status: 413 });
  const type = sniffImage(buf);
  if (!type) throw Object.assign(new Error("That isn't a JPEG, PNG, WebP or GIF picture."), { status: 415 });
  mkdirSync(AVATAR_DIR(), { recursive: true });
  const file = `${state}-${createHash("sha1").update(buf).digest("hex").slice(0, 10)}.${EXT[type]}`;
  writeFileSync(join(AVATAR_DIR(), file), buf);
  const old = load().avatar.images[state]?.file;
  const next = set({ avatar: { images: { [state]: { file, type, at: new Date(deps.now()).toISOString() } } } }, "avatar-image");
  if (old && old !== file && !Object.values(next.avatar.images).some((x) => x.file === old)) rmSync(join(AVATAR_DIR(), old), { force: true });
  return { state, file, type, url: imageUrls()[state] };
}
export function removeImage(state) {
  const s = load(), old = s.avatar.images[state]?.file;
  if (!old) return { removed: false };
  const images = { ...s.avatar.images }; delete images[state];
  store = clean({ ...s, avatar: { ...s.avatar, images } }); persist(); say("looks", { why: "avatar-image" });
  if (!Object.values(images).some((x) => x.file === old)) rmSync(join(AVATAR_DIR(), old), { force: true });
  return { removed: true };
}
export function imageFile(state) {
  const f = load().avatar.images[state]?.file;
  if (!f) return null;
  const p = resolve(AVATAR_DIR(), f);
  if (!p.startsWith(resolve(AVATAR_DIR())) || !existsSync(p)) return null;
  return { path: p, type: load().avatar.images[state].type || "image/png" };
}
export function imageUrls() {
  const out = {};
  for (const [st, x] of Object.entries(load().avatar.images)) out[st] = `/api/looks/avatar/img/${st}?v=${encodeURIComponent(x.file.split("-").pop().split(".")[0])}`;
  return out;
}
// pictures in data/avatar that no setting points at any more (a crash between saving and cleaning up)
export function tidyImages() {
  try { const keep = new Set(Object.values(load().avatar.images).map((x) => x.file)); for (const f of readdirSync(AVATAR_DIR())) if (!keep.has(f)) rmSync(join(AVATAR_DIR(), f), { force: true }); } catch { /* no folder yet */ }
}

// ---- personalities and templates ----
export function setForPersona(presetId, { avatar, theme, custom } = {}) {
  const s = load(), pp = { ...s.perPersona }, x = { ...(pp[presetId] ?? {}) };
  if (avatar !== undefined) { if (avatar) x.avatar = avatar; else delete x.avatar; }
  if (theme !== undefined) { if (theme) { x.theme = theme; if (theme === "custom") x.custom = custom ?? s.custom; else delete x.custom; } else { delete x.theme; delete x.custom; } }
  if (Object.keys(x).length) pp[presetId] = x; else delete pp[presetId];
  return set({ perPersona: pp }, "persona-look");
}
export async function rememberForTemplate(id, { name = "" } = {}) {
  const s = load(), eff = await effective();
  const t = { name: String(name).slice(0, 40), avatar: eff.avatar.style, theme: eff.theme.id, ...(eff.theme.id === "custom" ? { custom: { name: eff.theme.name, params: eff.theme.params, colors: eff.theme.colors ?? [] } } : {}) };
  return set({ templates: { ...s.templates, [id]: t } }, "template-look");
}
export function forgetTemplate(id) { const s = load(); const t = { ...s.templates }; delete t[id]; return set({ templates: t }, "template-look"); }
// a template saved while a look is in use remembers it; switching personality or template refreshes every screen
let lastPersonaKey = null, known = null;
export async function wirePersona() {
  const P = await personaMod();
  known = new Set((P.get().templates ?? []).map((t) => t.id));
  P.onChange((st, why) => {
    const ids = (st.templates ?? []).map((t) => t.id);
    for (const id of ids) if (!known.has(id) && !load().templates[id]) rememberForTemplate(id, { name: st.templates.find((t) => t.id === id)?.name ?? "" }).catch(() => {});
    for (const id of Object.keys(load().templates)) if (!ids.includes(id)) forgetTemplate(id);
    known = new Set(ids);
    const key = `${st.preset}|${st.activeTemplate ?? ""}`;
    if (key !== lastPersonaKey) { lastPersonaKey = key; say("looks", { why: "persona", preset: st.preset }); }
    void why;
  });
}

// the line the AI gets while expression mode is on (the screen's replies only): a hidden mood tag, removed before anyone sees it
export function promptLine(surface = "tv") {
  const e = load().expression;
  if (surface !== "tv" || !e.on || !e.aiHint || !features.on("avatar")) return "";
  return PROMPT_LINE;
}

// ---- by voice ----
const THEME_WORD = /\b(theme|themes|colou?r scheme|colou?r theme|colou?rs|skin|dark mode|light mode|night mode)\b/;
const AVATAR_WORD = /\b(avatar|avatars|face|sprite|character look|your look|orb|blob|pixel|aurora|flame|sun ?ring|halo|waveform)\b/;
const STYLE_WORDS = { orb: /\b(orb|ring|default|normal|original|usual|regular)\b/, aurora: /\b(aurora|flame|fire|northern lights)\b/, sunring: /\b(sun ?ring|sun|sunrise ring|rays)\b/, blob: /\b(blob|face|buddy|blobby)\b/, halo: /\b(halo|wave ?form|waves?)\b/, pixel: /\b(pixel|8 ?bit|eight bit|retro|sprite)\b/, image: /\b(my (picture|photo|image|pic)|the picture|uploaded|custom (picture|image))\b/ };
export async function handle(text) {
  const q = String(text ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return null;
  // ---- expression mode ----
  if (/\b(express(ion)? (mode|yourself)|reaction gifs?|memes?|(using|use) (gifs|memes)|gifs? (to|for) (show|express)|express yourself)\b/.test(q) && features.on("avatar")) {
    const off = /\b(stop|turn off|disable|no more|don't|do not|quit|off)\b/.test(q);
    const on = !off && /\b(turn on|start|enable|use|express yourself|can you|go ahead|with|on)\b/.test(q);
    if (off) { set({ expression: { on: false } }, "voice"); return "Okay. No more GIFs and memes: just my usual face."; }
    if (on) { set({ expression: { on: true } }, "voice"); return "Expression mode is on. Now and then I'll show a GIF or a meme that fits how I feel, picked for my personality, then go back to my usual face. Say \"stop using GIFs\" to turn it off."; }
  }
  // ---- themes ----
  if ((THEME_WORD.test(q) || /\b(make|turn|switch|change) (it|everything|the (screen|colou?rs))( to)? [a-z ]+\b(colou?r|colou?rs)\b/.test(q)) && !/\b(sky|background|scenery|scene|weather|calendar|category|event|block)\b/.test(q)) {
    if (!features.on("themes")) return null;
    if (/\b(what|which) (theme|colou?rs?)\b.*\b(is this|am i|are you|using|on)\b|^what theme\b/.test(q)) { const e = await effective(); return `This is the ${e.theme.name} theme${e.themeFrom === "personality" ? ", picked for this personality" : e.themeFrom === "template" ? ", from this template" : ""}.`; }
    if (/\b(list|what|which) (themes|colou?r (themes|schemes))\b|\bwhat themes\b|\bthemes (do you|are there)\b/.test(q)) return `The themes are ${Theme.THEMES.map((t) => t.name).join(", ")}, and you can make your own in Settings, Look & feel.`;
    if (/\b(surprise me|random|any|mix it up|shuffle)\b/.test(q)) {
      const t = Theme.surprise(load().theme);
      if (t.custom) set({ theme: "custom", custom: t }, "voice"); else set({ theme: t.id }, "voice");
      return t.custom ? "Here's a brand-new mix of colours, just for you. Say \"keep it\" or \"default theme\" to go back." : `How about ${t.name}? ${t.blurb}`;
    }
    if (/\bdark mode\b/.test(q) && !/\b(off|light)\b/.test(q)) { set({ theme: "default" }, "voice"); return "Back to the dark default theme."; }
    if (/\blight mode\b|\bdark mode off\b/.test(q)) { set({ theme: "day" }, "voice"); return "Here's the light, daytime theme."; }
    const t = Theme.findByWords(q.replace(THEME_WORD, " "));
    if (t) {
      set({ theme: t.id }, "voice");
      return t.id === "default" ? "Okay, back to the default theme: dawn indigo and violet." : pick([`Done. The ${t.name} theme it is.`, `Here's ${t.name}. ${t.blurb}`, `Switched to ${t.name}.`]);
    }
    if (/\b(change|switch|new|different|another|next)\b/.test(q)) {
      const i = Theme.THEMES.findIndex((x) => x.id === load().theme), t2 = Theme.THEMES[(i + 1) % Theme.THEMES.length];
      set({ theme: t2.id }, "voice");
      return `How's ${t2.name}? Say a colour, like "the pink theme" or "green theme", or "default theme" to go back.`;
    }
    return null;
  }
  // ---- avatars ----
  if (AVATAR_WORD.test(q) && /\b(avatar|use|switch|change|be|show|go back|default|try|turn into|swap|put on|look like)\b/.test(q) && (/\bavatar/.test(q) || /\b(use|be|switch to|turn into|go back to) (the |a |your |my )?(orb|blob|pixel|aurora|flame|sun ?ring|halo|waveform)\b/.test(q))) {
    if (!features.on("avatar")) return null;
    if (/\b(what|which|list) (avatars|faces)\b|\bwhat avatars\b/.test(q)) return `I can be ${STYLES.map((s) => s.name).join(", ")}. Say "use the blob avatar", for example.`;
    const want = Object.keys(STYLE_WORDS).find((k) => k !== "orb" && STYLE_WORDS[k].test(q)) ?? (STYLE_WORDS.orb.test(q) ? "orb" : null);
    if (want === "image" && !load().avatar.images.idle && !Object.keys(load().avatar.images).length) return "Upload a picture first, in Settings, Look & feel, Avatar. Then say \"use my picture\".";
    if (want) { set({ avatar: { style: want } }, "voice"); const st = STYLES.find((s) => s.id === want); return want === "orb" ? "Okay, back to my usual orb." : pick([`Done. I'm the ${st.name} now.`, `How do I look? ${st.name}.`, `${st.name}, on.`]); }
    if (/\b(change|switch|new|different|another|next)\b/.test(q)) {
      const order = STYLE_IDS.filter((x) => x !== "image" || Object.keys(load().avatar.images).length);
      const t2 = order[(order.indexOf(load().avatar.style) + 1) % order.length];
      set({ avatar: { style: t2 } }, "voice");
      return `How about this? ${STYLES.find((s) => s.id === t2).name}. Say "change your avatar" again for the next one, or pick one in Settings, Look & feel.`;
    }
  }
  return null;
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
