// Home Assistant: the smart home. Lights, switches, plugs, fans, thermostats, scenes, scripts, sensors, locks, garage
// doors, blinds — whatever the owner's Home Assistant controls. The owner pastes Home Assistant's address and a
// long-lived access token (their profile → Security). Kept in data/connectors/homeassistant.json.
// Safety: unlocking a lock, opening a garage door or gate, and disarming an alarm NEVER happen without the owner's
// explicit yes in that moment (the first call returns a question; only confirmed:true does it).
import * as store from "./store.mjs";

const cfg = () => store.load("homeassistant");
export const connected = () => Boolean(cfg().url && cfg().token);
export function status() { const s = cfg(); return { id: "homeassistant", connected: connected(), who: s.name || (s.url ? s.url.replace(/^https?:\/\//, "") : null) }; }
export function disconnect() { store.forget("homeassistant"); cache = null; return status(); }

async function call(method, path, body, c = cfg()) {
  if (!c.url || !c.token) throw Object.assign(new Error("Home Assistant isn't connected yet. Add it in Settings → Apps."), { code: "not_connected" });
  const res = await fetch(c.url.replace(/\/+$/, "") + "/api" + path, { method, headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) throw new Error("Home Assistant didn't accept the token. Make a new long-lived access token and paste it again.");
  if (!res.ok) throw await store.fail(res, "Home Assistant");
  const t = await res.text(); try { return JSON.parse(t); } catch { return t; }
}
export async function connect({ url, token } = {}) {
  let u = String(url ?? "").trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = "http://" + u;
  if (!/^https?:\/\/[^\s]+$/i.test(u)) throw new Error("Type your Home Assistant address, like http://homeassistant.local:8123");
  const tok = String(token ?? "").trim();
  if (tok.length < 40) throw new Error("Paste the long-lived access token from your Home Assistant profile (Security tab).");
  const c = { url: u, token: tok };
  let r;
  try { r = await call("GET", "/", null, c); }
  catch (e) { if (/fetch failed|ECONNREFUSED|ENOTFOUND|timeout/i.test(e.message)) throw new Error(`Couldn't reach Home Assistant at ${u}. Check the address and that this computer is on the same network.`); throw e; }
  if (!/API running/i.test(JSON.stringify(r))) throw new Error("That address answered, but it doesn't look like Home Assistant.");
  const conf = await call("GET", "/config", null, c).catch(() => ({}));
  store.save("homeassistant", { ...c, name: conf.location_name || null, at: Date.now() });
  cache = null;
  return status();
}

// ---- entities ----
let cache = null;   // { at, states }
export async function states() {
  if (cache && Date.now() - cache.at < 15_000) return cache.states;
  const s = await call("GET", "/states");
  cache = { at: Date.now(), states: s };
  return s;
}
const nameOf = (e) => e.attributes?.friendly_name || e.entity_id;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|my|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
const CONTROLLABLE = /^(light|switch|fan|cover|lock|climate|scene|script|media_player|input_boolean|alarm_control_panel|vacuum|humidifier|water_heater|button|automation)\./;
// the best entity for how someone says it ("kitchen lights", "garage door", "thermostat")
export async function find(name, { domains } = {}) {
  const q = norm(name); if (!q) return null;
  const words = q.split(" ");
  let best = null, score = 0;
  for (const e of await states()) {
    if (domains && !domains.some((d) => e.entity_id.startsWith(d + "."))) continue;
    const n = norm(nameOf(e)), id = norm(e.entity_id.replace(/[._]/g, " "));
    let s = n === q ? 100 : n.includes(q) ? 60 : 0;
    s += words.filter((w) => w.length > 1 && (n.includes(w) || id.includes(w))).length * 10;
    if (/lights?$/.test(q) && e.entity_id.startsWith("light.")) s += 8;
    if (/thermostat|temperature|heat|a\/?c\b|air/.test(q) && e.entity_id.startsWith("climate.")) s += 15;
    if (/garage/.test(q) && e.entity_id.startsWith("cover.")) s += 15;
    if (CONTROLLABLE.test(e.entity_id)) s += 1;
    if (s > score) { score = s; best = e; }
  }
  return score >= 10 ? best : null;
}
export async function list({ domain } = {}) {
  return (await states()).filter((e) => (!domain || e.entity_id.startsWith(domain + ".")) && !e.entity_id.startsWith("sun.") && !e.entity_id.startsWith("zone."))
    .map((e) => ({ id: e.entity_id, name: nameOf(e), state: e.state, unit: e.attributes?.unit_of_measurement ?? null })).slice(0, 200);
}
export function describe(e) {
  const d = e.entity_id.split(".")[0], n = nameOf(e), st = e.state, a = e.attributes ?? {};
  if (d === "cover") return `${n} is ${st}`;                                  // open / closed / opening
  if (d === "lock") return `${n} is ${st}`;                                   // locked / unlocked
  if (d === "climate") return `${n} is set to ${a.temperature ?? "?"}°${a.current_temperature != null ? `, and it's ${a.current_temperature}° now` : ""} (${st})`;
  if (d === "binary_sensor") return `${n}: ${st === "on" ? (a.device_class === "door" || a.device_class === "window" || a.device_class === "garage_door" ? "open" : a.device_class === "motion" ? "motion detected" : "on") : (a.device_class === "door" || a.device_class === "window" || a.device_class === "garage_door" ? "closed" : a.device_class === "motion" ? "no motion" : "off")}`;
  if (d === "sensor") return `${n}: ${st}${a.unit_of_measurement ? " " + a.unit_of_measurement : ""}`;
  return `${n} is ${st}`;
}
export async function state(name) { const e = await find(name); return e ? { id: e.entity_id, name: nameOf(e), state: e.state, text: describe(e) } : null; }
// For lib/devices (a device the owner linked to one exact entity): that entity's state, and one service call. The
// safety rules (confirming locks, garage doors, heat) are lib/devices' job before it calls these.
export async function entity(id) { const e = (await states()).find((x) => x.entity_id === id); return e ? { id: e.entity_id, name: nameOf(e), state: e.state, attributes: e.attributes ?? {} } : null; }
export async function service(domain, svc, data) { const r = await call("POST", `/services/${domain}/${svc}`, data); cache = null; return r; }

// ---- control ----
const SENSITIVE = (domain, service, e) => (domain === "lock" && service === "unlock") || (domain === "alarm_control_panel" && /disarm/.test(service))
  || (domain === "cover" && service === "open_cover" && /garage|gate/i.test(`${e.entity_id} ${nameOf(e)} ${e.attributes?.device_class ?? ""}`));
// action: on | off | toggle | open | close | lock | unlock | activate (scene/script) | set_temperature (value) | set_brightness (value %)
export async function control({ name, action, value, confirmed = false }) {
  const e = await find(name);
  if (!e) return { error: `I couldn't find “${name}” in Home Assistant.` };
  const domain = e.entity_id.split(".")[0], a = String(action ?? "").toLowerCase();
  let service, data = { entity_id: e.entity_id };
  if (a === "on" || a === "off" || a === "toggle") service = domain === "cover" ? (a === "on" ? "open_cover" : a === "off" ? "close_cover" : "toggle") : domain === "lock" ? (a === "on" ? "lock" : "unlock") : `turn_${a}`.replace("turn_toggle", "toggle");
  else if (a === "open") service = domain === "lock" ? "unlock" : "open_cover";
  else if (a === "close") service = domain === "lock" ? "lock" : "close_cover";
  else if (a === "lock" || a === "unlock") service = a;
  else if (a === "activate") service = domain === "scene" || domain === "script" ? "turn_on" : domain === "button" ? "press" : "turn_on";
  else if (a === "set_temperature") { service = "set_temperature"; data.temperature = Number(value); }
  else if (a === "set_brightness") { service = "turn_on"; data.brightness_pct = Math.max(1, Math.min(100, Number(value))); }
  else if (a === "disarm") service = "alarm_disarm";
  else return { error: `I don't know how to “${action}” that.` };
  if (domain === "climate" && a !== "set_temperature") service = a === "off" ? "turn_off" : "turn_on";
  if (SENSITIVE(domain, service, e) && !confirmed) return { needsConfirm: true, text: `Just to be sure: ${service === "unlock" ? "unlock" : service === "alarm_disarm" ? "disarm" : "open"} ${nameOf(e)}?` };
  await call("POST", `/services/${domain}/${service}`, data);
  cache = null;
  return { done: true, entity: e.entity_id, name: nameOf(e), service };
}
