// Remote control: what THIS device does when one of the owner's other devices asks (after the engine has checked the
// signature, the time, the nonce, the permission and any confirmation). Each handler still goes through this device's
// own rules: the device layer's safety checks, quiet time, and the activity log.
//
//   builtins({ announce, broadcast, version, onNotify }) → Map(kind → { fn(args, ctx), names?(), risky?(args) })
//   ctx: { from: { deviceId, name }, confirmed, remote: true }
//
// Smart devices, 3D printers and cameras come from other parts of Dayspring built alongside this:
//   lib/devices/index.mjs    run(command, { from: { id, name, verified: true, owner: true } }) · registry.devices() (names)
//   lib/cameras/index.mjs    list() → [{ id, name }] · snapshot(id) → JPEG · clip(id, { seconds })  (clip: TODO, not there yet)
//   lib/printers/index.mjs   status(which) → { say } · snapshot(which) → JPEG · start(which, job, { from, confirmed })
//                            (the same bed check and yes as at home) · names()
// Any of them may call remote.registerHandler(kind, fn, meta) itself instead, which replaces the adapter here.
import { hostname, uptime } from "node:os";

const mods = new Map();
async function mod(name) {
  if (!mods.has(name)) mods.set(name, import(`../${name}/index.mjs`).then((m) => m, () => null));
  return mods.get(name);
}
export function _forgetModules() { mods.clear(); }
export function _useModule(name, m) { mods.set(name, Promise.resolve(m)); }   // tests: a stand-in for lib/<name>/index.mjs
const F = await import("../features.mjs").catch(() => null);
const printersOn = () => { try { return F?.on ? F.on("printers") !== false : true; } catch { return true; } };
const namesOf = async (name) => {
  const m = await mod(name);
  if (!m) return [];
  try {
    if (typeof m.names === "function") return (await m.names()).map(String);
    if (typeof m.list === "function") return (await m.list()).map((x) => (typeof x === "string" ? x : x?.name ?? x?.nickname ?? "")).filter(Boolean);
  } catch { /* none */ }
  return [];
};
const notSetUp = (what) => ({ ok: false, error: `${what} isn't set up on this device yet` });

