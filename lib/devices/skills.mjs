// Devices by voice and for the AI. No AI needed for any of it: handle() answers "turn fan 2 off", "is the TV on?",
// "movie mode", "turn everything off in the office at 10 pm", "what's on right now?", and the yes/no to its own
// questions. The AI gets three tools (device_control, device_status, device_schedule) that go through the same rules.
import * as devices from "./index.mjs";
import * as registry from "./registry.mjs";
import * as gate from "./gate.mjs";
import { parse } from "./parse.mjs";

// handle(text, { surface }) → { reply, openPage?, intent } | null (not about a device this home has)
export async function handle(text, { surface = "tv" } = {}) {
  noteSurface(surface);
  if (!gate.on("devices")) return null;
  if (surface === "call") return null;
  // an answer to our own question ("yes", "no", "the second one")
  if (devices.hasPending({ surface })) {
    const an = await devices.answer(text, { surface });
    if (an) return { reply: an.text, intent: "devices.answer" };
  }
  const p = parse(text);
  if (!p) return null;
  if (!registry.devices().length && !["page", "list"].includes(p.kind)) return null;
  const r = await devices.runParsed(p, { surface });
  // not a device this home has: let Home Assistant, the media player and the rest have a go (the no-AI fallback says
  // "I don't know a device called …" if nothing else understands it)
  if (!r || r.unknown) return null;
  return { reply: r.text, intent: `devices.${p.kind}`, ...(r.openPage ? { openPage: r.openPage } : {}), ...(r.needsConfirm || r.ambiguous ? { listen: true } : {}) };
}

const WHEN = { type: "string", description: "When, in the owner's words or ISO time: \"at 10 pm\", \"in 30 minutes\", \"tomorrow at 7am\", \"every night at 11\", or 2026-10-01T22:00." };
export const TOOLS = [
  { name: "device_control", description: "Switch the owner's smart devices (smart plugs and power strip outlets, computers by Wake-on-LAN, TVs, lights and LED strips, fans, the 3D printers' power, garage doors, locks) or run a scene. " +
      "target: how the owner said it (\"fan 2\", \"the office\", \"everything in the garage\", \"3D printer 3\", \"movie mode\"). action: on/off/toggle/open/close/lock/unlock/brightness/color/colortemp/effect (value: 0-100, a colour name or #hex, kelvin, effect name). " +
      "The safety rules are enforced in code: risky ones (this computer, critical outlets, a printing or hot printer, heaters, garage doors, locks, big batches) return needsConfirm with a question: say its text to the owner, and only after a clear yes call again with confirm_token. Never claim something was switched unless the result says so.",
    input_schema: { type: "object", properties: { target: { type: "string" }, action: { type: "string", enum: ["on", "off", "toggle", "open", "close", "lock", "unlock", "brightness", "color", "colortemp", "effect", "scene"] }, value: { type: "string", description: "brightness 0-100, a colour name or #hex, kelvin, or an effect name" }, confirm_token: { type: "string" } }, required: ["target", "action"] } },
  { name: "device_status", description: "Whether the owner's smart devices are on (and brightness, power use, a printer's state). target: a device, room or group; omit for everything that's on.", input_schema: { type: "object", properties: { target: { type: "string" } } } },
  { name: "device_schedule", description: "Schedule a device action for later (\"turn everything off in the office at 10 pm\", \"turn the fan off in an hour\", \"every night at 11 turn the TV off\"), list the schedules, or cancel one. Risky ones ask first (needsConfirm → the owner's yes → call again with confirm_token).",
    input_schema: { type: "object", properties: { op: { type: "string", enum: ["add", "list", "cancel"] }, target: { type: "string" }, action: { type: "string", enum: ["on", "off", "toggle", "brightness", "color"] }, value: { type: "string", description: "brightness 0-100, a colour name or #hex, kelvin, or an effect name" }, when: WHEN, confirm_token: { type: "string" }, match: { type: "string", description: "cancel: the schedule's id or words from it, or \"all\"" } }, required: ["op"] } },
];
export const NAMES = new Set(TOOLS.map((t) => t.name));
// Which conversation an AI tool call belongs to: the assistant doesn't say, so handle() notes each message's surface, and a
// tool call made while someone other than the owner is talking (Discord, a meeting, a text) in the last 90 seconds is
// treated as theirs (the careful choice: at worst the owner is asked to use his own screen).
const seen = new Map();
export function noteSurface(s) { seen.set(String(s ?? "tv"), Date.now()); }
export function toolSurface() { const t = Date.now(); for (const [s, at] of seen) if (t - at < 90_000 && !["tv", "desk", "typed"].includes(s) && !s.startsWith("remote:")) return s; return "tv"; }
export const toolsNow = () => (gate.on("devices") ? TOOLS : []);

// "at 10 pm" etc. → the parser's when
export function whenOf(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : { at: d.toISOString(), label: `at ${d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` }; }
  const p = parse(`turn it on ${String(s).replace(/^(?!at |in |every |each |tomorrow|tonight|daily|nightly)/, "at ")}`);
  return p?.when ?? null;
}
export async function runTool(name, i = {}, { surface = toolSurface() } = {}) {
  if (!NAMES.has(name)) return undefined;
  if (!gate.on("devices")) return { error: "Device control isn't turned on in this version." };
  if (name === "device_control") {
    if (i.action === "scene" || (!i.action && i.target)) { const s = devices.findScene(i.target); if (!s) return { error: `There's no scene called “${i.target}”.` }; return devices.runScene(s, { surface, confirmToken: i.confirm_token }); }
    const p = parse(`turn ${i.action === "off" ? "off" : "on"} ${i.target}`);
    const r = await devices.control({ target: p?.target ?? i.target, scope: p?.scope, action: i.action, value: i.value, surface, confirmToken: i.confirm_token });
    if (r.unknown) { const s = devices.findScene(i.target); if (s) return devices.runScene(s, { surface, confirmToken: i.confirm_token }); }
    return r;
  }
  if (name === "device_status") {
    if (!i.target) { const all = await devices.statusAll(); return { devices: all.map((s) => ({ name: s.name, on: s.on, reachable: s.reachable, watts: s.watts, printer: s.printer?.state })) }; }
    const r = devices.resolve(i.target);
    if (!r) return { error: `No device called “${i.target}”.` };
    if (r.kind === "ambiguous") return { ambiguous: r.candidates.map((d) => d.name) };
    return { devices: await Promise.all(r.devices.map((d) => devices.status(d))) };
  }
  if (name === "device_schedule") {
    if (i.op === "list") return { schedules: devices.listSchedules() };
    if (i.op === "cancel") return { cancelled: devices.cancelSchedule(i.match ?? i.target ?? "") };
    const when = whenOf(i.when);
    if (!when) return { error: "When should that happen? (for example: at 10 pm, in 30 minutes, every night at 11)" };
    const p = parse(`turn ${i.action === "off" ? "off" : "on"} ${i.target}`);
    return devices.control({ target: p?.target ?? i.target, scope: p?.scope, action: i.action ?? "off", value: i.value, when, surface, confirmToken: i.confirm_token });
  }
  return undefined;
}
// For the system prompt: one line
export function contextText() {
  if (!gate.on("devices")) return "";
  const n = registry.devices().length;
  return n ? `Smart devices: ${n} set up (${registry.rooms().join(", ") || "no rooms"}${registry.scenes().length ? `; scenes: ${registry.scenes().map((s) => s.name).join(", ")}` : ""}). Use device_control / device_status / device_schedule.` : "";
}
