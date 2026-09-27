// Social: the pooled profile, a computed view (never stored) of one person, made only of shared items this viewer may
// see about them. docs/SOCIAL.md "Pooled profiles".
//
//   buildProfile(w, viewer, clusterId, { now, cl, localPrivate })
//     → { allowed, reason, clusterId, role, subject: { userId, claimed }, optedOut,
//         items:   [{ itemId, owner, kind, date, eventKind, hidden? }]   pooled from other users (and the viewer's own shares)
//         localOnly: [...]   the viewer's OWN private records about this person (their texts, notes), passed in by the app,
//                            shown to them only, never synced or pooled
//         contributors: n    how many different users' shares are in it (not who, unless they shared with the viewer)
//         denied: { reason: count }  why other items were left out (for the subject's "what's shared about me" view) }
//   profileFor(w, viewer, owner, personId, opts)  the same, starting from one of the viewer's own people
import { clusters } from "./links.mjs";
import { canPool, canViewProfile } from "./consent.mjs";

export function buildProfile(w, viewer, clusterId, { now = Date.now(), cl = null, localPrivate = [] } = {}) {
  const c = cl ?? clusters(w);
  const access = canViewProfile(w, viewer, clusterId, { cl: c });
  const subject = c.subjectOf(clusterId);
  const base = { clusterId, subject: { userId: subject, claimed: Boolean(subject) }, items: [], localOnly: [], contributors: 0, denied: {} };
  if (!access.allow) return { allowed: false, reason: access.reason, role: null, optedOut: false, ...base };
  const mine = new Set(c.members(clusterId).filter((m) => m.owner === viewer).map((m) => m.personId));
  const candidates = w.items.filter((it) => !w.isTombstoned("items", it.id) && (it.people ?? []).some((pid) => c.clusterOf(it.owner, pid) === clusterId));
  const items = [];
  const denied = {};
  for (const it of candidates) {
    const r = canPool(w, viewer, it.id, clusterId, { now, cl: c });
    if (r.allow) items.push({ itemId: it.id, owner: it.owner, kind: it.kind, date: it.date ?? null, eventKind: it.eventKind ?? null, ...(r.hidden ? { hidden: true } : {}) });
    else denied[r.reason] = (denied[r.reason] ?? 0) + 1;
  }
  items.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || a.itemId.localeCompare(b.itemId));
  // The viewer's own private material: only theirs, only about their own record(s) in this cluster, and flagged local.
  const localOnly = (localPrivate ?? [])
    .filter((x) => x && x.owner === viewer && (x.people ?? []).some((pid) => mine.has(pid)))
    .map((x) => ({ ...x, localOnly: true }));
  const optedOut = Boolean(denied["subject-opted-out"] || denied["minor-guardian-consent-needed"]);
  return { allowed: true, reason: access.reason, role: access.role, optedOut, ...base, items, localOnly, contributors: new Set(items.map((i) => i.owner)).size,
    // what was left out and why, for the subject and guardians only (others learn nothing from the counts)
    denied: access.role === "subject" || access.role === "guardian" ? denied : {} };
}

export function profileFor(w, viewer, owner, personId, opts = {}) {
  const cl = opts.cl ?? clusters(w);
  const id = cl.clusterOf(owner, personId);
  if (!id) return { allowed: false, reason: "no-profile", items: [], localOnly: [] };
  return buildProfile(w, viewer, id, { ...opts, cl });
}
