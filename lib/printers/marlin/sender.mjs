// Talking G-code to a Marlin printer (Creality Ender 5 Plus and friends) over USB serial, or over TCP for a serial
// bridge (ser2net, an ESP3D Wi-Fi board) and for the simulator in the tests.
//   · every line is numbered and checksummed ("N12 G1 X10*97"); Marlin answers "ok", or "Resend: 12" after a garbled
//     line, and we send from that line again; "echo:busy: processing" means it's still working (keep waiting)
//   · temperatures come from M105 (or Marlin's auto-report) as "T:210.0 /210.0 B:60.0 /60.0"
//   · "Error:…Thermal Runaway", "MAXTEMP", "MINTEMP", "Heating failed", "Printer halted. kill() called!" end the print
//     and are reported at once; so does the connection dropping mid-print (unplugged, or this computer slept)
//   · streaming: one line at a time (the safe way on an old board), with an M105 slipped in every few seconds
// This file knows nothing about Dayspring; ./index.mjs wraps it as a printer.
import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";

export const checksum = (s) => { let c = 0; for (let i = 0; i < s.length; i++) c ^= s.charCodeAt(i); return c & 0xff; };
export const numbered = (n, cmd) => { const s = `N${n} ${cmd}`; return `${s}*${checksum(s)}`; };
// strip comments and blank lines; keep the command
export const clean = (line) => String(line).replace(/;.*$/, "").replace(/\(.*?\)/g, "").trim();
const FATAL = /Error:.*(thermal runaway|maxtemp|mintemp|heating failed|printer halted|kill\(\) called|temp sensor defect|heating error)/i;
export function parseTemps(line) {
  const out = {}; let m;
  const re = /\b(T\d?|B|C):\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)/g;
  while ((m = re.exec(line))) { const k = m[1] === "B" ? "bed" : m[1] === "C" ? "chamber" : m[1] === "T" || m[1] === "T0" ? "nozzle" : `nozzle${m[1].slice(1)}`; if (!out[k]) out[k] = { temp: Number(m[2]), target: Number(m[3]) }; }
  return Object.keys(out).length ? out : null;
}

// the line-based link: serial (serialport, optional dependency) or tcp://host:port
export async function openLink(where, { baud = 115200 } = {}) {
  const ee = new EventEmitter();
  if (/^tcp:\/\//i.test(where)) {
    const u = new URL(where);
    const sock = createConnection({ host: u.hostname, port: Number(u.port) });
    await new Promise((res, rej) => { sock.once("connect", res); sock.once("error", rej); });
    let buf = "";
    sock.on("data", (d) => { buf += d.toString("latin1"); let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); ee.emit("line", l); } });
    sock.on("close", () => ee.emit("close"));
    sock.on("error", (e) => ee.emit("error", e));
    ee.write = (s) => sock.write(s + "\n");
    ee.close = () => sock.destroy();
    ee.kind = "tcp";
    return ee;
  }
  let SerialPort, ReadlineParser;
  try { ({ SerialPort } = await import("serialport")); ({ ReadlineParser } = await import("@serialport/parser-readline")); }
  catch { throw new Error("USB printing needs the serialport package, and it isn't installed. Reinstall Dayspring, or use OctoPrint or Klipper instead (more reliable anyway)."); }
  const port = new SerialPort({ path: where, baudRate: Number(baud) || 115200, autoOpen: false });
  await new Promise((res, rej) => port.open((e) => (e ? rej(new Error(/Access denied|busy/i.test(e.message) ? `${where} is in use by another program (Cura, Pronterface, OctoPrint?). Close it and try again.` : `Couldn't open ${where}: ${e.message}`)) : res())));
  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
  parser.on("data", (l) => ee.emit("line", String(l).replace(/\r$/, "")));
  port.on("close", () => ee.emit("close"));
  port.on("error", (e) => ee.emit("error", e));
  ee.write = (s) => port.write(s + "\n");
  ee.close = () => { try { port.close(); } catch { /* closed */ } };
  ee.kind = "serial";
  return ee;
}
export async function listPorts() {
  try { const { SerialPort } = await import("serialport"); return (await SerialPort.list()).map((p) => ({ path: p.path, name: [p.manufacturer, p.friendlyName].filter(Boolean).join(" ") || p.path, vendorId: p.vendorId, productId: p.productId, likelyPrinter: /ch340|ch341|ft232|cp210|1a86|0403|10c4|marlin|creality|arduino/i.test(`${p.manufacturer} ${p.vendorId} ${p.friendlyName}`) })); }
  catch { return []; }
}

