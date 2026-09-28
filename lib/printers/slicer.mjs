// Optional slicing: an .stl (or .3mf model) → a print-ready .3mf, with Bambu Studio's or OrcaSlicer's command line when
// one of them is installed. Without one, Dayspring only prints files that are already sliced (.3mf with G-code, .gcode).
//   find() → { name, exe } | null        slice(model, { profile: { machine, process, filament }, out }) → the new file
// A profile is the JSON files the slicer exports (File → Export → Export preset bundle, or its user preset folder).
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";

const CANDIDATES = () => [
  process.env.DAYSPRING_SLICER && { name: "custom", exe: process.env.DAYSPRING_SLICER },
  { name: "Bambu Studio", exe: join(process.env.ProgramFiles ?? "C:\\Program Files", "Bambu Studio", "bambu-studio.exe") },
  { name: "OrcaSlicer", exe: join(process.env.ProgramFiles ?? "C:\\Program Files", "OrcaSlicer", "orca-slicer.exe") },
  { name: "OrcaSlicer", exe: join(process.env.LOCALAPPDATA ?? "", "Programs", "OrcaSlicer", "orca-slicer.exe") },
].filter(Boolean);
export function find() { return CANDIDATES().find((c) => c.exe && existsSync(c.exe)) ?? null; }
export function args(model, { machine, process: proc, filament, out, plate = 0 } = {}) {
  const a = ["--slice", String(plate), "--export-3mf", out];
  const settings = [machine, proc].filter(Boolean);
  if (settings.length) a.push("--load-settings", settings.join(";"));
  if (filament) a.push("--load-filaments", Array.isArray(filament) ? filament.join(";") : filament);
  a.push(model);
  return a;
}
export function slice(model, { profile = {}, out, timeoutMs = 10 * 60_000 } = {}) {
  const s = find();
  if (!s) return Promise.reject(new Error("No slicer is installed. Install Bambu Studio or OrcaSlicer, or slice it yourself and give me the .3mf."));
  if (!existsSync(model)) return Promise.reject(new Error(`I can't find ${basename(model)}.`));
  const dest = out ?? join(tmpdir(), `${basename(model).replace(/\.\w+$/, "")}-${Date.now()}.gcode.3mf`);
  return new Promise((resolve, reject) => {
    const c = spawn(s.exe, args(model, { ...profile, out: dest }), { cwd: dirname(model), windowsHide: true });
    let err = "";
    const t = setTimeout(() => { try { c.kill(); } catch { /* gone */ } reject(new Error("Slicing took too long.")); }, timeoutMs);
    c.stderr?.on("data", (d) => { if (err.length < 3000) err += d; });
    c.on("error", (e) => { clearTimeout(t); reject(e); });
    c.on("close", (code) => { clearTimeout(t); if (code === 0 && existsSync(dest)) resolve(dest); else reject(new Error(`${s.name} couldn't slice it (${code}). ${err.split("\n").filter(Boolean).pop() ?? ""}`.trim())); });
  });
}
