// Smart devices: power strips and plugs (each outlet on its own), computers (Wake-on-LAN), TVs, lights and LED strips,
// Home Assistant and Matter entities, custom HTTP/MQTT devices, and the 3D printers' power. One place decides what
// "fan 2", "the office" or "everything" means, checks the safety rules (./safety.mjs), does it through the right
// adapter (./adapters) and writes it in the activity log.
//
// THE ENTRY POINT for every command, local or remote:
//   run(command, { from, surface, confirmToken }) → { ok, text, needsConfirm?, confirmToken?, done?, left?, refused?, devices? }
//     command: a sentence ("turn fan 2 off", "is the TV on?", "yes") or { target, action, value?, when? } or { answer: "yes" }
//     from:    { id, name, verified: true, owner: true } for another of the owner's Dayspring computers (the remote layer
//              authenticates it and sets verified); omitted = this computer. Same rules either way; a risky command's
//              question is bound to the computer it came from (confirm.mjs surface "remote:<id>"), so only a yes said
//              THERE approves it. docs/dev/device-adapters.md ("Remote commands") has the whole contract.
// Also: control(), status(), statusAll(), resolve(), schedules (addSchedule, cancelSchedule, listSchedules), start().
import * as registry from "./registry.mjs";
import * as safety from "./safety.mjs";
import * as adapters from "./adapters/index.mjs";
import { parse } from "./parse.mjs";
import { nameKey, namesOf, splitNumber, typeFromWords, lev, safetyOf, guarded, TYPES, iconOf } from "./model.mjs";
import * as confirm from "../confirm.mjs";
import * as activity from "../activity.mjs";
import * as gate from "./gate.mjs";

let deps = { printerStatus: () => null, announce: () => {}, broadcast: () => {}, ownerName: () => "the owner" };
export function setDeps(d) { deps = { ...deps, ...d }; }
const log = (kind, data) => activity.log(kind, data);

// ---- what a phrase means -----------------------------------------------------------------------------------------------
// resolve("fan 2") → { kind: "device", devices: [d], exact, label } | { kind: "scene" | "group" | "room" | "type" | "all", … }
//   | { kind: "ambiguous", candidates: [d] } | null
export function resolve(phrase, { scope } = {}) {
  const all = registry.devices();
  const key = nameKey(phrase);
  if (scope?.all) {
    let list = all;
    if (scope.room) { const r = nameKey(scope.room); list = list.filter((d) => nameKey(d.room ?? "") === r || nameKey(d.group ?? "") === r || registry.groups().some((g) => nameKey(g.name) === r && g.members.includes(d.id))); if (!list.length) return null; }
    if (scope.type) list = list.filter((d) => d.type === scope.type || (scope.type === "light" && d.control));
    return { kind: scope.room ? "room" : scope.type ? "type" : "all", devices: list, exact: true, label: scope.room ? `everything in the ${scope.room}` : scope.type ? `all the ${TYPES[scope.type]?.label.toLowerCase() ?? scope.type}s` : "everything", scope };
  }
  if (!key) return null;
  // a device by one of its names
  const exact = all.filter((d) => namesOf(d).includes(key));
  if (exact.length === 1) return { kind: "device", devices: exact, exact: true, label: exact[0].name };
  // a group or a room ("office", "the garage", "fans")
  const g = registry.groups().find((x) => [x.name, ...(x.aliases ?? [])].some((n) => nameKey(n) === key));
  if (g) return { kind: "group", devices: g.members.map(registry.device).filter(Boolean), exact: true, label: g.name };
  const roomHit = all.filter((d) => d.room && nameKey(d.room) === key);
  if (roomHit.length) return { kind: "room", devices: roomHit, exact: true, label: `the ${roomHit[0].room}`, scope: { all: true, room: roomHit[0].room } };
  const groupHit = all.filter((d) => d.group && nameKey(d.group) === key);
  if (groupHit.length) return { kind: "group", devices: groupHit, exact: true, label: groupHit[0].group };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };
  // "the fan" when there's one fan; "the fans" = all of them; "fan 2" by number within a type
  const t = typeFromWords(key);
  // the words in front of the kind ("kitchen" in "kitchen lights"): a room narrows it; anything else isn't this kind at all
  const tw = t ? TYPES[t].words.filter((w) => key === w || key === w + "s" || key.endsWith(" " + w) || key.endsWith(" " + w + "s")).sort((a, b) => b.length - a.length)[0] : null;
  const prefix = tw ? key.slice(0, key.length - (key.endsWith(tw + "s") ? tw.length + 1 : tw.length)).trim() : "";
  if (t && !splitNumber(key)) {
    let ofType = all.filter((d) => d.type === t);
    if (prefix) ofType = ofType.filter((d) => d.room && nameKey(d.room) === nameKey(prefix));
    if (!ofType.length) { /* not a kind this home has there: try the near misses below */ }
    else if (/s$/.test(key) && ofType.length > 1 && !namesOf(ofType[0]).includes(key)) return { kind: "type", devices: ofType, exact: true, label: `all the ${prefix ? `${prefix} ` : ""}${TYPES[t].label.toLowerCase()}s`, scope: { all: true, type: t, ...(prefix ? { room: prefix } : {}) } };
    else if (ofType.length === 1) return { kind: "device", devices: ofType, exact: Boolean(prefix), label: ofType[0].name };
    else return { kind: "ambiguous", candidates: ofType };
  } else if (t) {
    // "fan 2": by number within the kind
    const sn = splitNumber(key);
    const hit = all.filter((d) => d.type === t && (d.number ?? splitNumber(nameKey(d.name))?.n) === sn.n);
    if (hit.length === 1 && typeFromWords(sn.base) === t) return { kind: "device", devices: hit, exact: true, label: hit[0].name };
  }
  // near misses (speech recognition): a name within a couple of letters, or one containing every word said
  let best = null, bestD = 99;
  for (const d of all) for (const n of namesOf(d)) { const dist = lev(n, key, 2); if (dist < bestD) { best = d; bestD = dist; } }
  if (best && bestD <= (key.length > 6 ? 2 : 1)) return { kind: "device", devices: [best], exact: false, label: best.name };
  const words = key.split(" ").filter((w) => w.length > 1);
  const partial = all.filter((d) => namesOf(d).some((n) => words.every((w) => n.split(" ").includes(w))));
  if (partial.length === 1) return { kind: "device", devices: partial, exact: false, label: partial[0].name };
  if (partial.length > 1) return { kind: "ambiguous", candidates: partial };
  return null;
}
export function findScene(name) {
  const k = nameKey(name);
  return registry.scenes().find((s) => [s.name, ...(s.aliases ?? [])].some((n) => { const nk = nameKey(n); return nk === k || nk === `${k} mode` || nk.replace(/ (mode|scene)$/, "") === k; })) ?? null;
}

