// Simulated printers for the printer tests (127.0.0.1 only, ports picked by the system):
//   bambuSim({ serial, accessCode, model, devMode, partial })  a Bambu printer's MQTT over TLS (an aedes broker with the
//       printer's report/request topics and a little printer behind it), its implicit-FTPS storage, and its camera
//       (the P1/A1 TLS JPEG stream). devMode:false = newer firmware without Developer mode: control commands are refused.
//   marlinSim({ ... })  a Marlin printer on a TCP "serial line": line numbers and checksums, resends, M105 temperatures,
//       heating, busy, and injected faults (thermal runaway, a dropped cable)
//   octoSim() · moonSim()   OctoPrint's and Moonraker's REST APIs
//   testVideo(path)  a short clip made with ffmpeg (the stand-in for an X1's RTSP camera)
import { createServer as tlsServer } from "node:tls";
import { createServer as tcpServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { checksum } from "../../../../lib/printers/marlin/sender.mjs";

let certCache = null;
export async function cert() {
  if (certCache) return certCache;
  const sel = (await import("selfsigned")).default ?? (await import("selfsigned"));
  const r = await sel.generate([{ name: "commonName", value: "01P00A000000000" }], { days: 2, keySize: 2048 });
  certCache = { key: r.private, cert: r.cert };
  return certCache;
}
const listen = (srv, host = "127.0.0.1") => new Promise((r) => srv.listen(0, host, () => r(srv.address().port)));

// ---- Bambu ------------------------------------------------------------------------------------------------------------
export function fullReport(over = {}) {
  return { print: { gcode_state: "IDLE", mc_percent: 0, mc_remaining_time: 0, layer_num: 0, total_layer_num: 0, nozzle_temper: 26.5, nozzle_target_temper: 0, bed_temper: 24.1, bed_target_temper: 0, chamber_temper: 25,
    cooling_fan_speed: "0", big_fan1_speed: "0", big_fan2_speed: "0", spd_lvl: 2, spd_mag: 100, print_error: 0, hms: [], subtask_name: "", gcode_file: "", stg_cur: 0, wifi_signal: "-45dBm",
    lights_report: [{ node: "chamber_light", mode: "off" }], nozzle_diameter: "0.4", nozzle_type: "hardened_steel",
    ams: { ams: [{ id: "0", humidity: "4", temp: "24.5", tray: [{ id: "0", tray_type: "PLA", tray_color: "FFFFFFFF", remain: 80 }, { id: "1", tray_type: "PETG", tray_color: "0A2989FF", remain: 45 }, { id: "2", tray_type: "PLA", tray_color: "000000FF", remain: 100 }, { id: "3" }] }], tray_now: "255" },
    ...over } };
}
export async function bambuSim({ serial = "01P00A123456789", accessCode = "12345678", model = "P1S", devMode = true, partial = false } = {}) {
  const { key, cert: crt } = await cert();
  const { Aedes } = await import("aedes");
  const broker = await Aedes.createBroker();
  const state = fullReport().print, commands = [], files = new Map();
  broker.authenticate = (client, username, password, cb) => { const ok = username === "bblp" && String(password ?? "") === accessCode; if (!ok) { const e = new Error("Bad username or password"); e.returnCode = 4; return cb(e, false); } cb(null, true); };
  const report = (obj) => broker.publish({ topic: `device/${serial}/report`, payload: Buffer.from(JSON.stringify(obj)), qos: 0, retain: false }, () => {});
  const CONTROL = new Set(["pause", "resume", "stop", "print_speed", "project_file", "gcode_line", "gcode_file", "ledctrl"]);
  broker.on("publish", (packet, client) => {
    if (!client || packet.topic !== `device/${serial}/request`) return;
    let j; try { j = JSON.parse(packet.payload.toString()); } catch { return; }
    commands.push(j);
    const cmd = j.print?.command ?? j.system?.command ?? j.pushing?.command ?? j.info?.command, seq = j.print?.sequence_id ?? j.system?.sequence_id ?? j.pushing?.sequence_id;
    if (cmd === "pushall") return report({ print: { ...state, command: "push_status", msg: 0, sequence_id: seq } });
    if (cmd === "get_version") return report({ info: { command: "get_version", sequence_id: seq, module: [{ name: "ota", sw_ver: "01.08.02.00" }] } });
    if (CONTROL.has(cmd) && !devMode) return report({ [j.system ? "system" : "print"]: { command: cmd, sequence_id: seq, result: "fail", reason: "84033543 authorization required" } });
    const changed = {};
    const set = (k, v) => { state[k] = v; changed[k] = v; };
    if (cmd === "pause") set("gcode_state", "PAUSE");
    if (cmd === "resume") set("gcode_state", "RUNNING");
    if (cmd === "stop") { set("gcode_state", "IDLE"); set("mc_percent", 0); }
    if (cmd === "print_speed") set("spd_lvl", Number(j.print.param));
    if (cmd === "ledctrl") set("lights_report", [{ node: j.system.led_node, mode: j.system.led_mode }]);
    if (cmd === "gcode_line") { let m; if ((m = /M140 S(\d+)/.exec(j.print.param))) set("bed_target_temper", Number(m[1])); if ((m = /M104 (?:T\d )?S(\d+)/.exec(j.print.param))) set("nozzle_target_temper", Number(m[1])); if ((m = /M106 P1 S(\d+)/.exec(j.print.param))) set("cooling_fan_speed", String(Math.round((Number(m[1]) / 255) * 15))); }
    if (cmd === "project_file") { set("gcode_state", "RUNNING"); set("mc_percent", 0); set("subtask_name", j.print.subtask_name); set("gcode_file", j.print.file); set("layer_num", 0); set("total_layer_num", 120); set("mc_remaining_time", 95); }
    report({ [j.system ? "system" : "print"]: { command: cmd, sequence_id: seq, result: "success", ...(partial ? {} : {}) } });
    report({ print: partial ? changed : { ...state } });
  });
  const mq = tlsServer({ key, cert: crt }, broker.handle);
  const mqttPort = await listen(mq);
  // the printer moving on by itself (tests call this): progress, a finish, an error
  const advance = (patch) => { Object.assign(state, patch); report({ print: partial ? patch : { ...state } }); };
  // ---- FTPS (implicit TLS on the control and the data connections) ----
  const ftp = await ftpsServer({ user: "bblp", pass: accessCode, files, key, cert: crt });
  // ---- camera: the P1/A1 TLS stream ----
  const cam = await camSim({ accessCode, key, cert: crt });
  return { serial, accessCode, mqttPort, ftpPort: ftp.port, camPort: cam.port, state, commands, files, advance, cam, broker,
    lastCommand: (name) => [...commands].reverse().find((c) => (c.print?.command ?? c.system?.command) === name),
    close: () => { try { mq.close(); } catch { /* closed */ } broker.close(); ftp.close(); cam.close(); } };
}

export async function ftpsServer({ user, pass, files, key, cert: crt }) {
  let pendingData = null;
  const srv = tlsServer({ key, cert: crt }, (sock) => {
    let authed = false, u = null, buf = "";
    const say = (s) => sock.write(s + "\r\n");
    say("220 Bambu FTP ready");
    sock.on("data", async (d) => {
      buf += d.toString("latin1");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const [c0, ...rest] = line.split(" "); const cmd = c0.toUpperCase(), arg = rest.join(" ");
        if (cmd === "USER") { u = arg; say("331 password please"); continue; }
        if (cmd === "PASS") { if (u === user && arg === pass) { authed = true; say("230 logged in"); } else say("530 Login incorrect."); continue; }
        if (!authed) { say("530 Please login"); continue; }
        if (["TYPE", "STRU", "OPTS", "PBSZ", "PROT", "MODE"].includes(cmd)) { say("200 ok"); continue; }
        if (cmd === "FEAT") { say("211-Features:\r\n PASV\r\n EPSV\r\n SIZE\r\n211 End"); continue; }
        if (cmd === "PWD") { say('257 "/"'); continue; }
        if (cmd === "CWD") { say("250 ok"); continue; }
        if (cmd === "SIZE") { const f = files.get(arg.replace(/^\/+/, "")); say(f ? `213 ${f.length}` : "550 no such file"); continue; }
        if (cmd === "EPSV" || cmd === "PASV") {
          const ds = tlsServer({ key, cert: crt });
          const port = await listen(ds);
          pendingData = new Promise((res) => ds.once("secureConnection", (dsock) => { res({ dsock, ds }); }));
          say(cmd === "EPSV" ? `229 Entering Extended Passive Mode (|||${port}|)` : `227 Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})`);
          continue;
        }
        if (cmd === "STOR") {
          const name = arg.replace(/^\/+/, ""); say("150 ok to send data");
          const { dsock, ds } = await pendingData; const chunks = [];
          dsock.on("data", (x) => chunks.push(x));
          dsock.on("end", () => { files.set(name, Buffer.concat(chunks)); ds.close(); say("226 Transfer complete"); });
          continue;
        }
        if (cmd === "LIST" || cmd === "MLSD" || cmd === "NLST") {
          say("150 here it comes"); const { dsock, ds } = await pendingData;
          dsock.end([...files].map(([n, b]) => `-rw-r--r-- 1 root root ${b.length} Sep 28 10:00 ${n}`).join("\r\n") + "\r\n", () => { ds.close(); say("226 done"); });
          continue;
        }
        if (cmd === "DELE") { files.delete(arg.replace(/^\/+/, "")); say("250 deleted"); continue; }
        if (cmd === "QUIT") { say("221 bye"); sock.end(); continue; }
        say("502 not implemented");
      }
    });
    sock.on("error", () => {});
  });
  const port = await listen(srv);
  return { port, close: () => srv.close() };
}

