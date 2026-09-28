// Simulated smart plugs and strips for the device tests. They listen on 127.0.0.1 only, on ports the system picks, and
// speak the real local protocols (the same bytes a real device sends), so the adapters are tested exactly as they'll run.
//   kasaSim({ outlets, model, alias })   TCP 9999-style JSON with the XOR cipher + a UDP discovery responder
//   shellySim({ gen, outlets, password }) HTTP: /shelly, Gen 2 RPC (digest auth when a password is set) or Gen 1 /relay
//   tapoSim({ username, password, outlets, model })  HTTP KLAP v2 handshake + encrypted requests (P300-style children)
//   merossSim({ key, outlets })          HTTP /config with signed messages
//   wledSim() · hueSim({ key })          lights
//   udpSink()                            catches a Wake-on-LAN packet
import { createServer as tcpServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { createSocket } from "node:dgram";
import { createHash, randomBytes } from "node:crypto";
import * as kasa from "../../../../lib/devices/adapters/kasa.mjs";
import * as klap from "../../../../lib/devices/adapters/klap.mjs";
import { signOk } from "../../../../lib/devices/adapters/meross.mjs";

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const body = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });

export async function kasaSim({ outlets = 6, model = "HS300(US)", alias = "TP-LINK_Power Strip_4F12", deviceId = "8006A8F1D3C2B4E5F60718293A4B5C6D7E8F9A0B" } = {}) {
  const children = Array.from({ length: outlets }, (_, i) => ({ id: String(i).padStart(2, "0"), state: 0, alias: `Plug ${i + 1}` }));
  const log = [];
  const sysinfo = () => outlets > 1 ? { sw_ver: "1.0.12", hw_ver: "2.0", model, deviceId, alias, mac: "50:C7:BF:00:11:22", child_num: outlets, children: children.map((c) => ({ ...c })), err_code: 0 }
    : { sw_ver: "1.0.12", hw_ver: "1.0", model, deviceId, alias, mac: "50:C7:BF:00:11:23", relay_state: children[0].state, err_code: 0 };
  const answer = (j) => {
    log.push(j);
    const out = {};
    if (j.system?.get_sysinfo) out.system = { get_sysinfo: sysinfo() };
    if (j.system?.set_relay_state) {
      const ids = j.context?.child_ids ?? [null];
      for (const id of ids) { const c = id ? children.find((x) => deviceId + x.id === id || x.id === id) : children[0]; if (!c) return { system: { set_relay_state: { err_code: -14, err_msg: "entry not exist" } } }; c.state = j.system.set_relay_state.state; }
      out.system = { set_relay_state: { err_code: 0 } };
    }
    if (j.emeter?.get_realtime) out.emeter = { get_realtime: { power_mw: 42100, voltage_mv: 120000, current_ma: 350, err_code: 0 } };
    return out;
  };
  const tcp = tcpServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); if (buf.length < 4) return; const n = buf.readUInt32BE(0); if (buf.length < n + 4) return; const j = JSON.parse(kasa.decrypt(buf.subarray(4, 4 + n))); buf = buf.subarray(4 + n); sock.write(kasa.encrypt(JSON.stringify(answer(j)))); });
    sock.on("error", () => {});
  });
  const port = await listen(tcp);
  const udp = createSocket("udp4");
  udp.on("message", (msg, r) => { try { const j = JSON.parse(kasa.decrypt(msg)); udp.send(kasa.encrypt(JSON.stringify(answer(j)), { withLength: false }), r.port, r.address); } catch { /* not ours */ } });
  const udpPort = await new Promise((r) => udp.bind(0, "127.0.0.1", () => r(udp.address().port)));
  return { port, udpPort, children, log, state: () => children.map((c) => c.state === 1), close: () => { tcp.close(); udp.close(); } };
}

