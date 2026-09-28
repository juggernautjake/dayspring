// Watching a print (any brand with a camera): a picture every N minutes (default 10), looked at for failures and
// stringing, kept in data/prints/<printer>/<job>/ until the print is over. Then, as the owner asked:
//   · a good print (it finished, no alerts, and, if he wants to be asked, he said it came out fine): the pictures are
//     deleted (or turned into one timelapse video first, when "always keep a timelapse" is on)
//   · anything else (failed, stopped, or an alert along the way): the pictures stay, with a short report
// On a likely failure: a floor-respecting announcement ("Printer 3 looks like it's making spaghetti. Want me to pause
// it?"), a card with the picture on every screen, and (if he turned it on) a text. It pauses by itself only when
// "auto-pause" is on (off by default). It NEVER stops a print by itself.
import { existsSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { analyzeFrame, WORDS } from "./vision/analyze.mjs";
import * as store from "./store.mjs";

let deps = {
  announce: () => {}, broadcast: () => {}, notify: async () => {}, activity: () => {},
  snapshotWatch: null,                 // (printer, { everyMs, analyze, onFrame }) → { stop, runNow }  (camera-bridge.watch)
  ai: null,                            // (printer) → null | ({ prompt, image }) → text
  statusOf: () => ({}), pause: async () => {}, reference: () => null, askPause: () => null, ffmpeg: null,
};
export function setDeps(d) { deps = { ...deps, ...d }; }
const jobs = new Map();   // printer id → job
export const current = (id) => jobs.get(id) ?? null;
export const all = () => [...jobs.values()].map(publicJob);
const pad = (n, w = 3) => String(n).padStart(w, "0");
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
const safeName = (s) => String(s ?? "print").replace(/\.(gcode\.)?3mf$|\.gcode$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 40) || "print";
export const jobDir = (printerId, jobId) => join(store.PRINTS_DIR(), printerId.replace(/[^\w-]/g, "_"), jobId);
export function publicJob(j) { return j && { id: j.id, printer: j.printer, name: j.name, started: j.started, ended: j.ended ?? null, result: j.result ?? null, frames: j.frames.length, alerts: j.alerts, state: j.state, dir: j.dir, lastFrame: j.frames.at(-1)?.file ?? null, awaiting: Boolean(j.awaiting) }; }

export async function begin(printer, { name } = {}) {
  if (jobs.get(printer.id)?.state === "watching") return jobs.get(printer.id);
  const id = `${stamp()}-${safeName(name)}`;
  const dir = jobDir(printer.id, id);
  mkdirSync(dir, { recursive: true });
  const job = { id, printer: printer.id, name: name ?? "print", started: new Date().toISOString(), dir, frames: [], alerts: [], history: [], prev: null, state: "watching", paused: false };
  jobs.set(printer.id, job);
  writeFileSync(join(dir, "job.json"), JSON.stringify({ printer: printer.id, printerName: printer.name, name: job.name, started: job.started }, null, 2));
  deps.activity("printer.job", { printer: printer.id, job: id, event: "watching" });
  if (deps.snapshotWatch) {
    try {
      job.watch = await deps.snapshotWatch(printer, { everyMs: Math.max(1, printer.options?.snapshotMinutes ?? 10) * 60_000, analyze: (jpeg) => onPicture(printer, job, jpeg), onFrame: () => {} });
    } catch (e) { job.watchError = e.message; }
  }
  deps.broadcast("printers", { job: publicJob(job) });
  return job;
}
// one picture: saved, looked at, maybe an alert
export async function onPicture(printer, job, jpeg) {
  if (!jpeg || job.state !== "watching") return { keep: false };
  const n = job.frames.length + 1, file = `snap-${pad(n)}.jpg`;
  writeFileSync(join(job.dir, file), jpeg);
  const p = store.get(printer.id) ?? printer;
  const status = deps.statusOf(p.id) ?? {};
  const aiFn = deps.ai ? deps.ai(p) : null;
  const a = await analyzeFrame({ frame: jpeg, prev: job.prev, reference: deps.reference(p), roi: p.bed?.roi ?? null, status, history: job.history, ai: aiFn, sensitivity: p.options?.sensitivity ?? 0.6 });
  job.prev = jpeg;
  const rec = { n, file, at: new Date().toISOString(), progress: status.progress ?? null, layer: status.layer ?? null, score: a.score, verdict: a.verdict, guess: a.topGuess, reasons: a.reasons.slice(0, 4).map((r) => `${r.verdict} ${r.score}: ${r.why}`), local: a.local, ai: a.ai };
  job.frames.push(rec); job.history.push({ local: a.local }); if (job.history.length > 40) job.history.shift();
  appendFileSync(join(job.dir, "analysis.jsonl"), JSON.stringify(rec) + "\n");
  if (a.alert) await alert(p, job, a, file);
  deps.broadcast("printers", { job: publicJob(job), frame: { printer: p.id, file, score: a.score, verdict: a.verdict } });
  return { keep: false, labels: a.alert ? [{ label: a.verdict, confidence: a.score }] : [], summary: a.alert ? WORDS[a.verdict] : "" };
}
async function alert(p, job, a, file) {
  // the same problem again within half an hour isn't a new announcement (the pictures still show it)
  const lastSame = [...job.alerts].reverse().find((x) => x.verdict === a.verdict);
  const repeat = lastSame && Date.now() - Date.parse(lastSame.at) < 30 * 60_000;
  const entry = { at: new Date().toISOString(), verdict: a.verdict, severity: a.severity, score: a.score, file, why: a.reasons[0]?.why ?? "" };
  job.alerts.push(entry);
  writeReport(p, job, "in progress");
  deps.activity("printer.alert", { printer: p.id, job: job.id, verdict: a.verdict, score: a.score });
  if (repeat) return;
  const what = WORDS[a.verdict] ?? a.verdict;
  const image = `/api/printers/${encodeURIComponent(p.id)}/jobs/${encodeURIComponent(job.id)}/${file}`;
  let text;
  if (p.options?.autoPause && a.severity === "failure") {
    const r = await deps.pause(p.id).then(() => true, (e) => e.message);
    text = r === true ? `${p.name} looks like it's failing: ${what}. I paused it, as you asked me to. Take a look.` : `${p.name} looks like it's failing: ${what}. I tried to pause it but couldn't (${r}).`;
    job.paused = r === true;
  } else {
    deps.askPause?.(p.id, job.id);
    text = `${p.name} ${a.severity === "warning" ? "might have a problem" : "looks like it's failing"}: ${what}. Want me to pause it?`;
  }
  deps.announce({ kind: "printer", text, ask: !job.paused, printer: p.id, image, severity: a.severity });
  deps.broadcast("printer-alert", { printer: p.id, name: p.name, job: job.id, verdict: a.verdict, severity: a.severity, score: a.score, text, image });
  if (p.options?.textOnFailure && a.severity === "failure") deps.notify(`${text.replace(/ Want me to pause it\?$/, "")} (Dayspring)`).catch(() => {});
}
function writeReport(p, job, result) {
  const lines = [`Print: ${job.name}`, `Printer: ${p.name} (${p.brand ?? ""} ${p.model ?? ""})`, `Started: ${job.started}`, `Ended: ${job.ended ?? "-"}`, `Result: ${result}`, `Pictures: ${job.frames.length}`, "", "Alerts:",
    ...(job.alerts.length ? job.alerts.map((a) => `  ${a.at}  ${a.verdict} (${Math.round(a.score * 100)}%)  ${a.file}  ${a.why}`) : ["  none"]), "", "Every picture:",
    ...job.frames.map((f) => `  ${f.file}  ${f.at}  ${f.progress ?? "?"}%  score ${f.score}  ${f.guess}`)];
  writeFileSync(join(job.dir, "report.txt"), lines.join("\r\n"));
  writeFileSync(join(job.dir, "report.json"), JSON.stringify({ ...publicJob(job), result, alertsDetail: job.alerts, frames: job.frames }, null, 2));
}
// the print is over: result "finished" | "failed" | "stopped"
export async function end(printerId, result) {
  const job = jobs.get(printerId);
  if (!job || job.state !== "watching") return null;
  job.watch?.stop?.();
  deps.clearAsk?.(printerId);   // "want me to pause it?" is moot now
  job.ended = new Date().toISOString(); job.result = result; job.state = "ended";
  const p = store.get(printerId) ?? { id: printerId, name: printerId, options: {} };
  const good = result === "finished" && !job.alerts.length;
  deps.activity("printer.job", { printer: printerId, job: job.id, event: "ended", result, alerts: job.alerts.length });
  if (good && p.options?.confirmGood) {
    job.awaiting = true; job.state = "awaiting";
    deps.announce({ kind: "printer", ask: true, text: `${p.name} finished ${job.name}. Did it come out okay? If so I'll clear its pictures.`, printer: p.id });
    deps.broadcast("printers", { job: publicJob(job) });
    return { job: publicJob(job), awaiting: true };
  }
  return good ? finishGood(p, job) : keepBad(p, job, result);
}
// his answer to "Did it come out okay?"
export async function confirmResult(printerId, good) {
  const job = jobs.get(printerId);
  if (!job?.awaiting) return null;
  job.awaiting = false;
  const p = store.get(printerId) ?? { id: printerId, name: printerId, options: {} };
  if (good) return finishGood(p, job);
  job.alerts.push({ at: new Date().toISOString(), verdict: "owner", severity: "failure", score: 1, why: "The owner said it didn't come out right." });
  return keepBad(p, job, "not good (owner)");
}
async function finishGood(p, job) {
  let kept = null;
  if (p.options?.keepTimelapse && job.frames.length >= 2) kept = await timelapse(job).catch(() => null);
  if (kept) { for (const f of readdirSync(job.dir)) if (f !== "timelapse.mp4") rmSync(join(job.dir, f), { force: true }); writeFileSync(join(job.dir, "job.json"), JSON.stringify({ printer: p.id, name: job.name, started: job.started, ended: job.ended, result: "good", timelapse: "timelapse.mp4" }, null, 2)); }
  else rmSync(job.dir, { recursive: true, force: true });
  job.state = "done"; job.deleted = !kept;
  deps.activity("printer.job", { printer: p.id, job: job.id, event: kept ? "kept timelapse" : "pictures deleted (good print)" });
  deps.broadcast("printers", { job: publicJob(job) });
  jobs.delete(p.id);
  return { job: publicJob(job), deleted: !kept, timelapse: kept };
}
function keepBad(p, job, result) {
  writeReport(p, job, result);
  job.state = "done";
  deps.broadcast("printers", { job: publicJob(job) });
  jobs.delete(p.id);
  return { job: publicJob(job), kept: true, report: join(job.dir, "report.txt") };
}
function timelapse(job) {
  const ff = deps.ffmpeg;
  if (!ff) return Promise.resolve(null);
  return new Promise((resolve) => {
    const c = spawn(ff, ["-loglevel", "error", "-y", "-framerate", "4", "-i", join(job.dir, "snap-%03d.jpg"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-c:v", "libx264", join(job.dir, "timelapse.mp4")], { windowsHide: true });
    c.on("close", (code) => resolve(code === 0 && existsSync(join(job.dir, "timelapse.mp4")) ? "timelapse.mp4" : null));
    c.on("error", () => resolve(null));
  });
}
// kept folders (failed prints, timelapses) go after the printer's retention days
export function prune(now = Date.now()) {
  let removed = 0;
  const root = store.PRINTS_DIR();
  let printers = []; try { printers = readdirSync(root).filter((d) => d !== "_bed"); } catch { return 0; }
  for (const pd of printers) {
    const p = store.get(pd); const days = p?.options?.retentionDays ?? 30;
    let dirs = []; try { dirs = readdirSync(join(root, pd)); } catch { continue; }
    for (const d of dirs) {
      if (jobs.get(pd)?.id === d) continue;
      try { if (now - statSync(join(root, pd, d)).mtimeMs > days * 86400_000) { rmSync(join(root, pd, d), { recursive: true, force: true }); removed++; } } catch { /* in use */ }
    }
  }
  return removed;
}
// past jobs on disk (kept ones)
export function history(printerId) {
  const dir = join(store.PRINTS_DIR(), printerId.replace(/[^\w-]/g, "_"));
  let ds = []; try { ds = readdirSync(dir); } catch { return []; }
  return ds.sort().reverse().slice(0, 30).map((d) => { let r = null; try { r = JSON.parse(readFileSync(join(dir, d, "report.json"), "utf8")); } catch { try { r = JSON.parse(readFileSync(join(dir, d, "job.json"), "utf8")); } catch { /* none */ } } return { id: d, ...(r ?? {}), files: (() => { try { return readdirSync(join(dir, d)).filter((f) => /\.(jpg|mp4)$/.test(f)); } catch { return []; } })() }; });
}
export function _reset() { for (const j of jobs.values()) j.watch?.stop?.(); jobs.clear(); }