// the P1/A1 camera: an 80-byte login, then JPEG frames with 16-byte headers
export async function camSim({ accessCode, key, cert: crt, fps = 10 }) {
  let frame = null; const logins = [];
  const srv = tlsServer({ key, cert: crt }, (sock) => {
    let got = Buffer.alloc(0), timer = null;
    sock.on("data", (d) => {
      if (timer) return;
      got = Buffer.concat([got, d]); if (got.length < 80) return;
      const user = got.subarray(16, 48).toString("ascii").replace(/\0+$/, ""), code = got.subarray(48, 80).toString("ascii").replace(/\0+$/, "");
      logins.push({ user, code, size: got.readUInt32LE(0), type: got.readUInt32LE(4) });
      if (user !== "bblp" || code !== accessCode) return sock.destroy();
      timer = setInterval(() => { if (!frame) return; const f = typeof frame === "function" ? frame() : frame; const h = Buffer.alloc(16); h.writeUInt32LE(f.length, 0); h.writeUInt32LE(0, 4); h.writeUInt32LE(1, 8); sock.write(Buffer.concat([h, f])); }, 1000 / fps);
    });
    sock.on("close", () => clearInterval(timer));
    sock.on("error", () => clearInterval(timer));
  });
  const port = await listen(srv);
  return { port, logins, setFrame: (f) => { frame = f; }, close: () => srv.close() };
}

