// Shelly relays and plugs, on the local network (HTTP; no cloud, works offline).
//   Gen 2/3/4 ("Plus", "Pro", "Gen3"): RPC over HTTP, /rpc/Switch.Set?id=0&on=true; Plus/Pro 4PM and Pro 4PM have four
//   channels, Plus 2PM two, Plus 1 / Plug S one. Password protection uses HTTP digest (SHA-256, user "admin").
//   Gen 1: /relay/0?turn=on, /status; password = HTTP basic.
// GET /shelly answers on every Shelly without a password, which is how discovery recognises one.
import { createHash, randomBytes } from "node:crypto";

export const meta = { id: "shelly", label: "Shelly", kind: "strip", transports: ["lan"], offline: true, perOutlet: true, needs: ["host"], optional: ["password"],
  hint: "The Shelly's IP address (the Shelly app → device → Settings → Device information). Only needed: the password if you set one." };

const sha = (s) => createHash("sha256").update(s).digest("hex");
const base = (strip) => `http://${strip.host}${strip.port ? ":" + strip.port : ""}`;
async function get(strip, path, secret, timeoutMs = 4000) {
  const url = base(strip) + path;
  let res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: strip.gen === 1 && secret?.password ? { authorization: "Basic " + Buffer.from(`${secret.username || "admin"}:${secret.password}`).toString("base64") } : {} });
  if (res.status === 401 && secret?.password && strip.gen !== 1) {
    const h = res.headers.get("www-authenticate") ?? "";
    const f = Object.fromEntries([...h.matchAll(/(\w+)="?([^",]+)"?/g)].map((m) => [m[1], m[2]]));
    const cnonce = randomBytes(8).toString("hex"), nc = "00000001", uri = path;
    const ha1 = sha(`admin:${f.realm}:${secret.password}`), ha2 = sha(`GET:${uri}`);
    const response = sha(`${ha1}:${f.nonce}:${nc}:${cnonce}:auth:${ha2}`);
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { authorization: `Digest username="admin", realm="${f.realm}", nonce="${f.nonce}", uri="${uri}", algorithm=SHA-256, response="${response}", qop=auth, nc=${nc}, cnonce="${cnonce}"` } });
  }
  if (res.status === 401) throw Object.assign(new Error(`${strip.name ?? "The Shelly"} needs its password (Settings → Devices).`), { code: "auth" });
  if (!res.ok) throw new Error(`${strip.name ?? "The Shelly"} answered ${res.status}.`);
  return res.json();
}
// which generation, and how many switches: from /shelly and the status
export async function probe(host, { port } = {}) {
  const s = { host, port };
  const info = await get(s, "/shelly", null, 2000);
  if (!info || (!info.mac && !info.id && !info.type)) return null;
  const gen = Number(info.gen) || 1;
  let outlets = 1;
  if (gen >= 2) {
    const st = await get({ ...s, gen }, "/rpc/Shelly.GetStatus", null, 2500).catch(() => null);
    outlets = st ? Object.keys(st).filter((k) => /^switch:\d+$/.test(k)).length || 1 : Number(info.num_outputs) || 1;
  } else outlets = Number(info.num_outputs) || 1;
  return { adapter: "shelly", host, port, gen, model: info.model ?? info.type ?? "Shelly", name: info.name ?? info.id ?? "", mac: info.mac ?? "", outlets, needsLogin: Boolean(info.auth_en ?? info.auth) };
}
const genOf = (strip) => strip.gen ?? (/^(SHSW|SHPLG|SHEM)/i.test(strip.model ?? "") ? 1 : 2);
export async function getState(strip, secret) {
  const gen = genOf(strip);
  if (gen === 1) {
    const st = await get({ ...strip, gen }, "/status", secret);
    return { on: (st.relays ?? []).map((r) => Boolean(r.ison)), watts: (st.meters ?? []).map((m) => m.power ?? null) };
  }
  const st = await get({ ...strip, gen }, "/rpc/Shelly.GetStatus", secret);
  const sw = Object.keys(st).filter((k) => /^switch:\d+$/.test(k)).sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1])).map((k) => st[k]);
  return { on: sw.map((x) => Boolean(x.output)), watts: sw.map((x) => (x.apower != null ? Number(x.apower) : null)) };
}
export async function setOutlet(strip, outlet, on, secret) {
  const gen = genOf(strip), i = outlet - 1;
  if (gen === 1) await get({ ...strip, gen }, `/relay/${i}?turn=${on ? "on" : "off"}`, secret);
  else await get({ ...strip, gen }, `/rpc/Switch.Set?id=${i}&on=${on ? "true" : "false"}`, secret);
  return true;
}
