// Installing Voicemeeter (VB-Audio, free/donationware) — what lets Dayspring talk into calls. Only with the owner's OK:
//   1. find the current package on the official page (vb-audio.com/Voicemeeter/banana.htm → download.vb-audio.com/…zip)
//   2. download it to a temp folder, unzip, and check the installer's Windows signature (signed by VB-Audio's developer)
//   3. run it — Windows asks for administrator permission (UAC); the owner clicks through VB-Audio's installer
//   4. clear any saved Voicemeeter setup that could open a headset in exclusive mode (voicemeeter.sanitizeSavedSetup),
//      so it can never lock a headset away from Discord again; VB-Audio asks for a restart of Windows afterwards.
// mode: "plan" (nothing downloaded) | "verify" (download + check the signature, don't run) | "install"
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as vm from "./voicemeeter.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const STATE = join(DATA, "voicemeeter-install.json");
export const PAGE = "https://vb-audio.com/Voicemeeter/banana.htm";
const FALLBACK = "https://download.vb-audio.com/Download_CABLE/VoicemeeterSetup_v2130.zip";   // Sept 2026 (2.1.3.0)
const OFFICIAL_HOST = /^https:\/\/(download\.)?vb-audio\.com\//i;
const SIGNER = /burel\s+vincent|vincent\s+burel|vb-audio/i;   // the certificate reads "BUREL VINCENT Entrepreneur individuel"

const readState = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; } };
const writeState = (s) => { mkdirSync(DATA, { recursive: true }); writeFileSync(STATE, JSON.stringify({ ...readState(), ...s })); };

function exeVersion(dir) {
  for (const n of ["voicemeeterpro.exe", "voicemeeter8x64.exe", "voicemeeter8.exe", "voicemeeter.exe"]) {
    const p = join(dir, n); if (!existsSync(p)) continue;
    const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Item '${p.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    return (r.stdout || "").trim() || null;
  }
  return null;
}
export function status() {
  const dir = vm.installDir(), st = readState();
  return {
    installed: Boolean(dir), dir, version: dir ? exeVersion(dir) : null, running: vm.isRunning?.() ?? false,
    needsRestart: Boolean(st.installedAt && !st.rebootedAfter && Date.now() - st.installedAt < 7 * 86_400_000 && lastBoot() < st.installedAt),
    why: "Voicemeeter lets Dayspring's voice go into calls (Discord, Zoom…) along with your microphone. Dayspring sets it up in a safe shared mode so your headset keeps working in other apps.",
    page: PAGE,
  };
}
function lastBoot() {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const t = Date.parse((r.stdout || "").trim()); return Number.isFinite(t) ? t : 0;
}

// The current package link, from the official page (falls back to the known Sept 2026 link).
export async function latest() {
  try {
    const html = await (await fetch(PAGE, { signal: AbortSignal.timeout(10_000) })).text();
    const links = [...html.matchAll(/href="([^"]*VoicemeeterSetup_v(\d+)\.zip)"/gi)].map((m) => ({ url: new URL(m[1], PAGE).href, v: Number(m[2]) })).sort((a, b) => b.v - a.v);
    if (links[0] && OFFICIAL_HOST.test(links[0].url)) return { url: links[0].url, version: String(links[0].v).split("").join(".") };
  } catch { /* offline or the page changed */ }
  return { url: FALLBACK, version: "2.1.3.0", fallback: true };
}

const jobs = new Map();
const view = (j) => ({ id: j.id, mode: j.mode, state: j.state, step: j.step, log: j.log.slice(-20), error: j.error ?? null, signer: j.signer ?? null, needsRestart: j.needsRestart ?? false });
export const job = (id) => (jobs.has(id) ? view(jobs.get(id)) : null);

export function install({ mode = "install" } = {}) {
  const j = { id: randomUUID(), mode, state: "running", step: "finding", log: [] };
  jobs.set(j.id, j);
  run(j).catch((e) => { j.state = "failed"; j.error = e.message; j.log.push(e.message); });
  return view(j);
}
async function run(j) {
  const say = (step, text) => { j.step = step; j.log.push(text); };
  if (vm.installDir() && j.mode === "install") { say("done", "Voicemeeter is already installed."); j.state = "done"; return; }
  const pkg = await latest();
  if (!OFFICIAL_HOST.test(pkg.url)) throw new Error("That download link isn't from vb-audio.com, so I won't use it.");
  say("found", `Official package: Voicemeeter ${pkg.version} (${pkg.url})`);
  if (j.mode === "plan") { say("done", "Plan only: nothing was downloaded."); j.state = "done"; j.url = pkg.url; return; }
  // download
  const dir = join(tmpdir(), "dayspring-voicemeeter"); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const zip = join(dir, "VoicemeeterSetup.zip");
  say("downloading", "Downloading from vb-audio.com…");
  const res = await fetch(pkg.url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`The download didn't work (${res.status}).`);
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  say("downloaded", `Downloaded ${(statSync(zip).size / 1048576).toFixed(1)} MB.`);
  // unzip + find the installer
  const ex = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${join(dir, "x")}' -Force`], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
  if (ex.status !== 0) throw new Error("The package couldn't be unzipped.");
  const setup = findSetup(join(dir, "x"));
  if (!setup) throw new Error("The installer wasn't in the package.");
  // signature
  const sig = spawnSync("powershell.exe", ["-NoProfile", "-Command", `$s = Get-AuthenticodeSignature -LiteralPath '${setup}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  const [statusText, subject = ""] = (sig.stdout || "").trim().split("|");
  j.signer = subject;
  if (statusText !== "Valid" || !SIGNER.test(subject)) throw new Error(`The installer's signature didn't check out (${statusText || "unknown"}), so I stopped. Nothing was installed.`);
  say("verified", `Signed by ${subject.replace(/^CN=/, "").split(",")[0]} — checks out.`);
  if (j.mode === "verify") { say("done", "Verified only: nothing was installed."); j.state = "done"; rmSync(dir, { recursive: true, force: true }); return; }
  // run it (Windows asks for administrator permission)
  say("installing", "Windows will ask for permission. Click Yes, then Install in VB-Audio's window.");
  const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `try { $pr = Start-Process -FilePath '${setup}' -Verb RunAs -PassThru -Wait; exit $pr.ExitCode } catch { exit 1223 }`], { encoding: "utf8", windowsHide: true, timeout: 20 * 60_000 });
  if (p.status === 1223) throw new Error("Windows' permission prompt was declined, so nothing was installed.");
  if (!vm.installDir()) throw new Error("The installer closed, but Voicemeeter isn't showing as installed. You can try again.");
  try { vm.sanitizeSavedSetup(); } catch { /* nothing saved yet */ }
  writeState({ installedAt: Date.now(), rebootedAfter: false });
  j.needsRestart = true;
  say("done", "Voicemeeter is installed. Restart Windows when it's convenient to finish setting it up.");
  j.state = "done";
  rmSync(dir, { recursive: true, force: true });
}
function findSetup(dir) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/^voicemeeter.*setup.*\.exe$/i.test(e.name) && !/x86/i.test(e.name)) return p;
    }
  }
  return null;
}