// ---- state -----------------------------------------------------------------------------------------------------------------
const stripCache = new Map();   // strip id → { at, state | error }
export function _clearCache() { stripCache.clear(); }
async function stripState(s, { fresh = false } = {}) {
  const c = stripCache.get(s.id);
  if (!fresh && c && Date.now() - c.at < registry.options().statusCacheMs) { if (c.error) throw c.error; return c.state; }
  const a = adapters.strip(s.adapter);
  if (!a) throw new Error(`I don't know how to talk to a ${s.adapter} device.`);
  try { const st = await a.getState(s, registry.secretFor(`strip:${s.id}`)); stripCache.set(s.id, { at: Date.now(), state: st }); return st; }
  catch (e) { stripCache.set(s.id, { at: Date.now(), error: e }); throw e; }
}
function controlExtra(ctl) { return ctl.via === "hue" ? registry.hue(ctl.bridge) : undefined; }
function controlSecret(ctl) { return ctl.via === "hue" ? registry.secretFor(`hue:${ctl.bridge}`) : {}; }
// { on: true | false | null, reachable, watts?, brightness?, color?, … , printer?, caps, via }
export async function status(d, { fresh = false } = {}) {
  const out = { id: d.id, name: d.name, on: null, reachable: null, caps: ["onoff"], via: [] };
  if (d.control) {
    const a = adapters.control(d.control.via);
    try { Object.assign(out, await a.getState(d.control, controlSecret(d.control), controlExtra(d.control)), { reachable: true }); out.via.push(d.control.via); }
    catch (e) { out.reachable = false; out.error = e.message; }
  }
  for (const p of d.power ?? []) {
    try {
      if (p.via === "outlet") {
        const s = registry.strip(p.strip); if (!s) continue;
        const st = await stripState(s, { fresh });
        if (out.on === null || !d.control) out.on = st.on?.[p.outlet - 1] ?? null;
        if (st.watts?.[p.outlet - 1] != null && s.outlets > 1 || (st.watts && s.outlets === 1)) { out.watts = st.watts[p.outlet - 1] ?? st.watts[0]; if (!out.caps.includes("power")) out.caps.push("power"); }
        out.reachable = true; out.via.push(`outlet ${p.outlet} of ${s.name}`);
      } else if (p.via === "homeassistant" || p.via === "matter") {
        const e = await adapters.power.haState(p.entity);
        if (e) { if (out.on === null) out.on = /^(on|open|playing|heat|cool|auto|unlocked)$/.test(e.state); out.reachable = true; out.via.push("Home Assistant"); }
      } else if (p.via === "webhook" && p.status) {
        const st = await adapters.strip("custom").getState({ id: `wh:${d.id}`, name: d.name, outlets: 1, custom: { kind: "http", status: p.status } });
        if (out.on === null) out.on = st.on[0]; out.reachable = true;
      }
    } catch (e) { if (out.reachable === null) { out.reachable = false; out.error = e.message; } }
  }
  if (d.printer) { const ps = deps.printerStatus(d.printer); if (ps) { out.printer = ps; if (out.on === null && ps.state && ps.state !== "offline") out.on = true; } }
  if (out.on === null && out.reachable === null && (d.power ?? []).every((p) => p.via === "wol" || p.via === "cec")) out.unknown = "I can turn it on, but I can't tell whether it's on.";
  out.class = safetyOf(d);
  return out;
}
export async function statusAll({ fresh = false } = {}) {
  const list = registry.devices();
  const res = await Promise.all(list.map((d) => status(d, { fresh }).catch((e) => ({ id: d.id, name: d.name, on: null, reachable: false, error: e.message }))));
  return res;
}
export async function stripsState() {
  return Promise.all(registry.strips().map(async (s) => {
    try { const st = await stripState(s); return { id: s.id, name: s.name, adapter: s.adapter, model: s.model, outlets: s.outlets, on: st.on, watts: st.watts ?? null, names: s.outletNames?.length ? s.outletNames : st.names ?? [], devices: Array.from({ length: s.outlets }, (_, i) => registry.onOutlet(s.id, i + 1)?.id ?? null), reachable: true }; }
    catch (e) { return { id: s.id, name: s.name, adapter: s.adapter, model: s.model, outlets: s.outlets, on: [], reachable: false, error: e.message, names: s.outletNames ?? [], devices: Array.from({ length: s.outlets }, (_, i) => registry.onOutlet(s.id, i + 1)?.id ?? null) }; }
  }));
}

