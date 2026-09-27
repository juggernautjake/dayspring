// Dayspring's personality: the current character and sliders, saved templates, and the voice commands for them.
// Stored in data/owner.json → persona (owner.mjs writes it atomically). The default is Normal: Default, all neutral.
import * as owner from "../owner.mjs";
import { TRAIT_IDS, neutral, clamp, applyCoupling } from "./traits.mjs";
import { PRESETS, byId, summary as presetSummary } from "./presets.mjs";
import * as compile from "./compile.mjs";
import * as custom from "./custom.mjs";
import { check as eggCheck, sageActive } from "./easter.mjs";
import { SECRETS, secretById, isSecret, phraseUnlock, comboUnlock, eventUnlock } from "./secrets.mjs";

export const MAX_TEMPLATES = 50;
const EMPTY = () => ({ preset: "default", base: neutral(), role: {}, pins: [], custom: null, easterEggs: [], templates: [], defaultTemplate: null, activeTemplate: null, discovered: {}, unlocked: {}, nights: [], revealHints: false });

let deps = { save: (p) => owner.set({ persona: p }), load: () => owner.get().persona, now: () => Date.now(), setVoice: null, voiceName: null, name: () => owner.nick?.() ?? "" };
export function setDeps(d) { deps = { ...deps, ...d }; }
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const recent = {};            // slider id → when the person last set it by hand (so couplings never fight a drag)
let pending = null;           // a yes/no question from a voice command: { kind, data, at }
// true while one of our yes/no questions (unlock, delete, voice…) is waiting: callers route a bare yes/no to handle() first
export const hasPending = () => Boolean(pending && deps.now() - pending.at < 60_000);

function norm(p) {
  const e = EMPTY();
  if (!p || typeof p !== "object") return e;
  const out = { ...e, ...p };
  out.base = { ...neutral(), ...(p.base ?? {}) };
  for (const k of TRAIT_IDS) out.base[k] = clamp(out.base[k]);
  out.role = { ...(p.role ?? {}) };
  out.pins = Array.isArray(p.pins) ? p.pins.filter((x) => TRAIT_IDS.includes(x)) : [];
  out.templates = Array.isArray(p.templates) ? p.templates.slice(0, MAX_TEMPLATES) : [];
  out.easterEggs = Array.isArray(p.easterEggs) ? p.easterEggs : [];
  out.discovered = p.discovered && typeof p.discovered === "object" ? p.discovered : {};
  out.nights = Array.isArray(p.nights) ? p.nights.slice(-10) : [];
  out.unlocked = p.unlocked && typeof p.unlocked === "object" ? p.unlocked : {};
  const known = PRESETS.some((x) => x.id === out.preset) || out.preset === "custom" || (isSecret(out.preset) && out.unlocked[out.preset]);
  if (!known) out.preset = "default";
  return out;
}
export function get() { try { return norm(deps.load()); } catch { return EMPTY(); } }
function save(next, why = "change") { const s = norm(next); deps.save(s); for (const fn of listeners) { try { fn(s, why); } catch { /* a listener's problem */ } } return s; }
const cur = () => get();
// the active character, without the template library (what compile needs)
const active = (s = cur()) => ({ preset: s.preset, base: s.base, role: s.role, custom: s.custom, easterEggs: s.easterEggs });

// ---- reading ----------------------------------------------------------------------------------------------------------
export const promptBlock = () => compile.promptBlock(active());
export const style = (text, opts = {}) => compile.style(active(), text, { name: deps.name(), ...opts });
export const phrase = (kind, opts = {}) => compile.phrase(active(), kind, { name: deps.name(), ...opts });
export const describe = () => compile.describe(active());
export const humour = () => cur().base.humour;
export const jokeOffersAllowed = () => { const b = cur().base; return b.humour >= 60; };
export function view() {
  const s = cur();
  return { ...s, sage: sageActive(active(s)), plain: compile.isPlain(active(s)), describe: compile.describe(active(s)), promptLength: compile.promptBlock(active(s)).length, presets: presetSummary(), secrets: secretsView(s) };
}

// ---- changing ---------------------------------------------------------------------------------------------------------
function withRoleDefaults(preset) { return Object.fromEntries((preset.roles ?? []).map((r) => [r.id, r.def ?? 0])); }
function voiceOffer(v, always = false) {
  if (!v) return null;
  const name = typeof v === "string" ? v : deps.pickVoice ? deps.pickVoice(v) : v.eleven ?? v.openai ?? v.edge;
  if (!name) return null;
  const current = deps.voiceName?.();
  if (current && current.toLowerCase() === String(name).toLowerCase()) return null;
  return { voice: name, always, ask: `Want the voice that goes with it (${name})?` };
}
export function selectPreset(id) {
  const p = byId(id);
  const prev = cur();
  if (isSecret(p.id) && !prev.discovered[p.id]) throw new Error("That character is still a secret. Find it first!");
  if (isSecret(p.id) && !prev.unlocked[p.id]) throw new Error(`Unlock ${p.name} with XP first (${costOf(p.id)} XP).`);
  const next = { ...prev, preset: p.id, base: { ...neutral(), ...p.base }, role: withRoleDefaults(p), custom: null, activeTemplate: null };
  const egg = eggCheck(active(prev), active(next));
  if (egg.firstTime) next.easterEggs = [...new Set([...(prev.easterEggs ?? []), "sage"])];
  const s = save(next, "preset");
  return { state: s, voiceOffer: voiceOffer(p.voice), easter: egg, discovered: checkCombo(s) };
}
export function normal() { const s = save({ ...cur(), preset: "default", base: neutral(), role: {}, custom: null, activeTemplate: null }, "normal"); return { state: s }; }

