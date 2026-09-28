// The printers by voice (no AI needed) and for the AI:
//   "how's printer 3 doing?", "what's left on the P1S?", "show me the camera on the X1", "is the bed clear on printer 2?",
//   "start the benchy on printer 1", "pause printer 3", "resume it", "stop printer 3" (asks), "set printer 1 to sport
//   speed", "turn the light on on the X1", "print the next one on printer 2", "what's queued on printer 2", and the
//   yes / no to its own questions. AI tools: printer_status, printer_camera, printer_bed_check, printer_start,
//   printer_control, printer_queue (the same rules: a start needs a clear bed and the owner's yes).
import { existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import * as printers from "./index.mjs";
import * as store from "./store.mjs";
import * as queue from "./queue.mjs";
import * as monitor from "./monitor.mjs";
import * as gate from "../devices/gate.mjs";
import { norm, nameKey } from "../devices/model.mjs";
import * as confirm from "../confirm.mjs";

const PR = "(?:(?:3d )?printer(?: \\d+)?|the \\w+|x1c?|x1e|p1s|p1p|a1(?: mini)?|h2d|h2s|ender(?: \\d+)?(?: plus)?|[a-z0-9 ]+?)";
import { sayStatus, mins } from "./words.mjs";
import { findFile } from "./files.mjs";
export { sayStatus, findFile };
// handle(text, { surface }) → { reply, openPage?, intent } | null
export async function handle(text, { surface = "tv", from } = {}) {
  noteSurface(surface);
  if (!gate.on("printers") || surface === "call") return null;
  if (!store.list().length) return null;
  const q = norm(text).replace(/^(?:(?:hey|ok|okay) )?(?:dayspring )?(?:can you |could you |please )*/, "").replace(/ please$/, "").trim();
  let m;
  const P = (phrase) => printers.resolve(phrase) ?? null;
  const unknown = (phrase) => ({ reply: `I don't know a printer called “${phrase}”. Your printers: ${store.list().map((p) => p.name).join(", ")}.`, intent: "printers.unknown" });
  // after "Did it come out okay?" (the most recent question about a finished print comes first)
  { const awaiting = monitor.all().find((j) => j.awaiting); if (awaiting && /^(?:yes|yeah|yep|it (?:came out|looks|is) (?:fine|good|great|ok|okay|perfect)|looks good|perfect|all good)\b/.test(q)) { await monitor.confirmResult(awaiting.printer, true); return { reply: "Great. I cleared its pictures.", intent: "printers.good" }; }
    if (awaiting && /^(?:no|nope|it (?:failed|didn't|did not)|not really|it came out (?:bad|wrong|ugly))\b/.test(q)) { await monitor.confirmResult(awaiting.printer, false); return { reply: "Sorry about that. I kept its pictures and a short report, on the Printers page.", intent: "printers.bad" }; } }
  // a yes / no to a start, a stop, or "want me to pause it?"
  if (printers.hasPending({ surface, from })) {
    const r = await printers.answer(text, { surface, from });
    if (r) return { reply: r.text, intent: "printers.answer" };
  }
  if (/^(?:open|show)(?: me)?(?: the| my)? (?:3d )?printers?(?: page| screen| dashboard)?$/.test(q)) return { reply: "Here are your printers.", openPage: "/printers.html?embed=1", intent: "printers.page" };
  if ((m = /^(?:what(?:'s| is)|how (?:much|long)(?: time)? (?:is )?)left (?:on|for)(?: the| my)? (.+)$/.exec(q)) || (m = /^how (?:much )?longer (?:on|for)(?: the| my)? (.+)$/.exec(q))) {
    const p = P(m[1]); if (!p) return /printer|x1|p1|a1|h2|ender/.test(m[1]) ? unknown(m[1]) : null;
    await printers.connection(p.id).catch(() => {});
    const s = printers.status(p.id);
    return { reply: s.online && ["printing", "paused", "preparing"].includes(s.state) ? `${p.name}: ${Math.round(s.progress ?? 0)}% done${s.remainingMin != null ? `, about ${mins(s.remainingMin)} left` : ""}.` : sayStatus(s), intent: "printers.left" };
  }
  if ((m = /^(?:show|open|pull up)(?: me)?(?: the)? (?:camera|webcam|feed|live view) (?:on|of|for)(?: the| my)? (.+)$/.exec(q)) || (m = /^(?:show|open)(?: me)?(?: the| my)? (.+?)(?:'s| s)? (?:camera|webcam|feed|live view)$/.exec(q))) {
    const p = P(m[1]); if (!p) return /printer|x1|p1|a1|h2|ender/.test(m[1]) ? unknown(m[1]) : null;
    return { reply: printers.cameraId(p.id) || p.brand === "bambu" ? `Here's ${p.name}'s camera.` : `${p.name} has no camera. You can lend it one in Settings → Printers.`, openPage: `/printers.html?embed=1&printer=${encodeURIComponent(p.id)}&camera=1`, intent: "printers.camera" };
  }
  if ((m = /^is (?:the )?(?:print )?bed (?:clear|empty|clean)(?: on| for)?(?: the| my)? ?(.*)$/.exec(q)) || (m = /^(?:check|look at)(?: the)? (?:print )?bed (?:on|for)(?: the| my)? (.+)$/.exec(q)) || (m = /^is (?:the |my )?(.+?)(?:'s| s) bed (?:clear|empty)$/.exec(q))) {
    const p = m[1] ? P(m[1]) : store.list().length === 1 ? store.list()[0] : null;
    if (!p) return { reply: m[1] ? unknown(m[1]).reply : "Which printer?", intent: "printers.bed" };
    const r = await printers.checkBed(p.id).catch((e) => ({ clear: false, reason: e.message }));
    return { reply: r.clear ? `The bed on ${p.name} looks clear.` : `The bed on ${p.name} isn't clear: ${r.reason}`, openPage: r.image ? `/printers.html?embed=1&printer=${encodeURIComponent(p.id)}&bed=1` : undefined, intent: "printers.bed" };
  }
  // pause / resume / stop
  if ((m = /^(pause|resume|unpause|continue|stop|cancel|abort) (?:the )?(?:print(?:ing)? on |printing on )?(?:the |my )?(.+?)(?:'s print| print)?$/.exec(q)) && /printer|x1|p1|a1|h2|ender|print/.test(q)) {
    const kind = { pause: "pause", resume: "resume", unpause: "resume", continue: "resume", stop: "stop", cancel: "stop", abort: "stop" }[m[1]];
    const p = P(m[2].replace(/^(?:the )?print (?:on )?/, "")) ?? (/^(?:the |my )?print$/.test(m[2]) && store.list().length === 1 ? store.list()[0] : null);
    if (!p) return unknown(m[2]);
    const r = await printers.command(p.id, kind, null, { surface, from });
    return { reply: r.text, intent: `printers.${kind}`, ...(r.needsConfirm ? { listen: true } : {}) };
  }
  if ((m = /^(?:set|put|switch)(?: the)? (.+?) (?:to|on|in) (silent|quiet|standard|normal|sport|ludicrous)(?: speed| mode)?$/.exec(q))) {
    const p = P(m[1]); if (!p) return /printer|x1|p1|a1|h2|ender/.test(m[1]) ? unknown(m[1]) : null;
    const r = await printers.command(p.id, "speed", { silent: 1, quiet: 1, standard: 2, normal: 2, sport: 3, ludicrous: 4 }[m[2]], { surface, from });
    return { reply: r.text, intent: "printers.speed" };
  }
  if ((m = /^turn (on|off) (?:the )?(?:light|lights|chamber light) (?:on|in)(?: the| my)? (.+)$/.exec(q)) || (m = /^turn (?:the )?(?:light|lights|chamber light) (on|off) (?:on|in)(?: the| my)? (.+)$/.exec(q))) {
    const p = P(m[2]); if (!p) return unknown(m[2]);
    const r = await printers.command(p.id, "light", m[1], { surface, from }); return { reply: r.text, intent: "printers.light" };
  }
  if ((m = /^set (?:the )?(nozzle|hotend|bed) (?:on|of)(?: the| my)? (.+?) to (\d{1,3})(?: degrees)?$/.exec(q))) {
    const p = P(m[2]); if (!p) return unknown(m[2]);
    const r = await printers.command(p.id, "temp", { [m[1] === "bed" ? "bed" : "nozzle"]: Number(m[3]) }, { surface, from }); return { reply: r.text, intent: "printers.temp" };
  }
  // the queue
  if ((m = /^(?:print|start) (?:the )?next (?:one|print|file|job)(?: on| for)?(?: the| my)? ?(.*)$/.exec(q)) || (m = /^start (?:the )?queue (?:on|for)(?: the| my)? (.+)$/.exec(q))) {
    const p = m[1] ? P(m[1]) : store.list().length === 1 ? store.list()[0] : null; if (!p) return { reply: "Which printer?", intent: "printers.next" };
    const r = await queue.next(p.id, { surface, from }); return { reply: r.text, intent: "printers.next", ...(r.needsConfirm ? { listen: true } : {}) };
  }
  if ((m = /^what(?:'s| is) (?:queued|in the queue|next) (?:on|for)(?: the| my)? (.+)$/.exec(q))) {
    const p = P(m[1]); if (!p) return unknown(m[1]);
    const items = queue.list(p.id); return { reply: items.length ? `Queued on ${p.name}: ${items.map((x) => x.name).join(", ")}.` : `Nothing is queued on ${p.name}.`, intent: "printers.queue" };
  }
  // status
  if ((m = new RegExp(`^(?:how(?:'s| is| are)|what(?:'s| is)|check on|status of|how's it going (?:on|with))(?: the| my)? (${PR})(?: doing| up to| going| status)?$`).exec(q)) && (/printer|x1|p1|a1|h2|ender|\bprint/.test(q) || (/ doing$| up to$/.test(q) && P(m[1]))) || (m = /^how(?:'s| is) (?:my|the) print(?:ing)? (?:going|doing)(?: on (.+))?$/.exec(q))) {
    const p = m[1] ? P(m[1]) : store.list().length === 1 ? store.list()[0] : store.list().find((x) => ["printing", "paused"].includes(printers.status(x.id)?.state));
    if (!p) return m[1] ? unknown(m[1]) : null;
    await printers.connection(p.id).catch(() => {});
    return { reply: sayStatus(printers.status(p.id)), intent: "printers.status" };
  }
  // "start the benchy on printer 1", "print the phone stand on the X1"
  if ((m = /^(?:start|print|run) (?:the |my |a )?(.+?) (?:on|with)(?: the| my)? (.+)$/.exec(q)) && !/\b(queue|next)\b/.test(m[1])) {
    const p = P(m[2]); if (!p) return /printer|x1|p1|a1|h2|ender/.test(m[2]) ? unknown(m[2]) : null;
    const f = await findFile(p, m[1]);
    if (!f) return { reply: `I couldn't find a file called “${m[1]}” for ${p.name}. Add it to its queue on the Printers page, or set a print folder in Settings → Printers.`, intent: "printers.start" };
    const r = await printers.startPrint(p.id, { file: f.file, plate: f.item?.plate ?? 1, amsMapping: f.item?.amsMapping, options: f.item?.options, queueItem: f.item?.id, surface, from });
    return { reply: r.text, intent: "printers.start", ...(r.needsConfirm ? { listen: true } : {}), ...(r.bedNotClear ? { openPage: `/printers.html?embed=1&printer=${encodeURIComponent(p.id)}&bed=1` } : {}) };
  }
  return null;
}

const P = { type: "string", description: "Which printer, as the owner said it: \"printer 3\", \"the X1\", \"the P1S\", \"the Ender\". Omit if there's only one." };
export const TOOLS = [
  { name: "printer_status", description: "The owner's 3D printers (Bambu Lab, Creality Ender and others): state, progress, layer, time left, temperatures, fans, speed, AMS filament, errors, and whether a print is being watched. Omit printer for all of them.", input_schema: { type: "object", properties: { printer: P } } },
  { name: "printer_camera", description: "Show a printer's camera on the Dayspring screen (live view), and get the latest picture's address.", input_schema: { type: "object", properties: { printer: P } } },
  { name: "printer_bed_check", description: "Look at a printer's bed with its camera and say whether it's clear (compared with the owner's empty-bed picture; the AI may double-check). Always do this before suggesting a print.", input_schema: { type: "object", properties: { printer: P } } },
  { name: "printer_start", description: "Start a print. file: words from its name (\"benchy\") or a full path to a .3mf/.gcode. The code checks the bed first (refuses if it isn't clear, and says why) and returns needsConfirm with a question: say it, and only after the owner's clear yes call again with confirm_token. A fresh bed check is made again then. plate: which plate of a multi-plate .3mf. ams_mapping: for each filament in the file, the AMS tray (0-15, -1 = external spool). options: bed_levelling, flow_cali, timelapse (true/false).",
    input_schema: { type: "object", properties: { printer: P, file: { type: "string" }, plate: { type: "integer" }, ams_mapping: { type: "array", items: { type: "integer" } }, options: { type: "object", properties: { bed_levelling: { type: "boolean" }, flow_cali: { type: "boolean" }, timelapse: { type: "boolean" } } }, confirm_token: { type: "string" } }, required: ["file"] } },
  { name: "printer_control", description: "Control a printer: pause, resume, stop (asks first: needsConfirm → the owner's yes → call again with confirm_token), speed (value 1 silent, 2 standard, 3 sport, 4 ludicrous), light (on/off), temp (value {nozzle, bed, chamber} in °C; above the model's limit is refused), fan (value {part, aux, chamber} in %).",
    input_schema: { type: "object", properties: { printer: P, action: { type: "string", enum: ["pause", "resume", "stop", "speed", "light", "temp", "fan"] }, value: { description: "speed level, on/off, or {nozzle, bed, chamber} / {part, aux, chamber}" }, confirm_token: { type: "string" } }, required: ["action"] } },
  { name: "printer_queue", description: "A printer's print queue: list, add (file path or words), remove (item_id), next (start the next one: same bed check and yes as printer_start), folder (set a folder whose .3mf files are queued automatically).",
    input_schema: { type: "object", properties: { printer: P, op: { type: "string", enum: ["list", "add", "remove", "next", "folder"] }, file: { type: "string" }, plate: { type: "integer" }, item_id: { type: "string" }, folder: { type: "string" }, confirm_token: { type: "string" } }, required: ["op"] } },
];
export const NAMES = new Set(TOOLS.map((t) => t.name));
// Which conversation an AI tool call belongs to: the assistant doesn't say, so handle() notes each message's surface, and a
// tool call made while someone other than the owner is talking (Discord, a meeting, a text) in the last 90 seconds is
// treated as theirs (the careful choice: at worst the owner is asked to use his own screen).
const seen = new Map();
export function noteSurface(s) { seen.set(String(s ?? "tv"), Date.now()); }
export function toolSurface() { const t = Date.now(); for (const [s, at] of seen) if (t - at < 90_000 && !["tv", "desk", "typed"].includes(s) && !s.startsWith("remote:")) return s; return "tv"; }
export const toolsNow = () => (gate.on("printers") && store.list().length ? TOOLS : gate.on("printers") ? TOOLS.slice(0, 1) : []);
const which = (i) => (i.printer ? printers.resolve(i.printer) : store.list().length === 1 ? store.list()[0] : null);
export async function runTool(name, i = {}, { surface = toolSurface(), from } = {}) {
  if (!NAMES.has(name)) return undefined;
  if (!gate.on("printers")) return { error: "Printers aren't turned on in this version." };
  if (name === "printer_status" && !i.printer) { for (const p of store.list()) await printers.connection(p.id).catch(() => {}); return { printers: printers.statusAll() }; }
  const p = which(i);
  if (!p) return { error: i.printer ? `No printer called “${i.printer}”. Printers: ${store.list().map((x) => x.name).join(", ") || "none yet"}.` : "Which printer?" };
  switch (name) {
    case "printer_status": await printers.connection(p.id).catch(() => {}); return { ...printers.status(p.id), said: sayStatus(printers.status(p.id)) };
    case "printer_camera": { const { broadcast } = await import("../bus.mjs"); broadcast("printers", { open: `/printers.html?embed=1&printer=${encodeURIComponent(p.id)}&camera=1` }); return { shown: true, snapshot: `/api/printers/${encodeURIComponent(p.id)}/snapshot.jpg`, camera: Boolean(printers.cameraId(p.id)) }; }
    case "printer_bed_check": return printers.checkBed(p.id).catch((e) => ({ error: e.message }));
    case "printer_start": {
      const f = existsSync(String(i.file ?? "")) ? { file: i.file } : await findFile(p, i.file ?? "");
      if (!f) return { error: `No file matching “${i.file}” in ${p.name}'s queue or print folders.` };
      const o = i.options ?? {};
      return printers.startPrint(p.id, { file: f.file, plate: i.plate ?? f.item?.plate ?? 1, amsMapping: i.ams_mapping ?? f.item?.amsMapping, options: { bedLevelling: o.bed_levelling, flowCali: o.flow_cali, timelapse: o.timelapse }, queueItem: f.item?.id, confirmToken: i.confirm_token, surface, from });
    }
    case "printer_control": return printers.command(p.id, i.action, i.value, { confirmToken: i.confirm_token, surface, from });
    case "printer_queue": {
      if (i.op === "list") return { queue: queue.list(p.id), folder: p.queue?.folder ?? "" };
      if (i.op === "add") { const f = existsSync(String(i.file ?? "")) ? i.file : (await findFile(p, i.file ?? ""))?.file; if (!f) return { error: "I couldn't find that file." }; return { added: queue.add(p.id, { file: f, plate: i.plate }) }; }
      if (i.op === "remove") return { removed: queue.remove(p.id, i.item_id) };
      if (i.op === "folder") return { added: queue.setFolder(p.id, i.folder) };
      if (i.op === "next") return queue.next(p.id, { confirmToken: i.confirm_token, surface, from });
      return { error: "Unknown queue operation." };
    }
  }
  return undefined;
}
export function contextText() {
  if (!gate.on("printers") || !store.list().length) return "";
  return `3D printers: ${store.list().map((p) => `${p.name} (#${p.number}, ${p.brand} ${p.model})`).join(", ")}. Use printer_* tools; starting a print always needs a clear bed and the owner's yes.`;
}
export { confirm };