// ---- doing it --------------------------------------------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());
const SOFT_OFF = new Set(["cec", "homeassistant", "matter", "webhook"]);
async function powerSet(d, on) {
  const methods = d.power ?? [];
  if (!methods.length) throw new Error(`${d.name} isn't connected to anything I can switch yet. Set it up in Settings → Devices.`);
  const order = on ? methods : [...methods.filter((p) => SOFT_OFF.has(p.via)), ...methods.filter((p) => p.via === "outlet")];
  if (!on && !order.length) throw new Error(`I can wake ${d.name} up, but I can't turn it off: it has no smart outlet or off command.`);
  let lastErr = null, did = [];
  for (const p of order) {
    try {
      if (p.via === "outlet") { const s = registry.strip(p.strip); if (!s) throw new Error(`Strip ${p.strip} isn't set up any more.`); await adapters.strip(s.adapter).setOutlet(s, p.outlet, on, registry.secretFor(`strip:${s.id}`)); stripCache.delete(s.id); did.push(`outlet ${p.outlet} on ${s.name}`); }
      else if (p.via === "wol") { if (!on) continue; await adapters.power.wake(p); did.push("a wake-up signal"); }
      else if (p.via === "cec") { await adapters.power.cec(on, p.address); did.push("HDMI-CEC"); }
      else if (p.via === "homeassistant" || p.via === "matter") { await adapters.power.haSet(p.entity, on); did.push("Home Assistant"); }
      else if (p.via === "webhook") { await adapters.power.webhook(p, on); did.push("its web request"); }
      // switching on: the power first, then the rest a little later (a PC needs power before Wake-on-LAN; a TV before CEC)
      if (on && p.via === "outlet") {
        const rest = methods.filter((x) => x.via === "wol" || x.via === "cec");
        if (rest.length) { const delay = (registry.options().wolDelaySeconds ?? 8) * 1000; wait(delay).then(() => Promise.all(rest.map((x) => (x.via === "wol" ? adapters.power.wake(x) : adapters.power.cec(true, x.address)).catch(() => {})))); did.push(rest.some((x) => x.via === "wol") ? "a wake-up signal" : "HDMI-CEC"); }
        break;
      }
      if (on || did.length) break;
    } catch (e) { lastErr = e; }
  }
  if (!did.length) throw lastErr ?? new Error(`I couldn't switch ${d.name}.`);
  return did;
}
async function act(d, action, value) {
  if (d.control && action !== "cut") {
    const a = adapters.control(d.control.via);
    await a.set(d.control, { action, value }, controlSecret(d.control), controlExtra(d.control));
    return [d.control.via];
  }
  if (action === "toggle") { const st = await status(d, { fresh: true }); return powerSet(d, !st.on); }
  if (action === "on" || action === "open" || action === "unlock") return powerSet(d, true);
  if (action === "off" || action === "close" || action === "lock" || action === "cut") return powerSet(d, false);
  throw new Error(`${d.name} can only be switched on and off.`);
}

