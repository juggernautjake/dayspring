// The Bambu Lab adapter (X1 / X1C / X1E, P1S / P1P, A1 / A1 mini, H2D / H2S, P2S), local-first (LAN mode):
//   status and control over the printer's own MQTT broker (TLS 8883, user bblp, the access code),
//   files over FTPS (990), the camera (./camera.mjs).
// Newer firmware only takes CONTROL commands from other software with LAN Only mode AND Developer mode on (the
// "Authorization Control" Bambu added in 2025; X1 01.08.03+, P1 01.08.02+, A1 01.05+). Without it, status reports still
// arrive but pause/start/etc. are ignored or rejected: that's detected and explained (docs/bambu-printers.md).
// The cloud (Bambu account) is not used; Dayspring never asks for the Bambu password.
import { EventEmitter } from "node:events";
import * as proto from "./protocol.mjs";
import * as ftps from "./ftps.mjs";
import * as camera from "./camera.mjs";
import { MODELS, modelOf } from "./models.mjs";

export const meta = { id: "bambu", label: "Bambu Lab (LAN mode)", transports: ["lan"], offline: true, needs: ["host", "serial", "accessCode", "model"],
  models: Object.entries(MODELS).map(([k, m]) => ({ id: k, label: m.label, camera: m.camera })) };

let mqttMod = null;
const mqtt = async () => (mqttMod ??= await import("mqtt"));

