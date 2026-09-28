// The step-by-step test checklist (testing/checklist.json) and the owner's results (data/testing.json).
//   checklist item { id, feature, title, steps: [plain-language steps], expected, needs: [hardware/accounts], safety,
//                    stage? (home-control stage 1–5), compat?: [compat entry ids this test proves] }
//   result         { status: pass | fail | skip | blocked, note, at, by }
// A feature can be promoted to stable when every one of its items has passed (lib/features.mjs promote()). The results
// export as Markdown or CSV, so the next release can bake the promotions into lib/features.mjs
// (scripts/promote-features.mjs reads that export).
//   checklist() · results() · setResult(id, { status, note, by }) · progress() → [{ feature, name, total, pass, fail,
//   skip, blocked, untested, canPromote }] · exportMarkdown() · exportCSV() · parseExport(text)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as features from "./features.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = () => process.env.DAYSPRING_TESTING_FILE || join(process.env.DAYSPRING_DATA_DIR || join(DESK, "data"), "testing.json");
export const STATUSES = ["pass", "fail", "skip", "blocked"];
const readJSON = (f, fb) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")) : fb; } catch { return fb; } };

export function checklist() {
  const d = readJSON(features.files.checklist(), { items: [] });
  return { version: d.version ?? 1, updated: d.updated ?? null, intro: d.intro ?? "", items: Array.isArray(d.items) ? d.items : [] };
}
export const results = () => readJSON(RESULTS(), {})?.results ?? {};
function save(r) { const f = RESULTS(); mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify({ results: r }, null, 2) + "\n"); renameSync(tmp, f); }

export function setResult(id, { status, note = "", by = "owner" } = {}) {
  const item = checklist().items.find((t) => t.id === id);
  if (!item) throw new Error(`There's no test "${id}".`);
  const r = results();
  if (status === null || status === "" || status === "clear") delete r[id];
  else {
    if (!STATUSES.includes(status)) throw new Error("status must be pass, fail, skip or blocked");
    r[id] = { status, note: String(note ?? "").slice(0, 2000), at: new Date().toISOString(), by: String(by ?? "owner").slice(0, 80) };
  }
  save(r);
  return { id, result: r[id] ?? null, progress: progress().find((p) => p.feature === item.feature) };
}

export function progress() {
  const items = checklist().items, r = results();
  const out = [];
  for (const f of features.REGISTRY) {
    const mine = items.filter((t) => t.feature === f.id);
    if (!mine.length) continue;
    const n = (s) => mine.filter((t) => r[t.id]?.status === s).length;
    const d = features.describe(f.id);
    const p = { feature: f.id, name: f.name, stage: d.stage, buildStage: f.stage, total: mine.length, pass: n("pass"), fail: n("fail"), skip: n("skip"), blocked: n("blocked") };
    p.untested = p.total - p.pass - p.fail - p.skip - p.blocked;
    p.canPromote = p.pass === p.total && d.stage !== "stable";
    p.verifiedBy = d.verifiedBy; p.verifiedAt = d.verifiedAt;
    out.push(p);
  }
  return out;
}

// Promote a feature whose items have all passed (the Testing page's "Promote to stable")
export function promote(feature, { by = "owner" } = {}) {
  const p = progress().find((x) => x.feature === feature);
  if (!p) throw new Error(`There's no checklist for "${feature}".`);
  if (p.pass !== p.total) throw new Error(`${p.name}: ${p.pass}/${p.total} passed. Every test must pass before it can be promoted.`);
  return features.promote(feature, { stage: "stable", by });
}

const cell = (s) => String(s ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
export function exportMarkdown() {
  const items = checklist().items, r = results(), prog = progress();
  const lines = ["# Dayspring test results", "", `Exported ${new Date().toISOString().slice(0, 10)} · channel: ${features.channelName()}`, "",
    "## Progress", "", "| Feature | id | Stage | Passed | Failed | Skipped | Blocked | Not yet | Ready to promote | Verified by | Verified at |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const p of prog) lines.push(`| ${cell(p.name)} | ${p.feature} | ${p.stage} | ${p.pass}/${p.total} | ${p.fail} | ${p.skip} | ${p.blocked} | ${p.untested} | ${p.canPromote || p.stage === "stable" && p.pass === p.total ? "yes" : "no"} | ${cell(p.verifiedBy ?? "")} | ${cell(p.verifiedAt ?? "")} |`);
  lines.push("", "## Results", "", "| Test | Feature | Title | Result | Date | Note |", "|---|---|---|---|---|---|");
  for (const t of items) { const x = r[t.id]; lines.push(`| ${t.id} | ${t.feature} | ${cell(t.title)} | ${x?.status ?? "not yet"} | ${x?.at?.slice(0, 10) ?? ""} | ${cell(x?.note ?? "")} |`); }
  lines.push("", "<!-- dayspring-test-results v1: scripts/promote-features.mjs reads the Progress table -->", "");
  return lines.join("\n");
}
const csv = (s) => { const v = String(s ?? ""); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
export function exportCSV() {
  const items = checklist().items, r = results();
  const rows = [["test", "feature", "title", "result", "date", "by", "note"]];
  for (const t of items) { const x = r[t.id]; rows.push([t.id, t.feature, t.title, x?.status ?? "", x?.at ?? "", x?.by ?? "", x?.note ?? ""]); }
  return rows.map((row) => row.map(csv).join(",")).join("\r\n") + "\r\n";
}

// Read an export back (Markdown or CSV) → { features: { id: { pass, total, verifiedBy, verifiedAt } } }
export function parseExport(text) {
  const t = String(text ?? "");
  const out = {};
  if (/^test,feature,title,result/m.test(t)) {
    const parseLine = (l) => { const cells = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ",") { cells.push(cur); cur = ""; } else cur += c; } cells.push(cur); return cells; };
    const lines = t.split(/\r?\n/).filter(Boolean).slice(1).map(parseLine);
    for (const [, feature, , result, date, by] of lines) {
      const f = (out[feature] ??= { pass: 0, total: 0, verifiedBy: null, verifiedAt: null });
      f.total++; if (result === "pass") { f.pass++; if (!f.verifiedAt || date > f.verifiedAt) { f.verifiedAt = date; f.verifiedBy = by || "owner"; } }
    }
    return { features: out };
  }
  for (const line of t.split(/\r?\n/)) {
    const m = /^\|\s*[^|]+\|\s*([a-z0-9-]+)\s*\|\s*(stable|beta|dev)\s*\|\s*(\d+)\/(\d+)\s*\|(?:[^|]*\|){5}\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/.exec(line);
    if (m) out[m[1]] = { stage: m[2], pass: Number(m[3]), total: Number(m[4]), verifiedBy: m[5] || null, verifiedAt: m[6] || null };
  }
  return { features: out };
}
