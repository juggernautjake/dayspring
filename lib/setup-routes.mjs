// The setup wizard and Settings page (/setup): everything a new owner fills in, and changes later.
// Mounted by server.mjs: `if (await setupRoutes.handle(req, res, ctx)) return;` with ctx = { m, p, q, send, readJSON }.
// Keys go to .env through envfile.mjs and never come back to the browser (only "set" and the last four characters).
// Changes take effect right away (process.env and the live modules are updated); nothing here needs a restart.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import * as owner from "./owner.mjs";
import * as naming from "./naming.mjs";
import * as display from "./display.mjs";
import { on as featureOn } from "./features.mjs";   // "screenmove" (beta): moving the open screen when the choice changes
import * as browsers from "./browsers.mjs";
import * as envfile from "./envfile.mjs";
import * as llm from "./llm.mjs";
import * as voice from "./voice.mjs";
import * as settings from "./settings.mjs";
import * as store from "./store.mjs";
import * as permissions from "./permissions.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = () => { try { return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version; } catch { return "?"; } };
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const list = (v, max = 30) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => str(x, 80)).filter(Boolean).slice(0, max);
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = store.WEEKDAYS;

// Permissions live in data/permissions.json (permissions.mjs), never in owner.json.
const bool = (v) => (typeof v === "boolean" ? v : undefined);
function permExtras(b) {
  const out = {};
  if (b.can && typeof b.can === "object") { const c = {}; for (const k of ["create", "edit", "move", "delete"]) if (typeof b.can[k] === "boolean") c[k] = b.can[k]; out.can = c; }
  if (typeof b.canDelete === "boolean") out.can = { ...(out.can ?? {}), delete: b.canDelete };
  if (b.important !== undefined) out.important = (Array.isArray(b.important) ? b.important : String(b.important).split(/\r?\n/)).map((x) => str(x, 520)).filter(Boolean).slice(0, 200);
  if (b.bulkLimit !== undefined && Number.isFinite(Number(b.bulkLimit))) out.bulkLimit = Number(b.bulkLimit);
  return out;
}
// a setting to preview: the same fields as a save, not saved
function permDraft(b = {}) {
  const e = (x) => ({ path: str(x?.path, 520), kind: x?.kind === "file" ? "file" : "folder", access: ["none", "read", "readwrite"].includes(x?.access) ? x.access : "read", subfolders: x?.subfolders !== false });
  const cur = permissions.get();
  return { ...cur, files: ["off", "custom", "all"].includes(b.files) ? b.files : cur.files, allAccess: ["read", "readwrite"].includes(b.allAccess) ? b.allAccess : cur.allAccess,
    writeConfirm: ["ask", "on"].includes(b.writeConfirm) ? b.writeConfirm : cur.writeConfirm, entries: Array.isArray(b.entries) ? b.entries.slice(0, 200).map(e).filter((x) => x.path) : cur.entries,
    can: { ...cur.can, ...(permExtras(b).can ?? {}) }, programs: ["off", "ask", "on"].includes(b.programs) ? b.programs : cur.programs, browser: bool(b.browser) ?? cur.browser, web: bool(b.web) ?? cur.web };
}
// needsChoice: the setup can't go on until a file-access option is picked; confirmPending: an older install whose setting
// was kept as it was and should be confirmed once
const permState = () => { const p = permissions.get(); return { ...p, roots: permissions.roots(), summary: permissions.summary(), explain: permissions.explain(), needsChoice: !p.choiceMade, confirmPending: Boolean(p.confirmPending) }; };

// Temporarily use a provider/key (for a Test button) without saving it.
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v) process.env[k] = v;
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// the connected screens, numbered left to right (display.mjs; the same numbers the launcher uses)
const screens = () => display.screens();