// kind: "base" | "role". A base slider nudges its linked sliders one hop (pins and recent drags are respected).
export function setSlider(kind, id, value) {
  const prev = cur();
  const now = deps.now();
  let next, moved;
  if (kind === "role") {
    next = { ...prev, role: { ...prev.role, [id]: clamp(value) } };
    moved = { [id]: clamp(value) };
  } else {
    if (!TRAIT_IDS.includes(id)) throw new Error(`Unknown slider "${id}".`);
    const r = applyCoupling(prev.base, id, value, { pins: prev.pins, recent, now });
    next = { ...prev, base: r.values };
    moved = r.moved;
  }
  recent[id] = now;
  const egg = eggCheck(active(prev), active(next));
  if (egg.firstTime) next.easterEggs = [...new Set([...(prev.easterEggs ?? []), "sage"])];
  const s = save(next, "slider");
  return { state: s, moved, easter: egg, discovered: checkCombo(s) };
}
export function setPins(pins) { return { state: save({ ...cur(), pins: [...new Set(pins ?? [])] }, "pins") }; }
export function togglePin(id) { const s = cur(); const pins = new Set(s.pins); pins.has(id) ? pins.delete(id) : pins.add(id); return setPins([...pins]); }

// ---- custom persona ---------------------------------------------------------------------------------------------------
export async function buildCustom(text, { llm } = {}) { return custom.build(text, { llm }); }
export function saveCustom({ text, card }) {
  const c = custom.validateCard(card);
  const role = Object.fromEntries(c.roles.map((r) => [r.id, r.value]));
  const s = save({ ...cur(), preset: "custom", base: c.base, role, custom: { text: custom.limitWords(text).text, card: c }, activeTemplate: null }, "custom");
  return { state: s };
}

