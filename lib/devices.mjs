// Every speaker and microphone on the laptop, as physical devices the owner can name and mix and match:
//   "list my audio devices", "call the X100 my blue headset", "use the blue headset for both",
//   "play through the TV and use the laptop mic", "use the headset for sound and the laptop mic".
// Windows tells us each endpoint's form factor and which physical device it belongs to (scripts/audio-default.ps1);
// a speaker and a mic on the same device is a headset. Anything still unclear is looked up once with the AI and cached.
// Nicknames, lookups and the owner's own type hints ("typeHints") live in data/devices.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import * as settings from "./settings.mjs";
import * as mic from "./mic.mjs";
import * as llm from "./llm.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "..", "data", "devices.json");
const PS1 = join(here, "..", "scripts", "audio-default.ps1");
let db = null;
function load() { if (!db) db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { nicknames: {}, lookups: {}, seen: {} }; return db; }
function save() { writeJSONAtomic(FILE, load(), 2); }
function ps(args) {
  return new Promise((res, rej) => execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...args], { windowsHide: true, timeout: 25000 },
    (err, out) => (err ? rej(err) : res(JSON.parse(String(out).trim() || "[]")))));
}
const TYPE_WORDS = { headset: "headset", headphones: "headphones", earbuds: "earbuds", tv: "TV", "laptop-speaker": "laptop speaker", "laptop-mic": "laptop mic",
  speaker: "speaker", microphone: "microphone", other: "audio device" };
export const ROLE_OF = { tv: "tv", headset: "headphones", headphones: "headphones", earbuds: "headphones", "laptop-speaker": "speakers", speaker: "speakers", other: "speakers" };

function guessType(key, outs, ins) {
  const all = [key, ...outs.map((o) => o.name), ...ins.map((i) => i.name)].join(" ").toLowerCase();
  if (/voicemeeter|vb-audio/.test(all)) return "virtual";
  const hint = mic.typeHint(all);
  if (hint && TYPE_WORDS[hint]) return hint;
  if (outs.some((o) => o.formFactor === 9) || /hdmi|display audio|displayport|\btv\b|television/.test(all)) return "tv";
  if (/buds|airpods|earbud|galaxy buds|pixel buds/.test(all)) return "earbuds";
  if (/realtek|intel.*smart sound|built-?in|internal|conexant|cirrus|array/.test(all)) return outs.length ? "laptop-speaker" : "laptop-mic";
  if (outs.length && ins.length) return "headset";                      // a speaker and a mic on one device
  if (outs.some((o) => o.formFactor === 5) || ins.some((i) => i.formFactor === 5) || /headset/.test(all)) return "headset";
  if (outs.some((o) => o.formFactor === 3) || /headphone/.test(all)) return "headphones";
  if (!outs.length && ins.length) return "microphone";
  return null;                                                           // ask the AI
}
// Quietly ask the AI what an unfamiliar device is (once; cached).
async function lookUp(key) {
  const d = load();
  if (d.lookups[key]) return d.lookups[key];
  if (!llm.ready()) return "other";
  try {
    const text = await llm.complete({ system: "Answer with exactly one word.", maxTokens: 10, timeoutMs: 20_000,
      prompt: `What kind of audio device is "${key}" (a Windows audio device name)? Answer with exactly one word: headset, headphones, earbuds, speaker, tv, microphone, or other.` });
    const w = String(text ?? "").toLowerCase().match(/headset|headphones|earbuds|speaker|tv|microphone|other/)?.[0] ?? "other";
    d.lookups[key] = w; save();
    return w;
  } catch { return "other"; }
}

let cache = { at: 0, list: null }, pending = null;
// The physical devices: [{ key, name, nickname, type, typeWord, outputs:[{id,name,default}], inputs:[…], inUse: { sound, mic } }]
// Asking Windows takes a second or so: an older answer is given straight away while a fresh one is fetched behind it
// (fresh: true waits for the new one). Two callers at once share one lookup.
export async function list({ fresh = false } = {}) {
  if (!fresh && cache.list && Date.now() - cache.at < 30_000) return withUse(cache.list);
  if (!fresh && cache.list) { refresh().catch(() => {}); return withUse(cache.list); }
  return withUse(await refresh());
}
// which speakers Dayspring plays through comes from its settings, so it's worked out again on every answer
function withUse(list) {
  const s = settings.get();
  for (const g of list) g.inUse = { ...g.inUse, sound: g.outputs.length > 0 && (s.audioOutputs ?? []).includes(g.role) && (!s.preferredOutputs?.[g.role] || g.outputs.some((o) => o.name === s.preferredOutputs[g.role])) };
  return list;
}
function refresh() {
  pending ??= readDevices().finally(() => { pending = null; });
  return pending;
}
// the sound settings changed (which device is in use): the list's "in use" marks must follow
export function invalidate() { cache.at = 0; }
async function readDevices() {
  const [outs, ins] = await Promise.all([ps(["-List"]), ps(["-List", "-Capture"])]);
  const groups = new Map();
  const add = (e, dir) => { const key = e.device || e.name; if (!groups.has(key)) groups.set(key, { key, outputs: [], inputs: [] }); groups.get(key)[dir].push(e); };
  outs.forEach((e) => add(e, "outputs")); ins.forEach((e) => add(e, "inputs"));
  const s = settings.get(), d = load(), out = [];
  for (const g of groups.values()) {
    let type = guessType(g.key, g.outputs, g.inputs);
    if (type === "virtual") continue;
    if (!type) type = await lookUp(g.key);
    if (!d.seen[g.key]) { d.seen[g.key] = new Date().toISOString(); save(); }
    const nickname = d.nicknames[g.key] ?? null;
    const pretty = type === "tv" ? "the TV" : type === "laptop-speaker" ? "the laptop speaker" : type === "laptop-mic" ? "the laptop mic" : g.key.replace(/\s*\(.*\)\s*/g, "").trim();
    const role = ROLE_OF[type];
    const sound = g.outputs.length > 0 && (s.audioOutputs ?? []).includes(role) && (!s.preferredOutputs?.[role] || g.outputs.some((o) => o.name === s.preferredOutputs[role]));
    out.push({ key: g.key, name: pretty, nickname, type, typeWord: TYPE_WORDS[type] ?? type, role, outputs: g.outputs, inputs: g.inputs, inUse: { sound, mic: g.inputs.some((i) => i.default) } });
  }
  // the same kind twice (two headsets): both stay, told apart by name or nickname
  cache = { at: Date.now(), list: out };
  return out;
}
export const label = (g) => g.nickname ?? g.name;

