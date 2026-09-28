// Remote control between the owner's Dayspring devices, end to end, against a stand-in hub (remote-mock-hub.mjs:
// auth, row level security, the dayspring_remote_* functions, Realtime). Never the real hub, never real data.
// Three simulated devices (Home TV, Laptop, Office PC), plus a thief who knows the password and a second account:
//   pairing with approval (the code on both screens), a forged pairing answer, signed commands, forged / tampered /
//   replayed / expired / unknown-device commands refused, permissions, end-to-end encryption (the hub's copy is
//   unreadable), risky commands confirmed on the SENDER, camera stills over the encrypted relay, notifications with a
//   picture, voice commands, offline and timeouts (no retries), queued commands expiring, revoking, no network (the
//   local things keep working), live updates, the SQL and the stand-in agreeing, DPAPI, and the feature switch.
//   node scripts/qa/remote-devices.mjs        exit 0 = all passed
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";

const DESK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TMP = mkdtempSync(join(tmpdir(), "ds-remote-"));
process.env.DAYSPRING_ACTIVITY_DIR = join(TMP, "activity");
process.env.DAYSPRING_REMOTE_DIR = join(TMP, "app-remote");
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const { startMockHub } = await import("./remote-mock-hub.mjs");
const { createRemote } = await imp("lib/remote/engine.mjs");
const E = await imp("lib/remote/envelope.mjs");
const { createSkills } = await imp("lib/remote/skills.mjs");
const confirm = await imp("lib/confirm.mjs");
const { LIMITS } = await imp("lib/remote/policy.mjs");

let passed = 0, failed = 0;
const rec = (area, ok, note = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${area}${note && !ok ? " — " + String(note).slice(0, 300) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* again */ } await sleep(100); } return null; };
const box = { protect: (b) => Buffer.from(b.map((x) => x ^ 0x5a)), unprotect: (b) => Buffer.from(b.map((x) => x ^ 0x5a)) };   // stands in for DPAPI

const OWNER = { email: "owner@example.test", password: "correct horse battery" };
const hub = await startMockHub({ users: [OWNER, { email: "someone-else@example.test", password: "another password" }] });
const cfg = () => ({ url: hub.url, anonKey: hub.anonKey });

// what each device does when asked (stands in for lib/devices, lib/printers, lib/cameras)
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(150_000), Buffer.from([0xff, 0xd9])]);
const did = { A: [], B: [], C: [], X: [] };
function handlersFor(key, { devices = [], printers = [] } = {}) {
  const H = new Map();
  H.set("announce", { fn: async (a, ctx) => { did[key].push({ action: "announce", text: a.text, from: ctx.from.name }); return { ok: true, say: "said" }; } });
  H.set("notify", { fn: async (a, ctx) => { did[key].push({ action: "notify", title: a.title, image: a.image, from: ctx.from.name }); return { ok: true }; } });
  H.set("status", { fn: async () => ({ ok: true, say: `${key} is fine` }) });
  if (devices.length) H.set("devices", { names: () => devices, fn: async (a, ctx) => { if (/everything/.test(a.command) && !ctx.confirmed) return { ok: false, needsConfirm: true, say: "That turns off 5 devices, including the fridge." }; did[key].push({ action: "devices", command: a.command, from: ctx.from.name, confirmed: ctx.confirmed }); return { ok: true, say: `done: ${a.command}` }; } });
  if (printers.length) {
    H.set("printers.status", { names: () => printers, fn: async (a) => ({ ok: true, say: `${a.printer ?? "printer"} is 42% done` }) });
    H.set("printers.camera", { names: () => printers, fn: async () => ({ ok: true, bytes: JPEG, contentType: "image/jpeg" }) });
    H.set("printers.start", { names: () => printers, fn: async (a, ctx) => { did[key].push({ action: "printers.start", confirmed: ctx.confirmed }); return { ok: true, say: "started" }; } });
  }
  return H;
}
const mk = (key, name, opts = {}) => createRemote({ dir: join(TMP, key), box, hubConfig: cfg, name, version: "9.9.9", handlers: handlersFor(key, opts), live: opts.live ?? true });
const A = mk("A", "Home TV", { devices: ["computer", "fan 1"], printers: ["printer 1", "printer 3"] });
const B = mk("B", "Laptop");
const C = mk("C", "Office PC", { devices: ["fan 2"] });
const all = [A, B, C];
const idOf = (e) => e._state().deviceId;

