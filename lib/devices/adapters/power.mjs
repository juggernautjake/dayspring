// The ways to switch a device that aren't a strip's outlet:
//   wol            Wake-on-LAN: the "magic packet" (6 × FF, then the MAC 16 times) as UDP to the broadcast address.
//                  Turns a PC (or many TVs) ON; it can't turn anything off.
//   cec            HDMI-CEC through a USB-CEC adapter (Pulse-Eight) and libCEC's cec-client, when installed: TV on/standby.
//   homeassistant  a Home Assistant entity (switch, light, fan, media_player, input_boolean…); Matter devices paired to
//   / matter       Home Assistant are the same thing (lib/connectors/homeassistant.mjs)
//   webhook        a web request for on and one for off (the custom device's HTTP commands: ./custom.mjs)
import { createSocket } from "node:dgram";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as custom from "./custom.mjs";
import { haMod } from "./ha-shared.mjs";

export const WOL = { id: "wol", label: "Wake-on-LAN", kind: "wake", transports: ["lan"], offline: true, hint: "The computer's network card MAC address (ipconfig /all → Physical Address). Turn on Wake-on-LAN in its BIOS and network adapter settings." };
export const CEC = { id: "cec", label: "HDMI-CEC (USB adapter)", kind: "tv", transports: ["usb"], offline: true, hint: "Needs a USB-CEC adapter (Pulse-Eight) and libCEC's cec-client installed." };
export const HA = { id: "homeassistant", label: "Home Assistant", kind: "entity", transports: ["lan", "zigbee-via-ha", "zwave-via-ha", "matter-via-ha", "ble-via-ha"], offline: true, hint: "Connect Home Assistant in Settings → Apps & connections, then pick the entity." };
export const MATTER = { id: "matter", label: "Matter (through Home Assistant)", kind: "entity", transports: ["matter-via-ha"], offline: true, hint: "Pair the Matter device to Home Assistant, then pick its entity here." };
export const WEBHOOK = { id: "webhook", label: "Web request (webhook)", kind: "entity", transports: ["lan", "cloud"], offline: false, hint: "A link for on and one for off (IFTTT, Node-RED, a Home Assistant webhook…)." };

export function magicPacket(mac) {
  const hex = String(mac ?? "").replace(/[^0-9a-f]/gi, "");
  if (hex.length !== 12) throw new Error("That isn't a MAC address (it looks like 3C-7C-3F-1A-2B-4D).");
  const m = Buffer.from(hex, "hex"), pkt = Buffer.alloc(102, 0xff);
  for (let i = 0; i < 16; i++) m.copy(pkt, 6 + i * 6);
  return pkt;
}
export function wake({ mac, broadcast = "255.255.255.255", port = 9 }) {
  const pkt = magicPacket(mac);
  return new Promise((resolve, reject) => {
    const s = createSocket("udp4");
    s.once("error", (e) => { try { s.close(); } catch { /* closed */ } reject(new Error(`The wake-up signal couldn't be sent (${e.message}).`)); });
    s.bind(0, () => {
      try { s.setBroadcast(true); } catch { /* a unicast target */ }
      s.send(pkt, port, broadcast, (e) => { try { s.close(); } catch { /* closed */ } e ? reject(e) : resolve(true); });
    });
  });
}

// cec-client, if it's installed
function cecClient() {
  for (const p of [process.env.DAYSPRING_CEC_CLIENT, "C:\\Program Files (x86)\\Pulse-Eight\\USB-CEC Adapter\\cec-client.exe", "C:\\Program Files\\Pulse-Eight\\USB-CEC Adapter\\cec-client.exe"]) if (p && existsSync(p)) return p;
  const r = spawnSync("where", ["cec-client"], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}
export function cec(on, address = 0) {
  const exe = cecClient();
  if (!exe) return Promise.reject(new Error("HDMI-CEC needs a USB-CEC adapter and its cec-client program, and it isn't installed."));
  return new Promise((resolve, reject) => {
    const p = spawn(exe, ["-s", "-d", "1"], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => reject(e));
    p.on("close", (code) => (code === 0 ? resolve(true) : reject(new Error(`cec-client stopped (${code}) ${err.slice(0, 120)}`))));
    p.stdin.end(`${on ? "on" : "standby"} ${address}\n`);
  });
}

export async function haSet(entity, on) {
  const h = await haMod();
  if (!h.connected()) throw new Error("Home Assistant isn't connected. Connect it in Settings → Apps & connections.");
  const domain = entity.split(".")[0];
  const service = domain === "cover" ? (on ? "open_cover" : "close_cover") : domain === "lock" ? (on ? "unlock" : "lock") : domain === "scene" || domain === "script" ? "turn_on" : on ? "turn_on" : "turn_off";
  await h.service(domain, service, { entity_id: entity });
  return true;
}
export async function haState(entity) {
  const h = await haMod();
  if (!h.connected()) return null;
  const e = await h.entity(entity);
  return e ?? null;
}

export async function webhook(p, on) {
  const req = on ? p.on : p.off;
  if (!req) throw new Error(`There's no “${on ? "on" : "off"}” web request set up for that.`);
  const r = typeof req === "string" ? { method: "POST", url: req } : req;
  await custom.setOutlet({ id: "webhook", name: "The web request", outlets: 1, custom: { kind: "http", on: r, off: r } }, 1, on, null);
  return true;
}