export function testVideo(path) {
  const r = spawnSync(ffmpegPath, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=10", "-t", "3", "-pix_fmt", "yuv420p", path], { windowsHide: true });
  return r.status === 0;
}

// ---- Marlin on a TCP line ----------------------------------------------------------------------------------------------
export async function marlinSim({ resendAt = null, heatRate = 40 } = {}) {
  const st = { expect: 1, received: [], temps: { T: [22, 0], B: [21, 0] }, halted: false, resent: 0, raw: [] };
  let sock = null, garbleOnce = resendAt;
  const srv = tcpServer((s) => {
    sock = s; let buf = "";
    s.write("start\nechoSimulated Marlin\n");
    s.on("data", (d) => {
      buf += d.toString("latin1"); let i;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
    });
    s.on("error", () => {});
  });
  const tempLine = () => `T:${st.temps.T[0].toFixed(1)} /${st.temps.T[1].toFixed(1)} B:${st.temps.B[0].toFixed(1)} /${st.temps.B[1].toFixed(1)} @:0 B@:0`;
  const heat = () => { for (const k of ["T", "B"]) { if (st.stuck?.[k] !== undefined) { st.temps[k][0] = st.stuck[k]; continue; } const [t, g] = st.temps[k]; const target = g || 22; st.temps[k][0] = t + Math.sign(target - t) * Math.min(Math.abs(target - t), heatRate); } };
  function handle(line) {
    st.raw.push(line);
    if (st.halted) return;
    let cmd = line, n = null;
    const m = /^N(\d+) (.*)\*(\d+)$/.exec(line);
    if (m) {
      n = Number(m[1]);
      const cs = checksum(`N${m[1]} ${m[2]}`);
      if (garbleOnce === n) { garbleOnce = null; st.resent++; sock.write(`Error:checksum mismatch, Last Line: ${n - 1}\nResend: ${n}\nok\n`); return; }
      if (cs !== Number(m[3])) { sock.write(`Error:checksum mismatch, Last Line: ${st.expect - 1}\nResend: ${st.expect}\nok\n`); return; }
      if (n !== st.expect) { sock.write(`Error:Line Number is not Last Line Number+1, Last Line: ${st.expect - 1}\nResend: ${st.expect}\nok\n`); return; }
      st.expect = n + 1; cmd = m[2];
    }
    const g = cmd.split(" ")[0].toUpperCase();
    if (g === "M110") { st.expect = Number((/N(\d+)/.exec(cmd.slice(4)) ?? [0, 0])[1]) + 1; sock.write("ok\n"); return; }
    st.received.push(cmd);
    heat();
    if (g === "M105") return sock.write(`ok ${tempLine()}\n`);
    if (g === "M115") return sock.write("FIRMWARE_NAME:Marlin 2.0.6 (Simulated) SOURCE_CODE_URL:github.com/MarlinFirmware PROTOCOL_VERSION:1.0 MACHINE_TYPE:Ender-5 Plus EXTRUDER_COUNT:1\nok\n");
    let t;
    if ((g === "M104" || g === "M109") && (t = /S(\d+)/.exec(cmd))) st.temps.T[1] = Number(t[1]);
    if ((g === "M140" || g === "M190") && (t = /S(\d+)/.exec(cmd))) st.temps.B[1] = Number(t[1]);
    if (g === "M109" || g === "M190") { sock.write(`echo:busy: processing\n ${tempLine()}\n`); setTimeout(() => { st.temps.T[0] = st.temps.T[1] || st.temps.T[0]; st.temps.B[0] = st.temps.B[1] || st.temps.B[0]; sock.write(`${tempLine()}\nok\n`); }, 60); return; }
    if (st.slowMs) { setTimeout(() => sock.write("ok\n"), st.slowMs); return; }
    sock.write("ok\n");
  }
  const port = await listen(srv);
  return { port, st, url: `tcp://127.0.0.1:${port}`, setSlow: (ms) => { st.slowMs = ms; },
    runaway: () => { st.halted = true; sock?.write("Error:Thermal Runaway, system stopped! Heater_ID: 0\nError:Printer halted. kill() called!\n"); },
    unplug: () => { sock?.destroy(); },
    setTemp: (k, v) => { st.stuck = { ...(st.stuck ?? {}), [k]: v }; st.temps[k][0] = v; },   // held there (a runaway), until unstick()
    unstick: () => { st.stuck = {}; },
    close: () => { sock?.destroy(); srv.close(); } };
}

// ---- OctoPrint and Moonraker ---------------------------------------------------------------------------------------------
export async function octoSim({ apiKey = "octo-key", jpeg = null } = {}) {
  const st = { flags: { operational: true, ready: true, printing: false, paused: false, error: false }, tool: [25, 0], bed: [24, 0], file: null, completion: 0, uploads: [], commands: [] };
  const srv = httpServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), json = (o, c = 200) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/webcam/snapshot") { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(jpeg ?? Buffer.alloc(0)); }
    if (req.headers["x-api-key"] !== apiKey) return json({ error: "Invalid API key" }, 403);
    const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks);
    const b = /json/.test(req.headers["content-type"] ?? "") ? JSON.parse(raw.toString() || "{}") : null;
    if (u.pathname === "/api/printer") return json({ state: { text: st.flags.printing ? "Printing" : st.flags.paused ? "Paused" : "Operational", flags: st.flags }, temperature: { tool0: { actual: st.tool[0], target: st.tool[1] }, bed: { actual: st.bed[0], target: st.bed[1] } } });
    if (u.pathname === "/api/job" && req.method === "GET") return json({ job: { file: { name: st.file, display: st.file } }, progress: { completion: st.completion, printTimeLeft: st.flags.printing ? 1800 : null }, state: "x" });
    if (u.pathname === "/api/job" && req.method === "POST") { st.commands.push(b); if (b.command === "pause") { st.flags.printing = b.action === "resume"; st.flags.paused = b.action === "pause"; } if (b.command === "cancel") { st.flags.printing = false; st.flags.paused = false; } return json({}, 204); }
    if (u.pathname === "/api/files/local" && req.method === "POST") { const name = /filename="([^"]+)"/.exec(raw.toString("latin1"))?.[1] ?? "upload.gcode"; st.uploads.push({ name, bytes: raw.length }); return json({ files: { local: { name } }, done: true }, 201); }
    let m;
    if ((m = /^\/api\/files\/local\/(.+)$/.exec(u.pathname)) && req.method === "POST") { st.file = decodeURIComponent(m[1]); st.flags.printing = Boolean(b?.print); st.completion = 0; return json({}, 204); }
    if (u.pathname === "/api/printer/tool") { st.tool[1] = b.targets.tool0; return json({}, 204); }
    if (u.pathname === "/api/printer/bed") { st.bed[1] = b.target; return json({}, 204); }
    if (u.pathname === "/api/printer/command") { st.commands.push(b); return json({}, 204); }
    if (u.pathname === "/api/settings") return json({ webcam: { snapshotUrl: "/webcam/snapshot" } });
    json({ error: "not found" }, 404);
  });
  const port = await listen(srv);
  return { port, st, close: () => srv.close() };
}
export async function moonSim() {
  const st = { state: "standby", filename: "", progress: 0, ext: [25, 0], bed: [24, 0], scripts: [], uploads: [], calls: [] };
  const srv = httpServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), json = (o, c = 200) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks);
    st.calls.push(u.pathname + u.search);
    if (u.pathname === "/printer/objects/query") return json({ result: { status: { print_stats: { state: st.state, filename: st.filename, print_duration: 600, info: { current_layer: 12, total_layer: 80 } }, virtual_sdcard: { progress: st.progress }, extruder: { temperature: st.ext[0], target: st.ext[1] }, heater_bed: { temperature: st.bed[0], target: st.bed[1] }, fan: { speed: 0.5 }, webhooks: { state: "ready" } } } });
    if (u.pathname === "/printer/print/pause") { st.state = "paused"; return json({ result: "ok" }); }
    if (u.pathname === "/printer/print/resume") { st.state = "printing"; return json({ result: "ok" }); }
    if (u.pathname === "/printer/print/cancel") { st.state = "cancelled"; return json({ result: "ok" }); }
    if (u.pathname === "/printer/print/start") { st.filename = u.searchParams.get("filename"); st.state = "printing"; st.progress = 0.01; return json({ result: "ok" }); }
    if (u.pathname === "/printer/gcode/script") { st.scripts.push(u.searchParams.get("script")); return json({ result: "ok" }); }
    if (u.pathname === "/server/files/upload") { const name = /filename="([^"]+)"/.exec(raw.toString("latin1"))?.[1] ?? "x.gcode"; st.uploads.push(name); return json({ item: { path: name } }, 201); }
    if (u.pathname === "/server/webcams/list") return json({ result: { webcams: [] } });
    json({ error: "not found" }, 404);
  });
  const port = await listen(srv);
  return { port, st, close: () => srv.close() };
}