export async function shellySim({ gen = 2, outlets = 4, password = null, model = "SNSW-104PM" } = {}) {
  const on = Array(outlets).fill(false), log = [];
  const realm = "shellypro4pm-aabbcc", nonce = Math.floor(Date.now() / 1000).toString();
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const authed = (req) => {
    if (!password) return true;
    const h = req.headers.authorization ?? "";
    if (gen === 1) return h === "Basic " + Buffer.from(`admin:${password}`).toString("base64");
    const f = Object.fromEntries([...h.matchAll(/(\w+)="?([^",]+)"?/g)].map((m) => [m[1], m[2]]));
    if (!/^Digest/.test(h) || f.nonce !== nonce) return false;
    const ha1 = sha(`admin:${realm}:${password}`), ha2 = sha(`GET:${f.uri}`);
    return f.response === sha(`${ha1}:${f.nonce}:${f.nc}:${f.cnonce}:auth:${ha2}`);
  };
  const srv = httpServer(async (req, res) => {
    const u = new URL(req.url, "http://x"); log.push(u.pathname + u.search);
    const json = (o, st = 200) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/shelly") return json(gen >= 2 ? { id: `shellypro4pm-aabbcc`, mac: "AABBCCDDEEFF", model, gen, fw_id: "1.4.2", app: "Pro4PM", auth_en: Boolean(password), name: "Office strip" } : { type: "SHSW-25", mac: "AABBCCDDEE00", auth: Boolean(password), fw: "1.14.0", num_outputs: outlets });
    if (!authed(req)) { res.writeHead(401, gen >= 2 ? { "www-authenticate": `Digest qop="auth", realm="${realm}", nonce="${nonce}", algorithm=SHA-256` } : { "www-authenticate": "Basic realm=\"shelly\"" }); return res.end(); }
    if (gen >= 2 && u.pathname === "/rpc/Shelly.GetStatus") return json(Object.fromEntries(on.map((v, i) => [`switch:${i}`, { id: i, output: v, apower: v ? 12.5 + i : 0 }])));
    if (gen >= 2 && u.pathname === "/rpc/Switch.Set") { const i = Number(u.searchParams.get("id")); if (!(i in on)) return json({ code: -105, message: "Argument 'id', value 9 not found!" }, 404); const was = on[i]; on[i] = u.searchParams.get("on") === "true"; return json({ was_on: was }); }
    if (gen === 1 && u.pathname === "/status") return json({ relays: on.map((v) => ({ ison: v })), meters: on.map((v) => ({ power: v ? 20 : 0 })) });
    let m;
    if (gen === 1 && (m = /^\/relay\/(\d+)$/.exec(u.pathname))) { const i = Number(m[1]); if (u.searchParams.get("turn")) on[i] = u.searchParams.get("turn") === "on"; return json({ ison: on[i] }); }
    json({ error: "not found" }, 404);
  });
  const port = await listen(srv);
  return { port, on, log, close: () => srv.close() };
}

// version 1 = newer Kasa hardware (KLAP v1 hashes, the classic Kasa JSON inside); 2 = Tapo
export async function tapoSim({ username = "owner@example.com", password = "tapo-pass-1", outlets = 3, model = "P300", version = 2 } = {}) {
  const auth = klap.authHash(username, password, version);
  const kasaRelay = [0];
  const kids = Array.from({ length: outlets }, (_, i) => ({ device_id: `80225D${String(i).padStart(34, "0")}`, nickname: Buffer.from(`Tapo outlet ${i + 1}`).toString("base64"), device_on: false, position: i + 1 }));
  const sessions = new Map(), log = [];
  const srv = httpServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), b = await body(req);
    if (u.pathname === "/app/handshake1") {
      const remote = randomBytes(16), sid = randomBytes(8).toString("hex");
      sessions.set(sid, { local: b, remote, ok: false });
      res.writeHead(200, { "set-cookie": `TP_SESSIONID=${sid};TIMEOUT=86400` });
      return res.end(Buffer.concat([remote, klap.serverHashOf(b, remote, auth, version)]));
    }
    const sid = /TP_SESSIONID=(\w+)/.exec(req.headers.cookie ?? "")?.[1], s = sessions.get(sid);
    if (!s) { res.writeHead(403); return res.end(); }
    if (u.pathname === "/app/handshake2") { if (!klap.clientProofOf(s.local, s.remote, auth, version).equals(b)) { res.writeHead(403); return res.end(); } s.ok = true; s.cipher = klap.sessionCipher(s.local, s.remote, auth); res.writeHead(200); return res.end(); }
    if (u.pathname === "/app/request" && s.ok) {
      const seq = Number(u.searchParams.get("seq"));
      let j; try { j = JSON.parse(s.cipher.open(b, seq)); } catch { res.writeHead(400); return res.end(); }
      log.push(j);
      // a Kasa device on KLAP: the classic JSON, answered as-is
      if (j.system) {
        if (j.system.set_relay_state) kasaRelay[0] = j.system.set_relay_state.state;
        const out = j.system.get_sysinfo ? { system: { get_sysinfo: { model: "KP125M(US)", alias: "Kettle plug", mac: "AA:BB:CC:00:00:01", deviceId: "KLAPKASA", relay_state: kasaRelay[0], err_code: 0 } } } : { system: { set_relay_state: { err_code: 0 } } };
        res.writeHead(200); return res.end(s.cipher.seal(JSON.stringify(out), seq));
      }
      let result = {};
      if (j.method === "get_device_info") result = { device_id: "80225D-parent", model, nickname: Buffer.from("Desk strip").toString("base64"), mac: "30-DE-4B-00-00-01", device_on: kids.some((k) => k.device_on) };
      else if (j.method === "get_child_device_list") result = { child_device_list: kids.map((k) => ({ ...k })), start_index: 0, sum: kids.length };
      else if (j.method === "control_child") { const k = kids.find((x) => x.device_id === j.params.device_id); if (!k) { res.writeHead(200); return res.end(s.cipher.seal(JSON.stringify({ error_code: -1001 }), seq)); } k.device_on = Boolean(j.params.requestData.params.device_on); }
      else if (j.method === "set_device_info") { for (const k of kids) k.device_on = Boolean(j.params.device_on); }
      res.writeHead(200); return res.end(s.cipher.seal(JSON.stringify({ error_code: 0, result }), seq));
    }
    res.writeHead(404); res.end();
  });
  const port = await listen(srv);
  return { port, kids, log, kasaRelay, state: () => kids.map((k) => k.device_on), close: () => srv.close() };
}

