// Cameras (lib/cameras), against simulators only: never a real camera, never the owner's network, never his data.
//   stand-ins: a network video stream (ffmpeg's test pattern with moving parts, served over HTTP; ffmpeg can't serve
//   RTSP to readers, so the RTSP path is checked by its arguments and the same reader is used on the HTTP stream), an
//   HTTP snapshot / MJPEG camera with Digest sign-in and a Reolink-style address, an ONVIF device (SOAP with WS-Security,
//   WS-Discovery over UDP to 127.0.0.1 only, Profile G recordings), the Open GoPro HTTP API, Home Assistant, and email /
//   folder trail-camera fixtures. Fixture pictures are drawn here (a yard, a person, a deer).
//   A. passwords: taken out of addresses, sealed (DPAPI round trip too), never in the file, the page or an error
//   B. motion on picture sequences: nothing, light change, a person, a deer, the region of interest, sensitivity; the AI
//      (mocked) only on motion and only when allowed, with a cost guard
//   C. face recognition: off by default, never on a public-facing camera
//   D. alert rules: labels, quiet hours, urgent, cooldown, summaries ("3 deer visits overnight"), channels
//   E. retention and the disk limit (and files that aren't Dayspring's are left alone)
//   F. clips (with and without the pre-event buffer), continuous recording, ● REC state
//   G. the recordings list and safe file serving
//   H. every source type against its simulator
//   I. the shared monitor: watch() with a registered (printer-style) camera, "delete if good", events and alerts
//   J. voice commands and tools
//   K. the real server on a throwaway copy, and headless Chrome: the Cameras page, Settings → Cameras, the screen's
//      ● REC sign and alert card inside the margins
//   node scripts/qa/cameras.mjs [--keep] [--no-ui]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createSocket } from "node:dgram";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import jpeg from "jpeg-js";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PW = process.env.QA_PLAYWRIGHT ?? pathToFileURL([join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const KEEP = process.argv.includes("--keep"), NO_UI = process.argv.includes("--no-ui");
const TMP = mkdtempSync(join(tmpdir(), "ds-cameras-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 300) + ")" : ""}`); };
const section = (t) => console.log(`\n-- ${t}`);
const SECRET = "Tr0ub4dor&3xyz";          // the made-up camera password (must never show up anywhere readable)

// in-process modules use throwaway files
Object.assign(process.env, {
  DAYSPRING_CAMERAS_FILE: join(TMP, "data", "cameras.json"), DAYSPRING_CAMERAS_DIR: join(TMP, "media"), DAYSPRING_CAMERAS_STATE: join(TMP, "data", "cameras-state.json"),
  DAYSPRING_TOKEN_CRYPTO: "fake", DAYSPRING_CONNECTORS_DIR: join(TMP, "connectors"), DAYSPRING_VISION_SETTINGS: join(TMP, "data", "vision.json"),
  DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"), AI_PROVIDER: "none", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", DAYSPRING_CHANNEL: "dev",
});
mkdirSync(join(TMP, "data"), { recursive: true });
const lib = (m) => import(pathToFileURL(join(DESK, "lib", m)).href);

// ---- fixture pictures: a yard (texture, fixed seed), a person (tall), a deer (wide body, legs), sensor noise ----
const W = 320, H = 180;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function scene({ noise = 0, bright = 0, seed = 1, draw = null } = {}) {
  const r = rng(7), n = rng(seed), px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, sky = y < 60;
    const base = sky ? [150, 180, 215] : [70 + 25 * Math.sin(x / 9) + 20 * r(), 110 + 20 * Math.cos(y / 7) + 20 * r(), 60 + 15 * r()];
    const j = noise ? (n() - 0.5) * 2 * noise : 0;
    px[i] = clamp(base[0] + bright + j); px[i + 1] = clamp(base[1] + bright + j); px[i + 2] = clamp(base[2] + bright + j); px[i + 3] = 255;
  }
  if (draw) draw((x0, y0, w, h, c) => { for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) { const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; } });
  return jpeg.encode({ data: px, width: W, height: H }, 88).data;
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const person = (x) => (rect) => { rect(x + 4, 70, 12, 12, [230, 190, 160]); rect(x, 82, 20, 50, [30, 40, 120]); rect(x + 2, 132, 7, 38, [25, 25, 30]); rect(x + 11, 132, 7, 38, [25, 25, 30]); };
const deer = (x) => (rect) => { rect(x, 122, 84, 24, [120, 80, 45]); rect(x + 76, 106, 14, 20, [120, 80, 45]); for (const lx of [4, 16, 62, 74]) rect(x + lx, 146, 5, 18, [90, 60, 35]); };
const small = (x) => (rect) => rect(x, 100, 5, 5, [10, 10, 10]);
const FIX = {
  still: [1, 2, 3, 4, 5, 6].map((s) => scene({ noise: 6, bright: (s % 3) - 1, seed: s })),
  light: scene({ noise: 4, bright: 55, seed: 9 }),
  person: [scene({ noise: 5, seed: 11 }), scene({ noise: 5, seed: 12, draw: person(60) }), scene({ noise: 5, seed: 13, draw: person(110) })],
  deer: [scene({ noise: 5, seed: 21 }), scene({ noise: 5, seed: 22, draw: deer(40) }), scene({ noise: 5, seed: 23, draw: deer(190) })],
  small: [scene({ noise: 2, seed: 31 }), scene({ noise: 2, seed: 32, draw: small(200) })],
};
const JPEG = FIX.deer[1];

