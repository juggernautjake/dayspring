// Music and videos follow Dayspring's output (lib/sinkpick.mjs, lib/sinkfollow.mjs, lib/browser.mjs setSink):
//   1. the choice: exactly the device named in preferredOutputs, the role heuristic only when it's missing, the first
//      role in the order TV → headphones → speakers, the mixer's input while the mixer runs, the Windows default
//   2. the media browser's setSink with mocked devices, and moving again when the setting changes
//   3. the Dayspring screen: a page on one origin with a frame from ANOTHER site (like YouTube / Spotify's frames), in a
//      headless Chrome started the way the screen is (a DevTools pipe, no port): the chosen device is applied INSIDE the
//      frame (in-page elements, a never-attached Audio(), an AudioContext), the page's own elements are left alone,
//      frames added later start with the choice, and a settings change moves them within a second
//   4. nothing ever touches the Windows default: no PowerShell (or any other program but the browser) runs while
//      choosing and applying, and the code has no default-device or per-app routing calls
// Devices are mocked (a headless browser may have no real ones; nothing is ever played on or switched on a real device).
//   node scripts/qa/media-output.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import cp from "node:child_process";
import { syncBuiltinESMExports, createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHROME = process.env.QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* not yet */ } await sleep(50); } return v; }

// ---- every program started from here on is written down (4) ---------------------------------------------------------
const runs = [];
for (const k of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
  const orig = cp[k];
  cp[k] = function (file, ...rest) { runs.push([k, String(file), ...(Array.isArray(rest[0]) ? rest[0].map(String) : [])].join(" ")); return orig.call(this, file, ...rest); };
}
syncBuiltinESMExports();

// a throwaway settings file (the real one is never written)
const TMP = mkdtempSync(join(tmpdir(), "ds-media-output-"));
const NAMES = { tv: "Living Room TV (2- HD Audio Driver for Display Audio)", headset: "Speakers (Wireless Gaming Headset)", laptop: "Speaker (Realtek(R) Audio)" };
const PREFERRED = { tv: NAMES.tv, headphones: NAMES.headset, speakers: NAMES.laptop };
writeFileSync(join(TMP, "settings.json"), JSON.stringify({ audioOutputs: ["tv"], preferredOutputs: PREFERRED }));
process.env.DAYSPRING_SETTINGS_FILE = join(TMP, "settings.json");
process.env.DS_FOLLOW_MARK = join(TMP, "display-follow.json");
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const settings = await imp("lib/settings.mjs");
const sinkpick = await imp("lib/sinkpick.mjs");
const sinkfollow = await imp("lib/sinkfollow.mjs");
const browser = await imp("lib/browser.mjs");

