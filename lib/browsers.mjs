// Which web browsers are installed, which one Windows uses by default, and how to start one for Dayspring.
// list() → [{ id, name, exe, family, isDefault }]   family: "chromium" (app window / full screen / its own profile),
// "firefox" (its own profile, full screen with --kiosk) or "other" (a normal window).
// resolve(choice) → the browser to use for a saved choice ("default", "chrome", "edge", "brave", "firefox", …).
// Everything runs hidden (reg.exe with windowsHide), and the answer is cached for a minute.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

const PF = process.env.ProgramFiles ?? "C:\\Program Files", PF86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", LAD = process.env.LOCALAPPDATA ?? "";

// The browsers Dayspring knows. exe names are matched case-insensitively; paths are fallbacks when the registry is quiet.
export const KNOWN = [
  { id: "edge", name: "Microsoft Edge", family: "chromium", exes: ["msedge.exe"], progIds: [/^MSEdgeHTM/i], paths: [join(PF86, "Microsoft\\Edge\\Application\\msedge.exe"), join(PF, "Microsoft\\Edge\\Application\\msedge.exe")] },
  { id: "chrome", name: "Google Chrome", family: "chromium", exes: ["chrome.exe"], progIds: [/^ChromeHTML/i], paths: [join(PF, "Google\\Chrome\\Application\\chrome.exe"), join(PF86, "Google\\Chrome\\Application\\chrome.exe"), join(LAD, "Google\\Chrome\\Application\\chrome.exe")] },
  { id: "brave", name: "Brave", family: "chromium", exes: ["brave.exe"], progIds: [/^BraveHTML/i, /^BraveBHTML/i], paths: [join(PF, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"), join(PF86, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"), join(LAD, "BraveSoftware\\Brave-Browser\\Application\\brave.exe")] },
  { id: "vivaldi", name: "Vivaldi", family: "chromium", exes: ["vivaldi.exe"], progIds: [/^VivaldiHTM/i], paths: [join(LAD, "Vivaldi\\Application\\vivaldi.exe"), join(PF, "Vivaldi\\Application\\vivaldi.exe")] },
  { id: "chromium", name: "Chromium", family: "chromium", exes: ["chromium.exe"], progIds: [/^ChromiumHTM/i], paths: [join(LAD, "Chromium\\Application\\chrome.exe")] },
  { id: "opera", name: "Opera", family: "other", exes: ["opera.exe", "launcher.exe"], progIds: [/^OperaStable/i], paths: [join(LAD, "Programs\\Opera\\opera.exe"), join(LAD, "Programs\\Opera\\launcher.exe")] },
  { id: "operagx", name: "Opera GX", family: "other", exes: ["opera.exe", "launcher.exe"], progIds: [/^OperaGXStable/i], paths: [join(LAD, "Programs\\Opera GX\\opera.exe"), join(LAD, "Programs\\Opera GX\\launcher.exe")] },
  { id: "firefox", name: "Mozilla Firefox", family: "firefox", exes: ["firefox.exe"], progIds: [/^FirefoxURL/i, /^FirefoxHTML/i], paths: [join(PF, "Mozilla Firefox\\firefox.exe"), join(PF86, "Mozilla Firefox\\firefox.exe")] },
  { id: "librewolf", name: "LibreWolf", family: "firefox", exes: ["librewolf.exe"], progIds: [/^LibreWolf/i], paths: [join(PF, "LibreWolf\\librewolf.exe")] },
  { id: "waterfox", name: "Waterfox", family: "firefox", exes: ["waterfox.exe"], progIds: [/^WaterfoxURL/i], paths: [join(PF, "Waterfox\\waterfox.exe")] },
  { id: "arc", name: "Arc", family: "other", exes: ["arc.exe"], progIds: [/^Arc/i], paths: [] },
];
const byId = (id) => KNOWN.find((k) => k.id === id);
// Websites and search engines people sometimes name when asked for a browser
export const NOT_BROWSERS = { gmail: "Gmail is an email website", google: "Google is a search website (the browser is Google Chrome)", bing: "Bing is Microsoft's search website (the browser is Microsoft Edge)", yahoo: "Yahoo is a website", duckduckgo: "DuckDuckGo is a search website", outlook: "Outlook is an email website or app" };

