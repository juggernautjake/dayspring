// TP-Link Kasa smart plugs and power strips, on the local network only (no cloud, works offline).
//   HS300 (6 outlets, each with its own power reading), KP303 / KP400 / EP40 / HS107 (2–3 outlets), HS103 / HS105 /
//   KP115 / EP10 plugs (1 outlet).
// The classic local protocol: JSON, "encrypted" with TP-Link's rolling XOR (key 171), over TCP 9999 with a 4-byte length
// in front (UDP 9999 without it, for discovery). Newer hardware versions that answer only with KLAP (TP-Link account
// login) are handled by ./klap.mjs, the same way Tapo is.
// Why not tplink-smarthome-api? It's a good library, but it speaks only the classic protocol, pulls in several packages,
// and the whole protocol is the thirty lines below; a local simulator tests exactly this code (scripts/qa/devices).
import { createConnection } from "node:net";
import { createSocket } from "node:dgram";
import * as klap from "./klap.mjs";

export const meta = { id: "kasa", label: "TP-Link Kasa", kind: "strip", transports: ["lan"], offline: true, perOutlet: true, needs: ["host"], optional: ["username", "password"],
  hint: "The plug's or strip's IP address (the Kasa app → device → ⚙ → Device info, or your router's list). Only newer hardware needs your TP-Link login." };

export function encrypt(str, { withLength = true } = {}) {
  const buf = Buffer.from(str, "utf8"), out = Buffer.alloc(buf.length + (withLength ? 4 : 0));
  if (withLength) out.writeUInt32BE(buf.length, 0);
  let key = 171;
  for (let i = 0; i < buf.length; i++) { key = key ^ buf[i]; out[i + (withLength ? 4 : 0)] = key; }
  return out;
}
export function decrypt(buf) {
  const out = Buffer.alloc(buf.length);
  let key = 171;
  for (let i = 0; i < buf.length; i++) { out[i] = key ^ buf[i]; key = buf[i]; }
  return out.toString("utf8");
}

// one request over TCP (a fresh connection each time: these devices close idle connections anyway)
export function send(host, port, obj, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host, port: port || 9999 });
    let buf = Buffer.alloc(0), need = null, done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(t); sock.destroy(); err ? reject(err) : resolve(val); };
    const t = setTimeout(() => finish(Object.assign(new Error(`No answer from the Kasa device at ${host}.`), { code: "timeout" })), timeoutMs);
    sock.on("connect", () => sock.write(encrypt(JSON.stringify(obj))));
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (need === null && buf.length >= 4) need = buf.readUInt32BE(0);
      if (need !== null && buf.length >= need + 4) { try { finish(null, JSON.parse(decrypt(buf.subarray(4, 4 + need)))); } catch (e) { finish(e); } }
    });
    sock.on("error", (e) => finish(Object.assign(new Error(`Couldn't reach the Kasa device at ${host} (${e.code ?? e.message}).`), { code: e.code })));
    sock.on("close", () => finish(new Error(`The Kasa device at ${host} closed the connection.`)));
  });
}

// the sysinfo, the same shape for plugs and strips: { model, alias, mac, deviceId, outlets: [{ id, name, on, watts? }] }
export function parseSysinfo(info = {}) {
  const children = Array.isArray(info.children) ? info.children : null;
  const dev = info.deviceId ?? info.device_id ?? "";
  const outlets = children
    ? children.map((c) => ({ id: String(c.id).length <= 2 ? dev + String(c.id) : String(c.id), name: c.alias ?? "", on: Number(c.state) === 1 }))
    : [{ id: null, name: info.alias ?? "", on: Number(info.relay_state) === 1 }];
  return { model: String(info.model ?? "").split("(")[0].trim(), alias: info.alias ?? "", mac: info.mac ?? info.mic_mac ?? "", deviceId: dev, outlets };
}
const creds = (secret) => ({ username: secret?.username ?? "", password: secret?.password ?? "" });
// Newer Kasa hardware (and firmware updates to some older models) closes port 9999 and speaks KLAP with the TP-Link
// login instead: try the classic protocol, then KLAP (v1, then v2) when a login is saved; remember what worked.
const klapHosts = new Map();   // host:port → version
async function classicOrKlap(strip, secret, obj) {
  const c = creds(secret);
  const key = `${strip.host}:${strip.port ?? 9999}`;
  const viaKlap = (v) => klap.request(strip.host, klapCall(obj), { version: v, ...c, port: strip.klapPort });
  if (strip.protocol === "klap" || klapHosts.has(key)) return viaKlap(klapHosts.get(key) ?? 1);
  try { return await send(strip.host, strip.port, obj); }
  catch (e) {
    if (!c.username || !c.password || e.code === "timeout") throw e;
    for (const v of [1, 2]) { try { const r = await viaKlap(v); klapHosts.set(key, v); return r; } catch (k) { if (k.code === "auth" || v === 2) throw k; } }
    throw e;
  }
}
// the classic JSON inside a KLAP session (Kasa KLAP devices take the same JSON)
const klapCall = (obj) => obj;

