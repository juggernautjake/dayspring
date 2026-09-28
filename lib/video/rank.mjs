// Ranking YouTube results for what was asked: how well the title fits, the channel, the length and the filters, views,
// how new it is, YouTube's own order, not Shorts unless asked, and what the owner corrected before (prefs.mjs).
//   rank(results, req, { kept, rejected, channel }) → [{ ...result, score, why }] best first (filtered)
//   confidence(ranked, req) → { sure: bool, score, margin }
import { sim, covers, norm, nameSim, ageDays, viewsOf, secsOf } from "./text.mjs";

const isShort = (r) => (r.secs != null && r.secs > 0 && r.secs <= 61) || /#shorts?\b/i.test(r.title ?? "") || /\/shorts\//.test(r.url ?? "");
export { isShort };
// does a result pass the hard filters (length, Shorts)?
export function passes(r, f = {}) {
  const secs = r.secs ?? secsOf(r.length);
  if (f.minSecs && secs != null && secs < f.minSecs) return false;
  if (f.maxSecs && secs != null && secs > f.maxSecs) return false;
  if (f.shorts) return isShort({ ...r, secs });
  if (isShort({ ...r, secs }) && f.noShorts !== false) return false;          // Shorts only when asked for
  if (f.recentDays) { const d = ageDays(r.age ?? r.published); if (d != null && d > f.recentDays + 1) return false; }
  return true;
}
export function rank(results, req = {}, { kept = null, rejected = new Set(), channel = null } = {}) {
  const f = req.filters ?? {}, q = req.query ?? "", n = results.length || 1;
  const out = [];
  results.forEach((r0, i) => {
    const id = r0.videoId ?? r0.playlistId;
    if (!id || rejected.has(id)) return;
    const r = { ...r0, secs: r0.secs ?? secsOf(r0.length), viewCount: r0.viewCount ?? viewsOf(r0.views) };
    if (!passes(r, f)) return;
    if (req.live && !r.live) { /* not live: kept, but lower */ }
    const why = [];
    let s = 0;
    if (q) {
      const t = sim(q, r.title), c = covers(r.title, q), chq = r.channel ? Math.max(covers(r.channel, q), nameSim(q, r.channel) >= 0.85 ? 1 : 0) : 0;
      const fit = req.kind === "title" ? Math.max(t, 0.9 * c) : Math.max(0.8 * t, c);
      s += 0.55 * fit + 0.12 * chq;
      if (fit >= 0.75) why.push("title");
      if (chq >= 0.7) why.push("channel");
      // words he said that are in neither the title nor the channel
      const miss = 1 - Math.max(c, covers(`${r.title} ${r.channel ?? ""}`, q));
      s -= 0.15 * miss;
    } else s += 0.3;
    if (channel && r.channel) { if (nameSim(channel.name, r.channel) >= 0.85) { s += 0.3; why.push("their channel"); } else s -= 0.3; }
    s += 0.15 * (1 - i / n);                                                           // YouTube's own order
    const views = r.viewCount ?? 0;
    s += (f.popular ? 0.3 : 0.06) * Math.min(1, Math.log10(Math.max(1, views)) / 7);   // 10M views = the full amount
    const age = ageDays(r.age ?? r.published);
    if (f.newest && age != null) s += 0.3 * Math.max(0, 1 - age / 60);
    if (req.live) s += r.live ? 0.4 : -0.2;
    else if (r.live) s -= 0.15;
    if (f.full && /\bfull\b/i.test(r.title)) s += 0.1;
    if (r.secs == null && !r.playlistId && !r.live) s -= 0.03;
    if (kept && kept === id) { s += 0.6; why.push("you chose it before"); }
    out.push({ ...r, score: Math.round(s * 1000) / 1000, why });
  });
  return out.sort((a, b) => b.score - a.score);
}
// sure enough to just play it? (else: offer the top 3)
export function confidence(ranked, req = {}) {
  const [a, b] = ranked;
  if (!a) return { sure: false, score: 0, margin: 0 };
  const margin = b ? a.score - b.score : 1;
  if (a.why.includes("you chose it before")) return { sure: true, score: a.score, margin };
  const q = req.query ?? "";
  const fitOf = (x) => (q && x ? Math.max(sim(q, x.title), covers(x.title, q), covers(`${x.title} ${x.channel ?? ""}`, q)) : x ? 1 : 0);
  const fit = fitOf(a), fitB = fitOf(b);
  // a topic just needs a good, relevant video; a title has to really be that title, and not one of several that fit as well
  const exact = q && norm(a.title) === norm(q);
  const sure = req.kind === "title" ? exact || (fit >= 0.8 && !(fitB >= 0.8 && margin < 0.25)) || (fit >= 0.6 && margin >= 0.12 && fitB < 0.6)
    : req.kind === "creator" || req.kind === "morelike" || req.kind === "episode" ? true : fit >= 0.5 || margin >= 0.15;
  return { sure, score: a.score, margin: Math.round(margin * 1000) / 1000, fit: Math.round(fit * 100) / 100 };
}
export const keyOf = (req) => `${req.kind ?? ""}:${norm(req.creator ?? "")}:${norm(req.query ?? "")}`;
