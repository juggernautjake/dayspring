// Smart devices, against simulators only (never a real device, never a scan of the real network):
//   discovery (Kasa UDP, Shelly, Tapo, Meross, WLED on 127.0.0.1), each adapter (Kasa HS300 / KP303, Shelly Gen 2 with a
//   digest password and Gen 1, Tapo P300 over KLAP with the right and a wrong login, Meross, custom HTTP (Tasmota) and
//   MQTT, Home Assistant and Matter entities (a fake HA), WLED and Hue lights), Wake-on-LAN packets, 60+ spoken phrases
//   (numbers, ordinals, aliases, rooms, scenes, schedules), scenes and groups, schedules, the safety refusals (this PC,
//   a printing or hot printer, critical outlets, heaters, "everything off" / "everything on", rate limits, not the
//   owner), the Devices permission (off / ask / on and per device), and the remote entry point (same rules; a risky
//   command's yes must come from the computer that sent it).
//   node scripts/qa/devices.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer as netServer } from "node:net";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TMP = mkdtempSync(join(tmpdir(), "ds-devices-"));
Object.assign(process.env, { DAYSPRING_DEVICES_FILE: join(TMP, "devices-home.json"), DAYSPRING_PERMISSIONS_FILE: join(TMP, "permissions.json"), DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"),
  DAYSPRING_TEST_CRYPTO: "fake", DAYSPRING_NO_LAN_SCAN: "1", DAYSPRING_NO_BROWSER: "1", DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"), DAYSPRING_NO_KEEPAWAKE: "1" });
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? `  (${typeof got === "string" ? got : JSON.stringify(got)})`.slice(0, 400) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sims = await imp("scripts/qa/fixtures/devices/sims.mjs");
const devices = await imp("lib/devices/index.mjs");
const registry = await imp("lib/devices/registry.mjs");
const safety = await imp("lib/devices/safety.mjs");
const discovery = await imp("lib/devices/discovery.mjs");
const { parse } = await imp("lib/devices/parse.mjs");
const skills = await imp("lib/devices/skills.mjs");
const power = await imp("lib/devices/adapters/power.mjs");
const lights = await imp("lib/devices/adapters/lights.mjs");
const haShared = await imp("lib/devices/adapters/ha-shared.mjs");
const kasa = await imp("lib/devices/adapters/kasa.mjs");
const tapoA = await imp("lib/devices/adapters/tapo.mjs");
const customA = await imp("lib/devices/adapters/custom.mjs");
const permissions = await imp("lib/permissions.mjs");
const confirm = await imp("lib/confirm.mjs");
const activity = await imp("lib/activity.mjs");

// ---- the simulated home ------------------------------------------------------------------------------------------------
const K = await sims.kasaSim({ outlets: 6, model: "HS300(US)" });
const K3 = await sims.kasaSim({ outlets: 3, model: "KP303(US)", alias: "Porch strip", deviceId: "8006AAAABBBBCCCCDDDDEEEEFFFF000011112222" });
const S = await sims.shellySim({ gen: 2, outlets: 4, password: "shelly-pw" });
const S1 = await sims.shellySim({ gen: 1, outlets: 2 });
const T = await sims.tapoSim({ username: "owner@example.com", password: "tapo-pass-1", outlets: 3 });
const M = await sims.merossSim({ key: "meross-key", outlets: 3 });
const W = await sims.wledSim();
const H = await sims.hueSim({ key: "hue-app-key" });
const TA = await sims.tasmotaSim();
const sink = await sims.udpSink();
const L = "127.0.0.1";

// ---- 1. discovery (simulators only) --------------------------------------------------------------------------------------
{
  let refused = false; try { await discovery.discover(); } catch { refused = true; }
  check("discovery: a real LAN scan is refused in tests (DAYSPRING_NO_LAN_SCAN)", refused);
  const found = await discovery.discover({ kasaTargets: [{ host: L, port: K.udpPort }, { host: L, port: K3.udpPort }], hosts: [`${L}:${S.port}`, `${L}:${S1.port}`, `${L}:${T.port}`, `${L}:${M.port}`, `${L}:${W.port}`], timeoutMs: 800 });
  const by = (a) => found.filter((x) => x.adapter === a);
  check("discovery: both Kasa strips answer the UDP broadcast, with model and outlets", by("kasa").length === 2 && by("kasa").some((x) => x.model === "HS300" && x.outlets === 6) && by("kasa").some((x) => x.model === "KP303" && x.outlets === 3), by("kasa"));
  check("discovery: Kasa children's full ids are rebuilt from deviceId + short id", by("kasa").find((x) => x.model === "HS300")?.childIds?.[2] === "8006A8F1D3C2B4E5F60718293A4B5C6D7E8F9A0B02");
  check("discovery: Shelly Gen 2 (4 switches, needs a password) and Gen 1 (2 relays)", by("shelly").some((x) => x.gen === 2 && x.needsLogin && x.name === "Office strip") && by("shelly").some((x) => x.gen === 1 && x.outlets === 2), by("shelly"));
  check("discovery: a Tapo (KLAP) device is recognised and marked as needing the TP-Link login", by("tapo").length === 1 && by("tapo")[0].needsLogin, by("tapo"));
  check("discovery: Meross is recognised (needs its key)", by("meross").length === 1 && by("meross")[0].needsLogin, by("meross"));
  check("discovery: WLED is recognised", by("wled").length === 1 && by("wled")[0].name === "Desk LEDs", found.map((x) => x.adapter));
  const parsed = kasa.parseDiscovery(kasa.encrypt(JSON.stringify({ system: { get_sysinfo: { model: "KP115(US)", alias: "Kettle", mac: "AA:BB", relay_state: 1, deviceId: "X" } } }), { withLength: false }), { address: "10.0.0.9", port: 9999 });
  check("discovery parse: a single plug's answer", parsed?.model === "KP115" && parsed.outlets === 1 && parsed.host === "10.0.0.9" && parsed.name === "Kettle", parsed);
  check("discovery parse: garbage is ignored", kasa.parseDiscovery(Buffer.from("hello"), { address: "1.2.3.4", port: 9999 }) === null);
}

// ---- 2. the home: strips, devices, scenes, groups ---------------------------------------------------------------------
registry.saveStrip({ id: "A", name: "Strip A", adapter: "kasa", host: L, port: K.port, outlets: 6, model: "HS300" });
registry.saveStrip({ id: "B", name: "Strip B", adapter: "shelly", host: L, port: S.port, outlets: 4, model: "Pro 4PM", secret: { password: "shelly-pw" } });
registry.saveStrip({ id: "C", name: "Strip C", adapter: "tapo", host: L, port: T.port, outlets: 3, model: "P300", secret: { username: "owner@example.com", password: "tapo-pass-1" } });
registry.saveStrip({ id: "D", name: "Kitchen strip", adapter: "meross", host: L, port: M.port, outlets: 3, model: "MSS425F", secret: { key: "meross-key" } });
registry.saveStrip({ id: "E", name: "Porch strip", adapter: "kasa", host: L, port: K3.port, outlets: 3, model: "KP303" });
registry.saveStrip({ id: "F", name: "Shelly 2.5", adapter: "shelly", host: L, port: S1.port, outlets: 2, model: "SHSW-25", gen: 1 });
registry.saveStrip({ id: "G", name: "Tasmota plug", adapter: "custom", host: `${L}:${TA.port}`, outlets: 2, custom: customA.TEMPLATES.tasmota_http.custom });
check("secrets: passwords are sealed, never in the file as plain text", !/shelly-pw|tapo-pass-1|meross-key/.test(readFileSync(process.env.DAYSPRING_DEVICES_FILE, "utf8")) && registry.secretFor("strip:B").password === "shelly-pw");
const dev = (x) => registry.saveDevice(x);
dev({ name: "Monitor", type: "monitor", room: "office", power: [{ via: "outlet", strip: "A", outlet: 1 }] });
dev({ name: "Speakers", type: "speaker", room: "office", power: [{ via: "outlet", strip: "A", outlet: 2 }] });
dev({ name: "Computer", type: "computer", room: "office", aliases: ["my pc", "the desktop"], hostsDayspring: true, power: [{ via: "outlet", strip: "A", outlet: 3 }, { via: "wol", mac: "3C-7C-3F-1A-2B-4D", broadcast: L, port: sink.port }] });
dev({ name: "Fan 1", type: "fan", room: "office", power: [{ via: "outlet", strip: "A", outlet: 4 }] });
dev({ name: "Printer 3", type: "printer", room: "garage", printer: "p3", aliases: ["the x1"], power: [{ via: "outlet", strip: "A", outlet: 5 }] });
dev({ name: "Router", type: "router", room: "office", power: [{ via: "outlet", strip: "A", outlet: 6 }] });
dev({ name: "TV", type: "tv", room: "living room", aliases: ["the television"], power: [{ via: "outlet", strip: "B", outlet: 1 }] });
dev({ name: "Fan 2", type: "fan", room: "bedroom", aliases: ["the bedroom fan"], power: [{ via: "outlet", strip: "B", outlet: 2 }] });
dev({ name: "Lamp", type: "light", room: "bedroom", aliases: ["bedroom lamp"], power: [{ via: "outlet", strip: "B", outlet: 3 }] });
dev({ name: "Space heater", type: "heater", room: "garage", autoOffMinutes: 60, power: [{ via: "outlet", strip: "B", outlet: 4 }] });
dev({ name: "Printer 1", type: "printer", room: "garage", printer: "p1", power: [{ via: "outlet", strip: "C", outlet: 1 }] });
dev({ name: "Printer 2", type: "printer", room: "garage", printer: "p2", power: [{ via: "outlet", strip: "C", outlet: 2 }] });
dev({ name: "Garage light", type: "light", room: "garage", power: [{ via: "outlet", strip: "C", outlet: 3 }] });
dev({ name: "Fridge", type: "fridge", room: "kitchen", power: [{ via: "outlet", strip: "D", outlet: 1 }] });
dev({ name: "Coffee maker", type: "coffee", room: "kitchen", power: [{ via: "outlet", strip: "D", outlet: 2 }] });
dev({ name: "Kitchen radio", type: "speaker", room: "kitchen", power: [{ via: "outlet", strip: "D", outlet: 3 }] });
dev({ name: "Desk LEDs", type: "light", room: "office", aliases: ["desk lights", "the led strip"], control: { via: "wled", host: `${L}:${W.port}` } });
dev({ name: "Porch light", type: "light", room: "porch", power: [{ via: "outlet", strip: "E", outlet: 2 }] });
dev({ name: "Aquarium", type: "other", room: "living room", power: [{ via: "outlet", strip: "F", outlet: 1 }] });
dev({ name: "Christmas tree", type: "light", room: "living room", aliases: ["the tree"], power: [{ via: "outlet", strip: "G", outlet: 2 }] });
dev({ name: "Hallway switch", type: "light", room: "hallway", power: [{ via: "homeassistant", entity: "switch.hallway" }] });
dev({ name: "Matter plug", type: "other", room: "hallway", power: [{ via: "matter", entity: "switch.matter_plug" }] });
registry.saveScene({ name: "Movie mode", aliases: ["movie time"], steps: [{ device: "tv", action: "on" }, { device: "lamp", action: "off" }, { device: "fan-2", action: "off" }] });
registry.saveGroup({ name: "Fans", members: ["fan-1", "fan-2"] });
registry.setOptions({ minToggleSeconds: 0, maxTogglesPerMinute: 50, maxActionsPerMinute: 500, wolDelaySeconds: 0.05 });
check("critical: the router and the fridge are critical by default; the PC running Dayspring is critical", registry.device("router").critical && registry.device("fridge").critical && registry.device("computer").critical);

// printers' state for the rules: 3 is printing, 2 is idle but hot, 1 is idle and cold
const PSTATUS = { p1: { state: "idle", hot: false, nozzle: 24, bed: 22 }, p2: { state: "finished", hot: true, nozzle: 180, bed: 60 }, p3: { state: "printing", hot: true, progress: 45, nozzle: 220, bed: 60 } };
const announced = [];
devices.setDeps({ printerStatus: (id) => PSTATUS[id] ?? null, announce: (x) => announced.push(x), broadcast: () => {}, ownerName: () => "Sam" });
const fakeHA = { calls: [], states: { "switch.hallway": "off", "switch.matter_plug": "off" }, connected: () => true, entity: async (id) => ({ id, state: fakeHA.states[id] ?? "off", attributes: {} }), service: async (d, s, data) => { fakeHA.calls.push([d, s, data.entity_id]); fakeHA.states[data.entity_id] = s === "turn_on" ? "on" : "off"; } };
haShared._setHA(fakeHA);

// ---- 3. 60+ phrases: numbers, ordinals, aliases, rooms, scenes ----------------------------------------------------------
{
  const ids = (p) => { if (!p) return null; if (p.kind === "scene") return ["scene:" + (devices.findScene(p.name)?.id ?? "?")]; const r = devices.resolve(p.target ?? "", { scope: p.scope }); return r ? (r.kind === "ambiguous" ? ["?ambiguous"] : r.devices.map((d) => d.id).sort()) : null; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort());
  const CASES = [
    ["turn on my computer", "control", "on", ["computer"]], ["turn the computer on", "control", "on", ["computer"]], ["power on my pc", "control", "on", ["computer"]], ["wake up the desktop", "control", "on", ["computer"]], ["boot up my computer", "control", "on", ["computer"]],
    ["turn fan number 2 off", "control", "off", ["fan-2"]], ["turn off fan two", "control", "off", ["fan-2"]], ["turn the second fan off", "control", "off", ["fan-2"]], ["switch off fan #2", "control", "off", ["fan-2"]], ["fan 2 off", "control", "off", ["fan-2"]],
    ["turn off fan to", "control", "off", ["fan-2"]], ["turn off the 2nd fan", "control", "off", ["fan-2"]], ["turn off the bedroom fan", "control", "off", ["fan-2"]], ["turn on fan 1", "control", "on", ["fan-1"]], ["turn on the first fan", "control", "on", ["fan-1"]],
    ["turn on the office fan", "control", "on", ["fan-1"]], ["turn on 3D printer number 3", "control", "on", ["printer-3"]], ["turn on printer 3", "control", "on", ["printer-3"]], ["turn on the third printer", "control", "on", ["printer-3"]], ["power up 3-d printer three", "control", "on", ["printer-3"]],
    ["switch printer #3 on", "control", "on", ["printer-3"]], ["turn on the x1", "control", "on", ["printer-3"]], ["power off printer one", "control", "off", ["printer-1"]], ["turn printer 1 off", "control", "off", ["printer-1"]], ["turn off the 1st printer", "control", "off", ["printer-1"]],
    ["turn on printer #2", "control", "on", ["printer-2"]], ["turn on the tv", "control", "on", ["tv"]], ["switch the tv off", "control", "off", ["tv"]], ["turn off the television", "control", "off", ["tv"]], ["turn off the telly", "control", "off", ["tv"]],
    ["turn on the lamp", "control", "on", ["lamp"]], ["turn off the bedroom lamp", "control", "off", ["lamp"]], ["toggle the lamp", "control", "toggle", ["lamp"]], ["turn on the speakers", "control", "on", ["speakers"]], ["turn off the monitor", "control", "off", ["monitor"]],
    ["turn on the garage light", "control", "on", ["garage-light"]], ["turn on the porch light", "control", "on", ["porch-light"]], ["turn off the aquarium", "control", "off", ["aquarium"]], ["turn on the tree", "control", "on", ["christmas-tree"]], ["turn on the christmas tree", "control", "on", ["christmas-tree"]],
    ["turn on the hallway switch", "control", "on", ["hallway-switch"]], ["turn on the space heater", "control", "on", ["space-heater"]], ["turn off the router", "control", "off", ["router"]], ["turn off the fridge", "control", "off", ["fridge"]], ["turn on the coffee maker", "control", "on", ["coffee-maker"]],
    ["shut down the computer", "control", "off", ["computer"]], ["turn off everything in the garage", "control", "off", ["garage-light", "printer-1", "printer-2", "printer-3", "space-heater"]],
    ["turn everything off in the office at 10 pm", "control", "off", ["computer", "desk-leds", "fan-1", "monitor", "router", "speakers"]], ["office on", "control", "on", ["computer", "desk-leds", "fan-1", "monitor", "router", "speakers"]],
    ["turn off all the fans", "control", "off", ["fan-1", "fan-2"]], ["turn the fans off", "control", "off", ["fan-1", "fan-2"]], ["turn off everything", "control", "off", null], ["kitchen off", "control", "off", ["coffee-maker", "fridge", "kitchen-radio"]],
    ["movie mode", "scene", null, ["scene:movie-mode"]], ["turn on movie mode", "scene", null, ["scene:movie-mode"]], ["movie time", "scene", null, ["scene:movie-mode"]],
    ["set the desk lights to blue", "set", "color", ["desk-leds"]], ["dim the desk leds to 30 percent", "set", "brightness", ["desk-leds"]], ["set the led strip to 80%", "set", "brightness", ["desk-leds"]], ["set the desk lights to the rainbow effect", "set", "effect", ["desk-leds"]],
    ["is the tv on?", "status", null, ["tv"]], ["is the television off", "status", null, ["tv"]], ["is fan 2 running", "status", null, ["fan-2"]], ["is printer 2 on", "status", null, ["printer-2"]],
    ["what's on right now?", "whatson", null, null], ["what devices are on", "whatson", null, null], ["is anything on", "whatson", null, null],
    ["turn the tv off every night at 11 pm", "control", "off", ["tv"]], ["turn on fan 2 in 30 minutes", "control", "on", ["fan-2"]], ["what's scheduled for my devices", "schedules", null, null],
    ["open the devices page", "page", null, null], ["list my smart devices", "list", null, null], ["cancel the tv schedule", "cancelschedule", null, null],
  ];
  let ok = 0; const bad = [];
  for (const [t, kind, action, want] of CASES) {
    const p = parse(t);
    const k = p?.kind === "set" ? "set" : p?.kind;
    let good = k === kind && (action == null || p.action === action);
    if (good && want) good = same(ids(p), want);
    if (good && kind === "control" && t === "turn off everything") good = p.scope?.all === true && !p.scope.room;
    if (good) ok++; else bad.push(`${t} → ${JSON.stringify(p)} ${JSON.stringify(ids(p))}`);
  }
  check(`phrases: ${ok} of ${CASES.length} understood (numbers, ordinals, aliases, rooms, scenes, times)`, ok === CASES.length && CASES.length >= 60, bad.slice(0, 6).join(" | "));
  const w = parse("turn everything off in the office at 10 pm", new Date("2026-09-28T15:00:00"));
  check("phrases: \"at 10 pm\" is tonight at 22:00", new Date(w.when.at).getHours() === 22 && new Date(w.when.at).getDate() === 28, w.when);
  const d = parse("turn the tv off every night at 11 pm");
  check("phrases: \"every night at 11 pm\" is a daily schedule at 23:00", d.when?.daily === "23:00", d.when);
  check("phrases: unknown things aren't guessed (\"turn on the jacuzzi\")", devices.resolve("jacuzzi") === null);
  check("phrases: \"the fan\" with two fans asks which", devices.resolve("fan")?.kind === "ambiguous");
}

// ---- 4. the Devices permission ----------------------------------------------------------------------------------------
{
  permissions.set({ devices: "off" });
  const r = await devices.control({ target: "fan 2", action: "on", surface: "tv" });
  check("permission off: nothing is switched, and it says where to turn it on", !r.ok && /turned off/i.test(r.text) && !S.on[1], r.text);
  permissions.set({ devices: "ask" });
  const a = await devices.control({ target: "fan 2", action: "on", surface: "tv" });
  check("permission ask: even a fan asks first", a.needsConfirm && !S.on[1], a.text);
  registry.saveDevice({ id: "fan-1", permission: "on" });
  const o = await devices.control({ target: "fan 1", action: "on", surface: "tv" });
  check("per device: fan 1 set to \"on\" goes ahead while the rest ask", o.ok && K.state()[3] === true, o.text);
  permissions.set({ devices: "on" });
  registry.saveDevice({ id: "lamp", permission: "off" });
  const l = await devices.control({ target: "lamp", action: "on", surface: "tv" });
  check("per device: the lamp set to \"off\" is refused while everything else is allowed", !l.ok && !S.on[2], l.text);
  registry.saveDevice({ id: "lamp", permission: "inherit" }); registry.saveDevice({ id: "fan-1", permission: "inherit" });
}

// ---- 5. switching, through every adapter --------------------------------------------------------------------------------
{
  let r = await devices.control({ target: "fan 2", action: "on", surface: "tv" });
  check("Shelly Gen 2 (digest password): fan 2 on (outlet 2)", r.ok && S.on[1] === true && S.log.some((x) => x.includes("Switch.Set?id=1&on=true")), r.text);
  r = await devices.control({ target: "the tv", action: "on", surface: "tv" });
  check("Shelly: the TV on (outlet 1)", r.ok && S.on[0] === true, r.text);
  r = await devices.control({ target: "garage light", action: "on", surface: "tv" });
  check("Tapo P300 over KLAP: outlet 3 on", r.ok && T.state()[2] === true && T.log.some((j) => j.method === "control_child"), r.text);
  r = await devices.control({ target: "kitchen radio", action: "on", surface: "tv" });
  check("Meross MSS425F (signed): outlet 3 on", r.ok && M.ch[3] === 1, r.text);
  r = await devices.control({ target: "porch light", action: "on", surface: "tv" });
  check("Kasa KP303: outlet 2 on (child id context)", r.ok && K3.state()[1] === true && !K3.state()[0], r.text);
  r = await devices.control({ target: "aquarium", action: "on", surface: "tv" });
  check("Shelly Gen 1: relay 0 on", r.ok && S1.on[0] === true, r.text);
  r = await devices.control({ target: "the tree", action: "on", surface: "tv" });
  check("Custom HTTP (Tasmota template): Power2 On", r.ok && TA.power[2] === "ON" && TA.log.some((x) => /Power2%20On/i.test(x)), r.text);
  const st = await devices.status(registry.device("christmas-tree"), { fresh: true });
  check("Custom HTTP: status read back through the template's path", st.on === true, st);
  r = await devices.control({ target: "hallway switch", action: "on", surface: "tv" });
  check("Home Assistant entity: switch.turn_on", r.ok && fakeHA.calls.some((c) => c[1] === "turn_on" && c[2] === "switch.hallway"), fakeHA.calls);
  r = await devices.control({ target: "matter plug", action: "on", surface: "tv" });
  check("Matter (through Home Assistant): turn_on", r.ok && fakeHA.calls.some((c) => c[2] === "switch.matter_plug"), r.text);
  const kst = await devices.stripsState();
  check("strips: each outlet's state and the HS300's name per outlet", kst.find((s) => s.id === "A")?.on.length === 6 && kst.find((s) => s.id === "B")?.on[1] === true && kst.find((s) => s.id === "A")?.devices[2] === "computer", kst.map((s) => [s.id, s.on]));
  // newer Kasa hardware: port 9999 closed, KLAP (v1) with the TP-Link login instead
  const KK = await sims.tapoSim({ username: "owner@example.com", password: "kasa-pass", version: 1 });
  registry.saveStrip({ id: "KK", name: "Kettle plug", adapter: "kasa", host: L, port: 1, klapPort: KK.port, outlets: 1, model: "KP125M", secret: { username: "owner@example.com", password: "kasa-pass" } });
  dev({ name: "Kettle", type: "other", room: "kitchen", power: [{ via: "outlet", strip: "KK", outlet: 1 }] });
  r = await devices.control({ target: "kettle", action: "on", surface: "tv" });
  check("Kasa on KLAP (newer hardware): the classic port is closed, so it signs in with the TP-Link login and switches", r.ok && KK.kasaRelay[0] === 1 && KK.log.some((j) => j.system?.set_relay_state), r.text);
  KK.close();
  // a wrong Tapo login is explained
  let msg = ""; try { await tapoA.getState({ id: "x", name: "x", host: L, port: T.port, outlets: 3 }, { username: "owner@example.com", password: "wrong" }); } catch (e) { msg = e.message; }
  check("Tapo: a wrong TP-Link login is explained", /email and password/i.test(msg), msg);
  // lights: WLED and Hue
  r = await devices.control({ target: "desk lights", action: "color", value: "blue", surface: "tv" });
  check("WLED: colour blue", r.ok && JSON.stringify(W.st.seg[0].col[0]) === JSON.stringify([0, 60, 255]), W.st);
  r = await devices.control({ target: "desk leds", action: "brightness", value: 30, surface: "tv" });
  check("WLED: brightness 30%", r.ok && W.st.bri === Math.round(0.3 * 255), W.st.bri);
  r = await devices.control({ target: "desk leds", action: "effect", value: "rainbow", surface: "tv" });
  check("WLED: the Rainbow effect by name", r.ok && W.st.seg[0].fx === 3, W.st.seg[0]);
  const ws = await devices.status(registry.device("desk-leds"));
  check("WLED: capabilities onoff, brightness, color, effect with the effect list", ["onoff", "brightness", "color", "effect"].every((c) => ws.caps.includes(c)) && ws.effects.includes("Fire 2012"), ws.caps);
  let pairErr = null; try { await lights.huePair(`${L}:${H.port}`); } catch (e) { pairErr = e; }
  check("Hue: pairing before the button is pressed says to press it", pairErr?.code === "button");
  H.press(); const pk = await lights.huePair(`${L}:${H.port}`);
  registry.saveHue({ id: "hue1", host: `${L}:${H.port}`, name: "Hue bridge", key: pk.key });
  dev({ name: "Night light", type: "light", room: "bedroom", control: { via: "hue", bridge: "hue1", light: "1" } });
  r = await devices.control({ target: "night light", action: "color", value: "red", surface: "tv" });
  check("Hue: colour red (xy) on the bridge's light 1", r.ok && H.lights[1].state.on && H.lights[1].state.xy[0] > 0.6, H.lights[1].state);
  // Wake-on-LAN
  sink.got.length = 0;
  await power.wake({ mac: "3C-7C-3F-1A-2B-4D", broadcast: L, port: sink.port }); await sleep(100);
  const pkt = sink.got[0];
  check("Wake-on-LAN: 102 bytes, 6 × FF then the MAC 16 times", pkt?.length === 102 && pkt.subarray(0, 6).every((b) => b === 0xff) && pkt.subarray(6, 12).toString("hex") === "3c7c3f1a2b4d" && pkt.subarray(96).toString("hex") === "3c7c3f1a2b4d");
  let bad = ""; try { power.magicPacket("12-34"); } catch (e) { bad = e.message; }
  check("Wake-on-LAN: a wrong MAC is refused", /MAC/.test(bad));
  sink.got.length = 0;
  r = await devices.control({ target: "my computer", action: "on", surface: "tv" }); await sleep(300);
  check("\"turn on my computer\": its outlet (3 of strip A) comes on, then the wake-up signal", r.ok && K.state()[2] === true && sink.got.length >= 1, r.text);
  // custom MQTT through a broker (aedes, plain TCP on 127.0.0.1)
  const { Aedes } = await import("aedes"); const broker = await Aedes.createBroker();
  const seen = []; broker.on("publish", (p) => { if (!p.topic.startsWith("$SYS")) seen.push([p.topic, p.payload.toString()]); });
  const ms = netServer(broker.handle); await new Promise((res) => ms.listen(0, L, res));
  registry.saveStrip({ id: "Z", name: "Zigbee plug", adapter: "custom", host: `${L}:${ms.address().port}`, outlets: 1, custom: { ...customA.TEMPLATES.zigbee2mqtt.custom, url: `mqtt://${L}:${ms.address().port}`, name: "garage_plug" } });
  dev({ name: "Garage plug", type: "other", room: "garage", power: [{ via: "outlet", strip: "Z", outlet: 1 }] });
  r = await devices.control({ target: "garage plug", action: "on", surface: "tv" }); await sleep(200);
  check("Custom MQTT (Zigbee2MQTT template): publishes {\"state\":\"ON\"} to zigbee2mqtt/<name>/set", r.ok && seen.some(([t, p]) => t === "zigbee2mqtt/garage_plug/set" && p === "{\"state\":\"ON\"}"), seen.slice(-3));
  customA.closeAll(); ms.close(); broker.close();
}

// ---- 6. safety ----------------------------------------------------------------------------------------------------------
const yes = (surface = "tv") => confirm.userSaid("yes", { surface });
{
  K.children[2].state = 1;
  let r = await devices.control({ target: "computer", action: "off", surface: "tv" });
  check("this PC: cutting its power asks, and says why", r.needsConfirm && /computer I'm running on/.test(r.text) && K.state()[2] === true, r.text);
  const noAns = await devices.answer("hmm", { surface: "tv" });
  check("this PC: anything but a yes leaves it on", noAns === null && K.state()[2] === true);
  yes(); r = await devices.answer("yes", { surface: "tv" });
  check("this PC: after the owner's yes it's done", r?.ok && K.state()[2] === false, r?.text);
  K.children[4].state = 1;
  r = await devices.control({ target: "printer 3", action: "off", surface: "tv" });
  check("a printing printer: asks, and says it's printing (45%) and hot", r.needsConfirm && /printing right now \(45% done\)/.test(r.text) && /hot/.test(r.text) && K.state()[4] === true, r.text);
  confirm.userSaid("no", { surface: "tv" }); const n = await devices.answer("no", { surface: "tv" });
  check("a printing printer: \"no\" keeps it on", n?.text === "Okay, I won't." && K.state()[4] === true);
  T.kids[1].device_on = true;
  r = await devices.control({ target: "printer 2", action: "off", surface: "tv" });
  check("a hot printer (not printing): asks, and says its fan needs power to cool the hot end", r.needsConfirm && /still hot/.test(r.text) && /fan/.test(r.text), r.text);
  K.children[5].state = 1;
  r = await devices.control({ target: "router", action: "off", surface: "tv" });
  check("critical outlet (router): asks, \"it's your internet\"", r.needsConfirm && /critical/.test(r.text) && /internet/.test(r.text) && K.state()[5], r.text);
  M.ch[1] = 1;
  r = await devices.control({ target: "fridge", action: "off", surface: "tv" });
  check("critical outlet (fridge): asks, food spoils", r.needsConfirm && /food/.test(r.text), r.text);
  r = await devices.control({ target: "space heater", action: "on", surface: "tv" });
  check("heat: a heater asks before it's switched on", r.needsConfirm && /heat/i.test(r.text) && !S.on[3], r.text);
  yes(); await devices.answer("yes", { surface: "tv" });
  check("heat: after yes it's on, and an auto-off is scheduled (its 60 minutes)", S.on[3] === true && registry.schedules().some((s) => s.tag === "autooff" && s.ids[0] === "space-heater"));
  r = await devices.control({ target: "heatr", action: "off", surface: "tv", exact: false });
  const r2 = await devices.control({ target: "space heatr", action: "on", surface: "tv" });
  check("heat: a near-miss name isn't enough to switch it on", !r2.needsConfirm && !r2.ok && /exact name/.test(r2.text), r2.text);
  r = await devices.control({ target: "the space heater", action: "on", surface: "discord" });
  check("not the owner (Discord): a heater is refused", !r.ok && /Only Sam/.test(r.text), r.text);
  r = await devices.control({ target: "fan 2", action: "off", surface: "call" });
  check("a call can't switch anything", !r.ok, r.text);
  // everything
  r = await devices.control({ target: "everything", scope: { all: true }, action: "on", surface: "tv" });
  check("\"turn everything on\" is refused", !r.ok && /won't turn everything on/.test(r.text), r.text);
  r = await devices.control({ target: "everything", scope: { all: true }, action: "off", surface: "tv" });
  const leftNames = (r.left ?? []).map((x) => x.name);
  check("\"everything off\": asks first, listing what", r.needsConfirm && /That's \d+ things/.test(r.text), r.text);
  check("\"everything off\": this PC, the router, the fridge and the busy/hot printers are left alone", ["Computer", "Router", "Fridge", "Printer 3", "Printer 2"].every((x) => leftNames.includes(x)), leftNames);
  yes(); r = await devices.answer("yes", { surface: "tv" });
  check("\"everything off\" after yes: the rest are off, the protected ones stay on", r?.done?.includes("fan-2") && !S.on[1] && K.state()[5] === true && M.ch[1] === 1 && K.state()[4] === true, r?.text);
  // rate limit
  registry.setOptions({ minToggleSeconds: 3 });
  await devices.control({ target: "lamp", action: "on", surface: "tv" });
  r = await devices.control({ target: "lamp", action: "off", surface: "tv" });
  check("rate limit: switching the same thing again within 3 s is refused", !r.ok && /just switched/.test(r.text), r.text);
  registry.setOptions({ minToggleSeconds: 0 });
  // the log
  const logged = activity.search({ kind: "device", limit: 500 }).entries;
  check("every action is in the activity log (switches, questions, refusals)", logged.some((e) => e.kind === "device" && e.device === "fan-2") && logged.some((e) => e.kind === "device.asked") && activity.search({ kind: "blocked", limit: 200 }).entries.some((e) => /^device-/.test(e.reason)), logged.length);
}

// ---- 7. scenes and groups -----------------------------------------------------------------------------------------------
{
  S.on[0] = false; S.on[2] = true; S.on[1] = true;
  const r = await skills.handle("movie mode", { surface: "tv" });
  check("scene: \"movie mode\" turns the TV on and the lamp and fan 2 off", /Movie mode/.test(r?.reply) && S.on[0] && !S.on[2] && !S.on[1], r?.reply);
  K.children[3].state = 0; S.on[1] = false;
  const g = await skills.handle("turn the fans on", { surface: "tv" });
  check("group: \"turn the fans on\" switches both fans", K.state()[3] && S.on[1], g?.reply);
  const o = await skills.handle("office on", { surface: "tv" });
  check("room: \"office on\" (5+ things) asks first", /Say yes/.test(o?.reply ?? ""), o?.reply);
  confirm.userSaid("no", { surface: "tv" }); await skills.handle("no", { surface: "tv" });
  const wo = await skills.handle("what's on right now?", { surface: "tv" });
  check("\"what's on right now?\" lists what's on", /Devices on right now: .*TV/.test(wo?.reply ?? ""), wo?.reply);
  // (the schedule's answer comes first and isn't lost: the same words as the schedule's own answer, then the devices)
  check("\"what's on right now?\" answers the schedule first, then the devices", /^(Right now it's .+, until .+\.|Nothing is scheduled right now\.)/.test(wo?.reply ?? "") && (wo?.reply ?? "").indexOf("Devices on right now") > 0, (wo?.reply ?? "").replace(/^(Right now it's|Next is|Then) [^.]*\./g, "$1 …").slice(0, 120));
  const wd = await skills.handle("what devices are on", { surface: "tv" });
  check("\"what devices are on\" is about the devices alone", /^Devices on right now: .*TV/.test(wd?.reply ?? ""), wd?.reply);
  const is = await skills.handle("is the TV on?", { surface: "tv" });
  check("\"is the TV on?\" → TV is on (with its power use)", /^TV is on\b/.test(is?.reply ?? ""), is?.reply);
  check("\"list my devices\" is left for the speakers and microphones (lib/devices.mjs)", (await skills.handle("list my devices", { surface: "tv" })) === null);
  check("something this home doesn't have falls through to Home Assistant and the rest (\"turn on the kitchen lights\", \"turn off the music\")", (await skills.handle("turn on the kitchen lights", { surface: "tv" })) === null && (await skills.handle("turn off the music", { surface: "tv" })) === null);
  const pr = await skills.handle("is printer 3 on", { surface: "tv" });
  check("\"is printer 3 on\" reports the print", /printing \(45%\)/.test(pr?.reply ?? ""), pr?.reply);
}

// ---- 8. schedules -----------------------------------------------------------------------------------------------------------
{
  const now = new Date(); const at = new Date(now.getTime() + 3600_000);
  let r = await devices.control({ ids: ["tv"], action: "off", when: { at: at.toISOString(), label: "in an hour" }, surface: "tv" });
  check("schedule: \"turn the TV off in an hour\" is saved", r.ok && registry.schedules().some((s) => s.ids[0] === "tv" && s.action === "off"), r.text);
  S.on[0] = true;
  let fired = await devices.tick(new Date(now.getTime() + 60_000));
  check("schedule: nothing happens before its time", !fired.length && S.on[0]);
  fired = await devices.tick(new Date(at.getTime() + 1000));
  check("schedule: at its time the TV goes off", fired.some((f) => f.done?.includes("tv")) && !S.on[0], fired);
  // the office at 10 pm: several things → asks now; this PC and the router are left alone then
  const p = parse("turn everything off in the office at 10 pm");
  r = await devices.control({ target: p.target, scope: p.scope, action: "off", when: p.when, surface: "tv" });
  check("schedule: \"everything off in the office at 10 pm\" asks now (a batch), leaving the PC and router out", r.needsConfirm && /Computer|Router/.test(r.text), r.text);
  yes(); r = await devices.answer("yes", { surface: "tv" });
  const sch = registry.schedules().find((s) => s.whenLabel === p.when.label);
  check("schedule: after yes it's saved as approved, without the PC or the router", r?.ok && sch?.approved && !sch.ids.includes("computer") && !sch.ids.includes("router"), sch);
  K.children[0].state = 1; K.children[3].state = 1; K.children[2].state = 1;
  fired = await devices.tick(new Date(Date.parse(sch.at) + 500));
  check("schedule: at 10 pm the office goes off except the PC and router", !K.state()[0] && !K.state()[3] && K.state()[2] && K.state()[5], K.state());
  // a printer printing when its schedule comes: left alone, and he's told
  K.children[4].state = 1; announced.length = 0;
  await devices.addSchedule({ ids: ["printer-3"], label: "Printer 3", action: "off", when: { at: new Date(now.getTime() + 1000).toISOString(), label: "soon" }, surface: "tv" });
  await devices.tick(new Date(now.getTime() + 5000));
  check("schedule: a printer that's printing at the scheduled time is NOT cut, and it's announced", K.state()[4] === true && announced.some((a) => /Printer 3/.test(a.text) && /printing/.test(a.text)), announced.map((a) => a.text));
  // daily
  r = await devices.control({ target: "tv", action: "off", when: { daily: "23:00", label: "every day at 11 p.m." }, surface: "tv" });
  S.on[0] = true;
  const d23 = new Date(); d23.setHours(23, 0, 10, 0);
  await devices.tick(d23); const once = S.on[0]; S.on[0] = true; await devices.tick(d23);
  check("schedule: daily at 23:00 runs once that day", once === false && S.on[0] === true);
  const n = devices.cancelSchedule("tv");
  check("schedule: \"cancel the tv schedule\" removes it", n >= 1 && !registry.schedules().some((s) => s.daily === "23:00"));
}

// ---- 9. the remote entry point: run(command, { from }) --------------------------------------------------------------------
{
  const from = { id: "laptop-7", name: "Laptop", verified: true, owner: true };
  S.on[1] = true;
  let r = await devices.run("turn off fan 2", { from });
  check("remote: a plain command from a verified Dayspring works", r.ok && !S.on[1], r.text);
  r = await devices.run("turn off fan 2", { from: { id: "stranger", verified: false } });
  check("remote: an unverified sender is ignored", !r.ok && /verified/.test(r.text));
  K.children[5].state = 1;
  r = await devices.run("turn off the router", { from });
  check("remote: a risky command asks, the same question", r.needsConfirm && /critical/.test(r.text) && K.state()[5], r.text);
  // a yes on THIS computer's screen doesn't count for the laptop's question
  confirm.userSaid("yes", { surface: "tv" });
  check("remote: a yes said on another screen doesn't approve it", !confirm.isApproved(r.confirmToken) && K.state()[5]);
  r = await devices.run({ answer: "yes" }, { from });
  check("remote: the yes said on the laptop does", r.ok && !K.state()[5], r?.text);
  r = await devices.run("turn on the space heater", { from: { id: "friend-pc", verified: true, owner: false } });
  check("remote: someone else's computer can't switch a heater", !r.ok && /Only Sam/.test(r.text), r.text);
  r = await devices.run({ target: "tv", action: "on" }, { from });
  check("remote: a structured command { target, action } works too", r.ok && S.on[0], r.text);
  r = await devices.run("turn everything on", { from });
  check("remote: \"turn everything on\" is refused the same way", !r.ok, r.text);
  const lg = activity.search({ kind: "device.remote", limit: 50 }).entries;
  check("remote: every remote command is logged with where it came from", lg.some((e) => e.from === "laptop-7"));
}

// ---- 10. the AI's tools --------------------------------------------------------------------------------------------------
{
  S.on[1] = false;
  let r = await skills.runTool("device_control", { target: "fan number 2", action: "on" });
  check("tool device_control: on", r.ok && S.on[1], r.text);
  r = await skills.runTool("device_control", { target: "router", action: "off" });
  check("tool device_control: a risky one returns needsConfirm + token (the AI can't approve it)", r.needsConfirm && r.confirmToken);
  const again = await skills.runTool("device_control", { target: "router", action: "off", confirm_token: r.confirmToken });
  check("tool device_control: the token alone (no yes from the owner) does nothing", !again.ok && K.state()[5] === false || !again.ok, again.text);
  r = await skills.runTool("device_status", { target: "tv" });
  check("tool device_status", r.devices?.[0]?.name === "TV");
  r = await skills.runTool("device_schedule", { op: "add", target: "lamp", action: "off", when: "in 45 minutes" });
  check("tool device_schedule: add", r.ok && /in 45 minutes/.test(r.text), r.text);
  r = await skills.runTool("device_schedule", { op: "list" });
  check("tool device_schedule: list", r.schedules.some((s) => s.ids[0] === "lamp"));
  const tn = skills.TOOLS.map((t) => t.name);
  check("tools: device_control, device_status, device_schedule", ["device_control", "device_status", "device_schedule"].every((n) => tn.includes(n)));
}

for (const s of [K, K3, S, S1, T, M, W, H, TA, sink]) s.close();
rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
