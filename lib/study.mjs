// Study courses: open the next thing to study in a real browser window, and check that it was really done.
//
// The owner's courses and their checklists live in data/learning.json (lib/learning.mjs). How to OPEN and CHECK each
// course lives in data/study.json, so nothing about any particular course is in the code:
//   { "courses": { "<course key>": {
//       "aliases": ["words people use for it"], "forExam": true?,
//       "open":   { "base": "https://site", "home": "/path", "signInPath": "/login", "signInName": "Site name" }
//              or { "file": "C:\\path\\course.html", "url": "https://fallback", "goFn": "Studio.go" },
//       "verify": { "type": "api-progress" | "localstorage" | "none", ... },
//       "items":  { "<item id>": { "path"|"url"|"go": …, "match": { "module": 2 } | { "unit": 1, "lesson": 3 }, "check": {…} } } } } }
// Verifiers:
//   api-progress (a learning site with a progress API the signed-in browser can read):
//     verify.api = "/api/…" (lists modules with status / quiz_best_score / passing_score; "?module_id=" gives sections_read),
//     check: { kind: "sections", moduleId, need } | { kind: "quiz", moduleId } | { kind: "mock", min }
//   localstorage (a course that keeps progress in the browser): verify.key = the localStorage key holding JSON,
//     check: { kind: "all", paths: ["a.b.c", …], names: ["what each path is", …] } | { kind: "min", path, field, min, name }
//   none: the owner confirms it themselves.
// The study window is its own Chrome profile ("DayspringStudy"), opened on the main screen, so sign-ins are remembered
// and Dayspring can read the course's progress. It is never the Dayspring display.
import { createRequire } from "node:module";
import { playwrightChannel } from "./browsers.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as learning from "./learning.mjs";
import { broadcast } from "./bus.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "..", "data", "study.json");
const PROFILE = () => process.env.DAYSPRING_STUDY_PROFILE || join(process.env.LOCALAPPDATA || ".", "DayspringStudy");
const PORT = () => Number(process.env.PORT) || 4747;

// ---------------------------------------------------------------- config
export function config() {
  try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { courses: {} }; } catch { return { courses: {} }; }
}
const courseCfg = (key) => config().courses?.[key] ?? null;
// Add a course by name and web address (the owner confirms lessons themselves unless they set up a checker in study.json).
export function addCourse({ title, url, lessons, count }) {
  const key = learning.addCourse({ title, lessons, count });
  if (url) {
    const u = /^https?:\/\//i.test(url) ? url : "https://" + String(url).replace(/^\/+/, "");
    const c = config(); c.courses ??= {};
    c.courses[key] = { aliases: [String(title).toLowerCase()], open: { url: u }, verify: { type: "none" } };
    writeFileSync(FILE, JSON.stringify(c, null, 2));
  }
  broadcast("refresh", { reason: "study" });
  return { key, title, lessons: learning.items(key).length, url: url ? courseCfg(key)?.open?.url : null };
}
export function setCourseUrl(key, url) {
  const u = /^https?:\/\//i.test(url) ? url : "https://" + String(url).replace(/^\/+/, "");
  const c = config(); c.courses ??= {};
  c.courses[key] = { ...(c.courses[key] ?? { aliases: [String(learning.progress().courses[key]?.title ?? key).toLowerCase()], verify: { type: "none" } }), open: { ...(c.courses[key]?.open ?? {}), url: u } };
  writeFileSync(FILE, JSON.stringify(c, null, 2));
  return true;
}
export function removeCourse(key) {
  learning.removeCourse(key);
  const c = config(); if (c.courses?.[key]) { delete c.courses[key]; writeFileSync(FILE, JSON.stringify(c, null, 2)); }
  broadcast("refresh", { reason: "study" });
  return true;
}
const vtype = (cfg) => cfg?.verify?.type ?? "none";
export function courses() { return Object.keys(learning.progress().courses); }