const pendingBySurface = new Map();   // surface → { token, args, at, text }
const surfaceKey = (o) => (o.from?.id && o.from.id !== "local" ? `remote:${o.from.id}` : o.surface ?? "tv");
const OWNER_SURFACES = ["tv", "desk", "typed"];
const verb = (a, v) => ({ on: "turn on", off: "turn off", toggle: "switch", open: "open", close: "close", lock: "lock", unlock: "unlock", brightness: `set to ${v}%`, color: `make ${v}`, colortemp: "change the colour temperature of", effect: `set to the ${v} effect` })[a] ?? a;
const past = (a, v) => ({ on: "on", off: "off", toggle: "switched", open: "opening", close: "closing", lock: "locked", unlock: "unlocked", brightness: `at ${v}%`, color: `${v}`, colortemp: "changed", effect: `on ${v}` })[a] ?? "done";
const listWords = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// control({ target | ids, action, value?, when?, scope?, scene?, surface, from, confirmToken, exact? })
export async function control(o = {}) {
  if (!gate.on("devices")) return { ok: false, text: "Device control isn't turned on in this version of Dayspring." };
  const action = String(o.action ?? "").toLowerCase();
  if (!["on", "off", "toggle", "open", "close", "lock", "unlock", "brightness", "color", "colortemp", "effect"].includes(action)) return { ok: false, text: `I don't know how to “${o.action}” a device.` };
  let devs, label, exact = o.exact, kind = "device";
  if (Array.isArray(o.ids)) { devs = o.ids.map(registry.device).filter(Boolean); label = listWords(devs.map((d) => d.name)); exact = exact ?? true; kind = devs.length > 1 ? "list" : "device"; }
  else {
    const r = resolve(o.target ?? "", { scope: o.scope });
    if (!r) return { ok: false, unknown: true, text: `I don't know a device called “${o.target}”. You can add it in Settings → Devices.` };
    if (r.kind === "ambiguous") { const c = r.candidates.slice(0, 6); pendingBySurface.set(surfaceKey(o), { pick: c.map((d) => d.id), o, at: Date.now() }); return { ok: false, ambiguous: c.map((d) => d.name), text: `Which one: ${listWords(c.map((d) => d.name))}?` }; }
    devs = r.devices; label = r.label; exact = exact ?? r.exact; kind = r.kind;
  }
  if (!devs.length) return { ok: false, text: `There's nothing set up in ${label}.` };
  const batch = kind !== "device";
  if (batch && ["on", "toggle", "open", "unlock"].includes(action) && kind === "all") return { ok: false, text: "I won't turn everything on at once. Name what you'd like on, or make a scene for it." };
  // later: checked now (so the question comes now), done by the schedule
  if (o.when) return addSchedule({ ids: devs.map((d) => d.id), label, action, value: o.value, when: o.when, surface: o.surface, from: o.from, confirmToken: o.confirmToken, scope: o.scope, exact });
  const ctx = { batch, scope: o.scope ?? (kind === "all" ? { all: true } : null), exact, surface: o.surface, from: o.from, scene: o.scene, printerStatus: (d) => (d.printer ? deps.printerStatus(d.printer) : null), ownerName: deps.ownerName(),
    currentlyOn: () => null, scheduled: o.scheduled, preApproved: o.preApproved };
  const a = safety.assess(devs, action, ctx);
  const op = { tool: "device_control", ids: devs.map((d) => d.id).sort(), action, value: o.value ?? null };
  let approved = false;
  if (a.confirm.length && o.confirmToken) {
    const c = confirm.consume(o.confirmToken, op);
    if (c.ok) approved = true;
    else if (c.why !== "not-approved") return { ok: false, text: c.why === "expired" ? "That question ran out. Ask me again." : "That yes was for something else, so I didn't do it." };
  }
  if (a.confirm.length && !approved) {
    const sk = surfaceKey(o);
    const surfaces = sk.startsWith("remote:") ? [sk] : OWNER_SURFACES;
    const whys = [...new Set(a.confirm.map((x) => x.why))];
    const leftNote = a.left.length ? ` I'll leave ${listWords(a.left.map((x) => x.d.name))} alone.` : "";
    const text = `${whys.join(" ")}${leftNote} Do you want me to ${verb(action, o.value)} ${a.confirm.length === 1 && !a.batchWhy ? a.confirm[0].d.name : "them"}${a.go.length ? ` (and ${listWords(a.go.map((d) => d.name))})` : ""}? Say yes to go ahead.`;
    const token = confirm.issue(op, { text, what: `devices ${action}`, surfaces });
    pendingBySurface.set(sk, { token, o: { ...o, ids: op.ids, target: undefined, scope: o.scope }, at: Date.now(), text });
    log("device.asked", { action, devices: op.ids, why: a.confirm.map((x) => x.code), from: o.from?.id ?? "local", surface: o.surface });
    return { ok: false, needsConfirm: true, confirmToken: token, text, confirm: a.confirm.map((x) => ({ id: x.d.id, name: x.d.name, why: x.why })), left: a.left.map((x) => ({ id: x.d.id, name: x.d.name, why: x.why })) };
  }
  const todo = [...a.go, ...(approved ? a.confirm.map((x) => x.d) : [])];
  const done = [], failed = [];
  for (const d of todo) {
    safety.noteToggle(d);
    try {
      const via = await act(d, action, o.value);
      done.push(d);
      log("device", { device: d.id, name: d.name, action, value: o.value ?? undefined, via, result: "ok", from: o.from?.id ?? "local", surface: o.surface, confirmed: approved || undefined, scheduled: o.scheduled || undefined });
      if (safetyOf(d) === "heat" && ["on", "toggle"].includes(action) && d.autoOffMinutes) addAutoOff(d);
      if (safetyOf(d) === "motion" && action === "open" && d.alertOpenMinutes) addOpenAlert(d);
    } catch (e) {
      failed.push({ d, why: e.message });
      log("device", { device: d.id, name: d.name, action, result: "error", error: e.message.slice(0, 200), from: o.from?.id ?? "local", surface: o.surface });
    }
  }
  for (const r of a.refuse) log("blocked", { reason: `device-${r.code}`, device: r.d.id, action, text: r.why, from: o.from?.id ?? "local", surface: o.surface });
  deps.broadcast("devices", { changed: done.map((d) => d.id) });
  const parts = [];
  if (done.length === 1 && !batch) parts.push(`${done[0].name} is ${past(action, o.value)}.`);
  else if (done.length) parts.push(`${label[0].toUpperCase() + label.slice(1)}: ${listWords(done.map((d) => d.name))} ${done.length === 1 ? "is" : "are"} ${past(action, o.value)}.`);
  if (a.left.length) parts.push(`I left ${listWords(a.left.map((x) => x.d.name))} alone${a.left.length === 1 ? ` (${a.left[0].why.replace(/\.$/, "")})` : ", since they're protected"}.`);
  for (const r of a.refuse) parts.push(r.why);
  for (const f of failed) parts.push(`${f.d.name}: ${f.why}`);
  if (!parts.length) parts.push("Nothing to change.");
  return { ok: done.length > 0 && !failed.length, text: parts.join(" "), done: done.map((d) => d.id), left: a.left.map((x) => x.d.id), refused: a.refuse.map((x) => ({ id: x.d.id, why: x.why })), failed: failed.map((f) => ({ id: f.d.id, why: f.why })) };
}
// The owner's own click on "Yes, do it" on the Devices page (a local page only he can reach): approved as it's made,
// still one use and bound to exactly these devices and this action.
export async function controlApproved(o = {}) {
  const ids = (o.ids ?? []).filter((id) => registry.device(id)).sort();
  if (!ids.length) return { ok: false, text: "Which device?" };
  const token = confirm.issueApproved({ tool: "device_control", ids, action: String(o.action ?? "").toLowerCase(), value: o.value ?? null }, { what: `devices ${o.action}`, via: "click" });
  return control({ ...o, ids, confirmToken: token });
}
// a scene: its steps in order (each still checked: a protected device in a scene is left alone unless it's safe)
export async function runScene(scene, o = {}) {
  const groups = new Map();
  for (const s of scene.steps) { const k = `${s.action}|${JSON.stringify(s.value ?? null)}`; if (!groups.has(k)) groups.set(k, { action: s.action, value: s.value, ids: [] }); groups.get(k).ids.push(s.device); }
  const texts = []; let ok = true;
  for (const g of groups.values()) { const r = await control({ ...o, ids: g.ids, action: g.action, value: g.value, scene: scene.id, exact: true }); texts.push(r.text); ok = ok && r.ok !== false; if (r.needsConfirm) return r; }
  log("device.scene", { scene: scene.id, name: scene.name, from: o.from?.id ?? "local", surface: o.surface });
  return { ok, text: `${scene.name}: ${texts.join(" ")}` };
}
// the answer to our own question: "yes" / "no" / "the second one" (after confirm.userSaid() has seen it)
export async function answer(said, o = {}) {
  const sk = surfaceKey(o), p = pendingBySurface.get(sk);
  if (!p || Date.now() - p.at > confirm.WINDOW_MS) { pendingBySurface.delete(sk); return null; }
  if (p.pick) {
    const k = nameKey(said), n = Number((/(\d+)/.exec(k) ?? [])[1]);
    const cands = p.pick.map(registry.device).filter(Boolean);
    const hit = cands.find((d) => namesOf(d).includes(k) || nameKey(d.name) === k) ?? (n >= 1 && n <= cands.length && !cands.some((d) => namesOf(d).some((x) => x.endsWith(" " + n))) ? cands[n - 1] : cands.find((d) => (d.number ?? splitNumber(nameKey(d.name))?.n) === n));
    if (!hit) { if (confirm.isNo(said)) { pendingBySurface.delete(sk); return { ok: true, text: "Okay, never mind." }; } return null; }
    pendingBySurface.delete(sk);
    return control({ ...p.o, ids: [hit.id], target: undefined, exact: true, surface: o.surface ?? p.o.surface, from: o.from ?? p.o.from });
  }
  if (confirm.isNo(said)) { pendingBySurface.delete(sk); log("device.refused", { devices: p.o.ids, from: o.from?.id ?? "local" }); return { ok: true, text: "Okay, I won't." }; }
  if (!confirm.isYes(said) || !confirm.isApproved(p.token)) return null;
  pendingBySurface.delete(sk);
  const r = p.o.when ? await addSchedule({ ...p.o.sched, confirmToken: p.token }) : await control({ ...p.o, confirmToken: p.token });
  return r;
}
export const hasPending = (o = {}) => { const p = pendingBySurface.get(surfaceKey(o)); return Boolean(p && Date.now() - p.at < confirm.WINDOW_MS); };

