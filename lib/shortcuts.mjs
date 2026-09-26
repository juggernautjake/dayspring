// Start-menu shortcuts for the ways Dayspring can open, added once to installs from before 1.1.3:
//   "Dayspring (full screen)"  → Start Dayspring.vbs --open-as fullscreen
//   "Dayspring mini"           → Start Dayspring.vbs --open-as compact
//   "Dayspring in browser"     → Start Dayspring.vbs --open-as tab
// Only for an installed copy (Start Dayspring.vbs next to the app, and a Dayspring folder in the Start menu that the
// installer made). A developer's copy has neither, so nothing is touched there. Runs hidden, once per version.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = join(ROOT, "data", "shortcuts.json");
const VERSION = 3;           // 1: full screen + in browser (1.1.3) · 2: + Dayspring mini · 3: + Uninstall (1.2.0)

export function menuDir() { return join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Dayspring"); }

export function ensure() {
  if (process.platform !== "win32" || process.env.DS_LAUNCH_LOG || process.env.DAYSPRING_NO_BROWSER) return Promise.resolve({ skipped: "not here" });
  const vbs = join(ROOT, "Start Dayspring.vbs");
  if (!existsSync(vbs) || !existsSync(menuDir())) return Promise.resolve({ skipped: "not an installed copy" });
  try { if (JSON.parse(readFileSync(MARK, "utf8")).version >= VERSION) return Promise.resolve({ skipped: "done" }); } catch { /* first time */ }
  const esc = (s) => String(s).replace(/'/g, "''");
  const mk = (name, desc, extra) => `$p = Join-Path '${esc(menuDir())}' '${esc(name)}'; if (-not (Test-Path -LiteralPath $p)) { $s = $w.CreateShortcut($p); $s.TargetPath = (Join-Path $env:SystemRoot 'System32\\wscript.exe'); $s.Arguments = [char]34 + '${esc(vbs)}' + [char]34 + '${extra}'; $s.WorkingDirectory = '${esc(ROOT)}'; $s.IconLocation = '${esc(join(ROOT, "dayspring.ico"))}'; $s.Description = '${esc(desc)}'; $s.Save() }`;
  const script = ["$ErrorActionPreference='SilentlyContinue'", "$w = New-Object -ComObject WScript.Shell",
    mk("Dayspring (full screen).lnk", "Start Dayspring full screen, like on a TV", " --open-as fullscreen"),
    mk("Dayspring mini.lnk", "Dayspring in a small window you can put anywhere", " --open-as compact"),
    mk("Dayspring in browser.lnk", "Open Dayspring in a tab in your browser", " --open-as tab"),
    mk("Uninstall Dayspring.lnk", "Remove Dayspring from this computer (it asks first)", " --uninstall")].join("; ");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 20000 }, (err) => {
      if (!err) { try { writeFileSync(MARK, JSON.stringify({ version: VERSION, at: new Date().toISOString() })); } catch { /* not critical */ } }
      resolve({ ok: !err });
    });
  });
}
