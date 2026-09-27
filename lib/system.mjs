// Opening terminals and starting Claude Code on this computer, by voice. Both run commands, so both need the permission
// to open programs (Settings → Permissions) and both go in the activity log.
// Dangerous mode (--dangerously-skip-permissions) only runs after the owner confirms it out loud: the first call hands back
// a one-time token (confirm.mjs) that only works after the owner's own "yes", for that folder and mode.
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { inside } from "./files.mjs";
import * as owner from "./owner.mjs";
import * as permissions from "./permissions.mjs";
import * as activity from "./activity.mjs";
import * as confirm from "./confirm.mjs";

export const MODES = {
  default: [], manual: ["--permission-mode", "manual"], auto: ["--permission-mode", "auto"], plan: ["--permission-mode", "plan"],
  acceptEdits: ["--permission-mode", "acceptEdits"], dontAsk: ["--permission-mode", "dontAsk"],
  dangerous: ["--dangerously-skip-permissions"],
};
const WT = () => `${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\wt.exe`;

function folder(p) {
  const dir = inside(p || ".");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${p} is not a folder`);
  return dir;
}
// A spoken prompt goes through cmd and Windows Terminal: keep it to characters neither will mangle.
const clean = (s) => String(s ?? "").replace(/["&|<>^%!]/g, "").replace(/;/g, ",").replace(/\s+/g, " ").trim().slice(0, 1500);

function openWindow(dir, title, command) {
  // Windows Terminal when it exists, else a plain console window.
  if (existsSync(WT())) {
    const child = spawn(WT(), ["-w", "new", "-d", dir, "--title", title, "cmd", "/k", ...command], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return "Windows Terminal";
  }
  const child = spawn("cmd.exe", ["/c", "start", `"${title}"`, "/D", dir, "cmd", "/k", ...command], { detached: true, stdio: "ignore", shell: false, windowsHide: true });
  child.unref();
  return "Command Prompt";
}

function mayRun(what, dir) {
  const c = permissions.check("programs");
  if (c.ok) return null;
  activity.log("blocked", { reason: "programs", action: what, path: dir, text: c.text });
  return { denied: true, text: c.text };
}
export function launchClaude({ path, mode = "default", prompt = "", model = "", confirm_token = "" }) {
  if (!MODES[mode]) throw new Error(`mode must be one of ${Object.keys(MODES).join(", ")}`);
  const dir = folder(path);
  const no = mayRun("claude", dir); if (no) return no;
  if (mode === "dangerous" || mode === "bypassPermissions") {
    const op = { tool: "launch_claude_code", mode, path: dir.toLowerCase() };
    if (!confirm_token || !confirm.consume(confirm_token, op).ok) {
      const text = `Start Claude Code in dangerous mode in ${basename(dir)}? In that mode it can change or delete files and run commands in that folder without asking anyone. Are you sure?`;
      return { needsConfirm: true, confirm_token: confirm.issue(op, { text, what: `claude dangerous ${dir}` }), text, howToConfirm: `Ask ${owner.name()} this and wait. Only after a clear yes, call again with the same folder and mode plus this confirm_token.` };
    }
  }
  const args = ["claude", ...MODES[mode]];
  if (model) args.push("--model", String(model).replace(/[^\w.-]/g, ""));
  const p = clean(prompt);
  if (p) args.push(`"${p}"`);
  const via = openWindow(dir, `Claude — ${basename(dir)}${mode !== "default" ? ` (${mode})` : ""}`, args);
  activity.log("program", { action: "claude-code", path: dir, mode, prompt: p || null, result: "ok" });
  return { launched: true, folder: dir, mode, prompt: p || null, via };
}

export function openTerminal({ path }) {
  const dir = folder(path);
  const no = mayRun("terminal", dir); if (no) return no;
  const via = openWindow(dir, basename(dir), []);
  activity.log("program", { action: "terminal", path: dir, result: "ok" });
  return { opened: true, folder: dir, via };
}
