// Social: "same person" links between different users' people, the clusters they make, and claims.
// docs/SOCIAL.md "People and links" and "Claims".
//
//   proposeLink({ proposer, a, b, evidence, confidence })  → a link record (the proposer's endorsement included)
//   endorseLink(link, { by, confidence })                   → the link with one more endorsement (a new object)
//   rejectLink(link, by) / confirmBySubject(link, by)
//   linkStatus(w, link, opts) → { status: "confirmed"|"pending"|"rejected"|"blocked", reason, score, users }
//   clusters(w, opts) → { clusterOf(owner, personId), members(clusterId), subjectOf(clusterId), ids() }
//   proposeClaim / claimStatus(w, claim)
//
// Rules (a stalker must not be able to glue their record onto someone else's friend):
//   • both record owners must endorse (a link touches two people's private address books: both must agree)
//   • at least MIN_USERS distinct users endorse, and their confidences add up to MIN_SCORE
//   • OR the subject (a confirmed claimant) or, for a minor, a guardian confirms it
//   • a rejection by the subject, a guardian or either record owner ends it (for good)
//   • face evidence counts only if the subject opted in to face matching (default off); a minor's face never counts
//     without a guardian's yes; a subject who set linking to "subject-only" (the default for minors) must confirm
//     themselves; "off" means no links at all
import { randomUUID } from "node:crypto";
import { LINK_EVIDENCE } from "./schema.mjs";
import { nodeKey, parseNode } from "./world.mjs";
import { consentFor } from "./consent.mjs";

export const LINK_DEFAULTS = { minUsers: 2, minScore: 1.4 };

export function proposeLink({ proposer, a, b, evidence = "manual", confidence = null, id = null, at = null }) {
  const c = confidence ?? LINK_EVIDENCE[evidence] ?? 0.5;
  return { id: id ?? "lnk_" + randomUUID(), proposer, a: { owner: a.owner, personId: a.personId }, b: { owner: b.owner, personId: b.personId }, evidence, confidence: c,
    endorsements: [{ by: proposer, confidence: c, evidence }], rejectedBy: [], confirmedBy: [], createdAt: at ?? new Date().toISOString(), rev: 1 };
}
export function endorseLink(link, { by, confidence = null, evidence = "manual" }) {
  const c = confidence ?? LINK_EVIDENCE[evidence] ?? 0.5;
  const rest = (link.endorsements ?? []).filter((e) => e.by !== by);
  return { ...link, endorsements: [...rest, { by, confidence: c, evidence }], rev: (link.rev ?? 1) + 1 };
}
export const rejectLink = (link, by) => ({ ...link, rejectedBy: [...new Set([...(link.rejectedBy ?? []), by])], rev: (link.rev ?? 1) + 1 });
export const confirmBySubject = (link, by) => ({ ...link, confirmedBy: [...new Set([...(link.confirmedBy ?? []), by])], rev: (link.rev ?? 1) + 1 });

// The person records' minor flag and guardians (either side of a link counts).
function minorInfo(w, link) {
  const ps = [w.person(link.a.owner, link.a.personId), w.person(link.b.owner, link.b.personId)].filter(Boolean);
  const minor = ps.some((p) => p.isMinor);
  const guardians = new Set(ps.flatMap((p) => p.guardians ?? []));
  return { minor, guardians };
}

// Claims confirmed before clustering: a subject is known per person record.
function subjectForNode(w, owner, personId, opts) {
  for (const k of w.claims) {
    if (w.isTombstoned("claims", k.id)) continue;
    if (k.person.owner === owner && k.person.personId === personId && claimStatus(w, k, opts).status === "confirmed") return k.claimant;
  }
  return null;
}

