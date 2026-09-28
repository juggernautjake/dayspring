// Camera brands: where each one keeps its live stream and its still picture, so adding a camera is "pick the brand, type
// its address and password". {host} {port} {user} {pass} {channel} {name} are filled in; the password never sits in the
// saved address (lib/cameras/secret.mjs). "Other" takes any address. The notes are shown in Settings → Cameras.
//   PRESETS · preset(id) · build(id, { host, port, channel, name, sub }) → { url, snapshotUrl, mjpegUrl, onvifPort, auth }
//   TRAIL · trailBrand(id)   (how each cellular trail / hunting camera brand can reach Dayspring: docs/cameras.md)
export const PRESETS = [
  { id: "reolink", label: "Reolink", kind: "rtsp", port: 554,
    url: "rtsp://{user}:{pass}@{host}:{port}/h264Preview_{ch2}_{stream}", sub: "sub", main: "main",
    snapshotUrl: "http://{host}/cgi-bin/api.cgi?cmd=Snap&channel={ch0}&rs=dayspring&user={user}&password={pass}", auth: "query", onvifPort: 8000,
    note: "Turn on RTSP (and ONVIF) in the Reolink app: Settings → Network → Advanced → Server Settings. Newer 4K models use h265Preview_01_main; battery models (Argus) have no RTSP unless they sit on a Reolink Home Hub or NVR." },
  { id: "amcrest", label: "Amcrest", kind: "rtsp", port: 554,
    url: "rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype={stream}", sub: "1", main: "0",
    snapshotUrl: "http://{host}/cgi-bin/snapshot.cgi?channel={channel}", auth: "digest", onvifPort: 80, recordings: "dahua",
    note: "Amcrest is built on Dahua. The snapshot uses digest sign-in. Recordings on the SD card can be listed and played." },
  { id: "dahua", label: "Dahua (and Lorex, many NVRs)", kind: "rtsp", port: 554,
    url: "rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype={stream}", sub: "1", main: "0",
    snapshotUrl: "http://{host}/cgi-bin/snapshot.cgi?channel={channel}", auth: "digest", onvifPort: 80, recordings: "dahua",
    note: "Channel is the camera's number on an NVR (1 for a single camera)." },
  { id: "hikvision", label: "Hikvision (and Annke, many NVRs)", kind: "rtsp", port: 554,
    url: "rtsp://{user}:{pass}@{host}:{port}/Streaming/Channels/{channel}0{streamN}", sub: "2", main: "1",
    snapshotUrl: "http://{host}/ISAPI/Streaming/channels/{channel}01/picture", auth: "digest", onvifPort: 80, recordings: "hikvision",
    note: "ONVIF and RTSP may need turning on under Configuration → Network → Advanced Settings → Integration Protocol (make an ONVIF user there)." },
  { id: "wyze", label: "Wyze (RTSP firmware)", kind: "rtsp", port: 554,
    url: "rtsp://{user}:{pass}@{host}:{port}/live", sub: "live", main: "live",
    note: "Only older models (Cam v2, Pan v1) with Wyze's RTSP firmware; set the RTSP user and password in the Wyze app (Advanced Settings → RTSP). For any Wyze camera, docker-wyze-bridge is the reliable route: pick \"Wyze via docker-wyze-bridge\"." },
  { id: "wyze-bridge", label: "Wyze via docker-wyze-bridge", kind: "rtsp", port: 8554,
    url: "rtsp://{host}:{port}/{name}", sub: "{name}-sub", main: "{name}",
    snapshotUrl: "http://{host}:5000/img/{name}.jpg", auth: "none",
    note: "docker-wyze-bridge (free, runs in Docker on any computer) signs in to your Wyze account and re-shares every camera over RTSP. Camera name = the name in the bridge, lower case with dashes (front-door). The bridge's web page (port 5000) lists each one." },
  { id: "tapo", label: "TP-Link Tapo C-series", kind: "rtsp", port: 554,
    url: "rtsp://{user}:{pass}@{host}:{port}/stream{streamN}", sub: "2", main: "1", onvifPort: 2020,
    note: "In the Tapo app: the camera → Settings → Advanced Settings → Camera Account. Make a user name and password there; that's the one to use here (not your TP-Link account). ONVIF is on port 2020." },
  { id: "eufy", label: "Eufy (RTSP where supported)", kind: "rtsp", port: 554,
    url: "rtsp://{user}:{pass}@{host}:{port}/live0", sub: "live0", main: "live0",
    note: "Only some Eufy models have RTSP (Indoor Cam, some floodlight and wired cameras, and cameras on HomeBase 3 with \"NAS (RTSP)\" turned on in the app's Storage settings). The app shows the exact address. Battery cameras sleep between events and often can't be watched live." },
  { id: "onvif", label: "Any ONVIF camera", kind: "onvif", port: 80, onvifPort: 80,
    note: "Most IP cameras speak ONVIF. Use Discover to find it, or type its address; Dayspring asks the camera for its stream and snapshot addresses." },
  { id: "generic-rtsp", label: "Other (RTSP address)", kind: "rtsp", port: 554, url: "", note: "Paste the RTSP address from the camera's manual or app. rtsp://user:password@address:554/… is fine: the password is taken out and stored encrypted." },
  { id: "generic-http", label: "Other (snapshot or MJPEG address)", kind: "http", port: 80, url: "", note: "A picture address (…/snapshot.jpg) or an MJPEG stream (…/video.mjpg, …/mjpg/video.mjpg)." },
];
export const preset = (id) => PRESETS.find((p) => p.id === id) ?? null;

