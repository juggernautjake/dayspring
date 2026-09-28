# Cameras

Dayspring can watch webcams, security cameras, GoPros and trail cameras. It checks each one on a schedule, or watches for motion. When something matters (a person, a deer, a car, a package, or anything you ask about), it tells you. It keeps the pictures and clips you want and deletes the rest.

Everything is in **Settings → Cameras** (under Apps & connections). To see your cameras, press **📷 Cameras** by the clock, or say "show me the cameras".

> Cameras are new, and they're in the development version of Dayspring first.

## What you can say

- "Show me the front camera" / "show me the cameras"
- "Any activity on the trail cam?" / "any deer last night?"
- "Play last night's deer clip"
- "What happened in the shop today?"
- With an AI that can see pictures, and **Analyse with AI** on for that camera: "What does the garage camera see?"

These work without an AI too, except the last one.

## Supported cameras

| Type | How Dayspring reads it | Live view | Clips | The camera's own recordings |
|---|---|---|---|---|
| **USB webcam** | Windows' DirectShow, through ffmpeg (Dayspring already has it) | ✓ | ✓ | – |
| **IP / security camera** (RTSP) | The camera's RTSP stream, plus its snapshot address if it has one | ✓ | ✓ | Dahua / Amcrest / Lorex and Hikvision / Annke |
| **ONVIF camera** | Found on your network; the camera tells Dayspring its stream and snapshot addresses | ✓ | ✓ | ONVIF Profile G cameras |
| **Picture or MJPEG address** | Plain HTTP (Basic or Digest sign-in) | ✓ (MJPEG, or a picture every second) | MJPEG only | – |
| **GoPro** (HERO9 and newer) | Open GoPro, GoPro's own API, over USB or the GoPro's Wi-Fi | ✓ (preview) | ✓ | ✓ photos and videos on its card |
| **Home Assistant camera** | Your Home Assistant connection | ✓ | – | – |
| **Trail camera by email** | The photo emails, read through your email accounts | – | – | – |
| **Trail camera / photo folder** | A folder the camera's app syncs to, or an SD card | – | – | ✓ videos in the folder |
| **3D printer cameras** | Added by the printers feature | depends | depends | – |

### Brand presets

Pick the brand and type the camera's address. **Fill in the addresses** then writes the stream and picture addresses for you.

| Brand | Stream (main) | Notes |
|---|---|---|
| **Reolink** | `rtsp://user:pass@IP:554/h264Preview_01_main` (sub: `_sub`) | Turn on RTSP and ONVIF in the app: Settings → Network → Advanced → Server Settings. 4K models may use `h265Preview_01_main`. Battery models (Argus) need a Home Hub or NVR. |
| **Amcrest, Dahua, Lorex** | `rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0` (sub: `subtype=1`) | Snapshot: `http://IP/cgi-bin/snapshot.cgi` (Digest). SD-card recordings can be listed and played. |
| **Hikvision, Annke** | `rtsp://user:pass@IP:554/Streaming/Channels/101` (sub: `102`) | Snapshot: `http://IP/ISAPI/Streaming/channels/101/picture`. ONVIF may need turning on (Network → Advanced → Integration Protocol). |
| **Wyze** | `rtsp://user:pass@IP/live` (RTSP firmware, Cam v2 / Pan v1 only) | For any other Wyze camera, run **docker-wyze-bridge**. Its cameras are `rtsp://BRIDGE:8554/camera-name`, with pictures at `http://BRIDGE:5000/img/camera-name.jpg`. |
| **TP-Link Tapo C-series** | `rtsp://user:pass@IP:554/stream1` (sub: `stream2`) | Make a **Camera Account** in the Tapo app (the camera → Settings → Advanced Settings). Use that account, not your TP-Link account. ONVIF is on port 2020. |
| **Eufy** | `rtsp://user:pass@IP:554/live0` | Only some models have RTSP. Turn on "NAS (RTSP)" in the app, which shows the exact address. Battery cameras sleep between events. |

### Finding your camera's RTSP address

