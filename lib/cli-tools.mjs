// The AI coding tools Dayspring can work through ("Dayspring, add a button that…", fixing things, automation):
//   Claude Code (Anthropic) and Codex (OpenAI). Either works with any AI brain; the setup suggests the one that matches it
//   (Claude → Claude Code, ChatGPT/OpenAI → Codex; Grok and Ollama have no official one, so either, or none).
// What this does: tells whether each is installed and signed in, installs it the official way (no admin needed), and opens
// the sign-in in a terminal window the owner can see. Official methods (checked Sept 2026):
//   Claude Code: PowerShell `irm https://claude.ai/install.ps1 | iex` · `winget install Anthropic.ClaudeCode` · npm @anthropic-ai/claude-code
//                sign in: run `claude` (browser sign-in; needs Pro/Max/Team/Enterprise or a Console account with credit)
//   Codex:       PowerShell `irm https://chatgpt.com/codex/install.ps1 | iex` · npm @openai/codex
//                sign in: `codex login` (Sign in with ChatGPT: Plus/Pro/Business…) or an OpenAI API key
// The choice of which one voice coding uses lives in data/cli-tools.json ({ coder: "auto" | "claude" | "codex" }).
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const PREF = join(DATA, "cli-tools.json");
const H = homedir();

export const TOOLS = {
  claude: {
    id: "claude", label: "Claude Code", maker: "Anthropic", provider: "anthropic", cmd: "claude",
    docs: "https://code.claude.com/docs/en/setup",
    methods: {
      powershell: { label: "Official installer (recommended)", shell: "powershell", command: "irm https://claude.ai/install.ps1 | iex" },
      winget: { label: "WinGet", shell: "powershell", command: "winget install --id Anthropic.ClaudeCode -e --accept-source-agreements --accept-package-agreements" },
      npm: { label: "npm", shell: "cmd", command: "npm install -g @anthropic-ai/claude-code" },
    },
    exeGuesses: [join(H, ".local", "bin", "claude.exe"), join(process.env.APPDATA ?? "", "npm", "claude.cmd")],
    authFiles: [join(H, ".claude", ".credentials.json")], apiKeyVar: "ANTHROPIC_API_KEY",
    login: { command: "claude", text: "A terminal window opens and runs Claude Code. The first time, it opens your browser: sign in with your Claude account (Pro or Max) or your Anthropic Console account, and approve. Then close the terminal." },
    needs: "A Claude Pro or Max plan, or an Anthropic Console account with credit. The free Claude plan doesn't include Claude Code.",
  },
  codex: {
    id: "codex", label: "Codex", maker: "OpenAI", provider: "openai", cmd: "codex",
    docs: "https://github.com/openai/codex",
    methods: {
      powershell: { label: "Official installer (recommended)", shell: "powershell", command: "irm https://chatgpt.com/codex/install.ps1 | iex" },
      npm: { label: "npm", shell: "cmd", command: "npm install -g @openai/codex" },
    },
    exeGuesses: [join(H, ".local", "bin", "codex.exe"), join(process.env.APPDATA ?? "", "npm", "codex.cmd")],
    authFiles: [join(H, ".codex", "auth.json")], apiKeyVar: "OPENAI_API_KEY",
    login: { command: "codex login", text: "A terminal window opens and runs \"codex login\". Your browser opens: choose Sign in with ChatGPT (Plus, Pro, Business…) and approve, or use an OpenAI API key. Then close the terminal." },
    needs: "A ChatGPT Plus/Pro/Business plan, or an OpenAI API key with credit.",
  },
};

// Which one matches the AI brain they chose (Grok and Ollama: none officially; Claude Code is the suggestion).
export const suggestFor = (provider) => (provider === "openai" ? "codex" : "claude");

// ---- status -----------------------------------------------------------------------------------------------------------
// (checked in the background: never blocks Dayspring while a program answers)
const run = (file, args, timeout) => new Promise((resolve) => execFile(file, args, { encoding: "utf8", windowsHide: true, timeout }, (err, out, errOut) => resolve({ ok: !err, out: `${out ?? ""}${errOut ?? ""}` })));
async function where(cmd) { const r = await run("where.exe", [cmd], 5000); return r.ok ? r.out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && /[\\/]/.test(s)) : []; }
async function version(t) { const r = await run("cmd.exe", ["/d", "/s", "/c", `${t.cmd} --version`], 20_000); const m = /(\d+\.\d+\.\d+[\w.-]*)/.exec(r.out); return r.ok && m ? m[1] : null; }
async function refresh(id) {
  const t = TOOLS[id];
  const paths = [...(await where(t.cmd)), ...t.exeGuesses.filter((p) => existsSync(p))];
  const s = { ...light(id), installed: paths.length > 0, path: paths[0] ?? null, version: paths.length ? await version(t) : null };
  cache.set(id, { at: Date.now(), s });
  return s;
}
function light(id) {
  const t = TOOLS[id], guess = t.exeGuesses.find((p) => existsSync(p)) ?? null;
  return {
    id, label: t.label, maker: t.maker, installed: Boolean(guess), path: guess, version: null,
    signedIn: t.authFiles.some((f) => existsSync(f)), apiKeyAvailable: Boolean(process.env[t.apiKeyVar]),
    needs: t.needs, docs: t.docs, methods: Object.entries(t.methods).map(([k, m]) => ({ id: k, label: m.label, command: m.command })),
  };
}
const cache = new Map();
// Quick answer (the last full check, or what's on disk); a full check runs in the background. refreshAll() waits for it.
export function status(id) {
  const t = TOOLS[id]; if (!t) throw new Error(`unknown tool ${id}`);
  const c = cache.get(id);
  if (!c || Date.now() - c.at > 60_000) refresh(id).catch(() => {});
  return c ? { ...c.s, signedIn: light(id).signedIn } : light(id);
}
export async function refreshAll() { for (const id of Object.keys(TOOLS)) await refresh(id).catch(() => {}); }
export async function statusAll({ fresh = false, provider = "" } = {}) {
  if (fresh || !Object.keys(TOOLS).every((id) => cache.has(id))) await refreshAll();
  return { tools: Object.keys(TOOLS).map((id) => status(id)), coder: preferred(), using: coderTool(), suggested: suggestFor(provider), jobs: [...jobs.values()].slice(-5).map(jobView) };
}