// Which course does this text mean? Aliases from study.json, then the course title.
export function courseFrom(text) {
  const q = ` ${String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  const titles = learning.progress().courses;
  for (const key of Object.keys(titles)) {
    const words = [...(courseCfg(key)?.aliases ?? []), key];
    if (words.some((w) => w && q.includes(` ${String(w).toLowerCase()} `))) return key;
  }
  for (const [key, c] of Object.entries(titles)) {
    const t = String(c.title ?? "").toLowerCase().replace(/\(.*$/, "").trim();
    if (t && q.includes(t)) return key;
  }
  return null;
}

// ---------------------------------------------------------------- items
export function itemsOf(course) {
  const cfg = courseCfg(course);
  const today = new Date().toLocaleDateString("en-CA");
  const list = learning.items(course);
  const next = list.find((i) => !i.done);
  return list.map((i) => ({
    id: i.id, title: i.title, detail: i.detail, planned: i.planned, done: i.done, doneAt: i.doneAt, note: i.note,
    status: i.done ? "done" : i === next ? "next" : i.planned?.date < today ? "behind" : "upcoming",
    canOpen: Boolean(cfg?.open && (cfg.items?.[i.id]?.path || cfg.items?.[i.id]?.url || cfg.items?.[i.id]?.go || cfg.open.home || cfg.open.file || cfg.open.url)),
    checkable: vtype(cfg) !== "none" && Boolean(cfg?.items?.[i.id]?.check),
  }));
}
export function nextItem(course) { return itemsOf(course).find((i) => !i.done) ?? null; }
const short = (i) => (i ? String(i.title).split(" — ")[0] : "");

// "module 2", "unit 3 lesson 2", "the unit 2 check", "lesson 3" → the items whose match fits.
export function itemsFromText(course, text) {
  const q = String(text).toLowerCase();
  const num = (w) => { const m = new RegExp(`\\b${w}\\s+(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\b`).exec(q); if (!m) return null; const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]; return /\d/.test(m[1]) ? Number(m[1]) : words.indexOf(m[1]); };
  const want = { module: num("module"), unit: num("unit"), lesson: num("lesson"), check: /\bcheck\b|\bunit (test|exam|quiz)\b/.test(q) || null };
  const keys = Object.entries(want).filter(([, v]) => v !== null && v !== false);
  if (!keys.length) return [];
  const cfg = courseCfg(course);
  const all = itemsOf(course);
  // "unit 2" means its lessons; its check only when the check is named
  return all.filter((i) => { const m = cfg?.items?.[i.id]?.match; return m && keys.every(([k, v]) => (k === "check" ? Boolean(m.check) : m[k] === v)) && (want.check || !m.check); });
}

// ---------------------------------------------------------------- the study window
let ctx = null, launching = null, syncTimer = null, lastOpened = null;
const pages = {};
async function context() {
  if (ctx) return ctx;
  if (launching) return launching;
  launching = (async () => {
    const { chromium } = require("playwright-core");
    const headless = process.env.DAYSPRING_STUDY_HEADLESS === "1";
    const c = await chromium.launchPersistentContext(PROFILE(), {
      channel: playwrightChannel(), headless, viewport: headless ? { width: 1300, height: 860 } : null,
      // the main screen (never the Dayspring display), a comfortable reading size
      args: ["--window-size=1400,900", "--window-position=40,40", "--disable-blink-features=AutomationControlled", "--no-first-run", "--disable-session-crashed-bubble"],
      ignoreDefaultArgs: ["--enable-automation", "--disable-component-update"],
    });
    c.on("close", () => { ctx = null; clearInterval(syncTimer); syncTimer = null; for (const k of Object.keys(pages)) delete pages[k]; });
    ctx = c;
    // while it's open, pull verified progress in every few minutes (studying happens there, not here)
    syncTimer = setInterval(() => { sync().catch(() => {}); }, 4 * 60_000);
    return c;
  })();
  try { return await launching; } finally { launching = null; }
}
export const isOpen = () => Boolean(ctx);
async function coursePage(course) {
  const c = await context();
  if (pages[course] && !pages[course].isClosed()) return pages[course];
  const blank = c.pages().find((p) => p.url() === "about:blank" && !Object.values(pages).includes(p));
  const p = blank ?? await c.newPage();
  p.on("close", () => { if (pages[course] === p) delete pages[course]; sync(course).catch(() => {}); });
  pages[course] = p;
  return p;
}
async function toFront(p) {
  await p.bringToFront().catch(() => {});
  try {
    const cdp = await p.context().newCDPSession(p);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await cdp.detach();
  } catch { /* headless or busy */ }
}
export async function close() { if (ctx) await ctx.close().catch(() => {}); ctx = null; }

// The course's own page for an item (or its home page).
function urlFor(course, id) {
  const cfg = courseCfg(course), it = cfg?.items?.[id] ?? {};
  if (!cfg?.open) return null;
  if (it.url) return it.url;
  if (cfg.open.file) return existsSync(cfg.open.file) ? `http://127.0.0.1:${PORT()}/study/course/${encodeURIComponent(course)}` : cfg.open.url ?? null;
  if (cfg.open.base) return cfg.open.base.replace(/\/$/, "") + (it.path ?? cfg.open.home ?? "/");
  return cfg.open.url ?? null;
}
// A course page that keeps its app in a frame (a published artifact) or in the page itself: find the frame that has it.
async function studioFrame(p, globalName, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    for (const f of p.frames()) {
      if (await f.evaluate((g) => Boolean(g.split(".").reduce((o, k) => o?.[k], window)), globalName).catch(() => false)) return f;
    }
    await p.waitForTimeout(400);
  }
  return null;
}

