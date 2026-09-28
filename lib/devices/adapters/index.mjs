// The adapter registry: every brand Dayspring can talk to, what each needs, how it reaches the device (transports) and
// whether it keeps working without the internet. Adding a brand = one file here plus one line below
// (docs/dev/device-adapters.md has the interface).
//   kind "strip"  outlets: getState(strip, secret) → { on: [..], names?, childIds?, watts? } · setOutlet(strip, n, on, secret)
//                 · probe(host, opts)? · discover(opts)? · sniff(host)?
//   kind "light" / "entity"  a device's `control`: getState(control, secret, extra) → capability state · set(control, cmd, secret, extra)
//   kind "wake" / "tv"       power-only (Wake-on-LAN, HDMI-CEC)
import * as kasa from "./kasa.mjs";
import * as tapo from "./tapo.mjs";
import * as shelly from "./shelly.mjs";
import * as meross from "./meross.mjs";
import * as custom from "./custom.mjs";
import * as power from "./power.mjs";
import { wledAdapter, hueAdapter, haEntityAdapter } from "./lights.mjs";

export const STRIPS = { kasa, tapo, shelly, meross, custom };
export const CONTROLS = { wled: wledAdapter, hue: hueAdapter, homeassistant: haEntityAdapter };

// not built yet: a clear stub for each, so the Settings list can show them as "coming" and nothing half-works
const stub = (id, label, transports, note) => ({ meta: { id, label, kind: "stub", transports, offline: true, stub: true, hint: note } });
export const STUBS = {
  ble: stub("ble", "Bluetooth LED strips (MagicHome / Triones / Govee)", ["ble", "ble-via-esphome-proxy"], "Coming next: through this PC's Bluetooth or ESPHome Bluetooth proxies. Home Assistant can control many of them today."),
  tuya: stub("tuya", "Tuya / Smart Life (local keys)", ["lan"], "Coming next: local control with each device's key. Home Assistant's local Tuya integration can control them today."),
  ir: stub("ir", "Infrared remotes (ESPHome IR / Broadlink)", ["ir"], "Coming later: learn a remote's buttons with an IR blaster."),
};

export function all() {
  return [
    ...Object.values(STRIPS).map((a) => a.meta),
    power.WOL, power.CEC, power.HA, power.MATTER, power.WEBHOOK,
    ...Object.values(CONTROLS).map((a) => a.meta).filter((m) => m.id !== "homeassistant"),
    ...Object.values(STUBS).map((a) => a.meta),
  ].map((m) => ({ ...m, badge: m.offline ? "works offline ✓" : "needs the internet" }));
}
export const strip = (id) => STRIPS[id] ?? null;
export const control = (id) => CONTROLS[id] ?? null;

// Recommended power strips with per-outlet control that work locally (checked September 2026). Shown in Settings → Devices.
export const RECOMMENDED = [
  { id: "kasa-hs300", adapter: "kasa", name: "TP-Link Kasa HS300", outlets: 6, price: "about $55–80", link: "https://www.kasasmart.com/us/products/smart-plugs/kasa-smart-wi-fi-power-strip-hs300",
    why: "Six outlets, each switched and power-metered on its own, plus three always-on USB ports. The simplest local protocol: no login needed on the common hardware versions.", note: "Best pick. Newer hardware versions may ask for your TP-Link login (Dayspring handles that)." },
  { id: "kasa-kp303", adapter: "kasa", name: "TP-Link Kasa KP303", outlets: 3, price: "about $25–35", link: "https://www.kasasmart.com/us/products/smart-plugs/kasa-smart-wi-fi-power-strip-kp303",
    why: "Three switched outlets and two USB ports, same local protocol as the HS300, cheaper.", note: "No power readings." },
  { id: "shelly-4pm", adapter: "shelly", name: "Shelly Plus / Pro 4PM (or Plus 2PM)", outlets: 4, price: "about $60–110", link: "https://www.shelly.com/",
    why: "Four relays with power metering and an open, documented local API. Wires into a box (a relay, not a plug-in strip): have an electrician fit it, or use Shelly Plus Plug S units instead.", note: "Most open and reliable local control." },
  { id: "tapo-p300", adapter: "tapo", name: "TP-Link Tapo P300 (or P304M)", outlets: 3, price: "about $30–40", link: "https://www.tapo.com/us/product/smart-plug/tapo-p300/",
    why: "Three switched outlets and USB. Local control works, but it checks your TP-Link account email and password (kept sealed on this computer).", note: "P304M adds power metering." },
  { id: "meross-mss425f", adapter: "meross", name: "Meross MSS425F", outlets: 3, price: "about $35–45", link: "https://www.meross.com/",
    why: "Three outlets and USB, local HTTP control.", note: "Advanced: needs your Meross device key once (Home Assistant's Meross LAN integration shows it)." },
];
// Checked and left out: Govee smart plugs and strips (no local API for plugs; cloud only) and most Tuya strips (local only
// with extracted keys: the Tuya adapter is next). Both work today through Home Assistant.
export const NOT_RECOMMENDED = [
  { name: "Govee smart plugs / strips", why: "No local control for plugs (cloud only). Their LED lights have a LAN API; plugs don't." },
  { name: "Tuya / Smart Life strips (Gosund, Teckin…)", why: "Need each device's local key; Dayspring's Tuya adapter is coming. Home Assistant's local Tuya integration works now." },
];
export { power };