// ---- which one voice coding uses ----------------------------------------------------------------------------------------
export function preferred() { try { return JSON.parse(readFileSync(PREF, "utf8")).coder ?? "auto"; } catch { return "auto"; } }
export function setPreferred(v) { if (!["auto", "claude", "codex"].includes(v)) throw new Error("choose auto, claude or codex"); mkdirSync(DATA, { recursive: true }); writeFileSync(PREF, JSON.stringify({ coder: v })); return v; }
// The tool voice coding runs: the chosen one if installed; "auto" → the one matching the AI brain, else whichever is there.
export function coderTool(provider = process.env.AI_PROVIDER ?? "") {
  const pref = preferred(), has = (id) => status(id).installed;
  if (pref !== "auto") return has(pref) ? pref : null;
  const first = suggestFor(String(provider).toLowerCase() || (process.env.ANTHROPIC_API_KEY ? "anthropic" : ""));
  return has(first) ? first : has(first === "claude" ? "codex" : "claude") ? (first === "claude" ? "codex" : "claude") : null;
}

// ---- installing (official methods, no admin) -----------------------------------------------------------------------------
const jobs = new Map();
const jobView = (j) => ({ id: j.id, tool: j.tool, method: j.method, state: j.state, log: j.log.slice(-30), started: j.started, ended: j.ended ?? null, error: j.error ?? null, dryRun: j.dryRun });
export const job = (id) => (jobs.has(id) ? jobView(jobs.get(id)) : null);
export function install(id, { method = "powershell", dryRun = false } = {}) {
  const t = TOOLS[id]; if (!t) throw new Error(`unknown tool ${id}`);
  const m = t.methods[method]; if (!m) throw new Error(`${t.label} can't be installed with ${method}`);
  const j = { id: randomUUID(), tool: id, method, state: "running", log: [], started: Date.now(), dryRun };
  jobs.set(j.id, j);
  if (method === "npm" && !where("npm").length) { j.state = "failed"; j.error = "npm isn't available. Use the official installer instead."; j.ended = Date.now(); return jobView(j); }
  if (dryRun) { j.log.push(`(dry run) would run in ${m.shell}: ${m.command}`); j.state = "done"; j.ended = Date.now(); return jobView(j); }
  const child = m.shell === "powershell"
    ? spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", m.command], { windowsHide: true })
    : spawn("cmd.exe", ["/d", "/s", "/c", m.command], { windowsHide: true });
  const add = (d) => { for (const line of String(d).split(/\r?\n/)) { const l = line.replace(/\x1b\[[0-9;]*m/g, "").trim(); if (l) { j.log.push(l.slice(0, 300)); if (j.log.length > 400) j.log.shift(); } } };
  child.stdout.on("data", add); child.stderr.on("data", add);
  const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 10 * 60_000);
  child.on("exit", async (code) => {
    clearTimeout(timer); cache.delete(id);
    const s = await refresh(id).catch(() => light(id));
    j.state = code === 0 || s.installed ? (s.installed ? "done" : "done-restart") : "failed";
    if (j.state === "done-restart") j.log.push("Installed. Windows may need a new terminal (or a restart of Dayspring) before it's found.");
    if (j.state === "failed") j.error = j.log.slice(-3).join(" ") || `the installer stopped (${code})`;
    j.ended = Date.now();
  });
  return jobView(j);
}

// ---- signing in: a visible terminal the owner uses ----------------------------------------------------------------------
export function login(id, { dryRun = false } = {}) {
  const t = TOOLS[id]; if (!t) throw new Error(`unknown tool ${id}`);
  if (!status(id).installed) return { ok: false, text: `${t.label} isn't installed yet.` };
  const cmd = `Write-Host 'Signing in to ${t.label}. Follow the steps in your browser, then close this window.' -ForegroundColor Cyan; ${t.login.command}`;
  if (!dryRun) spawn("cmd.exe", ["/c", "start", `"${t.label} sign-in"`, "powershell.exe", "-NoExit", "-NoProfile", "-Command", cmd], { detached: true, stdio: "ignore", windowsHide: true }).unref();   // "start" still opens the sign-in window itself
  return { ok: true, opened: !dryRun, command: t.login.command, text: t.login.text };
}
// Step-by-step words for the setup screen and the guide voice
export function guide(id) {
  const t = TOOLS[id]; if (!t) throw new Error(`unknown tool ${id}`);
  return {
    id, label: t.label, maker: t.maker, needs: t.needs, docs: t.docs,
    steps: [
      { title: `Install ${t.label}`, text: `Click Install. Dayspring runs ${t.maker}'s official installer (${t.methods.powershell.command}). It takes about a minute and doesn't need administrator rights.` },
      { title: "Sign in", text: t.login.text },
      { title: "Check", text: `Dayspring checks that ${t.label} is installed and signed in. Then you can say things like "Dayspring, add a button that shows tomorrow's weather" and it gets to work (it backs up the code first and asks before big changes).` },
    ],
    enables: ["Change or extend Dayspring by voice", "Fix problems it notices", "Write small scripts and automations for you"],
  };
}
export function _clearCache() { cache.clear(); }