// ---- the simulators ----------------------------------------------------------------------------------------------------
const md5 = (s) => createHash("md5").update(s).digest("hex");
const REALM = "IPCamera", NONCE = "a1b2c3d4e5f60718";
function digestOk(req, method, user, pass) {
  const h = req.headers.authorization ?? ""; if (!/^Digest /.test(h)) return false;
  const p = Object.fromEntries([...h.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map((m) => [m[1], m[2] ?? m[3]]));
  const ha1 = md5(`${user}:${REALM}:${pass}`), ha2 = md5(`${method}:${p.uri}`);
  const want = p.qop ? md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  return p.username === user && p.response === want;
}
const hits = { snap: 0, snapNoAuth: 0, mjpeg: 0, reolink: 0, onvif: [], gopro: [], ha: 0, basicSeen: 0 };
let gpFiles = [{ n: "GOPR0001.JPG", cre: "1790000000", s: "1234" }, { n: "GX010001.MP4", cre: "1790000100", s: "5678" }];
let realMp4 = null;
const sim = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname;
  const body = await new Promise((r) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => r(b)); });
  if (/^Basic /.test(req.headers.authorization ?? "")) hits.basicSeen++;
  const need = () => { res.writeHead(401, { "www-authenticate": `Digest realm="${REALM}", qop="auth", nonce="${NONCE}", opaque="op1", algorithm=MD5` }); res.end(); };
  // an IP camera: snapshot and MJPEG with Digest
  if (p === "/cgi-bin/snapshot.cgi") { if (!req.headers.authorization) { hits.snapNoAuth++; return need(); } if (!digestOk(req, "GET", "admin", SECRET)) return need(); hits.snap++; res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(JPEG); }
  if (p === "/video.mjpg") {
    if (!req.headers.authorization) return need(); if (!digestOk(req, "GET", "admin", SECRET)) return need();
    hits.mjpeg++; res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=cam" });
    let i = 0; const t = setInterval(() => { const f = FIX.person[i++ % 3]; res.write(`--cam\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\n\r\n`); res.write(f); res.write("\r\n"); }, 150);
    req.on("close", () => clearInterval(t)); return;
  }
  // Reolink: the password is in the address
  if (p === "/cgi-bin/api.cgi") { if (u.searchParams.get("user") !== "admin" || u.searchParams.get("password") !== SECRET) { res.writeHead(200, { "content-type": "application/json" }); return res.end('[{"code":1,"error":{"detail":"login failed"}}]'); } hits.reolink++; res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(FIX.deer[2]); }
  // ONVIF
  if (p.startsWith("/onvif/")) {
    const sec = /<(?:\w+:)?Username>([^<]*)<[\s\S]*?Password[^>]*>([^<]*)<[\s\S]*?Nonce[^>]*>([^<]*)<[\s\S]*?Created>([^<]*)</.exec(body);
    const ok = sec && sec[1] === "admin" && createHash("sha1").update(Buffer.concat([Buffer.from(sec[3], "base64"), Buffer.from(sec[4]), Buffer.from(SECRET)])).digest("base64") === sec[2];
    const op = /<(?:\w+:)?(Get\w+)[\s/>]/.exec(body.split(/<\w*:?Body>/)[1] ?? "")?.[1];
    hits.onvif.push(op + (ok ? "" : "!"));
    const env = (x) => `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:trt="http://www.onvif.org/ver10/media/wsdl"><SOAP-ENV:Body>${x}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    res.writeHead(ok ? 200 : 400, { "content-type": "application/soap+xml" });
    if (!ok) return res.end(env(`<SOAP-ENV:Fault><SOAP-ENV:Reason><SOAP-ENV:Text>Sender not Authorized</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>`));
    const base = `http://127.0.0.1:${sim.address().port}`;
    if (op === "GetCapabilities") return res.end(env(`<tds:GetCapabilitiesResponse xmlns:tds="x"><tds:Capabilities><tt:Media><tt:XAddr>http://10.9.9.9:80/onvif/media_service</tt:XAddr></tt:Media><tt:Extension><tt:Recording><tt:XAddr>${base}/onvif/recording</tt:XAddr></tt:Recording><tt:Replay><tt:XAddr>${base}/onvif/replay</tt:XAddr></tt:Replay></tt:Extension></tds:Capabilities></tds:GetCapabilitiesResponse>`));
    if (op === "GetProfiles") return res.end(env(`<trt:GetProfilesResponse><trt:Profiles token="main_1" fixed="true"><tt:Name>MainStream</tt:Name><tt:VideoEncoderConfiguration><tt:Resolution><tt:Width>2560</tt:Width><tt:Height>1440</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles><trt:Profiles token="sub_1"><tt:Name>SubStream</tt:Name></trt:Profiles></trt:GetProfilesResponse>`));
    if (op === "GetSnapshotUri") return res.end(env(`<trt:GetSnapshotUriResponse><trt:MediaUri><tt:Uri>${base}/cgi-bin/snapshot.cgi?channel=1&amp;x=1</tt:Uri></trt:MediaUri></trt:GetSnapshotUriResponse>`));
    if (op === "GetStreamUri") return res.end(env(`<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://127.0.0.1:1/Streaming/101</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse>`));
    if (op === "GetRecordings") return res.end(env(`<trc:GetRecordingsResponse xmlns:trc="y"><trc:RecordingItem><tt:RecordingToken>REC_0001</tt:RecordingToken><tt:Configuration><tt:Source><tt:Name>Front yard</tt:Name></tt:Source></tt:Configuration></trc:RecordingItem></trc:GetRecordingsResponse>`));
    if (op === "GetReplayUri") return res.end(env(`<trp:GetReplayUriResponse xmlns:trp="z"><trp:Uri>rtsp://127.0.0.1:1/replay/REC_0001</trp:Uri></trp:GetReplayUriResponse>`));
    return res.end(env("<x/>"));
  }
  // Open GoPro
  if (p.startsWith("/gopro/") || p.startsWith("/videos/")) {
    hits.gopro.push(p);
    const j = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (p === "/gopro/camera/shutter/start") { gpFiles.push({ n: `GOPR000${gpFiles.length + 1}.JPG`, cre: String(1790000200 + gpFiles.length), s: String(JPEG.length) }); return j({}); }
    if (p === "/gopro/camera/state") return j({ status: { 8: 0, 10: 0 }, settings: {} });
    if (p === "/gopro/media/list") return j({ id: "1", media: [{ d: "100GOPRO", fs: gpFiles }] });
    if (p.startsWith("/gopro/media/thumbnail")) { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(FIX.person[1]); }
    if (/^\/videos\/DCIM\/100GOPRO\/\w+\.JPG$/.test(p)) { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(JPEG); }
    if (/^\/videos\/DCIM\/100GOPRO\/\w+\.MP4$/.test(p)) { res.writeHead(200, { "content-type": "video/mp4", "content-length": realMp4.length }); return res.end(realMp4); }
    return j({});
  }
  // Home Assistant
  if (p.startsWith("/api/")) {
    if (req.headers.authorization !== "Bearer ha-token-for-tests-0123456789012345678901234567890") { res.writeHead(401); return res.end(); }
    hits.ha++;
    if (p === "/api/states") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify([{ entity_id: "camera.driveway", state: "idle", attributes: { friendly_name: "Driveway" } }, { entity_id: "light.kitchen", state: "on", attributes: {} }])); }
    if (p === "/api/camera_proxy/camera.driveway") { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(FIX.person[2]); }
    res.writeHead(404); return res.end();
  }
  // a public-looking photo link from a notification email (served here; the fetcher is mocked to come here)
  if (p === "/trail/photo123.jpg") { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(FIX.deer[1]); }
  res.writeHead(404); res.end();
});
await new Promise((r) => sim.listen(0, "127.0.0.1", r));
const SIM = `127.0.0.1:${sim.address().port}`;
// WS-Discovery responder (unicast on 127.0.0.1 only)
const wsd = createSocket("udp4");
wsd.on("message", (msg, rinfo) => {
  if (!/Probe/.test(msg.toString())) return;
  const m = `<?xml version="1.0"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><e:Body><d:ProbeMatches><d:ProbeMatch><d:Scopes>onvif://www.onvif.org/name/Yard%20Cam onvif://www.onvif.org/hardware/SIM-100</d:Scopes><d:XAddrs>http://${SIM}/onvif/device_service http://[fe80::1]/onvif/device_service</d:XAddrs></d:ProbeMatch></d:ProbeMatches></e:Body></e:Envelope>`;
  wsd.send(Buffer.from(m), rinfo.port, rinfo.address);
});
await new Promise((r) => wsd.bind(0, "127.0.0.1", r));

