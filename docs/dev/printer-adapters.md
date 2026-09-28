# Printer adapters (developers)

`lib/printers` is brand-neutral. The bed-clear check, failure and stringing detection, the snapshots-over-time monitor, the queue, the voice commands and the safety rules only need two things from a brand: a **connection** (status + commands) and a **camera source**. Bambu Lab, Marlin over USB (Creality Ender), OctoPrint and Klipper/Moonraker are built. This page is how to add the next one (Prusa via PrusaLink, Creality's own firmware, …). For the owner's guide, see [3D printers](../bambu-printers.md).

## The pieces

| File | What |
|---|---|
| `index.mjs` | The framework: connections, status, the start rules, commands, the bed check, the remote API (`status`, `snapshot`, `start`, `names`) |
| `store.mjs` | `data/printers.json`; access codes and API keys sealed with DPAPI |
| `camera-bridge.mjs` | Each printer's camera as a source in `lib/cameras` (fallback: a local timer) |
| `monitor.mjs` | Per print: pictures every N minutes in `data/prints/<printer>/<job>/`, alerts, auto-pause (off), delete-when-good / keep-with-report |
| `vision/image.mjs`, `vision/analyze.mjs` | Pixel differencing (jpeg-js, noise-adaptive threshold, connected components) for the bed check and failures; the AI prompts |
| `queue.mjs`, `slicer.mjs` | The print queue and folder; optional slicing with Bambu Studio / OrcaSlicer |
| `bambu/*` | MQTT (TLS 8883), FTPS (990), the cameras (RTSPS 322 / TLS JPEG 6000), models and limits |
| `marlin/*` | G-code streaming over serial or TCP: line numbers, checksums, resends, temperatures, faults |
| `hosts.mjs` | OctoPrint and Moonraker REST |
| `skills.mjs`, `routes.mjs` | Voice, AI tools, `/api/printers` |

## A connection

`ADAPTERS[brand].create(printer, secret, { keepAwake })` returns an EventEmitter with:

```js
connect() · close() · status() → normalized · test() → { ok, text }
pause() · resume() · stop() · setSpeed(1..4) · setLight(on) · setTemp({ nozzle, bed, chamber, extruder }) · setFan({ part, aux, chamber })
gcodeLine(line) · refresh() · upload(localPath, { name }) → remote name · startPrint({ file, plate, amsMapping, options })
cameraSource() → { id, name, kind: "printer", snapshot(), live?({ fps, width }, onFrame, onEnd) → { stop } } | null
capabilities: { camera, ams, light, speed, upload, dualNozzle, fans, chamber, gcode, usbStream }
events: "status" (normalized), "fault" ({ kind, text }), "jobEnd"
```

**Normalized status:**

```js
{ online, state: "idle"|"preparing"|"printing"|"paused"|"finished"|"failed"|"offline"|"unknown", rawState, progress /* % */, layer, totalLayers,
  remainingMin, nozzle: [{ temp, target }], bed: { temp, target }, chamber, fans: { part, aux, chamber } /* % */, speedLevel, speedName, light,
  ams: [{ id, humidity, temp, trays: [{ slot, index, type, color, remain }] }], errors: [{ code, text, link? }], job: { name, file }, hot, updatedAt, error }
```

**Rules for adapters:**
- **Refuse temperatures above the model's limit.** Throw a plain-English error; never clamp silently.
- **Don't implement safety beyond that.** The framework asks for the yes, checks the bed and logs.
- **Map the brand's states onto the list above.** The monitor starts and ends a print's watching on the transitions into and out of `printing` / `preparing` / `paused`.
- **Make the camera a source.** `camera-bridge.mjs` registers it with `lib/cameras`, so the shared monitor takes the pictures and the Cameras page can show it. A printer with no camera can borrow one (`cameraId`), or use a snapshot URL (`cameraUrl`). With neither, the owner is asked to check the bed himself every time.
- **Write a simulator and a test** that speak the real protocol. See `scripts/qa/fixtures/printers/sims.mjs`, which has an aedes MQTT broker over TLS, implicit FTPS, the TLS camera, Marlin on TCP, OctoPrint and Moonraker.

## Adding the next brand

**Creality with Klipper (K1, K1 Max, Ender 3 V3, or any Ender with a Klipper Pi):** Moonraker already works (`brand: "moonraker"`). Root the K1's stock firmware or use Creality's Moonraker port. Nothing new is needed.

**Creality over OctoPrint:** `brand: "octoprint"` works today.

**Prusa (MK4, MINI, XL, CORE One) with PrusaLink:**
1. Make `lib/printers/prusalink.mjs`, a `HostPrinter` like the ones in `hosts.mjs`, with the `X-Api-Key` header (PrusaLink → Settings).
2. Status: `GET /api/v1/status` gives `printer.state` (`IDLE|BUSY|PRINTING|PAUSED|FINISHED|STOPPED|ERROR|ATTENTION`), `printer.temp_nozzle` / `target_nozzle` / `temp_bed` / `target_bed`, and `job.progress` / `time_remaining`.
3. Control: `PUT /api/v1/job/{id}/pause|resume` and `DELETE /api/v1/job/{id}`.
4. Upload and print: `PUT /api/v1/files/usb/{name}` with `Print-After-Upload: 1`.
5. Camera: `GET /api/v1/cameras/snap` (if a camera is set up), otherwise borrow one.
6. Add `prusalink: { meta, create }` to `ADAPTERS` in `index.mjs`, an option in `public/printers-settings.js`, and `scripts/qa/printers-prusa.mjs` with a small HTTP simulator.

## Bambu notes (checked September 2026)

- **Topics:** `device/<serial>/report` and `device/<serial>/request`, user `bblp`, password = the access code.
- **Report shapes:** P1/A1 send partial reports, so `protocol.merge()` merges them. H2D packs its temperatures, with the low 16 bits the current value and the high 16 bits the target, in `print.device.extruder.info[].temp` and `print.device.ctc.info.temp`.
- **`project_file`:**
  - `param: "Metadata/plate_N.gcode"` and `ams_mapping` (tray per filament, `-1` for the external spool).
  - The `url` is `file:///sdcard/<file>` on P1/A1 and `ftp://<file>` on X1/H2.
  - H2 also gets `ams_mapping2: [{ ams_id, slot_id }]`.
- **Authorization Control** (2025): the printer answers a refused command with `result: "fail"`. The adapter waits briefly for that answer and explains Developer mode. Status keeps working.
- **Cameras:**
  - X1 / H2 / P2S: RTSPS on 322. H2 also needs "LAN Only Liveview" turned on.
  - P1 / A1: TLS on 6000, with the 80-byte auth packet `0x40, 0x3000, 0, 0, "bblp"[32], code[32]` and then 16-byte frame headers.
  - X2D uses Bambu's BRTC and isn't supported.

## Tests

| Command | Covers |
|---|---|
| `node scripts/qa/printers-bambu.mjs` | Status parsing (X1, P1 partial, H2D), commands, connect / access code, upload + `project_file`, the bed check (clear, part, purge line, thresholds, the region, the AI stricter-only), the start rules, failure/stringing/detached sequences, keep/delete, auto-pause off, auto-start, Developer mode off, the X1 camera via ffmpeg, the remote API |
| `node scripts/qa/printers-ender.mjs` | Marlin streaming with a resend, busy waits, pause/resume, stop, the host thermal check, Marlin's own thermal runaway, the cable pulled, the PC held awake; OctoPrint; Moonraker |
