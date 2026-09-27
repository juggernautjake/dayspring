// Sharing with friends is switched OFF, and with it off Dayspring is exactly as if the feature didn't exist.
// It never touches your own Dayspring or its data:
//   1. modules (no server): the switch is off by default; tools(), runTool() and the routes are inert; no intents come
//      from it; nothing in the pages shows it; the integration only ever produces private, shareable kinds
//   2. a throwaway copy (inside node_modules, ports 4750-4759, its own empty data, a pretend home) run with the switch
//      OFF and a probe loaded first: no social module beyond the switch itself is loaded, no key is generated, no
//      social request is made, no social files appear, and /api/social/* is 404 — after the background jobs have run
//   3. the same copy with the switch ON (dev + mock), to prove the probe and the gate really see a difference: the
//      routes answer, still no key until asked, then a key, a mock registration and a sync
//   node scripts/qa/social-flag.mjs [--keep]        exit 0 = all passed
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, openSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRATCH = join(DESK, "node_modules", ".dayspring-social-qa"), APP = join(SCRATCH, "app"), HOME = join(SCRATCH, "home");
const PROBE = join(DESK, "scripts", "qa", "social-probe.mjs");
const keep = process.argv.includes("--keep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const rec = (area, ok, note = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${area}${note ? " — " + String(note).slice(0, 240) : ""}`); };

// ---- 1. modules ------------------------------------------------------------------------------------------------------
delete process.env.DAYSPRING_SOCIAL;
process.env.DAYSPRING_DEV_SETTINGS = join(SCRATCH, "no-such-dev-settings.json");
const gate = await import(pathToFileURL(join(DESK, "lib", "social", "index.mjs")).href);
rec("switch is off by default", gate.enabled() === false);
rec("no AI tools while off", Array.isArray(gate.tools()) && gate.tools().length === 0);
rec("tools can't be run while off", (await gate.runTool("social_status", {})) === undefined && (await gate.runTool("social_reminders", {})) === undefined);
rec("routes answer 'not mine' while off", (await gate.handle({}, {}, { m: "GET", p: "/social/status", send: () => { throw new Error("sent"); } })) === false);
const gateSrc = readFileSync(join(DESK, "lib", "social", "index.mjs"), "utf8"), flagSrc = readFileSync(join(DESK, "lib", "social", "flag.mjs"), "utf8");
const staticImports = (s) => [...s.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
rec("the gate statically imports only the switch", JSON.stringify(staticImports(gateSrc)) === JSON.stringify(["./flag.mjs"]), staticImports(gateSrc).join(", "));
rec("the switch imports only node built-ins", staticImports(flagSrc).every((x) => x.startsWith("node:")));
process.env.DAYSPRING_SOCIAL = "1";
rec("(on: the tools appear, so the check above means something)", gate.tools().length === 2);
process.env.DAYSPRING_SOCIAL = "0";
rec("DAYSPRING_SOCIAL=0 forces it off", gate.enabled() === false);
delete process.env.DAYSPRING_SOCIAL;
// intents: none registered by the feature
const intentFiles = readdirSync(join(DESK, "lib", "intents")).filter((f) => f.endsWith(".mjs"));
rec("no intents come from the feature", intentFiles.every((f) => !/lib\/social|\.\.\/social\//.test(readFileSync(join(DESK, "lib", "intents", f), "utf8"))));
// UI: nothing in the pages refers to it (the dev mockup lives in lib/social and is served only when the switch is on)
const pub = readdirSync(join(DESK, "public")).filter((f) => /\.(html|js)$/.test(f));
const mentions = pub.filter((f) => /api\/social|social\.enabled|sharing with friends/i.test(readFileSync(join(DESK, "public", f), "utf8")));
rec("no UI for it in the pages", mentions.length === 0, mentions.join(", "));
rec("the dev mockup isn't a public page", !existsSync(join(DESK, "public", "dev", "social.html")) && !existsSync(join(DESK, "public", "social.html")));
// integration (with stand-in sources): everything private, only shareable kinds, texts only as local-only
const integ = await import(pathToFileURL(join(DESK, "lib", "social", "integration.mjs")).href);
const fake = {
  people: () => [{ id: "p1", name: "Pat Example", birthday: "03-04", year: 1990, notes: [{ id: "n1", at: "2025-01-02T10:00:00Z", text: "likes jazz", visibility: "private" }], visibility: "private" }],
  personPhotos: async () => ["ph1"], photoInfo: () => ({ id: "ph1", name: "IMG_1.jpg", taken: "2024-06-01T12:00:00Z", description: "At the lake", tags: ["lake"] }),
  lastContact: async () => ({ at: "2026-01-01T00:00:00Z" }), privateComms: async () => [{ id: "t1", at: "2026-01-01", kind: "text_message" }],
};
const items = await integ.shareables(fake);
rec("integration: note, birthday and photo, all private", items.length === 3 && items.every((x) => x.visibility === "private") && new Set(items.map((x) => x.kind)).size === 3, items.map((x) => `${x.kind}:${x.visibility}`).join(", "));
rec("integration: texts and calls are never shareable", !items.some((x) => /text|call|face/.test(x.kind)));
const lp = await integ.localPrivateFor("p1", fake);
rec("integration: texts only as local-only for the owner's own view", lp.length === 1 && lp[0].localOnly === true);

// ---- 2 and 3. a throwaway copy ---------------------------------------------------------------------------------------
async function freePort() {
  for (let p = 4750; p <= 4759; p++) if (await new Promise((ok) => { const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true))).listen(p, "127.0.0.1"); })) return p;
  throw new Error("ports 4750-4759 are all busy");
}
rmSync(SCRATCH, { recursive: true, force: true });
const SKIP = new Set(["data", ".env", "node_modules", "backups", "dist", "dist-out", "bin", ".git", "qa-out", "logs", "updates"]);
for (const e of readdirSync(DESK)) if (!SKIP.has(e)) cpSync(join(DESK, e), join(APP, e), { recursive: true, filter: (src) => !/\.log$/.test(src) });
mkdirSync(join(APP, "data"), { recursive: true });
for (const d of ["Documents", "Pictures", "AppData/Local", "AppData/Roaming"]) mkdirSync(join(HOME, d), { recursive: true });
const KEYDIR = join(HOME, "AppData", "Local", "Ecosystem");

let server = null;
async function start(label, extraEnv) {
  const port = await freePort(), base = `http://127.0.0.1:${port}`, log = join(SCRATCH, `probe-${label}.jsonl`);
  writeFileSync(log, "");
  const env = { ...process.env, PORT: String(port), USERPROFILE: HOME, HOME, LOCALAPPDATA: join(HOME, "AppData", "Local"), APPDATA: join(HOME, "AppData", "Roaming"),
    DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_DISPLAY: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_ECO: "1", SOCIAL_PROBE_LOG: log,
    DAYSPRING_DEV_SETTINGS: join(APP, "data", "dev-settings.json"), ...extraEnv };
  for (const k of Object.keys(env)) if (/API_KEY|TOKEN|SECRET|CLIENT_ID/i.test(k)) delete env[k];
  for (const k of ["DAYSPRING_SOCIAL", "DAYSPRING_SOCIAL_MOCK", "DAYSPRING_SOCIAL_SERVER"]) if (!(k in extraEnv)) delete env[k];
  const out = openSync(join(SCRATCH, `server-${label}.log`), "a");
  server = spawn(process.execPath, ["--import", pathToFileURL(PROBE).href, "server.mjs"], { cwd: APP, env, stdio: ["ignore", out, out], windowsHide: true });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(500); try { up = (await fetch(base + "/api/setup/state")).ok; } catch { /* starting */ } }
  rec(`throwaway copy starts, switch ${label} (${base})`, up, up ? "" : readFileSync(join(SCRATCH, `server-${label}.log`), "utf8").slice(-300));
  return { base, log, up };
}
async function stop() {
  if (!server) return;
  server.kill();
  for (let i = 0; i < 20 && server.exitCode === null; i++) await sleep(250);
  server = null;
}
const events = (log) => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const socialLoads = (ev) => [...new Set(ev.filter((e) => e.ev === "load").map((e) => (e.url.includes("/vendor/ecosystem-core/") ? "core:" : "desk:") + e.url.split("/").pop()))];
const status = async (base, path, init) => { try { return (await fetch(base + path, init)).status; } catch { return 0; } };
const json = async (base, path, init) => { try { const r = await fetch(base + path, init); return { status: r.status, body: await r.json().catch(() => ({})) }; } catch (e) { return { status: 0, body: { error: e.message } }; } };