export function linkStatus(w, link, opts = {}) {
  const { minUsers, minScore } = { ...LINK_DEFAULTS, ...opts };
  if (w.isTombstoned?.("links", link.id)) return { status: "rejected", reason: "revoked", score: 0, users: [] };
  const pa = w.person(link.a.owner, link.a.personId), pb = w.person(link.b.owner, link.b.personId);
  if (!pa || !pb) return { status: "pending", reason: "unknown-person", score: 0, users: [] };
  if (link.a.owner === link.b.owner) return { status: "rejected", reason: "same-owner", score: 0, users: [] };
  const subject = subjectForNode(w, link.a.owner, link.a.personId, opts) ?? subjectForNode(w, link.b.owner, link.b.personId, opts);
  const { minor, guardians } = minorInfo(w, link);
  const rejected = new Set(link.rejectedBy ?? []);
  if (subject && rejected.has(subject)) return { status: "rejected", reason: "subject-rejected", score: 0, users: [] };
  if ([...guardians].some((g) => rejected.has(g))) return { status: "rejected", reason: "guardian-rejected", score: 0, users: [] };
  if (rejected.has(link.a.owner) || rejected.has(link.b.owner)) return { status: "rejected", reason: "owner-rejected", score: 0, users: [] };
  const consent = subject || minor ? consentFor(w, subject, { minor, nodes: [link.a, link.b], guardians: [...guardians] }) : null;
  if (consent?.linking === "off") return { status: "blocked", reason: "subject-linking-off", score: 0, users: [] };
  const confirmedBy = new Set(link.confirmedBy ?? []);
  if (subject && confirmedBy.has(subject)) return { status: "confirmed", reason: "subject-confirmed", score: 1, users: [subject] };
  if (minor) {
    const g = [...guardians].find((x) => confirmedBy.has(x));
    if (g) return { status: "confirmed", reason: "guardian-confirmed", score: 1, users: [g] };
    return { status: "pending", reason: "minor-needs-guardian", score: 0, users: [] };
  }
  if (consent?.linking === "subject-only") return { status: "pending", reason: "subject-only", score: 0, users: [] };
  const faceOk = (consent?.faceMatching ?? "off") === "in";
  const counted = (link.endorsements ?? []).filter((e) => (e.evidence ?? link.evidence) !== "face" || faceOk);
  const users = [...new Set(counted.map((e) => e.by))];
  const score = counted.reduce((s, e) => s + Math.max(0, Math.min(1, e.confidence)), 0);
  if (!users.includes(link.a.owner) || !users.includes(link.b.owner)) return { status: "pending", reason: link.evidence === "face" && !faceOk ? "face-not-consented" : "needs-both-owners", score, users };
  if (users.length < minUsers) return { status: "pending", reason: "too-few-users", score, users };
  if (score < minScore) return { status: "pending", reason: "low-confidence", score, users };
  return { status: "confirmed", reason: "endorsed", score, users };
}

// Union-find over confirmed links. A cluster id is the smallest node key in it, so every replica agrees.
export function clusters(w, opts = {}) {
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (x, y) => { const a = find(x), b = find(y); if (a === b) return; if (a < b) parent.set(b, a); else parent.set(a, b); };
  for (const p of w.people) if (!w.isTombstoned("people", p.id)) find(nodeKey(p.owner, p.id));
  for (const l of w.links) if (linkStatus(w, l, opts).status === "confirmed") union(nodeKey(l.a.owner, l.a.personId), nodeKey(l.b.owner, l.b.personId));
  const groups = new Map();
  for (const x of parent.keys()) { const r = find(x); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); }
  const idOf = new Map();
  for (const [, m] of groups) { m.sort(); const id = "c_" + m[0]; for (const x of m) idOf.set(x, id); }
  const members = new Map();
  for (const [x, id] of idOf) { if (!members.has(id)) members.set(id, []); members.get(id).push(parseNode(x)); }
  const subjects = new Map();
  for (const [id, ms] of members) {
    const found = new Set(ms.map((m) => subjectForNode(w, m.owner, m.personId, opts)).filter(Boolean));
    subjects.set(id, found.size === 1 ? [...found][0] : null);      // two different claimants = disputed = nobody
  }
  return {
    clusterOf: (owner, personId) => idOf.get(nodeKey(owner, personId)) ?? null,
    members: (id) => (members.get(id) ?? []).slice(),
    subjectOf: (id) => subjects.get(id) ?? null,
    ids: () => [...members.keys()],
  };
}

// ---- claims: "that person is me" -------------------------------------------------------------------------------------
export function proposeClaim({ claimant, person, id = null, at = null }) {
  return { id: id ?? "clm_" + randomUUID(), claimant, person: { owner: person.owner, personId: person.personId }, vouches: [], createdAt: at ?? new Date().toISOString(), rev: 1 };
}
export const vouchClaim = (claim, by) => ({ ...claim, vouches: [...new Set([...(claim.vouches ?? []), by])], rev: (claim.rev ?? 1) + 1 });

// A claim is confirmed when the owner of the claimed record vouches for it ("yes, that account is my friend"), or the
// owner had already marked the record as that user (person.subjectUserId), and, for a minor, a guardian vouches too.
// A claimant can never vouch for themselves.
export function claimStatus(w, claim, _opts = {}) {
  if (w.isTombstoned?.("claims", claim.id)) return { status: "rejected", reason: "revoked" };
  const p = w.person(claim.person.owner, claim.person.personId);
  if (!p) return { status: "pending", reason: "unknown-person" };
  if (claim.claimant === p.owner) return { status: "rejected", reason: "owner-cannot-claim-own-record" };
  const vouches = new Set((claim.vouches ?? []).filter((v) => v !== claim.claimant));
  const ownerSays = vouches.has(p.owner) || p.subjectUserId === claim.claimant;
  if (!ownerSays) return { status: "pending", reason: "needs-owner-vouch" };
  if (p.isMinor && !(p.guardians ?? []).some((g) => vouches.has(g) || g === p.owner)) return { status: "pending", reason: "minor-needs-guardian" };
  return { status: "confirmed", reason: "vouched" };
}