export async function getState(strip, secret) {
  const r = await classicOrKlap(strip, secret, { system: { get_sysinfo: {} }, emeter: { get_realtime: {} } });
  const info = parseSysinfo(r.system?.get_sysinfo);
  // HS300: each outlet's power reading needs its own question (only on request: slow on a busy network)
  return { on: info.outlets.map((o) => o.on), names: info.outlets.map((o) => o.name), childIds: info.outlets.map((o) => o.id), model: info.model, alias: info.alias, mac: info.mac,
    watts: r.emeter?.get_realtime ? [Number(r.emeter.get_realtime.power_mw ?? r.emeter.get_realtime.power * 1000) / 1000 || 0] : null };
}
export async function setOutlet(strip, outlet, on, secret) {
  const kids = strip.childIds?.length ? strip.childIds : (await getState(strip, secret)).childIds;
  const child = kids[outlet - 1];
  if (strip.outlets > 1 && !child) throw new Error(`Outlet ${outlet} isn't on ${strip.name}.`);
  const obj = { ...(child ? { context: { child_ids: [child] } } : {}), system: { set_relay_state: { state: on ? 1 : 0 } } };
  const r = await classicOrKlap(strip, secret, obj);
  const code = r.system?.set_relay_state?.err_code;
  if (code) throw new Error(`${strip.name} refused (error ${code}).`);
  return true;
}
// per-outlet power in watts (HS300, KP115)
export async function readPower(strip, secret) {
  const out = [];
  for (let i = 0; i < strip.outlets; i++) {
    const child = strip.childIds?.[i];
    const r = await classicOrKlap(strip, secret, { ...(child ? { context: { child_ids: [child] } } : {}), emeter: { get_realtime: {} } }).catch(() => null);
    const e = r?.emeter?.get_realtime;
    out.push(e ? Math.round(Number(e.power_mw != null ? e.power_mw / 1000 : e.power) * 10) / 10 : null);
  }
  return out;
}
export async function probe(host, { port } = {}) {
  const r = await send(host, port, { system: { get_sysinfo: {} } }, { timeoutMs: 2500 });
  const info = parseSysinfo(r.system?.get_sysinfo);
  return { adapter: "kasa", host, port: port && port !== 9999 ? port : undefined, model: info.model, name: info.alias, mac: info.mac, outlets: info.outlets.length, children: info.outlets.map((o) => o.name), childIds: info.outlets.map((o) => o.id) };
}

// Discovery: the sysinfo question as one UDP packet to the broadcast address; every Kasa device answers.
//   targets: [{ host, port }] (tests aim it at the simulator; the real scan uses 255.255.255.255:9999)
export function parseDiscovery(buf, rinfo) {
  try {
    const j = JSON.parse(decrypt(buf));
    const info = parseSysinfo(j.system?.get_sysinfo);
    if (!info.model && !info.alias) return null;
    return { adapter: "kasa", host: rinfo.address, port: rinfo.port !== 9999 ? rinfo.port : undefined, model: info.model, name: info.alias, mac: info.mac, outlets: info.outlets.length, children: info.outlets.map((o) => o.name), childIds: info.outlets.map((o) => o.id) };
  } catch { return null; }
}
export function discover({ targets = [{ host: "255.255.255.255", port: 9999 }], timeoutMs = 2500 } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    sock.on("message", (msg, rinfo) => { const d = parseDiscovery(msg, rinfo); if (d) found.set(`${d.host}:${rinfo.port}`, d); });
    sock.on("error", () => { try { sock.close(); } catch { /* closed */ } resolve([...found.values()]); });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* fine */ }
      const pkt = encrypt(JSON.stringify({ system: { get_sysinfo: {} } }), { withLength: false });
      for (const t of targets) sock.send(pkt, t.port ?? 9999, t.host);
      setTimeout(() => { try { sock.close(); } catch { /* closed */ } resolve([...found.values()]); }, timeoutMs);
    });
  });
}