export function builtins({ announce = () => {}, broadcast = () => {}, version = "0", onNotify = () => {}, store = null, reminders = null, recent = () => [] } = {}) {
  const H = new Map();
  const started = Date.now();

  H.set("status", { fn: async () => {
    const printers = await mod("printers");
    let printerLine = null;
    try { if (typeof printers?.status === "function") { const s = await printers.status(); printerLine = s?.say ?? null; } } catch { /* skip */ }
    const today = store ? (() => { try { const d = store.todayISO(); return store.blocksBetween(d, d).filter((b) => !b.done).slice(0, 3).map((b) => `${b.start ?? ""} ${b.title}`.trim()); } catch { return []; } })() : [];
    return { ok: true, version, host: hostname(), upMinutes: Math.round((Date.now() - started) / 60_000), machineUpHours: Math.round(uptime() / 3600), next: today, printers: printerLine,
      say: `Dayspring ${version} is running there${printerLine ? ". " + printerLine : ""}.` };
  } });

  H.set("schedule", { fn: async () => {
    if (!store) return notSetUp("The schedule");
    const d = store.todayISO();
    const blocks = store.blocksBetween(d, d).map((b) => ({ start: b.start ?? null, end: b.end ?? null, title: b.title, done: Boolean(b.done) }));
    const rem = reminders ? reminders.forDay(d).map((r) => ({ time: r.time, text: r.text })) : [];
    const notes = (recent() ?? []).slice(-5).map((x) => String(x?.text ?? "").slice(0, 200)).filter(Boolean);
    const left = blocks.filter((b) => !b.done);
    return { ok: true, today: d, blocks, reminders: rem, notifications: notes,
      say: left.length ? `Today there: ${left.slice(0, 4).map((b) => `${b.title}${b.start ? " at " + b.start : ""}`).join(", ")}${left.length > 4 ? `, and ${left.length - 4} more` : ""}.` : "Nothing else on the schedule there today." };
  } });

  // "tell the living room TV dinner's ready": said out loud and shown there
  H.set("announce", { fn: async (args, { from }) => {
    const text = String(args.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    if (!text) return { ok: false, error: "there was nothing to say" };
    announce({ kind: "remote", text: `${text}`, from: from.name });
    return { ok: true, say: `Said on this device: "${text}".` };
  } });

  // a reminder at a time today (or on a date): kept and rung like any other reminder there
  H.set("remind", { fn: async (args) => {
    if (!reminders || !store) return notSetUp("Reminders");
    const text = String(args.text ?? "").trim().slice(0, 300), time = /^\d{2}:\d{2}$/.test(String(args.time ?? "")) ? args.time : null;
    if (!text) return { ok: false, error: "there was nothing to remind about" };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? "")) ? args.date : store.todayISO();
    reminders.add({ date, time, text });
    return { ok: true, say: `Reminder set there${time ? " for " + time : ""}: ${text}.` };
  } });

  // camera alerts and other notifications from the owner's devices (remote.notify)
  H.set("notify", { fn: async (args, { from }) => {
    const title = String(args.title ?? "").slice(0, 200), body = String(args.body ?? "").slice(0, 2000);
    const n = onNotify({ title, body, from: from.name, image: Buffer.isBuffer(args.image) ? args.image : null, imageType: args.imageType ?? null });
    announce({ kind: "remote", text: [title, body].filter(Boolean).join(". "), from: from.name, image: n?.imageUrl ?? null });
    broadcast("remote-notify", { title, body, from: from.name, image: n?.imageUrl ?? null });
    return { ok: true, say: "Shown." };
  } });

  // ---- smart devices (lib/devices: run(command, { from: { id, name, verified: true, owner: true } }) → { ok, text, needsConfirm? }) ----
  // The device layer asks its own questions (bulk changes, a computer's power…), bound to the computer the command came
  // from. When the owner already said yes on that computer (the signed command says confirmed), that yes is given here.
  H.set("devices", { names: async () => {
    const m = await mod("devices");
    try { if (typeof m?.registry?.devices === "function") return m.registry.devices().flatMap((d) => [d.name, ...(Array.isArray(d.aliases) ? d.aliases : [])]).filter(Boolean).map(String); } catch { /* none */ }
    return namesOf("devices");
  }, fn: async (args, ctx) => {
    const m = await mod("devices");
    if (typeof m?.run !== "function") return notSetUp("Smart device control");
    const from = { id: ctx.from.deviceId, name: ctx.from.name, verified: true, owner: true };
    let r = await m.run(args.answer !== undefined ? { answer: String(args.answer) } : String(args.command ?? ""), { from });
    if (r?.needsConfirm && ctx.confirmed) r = await m.run({ answer: "yes" }, { from });
    if (typeof r === "string") return { ok: true, say: r };
    if (r?.needsConfirm) return { ok: false, needsConfirm: true, say: r.text ?? r.say ?? "That needs your OK first." };
    return { ok: r?.ok !== false, say: r?.text ?? r?.say ?? null, ...(r?.ok === false ? { error: r?.text ?? "it didn't work" } : {}) };
  } });

  // ---- 3D printers (lib/printers) ----
  // status(which): a fresh look first (connecting if needed), then the spoken line; null → no printer by that name here
  H.set("printers.status", { names: () => namesOf("printers"), fn: async (args) => {
    const m = await mod("printers");
    if (typeof m?.status !== "function" || !printersOn()) return notSetUp("3D printers");
    const which = args.printer ?? null;
    if (typeof m.connection === "function" && typeof m.resolve === "function") {
      const ids = which ? [m.resolve(which)?.id].filter(Boolean) : (m.list?.() ?? []).map((p) => p.id);
      await Promise.all(ids.map((id) => m.connection(id).catch(() => null)));
    }
    const r = await m.status(which);
    if (r == null) return { ok: false, error: `there's no printer called "${which}" there` };
    return typeof r === "string" ? { ok: true, say: r } : { ok: r?.ok !== false, say: r?.say ?? null, printers: r?.printers ?? undefined };
  } });
  H.set("printers.camera", { names: () => namesOf("printers"), fn: async (args) => {
    const m = await mod("printers");
    if (typeof m?.snapshot !== "function" || !printersOn()) return notSetUp("Printer cameras");
    try {
      const r = await m.snapshot(args.printer ?? null, { maxWidth: args.maxWidth ?? 960 });
      return Buffer.isBuffer(r) ? { ok: true, bytes: r, contentType: "image/jpeg" } : r?.bytes ? { ok: true, bytes: r.bytes, contentType: r.contentType ?? "image/jpeg" } : { ok: false, error: "no picture came back" };
    } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 200) }; }
  } });
  // start: the printer's own rules decide (a fresh bed check, and the owner's yes). The engine asks for the yes on the
  // computer that sent it (risky), and ctx.confirmed carries it; without it the answer is the question, and nothing starts.
  H.set("printers.start", { names: () => namesOf("printers"), risky: () => true, fn: async (args, ctx) => {
    const m = await mod("printers");
    if (typeof m?.start !== "function" || !printersOn()) return notSetUp("Starting prints");
    const r = await m.start(args.printer ?? null, args.job ?? null, { from: ctx.from, confirmed: ctx.confirmed === true });
    const say = r?.say ?? r?.text ?? null;
    if (r?.needsConfirm) return { ok: false, needsConfirm: true, say: say ?? "That needs your OK first." };
    if (r?.bedNotClear) return { ok: false, bedNotClear: true, say, error: say ?? "the bed isn't clear" };
    return { ok: r?.ok !== false, started: Boolean(r?.started), say, ...(r?.ok === false ? { error: say ?? "it didn't start" } : {}) };
  } });

  // ---- cameras (lib/cameras: list() → [{ id, name }], snapshot(id) → JPEG Buffer) ----
  const camId = async (m, want) => {
    const cams = typeof m?.list === "function" ? m.list() : [];
    const w = String(want ?? "").toLowerCase().replace(/\bcamera\b/g, "").replace(/^(the|my) /, "").trim();
    const hit = cams.find((c) => c.id === want) ?? cams.find((c) => String(c.name ?? "").toLowerCase() === w) ?? cams.find((c) => w && String(c.name ?? "").toLowerCase().includes(w));
    return hit?.id ?? (cams.length === 1 ? cams[0].id : null);
  };
  H.set("cameras.list", { names: () => namesOf("cameras"), fn: async () => ({ ok: true, cameras: await namesOf("cameras") }) });
  H.set("cameras.snapshot", { names: () => namesOf("cameras"), fn: async (args) => {
    const m = await mod("cameras");
    if (typeof m?.snapshot !== "function") return notSetUp("Cameras");
    const id = await camId(m, args.camera);
    if (!id) return { ok: false, error: `there's no camera called "${args.camera ?? ""}" there` };
    const r = await m.snapshot(id);
    return Buffer.isBuffer(r) ? { ok: true, bytes: r, contentType: "image/jpeg" } : r;
  } });
  H.set("cameras.clip", { names: () => namesOf("cameras"), fn: async (args) => {
    const m = await mod("cameras");
    if (typeof m?.clip !== "function") return notSetUp("Camera clips");         // TODO(cameras worker): clip(id, { seconds }) → { bytes, contentType: "video/mp4" }
    const id = await camId(m, args.camera);
    return id ? m.clip(id, { seconds: Math.min(Number(args.seconds) || 10, 30) }) : { ok: false, error: "no such camera there" };
  } });
  return H;
}