export class Sender extends EventEmitter {
  constructor(link, { tempEveryMs = 4000, lineTimeoutMs = 30_000 } = {}) {
    super();
    this.link = link; this.n = 0; this.sent = new Map(); this.waiting = null; this.queue = [];
    this.temps = {}; this.state = "idle"; this.job = null; this.fault = null; this.tempEveryMs = tempEveryMs; this.lineTimeoutMs = lineTimeoutMs;
    this.lastTempAt = 0; this.firmware = null;
    link.on("line", (l) => this.onLine(l));
    link.on("close", () => this.onClose());
    link.on("error", (e) => this.emit("log", `link: ${e.message}`));
  }
  onClose() {
    const printing = this.state === "printing" || this.state === "paused";
    this.state = "offline";
    if (printing) this.failJob("The USB connection to the printer dropped in the middle of the print (unplugged, the computer slept, or the printer reset). The print has stopped.", "disconnect");
    this.rejectWaiting(new Error("The printer disconnected."));
    this.emit("status");
  }
  rejectWaiting(e) { const w = this.waiting; this.waiting = null; if (w) { clearTimeout(w.t); w.reject(e); } for (const q of this.queue.splice(0)) q.reject(e); }
  onLine(line) {
    this.emit("raw", line);
    const t = parseTemps(line);
    if (t) { this.temps = { ...this.temps, ...t }; this.lastTempAt = Date.now(); this.emit("temps", this.temps); }
    if (/FIRMWARE_NAME:/i.test(line)) this.firmware = (/FIRMWARE_NAME:([^ ]+(?: [^ :]+)*?)(?: SOURCE_CODE_URL| PROTOCOL_VERSION| MACHINE_TYPE|$)/i.exec(line) ?? [])[1] ?? line;
    if (FATAL.test(line)) { this.fault = line.replace(/^Error:\s*/i, ""); this.failJob(`The printer stopped itself: ${this.fault}. Check it before printing again.`, "thermal"); return; }
    const rs = /^(?:Resend|rs)\s*:?\s*N?(\d+)/i.exec(line);
    if (rs) { this.resendFrom = Number(rs[1]); return; }
    if (/^ok\b/i.test(line)) {
      const w = this.waiting; this.waiting = null;
      if (w) {
        clearTimeout(w.t);
        if (this.resendFrom !== undefined) { const from = this.resendFrom; this.resendFrom = undefined; w.resend = from; }
        w.resolve(w);
      }
      this.pump();
      return;
    }
    if (/busy:/i.test(line) && this.waiting) { clearTimeout(this.waiting.t); this.waiting.t = setTimeout(() => this.timeout(), this.lineTimeoutMs); }
  }
  timeout() { const w = this.waiting; this.waiting = null; if (w) w.reject(Object.assign(new Error("The printer stopped answering."), { code: "timeout" })); this.pump(); }
  // one numbered line, waiting for its ok (resends handled here: the same numbers are sent again)
  writeNumbered(cmd) {
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, resolve, reject });
      this.pump();
    });
  }
  pump() {
    if (this.waiting || !this.queue.length) return;
    const item = this.queue.shift();
    const n = ++this.n; this.sent.set(n, item.cmd); if (this.sent.size > 200) this.sent.delete(this.sent.keys().next().value);
    const go = (num, cmd) => { this.link.write(numbered(num, cmd)); };
    const w = { n, cmd: item.cmd, resolve: (r) => {
      if (r.resend !== undefined && r.resend <= n) {
        // Marlin missed line r (garbled): send r … n again with the same numbers, in order; the caller's promise rides on n
        const again = [];
        for (let k = r.resend; k < n; k++) if (this.sent.has(k)) again.push({ cmd: this.sent.get(k), resolve: () => {}, reject: () => {} });
        again.push(item);
        this.n = r.resend - 1;
        this.resends = (this.resends ?? 0) + again.length;
        this.queue.unshift(...again);
        return;
      }
      item.resolve();
    }, reject: item.reject };
    w.t = setTimeout(() => this.timeout(), this.lineTimeoutMs);
    this.waiting = w;
    go(n, item.cmd);
  }
  async hello() {
    // opening the port resets most boards: give it a moment, then start the numbering over
    await new Promise((r) => setTimeout(r, this.link.kind === "serial" ? 2500 : 50));
    this.n = 0;
    this.link.write("M110 N0");
    await new Promise((r) => setTimeout(r, 200));
    await this.command("M115").catch(() => {});
    await this.command("M105").catch(() => {});
    if (this.state === "offline" || this.state === "idle") this.state = "idle";
    return this;
  }
  command(cmd) { return this.writeNumbered(clean(cmd)); }
  async queryTemps() { await this.command("M105"); return this.temps; }
  failJob(text, kind) {
    if (this.job && !this.job.done) { this.job.done = true; this.job.result = "failed"; this.job.why = text; this.emit("jobEnd", this.job); }
    this.state = this.state === "offline" ? "offline" : "failed";
    this.emit("fault", { kind, text });
    this.emit("status");
  }
  // stream a G-code file; resolves when it's all sent (or it failed / was stopped)
  async print(path, { name } = {}) {
    if (this.state === "printing" || this.state === "paused") throw new Error("It's already printing.");
    const size = statSync(path).size;
    this.job = { name: name ?? path.split(/[\\/]/).pop(), path, size, sentBytes: 0, lines: 0, started: Date.now(), done: false, result: null };
    this.state = "printing"; this.fault = null; this.paused = false; this.stopped = false; this.reached = {}; this.low = {};
    this.emit("status");
    const rl = createInterface({ input: createReadStream(path, { encoding: "latin1" }), crlfDelay: Infinity });
    try {
      for await (const raw of rl) {
        this.job.sentBytes += Buffer.byteLength(raw, "latin1") + 1;
        if (this.stopped || this.job.done) break;
        while (this.paused && !this.stopped && !this.job.done) await new Promise((r) => setTimeout(r, 250));
        if (this.stopped || this.job.done) break;
        const cmd = clean(raw); if (!cmd) continue;
        await this.writeNumbered(cmd);
        this.job.lines++;
        if (Date.now() - this.lastTempAt > this.tempEveryMs) { this.lastTempAt = Date.now(); await this.writeNumbered("M105"); }
        this.checkRunaway();
        if (this.job.lines % 50 === 0) this.emit("status");
      }
    } catch (e) { if (!this.job.done) this.failJob(e.code === "timeout" ? "The printer stopped answering in the middle of the print." : e.message, "link"); }
    finally { rl.close(); }
    if (!this.job.done) {
      this.job.done = true; this.job.result = this.stopped ? "stopped" : "finished";
      this.state = this.stopped ? "idle" : "finished";
      this.emit("jobEnd", this.job); this.emit("status");
    }
    return this.job;
  }
  pause() { if (this.state !== "printing") throw new Error("It isn't printing."); this.paused = true; this.state = "paused"; this.emit("status"); }
  resume() { if (this.state !== "paused") throw new Error("It isn't paused."); this.paused = false; this.state = "printing"; this.emit("status"); }
  async stop() {
    this.stopped = true; this.paused = false;
    // heaters and fan off, motors released (queued after whatever is in flight)
    for (const c of ["M104 S0", "M140 S0", "M107", "M84"]) await this.command(c).catch(() => {});
    this.state = "idle"; this.emit("status");
  }
  // Host-side check on top of Marlin's own protection (old firmware may have it off): a heater far above its target, or one
  // that reached its target and then fell far below it for a minute, turns the heaters off and ends the print.
  checkRunaway(now = Date.now()) {
    if (this.job && this.lastTempAt < this.job.started) return false;   // only readings taken during this print
    for (const [k, v] of Object.entries(this.temps)) {
      if (!v || !(v.target > 0)) { if (this.reached) delete this.reached[k]; continue; }
      this.reached ??= {}; this.low ??= {};
      if (v.temp >= v.target - 3) { this.reached[k] = true; delete this.low[k]; }
      const over = v.temp > v.target + 20 && v.temp > 60;
      if (this.reached[k] && v.temp < v.target - 20) this.low[k] ??= now; else delete this.low[k];
      if (over || (this.low[k] && now - this.low[k] > 60_000)) {
        const text = over ? `${k === "bed" ? "The bed" : "The nozzle"} is ${Math.round(v.temp)} °C, far above its target of ${Math.round(v.target)} °C` : `${k === "bed" ? "The bed" : "The nozzle"} dropped to ${Math.round(v.temp)} °C and isn't recovering (target ${Math.round(v.target)} °C)`;
        this.stopped = true;
        for (const c of ["M104 S0", "M140 S0"]) this.command(c).catch(() => {});
        this.failJob(`Possible thermal runaway: ${text}. I turned the heaters off and stopped the print.`, "thermal");
        return true;
      }
    }
    return false;
  }
  close() { this.link.close(); }
}
