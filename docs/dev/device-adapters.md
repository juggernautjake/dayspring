# Device adapters (developers)

How Dayspring's smart-home layer (`lib/devices`) is put together, how to add a brand, and the contract that other parts of Dayspring (and other Dayspring computers) use to switch things. For the owner's guide, see [Smart devices](../smart-devices.md).

## The layers

| Layer | What it is | Where |
|---|---|---|
| Voice, AI tools, the Devices page | "turn fan 2 off", `device_control`, the tiles | `lib/devices/skills.mjs`, `lib/devices/routes.mjs`, `public/smarthome.*`, `public/devices-settings.js` |
| Understanding | Phrases → `{ kind, action, target, scope, when }`. Numbers, ordinals, aliases, rooms, times | `lib/devices/parse.mjs`, `lib/devices/model.mjs` |
| The one entry point | `run(command, { from })` and `control()`: resolve → safety → adapter → activity log | `lib/devices/index.mjs` |
| Safety | Who may do what, what always asks, rate limits | `lib/devices/safety.mjs` (+ `lib/permissions.mjs` "devices") |
| The device model | Capabilities and safety classes, never brands | `lib/devices/model.mjs` |
| Adapters | Brand ↔ capability translation | `lib/devices/adapters/*` |
| Registry | Devices, strips, scenes, groups, schedules; secrets sealed with DPAPI | `lib/devices/registry.mjs`, `lib/devices/secrets.mjs` → `data/devices-home.json` |

## The device model

- **Capabilities:** `onoff`, `brightness` (0–100), `color` (`{ r, g, b }` or a name), `colortemp` (kelvin), `effect` (list + set), `scene`, `openclose` (with state), `lock`, `temperature` / target, `timer` / program, `startstoppause`, `sensor` readings, `camera`, `power` (watts).
- **Voice, tiles and rules only use capabilities.** The Devices page draws a tile's controls from `state.caps`:
  - a colour picker for `color`
  - a slider for `brightness`
  - an effects list for `effect`
  - Open/Close for `openclose`
  - Lock/Unlock for `lock`
- **Safety classes:**

  | Class | For |
  |---|---|
  | `normal` | everything else |
  | `heat` | air fryer, coffee maker, heater, 3D printer |
  | `motion` | garage door, blinds, gate |
  | `security` | lock |

  Heat, motion and security:
  - need an exact name match plus the owner's yes (except off, close and lock)
  - are never part of a group "on"
  - are never controlled by anyone but the owner
  - heat can auto-off (`autoOffMinutes`); motion can alert if left open (`alertOpenMinutes`)

A **device** is what the owner calls it ("Fan 2"):
- `power`: the ways it switches on and off, tried in order. For "on" that's the outlet first, then Wake-on-LAN / CEC a few seconds later. For "off", the soft ways go first and the outlet last.
- `control`: an optional richer adapter (WLED, Hue, a Home Assistant light/cover/lock/climate).

A **strip** is the hardware that switches power. Outlets are numbered from 1.

## Writing an adapter

Add a file in `lib/devices/adapters/` and one line in `adapters/index.mjs`. Every adapter exports `meta`:

```js
export const meta = { id: "acme", label: "Acme strips", kind: "strip", transports: ["lan"], offline: true, perOutlet: true,
  needs: ["host", "password"], hint: "Where to find the IP address…" };
```

- `transports`: `lan`, `ble`, `ble-via-esphome-proxy`, `zigbee-via-ha`, `zwave-via-ha`, `matter-via-ha`, `cloud`, `ir` or `usb`.
- `offline: true` puts the "works offline ✓" badge on it.

**A strip** (anything with outlets) exports:

```js
export async function getState(strip, secret) { return { on: [true, false, …], names?: [], childIds?: [], watts?: [] }; }
export async function setOutlet(strip, outlet /* 1-based */, on, secret) { … }
export async function probe(host, opts) { return { adapter, host, model, name, mac, outlets } | null; }   // optional: Test / discovery
export async function discover(opts) { return [ … ] }   // optional: a broadcast discovery (Kasa's UDP)
export async function sniff(host) { … }                  // optional: "is it one of mine?" for the LAN scan
```

- `secret` is the owner's login or key for that strip, opened from the sealed store. Never log it or put it in an error message.