export class BambuPrinter extends EventEmitter {
  constructor(printer, { accessCode, mqttPort, ftpPort } = {}) {
    super();
    this.p = printer; this.code = accessCode ?? "";
    this.model = modelOf(printer.model) ?? MODELS.X1C; this.modelKey = Object.keys(MODELS).find((k) => MODELS[k] === this.model) ?? "X1C";
    this.mqttPort = mqttPort ?? printer.mqttPort ?? 8883; this.ftpPort = ftpPort ?? printer.ftpPort ?? 990;
    this.raw = {}; this.client = null; this.online = false; this.lastReport = 0; this.lastError = null; this.pending = new Map();
    this.capabilities = { camera: this.model.camera !== "none", ams: this.model.ams, light: true, speed: true, upload: true, dualNozzle: Boolean(this.model.dualNozzle), fans: true, chamber: Boolean(this.model.chamber), gcode: true };
  }
  get topicReport() { return `device/${this.p.serial}/report`; }
  get topicRequest() { return `device/${this.p.serial}/request`; }
  async connect({ timeoutMs = 10_000 } = {}) {
    if (this.client) return this;
    if (!this.p.host || !this.p.serial || !this.code) throw new Error("This printer needs its IP address, serial number and access code (Settings → Printers).");
    const { connect } = await mqtt();
    return new Promise((resolve, reject) => {
      let settled = false;
      const c = connect(`mqtts://${this.p.host}:${this.mqttPort}`, { username: "bblp", password: this.code, rejectUnauthorized: false, reconnectPeriod: 10_000, connectTimeout: timeoutMs, clientId: `dayspring-${Math.random().toString(16).slice(2, 10)}`, protocolVersion: 4 });
      this.client = c;
      const t = setTimeout(() => { if (!settled) { settled = true; reject(new Error(`No answer from the printer at ${this.p.host}. Is it on, on the same network, with LAN mode on?`)); } }, timeoutMs + 1000);
      c.on("connect", () => {
        c.subscribe(this.topicReport, { qos: 0 }, () => { this.send(proto.pushall()).catch(() => {}); this.send(proto.getVersion()).catch(() => {}); });
        this.online = true; this.lastError = null; this.emit("online");
        // P1/A1 only report changes: an idle printer can be quiet for a long time. Ask for the full status now and then
        // (at most every 5 minutes; Bambu asks apps not to flood the P1 with "pushall").
        clearInterval(this.keep); this.keep = setInterval(() => { if (this.client?.connected && Date.now() - this.lastReport > 5 * 60_000) this.refresh().catch(() => {}); }, 60_000); this.keep.unref?.();
        if (!settled) { settled = true; clearTimeout(t); resolve(this); }
      });
      c.on("message", (topic, payload) => this.onMessage(topic, payload));
      c.on("error", (e) => {
        this.lastError = /not authori[sz]ed|bad user ?name|bad username or password/i.test(e.message) ? "The printer didn't accept the access code. Check it on the printer's screen (Settings → LAN only / WLAN)." : e.message;
        if (!settled) { settled = true; clearTimeout(t); try { c.end(true); } catch { /* closed */ } this.client = null; reject(new Error(this.lastError)); }
      });
      c.on("close", () => { if (this.online) { this.online = false; this.emit("offline"); } });
    });
  }
  close() { clearInterval(this.keep); try { this.client?.end(true); } catch { /* closed */ } this.client = null; this.online = false; }
  onMessage(topic, payload) {
    let j; try { j = JSON.parse(payload.toString("utf8")); } catch { return; }
    this.raw = proto.merge(this.raw, j); this.lastReport = Date.now();
    // an answer to one of our commands: "result": "fail" with a reason means the printer refused it
    const cmd = j.print?.command ?? j.system?.command, s = j.print?.sequence_id ?? j.system?.sequence_id;
    if (s && this.pending.has(String(s))) {
      const w = this.pending.get(String(s)); this.pending.delete(String(s));
      const res = String(j.print?.result ?? j.system?.result ?? "").toLowerCase(), reason = j.print?.reason ?? j.system?.reason ?? j.print?.err_code;
      w(res === "fail" || res === "failed" ? { ok: false, reason } : { ok: true, cmd });
    }
    this.emit("status", this.status());
  }
  status() { return { online: this.online && Boolean(this.lastReport) && Date.now() - this.lastReport < 12 * 60_000, ...proto.normalize(this.raw, this.modelKey), updatedAt: this.lastReport ? new Date(this.lastReport).toISOString() : null, error: this.lastError }; }
  // send a command; waits briefly for the printer's answer (a refusal is explained)
  async send(msg, { wait = 0 } = {}) {
    if (!this.client) await this.connect();
    const s = String(msg.print?.sequence_id ?? msg.system?.sequence_id ?? msg.pushing?.sequence_id ?? msg.info?.sequence_id ?? "");
    const answer = wait && s ? new Promise((r) => { this.pending.set(s, r); setTimeout(() => { if (this.pending.delete(s)) r({ ok: true, noAnswer: true }); }, wait); }) : null;
    const important = Boolean(msg.print && ["pause", "resume", "stop"].includes(msg.print.command));
    await new Promise((res, rej) => this.client.publish(this.topicRequest, JSON.stringify(msg), { qos: important ? 1 : 0 }, (e) => (e ? rej(e) : res())));
    if (!answer) return { ok: true };
    const r = await answer;
    if (!r.ok) throw Object.assign(new Error(`The printer refused that${r.reason ? ` (${r.reason})` : ""}. If Developer mode is off, newer firmware only takes commands from Bambu's own apps: turn on LAN Only mode and Developer mode on the printer.`), { code: "refused" });
    return r;
  }
  pause() { return this.send(proto.pause(), { wait: 3000 }); }
  resume() { return this.send(proto.resume(), { wait: 3000 }); }
  stop() { return this.send(proto.stop(), { wait: 3000 }); }
  setSpeed(level) { return this.send(proto.speed(level), { wait: 2000 }); }
  setLight(on) { return this.send(proto.light(on)); }
  setTemp(t) { return this.send(proto.temps(t, this.modelKey)); }
  setFan(f) { return this.send(proto.fans(f)); }
  gcodeLine(line) { return this.send(proto.gcode(line)); }
  refresh() { return this.send(proto.pushall()); }
  ftpConn() { return { host: this.p.host, port: this.ftpPort, accessCode: this.code }; }
  upload(localPath, opts = {}) { return ftps.upload(this.ftpConn(), localPath, opts); }
  files() { return ftps.list(this.ftpConn()); }
  async startPrint({ file, plate = 1, amsMapping, options = {} }) {
    const isGcode = /\.gcode$/i.test(file) && !/\.3mf$/i.test(file);
    const msg = isGcode ? proto.gcodeFile(file) : proto.projectFile({ file, plate, amsMapping, family: this.model.family, useAms: options.useAms, bedLevelling: options.bedLevelling ?? true, flowCali: options.flowCali ?? true, vibrationCali: options.vibrationCali ?? true, timelapse: options.timelapse ?? false, bedType: options.bedType ?? "auto" });
    await this.send(msg, { wait: 5000 });
    return { started: true, file };
  }
  cameraSource() { return camera.sourceFor(this.p, this.code, this.model); }
  async test() {
    await this.connect();
    await this.refresh().catch(() => {});
    const t0 = Date.now(); while (!this.lastReport && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 200));
    if (!this.lastReport) return { ok: false, text: "Connected, but the printer didn't send its status. Check the serial number." };
    const st = this.status();
    return { ok: true, text: `Connected to ${this.p.name} (${this.model.label}): ${st.state}${st.nozzle?.[0]?.temp != null ? `, nozzle ${Math.round(st.nozzle[0].temp)} °C` : ""}.`, status: st };
  }
}
export const create = (printer, secret, extra) => new BambuPrinter(printer, { accessCode: secret?.accessCode, ...extra });
