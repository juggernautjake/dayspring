// Dayspring's small Windows helpers, built on this computer from the C# sources in scripts/ with the compiler that ships
// with Windows (.NET Framework 4, on Windows 10 1809+ and 11), so nothing extra is downloaded:
//   Dayspring Notifications.exe   the desktop notification cards (scripts/overlay.cs)
//   Dayspring Keep Awake.exe      keeps the PC awake while plugged in (scripts/keepawake.cs)
//   Dayspring.exe                 "Dayspring" in Task Manager: starts the server (Dayspring Server.exe) (scripts/host.cs)
// Each is rebuilt when its source is newer than the exe, or (versioned) when Dayspring's version changes, so an update
// always brings the helper up to date even if the exe was built after the new source was written. build() → the exe path, or throws a readable error.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BIN = join(ROOT, "bin");
// 64-bit Windows first, then 32-bit
export function csc() {
  const w = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  return [join(w, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"), join(w, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")].find((p) => existsSync(p)) ?? null;
}
export const HELPERS = {
  overlay: { src: "overlay.cs", exe: "Dayspring Notifications.exe", target: "winexe", refs: ["System.Windows.Forms.dll", "System.Drawing.dll", "System.Web.Extensions.dll", "System.Speech.dll"], versioned: true },
  keepawake: { src: "keepawake.cs", exe: "Dayspring Keep Awake.exe", target: "winexe", refs: ["System.Windows.Forms.dll"], versioned: true },
  host: { src: "host.cs", exe: "Dayspring.exe", target: "winexe", refs: [], versioned: true },
};
// /r: arguments; System.Speech.dll is found by its full path (the WPF folder beside the compiler), and a helper is built
// with NOSPEECH defined when it isn't there
export function refArgs(compiler, refs) {
  const out = [];
  for (const r of refs) {
    if (r !== "System.Speech.dll") { out.push(`/r:${r}`); continue; }
    const p = join(dirname(compiler), "WPF", "System.Speech.dll");
    out.push(...(existsSync(p) ? [`/r:${p}`] : ["/define:NOSPEECH"]));
  }
  return out;
}
const building = new Map();
const pkgVersion = () => { try { return String(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version ?? "1.0.0").replace(/[^\d.]/g, "").split(".").concat(["0", "0"]).slice(0, 3).join("."); } catch { return "1.0.0"; } };
export function build(name, { outDir = BIN, force = false } = {}) {
  const h = HELPERS[name]; if (!h) return Promise.reject(new Error(`no helper called ${name}`));
  let src = join(ROOT, "scripts", h.src); const exe = join(outDir, h.exe);
  const stampFile = exe + ".version";
  const fresh = () => { try { return existsSync(exe) && statSync(exe).mtimeMs >= statSync(join(ROOT, "scripts", h.src)).mtimeMs && (!h.versioned || readFileSync(stampFile, "utf8") === pkgVersion()); } catch { return false; } };
  if (!force && fresh()) return Promise.resolve(exe);
  // the version from package.json goes into the program's own details (Task Manager, the file's Properties)
  if (h.versioned) { const t = join(tmpdir(), `ds-${name}-${process.pid}.cs`); writeFileSync(t, readFileSync(src, "utf8").replace(/__VERSION__/g, pkgVersion())); src = t; }
  if (building.has(exe)) return building.get(exe);
  const p = new Promise((resolve, reject) => {
    if (process.platform !== "win32") return reject(new Error("This part of Dayspring needs Windows."));
    const c = csc(); if (!c) return reject(new Error("Windows' C# compiler (.NET Framework 4) wasn't found, so this part of Dayspring can't be built. It comes with Windows 10 and 11; turning on \".NET Framework 4.8\" in Windows Features fixes it."));
    mkdirSync(outDir, { recursive: true });
    const icon = existsSync(join(ROOT, "dayspring.ico")) ? [`/win32icon:${join(ROOT, "dayspring.ico")}`] : [];
    const refs = refArgs(c, h.refs);
    execFile(c, ["/nologo", `/target:${h.target}`, "/optimize+", ...icon, `/out:${exe}`, ...refs, src], { windowsHide: true, timeout: 120_000 }, (err, out) => {
      if (err || !existsSync(exe)) return reject(new Error(`Couldn't build ${h.exe}: ` + String(out || err?.message).split(/\r?\n/).filter((l) => /error/i.test(l)).slice(0, 3).join(" ")));
      if (h.versioned) { try { writeFileSync(stampFile, pkgVersion()); } catch { /* rebuilt next time */ } }
      resolve(exe);
    });
  }).finally(() => building.delete(exe));
  building.set(exe, p);
  return p;
}
