// Printers run by a print server on a Raspberry Pi (the reliable way for an Ender or any Marlin/Klipper printer):
//   OctoPrint  REST API with an API key (OctoPrint → Settings → Application Keys)   https://docs.octoprint.org/en/master/api/
//   Moonraker  Klipper's API server (Mainsail / Fluidd), key optional               https://moonraker.readthedocs.io/
// Both: status by polling every few seconds, pause/resume/cancel, temperatures, fan, upload-and-print, and the webcam's
// snapshot URL as the printer's camera.
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const OCTO = { id: "octoprint", label: "OctoPrint", transports: ["lan"], offline: true, needs: ["host", "apiKey"] };
export const MOON = { id: "moonraker", label: "Klipper (Moonraker / Mainsail / Fluidd)", transports: ["lan"], offline: true, needs: ["host"], optional: ["apiKey"] };

class HostPrinter extends EventEmitter {
  constructor(printer, secret) {
    super(); this.p = printer; this.key = secret?.apiKey ?? ""; this.raw = null; this.online = false; this.lastError = null; this.timer = null;
    this.base = /^https?:\/\//.test(printer.host) ? printer.host.replace(/\/+$/, "") : `http://${printer.host}${printer.port ? ":" + printer.port : ""}`;
    this.limits = { nozzleMax: printer.nozzleMax ?? 280, bedMax: printer.bedMax ?? 110 };
    this.capabilities = { camera: true, ams: false, light: false, speed: true, upload: true, dualNozzle: false, fans: true, chamber: false, gcode: true };
  }
  headers(extra = {}) { return { ...(this.key ? { "X-Api-Key": this.key } : {}), ...extra }; }
  async req(path, { method = "GET", body, json = true, raw = false } = {}) {
    const res = await fetch(this.base + path, { method, headers: this.headers(body && json ? { "content-type": "application/json" } : {}), body: body ? (json ? JSON.stringify(body) : body) : undefined, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`${this.label} didn't accept the API key.`), { code: "auth" });
    if (!res.ok) throw new Error(`${this.label} answered ${res.status}${await res.text().then((t) => `: ${t.slice(0, 120)}`).catch(() => "")}`);
    if (raw) return Buffer.from(await res.arrayBuffer());
    const t = await res.text(); try { return JSON.parse(t); } catch { return t; }
  }
  async connect() {
    if (this.timer) return this;
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch(() => {}), this.p.pollMs ?? 4000); this.timer.unref?.();
    return this;
  }
  close() { clearInterval(this.timer); this.timer = null; this.online = false; }
  async refresh() {
    try { this.raw = await this.read(); this.online = true; this.lastError = null; }
    catch (e) { this.online = false; this.lastError = e.message; }
    this.emit("status", this.status());
  }
  chk(v, max, what) { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0) throw new Error(`That ${what} temperature isn't a number.`); if (n > max) throw new Error(`${n} °C is above this printer's ${what} limit (${max} °C), so I won't set it.`); return n; }
  async setLight() { throw new Error("This printer has no light Dayspring can switch."); }
  async setSpeed(level) { const pct = { 1: 50, 2: 100, 3: 125, 4: 150 }[Number(level)] ?? Number(level); return this.gcodeLine(`M220 S${Math.max(10, Math.min(300, Math.round(pct)))}`); }
  async setFan({ part } = {}) { if (part !== undefined) return this.gcodeLine(Number(part) > 0 ? `M106 S${Math.round((Math.min(100, Number(part)) / 100) * 255)}` : "M107"); }
  async test() { await this.refresh(); if (!this.online) return { ok: false, text: this.lastError }; const s = this.status(); return { ok: true, text: `Connected to ${this.label}: ${s.state}, nozzle ${s.nozzle[0]?.temp ?? "?"} °C, bed ${s.bed?.temp ?? "?"} °C.` }; }
  cameraSource() {
    return { id: `printer-${this.p.id}`, name: `${this.p.name} camera`, kind: "printer", role: "printer",
      snapshot: async () => { const u = await this.snapshotUrl(); if (!u) throw new Error(`${this.label} has no webcam set up.`); const res = await fetch(u, { headers: this.headers(), signal: AbortSignal.timeout(10_000) }); if (!res.ok) throw new Error(`The webcam answered ${res.status}.`); return Buffer.from(await res.arrayBuffer()); } };
  }
}