// ---- schedules ---------------------------------------------------------------------------------------------------------
export async function addSchedule({ ids, label, action, value, when, surface, from, confirmToken, scope, exact, tag }) {
  const devs = ids.map(registry.device).filter(Boolean);
  // check now, the way it will be done then: protected things and big batches ask now; a printer's state is checked again then
  const ctx = { batch: devs.length > 1, scope, exact, surface, from, printerStatus: () => ({ state: "idle", hot: false }), skipRate: true, ownerName: deps.ownerName() };
  const a = tag ? { confirm: [], refuse: [], left: [], go: devs } : safety.assess(devs, action, ctx);
  const op = { tool: "device_schedule", ids: devs.map((d) => d.id).sort(), action, value: value ?? null, when };
  let approved = false;
  if (a.confirm.length && confirmToken) { const c = confirm.consume(confirmToken, op); approved = c.ok; }
  if (a.refuse.length && !a.go.length && !a.confirm.length) return { ok: false, text: a.refuse.map((r) => r.why).join(" ") };
  if (a.confirm.length && !approved) {
    const sk = surfaceKey({ surface, from });
    const leftNote = a.left.length ? ` I'll leave ${listWords(a.left.map((x) => x.d.name))} alone.` : "";
    const text = `${[...new Set(a.confirm.map((x) => x.why))].join(" ")}${leftNote} Should I ${verb(action, value)} ${a.confirm.length === 1 ? a.confirm[0].d.name : "them"} ${when.label}? Say yes to schedule it.`;
    const token = confirm.issue(op, { text, what: "devices schedule", surfaces: sk.startsWith("remote:") ? [sk] : OWNER_SURFACES });
    pendingBySurface.set(sk, { token, o: { when, sched: { ids, label, action, value, when, surface, from, scope, exact } }, at: Date.now(), text });
    return { ok: false, needsConfirm: true, confirmToken: token, text };
  }
  const keep = [...a.go, ...(approved ? a.confirm.map((x) => x.d) : [])];
  if (!keep.length) return { ok: false, text: "There's nothing I could schedule there." };
  const sch = { id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, ids: keep.map((d) => d.id), label: label ?? listWords(keep.map((d) => d.name)), action, value: value ?? null,
    ...(when.daily ? { daily: when.daily, days: when.days } : { at: when.at }), whenLabel: when.label, approved, from: from?.id ?? "local", created: new Date().toISOString(), ...(tag ? { tag } : {}) };
  registry.load().schedules.push(sch); registry.save();
  log("device.scheduled", { schedule: sch.id, devices: sch.ids, action, when: when.label, from: sch.from });
  deps.broadcast("devices", { schedules: true });
  const leftNote = a.left.length ? ` (${listWords(a.left.map((x) => x.d.name))} will be left alone.)` : "";
  return { ok: true, schedule: sch, text: tag ? "" : `Okay: I'll ${verb(action, value)} ${sch.label} ${when.label}.${leftNote}` };
}
export function listSchedules() { return registry.schedules().filter((s) => !s.tag || s.tag === "autooff"); }
export function cancelSchedule(match) {
  const d = registry.load();
  const before = d.schedules.length;
  if (match === "all") d.schedules = d.schedules.filter((s) => s.tag);
  else { const k = nameKey(match ?? ""); d.schedules = d.schedules.filter((s) => !(s.id === match || nameKey(s.label).includes(k) || s.ids.some((id) => namesOf(registry.device(id) ?? { name: id }).includes(k)))); }
  const n = before - d.schedules.length; if (n) { registry.save(); deps.broadcast("devices", { schedules: true }); }
  return n;
}
function addAutoOff(d) { addSchedule({ ids: [d.id], label: d.name, action: "off", when: { at: new Date(Date.now() + d.autoOffMinutes * 60_000).toISOString(), label: `in ${d.autoOffMinutes} minutes` }, tag: "autooff" }).catch(() => {}); }
function addOpenAlert(d) { registry.load().schedules.push({ id: `a${Date.now().toString(36)}`, ids: [d.id], label: d.name, action: "check-open", at: new Date(Date.now() + d.alertOpenMinutes * 60_000).toISOString(), tag: "openalert" }); registry.save(); }
const HM = (t) => `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
export async function tick(nowD = new Date()) {
  if (!gate.on("devices")) return [];
  const d = registry.load(), fired = [];
  for (const s of [...d.schedules]) {
    let due = false;
    if (s.at) due = Date.parse(s.at) <= nowD.getTime();
    else if (s.daily) due = HM(nowD) === s.daily && (!s.days || s.days.includes(nowD.getDay())) && s.lastRun !== nowD.toDateString();
    if (!due) continue;
    if (s.at) d.schedules = d.schedules.filter((x) => x.id !== s.id); else s.lastRun = nowD.toDateString();
    registry.save();
    if (s.action === "check-open") {
      const dev = registry.device(s.ids[0]); if (!dev) continue;
      const st = await status(dev).catch(() => null);
      if (st?.open === "open" || (st?.on && dev.type === "garage")) deps.announce({ kind: "reminder", text: `${dev.name} is still open.`, device: dev.id });
      continue;
    }
    const r = await control({ ids: s.ids, action: s.action, value: s.value, surface: "schedule", from: { id: "local" }, scheduled: true, preApproved: Boolean(s.approved || s.tag), exact: true }).catch((e) => ({ ok: false, text: e.message }));
    fired.push({ id: s.id, ...r });
    if (!s.tag || r.left?.length || r.refused?.length || r.failed?.length) deps.announce({ kind: "reminder", text: s.tag === "autooff" ? `Auto-off: ${r.text}` : `Scheduled: ${r.text}` });
  }
  return fired;
}

// ---- words in, words out ----------------------------------------------------------------------------------------------
function describeOne(st, d) {
  if (st.printer?.state && st.printer.state !== "offline") return `${d.name} is ${st.printer.state === "printing" ? `on and printing (${Math.round(st.printer.progress ?? 0)}%)` : `on (${st.printer.state})`}.`;
  if (st.reachable === false) return `I can't reach ${d.name} right now${st.error ? ` (${st.error.replace(/\.$/, "")})` : ""}.`;
  if (st.open) return `${d.name} is ${st.open}.`;
  if (st.locked !== undefined) return `${d.name} is ${st.locked ? "locked" : "unlocked"}.`;
  if (st.on === null) return st.unknown ? `${st.unknown}` : `I can't tell whether ${d.name} is on.`;
  const extra = [st.on && st.brightness != null ? `at ${st.brightness}%` : "", st.on && st.effect ? `on ${st.effect}` : "", st.watts != null ? `using ${st.watts} W` : ""].filter(Boolean).join(", ");
  return `${d.name} is ${st.on ? "on" : "off"}${extra ? ` (${extra})` : ""}.`;
}
// run(): the one entry point (voice, the AI's tools through control(), and other Dayspring computers)
export async function run(command, o = {}) {
  if (!gate.on("devices")) return { ok: false, text: "Device control isn't turned on in this version of Dayspring." };
  const from = o.from && o.from.id && o.from.id !== "local" ? o.from : null;
  if (from && from.verified !== true) { log("blocked", { reason: "device-remote-unverified", from: from.id }); return { ok: false, refused: true, text: "That request didn't come from one of your verified Dayspring computers, so I ignored it." }; }
  const base = { surface: from ? `remote:${from.id}` : o.surface ?? "tv", from: from ?? undefined };
  if (from) log("device.remote", { from: from.id, name: from.name, command: typeof command === "string" ? command.slice(0, 200) : command });
  if (command && typeof command === "object" && !Array.isArray(command)) {
    if (command.answer !== undefined) {
      const said = String(command.answer);
      if (from) confirm.userSaid(said, { surface: base.surface });
      return (await answer(said, base)) ?? { ok: false, text: "There was nothing waiting for an answer." };
    }
    return control({ ...command, ...base, confirmToken: o.confirmToken ?? command.confirmToken });
  }
  const text = String(command ?? "");
  // the owner's yes or no, said on the computer the command came from, settles that computer's open questions
  if (from) confirm.userSaid(text, { surface: base.surface });
  // a yes, a no or a pick for a question we asked this surface
  if (hasPending(base)) { const an = await answer(text, base); if (an) return an; }
  // the printers ("pause printer 3", "how's the X1 doing?") go through their own rules, the same way
  const viaPrinters = async () => {
    try {
      const ps = await import("../printers/skills.mjs");
      const r = await ps.handle(text, { surface: base.surface, from: base.from });
      return r ? { ok: !/^(I don't|I can't|I couldn't|I won't|Which printer)/.test(r.reply), text: r.reply, openPage: r.openPage, needsConfirm: Boolean(r.listen), intent: r.intent } : null;
    } catch { return null; }
  };
  const NOT = { ok: false, notUnderstood: true, text: "I didn't catch which device, or what to do with it." };
  const p = parse(text);
  if (!p) return (await viaPrinters()) ?? NOT;
  const r = await runParsed(p, { ...base, confirmToken: o.confirmToken });
  if (r.unknown && !r.text) return (await viaPrinters()) ?? NOT;
  return r;
}
export async function runParsed(p, o) {
  if (p.kind === "control" || p.kind === "set") {
    if (p.bare && !p.scope && !resolve(p.target)) return { ok: false, unknown: true, text: "" };
    return control({ target: p.target, scope: p.scope, action: p.action, value: p.value, when: p.when, ...o });
  }
  if (p.kind === "scene") { const s = findScene(p.name); return s ? runScene(s, o) : { ok: false, unknown: true, text: "" }; }
  if (p.kind === "status") {
    const r = resolve(p.target);
    if (!r) return { ok: false, unknown: true, text: "" };
    if (r.kind === "ambiguous") return { ok: false, text: `Which one: ${listWords(r.candidates.map((d) => d.name))}?` };
    const sts = await Promise.all(r.devices.map((d) => status(d).then((s) => [d, s])));
    if (sts.length === 1) return { ok: true, text: describeOne(sts[0][1], sts[0][0]), status: sts[0][1] };
    const on = sts.filter(([, s]) => s.on).map(([d]) => d.name);
    return { ok: true, text: on.length ? `In ${r.label}, ${listWords(on)} ${on.length === 1 ? "is" : "are"} on; the rest are off.` : `Everything in ${r.label} is off.` };
  }
  if (p.kind === "whatson") {
    if (!registry.devices().length) return { ok: false, unknown: true, text: "" };
    const sts = await statusAll();
    const on = sts.filter((s) => s.on).map((s) => s.name), unknown = sts.filter((s) => s.on === null).map((s) => s.name);
    const dev = `${on.length ? `Devices on right now: ${listWords(on)}.` : "No devices are on right now."}${unknown.length ? ` I can't tell about ${listWords(unknown)}.` : ""}`;
    // "what's on right now?" is the schedule's question first: its answer comes first (the same words the schedule's own
    // answer uses, what's next included), then the devices. Only the device wording ("what devices are on", "is anything
    // still on", "what's turned on") is about the devices alone.
    const schedQ = !/\b(device|devices|things|stuff|lights|outlets|turned|switched|powered|anything|still)\b/.test(p.said ?? "");
    if (schedQ) {
      try {
        const st = await import("../store.mjs"), { sayTime } = await import("../intents/slots.mjs");
        const d = st.todayISO(), now = new Date(), hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const day = st.blocksBetween(d, d), cur = day.find((x) => x.start <= hm && hm < x.end), next = day.find((x) => x.start > hm);
        const sched = cur ? `Right now it's ${cur.title}, until ${sayTime(cur.end)}.${next ? ` Then ${next.title} at ${sayTime(next.start)}.` : ""}` : `Nothing is scheduled right now.${next ? ` Next is ${next.title} at ${sayTime(next.start)}.` : ""}`;
        return { ok: true, text: `${sched} ${dev}`, schedule: true };
      } catch { /* the devices answer is enough */ }
    }
    return { ok: true, text: dev };
  }
  if (p.kind === "list") {
    const ds = registry.devices();
    if (!ds.length) return { ok: true, text: "You haven't added any devices yet. Settings → Devices can find your smart plugs and strips.", openPage: "/smarthome.html?embed=1" };
    const byRoom = new Map(); for (const d of ds) { const k = d.room || "no room"; byRoom.set(k, [...(byRoom.get(k) ?? []), d.name]); }
    return { ok: true, text: [...byRoom].map(([r, n]) => `${r[0].toUpperCase() + r.slice(1)}: ${listWords(n)}`).join(". ") + ".", openPage: "/smarthome.html?embed=1" };
  }
  if (p.kind === "schedules") {
    const list = listSchedules();
    return { ok: true, text: list.length ? list.map((s) => `${verb(s.action, s.value)} ${s.label} ${s.whenLabel ?? (s.daily ? `every day at ${s.daily}` : new Date(s.at).toLocaleString())}`).join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : "No device schedules." };
  }
  if (p.kind === "cancelschedule") { const n = cancelSchedule(p.target); return n ? { ok: true, text: `Cancelled ${n} device schedule${n === 1 ? "" : "s"}.` } : { ok: false, unknown: true, text: "" }; }
  if (p.kind === "page") return { ok: true, text: "Here are your devices.", openPage: "/smarthome.html?embed=1" };
  return { ok: false, unknown: true, text: "" };
}

