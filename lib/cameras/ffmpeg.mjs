// ffmpeg for the cameras (ffmpeg-static, which Dayspring already ships): one still from anything ffmpeg can open (a USB
// webcam through DirectShow, an RTSP or HTTP stream, a file), a low-rate stream of JPEG frames for a live view or
// motion checks, a smaller copy of a picture, the list of USB cameras, and the length of a clip.
// Every process started here is tracked and killed when it's done or too slow; nothing else is ever touched.
//   FFMPEG() · run(args, { input, timeoutMs }) · grab(inArgs, { width }) · frames(inArgs, { fps, width }, onFrame) → { stop }
//   resize(jpeg, width) · listDshow() · parseDshowList(text) · duration(file) · JpegSplitter · children()
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { redact } from "./secret.mjs";

export const FFMPEG = () => process.env.DAYSPRING_FFMPEG || ffmpegPath;
const live = new Set();
export const children = () => [...live].map((c) => c.pid);
export function killAll() { for (const c of live) { try { c.kill("SIGKILL"); } catch { /* gone */ } } live.clear(); }

export function spawnFfmpeg(args, opts = {}) {
  // interactive: ffmpeg reads its keyboard from stdin, so "q" stops it cleanly (the last MP4 piece is finished properly)
  const c = spawn(FFMPEG(), ["-hide_banner", ...(opts.interactive ? [] : ["-nostdin"]), ...args], { windowsHide: true, stdio: [opts.interactive ? "pipe" : opts.stdin ?? "ignore", "pipe", "pipe"], ...opts.spawn });
  if (opts.interactive) c.stdin.on("error", () => {});
  live.add(c);
  c.on("exit", () => live.delete(c)); c.on("error", () => live.delete(c));
  return c;
}
// run to the end: { code, stdout: Buffer, stderr: string }
export function run(args, { input = null, timeoutMs = 20_000, maxBytes = 64e6 } = {}) {
  return new Promise((resolve, reject) => {
    let c;
    try { c = spawnFfmpeg(input ? ["-loglevel", "error", ...args] : ["-loglevel", "error", ...args], { stdin: input ? "pipe" : "ignore" }); } catch (e) { return reject(e); }
    const out = []; let size = 0, err = "";
    const timer = setTimeout(() => { try { c.kill("SIGKILL"); } catch { /* gone */ } reject(new Error("The camera took too long to answer.")); }, timeoutMs);
    c.stdout.on("data", (d) => { size += d.length; if (size <= maxBytes) out.push(d); });
    c.stderr.on("data", (d) => { if (err.length < 8000) err += d; });
    c.on("error", (e) => { clearTimeout(timer); reject(e); });
    c.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr: redact(err) }); });
    if (input) { c.stdin.on("error", () => {}); c.stdin.end(input); }
  });
}
// A plain-words reason from ffmpeg's error text (never with the password in it)
export function why(stderr) {
  const s = String(stderr ?? "");
  if (/401|Unauthorized|authorization failed/i.test(s)) return "The camera didn't accept the user name or password.";
  if (/Connection refused/i.test(s)) return "The camera refused the connection (wrong address or port, or the stream is turned off in its settings).";
  if (/timed out|Connection timed out|No route to host|Network is unreachable/i.test(s)) return "Couldn't reach the camera. Check its address and that it's on the same network.";
  if (/404|Not Found/i.test(s)) return "The camera answered, but not at that path. Check the stream address (the brand preset may differ for your model).";
  if (/Could not find video device|I\/O error|Could not run graph|device.*busy/i.test(s)) return "That webcam couldn't be opened (unplugged, or another app is using it).";
  if (/Invalid data found/i.test(s)) return "The camera sent something that isn't a video or picture.";
  const line = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  return line ? `The camera didn't send a picture (${line.slice(0, 160)}).` : "The camera didn't send a picture.";
}

