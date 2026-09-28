// Marlin printers over USB (Creality Ender 5 Plus, Ender 3, CR-10 and most older printers), driven straight from this PC.
// Honest note, said in Settings too: this works, but OctoPrint or Klipper on a Raspberry Pi is more reliable. Here the PC
// feeds the printer line by line, so if Windows sleeps, restarts for an update, or the USB cable is bumped, the print
// stops. While printing, Dayspring holds the PC awake (lib/keepawake's helper) and watches for the link dropping.
//   printer: { brand: "marlin", serialPath: "COM3" | "tcp://host:port", baud: 115200, model: "Ender 5 Plus" }
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { Sender, openLink, listPorts } from "./sender.mjs";

export const meta = { id: "marlin", label: "Marlin over USB (Creality Ender and others)", transports: ["usb"], offline: true, needs: ["serialPath"], models: [{ id: "ENDER5PLUS", label: "Creality Ender 5 Plus" }, { id: "ENDER3", label: "Creality Ender 3 / V2 / S1" }, { id: "OTHER", label: "Other Marlin printer" }] };
export const LIMITS = { ENDER5PLUS: { nozzleMax: 260, bedMax: 110 }, ENDER3: { nozzleMax: 260, bedMax: 100 }, OTHER: { nozzleMax: 260, bedMax: 100 } };
export { listPorts };

export class MarlinPrinter extends EventEmitter {
  constructor(printer, { keepAwake } = {}) {
    super();
    this.p = printer; this.sender = null; this.online = false; this.lastError = null; this.keepAwake = keepAwake ?? (() => {});
    this.limits = LIMITS[String(printer.model ?? "").toUpperCase().replace(/[\s-]/g, "")] ?? LIMITS.OTHER;
    this.capabilities = { camera: false, ams: false, light: false, speed: true, upload: false, dualNozzle: false, fans: true, chamber: false, gcode: true, usbStream: true };
    this.poll = null;
  }
  async connect() {
    if (this.sender && this.online) return this;
    if (!this.p.serialPath) throw new Error("Pick the printer's USB port (COM…) in Settings → Printers.");
    const link = await openLink(this.p.serialPath, { baud: this.p.baud });
    this.sender = new Sender(link, { lineTimeoutMs: this.p.lineTimeoutMs ?? 120_000 });
    for (const ev of ["status", "temps"]) this.sender.on(ev, () => this.emit("status", this.status()));
    this.sender.on("fault", (f) => { this.lastError = f.text; this.keepAwake(false); this.emit("fault", f); this.emit("status", this.status()); });
    this.sender.on("jobEnd", (j) => { this.keepAwake(false); this.emit("jobEnd", j); });
    link.on("close", () => { this.online = false; clearInterval(this.poll); this.emit("status", this.status()); });
    await this.sender.hello();
    this.online = true; this.lastError = null;
    // temperatures every few seconds while idle (while printing, the sender slips them in)
    this.poll = setInterval(() => { if (this.online && this.sender.state !== "printing" && !this.sender.waiting && !this.sender.queue.length) this.sender.command("M105").catch(() => {}); }, 5000);
    this.poll.unref?.();
    return this;
  }
  close() { clearInterval(this.poll); try { this.sender?.close(); } catch { /* closed */ } this.online = false; }
  status() {
    const s = this.sender, t = s?.temps ?? {}, j = s?.job;
    const nozzle = [t.nozzle ?? { temp: null, target: null }], bed = t.bed ?? { temp: null, target: null };
    const state = !this.online ? "offline" : s.state;
    return { online: this.online, state, rawState: state, progress: j && j.size ? Math.round((j.sentBytes / j.size) * 1000) / 10 : null, layer: null, totalLayers: null,
      remainingMin: j && !j.done && j.sentBytes > 0 ? Math.round(((Date.now() - j.started) / j.sentBytes) * (j.size - j.sentBytes) / 60000) : null,
      nozzle, bed, chamber: null, fans: {}, speedLevel: null, light: null, ams: [], errors: this.lastError ? [{ code: "marlin", text: this.lastError }] : [],
      job: j ? { name: j.name, file: j.name } : null, hot: (nozzle[0].temp ?? 0) >= 50 || (bed.temp ?? 0) >= 45, firmware: s?.firmware ?? null, error: this.lastError, updatedAt: new Date().toISOString(), resends: s?.resends ?? 0 };
  }
  async pause() { this.sender.pause(); }
  async resume() { this.sender.resume(); }
  async stop() { await this.sender.stop(); this.keepAwake(false); }
  async setTemp({ nozzle, bed } = {}) {
    const chk = (v, max, what) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0) throw new Error(`That ${what} temperature isn't a number.`); if (n > max) throw new Error(`${n} °C is above this printer's ${what} limit (${max} °C), so I won't set it.`); return n; };
    if (nozzle !== undefined) await this.sender.command(`M104 S${chk(nozzle, this.limits.nozzleMax, "nozzle")}`);
    if (bed !== undefined) await this.sender.command(`M140 S${chk(bed, this.limits.bedMax, "bed")}`);
  }
  async setFan({ part } = {}) { if (part !== undefined) await this.sender.command(Number(part) > 0 ? `M106 S${Math.round((Math.min(100, Number(part)) / 100) * 255)}` : "M107"); }
  async setSpeed(level) { const pct = { 1: 50, 2: 100, 3: 125, 4: 150 }[Number(level)] ?? Number(level); await this.sender.command(`M220 S${Math.max(10, Math.min(300, Math.round(pct)))}`); }
  async setLight() { throw new Error("This printer has no light Dayspring can switch."); }
  gcodeLine(line) { return this.sender.command(line); }
  refresh() { return this.sender.command("M105"); }
  // USB printing streams a local .gcode file (no upload step)
  async upload(localPath) { if (!existsSync(localPath)) throw new Error("That file isn't there."); return localPath; }
  async startPrint({ file }) {
    if (!/\.(gcode|gco|g)$/i.test(file)) throw new Error("USB printing needs a sliced .gcode file (slice it in Cura, Creality Print or OrcaSlicer first).");
    if (!existsSync(file)) throw new Error("That file isn't there.");
    this.keepAwake(true);
    this.lastError = null;
    const done = this.sender.print(file, { name: basename(file) });
    done.then(() => this.keepAwake(false), () => this.keepAwake(false));
    return { started: true, file: basename(file) };
  }
  cameraSource() { return null; }
  async test() { await this.connect(); const t = await this.sender.queryTemps(); return { ok: true, text: `Connected on ${this.p.serialPath}${this.sender.firmware ? ` (${this.sender.firmware})` : ""}: nozzle ${t.nozzle?.temp ?? "?"} °C, bed ${t.bed?.temp ?? "?"} °C.` }; }
}
export const create = (printer, secret, extra) => new MarlinPrinter(printer, extra);