// ---- secret characters ------------------------------------------------------------------------------------------------
const discoverListeners = new Set();
export const onDiscover = (fn) => { discoverListeners.add(fn); return () => discoverListeners.delete(fn); };
const CLUES = {
  caveman: "Ask it to talk like someone from the Stone Age, or push Maturity, Formality and Length all the way left on the Default character.",
  haiku: "Ask for answers as a short Japanese poem, or give the Bard the shortest possible Length.",
  narrator: "Ask it to narrate your day like a wildlife film.",
  sportscaster: "Ask for the play-by-play, or laugh at ten jokes in one sitting.",
  gangster: "Say \"hey, wise guy\", or make the Noir Detective as hard-boiled and narrating as possible.",
  alien: "Ask to be taken to someone's leader.",
  soap: "Tell it to be dramatic.",
  cat: "Say a small, catlike sound.",
  dog: "Ask who's a good boy.",
  gps: "Ask where you're going.",
  radio: "Use Dayspring after midnight on three different nights.",
  viking: "Raise a toast to the hammer, or make the Knight maximally boastful and rough.",
  madsci: "Shout that it's alive, or run seven timers at once.",
  sloth: "Ask it to talk like the slowest animal, or make Groovy as mellow as it can possibly be.",
  limerick: "Ask for answers in limericks, or make the Bard fully rhyming and fully comic.",
};
function secretsView(s = cur()) {
  const found = Object.keys(s.discovered ?? {}).filter(isSecret);
  return {
    total: SECRETS.length, found: found.length, unlockedCount: Object.keys(s.unlocked ?? {}).filter(isSecret).length, revealHints: Boolean(s.revealHints), xp: xpInfo(),
    list: SECRETS.map((x) => (s.discovered?.[x.id]
      ? { id: x.id, locked: false, discovered: true, unlocked: Boolean(s.unlocked?.[x.id]), cost: s.unlocked?.[x.id] ? 0 : costOf(x.id, s), name: x.name, icon: x.icon, blurb: x.blurb, reveal: x.reveal, roles: x.roles, voice: x.voice, at: s.discovered[x.id].at }
      : { id: x.id, locked: true, discovered: false, unlocked: false, cost: costOf(x.id, s), hint: x.hint, clue: s.revealHints ? CLUES[x.id] : null })),
  };
}
// ---- XP: secret characters are found for free, then unlocked with XP (lib/xp, when it's there) ------------------------
// The XP module is optional: tests inject one with setDeps({ xp }); in the app it's loaded when it exists. Without it,
// a found secret is unlocked for free (and the UI says XP isn't set up yet).
export const DEFAULT_COST = 700;          // about a week of real effort, if the XP module doesn't price it
// Only an explicit setDeps({ xp: false }) means "no XP" (a found secret is then free). While the XP module is still
// loading (a moment after startup) nothing is unlocked for free: unlocking waits for it, or says to try again.
let xpLoaded = null;
const xpReady = import("../xp/index.mjs").then((m) => { xpLoaded = m; return m; }).catch(() => null);
const xpMod = () => (deps.xp === false ? null : deps.xp ?? xpLoaded ?? undefined);   // null = no XP · undefined = still loading
const XP_STARTING = "XP is still starting, try again in a moment.";
function xpInfo() {
  const m = xpMod();
  if (m === undefined) return { available: true, balance: null, starting: true };
  if (!m) return { available: false, balance: null };
  try { const b = m.balance?.(); return { available: true, balance: typeof b === "number" ? b : (b?.balance ?? null) }; } catch { return { available: true, balance: null }; }
}
function costOf(id, s = cur()) {
  const m = xpMod();
  if (m === null) return 0;
  if (!m) return DEFAULT_COST;
  const nth = Object.keys(s.unlocked ?? {}).filter(isSecret).length + 1;
  try { const p = m.priceFor?.("character", id, { nth }); const n = typeof p === "number" ? p : p?.cost; return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_COST; } catch { return DEFAULT_COST; }
}
const unlockListeners = new Set();
export const onUnlock = (fn) => { unlockListeners.add(fn); return () => unlockListeners.delete(fn); };
function recordUnlock(id, cost) {
  const s = cur(); const sec = secretById(id);
  save({ ...s, unlocked: { ...s.unlocked, [id]: { at: new Date(deps.now()).toISOString(), cost } } }, "unlocked");
  const info = { id, name: sec.name, icon: sec.icon, cost, text: `🔓 Unlocked: ${sec.name}! ${sec.reveal}`, line: compile.phrase({ preset: id, base: { ...neutral(), ...sec.base }, role: {} }, "greeting", { name: deps.name(), seed: "unlock" + id }) };
  for (const fn of unlockListeners) { try { fn(info); } catch { /* a listener's problem */ } }
  return { ok: true, ...info, balance: xpInfo().balance };
}
// Spend XP to unlock a found secret. Returns { ok, … } (or a Promise of it, if the XP module's spend is async).
export function unlockSecret(id) {
  const sec = secretById(id); if (!sec) return { ok: false, message: "There's no secret character by that name." };
  const s = cur();
  if (!s.discovered?.[id]) return { ok: false, message: "Find that character first." };
  if (s.unlocked?.[id]) return { ok: true, already: true, id, name: sec.name };
  const m = xpMod();
  if (m === null) return recordUnlock(id, 0);
  if (m === undefined) {             // still loading: wait for it (briefly), never unlock for free
    const wait = new Promise((r) => { const t = setTimeout(() => r(null), 3000); t.unref?.(); });
    return Promise.race([xpReady, wait]).then(() => (xpMod() ? unlockSecret(id) : { ok: false, starting: true, message: XP_STARTING }));
  }
  const cost = costOf(id, s);
  const finish = (r) => (r?.ok ? recordUnlock(id, cost) : { ok: false, short: r?.short ?? null, message: `${sec.name} costs ${cost} XP${r?.short != null ? `; you need ${r.short} more` : ""}. Earn XP by checking off real tasks.` });
  const r = m.spend(cost, { reason: `Unlock the secret character ${sec.name}`, ref: `character:${id}` });
  return r && typeof r.then === "function" ? r.then(finish) : finish(r);
}
export const secrets = {
  list: () => secretsView().list.map((x) => ({ id: x.id, discovered: x.discovered, unlocked: x.unlocked, cost: x.cost })),
  unlock: (id) => unlockSecret(id),
  view: () => secretsView(),
};

