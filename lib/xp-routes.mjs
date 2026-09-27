// XP (paths are after /api):
//   GET  /xp                    balance, level, streak, the 14-day chart, recent check-ins, unlockables, rules, settings
//   POST /xp/checkin {category | text, id?}   start a typed check-in (the Progress page); returns its session id.
//                                 A client can't claim "block" or "timer" credit: those come only from the server's own
//                                 scheduler (a real block that ended) and timer hook (a Dayspring focus timer).
//   POST /xp/answer {text, id}   answer the typed check-in with that id (nothing else)
//   POST /xp/undo                undo the last check-in (within 10 minutes)
//   POST /xp/unlock {id}         unlock a found secret character with XP
//   POST /xp/settings {enabled, trackHidden, reminders, checkinTimes, badges}
//   POST /xp/presence {stopped, page}   a screen's "stop listening" (per page; the speaker page's decides)
// Badges:
//   GET  /xp/badges              the gallery: every category, earned / next / locked tiers, the case, the summary
//   GET  /xp/badge.svg?cat&tier&mode&size[&face=back]   an EARNED badge's art (never an unearned one's)
//   GET  /xp/badges?dev=1 · /xp/badge.svg?…&dev=1        the developer preview (lib/dev): every tier's name, description, a
//                                 sample citation and its art, only on a verified developer computer (404 everywhere else)
//   GET  /xp/mystery.svg?cat&tier                       the mystery card, only for a category's NEXT tier (others 404)
//   GET  /xp/badge.css            the badge motion (CSS), so page SVGs can skip their own copy
//   POST /xp/badges/seen {keys} · /xp/badges/pin {key} · /xp/badges/unpin {key} · /xp/badges/rename
//   POST /xp/badges/nudged {cat}  a screen showed a visual-only badge nudge (now it counts as sent)
import * as xp from "./xp/index.mjs";
import * as art from "./xp/badge-art.mjs";
import { MOTION, css as motionCSS, gridCSS } from "./xp/badges/motion.mjs";
import * as llm from "./llm.mjs";
import * as bus from "./bus.mjs";
import * as dev from "./dev/status.mjs";
import { previewView } from "./xp/badge-preview.mjs";

// Whether the Dayspring screen has "stop listening" on (only the screen knows; xp.js reports it, per page). The page
// that speaks decides; with no speaker known, any stopped page counts. No check-in questions are asked while it's on,
// or while Dayspring is Off or Quiet.
const stoppedPages = new Map();          // page id → { stopped, at }
export function screenStopped() {
  const now = Date.now();
  for (const [id, v] of stoppedPages) if (now - v.at > 6 * 3600_000) stoppedPages.delete(id);
  const sp = bus.speaker?.()?.id;
  if (sp && stoppedPages.has(sp)) return stoppedPages.get(sp).stopped;
  return [...stoppedPages.values()].some((v) => v.stopped);
}
export const _pages = { clear: () => stoppedPages.clear(), set: (id, stopped) => stoppedPages.set(String(id), { stopped: Boolean(stopped), at: Date.now() }) };
let lanternMod = null;
// what Lantern's hub shows (GET /api/xp/summary, and the xp.summary event)
export function summary() {
  const all = xp.badges.earned();
  return xp.learning.summary({ balance: xp.balance(), level: xp.level(), streak: xp.streak(), badges: { total: all.length, latest: all[0] ? { key: all[0].key, name: all[0].name, at: all[0].at } : null } });
}

