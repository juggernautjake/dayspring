// /api/smarthome/*: the Devices page and Settings → Devices. (/api/devices is the speakers and microphones.)
// Local pages only (server.mjs refuses anything else), so a click here is the owner's own.
import * as devices from "./index.mjs";
import * as registry from "./registry.mjs";
import * as adapters from "./adapters/index.mjs";
import * as discovery from "./discovery.mjs";
import * as gate from "./gate.mjs";
import { TYPES, iconOf } from "./model.mjs";
import { TEMPLATES } from "./adapters/custom.mjs";
import { huePair, hueAdapter } from "./adapters/lights.mjs";
import * as permissions from "../permissions.mjs";
import * as activity from "../activity.mjs";
import * as confirm from "../confirm.mjs";
import { whenOf } from "./skills.mjs";

const stripOut = (s) => ({ ...s, hasSecret: registry.hasSecret(`strip:${s.id}`) });
export async function handle(req, res, { m, p, send, readJSON }) {
  if (!p.startsWith("/smarthome")) return false;
  if (!gate.on("devices")) { send(res, 404, { error: "Device control isn't turned on in this version of Dayspring." }); return true; }
  const body = async () => (m === "GET" ? {} : await readJSON(req).catch(() => ({})));
  let mm;
  try {
    if (m === "GET" && p === "/smarthome") return send(res, 200, { ...(await devices.overview()), permission: permissions.get().devices ?? "off", options: registry.options(), stripConfig: registry.strips().map(stripOut), hues: registry.load().hues.map((h) => ({ ...h, paired: registry.hasSecret(`hue:${h.id}`) })), types: Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, { label: t.label, icon: t.icon, safety: t.safety }])) }), true;
    // how much is set up (the Dayspring screen's 🏠 button): no device is asked anything
    if (m === "GET" && p === "/smarthome/summary") return send(res, 200, { devices: registry.devices().length, strips: registry.strips().length, scenes: registry.scenes().length }), true;
    if (m === "GET" && p === "/smarthome/catalog") return send(res, 200, { adapters: adapters.all(), recommended: adapters.RECOMMENDED, notRecommended: adapters.NOT_RECOMMENDED, templates: TEMPLATES }), true;
    if (m === "POST" && p === "/smarthome/permission") { const b = await body(); const r = permissions.set({ devices: b.devices, via: "settings-devices" }); return send(res, 200, { permission: r.devices }), true; }
    if (m === "POST" && p === "/smarthome/options") return send(res, 200, { options: registry.setOptions(await body()) }), true;
    if (m === "POST" && p === "/smarthome/device") { const d = registry.saveDevice(await body()); activity.log("settings.devices", { saved: d.id, name: d.name }); return send(res, 200, { device: { ...d, icon: iconOf(d) } }), true; }
    if (m === "DELETE" && (mm = p.match(/^\/smarthome\/device\/([\w-]+)$/))) return send(res, 200, { removed: registry.removeDevice(mm[1]) }), true;
    if (m === "POST" && p === "/smarthome/strip") { const b = await body(); const s = registry.saveStrip(b); devices._clearCache(); activity.log("settings.devices", { savedStrip: s.id, adapter: s.adapter }); return send(res, 200, { strip: stripOut(s) }), true; }
    if (m === "DELETE" && (mm = p.match(/^\/smarthome\/strip\/([\w-]+)$/))) return send(res, 200, { removed: registry.removeStrip(mm[1]) }), true;
    if (m === "POST" && p === "/smarthome/scene") return send(res, 200, { scene: registry.saveScene(await body()) }), true;
    if (m === "DELETE" && (mm = p.match(/^\/smarthome\/scene\/([\w-]+)$/))) return send(res, 200, { removed: registry.removeScene(mm[1]) }), true;
    if (m === "POST" && p === "/smarthome/group") return send(res, 200, { group: registry.saveGroup(await body()) }), true;
    if (m === "DELETE" && (mm = p.match(/^\/smarthome\/group\/([\w-]+)$/))) return send(res, 200, { removed: registry.removeGroup(mm[1]) }), true;
    // a toggle on the page: { ids, action, value, approve } (approve: the owner clicked "Yes, do it" on the question)
    if (m === "POST" && p === "/smarthome/control") {
      const b = await body();
      const o = { ids: Array.isArray(b.ids) ? b.ids : b.id ? [b.id] : undefined, target: b.target, action: b.action, value: b.value, surface: "tv", exact: true };
      return send(res, 200, b.approve && o.ids ? await devices.controlApproved(o) : await devices.control(o)), true;
    }
    if (m === "POST" && p === "/smarthome/scene/run") { const b = await body(); const s = registry.scenes().find((x) => x.id === b.id); if (!s) return send(res, 404, { error: "No such scene." }), true; return send(res, 200, await devices.runScene(s, { surface: "tv" })), true; }
    // typed on the Devices page: the owner's own words on his own screen, so a yes there answers the page's question
    if (m === "POST" && p === "/smarthome/say") { const b = await body(); const text = String(b.text ?? ""); confirm.userSaid(text, { surface: "tv" }); return send(res, 200, await devices.run(text, { surface: "tv" })), true; }
    if (m === "GET" && p === "/smarthome/status") return send(res, 200, { devices: await devices.statusAll({ fresh: true }), strips: await devices.stripsState() }), true;
    // Test: talk to one strip (saved, or being set up) and say what it answered
    if (m === "POST" && p === "/smarthome/test") {
      const b = await body();
      const s = b.id ? registry.strip(b.id) : { id: "test", name: "It", adapter: b.adapter, host: b.host, port: b.port ? Number(b.port) : undefined, outlets: Number(b.outlets) || 1, custom: b.custom, childIds: [] };
      if (!s) return send(res, 404, { error: "No such strip." }), true;
      const a = adapters.strip(s.adapter); if (!a) return send(res, 400, { error: "Pick the kind of strip first." }), true;
      const secret = b.secret ?? (b.id ? registry.secretFor(`strip:${b.id}`) : {});
      try {
        if (b.outlet && b.pulse) { await a.setOutlet(s, Number(b.outlet), false, secret); await new Promise((r) => setTimeout(r, 1500)); await a.setOutlet(s, Number(b.outlet), true, secret); }
        const st = await a.getState(s, secret);
        const info = a.probe && b.host ? await a.probe(s.host, { port: s.port, username: secret.username, password: secret.password }).catch(() => null) : null;
        return send(res, 200, { ok: true, text: `Connected${info?.model ? ` to ${info.model}` : st.model ? ` to ${st.model}` : ""}: ${st.on.length} outlet${st.on.length === 1 ? "" : "s"}, ${st.on.filter(Boolean).length} on.`, state: st, info }), true;
      } catch (e) { return send(res, 200, { ok: false, text: e.message }), true; }
    }
    if (m === "POST" && p === "/smarthome/discover") { const b = await body(); const found = await discovery.discover({ hosts: Array.isArray(b.hosts) && b.hosts.length ? b.hosts : null }); activity.log("devices.scan", { found: found.length }); return send(res, 200, { found }), true; }
    if (m === "POST" && p === "/smarthome/schedule") { const b = await body(); const when = typeof b.when === "string" ? whenOf(b.when) : b.when; if (!when) return send(res, 400, { error: "When? (at 10 pm, in 30 minutes, every night at 11)" }), true; return send(res, 200, await devices.run({ target: b.target, ids: b.ids, action: b.action, value: b.value, when }, { surface: "tv" })), true; }
    if (m === "DELETE" && (mm = p.match(/^\/smarthome\/schedule\/([\w-]+)$/))) return send(res, 200, { cancelled: devices.cancelSchedule(mm[1]) }), true;
    if (m === "POST" && p === "/smarthome/hue/pair") {
      const b = await body();
      try { const { key } = await huePair(String(b.host ?? "")); const h = registry.saveHue({ host: b.host, name: b.name, key }); return send(res, 200, { ok: true, hue: h }), true; }
      catch (e) { return send(res, 200, { ok: false, text: e.message, button: e.code === "button" }), true; }
    }
    if (m === "GET" && (mm = p.match(/^\/smarthome\/hue\/([\w-]+)\/lights$/))) { const h = registry.hue(mm[1]); if (!h) return send(res, 404, { error: "No such bridge." }), true; return send(res, 200, { lights: await hueAdapter.lights(h, registry.secretFor(`hue:${h.id}`)) }), true; }
    if (m === "GET" && p === "/smarthome/ha/entities") { const ha = await import("../connectors/homeassistant.mjs"); if (!ha.connected()) return send(res, 200, { connected: false, entities: [] }), true; return send(res, 200, { connected: true, entities: (await ha.list()).filter((e) => /^(switch|light|fan|cover|lock|climate|media_player|input_boolean|humidifier|scene|script)\./.test(e.id)) }), true; }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  send(res, 404, { error: `no route ${m} ${p}` });
  return true;
}
