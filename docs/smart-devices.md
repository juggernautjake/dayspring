# Smart devices and power strips

Dayspring can switch the things in your home by voice: *"turn on my computer"*, *"turn fan number 2 off"*, *"turn on 3D printer number 3"*, *"is the TV on?"*, *"movie mode"*, *"turn everything off in the office at 10 pm"*, *"what's on right now?"*. It works without an AI, and it keeps working when the internet is down.

This is in the **development version** of Dayspring. It's under **Settings → Smart devices** and on the **🏠 Devices** page.

## What to buy

Dayspring talks to power strips and plugs **on your own network**, never through a company's cloud. So a command takes a fraction of a second, still works if the internet or the maker's servers are down, and nothing about your home leaves the house. These strips switch **each outlet on its own**, and all of them work locally:

| Strip | Outlets | Why | Note |
|---|---|---|---|
| **TP-Link Kasa HS300** | 6, plus 3 USB | Each outlet is switched and power-metered on its own. It has the simplest local protocol, with no login needed on most hardware versions. | **Best pick.** Newer hardware versions may ask for your TP-Link login once, and Dayspring handles that. |
| **TP-Link Kasa KP303** | 3, plus 2 USB | Uses the same local protocol as the HS300, and it's cheaper. | Has no power readings. |
| **Shelly Plus / Pro 4PM** (or **Plus 2PM**) | 4 (or 2) | Relays with power metering and an open, documented local API. | These are wired in (they're relays, not plug-in strips), so have an electrician fit them. **Shelly Plus Plug S** is the plug-in version, one outlet each. |
| **TP-Link Tapo P300** (or **P304M**) | 3, plus USB | Local control works. | It checks your TP-Link account email and password even on your own network. Dayspring keeps them sealed with Windows' protection. The P304M adds power metering. |
| **Meross MSS425F** | 3, plus USB | Local control works. | **Advanced:** needs your Meross device key once. Home Assistant's "Meross LAN" integration shows it. |

**Left off the list, for now:**
- **Govee plugs** can't be controlled locally at all (they're cloud only).
- **Tuya / Smart Life strips** (Gosund, Teckin and many others) need each device's local key first. Home Assistant's local Tuya integration can control them today, and Dayspring's own Tuya adapter is coming.

**Anything else** can join in two ways:
- **A custom device.** If it takes a local web request or an MQTT message (Tasmota, ESPHome, OpenBeken, Zigbee2MQTT, a Raspberry Pi relay), add it with a template and no code is needed.
- **Home Assistant.** Lights, locks, covers, thermostats, Zigbee, Z-Wave and Matter devices all work through it.

## Setting it up

1. **Settings → Smart devices → May Dayspring switch your devices?** Pick **Ask me first** or **On**. It starts at **Off**.
2. **Find devices on my network.** Dayspring looks on your home network for about 10 seconds, and only when you click. It finds Kasa, Shelly, Tapo, Meross and WLED devices. Press **Add** on each one and type its login if it needs one (Tapo, Meross, or a Shelly with a password).
   - Not found? Check the device is on the same network (not a guest network), then use **Add one by hand** with its IP address. The maker's app shows the IP, or your router's list of devices does.
3. **Name each outlet.** Click an outlet number on a strip and say what's plugged in:
   - its **name** ("Computer", "Fan 2", "TV")
   - its **kind**
   - its **room** (so "turn off everything in the garage" works)
   - **other words** you might say ("the bedroom fan")

   Numbers and ordinals are understood by themselves. "Fan 2" also answers to "fan two", "the second fan", "fan number 2" and "fan #2". "Printer 3" also answers to "3D printer number three" and "the third printer".
4. **Test** each strip and device. The Test button says what it sees ("Connected: it's on, using 12.5 W").
5. Mark what matters:
   - **Critical**, for the fridge and the router. Turning a critical device off always asks first.
   - **This is the computer Dayspring runs on.**
   - For a 3D printer's outlet, pick **its printer**, so its power is never cut mid-print.

### Computers
A computer on a smart outlet turns **on** by switching its outlet on, and then Dayspring sends a **Wake-on-LAN** signal a few seconds later.

- Add the computer's **MAC address** to its device. It's the "Physical Address" in `ipconfig /all`.
- Turn on **Wake on LAN** in its BIOS/UEFI, and in Windows under Device Manager → the network adapter → Power Management and Advanced.
- Many BIOSes also have a setting to turn on when power returns. It's called "Restore on AC power loss" or "AC Back"; set it to **On**. With it on, switching the outlet on starts the computer by itself.

Turning a computer **off** by its outlet is the same as pulling the plug, so Dayspring always asks first and says why.

