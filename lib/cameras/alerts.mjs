// Camera alerts: which events tell the owner, how, and when.
//   rules per camera (Settings → Cameras): which labels alert (person, deer, animal, vehicle, package, motion, or the
//     camera's own question matching), quiet hours (alerts wait and come out as one summary after: "3 deer visits
//     overnight"), labels that are urgent even in quiet hours, and a cooldown (the same thing again within N minutes
//     isn't a new alert; it's counted into the next summary).
//   delivery: the Dayspring screen (a card with the picture) and a spoken line, through the announcement path, so it
//     waits while the owner is talking and follows Quiet/Off and the notification modes (lib/floor.mjs, lib/quiet.mjs);
//     his phone by text when Dayspring has a phone path (lib/notify.mjs) and the camera allows it; and every other device
//     through onAlert() listeners (the multi-device feature plugs in there; lib/cameras/hooks.mjs) and a "camera-alert"
//     event on the bus.
//   consider(event, cam) → { send, reason, text } · deliver(alert) · tick() · summary({ cam, since, label }) · inQuiet(q, date)
import * as events from "./events.mjs";
import * as state from "./state.mjs";
import { isAnimal } from "./analyze.mjs";

let deps = {
  now: () => new Date(),
  announce: async (item) => (await import("../announcer.mjs")).announce(item),
  broadcast: async (type, data) => (await import("../bus.mjs")).broadcast(type, data),
  phone: async (text) => { const n = await import("../notify.mjs"); if (!n.notifyReady().canSend) return { sent: false, why: "no phone path" }; await n.deliver(text); return { sent: true }; },
  sinks: () => [],
};
export function setDeps(d) { deps = { ...deps, ...d }; }

const toMin = (hm) => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + m; };
export function inQuiet(q, d = deps.now()) {
  if (!q?.from || !q?.to) return false;
  const now = d.getHours() * 60 + d.getMinutes(), a = toMin(q.from), b = toMin(q.to);
  return a === b ? false : a < b ? now >= a && now < b : now >= a || now < b;     // over midnight: 22:00–06:00
}
const MIN_CONF = 0.5;
// the event's labels that the rule list wants
export function wanted(evLabels = [], rule = []) {
  const want = new Set(rule.map((x) => String(x).toLowerCase()));
  const out = [];
  for (const l of evLabels) {
    if ((l.confidence ?? 1) < MIN_CONF && l.label !== "motion") continue;
    if (want.has(l.label) || (want.has("animal") && isAnimal(l.label)) || (l.raw && want.has(String(l.raw).toLowerCase()))) out.push(l.label);
  }
  return [...new Set(out)];
}
const a = (w) => (/^[aeiou]/.test(w) ? "an" : "a");
export function describe(ev, cam) {
  if (ev.summary) return `${cam.name}: ${ev.summary.replace(/\.$/, "")}.`;
  const ls = [...new Set((ev.labels ?? []).map((l) => l.label))].filter((x) => x !== "motion");
  if (!ls.length) return `${cam.name}: motion.`;
  return `${cam.name}: ${ls.map((l) => `${a(l)} ${l}`).join(" and ")}.`;
}

// Should this event alert now? (It's also where held and cooled-down events are counted for the summary.)
export function consider(ev, cam, { now = deps.now() } = {}) {
  const al = cam.alerts ?? {};
  if (!al.on) return { send: false, reason: "alerts off" };
  let hits = wanted(ev.labels, al.labels ?? []);
  if (ev.match) hits = [...new Set([...hits, "match"])];
  if (!hits.length) return { send: false, reason: "no alert label" };
  const t = now.getTime();
  const cool = state.get(cam.id, "cooldown", {});
  const fresh = hits.filter((h) => t - (cool[h] ?? 0) >= (al.cooldownMin ?? 10) * 60_000);
  const hold = () => { const held = state.get(cam.id, "held", []); held.push({ at: ev.at, labels: hits, id: ev.id }); state.set(cam.id, "held", held.slice(-500)); };
  if (!fresh.length) { hold(); return { send: false, reason: "cooldown", held: true }; }
  const urgent = fresh.some((h) => (al.urgent ?? []).includes(h));
  if (inQuiet(al.quiet, now) && !urgent) { hold(); return { send: false, reason: "quiet hours", held: true }; }
  for (const h of hits) cool[h] = t;
  state.set(cam.id, "cooldown", cool);
  return { send: true, reason: urgent && inQuiet(al.quiet, now) ? "urgent" : "rule", labels: fresh, text: describe(ev, cam) };
}

