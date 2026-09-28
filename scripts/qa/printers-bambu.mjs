// Bambu Lab printers, against simulators only (never a real printer): an MQTT broker over TLS playing the printer's
// report/request topics, an implicit-FTPS server playing its storage, the P1/A1 TLS camera stream, and an ffmpeg-made
// clip standing in for an X1's RTSP camera. Also the brand-neutral parts every printer uses: the bed-clear check
// (a clear bed, a part left on it, a leftover purge line, and the thresholds), the start rules (no start without the
// owner's yes, none on a bed that isn't clear, auto-start only with a fresh clear check), failure and stringing
// detection on picture sequences (good, spaghetti, stringing, a part come loose; the AI mocked, plus the local checks),
// what's kept (pictures deleted after a good print, kept with a report after a bad one), and auto-pause (off by default).
//   node scripts/qa/printers-bambu.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TMP = mkdtempSync(join(tmpdir(), "ds-printers-"));
Object.assign(process.env, { DAYSPRING_PRINTERS_FILE: join(TMP, "printers.json"), DAYSPRING_PRINTS_DIR: join(TMP, "prints"), DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"), DAYSPRING_PERMISSIONS_FILE: join(TMP, "permissions.json"),
  DAYSPRING_TEST_CRYPTO: "fake", DAYSPRING_TOKEN_CRYPTO: "fake", DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_KEEPAWAKE: "1", DAYSPRING_CAMERAS_FILE: join(TMP, "cameras.json"), DAYSPRING_CAMERAS_DIR: join(TMP, "cameras"),
  DAYSPRING_CAMERAS_STATE: join(TMP, "cameras-state.json"), DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"), DAYSPRING_DEVICES_FILE: join(TMP, "devices-home.json") });
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? `  (${typeof got === "string" ? got : JSON.stringify(got)})`.slice(0, 400) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(50); } return false; };

const sims = await imp("scripts/qa/fixtures/printers/sims.mjs");
const synth = await imp("scripts/qa/fixtures/printers/synth.mjs");
const proto = await imp("lib/printers/bambu/protocol.mjs");
const camera = await imp("lib/printers/bambu/camera.mjs");
const printers = await imp("lib/printers/index.mjs");
const store = await imp("lib/printers/store.mjs");
const monitor = await imp("lib/printers/monitor.mjs");
const queue = await imp("lib/printers/queue.mjs");
const skills = await imp("lib/printers/skills.mjs");
const { bedCheck, analyzeFrame } = await imp("lib/printers/vision/analyze.mjs");
const confirm = await imp("lib/confirm.mjs");
const activity = await imp("lib/activity.mjs");

const F = synth.fixtures, ROI = synth.ROI;
const announced = [], broadcasts = [];
let aiReply = null;   // the mocked AI: a function (prompt) → text, or null for "no AI"
printers.setDeps({ announce: (x) => announced.push(x), broadcast: (t, d) => broadcasts.push([t, d]), notify: async () => {}, keepAwake: () => {}, ffmpeg: (await import("ffmpeg-static")).default,
  ai: () => (aiReply ? async ({ prompt }) => aiReply(prompt) : null) });

