// Opening terminals and starting Claude Code on this computer, by voice.
// Dangerous mode (--dangerously-skip-permissions) only runs after the owner confirms it out loud:
// the tool refuses unless `confirmed` is true, and the assistant is told to ask first.
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { inside } from "./files.mjs";
import * as owner from "./owner.mjs";

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
  const child = spawn("cmd.exe", ["/c", "start", `"${title}"`, "/D", dir, "cmd", "/k", ...command], { detached: true, stdio: "ignore", shell: false });
  child.unref();
  return "Command Prompt";
}

export function launchClaude({ path, mode = "default", prompt = "", model = "", confirmed = false }) {
  if (!MODES[mode]) throw new Error(`mode must be one of ${Object.keys(MODES).join(", ")}`);
  if ((mode === "dangerous" || mode === "bypassPermissions") && !confirmed) {
    const e = new Error(`Dangerous mode needs ${owner.name()}'s spoken confirmation. Ask ${owner.them()} to confirm the folder and the mode, then call again with confirmed: true.`);
    e.needsConfirmation = true;
    throw e;
  }
  const dir = folder(path);
  const args = ["claude", ...MODES[mode]];
  if (model) args.push("--model", String(model).replace(/[^\w.-]/g, ""));
  const p = clean(prompt);
  if (p) args.push(`"${p}"`);
  const via = openWindow(dir, `Claude — ${basename(dir)}${mode !== "default" ? ` (${mode})` : ""}`, args);
  return { launched: true, folder: dir, mode, prompt: p || null, via };
}

export function openTerminal({ path }) {
  const dir = folder(path);
  const via = openWindow(dir, basename(dir), []);
  return { opened: true, folder: dir, via };
}
