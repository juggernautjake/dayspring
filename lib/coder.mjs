// Working on Dayspring (or writing things) by voice, through Claude Code — the same agent the owner uses in the terminal.
//   "Dayspring, add a countdown for Sam's birthday to the screen" → read back → "yes" → the code is backed up → Claude Code
//   (claude -p, headless) makes the change inside the Dayspring folder and runs the audit → Dayspring says what changed and
//   offers to restart so it shows up. "Also make it gold" continues the same session; "stop" ends it.
// Guard rails: it works only inside the Dayspring project, edits are allowed but shell commands are limited to node,
// .env and secrets are off limits, and every run starts with a backup of the code (backups/dayspring-code/<time>).
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import * as owner from "./owner.mjs";
import * as cliTools from "./cli-tools.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
// the Dayspring project folder: the app is either at its root (the shared repo) or in apps/desk (a monorepo checkout)
const NESTED = basename(DESK) === "desk" && basename(dirname(DESK)) === "apps";
const PROJECT = NESTED ? join(DESK, "..", "..") : DESK;
const APP_REL = NESTED ? "apps/desk" : ".";
const inApp = (p) => (NESTED ? `${APP_REL}/${p}` : p);
const BACKUPS = join(PROJECT, "backups", "dayspring-code");
const PROMPT_FILE = join(DESK, "data", "coder-prompt.txt");
const SYSTEM = () => `You are Claude Code, started by ${owner.assistant()}, ${owner.name()}'s voice assistant on the Dayspring screen. ${owner.name()} asked for this out loud, so:
- The project is Dayspring (${PROJECT}); the app is ${NESTED ? APP_REL : "the project folder itself"} (Node, ESM; server.mjs, lib/*.mjs, public/tv.html + tv.js). docs/ (when it has requirements.md) lists everything ${owner.they()} ${owner.they() === "they" ? "have" : "has"} asked for; keep it up to date when you add something.
- Make the change ${owner.they()} asked for, matching the surrounding code's style and comment density.
- Never read, print or change .env or any key or secret. Never delete ${owner.their()} data (${inApp("data")}). Don't install software.
- After code changes run: node --check on changed files, then "node scripts/audit.mjs" from ${NESTED ? APP_REL : "the project folder"}, and fix anything you broke.
- Your final message is read aloud on the Dayspring screen: 1–3 short, plain sentences saying what you changed (no markdown, no file paths unless they matter), and whether Dayspring needs a restart.`;

let run = null;          // { child, task, session, started, log: [], status, tool }
let lastSession = null, lastAt = 0, lastTool = null;
// Claude Code or Codex (cli-tools.coderTool(): the owner's choice, else the one matching the AI brain, else whichever is installed)
const LABEL = { claude: "Claude Code", codex: "Codex" };
export const toolLabel = () => LABEL[cliTools.coderTool()] ?? "the coding tool";
const listeners = [];
export function onEvent(fn) { listeners.push(fn); }
const emit = (e) => { for (const fn of listeners) { try { fn(e); } catch { /* a listener must not break the run */ } } };

export const isRunning = () => Boolean(run);
export function status() {
  if (!run) return lastAt ? { running: false, last: lastAt } : { running: false };
  return { running: true, task: run.task, seconds: Math.round((Date.now() - run.started) / 1000), doing: run.log.slice(-3) };
}

function backup() {
  const dest = join(BACKUPS, new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dest, { recursive: true });
  const parts = [...["lib", "public", "scripts", "server.mjs", "ds.mjs", "package.json", "docs"].map(inApp), "docs", "Start Dayspring.cmd", "Start Dayspring TV.cmd"];
  for (const p of [...new Set(parts)]) {
    const src = join(PROJECT, p);
    if (existsSync(src)) cpSync(src, join(dest, p), { recursive: true });
  }
  return dest;
}