### TVs
A TV turns on in one of these ways:
- by its outlet
- by **Wake-on-LAN** (many LG and Samsung TVs support it; turn on "Turn on via Wi-Fi/LAN" in the TV's settings)
- through **Home Assistant** (its media player)
- by **HDMI-CEC**, with a Pulse-Eight USB-CEC adapter and its cec-client

### Lights and LED strips
- **WLED** LED controllers: add the device's IP address. You get on/off, brightness, colour and its effects ("set the desk lights to the rainbow effect").
- **Philips Hue:** press the bridge's round button, then **Pair** within 30 seconds, and pick each light for a device.
- **Home Assistant lights:** pick the entity. Brightness, colour, colour temperature and effects are used when the light has them.

## Talking to it

| Say | What happens |
|---|---|
| "Turn on my computer" | Its outlet comes on, then a Wake-on-LAN signal. |
| "Turn fan number 2 off", "fan two off", "turn off the second fan" | Fan 2 goes off. |
| "Turn on 3D printer number 3" | That printer's outlet comes on. |
| "Is the TV on?" | "TV is on (using 85 W)." |
| "What's on right now?" | The devices that are on, and what's on your schedule now. |
| "Office on", "turn off everything in the garage" | Everything in that room. Big batches ask first. |
| "Movie mode" | Runs that scene. |
| "Turn everything off in the office at 10 pm" | Scheduled for 10 pm tonight. |
| "Turn the TV off every night at 11" | A daily schedule. |
| "Set the desk lights to blue", "dim the bedroom lamp to 30 percent" | Colour and brightness. |
| "What's scheduled for my devices?", "cancel the TV schedule" | Your device schedules. |
| "Show my devices" | Opens the Devices page. |

## Safety

Dayspring's code enforces these rules every time, whatever asks: your voice, the AI, the Devices page, or another of your Dayspring computers.

- **Never cut the power without a clear yes** to:
  - the computer Dayspring runs on
  - a critical outlet (fridge, router)
  - a running computer
  - a 3D printer that's printing or still hot (a hot nozzle needs its fan to cool, or it can clog)

  The question always says **why** it's risky.
- **Heating appliances** (air fryer, coffee maker, heater, 3D printer), **things that move** (garage doors, blinds) and **locks** have extra rules:
  - They need their **exact name** and **your yes**.
  - They're never switched on as part of a group.
  - A heater can turn itself off after a set time (the **auto-off** setting).
- **"Turn everything on"** never happens. **"Everything off"** and other big batches ask first, and leave the protected things alone.
- **Only you.** A meeting, a Discord friend, a phone call or someone else's computer can't switch heaters, doors, locks or critical outlets.
- **Rate limits:** the same thing can't be flicked on and off many times a minute.
- **The activity log** records every switch, every question, every refusal, and which of your computers asked.

## Scenes and schedules

- **Scenes** switch several things at once ("movie mode": TV on, lamp off, fan 2 off). Make them in Settings → Smart devices → Scenes.
- **Schedules** come from what you say ("at 10 pm", "in 30 minutes", "every night at 11") and show on the Devices page, where each has a ✕ to cancel it. A schedule that would cut a protected device asks when you make it. At the time, anything that's become unsafe, like a printer still printing, is left alone, and Dayspring tells you.

## Custom devices (no code)

Choose **Custom (HTTP or MQTT)**, start from a template, and change the address or name:

| Template | For |
|---|---|
| Tasmota (HTTP) / Tasmota (MQTT) | Plugs and strips flashed with Tasmota |
| ESPHome (web server) | ESPHome devices with the web server on |
| Zigbee2MQTT plug | Zigbee plugs through Zigbee2MQTT |
| Shelly Gen 1 (HTTP) | Older Shelly relays |
| Webhooks | IFTTT, Node-RED, a Home Assistant webhook, anything with a URL |

`{host}`, `{outlet}`, `{channel}` and `{name}` are filled in for you. With a **status** command, Dayspring shows the real state. Without one, it shows the last command it sent.

## Troubleshooting

- **"Can't reach it":**
  - Check that the device has the same IP address. Giving it a fixed address in your router helps.
  - Check that this computer is on the same network.
- **Tapo: "didn't accept the TP-Link email and password":** use the login of the Tapo app's account, the one the device was set up with.
- **Shelly: "needs its password":** type the password you set in the Shelly app.
- **Wake-on-LAN does nothing:**
  - Check the MAC address.
  - Turn on Wake-on-LAN in the BIOS and in the network adapter.
  - Use a wired connection. Wi-Fi wake rarely works.

See also: [3D printers](bambu-printers.md), [Connecting apps](connections.md) (Home Assistant), [Permissions](permissions.md), [Dayspring on more than one computer](multiple-devices.md).
