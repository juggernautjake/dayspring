# 3D printers

Dayspring shows your 3D printers' state and camera, and controls them by voice. It also watches each print through the camera and warns you about spaghetti, stringing or a part coming loose. Examples:
- *"How's printer 3 doing?"*
- *"What's left on the P1S?"*
- *"Show me the camera on the X1"*
- *"Is the bed clear on printer 2?"*
- *"Start the benchy on printer 1"*
- *"Pause printer 3"*

It works with **Bambu Lab** printers (X1, X1C, X1E, P1S, P1P, A1, A1 mini, H2D, H2S and P2S) in LAN mode. It also works with a **Creality Ender 5 Plus** or other Marlin printer straight over USB, and with any printer run by **OctoPrint** or **Klipper** (Mainsail / Fluidd).

This is in the **development version** of Dayspring. It's under **Settings → 3D printers** and on the **🖨 Printers** page.

## Bambu Lab: what to turn on at the printer

Dayspring talks to a Bambu printer **on your own network** (LAN mode). It never uses your Bambu account and never asks for your Bambu password.

Since 2025, Bambu's firmware checks **who** sends commands ("Authorization Control"). A printer only takes pause, start, light and the rest from other apps like Dayspring when it's in **LAN Only mode with Developer mode on**. Without Developer mode, Dayspring still sees the status, but its commands are refused. Dayspring tells you so and points you here.

| Printer | Where | Firmware with Developer mode |
|---|---|---|
| **X1 / X1C / X1E** | Settings (⚙) → Network → **LAN Only mode** on, then **Developer mode** on. The **Access Code** is on the same screen. | 01.08.03 or newer |
| **P1S / P1P** | Settings → WLAN → **LAN Only mode** on, restart the printer, then **Developer mode** on. The Access Code is on the WLAN screen. | 01.08.02 or newer |
| **A1 / A1 mini** | Settings → WLAN → **LAN Only mode** on, restart, then **Developer mode** on. The Access Code is on the WLAN screen. | 01.05.00 or newer |
| **H2D / H2S** | The network settings → **LAN Only mode** and **Developer mode**. For the camera, also turn on **LAN Only Liveview**, then restart. | current firmware |
| **P2S** | The network settings → **LAN Only mode** and **Developer mode**. | current firmware |

**What changes in LAN Only mode:**
- The **Bambu Handy** app and cloud printing stop working, and firmware updates come through Bambu Studio instead of the phone.
- **Bambu Studio** and **OrcaSlicer** still print over your network: choose the printer under LAN in the device list.

