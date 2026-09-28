// Home Assistant cameras, through the Home Assistant connection the owner already made (Settings → Apps,
// lib/connectors/homeassistant.mjs; its address and token are read from the connector's own file, never copied here):
//   still:  GET /api/camera_proxy/<camera.entity>        live: GET /api/camera_proxy_stream/<camera.entity> (MJPEG)
// Any camera Home Assistant has (Nest, Ring, Blink, Arlo, UniFi Protect, Frigate, the unofficial Tactacam integration…)
// works this way.
import * as store from "../../connectors/store.mjs";
import * as ff from "../ffmpeg.mjs";

const cfg = () => store.load("homeassistant");
export const connected = () => Boolean(cfg().url && cfg().token);
async function haFetch(path, { stream = false, signal } = {}) {
  const c = cfg();
  if (!c.url || !c.token) throw new Error("Home Assistant isn't connected yet. Add it in Settings → Apps & connections.");
  const res = await fetch(c.url.replace(/\/+$/, "") + path, { headers: { authorization: `Bearer ${c.token}` }, signal: signal ?? AbortSignal.timeout(15_000) });
  if (res.status === 401) throw new Error("Home Assistant didn't accept the token. Reconnect it in Settings → Apps & connections.");
  if (!res.ok) throw new Error(`Home Assistant answered ${res.status} for that camera.`);
  return res;
}
export async function list() {
  const res = await haFetch("/api/states");
  return (await res.json()).filter((e) => e.entity_id.startsWith("camera.")).map((e) => ({ entity: e.entity_id, name: e.attributes?.friendly_name || e.entity_id, state: e.state }));
}
export function homeassistant(cam) {
  const entity = cam.conn.entity;
  return {
    id: cam.id, name: cam.name, kind: "homeassistant", room: cam.room ?? "", role: cam.role ?? "general", publicFacing: Boolean(cam.publicFacing),
    recordCopy: false, caps: { live: true, clip: false },
    async snapshot() {
      const buf = Buffer.from(await (await haFetch(`/api/camera_proxy/${encodeURIComponent(entity)}`)).arrayBuffer());
      if (ff.isJpeg(buf)) return buf;
      const r = await ff.run(["-i", "pipe:0", "-frames:v", "1", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { input: buf });
      if (!ff.isJpeg(r.stdout)) throw new Error("Home Assistant didn't send a picture for that camera.");
      return r.stdout;
    },
    live(o, onFrame, onEnd) {
      const ctl = new AbortController(); let stopped = false, last = 0;
      (async () => {
        try {
          const res = await haFetch(`/api/camera_proxy_stream/${encodeURIComponent(entity)}`, { stream: true, signal: ctl.signal });
          const split = new ff.JpegSplitter((j) => { const now = Date.now(); if (now - last >= 1000 / (o?.fps ?? 2)) { last = now; onFrame(j); } });
          for await (const chunk of res.body) split.push(Buffer.from(chunk));
          onEnd(stopped ? "stopped" : "ended");
        } catch (e) { onEnd(stopped ? "stopped" : e.message); }
      })();
      return { stop() { stopped = true; ctl.abort(); } };
    },
  };
}
