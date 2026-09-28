// A Creality Ender 5 Plus (Marlin) three ways, against simulators only: straight over USB (a simulated Marlin on a TCP
// "serial line": numbered, checksummed lines, a resend, temperatures, M109's busy wait, a thermal runaway, the cable
// pulled mid-print), through OctoPrint, and through Klipper/Moonraker. Plus the start rules for a printer with no camera
// (the owner's own look at the bed, always asked) and the PC kept awake while it streams.
//   node scripts/qa/printers-ender.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TMP = mkdtempSync(join(tmpdir(), "ds-ender-"));
Object.assign(process.env, { DAYSPRING_PRINTERS_FILE: join(TMP, "printers.json"), DAYSPRING_PRINTS_DIR: join(TMP, "prints"), DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"), DAYSPRING_PERMISSIONS_FILE: join(TMP, "permissions.json"),
  DAYSPRING_TEST_CRYPTO: "fake", DAYSPRING_TOKEN_CRYPTO: "fake", DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_KEEPAWAKE: "1", DAYSPRING_CAMERAS_FILE: join(TMP, "cameras.json"), DAYSPRING_CAMERAS_DIR: join(TMP, "cameras"),
  DAYSPRING_CAMERAS_STATE: join(TMP, "cameras-state.json"), DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json") });
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? `  (${typeof got === "string" ? got : JSON.stringify(got)})`.slice(0, 400) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40); } return false; };

const sims = await imp("scripts/qa/fixtures/printers/sims.mjs");
const synth = await imp("scripts/qa/fixtures/printers/synth.mjs");
const sender = await imp("lib/printers/marlin/sender.mjs");
const printers = await imp("lib/printers/index.mjs");
const store = await imp("lib/printers/store.mjs");
const skills = await imp("lib/printers/skills.mjs");
const confirm = await imp("lib/confirm.mjs");
const awakeCalls = [], announced = [];
printers.setDeps({ announce: (x) => announced.push(x), broadcast: () => {}, keepAwake: (id, on) => awakeCalls.push([id, on]) });

// ---- 1. the G-code link ------------------------------------------------------------------------------------------------------
check("checksum: N1 M105*38 (XOR of the characters)", sender.numbered(1, "M105") === "N1 M105*38");
check("clean: comments and blank lines are dropped", sender.clean("G1 X10 ; move") === "G1 X10" && sender.clean("; only a comment") === "");
check("temperatures: T and B from an ok line", JSON.stringify(sender.parseTemps("ok T:210.2 /210.0 B:60.1 /60.0 @:127 B@:0")) === JSON.stringify({ nozzle: { temp: 210.2, target: 210 }, bed: { temp: 60.1, target: 60 } }));
const gcode = join(TMP, "cube.gcode");
writeFileSync(gcode, ["; a test cube", "M140 S60", "M104 S200", "M190 S60", "M109 S200", "G28", ...Array.from({ length: 60 }, (_, i) => `G1 X${i} Y${i % 7} E${(i * 0.05).toFixed(2)} F1800 ; line ${i}`), "M104 S0", "M140 S0", "M84"].join("\n"));

