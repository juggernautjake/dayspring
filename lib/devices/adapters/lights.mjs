// Devices with more than on and off: lights, LED strips, covers, locks, thermostats. Each speaks the capability model
// (lib/devices/model.mjs), so voice and the Devices page don't care which brand it is.
//   state:  { on, brightness (0–100), color: { r, g, b }, colortemp (kelvin), effect, effects: [..], open ("open" | "closed"
//             | "opening" | "closing"), locked, temperature, target, caps: [..] }
//   set(control, { action, value }): on · off · toggle · brightness (0–100) · color ({ r, g, b } or "red") · colortemp (K)
//             · effect (name) · open · close · lock · unlock · target (°)
//
//   WLED  (LED strip controllers, ESP32/ESP8266): its JSON API at http://<ip>/json, local, no login.
//   Hue   (Philips Hue bridge): the bridge's local API with an app key made by pressing the bridge's button once.
//   Home Assistant entities: light (brightness, colour, colour temperature, effects), cover (open/close), lock, climate,
//         switch, fan, input_boolean, media_player.
import { haMod } from "./ha-shared.mjs";

export const WLED = { id: "wled", label: "WLED (LED strips)", kind: "light", transports: ["lan"], offline: true, hint: "The WLED controller's IP address (the WLED app lists it)." };
export const HUE = { id: "hue", label: "Philips Hue bridge", kind: "light", transports: ["lan", "zigbee-via-bridge"], offline: true, hint: "Find the bridge, press its round button, then pair within 30 seconds." };
export const HA_ENTITY = { id: "homeassistant", label: "Home Assistant entity", kind: "entity", transports: ["lan", "zigbee-via-ha", "zwave-via-ha", "matter-via-ha", "ble-via-ha"], offline: true, hint: "Any Home Assistant light, cover, lock, thermostat or switch." };

export const NAMED_COLORS = { red: [255, 0, 0], orange: [255, 120, 0], yellow: [255, 210, 0], green: [0, 200, 40], teal: [0, 180, 160], cyan: [0, 220, 255], blue: [0, 60, 255], purple: [140, 0, 255], violet: [150, 60, 255], pink: [255, 80, 160], magenta: [255, 0, 200], white: [255, 255, 255], "warm white": [255, 190, 120], "cool white": [220, 235, 255], gold: [255, 180, 30], lime: [140, 255, 0], amber: [255, 150, 0] };
export function toRgb(v) {
  if (v && typeof v === "object" && "r" in v) return [v.r, v.g, v.b].map((x) => Math.max(0, Math.min(255, Math.round(Number(x) || 0))));
  const s = String(v ?? "").trim().toLowerCase();
  if (NAMED_COLORS[s]) return NAMED_COLORS[s];
  const m = /^#?([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  throw new Error(`I don't know the colour “${v}”.`);
}
const pct = (v) => Math.max(0, Math.min(100, Math.round(Number(v))));

// ---- WLED ---------------------------------------------------------------------------------------------------------
async function wled(ctl, path, body) {
  const res = await fetch(`http://${ctl.host}/json${path}`, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`The WLED controller answered ${res.status}.`);
  return res.json();
}
const effectsCache = new Map();
export const wledAdapter = {
  meta: WLED,
  async getState(ctl) {
    const st = await wled(ctl, "/state");
    let effects = effectsCache.get(ctl.host);
    if (!effects) { effects = await wled(ctl, "/effects").catch(() => []); effectsCache.set(ctl.host, effects); }
    const seg = st.seg?.[ctl.segment ?? 0] ?? st.seg?.[0] ?? {};
    const c = seg.col?.[0] ?? [255, 255, 255];
    return { on: Boolean(st.on), brightness: Math.round(((st.bri ?? 0) / 255) * 100), color: { r: c[0], g: c[1], b: c[2] }, effect: effects[seg.fx] ?? null, effects, caps: ["onoff", "brightness", "color", "effect"] };
  },
  async set(ctl, { action, value }) {
    const seg = { id: ctl.segment ?? 0 };
    const body = action === "on" ? { on: true } : action === "off" ? { on: false } : action === "toggle" ? { on: "t" }
      : action === "brightness" ? { on: pct(value) > 0, bri: Math.round((pct(value) / 100) * 255) }
      : action === "color" ? { on: true, seg: [{ ...seg, col: [toRgb(value)], fx: 0 }] }
      : action === "effect" ? await (async () => { const list = effectsCache.get(ctl.host) ?? await wled(ctl, "/effects"); effectsCache.set(ctl.host, list); const i = list.findIndex((e) => e.toLowerCase() === String(value).toLowerCase()) >= 0 ? list.findIndex((e) => e.toLowerCase() === String(value).toLowerCase()) : list.findIndex((e) => e.toLowerCase().includes(String(value).toLowerCase())); if (i < 0) throw new Error(`WLED has no effect called “${value}”.`); return { on: true, seg: [{ ...seg, fx: i }] }; })()
      : null;
    if (!body) throw new Error(`WLED can't “${action}”.`);
    await wled(ctl, "/state", body);
    return true;
  },
  async probe(host) { const i = await wled({ host }, "/info"); if (!i?.ver || !i.leds) return null; return { adapter: "wled", host, model: `WLED ${i.ver ?? ""}`.trim(), name: i.name ?? "", mac: i.mac ?? "", leds: i.leds?.count ?? null }; },
};