try {
  // ---- 1. signing in, the first device -------------------------------------------------------------------------------
  const a1 = await A.signIn(OWNER);
  rec("A signs in with his password and, as the account's first device, is approved", a1.signedIn && a1.status === "approved", JSON.stringify(a1));
  const keyFile = readFileSync(join(TMP, "A", "device-key.bin"));
  rec("A's private keys are on disk only encrypted (not readable as they are)", !keyFile.includes(Buffer.from(A._identity().sign.priv)) && !keyFile.includes(Buffer.from(A._identity().enc.priv)));
  rec("the hub only has A's PUBLIC keys", !JSON.stringify(hub.db.devices).includes(A._identity().sign.priv) && hub.db.devices[0].sign_pub === A._identity().sign.pub);
  rec("no password is kept anywhere", !readdirSync(join(TMP, "A")).some((f) => readFileSync(join(TMP, "A", f)).includes(Buffer.from(OWNER.password))));

  // ---- 2. pairing: the Laptop joins, approved on the Home TV, the code on both screens ---------------------------------
  const b1 = await B.signIn(OWNER);
  rec("B signs in and waits for approval (a password alone doesn't add a device)", b1.status === "pending", JSON.stringify(b1));
  rec("B shows 'waiting' until another device answers", (await B.pairingView()).state === "waiting");
  const reqs = await A.requests();
  rec("A sees the Laptop asking to join", reqs.length === 1 && reqs[0].device.name === "Laptop", JSON.stringify(reqs));
  const rv = await A.review(reqs[0].id);
  const bv = await B.pairingView();
  rec("the same 6-digit code shows on both screens", /^\d{3} \d{3}$/.test(rv.code) && bv.state === "offered" && bv.code === rv.code, `${rv.code} / ${bv.code}`);
  rec("B names the device that answered", bv.approverName === "Home TV", bv.approverName);
  await A.approve(reqs[0].id, ["status", "schedule", "announce", "control", "camera"]);
  rec("approved on A but not yet confirmed on B: B isn't in yet", (await B.pairingView()).state === "offered" && !B.approved());
  const b2 = await B.confirmPairing(true);
  rec("B confirms the codes match → approved, and trusts A", b2.state === "approved" && B.approved(), JSON.stringify(b2));

  // ---- 3. a thief with the password (X) --------------------------------------------------------------------------------
  const X = createRemote({ dir: join(TMP, "X"), box, hubConfig: cfg, name: "Thief laptop", version: "1", handlers: handlersFor("X"), live: false });
  globalThis.__X = X;
  const x1 = await X.signIn(OWNER);
  rec("the thief can sign in with the password, but only as a pending device", x1.status === "pending");
  let xErr = null; try { await X.review((await A.requests())[0].id); } catch (e) { xErr = e; }
  rec("a pending device can't answer pairing requests", Boolean(xErr), xErr?.message);
  xErr = null; try { await X.send(idOf(A), "status"); } catch (e) { xErr = e; }
  rec("a pending device can't send commands", Boolean(xErr));
  const xtok = hub.session(OWNER.email, OWNER.password).access_token;   // any sign-in, with no device bound
  const h = (await imp("lib/remote/hub.mjs")).createHub({ url: hub.url, anonKey: hub.anonKey });
  xErr = null; try { await h.rpc("dayspring_remote_send", { p_id: "00000000-0000-4000-8000-000000000000", p_from: idOf(A), p_to: idOf(B), p_kind: "cmd", p_envelope: {} }, xtok); } catch (e) { xErr = e; }
  rec("another sign-in can't send as one of his devices (sessions are bound to devices)", xErr?.kind === "denied", xErr?.message);
  const ai = A._identity();
  xErr = null; try { await h.rpc("dayspring_remote_register", { p_id: idOf(A), p_name: "Home TV", p_platform: "x", p_version: "1", p_client: "desk", p_sign_pub: ai.sign.pub, p_enc_pub: ai.enc.pub }, xtok); } catch (e) { xErr = e; }
  rec("…nor take over a signed-in device by registering its (public) keys", xErr?.kind === "denied" && hub.db.bindings.find((b) => b.device_id === idOf(A))?.session_id !== JSON.parse(Buffer.from(xtok.split(".")[1], "base64url")).session_id, xErr?.message);
  // the hub says X is approved (a malicious admin, or a hacked table): the devices still don't trust it
  const xrow = hub.db.devices.find((d) => d.id === idOf(X));
  Object.assign(xrow, { status: "approved", cert: E.makeCert(X._identity(), { user: xrow.user_id, device: xrow.id, signPub: xrow.sign_pub, encPub: xrow.enc_pub, name: "Thief", type: "approve" }) });
  await A.sync(); await B.sync();
  rec("a device the hub marks 'approved' without a real approval isn't trusted", !(await A.devices()).some((d) => d.id === idOf(X) && d.trust === "approved"));
  const forged = E.makeEnvelope({ identity: X._identity(), user: xrow.user_id, to: idOf(A), toEncPub: A._identity().enc.pub, kind: "cmd", payload: { action: "devices", args: { command: "turn on fan 1" } } });
  hub.db.messages.push({ id: forged.id, user_id: xrow.user_id, from_device: idOf(X), to_device: idOf(A), kind: "cmd", reply_to: null, seq: 0, envelope: forged, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() });
  const beforeX = did.A.length;
  await A.processInbox(); await sleep(200);
  rec("a command from a device that isn't his is refused", did.A.length === beforeX);

  // an emailed sign-in link works too (and never makes an account)
  const L = createRemote({ dir: join(TMP, "L"), box, hubConfig: cfg, name: "Link laptop", handlers: new Map(), live: false });
  await L.sendLink(OWNER.email, "http://127.0.0.1:4747/remote/auth/callback");
  const link = hub.db.links.at(-1);
  const l1 = await L.completeLink({ refresh_token: link.refresh_token });
  rec("signing in with an emailed link works, and the device waits for approval", l1.status === "pending" && /\/remote\/auth\/callback$/.test(link.redirect ?? ""), JSON.stringify(l1));
  let noAcct = null; try { await L.sendLink("nobody@example.test"); } catch (e) { noAcct = e; }
  rec("a sign-in link for an email with no account is refused (Dayspring never makes accounts)", Boolean(noAcct) && hub.db.users.length === 2);
  const lId = idOf(L);
  await L.signOutHere();
  rec("signing out on the device signs it out on the hub and deletes its keys", hub.db.devices.find((d) => d.id === lId)?.status === "revoked" && !existsSync(join(TMP, "L", "device-key.bin")));

  // ---- 4. the Office PC joins, approved on the Laptop; a forged pairing answer first ----------------------------------
  const c1 = await C.signIn(OWNER);
  rec("C signs in and waits", c1.status === "pending");
  let creq = (await B.requests()).find((r) => r.device.name === "Office PC");
  // a malicious admin answers C's request with the thief's keys: C's code won't match the real approver's
  const cp = hub.db.pairings.find((p) => p.id === creq.id);
  Object.assign(cp, { status: "offered", approver_id: idOf(X), offer: E.makeOffer(X._identity(), { user: xrow.user_id, pairing: cp.id }) });
  const cvBad = await C.pairingView();
  let rvErr = null; try { await B.review(creq.id); } catch (e) { rvErr = e; }
  rec("when another device already answered, the real approver is warned to start again", Boolean(rvErr) && /another device/i.test(rvErr.message), rvErr?.message);
  const cBack = await C.confirmPairing(false);
  rec("the owner says the codes don't match on C → cancelled, a new request starts", cBack.cancelled === true && cvBad.state === "offered");
  creq = (await B.requests()).find((r) => r.device.name === "Office PC");
  const rvC = await B.review(creq.id);
  const cv = await C.pairingView();
  rec("the fresh request shows matching codes (and the forged one didn't)", cv.code === rvC.code && cvBad.code !== rvC.code);
  await C.confirmPairing(true);
  await B.approve(creq.id, ["status", "control"]);
  const cDone = await until(async () => (await C.pairingView()).state === "approved");
  rec("C is approved on the Laptop", Boolean(cDone) && C.approved());
  await A.sync(); await B.sync(); await C.sync();
  rec("the Home TV trusts the Office PC too (vouched for by the Laptop)", (await A.devices()).find((d) => d.name === "Office PC")?.trust === "approved");
  rec("the Office PC trusts both others", (await C.devices()).filter((d) => d.trust === "approved").length === 2);
  rec("devices show online, platform and version", (await B.devices()).filter((d) => ["approved", "this"].includes(d.trust)).every((d) => typeof d.online === "boolean" && d.version === "9.9.9" && d.platform));
  for (const e of all) await e.publishProfile(true);
  for (const e of all) await e.sync();

  // ---- 5. signed commands --------------------------------------------------------------------------------------------
  const r1 = await B.send(idOf(A), "devices", { command: "turn on fan 1" });
  rec("a signed command from the Laptop runs on the Home TV", r1.ok && did.A.some((x) => x.command === "turn on fan 1" && x.from === "Laptop"), JSON.stringify(r1));
  rec("…and the answer comes back", /done: turn on fan 1/.test(r1.say ?? ""));
  const r2 = await C.send(idOf(A), "status");
  rec("status from another device", r2.ok && /fine/.test(r2.say), JSON.stringify(r2));

  // ---- 6. end-to-end encryption: what the hub keeps is unreadable ------------------------------------------------------
  await B.send(idOf(A), "announce", { text: "Dinner's ready, secret word pineapple" });
  const stored = JSON.stringify(hub.log);
  rec("the hub's copies never contain what was asked", !/pineapple|fan 1|Dinner/i.test(stored));
  const any = hub.log.find((m) => m.kind === "cmd").envelope;
  let opened = null; try { opened = E.openEnvelope(any, X._identity()); } catch { opened = null; }
  rec("a device the command wasn't for can't open it", opened === null);
  rec("the profile (what each device controls) is sealed too", !JSON.stringify(hub.db.devices).includes("printer 3"));

  // ---- 7. forged, tampered, replayed, expired ---------------------------------------------------------------------------
  const inject = (env, over = {}) => hub.db.messages.push({ id: env.id, user_id: xrow.user_id, from_device: env.from, to_device: env.to, kind: env.kind, reply_to: env.replyTo, seq: env.seq, envelope: env, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), ...over });
  const refusedBefore = did.A.length;
  // signed by the thief but claiming to be the Laptop
  const f2 = E.makeEnvelope({ identity: { ...X._identity(), deviceId: idOf(B) }, user: xrow.user_id, to: idOf(A), toEncPub: A._identity().enc.pub, kind: "cmd", payload: { action: "devices", args: { command: "turn on fan 1" } } });
  inject(f2);
  // a real one with the payload changed
  const real = E.makeEnvelope({ identity: B._identity(), user: xrow.user_id, to: idOf(A), toEncPub: A._identity().enc.pub, kind: "cmd", payload: { action: "announce", args: { text: "tampered" } } });
  const tampered = structuredClone(real); tampered.sealed.box.ct = Buffer.from(randomBytes(40)).toString("base64"); inject(tampered);
  // changed header (sent to someone else's id)
  const moved = { ...structuredClone(real), id: "11111111-1111-4111-8111-111111111111" }; inject(moved);
  // too old and expired, though properly signed by the Laptop
  const old = E.makeEnvelope({ identity: B._identity(), user: xrow.user_id, to: idOf(A), toEncPub: A._identity().enc.pub, kind: "cmd", payload: { action: "announce", args: { text: "old" } }, now: Date.now() - 10 * 60_000, ttlMs: 60_000 }); inject(old);
  const long = E.makeEnvelope({ identity: B._identity(), user: xrow.user_id, to: idOf(A), toEncPub: A._identity().enc.pub, kind: "cmd", payload: { action: "announce", args: { text: "forever" } }, ttlMs: 60 * 60_000 }); inject(long);
  await A.processInbox(); await sleep(300);
  rec("forged, tampered, moved, too-old and too-long-lived commands all refused", did.A.length === refusedBefore, JSON.stringify(did.A.slice(refusedBefore)));
  // replay: the first real command again, after it was picked up
  const firstCmd = hub.log.find((m) => m.kind === "cmd" && m.from_device === idOf(B) && m.to_device === idOf(A));
  const n0 = did.A.filter((x) => x.command === "turn on fan 1").length;
  inject(firstCmd.envelope);
  await A.processInbox(); await sleep(300);
  rec("a replayed command is refused (already received once)", did.A.filter((x) => x.command === "turn on fan 1").length === n0);

  // ---- 8. permissions -------------------------------------------------------------------------------------------------
  const p1 = await C.send(idOf(A), "printers.start", { printer: "printer 1" }, { confirmed: true });
  rec("the Office PC may not start prints (not granted)", p1.denied === true && !did.A.some((x) => x.action === "printers.start"), JSON.stringify(p1));
  const p2 = await C.send(idOf(A), "printers.camera", { printer: "printer 1" });
  rec("…nor see cameras", p2.denied === true);
  await A.setPerms(idOf(C), ["status"]);
  await B.sync();
  const p3 = await C.send(idOf(B), "announce", { text: "hello" });
  rec("after control and announce are taken away (on another device), the Laptop refuses too", p3.denied === true, JSON.stringify(p3));
  // C tries to give itself everything through the hub
  const cg = E.makeGrant(C._identity(), { user: xrow.user_id, device: idOf(C), perms: ["status", "control", "print", "camera", "announce", "schedule"] });
  hub.db.devices.find((d) => d.id === idOf(C)).perm_grant = cg;
  await A.sync();
  const p4 = await C.send(idOf(A), "devices", { command: "turn on fan 1" });
  rec("a device can't widen its own permissions", p4.denied === true, JSON.stringify(p4));
  await A.setPerms(idOf(C), ["status", "control", "announce"]); await B.sync();

  // ---- 9. risky things are confirmed on the SENDING device -----------------------------------------------------------
  const k0 = did.A.length;
  const r3 = await B.send(idOf(A), "devices", { command: "turn on my computer" });
  rec("the receiver refuses a risky command that wasn't confirmed", r3.needsConfirm === true && did.A.length === k0, JSON.stringify(r3));
  const skB = createSkills({ engine: () => B, confirm, localHas: () => false, show: async ({ bytes }) => `/still/${bytes.length}` });
  const ask = await skB.handle("turn on my home computer", { surface: "tv" });
  rec("\"turn on my home computer\" on the Laptop asks first", /are you sure/i.test(ask?.reply ?? "") && did.A.length === k0, ask?.reply);
  const notYet = await skB.handle("yes", { surface: "tv" });
  rec("…a yes only counts after the owner really said it (confirm.userSaid)", /couldn't take that/i.test(notYet?.reply ?? ""), notYet?.reply);
  await skB.handle("turn on my home computer", { surface: "tv" });
  confirm.userSaid("yes", { surface: "tv" });
  const done = await skB.handle("yes", { surface: "tv" });
  rec("…and after his yes it goes, marked confirmed, to the device that controls it", did.A.some((x) => x.command === "turn on my computer" && x.confirmed === true), done?.reply);
  const bulk = await skB.handle("on the home tv, turn off everything", { surface: "tv" });
  rec("the other device's own question (a bulk change) is asked here, in its words", /Home TV asks: That turns off 5 devices, including the fridge\. Are you sure\?/.test(bulk?.reply ?? "") && !did.A.some((x) => x.command === "turn off everything"), bulk?.reply);
  confirm.userSaid("yes", { surface: "tv" });
  await skB.handle("yes", { surface: "tv" });
  rec("…and after his yes here, it's done there", did.A.some((x) => x.command === "turn off everything" && x.confirmed));
  await skB.handle("turn on my home computer", { surface: "call" });
  confirm.userSaid("yes", { surface: "call" });
  const byCall = await skB.handle("yes", { surface: "call" });
  rec("a yes from someone on a call doesn't count", !/Home TV: done/.test(byCall?.reply ?? ""), byCall?.reply);

  // ---- 10. camera stills over the encrypted relay ---------------------------------------------------------------------
  const cam = await B.send(idOf(A), "printers.camera", { printer: "printer 1" });
  rec("a printer camera still arrives whole", Buffer.isBuffer(cam.bytes) && cam.bytes.equals(JPEG), `${cam.bytes?.length} bytes, ${cam.say ?? ""}`);
  const pieces = hub.log.filter((m) => m.kind === "chunk" && m.to_device === idOf(B));
  rec("…in encrypted pieces (no JPEG bytes on the hub)", pieces.length >= 3 && !pieces.some((m) => JSON.stringify(m).includes(JPEG.subarray(4, 40).toString("base64"))), `${pieces.length} pieces`);
  rec("the pieces are gone from the hub once picked up", Boolean(await until(() => !hub.db.messages.some((m) => m.kind === "chunk" && m.to_device === idOf(B)), 3000)));
  const camVoice = await skB.handle("show me printer 1's camera", { surface: "tv" });
  rec("\"show me printer 1's camera\" shows the still from the Home TV", /printer 1's camera from Home TV/.test(camVoice?.reply ?? ""), camVoice?.reply);

  // ---- 11. notifications (camera alerts) with a picture ---------------------------------------------------------------
  const pic = randomBytes(90_000);
  const nt = await A.notify("all", { title: "Motion at the front door", body: "Someone's there", image: pic });
  await until(async () => { await B.processInbox(); await C.processInbox(); return did.B.some((x) => x.action === "notify") && did.C.some((x) => x.action === "notify"); });
  const nb = did.B.find((x) => x.action === "notify");
  rec("remote.notify(\"all\") reaches every other device, picture included", nt.sent === 2 && nb?.title === "Motion at the front door" && Buffer.isBuffer(nb.image) && nb.image.equals(pic), JSON.stringify({ ...nt, got: Boolean(nb) }));

  // ---- 12. voice ------------------------------------------------------------------------------------------------------
  const on = await skB.handle("which of my Dayspring devices are online?", { surface: "tv" });
  rec("\"which of my Dayspring devices are online?\"", /Online: .*Home TV/.test(on?.reply ?? "") && /Office PC/.test(on?.reply ?? ""), on?.reply);
  const fan = await skB.handle("On my office PC, turn on fan 2", { surface: "tv" });
  rec("\"on my office PC, turn on fan 2\"", did.C.some((x) => x.command === "turn on fan 2" && x.from === "Laptop"), fan?.reply);
  const tell = await skB.handle("tell the home tv dinner's ready", { surface: "tv" });
  rec("\"tell the home TV dinner's ready\"", did.A.some((x) => x.action === "announce" && /^Dinner's ready$/i.test(x.text)), tell?.reply);
  const pr = await skB.handle("how's printer 3 doing?", { surface: "tv" });
  rec("\"how's printer 3 doing?\" finds the device with printer 3", /printer 3 is 42% done/.test(pr?.reply ?? ""), pr?.reply);
  const skA = createSkills({ engine: () => A, confirm, localHas: (k, t) => ["computer", "fan 1"].includes(t), show: async () => null });
  rec("on the Home TV, \"turn on fan 1\" is left to the local skills", (await skA.handle("turn on fan 1", { surface: "tv" })) === null);
  rec("everyday words aren't taken (\"tell me a joke\", \"turn on the lights\")", (await skB.handle("tell me a joke")) === null && (await skB.handle("turn on the lights")) === null);

  // ---- 13. offline, timeouts, expiry ---------------------------------------------------------------------------------
  C.stop();
  hub.db.devices.find((d) => d.id === idOf(C)).last_seen = new Date(Date.now() - 3 * 3600_000).toISOString();
  await B.sync();
  const sentBefore = hub.log.length;
  const off = await B.send(idOf(C), "status");
  rec("a device that's offline: a clear message, nothing sent", off.offline === true && /offline \(last seen 3 hours ago\)/.test(off.say) && hub.log.length === sentBefore, off.say);
  hub.db.devices.find((d) => d.id === idOf(C)).last_seen = new Date().toISOString();       // looks online but doesn't answer
  await B.sync();
  const t0 = Date.now();
  const to = await B.send(idOf(C), "status", {}, { timeoutMs: 1500 });
  rec("no answer: a clear message after the wait, and exactly one try", to.timeout === true && hub.log.length === sentBefore + 1 && Date.now() - t0 < 4000, to.say);
  const q = await B.send(idOf(C), "announce", { text: "later" }, { queue: true, ttlMs: 5000 });
  rec("a queued message is accepted with a lifetime", q.queued === true);
  const qrow = hub.db.messages.find((m) => m.to_device === idOf(C) && m.kind === "cmd" && Date.parse(m.expires_at) - Date.now() < 10_000);
  qrow.expires_at = new Date(Date.now() - 1000).toISOString();                              // it wasn't picked up in time
  const cGot = did.C.length;
  await C.processInbox(); await sleep(200);
  rec("an expired message is never delivered", did.C.length === cGot);
  C.start();

  // ---- 14. live updates (Realtime) ------------------------------------------------------------------------------------
  const liveA = await until(() => A.status().live === "live");
  const tl = Date.now();
  const rl = await B.send(idOf(A), "status", {}, { timeoutMs: 8000 });
  rec("with live updates a command is answered at once (no waiting for the next look)", Boolean(liveA) && rl.ok && Date.now() - tl < 5000, `${A.status().live}, ${Date.now() - tl} ms`);

  // ---- 15. another account can't see or reach his devices -------------------------------------------------------------
  const other = hub.session("someone-else@example.test", "another password");
  const seenRows = await h.select("dayspring_remote_devices", "select=*", other.access_token);
  rec("another account sees none of his devices (row level security)", Array.isArray(seenRows) && seenRows.length === 0);
  const M = createRemote({ dir: join(TMP, "M"), box, hubConfig: cfg, name: "Other person", handlers: new Map(), live: false });
  globalThis.__M = M;
  await M.signIn({ email: "someone-else@example.test", password: "another password" });
  rec("…and their first device is their own, not his", M.approved() && (await M.devices()).length === 1);
  let mErr = null; try { await h.rpc("dayspring_remote_send", { p_id: "22222222-2222-4222-8222-222222222222", p_from: idOf(M), p_to: idOf(A), p_kind: "cmd", p_envelope: { id: "22222222-2222-4222-8222-222222222222", from: idOf(M), to: idOf(A), kind: "cmd" } }, other.access_token); } catch (e) { mErr = e; }
  rec("…and can't send to his devices", Boolean(mErr));

  // ---- 16. revoking (signing a device out remotely) -------------------------------------------------------------------
  const cIdent = C._identity(), cId = idOf(C), cSess = hub.db.bindings.find((b) => b.device_id === cId)?.session_id;
  await A.revoke(cId);
  rec("A signs the Office PC out remotely", hub.db.devices.find((d) => d.id === cId).status === "revoked");
  rec("…its hub sign-in is ended too", !hub.db.sessions.has(cSess));
  await C.sync().catch(() => {});
  const cGone = await until(() => !existsSync(join(TMP, "C", "device-key.bin")), 3000);
  rec("the Office PC notices, and deletes its own keys", Boolean(cGone) && !C.approved());
  await B.sync();
  const late = E.makeEnvelope({ identity: cIdent, user: xrow.user_id, to: idOf(B), toEncPub: B._identity().enc.pub, kind: "cmd", payload: { action: "announce", args: { text: "from a revoked device" } } });
  inject(late);
  const bGot = did.B.length;
  await B.processInbox(); await sleep(200);
  rec("the other devices refuse the revoked device's commands", did.B.length === bGot);
  rec("the list shows it as signed out", (await B.devices()).find((d) => d.id === cId)?.trust === "revoked");

  // ---- 17. no internet: remote says so quickly, everything local keeps working ----------------------------------------
  hub.down(true);
  const tn = Date.now();
  let netErr = null, nr = null; try { nr = await B.send(idOf(A), "status"); } catch (e) { netErr = e; }
  rec("with no internet, asking another device fails fast with a plain message", (netErr?.kind === "offline" || nr?.offline) && Date.now() - tn < 12_000 && /internet|offline/i.test(netErr?.message ?? nr?.say ?? ""), netErr?.message ?? nr?.say);
  rec("…the local skills still answer local things", (await skA.handle("turn on fan 1")) === null);
  const Local = handlersFor("A", { devices: ["fan 1"] });
  rec("…and this device's own handlers still run", (await Local.get("devices").fn({ command: "turn on fan 1" }, { from: { name: "here" } })).ok === true);
  rec("…and its status still answers (offline, not an error)", typeof B.status().connection === "string");
  hub.down(false);

  // ---- 18. the SQL, the stand-in and the engine agree -------------------------------------------------------------------
  const sql = readFileSync(join(DESK, "docs", "dev", "remote-hub.sql"), "utf8");
  const sqlFns = new Set([...sql.matchAll(/create or replace function public\.(dayspring_remote_\w+)/g)].map((m) => m[1]));
  const used = new Set([...readFileSync(join(DESK, "lib", "remote", "engine.mjs"), "utf8").matchAll(/"(dayspring_remote_\w+)"/g)].map((m) => m[1]).filter((n) => !/_(devices|pairings|messages)$/.test(n)));
  const missing = [...used].filter((n) => !sqlFns.has(n) || !hub.fns.includes(n));
  rec("every hub function the engine calls is in the SQL and the stand-in", missing.length === 0, missing.join(", "));
  rec("the SQL turns on row level security for every table", ["devices", "bindings", "pairings", "messages", "usage"].every((t) => new RegExp(`alter table public\\.dayspring_remote_${t}\\s+enable row level security`).test(sql)));
  rec("the SQL has no policy that lets anyone write a table directly", !/create policy[^;]*for (insert|update|delete|all)\b/i.test(sql));
  rec("the SQL expires messages (5 minutes at most) and purges them", /least\(greatest\(coalesce\(p_ttl_seconds, 60\), 5\), case when p_kind = 'chunk' then 120 else 300 end\)/.test(sql) && /cron\.schedule\('dayspring-remote-purge'/.test(sql));
  rec("the SQL refuses a second copy of a message (its id is the key)", /id           uuid primary key,/.test(sql));
  rec("the SQL never mentions a service-role key", !/service_role/i.test(sql));

  // ---- 19. real DPAPI (this Windows user) ------------------------------------------------------------------------------
  if (process.platform === "win32") {
    const { dpapi } = await imp("vendor/ecosystem-core/lib/credentials.mjs");
    const { createVault } = await imp("lib/remote/keystore.mjs");
    const v = createVault({ dir: join(TMP, "dpapi"), box: dpapi({ entropy: "dayspring-remote-device-v1" }) });
    v.writeJSON("t", { secret: "x".repeat(40) });
    rec("device keys round-trip through Windows DPAPI and aren't stored as they are", v.readJSON("t").secret === "x".repeat(40) && !readFileSync(join(TMP, "dpapi", "t.bin")).includes(Buffer.from("x".repeat(40))));
  }

  // ---- 20. the feature switch and the gate ----------------------------------------------------------------------------
  const gateSrc = readFileSync(join(DESK, "lib", "remote", "index.mjs"), "utf8");
  const staticImports = [...gateSrc.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
  rec("the gate loads no crypto or network code until signed in", staticImports.every((x) => x.startsWith("node:") || x === "./skills.mjs"), staticImports.join(", "));
  const gate = await imp("lib/remote/index.mjs");
  rec("not signed in: no AI tools, no voice commands, notify sends nothing", gate.tools().length === 0 && (await gate.handle("turn on fan 2")) === null && (await gate.notify("all", { title: "x" })).sent === 0);
  rec("not signed in: nothing was made (no key, no state)", !existsSync(join(process.env.DAYSPRING_REMOTE_DIR, "device-key.bin")) && !existsSync(join(process.env.DAYSPRING_REMOTE_DIR, "state.json")));
  const routes = await imp("lib/remote/routes.mjs");
  let sent = null; const fakeSend = (res, status, body) => { sent = { status, body }; };
  await routes.handle({}, {}, { m: "GET", p: "/remote/status", q: new URLSearchParams(), send: fakeSend, readJSON: async () => ({}) });
  rec("Settings → Devices & sign-in answers (not signed in)", sent?.status === 200 && sent.body.signedIn === false && sent.body.perms.length === 6, JSON.stringify(sent));

  // ---- 21. the real handlers use lib/printers (status, camera still, start with its own yes) ---------------------------
  {
    const P = await imp("lib/printers/index.mjs");
    rec("lib/printers has what the remote handlers call (status, snapshot, start, names, resolve, connection)", ["status", "snapshot", "start", "names", "resolve", "connection"].every((k) => typeof P[k] === "function"));
    const H = await imp("lib/remote/handlers.mjs");
    const calls = [];
    // a stand-in with lib/printers' own shapes: start answers with its question until the owner's yes is carried over
    H._useModule("printers", {
      list: () => [{ id: "p1", name: "Printer 1" }], resolve: (w) => (/1|p1s/i.test(w) ? { id: "p1", name: "Printer 1" } : null),
      connection: async (id) => { calls.push(["connect", id]); return {}; }, names: () => ["Printer 1", "printer 1"],
      status: (w) => (w && !/1/.test(w) ? null : { id: "p1", name: "Printer 1", state: "printing", say: "Printer 1 is printing, 42% done." }),
      snapshot: async (w) => { if (!/1/.test(String(w))) throw new Error("Which printer?"); return JPEG; },
      start: async (w, job, o) => { calls.push(["start", w, job, o.confirmed]); return o.confirmed ? { ok: true, started: true, text: "Starting benchy on Printer 1." } : { ok: false, needsConfirm: true, text: "The bed on Printer 1 looks clear. Start benchy? Say yes to start." }; },
    });
    const b = H.builtins({});
    const ctx = { from: { deviceId: "dev-laptop", name: "Laptop" }, confirmed: false };
    const st = await b.get("printers.status").fn({ printer: "printer 1" }, ctx);
    rec("remote printer status: connects, then says the status", st.ok && /42% done/.test(st.say) && calls.some((c) => c[0] === "connect" && c[1] === "p1"), JSON.stringify(st));
    const st2 = await b.get("printers.status").fn({ printer: "printer 9" }, ctx);
    rec("remote printer status: an unknown printer is an error, not silence", st2.ok === false && /printer 9/.test(st2.error), JSON.stringify(st2));
    const cam = await b.get("printers.camera").fn({ printer: "printer 1" }, ctx);
    const cam2 = await b.get("printers.camera").fn({ printer: "nope" }, ctx);
    rec("remote printer camera: the still comes back whole; a failure is an error", cam.ok && cam.bytes.equals(JPEG) && cam2.ok === false && /Which printer/.test(cam2.error));
    rec("remote printer start is risky (the sender asks first)", b.get("printers.start").risky() === true);
    const s1 = await b.get("printers.start").fn({ printer: "printer 1", job: "benchy" }, ctx);
    rec("remote printer start without the yes: the question comes back, nothing starts", s1.ok === false && s1.needsConfirm === true && /Say yes/.test(s1.say) && !s1.started, JSON.stringify(s1));
    const s2 = await b.get("printers.start").fn({ printer: "printer 1", job: "benchy" }, { ...ctx, confirmed: true });
    rec("remote printer start with the yes from the sender: it starts", s2.ok && s2.started && calls.at(-1)[3] === true, JSON.stringify(s2));
    H._forgetModules();
  }

  // ---- 22. camera alerts reach his other devices (lib/cameras onAlert → remote.notify) ------------------------------------
  {
    let sink = null;
    const fakeCams = { onAlert: (fn) => { sink = fn; return () => { sink = null; }; }, lastFrame: () => ({ jpeg: JPEG }) };
    gate._unhookCameras();
    const hooked = await gate.hookCameras(fakeCams);
    rec("camera alerts are hooked to the other devices once", hooked === true && typeof sink === "function" && (await gate.hookCameras(fakeCams)) === false);
    let threw = false; try { await sink({ cam: "c1", name: "Front door", text: "A person at the front door." }); } catch { threw = true; }
    rec("a camera alert while not signed in sends nothing and doesn't fail the alert", !threw);
    const camSrc = readFileSync(join(DESK, "lib", "cameras", "alerts.mjs"), "utf8");
    rec("lib/cameras hands every alert to its onAlert sinks (the devices channel)", /for \(const fn of deps\.sinks\(\)\)/.test(camSrc) && /alerts\.setDeps\(\{ sinks: \(\) => \[\.\.\.alertSinks\] \}\)/.test(readFileSync(join(DESK, "lib", "cameras", "index.mjs"), "utf8")));
    rec("remote.start hooks the camera alerts", /hookCameras\(\)\.catch/.test(gateSrc));
  }
} catch (e) {
  rec("the run finished without a crash", false, e?.stack ?? e);
} finally {
  for (const e of [A, B, C, globalThis.__X, globalThis.__M]) { try { e?.stop(); } catch { /* stopped */ } }
  await hub.close();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* in use */ }
}
void createHash; void LIMITS;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