// Called once at startup by server.mjs. d = { announce(item), broadcast(type, data), blocksToday(), canAsk(), env() }
export function wire(d) {
  xp.setDeps({
    llm: { ready: () => llm.ready(), complete: (o) => llm.complete(o) },
    addPrayer: (text) => import("./prayerskills.mjs").then((m) => m.add({ title: String(text).slice(0, 120) })),
    env: () => ({ ...(d.env?.() ?? { listen: "active", mode: "voice" }), ...(screenStopped() ? { listen: "quiet" } : {}) }),
  });
  import("./owner.mjs").then((owner) => xp.setDeps({ ownerName: () => owner.get().name || "", ownerNick: () => owner.nicknames()[0] || "" })).catch(() => {});
  import("./persona/index.mjs").then((persona) => xp.setDeps({ persona })).catch(() => { /* no personality module */ });
  // Lantern: verified learning becomes XP (live events + a backfill every 10 minutes), and Lantern's hub gets a summary
  import("./lantern.mjs").then((ln) => {
    lanternMod = ln;
    xp.learning.setClient({ call: (path, opts) => (ln.ecoApi() ? ln.ecoApi().call("lantern", path, opts) : Promise.resolve({ ok: false, status: 0 })), port: async () => (await ln.ecoApi()?.peer("lantern"))?.port ?? null });
    // verify-first (async): never lets a failure escape as an unhandled rejection
    ln.setDeps({ xp: (ev) => Promise.resolve(xp.learning.onEco(ev)).catch((e) => { console.log(`xp learning: ${e.message}`); return null; }), xpClaim: (text) => xp.learning.claim(text) });
    xp.learning.startSync();          // fine without Lantern: it just finds nothing until Lantern runs
  }).catch(() => {});
  let pushT = null;
  xp.onEvent((kind) => {
    if (!["award", "levelup", "spend", "undo", "badge", "badge-revoked"].includes(kind) || !lanternMod?.ecoApi()) return;
    clearTimeout(pushT); pushT = setTimeout(() => { try { lanternMod.send("xp.summary", summary()); } catch { /* Lantern isn't there */ } }, 1500); pushT.unref?.();
  });
  // a finished Dayspring focus timer or pomodoro → a full-credit work check-in (lib/xp timerFinished)
  import("./timers.mjs").then((t) => t.setDeps({ finished: (timer) => xp.timerFinished(timer) })).catch(() => {});
  // badges already earned by the ledger (a first start after updating): recorded quietly; they show as NEW in the gallery
  setTimeout(() => { try { xp.badges.sync(); } catch (e) { console.log(`xp badges: ${e.message}`); } }, 1500).unref?.();
  xp.onEvent((kind, data) => {
    if (!["award", "levelup", "spend", "undo", "settings", "badge", "badge-revoked", "badge-nudge", "badge-polished"].includes(kind)) return;
    try { d.broadcast("xp", { kind, ...data, view: view() }); } catch { /* no screens */ }
    // said once, after the last of several badges earned together (spoken or shown per the listening mode)
    if (kind === "badge" && data.seq === data.of - 1) {
      const all = xp.badges.earned().filter((r) => r.earnedAt === data.earnedAt);
      try { d.announce({ kind: "xpbadge", started: { title: `🏅 New badge: ${data.name}`, category: "star" }, text: xp.speakBadges(all.length ? all.reverse() : [data]), badge: data.key }); } catch { /* no screens */ }
    }
  });
  xp.startScheduler({
    blocksToday: d.blocksToday,
    canAsk: () => !screenStopped() && d.canAsk(),
    ask: ({ text, category }) => d.announce({ kind: "xpcheckin", title: "Check-in", text, ask: true, category }),
    // a visual-only nudge is shown by the screens' toast (the "badge-nudge" event), which marks it sent
    nudge: (n) => { if (n.speak) d.announce({ kind: "xpbadge", title: "Badge", text: n.text, ask: false, silent: false, category: n.cat }); },
  });
}

