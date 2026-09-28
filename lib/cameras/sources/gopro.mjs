// GoPro, through Open GoPro (GoPro's own HTTP API; HERO9 and newer):
//   over USB: plug the GoPro in, it appears as a network adapter; the camera is at 172.2X.1YZ.51:8080 (X Y Z = the last
//             three digits of its serial number). Dayspring turns on wired control first (/gopro/camera/control/wired_usb?p=1).
//   over Wi-Fi: join this computer to the GoPro's own Wi-Fi (it's at 10.5.5.9:8080). The GoPro's Wi-Fi has to be switched
//             on from the GoPro Quik app or the camera's Connections menu first.
//   mode "preview": the live preview (it streams to this computer on UDP port 8554; ffmpeg takes a frame)
//   mode "photo":   takes a real photo (photo preset group, shutter) and downloads it from the camera
//   recordings: the camera's own media list (photos and videos on its SD card), fetched and played on the screen
//   Webcam mode (the GoPro Webcam desktop app, or HERO12+ as a plain USB webcam) shows up as a USB webcam instead.
import * as ff from "../ffmpeg.mjs";
import { camFetch } from "../http-auth.mjs";

export function hostFor(serial) {
  const s = String(serial ?? "").replace(/\D/g, "").slice(-3).padStart(3, "0");
  return `172.2${s[0]}.1${s[1]}${s[2]}.51`;
}
export function gopro(cam) {
  const via = cam.conn.via === "wifi" ? "wifi" : "usb";
  const host = cam.conn.host || (via === "wifi" ? "10.5.5.9" : cam.conn.serial ? hostFor(cam.conn.serial) : "");
  const port = Number(cam.conn.port) || 8080;
  const base = `http://${host}:${port}`;
  const get = async (path, opts = {}) => { const r = await camFetch(base + path, { timeoutMs: 10_000, maxBytes: 60e6, ...opts }); return r; };
  const json = async (path) => { const r = await get(path); try { return JSON.parse(r.buf.toString("utf8") || "{}"); } catch { return {}; } };
  let wired = false;
  const ready = async () => { if (via === "usb" && !wired) { await get("/gopro/camera/control/wired_usb?p=1").catch(() => {}); wired = true; } };
  const udpPort = Number(cam.conn.udpPort) || 8554;
  const previewInput = () => ["-fflags", "nobuffer", "-f", "mpegts", "-i", `udp://0.0.0.0:${udpPort}?timeout=8000000&overrun_nonfatal=1&fifo_size=500000`];
  let keep = null;
  const keepAlive = (on) => { clearInterval(keep); keep = on ? setInterval(() => get("/gopro/camera/keep_alive").catch(() => {}), 3000) : null; keep?.unref?.(); };

  const latestPhoto = async () => {
    const list = await json("/gopro/media/list");
    let best = null;
    for (const d of list.media ?? []) for (const f of d.fs ?? []) if (/\.jpe?g$/i.test(f.n) && (!best || Number(f.cre) >= Number(best.cre))) best = { dir: d.d, ...f };
    return best;
  };
  const busy = async () => { const st = await json("/gopro/camera/state"); return Boolean(st.status?.["8"] || st.status?.["10"]); };   // 8 busy, 10 encoding

  return {
    id: cam.id, name: cam.name, kind: "gopro", room: cam.room ?? "", role: cam.role ?? "general", publicFacing: Boolean(cam.publicFacing),
    recordCopy: true, caps: { live: true, clip: true, recordings: true },
    async snapshot() {
      if (!host) throw new Error("Type the GoPro's serial number (for USB) or pick Wi-Fi.");
      await ready();
      if ((cam.conn.mode ?? "photo") === "photo") {
        const before = await latestPhoto().catch(() => null);
        await get("/gopro/camera/presets/set_group?id=1001");            // the photo group
        await get("/gopro/camera/shutter/start");
        for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 400)); if (!(await busy().catch(() => false))) break; }
        const after = await latestPhoto();
        if (!after || (before && after.n === before.n && after.dir === before.dir)) throw new Error("The GoPro didn't save a new photo.");
        const buf = (await get(`/videos/DCIM/${after.dir}/${after.n}`)).buf;
        return ff.isJpeg(buf) ? ff.resize(buf, 1920).catch(() => buf) : buf;
      }
      await get("/gopro/camera/stream/start").catch(() => {});
      try { return await ff.grab(previewInput(), { width: 1280, timeoutMs: 15_000 }); }
      finally { if (!keep) get("/gopro/camera/stream/stop").catch(() => {}); }
    },
    live(o, onFrame, onEnd) {
      let h = null, stopped = false;
      ready().then(() => get("/gopro/camera/stream/start")).then(() => {
        if (stopped) return;
        keepAlive(true);
        h = ff.frames(previewInput(), { fps: o?.fps ?? 2, width: o?.width ?? 640 }, onFrame, (why) => { keepAlive(false); onEnd(why); });
      }).catch((e) => onEnd(e.message));
      return { stop() { stopped = true; h?.stop(); keepAlive(false); get("/gopro/camera/stream/stop").catch(() => {}); } };
    },
    ffmpegInput: previewInput,
    async recordings() {
      await ready();
      const list = await json("/gopro/media/list");
      const out = [];
      for (const d of list.media ?? []) for (const f of d.fs ?? []) {
        const video = /\.(mp4|lrv|360)$/i.test(f.n);
        if (/\.(lrv|thm)$/i.test(f.n)) continue;
        out.push({ ref: `gopro:${d.d}/${f.n}`, name: f.n, at: f.cre ? new Date(Number(f.cre) * 1000).toISOString() : null, size: Number(f.s) || null, type: video ? "video/mp4" : "image/jpeg", kind: "file", thumb: `gopro-thumb:${d.d}/${f.n}` });
      }
      return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },
    async fetchRecording(ref, { stream = true } = {}) {
      const path = String(ref).replace(/^gopro(-thumb)?:/, "");
      if (!/^[\w-]+\/[\w-]+\.(jpe?g|mp4|360|gpr)$/i.test(path)) throw new Error("That isn't a file on the GoPro.");
      if (/^gopro-thumb:/.test(ref)) return { buf: (await get(`/gopro/media/thumbnail?path=${encodeURIComponent(path)}`)).buf, type: "image/jpeg" };
      const r = await camFetch(`${base}/videos/DCIM/${path}`, { stream, timeoutMs: 30_000 });
      return { res: r.res, buf: r.buf, type: /\.mp4$/i.test(path) ? "video/mp4" : "image/jpeg", name: path.split("/").pop(), length: Number(r.res?.headers.get("content-length")) || null };
    },
  };
}
// Which models do what (docs/cameras.md has the same table)
export const MODELS = [
  { model: "HERO13, HERO12", http: true, preview: true, photo: true, media: true, webcam: "USB (UVC) or GoPro Webcam app" },
  { model: "HERO11 (and Mini), HERO10", http: true, preview: true, photo: true, media: true, webcam: "GoPro Webcam app" },
  { model: "HERO9 (firmware 1.60+)", http: true, preview: true, photo: true, media: true, webcam: "GoPro Webcam app" },
  { model: "HERO8", http: false, preview: false, photo: false, media: false, webcam: "GoPro Webcam app (webcam firmware)" },
  { model: "MAX, HERO7 and older", http: false, preview: false, photo: false, media: false, webcam: "no" },
];
