// Windows 10 (1809+) checks, run anywhere: Dayspring's PowerShell scripts must work in Windows PowerShell 5.1 (no
// PowerShell 7-only syntax), its C# helpers must compile with the .NET Framework 4 compiler that ships with Windows
// (C# 5: no ?. or $"" strings) and use no Windows 11-only APIs, and nothing may use another tar than Windows' own.
//   node scripts/qa/win10-compat.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got ? "  (" + got + ")" : ""}`); };
// here-strings hold C# for Add-Type, not PowerShell: they're left out
const strip = (src) => src.replace(/@"[\s\S]*?"@/g, "").replace(/@'[\s\S]*?'@/g, "").replace(/<#[\s\S]*?#>/g, "").split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, "")).map((l) => l.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""'));

const PS7 = [[/\?\?/, "?? (null-coalescing)"], [/\?\.[A-Za-z(]/, "?. (null-conditional)"], [/\s&&\s|\s\|\|\s/, "&& / || (pipeline chains)"], [/\$\w+\s*\?\s*[^:]+\s*:\s/, "a ? b : c (ternary)"], [/ForEach-Object\s+-Parallel/i, "ForEach-Object -Parallel"], [/-AsHashtable/i, "ConvertFrom-Json -AsHashtable"], [/\$PSStyle/, "$PSStyle"], [/-AdditionalChildPath/i, "Join-Path -AdditionalChildPath"]];
const ps1 = readdirSync(join(DESK, "scripts")).filter((f) => f.endsWith(".ps1"));
for (const f of ps1) {
  const lines = strip(readFileSync(join(DESK, "scripts", f), "utf8"));
  const bad = [];
  lines.forEach((l, i) => { for (const [re, what] of PS7) if (re.test(l)) bad.push(`${i + 1}: ${what}`); });
  check(`PowerShell 5.1: scripts/${f}`, !bad.length, bad.slice(0, 3).join("; "));
}
const WIN11 = [/DWMWA_WINDOW_CORNER_PREFERENCE|DWMWA_SYSTEMBACKDROP_TYPE|DWMSBT_|Mica|Microsoft\.UI\.|WindowsAppSDK|Windows\.UI\.Composition/];
const CS6 = [[/\w\?\.\w/, "?. (C# 6)"], [/\$"/, '$"" strings (C# 6)'], [/\bnameof\(/, "nameof (C# 6)"], [/=>\s*[^;{]+;\s*$/m, null]];
for (const f of readdirSync(join(DESK, "scripts")).filter((x) => x.endsWith(".cs"))) {
  const src = readFileSync(join(DESK, "scripts", f), "utf8").replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const bad = [];
  for (const re of WIN11) if (re.test(src)) bad.push("Windows 11-only API");
  for (const [re, what] of CS6) if (what && re.test(src)) bad.push(what);
  check(`C# 5 / .NET 4, Windows 10: scripts/${f}`, !bad.length, bad.join("; "));
}
// tar: only Windows' own (System32), never a bare "tar" that could be Git's
const tarBare = [];
for (const dir of ["lib", "scripts"]) for (const f of readdirSync(join(DESK, dir)).filter((x) => x.endsWith(".mjs"))) {
  const src = readFileSync(join(DESK, dir, f), "utf8");
  if (/(spawn|execFile|runAsync|run)\(\s*["']tar["']/.test(src)) tarBare.push(`${dir}/${f}`);
}
check("zips are unpacked with Windows' own tar (or Expand-Archive)", !tarBare.length, tarBare.join(", "));
// known folders: no hard-coded user Desktop / Documents paths
const hard = [];
for (const dir of ["lib", "scripts", "dist"]) for (const f of readdirSync(join(DESK, dir)).filter((x) => /\.(mjs|ps1|cmd|vbs)$/.test(x))) {
  const src = readFileSync(join(DESK, dir, f), "utf8");
  // (an example path inside a description for the AI doesn't count)
  if (src.split(/\r?\n/).some((l) => !/description|e\.g\.|like C:/i.test(l) && /C:\\\\?Users\\\\?[^\\"'`]+\\\\?(Desktop|Documents)/i.test(l))) hard.push(`${dir}/${f}`);
}
check("user folders come from Windows (OneDrive-redirected Desktop/Documents work)", !hard.length, hard.join(", "));
const inst = readFileSync(join(DESK, "dist", "Install Dayspring.cmd"), "utf8");
check("installer: mentions Windows 10 and 11, and falls back when winget can't install", /Windows 10/.test(inst) && /winget couldn't install/.test(inst));
// window.ps1 really runs (a parameter named like a variable inside it once broke every window action), with a title
// that matches nothing, so no window is touched
{
  const { execFileSync } = await import("node:child_process");
  let out = ""; try { out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(DESK, "scripts", "window.ps1"), "-Action", "state", "-Title", "^no window is called this 7f3a9c$"], { windowsHide: true, encoding: "utf8", timeout: 30_000 }); } catch (e) { out = String(e.stderr ?? e.message); }
  let j = null; try { j = JSON.parse(out.trim()); } catch { /* an error message */ }
  check("window.ps1 runs and answers", j?.found === 0, out.trim().slice(0, 160));
}
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