// ---- the page ---------------------------------------------------------------------------------------------------------
export async function overview() {
  const [sts, strips] = await Promise.all([statusAll(), stripsState()]);
  const byId = new Map(sts.map((s) => [s.id, s]));
  return {
    devices: registry.devices().map((d) => ({ id: d.id, name: d.name, type: d.type, icon: iconOf(d), room: d.room, group: d.group, aliases: d.aliases, class: safetyOf(d), guarded: guarded(d), critical: Boolean(d.critical), hostsDayspring: safety.isThisPC(d), permission: d.permission, effective: safety.effectivePermission(d), power: d.power, control: d.control, printer: d.printer, state: byId.get(d.id) ?? null })),
    strips, scenes: registry.scenes(), groups: registry.groups(), schedules: listSchedules(), rooms: registry.rooms(),
  };
}
let ticking = null;
export function start({ announce, broadcast, printerStatus, ownerName } = {}) {
  setDeps(Object.fromEntries(Object.entries({ announce, broadcast, printerStatus, ownerName }).filter(([, v]) => v)));
  if (ticking) return;
  ticking = setInterval(() => { if (gate.on("devices") && registry.schedules().length) tick().catch((e) => console.log(`devices: ${e.message}`)); }, 15_000);
  ticking.unref?.();
}
export function stop() { clearInterval(ticking); ticking = null; }
export { registry, parse, safety, adapters };
