// Custom devices, no code needed: HTTP or MQTT commands for on, off and status, from a template or typed in.
// Any brand that takes a local web request or an MQTT message works this way (Tasmota, ESPHome, OpenBeken, Zigbee2MQTT,
// a Raspberry Pi relay, a webhook…). Home Assistant covers everything else.
//   strip.custom = { kind: "http", on: { method, url, body?, headers? }, off: {…}, status?: { method, url, path, onValue } }
//                | { kind: "mqtt", url: "mqtt://host:1883", username?, (password is a secret), on: { topic, payload },
//                    off: { topic, payload }, status?: { topic, path?, onValue } }
//   Placeholders: {host} {outlet} (1-based) {channel} (0-based) {name}. path: dots into the JSON answer ("relays.0.ison",
//   "POWER{outlet}"); onValue: what "on" looks like there (true, "ON", 1). Without a status, the last command is shown.
export const meta = { id: "custom", label: "Custom (HTTP or MQTT)", kind: "strip", transports: ["lan"], offline: true, perOutlet: true, needs: ["custom"],
  hint: "Pick a template (Tasmota, ESPHome, Zigbee2MQTT, Shelly Gen 1…) or type the commands. Works with anything that takes a local web request or MQTT message." };

export const TEMPLATES = {
  tasmota_http: { label: "Tasmota (HTTP)", custom: { kind: "http", on: { method: "GET", url: "http://{host}/cm?cmnd=Power{outlet}%20On" }, off: { method: "GET", url: "http://{host}/cm?cmnd=Power{outlet}%20Off" }, status: { method: "GET", url: "http://{host}/cm?cmnd=Power{outlet}", path: "POWER{outlet}|POWER", onValue: "ON" } } },
  tasmota_mqtt: { label: "Tasmota (MQTT)", custom: { kind: "mqtt", url: "mqtt://{broker}:1883", on: { topic: "cmnd/{name}/POWER{outlet}", payload: "ON" }, off: { topic: "cmnd/{name}/POWER{outlet}", payload: "OFF" }, status: { topic: "stat/{name}/POWER{outlet}", onValue: "ON" } } },
  esphome: { label: "ESPHome (web server)", custom: { kind: "http", on: { method: "POST", url: "http://{host}/switch/{name}/turn_on" }, off: { method: "POST", url: "http://{host}/switch/{name}/turn_off" }, status: { method: "GET", url: "http://{host}/switch/{name}", path: "value", onValue: true } } },
  zigbee2mqtt: { label: "Zigbee2MQTT plug", custom: { kind: "mqtt", url: "mqtt://{broker}:1883", on: { topic: "zigbee2mqtt/{name}/set", payload: "{\"state\":\"ON\"}" }, off: { topic: "zigbee2mqtt/{name}/set", payload: "{\"state\":\"OFF\"}" }, status: { topic: "zigbee2mqtt/{name}", path: "state", onValue: "ON" } } },
  shelly_gen1: { label: "Shelly Gen 1 (HTTP)", custom: { kind: "http", on: { method: "GET", url: "http://{host}/relay/{channel}?turn=on" }, off: { method: "GET", url: "http://{host}/relay/{channel}?turn=off" }, status: { method: "GET", url: "http://{host}/relay/{channel}", path: "ison", onValue: true } } },
  webhook: { label: "Webhooks (IFTTT, Home Assistant, Node-RED…)", custom: { kind: "http", on: { method: "POST", url: "" }, off: { method: "POST", url: "" } } },
};

export function fill(s, vars) { return String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m)); }
export function pick(obj, path) {
  for (const alt of String(path ?? "").split("|")) {
    let v = obj;
    for (const k of alt.split(".").filter(Boolean)) v = v == null ? undefined : v[k];
    if (v !== undefined) return v;
  }
  return undefined;
}
const same = (v, want) => (typeof want === "boolean" ? v === want || v === (want ? "true" : "false") || v === (want ? 1 : 0) : String(v).toLowerCase() === String(want).toLowerCase());
const varsFor = (strip, outlet, secret) => ({ host: strip.host ?? "", broker: strip.host ?? "", outlet: strip.outlets > 1 ? outlet : (strip.custom?.single ?? ""), channel: outlet - 1, name: (strip.outletNames?.[outlet - 1] || strip.custom?.name || strip.name || "").replace(/\s+/g, "_"), token: secret?.token ?? "" });
const lastSent = new Map();

