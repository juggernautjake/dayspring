// Remote control between the owner's own Dayspring devices: one engine per device. Signing in (the Lantern account on
// the hub), registering this device, pairing with approval on another device, who is trusted, what each device may
// do, and the signed, end-to-end encrypted commands and answers (camera stills and clips as encrypted pieces).
//
// The hub (Supabase) is a mailbox, not a judge: every decision is made here, on the receiving device, from signed
// statements it checked itself (envelope.mjs). A stolen password, a hub row someone changed, or a replayed message
// gets nowhere. docs/dev/remote-protocol.md is the protocol; docs/dev/remote-security.md the threat model.
//
//   createRemote({ dir, box, hubConfig, handlers, fetch, WebSocket, now, log, onEvent, name, platform, version, client })
//     sign-in     signIn({ email, password }) · sendLink(email, redirectTo) · completeLink({ refresh_token }) · signOutHere()
//     this        status() · setName(name) · setAccept(on) · start() · stop()
//     pairing     pairingView() · confirmPairing(match)                     (the NEW device)
//                 requests() · review(id) · approve(id, perms) · reject(id)  (a device that's already approved)
//     devices     devices() · findDevice(text) · rename(id, name) · setPerms(id, perms) · revoke(id) · forget(id)
//     messages    send(to, action, args, { confirmed, queue, blob, timeoutMs }) · notify(to | "all", { title, body, image })
//     internals   sync() · processInbox() · publishProfile() · _state()
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createVault } from "./keystore.mjs";
import { createHub, HubError } from "./hub.mjs";
import * as E from "./envelope.mjs";
import { PROTO, PERMS, DEFAULT_PERMS, LIMITS, permFor, isRisky, riskText, cleanPerms, PERM_WORDS } from "./policy.mjs";