// ---- Hue ------------------------------------------------------------------------------------------------------------
async function hue(bridge, key, path, method = "GET", body) {
  const res = await fetch(`http://${bridge.host}/api/${key}${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  const j = await res.json().catch(() => null);
  const err = Array.isArray(j) ? j.find((x) => x.error)?.error : null;
  if (err) throw Object.assign(new Error(err.type === 1 ? "The Hue bridge doesn't know Dayspring yet: pair it again in Settings → Devices." : `The Hue bridge said: ${err.description}`), { code: err.type === 1 ? "auth" : "hue" });
  return j;
}
// pairing: press the bridge's button, then this within 30 seconds
export async function huePair(host) {
  const res = await fetch(`http://${host}/api`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ devicetype: "dayspring#home" }), signal: AbortSignal.timeout(5000) });
  const j = await res.json();
  const ok = j?.[0]?.success?.username, err = j?.[0]?.error;
  if (ok) return { key: ok };
  if (err?.type === 101) throw Object.assign(new Error("Press the round button on the Hue bridge, then try again within 30 seconds."), { code: "button" });
  throw new Error(err?.description ?? "The Hue bridge didn't answer as expected.");
}
// xy (CIE) ↔ rgb, Philips' own formulas (good enough for "make it blue")
function rgbToXy([r, g, b]) {
  const f = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  const X = R * 0.664511 + G * 0.154324 + B * 0.162028, Y = R * 0.283881 + G * 0.668433 + B * 0.047685, Z = R * 0.000088 + G * 0.07231 + B * 0.986039;
  const s = X + Y + Z || 1;
  return [Number((X / s).toFixed(4)), Number((Y / s).toFixed(4))];
}
function xyToRgb([x, y], bri = 254) {
  const z = 1 - x - y, Y = bri / 254, X = (Y / (y || 1e-6)) * x, Z = (Y / (y || 1e-6)) * z;
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038, g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152, b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  [r, g, b] = [r, g, b].map((c) => Math.max(0, gam(c)));
  const m = Math.max(r, g, b, 1);
  return { r: Math.round((r / m) * 255), g: Math.round((g / m) * 255), b: Math.round((b / m) * 255) };
}
export const hueAdapter = {
  meta: HUE,
  async getState(ctl, secret, bridge) {
    const path = ctl.kind === "group" ? `/groups/${ctl.light}` : `/lights/${ctl.light}`;
    const j = await hue(bridge, secret?.key ?? "", path);
    const s = ctl.kind === "group" ? { ...(j.action ?? {}), on: j.state?.any_on ?? j.action?.on } : j.state ?? {};
    const caps = ["onoff"]; if (s.bri != null) caps.push("brightness"); if (s.xy) caps.push("color"); if (s.ct != null) caps.push("colortemp");
    return { on: Boolean(s.on), brightness: s.bri != null ? Math.round((s.bri / 254) * 100) : null, color: s.xy ? xyToRgb(s.xy, s.bri ?? 254) : null, colortemp: s.ct ? Math.round(1e6 / s.ct) : null, reachable: s.reachable !== false, caps };
  },
  async set(ctl, { action, value }, secret, bridge) {
    const path = ctl.kind === "group" ? `/groups/${ctl.light}/action` : `/lights/${ctl.light}/state`;
    const body = action === "on" ? { on: true } : action === "off" ? { on: false }
      : action === "brightness" ? (pct(value) === 0 ? { on: false } : { on: true, bri: Math.max(1, Math.round((pct(value) / 100) * 254)) })
      : action === "color" ? { on: true, xy: rgbToXy(toRgb(value)) }
      : action === "colortemp" ? { on: true, ct: Math.max(153, Math.min(500, Math.round(1e6 / Math.max(2000, Math.min(6500, Number(value) || 2700))))) }
      : action === "toggle" ? { on: !(await this.getState(ctl, secret, bridge)).on } : null;
    if (!body) throw new Error(`Hue lights can't “${action}”.`);
    await hue(bridge, secret?.key ?? "", path, "PUT", body);
    return true;
  },
  async lights(bridge, secret) {
    const [l, g] = await Promise.all([hue(bridge, secret?.key ?? "", "/lights"), hue(bridge, secret?.key ?? "", "/groups").catch(() => ({}))]);
    return [...Object.entries(l ?? {}).map(([id, x]) => ({ id, kind: "light", name: x.name, type: x.type })), ...Object.entries(g ?? {}).map(([id, x]) => ({ id, kind: "group", name: x.name, type: x.type }))];
  },
};

// ---- Home Assistant entities, mapped to capabilities ------------------------------------------------------------------
const HA_CAPS = { light: ["onoff"], switch: ["onoff"], fan: ["onoff"], input_boolean: ["onoff"], media_player: ["onoff"], cover: ["openclose"], lock: ["lock"], climate: ["onoff", "temperature"], humidifier: ["onoff"] };
export const haEntityAdapter = {
  meta: HA_ENTITY,
  async getState(ctl) {
    const h = await haMod();
    if (!h.connected()) throw new Error("Home Assistant isn't connected.");
    const e = await h.entity(ctl.entity);
    if (!e) throw new Error(`Home Assistant has no ${ctl.entity}.`);
    const d = ctl.entity.split("."), a = e.attributes ?? {}, caps = [...(HA_CAPS[d[0]] ?? ["onoff"])];
    const modes = a.supported_color_modes ?? [];
    if (d[0] === "light") { if (modes.some((m) => m !== "onoff")) caps.push("brightness"); if (modes.some((m) => /rgb|hs|xy/.test(m))) caps.push("color"); if (modes.includes("color_temp")) caps.push("colortemp"); if (a.effect_list?.length) caps.push("effect"); }
    const rgb = a.rgb_color;
    return { on: e.state === "on" || e.state === "open" || e.state === "unlocked" || e.state === "heat" || e.state === "cool" || e.state === "playing", state: e.state,
      brightness: a.brightness != null ? Math.round((a.brightness / 255) * 100) : null, color: rgb ? { r: rgb[0], g: rgb[1], b: rgb[2] } : null, colortemp: a.color_temp_kelvin ?? null,
      effect: a.effect ?? null, effects: a.effect_list ?? [], open: d[0] === "cover" ? e.state : undefined, locked: d[0] === "lock" ? e.state === "locked" : undefined,
      temperature: a.current_temperature ?? null, target: a.temperature ?? null, caps };
  },
  async set(ctl, { action, value }) {
    const h = await haMod();
    const [domain] = ctl.entity.split("."), data = { entity_id: ctl.entity };
    let svc;
    if (action === "on" || action === "off" || action === "toggle") svc = domain === "cover" ? { on: "open_cover", off: "close_cover", toggle: "toggle" }[action] : domain === "lock" ? { on: "unlock", off: "lock" }[action] ?? null : `turn_${action}`.replace("turn_toggle", "toggle");
    else if (action === "open" || action === "close") svc = domain === "lock" ? (action === "open" ? "unlock" : "lock") : `${action}_cover`;
    else if (action === "lock" || action === "unlock") svc = action;
    else if (action === "brightness") { svc = "turn_on"; data.brightness_pct = pct(value); }
    else if (action === "color") { svc = "turn_on"; data.rgb_color = toRgb(value); }
    else if (action === "colortemp") { svc = "turn_on"; data.color_temp_kelvin = Math.round(Number(value) || 2700); }
    else if (action === "effect") { svc = "turn_on"; data.effect = String(value); }
    else if (action === "target") { svc = "set_temperature"; data.temperature = Number(value); }
    if (!svc) throw new Error(`Home Assistant's ${ctl.entity} can't “${action}”.`);
    await h.service(domain, svc, data);
    return true;
  },
};
