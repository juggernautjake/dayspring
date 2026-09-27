// Programs installed on this computer: list them, find one by a loose name ("word", "discord", "calculator"),
// open it, and close it (closing always asks first). Governed by permissions.programs: off | ask | on.
import { execFile } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import * as permissions from "./permissions.mjs";
import * as activity from "./activity.mjs";

const PS1 = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "programs.ps1");
const ps = (args, timeout = 30_000) => new Promise((res, rej) =>
  execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...args], { windowsHide: true, timeout, maxBuffer: 8 << 20 },
    (err, out) => (err ? rej(err) : res(String(out).trim()))));

// Uninstallers, help files and web links are clutter in a program list.
const NOISE = /\b(uninstall|uninstaller|readme|release notes|help|documentation|license|website|web site|manual|changelog|repair)\b/i;
let cache = null, cachedAt = 0;
export async function list({ fresh = false } = {}) {
  if (cache && !fresh && Date.now() - cachedAt < 10 * 60_000) return cache;
  const raw = await ps(["-List"]);
  let arr = [];
  try { arr = JSON.parse(raw || "[]"); } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [arr];
  cache = arr.filter((a) => a?.name && !NOISE.test(a.name) && !/^https?:/i.test(a.appId ?? "")).map((a) => ({ name: a.name, appId: a.appId || "", lnk: a.lnk || "", exe: a.exe || "" }));
  cachedAt = Date.now();
  return cache;
}

const norm = (s) => String(s).toLowerCase().replace(/\(.*?\)|microsoft|®|™/g, " ").replace(/[^a-z0-9+#]+/g, " ").trim();
const ALIASES = { word: "word", excel: "excel", powerpoint: "powerpoint", outlook: "outlook", calc: "calculator", notepad: "notepad", paint: "paint",
  edge: "edge", chrome: "google chrome", "file explorer": "file explorer", explorer: "file explorer", terminal: "terminal", settings: "settings", vscode: "visual studio code", "vs code": "visual studio code", code: "visual studio code" };

// Best matches for a loose name, best first.
export async function find(name, max = 5) {
  const want = norm(ALIASES[norm(name)] ?? name);
  if (!want) return [];
  const words = want.split(" ");
  const scored = (await list()).map((a) => {
    const n = norm(a.name);
    let s = 0;
    if (n === want) s = 100;
    else if (n.startsWith(want)) s = 80;
    else if (new RegExp(`\\b${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n)) s = 70;
    else if (words.every((w) => n.includes(w))) s = 50;
    else if (a.exe && norm(basename(a.exe, ".exe")) === want) s = 60;
    else s = 0;
    return { a, s: s ? s - n.length / 100 : 0 };
  }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
  return scored.slice(0, max).map((x) => x.a);
}

// open(name, { confirmed }) → { opened } | { needsConfirm, text } | { denied, text } | { notFound, text, suggestions }
export async function open(name, { confirmed = false } = {}) {
  const ok = permissions.check("programs");
  if (!ok.ok) { activity.log("blocked", { reason: "programs", action: "open", program: String(name).slice(0, 120), text: ok.text }); return { denied: true, text: ok.text }; }
  const [hit, ...rest] = await find(name);
  if (!hit) return { notFound: true, text: `I couldn't find a program called "${name}" on this computer.` };
  if (ok.ask && !confirmed) return { needsConfirm: true, program: hit.name, text: `Open ${hit.name}? Say yes and I'll open it.`, others: rest.map((r) => r.name) };
  if (hit.appId) await ps(["-Open", hit.appId]);
  else if (hit.lnk) await ps(["-OpenLnk", hit.lnk]);
  else return { notFound: true, text: `I found ${hit.name} but not a way to start it.` };
  activity.log("program", { action: "open", program: hit.name, asked: String(name).slice(0, 120), result: "ok" });
  return { opened: hit.name };
}

// close(name, { confirmed }) — always asks first; closes gracefully (like clicking X), never forces.
export async function close(name, { confirmed = false } = {}) {
  const ok = permissions.check("programs");
  if (!ok.ok) { activity.log("blocked", { reason: "programs", action: "close", program: String(name).slice(0, 120), text: ok.text }); return { denied: true, text: ok.text }; }
  const [hit] = await find(name);
  const exe = hit?.exe && /\.exe$/i.test(hit.exe) ? basename(hit.exe) : `${String(name).replace(/[^\w.-]/g, "")}.exe`;
  if (!confirmed) return { needsConfirm: true, program: hit?.name ?? name, text: `Close ${hit?.name ?? name}? Anything unsaved in it could be lost. Say yes to close it.` };
  await new Promise((res) => execFile("taskkill", ["/im", exe], { windowsHide: true }, () => res()));
  activity.log("program", { action: "close", program: hit?.name ?? String(name).slice(0, 120), result: "ok" });
  return { closed: hit?.name ?? name };
}