// Start (or continue) a task. continueLast: pick up the previous session ("also make it gold").
export function start(task, { continueLast = false } = {}) {
  const tool = cliTools.coderTool();
  if (!tool) return { ok: false, why: "No AI coding tool is installed yet. You can add Claude Code or Codex in Settings, under Apps and tools." };
  if (run) return { ok: false, why: `${LABEL[run.tool] ?? "The coding tool"} is still working on the last thing.` };
  if (tool === "codex") return startCodex(task, { continueLast });
  const saved = backup();
  writeFileSync(PROMPT_FILE, SYSTEM());
  const args = ["/d", "/s", "/c", "claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
    "--allowedTools", "Read,Edit,Write,Glob,Grep,Bash(node:*)", "--append-system-prompt-file", PROMPT_FILE];
  if (continueLast && lastSession && Date.now() - lastAt < 60 * 60_000) args.push("--resume", lastSession);
  const child = spawn("cmd.exe", args, { cwd: PROJECT, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  run = { child, task, session: null, started: Date.now(), log: [], backup: saved, tool: "claude" };
  child.stdin.end(task);                      // the task goes in on stdin, so nothing the owner says is ever parsed by a shell
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.session_id) run && (run.session = ev.session_id);
      if (ev.type === "assistant") for (const c of ev.message?.content ?? []) {
        if (c.type === "tool_use") {
          const f = c.input?.file_path ?? c.input?.path ?? c.input?.pattern ?? c.input?.command ?? "";
          const what = { Read: "Reading", Edit: "Editing", Write: "Writing", Glob: "Looking for", Grep: "Searching", Bash: "Running" }[c.name] ?? c.name;
          const short = String(f).replace(/\\/g, "/").split("/").slice(-2).join("/").slice(0, 60);
          run.log.push(`${what} ${short}`.trim()); emit({ kind: "progress", text: `${what} ${short}`.trim() });
        }
      }
      if (ev.type === "result") finish(ev.is_error ? null : ev.result, ev.is_error ? String(ev.result ?? "it hit an error") : null);
    }
  });
  let err = "";
  child.stderr.on("data", (d) => { err += d; });
  child.on("exit", (code) => { if (run) finish(null, code === 0 ? "it stopped without a summary" : (err.trim().split("\n").pop() || `it exited (${code})`)); });
  emit({ kind: "started", text: task });
  return { ok: true, backup: saved };
}
function startCodex(task, { continueLast = false } = {}) {
  const saved = backup();
  const rules = SYSTEM().replace(/^You are Claude Code/, "You are Codex");
  const resume = continueLast && lastTool === "codex" && lastSession && Date.now() - lastAt < 60 * 60_000;
  const args = ["/d", "/s", "/c", "codex", "exec", "--json", "--sandbox", "workspace-write", "-C", PROJECT, ...(resume ? ["resume", lastSession] : []), "-"];
  const child = spawn("cmd.exe", args, { cwd: PROJECT, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  run = { child, task, session: null, started: Date.now(), log: [], backup: saved, tool: "codex", last: "" };
  child.stdin.end(`${resume ? "" : rules + "\n\n"}The task:\n${task}`);   // stdin: nothing the owner says is parsed by a shell
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line || !run) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === "thread.started" && ev.thread_id) run.session = ev.thread_id;
      const it = ev.item ?? {};
      if (ev.type === "item.completed" || ev.type === "item.started") {
        if (it.type === "agent_message" && it.text) run.last = it.text;
        const what = it.type === "file_change" ? `Editing ${(it.changes ?? []).map((c) => String(c.path ?? "").replace(/\\/g, "/").split("/").slice(-2).join("/")).join(", ").slice(0, 60)}`
          : it.type === "command_execution" ? `Running ${String(it.command ?? "").slice(0, 60)}` : null;
        if (what && ev.type === "item.completed") { run.log.push(what.trim()); emit({ kind: "progress", text: what.trim() }); }
      }
      if (ev.type === "turn.completed") finish(run.last || "Done.", null);
      if (ev.type === "turn.failed" || ev.type === "error") finish(null, String(ev.error?.message ?? ev.message ?? "it hit an error"));
    }
  });
  let err = "";
  child.stderr.on("data", (d) => { err += d; });
  child.on("exit", (code) => { if (run) finish(run.last || null, run.last ? null : code === 0 ? "it stopped without a summary" : (err.trim().split("\n").pop() || `it exited (${code})`)); });
  emit({ kind: "started", text: task, tool: "codex" });
  return { ok: true, backup: saved, tool: "codex" };
}
function finish(result, error) {
  if (!run) return;
  lastSession = run.session ?? lastSession; lastAt = Date.now(); lastTool = run.tool ?? lastTool;
  const edited = run.log.some((l) => /^(Editing|Writing)/.test(l));
  const r = { kind: "done", edited, ok: !error, text: error ? `${LABEL[run.tool] ?? "The coding tool"} couldn't finish: ${error}` : String(result ?? "").trim() || "Done.", task: run.task, backup: run.backup, seconds: Math.round((Date.now() - run.started) / 1000) };
  run = null;
  emit(r);
}
export function stop() { if (!run) return false; try { spawn("taskkill", ["/pid", String(run.child.pid), "/t", "/f"], { windowsHide: true }); } catch { /* gone */ } finish(null, "you stopped it"); return true; }
export const canContinue = () => Boolean(lastSession && Date.now() - lastAt < 60 * 60_000);