async function http(req, vars, secret) {
  const url = fill(req.url, vars);
  if (!/^https?:\/\//i.test(url)) throw new Error("That custom device's address isn't a web link yet.");
  const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k, fill(v, vars)]));
  if (secret?.password && !headers.authorization) headers.authorization = "Basic " + Buffer.from(`${secret.username ?? "admin"}:${secret.password}`).toString("base64");
  if (secret?.token && !headers.authorization) headers.authorization = `Bearer ${secret.token}`;
  const body = req.body != null && req.method !== "GET" ? fill(typeof req.body === "string" ? req.body : JSON.stringify(req.body), vars) : undefined;
  if (body && !headers["content-type"]) headers["content-type"] = /^\s*[{[]/.test(body) ? "application/json" : "text/plain";
  const res = await fetch(url, { method: req.method || "GET", headers, body, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`The custom device answered ${res.status}.`);
  const t = await res.text(); try { return JSON.parse(t); } catch { return t; }
}
// MQTT: one connection per broker, kept open (mqtt.js reconnects by itself)
const brokers = new Map();
async function broker(url, secret) {
  const key = `${url}|${secret?.username ?? ""}`;
  if (brokers.has(key)) return brokers.get(key);
  const mqtt = await import("mqtt");
  const p = new Promise((resolve, reject) => {
    const c = mqtt.connect(url, { username: secret?.username || undefined, password: secret?.password || undefined, reconnectPeriod: 5000, connectTimeout: 5000, clientId: "dayspring-" + Math.random().toString(16).slice(2, 10) });
    c.retained = new Map();
    c.on("message", (topic, payload) => c.retained.set(topic, payload.toString()));
    c.once("connect", () => resolve(c));
    c.once("error", (e) => { brokers.delete(key); try { c.end(true); } catch { /* closed */ } reject(new Error(`Couldn't reach the MQTT broker (${e.message}).`)); });
  });
  brokers.set(key, p);
  return p;
}
export function closeAll() { for (const p of brokers.values()) p.then((c) => c.end(true)).catch(() => {}); brokers.clear(); }

export async function setOutlet(strip, outlet, on, secret) {
  const c = strip.custom ?? {}, vars = varsFor(strip, outlet, secret), req = on ? c.on : c.off;
  if (!req) throw new Error(`${strip.name} has no “${on ? "on" : "off"}” command set up.`);
  if (c.kind === "mqtt") {
    const cl = await broker(fill(c.url, vars), secret);
    await new Promise((res, rej) => cl.publish(fill(req.topic, vars), fill(req.payload, vars), { qos: 0 }, (e) => (e ? rej(e) : res())));
  } else await http(req, vars, secret);
  lastSent.set(`${strip.id}:${outlet}`, on);
  return true;
}
export async function getState(strip, secret) {
  const c = strip.custom ?? {}, on = [];
  for (let i = 1; i <= strip.outlets; i++) {
    const vars = varsFor(strip, i, secret);
    let v = lastSent.get(`${strip.id}:${i}`) ?? null;
    if (c.status) {
      try {
        if (c.kind === "mqtt") {
          const cl = await broker(fill(c.url, vars), secret), topic = fill(c.status.topic, vars);
          if (!cl.subscribed?.has(topic)) { (cl.subscribed ??= new Set()).add(topic); cl.subscribe(topic); await new Promise((r) => setTimeout(r, 300)); }
          const raw = cl.retained.get(topic);
          if (raw !== undefined) { let j = raw; try { j = JSON.parse(raw); } catch { /* plain text */ } const got = c.status.path ? pick(j, fill(c.status.path, vars)) : j; v = same(got, c.status.onValue ?? "ON"); }
        } else {
          const r = await http(c.status, vars, secret);
          const got = c.status.path ? pick(r, fill(c.status.path, vars)) : r;
          v = same(typeof got === "string" ? got.trim() : got, c.status.onValue ?? true);
        }
      } catch (e) { if (i === 1) throw e; }
    }
    on.push(v);
  }
  return { on };
}
export async function probe() { return null; }