// Mark a secret found (first time only). Returns the discovery, or null when it was already known.
export function discover(id, how = "phrase") {
  const sec = secretById(id); if (!sec) return null;
  const s = cur();
  if (s.discovered?.[id]) return null;
  const at = new Date(deps.now()).toISOString();
  // no XP module yet: finding a secret also unlocks it (nothing to spend)
  const unlocked = xpMod() !== null ? s.unlocked : { ...s.unlocked, [id]: { at, cost: 0, free: true } };
  const next = save({ ...s, discovered: { ...s.discovered, [id]: { at, how } }, unlocked }, "discovered");
  const greet = compile.phrase({ preset: id, base: { ...neutral(), ...sec.base }, role: Object.fromEntries(sec.roles.map((r) => [r.id, r.def ?? 0])) }, "greeting", { name: deps.name(), seed: "found" + id });
  const info = { id, name: sec.name, icon: sec.icon, reveal: sec.reveal, line: greet, how, found: Object.keys(next.discovered).filter(isSecret).length, total: SECRETS.length,
    text: `✨ Secret character discovered: ${sec.name} ${sec.icon} — ${sec.reveal}` };
  for (const fn of discoverListeners) { try { fn(info); } catch { /* a listener's problem */ } }
  return info;
}
function checkCombo(s) { const id = comboUnlock(active(s)); return id ? discover(id, "sliders") : null; }
// Things people do. joke: one was told · timers: {active} after one starts · use: any request (late-night use is counted)
const jokeTimes = [];
export function event(name, data = {}) {
  const now = deps.now();
  const counts = {};
  if (name === "joke") { jokeTimes.push(now); while (jokeTimes.length && now - jokeTimes[0] > 6 * 3600_000) jokeTimes.shift(); counts.joke = jokeTimes.length; }
  if (name === "timers") counts.timers = Number(data.active ?? 0);
  if (name === "use") {
    const h = new Date(now).getHours();
    if (h >= 0 && h < 4) {
      const d = new Date(now); const night = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const s = cur();
      if (!s.nights.includes(night)) save({ ...s, nights: [...s.nights, night] }, "nights");
      counts.night = cur().nights.length;
    }
  }
  const id = eventUnlock(counts);
  return id ? discover(id, name) : null;
}
export function setRevealHints(on) { return { state: save({ ...cur(), revealHints: Boolean(on) }, "hints") }; }
export function resetDiscoveries() {
  const s = cur();
  // what was bought with XP stays found and unlocked (it was paid for); free unlocks are hidden again
  const paid = Object.fromEntries(Object.entries(s.unlocked ?? {}).filter(([, u]) => u?.cost > 0));
  const next = { ...s, discovered: Object.fromEntries(Object.keys(paid).filter((id) => s.discovered?.[id]).map((id) => [id, s.discovered[id]])), unlocked: paid, nights: [] };
  if (isSecret(s.preset) && !paid[s.preset]) Object.assign(next, { preset: "default", base: neutral(), role: {}, custom: null, activeTemplate: null });
  jokeTimes.length = 0;
  return { state: save(next, "reset-secrets") };
}

