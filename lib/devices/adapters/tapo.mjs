// TP-Link Tapo smart plugs and strips, on the local network (KLAP, ./klap.mjs). Works offline once set up; the device
// checks the TP-Link account email and password you use in the Tapo app.
//   P300 / P304M / P306 power strips (each outlet on its own), P100 / P105 / P110 / P115 / P125 plugs.
// Tapo names come back base64-encoded; outlets are the strip's "children", in the order printed on the strip.
import * as klap from "./klap.mjs";

export const meta = { id: "tapo", label: "TP-Link Tapo", kind: "strip", transports: ["lan"], offline: true, perOutlet: true, needs: ["host", "username", "password"],
  hint: "The IP address, and the email and password of your TP-Link (Tapo app) account: Tapo checks them even on your own network." };

const b64 = (s) => { try { return Buffer.from(String(s ?? ""), "base64").toString("utf8"); } catch { return String(s ?? ""); } };
const opts = (strip, secret) => ({ username: secret?.username ?? "", password: secret?.password ?? "", version: 2, port: strip.port });
async function children(strip, secret) {
  const r = await klap.request(strip.host, { method: "get_child_device_list", params: { start_index: 0 } }, opts(strip, secret));
  return (r.child_device_list ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
export async function getState(strip, secret) {
  const info = await klap.request(strip.host, { method: "get_device_info" }, opts(strip, secret));
  if (strip.outlets > 1 || /P30\d/i.test(info.model ?? strip.model ?? "")) {
    const kids = await children(strip, secret);
    return { on: kids.map((k) => Boolean(k.device_on)), names: kids.map((k) => b64(k.nickname)), childIds: kids.map((k) => k.device_id), model: info.model ?? "", alias: b64(info.nickname), mac: info.mac ?? "" };
  }
  return { on: [Boolean(info.device_on)], names: [b64(info.nickname)], childIds: [null], model: info.model ?? "", alias: b64(info.nickname), mac: info.mac ?? "" };
}
export async function setOutlet(strip, outlet, on, secret) {
  if (strip.outlets > 1) {
    const ids = strip.childIds?.length ? strip.childIds : (await children(strip, secret)).map((k) => k.device_id);
    const id = ids[outlet - 1];
    if (!id) throw new Error(`Outlet ${outlet} isn't on ${strip.name}.`);
    await klap.request(strip.host, { method: "control_child", params: { device_id: id, requestData: { method: "set_device_info", params: { device_on: Boolean(on) } } } }, opts(strip, secret));
  } else await klap.request(strip.host, { method: "set_device_info", params: { device_on: Boolean(on) } }, opts(strip, secret));
  return true;
}
export async function probe(host, { port, username, password } = {}) {
  const info = await klap.request(host, { method: "get_device_info" }, { username, password, version: 2, port });
  const multi = /P30\d/i.test(info.model ?? "");
  const kids = multi ? await klap.request(host, { method: "get_child_device_list", params: { start_index: 0 } }, { username, password, version: 2, port }).then((r) => r.child_device_list ?? []).catch(() => []) : [];
  return { adapter: "tapo", host, port, model: info.model ?? "", name: b64(info.nickname), mac: info.mac ?? "", outlets: multi ? kids.length : 1, children: kids.map((k) => b64(k.nickname)), childIds: kids.map((k) => k.device_id) };
}
// Without the login, a scan can still tell a KLAP device is there: its handshake answers 48 bytes to 16.
export async function sniff(host, { port } = {}) {
  const res = await fetch(`http://${host}${port ? ":" + port : ""}/app/handshake1`, { method: "POST", body: Buffer.alloc(16, 7), signal: AbortSignal.timeout(1500) });
  const buf = Buffer.from(await res.arrayBuffer());
  return res.status === 200 && buf.length === 48 ? { adapter: "tapo", host, port, model: "Tapo or newer Kasa (needs your TP-Link login)", name: "", needsLogin: true } : null;
}