function aiState() {
  return {
    provider: llm.provider(), model: llm.modelName(), ready: llm.ready(), label: llm.label(), auto: llm.autoModelOn(), claudeKey: Boolean(process.env.ANTHROPIC_API_KEY),
    providers: Object.fromEntries(Object.entries(llm.PROVIDERS).map(([k, v]) => [k, { label: v.label, keyVar: v.keyVar, keyUrl: v.keyUrl, defaultModel: v.defaultModel, webSearch: Boolean(v.webSearch) }])),
  };
}
function voiceState() {
  const s = settings.get();
  return { provider: voice.ttsProvider(), ready: voice.voiceReady().ready, voiceName: voice.voiceReady().voiceName, browserVoice: s.browserVoice ?? null, openaiVoice: s.openaiVoice ?? voice.OPENAI_DEFAULT, elevenVoice: s.voice ?? null, speedAdj: s.speedAdj ?? 0, volume: s.volume ?? 80, overscan: s.overscan ?? 0 };
}
const routinesState = () => ({ routines: store.routines(), categories: store.CATEGORIES, fixed: owner.get().fixed });

// A week from a few answers: sleep and wake, work days and hours, meals, and any fixed commitments.
function templateRoutines(t) {
  const out = [], add = (r) => { if (HM.test(r.start) && HM.test(r.end) && r.start < r.end && r.days.length) out.push(r); };
  const workDays = (t.workDays ?? []).filter((d) => DAYS.includes(d));
  const wake = HM.test(t.wake ?? "") ? t.wake : "07:00", bed = HM.test(t.bed ?? "") ? t.bed : "22:30";
  const plus = (hm, min) => { const [h, m] = hm.split(":").map(Number); const x = Math.min(23 * 60 + 59, h * 60 + m + min); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
  add({ title: "Morning routine", category: "home", days: DAYS, start: wake, end: plus(wake, 30), description: "Up and ready for the day." });
  if (t.meals !== false) {
    add({ title: "Breakfast", category: "meal", days: DAYS, start: plus(wake, 30), end: plus(wake, 60), description: "" });
    add({ title: "Lunch", category: "meal", days: DAYS, start: "12:00", end: "12:30", description: "" });
    add({ title: "Dinner", category: "meal", days: DAYS, start: "18:00", end: "18:45", description: "" });
  }
  if (workDays.length && HM.test(t.workStart ?? "") && HM.test(t.workEnd ?? "") && t.workStart < t.workEnd) {
    const lunchSplit = t.meals !== false && t.workStart < "12:00" && t.workEnd > "12:30";
    if (lunchSplit) {
      add({ title: str(t.workTitle, 60) || "Work", category: "work", days: workDays, start: t.workStart, end: "12:00", description: "" });
      add({ title: str(t.workTitle, 60) || "Work", category: "work", days: workDays, start: "12:30", end: t.workEnd, description: "" });
    } else add({ title: str(t.workTitle, 60) || "Work", category: "work", days: workDays, start: t.workStart, end: t.workEnd, description: "" });
  }
  for (const c of t.commitments ?? []) {
    const days = (c.days ?? []).filter((d) => DAYS.includes(d));
    add({ title: str(c.title, 60), category: store.CATEGORIES.includes(c.category) ? c.category : "flex", days, start: c.start, end: c.end, description: str(c.description, 200) });
  }
  add({ title: "Wind down", category: "rest", days: DAYS, start: minus(bed, 30), end: bed, description: "Screens off, get ready for bed." });
  return out.filter((r) => r.title);
}
function minus(hm, min) { const [h, m] = hm.split(":").map(Number); const x = Math.max(0, h * 60 + m - min); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; }

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/setup")) return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};

  if (m === "GET" && p === "/setup/state") {
    return send(res, 200, { version: version(), owner: owner.get(), ai: aiState(), voice: voiceState(), keys: envfile.status(), permissions: permState(), schedule: routinesState() }), true;
  }

  // ---- you, your assistant, where you are ----
  if (m === "POST" && p === "/setup/owner") {
    const patch = {};
    for (const k of ["name", "nickname", "assistantName", "humor"]) if (body[k] !== undefined) patch[k] = str(body[k], 60);
    if (body.nicknames !== undefined) patch.nicknames = (Array.isArray(body.nicknames) ? body.nicknames : String(body.nicknames).split(/[,\n]/)).map((n) => str(n, 40)).filter(Boolean).slice(0, owner.MAX_NICKNAMES);
    if (body.about !== undefined) patch.about = str(body.about, 1500);
    if (body.pronouns !== undefined) patch.pronouns = ["he", "she", "they"].includes(body.pronouns) ? body.pronouns : "they";
    if (body.interests !== undefined) patch.interests = list(body.interests, 40);
    if (body.wakeWords !== undefined) patch.wakeWords = list(body.wakeWords, 6).map((w) => w.toLowerCase());
    if (body.location) {
      // an empty or skipped location stays unset (Number(null) would be 0: a spot in the ocean off Africa)
      const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
      const l = body.location, lat = num(l.lat), lon = num(l.lon);
      patch.location = { place: str(l.place, 120), lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, timezone: str(l.timezone, 60) || Intl.DateTimeFormat().resolvedOptions().timeZone };
    }
    if (patch.assistantName === "") patch.assistantName = "Dayspring";
    // the name and the wake words follow the same rules as Settings → Your assistant (lib/naming.mjs): 1–19 characters,
    // never "Lantern" or a sound-alike, up to 3 wake words ("hey …" works before any of them without being typed)
    if (patch.assistantName !== undefined) { const r = naming.checkName(patch.assistantName); if (!r.ok) return send(res, 400, { error: r.error, field: "name" }), true; patch.assistantName = r.value; }
    if (patch.wakeWords) {
      const out = [];
      for (const w of patch.wakeWords.slice(0, 3)) { const r = naming.checkWake(w, { name: patch.assistantName ?? owner.assistant() }); if (!r.ok) return send(res, 400, { error: r.error, field: "wake" }), true; if (!out.includes(r.value)) out.push(r.value); }
      patch.wakeWords = out;
      naming.clearEnvPhrases();
    }
    const saved = owner.set(patch);
    if (patch.assistantName !== undefined || patch.wakeWords) naming.touch(patch.assistantName !== undefined ? "name" : "wake");   // the screens and the Discord bot
    return send(res, 200, { owner: saved }), true;
  }
  if (m === "GET" && p === "/setup/location") {
    const name = str(q.get("q"), 80);
    if (name.length < 2) return send(res, 200, { results: [] }), true;
    // (the same lookup "I live in …" uses by voice: lib/geocode.mjs)
    try {
      const { geocode } = await import("./geocode.mjs");
      return send(res, 200, { results: (await geocode(name)).map(({ place, lat, lon, timezone }) => ({ place, lat, lon, timezone })) }), true;
    } catch { return send(res, 200, { results: [], error: "Couldn't look that up (offline?). You can skip this and set it later." }), true; }
  }

  // ---- AI brain ----
  // "Check my Claude connection": the saved key, step by step (lib/claude-key.mjs)
  if (p === "/setup/ai/check" && m === "POST") return send(res, 200, await (await import("./claude-key.mjs")).checkSaved()), true;
  if (p === "/setup/ai/test" && m === "POST") {
    const pv = str(body.provider, 20);
    if (!llm.PROVIDERS[pv]) return send(res, 400, { error: "pick a provider" }), true;
    // Claude: the pasted key cleaned up and checked, and every failure in plain words with what to do next
    if (pv === "anthropic") {
      const ck = await import("./claude-key.mjs");
      const key = str(body.key, 600) || process.env.ANTHROPIC_API_KEY || "";
      const r = await ck.testKey(key, { model: str(body.model, 80) || undefined });
      return send(res, 200, { ok: r.ok, ms: r.ms, model: r.model, text: r.text ?? null, error: r.ok ? null : r.text, code: r.code ?? null, temporary: Boolean(r.temporary), saveable: Boolean(r.saveable), usedDefault: Boolean(r.usedDefault) }), true;
    }
    const extra = pv === "ollama" && body.url ? { OLLAMA_URL: str(body.url, 200) } : {};
    const r = await withEnv(extra, () => llm.test(pv, str(body.key, 400) || undefined, str(body.model, 80) || undefined));
    return send(res, 200, r), true;
  }
  if (p === "/setup/ai/models" && m === "GET") {
    const pv = str(q.get("provider"), 20);
    if (!llm.PROVIDERS[pv]) return send(res, 200, { models: [] }), true;
    return send(res, 200, { models: await llm.models(pv), default: llm.PROVIDERS[pv].defaultModel }), true;
  }
  if (p === "/setup/ai" && m === "POST") {
    const pv = str(body.provider, 20);
    // (each provider keeps its own model for when it's chosen again: lib/ai-switch.mjs)
    if (pv === "none") { const cur = llm.provider(); envfile.setVars({ AI_PROVIDER: "none", AI_MODEL: "", ...(llm.PROVIDERS[cur] && process.env.AI_MODEL ? { [`AI_MODEL_${cur.toUpperCase()}`]: process.env.AI_MODEL } : {}) }); return send(res, 200, { ok: true, ai: aiState() }), true; }
    const info = llm.PROVIDERS[pv];
    if (!info) return send(res, 400, { error: "pick a provider" }), true;
    let key = str(body.key, 600), model = str(body.model, 80);
    const url = str(body.url, 200);
    if (info.keyVar && !key && !process.env[info.keyVar]) return send(res, 400, { error: `Paste your ${info.label} key first.` }), true;
    if (pv === "anthropic") {
      // cleaned and tested; a key Anthropic rejected (401) is never saved; one that only met a busy or offline moment can
      // be saved anyway when he says so; a model this key can't use falls back to the default
      const ck = await import("./claude-key.mjs");
      if (key) { const c = ck.cleanKey(key); if (c.error) return send(res, 200, { ok: false, error: c.error, code: "format" }), true; key = c.key; }
      if (!body.skipTest) {
        const t = await ck.testKey(key || process.env.ANTHROPIC_API_KEY, { model: model || undefined });
        if (!t.ok && !(body.saveAnyway && t.temporary)) return send(res, 200, { ok: false, error: t.text, code: t.code, temporary: Boolean(t.temporary), saveable: Boolean(t.temporary) }), true;
        if (t.ok && t.usedDefault) model = "";
      }
      const vars = { AI_PROVIDER: pv, AI_MODEL: model && model !== info.defaultModel ? model : "", AI_MODEL_ANTHROPIC: model && model !== info.defaultModel ? model : "" };
      if (key) vars.ANTHROPIC_API_KEY = key;
      envfile.setVars(vars);
      try { (await import("./calls/stream-llm.mjs"))._resetFast(); } catch { /* not loaded */ }
      return send(res, 200, { ok: true, ai: aiState() }), true;
    }
    if (!body.skipTest) {
      const t = await withEnv(pv === "ollama" && url ? { OLLAMA_URL: url } : {}, () => llm.test(pv, key || undefined, model || undefined));
      if (!t.ok) return send(res, 200, { ok: false, error: t.error }), true;
    }
    // (a local model's name is always written: the recommended one depends on the computer, not a fixed default)
    const chosen = pv === "ollama" ? model : model && model !== info.defaultModel ? model : "";
    const vars = { AI_PROVIDER: pv, AI_MODEL: chosen, [`AI_MODEL_${pv.toUpperCase()}`]: chosen };
    if (info.keyVar && key) vars[info.keyVar] = key;
    if (pv === "ollama" && url) vars.OLLAMA_URL = url;
    envfile.setVars(vars);
    try { (await import("./calls/stream-llm.mjs"))._resetFast(); } catch { /* not loaded */ }
    if (pv === "ollama") import("./ollama/index.mjs").then((o) => o.startWarm()).catch(() => {});
    return send(res, 200, { ok: true, ai: aiState() }), true;
  }

  // ---- voice ----
  if (p === "/setup/voices" && m === "GET") {
    const pv = str(q.get("provider"), 20);
    if (pv === "openai") return send(res, 200, { voices: voice.OPENAI_VOICES.map((n) => { const N = n[0].toUpperCase() + n.slice(1); return { name: N, id: n, describe: voice.OPENAI_DESCRIBE[N] ?? "" }; }) }), true;
    if (pv === "elevenlabs") {
      const lib = process.env.ELEVENLABS_API_KEY ? await voice.loadLibrary() : {};
      const mine = Object.entries(lib).map(([n, v]) => ({ name: n, id: v.id, describe: v.describe ?? "", mine: true }));
      const built = Object.entries(voice.VOICES).filter(([n]) => !lib[n]).map(([n, id]) => ({ name: n, id, describe: voice.DESCRIBE[n] ?? "" }));
      return send(res, 200, { voices: [...mine, ...built], canList: Object.keys(lib).length > 0 }), true;
    }
    return send(res, 200, { voices: [], browser: true }), true;
  }
  if (p === "/setup/voice/test" && m === "POST") {
    const pv = str(body.provider, 20), key = str(body.key, 400);
    if (!["elevenlabs", "openai"].includes(pv)) return send(res, 400, { error: "browser voices play in the page" }), true;
    const text = str(body.text, 300) || `Hi${owner.get().name ? " " + owner.get().name : ""}! I'm ${owner.assistant()}. This is how I sound.`;
    try {
      const audio = await withEnv({ TTS_PROVIDER: pv, ...(key ? { [pv === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY"]: key } : {}) }, () => voice.tts(text, { voice: str(body.voice, 80) || undefined }));
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": audio.length, "cache-control": "no-store" });
      res.end(audio);
    } catch (e) { send(res, 200, { ok: false, error: String(e.message).replace(/(sk-|xi-)[\w-]+/g, "…") }); }
    return true;
  }
  if (p === "/setup/voice" && m === "POST") {
    const pv = str(body.provider, 20);
    if (!["browser", "elevenlabs", "openai"].includes(pv)) return send(res, 400, { error: "pick a voice type" }), true;
    const vars = { TTS_PROVIDER: pv }, key = str(body.key, 400);
    if (pv === "elevenlabs" && key) vars.ELEVENLABS_API_KEY = key;
    if (pv === "openai" && key) vars.OPENAI_API_KEY = key;
    if (pv === "elevenlabs" && !key && !process.env.ELEVENLABS_API_KEY) return send(res, 400, { error: "Paste your ElevenLabs key first." }), true;
    if (pv === "openai" && !key && !process.env.OPENAI_API_KEY) return send(res, 400, { error: "Paste your OpenAI key first." }), true;
    const sp = {};
    if (pv === "browser" && body.browserVoice !== undefined) sp.browserVoice = str(body.browserVoice, 120) || null;
    if (pv === "openai" && body.voice) sp.openaiVoice = str(body.voice, 20).toLowerCase();
    if (pv === "elevenlabs" && body.voice) {
      // built-in or from their own library: save the name AND the exact voice id, so this is the voice used from now on
      await voice.loadLibrary().catch(() => {});
      const name = str(body.voice, 80), known = voice.voiceChoices().find((n) => n.toLowerCase() === name.toLowerCase());
      sp.voice = known ?? null;
      sp.voiceId = str(body.voiceId, 64) || (known && voice.VOICES[known]) || null;
    }
    if (typeof body.speedAdj === "number") sp.speedAdj = body.speedAdj;
    if (typeof body.volume === "number") sp.volume = body.volume;
    envfile.setVars(vars);
    if (Object.keys(sp).length) settings.set(sp);
    return send(res, 200, { ok: true, voice: voiceState() }), true;
  }

  // ---- sound devices (listing only; choosing uses /api/devices/use and /api/devices/nickname) ----
  if (p === "/setup/devices" && m === "GET") {
    try { const devices = await import("./devices.mjs"); return send(res, 200, { devices: await devices.list({ fresh: q.get("fresh") === "1" }) }), true; }
    catch (e) { return send(res, 200, { devices: [], error: "Couldn't list the sound devices: " + e.message }), true; }
  }

  // ---- features, folders ----
  if (p === "/setup/features" && m === "POST") {
    const patch = {};
    if (body.features && typeof body.features === "object") patch.features = Object.fromEntries(Object.entries(body.features).filter(([k]) => k in owner.DEFAULTS.features).map(([k, v]) => [k, Boolean(v)]));
    if (body.photoDirs !== undefined) patch.photoDirs = list(body.photoDirs, 20).map((x) => str(x, 260));
    if (body.fileRoot !== undefined) patch.fileRoot = str(body.fileRoot, 260);
    return send(res, 200, { owner: owner.set(patch) }), true;
  }

  // ---- your week ----
  if (p === "/setup/schedule" && m === "GET") return send(res, 200, routinesState()), true;
  if (p === "/setup/schedule" && m === "POST") {
    try {
      if (body.fixed) owner.set({ fixed: { categories: list(body.fixed.categories, 8).filter((c) => store.CATEGORIES.includes(c)), titleWords: list(body.fixed.titleWords, 30).map((w) => w.toLowerCase()) } });
      if (body.action === "template") {
        const made = templateRoutines(body.template ?? {});
        if (body.replace) for (const r of store.routines()) store.removeRoutine(r.id);
        for (const r of made) store.addRoutine(r);
        // they told us when they get up: the wake-up alarm rings then (they can say "turn off the alarm" any time)
        if (HM.test(body.template?.wake ?? "")) settings.set({ alarm: true });
      } else if (body.action === "add") {
        const r = body.routine ?? {};
        store.addRoutine({ title: str(r.title, 60) || "Untitled", category: r.category, days: r.days, start: r.start, end: r.end, description: str(r.description, 200) });
      } else if (body.action === "update") {
        const r = body.patch ?? {}, pt = {};
        if (r.title !== undefined) pt.title = str(r.title, 60);
        if (r.category !== undefined && store.CATEGORIES.includes(r.category)) pt.category = r.category;
        if (Array.isArray(r.days)) pt.days = r.days.filter((d) => DAYS.includes(d));
        for (const k of ["start", "end"]) if (HM.test(r[k] ?? "")) pt[k] = r[k];
        if (typeof r.active === "boolean") pt.active = r.active;
        const cur = store.routines().find((x) => x.id === body.id);
        if (cur && (pt.start ?? cur.start) >= (pt.end ?? cur.end)) throw new Error("the start has to be before the end");
        store.updateRoutine(str(body.id, 60), pt);
      } else if (body.action === "remove") store.removeRoutine(str(body.id, 60));
    } catch (e) { return send(res, 400, { error: e.message }), true; }
    return send(res, 200, routinesState()), true;
  }

  // ---- permissions ----
  if (p === "/setup/permissions" && m === "GET") return send(res, 200, permState()), true;
  // what a setting (not saved yet) would allow, in plain words, for the setup screen's summary
  if (p === "/setup/permissions/preview" && m === "POST") return send(res, 200, permissions.explain(permDraft(body))), true;
  // "Keep this setting" on the one-time question for older installs
  if (p === "/setup/permissions/confirm" && m === "POST") { permissions.set({ confirmCurrent: true, via: "confirm" }); return send(res, 200, permState()), true; }
  if (p === "/setup/permissions" && m === "POST") {
    // the new model (files off|custom|all, allAccess, entries, writeConfirm) and the older fields (folders, writeFiles)
    const b = body, patch = {};
    if (["off", "custom", "all", "folders"].includes(b.files)) patch.files = b.files;
    if (["read", "readwrite"].includes(b.allAccess)) patch.allAccess = b.allAccess;
    if (["ask", "on"].includes(b.writeConfirm)) patch.writeConfirm = b.writeConfirm;
    const entry = (e) => ({ path: str(e?.path, 520), kind: e?.kind === "file" ? "file" : e?.kind === "folder" ? "folder" : undefined, access: ["none", "read", "readwrite"].includes(e?.access) ? e.access : "read", subfolders: e?.subfolders !== false });
    if (Array.isArray(b.entries)) patch.entries = b.entries.slice(0, 200).map(entry).filter((e) => e.path);
    if (Array.isArray(b.addEntries)) patch.addEntries = b.addEntries.slice(0, 50).map(entry).filter((e) => e.path);
    if (Array.isArray(b.removePaths)) patch.removePaths = b.removePaths.slice(0, 200).map((x) => str(x, 520)).filter(Boolean);
    if (b.folders !== undefined) patch.folders = list(b.folders, 30).map((x) => str(x, 260));
    if (["ask", "on", "off"].includes(b.writeFiles)) patch.writeFiles = b.writeFiles;
    if (["off", "ask", "on"].includes(b.programs)) patch.programs = b.programs;
    if (typeof b.browser === "boolean") patch.browser = b.browser;
    if (typeof b.web === "boolean") patch.web = b.web;
    Object.assign(patch, permExtras(b));
    // the setup's file-access step (and Settings) send choice: true when the owner picked an option themselves
    if (b.choice === true) { if (!["off", "custom", "all", "folders"].includes(b.files)) return send(res, 400, { error: "Pick one of the file-access options first." }), true; patch.choice = true; }
    permissions.set({ ...patch, via: b.choice ? "setup" : "settings" });
    return send(res, 200, permState()), true;
  }

  // ---- screen ----
  if (p === "/setup/screens" && m === "GET") return send(res, 200, { screens: await screens(), display: owner.display(), displayBrowser: owner.displayBrowser(), openAs: owner.openAs(), overscan: settings.get().overscan ?? 0 }), true;
  // the browsers on this computer (the Windows default first), for "Which browser should Dayspring use?"
  if (p === "/setup/browsers" && m === "GET") {
    const list = await browsers.list({ fresh: q.get("fresh") === "1" });
    return send(res, 200, { browsers: list.map((x) => ({ id: x.id, name: x.name, family: x.family, isDefault: x.isDefault, note: browsers.familyNote(x.family) })), chosen: owner.displayBrowser(), using: (await browsers.resolve(owner.displayBrowser()))?.id ?? null }), true;
  }
  if (p === "/setup/display" && m === "POST") {
    const d = String(body.display ?? "auto");
    const patch = { display: ["auto", "primary", "secondary"].includes(d) || /^\d{1,2}$/.test(d) ? d : "auto" };
    if (body.displayBrowser !== undefined) { const b = String(body.displayBrowser).toLowerCase(); patch.displayBrowser = b === "default" || browsers.KNOWN.some((k) => k.id === b) ? b : "default"; }
    if (body.openAs !== undefined) { const o = String(body.openAs).toLowerCase(); patch.openAs = owner.OPEN_AS.includes(o) ? o : "auto"; }
    if (typeof body.keepScreenOpen === "boolean") patch.keepScreenOpen = body.keepScreenOpen;
    if (typeof body.openOnStartup === "boolean") patch.openOnStartup = body.openOnStartup;
    const screenBefore = owner.display();
    owner.set(patch);
    if (typeof body.overscan === "number") settings.set({ overscan: body.overscan });
    // a different screen chosen while Dayspring is open: it moves there now, not just next time
    let moved = null;
    if (patch.display !== screenBefore && featureOn("screenmove")) moved = await display.moveToScreen(patch.display).catch((e) => ({ ok: false, message: e.message }));
    if (moved) return send(res, 200, { display: owner.display(), displayBrowser: owner.displayBrowser(), openAs: owner.openAs(), keepScreenOpen: owner.get().keepScreenOpen === true, openOnStartup: owner.get().openOnStartup === true, overscan: settings.get().overscan ?? 0, moved }), true;
    return send(res, 200, { display: owner.display(), displayBrowser: owner.displayBrowser(), openAs: owner.openAs(), keepScreenOpen: owner.get().keepScreenOpen === true, openOnStartup: owner.get().openOnStartup === true, overscan: settings.get().overscan ?? 0 }), true;
  }

  // ---- optional keys (YouTube search, Bible versions, ElevenLabs) ----
  if (p === "/setup/keys" && m === "GET") return send(res, 200, { keys: envfile.status() }), true;
  if (p === "/setup/key" && m === "POST") {
    const NAMES = { YOUTUBE: "YOUTUBE_API_KEY", ESV: "ESV_API_KEY", NLT: "NLT_API_KEY", ELEVENLABS: "ELEVENLABS_API_KEY", OPENAI: "OPENAI_API_KEY", ANTHROPIC: "ANTHROPIC_API_KEY", XAI: "XAI_API_KEY", SPOTIFY: "SPOTIFY_CLIENT_ID" };
    const v = NAMES[str(body.name, 20).toUpperCase()];
    if (!v) return send(res, 400, { error: "unknown key" }), true;
    return send(res, 200, { keys: envfile.setVars({ [v]: str(body.value, 400) }) }), true;
  }

  // ---- your Discord bot (optional): token, the owner's user ID, a text channel; saving reconnects the bot ----
  if (p === "/setup/discord") {
    const bot = await import("./discord/bot.mjs");
    if (m === "GET") return send(res, 200, { keys: envfile.status(["DISCORD_BOT_TOKEN", "DISCORD_OWNER_ID", "DISCORD_TEXT_CHANNEL_ID"]), bot: bot.status() }), true;
    if (m === "POST") {
      const id = (v) => { const s = str(v, 30).replace(/\D/g, ""); if (v && !/^\d{15,22}$/.test(s)) throw new Error("A Discord ID is a long number (turn on Developer Mode, then right-click → Copy ID)."); return s; };
      const vars = {};
      if (str(body.token, 200)) vars.DISCORD_BOT_TOKEN = str(body.token, 200);
      if (body.clearToken) vars.DISCORD_BOT_TOKEN = "";
      try { if ("ownerId" in body) vars.DISCORD_OWNER_ID = id(body.ownerId); if ("textChannelId" in body) vars.DISCORD_TEXT_CHANNEL_ID = id(body.textChannelId); }
      catch (e) { return send(res, 400, { error: e.message }), true; }
      envfile.setVars(vars);
      const st = await bot.restart();
      return send(res, 200, { keys: envfile.status(["DISCORD_BOT_TOKEN", "DISCORD_OWNER_ID", "DISCORD_TEXT_CHANNEL_ID"]), bot: st }), true;
    }
  }

  // ---- done ----
  if (p === "/setup/finish" && m === "POST") {
    if (!owner.get().name) return send(res, 400, { error: "Tell me your name first (step 2)." }), true;
    // file access is never left to a default: the owner picks an option (even "No file access") before setup ends
    if (!permissions.get().choiceMade && !owner.get().setupDone) return send(res, 400, { error: "Choose what Dayspring may do with your files first (the Permissions step).", need: "files" }), true;
    return send(res, 200, { owner: owner.set({ setupDone: true }) }), true;
  }
  return false;
}
