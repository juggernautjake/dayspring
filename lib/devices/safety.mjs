// The safety rules for switching things, enforced here in code (never left to the AI):
//   · Never cut power to the computer running Dayspring, a critical outlet (fridge, router…), a running computer, or a
//     3D printer that's printing or still hot without the owner's explicit yes, and the question says WHY it's risky.
//   · Heat (air fryer, coffee maker, heater, printer), motion (garage door, blinds) and security (locks): an exact name,
//     the owner's yes for anything but switching off/closing/locking, never part of "turn everything on", and never
//     for anyone but the owner (a meeting, Discord, someone else's device).
//   · "Everything off" and other big batches ask first; protected things are left alone in a batch and he's told.
//   · The Devices permission (off / ask / on, and per device), rate limits, and every decision in the activity log.
// assess(devices, action, ctx) → { go: [d], confirm: [{ d, why }], refuse: [{ d, why }], left: [{ d, why }], batchWhy }
import { hostname, networkInterfaces } from "node:os";
import { safetyOf, guarded, TYPES } from "./model.mjs";
import * as registry from "./registry.mjs";
import * as permissions from "../permissions.mjs";

const OWNER_SURFACES = new Set(["tv", "desk", "typed", "remote", "schedule", "", undefined]);
export function isOwner(ctx = {}) {
  if (ctx.from && ctx.from.id && ctx.from.id !== "local") return ctx.from.owner !== false && ctx.from.verified === true;
  return OWNER_SURFACES.has(ctx.surface) || String(ctx.surface ?? "").startsWith("remote:");
}
// the computer this Dayspring runs on
let macs = null;
const localMacs = () => (macs ??= new Set(Object.values(networkInterfaces()).flat().map((i) => String(i?.mac ?? "").toUpperCase()).filter((m) => m && m !== "00:00:00:00:00:00")));
export function isThisPC(d) {
  if (d.hostsDayspring) return true;
  if (d.hostname && d.hostname.toLowerCase() === hostname().toLowerCase()) return true;
  return (d.power ?? []).some((p) => p.via === "wol" && localMacs().has(String(p.mac).toUpperCase()));
}
export function effectivePermission(d) {
  const p = d?.permission && d.permission !== "inherit" ? d.permission : permissions.get().devices ?? "off";
  return ["off", "ask", "on"].includes(p) ? p : "off";
}

// ---- rate limits -------------------------------------------------------------------------------------------------------
const toggles = new Map();   // device id → [times]
let actions = [];
let now = () => Date.now();
export function _setNow(fn) { now = fn ?? (() => Date.now()); }
export function _resetRates() { toggles.clear(); actions = []; }
export function rateCheck(d) {
  const o = registry.options(), t = now();
  const list = (toggles.get(d.id) ?? []).filter((x) => t - x < 60_000);
  if (list.length && t - list.at(-1) < o.minToggleSeconds * 1000) return `${d.name} was just switched. Give it a few seconds.`;
  if (list.length >= o.maxTogglesPerMinute) return `${d.name} has been switched ${list.length} times in a minute. That's hard on it, so I'm pausing for a minute.`;
  actions = actions.filter((x) => t - x < 60_000);
  if (actions.length >= o.maxActionsPerMinute) return "That's a lot of switching in one minute. I'm pausing device commands for a moment.";
  return null;
}
export function noteToggle(d) { const t = now(); toggles.set(d.id, [...(toggles.get(d.id) ?? []).filter((x) => t - x < 60_000), t]); actions.push(t); }

