// Finding smart plugs, strips and lights on the home network, for the owner to name and assign (Settings → Devices →
// Find devices). Only ever when the owner asks; nothing is scanned in the background.
//   · Kasa: one UDP broadcast (port 9999); every Kasa plug and strip answers with its model and outlets.
//   · Shelly, WLED, Tapo/newer Kasa (KLAP), Meross: a quick look at each address on this computer's own network
//     (/24), at most 48 at a time, 1.5 s each. Tapo and Meross need the owner's login or key before they can be named.
//   discover({ hosts?, kasaTargets?, subnet?, timeoutMs }) → [{ adapter, host, port?, model, name, mac, outlets, known }]
// Tests pass `hosts` and `kasaTargets` (simulators on 127.0.0.1); with DAYSPRING_NO_LAN_SCAN=1 a scan without them refuses.
import { networkInterfaces } from "node:os";
import * as kasa from "./adapters/kasa.mjs";
import * as shelly from "./adapters/shelly.mjs";
import * as tapo from "./adapters/tapo.mjs";
import * as meross from "./adapters/meross.mjs";
import { wledAdapter } from "./adapters/lights.mjs";
import * as registry from "./registry.mjs";

export function localSubnets() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) {
    if (i.family !== "IPv4" || i.internal || /^169\.254\./.test(i.address)) continue;
    const p = i.address.split(".");
    out.push({ base: `${p[0]}.${p[1]}.${p[2]}`, self: i.address, broadcast: `${p[0]}.${p[1]}.${p[2]}.255` });
  }
  return [...new Map(out.map((s) => [s.base, s])).values()].slice(0, 2);
}
const split = (h) => { const m = /^(.+?)(?::(\d+))?$/.exec(String(h)); return { host: m[1], port: m[2] ? Number(m[2]) : undefined }; };
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const x = items[i++]; out.push(await fn(x).catch(() => null)); } })); return out.filter(Boolean); }

// what one address is (tries each kind; the first that answers wins)
export async function identify(h) {
  const { host, port } = split(h);
  for (const f of [(x) => shelly.probe(x, { port }), async (x) => { const r = await wledAdapter.probe(port ? `${x}:${port}` : x); return r ? { ...r, host: x, port } : null; }, (x) => tapo.sniff(x, { port }), (x) => meross.sniff(x, { port })]) {
    try { const r = await f(host); if (r) return r; } catch { /* not this kind */ }
  }
  return null;
}
export async function discover({ hosts = null, kasaTargets = null, timeoutMs = 2500, concurrency = 48 } = {}) {
  const explicit = Array.isArray(hosts) || Array.isArray(kasaTargets);
  if (!explicit && process.env.DAYSPRING_NO_LAN_SCAN === "1") throw new Error("Network scans are turned off here (tests).");
  const subnets = explicit ? [] : localSubnets();
  const kt = kasaTargets ?? subnets.map((s) => ({ host: s.broadcast, port: 9999 })).concat(explicit ? [] : [{ host: "255.255.255.255", port: 9999 }]);
  const list = hosts ?? subnets.flatMap((s) => Array.from({ length: 254 }, (_, i) => `${s.base}.${i + 1}`).filter((a) => a !== s.self));
  const [k, others] = await Promise.all([kt.length ? kasa.discover({ targets: kt, timeoutMs }) : [], pool(list, concurrency, identify)]);
  const seen = new Map();
  for (const d of [...k, ...others]) { const key = `${d.host}:${d.port ?? ""}`; if (!seen.has(key) || d.adapter === "kasa") seen.set(key, d); }
  const known = new Set(registry.strips().map((s) => `${s.host}:${s.port ?? ""}`));
  return [...seen.values()].map((d) => ({ ...d, known: known.has(`${d.host}:${d.port ?? ""}`) })).sort((a, b) => a.adapter.localeCompare(b.adapter) || a.host.localeCompare(b.host, undefined, { numeric: true }));
}