// ---- 1. the choice --------------------------------------------------------------------------------------------------
{
  const outs = [
    { id: "default", label: "Default - " + NAMES.tv }, { id: "communications", label: "Communications - " + NAMES.headset },
    { id: "vm3", label: "Voicemeeter In 3 (VB-Audio Voicemeeter VAIO)" }, { id: "rt", label: NAMES.laptop }, { id: "vmi", label: "Voicemeeter Input (VB-Audio Voicemeeter VAIO)" },
    { id: "nv", label: "NVIDIA High Definition Audio" }, { id: "ph", label: NAMES.tv }, { id: "g733", label: NAMES.headset }, { id: "hp2", label: "Headphones (Other Headset)" },
  ];
  const pick = (roles, preferred = PREFERRED, list = outs, typeHints = {}) => sinkpick.pickOutput(list, { roles, preferred, typeHints });
  let r = pick(["tv"]);
  check("tv: exactly the device named in preferredOutputs, not the first TV-looking one", r.id === "ph" && r.how === "preferred", `${r.label} / ${r.how}`);
  r = pick(["headphones"]);
  check("headphones: the named headset, not another headset", r.id === "g733" && r.how === "preferred", r.label);
  r = pick(["speakers"]);
  check("speakers: the named laptop speaker", r.id === "rt", r.label);
  r = pick(["tv"], PREFERRED, outs.filter((d) => d.id !== "ph"));
  check("the named TV isn't plugged in: the role heuristic (another TV-ish device)", r.id === "nv" && r.how === "role", `${r.label} / ${r.how}`);
  r = pick(["tv"], PREFERRED, [...outs.filter((d) => d.id !== "ph"), { id: "ph3", label: "Living Room TV (3- HD Audio Driver for Display Audio)" }]);
  check("the named device renumbered by Windows (2- → 3-) is still that device", r.id === "ph3" && r.how === "preferred", r.label);
  r = pick(["headphones", "tv"]);
  check("several roles: TV first (one device for copy-protected music)", r.id === "ph", r.label);
  r = pick(["headphones", "tv"], PREFERRED, outs.filter((d) => !["ph", "nv"].includes(d.id)));
  check("several roles, no TV plugged in: the headset", r.id === "g733", r.label);
  r = pick(["speakers"], {}, outs.filter((d) => d.id !== "rt"));
  check("the heuristic never picks a Voicemeeter virtual device", !/voicemeeter/i.test(r.label), r.label);
  r = pick(["voicemeeter"]);
  check("mixer on: Voicemeeter Input (the existing mixer behaviour)", r.id === "vmi" && r.how === "mixer", r.label);
  r = pick(["default"]);
  check("Windows default: an empty sink id", r.id === "" && r.how === "default");
  r = pick(["tv"], {}, [{ id: "x1", label: "Speakers (Living Room Box)" }, { id: "x2", label: NAMES.laptop }], { "living room": "tv" });
  check("the owner's type hints (devices.json) count for the heuristic", r.id === "x1", r.label);
  r = pick(["tv"], PREFERRED, [{ id: "", label: NAMES.tv }]);
  check("no device ids (no permission): the default, never a guess", r.id === "");
}

// ---- mock devices for the browser checks (ids differ per origin, as Chrome's do) --------------------------------------
const MOCK = `(() => {
  const names = ${JSON.stringify(Object.values(NAMES).concat(["Voicemeeter Input (VB-Audio Voicemeeter VAIO)"]))};
  const h = (s) => { let x = 7; for (const ch of location.origin + "|" + s) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return "id" + x.toString(16); };
  window.__mockId = h;
  const list = [{ deviceId: "default", kind: "audiooutput", label: "Default - " + names[0], groupId: "" }, { deviceId: "communications", kind: "audiooutput", label: "Communications - " + names[1], groupId: "" }]
    .concat(names.map((n) => ({ deviceId: h(n), kind: "audiooutput", label: n, groupId: "" })));
  MediaDevices.prototype.enumerateDevices = async function () { return list.map((d) => ({ ...d })); };
  window.__sinkLog = [];
  const accept = (id) => !id || list.some((d) => d.deviceId === id);
  Object.defineProperty(HTMLMediaElement.prototype, "sinkId", { configurable: true, get() { return this.__sink ?? ""; } });
  HTMLMediaElement.prototype.setSinkId = function (id) { if (!accept(id)) return Promise.reject(new DOMException("unknown device", "NotFoundError")); this.__sink = id; window.__sinkLog.push(id); return Promise.resolve(); };
  if (window.AudioContext) { Object.defineProperty(AudioContext.prototype, "sinkId", { configurable: true, get() { return this.__sink ?? ""; } }); AudioContext.prototype.setSinkId = function (id) { if (!accept(id)) return Promise.reject(new DOMException("unknown device", "NotFoundError")); this.__sink = id; return Promise.resolve(); }; }
})();`;
// a short silent WAV, so elements really have something to play
const WAV = "data:audio/wav;base64," + (() => { const n = 800, b = Buffer.alloc(44 + n); b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44); return b.toString("base64"); })();
function serve(route) { return new Promise((r) => { const s = http.createServer((q, res) => { const body = route(q.url); res.writeHead(body ? 200 : 404, { "content-type": "text/html" }); res.end(body ?? ""); }).listen(0, "127.0.0.1", () => r(s)); }); }
const FRAME = `<!doctype html><video id="v" loop></video><script>
  const v = document.getElementById("v"); v.src = ${JSON.stringify(WAV)}; v.play().catch(() => {});
  const det = new Audio(${JSON.stringify(WAV)}); det.loop = true; det.play().catch(() => {});        // never put on the page, like Spotify's
  const ac = new AudioContext();
  window.state = () => ({ v: v.sinkId, det: det.sinkId, ac: ac.sinkId, ids: { tv: __mockId(${JSON.stringify(NAMES.tv)}), headset: __mockId(${JSON.stringify(NAMES.headset)}), laptop: __mockId(${JSON.stringify(NAMES.laptop)}) } });
</script>`;
const frameSrv = await serve((u) => (u.startsWith("/frame") ? FRAME : null));
const FPORT = frameSrv.address().port;
const TOP = (u) => (u.startsWith("/top") ? `<!doctype html><title>Dayspring</title><audio id="own" loop></audio>
  <iframe id="f1" src="http://127.0.0.1:${FPORT}/frame?1" allow="autoplay"></iframe>
  <script>const own = document.getElementById("own"); own.src = ${JSON.stringify(WAV)}; own.play().catch(() => {});
  window.addFrame = () => { const f = document.createElement("iframe"); f.id = "f2"; f.src = "http://127.0.0.1:${FPORT}/frame?2"; document.body.appendChild(f); };</script>` : null);