const T_APPROVE = PROTO + "/approve", T_ROOT = PROTO + "/root", T_GRANT = PROTO + "/grant", T_REVOKE = PROTO + "/revoke", T_OFFER = PROTO + "/offer", T_BUNDLE = PROTO + "/bundle", T_PROFILE = PROTO + "/profile";
const blank = () => ({ v: 1, userId: null, email: null, hubUrl: null, deviceId: null, name: null, status: "none", trust: { devices: {}, revoked: {}, grants: {} }, pairing: null, accept: true, profileHash: null });
const cleanEmail = (e) => { e = String(e ?? "").trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HubError("That doesn't look like an email address.", "hub"); return e; };
const cleanName = (n) => String(n ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
const ago = (ms) => { const m = Math.round(ms / 60_000); return m < 2 ? "a minute ago" : m < 60 ? `${m} minutes ago` : m < 120 ? "an hour ago" : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
const norm = (t) => String(t ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function createRemote(opt) {
  const o = { client: "desk", platform: process.platform === "win32" ? "Windows" : process.platform, version: "0", name: "This computer", now: () => Date.now(),
    log: () => {}, onEvent: () => {}, handlers: new Map(), fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, live: true, ...opt };
  mkdirSync(o.dir, { recursive: true });
  const vault = createVault({ dir: o.dir, box: o.box });
  const STATE = join(o.dir, "state.json"), SEEN = join(o.dir, "seen.json");
  const readJ = (f, d) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d; } catch { return d; } };
  const writeJ = (f, v) => { const t = f + ".tmp"; writeFileSync(t, JSON.stringify(v, null, 1)); renameSync(t, f); };
  let st = { ...blank(), ...readJ(STATE, {}) };
  st.trust = { devices: {}, revoked: {}, grants: {}, ...(st.trust ?? {}) };
  const save = () => writeJ(STATE, st);
  const log = (kind, data) => { try { o.log(kind, data); } catch { /* the log never stops the work */ } };
  const emit = (type, data) => { try { o.onEvent(type, data); } catch { /* ignore */ } };

  // ---- the hub, the session and the keys -------------------------------------------------------------------------------
  let hubApi = null, hubSig = "";
  function hub() {
    const cfg = o.hubConfig?.();
    if (!cfg?.url || !cfg?.anonKey) throw new HubError("Dayspring doesn't know your account's hub yet. If you use Lantern, add the hub in Settings → Lantern first.", "hub");
    const sig = cfg.url + "|" + cfg.anonKey;
    if (!hubApi || sig !== hubSig) { hubApi = createHub({ url: cfg.url, anonKey: cfg.anonKey, fetch: o.fetch, WebSocket: o.WebSocket }); hubSig = sig; }
    return hubApi;
  }
  const hubNow = () => o.now() + (hubApi?.clockOffset() ?? 0);
  let sess = null, identity = null, refreshing = null;
  const loadSession = () => { if (sess === null) { try { sess = vault.readJSON("session") ?? false; } catch { sess = false; } } return sess || null; };
  const saveSession = (s) => { sess = s || false; if (s) vault.writeJSON("session", s); else vault.remove("session"); };
  const me = () => { if (!identity) { try { identity = vault.readJSON("device-key"); } catch { identity = null; } } return identity; };
  async function token() {
    const s = loadSession();
    if (!s) throw new HubError("This device isn't signed in.", "auth");
    if (s.expires_at - 60_000 > o.now()) return s.access_token;
    refreshing ??= hub().refresh(s.refresh_token).then((n) => { saveSession({ ...n, user: n.user ?? s.user }); return n.access_token; }).finally(() => { refreshing = null; });
    try { return await refreshing; }
    catch (e) { if (e.kind === "auth") { saveSession(null); conn = "signed-out"; emit("signed-out", { reason: "session" }); } throw e; }
  }
  let conn = "idle", lastError = null, failures = 0;
  const net = (e) => { if (e?.kind === "offline") { conn = "offline"; lastError = e.message; } return e; };
  async function rpc(name, args) { try { const r = await hub().rpc(name, args, await token()); conn = "online"; return r; } catch (e) { throw net(e); } }
  async function select(table, q) { try { const r = await hub().select(table, q, await token()); conn = "online"; return r; } catch (e) { throw net(e); } }

  // ---- trust -----------------------------------------------------------------------------------------------------------
  const myId = () => st.deviceId;
  const trusted = (id) => { const d = st.trust.devices[id]; return d && !st.trust.revoked[id] ? d : null; };
  const permsOf = (id) => st.trust.grants[id]?.perms ?? [];
  const nameOf = (id) => rowsCache.find((r) => r.id === id)?.name ?? st.trust.devices[id]?.name ?? (id === myId() ? st.name : "a device");
  const approved = () => st.status === "approved" && Boolean(me()) && Boolean(trusted(myId()));
  const requireApproved = () => { if (!approved()) throw new HubError(st.status === "pending" ? "This device is still waiting to be approved on one of your other devices." : "Sign in on this device first (Settings → Devices & sign-in).", "auth"); };
  let rowsCache = [], rowsAt = 0;

  function acceptGrant(g, id) {
    if (!g || g.t !== T_GRANT || g.user !== st.userId || g.device !== id) return false;
    const signer = trusted(g.by);
    if (!signer || !E.verify(g, signer.signPub)) return false;
    const cur = st.trust.grants[id];
    // a device can't widen its own permissions; the first device's own starting grant is the one exception
    if (g.by === id && (st.trust.devices[id]?.cert?.t !== T_ROOT || (cur && cur.by !== id))) return false;
    if (cur && cur.at >= g.at) return false;
    st.trust.grants[id] = { ...g, perms: cleanPerms(g.perms) };
    return true;
  }
  function acceptRevocation(v, id) {
    if (!v || v.t !== T_REVOKE || v.user !== st.userId || v.device !== id || st.trust.revoked[id]) return false;
    const signer = v.by === id ? st.trust.devices[id] : trusted(v.by);          // signed out by another device, or by itself
    if (!signer || !E.verify(v, signer.signPub)) return false;
    st.trust.revoked[id] = { at: v.at, by: v.by, rev: v };
    return true;
  }
  // new devices vouched for by devices already trusted (to a fixed point), signed sign-outs, signed permission changes
  function applyTrust(rows) {
    if (!approved()) return false;
    let changed = false, more = true;
    while (more) {
      more = false;
      for (const r of rows) {
        if (st.trust.devices[r.id] || !r.cert) continue;
        const c = r.cert, signer = trusted(c.by);
        if (!signer || c.by === r.id || c.t !== T_APPROVE || c.user !== st.userId || c.device !== r.id || c.signPub !== r.sign_pub || c.encPub !== r.enc_pub || !E.verify(c, signer.signPub)) continue;
        st.trust.devices[r.id] = { signPub: r.sign_pub, encPub: r.enc_pub, name: r.name, approvedBy: c.by, at: c.at, cert: c };
        log("remote.trust", { device: r.name, deviceId: r.id, approvedBy: nameOf(c.by), text: `${r.name} is now one of your trusted devices (approved on ${nameOf(c.by)}).` });
        more = changed = true;
      }
    }
    for (const r of rows) {
      if (r.revocation && acceptRevocation(r.revocation, r.id)) { changed = true; log("remote.revoked", { device: r.name, deviceId: r.id, by: nameOf(r.revocation.by), text: `${r.name} was signed out (by ${nameOf(r.revocation.by)}). Its commands are refused from now on.` }); }
      if (r.perm_grant && acceptGrant(r.perm_grant, r.id)) changed = true;
      const t = st.trust.devices[r.id]; if (t && r.name && t.name !== r.name) { t.name = r.name; changed = true; }
    }
    if (changed) save();
    return changed;
  }

  // ---- signing in and registering --------------------------------------------------------------------------------------
  async function afterSignIn(s) {
    if (!s?.user?.id) throw new HubError("Signing in didn't work. Try again.", "auth");
    if (st.userId && st.userId !== s.user.id) wipeLocal("a different account signed in");
    saveSession(s);
    st.userId = s.user.id; st.email = s.user.email ?? null; st.hubUrl = hub().url; st.name ||= cleanName(o.name) || "This computer"; save();
    log("remote.signin", { email: st.email, text: `Signed in to your account on this device (${st.name}).` });
    await ensureDevice();
    start();
    return status();
  }
  async function ensureDevice() {
    let id = me();
    if (!id) { id = E.newIdentity(); vault.writeJSON("device-key", id); identity = id; log("remote.device", { text: "Made this device's own keys (stored encrypted for this Windows user)." }); }
    const p = E.publicOf(id);
    st.deviceId = p.deviceId;
    const rootCert = E.makeCert(id, { user: st.userId, device: p.deviceId, signPub: p.signPub, encPub: p.encPub, name: st.name, type: "root", at: hubNow() });
    const r = await rpc("dayspring_remote_register", { p_id: p.deviceId, p_name: st.name, p_platform: o.platform, p_version: o.version, p_client: o.client, p_sign_pub: p.signPub, p_enc_pub: p.encPub, p_root_cert: rootCert });
    if (r?.status === "revoked") { wipeLocal("revoked"); throw new HubError("This device was signed out from another device. Sign in again to add it back (it will need approval).", "denied"); }
    if (r?.status === "approved" && trusted(p.deviceId) && st.status === "approved") {
      save();                                             // coming back as itself: nothing changes
    } else if (r?.status === "approved" && r.first) {
      st.trust.devices[p.deviceId] = { signPub: p.signPub, encPub: p.encPub, name: st.name, approvedBy: p.deviceId, at: rootCert.at, cert: rootCert };
      st.trust.grants[p.deviceId] = E.makeGrant(id, { user: st.userId, device: p.deviceId, perms: PERMS, at: hubNow() });
      st.status = "approved"; save();
      await rpc("dayspring_remote_set_grant", { p_device: p.deviceId, p_grant: st.trust.grants[p.deviceId] }).catch(() => {});
      log("remote.device", { text: `${st.name} is your first Dayspring device on this account, so it's approved. Add more from their Settings → Devices & sign-in.` });
    } else if (r?.status === "approved" && trusted(p.deviceId)) {
      st.status = "approved"; save();
    } else {
      st.status = "pending"; save();
      await openPairing();
    }
    await sync().catch(() => {});
    if (approved()) await publishProfile(true).catch(() => {});
  }
  async function signIn({ email, password, name = null } = {}) {
    email = cleanEmail(email);
    if (cleanName(name)) { st.name = cleanName(name); save(); }
    if (!password) throw new HubError("Type your password, or use \"Email me a sign-in link\".", "auth");
    return afterSignIn(await hub().signIn(email, String(password)));
  }
  async function sendLink(email, redirectTo, name = null) { email = cleanEmail(email); if (cleanName(name)) st.name = cleanName(name); await hub().sendLink(email, redirectTo); st.linkEmail = email; save(); return { sent: true, email }; }
  async function completeLink({ refresh_token } = {}) {
    if (!refresh_token) throw new HubError("That sign-in link was incomplete. Ask for a new one.", "auth");
    return afterSignIn(await hub().refresh(String(refresh_token)));
  }

  // ---- pairing: the new device ----------------------------------------------------------------------------------------
  async function openPairing() {
    const r = await rpc("dayspring_remote_pair_open", { p_device: myId() });
    st.pairing = { id: r.id, at: hubNow(), confirmed: null }; save();
    log("remote.pairing", { text: `${st.name} asked to join your devices. Approve it on one of your other Dayspring devices.` });
    return r;
  }
  async function pairingRow() {
    if (!st.pairing?.id) return null;
    const rows = await select("dayspring_remote_pairings", `id=eq.${encodeURIComponent(st.pairing.id)}&select=*`);
    return rows?.[0] ?? null;
  }
  function offerOf(p) {
    const f = p?.offer;
    if (!f || f.t !== T_OFFER || f.pairing !== p.id || f.user !== st.userId || f.approver !== p.approver_id || f.sig?.deviceId !== f.approver || !E.verify(f, f.signPub)) return null;
    return f;
  }
  async function pairingView() {
    if (st.status === "approved") return { state: "approved" };
    if (st.status !== "pending") return { state: st.status };
    let p = await pairingRow();
    if (!p || ["cancelled", "rejected"].includes(p.status) || Date.parse(p.expires_at) < hubNow()) {
      const was = p?.status;
      await openPairing(); p = await pairingRow();
      if (was === "rejected") return { state: "waiting", rejected: true, expiresAt: p?.expires_at };
    }
    if (!p || p.status === "open") return { state: "waiting", expiresAt: p?.expires_at ?? null };
    const f = offerOf(p);
    if (!f) return { state: "waiting", warning: "An answer to this request didn't check out, so it was ignored." };
    const mine = E.publicOf(me());
    const code = E.sas({ pairing: p.id, offerSignPub: f.signPub, offerEncPub: f.encPub, deviceSignPub: mine.signPub, deviceEncPub: mine.encPub });
    const approverName = rowsCache.find((r) => r.id === f.approver)?.name ?? (await select("dayspring_remote_devices", `id=eq.${encodeURIComponent(f.approver)}&select=name`).catch(() => []))?.[0]?.name ?? "your other device";
    const confirmed = st.pairing.confirmed === f.sig.value;
    if (p.status === "approved" && confirmed) { await finishPairing(p, f); return { state: "approved", approverName }; }
    return { state: "offered", code, approverName, confirmed, approvedThere: p.status === "approved", expiresAt: p.expires_at };
  }
  async function confirmPairing(match) {
    const p = await pairingRow();
    const f = offerOf(p);
    if (!p || !f) throw new HubError("There's no code to compare yet. On your other device, open Settings → Devices & sign-in and choose Review.", "hub");
    if (!match) {
      await rpc("dayspring_remote_pair_cancel", { p_pairing: p.id }).catch(() => {});
      log("blocked", { reason: "pairing-code-mismatch", text: "The pairing codes didn't match, so the request was cancelled. A new one was started." });
      st.pairing = null; save();
      await openPairing();
      return { state: "waiting", cancelled: true };
    }
    st.pairing.confirmed = f.sig.value; save();
    return pairingView();
  }
  async function finishPairing(p, f) {
    const a = p.approval;
    if (!a || a.t !== T_BUNDLE || a.pairing !== p.id || a.device !== myId() || a.user !== st.userId || a.by !== f.approver || !E.verify(a, f.signPub)) throw new HubError("The approval didn't check out, so this device ignored it. Start again.", "denied");
    const b = E.openSealedJSON(a.sealed, me(), st.userId, "bundle|" + p.id + "|" + myId());
    const mine = E.publicOf(me());
    const c = b.cert;
    if (!c || c.t !== T_APPROVE || c.device !== myId() || c.by !== f.approver || c.signPub !== mine.signPub || c.encPub !== mine.encPub || !E.verify(c, f.signPub)) throw new HubError("The approval was for different keys, so this device ignored it.", "denied");
    const devs = {}, revoked = {}, grants = {};
    for (const [id, d] of Object.entries(b.trust?.devices ?? {})) if (d?.signPub && d?.encPub) devs[id] = { signPub: d.signPub, encPub: d.encPub, name: cleanName(d.name), approvedBy: d.approvedBy ?? null, at: d.at ?? null, cert: d.cert ?? null };
    if (!devs[f.approver] || devs[f.approver].signPub !== f.signPub || devs[f.approver].encPub !== f.encPub) throw new HubError("The approving device's keys don't match its own list, so this device ignored it.", "denied");
    for (const [id, v] of Object.entries(b.trust?.revoked ?? {})) revoked[id] = v;
    for (const [id, g] of Object.entries(b.trust?.grants ?? {})) grants[id] = g;
    devs[myId()] = { signPub: mine.signPub, encPub: mine.encPub, name: st.name, approvedBy: f.approver, at: c.at, cert: c };
    if (b.grant?.device === myId()) grants[myId()] = b.grant;
    st.trust = { devices: devs, revoked, grants };
    st.status = "approved"; st.pairing = null; save();
    log("remote.pairing", { text: `${st.name} was approved on ${devs[f.approver].name}. It's now one of your trusted devices.` });
    emit("approved", { by: devs[f.approver].name });
    await sync().catch(() => {});
    await publishProfile(true).catch(() => {});
  }

  // ---- pairing: a device that's already approved -------------------------------------------------------------------------
  const reviewing = new Map();
  async function requests() {
    if (!approved()) return [];
    const rows = await select("dayspring_remote_pairings", "status=in.(open,offered)&select=*&order=created_at.desc");
    await sync().catch(() => {});
    return (rows ?? []).filter((p) => p.device_id !== myId() && Date.parse(p.expires_at) > hubNow()).map((p) => {
      const d = rowsCache.find((r) => r.id === p.device_id) ?? {};
      return { id: p.id, device: { id: p.device_id, name: d.name ?? "A new device", platform: d.platform ?? "", version: d.app_version ?? "", client: d.client ?? "desk" },
        status: p.status, mine: p.approver_id === myId(), other: p.status === "offered" && p.approver_id !== myId(), code: reviewing.get(p.id)?.code ?? null, expiresAt: p.expires_at };
    });
  }
  async function review(pairingId) {
    requireApproved();
    const p = (await select("dayspring_remote_pairings", `id=eq.${encodeURIComponent(pairingId)}&select=*`))?.[0];
    if (!p || Date.parse(p.expires_at) < hubNow() || !["open", "offered"].includes(p.status)) throw new HubError("That request has expired. Start again on the new device.", "hub");
    if (p.status === "offered" && p.approver_id !== myId()) throw new HubError("Another device already answered this request. To be safe, cancel it and start again on the new device.", "denied");
    const d = (await select("dayspring_remote_devices", `id=eq.${encodeURIComponent(p.device_id)}&select=*`))?.[0];
    if (!d) throw new HubError("That device isn't there any more.", "hub");
    if (p.status === "open") await rpc("dayspring_remote_pair_offer", { p_pairing: p.id, p_device: myId(), p_offer: E.makeOffer(me(), { user: st.userId, pairing: p.id, at: hubNow() }) });
    const mine = E.publicOf(me());
    const code = E.sas({ pairing: p.id, offerSignPub: mine.signPub, offerEncPub: mine.encPub, deviceSignPub: d.sign_pub, deviceEncPub: d.enc_pub });
    reviewing.set(p.id, { device: { id: d.id, signPub: d.sign_pub, encPub: d.enc_pub, name: d.name }, code, at: hubNow() });
    return { code, device: { id: d.id, name: d.name, platform: d.platform, version: d.app_version, client: d.client } };
  }
  async function approve(pairingId, perms = DEFAULT_PERMS) {
    requireApproved();
    const rv = reviewing.get(pairingId);
    if (!rv) throw new HubError("Choose Review first and compare the code on both screens.", "hub");
    const at = hubNow(), dev = rv.device;
    const cert = E.makeCert(me(), { user: st.userId, device: dev.id, signPub: dev.signPub, encPub: dev.encPub, name: dev.name, type: "approve", at });
    const grant = E.makeGrant(me(), { user: st.userId, device: dev.id, perms: cleanPerms(perms), at });
    st.trust.devices[dev.id] = { signPub: dev.signPub, encPub: dev.encPub, name: dev.name, approvedBy: myId(), at, cert };
    st.trust.grants[dev.id] = grant; save();
    const bundle = { cert, grant, trust: { devices: st.trust.devices, revoked: st.trust.revoked, grants: st.trust.grants } };
    const approval = E.sign({ t: T_BUNDLE, user: st.userId, pairing: pairingId, device: dev.id, by: myId(), at, sealed: E.sealTo(bundle, [{ userId: st.userId, deviceId: dev.id, encPub: dev.encPub }], "bundle|" + pairingId + "|" + dev.id) }, me());
    await rpc("dayspring_remote_pair_approve", { p_pairing: pairingId, p_device: myId(), p_cert: cert, p_grant: grant, p_approval: approval });
    reviewing.delete(pairingId);
    log("remote.pairing", { device: dev.name, deviceId: dev.id, perms: grant.perms, text: `You approved ${dev.name} on this device. It may: ${grant.perms.join(", ") || "nothing yet"}.` });
    await publishProfile(true).catch(() => {});
    return { approved: true, device: dev.name, perms: grant.perms };
  }
  async function reject(pairingId) {
    await rpc("dayspring_remote_pair_reject", { p_pairing: pairingId });
    reviewing.delete(pairingId);
    log("remote.pairing", { text: "You turned down a request to join your devices." });
    return { rejected: true };
  }

  // ---- the device list ---------------------------------------------------------------------------------------------------
  async function sync() {
    if (!loadSession() || !myId()) return rowsCache;
    const rows = await select("dayspring_remote_devices", "select=*&order=created_at.asc");
    rowsCache = Array.isArray(rows) ? rows : []; rowsAt = o.now();
    const mine = rowsCache.find((r) => r.id === myId());
    if (mine?.status === "revoked" && mine.revocation) {
      const v = mine.revocation, signer = v.by === myId() ? E.publicOf(me() ?? { deviceId: "", sign: {}, enc: {} }) : trusted(v.by);
      if (signer && E.verify(v, signer.signPub) && v.device === myId()) { const by = nameOf(v.by); wipeLocal("revoked"); emit("signed-out", { reason: "revoked", by }); log("remote.revoked", { text: `This device was signed out remotely (from ${by}). Its keys were deleted.` }); return rowsCache; }
      lastError = "The hub says this device is signed out, but none of your devices signed that. Ignoring it.";
    }
    if (applyTrust(rowsCache)) publishProfile().catch(() => {});   // a new device: it can read what this one controls
    return rowsCache;
  }
  const isOnline = (r) => Boolean(r?.last_seen) && hubNow() - Date.parse(r.last_seen) < LIMITS.ONLINE_MS;
  const keysMatch = (t, r) => t.signPub === r.sign_pub && t.encPub === r.enc_pub;
  function readProfile(r) {
    const p = r?.profile, d = trusted(r?.id);
    if (!p || !d || p.t !== T_PROFILE || p.device !== r.id || p.user !== st.userId || !E.verify(p, d.signPub)) return null;
    try { return E.openSealedJSON(p.sealed, me(), st.userId, "profile|" + r.id); } catch { return null; }
  }
  function view(r) {
    const t = st.trust.devices[r.id];
    const trust = r.id === myId() ? (approved() ? "this" : st.status) : st.trust.revoked[r.id] ? "revoked" : t ? (keysMatch(t, r) ? "approved" : "keys-changed") : r.status === "pending" ? "pending" : r.status === "revoked" ? "revoked" : "unverified";
    const prof = trust === "approved" || trust === "this" ? readProfile(r) : null;
    return { id: r.id, name: r.name, platform: r.platform, version: r.app_version, client: r.client, lastSeen: r.last_seen, online: r.id === myId() ? conn !== "offline" : isOnline(r),
      trust, approvedBy: t?.approvedBy && t.approvedBy !== r.id ? nameOf(t.approvedBy) : null, perms: permsOf(r.id), names: prof?.names ?? {}, kinds: prof?.kinds ?? [] };
  }
  async function devices() { await sync(); return rowsCache.map(view); }
  const cached = () => rowsCache.map(view);
  // "office pc", "the laptop", "living room TV" → the device (by id, exact name, or the best word match)
  function findDevice(text, { list = cached() } = {}) {
    const q = norm(text).replace(/^(my|the|our) /, "").replace(/\b(dayspring|computer|device)\b$/, (m) => m).trim();
    if (!q) return null;
    const byId = list.find((d) => d.id === text); if (byId) return byId;
    const scored = list.filter((d) => d.trust !== "revoked").map((d) => {
      const n = norm(d.name);
      if (n === q) return [d, 1];
      const qw = q.split(" "), nw = n.split(" ");
      const hit = qw.filter((w) => nw.includes(w) || nw.some((x) => x.startsWith(w) && w.length >= 3)).length;
      return [d, hit / Math.max(qw.length, nw.length)];
    }).filter(([, s]) => s >= 0.5).sort((a, b) => b[1] - a[1]);
    if (!scored.length || (scored[1] && scored[1][1] === scored[0][1])) return null;
    return scored[0][0];
  }
  async function rename(id, name) {
    name = cleanName(name); if (!name) throw new HubError("Give it a name.", "hub");
    if (id === myId() || !id) { st.name = name; save(); if (!loadSession() || !myId()) return { name }; id = myId(); }
    await rpc("dayspring_remote_rename", { p_device: id, p_name: name });
    if (st.trust.devices[id]) { st.trust.devices[id].name = name; save(); }
    await sync().catch(() => {});
    return { name };
  }
  async function setPerms(id, perms) {
    requireApproved();
    if (id === myId()) throw new HubError("A device can't change its own permissions. Change them from another device.", "denied");
    if (!trusted(id)) throw new HubError("That isn't one of your approved devices.", "hub");
    const g = E.makeGrant(me(), { user: st.userId, device: id, perms: cleanPerms(perms), at: hubNow() });
    await rpc("dayspring_remote_set_grant", { p_device: id, p_grant: g });
    st.trust.grants[id] = g; save();
    log("remote.perms", { device: nameOf(id), deviceId: id, perms: g.perms, text: `${nameOf(id)} may now: ${g.perms.map((p) => PERM_WORDS[p]).join("; ") || "nothing"}.` });
    return { perms: g.perms };
  }
  async function revoke(id) {
    if (id === myId()) return signOutHere();
    requireApproved();
    const v = E.makeRevocation(me(), { user: st.userId, device: id, at: hubNow(), reason: "signed out remotely" });
    await rpc("dayspring_remote_revoke", { p_device: id, p_revocation: v });
    st.trust.revoked[id] = { at: v.at, by: myId(), rev: v }; save();
    log("remote.revoked", { device: nameOf(id), deviceId: id, text: `You signed out ${nameOf(id)} remotely. Its sign-in and its keys stop working, and your other devices refuse it from now on.` });
    await publishProfile(true).catch(() => {});
    return { revoked: true, name: nameOf(id) };
  }
  async function forget(id) {
    const d = rowsCache.find((r) => r.id === id);
    if (!d || (d.status !== "revoked" && !st.trust.revoked[id])) throw new HubError("Only a signed-out device can be removed from the list.", "hub");
    await rpc("dayspring_remote_forget", { p_device: id });
    await sync().catch(() => {});
    return { forgotten: true };
  }
  async function signOutHere() {
    try {
      if (loadSession() && myId() && me()) {
        const v = E.makeRevocation(me(), { user: st.userId, device: myId(), at: hubNow(), reason: "signed out on the device" });
        await rpc("dayspring_remote_revoke", { p_device: myId(), p_revocation: v }).catch(() => {});
        await hub().signOut(await token().catch(() => null)).catch(() => {});
      }
    } finally {
      log("remote.signout", { text: `Signed out on this device (${st.name}). Its keys were deleted.` });
      wipeLocal("signed out");
    }
    return status();
  }
  function wipeLocal(reason) {
    stop();
    try { vault.remove("device-key"); } catch { /* gone */ }
    try { vault.remove("session"); } catch { /* gone */ }
    identity = null; sess = false; reviewing.clear(); rowsCache = [];
    const keep = { name: st.name, accept: st.accept };
    st = { ...blank(), ...keep }; save();
    conn = "idle";
    for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ ok: false, say: "This device was signed out." }); }
    pending.clear();
    return reason;
  }

  // ---- what this device can control (names), sealed to every approved device ----------------------------------------------
  async function namesNow() {
    const out = {};
    for (const [kind, h] of o.handlers) if (typeof h.names === "function") { try { const n = await h.names(); if (Array.isArray(n) && n.length) out[kind] = n.map((x) => String(x).slice(0, 60)).slice(0, 100); } catch { /* skip */ } }
    return out;
  }
  async function publishProfile(force = false) {
    if (!approved()) return false;
    const recips = Object.entries(st.trust.devices).filter(([id]) => !st.trust.revoked[id]).map(([id, d]) => ({ userId: st.userId, deviceId: id, encPub: d.encPub }));
    const body = { names: await namesNow(), kinds: [...o.handlers.keys()].sort(), name: st.name };
    const hash = E.sha256(E.canonical({ r: recips.map((r) => r.deviceId).sort(), ...body }));
    if (!force && hash === st.profileHash) return false;
    const prof = E.sign({ t: T_PROFILE, user: st.userId, device: myId(), at: hubNow(), sealed: E.sealTo({ ...body, at: hubNow() }, recips, "profile|" + myId()) }, me());
    await rpc("dayspring_remote_set_profile", { p_device: myId(), p_profile: prof });
    st.profileHash = hash; save();
    return true;
  }
  // which approved devices can control something called "<thing>" ("fan 2", "printer 3", "computer")
  function whoHandles(kind, thing) {
    const q = norm(thing).replace(/^(my|the) /, "");
    const out = [];
    for (const d of cached()) {
      if (d.trust !== "approved") continue;
      const names = [...(d.names?.[kind] ?? [])];
      const hit = names.find((n) => norm(n) === q) ?? names.find((n) => { const a = norm(n).split(" "), b = q.split(" "); return b.every((w) => a.includes(w)) || a.every((w) => b.includes(w)); });
      if (hit) out.push({ device: d, name: hit });
    }
    return out;
  }

  // ---- messages ----------------------------------------------------------------------------------------------------------
  const pending = new Map();                          // command id → { resolve, timer, to, action }
  const blobs = new Map();                            // "<from>|<id>" → { parts: Map(seq → Buffer), at, want, done }
  const seen = new Map(Object.entries(readJ(SEEN, {})));
  const saveSeen = () => { const t = hubNow(); for (const [k, exp] of seen) if (exp < t - LIMITS.MAX_AGE_MS) seen.delete(k); try { writeJ(SEEN, Object.fromEntries(seen)); } catch { /* next time */ } };
  const perSender = new Map();

  async function post(env, ttlMs) {
    await rpc("dayspring_remote_send", { p_id: env.id, p_from: env.from, p_to: env.to, p_kind: env.kind, p_reply_to: env.replyTo, p_seq: env.seq, p_ttl_seconds: Math.ceil(ttlMs / 1000), p_envelope: env });
  }
  async function sendChunks(to, id, bytes) {
    const d = trusted(to);
    const n = Math.ceil(bytes.length / LIMITS.CHUNK_BYTES) || 1;
    for (let i = 0; i < n; i++) {
      const env = E.makeEnvelope({ identity: me(), user: st.userId, to, toEncPub: d.encPub, kind: "chunk", payload: bytes.subarray(i * LIMITS.CHUNK_BYTES, (i + 1) * LIMITS.CHUNK_BYTES), replyTo: id, seq: i, ttlMs: LIMITS.CHUNK_TTL_MS, now: hubNow() });
      await post(env, LIMITS.CHUNK_TTL_MS);
    }
    return { n, size: bytes.length, sha256: E.sha256(bytes) };
  }
  function blobEntry(key) { let b = blobs.get(key); if (!b) { b = { parts: new Map(), at: o.now(), want: null, done: null }; blobs.set(key, b); } return b; }
  function blobCheck(key) {
    const b = blobs.get(key);
    if (!b?.want || b.parts.size < b.want.n) return;
    const buf = Buffer.concat([...Array(b.want.n).keys()].map((i) => b.parts.get(i) ?? Buffer.alloc(0)));
    blobs.delete(key);
    if (buf.length !== b.want.size || E.sha256(buf) !== b.want.sha256) return b.done?.reject(new Error("the picture arrived damaged"));
    b.done?.resolve(buf);
  }
  function waitBlob(from, id, m) {
    const max = Math.ceil(LIMITS.MAX_CLIP_BYTES / LIMITS.CHUNK_BYTES);
    if (!m || !Number.isInteger(m.n) || m.n < 1 || m.n > max || !Number.isInteger(m.size) || m.size > LIMITS.MAX_CLIP_BYTES || !/^[a-f0-9]{64}$/.test(String(m.sha256))) return Promise.reject(new Error("a bad picture description"));
    const key = from + "|" + id, b = blobEntry(key);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { blobs.delete(key); reject(new Error("the picture didn't arrive in time")); }, LIMITS.BLOB_WAIT_MS);
      timer.unref?.();
      b.want = m; b.done = { resolve: (x) => { clearTimeout(timer); resolve(x); }, reject: (e) => { clearTimeout(timer); reject(e); } };
      blobCheck(key);
    });
  }
  function gcBlobs() { const t = o.now(); for (const [k, b] of blobs) if (!b.want && t - b.at > LIMITS.CHUNK_TTL_MS) blobs.delete(k); }

  // Send one command to one device and wait for its answer. Never retried: one try, a clear answer.
  //   → { ok, say, result, bytes?, contentType?, offline?, timeout?, denied?, needsConfirm?, unsupported? }
  async function send(to, action, args = {}, { confirmed = false, queue = false, blob = null, timeoutMs = null, ttlMs = null } = {}) {
    requireApproved();
    if (permFor(action) === undefined) return { ok: false, say: `I don't know how to ask another device to do "${action}".` };
    if (to === myId()) return { ok: false, local: true, say: "That's this device." };
    const d = trusted(to);
    if (!d) return { ok: false, say: "That isn't one of your approved devices." };
    if (o.now() - rowsAt > 30_000) await sync().catch(() => {});
    const row = rowsCache.find((r) => r.id === to), name = row?.name ?? d.name;
    if (!isOnline(row) && !queue) return { ok: false, offline: true, say: `${name} is offline${row?.last_seen ? ` (last seen ${ago(hubNow() - Date.parse(row.last_seen))})` : ""}, so I didn't send it. Try again when it's on.` };
    const id = randomUUID();
    const ttl = ttlMs ?? (queue ? LIMITS.COMMAND_TTL_MS : 60_000);   // something done later than a minute would surprise him
    let manifest = null;
    if (blob?.bytes) manifest = { ...(await sendChunks(to, id, blob.bytes)), contentType: String(blob.contentType ?? "application/octet-stream") };
    const env = E.makeEnvelope({ identity: me(), user: st.userId, to, toEncPub: d.encPub, kind: "cmd", id, payload: { action, args, confirmed: confirmed ? { at: hubNow() } : null, blob: manifest }, ttlMs: ttl, now: hubNow() });
    await post(env, ttl);
    log("remote.sent", { to: name, deviceId: to, action, confirmed: Boolean(confirmed), text: `Sent "${action}" to ${name}.` });
    if (queue) return { ok: true, queued: true, say: `Sent to ${name}.` };
    const waitMs = timeoutMs ?? (/camera|snapshot|clip/.test(action) ? LIMITS.BLOB_WAIT_MS : LIMITS.REPLY_WAIT_MS);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, timeout: true, say: `${name} didn't answer in time. The request expires within a minute, so it won't happen later than that.` }); }, waitMs);
      timer.unref?.();
      pending.set(id, { resolve: (x) => { clearTimeout(timer); pending.delete(id); resolve(x); }, timer, to, action, name });
      quickPoll();
    });
  }
  // notifications (camera alerts, reminders): to one device or all of them, queued up to 5 minutes, no waiting
  async function notify(target, { title = "", body = "", image = null, contentType = "image/jpeg" } = {}) {
    if (!approved()) return { sent: 0, reason: "not signed in" };
    await sync().catch(() => {});
    const ids = target === "all" || !target ? Object.keys(st.trust.devices).filter((id) => id !== myId() && trusted(id)) : [findDevice(target)?.id ?? target].filter((id) => trusted(id) && id !== myId());
    const args = { title: String(title).slice(0, 200), body: String(body).slice(0, 2000) };
    let sent = 0; const errors = [];
    for (const id of ids) {
      try {
        const bytes = image && image.length <= LIMITS.MAX_STILL_BYTES ? image : null;
        const r = await send(id, "notify", args, { queue: true, blob: bytes ? { bytes, contentType } : null });
        if (r.ok) sent++; else errors.push(r.say);
      } catch (e) { errors.push(e.message); }
    }
    return { sent, of: ids.length, errors };
  }

  // Everything addressed to this device. Checked, then acknowledged (deleted on the hub), then acted on.
  let inboxRun = null, inboxAgain = false;
  function processInbox() {
    if (!approved() || !loadSession()) return Promise.resolve(0);
    if (inboxRun) { inboxAgain = true; return inboxRun; }
    inboxRun = (async () => {
      let total = 0;
      do {
        inboxAgain = false;
        const rows = await rpc("dayspring_remote_inbox", { p_device: myId() });
        const ids = [];
        for (const row of rows ?? []) { ids.push(row.id); total++; try { receive(row); } catch (e) { log("remote.refused", { from: row.from_device, reason: String(e?.message ?? e).slice(0, 200) }); } }
        if (ids.length) await rpc("dayspring_remote_ack", { p_device: myId(), p_ids: ids }).catch(() => {});
        if (ids.length) saveSeen();
      } while (inboxAgain);
      gcBlobs();
      return total;
    })().finally(() => { inboxRun = null; });
    return inboxRun;
  }
  function refuse(row, reason, env = null) {
    log("remote.refused", { from: nameOf(row.from_device), deviceId: row.from_device, kind: row.kind, reason, text: `Refused a remote ${row.kind === "cmd" ? "command" : "message"}: ${reason}.` });
    emit("refused", { from: row.from_device, reason, id: env?.id ?? row.id });
  }
  function receive(row) {
    const env = row.envelope;
    const why = E.checkEnvelope(env, row, { me: myId(), user: st.userId, now: hubNow(), trusted });
    if (why) return refuse(row, why, env);
    if (seen.has(env.id)) return refuse(row, "already received once (a replay)", env);
    seen.set(env.id, env.exp);
    let payload;
    try { payload = E.openEnvelope(env, me(), { json: env.kind !== "chunk" }); }
    catch { return refuse(row, "couldn't be decrypted (changed on the way?)", env); }
    if (env.kind === "chunk") { const key = env.from + "|" + env.replyTo; blobEntry(key).parts.set(env.seq, payload); blobCheck(key); return; }
    if (env.kind === "resp") { gotReply(env, payload).catch(() => {}); return; }
    runCommand(env, payload).catch((e) => log("remote.command", { from: nameOf(env.from), result: "error", error: String(e?.message ?? e).slice(0, 200) }));
  }
  async function gotReply(env, body) {
    const p = pending.get(env.replyTo);
    if (!p || p.to !== env.from) { log("remote.late", { from: nameOf(env.from), text: `A late answer from ${nameOf(env.from)}${body?.say ? ": " + String(body.say).slice(0, 200) : ""}.` }); return; }
    let bytes = null;
    if (body?.blob) { try { bytes = await waitBlob(env.from, env.replyTo, body.blob); } catch (e) { return p.resolve({ ok: false, say: `The picture from ${p.name} didn't come through (${e.message}).` }); } }
    p.resolve({ ...body, ok: body?.ok !== false, from: p.name, ...(bytes ? { bytes, contentType: body.blob.contentType } : {}) });
  }
  async function respond(env, body, bytes = null, contentType = null) {
    const d = trusted(env.from);
    if (!d) return;
    if (bytes) body.blob = { ...(await sendChunks(env.from, env.id, bytes)), contentType: contentType ?? "image/jpeg" };
    const r = E.makeEnvelope({ identity: me(), user: st.userId, to: env.from, toEncPub: d.encPub, kind: "resp", payload: body, replyTo: env.id, ttlMs: LIMITS.CHUNK_TTL_MS, now: hubNow() });
    await post(r, LIMITS.CHUNK_TTL_MS).catch((e) => log("remote.command", { result: "error", error: "couldn't send the answer back: " + e.message }));
  }
  async function runCommand(env, payload) {
    const from = { deviceId: env.from, name: nameOf(env.from) };
    const action = String(payload?.action ?? ""), args = payload?.args && typeof payload.args === "object" ? payload.args : {};
    const perm = permFor(action);
    const said = (result, extra = {}) => log("remote.command", { from: from.name, deviceId: env.from, action, result, ...extra, text: `${from.name} asked this device to ${action}: ${result}${extra.reason ? " (" + extra.reason + ")" : ""}.` });
    if (perm === undefined) { said("refused", { reason: "unknown action" }); return respond(env, { ok: false, unsupported: true, say: `${st.name} doesn't know how to do that.` }); }
    if (!st.accept) { said("refused", { reason: "this device isn't accepting remote commands" }); return respond(env, { ok: false, denied: true, say: `${st.name} isn't accepting commands from other devices right now (Settings → Devices & sign-in on ${st.name}).` }); }
    const t = o.now(), win = (perSender.get(env.from) ?? []).filter((x) => t - x < 60_000);
    if (win.length >= LIMITS.PER_SENDER_PER_MIN) { said("refused", { reason: "too many commands in a minute" }); return respond(env, { ok: false, denied: true, say: `${st.name} got too many commands from ${from.name} in the last minute. Wait a moment.` }); }
    win.push(t); perSender.set(env.from, win);
    if (perm && !permsOf(env.from).includes(perm)) { said("refused", { reason: `${from.name} isn't allowed: ${perm}` }); return respond(env, { ok: false, denied: true, say: `${from.name} isn't allowed to ${PERM_WORDS[perm].charAt(0).toLowerCase() + PERM_WORDS[perm].slice(1)} on your devices. You can change that in Settings → Devices & sign-in.` }); }
    const h = o.handlers.get(action);
    if (!h && action !== "ping") { said("refused", { reason: "not set up on this device" }); return respond(env, { ok: false, unsupported: true, say: `${st.name} can't do that: ${action.split(".")[0]} isn't set up there.` }); }
    let risky = isRisky(action, args); try { risky ||= Boolean(h?.risky?.(args)); } catch { risky = true; }
    if (risky && !payload.confirmed) { said("asked", { reason: "needs the owner's OK on the sending device" }); return respond(env, { ok: false, needsConfirm: true, say: `That needs your OK first: ${riskText(action, args)}.` }); }
    if (payload.blob) { try { args.image = await waitBlob(env.from, env.id, payload.blob); args.imageType = payload.blob.contentType; } catch (e) { said("error", { reason: e.message }); return respond(env, { ok: false, say: `The picture didn't arrive: ${e.message}.` }); } }
    if (action === "ping") { said("ok"); return respond(env, { ok: true, say: `${st.name} is here.`, result: { name: st.name, version: o.version } }); }
    let out;
    try {
      out = await Promise.race([Promise.resolve(h.fn(args, { from, confirmed: Boolean(payload.confirmed), remote: true })), new Promise((_, rej) => { const x = setTimeout(() => rej(new Error("it took too long")), 30_000); x.unref?.(); })]);
    } catch (e) { said("error", { reason: e.message }); return respond(env, { ok: false, say: `${st.name} couldn't do that: ${e.message}` }); }
    if (out?.needsConfirm) { said("asked", { reason: "the device layer wants the owner's OK" }); return respond(env, { ok: false, needsConfirm: true, say: String(out.say ?? "That needs your OK first.") }); }
    const bytes = Buffer.isBuffer(out) ? out : Buffer.isBuffer(out?.bytes) ? out.bytes : null;
    if (bytes && bytes.length > LIMITS.MAX_CLIP_BYTES) { said("error", { reason: "too big" }); return respond(env, { ok: false, say: "That's too big to send over the internet this way." }); }
    const body = { ok: out?.ok !== false && !out?.error, say: out?.say ?? (out?.error ? String(out.error) : null), result: out && !Buffer.isBuffer(out) ? { ...out, bytes: undefined } : null };
    said(body.ok ? "ok" : "error", out?.error ? { reason: String(out.error).slice(0, 200) } : {});
    return respond(env, body, bytes, out?.contentType ?? null);
  }

  // ---- keeping in touch: heartbeat, live updates, polling (backing off when the hub can't be reached) --------------------
  let started = false, loopTimer = null, liveConn = null, lastBeat = 0, lastSync = 0, lastProfile = 0, quick = null;
  const announced = new Set();
  async function heartbeat() {
    const r = await rpc("dayspring_remote_heartbeat", { p_device: myId(), p_version: o.version });
    lastBeat = o.now();
    if (r?.status === "revoked") { lastSync = 0; await sync(); }
    if (r?.status === "unbound") { lastError = "This device's sign-in was replaced. Sign in again on this device."; }
    return r;
  }
  async function tick() {
    if (!started) return;
    if (o.now() - lastBeat >= LIMITS.HEARTBEAT_MS) await heartbeat();
    if (!started) return;
    if (o.now() - lastSync >= 5 * 60_000) { await sync(); lastSync = o.now(); }
    if (st.status === "pending") await pairingView().catch(() => {});
    if (approved()) {
      await processInbox();
      if (o.now() - lastProfile > 30 * 60_000) { lastProfile = o.now(); await publishProfile().catch(() => {}); }
      for (const r of await requests().catch(() => [])) if (!announced.has(r.id)) { announced.add(r.id); emit("pairing-request", r); }
    }
  }
  async function loop() {
    if (!started) return;
    try { await tick(); failures = 0; if (conn !== "signed-out") conn = "online"; lastError = null; }
    catch (e) { failures++; if (e?.kind === "offline") conn = "offline"; lastError = e?.message ?? String(e); if (e?.kind === "auth") conn = "signed-out"; }
    if (!started) return;
    const base = liveConn?.state() === "live" ? LIMITS.POLL_LIVE_MS : LIMITS.POLL_MS;
    const wait = failures ? Math.min(base * 2 ** Math.min(failures, 6), LIMITS.MAX_BACKOFF_MS) : base;
    loopTimer = setTimeout(loop, wait); loopTimer.unref?.();
  }
  // while waiting for an answer and live updates aren't connected: look every 1.5 s (only until the wait ends)
  function quickPoll() {
    if (quick || liveConn?.state() === "live") return;
    quick = setInterval(() => { if (!pending.size) { clearInterval(quick); quick = null; return; } processInbox().catch(() => {}); }, 1500);
    quick.unref?.();
  }
  let kickT = null;
  const kick = (what) => { clearTimeout(kickT); kickT = setTimeout(() => { (what === "inbox" ? processInbox() : sync().then(() => (st.status === "pending" ? pairingView() : requests().then((rs) => { for (const r of rs) if (!announced.has(r.id)) { announced.add(r.id); emit("pairing-request", r); } })))).catch(() => {}); }, 60); kickT.unref?.(); };
  function start() {
    if (started || !loadSession() || !myId()) return false;
    started = true;
    loop();
    if (o.live) {
      try {
        liveConn = hub().live({ token, onState: (s) => emit("live", s),
          topics: [{ table: "dayspring_remote_messages", event: "INSERT", filter: `to_device=eq.${myId()}` }, { table: "dayspring_remote_devices", filter: `user_id=eq.${st.userId}` }, { table: "dayspring_remote_pairings", filter: `user_id=eq.${st.userId}` }],
          onChange: (d) => kick(d?.table === "dayspring_remote_messages" ? "inbox" : "sync") });
      } catch { liveConn = null; }
    }
    return true;
  }
  function stop() { started = false; clearTimeout(loopTimer); clearInterval(quick); quick = null; clearTimeout(kickT); try { liveConn?.stop(); } catch { /* gone */ } liveConn = null; }

  function status() {
    let hubKnown = false; try { hubKnown = Boolean(o.hubConfig?.()?.url); } catch { /* no */ }
    const signedIn = Boolean(loadSession());
    return { hubKnown, signedIn, email: signedIn ? st.email : null, name: st.name, status: signedIn ? st.status : st.deviceId ? "signed-out" : "none",
      device: st.deviceId ? { id: st.deviceId, name: st.name, fingerprint: me() ? E.fingerprint(me().sign.pub) : null } : null,
      connection: signedIn ? conn : "signed-out", live: liveConn?.state() ?? "off", accept: st.accept, pairing: st.pairing ? { id: st.pairing.id } : null, lastError };
  }
  const setAccept = (on) => { st.accept = Boolean(on); save(); log("remote.accept", { on: st.accept, text: st.accept ? "This device accepts commands from your other devices again." : "This device stopped accepting commands from your other devices." }); return { accept: st.accept }; };
  const setName = (n) => rename(myId(), n);

  return { signIn, sendLink, completeLink, signOutHere, status, setName, setAccept, start, stop, pairingView, confirmPairing, requests, review, approve, reject,
    devices, cached, findDevice, whoHandles, rename, setPerms, revoke, forget, send, notify, sync, processInbox, publishProfile, heartbeat,
    handlers: o.handlers, approved, _state: () => st, _identity: () => me() };
}