// Fill a preset in (the address keeps {user}/{pass} until it's used)
export function build(id, { host = "", port = null, channel = 1, name = "", sub = false } = {}) {
  const p = preset(id);
  if (!p) throw new Error("I don't know that camera brand.");
  const stream = sub ? p.sub : p.main;
  const ch = Math.max(1, Number(channel) || 1);
  const f = (t) => (t ? String(t)
    .replace(/\{host\}/g, host).replace(/\{port\}/g, String(port || p.port))
    .replace(/\{ch0\}/g, String(ch - 1)).replace(/\{ch2\}/g, String(ch).padStart(2, "0")).replace(/\{channel\}/g, String(ch))
    .replace(/\{streamN\}/g, String(stream)).replace(/\{stream\}/g, String(stream).replace(/\{name\}/g, name)).replace(/\{name\}/g, name) : "");
  return { url: f(p.url), snapshotUrl: f(p.snapshotUrl), mjpegUrl: f(p.mjpegUrl), onvifPort: p.onvifPort ?? null, auth: p.auth ?? "basic", recordings: p.recordings ?? null };
}

// ---- cellular trail / hunting cameras: no brand has a public API (September 2026) ----
// email: the camera (or its app) can send each photo to an email address → an "email camera" reads them (lib/mail).
// folder: the vendor's desktop app, or an SD-card reader, puts photos in a folder → a "folder camera" watches it.
export const TRAIL = [
  { id: "spypoint", label: "Spypoint", from: "spypoint", routes: ["email", "folder"], note: "The Spypoint app can forward photos to an email address (camera settings → notifications / photo forwarding, depending on the plan). No public API; the unofficial ones break when the app changes." },
  { id: "tactacam", label: "Tactacam Reveal", from: "tactacam|revealcellcam", routes: ["email", "folder", "homeassistant"], note: "Reveal can email notifications with the photo link on some plans. There's an unofficial Home Assistant integration (HomeAssistant-Tactacam); with it, use the Home Assistant camera type." },
  { id: "moultrie", label: "Moultrie Mobile", from: "moultrie", routes: ["email", "folder"], note: "Moultrie Mobile can send email notifications for new photos (app → account → notifications). Photos arrive as links, which Dayspring fetches." },
  { id: "bushnell", label: "Bushnell CelluCORE / Impulse", from: "bushnell|wireless\\.bushnell", routes: ["email", "folder"], note: "Bushnell's app can deliver new photos to your email." },
  { id: "browning", label: "Browning Defender / Covert", from: "browning|covert", routes: ["email", "folder"], note: "The Covert/Browning app can email photos from some cameras; otherwise save them to a folder." },
  { id: "stealthcam", label: "Stealth Cam (Command Pro)", from: "stealthcam|command ?pro", routes: ["folder", "email"], note: "Save photos from the Command Pro app to a synced folder (OneDrive, Google Drive) that Dayspring watches." },
  { id: "sdcard", label: "Any trail camera (SD card)", from: "", routes: ["folder"], note: "Put the SD card's DCIM folder (or a folder you copy the photos into) in a folder camera. Each new photo becomes an event." },
  { id: "other", label: "Other cellular camera", from: "", routes: ["email", "folder"], note: "If it can email photos, use an email camera and set the sender. If its app can save photos, use a folder camera." },
];
export const trailBrand = (id) => TRAIL.find((t) => t.id === id) ?? null;