1. **Try Discover first.** Choose **ONVIF camera** and press **Find ONVIF cameras**. Most IP cameras answer, and Dayspring asks the camera for its own addresses. Some cameras need ONVIF turned on in their settings first.
2. **Look in the camera's app or web page.** Search its settings for "RTSP", "stream URL" or "NAS". The address usually starts with `rtsp://`.
3. **Find the camera's IP address.** Your router's list of connected devices shows it, or the camera's app does (under device info). Setting a fixed ("reserved") address in the router keeps it from changing.
4. **Check the brand table above.** Model numbers and firmware differ, so if the preset doesn't work, check the manual.
5. **Use the sub-stream** ("smaller") where you can. It's less work for this computer, and plenty for motion checks.

You can paste an address with the password in it (`rtsp://admin:secret@…`). Dayspring takes the password out and stores it encrypted.

## GoPro

GoPro's own API, **Open GoPro**, works on the HERO9 and newer.

- **Over USB (the easy way):** plug the GoPro into this computer, then type its **serial number** in Settings. It's on the box, or in the GoPro's Preferences → About. The GoPro shows up as a network adapter, and Dayspring turns on wired control by itself.
- **Over its Wi-Fi:** turn on the GoPro's Wi-Fi (in the Quik app, or the camera's Connections menu), then join this computer to that network. While connected, this computer has no internet on Wi-Fi.
- **Pictures** can be real photos (the sharpest; Dayspring takes a photo and downloads it) or frames from the live preview.
- **Recordings:** the photos and videos on the GoPro's card are listed on the camera's page, and you can play them there.
- **Webcam mode:** with the GoPro Webcam app (or plain USB on the HERO12 and newer), the GoPro is a normal webcam. Add it as a **USB webcam**.

| Model | Open GoPro (pictures, live, media) | Webcam |
|---|---|---|
| HERO13, HERO12 | ✓ | USB webcam, or the GoPro Webcam app |
| HERO11 (and Mini), HERO10 | ✓ | GoPro Webcam app |
| HERO9 (firmware 1.60 or later) | ✓ | GoPro Webcam app |
| HERO8 | ✗ | GoPro Webcam app (webcam firmware) |
| MAX, HERO7 and older | ✗ | ✗ |

Camera-on-the-home-network mode (COHN, HERO12 and newer) isn't supported yet.

## Trail and hunting cameras

**No cellular trail-camera brand has a public API** (checked September 2026). Their photos go to the company's cloud and its phone app. There are unofficial tools that pretend to be the app, but they break when the app changes and may break the company's terms, so Dayspring doesn't use them. It has two reliable ways in:

- **By email.** Many brands can email each new photo, or a notification with a link to it. Add a **Trail camera by email** and say who the emails come from (for example `spypoint`). Dayspring reads those emails through your email accounts (Settings → Email) without marking them read. It takes the photo from the attachment, or fetches it from the link (public addresses only).
- **By folder.** If the brand's app or website can save photos, save them to a folder that syncs to this computer (OneDrive, Google Drive, Dropbox). You can also put the SD card's `DCIM` folder in. Add a **Trail camera or photo folder** and allow Dayspring to read that folder in Settings → Permissions. New photos become events, and videos in the folder show as the camera's recordings.

| Brand | Best route | Notes |
|---|---|---|
| **Spypoint** | Email, or a folder | The app can forward photos to an email address (depends on the plan). |
| **Tactacam Reveal** | Email or a folder; or Home Assistant | There's an unofficial Home Assistant integration (HomeAssistant-Tactacam). With it, add the camera as a **Home Assistant camera**. |
| **Moultrie Mobile** | Email | Email notifications include a link to the photo, which Dayspring fetches. |
| **Bushnell** (CelluCORE, Impulse) | Email | The app can deliver new photos by email. |
| **Browning** (Defender) / **Covert** | Email or a folder | Some cameras can email photos. |
| **Stealth Cam** (Command Pro) | A folder | Save photos from the app to a synced folder. |
| **Any camera with an SD card** | A folder | Copy the photos in, or point it at the card's DCIM folder. |

A photo from a trail camera is already a "something moved" moment, so each new one is an event. With **Analyse with AI**, Dayspring says what's in it ("a doe", "two turkeys", "a person"). If it sees nothing that matters, the photo is kept but you aren't alerted. Ask "any deer last night?" and you'll hear something like "Last night on the trail cam: 3 deer visits".

The first time Dayspring looks at a folder or a mailbox, it takes only the newest photo. The rest are marked as seen, so an old card isn't fifty alerts.

## How checking works

Each camera has a schedule in **Checking**:

- **A picture every few minutes.** Dayspring compares each picture with the last one.
- **Watch for motion.** A quick check every few seconds, done on this computer (no AI, no cost).
- **Not on a schedule.** Only when you look, or say "check the garage camera".