// ---- 1. status parsing ----------------------------------------------------------------------------------------------------
{
  const x1 = proto.normalize(sims.fullReport({ gcode_state: "RUNNING", mc_percent: 42, layer_num: 55, total_layer_num: 130, mc_remaining_time: 73, nozzle_temper: 219.6, nozzle_target_temper: 220, bed_temper: 55, bed_target_temper: 55, cooling_fan_speed: "15", big_fan1_speed: "10", spd_lvl: 3, subtask_name: "benchy", hms: [{ attr: 0x07008000, code: 0x00020001 }], lights_report: [{ node: "chamber_light", mode: "on" }] }), "X1C");
  check("status: state, progress, layer, time left", x1.state === "printing" && x1.progress === 42 && x1.layer === 55 && x1.totalLayers === 130 && x1.remainingMin === 73, x1);
  check("status: temperatures, fans in %, speed name, light", x1.nozzle[0].temp === 219.6 && x1.bed.target === 55 && x1.fans.part === 100 && x1.fans.aux === 67 && x1.speedName === "sport" && x1.light === true, x1);
  check("status: AMS trays with colour, type and index", x1.ams[0].trays[1].type === "PETG" && x1.ams[0].trays[1].color === "#0A2989" && x1.ams[0].trays[1].index === 1, x1.ams);
  check("status: HMS codes are read (0700_8000_0002_0001)", x1.errors[0]?.code === "0700_8000_0002_0001", x1.errors);
  check("status: \"hot\" while the nozzle is above 50 °C", x1.hot === true);
  // P1/A1 send only what changed: merged
  let raw = proto.merge({}, sims.fullReport());
  raw = proto.merge(raw, { print: { mc_percent: 10, gcode_state: "RUNNING" } });
  raw = proto.merge(raw, { print: { mc_percent: 11 } });
  const p1 = proto.normalize(raw, "P1S");
  check("status: partial reports (P1/A1) are merged into the last full one", p1.progress === 11 && p1.state === "printing" && p1.ams.length === 1 && p1.bed.temp === 24.1, p1);
  // H2D: two nozzles, temperatures packed (low word now, high word target)
  const h2 = proto.normalize({ print: { gcode_state: "PREPARE", device: { extruder: { info: [{ id: 0, temp: (220 << 16) | 180 }, { id: 1, temp: (0 << 16) | 35 }] }, ctc: { info: { temp: (45 << 16) | 38 } } } } }, "H2D");
  check("status: H2D's two nozzles and the heated chamber", h2.nozzle.length === 2 && h2.nozzle[0].temp === 180 && h2.nozzle[0].target === 220 && h2.nozzle[1].temp === 35 && h2.chamber.temp === 38 && h2.chamber.target === 45 && h2.state === "preparing", h2);
  check("status: print_error as a code with the wiki link", proto.normalize({ print: { print_error: 0x0300800a } }).errors[0]?.code === "0300_800A");
  // commands
  const pf = proto.projectFile({ file: "benchy.gcode.3mf", plate: 2, amsMapping: [1, -1], family: "P1", timelapse: true });
  check("command: project_file for a P1 (file:///sdcard url, plate 2, AMS mapping)", pf.print.command === "project_file" && pf.print.param === "Metadata/plate_2.gcode" && pf.print.url === "file:///sdcard/benchy.gcode.3mf" && JSON.stringify(pf.print.ams_mapping) === "[1,-1]" && pf.print.use_ams && pf.print.timelapse);
  const px = proto.projectFile({ file: "a.3mf", family: "X1" });
  check("command: project_file for an X1 (ftp:// url)", px.print.url === "ftp://a.3mf");
  const ph = proto.projectFile({ file: "a.3mf", family: "H2", amsMapping: [5, -1] });
  check("command: H2D also gets ams_mapping2 ({ams_id, slot_id})", JSON.stringify(ph.print.ams_mapping2) === JSON.stringify([{ ams_id: 1, slot_id: 1 }, { ams_id: 255, slot_id: 0 }]), ph.print.ams_mapping2);
  let over = ""; try { proto.temps({ nozzle: 320 }, "P1S"); } catch (e) { over = e.message; }
  check("command: a nozzle temperature above the model's limit is refused, not clamped", /above/.test(over), over);
  let h2ok = true; try { proto.temps({ nozzle: 340, chamber: 60 }, "H2D"); } catch { h2ok = false; }
  check("command: the H2D's higher limits (350 °C nozzle, heated chamber) are allowed", h2ok);
  check("command: fans in % → M106 P1/P2/P3 S0-255", proto.fans({ part: 100, aux: 50 }).print.param === "M106 P1 S255\nM106 P2 S128\n");
  let spd = ""; try { proto.speed(7); } catch (e) { spd = e.message; } check("command: speed only 1-4", /1 \(silent\)/.test(spd));
  const auth = camera.authPacket("12345678");
  check("camera: the 80-byte login packet (0x40, 0x3000, bblp, the code)", auth.length === 80 && auth.readUInt32LE(0) === 0x40 && auth.readUInt32LE(4) === 0x3000 && auth.subarray(16, 20).toString() === "bblp" && auth.subarray(48, 56).toString() === "12345678");
  check("camera: the X1/H2D RTSPS address", camera.rtspsUrl("192.168.1.50", "ab cd") === "rtsps://bblp:ab%20cd@192.168.1.50:322/streaming/live/1");
}