export class OctoPrinter extends HostPrinter {
  get label() { return "OctoPrint"; }
  async read() { const [pr, job] = await Promise.all([this.req("/api/printer").catch((e) => (/409/.test(e.message) ? { state: { text: "Offline", flags: {} } } : Promise.reject(e))), this.req("/api/job")]); return { pr, job }; }
  status() {
    const pr = this.raw?.pr ?? {}, job = this.raw?.job ?? {}, f = pr.state?.flags ?? {}, t = pr.temperature ?? {};
    const state = !this.online ? "offline" : f.error || f.closedOrError ? "failed" : f.paused || f.pausing ? "paused" : f.printing ? "printing" : f.cancelling ? "idle" : f.ready || f.operational ? (job.progress?.completion >= 100 ? "finished" : "idle") : "offline";
    const nozzle = [{ temp: t.tool0?.actual ?? null, target: t.tool0?.target ?? null }], bed = { temp: t.bed?.actual ?? null, target: t.bed?.target ?? null };
    return { online: this.online, state, rawState: pr.state?.text ?? null, progress: job.progress?.completion != null ? Math.round(job.progress.completion * 10) / 10 : null, layer: null, totalLayers: null,
      remainingMin: job.progress?.printTimeLeft != null ? Math.round(job.progress.printTimeLeft / 60) : null, nozzle, bed, chamber: t.chamber ? { temp: t.chamber.actual, target: t.chamber.target } : null,
      fans: {}, speedLevel: null, light: null, ams: [], errors: pr.state?.error ? [{ code: "octoprint", text: pr.state.error }] : this.lastError ? [{ code: "link", text: this.lastError }] : [],
      job: job.job?.file?.name ? { name: job.job.file.display ?? job.job.file.name, file: job.job.file.name } : null, hot: (nozzle[0].temp ?? 0) >= 50 || (bed.temp ?? 0) >= 45, error: this.lastError, updatedAt: new Date().toISOString() };
  }
  pause() { return this.req("/api/job", { method: "POST", body: { command: "pause", action: "pause" } }); }
  resume() { return this.req("/api/job", { method: "POST", body: { command: "pause", action: "resume" } }); }
  stop() { return this.req("/api/job", { method: "POST", body: { command: "cancel" } }); }
  async setTemp({ nozzle, bed } = {}) {
    if (nozzle !== undefined) await this.req("/api/printer/tool", { method: "POST", body: { command: "target", targets: { tool0: this.chk(nozzle, this.limits.nozzleMax, "nozzle") } } });
    if (bed !== undefined) await this.req("/api/printer/bed", { method: "POST", body: { command: "target", target: this.chk(bed, this.limits.bedMax, "bed") } });
  }
  gcodeLine(line) { return this.req("/api/printer/command", { method: "POST", body: { commands: String(line).split("\n").filter(Boolean) } }); }
  async upload(localPath, { name } = {}) {
    const fd = new FormData(); const fname = name ?? basename(localPath);
    fd.append("file", new Blob([readFileSync(localPath)]), fname);
    const r = await this.req("/api/files/local", { method: "POST", body: fd, json: false });
    return r?.files?.local?.name ?? fname;
  }
  startPrint({ file }) { return this.req(`/api/files/local/${encodeURIComponent(file)}`, { method: "POST", body: { command: "select", print: true } }).then(() => ({ started: true, file })); }
  async snapshotUrl() { if (this.p.cameraUrl) return this.p.cameraUrl; const s = await this.req("/api/settings").catch(() => null); const u = s?.webcam?.snapshotUrl; return u ? (/^https?:/.test(u) ? u : this.base + (u.startsWith("/") ? u : "/" + u)) : null; }
}