export async function deliver(alert, cam) {
  const ch = cam.alerts?.channels ?? {};
  const out = { screen: false, voice: false, phone: false, devices: 0 };
  const card = { id: alert.id ?? null, cam: cam.id, name: cam.name, text: alert.text, labels: alert.labels ?? [], thumb: alert.thumb ?? null, at: alert.at ?? deps.now().toISOString() };
  if (ch.screen !== false || ch.voice !== false) {
    // the announcement path: held while he talks, spoken or chimed as his settings say; "silent" = on the screen only
    await deps.announce({ kind: "camera", text: alert.text, ...(ch.voice === false ? { mode: "silent" } : {}), camera: card });
    out.screen = ch.screen !== false; out.voice = ch.voice !== false;
    if (ch.screen !== false) await deps.broadcast("camera-alert", card);          // the picture card (public/cameras-tv.js)
  }
  if (ch.phone) { try { out.phone = (await deps.phone(alert.text)).sent === true; } catch (e) { out.phoneError = e.message; } }
  if (ch.devices !== false) {
    await deps.broadcast("camera-alert-devices", card);                           // for the multi-device feature to pass on
    for (const fn of deps.sinks()) { try { await fn(card); out.devices++; } catch { /* one device failing doesn't stop the rest */ } }
  }
  return out;
}

// ---- summaries ----
const VISIT_GAP = 10 * 60_000;
// "3 deer visits, 1 person": events close together with the same label are one visit
export function countVisits(list) {
  const by = new Map();
  for (const e of [...list].sort((x, y) => String(x.at).localeCompare(String(y.at)))) {
    for (const l of new Set(e.labels ?? [])) {
      const k = typeof l === "string" ? l : l.label;
      const v = by.get(k) ?? { n: 0, last: 0 };
      const t = Date.parse(e.at);
      if (t - v.last > VISIT_GAP) v.n++;
      v.last = t; by.set(k, v);
    }
  }
  return [...by].map(([label, v]) => ({ label, n: v.n })).sort((x, y) => y.n - x.n);
}
const plural = (n, w) => (w === "deer" ? `${n} deer` : `${n} ${w}${n === 1 ? "" : w.endsWith("s") ? "es" : "s"}`);
export function visitsText(counts) {
  const parts = counts.filter((c) => c.label !== "motion" && c.label !== "match").map((c) => `${c.n} ${c.label === "person" ? (c.n === 1 ? "person" : "people") : c.label === "deer" ? "deer" : c.label} visit${c.n === 1 ? "" : "s"}`);
  const m = counts.find((c) => c.label === "motion");
  if (!parts.length && m) parts.push(`motion ${m.n === 1 ? "once" : `${m.n} times`}`);
  return parts.length ? parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] : "";
}
// what happened on a camera (or all of them) since a time: for "any activity on the trail cam?"
export function summary({ cam = null, since, until = null, label = null, cams = [] } = {}) {
  const list = events.list({ cam, from: since, to: until, label, kind: "event", limit: 1000 });
  const byCam = new Map();
  for (const e of list) { if (!byCam.has(e.cam)) byCam.set(e.cam, []); byCam.get(e.cam).push({ at: e.at, labels: (e.labels?.length ? e.labels.map((l) => l.label) : ["motion"]) }); }
  const name = (id) => cams.find((c) => c.id === id)?.name ?? id;
  const lines = [...byCam].map(([id, evs]) => ({ cam: id, name: name(id), count: evs.length, visits: countVisits(evs), text: visitsText(countVisits(evs)) }));
  return { events: list, cams: lines, text: lines.map((l) => `${l.name}: ${l.text || `${plural(l.count, "event")}`}`).join(". ") };
}

// Every minute: cameras whose quiet hours just ended say what they held, as one line.
export async function tick(cams) {
  const now = deps.now();
  for (const cam of cams) {
    const held = state.get(cam.id, "held", []);
    if (!held.length || inQuiet(cam.alerts?.quiet, now)) continue;
    // a cooldown's held events come out once the cooldown is over (and only as a summary)
    const lastHeld = Date.parse(held.at(-1).at) || 0;
    if (!cam.alerts?.quiet && now.getTime() - lastHeld < (cam.alerts?.cooldownMin ?? 10) * 60_000) continue;
    state.set(cam.id, "held", []);
    if (cam.alerts?.summary === false) continue;
    const words = visitsText(countVisits(held));
    if (!words) continue;
    const when = cam.alerts?.quiet && now.getHours() < 12 ? " overnight" : " while I waited";
    await deliver({ text: `${cam.name}: ${words}${when}.`, labels: [...new Set(held.flatMap((h) => h.labels))], at: now.toISOString(), summary: true }, { ...cam, alerts: { ...cam.alerts, channels: { ...cam.alerts?.channels, phone: false } } });
  }
}
