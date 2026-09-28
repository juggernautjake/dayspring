// ONVIF, the standard most IP cameras speak: finding cameras on the home network (WS-Discovery, only when the owner
// presses Discover), and asking a camera for its stream and snapshot addresses and the recordings on its SD card.
// A small SOAP client (no dependency): WS-Security UsernameToken with a password digest, namespace-agnostic parsing.
// (The "onvif" npm package does much more, but needs the full device handshake; this needs four calls.)
//   discover({ timeoutMs, to }) → [{ xaddr, host, port, name, hardware, scopes }]
//   profiles(dev) → [{ token, name, width, height }]  streamUri(dev, token)  snapshotUri(dev, token)
//   recordings(dev) → [{ token, source, from, to }]   replayUri(dev, token)
//   dev = { host, port, username, password, xaddr? }
import { createSocket } from "node:dgram";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { camFetch } from "./http-auth.mjs";

// ---- tiny XML helpers (local names, any namespace prefix) ----
const unesc = (s) => String(s ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
export function tags(xml, name) {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, "g");
  return [...String(xml ?? "").matchAll(re)].map((m) => ({ attrs: m[1] ?? "", body: m[2] ?? "" }));
}
export const text = (xml, name) => { const t = tags(xml, name)[0]; return t ? unesc(t.body.replace(/<[^>]+>/g, "").trim()) : null; };
const attr = (attrs, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs); return m ? unesc(m[1]) : null; };