let server = null, browser = null, streamProc = null;
const APP = join(TMP, "app");
try {
  const ff = await lib("cameras/ffmpeg.mjs");
  // a real little MP4 for the GoPro and players (ffmpeg's test pattern, 2 s, 160×120)
  const mk = await ff.run(["-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4", "-y", join(TMP, "clip.mp4")], { timeoutMs: 30_000 });
  realMp4 = existsSync(join(TMP, "clip.mp4")) ? readFileSync(join(TMP, "clip.mp4")) : Buffer.alloc(0);
  check("ffmpeg made the test clip", realMp4.length > 1000, mk.stderr);

  // ================================================================= A. passwords
  section("A. passwords and addresses");
  const secret = await lib("cameras/secret.mjs");
  const config = await lib("cameras/config.mjs");
  const s1 = secret.splitUrl(`rtsp://admin:${encodeURIComponent(SECRET)}@192.168.1.20:554/h264Preview_01_main`);
  check("user:password@ is taken out of an RTSP address", s1.url === "rtsp://{user}:{pass}@192.168.1.20:554/h264Preview_01_main" && s1.username === "admin" && s1.password === SECRET, s1);
  const s2 = secret.splitUrl(`http://cam/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=${encodeURIComponent(SECRET)}`);
  check("?user=…&password=… is taken out of a snapshot address", s2.url.endsWith("user={user}&password={pass}") && s2.password === SECRET, s2);
  check("fill() puts them back (in memory only)", secret.fill(s1.url, "admin", SECRET).includes(encodeURIComponent(SECRET)));
  check("redact() hides passwords in text and addresses", !secret.redact(`rtsp://admin:${SECRET}@x/y and http://c/?password=${SECRET}&a=1`).includes(SECRET));
  const cam1 = config.add({ kind: "rtsp", name: "Front door", room: "porch", conn: { url: `rtsp://admin:${SECRET}@127.0.0.1:9/h264Preview_01_main`, snapshotUrl: `http://${SIM}/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=x&user=admin&password=${encodeURIComponent(SECRET)}` } });
  const onDisk = readFileSync(process.env.DAYSPRING_CAMERAS_FILE, "utf8");
  check("the saved file has no password in it", !onDisk.includes(SECRET) && !onDisk.includes(encodeURIComponent(SECRET)), onDisk.slice(0, 300));
  check("…the password is sealed", /"password": "(fake|dpapi):/.test(onDisk));
  check("…and comes back for use", config.creds(config.get(cam1.id)).password === SECRET);
  check("what the page sees has no password", !JSON.stringify(config.publicCam(config.get(cam1.id))).includes(SECRET) && config.publicCam(config.get(cam1.id)).conn.hasPassword === true);
  const cam1b = config.update(cam1.id, { room: "front porch" });
  check("editing without a new password keeps the old one", config.creds(cam1b).password === SECRET && cam1b.room === "front porch");
  // the real Windows protection, once (this Windows user; a throwaway value)
  const { dpapi } = await import(pathToFileURL(join(DESK, "vendor", "ecosystem-core", "lib", "credentials.mjs")).href);
  process.env.DAYSPRING_TOKEN_CRYPTO = "";
  secret._setCrypto(dpapi({ entropy: "dayspring-cameras-v1" }));
  const realSealed = secret.seal("not-a-real-password-42");
  secret._setCrypto(dpapi({ entropy: "dayspring-cameras-v1" }));          // (a fresh start: nothing remembered in memory)
  const back = (() => { try { return secret.unseal(realSealed); } catch (e) { return e.message; } })();
  check("DPAPI: sealed with Windows' own protection and opened again", /^dpapi:/.test(realSealed) && !realSealed.includes("not-a-real") && back === "not-a-real-password-42", back);
  process.env.DAYSPRING_TOKEN_CRYPTO = "fake"; secret._setCrypto(null);
  const bad = await ff.run(["-rw_timeout", "2000000", "-i", `http://admin:${SECRET}@127.0.0.1:1/x`, "-frames:v", "1", "-f", "null", "-"], { timeoutMs: 15_000 }).catch((e) => ({ stderr: e.message }));
  check("ffmpeg's errors never carry the password", !bad.stderr.includes(SECRET) && !ff.why(bad.stderr).includes(SECRET), bad.stderr.slice(0, 200));

  // ================================================================= B. motion
  section("B. motion on picture sequences (AI mocked)");
  const motion = await lib("cameras/motion.mjs");
  const run = (frames, o = {}) => { const d = motion.createDetector(o); return frames.map((f) => d.check(f)); };
  const r0 = run(FIX.still);
  check("a still yard with sensor noise and exposure wobble: no motion", r0.every((x) => !x.motion), r0.map((x) => x.score.toFixed(4)));
  const rl = run([FIX.still[0], FIX.light, FIX.light]);
  check("a light turned on (the whole picture changes): not motion", !rl[1].motion && rl[1].lighting === true && !rl[2].motion, rl);
  const rp = run(FIX.person);
  check("a person walking in: motion, tall shape", rp[1].motion && rp[1].shape === "tall", rp[1]);
  const rd = run(FIX.deer);
  check("a deer walking in: motion, wide shape", rd[1].motion && rd[1].shape === "wide", rd[1]);
  check("…and where it is (box on the left)", rd[1].box && rd[1].box.x < 0.2 && rd[1].box.w < 0.4, rd[1].box);
  const roiRight = run(FIX.deer.slice(0, 2), { roi: [{ x: 0.6, y: 0, w: 0.4, h: 1 }] });
  check("region of interest: a deer outside the watched part isn't motion", !roiRight[1].motion, roiRight[1]);
  const roiLeft = run(FIX.deer.slice(0, 2), { roi: [{ x: 0, y: 0.4, w: 0.5, h: 0.6 }] });
  check("…inside it, it is", roiLeft[1].motion, roiLeft[1]);
  check("sensitivity: a small far-off thing at 95", run(FIX.small, { sensitivity: 95 })[1].motion);
  check("…is ignored at 20", !run(FIX.small, { sensitivity: 20 })[1].motion);

  const analyze = await lib("cameras/analyze.mjs");
  const cams = await lib("cameras/index.mjs");
  let aiCalls = 0, aiSays = "deer", aiPrompts = [];
  analyze.setDeps({ supportsImages: async () => true, completeWithImage: async ({ prompt, system }) => { aiCalls++; aiPrompts.push(system + "\n" + prompt); return aiSays === "deer" ? '{"labels":[{"label":"white-tailed deer","confidence":0.92,"detail":"a doe"}],"summary":"A deer by the trees.","match":true,"answer":""}' : aiSays === "person" ? '{"labels":[{"label":"person","confidence":0.88,"detail":"a person in a blue coat"}],"summary":"A person walking past.","match":false}' : '{"labels":[],"summary":"Just the yard.","match":false}'; },
    faceSettings: async () => ({ faces: false }) });
  const trailCam = config.add({ kind: "folder", name: "Trail cam", role: "trail", conn: { folder: join(TMP, "trail") }, ai: { enabled: true, when: "motion", prompt: "tell me if there's a deer", watchFor: ["deer", "animal"] } });
  const aiOff = { ...config.get(cam1.id), ai: { enabled: false } };
  const aiOn = { ...config.get(cam1.id), id: "cam-ai-on", ai: { enabled: true, when: "motion", prompt: "tell me if there's a deer", watchFor: ["deer", "person"] } };
  const seq = async (cam, frames) => { const out = []; for (const f of frames) out.push(await cams.defaultAnalyze(cam, { camId: cam.id, jpeg: f, at: new Date().toISOString(), reason: "motion" }, [])); return out; };
  aiCalls = 0; const vNone = await seq(aiOn, FIX.still);
  check("no motion: no event, and the AI isn't asked (no cost)", vNone.every((v) => !v.event) && aiCalls === 0, { aiCalls });
  analyze._resetCooldown(); aiCalls = 0; aiSays = "deer";
  const vDeer = await seq({ ...aiOn, id: "cam-ai-deer" }, FIX.deer.slice(0, 2));
  check("a deer: the AI is asked once and says deer (with confidence)", aiCalls === 1 && vDeer[1].event && vDeer[1].labels[0].label === "deer" && vDeer[1].labels[0].confidence > 0.9, { aiCalls, v: vDeer[1] });
  check("…the camera's own question counts (\"tell me if there's a deer\" → match)", vDeer[1].match === true && aiPrompts.at(-1).includes("tell me if there's a deer"));
  check("…the AI is told never to identify anyone", /Never identify/i.test(aiPrompts.at(-1)));
  analyze._resetCooldown(); aiCalls = 0; aiSays = "person";
  const vPerson = await seq({ ...aiOn, id: "cam-ai-person" }, FIX.person.slice(0, 2));
  check("a person: labelled person, described generally", vPerson[1].event && vPerson[1].labels[0].label === "person" && !/Sam|Riley/.test(vPerson[1].summary), vPerson[1]);
  aiCalls = 0; await seq({ ...aiOn, id: "cam-ai-person" }, [FIX.person[0], FIX.person[2]]);
  check("the cost guard: a second motion within a minute doesn't ask the AI again", aiCalls === 0, { aiCalls });
  analyze._resetCooldown(); aiCalls = 0; aiSays = "empty";
  const vWind = await seq({ ...aiOn, id: "cam-ai-wind" }, FIX.deer.slice(0, 2));
  check("the AI sees nothing that matters (wind in the trees): not an event", !vWind[1].event && aiCalls === 1, vWind[1]);
  aiCalls = 0; const vOff = await seq({ ...aiOff, id: "cam-ai-off" }, FIX.deer.slice(0, 2));
  check("\"Analyse with AI\" off: pictures never go to the AI; motion is the event", aiCalls === 0 && vOff[1].event && vOff[1].labels[0].label === "motion", { aiCalls, v: vOff[1] });

  // ================================================================= C. faces
  section("C. face recognition off by default");
  let faceRuns = 0;
  analyze.setDeps({ identify: async () => { faceRuns++; return ["Test Person"]; } });
  check("a new camera has face recognition off", config.defaultsFor("rtsp", "security").faces === false && config.get(cam1.id).faces === false && config.get(trailCam.id).faces === false);
  analyze._resetCooldown(); aiSays = "person"; faceRuns = 0;
  await analyze.aiVerdict(FIX.person[1], { ...aiOn, id: "cam-f1" }, { force: true });
  check("…so faces are never looked at on it", faceRuns === 0);
  const pub = config.add({ kind: "rtsp", name: "Street", role: "security", publicFacing: true, faces: true, conn: { url: "rtsp://127.0.0.1:1/x" } });
  check("a public-facing camera can't have it turned on (saved off)", config.get(pub.id).faces === false);
  check("…and the gate says no even if asked directly", !(await analyze.faceAllowed({ faces: true, publicFacing: true })));
  check("turned on for a camera but off in Photos & people: still no", !(await analyze.faceAllowed({ faces: true, publicFacing: false })));
  analyze.setDeps({ faceSettings: async () => ({ faces: true }) });
  analyze._resetCooldown(); faceRuns = 0;
  const vf = await analyze.aiVerdict(FIX.person[1], { ...aiOn, id: "cam-f2", faces: true, publicFacing: false }, { force: true });
  check("opted in on one private camera (and on in Photos & people): used, names only there", faceRuns === 1 && aiPrompts.at(-1).includes("Test Person") && vf.names?.[0] === "Test Person");
  faceRuns = 0; await analyze.aiVerdict(FIX.person[1], { ...aiOn, id: "cam-f3", faces: true, publicFacing: true }, { force: true });
  check("…never on a public-facing one, even then", faceRuns === 0);
  analyze.setDeps({ faceSettings: async () => ({ faces: false }), identify: null });

  // ================================================================= D. alerts
  section("D. alert rules");
  const alerts = await lib("cameras/alerts.mjs");
  const state = await lib("cameras/state.mjs");
  const said = [], texts = [], bus = [];
  let clock = new Date(2026, 8, 28, 23, 30);
  alerts.setDeps({ now: () => clock, announce: async (it) => said.push(it), phone: async (t) => { texts.push(t); return { sent: true }; }, broadcast: async (t, d) => bus.push([t, d]), sinks: () => [async (c) => bus.push(["sink", c])] });
  const rules = { ...config.get(trailCam.id), alerts: { on: true, labels: ["deer", "person"], urgent: ["person"], quiet: { from: "22:00", to: "06:00" }, cooldownMin: 10, channels: { screen: true, voice: true, phone: false, devices: true }, summary: true } };
  const ev = (label, at, extra = {}) => ({ id: null, at: at.toISOString(), labels: [{ label, confidence: 0.9 }], summary: "", ...extra });
  check("quiet hours over midnight: 23:30 is quiet, 07:00 isn't", alerts.inQuiet({ from: "22:00", to: "06:00" }, new Date(2026, 8, 28, 23, 30)) && !alerts.inQuiet({ from: "22:00", to: "06:00" }, new Date(2026, 8, 29, 7, 0)));
  const d1 = alerts.consider(ev("deer", clock), rules);
  check("a deer in quiet hours waits (held for the summary)", !d1.send && d1.reason === "quiet hours" && d1.held);
  clock = new Date(2026, 8, 29, 1, 0); alerts.consider(ev("deer", clock), rules);
  clock = new Date(2026, 8, 29, 3, 15); alerts.consider(ev("deer", clock), rules);
  const dP = alerts.consider(ev("person", clock), rules);
  check("a person is urgent: alerts even in quiet hours", dP.send && dP.reason === "urgent", dP);
  check("a label nobody asked for doesn't alert", !alerts.consider(ev("vehicle", clock), rules).send);
  check("low confidence doesn't alert", !alerts.consider({ at: clock.toISOString(), labels: [{ label: "deer", confidence: 0.2 }] }, { ...rules, alerts: { ...rules.alerts, quiet: null } }).send);
  clock = new Date(2026, 8, 29, 5, 50); await alerts.tick([rules]);
  check("nothing comes out while it's still quiet", said.length === 0);
  clock = new Date(2026, 8, 29, 6, 1); await alerts.tick([rules]);
  check("when quiet hours end: one summary, \"3 deer visits overnight\"", said.length === 1 && /3 deer visits overnight/.test(said[0].text), said.map((x) => x.text));
  check("…the summary doesn't text the phone", texts.length === 0);
  state._reset(); said.length = 0;
  const cool = { ...rules, id: "cam-cool", alerts: { ...rules.alerts, quiet: null, cooldownMin: 10 } };
  clock = new Date(2026, 8, 29, 9, 0);
  const c1 = alerts.consider(ev("deer", clock), cool); clock = new Date(2026, 8, 29, 9, 4);
  const c2 = alerts.consider(ev("deer", clock), cool); clock = new Date(2026, 8, 29, 9, 11);
  const c3 = alerts.consider(ev("deer", clock), cool);
  check("cooldown: alert, then the same thing 4 minutes later is held, then 11 minutes later alerts again", c1.send && !c2.send && c2.reason === "cooldown" && c3.send, [c1.reason, c2.reason, c3.reason]);
  const got = await alerts.deliver({ text: "Trail cam: a deer.", labels: ["deer"] }, { ...cool, alerts: { ...cool.alerts, channels: { screen: true, voice: false, phone: true, devices: true } } });
  check("channels: screen only (not spoken) → silent announcement", said.at(-1)?.mode === "silent" && said.at(-1)?.kind === "camera");
  check("…the phone gets a text when that's on", texts.length === 1 && got.phone === true);
  check("…other devices get it (listener + bus event)", got.devices === 1 && bus.some(([t]) => t === "camera-alert-devices") && bus.some(([t]) => t === "camera-alert"));
  check("counting visits: events close together are one visit", alerts.visitsText(alerts.countVisits([{ at: "2026-09-29T01:00:00Z", labels: ["deer"] }, { at: "2026-09-29T01:03:00Z", labels: ["deer"] }, { at: "2026-09-29T02:00:00Z", labels: ["deer"] }, { at: "2026-09-29T02:10:30Z", labels: ["person"] }])) === "2 deer visits and 1 person visit");

  // ================================================================= E. retention and disk
  section("E. retention and the disk limit");
  const events = await lib("cameras/events.mjs");
  const old = events.save("cam-ret", FIX.still[0], { at: new Date(Date.now() - 20 * 864e5).toISOString(), labels: [{ label: "deer", confidence: 1 }] });
  const recent = events.save("cam-ret", FIX.still[1], { labels: [{ label: "deer", confidence: 1 }] });
  const oldFile = events.fileFor("cam-ret", old.day, old.file);
  utimesSync(oldFile, new Date(Date.now() - 20 * 864e5), new Date(Date.now() - 20 * 864e5));
  const mine = join(events.camDir("cam-ret"), old.day, "my-own-photo.jpg"); writeFileSync(mine, "not Dayspring's");
  const sw = events.sweep([{ id: "cam-ret", retention: { mode: "events", days: 14 } }], { capBytes: 1e12 });
  check("older than the camera's days: removed", sw.removed === 1 && !existsSync(oldFile) && !events.get(old.id), sw);
  check("recent: kept", Boolean(events.get(recent.id)) && existsSync(events.fileFor("cam-ret", recent.day, recent.file)));
  check("a file that isn't Dayspring's is never touched", existsSync(mine));
  const big = Buffer.alloc(200_000, 1);
  const saved = []; for (let i = 0; i < 6; i++) { const r = events.save("cam-cap", big, { at: new Date(Date.now() - (6 - i) * 60_000).toISOString() }); saved.push(r); utimesSync(events.fileFor("cam-cap", r.day, r.file), new Date(Date.now() - (6 - i) * 60_000), new Date(Date.now() - (6 - i) * 60_000)); }
  const before = events.usage().bytes;
  const sw2 = events.sweep([{ id: "cam-cap", retention: { days: 365 } }, { id: "cam-ret", retention: { days: 365 } }], { capBytes: 700_000 });
  check("over the space limit: oldest files go until it's under 90%", events.usage().bytes <= 630_000 && sw2.removed >= 3 && before > 700_000, { before, after: events.usage().bytes, sw2 });
  check("…newest kept, oldest gone, index follows", Boolean(events.get(saved.at(-1).id)) && !events.get(saved[0].id));

  // ================================================================= F. clips and recording
  section("F. clips, continuous recording, ● REC");
  const recorder = await lib("cameras/recorder.mjs");
  const LAV = ["-re", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10"];
  const recState = []; recorder.onChange((a) => recState.push(a.slice()));
  const out1 = join(TMP, "clips", "direct.mp4");
  const f1 = await recorder.clip("cam-clip", LAV, { preSec: 0, postSec: 2, out: out1, copy: false });
  const d1s = f1 ? await ff.duration(f1) : null;
  check("a clip from the moment of the event (2 s)", f1 && d1s > 1.5 && d1s < 3.5, d1s);
  check("…● REC was on while it recorded, off after", recState.some((a) => a.includes("cam-clip")) && !recorder.active().includes("cam-clip"));
  recorder.buffer("cam-buf", LAV, { copy: false, segSec: 1, keep: 10 });
  check("the pre-event buffer counts as recording", recorder.active().includes("cam-buf"));
  await sleep(4500);
  const out2 = join(TMP, "clips", "prebuf.mp4");
  const f2 = await recorder.clip("cam-buf", LAV, { preSec: 3, postSec: 1, out: out2, copy: false, at: Date.now() });
  const d2s = f2 ? await ff.duration(f2) : null;
  check("a clip with 3 s before the event and 1 s after (from the buffer)", f2 && d2s >= 3 && d2s <= 7.5, d2s);
  recorder.stopBuffer("cam-buf");
  check("stopping it: ● REC off", !recorder.active().includes("cam-buf"));
  recorder.continuous("cam-cont", LAV, { segmentMin: 0.05, copy: false });
  await sleep(7500); recorder.stop("cam-cont"); await sleep(2500);
  const contFiles = existsSync(events.continuousDir("cam-cont")) ? readdirSync(events.continuousDir("cam-cont")) : [];
  check("continuous recording: pieces with their start time in the name", contFiles.length >= 2 && contFiles.every((f) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/.test(f)), contFiles);
  check("…the last piece is finished properly (it plays)", contFiles.length && (await ff.duration(join(events.continuousDir("cam-cont"), contFiles.sort().at(-1)))) > 0);

  // ================================================================= G. recordings list
  section("G. the recordings list");
  const evc = events.save("cam-cont", FIX.deer[1], { labels: [{ label: "deer", confidence: 0.9 }], summary: "A deer." });
  writeFileSync(events.clipPathFor(evc.id), realMp4); events.attachClip(evc.id);
  const rl2 = events.recordings({ cam: "cam-cont", day: evc.day });
  check("a day's recordings: the event clip, the continuous pieces, the event markers", rl2.clips.length === 1 && rl2.clips[0].url.endsWith(".mp4") && rl2.continuous.length >= 2 && rl2.events.length === 1, { c: rl2.clips.length, k: rl2.continuous.length, e: rl2.events.length });
  check("days with recordings are listed newest first", events.days("cam-cont")[0] === evc.day);
  check("file serving: only Dayspring's own names", events.fileFor("cam-cont", evc.day, events.get(evc.id).clip) && !events.fileFor("cam-cont", evc.day, "..\\..\\cameras.json") && !events.fileFor("..", evc.day, evc.file) && !events.fileFor("cam-ret", old.day, "my-own-photo.jpg"));
  check("events: filtered by label", events.list({ cam: "cam-cont", label: "deer" }).length === 1 && events.list({ cam: "cam-cont", label: "person" }).length === 0);

  // ================================================================= H. every source type
  section("H. sources against their simulators");
  const stream = await lib("cameras/sources/stream.mjs");
  check("RTSP: read over TCP with a time limit", stream.streamInput("rtsp://h/x").join(" ") === "-rtsp_transport tcp -timeout 10000000 -probesize 500000 -analyzeduration 1000000 -i rtsp://h/x");
  // the network stream: ffmpeg's moving test pattern served over HTTP (one client per start)
  const servePort = 40000 + Math.floor(Math.random() * 2000);
  const serveStream = (port = servePort) => { streamProc = ff.spawnFfmpeg(["-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-g", "10", "-f", "mpegts", "-listen", "1", `http://127.0.0.1:${port}/live.ts`]); };
  serveStream(); await sleep(1200);
  const netCam = config.add({ kind: "rtsp", name: "Garage", room: "garage", conn: { url: `http://127.0.0.1:${servePort}/live.ts` } });
  const snapNet = await cams.snapshot(netCam.id).catch((e) => e.message);
  check("network stream (the RTSP reader): a picture", Buffer.isBuffer(snapNet) && ff.isJpeg(snapNet), snapNet);
  try { streamProc.kill(); } catch { /* gone */ }
  serveStream(servePort + 1); await sleep(1200);
  const liveFrames = []; let liveEnd = null;
  config.update(netCam.id, { conn: { url: `http://127.0.0.1:${servePort + 1}/live.ts` } });
  const lh = cams.source(netCam.id).live({ fps: 4, width: 160 }, (j) => liveFrames.push(j), (w) => { liveEnd = w; });
  await sleep(3500); lh.stop();
  const lm = motion.createDetector({ sensitivity: 60 }); const lr = liveFrames.map((f) => lm.check(f));
  check("…a low-rate live view: several frames", liveFrames.length >= 5, liveFrames.length);
  check("…and the moving pattern is seen as motion", lr.some((x) => x.motion), lr.map((x) => x.score.toFixed(3)));
  try { streamProc.kill(); } catch { /* gone */ }
  // RTSP preset with a snapshot address (Reolink: password in the address)
  const snapReo = await cams.build(config.get(cam1.id)).snapshot().catch((e) => e.message);
  check("Reolink-style snapshot (password in the address, sealed on disk)", Buffer.isBuffer(snapReo) && hits.reolink === 1, snapReo);
  // HTTP snapshot + MJPEG with Digest
  const httpCam = config.add({ kind: "http", name: "Porch", room: "porch", conn: { snapshotUrl: `http://${SIM}/cgi-bin/snapshot.cgi?channel=1`, mjpegUrl: `http://${SIM}/video.mjpg`, username: "admin", password: SECRET } });
  const snapHttp = await cams.snapshot(httpCam.id).catch((e) => e.message);
  check("HTTP snapshot with Digest sign-in", Buffer.isBuffer(snapHttp) && hits.snap >= 1, snapHttp);
  check("…the password was never sent in the clear (no Basic header first)", hits.basicSeen === 0 && hits.snapNoAuth >= 1);
  const mj = []; const mh = cams.source(httpCam.id).live({ fps: 5 }, (j) => mj.push(j), () => {}); await sleep(1300); mh.stop();
  check("MJPEG live view", mj.length >= 3 && mj.every((j) => ff.isJpeg(j)), mj.length);
  const wrong = await cams.build({ ...config.get(httpCam.id), conn: { ...config.get(httpCam.id).conn, password: secret.seal("wrong-password") } }).snapshot().catch((e) => e.message);
  check("a wrong password: a plain message, no password in it", /didn't accept/.test(wrong) && !wrong.includes("wrong-password"), wrong);
  // ONVIF
  const onvif = await lib("cameras/onvif.mjs");
  const found = await onvif.discover({ timeoutMs: 1500, to: { host: "127.0.0.1", port: wsd.address().port } });
  check("ONVIF discovery (WS-Discovery probe, answered by the simulator)", found.length === 1 && found[0].name === "Yard Cam" && found[0].host === "127.0.0.1" && found[0].hardware === "SIM-100", found);
  const onCam = config.add({ kind: "onvif", name: "Yard", conn: { host: "127.0.0.1", port: sim.address().port, username: "admin", password: SECRET } });
  const snapOn = await cams.snapshot(onCam.id).catch((e) => e.message);
  check("ONVIF: profiles, snapshot address, picture (WS-Security digest checked by the simulator)", Buffer.isBuffer(snapOn) && hits.onvif.includes("GetProfiles") && hits.onvif.includes("GetSnapshotUri") && !hits.onvif.some((x) => x.endsWith("!")), hits.onvif);
  check("…the camera's unreachable media address was corrected to the one we reach", cams.source(onCam.id)._addrs()?.snap?.includes("127.0.0.1"));
  const onRec = await cams.source(onCam.id).recordings().catch((e) => e.message);
  check("ONVIF Profile G: the camera's own recordings listed", Array.isArray(onRec) && onRec[0]?.ref === "onvif:REC_0001" && onRec[0].name === "Front yard", onRec);
  onvif._clear();
  const onBad = config.add({ kind: "onvif", name: "Yard2", conn: { host: "127.0.0.1", port: sim.address().port, username: "admin", password: "nope" } });
  const badOn = await cams.snapshot(onBad.id).catch((e) => e.message);
  check("ONVIF with the wrong password: says so", /user name or password|turned down/.test(badOn), badOn);
  // GoPro
  const gp = config.add({ kind: "gopro", name: "GoPro", conn: { via: "usb", host: "127.0.0.1", port: sim.address().port, mode: "photo" } });
  const snapGp = await cams.snapshot(gp.id).catch((e) => e.message);
  check("GoPro (Open GoPro over USB): wired control, photo preset, shutter, download", Buffer.isBuffer(snapGp) && ["/gopro/camera/control/wired_usb", "/gopro/camera/presets/set_group", "/gopro/camera/shutter/start"].every((p) => hits.gopro.includes(p)), hits.gopro);
  const gpRec = await cams.source(gp.id).recordings();
  check("GoPro media list (photos and videos on its card)", gpRec.some((r) => r.name === "GX010001.MP4" && r.type === "video/mp4") && gpRec.some((r) => /\.JPG$/.test(r.name)));
  const gpVid = await cams.source(gp.id).fetchRecording("gopro:100GOPRO/GX010001.MP4");
  check("…a video from it streams back", gpVid.res && gpVid.type === "video/mp4");
  check("…paths outside its media are refused", await cams.source(gp.id).fetchRecording("gopro:../../etc/passwd").then(() => false, () => true));
  const gph = await lib("cameras/sources/gopro.mjs");
  check("GoPro USB address from the serial (172.2X.1YZ.51)", gph.hostFor("C3441324567890") === "172.28.190.51", gph.hostFor("C3441324567890"));
  // Home Assistant
  mkdirSync(process.env.DAYSPRING_CONNECTORS_DIR, { recursive: true });
  writeFileSync(join(process.env.DAYSPRING_CONNECTORS_DIR, "homeassistant.json"), JSON.stringify({ url: `http://${SIM}`, token: "ha-token-for-tests-0123456789012345678901234567890" }));
  const has = await lib("cameras/sources/homeassistant.mjs");
  const haList = await has.list();
  check("Home Assistant: its cameras listed (lights left out)", haList.length === 1 && haList[0].entity === "camera.driveway");
  const haCam = config.add({ kind: "homeassistant", name: "Driveway", conn: { entity: "camera.driveway" } });
  check("Home Assistant camera picture", ff.isJpeg(await cams.snapshot(haCam.id)));
  // USB (never a real webcam)
  const dshowNew = `[dshow @ 0000] "Integrated Camera" (video)\n[dshow @ 0000]   Alternative name "@device_pnp_\\\\?\\usb#vid_1"\n[dshow @ 0000] "Microphone (Realtek)" (audio)\n[dshow @ 0000] "OBS Virtual Camera" (video)\n[dshow @ 0000] "GoPro Webcam" (video)`;
  const dshowOld = `[dshow @ 01] DirectShow video devices (some may be both video and audio devices)\n[dshow @ 01]  "USB2.0 HD UVC WebCam"\n[dshow @ 01]     Alternative name "@device_pnp_x"\n[dshow @ 01] DirectShow audio devices\n[dshow @ 01]  "Headset Microphone"`;
  check("USB list (new ffmpeg format): video devices only", ff.parseDshowList(dshowNew).map((d) => d.name).join() === "Integrated Camera,OBS Virtual Camera,GoPro Webcam");
  check("USB list (older format)", ff.parseDshowList(dshowOld).map((d) => d.name).join() === "USB2.0 HD UVC WebCam");
  process.env.DAYSPRING_CAMERAS_FAKE_USB_LIST = dshowNew;
  check("Discover USB answers from the (fake) list, not the real devices", (await ff.listDshow()).length === 3);
  check("USB webcams are opened through DirectShow", stream.usbInput("Integrated Camera").join(" ").includes("-f dshow") && stream.usbInput("Integrated Camera").includes("video=Integrated Camera"));
  process.env.DAYSPRING_CAMERAS_FAKE_USB = "1";
  const usbCam = config.add({ kind: "usb", name: "Desk webcam", conn: { device: "Integrated Camera" } });
  check("USB snapshot path works (a generated picture stands in for the webcam)", ff.isJpeg(await cams.snapshot(usbCam.id)));
  // folder camera
  const trailDir = join(TMP, "trail", "DCIM", "100MEDIA"); mkdirSync(trailDir, { recursive: true });
  const put = (name, buf, agoMs) => { const f = join(trailDir, name); writeFileSync(f, buf); const t = new Date(Date.now() - agoMs); utimesSync(f, t, t); return f; };
  put("IMG_0001.JPG", FIX.still[0], 3600_000); put("IMG_0002.JPG", FIX.deer[1], 3000_000);
  const fsrc = cams.source(trailCam.id);
  const p1 = await fsrc.poll();
  check("folder camera, first look: only the newest picture (an old SD card isn't 50 alerts)", p1.length === 1);
  put("IMG_0003.JPG", FIX.deer[2], 10_000); put("IMG_0004.JPG", FIX.person[1], 8000); put("VID_0005.MP4", realMp4, 6000);
  const p2 = await fsrc.poll();
  check("…then each new picture once", p2.length === 2 && p2.every((x) => ff.isJpeg(x.jpeg)), p2.length);
  check("…and nothing twice", (await fsrc.poll()).length === 0);
  check("…its videos are its recordings", (await fsrc.recordings()).some((r) => r.name === "VID_0005.MP4"));
  check("…nothing outside its folder can be fetched", await fsrc.fetchRecording("file:..\\..\\data\\cameras.json").then(() => false, () => true));
  // email camera (the email feature's functions, mocked; photo links fetched through a mocked public fetcher)
  const inbox = await lib("cameras/sources/inbox.mjs");
  const mailbox = [
    { id: "i:m1~1", date: "2026-09-28T05:10:00Z", from: { address: "noreply@spypoint.com" }, subject: "New photo from BACK 40", attachments: [{ idx: 0, name: "PICT0001.JPG", type: "image/jpeg" }] },
    { id: "i:m1~2", date: "2026-09-28T05:20:00Z", from: { address: "friend@example.com" }, subject: "lunch?", attachments: [] },
    { id: "i:m1~3", date: "2026-09-28T05:30:00Z", from: { address: "alerts@spypoint.com" }, subject: "New photo from BACK 40", text: "Your camera took a photo: https://photos.example-trail.test/trail/photo123.jpg", attachments: [] },
  ];
  let listed = mailbox.slice(0, 1), fetched = [];
  inbox._setDeps({ mail: { connected: () => true, list: async ({ from }) => ({ messages: listed.filter((m) => !from || m.from.address.includes(from)) }), read: async (id) => mailbox.find((m) => m.id === id), attachment: async () => ({ buf: FIX.deer[1] }) },
    fetchImage: async (u) => { fetched.push(u); const r = await fetch(`http://${SIM}${new URL(u).pathname}`); return { buf: Buffer.from(await r.arrayBuffer()) }; } });
  const mailCam = config.add({ kind: "email", name: "Back 40", role: "trail", conn: { from: "spypoint", brand: "spypoint" } });
  const e1 = await cams.source(mailCam.id).poll();
  check("email camera, first look: only the newest photo email is taken (the rest are remembered)", e1.length === 1, e1.length);
  listed = mailbox;
  const e2 = await cams.source(mailCam.id).poll();
  check("…a new photo email: the photo from its link (the other sender ignored)", e2.length === 1 && fetched.length === 1 && ff.isJpeg(e2[0].jpeg), { n: e2.length, fetched });
  const took = await cams.ingestEmail({ messageId: "<x@spypoint>", from: { address: "noreply@spypoint.com" }, subject: "New photo", date: new Date().toISOString(), attachments: [{ name: "a.jpg", type: "image/jpeg", buf: FIX.person[1] }] });
  const e3 = await cams.source(mailCam.id).poll();
  check("…an email handed in by the email feature (cameras.ingestEmail)", took === 1 && e3.length === 1);
  check("photo links are picked out of notification text", inbox.photoLinks("see https://x.test/media/abc and https://x.test/p/1.jpg?sig=2 and https://x.test/help").length === 2);

  // ================================================================= I. the monitor (watch)
  section("I. the shared monitor: watch()");
  let n = 0, printerEvents = [];
  const printerFrames = [FIX.still[0], FIX.still[1], FIX.deer[1], FIX.still[2]];
  const unreg = cams.register({ id: "printer-x1", name: "X1 printer", kind: "printer", role: "printer", snapshot: async () => printerFrames[n++ % printerFrames.length] });
  check("register(): another feature's camera joins the list", cams.list().some((c) => c.id === "printer-x1" && c.registered));
  const h = cams.watch("printer-x1", { every: 400, startDelayMs: 50,
    analyze: (frame, history) => (frame.jpeg === FIX.deer[1] ? { event: true, labels: [{ label: "failure", confidence: 0.8 }], summary: "Spaghetti!" } : { event: false, keep: history.length === 1 }),
    onEvent: (e) => printerEvents.push(e) });
  await sleep(2200); h.stop();
  const pe = events.list({ cam: "printer-x1" });
  check("watch(): a picture every N; the analyse decides", h.status().frames >= 4, h.status());
  check("…the event is kept, with its labels, and onEvent hears it", printerEvents.length >= 1 && pe.some((e) => e.kind === "event" && e.labels[0].label === "failure" && e.summary === "Spaghetti!"));
  check("…\"delete if good\": fine pictures aren't kept unless the analyse says keep", pe.filter((e) => e.kind === "still").length === 1, pe.map((e) => e.kind));
  said.length = 0;
  const pd = await cams.alertEvent({ ...pe.find((e) => e.kind === "event"), cam: "printer-x1" });
  check("…and its alerts use the same rules (a registered camera's failure alerts)", pd.send && said.length === 1, pd);
  unreg();
  check("unregister: gone", !cams.list().some((c) => c.id === "printer-x1"));
  // a saved trail camera end to end: new photos → AI (mocked) → event → alert
  said.length = 0; analyze._resetCooldown(); aiSays = "deer";
  config.update(trailCam.id, { alerts: { on: true, labels: ["deer"], quiet: null, cooldownMin: 0, channels: { screen: true, voice: true, phone: false, devices: false } } });
  put("IMG_0006.JPG", FIX.deer[1], 5000);
  await cams.start({ force: true });
  const th = cams.monitor.handleOf(trailCam.id);
  const ran = th ? await th.runNow("schedule") : [];
  await sleep(300);
  check("a trail camera photo arrives → the AI says deer → an event → an alert", (ran ?? []).some((r) => r?.labels?.[0]?.label === "deer") && said.some((s) => /deer/i.test(s.text) && s.kind === "camera"), { ran: (ran ?? []).map((r) => r?.labels), said: said.map((s) => s.text) });
  cams.stop();

  // ================================================================= J. voice and tools
  section("J. voice commands and tools");
  const skills = await lib("cameras/skills.mjs");
  const shop = config.add({ kind: "http", name: "Shop", room: "shop", conn: { snapshotUrl: `http://${SIM}/cgi-bin/snapshot.cgi?channel=1`, username: "admin", password: SECRET } });
  const shopEv = events.save(shop.id, FIX.person[1], { labels: [{ label: "person", confidence: 0.9 }], summary: "A person at the bench." });
  const deerNight = new Date(); deerNight.setDate(deerNight.getDate() - 1); deerNight.setHours(23, 10, 0, 0);
  const tev = events.save(trailCam.id, FIX.deer[1], { at: deerNight.toISOString(), labels: [{ label: "deer", confidence: 0.9 }], summary: "A doe." });
  writeFileSync(events.clipPathFor(tev.id), realMp4); events.attachClip(tev.id);
  events.remove(evc.id);                 // (a leftover from G on a camera that isn't saved)
  const say1 = await skills.command("show me the front camera");
  check("\"show me the front camera\"", /Here's Front door/.test(say1 ?? ""), say1);
  const say2 = await skills.command("any activity on the trail cam?");
  check("\"any activity on the trail cam?\" → deer", /Trail cam/i.test(say2 ?? "") && /deer/.test(say2 ?? ""), say2);
  const say3 = await skills.command("play last night's deer clip");
  check("\"play last night's deer clip\"", /Playing the deer clip from Trail cam/.test(say3 ?? ""), say3);
  const say4 = await skills.command("what happened in the shop today?");
  check("\"what happened in the shop today?\" → the person", /Shop/.test(say4 ?? "") && /person|people/.test(say4 ?? ""), say4);
  check("not about cameras: left alone", (await skills.command("what happened in history today")) === null && (await skills.command("show me a gif of a cat")) === null);
  const intents = await lib("intents/index.mjs");
  for (const [t, id] of [["show me the front camera", "cameras.show"], ["any activity on the trail cam", "cameras.activity"], ["play last nights deer clip", "cameras.play"], ["set a timer for 5 minutes", "timer.start"]]) { const pl = intents.plan(t); check(`no-AI intent: "${t}" → ${id}`, pl.intent === id, pl.intent); }
  check("the AI's tools: four, all camera_*", skills.TOOLS.map((t) => t.name).join() === "camera_show,camera_activity,camera_play,camera_look");
  const ta = await skills.runTool("camera_activity", { camera: "trail cam", when: "last night", label: "deer" });
  check("camera_activity tool", /deer/.test(ta.text) && ta.events.length >= 1 && ta.events.every((e) => e.labels.some((l) => l.label === "deer")), ta);
  const aiBefore = aiCalls;
  const tl = await skills.runTool("camera_look", { camera: "shop" });
  check("camera_look with AI off for that camera: says so, sends nothing", aiCalls === aiBefore && /Analyse with AI/.test(tl.text), tl);
  check("other tools pass through", (await skills.runTool("gif_search", {})) === undefined);
  // the release gate: a production build (cameras are "dev") has none of it
  const gate = await lib("cameras/gate.mjs"), features = await lib("features.mjs");
  process.env.DAYSPRING_CHANNEL = "stable"; features._clear?.();
  const offTools = skills.tools().length, offCmd = await skills.command("show me the front camera");
  const routes = await lib("cameras/routes.mjs"); let offStatus = null;
  await routes.handle({}, {}, { m: "GET", p: "/cameras", q: new URLSearchParams(), send: (_r, code) => { offStatus = code; }, readJSON: async () => ({}) });
  check("production build: no camera tools, commands or routes (the \"cameras\" feature is dev)", !gate.on() && offTools === 0 && offCmd === null && offStatus === 404, { on: gate.on(), offTools, offCmd, offStatus });
  process.env.DAYSPRING_CHANNEL = "dev"; features._clear?.();
  check("…and back on in the development version", gate.on() && skills.tools().length === 4);

  // ================================================================= K. the server and the screens
  if (!NO_UI) {
    section("K. the real server (throwaway copy) and headless Chrome");
    const SKIP = new Set(["data", ".env", "node_modules", "backups", "dist", "dist-out", "bin", "updates", "logs", ".git", "qa-out"]);
    for (const e of readdirSync(DESK)) if (!SKIP.has(e) && !/\.tmp\./.test(e)) cpSync(join(DESK, e), join(APP, e), { recursive: true, filter: (s) => !/[\\/]docs[\\/](images|dev[\\/]badge-previews)[\\/]/.test(s) });
    spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
    mkdirSync(join(APP, "data"), { recursive: true });
    writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
    // its cameras: the Digest camera (live), the trail folder, and some events with a clip
    const sc = JSON.parse(readFileSync(process.env.DAYSPRING_CAMERAS_FILE, "utf8"));
    sc.cameras = sc.cameras.filter((c) => [httpCam.id, trailCam.id, shop.id].includes(c.id)).map((c) => ({ ...c, schedule: { ...c.schedule, mode: "off" } }));
    writeFileSync(join(APP, "data", "cameras.json"), JSON.stringify(sc, null, 2));
    cpSync(process.env.DAYSPRING_CAMERAS_DIR, join(APP, "data", "cameras"), { recursive: true });
    const PORT = 4793, BASE = `http://127.0.0.1:${PORT}`;
    const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_NO_KEEPAWAKE: "1",
      DAYSPRING_REMINDER_CHANNEL: "off", DAYSPRING_CAMERAS: "1", DAYSPRING_CHANNEL: "dev", DS_PROFILE: "DayspringQA" };
    for (const k of ["DAYSPRING_CAMERAS_FILE", "DAYSPRING_CAMERAS_DIR", "DAYSPRING_CAMERAS_STATE", "DAYSPRING_CONNECTORS_DIR", "DAYSPRING_VISION_SETTINGS", "DAYSPRING_ACTIVITY_DIR", "DAYSPRING_CAMERAS_FAKE_USB_LIST"]) delete env[k];
    server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let serverLog = ""; server.stdout.on("data", (x) => (serverLog += x)); server.stderr.on("data", (x) => (serverLog += x));
    const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
    for (let i = 0; i < 80 && !(await up()); i++) await sleep(500);
    check("test server started", await up(), serverLog.slice(-600));
    const api = async (path, body, method) => { const r = await fetch(BASE + "/api" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
    const st = await api("/cameras");
    check("GET /api/cameras: the cameras, presets, trail brands", st.cameras?.length === 3 && st.presets?.some((p) => p.id === "reolink") && st.trail?.some((t) => t.id === "spypoint"), st.error);
    check("…no password anywhere in it", !JSON.stringify(st).includes(SECRET));
    const snapR = await fetch(`${BASE}/api/cameras/${httpCam.id}/snapshot`);
    check("snapshot route: a JPEG", snapR.status === 200 && snapR.headers.get("content-type") === "image/jpeg" && ff.isJpeg(Buffer.from(await snapR.arrayBuffer())));
    const ctl = new AbortController(); let liveBytes = 0;
    const lr2 = await fetch(`${BASE}/api/cameras/${httpCam.id}/live?fps=3`, { signal: ctl.signal });
    const rd2 = lr2.body.getReader(); const t0 = Date.now(); while (Date.now() - t0 < 1500) { const { value, done } = await rd2.read(); if (done) break; liveBytes += value.length; if (liveBytes > 20_000) break; } ctl.abort();
    check("live route: an MJPEG stream", lr2.headers.get("content-type")?.startsWith("multipart/x-mixed-replace") && liveBytes > 5000, liveBytes);
    const evs = await api(`/cameras/events?cam=${trailCam.id}`);
    const withClip = evs.events?.find((e) => e.clipUrl);
    check("events route: with thumbnails and clip links", evs.events?.length >= 1 && Boolean(withClip), evs.events?.length);
    const rngR = await fetch(BASE + withClip.clipUrl, { headers: { range: "bytes=0-99" } });
    check("clips are served with Range (for the player)", rngR.status === 206 && (await rngR.arrayBuffer()).byteLength === 100);
    check("media route refuses other files", (await fetch(`${BASE}/api/cameras/media/${trailCam.id}/..%5C..%5C/cameras.json`)).status === 404 && (await fetch(`${BASE}/api/cameras/media/x/2026-01-01/owner.json`)).status === 404);
    const recs = await api(`/cameras/recordings?cam=${trailCam.id}&day=${tev.day}`);
    check("recordings route", recs.clips?.length === 1 && recs.days?.includes(tev.day));
    const tst = await api("/cameras/test", { camera: { kind: "http", name: "T", conn: { snapshotUrl: `http://${SIM}/cgi-bin/snapshot.cgi`, username: "admin", password: SECRET } } });
    check("Test (not saved): a preview picture", tst.ok && tst.jpeg?.startsWith("data:image/jpeg;base64,"));
    const bad2 = await api("/cameras/test", { camera: { kind: "http", name: "T", conn: { snapshotUrl: `http://${SIM}/cgi-bin/snapshot.cgi`, username: "admin", password: "nope-nope" } } });
    check("Test with a wrong password: a plain answer", !bad2.ok && /didn't accept/.test(bad2.error), bad2);
    const storeBad = await api("/cameras/settings", { storageDir: "C:\\Windows\\Temp\\dscams" });
    check("storage folder: a Windows folder is refused", storeBad.status >= 400 && /Windows or program folder/.test(storeBad.error), storeBad);
    const storeNo = await api("/cameras/settings", { storageDir: join(TMP, "elsewhere") });
    check("storage folder outside Dayspring's data needs permission (Settings → Permissions)", storeNo.status >= 400 && /Permissions/.test(storeNo.error), storeNo);
    const chatR = await api("/chat", { message: "any activity on the trail cam?", surface: "tv", typed: true });
    check("the chat route answers camera questions without AI", /deer/.test(chatR.reply ?? "") && chatR.intent === "cameras", chatR.reply);
    check("the file on disk has no password", !readFileSync(join(APP, "data", "cameras.json"), "utf8").includes(SECRET));

    if (existsSync(fileURLToPath(PW || "file:///nope"))) {
      const { chromium } = await import(PW);
      browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--no-first-run", "--disable-extensions", "--use-fake-ui-for-media-stream"] });
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
      await ctx.addInitScript(() => { window.__dsAllowAutomatedListen = true; const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; } HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; });
      await ctx.route("**/*", (rt) => { const u = rt.request().url(); if (rt.request().method() === "POST" && /\/api\/(sound|window|devices\/use|keepawake|tunein|open|app\/quit|update)/.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); return rt.continue(); });
      const errs = [];
      // the Cameras page
      const pg = await ctx.newPage(); pg.on("pageerror", (e) => errs.push("cameras: " + e.message));
      await pg.goto(`${BASE}/cameras.html`, { waitUntil: "domcontentloaded" });
      await pg.waitForSelector(".cam", { timeout: 15000 });
      check("Cameras page: a card per camera", (await pg.locator(".cam").count()) === 3);
      check("…live views for cameras that have one, the latest picture for the rest", (await pg.locator(".cam img[data-live]").count()) >= 1 && (await pg.locator(".cam img[data-still]").count()) >= 1);
      await pg.locator(`.cam[data-id="${trailCam.id}"]`).click(); await pg.waitForSelector("#evs button", { timeout: 10000 });
      check("…a camera's page with its latest events", (await pg.locator("#evs button").count()) >= 1);
      await pg.locator("#t-events").click(); await pg.waitForSelector(".ev", { timeout: 10000 });
      check("Events: the feed with thumbnails and labels", (await pg.locator(".ev img").count()) >= 2 && (await pg.locator(".ev .chip.deer").count()) >= 1);
      await pg.selectOption("#flab", "deer"); await sleep(600);
      check("…filtered to deer", (await pg.locator(".ev").count()) >= 1 && (await pg.locator(".ev .chip.person").count()) === 0);
      await pg.locator("#t-rec").click(); await pg.waitForSelector("#rcam", { timeout: 10000 });
      await pg.selectOption("#rcam", trailCam.id); await sleep(500); await pg.selectOption("#rday", tev.day).catch(() => {}); await sleep(700);
      check("Recordings: a timeline with event markers", (await pg.locator(".timeline .mk").count()) >= 1 && (await pg.locator(".timeline .mk.clip").count()) >= 1);
      await pg.locator(".ev[data-k]").first().click(); await pg.waitForSelector("#viewer video", { timeout: 5000 });
      check("…a clip plays in the viewer", await pg.evaluate(() => Boolean(document.querySelector("#viewer video")?.src)));
      const vb = await pg.evaluate(() => { const r = document.querySelector("#vbox").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
      check("…the viewer fits the window", vb.l >= 0 && vb.t >= 0 && vb.r <= vb.w && vb.b <= vb.h, vb);
      await pg.keyboard.press("Escape");
      check("…Esc closes it", await pg.evaluate(() => document.getElementById("viewer").hidden));
      await pg.goto(`${BASE}/cameras.html?event=${encodeURIComponent(tev.id)}`, { waitUntil: "domcontentloaded" }); await pg.waitForSelector("#viewer video", { timeout: 10000 });
      check("?event= opens that event's clip (\"play last night's deer clip\")", true);
      await pg.close();
      // the Dayspring screen: 📷 button, ● REC, the alert card, inside the margins
      const dp = await ctx.newPage(); dp.on("pageerror", (e) => errs.push("display: " + e.message));
      await dp.goto(`${BASE}/display`, { waitUntil: "domcontentloaded" });
      await dp.waitForFunction(() => window.dsEvents && window.dsCamerasTv, null, { timeout: 20000 }); await sleep(1500);
      check("the screen: 📷 Cameras by the clock", await dp.evaluate(() => Boolean(document.getElementById("camerasBtn"))));
      await dp.evaluate(() => { document.documentElement.style.setProperty("--st", "8vh"); document.documentElement.style.setProperty("--sb", "8vh"); document.documentElement.style.setProperty("--sl", "8vw"); document.documentElement.style.setProperty("--sr", "8vw"); dispatchEvent(new Event("resize")); });
      await dp.evaluate(() => { window.dsCamerasTv.showRec(["x"], ["Porch"]); window.dsCamerasTv.showCard({ id: null, cam: "x", text: "Porch: a person at the door.", thumb: null }); });
      await sleep(400);
      const fit = await dp.evaluate(() => { const S = window.dsSafeRect?.() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }; const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= S.left - 1 && r.top >= S.top - 1 && r.right <= S.right + 1 && r.bottom <= S.bottom + 1 && r.width > 0; }; return { rec: inside(document.getElementById("camRec")), card: inside(document.querySelector(".campanel")), S }; });
      check("● REC shows while recording, inside the screen margins", fit.rec, fit);
      check("the alert card, inside the screen margins", fit.card, fit);
      await dp.locator("#camerasBtn").click(); await sleep(1500);
      check("📷 opens the Cameras page over the screen", await dp.evaluate(() => !document.getElementById("pagewrap").hidden && /cameras\.html/.test(document.getElementById("pageframe").src)));
      await dp.close();
      // Settings → Cameras
      const sp = await ctx.newPage(); sp.on("pageerror", (e) => errs.push("settings: " + e.message));
      await sp.goto(`${BASE}/setup?s=cameras`, { waitUntil: "domcontentloaded" }); await sp.waitForSelector("#cs-cams .cs-cam", { timeout: 15000 });
      check("Settings → Cameras, in Apps & connections", await sp.evaluate(() => { const nav = [...document.querySelectorAll("#nav > *")].map((x) => x.textContent.trim()); const i = nav.findIndex((t) => /Cameras/.test(t)), g = nav.findIndex((t) => /^Apps & connections$/i.test(t)); const p = nav.findIndex((t) => /Privacy & safety/i.test(t)); return i > g && g >= 0 && (p < 0 || i < p); }));
      check("…lists the cameras (no password on the page)", (await sp.locator(".cs-cam").count()) === 3 && !(await sp.content()).includes(SECRET));
      await sp.click("#cs-add"); await sp.waitForSelector(".cs-type");
      check("…Add: a guided choice of camera types", (await sp.locator(".cs-type").count()) === 8);
      await sp.click('.cs-type[data-kind="rtsp"]'); await sp.waitForSelector("#cs-preset");
      await sp.selectOption("#cs-preset", "hikvision"); await sp.fill("#cs-host", "192.168.1.64"); await sp.click("#cs-fill"); await sleep(500);
      check("…brand presets fill the addresses (Hikvision)", (await sp.inputValue("#cs-url")) === "rtsp://{user}:{pass}@192.168.1.64:554/Streaming/Channels/101" && /ISAPI/.test(await sp.inputValue("#cs-snap")));
      await sp.click("#cs-cancel");
      await sp.click("#cs-add"); await sp.click('.cs-type[data-kind="http"]'); await sp.waitForSelector("#cs-snap");
      await sp.fill("#cs-name", "Back door"); await sp.fill("#cs-room", "back yard"); await sp.fill("#cs-snap", `http://${SIM}/cgi-bin/snapshot.cgi?channel=1`); await sp.fill("#cs-user", "admin"); await sp.fill("#cs-pass", SECRET);
      await sp.click("#cs-test"); await sp.waitForFunction(() => /Got a picture|⚠/.test(document.getElementById("cs-testmsg").textContent), null, { timeout: 15000 });
      check("…Test and preview shows the camera's picture", await sp.evaluate(() => /Got a picture/.test(document.getElementById("cs-testmsg").textContent) && document.getElementById("cs-img").naturalWidth > 0));
      await sp.locator("#cs-roi").scrollIntoViewIfNeeded(); await sleep(700);      // (the form scrolls smoothly; drag where it has settled)
      const box = await sp.locator("#cs-roi").boundingBox();
      await sp.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5); await sp.mouse.down(); await sp.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.95, { steps: 5 }); await sp.mouse.up();
      check("…drag on the picture draws the region to watch", (await sp.evaluate(() => window.DayspringCameraSettings._state().ed.motion.roi.length)) === 1);
      await sp.check("#cs-a-deer"); await sp.fill("#cs-qfrom", "22:00"); await sp.fill("#cs-qto", "06:00"); await sp.selectOption("#cs-mode", "every"); await sp.fill("#cs-every", "5");
      check("…face recognition starts off", !(await sp.isChecked("#cs-faces")));
      await sp.check("#cs-public");
      check("…and can't be ticked for a public-facing camera", await sp.isDisabled("#cs-faces"));
      await sp.click("#cs-save"); await sp.waitForFunction(() => /Saved/.test(document.getElementById("cs-msg").textContent), null, { timeout: 10000 });
      const saved2 = (await api("/cameras")).cameras.find((c) => c.name === "Back door");
      check("…saved: region, schedule, alert rules, quiet hours, public-facing", saved2 && saved2.motion.roi.length === 1 && saved2.schedule.mode === "every" && saved2.schedule.everyMin === 5 && saved2.alerts.labels.includes("deer") && saved2.alerts.quiet?.from === "22:00" && saved2.publicFacing && !saved2.faces, saved2);
      check("…its password is on disk only sealed", !readFileSync(join(APP, "data", "cameras.json"), "utf8").includes(SECRET));
      check("no errors on the pages", errs.length === 0, errs);
    } else check("playwright-core found", false, PW);
    check("the server log never has the password", !serverLog.includes(SECRET), serverLog.split("\n").find((l) => l.includes(SECRET)));
  }
} catch (e) {
  check("the checks ran to the end", false, e.stack);
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  try { streamProc?.kill(); } catch { /* gone */ }
  try { (await lib("cameras/index.mjs")).stop(); (await lib("cameras/recorder.mjs")).stopAll(); (await lib("cameras/ffmpeg.mjs")).killAll(); } catch { /* fine */ }
  if (server) { server.kill(); await sleep(600); }
  sim.close(); wsd.close();
  if (!KEEP) { if (existsSync(join(APP, "node_modules"))) spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); await sleep(300); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a file still open */ } }
  else console.log("kept:", TMP);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
