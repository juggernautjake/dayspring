// Keeping this computer awake while it feeds a printer over USB (if Windows sleeps mid-print, the print dies).
// Uses the same helper as "keep the Dayspring screen's computer awake" (scripts/keep-awake.ps1), with -AlsoOnBattery,
// held while any printer needs it and let go when the last one finishes. It never changes the power settings.
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PS1 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "keep-awake.ps1");
const holders = new Set();
let proc = null;
export function hold(id, on) {
  if (on) holders.add(id); else holders.delete(id);
  if (holders.size && !proc && process.platform === "win32" && !process.env.DAYSPRING_NO_KEEPAWAKE) {
    proc = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, "-ParentPid", String(process.pid), "-AlsoOnBattery"], { windowsHide: true, stdio: "ignore" });
    proc.on("exit", () => { proc = null; });
    proc.on("error", () => { proc = null; });
  }
  if (!holders.size && proc) { try { proc.kill(); } catch { /* gone */ } proc = null; }
  return { holding: [...holders] };
}
export const holding = () => [...holders];