function reg(args) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve("");
    execFile("reg.exe", args, { windowsHide: true, timeout: 8000, encoding: "utf8" }, (err, out) => resolve(err ? "" : String(out)));
  });
}
const exeFromCommand = (cmd) => { const m = /^\s*"([^"]+\.exe)"/i.exec(cmd) ?? /^\s*(\S+\.exe)/i.exec(cmd); return m ? m[1] : ""; };
const valueOf = (out, name) => { const m = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, "mi").exec(out); return m ? m[1].trim() : ""; };

function classify(exe, hint = "") {
  const b = basename(exe).toLowerCase(), p = exe.toLowerCase(), h = hint.toLowerCase();
  if (b === "launcher.exe" || b === "opera.exe") return p.includes("opera gx") || h.includes("gx") ? byId("operagx") : byId("opera");
  if (b === "chrome.exe" && p.includes("\\chromium\\")) return byId("chromium");
  return KNOWN.find((k) => k.exes.includes(b)) ?? null;
}

let cache = null;
export async function list({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.list;
  const found = new Map();
  const add = (k, exe) => { if (k && exe && existsSync(exe) && !found.has(k.id)) found.set(k.id, { id: k.id, name: k.name, exe, family: k.family }); };
  // 1. the browsers Windows knows about (Settings → Default apps lists these)
  for (const hive of ["HKLM\\SOFTWARE\\Clients\\StartMenuInternet", "HKCU\\SOFTWARE\\Clients\\StartMenuInternet", "HKLM\\SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet"]) {
    const keys = (await reg(["query", hive])).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.toUpperCase().startsWith(hive.toUpperCase() + "\\"));
    for (const key of keys) {
      const cmd = valueOf(await reg(["query", `${key}\\shell\\open\\command`, "/ve"]), "\\(Default\\)");
      const exe = exeFromCommand(cmd);
      if (exe && !/iexplore\.exe$/i.test(exe)) add(classify(exe, key), exe);
    }
  }
  // 2. the usual install places, for anything the registry didn't mention
  for (const k of KNOWN) for (const p of k.paths) if (!found.has(k.id) && p && existsSync(p)) add(k, p);
  // 3. which one is the Windows default
  const def = await defaultId();
  const out = [...found.values()].map((b) => ({ ...b, isDefault: b.id === def })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || KNOWN.indexOf(byId(a.id)) - KNOWN.indexOf(byId(b.id)));
  cache = { at: Date.now(), list: out };
  return out;
}

// The Windows default browser's id (from its ProgId), or "" when it can't be told
export async function defaultId() {
  const progId = valueOf(await reg(["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice", "/v", "ProgId"]), "ProgId")
    || valueOf(await reg(["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice", "/v", "ProgId"]), "ProgId");
  if (!progId) return "";
  const k = KNOWN.find((x) => x.progIds.some((r) => r.test(progId)));
  if (k) return k.id;
  const exe = exeFromCommand(valueOf(await reg(["query", `HKCR\\${progId}\\shell\\open\\command`, "/ve"]), "\\(Default\\)"));
  return exe ? classify(exe, progId)?.id ?? "" : "";
}

// The browser for a saved choice. "default" (or anything not installed) → the Windows default if Dayspring can drive it
// well, else Chrome, else Edge, else whatever is installed. null when there's no browser at all.
export async function resolve(choice = "default") {
  const all = await list();
  if (!all.length) return null;
  const want = String(choice || "default").toLowerCase();
  const exact = all.find((b) => b.id === want);
  if (exact) return exact;
  const def = all.find((b) => b.isDefault);
  if (def) return def;
  return all.find((b) => b.id === "chrome") ?? all.find((b) => b.id === "edge") ?? all[0];
}

// Words for the settings pages: what a family can do on the Dayspring screen
export const familyNote = (f) => (f === "chromium" ? "" : f === "firefox" ? "Opens full screen in its own window. If the microphone doesn't start, allow it once when Firefox asks." : "Opens in a normal window (this browser can't do Dayspring's app window or full screen).");

// The media and study windows (Playwright) use real Chrome when it's installed, else Microsoft Edge (both play Spotify's
// protected music). Edge comes with every copy of Windows 10 and 11.
export const playwrightChannel = () => (byId("chrome").paths.some((p) => p && existsSync(p)) ? "chrome" : "msedge");