const M = await sims.marlinSim({ resendAt: 9 });
store.savePrinter({ id: "ender", name: "The Ender", number: 4, brand: "marlin", model: "ENDER5PLUS", serialPath: M.url, aliases: ["ender 5"] });
{
  const t = await (await printers.connection("ender", { connect: false })).test();
  check("USB link: connects, reads the firmware (M115) and temperatures (M105)", t.ok && /Marlin 2\.0\.6/.test(t.text), t.text);
  let r = await printers.startPrint("ender", { file: gcode, surface: "tv" });
  check("no camera: it can't check the bed, so it asks him to (always a question)", r.needsConfirm && /no camera/.test(r.text) && /check that it's clear/.test(r.text), r.text);
  check("USB: the question says the PC stays awake and that OctoPrint/Klipper is more reliable", /awake/.test(r.text) && /OctoPrint or Klipper/.test(r.text), r.text);
  store.setOptions("ender", { autoStart: true });
  const q = await import(pathToFileURL(join(DESK, "lib/printers/queue.mjs")).href);
  q.add("ender", { file: gcode });
  const a = await q.next("ender", { auto: true });
  check("no camera + auto-start on: still asks (nothing can see the bed)", a.needsConfirm && !a.started, a.text);
  confirm.userSaid("yes", { surface: "tv" });
  r = await skills.handle("yes", { surface: "tv" });
  check("after his yes: the print streams", /Starting cube\.gcode/.test(r?.reply ?? ""), r?.reply);
  check("the PC is held awake while it streams", awakeCalls.some(([id, on]) => id === "ender" && on === true));
  const done = await until(() => printers.status("ender").state === "finished", 15000);
  check("streaming: every line arrives, in order, numbered and checksummed", done && M.st.received.filter((c) => c.startsWith("G1 X")).length === 60 && M.st.received.includes("G28"), M.st.received.length);
  check("streaming: a garbled line (line 9) is re-sent when Marlin asks (Resend: 9)", M.st.resent === 1 && M.st.raw.filter((l) => /^N9 /.test(l)).length === 2, M.st.raw.filter((l) => /^N9 /.test(l)));
  check("streaming: M109 / M190 waits ride out \"busy\"", M.st.received.includes("M109 S200") && M.st.received.includes("M190 S60"));
  check("streaming: temperatures are read during the print (M105 slipped in)", M.st.received.filter((c) => c === "M105").length >= 2);
  check("finished: the PC is let go", awakeCalls.at(-1)?.[1] === false);
  store.setOptions("ender", { autoStart: false });
  // controls
  r = await printers.command("ender", "temp", { bed: 70 });
  check("temperatures: M140 S70", r.ok && await until(() => M.st.received.includes("M140 S70")), r.text);
  r = await printers.command("ender", "temp", { nozzle: 300 });
  check("temperatures: 300 °C is above the Ender 5 Plus's 260 °C limit: refused", !r.ok && /above/.test(r.text), r.text);
  r = await printers.command("ender", "speed", 3);
  check("speed \"sport\" → M220 S125", r.ok && await until(() => M.st.received.includes("M220 S125")), r.text);
  // pause / resume host-side, then stop: heaters off
  M.setSlow(4);   // a real printer takes a moment per move, so pause/resume happen mid-print
  writeFileSync(gcode, ["M104 S200", ...Array.from({ length: 400 }, (_, i) => `G1 X${i % 100} Y1 F600`)].join("\n"));
  const c = await printers.connection("ender");
  c.sender.lineTimeoutMs = 5000;
  await c.startPrint({ file: gcode });
  await until(() => (c.sender.job?.lines ?? 0) > 20);
  r = await printers.command("ender", "pause");
  const at = c.sender.job.lines; await sleep(300);
  check("pause (host-side): no more lines are sent", r.ok && printers.status("ender").state === "paused" && c.sender.job.lines - at <= 1, [at, c.sender.job.lines]);
  r = await printers.command("ender", "resume");
  await until(() => c.sender.job.lines > at + 20);
  check("resume: lines flow again", r.ok && c.sender.job.lines > at + 20);
  r = await printers.command("ender", "stop", null, { approved: false });
  check("stop asks first", r.needsConfirm, r.text);
  confirm.userSaid("yes", { surface: "tv" }); r = await skills.handle("yes", { surface: "tv" });
  check("stop: heaters off, fan off, motors off (M104 S0, M140 S0, M107, M84)", await until(() => ["M104 S0", "M140 S0", "M107", "M84"].every((x) => M.st.received.includes(x))) && printers.status("ender").state === "idle", r?.reply);
  // the host's own watch: a heater far over its target → heaters off, print ended
  M.setSlow(10);   // a printer that takes a moment per line, so the print is still going while the heater misbehaves
  await c.startPrint({ file: gcode }); await until(() => (c.sender.job?.lines ?? 0) > 5);
  M.setTemp("T", 245); announced.length = 0;
  await c.sender.command("M105");
  await until(() => printers.status("ender").state === "failed");
  check("host thermal check: the nozzle far above its target → heaters off, print stopped, announced as urgent", printers.status("ender").state === "failed" && announced.some((x) => /thermal runaway/i.test(x.text) && x.emergency), announced.map((x) => x.text));
  // Marlin's own thermal runaway message
  M.unstick(); M.setTemp("T", 200); M.unstick();
  await c.sender.command("M104 S200").catch(() => {});
  await c.startPrint({ file: gcode }); await until(() => (c.sender.job?.lines ?? 0) > 5);
  announced.length = 0; M.runaway();
  await until(() => printers.status("ender").state === "failed");
  check("Marlin's \"Thermal Runaway\" / \"Printer halted\": the print ends and it's announced at once", printers.status("ender").state === "failed" && announced.some((x) => /Thermal Runaway/i.test(x.text)), announced.map((x) => x.text));
  printers.forget("ender"); M.close();
}
// the cable pulled mid-print
{
  const M2 = await sims.marlinSim(); M2.setSlow(4);
  store.savePrinter({ id: "ender", serialPath: M2.url, name: "The Ender" });
  const c = await printers.connection("ender");
  writeFileSync(gcode, Array.from({ length: 500 }, (_, i) => `G1 X${i % 100} F600`).join("\n"));
  await c.startPrint({ file: gcode }); await until(() => (c.sender.job?.lines ?? 0) > 10);
  announced.length = 0; awakeCalls.length = 0;
  M2.unplug();
  await until(() => announced.length > 0);
  check("host disconnect: the print is marked failed and he's told plainly", /connection to the printer dropped/.test(announced[0]?.text ?? "") && printers.status("ender").state === "offline", announced.map((x) => x.text));
  check("host disconnect: the PC is let go", awakeCalls.some(([, on]) => on === false));
  printers.forget("ender"); M2.close();
}

// ---- 2. OctoPrint -----------------------------------------------------------------------------------------------------------
{
  const O = await sims.octoSim({ apiKey: "octo-key-123", jpeg: synth.fixtures.empty() });
  store.savePrinter({ id: "octo", name: "Ender (OctoPrint)", number: 5, brand: "octoprint", host: `127.0.0.1:${O.port}`, apiKey: "octo-key-123" });
  const t = await (await printers.connection("octo", { connect: false })).test();
  check("OctoPrint: connects with the API key", t.ok && /OctoPrint/.test(t.text), t.text);
  store.savePrinter({ id: "octobad", name: "Wrong key", brand: "octoprint", host: `127.0.0.1:${O.port}`, apiKey: "nope" });
  const tb = await (await printers.connection("octobad", { connect: false })).test();
  check("OctoPrint: a wrong key is explained", !tb.ok && /API key/.test(tb.text), tb.text);
  printers.forget("octobad");
  const snap = await printers.snapshot("octo");
  check("OctoPrint: its webcam is the printer's camera", snap[0] === 0xff);
  await printers.captureReference("octo");
  store.setBed("octo", { roi: synth.ROI });
  writeFileSync(gcode, "G28\nG1 X10\n");
  let r = await printers.startPrint("octo", { file: gcode, surface: "tv" });
  check("OctoPrint: the bed is checked with its webcam, then the question", r.needsConfirm && /looks clear/.test(r.text), r.text);
  confirm.userSaid("yes", { surface: "tv" }); r = await printers.answer("yes", { surface: "tv" });
  check("OctoPrint: after yes, uploaded and selected to print", r.ok && O.st.uploads[0]?.name === "cube.gcode" && O.st.file === "cube.gcode" && O.st.flags.printing, [r.text, O.st.uploads]);
  await printers.connection("octo").then((c) => c.refresh());
  check("OctoPrint: status (printing, time left)", printers.status("octo").state === "printing" && printers.status("octo").remainingMin === 30, printers.status("octo"));
  r = await printers.command("octo", "pause");
  check("OctoPrint: pause", r.ok && O.st.commands.some((c) => c?.command === "pause" && c.action === "pause"));
  r = await printers.command("octo", "temp", { bed: 55 });
  check("OctoPrint: bed target", r.ok && O.st.bed[1] === 55);
  printers.forget("octo"); O.close();
}

// ---- 3. Klipper / Moonraker ----------------------------------------------------------------------------------------------------
{
  const K = await sims.moonSim();
  store.savePrinter({ id: "klip", name: "Voron", number: 6, brand: "moonraker", host: `127.0.0.1:${K.port}` });
  const t = await (await printers.connection("klip", { connect: false })).test();
  check("Moonraker: connects (no key needed)", t.ok && /Klipper/.test(t.text), t.text);
  K.st.state = "printing"; K.st.progress = 0.25;
  await printers.connection("klip").then((c) => c.refresh());
  const s = printers.status("klip");
  check("Moonraker: status (printing, 25%, layer 12 of 80, time left)", s.state === "printing" && s.progress === 25 && s.layer === 12 && s.totalLayers === 80 && s.remainingMin === 30, s);
  let r = await printers.command("klip", "pause");
  check("Moonraker: pause", r.ok && K.st.state === "paused");
  r = await printers.command("klip", "temp", { nozzle: 215 });
  check("Moonraker: SET_HEATER_TEMPERATURE", r.ok && K.st.scripts.includes("SET_HEATER_TEMPERATURE HEATER=extruder TARGET=215"), K.st.scripts);
  const sp = await skills.handle("how's the voron doing?", { surface: "tv" });
  check("voice: \"how's the voron doing?\"", /Voron is paused|Voron is printing/.test(sp?.reply ?? ""), sp?.reply);
  printers.forget("klip"); K.close();
}

// ---- 4. optional slicing (Bambu Studio / OrcaSlicer's command line) ----
{
  const slicer = await imp("lib/printers/slicer.mjs");
  const a = slicer.args("C:/models/cube.stl", { machine: "machine.json", process: "process.json", filament: "pla.json", out: "C:/out/cube.gcode.3mf" });
  check("slicing: the Bambu Studio / OrcaSlicer command line (slice plate 0, export 3MF, the profiles, the model)", a.join(" ") === "--slice 0 --export-3mf C:/out/cube.gcode.3mf --load-settings machine.json;process.json --load-filaments pla.json C:/models/cube.stl", a.join(" "));
  const q = await import(pathToFileURL(join(DESK, "lib/printers/queue.mjs")).href);
  check("queue: .3mf, .gcode and (with a slicer) .stl are printable; anything else isn't", q.isPrintable("a.3mf") && q.isPrintable("b.gcode") && q.isPrintable("c.stl") && !q.isPrintable("d.obj"));
}

printers.stopAll();
await sleep(200);
rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
