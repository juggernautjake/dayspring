// Meross smart plugs and power strips (MSS425F / MSS425E strips, MSS110 / MSS210 plugs), on the local network.
// Each Meross device takes signed JSON at http://<ip>/config: sign = md5(messageId + key + timestamp), where the key is
// the one Meross gave your account (it's the same for all your devices; tools such as Home Assistant's "Meross LAN"
// integration show it). For advanced users: Kasa, Shelly and Tapo are simpler to set up.
// Channels: on a strip channel 0 is "all outlets", 1–3 are the outlets and 4 the USB ports; a plug is channel 0.
import { createHash, randomBytes } from "node:crypto";

export const meta = { id: "meross", label: "Meross (advanced)", kind: "strip", transports: ["lan"], offline: true, perOutlet: true, needs: ["host", "key"],
  hint: "The IP address and your Meross device key (shown by tools like Home Assistant's Meross LAN integration). Advanced: needs that key once." };

const md5 = (s) => createHash("md5").update(s).digest("hex");
export function message(method, namespace, payload, key = "", host = "") {
  const messageId = randomBytes(16).toString("hex"), timestamp = Math.floor(Date.now() / 1000);
  return { header: { from: `http://${host}/config`, messageId, method, namespace, payloadVersion: 1, sign: md5(messageId + key + timestamp), timestamp, triggerSrc: "Dayspring" }, payload };
}
export const signOk = (h, key = "") => md5(String(h.messageId) + key + String(h.timestamp)) === h.sign;
async function call(strip, method, namespace, payload, secret) {
  const res = await fetch(`http://${strip.host}${strip.port ? ":" + strip.port : ""}/config`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message(method, namespace, payload, secret?.key ?? "", strip.host)), signal: AbortSignal.timeout(5000) });
  const j = await res.json().catch(() => ({}));
  if (j.header?.method === "ERROR") throw Object.assign(new Error(`${strip.name ?? "The Meross device"} didn't accept the key.`), { code: "auth" });
  return j.payload ?? {};
}
const chanOf = (strip, outlet) => (strip.outlets > 1 ? outlet : 0);
export async function getState(strip, secret) {
  const p = await call(strip, "GET", "Appliance.System.All", {}, secret);
  const tx = p.all?.digest?.togglex ?? [];
  const byCh = new Map(tx.map((t) => [Number(t.channel), Number(t.onoff) === 1]));
  const on = []; for (let i = 1; i <= strip.outlets; i++) on.push(byCh.get(chanOf(strip, i)) ?? false);
  return { on, model: p.all?.system?.hardware?.type ?? strip.model ?? "", mac: p.all?.system?.hardware?.macAddress ?? "" };
}
export async function setOutlet(strip, outlet, on, secret) {
  await call(strip, "SET", "Appliance.Control.ToggleX", { togglex: { channel: chanOf(strip, outlet), onoff: on ? 1 : 0 } }, secret);
  return true;
}
// a Meross device answers an unsigned question with an ERROR message: enough to recognise one in a scan
export async function sniff(host, { port } = {}) {
  const res = await fetch(`http://${host}${port ? ":" + port : ""}/config`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message("GET", "Appliance.System.All", {}, "", host)), signal: AbortSignal.timeout(1500) });
  const j = await res.json().catch(() => null);
  if (!j?.header?.namespace?.startsWith?.("Appliance.")) return null;
  const hw = j.payload?.all?.system?.hardware;
  return { adapter: "meross", host, port, model: hw?.type ?? "Meross", name: "", mac: hw?.macAddress ?? "", outlets: /mss425/i.test(hw?.type ?? "") ? 3 : 1, needsLogin: j.header.method === "ERROR" };
}
export const probe = sniff;