// ---- 2. a P1S on the simulator: connect, status, commands -------------------------------------------------------------------
const P = await sims.bambuSim({ serial: "01P00A123456789", accessCode: "4f9e2c71", model: "P1S", partial: true });
P.cam.setFrame(F.empty());
store.savePrinter({ id: "p1", name: "Printer 1", number: 1, brand: "bambu", model: "P1S", host: "127.0.0.1", serial: P.serial, accessCode: "4f9e2c71", mqttPort: P.mqttPort, ftpPort: P.ftpPort, cameraPort: P.camPort, aliases: ["the p1s"] });
check("printer: the access code is sealed, not in printers.json", !readFileSync(process.env.DAYSPRING_PRINTERS_FILE, "utf8").includes("4f9e2c71") && store.secretFor("p1").accessCode === "4f9e2c71");
{
  const t = await (await printers.connection("p1", { connect: false })).test();
  check("connect: MQTT over TLS with bblp + the access code, status arrives", t.ok && /P1S/.test(t.text), t.text);
  const s = printers.status("p1");
  check("status through the adapter: idle, AMS, camera present", s.online && s.state === "idle" && s.ams.length === 1 && s.camera, s);
  store.savePrinter({ id: "bad", name: "Wrong code", brand: "bambu", model: "X1C", host: "127.0.0.1", serial: P.serial, accessCode: "00000000", mqttPort: P.mqttPort });
  let bad = ""; try { await printers.connection("bad"); } catch (e) { bad = e.message; }
  check("connect: a wrong access code is explained", /access code/i.test(bad), bad);
  printers.forget("bad"); store.removePrinter("bad");
  let r = await printers.command("p1", "light", "on");
  check("command: light on (ledctrl chamber_light)", r.ok && await until(() => P.lastCommand("ledctrl")?.system.led_mode === "on") && await until(() => printers.status("p1").light === true), r.text);
  r = await printers.command("p1", "speed", 4);
  check("command: speed ludicrous (print_speed 4)", r.ok && P.lastCommand("print_speed")?.print.param === "4", r.text);
  r = await printers.command("p1", "temp", { bed: 60, nozzle: 210 });
  check("command: temperatures (gcode M104/M140)", r.ok && await until(() => /M104 S210/.test(P.lastCommand("gcode_line")?.print.param) && /M140 S60/.test(P.lastCommand("gcode_line")?.print.param)), r.text);
  r = await printers.command("p1", "temp", { nozzle: 450 });
  check("command: 450 °C is refused and nothing is sent", !r.ok && /above/.test(r.text) && !/S450/.test(JSON.stringify(P.commands)), r.text);
  r = await printers.command("p1", "fan", { part: 50 });
  check("command: part fan 50%", r.ok && await until(() => /M106 P1 S128/.test(P.lastCommand("gcode_line")?.print.param)));
  const snap = await printers.snapshot("p1");
  check("camera (P1/A1 TLS stream): a JPEG after the login", snap[0] === 0xff && snap[1] === 0xd8 && P.cam.logins.some((l) => l.user === "bblp" && l.code === "4f9e2c71" && l.type === 0x3000));
}

