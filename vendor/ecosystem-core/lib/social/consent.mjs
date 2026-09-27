// Social: the consent engine. Pure functions over a world (world.mjs); no I/O, no clock unless passed.
// docs/SOCIAL.md "Consent".
//
//   canView(w, viewer, itemId, { now })                  → { allow, reason }   may this viewer see this item at all?
//   canPool(w, viewer, itemId, clusterId, { now, cl })   → { allow, reason, hidden? }  may it appear in that pooled profile?
//   canViewProfile(w, viewer, clusterId, { cl })         → { allow, reason, role }
//   canShare(w, sharer, item, audience, permissions)     → { allow, reason }   checked before a share is made
//   consentFor(w, subjectUserId, { minor, nodes, guardians }) → { pooling, faceMatching, linking }
//
// Every "no" carries a reason code (tests and the audit log use them). The defaults are the private ones: anything the
// rules don't positively allow is denied.
import { CONSENT_DEFAULTS, MINOR_DEFAULTS, SHAREABLE_KINDS, FORBIDDEN_KINDS } from "./schema.mjs";
import { clusters } from "./links.mjs";

const yes = (reason, extra = {}) => ({ allow: true, reason, ...extra });
const no = (reason) => ({ allow: false, reason });
const t = (now) => (now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.now());

// The latest decision per scope. Only the subject decides for themselves; for a minor, only a guardian decides.
export function consentFor(w, subjectUserId, { minor = false, nodes = [], guardians = [] } = {}) {
  const u = subjectUserId ? w.user(subjectUserId) : null;
  const isMinor = minor || Boolean(u?.isMinor);
  const g = new Set([...(guardians ?? []), ...(u?.guardians ?? [])]);
  const out = { ...(isMinor ? MINOR_DEFAULTS : CONSENT_DEFAULTS) };
  const nodeSet = new Set(nodes.map((n) => `${n.owner}:${n.personId}`));
  const mine = w.consents
    .filter((r) => !w.isTombstoned("consents", r.id))
    .filter((r) => (subjectUserId && r.subjectUserId === subjectUserId) || (r.person && nodeSet.has(`${r.person.owner}:${r.person.personId}`)))
    .filter((r) => (isMinor ? g.has(r.by) : r.by === subjectUserId))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const r of mine) out[r.scope] = r.value;
  return out;
}

// Everyone a share reaches: the named users plus the members of the named groups. A group only counts if the sharer
// owns it or belongs to it (you can't aim a share at a stranger's group).
export function audienceOf(w, share) {
  const set = new Set(share.audience?.users ?? []);
  for (const gid of share.audience?.groups ?? []) {
    const g = w.group(gid);
    if (!g) continue;
    if (g.owner !== share.owner && !(g.members ?? []).includes(share.owner)) continue;
    for (const m of g.members ?? []) set.add(m);
    set.add(g.owner);
  }
  return set;
}
const live = (s, now) => !s.expiresAt || Date.parse(s.expiresAt) > t(now);

// The people an item is about, after "untag"s. An untag counts only from the item's owner, or from the subject or a
// guardian of that person (a stranger can't strip tags off someone else's memory).
function taggedNodes(w, item, cl) {
  const valid = (h) => {
    if (h.by === item.owner) return true;
    const pids = h.personId ? [h.personId] : item.people ?? [];
    return pids.some((pid) => {
      const cid = cl.clusterOf(item.owner, pid);
      const guardians = cid ? cl.members(cid).flatMap((m) => w.person(m.owner, m.personId)?.guardians ?? []) : w.person(item.owner, pid)?.guardians ?? [];
      return (cid && cl.subjectOf(cid) === h.by) || guardians.includes(h.by);
    });
  };
  const untag = new Set(w.hidesOf(item.id).filter((h) => h.action === "untag" && valid(h)).map((h) => h.personId ?? "*"));
  if (untag.has("*")) return [];
  return (item.people ?? []).filter((pid) => !untag.has(pid)).map((pid) => ({ owner: item.owner, personId: pid }));
}

// A subject (confirmed claimant) or guardian of any person the item is about.
function subjectRole(w, viewer, item, cl) {
  for (const n of taggedNodes(w, item, cl)) {
    const p = w.person(n.owner, n.personId);
    const cid = cl.clusterOf(n.owner, n.personId);
    if (cid && cl.subjectOf(cid) === viewer) return "subject";
    if (p && (p.guardians ?? []).includes(viewer)) return "guardian";
    if (cid) for (const m of cl.members(cid)) if ((w.person(m.owner, m.personId)?.guardians ?? []).includes(viewer)) return "guardian";
  }
  return null;
}

export function canView(w, viewer, itemId, { now = Date.now(), cl = null } = {}) {
  const item = w.item(itemId);
  if (!item) return no(w.isTombstoned("items", itemId) ? "deleted" : "no-item");
  if (FORBIDDEN_KINDS.includes(item.kind) || !SHAREABLE_KINDS.includes(item.kind)) return item.owner === viewer ? yes("owner") : no("kind-never-shared");
  if (item.owner === viewer) return yes("owner");
  if ((item.visibility ?? "private") !== "shared") return no("private");
  const all = w.shares.filter((s) => s.itemId === itemId);
  const liveShares = all.filter((s) => !w.isTombstoned("shares", s.id) && live(s, now));
  if (!liveShares.length) {
    const revoked = w.tombstones.some((x) => x.collection === "shares" && x.itemId === itemId) || all.some((s) => w.isTombstoned("shares", s.id));
    return no(revoked ? "revoked" : all.length ? "expired" : "not-shared");
  }
  if (liveShares.some((s) => audienceOf(w, s).has(viewer))) return yes("audience");
  const role = subjectRole(w, viewer, item, cl ?? clusters(w));
  if (role) return yes(role);
  return no("not-in-audience");
}