const topSrv = await serve(TOP);
const TPORT = topSrv.address().port;

// ---- 2. the media browser's setSink ----------------------------------------------------------------------------------
{
  let pw = null;
  for (const p of [process.env.QA_PLAYWRIGHT, join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].filter(Boolean)) { try { pw = await import(pathToFileURL(p).href); break; } catch { /* next */ } }
  pw ??= createRequire(join(DESK, "package.json"))("playwright-core");
  const b = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext();
  await ctx.addInitScript({ content: MOCK });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${TPORT}/top`);
  const before = runs.length;
  const label = await browser.setSink(p, ["tv"]);
  const ids = await p.evaluate((n) => ({ tv: __mockId(n.tv), headset: __mockId(n.headset) }), NAMES);
  check("setSink picks the device named in preferredOutputs", label === NAMES.tv, label);
  check("setSink applies it to the page's audio", (await p.evaluate(() => document.getElementById("own").sinkId)) === ids.tv);
  await p.evaluate((w) => { window.later = new Audio(w); window.later.play().catch(() => {}); }, WAV);
  check("an element that starts later (never on the page) follows too", (await until(() => p.evaluate((id) => window.later.sinkId === id, ids.tv))) === true);
  const t0 = Date.now();
  settings.set({ audioOutputs: ["headphones"] });
  const moved = await until(() => p.evaluate((id) => document.getElementById("own").sinkId === id && window.later.sinkId === id, ids.headset), 3000);
  check("changing Dayspring's output moves the media browser's music (within a second)", moved === true && Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
  settings.set({ audioOutputs: ["default"] });
  check("back to the Windows default: an empty sink id", (await until(() => p.evaluate(() => document.getElementById("own").sinkId === ""), 3000)) === true);
  check("the mixer's input when asked (voicemeeter)", (await browser.setSink(p, ["voicemeeter"])) === "Voicemeeter Input (VB-Audio Voicemeeter VAIO)");
  check("setSink ran no program (no PowerShell, nothing but the browser)", runs.slice(before).length === 0, runs.slice(before).join(" | "));
  await b.close();
}

// ---- 3. the Dayspring screen: a frame from another site ---------------------------------------------------------------
{
  settings.set({ audioOutputs: ["tv"], preferredOutputs: PREFERRED });
  const prof = mkdtempSync(join(tmpdir(), "ds-media-output-chrome-"));
  const before = runs.length;
  const me = sinkfollow.launch(CHROME, ["--headless=new", "--mute-audio", `--user-data-dir=${prof}`, "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "about:blank"],
    { origin: `http://localhost:${TPORT}`, prelude: MOCK });
  const launched = runs.slice(before);
  check("the screen's browser starts with a DevTools pipe and no port", launched.length === 1 && launched[0].includes("--remote-debugging-pipe") && !launched.some((x) => /remote-debugging-port|remote-debugging-address/.test(x)), launched.join(" | ").slice(0, 160));
  await me.ready;
  check("the pipe answers (the server controls the window)", sinkfollow.active() && Boolean((await me.c.send("Browser.getVersion")).product));
  const { targetId } = await me.c.send("Target.createTarget", { url: `http://localhost:${TPORT}/top` });
  const frameSession = async (tag) => { for (const [sid, s] of me.sessions) { if (s.type !== "iframe") continue; const r = await me.c.send("Runtime.evaluate", { expression: "location.search", returnByValue: true }, sid).catch(() => null); if (r?.result?.value === tag) return sid; } return null; };
  const state = async (sid) => (await me.c.send("Runtime.evaluate", { expression: "window.state && state()", returnByValue: true }, sid)).result.value;
  const sid1 = await until(() => frameSession("?1"), 8000);
  check("the frame from another site runs in its own process (as YouTube's and Spotify's do)", Boolean(sid1));
  let st = await until(async () => { const s = await state(sid1); return s && s.v === s.ids.tv && s.det === s.ids.tv && s.ac === s.ids.tv ? s : null; }, 4000);
  check("inside the frame: the video, a never-attached Audio() and an AudioContext play on the named TV", Boolean(st), JSON.stringify(st ?? await state(sid1)));
  const pageSid = [...me.sessions].find(([, s]) => s.type === "page" && s.url.includes(`localhost:${TPORT}`))?.[0] ?? [...me.sessions].find(([, s]) => s.type === "page")?.[0];
  const top = async (expr) => (await me.c.send("Runtime.evaluate", { expression: expr, returnByValue: true }, pageSid)).result.value;
  check("the Dayspring page's own elements are left alone (it routes its own sound)", (await top("document.getElementById('own').sinkId")) === "");
  check("the Dayspring page knows its media follows (no 'plays on the Windows default' note)", (await top("window.__dsMediaFollows === true")) === true);
  // change the output: the frame moves within a second
  let t0 = Date.now();
  settings.set({ audioOutputs: ["headphones"] });
  st = await until(async () => { const s = await state(sid1); return s.v === s.ids.headset && s.det === s.ids.headset && s.ac === s.ids.headset ? s : null; }, 3000);
  check("changing Dayspring's output moves what's playing in the frame (within a second)", Boolean(st) && Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
  t0 = Date.now();
  settings.set({ preferredOutputs: { ...PREFERRED, headphones: "Headphones (Not Plugged In)" }, audioOutputs: ["speakers"] });
  st = await until(async () => { const s = await state(sid1); return s.v === s.ids.laptop ? s : null; }, 3000);
  check("…and again to the laptop speaker", Boolean(st), `${Date.now() - t0} ms`);
  settings.set({ audioOutputs: ["headphones", "tv"], preferredOutputs: PREFERRED });
  st = await until(async () => { const s = await state(sid1); return s.v === s.ids.tv ? s : null; }, 3000);
  check("several roles (headphones + TV): the first in TV → headphones → speakers that's there", Boolean(st));
  // a frame opened after the change starts with the current choice
  settings.set({ audioOutputs: ["headphones"] });
  await sleep(300);
  await top("addFrame()");
  const sid2 = await until(() => frameSession("?2"), 8000);
  st = sid2 && await until(async () => { const s = await state(sid2); return s && s.v === s.ids.headset ? s : null; }, 4000);
  check("a new frame (the next video) starts on the current choice", Boolean(st), sid2 ? JSON.stringify(await state(sid2)) : "no frame");
  settings.set({ audioOutputs: ["default"] });
  st = await until(async () => { const s = await state(sid1); return s.v === "" && s.det === "" ? s : null; }, 3000);
  check("Windows default chosen: the frames go back to the default", Boolean(st));
  const upd = await sinkfollow.update();
  check("update() reports what each frame picked", upd.some((x) => x.label === "default"), JSON.stringify(upd).slice(0, 160));
  check("no DevTools port file (DevToolsActivePort) was written: nothing to connect to", !existsSync(join(prof, "DevToolsActivePort")));
  check("applying in the frames ran no program (no PowerShell, nothing but the browser)", runs.slice(before + 1).length === 0, runs.slice(before + 1).join(" | "));
  await me.c.send("Target.closeTarget", { targetId }).catch(() => {});
  await me.c.send("Browser.close").catch(() => {});
  await until(() => !sinkfollow.active(), 5000);
  check("the pipe closing is noticed (the screen's follow state resets)", !sinkfollow.active());
  try { process.kill(me.child.pid, 0); me.child.kill(); } catch { /* already gone */ }
  await sleep(500);
  try { rmSync(prof, { recursive: true, force: true }); } catch { /* Chrome may hold a file a moment longer */ }
}

// ---- 4. the Windows default is never touched ------------------------------------------------------------------------
{
  check("no program at all was started except the test browser (so no PowerShell / audio-default.ps1)", runs.every((x) => /chrome\.exe/i.test(x)), runs.filter((x) => !/chrome\.exe/i.test(x)).join(" | "));
  const FORBID = /powershell|audio-default\.ps1|IPolicyConfig|PolicyConfig|SetDefaultEndpoint|SetPersistedDefaultAudioEndpoint|AudioPolicyConfig|nircmd|SoundVolumeView|Set-AudioDevice|setdefaultsounddevice/i;
  for (const f of ["lib/sinkpick.mjs", "lib/sinkfollow.mjs", "lib/cdp-pipe.mjs", "lib/browser.mjs"]) {
    const src = readFileSync(join(DESK, f), "utf8").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join("\n");
    check(`${f}: no Windows default-device or per-app routing calls`, !FORBID.test(src), (FORBID.exec(src) ?? [""])[0]);
  }
  const disp = readFileSync(join(DESK, "lib/display.mjs"), "utf8");
  check("lib/display.mjs: no audio-device switching (its PowerShell only lists screens and moves its window)", !/audio-default\.ps1|IPolicyConfig|PolicyConfig|SetDefaultEndpoint|Set-AudioDevice/i.test(disp));
}

// ---- 5. reopening the display after a restart: an explicit call from server.mjs, never a side effect of loading ----------
{
  const disp = readFileSync(join(DESK, "lib/display.mjs"), "utf8"), srv = readFileSync(join(DESK, "server.mjs"), "utf8");
  const topLevel = disp.split(/\r?\n/).filter((l) => /^(if|setTimeout|sinkfollow\.)/.test(l));
  check("lib/display.mjs does nothing when it's loaded (no top-level reopen)", topLevel.length === 0 && /export function resumeAfterRestart\(/.test(disp), topLevel.join(" | "));
  check("server.mjs calls display.resumeAfterRestart() once, after it starts listening", (srv.match(/display\.resumeAfterRestart\(\)/g) ?? []).length === 1 && srv.indexOf("display.resumeAfterRestart()") > srv.indexOf('.listen(PORT, "127.0.0.1"'));
  const display = await imp("lib/display.mjs");
  const keep = { ...process.env }; process.env.DAYSPRING_DISPLAY = "1"; process.env.DAYSPRING_NO_BROWSER = "1";
  check("…and in tests (DAYSPRING_NO_BROWSER / DS_LAUNCH_LOG) it opens nothing", display.resumeAfterRestart() === false);
  delete process.env.DAYSPRING_DISPLAY; if (keep.DAYSPRING_NO_BROWSER === undefined) delete process.env.DAYSPRING_NO_BROWSER;
}

frameSrv.close(); topSrv.close();
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ }
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
