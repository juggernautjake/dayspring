// Camera sources that ffmpeg or plain HTTP can read: USB webcams (DirectShow), RTSP streams (security cameras, NVRs,
// docker-wyze-bridge, anything with an rtsp://, rtsps://, http(s):// video or udp:// address), HTTP snapshot and MJPEG
// addresses, and ONVIF cameras (asked for their own stream and snapshot addresses).
// Every source has the same shape (lib/cameras/index.mjs):
//   { id, name, kind, room, role, snapshot() → JPEG Buffer, live(opts, onFrame, onEnd) → { stop }, ffmpegInput() → args,
//     recordCopy, recordings?() → [...], fetchRecording?(ref) }
import * as ff from "../ffmpeg.mjs";
import * as secret from "../secret.mjs";
import * as onvif from "../onvif.mjs";
import { camFetch } from "../http-auth.mjs";
import { creds } from "../config.mjs";
import * as vendor from "./vendor-recordings.mjs";

const base = (cam) => ({ id: cam.id, name: cam.name, kind: cam.kind, room: cam.room ?? "", role: cam.role ?? "general", publicFacing: Boolean(cam.publicFacing) });

// ---- USB webcams ----
export function usbInput(device, { fps = null } = {}) {
  // tests (never a real webcam): a generated picture instead of the device
  if (process.env.DAYSPRING_CAMERAS_FAKE_USB === "1") return ["-re", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=5"];
  return ["-f", "dshow", "-rtbufsize", "32M", ...(fps ? ["-framerate", String(fps)] : []), "-i", `video=${device}`];
}
export function usb(cam) {
  const input = () => usbInput(cam.conn.device);
  return { ...base(cam), recordCopy: false, caps: { live: true, clip: true },
    snapshot: () => ff.grab(input(), { width: 1280, timeoutMs: 20_000 }),
    live: (o, onFrame, onEnd) => ff.frames(input(), { fps: o?.fps ?? 2, width: o?.width ?? 640 }, onFrame, onEnd),
    ffmpegInput: input };
}

// ---- RTSP and other streams ----
export function streamInput(url) {
  const u = String(url);
  // a short look at the start of the stream (the default waits up to 5 s before the first picture)
  const quick = ["-probesize", "500000", "-analyzeduration", "1000000"];
  if (/^rtsps?:/i.test(u)) return ["-rtsp_transport", "tcp", "-timeout", "10000000", ...quick, "-i", u];
  if (/^https?:/i.test(u)) return ["-rw_timeout", "10000000", ...quick, "-i", u];
  return [...quick, "-i", u];
}
export function rtsp(cam) {
  const c = () => creds(cam);
  const url = () => { const k = c(); return secret.fill(cam.conn.url, k.username, k.password); };
  const snapHttp = cam.conn.snapshotUrl ? () => httpSnapshot(cam.conn.snapshotUrl, c()) : null;
  const src = { ...base(cam), recordCopy: true, caps: { live: true, clip: true, recordings: Boolean(cam.conn.recordings) },
    // the camera's own still (fast, full size) when there is one; else a frame from the stream
    async snapshot() {
      if (snapHttp) { try { return await snapHttp(); } catch (e) { if (!cam.conn.url) throw e; } }
      return ff.grab(streamInput(url()), { width: 1920, timeoutMs: 20_000 });
    },
    live: (o, onFrame, onEnd) => ff.frames(streamInput(url()), { fps: o?.fps ?? 2, width: o?.width ?? 640 }, onFrame, onEnd),
    ffmpegInput: () => streamInput(url()) };
  if (cam.conn.recordings && vendor.KINDS.includes(cam.conn.recordings)) Object.assign(src, vendor.adapter(cam.conn.recordings, { host: hostOf(cam.conn.url || cam.conn.snapshotUrl), ...c() }));
  return src;
}
const hostOf = (u) => { try { const x = new URL(String(u).replace(/\{user\}(:\{pass\})?@/, "")); return x.hostname; } catch { return ""; } };

// ---- HTTP snapshot and MJPEG ----
export async function httpSnapshot(tpl, { username = "", password = "" } = {}) {
  const url = secret.fill(tpl, username, password);
  const inQuery = /\{pass\}/.test(tpl) && !/\{user\}(:\{pass\})?@/.test(tpl);
  // the address had the password in its query (Reolink): no second sign-in
  const r = await camFetch(url.replace(/\/\/[^/@]*@/, "//"), { ...(inQuery ? {} : { username, password }), timeoutMs: 15_000, maxBytes: 15e6 });
  if (/multipart\/x-mixed-replace/i.test(r.type) || !ff.isJpeg(r.buf)) {
    // a stream, or a PNG / something else: ffmpeg makes it a JPEG
    const first = firstJpeg(r.buf);
    if (first) return first;
    const out = await ff.run(["-i", "pipe:0", "-frames:v", "1", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { input: r.buf, timeoutMs: 15_000 });
    if (!ff.isJpeg(out.stdout)) throw new Error("That address didn't give a picture.");
    return out.stdout;
  }
  return r.buf;
}
function firstJpeg(buf) { let f = null; new ff.JpegSplitter((j) => { f ??= j; }).push(buf); return f; }
// a camera's MJPEG stream, read frame by frame (at most fps frames a second are passed on)
export function mjpegLive(tpl, cr, { fps = 2 } = {}, onFrame, onEnd = () => {}) {
  const ctl = new AbortController(); let last = 0, stopped = false;
  (async () => {
    try {
      const r = await camFetch(secret.fill(tpl, cr.username, cr.password).replace(/\/\/[^/@]*@/, "//"), { ...cr, stream: true, signal: ctl.signal });
      const split = new ff.JpegSplitter((j) => { const now = Date.now(); if (now - last >= 1000 / fps) { last = now; onFrame(j); } });
      for await (const chunk of r.res.body) split.push(Buffer.from(chunk));
      onEnd(stopped ? "stopped" : "ended");
    } catch (e) { onEnd(stopped ? "stopped" : e.message); }
  })();
  return { stop() { stopped = true; ctl.abort(); } };
}
export function http(cam) {
  const c = () => creds(cam);
  const pollLive = (o, onFrame, onEnd) => {
    let stopped = false;
    (async () => { while (!stopped) { const t = Date.now(); try { onFrame(await httpSnapshot(cam.conn.snapshotUrl, c())); } catch (e) { if (!stopped) { onEnd(e.message); return; } } await new Promise((r) => setTimeout(r, Math.max(200, 1000 / (o?.fps ?? 1) - (Date.now() - t)))); } onEnd("stopped"); })();
    return { stop() { stopped = true; } };
  };
  return { ...base(cam), recordCopy: false, caps: { live: true, clip: Boolean(cam.conn.mjpegUrl) },
    async snapshot() {
      if (cam.conn.snapshotUrl) return httpSnapshot(cam.conn.snapshotUrl, c());
      return new Promise((resolve, reject) => { let h = null; h = mjpegLive(cam.conn.mjpegUrl, c(), { fps: 50 }, (j) => { h?.stop(); resolve(j); }, (why) => reject(new Error(why === "stopped" ? "No picture" : why))); setTimeout(() => { h?.stop(); reject(new Error("The camera took too long to answer.")); }, 15_000).unref?.(); });
    },
    live: (o, onFrame, onEnd) => (cam.conn.mjpegUrl ? mjpegLive(cam.conn.mjpegUrl, c(), o, onFrame, onEnd) : pollLive(o, onFrame, onEnd)),
    ffmpegInput: cam.conn.mjpegUrl ? () => { const k = c(); return ["-f", "mjpeg", "-i", secret.fill(cam.conn.mjpegUrl, k.username, k.password)]; } : null };
}

// ---- ONVIF: the camera tells us its addresses (asked once, then kept in memory) ----
export function onvifSource(cam) {
  const dev = () => ({ host: cam.conn.host, port: cam.conn.port || 80, xaddr: cam.conn.xaddr || null, ...creds(cam) });
  let addrs = null;
  const resolveAddrs = async () => {
    if (addrs) return addrs;
    const d = dev();
    const ps = await onvif.profiles(d);
    if (!ps.length) throw new Error("The camera didn't list any video profiles.");
    const p = ps.find((x) => x.token === cam.conn.profile) ?? ps[0];
    const [stream, snap] = await Promise.all([onvif.streamUri(d, p.token).catch(() => null), onvif.snapshotUri(d, p.token).catch(() => null)]);
    addrs = { profile: p, stream, snap };
    return addrs;
  };
  return { ...base(cam), recordCopy: true, caps: { live: true, clip: true, recordings: true },
    async snapshot() {
      const a = await resolveAddrs(), k = creds(cam);
      if (a.snap) { try { return await httpSnapshot(a.snap, k); } catch (e) { if (!a.stream) throw e; } }
      if (!a.stream) throw new Error("The camera gave no picture or stream address.");
      return ff.grab(streamInput(withCreds(a.stream, k)), { width: 1920 });
    },
    live: (o, onFrame, onEnd) => {
      let h = null, stopped = false;
      resolveAddrs().then((a) => { if (stopped) return; if (!a.stream) return onEnd("no stream"); h = ff.frames(streamInput(withCreds(a.stream, creds(cam))), { fps: o?.fps ?? 2, width: o?.width ?? 640 }, onFrame, onEnd); }).catch((e) => onEnd(e.message));
      return { stop() { stopped = true; h?.stop(); } };
    },
    ffmpegInputAsync: async () => { const a = await resolveAddrs(); return a.stream ? streamInput(withCreds(a.stream, creds(cam))) : null; },
    async recordings() {
      const list = await onvif.recordings(dev());
      return list.map((r) => ({ ref: `onvif:${r.token}`, name: r.source || r.token, at: r.from, end: r.to, type: "video/mp4", kind: "stream" }));
    },
    async fetchRecording(ref, { seconds = 60 } = {}) {
      const token = String(ref).replace(/^onvif:/, "");
      const uri = await onvif.replayUri(dev(), token);
      return { input: streamInput(withCreds(uri, creds(cam))), seconds };
    },
    _addrs: () => addrs };
}
export function withCreds(uri, { username, password }) {
  if (!username) return uri;
  try { const u = new URL(uri); if (!u.username) { u.username = username; u.password = password; } return u.href; } catch { return uri; }
}