// ---- saved templates --------------------------------------------------------------------------------------------------
const newId = () => "t" + deps.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cleanName = (n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
export function listTemplates() { return cur().templates; }
export function saveTemplate(name, { emoji = "", voice = null, alwaysVoice = false } = {}) {
  const s = cur();
  const nm = cleanName(name);
  if (!nm) throw new Error("Give the personality a name.");
  if (s.templates.length >= MAX_TEMPLATES) throw new Error(`You can save up to ${MAX_TEMPLATES} personalities. Delete one first.`);
  if (s.templates.some((t) => t.name.toLowerCase() === nm.toLowerCase())) throw new Error(`You already have one called "${nm}".`);
  const t = { id: newId(), name: nm, emoji: String(emoji ?? "").slice(0, 8), preset: s.preset, base: s.base, role: s.role, pins: s.pins, custom: s.custom, voice: voice || null, alwaysVoice: Boolean(alwaysVoice), createdAt: new Date(deps.now()).toISOString() };
  const next = save({ ...s, templates: [...s.templates, t], activeTemplate: t.id }, "template");
  return { state: next, template: t };
}
function tpl(id) { const t = cur().templates.find((x) => x.id === id); if (!t) throw new Error("That saved personality isn't there anymore."); return t; }
export function renameTemplate(id, name) {
  const s = cur(); const nm = cleanName(name); if (!nm) throw new Error("Give it a name.");
  if (s.templates.some((t) => t.id !== id && t.name.toLowerCase() === nm.toLowerCase())) throw new Error(`You already have one called "${nm}".`);
  tpl(id);
  return { state: save({ ...s, templates: s.templates.map((t) => (t.id === id ? { ...t, name: nm } : t)) }, "template") };
}
export function updateTemplate(id, patch = {}) {
  const s = cur(); tpl(id);
  const allowed = {}; for (const k of ["emoji", "voice", "alwaysVoice"]) if (k in patch) allowed[k] = k === "alwaysVoice" ? Boolean(patch[k]) : patch[k];
  return { state: save({ ...s, templates: s.templates.map((t) => (t.id === id ? { ...t, ...allowed } : t)) }, "template") };
}
export function duplicateTemplate(id) {
  const s = cur(); const t = tpl(id);
  if (s.templates.length >= MAX_TEMPLATES) throw new Error(`You can save up to ${MAX_TEMPLATES} personalities.`);
  let nm = `${t.name} copy`.slice(0, 40), k = 2;
  while (s.templates.some((x) => x.name.toLowerCase() === nm.toLowerCase())) nm = `${t.name} copy ${k++}`.slice(0, 40);
  const copy = { ...structuredClone(t), id: newId(), name: nm, createdAt: new Date(deps.now()).toISOString() };
  return { state: save({ ...s, templates: [...s.templates, copy] }, "template"), template: copy };
}
export function deleteTemplate(id) {
  const s = cur(); tpl(id);
  return { state: save({ ...s, templates: s.templates.filter((t) => t.id !== id), defaultTemplate: s.defaultTemplate === id ? null : s.defaultTemplate, activeTemplate: s.activeTemplate === id ? null : s.activeTemplate }, "template") };
}
export function setDefaultTemplate(id) { if (id) tpl(id); return { state: save({ ...cur(), defaultTemplate: id || null }, "template") }; }
export function applyTemplate(id) {
  const s = cur(); const t = tpl(id);
  const next = { ...s, preset: t.preset, base: t.base, role: t.role, pins: t.pins ?? [], custom: t.custom ?? null, activeTemplate: t.id };
  const egg = eggCheck(active(s), active(next));
  if (egg.firstTime) next.easterEggs = [...new Set([...(s.easterEggs ?? []), "sage"])];
  const st = save(next, "template");
  const offer = t.voice ? voiceOffer(t.voice, t.alwaysVoice) : voiceOffer(byId(t.preset).voice);
  if (offer?.always && deps.setVoice) { try { deps.setVoice(offer.voice); } catch { /* voice not available */ } }
  return { state: st, template: t, voiceOffer: offer?.always ? null : offer, switchedVoice: offer?.always ? offer.voice : null, easter: egg };
}
export function exportTemplates() { return JSON.stringify({ dayspringPersonalities: 1, templates: cur().templates }, null, 2); }
export function importTemplates(json, { replace = false } = {}) {
  let data; try { data = typeof json === "string" ? JSON.parse(json) : json; } catch { throw new Error("That file isn't a Dayspring personalities file."); }
  const list = Array.isArray(data?.templates) ? data.templates : Array.isArray(data) ? data : null;
  if (!list) throw new Error("That file has no personalities in it.");
  const s = cur();
  const out = replace ? [] : [...s.templates];
  let added = 0, skipped = 0;
  for (const raw of list) {
    if (out.length >= MAX_TEMPLATES) { skipped++; continue; }
    const nm = cleanName(raw?.name); if (!nm) { skipped++; continue; }
    let name = nm, k = 2; while (out.some((t) => t.name.toLowerCase() === name.toLowerCase())) name = `${nm} ${k++}`.slice(0, 40);
    const n = norm({ preset: raw.preset, base: raw.base, role: raw.role, pins: raw.pins });
    let cust = null; if (raw.custom?.card) { try { cust = { text: custom.limitWords(raw.custom.text).text, card: custom.validateCard(raw.custom.card) }; } catch { cust = null; } }
    out.push({ id: newId() + added, name, emoji: String(raw.emoji ?? "").slice(0, 8), preset: n.preset, base: n.base, role: n.role, pins: n.pins, custom: cust, voice: raw.voice ?? null, alwaysVoice: Boolean(raw.alwaysVoice), createdAt: new Date(deps.now()).toISOString() });
    added++;
  }
  save({ ...s, templates: out }, "template");
  return { added, skipped, total: out.length };
}

// ---- fuzzy names ------------------------------------------------------------------------------------------------------
const simple = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|a|an|my|personality|character|persona|mode|one|voice)\b/g, " ").replace(/\s+/g, " ").trim();
function lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; const d = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
export function similarity(a, b) {
  const x = simple(a), y = simple(b); if (!x || !y) return 0; if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" "));
  const close = (w, v) => { const L = Math.max(w.length, v.length); return L >= 8 ? lev(w, v) <= 2 : L >= 5 ? lev(w, v) <= 1 : false; };
  const inter = [...tx].filter((w) => ty.has(w) || [...ty].some((v) => close(w, v) && w[0] === v[0])).length;
  const tok = inter / Math.max(tx.size, ty.size);
  const ch = 1 - lev(x, y) / Math.max(x.length, y.length);
  return Math.max(tok, ch);
}
const ALIASES = {
  cowboy: ["cowboy", "cowgirl", "sheriff", "outlaw", "wrangler", "western"], broski: ["broski", "bro", "brah", "dude", "surfer", "gym bro"],
  maiden: ["fair maiden", "maiden", "princess", "lady"], knight: ["noble knight", "knight", "paladin"], sage: ["star sage", "sage", "jedi", "space wizard", "star knight"],
  groovy: ["groovy", "hippie", "hippy", "disco", "seventies"], professor: ["professor", "teacher", "scholar"], moviebuff: ["movie buff", "movie", "film buff", "cinema", "film", "movie officianado", "movie aficionado"],
  politician: ["corrupt politician", "politician", "senator", "mayor"], officer: ["commanding officer", "officer", "drill sergeant", "sergeant", "general", "captain of the army"],
  pirate: ["pirate", "captain", "buccaneer"], butler: ["butler", "jeeves", "valet"], grandparent: ["grandma", "grandpa", "granny", "grandparent", "nana", "papa"],
  robot: ["robot", "android", "droid", "bot", "machine"], detective: ["noir detective", "detective", "private eye", "gumshoe"], coach: ["coach", "trainer"],
  wizard: ["wizard", "magician", "sorcerer", "mage"], host: ["game show host", "game show", "host", "announcer"], monk: ["zen monk", "monk", "zen"], bard: ["bard", "minstrel", "poet", "troubadour"],
  default: ["normal", "default", "regular", "yourself", "plain"],
};
export function findTarget(words) {
  const s = cur();
  let best = null;
  for (const t of s.templates) { const sc = similarity(words, t.name); if (sc >= 0.72 && (!best || sc > best.score)) best = { kind: "template", id: t.id, name: t.name, score: sc + 0.01 }; }
  for (const [id, al] of Object.entries(ALIASES)) for (const a of al) { const sc = similarity(words, a); if (sc >= 0.78 && (!best || sc > best.score)) best = { kind: "preset", id, name: byId(id).name, score: sc }; }
  // secret characters, once found, by name ("switch to the cat", "be the viking")
  for (const sec of SECRETS) if (s.discovered?.[sec.id]) for (const a of [sec.name.replace(/^The /, ""), sec.id]) { const sc = similarity(words, a); if (sc >= 0.8 && (!best || sc > best.score)) best = { kind: "preset", id: sec.id, name: sec.name, score: sc }; }
  return best;
}