**Motion** is found on this computer. Small changes like sensor noise and light rain are ignored, and so is a whole-picture change like a light switching on or the camera switching to night vision. Drag on the preview to draw **the parts to watch** (up to 8 boxes). Motion outside them doesn't count, which is useful for a road or a tree that moves in the wind. **Sensitivity** sets how small a change counts.

**Analyse with AI** (off by default) sends a picture to your AI provider only when something moves, or on the schedule if you choose that. It's sent at most once a minute per camera. It answers "is there a person, an animal (a deer?), a vehicle, a package?" and your own question, like "tell me if there's a deer" or "is the garage door open?". If the AI sees nothing that matters (wind in the trees), it's not an event.

## Alerts

For each camera you choose:

- **Alert for:** people, deer, any animal, vehicles, packages, or any motion. Your own question matching always alerts.
- **Quiet hours** (like 10 p.m. to 6 a.m.). Alerts wait, and come out as one summary afterwards: "Trail cam: 3 deer visits overnight". Tick **People are urgent** to hear about people even in quiet hours.
- **Don't repeat within** a number of minutes. The same thing again isn't a new alert; it's counted into the next summary.
- **Send alerts to:**
  - **The Dayspring screen** shows a card with the picture.
  - **Say it out loud** waits until you've finished talking, and follows Quiet, Off and your notification settings. Camera alerts count as "System, updates and alerts".
  - **Your phone** gets a text, if Dayspring can text you.
  - **Your other devices** get it when you use Dayspring on more than one device.

## Keeping pictures and video

- **Keep:**
  - **Only events** (the default) keeps the pictures where something happened.
  - **Every picture** keeps a timeline of every scheduled picture.
  - **Let the feature decide** is for printers, which keep a picture only if something went wrong.
- **For N days:** anything older is deleted.
- **Record video:**
  - **A clip for each event** records the seconds before and after. The "before" part needs **Watch for motion**, because Dayspring keeps a few seconds of video in memory for it.
  - **All the time** records in pieces of a few minutes.
- **Storage:** pictures and clips go in Dayspring's data folder unless you pick another folder. Another folder needs "read and write" in Settings → Permissions. A **space limit** deletes the oldest files first when the storage is full. Dayspring only ever deletes files it made.
- A red **● REC** shows on the screen whenever a camera is being recorded, including the few seconds kept for "before" clips.

On the Cameras page, **Recordings** shows one camera's day as a timeline, with a mark for each event. Click a mark or a clip to play it. The camera's own page also lists what the camera keeps itself (its SD card, or the GoPro's card).

## Privacy and the law

- **Passwords** are encrypted with your Windows account (DPAPI). They're never shown again, never written to logs, and never included when Dayspring is shared.
- **Pictures stay on this computer.** They go to your AI provider only for cameras where you turn on **Analyse with AI**.
- **Faces:** Dayspring never recognises people on a camera unless you turn it on for that one camera, and face recognition is also on in Photos & people. It can never be turned on for a camera marked **public-facing** (one that sees a street, a sidewalk or a neighbour's property). Everyone else is described in general words ("a person in a red jacket"). The AI is always told not to identify anyone.
- **Recording sound:** recording conversations can need everyone's consent where you live (some US states need all parties to agree). Recording sound is off by default; turn it on only where that's allowed.
- **Neighbours and the street:** point cameras at your own property. Use the parts-to-watch boxes to leave out neighbours' windows and yards, and mark cameras that see public places as public-facing. Some places have rules about recording public areas or other people's property, so check your local laws.
- **Tell people** who live with you, or stay with you, that there are cameras, and where.
- The camera data (the `data` folder) is never part of an export or a shared copy of Dayspring.

## Troubleshooting

- **"The camera didn't accept the user name or password"**: some brands need a separate camera or ONVIF account (Tapo, Hikvision).
- **"Couldn't reach the camera"**: check its IP address, and that this computer is on the same network (not a guest network).
- **"The camera answered, but not at that path"**: the preset differs for your model. Paste the address from the camera's app or manual.
- **Too many alerts**: lower the sensitivity, draw the parts to watch, turn on Analyse with AI, or raise "don't repeat within".
- **Webcam "couldn't be opened"**: another app (Zoom, Teams, the Camera app) may be using it.
