// Bambu Lab's local MQTT protocol (LAN mode): what the printer reports and the commands it takes.
//   broker: the printer itself, mqtts://<ip>:8883, user "bblp", password = the access code on the printer's screen
//   topics: device/<serial>/report (it tells us) · device/<serial>/request (we tell it)
// X1 and H2 send full reports; P1 and A1 send only what changed, so reports are MERGED into the last known state.
// Sources: the community-documented protocol (OpenBambuAPI, ha-bambulab, bambulabs_api), checked September 2026.
import { MODELS, STATES, SPEEDS } from "./models.mjs";

let seq = 0;
const sid = () => String(++seq % 1e9);

// ---- commands ------------------------------------------------------------------------------------------------------
export const pushall = () => ({ pushing: { sequence_id: sid(), command: "pushall", version: 1, push_target: 1 } });
export const getVersion = () => ({ info: { sequence_id: sid(), command: "get_version" } });
export const pause = () => ({ print: { sequence_id: sid(), command: "pause", param: "" } });
export const resume = () => ({ print: { sequence_id: sid(), command: "resume", param: "" } });
export const stop = () => ({ print: { sequence_id: sid(), command: "stop", param: "" } });
export function speed(level) {
  const l = Math.round(Number(level));
  if (!SPEEDS[l]) throw new Error("Speed is 1 (silent), 2 (standard), 3 (sport) or 4 (ludicrous).");
  return { print: { sequence_id: sid(), command: "print_speed", param: String(l) } };
}
export const light = (on, node = "chamber_light") => ({ system: { sequence_id: sid(), command: "ledctrl", led_node: node, led_mode: on ? "on" : "off", led_on_time: 500, led_off_time: 500, loop_times: 1, interval_time: 1000 } });
export const gcode = (line) => ({ print: { sequence_id: sid(), command: "gcode_line", param: String(line).endsWith("\n") ? String(line) : String(line) + "\n" } });
// temperatures within the model's safe limits (0 = off); anything above the limit is refused, never clamped silently
export function temps({ nozzle, bed, chamber, extruder } = {}, modelKey = "X1C") {
  const m = MODELS[modelKey] ?? MODELS.X1C, lines = [];
  const chk = (v, max, what) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0) throw new Error(`That ${what} temperature isn't a number.`); if (n > max) throw new Error(`${n} °C is above the ${m.label}'s ${what} limit (${max} °C), so I won't set it.`); return n; };
  if (nozzle !== undefined) lines.push(`M104 ${extruder != null ? `T${Number(extruder) ? 1 : 0} ` : ""}S${chk(nozzle, m.nozzleMax, "nozzle")}`);
  if (bed !== undefined) lines.push(`M140 S${chk(bed, m.bedMax, "bed")}`);
  if (chamber !== undefined) { if (!m.chamber) throw new Error(`The ${m.label} has no chamber heater.`); lines.push(`M141 S${chk(chamber, m.chamberMax ?? 60, "chamber")}`); }
  if (!lines.length) throw new Error("Which temperature?");
  return gcode(lines.join("\n"));
}
// fans in percent: part (the part-cooling fan), aux (the side fan), chamber (the exhaust fan)
export function fans({ part, aux, chamber } = {}) {
  const pw = (v) => Math.round((Math.max(0, Math.min(100, Number(v))) / 100) * 255);
  const lines = [];
  if (part !== undefined) lines.push(`M106 P1 S${pw(part)}`);
  if (aux !== undefined) lines.push(`M106 P2 S${pw(aux)}`);
  if (chamber !== undefined) lines.push(`M106 P3 S${pw(chamber)}`);
  if (!lines.length) throw new Error("Which fan?");
  return gcode(lines.join("\n"));
}
// Start a print already on the printer's storage (uploaded over FTPS). amsMapping: for each filament in the file, the
// AMS tray (0–15; -1 = the external spool). The H2D also wants ams_mapping2 ({ ams_id, slot_id }).
export function projectFile({ file, plate = 1, amsMapping = null, useAms, bedLevelling = true, flowCali = true, vibrationCali = true, timelapse = false, layerInspect = false, bedType = "auto", family = "X1", name = "" } = {}) {
  const f = String(file ?? "").replace(/^\/+/, "");
  if (!f) throw new Error("Which file?");
  const plateNo = Math.max(1, Math.round(Number(plate) || 1));
  const mapping = Array.isArray(amsMapping) && amsMapping.length ? amsMapping.map((x) => Math.round(Number(x))) : [0];
  const ams = useAms ?? (Array.isArray(amsMapping) ? amsMapping.some((x) => Number(x) >= 0) : true);
  // P1 and A1 find the file by a file:// path on their card; X1 and H2 by the ftp:// form
  const url = family === "P1" || family === "A1" ? `file:///sdcard/${f}` : `ftp://${f}`;
  const out = { print: { sequence_id: sid(), command: "project_file", param: `Metadata/plate_${plateNo}.gcode`, project_id: "0", profile_id: "0", task_id: "0", subtask_id: "0",
    subtask_name: name || f.replace(/\.(gcode\.)?3mf$/i, ""), file: f, url, md5: "", timelapse: Boolean(timelapse), bed_type: bedType, bed_levelling: Boolean(bedLevelling), flow_cali: Boolean(flowCali),
    vibration_cali: Boolean(vibrationCali), layer_inspect: Boolean(layerInspect), ams_mapping: ams ? mapping : [], use_ams: Boolean(ams) } };
  if (family === "H2") out.print.ams_mapping2 = mapping.map((t) => (t < 0 ? { ams_id: 255, slot_id: 0 } : { ams_id: Math.floor(t / 4), slot_id: t % 4 }));
  return out;
}
// a plain .gcode file (no plates): printed with gcode_file
export const gcodeFile = (file) => ({ print: { sequence_id: sid(), command: "gcode_file", param: `/sdcard/${String(file).replace(/^\/+/, "")}` } });