// ---- voice commands ---------------------------------------------------------------------------------------------------
const MORE = [
  [/\b(sass(y|ier)?|snark(y|ier)?|cheek(y|ier)?|tease|teasing)\b/, "bite", 1], [/\b(gentle|gentler|nicer|softer|kinder)\b/, "bite", -1],
  [/\b(funn(y|ier)|sill(y|ier)|playful|jok(ey|ier|es))\b/, "humour", 1], [/\b(serious|solemn)\b/, "humour", -1],
  [/\b(formal|proper|polite)\b/, "formality", 1], [/\b(casual|relaxed|chill)\b/, "formality", -1],
  [/\b(brief|briefer|short|shorter|concise|terse)\b/, "length", -1], [/\b(detailed|explanatory|longer|chatty|thorough)\b/, "length", 1],
  [/\b(warm|warmer|affectionate|sweet|sweeter|loving)\b/, "warmth", 1], [/\b(cool|cooler|businesslike|professional)\b/, "warmth", -1],
  [/\b(energetic|excited|hyped|peppy|upbeat)\b/, "energy", 1], [/\b(calm|calmer|mellow|quieter)\b/, "energy", -1],
  [/\b(flatter(ing)?|encouraging|supportive)\b/, "praise", 1], [/\b(honest|candid|blunt)\b/, "praise", -1],
  [/\b(cheerful|sunny|positive|optimistic)\b/, "outlook", 1], [/\b(gloomy|dark|brooding|dramatic)\b/, "outlook", -1],
  [/\b(curious|inquisitive|nosy)\b/, "curiosity", 1], [/\b(childlike|kid like|kiddish)\b/, "maturity", -1], [/\b(smart|scholarly|academic|professorial)\b/, "maturity", 1],
  [/\b(motherly|mothering|nurturing)\b/, "care", -1], [/\b(fatherly|dad like)\b/, "care", 1], [/\b(accent|dialect)\b/, "flavour", 1],
];
const YES = /^(yes|yeah|yep|sure|ok(ay)?|please|do it|go ahead|sounds good|absolutely|yes please)\b/;
const NO = /^(no|nope|nah|not now|no thanks|don'?t|cancel|never ?mind)\b/;

// Returns a spoken reply (string) or { reply, show } for the screen, or null when it isn't a personality command.
export function handle(text) {
  let m0;
  const orig = String(text ?? "").replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim().replace(/^(hey |ok |okay )?(dayspring |lantern )?(can you |could you |please |would you )*/i, "").trim();
  const q = orig.toLowerCase();
  const keepCase = (s) => { const i = q.lastIndexOf(s); return i >= 0 ? orig.slice(i, i + s.length) : s; };
  if (!q) return null;
  try { event("use"); } catch { /* counting only */ }
  // a secret's phrase: find it (first time) and become it
  const sid = phraseUnlock(q);
  if (sid) {
    const found = discover(sid, "phrase");
    const sec = secretById(sid);
    if (!cur().unlocked[sid]) {
      const cost = costOf(sid), bal = xpInfo().balance;
      const how = `Unlock it for ${cost} XP in Settings → Personality, or say "unlock ${sec.name.replace(/^The /, "the ")}".${bal != null ? ` You have ${bal} XP.` : ""}`;
      if (found) return { reply: `${found.text} ${how}`, show: "discovered:" + sid, discovered: found };
      return { reply: `That's ${sec.name}. ${how}`, show: "personality" };
    }
    selectPreset(sid);
    const hello = phrase("greeting") ?? "";
    if (found) return { reply: `${found.text} ${hello}`.trim(), show: "discovered:" + sid, discovered: found };
    return { reply: `Okay, I'm ${sec.name} now. ${hello}`.trim(), show: null };
  }
  if (/^(what|which) secret (characters|personalities)( have i| did i)? (found|discovered|unlocked)|^(list|show) (my )?secret (characters|personalities)|^how many secrets? (have i|did i) (found|find)/.test(q)) {
    const v = secretsView();
    const names = v.list.filter((x) => !x.locked).map((x) => x.name);
    return { reply: names.length ? `You've found ${v.found} of ${v.total} secret characters: ${names.join(", ")}.` : `You haven't found any of the ${v.total} secret characters yet. Say "give me a hint for a secret character" if you want a clue.`, show: "personality" };
  }
  if ((m0 = /^(unlock|buy) (the |my )?(.+?)( character| personality| persona)?( with xp| for xp)?$/.exec(q))) {
    const want = SECRETS.find((x) => similarity(m0[3], x.name.replace(/^The /, "")) >= 0.8 || similarity(m0[3], x.name) >= 0.8);
    if (want) {
      const st = cur();
      if (!st.discovered[want.id]) return "You haven't found that one yet. Keep looking!";
      if (st.unlocked[want.id]) return `${want.name} is already unlocked. Say "switch to ${want.name.replace(/^The /, "the ")}".`;
      const cost = costOf(want.id), bal = xpInfo().balance;
      if (bal != null && bal < cost) return `${want.name} costs ${cost} XP, and you have ${bal}. Keep checking off real tasks to earn more.`;
      pending = { kind: "unlock", data: { id: want.id, name: want.name, cost }, at: deps.now() };
      return `Unlock ${want.name} for ${cost} XP?${bal != null ? ` You have ${bal}.` : ""}`;
    }
  }
  if (/^(give me |got |can i (get|have) )?a hint( for| about)?( a| the)? secret (character|personality)|^secret (character )?hint/.test(q)) {
    const locked = secretsView().list.filter((x) => x.locked);
    if (!locked.length) return "You've found every secret character. Well done!";
    return locked[Math.floor(Math.random() * locked.length)].hint;
  }

  // the yes/no to our own question
  if (pending && deps.now() - pending.at < 60_000) {
    if (YES.test(q)) { const p = pending; pending = null; return confirmPending(p); }
    if (NO.test(q)) { pending = null; return "Okay, I'll leave it."; }
  }
  let m;
  // "back to normal" means many things (the sky, the speed…): it's ours only when a personality is actually on
  if (/^(be normal|go back to normal|back to normal|drop the act|drop the attitude|be yourself|normal mode|stop acting|stop the act|regular mode|just be (normal|you|yourself)|turn off (the )?personality)$/.test(q)) {
    if (compile.isPlain(active())) return null;
    normal(); return "Okay, back to my usual self.";
  }
  if (/^(what|which) (personality|character|persona) (are you|is this|is on|are you using)|^who are you (right now|being)|^what are you pretending to be/.test(q)) return describe();
  if (/^(what|which) (personalities|characters|personas) (are there|are available|do you have|can you do|can you be)|^list (my |the |all )?(personalities|characters|personas)|^(show me|show) (my |the )?(personalities|characters)/.test(q)) {
    const t = listTemplates().map((x) => x.name);
    const reply = `I know ${PRESETS.length - 1} characters, like the cowboy, pirate, knight and professor${t.length ? `, and you've saved ${t.length}: ${t.slice(0, 8).join(", ")}${t.length > 8 ? " and more" : ""}` : ""}. Say "be a cowboy" or pick one in Settings.`;
    return { reply, show: "personality" };
  }
  if ((m = /^save (this|the current|my current)? ?(personality|character|persona|one)? ?(as|called|named) (.+)$/.exec(q))) {
    try { const r = saveTemplate(keepCase(m[4])); return `Saved as "${r.template.name}".`; } catch (e) { return e.message; }
  }
  if ((m = /^(delete|remove) (my |the )?(.+?)( personality| character| persona)?$/.exec(q)) && /personality|character|persona/.test(q)) {
    const t = findTarget(m[3]); if (!t || t.kind !== "template") return `I couldn't find a saved personality called "${m[3]}".`;
    pending = { kind: "delete", data: t, at: deps.now() }; return `Delete your "${t.name}" personality?`;
  }
  if ((m = /^rename (my |the )?(.+?)( personality| character| persona)? to (.+)$/.exec(q))) {
    const t = findTarget(m[2]); if (!t || t.kind !== "template") return `I couldn't find a saved personality called "${m[2]}".`;
    try { renameTemplate(t.id, keepCase(m[4])); return `Renamed it to "${cleanName(keepCase(m[4]))}".`; } catch (e) { return e.message; }
  }
  if (/^(surprise me with a (personality|character)|random (personality|character)|pick a (random )?(personality|character)( for me)?|surprise me personality)$/.test(q)) {
    const pool = PRESETS.filter((p) => p.id !== "default" && p.id !== cur().preset);
    const p = pool[Math.floor(Math.random() * pool.length)];
    return switchTo({ kind: "preset", id: p.id, name: p.name }, true);
  }
  if ((m = /^(be|act) (a little |a lot |much |way |even |a bit )?(more|less) (.+)$/.exec(q)) || (m = /^(get|sound) (a little |a lot |much |a bit )?(more|less) (.+)$/.exec(q))) {
    const hit = MORE.find(([re]) => re.test(m[4]));
    if (!hit) return null;
    const [, id, dir] = hit; const step = /a lot|much|way/.test(m[2] ?? "") ? 50 : /a little|a bit/.test(m[2] ?? "") ? 20 : 35;
    const sign = (m[3] === "more" ? 1 : -1) * dir;
    const v = cur().base[id] + sign * step;
    setSlider("base", id, v);
    return m[3] === "more" ? "Okay, turning that up." : "Okay, turning that down.";
  }
  if ((m = /^(be|become|switch to|change to|use|go|turn into|act like|talk like|speak like|sound like|pretend to be|pretend you'?re|put on) (a |an |the |my |your )?(.+?)( personality| character| persona| mode| voice)?$/.exec(q))) {
    if (m[4] === " voice") return null;                 // "use my voice" etc. belongs to the voice settings
    // "use", "switch to", "go" and "put on" need a personality word, or a saved personality's name, so "use the timer" isn't a character
    const strongVerb = /^(be|become|turn into|act like|talk like|speak like|sound like|pretend to be|pretend you'?re)$/.test(m[1]);
    // the easter egg by name
    if (strongVerb && /\byoda\b/.test(m[3])) { selectPreset("sage"); for (const [k, v] of Object.entries({ light: 80, wise: 90, ancient: 95, peaceful: 70 })) setSlider("role", k, v); return "Hmm. Talk like this, I will."; }
    const t = findTarget(m[3]);
    if (!t) return null;
    if (!strongVerb && !m[4] && !(t.kind === "template" && t.score >= 0.9)) return null;
    if (t.kind === "preset" && t.id === "default") { if (compile.isPlain(active())) return null; normal(); return "Okay, back to my usual self."; }
    // a role by name: "talk like a drill sergeant" → the Commanding Officer, drill-sergeant end
    if (t.kind === "preset" && t.id === "officer" && /drill|sergeant/.test(m[3])) { selectPreset("officer"); setSlider("role", "mentor", -80); return "Drill sergeant mode! I'm the Commanding Officer now. Say \"be normal\" to go back."; }
    return switchTo(t, false);
  }
  if (/^(use|switch to|change to) (a )?different voice$/.test(q)) return null;   // the voice settings handle this
  return null;
}
function switchTo(t, surprise) {
  const r = t.kind === "template" ? applyTemplate(t.id) : selectPreset(t.id);
  const who = t.kind === "template" ? `your "${t.name}" personality` : `the ${t.name}`;
  const hello = phrase("greeting") ?? "";
  let reply = `${surprise ? "Surprise! " : ""}Okay, I'm ${who} now.${hello ? " " + hello : ""}`;
  if (r.switchedVoice) reply += ` (Voice: ${r.switchedVoice}.)`;
  else if (r.voiceOffer) { pending = { kind: "voice", data: r.voiceOffer, at: deps.now() }; reply += ` ${r.voiceOffer.ask}`; }
  if (r.easter?.toast) reply += " Something awakens…";
  return { reply, show: r.easter?.toast ? "toast:" + r.easter.toast : null };
}
function confirmPending(p) {
  if (p.kind === "unlock") {
    try { const r = unlockSecret(p.data.id); if (r && typeof r.then === "function") { r.catch(() => {}); return `Unlocking ${p.data.name}…`; } return r.ok ? `🔓 Unlocked ${p.data.name}! Say "switch to ${p.data.name.replace(/^The /, "the ")}" to try it.` : r.message; } catch (e) { return e.message; }
  }
  if (p.kind === "delete") { try { deleteTemplate(p.data.id); return `Deleted "${p.data.name}".`; } catch (e) { return e.message; } }
  if (p.kind === "voice") {
    if (!deps.setVoice) return "You can pick that voice in Settings → Voice.";
    try { deps.setVoice(p.data.voice); return `Okay, switching to ${p.data.voice}.`; } catch { return `I couldn't switch to ${p.data.voice}. You can pick a voice in Settings.`; }
  }
  return null;
}
export const _reset = () => { pending = null; for (const k of Object.keys(recent)) delete recent[k]; jokeTimes.length = 0; };