**Then in Dayspring:** Settings → 3D printers → **Add a printer** → Bambu Lab. Fill in:
- the **IP address** (the printer's network screen, or your router's list)
- the **serial number** (on the printer's "Device" screen or its sticker; Dayspring guesses the model from it)
- the **Access Code**

Then press **Save and connect**. The access code is sealed with Windows' protection and never saved as plain text. It changes each time LAN mode is turned off and on, so type the new one if Dayspring says it isn't accepted.

### How Dayspring talks to a Bambu printer
- **Status and commands:** the printer's own MQTT on port 8883 (encrypted), user `bblp`, password = the access code.
- **Files:** the printer's storage over FTPS on port 990. That's how a `.3mf` gets onto the printer before it's started.
- **The camera:**
  - **X1, H2D, H2S, P2S:** an RTSPS video stream on port 322, read with ffmpeg (Dayspring includes it).
  - **P1 and A1:** JPEG pictures over an encrypted link on port 6000, about one a second.
  - **X2D:** not supported yet. It uses Bambu's own video protocol.

## Creality Ender 5 Plus (and other Marlin printers)

- **Over USB, straight from this computer:** Add a printer → Creality Ender / other Marlin → pick its **USB port** (the list marks likely printers with ✓). Dayspring sends the G-code line by line, with line numbers and checksums, and re-sends any line the printer asks for again.
  - **Honestly:** this works, but if Windows sleeps, restarts for an update, or the cable is bumped, the print stops. Dayspring keeps the computer awake while it prints and tells you at once if the connection drops. **OctoPrint or Klipper on a Raspberry Pi is more reliable.**
  - Dayspring also watches the temperatures. If the printer reports a thermal runaway, or a heater runs far above its target or drops and doesn't recover, Dayspring turns the heaters off, ends the print and tells you straight away.
- **With OctoPrint:** its address and an **API key** (OctoPrint → Settings → Application Keys).
- **With Klipper** (Mainsail / Fluidd / Moonraker): its address. A key is only needed if you set one.
- **No camera?** Point a webcam at the bed and add it in Settings → Cameras, then choose it for the printer. Or paste a snapshot address. With no camera at all, Dayspring asks you to check the bed yourself before every print.

## The empty bed

Before any print starts, Dayspring looks at the bed. To do that it needs a picture of **your empty bed** to compare with.

1. Clear the bed completely, with the plate you normally use on it.
2. Settings → 3D printers → **Take the empty-bed picture**.
3. **Drag a box around the bed** on the picture, so only the bed counts, not the frame, the nozzle or the room.
4. If you use several plates (textured PEI, smooth, cool plate), type the plate's name and take a picture for each one.

The check compares the picture now with the empty one, allowing for noise and brighter or darker light. Anything that doesn't match counts: a part left behind, a leftover purge line, a scraper. When the AI may look at pictures (your choice, per printer), it double-checks. It can only make the check stricter, never overrule a difference it measured.

## Starting a print

A print heats up and moves, so:

1. **The bed must be clear.** A fresh check runs right before the start command, every time. If it isn't clear, Dayspring says what it saw and shows the picture.
2. **Your yes.** "The bed on printer 1 looks clear. Start benchy.3mf? It will heat up and start printing." Nothing happens until you say yes. That's the **Ask me first** default.
3. **Auto-start** is off by default. You can turn it on per printer for its **queue**. Even then, a fresh clear-bed check has to pass every time. A printer without a camera always asks.

**Programming prints:**
- Each printer has a **queue**. Add files on the Printers page, or set a **queue folder** whose `.3mf` / `.gcode` files are queued by themselves.
- When a print finishes and something's queued, Dayspring checks the bed and asks you, or starts it with auto-start on.
- The AI can choose the plate of a multi-plate `.3mf`, the **AMS mapping** (which tray each filament comes from) and options (bed levelling, flow calibration, timelapse).
- **Slicing** is optional. When Bambu Studio or OrcaSlicer is installed, a queued `.stl` is sliced with its command line. Otherwise only sliced files (`.3mf` with G-code, `.gcode`) are printed.

## While it prints

- Every **10 minutes** (you can change it per printer), Dayspring takes a picture and looks for:
  - **spaghetti** and **stringing**
  - a part that came **loose**
  - a **blob**, a **layer shift**
  - an **empty bed while "printing"**
  - the printer's own **error codes**
- It uses quick checks on this computer, and the AI when you allow it.
- **When something looks wrong**, Dayspring says so, waiting until you've finished talking: "Printer 3 looks like it's failing: spaghetti. Want me to pause it?" A card with the picture and **Pause it** shows on the screen, and (if you turn it on) you get a text. It pauses by itself only if you turn on **auto-pause** (off by default). **It never stops a print by itself.**
- The pictures are kept in `data\prints\<printer>\<print>\` until the print ends:
  - **A good print** (finished, no warnings) has its pictures **deleted**. With **Always keep a timelapse** on, they're first turned into one short video, and only the video is kept. With **Ask me if it came out okay** on, they wait for your answer.
  - **A failed, stopped or warned-about print** keeps its pictures, with a short **report**, for the days you choose (30 by default).

## Safety notes

- Dayspring never stops a print by itself. Stopping asks first ("It can't be resumed after that").
- Temperatures above a printer's safe maximum are **refused**, not lowered. The limits are:
  - 300 °C nozzle on X1 / P1 / A1
  - 350 °C on H2D / H2S
  - 260 °C on an Ender 5 Plus
  - each bed's own maximum
- A printer's **smart outlet** is never switched off while it's printing or still hot without your yes and the reason ([Smart devices](smart-devices.md)).
- Everything is in the activity log: bed checks, questions, starts, pauses, warnings.
- Other people can't start or stop your prints (a meeting, Discord, someone else's computer). Your own other Dayspring computers can, with the same rules: the question is asked on the computer you're using.

## Limitations

- **Bambu firmware authorization:** without **Developer mode**, newer firmware refuses control commands from Dayspring. Status still works. Bambu may change this again. If an update breaks control, Dayspring says "the printer refused that" and points here.
- **H2D and H2S:** two nozzles and the heated chamber are shown. The AMS mapping for the second nozzle follows the order in the file. Check the first dual-nozzle print from Dayspring with Bambu Studio open.
- **Camera:** the X2D isn't supported yet. P1/A1 pictures are low resolution, about one a second.
- **Failure detection** is a helper, not a guarantee. Picture checks can miss things, especially stringing without the AI, and can have false alarms. Pick "Warn early", "Balanced" or "Only when quite sure" per printer.

See also: [Smart devices](smart-devices.md), [Cameras](cameras.md), [Dayspring on more than one computer](multiple-devices.md).