// ---- reports ----------------------------------------------------------------------------------------------------------
// merge a report into the running state (P1/A1 send only changes; arrays like ams and hms are replaced whole)
export function merge(state = {}, msg = {}) {
  const out = { ...state };
  for (const k of ["print", "info", "system"]) if (msg[k] && typeof msg[k] === "object") out[k] = deep(out[k] ?? {}, msg[k]);
  return out;
}
function deep(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) ? deep(a[k], v) : v;
  return o;
}
const num = (v) => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const fanPct = (v) => { const n = num(v); return n === null ? null : Math.round((Math.min(15, n) / 15) * 100); };
export const hmsCode = (h) => { const a = (Number(h.attr) >>> 0).toString(16).padStart(8, "0").toUpperCase(), c = (Number(h.code) >>> 0).toString(16).padStart(8, "0").toUpperCase(); return `${a.slice(0, 4)}_${a.slice(4)}_${c.slice(0, 4)}_${c.slice(4)}`; };
export const errorCode = (n) => { const h = (Number(n) >>> 0).toString(16).padStart(8, "0").toUpperCase(); return `${h.slice(0, 4)}_${h.slice(4)}`; };
const unpack = (t) => ({ temp: num(t) === null ? null : (Number(t) & 0xffff), target: num(t) === null ? null : (Number(t) >>> 16) & 0xffff });
// the report, in the shape every printer adapter uses (lib/printers/index.mjs)
export function normalize(state = {}, modelKey = "X1C") {
  const p = state.print ?? {};
  const raw = String(p.gcode_state ?? "UNKNOWN").toUpperCase();
  const st = STATES[raw] ?? "unknown";
  let nozzle = [{ temp: num(p.nozzle_temper), target: num(p.nozzle_target_temper) }];
  const ext = p.device?.extruder?.info;
  if (Array.isArray(ext) && ext.length) nozzle = ext.filter((e) => e.id === 0 || e.id === 1).sort((a, b) => a.id - b.id).map((e) => unpack(e.temp));
  const chamberPacked = p.device?.ctc?.info?.temp;
  const errors = [];
  if (num(p.print_error)) errors.push({ code: errorCode(p.print_error), text: `Printer error ${errorCode(p.print_error)}`, link: `https://wiki.bambulab.com/en/hms/error-code?code=${errorCode(p.print_error)}` });
  for (const h of Array.isArray(p.hms) ? p.hms : []) errors.push({ code: hmsCode(h), text: `HMS ${hmsCode(h)}`, link: `https://wiki.bambulab.com/en/hms/home`, severity: (Number(h.code) >>> 16) & 0xf });
  const amsUnits = Array.isArray(p.ams?.ams) ? p.ams.ams : [];
  const ams = amsUnits.map((u) => ({ id: Number(u.id), humidity: num(u.humidity), temp: num(u.temp), trays: (u.tray ?? []).map((t) => ({ slot: Number(t.id), index: Number(u.id) * 4 + Number(t.id), type: t.tray_type || null, color: t.tray_color ? `#${String(t.tray_color).slice(0, 6)}` : null, remain: num(t.remain), name: t.tray_sub_brands || t.tray_type || null })) }));
  const lights = Object.fromEntries((p.lights_report ?? []).map((l) => [l.node, l.mode === "on"]));
  const bed = { temp: num(p.bed_temper), target: num(p.bed_target_temper) };
  const hot = nozzle.some((n) => (n.temp ?? 0) >= 50) || (bed.temp ?? 0) >= 45;
  return {
    state: st, rawState: raw, stage: num(p.stg_cur), progress: num(p.mc_percent), layer: num(p.layer_num), totalLayers: num(p.total_layer_num), remainingMin: num(p.mc_remaining_time),
    nozzle, bed, chamber: chamberPacked != null ? unpack(chamberPacked) : { temp: num(p.chamber_temper), target: null },
    fans: { part: fanPct(p.cooling_fan_speed), aux: fanPct(p.big_fan1_speed), chamber: fanPct(p.big_fan2_speed) },
    speedLevel: num(p.spd_lvl), speedName: SPEEDS[num(p.spd_lvl)] ?? null, light: lights.chamber_light ?? null,
    ams, trayNow: num(p.ams?.tray_now), externalSpool: p.vt_tray ? { type: p.vt_tray.tray_type || null, color: p.vt_tray.tray_color ? `#${String(p.vt_tray.tray_color).slice(0, 6)}` : null } : null,
    errors, job: p.subtask_name || p.gcode_file ? { name: p.subtask_name || null, file: p.gcode_file || null } : null,
    hot, wifi: p.wifi_signal ?? null, nozzleType: p.nozzle_type ?? null, nozzleDiameter: num(p.nozzle_diameter),
  };
}