// Open an item (default: the next unfinished one) so the owner can start right away.
export async function open(course, id = null) {
  const cfg = courseCfg(course);
  const item = id ? itemsOf(course).find((i) => i.id === id) : nextItem(course);
  if (!cfg?.open) return { opened: false, say: `I don't know where ${learning.progress().courses[course]?.title ?? "that course"} lives yet. Say "${learning.progress().courses[course]?.title ?? "the course"} is at" and its web address, and I'll open it from then on.` };
  const url = urlFor(course, item?.id);
  if (!url) return { opened: false, say: "That course's page isn't set up yet." };
  const p = await coursePage(course);
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  await toFront(p);
  lastOpened = { course, id: item?.id ?? null, at: Date.now() };
  const it = item ? cfg.items?.[item.id] : null;
  // an app that navigates by function (e.g. a lesson id), not by URL
  if (it?.go && cfg.open.goFn) {
    const f = await studioFrame(p, cfg.open.goFn);
    if (f) await f.evaluate(([fn, target]) => { const parts = fn.split("."); const g = parts.slice(0, -1).reduce((o, k) => o?.[k], window); g?.[parts.at(-1)]?.(target); }, [cfg.open.goFn, it.go]).catch(() => {});
    else if (/claude\.ai/.test(p.url())) return { opened: true, item, url, needsSignIn: true, say: `I opened ${short(item)}. That course needs you signed in to claude.ai in the study window the first time; after that I'll take you straight to the lesson.` };
  }
  await p.waitForTimeout(1200);
  const signIn = cfg.open.signInPath && p.url().includes(cfg.open.signInPath);
  if (signIn) return { opened: true, item, url, needsSignIn: true, say: `I opened ${short(item) || "it"}, but the study window isn't signed in to ${cfg.open.signInName ?? "that site"} yet. Sign in there once and I'll remember it, and I can check your progress after that.` };
  return { opened: true, item, url, say: item ? `Opening ${short(item)}. Have a good session!` : "You're all caught up on that one. I opened the course home." };
}

// ---------------------------------------------------------------- checking
const dig = (o, path) => String(path).split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

async function apiJson(cfg, query = "") {
  const c = await context();
  const url = cfg.open.base.replace(/\/$/, "") + cfg.verify.api + query;
  const r = await c.request.get(url, { timeout: 20_000, failOnStatusCode: false });
  if (r.status() === 401 || r.status() === 403) return { signedOut: true };
  if (!r.ok()) return { error: `the site answered ${r.status()}` };
  try { return { data: await r.json() }; } catch { return { signedOut: true }; }  // a login page instead of JSON
}
async function storageJson(course, cfg) {
  const p = await coursePage(course);
  const url = urlFor(course, null);
  if (!p.url().startsWith(url.split("#")[0]) && !p.frames().some((f) => f.url().startsWith(url))) await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  const f = cfg.open.goFn ? await studioFrame(p, cfg.open.goFn, 12_000) : p.mainFrame();
  if (!f) return { error: "the course page didn't load" };
  const raw = await f.evaluate((k) => { try { return localStorage.getItem(k); } catch { return null; } }, cfg.verify.key).catch(() => null);
  return { data: raw ? JSON.parse(raw) : {} };
}

// The course's saved progress as the study window sees it (localstorage courses; for diagnostics).
export async function peek(course) { const cfg = courseCfg(course); return vtype(cfg) === "localstorage" ? (await storageJson(course, cfg)).data : null; }

