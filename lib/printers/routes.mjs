// /api/printers/*: the Printers page and Settings → Printers. Local pages only (server.mjs refuses anything else).
//   GET  /printers                          every printer: status, camera, queue, current job
//   GET  /printers/catalog                  brands, models, the LAN / Developer mode guide facts, serial ports, slicer
//   POST /printers/printer                  add or change one (access code / API key are sealed, never sent back)
//   POST /printers/:id/test                 connect and say what it answered
//   GET  /printers/:id/snapshot.jpg         one picture now        GET /printers/:id/live   MJPEG (multipart) live view
//   POST /printers/:id/reference            take the empty-bed picture     POST /printers/:id/bed   { roi, plate }
//   GET  /printers/:id/reference.jpg · /printers/:id/bedcheck.jpg          POST /printers/:id/bedcheck
//   POST /printers/:id/command { action, value, approve }                POST /printers/:id/start { file, plate, amsMapping, options, approve }
//   GET/POST/DELETE /printers/:id/queue …   GET /printers/:id/jobs · /printers/:id/jobs/:job/:file
import { existsSync, readFileSync, createReadStream } from "node:fs";
import { join } from "node:path";
import * as printers from "./index.mjs";
import * as store from "./store.mjs";
import * as queue from "./queue.mjs";
import * as monitor from "./monitor.mjs";
import * as bridge from "./camera-bridge.mjs";
import * as slicer from "./slicer.mjs";
import { MODELS } from "./bambu/models.mjs";
import { guessFromSerial } from "./bambu/models.mjs";
import { listPorts } from "./marlin/sender.mjs";
import * as gate from "../devices/gate.mjs";
import * as confirm from "../confirm.mjs";
import * as activity from "../activity.mjs";

