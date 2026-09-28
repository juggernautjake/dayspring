// A Bambu printer's camera.
//   X1 / X1C / X1E / H2D / H2S / P2S: an RTSPS stream on port 322 (rtsps://bblp:<access code>@<ip>:322/streaming/live/1),
//     read with ffmpeg (ffmpeg-static ships with Dayspring). H2D/H2S also need "LAN Only Liveview" turned on.
//   P1P / P1S / A1 / A1 mini: JPEG pictures over TLS on port 6000. We send an 80-byte login (0x40, 0x3000, zeros, then
//     "bblp" and the access code, each padded to 32 bytes); each picture then comes with a 16-byte header (its size,
//     little-endian, in the first 4 bytes). About one picture a second at 1280×720.
// Both are turned into the same thing: snapshot() → one JPEG, live({ fps }, onFrame, onEnd) → { stop }.
import { connect as tlsConnect } from "node:tls";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export const FFMPEG = () => process.env.DAYSPRING_FFMPEG || ffmpegPath;
export const rtspsUrl = (host, accessCode, port = 322) => `rtsps://bblp:${encodeURIComponent(accessCode)}@${host}:${port}/streaming/live/1`;
export function authPacket(accessCode, user = "bblp") {
  const b = Buffer.alloc(80);
  b.writeUInt32LE(0x40, 0); b.writeUInt32LE(0x3000, 4);
  b.write(user, 16, 32, "ascii"); b.write(String(accessCode ?? ""), 48, 32, "ascii");
  return b;
}
const isJpeg = (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8;

// ---- P1 / A1: the TLS picture stream ----
export function tcpFrames({ host, port = 6000, accessCode }, onFrame, onEnd = () => {}) {
  let buf = Buffer.alloc(0), need = null, ended = false, got = 0;
  const sock = tlsConnect({ host, port, rejectUnauthorized: false, servername: /^\d+\.\d+\.\d+\.\d+$/.test(host) ? undefined : host });
  const end = (why) => { if (ended) return; ended = true; try { sock.destroy(); } catch { /* gone */ } onEnd(why); };
  const idle = setInterval(() => { if (Date.now() - last > 15_000) end(got ? "The camera stopped sending pictures." : "The camera didn't send a picture. Check the access code and that LAN mode is on."); }, 3000);
  let last = Date.now();
  sock.on("secureConnect", () => sock.write(authPacket(accessCode)));
  sock.on("data", (d) => {
    last = Date.now();
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (need === null) { if (buf.length < 16) return; need = buf.readUInt32LE(0); buf = buf.subarray(16); if (need <= 0 || need > 8e6) { end("The camera sent something that isn't a picture."); return; } }
      if (buf.length < need) return;
      const jpg = Buffer.from(buf.subarray(0, need)); buf = buf.subarray(need); need = null;
      if (isJpeg(jpg)) { got++; try { onFrame(jpg); } catch { /* a listener */ } }
    }
  });
  sock.on("error", (e) => end(/ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/.test(e.code ?? "") ? "Couldn't reach the printer's camera. Is LAN mode on?" : e.message));
  sock.on("close", () => { clearInterval(idle); end("closed"); });
  return { stop() { clearInterval(idle); end("stopped"); } };
}
export function tcpSnapshot(opts, { timeoutMs = 12_000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; h.stop(); reject(new Error("The printer's camera didn't send a picture in time.")); } }, timeoutMs);
    const h = tcpFrames(opts, (jpg) => { if (done) return; done = true; clearTimeout(t); h.stop(); resolve(jpg); }, (why) => { if (done || why === "stopped") return; done = true; clearTimeout(t); reject(new Error(why)); });
  });
}

// ---- X1 / H2: ffmpeg ----
function inputArgs(url) {
  if (/^rtsps?:/i.test(url)) return ["-rtsp_transport", "tcp", "-timeout", "10000000", "-i", url];
  return ["-i", url];      // a file or an http(s) stream (tests; cameras assigned from elsewhere)
}
export function ffmpegSnapshot(url, { timeoutMs = 20_000, width = 1280 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG(), ["-loglevel", "error", "-y", ...inputArgs(url), "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { windowsHide: true });
    const out = []; let err = "";
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } reject(new Error("The camera didn't send a picture in time.")); }, timeoutMs);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => { if (err.length < 3000) err += d; });
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", () => { clearTimeout(t); const b = Buffer.concat(out); if (isJpeg(b)) resolve(b); else reject(new Error(/401|Unauthorized/i.test(err) ? "The camera didn't accept the access code." : /refused|timed out|No route/i.test(err) ? "Couldn't reach the printer's camera (for H2D/H2S, turn on LAN Only Liveview)." : `The camera didn't send a picture (${err.split("\n").filter(Boolean).pop()?.replace(/rtsps?:\/\/[^@\s]*@/g, "rtsps://***@").slice(0, 120) ?? "no answer"}).`)); });
  });
}
export function ffmpegFrames(url, { fps = 2, width = 960 } = {}, onFrame, onEnd = () => {}) {
  const p = spawn(FFMPEG(), ["-loglevel", "error", ...(/^rtsps?:/.test(url) ? [] : ["-re"]), ...inputArgs(url), "-an", "-vf", `fps=${fps},scale='min(${width},iw)':-2`, "-q:v", "6", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { windowsHide: true });
  let buf = Buffer.alloc(0), stopped = false;
  p.stdout.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const s = buf.indexOf(Buffer.from([0xff, 0xd8])); if (s < 0) { buf = Buffer.alloc(0); return; }
      const e = buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2); if (e < 0) { buf = buf.subarray(s); return; }
      const f = Buffer.from(buf.subarray(s, e + 2)); buf = buf.subarray(e + 2);
      try { onFrame(f); } catch { /* a listener */ }
    }
  });
  p.on("close", (code) => onEnd(stopped ? "stopped" : code === 0 ? "ended" : "The camera stream stopped."));
  p.on("error", (e) => onEnd(e.message));
  return { pid: p.pid, stop() { stopped = true; try { p.kill("SIGKILL"); } catch { /* gone */ } } };
}

// the camera source for one printer (the shape lib/cameras uses)
export function sourceFor(printer, accessCode, modelInfo) {
  const kind = printer.cameraUrl ? "url" : modelInfo?.camera ?? "none";
  if (kind === "none") return null;
  const url = printer.cameraUrl || rtspsUrl(printer.host, accessCode, printer.cameraPort || 322);
  return {
    id: `printer-${printer.id}`, name: `${printer.name} camera`, kind: "printer", role: "printer", room: printer.room ?? "",
    snapshot: () => (kind === "tcp" ? tcpSnapshot({ host: printer.host, port: printer.cameraPort || 6000, accessCode }) : ffmpegSnapshot(url)),
    live: (o = {}, onFrame, onEnd) => {
      if (kind !== "tcp") return ffmpegFrames(url, { fps: o.fps ?? 2, width: o.width ?? 960 }, onFrame, onEnd);
      // the P1/A1 stream is about 1 picture a second already; slower rates drop frames
      let lastAt = 0; const every = 1000 / Math.max(0.05, o.fps ?? 2);
      return tcpFrames({ host: printer.host, port: printer.cameraPort || 6000, accessCode }, (f) => { if (Date.now() - lastAt >= every - 50) { lastAt = Date.now(); onFrame(f); } }, onEnd);
    },
    ...(kind !== "tcp" ? { ffmpegInput: () => inputArgs(url) } : {}),
  };
}