// → [{ id, ok: true | false | null, missing?, signedOut? }]
export async function verify(course, ids) {
  const cfg = courseCfg(course);
  const type = vtype(cfg);
  const all = itemsOf(course);
  const targets = ids.map((id) => all.find((i) => i.id === id)).filter(Boolean);    // in the order asked
  if (type === "none" || !cfg) return targets.map((i) => ({ id: i.id, ok: null, missing: "this course doesn't report its progress, so I can't check it" }));
  const out = [];
  if (type === "api-progress") {
    const list = await apiJson(cfg);
    if (list.signedOut) return targets.map((i) => ({ id: i.id, ok: null, signedOut: true, missing: `the study window isn't signed in to ${cfg.open.signInName ?? "the course site"}` }));
    if (list.error) return targets.map((i) => ({ id: i.id, ok: null, missing: list.error }));
    const mods = list.data.modules ?? [], stats = list.data.stats ?? {};
    const detail = {};
    for (const i of targets) {
      const ch = cfg.items?.[i.id]?.check;
      if (!ch) { out.push({ id: i.id, ok: null, missing: "there's nothing on the site to check for this one" }); continue; }
      const mod = mods.find((m) => m.id === ch.moduleId);
      if (ch.kind === "quiz") {
        const pass = mod?.passing_score ?? 70, best = mod?.quiz_best_score ?? 0;
        const ok = mod?.status === "completed" || best >= pass;
        out.push({ id: i.id, ok, missing: ok ? null : mod?.quiz_attempts_count ? `the Module ${mod.module_number} quiz isn't passed yet (best ${best}%, you need ${pass}%)` : `the Module ${mod?.module_number ?? ""} quiz hasn't been taken yet`.replace("  ", " "), detail: mod ? `Module ${mod.module_number} quiz: best ${best}%` : null });
      } else if (ch.kind === "sections") {
        if (!detail[ch.moduleId]) detail[ch.moduleId] = await apiJson(cfg, `?module_id=${encodeURIComponent(ch.moduleId)}`);
        const d = detail[ch.moduleId];
        if (d.signedOut || d.error) { out.push({ id: i.id, ok: null, missing: d.error ?? "not signed in" }); continue; }
        const TABS = cfg.verify.sections ?? ["overview", "concepts", "formulas", "examples", "tips"];
        const read = (d.data.sections_read ?? []).filter((s) => TABS.includes(s));
        const ok = read.length >= (ch.need ?? TABS.length) || mod?.status === "completed";
        const unread = TABS.filter((s) => !read.includes(s));
        out.push({ id: i.id, ok, missing: ok ? null : `Module ${mod?.module_number ?? ""} shows ${read.length} of ${ch.need ?? TABS.length} sections read so far (still unopened: ${unread.map((s) => s[0].toUpperCase() + s.slice(1)).join(", ")})`, detail: `${read.length} sections read` });
      } else if (ch.kind === "mock") {
        const n = stats.mock_exams_taken ?? (list.data.mock_attempts ?? []).length;
        const ok = n >= (ch.min ?? 1);
        out.push({ id: i.id, ok, missing: ok ? null : `I only see ${n} practice exam${n === 1 ? "" : "s"} finished on the site (this one needs ${ch.min ?? 1})`, detail: `${n} practice exams` });
      } else out.push({ id: i.id, ok: null, missing: "I don't know how to check this one" });
    }
    return out;
  }
  if (type === "localstorage") {
    const s = await storageJson(course, cfg).catch((e) => ({ error: e.message }));
    if (s.error) return targets.map((i) => ({ id: i.id, ok: null, missing: s.error }));
    for (const i of targets) {
      const ch = cfg.items?.[i.id]?.check;
      if (!ch) { out.push({ id: i.id, ok: null, missing: "there's nothing in the course to check for this one" }); continue; }
      if (ch.kind === "all") {
        const bad = ch.paths.map((path, k) => (dig(s.data, path) ? null : ch.names?.[k] ?? path)).filter(Boolean);
        out.push({ id: i.id, ok: !bad.length, missing: bad.length ? bad.join("; ") : null });
      } else if (ch.kind === "min") {
        const v = dig(s.data, ch.path);
        const best = Array.isArray(v) ? Math.max(-1, ...v.map((a) => Number(ch.field ? a?.[ch.field] : a) || 0)) : Number(ch.field ? v?.[ch.field] : v);
        const ok = best >= ch.min;
        out.push({ id: i.id, ok, missing: ok ? null : best < 0 || Number.isNaN(best) ? `${ch.name ?? "it"} hasn't been taken yet` : `${ch.name ?? "it"} is at ${best}% (the pass mark is ${ch.min}%)`, detail: best >= 0 ? `best ${best}%` : null });
      } else out.push({ id: i.id, ok: null, missing: "I don't know how to check this one" });
    }
    return out;
  }
  return targets.map((i) => ({ id: i.id, ok: null, missing: "unknown checker" }));
}