export class MoonPrinter extends HostPrinter {
  get label() { return "Klipper (Moonraker)"; }
  async read() { const r = await this.req("/printer/objects/query?print_stats&heater_bed&extruder&virtual_sdcard&display_status&fan&webhooks"); return r.result?.status ?? {}; }
  status() {
    const s = this.raw ?? {}, ps = s.print_stats ?? {}, ex = s.extruder ?? {}, hb = s.heater_bed ?? {};
    const map = { standby: "idle", printing: "printing", paused: "paused", complete: "finished", cancelled: "idle", error: "failed" };
    const state = !this.online ? "offline" : s.webhooks?.state && s.webhooks.state !== "ready" ? "offline" : map[ps.state] ?? "unknown";
    const prog = s.virtual_sdcard?.progress ?? s.display_status?.progress;
    const el = ps.print_duration ?? 0;
    const nozzle = [{ temp: ex.temperature ?? null, target: ex.target ?? null }], bed = { temp: hb.temperature ?? null, target: hb.target ?? null };
    return { online: this.online, state, rawState: ps.state ?? null, progress: prog != null ? Math.round(prog * 1000) / 10 : null, layer: ps.info?.current_layer ?? null, totalLayers: ps.info?.total_layer ?? null,
      remainingMin: prog > 0.01 && el ? Math.round(((el / prog) - el) / 60) : null, nozzle, bed, chamber: null, fans: { part: s.fan?.speed != null ? Math.round(s.fan.speed * 100) : null }, speedLevel: null, light: null, ams: [],
      errors: ps.state === "error" && ps.message ? [{ code: "klipper", text: ps.message }] : this.lastError ? [{ code: "link", text: this.lastError }] : [],
      job: ps.filename ? { name: ps.filename, file: ps.filename } : null, hot: (nozzle[0].temp ?? 0) >= 50 || (bed.temp ?? 0) >= 45, error: this.lastError, updatedAt: new Date().toISOString() };
  }
  pause() { return this.req("/printer/print/pause", { method: "POST" }); }
  resume() { return this.req("/printer/print/resume", { method: "POST" }); }
  stop() { return this.req("/printer/print/cancel", { method: "POST" }); }
  async setTemp({ nozzle, bed } = {}) {
    const lines = [];
    if (nozzle !== undefined) lines.push(`SET_HEATER_TEMPERATURE HEATER=extruder TARGET=${this.chk(nozzle, this.limits.nozzleMax, "nozzle")}`);
    if (bed !== undefined) lines.push(`SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=${this.chk(bed, this.limits.bedMax, "bed")}`);
    for (const l of lines) await this.gcodeLine(l);
  }
  gcodeLine(line) { return this.req(`/printer/gcode/script?script=${encodeURIComponent(line)}`, { method: "POST" }); }
  async upload(localPath, { name } = {}) {
    const fd = new FormData(); const fname = name ?? basename(localPath);
    fd.append("file", new Blob([readFileSync(localPath)]), fname);
    const r = await this.req("/server/files/upload", { method: "POST", body: fd, json: false });
    return r?.item?.path ?? fname;
  }
  startPrint({ file }) { return this.req(`/printer/print/start?filename=${encodeURIComponent(file)}`, { method: "POST" }).then(() => ({ started: true, file })); }
  async snapshotUrl() { if (this.p.cameraUrl) return this.p.cameraUrl; const r = await this.req("/server/webcams/list").catch(() => null); const u = r?.result?.webcams?.[0]?.snapshot_url; return u ? (/^https?:/.test(u) ? u : this.base + (u.startsWith("/") ? u : "/" + u)) : null; }
}
export const createOcto = (printer, secret) => new OctoPrinter(printer, secret);
export const createMoon = (printer, secret) => new MoonPrinter(printer, secret);