// ---- 3. the bed-clear check and its thresholds --------------------------------------------------------------------------------
{
  const ref = F.empty();
  const a = await bedCheck(F.clear(), ref, { roi: ROI });
  check("bed: the same empty bed (new noise, 6% brighter) is clear", a.clear, a.reason);
  const b = await bedCheck(F.object(), ref, { roi: ROI });
  check("bed: a part left on it → not clear, and it says where", !b.clear && /middle/.test(b.reason), b.reason);
  const c = await bedCheck(F.purge(), ref, { roi: ROI });
  check("bed: a leftover purge line → not clear (\"long and thin\")", !c.clear && /long and thin/.test(c.reason), c.reason);
  const d = await bedCheck(F.smallObject(), ref, { roi: ROI });
  check("bed: a small part (16×14 px) → not clear", !d.clear, d.reason);
  let fp = 0; for (let s = 2; s < 30; s++) { const r = await bedCheck(synth.scene({ seed: s, exposure: 0.9 + (s % 7) * 0.03, noise: 3 + (s % 4) }), ref, { roi: ROI }); if (!r.clear) fp++; }
  check("bed: threshold: 28 empty-bed pictures with different noise and light, none flagged", fp === 0, fp);
  const e = await bedCheck(F.object(), ref, { roi: { x: 0.05, y: 0.05, w: 0.2, h: 0.2 } });
  check("bed: only the dragged bed area counts (a part outside it is ignored)", e.clear, e.reason);
  const f = await bedCheck(F.clear(), ref, { roi: ROI, ai: async () => '{"clear": false, "confidence": 0.8, "note": "a scraper at the front"}' });
  check("bed: the AI can make it stricter (sees a scraper)", !f.clear && /scraper/.test(f.reason), f.reason);
  const g = await bedCheck(F.object(), ref, { roi: ROI, ai: async () => '{"clear": true, "confidence": 0.99}' });
  check("bed: the AI can't overrule a measured difference", !g.clear);
  const h = await bedCheck(F.clear(), null, { roi: ROI });
  check("bed: no empty-bed picture yet → not clear, and it says to take one", !h.clear && h.needsReference, h.reason);
}