// Check, and mark done only what really is. force: the owner says so (recorded as not checked).
export async function finish(course, ids, { force = false } = {}) {
  if (!ids.length) return { checked: [], marked: [] };
  let checked;
  // a course that can't report its progress (like one the owner added by voice) is checked off on their word
  const onWord = !force && vtype(courseCfg(course)) === "none";
  if (force) checked = ids.map((id) => ({ id, ok: true, forced: true }));
  else if (onWord) checked = ids.map((id) => ({ id, ok: true, onWord: true }));
  else checked = await verify(course, ids);
  const good = checked.filter((c) => c.ok).map((c) => c.id);
  if (good.length) {
    learning.mark({ course, ids: good, done: true, note: force || onWord ? "marked done by the owner (not checked)" : `checked on ${new Date().toLocaleDateString("en-CA")}` });
    broadcast("refresh", { reason: "study" });
  }
  return { checked, marked: good };
}

// Pull verified progress in for every unfinished item (courses that can be checked, only while it's cheap: window open).
let syncing = null;
export async function sync(only = null) {
  if (syncing) return syncing;
  syncing = (async () => {
    const res = {};
    for (const course of courses()) {
      if (only && course !== only) continue;
      const cfg = courseCfg(course);
      if (vtype(cfg) === "none") continue;
      if (!ctx) continue;                         // never pop a window open just to sync
      const open = itemsOf(course).filter((i) => !i.done && i.checkable).map((i) => i.id);
      if (!open.length) continue;
      const r = await finish(course, open).catch(() => ({ marked: [] }));
      if (r.marked.length) res[course] = r.marked;
    }
    return res;
  })();
  try { return await syncing; } finally { syncing = null; }
}

// What the owner is most likely talking about when they say "I finished it": the item they last opened, else the next one.
export function lastTarget() { return lastOpened && Date.now() - lastOpened.at < 12 * 3600_000 ? lastOpened : null; }

// Put a course's saved progress (its own backup text) into the study window, e.g. progress made in another browser.
export async function importBackup(course, text) {
  const cfg = courseCfg(course);
  const allowed = cfg?.verify?.importKeys ?? [];
  if (!allowed.length) return { ok: false, say: "That course doesn't have a progress backup I can bring in." };
  let data; try { data = JSON.parse(text); } catch { return { ok: false, say: "That doesn't look like the course's backup text. Copy all of it and paste it again." }; }
  const keys = Object.fromEntries(Object.entries(data?.keys ?? {}).filter(([k, v]) => allowed.includes(k) && typeof v === "string"));
  if (!Object.keys(keys).length) return { ok: false, say: "I couldn't find any course progress in that backup." };
  const p = await coursePage(course);
  const url = urlFor(course, null);
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  const f = cfg.open.goFn ? await studioFrame(p, cfg.open.goFn) : p.mainFrame();
  if (!f) return { ok: false, say: "The course page didn't load in the study window." };
  await f.evaluate((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, keys);
  await p.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  const r = await sync(course).catch(() => ({}));
  return { ok: true, say: `Brought your progress in${r[course]?.length ? `, and ${r[course].length} item${r[course].length > 1 ? "s" : ""} checked out as done` : ""}.` };
}

// The local course file, served to the study window (so a course that keeps progress in the browser needs no sign-in).
export function courseFile(course) { const f = courseCfg(course)?.open?.file; return f && existsSync(f) ? f : null; }

// ---------------------------------------------------------------- wording
export function describeNext(course) {
  const n = nextItem(course);
  const c = learning.progress().courses[course];
  const name = String(c?.title ?? course).replace(/\s*\(.*$/, "");
  if (!n) return `You've finished everything in ${name}. Well done!`;
  const behind = itemsOf(course).filter((i) => i.status === "behind").length;
  return `Next in ${name}: ${short(n)}.${behind > 1 ? ` You're ${behind} sessions behind, so this is the one to catch up on.` : ""}`;
}
export function state() {
  const p = learning.progress();
  const cfgs = config().courses ?? {};
  const out = { open: isOpen(), exam: p.exam, examCourse: Object.keys(p.courses).find((k) => cfgs[k]?.forExam) ?? Object.keys(p.courses)[0] ?? null, courses: {} };
  for (const [key, c] of Object.entries(p.courses)) {
    out.courses[key] = { title: c.title, done: c.done, total: c.total, percent: c.percent, behind: c.behind, next: c.next,
      checker: vtype(cfgs[key]), canImport: Boolean(cfgs[key]?.verify?.importKeys?.length), signInName: cfgs[key]?.open?.signInName ?? null,
      items: itemsOf(key).map(({ id, title, status, planned, canOpen, checkable }) => ({ id, title, status, date: planned?.date, canOpen, checkable })) };
  }
  return out;
}