try {
  // ---- 2. switch OFF ----
  const off = await start("off", {});
  if (off.up) {
    await sleep(8000);                       // let the startup and background jobs run
    const codes = await Promise.all([["GET", "/api/social/status"], ["GET", "/api/social/dev"], ["GET", "/api/social/candidates"], ["POST", "/api/social/device"], ["POST", "/api/social/sync"], ["GET", "/api/social/reminders"]]
      .map(([m, p]) => status(off.base, p, { method: m, headers: { "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined })));
    rec("off: every /api/social route is 404", codes.every((c) => c === 404), codes.join(" "));
    rec("off: no dev page at /dev/social.html", (await status(off.base, "/dev/social.html")) === 404);
    const home = await (await fetch(off.base + "/")).text().catch(() => "");
    rec("off: the Dayspring page doesn't mention it", !/api\/social|social\.enabled/i.test(home));
    await sleep(1000);
    const ev = events(off.log);
    rec("off: the probe ran", ev.some((e) => e.ev === "probe"));
    const loads = socialLoads(ev);
    rec("off: only the switch and gate were loaded (no engine, integration or ecosystem-core social)", loads.every((l) => ["desk:index.mjs", "desk:flag.mjs"].includes(l)) && loads.includes("desk:index.mjs"), loads.join(", "));
    rec("off: no key generated", !ev.some((e) => e.ev === "keygen"), ev.filter((e) => e.ev === "keygen").map((e) => e.type).join(","));
    rec("off: no social network request", !ev.some((e) => e.ev === "social-fetch"));
    rec("off: no social files in its data", !existsSync(join(APP, "data", "social")));
    rec("off: no device key file", !existsSync(KEYDIR) || !readdirSync(KEYDIR).some((f) => /^social-/.test(f)));
  }
  await stop();

  // ---- 3. switch ON (dev, with the mock server) — proves the probe and the gate see the difference ----
  const on = await start("on", { DAYSPRING_SOCIAL: "1", DAYSPRING_SOCIAL_MOCK: "1" });
  if (on.up) {
    await sleep(3000);
    const st = await json(on.base, "/api/social/status");
    rec("on: status answers", st.status === 200 && st.body.enabled === true, JSON.stringify(st.body).slice(0, 160));
    rec("on: still no key until asked", st.body?.device?.exists === false && !events(on.log).some((e) => e.ev === "keygen"));
    rec("on: the dev mockup is served", (await status(on.base, "/api/social/dev")) === 200);
    const dev = await json(on.base, "/api/social/device", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    rec("on: making the key when asked", dev.status === 200 && dev.body.created === true && events(on.log).some((e) => e.ev === "keygen" && /social/.test(e.stack)), JSON.stringify(dev.body).slice(0, 120));
    const reg = await json(on.base, "/api/social/register", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    rec("on: registers with the mock server", reg.status === 200 && reg.body.userId, JSON.stringify(reg.body).slice(0, 120));
    const sy = await json(on.base, "/api/social/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    rec("on: sync with the mock", sy.status === 200 && typeof sy.body.pulled === "number", JSON.stringify(sy.body).slice(0, 120));
    const cand = await json(on.base, "/api/social/candidates");
    rec("on: candidates list (all private)", cand.status === 200 && (cand.body.items ?? []).every((x) => x.visibility === "private"), `count ${cand.body.count}`);
    rec("on: the engine and ecosystem-core social were loaded", socialLoads(events(on.log)).some((l) => l.startsWith("core:")));
    rec("on: still no social request to any real server", !events(on.log).some((e) => e.ev === "social-fetch"));
  }
  await stop();
} finally {
  await stop();
  if (!keep) { await sleep(500); try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* in use: removed next run */ } }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