// Words that point at a device in something the owner said: its nickname, its model name, and its kind (when there's only one).
function aliases(g, all) {
  const a = [];
  if (g.nickname) a.push(g.nickname.toLowerCase(), g.nickname.toLowerCase().replace(/^(my|the) /, ""));
  const model = g.key.toLowerCase().replace(/\(r\)|\(tm\)/g, "").replace(/gaming|audio|driver|for|technology|digital|microphones?|speakers?|headset|hd|\d+-/g, " ").replace(/\s+/g, " ").trim();
  if (model.length >= 3) a.push(model, ...model.split(" ").filter((w) => w.length >= 3 && /\d/.test(w)));   // model numbers like "x100", "ab-12"
  const same = all.filter((x) => x.type === g.type).length === 1;
  const kinds = { tv: ["tv", "television"], "laptop-speaker": ["laptop speaker", "laptop speakers", "computer speaker", "computer speakers", "built-in speaker", "laptop"], "laptop-mic": ["laptop mic", "laptop microphone", "computer mic", "built-in mic", "laptop"],
    headset: ["headset", "headphones"], headphones: ["headphones"], earbuds: ["earbuds", "buds"], speaker: ["speaker"], microphone: ["microphone", "mic"] }[g.type] ?? [];
  if (same || ["tv", "laptop-speaker", "laptop-mic"].includes(g.type)) a.push(...kinds);
  return [...new Set(a.filter(Boolean))];
}
function mentions(text, all) {
  const q = ` ${String(text).toLowerCase().replace(/[.,!?]/g, " ")} `;
  const hits = [];
  const pairs = all.flatMap((g) => aliases(g, all).map((w) => ({ g, w }))).sort((x, y) => y.w.length - x.w.length);
  const taken = [];
  for (const { g, w } of pairs) {
    let i = q.indexOf(` ${w} `);
    while (i >= 0) {
      const start = i + 1, end = start + w.length;
      if (!taken.some(([a, b]) => start < b && end > a)) { taken.push([start, end]); hits.push({ g, w, start, end }); }
      i = q.indexOf(` ${w} `, i + 1);
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

// Point sound and/or the mic at devices. outputs: [group], input: group (or null to leave the mic alone)
export async function apply({ outputs = [], input = null }) {
  const said = [];
  // tests: describe what would happen without touching anything
  if (process.env.DAYSPRING_DEVICES_DRYRUN === "1") return [outputs.length ? `sound on ${joinAnd(outputs.map(label))}` : null, input ? `listening through ${label(input)}` : null].filter(Boolean);
  if (outputs.length) {
    const roles = [...new Set(outputs.map((g) => g.role).filter(Boolean))];
    const preferred = { ...(settings.get().preferredOutputs ?? {}) };
    for (const g of outputs) if (g.role && g.outputs[0]) preferred[g.role] = g.outputs[0].name;
    settings.set({ audioOutputs: roles, preferredOutputs: preferred });
    said.push(`sound on ${joinAnd(outputs.map(label))}`);
  }
  if (input) {
    const m = input.inputs[0];
    if (m) { await mic.use(m.name); said.push(`listening through ${input.nickname ? input.nickname : input.type === "laptop-mic" ? "the laptop mic" : label(input) + "'s mic"}`); }
  }
  cache.at = 0;
  return said;
}
const joinAnd = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
export function setNickname(key, nick) { const d = load(); if (nick) d.nicknames[key] = nick; else delete d.nicknames[key]; save(); cache.at = 0; }

// Spoken device commands. Returns { reply, panel?, micChanged? } or null (not about devices).
export async function handle(text) {
  const q = String(text).toLowerCase().replace(/[.!?]+$/, "").trim();
  if (!/\b(device|devices|speaker|speakers|mic|microphone|headset|headphones|earbuds|buds|tv|television|laptop|computer|both|nickname|call|name)\b/.test(q) && !/\b[a-z]{1,3}-?\d{2,4}\b/.test(q)) return null;
  // "list my audio devices", "what speakers and mics do you see"
  if (/\b(list|what|which|show)( all)?( of)?( my| the| your)?( audio)? (devices|speakers and mics|mics and speakers|inputs and outputs|outputs and inputs|audio devices|sound devices)\b|\bwhat (devices|speakers|mics|microphones) (do you see|are there|can you use)\b/.test(q)) {
    const all = await list({ fresh: true });
    const lines = all.map((g) => `${label(g)}${g.nickname ? ` (${g.name})` : ""}: a ${g.typeWord}${g.outputs.length && g.inputs.length ? " with a mic" : ""}${g.inUse.sound ? ", playing sound now" : ""}${g.inUse.mic ? ", the mic I'm using" : ""}`);
    return { reply: `Here's what I can see. ${lines.join(". ")}. You can nickname any of them, like "call the ${all.find((g) => g.type === "headset")?.name ?? "headset"} my blue headset".`, panel: "devices" };
  }
  const all = await list();
  // nicknames: "call the X100 my blue headset", "name the AB-12 the black headset", "the X100 is my blue headset"
  // find the device first ("the X100", "the AB-12", "the laptop mic"), then everything after it is the nickname
  let nm = null;
  const naming = /^(?:call|name|nickname|rename) (.+)$/.exec(q);
  if (naming) {
    const h = mentions(naming[1], all)[0];
    const nick = h && naming[1].slice(h.end).replace(/^\s*(as|to)\s+/, "").replace(/["“”]/g, "").trim();
    nm = h ? [null, naming[1].slice(0, h.end), nick] : [null, naming[1].split(" ").slice(0, 2).join(" "), ""];
  } else nm = /^(?:the )?(.+?) is (?:my|the) ([a-z0-9' -]{2,30}(?:headset|headphones|earbuds|speaker|mic|tv))$/.exec(q);
  if (nm) {
    const target = mentions(nm[1], all)[0]?.g;
    if (!target) return { reply: `I don't know which device "${nm[1].replace(/^the /, "")}" is. Say "list my audio devices" and I'll show you their names.` };
    const nick = String(nm[2] ?? "").replace(/^(my|the) /, "").trim();
    if (!nick) return { reply: `What should I call ${target.name}?` };
    setNickname(target.key, nick);
    return { reply: `Got it. ${target.name.charAt(0).toUpperCase() + target.name.slice(1)} is now "${nick}". You can say things like "use the ${nick} for both".` };
  }
  if ((!/\b(use|switch|play|listen|put|set|send|route|move|go|hear)\b/.test(q) && !/\bfor (sound|audio|both|everything)\b|\bmic\b/.test(q)) || /\b(spotify|youtube|song|video|playlist)\b/.test(q)) return null;
  const hits = mentions(q, all);
  if (!hits.length) return null;
  // which way each mention goes: the words right around it decide ("…headset for sound and the laptop mic")
  const both = /\bfor (both|everything|sound and (the )?mic|audio and (the )?mic)\b|\bboth ways\b/.test(q);
  const outputs = [], seen = new Set();
  let input = null;
  hits.forEach((h, i) => {
    const after = q.slice(h.end, hits[i + 1]?.start ?? q.length), before = q.slice(Math.max(0, h.start - 22), h.start);
    const wantsMic = /\b(mic|microphone|to listen|for listening|listen)\b/.test(after.slice(0, 22)) || /\b(listen (with|through|on)|mic (on|from))\s*(the |my )?$/.test(before) || /\bmic\b/.test(h.w);
    const wantsSound = /\b(speaker|speakers|sound|audio|output|to play|for playing)\b/.test(after.slice(0, 22)) || /\b(play (on|through)|sound (on|through)|hear (it )?(on|through))\s*(the |my )?$/.test(before);
    if ((both && hits.length === 1) || (both && !wantsMic && !wantsSound)) { if (h.g.outputs.length && !seen.has(h.g.key)) { outputs.push(h.g); seen.add(h.g.key); } if (h.g.inputs.length) input = h.g; return; }
    if (wantsMic && h.g.inputs.length) { input = h.g; return; }
    if (h.g.outputs.length) { if (!seen.has(h.g.key)) { outputs.push(h.g); seen.add(h.g.key); } return; }
    if (h.g.inputs.length) input = h.g;
  });
  // plain "use my headset" with nothing else to decide: leave that to the simpler speaker switch
  if (!input && !both && outputs.length && hits.every((h) => !h.g.nickname || !q.includes(h.g.nickname.toLowerCase())) && !hits.some((h) => /\d/.test(h.w))) return null;
  if (!outputs.length && !input) return null;
  const said = await apply({ outputs, input });
  return { reply: `Okay: ${said.join(", and ")}.${input ? "" : ""}`, micChanged: Boolean(input) };
}