export async function merossSim({ key = "meross-key", outlets = 3 } = {}) {
  const ch = Array(outlets + 1).fill(0), log = [];
  const srv = httpServer(async (req, res) => {
    let j; try { j = JSON.parse((await body(req)).toString() || "{}"); } catch { res.writeHead(400); return res.end(); }
    log.push(j);
    const reply = (method, payload) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ header: { method, namespace: j.header?.namespace, messageId: j.header?.messageId }, payload })); };
    if (!signOk(j.header ?? {}, key)) return reply("ERROR", { error: { code: 5001, detail: "sign error" } });
    if (j.header.namespace === "Appliance.System.All") return reply("GETACK", { all: { system: { hardware: { type: "mss425f", macAddress: "48:e1:e9:00:00:01" } }, digest: { togglex: ch.map((v, i) => ({ channel: i, onoff: v })) } } });
    if (j.header.namespace === "Appliance.Control.ToggleX") { ch[j.payload.togglex.channel] = j.payload.togglex.onoff; return reply("SETACK", {}); }
    reply("ERROR", {});
  });
  const port = await listen(srv);
  return { port, ch, log, close: () => srv.close() };
}

export async function wledSim() {
  const st = { on: false, bri: 128, seg: [{ id: 0, col: [[255, 160, 80]], fx: 0 }] };
  const effects = ["Solid", "Blink", "Breathe", "Rainbow", "Fire 2012"];
  const srv = httpServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), json = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/json/info") return json({ ver: "0.14.4", name: "Desk LEDs", leds: { count: 60 }, mac: "a4cf12000001" });
    if (u.pathname === "/json/effects") return json(effects);
    if (u.pathname === "/json/state" && req.method === "POST") { const b = JSON.parse((await body(req)).toString()); if (b.on === "t") st.on = !st.on; else if (b.on !== undefined) st.on = b.on; if (b.bri !== undefined) st.bri = b.bri; for (const s of b.seg ?? []) Object.assign(st.seg[s.id ?? 0], s); return json({ success: true }); }
    if (u.pathname === "/json/state") return json(st);
    res.writeHead(404); res.end();
  });
  const port = await listen(srv);
  return { port, st, close: () => srv.close() };
}

export async function hueSim({ key = "hue-app-key" } = {}) {
  let buttonPressed = false;
  const lights = { 1: { name: "Bedroom lamp", type: "Extended color light", state: { on: false, bri: 100, xy: [0.4, 0.4], ct: 370, reachable: true } } };
  const srv = httpServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), json = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/api" && req.method === "POST") return json(buttonPressed ? [{ success: { username: key } }] : [{ error: { type: 101, address: "", description: "link button not pressed" } }]);
    const m = /^\/api\/([^/]+)(\/.*)?$/.exec(u.pathname);
    if (!m || m[1] !== key) return json([{ error: { type: 1, address: u.pathname, description: "unauthorized user" } }]);
    const path = m[2] ?? "";
    if (path === "/lights") return json(lights);
    if (path === "/groups") return json({});
    let x;
    if ((x = /^\/lights\/(\d+)$/.exec(path))) return json(lights[x[1]]);
    if ((x = /^\/lights\/(\d+)\/state$/.exec(path)) && req.method === "PUT") { Object.assign(lights[x[1]].state, JSON.parse((await body(req)).toString())); return json([{ success: {} }]); }
    json([{ error: { type: 3, description: "resource not available" } }]);
  });
  const port = await listen(srv);
  return { port, lights, press: () => { buttonPressed = true; }, close: () => srv.close() };
}

// a plain HTTP device for the custom (Tasmota-template) adapter
export async function tasmotaSim() {
  const power = { 1: "OFF", 2: "OFF" }, log = [];
  const srv = httpServer((req, res) => {
    const u = new URL(req.url, "http://x"); log.push(u.search);
    const c = decodeURIComponent(u.searchParams.get("cmnd") ?? ""); const m = /^Power(\d?)(?: (On|Off))?$/i.exec(c);
    if (!m) { res.writeHead(400); return res.end(); }
    const n = m[1] || "1"; if (m[2]) power[n] = m[2].toUpperCase();
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ [`POWER${m[1] || ""}`]: power[n] }));
  });
  const port = await listen(srv);
  return { port, power, log, close: () => srv.close() };
}

export function udpSink() {
  return new Promise((resolve) => {
    const s = createSocket("udp4"), got = [];
    s.on("message", (m) => got.push(m));
    s.bind(0, "127.0.0.1", () => resolve({ port: s.address().port, got, close: () => s.close() }));
  });
}