// One JPEG from any input
export async function grab(inArgs, { width = 1280, timeoutMs = 20_000 } = {}) {
  const vf = width ? ["-vf", `scale='min(${width},iw)':-2`] : [];
  const r = await run([...inArgs, "-frames:v", "1", ...vf, "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { timeoutMs });
  if (!isJpeg(r.stdout)) throw new Error(why(r.stderr));
  return r.stdout;
}
export const isJpeg = (b) => Buffer.isBuffer(b) && b.length > 100 && b[0] === 0xff && b[1] === 0xd8;
// a smaller copy of a picture (for the AI, thumbnails)
export async function resize(jpeg, width = 1024, { quality = 5 } = {}) {
  const r = await run(["-f", "image2pipe", "-i", "pipe:0", "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-q:v", String(quality), "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { input: jpeg, timeoutMs: 15_000 });
  if (!isJpeg(r.stdout)) throw new Error(why(r.stderr));
  return r.stdout;
}

// JPEG frames out of a byte stream (ffmpeg's image2pipe, or a camera's MJPEG): start FFD8 … end FFD9
export class JpegSplitter {
  constructor(onFrame, { maxFrame = 12e6 } = {}) { this.onFrame = onFrame; this.buf = Buffer.alloc(0); this.max = maxFrame; }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const s = this.buf.indexOf(Buffer.from([0xff, 0xd8]));
      if (s < 0) { this.buf = this.buf.subarray(Math.max(0, this.buf.length - 1)); return; }
      const e = this.buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2);
      if (e < 0) { if (this.buf.length - s > this.max) this.buf = Buffer.alloc(0); else if (s > 0) this.buf = this.buf.subarray(s); return; }
      const frame = Buffer.from(this.buf.subarray(s, e + 2));
      this.buf = this.buf.subarray(e + 2);
      try { this.onFrame(frame); } catch { /* a listener must not break the stream */ }
    }
  }
}

// A low-rate stream of JPEG frames. onFrame(jpeg); onEnd(reason). Returns { stop, pid }.
export function frames(inArgs, { fps = 2, width = 640, quality = 6 } = {}, onFrame, onEnd = () => {}) {
  const c = spawnFfmpeg(["-loglevel", "error", ...inArgs, "-an", "-vf", `fps=${fps},scale='min(${width},iw)':-2`, "-q:v", String(quality), "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
  const split = new JpegSplitter(onFrame);
  let err = "", stopped = false;
  c.stdout.on("data", (d) => split.push(d));
  c.stderr.on("data", (d) => { if (err.length < 4000) err += d; });
  c.on("close", (code) => onEnd(stopped ? "stopped" : code === 0 ? "ended" : why(redact(err))));
  c.on("error", (e) => onEnd(e.message));
  return { pid: c.pid, stop() { stopped = true; try { c.kill("SIGKILL"); } catch { /* gone */ } } };
}

// ---- USB webcams (DirectShow) ----
// "ffmpeg -list_devices true -f dshow -i dummy" prints the devices on stderr. Two formats exist:
//   new:  [dshow @ 000…] "Integrated Camera" (video)        [dshow @ …]   Alternative name "@device_pnp_…"
//   old:  [dshow @ …] DirectShow video devices …  [dshow @ …]  "Integrated Camera"  …  DirectShow audio devices
export function parseDshowList(text) {
  const out = []; let section = null, last = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) { section = "video"; continue; }
    if (/DirectShow audio devices/i.test(line)) { section = "audio"; continue; }
    const alt = /Alternative name\s+"([^"]+)"/.exec(line);
    if (alt) { if (last) last.alt = alt[1]; continue; }
    const m = /\]\s+"([^"]+)"(?:\s+\((video|audio|none)\))?/.exec(line);
    if (!m) continue;
    const kind = m[2] ?? section;
    last = { name: m[1], kind: kind ?? "video" };
    if (last.kind === "video") out.push(last); else last = null;
  }
  return out.map((d) => ({ name: d.name, alt: d.alt ?? null }));
}
export async function listDshow() {
  if (process.env.DAYSPRING_CAMERAS_FAKE_USB_LIST) return parseDshowList(process.env.DAYSPRING_CAMERAS_FAKE_USB_LIST);   // tests: never the real list
  if (process.platform !== "win32") return [];
  // listing names only: this doesn't open any camera
  const r = await new Promise((resolve) => {
    const c = spawnFfmpeg(["-list_devices", "true", "-f", "dshow", "-i", "dummy"]);
    let err = ""; const t = setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, 15_000);
    c.stderr.on("data", (d) => { err += d; }); c.stdout.on("data", () => {});
    c.on("close", () => { clearTimeout(t); resolve(err); }); c.on("error", () => { clearTimeout(t); resolve(""); });
  });
  return parseDshowList(r);
}

// seconds of a video file (from ffmpeg's "Duration:" line), or null
export async function duration(file) {
  const r = await new Promise((resolve) => {
    const c = spawnFfmpeg(["-i", file]);
    let err = ""; c.stderr.on("data", (d) => { err += d; }); c.stdout.on("data", () => {});
    c.on("close", () => resolve(err)); c.on("error", () => resolve(""));
  });
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