// ---- the rules ---------------------------------------------------------------------------------------------------------
const OFFISH = new Set(["off", "close", "lock"]);
const heatWhy = (d) => (d.type === "printer" ? "it's a 3D printer: it heats up to over 200 °C" : `it's a ${TYPES[d.type]?.label.toLowerCase() ?? "heating appliance"}, which heats up`);
// printer status: { state, hot, nozzle, bed } from lib/printers (injected), or null when it can't be read
export function assess(devices, action, ctx = {}) {
  const out = { go: [], confirm: [], refuse: [], left: [], batchWhy: null };
  const batch = ctx.batch === true || devices.length > 1;
  const owner = isOwner(ctx);
  for (const d of devices) {
    const cls = safetyOf(d), perm = effectivePermission(d);
    const turningOff = OFFISH.has(action) || (action === "toggle" && ctx.currentlyOn?.(d) === true);
    if (perm === "off") { (batch ? out.left : out.refuse).push({ d, why: `Controlling ${d.name} is turned off (Settings → Devices, or Settings → Permissions).`, code: "permission" }); continue; }
    if (!owner && (guarded(d) || d.critical || isThisPC(d))) { out.refuse.push({ d, why: `Only ${ctx.ownerName ?? "the owner"} can control ${d.name}, from their own screen or devices.`, code: "not-owner" }); continue; }
    if (!owner && ctx.surface === "call") { out.refuse.push({ d, why: "Nobody on a call can control devices.", code: "not-owner" }); continue; }
    const rate = ctx.skipRate ? null : rateCheck(d);
    if (rate) { out.refuse.push({ d, why: rate, code: "rate" }); continue; }
    // heat, motion, security
    if (cls !== "normal" && !(ctx.scheduled && ctx.preApproved)) {
      if (batch && !turningOff) { out.left.push({ d, why: `${d.name} is never switched on as part of a group; ask for it by name.`, code: "guarded-batch" }); continue; }
      if (!batch && ctx.exact === false) { out.refuse.push({ d, why: `For ${d.name} I need its exact name (it ${cls === "heat" ? "heats up" : cls === "motion" ? "moves" : "is a lock"}).`, code: "exact" }); continue; }
      if (cls === "heat" && !turningOff) { out.confirm.push({ d, why: `${d.name} ${heatWhy(d).replace(/^it's/, "is")}. Make sure it's safe to turn on.`, code: "heat" }); continue; }
      if (cls === "motion") { if (batch && turningOff) { out.left.push({ d, why: `${d.name} moves, so it isn't part of a group command.`, code: "motion-batch" }); continue; } out.confirm.push({ d, why: `${d.name} ${action === "close" || turningOff ? "will close" : "will open"}. Make sure nothing and no one is in the way.`, code: "motion" }); continue; }
      if (cls === "security" && action !== "lock" && !turningOff) { if (batch) { out.left.push({ d, why: `${d.name} is a lock; it's never unlocked by a group command.`, code: "lock-batch" }); continue; } out.confirm.push({ d, why: `This unlocks ${d.name}.`, code: "unlock" }); continue; }
    }
    if (turningOff) {
      const why = offRisk(d, ctx);
      if (why) {
        if (ctx.scheduled) { if (ctx.preApproved && !why.live) { out.go.push(d); continue; } out.left.push({ d, why: why.text, code: why.code }); continue; }
        if (batch) { out.left.push({ d, why: why.text, code: why.code }); continue; }
        out.confirm.push({ d, why: why.text, code: why.code }); continue;
      }
    }
    if (perm === "ask" && !(ctx.scheduled && ctx.preApproved)) { out.confirm.push({ d, why: `You asked me to check before switching ${d.name}.`, code: "ask" }); continue; }
    out.go.push(d);
  }
  // big batches ask first ("everything off", or several things at once)
  const n = out.go.length;
  if (batch && n && !(ctx.scheduled && ctx.preApproved) && (ctx.scope?.all && !ctx.scope.room && !ctx.scope.type || n >= registry.options().bulkConfirmAt) && !ctx.scene) {
    out.batchWhy = `That's ${n} thing${n === 1 ? "" : "s"}: ${n > 8 ? out.go.slice(0, 8).map((d) => d.name).join(", ") + ` and ${n - 8} more` : out.go.map((d) => d.name).join(", ")}.`;
    for (const d of out.go.splice(0)) out.confirm.push({ d, why: out.batchWhy, code: "batch" });
  }
  return out;
}
// why cutting this one's power is risky (null: it isn't). live: a condition that has to be checked at that moment.
export function offRisk(d, ctx = {}) {
  if (isThisPC(d)) return { code: "host", text: `${d.name} is the computer I'm running on. Cutting its power shuts me down and can lose anything unsaved on it.` };
  if (d.type === "printer" || d.printer) {
    const st = ctx.printerStatus?.(d);
    if (st === null || st === undefined) { if (d.printer) return { code: "printer-unknown", live: true, text: `I can't reach ${d.name} to check whether it's printing or still hot. Cutting power mid-print ruins the print, and a hot nozzle needs its fan to cool down.` }; }
    else if (/printing|preparing|paused|busy/.test(st.state ?? "")) return { code: "printer-busy", live: true, text: `${d.name} is ${st.state === "paused" ? "paused in the middle of a print" : "printing right now"}${st.progress != null ? ` (${Math.round(st.progress)}% done)` : ""}. Cutting power ruins the print${st.hot ? ", and its nozzle is hot" : ""}.` };
    else if (st.hot) return { code: "printer-hot", live: true, text: `${d.name} is still hot (nozzle ${Math.round(st.nozzle ?? 0)} °C${st.bed != null ? `, bed ${Math.round(st.bed)} °C` : ""}). Its fan needs power to cool the hot end, or it can clog. Wait until it's under 50 °C.` };
  }
  if (d.critical) return { code: "critical", text: `${d.name} is marked critical${d.type === "router" ? " (it's your internet)" : d.type === "fridge" ? " (food spoils without power)" : ""}.` };
  if (d.type === "computer" || d.type === "laptop") return { code: "computer", text: `Cutting the power to ${d.name} is like pulling its plug: anything unsaved is lost, and it can damage what it was writing. Shut it down first if you can.` };
  return null;
}