// ---- 4. starting a print: the bed, the owner's yes, upload, project_file --------------------------------------------------------
const gfile = join(TMP, "benchy.gcode.3mf"); writeFileSync(gfile, Buffer.alloc(20000, 7));
{
  store.setBed("p1", { roi: ROI });
  let r = await printers.startPrint("p1", { file: gfile, surface: "tv" });
  check("start: refused with no empty-bed picture", !r.ok && /empty bed/.test(r.text), r.text);
  await printers.captureReference("p1");
  check("start: the empty-bed picture is saved for this printer and plate", store.get("p1").bed.refs.default && existsSync(join(store.REFS_DIR(), store.get("p1").bed.refs.default)));
  P.cam.setFrame(F.object());
  r = await printers.startPrint("p1", { file: gfile, surface: "tv" });
  check("start: refused when the bed isn't clear, and says why", !r.ok && r.bedNotClear && /won't start/.test(r.text) && !P.lastCommand("project_file"), r.text);
  P.cam.setFrame(F.clear());
  r = await printers.startPrint("p1", { file: gfile, surface: "tv" });
  check("start: a clear bed still needs the owner's yes (a question, nothing sent)", r.needsConfirm && /Say yes/.test(r.text) && !P.lastCommand("project_file"), r.text);
  const tok = r.confirmToken;
  r = await printers.startPrint("p1", { file: gfile, surface: "tv", confirmToken: tok });
  check("start: the token alone, without his yes, starts nothing", !r.ok && !P.lastCommand("project_file"), r.text);
  // his yes, but meanwhile someone put something on the bed: the fresh check stops it
  confirm.userSaid("yes", { surface: "tv" });
  P.cam.setFrame(F.purge());
  r = await skills.handle("yes", { surface: "tv" });
  check("start: after his yes, a fresh check still runs: a purge line appeared → not started", !P.lastCommand("project_file") && /won't start|isn't clear|changed/i.test(r?.reply ?? ""), r?.reply);
  P.cam.setFrame(F.clear());
  r = await skills.handle("start the benchy on printer 1", { surface: "tv" });
  check("voice: \"start the benchy on printer 1\" asks (no file folder: it says where)", /couldn't find|Say yes/.test(r?.reply ?? ""), r?.reply);
  queue.add("p1", { file: gfile, plate: 1, amsMapping: [1] });
  r = await skills.handle("start the benchy on printer 1", { surface: "tv" });
  check("voice: from the queue, the benchy: bed clear → the question", /looks clear/.test(r?.reply ?? "") && /Say yes/.test(r.reply), r?.reply);
  confirm.userSaid("yes", { surface: "tv" });
  r = await skills.handle("yes", { surface: "tv" });
  const pf = P.lastCommand("project_file");
  check("start: after yes: uploaded over FTPS to the printer's storage", P.files.get("benchy.gcode.3mf")?.length === 20000, [...P.files.keys()]);
  check("start: project_file sent (P1 file:///sdcard url, plate 1, AMS tray 1)", pf && pf.print.url === "file:///sdcard/benchy.gcode.3mf" && pf.print.param === "Metadata/plate_1.gcode" && JSON.stringify(pf.print.ams_mapping) === "[1]" && pf.print.bed_levelling === true, pf?.print);
  check("start: the queue item is used up", queue.list("p1").length === 0);
  await until(() => printers.status("p1").state === "printing");
  check("start: the printer reports printing, and the print is being watched", printers.status("p1").state === "printing" && monitor.current("p1")?.state === "watching", printers.status("p1").state);
  const logged = activity.search({ kind: "printer", limit: 100 }).entries.map((e) => e.kind);
  check("log: bed checks, the question, the start", logged.includes("printer.bedcheck") && logged.includes("printer.asked") && logged.includes("printer.start"), logged);
  // pause / resume / stop
  r = await skills.handle("pause printer 1", { surface: "tv" });
  check("voice: \"pause printer 1\"", /paused/.test(r?.reply) && P.lastCommand("pause") && await until(() => printers.status("p1").state === "paused"), r?.reply);
  r = await skills.handle("resume printer 1", { surface: "tv" });
  check("voice: \"resume printer 1\"", /resumed/.test(r?.reply) && await until(() => printers.status("p1").state === "printing"), r?.reply);
  P.advance({ mc_percent: 37, layer_num: 44, mc_remaining_time: 61 });
  await until(() => printers.status("p1").progress === 37);
  r = await skills.handle("what's left on the p1s?", { surface: "tv" });
  check("voice: \"what's left on the P1S?\" → 37% done, about 1 hour 1 minutes left", /37% done/.test(r?.reply) && /1 hour/.test(r.reply), r?.reply);
  r = await skills.handle("how's printer 1 doing?", { surface: "tv" });
  check("voice: \"how's printer 1 doing?\"", /printing benchy/.test(r?.reply) && /layer 44 of 120/.test(r.reply), r?.reply);
  r = await skills.handle("stop printer 1", { surface: "tv" });
  check("voice: \"stop printer 1\" asks first (it can't be undone)", /can't be resumed/.test(r?.reply) && !P.lastCommand("stop"), r?.reply);
  confirm.userSaid("no", { surface: "tv" }); await skills.handle("no", { surface: "tv" });
  check("voice: \"no\" → not stopped", !P.lastCommand("stop"));
}

// ---- 5. failure and stringing detection, keeping or deleting the pictures ------------------------------------------------------
async function runSequence(frames, { ai = null, result = "finished", options = {} } = {}) {
  monitor._reset();
  store.setOptions("p1", { autoPause: false, keepTimelapse: false, confirmGood: false, ...options });
  aiReply = ai;
  const p = store.get("p1");
  const job = await monitor.begin({ ...p, options: { ...p.options, snapshotMinutes: 60 } }, { name: "seq" });
  job.watch?.stop?.();          // pictures are fed by hand below (the real ones come every N minutes)
  const verdicts = [];
  for (let k = 0; k < frames.length; k++) {
    P.advance({ mc_percent: Math.round((k / frames.length) * 100), layer_num: k * 20 });
    await sleep(30);
    const v = await monitor.onPicture(p, job, frames[k]);
    verdicts.push(job.frames.at(-1));
  }
  const alerts = job.alerts.slice(), dir = job.dir;
  const end = await monitor.end("p1", result);
  aiReply = null;
  return { alerts, dir, end, verdicts };
}
{
  const pauseBefore = P.commands.filter((c) => c.print?.command === "pause").length;
  let r = await runSequence(synth.goodPrint(6));
  check("good print: no alerts", r.alerts.length === 0, r.verdicts.map((v) => `${v.guess}:${v.score}`));
  check("good print: when it finishes, its pictures are deleted", r.end?.deleted && !existsSync(r.dir), r.end);
  r = await runSequence(synth.spaghettiPrint(6));
  check("spaghetti (local checks, no AI): an alert", r.alerts.some((a) => a.verdict === "spaghetti" || a.verdict === "sudden_change"), r.verdicts.map((v) => `${v.guess}:${v.score}`));
  check("spaghetti: announced (through the floor) with the picture, offering to pause", announced.some((a) => a.kind === "printer" && /spaghetti|sudden/.test(a.text) && /pause it\?/.test(a.text) && a.image));
  check("auto-pause is OFF by default: nothing was paused", P.commands.filter((c) => c.print?.command === "pause").length === pauseBefore);
  check("never auto-stop: no stop command was sent", !P.lastCommand("stop"));
  check("bad print: pictures kept, with a report", existsSync(r.dir) && existsSync(join(r.dir, "report.txt")) && readdirSync(r.dir).filter((f) => f.endsWith(".jpg")).length === 6 && /Alerts:/.test(readFileSync(join(r.dir, "report.txt"), "utf8")), r.dir);
  const strAI = (prompt) => (/middle of a print/.test(prompt) ? (strAI.n = (strAI.n ?? 0) + 1) >= 4 ? '{"verdict":"stringing","confidence":0.82,"note":"thin strings between the two towers"}' : '{"verdict":"ok","confidence":0.9}' : '{"clear":true}');
  r = await runSequence(synth.stringingPrint(6), { ai: strAI });
  check("stringing (AI mocked): an alert, as a warning", r.alerts.some((a) => a.verdict === "stringing" && a.severity === "warning"), r.alerts);
  check("stringing: kept (it had an alert) even though the print finished", r.end?.kept && existsSync(r.dir));
  const okAI = () => '{"verdict":"ok","confidence":0.95}';
  r = await runSequence(synth.goodPrint(6), { ai: okAI });
  check("good print with the AI saying fine: no alert, deleted", r.alerts.length === 0 && r.end?.deleted);
  r = await runSequence(synth.detachedPrint(6));
  check("a part come loose (local: the part vanished while printing): an alert", r.alerts.some((a) => a.verdict === "detached"), r.verdicts.map((v) => `${v.guess}:${v.score}`));
  r = await runSequence(synth.goodPrint(4), { result: "failed" });
  check("a print the printer says failed: pictures kept with a report", r.end?.kept && existsSync(join(r.dir, "report.txt")));
  // the printer's own error
  const errV = await analyzeFrame({ frame: F.clear(), status: { errors: [{ code: "0300_800A", text: "Printer error 0300_800A" }], progress: 40 } });
  check("printer error codes count as a failure", errV.alert && errV.verdict === "printer_error", errV);
  // auto-pause on
  const before = P.commands.filter((c) => c.print?.command === "pause").length;
  r = await runSequence(synth.spaghettiPrint(6), { options: { autoPause: true } });
  check("auto-pause ON: a failure pauses the print (and says so)", P.commands.filter((c) => c.print?.command === "pause").length > before && announced.some((a) => /I paused it/.test(a.text)));
  // "always keep a timelapse"
  r = await runSequence(synth.goodPrint(5), { options: { keepTimelapse: true } });
  check("keep timelapse: a good print leaves only timelapse.mp4", r.end?.timelapse === "timelapse.mp4" && existsSync(join(r.dir, "timelapse.mp4")) && !readdirSync(r.dir).some((f) => f.endsWith(".jpg")), r.end);
  // "Did it come out okay?"
  r = await runSequence(synth.goodPrint(3), { options: { confirmGood: true } });
  check("confirm good: it asks first and keeps the pictures until he answers", r.end?.awaiting && existsSync(r.dir));
  const ans = await skills.handle("yes it came out great", { surface: "tv" });
  check("confirm good: his yes clears the pictures", /cleared/.test(ans?.reply ?? "") && !existsSync(r.dir), ans?.reply);
  store.setOptions("p1", { confirmGood: false, keepTimelapse: false, autoPause: false });
}

// ---- 6. auto-start: only with the setting on, only from the queue, only on a fresh clear check -------------------------------------
{
  P.advance({ gcode_state: "FINISH", mc_percent: 100 }); await until(() => printers.status("p1").state === "finished");
  P.commands.length = 0;
  queue.add("p1", { file: gfile });
  P.cam.setFrame(F.object());
  store.setOptions("p1", { autoStart: true });
  let r = await queue.next("p1", { auto: true });
  check("auto-start on, bed NOT clear: refused", !r.ok && r.bedNotClear && !P.lastCommand("project_file"), r.text);
  P.cam.setFrame(F.clear());
  r = await queue.next("p1", { auto: true });
  check("auto-start on, bed clear: starts without asking", r.ok && r.started && P.lastCommand("project_file"), r.text);
  P.advance({ gcode_state: "FINISH" }); await until(() => printers.status("p1").state === "finished");
  store.setOptions("p1", { autoStart: false }); P.commands.length = 0;
  queue.add("p1", { file: gfile });
  r = await queue.next("p1", { auto: true });
  check("auto-start off (the default): the queue still asks", r.needsConfirm && !P.lastCommand("project_file"), r.text);
  confirm.userSaid("no", { surface: "tv" }); await printers.answer("no", { surface: "tv" });
  check("the default for a new printer is \"ask me first\" (auto-start off, auto-pause off)", store.OPTION_DEFAULTS.autoStart === false && store.OPTION_DEFAULTS.autoPause === false);
}

// ---- 7. newer firmware without Developer mode ---------------------------------------------------------------------------------
{
  const X = await sims.bambuSim({ serial: "00M00A987654321", accessCode: "87654321", model: "X1C", devMode: false });
  store.savePrinter({ id: "x1", name: "X1", number: 2, brand: "bambu", model: "X1C", host: "127.0.0.1", serial: X.serial, accessCode: "87654321", mqttPort: X.mqttPort, ftpPort: X.ftpPort, cameraUrl: join(TMP, "x1cam.mp4") });
  const vid = sims.testVideo(join(TMP, "x1cam.mp4"));
  await printers.connection("x1");
  check("no Developer mode: status still arrives", await until(() => printers.status("x1").online && printers.status("x1").state === "idle"));
  const r = await printers.command("x1", "pause");
  check("no Developer mode: a control command is refused, and it says to turn on LAN Only + Developer mode", !r.ok && /Developer mode/.test(r.text), r.text);
  // the X1's camera through ffmpeg (a test clip standing in for RTSPS)
  const snap = vid ? await printers.snapshot("x1").catch((e) => e) : null;
  check("camera (X1 via ffmpeg, a test clip for the RTSP stream): a JPEG", Buffer.isBuffer(snap) && snap[0] === 0xff && snap[1] === 0xd8, snap?.message ?? "");
  let frames = 0; const stop = await printers.bridge.live("printer-x1", () => { frames++; }, { fps: 5 });
  await until(() => frames >= 3, 8000); stop();
  check("camera: live view frames from ffmpeg (for the MJPEG view)", frames >= 3, frames);
  printers.forget("x1"); X.close();
}

// ---- 8. the AI's tools and voice --------------------------------------------------------------------------------------------
{
  P.cam.setFrame(F.clear());
  let r = await skills.runTool("printer_bed_check", { printer: "printer 1" });
  check("tool printer_bed_check", r.clear === true, r);
  r = await skills.runTool("printer_start", { printer: "printer 1", file: gfile });
  check("tool printer_start: returns the question, never starts by itself", r.needsConfirm && r.confirmToken, r.text);
  r = await skills.runTool("printer_status", { printer: "the p1s" });
  check("tool printer_status: by model name", r.name === "Printer 1" && typeof r.said === "string", r);
  r = await skills.handle("is the bed clear on printer 1?", { surface: "tv" });
  check("voice: \"is the bed clear on printer 1?\"", /looks clear/.test(r?.reply ?? ""), r?.reply);
  r = await skills.handle("show me the camera on the p1s", { surface: "tv" });
  check("voice: \"show me the camera on the P1S\" opens the live view", /camera/.test(r?.reply) && /printers\.html.*camera=1/.test(r?.openPage ?? ""), r);
  const dz = await skills.handle("pause printer 1", { surface: "discord" });
  check("not the owner: a Discord message can't pause (or start or stop) a printer", /Only the owner/.test(dz?.reply ?? ""), dz?.reply);
  skills.noteSurface("discord");
  const tz = await skills.runTool("printer_control", { printer: "printer 1", action: "pause" });
  check("not the owner: the AI's tool call during a Discord conversation is refused too", tz.refused === true, tz.text);
  // another of the owner's Dayspring computers (lib/remote calls these)
  const all = printers.status();
  check("remote: status() with no printer = every printer, with a spoken line", all.printers?.length >= 1 && /Printer 1/.test(all.say), all.say);
  check("remote: status(\"printer 1\") by name, with a spoken line", printers.status("printer 1")?.id === "p1" && typeof printers.status("printer 1").say === "string");
  check("remote: names() include \"printer 1\" and the aliases", printers.names().includes("printer 1") && printers.names().includes("the p1s"));
  confirm.userSaid("no", { surface: "tv" }); await printers.answer("no", { surface: "tv" });
  queue.add("p1", { file: gfile });
  P.cam.setFrame(F.clear()); P.commands.length = 0;
  let rr = await printers.start("printer 1", "benchy", { from: { deviceId: "lap-1", name: "Laptop" } });
  check("remote start: the bed is checked, then it asks (bound to the laptop)", rr.needsConfirm && !P.lastCommand("project_file"), rr.say);
  confirm.userSaid("yes", { surface: "tv" });
  check("remote start: a yes said on THIS screen doesn't approve the laptop's question", !confirm.isApproved(rr.confirmToken));
  P.cam.setFrame(F.object());
  rr = await printers.start("printer 1", "benchy", { from: { deviceId: "lap-1", name: "Laptop" }, confirmed: true });
  check("remote start with the laptop's yes, but the bed isn't clear now: refused", !rr.ok && rr.bedNotClear && !P.lastCommand("project_file"), rr.say);
  P.cam.setFrame(F.clear());
  rr = await printers.start("printer 1", "benchy", { from: { deviceId: "lap-1", name: "Laptop" }, confirmed: true });
  check("remote start with the laptop's yes and a clear bed: started", rr.ok && rr.started && P.lastCommand("project_file"), rr.say);
  const names = skills.TOOLS.map((t) => t.name);
  check("tools: status, camera, bed check, start, control, queue", ["printer_status", "printer_camera", "printer_bed_check", "printer_start", "printer_control", "printer_queue"].every((n) => names.includes(n)));
}

// ---- 9. through lib/cameras (when it's in this build) and the fallback ------------------------------------------------------------
{
  const shared = printers.bridge.watching();
  check("camera bridge: the printer's camera is a source in the camera system (or the fallback)", printers.cameraId("p1") === "printer-p1");
  printers.bridge._useLocal();
  const snap = await printers.bridge.snapshot("printer-p1").catch((e) => e);
  check("camera bridge: the built-in fallback still takes pictures", Buffer.isBuffer(snap), snap?.message);
  void shared;
}

printers.stopAll(); P.close(); queue._reset(); monitor._reset();
await sleep(200);
rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