// ---- WS-Discovery ----
export function probeMessage(id = randomUUID()) {
  return `<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:${id}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;
}
export function parseProbeMatch(xml) {
  const out = [];
  for (const pm of tags(xml, "ProbeMatch")) {
    const xaddrs = (text(pm.body, "XAddrs") ?? "").split(/\s+/).filter(Boolean);
    const scopes = (text(pm.body, "Scopes") ?? "").split(/\s+/).filter(Boolean);
    const scope = (k) => { const s = scopes.find((x) => x.includes(`/${k}/`)); return s ? decodeURIComponent(s.split(`/${k}/`)[1]) : null; };
    const xaddr = xaddrs.find((x) => !/\[|fe80/i.test(x)) ?? xaddrs[0];
    if (!xaddr) continue;
    let host = null, port = 80; try { const u = new URL(xaddr); host = u.hostname; port = Number(u.port) || 80; } catch { /* odd address */ }
    out.push({ xaddr, host, port, name: scope("name"), hardware: scope("hardware"), scopes });
  }
  return out;
}
// Sends one Probe (to the ONVIF multicast group, or to one address when "to" is given) and collects the answers.
export function discover({ timeoutMs = 3000, to = null } = {}) {
  return new Promise((resolve) => {
    const s = createSocket({ type: "udp4", reuseAddr: true });
    const found = new Map();
    const done = () => { try { s.close(); } catch { /* closed */ } resolve([...found.values()]); };
    s.on("message", (msg) => { for (const d of parseProbeMatch(msg.toString("utf8"))) if (!found.has(d.xaddr)) found.set(d.xaddr, d); });
    s.on("error", done);
    s.bind(0, () => {
      const buf = Buffer.from(probeMessage());
      const [host, port] = to ? [to.host, to.port ?? 3702] : ["239.255.255.250", 3702];
      try { if (!to) s.setMulticastTTL(1); } catch { /* fine */ }
      s.send(buf, port, host, () => {});
      setTimeout(done, timeoutMs);
    });
  });
}

// ---- SOAP with WS-Security ----
export function security(username, password, { nonce = randomBytes(16), created = new Date().toISOString() } = {}) {
  if (!username) return "";
  const digest = createHash("sha1").update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password ?? "")])).digest("base64");
  return `<s:Header><wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${esc(username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>`;
}
const NS = 'xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:trc="http://www.onvif.org/ver10/recording/wsdl" xmlns:trp="http://www.onvif.org/ver10/replay/wsdl"';
export async function soap(url, body, { username = "", password = "", timeoutMs = 10_000 } = {}) {
  const env = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope ${NS}>${security(username, password)}<s:Body>${body}</s:Body></s:Envelope>`;
  let r;
  try { r = await camFetch(url, { method: "POST", body: env, headers: { "content-type": "application/soap+xml; charset=utf-8" }, timeoutMs, maxBytes: 4e6, username, password }); }
  catch (e) {
    if (e.status === 400 || e.status === 500) throw new Error("The camera turned down the ONVIF request (often a wrong user name or password, or ONVIF is off in its settings).");
    throw e;
  }
  const xml = r.buf.toString("utf8");
  if (tags(xml, "Fault").length) {
    const reason = text(xml, "Text") ?? text(xml, "faultstring") ?? "ONVIF error";
    throw new Error(/auth|password|user|NotAuthorized/i.test(xml) ? "The camera didn't accept the ONVIF user name or password." : `The camera said: ${reason.slice(0, 160)}`);
  }
  return xml;
}

const devUrl = (d) => d.xaddr || `http://${d.host}:${d.port || 80}/onvif/device_service`;
const services = new Map();   // device url → { media, recording, replay, search } (asked once)
export async function servicesOf(d) {
  const u = devUrl(d);
  if (services.has(u)) return services.get(u);
  const xml = await soap(u, "<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>", d);
  const sect = (n) => { const t = tags(xml, n)[0]; return t ? text(t.body, "XAddr") : null; };
  // the camera may report an address that isn't reachable from here (a different interface): keep our host and port
  const fix = (x) => { if (!x) return null; try { const a = new URL(x), b = new URL(u); a.hostname = b.hostname; a.port = b.port; return a.href; } catch { return x; } };
  const out = { media: fix(sect("Media")) ?? u.replace(/device_service$/, "media_service"), recording: fix(sect("Recording")), replay: fix(sect("Replay")), search: fix(sect("Search")) };
  services.set(u, out);
  return out;
}
export const _clear = () => services.clear();

export async function profiles(d) {
  const { media } = await servicesOf(d);
  const xml = await soap(media, "<trt:GetProfiles/>", d);
  return tags(xml, "Profiles").map((p) => ({ token: attr(p.attrs, "token"), name: text(p.body, "Name"), width: Number(text(p.body, "Width")) || null, height: Number(text(p.body, "Height")) || null })).filter((p) => p.token);
}
export async function streamUri(d, token) {
  const { media } = await servicesOf(d);
  const xml = await soap(media, `<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>${esc(token)}</trt:ProfileToken></trt:GetStreamUri>`, d);
  return text(xml, "Uri");
}
export async function snapshotUri(d, token) {
  const { media } = await servicesOf(d);
  const xml = await soap(media, `<trt:GetSnapshotUri><trt:ProfileToken>${esc(token)}</trt:ProfileToken></trt:GetSnapshotUri>`, d);
  return text(xml, "Uri");
}
// Profile G: what the camera recorded on its own storage
export async function recordings(d) {
  const { recording } = await servicesOf(d);
  if (!recording) return [];
  const xml = await soap(recording, "<trc:GetRecordings/>", d);
  return tags(xml, "RecordingItem").map((r) => ({ token: text(r.body, "RecordingToken"), source: text(r.body, "Name") ?? text(r.body, "SourceId"),
    from: text(r.body, "DataFrom") ?? text(r.body, "EarliestRecording"), to: text(r.body, "DataTo") ?? text(r.body, "LatestRecording") })).filter((r) => r.token);
}
export async function replayUri(d, token) {
  const { replay } = await servicesOf(d);
  if (!replay) throw new Error("This camera doesn't offer playback over ONVIF.");
  const xml = await soap(replay, `<trp:GetReplayUri><trp:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trp:StreamSetup><trp:RecordingToken>${esc(token)}</trp:RecordingToken></trp:GetReplayUri>`, d);
  return text(xml, "Uri");
}