const pub = (p) => ({ ...p, hasAccessCode: Boolean(store.secretFor(p.id).accessCode), hasApiKey: Boolean(store.secretFor(p.id).apiKey), hasReference: Boolean(printers.reference(p)) });
function jpeg(res, buf) { res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "content-length": buf.length }); res.end(buf); }
export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/printers")) return false;
  if (!gate.on("printers")) { send(res, 404, { error: "Printers aren't turned on in this version of Dayspring." }); return true; }
  const body = async () => (m === "GET" ? {} : await readJSON(req).catch(() => ({})));
  let mm;
  try {
    if (m === "GET" && p === "/printers") return send(res, 200, { printers: store.list().map((x) => ({ ...pub(x), status: printers.status(x.id), job: monitor.current(x.id) ? monitor.publicJob(monitor.current(x.id)) : null, queue: queue.list(x.id) })) }), true;
    if (m === "GET" && p === "/printers/catalog") return send(res, 200, { brands: Object.fromEntries(Object.entries(printers.ADAPTERS).map(([k, a]) => [k, a.meta])), bambuModels: Object.entries(MODELS).map(([id, x]) => ({ id, ...x })), ports: await listPorts(), slicer: slicer.find()?.name ?? null }), true;
    if (m === "GET" && p === "/printers/guess") return send(res, 200, { model: guessFromSerial(q.get("serial")) }), true;
    if (m === "POST" && p === "/printers/printer") { const b = await body(); const x = store.savePrinter(b); printers.forget(x.id); activity.log("settings.printers", { saved: x.id, brand: x.brand, model: x.model }); printers.connection(x.id).catch(() => {}); return send(res, 200, { printer: pub(x) }), true; }
    if (m === "DELETE" && (mm = p.match(/^\/printers\/([\w-]+)$/))) { printers.forget(mm[1]); return send(res, 200, { removed: store.removePrinter(mm[1]) }), true; }
    if (!(mm = p.match(/^\/printers\/([\w-]+)(\/.*)?$/))) return false;
    const id = mm[1], rest = mm[2] ?? "", pr = store.get(id);
    if (!pr) return send(res, 404, { error: "No such printer." }), true;
    if (m === "POST" && rest === "/test") { printers.forget(id); try { const c = await printers.connection(id, { connect: false }); return send(res, 200, await c.test()), true; } catch (e) { return send(res, 200, { ok: false, text: e.message }), true; } }
    if (m === "POST" && rest === "/options") return send(res, 200, { options: store.setOptions(id, await body()) }), true;
    if (m === "GET" && rest === "/status") { await printers.connection(id).catch(() => {}); return send(res, 200, printers.status(id)), true; }
    if (m === "GET" && rest === "/snapshot.jpg") { try { return jpeg(res, await printers.snapshot(id)), true; } catch (e) { return send(res, 503, { error: e.message }), true; } }
    if (m === "GET" && rest === "/live") {
      await printers.connection(id).catch(() => {});
      const cam = printers.cameraId(id); if (!cam) return send(res, 404, { error: "No camera." }), true;
      const B = "dsframe";
      res.writeHead(200, { "content-type": `multipart/x-mixed-replace; boundary=${B}`, "cache-control": "no-store", connection: "close" });
      let stop = null; let closed = false;
      const push = (f) => { if (closed || !f) return; try { res.write(`--${B}\r\ncontent-type: image/jpeg\r\ncontent-length: ${f.length}\r\n\r\n`); res.write(f); res.write("\r\n"); } catch { /* closed */ } };
      req.on("close", () => { closed = true; try { stop?.(); } catch { /* gone */ } });
      try { stop = await bridge.live(cam, push, { fps: Number(q.get("fps")) || 2 }); }
      catch {
        // no live stream: a picture every few seconds instead
        const t = setInterval(async () => { if (closed) return clearInterval(t); try { push(await printers.snapshot(id)); } catch { /* next time */ } }, 3000);
        stop = () => clearInterval(t);
        printers.snapshot(id).then(push).catch(() => {});
      }
      return true;
    }
    if (m === "POST" && rest === "/reference") { const b = await body(); return send(res, 200, await printers.captureReference(id, { plate: b.plate })), true; }
    if (m === "GET" && rest === "/reference.jpg") { const r = printers.reference(pr); return r ? (jpeg(res, r), true) : (send(res, 404, { error: "No empty-bed picture yet." }), true); }
    if (m === "POST" && rest === "/bed") return send(res, 200, { bed: store.setBed(id, await body()) }), true;
    if (m === "POST" && rest === "/bedcheck") return send(res, 200, await printers.checkBed(id)), true;
    if (m === "GET" && rest === "/bedcheck.jpg") { const f = join(store.REFS_DIR(), `${id.replace(/[^\w-]/g, "_")}-lastcheck.jpg`); return existsSync(f) ? (jpeg(res, readFileSync(f)), true) : (send(res, 404, { error: "No check yet." }), true); }
    // a button on the page is the owner's own click: a stop's "Yes, stop it" is approved as it's made
    if (m === "POST" && rest === "/command") {
      const b = await body();
      const token = b.approve && b.action === "stop" ? confirm.issueApproved({ tool: "printer_stop", printer: id }, { what: "printer stop", via: "click" }) : undefined;
      return send(res, 200, await printers.command(id, b.action, b.value, { confirmToken: token, surface: "tv" })), true;
    }
    if (m === "POST" && rest === "/start") {
      const b = await body();
      const file = b.file ?? null;
      const token = b.approve ? confirm.issueApproved({ tool: "printer_start", printer: id, file: String(file), plate: Number(b.plate) || 1 }, { what: "printer start", via: "click" }) : undefined;
      return send(res, 200, await printers.startPrint(id, { file, plate: Number(b.plate) || 1, amsMapping: b.amsMapping, options: b.options, queueItem: b.queueItem, confirmToken: token, surface: "tv" })), true;
    }
    if (m === "GET" && rest === "/queue") return send(res, 200, { queue: queue.list(id), folder: pr.queue?.folder ?? "" }), true;
    if (m === "POST" && rest === "/queue") { const b = await body(); return send(res, 200, { item: queue.add(id, b) }), true; }
    if (m === "POST" && rest === "/queue/folder") { const b = await body(); return send(res, 200, { added: queue.setFolder(id, b.folder) }), true; }
    if (m === "POST" && rest === "/queue/move") { const b = await body(); return send(res, 200, { moved: queue.move(id, b.id, b.dir) }), true; }
    if (m === "DELETE" && (mm = rest.match(/^\/queue\/([\w]+)$/))) return send(res, 200, { removed: queue.remove(id, mm[1]) }), true;
    if (m === "POST" && rest === "/result") { const b = await body(); return send(res, 200, await monitor.confirmResult(id, b.good === true) ?? { error: "Nothing waiting." }), true; }
    if (m === "GET" && rest === "/jobs") return send(res, 200, { current: monitor.current(id) ? monitor.publicJob(monitor.current(id)) : null, history: monitor.history(id) }), true;
    if (m === "GET" && (mm = rest.match(/^\/jobs\/([\w.-]+)\/([\w.-]+\.(?:jpg|mp4|txt))$/))) {
      const f = join(monitor.jobDir(id, mm[1]), mm[2]);
      if (!f.startsWith(join(store.PRINTS_DIR())) || !existsSync(f)) return send(res, 404, { error: "Not there." }), true;
      res.writeHead(200, { "content-type": mm[2].endsWith(".jpg") ? "image/jpeg" : mm[2].endsWith(".mp4") ? "video/mp4" : "text/plain; charset=utf-8", "cache-control": "max-age=60" });
      createReadStream(f).pipe(res); return true;
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  send(res, 404, { error: `no route ${m} ${p}` });
  return true;
}