export function view() {
  const lv = xp.level(), st = xp.streak();
  return {
    enabled: xp.enabled(), balance: xp.balance(), lifetime: xp.lifetime(), level: lv, streak: st, daily: xp.daily(14),
    recent: xp.history({ limit: 25 }).filter((e) => e.type !== "saver").map((e) => ({ at: e.at, day: e.day, type: e.type, amount: e.amount, category: e.category ?? null, title: e.title ?? "", evidence: e.evidence ? String(e.evidence).slice(0, 140) : "", reason: e.reason ?? "", reversed: Boolean(e.reversed) })),
    unlockables: xp.unlockables(), rules: xp.rules(), settings: xp.settings(), active: Boolean(xp.checkin.active("tv")),
    badges: { total: xp.badges.earned().length, pins: xp.badges.view().pins, latest: xp.badges.latest() },
  };
}
const SVG = { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" };

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (p !== "/xp" && !p.startsWith("/xp/")) return false;
  try {
    if (m === "GET" && p === "/xp") return send(res, 200, view()), true;
    if (m === "GET" && p === "/xp/learning") return send(res, 200, await xp.learning.view()), true;
    if (m === "POST" && p === "/xp/learning/sync") return send(res, 200, await xp.learning.reconcile()), true;
    // for Lantern (its hub shows Dayspring's XP): the ecosystem's Host/Origin guards and its token
    if (m === "GET" && p === "/xp/summary") {
      const eco = lanternMod?.ecoApi?.() ?? (await import("./lantern.mjs")).ecoApi();
      if (!eco) return send(res, 503, { error: "The ecosystem link isn't running." }), true;
      const g = eco.guard(req); if (g) return send(res, g.status, { error: g.error }), true;
      if (!eco.tokenOk(req)) return send(res, 401, { error: "The ecosystem token is missing or wrong." }), true;
      return send(res, 200, summary()), true;
    }
    const wantDev = q?.get?.("dev") === "1";
    if (wantDev && !dev.isDev()) return send(res, 404, { error: "Not found." }), true;          // no developer preview here
    if (m === "GET" && p === "/xp/badges" && wantDev) {
      let who = { name: "", nickname: "" }; try { const o = (await import("./owner.mjs")); who = { name: o.get().name || "", nickname: o.nicknames()[0] || "" }; } catch { /* no owner file */ }
      const v = previewView(xp.badges.view(), { ...who, mode: xp.badges.badgeSettings().nameMode });
      return send(res, 200, { ...v, palettes: art.PALETTES, entrance: { ...MOTION.entrance, turns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(MOTION.entrance.turns), duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(MOTION.entrance.duration) } }), true;
    }
    if (m === "GET" && p === "/xp/badges") return send(res, 200, { ...xp.badges.view(), palettes: art.PALETTES, entrance: { ...MOTION.entrance, turns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(MOTION.entrance.turns), duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(MOTION.entrance.duration) } }), true;
    if (m === "GET" && p === "/xp/badge.css") { res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" }); res.end(motionCSS() + gridCSS()); return true; }
    if (m === "GET" && (p === "/xp/badge.svg" || p === "/xp/mystery.svg")) {
      const cat = String(q?.get?.("cat") ?? ""), tier = Number(q?.get?.("tier")), size = Math.min(512, Math.max(16, Number(q?.get?.("size")) || 160));
      if (p === "/xp/mystery.svg") {
        // only the next tier of a category has a mystery card (a later one would give away what's coming)
        let n = null; try { n = xp.badges.next(cat); } catch { /* unknown category */ }
        if (!n || n.done || n.tier !== tier) return send(res, 404, { error: "Only the next badge has a mystery card." }), true;
        res.writeHead(200, SVG); res.end(art.mystery(cat, tier, { size })); return true;
      }
      // no art for badges you haven't earned (the developer preview, checked above, is the one exception)
      if (!xp.badges.records()[`${cat}:${tier}`] && !(wantDev && Number.isInteger(tier) && tier >= 1 && tier <= 18 && art.PALETTES[cat])) return send(res, 404, { error: "Not earned yet." }), true;
      const mode = ["full", "grid", "static"].includes(q?.get?.("mode")) ? q.get("mode") : "full";
      res.writeHead(200, SVG); res.end(q?.get?.("face") === "back" ? art.back(cat, tier, { size }) : art.svg(cat, tier, { size, mode, style: q?.get?.("style") !== "0" })); return true;
    }
    if (m !== "POST") return false;
    const b = await readJSON(req).catch(() => ({}));
    const surface = String(b.surface ?? "tv");
    // typed check-ins (the Progress page) live apart from spoken ones ("typed"), each with its own id; the source is
    // always "self" here, whatever the client says
    if (p === "/xp/checkin") {
      const id = b.id ? String(b.id) : null;
      if (b.text && !b.category) {
        if (!(id && xp.checkin.active("typed")?.id === id)) xp.checkin.cancel("typed");
        const r = await xp.handle(String(b.text), { surface: "typed", typed: true, id });
        return send(res, 200, { reply: r?.reply ?? null, awaiting: Boolean(r?.awaiting), session: r?.awaiting ? r.session ?? null : null, xp: r?.xp ?? null, show: r?.show ?? null }), true;
      }
      const r = xp.checkin.start(String(b.category), { source: "self", title: b.title ? String(b.title).slice(0, 80) : undefined, done: b.done === true }, "typed", { typed: true });
      return send(res, 200, { reply: r.prompt ?? r.message ?? null, awaiting: Boolean(r.prompt), session: r.prompt ? r.session ?? null : null, xp: r.result ?? null }), true;
    }
    if (p === "/xp/answer") {
      const r = b.id ? await xp.checkin.answer(String(b.text ?? ""), "typed", { id: String(b.id) }) : null;
      return send(res, 200, r ? { reply: r.prompt ? (r.message ? `${r.message} ${r.prompt}` : r.prompt) : r.message, awaiting: Boolean(r.prompt), session: r.prompt ? r.session ?? null : null, xp: r.result ?? null } : { reply: null, awaiting: false, expired: true }), true;
    }
    if (p === "/xp/presence") { _pages.set(String(b.page ?? "anon").slice(0, 64), b.stopped); return send(res, 200, { ok: true, stopped: screenStopped() }), true; }
    if (p === "/xp/badges/nudged") return send(res, 200, { ok: true, marked: xp.badges.markNudged(String(b.cat ?? "")) }), true;
    if (p === "/xp/undo") return send(res, 200, xp.undoLast()), true;
    if (p === "/xp/unlock") return send(res, 200, await xp.unlockCharacter(b.id ? String(b.id) : null)), true;
    if (p === "/xp/badges/seen") return send(res, 200, { ok: true, marked: xp.badges.markSeen((Array.isArray(b.keys) ? b.keys : []).map(String).slice(0, 400)) }), true;
    if (p === "/xp/badges/pin") return send(res, 200, xp.badges.pin(String(b.key ?? ""))), true;
    if (p === "/xp/badges/unpin") return send(res, 200, xp.badges.unpin(String(b.key ?? ""))), true;
    if (p === "/xp/badges/rename") return send(res, 200, { ok: true, changed: xp.badges.renameAll() }), true;
    if (p === "/xp/settings") {
      const bs = b.badges && typeof b.badges === "object" ? { ...(["name", "nickname", "none"].includes(b.badges.nameMode) ? { nameMode: b.badges.nameMode } : {}), ...(b.badges.hideNextName !== undefined ? { hideNextName: Boolean(b.badges.hideNextName) } : {}), ...(b.badges.nudges !== undefined ? { nudges: Boolean(b.badges.nudges) } : {}), ...(b.badges.nudgeCats && typeof b.badges.nudgeCats === "object" ? { nudgeCats: Object.fromEntries(Object.entries(b.badges.nudgeCats).map(([k, v]) => [String(k), Boolean(v)])) } : {}) } : null;
      return send(res, 200, xp.setSettings({ ...(b.enabled !== undefined ? { enabled: Boolean(b.enabled) } : {}), ...(b.trackHidden !== undefined ? { trackHidden: Boolean(b.trackHidden) } : {}), ...(b.reminders ? { reminders: b.reminders } : {}), ...(Array.isArray(b.checkinTimes) ? { checkinTimes: b.checkinTimes } : {}), ...(bs ? { badges: bs } : {}) })), true;
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