**A light / entity** (a device's `control`) exports:
- `getState(control, secret, extra)`, which returns the capability state with `caps`
- `set(control, { action, value }, secret, extra)`

**Rules for adapters:**
- Local first. Say `offline: false` honestly when you can't.
- Time out in seconds (4–6 s), never minutes.
- Throw plain-English errors ("didn't accept the TP-Link email and password"). They're spoken to the owner.
- Never decide safety. That's `safety.mjs`'s job, before your adapter is called.
- Add a simulator to `scripts/qa/fixtures/devices/sims.mjs` that speaks the real protocol, and test through `devices.control()` in `scripts/qa/devices.mjs`. Never test against real devices, and never scan the real network in a test: discovery takes explicit `hosts` / `kasaTargets`, and `DAYSPRING_NO_LAN_SCAN=1` refuses anything else.

**What's there:**

| Adapter | Kind | How |
|---|---|---|
| `kasa` | strip | TCP 9999 XOR JSON; KLAP v1 on newer hardware |
| `tapo` | strip | KLAP v2, children via `control_child` |
| `shelly` | strip | Gen 1 HTTP; Gen 2+ RPC with SHA-256 digest |
| `meross` | strip | Signed `/config` |
| `custom` | strip | HTTP/MQTT templates |
| `power` | power | Wake-on-LAN, HDMI-CEC, Home Assistant / Matter entity, webhook |
| `lights` | light / entity | WLED, Hue, Home Assistant entities → capabilities |

**Stubs** (shown as "coming", doing nothing):

| Stub | Plan |
|---|---|
| `ble` | MagicHome / Triones / Govee-family LED strips, through this PC's Bluetooth or ESPHome Bluetooth proxies. Known protocols first; unknown devices by capturing the phone app's writes once and replaying them with parameters (a "learn a Bluetooth device" wizard). |
| `tuya` | Tuya / Smart Life local control with each device's key (obtained once), protocol 3.3/3.4/3.5. |
| `ir` | An ESPHome IR board or a Broadlink blaster that learns remote buttons. |

The order the home-control plan agreed:
1. strips, custom HTTP/MQTT, Home Assistant, printers, cameras
2. WLED and Hue, Bluetooth LE strips, Tuya local, IR
3. garage doors (a Shelly or ratgdo with a tilt sensor, `motion` class) and kitchen devices (`heat` class)

Home Assistant stays the catch-all "device driver" for Zigbee, Z-Wave, Thread and Matter.

## Remote commands: `devices.run(command, { from })`

Every command goes through the same entry point, whether it comes from this computer's voice or AI, the Devices page, or another of the owner's Dayspring computers (`lib/remote`):

```js
import * as devices from "./lib/devices/index.mjs";
const r = await devices.run(command, { from, confirmToken });
// → { ok, text, needsConfirm?, confirmToken?, done?: [ids], left?: [ids], refused?: [{ id, why }], failed?: [...], openPage? }
```

- **`command`** is one of:
  - a sentence: `"turn fan 2 off"`, `"is the TV on?"`, `"movie mode"`, `"pause printer 3"` (printer sentences go to `lib/printers`)
  - an object: `{ target, action, value?, when? }`, where action is `on|off|toggle|open|close|lock|unlock|brightness|color|colortemp|effect` and `when` is `{ at: ISO, label }` or `{ daily: "HH:MM", days?, label }`
  - an answer: `{ answer: "yes" }`
- **`from`** is `{ id, name, verified: true, owner: true }`.
  - The remote layer authenticates the other computer and sets `verified`. An unverified sender is ignored (and logged).
  - `owner: false` (someone else's computer) can't touch heat, motion, security, critical outlets or this PC.
  - Leave `from` out for this computer.
- **The same rules apply.** A risky command returns `needsConfirm` with `text`, the question that says why. The confirmation is **bound to the computer that sent it** (`confirm.mjs` surface `remote:<id>`), so a yes said on any other screen doesn't count. Two ways to answer:
  - send the owner's words: `devices.run({ answer: "yes" }, { from })`
  - repeat the command with the token after the owner's yes: `devices.run(command, { from, confirmToken })`
- **Logging.** Every remote command is logged (`device.remote`, with `from`), and so is each switch it makes.

Printers have the matching calls in `lib/printers/index.mjs`:
- `status(which | null)` returns the status with `say`, or every printer's
- `snapshot(which)` returns a JPEG
- `names()` / `list()`
- `start(which, job, { from, confirmed })`: the same bed check and yes. `confirmed` means the owner already said yes on the sending computer.

## Tests

- `node scripts/qa/devices.mjs`: simulators for Kasa HS300/KP303, Shelly Gen 1/2, Tapo P300, Meross, Tasmota, WLED, Hue and MQTT (aedes), and a Wake-on-LAN sink. It covers 70+ phrases, scenes, groups, schedules, every safety refusal, the permission modes and the remote entry point.
- `node scripts/qa/tool-names.mjs`: the AI tools `device_control`, `device_status` and `device_schedule` must stay unique.
- The UI: `node scripts/qa/home-ui.mjs` (the Devices and Printers pages and their Settings sections, headless).