export function canViewProfile(w, viewer, clusterId, { cl = null } = {}) {
  const c = cl ?? clusters(w);
  const ms = c.members(clusterId);
  if (!ms.length) return no("no-profile");
  if (c.subjectOf(clusterId) === viewer) return yes("subject", { role: "subject" });
  if (ms.some((m) => (w.person(m.owner, m.personId)?.guardians ?? []).includes(viewer))) return yes("guardian", { role: "guardian" });
  if (ms.some((m) => m.owner === viewer)) return yes("knows-them", { role: "contact" });
  return no("no-relationship");       // you only see a pooled profile of someone you have in your own people
}

function minorOf(w, clusterId, cl) {
  const ms = cl.members(clusterId).map((m) => w.person(m.owner, m.personId)).filter(Boolean);
  const subject = cl.subjectOf(clusterId);
  const minor = ms.some((p) => p.isMinor) || Boolean(subject && w.user(subject)?.isMinor);
  const guardians = new Set([...ms.flatMap((p) => p.guardians ?? []), ...(subject ? w.user(subject)?.guardians ?? [] : [])]);
  return { minor, guardians, nodes: cl.members(clusterId), subject };
}

export function canPool(w, viewer, itemId, clusterId, { now = Date.now(), cl = null } = {}) {
  const c = cl ?? clusters(w);
  const prof = canViewProfile(w, viewer, clusterId, { cl: c });
  if (!prof.allow) return prof;
  const item = w.item(itemId);
  if (!item) return no(w.isTombstoned("items", itemId) ? "deleted" : "no-item");
  if (!SHAREABLE_KINDS.includes(item.kind)) return no("kind-never-pooled");
  if ((item.visibility ?? "private") !== "shared") return no("private-never-pooled");
  const view = canView(w, viewer, itemId, { now, cl: c });
  if (!view.allow) return view;
  const about = taggedNodes(w, item, c).some((n) => c.clusterOf(n.owner, n.personId) === clusterId);
  if (!about) return no(item.people?.length ? "untagged-or-other-person" : "not-about-this-person");
  const liveShares = w.sharesOf(itemId).filter((s) => live(s, now));
  const isSubjectSide = prof.role === "subject" || prof.role === "guardian";
  const poolOk = liveShares.some((s) => s.permissions?.pool && (item.owner === viewer || audienceOf(w, s).has(viewer) || isSubjectSide));
  if (!poolOk && !isSubjectSide) return no("share-disallows-pooling");
  const info = minorOf(w, clusterId, c);
  const consent = consentFor(w, info.subject, { minor: info.minor, nodes: info.nodes, guardians: [...info.guardians] });
  const hidden = w.hidesOf(itemId).some((h) => h.action === "hide" && (h.by === info.subject || info.guardians.has(h.by)));
  if (isSubjectSide) return yes(prof.role, hidden ? { hidden: true } : {});
  if (hidden) return no("hidden-by-subject");
  if (consent.pooling === "out") return no(info.minor ? "minor-guardian-consent-needed" : "subject-opted-out");
  if (info.minor) {
    // even with a guardian's yes, a child's pooled profile is for their guardians and the guardians' family groups only
    const family = w.groups.filter((g) => !w.isTombstoned("groups", g.id) && g.kind === "family" && info.guardians.has(g.owner));
    if (!family.some((g) => (g.members ?? []).includes(viewer))) return no("minor-family-only");
  }
  return yes("pooled");
}

// Before a share is created. The sharer must own the item, the kind must be shareable, the audience specific, and a
// share about a child goes only to that child's guardians and the guardians' family groups, never reshareable.
export function canShare(w, sharer, item, audience = {}, permissions = {}) {
  if (!item) return no("no-item");
  if (item.owner !== sharer) return no("not-owner");
  if (FORBIDDEN_KINDS.includes(item.kind) || !SHAREABLE_KINDS.includes(item.kind)) return no("kind-never-shared");
  const users = audience.users ?? [], groups = audience.groups ?? [];
  if (!users.length && !groups.length) return no("audience-required");
  const minors = (item.people ?? []).map((pid) => w.person(sharer, pid)).filter((p) => p?.isMinor);
  if (minors.length) {
    if (permissions.reshare) return no("minor-no-reshare");
    const guardians = new Set(minors.flatMap((p) => p.guardians ?? []));
    const famGroups = new Set(w.groups.filter((g) => g.kind === "family" && guardians.has(g.owner)).map((g) => g.id));
    const okUsers = users.every((u) => guardians.has(u) || w.groups.some((g) => famGroups.has(g.id) && (g.members ?? []).includes(u)));
    const okGroups = groups.every((g) => famGroups.has(g));
    if (!okUsers || !okGroups) return no("minor-audience");
  }
  return yes("ok");
}
