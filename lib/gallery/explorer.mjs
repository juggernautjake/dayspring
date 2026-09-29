// "Open file location": File Explorer at a file's folder with that file selected, the one way Dayspring does it (the
// photo gallery, the file viewer, the finder's "show it in the folder" and file_show_in_folder all come here).
//   select(path, { via, what }) → { dryRun?, exe, args }
// The command is exactly   explorer.exe /select,"<path>"   (passed verbatim, so a path with spaces or commas stays one
// argument; Windows paths can't contain a double quote).
// The rules (the callers check the path first, this only runs it and logs it):
//   - Showing a folder is low-risk: it opens Windows' own file browser and runs nothing, so, like open_item on a folder
//     (lib/abilities.mjs), it doesn't need the Programs permission and doesn't ask first. The file must be in a place
//     Dayspring may look (file access, or the owner's photo folders), never a secret or a place kept out: the callers
//     check that, and log a refusal as "blocked".
//   - Every one is in the activity log: "file.open" { action: "show in folder", path, via }.
//   - Tests: DS_LAUNCH_LOG (a file) gets one JSON line { at, exe, args, why } instead of a window, like lib/display.mjs;
//     DAYSPRING_NO_OPEN / DAYSPRING_NO_BROWSER open nothing either (dryRun).
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import * as activity from "../activity.mjs";

export const command = (path) => ({ exe: "explorer.exe", args: [`/select,"${resolve(String(path)).replace(/"/g, "")}"`] });
const dry = () => Boolean(process.env.DS_LAUNCH_LOG) || process.env.DAYSPRING_NO_BROWSER === "1" || process.env.DAYSPRING_NO_OPEN === "1" || process.platform !== "win32";

export function select(path, { via = "screen", what = "show in folder" } = {}) {
  const { exe, args } = command(path);
  if (process.env.DS_LAUNCH_LOG) { try { appendFileSync(process.env.DS_LAUNCH_LOG, JSON.stringify({ at: new Date().toISOString(), exe, args, why: what }) + "\n"); } catch { /* test only */ } }
  else if (!dry()) {
    try { const c = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: true }); c.on("error", () => {}); c.unref(); } catch { /* nothing to open with */ }
  }
  activity.log("file.open", { action: what, path: resolve(String(path)), via, dryRun: dry() || undefined, result: "ok" });
  return { exe, args, dryRun: dry() || undefined };
}
